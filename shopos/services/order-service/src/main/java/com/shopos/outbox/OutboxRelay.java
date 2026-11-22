package com.shopos.outbox;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.PreparedStatementSetter;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.kafka.support.SendResult;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;

/**
 * Publishes outbox rows to Kafka.
 *
 * Safe with any number of replicas: each batch is claimed with
 * {@code FOR UPDATE SKIP LOCKED}, so pods never publish the same row twice
 * concurrently, and a row is only marked published after Kafka acked it.
 * Delivery is at-least-once; every consumer is idempotent.
 */
@Component
public class OutboxRelay {

    private static final Logger log = LoggerFactory.getLogger(OutboxRelay.class);

    private record Row(long id, String aggregateId, String topic, String payload) {}

    private final JdbcTemplate jdbc;
    private final KafkaTemplate<String, String> kafka;
    private final TransactionTemplate tx;
    private final int batchSize;

    public OutboxRelay(JdbcTemplate jdbc,
                       KafkaTemplate<String, String> kafka,
                       PlatformTransactionManager tm,
                       @Value("${shopos.outbox.batch-size:500}") int batchSize) {
        this.jdbc = jdbc;
        this.kafka = kafka;
        this.tx = new TransactionTemplate(tm);
        this.batchSize = batchSize;
    }

    @Scheduled(fixedDelayString = "${shopos.outbox.poll-ms:200}")
    public void publishPending() {
        try {
            // Drain while full batches keep succeeding; stop on any failure.
            Integer published;
            do {
                published = tx.execute(status -> publishBatch());
            } while (published != null && published == batchSize);
        } catch (Exception e) {
            log.warn("Outbox relay cycle failed: {}", e.getMessage());
        }
    }

    private int publishBatch() {
        List<Row> rows = jdbc.query(
            "SELECT id, aggregate_id, topic, payload::text AS payload FROM outbox_events "
                + "WHERE published_at IS NULL ORDER BY id LIMIT ? FOR UPDATE SKIP LOCKED",
            (rs, i) -> new Row(rs.getLong("id"), rs.getString("aggregate_id"), rs.getString("topic"), rs.getString("payload")),
            batchSize);
        if (rows.isEmpty()) {
            return 0;
        }

        // Send all, then wait: lets the producer batch instead of one round trip per row.
        List<CompletableFuture<SendResult<String, String>>> futures = new ArrayList<>(rows.size());
        for (Row r : rows) {
            futures.add(kafka.send(r.topic(), r.aggregateId(), r.payload()));
        }

        List<Long> ok = new ArrayList<>();
        List<Long> failed = new ArrayList<>();
        for (int i = 0; i < rows.size(); i++) {
            try {
                futures.get(i).get(15, TimeUnit.SECONDS);
                ok.add(rows.get(i).id());
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                failed.add(rows.get(i).id());
            } catch (Exception e) {
                failed.add(rows.get(i).id());
            }
        }

        if (!ok.isEmpty()) {
            jdbc.update("UPDATE outbox_events SET published_at = NOW() WHERE id = ANY(?)",
                (PreparedStatementSetter) ps -> ps.setArray(1, ps.getConnection().createArrayOf("bigint", ok.toArray())));
        }
        if (!failed.isEmpty()) {
            jdbc.update("UPDATE outbox_events SET attempts = attempts + 1 WHERE id = ANY(?)",
                (PreparedStatementSetter) ps -> ps.setArray(1, ps.getConnection().createArrayOf("bigint", failed.toArray())));
            log.warn("Outbox: {} events failed to publish; will retry", failed.size());
            return -1; // stop draining this cycle
        }
        return ok.size();
    }

    /** Keep the outbox table small: published rows are only needed briefly for debugging. */
    @Scheduled(fixedDelay = 3_600_000L, initialDelay = 300_000L)
    public void purgePublished() {
        int n = jdbc.update("DELETE FROM outbox_events WHERE published_at < NOW() - INTERVAL '3 days'");
        if (n > 0) {
            log.info("Outbox: purged {} published events", n);
        }
    }
}
