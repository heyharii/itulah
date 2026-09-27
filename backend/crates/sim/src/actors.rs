//! The personas of the PO smoke lane (SIMULATION-SCENARIOS-PO.md §8.1) and
//! the discrete-event loop that drives them.
//!
//! Every actor is a person with a name: the buyer at head office, the bay
//! clerk who counts a lorry, the verifier who accepts it — a second person on
//! purpose — and the finance clerk who books and pays the bill. Each acts
//! only through the node they would really work at, only through the API.
//! Time does not flow; it JUMPS: the loop takes the earliest scheduled beat,
//! advances the virtual clock to it, and asks that actor to decide.

use crate::clock::SimClock;
use crate::client::{call, call_idem, peek, Expect, Node, Nodes, Recorder, SimError, SimResult};
use crate::scenario::Scenario;
use chrono::Datelike;
use serde_json::{json, Value};

/// Cloud audit actor injected by the auth-disabled middleware; the wire never
/// carries an actor field on cloud endpoints.
const CLOUD: &str = "buyer@ho";

/// Product gaps the run exercises and pins, reported with the summary so a
/// green run never hides them.
const FINDINGS: [&str; 1] = [
    "payment cannot post: POST /api/v1/finance/payments/{id}/post is refused by the finance \
     posting pause — migration 0352 allowlists Sales and Inventory source kinds only, and no \
     route exists that lets Finance allow PAYMENT, so the recorded payment stays DRAFT",
];

/// The bay clerk who counts what arrived.
const COUNTER: &str = "penghitung-dc";
/// The second person who accepts the count. The control is the DIFFERENCE.
const VERIFIER: &str = "pemeriksa-dc";

/// Everything the run's story has produced, in natural keys — the world model
/// of this lane. Server-generated UUIDs are kept only where a later call must
/// reference them; the report speaks in codes and numbers a human can check.
#[derive(Default)]
pub struct World {
    seed: u64,
    supplier_id: String,
    supplier_item_ids: Vec<(String, String)>, // (code, uuid)
    po_number: String,
    po_id: String,
    po_net_minor: i64,
    ordered_total: i64,
    receipt_number: String,
    cloud_receipt_id: String,
    invoice_number: String,
    invoice_total_minor: i64,
    bill_id: String,
    bill_status: String,
    payment_id: String,
    payment_status: String,
    po_lifecycle: String,
    accepted_total: i64,
}

/// The beats of the buying week. Day offsets are business days from the
/// Monday the scenario starts on.
enum Beat {
    Bootstrap,
    OpenPo,
    OpenReceipt,
    CountAndVerify,
    RecordInvoice,
    Settle,
    Audit,
}

