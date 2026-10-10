//! The component catalogue, its ratified rates, and the one-off figures a
//! place files, as rows.
//!
//! # The definition and the rate are read together and stored apart
//!
//! [`catalogue`] is one query with a lateral join, so building a run's slips
//! costs one read of the catalogue rather than one per employee per component.
//! What comes back is [`ComponentInForce`] — a definition and `Option<rate>` —
//! and the `Option` is the whole point: "defined and nobody has priced it" is
//! a state the engine has to be able to see.
//!
//! Retired components are read too. They produce no new standing line, but an
//! adjustment filed against one while it was live still has to resolve, or head
//! office retiring a code would silently cancel a figure a place is waiting to
//! see approved.
//!
//! # The freeze is a query inside the write's own transaction
//!
//! An adjustment is writable while its month has no payroll run or a `DRAFT`
//! one, and frozen by the submission (see `domain::component::adjustment` for
//! why it has no state machine of its own). That is checked here, against
//! `payroll_run.state`, in the same transaction as the insert — not in a
//! trigger, because the refusal has to name the run and the month in a sentence
//! somebody reads, and not before the transaction, because a check that ends
//! before the write begins is a race with the place's own submit button.

use crate::cloud::application::AppError;
use crate::cloud::domain::{
    Authorization, ComponentBase, ComponentBasis, ComponentError, ComponentInForce, ComponentKind,
    ComponentRate, ComponentShape, CountedUnit, PayComponent, PayComponentWire, PayrollAdjustment,
    PayrollAdjustmentWire, RateTimeline, UnitId,
};
use chrono::{DateTime, Datelike, NaiveDate, Utc};
use pricing_engine::Money;
use serde::Serialize;
use sqlx::{PgPool, Postgres, Row, Transaction};
use uuid::Uuid;

fn corrupt(what: &str, detail: String) -> AppError {
    AppError::Configuration(format!(
        "stored {what} does not hydrate: {detail}. The rows disagree with the rules they encode."
    ))
}

/// Turn a domain refusal into the right HTTP answer.
///
/// The same three-way split `pay_error` makes, for the same reason: a figure
/// arriving at the wrong moment is a conflict, a grant that does not cover the
/// act is a 403, and everything else is a malformed request.
pub fn component_error(error: ComponentError) -> AppError {
    if error.is_forbidden() {
        AppError::Forbidden(error.to_string())
    } else if error.is_conflict() {
        AppError::Conflict(error.to_string())
    } else {
        AppError::Validation(error.to_string())
    }
}

/// `YYYY-MM`, as both period columns store it.
fn period_of(day: NaiveDate) -> String {
    format!("{:04}-{:02}", day.year(), day.month())
}

// ── the catalogue ────────────────────────────────────────────────────────

const COMPONENT_COLUMNS: &str = "c.code, c.label, c.kind, c.basis, c.base_ref, c.unit, \
     c.defined, c.retired, c.employer_borne";

const RATE_COLUMNS: &str = "r.effective_from, r.amount_minor, r.rate_minor, r.rate_bp, \
     r.cap_minor, r.hours_divisor, r.multiplier_bp, r.ratified";

fn decode_component(row: &sqlx::postgres::PgRow) -> Result<PayComponent, AppError> {
    let kind: String = row.try_get("kind")?;
    let shape: String = row.try_get("basis")?;
    let base: Option<String> = row.try_get("base_ref")?;
    let unit: Option<String> = row.try_get("unit")?;
    PayComponent::try_new(PayComponentWire {
        code: row
            .try_get::<String, _>("code")?
            .try_into()
            .map_err(|error: ComponentError| corrupt("component code", error.to_string()))?,
        label: row.try_get("label")?,
        kind: ComponentKind::parse(&kind)
            .map_err(|error| corrupt("component kind", error.to_string()))?,
        shape: ComponentShape::parse(&shape)
            .map_err(|error| corrupt("component shape", error.to_string()))?,
        base: base
            .as_deref()
            .map(ComponentBase::parse)
            .transpose()
            .map_err(|error| corrupt("component base", error.to_string()))?,
        unit: unit
            .as_deref()
            .map(CountedUnit::parse)
            .transpose()
            .map_err(|error| corrupt("component unit", error.to_string()))?,
        defined: serde_json::from_value(row.try_get("defined")?)
            .map_err(|error| corrupt("component authority", error.to_string()))?,
        retired: row
            .try_get::<Option<serde_json::Value>, _>("retired")?
            .map(serde_json::from_value)
            .transpose()
            .map_err(|error| corrupt("retirement authority", error.to_string()))?,
        employer_borne: row.try_get("employer_borne")?,
    })
    .map_err(|error| corrupt("pay component", error.to_string()))
}

