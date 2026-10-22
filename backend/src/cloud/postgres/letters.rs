//! Letters: the paperwork somebody signs.
//!
//! Three kinds drawn from records this database already holds — a goods
//! receipt note for a supplier's delivery (surat terima barang), a delivery
//! note for goods going out to a shop (surat jalan), and a return delivery
//! note for goods going back to a supplier (surat jalan retur supplier,
//! issued the moment Buying confirms the return) — plus the blank letter
//! drawn from nothing. None is a view over its record: see the migration
//! `0200` for why what a letter says is copied into it rather than joined.
//!
//! # The three acts
//!
//! `draft_letter` copies the record into a letter and writes nothing else — no
//! number, nothing anybody has to explain if it is abandoned. `save_letter`
//! keeps what somebody typed. `issue_letter` takes the next number in the
//! series and freezes the lines, in one transaction, and from that moment the
//! letter is read-only: the only thing left to do to it is `void_letter`, with
//! a reason.
//!
//! # Why the lines are re-copied at issue and not before
//!
//! A delivery can still be counted while a draft is open — a second pallet is
//! found, a carton is rejected — and the draft would then be describing the
//! delivery as it was an hour ago. So the copy that matters is taken at the
//! moment somebody commits their name to it, which is what issuing is.

use crate::cloud::application::AppError;
use chrono::{DateTime, Datelike, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::{PgConnection, PgPool, Row};
use uuid::Uuid;

/// What a letter is drawn from, and what it is called.
///
/// The prefix is the letter's own series — `STB/2609/0001` — and it is the
/// Indonesian abbreviation because that is what the people filing these
/// letters will look for in the folder: Surat Terima Barang, Surat Jalan.
struct Sort {
    kind: &'static str,
    prefix: &'static str,
    title: &'static str,
    /// The record kind its `subject_id` names, in the one vocabulary.
    subject_kind: &'static str,
}

const SORTS: [Sort; 4] = [
    Sort {
        kind: "GOODS_RECEIPT",
        prefix: "STB",
        title: "Surat Terima Barang",
        // The delivery document itself — `goods_receipt`, the numbered thing a
        // DC opens when a truck arrives (migration 0028). A letter is written
        // for the truck, not for each counted line.
        subject_kind: "receipt",
    },
    Sort {
        kind: "SUPPLIER_RETURN",
        prefix: "SJR",
        title: "Surat Jalan Retur Supplier",
        // The return's own allotment, whole. A RETURN_TO_SUPPLIER allotment
        // has the one destination a return can have — `external/supplier` —
        // so unlike a delivery note there is no `{allotment}/{site}` pair to
        // spell out: the goods, the reason and the terms travel together or
        // not at all.
        subject_kind: "allotment",
    },
    Sort {
        kind: "DELIVERY_NOTE",
        prefix: "SJ",
        title: "Surat Jalan",
        // An allotment and ONE of its destinations, spelled `{id}/{site}`.
        //
        // A delivery note travels in a vehicle to one shop, and an allotment
        // does not: its destination is per LINE, and a single allotment in
        // this database sends goods to eleven shops at once. So the thing a
        // letter is written against is the pair, and the composite id is what
        // makes "one live letter per record" mean one per shop rather than one
        // for the whole distribution.
        subject_kind: "allotment",
    },
    Sort {
        kind: "GENERAL",
        prefix: "SRT",
        title: "Surat",
        // Itself. A blank letter is drawn from no record at all, and the
        // columns are NOT NULL, so it names the one thing it can truthfully
        // name — see migration 0210.
        subject_kind: "letter",
    },
];

/// A letter a person writes from a template, rather than one drawn from a
/// record (owner, 2026-10-17): a goods out letter for a BPKB, a warning
/// letter, a notice. All of them are `GENERAL` letters; the form names which
/// paper it is, which group the register files it under, and its own series —
/// `SKB/2610/0007` — so a Surat Keluar Barang is not numbered as a Surat.
///
/// The letters the system writes (surat jalan, goods receipt note, return
/// note) are not here: their own flows make them.
struct Form {
    key: &'static str,
    prefix: &'static str,
    title: &'static str,
    group: &'static str,
}

const FORMS: [Form; 10] = [
    Form {
        key: "goods_out",
        prefix: "SKB",
        title: "Surat Keluar Barang",
        group: "goods",
    },
    Form {
        key: "goods_in",
        prefix: "STM",
        title: "Surat Terima Barang",
        group: "goods",
    },
    Form {
        key: "handover",
        prefix: "BAST",
        title: "Berita Acara Serah Terima",
        group: "goods",
    },
    Form {
        key: "authority",
        prefix: "SKP",
        title: "Surat Kuasa Pengambilan Barang",
        group: "goods",
    },
    Form {
        key: "assignment",
        prefix: "ST",
        title: "Surat Tugas",
        group: "people",
    },
    Form {
        key: "warning",
        prefix: "SPR",
        title: "Surat Peringatan",
        group: "people",
    },
    Form {
        key: "employment",
        prefix: "SKK",
        title: "Surat Keterangan Kerja",
        group: "people",
    },
    Form {
        key: "notice",
        prefix: "SPB",
        title: "Surat Pemberitahuan",
        group: "notices",
    },
    Form {
        key: "request",
        prefix: "SPM",
        title: "Surat Permohonan",
        group: "notices",
    },
    Form {
        key: "blank",
        prefix: "SRT",
        title: "Surat",
        group: "notices",
    },
];

fn form_of(key: &str) -> Option<&'static Form> {
    FORMS.iter().find(|form| form.key == key)
}

/// The register's groups, as the filter names them: the three a person writes
/// in, and `system` for the letters the system writes.
const GROUPS: [&str; 4] = ["goods", "people", "notices", "system"];

fn sort_of(kind: &str) -> Result<&'static Sort, AppError> {
    SORTS
        .iter()
        .find(|sort| sort.kind == kind)
        .ok_or_else(|| AppError::Validation(format!("unknown letter kind: {kind}")))
}

// ---------------------------------------------------------------------------
// What the wire carries
// ---------------------------------------------------------------------------

/// One line of the table of goods.
///
/// Deliberately without money. A goods receipt note and a delivery note say
/// what arrived and what is being sent; the price is a commercial fact that
/// belongs on the order and the invoice, and putting it here would put supplier
/// pricing in front of everybody who prints a delivery note.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct LetterLine {
    /// What it is called on the letter.
    pub description: String,
    /// The code a warehouse checks against: an article code, or a SKU.
    pub code: String,
    /// Colour and size, where the goods have them.
    pub variant: Option<String>,
    pub quantity: i64,
    pub unit: String,
    /// What was asked for, when that is not what is going — an allotment line
    /// picked short. `None` on a receipt, where there is nothing to compare.
    pub ordered: Option<i64>,
}

/// A record a letter could be written against, and has not been yet.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct LetterSource {
    pub kind: String,
    pub subject_id: String,
    /// What the row says on the picker: the order or allotment number.
    pub reference: String,
    /// Who it is with — the supplier for a receipt, the shop for a delivery.
    pub counterparty: String,
    pub place: String,
    pub occurred_at: DateTime<Utc>,
    pub lines: i64,
    pub quantity: i64,
}

