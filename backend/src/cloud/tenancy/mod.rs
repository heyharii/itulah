//! The sandbox: one testing server, many businesses.
//!
//! Everything else in `cloud` serves ONE business from ONE database, and
//! stays that way. The sandbox does not teach a single query about tenants;
//! it gives each business a database of its own on the same Postgres server
//! and puts a gateway in front that decides, per request, whose database the
//! request is for. Isolation is therefore the database's, not a `WHERE`
//! clause somebody could forget.
//!
//! # The pieces
//!
//! * **The control database** — whatever `DATABASE_URL` names in this mode.
//!   It holds one table, `business`: the list of businesses on this server.
//!   None of the application's migrations run on it.
//! * **The template** (`TENANCY_TEMPLATE_DATABASE`, default `itulah_blank`) —
//!   a database migrated from nothing and then blanked with `blank.sql`, the
//!   same statements `scripts/blank-tenant.sh` runs. Built once, brought up
//!   to date with the migrations at every boot, never served.
//! * **A business** — `CREATE DATABASE … TEMPLATE itulah_blank`, about a
//!   second, plus its first account (OWNER). Its owner then meets the setup
//!   wizard, exactly as a new client would.
//! * **The gateway** — reads the business from the `x-itulah-business`
//!   header, else the `itulah_business` cookie, opens that business on first
//!   use (its own small pool, its migrations, its periodic jobs, its own
//!   `http::router`) and hands the request to it untouched.
//!
//! Accounts and sessions live inside each business's database, so a session
//! from one business means nothing to another; choosing a different business
//! clears the session cookies for that reason.
//!
//! # What it does not do
//!
//! Store nodes and tills do not sync into a sandbox business: their sync
//! client sends no business. The sandbox is the hub.

