//! General Affairs' own facts: the register's upkeep side, the contracts
//! behind the bills, the repairs, the supplies.
//!
//! # Where the line is
//!
//! GA holds what it produces and Finance holds what it produces, and the two
//! meet through references rather than copies. An asset's LOCATION is GA's; its
//! cost is Finance's, on `asset_capitalization`. A contract's VALUE is GA's; the
//! bills raised under it are Finance's, and GA reads their total back by asking
//! which of them point at the contract. Nothing in this module writes a journal
//! and nothing here chooses a general-ledger account: GA says what KIND of thing
//! happened — the class, the contract type, the repair object, the supply
//! category — and Finance's `account_map` turns that into an account.
//!
//! # One module rather than a table each
//!
//! Every table here is small and none of them is interesting on its own. What
//! is interesting is the overview, which reads all of them at once and is the
//! screen somebody opens first: what expires, what is overdue, what arrived and
//! has not been looked at. Keeping the readers next to each other is what makes
//! that one query readable.

use chrono::{DateTime, NaiveDate, Utc};
use serde::Serialize;
use sqlx::{PgPool, Row};

use crate::cloud::application::AppError;

/// One thing on the overview that wants somebody's attention.
///
/// Deliberately not a record: it is a POINTER to one, with the two facts that
/// put it on the list — what it is called and the date that got it there. The
/// screen turns `kind` and `id` into a link; nothing here is edited from the
/// overview, and a copy of a record is a second copy to keep in step.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct GaAttention {
    /// Which GA object this points at — `asset`, `contract`, `document`,
    /// `repair`, `task`, `replacement`, `supply_request`.
    pub kind: String,
    pub id: String,
    /// The one line the row is read by.
    pub label: String,
    /// The second line, when the kind has one: the class, the site, the party.
    pub detail: Option<String>,
    /// The date that put it on the list — expires on, due on, filed on.
    pub on: Option<String>,
}

/// What the overview is made of, section by section.
///
/// Sections rather than one flat list, because each is a different question
/// with a different threshold and a different answer to "what do I do about
/// it", and a screen that cannot tell an expiring permit from an overdue
/// service is a screen nobody can act on. Each list is capped: an overview is
/// a nudge, not a report, and a hundred rows of anything is a report.
///
/// A section that grows here is a section the screen grows with it. The shape
/// is deliberately flat rather than a `Vec<GaAttention>` — a kind string the
/// client has to switch on is a kind string nobody's compiler checks.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct GaOverview {
    /// The business day the thresholds were applied on, so a screen can say
    /// "as of" without guessing the server's clock.
    pub generated_on: String,
    /// Assets the register holds as DRAFT: the bill came first, the thing has
    /// arrived, and nobody has said where it is or who holds it.
    pub draft_assets: Vec<GaAttention>,
    /// Dokumen yang masa berlakunya habis dalam 90 hari, atau sudah lewat.
    ///
    /// # Why ninety days
    ///
    /// Because renewing the papers that carry a date here — an STNK at
    /// Bapenda/Samsat, an SLO for a lift, a business permit — is not a
    /// transaction somebody performs, it is a QUEUE somebody joins, and the
    /// queue can be a month long on its own. Ninety days is one quarter: it is
    /// the point at which the department can still choose when to go, rather
    /// than the point at which it is already late. A thirty-day threshold would
    /// put every reminder in the window where the only remaining action is an
    /// apology.
    ///
    /// Papers already past their date stay on the list. An expired permit is
    /// not less urgent than one expiring; it is the reason the list exists,
    /// and dropping it would make the overview quietest about the worst case.
    pub expiring_documents: Vec<GaAttention>,
    /// Kontrak yang habis dalam `reminder_days`-nya sendiri, atau sudah habis.
    ///
    /// # Why per contract, and why here
    ///
    /// "Soon" is not one number for the whole register: a permit whose
    /// renewal queue is months long carries a 90-day reminder, and a
    /// subscription renewed by phone needs a week. The threshold is each
    /// contract's own `reminder_days`, so the comparison is arithmetic the
    /// server does per row — a screen that decided it would either flatten
    /// every deal to one window or trust the client's clock.
    ///
    /// Terminated deals are not on this list: DIHENTIKAN means somebody
    /// ended the deal, which is a decision already taken, not a date
    /// approaching. Archived ones stay quiet for the same reason — the
    /// overview is a nudge about what is alive.
    pub expiring_contracts: Vec<GaAttention>,
    /// Servis yang jatuh tempo dalam 7 hari ke depan, atau sudah lewat.
    ///
    /// # Why seven days
    ///
    /// Servis berkala dijadwalkan per minggu di toko — the crew goes out once a
    /// week and does the round — so seven days is the unit the schedule is
    /// already kept in. A longer window (a fortnight, a month) makes the list
    /// permanently full, and a list that is always full is a list people stop
    /// reading; a shorter one (a single day) is not enough warning to fit the
    /// visit into the week's route. Past-due rows stay on it: a service that
    /// was missed is more urgent than one that is due, not less.
    pub due_maintenance: Vec<GaAttention>,
    /// Perbaikan yang belum selesai: OPEN, APPROVED or IN_PROGRESS. A repair
    /// that was completed, closed or cancelled has already had its decision.
    pub open_repairs: Vec<GaAttention>,
    /// Replacement yang sedang berjalan: everything before CLOSED.
    pub replacements: Vec<GaAttention>,
    /// Permintaan barang yang baru diajukan dan belum diputuskan — REQUESTED
    /// only. Once somebody has approved one it is on the Supplies screen, and
    /// the overview is for what has nobody's name against it yet.
    pub supply_requests: Vec<GaAttention>,
    /// Physical originals that are out of the safe (0974): lent for an STNK
    /// renewal, held by the bank. Overdue first. A returned original leaves
    /// the list by itself — the return is the answer to this nudge.
    pub originals_out: Vec<GaAttention>,
}

