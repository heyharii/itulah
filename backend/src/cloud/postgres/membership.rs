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
use crate::cloud::reports::{
    catalogue::dataset,
    compile::{bind_params, narrow, Narrowing},
    spec::{check_filters, Filter},
};
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
/// The instant these windows are measured against is the `$NOW` token,
/// replaced with the business clock's own instant (`sql_now_literal`) at
/// query-build time — by [`segment_case`] for the queries built here, and by
/// the report compiler for the catalogue dimension that splices the constant.
/// The windows stay written out as literals so the catalogue keeps carrying
/// a string that cannot carry a parameter; `the_windows_are_the_two_the_
/// screen_prints` keeps the constants above saying the same thing.
pub const SEGMENT_CASE: &str = "
    CASE
        WHEN m.blocked_at IS NOT NULL                              THEN 'BLOCKED'
        WHEN s.last_purchase_at IS NULL                            THEN 'NEVER'
        WHEN s.first_purchase_at >= $NOW - make_interval(days => 90)
                                                                   THEN 'NEW'
        WHEN s.last_purchase_at  >= $NOW - make_interval(days => 90)
                                                                   THEN 'ACTIVE'
        WHEN s.last_purchase_at  >= $NOW - make_interval(days => 180)
                                                                   THEN 'LAPSING'
        ELSE 'LAPSED'
    END";

/// [`SEGMENT_CASE`] measured from a caller's business instant.
pub fn segment_case(now: DateTime<Utc>) -> String {
    SEGMENT_CASE.replace("$NOW", &crate::clock::sql_now_literal(now))
}

// A macro rather than only a const because `concat!` takes literals, and
// [`MEMBER_SOURCE`] and [`MEMBER_RANK_SOURCE`] are spliced from it at compile time.
macro_rules! member_sales {
    () => {
        "
        SELECT customer_id,
               count(*)::bigint                                AS transaction_count,
               COALESCE(sum(total_minor), 0)::bigint           AS spent_minor,
               COALESCE(sum(discount_total_minor), 0)::bigint  AS saved_minor,
               COALESCE(sum(points_earned), 0)::bigint         AS points_earned_total,
               min(occurred_at)                                AS first_purchase_at,
               max(occurred_at)                                AS last_purchase_at
          FROM edge_sale
         WHERE customer_id IS NOT NULL AND btrim(customer_id) <> ''
           AND status = 'COMPLETED'
         GROUP BY customer_id"
    };
}
/// What the till's completed sales say about one card, as one row per card:
/// visits, money, points credited, and the first and last time it was used.
///
/// The `s` half of [`MEMBER_SOURCE`], in its own constant because the
/// directory's ranking pass and the six's counts are drawn from it alone —
/// see [`MEMBER_RANK_SOURCE`] for why that split exists — and a second
/// spelling of "what was spent on this card" is how a screen's house order
/// and its segment card come to disagree.
pub const MEMBER_SALES: &str = member_sales!();

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
pub const MEMBER_SOURCE: &str = concat!(
    "    FROM member m\n",
    "    LEFT JOIN (", member_sales!(), ") s ON s.customer_id = m.member_id\n",
    "    LEFT JOIN (
        SELECT member_id, sum(balance_minor)::bigint AS voucher_balance_minor
          FROM voucher
         WHERE member_id IS NOT NULL AND status = 'ACTIVE'
         GROUP BY member_id
    ) h ON h.member_id = m.member_id\n",
    "    -- Pieces, which `edge_sale` does not carry: it holds one row per receipt
    -- and the quantities are on the lines. Its OWN subquery rather than a join
    -- inside `s` above — joining the lines in there would multiply every sum
    -- in it by the number of lines on the receipt, which is the classic way a
    -- customer list comes to report six times what somebody spent.
    LEFT JOIN (
        SELECT es.customer_id,
               COALESCE(sum(esl.quantity), 0)::bigint AS units_total
          FROM edge_sale es
          JOIN edge_sale_line esl ON esl.sale_id = es.sale_id
         WHERE es.customer_id IS NOT NULL AND btrim(es.customer_id) <> ''
           AND es.status = 'COMPLETED'
         GROUP BY es.customer_id
    ) n ON n.customer_id = m.member_id\n",
    "    -- What they hold now. `points_account` is a cache of the ledger's sum and
    -- 0165 says so plainly, but it is the cache the tills read, so a directory
    -- reading anything else would show a member a different balance from the
    -- one the counter just quoted them.
    LEFT JOIN points_account pa ON pa.customer_id = m.member_id\n",
    "    -- What they have already turned into vouchers, as a positive number: the
    -- ledger stores a redemption as a negative movement, and a person says
    -- they spent 1.200 points rather than that they earned minus 1.200.
    LEFT JOIN (
        SELECT customer_id, COALESCE(-sum(points), 0)::bigint AS points_spent_total
          FROM points_ledger
         WHERE entry_type = 'REDEEM_TO_VOUCHER'
         GROUP BY customer_id
    ) pr ON pr.customer_id = m.member_id",
);

