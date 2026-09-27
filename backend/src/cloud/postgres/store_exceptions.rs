//! Store exceptions: one "needs attention" list that head office and each
//! store manager work from (owner's decision of 28 Sep 2026, 0646-0648).
//!
//! # Read from data, remembered in one table
//!
//! Nothing here is filed by a person. Each kind is a reading of tables the
//! stores already fill, and nothing is written to any of them:
//!
//! | kind | read from |
//! |---|---|
//! | `SHIFT_NOT_CLOSED` | `cash_shift` still `OPEN` past its business day (`site_local_date`) |
//! | `DEPOSIT_MISSING` | cash tendered on `edge_sale_tender`, net of change, against `store_deposit.banked_on` |
//! | `RECEIVE_OVERDUE` | `flow_stage_state.deadline_at` passed on RECEIVE, or on any parked stage |
//! | `MISSING_OPEN` | `inventory_projection` in a `MISSING` place, undecided for days |
//! | `CASH_DIFFERENCE` | `cash_shift.variance_minor` past the threshold, not accepted (`approved_at`) |
//! | `CHECKOUT_UNRESOLVED` | `edge_checkout_exception` still `OPEN` with money held |
//!
//! The last is the one kind the owner's list did not name: the data already
//! exists (`checkout_exceptions.rs`) and it is plainly an exception — a
//! shopper paid and has no sale.
//!
//! What those tables cannot hold is memory: who has it, whether anybody was
//! told. That is `store_exception` (0647), one row per thing while it is
//! wrong. [`exceptions_sweep`] finds everything, writes what is new, updates
//! what is still wrong, and closes what is not found any more — the shift was
//! closed, the bag was banked. Nobody closes an exception by saying so.
//!
//! # When
//!
//! Every five minutes from the cloud's loop, which also tells people; and on
//! demand when the list is read, at most once a minute, which does not. A
//! transaction-scoped advisory lock keeps two sweeps from judging at once.
//!
//! # Who is told
//!
//! Once, when an exception is red: `store.exception.raised` if it was red
//! when first found, `store.exception.escalated` if it turned red later. To
//! the unit's PIC and the people holding its owner roles at that unit — or at
//! head office, for head office's roles (0648).
//!
//! # Function names
//!
//! Prefixed `exception`/`exceptions`, because `postgres/mod.rs` re-exports
//! every module with `pub use x::*`.

use super::notifications::{raise_notification, NewNotification};
use super::stores::StoreReach;
use crate::cloud::application::AppError;
use crate::cloud::domain::flow::{FlowRole, StageKind, StageSide};
use crate::cloud::domain::store_exception::{
    lateness, rupiah, ExceptionKind, ExceptionState, Severity, StateFilter,
};
use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::{PgPool, Postgres, Row, Transaction};
use std::collections::{BTreeMap, HashMap};
use std::sync::atomic::{AtomicI64, Ordering};
use uuid::Uuid;

/// The job beat the sweep writes (`fleet_job_beat`, 0640).
pub const JOB_EXCEPTIONS: &str = "exceptions";

/// A read sweeps first when the last sweep in this process is older than
/// this.
const REFRESH_AFTER_SECONDS: i64 = 60;

/// When this process last swept, as Unix seconds.
static LAST_SWEEP: AtomicI64 = AtomicI64::new(0);

/// The key of the advisory lock one sweep holds.
const SWEEP_LOCK: &str = "store_exception_sweep";

// ════════════════════════════════════════════════════════════════════════════
// Settings (0646)
// ════════════════════════════════════════════════════════════════════════════

/// `GET/PUT /api/v1/exceptions/settings`: the whole set, read and written at
/// once. Money is in rupiah (`_minor` is the amount).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ExceptionSettings {
    /// Off: the sweep finds nothing new and closes nothing; what is open
    /// stays as it is until it is on again.
    pub enabled: bool,
    /// A shift is late this long after its business day ends.
    pub shift_grace_minutes: i32,
    /// Red when later than this.
    pub shift_bad_hours: i32,
    /// A counted drawer off by more than this, not accepted, is an exception.
    pub cash_difference_minor: i64,
    /// Red above this.
    pub cash_difference_bad_minor: i64,
    /// A day's cash takings are banked by the end of the day this many days
    /// later.
    pub deposit_due_days: i32,
    /// A shortfall no larger than this is rounding.
    pub deposit_tolerance_minor: i64,
    /// Red once this many days late.
    pub deposit_bad_days: i32,
    /// How far back the takings are read.
    pub deposit_lookback_days: i32,
    /// A flow stage past its deadline is red once it is this late.
    pub stage_bad_hours: i32,
    /// Missing goods undecided for this long are an exception.
    pub missing_open_days: i32,
    /// Red at this age.
    pub missing_bad_days: i32,
    /// An unanswered checkout with money held is red after this long.
    pub checkout_bad_hours: i32,
    /// Tell the unit's PIC.
    pub notify_unit_pic: bool,
    /// Job roles told as well as each kind's owners.
    pub also_notify_roles: Vec<String>,
}

impl Default for ExceptionSettings {
    /// 0646's defaults, for a database that has lost its row.
    fn default() -> Self {
        Self {
            enabled: true,
            shift_grace_minutes: 120,
            shift_bad_hours: 12,
            cash_difference_minor: 10_000,
            cash_difference_bad_minor: 100_000,
            deposit_due_days: 1,
            deposit_tolerance_minor: 1_000,
            deposit_bad_days: 2,
            deposit_lookback_days: 31,
            stage_bad_hours: 24,
            missing_open_days: 7,
            missing_bad_days: 30,
            checkout_bad_hours: 24,
            notify_unit_pic: true,
            also_notify_roles: Vec::new(),
        }
    }
}

impl ExceptionSettings {
    /// The ranges 0646 holds the columns to, said as sentences before the
    /// database refuses them with a constraint name.
    pub fn validate(&self) -> Result<(), AppError> {
        let within = |value: i32, low: i32, high: i32, what: &str| {
            if (low..=high).contains(&value) {
                Ok(())
            } else {
                Err(AppError::Validation(format!(
                    "{what} is {low} to {high}; {value} is outside it"
                )))
            }
        };
        within(self.shift_grace_minutes, 0, 1440, "shift_grace_minutes")?;
        within(self.shift_bad_hours, 1, 720, "shift_bad_hours")?;
        within(self.deposit_due_days, 0, 14, "deposit_due_days")?;
        within(self.deposit_bad_days, 1, 60, "deposit_bad_days")?;
        within(self.deposit_lookback_days, 7, 120, "deposit_lookback_days")?;
        within(self.stage_bad_hours, 1, 720, "stage_bad_hours")?;
        within(self.missing_open_days, 1, 365, "missing_open_days")?;
        within(self.missing_bad_days, 1, 730, "missing_bad_days")?;
        within(self.checkout_bad_hours, 1, 720, "checkout_bad_hours")?;
        if self.cash_difference_minor < 0
            || self.cash_difference_bad_minor < 0
            || self.deposit_tolerance_minor < 0
        {
            return Err(AppError::Validation("an amount cannot be negative".into()));
        }
        if self.cash_difference_bad_minor < self.cash_difference_minor {
            return Err(AppError::Validation(
                "the red line for a cash difference cannot be below the line that makes it an \
                 exception"
                    .into(),
            ));
        }
        if self.missing_bad_days < self.missing_open_days {
            return Err(AppError::Validation(
                "missing goods cannot turn red before they are an exception".into(),
            ));
        }
        if self.also_notify_roles.len() > 16 {
            return Err(AppError::Validation("at most 16 roles are told as well".into()));
        }
        if self
            .also_notify_roles
            .iter()
            .any(|role| role.trim().is_empty() || role.trim() != role)
        {
            return Err(AppError::Validation(
                "a role to tell is a job role code, without spaces around it".into(),
            ));
        }
        Ok(())
    }
}

