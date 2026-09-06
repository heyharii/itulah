use inventory_backend::cloud::application::sync as sync_agent;
use inventory_backend::cloud::{http, postgres, AppConfig, AppError, AppState};
use sqlx::postgres::PgPoolOptions;
use std::sync::Arc;
use tokio::net::TcpListener;
use tracing::info;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

#[tokio::main]
async fn main() -> Result<(), AppError> {
    dotenvy::dotenv().ok();
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "inventory_backend=info,tower_http=info".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();
    let config = AppConfig::from_env()?;
    let pool = PgPoolOptions::new()
        .max_connections(20)
        .connect(&config.database_url)
        .await?;
    postgres::MIGRATOR.run(&pool).await?;
    // Durable sync identity: origin id + generation live in the node's own
    // database, not in the process environment, so a restart cannot change
    // what stream this node's facts belong to.
    postgres::provision_origin(
        &pool,
        &config.node_id,
        config.sync_generation,
        config.sync_enqueue_enabled,
    )
    .await?;
    // First-boot admin account (no-op once users exist); also warns loudly
    // when the node is running without authentication.
    postgres::bootstrap_admin(
        &pool,
        config.bootstrap_admin_password.as_deref(),
        config.jwt_secret.is_some(),
    )
    .await?;
    let bind_addr = config.bind_addr;
    let node_id = config.node_id.clone();
    let node_role = config.node_role.clone();
    let state = AppState::new(pool, config);
    tokio::spawn(run_auth_policy_refresh_agent(state.db.clone()));
    tokio::spawn(run_catalog_publisher(state.db.clone()));
    tokio::spawn(run_asset_month_end_agent(state.db.clone()));
    if state.config.sync_apply_enabled {
        tokio::spawn(sync_agent::run_apply_agent(state.clone()));
    }
    if let Some(url) = state.config.sync_upload_url.clone() {
        let transport = sync_agent::HttpTransport::new(&url, state.config.sync_upload_key.clone())?;
        tokio::spawn(sync_agent::run_sync_agent(
            state.clone(),
            Arc::new(transport),
        ));
    }
    let app = http::router(state);
    let listener = TcpListener::bind(bind_addr)
        .await
        .map_err(|e| AppError::Configuration(format!("cannot bind {bind_addr}: {e}")))?;
    info!(%bind_addr,%node_id,%node_role,"inventory edge node started");
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await
        .map_err(|e| AppError::Configuration(format!("server failure: {e}")))
}

/// Keep the fleet's product list up to date.
///
/// Every few minutes rather than on every change, because "the products
/// changed" has no single moment — a setup mints SKUs, so could an import or a
/// correction — and a catalogue goes out as a whole snapshot to every node.
/// Publishing per change would send a hundred commands to thirty shops for one
/// new shirt; publishing on a timer sends nothing at all when nothing changed.
///
/// A few minutes of delay costs a shop nothing it can feel: the till prices
/// from the price book, not from this list, so a garment that arrives before
/// its name does can still be sold. What waits is the catalogue screen.
async fn run_catalog_publisher(pool: sqlx::PgPool) {
    let mut interval = tokio::time::interval(std::time::Duration::from_secs(5 * 60));
    loop {
        interval.tick().await;
        match postgres::publish_catalog_if_changed(&pool, "system:catalog-publisher").await {
            Ok(Some(generation)) => {
                info!(%generation, "published a new product list to the fleet");
            }
            Ok(None) => {}
            Err(error) => tracing::error!(%error, "failed to publish the product list"),
        }
    }
}

