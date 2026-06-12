import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { startConsumer } from './kafka/consumer';

const app = express();
const PORT = Number(process.env.PORT) || 3013;

app.use(helmet());
app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ success: true, data: { status: 'ok', service: 'notification-service' } });
});

app.get('/api/v1/notifications', (_req, res) => {
  res.json({ success: true, data: [], error: null });
});

app.patch('/api/v1/notifications/read-all', (_req, res) => {
  res.json({ success: true, data: null, error: null });
});

const startServer = async () => {
  try {
    await startConsumer();
    app.listen(PORT, () => {
      console.log(`Notification Service running on port ${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start notification service:', error);
    process.exit(1);
  }
};

startServer();
