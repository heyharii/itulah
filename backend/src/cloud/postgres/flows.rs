//! Flow templates and flow documents, as rows (0615–0619).
//!
//! # Templates
//!
//! Saved in versions and never edited in place: a save writes version n+1 and,
//! when asked, makes it current. A template keeps its code and its route —
//! the creation paths pick a template BY its route, so a template that could
//! change route would change which flow a running allotment path starts.
//! Every draft is checked by `domain::flow::validate_template` before a row is
//! written, and 0615's deferred trigger checks it again at commit.
//!
//! # Documents
//!
//! A document is born from the document it runs — an allotment for every
//! outbound route, a purchase order or delivery for a supplier's goods — and
//! never creates it: a plan is not a stage. The creation path of that source
//! starts the flow in its own transaction, and whoever raises the source must
//! hold one of the template's starter roles ([`authorise_source_tx`]).
//!
//! A document is started on the current version of a template and keeps it.
//! Its state is never read off a column: it is the version's stages and the
//! document's applied actions replayed through `domain::flow` — the same code
//! a preview runs in memory. A confirm replays, applies the new actions for
//! ONE stage, and writes in ONE transaction:
//!
//! * the actions (`flow_action`, append-only, in order);
//! * the stage's projection (`flow_stage_state`, `flow_stage_line`), which
//!   the database holds its rules against;
//! * the journal meanings the stage produced (`flow_posting`) — a meaning and
//!   quantities, never an account (I9);
//! * the outbox (`flow_event`) — every effect, for the node that owns the
//!   site's ledger;
//! * the document's status, with who and when.
//!
//! Nothing is compensated. A confirm that cannot be applied is refused before
//! it writes; one that was written is corrected by the next action.
//!
//! # Parked stages
//!
//! A stage that waits (a scan, an approval, a handover) is resumed by its
//! idempotency key, `<document>:<STAGE_KIND>`. Resuming a stage that is
//! already done answers with the document as it stands: twice is once.
//!
//! Business time arrives from the caller (`state.clock.now()` in the
//! handlers), never from the wall clock here.

use super::{begin_idempotent, complete_idempotent, payload_digest};
use crate::cloud::application::AppError;
use crate::cloud::domain::flow::{
    self, Actor, Effect, EffectLine, FlowActionInput, FlowError, FlowHeader, FlowRole, FlowRoute,
    FlowSource, FlowState, FlowStatus, FlowTemplateDraft, PartyKind, PoolRole, ProofKind,
    ProofRecord, RouteEnd, SourceKind, StageKind, StageRuntime, StageSide, StageStatus,
    TemplateProblem, TemplateStage,
};
use crate::cloud::domain::{DestinationType, Role};
use crate::ids::SiteKind;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::{PgConnection, PgPool, Postgres, Row, Transaction};
use std::collections::{BTreeMap, BTreeSet};
use uuid::Uuid;

// --- errors ---------------------------------------------------------------

fn flow_error(error: FlowError) -> AppError {
    match error {
        FlowError::Forbidden(message) => AppError::Forbidden(message),
        FlowError::NotDue(message) => AppError::Conflict(message),
        other => AppError::Validation(other.to_string()),
    }
}

fn problems_error(problems: &[TemplateProblem]) -> AppError {
    let first = problems
        .first()
        .map(|problem| problem.message.clone())
        .unwrap_or_else(|| "template tidak valid".into());
    if problems.len() > 1 {
        AppError::Validation(format!("{first} (dan {} masalah lain)", problems.len() - 1))
    } else {
        AppError::Validation(first)
    }
}

/// A stored code this build does not know: data written by a newer build, or
/// by hand. Refused by name rather than read as something else.
fn unknown(what: &str, raw: &str) -> AppError {
    AppError::Conflict(format!(
        "{what} `{raw}` tersimpan tetapi tidak dikenal oleh build ini"
    ))
}

fn stored<T>(value: Option<T>, what: &str, raw: &str) -> Result<T, AppError> {
    value.ok_or_else(|| unknown(what, raw))
}

// --- templates: reading -----------------------------------------------------

/// One template as a list shows it.
#[derive(Clone, Debug, Serialize)]
pub struct FlowTemplateSummary {
    pub id: Uuid,
    pub code: String,
    pub name: String,
    pub origin: String,
    pub destination: String,
    pub status: String,
    pub is_default: bool,
    pub current_version: Option<i32>,
    /// The current version's stages, in order (stage kind codes).
    pub stages: Vec<String>,
    pub starters: Vec<String>,
    pub updated_by: String,
    pub updated_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Serialize)]
pub struct FlowTemplateVersionView {
    pub id: Uuid,
    pub version: i32,
    pub is_current: bool,
    pub created_by: String,
    pub created_at: DateTime<Utc>,
    /// How many documents run on it. A version something runs on is the
    /// reason versions are never edited.
    pub documents: i64,
    pub template: FlowTemplateDraft,
}

#[derive(Clone, Debug, Serialize)]
pub struct FlowTemplateDetail {
    #[serde(flatten)]
    pub summary: FlowTemplateSummary,
    /// Newest first.
    pub versions: Vec<FlowTemplateVersionView>,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FlowTemplateFilter {
    #[serde(default)]
    pub origin: Option<RouteEnd>,
    #[serde(default)]
    pub destination: Option<RouteEnd>,
    #[serde(default)]
    pub include_retired: bool,
}

const SUMMARY_SELECT: &str = "
    SELECT t.id, t.code, t.name, t.origin_kind, t.destination_kind, t.status, t.is_default,
           v.version AS current_version, v.starters,
           COALESCE((SELECT array_agg(s.stage_kind ORDER BY s.ordinal)
                       FROM flow_template_stage s
                      WHERE s.version_id = t.current_version_id), '{}'::text[]) AS stages,
           t.updated_by, t.updated_at
      FROM flow_template t
      LEFT JOIN flow_template_version v ON v.id = t.current_version_id";

fn summary_from(row: &sqlx::postgres::PgRow) -> Result<FlowTemplateSummary, AppError> {
    Ok(FlowTemplateSummary {
        id: row.try_get("id")?,
        code: row.try_get("code")?,
        name: row.try_get("name")?,
        origin: row.try_get("origin_kind")?,
        destination: row.try_get("destination_kind")?,
        status: row.try_get("status")?,
        is_default: row.try_get("is_default")?,
        current_version: row.try_get("current_version")?,
        stages: row.try_get("stages")?,
        starters: row
            .try_get::<Option<Vec<String>>, _>("starters")?
            .unwrap_or_default(),
        updated_by: row.try_get("updated_by")?,
        updated_at: row.try_get("updated_at")?,
    })
}

/// Templates, optionally for one route: what a creation path or a person
/// starting a flow chooses from.
pub async fn list_flow_templates(
    pool: &PgPool,
    filter: &FlowTemplateFilter,
) -> Result<Vec<FlowTemplateSummary>, AppError> {
    let sql = format!(
        "{SUMMARY_SELECT}
          WHERE ($1::text IS NULL OR t.origin_kind = $1)
            AND ($2::text IS NULL OR t.destination_kind = $2)
            AND ($3 OR t.status = 'ACTIVE')
          ORDER BY t.status, t.origin_kind, t.destination_kind, t.is_default DESC, t.name"
    );
    let rows = sqlx::query(&sql)
        .bind(filter.origin.map(RouteEnd::code))
        .bind(filter.destination.map(RouteEnd::code))
        .bind(filter.include_retired)
        .fetch_all(pool)
        .await?;
    rows.iter().map(summary_from).collect()
}

/// One version's content, as a draft: what it runs, and what an editor
/// starts a new version from.
async fn load_version_draft(
    connection: &mut PgConnection,
    version_id: Uuid,
) -> Result<FlowTemplateDraft, AppError> {
    let head = sqlx::query(
        "SELECT t.code, t.name, t.origin_kind, t.destination_kind,
                v.starters, v.destination_pool_role, v.notes
           FROM flow_template_version v
           JOIN flow_template t ON t.id = v.template_id
          WHERE v.id = $1",
    )
    .bind(version_id)
    .fetch_optional(&mut *connection)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("flow template version {version_id}")))?;

    let origin: String = head.try_get("origin_kind")?;
    let destination: String = head.try_get("destination_kind")?;
    let starters: Vec<String> = head.try_get("starters")?;
    let pool: Option<String> = head.try_get("destination_pool_role")?;

    let mut stages = Vec::new();
    let rows = sqlx::query(
        "SELECT stage_kind, performer_role, proof, deadline_hours, skippable, params
           FROM flow_template_stage
          WHERE version_id = $1
          ORDER BY ordinal",
    )
    .bind(version_id)
    .fetch_all(&mut *connection)
    .await?;
    for row in &rows {
        let kind: String = row.try_get("stage_kind")?;
        let performer: String = row.try_get("performer_role")?;
        let proof: Vec<String> = row.try_get("proof")?;
        let deadline: Option<i32> = row.try_get("deadline_hours")?;
        stages.push(TemplateStage {
            kind: stored(StageKind::parse(&kind), "tahap", &kind)?,
            performer: stored(FlowRole::parse(&performer), "peran", &performer)?,
            proof: proof
                .iter()
                .map(|code| stored(ProofKind::parse(code), "bukti", code))
                .collect::<Result<Vec<_>, _>>()?,
            deadline_hours: deadline.and_then(|hours| u32::try_from(hours).ok()),
            skippable: row.try_get("skippable")?,
            params: row.try_get("params")?,
        });
    }

    Ok(FlowTemplateDraft {
        code: head.try_get("code")?,
        name: head.try_get("name")?,
        route: FlowRoute {
            origin: stored(RouteEnd::parse(&origin), "ujung rute", &origin)?,
            destination: stored(RouteEnd::parse(&destination), "ujung rute", &destination)?,
        },
        starters: starters
            .iter()
            .map(|code| stored(FlowRole::parse(code), "peran", code))
            .collect::<Result<Vec<_>, _>>()?,
        destination_pool: match pool {
            Some(code) => Some(stored(PoolRole::parse(&code), "pool", &code)?),
            None => None,
        },
        stages,
        notes: head.try_get("notes")?,
    })
}