/// The settings with who last changed them.
#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ExceptionSettingsView {
    #[serde(flatten)]
    pub settings: ExceptionSettings,
    pub updated_by: Option<String>,
    pub updated_at: Option<DateTime<Utc>>,
}

/// The one row of 0646, or its defaults.
pub async fn exception_settings(
    executor: impl sqlx::PgExecutor<'_>,
) -> Result<ExceptionSettingsView, AppError> {
    let row = sqlx::query(
        "SELECT enabled, shift_grace_minutes, shift_bad_hours, cash_difference_minor,
                cash_difference_bad_minor, deposit_due_days, deposit_tolerance_minor,
                deposit_bad_days, deposit_lookback_days, stage_bad_hours, missing_open_days,
                missing_bad_days, checkout_bad_hours, notify_unit_pic, also_notify_roles,
                updated_by, updated_at
           FROM exception_setting WHERE singleton",
    )
    .fetch_optional(executor)
    .await?;
    let Some(row) = row else {
        return Ok(ExceptionSettingsView {
            settings: ExceptionSettings::default(),
            updated_by: None,
            updated_at: None,
        });
    };
    Ok(ExceptionSettingsView {
        settings: ExceptionSettings {
            enabled: row.try_get("enabled")?,
            shift_grace_minutes: row.try_get("shift_grace_minutes")?,
            shift_bad_hours: row.try_get("shift_bad_hours")?,
            cash_difference_minor: row.try_get("cash_difference_minor")?,
            cash_difference_bad_minor: row.try_get("cash_difference_bad_minor")?,
            deposit_due_days: row.try_get("deposit_due_days")?,
            deposit_tolerance_minor: row.try_get("deposit_tolerance_minor")?,
            deposit_bad_days: row.try_get("deposit_bad_days")?,
            deposit_lookback_days: row.try_get("deposit_lookback_days")?,
            stage_bad_hours: row.try_get("stage_bad_hours")?,
            missing_open_days: row.try_get("missing_open_days")?,
            missing_bad_days: row.try_get("missing_bad_days")?,
            checkout_bad_hours: row.try_get("checkout_bad_hours")?,
            notify_unit_pic: row.try_get("notify_unit_pic")?,
            also_notify_roles: row.try_get("also_notify_roles")?,
        },
        updated_by: row.try_get("updated_by")?,
        updated_at: row.try_get("updated_at")?,
    })
}

/// Replace the settings. Admin only (`domain::auth`).
pub async fn exception_update_settings(
    pool: &PgPool,
    settings: &ExceptionSettings,
    actor: &str,
) -> Result<ExceptionSettingsView, AppError> {
    settings.validate()?;
    sqlx::query(
        "INSERT INTO exception_setting (
             singleton, enabled, shift_grace_minutes, shift_bad_hours, cash_difference_minor,
             cash_difference_bad_minor, deposit_due_days, deposit_tolerance_minor,
             deposit_bad_days, deposit_lookback_days, stage_bad_hours, missing_open_days,
             missing_bad_days, checkout_bad_hours, notify_unit_pic, also_notify_roles,
             updated_by, updated_at)
         VALUES (true, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
                 now())
         ON CONFLICT (singleton) DO UPDATE SET
             enabled = EXCLUDED.enabled,
             shift_grace_minutes = EXCLUDED.shift_grace_minutes,
             shift_bad_hours = EXCLUDED.shift_bad_hours,
             cash_difference_minor = EXCLUDED.cash_difference_minor,
             cash_difference_bad_minor = EXCLUDED.cash_difference_bad_minor,
             deposit_due_days = EXCLUDED.deposit_due_days,
             deposit_tolerance_minor = EXCLUDED.deposit_tolerance_minor,
             deposit_bad_days = EXCLUDED.deposit_bad_days,
             deposit_lookback_days = EXCLUDED.deposit_lookback_days,
             stage_bad_hours = EXCLUDED.stage_bad_hours,
             missing_open_days = EXCLUDED.missing_open_days,
             missing_bad_days = EXCLUDED.missing_bad_days,
             checkout_bad_hours = EXCLUDED.checkout_bad_hours,
             notify_unit_pic = EXCLUDED.notify_unit_pic,
             also_notify_roles = EXCLUDED.also_notify_roles,
             updated_by = EXCLUDED.updated_by,
             updated_at = EXCLUDED.updated_at",
    )
    .bind(settings.enabled)
    .bind(settings.shift_grace_minutes)
    .bind(settings.shift_bad_hours)
    .bind(settings.cash_difference_minor)
    .bind(settings.cash_difference_bad_minor)
    .bind(settings.deposit_due_days)
    .bind(settings.deposit_tolerance_minor)
    .bind(settings.deposit_bad_days)
    .bind(settings.deposit_lookback_days)
    .bind(settings.stage_bad_hours)
    .bind(settings.missing_open_days)
    .bind(settings.missing_bad_days)
    .bind(settings.checkout_bad_hours)
    .bind(settings.notify_unit_pic)
    .bind(&settings.also_notify_roles)
    .bind(actor)
    .execute(pool)
    .await?;
    exception_settings(pool).await
}

// ════════════════════════════════════════════════════════════════════════════
// Detection
// ════════════════════════════════════════════════════════════════════════════

/// One thing found wrong now.
#[derive(Debug, Clone)]
struct Detected {
    kind: ExceptionKind,
    subject_key: String,
    unit_id: String,
    site_id: Option<String>,
    title: String,
    sentence: String,
    since: DateTime<Utc>,
    severity: Severity,
    owner_roles: Vec<String>,
    link_screen: &'static str,
    link_params: Value,
}

fn owners(kind: ExceptionKind) -> Vec<String> {
    kind.owner_roles().iter().map(|role| (*role).to_owned()).collect()
}

fn seconds_between(from: DateTime<Utc>, to: DateTime<Utc>) -> i64 {
    (to - from).num_seconds().max(0)
}

