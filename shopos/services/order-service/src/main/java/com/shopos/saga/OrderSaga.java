package com.shopos.saga;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Service;

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

@Service
public class OrderSaga {

    private final KafkaTemplate<String, String> kafkaTemplate;
    private final ObjectMapper objectMapper = new ObjectMapper();

    public OrderSaga(KafkaTemplate<String, String> kafkaTemplate) {
        this.kafkaTemplate = kafkaTemplate;
    }

    public void startSaga(String orderId, String cartId, String sku, int quantity) {
        Map<String, Object> envelope = baseEnvelope("order.created");
        Map<String, Object> payload = new HashMap<>();
        payload.put("orderId", orderId);
        payload.put("cartId", cartId);
        payload.put("sku", sku);
        payload.put("quantity", quantity);
        envelope.put("payload", payload);
        send("order.created", envelope);
    }

    @KafkaListener(topics = "inventory.confirmed", groupId = "order-saga-group")
    public void handleInventoryConfirmed(String message) {
        send("payment.initiate", message);
    }

    @KafkaListener(topics = "payment.completed", groupId = "order-saga-group")
    public void handlePaymentCompleted(String message) {
        send("order.confirmed", message);
    }

    @KafkaListener(topics = "payment.failed", groupId = "order-saga-group")
    public void handlePaymentFailed(String message) {
        send("inventory.release", message);
    }

    private Map<String, Object> baseEnvelope(String type) {
        Map<String, Object> envelope = new HashMap<>();
        envelope.put("eventId", UUID.randomUUID().toString());
        envelope.put("type", type);
        envelope.put("timestamp", java.time.Instant.now().toString());
        envelope.put("version", "1.0");
        return envelope;
    }

    private void send(String topic, Object body) {
        try {
            String json = body instanceof String ? (String) body : objectMapper.writeValueAsString(body);
            kafkaTemplate.send(topic, json);
        } catch (Exception e) {
            throw new RuntimeException("Failed to publish saga event to " + topic, e);
        }
    }
}
