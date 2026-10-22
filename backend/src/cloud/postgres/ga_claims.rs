//! Insurance claims (0975): damage to a covered thing, claimed under its
//! policy, and the repair the claim pays for.
//!
//! # The ladder
//!
//! Draft → Submitted → Surveyed → Approved → Paid, with Rejected as the side
//! exit after the insurer has seen it. Each rung is a verb with the facts that
//! rung brings: the insurer's own claim number at submission, the surveyor and
//! the day at the survey, the approved amount and the deductible at the
//! decision, the day the insurer's money arrived at payment.
//!
//! # Three events, not one
//!
//! Finishing the repair, the insurer approving the claim and the insurer's
//! money arriving are different days with different people behind them. The
//! repair stays a `ga_repair` with its own ladder; the claim names it. The
//! money stays Finance's: GA writes down that it arrived and, when it knows,
//! the BKM Finance booked it on.
//!
//! # What a claim may be about
//!
//! A vehicle or property policy that is in force (activated, not a draft), for
//! damage inside its window, to a thing that was on its roster on the day it
//! happened — or, under a property policy, to the place itself.

use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Row};
use uuid::Uuid;

use crate::cloud::application::AppError;

/// The two policy types a claim can be made under.
pub const CLAIM_POLICY_TYPES: [&str; 2] = ["ASURANSI_KENDARAAN", "ASURANSI_PROPERTI"];

/// One claim, with the names its ids stand for.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct GaInsuranceClaimRow {
    pub claim_id: Uuid,
    /// The policy it is claimed under.
    pub contract_id: Uuid,
    pub contract_number: Option<String>,
    pub contract_type: String,
    pub contract_type_name: String,
    /// The insurer: the policy's supplier, or its free-text party.
    pub insurer_name: Option<String>,
    pub asset_id: Option<Uuid>,
    pub asset_number: Option<String>,
    pub asset_name: Option<String>,
    pub site_id: String,
    pub site_name: Option<String>,
    pub incident_on: NaiveDate,
    pub description: String,
    pub estimated_loss_minor: Option<i64>,
    /// `DRAFT`, `SUBMITTED`, `SURVEYED`, `APPROVED`, `PAID` or `REJECTED`.
    pub status: String,
    pub insurer_claim_number: Option<String>,
    pub submitted_on: Option<NaiveDate>,
    pub surveyed_on: Option<NaiveDate>,
    pub surveyor: Option<String>,
    pub decided_on: Option<NaiveDate>,
    pub approved_minor: Option<i64>,
    pub deductible_minor: Option<i64>,
    pub rejected_reason: Option<String>,
    /// The repair the claim pays for.
    pub repair_id: Option<Uuid>,
    pub repair_title: Option<String>,
    pub repair_status: Option<String>,
    pub paid_on: Option<NaiveDate>,
    pub paid_minor: Option<i64>,
    /// The BKM Finance booked the insurer's money on, when GA knows it.
    pub cash_document_id: Option<Uuid>,
    pub cash_document_number: Option<String>,
    pub notes: Option<String>,
    pub created_by: String,
    pub created_at: DateTime<Utc>,
    pub version: i32,
}

/// Which claims a caller wants: one policy's, one asset's, or one site's.
#[derive(Clone, Debug, Default)]
pub struct GaInsuranceClaimScope {
    pub contract_id: Option<Uuid>,
    pub asset_id: Option<Uuid>,
    pub site_id: Option<String>,
    pub limit: i64,
}

pub const DEFAULT_GA_CLAIM_LIMIT: i64 = 200;
const MAX_GA_CLAIM_LIMIT: i64 = 1000;