/// Till shifts still open after their business day, the shop's own day.
async fn detect_open_shifts(
    pool: &PgPool,
    settings: &ExceptionSettings,
    now: DateTime<Utc>,
) -> Result<Vec<Detected>, AppError> {
    let rows = sqlx::query(
        "WITH open_shift AS (
             SELECT c.shift_id, c.site_id, c.terminal_id, c.opened_by, c.opened_at,
                    s.unit_id, s.name AS site_name,
                    site_local_date(c.opened_at, c.site_id) AS business_day,
                    ((site_local_date(c.opened_at, c.site_id) + 1)::timestamp
                        AT TIME ZONE site_business_timezone(c.site_id)) AS day_ended_at
               FROM cash_shift c
               JOIN site s ON s.id = c.site_id
              WHERE c.status = 'OPEN'
         )
         SELECT * FROM open_shift
          WHERE $1::timestamptz >= day_ended_at + make_interval(mins => $2::int)",
    )
    .bind(now)
    .bind(settings.shift_grace_minutes)
    .fetch_all(pool)
    .await?;

    let bad_after = i64::from(settings.shift_bad_hours) * 3600;
    let mut found = Vec::with_capacity(rows.len());
    for row in &rows {
        let shift_id: Uuid = row.try_get("shift_id")?;
        let site_id: String = row.try_get("site_id")?;
        let unit_id: String = row.try_get("unit_id")?;
        let site_name: String = row.try_get("site_name")?;
        let terminal: String = row.try_get("terminal_id")?;
        let opened_by: String = row.try_get("opened_by")?;
        let business_day: NaiveDate = row.try_get("business_day")?;
        let day_ended_at: DateTime<Utc> = row.try_get("day_ended_at")?;
        let late = seconds_between(day_ended_at, now);
        found.push(Detected {
            kind: ExceptionKind::ShiftNotClosed,
            subject_key: shift_id.to_string(),
            unit_id: unit_id.clone(),
            site_id: Some(site_id),
            title: format!("Till {terminal} is still open"),
            sentence: format!(
                "The shift {opened_by} opened on till {terminal} at {site_name} on {business_day} \
                 is still open {} after that business day ended. Close it on the till so its \
                 drawer is counted.",
                lateness(late)
            ),
            since: day_ended_at,
            severity: Severity::past(late, bad_after),
            owner_roles: owners(ExceptionKind::ShiftNotClosed),
            link_screen: "store-money.shift",
            link_params: json!({ "shift_id": shift_id.to_string(), "unit_id": unit_id }),
        });
    }
    Ok(found)
}

/// Closed shifts whose count is off past the threshold and that head office
/// has not accepted — the same rows `cash_shift_list(unapproved_only)` shows,
/// narrowed by the threshold. Accepting the difference is what closes one.
async fn detect_cash_differences(
    pool: &PgPool,
    settings: &ExceptionSettings,
) -> Result<Vec<Detected>, AppError> {
    let rows = sqlx::query(
        "SELECT c.shift_id, c.site_id, c.terminal_id, c.closed_by, c.closed_at,
                c.variance_minor, c.declared_cash_minor, c.expected_cash_minor,
                s.unit_id, s.name AS site_name,
                site_local_date(c.closed_at, c.site_id) AS closed_day
           FROM cash_shift c
           JOIN site s ON s.id = c.site_id
          WHERE c.status = 'CLOSED'
            AND c.variance_minor IS NOT NULL AND c.variance_minor <> 0
            AND c.approved_at IS NULL
            AND abs(c.variance_minor) > $1",
    )
    .bind(settings.cash_difference_minor)
    .fetch_all(pool)
    .await?;

    let mut found = Vec::with_capacity(rows.len());
    for row in &rows {
        let shift_id: Uuid = row.try_get("shift_id")?;
        let site_id: String = row.try_get("site_id")?;
        let unit_id: String = row.try_get("unit_id")?;
        let site_name: String = row.try_get("site_name")?;
        let terminal: String = row.try_get("terminal_id")?;
        let closed_by: Option<String> = row.try_get("closed_by")?;
        let closed_at: DateTime<Utc> = row.try_get("closed_at")?;
        let closed_day: NaiveDate = row.try_get("closed_day")?;
        let variance: i64 = row.try_get("variance_minor")?;
        let declared: Option<i64> = row.try_get("declared_cash_minor")?;
        let expected: Option<i64> = row.try_get("expected_cash_minor")?;
        let way = if variance < 0 { "short" } else { "over" };
        let counted = match (declared, expected) {
            (Some(declared), Some(expected)) => format!(
                "counted {} where the till expected {}",
                rupiah(declared),
                rupiah(expected)
            ),
            _ => "counted the drawer".to_owned(),
        };
        found.push(Detected {
            kind: ExceptionKind::CashDifference,
            subject_key: shift_id.to_string(),
            unit_id: unit_id.clone(),
            site_id: Some(site_id),
            title: format!("Drawer {way} {} on till {terminal}", rupiah(variance.abs())),
            sentence: format!(
                "{} {counted} on till {terminal} at {site_name} on {closed_day}: {way} by {}. \
                 Nobody at head office has accepted the difference yet.",
                closed_by.as_deref().unwrap_or("The cashier"),
                rupiah(variance.abs())
            ),
            since: closed_at,
            severity: Severity::past(variance.abs(), settings.cash_difference_bad_minor.max(1)),
            owner_roles: owners(ExceptionKind::CashDifference),
            link_screen: "store-money.shift",
            link_params: json!({ "shift_id": shift_id.to_string(), "unit_id": unit_id }),
        });
    }
    Ok(found)
}

/// A store's cash takings, day by day, against what it has banked.
///
/// Store money keeps no deadline of its own, so the rule is the one 0646
/// writes down: the cash taken on day D — cash tendered at the counter less
/// the change given, on the store's completed sales (`edge_sale`), cut on the
/// shop's own clock — is banked by the end of D + `deposit_due_days`. It is
/// read cumulatively over the look-back window: everything taken up to D
/// against every deposit (`store_deposit`, any status: a recorded bag has
/// left the till) banked on or before D's due day. A day is short when the
/// running takings outrun the running deposits past the tolerance; the bag
/// that catches up closes every day it covers.
async fn detect_missing_deposits(
    pool: &PgPool,
    settings: &ExceptionSettings,
) -> Result<Vec<Detected>, AppError> {
    let rows = sqlx::query(
        "WITH store AS (
             SELECT u.id AS unit_id,
                    (SELECT s.id FROM site s WHERE s.unit_id = u.id ORDER BY s.id LIMIT 1)
                        AS clock_site
               FROM unit u
              WHERE u.kind = 'STORE' AND u.status = 'ACTIVE'
         ), span AS (
             SELECT unit_id, clock_site,
                    site_local_date(now(), clock_site) AS today,
                    site_local_date(now(), clock_site) - $1::int AS first_day
               FROM store WHERE clock_site IS NOT NULL
         ), sale_cash AS (
             SELECT sp.unit_id, site_local_date(e.occurred_at, e.site_id) AS day,
                    GREATEST(SUM(t.amount_minor) - e.change_minor, 0) AS cash
               FROM span sp
               JOIN site s ON s.unit_id = sp.unit_id
               JOIN edge_sale e ON e.site_id = s.id AND e.status = 'COMPLETED'
               JOIN edge_sale_tender t ON t.sale_id = e.sale_id AND t.method = 'CASH'
              WHERE e.occurred_at >= (sp.first_day::timestamp
                                        AT TIME ZONE site_business_timezone(sp.clock_site))
              GROUP BY sp.unit_id, e.sale_id, e.site_id, e.occurred_at, e.change_minor
         ), days AS (
             SELECT unit_id, day, SUM(cash)::bigint AS cash
               FROM sale_cash GROUP BY unit_id, day
         ), running AS (
             SELECT unit_id, day, cash,
                    (SUM(cash) OVER (PARTITION BY unit_id ORDER BY day))::bigint AS taken_to_date
               FROM days
         ), judged AS (
             SELECT r.unit_id, r.day, r.cash, r.taken_to_date, sp.today, sp.clock_site,
                    sp.first_day, r.day + $2::int AS due_day,
                    COALESCE((SELECT SUM(d.amount_minor) FROM store_deposit d
                               WHERE d.unit_id = r.unit_id
                                 AND d.banked_on >= sp.first_day
                                 AND d.banked_on <= r.day + $2::int), 0)::bigint AS banked
               FROM running r
               JOIN span sp ON sp.unit_id = r.unit_id
         )
         SELECT j.unit_id, j.day, j.cash, j.taken_to_date, j.banked, j.due_day, j.today,
                j.clock_site, s.name AS site_name,
                ((j.due_day + 1)::timestamp AT TIME ZONE site_business_timezone(j.clock_site))
                    AS due_at
           FROM judged j
           JOIN site s ON s.id = j.clock_site
          WHERE j.due_day < j.today
            AND j.cash > 0
            AND j.taken_to_date - j.banked > $3
          ORDER BY j.unit_id, j.day",
    )
    .bind(settings.deposit_lookback_days)
    .bind(settings.deposit_due_days)
    .bind(settings.deposit_tolerance_minor)
    .fetch_all(pool)
    .await?;

    let mut found = Vec::with_capacity(rows.len());
    for row in &rows {
        let unit_id: String = row.try_get("unit_id")?;
        let day: NaiveDate = row.try_get("day")?;
        let cash: i64 = row.try_get("cash")?;
        let taken: i64 = row.try_get("taken_to_date")?;
        let banked: i64 = row.try_get("banked")?;
        let due_day: NaiveDate = row.try_get("due_day")?;
        let today: NaiveDate = row.try_get("today")?;
        let site_id: String = row.try_get("clock_site")?;
        let site_name: String = row.try_get("site_name")?;
        let due_at: DateTime<Utc> = row.try_get("due_at")?;
        let short = (taken - banked).min(cash);
        let days_late = (today - due_day).num_days();
        found.push(Detected {
            kind: ExceptionKind::DepositMissing,
            subject_key: format!("{unit_id}:{day}"),
            unit_id: unit_id.clone(),
            site_id: Some(site_id),
            title: format!("Takings of {day} not banked"),
            sentence: format!(
                "{site_name} took {} in cash on {day}, due at the bank by the end of {due_day}. \
                 {} of it has not been deposited: the store has taken {} in cash since the \
                 window opened and banked {}.",
                rupiah(cash),
                rupiah(short),
                rupiah(taken),
                rupiah(banked)
            ),
            since: due_at,
            severity: Severity::past(days_late, i64::from(settings.deposit_bad_days)),
            owner_roles: owners(ExceptionKind::DepositMissing),
            link_screen: "store-money.deposits",
            link_params: json!({ "unit_id": unit_id, "day": day.to_string() }),
        });
    }
    Ok(found)
}

