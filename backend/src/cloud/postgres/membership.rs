//! The member directory, and the segments it falls into.
//!
//! `member.rs` next door is about *identity* — enrolling a card, issuing the
//! code a cashier reads out, resolving a shopper's session. This is the other
//! question: who are they, all of them, and which of them is worth a phone
//! call. A loyalty scheme nobody can list is a table with a foreign key into
//! it, not a scheme.
//!
//! # A segment is derived, not stored
//!
//! There is no `segment` column and no `member_segment` table, and that is the
//! central decision in this file. A segment is a statement about behaviour —
//! "has not bought in six months" — and behaviour changes without anybody
//! touching the member's row. A stored segment is therefore wrong from the day
//! after it is written until something recomputes it, and the failure is
//! silent: a campaign goes out to the people who *were* lapsing in March.
//!
//! The same argument the `member` table already makes about tiers and totals
//! ("derived from `edge_sale`, and a stored copy is one that goes stale
//! against the sales that earned it") applies here with more force, because a
//! segment is the thing somebody sends a message to.
//!
//! # The segments are exhaustive and exclusive
//!
//! Every member is in exactly one, so the counts add up to the directory and a
//! reader can check the arithmetic. That rules out the tempting overlapping
//! kind — "big spenders", "members who like outerwear" — which are real
//! questions and belong to a query builder, not to a fixed list of six. What
//! is here is the one axis every retailer starts from, because it is the one
//! that says who to talk to: how long ago somebody last came in.
//!
//! Those overlapping questions now have their answer next door in
//! `segments.rs`, and it keeps this file's rule rather than breaking it: what
//! is stored there is the *definition*, and the membership is still worked out
//! on every read, by the same `FROM` this file declares.

use crate::cloud::application::AppError;
use crate::cloud::reports::compile::{bind_params, Narrowing};
use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{postgres::PgRow, PgPool, Row};
use uuid::Uuid;

/// How recently somebody has to have bought to count as still with us.
///
/// Ninety days is a quarter, which is the window a fashion retailer already
/// thinks in — a season. It is stated here as a constant rather than buried in
/// the SQL because the number is a business decision and somebody will want to
/// change it, and it is returned to the client so a screen can say what its
/// own words mean rather than making a reader guess at "lapsing".
pub const ACTIVE_DAYS: i32 = 90;

/// And how long after that before they have gone.
///
/// Six months. Beyond it the honest description is "a former customer", and
/// the marketing that goes to them is a different message from the one that
/// goes to somebody who is merely late.
pub const LAPSING_DAYS: i32 = 180;

/// Which segment a member is in, decided once and read by everything below.
///
/// One expression, in one constant, because the directory colours a row with
/// it, the segment book counts with it and the report catalogue offers it as a
/// column to filter on — and four spellings of a six-branch CASE drift the
/// first time somebody changes ninety to sixty. The order of the branches IS
/// the definition: a blocked member is blocked whatever they spent, somebody
/// who has never bought is never "lapsed", and a first purchase inside the
/// window makes somebody new rather than merely active.
///
/// **The windows are written out as literals rather than bound.** They are our
/// own two integers and never a caller's, and the catalogue holds this string
/// as a `&'static str` that cannot carry a parameter. `the_windows_are_the_two
/// _the_screen_prints` is the test that keeps the literals here and the
/// constants above saying the same thing.
pub const SEGMENT_CASE: &str = "
    CASE
        WHEN m.blocked_at IS NOT NULL                              THEN 'BLOCKED'
        WHEN s.last_purchase_at IS NULL                            THEN 'NEVER'
        WHEN s.first_purchase_at >= now() - make_interval(days => 90)
                                                                   THEN 'NEW'
        WHEN s.last_purchase_at  >= now() - make_interval(days => 90)
                                                                   THEN 'ACTIVE'
        WHEN s.last_purchase_at  >= now() - make_interval(days => 180)
                                                                   THEN 'LAPSING'
        ELSE 'LAPSED'
    END";

