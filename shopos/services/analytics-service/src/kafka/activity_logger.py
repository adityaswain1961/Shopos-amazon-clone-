import os
import json
import threading
from confluent_kafka import Consumer, KafkaError

class ActivityLogger(threading.Thread):
    def __init__(self):
        super().__init__()
        broker = os.getenv("KAFKA_BROKERS", "localhost:9092")
        self.consumer = Consumer({
            'bootstrap.servers': broker,
            'group.id': 'analytics-logger-group',
            'auto.offset.reset': 'earliest'
        })
        self.running = True

    def run(self):
        self.consumer.subscribe(['order.confirmed', 'user.viewed_item'])
        print("Analytics Service: Listening to Kafka for activity logging...")

        try:
            while self.running:
                msg = self.consumer.poll(1.0)
                if msg is None:
                    continue
                if msg.error():
                    if msg.error().code() == KafkaError._PARTITION_EOF:
                        continue
                    else:
                        print(f"Consumer error: {msg.error()}")
                        break

                try:
                    payload = json.loads(msg.value().decode('utf-8'))
                    topic = msg.topic()
                    print(f"[Analytics] Aggregating event: {topic}")
                    
                    # In a real app, write this to a PostgreSQL timescale DB or Redis time-series
                    # e.g., INSERT INTO daily_metrics (metric_type, count) VALUES ('orders', 1)
                except Exception as e:
                    print(f"Error processing message: {e}")

        except Exception as e:
             print(f"Kafka error: {e}")
        finally:
            self.consumer.close()

    def stop(self):
        self.running = False