/// The half of [`MEMBER_SOURCE`] the directory's ranking pass and the six's
/// counts are drawn from: the card, what was spent on it, and the two points
/// figures — and deliberately NOT the pieces or the vouchers.
///
/// [`list_members`] ranks the whole scheme before it keeps a page, and a rank
/// has a hard floor: "who spent most" cannot be answered without every
/// member's spend, however the query is shaped. Everything else the page
/// PRINTS is needed only for the two hundred rows it keeps, and joining it
/// into the ranking pass is what made an unfiltered open aggregate the whole
/// till history — every receipt of every customer, twice, once for the page
/// and once for the facets — to hand back one screen. The pieces subquery is
/// the expensive half by far (it walks every line of every completed sale),
/// and no sort the screen offers ranks on it except `units` and `upt`; the
/// points halves are carried here because they are one small table each and
/// two sorts DO rank on them, which keeps the ranking pass to one shape.
///
/// The same aliases as [`MEMBER_SOURCE`], so a narrowing clause spliced into
/// this source's `WHERE` compiles or fails exactly as it would there.
pub const MEMBER_RANK_SOURCE: &str = concat!(
    "    FROM member m\n",
    "    LEFT JOIN (", member_sales!(), ") s ON s.customer_id = m.member_id\n",
    "    LEFT JOIN points_account pa ON pa.customer_id = m.member_id\n",
    "    LEFT JOIN (
        SELECT customer_id, COALESCE(-sum(points), 0)::bigint AS points_spent_total
          FROM points_ledger
         WHERE entry_type = 'REDEEM_TO_VOUCHER'
         GROUP BY customer_id
    ) pr ON pr.customer_id = m.member_id",
);

/// How long since somebody was last in, in whole days.
///
/// Floored, because a screen saying "3 days ago" about something 3.9 days old
/// is what everybody means by it. Here rather than inline because the
/// catalogue offers it as a filterable column and the directory prints it, and
/// those two had better be the same number.
pub const DAYS_SINCE_PURCHASE: &str = "
    CASE WHEN s.last_purchase_at IS NULL THEN NULL
         ELSE floor(extract(epoch FROM $NOW - s.last_purchase_at) / 86400)::bigint
    END";

/// [`DAYS_SINCE_PURCHASE`] measured from a caller's business instant.
pub fn days_since_purchase(now: DateTime<Utc>) -> String {
    DAYS_SINCE_PURCHASE.replace("$NOW", &crate::clock::sql_now_literal(now))
}

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
    /// Pieces, not receipts. Beside `transaction_count` it is the other half of
    /// units per transaction, which is the number a retailer reads to know
    /// whether a shopper buys one thing or a basket.
    pub units_total: i64,
    /// Every point ever credited on this card, over its whole history.
    pub points_earned_total: i64,
    /// What is on the card NOW — the ledger's running sum, which is earning
    /// less redemption less any reversal, and may be negative when goods that
    /// earned points went back after the points were spent. `0165` argues that
    /// at length; the short of it is that the debt stays with the balance
    /// rather than the voucher being clawed back.
    pub points_balance: i64,
    /// What has already been turned into vouchers, as a positive figure.
    pub points_spent_total: i64,
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