pub async fn run_scenario(
    scenario: &Scenario,
    seed: u64,
    nodes: &Nodes,
    rec: &mut Recorder,
    clock: &mut SimClock,
) -> SimResult<Value> {
    let monday = clock.today_local();
    let mut world = World {
        seed,
        po_number: format!("PO-SIM-{seed}-W01"),
        invoice_number: format!("INV-SIM-{seed}-W01"),
        ordered_total: scenario.topology.order_qty.iter().sum(),
        ..World::default()
    };

    // (day offset, hour, minute, beat) — the calendar of one buying week.
    let beats: [(u32, u32, u32, Beat); 7] = [
        (0, 8, 0, Beat::Bootstrap),
        (0, 9, 0, Beat::OpenPo),
        (2, 8, 0, Beat::OpenReceipt),
        (2, 8, 20, Beat::CountAndVerify),
        (2, 8, 45, Beat::RecordInvoice),
        (4, 16, 0, Beat::Settle),
        (4, 17, 0, Beat::Audit),
    ];
    let horizon = clock.at_local(
        monday + chrono::Duration::days(i64::from(scenario.clock.days)),
        23,
        59,
    );

    let mut scheduled: Vec<(chrono::DateTime<chrono::Utc>, usize)> = beats
        .iter()
        .enumerate()
        .map(|(i, (days, hour, minute, _))| (clock.at_local(monday + chrono::Duration::days(i64::from(*days)), *hour, *minute), i))
        .collect();
    scheduled.sort_by_key(|(at, _)| *at);

    for (at, beat_index) in scheduled {
        if at >= horizon {
            break;
        }
        clock.advance_to(at);
        match &beats[beat_index].3 {
            Beat::Bootstrap => bootstrap(scenario, nodes, rec, clock, &mut world).await?,
            Beat::OpenPo => open_po(scenario, nodes, rec, clock, &mut world).await?,
            Beat::OpenReceipt => open_receipt(nodes, rec, clock, &mut world).await?,
            Beat::CountAndVerify => count_and_verify(scenario, nodes, rec, clock, &mut world).await?,
            Beat::RecordInvoice => record_invoice(scenario, nodes, rec, clock, &mut world).await?,
            Beat::Settle => settle(scenario, nodes, rec, clock, &mut world).await?,
            Beat::Audit => audit(nodes, rec, clock, &mut world).await?,
        }
    }

    Ok(json!({
        "supplier_id": world.supplier_id,
        "po_number": world.po_number,
        "po_lifecycle": world.po_lifecycle,
        "ordered_total": world.ordered_total,
        "accepted_total": world.accepted_total,
        "receipt_number": world.receipt_number,
        "invoice_number": world.invoice_number,
        "invoice_total_minor": world.invoice_total_minor,
        "bill_status": world.bill_status,
        "payment_status": world.payment_status,
        "intent_failures": rec.failures,
        "intents_total": rec.total,
        "findings": FINDINGS,
    }))
}

// ── beats ─────────────────────────────────────────────────────────────────────

/// The buyer registers the supplier and its three items through the sourcing
/// catalogue — the honest bootstrap: master data is born through the API or
/// not at all (P1). Status defaults to ACTIVE; the catalogue is then real.
async fn bootstrap(
    scenario: &Scenario,
    nodes: &Nodes,
    rec: &mut Recorder,
    clock: &SimClock,
    world: &mut World,
) -> SimResult<()> {
    let supplier = call_idem(
        nodes, rec, clock, CLOUD, Node::Cloud, "POST", "/api/v1/suppliers",
        json!({
            "supplier_code": scenario.topology.supplier,
            "name": format!("{} (rig)", scenario.topology.supplier),
            "category": "MERCHANDISE",
            "default_payment_terms_code": "COD",
        }),
        &format!("sim-{}-supplier", world.seed),
        Expect::Success,
    )
    .await?;
    world.supplier_id = str_field(&supplier, "supplier_id", "supplier")?;

    for (code, price) in scenario
        .topology
        .supplier_items
        .iter()
        .zip([25_000_i64, 18_500, 42_000].iter().cycle())
    {
        let item = call_idem(
            nodes, rec, clock, CLOUD, Node::Cloud, "POST",
            &format!("/api/v1/suppliers/{}/items", world.supplier_id),
            json!({
                "supplier_item_code": code,
                "name": format!("Artikel {code}"),
                "unit_price_minor": price,
                "status": "ACTIVE",
            }),
            &format!("sim-{}-item-{code}", world.seed),
            Expect::Success,
        )
        .await?;
        world.supplier_item_ids.push((
            code.clone(),
            str_field(&item, "supplier_item_id", "supplier item")?,
        ));
    }
    Ok(())
}

