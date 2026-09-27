//! Work that found a person.
//!
//! A notification is raised by the code that caused it, inside that code's own
//! transaction, so a delivery that was accepted and a buyer who was never told
//! about its price cannot be two separate outcomes. It is announced on the
//! existing collaboration stream rather than on a channel of its own — the
//! browser already holds that connection open, and `after=<event_id>` resumes
//! chat, discussions and this together.

use crate::cloud::application::AppError;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::{PgPool, Postgres, Row, Transaction};
use uuid::Uuid;

/// One thing somebody has to deal with.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct Notification {
    pub notification_id: Uuid,
    /// What sort of work this is. The browser routes on it, so it is a closed
    /// set in the schema rather than free text.
    pub kind: String,
    /// The sentence as it was written when the thing happened. Stored rather
    /// than composed in the browser: what a person was told should still read
    /// the same after the screen has been redesigned.
    pub title: String,
    pub body: String,
    /// Where to go when this is clicked, as a record rather than a URL.
    pub subject_kind: Option<String>,
    pub subject_id: Option<String>,
    /// Which node asked, when a node asked.
    pub origin_id: Option<String>,
    pub created_at: DateTime<Utc>,
    /// Null until this reader has dealt with it. Per reader, which is why
    /// this cannot live on the event stream.
    pub read_at: Option<DateTime<Utc>>,
}

/// What one person is looking at, and how much of it is unfinished.
///
/// The count is not `items.len()`: the list is capped so a screen opened after
/// a bad week does not fetch four hundred rows, and a badge that quietly said
/// "50" when there were four hundred would be a badge nobody trusts.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct NotificationPage {
    pub items: Vec<Notification>,
    pub unread: i64,
    /// Opaque. Pass it back as `cursor`; absent means this was the last page.
    ///
    /// Deliberately not an offset. Notifications arrive at the newest end while
    /// somebody is working through the list, and an offset would show one twice
    /// or skip it entirely — on a list where a skipped row is a piece of work
    /// nobody was told about.
    pub next_cursor: Option<String>,
    /// Every notification the search and the filters leave for this reader —
    /// not just this page, and not the same number as `unread`.
    pub total: i64,
    pub facets: NotificationFacets,
}

/// One value a filter can take, and how many notifications would still be
/// there. Counted over what the SEARCH leaves, ignoring the filters currently
/// applied.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct NotificationFacet {
    pub value: String,
    /// Absent for both facets here: a kind's words belong to the screen, which
    /// already has a phrasing for every one it routes on.
    pub label: Option<String>,
    pub count: i64,
}

/// What one reader's list can be narrowed by.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct NotificationFacets {
    /// The kinds of work in this reader's list, biggest first.
    pub kinds: Vec<NotificationFacet>,
    /// `READ` and `UNREAD`, so the panel can offer the filter with the number
    /// already on it rather than the reader having to click to find out.
    pub states: Vec<NotificationFacet>,
}

/// What a caller is asking one reader's list for.
#[derive(Clone, Debug, Default)]
pub struct NotificationScope {
    /// Free text over the sentence somebody was shown — the title and the body.
    /// Those are what a reader remembers; `subject_id` is not something anybody
    /// types from memory.
    pub needle: Option<String>,
    /// The parameter this route already had, spelled the same and meaning the
    /// same: leave out what has been dealt with.
    pub unread_only: bool,
    /// One kind of work.
    pub kind: Option<String>,
    /// `at` or `kind`. Anything else is `at` rather than a 400.
    pub sort: Option<String>,
    /// `true` for descending, and true is the default — a notification list is
    /// read newest-first.
    pub desc: bool,
    pub cursor: Option<String>,
    pub limit: Option<i64>,
}

/// Where the previous page stopped — as a ROW, not a position.
#[derive(Serialize, Deserialize)]
struct NotificationCursor {
    notification_id: Uuid,
}