async fn read_template_detail(
    connection: &mut PgConnection,
    template_id: Uuid,
) -> Result<FlowTemplateDetail, AppError> {
    let sql = format!("{SUMMARY_SELECT} WHERE t.id = $1");
    let row = sqlx::query(&sql)
        .bind(template_id)
        .fetch_optional(&mut *connection)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("flow template {template_id}")))?;
    let summary = summary_from(&row)?;

    let rows = sqlx::query(
        "SELECT v.id, v.version, v.created_by, v.created_at,
                (v.id = t.current_version_id) AS is_current,
                (SELECT count(*) FROM flow_document d WHERE d.template_version_id = v.id) AS documents
           FROM flow_template_version v
           JOIN flow_template t ON t.id = v.template_id
          WHERE v.template_id = $1
          ORDER BY v.version DESC",
    )
    .bind(template_id)
    .fetch_all(&mut *connection)
    .await?;
    let mut versions = Vec::with_capacity(rows.len());
    for row in &rows {
        let id: Uuid = row.try_get("id")?;
        versions.push(FlowTemplateVersionView {
            id,
            version: row.try_get("version")?,
            is_current: row.try_get::<Option<bool>, _>("is_current")?.unwrap_or(false),
            created_by: row.try_get("created_by")?,
            created_at: row.try_get("created_at")?,
            documents: row.try_get("documents")?,
            template: load_version_draft(&mut *connection, id).await?,
        });
    }
    Ok(FlowTemplateDetail { summary, versions })
}

pub async fn flow_template_detail(
    pool: &PgPool,
    template_id: Uuid,
) -> Result<FlowTemplateDetail, AppError> {
    let mut connection = pool.acquire().await?;
    read_template_detail(&mut connection, template_id).await
}

// --- templates: checking ------------------------------------------------------

/// Everything wrong with a draft: the domain's invariants, and what only the
/// database knows — whether the code is taken, and whether a new version
/// keeps its template's code and route.
pub async fn validate_flow_template(
    pool: &PgPool,
    draft: &FlowTemplateDraft,
    template_id: Option<Uuid>,
) -> Result<Vec<TemplateProblem>, AppError> {
    let mut problems = flow::validate_template(draft);
    match template_id {
        None => {
            let taken: bool = sqlx::query_scalar(
                "SELECT EXISTS (SELECT 1 FROM flow_template WHERE code = $1)",
            )
            .bind(draft.code.trim())
            .fetch_one(pool)
            .await?;
            if taken {
                problems.push(TemplateProblem {
                    stage: None,
                    field: Some("code"),
                    rule: "template.code_taken",
                    message: format!("Kode {} sudah dipakai alur lain.", draft.code.trim()),
                });
            }
        }
        Some(id) => {
            let row = sqlx::query(
                "SELECT code, origin_kind, destination_kind FROM flow_template WHERE id = $1",
            )
            .bind(id)
            .fetch_optional(pool)
            .await?
            .ok_or_else(|| AppError::NotFound(format!("flow template {id}")))?;
            problems.extend(keeps_identity(&row, draft)?);
        }
    }
    Ok(problems)
}

fn keeps_identity(
    row: &sqlx::postgres::PgRow,
    draft: &FlowTemplateDraft,
) -> Result<Vec<TemplateProblem>, AppError> {
    let mut problems = Vec::new();
    let code: String = row.try_get("code")?;
    let origin: String = row.try_get("origin_kind")?;
    let destination: String = row.try_get("destination_kind")?;
    if draft.code.trim() != code {
        problems.push(TemplateProblem {
            stage: None,
            field: Some("code"),
            rule: "template.code_fixed",
            message: format!("Kode alur tetap {code}; versi baru tidak mengganti kode."),
        });
    }
    if draft.route.origin.code() != origin || draft.route.destination.code() != destination {
        problems.push(TemplateProblem {
            stage: None,
            field: Some("route"),
            rule: "template.route_fixed",
            message: format!(
                "Rute alur ini tetap {origin} → {destination}. Untuk rute lain, buat alur baru."
            ),
        });
    }
    Ok(problems)
}

// --- templates: writing -------------------------------------------------------

async fn insert_version(
    connection: &mut PgConnection,
    template_id: Uuid,
    version_id: Uuid,
    version: i32,
    draft: &FlowTemplateDraft,
    actor: &str,
    at: DateTime<Utc>,
) -> Result<(), AppError> {
    let starters: Vec<String> = draft
        .starters
        .iter()
        .map(|role| role.code().to_owned())
        .collect();
    sqlx::query(
        "INSERT INTO flow_template_version
            (id, template_id, version, starters, destination_pool_role, notes, created_by, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
    )
    .bind(version_id)
    .bind(template_id)
    .bind(version)
    .bind(&starters)
    .bind(draft.destination_pool.map(PoolRole::code))
    .bind(
        draft
            .notes
            .as_deref()
            .map(str::trim)
            .filter(|notes| !notes.is_empty()),
    )
    .bind(actor)
    .bind(at)
    .execute(&mut *connection)
    .await?;

    for (ordinal, stage) in draft.stages.iter().enumerate() {
        let proof: Vec<String> = stage
            .proof
            .iter()
            .map(|kind| kind.code().to_owned())
            .collect();
        let params = match &stage.params {
            Value::Null => json!({}),
            other => other.clone(),
        };
        sqlx::query(
            "INSERT INTO flow_template_stage
                (version_id, ordinal, stage_kind, performer_role, proof, deadline_hours, skippable, params)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
        )
        .bind(version_id)
        .bind(ordinal as i32)
        .bind(stage.kind.code())
        .bind(stage.performer.code())
        .bind(&proof)
        .bind(stage.deadline_hours.and_then(|hours| i32::try_from(hours).ok()))
        .bind(stage.skippable)
        .bind(params)
        .execute(&mut *connection)
        .await?;
    }
    Ok(())
}

async fn clear_default_for_route(
    connection: &mut PgConnection,
    route: FlowRoute,
    actor: &str,
    at: DateTime<Utc>,
) -> Result<(), AppError> {
    sqlx::query(
        "UPDATE flow_template
            SET is_default = false, updated_by = $3, updated_at = $4
          WHERE origin_kind = $1 AND destination_kind = $2 AND is_default",
    )
    .bind(route.origin.code())
    .bind(route.destination.code())
    .bind(actor)
    .bind(at)
    .execute(&mut *connection)
    .await?;
    Ok(())
}

/// A new template, at version 1 and current. `make_default` makes it the
/// one its route's creation paths pick.
pub async fn create_flow_template(
    pool: &PgPool,
    draft: &FlowTemplateDraft,
    make_default: bool,
    actor: &str,
    at: DateTime<Utc>,
) -> Result<FlowTemplateDetail, AppError> {
    let problems = validate_flow_template(pool, draft, None).await?;
    if !problems.is_empty() {
        return Err(problems_error(&problems));
    }
    let template_id = Uuid::new_v4();
    let version_id = Uuid::new_v4();
    let mut tx = pool.begin().await?;
    // Two Admins saving the same code at once: the unique index would refuse
    // the second anyway, but as a 500. The lock makes it the sentence above.
    sqlx::query("SELECT pg_advisory_xact_lock(hashtext('flow_template_code'))")
        .execute(&mut *tx)
        .await?;
    let taken: bool =
        sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM flow_template WHERE code = $1)")
            .bind(draft.code.trim())
            .fetch_one(&mut *tx)
            .await?;
    if taken {
        return Err(AppError::Conflict(format!(
            "kode {} sudah dipakai alur lain",
            draft.code.trim()
        )));
    }
    if make_default {
        clear_default_for_route(&mut tx, draft.route, actor, at).await?;
    }
    sqlx::query(
        "INSERT INTO flow_template
            (id, code, name, origin_kind, destination_kind, is_default, current_version_id,
             created_by, created_at, updated_by, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $8, $9)",
    )
    .bind(template_id)
    .bind(draft.code.trim())
    .bind(draft.name.trim())
    .bind(draft.route.origin.code())
    .bind(draft.route.destination.code())
    .bind(make_default)
    .bind(version_id)
    .bind(actor)
    .bind(at)
    .execute(&mut *tx)
    .await?;
    insert_version(&mut tx, template_id, version_id, 1, draft, actor, at).await?;
    let detail = read_template_detail(&mut tx, template_id).await?;
    tx.commit().await?;
    Ok(detail)
}

/// Save the next version of a template. `activate` makes it the version new
/// documents start on; documents already running keep theirs.
pub async fn save_flow_template_version(
    pool: &PgPool,
    template_id: Uuid,
    draft: &FlowTemplateDraft,
    activate: bool,
    actor: &str,
    at: DateTime<Utc>,
) -> Result<FlowTemplateDetail, AppError> {
    let problems = flow::validate_template(draft);
    if !problems.is_empty() {
        return Err(problems_error(&problems));
    }
    let mut tx = pool.begin().await?;
    let row = sqlx::query(
        "SELECT code, origin_kind, destination_kind, status
           FROM flow_template WHERE id = $1 FOR UPDATE",
    )
    .bind(template_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("flow template {template_id}")))?;
    let identity = keeps_identity(&row, draft)?;
    if !identity.is_empty() {
        return Err(problems_error(&identity));
    }
    let status: String = row.try_get("status")?;
    if status != "ACTIVE" {
        return Err(AppError::Conflict(
            "alur ini sudah dipensiunkan; aktifkan dulu sebelum menyimpan versi baru".into(),
        ));
    }
    let next: i32 = sqlx::query_scalar(
        "SELECT COALESCE(max(version), 0) + 1 FROM flow_template_version WHERE template_id = $1",
    )
    .bind(template_id)
    .fetch_one(&mut *tx)
    .await?;
    let version_id = Uuid::new_v4();
    insert_version(&mut tx, template_id, version_id, next, draft, actor, at).await?;
    sqlx::query(
        "UPDATE flow_template
            SET name = $2,
                current_version_id = CASE WHEN $3 THEN $4 ELSE current_version_id END,
                updated_by = $5, updated_at = $6
          WHERE id = $1",
    )
    .bind(template_id)
    .bind(draft.name.trim())
    .bind(activate)
    .bind(version_id)
    .bind(actor)
    .bind(at)
    .execute(&mut *tx)
    .await?;
    let detail = read_template_detail(&mut tx, template_id).await?;
    tx.commit().await?;
    Ok(detail)
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct FlowTemplatePatch {
    #[serde(default)]
    pub name: Option<String>,
    /// Make this the route's default (true), or stop it being (false).
    #[serde(default)]
    pub is_default: Option<bool>,
    /// `ACTIVE` or `RETIRED`. A retired template starts nothing new; the
    /// documents running on it finish.
    #[serde(default)]
    pub status: Option<String>,
    /// Go back to an earlier saved version: it becomes current again.
    #[serde(default)]
    pub current_version: Option<i32>,
}

