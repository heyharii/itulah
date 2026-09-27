//! A shop asking head office to pay something, and what happened to the ask.
//!
//! # The one property this module must never grow
//!
//! **It does not post.** There is no `post` in this file, no `PostingIntent`,
//! no `use super::poster`, and that is the whole design rather than an omission.
//! ERPNext is explicit that creating a Payment Request writes no GL entry — the
//! accounting happens only when a Payment Entry is made from it — and copying
//! that is what makes this document safe to add: an instruction is a lifecycle
//! with no accounting consequence, so it needs no posting rule, no period
//! check and no account map entry. The bill and the payment it becomes have
//! all three already.
//!
//! `settle` is the place that will look like an exception and is not. It binds
//! the bill and the payment that answered the ask; the payment was posted by
//! `payments::post_payment`, through the one door, before this ever sees it.
//!
//! # Where ours parts company with ERPNext
//!
//! Theirs starts at an invoice, ours starts at a shop, and every difference
//! falls out of that. Their `party` is a master row chosen before the document
//! can be saved; ours is free text, because a shop has a bill in its hand and
//! no view of the vendor book. So resolving the payee into a vendor is a step
//! in ACCEPTING the instruction — `decide` takes the supplier, and 0240's CHECK
//! refuses APPROVED without one — rather than a precondition of raising it.
//!
//! Their `reference_doctype` is mandatory and is the spine of the document;
//! ours is optional, and its absence is what makes head office key the bill as
//! part of saying yes.
//!
//! # The ladder, and the rung that is missing
//!
//! DRAFT → REQUESTED → APPROVED → PAID, with REFUSED off REQUESTED and
//! WITHDRAWN off either of the first two.
//!
//! The screen drew a seventh state, "In a payment run" — ERPNext's Payment
//! Order, one person selecting a batch and another releasing it at the bank.
//! It is not here, because the batch is a second document and until it exists
//! the state would be a click rather than a fact. 0240 says the same thing in
//! its CHECK.

use super::{
    decode_cursor, encode_cursor,
    payables::{PayableFacet, RecordBillLine, RecordBillRequest},
};
use crate::cloud::application::AppError;
use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Row};
use uuid::Uuid;


/// One ask, and everything that has happened to it.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PaymentInstruction {
    pub instruction_id: Uuid,
    pub instruction_number: String,
    /// Which place is asking. The unit is a dimension here as it is on every
    /// ledger row, and it is never part of an account code.
    ///
    /// Carried as an id and never as a name: the name of a unit comes from
    /// `unit` through `book_locations`, which is the one place that knows
    /// head office is not spelled "DC".
    pub site_id: String,
    /// Free text. The landlord, PLN, the man who fixed the roller shutter.
    pub payee: String,
    /// The payee resolved into a vendor, once head office has done it. Null
    /// while the ask is still an ask; never null once it is approved.
    pub supplier_id: Option<String>,
    pub supplier_name: Option<String>,
    /// A sentence somebody at head office can decide on without ringing back.
    pub purpose: String,
    /// An expense category open to shops (0465). Resolves to no account here:
    /// the bill head office settles the ask with carries the account.
    pub category: String,
    pub amount_minor: i64,
    pub currency: String,
    pub needed_by: Option<NaiveDate>,
    pub status: String,
    /// An unanswered ask past the day it was needed.
    ///
    /// Derived on read, never stored: an ask that was late yesterday is later
    /// today, and a stored flag would be wrong by morning. It is deliberately
    /// false for anything head office has already answered — a refusal made
    /// after the due date is not an outstanding late ask, it is a closed one.
    pub late: bool,
    /// The bill it names, or the bill head office keyed for it. Usually absent
    /// until somebody says yes.
    pub bill_id: Option<Uuid>,
    pub bill_number: Option<String>,
    /// What it became. The reason PAID is a fact rather than a click.
    pub payment_id: Option<Uuid>,
    pub payment_number: Option<String>,
    pub raised_by: String,
    pub raised_at: DateTime<Utc>,
    pub submitted_at: Option<DateTime<Utc>>,
    pub decided_by: Option<String>,
    pub decided_at: Option<DateTime<Utc>>,
    /// Required on a refusal, optional on an approval. Empty rather than null,
    /// because "no reason given" and "not decided yet" are already told apart
    /// by `decided_at`.
    pub decision_reason: String,
    pub settled_by: Option<String>,
    pub settled_at: Option<DateTime<Utc>>,
    pub note: String,
}

