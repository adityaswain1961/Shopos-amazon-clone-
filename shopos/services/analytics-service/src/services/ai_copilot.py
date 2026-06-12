import os
from openai import OpenAI
import json

class AICopilot:
    def __init__(self):
        self.api_key = os.getenv("OPENAI_API_KEY", "mock_key")
        if self.api_key != "mock_key":
            self.client = OpenAI(api_key=self.api_key)
        else:
            self.client = None

    def ask_data(self, question: str) -> dict:
        # Step 1: Mock fetching context from database
        context = {
            "total_sales_today": 15000,
            "orders_today": 120,
            "top_product": "Wireless Headphones",
            "active_users": 450
        }

        # Step 2: Use LLM or mock to generate an answer
        if self.client:
            try:
                system_prompt = f"You are ShopOS Admin Copilot. You analyze e-commerce data. Here is today's data: {json.dumps(context)}. Answer the user's question concisely."
                response = self.client.chat.completions.create(
                    model="gpt-3.5-turbo",
                    messages=[
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": question}
                    ],
                    max_tokens=100
                )
                answer = response.choices[0].message.content
                return {"answer": answer, "data": context}
            except Exception as e:
                print(f"OpenAI Error: {e}")
                return {"answer": "I'm having trouble connecting to OpenAI right now.", "error": str(e)}
        else:
            # Mocked fallback
            print(f"[Mock AI] Question received: {question}")
            mock_answer = f"Based on the data, today's sales are ${context['total_sales_today']} across {context['orders_today']} orders. The top product is {context['top_product']}."
            return {"answer": mock_answer, "data": context}
