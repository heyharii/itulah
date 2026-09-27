use crate::cloud::domain::{
    AllotmentStatus, AllotmentType, CommercialChannel, CountKind, DestinationType, PaymentMethod,
    RfidRead,
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
    /// Run unattended accounting jobs. Manual Finance actions remain available
    /// when this is false. Disabled by default while Finance is operated as a
    /// standalone accounting module.
    pub finance_automation_enabled: bool,
    /// The business clock's boot source. `None` is the wall clock — the
    /// production default. A malformed `ITULAH_CLOCK*` value refuses to boot
    /// rather than silently running a compressed demo on real time.
    pub clock: Option<crate::clock::ClockMode>,
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
    /// Object storage for catalogue imagery. None means this node serves no
    /// images, which is a valid deployment rather than a misconfiguration.
    pub media: Option<crate::cloud::media::MediaConfig>,
    /// The bucket private attachments go to. Separate from `media` on purpose;
    /// see `cloud::attachments`.
    pub attachments: Option<crate::cloud::attachments::AttachmentConfig>,
    /// The key that lets this node reach a model, for the assistant in the hub.
    ///
    /// Optional, and absent is a valid deployment rather than a fault: a node
    /// without it serves every screen it served before and answers the
    /// assistant's endpoint with "not configured". The key is read here and
    /// never leaves the process — the browser talks to us, we talk to the
    /// gateway. See `cloud/http/assistant.rs`.
    pub assistant_api_key: Option<String>,
    /// Where that gateway is. OpenRouter by default; overridable so a
    /// deployment can point at its own proxy without a rebuild.
    pub assistant_base_url: String,
    /// Which model answers, in the gateway's own naming. Configurable because
    /// a deployment may want a cheaper one, defaulted in code because a model
    /// id is not something an operator should have to know to start the
    /// server.
    pub assistant_model: String,
    /// The PO intake extraction doors (`intake::po`). A node without them
    /// still imports Excel and text-layer PDFs; scans fail honestly.
    pub po_import: crate::cloud::intake::po::PoImportConfig,

    /// Where a purchase order goes when nobody says otherwise.
    ///
    /// One DC today, so the buying screens do not ask: a required choice
    /// between a single option is a question with no information in it, and it
    /// is one more thing to get wrong on every order. It stays configurable
    /// rather than hard-coded because the second DC is a business decision,
    /// not a code change — and an order still names its destination on the
    /// wire, so nothing downstream has to learn about this default.
    ///
    /// # This is the EDGE node's site id, not `site.id`
    ///
    /// It is matched straight against `sync_origin_credential.site_id` when a
    /// receipt arrives (`a warehouse cannot receive against another
    /// warehouse's order`), and `purchase_order.destination_site_id` carries
    /// no foreign key into `site`. So it stays `dc` after 0256 renamed the
    /// site to `ho`: the box in the warehouse still registers as `dc`, and
    /// following the site here would have refused every delivery.
    ///
    /// Set it to whatever the DC edge registers as. A rig whose DC runs as
    /// `dc-01` — several entries in `.claude/launch.json` do — must set
    /// `INVENTORY_DEFAULT_DESTINATION_SITE_ID=dc-01` to match, because the
    /// canonical-name fallback in `inventory_dc_owner_tx` now answers to `ho`
    /// and no longer rescues a mismatched `dc`.
    ///
    /// Empty — the default since 0474 — means head office's own site, found
    /// by its kind when an order is raised rather than spelled here.
    pub default_destination_site_id: String,
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
            // On unless explicitly switched off (owner decision 25 Sep:
            // depreciation, the OE replacement reserve, prepaid spreading and
            // amortisation run by default; ops keeps an explicit off switch).
            finance_automation_enabled: crate::cloud::application::finance_automation_from_env(),
            clock: crate::clock::ClockMode::from_env_opt()
                .map_err(|error| AppError::Configuration(error.to_string()))?,
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
            media: crate::cloud::media::MediaConfig::from_env(),
            attachments: crate::cloud::attachments::AttachmentConfig::from_env(),
            default_destination_site_id: env_opt("INVENTORY_DEFAULT_DESTINATION_SITE_ID")
                .unwrap_or_default(),
            assistant_api_key: env_opt("OPENROUTER_API_KEY"),
            assistant_base_url: env_opt("OPENROUTER_BASE_URL")
                .unwrap_or_else(|| "https://openrouter.ai/api/v1".into())
                .trim_end_matches('/')
                .to_owned(),
            assistant_model: env_opt("ASSISTANT_MODEL")
                .unwrap_or_else(|| "anthropic/claude-opus-5".into()),
            po_import: crate::cloud::intake::po::PoImportConfig::from_env(),
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
    /// The business clock every handler stamps and derives from. Shared
    /// (`Arc`) so the control endpoint moves the one clock everything reads.
    pub clock: Arc<crate::clock::ClockHandle>,
    /// Present only when object storage is configured; handlers that need it
    /// answer 404 rather than 500 when it is absent.
    pub media: Option<Arc<crate::cloud::media::CatalogueMedia>>,
    /// Where conversation and discussion attachments go. Absent means they go
    /// into the database — never into `media`, which is publicly readable.
    pub attachments: Option<Arc<crate::cloud::attachments::AttachmentStore>>,
    /// Wakes the sync sender outside its interval (`POST /api/v1/sync/trigger`).
    pub sync_wake: Arc<tokio::sync::Notify>,
}

