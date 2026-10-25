//! Projects, GA's half (0997): a store opening or a renovation.
//!
//! # What GA keeps here
//!
//! The tasks counted back from the opening day, the assets registered for the
//! new place, and the contracts, repairs and supply requests the opening asks
//! for. None of it carries money: what each of those costs is Finance's, read
//! on Finance's side of the same project (`postgres/project_costs.rs`).
//!
//! # One row, two desks
//!
//! A project is a `contractor_project` row (0720, grown in 0997). GA opens it,
//! runs it and closes it (`READY`: the place is ready). Finance capitalises it
//! afterwards (`CAPITALISED`). A contractor project of 0720's own kind is
//! Finance's alone and never listed here.
//!
//! # A record joins by its own column
//!
//! An asset, a contract, a repair or a supply request names its project in a
//! `project_id` of its own. It is created the ordinary way, by its own form,
//! and then linked: the forms do not learn about projects, and a record that
//! started outside a project can be brought in.

use chrono::{DateTime, Duration, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Row};
use uuid::Uuid;

use crate::cloud::application::AppError;

/// A project as GA lists it.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct GaProjectRow {
    pub project_id: Uuid,
    pub project_number: String,
    pub name: String,
    /// `STORE_OPENING` or `RENOVATION`.
    pub kind: String,
    pub site_id: Option<String>,
    pub site_name: Option<String>,
    pub unit_id: String,
    /// The day the store opens, or the renovation is due.
    pub opens_on: Option<NaiveDate>,
    /// The person in charge, by login.
    pub pic: Option<String>,
    /// `OPEN`, `READY` (GA closed it) or `CAPITALISED` (Finance placed the cost).
    pub status: String,
    pub ready_on: Option<NaiveDate>,
    pub ready_by: Option<String>,
    pub capitalised_on: Option<NaiveDate>,
    pub opened_at: DateTime<Utc>,
    pub tasks: i64,
    pub tasks_left: i64,
    /// Not done, and due before today.
    pub tasks_late: i64,
    pub assets: i64,
    pub work: i64,
}

/// One to-do of a project.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct GaProjectTask {
    pub task_id: Uuid,
    pub name: String,
    /// The department that does it, by section code: `ga`, `stores`, `people`,
    /// `merchandise`, `marketing` or `finance`.
    pub department: String,
    pub pic: Option<String>,
    pub due_on: NaiveDate,
    pub milestone: bool,
    pub from_template: bool,
    pub done_on: Option<NaiveDate>,
    pub done_by: Option<String>,
}

/// An asset registered for the project.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct GaProjectAsset {
    pub asset_id: Uuid,
    pub asset_number: String,
    pub name: String,
    pub class_code: String,
    pub class_name: String,
    /// The class's build (0356), which the register draws its icon from.
    pub build: String,
    pub quantity: i32,
    /// The register's status: `IN_PROGRESS` while the project runs.
    pub status: String,
}

/// A contract, repair or supply request done for the project.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct GaProjectWork {
    /// `CONTRACT`, `REPAIR` or `SUPPLY_REQUEST`.
    pub kind: String,
    pub record_id: Uuid,
    pub number: Option<String>,
    pub name: String,
    /// The supplier, or who asked.
    pub party: Option<String>,
    pub status: String,
    pub dated: Option<NaiveDate>,
}

/// Everything the project's page draws.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct GaProjectPage {
    pub project: GaProjectRow,
    pub tasks: Vec<GaProjectTask>,
    pub assets: Vec<GaProjectAsset>,
    pub work: Vec<GaProjectWork>,
}

/// Open a project. Its tasks come from the template of its kind.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
#[cfg_attr(feature = "ts", ts(optional_fields = nullable))]
pub struct CreateGaProjectRequest {
    pub name: String,
    /// `STORE_OPENING` or `RENOVATION`.
    pub kind: String,
    pub site_id: String,
    pub opens_on: NaiveDate,
    #[serde(default)]
    pub pic: Option<String>,
    #[serde(default)]
    pub note: Option<String>,
}