/// Monday 09:00 — the buyer raises the catalog PO. The activation command
/// rides to the DC inside the response's own transaction; when it arrives is
/// the sync's business, not the buyer's.
async fn open_po(
    scenario: &Scenario,
    nodes: &Nodes,
    rec: &mut Recorder,
    clock: &SimClock,
    world: &mut World,
) -> SimResult<()> {
    let lines: Vec<Value> = scenario
        .topology
        .supplier_items
        .iter()
        .zip(scenario.topology.order_qty.iter())
        .map(|(code, qty)| {
            let id = world
                .supplier_item_ids
                .iter()
                .find(|(c, _)| c == code)
                .map(|(_, id)| id.clone())
                .unwrap_or_default();
            json!({ "supplier_item_id": id, "quantity": qty })
        })
        .collect();

    let receipt = call_idem(
        nodes, rec, clock, CLOUD, Node::Cloud, "POST",
        "/api/v1/purchase-orders/catalog",
        json!({
            "po_number": world.po_number,
            "supplier_id": world.supplier_id,
            "destination_site_id": scenario.topology.destination,
            "lines": lines,
        }),
        &format!("sim-{}-po", world.po_number),
        Expect::Success,
    )
    .await?;
    world.po_id = str_field(&receipt, "purchase_order_id", "catalog PO")?;
    world.po_net_minor = receipt
        .get("net_minor")
        .and_then(Value::as_i64)
        .unwrap_or_default();
    Ok(())
}

/// Wednesday 08:00 — the lorry is at the bay. First the order must EXIST
/// here: poll the DC's work list until sync delivers the activation. Opening
/// the receipt is one person's act; what came in is counted next.
async fn open_receipt(
    nodes: &Nodes,
    rec: &mut Recorder,
    clock: &mut SimClock,
    world: &mut World,
) -> SimResult<()> {
    let lines = wait_until("DC holds the activated PO", || async {
        let lines = read_po_lines(nodes).await?;
        Ok(if lines.is_empty() { None } else { Some(lines) })
    })
    .await?;
    let first = lines
        .first()
        .ok_or_else(|| SimError("PO lines arrived but are empty".into()))?;
    let dc_supplier_id = str_field(first, "supplier_id", "DC work line")?;

    let receipt = call(
        nodes, rec, clock, COUNTER, Node::Dc, "POST", "/api/v1/dc/goods-receipts",
        json!({
            "supplier_id": dc_supplier_id,
            "arrived_at": clock.now().to_rfc3339(),
            "actor_id": COUNTER,
            "idempotency_key": format!("{}-receipt", world.po_number),
        }),
        Expect::Success,
    )
    .await?;
    world.receipt_number = str_field(&receipt, "receipt_number", "goods receipt")?;
    Ok(())
}

/// Wednesday 08:20 — the bay clerk counts every line as fully arrived; the
/// verifier — a different name, a different person — accepts each count.
/// Acceptance is the moment the goods first exist as stock.
async fn count_and_verify(
    scenario: &Scenario,
    nodes: &Nodes,
    rec: &mut Recorder,
    clock: &SimClock,
    world: &mut World,
) -> SimResult<()> {
    let lines = read_po_lines(nodes).await?;
    let open_receipts = call(
        nodes, rec, clock, COUNTER, Node::Dc, "GET",
        "/api/v1/dc/goods-receipts", Value::Null, Expect::Success,
    )
    .await?;
    let receipt_id = open_receipts
        .get("items")
        .and_then(Value::as_array)
        .and_then(|items| items.first())
        .and_then(|r| r.get("receipt_id"))
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| SimError("no OPEN goods receipt at the DC".into()))?;

    let ordered: std::collections::BTreeMap<String, i64> = scenario
        .topology
        .supplier_items
        .iter()
        .cloned()
        .zip(scenario.topology.order_qty.iter().copied())
        .collect();
    for line in &lines {
        let code = line
            .get("article_code")
            .and_then(Value::as_str)
            .ok_or_else(|| SimError("DC work line lacks article_code".into()))?
            .to_string();
        let qty = ordered.get(&code).copied().ok_or_else(|| {
            SimError(format!("DC shows work line {code} that the scenario never ordered"))
        })?;
        let po_line_id = str_field(line, "po_line_id", "DC work line")?;
        let count = call(
            nodes, rec, clock, COUNTER, Node::Dc, "POST", "/api/v1/dc/purchase-counts",
            json!({
                "receipt_id": receipt_id,
                "po_line_id": po_line_id,
                "counted_quantity": qty,
                "actor_id": COUNTER,
                "idempotency_key": format!("{}-count-{code}", world.po_number),
            }),
            Expect::Success,
        )
        .await?;
        let count_id = str_field(&count, "count_id", "purchase count")?;

        let verify = call(
            nodes, rec, clock, VERIFIER, Node::Dc, "POST", "/api/v1/dc/purchase-verifications",
            json!({
                "count_id": count_id,
                "verifier_actor_id": VERIFIER,
                "decision": "Accept",
                "idempotency_key": format!("{}-verify-{code}", world.po_number),
            }),
            Expect::Success,
        )
        .await?;
        world.accepted_total += verify
            .get("accepted_quantity")
            .and_then(Value::as_i64)
            .unwrap_or_default();
    }
    Ok(())
}