/// How many rows one section of the overview may carry.
///
/// Ten is what fits under a heading without becoming a list somebody scrolls,
/// which is the point of an overview. The count that matters is on the row's
/// own screen; this is the nudge.
const SECTION_LIMIT: i64 = 10;

/// How far ahead a paper is worth being told about — see
/// [`GaOverview::expiring_documents`].
const EXPIRY_HORIZON_DAYS: i32 = 90;

/// How far ahead a service is worth being told about — see
/// [`GaOverview::due_maintenance`]. Seven days, because that is the unit the
/// shop's service rounds are planned in.
const DUE_MAINTENANCE_HORIZON_DAYS: i32 = 7;

/// How close a km service may come before the overview names it (0975): about
/// a week of a delivery van's driving, the same nudge the seven days give a
/// dated one.
const DUE_MAINTENANCE_HORIZON_KM: i32 = 1000;

/// Everything GA wants somebody to look at, as of `today`.
pub async fn ga_overview(pool: &PgPool, today: NaiveDate) -> Result<GaOverview, AppError> {
    let rows = sqlx::query(
        "SELECT asset_id::text, asset_number, name, category_code, site_id, registered_at
           FROM fixed_asset
          WHERE status = 'DRAFT'
          ORDER BY registered_at, asset_number
          LIMIT $1",
    )
    .bind(SECTION_LIMIT)
    .fetch_all(pool)
    .await?;

    let draft_assets = rows
        .iter()
        .map(|row| {
            let class: String = row.try_get("category_code")?;
            let site: String = row.try_get("site_id")?;
            let registered: Option<DateTime<Utc>> = row.try_get("registered_at")?;
            Ok(GaAttention {
                kind: "asset".into(),
                id: row.try_get("asset_id")?,
                label: row.try_get("name")?,
                detail: Some(format!("{class} · {site}")),
                on: registered.map(|at| at.date_naive().to_string()),
            })
        })
        .collect::<Result<Vec<GaAttention>, AppError>>()?;

    // The papers that run out. Read from `document` alone and not through
    // `document_link`: what the link says is WHAT a paper is about, and this
    // row has nowhere to put it — `GaAttention` names the paper itself, and the
    // screen opens the document. Filtering on the link would also hide the
    // permit nobody has filed against a site yet, which is exactly the paper
    // most worth being told about.
    //
    // The horizon is a business rule and lives here rather than on the screen:
    // see `GaOverview::expiring_documents`.
    let rows = sqlx::query(
        "SELECT document_id::text, name, doc_type, doc_number, expires_on
           FROM document
          WHERE expires_on IS NOT NULL
            AND expires_on <= $1::date + $2::integer
          ORDER BY expires_on, document_id
          LIMIT $3",
    )
    .bind(today)
    .bind(EXPIRY_HORIZON_DAYS)
    .bind(SECTION_LIMIT)
    .fetch_all(pool)
    .await?;

    let expiring_documents = rows
        .iter()
        .map(|row| {
            let doc_type: Option<String> = row.try_get("doc_type")?;
            let doc_number: Option<String> = row.try_get("doc_number")?;
            // The type and the number, or whichever of the two the department
            // wrote down. The number alone is still what somebody reads back
            // over the phone, and a paper with neither is named by its file.
            let detail = match (doc_type, doc_number) {
                (Some(kind), Some(number)) => Some(format!("{kind} · {number}")),
                (Some(kind), None) => Some(kind),
                (None, Some(number)) => Some(number),
                (None, None) => None,
            };
            let expires_on: Option<NaiveDate> = row.try_get("expires_on")?;
            Ok(GaAttention {
                kind: "document".into(),
                id: row.try_get("document_id")?,
                label: row.try_get("name")?,
                detail,
                on: expires_on.map(|day| day.to_string()),
            })
        })
        .collect::<Result<Vec<GaAttention>, AppError>>()?;

    // The deals whose window is closing — inside each contract's OWN
    // reminder, or already past it. The comparison is per row because the
    // threshold is per row; see `GaOverview::expiring_contracts`. Reading is
    // ACTIVE-only: DRAFT has not started and TERMINATED was decided.
    let rows = sqlx::query(
        "SELECT contract_id::text, contract_type, counterparty_name, sup.name AS supplier_name,
                ends_on,
                -- The paper number when there is one; a deal without one is
                -- named by what it is and when it started.
                COALESCE(contract_number, contract_type || ' ' || starts_on::text) AS label
           FROM ga_contract c
           LEFT JOIN supplier sup ON sup.supplier_id = c.supplier_id
          WHERE c.status = 'ACTIVE'
            AND NOT archived
            AND ends_on IS NOT NULL
            AND ends_on <= $1::date + reminder_days
          ORDER BY ends_on, contract_id
          LIMIT $2",
    )
    .bind(today)
    .bind(SECTION_LIMIT)
    .fetch_all(pool)
    .await?;

    let expiring_contracts = rows
        .iter()
        .map(|row| {
            let contract_type: String = row.try_get("contract_type")?;
            let counterparty: Option<String> = row.try_get("counterparty_name")?;
            let supplier_name: Option<String> = row.try_get("supplier_name")?;
            // Jenis + pihak: what the deal is and who is on the other side —
            // the two facts that let a person decide whether it is theirs to
            // chase before they open it.
            let detail = match (counterparty, supplier_name) {
                (party @ Some(_), _) => party,
                (None, supplier @ Some(_)) => supplier,
                (None, None) => None,
            };
            let detail = Some(match detail {
                Some(party) => format!("{contract_type} · {party}"),
                None => contract_type,
            });
            let ends_on: Option<NaiveDate> = row.try_get("ends_on")?;
            Ok(GaAttention {
                kind: "contract".into(),
                id: row.try_get("contract_id")?,
                label: row.try_get("label")?,
                detail,
                on: ends_on.map(|day| day.to_string()),
            })
        })
        .collect::<Result<Vec<GaAttention>, AppError>>()?;

    // The three upkeep sections, read after the deal sections so the overview
    // stays one query per question rather than one big join.
    let due_maintenance = ga_overview_due_maintenance(pool, today).await?;
    let open_repairs = ga_overview_open_repairs(pool, today).await?;
    let replacements = ga_overview_replacements(pool, today).await?;
    let supply_requests = ga_overview_supply_requests(pool, today).await?;
    let originals_out = ga_overview_originals_out(pool).await?;

    Ok(GaOverview {
        generated_on: today.to_string(),
        draft_assets,
        expiring_documents,
        expiring_contracts,
        due_maintenance,
        open_repairs,
        replacements,
        supply_requests,
        originals_out,
    })
}

