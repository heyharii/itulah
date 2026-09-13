//! What is on offer across every published book, as three lists.
//!
//! Promotions, coupons and campaigns each live inside a price book, and until
//! now the only way to read one back was to open a book. So the screens that
//! list them fetched every publication and then fetched each one again —
//! twelve round trips in dev, and one more with every publish. The cost is not
//! the reason to end it; the *shape* is. A screen whose job is "which offers
//! exist" was expressing that as "open every book and see", which is a
//! different question that happens to have the same answer today.
//!
//! **Newest published book wins, per key.** That is not a choice made here: it
//! is what a shop resolves, in `cloud/postgres/pricing.rs` — `load_rules`,
//! `load_coupons` and `load_campaigns`, each `DISTINCT ON (key) ORDER BY
//! version DESC`. Those three are the reference, and this module deliberately
//! mirrors their SQL rather than inventing a second rule, because a centre that
//! lists one promotion where a till applies another is worse than no list.
//!
//! A promotion repeated in a later book is one promotion amended, never two —
//! which is also why `commercial_usage` is keyed by rule id across every
//! publication rather than per book.
//!
//! Only PUBLISHED books are considered. A promotion sitting in a draft is
//! authored, not running, and listing it beside live ones would invite somebody
//! to wonder why it has never fired.
//!
//! # Why two of the three now answer in an envelope
//!
//! Promotions and campaigns are brought up to the shape `money_overview` set
//! in `postgres::statements` and `list_employees` most recently copied: a scope
//! struct assembled by the handler, a keyset cursor over the sort order, and an
//! envelope carrying the page beside the size and the shape of the whole
//! matched set. The convention is copied rather than reinvented — two list
//! endpoints that page differently are two things to learn and two things to
//! get wrong.
//!
//! The searching and the sorting move with it. Both screens were fetching every
//! promotion and every campaign in the fleet and then searching and sorting
//! them in the browser, which works exactly until the list is longer than the
//! fetch — and the way it stops working is a promotion that is quietly missing
//! and a sort that only ordered the rows the browser happened to hold.
//!
//! **Coupons are deliberately left as they are.** A coupon is not a list
//! anybody browses: the screen shows them under the promotion they unlock, the
//! whole estate holds a handful, and there is no filter beside them to count.
//! Giving it a cursor and a facet panel nothing draws would be three more
//! things to keep true for no reader.

use chrono::{DateTime, Utc};
use pricing_engine::Rule;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::{PgPool, Row};
use uuid::Uuid;

use super::{decode_cursor, encode_cursor, order_by};
use crate::cloud::application::AppError;

/// How many rows these lists return when the caller does not say.
///
/// Here rather than in the handler, beside the only clamp that enforces it: one
/// spelling of "how much of the fleet's offer book one request may see".
const DEFAULT_LIMIT: i64 = 200;
/// And the most they will return however loudly a caller asks.
///
/// Five hundred rather than `list_employees`' thousand because there is no
/// caller that legitimately wants every promotion in one read — a picker over
/// promotions does not exist, and the two screens that list them are tables a
/// person scrolls. The envelope is what makes the ceiling safe either way:
/// `total` says how many there really are, so a caller that hits it can see
/// that it did.
const MAX_LIMIT: i64 = 500;

/// The shops that have put a book into service, as the detail endpoint shapes
/// them.
///
/// Carried on every row rather than fetched per book, because "has this offer
/// reached anywhere" is the question the screens ask of each row, and a second
/// round trip to answer it would reinstate half the N+1 this module removes. It
/// repeats across rules that share a book; at a fleet of thirteen that is a few
/// hundred bytes and worth it for a list that needs no follow-up call.
const ACTIVATED_BY: &str = "COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'origin_id', a.origin_id,
             'site_id', a.site_id,
             'activated_at', a.activated_at,
             'reported_at', a.reported_at,
             'price_rule_count', a.price_rule_count
           ) ORDER BY a.origin_id)
      FROM commercial_publication_activation a
     WHERE a.publication_id = p.id), '[]'::jsonb) AS activated_by";

/// One shop that has put a book into service, and when.
///
/// Typed rather than handed over as raw JSON. The browser was reading these
/// five fields off an `any` and the only statement of their shape was a
/// hand-written interface beside the fetch — which is the disease this
/// repository has had three times and the reason `contract_types.rs` exists.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct BookActivation {
    pub origin_id: String,
    /// Resolved from the origin's credential when the fact landed, so a later
    /// re-pointing of that node does not rewrite history. Null for a node whose
    /// credential named no site.
    pub site_id: Option<String>,
    /// The shop's own clock: since when it has been charging these prices.
    pub activated_at: DateTime<Utc>,
    /// The centre's clock: when it found out. The gap between the two is the
    /// number worth watching.
    pub reported_at: DateTime<Utc>,
    /// How much of the book arrived, so a truncated delivery shows as a number
    /// rather than as a wrong price weeks later.
    pub price_rule_count: i64,
}

