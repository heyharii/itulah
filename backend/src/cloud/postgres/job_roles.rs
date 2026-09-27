//! Job roles as data (0633): read, edited by an Admin, and — for a role
//! nobody seeded — created and deleted.
//!
//! What a role grants is read on every request (`authenticate_session` joins
//! it), so a change to its sections or flow roles holds from the next click.
//! A change to its rung moves every holder's `app_user.role` in the same
//! statement (the trigger in 0633). A change to its rung or its server reach
//! also changes who signs in at which server, so those two re-derive the
//! assignments and tell the servers whose lists changed (0635).

use crate::cloud::application::AppError;
use crate::cloud::domain::flow::FlowRole;
use crate::cloud::domain::job_role::{self, NODE_REACH, SECTIONS};
use crate::contract::Role as WireRole;
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Row};

/// One job role, as `GET /api/v1/roles` lists it.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct JobRole {
    pub code: String,
    pub name: String,
    /// The rung everybody holding this role stands on.
    pub rung: WireRole,
    /// The flow stages this role may perform (`FlowRole` codes). OWNER and
    /// ADMIN pass every stage whatever is listed.
    pub flow_roles: Vec<String>,
    /// The hub sections this role may use. OWNER and ADMIN hold every one.
    pub sections: Vec<String>,
    /// GET only, and only in its sections: the auditor's.
    pub read_only: bool,
    /// Which servers holders sign in at: `NONE`, `UNIT` (the servers of the
    /// unit they are posted to) or `EVERY`.
    pub node_reach: String,
    pub description: String,
    /// Seeded by a migration: editable, never deleted.
    pub builtin: bool,
    /// How many logins hold it.
    pub holders: i64,
}

/// `{items}`, like every other list the hub reads whole.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct JobRoleList {
    pub items: Vec<JobRole>,
}

/// `PUT /api/v1/roles/{code}`: every field optional. For a code that does not
/// exist yet this creates the role, and `name` and `rung` are then required.
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
#[serde(deny_unknown_fields)]
pub struct JobRolePatch {
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub name: Option<String>,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub rung: Option<WireRole>,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub flow_roles: Option<Vec<String>>,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub sections: Option<Vec<String>>,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub description: Option<String>,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub read_only: Option<bool>,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub node_reach: Option<String>,
}

const ROLE_COLUMNS: &str = "r.code, r.name, r.rung, r.flow_roles, r.sections, r.read_only,
       r.node_reach, r.description, r.builtin,
       (SELECT count(*) FROM app_user u WHERE u.role_code = r.code)::bigint AS holders";

fn rung_of(stored: &str) -> Result<WireRole, AppError> {
    stored
        .parse::<crate::cloud::domain::Role>()
        .map(WireRole::from)
        .map_err(|error| AppError::Configuration(error.to_string()))
}

fn to_role(row: &sqlx::postgres::PgRow) -> Result<JobRole, AppError> {
    Ok(JobRole {
        code: row.try_get("code")?,
        name: row.try_get("name")?,
        rung: rung_of(&row.try_get::<String, _>("rung")?)?,
        flow_roles: row.try_get("flow_roles")?,
        sections: row.try_get("sections")?,
        read_only: row.try_get("read_only")?,
        node_reach: row.try_get("node_reach")?,
        description: row.try_get("description")?,
        builtin: row.try_get("builtin")?,
        holders: row.try_get("holders")?,
    })
}

pub async fn list_job_roles(pool: &PgPool) -> Result<JobRoleList, AppError> {
    let rows = sqlx::query(&format!(
        "SELECT {ROLE_COLUMNS} FROM job_role r ORDER BY r.sort_order, r.code"
    ))
    .fetch_all(pool)
    .await?;
    Ok(JobRoleList {
        items: rows.iter().map(to_role).collect::<Result<_, _>>()?,
    })
}

pub async fn load_job_role(pool: &PgPool, code: &str) -> Result<Option<JobRole>, AppError> {
    sqlx::query(&format!(
        "SELECT {ROLE_COLUMNS} FROM job_role r WHERE r.code = $1"
    ))
    .bind(code)
    .fetch_optional(pool)
    .await?
    .as_ref()
    .map(to_role)
    .transpose()
}

/// A list of codes, checked against a vocabulary and put in its order.
fn checked(
    asked: &[String],
    known: &[&str],
    what: &str,
) -> Result<Vec<String>, AppError> {
    let asked: Vec<String> = asked.iter().map(|code| code.trim().to_owned()).collect();
    if let Some(unknown) = asked.iter().find(|code| !known.contains(&code.as_str())) {
        return Err(AppError::Validation(format!(
            "{unknown} is not a {what}; the {what}s are {}",
            known.join(", ")
        )));
    }
    Ok(known
        .iter()
        .filter(|code| asked.iter().any(|asked| asked == *code))
        .map(|code| (*code).to_owned())
        .collect())
}

fn role_code(raw: &str) -> Result<String, AppError> {
    let code = raw.trim().to_ascii_uppercase();
    let valid = code.len() >= 2
        && code.len() <= 32
        && code.starts_with(|c: char| c.is_ascii_uppercase())
        && code
            .chars()
            .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_');
    if !valid {
        return Err(AppError::Validation(
            "a role code is 2-32 characters of A-Z, 0-9 and _, starting with a letter".into(),
        ));
    }
    Ok(code)
}