/// The originals out of storage, the latest due first — see
/// [`GaOverview::originals_out`].
async fn ga_overview_originals_out(pool: &PgPool) -> Result<Vec<GaAttention>, AppError> {
    let rows = sqlx::query(
        "SELECT o.original_id::text AS id,
                COALESCE(d.title, d.name) AS paper,
                o.holder_name, o.out_purpose, o.due_back_on
           FROM ga_document_original o
           JOIN document d ON d.document_id = o.document_id
          WHERE o.status = 'OUT'
          ORDER BY o.due_back_on NULLS LAST, o.original_id
          LIMIT $1",
    )
    .bind(SECTION_LIMIT)
    .fetch_all(pool)
    .await?;
    rows.iter()
        .map(|row| {
            let holder: String = row.try_get("holder_name")?;
            let purpose: Option<String> = row.try_get("out_purpose")?;
            let due: Option<NaiveDate> = row.try_get("due_back_on")?;
            Ok(GaAttention {
                kind: "document_original".into(),
                id: row.try_get("id")?,
                label: row.try_get("paper")?,
                detail: Some(match purpose {
                    Some(purpose) => format!("{holder} · {purpose}"),
                    None => holder,
                }),
                on: due.map(|day| day.to_string()),
            })
        })
        .collect()
}

