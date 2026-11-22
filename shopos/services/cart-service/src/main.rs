use axum::{
    extract::State,
    http::StatusCode,
    response::IntoResponse,
    routing::{delete, get, post},
    Json, Router,
};
use redis::aio::ConnectionManager;
use serde_json::json;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::net::TcpListener;

mod handlers;

pub struct AppState {
    /// Cheap to clone; all clones share one multiplexed connection that
    /// reconnects automatically. Never open a connection per request.
    pub redis: ConnectionManager,
    pub shutting_down: AtomicBool,
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt().with_target(false).init();

    let redis_url = std::env::var("REDIS_URL").unwrap_or_else(|_| "redis://127.0.0.1:6379".to_string());
    let client = match redis::Client::open(redis_url) {
        Ok(c) => c,
        Err(e) => {
            tracing::error!(error = %e, "invalid REDIS_URL");
            std::process::exit(1);
        }
    };

    // Wait for Redis instead of crashing (compose/k8s start order is not guaranteed).
    let manager = loop {
        match client.get_connection_manager().await {
            Ok(m) => break m,
            Err(e) => {
                tracing::warn!(error = %e, "redis not ready, retrying in 2s");
                tokio::time::sleep(Duration::from_secs(2)).await;
            }
        }
    };

    let state = Arc::new(AppState { redis: manager, shutting_down: AtomicBool::new(false) });

    let app = Router::new()
        .route("/health", get(health))
        .route("/ready", get(ready))
        .route(
            "/api/v1/cart/:cart_id",
            get(handlers::cart_handlers::get_cart).delete(handlers::cart_handlers::clear_cart),
        )
        .route("/api/v1/cart/:cart_id/items", post(handlers::cart_handlers::upsert_item))
        .route("/api/v1/cart/:cart_id/items/:item_id", delete(handlers::cart_handlers::remove_item))
        .with_state(state.clone());

    let port = std::env::var("PORT").unwrap_or_else(|_| "3006".to_string());
    let addr = format!("0.0.0.0:{}", port);
    let listener = match TcpListener::bind(&addr).await {
        Ok(l) => l,
        Err(e) => {
            tracing::error!(error = %e, %addr, "failed to bind");
            std::process::exit(1);
        }
    };

    tracing::info!("cart-service listening on {}", addr);
    if let Err(e) = axum::serve(listener, app).with_graceful_shutdown(shutdown_signal(state)).await {
        tracing::error!(error = %e, "server error");
    }
}

async fn health() -> impl IntoResponse {
    Json(json!({"success": true, "data": {"status": "ok", "service": "cart-service"}, "error": null}))
}

async fn ready(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    if state.shutting_down.load(Ordering::SeqCst) {
        return (StatusCode::SERVICE_UNAVAILABLE, Json(json!({"ready": false, "reason": "shutting_down"})));
    }
    let mut con = state.redis.clone();
    let ping: redis::RedisResult<String> = redis::cmd("PING").query_async(&mut con).await;
    match ping {
        Ok(_) => (StatusCode::OK, Json(json!({"ready": true, "service": "cart-service"}))),
        Err(_) => (StatusCode::SERVICE_UNAVAILABLE, Json(json!({"ready": false, "service": "cart-service"}))),
    }
}

/// On SIGTERM: report not-ready, give the load balancer time to stop routing
/// to this pod, then let axum finish in-flight requests.
async fn shutdown_signal(state: Arc<AppState>) {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };

    #[cfg(unix)]
    let terminate = async {
        if let Ok(mut sig) = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            sig.recv().await;
        }
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }

    state.shutting_down.store(true, Ordering::SeqCst);
    let drain = std::env::var("SHUTDOWN_DRAIN_SECONDS").ok().and_then(|v| v.parse().ok()).unwrap_or(5);
    tracing::info!("shutdown signal received; draining for {}s", drain);
    tokio::time::sleep(Duration::from_secs(drain)).await;
}
