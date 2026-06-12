import random

class RecommendationService:
    def __init__(self):
        # Mock product catalog for fallback logic
        self.mock_catalog = [
            {"id": "prod_1", "title": "Wireless Headphones", "category": "electronics"},
            {"id": "prod_2", "title": "Yoga Mat", "category": "sports"},
            {"id": "prod_3", "title": "Coffee Maker", "category": "home"},
            {"id": "prod_4", "title": "Running Shoes", "category": "sports"},
            {"id": "prod_5", "title": "Mechanical Keyboard", "category": "electronics"}
        ]

    def get_recommendations(self, user_id: str, limit: int = 5):
        # In a real system, this would load user history from Redis/DB and query an ML model
        # (e.g. collaborative filtering or vector similarity search)
        print(f"[Mock ML] Generating recommendations for User {user_id}")
        
        # Shuffle to simulate dynamic personalized results
        results = list(self.mock_catalog)
        random.shuffle(results)
        return results[:limit]
