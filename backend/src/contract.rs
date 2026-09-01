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
/// `token` is for native and CLI callers. A browser ignores it and uses the
/// HttpOnly cookie set alongside: a token in browser storage outlives the tab
/// it was meant for and is readable by anything else running on the page.
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
