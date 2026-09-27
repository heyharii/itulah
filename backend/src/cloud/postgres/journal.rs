//! Reading the journal: the register, one entry, and an account's ledger.
//!
//! Writing lives in `poster.rs`. Everything here is a projection — there is no
//! stored balance anywhere in this file, including the running balance in the
//! general ledger, which is a window function over the lines rather than a
//! column somebody maintains.

use crate::cloud::application::AppError;
use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Row};
use uuid::Uuid;

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct JournalEntryRow {
    pub entry_id: Uuid,
    pub entry_number: String,
    pub posting_date: NaiveDate,
    pub source_kind: String,
    pub source_id: Option<String>,
    pub total_minor: i64,
    pub currency: String,
    pub memo: Option<String>,
    pub posted_by: String,
    pub posted_at: DateTime<Utc>,
    /// Set when this entry undoes another. The screen shows it as a link rather
    /// than as a status, because both entries remain real.
    pub reversal_of: Option<Uuid>,
    /// Set when this entry has itself been reversed. Derived, not stored.
    pub reversed_by: Option<Uuid>,
    pub line_count: i64,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct JournalLineView {
    pub line_number: i32,
    pub account_code: String,
    /// The client's own name, never translated.
    pub account_name: String,
    pub site_id: String,
    /// The unit on the other side, on an inter-unit line and nowhere else.
    ///
    /// Present on the affiliate legs `poster.rs` adds, which is the only place
    /// it is ever written. Without it the entry that funded store 03's
    /// electricity shows two lines called "Hutang Affiliasi Pembiayaan" and a
    /// reader has to decode a twelve-digit code to find out which is whose.
    pub counter_site_id: Option<String>,
    pub debit_minor: i64,
    pub credit_minor: i64,
    pub party_type: Option<String>,
    pub party_id: Option<String>,
    /// What kind of thing this line is, on the accounts that are kept by kind.
    ///
    /// Not a decoration on a drill-down: with forty accounts the code alone no
    /// longer says what a line is about. Every general and administrative
    /// expense the company pays is `6301`, and an entry detail showing four
    /// lines of `6301` without their categories is a screen a reader has to
    /// leave in order to understand.
    pub category_code: Option<String>,
    /// The category's own name, so the entry reads without a second lookup —
    /// the same bargain `account_name` already struck.
    pub category_name: Option<String>,
    /// Which asset this line is about, when it is about one. The second
    /// sub-ledger dimension, beside the supplier.
    pub asset_id: Option<Uuid>,
    /// `AST-000123`, so a drill-down reads as a sentence rather than as a
    /// UUID somebody has to look up.
    pub asset_number: Option<String>,
    pub memo: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct JournalEntryDetail {
    /// A named field rather than `#[serde(flatten)]`: ts-rs does not render a
    /// flattened struct faithfully, and a wire type the generator cannot
    /// describe is exactly the hand-mirroring this whole contract exists to
    /// avoid.
    pub entry: JournalEntryRow,
    pub lines: Vec<JournalLineView>,
}

const ENTRY_COLUMNS: &str =
    "e.entry_id, e.entry_number, e.posting_date, e.source_kind, e.source_id,
     e.total_minor, e.currency, e.memo, e.posted_by, e.posted_at, e.reversal_of,
     (SELECT r.entry_id FROM journal_entry r WHERE r.reversal_of = e.entry_id) AS reversed_by,
     (SELECT COUNT(*) FROM journal_line l WHERE l.entry_id = e.entry_id)::bigint AS line_count";

fn to_entry(row: &sqlx::postgres::PgRow) -> Result<JournalEntryRow, AppError> {
    Ok(JournalEntryRow {
        entry_id: row.try_get("entry_id")?,
        entry_number: row.try_get("entry_number")?,
        posting_date: row.try_get("posting_date")?,
        source_kind: row.try_get("source_kind")?,
        source_id: row.try_get("source_id")?,
        total_minor: row.try_get("total_minor")?,
        currency: row.try_get("currency")?,
        memo: row.try_get("memo")?,
        posted_by: row.try_get("posted_by")?,
        posted_at: row.try_get("posted_at")?,
        reversal_of: row.try_get("reversal_of")?,
        reversed_by: row.try_get("reversed_by")?,
        line_count: row.try_get("line_count")?,
    })
}

// ── the register ─────────────────────────────────────────────────────────
//
// Brought up to the shape `money_overview` set in `postgres::statements`: a
// scope struct in, an envelope out, a keyset cursor over the sort order, and
// facet counts drawn from the same row definition as the page. Copied
// deliberately rather than reinvented — two list endpoints that page
// differently are two things to learn and two things to get wrong.

/// How many entries the register returns when the caller does not say.
///
/// Here rather than in the handler, beside the only clamp that enforces it. It
/// was in both once, which is one spelling too many for a number that decides
/// how much of the books a screen can see.
const DEFAULT_ENTRY_LIMIT: i64 = 200;
/// And the most it will return however loudly a caller asks.
const MAX_ENTRY_LIMIT: i64 = 1000;

/// What a caller is asking the register for.
#[derive(Clone, Debug, Default)]
pub struct JournalScope {
    /// The window. Both ends inclusive, and both optional — the register with
    /// no window is the whole journal, which is what it has always answered.
    pub from: Option<NaiveDate>,
    pub to: Option<NaiveDate>,
    /// Free text, tried against the entry number, the memo and the source
    /// document's own id.
    ///
    /// The source id matters more than it looks: `PLN-0912` is what somebody
    /// has in their hand when they come to the register asking "did this
    /// post", and before this they had to know which month it landed in and
    /// read down the page.
    pub needle: Option<String>,
    /// `source_kind`s to keep. Empty means every kind, which is what the
    /// register is for — an empty filter and no filter are the same request.
    ///
    /// Plural where the old `kind` was single: two ticked boxes is how a facet
    /// panel spells itself, and a caller sending exactly one — as every
    /// existing caller does — is unaffected.
    pub kinds: Vec<String>,
    /// Locations. An entry has no location of its own — its LINES do, and a
    /// payment can settle two shops' bills at once — so this asks whether any
    /// line of the entry touched one of these.
    pub sites: Vec<String>,
    /// `number`, `total` or `kind`. Anything else is the house order, newest
    /// first — see [`journal_page`].
    ///
    /// There is no `lines` sort, and the reason is in [`ENTRY_ROWS`]: ordering
    /// by how many sides an entry has would mean counting the lines of every
    /// entry in the window to draw a page of it.
    pub sort: Option<String>,
    pub desc: bool,
    pub cursor: Option<String>,
    /// Absent means [`DEFAULT_ENTRY_LIMIT`], not "everything". The route has
    /// always truncated here; what is new is that `total` says so.
    pub limit: Option<i64>,
}

/// One value a filter can take, and how many entries would still be there.
///
/// `MoneyFacet`'s shape and reasoning: a value that would leave nothing is a
/// value nobody should have to click to find out about. Counted over
/// everything the WINDOW and the SEARCH leave, deliberately ignoring which
/// filters are currently applied — so the number reads as "how many of these
/// there are", which is the question somebody has while choosing.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct JournalFacet {
    pub value: String,
    /// What to draw, when it differs from the value.
    ///
    /// Absent for a source kind, whose words belong to the screen —
    /// "Hand-written" is the hub's phrasing of `MANUAL`, not the server's.
    /// Present for a location, because `store-01` is an id this system files
    /// it under and the panel beside the column shows `Store 01`.
    pub label: Option<String>,
    pub count: i64,
}

/// The two things the register can be narrowed by.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct JournalFacets {
    pub kinds: Vec<JournalFacet>,
    /// **These do not add up to `total`, and that is not a fault.** An entry
    /// with lines at two locations is counted under both, because it genuinely
    /// touched both — a payment settling Bandung's and Cikupa's bills is one
    /// entry and two shops' business. A panel whose numbers summed to the total
    /// would have to pick one location per entry, and there is no honest way to
    /// pick.
    pub sites: Vec<JournalFacet>,
}