impl NotificationCursor {
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

/// How many a reader is handed when they do not say, and the most they can ask
/// for. One spelling each, beside the only clamp that enforces them.
const FEED_DEFAULT_LIMIT: i64 = 50;
const FEED_MAX_LIMIT: i64 = 200;

/// One reader's notifications, defined once.
///
/// Used by the page query and by the facet counts, which is the whole reason it
/// is a constant: the facets are only honest if they count exactly what the
/// page can show.
///
/// The reader is the FENCE — `r.username = $1` — and it is inside here where no
/// filter and no sort can reach around it. `read_at` is per reader, which is
/// why this reads through `notification_recipient` rather than the notification
/// itself: one person's cleared badge must never become everybody's.
///
/// It stops at the reader and the SEARCH. The filters are applied outside by
/// each caller, so one definition answers two questions — the page wants what
/// the filters leave, the filter panel wants what the search alone leaves.
///
/// Both sort keys are NOT NULL: `created_at` and `kind` are both `NOT NULL` in
/// the schema. That is worth stating rather than rediscovering — a row
/// comparison against NULL is NULL rather than true, so a nullable sort key
/// added here would end paging at the first NULL, in silence. `read_at` IS
/// nullable, which is exactly why it is a facet and not a sort.
///
/// Binds: `$1` the reader, `$2` the search pattern or NULL.
const FEED_ROWS: &str = "
    SELECT n.notification_id, n.kind, n.title, n.body, n.subject_kind,
           n.subject_id, n.origin_id, n.created_at, r.read_at,
           CASE WHEN r.read_at IS NULL THEN 'UNREAD' ELSE 'READ' END AS state
      FROM notification_recipient r
      JOIN notification n ON n.notification_id = r.notification_id
     WHERE r.username = $1
       AND ($2::text IS NULL OR n.title ILIKE $2 OR n.body ILIKE $2)
";

/// Every filter, in one place, so the page and the total cannot drift.
const FEED_FILTERS: &str = "
    WHERE ($3 = FALSE OR read_at IS NULL)
      AND ($4::text IS NULL OR kind = $4)
";

fn row_to_notification(row: &sqlx::postgres::PgRow) -> Result<Notification, AppError> {
    Ok(Notification {
        notification_id: row.try_get("notification_id")?,
        kind: row.try_get("kind")?,
        title: row.try_get("title")?,
        body: row.try_get("body")?,
        subject_kind: row.try_get("subject_kind")?,
        subject_id: row.try_get("subject_id")?,
        origin_id: row.try_get("origin_id")?,
        created_at: row.try_get("created_at")?,
        read_at: row.try_get("read_at")?,
    })
}

/// Everything a notification needs to be worth sending.
pub struct NewNotification<'a> {
    pub kind: &'a str,
    pub title: String,
    pub body: String,
    pub subject: Option<(&'a str, String)>,
    pub origin_id: Option<&'a str>,
    pub payload: Value,
}

/// Who is told, resolved now rather than at read time.
///
/// Roles are asked of the user table at the moment the work appears, and the
/// resulting usernames are written down. Somebody promoted next week does not
/// inherit last week's unread queue, and somebody who leaves does not take
/// their colleagues' copies with them.
pub async fn recipients_with_role(
    tx: &mut Transaction<'_, Postgres>,
    roles: &[&str],
) -> Result<Vec<String>, AppError> {
    let roles: Vec<String> = roles.iter().map(|role| (*role).to_owned()).collect();
    Ok(
        sqlx::query_scalar("SELECT username FROM app_user WHERE active AND role = ANY($1)")
            .bind(&roles)
            .fetch_all(&mut **tx)
            .await?,
    )
}

/// Raise one, in the caller's transaction.
///
/// Silently does nothing when nobody would be told. That is not a swallowed
/// error: a notification with no recipients is a row that can never be read
/// or cleared, and writing it would make the unread count of a system with no
/// users grow forever.
/// Who holds one of these rungs **and** may act where this happened.
///
/// The place half of the same pair `Reach` decides for a caller — Admin
/// everywhere, everybody else the one place their open posting names — asked
/// of many people at once rather than of one. `domain::employment::reach` is
/// the authority on the rule and this is its plural form; if the rule ever
/// changes, both change, and that is a cost worth paying over the alternative,
/// which is resolving fourteen people's postings one query at a time.
///
/// Without this, a notification meant for one shop lands in thirteen other
/// managers' lists, and a list that is mostly other people's shops is a list
/// nobody reads.
pub async fn recipients_with_role_at(
    tx: &mut Transaction<'_, Postgres>,
    roles: &[&str],
    place: &str,
) -> Result<Vec<String>, AppError> {
    let roles: Vec<String> = roles.iter().map(|role| (*role).to_owned()).collect();
    // `place` may arrive spelled three ways, because three tables name where
    // something is and they were written years apart: a site is `dc`, an
    // organisational place is `ho`, and a node calls itself `dc-01`. The owner
    // settled what they mean on 2026-09-13 — head office IS the cloud, and
    // `dc` and `dc-01` are one warehouse — so the spellings are reconciled
    // here rather than guessed at each call site.
    //
    // The node suffix is trimmed first (`dc-01` is site `dc`'s node), and then
    // a posting matches either directly or through `org_place.site_id`, the
    // bridge 0060 built between the organisation and its sites and 0236
    // finally crossed for head office.
    let site = place.rsplit_once('-').map_or(place, |(head, tail)| {
        if tail.chars().all(|c| c.is_ascii_digit()) {
            head
        } else {
            place
        }
    });

    Ok(sqlx::query_scalar(
        "SELECT u.username FROM app_user u
          WHERE u.active AND u.role = ANY($1)
            AND (u.role = 'ADMIN'
                 OR EXISTS (SELECT 1 FROM employee_assignment a
                             LEFT JOIN org_place p ON p.id = a.place_id
                             WHERE a.employee_id = u.employee_id
                               AND a.valid_to IS NULL
                               AND (a.place_id = $2 OR p.site_id = $2)))
          ORDER BY u.username",
    )
    .bind(&roles)
    .bind(site)
    .fetch_all(&mut **tx)
    .await?)
}

pub async fn raise_notification(
    tx: &mut Transaction<'_, Postgres>,
    notification: NewNotification<'_>,
    recipients: &[String],
) -> Result<Option<Uuid>, AppError> {
    if recipients.is_empty() {
        return Ok(None);
    }
    let notification_id = Uuid::new_v4();
    let (subject_kind, subject_id) = match &notification.subject {
        Some((kind, id)) => (Some(*kind), Some(id.as_str())),
        None => (None, None),
    };
    sqlx::query(
        "INSERT INTO notification
             (notification_id, kind, title, body, subject_kind, subject_id, origin_id, payload)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
    )
    .bind(notification_id)
    .bind(notification.kind)
    .bind(&notification.title)
    .bind(&notification.body)
    .bind(subject_kind)
    .bind(subject_id)
    .bind(notification.origin_id)
    .bind(&notification.payload)
    .execute(&mut **tx)
    .await?;

    // One statement rather than a loop: the recipients are a set, and a
    // partial insert would tell some people and not others.
    sqlx::query(
        "INSERT INTO notification_recipient (notification_id, username)
         SELECT $1, username FROM unnest($2::text[]) AS username",
    )
    .bind(notification_id)
    .bind(recipients)
    .execute(&mut **tx)
    .await?;

    // Announced on the stream so an open screen learns without polling. The
    // audience is exactly the recipients, so this never reaches anybody whose
    // list would not contain it.
    super::chat::record_event(
        tx,
        "notification",
        None,
        None,
        recipients,
        json!({
            "notification_id": notification_id,
            "kind": notification.kind,
            "title": notification.title,
        }),
    )
    .await?;
    Ok(Some(notification_id))
}

/// Work that became late while nobody was looking.
///
/// # Why a pass and not an event
///
/// Nothing in this estate fires when a timestamp goes by. An asset registered
/// on the 1st is not "overdue for assessment" because somebody did something on
/// the 8th — it is overdue because a week went past, and no request happened at
/// that moment to hang a notification on. The catalogue publisher makes the
/// same argument for a promotion whose window opened at midnight; this is that
/// pattern, applied to work rather than to prices.
///
/// # Raised once, and the guard is the point
///
/// A condition that is still true tomorrow must not be told again tomorrow.
/// Seven days of "this asset is still unassessed" is how a notification list
/// becomes something people stop opening, so the pass skips anything it has
/// already raised for that record. What stays visible in the meantime is the
/// COUNT on the register — a standing condition belongs in a number, and the
/// one notification marks the moment it began.
///
/// Returns how many were raised, which is zero on almost every pass.
pub async fn sweep_ageing_work(pool: &PgPool) -> Result<u64, AppError> {
    const AGEING: &str = "asset.assessment.overdue";
    const ARRIVING: &str = "purchase.delivery.due_soon";

    let mut tx = pool.begin().await?;
    // Registered a week ago and still nobody has said what it is worth. The
    // register keeps this as an open control gap — Operations put a thing on
    // the books and Finance has not decided a treatment — and until now the
    // only way to find one was to open the screen and filter for it.
    let stale: Vec<(Uuid, String, String, String)> = sqlx::query_as(
        "SELECT a.asset_id, a.asset_number, a.name, a.site_id
           FROM fixed_asset a
          WHERE a.acquired_on <= CURRENT_DATE - INTERVAL '7 days'
            AND a.disposed_on IS NULL
            AND NOT EXISTS (SELECT 1 FROM asset_capitalization c
                             WHERE c.asset_id = a.asset_id)
            AND NOT EXISTS (SELECT 1 FROM notification n
                             WHERE n.kind = $1 AND n.subject_id = a.asset_id::text)
          ORDER BY a.acquired_on
          LIMIT 50",
    )
    .bind(AGEING)
    .fetch_all(&mut *tx)
    .await?;

    let mut raised = 0;

    // ── A delivery is nearly due ─────────────────────────────────────────
    //
    // The supplier promised a date per line, and nothing in this estate fires
    // when that date approaches. Three days is the warning the warehouse asked
    // for: long enough to clear a receiving bay and put somebody on the rota,
    // short enough that it is still the same week.
    //
    // Told to the people at the DESTINATION, not to everybody: a delivery
    // landing at store-07 is store-07's morning. This is the second caller of
    // `recipients_with_role_at` and the one that pays for it — a PO warning
    // fanned out to fourteen units would be thirteen interruptions and one
    // notice.
    //
    // Anything already past its date is left alone. "It should have arrived
    // yesterday" is a standing condition and belongs to the receiving screen's
    // count, not to a notice that would repeat every hour until somebody
    // closed the order.
    let arriving: Vec<(Uuid, String, String, String, chrono::NaiveDate)> = sqlx::query_as(
        "SELECT o.purchase_order_id, o.po_number, o.supplier_name, o.destination_site_id,
                min(l.promised_date) AS due
           FROM purchase_order o
           JOIN purchase_order_line l ON l.purchase_order_id = o.purchase_order_id
          WHERE o.order_status = 'ISSUED'
            AND l.promised_date IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM notification n
                             WHERE n.kind = $1
                               AND n.subject_id = o.purchase_order_id::text)
          GROUP BY o.purchase_order_id, o.po_number, o.supplier_name, o.destination_site_id
         HAVING min(l.promised_date) BETWEEN CURRENT_DATE AND CURRENT_DATE + 3
          ORDER BY due
          LIMIT 50",
    )
    .bind(ARRIVING)
    .fetch_all(&mut *tx)
    .await?;