/// Raise one. Everything here is the shop's, and nothing here is head
/// office's — see `DecideInstruction`.
#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct RaiseInstructionRequest {
    pub site_id: String,
    pub payee: String,
    pub purpose: String,
    pub category: String,
    pub amount_minor: i64,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub needed_by: Option<NaiveDate>,
    /// A bill, when one already exists. Usually absent.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub bill_id: Option<Uuid>,
    #[serde(default)]
    pub note: String,
    /// Send it in the same act that writes it.
    ///
    /// A draft is worth having — a shop gathering three quotations writes one
    /// and leaves it — but most asks are typed and sent, and making that two
    /// round trips is how a queue ends up full of drafts nobody meant to keep.
    #[serde(default)]
    pub submit: bool,
}

/// Head office's answer.
#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct DecideInstructionRequest {
    /// True approves, false refuses. A tri-state would let a third answer
    /// exist that the ladder has no rung for.
    pub approve: bool,
    /// Required on a refusal, optional on an approval: a no the shop cannot
    /// read is a no they will ask about twice.
    #[serde(default)]
    pub reason: String,
    /// The vendor the payee turned out to be — an existing supplier row, or one
    /// created with `category = 'EXPENSE'` before this is called (0212).
    /// Required to approve, and refused on a refusal: resolving a payee for an
    /// ask nobody is going to pay is work for nothing.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub supplier_id: Option<String>,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub supplier_name: Option<String>,
}

/// What the ask became.
#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SettleInstructionRequest {
    /// The payment that answered it. Must be POSTED: an instruction settled by
    /// a draft payment would say money had moved on the strength of a document
    /// that is not in the books.
    pub payment_id: Uuid,
    /// The bill head office keyed for it, when the instruction did not already
    /// name one.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub bill_id: Option<Uuid>,
}

/// The one filter panel worth counting: which rung each ask is on.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct InstructionFacets {
    pub statuses: Vec<PayableFacet>,
}

/// A page of instructions, and what the whole matched set comes to.
///
/// The envelope `GET /finance/bills` and `GET /finance/payments` answer in —
/// same `rows`, same `next_cursor`, same `total`, same facet counts — so one
/// hook in the browser draws all three lists.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct InstructionPage {
    pub rows: Vec<PaymentInstruction>,
    /// Opaque. Pass it back as `cursor`; absent means this was the last page,
    /// and it is always absent when the caller sent no `limit`.
    pub next_cursor: Option<String>,
    /// Every instruction the search and filters match, not just this page.
    pub total: i64,
    /// What those instructions come to, added HERE — only the server has every
    /// row, and a total that grows while somebody scrolls is worse than none.
    pub total_minor: i64,
    /// What is still waiting on head office: DRAFT and REQUESTED. The figure
    /// somebody looking at the queue actually came for, and not derivable from
    /// `total_minor`, which counts refusals and withdrawals too.
    pub open_minor: i64,
    pub facets: InstructionFacets,
}

/// What a caller is asking the instruction list for.
#[derive(Clone, Debug, Default)]
pub struct InstructionScope {
    /// Free text, tried against the number, the payee and what it is for —
    /// the three things somebody has in front of them when they go looking.
    pub needle: Option<String>,
    /// Statuses to keep. Empty means every status, because an empty filter and
    /// no filter are the same request.
    ///
    /// Unknown values are passed through rather than dropped: the vocabulary
    /// lives in 0240's CHECK, and a second copy here is the thing that goes
    /// stale. A status nobody uses matches nothing.
    pub statuses: Vec<String>,
    pub sites: Vec<String>,
    /// `needed`, `raised`, `amount`. Anything else — including nothing — is
    /// the house order: what is needed soonest, first.
    pub sort: Option<String>,
    pub desc: bool,
    pub cursor: Option<String>,
    /// Absent asks for everything, unpaged.
    pub limit: Option<i64>,
}

/// Where the previous page stopped — as a ROW, not as a position.
///
/// It carries the instruction's own id and nothing else, whatever the list is
/// sorted by; the seek re-reads that row's sort value in SQL. See
/// `payables::BillCursor`, which makes the argument at length.
#[derive(Serialize, Deserialize)]
struct InstructionCursor {
    instruction_id: Uuid,
}