/// The services due inside the seven-day window, or already past it — see
/// [`GaOverview::due_maintenance`].
async fn ga_overview_due_maintenance(
    pool: &PgPool,
    today: NaiveDate,
) -> Result<Vec<GaAttention>, AppError> {
    // A dated service inside the window, and a km service whose vehicle's
    // latest reading is within the km horizon of it (0975) — dated ones first,
    // then the nearest by distance.
    let rows = sqlx::query(
        "SELECT t.task_id::text, t.title, t.next_due, t.next_due_km,
                -- The thing when it is about a thing, the place when it is
                -- about a place: the one line that says whose round it is.
                COALESCE(a.name, (SELECT s.name FROM site s WHERE s.id = t.site_id)) AS detail
           FROM ga_maintenance_task t
           LEFT JOIN fixed_asset a ON a.asset_id = t.asset_id
           LEFT JOIN LATERAL (
                SELECT max(o.odometer_km) AS top FROM ga_odometer_reading o
                 WHERE o.asset_id = t.asset_id
           ) o ON true
          WHERE t.status = 'ACTIVE'
            AND ((t.next_due IS NOT NULL AND t.next_due <= $1::date + $2::integer)
                 OR (t.next_due_km IS NOT NULL AND o.top IS NOT NULL
                     AND t.next_due_km - o.top <= $4::integer))
          ORDER BY t.next_due NULLS LAST, t.next_due_km - o.top, t.task_id
          LIMIT $3",
    )
    .bind(today)
    .bind(DUE_MAINTENANCE_HORIZON_DAYS)
    .bind(SECTION_LIMIT)
    .bind(DUE_MAINTENANCE_HORIZON_KM)
    .fetch_all(pool)
    .await?;

    rows.iter()
        .map(|row| {
            let next_due: Option<NaiveDate> = row.try_get("next_due")?;
            let next_due_km: Option<i32> = row.try_get("next_due_km")?;
            let subject: Option<String> = row.try_get("detail")?;
            let detail = match (next_due, next_due_km) {
                (None, Some(km)) => Some(match subject {
                    Some(subject) => {
                        format!("{subject} · at {} km", super::ga_odometer::km_thousands(km))
                    }
                    None => format!("at {} km", super::ga_odometer::km_thousands(km)),
                }),
                _ => subject,
            };
            Ok(GaAttention {
                kind: "task".into(),
                id: row.try_get("task_id")?,
                label: row.try_get("title")?,
                detail,
                on: next_due.map(|day| day.to_string()),
            })
        })
        .collect()
}