/// Where a member row comes from: the card, what has been bought on it, and
/// what is still owed back on vouchers.
///
/// One `FROM` for the three readers of this idea — the directory listing, the
/// segment book, and the `member` dataset in the report catalogue, which is
/// what lets a saved segment be a filter over these same aliases. Written with
/// subqueries rather than CTEs precisely so the catalogue can hold it: a
/// dataset's source is spliced after a `SELECT` somebody else wrote, and a
/// `WITH` cannot go there.
///
/// The aliases are load-bearing. Every expression in the catalogue's `member`
/// dataset is written against `m`, `s` and `h`, and those expressions are
/// spliced into [`list_members`]'s own `WHERE` when a saved segment narrows
/// it. Rename one here and the narrowing stops compiling — which is the
/// failure worth having, rather than the one where it silently matches nobody.
pub const MEMBER_SOURCE: &str = "
    FROM member m
    LEFT JOIN (
        SELECT customer_id,
               count(*)::bigint                                AS transaction_count,
               COALESCE(sum(total_minor), 0)::bigint           AS spent_minor,
               COALESCE(sum(discount_total_minor), 0)::bigint  AS saved_minor,
               COALESCE(sum(points_earned), 0)::bigint         AS points_earned_total,
               min(occurred_at)                                AS first_purchase_at,
               max(occurred_at)                                AS last_purchase_at
          FROM edge_sale
         WHERE customer_id IS NOT NULL AND btrim(customer_id) <> ''
         GROUP BY customer_id
    ) s ON s.customer_id = m.member_id
    LEFT JOIN (
        SELECT member_id, sum(balance_minor)::bigint AS voucher_balance_minor
          FROM voucher
         WHERE member_id IS NOT NULL AND status = 'ACTIVE'
         GROUP BY member_id
    ) h ON h.member_id = m.member_id";

/// How long since somebody was last in, in whole days.
///
/// Floored, because a screen saying "3 days ago" about something 3.9 days old
/// is what everybody means by it. Here rather than inline because the
/// catalogue offers it as a filterable column and the directory prints it, and
/// those two had better be the same number.
pub const DAYS_SINCE_PURCHASE: &str = "
    CASE WHEN s.last_purchase_at IS NULL THEN NULL
         ELSE floor(extract(epoch FROM now() - s.last_purchase_at) / 86400)::bigint
    END";

/// Whether a phone is currently paired to this card.
pub const PAIRED: &str = "
    EXISTS (SELECT 1 FROM member_session ms
             WHERE ms.member_id = m.member_id
               AND ms.revoked_at IS NULL
               AND ms.expires_at > now())";

/// One member, as the directory lists them.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct MemberRow {
    /// The number on the card, which is also what `edge_sale.customer_id`
    /// carries. Not a uuid — see `0082`, which argues it at length.
    pub member_id: String,
    /// Optional, because a shopper who will not give a name still gets a card
    /// and a required name is a required lie.
    pub display_name: Option<String>,
    pub joined_on: NaiveDate,
    /// Set when a membership was stopped. Blocked rather than deleted: the
    /// sales stay, and deleting would leave them attributed to nobody.
    pub blocked_at: Option<DateTime<Utc>>,
    /// Whether they have ever paired a phone to this card. The difference
    /// between a customer the shop can reach and one it can only serve.
    pub paired: bool,
    pub transaction_count: i64,
    /// What they paid, after promotions.
    pub spent_minor: i64,
    /// What promotions took off, over the same sales.
    pub saved_minor: i64,
    pub points_earned_total: i64,
    pub first_purchase_at: Option<DateTime<Utc>>,
    pub last_purchase_at: Option<DateTime<Utc>>,
    /// How long since they were last in. `None` for somebody who never has
    /// been — which is not the same as a very large number, and a screen that
    /// sorted them together would put the two most different cases side by
    /// side.
    pub days_since_purchase: Option<i64>,
    /// What they are still holding on vouchers. Money the shop owes this
    /// person specifically, and the reason to answer the phone when they call.
    pub voucher_balance_minor: i64,
    /// Which of the six they are in, by the rule above.
    pub segment: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct MemberDirectory {
    pub members: Vec<MemberRow>,
    /// Everybody enrolled, not just the page. So a filtered list can say what
    /// it is a fraction of.
    pub member_count: i64,
}