const INSTRUCTION_COLUMNS: &str = "pi.instruction_id, pi.instruction_number, pi.site_id,
     pi.payee, pi.supplier_id, pi.supplier_name, pi.purpose, pi.category,
     pi.amount_minor, pi.currency, pi.needed_by, pi.status, pi.bill_id, pi.payment_id,
     pi.raised_by, pi.raised_at, pi.submitted_at, pi.decided_by, pi.decided_at,
     pi.decision_reason, pi.settled_by, pi.settled_at, pi.note,
     b.invoice_number AS bill_number,
     p.payment_number,
     -- Late is a question about TODAY and about an ask nobody has answered.
     -- An instruction refused in August with a July due date is not late; it
     -- is finished.
     (pi.status IN ('DRAFT', 'REQUESTED')
      AND pi.needed_by IS NOT NULL
      AND pi.needed_by < CURRENT_DATE) AS late";

const INSTRUCTION_FROM: &str = "FROM payment_instruction pi
     LEFT JOIN supplier_invoice b ON b.invoice_id = pi.bill_id
     LEFT JOIN supplier_payment p ON p.payment_id = pi.payment_id";

fn to_instruction(row: &sqlx::postgres::PgRow) -> Result<PaymentInstruction, AppError> {
    Ok(PaymentInstruction {
        instruction_id: row.try_get("instruction_id")?,
        instruction_number: row.try_get("instruction_number")?,
        site_id: row.try_get("site_id")?,
        payee: row.try_get("payee")?,
        supplier_id: row.try_get("supplier_id")?,
        supplier_name: row.try_get("supplier_name")?,
        purpose: row.try_get("purpose")?,
        category: row.try_get("category")?,
        amount_minor: row.try_get("amount_minor")?,
        currency: row.try_get("currency")?,
        needed_by: row.try_get("needed_by")?,
        status: row.try_get("status")?,
        late: row.try_get("late")?,
        bill_id: row.try_get("bill_id")?,
        bill_number: row.try_get("bill_number")?,
        payment_id: row.try_get("payment_id")?,
        payment_number: row.try_get("payment_number")?,
        raised_by: row.try_get("raised_by")?,
        raised_at: row.try_get("raised_at")?,
        submitted_at: row.try_get("submitted_at")?,
        decided_by: row.try_get("decided_by")?,
        decided_at: row.try_get("decided_at")?,
        decision_reason: row.try_get("decision_reason")?,
        settled_by: row.try_get("settled_by")?,
        settled_at: row.try_get("settled_at")?,
        note: row.try_get("note")?,
    })
}

/// One instruction row, defined once — the page query and the facet query both
/// read it, so the counts beside the filters count exactly what the page can
/// show.
///
/// Binds: `$1` the search pattern, or NULL for no search. It stops at the
/// SEARCH; status and site are applied outside it.
fn instruction_rows() -> String {
    format!(
        "SELECT {INSTRUCTION_COLUMNS} {INSTRUCTION_FROM}
          WHERE ($1::text IS NULL
                 OR pi.instruction_number ILIKE $1
                 OR pi.payee ILIKE $1
                 OR pi.purpose ILIKE $1)"
    )
}

const INSTRUCTION_FILTERS: &str = "
    ($2::text[] IS NULL OR status = ANY($2))
    AND ($3::text[] IS NULL OR site_id = ANY($3))
";

