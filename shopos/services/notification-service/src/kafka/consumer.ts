import { Kafka } from 'kafkajs';
import { sendEmail } from '../services/emailService';

const kafka = new Kafka({
  clientId: 'notification-service',
  brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
});

const consumer = kafka.consumer({ groupId: 'notification-group' });

function parsePayload(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    if (parsed.payload && typeof parsed.payload === 'object') {
      return parsed.payload as Record<string, unknown>;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

export const startConsumer = async () => {
  await consumer.connect();
  console.log('Kafka Consumer connected');

  const topics = [
    'user.registered',
    'order.confirmed',
    'order.shipped',
    'payment.failed',
    'product.price_dropped',
    'review.submitted',
  ];

  for (const topic of topics) {
    await consumer.subscribe({ topic, fromBeginning: false });
  }

  await consumer.run({
    eachMessage: async ({ topic, message }) => {
      const payload = parsePayload(message.value?.toString() || '{}');
      console.log(`Notification event ${topic}:`, payload);

      const email = (payload.email as string) || 'dev@shopos.local';

      if (topic === 'user.registered') {
        await sendEmail(email, 'Welcome to ShopOS!', `<p>Welcome to ShopOS!</p>`);
      } else if (topic === 'order.confirmed') {
        await sendEmail(
          email,
          'Order Confirmed',
          `<p>Your order ${payload.orderId ?? ''} has been confirmed.</p>`,
        );
      } else if (topic === 'order.shipped') {
        await sendEmail(email, 'Order Shipped', `<p>Your order is on the way.</p>`);
      } else if (topic === 'payment.failed') {
        await sendEmail(email, 'Payment Failed', `<p>Please retry your payment.</p>`);
      } else if (topic === 'product.price_dropped') {
        await sendEmail(email, 'Price Drop Alert', `<p>A wishlist item dropped in price.</p>`);
      } else if (topic === 'review.submitted') {
        console.log('Review notification queued for seller', payload.productId);
      }
    },
  });
};
