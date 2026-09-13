//! The activity log: who did what, to which record.
//!
//! Written by the HTTP layer rather than by each handler, and that is a
//! deliberate trade. A per-handler call could say "published price book v9"
//! where this can only say "POST /api/v1/commercial/publications/{id}/publish
//! → 200"; what it buys is that nothing can be forgotten. Two hundred handlers
//! each remembering to log is two hundred chances to miss one, and the one
//! that gets missed is always the one somebody later needs.
//!
//! Handlers that want to say something richer can still write a row of their
//! own with a `payload`; the middleware's row is the floor, not the ceiling.

use crate::cloud::application::AppError;
use crate::cloud::domain::RecordKind;
use serde::Serialize;
use serde_json::{json, Value};
use sqlx::{PgPool, Postgres, Row, Transaction};

/// One line of history.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct AuditEntry {
    /// Ordered, not just timestamped: two actions in the same millisecond
    /// still happened in an order, and a reader has to be able to see it.
    pub audit_id: i64,
    pub at: chrono::DateTime<chrono::Utc>,
    pub username: String,
    pub display_name: String,
    pub role: String,
    pub method: String,
    pub path: String,
    pub status: i16,
    pub subject_kind: Option<String>,
    pub subject_id: Option<String>,
    /// Room for what the shape of a path cannot say. Typed as `unknown` for the
    /// browser rather than `any`: a reader has to narrow it before using it,
    /// which is correct — its contents depend on which handler wrote the row.
    #[cfg_attr(feature = "ts", ts(type = "Record<string, unknown>"))]
    pub payload: Value,
}

/// What the middleware knows at the end of a request.
pub struct NewAudit<'a> {
    pub username: &'a str,
    pub display_name: &'a str,
    pub role: &'a str,
    pub method: &'a str,
    pub path: &'a str,
    pub status: i16,
    /// The record this touched, typed rather than spelled. A `&str` here is
    /// how the log came to hold `activitie` and `edge_policie`: anything that
    /// compiles is a subject kind, and nothing ever says otherwise.
    pub subject: Option<(RecordKind, String)>,
    pub payload: Value,
}

/// Write one line.
///
/// Takes the pool rather than a transaction: this is written *after* the
/// handler's own transaction has committed or rolled back, and it must not be
/// able to undo it. An audit row that vanished because the thing it recorded
/// failed would be the one row you most wanted to keep — "who tried" is the
/// question a refused action raises.
pub async fn record_audit(pool: &PgPool, entry: NewAudit<'_>) -> Result<i64, AppError> {
    let (subject_kind, subject_id) = match &entry.subject {
        Some((kind, id)) => (Some(kind.as_str()), Some(id.as_str())),
        None => (None, None),
    };
    let id: i64 = sqlx::query_scalar(
        "INSERT INTO audit_log
             (username, display_name, role, method, path, status,
              subject_kind, subject_id, payload)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING audit_id",
    )
    .bind(entry.username)
    .bind(entry.display_name)
    .bind(entry.role)
    .bind(entry.method)
    .bind(entry.path)
    .bind(entry.status)
    .bind(subject_kind)
    .bind(subject_id)
    .bind(&entry.payload)
    .fetch_one(pool)
    .await?;
    Ok(id)
}

// ── the activity feed ────────────────────────────────────────────────────
//
// The same shape `list_employees` sets: a scope struct in, an envelope out, a
// keyset over a named sort, and facet counts drawn from the same row
// definition the page is. Copied rather than reinvented — two list endpoints
// that page differently are two things to learn and two things to get wrong.
//
// This one is an AUDIT surface, and that changes exactly one thing: every
// number it reports is an exact `COUNT(*)`, never an estimate from
// `pg_class.reltuples` or a sample. A rough count of who did what reads as a
// fact and is not one, and "about forty refused requests" is a worse answer
// than no answer at all.

/// How many lines the feed returns when the caller does not say.
const FEED_DEFAULT_LIMIT: i64 = 100;
/// And the most it will return however loudly a caller asks.
///
/// The log is the largest table in this database and it only grows: one row
/// per write, forever. Five hundred was the old ceiling and it was silent —
/// the activity screen asked for five hundred of six thousand rows and drew
/// them as though they were the log. The ceiling stays; `total` beside it is
/// what stops it lying.
const FEED_MAX_LIMIT: i64 = 500;

