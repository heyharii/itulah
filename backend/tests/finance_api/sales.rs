//! Sales / POS (brief §2, scenarios 1–6).

use super::harness::*;
use super::stock::{self, Received};
use chrono::{Duration, Utc};
use serde_json::{json, Value};
use uuid::Uuid;

pub const POS: &str = "store-01-pos";

/// One tender as the till captured it.
#[derive(Clone)]
pub struct Tender {
    pub method: &'static str,
    pub amount: i64,
    pub acquirer: Option<&'static str>,
    pub card_kind: Option<&'static str>,
    pub terminal: Option<&'static str>,
}

pub fn cash(amount: i64) -> Tender {
    Tender { method: "CASH", amount, acquirer: None, card_kind: None, terminal: None }
}

pub fn card(amount: i64, acquirer: &'static str, kind: &'static str) -> Tender {
    Tender { method: "CARD", amount, acquirer: Some(acquirer), card_kind: Some(kind), terminal: None }
}

pub fn qris(amount: i64, terminal: Option<&'static str>, acquirer: Option<&'static str>) -> Tender {
    Tender { method: "QRIS", amount, acquirer, card_kind: None, terminal }
}

pub fn voucher(amount: i64) -> Tender {
    Tender { method: "VOUCHER", amount, acquirer: None, card_kind: None, terminal: None }
}

pub fn online(amount: i64, marketplace: &'static str) -> Tender {
    Tender { method: "OTHER", amount, acquirer: Some(marketplace), card_kind: None, terminal: None }
}

/// One unit sold: SKU, list price, and what the promotions took off it.
#[derive(Clone)]
pub struct Sold {
    pub sku: String,
    pub price: i64,
    pub discount: i64,
}

/// A unit brought back on a RETURN, with the value it is credited at.
#[derive(Clone)]
pub struct Returned {
    pub original_sale_id: Uuid,
    pub sku: String,
    pub epc: String,
    pub value: i64,
}

pub struct SaleFact {
    pub sale_id: Uuid,
    pub payload: Value,
    pub epcs: Vec<String>,
}

pub fn when() -> chrono::DateTime<Utc> {
    // Mid-morning in Jakarta, today: inside today's business day.
    let today = today();
    today
        .and_hms_opt(3, 0, 0)
        .unwrap_or_default()
        .and_utc()
        + Duration::minutes(rand_minutes())
}

fn rand_minutes() -> i64 {
    (Uuid::new_v4().as_u128() % 120) as i64
}

/// A sale as the POS sends it up, with its own arithmetic right.
pub fn sale(
    lines: &[Sold],
    tenders: &[Tender],
    rounding: i64,
    returns: &[Returned],
    forfeited: i64,
) -> SaleFact {
    let sale_id = Uuid::new_v4();
    let mut epcs = Vec::new();
    let mut total = 0;
    let mut discount = 0;
    let fact_lines: Vec<Value> = lines
        .iter()
        .map(|l| {
            let epc = format!("{:024X}", Uuid::new_v4().as_u128() & 0xFFFF_FFFF_FFFF_FFFF_FFFF_FFFF);
            epcs.push(epc.clone());
            total += l.price - l.discount;
            discount += l.discount;
            json!({
                "subject_id": Uuid::new_v4(),
                "epc": epc,
                "sku_code": l.sku,
                "quantity": 1,
                "unit_price_minor": l.price,
                "line_total_minor": l.price - l.discount,
            })
        })
        .collect();
    let paid: i64 = tenders.iter().map(|t| t.amount).sum();
    let returned: i64 = returns.iter().map(|r| r.value).sum();
    let change = paid + returned - total - forfeited - rounding;
    let payload = json!({
        "sale_id": sale_id,
        "movement_group_id": Uuid::new_v4(),
        "site_id": STORE,
        "actor_id": "kasir",
        "occurred_at": when(),
        "currency": "IDR",
        "total_minor": total,
        "paid_minor": paid,
        "change_minor": change,
        "discount_total_minor": discount,
        "rounding_minor": rounding,
        "forfeited_minor": forfeited,
        "lines": fact_lines,
        "returns": returns.iter().map(|r| json!({
            "original_sale_id": r.original_sale_id,
            "subject_id": Uuid::new_v4(),
            "epc": r.epc,
            "sku_code": r.sku,
            "value_minor": r.value,
            "disposition": "RESALEABLE",
        })).collect::<Vec<_>>(),
        "tenders": tenders.iter().enumerate().map(|(i, t)| json!({
            "tender_seq": i as i32,
            "method": t.method,
            "amount_minor": t.amount,
            "acquirer": t.acquirer,
            "card_kind": t.card_kind,
            "terminal_id": t.terminal,
        })).collect::<Vec<_>>(),
    });
    SaleFact { sale_id, payload, epcs }
}

