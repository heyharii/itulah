//! Segments somebody wrote down, as opposed to the six that are worked out.
//!
//! `membership.rs` next door derives six groups from one axis — how long since
//! somebody last came in — and argues at length that they must never be
//! stored. This file does not weaken that argument; it applies it to a second
//! kind of segment.
//!
//! # What is stored is the clauses, never the membership
//!
//! There is no `segment_member` table and there will not be one. A saved
//! segment is a name, a reason, and a list of clauses over the `member`
//! dataset; who is in it is worked out on every read by the same `FROM` the
//! directory itself uses. Everything the neighbouring file says about a stored
//! segment being silently wrong applies here with more force, because these
//! are the segments somebody built specifically in order to send something.
//!
//! # Why these are a different species from the six
//!
//! The six are exhaustive and mutually exclusive: they add up to the directory
//! and a reader can check the arithmetic. These do neither — "lapsing, and has
//! spent at least five million" overlaps "spent at least five million", and
//! two of them can between them cover a member twice and another not at all.
//! That is not a defect, it is what makes them useful; it is only a defect if
//! a screen draws them as though they were the six. They are kept apart for
//! that reason, here and on the screen.
//!
//! # Why they are not evaluated at a till
//!
//! An edge node holds no member directory at all — only the `customer_id` a
//! cashier wrote onto a sale. A shop therefore cannot answer "has spent at
//! least five million across the estate" while offline, so nothing here is
//! reachable from `CustomerScope` and a promotion cannot be aimed at a saved
//! segment. Doing that later means publishing a *snapshot* the way a price
//! book is published — versioned, stamped with when it was computed, and
//! honest about being a photograph — not shipping this predicate down.

use crate::cloud::application::AppError;
use crate::cloud::reports::{
    catalogue::{dataset, Dataset, CATALOGUE_VERSION},
    compile::{bind_params, narrow, Narrowing},
    spec::{check_filters, Filter},
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Row};
use uuid::Uuid;

use super::membership::MEMBER_SOURCE;

/// The dataset a segment is defined over. Panics only if the catalogue drops
/// `member`, which is a build-time mistake rather than a runtime condition.
fn members() -> &'static Dataset {
    dataset("member").expect("the `member` dataset is declared in the catalogue")
}

/// How the clauses combine.
///
/// The only structural choice a definition gets. A tree of nested groups is a
/// query language, and a query language needs an editor, a parser and a way of
/// explaining itself to somebody who did not write it — none of which is worth
/// the two extra segments a year that would need it. Everything else is said
/// by adding a clause.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Match {
    /// Every clause has to hold. The default, because it is what somebody
    /// listing conditions means without being asked.
    #[default]
    All,
    /// Any one of them is enough.
    Any,
}

/// What a segment *is*.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct SegmentDefinition {
    #[serde(rename = "match", default)]
    pub match_: Match,
    /// `reports::spec::Filter`, not a shape of this file's own. A clause
    /// somebody adds in the browser's filter bar, a clause the assistant
    /// composes for a report, and a clause saved here are the same object with
    /// the same operators — which is the only reason "is at least" can be
    /// relied upon to mean the same thing in all three.
    #[serde(default)]
    pub filters: Vec<Filter>,
}

/// A saved segment as a reader receives it.
#[derive(Clone, Debug, Serialize)]
pub struct SavedSegment {
    pub segment_id: Uuid,
    pub name: String,
    pub purpose: Option<String>,
    pub owner_username: String,
    pub version: i32,
    /// Which catalogue this version was validated against. A definition
    /// written before a column was renamed is not automatically wrong, but a
    /// screen that could not tell would have no way of explaining a count that
    /// changed on its own.
    pub catalogue_version: i32,
    pub definition: SegmentDefinition,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    /// Whether this reader may edit it. Everybody may read every segment —
    /// a marketing list only its author can see is one somebody else rebuilds
    /// slightly differently — but editing stays with the author.
    pub editable: bool,
    /// What the definition matches *right now*. Always computed, never stored;
    /// `None` only when the tally was not asked for.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tally: Option<SegmentTally>,
}