/// One value a filter can take, and how many rows would still be there.
///
/// `EmployeeFacet`'s shape and `EmployeeFacet`'s reasoning: a value that would
/// leave nothing is a value nobody should have to click to find out about.
/// Counted over everything the SEARCH leaves, deliberately ignoring which
/// filters are currently applied — so the number reads as "how many of these
/// there are", which is the question somebody has while choosing.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CommercialFacet {
    /// What to send back as the filter — a status code, a campaign id. Never a
    /// display string.
    pub value: String,
    /// What to draw, when it differs from the value. Absent for a status, whose
    /// words belong to the screen: "Paused" is the hub's phrasing of `PAUSED`,
    /// not the server's.
    pub label: Option<String>,
    pub count: i64,
}

/// Biggest first, ties broken on the value.
///
/// A filter list is read top-down and the value somebody is most likely to want
/// is the one with the most behind it. The tie-break keeps the order stable
/// between calls — a list that reshuffles under the cursor is a list nobody can
/// click.
fn by_size(facets: &mut [CommercialFacet]) {
    facets.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.value.cmp(&b.value)));
}

/// A blank search is not a search.
///
/// `Some("")` would compile to `ILIKE '%%'`, which matches everything and costs
/// a scan to say so.
fn pattern(needle: Option<&str>) -> Option<String> {
    needle
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(|text| format!("%{text}%"))
}

/// An empty ticked list and no filter at all are the same request.
///
/// Treating them differently is how a screen shows nothing the moment somebody
/// unticks the last box.
fn some_of(values: &[String]) -> Option<Vec<String>> {
    (!values.is_empty()).then(|| values.to_vec())
}

/// How many published books the answer was drawn from.
///
/// Carried on every response because the screens already show it, and because
/// it is the honest denominator: "no promotions, from eleven books" and "no
/// promotions, from none" look identical without it and mean opposite things.
async fn published_book_count(pool: &PgPool) -> Result<i64, AppError> {
    Ok(
        sqlx::query_scalar(
            "SELECT count(*) FROM commercial_publication WHERE status = 'PUBLISHED'",
        )
        .fetch_one(pool)
        .await?,
    )
}

/// Whatever the row's `activated_by` column holds, as the type it has always
/// been.
///
/// A shape this build cannot read comes back empty rather than failing the
/// whole list: the column is assembled by `ACTIVATED_BY` two screens away from
/// here, and one malformed aggregate must not be able to take out a promotions
/// list whose other fifteen rows are fine.
fn activations(raw: Value) -> Vec<BookActivation> {
    serde_json::from_value(raw).unwrap_or_else(|error| {
        tracing::warn!(%error, "a book's activation list could not be read; shown as none");
        Vec::new()
    })
}

/// A stored rule document, as the engine would read it.
///
/// The column is whatever was written into the book on the day it was
/// published, and that is not the same thing as what `Rule` is today. Every
/// optional field on that struct carries `#[serde(default)]` — `scope`,
/// `conditions`, `caps`, `stacking`, `earn_basis` — so a document written
/// before one of them existed still deserialises, and every till in the fleet
/// applies it without noticing: `load_rules` in `pricing.rs` reads it through
/// exactly this parse.
///
/// The centre used to hand the raw column to the browser instead, and the
/// asymmetry was the fault. A promotion whose document predates `scope` is
/// applied correctly by every shop and had no `scope` key at all on the wire,
/// which is not a field the screens can be asked to tolerate: the response is
/// typed as `Rule`, the generated contract says `scope` is always there, and
/// the list toppled on `rule.scope.applicability` — one old row taking out the
/// whole screen, including the fifteen rows that were fine.
///
/// So the parse happens here, once, and what goes out is the engine's own
/// serialisation. That is what the doc comment on this endpoint always claimed
/// and what its consumers were already written against.
///
/// A document this build genuinely cannot read is passed through untouched
/// rather than dropped. `load_rules` skips it — right for an evaluator, since a
/// price must never be guessed — but wrong for a list whose entire job is to
/// say which promotions exist. A row nobody can see is the one nobody turns
/// off.
fn canonical(document: Value) -> Value {
    match serde_json::from_value::<Rule>(document.clone()) {
        Ok(rule) => serde_json::to_value(rule).unwrap_or(document),
        Err(error) => {
            tracing::warn!(
                %error,
                "listing a promotion this build cannot fully read; it is shown as stored"
            );
            document
        }
    }
}

// ── promotions ───────────────────────────────────────────────────────────

