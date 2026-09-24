//! The register's own list of asset classes.
//!
//! # Why this is a table and not an account family any more
//!
//! Until the forty-account chart, an asset's class WAS an account: the
//! client's chart had thirty-six racks under `1021507`, seven kinds of
//! furniture under `1021502`, and `fixed_asset.category_code` pointed straight
//! at `ledger_account`. That had one virtue — no second list to keep — and one
//! live bug, which is why it is gone.
//!
//! The bug: the importer wrote ten-character sub-types (`1021507001` for
//! *OE - Rak 1*) and the seed mapped seven-character families (`1021507`).
//! Both are account codes, both pass a foreign key to `ledger_account`, and
//! `resolve_account_code` matched the qualifier EXACTLY — so every imported
//! asset resolved to nothing and the depreciation run refused it. Nothing
//! reported the mismatch, because at the level of types there was none.
//!
//! Now the class is a code of its own: a short name with no arithmetic in it,
//! one row per kind of thing, and `fixed_asset.category_code` and
//! `asset_class_reserve.class_code` both point here. The account it lands in
//! is `1601`, `1602` or `1610` for every one of them, and WHICH class it is
//! stays the `account_map` qualifier — so the map still chooses the expense
//! and contra accounts per class, as it always did, but out of a namespace
//! that cannot be spelled two ways.
//!
//! # `kind`, and why it is not `ChargeKind`
//!
//! `kind` says what sort of thing the class holds — `PPE`, `OE`,
//! `INTANGIBLE`, `DEFERRED`. `ChargeKind` (in `domain::depreciation`) says
//! what the monthly charge is CALLED, and it is a property of the
//! capitalisation, not of the class: two assets in one class can be assessed
//! differently, and the client's own register writes `NON DEPRECIABLE`
//! against operating equipment it charges every month.

use serde::Serialize;
use sqlx::{PgPool, Row};

use crate::cloud::application::AppError;

/// The class code for work still being built.
///
/// The one class code named in Rust, and it earns that the way `ASSET_FAMILIES`
/// used to: this is not choosing a class, it is recognising the one that is not
/// a resting place. Finished work must be re-filed as what it became, because
/// capitalising something and leaving it here would charge a building's
/// depreciation against work-in-progress for the rest of its life — which is
/// the omission `assess_asset` was found making, silently, in 0242.
///
/// **This string has to be the one 0288 seeds**, slugged from the client's own
/// `1031803 Contract In Progress` the way every other class code is slugged
/// from the client's own name for it. It is here, once, so that being wrong is
/// one edit: `asset_classes()` will show whether the register has a row with
/// this code, and nothing else in the estate spells it.
pub const WORK_IN_PROGRESS_CLASS: &str = "CONTRACT_IN_PROGRESS";

/// One class of thing the register keeps.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct AssetClass {
    pub class_code: String,
    /// The client's own name for the class, never translated.
    pub name: String,
    pub name_en: Option<String>,
    /// `PPE`, `OE`, `INTANGIBLE` or `DEFERRED`.
    pub kind: String,
    /// Which of the eleven forms this class is filled in on — `LAND`,
    /// `BUILDING`, `TECH`, `VEHICLE`, `FFE`, `IT`, `AUDIO`, `OE`, `SOFTWARE`,
    /// `DEFERRED` or `CIP`.
    ///
    /// Separate from `kind` and separate from the accounts, because it answers
    /// a third question: what does somebody have to WRITE DOWN about one of
    /// these. `AIR_CONDITIONER` and `LIFT` are two classes — two sets of
    /// accounts, two depreciation lives — and one form, a machine with a
    /// capacity and a warranty. See migration 0356.
    pub build: String,
    /// The client's own ten-digit template this class came from —
    /// `1021507001` for *OE - Rak 1*. Never NULL: every class here was a
    /// family in their chart, and this is the number their register is
    /// written in. It is the answer to "which one is this really", asked by
    /// somebody holding a printout from the old system.
    pub legacy_code: String,
    pub is_active: bool,
    /// How many registered assets are filed under it. Zero is worth seeing:
    /// a class nobody uses is a class somebody invented by mistake.
    pub asset_count: i64,
}

/// The classes, in an envelope.
///
/// A named field rather than a bare array, for the reason every other list
/// here has one: an array cannot grow a total or a facet without every caller
/// changing shape, and a screen should not have to know which of this estate's
/// lists answer with an envelope and which with an array.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct AssetClassList {
    pub classes: Vec<AssetClass>,
}

/// The classes: what may an asset be filed as.
///
/// `kind` narrows it, because the disposal and amortisation screens each care
/// about one sort.
pub async fn asset_classes(pool: &PgPool, kind: Option<&str>) -> Result<AssetClassList, AppError> {
    let wanted = kind
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_ascii_uppercase);
    let rows = sqlx::query(
        "SELECT c.class_code, c.name, c.name_en, c.kind, c.build, c.legacy_code, c.is_active,
                (SELECT count(*) FROM fixed_asset a
                  WHERE a.category_code = c.class_code)::bigint AS asset_count
           FROM asset_class c
          WHERE $1::text IS NULL OR c.kind = $1
          ORDER BY c.kind, c.class_code",
    )
    .bind(wanted.as_deref())
    .fetch_all(pool)
    .await?;
    let classes = rows
        .iter()
        .map(|row| {
            Ok(AssetClass {
                class_code: row.try_get("class_code")?,
                name: row.try_get("name")?,
                name_en: row.try_get("name_en")?,
                kind: row.try_get("kind")?,
                build: row.try_get("build")?,
                legacy_code: row.try_get("legacy_code")?,
                is_active: row.try_get("is_active")?,
                asset_count: row.try_get("asset_count")?,
            })
        })
        .collect::<Result<Vec<AssetClass>, AppError>>()?;
    Ok(AssetClassList { classes })
}

/// Refuse a class code that is not one, before the foreign key does.
///
/// Returns the class's `kind`, because every caller that checks the code also
/// wants to know what sort of thing it is — an intangible is amortised and an
/// operating-equipment class is reserved against, and both of those decisions
/// are made at the moment the code is validated.
pub async fn assert_asset_class(
    executor: impl sqlx::PgExecutor<'_>,
    class_code: &str,
) -> Result<String, AppError> {
    let code = class_code.trim();
    if code.is_empty() {
        return Err(AppError::Validation(
            "an asset has to say what kind of thing it is; name one of the register's classes"
                .into(),
        ));
    }
    let row = sqlx::query(
        "SELECT c.kind, c.is_active,
                (SELECT string_agg(x.class_code, ', ' ORDER BY x.class_code)
                   FROM (SELECT class_code FROM asset_class
                          WHERE is_active ORDER BY class_code LIMIT 8) x) AS known
           FROM asset_class c WHERE c.class_code = $1",
    )
    .bind(code)
    .fetch_optional(executor)
    .await?;
    match row {
        None => Err(AppError::Validation(format!(
            "{code} is not an asset class; the register keeps its own list of them"
        ))),
        Some(row) => {
            if !row.try_get::<bool, _>("is_active")? {
                let known: Option<String> = row.try_get("known")?;
                return Err(AppError::Validation(format!(
                    "{code} has been retired, so nothing new is filed under it; the classes \
                     still in use are {}",
                    known.unwrap_or_default()
                )));
            }
            Ok(row.try_get("kind")?)
        }
    }
}
