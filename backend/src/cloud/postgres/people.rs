//! People's next generation, as rows.
//!
//! One adapter for the six small state machines of `domain::people`. None of
//! them is big enough to earn its own file, and splitting them across eight
//! files would make the one thing they share — a filed row becoming a decided
//! row — read as eight unrelated idioms instead of one.
//!
//! Every state flip is a **conditional UPDATE** (`WHERE state = 'PENDING'`),
//! so two racers cannot both decide: the loser's update matches no rows and
//! comes back as a conflict, which is the database saying what the domain
//! already said.

use super::AppError;
use crate::cloud::domain::people::*;
use crate::cloud::domain::{EmployeeId, UnitId};
use chrono::{DateTime, NaiveDate, Utc};
use sqlx::{PgPool, Postgres, Row, Transaction};

fn corrupt(what: &str, error: impl std::fmt::Display) -> AppError {
    AppError::Configuration(format!("{what}: {error}"))
}

// ── roster swaps ─────────────────────────────────────────────────────────

fn decode_swap(row: &sqlx::postgres::PgRow) -> Result<RosterSwap, AppError> {
    let state: String = row.try_get("state")?;
    Ok(RosterSwap {
        id: row.try_get("id")?,
        employee_id: EmployeeId::try_new(row.try_get::<String, _>("employee_id")?.as_str())
            .map_err(|e| corrupt("swap employee", e))?,
        with_employee_id: EmployeeId::try_new(
            row.try_get::<String, _>("with_employee_id")?.as_str(),
        )
        .map_err(|e| corrupt("swap colleague", e))?,
        unit_id: UnitId::try_new(row.try_get::<String, _>("unit_id")?.as_str())
            .map_err(|e| corrupt("swap unit", e))?,
        on_date: row.try_get("on_date")?,
        reason: row.try_get("reason")?,
        state: serde_json::from_value::<SwapState>(serde_json::Value::String(state.clone()))
            .map_err(|e| corrupt("swap state {state}", e))?,
        requested: serde_json::from_value(row.try_get("requested")?)
            .map_err(|e| corrupt("swap request", e))?,
        decision: row
            .try_get::<Option<serde_json::Value>, _>("decision")?
            .map(|v| serde_json::from_value(v).map_err(|e| corrupt("swap decision", e)))
            .transpose()?,
    })
}

pub async fn insert_swap(pool: &PgPool, swap: &RosterSwap) -> Result<(), AppError> {
    let inserted = sqlx::query(
        "INSERT INTO roster_swap_request
            (id, employee_id, with_employee_id, unit_id, on_date, reason, state, requested)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (employee_id, on_date) WHERE state = 'PENDING' DO NOTHING",
    )
    .bind(&swap.id)
    .bind(swap.employee_id.as_str())
    .bind(swap.with_employee_id.as_str())
    .bind(swap.unit_id.as_str())
    .bind(swap.on_date)
    .bind(&swap.reason)
    .bind(swap.state.as_str())
    .bind(serde_json::to_value(&swap.requested)?)
    .execute(pool)
    .await?
    .rows_affected();
    if inserted == 0 {
        return Err(AppError::Conflict(
            "this person already has a swap waiting on that day".to_owned(),
        ));
    }
    Ok(())
}