/// Wednesday 08:45 — the verifier stamps the supplier's invoice numbers on
/// the delivery. The paper itself stays at the DC until the cloud asks.
async fn record_invoice(
    scenario: &Scenario,
    nodes: &Nodes,
    rec: &mut Recorder,
    clock: &SimClock,
    world: &mut World,
) -> SimResult<()> {
    let open_receipts = call(
        nodes, rec, clock, VERIFIER, Node::Dc, "GET",
        "/api/v1/dc/goods-receipts", Value::Null, Expect::Success,
    )
    .await?;
    let receipt_id = open_receipts
        .get("items")
        .and_then(Value::as_array)
        .and_then(|items| items.first())
        .and_then(|r| r.get("receipt_id"))
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| SimError("no OPEN goods receipt to invoice".into()))?;

    // The invoice charges the agreed catalogue prices for what was accepted.
    let total: i64 = scenario
        .topology
        .order_qty
        .iter()
        .zip(scenario.topology.supplier_items.iter())
        .map(|(qty, code)| qty * unit_price(world, code))
        .sum();
    world.invoice_total_minor = total;

    call(
        nodes, rec, clock, VERIFIER, Node::Dc, "POST",
        &format!("/api/v1/dc/goods-receipts/{receipt_id}/invoice"),
        json!({
            "receipt_id": receipt_id,
            "invoice_number": world.invoice_number,
            "invoice_date": clock.today_local().to_string(),
            "invoice_total_minor": total,
            "actor_id": VERIFIER,
            "idempotency_key": format!("{}-invoice", world.po_number),
        }),
        Expect::Success,
    )
    .await?;
    Ok(())
}

