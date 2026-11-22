import logging
import os

from elasticsearch import AsyncElasticsearch, Elasticsearch, NotFoundError

log = logging.getLogger("discovery.es")

INDEX = os.getenv("ES_INDEX", "products")
ES_URL = os.getenv("ELASTICSEARCH_URL", "http://localhost:9200")

# Explicit mapping: dynamic mapping turns ids/status into analysed text fields,
# which makes filters slower and sorting impossible.
INDEX_BODY = {
    "settings": {
        "number_of_shards": int(os.getenv("ES_SHARDS", "1")),
        "number_of_replicas": int(os.getenv("ES_REPLICAS", "0")),
        "refresh_interval": "5s",  # near-real-time is plenty for a catalog; cheaper than 1s
    },
    "mappings": {
        "dynamic": False,
        "properties": {
            "id": {"type": "keyword"},
            "title": {"type": "text", "fields": {"raw": {"type": "keyword", "ignore_above": 256}}},
            "slug": {"type": "keyword"},
            "description": {"type": "text"},
            "tags": {"type": "keyword"},
            "brand": {"type": "keyword"},
            "status": {"type": "keyword"},
            "categoryId": {"type": "keyword"},
            "price": {"type": "scaled_float", "scaling_factor": 100},
            "currency": {"type": "keyword"},
            "createdAt": {"type": "date"},
        },
    },
}

PUBLIC_FIELDS = ["id", "title", "slug", "price", "currency", "tags", "categoryId", "description"]


def _client_kwargs():
    return {"request_timeout": 2, "max_retries": 2, "retry_on_timeout": True}


class AsyncSearch:
    """Read path: async client shared by all requests in a worker."""

    def __init__(self):
        self.es = AsyncElasticsearch(ES_URL, **_client_kwargs())

    async def ensure_index(self):
        try:
            if not await self.es.indices.exists(index=INDEX):
                await self.es.indices.create(index=INDEX, **INDEX_BODY)
                log.info("created index %s", INDEX)
        except Exception as e:  # another worker may have created it concurrently
            log.warning("ensure_index: %s", e)

    async def ping(self) -> bool:
        try:
            return bool(await self.es.ping())
        except Exception:
            return False

    async def search(self, query: str, limit: int, offset: int, category_id: str | None):
        filters = [{"term": {"status": "published"}}]
        if category_id:
            filters.append({"term": {"categoryId": category_id}})
        body = {
            "query": {
                "bool": {
                    "must": {
                        "multi_match": {
                            "query": query,
                            "fields": ["title^3", "tags^2", "brand^2", "description"],
                            "fuzziness": "AUTO",
                            "prefix_length": 1,  # big speed win for fuzzy queries
                        }
                    },
                    "filter": filters,
                }
            },
            "_source": PUBLIC_FIELDS,
            "from": offset,
            "size": limit,
            "track_total_hits": 1000,  # exact counts beyond this are expensive and useless for UI
        }
        resp = await self.es.search(index=INDEX, body=body)
        hits = resp.get("hits", {})
        total = hits.get("total", {}).get("value", 0)
        return [h["_source"] for h in hits.get("hits", [])], total

    async def recommend(self, product_id: str | None, limit: int):
        if product_id:
            query = {
                "bool": {
                    "must": {
                        "more_like_this": {
                            "fields": ["title", "tags", "description"],
                            "like": [{"_index": INDEX, "_id": product_id}],
                            "min_term_freq": 1,
                            "min_doc_freq": 1,
                        }
                    },
                    "filter": [{"term": {"status": "published"}}],
                }
            }
            sort = None
        else:
            query = {"bool": {"filter": [{"term": {"status": "published"}}]}}
            sort = [{"createdAt": {"order": "desc", "unmapped_type": "date"}}]
        body = {"query": query, "_source": PUBLIC_FIELDS, "size": limit}
        if sort:
            body["sort"] = sort
        resp = await self.es.search(index=INDEX, body=body)
        return [h["_source"] for h in resp.get("hits", {}).get("hits", [])]

    async def close(self):
        await self.es.close()


class SyncIndexer:
    """Write path, used from the Kafka consumer thread."""

    def __init__(self):
        self.es = Elasticsearch(ES_URL, **_client_kwargs())

    def upsert(self, doc: dict):
        product_id = doc.get("id")
        if not product_id:
            return
        # Only published products are searchable; anything else is removed.
        if doc.get("status") != "published":
            self.delete(product_id)
            return
        self.es.index(index=INDEX, id=product_id, document={k: v for k, v in doc.items() if v is not None})

    def delete(self, product_id: str):
        try:
            self.es.delete(index=INDEX, id=product_id)
        except NotFoundError:
            pass