/// What a shop needs before it can sell: a till, head office's BCA account,
/// the BNI EDC terminal, and goods on the shelf that came in through a real
/// delivery (supplier straight to the shop).
pub struct Shop {
    pub goods: Received,
    pub supplier: String,
}

pub async fn open_shop(api: &Api) -> Shop {
    api.node(POS, STORE, "STORE").await;
    let floor = stock::receiving_node(api, STORE).await;
    api.bank_account("1005", HO, "BCA", "8880012345").await;
    api.post(
        FINANCE,
        "/api/v1/finance/edc-terminals",
        json!({ "site_id": STORE, "terminal_id": "T-BNI-01", "bank_code": "BNI" }),
    )
    .await;
    let supplier = stock::supplier(api, "SANDANG").await;
    let goods = stock::receive(
        api,
        &floor,
        STORE,
        &supplier,
        &[
            stock::shirt(10, 100_000, 249_950),
            stock::trousers(10, 120_000, 300_000),
            stock::bags(50, 300),
        ],
    )
    .await;
    Shop { goods, supplier }
}

pub async fn ring(api: &Api, fact: &SaleFact) {
    api.ingest(POS, vec![("sales.completed", fact.payload.clone())])
        .await
        .ok("sale fact");
}

/// Generate and post today's sales day for the shop, as Finance.
pub async fn post_day(api: &Api) -> Value {
    let draft = api
        .post(
            FINANCE,
            "/api/v1/finance/sales-postings/generate",
            json!({ "site_id": STORE, "business_date": today() }),
        )
        .await;
    let id = draft["posting"]["posting_id"]
        .as_str()
        .unwrap_or_else(|| panic!("posting id: {draft}"))
        .to_string();
    api.post(
        FINANCE,
        &format!("/api/v1/finance/sales-postings/{id}/post"),
        json!({}),
    )
    .await
}

fn sku(shop: &Shop, index: usize) -> String {
    shop.goods.skus[index].clone()
}