/// Charge last month's depreciation and replacement reserve, without being
/// asked.
///
/// # Why this exists at all
///
/// The arithmetic and the endpoint have been here since 0070 and 0083, and
/// nothing has ever called them except a person opening a screen and the seed
/// script running four months once. A month nobody charges looks exactly like a
/// month in which nothing was due — there is no row either way — so the failure
/// is silent, and it surfaces as a profit and loss with no depreciation in it or
/// as a disposal refused four months later because the run "still owes a
/// charge".
///
/// # Why hourly, and why it charges the month that just ended
///
/// Hourly because the run is cheap when there is nothing to do — one query
/// against the register — and because a node restarted on the 1st should not
/// wait a day. The month charged is always the PREVIOUS one: charging the month
/// in progress would post a full month of depreciation on the 3rd.
///
/// The run is idempotent by construction, so twenty-four attempts a day post
/// exactly one month's charge. That is the property that makes a schedule this
/// crude safe, and it is not incidental — it is the unique index on (asset,
/// month) and the one on (class, location, month) doing their job.
///
/// # What it will not do
///
/// It never opens a period and never posts into a closed one: the trigger on
/// the journal refuses that, and the refusal is recorded in the run log rather
/// than retried. A month somebody closed without charging it is a decision, and
/// this is not the thing that should quietly undo it.
async fn run_asset_month_end_agent(pool: sqlx::PgPool) {
    let mut interval = tokio::time::interval(std::time::Duration::from_secs(60 * 60));
    loop {
        interval.tick().await;
        let Some(previous) = chrono::Utc::now()
            .date_naive()
            .checked_sub_months(chrono::Months::new(1))
        else {
            continue;
        };
        let (year, month) = (chrono::Datelike::year(&previous), chrono::Datelike::month(&previous));

        // Asked before anything is posted, so an ordinary hour of an ordinary
        // day costs one query and writes no run row. Without this the log would
        // fill with twenty-four "nothing was due" rows a day and the one row
        // that mattered would be unfindable.
        match postgres::asset_depreciation_status(&pool, year, month).await {
            Ok(status) if status.complete => {}
            Ok(status) if status.period_status.as_deref() == Some("CLOSED") => {
                tracing::warn!(
                    %year, %month, missing = status.missing.len(),
                    "the month is closed and still owes depreciation; it needs reopening or a \
                     correction, and this agent will not decide which"
                );
            }
            Ok(_) => {
                match postgres::asset_depreciation_run_month(
                    &pool,
                    year,
                    month,
                    "system:month-end",
                )
                .await
                {
                    Ok(run) => info!(
                        %year, %month, posted = run.posted_count, total = run.posted_total_minor,
                        "charged a month of depreciation"
                    ),
                    Err(error) => {
                        tracing::error!(%year,%month,%error,"could not charge the month")
                    }
                }
            }
            Err(error) => tracing::error!(%year,%month,%error,"could not read the month's status"),
        }

        match postgres::asset_reserve_status(&pool, year, month).await {
            Ok(status) if status.complete => {}
            Ok(_) => match postgres::asset_reserve_charge(&pool, year, month, "system:month-end")
                .await
            {
                Ok(run) => info!(
                    %year, %month, posted = run.posted_count, total = run.posted_total_minor,
                    "charged a month of replacement reserve"
                ),
                Err(error) => {
                    tracing::error!(%year,%month,%error,"could not charge the replacement reserve")
                }
            },
            Err(error) => {
                tracing::error!(%year,%month,%error,"could not read the reserve's status")
            }
        }
    }
}

async fn run_auth_policy_refresh_agent(pool: sqlx::PgPool) {
    let mut interval = tokio::time::interval(std::time::Duration::from_secs(6 * 60 * 60));
    loop {
        interval.tick().await;
        match postgres::due_auth_policy_origins(&pool).await {
            Ok(origins) => {
                for origin_id in origins {
                    if let Err(error) = postgres::publish_auth_policy(
                        &pool,
                        &origin_id,
                        "system:auth-lease-renewal",
                    )
                    .await
                    {
                        tracing::error!(%origin_id,%error,"failed to refresh Edge auth policy");
                    }
                }
            }
            Err(error) => tracing::error!(%error,"failed to inspect Edge auth policy leases"),
        }
    }
}

async fn shutdown_signal() {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };
    #[cfg(unix)]
    let terminate = async {
        if let Ok(mut signal) =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        {
            signal.recv().await;
        }
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();
    tokio::select! { _ = ctrl_c => {}, _ = terminate => {} }
}
