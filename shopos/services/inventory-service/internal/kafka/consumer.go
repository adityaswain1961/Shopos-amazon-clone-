package kafka

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"time"

	ck "github.com/confluentinc/confluent-kafka-go/v2/kafka"
	"github.com/google/uuid"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
	"github.com/shopos/inventory-service/internal/repository"
)

// Topics this service reacts to (saga participant).
var topics = []string{"order.created", "order.confirmed", "order.cancelled", "inventory.release"}

var (
	eventsHandled = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "shopos_inventory_events_total",
		Help: "Saga events handled by inventory-service, by topic and outcome.",
	}, []string{"topic", "outcome"})
)

type envelope struct {
	EventID string          `json:"eventId"`
	Type    string          `json:"type"`
	Payload json.RawMessage `json:"payload"`
}

type orderPayload struct {
	OrderID string            `json:"orderId"`
	Items   []repository.Item `json:"items"`
}

// OrderConsumer processes saga events with at-least-once semantics:
// an offset is committed only after the message was fully handled (or parked
// on a DLQ), and every handler is idempotent per order id.
type OrderConsumer struct {
	consumer *ck.Consumer
	producer *ck.Producer
	repo     *repository.StockRepository
	log      *slog.Logger
	ttl      time.Duration
}

func NewOrderConsumer(repo *repository.StockRepository, brokers string, reservationTTL time.Duration, log *slog.Logger) (*OrderConsumer, error) {
	c, err := ck.NewConsumer(&ck.ConfigMap{
		"bootstrap.servers":  brokers,
		"group.id":           "inventory-saga-group",
		"auto.offset.reset":  "earliest",
		"enable.auto.commit": false,
		"session.timeout.ms": 30000,
	})
	if err != nil {
		return nil, err
	}
	p, err := ck.NewProducer(&ck.ConfigMap{
		"bootstrap.servers":  brokers,
		"enable.idempotence": true,
		"acks":               "all",
		"linger.ms":          5,
		"compression.type":   "gzip", // kafkajs consumers only support gzip natively
	})
	if err != nil {
		c.Close()
		return nil, err
	}
	return &OrderConsumer{consumer: c, producer: p, repo: repo, log: log, ttl: reservationTTL}, nil
}

// Run blocks until ctx is cancelled.
func (oc *OrderConsumer) Run(ctx context.Context) error {
	if err := oc.consumer.SubscribeTopics(topics, nil); err != nil {
		return err
	}
	go oc.drainProducerEvents()
	oc.log.Info("inventory saga consumer started", "topics", topics)

	for {
		select {
		case <-ctx.Done():
			return nil
		default:
		}

		msg, err := oc.consumer.ReadMessage(time.Second)
		if err != nil {
			var kerr ck.Error
			if errors.As(err, &kerr) && kerr.Code() == ck.ErrTimedOut {
				continue
			}
			oc.log.Warn("kafka read error", "err", err)
			continue
		}

		if !oc.handleWithRetry(ctx, msg) {
			return nil // shutting down mid-retry: do not commit, the message will be redelivered
		}
		if _, err := oc.consumer.CommitMessage(msg); err != nil {
			oc.log.Warn("offset commit failed", "err", err)
		}
	}
}

// handleWithRetry returns false only if ctx was cancelled before success.
func (oc *OrderConsumer) handleWithRetry(ctx context.Context, msg *ck.Message) bool {
	topic := *msg.TopicPartition.Topic
	backoff := 200 * time.Millisecond
	for attempt := 1; attempt <= 5; attempt++ {
		err := oc.handle(ctx, topic, msg.Value)
		if err == nil {
			return true
		}
		oc.log.Warn("saga handler failed", "topic", topic, "attempt", attempt, "err", err)
		select {
		case <-ctx.Done():
			return false
		case <-time.After(backoff):
		}
		backoff *= 2
	}
	eventsHandled.WithLabelValues(topic, "dlq").Inc()
	if err := oc.produce(topic+".dlq", msg.Key, msg.Value); err != nil {
		oc.log.Error("failed to park message on DLQ", "topic", topic, "err", err)
		return false
	}
	return true
}

