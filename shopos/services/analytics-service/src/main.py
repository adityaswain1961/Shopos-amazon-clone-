import logging
import os
import threading
import time
import uuid
from collections import defaultdict, deque

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from services import metrics
from services.ai_copilot import AICopilot
from services.auth import current_user, require_staff

load_dotenv()
logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))

app = FastAPI(title="ShopOS Analytics & AI Help", docs_url=None, redoc_url=None)
copilot = AICopilot()

# Per-user LLM budget (per pod). LLM calls are the most expensive thing this
# service does, so cap them before they reach the provider.
AI_MSGS_PER_MINUTE = int(os.getenv("AI_MSGS_PER_MINUTE", "6"))
_ai_calls: dict[str, deque] = defaultdict(deque)
_ai_lock = threading.Lock()


def _allow_ai_call(user_id: str) -> bool:
    now = time.monotonic()
    with _ai_lock:
        calls = _ai_calls[user_id]
        while calls and now - calls[0] > 60:
            calls.popleft()
        if len(calls) >= AI_MSGS_PER_MINUTE:
            return False
        calls.append(now)
        if len(_ai_calls) > 100_000:  # bound memory
            _ai_calls.clear()
        return True


@app.exception_handler(HTTPException)
async def http_error(_request: Request, exc: HTTPException):
    return JSONResponse({"success": False, "data": None, "error": exc.detail}, status_code=exc.status_code)


class AskRequest(BaseModel):
    question: str = Field(min_length=1, max_length=1000)


@app.get("/health")
def health():
    return {"success": True, "data": {"status": "ok", "service": "analytics-service"}, "error": None}


@app.get("/ready")
async def ready():
    ok = await run_in_threadpool(metrics.ping)
    return JSONResponse({"ready": ok, "service": "analytics-service"}, status_code=200 if ok else 503)


# ─── Staff analytics ────────────────────────────────────────────────

@app.get("/api/v1/analytics/dashboard")
def dashboard(_user: dict = Depends(require_staff)):
    return {"success": True, "data": metrics.dashboard_metrics(), "error": None}


@app.post("/api/v1/analytics/ask")
def ask(req: AskRequest, user: dict = Depends(require_staff)):
    if not _allow_ai_call(user["sub"]):
        raise HTTPException(status_code=429, detail="Too many questions, try again in a minute")
    return {"success": True, "data": copilot.ask_admin(req.question, metrics.dashboard_metrics()), "error": None}


# ─── Customer AI help (no business data in context) ────────────────

@app.post("/api/v1/ai-help/sessions")
def start_ai_session(_user: dict = Depends(current_user)):
    return {"success": True, "data": {"sessionId": str(uuid.uuid4()), "status": "active"}, "error": None}


@app.post("/api/v1/ai-help/sessions/{session_id}/messages")
def send_ai_message(session_id: str, req: AskRequest, user: dict = Depends(current_user)):
    if not _allow_ai_call(user["sub"]):
        raise HTTPException(status_code=429, detail="Too many messages, please wait a minute")
    reply = copilot.ask_support(req.question)
    return {"success": True, "data": {"sessionId": session_id[:64], "reply": reply}, "error": None}
