use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use redis::AsyncCommands;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Arc;

use crate::AppState;

/// Guest carts live for 30 days of inactivity (TTL is refreshed on every write).
const CART_TTL_SECS: i64 = 60 * 60 * 24 * 30;
/// Bound per-cart memory and work: a cart is a Redis hash with at most this many fields.
const MAX_LINES: usize = 100;
const MAX_QTY: i32 = 99;

#[derive(Serialize, Deserialize, Clone)]
pub struct CartItem {
    pub product_id: String,
    #[serde(default = "default_variant")]
    pub variant_id: String,
    pub quantity: i32,
    /// Display-only hint for the UI. NEVER used for charging: the order
    /// service prices every order from the catalog on the server.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unit_price: Option<f64>,
}

fn default_variant() -> String {
    "default".to_string()
}

pub enum ApiError {
    BadRequest(String),
    Unavailable,
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, msg) = match self {
            ApiError::BadRequest(m) => (StatusCode::BAD_REQUEST, m),
            ApiError::Unavailable => (StatusCode::SERVICE_UNAVAILABLE, "cart storage unavailable".to_string()),
        };
        (status, Json(json!({"success": false, "data": null, "error": msg}))).into_response()
    }
}

impl From<redis::RedisError> for ApiError {
    fn from(e: redis::RedisError) -> Self {
        tracing::warn!(error = %e, "redis error");
        ApiError::Unavailable
    }
}

/// The cart id is an unguessable UUID the browser generates and keeps; it acts
/// as the bearer credential for a guest cart, so it must be a real UUID.
fn cart_key(cart_id: &str) -> Result<String, ApiError> {
    uuid::Uuid::parse_str(cart_id)
        .map(|u| format!("cart:{}", u.hyphenated()))
        .map_err(|_| ApiError::BadRequest("cart id must be a UUID".to_string()))
}

fn valid_id(s: &str) -> bool {
    !s.is_empty() && s.len() <= 64 && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn validate_item(item: &CartItem) -> Result<(), ApiError> {
    if !valid_id(&item.product_id) || !valid_id(&item.variant_id) {
        return Err(ApiError::BadRequest("invalid product_id or variant_id".to_string()));
    }
    if item.quantity < 1 || item.quantity > MAX_QTY {
        return Err(ApiError::BadRequest(format!("quantity must be between 1 and {}", MAX_QTY)));
    }
    if let Some(p) = item.unit_price {
        if !p.is_finite() || p < 0.0 {
            return Err(ApiError::BadRequest("invalid unit_price".to_string()));
        }
    }
    Ok(())
}

pub async fn get_cart(
    State(state): State<Arc<AppState>>,
    Path(cart_id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let key = cart_key(&cart_id)?;
    let mut con = state.redis.clone();
    let map: HashMap<String, String> = con.hgetall(&key).await?;

    let mut items: Vec<CartItem> = map.values().filter_map(|v| serde_json::from_str(v).ok()).collect();
    items.sort_by(|a, b| a.product_id.cmp(&b.product_id).then(a.variant_id.cmp(&b.variant_id)));

    Ok(Json(json!({"success": true, "error": null, "data": {"cart_id": cart_id, "items": items}})))
}

/// Set the quantity of one line (idempotent upsert).
pub async fn upsert_item(
    State(state): State<Arc<AppState>>,
    Path(cart_id): Path<String>,
    Json(item): Json<CartItem>,
) -> Result<Json<Value>, ApiError> {
    let key = cart_key(&cart_id)?;
    validate_item(&item)?;
    let field = format!("{}:{}", item.product_id, item.variant_id);
    let mut con = state.redis.clone();

    let exists: bool = con.hexists(&key, &field).await?;
    if !exists {
        let len: usize = con.hlen(&key).await?;
        if len >= MAX_LINES {
            return Err(ApiError::BadRequest(format!("a cart can hold at most {} different items", MAX_LINES)));
        }
    }

    let value = serde_json::to_string(&item).map_err(|_| ApiError::BadRequest("invalid item".to_string()))?;
    // HSET + EXPIRE in one round trip, applied atomically.
    let _: () = redis::pipe()
        .atomic()
        .cmd("HSET").arg(&key).arg(&field).arg(value).ignore()
        .cmd("EXPIRE").arg(&key).arg(CART_TTL_SECS).ignore()
        .query_async(&mut con)
        .await?;

    Ok(Json(json!({"success": true, "error": null, "data": item})))
}

pub async fn remove_item(
    State(state): State<Arc<AppState>>,
    Path((cart_id, item_id)): Path<(String, String)>,
) -> Result<Json<Value>, ApiError> {
    let key = cart_key(&cart_id)?;
    if item_id.len() > 140 {
        return Err(ApiError::BadRequest("invalid item id".to_string()));
    }
    let mut con = state.redis.clone();
    let removed: i64 = con.hdel(&key, &item_id).await?;
    Ok(Json(json!({"success": true, "error": null, "data": {"removed": removed > 0}})))
}

pub async fn clear_cart(
    State(state): State<Arc<AppState>>,
    Path(cart_id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let key = cart_key(&cart_id)?;
    let mut con = state.redis.clone();
    let _: i64 = con.del(&key).await?;
    Ok(Json(json!({"success": true, "error": null, "data": null})))
}