// 1 -------------------------------------------------------------------------

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_mixed_shop_day_posts_one_sale_day(pool: sqlx::PgPool) {
    let api = Api::new(pool).await;
    let shop = open_shop(&api).await;
    let shirt = sku(&shop, 0);
    let trousers = sku(&shop, 1);
    let bag = sku(&shop, 2);

    // Cash: a shirt with a 25,000 promotion and two free bags; 224,950 paid
    // with 225,000 and the 50 of change rounded away (kept by the till).
    let a = sale(
        &[
            Sold { sku: shirt.clone(), price: 249_950, discount: 25_000 },
            Sold { sku: bag.clone(), price: 1_000, discount: 1_000 },
            Sold { sku: bag.clone(), price: 1_000, discount: 1_000 },
        ],
        &[cash(225_000)],
        50,
        &[],
        0,
    );
    // BCA debit, VISA credit, QRIS on BNI's EDC (the POS sent only the terminal).
    let b = sale(&[Sold { sku: trousers.clone(), price: 300_000, discount: 0 }], &[card(300_000, "BCA", "DEBIT")], 0, &[], 0);
    let c = sale(&[Sold { sku: shirt.clone(), price: 249_950, discount: 0 }], &[card(249_950, "VISA", "CREDIT")], 0, &[], 0);
    let d = sale(&[Sold { sku: trousers.clone(), price: 300_000, discount: 0 }], &[qris(300_000, Some("T-BNI-01"), None)], 0, &[], 0);
    // A free voucher of 100,000 against a shirt; the rest in cash.
    let e = sale(&[Sold { sku: shirt.clone(), price: 249_950, discount: 0 }], &[voucher(100_000), cash(149_950)], 0, &[], 0);
    for fact in [&a, &b, &c, &d, &e] {
        ring(&api, fact).await;
    }
    let posted = post_day(&api).await;
    assert_eq!(posted["posting"]["status"], "POSTED", "{posted}");
    assert!(posted["exceptions"].as_array().is_none_or(|x| x.is_empty()), "{posted}");

    let books = api.books().await;
    let day = books.kind("SALE_DAY");
    assert_eq!(day.entries().len(), 1, "one SALE_DAY for the shop's day\n{}", day.dump());
    // Money in, by tender.
    assert_eq!(day.dr("1002", STORE), 225_000 + 149_950, "cash on hand\n{}", day.dump());
    assert_eq!(day.dr("1021", STORE), 300_000 + 300_000, "BCA debit + QRIS on BNI's EDC");
    assert_eq!(day.dr("1020", STORE), 249_950, "VISA credit");
    // The free voucher, and only the voucher: the 25,000 promotion and the two
    // bags given away are inside the price charged, so they never reach 4012
    // (owner decision 25 Sep 2026 — promotions are net inside revenue).
    assert_eq!(day.dr("4012", STORE), 100_000, "4012\n{}", day.dump());
    // Sales at what was charged, by tender account; QRIS BNI rides BNI's debit leaf.
    for account in ["4002", "4003", "4006", "4007"] {
        assert!(day.cr(account, STORE) > 0, "{account} credited\n{}", day.dump());
    }
    let revenue: i64 = ["4002", "4003", "4006", "4007"].iter().map(|a| day.cr(a, STORE)).sum();
    assert_eq!(
        revenue,
        (249_950 - 25_000) + 249_950 * 2 + 300_000 * 2 - 50,
        "sales at what was charged (promotion and free bags net), less the rounding\n{}",
        day.dump()
    );
    assert_eq!(day.cr("8003", STORE), 50, "rounding kept by the till");
    assert!(!books.has("2013"), "PPN is ignored");
    // Cost of what left the shelves: three shirts and two trousers, per unit,
    // and the two bags as customer supplies.
    assert_eq!(books.dr("5002", STORE), 3 * 100_000 + 2 * 120_000, "HPP\n{}", books.dump());
    assert_eq!(books.cr("1029", STORE), 3 * 100_000 + 2 * 120_000);
    assert_eq!(books.dr("6004", STORE), 2 * 300, "bags consumed");
    assert_eq!(books.cr("1030", STORE), 2 * 300);
    books.assert_sound(true);
    record("a_mixed_shop_day_posts_one_sale_day", &books);
}

// 2 -------------------------------------------------------------------------

#[sqlx::test(migrations = "./migrations/postgres")]
async fn qris_without_a_bank_and_online_tenders_wait_and_the_day_posts(pool: sqlx::PgPool) {
    let api = Api::new(pool).await;
    let shop = open_shop(&api).await;
    let shirt = sku(&shop, 0);
    ring(&api, &sale(&[Sold { sku: shirt.clone(), price: 249_950, discount: 0 }], &[cash(250_000)], 0, &[], 0)).await;
    // QRIS naming a wallet, on no registered terminal: no bank to post to.
    ring(&api, &sale(&[Sold { sku: shirt.clone(), price: 249_950, discount: 0 }], &[qris(249_950, None, Some("GOPAY"))], 0, &[], 0)).await;
    // A marketplace tender: the company does not sell online.
    ring(&api, &sale(&[Sold { sku: shirt.clone(), price: 249_950, discount: 0 }], &[online(249_950, "TOKOPEDIA")], 0, &[], 0)).await;

    let posted = post_day(&api).await;
    assert_eq!(posted["posting"]["status"], "POSTED", "{posted}");
    let waiting = posted["exceptions"].as_array().cloned().unwrap_or_default();
    assert_eq!(waiting.len(), 2, "two lines wait: {posted}");
    for line in &waiting {
        assert_eq!(line["status"], "OPEN");
        assert!(!line["reason"].as_str().unwrap_or_default().is_empty(), "a reason: {line}");
    }
    let online_line = waiting.iter().find(|x| x["method"] == "OTHER").unwrap_or_else(|| panic!("online"));
    assert!(online_line["reason"].as_str().unwrap_or_default().contains("online"), "{online_line}");

    let books = api.books().await;
    let day = books.kind("SALE_DAY");
    assert_eq!(day.dr("1002", STORE), 249_950 + 50 - 50, "the cash sale posted\n{}", day.dump());
    assert_eq!(day.dr("1021", STORE), 0, "the unplaced QRIS did not post");
    assert!(!books.has("4009") && !books.has("4010"), "no online sales");

    // The QRIS whose bank Finance names posts on its own; the online line
    // cannot be resolved by naming a bank.
    let qris_line = waiting.iter().find(|x| x["method"] == "QRIS").unwrap_or_else(|| panic!("qris"));
    api.post(
        FINANCE,
        &format!("/api/v1/finance/sales-posting-exceptions/{}/resolve", qris_line["exception_id"].as_str().unwrap_or_default()),
        json!({ "bank_code": "BCA" }),
    )
    .await;
    let refused = api
        .call(
            FINANCE,
            "POST",
            &format!("/api/v1/finance/sales-posting-exceptions/{}/resolve", online_line["exception_id"].as_str().unwrap_or_default()),
            Some(json!({ "bank_code": "BCA" })),
        )
        .await;
    assert!(refused.refused(), "an online tender stays refused: {refused:?}");
    let books = api.books().await;
    assert_eq!(books.dr("1021", STORE), 249_950, "the resolved QRIS on BCA's debit leaf");
    assert_eq!(books.cr("4003", STORE), 249_950);
    books.assert_sound(true);
    record("qris_without_a_bank_and_online_tenders_wait_and_the_day_posts", &books);
}