/// The instruction queue: a page of it, how many there are, and what they come
/// to.
pub async fn instruction_page(
    pool: &PgPool,
    scope: InstructionScope,
) -> Result<InstructionPage, AppError> {
    // A blank search is not a search: `Some("")` compiles to `ILIKE '%%'`,
    // which matches everything and costs a scan to say so.
    let needle = scope
        .needle
        .as_deref()
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(|text| format!("%{text}%"));
    let statuses = (!scope.statuses.is_empty()).then(|| scope.statuses.clone());
    let sites = (!scope.sites.is_empty()).then(|| scope.sites.clone());

    // Every order ends in `instruction_id`, so no two rows compare equal and
    // the keyset can neither repeat nor lose a row that ties.
    let (lead, descending): (&str, bool) = match scope.sort.as_deref() {
        Some("raised") => ("raised_at", scope.desc),
        Some("amount") => ("amount_minor", scope.desc),
        // The house order: what is needed soonest, first, with asks that named
        // no date behind the ones that did. `dir` is not read for it — an ask
        // queue read backwards is a list of things that can wait.
        _ => ("needed_by", false),
    };
    let cols = format!("{lead}, instruction_id");
    let dir = if descending { "DESC" } else { "ASC" };
    // NULLS LAST in both directions, deliberately. Postgres defaults nulls
    // first on DESC, which would put every ask that named no date at the head
    // of a queue sorted by urgency — the opposite of what the column means.
    let order = format!("{lead} {dir} NULLS LAST, instruction_id {dir}");
    let seek = if descending { "<" } else { ">" };

    let cursor: Option<InstructionCursor> =
        scope.cursor.as_deref().map(decode_cursor).transpose()?;
    let limit = scope.limit.map(|value| value.clamp(1, 200));

    let rows_sql = instruction_rows();
    // `NOT MATERIALIZED`: `kept` is referenced twice — as the page and inside
    // the seek — and two references makes PostgreSQL materialise a CTE, which
    // is an optimisation fence the `ORDER BY … LIMIT` cannot be pushed
    // through. See `postgres::audit::list_audit`, where it was measured.
    let sql = format!(
        "WITH searched AS NOT MATERIALIZED ({rows_sql}),
              kept AS NOT MATERIALIZED (
             SELECT * FROM searched WHERE {INSTRUCTION_FILTERS}
         )
         SELECT * FROM kept
          WHERE $4::uuid IS NULL
             OR ({cols}) {seek} (SELECT {cols} FROM kept WHERE instruction_id = $4)
          ORDER BY {order}
          LIMIT $5"
    );
    let rows = sqlx::query(&sql)
        .bind(&needle)
        .bind(&statuses)
        .bind(&sites)
        .bind(cursor.as_ref().map(|c| c.instruction_id))
        .bind(limit)
        .fetch_all(pool)
        .await?;

    let next_cursor = match limit {
        None => None,
        Some(limit) if (rows.len() as i64) < limit => None,
        Some(_) => match rows.last() {
            Some(row) => Some(encode_cursor(&InstructionCursor {
                instruction_id: row.try_get("instruction_id")?,
            })?),
            None => None,
        },
    };

    let instructions: Vec<PaymentInstruction> = rows
        .iter()
        .map(to_instruction)
        .collect::<Result<_, AppError>>()?;

    let (total, total_minor, open_minor, facets) =
        instruction_facets(pool, needle.as_deref(), &statuses, &sites).await?;
    Ok(InstructionPage {
        rows: instructions,
        next_cursor,
        total,
        total_minor,
        open_minor,
        facets,
    })
}

/// How many asks there are, what they come to, and how they split.
///
/// Two scopes, deliberately: the per-value counts read the SEARCHED set so that
/// "REQUESTED 14" means "there are 14 waiting" rather than "14 of the ones you
/// already narrowed to REQUESTED", while the totals read the FILTERED set
/// because they describe the list on screen.
async fn instruction_facets(
    pool: &PgPool,
    needle: Option<&str>,
    statuses: &Option<Vec<String>>,
    sites: &Option<Vec<String>>,
) -> Result<(i64, i64, i64, InstructionFacets), AppError> {
    let rows_sql = instruction_rows();
    let sql = format!(
        "WITH searched AS ({rows_sql}), kept AS (
             SELECT * FROM searched WHERE {INSTRUCTION_FILTERS}
         )
         SELECT 'status' AS kind, status AS value, COUNT(*)::bigint AS n
           FROM searched GROUP BY status
          UNION ALL
         SELECT 'all', '', COUNT(*)::bigint FROM kept
          UNION ALL
         SELECT 'sum', '', COALESCE(SUM(amount_minor), 0)::bigint FROM kept
          UNION ALL
         SELECT 'open', '', COALESCE(SUM(amount_minor), 0)::bigint
           FROM kept WHERE status IN ('DRAFT', 'REQUESTED')"
    );
    let rows = sqlx::query(&sql)
        .bind(needle)
        .bind(statuses)
        .bind(sites)
        .fetch_all(pool)
        .await?;

    let mut total = 0i64;
    let mut total_minor = 0i64;
    let mut open_minor = 0i64;
    let mut status_facets = Vec::new();
    for row in &rows {
        let kind: String = row.try_get("kind")?;
        let value: String = row.try_get("value")?;
        let n: i64 = row.try_get("n")?;
        match kind.as_str() {
            "status" => status_facets.push(PayableFacet {
                value,
                label: None,
                count: n,
            }),
            "sum" => total_minor = n,
            "open" => open_minor = n,
            _ => total = n,
        }
    }
    // Biggest first, ties on the name so the panel does not reshuffle between
    // calls under somebody's cursor.
    status_facets.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.value.cmp(&b.value)));
    Ok((
        total,
        total_minor,
        open_minor,
        InstructionFacets {
            statuses: status_facets,
        },
    ))
}

