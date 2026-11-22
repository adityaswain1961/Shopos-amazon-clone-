import { Kafka, Producer, CompressionTypes, logLevel } from 'kafkajs';
import { env } from './env.js';
import { logger } from '../utils/logger.js';

let producer: Producer | null = null;
let connected = false;

export function getKafkaProducer(): Producer {
  if (producer) return producer;

  const kafka = new Kafka({
    clientId: env.KAFKA_CLIENT_ID,
    brokers: env.KAFKA_BROKERS.split(',').map((b) => b.trim()),
    logLevel: logLevel.WARN,
    retry: { initialRetryTime: 300, retries: 5, factor: 2 },
  });

  producer = kafka.producer({
    // Topics are created up-front with explicit partition counts (see
    // infrastructure/kafka/topics.yaml); auto-created topics get 1 partition
    // and silently cap consumer parallelism.
    allowAutoTopicCreation: env.NODE_ENV !== 'production',
    idempotent: true,
    maxInFlightRequests: 5,
  });

  producer.on(producer.events.DISCONNECT, () => {
    connected = false;
  });
  producer.on(producer.events.CONNECT, () => {
    connected = true;
  });

  return producer;
}

export function isKafkaConnected(): boolean {
  return connected;
}

export async function connectKafka(): Promise<void> {
  try {
    await getKafkaProducer().connect();
    logger.info('Kafka producer connected');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.warn('Kafka connection failed (events will be skipped until it recovers)', { error: message });
  }
}

export async function disconnectKafka(): Promise<void> {
  if (producer) {
    await producer.disconnect();
    producer = null;
    connected = false;
  }
}

/**
 * Publish an event. `key` decides the partition, so all events for the same
 * entity (user / product / order id) stay in order. Never throws: event
 * delivery must not fail the user-facing request.
 */
export async function publishEvent(topic: string, message: object, key?: string): Promise<void> {
  if (!producer) {
    logger.warn('Kafka producer not initialised, skipping event', { topic });
    return;
  }

  try {
    await producer.send({
      topic,
      compression: CompressionTypes.GZIP,
      messages: [
        {
          key: key ?? ((message as Record<string, unknown>)['eventId'] as string | undefined),
          value: JSON.stringify(message),
        },
      ],
    });
    logger.debug('Kafka event published', { topic });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Failed to publish Kafka event', { topic, error: errorMessage });
  }
}
