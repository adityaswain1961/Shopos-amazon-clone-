import os
from elasticsearch import Elasticsearch

class ElasticsearchService:
    def __init__(self):
        es_url = os.getenv("ELASTICSEARCH_URL", "http://localhost:9200")
        self.es = Elasticsearch([es_url])
        self.index_name = "products"

    def search_products(self, query: str, limit: int = 10):
        if not query:
            return {"hits": []}

        body = {
            "query": {
                "multi_match": {
                    "query": query,
                    "fields": ["title^3", "description", "tags", "brand"],
                    "fuzziness": "AUTO"
                }
            },
            "size": limit
        }

        try:
            response = self.es.search(index=self.index_name, body=body)
            hits = response.get("hits", {}).get("hits", [])
            return [hit["_source"] for hit in hits]
        except Exception as e:
            print(f"Elasticsearch search error: {e}")
            return []

    def index_product(self, product_data: dict):
        try:
            product_id = product_data.get("id")
            if product_id:
                self.es.index(index=self.index_name, id=product_id, document=product_data)
                print(f"Indexed product {product_id} to Elasticsearch.")
        except Exception as e:
            print(f"Elasticsearch indexing error: {e}")