// 3 -------------------------------------------------------------------------

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_return_for_a_cheaper_replacement_forfeits_the_difference(pool: sqlx::PgPool) {
    let api = Api::new(pool).await;
    let shop = open_shop(&api).await;
    let shirt = sku(&shop, 0);
    let trousers = sku(&shop, 1);

    // Yesterday-or-today: a pair of trousers is bought for cash…
    let bought = sale(&[Sold { sku: trousers.clone(), price: 300_000, discount: 0 }], &[cash(300_000)], 0, &[], 0);
    ring(&api, &bought).await;
    // …and brought back for a cheaper shirt. No money leaves the till: the
    // 50,050 the shirt does not use up is forfeited.
    let exchange = sale(
        &[Sold { sku: shirt.clone(), price: 249_950, discount: 0 }],
        &[],
        0,
        &[Returned {
            original_sale_id: bought.sale_id,
            sku: trousers.clone(),
            epc: bought.epcs[0].clone(),
            value: 300_000,
        }],
        50_050,
    );
    ring(&api, &exchange).await;
    let posted = post_day(&api).await;
    assert_eq!(posted["posting"]["status"], "POSTED", "{posted}");

    let books = api.books().await;
    let day = books.kind("SALE_DAY");
    assert_eq!(day.dr("4013", STORE), 300_000, "the return at the price it was sold\n{}", day.dump());
    assert_eq!(day.cr("8008", STORE), 50_050, "the unused difference is forfeited");
    // Only the original purchase put cash in; the exchange took none out.
    assert_eq!(day.dr("1002", STORE), 300_000);
    assert_eq!(day.cr("1002", STORE), 0, "no cash leaves on a return");
    let revenue: i64 = ["4002", "4003", "4006", "4007"].iter().map(|a| day.cr(a, STORE)).sum();
    assert_eq!(revenue, 300_000 + 249_950, "the original sale and the replacement");
    // Cost: the trousers left at 120,000 and came back at 120,000; the shirt
    // left at 100,000.
    assert_eq!(books.net("5002", STORE), 100_000, "HPP reversed for the returned unit\n{}", books.dump());
    assert_eq!(books.net("1029", STORE), 10 * 100_000 + 10 * 120_000 - 100_000);
    books.assert_sound(true);
    record("a_return_for_a_cheaper_replacement_forfeits_the_difference", &books);
}

// 3b ------------------------------------------------------------------------

/// Give a sale fact the tax split a till with a published rate sends (11%,
/// inside the price), so the day is posted from RECORDED tax.
fn with_recorded_tax(fact: &mut SaleFact) {
    let mut net_total = 0;
    let mut tax_total = 0;
    if let Some(lines) = fact.payload["lines"].as_array_mut() {
        for line in lines {
            let charged = line["line_total_minor"].as_i64().unwrap_or_default();
            let tax = charged * 1_100 / 11_100;
            line["net_ex_tax_minor"] = json!(charged - tax);
            line["tax_minor"] = json!(tax);
            net_total += charged - tax;
            tax_total += tax;
        }
    }
    fact.payload["net_ex_tax_minor"] = json!(net_total);
    fact.payload["tax_total_minor"] = json!(tax_total);
}