pub async fn load_swap(pool: &PgPool, id: &str) -> Result<Option<RosterSwap>, AppError> {
    let row = sqlx::query(
        "SELECT id, employee_id, with_employee_id, unit_id, on_date, reason, state,
                requested, decision
           FROM roster_swap_request WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?;
    row.map(|r| decode_swap(&r)).transpose()
}

/// The store head's queue: pending swaps at one place, or everywhere for
/// head office. `None` means no place bound.
pub async fn pending_swaps(pool: &PgPool, unit: Option<&str>) -> Result<Vec<RosterSwap>, AppError> {
    let rows = sqlx::query(
        "SELECT id, employee_id, with_employee_id, unit_id, on_date, reason, state,
                requested, decision
           FROM roster_swap_request
          WHERE state = 'PENDING' AND ($1::text IS NULL OR unit_id = $1)
          ORDER BY on_date, created_at",
    )
    .bind(unit)
    .fetch_all(pool)
    .await?;
    rows.iter().map(decode_swap).collect()
}

pub async fn swaps_of_employee(
    pool: &PgPool,
    employee_id: &str,
) -> Result<Vec<RosterSwap>, AppError> {
    let rows = sqlx::query(
        "SELECT id, employee_id, with_employee_id, unit_id, on_date, reason, state,
                requested, decision
           FROM roster_swap_request
          WHERE employee_id = $1 OR with_employee_id = $1
          ORDER BY created_at DESC",
    )
    .bind(employee_id)
    .fetch_all(pool)
    .await?;
    rows.iter().map(decode_swap).collect()
}

/// Flip the state, and only from PENDING. Zero rows updated means somebody
/// decided first.
pub async fn update_swap(pool: &PgPool, swap: &RosterSwap) -> Result<(), AppError> {
    let updated = sqlx::query(
        "UPDATE roster_swap_request
            SET state = $2, decision = $3, updated_at = now()
          WHERE id = $1 AND state = 'PENDING'",
    )
    .bind(&swap.id)
    .bind(swap.state.as_str())
    .bind(
        swap.decision
            .as_ref()
            .map(serde_json::to_value)
            .transpose()?,
    )
    .execute(pool)
    .await?
    .rows_affected();
    if updated == 0 {
        return Err(AppError::Conflict(format!(
            "swap {} is no longer pending",
            swap.id
        )));
    }
    Ok(())
}

// ── employment change proposals ──────────────────────────────────────────

fn decode_change(row: &sqlx::postgres::PgRow) -> Result<ChangeProposal, AppError> {
    let kind: String = row.try_get("kind")?;
    let state: String = row.try_get("state")?;
    Ok(ChangeProposal {
        id: row.try_get("id")?,
        employee_id: EmployeeId::try_new(row.try_get::<String, _>("employee_id")?.as_str())
            .map_err(|e| corrupt("change employee", e))?,
        unit_id: UnitId::try_new(row.try_get::<String, _>("unit_id")?.as_str())
            .map_err(|e| corrupt("change unit", e))?,
        kind: ChangeKind::parse(&kind).ok_or_else(|| corrupt("change kind", kind.clone()))?,
        props: serde_json::from_value(row.try_get("props")?)
            .map_err(|e| corrupt("change props", e))?,
        effective_on: row.try_get("effective_on")?,
        reason: row.try_get("reason")?,
        state: serde_json::from_value::<ChangeState>(serde_json::Value::String(state.clone()))
            .map_err(|e| corrupt("change state {state}", e))?,
        filed: serde_json::from_value(row.try_get("filed")?)
            .map_err(|e| corrupt("change filing", e))?,
        decision: row
            .try_get::<Option<serde_json::Value>, _>("decision")?
            .map(|v| serde_json::from_value(v).map_err(|e| corrupt("change decision", e)))
            .transpose()?,
        applied_at: row.try_get("applied_at")?,
    })
}

pub async fn insert_change(pool: &PgPool, proposal: &ChangeProposal) -> Result<(), AppError> {
    let inserted = sqlx::query(
        "INSERT INTO employee_change_proposal
            (id, employee_id, unit_id, kind, props, effective_on, reason, state, filed)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (employee_id) WHERE state = 'PENDING' DO NOTHING",
    )
    .bind(&proposal.id)
    .bind(proposal.employee_id.as_str())
    .bind(proposal.unit_id.as_str())
    .bind(proposal.kind.as_str())
    .bind(serde_json::to_value(&proposal.props)?)
    .bind(proposal.effective_on)
    .bind(&proposal.reason)
    .bind(proposal.state.as_str())
    .bind(serde_json::to_value(&proposal.filed)?)
    .execute(pool)
    .await?
    .rows_affected();
    if inserted == 0 {
        return Err(AppError::Conflict(
            "this person already has a change proposal waiting on head office".to_owned(),
        ));
    }
    Ok(())
}

pub async fn load_change(pool: &PgPool, id: &str) -> Result<Option<ChangeProposal>, AppError> {
    let row = sqlx::query(
        "SELECT id, employee_id, unit_id, kind, props, effective_on, reason, state,
                filed, decision, applied_at
           FROM employee_change_proposal WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?;
    row.map(|r| decode_change(&r)).transpose()
}

/// All proposals, or one status's slice — the HO queue is `PENDING`, the
/// history tab is the rest.
pub async fn list_changes(
    pool: &PgPool,
    state: Option<&str>,
    unit: Option<&str>,
) -> Result<Vec<ChangeProposal>, AppError> {
    let rows = sqlx::query(
        "SELECT id, employee_id, unit_id, kind, props, effective_on, reason, state,
                filed, decision, applied_at
           FROM employee_change_proposal
          WHERE ($1::text IS NULL OR state = $1)
            AND ($2::text IS NULL OR unit_id = $2)
          ORDER BY created_at DESC",
    )
    .bind(state)
    .bind(unit)
    .fetch_all(pool)
    .await?;
    rows.iter().map(decode_change).collect()
}

pub async fn changes_of_employee(
    pool: &PgPool,
    employee_id: &str,
) -> Result<Vec<ChangeProposal>, AppError> {
    let rows = sqlx::query(
        "SELECT id, employee_id, unit_id, kind, props, effective_on, reason, state,
                filed, decision, applied_at
           FROM employee_change_proposal
          WHERE employee_id = $1
          ORDER BY created_at DESC",
    )
    .bind(employee_id)
    .fetch_all(pool)
    .await?;
    rows.iter().map(decode_change).collect()
}

pub async fn update_change(pool: &PgPool, proposal: &ChangeProposal) -> Result<(), AppError> {
    let updated = sqlx::query(
        "UPDATE employee_change_proposal
            SET state = $2, decision = $3, applied_at = $4, updated_at = now()
          WHERE id = $1 AND state = 'PENDING'",
    )
    .bind(&proposal.id)
    .bind(proposal.state.as_str())
    .bind(
        proposal
            .decision
            .as_ref()
            .map(serde_json::to_value)
            .transpose()?,
    )
    .bind(proposal.applied_at)
    .execute(pool)
    .await?
    .rows_affected();
    if updated == 0 {
        return Err(AppError::Conflict(format!(
            "proposal {} is no longer pending",
            proposal.id
        )));
    }
    Ok(())
}

// ── the onboarding and separation checklist ──────────────────────────────

pub async fn list_templates(
    pool: &PgPool,
    kind: Option<&str>,
) -> Result<Vec<TaskTemplateRow>, AppError> {
    let rows = sqlx::query_as::<_, TaskTemplateRow>(
        "SELECT id, label, owner, kind, position
           FROM lifecycle_task_template
          WHERE ($1::text IS NULL OR kind = $1)
          ORDER BY kind, position",
    )
    .bind(kind)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// One template row, as the checklist screens read it.
#[derive(Debug, sqlx::FromRow)]
pub struct TaskTemplateRow {
    pub id: String,
    pub label: String,
    pub owner: String,
    pub kind: String,
    pub position: i32,
}

pub async fn create_task_set(
    pool: &PgPool,
    employee_id: &str,
    kind: LifecycleKind,
) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO lifecycle_task (id, employee_id, kind, template_id, state)
         SELECT 'tsk_' || replace(gen_random_uuid()::text, '-', ''), $1, $2, t.id, 'PENDING'
           FROM lifecycle_task_template t
          WHERE t.kind = $2 AND t.retired_at IS NULL
         ON CONFLICT (employee_id, template_id) DO NOTHING",
    )
    .bind(employee_id)
    .bind(kind.as_str())
    .execute(pool)
    .await?;
    Ok(())
}

/// Create the set in a caller's transaction, so a hire and its checklist
/// commit together.
pub async fn create_task_set_tx(
    tx: &mut Transaction<'_, Postgres>,
    employee_id: &str,
    kind: LifecycleKind,
) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO lifecycle_task (id, employee_id, kind, template_id, state)
         SELECT 'tsk_' || replace(gen_random_uuid()::text, '-', ''), $1, $2, t.id, 'PENDING'
           FROM lifecycle_task_template t
          WHERE t.kind = $2 AND t.retired_at IS NULL
         ON CONFLICT (employee_id, template_id) DO NOTHING",
    )
    .bind(employee_id)
    .bind(kind.as_str())
    .execute(&mut **tx)
    .await?;
    Ok(())
}