use crate::cloud::{http, postgres, AppConfig, AppError, AppState};
use crate::security::{self, CSRF_COOKIE, SESSION_COOKIE};
use axum::{
    extract::{Request, State},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::{
    postgres::{PgConnectOptions, PgPoolOptions},
    PgPool, Row,
};
use std::{collections::HashMap, env, str::FromStr, sync::Arc, time::Duration};
use tokio::sync::{Mutex, RwLock};
use tower::ServiceExt;
use tracing::{error, info, warn};
use uuid::Uuid;

/// The cookie that says which business this browser is looking at.
pub const BUSINESS_COOKIE: &str = "itulah_business";
/// The same, for a client that would rather say it than carry a cookie.
pub const BUSINESS_HEADER: &str = "x-itulah-business";

const BLANK_SQL: &str = include_str!("blank.sql");
const BUSINESS_COOKIE_MAX_AGE: i64 = 180 * 24 * 60 * 60;

/// Hands a freshly opened business its background work — the periodic jobs
/// `bin/cloud.rs` starts for a single-business node.
pub type StartNodeWork = fn(&AppState);

#[derive(Clone, Debug)]
pub struct TenancyConfig {
    pub template_database: String,
    /// None: anybody who can reach the page may make a business.
    pub invite_code: Option<String>,
    pub max_businesses: i64,
    /// Connections a business may hold at once — 20, as a single-business
    /// node has. Not smaller: each periodic job holds one connection for its
    /// lock and needs another for its work, and fifteen of them start
    /// together, so a small pool locks itself up. The businesses share the
    /// server's limit through `idle_timeout` instead: a quiet business holds
    /// nothing a minute after its last pass.
    pub pool_size: u32,
}

impl TenancyConfig {
    /// `Some` when `INVENTORY_TENANCY=sandbox`; the single-business node is
    /// the default and needs nothing here.
    pub fn from_env() -> Result<Option<Self>, AppError> {
        let mode = env::var("INVENTORY_TENANCY").unwrap_or_default();
        match mode.trim().to_ascii_lowercase().as_str() {
            "" | "single" => return Ok(None),
            "sandbox" => {}
            other => {
                return Err(AppError::Configuration(format!(
                    "INVENTORY_TENANCY must be single or sandbox, not '{other}'"
                )))
            }
        }
        let template_database =
            env_opt("TENANCY_TEMPLATE_DATABASE").unwrap_or_else(|| "itulah_blank".into());
        if !is_identifier(&template_database) {
            return Err(AppError::Configuration(
                "TENANCY_TEMPLATE_DATABASE must be a-z, 0-9 and '_'".into(),
            ));
        }
        let max_businesses = env_opt("TENANCY_MAX_BUSINESSES")
            .map(|v| v.parse::<i64>())
            .transpose()
            .map_err(|e| AppError::Configuration(format!("invalid TENANCY_MAX_BUSINESSES: {e}")))?
            .unwrap_or(50)
            .clamp(1, 1_000);
        let pool_size = env_opt("TENANCY_POOL_SIZE")
            .map(|v| v.parse::<u32>())
            .transpose()
            .map_err(|e| AppError::Configuration(format!("invalid TENANCY_POOL_SIZE: {e}")))?
            .unwrap_or(20)
            .clamp(20, 60);
        Ok(Some(Self {
            template_database,
            invite_code: env_opt("TENANCY_INVITE_CODE"),
            max_businesses,
            pool_size,
        }))
    }
}

/// One business, open: its database and the router that serves it.
struct Tenant {
    router: Router,
}

struct Gateway {
    control: PgPool,
    /// `DATABASE_URL`, parsed; a business's database is the same server with
    /// another database name.
    server: PgConnectOptions,
    config: AppConfig,
    tenancy: TenancyConfig,
    start_node_work: StartNodeWork,
    open: RwLock<HashMap<String, Arc<Tenant>>>,
    /// Opening a business runs its migrations and starts its jobs: once.
    opening: Mutex<()>,
    /// `CREATE DATABASE … TEMPLATE` refuses while anybody else is connected
    /// to the template, and two clones at once are two somebodies.
    cloning: Mutex<()>,
    /// False when the template could not be built; creating then says so
    /// instead of failing half-way through.
    template_ready: bool,
}

/// Serve the sandbox until the process is told to stop.
pub async fn serve(
    config: AppConfig,
    tenancy: TenancyConfig,
    start_node_work: StartNodeWork,
    shutdown: impl std::future::Future<Output = ()> + Send + 'static,
) -> Result<(), AppError> {
    let server = PgConnectOptions::from_str(&config.database_url)
        .map_err(|e| AppError::Configuration(format!("DATABASE_URL: {e}")))?;
    let control = PgPoolOptions::new()
        .max_connections(4)
        .connect_with(server.clone())
        .await?;
    install_control_schema(&control).await?;

    let template_ready = match prepare_template(&control, &server, &tenancy).await {
        Ok(()) => true,
        Err(err) => {
            error!(error = %err, template = %tenancy.template_database,
                "sandbox template could not be prepared; existing businesses are served, new ones cannot be made");
            false
        }
    };
    // A business left half-made by a crash is not anybody's; say so rather
    // than leave it looking busy for ever.
    sqlx::query("UPDATE business SET status='FAILED' WHERE status='CREATING'")
        .execute(&control)
        .await?;

    let bind_addr = config.bind_addr;
    let gateway = Arc::new(Gateway {
        control,
        server,
        config,
        tenancy,
        start_node_work,
        open: RwLock::new(HashMap::new()),
        opening: Mutex::new(()),
        cloning: Mutex::new(()),
        template_ready,
    });
    let app = Router::new()
        .route("/api/v1/health", get(health))
        .route("/api/v1/tenancy", get(current))
        .route("/api/v1/tenancy/businesses", post(create_business))
        .route("/api/v1/tenancy/select", post(select_business))
        .route("/api/v1/tenancy/leave", post(leave_business))
        .fallback(dispatch)
        .with_state(gateway);
    let listener = tokio::net::TcpListener::bind(bind_addr)
        .await
        .map_err(|e| AppError::Configuration(format!("cannot bind {bind_addr}: {e}")))?;
    info!(%bind_addr, "sandbox gateway started: one server, many businesses");
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown)
        .await
        .map_err(|e| AppError::Configuration(format!("server failure: {e}")))
}

// ---------------------------------------------------------------------------
// The control database and the template
// ---------------------------------------------------------------------------

async fn install_control_schema(control: &PgPool) -> Result<(), AppError> {
    sqlx::raw_sql(
        "CREATE TABLE IF NOT EXISTS business (
            slug            text PRIMARY KEY
                            CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
            name            text NOT NULL CHECK (btrim(name) <> ''),
            database_name   text NOT NULL UNIQUE
                            CHECK (database_name ~ '^[a-z0-9_]{1,63}$'),
            owner_username  text NOT NULL,
            status          text NOT NULL DEFAULT 'CREATING'
                            CHECK (status IN ('CREATING', 'ACTIVE', 'FAILED')),
            created_at      timestamptz NOT NULL DEFAULT now(),
            last_opened_at  timestamptz
        )",
    )
    .execute(control)
    .await?;
    Ok(())
}

