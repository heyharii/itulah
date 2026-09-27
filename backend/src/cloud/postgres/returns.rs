//! Post-completion customer returns. One transaction posts the return
//! document, the CUSTOMER_RETURN movements that bring the goods back into
//! the store (floor when sellable, reject when damaged), and the refund
//! tender rows — or nothing. The completed sale row itself is never touched:
//! finalized sales are immutable, and the return is its own document.

use super::{apply_lines, begin_idempotent, complete_idempotent, insert_group, payload_digest};
use crate::cloud::{
    application::{AppError, CreateReturnRequest, ReturnQuery},
    domain::{
        validate_command, validate_refund, MovementCause, MovementCommand, MovementGroupId,
        MovementLine, Place, SubjectId,
    },
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::{PgPool, Row};
use sqlx::{Postgres, Transaction};
use std::collections::BTreeMap;
use std::collections::HashSet;
use std::str::FromStr;
use uuid::Uuid;

pub async fn create_sale_return(
    pool: &PgPool,
    sale_id: Uuid,
    request: CreateReturnRequest,
) -> Result<Value, AppError> {
    if request.actor_id.trim().is_empty() {
        return Err(AppError::Validation("actor_id is required".into()));
    }
    if request.reason.trim().is_empty() {
        return Err(AppError::Validation("return reason is required".into()));
    }
    if request.lines.is_empty() {
        return Err(AppError::Validation(
            "return must contain at least one line".into(),
        ));
    }
    let mut seen = HashSet::new();
    for line in &request.lines {
        if !seen.insert(line.sale_line_id) {
            return Err(AppError::Validation("duplicate sale_line_id".into()));
        }
    }
    for refund in &request.refunds {
        if refund.amount_minor <= 0 {
            return Err(AppError::Validation(
                "refund amounts must be positive".into(),
            ));
        }
    }

    let digest = payload_digest(&request)?;
    let mut tx = pool.begin().await?;
    if let Some(response) = begin_idempotent(
        &mut tx,
        &request.idempotency_key,
        "CREATE_SALE_RETURN",
        &digest,
    )
    .await?
    {
        tx.commit().await?;
        return Ok(response);
    }

    let sale = sqlx::query(
        "SELECT id,sale_number,site_id,status,total_minor,customer_id FROM sale WHERE id=$1 FOR UPDATE",
    )
    .bind(sale_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound("sale".into()))?;
    let status: String = sale.get("status");
    if status != "COMPLETED" {
        return Err(AppError::Conflict(format!(
            "only COMPLETED sales can be returned, this sale is {status}"
        )));
    }
    // Owner decision 11 (25 Sep): a RETURN references its receipt at the same
    // store (the return is always booked at the sale's own site) and only
    // within Finance's window, default 7 days.
    let too_old: Option<i64> = sqlx::query_scalar(
        "SELECT COALESCE((SELECT round(value_numeric)::bigint FROM finance_setting
                           WHERE setting_key = 'return_window_days'), 7)
           FROM sale
          WHERE id = $1
            AND completed_at < now() - make_interval(days => COALESCE((
                    SELECT round(value_numeric)::int FROM finance_setting
                     WHERE setting_key = 'return_window_days'), 7))",
    )
    .bind(sale_id)
    .fetch_optional(&mut *tx)
    .await?;
    if let Some(window) = too_old {
        return Err(AppError::Conflict(format!(
            "this receipt is older than the {window}-day return window Finance allows"
        )));
    }
    let site_id: String = sale.get("site_id");
    let sale_number: String = sale.get("sale_number");
    let sale_total: i64 = sale.get("total_minor");
    // Who earned the points this return may have to take back. `None` is an
    // anonymous sale, and the result below says so out loud rather than
    // reversing nought quietly — see `POINTS_ANONYMOUS_SALE`.
    let customer_id: Option<String> = sale
        .get::<Option<String>, _>("customer_id")
        .map(|id| id.trim().to_owned())
        .filter(|id| !id.is_empty());

    let already_refunded: i64 =
        sqlx::query("SELECT COALESCE(SUM(refund_total_minor),0)::bigint total FROM sale_return WHERE sale_id=$1")
            .bind(sale_id)
            .fetch_one(&mut *tx)
            .await?
            .get("total");

    // Resolve and lock each returned line; V1 returns a line in full, and the
    // refund for it is exactly what the customer paid for it.
    let mut return_lines = Vec::with_capacity(request.lines.len());
    let mut refund_expected = 0_i64;
    for line in &request.lines {
        // `esl.points_earned` is the ORIGINAL SNAPSHOT — what the engine
        // allocated to THIS unit when it was sold, stored by 0166 — and it is
        // the only figure a reversal is allowed to read. Re-running today's
        // scheme over the returned goods, or taking a share of the basket
        // total, can both take back more points than the purchase ever gave.
        //
        // Read from `edge_sale_line` rather than copied onto `sale_line` first:
        // `sale_line_append_only` (0003) refuses every UPDATE to a sale line at
        // any status, so there is no moment at which the award could be moved
        // across. LEFT JOIN, because the shop's account of a sale may not be
        // here at all — and absent is `None`, which `plan_return_reversal`
        // reports rather than counts as nought.
        //
        // Joined on `(sale_id, subject_id)`: both models give one physical unit
        // one line and key it by subject, so the lines match on what was sold
        // rather than on the order somebody scanned it.
        let row = sqlx::query(
            "SELECT l.id,l.subject_id,l.sku_id,l.quantity,l.total_minor,esl.points_earned,subject.epc,\
             EXISTS(SELECT 1 FROM sale_return_line rl WHERE rl.sale_line_id=l.id) returned \
             FROM sale_line l JOIN inventory_subject subject ON subject.id=l.subject_id \
             LEFT JOIN edge_sale_line esl \
                    ON esl.sale_id=l.sale_id AND esl.subject_id=l.subject_id \
             WHERE l.id=$1 AND l.sale_id=$2 FOR UPDATE OF l",
        )
        .bind(line.sale_line_id)
        .bind(sale_id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| AppError::NotFound("sale line belonging to this sale".into()))?;
        if row.get::<bool, _>("returned") {
            return Err(AppError::Conflict(format!(
                "sale line {} was already returned",
                line.sale_line_id
            )));
        }
        refund_expected += row.get::<i64, _>("total_minor");
        return_lines.push((line.clone(), row));
    }

    let refund_total: i64 = request.refunds.iter().map(|r| r.amount_minor).sum();
    if refund_total != refund_expected {
        return Err(AppError::Conflict(format!(
            "refund total {refund_total} must equal the value of the returned goods {refund_expected}"
        )));
    }
    validate_refund(sale_total, already_refunded, refund_total)
        .map_err(|e| AppError::Conflict(e.to_string()))?;

    let return_id = Uuid::new_v4();
    let sequence = sqlx::query("SELECT nextval('sale_return_number_sequence')::bigint sequence")
        .fetch_one(&mut *tx)
        .await?
        .get::<i64, _>("sequence");
    let return_number = format!("RTN-{sequence:08}");

    // Movements: customer -> floor (sellable) or customer -> reject (damaged).
    let source: Place = "external/customer"
        .parse()
        .map_err(|e: crate::cloud::domain::PlaceError| AppError::Validation(e.to_string()))?;
    let mut movement_lines = Vec::with_capacity(return_lines.len());
    for (input, row) in &return_lines {
        let destination_place = if input.restock {
            format!("{site_id}.floor:on_hand")
        } else {
            format!("{site_id}.reject:on_hand")
        };
        let destination: Place = destination_place
            .parse()
            .map_err(|e: crate::cloud::domain::PlaceError| AppError::Validation(e.to_string()))?;
        movement_lines.push(MovementLine {
            subject_id: SubjectId(row.get("subject_id")),
            quantity: row.get("quantity"),
            from: source.clone(),
            to: destination,
        });
    }
    movement_lines.sort_by_key(|line| line.subject_id.0);
    let movement_group_id = MovementGroupId::new();
    let now = Utc::now();
    let command = MovementCommand {
        movement_group_id,
        lines: movement_lines,
        cause: MovementCause::CustomerReturn,
        reference_type: Some("SALE_RETURN".into()),
        reference_id: Some(return_id.to_string()),
        reason: format!("Customer return {return_number} for sale {sale_number}"),
        actor_id: request.actor_id.trim().into(),
        occurred_at: now,
    };
    validate_command(&command).map_err(|e| AppError::Validation(e.to_string()))?;
    // Namespaced so a client key can never collide with another command's
    // derived movement key.
    let movement_key = format!("sale-return:{}:inventory", request.idempotency_key);
    insert_group(&mut tx, &command, &movement_key, &digest).await?;
    let movement_ids = apply_lines(&mut tx, &command, &movement_key, &digest).await?;

    sqlx::query(
        "INSERT INTO sale_return(id,return_number,sale_id,site_id,reason,refund_total_minor,\
         movement_group_id,actor_id,idempotency_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
    )
    .bind(return_id)
    .bind(&return_number)
    .bind(sale_id)
    .bind(&site_id)
    .bind(request.reason.trim())
    .bind(refund_total)
    .bind(movement_group_id.0)
    .bind(request.actor_id.trim())
    .bind(&request.idempotency_key)
    .execute(&mut *tx)
    .await?;

    let mut line_values = Vec::with_capacity(return_lines.len());
    for (input, row) in &return_lines {
        let line_id = Uuid::new_v4();
        let line_total: i64 = row.get("total_minor");
        sqlx::query(
            "INSERT INTO sale_return_line(id,return_id,sale_line_id,subject_id,sku_id,quantity,\
             refund_minor,restock) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
        )
        .bind(line_id)
        .bind(return_id)
        .bind(input.sale_line_id)
        .bind(row.get::<Uuid, _>("subject_id"))
        .bind(row.get::<Uuid, _>("sku_id"))
        .bind(row.get::<i64, _>("quantity"))
        .bind(line_total)
        .bind(input.restock)
        .execute(&mut *tx)
        .await?;
        line_values.push(json!({
            "id": line_id,
            "sale_line_id": input.sale_line_id,
            "epc": row.get::<Option<String>,_>("epc"),
            "quantity": row.get::<i64,_>("quantity"),
            "refund_minor": line_total,
            "restock": input.restock,
        }));
    }

    // ── the refund, split by the server rather than taken from the caller ──
    //
    // Money goes back where it came from. The caller says WHAT is being
    // returned; how much of it lands on the voucher and how much on the card is
    // arithmetic over the original tenders and their remaining capacity, and it
    // is not a number a till may assert. See `crate::refund`.
    let allocation = allocate_refund(&mut tx, sale_id, refund_total).await?;

    // A caller that also sent figures is checked against them rather than
    // ignored: if it agreed, nothing changes for it; if it did not, it is told
    // the right answer instead of having its request silently rewritten.
    if !request.refunds.is_empty() {
        let mut asked: BTreeMap<&str, i64> = BTreeMap::new();
        for refund in &request.refunds {
            *asked.entry(refund.method.as_str()).or_default() += refund.amount_minor;
        }
        let mut computed: BTreeMap<&str, i64> = BTreeMap::new();
        for share in &allocation {
            *computed.entry(share.method.as_str()).or_default() += share.amount_minor;
        }
        if asked != computed {
            return Err(AppError::Validation(format!(
                "the refund splits across the tenders that paid, and this sale allocates \
                 {computed:?} rather than {asked:?} — send no refunds and let the server \
                 allocate, or send these"
            )));
        }
    }

    for share in &allocation {
        sqlx::query(
            "INSERT INTO sale_return_payment
                 (id,return_id,method,amount_minor,reference,original_tender_id,status,
                  acquirer,card_kind)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        )
        .bind(Uuid::new_v4())
        .bind(return_id)
        .bind(share.method.as_str())
        .bind(share.amount_minor)
        .bind(share.reference.as_deref())
        .bind(share.tender_id)
        // Accepted, not yet returned. A card refund is not money back until the
        // network says so, and a return that reported SUCCEEDED the moment it
        // was accepted is how a shop tells a customer their money is on its way
        // when nothing has been sent.
        .bind("PENDING")
        .bind(share.acquirer.as_deref())
        .bind(share.card_kind.as_deref())
        .execute(&mut *tx)
        .await?;
    }

    // ── the points the return takes back ────────────────────────────────────
    //
    // `reverse_for_return` has existed and been correct since 0165 and could
    // not be reached from here: it needs a member to debit, and `sale` — the
    // model `sale_return.sale_id` points at — had no column naming one. So
    // every award landed and no reversal ever did. 0177 is that column.
    //
    // Read from the SNAPSHOT each line carries, scoped to the units actually
    // coming back. A return of one of two shoes takes back what that shoe was
    // awarded, not half the receipt and not what it would earn if sold this
    // morning. See `plan_return_reversal`, where the arithmetic lives with no
    // database under it.
    //
    // Idempotent on the return, through the partial unique index
    // `ux_points_ledger_reversal (return_id) WHERE entry_type='RETURN_REVERSAL'`
    // that 0165 already created for exactly this. A second mechanism here —
    // a prior read, a marker column — would be a second opinion about the same
    // question, and this estate has been bitten by that shape before.
    let plan = super::loyalty::plan_return_reversal(
        &return_lines
            .iter()
            .map(|(input, row)| super::loyalty::LineAward {
                sale_line_id: input.sale_line_id,
                points_earned: row.get::<Option<i64>, _>("points_earned"),
            })
            .collect::<Vec<_>>(),
    );
    let points_status = match customer_id.as_deref() {
        // Not a bug and not a silent skip. A sale nobody was recorded against
        // has no account to debit, and saying nothing here is how a scheme
        // leaks: the awards would still be landing on the sales that DO name a
        // shopper, and only the reversals would be missing.
        None => "ANONYMOUS_SALE",
        Some(customer) if plan.points > 0 => {
            match super::loyalty::reverse_for_return(
                &mut tx,
                customer,
                return_id,
                plan.points,
                request.actor_id.trim(),
            )
            .await?
            {
                Some(_) => "REVERSED",
                // The index refused a second entry for this return. A fresh
                // `return_id` cannot collide, so reaching this means a replay
                // that got past the idempotency guard above — correct, and
                // worth being able to see rather than indistinguishable from a
                // reversal that just happened.
                None => "ALREADY_REVERSED",
            }
        }
        // A member, and nothing to take back. Two different reasons, kept
        // apart: goods that genuinely earned nothing, versus lines whose award
        // was never recorded at all and which a person has to settle.
        Some(_) if plan.unrecorded.is_empty() => "NOTHING_EARNED",
        Some(_) => "NOTHING_RECORDED",
    };

    let response = json!({
        "id": return_id,
        "return_number": return_number,
        "sale_id": sale_id,
        "sale_number": sale_number,
        "site_id": site_id,
        "status": "COMPLETED",
        "reason": request.reason.trim(),
        "refund_total_minor": refund_total,
        "refunds": allocation.iter().map(|share| json!({
            "method": share.method.as_str(),
            "amount_minor": share.amount_minor,
            "reference": share.reference,
            "original_tender_id": share.tender_id,
            "status": "PENDING",
        })).collect::<Vec<_>>(),
        "lines": line_values,
        // What happened to the member's balance, stated whether or not anything
        // did. A caller that has to infer "nothing was reversed" from an absent
        // field cannot tell it apart from a build that never reversed at all.
        "points": {
            "customer_id": customer_id,
            "status": points_status,
            "reversed": if points_status == "REVERSED" { plan.points } else { 0 },
            // The lines this return could not answer for: sold before an award
            // was recorded per line, or through a path that records none. Named
            // so somebody can settle them, rather than counted as nought.
            "lines_without_recorded_award": plan.unrecorded,
        },
        "movement_group_id": movement_group_id.0,
        "movement_ids": movement_ids,
        "created_at": now,
    });
    complete_idempotent(&mut tx, &request.idempotency_key, &response).await?;
    tx.commit().await?;
    Ok(response)
}

