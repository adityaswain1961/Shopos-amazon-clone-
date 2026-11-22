package com.shopos.outbox;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

/**
 * Writes an event into outbox_events using the CALLER'S transaction.
 * Must be called inside the same transaction as the state change it describes.
 */
@Component
public class OutboxWriter {

    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;

    public OutboxWriter(JdbcTemplate jdbc, ObjectMapper mapper) {
        this.jdbc = jdbc;
        this.mapper = mapper;
    }

    public void write(String aggregateId, String topic, Map<String, Object> payload) {
        Map<String, Object> envelope = new LinkedHashMap<>();
        envelope.put("eventId", UUID.randomUUID().toString());
        envelope.put("type", topic);
        envelope.put("timestamp", Instant.now().toString());
        envelope.put("version", "1.0");
        envelope.put("payload", payload);
        try {
            jdbc.update(
                "INSERT INTO outbox_events (aggregate_id, topic, payload) VALUES (?, ?, ?::jsonb)",
                aggregateId, topic, mapper.writeValueAsString(envelope));
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("Could not serialise outbox event for " + topic, e);
        }
    }
}