/// Assemble a basis out of a rate row's own columns and the shape it is pinned
/// to.
///
/// The schema's composite foreign key guarantees the row's `basis` matches its
/// component's, and its CHECK guarantees exactly the right columns are present
/// — so a `None` here is a corrupt row rather than a missing decision, and it
/// is reported as one.
fn decode_basis(
    shape: ComponentShape,
    base: Option<ComponentBase>,
    unit: Option<CountedUnit>,
    row: &sqlx::postgres::PgRow,
) -> Result<ComponentBasis, AppError> {
    let missing = |what: &str| corrupt("component rate", format!("{what} is absent"));
    let basis = match shape {
        ComponentShape::FixedAmount => ComponentBasis::FixedAmount {
            amount: Money::new(
                row.try_get::<Option<i64>, _>("amount_minor")?
                    .ok_or_else(|| missing("the amount"))?,
            ),
        },
        ComponentShape::ShareOfBase => ComponentBasis::ShareOfBase {
            base: base.ok_or_else(|| missing("the base"))?,
            rate_bp: i64::from(
                row.try_get::<Option<i32>, _>("rate_bp")?
                    .ok_or_else(|| missing("the rate"))?,
            ),
            cap: row.try_get::<Option<i64>, _>("cap_minor")?.map(Money::new),
        },
        ComponentShape::RatePerUnit => ComponentBasis::RatePerUnit {
            unit: unit.ok_or_else(|| missing("the unit"))?,
            rate: Money::new(
                row.try_get::<Option<i64>, _>("rate_minor")?
                    .ok_or_else(|| missing("the rate per unit"))?,
            ),
        },
        ComponentShape::FractionOfBasePerUnit => ComponentBasis::FractionOfBasePerUnit {
            base: base.ok_or_else(|| missing("the base"))?,
            unit: unit.ok_or_else(|| missing("the unit"))?,
            hours_divisor: i64::from(
                row.try_get::<Option<i32>, _>("hours_divisor")?
                    .ok_or_else(|| missing("the divisor of hours"))?,
            ),
            multiplier_bp: i64::from(
                row.try_get::<Option<i32>, _>("multiplier_bp")?
                    .ok_or_else(|| missing("the multiplier"))?,
            ),
        },
        // The schema resolves a `PER_OCCASION` rate's CHECK to `false`, so no
        // such row exists to decode.
        ComponentShape::PerOccasion | ComponentShape::Statutory => {
            return Err(corrupt(
                "component rate",
                format!("a {} component has no standing rate", shape.code()),
            ))
        }
    };
    basis
        .validated()
        .map_err(|error| corrupt("component rate", error.to_string()))
}

fn decode_rate(
    component: &PayComponent,
    row: &sqlx::postgres::PgRow,
) -> Result<Option<ComponentRate>, AppError> {
    let Some(effective_from) = row.try_get::<Option<NaiveDate>, _>("effective_from")? else {
        return Ok(None);
    };
    let basis = decode_basis(component.shape(), component.base(), component.unit(), row)?;
    let ratified: Authorization = serde_json::from_value(row.try_get("ratified")?)
        .map_err(|error| corrupt("rate authority", error.to_string()))?;
    ComponentRate::try_new(effective_from, basis, ratified)
        .map(Some)
        .map_err(|error| corrupt("component rate", error.to_string()))
}

/// The catalogue query: every component, with the rate in force on `$1`.
///
/// A lateral join rather than a correlated subquery per number, so reading the
/// catalogue costs one query however many components there are — and building a
/// run's slips reads it **once** rather than once per employee.
fn catalogue_query() -> String {
    format!(
        "SELECT {COMPONENT_COLUMNS}, {RATE_COLUMNS}
           FROM pay_component c
           LEFT JOIN LATERAL (
               SELECT * FROM pay_component_rate rate
                WHERE rate.component_code = c.code
                  AND rate.effective_from <= $1
                ORDER BY rate.effective_from DESC
                LIMIT 1
           ) r ON true
          ORDER BY (c.kind = 'DEDUCTION'), c.code"
    )
}

