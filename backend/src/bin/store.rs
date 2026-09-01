use inventory_backend::edge::{
    store_router_with_auth, EdgeAuth, EdgeAuthConfig, EdgeRole, NodeContext, SiteId, SqliteEdge,
};
use std::{env, net::SocketAddr, path::PathBuf, sync::Arc};
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    dotenvy::dotenv().ok();
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();
    let site_id = SiteId::new(env::var("INVENTORY_SITE_ID").unwrap_or_else(|_| "store-07".into()))?;
    let node_id = env::var("INVENTORY_NODE_ID").unwrap_or_else(|_| format!("{site_id}-edge"));
    let node = NodeContext::new(node_id, EdgeRole::Store, site_id)?;
    let generation = inventory_backend::edge::sync::EdgeSyncConfig::generation_from_env()?;
    let database = PathBuf::from(
        env::var("INVENTORY_DATABASE_PATH").unwrap_or_else(|_| "./store-edge.sqlite3".into()),
    );
    let frontend = PathBuf::from(env::var("FRONTEND_DIR").unwrap_or_else(|_| "../frontend".into()));
    let bind: SocketAddr = inventory_backend::bind_addr(8082)?;
    let inventory = Arc::new(SqliteEdge::open(database, node.clone())?);
    let auth = Arc::new(EdgeAuth::new(
        inventory.connection(),
        node,
        EdgeAuthConfig::from_env()?,
    )?);
    inventory.configure_sync_generation(generation)?;
    // Capture is always enabled. The optional sender uploads the durable
    // backlog and receives downstream commands over the shared cycle.
    match inventory_backend::edge::sync::EdgeSyncConfig::from_env()? {
        Some(sync) => inventory_backend::edge::sync::spawn_agent(&inventory, sync)?,
        None => tracing::warn!(
            "SYNC_UPLOAD_URL is unset: capture continues locally and only the sender is disabled"
        ),
    }
    let listener = tokio::net::TcpListener::bind(bind).await?;
    tracing::info!(%bind, "Store Edge running independently with SQLite");
    axum::serve(listener, store_router_with_auth(inventory, auth, frontend)?).await?;
    Ok(())
}