/// Report damage under a policy.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
#[cfg_attr(feature = "ts", ts(optional_fields = nullable))]
pub struct RecordGaInsuranceClaimRequest {
    pub contract_id: Uuid,
    /// The damaged thing; empty for damage to the place itself (a property
    /// policy only).
    #[serde(default)]
    pub asset_id: Option<Uuid>,
    /// The place, for damage to the place under a policy that covers several
    /// (`ALL_STORES`). Ignored when the asset or the policy already says.
    #[serde(default)]
    pub site_id: Option<String>,
    pub incident_on: NaiveDate,
    pub description: String,
    #[serde(default)]
    pub estimated_loss_minor: Option<i64>,
    #[serde(default)]
    pub notes: Option<String>,
}

/// Draft → Submitted: the insurer has the claim.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
#[cfg_attr(feature = "ts", ts(optional_fields = nullable))]
pub struct SubmitGaInsuranceClaimRequest {
    #[serde(default)]
    pub insurer_claim_number: Option<String>,
    pub submitted_on: NaiveDate,
    #[serde(default)]
    pub expected_version: Option<i32>,
}

/// Submitted → Surveyed: the insurer's surveyor has seen the damage.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
#[cfg_attr(feature = "ts", ts(optional_fields = nullable))]
pub struct SurveyGaInsuranceClaimRequest {
    pub surveyed_on: NaiveDate,
    #[serde(default)]
    pub surveyor: Option<String>,
    #[serde(default)]
    pub expected_version: Option<i32>,
}

/// Surveyed → Approved: the insurer's letter says what it pays and what we
/// pay. The repair it pays for is named, or opened here at the workshop the
/// insurer named.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
#[cfg_attr(feature = "ts", ts(optional_fields = nullable))]
pub struct ApproveGaInsuranceClaimRequest {
    pub decided_on: NaiveDate,
    pub approved_minor: i64,
    #[serde(default)]
    pub deductible_minor: Option<i64>,
    /// A repair already recorded for this damage.
    #[serde(default)]
    pub repair_id: Option<Uuid>,
    /// Or open one now, at this workshop. Not both.
    #[serde(default)]
    pub open_repair_supplier_id: Option<Uuid>,
    #[serde(default)]
    pub expected_version: Option<i32>,
}

/// Submitted or Surveyed → Rejected, with the insurer's reason.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
#[cfg_attr(feature = "ts", ts(optional_fields = nullable))]
pub struct RejectGaInsuranceClaimRequest {
    pub decided_on: NaiveDate,
    pub reason: String,
    #[serde(default)]
    pub expected_version: Option<i32>,
}

/// Approved → Paid: the insurer's money arrived.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
#[cfg_attr(feature = "ts", ts(optional_fields = nullable))]
pub struct PayGaInsuranceClaimRequest {
    pub paid_on: NaiveDate,
    /// What reached us; zero when the insurer paid the workshop directly.
    pub paid_minor: i64,
    /// The BKM Finance booked it on, when GA knows it.
    #[serde(default)]
    pub cash_document_id: Option<Uuid>,
    #[serde(default)]
    pub expected_version: Option<i32>,
}

/// Name the repair a claim pays for, before it is settled.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
#[cfg_attr(feature = "ts", ts(optional_fields = nullable))]
pub struct LinkGaClaimRepairRequest {
    pub repair_id: Uuid,
    #[serde(default)]
    pub expected_version: Option<i32>,
}

fn trimmed(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(str::to_string)
}

const CLAIM_SELECT: &str =
    "SELECT k.*, c.contract_number, c.contract_type, ct.name AS contract_type_name,
        COALESCE(sup.name, c.counterparty_name) AS insurer_name,
        a.asset_number, a.name AS asset_name, st.name AS site_name,
        r.title AS repair_title, r.status AS repair_status,
        cd.number AS cash_document_number
   FROM ga_insurance_claim k
   JOIN ga_contract c ON c.contract_id = k.contract_id
   JOIN contract_type ct ON ct.code = c.contract_type
   LEFT JOIN supplier sup ON sup.supplier_id = c.supplier_id
   LEFT JOIN fixed_asset a ON a.asset_id = k.asset_id
   LEFT JOIN site st ON st.id = k.site_id
   LEFT JOIN ga_repair r ON r.repair_id = k.repair_id
   LEFT JOIN cash_document cd ON cd.document_id = k.cash_document_id";