/// What a definition matches, in the same four figures the six derived
/// segments report — so one card component can draw either.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct SegmentTally {
    pub members: i64,
    pub spent_minor: i64,
    pub transaction_count: i64,
    /// Per member, not per sale. The figure that says whether a segment is
    /// worth a campaign at all.
    pub average_spend_minor: i64,
    pub last_purchase_at: Option<DateTime<Utc>>,
    /// How many members the shop has in total, so a screen can say what the
    /// number above is a fraction of without a second read that might disagree
    /// with it.
    pub member_count: i64,
}

/// A definition is answerable, and says something.
///
/// The empty clause list is refused rather than accepted as "everybody": a
/// segment matching the whole directory is the directory, and saving one under
/// a name is how somebody ends up sending a lapsed-customer offer to every
/// member the shop has.
pub fn check_definition(definition: &SegmentDefinition) -> Result<(), AppError> {
    if definition.filters.is_empty() {
        return Err(AppError::Validation(
            "a segment needs at least one condition — one with none is the whole directory".into(),
        ));
    }
    let mut problems = Vec::new();
    check_filters(members(), &definition.filters, &mut problems);
    if problems.is_empty() {
        Ok(())
    } else {
        Err(AppError::Validation(problems.join("; ")))
    }
}

/// Compile a definition into a predicate, numbering from `bound + 1`.
pub fn narrowing_of(definition: &SegmentDefinition, bound: usize) -> Narrowing {
    narrow(
        members(),
        &definition.filters,
        definition.match_ == Match::All,
        bound,
    )
}

/// The predicate for a saved segment, for a caller that wants the members
/// themselves rather than a count.
///
/// Reads the definition rather than taking clauses from the caller, which is
/// the whole reason the directory takes a `segment_id` in its query string:
/// clauses in a URL are a copy, and a copy stops agreeing with the definition
/// the moment somebody edits it.
pub async fn segment_narrowing(
    pool: &PgPool,
    id: Uuid,
    bound: usize,
) -> Result<Narrowing, AppError> {
    let saved = read_segment(pool, id, "", false).await?;
    Ok(narrowing_of(&saved.definition, bound))
}

/// Count what a definition matches, without saving it.
///
/// The same compiler the saved list uses, so the number somebody sees while
/// writing a segment is the number the card shows after they save it. A
/// preview that ran a different query would be a preview of a different
/// segment.
pub async fn preview_segment(
    pool: &PgPool,
    definition: &SegmentDefinition,
) -> Result<SegmentTally, AppError> {
    check_definition(definition)?;
    let narrowing = narrowing_of(definition, 0);
    let Some(predicate) = narrowing.sql.as_deref() else {
        // Unreachable while `check_definition` refuses an empty list, and
        // cheaper to answer than to prove unreachable at every call site.
        return Ok(SegmentTally::default());
    };

    let row = bind_params(
        sqlx::query(&format!("{}\n WHERE {predicate}", tally_select())),
        &narrowing.params,
    )
    .fetch_one(pool)
    .await?;

    let mut tally = tally_from_row(&row)?;
    tally.member_count = member_count(pool).await?;
    Ok(tally)
}

/// The aggregate every tally is: one row, over the member directory.
fn tally_select() -> String {
    format!(
        "SELECT count(*)::bigint                                AS members,
                COALESCE(sum(COALESCE(s.spent_minor, 0)), 0)::bigint
                                                                AS spent_minor,
                COALESCE(sum(COALESCE(s.transaction_count, 0)), 0)::bigint
                                                                AS transaction_count,
                max(s.last_purchase_at)                          AS last_purchase_at
           {MEMBER_SOURCE}"
    )
}

fn tally_from_row(row: &sqlx::postgres::PgRow) -> Result<SegmentTally, AppError> {
    let members: i64 = row.try_get("members")?;
    let spent_minor: i64 = row.try_get("spent_minor")?;
    Ok(SegmentTally {
        members,
        spent_minor,
        transaction_count: row.try_get("transaction_count")?,
        // Integer division, and no members means zero rather than a division
        // by nothing. The same arithmetic the six use, deliberately.
        average_spend_minor: if members == 0 {
            0
        } else {
            spent_minor / members
        },
        last_purchase_at: row.try_get("last_purchase_at")?,
        member_count: 0,
    })
}

async fn member_count(pool: &PgPool) -> Result<i64, AppError> {
    Ok(
        sqlx::query_scalar::<_, i64>("SELECT count(*)::bigint FROM member")
            .fetch_one(pool)
            .await?,
    )
}