/// Flow stages past their template deadline: every RECEIVE stage that has not
/// happened, and any stage parked waiting for a node, a scan or a decision.
///
/// Owned by the job roles that hold the stage's performer role (0633), at the
/// site where the stage happens (`StageSpec::side`).
async fn detect_overdue_stages(
    pool: &PgPool,
    settings: &ExceptionSettings,
    now: DateTime<Utc>,
) -> Result<Vec<Detected>, AppError> {
    let rows = sqlx::query(
        "SELECT d.id AS document_id, d.document_number, t.name AS template_name,
                d.origin_site_id, d.origin_unit_id, os.name AS origin_name,
                d.destination_site_id, d.destination_unit_id, ds.name AS destination_name,
                s.stage_kind, s.status, s.performer_role, s.park_reason, s.deadline_at
           FROM flow_stage_state s
           JOIN flow_document d ON d.id = s.document_id
           JOIN flow_template t ON t.id = d.template_id
           LEFT JOIN site os ON os.id = d.origin_site_id
           LEFT JOIN site ds ON ds.id = d.destination_site_id
          WHERE s.status IN ('PENDING', 'PARKED')
            AND (s.stage_kind = 'RECEIVE' OR s.status = 'PARKED')
            AND s.deadline_at IS NOT NULL
            AND s.deadline_at < $1
            AND d.status IN ('REQUESTED', 'CONFIRMED')",
    )
    .bind(now)
    .fetch_all(pool)
    .await?;
    if rows.is_empty() {
        return Ok(Vec::new());
    }

    // Which job roles hold each flow role. OWNER and ADMIN hold them all and
    // are nobody's first call.
    let holders: Vec<(String, Vec<String>)> = sqlx::query_as(
        "SELECT code, flow_roles FROM job_role
          WHERE code NOT IN ('OWNER', 'ADMIN')
          ORDER BY sort_order, code",
    )
    .fetch_all(pool)
    .await?;
    let head_office = super::sites::head_office_unit_id(pool).await.ok();

    let bad_after = i64::from(settings.stage_bad_hours) * 3600;
    let mut found = Vec::with_capacity(rows.len());
    for row in &rows {
        let document_id: Uuid = row.try_get("document_id")?;
        let number: String = row.try_get("document_number")?;
        let template: String = row.try_get("template_name")?;
        let stage_code: String = row.try_get("stage_kind")?;
        let status: String = row.try_get("status")?;
        let performer: String = row.try_get("performer_role")?;
        let park_reason: Option<String> = row.try_get("park_reason")?;
        let deadline: DateTime<Utc> = row.try_get("deadline_at")?;
        let origin: (Option<String>, Option<String>, Option<String>) = (
            row.try_get("origin_site_id")?,
            row.try_get("origin_unit_id")?,
            row.try_get("origin_name")?,
        );
        let destination: (Option<String>, Option<String>, Option<String>) = (
            row.try_get("destination_site_id")?,
            row.try_get("destination_unit_id")?,
            row.try_get("destination_name")?,
        );

        let stage = StageKind::parse(&stage_code);
        let label = stage.map_or(stage_code.as_str(), |kind| kind.spec().label);
        // Where it happens: the stage's side, else the other end when that
        // side is a supplier or a customer rather than one of our sites.
        let (site_id, unit_id, site_name) = match stage.map(|kind| kind.spec().side) {
            Some(StageSide::HeadOffice) => (None, head_office.clone(), None),
            Some(StageSide::Origin) if origin.1.is_some() => origin.clone(),
            Some(StageSide::Destination) | None if destination.1.is_some() => destination.clone(),
            _ if destination.1.is_some() => destination.clone(),
            _ => origin.clone(),
        };
        let Some(unit_id) = unit_id else {
            continue;
        };

        let mut owner_roles: Vec<String> = holders
            .iter()
            .filter(|(_, flow_roles)| flow_roles.iter().any(|role| role == &performer))
            .map(|(code, _)| code.clone())
            .collect();
        if owner_roles.is_empty() {
            owner_roles = owners(ExceptionKind::ReceiveOverdue);
        }
        let performer_label = FlowRole::parse(&performer).map_or(performer.clone(), |role| {
            role.label().to_owned()
        });
        let waiting = match (status.as_str(), park_reason.as_deref()) {
            ("PARKED", Some("SCAN")) => " It is parked waiting for the node's scan.",
            ("PARKED", Some("APPROVAL")) => " It is parked waiting for a decision.",
            ("PARKED", Some("HANDOVER")) => " It is parked waiting for the handover.",
            _ => "",
        };
        let late = seconds_between(deadline, now);
        let place = site_name.as_deref().map_or_else(String::new, |name| format!(" at {name}"));
        found.push(Detected {
            kind: ExceptionKind::ReceiveOverdue,
            subject_key: format!("{document_id}:{stage_code}"),
            unit_id,
            site_id,
            title: format!("{number}: {label} {} late", lateness(late)),
            sentence: format!(
                "{template} {number} is {} past its deadline for {label}, done by \
                 {performer_label}{place}.{waiting}",
                lateness(late)
            ),
            since: deadline,
            severity: Severity::past(late, bad_after),
            owner_roles,
            link_screen: "flows.document",
            link_params: json!({
                "document_id": document_id.to_string(),
                "document_number": number,
                "stage": stage_code,
            }),
        });
    }
    Ok(found)
}