fn to_claim(row: &sqlx::postgres::PgRow) -> Result<GaInsuranceClaimRow, AppError> {
    Ok(GaInsuranceClaimRow {
        claim_id: row.try_get("claim_id")?,
        contract_id: row.try_get("contract_id")?,
        contract_number: row.try_get("contract_number")?,
        contract_type: row.try_get("contract_type")?,
        contract_type_name: row.try_get("contract_type_name")?,
        insurer_name: row.try_get("insurer_name")?,
        asset_id: row.try_get("asset_id")?,
        asset_number: row.try_get("asset_number")?,
        asset_name: row.try_get("asset_name")?,
        site_id: row.try_get("site_id")?,
        site_name: row.try_get("site_name")?,
        incident_on: row.try_get("incident_on")?,
        description: row.try_get("description")?,
        estimated_loss_minor: row.try_get("estimated_loss_minor")?,
        status: row.try_get("status")?,
        insurer_claim_number: row.try_get("insurer_claim_number")?,
        submitted_on: row.try_get("submitted_on")?,
        surveyed_on: row.try_get("surveyed_on")?,
        surveyor: row.try_get("surveyor")?,
        decided_on: row.try_get("decided_on")?,
        approved_minor: row.try_get("approved_minor")?,
        deductible_minor: row.try_get("deductible_minor")?,
        rejected_reason: row.try_get("rejected_reason")?,
        repair_id: row.try_get("repair_id")?,
        repair_title: row.try_get("repair_title")?,
        repair_status: row.try_get("repair_status")?,
        paid_on: row.try_get("paid_on")?,
        paid_minor: row.try_get("paid_minor")?,
        cash_document_id: row.try_get("cash_document_id")?,
        cash_document_number: row.try_get("cash_document_number")?,
        notes: row.try_get("notes")?,
        created_by: row.try_get("created_by")?,
        created_at: row.try_get("created_at")?,
        version: row.try_get("version")?,
    })
}

/// The claims of a policy, an asset or a site, the latest damage first.
pub async fn ga_claims(
    pool: &PgPool,
    scope: &GaInsuranceClaimScope,
) -> Result<Vec<GaInsuranceClaimRow>, AppError> {
    let sql = format!(
        "{CLAIM_SELECT}
          WHERE ($1::uuid IS NULL OR k.contract_id = $1)
            AND ($2::uuid IS NULL OR k.asset_id = $2)
            AND ($3::text IS NULL OR k.site_id = $3)
          ORDER BY k.incident_on DESC, k.created_at DESC, k.claim_id
          LIMIT $4"
    );
    let rows = sqlx::query(&sql)
        .bind(scope.contract_id)
        .bind(scope.asset_id)
        .bind(&scope.site_id)
        .bind(scope.limit.clamp(1, MAX_GA_CLAIM_LIMIT))
        .fetch_all(pool)
        .await?;
    rows.iter().map(to_claim).collect()
}

pub async fn ga_claim(pool: &PgPool, claim_id: Uuid) -> Result<GaInsuranceClaimRow, AppError> {
    let sql = format!("{CLAIM_SELECT} WHERE k.claim_id = $1");
    let row = sqlx::query(&sql)
        .bind(claim_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound("insurance claim".into()))?;
    to_claim(&row)
}

/// The day a step names may not be after today: it is something that happened.
fn not_after_today(day: NaiveDate, today: NaiveDate, what: &str) -> Result<(), AppError> {
    if day > today {
        return Err(AppError::Validation(format!(
            "{what} is something that happened; it cannot be dated after today"
        )));
    }
    Ok(())
}