/// Owner decision 25 Sep 2026 (promotions net inside revenue) and P11 (PPN
/// ignored), on one day: two promoted sales on two tenders, and one of them
/// brought back for a replacement, every line carrying recorded tax. Income
/// per tender is what that tender was charged; 4012 sees nothing (no voucher,
/// and a promotion is not a discount line); the return is 4013 at the whole
/// value; and no tax line is built even though the returned line recorded tax
/// — the case that used to debit the deleted `vat_out`.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_promoted_day_with_a_return_posts_what_was_charged_and_no_tax(pool: sqlx::PgPool) {
    let api = Api::new(pool).await;
    let shop = open_shop(&api).await;
    let shirt = sku(&shop, 0);
    let trousers = sku(&shop, 1);

    // Cash: a shirt 25,000 off its list price.
    let mut a = sale(&[Sold { sku: shirt.clone(), price: 249_950, discount: 25_000 }], &[cash(224_950)], 0, &[], 0);
    with_recorded_tax(&mut a);
    // BCA debit: trousers 30,000 off.
    let mut b = sale(&[Sold { sku: trousers.clone(), price: 300_000, discount: 30_000 }], &[card(270_000, "BCA", "DEBIT")], 0, &[], 0);
    with_recorded_tax(&mut b);
    ring(&api, &a).await;
    ring(&api, &b).await;
    // The trousers come back at what they were sold for, for a shirt at list;
    // the 20,050 the shirt does not use up is forfeited.
    let mut exchange = sale(
        &[Sold { sku: shirt.clone(), price: 249_950, discount: 0 }],
        &[],
        0,
        &[Returned { original_sale_id: b.sale_id, sku: trousers.clone(), epc: b.epcs[0].clone(), value: 270_000 }],
        20_050,
    );
    // The returned unit is the line it was sold on, so its tax traces back.
    exchange.payload["returns"][0]["subject_id"] = b.payload["lines"][0]["subject_id"].clone();
    with_recorded_tax(&mut exchange);
    ring(&api, &exchange).await;

    let posted = post_day(&api).await;
    assert_eq!(posted["posting"]["status"], "POSTED", "{posted}");
    assert_eq!(posted["posting"]["vat_minor"], 0, "no tax posted: {posted}");
    assert_eq!(posted["posting"]["discount_minor"], 55_000, "promotions reported: {posted}");

    let books = api.books().await;
    let day = books.kind("SALE_DAY");
    assert_eq!(day.entries().len(), 1, "{}", day.dump());
    // Income per tender at what was charged.
    assert_eq!(day.cr("4002", STORE), 224_950 + 249_950, "cash sale + the replacement\n{}", day.dump());
    assert_eq!(day.cr("4003", STORE), 270_000, "BCA debit at the promoted price\n{}", day.dump());
    assert_eq!(day.dr("1002", STORE), 224_950);
    assert_eq!(day.dr("1021", STORE), 270_000);
    // Nothing reaches the discount account from a promotion.
    assert_eq!(day.dr("4012", STORE), 0, "promotions are inside revenue\n{}", day.dump());
    // The return at its whole value; the unused difference forfeited.
    assert_eq!(day.dr("4013", STORE), 270_000, "the return, tax and all\n{}", day.dump());
    assert_eq!(day.cr("8008", STORE), 20_050);
    assert!(!books.has("2013"), "PPN is ignored\n{}", books.dump());
    books.assert_sound(true);
    record("a_promoted_day_with_a_return_posts_what_was_charged_and_no_tax", &books);
}

