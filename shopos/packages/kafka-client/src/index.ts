import { Kafka, Producer, logLevel } from 'kafkajs';
import { v4 as uuidv4 } from 'uuid';
import type { KafkaEvent } from '@shopos/shared-types';

let producer: Producer | null = null;

export function createKafkaProducer(clientId: string, brokers: string): Producer {
  const kafka = new Kafka({
    clientId,
    brokers: brokers.split(',').map((b) => b.trim()),
    logLevel: logLevel.WARN,
  });
  return kafka.producer({ allowAutoTopicCreation: true, idempotent: true });
}

export async function connectProducer(p: Producer): Promise<void> {
  producer = p;
  await p.connect();
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

export async function publishKafkaEvent(
  p: Producer,
  topic: string,
  event: KafkaEvent<unknown>,
): Promise<void> {
  await p.send({
    topic,
    messages: [{ key: event.eventId, value: JSON.stringify(event) }],
  });
}

export { producer };