#[derive(Debug, sqlx::FromRow)]
pub struct LifecycleTaskRow {
    pub id: String,
    pub employee_id: String,
    pub kind: String,
    pub template_id: String,
    pub label: String,
    pub owner: String,
    pub position: i32,
    pub state: String,
    pub done: Option<serde_json::Value>,
}

/// The checklist as the screens read it: tasks joined to their templates so
/// an owner's queue is a WHERE on the join.
pub async fn list_tasks(
    pool: &PgPool,
    employee: Option<&str>,
    kind: Option<&str>,
    owner: Option<&str>,
    unit: Option<&str>,
) -> Result<Vec<LifecycleTaskRow>, AppError> {
    let rows = sqlx::query_as::<_, LifecycleTaskRow>(
        "SELECT t.id, t.employee_id, t.kind, t.template_id, tpl.label, tpl.owner,
                tpl.position, t.state, t.done
           FROM lifecycle_task t
           JOIN lifecycle_task_template tpl ON tpl.id = t.template_id
          WHERE ($1::text IS NULL OR t.employee_id = $1)
            AND ($2::text IS NULL OR t.kind = $2)
            AND ($3::text IS NULL OR tpl.owner = $3)
            AND ($4::text IS NULL OR EXISTS (
                 SELECT 1 FROM employee_assignment a
                  WHERE a.employee_id = t.employee_id
                    AND a.unit_id = $4))
          ORDER BY t.employee_id, t.kind, tpl.position",
    )
    .bind(employee)
    .bind(kind)
    .bind(owner)
    .bind(unit)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// Close one task. The conditional UPDATE is the two-racers rule.
pub async fn complete_task(
    pool: &PgPool,
    task_id: &str,
    done: serde_json::Value,
) -> Result<u64, AppError> {
    let updated = sqlx::query(
        "UPDATE lifecycle_task
            SET state = 'DONE', done = $2, updated_at = now()
          WHERE id = $1 AND state = 'PENDING'",
    )
    .bind(task_id)
    .bind(&done)
    .execute(pool)
    .await?
    .rows_affected();
    Ok(updated)
}

// ── the recruitment pipeline ─────────────────────────────────────────────

pub async fn upsert_plan(pool: &PgPool, plan: &StaffingPlan) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO staffing_plan
            (id, unit_id, position, span, headcount, cost_minor, defined)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (unit_id, position, span)
         DO UPDATE SET headcount = EXCLUDED.headcount,
                       cost_minor = EXCLUDED.cost_minor,
                       defined = EXCLUDED.defined,
                       updated_at = now()",
    )
    .bind(&plan.id)
    .bind(plan.unit_id.as_str())
    .bind(&plan.position)
    .bind(&plan.span)
    .bind(plan.headcount as i32)
    .bind(plan.cost_minor)
    .bind(serde_json::to_value(&plan.defined)?)
    .execute(pool)
    .await?;
    Ok(())
}

#[derive(Debug, sqlx::FromRow)]
pub struct StaffingPlanRow {
    pub id: String,
    pub unit_id: String,
    pub position: String,
    pub span: String,
    pub headcount: i32,
    pub cost_minor: i64,
    pub defined: serde_json::Value,
}

