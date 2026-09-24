//! General Affairs' own facts: the register's upkeep side, the contracts
//! behind the bills, the repairs, the supplies.
//!
//! # Where the line is
//!
//! GA holds what it produces and Finance holds what it produces, and the two
//! meet through references rather than copies. An asset's LOCATION is GA's; its
//! cost is Finance's, on `asset_capitalization`. A contract's VALUE is GA's; the
//! bills raised under it are Finance's, and GA reads their total back by asking
//! which of them point at the contract. Nothing in this module writes a journal
//! and nothing here chooses a general-ledger account: GA says what KIND of thing
//! happened — the class, the contract type, the repair object, the supply
//! category — and Finance's `account_map` turns that into an account.
//!
//! # One module rather than a table each
//!
//! Every table here is small and none of them is interesting on its own. What
//! is interesting is the overview, which reads all of them at once and is the
//! screen somebody opens first: what expires, what is overdue, what arrived and
//! has not been looked at. Keeping the readers next to each other is what makes
//! that one query readable.

use chrono::{DateTime, NaiveDate, Utc};
use serde::Serialize;
use sqlx::{PgPool, Row};

use crate::cloud::application::AppError;

/// One thing on the overview that wants somebody's attention.
///
/// Deliberately not a record: it is a POINTER to one, with the two facts that
/// put it on the list — what it is called and the date that got it there. The
/// screen turns `kind` and `id` into a link; nothing here is edited from the
/// overview, and a copy of a record is a second copy to keep in step.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct GaAttention {
    /// Which GA object this points at — `asset`, `contract`, `document`,
    /// `repair`, `task`, `replacement`, `supply_request`.
    pub kind: String,
    pub id: String,
    /// The one line the row is read by.
    pub label: String,
    /// The second line, when the kind has one: the class, the site, the party.
    pub detail: Option<String>,
    /// The date that put it on the list — expires on, due on, filed on.
    pub on: Option<String>,
}

/// What the overview is made of, section by section.
///
/// Sections rather than one flat list, because each is a different question
/// with a different threshold and a different answer to "what do I do about
/// it", and a screen that cannot tell an expiring permit from an overdue
/// service is a screen nobody can act on. Each list is capped: an overview is
/// a nudge, not a report, and a hundred rows of anything is a report.
///
/// A section that grows here is a section the screen grows with it. The shape
/// is deliberately flat rather than a `Vec<GaAttention>` — a kind string the
/// client has to switch on is a kind string nobody's compiler checks.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct GaOverview {
    /// The business day the thresholds were applied on, so a screen can say
    /// "as of" without guessing the server's clock.
    pub generated_on: String,
    /// Assets the register holds as DRAFT: the bill came first, the thing has
    /// arrived, and nobody has said where it is or who holds it.
    pub draft_assets: Vec<GaAttention>,
}

/// How many rows one section of the overview may carry.
///
/// Ten is what fits under a heading without becoming a list somebody scrolls,
/// which is the point of an overview. The count that matters is on the row's
/// own screen; this is the nudge.
const SECTION_LIMIT: i64 = 10;

/// Everything GA wants somebody to look at, as of `today`.
pub async fn ga_overview(pool: &PgPool, today: NaiveDate) -> Result<GaOverview, AppError> {
    let rows = sqlx::query(
        "SELECT asset_id::text, asset_number, name, category_code, site_id, registered_at
           FROM fixed_asset
          WHERE status = 'DRAFT'
          ORDER BY registered_at, asset_number
          LIMIT $1",
    )
    .bind(SECTION_LIMIT)
    .fetch_all(pool)
    .await?;

    let draft_assets = rows
        .iter()
        .map(|row| {
            let class: String = row.try_get("category_code")?;
            let site: String = row.try_get("site_id")?;
            let registered: Option<DateTime<Utc>> = row.try_get("registered_at")?;
            Ok(GaAttention {
                kind: "asset".into(),
                id: row.try_get("asset_id")?,
                label: row.try_get("name")?,
                detail: Some(format!("{class} · {site}")),
                on: registered.map(|at| at.date_naive().to_string()),
            })
        })
        .collect::<Result<Vec<GaAttention>, AppError>>()?;

    Ok(GaOverview {
        generated_on: today.to_string(),
        draft_assets,
    })
}