/// Add a task by hand.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
#[cfg_attr(feature = "ts", ts(optional_fields = nullable))]
pub struct AddGaProjectTaskRequest {
    pub name: String,
    pub department: String,
    #[serde(default)]
    pub pic: Option<String>,
    pub due_on: NaiveDate,
    #[serde(default)]
    pub milestone: Option<bool>,
}

/// Change a task: tick it, untick it, name its PIC or move its day. Only what
/// is sent changes.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
#[cfg_attr(feature = "ts", ts(optional_fields = nullable))]
pub struct UpdateGaProjectTaskRequest {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub pic: Option<String>,
    #[serde(default)]
    pub due_on: Option<NaiveDate>,
    #[serde(default)]
    pub done: Option<bool>,
}

/// GA's close: the work is done and the place is ready.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CloseGaProjectRequest {
    pub ready_on: NaiveDate,
}

/// Bring a record into the project, or take it out.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
#[cfg_attr(feature = "ts", ts(optional_fields = nullable))]
pub struct LinkGaProjectRequest {
    /// `ASSET`, `CONTRACT`, `REPAIR` or `SUPPLY_REQUEST`.
    pub kind: String,
    pub record_id: Uuid,
    /// True takes it out again.
    #[serde(default)]
    pub unlink: Option<bool>,
}

const DEPARTMENTS: [&str; 6] = [
    "ga",
    "stores",
    "people",
    "merchandise",
    "marketing",
    "finance",
];

const ROWS: &str = "
    SELECT p.project_id, p.project_number, p.name, p.kind, p.site_id, s.name AS site_name,
           p.unit_id, p.opens_on, p.pic, p.status, p.ready_on, p.ready_by, p.closed_on,
           p.opened_at,
           COALESCE(t.n, 0)::bigint AS tasks,
           COALESCE(t.left_n, 0)::bigint AS tasks_left,
           COALESCE(t.late_n, 0)::bigint AS tasks_late,
           (SELECT COUNT(*) FROM fixed_asset a WHERE a.project_id = p.project_id)::bigint AS assets,
           ((SELECT COUNT(*) FROM ga_contract c WHERE c.project_id = p.project_id)
            + (SELECT COUNT(*) FROM ga_repair r WHERE r.project_id = p.project_id)
            + (SELECT COUNT(*) FROM ga_supply_request q WHERE q.project_id = p.project_id))::bigint
             AS work
      FROM contractor_project p
      LEFT JOIN site s ON s.id = p.site_id
      LEFT JOIN (SELECT project_id, COUNT(*) n,
                        COUNT(*) FILTER (WHERE done_on IS NULL) left_n,
                        COUNT(*) FILTER (WHERE done_on IS NULL AND due_on < $1) late_n
                   FROM project_task GROUP BY project_id) t
             ON t.project_id = p.project_id";

fn to_row(row: &sqlx::postgres::PgRow) -> Result<GaProjectRow, AppError> {
    Ok(GaProjectRow {
        project_id: row.try_get("project_id")?,
        project_number: row.try_get("project_number")?,
        name: row.try_get("name")?,
        kind: row.try_get("kind")?,
        site_id: row.try_get("site_id")?,
        site_name: row.try_get("site_name")?,
        unit_id: row.try_get("unit_id")?,
        opens_on: row.try_get("opens_on")?,
        pic: row.try_get("pic")?,
        status: row.try_get("status")?,
        ready_on: row.try_get("ready_on")?,
        ready_by: row.try_get("ready_by")?,
        capitalised_on: row.try_get("closed_on")?,
        opened_at: row.try_get("opened_at")?,
        tasks: row.try_get("tasks")?,
        tasks_left: row.try_get("tasks_left")?,
        tasks_late: row.try_get("tasks_late")?,
        assets: row.try_get("assets")?,
        work: row.try_get("work")?,
    })
}

fn trimmed(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_owned)
}