pub async fn update_flow_template(
    pool: &PgPool,
    template_id: Uuid,
    patch: &FlowTemplatePatch,
    actor: &str,
    at: DateTime<Utc>,
) -> Result<FlowTemplateDetail, AppError> {
    let mut tx = pool.begin().await?;
    let row = sqlx::query(
        "SELECT origin_kind, destination_kind, status FROM flow_template WHERE id = $1 FOR UPDATE",
    )
    .bind(template_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("flow template {template_id}")))?;
    let origin: String = row.try_get("origin_kind")?;
    let destination: String = row.try_get("destination_kind")?;
    let route = FlowRoute {
        origin: stored(RouteEnd::parse(&origin), "ujung rute", &origin)?,
        destination: stored(RouteEnd::parse(&destination), "ujung rute", &destination)?,
    };
    let mut status: String = row.try_get("status")?;

    if let Some(next) = patch.status.as_deref().map(str::trim) {
        match next {
            "RETIRED" if status != "RETIRED" => {
                sqlx::query(
                    "UPDATE flow_template
                        SET status = 'RETIRED', is_default = false, retired_by = $2, retired_at = $3,
                            updated_by = $2, updated_at = $3
                      WHERE id = $1",
                )
                .bind(template_id)
                .bind(actor)
                .bind(at)
                .execute(&mut *tx)
                .await?;
                status = "RETIRED".into();
            }
            "ACTIVE" if status != "ACTIVE" => {
                sqlx::query(
                    "UPDATE flow_template
                        SET status = 'ACTIVE', retired_by = NULL, retired_at = NULL,
                            updated_by = $2, updated_at = $3
                      WHERE id = $1",
                )
                .bind(template_id)
                .bind(actor)
                .bind(at)
                .execute(&mut *tx)
                .await?;
                status = "ACTIVE".into();
            }
            "RETIRED" | "ACTIVE" => {}
            other => {
                return Err(AppError::Validation(format!(
                    "status `{other}` tidak dikenal: ACTIVE atau RETIRED"
                )))
            }
        }
    }

    if let Some(name) = patch.name.as_deref().map(str::trim) {
        if name.is_empty() {
            return Err(AppError::Validation("nama alur wajib diisi".into()));
        }
        sqlx::query(
            "UPDATE flow_template SET name = $2, updated_by = $3, updated_at = $4 WHERE id = $1",
        )
        .bind(template_id)
        .bind(name)
        .bind(actor)
        .bind(at)
        .execute(&mut *tx)
        .await?;
    }

    if let Some(version) = patch.current_version {
        let version_id: Uuid = sqlx::query_scalar(
            "SELECT id FROM flow_template_version WHERE template_id = $1 AND version = $2",
        )
        .bind(template_id)
        .bind(version)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("versi {version} alur ini")))?;
        // A version saved under older rules may not hold the rules of this
        // build. Going back to it is refused rather than started on.
        let draft = load_version_draft(&mut tx, version_id).await?;
        let problems = flow::validate_template(&draft);
        if !problems.is_empty() {
            return Err(problems_error(&problems));
        }
        sqlx::query(
            "UPDATE flow_template
                SET current_version_id = $2, updated_by = $3, updated_at = $4
              WHERE id = $1",
        )
        .bind(template_id)
        .bind(version_id)
        .bind(actor)
        .bind(at)
        .execute(&mut *tx)
        .await?;
    }

    match patch.is_default {
        Some(true) => {
            if status != "ACTIVE" {
                return Err(AppError::Conflict(
                    "alur yang dipensiunkan tidak bisa jadi bawaan rutenya".into(),
                ));
            }
            clear_default_for_route(&mut tx, route, actor, at).await?;
            sqlx::query(
                "UPDATE flow_template SET is_default = true, updated_by = $2, updated_at = $3 WHERE id = $1",
            )
            .bind(template_id)
            .bind(actor)
            .bind(at)
            .execute(&mut *tx)
            .await?;
        }
        Some(false) => {
            sqlx::query(
                "UPDATE flow_template SET is_default = false, updated_by = $2, updated_at = $3 WHERE id = $1",
            )
            .bind(template_id)
            .bind(actor)
            .bind(at)
            .execute(&mut *tx)
            .await?;
        }
        None => {}
    }

    let detail = read_template_detail(&mut tx, template_id).await?;
    tx.commit().await?;
    Ok(detail)
}

// --- choosing a template: the creation paths' adapter ----------------------

/// The template a creation path runs, and the version it keeps.
#[derive(Clone, Debug, Serialize)]
pub struct FlowTemplateChoice {
    pub template_id: Uuid,
    pub template_code: String,
    pub version_id: Uuid,
    pub version: i32,
    pub template: FlowTemplateDraft,
}

/// Pick and check the template for a route.
///
/// Named by `code` when the caller chose one, else the route's default. Its
/// current version is loaded and validated again here — a version saved
/// under older rules is refused rather than started — and the named
/// template's route must be the route asked about.
///
/// The allotment creation path (`postgres::allotments::create_allotment`) and
/// the purchase-order path call this inside their own transaction, through
/// `start_flow_for_allotment_tx` / `start_flow_for_purchase_order_tx`.
pub async fn choose_flow_template_tx(
    tx: &mut Transaction<'_, Postgres>,
    route: FlowRoute,
    code: Option<&str>,
) -> Result<FlowTemplateChoice, AppError> {
    let row = match code.map(str::trim).filter(|code| !code.is_empty()) {
        Some(code) => sqlx::query(
            "SELECT t.id, t.code, t.origin_kind, t.destination_kind, t.status, t.current_version_id, v.version
               FROM flow_template t
               LEFT JOIN flow_template_version v ON v.id = t.current_version_id
              WHERE t.code = $1",
        )
        .bind(code)
        .fetch_optional(&mut **tx)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("alur {code}")))?,
        None => sqlx::query(
            "SELECT t.id, t.code, t.origin_kind, t.destination_kind, t.status, t.current_version_id, v.version
               FROM flow_template t
               LEFT JOIN flow_template_version v ON v.id = t.current_version_id
              WHERE t.origin_kind = $1 AND t.destination_kind = $2 AND t.is_default",
        )
        .bind(route.origin.code())
        .bind(route.destination.code())
        .fetch_optional(&mut **tx)
        .await?
        .ok_or_else(|| {
            AppError::NotFound(format!(
                "belum ada alur bawaan untuk {} → {}; atur di Alur barang",
                route.origin.label(),
                route.destination.label()
            ))
        })?,
    };
    let template_code: String = row.try_get("code")?;
    let origin: String = row.try_get("origin_kind")?;
    let destination: String = row.try_get("destination_kind")?;
    if origin != route.origin.code() || destination != route.destination.code() {
        return Err(AppError::Validation(format!(
            "alur {template_code} untuk {origin} → {destination}, bukan {} → {}",
            route.origin, route.destination
        )));
    }
    let status: String = row.try_get("status")?;
    if status != "ACTIVE" {
        return Err(AppError::Conflict(format!(
            "alur {template_code} sudah dipensiunkan"
        )));
    }
    let version_id: Option<Uuid> = row.try_get("current_version_id")?;
    let version_id = version_id.ok_or_else(|| {
        AppError::Conflict(format!("alur {template_code} belum punya versi aktif"))
    })?;
    let version: Option<i32> = row.try_get("version")?;
    let template = load_version_draft(&mut **tx, version_id).await?;
    let problems = flow::validate_template(&template);
    if !problems.is_empty() {
        return Err(AppError::Conflict(format!(
            "alur {template_code} versi aktifnya tidak lagi memenuhi aturan: {}",
            problems_error(&problems)
        )));
    }
    Ok(FlowTemplateChoice {
        template_id: row.try_get("id")?,
        template_code,
        version_id,
        version: version.unwrap_or(1),
        template,
    })
}

/// Whether `actor`, in `as_role`, may raise the source document for this
/// route — the allotment, or from a supplier the order — and so start its
/// flow. The template's starter roles say who; the actor's rung must hold
/// the role. Answers the template the flow will run.
///
/// The allotment and purchase-order creation paths call this BEFORE they
/// write their own document, in the same transaction, so a source nobody
/// may run is refused rather than written and left without a flow.
pub async fn authorise_source_tx(
    tx: &mut Transaction<'_, Postgres>,
    route: FlowRoute,
    template_code: Option<&str>,
    as_role: FlowRole,
    actor: &Actor,
) -> Result<FlowTemplateChoice, AppError> {
    let choice = choose_flow_template_tx(tx, route, template_code).await?;
    if !choice.template.starters.contains(&as_role) {
        let starters: Vec<&str> = choice
            .template
            .starters
            .iter()
            .map(|role| role.label())
            .collect();
        return Err(AppError::Forbidden(format!(
            "alur {} dimulai oleh {}, bukan {}",
            choice.template_code,
            starters.join(" atau "),
            as_role.label()
        )));
    }
    if !as_role.holds(actor.rung) {
        return Err(AppError::Forbidden(format!(
            "{} tidak memegang peran {}",
            actor.id,
            as_role.label()
        )));
    }
    Ok(choice)
}

// --- documents: ends -----------------------------------------------------------

/// One end of a document as a caller names it: our site, or a party.
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct FlowEndInput {
    #[serde(default)]
    pub site_id: Option<String>,
    #[serde(default)]
    pub party: Option<PartyKind>,
    #[serde(default)]
    pub party_id: Option<String>,
}

impl FlowEndInput {
    pub fn site(site_id: impl Into<String>) -> Self {
        Self {
            site_id: Some(site_id.into()),
            ..Self::default()
        }
    }

    pub fn party(party: PartyKind, party_id: impl Into<String>) -> Self {
        Self {
            site_id: None,
            party: Some(party),
            party_id: Some(party_id.into()),
        }
    }
}

/// An end, read off its row.
#[derive(Clone, Debug)]
struct ResolvedEnd {
    end: RouteEnd,
    site_id: Option<String>,
    unit_id: Option<String>,
    party: Option<PartyKind>,
    party_id: Option<String>,
}