/// Missing goods at a site that nobody has found or confirmed lost within
/// `missing_open_days` — one exception per site, not one per piece: a count
/// that turns up forty missing is one piece of work for Inventory.
async fn detect_open_missing(
    pool: &PgPool,
    settings: &ExceptionSettings,
    now: DateTime<Utc>,
) -> Result<Vec<Detected>, AppError> {
    let rows = sqlx::query(
        "WITH missing AS (
             SELECT op.site_id, pr.quantity,
                    (SELECT m.occurred_at FROM movement m
                      WHERE m.subject_id = pr.subject_id AND m.to_place_id = pr.place_id
                      ORDER BY m.occurred_at LIMIT 1) AS missing_since
               FROM inventory_projection pr
               JOIN inventory_place ip ON ip.id = pr.place_id AND ip.state = 'MISSING'
               JOIN operational_pool op ON op.id = ip.pool_id
              WHERE pr.quantity > 0
         )
         SELECT m.site_id, s.unit_id, s.name AS site_name,
                COUNT(*)::bigint AS subjects, SUM(m.quantity)::bigint AS pieces,
                MIN(m.missing_since) AS oldest
           FROM missing m
           JOIN site s ON s.id = m.site_id
          WHERE m.missing_since < $1::timestamptz - make_interval(days => $2::int)
          GROUP BY m.site_id, s.unit_id, s.name",
    )
    .bind(now)
    .bind(settings.missing_open_days)
    .fetch_all(pool)
    .await?;

    let bad_after = i64::from(settings.missing_bad_days) * 86_400;
    let mut found = Vec::with_capacity(rows.len());
    for row in &rows {
        let site_id: String = row.try_get("site_id")?;
        let unit_id: String = row.try_get("unit_id")?;
        let site_name: String = row.try_get("site_name")?;
        let subjects: i64 = row.try_get("subjects")?;
        let pieces: i64 = row.try_get("pieces")?;
        let oldest: DateTime<Utc> = row.try_get("oldest")?;
        let age = seconds_between(oldest, now);
        found.push(Detected {
            kind: ExceptionKind::MissingOpen,
            subject_key: site_id.clone(),
            unit_id,
            site_id: Some(site_id.clone()),
            title: format!(
                "{pieces} {} missing over {} days",
                if pieces == 1 { "piece" } else { "pieces" },
                settings.missing_open_days
            ),
            sentence: format!(
                "{pieces} {} ({subjects} {}) at {site_name} have been missing for more than {} \
                 days without being found or confirmed lost; the oldest for {}.",
                if pieces == 1 { "piece" } else { "pieces" },
                if subjects == 1 { "line" } else { "lines" },
                settings.missing_open_days,
                lateness(age)
            ),
            since: oldest,
            severity: Severity::past(age, bad_after),
            owner_roles: owners(ExceptionKind::MissingOpen),
            link_screen: "inventory.missing",
            link_params: json!({ "site_id": site_id }),
        });
    }
    Ok(found)
}

/// Checkouts a till closed as FAILED with the shopper's money held, that head
/// office has not answered (`checkout_exceptions.rs`).
async fn detect_unresolved_checkouts(
    pool: &PgPool,
    settings: &ExceptionSettings,
    now: DateTime<Utc>,
) -> Result<Vec<Detected>, AppError> {
    let rows = sqlx::query(
        "SELECT e.checkout_id, e.site_id, e.actor_id, e.money_held_minor, e.resolved_at,
                s.unit_id, s.name AS site_name,
                site_local_date(e.resolved_at, e.site_id) AS failed_day
           FROM edge_checkout_exception e
           JOIN site s ON s.id = e.site_id
          WHERE e.resolution = 'OPEN' AND e.money_held_minor > 0",
    )
    .fetch_all(pool)
    .await?;

    let bad_after = i64::from(settings.checkout_bad_hours) * 3600;
    let mut found = Vec::with_capacity(rows.len());
    for row in &rows {
        let checkout_id: Uuid = row.try_get("checkout_id")?;
        let site_id: String = row.try_get("site_id")?;
        let unit_id: String = row.try_get("unit_id")?;
        let site_name: String = row.try_get("site_name")?;
        let actor: String = row.try_get("actor_id")?;
        let held: i64 = row.try_get("money_held_minor")?;
        let failed_at: DateTime<Utc> = row.try_get("resolved_at")?;
        let failed_day: NaiveDate = row.try_get("failed_day")?;
        found.push(Detected {
            kind: ExceptionKind::CheckoutUnresolved,
            subject_key: checkout_id.to_string(),
            unit_id,
            site_id: Some(site_id),
            title: format!("{} taken with no sale", rupiah(held)),
            sentence: format!(
                "A checkout {actor} rang at {site_name} on {failed_day} could not finish: the \
                 shopper paid {} and has no sale. Refund it, recover it as a sale, or write it \
                 off.",
                rupiah(held)
            ),
            since: failed_at,
            severity: Severity::past(seconds_between(failed_at, now), bad_after),
            owner_roles: owners(ExceptionKind::CheckoutUnresolved),
            link_screen: "checkout-exceptions",
            link_params: json!({ "checkout_id": checkout_id.to_string() }),
        });
    }
    Ok(found)
}

async fn detect(
    pool: &PgPool,
    kind: ExceptionKind,
    settings: &ExceptionSettings,
    now: DateTime<Utc>,
) -> Result<Vec<Detected>, AppError> {
    match kind {
        ExceptionKind::ShiftNotClosed => detect_open_shifts(pool, settings, now).await,
        ExceptionKind::DepositMissing => detect_missing_deposits(pool, settings).await,
        ExceptionKind::ReceiveOverdue => detect_overdue_stages(pool, settings, now).await,
        ExceptionKind::MissingOpen => detect_open_missing(pool, settings, now).await,
        ExceptionKind::CashDifference => detect_cash_differences(pool, settings).await,
        ExceptionKind::CheckoutUnresolved => detect_unresolved_checkouts(pool, settings, now).await,
    }
}

// ════════════════════════════════════════════════════════════════════════════
// The sweep
// ════════════════════════════════════════════════════════════════════════════

/// What one sweep did.
#[derive(Debug, Default, Clone, Serialize)]
pub struct ExceptionSweepReport {
    pub opened: usize,
    pub still_open: usize,
    pub resolved: usize,
    pub notified: usize,
    /// Kinds whose reading failed this time; their open items were left as
    /// they were rather than closed for want of an answer.
    pub failed_kinds: Vec<String>,
    /// Another sweep held the lock, or the list is switched off.
    pub skipped: bool,
}