/// One promotion as a screen reads it: the rule, and the book that carried it.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PromotionRow {
    pub rule_id: String,
    pub name: String,
    pub status: String,
    pub priority: i32,
    /// The rule as the engine serialises it, handed back whole — see
    /// [`canonical`]. Typed as the engine's own `Rule` rather than as an opaque
    /// blob, because a second *reading* of a promotion here would be a second
    /// opinion about what it does.
    #[cfg_attr(feature = "ts", ts(as = "pricing_engine::Rule"))]
    pub definition: Value,
    /// Lifted out of the document so it can be filtered and sorted on without
    /// the caller parsing every rule to find it. It is the same value
    /// `definition.campaign_id` carries; the Campaign screen used to fetch
    /// every promotion in the fleet and filter them in the browser to answer
    /// "which rules belong to this campaign".
    pub campaign_id: Option<String>,
    /// Lifted out for the same reason, and because it is the string somebody
    /// has in their hand when they go looking.
    pub coupon_code: Option<String>,
    /// Which book carried it. The screens name the publication on a detail
    /// sheet, and without this they would have to open one to find out — the
    /// round trip this module exists to remove.
    pub publication_id: Uuid,
    pub version: i64,
    pub book_name: String,
    pub effective_from: DateTime<Utc>,
    pub effective_to: Option<DateTime<Utc>>,
    pub activated_by: Vec<BookActivation>,
}

/// The two things the promotions list can be narrowed by.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PromotionFacets {
    pub statuses: Vec<CommercialFacet>,
    /// Promotions that belong to no campaign are deliberately absent: the
    /// filter has no spelling for "none", and a count nobody can click is worse
    /// than no count.
    pub campaigns: Vec<CommercialFacet>,
}

/// A page of promotions, and the shape of everything it was drawn from.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PromotionPage {
    pub rows: Vec<PromotionRow>,
    /// Opaque. Pass it back as `cursor` for the next page; absent means this
    /// was the last one.
    ///
    /// Deliberately not an offset. Books are published while somebody pages
    /// through what they declare, and a promotion restated in a new book moves
    /// in this list — so an offset would skip or repeat rows with nothing
    /// saying so, on a list where a skipped row is an offer nobody turned off.
    pub next_cursor: Option<String>,
    /// Every promotion the search and the filters match, not just this page.
    pub total: i64,
    /// How many published books the answer was drawn from.
    pub book_count: i64,
    pub facets: PromotionFacets,
}

/// What a caller is asking the promotions list for.
#[derive(Clone, Debug, Default)]
pub struct PromotionScope {
    /// Free text, tried against the rule id, the promotion's name and the
    /// coupon code that unlocks it — the three things somebody has in front of
    /// them when they go looking for an offer.
    ///
    /// Not the rule document. A promotion's conditions are a structure, not
    /// prose, and a search box that matched them would answer "PERCENT" with
    /// every percentage promotion ever written.
    pub needle: Option<String>,
    /// Statuses to keep. Empty means every status.
    ///
    /// Unknown values are passed through rather than dropped: the vocabulary
    /// lives in the engine's `RuleStatus`, not in this file, and a second copy
    /// of it here would be the thing that goes stale. A status nobody uses
    /// matches nothing.
    pub statuses: Vec<String>,
    /// Campaign ids to keep. This is what the Campaign screen's "rules in this
    /// campaign" is, asked of the server.
    pub campaigns: Vec<String>,
    /// `rule_id`, `name`, `status`, `priority`, `campaign` or `book` — the
    /// closed set this server names, and nothing else is a sort.
    ///
    /// A closed set named here rather than a column name taken from the caller:
    /// the sort is spliced into SQL, and a list endpoint that accepts arbitrary
    /// column names is a list endpoint that accepts arbitrary SQL.
    ///
    /// Anything unrecognised falls back to `rule_id` rather than refusing,
    /// because a sort arrives from a URL somebody may have kept from an older
    /// build and a 400 for a stale bookmark is a worse answer than the rows in
    /// the house order.
    pub sort: Option<String>,
    /// `true` for descending. Read for every key, the default included: a rule
    /// id reversed is a direction somebody can mean.
    pub desc: bool,
    pub cursor: Option<String>,
    /// Absent means [`DEFAULT_LIMIT`], not "everything".
    pub limit: Option<i64>,
}

/// Where the previous page stopped — as a ROW, not as a position.
///
/// It carries the rule id and nothing else, whatever the list is sorted by. The
/// seek re-reads that row's own sort value in SQL, so one cursor shape serves
/// every order and a seventh sort cannot arrive without its cursor.
#[derive(Serialize, Deserialize)]
struct PromotionCursor {
    rule_id: String,
}