// 4 -------------------------------------------------------------------------

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_bca_card_settlement_into_head_office_keeps_the_mdr_in_the_shop(pool: sqlx::PgPool) {
    let api = Api::new(pool).await;
    let shop = open_shop(&api).await;
    let trousers = sku(&shop, 1);
    for _ in 0..2 {
        ring(&api, &sale(&[Sold { sku: trousers.clone(), price: 300_000, discount: 0 }], &[card(300_000, "BCA", "DEBIT")], 0, &[], 0)).await;
    }
    post_day(&api).await;
    api.post(
        FINANCE,
        "/api/v1/finance/acquirer-fee-rates",
        json!({ "bank_code": "BCA", "fee_kind": "DEBIT_ON_US", "rate_percent": "0.15", "effective_from": "2026-01-01" }),
    )
    .await;

    let settle = |mdr: i64| json!({
        "acquirer": "BCA",
        "settlement_date": today(),
        "business_from": today(),
        "business_to": today(),
        "gross_minor": 600_000,
        "mdr_minor": mdr,
        "lines": [{ "sale_id": null, "tender_seq": null, "site_id": STORE, "tender_kind": "CARD_DEBIT",
                    "auth_code": null, "amount_minor": 600_000, "mdr_minor": mdr }],
    });
    let curate = json!({ "bank_key": "bank_giro", "bank_qualifier": "BCA" });
    // Expected MDR: 0.15% of 600,000 = 900. Within tolerance it posts.
    let fine = api.post(FINANCE, "/api/v1/finance/acquirer-settlements", settle(900)).await;
    let fine_id = fine["settlement_id"].as_str().unwrap_or_else(|| panic!("{fine}")).to_string();
    api.post(FINANCE, &format!("/api/v1/finance/acquirer-settlements/{fine_id}/curate"), curate.clone()).await;

    let books = api.books().await;
    let settled = books.kind("ACQ_SETTLEMENT");
    assert_eq!(settled.dr("6005", STORE), 900, "MDR in the unit's books\n{}", settled.dump());
    assert_eq!(settled.dr("6005", HO), 0, "head office only moves the money");
    assert_eq!(settled.cr("1021", STORE), 600_000, "the card receivable clears");
    assert_eq!(settled.affiliate("2028", STORE, HO), 599_100, "the unit owes HO less by what the bank paid HO");
    assert_eq!(settled.dr("1005", HO), 599_100, "BCA credited head office");
    assert_eq!(settled.affiliate("1057", HO, STORE), -599_100);
    books.assert_sound(true);

    // A settlement far off the rate is a variance, not a quiet posting.
    let wide = api.post(FINANCE, "/api/v1/finance/acquirer-settlements", settle(20_000)).await;
    let wide_id = wide["settlement_id"].as_str().unwrap_or_default().to_string();
    let refused = api
        .call(FINANCE, "POST", &format!("/api/v1/finance/acquirer-settlements/{wide_id}/curate"), Some(curate))
        .await;
    assert!(refused.refused(), "a wide MDR does not post quietly: {refused:?}");
    let detail = api.get(FINANCE, &format!("/api/v1/finance/acquirer-settlements/{wide_id}")).await;
    assert!(detail.to_string().contains("VARIANCE"), "flagged for review: {detail}");
    let after = api.books().await;
    assert_eq!(after.kind("ACQ_SETTLEMENT").entries().len(), settled.entries().len());
    record("a_bca_card_settlement_into_head_office_keeps_the_mdr_in_the_shop", &after);
}

// 5 -------------------------------------------------------------------------

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_cash_deposit_to_head_office_is_two_affiliate_halves(pool: sqlx::PgPool) {
    let api = Api::new(pool).await;
    let shop = open_shop(&api).await;
    api.post_login_to(KEPALA_TOKO, "K0101", STORE).await;
    let shirt = sku(&shop, 0);
    ring(&api, &sale(&[Sold { sku: shirt, price: 249_950, discount: 0 }], &[cash(250_000)], 50, &[], 0)).await;
    post_day(&api).await;

    // The shop manager prepares and hands over the slip; Finance confirms the
    // bank line at head office.
    let prepared = api
        .post(
            KEPALA_TOKO,
            "/api/v1/store-money/deposits",
            json!({ "site_id": STORE, "amount_minor": 249_950, "deposit_date": today(),
                    "bank_key": "bank_giro", "bank_qualifier": "BCA" }),
        )
        .await;
    let id = prepared["deposit_id"].as_str().unwrap_or_else(|| panic!("{prepared}")).to_string();
    api.post(KEPALA_TOKO, &format!("/api/v1/store-money/deposits/{id}/hand-over"), json!({})).await;
    let books = api.books().await;
    let out = books.kind("STORE_DEPOSIT");
    assert_eq!(out.affiliate("2028", STORE, HO), 249_950, "the shop: Dr 2028, it owes HO less\n{}", out.dump());
    assert_eq!(out.cr("1002", STORE), 249_950);
    assert!(!out.has_at("1005", HO), "the bank has not seen it yet");
    // A shop manager cannot confirm the bank side.
    let refused = api
        .call(KEPALA_TOKO, "POST", &format!("/api/v1/store-money/deposits/{id}/confirm"), Some(json!({})))
        .await;
    assert_eq!(refused.status, http::StatusCode::FORBIDDEN, "{refused:?}");
    api.post(FINANCE, &format!("/api/v1/store-money/deposits/{id}/confirm"), json!({})).await;

    let books = api.books().await;
    let deposit = books.kind("STORE_DEPOSIT");
    assert_eq!(deposit.dr("1005", HO), 249_950, "HO Dr bank\n{}", deposit.dump());
    assert_eq!(deposit.affiliate("1057", HO, STORE), -249_950, "HO Cr 1057 (counter the shop)");
    books.assert_sound(true);
    record("a_cash_deposit_to_head_office_is_two_affiliate_halves", &books);
}

