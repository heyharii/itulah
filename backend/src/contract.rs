//! The auth wire, declared once for every node that speaks it.
//!
//! Cloud and both Edge runtimes hand a browser the same login and session
//! shapes. Until now each wrote its own: `cloud::application::LoginRequest`
//! and a second, private `LoginRequest` inside `edge::http`, plus two
//! hand-built `json!` bodies that no type ever checked. That is the same
//! two-copies-of-one-truth this repository has paid for three times already —
//! and on the auth path the failure is a login screen that compiles, ships,
//! and rejects everybody.
//!
//! These types are the wire. They carry the `ts_rs` derives, so the browser's
//! TypeScript is generated from the very structs the servers serialise rather
//! than hand-mirrored beside them.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// The role ladder as it appears on the wire.
///
/// `cloud::domain::Role` and `edge::domain::Role` are separate types with
/// separate policy attached; both render to these three strings. This is the
/// rendering, and the only one a browser ever sees.
#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub enum Role {
    Cashier,
    Supervisor,
    Admin,
}

impl Role {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Cashier => "CASHIER",
            Self::Supervisor => "SUPERVISOR",
            Self::Admin => "ADMIN",
        }
    }
}

/// The wire role back into Cloud's own, which carries the policy.
impl From<Role> for crate::cloud::domain::Role {
    fn from(role: Role) -> Self {
        match role {
            Role::Cashier => Self::Cashier,
            Role::Supervisor => Self::Supervisor,
            Role::Admin => Self::Admin,
        }
    }
}

impl From<crate::cloud::domain::Role> for Role {
    fn from(role: crate::cloud::domain::Role) -> Self {
        match role {
            crate::cloud::domain::Role::Cashier => Self::Cashier,
            crate::cloud::domain::Role::Supervisor => Self::Supervisor,
            crate::cloud::domain::Role::Admin => Self::Admin,
        }
    }
}

impl From<crate::edge::domain::Role> for Role {
    fn from(role: crate::edge::domain::Role) -> Self {
        match role {
            crate::edge::domain::Role::Cashier => Self::Cashier,
            crate::edge::domain::Role::Supervisor => Self::Supervisor,
            crate::edge::domain::Role::Admin => Self::Admin,
        }
    }
}

/// What a sign-in form sends. Identical at every node.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct LoginRequest {
    pub username: String,
    pub password: String,
}

/// The signed-in identity carried back by a successful login.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SessionUser {
    pub id: Uuid,
    pub username: String,
    pub display_name: String,
    pub role: Role,
    /// Edge only: `LOCAL` for a break-glass identity, otherwise the Cloud
    /// projection it came from. Cloud omits the field entirely.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub source: Option<String>,
}

/// The login response.
///
/// `token` is for native and CLI callers, and for a browser talking to a
/// *second* node. A surface served by its node ignores it and uses the
/// HttpOnly cookie set alongside: a token in browser storage outlives the tab
/// it was meant for and is readable by anything else running on the page.
///
/// The exception is the hub's Operations module, which reads a DC edge node
/// while being served by the cloud. Cloud and Edge name their cookies
/// identically (`security.rs`), so on one origin they are one cookie and
/// signing in to the warehouse signs you out of the centre. That surface holds
/// this token in `sessionStorage` — a tab, not a machine — and sends no
/// cookies to the edge at all.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct LoginResponse {
    pub token: String,
    pub token_type: String,
    pub expires_at_epoch: i64,
    pub user: SessionUser,
}

/// `GET /api/v1/auth/me` at Cloud.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CloudMe {
    pub username: String,
    pub display_name: String,
    pub role: Role,
}

/// `GET /api/v1/auth/me` at an Edge.
///
/// Wider than Cloud's because an Edge answer has to say which identity store
/// the session came from and which site the caller is standing in.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct EdgeMe {
    pub id: Uuid,
    pub username: String,
    pub display_name: String,
    pub role: Role,
    pub source: String,
    pub site_id: Option<String>,
}

/// What an Edge's outbox is doing, as the Edge itself reports it.
///
/// An Edge uploads on its own cadence and nobody watching a till can see
/// whether today's sales have reached head office. Until now nothing exposed
/// this at all: Cloud has eleven `/sync` endpoints and an Edge had none, so a
/// sender that had been failing for hours looked exactly like one with nothing
/// to send — the agent only logs a cycle that advanced.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct EdgeSyncStatus {
    /// Absent when this node has no sync origin yet, which means the sender
    /// cannot run at all rather than that it is merely idle.
    pub origin_id: Option<String>,
    pub generation: i64,
    /// Facts captured locally and not yet acknowledged by Cloud. This is the
    /// number a shop actually cares about: it is what would be lost if the
    /// site burned down tonight.
    pub pending_facts: i64,
    /// The highest sequence Cloud has confirmed as durable.
    pub durable_through: i64,
    /// Facts Cloud refused. These do not retry; they need a person.
    pub dead_lettered: i64,
    pub consecutive_failures: u32,
    /// Set while the breaker is open. Retries are suspended until it passes,
    /// and it survives a restart — it is stored, not held in memory.
    pub breaker_open_until: Option<DateTime<Utc>>,
    pub last_success_at: Option<DateTime<Utc>>,
    pub last_error: Option<String>,
    pub last_error_at: Option<DateTime<Utc>>,
    /// False when SYNC_UPLOAD_URL is unset: capture still runs and the backlog
    /// is still durable, but nothing is being sent anywhere.
    pub sender_enabled: bool,
    pub upload_url: Option<String>,
    pub interval_seconds: Option<i64>,
}