pub struct NewSegment<'a> {
    pub name: &'a str,
    pub purpose: Option<&'a str>,
    pub definition: &'a SegmentDefinition,
    pub owner: &'a str,
}

/// Save a new segment at version 1.
pub async fn create_segment(pool: &PgPool, new: NewSegment<'_>) -> Result<SavedSegment, AppError> {
    check_definition(new.definition)?;
    let name = new.name.trim();
    if name.is_empty() {
        return Err(AppError::Validation(
            "a segment needs a name — it is what a campaign will be described by later".into(),
        ));
    }
    let id = Uuid::new_v4();
    let definition = serde_json::to_value(new.definition)?;

    // One transaction, and the deferred foreign key is what lets the segment
    // row name a version written a statement later.
    let mut tx = pool.begin().await?;
    sqlx::query(
        "INSERT INTO segment (segment_id, name, purpose, owner_username, current_version)
         VALUES ($1, $2, $3, $4, 1)",
    )
    .bind(id)
    .bind(name)
    .bind(new.purpose.map(str::trim).filter(|one| !one.is_empty()))
    .bind(new.owner)
    .execute(&mut *tx)
    .await
    // The name index is not deferred, so a collision fails here rather than at
    // the commit below.
    .map_err(named)?;
    sqlx::query(
        "INSERT INTO segment_version
             (segment_id, version, definition, catalogue_version, authored_by)
         VALUES ($1, 1, $2, $3, $4)",
    )
    .bind(id)
    .bind(&definition)
    .bind(CATALOGUE_VERSION)
    .bind(new.owner)
    .execute(&mut *tx)
    .await?;
    tx.commit().await.map_err(named)?;

    read_segment(pool, id, new.owner, true).await
}

/// The one refusal a person will actually meet, said in words.
///
/// The unique index on the name is doing real work — two segments called "VIP"
/// that match different people is how a campaign goes to the wrong half of
/// them — but a bare unique violation reaches the browser as "database
/// operation failed", and somebody who has just typed a name deserves to be
/// told which part of what they typed was the problem.
fn named(error: sqlx::Error) -> AppError {
    match &error {
        sqlx::Error::Database(database) if database.code().as_deref() == Some("23505") => {
            AppError::Conflict(
                "a segment with that name already exists — one name, one list".into(),
            )
        }
        _ => AppError::Database(error),
    }
}

/// Edit by appending. The version a campaign was sent against still resolves.
pub async fn revise_segment(
    pool: &PgPool,
    id: Uuid,
    actor: &str,
    name: &str,
    purpose: Option<&str>,
    definition: &SegmentDefinition,
) -> Result<SavedSegment, AppError> {
    check_definition(definition)?;
    let owner: Option<String> =
        sqlx::query_scalar("SELECT owner_username FROM segment WHERE segment_id = $1")
            .bind(id)
            .fetch_optional(pool)
            .await?;
    let Some(owner) = owner else {
        return Err(AppError::NotFound("no such segment".into()));
    };
    if owner != actor {
        return Err(AppError::Forbidden(
            "only the person who wrote this segment may edit it".into(),
        ));
    }

    let mut tx = pool.begin().await?;
    let next: i32 = sqlx::query_scalar(
        "SELECT COALESCE(MAX(version), 0) + 1 FROM segment_version WHERE segment_id = $1",
    )
    .bind(id)
    .fetch_one(&mut *tx)
    .await?;
    sqlx::query(
        "INSERT INTO segment_version
             (segment_id, version, definition, catalogue_version, authored_by)
         VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(id)
    .bind(next)
    .bind(serde_json::to_value(definition)?)
    .bind(CATALOGUE_VERSION)
    .bind(actor)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "UPDATE segment
            SET current_version = $2, name = $3, purpose = $4, updated_at = now()
          WHERE segment_id = $1",
    )
    .bind(id)
    .bind(next)
    .bind(name.trim())
    .bind(purpose.map(str::trim).filter(|one| !one.is_empty()))
    .execute(&mut *tx)
    .await
    .map_err(named)?;
    tx.commit().await?;

    read_segment(pool, id, actor, true).await
}