/// GA's projects: open ones first, then by the day they open. `site` narrows
/// to one place (a caller bound to a site sees only its own).
pub async fn ga_projects(
    pool: &PgPool,
    today: NaiveDate,
    site: Option<&str>,
) -> Result<Vec<GaProjectRow>, AppError> {
    let rows = sqlx::query(&format!(
        "{ROWS}
          WHERE p.kind <> 'CONTRACTOR' AND ($2::text IS NULL OR p.site_id = $2)
          ORDER BY (p.status = 'OPEN') DESC, p.opens_on NULLS LAST, p.opened_at DESC"
    ))
    .bind(today)
    .bind(site)
    .fetch_all(pool)
    .await?;
    rows.iter().map(to_row).collect()
}

async fn ga_project_row(
    pool: &PgPool,
    project_id: Uuid,
    today: NaiveDate,
) -> Result<GaProjectRow, AppError> {
    let row = sqlx::query(&format!("{ROWS} WHERE p.project_id = $2"))
        .bind(today)
        .bind(project_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound("project".into()))?;
    to_row(&row)
}

/// Where a project is, for the caller's site check. A contractor project
/// names no site.
pub async fn ga_project_site(pool: &PgPool, project_id: Uuid) -> Result<Option<String>, AppError> {
    sqlx::query_scalar("SELECT site_id FROM contractor_project WHERE project_id = $1")
        .bind(project_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound("project".into()))
}

/// The project, its tasks by day, its assets and its work.
pub async fn ga_project_page(
    pool: &PgPool,
    project_id: Uuid,
    today: NaiveDate,
) -> Result<GaProjectPage, AppError> {
    let project = ga_project_row(pool, project_id, today).await?;
    let tasks = sqlx::query(
        "SELECT task_id, name, department, pic, due_on, milestone, from_template, done_on, done_by
           FROM project_task WHERE project_id = $1
          ORDER BY due_on, created_at",
    )
    .bind(project_id)
    .fetch_all(pool)
    .await?
    .iter()
    .map(|row| {
        Ok(GaProjectTask {
            task_id: row.try_get("task_id")?,
            name: row.try_get("name")?,
            department: row.try_get("department")?,
            pic: row.try_get("pic")?,
            due_on: row.try_get("due_on")?,
            milestone: row.try_get("milestone")?,
            from_template: row.try_get("from_template")?,
            done_on: row.try_get("done_on")?,
            done_by: row.try_get("done_by")?,
        })
    })
    .collect::<Result<Vec<_>, AppError>>()?;
    let assets = sqlx::query(
        "SELECT a.asset_id, a.asset_number, a.name, a.category_code, c.name AS class_name,
                c.build, a.quantity, a.status
           FROM fixed_asset a JOIN asset_class c ON c.class_code = a.category_code
          WHERE a.project_id = $1
          ORDER BY a.registered_at, a.asset_number",
    )
    .bind(project_id)
    .fetch_all(pool)
    .await?
    .iter()
    .map(|row| {
        Ok(GaProjectAsset {
            asset_id: row.try_get("asset_id")?,
            asset_number: row.try_get("asset_number")?,
            name: row.try_get("name")?,
            class_code: row.try_get("category_code")?,
            class_name: row.try_get("class_name")?,
            build: row.try_get("build")?,
            quantity: row.try_get("quantity")?,
            status: row.try_get("status")?,
        })
    })
    .collect::<Result<Vec<_>, AppError>>()?;
    let work = sqlx::query(
        "SELECT 'CONTRACT' AS kind, c.contract_id AS record_id, c.contract_number AS number,
                COALESCE(c.objek, c.contract_type) AS name,
                COALESCE(c.counterparty_name, s.name) AS party, c.status,
                c.starts_on AS dated, c.created_at
           FROM ga_contract c LEFT JOIN supplier s ON s.supplier_id = c.supplier_id
          WHERE c.project_id = $1
         UNION ALL
         SELECT 'REPAIR', r.repair_id, r.repair_number, COALESCE(r.title, r.objek), s.name, r.status,
                r.failure_at, r.created_at
           FROM ga_repair r LEFT JOIN supplier s ON s.supplier_id = r.supplier_id
          WHERE r.project_id = $1
         UNION ALL
         SELECT 'SUPPLY_REQUEST', q.request_id, q.request_number, COALESCE(q.item, ''), q.requested_by,
                q.status, q.needed_by, q.created_at
           FROM ga_supply_request q
          WHERE q.project_id = $1
          ORDER BY created_at",
    )
    .bind(project_id)
    .fetch_all(pool)
    .await?
    .iter()
    .map(|row| {
        Ok(GaProjectWork {
            kind: row.try_get("kind")?,
            record_id: row.try_get("record_id")?,
            number: row.try_get("number")?,
            name: row.try_get("name")?,
            party: row.try_get("party")?,
            status: row.try_get("status")?,
            dated: row.try_get("dated")?,
        })
    })
    .collect::<Result<Vec<_>, AppError>>()?;
    Ok(GaProjectPage {
        project,
        tasks,
        assets,
        work,
    })
}

