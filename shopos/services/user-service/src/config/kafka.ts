import { Kafka, Producer, logLevel } from 'kafkajs';
import { env } from './env.js';
import { logger } from '../utils/logger.js';

let producer: Producer | null = null;
let kafka: Kafka | null = null;

export function getKafkaProducer(): Producer {
  if (producer) return producer;

  kafka = new Kafka({
    clientId: env.KAFKA_CLIENT_ID,
    brokers: env.KAFKA_BROKERS.split(','),
    logLevel: logLevel.WARN,
    retry: {
      initialRetryTime: 300,
      retries: 3,
      factor: 2,    // exponential backoff
    },
  });

  producer = kafka.producer({
    allowAutoTopicCreation: true,
    idempotent: true,
  });

  return producer;
}

export async function connectKafka(): Promise<void> {
  try {
    const p = getKafkaProducer();
    await p.connect();
    logger.info('✅ Kafka producer connected successfully');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.warn('⚠️ Kafka connection failed (non-fatal in dev)', { error: message });
    // Non-fatal: user service should work without Kafka in dev
  }
}

export async function disconnectKafka(): Promise<void> {
  if (producer) {
    await producer.disconnect();
    producer = null;
    logger.info('Kafka producer disconnected gracefully');
  }
}

export async function publishEvent(topic: string, message: object): Promise<void> {
  if (!producer) {
    logger.warn('Kafka producer not connected, skipping event', { topic });
    return;
  }

  try {
    await producer.send({
      topic,
      messages: [
        {
          key: (message as Record<string, unknown>)['eventId'] as string | undefined,
          value: JSON.stringify(message),
        },
      ],
    });
    logger.info('Kafka event published', { topic });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Failed to publish Kafka event', { topic, error: errorMessage });
    // Don't throw — Kafka failures should not break user operations
  }
}
