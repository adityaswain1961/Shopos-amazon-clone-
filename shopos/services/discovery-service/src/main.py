import logging
import os
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI, Query, Response
from fastapi.responses import JSONResponse

from kafka.consumer import KafkaIndexer
from services.elasticsearch_service import AsyncSearch

load_dotenv()
logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"), format='{"level":"%(levelname)s","logger":"%(name)s","msg":"%(message)s"}')
log = logging.getLogger("discovery")

# Short CDN/gateway caching: popular queries ("iphone", "shoes") are served
# from cache instead of hitting Elasticsearch thousands of times per second.
SEARCH_CACHE = "public, max-age=30, s-maxage=60, stale-while-revalidate=300"

search = AsyncSearch()
indexer: KafkaIndexer | None = None
shutting_down = False


@asynccontextmanager
async def lifespan(_app: FastAPI):
    global indexer, shutting_down
    await search.ensure_index()
    if os.getenv("DISABLE_INDEXER") != "true":
        indexer = KafkaIndexer()
        indexer.start()
    yield
    shutting_down = True
    if indexer:
        indexer.stop()
        indexer.join(timeout=10)
    await search.close()


app = FastAPI(title="ShopOS Discovery Service", lifespan=lifespan, docs_url=None, redoc_url=None)


def ok(data, meta=None):
    body = {"success": True, "data": data, "error": None}
    if meta:
        body["meta"] = meta
    return body


@app.get("/health")
async def health():
    return ok({"status": "ok", "service": "discovery-service"})


@app.get("/ready")
async def ready():
    if shutting_down or not await search.ping():
        return JSONResponse({"ready": False, "service": "discovery-service"}, status_code=503)
    return {"ready": True, "service": "discovery-service"}


@app.get("/api/v1/search")
async def search_products(
    response: Response,
    q: str = Query(..., min_length=1, max_length=200),
    limit: int = Query(20, ge=1, le=50),
    offset: int = Query(0, ge=0, le=1000),  # deep paging is expensive in ES; cap it
    category_id: str | None = Query(None, max_length=64),
):
    try:
        results, total = await search.search(q.strip(), limit, offset, category_id)
    except Exception as e:
        log.warning("search failed: %s", e)
        return JSONResponse({"success": False, "data": [], "error": "Search is temporarily unavailable"}, status_code=503)
    response.headers["Cache-Control"] = SEARCH_CACHE
    return ok(results, {"total": total, "query": q, "limit": limit, "offset": offset})


@app.get("/api/v1/recommendations")
async def recommendations(
    response: Response,
    product_id: str | None = Query(None, max_length=64),
    limit: int = Query(8, ge=1, le=24),
):
    """
    "Similar items" when a product_id is given, otherwise newest arrivals.
    (Personalised recommendations need a behaviour pipeline; not implemented.)
    """
    try:
        results = await search.recommend(product_id, limit)
    except Exception as e:
        log.warning("recommendations failed: %s", e)
        results = []
    response.headers["Cache-Control"] = SEARCH_CACHE
    return ok(results)