/// One promotion row, defined once.
///
/// Used by the page query and by the facet counts, and that is the whole reason
/// it is a constant: the facets are only honest if they count exactly what the
/// page can show. Two copies would agree on every ordinary day and part company
/// the moment somebody changes what "the live statement of a promotion" means.
///
/// Binds: `$1` the search pattern, or NULL for no search.
///
/// **The search is applied OUTSIDE the `DISTINCT ON`, on purpose.** Deduplicate
/// first and search second, so what is searched is the live statement of each
/// promotion. Searching first would let a name from a superseded book decide
/// whether the current one appears — a promotion renamed in its latest book
/// would answer to the name nobody can see any more and not to the one on
/// screen.
///
/// It stops at the SEARCH. The status and campaign filters are applied outside
/// it by each caller, which is what lets one definition answer two different
/// questions from the same rows: the page wants what the filters leave, while
/// the filter panel's counts want what the search alone leaves — because
/// "Paused 4" has to mean "there are 4 paused promotions", not "4 among the
/// ones you have already narrowed to paused".
///
/// `campaign_key` is computed here rather than only in `ORDER BY` because the
/// keyset has to COMPARE the sort value in a `WHERE`, and a sort expression
/// that is not also a column is one a `WHERE` cannot see. It is non-null for a
/// reason that is easy to miss and expensive to find: a row comparison against
/// NULL is NULL rather than true, so one promotion belonging to no campaign —
/// which is most of them — would end paging at whatever row happened to carry
/// it, silently, with the rest of the list below the fold.
fn promotion_rows() -> String {
    format!(
        "SELECT * FROM (
             SELECT DISTINCT ON (r.rule_id)
                    r.rule_id, r.name, r.status, r.priority, r.definition,
                    r.definition->>'campaign_id' AS campaign_id,
                    r.definition->>'coupon_code' AS coupon_code,
                    COALESCE(r.definition->>'campaign_id', '') AS campaign_key,
                    p.id AS publication_id, p.version, p.name AS book_name,
                    p.effective_from, p.effective_to, {ACTIVATED_BY}
               FROM commercial_rule r
               JOIN commercial_publication p ON p.id = r.publication_id
              WHERE p.status = 'PUBLISHED'
              ORDER BY r.rule_id, p.version DESC
         ) live
          WHERE ($1::text IS NULL
                 OR live.rule_id ILIKE $1
                 OR live.name ILIKE $1
                 OR live.coupon_code ILIKE $1)"
    )
}

/// The status and campaign filters, written once for both queries.
///
/// Text arrays rather than single values so a panel with three statuses ticked
/// is one request. `NULL` means "no filter" — see [`PromotionScope::statuses`].
const PROMOTION_FILTERS: &str = "
    ($2::text[] IS NULL OR status = ANY($2))
    AND ($3::text[] IS NULL OR campaign_id = ANY($3))
";