pub async fn get_sale_return(pool: &PgPool, return_id: Uuid) -> Result<Value, AppError> {
    let header = sqlx::query(
        "SELECT r.id,r.return_number,r.sale_id,s.sale_number,r.site_id,r.reason,\
         r.refund_total_minor,r.movement_group_id,r.actor_id,r.created_at \
         FROM sale_return r JOIN sale s ON s.id=r.sale_id WHERE r.id=$1",
    )
    .bind(return_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound("sale return".into()))?;
    let lines = sqlx::query(
        "SELECT rl.id,rl.sale_line_id,rl.quantity,rl.refund_minor,rl.restock,\
         subject.epc,sk.sku_code,ar.name article_name \
         FROM sale_return_line rl \
         JOIN inventory_subject subject ON subject.id=rl.subject_id \
         JOIN sku sk ON sk.id=rl.sku_id \
         JOIN article ar ON ar.id=sk.article_id \
         WHERE rl.return_id=$1 ORDER BY sk.sku_code",
    )
    .bind(return_id)
    .fetch_all(pool)
    .await?;
    let refunds = sqlx::query(
        "SELECT method,amount_minor,reference FROM sale_return_payment WHERE return_id=$1",
    )
    .bind(return_id)
    .fetch_all(pool)
    .await?;
    Ok(json!({
        "id": header.get::<Uuid,_>("id"),
        "return_number": header.get::<String,_>("return_number"),
        "sale_id": header.get::<Uuid,_>("sale_id"),
        "sale_number": header.get::<String,_>("sale_number"),
        "site_id": header.get::<String,_>("site_id"),
        "reason": header.get::<String,_>("reason"),
        "refund_total_minor": header.get::<i64,_>("refund_total_minor"),
        "movement_group_id": header.get::<Uuid,_>("movement_group_id"),
        "actor_id": header.get::<String,_>("actor_id"),
        "created_at": header.get::<DateTime<Utc>,_>("created_at"),
        "lines": lines.iter().map(|row| json!({
            "id": row.get::<Uuid,_>("id"),
            "sale_line_id": row.get::<Uuid,_>("sale_line_id"),
            "sku_code": row.get::<String,_>("sku_code"),
            "article_name": row.get::<String,_>("article_name"),
            "epc": row.get::<Option<String>,_>("epc"),
            "quantity": row.get::<i64,_>("quantity"),
            "refund_minor": row.get::<i64,_>("refund_minor"),
            "restock": row.get::<bool,_>("restock"),
        })).collect::<Vec<_>>(),
        "refunds": refunds.iter().map(|row| json!({
            "method": row.get::<String,_>("method"),
            "amount_minor": row.get::<i64,_>("amount_minor"),
            "reference": row.get::<Option<String>,_>("reference"),
        })).collect::<Vec<_>>(),
    }))
}