/// Build the template if it is missing; otherwise bring it up to the
/// migrations this binary carries, so a clone never starts behind.
///
/// It is built under another name and renamed when blank, so a build that
/// dies half-way leaves nothing that looks like a template.
async fn prepare_template(
    control: &PgPool,
    server: &PgConnectOptions,
    tenancy: &TenancyConfig,
) -> Result<(), AppError> {
    let name = &tenancy.template_database;
    if database_exists(control, name).await? {
        let pool = small_pool(server, name, 2).await?;
        postgres::MIGRATOR.run(&pool).await?;
        pool.close().await;
        info!(template = %name, "sandbox template is up to date");
        return Ok(());
    }
    let building = format!("{name}_building");
    sqlx::raw_sql(&format!("DROP DATABASE IF EXISTS \"{building}\""))
        .execute(control)
        .await?;
    sqlx::raw_sql(&format!("CREATE DATABASE \"{building}\""))
        .execute(control)
        .await?;
    info!(template = %name, "building the sandbox template: migrating from nothing");
    let pool = small_pool(server, &building, 2).await?;
    postgres::MIGRATOR.run(&pool).await?;
    sqlx::raw_sql(BLANK_SQL).execute(&pool).await?;
    pool.close().await;
    // Hundreds of migrations wake autovacuum on the new database, and its
    // worker holds a session that refuses the rename for longer than a few
    // retries wait (GCP demo, 4 Oct). The database is ours and nobody else's.
    sqlx::query(
        "SELECT pg_terminate_backend(pid) FROM pg_stat_activity
          WHERE datname = $1 AND pid <> pg_backend_pid()",
    )
    .bind(&building)
    .execute(control)
    .await?;
    let rename = format!("ALTER DATABASE \"{building}\" RENAME TO \"{name}\"");
    let rename = rename.as_str();
    retry_while_busy(move || sqlx::raw_sql(rename).execute(control)).await?;
    info!(template = %name, "sandbox template built");
    Ok(())
}

async fn database_exists(control: &PgPool, name: &str) -> Result<bool, AppError> {
    Ok(
        sqlx::query_scalar::<_, bool>("SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname=$1)")
            .bind(name)
            .fetch_one(control)
            .await?,
    )
}

async fn small_pool(
    server: &PgConnectOptions,
    database: &str,
    size: u32,
) -> Result<PgPool, AppError> {
    Ok(PgPoolOptions::new()
        .max_connections(size)
        .min_connections(0)
        .idle_timeout(Duration::from_secs(60))
        .acquire_timeout(Duration::from_secs(30))
        .connect_with(server.clone().database(database))
        .await?)
}

/// A database that was just closed can still show a backend for a moment,
/// and `CREATE … TEMPLATE` / `ALTER … RENAME` refuse while it does.
async fn retry_while_busy<F, Fut, T>(attempt: F) -> Result<(), AppError>
where
    F: Fn() -> Fut,
    Fut: std::future::Future<Output = Result<T, sqlx::Error>>,
{
    let mut tries = 0;
    loop {
        match attempt().await {
            Ok(_) => return Ok(()),
            Err(err) if tries < 60 && is_busy(&err) => {
                tries += 1;
                tokio::time::sleep(Duration::from_millis(500)).await;
            }
            Err(err) => return Err(err.into()),
        }
    }
}

fn is_busy(err: &sqlx::Error) -> bool {
    // 55006 object_in_use: "source database … is being accessed by other users".
    err.as_database_error()
        .and_then(|db| db.code())
        .is_some_and(|code| code == "55006")
}

// ---------------------------------------------------------------------------
// Opening a business
// ---------------------------------------------------------------------------

impl Gateway {
    async fn tenant(&self, slug: &str) -> Result<Option<Arc<Tenant>>, AppError> {
        if let Some(tenant) = self.open.read().await.get(slug) {
            return Ok(Some(tenant.clone()));
        }
        let _once = self.opening.lock().await;
        if let Some(tenant) = self.open.read().await.get(slug) {
            return Ok(Some(tenant.clone()));
        }
        let Some(database) = sqlx::query_scalar::<_, String>(
            "UPDATE business SET last_opened_at=now()
              WHERE slug=$1 AND status='ACTIVE' RETURNING database_name",
        )
        .bind(slug)
        .fetch_optional(&self.control)
        .await?
        else {
            return Ok(None);
        };
        let tenant = Arc::new(self.open_tenant(&database).await?);
        self.open
            .write()
            .await
            .insert(slug.to_owned(), tenant.clone());
        info!(business = %slug, "sandbox business opened");
        Ok(Some(tenant))
    }

