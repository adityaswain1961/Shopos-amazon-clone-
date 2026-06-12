use axum::{
    extract::{Path, State},
    Json,
};
use redis::AsyncCommands;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use crate::AppState;

#[derive(Serialize, Deserialize)]
pub struct CartItem {
    pub product_id: String,
    pub variant_id: String,
    pub quantity: i32,
    pub unit_price: f64,
}

#[derive(Serialize)]
pub struct CartResponse {
    pub cart_id: String,
    pub items: Vec<CartItem>,
}

pub async fn get_cart(
    State(state): State<Arc<AppState>>,
    Path(cart_id): Path<String>,
) -> Json<CartResponse> {
    let mut con = state.redis_client.get_multiplexed_async_connection().await.unwrap();
    let redis_key = format!("cart:{}", cart_id);
    
    // Fetch all fields from the hash
    let items_map: std::collections::HashMap<String, String> = con.hgetall(&redis_key).await.unwrap_or_default();
    
    let mut items = Vec::new();
    for (_, val) in items_map {
        if let Ok(item) = serde_json::from_str::<CartItem>(&val) {
            items.push(item);
        }
    }

    Json(CartResponse { cart_id, items })
}

pub async fn add_item(
    State(state): State<Arc<AppState>>,
    Path(cart_id): Path<String>,
    Json(payload): Json<CartItem>,
) -> Json<serde_json::Value> {
    let mut con = state.redis_client.get_multiplexed_async_connection().await.unwrap();
    let redis_key = format!("cart:{}", cart_id);
    let item_key = format!("{}:{}", payload.product_id, payload.variant_id);
    
    let item_json = serde_json::to_string(&payload).unwrap();
    let _: () = con.hset(&redis_key, item_key, item_json).await.unwrap();
    
    // Set 30 days TTL for guest carts
    let _: () = con.expire(&redis_key, 60 * 60 * 24 * 30).await.unwrap();

    Json(serde_json::json!({"success": true, "message": "Item added to cart"}))
}

pub async fn remove_item(
    State(state): State<Arc<AppState>>,
    Path((cart_id, item_id)): Path<(String, String)>,
) -> Json<serde_json::Value> {
    let mut con = state.redis_client.get_multiplexed_async_connection().await.unwrap();
    let redis_key = format!("cart:{}", cart_id);
    
    let _: () = con.hdel(&redis_key, item_id).await.unwrap();

    Json(serde_json::json!({"success": true, "message": "Item removed from cart"}))
}