pub async fn list_plans(
    pool: &PgPool,
    unit: Option<&str>,
    span: Option<&str>,
) -> Result<Vec<StaffingPlanRow>, AppError> {
    let rows = sqlx::query_as::<_, StaffingPlanRow>(
        "SELECT id, unit_id, position, span, headcount, cost_minor, defined
           FROM staffing_plan
          WHERE ($1::text IS NULL OR unit_id = $1)
            AND ($2::text IS NULL OR span = $2)
          ORDER BY unit_id, position",
    )
    .bind(unit)
    .bind(span)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

fn decode_applicant(row: &sqlx::postgres::PgRow) -> Result<JobApplicant, AppError> {
    let stage: String = row.try_get("stage")?;
    Ok(JobApplicant {
        id: row.try_get("id")?,
        proposal_id: row.try_get("proposal_id")?,
        unit_id: UnitId::try_new(row.try_get::<String, _>("unit_id")?.as_str())
            .map_err(|e| corrupt("applicant unit", e))?,
        name: row.try_get("name")?,
        phone: row.try_get("phone")?,
        source: row.try_get("source")?,
        referrer_employee_id: row
            .try_get::<Option<String>, _>("referrer_employee_id")?
            .map(|s| EmployeeId::try_new(&s).map_err(|e| corrupt("applicant referrer", e)))
            .transpose()?,
        stage: ApplicantStage::parse(&stage)
            .ok_or_else(|| corrupt("applicant stage", stage.clone()))?,
        stage_note: row.try_get("stage_note")?,
        applied_on: row.try_get("applied_on")?,
    })
}

pub async fn insert_applicant(pool: &PgPool, applicant: &JobApplicant) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO job_applicant
            (id, proposal_id, unit_id, name, phone, source, referrer_employee_id,
             stage, stage_note, applied_on)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
    )
    .bind(&applicant.id)
    .bind(&applicant.proposal_id)
    .bind(applicant.unit_id.as_str())
    .bind(&applicant.name)
    .bind(&applicant.phone)
    .bind(&applicant.source)
    .bind(applicant.referrer_employee_id.as_ref().map(|e| e.as_str()))
    .bind(applicant.stage.as_str())
    .bind(&applicant.stage_note)
    .bind(applicant.applied_on)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn load_applicant(pool: &PgPool, id: &str) -> Result<Option<JobApplicant>, AppError> {
    let row = sqlx::query(
        "SELECT id, proposal_id, unit_id, name, phone, source, referrer_employee_id,
                stage, stage_note, applied_on
           FROM job_applicant WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?;
    row.map(|r| decode_applicant(&r)).transpose()
}

pub async fn list_applicants(
    pool: &PgPool,
    proposal: Option<&str>,
    stage: Option<&str>,
) -> Result<Vec<JobApplicant>, AppError> {
    let rows = sqlx::query(
        "SELECT id, proposal_id, unit_id, name, phone, source, referrer_employee_id,
                stage, stage_note, applied_on
           FROM job_applicant
          WHERE ($1::text IS NULL OR proposal_id = $1)
            AND ($2::text IS NULL OR stage = $2)
          ORDER BY applied_on DESC, name",
    )
    .bind(proposal)
    .bind(stage)
    .fetch_all(pool)
    .await?;
    rows.iter().map(decode_applicant).collect()
}

/// Move the stage, and only from the stage the caller read.
pub async fn update_applicant(pool: &PgPool, applicant: &JobApplicant) -> Result<(), AppError> {
    let updated = sqlx::query(
        "UPDATE job_applicant
            SET stage = $2, stage_note = $3, updated_at = now()
          WHERE id = $1",
    )
    .bind(&applicant.id)
    .bind(applicant.stage.as_str())
    .bind(&applicant.stage_note)
    .execute(pool)
    .await?
    .rows_affected();
    if updated == 0 {
        return Err(AppError::NotFound(format!("applicant {}", applicant.id)));
    }
    Ok(())
}

pub async fn insert_interview(
    pool: &PgPool,
    interview: &ApplicantInterview,
) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO applicant_interview
            (id, applicant_id, scheduled_at, interviewer_employee_id, result,
             ratings, note, recorded)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
    )
    .bind(&interview.id)
    .bind(&interview.applicant_id)
    .bind(interview.scheduled_at)
    .bind(interview.interviewer_employee_id.as_str())
    .bind(match interview.result {
        InterviewResult::Scheduled => "SCHEDULED",
        InterviewResult::Pass => "PASS",
        InterviewResult::Fail => "FAIL",
    })
    .bind(serde_json::to_value(&interview.ratings)?)
    .bind(&interview.note)
    .bind(serde_json::to_value(&interview.recorded)?)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn load_applicant_interview(
    pool: &PgPool,
    id: &str,
) -> Result<Option<ApplicantInterview>, AppError> {
    let row = sqlx::query(
        "SELECT id, applicant_id, scheduled_at, interviewer_employee_id, result,
                ratings, note, recorded
           FROM applicant_interview WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?;
    row.map(decode_interview).transpose()
}

fn decode_interview(row: sqlx::postgres::PgRow) -> Result<ApplicantInterview, AppError> {
    let result: String = row.try_get("result")?;
    Ok(ApplicantInterview {
        id: row.try_get("id")?,
        applicant_id: row.try_get("applicant_id")?,
        scheduled_at: row.try_get("scheduled_at")?,
        interviewer_employee_id: EmployeeId::try_new(
            row.try_get::<String, _>("interviewer_employee_id")?
                .as_str(),
        )
        .map_err(|e| corrupt("interview interviewer", e))?,
        result: match result.as_str() {
            "SCHEDULED" => InterviewResult::Scheduled,
            "PASS" => InterviewResult::Pass,
            "FAIL" => InterviewResult::Fail,
            other => return Err(corrupt("interview result", other)),
        },
        ratings: serde_json::from_value(row.try_get("ratings")?)
            .map_err(|e| corrupt("interview ratings", e))?,
        note: row.try_get("note")?,
        recorded: serde_json::from_value(row.try_get("recorded")?)
            .map_err(|e| corrupt("interview recorder", e))?,
    })
}

pub async fn list_interviews(
    pool: &PgPool,
    applicant: &str,
) -> Result<Vec<ApplicantInterview>, AppError> {
    let rows = sqlx::query(
        "SELECT id, applicant_id, scheduled_at, interviewer_employee_id, result,
                ratings, note, recorded
           FROM applicant_interview
          WHERE applicant_id = $1
          ORDER BY scheduled_at",
    )
    .bind(applicant)
    .fetch_all(pool)
    .await?;
    rows.into_iter().map(decode_interview).collect()
}

pub async fn update_interview(
    pool: &PgPool,
    interview: &ApplicantInterview,
) -> Result<(), AppError> {
    let updated = sqlx::query(
        "UPDATE applicant_interview
            SET result = $2, ratings = $3, note = $4
          WHERE id = $1 AND result = 'SCHEDULED'",
    )
    .bind(&interview.id)
    .bind(match interview.result {
        InterviewResult::Scheduled => "SCHEDULED",
        InterviewResult::Pass => "PASS",
        InterviewResult::Fail => "FAIL",
    })
    .bind(serde_json::to_value(&interview.ratings)?)
    .bind(&interview.note)
    .execute(pool)
    .await?
    .rows_affected();
    if updated == 0 {
        return Err(AppError::Conflict(format!(
            "interview {} already has a result",
            interview.id
        )));
    }
    Ok(())
}

fn decode_offer(row: sqlx::postgres::PgRow) -> Result<JobOffer, AppError> {
    let state: String = row.try_get("state")?;
    Ok(JobOffer {
        id: row.try_get("id")?,
        applicant_id: row.try_get("applicant_id")?,
        base_minor: row.try_get("base_minor")?,
        grade: row.try_get("grade")?,
        starts_on: row.try_get("starts_on")?,
        term: row.try_get("term")?,
        state: match state.as_str() {
            "WAITING" => OfferState::Waiting,
            "ACCEPTED" => OfferState::Accepted,
            "DECLINED" => OfferState::Declined,
            "WITHDRAWN" => OfferState::Withdrawn,
            other => return Err(corrupt("offer state", other)),
        },
        offered: serde_json::from_value(row.try_get("offered")?)
            .map_err(|e| corrupt("offer maker", e))?,
        decided: row
            .try_get::<Option<serde_json::Value>, _>("decided")?
            .map(|v| serde_json::from_value(v).map_err(|e| corrupt("offer decision", e)))
            .transpose()?,
        hired_employee_id: row
            .try_get::<Option<String>, _>("hired_employee_id")?
            .map(|s| EmployeeId::try_new(&s).map_err(|e| corrupt("offer hire", e)))
            .transpose()?,
    })
}

const OFFER_COLUMNS: &str = "id, applicant_id, base_minor, grade, starts_on, term, state,
         offered, decided, hired_employee_id";

pub async fn insert_offer(pool: &PgPool, offer: &JobOffer) -> Result<(), AppError> {
    sqlx::query(&format!(
        "INSERT INTO job_offer
            ({OFFER_COLUMNS})
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)"
    ))
    .bind(&offer.id)
    .bind(&offer.applicant_id)
    .bind(offer.base_minor)
    .bind(&offer.grade)
    .bind(offer.starts_on)
    .bind(&offer.term)
    .bind(match offer.state {
        OfferState::Waiting => "WAITING",
        OfferState::Accepted => "ACCEPTED",
        OfferState::Declined => "DECLINED",
        OfferState::Withdrawn => "WITHDRAWN",
    })
    .bind(serde_json::to_value(&offer.offered)?)
    .bind(
        offer
            .decided
            .as_ref()
            .map(serde_json::to_value)
            .transpose()?,
    )
    .bind(offer.hired_employee_id.as_ref().map(|e| e.as_str()))
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn load_offer(pool: &PgPool, id: &str) -> Result<Option<JobOffer>, AppError> {
    let row = sqlx::query(&format!(
        "SELECT {OFFER_COLUMNS} FROM job_offer WHERE id = $1"
    ))
    .bind(id)
    .fetch_optional(pool)
    .await?;
    row.map(decode_offer).transpose()
}

pub async fn offer_for_applicant(
    pool: &PgPool,
    applicant_id: &str,
) -> Result<Option<JobOffer>, AppError> {
    let row = sqlx::query(&format!(
        "SELECT {OFFER_COLUMNS} FROM job_offer WHERE applicant_id = $1"
    ))
    .bind(applicant_id)
    .fetch_optional(pool)
    .await?;
    row.map(decode_offer).transpose()
}

pub async fn list_offers(pool: &PgPool) -> Result<Vec<JobOffer>, AppError> {
    let rows = sqlx::query(&format!(
        "SELECT {OFFER_COLUMNS} FROM job_offer ORDER BY created_at DESC"
    ))
    .fetch_all(pool)
    .await?;
    rows.into_iter().map(decode_offer).collect()
}

pub async fn update_offer(pool: &PgPool, offer: &JobOffer) -> Result<(), AppError> {
    let updated = sqlx::query(
        "UPDATE job_offer
            SET state = $2, decided = $3, hired_employee_id = $4, updated_at = now()
          WHERE id = $1",
    )
    .bind(&offer.id)
    .bind(match offer.state {
        OfferState::Waiting => "WAITING",
        OfferState::Accepted => "ACCEPTED",
        OfferState::Declined => "DECLINED",
        OfferState::Withdrawn => "WITHDRAWN",
    })
    .bind(
        offer
            .decided
            .as_ref()
            .map(serde_json::to_value)
            .transpose()?,
    )
    .bind(offer.hired_employee_id.as_ref().map(|e| e.as_str()))
    .execute(pool)
    .await?
    .rows_affected();
    if updated == 0 {
        return Err(AppError::NotFound(format!("offer {}", offer.id)));
    }
    Ok(())
}

// ── performance ──────────────────────────────────────────────────────────

#[derive(Debug, sqlx::FromRow)]
pub struct PerformanceTemplateRow {
    pub position: String,
    pub metric: String,
    pub weight: i32,
    pub source: String,
}

pub async fn list_performance_templates(
    pool: &PgPool,
    position: Option<&str>,
) -> Result<Vec<PerformanceTemplateRow>, AppError> {
    let rows = sqlx::query_as::<_, PerformanceTemplateRow>(
        "SELECT position, metric, weight, source
           FROM performance_template
          WHERE ($1::text IS NULL OR position = $1)
          ORDER BY position, weight DESC",
    )
    .bind(position)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

pub async fn upsert_score(pool: &PgPool, score: &PerformanceScore) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO performance_score
            (employee_id, period, kpi_pct, manager_score, note, recorded)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (employee_id, period)
         DO UPDATE SET kpi_pct = EXCLUDED.kpi_pct,
                       manager_score = EXCLUDED.manager_score,
                       note = EXCLUDED.note,
                       recorded = EXCLUDED.recorded,
                       updated_at = now()",
    )
    .bind(score.employee_id.as_str())
    .bind(score.period)
    .bind(score.kpi_pct)
    .bind(score.manager_score as i32)
    .bind(&score.note)
    .bind(serde_json::to_value(&score.recorded)?)
    .execute(pool)
    .await?;
    Ok(())
}