/// The answer to "send it now".
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct EdgeSyncTriggered {
    /// False when this node has no sender configured, so the caller is told
    /// the button did nothing rather than being shown a success.
    pub triggered: bool,
    pub reason: Option<String>,
}

// ---- Account administration ----------------------------------------------
//
// These are what an administration screen sends. They were declared in
// `cloud::application` where no generator could see them, and `edge::http`
// carried a second private copy of ChangePasswordRequest — the same
// two-copies-of-one-truth that LoginRequest had. Declared here they are
// generated for the browser like everything else on the wire.

/// Somebody changing their OWN password. The old one is required; an
/// administrator resetting a forgotten password uses `ResetPasswordRequest`,
/// which deliberately does not ask for it.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ChangePasswordRequest {
    pub current_password: String,
    pub new_password: String,
}

/// An administrator setting a password for somebody who cannot supply the old
/// one. Without this a forgotten password retires the account permanently:
/// usernames are never released and there is no delete.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ResetPasswordRequest {
    pub new_password: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CreateUserRequest {
    pub username: String,
    pub display_name: String,
    pub password: String,
    pub role: Role,
}

/// Suspending or restoring an account everywhere at once. Suspending it at one
/// Edge only is a different request against the Edge assignment.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SetUserActiveRequest {
    pub active: bool,
}

/// Promotion or demotion at Cloud. This is the head-office role only: the same
/// person's role AT an Edge lives on their Edge assignment, because a
/// supervisor at head office can be an ordinary cashier at the till.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SetUserRoleRequest {
    pub role: Role,
}

/// Giving somebody access to one Edge, or rotating the PIN they use there.
///
/// `edge_password` is separate from their Cloud password on purpose: the same
/// person signs in at head office with one credential and at a till with
/// another, and the Edge never receives the Cloud one.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct UpsertEdgeAssignmentRequest {
    pub origin_id: String,
    pub user_id: Uuid,
    pub role: Role,
    /// Hashed immediately; never stored in the clear and never sent to the Edge.
    pub edge_password: String,
    pub offline_ttl_seconds: Option<i32>,
}

/// Issuing a login to somebody who has an employment record and no credential.
///
/// One request rather than three, because the three it replaces had to be sent
/// in order from two different modules of the console and any pause between
/// them left something half-done — see `postgres::users::provision_account`.
///
/// `role` is the rung at the centre; `edge.role` is the rung at the till. They
/// are separate fields because they are separate decisions: the same person can
/// be a supervisor at head office and an ordinary cashier at a shop she is
/// covering.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ProvisionAccountRequest {
    pub username: String,
    pub display_name: String,
    /// The first password, which the holder is expected to change. Never
    /// stored: hashed on arrival, like every other password on this surface.
    pub password: String,
    /// The rung at the centre.
    pub role: Role,
    /// Access to one node, when the person works at one. Absent for head
    /// office, who sign in at the centre and at no till.
    pub edge: Option<ProvisionEdgeAccess>,
    /// Why this credential is this person's. The only durable statement of it:
    /// the activity log keeps request bodies out deliberately, so without this
    /// nothing anywhere records the decision.
    pub reason: String,
}

/// The till half of issuing a login.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ProvisionEdgeAccess {
    pub origin_id: String,
    pub role: Role,
    /// The PIN used at the till. Separate from the Cloud password on purpose:
    /// the Edge never receives the Cloud one.
    pub edge_password: String,
    pub offline_ttl_seconds: Option<i32>,
}

/// What issuing a login produced. The password is deliberately not echoed —
/// whoever typed it has it, and a response carrying it would put a live
/// credential in a browser cache and a server log.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ProvisionedAccount {
    pub user_id: Uuid,
    pub username: String,
    pub display_name: String,
    pub role: String,
    pub employee_id: String,
    /// The node this person may now sign in at, when one was granted, and the
    /// policy version that carries the grant. A screen that shows the version
    /// is showing that the node has actually been told.
    pub edge_origin_id: Option<String>,
    pub edge_role: Option<String>,
    pub policy_version: Option<i64>,
}

/// Suspending or restoring somebody at ONE Edge, leaving every other node
/// alone. Rotating their PIN does not do this and must not: those are two
/// different decisions.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SetEdgeAssignmentActiveRequest {
    pub active: bool,
}