/// A page of the register, and the shape of everything it was drawn from.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct JournalPage {
    pub rows: Vec<JournalEntryRow>,
    /// Opaque. Pass it back as `cursor` for the next page; absent means this
    /// was the last one.
    ///
    /// Deliberately not an offset. Entries post while somebody pages through
    /// the register — that is what a register is — and an offset would skip or
    /// repeat them with nothing saying so.
    pub next_cursor: Option<String>,
    /// Every entry the window, the search and the filters match, not just this
    /// page. Without it a screen can only say "200 entries", which is a
    /// statement about the page size rather than about the month.
    pub total: i64,
    /// What those entries come to, added HERE.
    ///
    /// Only the server has every row. A paged list summed in the browser gives
    /// a figure that grows while somebody reads, and on a finance screen a
    /// total that changes as you scroll is worse than no total at all.
    ///
    /// The sum of `total_minor`, which is each entry's own one-sided total —
    /// debits, which equal credits, because the poster will not write an entry
    /// where they do not. It is not a balance and must not be read as one.
    pub total_minor: i64,
    pub facets: JournalFacets,
}

/// Where the previous page stopped — as a ROW, not as a position.
///
/// The entry id and nothing else, whatever the list is sorted by, exactly as
/// `MoneyCursor` carries the account map's natural key. The seek re-reads that
/// row's own sort value in SQL, so one cursor shape serves every order and a
/// fifth sort cannot arrive without its cursor.
#[derive(Serialize, Deserialize)]
struct JournalCursor {
    entry_id: Uuid,
}