/// One refund, as the list shows it.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SaleReturnRow {
    pub id: Uuid,
    pub return_number: String,
    pub sale_id: Uuid,
    pub sale_number: String,
    pub site_id: String,
    pub reason: String,
    pub refund_total_minor: i64,
    /// Who took it back — a cashier's login, not a shopper's anything. The one
    /// identifier on this row that names a person, and it names a colleague.
    pub actor_id: String,
    pub created_at: DateTime<Utc>,
}

/// One value a filter can take, and how many refunds would still be there.
/// Counted over what the SEARCH leaves, ignoring the filters currently applied.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SaleReturnFacet {
    pub value: String,
    pub label: Option<String>,
    pub count: i64,
    /// What those refunds came to. A count alone says how OFTEN a shop refunds
    /// and never how much, and on this list the second question is the one
    /// somebody is actually asking.
    pub refund_total_minor: i64,
}

/// The closed sets the returns list can be narrowed by, each counted.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SaleReturnFacets {
    pub sites: Vec<SaleReturnFacet>,
    pub reasons: Vec<SaleReturnFacet>,
    // Who took the refunds — the people standing at the counters. A plain
    // comment rather than a doc comment, so the generated binding stays the
    // one-line shape its siblings have.
    pub actors: Vec<SaleReturnFacet>,
}