/// One segment, and what it is worth.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SegmentRow {
    /// `ACTIVE`, `LAPSING`, … The screen names it; this is the key the
    /// directory filters on, so the two cannot disagree about what a word
    /// means.
    pub key: String,
    pub members: i64,
    pub spent_minor: i64,
    pub transaction_count: i64,
    /// Per member in the segment, not per sale. The figure that says whether a
    /// segment is worth a campaign — a hundred lapsed members who spent
    /// 2,000,000 each are a different problem from a hundred who spent 50,000.
    pub average_spend_minor: i64,
    /// The most recent purchase by anybody in it. On `NEVER` it is null, which
    /// is the point of the row.
    pub last_purchase_at: Option<DateTime<Utc>>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SegmentBook {
    /// All six, always, in the order a reader walks them — from the people who
    /// just arrived to the people who have gone. A segment with nobody in it
    /// is a row reading zero, never a row that is missing: "we have no lapsed
    /// members" and "the query did not return that segment" look identical
    /// otherwise.
    pub segments: Vec<SegmentRow>,
    pub member_count: i64,
    /// Shoppers the till has attributed a sale to who are not enrolled here.
    ///
    /// They are not a segment — they are not members — but leaving them
    /// unmentioned would make the directory look like the whole customer base
    /// when it is only the part that has a card. Sales arrive from edge nodes
    /// that have never seen the `member` table, so this number is expected to
    /// be above zero and is not a fault.
    pub unenrolled_count: i64,
    pub unenrolled_spent_minor: i64,
    /// The two windows the words above mean, so a screen can say "90 days"
    /// rather than leaving a reader to guess what "lapsing" is.
    pub active_days: i32,
    pub lapsing_days: i32,
}

/// Somebody the till named on a sale who was never enrolled.
///
/// Not a member and deliberately not a seventh segment — they hold no card and
/// the scheme does not know them. What they are is the shop's own backlog: the
/// till has been crediting points to this number sale after sale, and nobody
/// can ever see them, because points are read through a card and there is no
/// card.
///
/// Two different things live in this list and the columns are chosen to tell
/// them apart. One is a real customer whose card was never enrolled — several
/// sales, more than one shop, months apart — and enrolling that number hands
/// them their whole history at once, because everything in this file joins on
/// `member_id = edge_sale.customer_id`. The other is a typing mistake: one
/// sale, one shop, one day. Nothing can repair the second — the number is
/// written on a completed sale and a shop's takings are not editable from a
/// customer screen — but it can at least be seen, which is more than the bare
/// count on the segment book could say.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct UnenrolledRow {
    /// Exactly the text the till wrote. Not trimmed or upper-cased on the way
    /// out: what is on screen has to be what would have to be typed to enrol
    /// it, or the enrolment would create a *third* number rather than adopting
    /// this one.
    pub customer_id: String,
    pub transaction_count: i64,
    pub spent_minor: i64,
    /// Points already credited to nobody. The figure that says what enrolling
    /// this number would hand back.
    pub points_earned_total: i64,
    /// How many different shops wrote this number. One is the shape of a
    /// mistake; several is the shape of a customer.
    pub site_count: i64,
    pub first_purchase_at: DateTime<Utc>,
    pub last_purchase_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct UnenrolledList {
    pub strangers: Vec<UnenrolledRow>,
    /// The whole backlog, not the page — so a truncated list can say what
    /// fraction of it is on screen.
    pub unenrolled_count: i64,
    pub unenrolled_spent_minor: i64,
}

/// The six, in reading order. Also what guarantees every one is returned.
const SEGMENT_ORDER: [&str; 6] = ["NEW", "ACTIVE", "LAPSING", "LAPSED", "NEVER", "BLOCKED"];

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct MemberQuery {
    /// One of the six. Anything else is refused rather than silently matching
    /// nothing — a filter that returns an empty list for a typo is worse than
    /// one that says the word is not a segment.
    pub segment: Option<String>,
    /// A saved segment, by id.
    ///
    /// The id and not the clauses. A caller holding the clauses is holding a
    /// copy that stops agreeing with the definition the moment somebody edits
    /// it, and the list would then differ from the count on the card that
    /// linked here — the one comparison a reader is guaranteed to make.
    pub segment_id: Option<Uuid>,
    /// Card number or name.
    pub q: Option<String>,
    pub limit: Option<i64>,
}

const DEFAULT_PAGE: i64 = 200;
const MAX_PAGE: i64 = 1_000;