/// The repairs with no terminal decision yet — see
/// [`GaOverview::open_repairs`].
async fn ga_overview_open_repairs(
    pool: &PgPool,
    today: NaiveDate,
) -> Result<Vec<GaAttention>, AppError> {
    // `today` rides the signature so the section reads like the others; the
    // repair's own list orders by failure date, which is what a person acts on.
    let _ = today;
    let rows = sqlx::query(
        "SELECT r.repair_id::text, r.title, r.status, r.site_id, r.failure_at,
                COALESCE(a.name, (SELECT s.name FROM site s WHERE s.id = r.site_id)) AS subject
           FROM ga_repair r
           LEFT JOIN fixed_asset a ON a.asset_id = r.asset_id
          WHERE r.status IN ('OPEN', 'APPROVED', 'IN_PROGRESS')
          ORDER BY r.failure_at, r.repair_id
          LIMIT $1",
    )
    .bind(SECTION_LIMIT)
    .fetch_all(pool)
    .await?;

    rows.iter()
        .map(|row| {
            let status: String = row.try_get("status")?;
            let subject: Option<String> = row.try_get("subject")?;
            let detail = Some(match subject {
                Some(subject) => format!("{status} · {subject}"),
                None => status,
            });
            let failure_at: NaiveDate = row.try_get("failure_at")?;
            Ok(GaAttention {
                kind: "repair".into(),
                id: row.try_get("repair_id")?,
                label: row.try_get("title")?,
                detail,
                on: Some(failure_at.to_string()),
            })
        })
        .collect()
}

/// The replacements not yet closed — see [`GaOverview::replacements`].
async fn ga_overview_replacements(
    pool: &PgPool,
    today: NaiveDate,
) -> Result<Vec<GaAttention>, AppError> {
    let _ = today;
    let rows = sqlx::query(
        "SELECT p.replacement_id::text, p.status, p.reason, p.proposed_on,
                old.name AS old_asset_name
           FROM ga_replacement p
           JOIN fixed_asset old ON old.asset_id = p.old_asset_id
          WHERE p.status <> 'CLOSED'
          ORDER BY p.proposed_on, p.replacement_id
          LIMIT $1",
    )
    .bind(SECTION_LIMIT)
    .fetch_all(pool)
    .await?;

    rows.iter()
        .map(|row| {
            let status: String = row.try_get("status")?;
            let reason: String = row.try_get("reason")?;
            let proposed_on: NaiveDate = row.try_get("proposed_on")?;
            Ok(GaAttention {
                kind: "replacement".into(),
                id: row.try_get("replacement_id")?,
                label: row.try_get("old_asset_name")?,
                detail: Some(format!("{status} · {reason}")),
                on: Some(proposed_on.to_string()),
            })
        })
        .collect()
}

/// The asks nobody has decided yet — see [`GaOverview::supply_requests`].
async fn ga_overview_supply_requests(
    pool: &PgPool,
    today: NaiveDate,
) -> Result<Vec<GaAttention>, AppError> {
    let _ = today;
    let rows = sqlx::query(
        "SELECT q.request_id::text, q.item, q.needed_by, q.site_id,
                c.name AS category_name
           FROM ga_supply_request q
           JOIN ga_supply_category c ON c.category_code = q.category_code
          WHERE q.status = 'REQUESTED'
          ORDER BY q.needed_by NULLS LAST, q.request_id
          LIMIT $1",
    )
    .bind(SECTION_LIMIT)
    .fetch_all(pool)
    .await?;
    rows.iter()
        .map(|row| {
            let category: String = row.try_get("category_name")?;
            let site: String = row.try_get("site_id")?;
            let needed_by: Option<NaiveDate> = row.try_get("needed_by")?;
            Ok(GaAttention {
                kind: "supply_request".into(),
                id: row.try_get("request_id")?,
                label: row.try_get("item")?,
                detail: Some(format!("{category} · {site}")),
                on: needed_by.map(|day| day.to_string()),
            })
        })
        .collect()
}

// ---------------------------------------------------------------------------
// Bills that point at a GA record
// ---------------------------------------------------------------------------