/// Find everything wrong now, write it down, and close what is fixed. With
/// `notify`, tell people about what is red and has not been told.
///
/// A kind whose reading fails leaves its open rows alone: a query that could
/// not run is not evidence that the shift was closed.
pub async fn exceptions_sweep(pool: &PgPool, notify: bool) -> Result<ExceptionSweepReport, AppError> {
    let now = Utc::now();
    LAST_SWEEP.store(now.timestamp(), Ordering::Relaxed);
    let settings = exception_settings(pool).await?.settings;
    let mut report = ExceptionSweepReport::default();
    if !settings.enabled {
        report.skipped = true;
        return Ok(report);
    }

    let mut detected: Vec<Detected> = Vec::new();
    let mut judged: Vec<&'static str> = Vec::new();
    for kind in ExceptionKind::ALL {
        match detect(pool, kind, &settings, now).await {
            Ok(found) => {
                judged.push(kind.code());
                detected.extend(found);
            }
            Err(error) => {
                tracing::warn!(%error, kind = kind.code(), "an exception reading failed");
                report.failed_kinds.push(kind.code().to_owned());
            }
        }
    }

    let mut tx = pool.begin().await?;
    let locked: bool = sqlx::query_scalar("SELECT pg_try_advisory_xact_lock(hashtext($1))")
        .bind(SWEEP_LOCK)
        .fetch_one(&mut *tx)
        .await?;
    if !locked {
        report.skipped = true;
        return Ok(report);
    }

    for found in &detected {
        let inserted: bool = sqlx::query_scalar(
            "INSERT INTO store_exception
                 (exception_id, kind, subject_key, unit_id, site_id, title, sentence, since,
                  severity, owner_roles, link_screen, link_params, first_severity, bad_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $9,
                     CASE WHEN $9 = 'BAD' THEN now() END)
             ON CONFLICT (kind, subject_key) WHERE resolved_at IS NULL DO UPDATE SET
                 unit_id = EXCLUDED.unit_id,
                 site_id = EXCLUDED.site_id,
                 title = EXCLUDED.title,
                 sentence = EXCLUDED.sentence,
                 since = EXCLUDED.since,
                 severity = EXCLUDED.severity,
                 owner_roles = EXCLUDED.owner_roles,
                 link_screen = EXCLUDED.link_screen,
                 link_params = EXCLUDED.link_params,
                 last_seen_at = now(),
                 bad_at = COALESCE(store_exception.bad_at, EXCLUDED.bad_at)
             RETURNING (xmax = 0)",
        )
        .bind(Uuid::new_v4())
        .bind(found.kind.code())
        .bind(&found.subject_key)
        .bind(&found.unit_id)
        .bind(&found.site_id)
        .bind(&found.title)
        .bind(&found.sentence)
        .bind(found.since)
        .bind(found.severity.code())
        .bind(&found.owner_roles)
        .bind(found.link_screen)
        .bind(&found.link_params)
        .fetch_one(&mut *tx)
        .await?;
        if inserted {
            report.opened += 1;
        } else {
            report.still_open += 1;
        }
    }

    let kinds: Vec<String> = detected.iter().map(|found| found.kind.code().to_owned()).collect();
    let subjects: Vec<String> = detected.iter().map(|found| found.subject_key.clone()).collect();
    let resolved = sqlx::query(
        "UPDATE store_exception SET resolved_at = now()
          WHERE resolved_at IS NULL
            AND kind = ANY($1)
            AND (kind, subject_key) NOT IN (
                    SELECT k, s FROM unnest($2::text[], $3::text[]) AS found (k, s))",
    )
    .bind(&judged)
    .bind(&kinds)
    .bind(&subjects)
    .execute(&mut *tx)
    .await?;
    report.resolved = resolved.rows_affected() as usize;
    tx.commit().await?;

    if notify {
        report.notified = exceptions_notify(pool, &settings).await?;
    }
    Ok(report)
}

/// Sweep before a read when this process has not swept within the minute.
/// Never fails the read: a sweep that cannot run leaves the list as the last
/// one wrote it.
pub async fn exceptions_refresh(pool: &PgPool) {
    let now = Utc::now().timestamp();
    if now - LAST_SWEEP.load(Ordering::Relaxed) < REFRESH_AFTER_SECONDS {
        return;
    }
    if let Err(error) = exceptions_sweep(pool, false).await {
        tracing::warn!(%error, "the exceptions list could not be refreshed before a read");
    }
}

/// The people told about one exception: its unit's PIC, when the settings
/// say so, and whoever holds one of `roles` at that unit or at head office.
/// Every active Admin when that is nobody, as the fleet alerts do.
async fn exception_recipients(
    tx: &mut Transaction<'_, Postgres>,
    roles: &[String],
    unit_id: &str,
    with_pic: bool,
) -> Result<Vec<String>, AppError> {
    let mut people: Vec<String> = sqlx::query_scalar(
        "SELECT DISTINCT u.username
           FROM app_user u
           LEFT JOIN job_role r ON r.code = u.role_code
           LEFT JOIN employee_assignment a
                  ON a.employee_id = u.employee_id AND a.valid_to IS NULL
           LEFT JOIN unit posted ON posted.id = a.unit_id
          WHERE u.active
            AND u.role_code = ANY($1)
            AND (a.unit_id = $2 OR posted.kind = 'HO' OR r.node_reach = 'EVERY')",
    )
    .bind(roles)
    .bind(unit_id)
    .fetch_all(&mut **tx)
    .await?;
    if with_pic {
        let pic: Vec<String> = sqlx::query_scalar(
            "SELECT u.username FROM unit_pic p
               JOIN app_user u ON u.employee_id = p.employee_id
              WHERE p.unit_id = $1 AND p.valid_to IS NULL AND u.active",
        )
        .bind(unit_id)
        .fetch_all(&mut **tx)
        .await?;
        people.extend(pic);
    }
    if people.is_empty() {
        people = sqlx::query_scalar("SELECT username FROM app_user WHERE active AND role = 'ADMIN'")
            .fetch_all(&mut **tx)
            .await?;
    }
    people.sort();
    people.dedup();
    Ok(people)
}

/// Tell each red exception nobody has been told about, once.
async fn exceptions_notify(pool: &PgPool, settings: &ExceptionSettings) -> Result<usize, AppError> {
    let rows = sqlx::query(
        "SELECT e.exception_id, e.kind, e.unit_id, u.code AS unit_code, e.title, e.sentence,
                e.owner_roles, e.first_severity, e.since, e.link_screen, e.link_params
           FROM store_exception e
           JOIN unit u ON u.id = e.unit_id
          WHERE e.resolved_at IS NULL AND e.severity = 'BAD' AND e.notified_at IS NULL
          ORDER BY e.since",
    )
    .fetch_all(pool)
    .await?;

    let mut told = 0;
    for row in rows {
        let exception_id: Uuid = row.try_get("exception_id")?;
        let kind: String = row.try_get("kind")?;
        let unit_id: String = row.try_get("unit_id")?;
        let unit_code: String = row.try_get("unit_code")?;
        let title: String = row.try_get("title")?;
        let sentence: String = row.try_get("sentence")?;
        let mut roles: Vec<String> = row.try_get("owner_roles")?;
        let first: String = row.try_get("first_severity")?;
        let since: DateTime<Utc> = row.try_get("since")?;
        let screen: String = row.try_get("link_screen")?;
        let params: Value = row.try_get("link_params")?;
        roles.extend(settings.also_notify_roles.iter().cloned());
        roles.sort();
        roles.dedup();

        let mut tx = pool.begin().await?;
        let recipients =
            exception_recipients(&mut tx, &roles, &unit_id, settings.notify_unit_pic).await?;
        if recipients.is_empty() {
            // Nobody to tell yet; the next sweep tries again.
            continue;
        }
        let escalated = first != Severity::Bad.code();
        let notification = raise_notification(
            &mut tx,
            NewNotification {
                kind: if escalated {
                    "store.exception.escalated"
                } else {
                    "store.exception.raised"
                },
                title: if escalated {
                    format!("Now red — {unit_code}: {title}")
                } else {
                    format!("{unit_code}: {title}")
                },
                body: sentence,
                subject: None,
                origin_id: None,
                payload: json!({
                    "store_exception_id": exception_id,
                    "kind": kind,
                    "unit_id": unit_id,
                    "since": since,
                    "escalated": escalated,
                    "link": { "screen": screen, "params": params },
                }),
            },
            &recipients,
        )
        .await?;
        let updated = sqlx::query(
            "UPDATE store_exception
                SET notified_at = now(), notification_id = $2, notified_to = $3
              WHERE exception_id = $1 AND notified_at IS NULL AND resolved_at IS NULL",
        )
        .bind(exception_id)
        .bind(notification)
        .bind(&recipients)
        .execute(&mut *tx)
        .await?;
        if updated.rows_affected() == 1 {
            tx.commit().await?;
            told += 1;
        }
    }
    Ok(told)
}

