use crate::cloud::domain::{
    AllotmentStatus, AllotmentType, CommercialChannel, CountKind, DestinationType, PaymentMethod,
    RfidRead, Role,
};
use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::PgPool;
use std::{env, net::SocketAddr, path::PathBuf, sync::Arc};
use thiserror::Error;
use uuid::Uuid;

pub mod sync;

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
    // Ordered edge->cloud sync (see migrations/0006_sync_outbox.sql).
    pub sync_upload_url: Option<String>,
    pub sync_upload_key: Option<String>,
    pub sync_ingest_key: Option<String>,
    pub sync_generation: i64,
    pub sync_enqueue_enabled: bool,
    pub sync_interval_seconds: i64,
    pub sync_batch_limit: i64,
    pub sync_breaker_threshold: u32,
    pub sync_breaker_base_cooldown_seconds: i64,
    pub sync_breaker_max_cooldown_seconds: i64,
    pub sync_retention_days: i64,
    pub sync_degraded_after_seconds: i64,
    /// Drain the receipt log into this node's ledger (the receiving node's
    /// job — defaults on for the CLOUD role).
    pub sync_apply_enabled: bool,
    // Local node authentication. The retained `jwt_secret` field is now only
    // an enabled marker for compatibility with existing callers; sessions are
    // opaque database records and no JWT signing secret is used.
    pub jwt_secret: Option<String>,
    pub auth_token_ttl_minutes: i64,
    pub auth_session_idle_minutes: i64,
    pub auth_cookie_secure: bool,
    pub bootstrap_admin_password: Option<String>,
    /// Comma-separated exact origins; None permits same-origin requests only.
    pub cors_allowed_origins: Option<String>,
}