#[derive(Debug, sqlx::FromRow)]
pub struct PerformanceScoreRow {
    pub employee_id: String,
    pub period: NaiveDate,
    pub kpi_pct: f64,
    pub manager_score: i32,
    pub note: Option<String>,
    pub recorded: serde_json::Value,
}

pub async fn list_scores(
    pool: &PgPool,
    employee: Option<&str>,
    period: Option<NaiveDate>,
    unit: Option<&str>,
) -> Result<Vec<PerformanceScoreRow>, AppError> {
    let rows = sqlx::query_as::<_, PerformanceScoreRow>(
        "SELECT s.employee_id, s.period, s.kpi_pct, s.manager_score, s.note, s.recorded
           FROM performance_score s
          WHERE ($1::text IS NULL OR s.employee_id = $1)
            AND ($2::date IS NULL OR s.period = $2)
            AND ($3::text IS NULL OR EXISTS (
                 SELECT 1 FROM employee_assignment a
                  WHERE a.employee_id = s.employee_id
                    AND a.unit_id = $3
                    AND (a.valid_to IS NULL OR a.valid_to >= s.period)))
          ORDER BY s.period DESC, s.employee_id",
    )
    .bind(employee)
    .bind(period)
    .bind(unit)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

// ── training ─────────────────────────────────────────────────────────────

pub async fn insert_program(pool: &PgPool, program: &TrainingProgram) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO training_program
            (id, title, on_date, place, cost_minor, state, defined)
         VALUES ($1, $2, $3, $4, $5, $6, $7)",
    )
    .bind(&program.id)
    .bind(&program.title)
    .bind(program.on_date)
    .bind(&program.place)
    .bind(program.cost_minor)
    .bind(match program.state {
        TrainingState::Scheduled => "SCHEDULED",
        TrainingState::Done => "DONE",
    })
    .bind(serde_json::to_value(&program.defined)?)
    .execute(pool)
    .await?;
    Ok(())
}