fn member_from_row(row: &PgRow) -> Result<MemberRow, AppError> {
    Ok(MemberRow {
        member_id: row.try_get("member_id")?,
        display_name: row.try_get("display_name")?,
        joined_on: row.try_get("joined_on")?,
        blocked_at: row.try_get("blocked_at")?,
        paired: row.try_get("paired")?,
        transaction_count: row.try_get("transaction_count")?,
        spent_minor: row.try_get("spent_minor")?,
        saved_minor: row.try_get("saved_minor")?,
        points_earned_total: row.try_get("points_earned_total")?,
        first_purchase_at: row.try_get("first_purchase_at")?,
        last_purchase_at: row.try_get("last_purchase_at")?,
        days_since_purchase: row.try_get("days_since_purchase")?,
        voucher_balance_minor: row.try_get("voucher_balance_minor")?,
        segment: row.try_get("segment")?,
    })
}

fn checked_segment(raw: Option<&str>) -> Result<Option<String>, AppError> {
    let Some(value) = raw.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    let upper = value.to_ascii_uppercase();
    if !SEGMENT_ORDER.contains(&upper.as_str()) {
        return Err(AppError::Validation(format!(
            "{value:?} is not a segment — expected one of {}",
            SEGMENT_ORDER.join(", ")
        )));
    }
    Ok(Some(upper))
}

/// Everybody holding a card, with what they have spent joined on.
///
/// A member with no purchases is not an error and not an omission: they are
/// somebody who was handed a card and has not used it yet, and they are the
/// segment worth the most attention. Hence the LEFT JOIN, and hence `NEVER`
/// being a segment rather than a gap.
/// `narrowing` is a saved segment's definition, already compiled against the
/// `member` dataset. Applied here rather than in the browser because a segment
/// is a statement about the whole directory: a page of a thousand rows narrowed
/// after the fact would answer a different question, and would disagree with
/// the count on the card that linked here.
pub async fn list_members(
    pool: &PgPool,
    query: MemberQuery,
    narrowing: Option<&Narrowing>,
) -> Result<MemberDirectory, AppError> {
    let limit = query.limit.unwrap_or(DEFAULT_PAGE).clamp(1, MAX_PAGE);
    let segment = checked_segment(query.segment.as_deref())?;
    let search = query
        .q
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_uppercase);

    // Placeholders continue from the three bound below, which is the whole
    // contract between this query and the compiler: it is told where to start
    // numbering and never guesses.
    let extra = match narrowing.and_then(|one| one.sql.as_deref()) {
        Some(fragment) => format!("\n            AND ({fragment})"),
        None => String::new(),
    };

    let sql = format!(
        "SELECT m.member_id, m.display_name, m.joined_on, m.blocked_at,
                {PAIRED}                                         AS paired,
                COALESCE(s.transaction_count, 0)                 AS transaction_count,
                COALESCE(s.spent_minor, 0)                       AS spent_minor,
                COALESCE(s.saved_minor, 0)                       AS saved_minor,
                COALESCE(s.points_earned_total, 0)               AS points_earned_total,
                s.first_purchase_at,
                s.last_purchase_at,
                {DAYS_SINCE_PURCHASE}                            AS days_since_purchase,
                COALESCE(h.voucher_balance_minor, 0)             AS voucher_balance_minor,
                {SEGMENT_CASE}                                   AS segment
           {MEMBER_SOURCE}
          WHERE ($1::text IS NULL OR {SEGMENT_CASE} = $1)
            AND ($2::text IS NULL
                 OR upper(m.member_id) LIKE '%' || $2 || '%'
                 OR upper(COALESCE(m.display_name, '')) LIKE '%' || $2 || '%'){extra}
          -- Biggest spenders first. The directory is read to find somebody,
          -- and failing that, to see who matters.
          ORDER BY COALESCE(s.spent_minor, 0) DESC, m.member_id
          LIMIT $3"
    );
    let mut statement = sqlx::query(&sql).bind(&segment).bind(&search).bind(limit);
    if let Some(one) = narrowing {
        statement = bind_params(statement, &one.params);
    }
    let rows = statement.fetch_all(pool).await?;

    let member_count = sqlx::query_scalar::<_, i64>("SELECT count(*)::bigint FROM member")
        .fetch_one(pool)
        .await?;

    Ok(MemberDirectory {
        members: rows
            .iter()
            .map(member_from_row)
            .collect::<Result<Vec<_>, _>>()?,
        member_count,
    })
}