/// Report damage under a policy.
pub async fn ga_claim_record(
    pool: &PgPool,
    request: &RecordGaInsuranceClaimRequest,
    actor: &str,
    today: NaiveDate,
) -> Result<GaInsuranceClaimRow, AppError> {
    let description = trimmed(Some(&request.description))
        .ok_or_else(|| AppError::Validation("say what happened".into()))?;
    if request.estimated_loss_minor.is_some_and(|value| value < 0) {
        return Err(AppError::Validation(
            "an estimated loss cannot be negative".into(),
        ));
    }
    not_after_today(request.incident_on, today, "the damage")?;

    let policy = sqlx::query(
        "SELECT contract_type, status, starts_on, ends_on, site_id, site_scope
           FROM ga_contract WHERE contract_id = $1",
    )
    .bind(request.contract_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::Validation("the policy the claim names does not exist".into()))?;
    let contract_type: String = policy.try_get("contract_type")?;
    let status: String = policy.try_get("status")?;
    let starts_on: NaiveDate = policy.try_get("starts_on")?;
    let ends_on: Option<NaiveDate> = policy.try_get("ends_on")?;
    let policy_site: Option<String> = policy.try_get("site_id")?;
    let policy_scope: Option<String> = policy.try_get("site_scope")?;
    if !CLAIM_POLICY_TYPES.contains(&contract_type.as_str()) {
        return Err(AppError::Validation(format!(
            "a claim is made under vehicle or property insurance; {contract_type} is not a policy"
        )));
    }
    if status == "DRAFT" {
        return Err(AppError::Validation(
            "the policy is still a draft; activate it before claiming under it".into(),
        ));
    }
    if request.incident_on < starts_on || ends_on.is_some_and(|end| request.incident_on > end) {
        return Err(AppError::Validation(
            "the damage happened outside the policy's window; it was not covered then".into(),
        ));
    }

    let site_id = match request.asset_id {
        Some(asset_id) => {
            // On the roster on the day of the damage, not merely today.
            let covered = sqlx::query(
                "SELECT a.site_id FROM ga_contract_asset ca
                   JOIN fixed_asset a ON a.asset_id = ca.asset_id
                  WHERE ca.contract_id = $1 AND ca.asset_id = $2
                    AND ca.covered_from <= $3
                    AND (ca.covered_until IS NULL OR ca.covered_until >= $3)
                  LIMIT 1",
            )
            .bind(request.contract_id)
            .bind(asset_id)
            .bind(request.incident_on)
            .fetch_optional(pool)
            .await?
            .ok_or_else(|| {
                AppError::Validation(
                    "the asset was not on this policy's roster on the day of the damage".into(),
                )
            })?;
            covered.try_get::<String, _>("site_id")?
        }
        None if contract_type == "ASURANSI_KENDARAAN" => {
            return Err(AppError::Validation(
                "a vehicle claim names the vehicle that was damaged".into(),
            ));
        }
        None => match (policy_site, policy_scope.as_deref()) {
            (Some(site), _) => site,
            (None, scope) => {
                let site = trimmed(request.site_id.as_deref()).ok_or_else(|| {
                    AppError::Validation(
                        "the policy covers several places; say which one was damaged".into(),
                    )
                })?;
                let kind: Option<String> =
                    sqlx::query_scalar::<_, Option<String>>("SELECT kind FROM site WHERE id = $1")
                        .bind(&site)
                        .fetch_optional(pool)
                        .await?
                        .ok_or_else(|| {
                            AppError::Validation(format!("no site {site} in the register"))
                        })?;
                if scope == Some("ALL_STORES") && kind.as_deref() != Some("STORE") {
                    return Err(AppError::Validation(format!(
                        "{site} is not a store; this policy covers the stores"
                    )));
                }
                site
            }
        },
    };

    let claim_id: Uuid = sqlx::query_scalar(
        "INSERT INTO ga_insurance_claim
           (contract_id, asset_id, site_id, incident_on, description, estimated_loss_minor,
            notes, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING claim_id",
    )
    .bind(request.contract_id)
    .bind(request.asset_id)
    .bind(&site_id)
    .bind(request.incident_on)
    .bind(&description)
    .bind(request.estimated_loss_minor)
    .bind(trimmed(request.notes.as_deref()))
    .bind(actor)
    .fetch_one(pool)
    .await?;
    ga_claim(pool, claim_id).await
}

/// The refusal when a guarded move found nothing to move: the claim is on
/// another rung, or somebody moved it a moment ago.
///
/// `from` is the rung the move starts from: a claim still on it was changed by
/// somebody else since the caller read it (its `expected_version` is stale),
/// which is a different sentence from a claim on another rung.
async fn moved_refusal(pool: &PgPool, claim_id: Uuid, verb: &str, from: &[&str]) -> AppError {
    match ga_claim(pool, claim_id).await {
        Ok(row) if from.contains(&row.status.as_str()) => AppError::Conflict(
            "somebody changed the claim a moment ago; open it again and try once more".into(),
        ),
        Ok(row) => AppError::Conflict(format!(
            "the claim is {} now; it cannot be {verb} from there",
            row.status.to_lowercase()
        )),
        Err(error) => error,
    }
}

/// Draft → Submitted.
pub async fn ga_claim_submit(
    pool: &PgPool,
    claim_id: Uuid,
    request: &SubmitGaInsuranceClaimRequest,
    actor: &str,
    today: NaiveDate,
) -> Result<GaInsuranceClaimRow, AppError> {
    let row = ga_claim(pool, claim_id).await?;
    not_after_today(request.submitted_on, today, "the submission")?;
    if request.submitted_on < row.incident_on {
        return Err(AppError::Validation(
            "a claim is submitted after the damage, not before it".into(),
        ));
    }
    let updated = sqlx::query(
        "UPDATE ga_insurance_claim
            SET status = 'SUBMITTED', submitted_on = $2, insurer_claim_number = $3,
                updated_by = $4, updated_at = now(), version = version + 1
          WHERE claim_id = $1 AND status = 'DRAFT' AND ($5::integer IS NULL OR version = $5)",
    )
    .bind(claim_id)
    .bind(request.submitted_on)
    .bind(trimmed(request.insurer_claim_number.as_deref()))
    .bind(actor)
    .bind(request.expected_version)
    .execute(pool)
    .await?;
    if updated.rows_affected() == 0 {
        return Err(moved_refusal(pool, claim_id, "submitted", &["DRAFT"]).await);
    }
    ga_claim(pool, claim_id).await
}

/// Submitted → Surveyed.
pub async fn ga_claim_survey(
    pool: &PgPool,
    claim_id: Uuid,
    request: &SurveyGaInsuranceClaimRequest,
    actor: &str,
    today: NaiveDate,
) -> Result<GaInsuranceClaimRow, AppError> {
    let row = ga_claim(pool, claim_id).await?;
    not_after_today(request.surveyed_on, today, "the survey")?;
    if row.submitted_on.is_some_and(|on| request.surveyed_on < on) {
        return Err(AppError::Validation(
            "the survey comes after the claim was submitted".into(),
        ));
    }
    let updated = sqlx::query(
        "UPDATE ga_insurance_claim
            SET status = 'SURVEYED', surveyed_on = $2, surveyor = $3,
                updated_by = $4, updated_at = now(), version = version + 1
          WHERE claim_id = $1 AND status = 'SUBMITTED' AND ($5::integer IS NULL OR version = $5)",
    )
    .bind(claim_id)
    .bind(request.surveyed_on)
    .bind(trimmed(request.surveyor.as_deref()))
    .bind(actor)
    .bind(request.expected_version)
    .execute(pool)
    .await?;
    if updated.rows_affected() == 0 {
        return Err(moved_refusal(pool, claim_id, "surveyed", &["SUBMITTED"]).await);
    }
    ga_claim(pool, claim_id).await
}

/// Check that a repair can be the one a claim pays for: about the same thing
/// (or the same place, for a claim about the place), and not cancelled.
async fn assert_claim_repair(
    executor: impl sqlx::PgExecutor<'_>,
    claim: &GaInsuranceClaimRow,
    repair_id: Uuid,
) -> Result<(), AppError> {
    let repair =
        sqlx::query("SELECT asset_id, site_id, status FROM ga_repair WHERE repair_id = $1")
            .bind(repair_id)
            .fetch_optional(executor)
            .await?
            .ok_or_else(|| {
                AppError::Validation("the repair the claim names does not exist".into())
            })?;
    let asset_id: Option<Uuid> = repair.try_get("asset_id")?;
    let site_id: String = repair.try_get("site_id")?;
    let status: String = repair.try_get("status")?;
    if status == "CANCELLED" {
        return Err(AppError::Validation(
            "that repair was cancelled; a claim pays for work that is done".into(),
        ));
    }
    let same = match claim.asset_id {
        Some(asset) => asset_id == Some(asset),
        None => asset_id.is_none() && site_id == claim.site_id,
    };
    if !same {
        return Err(AppError::Validation(
            "that repair is about something else; the claim pays for the repair of its damage"
                .into(),
        ));
    }
    Ok(())
}

fn repair_taken(error: sqlx::Error) -> AppError {
    match error {
        sqlx::Error::Database(db) if db.is_unique_violation() => {
            AppError::Conflict("that repair is already paid for by another claim".into())
        }
        other => AppError::from(other),
    }
}

/// Surveyed → Approved, naming or opening the repair it pays for.
///
/// Opening the repair and approving the claim are one transaction: an approved
/// claim pointing at a repair that failed to save would be a claim paying for
/// nothing.
pub async fn ga_claim_approve(
    pool: &PgPool,
    claim_id: Uuid,
    request: &ApproveGaInsuranceClaimRequest,
    actor: &str,
    today: NaiveDate,
) -> Result<GaInsuranceClaimRow, AppError> {
    let claim = ga_claim(pool, claim_id).await?;
    not_after_today(request.decided_on, today, "the insurer's decision")?;
    if let Some(on) = claim.surveyed_on.or(claim.submitted_on) {
        if request.decided_on < on {
            return Err(AppError::Validation(
                "the insurer decides after the survey, not before it".into(),
            ));
        }
    }
    if request.approved_minor <= 0 {
        return Err(AppError::Validation(
            "an approval says what the insurer pays; for nothing, reject the claim instead".into(),
        ));
    }
    if request.deductible_minor.is_some_and(|value| value < 0) {
        return Err(AppError::Validation(
            "a deductible is what we pay ourselves; it cannot be negative".into(),
        ));
    }
    if request.repair_id.is_some() && request.open_repair_supplier_id.is_some() {
        return Err(AppError::Validation(
            "name the repair already recorded, or open a new one at the workshop; not both".into(),
        ));
    }
    if claim.repair_id.is_some()
        && (request.repair_id.is_some() || request.open_repair_supplier_id.is_some())
    {
        return Err(AppError::Conflict(
            "the claim already pays for a repair".into(),
        ));
    }
    // What a new repair is filed as: the asset's class decides, as it does for
    // every repair recorded with an asset.
    let opening = match request.open_repair_supplier_id {
        None => None,
        Some(supplier_id) => {
            let asset_id = claim.asset_id.ok_or_else(|| {
                AppError::Validation(
                    "a claim about the place itself: record the repair in Repairs, then name it here"
                        .into(),
                )
            })?;
            let supplier: bool =
                sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM supplier WHERE supplier_id = $1)")
                    .bind(supplier_id)
                    .fetch_one(pool)
                    .await?;
            if !supplier {
                return Err(AppError::Validation(
                    "the workshop is not in the supplier register".into(),
                ));
            }
            let objek =
                super::ga_maintenance::resolve_repair_object(pool, None, Some(asset_id)).await?;
            Some((asset_id, supplier_id, objek))
        }
    };

    let mut tx = pool.begin().await?;
    let repair_id = match (request.repair_id, opening) {
        (Some(repair_id), _) => {
            assert_claim_repair(&mut *tx, &claim, repair_id).await?;
            Some(repair_id)
        }
        (None, Some((asset_id, supplier_id, objek))) => {
            let estimate = request.approved_minor + request.deductible_minor.unwrap_or(0);
            let note = match &claim.insurer_claim_number {
                Some(number) => format!("Paid by insurance claim {number}"),
                None => "Paid by an insurance claim".to_string(),
            };
            let repair_id: Uuid = sqlx::query_scalar(
                "INSERT INTO ga_repair
                   (site_id, asset_id, objek, title, supplier_id, estimated_cost_minor,
                    failure_at, notes, created_by)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                 RETURNING repair_id",
            )
            .bind(&claim.site_id)
            .bind(asset_id)
            .bind(&objek)
            .bind(&claim.description)
            .bind(supplier_id)
            .bind(estimate)
            .bind(claim.incident_on)
            .bind(note)
            .bind(actor)
            .fetch_one(&mut *tx)
            .await?;
            Some(repair_id)
        }
        (None, None) => claim.repair_id,
    };
    let updated = sqlx::query(
        "UPDATE ga_insurance_claim
            SET status = 'APPROVED', decided_on = $2, approved_minor = $3,
                deductible_minor = $4, repair_id = $5,
                updated_by = $6, updated_at = now(), version = version + 1
          WHERE claim_id = $1 AND status = 'SURVEYED' AND ($7::integer IS NULL OR version = $7)",
    )
    .bind(claim_id)
    .bind(request.decided_on)
    .bind(request.approved_minor)
    .bind(request.deductible_minor)
    .bind(repair_id)
    .bind(actor)
    .bind(request.expected_version)
    .execute(&mut *tx)
    .await
    .map_err(repair_taken)?;
    if updated.rows_affected() == 0 {
        drop(tx);
        return Err(moved_refusal(pool, claim_id, "approved", &["SURVEYED"]).await);
    }
    tx.commit().await?;
    ga_claim(pool, claim_id).await
}