/// One supplier bill that points at a GA record (0370's line references), as
/// GA reads it: whose paper it is, its number and day, where Finance has it,
/// and how much of it is for this record. Drafts count — GA sends a bill as a
/// draft and wants to see it sent — and void or rejected papers do not.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct GaLinkedBill {
    pub invoice_id: uuid::Uuid,
    pub invoice_number: String,
    pub invoice_date: NaiveDate,
    /// The bill's supplier as the bill names it: the master's id, or the code
    /// older bills were written with.
    pub supplier_id: String,
    pub supplier_name: Option<String>,
    /// `DRAFT`, `MATCHED` or `POSTED`.
    pub status: String,
    /// Σ the bill's lines that point at this record.
    pub amount_minor: i64,
}

/// The bill lines a GA record can be pointed at by, one column each.
#[derive(Clone, Copy, Debug)]
pub enum GaBillReference {
    Repair,
    SupplyRequest,
}

impl GaBillReference {
    const fn column(self) -> &'static str {
        match self {
            Self::Repair => "repair_id",
            Self::SupplyRequest => "supply_request_id",
        }
    }
}

/// The supplier's name for a bill row aliased `si`: the master's, found by
/// either spelling of its key, else the name the bill was typed with.
pub(crate) const BILL_SUPPLIER_NAME: &str = "COALESCE(
        (SELECT sp.name FROM supplier sp
          WHERE si.supplier_id IN (sp.supplier_id::text, sp.supplier_code)
          ORDER BY (si.supplier_id = sp.supplier_id::text) DESC
          LIMIT 1),
        si.supplier_name)";

/// Every live bill that points at one GA record, newest first.
pub async fn ga_linked_bills(
    pool: &PgPool,
    reference: GaBillReference,
    id: uuid::Uuid,
) -> Result<Vec<GaLinkedBill>, AppError> {
    let column = reference.column();
    let sql = format!(
        "SELECT si.invoice_id, si.invoice_number, si.invoice_date, si.supplier_id,
                {BILL_SUPPLIER_NAME} AS supplier_name, si.status,
                sum(bl.amount_minor)::bigint AS amount_minor
           FROM supplier_invoice_expense_line bl
           JOIN supplier_invoice si ON si.invoice_id = bl.invoice_id
          WHERE bl.{column} = $1 AND si.status NOT IN ('VOID', 'REJECTED')
          GROUP BY si.invoice_id
          ORDER BY si.invoice_date DESC, si.invoice_number DESC"
    );
    let rows = sqlx::query(&sql).bind(id).fetch_all(pool).await?;
    rows.iter()
        .map(|row| {
            Ok(GaLinkedBill {
                invoice_id: row.try_get("invoice_id")?,
                invoice_number: row.try_get("invoice_number")?,
                invoice_date: row.try_get("invoice_date")?,
                supplier_id: row.try_get("supplier_id")?,
                supplier_name: row.try_get("supplier_name")?,
                status: row.try_get("status")?,
                amount_minor: row.try_get("amount_minor")?,
            })
        })
        .collect()
}

/// What one supplier billed in a year: POSTED bills dated in it, the figure
/// Finance's books carry. Matched by either spelling of the supplier's key.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct GaSupplierBilled {
    pub supplier_id: uuid::Uuid,
    /// The business clock's year.
    pub year: i32,
    pub billed_minor: i64,
    pub bill_count: i64,
}

pub async fn ga_supplier_billed(
    pool: &PgPool,
    supplier_id: uuid::Uuid,
    today: NaiveDate,
) -> Result<GaSupplierBilled, AppError> {
    let row = sqlx::query(
        "SELECT COALESCE(sum(si.total_minor), 0)::bigint AS billed,
                count(si.invoice_id)::bigint AS n
           FROM supplier s
           LEFT JOIN supplier_invoice si
                  ON si.supplier_id IN (s.supplier_id::text, s.supplier_code)
                 AND si.status = 'POSTED'
                 AND si.invoice_date >= make_date($2, 1, 1)
                 AND si.invoice_date <  make_date($2 + 1, 1, 1)
          WHERE s.supplier_id = $1
          GROUP BY s.supplier_id",
    )
    .bind(supplier_id)
    .bind(chrono::Datelike::year(&today))
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound("Supplier".into()))?;
    Ok(GaSupplierBilled {
        supplier_id,
        year: chrono::Datelike::year(&today),
        billed_minor: row.try_get("billed")?,
        bill_count: row.try_get("n")?,
    })
}