    for (order_id, number, supplier, site, due) in arriving {
        let days = (due - chrono::Utc::now().date_naive()).num_days();
        let when = match days {
            0 => "hari ini".to_owned(),
            1 => "besok".to_owned(),
            other => format!("dalam {other} hari"),
        };
        // Three vocabularies name a place in this system and they do not
        // agree: a site is `dc`, a posting is at `ho`, and a purchase order is
        // destined for `dc-01`. So the scoped lookup can legitimately match
        // nobody, and an audience of nobody makes `raise_notification` a
        // silent no-op — the worst possible outcome for a warning.
        //
        // Rather than guessing a mapping here, which is how a notification
        // ends up at the wrong shop, the notice falls back to head office and
        // says out loud that it could not find anybody local. Somebody is
        // always told; the log says when the addressing was the reason.
        let audience = recipients_with_role_at(&mut tx, &["ADMIN", "SUPERVISOR"], &site).await?;

        // Whether anybody LOCAL was found, which is not the same question as
        // whether the audience is empty — an Admin reaches everywhere, so the
        // list is never empty while one exists and the miss would be silent.
        // Measured by asking who was found without the rung that ignores
        // place.
        //
        // It matters because this estate is where the three names for a place
        // meet: the site is `dc`, the posting is at `ho`, and this order is
        // destined for `dc-01`. Nothing maps one to another, so the warehouse
        // supervisors — the people who would actually clear a bay — match
        // nothing and only head office is told. Guessing a mapping here is how
        // a delivery notice arrives at the wrong unit, so the notice goes out
        // and the log says plainly that its audience was narrower than it
        // should have been.
        let local = recipients_with_role_at(&mut tx, &["SUPERVISOR"], &site).await?;
        if local.is_empty() {
            tracing::warn!(
                %site,
                %number,
                "no posting matches this delivery's destination, so nobody local was told"
            );
        }
        raise_notification(
            &mut tx,
            NewNotification {
                kind: ARRIVING,
                title: format!("{number} dijanjikan tiba {when}"),
                body: format!(
                    "{supplier} menjanjikan {due} untuk {site}. Siapkan penerimaan dan \
                     penandaan sebelum barangnya berdiri di lantai."
                ),
                subject: Some(("purchase_order", order_id.to_string())),
                origin_id: None,
                payload: serde_json::json!({
                    "purchase_order_id": order_id,
                    "site_id": site,
                    "promised_date": due,
                }),
            },
            &audience,
        )
        .await?;
        raised += 1;
    }