impl JournalCursor {
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

/// One register row, defined once — and deliberately CHEAP.
///
/// Used by the page query and by the facet counts, and that is the whole
/// reason it is a constant: the facets are only honest if they count exactly
/// what the page can show.
///
/// Binds: `$1` from, `$2` to, `$3` the search pattern or NULL.
///
/// # What is NOT here, and why
///
/// `reversed_by`, `line_count` and the entry's locations are all per-row
/// lookups, and a CTE is materialised before the `LIMIT` — so putting them
/// here would run three subqueries for every entry the window matches in order
/// to draw two hundred. With 97 entries that is free; this table gains a row
/// every time a till closes, and the version of this query that computed
/// `site_ids` for a million entries to show a page of them is the version
/// nobody could explain afterwards.
///
/// So they are added in the outer `SELECT`, which runs after the keyset and
/// the `LIMIT` — the page's rows and no others. The cost is that neither can
/// be a SORT key, because a keyset has to compare its sort value in a `WHERE`
/// over `kept`. That is why there is no `lines` sort: ordering by it would
/// mean counting the lines of every entry in the window, which is the whole
/// journal, to put the fourteen-line correction at the top.
///
/// It stops at the WINDOW and the SEARCH. The kind and site filters are
/// applied outside it by each caller, which is what lets one definition answer
/// two different questions from the same rows: the page wants what the filters
/// leave, while the filter panel's counts want what the search alone leaves —
/// because "Payments 41" has to mean "there are 41 payment entries", not "41
/// among the ones you have already narrowed to payments".
const ENTRY_ROWS: &str = "
    SELECT e.entry_id, e.entry_number, e.posting_date, e.source_kind, e.source_id,
           e.total_minor, e.currency, e.memo, e.posted_by, e.posted_at,
           e.reversal_of
      FROM journal_entry e
     WHERE ($1::date IS NULL OR e.posting_date >= $1)
       AND ($2::date IS NULL OR e.posting_date <= $2)
       AND ($3::text IS NULL
            OR e.entry_number ILIKE $3
            OR e.memo ILIKE $3
            OR e.source_id ILIKE $3
            -- Who posted it: what one person keyed this month is a question
            -- the register is asked, and it used to be answered only over the
            -- page the browser held.
            OR e.posted_by ILIKE $3)
";

/// The filters, spelled once so the page and the counts narrow identically.
///
/// Binds from `$4`: the kinds or NULL, the sites or NULL.
///
/// The site test is an `EXISTS` against `journal_line` rather than an array
/// built per entry, for the reason `ENTRY_ROWS` gives and for one more: an
/// `EXISTS` can stop at the first matching line and rides
/// `ix_journal_line_entry`, while an array has to read every line of every
/// entry before it can be compared.
const ENTRY_FILTERS: &str = "
    ($4::text[] IS NULL OR s.source_kind = ANY($4))
    AND ($5::text[] IS NULL OR EXISTS (
            SELECT 1 FROM journal_line l
             WHERE l.entry_id = s.entry_id AND l.site_id = ANY($5)))
";

/// The per-row lookups, added to the PAGE and to nothing else.
const ENTRY_DECORATIONS: &str = "
    (SELECT r.entry_id FROM journal_entry r WHERE r.reversal_of = k.entry_id)
        AS reversed_by,
    (SELECT COUNT(*) FROM journal_line l WHERE l.entry_id = k.entry_id)::bigint
        AS line_count
";

/// The register, one page at a time, beside how big the whole answer is.
///
/// `sites` asks whether ANY line of the entry touched one of those locations,
/// and deliberately not whether the entry "belongs" to one — an entry has no
/// location, only its lines do.
pub async fn journal_page(pool: &PgPool, scope: JournalScope) -> Result<JournalPage, AppError> {
    // A blank search is not a search. `Some("")` would compile to `ILIKE '%%'`,
    // which matches everything and costs a scan to say so.
    let needle = scope
        .needle
        .as_deref()
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(|text| format!("%{text}%"));
    let kinds = (!scope.kinds.is_empty()).then(|| scope.kinds.clone());
    let sites = (!scope.sites.is_empty()).then(|| scope.sites.clone());

    // The sort, and the tie-break that makes it total. Every order ends in the
    // entry id, which is the primary key, so no two rows can compare equal —
    // which is what stops a keyset from repeating or losing the rows that tie.
    //
    // TWO spellings of the same thing, and they are not interchangeable:
    // `ORDER BY` takes directions, a ROW EXPRESSION does not. Writing
    // `(a ASC, b) > (…)` is a syntax error the compiler cannot catch, because
    // the whole clause is a string.
    let (lead, descending): (&str, bool) = match scope.sort.as_deref() {
        Some("number") => ("entry_number", scope.desc),
        Some("total") => ("total_minor", scope.desc),
        Some("kind") => ("source_kind, posting_date", scope.desc),
        // The house order's own columns, in whichever direction was asked —
        // so a register sorted by date can be read oldest first too.
        Some("date") => ("posting_date, entry_number", scope.desc),
        // The house order, and the one this endpoint has always answered in:
        // the newest entry first. `dir` is not read here — a default order that
        // reverses is not a default.
        _ => ("posting_date, entry_number", true),
    };
    let cols = format!("{lead}, entry_id");
    let dir = if descending { "DESC" } else { "ASC" };
    let order = format!(
        "{} {dir}, entry_id {dir}",
        lead.replace(", ", &format!(" {dir}, "))
    );
    // Which way the seek points follows the direction, or paging a descending
    // list walks back up it.
    let seek = if descending { "<" } else { ">" };

    let cursor = scope
        .cursor
        .as_deref()
        .map(JournalCursor::decode)
        .transpose()?;
    let limit = scope
        .limit
        .unwrap_or(DEFAULT_ENTRY_LIMIT)
        .clamp(1, MAX_ENTRY_LIMIT);

    // The seek re-reads the previous row's own sort value rather than trusting
    // one encoded in the cursor — see [`JournalCursor`].
    //
    // A cursor whose row the filters no longer keep — a window that moved
    // between one page and the next — finds no row to compare against, so the
    // comparison is NULL and the page comes back empty. The list ends early
    // rather than starting again, which is the safer of the two wrong answers:
    // a stale cursor stops, and stopping is visible.
    // `NOT MATERIALIZED`: `kept` is referenced twice — as the page and
    // inside the seek — and two references makes PostgreSQL materialise a
    // CTE, which is an optimisation fence the `ORDER BY … LIMIT` cannot be
    // pushed through. Materialised, this reads the whole table and sorts it
    // to hand back one page; inlined, it seeks the index. See
    // `postgres::audit::list_audit`, where the difference was measured.
    let sql = format!(
        "WITH searched AS NOT MATERIALIZED ({ENTRY_ROWS}),
              kept AS NOT MATERIALIZED (
             SELECT s.* FROM searched s WHERE {ENTRY_FILTERS}
         )
         SELECT k.*, {ENTRY_DECORATIONS} FROM kept k
          WHERE $6::uuid IS NULL
             OR ({cols}) {seek} (SELECT {cols} FROM kept WHERE entry_id = $6)
          ORDER BY {order}
          LIMIT $7"
    );
    let rows = sqlx::query(&sql)
        .bind(scope.from)
        .bind(scope.to)
        .bind(&needle)
        .bind(&kinds)
        .bind(&sites)
        .bind(cursor.as_ref().map(|c| c.entry_id))
        .bind(limit)
        .fetch_all(pool)
        .await?;

    // A short page is the last page. A full one may not be — the next request
    // can come back empty — and that is the honest answer: knowing whether
    // more rows exist without asking costs a second run of the same query.
    let next_cursor = match rows.last() {
        Some(row) if rows.len() as i64 == limit => Some(
            JournalCursor {
                entry_id: row.try_get("entry_id")?,
            }
            .encode()?,
        ),
        _ => None,
    };

    let out = rows.iter().map(to_entry).collect::<Result<Vec<_>, _>>()?;
    let (total, total_minor, facets) = journal_facets(pool, &scope, needle.as_deref()).await?;
    Ok(JournalPage {
        rows: out,
        next_cursor,
        total,
        total_minor,
        facets,
    })
}

/// How many entries there are, what they come to, and how they split.
///
/// Counted from the SAME row definition the page is drawn from, so a count
/// beside a filter is a count of rows that filter could actually produce.
///
/// The two scopes here are deliberate:
///
///   per-value counts read the SEARCHED set, ignoring what is filtered. The
///     number beside `MANUAL` answers "how many hand-written entries are
///     there", which is the question somebody has while deciding whether to
///     click it. Counting the already-filtered set instead shows the chosen
///     value its own row count and every other one a zero.
///   the total and the money read the FILTERED set, because they describe the
///     list on screen.
async fn journal_facets(
    pool: &PgPool,
    scope: &JournalScope,
    needle: Option<&str>,
) -> Result<(i64, i64, JournalFacets), AppError> {
    let sql = format!(
        "WITH searched AS ({ENTRY_ROWS}), kept AS (
             SELECT s.* FROM searched s WHERE {ENTRY_FILTERS}
         )
         SELECT 'kind' AS kind, source_kind AS value, NULL::text AS label,
                COUNT(*)::bigint AS n, 0::bigint AS money
           FROM searched GROUP BY source_kind
          UNION ALL
         -- Counted by JOINING the lines rather than by unnesting an array
         -- built per entry: same answer, and it rides `ix_journal_line_entry`
         -- instead of reading every line of the window twice.
         --
         -- `COUNT(DISTINCT entry_id)`, because an entry with two lines at one
         -- shop is one entry that touched that shop. These still do not sum to
         -- `total` — an entry at two shops is counted under both, which is
         -- what `JournalFacets::sites` says and means.
         SELECT 'site', l.site_id,
                (SELECT p.name FROM site p WHERE p.id = l.site_id),
                COUNT(DISTINCT l.entry_id)::bigint, 0::bigint
           FROM searched s JOIN journal_line l ON l.entry_id = s.entry_id
          GROUP BY l.site_id
          UNION ALL
         SELECT 'all', '', NULL::text, COUNT(*)::bigint,
                COALESCE(SUM(total_minor), 0)::bigint
           FROM kept"
    );
    let kinds = (!scope.kinds.is_empty()).then(|| scope.kinds.clone());
    let sites = (!scope.sites.is_empty()).then(|| scope.sites.clone());
    let rows = sqlx::query(&sql)
        .bind(scope.from)
        .bind(scope.to)
        .bind(needle)
        .bind(&kinds)
        .bind(&sites)
        .fetch_all(pool)
        .await?;

