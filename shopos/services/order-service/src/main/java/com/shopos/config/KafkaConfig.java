package com.shopos.config;

import org.apache.kafka.common.TopicPartition;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.kafka.listener.DeadLetterPublishingRecoverer;
import org.springframework.kafka.listener.DefaultErrorHandler;
import org.springframework.util.backoff.FixedBackOff;

@Configuration
public class KafkaConfig {

    /**
     * Retry a failing saga message 3 times, then park it on {@code <topic>.dlq}
     * so one poison message can't block its partition (and every order behind it).
     * Spring Boot attaches this bean to the auto-configured listener container.
     */
    @Bean
    DefaultErrorHandler kafkaErrorHandler(KafkaTemplate<String, String> template) {
        DeadLetterPublishingRecoverer recoverer = new DeadLetterPublishingRecoverer(
            template, (record, ex) -> new TopicPartition(record.topic() + ".dlq", -1));
        return new DefaultErrorHandler(recoverer, new FixedBackOff(500L, 3L));
    }
}