    async fn open_tenant(&self, database: &str) -> Result<Tenant, AppError> {
        let pool = small_pool(&self.server, database, self.tenancy.pool_size).await?;
        postgres::MIGRATOR.run(&pool).await?;
        postgres::provision_origin(
            &pool,
            &self.config.node_id,
            self.config.sync_generation,
            self.config.sync_enqueue_enabled,
        )
        .await?;
        let state = AppState::new(pool, self.config.clone());
        (self.start_node_work)(&state);
        Ok(Tenant {
            router: http::router(state),
        })
    }
}

// ---------------------------------------------------------------------------
// The gateway's own routes
// ---------------------------------------------------------------------------

type Gw = State<Arc<Gateway>>;

async fn health() -> Json<Value> {
    Json(json!({ "status": "ok", "mode": "sandbox" }))
}

/// What the sign-in door needs before anybody has signed in.
async fn current(State(gw): Gw, headers: HeaderMap) -> Result<Json<Value>, AppError> {
    let business = match chosen_business(&headers) {
        Some(slug) => business_row(&gw.control, &slug).await?,
        None => None,
    };
    Ok(Json(json!({
        "mode": "sandbox",
        "business": business.map(|(slug, name)| json!({ "slug": slug, "name": name })),
        "invite_required": gw.tenancy.invite_code.is_some(),
    })))
}

#[derive(Deserialize)]
struct CreateBusiness {
    business_name: String,
    owner_name: String,
    username: String,
    password: String,
    invite_code: Option<String>,
}

/// Make a business: its database from the template, and its owner.
async fn create_business(
    State(gw): Gw,
    Json(body): Json<CreateBusiness>,
) -> Result<Response, AppError> {
    if let Some(expected) = &gw.tenancy.invite_code {
        let given = body.invite_code.as_deref().unwrap_or("").trim();
        if !constant_time_eq(given.as_bytes(), expected.as_bytes()) {
            return Err(AppError::Forbidden("that invite code is not right".into()));
        }
    }
    let name = body.business_name.trim().to_owned();
    if name.is_empty() || name.chars().count() > 80 {
        return Err(AppError::Validation(
            "the business needs a name of at most 80 characters".into(),
        ));
    }
    let owner_name = body.owner_name.trim().to_owned();
    if owner_name.is_empty() || owner_name.chars().count() > 80 {
        return Err(AppError::Validation(
            "say who you are, in at most 80 characters".into(),
        ));
    }
    let username = security::normalize_username(&body.username).map_err(AppError::Validation)?;
    // Hashing also enforces the house minimum length: before the database is
    // made, so a short password costs nothing.
    let password_hash = postgres::hash_new_password(&body.password).await?;
    if !gw.template_ready {
        return Err(AppError::Configuration(
            "this server cannot make businesses right now; the template is not ready".into(),
        ));
    }
    let live: i64 =
        sqlx::query_scalar("SELECT count(*) FROM business WHERE status IN ('ACTIVE','CREATING')")
            .fetch_one(&gw.control)
            .await?;
    if live >= gw.tenancy.max_businesses {
        return Ok((
            StatusCode::TOO_MANY_REQUESTS,
            Json(
                json!({ "error": "this testing server is full; ask for a business to be removed" }),
            ),
        )
            .into_response());
    }

    let slug = claim_slug(&gw.control, &name, &username).await?;
    let database = format!("biz_{}", slug.replace('-', "_"));
    sqlx::query("UPDATE business SET database_name=$2 WHERE slug=$1")
        .bind(&slug)
        .bind(&database)
        .execute(&gw.control)
        .await?;

    match make_business(&gw, &database, &username, &owner_name, &password_hash).await {
        Ok(()) => {
            sqlx::query("UPDATE business SET status='ACTIVE' WHERE slug=$1")
                .bind(&slug)
                .execute(&gw.control)
                .await?;
            info!(business = %slug, "sandbox business made");
            let mut response = (
                StatusCode::CREATED,
                Json(json!({ "slug": slug, "name": name })),
            )
                .into_response();
            choose(&gw, response.headers_mut(), Some(&slug));
            Ok(response)
        }
        Err(err) => {
            error!(business = %slug, error = %err, "sandbox business could not be made");
            let _ = sqlx::query("UPDATE business SET status='FAILED' WHERE slug=$1")
                .bind(&slug)
                .execute(&gw.control)
                .await;
            let _ = sqlx::raw_sql(&format!("DROP DATABASE IF EXISTS \"{database}\""))
                .execute(&gw.control)
                .await;
            Err(err)
        }
    }
}