fn decode_catalogue(rows: &[sqlx::postgres::PgRow]) -> Result<Vec<ComponentInForce>, AppError> {
    rows.iter()
        .map(|row| {
            let component = decode_component(row)?;
            let rate = decode_rate(&component, row)?;
            Ok(ComponentInForce { component, rate })
        })
        .collect()
}

/// Every component, with the rate in force on a date — `None` where nobody has
/// stated one.
///
/// Retired components included. Earnings before deductions, then by code, which
/// is payslip order; the engine sorts its lines the same way so a screen and a
/// slip agree.
pub async fn catalogue(pool: &PgPool, on: NaiveDate) -> Result<Vec<ComponentInForce>, AppError> {
    let rows = sqlx::query(&catalogue_query())
        .bind(on)
        .fetch_all(pool)
        .await?;
    decode_catalogue(&rows)
}

/// The same read, inside a run's own transaction.
///
/// Its own function rather than a generic executor because `sqlx`'s
/// `Executor` bound on `&mut Transaction` makes the generic version harder to
/// read than the duplicate call — and both share the query and the decoder, so
/// there is one catalogue and one way of understanding it.
pub async fn catalogue_for_run(
    tx: &mut Transaction<'_, Postgres>,
    on: NaiveDate,
) -> Result<Vec<ComponentInForce>, AppError> {
    let rows = sqlx::query(&catalogue_query())
        .bind(on)
        .fetch_all(&mut **tx)
        .await?;
    decode_catalogue(&rows)
}

/// One component by its code.
pub async fn load_component(pool: &PgPool, code: &str) -> Result<Option<PayComponent>, AppError> {
    let row = sqlx::query(&format!(
        "SELECT {COMPONENT_COLUMNS} FROM pay_component c WHERE c.code = $1"
    ))
    .bind(code)
    .fetch_optional(pool)
    .await?;
    row.as_ref().map(decode_component).transpose()
}

/// Define a component.
///
/// `ON CONFLICT DO NOTHING` rather than an upsert: redefining a component would
/// change what every slip that already names it meant, and the structural half
/// of a component is the half that should never move. A code somebody wants
/// back is a retirement to undo or a new code.
pub async fn define_component(pool: &PgPool, component: &PayComponent) -> Result<(), AppError> {
    let inserted = sqlx::query(
        "INSERT INTO pay_component
             (code, label, kind, basis, base_ref, unit, defined)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (code) DO NOTHING",
    )
    .bind(component.code().as_str())
    .bind(component.label())
    .bind(component.kind().code())
    .bind(component.shape().code())
    .bind(component.base().map(ComponentBase::code))
    .bind(component.unit().map(CountedUnit::code))
    .bind(serde_json::to_value(component.defined())?)
    .execute(pool)
    .await?;
    if inserted.rows_affected() == 0 {
        return Err(AppError::Conflict(format!(
            "{} is already a payroll component",
            component.code()
        )));
    }
    Ok(())
}

/// Retire one. **Never delete**: a slip line naming a deleted component would
/// point at nothing.
///
/// A guarded update — `WHERE retired_at IS NULL` — so two people pressing at
/// once produce one retirement and the second is told. The unguarded form,
/// which reads the state and then writes by id, has a window between the two.
pub async fn retire_component(
    pool: &PgPool,
    code: &str,
    authorization: &Authorization,
) -> Result<(), AppError> {
    let updated = sqlx::query(
        "UPDATE pay_component
            SET retired_at = now(), retired = $2
          WHERE code = $1 AND retired_at IS NULL",
    )
    .bind(code)
    .bind(serde_json::to_value(authorization)?)
    .execute(pool)
    .await?;
    if updated.rows_affected() == 0 {
        return Err(AppError::Conflict(format!(
            "{code} is not a component that can be retired: it is unknown, or already retired"
        )));
    }
    Ok(())
}

/// One component's rates, over time, folded through the forward-only rule.
///
/// A stored set of rates that the timeline refuses is a corrupt catalogue
/// rather than a bad request — somebody has edited rows — so it fails to load
/// with the reason named, exactly as `pay_timeline` does.
pub async fn rate_timeline(
    pool: &PgPool,
    component: &PayComponent,
) -> Result<RateTimeline, AppError> {
    let rows = sqlx::query(&format!(
        "SELECT {RATE_COLUMNS} FROM pay_component_rate r
          WHERE r.component_code = $1 ORDER BY r.effective_from"
    ))
    .bind(component.code().as_str())
    .fetch_all(pool)
    .await?;

    let mut timeline = RateTimeline::new();
    for row in &rows {
        let rate = decode_rate(component, row)?
            .ok_or_else(|| corrupt("component rate", "no effective date".to_owned()))?;
        timeline
            .append(rate)
            .map_err(|error| corrupt("rate timeline", error.to_string()))?;
    }
    Ok(timeline)
}