/// Every promotion any published book declares: a page of them, how many there
/// are, and how they split.
pub async fn commercial_rules(
    pool: &PgPool,
    scope: PromotionScope,
) -> Result<PromotionPage, AppError> {
    let needle = pattern(scope.needle.as_deref());
    let statuses = some_of(&scope.statuses);
    let campaigns = some_of(&scope.campaigns);

    // The sort, and the tie-break that makes it total. Every order ends in the
    // rule id, which is unique within the deduplicated set, so no two rows can
    // compare equal — which is what stops a keyset from repeating or losing the
    // rows that tie.
    //
    // TWO spellings of the same thing, and they are not interchangeable:
    // `ORDER BY` takes directions, a ROW EXPRESSION does not. Writing
    // `(a ASC, b) > (…)` is a syntax error the compiler cannot catch, because
    // the whole clause is a string.
    let lead = match scope.sort.as_deref() {
        Some("name") => "name",
        Some("status") => "status",
        Some("priority") => "priority",
        Some("campaign") => "campaign_key",
        // Which book a promotion last came from: the newest amendments first,
        // which is how somebody asks "what changed".
        Some("book") => "version",
        _ => "rule_id",
    };
    let (cols, order) = order_by(lead, "rule_id", scope.desc);
    let seek = if scope.desc { "<" } else { ">" };

    let cursor: Option<PromotionCursor> = scope.cursor.as_deref().map(decode_cursor).transpose()?;
    let limit = scope.limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT);

    // The seek re-reads the previous row's own sort value rather than trusting
    // one encoded in the cursor — see [`PromotionCursor`].
    //
    // A cursor whose row the filters no longer keep — a promotion paused, or
    // superseded by a book published between one page and the next — finds no
    // row to compare against, so the comparison is NULL and the page comes back
    // empty. The list ends early rather than starting again, which is the safer
    // of the two wrong answers: a stale cursor stops, and stopping is visible.
    let rows_sql = promotion_rows();
    // `NOT MATERIALIZED`: `kept` is referenced twice — as the page and
    // inside the seek — and two references makes PostgreSQL materialise a
    // CTE, which is an optimisation fence the `ORDER BY … LIMIT` cannot be
    // pushed through. Materialised, this reads the whole table and sorts it
    // to hand back one page; inlined, it seeks the index. See
    // `postgres::audit::list_audit`, where the difference was measured.
    let sql = format!(
        "WITH searched AS NOT MATERIALIZED ({rows_sql}),
              kept AS NOT MATERIALIZED (
             SELECT * FROM searched WHERE {PROMOTION_FILTERS}
         )
         SELECT * FROM kept
          WHERE $4::text IS NULL
             OR ({cols}) {seek} (SELECT {cols} FROM kept WHERE rule_id = $4)
          ORDER BY {order}
          LIMIT $5"
    );
    let rows = sqlx::query(&sql)
        .bind(&needle)
        .bind(&statuses)
        .bind(&campaigns)
        .bind(cursor.as_ref().map(|c| c.rule_id.clone()))
        .bind(limit)
        .fetch_all(pool)
        .await?;

    // A short page is the last page. A full one may not be — the next request
    // can come back empty — and that is the honest answer: knowing whether more
    // rows exist without asking costs a second run of the same query.
    let next_cursor = match rows.last() {
        Some(row) if rows.len() as i64 == limit => Some(encode_cursor(&PromotionCursor {
            rule_id: row.try_get("rule_id")?,
        })?),
        _ => None,
    };

    let mut out = Vec::with_capacity(rows.len());
    for row in &rows {
        out.push(PromotionRow {
            rule_id: row.try_get("rule_id")?,
            name: row.try_get("name")?,
            status: row.try_get("status")?,
            priority: row.try_get("priority")?,
            definition: canonical(row.try_get("definition")?),
            campaign_id: row.try_get("campaign_id")?,
            coupon_code: row.try_get("coupon_code")?,
            publication_id: row.try_get("publication_id")?,
            version: row.try_get("version")?,
            book_name: row.try_get("book_name")?,
            effective_from: row.try_get("effective_from")?,
            effective_to: row.try_get("effective_to")?,
            activated_by: activations(row.try_get("activated_by")?),
        });
    }

    let (total, facets) = promotion_facets(pool, &needle, &statuses, &campaigns).await?;
    Ok(PromotionPage {
        rows: out,
        next_cursor,
        total,
        book_count: published_book_count(pool).await?,
        facets,
    })
}

/// How many promotions there are, and how they split.
///
/// Counted from the SAME row definition the page is drawn from, so a change to
/// what "live" means moves both together. The two scopes here are deliberate,
/// and `money_facets` had them wrong once:
///
///   per-value counts read the SEARCHED set, ignoring what is filtered. The
///     number beside `PAUSED` answers "how many paused promotions are there",
///     which is the question somebody has while deciding whether to click it.
///     Counting the already-filtered set instead shows the chosen value its own
///     row count and every other one a zero.
///   the total reads the FILTERED set, because it describes the list on screen.
async fn promotion_facets(
    pool: &PgPool,
    needle: &Option<String>,
    statuses: &Option<Vec<String>>,
    campaigns: &Option<Vec<String>>,
) -> Result<(i64, PromotionFacets), AppError> {
    let rows_sql = promotion_rows();
    let sql = format!(
        "WITH searched AS ({rows_sql}), kept AS (
             SELECT * FROM searched WHERE {PROMOTION_FILTERS}
         )
         SELECT 'status' AS kind, status AS value, COUNT(*)::bigint AS n
           FROM searched GROUP BY status
          UNION ALL
         SELECT 'campaign', campaign_id, COUNT(*)::bigint
           FROM searched WHERE campaign_id IS NOT NULL GROUP BY campaign_id
          UNION ALL
         SELECT 'all', '', COUNT(*)::bigint FROM kept"
    );
    let rows = sqlx::query(&sql)
        .bind(needle)
        .bind(statuses)
        .bind(campaigns)
        .fetch_all(pool)
        .await?;

    let mut total = 0i64;
    let mut status_facets = Vec::new();
    let mut campaign_facets = Vec::new();
    for row in &rows {
        let kind: String = row.try_get("kind")?;
        let facet = CommercialFacet {
            value: row.try_get("value")?,
            label: None,
            count: row.try_get("n")?,
        };
        match kind.as_str() {
            "status" => status_facets.push(facet),
            "campaign" => campaign_facets.push(facet),
            _ => total = facet.count,
        }
    }
    by_size(&mut status_facets);
    by_size(&mut campaign_facets);
    Ok((
        total,
        PromotionFacets {
            statuses: status_facets,
            campaigns: campaign_facets,
        },
    ))
}

// ── campaigns ────────────────────────────────────────────────────────────