    let mut total = 0i64;
    let mut total_minor = 0i64;
    let mut kind_facets = Vec::new();
    let mut site_facets = Vec::new();
    for row in &rows {
        let kind: String = row.try_get("kind")?;
        let value: String = row.try_get("value")?;
        let label: Option<String> = row.try_get("label")?;
        let n: i64 = row.try_get("n")?;
        match kind.as_str() {
            "kind" => kind_facets.push(JournalFacet {
                value,
                label,
                count: n,
            }),
            "site" => site_facets.push(JournalFacet {
                value,
                label,
                count: n,
            }),
            _ => {
                total = n;
                total_minor = row.try_get("money")?;
            }
        }
    }
    // Biggest first, as every other facet panel here is: a filter list is read
    // top-down and the value somebody is most likely to want is the one with
    // the most behind it. Ties break on the value so the order is stable
    // between calls — a list that reshuffles under the cursor is a list nobody
    // can click.
    for list in [&mut kind_facets, &mut site_facets] {
        list.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.value.cmp(&b.value)));
    }
    Ok((
        total,
        total_minor,
        JournalFacets {
            kinds: kind_facets,
            sites: site_facets,
        },
    ))
}

pub async fn journal_entry(pool: &PgPool, entry_id: Uuid) -> Result<JournalEntryDetail, AppError> {
    let sql = format!("SELECT {ENTRY_COLUMNS} FROM journal_entry e WHERE e.entry_id = $1");
    let row = sqlx::query(&sql)
        .bind(entry_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound("journal entry".into()))?;
    let entry = to_entry(&row)?;

    let lines = sqlx::query(
        "SELECT l.line_number, l.account_code, a.name AS account_name, l.site_id,
                l.counter_site_id, l.debit_minor, l.credit_minor, l.party_type, l.party_id,
                l.category_code, k.name AS category_name,
                l.asset_id, f.asset_number, l.memo
           FROM journal_line l
           JOIN ledger_account a ON a.account_code = l.account_code
           LEFT JOIN line_category k ON k.category_code = l.category_code
           LEFT JOIN fixed_asset f ON f.asset_id = l.asset_id
          WHERE l.entry_id = $1 ORDER BY l.line_number",
    )
    .bind(entry_id)
    .fetch_all(pool)
    .await?;

    Ok(JournalEntryDetail {
        entry,
        lines: lines
            .iter()
            .map(|row| {
                Ok(JournalLineView {
                    line_number: row.try_get("line_number")?,
                    account_code: row.try_get("account_code")?,
                    account_name: row.try_get("account_name")?,
                    site_id: row.try_get("site_id")?,
                    counter_site_id: row.try_get("counter_site_id")?,
                    debit_minor: row.try_get("debit_minor")?,
                    credit_minor: row.try_get("credit_minor")?,
                    party_type: row.try_get("party_type")?,
                    party_id: row.try_get("party_id")?,
                    category_code: row.try_get("category_code")?,
                    category_name: row.try_get("category_name")?,
                    asset_id: row.try_get("asset_id")?,
                    asset_number: row.try_get("asset_number")?,
                    memo: row.try_get("memo")?,
                })
            })
            .collect::<Result<Vec<_>, AppError>>()?,
    })
}

// ── one account's own ledger ─────────────────────────────────────────────
//
// The same envelope as the register, with one rule that overrides the
// convention: **the totals this screen exists to prove do not move when
// somebody types in the search box.** A general ledger is read to answer "what
// did this account do, and does it still add up"; the second half is about the
// whole window, and a figure that shrank as you narrowed the rows would be a
// trial balance that disagreed with itself on demand. So `opening_minor`,
// `closing_minor`, `window_debit_minor`, `window_credit_minor` and
// `window_rows` are computed BEFORE the search, and only `rows`, `total` and
// the facet counts move.
//
// The same rule shapes `running_minor`: it is a window function over the whole
// window, so it stays the balance after that movement rather than a running
// total of what happens to be on screen. Two rows on a searched page will
// ordinarily have a gap between their running figures — that gap is the
// movements the search hid, and it is the truth.

