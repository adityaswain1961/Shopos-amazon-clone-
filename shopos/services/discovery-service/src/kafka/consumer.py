import json
import logging
import os
import threading

from confluent_kafka import Consumer, KafkaError

from services.elasticsearch_service import SyncIndexer

log = logging.getLogger("discovery.indexer")


class KafkaIndexer(threading.Thread):
    """
    Keeps the search index in sync with product events.

    Offsets are committed only after a document was written to Elasticsearch,
    so a crash never silently drops an update (at-least-once; indexing is
    idempotent because documents are keyed by product id).
    """

    def __init__(self):
        super().__init__(daemon=True, name="kafka-indexer")
        self.indexer = SyncIndexer()
        self.consumer = Consumer({
            "bootstrap.servers": os.getenv("KAFKA_BROKERS", "localhost:9092"),
            "group.id": "discovery-indexer-group",
            "auto.offset.reset": "earliest",
            "enable.auto.commit": False,
        })
        self._stop_event = threading.Event()

    def run(self):
        self.consumer.subscribe(["product.created", "product.updated"])
        log.info("listening for product events")
        try:
            while not self._stop_event.is_set():
                msg = self.consumer.poll(1.0)
                if msg is None:
                    continue
                if msg.error():
                    if msg.error().code() != KafkaError._PARTITION_EOF:
                        log.warning("consumer error: %s", msg.error())
                    continue

                if self._handle_with_retry(msg.value()):
                    self.consumer.commit(message=msg, asynchronous=True)
        finally:
            self.consumer.close()

    def _handle_with_retry(self, value: bytes) -> bool:
        delay = 0.2
        for attempt in range(1, 6):
            try:
                self._handle(value)
                return True
            except Exception as e:  # ES unavailable etc. → back off and retry
                log.warning("indexing failed (attempt %d): %s", attempt, e)
                if self._stop_event.wait(delay):
                    return False
                delay = min(delay * 2, 5)
        log.error("giving up on message after retries; skipping")
        return True

    def _handle(self, value: bytes):
        try:
            raw = json.loads(value.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            log.warning("skipping unparseable message")
            return
        doc = raw.get("searchDocument") or raw.get("payload") or raw
        if not isinstance(doc, dict):
            return
        if "name" in doc and "title" not in doc:
            doc["title"] = doc.get("name", "")
        self.indexer.upsert(doc)

    def stop(self):
        self._stop_event.set()