/// One value a filter can take, and how many members would still be there.
///
/// `EmployeeFacet`'s shape and its reasoning: a value that would leave nothing
/// is a value nobody should have to click to find out about. Counted over
/// everything the SEARCH leaves, deliberately ignoring which filters are
/// currently applied — so the number reads as "how many of these there are",
/// which is the question somebody has while choosing.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct MemberFacet {
    /// What to send back as the filter — a segment key. Never a display string.
    pub value: String,
    /// What to draw when it differs from the value. Absent for a segment,
    /// whose words belong to the screen: "Lapsing" is the hub's phrasing of
    /// `LAPSING`, not the server's.
    pub label: Option<String>,
    pub count: i64,
}

/// What the directory can be narrowed by.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct MemberFacets {
    /// The six, only those with anybody in them. The segment BOOK is the place
    /// that guarantees all six including the zeroes — this is the filter panel,
    /// and a value that would leave an empty list is one nobody should have to
    /// click to discover.
    pub segments: Vec<MemberFacet>,
}

/// A page of the directory, and the shape of everything it was drawn from.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct MemberDirectory {
    pub members: Vec<MemberRow>,
    /// Everybody enrolled, not just the page. So a filtered list can say what
    /// it is a fraction of.
    ///
    /// Kept spelled as it was — every caller reads it and it still means the
    /// whole scheme, unnarrowed. It is NOT the envelope's `total`, which counts
    /// what the search and the filters match. Two numbers because a screen
    /// genuinely wants both: "41 of 9,320".
    pub member_count: i64,
    /// Opaque. Pass it back as `cursor` for the next page; absent means this
    /// was the last one.
    ///
    /// Deliberately not an offset. Cards are enrolled and members are blocked
    /// while somebody pages through them, and an offset would skip or repeat
    /// rows without anything saying so.
    pub next_cursor: Option<String>,
    /// Every member the search, the segment and any saved narrowing match —
    /// not just this page. Without it a screen can only say "200 members",
    /// which is a statement about the page size rather than about the scheme.
    pub total: i64,
    pub facets: MemberFacets,
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
#[serde(deny_unknown_fields)]
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
    /// **Card number or name. Those two and nothing else, ever.**
    ///
    /// This is the one parameter in this file that has to be argued rather than
    /// listed. A member directory is a register of people, and a search box
    /// over it is a lookup tool: widening it to a phone number would turn "find
    /// the customer holding this card" into "confirm that this phone number
    /// belongs to somebody who shops here", which is a different power and one
    /// nobody granted.
    ///
    /// The `member` table happens to hold no phone, address or identity number
    /// today, so the rule costs nothing to keep — and that is exactly why it is
    /// written down now. The reachable personal data is one join away in
    /// `member_session.paired_by` and `paired_at_site`, and [`MemberRow`]
    /// deliberately reduces that whole join to a single `paired` boolean. A
    /// search that reached into it would be reaching around a summary type that
    /// omits the field on purpose — see `EmployeeScope::needle`, which makes
    /// the same argument about NIK.
    pub q: Option<String>,
    /// `spent`, `name`, `card`, `joined`, `last_purchase`, `transactions`,
    /// `atv`, `units`, `upt`, `points` or `points_spent` — the closed set this
    /// server names, and nothing else is a sort.
    ///
    /// Anything unrecognised falls back to `spent`, the house order, rather
    /// than refusing: a sort arrives from a URL somebody may have kept from an
    /// older build, and a 400 for a stale bookmark is a worse answer than the
    /// rows in the house order.
    #[serde(default)]
    pub sort: Option<String>,
    /// `desc` and nothing else. Absent, empty and anything unrecognised all
    /// mean the key's own natural direction — see [`list_members`], where money
    /// and recency read downwards and names read upwards.
    #[serde(default)]
    pub dir: Option<String>,
    /// The filter bar's clauses, as a JSON array of `reports::spec::Filter`
    /// over the `member` dataset — the same clause a saved segment is written
    /// in, checked by the same `check_filters` and compiled by the same
    /// `narrow`. ANDed together, and ANDed with a saved segment when both are
    /// given. See [`directory_narrowing`].
    ///
    /// On the wire rather than applied in the browser because the directory is
    /// paged: a clause run over the rows already loaded is a filter of the
    /// page, not of the scheme.
    #[serde(default)]
    pub filters: Option<String>,
    /// A `next_cursor` from the previous page, verbatim.
    #[serde(default)]
    pub cursor: Option<String>,
    pub limit: Option<i64>,
}