/// A page of refunds, and the shape of everything it was drawn from.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SaleReturnList {
    pub rows: Vec<SaleReturnRow>,
    /// Opaque. Pass it back as `cursor`; absent means this was the last page.
    pub next_cursor: Option<String>,
    /// Every refund the search and the filters match, not just this page.
    pub total: i64,
    /// What the whole matched set came to — not just this page. The number the
    /// storeops roll-up was computing in the browser over whatever hundred rows
    /// it happened to hold, which is a sum of the page.
    pub refund_total_minor: i64,
    pub facets: SaleReturnFacets,
}

/// Where the previous page stopped — as a ROW, not a position.
#[derive(Serialize, Deserialize)]
struct SaleReturnCursor {
    id: Uuid,
}

impl SaleReturnCursor {
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

const RETURNS_DEFAULT_LIMIT: i64 = 100;
const RETURNS_MAX_LIMIT: i64 = 500;

/// One refund row, defined once.
///
/// Used by the page query and by the facet counts, which is the whole reason it
/// is a constant: the facets are only honest if they count exactly what the
/// page can show.
///
/// It stops at the SEARCH. The site and reason filters are applied outside by
/// each caller, so one definition answers two questions — the page wants what
/// the filters leave, the filter panel wants what the search alone leaves.
///
/// Every column a sort can name is NOT NULL — `created_at`, `return_number`,
/// `refund_total_minor`, `site_id` — so no `COALESCE` sentinel is needed. Worth
/// stating rather than rediscovering: a row comparison against NULL is NULL
/// rather than true, so a nullable sort key added here would end paging at the
/// first NULL, in silence.
///
/// Binds: `$1` the search pattern or NULL.
const RETURN_ROWS: &str = "
    SELECT r.id, r.return_number, r.sale_id, s.sale_number, r.site_id, r.reason,
           r.refund_total_minor, r.actor_id, r.created_at
      FROM sale_return r
      JOIN sale s ON s.id = r.sale_id
     WHERE ($1::text IS NULL
            OR r.return_number ILIKE $1
            OR s.sale_number ILIKE $1
            OR r.reason ILIKE $1)
";

/// Every filter, in one place, so the page and the total cannot drift.
///
/// Binds `$2`..`$8`, contiguous after the search, so the facet query — which
/// binds exactly these and nothing after — never leaves a parameter PostgreSQL
/// cannot type. The page query's own cursor and limit come after them.
const RETURN_FILTERS: &str = "
    WHERE ($2::text IS NULL OR site_id = $2)
      AND ($3::text IS NULL OR reason = $3)
      AND ($4::text IS NULL OR actor_id = $4)
      AND ($5::timestamptz IS NULL OR created_at >= $5)
      AND ($6::timestamptz IS NULL OR created_at < $6)
      AND ($7::bigint IS NULL OR refund_total_minor >= $7)
      AND ($8::bigint IS NULL OR refund_total_minor <= $8)
";

/// Refunds, one page at a time, beside the shape of the whole answer.
///
/// Brought up to the shape `list_employees` sets: a scope struct in, an
/// envelope out, a keyset over a named sort, and facet counts drawn from the
/// same row definition the page is.
pub async fn list_sale_returns(
    pool: &PgPool,
    query: ReturnQuery,
) -> Result<SaleReturnList, AppError> {
    let limit = query
        .limit
        .unwrap_or(RETURNS_DEFAULT_LIMIT)
        .clamp(1, RETURNS_MAX_LIMIT);
    let site = query
        .site_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned);
    // A blank search is not a search: `Some("")` compiles to `ILIKE '%%'`,
    // which matches everything and costs a scan to say so.
    let needle = query
        .q
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| format!("%{value}%"));
    let reason = query
        .reason
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned);
    let actor = query
        .actor_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned);
    // Local business days, turned into the instants that bound them here
    // rather than in SQL, by the same arithmetic the sales reports use — so
    // "refunds on the 3rd" and "sales on the 3rd" are the same Tuesday.
    let offset = crate::reporting::DEFAULT_UTC_OFFSET_MINUTES;
    let from_at = query
        .from
        .map(|day| crate::reporting::window_of(day, day, offset).map(|(start, _)| start))
        .transpose()
        .map_err(AppError::Validation)?;
    let to_at = query
        .to
        .map(|day| crate::reporting::window_of(day, day, offset).map(|(_, end)| end))
        .transpose()
        .map_err(AppError::Validation)?;

    // The sort, and the tie-break that makes it total. Every order ends in the
    // return's id, which is the primary key, so no two rows can compare equal —
    // which is what stops a keyset repeating or losing the rows that tie.
    //
    // TWO spellings of the same thing, and they are not interchangeable:
    // `ORDER BY` takes directions, a ROW EXPRESSION does not.
    let lead = match query.sort.as_deref() {
        Some("number") => "return_number",
        Some("refund") => "refund_total_minor",
        Some("site") => "site_id",
        _ => "created_at",
    };
    let descending = query.dir.as_deref() != Some("asc");
    let cols = format!("{lead}, id");
    let dir = if descending { "DESC" } else { "ASC" };
    let order = format!("{lead} {dir}, id {dir}");
    let seek = if descending { "<" } else { ">" };

    let cursor = query
        .cursor
        .as_deref()
        .map(SaleReturnCursor::decode)
        .transpose()?;

    // The seek re-reads the previous row's own sort value rather than trusting
    // one encoded in the cursor. A cursor whose row the filters no longer keep
    // finds nothing to compare against, so the page comes back empty: the list
    // ends early rather than starting again, and stopping is visible.
    // `NOT MATERIALIZED`: `kept` is referenced twice — as the page and
    // inside the seek — and two references makes PostgreSQL materialise a
    // CTE, which is an optimisation fence the `ORDER BY … LIMIT` cannot be
    // pushed through. Materialised, this reads the whole table and sorts it
    // to hand back one page; inlined, it seeks the index. See
    // `postgres::audit::list_audit`, where the difference was measured.
    let sql = format!(
        "WITH searched AS NOT MATERIALIZED ({RETURN_ROWS}),
              kept AS NOT MATERIALIZED (
             SELECT * FROM searched {RETURN_FILTERS}
         )
         SELECT * FROM kept
          WHERE $9::uuid IS NULL
             OR ({cols}) {seek} (SELECT {cols} FROM kept WHERE id = $9)
          ORDER BY {order}
          LIMIT $10"
    );
    let rows = sqlx::query(&sql)
        .bind(&needle)
        .bind(&site)
        .bind(&reason)
        .bind(&actor)
        .bind(from_at)
        .bind(to_at)
        .bind(query.min_refund)
        .bind(query.max_refund)
        .bind(cursor.as_ref().map(|one| one.id))
        .bind(limit)
        .fetch_all(pool)
        .await?;

    // A short page is the last page. A full one may not be — the next request
    // can come back empty — and that is the honest answer.
    let next_cursor = match rows.last() {
        Some(row) if rows.len() as i64 == limit => Some(
            SaleReturnCursor {
                id: row.try_get("id")?,
            }
            .encode()?,
        ),
        _ => None,
    };

    let out = rows
        .iter()
        .map(|row| {
            Ok(SaleReturnRow {
                id: row.try_get("id")?,
                return_number: row.try_get("return_number")?,
                sale_id: row.try_get("sale_id")?,
                sale_number: row.try_get("sale_number")?,
                site_id: row.try_get("site_id")?,
                reason: row.try_get("reason")?,
                refund_total_minor: row.try_get("refund_total_minor")?,
                actor_id: row.try_get("actor_id")?,
                created_at: row.try_get("created_at")?,
            })
        })
        .collect::<Result<Vec<_>, AppError>>()?;

    // Per-value counts read the SEARCHED set, ignoring what is filtered — the
    // number beside a shop answers "how much does this shop refund", which is
    // the question somebody has while choosing. The total reads the FILTERED
    // set, because it describes the list on screen.
    let counted = sqlx::query(&format!(
        "WITH searched AS ({RETURN_ROWS}), kept AS (
             SELECT * FROM searched {RETURN_FILTERS}
         )
         SELECT 'site' AS facet, site_id AS value, COUNT(*)::bigint AS n,
                COALESCE(SUM(refund_total_minor), 0)::bigint AS refunded
           FROM searched GROUP BY site_id
          UNION ALL
         SELECT 'reason', reason, COUNT(*)::bigint,
                COALESCE(SUM(refund_total_minor), 0)::bigint
           FROM searched GROUP BY reason
          UNION ALL
         SELECT 'actor', actor_id, COUNT(*)::bigint,
                COALESCE(SUM(refund_total_minor), 0)::bigint
           FROM searched GROUP BY actor_id
          UNION ALL
         SELECT 'all', '', COUNT(*)::bigint,
                COALESCE(SUM(refund_total_minor), 0)::bigint
           FROM kept"
    ))
    .bind(&needle)
    .bind(&site)
    .bind(&reason)
    .bind(&actor)
    .bind(from_at)
    .bind(to_at)
    .bind(query.min_refund)
    .bind(query.max_refund)
    .fetch_all(pool)
    .await?;

    let mut total = 0i64;
    let mut refunded = 0i64;
    let (mut sites, mut reasons, mut actors) = (Vec::new(), Vec::new(), Vec::new());
    for row in &counted {
        let facet: String = row.try_get("facet")?;
        let one = SaleReturnFacet {
            value: row.try_get("value")?,
            label: None,
            count: row.try_get("n")?,
            refund_total_minor: row.try_get("refunded")?,
        };
        match facet.as_str() {
            "site" => sites.push(one),
            "reason" => reasons.push(one),
            "actor" => actors.push(one),
            _ => {
                total = one.count;
                refunded = one.refund_total_minor;
            }
        }
    }
    // Biggest first, with ties broken on the value so the order is stable
    // between calls — a filter list that reshuffles under the cursor is one
    // nobody can click.
    for list in [&mut sites, &mut reasons, &mut actors] {
        list.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.value.cmp(&b.value)));
    }

    Ok(SaleReturnList {
        rows: out,
        next_cursor,
        total,
        refund_total_minor: refunded,
        facets: SaleReturnFacets {
            sites,
            reasons,
            actors,
        },
    })
}