/// Open a project at a place, with the tasks of its kind's template counted
/// back from the opening day. A template line for GA goes to the project's
/// PIC; the other departments' lines wait for a name.
pub async fn ga_project_create(
    pool: &PgPool,
    request: &CreateGaProjectRequest,
    actor: &str,
    today: NaiveDate,
) -> Result<GaProjectPage, AppError> {
    let name = request.name.trim();
    if name.is_empty() {
        return Err(AppError::Validation("a project needs a name".into()));
    }
    let kind = request.kind.trim();
    if !matches!(kind, "STORE_OPENING" | "RENOVATION") {
        return Err(AppError::Validation(format!(
            "a project is a STORE_OPENING or a RENOVATION, not {kind}"
        )));
    }
    let unit: Option<String> =
        sqlx::query_scalar::<_, Option<String>>("SELECT unit_of_site($1) FROM site WHERE id = $1")
            .bind(request.site_id.trim())
            .fetch_optional(pool)
            .await?
            .flatten();
    let unit = unit.ok_or_else(|| {
        AppError::Validation(format!(
            "there is no site {} to open a project at",
            request.site_id
        ))
    })?;
    let pic = trimmed(request.pic.as_deref());

    let mut tx = pool.begin().await?;
    let serial: i64 = sqlx::query_scalar("SELECT nextval('contractor_project_serial')")
        .fetch_one(&mut *tx)
        .await?;
    let project_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO contractor_project
            (project_id, project_number, name, supplier_id, unit_id, note, opened_by,
             kind, site_id, opens_on, pic, template_code)
         VALUES ($1, $2, $3, NULL, $4, $5, $6, $7, $8, $9, $10, $7)",
    )
    .bind(project_id)
    .bind(format!("PRJ-{}-{serial:03}", today.format("%Y")))
    .bind(name)
    .bind(&unit)
    .bind(trimmed(request.note.as_deref()))
    .bind(actor)
    .bind(kind)
    .bind(request.site_id.trim())
    .bind(request.opens_on)
    .bind(&pic)
    .execute(&mut *tx)
    .await?;

    let lines = sqlx::query(
        "SELECT name, department, days_before, milestone FROM project_task_template_line
          WHERE template_code = $1 ORDER BY line_number",
    )
    .bind(kind)
    .fetch_all(&mut *tx)
    .await?;
    for line in &lines {
        let department: String = line.try_get("department")?;
        let days_before: i32 = line.try_get("days_before")?;
        let task_pic = if department == "ga" {
            pic.clone()
        } else {
            None
        };
        sqlx::query(
            "INSERT INTO project_task
                (task_id, project_id, name, department, pic, due_on, milestone, from_template,
                 created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, true, $8)",
        )
        .bind(Uuid::new_v4())
        .bind(project_id)
        .bind(line.try_get::<String, _>("name")?)
        .bind(&department)
        .bind(&task_pic)
        .bind(request.opens_on - Duration::days(i64::from(days_before)))
        .bind(line.try_get::<bool, _>("milestone")?)
        .bind(actor)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    ga_project_page(pool, project_id, today).await
}

