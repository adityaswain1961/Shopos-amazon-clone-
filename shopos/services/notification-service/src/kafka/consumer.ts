import type Redis from 'ioredis';
import type { Consumer, Producer } from 'kafkajs';
import { createKafka, parseEvent, runConsumer } from '@shopos/kafka-client';
import { sendEmail, layout, esc } from '../services/emailService';

const TOPICS = [
  'user.registered',
  'order.confirmed',
  'order.cancelled',
  'order.shipped',
  'payment.failed',
  'product.price_dropped',
];

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';
const money = (amount: unknown, currency: unknown) => `${esc(currency || 'INR')} ${Number(amount ?? 0).toFixed(2)}`;

type Payload = Record<string, unknown>;

function render(topic: string, p: Payload): { subject: string; html: string } | null {
  switch (topic) {
    case 'user.registered':
      return {
        subject: 'Welcome to ShopOS!',
        html: layout(`Welcome${p.name ? `, ${String(p.name)}` : ''}!`, '<p>Thanks for joining ShopOS. Happy shopping.</p>'),
      };
    case 'order.confirmed':
      return {
        subject: `Order ${String(p.orderNumber ?? '')} confirmed`,
        html: layout(
          'Your order is confirmed',
          `<p>Order <b>${esc(p.orderNumber)}</b> for <b>${money(p.totalAmount, p.currency)}</b> has been confirmed.</p>
           <p><a href="${esc(FRONTEND_URL)}/account/orders/${esc(p.orderId)}">View your order</a></p>`,
        ),
      };
    case 'order.cancelled':
      return {
        subject: `Order ${String(p.orderNumber ?? '')} was cancelled`,
        html: layout('Your order was cancelled', `<p>Order <b>${esc(p.orderNumber)}</b> was cancelled: ${esc(p.reason ?? 'unavailable')}.</p>`),
      };
    case 'order.shipped':
      return {
        subject: `Order ${String(p.orderNumber ?? '')} shipped`,
        html: layout('Your order is on the way', `<p>Order <b>${esc(p.orderNumber)}</b> has shipped.</p>`),
      };
    case 'payment.failed':
      return {
        subject: 'Payment failed',
        html: layout('Payment failed', `<p>We could not process the payment for order <b>${esc(p.orderNumber ?? p.orderId)}</b>. Please try again.</p>`),
      };
    case 'product.price_dropped':
      return {
        subject: `Price drop: ${String(p.title ?? 'an item you follow')}`,
        html: layout(
          'Price drop alert',
          `<p><b>${esc(p.title)}</b> is now ${money(p.newPrice, p.currency)} (was ${money(p.oldPrice, p.currency)}).</p>
           <p><a href="${esc(FRONTEND_URL)}/products/${esc(p.slug)}">View product</a></p>`,
        ),
      };
    default:
      return null;
  }
}

export async function startConsumer(redis: Redis): Promise<{ consumer: Consumer; producer: Producer }> {
  const kafka = createKafka('notification-service', process.env.KAFKA_BROKERS || 'localhost:9092');
  const consumer = kafka.consumer({ groupId: 'notification-group', sessionTimeout: 30_000, heartbeatInterval: 3_000 });
  const dlq = kafka.producer({ idempotent: true });

  await Promise.all([consumer.connect(), dlq.connect()]);
  for (const topic of TOPICS) {
    await consumer.subscribe({ topic, fromBeginning: false });
  }

  await runConsumer(
    consumer,
    dlq,
    async ({ topic, message }) => {
      const event = parseEvent<Payload>(message.value);
      if (!event) return; // unparseable: nothing we can do

      const p = event.payload ?? {};
      const email = typeof p.email === 'string' ? p.email : '';
      if (!email) return; // no recipient on this event (e.g. price-drop fan-out not implemented)

      const msg = render(topic, p);
      if (!msg) return;

      // Kafka is at-least-once: dedupe on eventId so a redelivery or a
      // consumer-group rebalance never sends the same email twice.
      const dedupeKey = `notif:sent:${event.eventId || `${topic}:${message.offset}`}`;
      const first = await redis.set(dedupeKey, '1', 'EX', 7 * 24 * 3600, 'NX');
      if (first !== 'OK') return;

      try {
        await sendEmail(email, msg.subject, msg.html);
      } catch (err) {
        await redis.del(dedupeKey); // allow the retry to send
        throw err;
      }
    },
    {
      partitionsConsumedConcurrently: Number(process.env.KAFKA_PARTITIONS_CONCURRENCY) || 4,
      log: (m, e) => console.error(JSON.stringify({ level: 'error', service: 'notification-service', msg: m, error: String(e) })),
    },
  );

  return { consumer, producer: dlq };
}