/// One tender's share of a refund, and what it is going back to.
pub struct RefundShare {
    pub tender_id: Uuid,
    pub method: crate::tender::PaymentMethod,
    pub amount_minor: i64,
    pub reference: Option<String>,
    pub acquirer: Option<String>,
    pub card_kind: Option<String>,
}

/// Split a refund across the tenders that paid for the sale, by what each has
/// left to give back.
///
/// The capacity subtraction is decision K04: an allocation already committed
/// counts against its tender even while the provider call is pending or has
/// failed and is still to be retried. Only a CANCELLED allocation gives its
/// capacity back. Subtracting successful refunds alone would let a second
/// return promise the same rupiah while the first was still in flight.
///
/// `FOR UPDATE` on the tender rows, so two returns of one sale accepted at the
/// same moment cannot both read the same remaining balance — the invariant this
/// exists to hold is exactly the one two concurrent readers would break.
async fn allocate_refund(
    tx: &mut Transaction<'_, Postgres>,
    sale_id: Uuid,
    amount_minor: i64,
) -> Result<Vec<RefundShare>, AppError> {
    // `sale_payment`, not `edge_sale_tender`. There are two sale models here —
    // the centre's own (`sale`, what `sale_return.sale_id` points at) and the
    // one synced up from a till (`edge_sale`) — and a return is against the
    // first. Reading the second would have found no tenders at all for every
    // sale a return can actually be made against.
    //
    // `id` stands in for a sequence: `sale_payment` has no ordinal, so the
    // allocation's stable order is the payment's own id. Stable is what the
    // tie-break needs; consecutive is not.
    let tenders = sqlx::query(
        "SELECT t.id, t.method, t.amount_minor, t.reference, t.acquirer, t.card_kind,
                COALESCE((
                    SELECT sum(p.amount_minor)
                      FROM sale_return_payment p
                      JOIN sale_return r ON r.id = p.return_id
                     WHERE r.sale_id = t.sale_id
                       AND p.original_tender_id = t.id
                       AND p.status <> 'CANCELLED'
                ), 0)::bigint AS committed_minor
           FROM sale_payment t
          WHERE t.sale_id = $1
          ORDER BY t.id
          FOR UPDATE OF t",
    )
    .bind(sale_id)
    .fetch_all(&mut **tx)
    .await?;

    if tenders.is_empty() {
        // A sale with no recorded tender — one taken before tenders were stored
        // per method. There is nothing to split by, and inventing a split would
        // put money back somewhere nobody paid from.
        return Err(AppError::Validation(
            "this sale has no recorded tenders, so a refund cannot be allocated back to them"
                .into(),
        ));
    }

    let capacities: Vec<crate::refund::Capacity> = tenders
        .iter()
        .map(|row| crate::refund::Capacity {
            original_minor: row.get::<i64, _>("amount_minor"),
            committed_minor: row.get::<i64, _>("committed_minor"),
        })
        .collect();

    let shares = crate::refund::allocate(&capacities, amount_minor)
        .map_err(|error| AppError::Validation(error.to_string()))?;

    let mut out = Vec::new();
    for (row, share) in tenders.iter().zip(shares) {
        if share == 0 {
            // A tender with nothing left to give takes no row. An allocation of
            // nought is not a refund, and one per tender would leave a trail of
            // empty obligations for a reconciler to chase.
            continue;
        }
        let method: String = row.get("method");
        out.push(RefundShare {
            tender_id: row.get("id"),
            method: crate::tender::PaymentMethod::from_str(&method)
                .map_err(|error| AppError::Validation(error.to_string()))?,
            amount_minor: share,
            reference: row.get("reference"),
            acquirer: row.get("acquirer"),
            card_kind: row.get("card_kind"),
        });
    }
    Ok(out)
}