/// Submitted or Surveyed → Rejected.
pub async fn ga_claim_reject(
    pool: &PgPool,
    claim_id: Uuid,
    request: &RejectGaInsuranceClaimRequest,
    actor: &str,
    today: NaiveDate,
) -> Result<GaInsuranceClaimRow, AppError> {
    let claim = ga_claim(pool, claim_id).await?;
    let reason = trimmed(Some(&request.reason))
        .ok_or_else(|| AppError::Validation("say why the insurer rejected it".into()))?;
    not_after_today(request.decided_on, today, "the insurer's decision")?;
    if claim.submitted_on.is_some_and(|on| request.decided_on < on) {
        return Err(AppError::Validation(
            "the insurer decides after the claim was submitted".into(),
        ));
    }
    let updated = sqlx::query(
        "UPDATE ga_insurance_claim
            SET status = 'REJECTED', decided_on = $2, rejected_reason = $3,
                updated_by = $4, updated_at = now(), version = version + 1
          WHERE claim_id = $1 AND status IN ('SUBMITTED', 'SURVEYED')
            AND ($5::integer IS NULL OR version = $5)",
    )
    .bind(claim_id)
    .bind(request.decided_on)
    .bind(&reason)
    .bind(actor)
    .bind(request.expected_version)
    .execute(pool)
    .await?;
    if updated.rows_affected() == 0 {
        return Err(moved_refusal(pool, claim_id, "rejected", &["SUBMITTED", "SURVEYED"]).await);
    }
    ga_claim(pool, claim_id).await
}

