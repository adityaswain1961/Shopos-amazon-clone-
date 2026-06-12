import os
from fastapi import FastAPI, Query
from pydantic import BaseModel
from dotenv import load_dotenv

from services.ai_copilot import AICopilot
from kafka.activity_logger import ActivityLogger

load_dotenv()

app = FastAPI(title="ShopOS AI & Analytics Service")
copilot = AICopilot()

# Start background Kafka consumer
logger_thread = ActivityLogger()

@app.on_event("startup")
def startup_event():
    logger_thread.start()

@app.on_event("shutdown")
def shutdown_event():
    logger_thread.stop()
    logger_thread.join()

class AskRequest(BaseModel):
    question: str

@app.get("/health")
def health_check():
    return {"status": "ok", "service": "analytics-service"}

@app.get("/api/v1/analytics/dashboard")
def get_dashboard_metrics():
    # Mock aggregated metrics from the DB
    return {
        "success": True,
        "metrics": {
            "total_sales_today": 15000,
            "orders_today": 120,
            "active_users": 450,
            "conversion_rate": "3.2%"
        }
    }

@app.post("/api/v1/analytics/ask")
def ask_ai_copilot(req: AskRequest):
    result = copilot.ask_data(req.question)
    return {"success": True, "response": result}

# AI Help Service routes (architecture alias)
@app.post("/api/v1/ai-help/sessions")
def start_ai_session():
    return {"success": True, "data": {"sessionId": "sess-mock-001", "status": "active"}}

@app.post("/api/v1/ai-help/sessions/{session_id}/messages")
def send_ai_message(session_id: str, req: AskRequest):
    result = copilot.ask_data(req.question)
    return {"success": True, "data": {"sessionId": session_id, "reply": result, "confidence": 0.85}}

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 3014))
    uvicorn.run(app, host="0.0.0.0", port=port)