async fn resolve_end(
    connection: &mut PgConnection,
    input: &FlowEndInput,
    which: &str,
) -> Result<ResolvedEnd, AppError> {
    let site = input
        .site_id
        .as_deref()
        .map(str::trim)
        .filter(|site| !site.is_empty());
    match (site, input.party) {
        (Some(site_id), None) => {
            let row = sqlx::query("SELECT kind, unit_id FROM site WHERE id = $1")
                .bind(site_id)
                .fetch_optional(&mut *connection)
                .await?
                .ok_or_else(|| AppError::NotFound(format!("site {site_id}")))?;
            let kind: String = row.try_get("kind")?;
            let site_kind = SiteKind::from_code(&kind).ok_or_else(|| {
                AppError::Conflict(format!("site {site_id} berjenis {kind}, yang belum dikenal alur"))
            })?;
            Ok(ResolvedEnd {
                end: RouteEnd::Site(site_kind),
                site_id: Some(site_id.to_owned()),
                unit_id: Some(row.try_get("unit_id")?),
                party: None,
                party_id: None,
            })
        }
        (None, Some(party)) => {
            let party_id = input
                .party_id
                .as_deref()
                .map(str::trim)
                .filter(|id| !id.is_empty())
                .ok_or_else(|| {
                    AppError::Validation(format!("{which}: pihak luar disebut dengan id-nya"))
                })?;
            Ok(ResolvedEnd {
                end: RouteEnd::Party(party),
                site_id: None,
                unit_id: None,
                party: Some(party),
                party_id: Some(party_id.to_owned()),
            })
        }
        _ => Err(AppError::Validation(format!(
            "{which}: sebut site kita atau pihak luar, salah satu"
        ))),
    }
}

// --- documents: starting ---------------------------------------------------------

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct FlowLineInput {
    pub sku_id: Uuid,
    pub quantity: i64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct StartFlowRequest {
    /// A template by code. Absent: the route's default.
    #[serde(default)]
    pub template_code: Option<String>,
    pub origin: FlowEndInput,
    pub destination: FlowEndInput,
    /// The role the initiator starts it in: one of the version's starters.
    pub as_role: FlowRole,
    pub lines: Vec<FlowLineInput>,
    /// The allotment, order or delivery this flow runs. A plan is not a
    /// stage: the flow names its source and never creates it.
    pub source: FlowSource,
    #[serde(default)]
    pub notes: Option<String>,
    pub idempotency_key: String,
}

/// Start a document inside the caller's transaction. Starting twice with one
/// idempotency key is one document.
pub async fn start_flow_document_tx(
    tx: &mut Transaction<'_, Postgres>,
    request: &StartFlowRequest,
    actor: &Actor,
    at: DateTime<Utc>,
) -> Result<Uuid, AppError> {
    let key = request.idempotency_key.trim();
    if key.is_empty() {
        return Err(AppError::Validation("idempotency_key is required".into()));
    }
    if let Some(existing) =
        sqlx::query_scalar::<_, Uuid>("SELECT id FROM flow_document WHERE idempotency_key = $1")
            .bind(key)
            .fetch_optional(&mut **tx)
            .await?
    {
        return Ok(existing);
    }

    let origin = resolve_end(&mut **tx, &request.origin, "asal").await?;
    let destination = resolve_end(&mut **tx, &request.destination, "tujuan").await?;
    let route = FlowRoute {
        origin: origin.end,
        destination: destination.end,
    };
    let choice = authorise_source_tx(
        tx,
        route,
        request.template_code.as_deref(),
        request.as_role,
        actor,
    )
    .await?;

    let source = FlowSource {
        kind: request.source.kind,
        id: request.source.id.trim().to_owned(),
    };
    if source.id.is_empty() {
        return Err(AppError::Validation(
            "alur lahir dari dokumen sumbernya: sebut id allotment, PO, atau delivery-nya".into(),
        ));
    }
    if !source.kind.fits(route) {
        return Err(AppError::Validation(format!(
            "alur {} → {} tidak lahir dari {}: keluar dari site kita lahir dari allotment, dari supplier dari PO atau delivery",
            route.origin.label(),
            route.destination.label(),
            source.kind.code()
        )));
    }

    if request.lines.is_empty() {
        return Err(AppError::Validation("alur butuh minimal satu baris barang".into()));
    }
    let mut planned = BTreeMap::new();
    for line in &request.lines {
        if line.quantity <= 0 {
            return Err(AppError::Validation("kuantitas baris harus positif".into()));
        }
        if planned.insert(line.sku_id, line.quantity).is_some() {
            return Err(AppError::Validation(format!(
                "SKU {} disebut dua kali",
                line.sku_id
            )));
        }
    }
    let crosses = matches!(
        (&origin.unit_id, &destination.unit_id),
        (Some(from), Some(to)) if from != to
    );
    let document_id = Uuid::new_v4();
    let state = FlowState::start(
        FlowHeader {
            document_id,
            route,
            source: source.clone(),
            initiator: actor.id.clone(),
            crosses_units: crosses,
            destination_party: destination.party,
            destination_pool: choice.template.destination_pool,
            planned,
        },
        choice.template.stages.clone(),
    );
    let confirmed = state.status == FlowStatus::Confirmed;

    let sequence: i64 = sqlx::query_scalar("SELECT nextval('flow_document_number_sequence')::bigint")
        .fetch_one(&mut **tx)
        .await?;
    let number = format!("ALR-{sequence:08}");

    sqlx::query(
        "INSERT INTO flow_document
            (id, document_number, template_id, template_version_id,
             origin_site_id, origin_party_kind, origin_party_id,
             destination_site_id, destination_party_kind, destination_party_id,
             origin_unit_id, destination_unit_id, source_kind, source_id,
             initiator_role, status, requested_by, requested_at,
             confirmed_by, confirmed_at, idempotency_key, notes, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18,
                 $19, $20, $21, $22, $18)",
    )
    .bind(document_id)
    .bind(&number)
    .bind(choice.template_id)
    .bind(choice.version_id)
    .bind(origin.site_id.as_deref())
    .bind(origin.party.map(PartyKind::code))
    .bind(origin.party_id.as_deref())
    .bind(destination.site_id.as_deref())
    .bind(destination.party.map(PartyKind::code))
    .bind(destination.party_id.as_deref())
    .bind(origin.unit_id.as_deref())
    .bind(destination.unit_id.as_deref())
    .bind(source.kind.code())
    .bind(&source.id)
    .bind(request.as_role.code())
    .bind(state.status.code())
    .bind(&actor.id)
    .bind(at)
    .bind(confirmed.then(|| actor.id.clone()))
    .bind(confirmed.then_some(at))
    .bind(key)
    .bind(
        request
            .notes
            .as_deref()
            .map(str::trim)
            .filter(|notes| !notes.is_empty()),
    )
    .execute(&mut **tx)
    .await?;

    for (sku_id, quantity) in &state.header.planned {
        sqlx::query(
            "INSERT INTO flow_document_line (document_id, sku_id, quantity) VALUES ($1, $2, $3)",
        )
        .bind(document_id)
        .bind(sku_id)
        .bind(quantity)
        .execute(&mut **tx)
        .await?;
    }

    for stage in &state.stages {
        let first = stage.index == 0;
        let deadline = if first {
            deadline_from(at, &stage.stage)
        } else {
            None
        };
        sqlx::query(
            "INSERT INTO flow_stage_state
                (document_id, stage_index, stage_kind, performer_role, status, idempotency_key,
                 activated_at, deadline_at, updated_at)
             VALUES ($1, $2, $3, $4, 'PENDING', $5, $6, $7, $8)",
        )
        .bind(document_id)
        .bind(stage.index as i32)
        .bind(stage.kind().code())
        .bind(stage.stage.performer.code())
        .bind(stage_key(document_id, stage.kind()))
        .bind(first.then_some(at))
        .bind(deadline)
        .bind(at)
        .execute(&mut **tx)
        .await?;
    }

    let row = load_document(&mut **tx, document_id, false).await?;
    write_event(
        &mut **tx,
        &row,
        &Effect::Status {
            from: FlowStatus::Requested,
            to: state.status,
            reason: None,
        },
        at,
    )
    .await?;
    Ok(document_id)
}

pub async fn start_flow_document(
    pool: &PgPool,
    request: &StartFlowRequest,
    actor: &Actor,
    at: DateTime<Utc>,
) -> Result<FlowDocumentView, AppError> {
    let mut tx = pool.begin().await?;
    let id = start_flow_document_tx(&mut tx, request, actor, at).await?;
    let view = read_document_view(&mut tx, id, actor).await?;
    tx.commit().await?;
    Ok(view)
}

/// `<document>:<STAGE_KIND>` — the key a parked stage is resumed by.
pub fn stage_key(document_id: Uuid, kind: StageKind) -> String {
    format!("{document_id}:{}", kind.code())
}

fn deadline_from(at: DateTime<Utc>, stage: &TemplateStage) -> Option<DateTime<Utc>> {
    stage
        .deadline_hours
        .map(|hours| at + chrono::Duration::hours(i64::from(hours)))
}

// --- documents: reading ----------------------------------------------------------

/// A document's row, as stored.
#[derive(Clone, Debug)]
pub(super) struct DocumentRow {
    pub id: Uuid,
    pub number: String,
    pub template_id: Uuid,
    pub template_code: String,
    pub template_name: String,
    pub template_version_id: Uuid,
    pub template_version: i32,
    pub origin_site_id: Option<String>,
    pub origin_party_kind: Option<String>,
    pub origin_party_id: Option<String>,
    pub destination_site_id: Option<String>,
    pub destination_party_kind: Option<String>,
    pub destination_party_id: Option<String>,
    pub origin_unit_id: Option<String>,
    pub destination_unit_id: Option<String>,
    pub crosses_units: bool,
    pub source_kind: String,
    pub source_id: String,
    pub initiator_role: String,
    pub status: String,
    pub requested_by: String,
    pub requested_at: DateTime<Utc>,
    pub confirmed_by: Option<String>,
    pub confirmed_at: Option<DateTime<Utc>>,
    pub completed_by: Option<String>,
    pub completed_at: Option<DateTime<Utc>>,
    pub declined_by: Option<String>,
    pub declined_at: Option<DateTime<Utc>>,
    pub declined_reason: Option<String>,
    pub canceled_by: Option<String>,
    pub canceled_at: Option<DateTime<Utc>>,
    pub canceled_reason: Option<String>,
    pub action_seq: i32,
    pub notes: Option<String>,
}

pub(super) async fn load_document(
    connection: &mut PgConnection,
    document_id: Uuid,
    lock: bool,
) -> Result<DocumentRow, AppError> {
    // The lock is taken on the document row alone (`FOR UPDATE OF d`): two
    // confirms of one document queue here, and the second replays what the
    // first wrote.
    let sql = format!(
        "SELECT d.id, d.document_number, d.template_id, t.code AS template_code, t.name AS template_name,
                d.template_version_id, v.version AS template_version,
                d.origin_site_id, d.origin_party_kind, d.origin_party_id,
                d.destination_site_id, d.destination_party_kind, d.destination_party_id,
                d.origin_unit_id, d.destination_unit_id, d.crosses_units,
                d.source_kind, d.source_id, d.initiator_role, d.status,
                d.requested_by, d.requested_at, d.confirmed_by, d.confirmed_at,
                d.completed_by, d.completed_at, d.declined_by, d.declined_at, d.declined_reason,
                d.canceled_by, d.canceled_at, d.canceled_reason, d.action_seq, d.notes
           FROM flow_document d
           JOIN flow_template t ON t.id = d.template_id
           JOIN flow_template_version v ON v.id = d.template_version_id
          WHERE d.id = $1{}",
        if lock { " FOR UPDATE OF d" } else { "" }
    );
    let row = sqlx::query(&sql)
        .bind(document_id)
        .fetch_optional(&mut *connection)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("flow document {document_id}")))?;
    Ok(DocumentRow {
        id: row.try_get("id")?,
        number: row.try_get("document_number")?,
        template_id: row.try_get("template_id")?,
        template_code: row.try_get("template_code")?,
        template_name: row.try_get("template_name")?,
        template_version_id: row.try_get("template_version_id")?,
        template_version: row.try_get("template_version")?,
        origin_site_id: row.try_get("origin_site_id")?,
        origin_party_kind: row.try_get("origin_party_kind")?,
        origin_party_id: row.try_get("origin_party_id")?,
        destination_site_id: row.try_get("destination_site_id")?,
        destination_party_kind: row.try_get("destination_party_kind")?,
        destination_party_id: row.try_get("destination_party_id")?,
        origin_unit_id: row.try_get("origin_unit_id")?,
        destination_unit_id: row.try_get("destination_unit_id")?,
        crosses_units: row.try_get("crosses_units")?,
        source_kind: row.try_get("source_kind")?,
        source_id: row.try_get("source_id")?,
        initiator_role: row.try_get("initiator_role")?,
        status: row.try_get("status")?,
        requested_by: row.try_get("requested_by")?,
        requested_at: row.try_get("requested_at")?,
        confirmed_by: row.try_get("confirmed_by")?,
        confirmed_at: row.try_get("confirmed_at")?,
        completed_by: row.try_get("completed_by")?,
        completed_at: row.try_get("completed_at")?,
        declined_by: row.try_get("declined_by")?,
        declined_at: row.try_get("declined_at")?,
        declined_reason: row.try_get("declined_reason")?,
        canceled_by: row.try_get("canceled_by")?,
        canceled_at: row.try_get("canceled_at")?,
        canceled_reason: row.try_get("canceled_reason")?,
        action_seq: row.try_get("action_seq")?,
        notes: row.try_get("notes")?,
    })
}