/// The six segments, counted and valued.
///
/// One pass over the directory rather than six counting queries, and every
/// segment present whether or not anybody is in it — `SEGMENT_ORDER` is
/// left-joined against the counts precisely so a zero is a zero and not an
/// absence.
pub async fn member_segments(pool: &PgPool) -> Result<SegmentBook, AppError> {
    let rows = sqlx::query(&format!(
        "WITH placed AS (
                  SELECT {SEGMENT_CASE}                          AS segment,
                         COALESCE(s.transaction_count, 0)        AS transaction_count,
                         COALESCE(s.spent_minor, 0)              AS spent_minor,
                         s.last_purchase_at
                  {MEMBER_SOURCE}
              )
         SELECT k.key                                            AS key,
                count(p.segment)::bigint                         AS members,
                COALESCE(sum(p.spent_minor), 0)::bigint          AS spent_minor,
                COALESCE(sum(p.transaction_count), 0)::bigint    AS transaction_count,
                max(p.last_purchase_at)                          AS last_purchase_at
           FROM unnest($1::text[]) WITH ORDINALITY AS k(key, ord)
           LEFT JOIN placed p ON p.segment = k.key
          GROUP BY k.key, k.ord
          ORDER BY k.ord"
    ))
    .bind(SEGMENT_ORDER.map(str::to_owned).to_vec())
    .fetch_all(pool)
    .await?;

    let segments = rows
        .iter()
        .map(|row| {
            let members: i64 = row.try_get("members")?;
            let spent_minor: i64 = row.try_get("spent_minor")?;
            Ok(SegmentRow {
                key: row.try_get("key")?,
                members,
                spent_minor,
                transaction_count: row.try_get("transaction_count")?,
                // Integer division, and zero members means zero rather than a
                // division by nothing. Rounding a per-member average to the
                // rupiah is well inside the noise of the figure it describes.
                average_spend_minor: if members == 0 {
                    0
                } else {
                    spent_minor / members
                },
                last_purchase_at: row.try_get("last_purchase_at")?,
            })
        })
        .collect::<Result<Vec<SegmentRow>, AppError>>()?;

    // Everybody the till has named on a sale who is not in `member`. Counted
    // separately rather than folded into a seventh segment, because they are
    // not members and a segment book that included them could not be read as
    // "the scheme".
    let unenrolled = sqlx::query(
        "SELECT count(*)::bigint                         AS unenrolled_count,
                COALESCE(sum(spent_minor), 0)::bigint    AS unenrolled_spent_minor
           FROM (
               SELECT customer_id, sum(total_minor) AS spent_minor
                 FROM edge_sale
                WHERE customer_id IS NOT NULL AND btrim(customer_id) <> ''
                  AND NOT EXISTS (SELECT 1 FROM member m
                                   WHERE m.member_id = edge_sale.customer_id)
                GROUP BY customer_id
           ) strangers",
    )
    .fetch_one(pool)
    .await?;

    let member_count = segments.iter().map(|segment| segment.members).sum();

    Ok(SegmentBook {
        segments,
        member_count,
        unenrolled_count: unenrolled.try_get("unenrolled_count")?,
        unenrolled_spent_minor: unenrolled.try_get("unenrolled_spent_minor")?,
        active_days: ACTIVE_DAYS,
        lapsing_days: LAPSING_DAYS,
    })
}