/// Ratify a rate.
///
/// The primary key refuses two rates on one day; the domain refuses one filed
/// behind the latest before we get here. `basis` is written from the
/// component's own shape, which is what the composite foreign key then pins.
pub async fn ratify_rate(
    pool: &PgPool,
    component: &PayComponent,
    rate: &ComponentRate,
) -> Result<(), AppError> {
    let basis = rate.basis();
    let (amount, unit_rate, rate_bp, cap, divisor, multiplier) = match basis {
        ComponentBasis::FixedAmount { amount } => {
            (Some(amount.minor), None, None, None, None, None)
        }
        ComponentBasis::ShareOfBase { rate_bp, cap, .. } => (
            None,
            None,
            i32::try_from(rate_bp).ok(),
            cap.map(|cap| cap.minor),
            None,
            None,
        ),
        ComponentBasis::RatePerUnit { rate, .. } => {
            (None, Some(rate.minor), None, None, None, None)
        }
        ComponentBasis::FractionOfBasePerUnit {
            hours_divisor,
            multiplier_bp,
            ..
        } => (
            None,
            None,
            None,
            None,
            i32::try_from(hours_divisor).ok(),
            i32::try_from(multiplier_bp).ok(),
        ),
    };

    let inserted = sqlx::query(
        "INSERT INTO pay_component_rate
             (component_code, basis, effective_from, amount_minor, rate_minor,
              rate_bp, cap_minor, hours_divisor, multiplier_bp, ratified)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (component_code, effective_from) DO NOTHING",
    )
    .bind(component.code().as_str())
    .bind(basis.shape().code())
    .bind(rate.effective_from())
    .bind(amount)
    .bind(unit_rate)
    .bind(rate_bp)
    .bind(cap)
    .bind(divisor)
    .bind(multiplier)
    .bind(serde_json::to_value(rate.ratified())?)
    .execute(pool)
    .await?;
    if inserted.rows_affected() == 0 {
        return Err(AppError::Conflict(format!(
            "{} already has a rate effective {}",
            component.code(),
            rate.effective_from()
        )));
    }
    Ok(())
}

// ── the one-off figures a place files ────────────────────────────────────

/// Refuse a write whose batch is no longer the place's to change.
///
/// No run at all is fine: the place files as the month happens, and the run
/// collects what is there when it is built. A `DRAFT` run is fine too — that is
/// a working document. Anything else is a batch somebody has signed for.
async fn batch_is_still_draft(
    tx: &mut Transaction<'_, Postgres>,
    unit: &UnitId,
    first_day: NaiveDate,
) -> Result<(), AppError> {
    let state: Option<String> = sqlx::query_scalar(
        "SELECT state FROM payroll_run WHERE unit_id = $1 AND period = $2 FOR SHARE",
    )
    .bind(unit.as_str())
    .bind(first_day)
    .fetch_optional(&mut **tx)
    .await?;

    match state.as_deref() {
        None | Some("DRAFT") => Ok(()),
        Some(other) => Err(component_error(ComponentError::BatchNoLongerDraft {
            unit: unit.to_string(),
            period: period_of(first_day),
            // Leaked as a `&'static str` rather than the row's own `String`
            // because the error names a state from a closed vocabulary; an
            // unknown one is a corrupt row and says so.
            state: match other {
                "SUBMITTED" => "submitted",
                "APPROVED" => "approved",
                _ => "in a state this build does not know",
            },
        })),
    }
}