/// What a caller is asking the activity log for.
#[derive(Clone, Debug, Default)]
pub struct AuditScope {
    /// Free text over who acted, what they acted on and where.
    ///
    /// Username, display name, path and subject id — the four things somebody
    /// looking through a log has in their hand. Deliberately not `payload`:
    /// handlers write arbitrary JSON there, and a search that reached into it
    /// would match on whatever one handler happened to record, which is not a
    /// rule anybody could predict.
    pub needle: Option<String>,
    /// One person's actions. The parameter this route already had, spelled the
    /// same.
    pub actor: Option<String>,
    /// `POST`, `PATCH`, `PUT` or `DELETE`. Reads are never recorded, so there
    /// is no `GET` to ask for.
    pub method: Option<String>,
    /// `OK` or `REFUSED`, by the same `status >= 400` test the screen was
    /// making in the browser over the rows it happened to have.
    pub outcome: Option<String>,
    /// One record's history — the pair a sheet opens on.
    ///
    /// Half a pair is refused by the handler rather than treated as a whole
    /// one: answering the global feed to somebody who asked for one record's
    /// history hides their bug behind plausible data.
    pub subject_kind: Option<String>,
    pub subject_id: Option<String>,
    /// `at`, `actor`, `path` or `status`. Anything unrecognised is `at`,
    /// rather than a 400 — a sort arrives from a URL somebody may have kept,
    /// and a stale bookmark should still open.
    pub sort: Option<String>,
    /// `true` for descending, and **true is the default here**, unlike every
    /// other list in this file's neighbourhood. A log is read newest-first;
    /// ascending would open six thousand rows at the day the system was
    /// installed. The handler spells that, because it is the one place that
    /// knows an absent `dir` from an explicit one.
    pub desc: bool,
    pub cursor: Option<String>,
    pub limit: Option<i64>,
    /// Whether to count at all.
    ///
    /// **The one place this list departs from the shape the rest follow**, and
    /// the reason is measured rather than stylistic. The page is a keyset seek
    /// down `ix_audit_at`: it costs what one page costs, whatever the log
    /// holds — 2.0 ms here. The counting half reads the WHOLE log, because an
    /// exact count of a log cannot cost less than reading it: 14.5 ms over
    /// 5,987 rows, which is 2.4 µs a row and therefore about 40,000 rows to a
    /// tenth of a second.
    ///
    /// An audit surface may not answer that with an estimate — a rough count of
    /// who did what reads as a fact and is not one — so the other way out is
    /// silence, and the envelope can say it: `total` and `facets` are both
    /// `Option`, and absent means "not counted" rather than "none".
    ///
    /// Defaults to counting, because every screen reading this today wants the
    /// numbers and the log is nowhere near the size where it hurts.
    pub count: bool,
}

/// One value a filter can take, and how many lines would still be there.
///
/// Exact, always — see the note above [`AuditScope`]. Counted over what the
/// SEARCH leaves and nothing else, so the number beside `REFUSED` answers "how
/// many refusals are there", which is the question somebody has before
/// clicking it rather than after.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct AuditFacet {
    pub value: String,
    /// What to draw when it differs from the value — a person's display name
    /// beside their username. Absent for a method or an outcome, whose words
    /// belong to the screen.
    pub label: Option<String>,
    pub count: i64,
}

/// The three things this feed can be narrowed by.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct AuditFacets {
    /// Who has done anything at all, biggest first.
    pub actors: Vec<AuditFacet>,
    pub methods: Vec<AuditFacet>,
    /// `OK` and `REFUSED`. Both are present when both exist; a missing
    /// `REFUSED` row means nothing has been refused, which is worth being able
    /// to read straight off.
    pub outcomes: Vec<AuditFacet>,
}