/// How many movements one account's ledger returns when the caller does not
/// say.
const DEFAULT_LEDGER_LIMIT: i64 = 200;
/// And the most it will return however loudly a caller asks.
const MAX_LEDGER_LIMIT: i64 = 1000;

/// What a caller is asking one account's ledger for.
#[derive(Clone, Debug, Default)]
pub struct GeneralLedgerScope {
    /// One location, or all of them. **Part of the window, not a filter**: it
    /// narrows the opening balance and the totals too, which is what it has
    /// always done — "cash at Cikupa" is a different ledger, not a filtered
    /// view of a wider one.
    pub site_id: Option<String>,
    pub from: NaiveDate,
    pub to: NaiveDate,
    /// Free text, tried against the entry number, the line's memo (falling
    /// back to the entry's) and the source document's own id.
    ///
    /// A filter on the ROWS and on nothing else. See the note above the
    /// module section: narrowing what is listed must not narrow what is
    /// proved.
    pub needle: Option<String>,
    /// `source_kind`s to keep. Empty means every kind. Also rows-only.
    pub kinds: Vec<String>,
    /// Categories to keep. Empty means every category, and also every line
    /// that carries none. Rows-only, like the kinds.
    ///
    /// The filter the forty-account chart made necessary: `6301` is every
    /// general and administrative expense the company pays, so its ledger is
    /// forty-eight kinds of cost in one list and "what did we spend on
    /// electricity" is unanswerable without this.
    pub categories: Vec<String>,
    /// `amount`, `entry` or `reconciliation`. Anything else is the house
    /// order: the window's own sequence, which is the order the running
    /// balance was computed in.
    pub sort: Option<String>,
    pub desc: bool,
    pub cursor: Option<String>,
    /// Absent means [`DEFAULT_LEDGER_LIMIT`], not "everything". This endpoint
    /// used to answer a whole month unpaged, which is fine for a shop's petty
    /// cash and is thousands of rows for the bank account in December.
    pub limit: Option<i64>,
}

/// One value a filter can take, and how many movements would still be there.
///
/// `MoneyFacet`'s shape and reasoning. Counted over everything the WINDOW
/// leaves, deliberately ignoring the search and the filters — so the number
/// reads as "how many of these there are in this month", which is the question
/// somebody has while choosing.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct GeneralLedgerFacet {
    pub value: String,
    pub label: Option<String>,
    pub count: i64,
}

/// The two things one account's ledger can be narrowed by.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct GeneralLedgerFacets {
    pub kinds: Vec<GeneralLedgerFacet>,
    /// The categories this account was posted under inside the window, with
    /// the client's own name for each as the label. Empty on an account that
    /// declares no family, which is most of the balance sheet.
    pub categories: Vec<GeneralLedgerFacet>,
    /// The locations this account moved at inside the window.
    ///
    /// Informational when `site_id` was given, where there is exactly one and
    /// clicking it cannot change the answer — it is left in rather than
    /// suppressed because here it is also the caption for a window somebody
    /// has already narrowed.
    pub sites: Vec<GeneralLedgerFacet>,
}

/// One movement in an account's own ledger.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct GeneralLedgerRow {
    /// The JOURNAL LINE's own id, and not the entry's.
    ///
    /// They are different things and the difference is load-bearing here.
    /// Reconciliation is keyed on the line — `bank_line_match.journal_line_id`
    /// — because a bank statement agrees with one side of an entry, not with
    /// the entry. A payment carries only `journal_entry_id`, which is why the
    /// payments list cannot say whether a payment has cleared and this list
    /// can. Sending the line id is what makes `reconciled` below an answer
    /// rather than a guess.
    pub line_id: Uuid,
    pub entry_id: Uuid,
    pub entry_number: String,
    pub posting_date: NaiveDate,
    pub source_kind: String,
    pub source_id: Option<String>,
    /// The account this LINE landed on, which is not always the account that
    /// was asked for.
    ///
    /// The code is matched by PREFIX — that is how "what happened in CASH this
    /// month" is asked without knowing cash is fourteen leaves — so under a
    /// heading the rows come from several accounts and a row that could not
    /// name its own was unreadable. Filling that column meant opening every
    /// voucher, one request per row, to find out which leaf the line was on.
    pub account_code: String,
    /// The client's own name for that account, never translated.
    pub account_name: String,
    /// What kind of thing this line is, on an account that is kept by kind,
    /// and the client's own name for that kind.
    ///
    /// The same argument `account_code` above makes, one level down: under
    /// `6301` every row would otherwise be called "Beban Umum & Administrasi",
    /// and telling them apart would mean opening each voucher.
    pub category_code: Option<String>,
    pub category_name: Option<String>,
    pub site_id: String,
    /// The unit on the other side of the movement, when the posting named
    /// one. 0120 put it on the line.
    ///
    /// Not what an affiliate balance is read from: 0122 gives every pair of
    /// units its own leaf, so the figure comes from summing the account —
    /// which is what a trial balance does, and is why this screen and the
    /// trial balance cannot disagree. See `interunit`. This column answers
    /// the other half of the question, which movements rather than how much.
    pub counter_site_id: Option<String>,
    /// Who the other side was, when the posting named one.
    ///
    /// `journal_line.party_type` + `party_id` (0300) are the sub-ledger dimension the payables
    /// ageing is projected over (0051), so it is the party on every bill and
    /// every payment line. Null on a sales entry, a depreciation charge or a
    /// hand-written correction, which have no party and must not pretend to.
    pub party_type: Option<String>,
    pub party_id: Option<String>,
    /// The supplier's name, looked up best-effort. Null when the line carries
    /// no party, and also when it names one no longer in the register — the id
    /// is the record and the name is the courtesy.
    pub supplier_name: Option<String>,
    pub memo: Option<String>,
    pub debit_minor: i64,
    pub credit_minor: i64,
    /// The balance after this line. Computed by a window function on every
    /// read, so it cannot disagree with the lines above it.
    ///
    /// **Over the whole window, not over the page and not over the search.**
    /// Two consecutive rows on a narrowed page will show a gap; the gap is the
    /// movements the narrowing hid.
    pub running_minor: i64,
    /// Whether a bank line has been agreed against this one.
    ///
    /// Only ever true for an account a statement was imported against — see
    /// `banking::confirm_match`. On every other account it is false and means
    /// "nothing has agreed with this", which for a sales entry is the ordinary
    /// state and not an exception.
    pub reconciled: bool,
}