/// File a one-off.
///
/// Refused rather than overwritten when one is already filed for that person
/// and component in that month: two incentives in one month are one incentive
/// of the sum or two different components, and either way somebody has to say
/// which. Correcting a figure is a withdrawal and a new filing, both under
/// their own reason — which the reference also insists on
/// (`validate_duplicate_additional_salary`), in application code rather than
/// in a key.
pub async fn file_adjustment(
    pool: &PgPool,
    adjustment: &PayrollAdjustment,
    first_day: NaiveDate,
) -> Result<(), AppError> {
    let mut tx = pool.begin().await?;
    batch_is_still_draft(&mut tx, adjustment.unit(), first_day).await?;

    let inserted = sqlx::query(
        "INSERT INTO payroll_adjustment
             (id, unit_id, period, employee_id, component_code, basis, amount_minor,
              advance_id, filed)
         VALUES ($1, $2, $3, $4, $5, 'PER_OCCASION', $6, $7, $8)
         ON CONFLICT (unit_id, period, employee_id, component_code) DO NOTHING",
    )
    .bind(adjustment.id())
    .bind(adjustment.unit().as_str())
    .bind(first_day)
    .bind(adjustment.employee_id())
    .bind(adjustment.code().as_str())
    .bind(adjustment.amount().minor)
    .bind(adjustment.advance_id())
    .bind(serde_json::to_value(adjustment.filed())?)
    .execute(&mut *tx)
    .await?;
    if inserted.rows_affected() == 0 {
        return Err(component_error(ComponentError::AdjustmentAlreadyFiled {
            code: adjustment.code().to_string(),
            employee_id: adjustment.employee_id().to_owned(),
            period: adjustment.period().to_owned(),
        }));
    }
    tx.commit().await?;
    Ok(())
}

/// Where a filed adjustment belongs, so a caller's reach can be checked before
/// anything is removed.
///
/// Its own tiny read rather than a field on the delete's answer: the place is a
/// fact about the row, so the row has to be found before the bound can be
/// applied — the shape `reachable_run` uses, and the reason it is not folded
/// into [`withdraw_adjustment`] is that a 403 must not be reached by way of a
/// transaction that has already deleted something.
pub async fn adjustment_unit_of(
    pool: &PgPool,
    id: &str,
) -> Result<Option<(UnitId, NaiveDate)>, AppError> {
    let row = sqlx::query("SELECT unit_id, period FROM payroll_adjustment WHERE id = $1")
        .bind(id)
        .fetch_optional(pool)
        .await?;
    let Some(row) = row else { return Ok(None) };
    let unit = UnitId::try_new(&row.try_get::<String, _>("unit_id")?)
        .map_err(|error| corrupt("unit id", error.to_string()))?;
    Ok(Some((unit, row.try_get("period")?)))
}

/// Take one back, while the batch is still the place's.
///
/// Returns the row as it stood, so the caller can check its place against the
/// caller's reach and file the audit against the right subject. Deleted rather
/// than flagged: this is a working figure in an unsigned batch, exactly like a
/// slip in a draft run, and a withdrawn-adjustment row nothing reads would be a
/// second vocabulary for "not in the batch".
pub async fn withdraw_adjustment(
    pool: &PgPool,
    id: &str,
) -> Result<Option<PayrollAdjustment>, AppError> {
    let mut tx = pool.begin().await?;
    let row = sqlx::query(
        "SELECT id, unit_id, period, employee_id, component_code, amount_minor, advance_id, filed
           FROM payroll_adjustment WHERE id = $1 FOR UPDATE",
    )
    .bind(id)
    .fetch_optional(&mut *tx)
    .await?;
    let Some(row) = row else {
        tx.commit().await?;
        return Ok(None);
    };

    let first_day: NaiveDate = row.try_get("period")?;
    let unit = UnitId::try_new(&row.try_get::<String, _>("unit_id")?)
        .map_err(|error| corrupt("unit id", error.to_string()))?;
    let adjustment = PayrollAdjustment::try_new(PayrollAdjustmentWire {
        id: row.try_get("id")?,
        unit: unit.clone(),
        period: period_of(first_day),
        employee_id: row.try_get("employee_id")?,
        code: row
            .try_get::<String, _>("component_code")?
            .try_into()
            .map_err(|error: ComponentError| corrupt("component code", error.to_string()))?,
        amount: Money::new(row.try_get::<i64, _>("amount_minor")?),
        advance_id: row.try_get("advance_id")?,
        filed: serde_json::from_value(row.try_get("filed")?)
            .map_err(|error| corrupt("adjustment authority", error.to_string()))?,
    })
    .map_err(|error| corrupt("payroll adjustment", error.to_string()))?;

    batch_is_still_draft(&mut tx, &unit, first_day).await?;
    sqlx::query("DELETE FROM payroll_adjustment WHERE id = $1")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(Some(adjustment))
}