#[derive(Debug, sqlx::FromRow)]
pub struct TrainingProgramRow {
    pub id: String,
    pub title: String,
    pub on_date: NaiveDate,
    pub place: String,
    pub cost_minor: i64,
    pub state: String,
    pub defined: serde_json::Value,
}

pub async fn list_programs(pool: &PgPool) -> Result<Vec<TrainingProgramRow>, AppError> {
    let rows = sqlx::query_as::<_, TrainingProgramRow>(
        "SELECT id, title, on_date, place, cost_minor, state, defined
           FROM training_program ORDER BY on_date DESC",
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

pub async fn program_by_id(
    pool: &PgPool,
    id: &str,
) -> Result<Option<TrainingProgramRow>, AppError> {
    Ok(sqlx::query_as::<_, TrainingProgramRow>(
        "SELECT id, title, on_date, place, cost_minor, state, defined
           FROM training_program WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?)
}

pub async fn complete_program(pool: &PgPool, id: &str) -> Result<(), AppError> {
    let mut tx = pool.begin().await?;
    let state = sqlx::query_scalar::<_, String>(
        "SELECT state FROM training_program WHERE id = $1 FOR UPDATE",
    )
    .bind(id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("training program {id}")))?;
    if state == "DONE" {
        return Err(AppError::Conflict(format!(
            "training program {id} is already complete"
        )));
    }
    sqlx::query("UPDATE training_program SET state = 'DONE', updated_at = now() WHERE id = $1")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(())
}

pub async fn add_participant(
    pool: &PgPool,
    program_id: &str,
    employee_id: &str,
    nominated: serde_json::Value,
) -> Result<(), AppError> {
    let mut tx = pool.begin().await?;
    let state = sqlx::query_scalar::<_, String>(
        "SELECT state FROM training_program WHERE id = $1 FOR UPDATE",
    )
    .bind(program_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("training program {program_id}")))?;
    if state != "SCHEDULED" {
        return Err(AppError::Conflict(format!(
            "training program {program_id} is complete; nominations are closed"
        )));
    }
    let exists = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS (SELECT 1 FROM training_participant
                         WHERE program_id = $1 AND employee_id = $2)",
    )
    .bind(program_id)
    .bind(employee_id)
    .fetch_one(&mut *tx)
    .await?;
    if exists {
        return Err(AppError::Conflict(
            "this employee is already nominated for the programme".to_owned(),
        ));
    }
    sqlx::query(
        "INSERT INTO training_participant (program_id, employee_id, nominated)
         VALUES ($1, $2, $3)",
    )
    .bind(program_id)
    .bind(employee_id)
    .bind(nominated)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(())
}