/// A letter as the register lists it.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct LetterRow {
    pub letter_id: Uuid,
    pub kind: String,
    pub status: String,
    pub letter_number: Option<String>,
    pub title: String,
    pub subject_kind: String,
    pub subject_id: String,
    pub reference: String,
    pub counterparty: String,
    pub place: String,
    pub quantity: i64,
    /// Which written form a `GENERAL` letter is — `goods_out`, `warning` — and
    /// the register group it files under. Empty on the letters the system
    /// writes, and on a blank letter written before forms existed.
    pub form: String,
    pub group: String,
    pub created_by: String,
    pub created_at: DateTime<Utc>,
    pub issued_at: Option<DateTime<Utc>>,
    pub issued_by: Option<String>,
    pub voided_at: Option<DateTime<Utc>>,
}

/// The register.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct LetterList {
    pub rows: Vec<LetterRow>,
    /// Opaque. Pass it back as `cursor` for the next page; absent means this
    /// was the last one.
    pub next_cursor: Option<String>,
    /// Every letter the kind, status and search match — not just this page.
    pub total: i64,
    /// Drafts waiting to be issued, across every kind. The one number a person
    /// coming to this screen wants before they have read a row.
    pub drafts: i64,
    /// How the letters the kind and the search match split, for the chips.
    pub facets: LetterFacets,
}

/// The register's two chip rows, counted the way a click would answer: each
/// row honours the other row's choice and ignores its own.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct LetterFacets {
    /// `goods`, `people`, `notices` and `system`, each listed, 0 or not.
    pub groups: Vec<LetterFacet>,
    /// `DRAFT`, `ISSUED` and `VOID`, each listed, 0 or not.
    pub statuses: Vec<LetterFacet>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct LetterFacet {
    pub value: String,
    pub count: i64,
}

/// One letter, whole.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct LetterDetail {
    pub letter_id: Uuid,
    pub kind: String,
    pub status: String,
    pub letter_number: Option<String>,
    pub period: Option<String>,
    pub title: String,
    pub subject_kind: String,
    pub subject_id: String,
    /// The head of the document: who to, who from, which order. A map rather
    /// than columns because the two kinds do not have the same head, and a
    /// table with the union of both would be half nulls whichever letter it
    /// held.
    #[cfg_attr(feature = "ts", ts(type = "Record<string, unknown>"))]
    pub facts: Value,
    pub lines: Vec<LetterLine>,
    /// The editor's document. Opaque here on purpose: what a rich text editor
    /// stores is the editor's business, and a server that parses it is a server
    /// that has to be changed when the editor is.
    #[cfg_attr(feature = "ts", ts(type = "Record<string, unknown>"))]
    pub body: Value,
    pub created_by: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub issued_by: Option<String>,
    pub issued_at: Option<DateTime<Utc>>,
    pub voided_by: Option<String>,
    pub voided_at: Option<DateTime<Utc>>,
    pub void_reason: Option<String>,
}

/// Start one.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct NewLetter {
    pub kind: String,
    pub subject_id: String,
    /// A pattern to start from, when somebody picked one.
    pub template_id: Option<Uuid>,
    /// The written form, for a `GENERAL` letter — see [`FORMS`].
    #[serde(default)]
    pub form: Option<String>,
}

/// Keep what somebody typed.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct LetterEdit {
    #[cfg_attr(feature = "ts", ts(type = "Record<string, unknown>"))]
    pub body: Value,
    /// Only the fields a person fills in — who is carrying the goods, the
    /// vehicle, who will sign for them. The rest of `facts` comes from the
    /// record and is not a text box.
    #[cfg_attr(feature = "ts", ts(type = "Record<string, unknown> | null"))]
    pub facts: Option<Value>,
}

/// A saved pattern: the wording and the typed head, named.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct LetterTemplate {
    pub template_id: Uuid,
    pub kind: String,
    pub name: String,
    #[cfg_attr(feature = "ts", ts(type = "Record<string, unknown>"))]
    pub body: Value,
    #[cfg_attr(feature = "ts", ts(type = "Record<string, unknown>"))]
    pub facts: Value,
    pub created_by: String,
    pub created_at: DateTime<Utc>,
}

/// Keep this letter's wording as a pattern.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct NewTemplate {
    pub kind: String,
    pub name: String,
    /// The letter this pattern is taken from. Its wording and its typed head
    /// are copied out of the letter here rather than sent up from the browser,
    /// so what gets saved is what the letter actually says.
    pub from_letter: Option<Uuid>,
}

/// Stop one.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct VoidLetter {
    pub reason: String,
}

#[derive(Clone, Debug, Default, Deserialize)]
pub struct LetterQuery {
    pub kind: Option<String>,
    pub status: Option<String>,
    pub q: Option<String>,
    /// `goods`, `people`, `notices` (written letters by their form's group) or
    /// `system` (everything that is not written by a person).
    pub group: Option<String>,
    /// A `next_cursor` from the previous page, verbatim.
    pub cursor: Option<String>,
    /// The page size; clamped to [`LETTER_MAX_LIMIT`].
    pub limit: Option<i64>,
}

/// The register's page when a caller does not say.
const LETTER_DEFAULT_LIMIT: i64 = 100;
/// And the most one page holds however loudly a caller asks.
const LETTER_MAX_LIMIT: i64 = 500;

