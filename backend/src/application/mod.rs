use crate::domain::{
    AllotmentStatus, AllotmentType, CommercialChannel, CountKind, DestinationType, RfidRead,
};
use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::PgPool;
use std::{env, net::SocketAddr, path::PathBuf, sync::Arc};
use thiserror::Error;
use uuid::Uuid;

#[derive(Clone, Debug)]
pub struct AppConfig {
    pub bind_addr: SocketAddr,
    pub database_url: String,
    pub node_id: String,
    pub node_role: String,
    pub rfid_burst_window_seconds: i64,
    pub observed_window_hours: i64,
    pub lost_risk_window_days: i64,
    pub enable_test_controls: bool,
    pub frontend_dir: PathBuf,
}

impl AppConfig {
    pub fn from_env() -> Result<Self, AppError> {
        let bind_addr = env::var("BIND_ADDR")
            .unwrap_or_else(|_| "127.0.0.1:8080".into())
            .parse()
            .map_err(|e| AppError::Configuration(format!("invalid BIND_ADDR: {e}")))?;
        let database_url = env::var("DATABASE_URL")
            .map_err(|_| AppError::Configuration("DATABASE_URL is required".into()))?;
        let frontend_dir = env::var("FRONTEND_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("../frontend"));
        Ok(Self {
            bind_addr,
            database_url,
            node_id: env::var("INVENTORY_NODE_ID").unwrap_or_else(|_| "cloud-primary".into()),
            node_role: env::var("INVENTORY_NODE_ROLE").unwrap_or_else(|_| "CLOUD".into()),
            rfid_burst_window_seconds: parse_env("RFID_BURST_WINDOW_SECONDS", 10)?,
            observed_window_hours: parse_env("OBSERVED_WINDOW_HOURS", 24)?,
            lost_risk_window_days: parse_env("LOST_RISK_WINDOW_DAYS", 30)?,
            enable_test_controls: env::var("INVENTORY_ENABLE_TEST_CONTROLS")
                .map(|v| v.eq_ignore_ascii_case("true"))
                .unwrap_or(false),
            frontend_dir,
        })
    }
}

fn parse_env(name: &str, default: i64) -> Result<i64, AppError> {
    env::var(name)
        .ok()
        .map(|v| {
            v.parse()
                .map_err(|e| AppError::Configuration(format!("invalid {name}: {e}")))
        })
        .transpose()
        .map(|v| v.unwrap_or(default))
}

#[derive(Clone)]
pub struct AppState {
    pub db: PgPool,
    pub config: Arc<AppConfig>,
}

impl AppState {
    pub fn new(db: PgPool, config: AppConfig) -> Self {
        Self {
            db,
            config: Arc::new(config),
        }
    }
}

#[derive(Debug, Error)]
pub enum AppError {
    #[error("configuration error: {0}")]
    Configuration(String),
    #[error("invalid request: {0}")]
    Validation(String),
    #[error("not found: {0}")]
    NotFound(String),
    #[error("conflict: {0}")]
    Conflict(String),
    #[error("forbidden: {0}")]
    Forbidden(String),
    #[error("database operation failed")]
    Database(#[from] sqlx::Error),
    #[error("database migration failed")]
    Migration(#[from] sqlx::migrate::MigrateError),
    #[error("serialization failed: {0}")]
    Serialization(#[from] serde_json::Error),
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let status = match self {
            Self::Validation(_) => StatusCode::BAD_REQUEST,
            Self::NotFound(_) => StatusCode::NOT_FOUND,
            Self::Conflict(_) => StatusCode::CONFLICT,
            Self::Forbidden(_) => StatusCode::FORBIDDEN,
            Self::Configuration(_)
            | Self::Database(_)
            | Self::Migration(_)
            | Self::Serialization(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };
        let message = self.to_string();
        (status, Json(json!({ "error": message }))).into_response()
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct MovementLineRequest {
    pub subject_id: Option<Uuid>,
    pub epc: Option<String>,
    pub quantity: i64,
    pub from: String,
    pub to: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct CreateMovementRequest {
    pub idempotency_key: String,
    pub actor_id: String,
    pub occurred_at: Option<DateTime<Utc>>,
    pub reason: String,
    pub reference_type: Option<String>,
    pub reference_id: Option<String>,
    pub cause: Option<String>,
    pub lines: Vec<MovementLineRequest>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct CorrectPlacementRequest {
    pub idempotency_key: String,
    pub actor_id: String,
    pub occurred_at: Option<DateTime<Utc>>,
    pub reason: String,
    pub evidence_reference: String,
    pub notes: Option<String>,
    pub line: MovementLineRequest,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct ObservationBatchRequest {
    pub site_id: String,
    pub pool: String,
    pub device_id: String,
    pub reader_session_id: String,
    pub observed_at: DateTime<Utc>,
    pub idempotency_key: String,
    pub observations: Vec<RfidRead>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct CreateCountRequest {
    pub site_id: String,
    pub pool_id: String,
    pub kind: CountKind,
    #[serde(default)]
    pub sku_ids: Vec<Uuid>,
    #[serde(default)]
    pub epcs: Vec<String>,
    pub reason: String,
    pub actor_id: String,
    pub idempotency_key: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct CommandRequest {
    pub actor_id: String,
    pub idempotency_key: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct CountEntryInput {
    pub subject_id: Option<Uuid>,
    pub epc: Option<String>,
    pub found_quantity: i64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct CountEntriesRequest {
    pub actor_id: String,
    pub idempotency_key: String,
    pub entries: Vec<CountEntryInput>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct MissingResolutionRequest {
    pub actor_id: String,
    pub idempotency_key: String,
    pub quantity: Option<i64>,
    pub destination_pool_id: Option<String>,
    pub reason: String,
    pub reference: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct ReplayScope {
    pub site_id: Option<String>,
    pub pool_id: Option<String>,
    pub subject_id: Option<Uuid>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct ReplayRequest {
    #[serde(default)]
    pub scope: ReplayScope,
    pub actor_id: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct RepostRequest {
    #[serde(default)]
    pub scope: ReplayScope,
    pub actor_id: String,
    pub idempotency_key: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct CorruptProjectionRequest {
    pub subject_id: Uuid,
    pub place_id: String,
    pub delta: i64,
}

#[derive(Clone, Debug, Deserialize)]
pub struct PoolQuery {
    pub as_of: Option<DateTime<Utc>>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct MovementQuery {
    pub pool_id: Option<String>,
    pub subject_id: Option<Uuid>,
    pub limit: Option<i64>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct ObservationQuery {
    pub pool_id: Option<String>,
    pub epc: Option<String>,
    pub limit: Option<i64>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct AsOfQuery {
    pub at: DateTime<Utc>,
    pub site_id: Option<String>,
    pub pool_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct CommercialTaxRuleInput {
    pub tax_category: String,
    pub rate_bps: i32,
    pub tax_inclusive: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct CommercialOfferRuleInput {
    pub sku_id: Uuid,
    pub site_id: Option<String>,
    pub channel: CommercialChannel,
    pub sellable: bool,
    pub currency: String,
    pub unit_price_minor: i64,
    pub tax_category: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct CreateCommercialPublicationRequest {
    pub version: i64,
    pub name: String,
    pub effective_from: DateTime<Utc>,
    pub effective_to: Option<DateTime<Utc>>,
    pub tax_rules: Vec<CommercialTaxRuleInput>,
    pub offer_rules: Vec<CommercialOfferRuleInput>,
    pub actor_id: String,
    pub idempotency_key: String,
}

#[derive(Clone, Debug, Deserialize)]
pub struct ResolveOfferQuery {
    pub sku_id: Uuid,
    pub site_id: String,
    pub channel: CommercialChannel,
    pub at: Option<DateTime<Utc>>,
    pub publication_id: Option<Uuid>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct CreateSaleRequest {
    pub site_id: String,
    pub channel: CommercialChannel,
    pub actor_id: String,
    pub idempotency_key: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct AddSaleLineRequest {
    pub epc: String,
    pub quantity: i64,
    pub actor_id: String,
    pub idempotency_key: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct AddSalePaymentRequest {
    pub method: String,
    pub amount_minor: i64,
    pub reference: Option<String>,
    pub actor_id: String,
    pub idempotency_key: String,
}

#[derive(Clone, Debug, Deserialize)]
pub struct SaleQuery {
    pub site_id: Option<String>,
    pub status: Option<String>,
    pub limit: Option<i64>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct OfferListQuery {
    pub site_id: String,
    pub channel: CommercialChannel,
    pub at: Option<DateTime<Utc>>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct CreateAllotmentLineInput {
    pub source_site_id: String,
    pub source_pool_id: String,
    pub destination_type: DestinationType,
    pub destination_id: String,
    pub sku_id: Uuid,
    pub quantity: i64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct CreateAllotmentRequest {
    #[serde(rename = "type")]
    pub allotment_type: AllotmentType,
    pub lines: Vec<CreateAllotmentLineInput>,
    pub notes: Option<String>,
    pub actor_id: String,
    pub idempotency_key: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct CancelAllotmentRequest {
    pub reason: String,
    pub actor_id: String,
    pub idempotency_key: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct ExecuteAllotmentRequest {
    pub allotment_line_id: Uuid,
    pub quantity: i64,
    pub actor_id: String,
    pub idempotency_key: String,
}

#[derive(Clone, Debug, Default, Deserialize)]
pub struct AllotmentQuery {
    #[serde(rename = "type")]
    pub allotment_type: Option<AllotmentType>,
    pub status: Option<AllotmentStatus>,
    pub source_pool_id: Option<String>,
    pub destination_id: Option<String>,
    pub limit: Option<i64>,
}

#[derive(Clone, Debug, Default, Deserialize)]
pub struct AvailabilityQuery {
    pub at: Option<DateTime<Utc>>,
    pub source_pool_id: Option<String>,
}