// ════════════════════════════════════════════════════════════════════════════
// Reading and acknowledging
// ════════════════════════════════════════════════════════════════════════════

/// Where the hub goes to fix it.
#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ExceptionLink {
    /// `store-money.shift`, `store-money.deposits`, `flows.document`,
    /// `inventory.missing` or `checkout-exceptions`.
    pub screen: String,
    /// What that screen opens on: `shift_id`, `unit_id`, `day`,
    /// `document_id`, `document_number`, `stage`, `site_id`, `checkout_id`.
    #[cfg_attr(feature = "ts", ts(type = "Record<string, string>"))]
    pub params: Value,
}

/// One exception on the list.
#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ExceptionItem {
    pub id: Uuid,
    /// `SHIFT_NOT_CLOSED`, `DEPOSIT_MISSING`, `RECEIVE_OVERDUE`,
    /// `MISSING_OPEN`, `CASH_DIFFERENCE` or `CHECKOUT_UNRESOLVED`.
    pub kind: String,
    pub unit_id: String,
    pub unit_code: String,
    pub unit_name: String,
    pub site_id: Option<String>,
    pub title: String,
    /// What the data says, in a sentence.
    pub sentence: String,
    /// When the thing began to be wrong.
    pub since: DateTime<Utc>,
    /// Seconds from `since` to now, or to when it was resolved.
    pub age_seconds: i64,
    /// `INFO`, `WARN` or `BAD`.
    pub severity: String,
    /// Job role codes that own the fix.
    pub owner_roles: Vec<String>,
    pub link: ExceptionLink,
    /// `OPEN`, `ACKNOWLEDGED` or `RESOLVED`.
    pub state: String,
    pub acknowledged_by: Option<String>,
    pub acknowledged_at: Option<DateTime<Utc>>,
    /// What the person who acknowledged it wrote.
    pub note: Option<String>,
    /// When a sweep first found it.
    pub first_seen_at: DateTime<Utc>,
    /// When a sweep found it fixed.
    pub resolved_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ExceptionKindCount {
    pub kind: String,
    pub count: i64,
    /// How many of them are red.
    pub bad: i64,
}

#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ExceptionUnitCount {
    pub unit_id: String,
    pub unit_code: String,
    pub unit_name: String,
    pub count: i64,
    pub bad: i64,
}

/// The counts behind the list: over the caller's reach and the state asked
/// for, never narrowed by `unit`, `kind` or `limit`, so the filters can show
/// what each would hold.
#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ExceptionSummary {
    /// Every kind the caller may see, in the vocabulary's order, zeros kept.
    pub by_kind: Vec<ExceptionKindCount>,
    /// Units with at least one, by code.
    pub by_unit: Vec<ExceptionUnitCount>,
    pub total: i64,
    pub bad: i64,
}

/// `GET /api/v1/exceptions` and `GET /api/v1/stores/{unit}/exceptions`.
#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ExceptionList {
    pub items: Vec<ExceptionItem>,
    pub summary: ExceptionSummary,
}

/// `POST /api/v1/exceptions/{id}/acknowledge`.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct AcknowledgeExceptionRequest {
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub note: Option<String>,
}

/// The query string of the list.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct ExceptionQuery {
    /// A unit's id or its code.
    #[serde(default)]
    pub unit: Option<String>,
    #[serde(default)]
    pub kind: Option<String>,
    /// `open` (default: not resolved), `unacknowledged`, `acknowledged`,
    /// `resolved` or `all`.
    #[serde(default)]
    pub state: Option<String>,
    #[serde(default)]
    pub limit: Option<i64>,
}

/// What a caller may see: which units, and which kinds.
#[derive(Debug, Clone)]
pub struct ExceptionScope {
    pub reach: StoreReach,
    pub kinds: Vec<ExceptionKind>,
}

impl ExceptionScope {
    fn sees(&self, kind: &str, unit_id: &str) -> bool {
        self.reach.covers(unit_id)
            && ExceptionKind::parse(kind).is_some_and(|kind| self.kinds.contains(&kind))
    }
}

const ITEM_COLUMNS: &str = "e.exception_id, e.kind, e.unit_id, u.code AS unit_code,
       u.name AS unit_name, e.site_id, e.title, e.sentence, e.since, e.severity,
       e.owner_roles, e.link_screen, e.link_params, e.acknowledged_at, e.acknowledged_by,
       e.acknowledged_note, e.first_seen_at, e.resolved_at";

fn item_from(row: &sqlx::postgres::PgRow, now: DateTime<Utc>) -> Result<ExceptionItem, AppError> {
    let since: DateTime<Utc> = row.try_get("since")?;
    let acknowledged_at: Option<DateTime<Utc>> = row.try_get("acknowledged_at")?;
    let resolved_at: Option<DateTime<Utc>> = row.try_get("resolved_at")?;
    let state = ExceptionState::of(acknowledged_at.is_some(), resolved_at.is_some());
    Ok(ExceptionItem {
        id: row.try_get("exception_id")?,
        kind: row.try_get("kind")?,
        unit_id: row.try_get("unit_id")?,
        unit_code: row.try_get("unit_code")?,
        unit_name: row.try_get("unit_name")?,
        site_id: row.try_get("site_id")?,
        title: row.try_get("title")?,
        sentence: row.try_get("sentence")?,
        since,
        age_seconds: seconds_between(since, resolved_at.unwrap_or(now)),
        severity: row.try_get("severity")?,
        owner_roles: row.try_get("owner_roles")?,
        link: ExceptionLink {
            screen: row.try_get("link_screen")?,
            params: row.try_get("link_params")?,
        },
        state: state.code().to_owned(),
        acknowledged_by: row.try_get("acknowledged_by")?,
        acknowledged_at,
        note: row.try_get("acknowledged_note")?,
        first_seen_at: row.try_get("first_seen_at")?,
        resolved_at,
    })
}

/// The unit a `{unit}` or `?unit=` names: its id, or its client code.
pub async fn exception_unit_id(pool: &PgPool, key: &str) -> Result<String, AppError> {
    let key = key.trim();
    sqlx::query_scalar::<_, String>(
        "SELECT id FROM unit WHERE id = $1 OR code = upper($1) ORDER BY (id = $1) DESC LIMIT 1",
    )
    .bind(key)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("there is no unit {key}")))
}