/// Where the previous page stopped: the house order's two keys, carried whole
/// so the seek needs no lookup of a row that may since have changed.
#[derive(Serialize, Deserialize)]
struct LetterCursor {
    created_at: DateTime<Utc>,
    letter_id: Uuid,
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

fn row_to_letter(row: &sqlx::postgres::PgRow) -> LetterRow {
    let facts: Value = row.get("facts");
    let text = |key: &str| {
        facts
            .get(key)
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string()
    };
    LetterRow {
        letter_id: row.get("letter_id"),
        kind: row.get("kind"),
        status: row.get("status"),
        letter_number: row.get("letter_number"),
        title: row.get("title"),
        subject_kind: row.get("subject_kind"),
        subject_id: row.get("subject_id"),
        reference: text("reference"),
        counterparty: text("counterparty"),
        place: text("place"),
        quantity: facts
            .get("quantity")
            .and_then(Value::as_i64)
            .unwrap_or_default(),
        form: text("form"),
        group: text("group"),
        created_by: row.get("created_by"),
        created_at: row.get("created_at"),
        issued_at: row.get("issued_at"),
        issued_by: row.get("issued_by"),
        voided_at: row.get("voided_at"),
    }
}

/// Every letter, newest first.
///
/// Ordered by when it was WRITTEN rather than when it was issued, so a draft
/// somebody started this morning is at the top where they left it — an issued
/// letter is finished business and a draft is not.
///
/// Paged by a keyset on that order — `(created_at, letter_id)`, newest first —
/// so the register walks the whole book a page at a time rather than stopping
/// silently at the two-hundredth letter.
pub async fn list_letters(pool: &PgPool, query: LetterQuery) -> Result<LetterList, AppError> {
    let kind = query.kind.as_deref().filter(|value| !value.is_empty());
    let status = query.status.as_deref().filter(|value| !value.is_empty());
    let needle = query
        .q
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let limit = query
        .limit
        .unwrap_or(LETTER_DEFAULT_LIMIT)
        .clamp(1, LETTER_MAX_LIMIT);
    let cursor = query
        .cursor
        .as_deref()
        .map(super::decode_cursor::<LetterCursor>)
        .transpose()?;
    let group = query.group.as_deref().filter(|value| !value.is_empty());
    if let Some(group) = group {
        if !GROUPS.contains(&group) {
            return Err(AppError::Validation(format!(
                "unknown letter group: {group}"
            )));
        }
    }

    // One definition of which letters match, for the page and for the count.
    //
    // A written letter with no group — a blank one from before the forms —
    // files under notices, where the blank letter lives now.
    const MATCHED: &str = "FROM letter \
         WHERE ($1::text IS NULL OR kind = $1) \
           AND ($2::text IS NULL OR status = $2) \
           AND ($3::text IS NULL OR letter_number ILIKE '%' || $3 || '%' \
                OR title ILIKE '%' || $3 || '%' \
                OR facts->>'reference' ILIKE '%' || $3 || '%' \
                OR facts->>'counterparty' ILIKE '%' || $3 || '%') \
           AND ($4::text IS NULL \
                OR ($4 = 'system' AND kind <> 'GENERAL') \
                OR (kind = 'GENERAL' \
                    AND COALESCE(NULLIF(facts->>'group', ''), 'notices') = $4))";
    let rows = sqlx::query(&format!(
        "SELECT letter_id,kind,status,letter_number,title,subject_kind,subject_id,\
         facts,created_by,created_at,issued_at,issued_by,voided_at \
         {MATCHED} \
           AND ($5::timestamptz IS NULL OR (created_at, letter_id) < ($5, $6)) \
         ORDER BY created_at DESC, letter_id DESC LIMIT $7"
    ))
    .bind(kind)
    .bind(status)
    .bind(needle)
    .bind(group)
    .bind(cursor.as_ref().map(|c| c.created_at))
    .bind(cursor.as_ref().map(|c| c.letter_id))
    .bind(limit)
    .fetch_all(pool)
    .await?;

    let out: Vec<LetterRow> = rows.iter().map(row_to_letter).collect();
    let next_cursor = match out.last() {
        Some(last) if out.len() as i64 == limit => Some(super::encode_cursor(&LetterCursor {
            created_at: last.created_at,
            letter_id: last.letter_id,
        })?),
        _ => None,
    };

    let total: i64 = sqlx::query_scalar(&format!("SELECT count(*) {MATCHED}"))
        .bind(kind)
        .bind(status)
        .bind(needle)
        .bind(group)
        .fetch_one(pool)
        .await?;

    let drafts: i64 = sqlx::query_scalar("SELECT count(*) FROM letter WHERE status = 'DRAFT'")
        .fetch_one(pool)
        .await?;

    // The group a letter files under, as `MATCHED` reads `$4`.
    let counted = sqlx::query(
        "WITH searched AS (
             SELECT status,
                    CASE WHEN kind <> 'GENERAL' THEN 'system'
                         ELSE COALESCE(NULLIF(facts->>'group', ''), 'notices') END AS grp
               FROM letter
              WHERE ($1::text IS NULL OR kind = $1)
                AND ($2::text IS NULL OR letter_number ILIKE '%' || $2 || '%'
                     OR title ILIKE '%' || $2 || '%'
                     OR facts->>'reference' ILIKE '%' || $2 || '%'
                     OR facts->>'counterparty' ILIKE '%' || $2 || '%')
         )
         SELECT 'group' AS facet, grp AS value, count(*)::bigint AS n
           FROM searched WHERE $3::text IS NULL OR status = $3 GROUP BY grp
          UNION ALL
         SELECT 'status', status, count(*)::bigint
           FROM searched WHERE $4::text IS NULL OR grp = $4 GROUP BY status",
    )
    .bind(kind)
    .bind(needle)
    .bind(status)
    .bind(group)
    .fetch_all(pool)
    .await?;
    let mut facets = LetterFacets {
        groups: GROUPS
            .into_iter()
            .map(|value| LetterFacet {
                value: value.to_string(),
                count: 0,
            })
            .collect(),
        statuses: ["DRAFT", "ISSUED", "VOID"]
            .into_iter()
            .map(|value| LetterFacet {
                value: value.to_string(),
                count: 0,
            })
            .collect(),
    };
    for row in &counted {
        let facet: String = row.get("facet");
        let value: String = row.get("value");
        let n: i64 = row.get("n");
        let list = if facet == "group" {
            &mut facets.groups
        } else {
            &mut facets.statuses
        };
        match list.iter_mut().find(|one| one.value == value) {
            Some(one) => one.count = n,
            None => list.push(LetterFacet { value, count: n }),
        }
    }

    Ok(LetterList {
        rows: out,
        next_cursor,
        total,
        drafts,
        facets,
    })
}