async fn status_of(pool: &PgPool, project_id: Uuid) -> Result<String, AppError> {
    sqlx::query_scalar("SELECT status FROM contractor_project WHERE project_id = $1")
        .bind(project_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound("project".into()))
}

/// GA works in a project until it closes it.
async fn still_open(pool: &PgPool, project_id: Uuid) -> Result<(), AppError> {
    if status_of(pool, project_id).await? != "OPEN" {
        return Err(AppError::Conflict(
            "the project is closed; its tasks and records stay as they were".into(),
        ));
    }
    Ok(())
}

fn department_of(raw: &str) -> Result<String, AppError> {
    let department = raw.trim().to_lowercase();
    if DEPARTMENTS.contains(&department.as_str()) {
        Ok(department)
    } else {
        Err(AppError::Validation(format!(
            "{raw} is not a department; expected one of {}",
            DEPARTMENTS.join(", ")
        )))
    }
}

pub async fn ga_project_add_task(
    pool: &PgPool,
    project_id: Uuid,
    request: &AddGaProjectTaskRequest,
    actor: &str,
    today: NaiveDate,
) -> Result<GaProjectPage, AppError> {
    still_open(pool, project_id).await?;
    let name = request.name.trim();
    if name.is_empty() {
        return Err(AppError::Validation("a task needs a name".into()));
    }
    let department = department_of(&request.department)?;
    sqlx::query(
        "INSERT INTO project_task
            (task_id, project_id, name, department, pic, due_on, milestone, from_template,
             created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, false, $8)",
    )
    .bind(Uuid::new_v4())
    .bind(project_id)
    .bind(name)
    .bind(department)
    .bind(trimmed(request.pic.as_deref()))
    .bind(request.due_on)
    .bind(request.milestone.unwrap_or(false))
    .bind(actor)
    .execute(pool)
    .await?;
    ga_project_page(pool, project_id, today).await
}

pub async fn ga_project_update_task(
    pool: &PgPool,
    project_id: Uuid,
    task_id: Uuid,
    request: &UpdateGaProjectTaskRequest,
    actor: &str,
    today: NaiveDate,
) -> Result<GaProjectPage, AppError> {
    still_open(pool, project_id).await?;
    if let Some(name) = request.name.as_deref() {
        if name.trim().is_empty() {
            return Err(AppError::Validation("a task needs a name".into()));
        }
    }
    // Done is today, by the caller; not done clears both.
    let (done_on, done_by) = match request.done {
        Some(true) => (Some(today), Some(actor.to_owned())),
        _ => (None, None),
    };
    let updated = sqlx::query(
        "UPDATE project_task
            SET name = COALESCE($3, name),
                pic = CASE WHEN $4::text IS NULL THEN pic ELSE NULLIF(btrim($4), '') END,
                due_on = COALESCE($5, due_on),
                done_on = CASE WHEN $6::boolean IS NULL THEN done_on ELSE $7 END,
                done_by = CASE WHEN $6::boolean IS NULL THEN done_by ELSE $8 END,
                updated_at = now(), version = version + 1
          WHERE project_id = $1 AND task_id = $2",
    )
    .bind(project_id)
    .bind(task_id)
    .bind(request.name.as_deref().map(str::trim))
    .bind(request.pic.as_deref())
    .bind(request.due_on)
    .bind(request.done)
    .bind(done_on)
    .bind(done_by)
    .execute(pool)
    .await?;
    if updated.rows_affected() == 0 {
        return Err(AppError::NotFound("task".into()));
    }
    ga_project_page(pool, project_id, today).await
}