/// Everything that narrows the directory beyond the search and the six: a
/// saved segment's own clauses (already compiled, numbered from `bound + 1`),
/// then the filter bar's, numbered after them. `None` when neither narrows.
///
/// The filter bar's clauses are refused, not skipped, when they name something
/// the `member` dataset does not have: a chip the server quietly ignored would
/// be a chip promising a narrowing that did not happen.
pub fn directory_narrowing(
    saved: Option<Narrowing>,
    filters: Option<&str>,
    bound: usize,
    now: DateTime<Utc>,
) -> Result<Option<Narrowing>, AppError> {
    let Some(raw) = filters.map(str::trim).filter(|raw| !raw.is_empty()) else {
        return Ok(saved);
    };
    let clauses: Vec<Filter> = serde_json::from_str(raw).map_err(|_| {
        AppError::Validation("filters is not a list of clauses over the member dataset".into())
    })?;
    if clauses.is_empty() {
        return Ok(saved);
    }
    let members = dataset("member").ok_or_else(|| {
        AppError::Configuration("the `member` dataset is missing from the catalogue".into())
    })?;
    let mut problems = Vec::new();
    check_filters(members, &clauses, &mut problems);
    if !problems.is_empty() {
        return Err(AppError::Validation(problems.join("; ")));
    }

    let offset = bound + saved.as_ref().map_or(0, |one| one.params.len());
    let added = narrow(members, &clauses, true, offset, now);
    let Some(added_sql) = added.sql else {
        return Ok(saved);
    };
    Ok(Some(match saved {
        None => Narrowing {
            sql: Some(added_sql),
            params: added.params,
        },
        Some(held) => {
            let sql = match held.sql {
                Some(first) => format!("({first}) AND ({added_sql})"),
                None => added_sql,
            };
            let mut params = held.params;
            params.extend(added.params);
            Narrowing {
                sql: Some(sql),
                params,
            }
        }
    }))
}

const DEFAULT_PAGE: i64 = 200;
const MAX_PAGE: i64 = 1_000;

/// Where the previous page stopped — as a ROW, not as a position.
///
/// It carries the card number and nothing else, whatever the list is sorted by,
/// exactly as `EmployeeCursor` carries the employee id. The seek re-reads that
/// row's own sort value in SQL, so one cursor shape serves every order and a
/// sixth sort cannot arrive without its cursor.
///
/// Hex-wrapped JSON rather than a bare card number, and on this list that is
/// more than tidiness: a bare cursor would be a card number in a URL, in a
/// browser history, in a server log. Opaque is the right default for a
/// per-person identifier even when the payload is one the caller already has.
#[derive(Serialize, Deserialize)]
struct MemberCursor {
    member_id: String,
}