/// A slug nobody holds, from the business's name, recorded as CREATING so a
/// second request for the same name gets the next one.
async fn claim_slug(control: &PgPool, name: &str, owner: &str) -> Result<String, AppError> {
    let base = slugify(name);
    for n in 1..=50 {
        let candidate = if n == 1 {
            base.clone()
        } else {
            format!(
                "{}-{n}",
                base.chars()
                    .take(36)
                    .collect::<String>()
                    .trim_end_matches('-')
            )
        };
        // A placeholder database name, unique by construction, replaced once
        // the slug is known to be ours.
        let placeholder = format!("pending_{}", Uuid::new_v4().simple());
        let claimed = sqlx::query(
            "INSERT INTO business (slug, name, database_name, owner_username)
             VALUES ($1, $2, $3, $4) ON CONFLICT (slug) DO NOTHING",
        )
        .bind(&candidate)
        .bind(name)
        .bind(&placeholder)
        .bind(owner)
        .execute(control)
        .await?
        .rows_affected();
        if claimed == 1 {
            return Ok(candidate);
        }
    }
    Err(AppError::Conflict(
        "too many businesses already carry that name".into(),
    ))
}

async fn make_business(
    gw: &Gateway,
    database: &str,
    username: &str,
    owner_name: &str,
    password_hash: &str,
) -> Result<(), AppError> {
    {
        let _clone = gw.cloning.lock().await;
        let template = &gw.tenancy.template_database;
        let create = format!("CREATE DATABASE \"{database}\" TEMPLATE \"{template}\"");
        let create = create.as_str();
        let control = &gw.control;
        retry_while_busy(move || sqlx::raw_sql(create).execute(control)).await?;
    }
    let pool = small_pool(&gw.server, database, 1).await?;
    // The first account on an empty database owns the company (0633), as
    // `bootstrap_admin` does for a single-business node.
    sqlx::query(
        "INSERT INTO app_user (id, username, display_name, password_hash, role, role_code, created_by)
         VALUES ($1, $2, $3, $4, 'ADMIN', 'OWNER', 'sandbox-signup')",
    )
    .bind(Uuid::new_v4())
    .bind(username)
    .bind(owner_name)
    .bind(password_hash)
    .execute(&pool)
    .await?;
    pool.close().await;
    Ok(())
}

#[derive(Deserialize)]
struct SelectBusiness {
    slug: String,
}

/// Look at another business. The session belongs to the one being left.
async fn select_business(
    State(gw): Gw,
    Json(body): Json<SelectBusiness>,
) -> Result<Response, AppError> {
    let slug = body.slug.trim().to_ascii_lowercase();
    let Some((slug, name)) = business_row(&gw.control, &slug).await? else {
        return Err(AppError::NotFound(
            "no business has that code on this server".into(),
        ));
    };
    let mut response = Json(json!({ "slug": slug, "name": name })).into_response();
    choose(&gw, response.headers_mut(), Some(&slug));
    Ok(response)
}

async fn leave_business(State(gw): Gw) -> Response {
    let mut response = StatusCode::NO_CONTENT.into_response();
    choose(&gw, response.headers_mut(), None);
    response
}

/// Everything else: the chosen business's own router, request untouched.
async fn dispatch(State(gw): Gw, mut request: Request) -> Response {
    let Some(slug) = chosen_business(request.headers()) else {
        return no_business(
            StatusCode::CONFLICT,
            "business_required",
            "choose a business first",
            &gw,
            false,
        );
    };
    match gw.tenant(&slug).await {
        Ok(Some(tenant)) => {
            // Said once, resolved, for whatever inside needs to name the
            // business back to a browser (a join link does).
            if let Ok(value) = HeaderValue::from_str(&slug) {
                request.headers_mut().insert(BUSINESS_HEADER, value);
            }
            match tenant.router.clone().oneshot(request).await {
                Ok(response) => response,
                Err(never) => match never {},
            }
        }
        Ok(None) => no_business(
            StatusCode::NOT_FOUND,
            "business_unknown",
            "no business has that code on this server",
            &gw,
            true,
        ),
        Err(err) => {
            warn!(business = %slug, error = %err, "sandbox business could not be opened");
            err.into_response()
        }
    }
}