/// One account's movements over a window, with the balance walking down it.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct GeneralLedger {
    pub account_code: String,
    pub account_name: String,
    pub site_id: Option<String>,
    pub from: NaiveDate,
    pub to: NaiveDate,
    /// What the account held the day before `from`. Without it the first
    /// running figure would be a movement pretending to be a balance.
    ///
    /// A property of the WINDOW. Unmoved by the search, by the filters and by
    /// where in the pages somebody is.
    pub opening_minor: i64,
    /// What it held at the end of `to`. The window's closing balance and not
    /// the last row's running figure, which on a narrowed or paged list is the
    /// balance after some arbitrary movement in the middle.
    pub closing_minor: i64,
    /// What moved in the window, in each direction. The two numbers a ledger
    /// is checked with, and the ones that must not move when somebody types.
    pub window_debit_minor: i64,
    pub window_credit_minor: i64,
    /// Every movement in the window, before the search. `total` is how many
    /// the search and the filters left; the difference between them is what is
    /// being hidden.
    pub window_rows: i64,
    pub rows: Vec<GeneralLedgerRow>,
    /// Opaque. Pass it back as `cursor` for the next page; absent means this
    /// was the last one.
    pub next_cursor: Option<String>,
    /// How many movements the search and the filters leave — the size of the
    /// list, not of the window. Compare with `window_rows`.
    pub total: i64,
    pub facets: GeneralLedgerFacets,
}

/// Where the previous page stopped — as a ROW, not as a position.
#[derive(Serialize, Deserialize)]
struct LedgerCursor {
    line_id: Uuid,
}