/// What one place has filed for one month, as a batch screen needs it.
///
/// The employee's code and name are joined because a list of employee ids is
/// not a list a person can check, and checking is what the place is for.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PayrollAdjustmentRow {
    pub id: String,
    pub unit_id: String,
    /// `YYYY-MM`.
    pub period: String,
    pub employee_id: String,
    pub employee_code: String,
    pub full_name: Option<String>,
    pub component_code: String,
    pub label: String,
    /// `EARNING` or `DEDUCTION`, from the component. A *kasbon* instalment is a
    /// positive amount under a deduction; nothing here is signed.
    pub kind: String,
    pub amount_minor: i64,
    /// The advance the figure repays, when the figure is a recovery (0347).
    pub advance_id: Option<Uuid>,
    pub filed_by: String,
    pub filed_at: DateTime<Utc>,
    /// Why. Not decoration: this is the one figure on a payslip head office did
    /// not agree in advance, so the reason is the whole of what it approves.
    pub reason: String,
    /// Whether it can still be withdrawn — false once the place has submitted
    /// the batch carrying it.
    pub withdrawable: bool,
}

fn adjustment_row(row: &sqlx::postgres::PgRow) -> Result<PayrollAdjustmentRow, AppError> {
    let filed: Authorization = serde_json::from_value(row.try_get("filed")?)
        .map_err(|error| corrupt("adjustment authority", error.to_string()))?;
    let period: NaiveDate = row.try_get("period")?;
    let state: Option<String> = row.try_get("run_state")?;
    Ok(PayrollAdjustmentRow {
        id: row.try_get("id")?,
        unit_id: row.try_get("unit_id")?,
        period: period_of(period),
        employee_id: row.try_get("employee_id")?,
        employee_code: row.try_get("employee_code")?,
        full_name: row.try_get("full_name")?,
        component_code: row.try_get("component_code")?,
        label: row.try_get("label")?,
        kind: row.try_get("kind")?,
        amount_minor: row.try_get("amount_minor")?,
        advance_id: row.try_get("advance_id")?,
        filed_by: filed.actor().to_string(),
        filed_at: filed.at(),
        reason: filed.reason().to_string(),
        withdrawable: matches!(state.as_deref(), None | Some("DRAFT")),
    })
}

/// Every one-off filed for a place, newest month first. `unit_id IS NULL`
/// reads every place, which only an unbounded caller ever asks for.
pub async fn adjustments(
    pool: &PgPool,
    unit_id: Option<&str>,
    period: Option<NaiveDate>,
) -> Result<Vec<PayrollAdjustmentRow>, AppError> {
    let rows = sqlx::query(
        "SELECT a.id, a.unit_id, a.period, a.employee_id, e.code AS employee_code,
                p.full_name, a.component_code, c.label, c.kind, a.amount_minor, a.advance_id,
                a.filed, r.state AS run_state
           FROM payroll_adjustment a
           JOIN pay_component c ON c.code = a.component_code
           JOIN employee e ON e.id = a.employee_id
           LEFT JOIN employee_profile p ON p.employee_id = a.employee_id
           LEFT JOIN payroll_run r ON r.unit_id = a.unit_id AND r.period = a.period
          WHERE ($1::text IS NULL OR a.unit_id = $1)
            AND ($2::date IS NULL OR a.period = $2)
          ORDER BY a.period DESC, a.unit_id, e.code, a.component_code",
    )
    .bind(unit_id)
    .bind(period)
    .fetch_all(pool)
    .await?;
    rows.iter().map(adjustment_row).collect()
}