impl AppConfig {
    pub fn from_env() -> Result<Self, AppError> {
        let bind_addr = crate::bind_addr(8080).map_err(AppError::Configuration)?;
        let database_url = env::var("DATABASE_URL")
            .map_err(|_| AppError::Configuration("DATABASE_URL is required".into()))?;
        let frontend_dir = env::var("FRONTEND_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("../frontend"));
        let node_role = env::var("INVENTORY_NODE_ROLE").unwrap_or_else(|_| "CLOUD".into());
        // Edges enqueue by default; the central node has no upstream to sync to.
        let sync_enqueue_default = !node_role.eq_ignore_ascii_case("CLOUD");
        let sync_apply_default = node_role.eq_ignore_ascii_case("CLOUD");
        let auth_mode = env::var("INVENTORY_AUTH_MODE").unwrap_or_else(|_| "required".into());
        let auth_enabled = match auth_mode.to_ascii_lowercase().as_str() {
            "required" | "enabled" => true,
            "disabled" => false,
            _ => {
                return Err(AppError::Configuration(
                    "INVENTORY_AUTH_MODE must be required or disabled".into(),
                ))
            }
        };
        let sync_ingest_key = env_opt("SYNC_INGEST_KEY");
        if node_role.eq_ignore_ascii_case("CLOUD") && auth_enabled {
            let valid_master = sync_ingest_key
                .as_deref()
                .is_some_and(|key| key.chars().count() >= 32);
            if !valid_master {
                return Err(AppError::Configuration(
                    "authenticated Cloud requires a random SYNC_INGEST_KEY of at least 32 characters"
                        .into(),
                ));
            }
        }
        let auth_token_ttl_minutes = parse_env("INVENTORY_AUTH_TOKEN_TTL_MINUTES", 12 * 60)?;
        if !(1..=7 * 24 * 60).contains(&auth_token_ttl_minutes) {
            return Err(AppError::Configuration(
                "INVENTORY_AUTH_TOKEN_TTL_MINUTES must be between 1 and 10080".into(),
            ));
        }
        let auth_session_idle_minutes = parse_env("INVENTORY_AUTH_SESSION_IDLE_MINUTES", 30)?;
        if !(1..=24 * 60).contains(&auth_session_idle_minutes) {
            return Err(AppError::Configuration(
                "INVENTORY_AUTH_SESSION_IDLE_MINUTES must be between 1 and 1440".into(),
            ));
        }
        Ok(Self {
            bind_addr,
            database_url,
            node_id: env::var("INVENTORY_NODE_ID").unwrap_or_else(|_| "cloud-primary".into()),
            node_role,
            rfid_burst_window_seconds: parse_env("RFID_BURST_WINDOW_SECONDS", 10)?,
            observed_window_hours: parse_env("OBSERVED_WINDOW_HOURS", 24)?,
            lost_risk_window_days: parse_env("LOST_RISK_WINDOW_DAYS", 30)?,
            enable_test_controls: env::var("INVENTORY_ENABLE_TEST_CONTROLS")
                .map(|v| v.eq_ignore_ascii_case("true"))
                .unwrap_or(false),
            frontend_dir,
            sync_upload_url: env_opt("SYNC_UPLOAD_URL"),
            sync_upload_key: env_opt("SYNC_UPLOAD_KEY"),
            sync_ingest_key,
            sync_generation: parse_env("INVENTORY_ORIGIN_GENERATION", 1)?,
            sync_enqueue_enabled: env::var("SYNC_ENQUEUE")
                .map(|v| v.eq_ignore_ascii_case("true"))
                .unwrap_or(sync_enqueue_default),
            sync_interval_seconds: parse_env("SYNC_INTERVAL_SECONDS", 5)?,
            sync_batch_limit: parse_env("SYNC_BATCH_LIMIT", 100)?,
            sync_breaker_threshold: parse_env("SYNC_BREAKER_THRESHOLD", 5)?.clamp(1, 1_000) as u32,
            sync_breaker_base_cooldown_seconds: parse_env(
                "SYNC_BREAKER_BASE_COOLDOWN_SECONDS",
                30,
            )?,
            sync_breaker_max_cooldown_seconds: parse_env("SYNC_BREAKER_MAX_COOLDOWN_SECONDS", 900)?,
            sync_retention_days: parse_env("SYNC_RETENTION_DAYS", 14)?,
            sync_degraded_after_seconds: parse_env("SYNC_DEGRADED_AFTER_SECONDS", 900)?,
            sync_apply_enabled: env::var("SYNC_APPLY")
                .map(|v| v.eq_ignore_ascii_case("true"))
                .unwrap_or(sync_apply_default),
            jwt_secret: auth_enabled.then(|| "opaque-session-auth-enabled".to_string()),
            auth_token_ttl_minutes,
            auth_session_idle_minutes,
            auth_cookie_secure: env::var("INVENTORY_AUTH_COOKIE_SECURE")
                .map(|value| value.eq_ignore_ascii_case("true"))
                .unwrap_or(false),
            bootstrap_admin_password: env_opt("INVENTORY_BOOTSTRAP_ADMIN_PASSWORD"),
            cors_allowed_origins: env_opt("INVENTORY_CORS_ALLOWED_ORIGINS"),
        })
    }
}

fn env_opt(name: &str) -> Option<String> {
    env::var(name)
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
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
    /// Wakes the sync sender outside its interval (`POST /api/v1/sync/trigger`).
    pub sync_wake: Arc<tokio::sync::Notify>,
}

impl AppState {
    pub fn new(db: PgPool, config: AppConfig) -> Self {
        Self {
            db,
            config: Arc::new(config),
            sync_wake: Arc::new(tokio::sync::Notify::new()),
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
    #[error("unauthorized: {0}")]
    Unauthorized(String),
    #[error("database operation failed")]
    Database(#[from] sqlx::Error),
    #[error("database migration failed")]
    Migration(#[from] sqlx::migrate::MigrateError),
    #[error("serialization failed: {0}")]
    Serialization(#[from] serde_json::Error),
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        // Business rules enforced by database triggers surface as RAISE
        // EXCEPTION (SQLSTATE P0001). Those are legitimate conflicts — e.g.
        // "published commercial rules are immutable" — not server faults, so
        // map them to 409 with the trigger's own message instead of a 500.
        if let Self::Database(sqlx::Error::Database(db)) = &self {
            if db.code().as_deref() == Some("P0001") {
                return (StatusCode::CONFLICT, Json(json!({ "error": db.message() })))
                    .into_response();
            }
        }
        let status = match self {
            Self::Validation(_) => StatusCode::BAD_REQUEST,
            Self::NotFound(_) => StatusCode::NOT_FOUND,
            Self::Conflict(_) => StatusCode::CONFLICT,
            Self::Forbidden(_) => StatusCode::FORBIDDEN,
            Self::Unauthorized(_) => StatusCode::UNAUTHORIZED,
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
    /// One shop. At most one of `site_id`, `site_ids` and `tier` may be set —
    /// a price that claims two levels has no single right reading.
    pub site_id: Option<String>,
    /// A named set of shops — a city, a format.
    #[serde(default)]
    pub site_ids: Option<Vec<String>>,
    /// A membership tier.
    #[serde(default)]
    pub tier: Option<String>,
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
    /// Clearance prices that replace the base for the goods they name.
    #[serde(default)]
    pub markdowns: Vec<CommercialMarkdownInput>,
    /// Promotions, authored as the pricing engine's own rules. Parsed as that
    /// type here so a malformed promotion is refused where somebody can fix it,
    /// rather than skipped at a till where nobody would know.
    #[serde(default)]
    pub rules: Vec<pricing_engine::Rule>,
    /// Codes that unlock those promotions.
    #[serde(default)]
    pub coupons: Vec<CommercialCouponInput>,
    /// The envelopes those promotions sit in: one window, one budget, one
    /// switch for a set of offers the business runs as one thing.
    #[serde(default)]
    pub campaigns: Vec<CommercialCampaignInput>,
    pub actor_id: String,
    pub idempotency_key: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct CommercialMarkdownInput {
    pub markdown_id: String,
    /// One product, or — with `article_code` — a whole style. Naming neither
    /// would mark down the entire shop, and is refused.
    #[serde(default)]
    pub sku_id: Option<Uuid>,
    #[serde(default)]
    pub sku_code: Option<String>,
    #[serde(default)]
    pub article_code: Option<String>,
    /// `None` means every shop, unless a group or tier is named.
    #[serde(default)]
    pub site_id: Option<String>,
    #[serde(default)]
    pub site_ids: Option<Vec<String>>,
    #[serde(default)]
    pub tier: Option<String>,
    pub replacement_unit_price_minor: i64,
    #[serde(default)]
    pub priority: i64,
    pub effective_from: DateTime<Utc>,
    #[serde(default)]
    pub effective_to: Option<DateTime<Utc>>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct CommercialCouponInput {
    pub code: String,
    pub rule_id: String,
    #[serde(default = "yes")]
    pub active: bool,
    #[serde(default)]
    pub customer_id: Option<String>,
    #[serde(default)]
    pub valid_from: Option<DateTime<Utc>>,
    #[serde(default)]
    pub valid_to: Option<DateTime<Utc>>,
    #[serde(default)]
    pub max_uses: Option<i64>,
}

const fn yes() -> bool {
    true
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct CommercialCampaignInput {
    pub campaign_id: String,
    pub name: String,
    #[serde(default = "active")]
    pub status: String,
    #[serde(default)]
    pub valid_from: Option<DateTime<Utc>>,
    #[serde(default)]
    pub valid_to: Option<DateTime<Utc>>,
    /// Shared across every rule in the campaign. `None` is unlimited.
    #[serde(default)]
    pub budget_minor: Option<i64>,
    #[serde(default)]
    pub max_uses: Option<i64>,
    #[serde(default)]
    pub max_uses_per_customer: Option<i64>,
}

fn active() -> String {
    "ACTIVE".to_string()
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

#[derive(Clone, Debug, Default, Deserialize)]
pub struct DeadLetterQuery {
    pub limit: Option<i64>,
}

// ---- Authentication ------------------------------------------------------

#[derive(Clone, Debug, Deserialize)]
pub struct CreateUserRequest {
    pub username: String,
    pub display_name: String,
    pub password: String,
    pub role: Role,
}

#[derive(Clone, Debug, Deserialize)]
pub struct ChangePasswordRequest {
    pub current_password: String,
    pub new_password: String,
}

/// Promotion or demotion at Cloud.
///
/// This is the head-office role only. An operator's role AT an Edge lives on
/// their `edge_identity_assignment` and is set by upserting that assignment —
/// deliberately separate, because the same person can be a supervisor at head
/// office and an ordinary cashier at the till.
#[derive(Clone, Debug, Deserialize)]
pub struct SetUserRoleRequest {
    pub role: Role,
}

/// An administrator setting a password for somebody else.
///
/// Deliberately carries no `current_password`: the whole point is that nobody
/// knows it. `ChangePasswordRequest` remains the self-service path and still
/// demands the old password.
#[derive(Clone, Debug, Deserialize)]
pub struct ResetPasswordRequest {
    pub new_password: String,
}

#[derive(Clone, Debug, Deserialize)]
pub struct SetUserActiveRequest {
    pub active: bool,
}

#[derive(Clone, Debug, Deserialize)]
pub struct UpsertEdgeAssignmentRequest {
    pub origin_id: String,
    pub user_id: Uuid,
    pub role: Role,
    /// Edge-only PIN/password. The plaintext is hashed immediately and never
    /// stored or sent to the Edge.
    pub edge_password: String,
    pub offline_ttl_seconds: Option<i32>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct SetEdgeAssignmentActiveRequest {
    pub active: bool,
}

#[derive(Clone, Debug, Deserialize)]
pub struct RegisterRfidDeviceRequest {
    pub device_id: String,
    pub origin_id: String,
    pub label: String,
    pub pools: Vec<String>,
    pub offline_ttl_seconds: Option<i32>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct SetRfidDeviceActiveRequest {
    pub active: bool,
}

// ---- Returns and reporting ----------------------------------------------

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct ReturnLineInput {
    pub sale_line_id: Uuid,
    /// TRUE puts the item back on the store floor as sellable stock; FALSE
    /// sends it to the store reject pool (damaged).
    pub restock: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct RefundInput {
    pub method: PaymentMethod,
    pub amount_minor: i64,
    pub reference: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct CreateReturnRequest {
    pub lines: Vec<ReturnLineInput>,
    pub refunds: Vec<RefundInput>,
    pub reason: String,
    pub actor_id: String,
    pub idempotency_key: String,
}

#[derive(Clone, Debug, Default, Deserialize)]
pub struct ReturnQuery {
    pub site_id: Option<String>,
    pub limit: Option<i64>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct DailyReportQuery {
    pub site_id: String,
    /// Local business date the report covers (YYYY-MM-DD).
    pub date: NaiveDate,
    /// Minutes east of UTC for the business-day boundary; defaults to WIB
    /// (UTC+7 = 420) when omitted.
    pub utc_offset_minutes: Option<i32>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct RegisterOriginRequest {
    pub origin_id: String,
    pub ingest_key: String,
    pub label: Option<String>,
    /// Required, together with `node_role`, when inventory snapshots are enabled.
    pub site_id: Option<String>,
    /// `DC` or `STORE`; bound to every accepted pool snapshot.
    pub node_role: Option<String>,
    /// Explicit epoch fence for this origin. Defaults to generation 1.
    pub active_generation: Option<i64>,
    /// Legacy movement-only origins may leave this absent. Omission during key
    /// rotation preserves the existing inventory setting.
    pub inventory_enabled: Option<bool>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct IssueCommandRequest {
    pub command_type: String,
    pub payload: serde_json::Value,
    pub issued_by: String,
    pub expires_at: Option<DateTime<Utc>>,
    /// Empty or absent means the whole registered fleet.
    #[serde(default)]
    pub targets: Vec<String>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct RevokeCommandRequest {
    pub reason: String,
}