/// The document's state: its version's stages and its applied actions,
/// replayed. The same code a preview and a confirm run.
pub(super) async fn load_state(
    connection: &mut PgConnection,
    row: &DocumentRow,
) -> Result<FlowState, AppError> {
    let template = load_version_draft(&mut *connection, row.template_version_id).await?;
    let lines = sqlx::query(
        "SELECT sku_id, quantity FROM flow_document_line WHERE document_id = $1",
    )
    .bind(row.id)
    .fetch_all(&mut *connection)
    .await?;
    let mut planned = BTreeMap::new();
    for line in &lines {
        planned.insert(
            line.try_get::<Uuid, _>("sku_id")?,
            line.try_get::<i64, _>("quantity")?,
        );
    }
    let destination_party = match row.destination_party_kind.as_deref() {
        Some("SUPPLIER") => Some(PartyKind::Supplier),
        Some("CUSTOMER") => Some(PartyKind::Customer),
        Some(other) => return Err(unknown("pihak", other)),
        None => None,
    };
    let source = FlowSource {
        kind: stored(SourceKind::parse(&row.source_kind), "sumber", &row.source_kind)?,
        id: row.source_id.clone(),
    };
    let mut state = FlowState::start(
        FlowHeader {
            document_id: row.id,
            route: template.route,
            source,
            initiator: row.requested_by.clone(),
            crosses_units: row.crosses_units,
            destination_party,
            destination_pool: template.destination_pool,
            planned,
        },
        template.stages,
    );

    let actions = sqlx::query(
        "SELECT seq, stage_index, action_type, details, actor, actor_role
           FROM flow_action
          WHERE document_id = $1
          ORDER BY seq",
    )
    .bind(row.id)
    .fetch_all(&mut *connection)
    .await?;
    let mut history = Vec::with_capacity(actions.len());
    for action in &actions {
        let role: String = action.try_get("actor_role")?;
        let rung: Role = role.parse().map_err(|_| unknown("rung", &role))?;
        let stage_index: i32 = action.try_get("stage_index")?;
        history.push((
            FlowActionInput {
                action_type: action.try_get("action_type")?,
                stage_index: usize::try_from(stage_index).unwrap_or(usize::MAX),
                details: action.try_get("details")?,
            },
            Actor {
                id: action.try_get("actor")?,
                rung,
            },
        ));
    }
    flow::replay(&mut state, &history).map_err(|error| {
        AppError::Conflict(format!(
            "riwayat {} tidak bisa diputar ulang dengan aturan build ini: {error}",
            row.number
        ))
    })?;
    Ok(state)
}

