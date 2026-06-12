package kafka

import (
	"context"
	"encoding/json"
	"log"
	"os"
	"strings"
	"time"

	"github.com/confluentinc/confluent-kafka-go/v2/kafka"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/shopos/inventory-service/internal/repository"
)

type OrderConsumer struct {
	consumer *kafka.Consumer
	producer *kafka.Producer
	repo     *repository.StockRepository
}

func NewOrderConsumer(pool *pgxpool.Pool, brokers string) *OrderConsumer {
	if brokers == "" {
		brokers = "localhost:9092"
	}
	c, err := kafka.NewConsumer(&kafka.ConfigMap{
		"bootstrap.servers": brokers,
		"group.id":          "inventory-saga-group",
		"auto.offset.reset": "earliest",
	})
	if err != nil {
		log.Printf("kafka consumer init failed: %v", err)
		return &OrderConsumer{repo: repository.NewStockRepository(pool)}
	}
	p, err := kafka.NewProducer(&kafka.ConfigMap{"bootstrap.servers": brokers})
	if err != nil {
		log.Printf("kafka producer init failed: %v", err)
	}
	return &OrderConsumer{consumer: c, producer: p, repo: repository.NewStockRepository(pool)}
}

type orderCreatedPayload struct {
	OrderID string `json:"orderId"`
	CartID  string `json:"cartId"`
	SKU     string `json:"sku"`
	Qty     int    `json:"quantity"`
}

func parseEnvelope(raw string) orderCreatedPayload {
	var outer struct {
		Payload orderCreatedPayload `json:"payload"`
	}
	var direct orderCreatedPayload
	if err := json.Unmarshal([]byte(raw), &outer); err == nil && outer.Payload.OrderID != "" {
		return outer.Payload
	}
	_ = json.Unmarshal([]byte(raw), &direct)
	if direct.SKU == "" {
		direct.SKU = "SKU-DEMO-001"
	}
	if direct.Qty == 0 {
		direct.Qty = 1
	}
	return direct
}

func (oc *OrderConsumer) Run(ctx context.Context) {
	if oc.consumer == nil {
		return
	}
	_ = oc.consumer.SubscribeTopics([]string{"order.created", "inventory.release"}, nil)
	log.Println("Inventory Kafka consumer started")

	for {
		select {
		case <-ctx.Done():
			return
		default:
			msg, err := oc.consumer.ReadMessage(2 * time.Second)
			if err != nil {
				continue
			}
			topic := *msg.TopicPartition.Topic
			value := string(msg.Value)

			switch topic {
			case "order.created":
				p := parseEnvelope(value)
				if err := oc.repo.ReserveForOrder(ctx, p.OrderID, p.SKU, p.Qty); err != nil {
					log.Printf("reserve failed for order %s: %v", p.OrderID, err)
					continue
				}
				oc.publish("inventory.confirmed", map[string]string{
					"orderId": p.OrderID,
					"cartId":  p.CartID,
					"sku":     p.SKU,
				})
			case "inventory.release":
				p := parseEnvelope(value)
				_ = oc.repo.ReleaseByOrder(ctx, p.OrderID)
			}
		}
	}
}

func (oc *OrderConsumer) publish(topic string, payload interface{}) {
	if oc.producer == nil {
		return
	}
	body, _ := json.Marshal(payload)
	_ = oc.producer.Produce(&kafka.Message{
		TopicPartition: kafka.TopicPartition{Topic: &topic, Partition: kafka.PartitionAny},
		Value:          body,
	}, nil)
}

func (oc *OrderConsumer) Close() {
	if oc.consumer != nil {
		oc.consumer.Close()
	}
	if oc.producer != nil {
		oc.producer.Flush(5000)
		oc.producer.Close()
	}
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return strings.TrimSpace(v)
	}
	return fallback
}