/// Friday 16:00 — finance values the delivery into the ledger, books the
/// bill against it through the three-way match, posts the bill, pays it and
/// posts the payment. The queue of un-billed deliveries is the cloud's own
/// read-model; the clerk works from it, and the receipt leaving that queue is
/// part of what the audit checks.
async fn settle(
    scenario: &Scenario,
    nodes: &Nodes,
    rec: &mut Recorder,
    clock: &SimClock,
    world: &mut World,
) -> SimResult<()> {
    let receipt_number = world.receipt_number.clone();
    let entry = wait_until("the delivery reaches the unbilled queue", async || {
        let unbilled = peek(nodes, "finance@ho", Node::Cloud, "/api/v1/finance/unbilled").await?;
        Ok(unbilled
            .as_array()
            .or_else(|| unbilled.get("items").and_then(Value::as_array))
            .and_then(|items| {
                items.iter().find(|r| {
                    r.get("receipt_number").and_then(Value::as_str)
                        == Some(receipt_number.as_str())
                })
            })
            .cloned())
    })
    .await?;
    let cloud_receipt_id = str_field(&entry, "receipt_id", "unbilled receipt")?;
    let site_id = str_field(&entry, "site_id", "unbilled receipt")?;
    // The queue answers in the supplier the DELIVERY names — the code the
    // order and the receipt carry — which is the identity the bill must be
    // recorded under for the match to agree.
    let receipt_supplier = str_field(&entry, "supplier_id", "unbilled receipt")?;
    world.cloud_receipt_id = cloud_receipt_id.clone();

    // The delivery's accepted lines, as the cloud applied them. The three-way
    // match names each delivery line, and the identity queue is the only read
    // that answers in receipt-line ids.
    let delivery_lines = {
        let receipt_number = world.receipt_number.clone();
        wait_until("the delivery lines reach the identity queue", async || {
            let pending = peek(
                nodes, "finance@ho", Node::Cloud, "/api/v1/article-setups/unidentified",
            )
            .await?;
            let mine: Vec<Value> = pending
                .get("items")
                .and_then(Value::as_array)
                .map(|items| {
                    items
                        .iter()
                        .filter(|line| {
                            line.get("receipt_number").and_then(Value::as_str)
                                == Some(receipt_number.as_str())
                        })
                        .cloned()
                        .collect()
                })
                .unwrap_or_default();
            Ok(if mine.is_empty() { None } else { Some(mine) })
        })
        .await?
    };

    // The clerk's first act of the month: the books must be open before
    // anything can post into them.
    let today = clock.today_local();
    call(
        nodes, rec, clock, "finance@ho", Node::Cloud, "POST", "/api/v1/finance/periods",
        json!({ "year": today.year(), "month": today.month() }),
        Expect::Success,
    )
    .await?;

    // Finance values the delivery into the ledger first: the valuation is the
    // suspend credit the bill will clear, and both the match and the post
    // refuse a delivery that is not in the ledger yet.
    call(
        nodes, rec, clock, "finance@ho", Node::Cloud, "POST",
        &format!("/api/v1/finance/receipts/{cloud_receipt_id}/post"),
        json!({ "posting_date": clock.today_local().to_string() }),
        Expect::Success,
    )
    .await?;

    // The bill is recorded as a DRAFT and then tied to the delivery by the
    // three-way match: what the invoice charges, laid beside what was
    // accepted at the ordered price.
    let bill = call(
        nodes, rec, clock, "finance@ho", Node::Cloud, "POST", "/api/v1/finance/bills",
        json!({
            "invoice_number": world.invoice_number,
            "supplier_id": receipt_supplier,
            "supplier_name": format!("{} (rig)", scenario.topology.supplier),
            "site_id": site_id,
            "invoice_date": clock.today_local().to_string(),
            "subtotal_minor": world.invoice_total_minor,
            "kind": "MERCHANDISE",
        }),
        Expect::Success,
    )
    .await?;
    world.bill_id = str_field(&bill, "invoice_id", "bill")?;
    let bill_total = bill
        .get("total_minor")
        .and_then(Value::as_i64)
        .unwrap_or(world.invoice_total_minor);

    let match_lines: Vec<Value> = delivery_lines
        .iter()
        .map(|line| {
            let code = line
                .get("supplier_article_code")
                .and_then(Value::as_str)
                .unwrap_or_default();
            json!({
                "receipt_line_id": line.get("receipt_line_id"),
                "description": format!("Artikel {code}"),
                "quantity": line.get("quantity").and_then(Value::as_i64).unwrap_or_default(),
                "unit_price_minor": unit_price(world, code),
            })
        })
        .collect();
    let matched = call(
        nodes, rec, clock, "finance@ho", Node::Cloud, "POST",
        &format!("/api/v1/finance/bills/{}/match", world.bill_id),
        json!({
            "receipt_ids": [cloud_receipt_id],
            "lines": match_lines,
        }),
        Expect::Success,
    )
    .await?;
    let matched_status = str_field(&matched, "status", "matched bill")?;
    if matched_status != "MATCHED" {
        return Err(SimError(format!(
            "bill match left the bill {matched_status}, not MATCHED"
        )));
    }

    let posted_bill = call(
        nodes, rec, clock, "finance@ho", Node::Cloud, "POST",
        &format!("/api/v1/finance/bills/{}/post", world.bill_id),
        json!({ "posting_date": clock.today_local().to_string() }),
        Expect::Success,
    )
    .await?;
    world.bill_status = str_field(&posted_bill, "status", "posted bill")?;

    // The transfer leaves the company's savings account, and the map is where
    // finance says which chart account that is at this site. The migration
    // seeds the goods side of the map but leaves the client's bank accounts
    // to the clerk, so the clerk sets it here.
    call(
        nodes, rec, clock, "finance@ho", Node::Cloud, "POST", "/api/v1/finance/account-map",
        json!({
            "semantic_key": "bank_savings",
            "site_id": site_id,
            // 1010 — Cash In Bank Tabungan Bank BCA: the active savings leaf
            // of the client chart (the old 1011003… leaves are retired).
            "account_code": "1010",
            "note": "Cash In Bank Tabungan Bank BCA; where supplier transfers leave from",
        }),
        Expect::Success,
    )
    .await?;

    let payment = call(
        nodes, rec, clock, "finance@ho", Node::Cloud, "POST", "/api/v1/finance/payments",
        json!({
            "site_id": site_id,
            "payment_date": clock.today_local().to_string(),
            "method": "TRANSFER",
            "account_key": "bank_savings",
            "total_minor": bill_total,
            "allocations": [{ "invoice_id": world.bill_id, "amount_minor": bill_total }],
        }),
        Expect::Success,
    )
    .await?;
    world.payment_id = str_field(&payment, "payment_id", "payment")?;

    // Posting the payment is refused — by design, for now: document-driven
    // posting runs under a Finance pause and its allowlist (migration 0352)
    // covers Sales and Inventory flows only, and no route lets Finance allow
    // PAYMENT. The clerk still records the payment and its allocation; the
    // refusal is pinned so the audit holds the pause up as what it is.
    let refused = call(
        nodes, rec, clock, "finance@ho", Node::Cloud, "POST",
        &format!("/api/v1/finance/payments/{}/post", world.payment_id),
        json!({ "posting_date": clock.today_local().to_string() }),
        Expect::Status(409),
    )
    .await?;
    let refusal = refused
        .get("error")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if !refusal.contains("automatic posting is paused for source kind PAYMENT") {
        return Err(SimError(format!(
            "payment posting was refused with an unexpected sentence: {refusal}"
        )));
    }

    let held = call(
        nodes, rec, clock, "finance@ho", Node::Cloud, "GET",
        &format!("/api/v1/finance/payments/{}", world.payment_id),
        Value::Null, Expect::Success,
    )
    .await?;
    world.payment_status = str_field(&held, "status", "held payment")?;
    Ok(())
}