    if stale.is_empty() {
        tx.commit().await?;
        return Ok(raised);
    }

    // Head office decides what an asset is worth wherever it stands, so this
    // one is not narrowed by place.
    let audience = recipients_with_role(&mut tx, &["ADMIN"]).await?;
    for (asset_id, number, name, site) in stale {
        raise_notification(
            &mut tx,
            NewNotification {
                kind: AGEING,
                title: format!("{name} is still unassessed"),
                body: format!(
                    "{number} at {site} was registered over a week ago and nobody has                      decided what it is worth, so nothing is being charged for it."
                ),
                subject: Some(("asset", asset_id.to_string())),
                origin_id: None,
                payload: serde_json::json!({ "asset_id": asset_id, "site_id": site }),
            },
            &audience,
        )
        .await?;
        raised += 1;
    }
    tx.commit().await?;
    Ok(raised)
}

/// One reader's notifications, one page at a time, beside the shape of the
/// whole list.
///
/// Brought up to the shape `list_employees` sets: a scope struct in, an
/// envelope out, a keyset over a named sort, and facet counts drawn from the
/// same row definition the page is.
pub async fn list_notifications_for(
    pool: &PgPool,
    username: &str,
    scope: NotificationScope,
) -> Result<NotificationPage, AppError> {
    // A blank search is not a search: `Some("")` compiles to `ILIKE '%%'`,
    // which matches everything and costs a scan to say so.
    let needle = scope
        .needle
        .as_deref()
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(|text| format!("%{text}%"));

    // The sort, and the tie-break that makes it total. Every order ends in the
    // notification id, so no two rows can compare equal — which is what stops a
    // keyset repeating or losing the rows that tie. `created_at` alone would
    // not do it: a broadcast writes a row per reader in one statement.
    //
    // TWO spellings of the same thing, and they are not interchangeable:
    // `ORDER BY` takes directions, a ROW EXPRESSION does not.
    let lead = match scope.sort.as_deref() {
        Some("kind") => "kind",
        _ => "created_at",
    };
    let cols = format!("{lead}, notification_id");
    let dir = if scope.desc { "DESC" } else { "ASC" };
    let order = format!("{lead} {dir}, notification_id {dir}");
    let seek = if scope.desc { "<" } else { ">" };

    let cursor = scope
        .cursor
        .as_deref()
        .map(NotificationCursor::decode)
        .transpose()?;
    let limit = scope
        .limit
        .unwrap_or(FEED_DEFAULT_LIMIT)
        .clamp(1, FEED_MAX_LIMIT);

    // The seek re-reads the previous row's own sort value rather than trusting
    // one encoded in the cursor. A cursor whose row the filters no longer keep
    // — something marked read between one page and the next, while `unread` is
    // on — finds nothing to compare against, so the page comes back empty: the
    // list ends early rather than starting again, and stopping is visible.
    // `NOT MATERIALIZED`: `kept` is referenced twice — as the page and
    // inside the seek — and two references makes PostgreSQL materialise a
    // CTE, which is an optimisation fence the `ORDER BY … LIMIT` cannot be
    // pushed through. Materialised, this reads the whole table and sorts it
    // to hand back one page; inlined, it seeks the index. See
    // `postgres::audit::list_audit`, where the difference was measured.
    let sql = format!(
        "WITH searched AS NOT MATERIALIZED ({FEED_ROWS}),
              kept AS NOT MATERIALIZED (
             SELECT * FROM searched {FEED_FILTERS}
         )
         SELECT * FROM kept
          WHERE $5::uuid IS NULL
             OR ({cols}) {seek} (SELECT {cols} FROM kept WHERE notification_id = $5)
          ORDER BY {order}
          LIMIT $6"
    );
    let rows = sqlx::query(&sql)
        .bind(username)
        .bind(&needle)
        .bind(scope.unread_only)
        .bind(&scope.kind)
        .bind(cursor.as_ref().map(|one| one.notification_id))
        .bind(limit)
        .fetch_all(pool)
        .await?;

    // A short page is the last page. A full one may not be — the next request
    // can come back empty — and that is the honest answer.
    let next_cursor = match rows.last() {
        Some(row) if rows.len() as i64 == limit => Some(
            NotificationCursor {
                notification_id: row.try_get("notification_id")?,
            }
            .encode()?,
        ),
        _ => None,
    };

    let items = rows
        .iter()
        .map(row_to_notification)
        .collect::<Result<Vec<_>, _>>()?;

    // Counted from the SAME rows the page is drawn from, so the reader fence
    // applies to the counts as well: a facet panel counted over a wider set
    // would tell one colleague how much work another has waiting.
    //
    // Per-value counts read the SEARCHED set, ignoring what is filtered — the
    // number beside `UNREAD` answers "how many are unread". The total reads the
    // FILTERED set, because it describes the list on screen.
    let counted = sqlx::query(&format!(
        "WITH searched AS ({FEED_ROWS}), kept AS (
             SELECT * FROM searched {FEED_FILTERS}
         )
         SELECT 'kind' AS facet, kind AS value, COUNT(*)::bigint AS n
           FROM searched GROUP BY kind
          UNION ALL
         SELECT 'state', state, COUNT(*)::bigint FROM searched GROUP BY state
          UNION ALL
         SELECT 'all', '', COUNT(*)::bigint FROM kept"
    ))
    .bind(username)
    .bind(&needle)
    .bind(scope.unread_only)
    .bind(&scope.kind)
    .fetch_all(pool)
    .await?;

    let mut total = 0i64;
    let (mut kinds, mut states) = (Vec::new(), Vec::new());
    for row in &counted {
        let facet: String = row.try_get("facet")?;
        let one = NotificationFacet {
            value: row.try_get("value")?,
            label: None,
            count: row.try_get("n")?,
        };
        match facet.as_str() {
            "kind" => kinds.push(one),
            "state" => states.push(one),
            _ => total = one.count,
        }
    }
    // Biggest first, with ties broken on the value so the order is stable
    // between calls — a filter list that reshuffles under the cursor is one
    // nobody can click.
    for list in [&mut kinds, &mut states] {
        list.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.value.cmp(&b.value)));
    }

    Ok(NotificationPage {
        items,
        // Still the reader's WHOLE unread count, unnarrowed by search or
        // filter, because it is what the badge shows. It is deliberately not
        // `total` and deliberately not the `UNREAD` facet: those describe the
        // list on screen, and a badge that changed when somebody typed in the
        // search box would be a badge nobody trusts.
        unread: unread_notification_count(pool, username).await?,
        next_cursor,
        total,
        facets: NotificationFacets { kinds, states },
    })
}

