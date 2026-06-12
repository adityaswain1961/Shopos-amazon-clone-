use axum::{
    routing::{get, post, delete},
    Router,
};
use redis::Client;
use std::sync::Arc;
use tokio::net::TcpListener;
use tracing_subscriber;

mod handlers;

pub struct AppState {
    pub redis_client: Client,
}

#[tokio::main]
async fn main() {
    // Initialize tracing
    tracing_subscriber::fmt::init();

    // Setup Redis
    let redis_url = std::env::var("REDIS_URL").unwrap_or_else(|_| "redis://127.0.0.1:6379".to_string());
    let client = Client::open(redis_url).expect("Failed to connect to Redis");
    let state = Arc::new(AppState { redis_client: client });

    // Build Axum Router
    let app = Router::new()
        .route("/health", get(|| async {
            r#"{"success":true,"data":{"status":"ok","service":"cart-service"}}"#
        }))
        .route("/ready", get(|| async {
            r#"{"ready":true,"service":"cart-service"}"#
        }))
        .route("/api/v1/cart/:cart_id", get(handlers::cart_handlers::get_cart))
        .route("/api/v1/cart/:cart_id/items", post(handlers::cart_handlers::add_item))
        .route("/api/v1/cart/:cart_id/items/:item_id", delete(handlers::cart_handlers::remove_item))
        .with_state(state);

    let port = std::env::var("PORT").unwrap_or_else(|_| "3006".to_string());
    let addr = format!("0.0.0.0:{}", port);
    
    tracing::info!(" Cart Service running on {}", addr);
    let listener = TcpListener::bind(&addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