fn no_business(
    status: StatusCode,
    code: &str,
    message: &str,
    gw: &Gateway,
    forget: bool,
) -> Response {
    let mut response = (status, Json(json!({ "error": message, "code": code }))).into_response();
    if forget {
        choose(gw, response.headers_mut(), None);
    }
    response
}

// ---------------------------------------------------------------------------
// Cookies and names
// ---------------------------------------------------------------------------

fn chosen_business(headers: &HeaderMap) -> Option<String> {
    headers
        .get(BUSINESS_HEADER)
        .and_then(|v| v.to_str().ok())
        .map(str::to_owned)
        .or_else(|| {
            headers
                .get_all(header::COOKIE)
                .iter()
                .filter_map(|v| v.to_str().ok())
                .find_map(|v| security::cookie_value(v, BUSINESS_COOKIE))
        })
        .map(|s| s.trim().to_ascii_lowercase())
        .filter(|s| is_slug(s))
}

/// Set (or clear) the business cookie, and clear the session: an account
/// lives in one business's database, so its session means nothing in the
/// next one — and a stale cookie is how the next sign-in would look broken.
fn choose(gw: &Gateway, headers: &mut HeaderMap, slug: Option<&str>) {
    let secure = gw.config.auth_cookie_secure;
    let business = match slug {
        Some(slug) => {
            security::set_cookie(BUSINESS_COOKIE, slug, BUSINESS_COOKIE_MAX_AGE, secure, true)
        }
        None => security::clear_cookie(BUSINESS_COOKIE, secure, true),
    };
    for cookie in [
        business,
        security::clear_cookie(SESSION_COOKIE, secure, true),
        security::clear_cookie(CSRF_COOKIE, secure, false),
    ] {
        if let Ok(value) = HeaderValue::from_str(&cookie) {
            headers.append(header::SET_COOKIE, value);
        }
    }
}

async fn business_row(control: &PgPool, slug: &str) -> Result<Option<(String, String)>, AppError> {
    Ok(
        sqlx::query("SELECT slug, name FROM business WHERE slug=$1 AND status='ACTIVE'")
            .bind(slug)
            .fetch_optional(control)
            .await?
            .map(|row| (row.get("slug"), row.get("name"))),
    )
}

/// `Toko Budi Jaya!` → `toko-budi-jaya`. Never shorter than three characters.
fn slugify(name: &str) -> String {
    let mut slug = String::new();
    for c in name.to_lowercase().chars() {
        if c.is_ascii_alphanumeric() {
            slug.push(c);
        } else if !slug.is_empty() && !slug.ends_with('-') {
            slug.push('-');
        }
        if slug.len() >= 40 {
            break;
        }
    }
    let slug = slug.trim_matches('-').to_owned();
    if slug.len() < 3 {
        format!("biz-{}", &Uuid::new_v4().simple().to_string()[..6])
    } else {
        slug
    }
}

fn is_slug(s: &str) -> bool {
    (3..=40).contains(&s.len())
        && s.chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
        && !s.starts_with('-')
        && !s.ends_with('-')
}

fn is_identifier(s: &str) -> bool {
    (1..=50).contains(&s.len())
        && s.chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

fn env_opt(name: &str) -> Option<String> {
    env::var(name)
        .ok()
        .map(|v| v.trim().to_owned())
        .filter(|v| !v.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slugs_come_from_names() {
        assert_eq!(slugify("Toko Budi Jaya!"), "toko-budi-jaya");
        assert_eq!(slugify("  CV. Maju -- Terus "), "cv-maju-terus");
        assert!(slugify("é").starts_with("biz-"));
        assert!(is_slug(&slugify(
            "A very long business name that keeps going and going"
        )));
    }

    #[test]
    fn only_slugs_choose_a_business() {
        assert!(is_slug("toko-budi"));
        assert!(!is_slug("toko_budi"));
        assert!(!is_slug("-toko"));
        assert!(!is_slug("ab"));
        assert!(!is_slug("x\"; DROP DATABASE"));
    }
}