/// Approved → Paid: the insurer's money arrived.
pub async fn ga_claim_pay(
    pool: &PgPool,
    claim_id: Uuid,
    request: &PayGaInsuranceClaimRequest,
    actor: &str,
    today: NaiveDate,
) -> Result<GaInsuranceClaimRow, AppError> {
    let claim = ga_claim(pool, claim_id).await?;
    not_after_today(request.paid_on, today, "the payment")?;
    if claim.decided_on.is_some_and(|on| request.paid_on < on) {
        return Err(AppError::Validation(
            "the insurer pays after it approved the claim".into(),
        ));
    }
    if request.paid_minor < 0 {
        return Err(AppError::Validation(
            "what the insurer paid cannot be negative".into(),
        ));
    }
    if claim
        .approved_minor
        .is_some_and(|approved| request.paid_minor > approved)
    {
        return Err(AppError::Validation(
            "the insurer paid more than it approved; check the approved amount first".into(),
        ));
    }
    if let Some(cash_document_id) = request.cash_document_id {
        let exists: bool = sqlx::query_scalar(
            "SELECT EXISTS (SELECT 1 FROM cash_document WHERE document_id = $1)",
        )
        .bind(cash_document_id)
        .fetch_one(pool)
        .await?;
        if !exists {
            return Err(AppError::Validation(
                "there is no such cash document".into(),
            ));
        }
    }
    let updated = sqlx::query(
        "UPDATE ga_insurance_claim
            SET status = 'PAID', paid_on = $2, paid_minor = $3, cash_document_id = $4,
                updated_by = $5, updated_at = now(), version = version + 1
          WHERE claim_id = $1 AND status = 'APPROVED' AND ($6::integer IS NULL OR version = $6)",
    )
    .bind(claim_id)
    .bind(request.paid_on)
    .bind(request.paid_minor)
    .bind(request.cash_document_id)
    .bind(actor)
    .bind(request.expected_version)
    .execute(pool)
    .await
    .map_err(|error| match error {
        sqlx::Error::Database(db) if db.is_unique_violation() => {
            AppError::Conflict("that BKM already answers another claim".into())
        }
        other => AppError::from(other),
    })?;
    if updated.rows_affected() == 0 {
        return Err(moved_refusal(pool, claim_id, "marked paid", &["APPROVED"]).await);
    }
    ga_claim(pool, claim_id).await
}