#[derive(Debug, sqlx::FromRow)]
pub struct TrainingParticipantRow {
    pub program_id: String,
    pub employee_id: String,
    pub certificate: bool,
    pub unit_id: Option<String>,
    pub attended: Option<bool>,
    pub attendance_history: serde_json::Value,
}

pub async fn list_participants(
    pool: &PgPool,
    program: Option<&str>,
    employee: Option<&str>,
    unit: Option<&str>,
) -> Result<Vec<TrainingParticipantRow>, AppError> {
    let rows = sqlx::query_as::<_, TrainingParticipantRow>(
        "SELECT p.program_id, p.employee_id, p.certificate, a.unit_id,
                p.attended, p.attendance_history
           FROM training_participant p
           LEFT JOIN LATERAL (
                SELECT unit_id FROM employee_assignment
                 WHERE employee_id = p.employee_id AND valid_to IS NULL
                 ORDER BY valid_from DESC LIMIT 1
           ) a ON true
          WHERE ($1::text IS NULL OR p.program_id = $1)
            AND ($2::text IS NULL OR p.employee_id = $2)
            AND ($3::text IS NULL OR a.unit_id = $3)
          ORDER BY p.employee_id",
    )
    .bind(program)
    .bind(employee)
    .bind(unit)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

pub async fn record_training_attendance(
    pool: &PgPool,
    program_id: &str,
    employee_id: &str,
    attendance: &TrainingAttendance,
) -> Result<(), AppError> {
    let recorded = serde_json::to_value(attendance)?;
    let result = sqlx::query(
        "UPDATE training_participant
            SET attended = $3,
                attendance_history = attendance_history || jsonb_build_array($4)
          WHERE program_id = $1 AND employee_id = $2",
    )
    .bind(program_id)
    .bind(employee_id)
    .bind(attendance.attended)
    .bind(recorded)
    .execute(pool)
    .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound(
            "employee is not nominated for this training programme".to_owned(),
        ));
    }
    Ok(())
}

// ── benefits ─────────────────────────────────────────────────────────────

pub async fn insert_uniform(pool: &PgPool, issuance: &UniformIssuance) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO uniform_issuance (id, employee_id, issued_on, sets, recorded)
         VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(&issuance.id)
    .bind(issuance.employee_id.as_str())
    .bind(issuance.issued_on)
    .bind(issuance.sets as i32)
    .bind(serde_json::to_value(&issuance.recorded)?)
    .execute(pool)
    .await?;
    Ok(())
}

#[derive(Debug, sqlx::FromRow)]
pub struct UniformRow {
    pub id: String,
    pub employee_id: String,
    pub issued_on: NaiveDate,
    pub sets: i32,
    pub recorded: serde_json::Value,
}