impl MemberCursor {
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
        units_total: row.try_get("units_total")?,
        points_earned_total: row.try_get("points_earned_total")?,
        points_balance: row.try_get("points_balance")?,
        points_spent_total: row.try_get("points_spent_total")?,
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

/// Everybody holding a card, with what they have spent joined on — one page at
/// a time, beside the shape of the whole answer.
///
/// A member with no purchases is not an error and not an omission: they are
/// somebody who was handed a card and has not used it yet, and they are the
/// segment worth the most attention. Hence the LEFT JOIN in [`MEMBER_SOURCE`],
/// and hence `NEVER` being a segment rather than a gap.
///
/// `narrowing` is a saved segment's definition, already compiled against the
/// `member` dataset. Applied here rather than in the browser because a segment
/// is a statement about the whole directory: a page of a thousand rows narrowed
/// after the fact would answer a different question, and would disagree with
/// the count on the card that linked here.
///
/// It is spliced **inside** the searched set rather than beside the segment
/// filter, and the difference is what the facet counts mean. A saved segment is
/// the population being looked at — the screen reads "this segment's members" —
/// so the six counts beside it describe that population. The segment filter is
/// the thing somebody is choosing between, so it is applied outside and the
/// counts ignore it.
///
/// The page is read in two halves: rank, then enrich. Ranking — the sort, the
/// seek, the limit — runs over [`MEMBER_RANK_SOURCE`], because a rank has a
/// hard floor ("who spent most" needs every member's spend) while everything
/// else the page prints is needed for only the rows it keeps. The enrichment —
/// pieces, vouchers, the pairing — is then fetched for those rows alone, as
/// scalar subqueries under the limit rather than joins above it. Before the
/// halves were split, an unfiltered open folded every line of every completed
/// sale before it could hand back one screen; the halves are what let
/// `ix_edge_sale_member_spend` (0952) answer the rank from one aggregate and
/// the enrichment from a handful of index probes.
///
/// The whole envelope comes off that one fold, in one statement: the six group
/// the pass's rows, `total` counts what the segment filter keeps of them, and
/// `member_count` rides along as the one number that reads no fold at all.
/// The statement used to run three times — once for the page, once to recount
/// the searched set for the facets, once for `member_count` — and the second
/// run walked the whole till history again to learn numbers the first had
/// already produced.
///
/// # Placeholders
///
/// `$1` the search pattern, `$2` the segment filter, then the narrowing's own
/// parameters from `$3` — which is the whole contract between this query and
/// the compiler, and why the handler passes it a `bound` of 2. The cursor and
/// the limit come after those, at positions this function computes, because
/// their number depends on how many clauses the saved segment carries.
pub async fn list_members(
    pool: &PgPool,
    query: MemberQuery,
    narrowing: Option<&Narrowing>,
    now: DateTime<Utc>,
) -> Result<MemberDirectory, AppError> {
    let limit = query.limit.unwrap_or(DEFAULT_PAGE).clamp(1, MAX_PAGE);
    let segment = checked_segment(query.segment.as_deref())?;
    // A blank search is not a search: `Some("")` would compile to a LIKE that
    // matches everything and costs a scan to say so.
    let search = query
        .q
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_uppercase);

    let extra = match narrowing.and_then(|one| one.sql.as_deref()) {
        Some(fragment) => format!("\n            AND ({fragment})"),
        None => String::new(),
    };
    let params = narrowing.map(|one| one.params.len()).unwrap_or(0);
    // Where the caller's own placeholders end and ours resume. Computed rather
    // than written, because a saved segment carries as many clauses as somebody
    // wrote and every one of them is a bound parameter.
    let cursor_at = 3 + params;
    let limit_at = 4 + params;

    // Which sources the one whole-scheme pass reads: the card and what was
    // spent on it and nothing else — except that `units` and `upt` RANK on the
    // pieces, which costs the lines of every completed sale, and that a
    // narrowing clause arrives compiled rather than parsed, so which aliases it
    // reads cannot be known here. A narrowed directory folds the whole source
    // rather than guessing at its own clauses.
    let rank_wide =
        narrowing.is_some() || matches!(query.sort.as_deref(), Some("units") | Some("upt"));
    let rank_source = if rank_wide { MEMBER_SOURCE } else { MEMBER_RANK_SOURCE };