pub async fn instruction(
    pool: &PgPool,
    instruction_id: Uuid,
) -> Result<PaymentInstruction, AppError> {
    let sql =
        format!("SELECT {INSTRUCTION_COLUMNS} {INSTRUCTION_FROM} WHERE pi.instruction_id = $1");
    let row = sqlx::query(&sql)
        .bind(instruction_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound("payment instruction".into()))?;
    to_instruction(&row)
}

/// Raise one.
///
/// Every refusal below is also enforced by 0240's CHECKs and foreign keys —
/// those are the guarantee, these are the explanations, checked first so the
/// sentence names the field somebody just typed rather than arriving at COMMIT
/// naming a constraint.
pub async fn raise_instruction(
    pool: &PgPool,
    request: &RaiseInstructionRequest,
    actor: &str,
) -> Result<PaymentInstruction, AppError> {
    if request.payee.trim().is_empty() {
        return Err(AppError::Validation(
            "say who is to be paid; free text is fine, and the warung on the corner will never \
             be a supplier record"
                .into(),
        ));
    }
    if request.purpose.trim().is_empty() {
        return Err(AppError::Validation(
            "say what the money is for, in a sentence somebody at head office can decide on \
             without ringing back"
                .into(),
        ));
    }
    if request.amount_minor <= 0 {
        return Err(AppError::Validation(
            "an instruction asks for a positive amount; a credit is not an ask".into(),
        ));
    }
    let category = request.category.trim().to_string();
    let open_to_stores: Vec<String> = sqlx::query_scalar(
        "SELECT code FROM expense_category WHERE is_active AND for_stores ORDER BY code",
    )
    .fetch_all(pool)
    .await?;
    if !open_to_stores.contains(&category) {
        return Err(AppError::Validation(format!(
            "'{category}' is not a kind of cost this shop can file against; it is one of {}",
            open_to_stores.join(", ")
        )));
    }
    // The bill has to belong to the unit that is asking. A shop asking head
    // office to settle another shop's bill is either a mistake or an
    // inter-unit movement, and the second is a document nothing writes yet.
    if let Some(bill_id) = request.bill_id {
        let site: Option<String> =
            sqlx::query_scalar("SELECT site_id FROM supplier_invoice WHERE invoice_id = $1")
                .bind(bill_id)
                .fetch_optional(pool)
                .await?;
        match site {
            None => return Err(AppError::NotFound("supplier bill".into())),
            Some(site) if site != request.site_id.trim() => {
                return Err(AppError::Validation(format!(
                    "that bill is at {site} and the ask is from {}; raise the instruction at the \
                     unit the bill belongs to",
                    request.site_id.trim()
                )))
            }
            Some(_) => {}
        }
    }

    let instruction_id = Uuid::new_v4();
    let mut tx = pool.begin().await?;
    let number: i64 = sqlx::query("SELECT nextval('payment_instruction_number_seq') AS n")
        .fetch_one(&mut *tx)
        .await?
        .try_get("n")?;

    sqlx::query(
        "INSERT INTO payment_instruction
           (instruction_id, instruction_number, site_id, payee, purpose, category,
            amount_minor, needed_by, bill_id, note, status, raised_by, submitted_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
                 CASE WHEN $11 THEN 'REQUESTED' ELSE 'DRAFT' END,
                 $12,
                 CASE WHEN $11 THEN now() ELSE NULL END)",
    )
    .bind(instruction_id)
    .bind(format!("PI-{number:08}"))
    .bind(request.site_id.trim())
    .bind(request.payee.trim())
    .bind(request.purpose.trim())
    .bind(&category)
    .bind(request.amount_minor)
    .bind(request.needed_by)
    .bind(request.bill_id)
    .bind(request.note.trim())
    .bind(request.submit)
    .bind(actor)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;

    instruction(pool, instruction_id).await
}