/// One campaign as a screen reads it: the declaration, and the book that
/// carried it.
///
/// What it has actually SPENT is not here. That is an observation and lives in
/// `commercial_usage`, joined by the caller: a limit is frozen with the book
/// that set it, a count changes with every sale in the fleet, and keeping them
/// in one row would freeze the wrong one.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CampaignRow {
    pub campaign_id: String,
    pub name: String,
    pub status: String,
    pub valid_from: Option<DateTime<Utc>>,
    pub valid_to: Option<DateTime<Utc>>,
    /// Null is unlimited, which is not zero — see [`CAMPAIGN_UNLIMITED`].
    pub budget_minor: Option<i64>,
    pub max_uses: Option<i32>,
    /// What a shopper sees. Editable after publication, unlike everything above
    /// it — a banner is not a price.
    pub image_url: Option<String>,
    pub headline: Option<String>,
    pub terms: Option<String>,
    /// The shops it runs in, null or empty meaning everywhere.
    ///
    /// Carried by the LIST and not only by the book reader, and that is
    /// load-bearing rather than tidy: the console restates a whole campaign
    /// from this row when it files an offer under one or pulls its switch, and
    /// a field missing from the restatement is written as ABSENT rather than
    /// left alone. Absent here means everywhere — so a campaign named for six
    /// shops would silently widen to the whole fleet the first time anybody
    /// paused it. The poster was lost exactly this way once already.
    pub site_ids: Option<Vec<String>>,
    pub publication_id: Uuid,
    pub version: i64,
    pub book_name: String,
    pub effective_from: DateTime<Utc>,
    pub effective_to: Option<DateTime<Utc>>,
    pub activated_by: Vec<BookActivation>,
}

/// The one thing the campaign list can be narrowed by.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CampaignFacets {
    pub statuses: Vec<CommercialFacet>,
}

/// A page of campaigns, and the shape of everything it was drawn from.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CampaignPage {
    pub rows: Vec<CampaignRow>,
    /// Opaque. Pass it back as `cursor` for the next page; absent means this
    /// was the last one. See [`PromotionPage::next_cursor`], which makes the
    /// argument in full.
    pub next_cursor: Option<String>,
    pub total: i64,
    pub book_count: i64,
    pub facets: CampaignFacets,
}

/// What a caller is asking the campaign list for.
#[derive(Clone, Debug, Default)]
pub struct CampaignScope {
    /// Free text, tried against the campaign id and its name. Not the headline
    /// or the terms: those are shopper-facing prose and a search box that
    /// matched them would answer "diskon" with every campaign in the estate.
    pub needle: Option<String>,
    /// Statuses to keep. Empty means every status.
    pub statuses: Vec<String>,
    /// `campaign_id`, `name`, `status`, `starts`, `ends`, `budget` or `book`.
    /// Anything unrecognised is the house order — see [`PromotionScope::sort`].
    pub sort: Option<String>,
    pub desc: bool,
    pub cursor: Option<String>,
    pub limit: Option<i64>,
}

#[derive(Serialize, Deserialize)]
struct CampaignCursor {
    campaign_id: String,
}

/// What a campaign with no budget sorts as.
///
/// `bigint`'s ceiling, because a campaign with no budget genuinely has the
/// largest one there is: ascending puts every capped campaign first and the
/// uncapped ones last, descending the other way round, and both readings are
/// true sentences about the data.
///
/// A sentinel VALUE rather than a `NULLS LAST` decoration, for the reason
/// [`promotion_rows`] gives about NULL inside a row comparison: `NULLS LAST`
/// orders a result and says nothing a keyset can seek against.
const CAMPAIGN_UNLIMITED: &str = "9223372036854775807";

/// One campaign row, defined once. See [`promotion_rows`] for why this is a
/// single definition and why the search sits outside the `DISTINCT ON`.
///
/// Binds: `$1` the search pattern, or NULL for no search.
///
/// The three `*_key` columns exist because the keyset compares the sort value
/// in a `WHERE`, and all three are nullable in the table: a campaign with no
/// start, no end or no budget is ordinary, and a raw `valid_to` in a row
/// comparison would end paging at the first one.
fn campaign_rows() -> String {
    format!(
        "SELECT * FROM (
             SELECT DISTINCT ON (g.campaign_id)
                    g.campaign_id, g.name, g.status, g.valid_from, g.valid_to,
                    g.budget_minor, g.max_uses, g.image_url, g.headline, g.terms,
                    g.site_ids,
                    COALESCE(g.valid_from, TIMESTAMPTZ '-infinity') AS starts_at,
                    COALESCE(g.valid_to, TIMESTAMPTZ 'infinity') AS ends_at,
                    COALESCE(g.budget_minor, {CAMPAIGN_UNLIMITED}) AS budget_key,
                    p.id AS publication_id, p.version, p.name AS book_name,
                    p.effective_from, p.effective_to, {ACTIVATED_BY}
               FROM commercial_campaign g
               JOIN commercial_publication p ON p.id = g.publication_id
              WHERE p.status = 'PUBLISHED'
              ORDER BY g.campaign_id, p.version DESC
         ) live
          WHERE ($1::text IS NULL
                 OR live.campaign_id ILIKE $1
                 OR live.name ILIKE $1)"
    )
}