#[derive(Clone, Debug, Serialize)]
pub struct FlowEndView {
    /// `HO`, `STORE`, `SUPPLIER`, `CUSTOMER`.
    pub kind: String,
    pub site_id: Option<String>,
    pub unit_id: Option<String>,
    pub party_id: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct FlowCountView {
    pub sku_id: Uuid,
    pub quantity: i64,
    pub missing: i64,
    pub reject: i64,
}

#[derive(Clone, Debug, Serialize)]
pub struct FlowStageView {
    pub index: usize,
    pub kind: StageKind,
    pub label: &'static str,
    pub performer: FlowRole,
    pub performer_label: &'static str,
    pub status: StageStatus,
    pub park_reason: Option<String>,
    /// The key a parked stage is resumed by.
    pub idempotency_key: String,
    pub executed_at: flow::ExecutedAt,
    pub skippable: bool,
    pub activated_at: Option<DateTime<Utc>>,
    pub deadline_at: Option<DateTime<Utc>>,
    pub done_by: Option<String>,
    pub done_at: Option<DateTime<Utc>>,
    pub delivery_number: Option<String>,
    pub decision: Option<String>,
    pub note: Option<String>,
    pub proof: Vec<ProofRecord>,
    /// Empty while the plan is hidden and this stage is behind the one due.
    pub counts: Vec<FlowCountView>,
}

#[derive(Clone, Debug, Serialize)]
pub struct FlowDocumentView {
    pub id: Uuid,
    pub document_number: String,
    pub template_id: Uuid,
    pub template_code: String,
    pub template_name: String,
    pub template_version: i32,
    pub origin: FlowEndView,
    pub destination: FlowEndView,
    pub crosses_units: bool,
    /// The allotment, order or delivery this flow runs.
    pub source: FlowSource,
    pub status: FlowStatus,
    pub initiator_role: String,
    pub requested_by: String,
    pub requested_at: DateTime<Utc>,
    pub confirmed_by: Option<String>,
    pub confirmed_at: Option<DateTime<Utc>>,
    pub completed_by: Option<String>,
    pub completed_at: Option<DateTime<Utc>>,
    pub declined_by: Option<String>,
    pub declined_at: Option<DateTime<Utc>>,
    pub declined_reason: Option<String>,
    pub canceled_by: Option<String>,
    pub canceled_at: Option<DateTime<Utc>>,
    pub canceled_reason: Option<String>,
    /// How many actions are applied: what a confirm names as `expected_seq`.
    pub action_seq: i32,
    /// The index of the stage now due.
    pub cursor: Option<usize>,
    /// Whether the planned quantities are being withheld: the stage due is
    /// blind, and the checker never sees the order.
    pub plan_hidden: bool,
    /// What was asked for. `null` while the plan is hidden.
    pub lines: Option<Vec<FlowCountView>>,
    pub stages: Vec<FlowStageView>,
    pub notes: Option<String>,
}

struct StageTimes {
    activated_at: Option<DateTime<Utc>>,
    deadline_at: Option<DateTime<Utc>>,
    done_at: Option<DateTime<Utc>>,
    skipped_at: Option<DateTime<Utc>>,
    idempotency_key: String,
}

async fn load_stage_times(
    connection: &mut PgConnection,
    document_id: Uuid,
) -> Result<BTreeMap<usize, StageTimes>, AppError> {
    let rows = sqlx::query(
        "SELECT stage_index, activated_at, deadline_at, done_at, skipped_at, idempotency_key
           FROM flow_stage_state WHERE document_id = $1",
    )
    .bind(document_id)
    .fetch_all(&mut *connection)
    .await?;
    let mut times = BTreeMap::new();
    for row in &rows {
        let index: i32 = row.try_get("stage_index")?;
        times.insert(
            usize::try_from(index).unwrap_or(usize::MAX),
            StageTimes {
                activated_at: row.try_get("activated_at")?,
                deadline_at: row.try_get("deadline_at")?,
                done_at: row.try_get("done_at")?,
                skipped_at: row.try_get("skipped_at")?,
                idempotency_key: row.try_get("idempotency_key")?,
            },
        );
    }
    Ok(times)
}

fn end_view(
    site_id: &Option<String>,
    unit_id: &Option<String>,
    party_kind: &Option<String>,
    party_id: &Option<String>,
    end: RouteEnd,
) -> FlowEndView {
    FlowEndView {
        kind: party_kind.clone().unwrap_or_else(|| end.code().to_owned()),
        site_id: site_id.clone(),
        unit_id: unit_id.clone(),
        party_id: party_id.clone(),
    }
}

fn counts_view(stage: &StageRuntime) -> Vec<FlowCountView> {
    stage
        .counts
        .iter()
        .map(|(sku_id, count)| FlowCountView {
            sku_id: *sku_id,
            quantity: count.quantity,
            missing: count.missing,
            reject: count.reject,
        })
        .collect()
}

/// A document as a viewer may see it. Head office's administrators see the
/// plan whatever stage is due; anybody else does not while the stage due is
/// blind.
fn document_view(
    row: &DocumentRow,
    state: &FlowState,
    times: &BTreeMap<usize, StageTimes>,
    viewer: &Actor,
) -> FlowDocumentView {
    let cursor = state.cursor();
    let plan_hidden = !state.plan_is_visible() && viewer.rung < Role::Admin;
    let stages = state
        .stages
        .iter()
        .map(|stage| {
            let time = times.get(&stage.index);
            let hide = plan_hidden && cursor.is_some_and(|due| stage.index < due);
            FlowStageView {
                index: stage.index,
                kind: stage.kind(),
                label: stage.kind().spec().label,
                performer: stage.stage.performer,
                performer_label: stage.stage.performer.label(),
                status: stage.status,
                park_reason: stage.park_reason.map(|reason| reason.code().to_owned()),
                idempotency_key: time
                    .map(|time| time.idempotency_key.clone())
                    .unwrap_or_else(|| stage_key(row.id, stage.kind())),
                executed_at: stage.kind().spec().executed_at,
                skippable: stage.stage.skippable,
                activated_at: time.and_then(|time| time.activated_at),
                deadline_at: time.and_then(|time| time.deadline_at),
                done_by: stage.done_by.clone(),
                done_at: time.and_then(|time| time.done_at.or(time.skipped_at)),
                delivery_number: stage.delivery_number.clone(),
                decision: stage.decision.map(|decision| decision.code().to_owned()),
                note: stage.note.clone(),
                proof: stage.proof.clone(),
                counts: if hide { Vec::new() } else { counts_view(stage) },
            }
        })
        .collect();
    FlowDocumentView {
        id: row.id,
        document_number: row.number.clone(),
        template_id: row.template_id,
        template_code: row.template_code.clone(),
        template_name: row.template_name.clone(),
        template_version: row.template_version,
        origin: end_view(
            &row.origin_site_id,
            &row.origin_unit_id,
            &row.origin_party_kind,
            &row.origin_party_id,
            state.header.route.origin,
        ),
        destination: end_view(
            &row.destination_site_id,
            &row.destination_unit_id,
            &row.destination_party_kind,
            &row.destination_party_id,
            state.header.route.destination,
        ),
        crosses_units: row.crosses_units,
        source: state.header.source.clone(),
        status: state.status,
        initiator_role: row.initiator_role.clone(),
        requested_by: row.requested_by.clone(),
        requested_at: row.requested_at,
        confirmed_by: row.confirmed_by.clone(),
        confirmed_at: row.confirmed_at,
        completed_by: row.completed_by.clone(),
        completed_at: row.completed_at,
        declined_by: row.declined_by.clone(),
        declined_at: row.declined_at,
        declined_reason: row.declined_reason.clone(),
        canceled_by: row.canceled_by.clone(),
        canceled_at: row.canceled_at,
        canceled_reason: row.canceled_reason.clone(),
        action_seq: row.action_seq,
        cursor,
        plan_hidden,
        lines: (!plan_hidden).then(|| {
            state
                .header
                .planned
                .iter()
                .map(|(sku_id, quantity)| FlowCountView {
                    sku_id: *sku_id,
                    quantity: *quantity,
                    missing: 0,
                    reject: 0,
                })
                .collect()
        }),
        stages,
        notes: row.notes.clone(),
    }
}

async fn read_document_view(
    connection: &mut PgConnection,
    document_id: Uuid,
    viewer: &Actor,
) -> Result<FlowDocumentView, AppError> {
    let row = load_document(&mut *connection, document_id, false).await?;
    let state = load_state(&mut *connection, &row).await?;
    let times = load_stage_times(&mut *connection, document_id).await?;
    Ok(document_view(&row, &state, &times, viewer))
}

pub async fn flow_document_detail(
    pool: &PgPool,
    document_id: Uuid,
    viewer: &Actor,
) -> Result<FlowDocumentView, AppError> {
    let mut connection = pool.acquire().await?;
    read_document_view(&mut connection, document_id, viewer).await
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FlowDocumentFilter {
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub template: Option<String>,
    /// Documents that leave from or arrive at this site.
    #[serde(default)]
    pub site_id: Option<String>,
    /// Documents that run this source: `?source_kind=ALLOTMENT&source_id=…`.
    #[serde(default)]
    pub source_kind: Option<String>,
    #[serde(default)]
    pub source_id: Option<String>,
    #[serde(default)]
    pub limit: Option<i64>,
}

#[derive(Clone, Debug, Serialize)]
pub struct FlowDocumentSummary {
    pub id: Uuid,
    pub document_number: String,
    pub template_code: String,
    pub template_name: String,
    pub source_kind: String,
    pub source_id: String,
    pub origin_site_id: Option<String>,
    pub origin_party_kind: Option<String>,
    pub destination_site_id: Option<String>,
    pub destination_party_kind: Option<String>,
    pub status: String,
    pub current_stage: Option<String>,
    pub current_stage_status: Option<String>,
    pub deadline_at: Option<DateTime<Utc>>,
    pub requested_by: String,
    pub requested_at: DateTime<Utc>,
}

pub async fn list_flow_documents(
    pool: &PgPool,
    filter: &FlowDocumentFilter,
) -> Result<Vec<FlowDocumentSummary>, AppError> {
    let limit = filter.limit.unwrap_or(100).clamp(1, 500);
    let rows = sqlx::query(
        "SELECT d.id, d.document_number, t.code AS template_code, t.name AS template_name,
                d.source_kind, d.source_id, d.origin_site_id, d.origin_party_kind, d.destination_site_id, d.destination_party_kind,
                d.status, d.requested_by, d.requested_at,
                due.stage_kind AS current_stage, due.status AS current_stage_status, due.deadline_at
           FROM flow_document d
           JOIN flow_template t ON t.id = d.template_id
           LEFT JOIN LATERAL (
                SELECT s.stage_kind, s.status, s.deadline_at
                  FROM flow_stage_state s
                 WHERE s.document_id = d.id AND s.status IN ('PENDING', 'PARKED')
                 ORDER BY s.stage_index
                 LIMIT 1
           ) due ON d.status IN ('REQUESTED', 'CONFIRMED')
          WHERE ($1::text IS NULL OR d.status = $1)
            AND ($2::text IS NULL OR t.code = $2)
            AND ($3::text IS NULL OR d.origin_site_id = $3 OR d.destination_site_id = $3)
            AND ($5::text IS NULL OR d.source_kind = $5)
            AND ($6::text IS NULL OR d.source_id = $6)
          ORDER BY d.requested_at DESC, d.id
          LIMIT $4",
    )
    .bind(filter.status.as_deref())
    .bind(filter.template.as_deref())
    .bind(filter.site_id.as_deref())
    .bind(limit)
    .bind(filter.source_kind.as_deref())
    .bind(filter.source_id.as_deref())
    .fetch_all(pool)
    .await?;
    rows.iter()
        .map(|row| {
            Ok(FlowDocumentSummary {
                id: row.try_get("id")?,
                document_number: row.try_get("document_number")?,
                template_code: row.try_get("template_code")?,
                template_name: row.try_get("template_name")?,
                source_kind: row.try_get("source_kind")?,
                source_id: row.try_get("source_id")?,
                origin_site_id: row.try_get("origin_site_id")?,
                origin_party_kind: row.try_get("origin_party_kind")?,
                destination_site_id: row.try_get("destination_site_id")?,
                destination_party_kind: row.try_get("destination_party_kind")?,
                status: row.try_get("status")?,
                current_stage: row.try_get("current_stage")?,
                current_stage_status: row.try_get("current_stage_status")?,
                deadline_at: row.try_get("deadline_at")?,
                requested_by: row.try_get("requested_by")?,
                requested_at: row.try_get("requested_at")?,
            })
        })
        .collect()
}

// --- documents: preview ------------------------------------------------------------

#[derive(Clone, Debug, Serialize)]
pub struct FlowPreviewView {
    /// The document as the actions would leave it. Nothing was written.
    pub document: FlowDocumentView,
    /// What the actions would do: movements, claims, journal meanings, status.
    pub effects: Vec<Effect>,
}

/// Replay the document and the new actions in memory. Writes nothing.
pub async fn preview_flow_actions(
    pool: &PgPool,
    document_id: Uuid,
    actions: &[FlowActionInput],
    actor: &Actor,
) -> Result<FlowPreviewView, AppError> {
    let mut connection = pool.acquire().await?;
    let row = load_document(&mut connection, document_id, false).await?;
    let state = load_state(&mut connection, &row).await?;
    let times = load_stage_times(&mut connection, document_id).await?;
    flow::single_stage(actions).map_err(flow_error)?;
    let preview = flow::preview(&state, actions, actor).map_err(flow_error)?;
    Ok(FlowPreviewView {
        document: document_view(&row, &preview.state, &times, actor),
        effects: preview.effects,
    })
}

// --- documents: confirm and resume ----------------------------------------------------

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ConfirmFlowRequest {
    pub actions: Vec<FlowActionInput>,
    /// How many actions the caller saw applied (`action_seq`). A confirm made
    /// against an older picture is refused rather than applied on top of
    /// somebody else's.
    #[serde(default)]
    pub expected_seq: Option<i32>,
    pub idempotency_key: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ResumeFlowRequest {
    /// The parked stage's key: `<document>:<STAGE_KIND>`.
    pub stage_key: String,
    /// The actions that finish it. Their `stage_index` is taken from the key.
    pub actions: Vec<FlowActionInput>,
    pub idempotency_key: String,
}

/// Apply actions for one stage and write everything they produced, in the
/// caller's transaction.
pub(super) async fn apply_stage_tx(
    tx: &mut Transaction<'_, Postgres>,
    document_id: Uuid,
    actions: &[FlowActionInput],
    expected_seq: Option<i32>,
    actor: &Actor,
    request_key: &str,
    at: DateTime<Utc>,
) -> Result<Vec<Effect>, AppError> {
    let row = load_document(&mut **tx, document_id, true).await?;
    if let Some(expected) = expected_seq {
        if expected != row.action_seq {
            return Err(AppError::Conflict(format!(
                "{} sudah berubah sejak dibuka ({} aksi, bukan {expected}); muat ulang",
                row.number, row.action_seq
            )));
        }
    }
    let stage_index = flow::single_stage(actions).map_err(flow_error)?;
    let mut state = load_state(&mut **tx, &row).await?;
    let before: Vec<(StageStatus, bool)> = state
        .stages
        .iter()
        .map(|stage| (stage.status, stage.counted))
        .collect();
    let named_kind = state
        .stages
        .get(stage_index)
        .map(StageRuntime::kind)
        .ok_or_else(|| AppError::Validation(format!("tahap #{} tidak ada", stage_index + 1)))?;

    let mut effects = Vec::new();
    for input in actions {
        effects.extend(flow::apply_action(&mut state, input, actor).map_err(flow_error)?);
    }

    // The actions, in order.
    for (offset, input) in actions.iter().enumerate() {
        let details = match &input.details {
            Value::Null => json!({}),
            other => other.clone(),
        };
        sqlx::query(
            "INSERT INTO flow_action
                (id, document_id, seq, stage_index, stage_kind, action_type, details,
                 actor, actor_role, request_key, applied_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)",
        )
        .bind(Uuid::new_v4())
        .bind(document_id)
        .bind(row.action_seq + offset as i32 + 1)
        .bind(stage_index as i32)
        .bind(named_kind.code())
        .bind(input.action_type.trim())
        .bind(details)
        .bind(&actor.id)
        .bind(actor.rung.as_str())
        .bind(request_key)
        .bind(at)
        .execute(&mut **tx)
        .await?;
    }

    // The stages that changed: the one named, and any the actions reopened.
    for stage in &state.stages {
        let (status, counted) = before[stage.index];
        let touched = stage.index == stage_index || status != stage.status || counted != stage.counted;
        if touched {
            write_stage(&mut **tx, document_id, stage, actor, at).await?;
        }
    }
    // The stage now due starts its clock.
    if let Some(due) = state.cursor() {
        let stage = &state.stages[due];
        sqlx::query(
            "UPDATE flow_stage_state
                SET activated_at = $3, deadline_at = $4, updated_at = $3
              WHERE document_id = $1 AND stage_index = $2 AND activated_at IS NULL",
        )
        .bind(document_id)
        .bind(due as i32)
        .bind(at)
        .bind(deadline_from(at, &stage.stage))
        .execute(&mut **tx)
        .await?;
    }

    // What the stage produced.
    for effect in &effects {
        if let Effect::Journal {
            stage_index,
            meaning,
            lines,
            ..
        } = effect
        {
            let to_unit = match meaning {
                flow::JournalMeaning::SupplierReturnHandedOver => None,
                _ => row.destination_unit_id.clone(),
            };
            sqlx::query(
                "INSERT INTO flow_posting
                    (id, document_id, stage_index, meaning, from_unit_id, to_unit_id, lines, created_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
            )
            .bind(Uuid::new_v4())
            .bind(document_id)
            .bind(*stage_index as i32)
            .bind(meaning.code())
            .bind(row.origin_unit_id.as_deref())
            .bind(to_unit.as_deref())
            .bind(serde_json::to_value(lines)?)
            .bind(at)
            .execute(&mut **tx)
            .await?;
        }
        write_event(&mut **tx, &row, effect, at).await?;
    }

    // The document: its status with who and when, and how far it has come.
    let mut confirmed = false;
    let mut completed = false;
    let mut declined: Option<String> = None;
    let mut canceled: Option<String> = None;
    for effect in &effects {
        if let Effect::Status { to, reason, .. } = effect {
            match to {
                FlowStatus::Confirmed => confirmed = true,
                FlowStatus::Completed => completed = true,
                FlowStatus::Declined => declined = reason.clone().or(Some(String::new())),
                FlowStatus::Canceled => canceled = reason.clone().or(Some(String::new())),
                FlowStatus::Requested => {}
            }
        }
    }
    sqlx::query(
        "UPDATE flow_document
            SET status = $2,
                action_seq = action_seq + $3,
                confirmed_by = CASE WHEN $4 THEN $8 ELSE confirmed_by END,
                confirmed_at = CASE WHEN $4 THEN $9 ELSE confirmed_at END,
                completed_by = CASE WHEN $5 THEN $8 ELSE completed_by END,
                completed_at = CASE WHEN $5 THEN $9 ELSE completed_at END,
                declined_by = CASE WHEN $6::text IS NOT NULL THEN $8 ELSE declined_by END,
                declined_at = CASE WHEN $6::text IS NOT NULL THEN $9 ELSE declined_at END,
                declined_reason = COALESCE($6, declined_reason),
                canceled_by = CASE WHEN $7::text IS NOT NULL THEN $8 ELSE canceled_by END,
                canceled_at = CASE WHEN $7::text IS NOT NULL THEN $9 ELSE canceled_at END,
                canceled_reason = COALESCE($7, canceled_reason),
                updated_at = $9
          WHERE id = $1",
    )
    .bind(document_id)
    .bind(state.status.code())
    .bind(actions.len() as i32)
    .bind(confirmed)
    .bind(completed)
    .bind(declined.as_deref())
    .bind(canceled.as_deref())
    .bind(&actor.id)
    .bind(at)
    .execute(&mut **tx)
    .await?;

    // Where the work is actually done: hand the stage to its adapter.
    super::flow_stages::after_stage_tx(tx, &row, &state, stage_index, &effects, actor, at).await?;
    Ok(effects)
}

/// The projection of one stage: its state row and its lines.
async fn write_stage(
    connection: &mut PgConnection,
    document_id: Uuid,
    stage: &StageRuntime,
    actor: &Actor,
    at: DateTime<Utc>,
) -> Result<(), AppError> {
    let status = stage.status.code();
    sqlx::query(
        "UPDATE flow_stage_state
            SET status = $3,
                park_reason = $4,
                parked_by = CASE WHEN $3 = 'PARKED' THEN COALESCE(parked_by, $5) ELSE parked_by END,
                parked_at = CASE WHEN $3 = 'PARKED' THEN COALESCE(parked_at, $6) ELSE parked_at END,
                done_by = CASE WHEN $3 = 'DONE' THEN $7 ELSE NULL END,
                done_at = CASE WHEN $3 = 'DONE' THEN COALESCE(done_at, $6) ELSE NULL END,
                skipped_by = CASE WHEN $3 = 'SKIPPED' THEN $7 ELSE NULL END,
                skipped_at = CASE WHEN $3 = 'SKIPPED' THEN COALESCE(skipped_at, $6) ELSE NULL END,
                skip_reason = CASE WHEN $3 = 'SKIPPED' THEN $8 ELSE NULL END,
                delivery_number = $9,
                decision = $10,
                proof = $11,
                note = $8,
                updated_at = $6
          WHERE document_id = $1 AND stage_index = $2",
    )
    .bind(document_id)
    .bind(stage.index as i32)
    .bind(status)
    .bind(stage.park_reason.map(|reason| reason.code()))
    .bind(&actor.id)
    .bind(at)
    .bind(stage.done_by.as_deref())
    .bind(stage.note.as_deref())
    .bind(stage.delivery_number.as_deref())
    .bind(stage.decision.map(|decision| decision.code()))
    .bind(serde_json::to_value(&stage.proof)?)
    .execute(&mut *connection)
    .await?;

    // A count is replaced, never added to.
    sqlx::query("DELETE FROM flow_stage_line WHERE document_id = $1 AND stage_index = $2")
        .bind(document_id)
        .bind(stage.index as i32)
        .execute(&mut *connection)
        .await?;
    if stage.counted {
        for (sku_id, count) in &stage.counts {
            sqlx::query(
                "INSERT INTO flow_stage_line
                    (document_id, stage_index, sku_id, quantity, missing_quantity, reject_quantity)
                 VALUES ($1, $2, $3, $4, $5, $6)",
            )
            .bind(document_id)
            .bind(stage.index as i32)
            .bind(sku_id)
            .bind(count.quantity)
            .bind(count.missing)
            .bind(count.reject)
            .execute(&mut *connection)
            .await?;
        }
    }
    Ok(())
}

/// One outbox row. The site it concerns is the side the stage happens at.
async fn write_event(
    connection: &mut PgConnection,
    row: &DocumentRow,
    effect: &Effect,
    at: DateTime<Utc>,
) -> Result<(), AppError> {
    let (event_type, stage) = match effect {
        Effect::StageDone { stage, .. } => ("STAGE_DONE", Some(*stage)),
        Effect::StageSkipped { stage, .. } => ("STAGE_SKIPPED", Some(*stage)),
        Effect::StageParked { stage, .. } => ("STAGE_PARKED", Some(*stage)),
        Effect::StageReopened { stage, .. } => ("STAGE_REOPENED", Some(*stage)),
        Effect::Movement { stage, .. } => ("MOVEMENT", Some(*stage)),
        Effect::Claim { stage, .. } => ("CLAIM", Some(*stage)),
        Effect::Journal { stage, .. } => ("JOURNAL", Some(*stage)),
        Effect::Status { .. } => ("STATUS", None),
    };
    let stage_index = match effect {
        Effect::StageDone { stage_index, .. }
        | Effect::StageSkipped { stage_index, .. }
        | Effect::StageParked { stage_index, .. }
        | Effect::StageReopened { stage_index, .. }
        | Effect::Movement { stage_index, .. }
        | Effect::Claim { stage_index, .. }
        | Effect::Journal { stage_index, .. } => Some(*stage_index as i32),
        Effect::Status { .. } => None,
    };
    let (executed_at, target_site) = match stage {
        Some(kind) => {
            let spec = kind.spec();
            let executed = match spec.executed_at {
                flow::ExecutedAt::Node => "NODE",
                flow::ExecutedAt::Hub => "HUB",
            };
            let site = match spec.side {
                StageSide::Origin => row.origin_site_id.clone(),
                StageSide::Destination => row.destination_site_id.clone(),
                StageSide::HeadOffice => None,
            };
            (executed, site)
        }
        None => ("HUB", None),
    };
    sqlx::query(
        "INSERT INTO flow_event (document_id, stage_index, event_type, executed_at, target_site_id, payload, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)",
    )
    .bind(row.id)
    .bind(stage_index)
    .bind(event_type)
    .bind(executed_at)
    .bind(target_site.as_deref())
    .bind(serde_json::to_value(effect)?)
    .bind(at)
    .execute(&mut *connection)
    .await?;
    Ok(())
}

/// Confirm actions for one stage: applied once, written in one transaction.
pub async fn confirm_flow_actions(
    pool: &PgPool,
    document_id: Uuid,
    request: &ConfirmFlowRequest,
    actor: &Actor,
    at: DateTime<Utc>,
) -> Result<Value, AppError> {
    let digest = payload_digest(&(document_id, &request.actions, request.expected_seq))?;
    let mut tx = pool.begin().await?;
    if let Some(response) =
        begin_idempotent(&mut tx, &request.idempotency_key, "FLOW_CONFIRM", &digest).await?
    {
        tx.commit().await?;
        return Ok(response);
    }
    let effects = apply_stage_tx(
        &mut tx,
        document_id,
        &request.actions,
        request.expected_seq,
        actor,
        request.idempotency_key.trim(),
        at,
    )
    .await?;
    let document = read_document_view(&mut tx, document_id, actor).await?;
    let response = json!({ "document": document, "effects": effects });
    complete_idempotent(&mut tx, &request.idempotency_key, &response).await?;
    tx.commit().await?;
    Ok(response)
}

/// Resume a parked stage by its key, inside the caller's transaction. A stage
/// already done or skipped is answered as it stands: twice is once.
///
/// This is the door a node's fact comes through (`flow_stages`): a pick, a
/// pack, a departure or a receipt a node wrote in its own transaction resumes
/// the stage that was waiting for it.
pub async fn resume_parked_stage_tx(
    tx: &mut Transaction<'_, Postgres>,
    stage_key: &str,
    actions: &[FlowActionInput],
    actor: &Actor,
    request_key: &str,
    at: DateTime<Utc>,
) -> Result<(Uuid, Vec<Effect>), AppError> {
    let row = sqlx::query(
        "SELECT document_id, stage_index, status FROM flow_stage_state
          WHERE idempotency_key = $1 FOR UPDATE",
    )
    .bind(stage_key.trim())
    .fetch_optional(&mut **tx)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("tahap {stage_key}")))?;
    let document_id: Uuid = row.try_get("document_id")?;
    let stage_index: i32 = row.try_get("stage_index")?;
    let status: String = row.try_get("status")?;
    match status.as_str() {
        "DONE" | "SKIPPED" => return Ok((document_id, Vec::new())),
        "PARKED" => {}
        _ => {
            return Err(AppError::Conflict(format!(
                "tahap {stage_key} tidak sedang menunggu; kerjakan lewat konfirmasi"
            )))
        }
    }
    let stage_index = usize::try_from(stage_index).unwrap_or(usize::MAX);
    let actions: Vec<FlowActionInput> = actions
        .iter()
        .cloned()
        .map(|mut action| {
            action.stage_index = stage_index;
            action
        })
        .collect();
    let effects =
        apply_stage_tx(tx, document_id, &actions, None, actor, request_key, at).await?;
    Ok((document_id, effects))
}

pub async fn resume_parked_stage(
    pool: &PgPool,
    request: &ResumeFlowRequest,
    actor: &Actor,
    at: DateTime<Utc>,
) -> Result<Value, AppError> {
    let digest = payload_digest(&(&request.stage_key, &request.actions))?;
    let mut tx = pool.begin().await?;
    if let Some(response) =
        begin_idempotent(&mut tx, &request.idempotency_key, "FLOW_RESUME", &digest).await?
    {
        tx.commit().await?;
        return Ok(response);
    }
    let (document_id, effects) = resume_parked_stage_tx(
        &mut tx,
        &request.stage_key,
        &request.actions,
        actor,
        request.idempotency_key.trim(),
        at,
    )
    .await?;
    let document = read_document_view(&mut tx, document_id, actor).await?;
    let response = json!({ "document": document, "effects": effects });
    complete_idempotent(&mut tx, &request.idempotency_key, &response).await?;
    tx.commit().await?;
    Ok(response)
}

// --- the creation paths' adapters ---------------------------------------------------

/// Start one flow per destination of an allotment, inside the allotment's
/// own transaction.
///
/// The allotment is the plan; each flow document runs it to one destination
/// (an allotment is one source and many destinations, a document runs
/// between two ends). Every document names the allotment as its source, and
/// the unique index on live sources keeps one per destination. The route
/// comes from the sites' rows and the destination type, never from the
/// allotment type's name — so MD's allotment to a store, a store-to-store
/// transfer, a return to the Gudang and a return to a supplier all come
/// through here.
///
/// NOT YET CALLED: `postgres::allotments::create_allotment` is being
/// generalised on another lane; the call belongs right after its lines are
/// inserted, with the MD's actor and `FlowRole::HoMd`.
pub async fn start_flow_for_allotment_tx(
    tx: &mut Transaction<'_, Postgres>,
    allotment_id: Uuid,
    lines: &[(String, DestinationType, String, Uuid, i64)],
    actor: &Actor,
    as_role: FlowRole,
    at: DateTime<Utc>,
) -> Result<Vec<Uuid>, AppError> {
    let head_office = super::sites::head_office_site_id(&mut **tx).await?;
    let mut by_destination: BTreeMap<(String, String), (FlowEndInput, FlowEndInput, BTreeMap<Uuid, i64>)> =
        BTreeMap::new();
    for (source_site_id, destination_type, destination_id, sku_id, quantity) in lines {
        let destination = match destination_type {
            DestinationType::Store => FlowEndInput::site(destination_id.clone()),
            // The Gudang is head office's site, read from data.
            DestinationType::Dc => FlowEndInput::site(head_office.clone()),
            DestinationType::Supplier => {
                FlowEndInput::party(PartyKind::Supplier, destination_id.clone())
            }
        };
        let entry = by_destination
            .entry((source_site_id.clone(), destination_id.clone()))
            .or_insert_with(|| {
                (
                    FlowEndInput::site(source_site_id.clone()),
                    destination,
                    BTreeMap::new(),
                )
            });
        *entry.2.entry(*sku_id).or_insert(0) += *quantity;
    }
    let mut documents = Vec::with_capacity(by_destination.len());
    for ((_, destination_id), (origin, destination, planned)) in by_destination {
        let request = StartFlowRequest {
            template_code: None,
            origin,
            destination,
            as_role,
            lines: planned
                .into_iter()
                .map(|(sku_id, quantity)| FlowLineInput { sku_id, quantity })
                .collect(),
            source: FlowSource {
                kind: SourceKind::Allotment,
                id: allotment_id.to_string(),
            },
            notes: None,
            idempotency_key: format!("flow:allotment:{allotment_id}:{destination_id}"),
        };
        documents.push(start_flow_document_tx(tx, &request, actor, at).await?);
    }
    Ok(documents)
}

/// Start the receiving flow for a purchase order delivered to a site, inside
/// the order's transaction. The route is supplier → the site, which 0615 and
/// 0616 both refuse unless the site is head office's.
///
/// NOT YET CALLED: the purchase-order activation path should call it with the
/// buyer's actor and `FlowRole::HoBuyer`.
pub async fn start_flow_for_purchase_order_tx(
    tx: &mut Transaction<'_, Postgres>,
    purchase_order_id: Uuid,
    site_id: &str,
    supplier_id: &str,
    lines: &[(Uuid, i64)],
    actor: &Actor,
    at: DateTime<Utc>,
) -> Result<Uuid, AppError> {
    let mut planned: BTreeMap<Uuid, i64> = BTreeMap::new();
    for (sku_id, quantity) in lines {
        *planned.entry(*sku_id).or_insert(0) += *quantity;
    }
    let request = StartFlowRequest {
        template_code: None,
        origin: FlowEndInput::party(PartyKind::Supplier, supplier_id),
        destination: FlowEndInput::site(site_id),
        as_role: FlowRole::HoBuyer,
        lines: planned
            .into_iter()
            .map(|(sku_id, quantity)| FlowLineInput { sku_id, quantity })
            .collect(),
        source: FlowSource {
            kind: SourceKind::PurchaseOrder,
            id: purchase_order_id.to_string(),
        },
        notes: None,
        idempotency_key: format!("flow:purchase-order:{purchase_order_id}"),
    };
    start_flow_document_tx(tx, &request, actor, at).await
}

/// The live flow a source runs under towards one destination, if any: what a
/// node fact names when it resumes a stage
/// (`flow_stages::resume_from_node_fact_tx`). `destination_site_id` may be
/// absent when the source has one destination only (an order, a return to a
/// supplier).
pub async fn live_flow_for_source_tx(
    tx: &mut Transaction<'_, Postgres>,
    source: &FlowSource,
    destination_site_id: Option<&str>,
) -> Result<Option<Uuid>, AppError> {
    let found: Vec<Uuid> = sqlx::query_scalar(
        "SELECT id FROM flow_document
          WHERE source_kind = $1 AND source_id = $2
            AND ($3::text IS NULL OR destination_site_id = $3)
            AND status NOT IN ('DECLINED', 'CANCELED')
          ORDER BY requested_at",
    )
    .bind(source.kind.code())
    .bind(&source.id)
    .bind(destination_site_id)
    .fetch_all(&mut **tx)
    .await?;
    match found.as_slice() {
        [] => Ok(None),
        [one] => Ok(Some(*one)),
        _ => Err(AppError::Conflict(format!(
            "{} {} berjalan ke beberapa tujuan; sebut tujuannya",
            source.kind.code(),
            source.id
        ))),
    }
}

/// Every effect line's quantities, summed per SKU. For an adapter that has to
/// tell a node how many of each to move.
pub fn effect_quantities(lines: &[EffectLine]) -> BTreeMap<Uuid, i64> {
    let mut total = BTreeMap::new();
    for line in lines {
        *total.entry(line.sku_id).or_insert(0) += line.quantity;
    }
    total
}

/// The SKUs a set of effects names, for a caller that needs to lock them.
pub fn effect_skus(effects: &[Effect]) -> BTreeSet<Uuid> {
    effects
        .iter()
        .flat_map(|effect| match effect {
            Effect::Movement { lines, .. }
            | Effect::Claim { lines, .. }
            | Effect::Journal { lines, .. } => lines.iter().map(|line| line.sku_id).collect(),
            _ => Vec::new(),
        })
        .collect()
}
