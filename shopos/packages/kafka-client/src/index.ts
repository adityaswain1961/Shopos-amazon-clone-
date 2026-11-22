import { Kafka, CompressionTypes, logLevel, type Producer, type Consumer, type EachMessagePayload } from 'kafkajs';
import { v4 as uuidv4 } from 'uuid';
import type { KafkaEvent } from '@shopos/shared-types';

/**
 * One long-lived producer per process. Creating a producer per request (as the
 * old review-service did) costs a TCP+metadata handshake each time and falls
 * over long before 1M users.
 */

export function createKafka(clientId: string, brokers: string): Kafka {
  return new Kafka({
    clientId,
    brokers: brokers.split(',').map((b) => b.trim()),
    logLevel: logLevel.WARN,
    retry: { initialRetryTime: 300, retries: 8, factor: 2 },
  });
}

export function createKafkaProducer(clientId: string, brokers: string): Producer {
  return createKafka(clientId, brokers).producer({
    allowAutoTopicCreation: process.env.NODE_ENV !== 'production',
    idempotent: true,
    maxInFlightRequests: 5,
  });
}

export function buildEvent<T>(type: string, payload: T): KafkaEvent<T> {
  return {
    eventId: uuidv4(),
    type,
    timestamp: new Date().toISOString(),
    version: '1.0',
    payload,
  };
}

/** `key` controls partitioning: use the entity id so its events stay ordered. */
export async function publishKafkaEvent(
  p: Producer,
  topic: string,
  event: KafkaEvent<unknown>,
  key?: string,
): Promise<void> {
  await p.send({
    topic,
    compression: CompressionTypes.GZIP,
    messages: [{ key: key ?? event.eventId, value: JSON.stringify(event) }],
  });
}

export function parseEvent<T = Record<string, unknown>>(raw: Buffer | null): KafkaEvent<T> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw.toString('utf8'));
    if (parsed && typeof parsed === 'object' && 'payload' in parsed) return parsed as KafkaEvent<T>;
    // tolerate un-enveloped legacy messages
    return { eventId: '', type: '', timestamp: '', version: '0', payload: parsed as T };
  } catch {
    return null;
  }
}

/**
 * Run a consumer with per-message error isolation: a poison message is
 * forwarded to `<topic>.dlq` after `maxRetries` instead of blocking the
 * partition forever (or crashing the pod into a restart loop).
 */
export async function runConsumer(
  consumer: Consumer,
  dlqProducer: Producer | null,
  handler: (payload: EachMessagePayload) => Promise<void>,
  opts: { partitionsConsumedConcurrently?: number; maxRetries?: number; log?: (m: string, e?: unknown) => void } = {},
): Promise<void> {
  const maxRetries = opts.maxRetries ?? 3;
  const log = opts.log ?? ((m: string, e?: unknown) => console.error(m, e));

  await consumer.run({
    partitionsConsumedConcurrently: opts.partitionsConsumedConcurrently ?? 4,
    eachMessage: async (payload) => {
      for (let attempt = 1; ; attempt++) {
        try {
          await handler(payload);
          return;
        } catch (err) {
          if (attempt >= maxRetries) {
            log(`message failed ${attempt}x on ${payload.topic}; sending to DLQ`, err);
            if (dlqProducer) {
              await dlqProducer.send({
                topic: `${payload.topic}.dlq`,
                messages: [
                  {
                    key: payload.message.key,
                    value: payload.message.value,
                    headers: { error: String((err as Error)?.message ?? err).slice(0, 500) },
                  },
                ],
              });
            }
            return;
          }
          await new Promise((r) => setTimeout(r, 200 * 2 ** attempt));
        }
      }
    },
  });
}