/// The list, within the caller's scope. Sweeps first when the last sweep is
/// more than a minute old.
pub async fn exceptions_list(
    pool: &PgPool,
    scope: &ExceptionScope,
    query: &ExceptionQuery,
) -> Result<ExceptionList, AppError> {
    let state = StateFilter::parse(query.state.as_deref()).map_err(AppError::Validation)?;
    let asked_kind = match query.kind.as_deref().map(str::trim).filter(|k| !k.is_empty()) {
        Some(code) => Some(ExceptionKind::parse(code).ok_or_else(|| {
            AppError::Validation(format!("'{code}' is not a kind of exception"))
        })?),
        None => None,
    };
    let asked_unit = match query.unit.as_deref().map(str::trim).filter(|u| !u.is_empty()) {
        Some(key) => Some(exception_unit_id(pool, key).await?),
        None => None,
    };
    if let Some(unit) = &asked_unit {
        if !scope.reach.covers(unit) {
            return Err(AppError::Forbidden(
                "you may read the exceptions of the store you are posted to only".into(),
            ));
        }
    }
    let reach_unit: Option<String> = match &scope.reach {
        StoreReach::Every => None,
        StoreReach::Unit(unit) => Some(unit.clone()),
        StoreReach::Nothing => {
            return Ok(ExceptionList {
                items: Vec::new(),
                summary: ExceptionSummary {
                    by_kind: Vec::new(),
                    by_unit: Vec::new(),
                    total: 0,
                    bad: 0,
                },
            })
        }
    };

    exceptions_refresh(pool).await;

    let visible: Vec<&str> = scope.kinds.iter().map(|kind| kind.code()).collect();
    let listed: Vec<&str> = match asked_kind {
        Some(kind) if scope.kinds.contains(&kind) => vec![kind.code()],
        Some(_) => Vec::new(),
        None => visible.clone(),
    };
    let state_clause = match state {
        StateFilter::Open => "e.resolved_at IS NULL",
        StateFilter::Unacknowledged => "e.resolved_at IS NULL AND e.acknowledged_at IS NULL",
        StateFilter::Acknowledged => "e.resolved_at IS NULL AND e.acknowledged_at IS NOT NULL",
        StateFilter::Resolved => "e.resolved_at IS NOT NULL",
        StateFilter::All => "TRUE",
    };
    let order = match state {
        StateFilter::Resolved => "e.resolved_at DESC, e.exception_id",
        _ => {
            "e.resolved_at IS NOT NULL, \
             CASE e.severity WHEN 'BAD' THEN 0 WHEN 'WARN' THEN 1 ELSE 2 END, \
             e.since, e.exception_id"
        }
    };
    let limit = query.limit.unwrap_or(200).clamp(1, 500);
    let unit_filter = asked_unit.or_else(|| reach_unit.clone());

    let rows = sqlx::query(&format!(
        "SELECT {ITEM_COLUMNS}
           FROM store_exception e
           JOIN unit u ON u.id = e.unit_id
          WHERE e.kind = ANY($1)
            AND ($2::text IS NULL OR e.unit_id = $2)
            AND {state_clause}
          ORDER BY {order}
          LIMIT $3"
    ))
    .bind(&listed)
    .bind(&unit_filter)
    .bind(limit)
    .fetch_all(pool)
    .await?;
    let now = Utc::now();
    let items = rows
        .iter()
        .map(|row| item_from(row, now))
        .collect::<Result<Vec<_>, _>>()?;

    let counts = sqlx::query(&format!(
        "SELECT e.kind, e.unit_id, u.code AS unit_code, u.name AS unit_name,
                COUNT(*)::bigint AS n,
                (COUNT(*) FILTER (WHERE e.severity = 'BAD'))::bigint AS bad
           FROM store_exception e
           JOIN unit u ON u.id = e.unit_id
          WHERE e.kind = ANY($1)
            AND ($2::text IS NULL OR e.unit_id = $2)
            AND {state_clause}
          GROUP BY e.kind, e.unit_id, u.code, u.name"
    ))
    .bind(&visible)
    .bind(&reach_unit)
    .fetch_all(pool)
    .await?;

    let mut by_unit: BTreeMap<String, ExceptionUnitCount> = BTreeMap::new();
    let (mut total, mut bad) = (0_i64, 0_i64);
    let mut kind_totals: HashMap<String, (i64, i64)> = HashMap::new();
    for row in &counts {
        let kind: String = row.try_get("kind")?;
        let unit_id: String = row.try_get("unit_id")?;
        let unit_code: String = row.try_get("unit_code")?;
        let unit_name: String = row.try_get("unit_name")?;
        let n: i64 = row.try_get("n")?;
        let red: i64 = row.try_get("bad")?;
        total += n;
        bad += red;
        let entry = kind_totals.entry(kind).or_insert((0, 0));
        entry.0 += n;
        entry.1 += red;
        let unit = by_unit.entry(unit_code.clone()).or_insert(ExceptionUnitCount {
            unit_id,
            unit_code,
            unit_name,
            count: 0,
            bad: 0,
        });
        unit.count += n;
        unit.bad += red;
    }
    let by_kind = scope
        .kinds
        .iter()
        .map(|kind| {
            let (count, bad) = kind_totals.get(kind.code()).copied().unwrap_or((0, 0));
            ExceptionKindCount {
                kind: kind.code().to_owned(),
                count,
                bad,
            }
        })
        .collect();

    Ok(ExceptionList {
        items,
        summary: ExceptionSummary {
            by_kind,
            by_unit: by_unit.into_values().collect(),
            total,
            bad,
        },
    })
}

/// Somebody has it. Stops nothing and closes nothing — only the data being
/// fixed closes an exception — but it is kept through every sweep and shown
/// on the list. Acknowledging twice keeps the first person's name; a note is
/// kept once written.
pub async fn exception_acknowledge(
    pool: &PgPool,
    scope: &ExceptionScope,
    exception_id: Uuid,
    actor: &str,
    note: Option<&str>,
) -> Result<ExceptionItem, AppError> {
    let note = note.map(str::trim).filter(|note| !note.is_empty());
    if note.is_some_and(|note| note.chars().count() > 500) {
        return Err(AppError::Validation("a note is at most 500 characters".into()));
    }
    let found = sqlx::query("SELECT kind, unit_id, resolved_at FROM store_exception WHERE exception_id = $1")
        .bind(exception_id)
        .fetch_optional(pool)
        .await?;
    let Some(found) = found else {
        return Err(AppError::NotFound(format!("exception {exception_id}")));
    };
    let kind: String = found.try_get("kind")?;
    let unit_id: String = found.try_get("unit_id")?;
    let resolved_at: Option<DateTime<Utc>> = found.try_get("resolved_at")?;
    if !scope.sees(&kind, &unit_id) {
        // Not "forbidden": an exception outside one's reach is not one's to
        // know about.
        return Err(AppError::NotFound(format!("exception {exception_id}")));
    }
    if resolved_at.is_some() {
        return Err(AppError::Conflict(
            "this exception was resolved when its data was fixed; there is nothing to acknowledge"
                .into(),
        ));
    }
    sqlx::query(
        "UPDATE store_exception
            SET acknowledged_at = COALESCE(acknowledged_at, now()),
                acknowledged_by = COALESCE(acknowledged_by, $2),
                acknowledged_note = COALESCE(acknowledged_note, $3)
          WHERE exception_id = $1",
    )
    .bind(exception_id)
    .bind(actor)
    .bind(note)
    .execute(pool)
    .await?;
    let row = sqlx::query(&format!(
        "SELECT {ITEM_COLUMNS}
           FROM store_exception e
           JOIN unit u ON u.id = e.unit_id
          WHERE e.exception_id = $1"
    ))
    .bind(exception_id)
    .fetch_one(pool)
    .await?;
    item_from(&row, Utc::now())
}