pub async fn list_uniform(pool: &PgPool, employee_id: &str) -> Result<Vec<UniformRow>, AppError> {
    let rows = sqlx::query_as::<_, UniformRow>(
        "SELECT id, employee_id, issued_on, sets, recorded
           FROM uniform_issuance
          WHERE employee_id = $1
          ORDER BY issued_on DESC",
    )
    .bind(employee_id)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

// ── the rule numbers ─────────────────────────────────────────────────────

#[derive(Debug, sqlx::FromRow)]
pub struct PolicyRow {
    pub key: String,
    pub group_: String,
    pub label: String,
    pub value: f64,
    pub unit: String,
    pub updated: serde_json::Value,
}

pub async fn list_policy(pool: &PgPool, group: Option<&str>) -> Result<Vec<PolicyRow>, AppError> {
    let rows = sqlx::query_as::<_, PolicyRow>(
        "SELECT key, group_, label, value, unit, updated
           FROM hr_policy
          WHERE ($1::text IS NULL OR group_ = $1)
          ORDER BY group_, key",
    )
    .bind(group)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

pub async fn policy_value(pool: &PgPool, key: &str) -> Result<Option<f64>, AppError> {
    let row = sqlx::query("SELECT value FROM hr_policy WHERE key = $1")
        .bind(key)
        .fetch_optional(pool)
        .await?;
    Ok(row.map(|r| r.try_get::<f64, _>("value")).transpose()?)
}

pub async fn update_policy(
    pool: &PgPool,
    key: &str,
    value: f64,
    updated: serde_json::Value,
) -> Result<(), AppError> {
    let updated_rows = sqlx::query("UPDATE hr_policy SET value = $2, updated = $3 WHERE key = $1")
        .bind(key)
        .bind(value)
        .bind(&updated)
        .execute(pool)
        .await?
        .rows_affected();
    if updated_rows == 0 {
        return Err(AppError::NotFound(format!("policy {key}")));
    }
    Ok(())
}

// ── organisation masters ─────────────────────────────────────────────────

#[derive(Debug, sqlx::FromRow)]
pub struct GradeRow {
    pub code: String,
    pub floor_minor: i64,
    pub ceiling_minor: i64,
}

pub async fn list_grades(pool: &PgPool) -> Result<Vec<GradeRow>, AppError> {
    let rows = sqlx::query_as::<_, GradeRow>(
        "SELECT code, floor_minor, ceiling_minor FROM org_grade ORDER BY floor_minor",
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

#[derive(Debug, sqlx::FromRow)]
pub struct PositionRow {
    pub name: String,
    pub grade_floor: String,
    pub grade_ceiling: String,
    pub structure: String,
}

pub async fn list_positions(pool: &PgPool) -> Result<Vec<PositionRow>, AppError> {
    let rows = sqlx::query_as::<_, PositionRow>(
        "SELECT name, grade_floor, grade_ceiling, structure
           FROM org_position ORDER BY name",
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

#[derive(Debug, sqlx::FromRow)]
pub struct StructureRow {
    pub code: String,
    pub name: String,
    pub bonus_cap_policy: Option<String>,
}

#[derive(Debug, sqlx::FromRow)]
pub struct StructureComponentRow {
    pub structure: String,
    pub component_code: String,
}

pub async fn list_structures(pool: &PgPool) -> Result<Vec<StructureRow>, AppError> {
    let rows = sqlx::query_as::<_, StructureRow>(
        "SELECT code, name, bonus_cap_policy FROM pay_structure ORDER BY code",
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

pub async fn list_structure_components(
    pool: &PgPool,
) -> Result<Vec<StructureComponentRow>, AppError> {
    let rows = sqlx::query_as::<_, StructureComponentRow>(
        "SELECT structure, component_code FROM pay_structure_component ORDER BY structure",
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// The server clock, once, for the handlers that stamp `applied_at`.
pub fn now() -> DateTime<Utc> {
    Utc::now()
}

// ── the swap picker's feed ───────────────────────────────────────────────

/// Who else is planned this week at one unit, with the days their plan
/// covers. Excludes the caller — a swap with yourself changes nothing, and
/// the request form has no use for their own row.
///
/// A runtime query rather than `sqlx::query!`: it was the only compile-time
/// checked query in the crate, and it tied every build to either a live
/// database at the newest migration or a `.sqlx` cache regenerated in step
/// with it — the unit rename (0601) is exactly the change that breaks both.
pub async fn colleagues_at(
    pool: &PgPool,
    unit: &str,
    excluding: &str,
    from: NaiveDate,
    to: NaiveDate,
) -> Result<Vec<ColleagueRow>, AppError> {
    let rows = sqlx::query_as::<_, (String, Option<String>, NaiveDate, serde_json::Value)>(
        "SELECT e.id AS employee_id,
                COALESCE(p.full_name, e.code) AS name,
                r.on_date,
                r.planned
           FROM roster_day r
           JOIN employee e ON e.id = r.employee_id
           LEFT JOIN employee_profile p ON p.employee_id = e.id
          WHERE r.unit_id = $1
            AND r.on_date BETWEEN $2 AND $3
            AND e.id <> $4
            AND EXISTS (SELECT 1 FROM employee_assignment a
                         WHERE a.employee_id = e.id AND a.unit_id = $1)
          ORDER BY e.id, r.on_date",
    )
    .bind(unit)
    .bind(from)
    .bind(to)
    .bind(excluding)
    .fetch_all(pool)
    .await?;

    // Fold into one row per person, days in date order.
    let mut people: Vec<ColleagueRow> = Vec::new();
    let mut index: std::collections::HashMap<String, usize> = Default::default();
    for (employee_id, name, on_date, planned) in rows {
        let plan = planned
            .get("plan")
            .and_then(|word| word.as_str())
            .unwrap_or("SCHEDULED")
            .to_owned();
        let name = name.unwrap_or_else(|| employee_id.clone());
        let entry = index.entry(employee_id.clone()).or_insert_with(|| {
            people.push(ColleagueRow {
                employee_id: employee_id.clone(),
                name,
                days: Vec::new(),
            });
            people.len() - 1
        });
        people[*entry].days.push(ColleagueDay { on_date, plan });
    }
    Ok(people)
}

pub struct ColleagueRow {
    pub employee_id: String,
    pub name: String,
    pub days: Vec<ColleagueDay>,
}

pub struct ColleagueDay {
    pub on_date: NaiveDate,
    pub plan: String,
}