pub async fn unread_notification_count(pool: &PgPool, username: &str) -> Result<i64, AppError> {
    Ok(sqlx::query_scalar(
        "SELECT count(*)::bigint FROM notification_recipient
          WHERE username = $1 AND read_at IS NULL",
    )
    .bind(username)
    .fetch_one(pool)
    .await?)
}

/// Mark one as dealt with, for this reader only.
///
/// `read_at IS NULL` in the WHERE rather than an unconditional UPDATE: two
/// tabs marking the same row should agree on when it was read, and the first
/// answer is the true one.
pub async fn mark_notification_read(
    pool: &PgPool,
    username: &str,
    notification_id: Uuid,
) -> Result<(), AppError> {
    let updated = sqlx::query(
        "UPDATE notification_recipient SET read_at = now()
          WHERE notification_id = $1 AND username = $2 AND read_at IS NULL",
    )
    .bind(notification_id)
    .bind(username)
    .execute(pool)
    .await?;
    if updated.rows_affected() == 0 {
        // Either already read or not this person's. Both are fine outcomes
        // for a button somebody pressed twice; only a missing row is not.
        let exists: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM notification_recipient
                            WHERE notification_id = $1 AND username = $2)",
        )
        .bind(notification_id)
        .bind(username)
        .fetch_one(pool)
        .await?;
        if !exists {
            return Err(AppError::NotFound(format!(
                "notification {notification_id} was not sent to {username}"
            )));
        }
    }
    Ok(())
}

