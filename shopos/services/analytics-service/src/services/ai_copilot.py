import json
import logging
import os

from openai import OpenAI

log = logging.getLogger("analytics.ai")

ADMIN_PROMPT = (
    "You are the ShopOS admin analytics copilot. Answer concisely using ONLY the JSON "
    "metrics provided. If the data does not contain the answer, say so."
)
SUPPORT_PROMPT = (
    "You are the ShopOS customer support assistant. Help with orders, delivery, returns and "
    "payments in general terms. You have no access to internal business data or other "
    "customers' information; never invent order details. For account-specific problems, "
    "direct the customer to their Orders page or human support."
)


class AICopilot:
    """
    Works with any OpenAI-compatible endpoint, so you can pick the cheapest:
      - OpenAI:            OPENAI_API_KEY=...                (AI_MODEL default gpt-4o-mini)
      - other providers:   OPENAI_BASE_URL=https://.../v1 + OPENAI_API_KEY
      - self-hosted, $0:   OPENAI_BASE_URL=http://ollama:11434/v1  AI_MODEL=llama3.1:8b
    With nothing configured it answers from a deterministic template (no API cost).
    """

    def __init__(self):
        api_key = os.getenv("OPENAI_API_KEY", "")
        base_url = os.getenv("OPENAI_BASE_URL") or None
        self.model = os.getenv("AI_MODEL", "gpt-4o-mini")
        self.max_tokens = int(os.getenv("AI_MAX_TOKENS", "250"))
        self.client = (
            OpenAI(api_key=api_key or "not-needed", base_url=base_url, timeout=15, max_retries=1)
            if (api_key or base_url)
            else None
        )

    def _complete(self, system: str, user: str) -> str | None:
        if not self.client:
            return None
        try:
            resp = self.client.chat.completions.create(
                model=self.model,
                messages=[{"role": "system", "content": system}, {"role": "user", "content": user[:2000]}],
                max_tokens=self.max_tokens,
                temperature=0.2,
            )
            return resp.choices[0].message.content
        except Exception as e:
            log.warning("LLM call failed: %s", e)
            return None

    def ask_admin(self, question: str, metrics: dict) -> dict:
        answer = self._complete(f"{ADMIN_PROMPT}\nMetrics: {json.dumps(metrics, default=str)}", question)
        if answer is None:
            answer = (
                f"Today: {metrics.get('orders_confirmed_today', 0)} confirmed orders, "
                f"revenue {metrics.get('revenue_today', 0):.2f}, "
                f"{metrics.get('unique_buyers_today', 0)} unique buyers."
            )
        return {"answer": answer, "data": metrics}

    def ask_support(self, question: str) -> str:
        answer = self._complete(SUPPORT_PROMPT, question)
        return answer or (
            "Thanks for reaching out! You can track, cancel or return orders from Account → Orders. "
            "If something looks wrong with a payment, it is refunded automatically within 5-7 business days."
        )
