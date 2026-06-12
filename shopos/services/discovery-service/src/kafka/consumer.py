import os
import json
import threading
from confluent_kafka import Consumer, KafkaError
from services.elasticsearch_service import ElasticsearchService

class KafkaIndexer(threading.Thread):
    def __init__(self):
        super().__init__()
        self.es_service = ElasticsearchService()
        broker = os.getenv("KAFKA_BROKERS", "localhost:9092")
        self.consumer = Consumer({
            'bootstrap.servers': broker,
            'group.id': 'discovery-indexer-group',
            'auto.offset.reset': 'earliest'
        })
        self.running = True

    def run(self):
        self.consumer.subscribe(['product.created', 'product.updated'])
        print("Discovery Service: Listening to Kafka for product indexing...")

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
                    raw = json.loads(msg.value().decode('utf-8'))
                    doc = raw.get('searchDocument') or raw.get('payload') or raw
                    if isinstance(doc, dict) and 'name' in doc and 'title' not in doc:
                        doc['title'] = doc.get('name', '')
                    print(f"Received event: {msg.topic()} for product {doc.get('id')}")
                    self.es_service.index_product(doc)
                except Exception as e:
                    print(f"Error processing message: {e}")

        except Exception as e:
             print(f"Kafka error: {e}")
        finally:
            self.consumer.close()

    def stop(self):
        self.running = False