/// Send a draft. The ask becomes head office's to answer.
pub async fn submit_instruction(
    pool: &PgPool,
    instruction_id: Uuid,
) -> Result<PaymentInstruction, AppError> {
    let existing = instruction(pool, instruction_id).await?;
    if existing.status != "DRAFT" {
        return Err(AppError::Conflict(format!(
            "instruction {} is {}, not a draft waiting to be sent",
            existing.instruction_number,
            existing.status.to_lowercase()
        )));
    }
    // Only from DRAFT, in the statement itself: two people pressing at once
    // means one transition, not two.
    let updated = sqlx::query(
        "UPDATE payment_instruction
            SET status = 'REQUESTED', submitted_at = now()
          WHERE instruction_id = $1 AND status = 'DRAFT'",
    )
    .bind(instruction_id)
    .execute(pool)
    .await?;
    if updated.rows_affected() == 0 {
        return Err(AppError::Conflict(
            "this instruction has already been sent".into(),
        ));
    }
    instruction(pool, instruction_id).await
}

/// Head office's answer: yes with a vendor, or no with a reason.
///
/// Resolving the payee into a supplier happens HERE and not at the counter.
/// That is the one structural difference from ERPNext's Payment Request worth
/// restating: their party is a master row chosen before the document can be
/// saved, ours is free text until somebody with a view of the vendor book says
/// which vendor it was. 0240's CHECK refuses APPROVED without one, so this
/// cannot be skipped and then tidied up later.
pub async fn decide_instruction(
    pool: &PgPool,
    instruction_id: Uuid,
    request: &DecideInstructionRequest,
    actor: &str,
) -> Result<PaymentInstruction, AppError> {
    let existing = instruction(pool, instruction_id).await?;
    if existing.status != "REQUESTED" {
        return Err(AppError::Conflict(format!(
            "instruction {} is {}; only an ask that has been sent can be answered",
            existing.instruction_number,
            existing.status.to_lowercase()
        )));
    }

    let reason = request.reason.trim();
    if !request.approve && reason.is_empty() {
        return Err(AppError::Validation(
            "say why it is refused: a no the shop cannot read is a no they will ask about twice"
                .into(),
        ));
    }

    let supplier_id = request
        .supplier_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if request.approve && supplier_id.is_none() {
        return Err(AppError::Validation(
            "approving an instruction means saying which vendor the payee is: match it to a \
             supplier, or create one with category EXPENSE first. Until it is a vendor the ask \
             cannot become a payable anybody can age."
                .into(),
        ));
    }
    if !request.approve && supplier_id.is_some() {
        return Err(AppError::Validation(
            "a refusal carries no vendor; resolving a payee for an ask nobody is going to pay is \
             work for nothing"
                .into(),
        ));
    }

    if !request.approve {
        // A refusal creates NOTHING (brief §13): the status moves and no bill
        // exists, which is the whole point of telling the shop "no".
        let updated = sqlx::query(
            "UPDATE payment_instruction
                SET status = 'REFUSED',
                    supplier_id = COALESCE($2, supplier_id),
                    supplier_name = COALESCE($3, supplier_name),
                    decided_by = $4,
                    decided_at = now(),
                    decision_reason = $5
              WHERE instruction_id = $1 AND status = 'REQUESTED'",
        )
        .bind(instruction_id)
        .bind(supplier_id)
        .bind(
            request
                .supplier_name
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty()),
        )
        .bind(actor)
        .bind(reason)
        .execute(pool)
        .await?;
        if updated.rows_affected() == 0 {
            return Err(AppError::Conflict(
                "this instruction has already been answered".into(),
            ));
        }
        return instruction(pool, instruction_id).await;
    }

    // ── APPROVED: say yes, and raise the draft in the same write ──
    //
    // Brief §8.4: a yes makes a DRAFT bill that points at the request (and at
    // the repair the request's bill named, when there was one). The bill is
    // NOT AP — it is a DRAFT for Finance to review, exactly as a bill GA filed
    // is. The two writes share one transaction, so an APPROVED ask and its
    // draft cannot come apart.
    let supplier = supplier_id.expect("an approval without a supplier was refused above");

    // Refuse when the vendor has nowhere to send money. A draft nobody could
    // ever pay is not worth raising, and the shop's ask is better answered with
    // "add a bank account first" than with a bill that will sit forever.
    let has_account: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM bank_account
                         WHERE NOT is_company_account
                           AND party_type = 'SUPPLIER'
                           AND party_id = $1
                           AND active)",
    )
    .bind(supplier)
    .fetch_one(pool)
    .await?;
    if !has_account {
        return Err(AppError::Validation(format!(
            "{supplier} has no bank account on file, so there is nowhere to pay this; add and \
             verify one on the vendor first, then approve"
        )));
    }

    // The repair the ask came from, if its own bill named one.
    let repair_id: Option<Uuid> = match existing.bill_id {
        Some(bill_id) => sqlx::query_scalar(
            "SELECT repair_id FROM supplier_invoice_expense_line
              WHERE invoice_id = $1 AND repair_id IS NOT NULL
              LIMIT 1",
        )
        .bind(bill_id)
        .fetch_optional(pool)
        .await?,
        None => None,
    };

    let suggestion = super::ga_accounts::suggest_account(
        pool,
        &existing.site_id,
        &super::ga_accounts::LineRefs {
            repair_id,
            supplier_id: Some(supplier.to_string()),
            ..Default::default()
        },
    )
    .await?;
    let Some(account_code) = suggestion.account_code else {
        return Err(AppError::Validation(format!(
            "the bill this approval would raise has no account: {}",
            suggestion
                .missing
                .unwrap_or_else(|| "Finance has not mapped one".into())
        )));
    };

    let invoice_date = Utc::now().date_naive();
    let draft = RecordBillRequest {
        // The instruction's own number, which is unique — the draft is
        // findable by the ask down the phone, and the real invoice number is
        // keyed when the paper arrives.
        invoice_number: existing.instruction_number.clone(),
        supplier_id: supplier.to_string(),
        supplier_name: request
            .supplier_name
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .or_else(|| existing.supplier_name.clone()),
        site_id: existing.site_id.clone(),
        invoice_date,
        // A bill may not fall due before it is dated. The ask's own
        // `needed_by` is the plan; when it is already past, the draft falls
        // due the day it was raised rather than carrying an impossible date.
        due_date: existing.needed_by.map(|due| due.max(invoice_date)),
        subtotal_minor: existing.amount_minor,
        tax_minor: 0,
        discount_minor: 0,
        note: Some(format!(
            "Draft dibuat dari pengajuan pembayaran {}: {}",
            existing.instruction_number, existing.purpose
        )),
        kind: Some("EXPENSE".into()),
        lines: Some(vec![RecordBillLine {
            account_code,
            site_id: existing.site_id.clone(),
            amount_minor: existing.amount_minor,
            category_code: None,
            asset_class_code: None,
            draws_reserve: false,
            asset_id: None,
            contract_id: None,
            repair_id,
            replacement_id: None,
            supply_request_id: None,
            service_period_start: None,
            service_period_end: None,
            account_overridden: false,
            memo: None,
        }]),
        matching: None,
        withholding_code: None,
        receipt_ids: None,
        submitted_by_domain: Some("PAYMENT_REQUEST".into()),
        document_ref: None,
    };
    let validated = super::payables::validate_bill(pool, &draft).await?;

    let mut tx = pool.begin().await?;
    let invoice_id = super::payables::insert_bill(
        &mut tx,
        &draft,
        actor,
        &validated.kind,
        validated.total,
        validated.withholding_code.as_deref(),
    )
    .await?;
    let updated = sqlx::query(
        "UPDATE payment_instruction
            SET status = 'APPROVED',
                supplier_id = COALESCE($2, supplier_id),
                supplier_name = COALESCE($3, supplier_name),
                decided_by = $4,
                decided_at = now(),
                decision_reason = $5,
                bill_id = $6
          WHERE instruction_id = $1 AND status = 'REQUESTED'",
    )
    .bind(instruction_id)
    .bind(supplier)
    .bind(
        request
            .supplier_name
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty()),
    )
    .bind(actor)
    .bind(reason)
    .bind(invoice_id)
    .execute(&mut *tx)
    .await?;
    if updated.rows_affected() == 0 {
        // The `tx` drops here, taking the draft with it: an ask somebody else
        // already answered raises no second bill.
        return Err(AppError::Conflict(
            "this instruction has already been answered".into(),
        ));
    }
    tx.commit().await?;
    instruction(pool, instruction_id).await
}