impl LedgerCursor {
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

/// One ledger movement, defined once — the WINDOW, before anybody narrows it.
///
/// Used by the page query, by the facet counts and by the window totals, and
/// that is the whole reason it is a constant: the three are only consistent if
/// they are the same rows.
///
/// Binds: `$1` the account number, `$2` the site or NULL, `$3` from, `$4`
/// the opening balance, `$5` to.
///
/// `ord` and `amount` are computed here rather than only in `ORDER BY` because
/// the keyset has to COMPARE the sort value in a `WHERE`, and a sort
/// expression that is not also a column is one a `WHERE` cannot see. `ord` is
/// the window's own sequence, assigned in the same order the running balance
/// was accumulated in — so sorting by it and paging through it walks the
/// ledger in the order the ledger means.
const LEDGER_WINDOW: &str = "
    SELECT l.line_id, e.entry_id, e.entry_number, e.posting_date, e.source_kind,
           e.source_id, l.site_id, l.counter_site_id, l.account_code,
           l.category_code, l.party_type, l.party_id,
           COALESCE(l.memo, e.memo) AS memo,
           l.debit_minor, l.credit_minor,
           (m.journal_line_id IS NOT NULL) AS reconciled,
           -- A line is one-sided — the table's own CHECK says so — so adding
           -- the two columns is the size of the movement rather than a sum of
           -- unlike things.
           (l.debit_minor + l.credit_minor) AS amount,
           ($4::bigint + SUM(l.debit_minor - l.credit_minor)
               OVER (ORDER BY e.posting_date, e.entry_number, l.line_number
                     ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW))::bigint AS running,
           ROW_NUMBER() OVER (ORDER BY e.posting_date, e.entry_number, l.line_number)
               AS ord
      FROM ledger_account selected
      JOIN ledger_account descendant
        ON descendant.lft >= selected.lft AND descendant.rgt <= selected.rgt
      JOIN journal_line l ON l.account_code = descendant.account_code
      JOIN journal_entry e USING (entry_id)
      LEFT JOIN bank_line_match m ON m.journal_line_id = l.line_id
     WHERE selected.account_code = $1
       AND ($2::text IS NULL OR l.site_id = $2)
       AND e.posting_date >= $3 AND e.posting_date <= $5
";

/// The search and the filters, applied to [`LEDGER_WINDOW`]'s output.
///
/// Binds on from `$6`: the search pattern or NULL, then the kinds or NULL, then
/// the categories or NULL.
/// Spelled once because the page and the counts must narrow identically.
const LEDGER_SEARCH: &str = "
    SELECT * FROM windowed
     WHERE ($6::text IS NULL
            OR entry_number ILIKE $6 OR memo ILIKE $6 OR source_id ILIKE $6)
";
const LEDGER_FILTERS: &str = "
    SELECT * FROM searched
     WHERE ($7::text[] IS NULL OR source_kind = ANY($7))
       AND ($8::text[] IS NULL OR category_code = ANY($8))
";

/// One account's movements over a window, with the balance walking down it.
///
/// The account's nested-set bounds select its whole subtree — so asking for a
/// heading gives all descendant movements even when account numbers do not
/// encode the hierarchy.
/// `counter_site_id` narrows it further, to the movements with one other unit.
/// It is the question an affiliate account exists to answer — head office's
/// `Piutang Affiliasi` is thirteen balances filed under one heading, and 0122
/// gives each pair its own leaf, so this reaches the same rows whether the
/// caller asks for the pair's leaf or for the heading and a counterparty.
pub async fn general_ledger(
    pool: &PgPool,
    account_code: &str,
    scope: GeneralLedgerScope,
) -> Result<GeneralLedger, AppError> {
    let name: String = sqlx::query("SELECT name FROM ledger_account WHERE account_code = $1")
        .bind(account_code)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("account {account_code}")))?
        .try_get("name")?;

    let site_id = scope.site_id.as_deref();
    let opening: i64 = sqlx::query(
        "SELECT COALESCE(SUM(l.debit_minor - l.credit_minor),0)::bigint AS opening
           FROM ledger_account selected
           JOIN ledger_account descendant
             ON descendant.lft >= selected.lft AND descendant.rgt <= selected.rgt
           JOIN journal_line l ON l.account_code = descendant.account_code
           JOIN journal_entry e USING (entry_id)
          WHERE selected.account_code = $1
            AND ($2::text IS NULL OR l.site_id = $2)
            AND e.posting_date < $3",
    )
    .bind(account_code)
    .bind(site_id)
    .bind(scope.from)
    // Three parameters, three binds. The query used to carry a fourth --
    // `AND ($4::text IS NULL OR l.counter_site_id = $4)`, a counterparty
    // narrowing nothing ever sent -- and the prepared statement demanded a
    // bind the caller never supplied, so every read of an account failed as
    // 08P01. The clause is gone with the parameter; if counterparty narrowing
    // is ever wanted, it arrives as a scope field and a bind together.
    .fetch_one(pool)
    .await?
    .try_get("opening")?;

    // A blank search is not a search. `Some("")` would compile to `ILIKE '%%'`,
    // which matches everything and costs a scan to say so.
    let needle = scope
        .needle
        .as_deref()
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(|text| format!("%{text}%"));
    let kinds = (!scope.kinds.is_empty()).then(|| scope.kinds.clone());
    let categories = (!scope.categories.is_empty()).then(|| scope.categories.clone());

    // The sort, and the tie-break that makes it total. Every order ends in the
    // line id, which is the primary key of `journal_line`.
    //
    // TWO spellings of the same thing, and they are not interchangeable:
    // `ORDER BY` takes directions, a ROW EXPRESSION does not.
    let (lead, descending): (&str, bool) = match scope.sort.as_deref() {
        Some("amount") => ("amount", scope.desc),
        Some("entry") => ("entry_number", scope.desc),
        // Cleared or not. The one sort that is really a question — "what has
        // the bank not confirmed yet" — and it belongs on the ledger rather
        // than only on the reconciliation screen, because this is where
        // somebody is when they ask it.
        Some("reconciliation") => ("reconciled", scope.desc),
        // The house order: the window's own sequence, which is the order the
        // running balance was accumulated in. Reversible, unlike most house
        // orders here — reading a ledger backwards from the closing balance is
        // an ordinary thing to want, and the running figure on each row still
        // means the balance after that movement.
        _ => ("ord", scope.desc),
    };
    let cols = format!("{lead}, line_id");
    let dir = if descending { "DESC" } else { "ASC" };
    let order = format!("{lead} {dir}, line_id {dir}");
    let seek = if descending { "<" } else { ">" };

    let cursor = scope
        .cursor
        .as_deref()
        .map(LedgerCursor::decode)
        .transpose()?;
    let limit = scope
        .limit
        .unwrap_or(DEFAULT_LEDGER_LIMIT)
        .clamp(1, MAX_LEDGER_LIMIT);

    // `NOT MATERIALIZED`: `kept` is referenced twice — as the page and
    // inside the seek — and two references makes PostgreSQL materialise a
    // CTE, which is an optimisation fence the `ORDER BY … LIMIT` cannot be
    // pushed through. Materialised, this reads the whole table and sorts it
    // to hand back one page; inlined, it seeks the index. See
    // `postgres::audit::list_audit`, where the difference was measured.
    // The two names are joined OUTSIDE the page, against the handful of rows
    // the limit left, rather than inside `LEDGER_WINDOW` — which the facet
    // counts and the window totals also read, and which would then pay for a
    // join per row of the whole month to label rows nobody is looking at.
    //
    // The supplier id is `text` on `journal_line` and a `uuid` on `supplier`
    // (0051 left it undeclared on purpose: a line's party is a dimension, not
    // a reference). The cast is on the supplier's side so a line carrying
    // something that is not a uuid comes back with no name instead of failing
    // the whole read.
    let sql = format!(
        "WITH windowed AS NOT MATERIALIZED ({LEDGER_WINDOW}),
              searched AS NOT MATERIALIZED ({LEDGER_SEARCH}),
              kept AS NOT MATERIALIZED ({LEDGER_FILTERS}),
              page AS NOT MATERIALIZED (
                SELECT * FROM kept
                 WHERE $9::uuid IS NULL
                    OR ({cols}) {seek} (SELECT {cols} FROM kept WHERE line_id = $9)
                 ORDER BY {order}
                 LIMIT $10
              )
         SELECT page.*, account.name AS account_name, party.name AS supplier_name,
                cat.name AS category_name
           FROM page
           LEFT JOIN ledger_account account ON account.account_code = page.account_code
           LEFT JOIN line_category cat ON cat.category_code = page.category_code
           LEFT JOIN supplier party ON party.supplier_id::text = page.party_id
                                     AND page.party_type = 'SUPPLIER'
          ORDER BY {order}"
    );
    let rows = sqlx::query(&sql)
        .bind(account_code)
        .bind(site_id)
        .bind(scope.from)
        .bind(opening)
        .bind(scope.to)
        .bind(&needle)
        .bind(&kinds)
        .bind(&categories)
        .bind(cursor.as_ref().map(|c| c.line_id))
        .bind(limit)
        .fetch_all(pool)
        .await?;

    let next_cursor = match rows.last() {
        Some(row) if rows.len() as i64 == limit => Some(
            LedgerCursor {
                line_id: row.try_get("line_id")?,
            }
            .encode()?,
        ),
        _ => None,
    };

    let mut out = Vec::with_capacity(rows.len());
    for row in &rows {
        out.push(GeneralLedgerRow {
            line_id: row.try_get("line_id")?,
            entry_id: row.try_get("entry_id")?,
            entry_number: row.try_get("entry_number")?,
            posting_date: row.try_get("posting_date")?,
            source_kind: row.try_get("source_kind")?,
            source_id: row.try_get("source_id")?,
            account_code: row.try_get("account_code")?,
            // The chart is the authority on an account's name, but a line can
            // outlive the row that named it — an account retired after it was
            // posted to still has its history. The code is the record.
            account_name: row
                .try_get::<Option<String>, _>("account_name")?
                .unwrap_or_default(),
            category_code: row.try_get("category_code")?,
            category_name: row.try_get("category_name")?,
            site_id: row.try_get("site_id")?,
            counter_site_id: row.try_get("counter_site_id")?,
            party_type: row.try_get("party_type")?,
            party_id: row.try_get("party_id")?,
            supplier_name: row.try_get("supplier_name")?,
            memo: row.try_get("memo")?,
            debit_minor: row.try_get("debit_minor")?,
            credit_minor: row.try_get("credit_minor")?,
            running_minor: row.try_get("running")?,
            reconciled: row.try_get("reconciled")?,
        });
    }

    let summary = ledger_summary(
        pool,
        account_code,
        &scope,
        opening,
        needle.as_deref(),
        kinds.as_deref(),
        categories.as_deref(),
    )
    .await?;

    Ok(GeneralLedger {
        account_code: account_code.to_string(),
        account_name: name,
        site_id: scope.site_id.clone(),
        from: scope.from,
        to: scope.to,
        opening_minor: opening,
        // The window's closing balance, summed over the window rather than
        // read off the last row — which on a searched or paged list is the
        // balance after some arbitrary movement in the middle of the month.
        closing_minor: opening + summary.window_debit - summary.window_credit,
        window_debit_minor: summary.window_debit,
        window_credit_minor: summary.window_credit,
        window_rows: summary.window_rows,
        rows: out,
        next_cursor,
        total: summary.total,
        facets: summary.facets,
    })
}