/// The one-offs a run's slips should carry, read inside the run's own
/// transaction.
///
/// Keyed by (place, month) rather than by the run, so a figure filed before the
/// attendance period closed — which is before a run may be opened at all — is
/// still picked up when the run is built.
pub async fn adjustments_for_run(
    tx: &mut Transaction<'_, Postgres>,
    unit: &UnitId,
    first_day: NaiveDate,
    employee_id: &str,
) -> Result<Vec<PayrollAdjustment>, AppError> {
    let rows = sqlx::query(
        "SELECT id, unit_id, period, employee_id, component_code, amount_minor, advance_id, filed
           FROM payroll_adjustment
          WHERE unit_id = $1 AND period = $2 AND employee_id = $3
          ORDER BY component_code",
    )
    .bind(unit.as_str())
    .bind(first_day)
    .bind(employee_id)
    .fetch_all(&mut **tx)
    .await?;

    rows.iter()
        .map(|row| {
            let period: NaiveDate = row.try_get("period")?;
            PayrollAdjustment::try_new(PayrollAdjustmentWire {
                id: row.try_get("id")?,
                unit: UnitId::try_new(&row.try_get::<String, _>("unit_id")?)
                    .map_err(|error| corrupt("unit id", error.to_string()))?,
                period: period_of(period),
                employee_id: row.try_get("employee_id")?,
                code: row
                    .try_get::<String, _>("component_code")?
                    .try_into()
                    .map_err(|error: ComponentError| {
                        corrupt("component code", error.to_string())
                    })?,
                amount: Money::new(row.try_get::<i64, _>("amount_minor")?),
                advance_id: row.try_get("advance_id")?,
                filed: serde_json::from_value(row.try_get("filed")?)
                    .map_err(|error| corrupt("adjustment authority", error.to_string()))?,
            })
            .map_err(|error| corrupt("payroll adjustment", error.to_string()))
        })
        .collect()
}

// ── BPJS rates (0800) ───────────────────────────────────────────────────────

/// One stated set of BPJS rates, from a date.
pub struct StatutoryRateRecord {
    pub effective_from: NaiveDate,
    pub rates: crate::cloud::domain::BpjsRates,
    pub ratified: Authorization,
}

/// Every set of BPJS rates ever stated, newest first.
pub async fn statutory_rates(pool: &PgPool) -> Result<Vec<StatutoryRateRecord>, AppError> {
    let rows = sqlx::query(
        "SELECT effective_from, kesehatan_company_bp, kesehatan_employee_bp, kesehatan_cap_minor,
                jht_company_bp, jht_employee_bp, jp_company_bp, jp_employee_bp, jp_cap_minor,
                jkk_bp, jkm_bp, ratified
           FROM statutory_rate ORDER BY effective_from DESC",
    )
    .fetch_all(pool)
    .await?;
    rows.iter()
        .map(|row| {
            let bp = |column: &str| -> Result<i64, AppError> {
                Ok(i64::from(row.try_get::<i32, _>(column)?))
            };
            Ok(StatutoryRateRecord {
                effective_from: row.try_get("effective_from")?,
                rates: crate::cloud::domain::BpjsRates {
                    kesehatan_company_bp: bp("kesehatan_company_bp")?,
                    kesehatan_employee_bp: bp("kesehatan_employee_bp")?,
                    kesehatan_cap_minor: row.try_get("kesehatan_cap_minor")?,
                    jht_company_bp: bp("jht_company_bp")?,
                    jht_employee_bp: bp("jht_employee_bp")?,
                    jp_company_bp: bp("jp_company_bp")?,
                    jp_employee_bp: bp("jp_employee_bp")?,
                    jp_cap_minor: row.try_get("jp_cap_minor")?,
                    jkk_bp: bp("jkk_bp")?,
                    jkm_bp: bp("jkm_bp")?,
                },
                ratified: serde_json::from_value(row.try_get("ratified")?)
                    .map_err(|error| corrupt("statutory rate authority", error.to_string()))?,
            })
        })
        .collect()
}

/// State a new set of BPJS rates from a date. Forward-only, as a component's
/// rate is: a date on or before the latest already stated is refused, because
/// a month already paid was paid at the rates then in force.
pub async fn ratify_statutory_rate(
    pool: &PgPool,
    effective_from: NaiveDate,
    rates: &crate::cloud::domain::BpjsRates,
    authorization: &Authorization,
) -> Result<(), AppError> {
    let mut tx = pool.begin().await?;
    sqlx::query("LOCK TABLE statutory_rate IN SHARE ROW EXCLUSIVE MODE")
        .execute(&mut *tx)
        .await?;
    let latest: Option<NaiveDate> =
        sqlx::query_scalar("SELECT max(effective_from) FROM statutory_rate")
            .fetch_one(&mut *tx)
            .await?;
    if let Some(latest) = latest {
        if effective_from <= latest {
            return Err(AppError::Conflict(format!(
                "BPJS rates are already stated from {latest}; new rates take effect after it"
            )));
        }
    }
    let bp = |value: i64| i32::try_from(value).unwrap_or(i32::MAX);
    sqlx::query(
        "INSERT INTO statutory_rate
             (effective_from, kesehatan_company_bp, kesehatan_employee_bp, kesehatan_cap_minor,
              jht_company_bp, jht_employee_bp, jp_company_bp, jp_employee_bp, jp_cap_minor,
              jkk_bp, jkm_bp, ratified)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)",
    )
    .bind(effective_from)
    .bind(bp(rates.kesehatan_company_bp))
    .bind(bp(rates.kesehatan_employee_bp))
    .bind(rates.kesehatan_cap_minor)
    .bind(bp(rates.jht_company_bp))
    .bind(bp(rates.jht_employee_bp))
    .bind(bp(rates.jp_company_bp))
    .bind(bp(rates.jp_employee_bp))
    .bind(rates.jp_cap_minor)
    .bind(bp(rates.jkk_bp))
    .bind(bp(rates.jkm_bp))
    .bind(serde_json::to_value(authorization)?)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(())
}