/// A page of the log, and the shape of everything it was drawn from.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct AuditFeed {
    pub rows: Vec<AuditEntry>,
    /// Opaque. Pass it back as `cursor`; absent means this was the last page.
    pub next_cursor: Option<String>,
    /// Every line the search and the filters match — exactly, not just this
    /// page. The number the screen could not previously state: it asked for
    /// five hundred rows and had no way to know whether that was the log or a
    /// twelfth of it.
    ///
    /// `None` means NOT COUNTED, which is a different statement from zero and
    /// has to stay different: this is an audit surface, and the rule is that a
    /// number here is exact or it is absent. See [`AuditScope::count`].
    pub total: Option<i64>,
    /// `None` for the same reason, and always together with `total`: a screen
    /// that got facets without a total would be drawing a filter panel beside
    /// a list whose size it does not know.
    pub facets: Option<AuditFacets>,
}

/// Where the previous page stopped — as a ROW, not a position.
///
/// Carries the `audit_id` and nothing else whatever the sort is, and the seek
/// re-reads that row's own sort value in SQL. One cursor shape serves every
/// order, and a fifth sort cannot arrive without its cursor.
#[derive(serde::Serialize, serde::Deserialize)]
struct AuditCursor {
    audit_id: i64,
}

impl AuditCursor {
    fn encode(&self) -> Result<String, AppError> {
        Ok(hex::encode(serde_json::to_vec(self)?))
    }

    fn decode(raw: &str) -> Result<Self, AppError> {
        let bytes = hex::decode(raw).map_err(|_| {
            AppError::Validation("cursor is not a cursor this server issued".into())
        })?;
        serde_json::from_slice(&bytes)
            .map_err(|_| AppError::Validation("cursor is not a cursor this server issued".into()))
    }
}

/// One line of the log, defined once.
///
/// Used by the page query and by the facet counts, which is the whole reason it
/// is a constant: the facets are only honest if they count exactly what the
/// page can show.
///
/// It stops at the SEARCH. Every filter is applied outside it by each caller,
/// which is what lets one definition answer two questions from the same rows —
/// the page wants what the filters leave, the filter panel wants what the
/// search alone leaves.
///
/// `outcome` is computed here rather than only in a `WHERE` because the facet
/// counts group by it, and a value two places derive separately is a value two
/// places will eventually disagree about.
///
/// Every column a sort can name is NOT NULL in the table — `at`, `username`,
/// `path`, `status` — so no `COALESCE` sentinel is needed here. That is worth
/// stating rather than leaving to be rediscovered: a row comparison against
/// NULL is NULL rather than true, so the day somebody adds a nullable sort key
/// the keyset will end silently at the first NULL unless it is coalesced.
///
/// Binds: `$1` the search pattern or NULL.
const FEED_ROWS: &str = "
    SELECT audit_id, at, username, display_name, role, method, path, status,
           subject_kind, subject_id, payload,
           CASE WHEN status >= 400 THEN 'REFUSED' ELSE 'OK' END AS outcome
      FROM audit_log
     WHERE ($1::text IS NULL
            OR username ILIKE $1
            OR display_name ILIKE $1
            OR path ILIKE $1
            OR COALESCE(subject_id, '') ILIKE $1)
";

/// Every filter, in one place, so the page and the total cannot drift.
///
/// Deliberately NOT part of [`FEED_ROWS`]: the facet counts read the searched
/// set without these, which is what makes "REFUSED 12" mean "there are twelve
/// refusals" rather than "twelve of the ones you already narrowed to refused".
const FEED_FILTERS: &str = "
    WHERE ($2::text IS NULL OR username = $2)
      AND ($3::text IS NULL OR method = $3)
      AND ($4::text IS NULL OR outcome = $4)
      AND ($5::text IS NULL OR subject_kind = $5)
      AND ($6::text IS NULL OR subject_id = $6)
";