    // The pass's row definition. It carries the columns the page prints that
    // the pass source already joins, plus every sort key. The six and `total`
    // read the same rows, but only ever their `segment`.
    //
    // The `*_key` columns are computed rather than only named in ORDER BY,
    // because a keyset has to COMPARE the sort value in a WHERE and a sort
    // expression that is not a column is one a WHERE cannot see. All are
    // non-null, which is the rule that is easy to miss and expensive to find:
    // a row comparison against NULL is NULL rather than true, so one member
    // who has never bought — and `NEVER` is a segment precisely because there
    // are many — would end paging at whatever row happened to carry it,
    // silently, with the rest of the scheme below the fold.
    //
    // `-infinity` is that rule for a last purchase, and it is also the more
    // useful answer: somebody who has never been in sorts after everybody who
    // has, which is where a reader looking for the most recent visit expects
    // them. A sentinel VALUE rather than a `NULLS LAST` decoration, because
    // `NULLS LAST` orders a result and says nothing a keyset can seek against.
    let wide_columns = if rank_wide {
        ",
                COALESCE(n.units_total, 0)                 AS units_total,
                COALESCE(h.voucher_balance_minor, 0)       AS voucher_balance_minor,
                -- The second average, on the pieces rather than the receipts,
                -- so it lives and dies with the `units` sorts that rank on it.
                COALESCE(COALESCE(n.units_total, 0)::numeric
                         / NULLIF(COALESCE(s.transaction_count, 0), 0),
                         -1)                               AS upt_key"
    } else {
        ""
    };
    let rank_sql = format!(
        "SELECT m.member_id, m.display_name, m.joined_on, m.blocked_at,
                COALESCE(s.transaction_count, 0)           AS transaction_count,
                COALESCE(s.spent_minor, 0)                 AS spent_minor,
                COALESCE(s.saved_minor, 0)                 AS saved_minor,
                COALESCE(s.points_earned_total, 0)         AS points_earned_total,
                COALESCE(pa.balance_points, 0)             AS points_balance,
                COALESCE(pr.points_spent_total, 0)         AS points_spent_total,
                s.first_purchase_at,
                s.last_purchase_at,
                {days_since}                               AS days_since_purchase,
                {segment}                                  AS segment,
                COALESCE(s.spent_minor, 0)                 AS spent_key,
                upper(COALESCE(m.display_name, ''))        AS name_key,
                COALESCE(s.last_purchase_at,
                         TIMESTAMPTZ '-infinity')          AS last_key,
                -- The average transaction the screen draws, for sorting on.
                -- Never bought is no average rather than a zero one, so it
                -- takes -1 and sorts below the cheapest shopper — non-null
                -- for the same reason `last_key` is.
                COALESCE(COALESCE(s.spent_minor, 0)::numeric
                         / NULLIF(COALESCE(s.transaction_count, 0), 0),
                         -1)                               AS atv_key{wide_columns}
           {rank_source}
          -- The card number and the name on it. Not personal data this list
          -- deliberately does not carry — see `MemberQuery::q`.
          WHERE ($1::text IS NULL
                 OR upper(m.member_id) LIKE '%' || $1 || '%'
                 OR upper(COALESCE(m.display_name, '')) LIKE '%' || $1 || '%'){extra}",
        days_since = days_since_purchase(now),
        segment = segment_case(now),
        wide_columns = wide_columns,
        rank_source = rank_source,
    );

    // The sort, and the tie-break that makes it total. Every order ends in the
    // card number, which is the primary key, so no two rows can compare equal —
    // which is what stops a keyset repeating or losing the rows that tie.
    //
    // Each key carries its OWN natural direction, which `dir` overrides rather
    // than replaces. Money and recency read downwards — "who matters" and "who
    // was in last" are questions asked from the top — and names and card
    // numbers read upwards. A single shared default would have made `spent`
    // ascending, which is this list's house order reversed and would have been
    // a silent change to every screen that did not pass `dir`.
    let (lead, natural_desc): (&str, bool) = match query.sort.as_deref() {
        Some("name") => ("name_key", false),
        Some("card") => ("member_id", false),
        Some("joined") => ("joined_on", true),
        Some("last_purchase") => ("last_key", true),
        Some("transactions") => ("transaction_count", true),
        Some("atv") => ("atv_key", true),
        Some("units") => ("units_total", true),
        Some("upt") => ("upt_key", true),
        Some("points") => ("points_balance", true),
        Some("points_spent") => ("points_spent_total", true),
        _ => ("spent_key", true),
    };
    let descending = match query.dir.as_deref() {
        Some("asc") => false,
        Some("desc") => true,
        _ => natural_desc,
    };
    // TWO spellings of the same thing, and they are not interchangeable:
    // `ORDER BY` takes directions, a ROW EXPRESSION does not. Writing
    // `(a DESC, b) < (…)` is a syntax error the compiler cannot catch, because
    // the whole clause is a string.
    let cols = if lead == "member_id" {
        "member_id".to_owned()
    } else {
        format!("{lead}, member_id")
    };
    let dir = if descending { "DESC" } else { "ASC" };
    let order = if lead == "member_id" {
        format!("member_id {dir}")
    } else {
        format!("{lead} {dir}, member_id {dir}")
    };
    // Which way the seek points follows the direction, or paging a descending
    // list walks back up it.
    let seek = if descending { "<" } else { ">" };