/// The backlog behind `unenrolled_count`: who those numbers actually are.
///
/// The count on the segment book has been there since the book existed, and a
/// count is not something anybody can act on. This is the same population,
/// named, so that the two acts it deserves are possible: enrol the ones that
/// are real customers, and see the ones that are typing mistakes.
///
/// **Ordered by what has been spent**, because that is the size of what
/// enrolling one would hand back. Not by recency: a number written yesterday
/// with one sale on it is the least urgent row here, and would otherwise sit
/// at the top of every page.
///
/// The grouping is the same `strangers` subquery the count uses — deliberately
/// written out again rather than shared through a CTE, because [`MEMBER_SOURCE`]
/// explains why nothing in this file may use `WITH`, and two readers of one
/// three-line `WHERE` is cheaper than a source the catalogue cannot splice.
pub async fn list_unenrolled(
    pool: &PgPool,
    limit: Option<i64>,
) -> Result<UnenrolledList, AppError> {
    let limit = limit.unwrap_or(DEFAULT_PAGE).clamp(1, MAX_PAGE);
    let rows = sqlx::query(
        "SELECT customer_id,
                count(*)::bigint                          AS transaction_count,
                COALESCE(sum(total_minor), 0)::bigint     AS spent_minor,
                COALESCE(sum(points_earned), 0)::bigint   AS points_earned_total,
                count(DISTINCT site_id)::bigint           AS site_count,
                min(occurred_at)                          AS first_purchase_at,
                max(occurred_at)                          AS last_purchase_at
           FROM edge_sale
          WHERE customer_id IS NOT NULL AND btrim(customer_id) <> ''
            AND NOT EXISTS (SELECT 1 FROM member m
                             WHERE m.member_id = edge_sale.customer_id)
          GROUP BY customer_id
          ORDER BY spent_minor DESC, max(occurred_at) DESC
          LIMIT $1",
    )
    .bind(limit)
    .fetch_all(pool)
    .await?;

    let strangers = rows
        .iter()
        .map(|row| {
            Ok(UnenrolledRow {
                customer_id: row.try_get("customer_id")?,
                transaction_count: row.try_get("transaction_count")?,
                spent_minor: row.try_get("spent_minor")?,
                points_earned_total: row.try_get("points_earned_total")?,
                site_count: row.try_get("site_count")?,
                first_purchase_at: row.try_get("first_purchase_at")?,
                last_purchase_at: row.try_get("last_purchase_at")?,
            })
        })
        .collect::<Result<Vec<UnenrolledRow>, AppError>>()?;

    // The totals over the whole backlog rather than over the page. A list
    // capped at two hundred that reported its own sum would say the shop has
    // stranded less than it has.
    let totals = sqlx::query(
        "SELECT count(*)::bigint                         AS unenrolled_count,
                COALESCE(sum(spent_minor), 0)::bigint    AS unenrolled_spent_minor
           FROM (
               SELECT customer_id, sum(total_minor) AS spent_minor
                 FROM edge_sale
                WHERE customer_id IS NOT NULL AND btrim(customer_id) <> ''
                  AND NOT EXISTS (SELECT 1 FROM member m
                                   WHERE m.member_id = edge_sale.customer_id)
                GROUP BY customer_id
           ) strangers",
    )
    .fetch_one(pool)
    .await?;

    Ok(UnenrolledList {
        strangers,
        unenrolled_count: totals.try_get("unenrolled_count")?,
        unenrolled_spent_minor: totals.try_get("unenrolled_spent_minor")?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cloud::reports::catalogue::dataset;

    /// The two windows are declared twice — once as integers the screen prints
    /// under "Active within", once as literals inside a CASE the catalogue
    /// holds as a `&'static str`. They cannot be one declaration, because Rust
    /// will not format a constant into a string at compile time. So this is
    /// the seam, and this test is what stands on it: change ninety to sixty in
    /// one place and the build says so, rather than a screen saying ninety
    /// while the database means sixty.
    #[test]
    fn the_windows_are_the_two_the_screen_prints() {
        assert!(
            SEGMENT_CASE.contains(&format!("days => {ACTIVE_DAYS})")),
            "the active window in SEGMENT_CASE is not ACTIVE_DAYS"
        );
        assert!(
            SEGMENT_CASE.contains(&format!("days => {LAPSING_DAYS})")),
            "the lapsing window in SEGMENT_CASE is not LAPSING_DAYS"
        );
    }

    /// Every expression the `member` dataset offers is written against this
    /// file's aliases, because they are spliced into [`list_members`]'s own
    /// `WHERE` when a saved segment narrows the directory. A dimension reading
    /// `x.spent_minor` would compile here and fail at the database, on a query
    /// only a saved segment builds — which is the worst place to find out.
    #[test]
    fn the_member_dataset_is_written_against_this_files_aliases() {
        let members = dataset("member").expect("the member dataset");
        assert_eq!(members.source, MEMBER_SOURCE);
        for dimension in members.dimensions {
            for alias in dimension.sql.split(['(', ')', ' ', ',', '\n']) {
                let Some((table, _)) = alias.split_once('.') else {
                    continue;
                };
                assert!(
                    // `ms` is the correlated alias inside PAIRED's subquery,
                    // which is scoped to that subquery and correct there.
                    matches!(table, "m" | "s" | "h" | "ms"),
                    "dimension '{}' reads from '{table}', which {MEMBER_SOURCE:?} does not define",
                    dimension.key
                );
            }
        }
    }
}