/// The shop takes its own ask back.
///
/// Its own act and not a refusal: the supplier was paid another way, or the
/// need went away, and neither of those is a decision head office made. One
/// status could not tell the two apart afterwards.
pub async fn withdraw_instruction(
    pool: &PgPool,
    instruction_id: Uuid,
) -> Result<PaymentInstruction, AppError> {
    let existing = instruction(pool, instruction_id).await?;
    if existing.status != "DRAFT" && existing.status != "REQUESTED" {
        return Err(AppError::Conflict(format!(
            "instruction {} is {}; an ask can only be taken back before anybody acts on it",
            existing.instruction_number,
            existing.status.to_lowercase()
        )));
    }
    let updated = sqlx::query(
        "UPDATE payment_instruction SET status = 'WITHDRAWN'
          WHERE instruction_id = $1 AND status IN ('DRAFT', 'REQUESTED')",
    )
    .bind(instruction_id)
    .execute(pool)
    .await?;
    if updated.rows_affected() == 0 {
        return Err(AppError::Conflict(
            "this instruction has already moved on".into(),
        ));
    }
    instruction(pool, instruction_id).await
}

/// Bind the bill and the payment the ask became.
///
/// **This posts nothing.** The payment named here was posted by
/// `payments::post_payment`, through the one door, before this was called —
/// which is exactly why PAID is a fact about money rather than a state
/// somebody clicked into. All this does is record which payment it was.
pub async fn settle_instruction(
    pool: &PgPool,
    instruction_id: Uuid,
    request: &SettleInstructionRequest,
    actor: &str,
) -> Result<PaymentInstruction, AppError> {
    let existing = instruction(pool, instruction_id).await?;
    if existing.status != "APPROVED" {
        return Err(AppError::Conflict(format!(
            "instruction {} is {}; only an approved ask can be settled",
            existing.instruction_number,
            existing.status.to_lowercase()
        )));
    }

    let payment = sqlx::query("SELECT status, site_id FROM supplier_payment WHERE payment_id = $1")
        .bind(request.payment_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound("supplier payment".into()))?;
    let status: String = payment.try_get("status")?;
    if status != "POSTED" {
        return Err(AppError::Validation(
            "that payment is still a draft; an instruction is paid when the money is in the \
             books, not when somebody has keyed the intention to move it"
                .into(),
        ));
    }
    let payment_site: String = payment.try_get("site_id")?;
    if payment_site != existing.site_id {
        return Err(AppError::Validation(format!(
            "the payment is at {payment_site} and the ask came from {}; a payment settles the \
             unit it was made for",
            existing.site_id
        )));
    }

    // The bill, if one is named now, has to be the same unit's for the reason
    // `raise_instruction` gives.
    let bill_id = request.bill_id.or(existing.bill_id);
    if let Some(bill_id) = bill_id {
        let site: Option<String> =
            sqlx::query_scalar("SELECT site_id FROM supplier_invoice WHERE invoice_id = $1")
                .bind(bill_id)
                .fetch_optional(pool)
                .await?;
        match site {
            None => return Err(AppError::NotFound("supplier bill".into())),
            Some(site) if site != existing.site_id => {
                return Err(AppError::Validation(format!(
                    "that bill is at {site} and the ask came from {}",
                    existing.site_id
                )))
            }
            Some(_) => {}
        }
    }

    let updated = sqlx::query(
        "UPDATE payment_instruction
            SET status = 'PAID', payment_id = $2, bill_id = COALESCE($3, bill_id),
                settled_by = $4, settled_at = now()
          WHERE instruction_id = $1 AND status = 'APPROVED'",
    )
    .bind(instruction_id)
    .bind(request.payment_id)
    .bind(bill_id)
    .bind(actor)
    .execute(pool)
    .await?;
    if updated.rows_affected() == 0 {
        return Err(AppError::Conflict(
            "this instruction has already been settled".into(),
        ));
    }
    instruction(pool, instruction_id).await
}