/// Retire a segment. Archived rather than deleted, because the versions are
/// the record of what a message was sent to and deleting them would leave a
/// campaign nobody can explain.
pub async fn archive_segment(pool: &PgPool, id: Uuid, actor: &str) -> Result<(), AppError> {
    let owner: Option<String> = sqlx::query_scalar(
        "SELECT owner_username FROM segment WHERE segment_id = $1 AND archived_at IS NULL",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?;
    let Some(owner) = owner else {
        return Err(AppError::NotFound("no such segment".into()));
    };
    if owner != actor {
        return Err(AppError::Forbidden(
            "only the person who wrote this segment may retire it".into(),
        ));
    }
    sqlx::query("UPDATE segment SET archived_at = now() WHERE segment_id = $1")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

fn saved_from_row(row: &sqlx::postgres::PgRow, actor: &str) -> Result<SavedSegment, AppError> {
    let owner_username: String = row.try_get("owner_username")?;
    let definition: serde_json::Value = row.try_get("definition")?;
    Ok(SavedSegment {
        segment_id: row.try_get("segment_id")?,
        name: row.try_get("name")?,
        purpose: row.try_get("purpose")?,
        editable: owner_username == actor,
        owner_username,
        version: row.try_get("version")?,
        catalogue_version: row.try_get("catalogue_version")?,
        definition: serde_json::from_value(definition)?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
        tally: None,
    })
}

const SAVED_COLUMNS: &str = "
    SELECT g.segment_id, g.name, g.purpose, g.owner_username, g.created_at, g.updated_at,
           v.version, v.catalogue_version, v.definition
      FROM segment g
      JOIN segment_version v
        ON v.segment_id = g.segment_id AND v.version = g.current_version";

pub async fn read_segment(
    pool: &PgPool,
    id: Uuid,
    actor: &str,
    with_tally: bool,
) -> Result<SavedSegment, AppError> {
    let row = sqlx::query(&format!(
        "{SAVED_COLUMNS} WHERE g.segment_id = $1 AND g.archived_at IS NULL"
    ))
    .bind(id)
    .fetch_optional(pool)
    .await?;
    let Some(row) = row else {
        return Err(AppError::NotFound("no such segment".into()));
    };
    let mut saved = saved_from_row(&row, actor)?;
    if with_tally {
        saved.tally = Some(preview_segment(pool, &saved.definition).await?);
    }
    Ok(saved)
}

/// Every segment the shop has written, with what each one matches today.
///
/// One read for the whole screen, and the tallies are a single query rather
/// than one per card: they are aggregates over the same source, so a `UNION
/// ALL` scans it once per definition either way but leaves the browser with
/// one answer that cannot be half-loaded. The ordinal is written into the SQL
/// as an integer this function generated — never a value from a caller — which
/// is what lets the rows be matched back to the definitions that produced them.
pub async fn list_segments(pool: &PgPool, actor: &str) -> Result<Vec<SavedSegment>, AppError> {
    let rows = sqlx::query(&format!(
        "{SAVED_COLUMNS} WHERE g.archived_at IS NULL ORDER BY g.name"
    ))
    .fetch_all(pool)
    .await?;
    let mut saved = rows
        .iter()
        .map(|row| saved_from_row(row, actor))
        .collect::<Result<Vec<_>, _>>()?;
    if saved.is_empty() {
        return Ok(saved);
    }

    let mut branches: Vec<String> = Vec::new();
    let mut params = Vec::new();
    let mut bound = 0usize;
    for (index, one) in saved.iter().enumerate() {
        let narrowing = narrowing_of(&one.definition, bound);
        // A definition that no longer compiles — every clause naming a column
        // the catalogue has since dropped — matches nobody rather than
        // everybody. The screen says so; a segment that quietly became "all
        // members" is the one failure this feature must not have.
        let predicate = narrowing.sql.as_deref().unwrap_or("false").to_owned();
        bound += narrowing.params.len();
        params.extend(narrowing.params);
        branches.push(format!(
            "{select}\n WHERE {predicate}",
            select = tally_select().replacen(
                "SELECT ",
                &format!("SELECT {index} AS ord,\n                "),
                1
            ),
        ));
    }

    let tallies = bind_params(sqlx::query(&branches.join("\nUNION ALL\n")), &params)
        .fetch_all(pool)
        .await?;

    let total = member_count(pool).await?;
    for row in &tallies {
        let ord: i32 = row.try_get("ord")?;
        let Some(one) = saved.get_mut(ord as usize) else {
            continue;
        };
        let mut tally = tally_from_row(row)?;
        tally.member_count = total;
        one.tally = Some(tally);
    }
    Ok(saved)
}