// ── salary structures (0802) ────────────────────────────────────────────────

/// One salary structure as stored.
pub struct SalaryStructureRecord {
    pub code: String,
    pub name: String,
    pub base_minor: Option<i64>,
    /// `(code, minor)`, in the order they were stated.
    pub allowances: Vec<(String, i64)>,
    pub defined: Authorization,
    pub retired: bool,
}

pub async fn salary_structures(pool: &PgPool) -> Result<Vec<SalaryStructureRecord>, AppError> {
    let rows = sqlx::query(
        "SELECT code, name, base_minor, allowances, defined, retired_at
           FROM salary_structure ORDER BY (retired_at IS NOT NULL), code",
    )
    .fetch_all(pool)
    .await?;
    rows.iter()
        .map(|row| {
            let raw: serde_json::Value = row.try_get("allowances")?;
            let allowances = raw
                .as_array()
                .map(|lines| {
                    lines
                        .iter()
                        .filter_map(|line| {
                            Some((
                                line.get("code")?.as_str()?.to_owned(),
                                line.get("minor")?.as_i64()?,
                            ))
                        })
                        .collect()
                })
                .unwrap_or_default();
            Ok(SalaryStructureRecord {
                code: row.try_get("code")?,
                name: row.try_get("name")?,
                base_minor: row.try_get("base_minor")?,
                allowances,
                defined: serde_json::from_value(row.try_get("defined")?)
                    .map_err(|error| corrupt("structure authority", error.to_string()))?,
                retired: row
                    .try_get::<Option<DateTime<Utc>>, _>("retired_at")?
                    .is_some(),
            })
        })
        .collect()
}

/// Define a structure, or restate a live one. A retired structure is not
/// brought back: its code stays retired, and a new code is a new structure.
pub async fn save_salary_structure(
    pool: &PgPool,
    record: &SalaryStructureRecord,
) -> Result<(), AppError> {
    let allowances: Vec<serde_json::Value> = record
        .allowances
        .iter()
        .map(|(code, minor)| serde_json::json!({ "code": code, "minor": minor }))
        .collect();
    let written = sqlx::query(
        "INSERT INTO salary_structure (code, name, base_minor, allowances, defined)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (code) DO UPDATE SET
            name = EXCLUDED.name,
            base_minor = EXCLUDED.base_minor,
            allowances = EXCLUDED.allowances,
            defined = EXCLUDED.defined,
            updated_at = now()
          WHERE salary_structure.retired_at IS NULL",
    )
    .bind(&record.code)
    .bind(&record.name)
    .bind(record.base_minor)
    .bind(serde_json::Value::Array(allowances))
    .bind(serde_json::to_value(&record.defined)?)
    .execute(pool)
    .await?;
    if written.rows_affected() == 0 {
        return Err(AppError::Conflict(format!(
            "{} is a retired structure; define a new code",
            record.code
        )));
    }
    Ok(())
}

pub async fn retire_salary_structure(
    pool: &PgPool,
    code: &str,
    authorization: &Authorization,
) -> Result<(), AppError> {
    let updated = sqlx::query(
        "UPDATE salary_structure SET retired_at = now(), retired = $2, updated_at = now()
          WHERE code = $1 AND retired_at IS NULL",
    )
    .bind(code)
    .bind(serde_json::to_value(authorization)?)
    .execute(pool)
    .await?;
    if updated.rows_affected() == 0 {
        return Err(AppError::NotFound(format!("live salary structure {code}")));
    }
    Ok(())
}