/// The activity log, one page at a time, beside how big the whole answer is.
///
/// Replaces two functions — the global feed and one record's history — with
/// one, because they differed only in a `WHERE` and had already drifted: the
/// feed took an actor the sheet could not, and the sheet was bounded at a
/// hundred lines with no way to say there were more.
pub async fn list_audit(pool: &PgPool, scope: AuditScope) -> Result<AuditFeed, AppError> {
    // A blank search is not a search: `Some("")` compiles to `ILIKE '%%'`,
    // which matches everything and costs a scan to say so.
    let needle = scope
        .needle
        .as_deref()
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(|text| format!("%{text}%"));

    // The sort, and the tie-break that makes it total. Every order ends in
    // `audit_id`, which is the primary key and monotone, so no two rows compare
    // equal — which is what stops a keyset repeating or losing the rows that
    // tie. `at` alone would not do it: the middleware writes several rows a
    // millisecond.
    //
    // TWO spellings of the same thing, and they are not interchangeable:
    // `ORDER BY` takes directions, a ROW EXPRESSION does not.
    let lead = match scope.sort.as_deref() {
        Some("actor") => "username",
        Some("path") => "path",
        Some("status") => "status",
        _ => "at",
    };
    let cols = format!("{lead}, audit_id");
    let dir = if scope.desc { "DESC" } else { "ASC" };
    let order = format!("{lead} {dir}, audit_id {dir}");
    // Which way the seek points follows the direction, or paging a descending
    // list walks back up it.
    let seek = if scope.desc { "<" } else { ">" };

    let cursor = scope
        .cursor
        .as_deref()
        .map(AuditCursor::decode)
        .transpose()?;
    let limit = scope
        .limit
        .unwrap_or(FEED_DEFAULT_LIMIT)
        .clamp(1, FEED_MAX_LIMIT);

    // The seek re-reads the previous row's own sort value rather than trusting
    // one encoded in the cursor — see [`AuditCursor`]. A cursor whose row the
    // filters no longer keep finds nothing to compare against, so the page
    // comes back empty: the feed ends early rather than starting again, and
    // stopping is visible where repeating is not.
    // `NOT MATERIALIZED` on both CTEs, and it is the difference between an
    // index scan and a sequential one. `kept` is referenced TWICE below — once
    // as the page and once inside the seek — and two references is exactly the
    // rule that makes PostgreSQL materialise a CTE. A materialised `kept` is an
    // optimisation fence: the planner cannot push `ORDER BY … LIMIT` through
    // it, so it reads the WHOLE table, sorts it, and throws away everything but
    // the page. Measured on this database: 7.5 ms over 5,987 rows as a seq scan
    // against 2.0 ms as an index scan, and the gap is not a constant — the
    // first grows with the table and the second does not.
    let sql = format!(
        "WITH searched AS NOT MATERIALIZED ({FEED_ROWS}),
              kept AS NOT MATERIALIZED (
             SELECT * FROM searched {FEED_FILTERS}
         )
         SELECT * FROM kept
          WHERE $7::bigint IS NULL
             OR ({cols}) {seek} (SELECT {cols} FROM kept WHERE audit_id = $7)
          ORDER BY {order}
          LIMIT $8"
    );
    let rows = sqlx::query(&sql)
        .bind(&needle)
        .bind(&scope.actor)
        .bind(&scope.method)
        .bind(&scope.outcome)
        .bind(&scope.subject_kind)
        .bind(&scope.subject_id)
        .bind(cursor.as_ref().map(|one| one.audit_id))
        .bind(limit)
        .fetch_all(pool)
        .await?;

    // A short page is the last page. A full one may not be — the next request
    // can come back empty — and that is the honest answer: knowing whether more
    // rows exist without asking costs a second pass over the same query.
    let next_cursor = match rows.last() {
        Some(row) if rows.len() as i64 == limit => Some(
            AuditCursor {
                audit_id: row.try_get("audit_id")?,
            }
            .encode()?,
        ),
        _ => None,
    };

    // The page is done. Everything below is the counting half, and it is
    // skipped entirely rather than approximated when the caller says so.
    let (total, facets) = match scope.count {
        true => {
            let (total, facets) = audit_facets(pool, &scope, needle.as_deref()).await?;
            (Some(total), Some(facets))
        }
        false => (None, None),
    };
    Ok(AuditFeed {
        rows: rows.into_iter().map(row_to_entry).collect(),
        next_cursor,
        total,
        facets,
    })
}