// 6 -------------------------------------------------------------------------

fn shift(float: i64, declared: Option<i64>, expected: i64) -> Value {
    let opened = when() - Duration::hours(2);
    let closed = when() + Duration::hours(6);
    json!({
        "shift_id": Uuid::new_v4(),
        "site_id": STORE,
        "terminal_id": "POS-1",
        "status": if declared.is_some() { "CLOSED" } else { "OPEN" },
        "opened_by": "kasir",
        "opened_at": opened,
        "opening_float_minor": float,
        "closed_by": declared.map(|_| "kasir"),
        "closed_at": declared.map(|_| closed),
        "declared_cash_minor": declared,
        "expected_cash_minor": declared.map(|_| expected),
        "variance_minor": declared.map(|d| d - expected),
        "movements": [],
    })
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn closing_a_shift_books_short_and_over_and_modal_kasir_pays_nothing(pool: sqlx::PgPool) {
    let api = Api::new(pool).await;
    open_shop(&api).await;
    api.post_login_to(KEPALA_TOKO, "K0101", STORE).await;

    // Two shifts: one 15,000 short, one 7,000 over.
    let short = shift(500_000, Some(485_000), 500_000);
    let over = shift(500_000, Some(507_000), 500_000);
    api.ingest(POS, vec![("till.shift.recorded", short.clone()), ("till.shift.recorded", over.clone())])
        .await
        .ok("shift facts");
    for fact in [&short, &over] {
        let id = fact["shift_id"].as_str().unwrap_or_default();
        api.post(KEPALA_TOKO, &format!("/api/v1/store-money/shifts/{id}/float"), json!({})).await;
        api.post(FINANCE, &format!("/api/v1/store-money/shifts/{id}/approve-variance"), json!({})).await;
    }
    let books = api.books().await;
    let shifts = books.kind("CASH_SHIFT");
    assert_eq!(shifts.dr("1004", STORE), 1_000_000, "the floats go into Modal Kasir\n{}", shifts.dump());
    assert_eq!(shifts.dr("1023", STORE), 15_000, "short: the store manager owes it");
    assert_eq!(shifts.cr("8008", STORE), 7_000, "over: other income");
    assert_eq!(shifts.cr("1002", STORE) - shifts.dr("1002", STORE), 1_000_000 + 15_000 - 7_000);

    // The till float pays for nothing: not as a shop expense…
    let from_till = api
        .call(
            KEPALA_TOKO,
            "POST",
            "/api/v1/store-money/expenses",
            Some(json!({ "site_id": STORE, "source": "CASH_SHIFT", "category": "expense_household",
                         "amount_minor": 20_000, "spent_on": today(), "vendor": "Toko sebelah" })),
        )
        .await;
    assert!(from_till.refused(), "{from_till:?}");
    // …and not as a journal line, even Finance's.
    let journal = api
        .call(
            FINANCE,
            "POST",
            "/api/v1/finance/journal",
            Some(json!({ "posting_date": today(), "memo": "bayar dari modal kasir", "lines": [
                { "account": { "kind": "account", "account_code": "6042" }, "site_id": STORE, "debit_minor": 20_000, "credit_minor": 0 },
                { "account": { "kind": "account", "account_code": "1004" }, "site_id": STORE, "debit_minor": 0, "credit_minor": 20_000 },
            ]})),
        )
        .await;
    assert!(journal.refused(), "Modal Kasir pays nothing: {journal:?}");
    assert!(journal.text().contains("1004"), "{journal:?}");
    books.assert_sound(true);
    record("closing_a_shift_books_short_and_over_and_modal_kasir_pays_nothing", &books);
}