/// Friday 17:00 — read the system's own answers and refuse to accept a story
/// that disagrees with them. These are the run's smoke invariants: order fully
/// received, delivery billed, money posted.
async fn audit(
    nodes: &Nodes,
    rec: &mut Recorder,
    clock: &SimClock,
    world: &mut World,
) -> SimResult<()> {
    let orders = call(
        nodes, rec, clock, CLOUD, Node::Cloud, "GET",
        &format!("/api/v1/purchase-orders?q={}", world.po_number),
        Value::Null, Expect::Success,
    )
    .await?;
    let row = orders
        .get("rows")
        .and_then(Value::as_array)
        .and_then(|rows| rows.first())
        .ok_or_else(|| SimError("the PO vanished from the cloud order book".into()))?;
    world.po_lifecycle = str_field(row, "lifecycle", "purchase order")?;
    if world.po_lifecycle != "FULLY_RECEIVED" && world.po_lifecycle != "CLOSED" {
        return Err(SimError(format!(
            "expected the PO fully received by audit, lifecycle is {}",
            world.po_lifecycle
        )));
    }

    let unbilled = call(
        nodes, rec, clock, CLOUD, Node::Cloud, "GET", "/api/v1/finance/unbilled",
        Value::Null, Expect::Success,
    )
    .await?;
    let still_there = unbilled
        .as_array()
        .or_else(|| unbilled.get("items").and_then(Value::as_array))
        .map(|items| {
            items.iter().any(|r| {
                r.get("receipt_number").and_then(Value::as_str)
                    == Some(world.receipt_number.as_str())
            })
        })
        .unwrap_or(false);
    if still_there {
        return Err(SimError(format!(
            "receipt {} is still unbilled after the bill posted",
            world.receipt_number
        )));
    }

    if world.accepted_total != world.ordered_total {
        return Err(SimError(format!(
            "accepted {} units but the scenario ordered {}",
            world.accepted_total, world.ordered_total
        )));
    }
    if world.bill_status != "POSTED" {
        return Err(SimError(format!(
            "bill status {} and payment status {} — settlement incomplete",
            world.bill_status, world.payment_status
        )));
    }
    // The payment is expected to be held in DRAFT: the finance posting pause
    // (migration 0352) has no allowance for the PAYMENT source kind and no
    // route to add one. If that ever changes — a posted payment here, say —
    // this refusal is the contract that changed.
    if world.payment_status != "DRAFT" {
        return Err(SimError(format!(
            "payment status {} — expected the payment held in DRAFT by the finance posting pause",
            world.payment_status
        )));
    }
    Ok(())
}