func (oc *OrderConsumer) handle(ctx context.Context, topic string, value []byte) error {
	var env envelope
	if err := json.Unmarshal(value, &env); err != nil {
		oc.log.Warn("unparseable message; skipping", "topic", topic)
		eventsHandled.WithLabelValues(topic, "skipped").Inc()
		return nil
	}
	raw := []byte(env.Payload)
	if len(raw) == 0 {
		raw = value // tolerate un-enveloped messages
	}
	var p orderPayload
	if err := json.Unmarshal(raw, &p); err != nil || p.OrderID == "" {
		oc.log.Warn("message without orderId; skipping", "topic", topic)
		eventsHandled.WithLabelValues(topic, "skipped").Inc()
		return nil
	}
	if _, err := uuid.Parse(p.OrderID); err != nil {
		oc.log.Warn("malformed orderId; skipping", "topic", topic, "orderId", p.OrderID)
		eventsHandled.WithLabelValues(topic, "skipped").Inc()
		return nil
	}

	switch topic {
	case "order.created":
		state, err := oc.repo.ReserveForOrder(ctx, p.OrderID, p.Items, oc.ttl)
		switch {
		case errors.Is(err, repository.ErrInsufficientStock):
			eventsHandled.WithLabelValues(topic, "out_of_stock").Inc()
			return oc.publish("inventory.failed", p.OrderID, map[string]any{
				"orderId": p.OrderID, "reason": "out_of_stock", "detail": err.Error(),
			})
		case errors.Is(err, repository.ErrInvalidItems):
			eventsHandled.WithLabelValues(topic, "invalid").Inc()
			return oc.publish("inventory.failed", p.OrderID, map[string]any{
				"orderId": p.OrderID, "reason": "invalid_items", "detail": err.Error(),
			})
		case err != nil:
			return err // transient (DB) error → retry
		case state == repository.StateAlreadyReleased:
			eventsHandled.WithLabelValues(topic, "already_released").Inc()
			return nil
		default:
			// Also re-publishes on redelivery, which heals a confirm event lost
			// between our DB commit and the Kafka ack.
			eventsHandled.WithLabelValues(topic, "reserved").Inc()
			return oc.publish("inventory.confirmed", p.OrderID, map[string]any{"orderId": p.OrderID})
		}

	case "order.confirmed":
		n, err := oc.repo.ConfirmByOrder(ctx, p.OrderID)
		if err == nil {
			eventsHandled.WithLabelValues(topic, "committed").Inc()
			oc.log.Debug("stock committed", "orderId", p.OrderID, "lines", n)
		}
		return err

	case "order.cancelled", "inventory.release":
		n, err := oc.repo.ReleaseByOrder(ctx, p.OrderID)
		if err == nil {
			eventsHandled.WithLabelValues(topic, "released").Inc()
			oc.log.Debug("stock released", "orderId", p.OrderID, "lines", n)
		}
		return err
	}
	return nil
}

func (oc *OrderConsumer) publish(topic, key string, payload map[string]any) error {
	body, err := json.Marshal(map[string]any{
		"eventId":   uuid.NewString(),
		"type":      topic,
		"timestamp": time.Now().UTC().Format(time.RFC3339Nano),
		"version":   "1.0",
		"payload":   payload,
	})
	if err != nil {
		return err
	}
	return oc.produce(topic, []byte(key), body)
}

// produce waits for the broker ack so we only commit the input offset after
// the output event is durable.
func (oc *OrderConsumer) produce(topic string, key, value []byte) error {
	delivery := make(chan ck.Event, 1)
	err := oc.producer.Produce(&ck.Message{
		TopicPartition: ck.TopicPartition{Topic: &topic, Partition: ck.PartitionAny},
		Key:            key,
		Value:          value,
	}, delivery)
	if err != nil {
		return err
	}
	select {
	case e := <-delivery:
		if m, ok := e.(*ck.Message); ok && m.TopicPartition.Error != nil {
			return m.TopicPartition.Error
		}
		return nil
	case <-time.After(15 * time.Second):
		return errors.New("kafka delivery timeout")
	}
}

func (oc *OrderConsumer) drainProducerEvents() {
	for e := range oc.producer.Events() {
		if kerr, ok := e.(ck.Error); ok {
			oc.log.Warn("kafka producer error", "err", kerr)
		}
	}
}

func (oc *OrderConsumer) Close() {
	_ = oc.consumer.Close()
	oc.producer.Flush(5000)
	oc.producer.Close()
}