pub async fn letter_detail(pool: &PgPool, id: Uuid) -> Result<LetterDetail, AppError> {
    let row = sqlx::query(
        "SELECT letter_id,kind,status,letter_number,period,title,subject_kind,subject_id,\
         facts,lines,body,created_by,created_at,updated_at,issued_by,issued_at,\
         voided_by,voided_at,void_reason FROM letter WHERE letter_id = $1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound("letter".into()))?;

    let lines: Value = row.get("lines");
    Ok(LetterDetail {
        letter_id: row.get("letter_id"),
        kind: row.get("kind"),
        status: row.get("status"),
        letter_number: row.get("letter_number"),
        period: row.get("period"),
        title: row.get("title"),
        subject_kind: row.get("subject_kind"),
        subject_id: row.get("subject_id"),
        facts: row.get("facts"),
        lines: serde_json::from_value(lines).unwrap_or_default(),
        body: row.get("body"),
        created_by: row.get("created_by"),
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
        issued_by: row.get("issued_by"),
        issued_at: row.get("issued_at"),
        voided_by: row.get("voided_by"),
        voided_at: row.get("voided_at"),
        void_reason: row.get("void_reason"),
    })
}

/// What a letter of this kind could still be written against.
///
/// Only what has no live letter already: a delivery with a goods receipt note
/// against it is finished, and offering it again is how two people write two
/// letters for one arrival. A voided letter puts its record back on this list,
/// which is the whole point of voiding rather than deleting.
pub async fn letter_sources(pool: &PgPool, kind: &str) -> Result<Vec<LetterSource>, AppError> {
    let sort = sort_of(kind)?;
    let rows = match sort.kind {
        "GOODS_RECEIPT" => {
            sqlx::query(
                "SELECT gr.receipt_id::text AS subject_id, gr.receipt_number AS reference,\
                 coalesce(max(po.supplier_name), gr.supplier_id) AS counterparty,\
                 coalesce(max(site.name), max(warehouse.name), gr.site_id) AS place,\
                 gr.arrived_at AS occurred_at,\
                 count(grl.receipt_line_id) AS lines,\
                 coalesce(sum(grl.quantity), 0)::bigint AS quantity \
                 FROM goods_receipt gr \
                 LEFT JOIN goods_receipt_line grl ON grl.receipt_id = gr.receipt_id \
                 LEFT JOIN purchase_order_line pol ON pol.po_line_id = grl.po_line_id \
                 LEFT JOIN purchase_order po \
                   ON po.purchase_order_id = pol.purchase_order_id \
                 LEFT JOIN site ON site.id = gr.site_id \
                 LEFT JOIN sync_origin_credential gro ON gro.origin_id = gr.origin_id \
                 LEFT JOIN site warehouse \
                   ON gro.node_role = 'DC' AND warehouse.kind = 'HO' \
                 WHERE NOT EXISTS (\
                     SELECT 1 FROM letter \
                     WHERE letter.kind = 'GOODS_RECEIPT' \
                       AND letter.subject_id = gr.receipt_id::text \
                       AND letter.status <> 'VOID') \
                 GROUP BY gr.receipt_id, gr.receipt_number, gr.supplier_id, gr.site_id,\
                 gr.arrived_at \
                 ORDER BY gr.arrived_at DESC LIMIT 100",
            )
            .fetch_all(pool)
            .await?
        }
        "SUPPLIER_RETURN" => {
            sqlx::query(
                "SELECT r.allotment_id::text AS subject_id,\
                 a.allotment_number AS reference,\
                 coalesce(r.supplier_name, r.supplier_id) AS counterparty,\
                 coalesce(site.name, p.site_id) AS place,\
                 r.raised_at AS occurred_at,\
                 count(l.sku_id) AS lines,\
                 sum(l.quantity)::bigint AS quantity \
                 FROM supplier_return r \
                 JOIN allotment a ON a.id = r.allotment_id \
                 JOIN allotment_line l ON l.allotment_id = r.allotment_id \
                 LEFT JOIN operational_pool p ON p.id = l.source_pool_id \
                 LEFT JOIN site ON site.id = p.site_id \
                 WHERE a.status <> 'CANCELLED' \
                   AND NOT EXISTS (\
                     SELECT 1 FROM letter \
                     WHERE letter.kind = 'SUPPLIER_RETURN' \
                       AND letter.subject_id = r.allotment_id::text \
                       AND letter.status <> 'VOID') \
                 GROUP BY r.allotment_id, a.allotment_number, r.supplier_name,\
                 r.supplier_id, p.site_id, site.name, r.raised_at \
                 ORDER BY r.raised_at DESC LIMIT 100",
            )
            .fetch_all(pool)
            .await?
        }
        _ => {
            sqlx::query(
                "SELECT a.id::text || '/' || al.destination_id AS subject_id,\
                 a.allotment_number AS reference,\
                 coalesce(site.name, al.destination_id) AS counterparty,\
                 coalesce(site.name, al.destination_id) AS place,\
                 a.created_at AS occurred_at, count(*) AS lines,\
                 sum(al.quantity)::bigint AS quantity \
                 FROM allotment a \
                 JOIN allotment_line al ON al.allotment_id = a.id \
                 LEFT JOIN site ON site.id = al.destination_id \
                 WHERE a.status <> 'CANCELLED' \
                   AND NOT EXISTS (\
                     SELECT 1 FROM letter \
                     WHERE letter.kind = 'DELIVERY_NOTE' \
                       AND letter.subject_id = a.id::text || '/' || al.destination_id \
                       AND letter.status <> 'VOID') \
                 GROUP BY a.id, a.allotment_number, al.destination_id, site.name, a.created_at \
                 ORDER BY a.created_at DESC, al.destination_id LIMIT 100",
            )
            .fetch_all(pool)
            .await?
        }
    };

    Ok(rows
        .iter()
        .map(|row| LetterSource {
            kind: sort.kind.to_string(),
            subject_id: row.get("subject_id"),
            reference: row.get("reference"),
            counterparty: row.get("counterparty"),
            place: row.get("place"),
            occurred_at: row.get("occurred_at"),
            lines: row.get("lines"),
            quantity: row.get("quantity"),
        })
        .collect())
}

/// How many records of this kind already carry a live letter.
///
/// The picker's empty list is ambiguous without it: "nothing to write one
/// against" and "everything already has one" are opposite situations, and the
/// person reading the screen can act on only one of them. So the count travels
/// beside the list and the empty state says which it is.
pub async fn letters_written(pool: &PgPool, kind: &str) -> Result<i64, AppError> {
    let sort = sort_of(kind)?;
    Ok(
        sqlx::query_scalar("SELECT count(*) FROM letter WHERE kind = $1 AND status <> 'VOID'")
            .bind(sort.kind)
            .fetch_one(pool)
            .await?,
    )
}

/// Which fields of a letter's head a pattern may carry.
///
/// The typed ones and nothing else. A template that remembered the supplier,
/// the order number or the arrival date would be last month's delivery printed
/// onto this month's letter — and those come from the record every time.
///
/// A written letter's form and its typed details travel too — a pattern of a
/// warning letter is a warning letter — but never its items: those are what
/// this one letter hands over.
const TEMPLATE_FACTS: [&str; 15] = [
    "reference",
    "counterparty",
    "carrier",
    "vehicle",
    "signatures",
    "form",
    "group",
    "to",
    "from",
    "purpose",
    "subject",
    "employee",
    "role",
    "level",
    "place_to",
];

/// Every pattern offered for this kind, newest name first.
pub async fn letter_templates(pool: &PgPool, kind: &str) -> Result<Vec<LetterTemplate>, AppError> {
    let sort = sort_of(kind)?;
    let rows = sqlx::query(
        "SELECT template_id,kind,name,body,facts,created_by,created_at \
         FROM letter_template WHERE kind = $1 AND retired_at IS NULL \
         ORDER BY name",
    )
    .bind(sort.kind)
    .fetch_all(pool)
    .await?;

    Ok(rows
        .iter()
        .map(|row| LetterTemplate {
            template_id: row.get("template_id"),
            kind: row.get("kind"),
            name: row.get("name"),
            body: row.get("body"),
            facts: row.get("facts"),
            created_by: row.get("created_by"),
            created_at: row.get("created_at"),
        })
        .collect())
}

/// Keep a letter's writable half under a name.
pub async fn save_template(
    pool: &PgPool,
    request: &NewTemplate,
    author: &str,
) -> Result<Uuid, AppError> {
    let sort = sort_of(&request.kind)?;
    let name = request.name.trim();
    if name.is_empty() {
        return Err(AppError::Validation("a pattern needs a name".into()));
    }

    let (body, facts) = match request.from_letter {
        Some(id) => {
            let letter = letter_detail(pool, id).await?;
            let mut kept = serde_json::Map::new();
            if let Some(head) = letter.facts.as_object() {
                for key in TEMPLATE_FACTS {
                    if let Some(value) = head.get(key) {
                        kept.insert(key.to_string(), value.clone());
                    }
                }
            }
            (letter.body, Value::Object(kept))
        }
        None => (json!({}), json!({})),
    };

    let template_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO letter_template (template_id,kind,name,body,facts,created_by) \
         VALUES ($1,$2,$3,$4,$5,$6)",
    )
    .bind(template_id)
    .bind(sort.kind)
    .bind(name)
    .bind(&body)
    .bind(&facts)
    .bind(author)
    .execute(pool)
    .await
    .map_err(|error| match error {
        sqlx::Error::Database(ref problem)
            if problem.constraint() == Some("ux_letter_template_name") =>
        {
            AppError::Conflict(format!("a pattern called \"{name}\" already exists"))
        }
        other => other.into(),
    })?;

    Ok(template_id)
}