/// Everything about the ledger that is not a row of it.
struct LedgerSummary {
    window_rows: i64,
    window_debit: i64,
    window_credit: i64,
    total: i64,
    facets: GeneralLedgerFacets,
}

/// The window's totals, the narrowed count, and the facets — in one round
/// trip, off the same window definition the page is drawn from.
///
/// The three scopes here are the whole point of this endpoint:
///
///   the window totals read the WINDOW, before search and before filters. They
///     are what a trial balance is checked against and they do not move.
///   per-value counts also read the WINDOW, so "Payments 12" means "twelve
///     payments moved this account this month".
///   `total` reads the FILTERED set, because it describes the list on screen.
#[allow(clippy::too_many_arguments)]
async fn ledger_summary(
    pool: &PgPool,
    account_code: &str,
    scope: &GeneralLedgerScope,
    opening: i64,
    needle: Option<&str>,
    kinds: Option<&[String]>,
    categories: Option<&[String]>,
) -> Result<LedgerSummary, AppError> {
    let sql = format!(
        "WITH windowed AS ({LEDGER_WINDOW}),
              searched AS ({LEDGER_SEARCH}),
              kept AS ({LEDGER_FILTERS})
         SELECT 'kind' AS kind, source_kind AS value, NULL::text AS label,
                COUNT(*)::bigint AS n, 0::bigint AS debit, 0::bigint AS credit
           FROM windowed GROUP BY source_kind
          UNION ALL
         SELECT 'site', w.site_id,
                (SELECT p.name FROM site p WHERE p.id = w.site_id),
                COUNT(*)::bigint, 0::bigint, 0::bigint
           FROM windowed w GROUP BY w.site_id
          UNION ALL
         -- `IS NOT NULL` and not a COALESCE to a placeholder: a facet value has
         -- to be a value the filter can be given back, and no category means
         -- the absence of one.
         SELECT 'category', w.category_code,
                (SELECT c.name FROM line_category c WHERE c.category_code = w.category_code),
                COUNT(*)::bigint, 0::bigint, 0::bigint
           FROM windowed w WHERE w.category_code IS NOT NULL GROUP BY w.category_code
          UNION ALL
         SELECT 'window', '', NULL::text, COUNT(*)::bigint,
                COALESCE(SUM(debit_minor), 0)::bigint,
                COALESCE(SUM(credit_minor), 0)::bigint
           FROM windowed
          UNION ALL
         SELECT 'kept', '', NULL::text, COUNT(*)::bigint, 0::bigint, 0::bigint
           FROM kept"
    );
    let rows = sqlx::query(&sql)
        .bind(account_code)
        .bind(scope.site_id.as_deref())
        .bind(scope.from)
        .bind(opening)
        .bind(scope.to)
        .bind(needle)
        .bind(kinds)
        .bind(categories)
        .fetch_all(pool)
        .await?;

    let mut summary = LedgerSummary {
        window_rows: 0,
        window_debit: 0,
        window_credit: 0,
        total: 0,
        facets: GeneralLedgerFacets {
            kinds: Vec::new(),
            categories: Vec::new(),
            sites: Vec::new(),
        },
    };
    for row in &rows {
        let kind: String = row.try_get("kind")?;
        let value: String = row.try_get("value")?;
        let label: Option<String> = row.try_get("label")?;
        let n: i64 = row.try_get("n")?;
        match kind.as_str() {
            "kind" => summary.facets.kinds.push(GeneralLedgerFacet {
                value,
                label,
                count: n,
            }),
            "category" => summary.facets.categories.push(GeneralLedgerFacet {
                value,
                label,
                count: n,
            }),
            "site" => summary.facets.sites.push(GeneralLedgerFacet {
                value,
                label,
                count: n,
            }),
            "window" => {
                summary.window_rows = n;
                summary.window_debit = row.try_get("debit")?;
                summary.window_credit = row.try_get("credit")?;
            }
            _ => summary.total = n,
        }
    }
    for list in [
        &mut summary.facets.kinds,
        &mut summary.facets.categories,
        &mut summary.facets.sites,
    ] {
        list.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.value.cmp(&b.value)));
    }
    Ok(summary)
}
