import os
from fastapi import FastAPI, Query
from dotenv import load_dotenv

from services.elasticsearch_service import ElasticsearchService
from services.recommendation_service import RecommendationService
from kafka.consumer import KafkaIndexer

load_dotenv()

app = FastAPI(title="ShopOS Discovery & Engagement Service")
es_service = ElasticsearchService()
rec_service = RecommendationService()

# Start background Kafka consumer for indexing
indexer = KafkaIndexer()

@app.on_event("startup")
def startup_event():
    indexer.start()

@app.on_event("shutdown")
def shutdown_event():
    indexer.stop()
    indexer.join()

@app.get("/health")
def health_check():
    return {"status": "ok", "service": "discovery-service"}

@app.get("/api/v1/search")
def search_products(q: str = Query(..., description="Search query"), limit: int = 10):
    results = es_service.search_products(q, limit)
    return {"success": True, "query": q, "results": results}

@app.get("/api/v1/recommendations")
def get_recommendations(user_id: str, limit: int = 5):
    results = rec_service.get_recommendations(user_id, limit)
    return {"success": True, "user_id": user_id, "recommendations": results}

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 3010))
    uvicorn.run(app, host="0.0.0.0", port=port)