/// Stop offering one. Never deleted — see the migration.
pub async fn retire_template(pool: &PgPool, id: Uuid, actor: &str) -> Result<(), AppError> {
    let changed = sqlx::query(
        "UPDATE letter_template SET retired_at = now(), retired_by = $2, updated_at = now() \
         WHERE template_id = $1 AND retired_at IS NULL",
    )
    .bind(id)
    .bind(actor)
    .execute(pool)
    .await?
    .rows_affected();

    if changed == 0 {
        return Err(AppError::NotFound("template".into()));
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Drawing the record into a letter
// ---------------------------------------------------------------------------

/// What is actually in the vehicle.
///
/// Picking is what puts goods in it, so a picked line says what is going. A
/// line nobody has picked yet is a letter written ahead of the work — which is
/// how a warehouse does it, the note travelling with the picker — and there the
/// allotted quantity is the only figure there is. Printing the picked zero
/// instead would produce a delivery note for nothing at all.
fn going(allotted: i64, picked: i64) -> i64 {
    if picked > 0 {
        picked
    } else {
        allotted
    }
}

/// `{allotment}/{destination}`, the pair a delivery note is written against.
fn pair(subject_id: &str) -> Result<(Uuid, String), AppError> {
    let (left, right) = subject_id.split_once('/').ok_or_else(|| {
        AppError::Validation(
            "a delivery note names an allotment and one of its destinations".into(),
        )
    })?;
    let allotment = Uuid::parse_str(left)
        .map_err(|_| AppError::Validation(format!("{left} is not an identifier")))?;
    if right.trim().is_empty() {
        return Err(AppError::Validation("no destination named".into()));
    }
    Ok((allotment, right.to_owned()))
}

/// The head and the table, read off the record as it stands right now.
///
/// On a connection, not the pool: the supplier return's surat is drawn and
/// issued inside the transaction that writes the return, so the paper exists
/// exactly when the return does.
async fn draw(
    conn: &mut PgConnection,
    sort: &Sort,
    subject_id: &str,
) -> Result<(Value, Vec<LetterLine>), AppError> {
    match sort.kind {
        "GOODS_RECEIPT" => {
            let id = Uuid::parse_str(subject_id)
                .map_err(|_| AppError::Validation(format!("{subject_id} is not an identifier")))?;
            // The delivery document the DC opened when the truck arrived —
            // `goods_receipt`, not the per-line counts. Migration 0028 made
            // this a numbered document precisely because a truck brings four
            // articles against three orders, and a letter is written for the
            // truck.
            //
            // `gr.site_id` is the EDGE node's name for where it stands (`dc`),
            // which has not been a row of `site` since 0256 renamed the site
            // to `ho`. So the direct join misses for every DC receipt and the
            // letter printed the bare id `dc` where it used to print a place.
            // Resolved the way `unbilled_receipts` resolves the same gap: a
            // DC-role origin stands in the one head-office site.
            let head = sqlx::query(
                "SELECT gr.receipt_number, gr.supplier_id, gr.arrived_at, gr.invoice_number,\
                 gr.opened_by, gr.status,\
                 coalesce(max(po.supplier_name), gr.supplier_id) AS supplier,\
                 coalesce(max(site.name), max(warehouse.name), gr.site_id) AS site_name,\
                 gr.site_id,\
                 coalesce(sum(grl.quantity), 0)::bigint AS quantity,\
                 coalesce(string_agg(DISTINCT po.po_number, ', '), '') AS orders,\
                 max(grl.counted_by) AS counted_by, max(grl.verified_by) AS verified_by \
                 FROM goods_receipt gr \
                 LEFT JOIN goods_receipt_line grl ON grl.receipt_id = gr.receipt_id \
                 LEFT JOIN purchase_order_line pol ON pol.po_line_id = grl.po_line_id \
                 LEFT JOIN purchase_order po \
                   ON po.purchase_order_id = pol.purchase_order_id \
                 LEFT JOIN site ON site.id = gr.site_id \
                 LEFT JOIN sync_origin_credential gro ON gro.origin_id = gr.origin_id \
                 LEFT JOIN site warehouse \
                   ON gro.node_role = 'DC' AND warehouse.kind = 'HO' \
                 WHERE gr.receipt_id = $1 \
                 GROUP BY gr.receipt_id, gr.receipt_number, gr.supplier_id, gr.site_id,\
                 gr.arrived_at, gr.invoice_number, gr.opened_by, gr.status",
            )
            .bind(id)
            .fetch_optional(&mut *conn)
            .await?
            .ok_or_else(|| AppError::NotFound("goods receipt".into()))?;

            // Both figures are in the article's STOCK unit (PCS for nearly
            // everything), with no conversion between them here: an order
            // placed in LUSIN kept its pieces beside the unit (0399), and
            // 0027's warning still stands — arithmetic on every read is how
            // 118 pieces once became 1,416. The unit printed is the stock
            // unit's own (0653).
            //
            // What the supplier calls it comes from the snapshot taken when
            // the order was raised, because a printed letter must read the way
            // the goods were agreed even after the supplier renames the item.
            let lines = sqlx::query(
                "SELECT pol.article_code, pol.article_name,\
                 pol.supplier_item_name_snapshot AS supplier_wording,\
                 sum(grl.quantity)::bigint AS quantity,\
                 pol.ordered_quantity::bigint AS ordered,\
                 lower(coalesce(max(ar.stock_unit_code), 'PCS')) AS unit \
                 FROM goods_receipt_line grl \
                 JOIN purchase_order_line pol ON pol.po_line_id = grl.po_line_id \
                 LEFT JOIN article ar ON ar.article_code = pol.article_code \
                 WHERE grl.receipt_id = $1 \
                 GROUP BY pol.po_line_id, pol.line_number, pol.article_code, pol.article_name,\
                 pol.supplier_item_name_snapshot, pol.ordered_quantity \
                 ORDER BY pol.line_number",
            )
            .bind(id)
            .fetch_all(&mut *conn)
            .await?;

            let arrived_at: DateTime<Utc> = head.get("arrived_at");
            let facts = json!({
                "reference": head.get::<String, _>("receipt_number"),
                "orders": head.get::<String, _>("orders"),
                "counterparty": head.get::<String, _>("supplier"),
                "counterparty_id": head.get::<String, _>("supplier_id"),
                "place": head.get::<String, _>("site_name"),
                "place_id": head.get::<String, _>("site_id"),
                "quantity": head.get::<i64, _>("quantity"),
                "occurred_at": arrived_at,
                "invoice_number": head.get::<Option<String>, _>("invoice_number"),
                "counted_by": head.get::<Option<String>, _>("counted_by"),
                "verified_by": head.get::<Option<String>, _>("verified_by"),
                "opened_by": head.get::<String, _>("opened_by"),
            });

            let lines = lines
                .iter()
                .map(|row| LetterLine {
                    description: row
                        .get::<Option<String>, _>("supplier_wording")
                        .filter(|wording| !wording.trim().is_empty())
                        .unwrap_or_else(|| row.get::<String, _>("article_name")),
                    code: row.get("article_code"),
                    variant: None,
                    quantity: row.get("quantity"),
                    unit: row.get("unit"),
                    ordered: Some(row.get("ordered")),
                })
                .collect();
            Ok((facts, lines))
        }
        "SUPPLIER_RETURN" => {
            let id = Uuid::parse_str(subject_id)
                .map_err(|_| AppError::Validation(format!("{subject_id} is not an identifier")))?;
            // The return the Gudang is handing over: one allotment, one
            // supplier, one reason. The goods leave a head-office return pool
            // (0717), and that pool's site is where the surat is written.
            let head = sqlx::query(
                "SELECT a.allotment_number, a.created_at, \
                 r.supplier_id, coalesce(r.supplier_name, r.supplier_id) AS supplier, \
                 r.reason, r.settle_by, r.note, r.raised_by, r.raised_at, \
                 coalesce(site.name, p.site_id) AS place, p.site_id AS place_id, \
                 sum(l.quantity)::bigint AS quantity \
                 FROM supplier_return r \
                 JOIN allotment a ON a.id = r.allotment_id \
                 JOIN allotment_line l ON l.allotment_id = r.allotment_id \
                 LEFT JOIN operational_pool p ON p.id = l.source_pool_id \
                 LEFT JOIN site ON site.id = p.site_id \
                 WHERE r.allotment_id = $1 \
                 GROUP BY a.allotment_number, a.created_at, r.supplier_id,\
                 r.supplier_name, r.reason, r.settle_by, r.note, r.raised_by,\
                 r.raised_at, p.site_id, site.name",
            )
            .bind(id)
            .fetch_optional(&mut *conn)
            .await?
            .ok_or_else(|| AppError::NotFound("supplier return".into()))?;

            // The table of goods reads the allotment's lines — what the
            // Gudang is actually handing over — not the request's: a pick
            // that came up a piece short is what the supplier signs for.
            let lines = sqlx::query(
                "SELECT sk.sku_code, ar.name AS article_name, sk.color, sk.size,\
                 lower(ar.stock_unit_code) AS unit,\
                 sum(l.quantity)::bigint AS quantity \
                 FROM allotment_line l \
                 JOIN sku sk ON sk.id = l.sku_id \
                 JOIN article ar ON ar.id = sk.article_id \
                 WHERE l.allotment_id = $1 \
                 GROUP BY sk.sku_code, ar.name, sk.color, sk.size, ar.stock_unit_code \
                 ORDER BY ar.name, sk.sku_code",
            )
            .bind(id)
            .fetch_all(&mut *conn)
            .await?;

            let raised_at: DateTime<Utc> = head.get("raised_at");
            let facts = json!({
                "reference": head.get::<String, _>("allotment_number"),
                "counterparty": head.get::<String, _>("supplier"),
                "counterparty_id": head.get::<String, _>("supplier_id"),
                "place": head.get::<String, _>("place"),
                "place_id": head.get::<String, _>("place_id"),
                "quantity": head.get::<i64, _>("quantity"),
                "occurred_at": raised_at,
                "reason": head.get::<String, _>("reason"),
                "settle_by": head.get::<String, _>("settle_by"),
                "raised_by": head.get::<String, _>("raised_by"),
                "notes": head.get::<Option<String>, _>("note").unwrap_or_default(),
            });

            let lines = lines
                .iter()
                .map(|row| {
                    let colour: Option<String> = row.get("color");
                    let size: Option<String> = row.get("size");
                    let variant = match (colour, size) {
                        (None, None) => None,
                        (colour, size) => Some(
                            [colour, size]
                                .into_iter()
                                .flatten()
                                .collect::<Vec<_>>()
                                .join(" · "),
                        ),
                    };
                    LetterLine {
                        description: row.get("article_name"),
                        code: row.get("sku_code"),
                        variant,
                        quantity: row.get("quantity"),
                        unit: row.get("unit"),
                        // Nothing to compare against: a return is not a pick
                        // against a count, it is the whole of one.
                        ordered: None,
                    }
                })
                .collect();
            Ok((facts, lines))
        }
        _ => {
            let (allotment_id, destination) = pair(subject_id)?;

            let head = sqlx::query(
                "SELECT a.allotment_number, a.created_by, a.created_at, a.status, a.notes,\
                 a.type, coalesce(site.name, $2) AS store_name,\
                 sum(al.quantity)::bigint AS allotted,\
                 sum(al.picked_quantity)::bigint AS picked,\
                 sum(al.dispatched_quantity)::bigint AS dispatched,\
                 string_agg(DISTINCT al.source_pool_id, ', ') AS source \
                 FROM allotment a \
                 JOIN allotment_line al ON al.allotment_id = a.id \
                 LEFT JOIN site ON site.id = $2 \
                 WHERE a.id = $1 AND al.destination_id = $2 \
                 GROUP BY a.allotment_number, a.created_by, a.created_at, a.status, a.notes,\
                 a.type, site.name",
            )
            .bind(allotment_id)
            .bind(&destination)
            .fetch_optional(&mut *conn)
            .await?
            .ok_or_else(|| AppError::NotFound("allotment for that destination".into()))?;

            let lines = sqlx::query(
                "SELECT sk.sku_code, ar.name AS article_name, sk.color, sk.size,\
                 lower(ar.stock_unit_code) AS unit,\
                 sum(al.quantity)::bigint AS allotted,\
                 sum(al.picked_quantity)::bigint AS picked \
                 FROM allotment_line al \
                 JOIN sku sk ON sk.id = al.sku_id \
                 JOIN article ar ON ar.id = sk.article_id \
                 WHERE al.allotment_id = $1 AND al.destination_id = $2 \
                 GROUP BY sk.sku_code, ar.name, sk.color, sk.size, ar.stock_unit_code \
                 ORDER BY ar.name, sk.sku_code",
            )
            .bind(allotment_id)
            .bind(&destination)
            .fetch_all(&mut *conn)
            .await?;

            // The boxes going: head office allots in pieces, but once packed
            // the goods are handed over and counted by the koli, each holding
            // however many pieces went into it (owner, 2026-09-28). Empty
            // until the Gudang has packed.
            let koli = sqlx::query(
                "SELECT k.koli_id, k.koli_number, count(u.epc)::bigint AS pieces \
                 FROM edge_koli k \
                 JOIN edge_koli_unit u ON u.koli_id = k.koli_id \
                 WHERE u.allotment_id = $1 AND k.destination_store_id = $2 \
                   AND u.released_at IS NULL \
                 GROUP BY k.koli_id, k.koli_number, k.created_at \
                 ORDER BY k.created_at, k.koli_number",
            )
            .bind(allotment_id)
            .bind(&destination)
            .fetch_all(&mut *conn)
            .await?
            .iter()
            .map(|row| {
                let id: Uuid = row.get("koli_id");
                json!({
                    // A koli packed before its number travelled, and not
                    // moved since, is named by the start of its id.
                    "number": row
                        .get::<Option<String>, _>("koli_number")
                        .unwrap_or_else(|| id.simple().to_string()[..8].to_uppercase()),
                    "pieces": row.get::<i64, _>("pieces"),
                })
            })
            .collect::<Vec<_>>();

            let created_at: DateTime<Utc> = head.get("created_at");
            let allotted: i64 = head.get("allotted");
            let picked: i64 = head.get("picked");
            let facts = json!({
                "koli_count": koli.len(),
                "koli": koli,
                "reference": head.get::<String, _>("allotment_number"),
                "counterparty": head.get::<String, _>("store_name"),
                "counterparty_id": destination,
                "place": head.get::<String, _>("store_name"),
                "place_id": destination,
                "quantity": going(allotted, picked),
                "allotted": allotted,
                "picked": picked,
                "dispatched": head.get::<i64, _>("dispatched"),
                "source": head.get::<Option<String>, _>("source").unwrap_or_default(),
                "occurred_at": created_at,
                "raised_by": head.get::<String, _>("created_by"),
                "notes": head.get::<Option<String>, _>("notes").unwrap_or_default(),
            });

            let lines = lines
                .iter()
                .map(|row| {
                    let colour: Option<String> = row.get("color");
                    let size: Option<String> = row.get("size");
                    let variant = match (colour, size) {
                        (None, None) => None,
                        (colour, size) => Some(
                            [colour, size]
                                .into_iter()
                                .flatten()
                                .collect::<Vec<_>>()
                                .join(" · "),
                        ),
                    };
                    let allotted: i64 = row.get("allotted");
                    let picked: i64 = row.get("picked");
                    LetterLine {
                        description: row.get("article_name"),
                        code: row.get("sku_code"),
                        variant,
                        quantity: going(allotted, picked),
                        unit: row.get("unit"),
                        // The comparison column, and only where there is
                        // something to compare: a line picked short shows what
                        // the shop was allotted beside what is in the vehicle,
                        // and a line nobody has picked yet shows one figure
                        // rather than the same number twice.
                        ordered: if picked > 0 && picked != allotted {
                            Some(allotted)
                        } else {
                            None
                        },
                    }
                })
                .collect();
            Ok((facts, lines))
        }
    }
}

/// The fields only a person can answer, blank until they do.
///
/// Seeded ONCE, when the draft is started, and never part of `draw`. That is
/// not tidiness: issuing re-reads the record and merges it over the letter's
/// facts, so a blank `carrier` coming back out of the drawing would erase the
/// name somebody had typed at the exact moment they committed to it — which is
/// what it did, the first time this was tried.
fn written_blanks() -> Value {
    json!({ "carrier": "", "vehicle": "", "received_by": "" })
}

/// Start a letter against a record.
///
/// Nothing is numbered here. What this writes is a draft carrying a copy of
/// the record and an empty document for somebody to write in.
pub async fn draft_letter(
    pool: &PgPool,
    request: &NewLetter,
    author: &str,
) -> Result<Uuid, AppError> {
    let sort = sort_of(&request.kind)?;
    let letter_id = Uuid::new_v4();

    // A blank letter draws on nothing, names itself, and starts with the head
    // a person is going to type rather than with one read off a record.
    let form = match request.form.as_deref().filter(|key| !key.is_empty()) {
        Some(key) if sort.kind == "GENERAL" => Some(
            form_of(key)
                .ok_or_else(|| AppError::Validation(format!("unknown letter form: {key}")))?,
        ),
        Some(_) => {
            return Err(AppError::Validation(
                "only a written letter has a form".into(),
            ))
        }
        None => None,
    };

    let (subject_id, drawn, lines) = if sort.kind == "GENERAL" {
        let mut head = json!({ "reference": "", "counterparty": "", "place": "" });
        if let (Some(form), Some(fields)) = (form, head.as_object_mut()) {
            fields.insert("form".into(), json!(form.key));
            fields.insert("group".into(), json!(form.group));
        }
        (letter_id.to_string(), head, Vec::new())
    } else {
        let mut conn = pool.acquire().await?;
        let (drawn, lines) = draw(&mut conn, sort, &request.subject_id).await?;
        (request.subject_id.clone(), drawn, lines)
    };

    let mut facts = written_blanks();
    if let (Some(head), Some(drawn)) = (facts.as_object_mut(), drawn.as_object()) {
        for (key, value) in drawn {
            head.insert(key.clone(), value.clone());
        }
    }

    // A pattern, if somebody chose one. It lays its wording and its typed head
    // over the blanks — but never over what the RECORD said: a template
    // carrying "Kepada" would otherwise rename the supplier of a delivery it
    // knows nothing about. A blank letter has no record, so all of it applies.
    let mut body = json!({});
    if let Some(template_id) = request.template_id {
        let pattern = sqlx::query("SELECT body,facts FROM letter_template WHERE template_id = $1")
            .bind(template_id)
            .fetch_optional(pool)
            .await?
            .ok_or_else(|| AppError::NotFound("template".into()))?;
        body = pattern.get("body");
        let from_pattern: Value = pattern.get("facts");
        if let (Some(head), Some(pattern)) = (facts.as_object_mut(), from_pattern.as_object()) {
            for (key, value) in pattern {
                let record_owns =
                    sort.kind != "GENERAL" && matches!(key.as_str(), "reference" | "counterparty");
                if !record_owns {
                    head.insert(key.clone(), value.clone());
                }
            }
        }
    }

    sqlx::query(
        "INSERT INTO letter (letter_id,kind,status,subject_kind,subject_id,facts,lines,body,\
         title,created_by) VALUES ($1,$2,'DRAFT',$3,$4,$5,$6,$9,$7,$8)",
    )
    .bind(letter_id)
    .bind(sort.kind)
    .bind(sort.subject_kind)
    .bind(&subject_id)
    .bind(&facts)
    .bind(serde_json::to_value(&lines).unwrap_or_else(|_| json!([])))
    .bind(form.map_or(sort.title, |form| form.title))
    .bind(author)
    .bind(&body)
    .execute(pool)
    .await
    .map_err(|error| match error {
        sqlx::Error::Database(ref problem)
            if problem.constraint() == Some("ux_letter_live_subject") =>
        {
            AppError::Conflict("there is already a letter of this kind against that record".into())
        }
        other => other.into(),
    })?;

    Ok(letter_id)
}

/// Keep what somebody typed. Drafts only — an issued letter is evidence.
pub async fn save_letter(pool: &PgPool, id: Uuid, edit: &LetterEdit) -> Result<(), AppError> {
    let changed = sqlx::query(
        "UPDATE letter SET body = $2,\
         facts = CASE WHEN $3::jsonb IS NULL THEN facts ELSE facts || $3::jsonb END,\
         updated_at = now() \
         WHERE letter_id = $1 AND status = 'DRAFT'",
    )
    .bind(id)
    .bind(&edit.body)
    .bind(&edit.facts)
    .execute(pool)
    .await?
    .rows_affected();

    if changed == 0 {
        return Err(AppError::Conflict(
            "only a draft can be edited; an issued letter is voided and written again".into(),
        ));
    }
    Ok(())
}

/// Issue it: take the next number in the series and freeze what it says.
///
/// The number and the stamp are one transaction, so a failure anywhere leaves
/// the series exactly as it was. The counter row is the lock — two people
/// issuing into the same month queue on it rather than both reading `0004`.
pub async fn issue_letter(pool: &PgPool, id: Uuid, actor: &str) -> Result<String, AppError> {
    let letter = sqlx::query(
        "SELECT kind,status,subject_id,facts->>'form' AS form FROM letter WHERE letter_id = $1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound("letter".into()))?;

    let status: String = letter.get("status");
    if status != "DRAFT" {
        return Err(AppError::Conflict(format!(
            "a letter is issued once; this one is {status}"
        )));
    }
    let kind: String = letter.get("kind");
    let subject_id: String = letter.get("subject_id");
    let sort = sort_of(&kind)?;
    // A written form numbers in its own series and counts on its own row; a
    // blank letter stays on the `GENERAL` row it has always counted on, so the
    // SRT series carries on where it was.
    let form = if sort.kind == "GENERAL" {
        letter
            .get::<Option<String>, _>("form")
            .as_deref()
            .and_then(form_of)
    } else {
        None
    };
    let prefix = form.map_or(sort.prefix, |form| form.prefix);
    let series = match form {
        Some(form) if form.prefix != sort.prefix => format!("{}/{}", sort.kind, form.prefix),
        _ => kind,
    };

    // Read off the record as it stands NOW, outside the transaction that takes
    // the number: it is a read, and holding the counter row while it runs
    // would make every other issue wait for it.
    //
    // A blank letter has no record to re-read, and re-reading nothing would
    // wipe the head somebody typed. Its facts are already what they will be,
    // so issuing leaves them alone.
    let (facts, lines) = if sort.kind == "GENERAL" {
        (json!({}), Vec::new())
    } else {
        let mut conn = pool.acquire().await?;
        draw(&mut conn, sort, &subject_id).await?
    };

    let now = Utc::now();
    let period = format!("{:02}{:02}", now.year() % 100, now.month());

    let mut tx = pool.begin().await?;
    let next: i64 = sqlx::query_scalar(
        "INSERT INTO letter_number_counter (kind, period, next_number) VALUES ($1,$2,2) \
         ON CONFLICT (kind, period) \
         DO UPDATE SET next_number = letter_number_counter.next_number + 1 \
         RETURNING next_number - 1",
    )
    .bind(&series)
    .bind(&period)
    .fetch_one(&mut *tx)
    .await?;

    let number = format!("{}/{}/{:04}", prefix, period, next);

    let changed = sqlx::query(
        "UPDATE letter SET status='ISSUED', letter_number=$2, period=$3, issued_by=$4,\
         issued_at=now(), facts = facts || $5::jsonb,\
         lines = CASE WHEN $7 THEN lines ELSE $6 END, updated_at=now() \
         WHERE letter_id=$1 AND status='DRAFT'",
    )
    .bind(id)
    .bind(&number)
    .bind(&period)
    .bind(actor)
    .bind(&facts)
    .bind(serde_json::to_value(&lines).unwrap_or_else(|_| json!([])))
    // A blank letter keeps whatever table it has — which is none — rather than
    // having an empty one written over it by a redraw that did not happen.
    .bind(sort.kind == "GENERAL")
    .execute(&mut *tx)
    .await?
    .rows_affected();

    if changed == 0 {
        // Somebody else issued it between the check above and here. Rolling
        // back returns the number rather than spending it on nothing.
        tx.rollback().await?;
        return Err(AppError::Conflict(
            "this letter has just been issued".into(),
        ));
    }

    tx.commit().await?;
    Ok(number)
}

/// The surat a confirmed return to a supplier leaves behind, written onto the
/// transaction that writes the return.
///
/// There is no draft stage on this kind: Buying pressing Confirm on the return
/// IS the act of issuing the paper — the number is taken, the facts are frozen
/// and the letter is read-only in the same breath the return exists. A return
/// without its surat would be a delivery handed over with nothing for the
/// supplier to sign, so the two are one transaction: if the letter cannot be
/// written, the return was not confirmed.
///
/// A return voided after the fact gets a VOIDED letter, and voiding puts the
/// record back on `letter_sources`, so the paper can be written again.
pub async fn issue_supplier_return_letter(
    conn: &mut PgConnection,
    allotment_id: Uuid,
    actor: &str,
) -> Result<(Uuid, String), AppError> {
    let sort = sort_of("SUPPLIER_RETURN")?;
    let (facts, lines) = draw(&mut *conn, sort, &allotment_id.to_string()).await?;

    let now = Utc::now();
    let period = format!("{:02}{:02}", now.year() % 100, now.month());
    let next: i64 = sqlx::query_scalar(
        "INSERT INTO letter_number_counter (kind, period, next_number) VALUES ($1,$2,2) \
         ON CONFLICT (kind, period) \
         DO UPDATE SET next_number = letter_number_counter.next_number + 1 \
         RETURNING next_number - 1",
    )
    .bind(sort.kind)
    .bind(&period)
    .fetch_one(&mut *conn)
    .await?;
    let number = format!("{}/{}/{:04}", sort.prefix, period, next);

    let letter_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO letter (letter_id,kind,status,subject_kind,subject_id,facts,lines,body,\
         title,letter_number,period,issued_by,issued_at,created_by) \
         VALUES ($1,$2,'ISSUED',$3,$4,$5,$6,'{}',$7,$8,$9,$10,now(),$10)",
    )
    .bind(letter_id)
    .bind(sort.kind)
    .bind(sort.subject_kind)
    .bind(allotment_id.to_string())
    .bind(&facts)
    .bind(serde_json::to_value(&lines).unwrap_or_else(|_| json!([])))
    .bind(sort.title)
    .bind(&number)
    .bind(&period)
    .bind(actor)
    .execute(&mut *conn)
    .await?;

    Ok((letter_id, number))
}

/// Stop one. The number stays spent — see the migration.
pub async fn void_letter(
    pool: &PgPool,
    id: Uuid,
    actor: &str,
    request: &VoidLetter,
) -> Result<(), AppError> {
    let reason = request.reason.trim();
    if reason.is_empty() {
        return Err(AppError::Validation(
            "a letter is voided with a reason somebody can read later".into(),
        ));
    }

    let changed = sqlx::query(
        "UPDATE letter SET status='VOID', voided_by=$2, voided_at=now(), void_reason=$3,\
         updated_at=now() WHERE letter_id=$1 AND status='ISSUED'",
    )
    .bind(id)
    .bind(actor)
    .bind(reason)
    .execute(pool)
    .await?
    .rows_affected();

    if changed == 0 {
        return Err(AppError::Conflict(
            "only an issued letter can be voided; a draft is simply deleted".into(),
        ));
    }
    Ok(())
}

/// Throw a draft away. Nothing was numbered, so nothing is left behind.
pub async fn discard_letter(pool: &PgPool, id: Uuid) -> Result<(), AppError> {
    let changed = sqlx::query("DELETE FROM letter WHERE letter_id = $1 AND status = 'DRAFT'")
        .bind(id)
        .execute(pool)
        .await?
        .rows_affected();

    if changed == 0 {
        return Err(AppError::Conflict(
            "an issued letter is voided rather than deleted".into(),
        ));
    }
    Ok(())
}