/// Clear the badge. Returns how many were actually cleared, so the screen can
/// say what it did rather than merely that it did something.
pub async fn mark_all_notifications_read(pool: &PgPool, username: &str) -> Result<u64, AppError> {
    Ok(sqlx::query(
        "UPDATE notification_recipient SET read_at = now()
          WHERE username = $1 AND read_at IS NULL",
    )
    .bind(username)
    .execute(pool)
    .await?
    .rows_affected())
}

/// What one reader's list looks like from far away: how many rows, and how
/// many of them are unread.
///
/// The notification stream compares this between polls rather than following
/// a cursor. A cursor over `created_at` would skip a notification whose
/// transaction started before the last poll and committed after it — its
/// timestamp is the transaction's, not the commit's — and a skipped
/// notification is exactly the failure this list exists to prevent. A new row
/// always moves `total`, a read always moves `unread`, whenever it commits.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub struct NotificationDigest {
    pub total: i64,
    pub unread: i64,
}

pub async fn notification_digest(
    pool: &PgPool,
    username: &str,
) -> Result<NotificationDigest, AppError> {
    let row = sqlx::query(
        "SELECT count(*)::bigint AS total,
                count(*) FILTER (WHERE read_at IS NULL)::bigint AS unread
           FROM notification_recipient
          WHERE username = $1",
    )
    .bind(username)
    .fetch_one(pool)
    .await?;
    Ok(NotificationDigest {
        total: row.try_get("total")?,
        unread: row.try_get("unread")?,
    })
}