/// Edit a role, or create one nobody seeded.
pub async fn put_job_role(
    pool: &PgPool,
    raw_code: &str,
    patch: JobRolePatch,
    actor: &str,
) -> Result<JobRole, AppError> {
    let code = role_code(raw_code)?;
    let flow_codes: Vec<&str> = FlowRole::ALL.iter().map(|role| role.code()).collect();
    let flow_roles = patch
        .flow_roles
        .as_deref()
        .map(|asked| checked(asked, &flow_codes, "flow role"))
        .transpose()?;
    let sections = patch
        .sections
        .as_deref()
        .map(|asked| checked(asked, &SECTIONS, "section"))
        .transpose()?;
    let node_reach = patch
        .node_reach
        .as_deref()
        .map(|reach| {
            let reach = reach.trim().to_ascii_uppercase();
            if NODE_REACH.contains(&reach.as_str()) {
                Ok(reach)
            } else {
                Err(AppError::Validation(format!(
                    "node_reach is one of {}",
                    NODE_REACH.join(", ")
                )))
            }
        })
        .transpose()?;
    let name = patch
        .name
        .as_deref()
        .map(|name| {
            let name = name.trim();
            if name.is_empty() || name.chars().count() > 64 {
                Err(AppError::Validation("a role's name is 1-64 characters".into()))
            } else {
                Ok(name.to_owned())
            }
        })
        .transpose()?;
    let description = patch.description.as_deref().map(|text| text.trim().to_owned());
    let rung = patch.rung.map(|rung| rung.as_str());

    // OWNER and ADMIN hold everything by definition (`JobGrant::holds_everything`);
    // a row edited to say otherwise would be a row that lies.
    if code == job_role::OWNER || code == job_role::ADMIN {
        if rung.is_some_and(|rung| rung != "ADMIN") {
            return Err(AppError::Conflict(format!(
                "{code} stays on the ADMIN rung: it holds every section and every flow stage"
            )));
        }
        if patch.read_only == Some(true) {
            return Err(AppError::Conflict(format!("{code} cannot be read-only")));
        }
        if sections.is_some() || flow_roles.is_some() {
            return Err(AppError::Conflict(format!(
                "{code} always holds every section and every flow role; they cannot be narrowed"
            )));
        }
    }

    let existing = load_job_role(pool, &code).await?;
    let mut tx = pool.begin().await?;
    match &existing {
        None => {
            let (Some(name), Some(rung)) = (name.as_deref(), rung) else {
                return Err(AppError::Validation(format!(
                    "{code} is a new role: give it a name and a rung"
                )));
            };
            sqlx::query(
                "INSERT INTO job_role
                    (code, name, rung, flow_roles, sections, read_only, node_reach,
                     description, builtin, updated_by)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, false, $9)",
            )
            .bind(&code)
            .bind(name)
            .bind(rung)
            .bind(flow_roles.clone().unwrap_or_default())
            .bind(sections.clone().unwrap_or_default())
            .bind(patch.read_only.unwrap_or(false))
            .bind(node_reach.as_deref().unwrap_or("NONE"))
            .bind(description.as_deref().unwrap_or(""))
            .bind(actor)
            .execute(&mut *tx)
            .await?;
        }
        Some(_) => {
            sqlx::query(
                "UPDATE job_role SET
                    name        = COALESCE($2, name),
                    rung        = COALESCE($3, rung),
                    flow_roles  = COALESCE($4, flow_roles),
                    sections    = COALESCE($5, sections),
                    read_only   = COALESCE($6, read_only),
                    node_reach  = COALESCE($7, node_reach),
                    description = COALESCE($8, description),
                    updated_by  = $9,
                    updated_at  = now()
                  WHERE code = $1",
            )
            .bind(&code)
            .bind(name.as_deref())
            .bind(rung)
            .bind(flow_roles.as_ref())
            .bind(sections.as_ref())
            .bind(patch.read_only)
            .bind(node_reach.as_deref())
            .bind(description.as_deref())
            .bind(actor)
            .execute(&mut *tx)
            .await?;
        }
    }
    // Who signs in where follows the rung and the reach (0635).
    let servers_change = match &existing {
        None => false,
        Some(before) => {
            rung.is_some_and(|rung| rung != before.rung.as_str())
                || node_reach
                    .as_deref()
                    .is_some_and(|reach| reach != before.node_reach)
        }
    };
    let origins = if servers_change {
        super::reconcile_node_access_tx(&mut tx, None, actor).await?
    } else {
        Vec::new()
    };
    tx.commit().await?;
    super::publish_node_access(pool, &origins, actor).await;

    load_job_role(pool, &code)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("role {code}")))
}

/// Delete a role somebody created. A seeded role, or one anybody still holds
/// or has been invited into, is refused by name.
pub async fn delete_job_role(pool: &PgPool, raw_code: &str) -> Result<(), AppError> {
    let code = role_code(raw_code)?;
    let Some(role) = load_job_role(pool, &code).await? else {
        return Err(AppError::NotFound(format!("role {code}")));
    };
    if role.builtin {
        return Err(AppError::Conflict(format!(
            "{} is a built-in role; it can be edited but not deleted",
            role.name
        )));
    }
    if role.holders > 0 {
        return Err(AppError::Conflict(format!(
            "{} people hold {}; give them another role first",
            role.holders, role.name
        )));
    }
    let invited: i64 =
        sqlx::query_scalar("SELECT count(*)::bigint FROM user_invitation WHERE role_code = $1")
            .bind(&code)
            .fetch_one(pool)
            .await?;
    if invited > 0 {
        return Err(AppError::Conflict(format!(
            "{} is named on {invited} invitation(s); it stays for their history",
            role.name
        )));
    }
    sqlx::query("DELETE FROM job_role WHERE code = $1 AND NOT builtin")
        .bind(&code)
        .execute(pool)
        .await?;
    Ok(())
}