/// GA's close: the place is ready. Tasks still open stay open; the dialog
/// that asks for this lists them, and closing anyway is GA's call.
pub async fn ga_project_close(
    pool: &PgPool,
    project_id: Uuid,
    request: &CloseGaProjectRequest,
    actor: &str,
    today: NaiveDate,
) -> Result<GaProjectPage, AppError> {
    still_open(pool, project_id).await?;
    sqlx::query(
        "UPDATE contractor_project
            SET status = 'READY', ready_on = $2, ready_by = $3, ready_at = now(),
                version = version + 1
          WHERE project_id = $1 AND status = 'OPEN'",
    )
    .bind(project_id)
    .bind(request.ready_on)
    .bind(actor)
    .execute(pool)
    .await?;
    ga_project_page(pool, project_id, today).await
}

/// Bring a record into the project or take it out.
///
/// An asset joins as work in progress (`IN_PROGRESS`, "In project" on the
/// screen) and has to stand at the project's place; one Finance has already
/// assessed is a finished asset and cannot become part of a project's cost.
/// Taking it out puts it back to `REGISTERED`.
pub async fn ga_project_link(
    pool: &PgPool,
    project_id: Uuid,
    request: &LinkGaProjectRequest,
    today: NaiveDate,
) -> Result<GaProjectPage, AppError> {
    if status_of(pool, project_id).await? == "CAPITALISED" {
        return Err(AppError::Conflict(
            "the project's cost has been capitalised; what belongs to it is settled".into(),
        ));
    }
    let unlink = request.unlink.unwrap_or(false);
    let target = if unlink { None } else { Some(project_id) };
    let kind = request.kind.trim();
    let affected = match kind {
        "ASSET" => {
            let standing = sqlx::query(
                "SELECT a.site_id, a.project_id,
                        EXISTS (SELECT 1 FROM asset_capitalization x WHERE x.asset_id = a.asset_id)
                          AS assessed
                   FROM fixed_asset a WHERE a.asset_id = $1",
            )
            .bind(request.record_id)
            .fetch_optional(pool)
            .await?
            .ok_or_else(|| AppError::NotFound("asset".into()))?;
            let assessed: bool = standing.try_get("assessed")?;
            if !unlink {
                if assessed {
                    return Err(AppError::Conflict(
                        "Finance has already assessed this asset; a finished asset cannot join a \
                         project"
                            .into(),
                    ));
                }
                let site: String = standing.try_get("site_id")?;
                let project_site = ga_project_site(pool, project_id).await?;
                if project_site.as_deref() != Some(site.as_str()) {
                    return Err(AppError::Validation(
                        "the asset stands at another place; move it to the project's site first"
                            .into(),
                    ));
                }
            }
            sqlx::query(
                "UPDATE fixed_asset
                    SET project_id = $2,
                        status = CASE
                          WHEN $2::uuid IS NOT NULL AND status IN ('DRAFT', 'REGISTERED')
                            THEN 'IN_PROGRESS'
                          WHEN $2::uuid IS NULL AND status = 'IN_PROGRESS' THEN 'REGISTERED'
                          ELSE status END
                  WHERE asset_id = $1 AND ($2::uuid IS NOT NULL OR project_id = $3)",
            )
            .bind(request.record_id)
            .bind(target)
            .bind(project_id)
            .execute(pool)
            .await?
            .rows_affected()
        }
        "CONTRACT" | "REPAIR" | "SUPPLY_REQUEST" => {
            let (table, key) = match kind {
                "CONTRACT" => ("ga_contract", "contract_id"),
                "REPAIR" => ("ga_repair", "repair_id"),
                _ => ("ga_supply_request", "request_id"),
            };
            sqlx::query(&format!(
                "UPDATE {table} SET project_id = $2
                  WHERE {key} = $1 AND ($2::uuid IS NOT NULL OR project_id = $3)"
            ))
            .bind(request.record_id)
            .bind(target)
            .bind(project_id)
            .execute(pool)
            .await?
            .rows_affected()
        }
        other => {
            return Err(AppError::Validation(format!(
                "a project holds an ASSET, a CONTRACT, a REPAIR or a SUPPLY_REQUEST, not {other}"
            )))
        }
    };
    if affected == 0 {
        return Err(AppError::NotFound(format!(
            "{} in this project",
            kind.to_lowercase()
        )));
    }
    ga_project_page(pool, project_id, today).await
}