const CAMPAIGN_FILTERS: &str = "($2::text[] IS NULL OR status = ANY($2))";

/// Every campaign any published book declares: a page of them, how many there
/// are, and how they split.
pub async fn commercial_campaigns(
    pool: &PgPool,
    scope: CampaignScope,
) -> Result<CampaignPage, AppError> {
    let needle = pattern(scope.needle.as_deref());
    let statuses = some_of(&scope.statuses);

    let lead = match scope.sort.as_deref() {
        Some("name") => "name",
        Some("status") => "status",
        Some("starts") => "starts_at",
        Some("ends") => "ends_at",
        Some("budget") => "budget_key",
        Some("book") => "version",
        _ => "campaign_id",
    };
    let (cols, order) = order_by(lead, "campaign_id", scope.desc);
    let seek = if scope.desc { "<" } else { ">" };

    let cursor: Option<CampaignCursor> = scope.cursor.as_deref().map(decode_cursor).transpose()?;
    let limit = scope.limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT);

    let rows_sql = campaign_rows();
    // `NOT MATERIALIZED`: `kept` is referenced twice — as the page and
    // inside the seek — and two references makes PostgreSQL materialise a
    // CTE, which is an optimisation fence the `ORDER BY … LIMIT` cannot be
    // pushed through. Materialised, this reads the whole table and sorts it
    // to hand back one page; inlined, it seeks the index. See
    // `postgres::audit::list_audit`, where the difference was measured.
    let sql = format!(
        "WITH searched AS NOT MATERIALIZED ({rows_sql}),
              kept AS NOT MATERIALIZED (
             SELECT * FROM searched WHERE {CAMPAIGN_FILTERS}
         )
         SELECT * FROM kept
          WHERE $3::text IS NULL
             OR ({cols}) {seek} (SELECT {cols} FROM kept WHERE campaign_id = $3)
          ORDER BY {order}
          LIMIT $4"
    );
    let rows = sqlx::query(&sql)
        .bind(&needle)
        .bind(&statuses)
        .bind(cursor.as_ref().map(|c| c.campaign_id.clone()))
        .bind(limit)
        .fetch_all(pool)
        .await?;

    let next_cursor = match rows.last() {
        Some(row) if rows.len() as i64 == limit => Some(encode_cursor(&CampaignCursor {
            campaign_id: row.try_get("campaign_id")?,
        })?),
        _ => None,
    };

    let mut out = Vec::with_capacity(rows.len());
    for row in &rows {
        out.push(CampaignRow {
            campaign_id: row.try_get("campaign_id")?,
            name: row.try_get("name")?,
            status: row.try_get("status")?,
            valid_from: row.try_get("valid_from")?,
            valid_to: row.try_get("valid_to")?,
            budget_minor: row.try_get("budget_minor")?,
            max_uses: row.try_get("max_uses")?,
            image_url: row.try_get("image_url")?,
            headline: row.try_get("headline")?,
            terms: row.try_get("terms")?,
            site_ids: row.try_get("site_ids")?,
            publication_id: row.try_get("publication_id")?,
            version: row.try_get("version")?,
            book_name: row.try_get("book_name")?,
            effective_from: row.try_get("effective_from")?,
            effective_to: row.try_get("effective_to")?,
            activated_by: activations(row.try_get("activated_by")?),
        });
    }

    let (total, statuses) = campaign_facets(pool, &needle, &statuses).await?;
    Ok(CampaignPage {
        rows: out,
        next_cursor,
        total,
        book_count: published_book_count(pool).await?,
        facets: CampaignFacets { statuses },
    })
}

/// How many campaigns there are, and how they split by status. Two scopes, for
/// the reason [`promotion_facets`] gives.
async fn campaign_facets(
    pool: &PgPool,
    needle: &Option<String>,
    statuses: &Option<Vec<String>>,
) -> Result<(i64, Vec<CommercialFacet>), AppError> {
    let rows_sql = campaign_rows();
    let sql = format!(
        "WITH searched AS ({rows_sql}), kept AS (
             SELECT * FROM searched WHERE {CAMPAIGN_FILTERS}
         )
         SELECT 'status' AS kind, status AS value, COUNT(*)::bigint AS n
           FROM searched GROUP BY status
          UNION ALL
         SELECT 'all', '', COUNT(*)::bigint FROM kept"
    );
    let rows = sqlx::query(&sql)
        .bind(needle)
        .bind(statuses)
        .fetch_all(pool)
        .await?;

    let mut total = 0i64;
    let mut facets = Vec::new();
    for row in &rows {
        let kind: String = row.try_get("kind")?;
        let facet = CommercialFacet {
            value: row.try_get("value")?,
            label: None,
            count: row.try_get("n")?,
        };
        if kind == "status" {
            facets.push(facet);
        } else {
            total = facet.count;
        }
    }
    by_size(&mut facets);
    Ok((total, facets))
}