    let cursor = query
        .cursor
        .as_deref()
        .map(MemberCursor::decode)
        .transpose()?;

    // The enrichment: the columns the page prints that the ranking pass does
    // not carry, fetched for the kept rows alone. Each is the subquery it is
    // named for in [`MEMBER_SOURCE`], narrowed to one card — the `IS NOT NULL`
    // and `btrim` clauses of the whole-table spelling are implied by that
    // equality, because the card comes off `member`'s primary key and is
    // neither null nor blank — and an aggregate over no rows is one row of
    // `COALESCE`'d zero, which is the LEFT JOIN's missing-row answer exactly.
    // `m` is the page, on purpose: [`PAIRED`] is spelt against an `m` and the
    // catalogue splices that same spelling, so one letter keeps it single.
    let (units, vouchers): (String, String) = if rank_wide {
        (
            "m.units_total".to_owned(),
            "m.voucher_balance_minor".to_owned(),
        )
    } else {
        (
            "(SELECT COALESCE(sum(esl.quantity), 0)::bigint
               FROM edge_sale es
               JOIN edge_sale_line esl ON esl.sale_id = es.sale_id
              WHERE es.customer_id = m.member_id
                AND es.status = 'COMPLETED')".to_owned(),
            "(SELECT COALESCE(sum(v.balance_minor), 0)::bigint
               FROM voucher v
              WHERE v.member_id = m.member_id
                AND v.status = 'ACTIVE')".to_owned(),
        )
    };

    // The seek re-reads the previous row's own sort value rather than trusting
    // one encoded in the cursor — see [`MemberCursor`]. A cursor whose row the
    // filters no longer keep — somebody blocked, or moved out of the segment
    // being listed, between one page and the next — finds no row to compare
    // against, so the page comes back empty. The list ends early rather than
    // starting again, which is the safer of the two wrong answers.
    //
    // One statement, because everything the envelope carries is drawn from one
    // fold: the page, the six and both totals all read `searched`, and
    // `searched` is referenced by all of them — which makes PostgreSQL
    // materialise it, and here that is the right answer rather than the fence
    // it was in `postgres::audit::list_audit`. There the CTE stood over the
    // raw table, and materialising it meant writing millions of rows to hand
    // back one page; here it stands over what the fold produced — one row per
    // member, tens of thousands of them — and materialising it means the
    // till history is folded ONCE and read three ways: the page seeks and
    // sorts it, the six group it, `total` counts it. The counts ride as a
    // one-row `LEFT JOIN`, so an answer that keeps no member still returns
    // its counts — a search that matches nobody says so as 0 of 30,000 rather
    // than as an error about a row that is not there.
    let sql = format!(
        "WITH searched AS ({rank_sql}),
              kept AS (
             SELECT * FROM searched WHERE ($2::text IS NULL OR segment = $2)
         )
         SELECT m.member_id, m.display_name, m.joined_on, m.blocked_at,
                {PAIRED}                                     AS paired,
                m.transaction_count, m.spent_minor, m.saved_minor,
                {units}                                      AS units_total,
                m.points_earned_total,
                m.points_balance, m.points_spent_total,
                m.first_purchase_at, m.last_purchase_at,
                m.days_since_purchase,
                {vouchers}                                   AS voucher_balance_minor,
                m.segment,
                c.total, c.member_count, c.facets
           FROM (SELECT (SELECT count(*)::bigint FROM kept)   AS total,
                        (SELECT count(*)::bigint FROM member) AS member_count,
                        COALESCE((
                            SELECT jsonb_agg(jsonb_build_object('value', value,
                                                                'count', count))
                              FROM (SELECT segment AS value, count(*)::bigint AS count
                                      FROM searched GROUP BY 1) six
                        ), '[]'::jsonb)                       AS facets
             ) c
           LEFT JOIN (SELECT * FROM kept
                       WHERE ${cursor_at}::text IS NULL
                          OR ({cols}) {seek} (SELECT {cols} FROM kept
                                              WHERE member_id = ${cursor_at})
                       ORDER BY {order}
                       LIMIT ${limit_at}) m ON true"
    );
    let mut statement = sqlx::query(&sql).bind(&search).bind(&segment);
    if let Some(one) = narrowing {
        statement = bind_params(statement, &one.params);
    }
    let rows = statement
        .bind(cursor.as_ref().map(|one| one.member_id.clone()))
        .bind(limit)
        .fetch_all(pool)
        .await?;

    // The counts are on every row and read off the first; the members are the
    // rows whose page half exists. When nothing matches, the counts row is the
    // whole answer and the members are none.
    let Some(counted) = rows.first() else {
        // Unreachable while the counts row is a LEFT JOIN's left side — kept
        // here the way a seatbelt is, for the day somebody reshapes the join.
        return Ok(MemberDirectory {
            members: Vec::new(),
            member_count: 0,
            next_cursor: None,
            total: 0,
            facets: MemberFacets { segments: Vec::new() },
        });
    };
    let total: i64 = counted.try_get("total")?;
    let member_count: i64 = counted.try_get("member_count")?;
    let mut segments: Vec<MemberFacet> = serde_json::from_value(
        counted.try_get::<serde_json::Value, _>("facets")?,
    )?;

    let page: Vec<PgRow> = rows
        .into_iter()
        .filter(|row| matches!(row.try_get::<Option<String>, _>("member_id"), Ok(Some(_))))
        .collect();

    // A short page is the last page. A full one may not be — the next request
    // can come back empty — and that is the honest answer: knowing whether more
    // rows exist without asking costs a second pass over the same query.
    let next_cursor = match page.last() {
        Some(row) if page.len() as i64 == limit => Some(
            MemberCursor {
                member_id: row.try_get("member_id")?,
            }
            .encode()?,
        ),
        _ => None,
    };

    // In the six's own reading order rather than biggest-first, which is where
    // this list parts company with every other facet panel here on purpose. The
    // six are a sequence — from the people who just arrived to the people who
    // have gone — and the segment book next door already prints them in it. Two
    // orders for one vocabulary is two orders somebody has to reconcile.
    segments.sort_by_key(|facet| {
        SEGMENT_ORDER
            .iter()
            .position(|key| *key == facet.value)
            .unwrap_or(SEGMENT_ORDER.len())
    });
    Ok(MemberDirectory {
        members: page
            .iter()
            .map(member_from_row)
            .collect::<Result<Vec<_>, _>>()?,
        member_count,
        next_cursor,
        total,
        facets: MemberFacets { segments },
    })
}

/// The six segments, counted and valued.
///
/// One pass over the directory rather than six counting queries, and every
/// segment present whether or not anybody is in it — `SEGMENT_ORDER` is
/// left-joined against the counts precisely so a zero is a zero and not an
/// absence.
pub async fn member_segments(pool: &PgPool, now: DateTime<Utc>) -> Result<SegmentBook, AppError> {
    let rows = sqlx::query(&format!(
        "WITH placed AS (
                  SELECT {segment}                               AS segment,
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
          ORDER BY k.ord",
        segment = segment_case(now)
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
                  AND status = 'COMPLETED'
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
                  AND status = 'COMPLETED'
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
                    // `n`, `pa` and `pr` are the units and points joins.
                    matches!(table, "m" | "s" | "h" | "n" | "pa" | "pr" | "ms"),
                    "dimension '{}' reads from '{table}', which {MEMBER_SOURCE:?} does not define",
                    dimension.key
                );
            }
        }
    }
}
