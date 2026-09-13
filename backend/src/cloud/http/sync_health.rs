//! `GET /api/v1/sync/health` — both lanes of the sync, every node, and the
//! security posture, in one read the console can poll.
//!
//! One endpoint rather than a screen stitching six together: a dashboard that
//! asks `/sync/status`, `/sync/fleet`, `/sync/dead-letters`, `/auth/users`,
//! `/auth/rfid-devices` and `/audit` every thirty seconds is six scans of six
//! tables to draw one verdict, and the verdict would be computed in a browser
//! where nothing can test it. Here the thresholds are policy from `AppConfig`
//! and the classification is a pure function with tests beside it.
//!
//! Admin-only, deliberately — see `admin_prefixes` in `domain/auth.rs`. The
//! sibling reads `/sync/fleet` and `/sync/status` fall through to Cashier; this
//! one carries blocked-command reasons, request-log failure counts and the
//! list of open exposures, none of which belongs on a till.

use crate::cloud::{
    application::{AppError, AppState},
    postgres as infrastructure,
};
use axum::{extract::State, Json};
use chrono::Utc;

/// Matches `list_fleet_pools`, which is what certifies a fleet total: a node
/// whose checkpoint is older than this has stopped vouching for its own
/// positions, and the two screens must agree on when that happens.
const CHECKPOINT_STALE_AFTER_SECONDS: i64 = 300;

pub async fn sync_health(
    State(s): State<AppState>,
) -> Result<Json<infrastructure::SyncFleetHealth>, AppError> {
    let policy = infrastructure::HealthPolicy {
        // The same knob `/api/v1/health` uses for "the backlog is stale": a
        // node allowed to be that quiet before the centre calls itself
        // degraded is allowed to be exactly that quiet before it is called
        // silent here.
        silent_after_seconds: s.config.sync_degraded_after_seconds,
        checkpoint_stale_after_seconds: CHECKPOINT_STALE_AFTER_SECONDS,
        auth_enabled: s.config.jwt_secret.is_some(),
    };
    let health = infrastructure::sync_fleet_health(&s.db, policy, Utc::now()).await?;
    Ok(Json(health))
}