/// How many lines there are, and how they split.
///
/// Counted from the SAME [`FEED_ROWS`] the page is drawn from, and every number
/// is an exact `COUNT(*)`. The two scopes are deliberate:
///
///   per-value counts read the SEARCHED set, ignoring what is filtered — the
///     number beside a name answers "how much has this person done".
///   the total reads the FILTERED set, because it describes the list on screen.
async fn audit_facets(
    pool: &PgPool,
    scope: &AuditScope,
    needle: Option<&str>,
) -> Result<(i64, AuditFacets), AppError> {
    let sql = format!(
        "WITH searched AS ({FEED_ROWS}), kept AS (
             SELECT * FROM searched {FEED_FILTERS}
         )
         SELECT 'actor' AS kind, username AS value, min(display_name) AS label,
                COUNT(*)::bigint AS n
           FROM searched GROUP BY username
          UNION ALL
         SELECT 'method', method, NULL::text, COUNT(*)::bigint
           FROM searched GROUP BY method
          UNION ALL
         SELECT 'outcome', outcome, NULL::text, COUNT(*)::bigint
           FROM searched GROUP BY outcome
          UNION ALL
         SELECT 'all', '', NULL::text, COUNT(*)::bigint FROM kept"
    );
    let rows = sqlx::query(&sql)
        .bind(needle)
        .bind(&scope.actor)
        .bind(&scope.method)
        .bind(&scope.outcome)
        .bind(&scope.subject_kind)
        .bind(&scope.subject_id)
        .fetch_all(pool)
        .await?;

    let mut total = 0i64;
    let (mut actors, mut methods, mut outcomes) = (Vec::new(), Vec::new(), Vec::new());
    for row in &rows {
        let kind: String = row.try_get("kind")?;
        let facet = AuditFacet {
            value: row.try_get("value")?,
            label: row.try_get("label")?,
            count: row.try_get("n")?,
        };
        match kind.as_str() {
            "actor" => actors.push(facet),
            "method" => methods.push(facet),
            "outcome" => outcomes.push(facet),
            _ => total = facet.count,
        }
    }
    // Biggest first, as every other facet list here is: the value somebody is
    // most likely to want is the one with the most behind it. Ties break on the
    // value so the order is stable between calls — a list that reshuffles under
    // the cursor is a list nobody can click.
    for list in [&mut actors, &mut methods, &mut outcomes] {
        list.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.value.cmp(&b.value)));
    }
    Ok((
        total,
        AuditFacets {
            actors,
            methods,
            outcomes,
        },
    ))
}

fn row_to_entry(row: sqlx::postgres::PgRow) -> AuditEntry {
    AuditEntry {
        audit_id: row.get("audit_id"),
        at: row.get("at"),
        username: row.get("username"),
        display_name: row.get("display_name"),
        role: row.get("role"),
        method: row.get("method"),
        path: row.get("path"),
        status: row.get("status"),
        subject_kind: row.get("subject_kind"),
        subject_id: row.get("subject_id"),
        payload: row.get("payload"),
    }
}

/// Everybody signed in, for the broadcast notification.
///
/// Resolved at raise time like every other recipient list: somebody who joins
/// tomorrow should not inherit today's announcements, and somebody who leaves
/// should not have theirs deleted out from under an audit.
pub async fn every_active_user(pool: &PgPool) -> Result<Vec<String>, AppError> {
    Ok(
        sqlx::query_scalar::<_, String>("SELECT username FROM app_user WHERE active")
            .fetch_all(pool)
            .await?,
    )
}

/// Announce a completed action to everybody.
///
/// This is the console's "notify on every action" setting, and it is worth
/// being honest in a comment about what it costs: one row per user per action
/// in `notification_recipient`, and a queue that fills faster than anybody
/// clears it. `0046_notifications.sql` says it plainly — a notification for
/// everything that merely happened trains people to dismiss all of them.
///
/// It is implemented as its own `activity` kind rather than reusing the two
/// that name real work, precisely so that narrowing it later is a change to
/// one string and not an archaeology exercise.
pub async fn announce_activity(
    tx: &mut Transaction<'_, Postgres>,
    recipients: &[String],
    actor: &str,
    title: String,
    body: String,
    subject: Option<(&str, String)>,
) -> Result<(), AppError> {
    super::notifications::raise_notification(
        tx,
        super::notifications::NewNotification {
            kind: "activity",
            title,
            body,
            subject: subject.map(|(kind, id)| (kind, id)),
            origin_id: None,
            payload: json!({ "actor": actor }),
        },
        recipients,
    )
    .await?;
    Ok(())
}