impl AppState {
    pub fn new(db: PgPool, config: AppConfig) -> Self {
        // A media config that will not construct is a deployment error worth
        // shouting about, but not worth refusing to serve inventory over.
        let media = config.media.as_ref().and_then(|media_config| {
            match crate::cloud::media::CatalogueMedia::new(media_config) {
                Ok(media) => Some(Arc::new(media)),
                Err(error) => {
                    tracing::error!(%error, "catalogue media disabled");
                    None
                }
            }
        });
        // Same rule as the catalogue store: a config that will not construct
        // is worth shouting about but not worth refusing to serve over. The
        // consequence here is that attachments land in the database, which is
        // a working node — not a node quietly writing private files somewhere
        // public.
        let attachments = config.attachments.as_ref().and_then(|attachment_config| {
            match crate::cloud::attachments::AttachmentStore::new(attachment_config) {
                Ok(store) => Some(Arc::new(store)),
                Err(error) => {
                    tracing::error!(%error, "attachment store disabled; attachments will be stored in the database");
                    None
                }
            }
        });
        // A clock config that will not construct is a deployment error worth
        // shouting about, but the same rule as media above applies: it is not
        // worth refusing to serve inventory over. The clock falls back to the
        // wall clock, which is the production default anyway.
        let clock = Arc::new(match &config.clock {
            Some(mode) => crate::clock::ClockHandle::from_mode(mode.clone()).unwrap_or_else(
                |error| {
                    tracing::error!(%error, "business clock config rejected; running on the wall clock");
                    crate::clock::ClockHandle::system()
                },
            ),
            None => crate::clock::ClockHandle::system(),
        });
        Self {
            db,
            media,
            attachments,
            config: Arc::new(config),
            clock,
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
        // The sqlx error itself, in the log, before it is flattened to
        // "database operation failed".
        //
        // The wire message stays deliberately blank — an SQLSTATE and a column
        // name are the shape of the schema, and the schema is not the caller's
        // business. But a 500 whose cause is nowhere is a 500 nobody can fix,
        // and this one cost an afternoon of bisecting SQL by hand before the
        // line was written.
        if let Self::Database(error) = &self {
            tracing::error!(%error, "database operation failed");
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

// The inventory lists' query strings.
//
// Every one of these carries `deny_unknown_fields`, which none of them did
// before: `?pool_id=…&causee=SALE` used to list the whole ledger under a
// filter the caller believed was applied, and answer 200. It is a 400 now.
//
// The additions are additive in the other direction too — every parameter
// these routes already took is still here and still means what it did.

/// `GET /api/v1/inventory/pools`.
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PoolQuery {
    pub as_of: Option<DateTime<Utc>>,
    /// Free text over the pool id, its label, the site id and the site's name.
    #[serde(default)]
    pub q: Option<String>,
    #[serde(default)]
    pub site_id: Option<String>,
    #[serde(default)]
    pub group: Option<String>,
    #[serde(default)]
    pub pool_id: Option<String>,
    /// `COUNTED` or `NEVER`.
    #[serde(default)]
    pub counted: Option<String>,
    /// `pool`, `site`, `stock`, `on_hand`, `missing`, `observed` or
    /// `last_count`. Anything else is the house order rather than a 400 — a
    /// stale bookmark should still open.
    #[serde(default)]
    pub sort: Option<String>,
    /// `desc`, or left out for ascending.
    #[serde(default)]
    pub dir: Option<String>,
    #[serde(default)]
    pub cursor: Option<String>,
    #[serde(default)]
    pub limit: Option<i64>,
    /// `0` or `false` to skip the exact total and the facet counts.
    ///
    /// Defaults to counting. Read as TEXT rather than as a `bool`, because
    /// serde's `bool` accepts exactly `true` and `false` and **400s on
    /// `count=0`** — which is what anybody writes. See
    /// `http::audit::wants_counting`, which is the one place that reads it.
    #[serde(default)]
    pub count: Option<String>,
}

/// `GET /api/v1/inventory/movements`.
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MovementQuery {
    pub pool_id: Option<String>,
    pub subject_id: Option<Uuid>,
    pub limit: Option<i64>,
    #[serde(default)]
    pub q: Option<String>,
    #[serde(default)]
    pub cause: Option<String>,
    #[serde(default)]
    pub actor_id: Option<String>,
    /// `occurred_at`, `recorded_at`, `quantity` or `cause`.
    #[serde(default)]
    pub sort: Option<String>,
    #[serde(default)]
    pub dir: Option<String>,
    #[serde(default)]
    pub cursor: Option<String>,
    /// `0` or `false` to skip the exact total and the facet counts.
    ///
    /// Defaults to counting. Read as TEXT rather than as a `bool`, because
    /// serde's `bool` accepts exactly `true` and `false` and **400s on
    /// `count=0`** — which is what anybody writes. See
    /// `http::audit::wants_counting`, which is the one place that reads it.
    #[serde(default)]
    pub count: Option<String>,
}

/// `GET /api/v1/inventory/observations`.
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ObservationQuery {
    pub pool_id: Option<String>,
    pub epc: Option<String>,
    pub limit: Option<i64>,
    #[serde(default)]
    pub q: Option<String>,
    #[serde(default)]
    pub device_id: Option<String>,
    #[serde(default)]
    pub method: Option<String>,
    #[serde(default)]
    pub site_id: Option<String>,
    /// `last_seen_at`, `first_seen_at`, `received_at`, `read_count` or `epc`.
    #[serde(default)]
    pub sort: Option<String>,
    #[serde(default)]
    pub dir: Option<String>,
    #[serde(default)]
    pub cursor: Option<String>,
}

/// `GET /api/v1/inventory/counts`.
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CountListQuery {
    #[serde(default)]
    pub q: Option<String>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub site_id: Option<String>,
    #[serde(default)]
    pub pool_id: Option<String>,
    #[serde(default)]
    pub kind: Option<String>,
    /// `created_at`, `pool`, `status`, `variance` or `closed_at`.
    #[serde(default)]
    pub sort: Option<String>,
    #[serde(default)]
    pub dir: Option<String>,
    #[serde(default)]
    pub cursor: Option<String>,
    #[serde(default)]
    pub limit: Option<i64>,
}

/// `GET /api/v1/inventory/missing`.
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MissingQuery {
    #[serde(default)]
    pub q: Option<String>,
    #[serde(default)]
    pub pool_id: Option<String>,
    #[serde(default)]
    pub site_id: Option<String>,
    /// `COUNTED` or `NEVER`.
    #[serde(default)]
    pub counted: Option<String>,
    /// `missing_since`, `quantity`, `pool`, `last_observation` or `epc`.
    #[serde(default)]
    pub sort: Option<String>,
    #[serde(default)]
    pub dir: Option<String>,
    #[serde(default)]
    pub cursor: Option<String>,
    #[serde(default)]
    pub limit: Option<i64>,
}

/// `GET /api/v1/inventory/reconciliations`.
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReconciliationQuery {
    #[serde(default)]
    pub q: Option<String>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub destination_store_id: Option<String>,
    /// The sending node's OWN site id — `dc-01` — not the centre's `dc`.
    #[serde(default)]
    pub source_dc_id: Option<String>,
    /// `status`, `destination`, `epc` or `occurred_at`.
    #[serde(default)]
    pub sort: Option<String>,
    #[serde(default)]
    pub dir: Option<String>,
    #[serde(default)]
    pub cursor: Option<String>,
    #[serde(default)]
    pub limit: Option<i64>,
}

/// `GET /api/v1/inventory/control`.
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ControlQuery {
    #[serde(default)]
    pub q: Option<String>,
    #[serde(default)]
    pub site_id: Option<String>,
    #[serde(default)]
    pub pool_id: Option<String>,
    #[serde(default)]
    pub subject_id: Option<Uuid>,
    /// `place`, `difference`, `ledger` or `projection`.
    #[serde(default)]
    pub sort: Option<String>,
    #[serde(default)]
    pub dir: Option<String>,
    #[serde(default)]
    pub cursor: Option<String>,
    #[serde(default)]
    pub limit: Option<i64>,
    /// `0` or `false` to skip the exact total and the facet counts.
    ///
    /// Defaults to counting. Read as TEXT rather than as a `bool`, because
    /// serde's `bool` accepts exactly `true` and `false` and **400s on
    /// `count=0`** — which is what anybody writes. See
    /// `http::audit::wants_counting`, which is the one place that reads it.
    #[serde(default)]
    pub count: Option<String>,
}

/// `GET /api/v1/inventory/as-of`.
#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
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
    /// What kind of change this book is — UI-001 §6 and UI-002.
    ///
    /// `REGULAR_PRICE`, `MARKDOWN`, `CLEARANCE` or `CORRECTION`. Declared at
    /// publication and **never afterwards**: `protect_commercial_publication`
    /// refuses every UPDATE to a published book, so a type left off here can
    /// never be added. That is the right guarantee and it makes this the only
    /// moment the intent can be captured.
    ///
    /// `#[serde(default)]` keeps every caller written before this field
    /// working, and those books read as `UNCLASSIFIED` — which is true of them
    /// and is not a classification anybody chose.
    #[serde(default)]
    pub change_type: Option<String>,
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
    pub replacement_unit_price_minor: i64,
    #[serde(default)]
    pub priority: i64,
    /// The campaign this drop belongs to, by the campaign's business id.
    ///
    /// Naming one is what turns four hundred separate clearances into one
    /// "Flash Sale" with a name, a banner and a single clock — and into one
    /// thing that can be stopped with a single switch.
    #[serde(default)]
    pub campaign_id: Option<String>,
    /// When in the week and in the day it runs. This is what makes a flash
    /// sale one row rather than one row per slot.
    #[serde(default)]
    pub iso_weekdays: Vec<u32>,
    #[serde(default)]
    pub from_minute: Option<u32>,
    #[serde(default)]
    pub to_minute: Option<u32>,
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

/// Everything about a published campaign that is still allowed to change.
///
/// Which is exactly two things, and migration 0073 draws the line: the SWITCH —
/// status and window, the lever somebody pulls when they say "stop the Lebaran
/// promo" — and the POSTER — the banner, the headline and the small print,
/// which describe the offer to a shopper rather than deciding money. A typo in
/// a banner must be fixable without cutting a new price book; a budget must
/// not be.
///
/// Every field but `status` is optional and absence means "leave it alone". A
/// screen sending only a pause must not silently clear the dates that say when
/// the campaign was going to end, or blank the picture.
#[derive(Clone, Debug, Deserialize)]
pub struct CampaignSwitchRequest {
    pub actor_id: String,
    /// `DRAFT`, `SCHEDULED`, `ACTIVE`, `PAUSED`, `EXPIRED` or `CANCELLED`.
    pub status: String,
    #[serde(default)]
    pub valid_from: Option<DateTime<Utc>>,
    #[serde(default)]
    pub valid_to: Option<DateTime<Utc>>,
    /// The poster. Clearing one is done by sending an empty string rather than
    /// by omitting the field, so "I did not mention it" and "remove it" stay
    /// distinguishable.
    #[serde(default)]
    pub image_url: Option<String>,
    #[serde(default)]
    pub headline: Option<String>,
    #[serde(default)]
    pub terms: Option<String>,
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
    /// The shops the campaign runs in. Empty or absent is everywhere.
    ///
    /// A shared CONSTRAINT, not a default that a rule overrides: a rule inside
    /// the campaign runs where both lists allow, so naming six shops here
    /// cannot be widened back to thirteen by a rule that names thirteen. That
    /// is the same way the campaign's window already binds.
    #[serde(default)]
    pub site_ids: Vec<String>,
    /// The banner a shop puts in front of a shopper, the words on it, and the
    /// small print under it.
    ///
    /// `image_url` is a catalogue-media key, the same shape `article.image_url`
    /// carries, so one uploader and one proxy serve both. `terms` is one block
    /// of text on purpose: terms differ per promotion, per season and per
    /// regulator, and a schema that modelled them would be wrong on arrival.
    #[serde(default)]
    pub image_url: Option<String>,
    #[serde(default)]
    pub headline: Option<String>,
    #[serde(default)]
    pub terms: Option<String>,
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
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct CreateSaleRequest {
    pub site_id: String,
    pub channel: CommercialChannel,
    pub actor_id: String,
    /// The shopper, when they are known.
    ///
    /// Carried from the start of the basket rather than attached at the end,
    /// because it decides things that happen along the way: a member-only offer
    /// is evaluated while the basket is being priced, and points accrue against
    /// whoever this is.
    ///
    /// `#[serde(default)]` so every caller that has never sent one keeps
    /// working and keeps meaning what it meant — an anonymous sale. Absent is
    /// not "unknown member"; it is a sale nobody identified, which is most of
    /// them.
    #[serde(default)]
    pub customer_id: Option<String>,
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

/// What a caller is asking the sale list for.
///
/// # Why there is a window at all
///
/// Because there was not one, and the list could therefore not answer "the
/// sales in this window" — the register's whole question. It took a unit, a
/// status and a ceiling, so the only way to ask about a month was to pull the
/// last N sales and hope the month was inside them.
///
/// The window is on `created_at` and not on `completed_at`, deliberately: this
/// list carries OPEN and VOIDED sales too, and those have no completion. It is
/// also the column the list is already ordered by, so the window and the order
/// are the same axis. `GET /reports/sales/window` is the other question —
/// takings, over a shop's own business day at a UTC offset — and it stays on
/// `completed_at` because only completed sales are takings.
#[derive(Clone, Debug, Deserialize)]
pub struct SaleQuery {
    pub site_id: Option<String>,
    pub status: Option<String>,
    /// First day in the window, inclusive. Absent means no lower bound.
    pub from: Option<NaiveDate>,
    /// Last day in the window, INCLUSIVE — a caller asking for "1 to 30
    /// September" means the thirtieth to be in it, as everywhere else here.
    pub to: Option<NaiveDate>,
    /// Minutes east of UTC the two dates are read in; defaults to WIB
    /// (UTC+7 = 420), like every other dated read in this module.
    pub utc_offset_minutes: Option<i32>,
    pub limit: Option<i64>,
}

/// One line of a basket somebody wants priced without selling it.
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct SimulateLineInput {
    pub sku_code: String,
    pub quantity: i64,
}

/// Price a basket that is not being sold.
///
/// The same evaluator, the same snapshot, the same instant — the only
/// difference from a real sale is that nothing is written. That is what makes
/// it worth having: a promotion can be checked before it is published, and
/// "why did this not come off" can be asked without a customer standing there.
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct SimulateRequest {
    pub site_id: String,
    pub channel: CommercialChannel,
    /// The instant to price at. Omitted is now.
    #[serde(default)]
    pub at: Option<DateTime<Utc>>,
    pub lines: Vec<SimulateLineInput>,
    /// Codes the shopper would present. A rule gated by a coupon stays shut
    /// until its code is in here.
    #[serde(default)]
    pub coupon_codes: Vec<String>,
    #[serde(default)]
    pub customer_id: Option<String>,
}

/// Every style, every shop, every price that could apply.
/// What a price book can name.
///
/// Search by SKU code, article code or article name — the three things
/// somebody has in front of them when they sit down to write a book.
#[derive(Clone, Debug, Deserialize)]
pub struct CommercialProductQuery {
    #[serde(default)]
    pub q: Option<String>,
    /// Comma-separated style codes, matched exactly.
    #[serde(default)]
    pub article_codes: Option<String>,
    #[serde(default)]
    pub limit: Option<i64>,
}

/// What to price, and how much of it.
///
/// Every field but `channel` narrows. They are here rather than in the browser
/// because the work this endpoint does is styles TIMES shops — pricing five
/// hundred styles across thirteen shops takes seconds and megabytes, and a
/// filter applied after that has already paid for all of it. Narrowing first
/// is the difference between a screen that answers and one that waits.
///
/// The one exception is the price bounds, which cannot be applied first: what
/// a style costs is the answer, not the question. They filter the priced rows
/// on the way out, and `total` still counts what the SQL matched, so a reader
/// is never told the range is smaller than it is.
///
/// `deny_unknown_fields` because a misspelled filter is worse than a refused
/// one: `?divisionss=ANAK_LAKI` narrows nothing, the caller believes a filter is
/// applied, and the screen prices the whole catalogue under it.
#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ArticlePriceQuery {
    pub channel: CommercialChannel,
    #[serde(default)]
    pub at: Option<DateTime<Utc>>,
    /// How many styles to price. Bounded because the work is styles times
    /// shops: a fleet of thirty and a catalogue of thousands is a request
    /// nobody meant to make.
    #[serde(default)]
    pub limit: Option<i64>,
    /// `article_code`, `name`, `division` or `sku_count`. Anything else is the
    /// house order rather than a 400 — see `ArticlePriceScope::sort`, which
    /// also says why there is no sort by price.
    #[serde(default)]
    pub sort: Option<String>,
    /// `desc` and nothing else.
    #[serde(default)]
    pub dir: Option<String>,
    /// A `next_cursor` from the previous page, verbatim.
    #[serde(default)]
    pub cursor: Option<String>,
    /// Article code, article name, or SKU code — the three things somebody has
    /// in front of them when they go looking for a style.
    #[serde(default)]
    pub q: Option<String>,
    /// Division codes, comma separated. Empty means every division.
    #[serde(default)]
    pub divisions: Option<String>,
    /// Tag codes, comma separated. A style matches if it carries ANY of them,
    /// which is what a facet list means when you tick two boxes.
    #[serde(default)]
    pub tags: Option<String>,
    /// Keep only styles the till charges at least this much for, at any shop.
    /// Whole rupiah, like every other price on the wire.
    #[serde(default)]
    pub min_price: Option<i64>,
    #[serde(default)]
    pub max_price: Option<i64>,
}

/// A comma-separated parameter as the list it means.
///
/// Blank entries are dropped rather than passed on: `?divisions=` is what a
/// form sends when nothing is ticked, and an array holding one empty string
/// would match no division at all — a filter nobody set, silently emptying the
/// screen.
///
/// A free function rather than one query's method, because the second endpoint
/// to take a ticked list needed exactly this and calling it
/// `ArticlePriceQuery::list` from a purchase-order handler reads as a mistake.
pub fn comma_list(raw: &Option<String>) -> Vec<String> {
    raw.iter()
        .flat_map(|value| value.split(','))
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
        .collect()
}

impl ArticlePriceQuery {
    pub fn list(raw: &Option<String>) -> Vec<String> {
        comma_list(raw)
    }
}

/// How the order book is narrowed.
///
/// Every field is answered by the SQL rather than by the browser: the list is
/// the whole book, and a chip that arrives after it has already been paid for.
/// The operator list the filter bar offers on these columns is cut to what is
/// here — an operator the request cannot carry is a chip that narrows nothing.
/// `deny_unknown_fields`, so a misspelled filter is refused rather than quietly
/// ignored: `?statuss=ISSUED` narrows nothing, the caller believes a filter is
/// applied, and the screen shows the whole book as though it were a shortlist.
#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PurchaseOrderQuery {
    /// PO number, supplier name or supplier code.
    #[serde(default)]
    pub q: Option<String>,
    /// `DRAFT,ISSUED,CLOSED,CANCELLED` — comma separated, any of.
    #[serde(default)]
    pub status: Option<String>,
    /// Supplier codes, comma separated.
    #[serde(default)]
    pub supplier: Option<String>,
    /// Issued on or after this day, and on or before that one. Days, not
    /// instants: nobody filters an order book to the minute.
    #[serde(default)]
    pub issued_from: Option<chrono::NaiveDate>,
    #[serde(default)]
    pub issued_to: Option<chrono::NaiveDate>,
    /// `issued` (the default), `po_number`, `supplier`, `value` or `expected`.
    /// Anything else is the house order rather than a 400 — see
    /// `PurchaseOrderFilter::sort`.
    #[serde(default)]
    pub sort: Option<String>,
    /// `asc` or `desc`. Absent means each key's own natural direction.
    #[serde(default)]
    pub dir: Option<String>,
    /// A `next_cursor` from the previous page, verbatim.
    #[serde(default)]
    pub cursor: Option<String>,
    #[serde(default)]
    pub limit: Option<i64>,
}

/// How the buyer's inbox of price queries is narrowed, ordered and paged.
#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PriceAmendmentQuery {
    /// PO number, article code, article name, or who asked.
    #[serde(default)]
    pub q: Option<String>,
    /// Warehouse ids, comma separated. Empty means every one of them.
    #[serde(default)]
    pub origin: Option<String>,
    /// `requested` (the default), `difference` or `po_number`.
    #[serde(default)]
    pub sort: Option<String>,
    /// `asc` or `desc`. Absent means each key's own natural direction — oldest
    /// question first, because this is a queue.
    #[serde(default)]
    pub dir: Option<String>,
    /// A `next_cursor` from the previous page, verbatim.
    #[serde(default)]
    pub cursor: Option<String>,
    #[serde(default)]
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

/// `GET /api/v1/inventory/availability`.
///
/// This route already narrowed on the server — the search, the keyset cursor,
/// the `held`/`shortfall` filters and `total_items` were all here — so it
/// keeps its own shape. The one thing it was missing is the refusal below:
/// `?heldd=true` used to answer 200 with the whole catalogue, under a filter
/// the caller believed was applied.
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AvailabilityQuery {
    pub at: Option<DateTime<Utc>>,
    pub source_pool_id: Option<String>,
    /// Stable SKU-code cursor returned by the previous page.
    pub cursor: Option<String>,
    /// Search is evaluated by PostgreSQL before pagination.
    pub q: Option<String>,
    pub limit: Option<i64>,
    /// Only the SKUs the pool actually holds.
    ///
    /// The endpoint's default answer is every active SKU in the catalogue,
    /// because a zero is a real answer to "what is this SKU's position". It is
    /// not an answer to "what can I send from here", and the screens that ask
    /// the second question were throwing away 2,722 rows of the 2,740 they
    /// were handed — after the server had folded the ledger for all of them
    /// and serialised them.
    pub held: Option<bool>,
    /// Only the SKUs promised out beyond what is there.
    ///
    /// `on_hand` is what the pool holds minus what is already promised, so a
    /// negative one is an over-promise. The allotment list shows exactly those
    /// rows and no others, and used to find them by reading all 2,740 rows of
    /// the catalogue projection and keeping a handful — the reading, not the
    /// ledger fold, is what made that list slow.
    pub shortfall: Option<bool>,
    /// Internal projections may need the complete set for correctness. HTTP
    /// input cannot set this field.
    #[serde(skip)]
    pub unbounded: bool,
}

/// What a caller is asking the rejected-event list for.
///
/// `deny_unknown_fields`, so a misspelled filter is refused rather than quietly
/// listing every rejection under one the caller believes is applied. `limit` is
/// still here and still means what it did.
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DeadLetterQuery {
    /// Free text over the node, the event type and the reason it was refused.
    /// Deliberately not the payload: it is arbitrary JSON written by whichever
    /// handler produced the event, so a search over it would match on whatever
    /// one lane happened to record, which is not a rule anybody could predict.
    #[serde(default)]
    pub q: Option<String>,
    #[serde(default)]
    pub origin_id: Option<String>,
    #[serde(default)]
    pub event_type: Option<String>,
    #[serde(default)]
    pub reason: Option<String>,
    /// `at`, `origin` or `type`. Anything else is `at` rather than a 400, so a
    /// stale bookmark still opens.
    #[serde(default)]
    pub sort: Option<String>,
    /// `asc` and nothing else. Absent means descending — a rejection list is
    /// read newest-first.
    #[serde(default)]
    pub dir: Option<String>,
    /// A `next_cursor` from the previous page, verbatim.
    #[serde(default)]
    pub cursor: Option<String>,
    pub limit: Option<i64>,
}

// ---- Authentication ------------------------------------------------------

// The request bodies an administration screen sends live in `crate::contract`
// so the browser's TypeScript is generated from them. Re-exported here because
// this is where the rest of the application layer expects to find them.
pub use crate::contract::{
    ChangePasswordRequest, CreateUserRequest, LoginRequest, ProvisionAccountRequest,
    ProvisionEdgeAccess, ProvisionedAccount, ResetPasswordRequest, SetEdgeAssignmentActiveRequest,
    SetUserActiveRequest, SetUserRoleRequest, UpsertEdgeAssignmentRequest,
};

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

/// What a caller is asking the returns list for.
///
/// `deny_unknown_fields`, so `?site=STORE-01` is refused rather than quietly
/// listing every shop's refunds under a filter the caller believes is applied.
/// Both parameters this route already had — `site_id` and `limit` — are still
/// here and still mean what they did.
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReturnQuery {
    pub site_id: Option<String>,
    /// Free text over the two numbers somebody has in their hand: the return's
    /// own and the sale it came off.
    #[serde(default)]
    pub q: Option<String>,
    /// Why it came back. One reason.
    #[serde(default)]
    pub reason: Option<String>,
    /// `at`, `number`, `refund` or `site`. Anything else is `at` rather than a
    /// 400, so a stale bookmark still opens.
    #[serde(default)]
    pub sort: Option<String>,
    /// `asc` and nothing else. Absent means descending — a refund list is read
    /// newest-first.
    #[serde(default)]
    pub dir: Option<String>,
    /// A `next_cursor` from the previous page, verbatim.
    #[serde(default)]
    pub cursor: Option<String>,
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

/// Every shop's takings over a span of days, in buckets.
///
/// The daily report above answers "how did this shop close today"; this one
/// answers "how is the fleet trading this month", which is a different
/// question and cannot be assembled from the first without one request per
/// shop per day. The bucket is chosen by the reader because the same span
/// means different things at different resolutions: a month of days shows
/// which Saturday was quiet, a month of weeks shows whether the trend is up.
#[derive(Clone, Debug, Deserialize)]
pub struct SalesSeriesQuery {
    /// First local business date in the span, inclusive (YYYY-MM-DD).
    pub from: NaiveDate,
    /// Last local business date in the span, INCLUSIVE. A reader asking for
    /// "1 to 30 September" means the thirtieth to be in it.
    pub to: NaiveDate,
    /// `day` (default) · `week` (ISO, Monday) · `month`.
    pub bucket: Option<String>,
    /// Minutes east of UTC for the business-day boundary; defaults to WIB
    /// (UTC+7 = 420) when omitted, like the daily report.
    pub utc_offset_minutes: Option<i32>,
}

/// One shop over one span, with the receipts — or the whole chain.
///
/// The counterpart to a cell in the series: the series says a shop took
/// nineteen million on Tuesday, this says across how many sales, in what
/// tenders, and which receipts they were.
#[derive(Clone, Debug, Deserialize)]
pub struct SalesWindowQuery {
    /// One unit, or ABSENT for every unit.
    ///
    /// Optional since the Sales Register asked for a chain-wide view and could
    /// not have one: this was the only read in finance where the unit was a
    /// required argument rather than a filter, so "the fleet this week" was a
    /// question the endpoint could not be asked. Every existing caller sends
    /// one and is unaffected.
    pub site_id: Option<String>,
    pub from: NaiveDate,
    /// Inclusive, as in `SalesSeriesQuery`.
    pub to: NaiveDate,
    pub utc_offset_minutes: Option<i32>,
    /// How many receipts to list. The totals above them are computed over the
    /// whole span regardless, so a truncated list never makes the summary lie.
    pub limit: Option<i64>,
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

/// Whether the month-end Finance agents run: on unless
/// `INVENTORY_FINANCE_AUTOMATION_ENABLED` says `false`, `0` or `off`.
///
/// One reading for the boot and for the readiness screen, so the screen can
/// never report a different switch from the one the agents obeyed.
pub fn finance_automation_from_env() -> bool {
    match env::var("INVENTORY_FINANCE_AUTOMATION_ENABLED") {
        Ok(value) => !matches!(
            value.trim().to_ascii_lowercase().as_str(),
            "false" | "0" | "off" | "no"
        ),
        Err(_) => true,
    }
}