// ── helpers ───────────────────────────────────────────────────────────────────

/// The DC's outstanding PO lines, once sync has delivered the order.
async fn read_po_lines(nodes: &Nodes) -> SimResult<Vec<Value>> {
    let body = peek(nodes, COUNTER, Node::Dc, "/api/v1/dc/purchase-orders").await?;
    Ok(body
        .get("items")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default())
}

/// Poll a read-model on the real wall clock (the rig's sync agent runs on its
/// own 5-second timer) until the expected fact shows up. The VIRTUAL clock is
/// untouched: waiting for the network is not business time. `None` from an
/// attempt means "not yet" — a miss, not a failure.
async fn wait_until<T>(
    description: &str,
    mut attempt: impl AsyncFnMut() -> SimResult<Option<T>>,
) -> SimResult<T> {
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(120);
    let mut last_error: Option<SimError> = None;
    loop {
        match attempt().await {
            Ok(Some(value)) => return Ok(value),
            Ok(None) => {}
            Err(e) => last_error = Some(e),
        }
        if std::time::Instant::now() >= deadline {
            return Err(SimError(format!(
                "timed out waiting for {description}: {}",
                last_error
                    .map(|e| e.0)
                    .unwrap_or_else(|| "fact never appeared".into())
            )));
        }
        tokio::time::sleep(std::time::Duration::from_secs(2)).await;
    }
}

/// The catalogue price of a supplier item. Bootstrap registered the items
/// against one cycling price list, and the invoice the DC stamps and the bill
/// the cloud matches must both charge it — so one function answers for both.
fn unit_price(world: &World, supplier_item_code: &str) -> i64 {
    const PRICES: [i64; 3] = [25_000, 18_500, 42_000];
    world
        .supplier_item_ids
        .iter()
        .position(|(code, _)| code == supplier_item_code)
        .map(|index| PRICES[index % PRICES.len()])
        .unwrap_or_default()
}

fn str_field(value: &Value, field: &str, what: &str) -> SimResult<String> {
    value
        .get(field)
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| {
            SimError(format!(
                "{what} response lacks {field}: {}",
                truncate_value(value)
            ))
        })
}

fn truncate_value(value: &Value) -> String {
    let text = value.to_string();
    if text.len() > 200 {
        format!("{}…", &text[..200])
    } else {
        text
    }
}