/// The reader's unread notifications written since `since`, newest first.
///
/// The stream asks this when `total` grew, and remembers which ids it has
/// already announced, so a notification is announced once however late its
/// transaction committed — as long as it was written after `since`, which the
/// stream sets a few minutes before it connected.
pub async fn unread_notifications_since(
    pool: &PgPool,
    username: &str,
    since: DateTime<Utc>,
    limit: i64,
) -> Result<Vec<Notification>, AppError> {
    let rows = sqlx::query(
        "SELECT n.notification_id, n.kind, n.title, n.body, n.subject_kind,
                n.subject_id, n.origin_id, n.created_at, r.read_at
           FROM notification_recipient r
           JOIN notification n ON n.notification_id = r.notification_id
          WHERE r.username = $1 AND r.read_at IS NULL AND n.created_at >= $2
          ORDER BY n.created_at DESC
          LIMIT $3",
    )
    .bind(username)
    .bind(since)
    .bind(limit.clamp(1, 100))
    .fetch_all(pool)
    .await?;
    rows.iter().map(row_to_notification).collect()
}

/// Whether the session a stream was opened with is still one.
///
/// The session gate is asked once, when the stream connects; a stream is open
/// for hours. Without asking again, signing out — or being signed out by a
/// sign-in on another device — would leave a tab still being told somebody's
/// work. The same conditions as `authenticate_session`, idle time included,
/// and deliberately without touching `last_seen_at`: an open tab is not a
/// person using it.
pub async fn session_is_live(
    pool: &PgPool,
    session_id: Uuid,
    idle_minutes: i64,
) -> Result<bool, AppError> {
    Ok(sqlx::query_scalar(
        "SELECT EXISTS (
             SELECT 1 FROM auth_session s
               JOIN app_user u ON u.id = s.user_id
              WHERE s.session_id = $1
                AND s.revoked_at IS NULL
                AND s.expires_at > now()
                AND s.last_seen_at > now() - make_interval(mins => $2::int)
                AND u.active
                AND u.auth_version = s.auth_version)",
    )
    .bind(session_id)
    .bind(idle_minutes.clamp(1, 24 * 60) as i32)
    .fetch_one(pool)
    .await?)
}