// ── coupons ──────────────────────────────────────────────────────────────

/// Every coupon any published book declares.
///
/// Not narrowed by validity, matching `load_coupons`: to the engine a code that
/// is absent and one that has lapsed are different answers — "no such code"
/// against "that one expired on Friday" — and dropping the lapsed ones here
/// would have the centre give the first where a till gives the second.
///
/// Left as a bare list on purpose — see the module note. A coupon is read under
/// the promotion it unlocks, not browsed.
pub async fn commercial_coupons(pool: &PgPool) -> Result<Value, AppError> {
    let rows = sqlx::query(&format!(
        "SELECT DISTINCT ON (c.code)
                c.code, c.rule_id, c.active, c.customer_id,
                c.valid_from, c.valid_to, c.max_uses,
                p.id AS publication_id, p.version, p.name AS book_name,
                p.effective_from, p.effective_to, {activated}
           FROM commercial_coupon c
           JOIN commercial_publication p ON p.id = c.publication_id
          WHERE p.status = 'PUBLISHED'
          ORDER BY c.code, p.version DESC",
        activated = ACTIVATED_BY
    ))
    .fetch_all(pool)
    .await?;

    let items: Vec<Value> = rows
        .into_iter()
        .map(|row| {
            json!({
                "code": row.get::<String, _>("code"),
                "rule_id": row.get::<String, _>("rule_id"),
                "active": row.get::<bool, _>("active"),
                "customer_id": row.get::<Option<String>, _>("customer_id"),
                "valid_from": row.get::<Option<DateTime<Utc>>, _>("valid_from"),
                "valid_to": row.get::<Option<DateTime<Utc>>, _>("valid_to"),
                "max_uses": row.get::<Option<i32>, _>("max_uses"),
                "publication_id": row.get::<Uuid, _>("publication_id"),
                "version": row.get::<i64, _>("version"),
                "book_name": row.get::<String, _>("book_name"),
                "effective_from": row.get::<DateTime<Utc>, _>("effective_from"),
                "effective_to": row.get::<Option<DateTime<Utc>>, _>("effective_to"),
                "activated_by": row.get::<Value, _>("activated_by"),
            })
        })
        .collect();

    Ok(json!({ "items": items, "book_count": published_book_count(pool).await? }))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A rule published before `scope` existed.
    ///
    /// This is not a hypothetical: books in production carry documents this
    /// shape, every till applies them, and the centre used to hand the column
    /// out untouched — so the hub's promotions list read `scope.applicability`
    /// of `undefined` and the whole screen was replaced by a stack trace.
    #[test]
    fn a_document_missing_scope_comes_back_with_the_engine_default() {
        let stored = json!({
            "rule_id": "rule-old",
            "name": "Published before scope existed",
            "effect": { "kind": "PERCENT", "bps": 2000, "compound": false },
        });

        let out = canonical(stored);

        // Present, and open — `RuleScope::default()` is unscoped and applies to
        // everyone, which is exactly what the till has always done with it.
        assert_eq!(out["scope"]["applicability"], Value::Null);
        assert_eq!(out["scope"]["customers"]["who"], "EVERYONE");
        assert_eq!(out["conditions"]["min_quantity"], 0);
        assert_eq!(out["caps"]["budget"], Value::Null);
        // And the parts that were stored are untouched.
        assert_eq!(out["effect"]["bps"], 2000);
        assert_eq!(out["rule_id"], "rule-old");
    }

    /// A document this build genuinely cannot parse is still listed.
    ///
    /// The evaluator drops it — a price must never be guessed at. A list must
    /// not, because a promotion nobody can see is a promotion nobody can turn
    /// off.
    #[test]
    fn an_unreadable_document_is_passed_through_rather_than_dropped() {
        let stored = json!({ "rule_id": "rule-broken", "name": "No effect at all" });
        assert_eq!(canonical(stored.clone()), stored);
    }

    /// An empty search is not a search, and a blank one is not either.
    #[test]
    fn a_blank_search_is_no_search() {
        assert_eq!(pattern(None), None);
        assert_eq!(pattern(Some("   ")), None);
        assert_eq!(pattern(Some(" lebaran ")), Some("%lebaran%".into()));
    }

    /// Unticking the last box asks for everything, not for nothing.
    #[test]
    fn an_empty_filter_and_no_filter_are_one_request() {
        assert_eq!(some_of(&[]), None);
        assert_eq!(some_of(&["ACTIVE".to_owned()]), Some(vec!["ACTIVE".into()]));
    }
}