/// Name the repair the claim pays for, while the claim is still open.
pub async fn ga_claim_link_repair(
    pool: &PgPool,
    claim_id: Uuid,
    request: &LinkGaClaimRepairRequest,
    actor: &str,
) -> Result<GaInsuranceClaimRow, AppError> {
    let claim = ga_claim(pool, claim_id).await?;
    if claim.status == "PAID" || claim.status == "REJECTED" {
        return Err(AppError::Conflict(format!(
            "the claim is {}; it is settled",
            claim.status.to_lowercase()
        )));
    }
    if claim.repair_id.is_some() {
        return Err(AppError::Conflict(
            "the claim already pays for a repair".into(),
        ));
    }
    assert_claim_repair(pool, &claim, request.repair_id).await?;
    let updated = sqlx::query(
        "UPDATE ga_insurance_claim
            SET repair_id = $2, updated_by = $3, updated_at = now(), version = version + 1
          WHERE claim_id = $1 AND repair_id IS NULL
            AND status NOT IN ('PAID', 'REJECTED')
            AND ($4::integer IS NULL OR version = $4)",
    )
    .bind(claim_id)
    .bind(request.repair_id)
    .bind(actor)
    .bind(request.expected_version)
    .execute(pool)
    .await
    .map_err(repair_taken)?;
    if updated.rows_affected() == 0 {
        return Err(moved_refusal(
            pool,
            claim_id,
            "linked",
            &["DRAFT", "SUBMITTED", "SURVEYED", "APPROVED"],
        )
        .await);
    }
    ga_claim(pool, claim_id).await
}

/// The site a claim is at, for the access check of a read or a move.
pub async fn ga_claim_site(pool: &PgPool, claim_id: Uuid) -> Result<String, AppError> {
    sqlx::query_scalar("SELECT site_id FROM ga_insurance_claim WHERE claim_id = $1")
        .bind(claim_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound("insurance claim".into()))
}
