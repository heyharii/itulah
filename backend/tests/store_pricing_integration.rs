//! A price published at the centre reaches a shop and shows up on the receipt.
//!
//! It did not, until now. The command type existed, the shop knew how to apply
//! it, `commercial_price_rule` filled in correctly — and the till went on
//! charging the price that was stamped on each unit when it was received. The
//! failure was completely silent: nothing errored, nothing was dropped, and
//! the only symptom was a shop selling at last season's price.
//!
//! So these tests do not check that the price is *stored*. They check that it
//! is *charged*, and that the number on the catalogue screen is the same
//! number. Every assertion is made against a price that differs from the
//! intake price, because the two agreeing is exactly how the bug hid.

use inventory_backend::cloud::domain::{
    catalog_content_hash, sign_command, CatalogItem, PushedCommand, COMMAND_ACTIVATE_PUBLICATION,
    COMMAND_CATALOG_CHUNK, COMMAND_COMMERCIAL_CAMPAIGN, COMMAND_COMMERCIAL_ELIGIBILITY,
};
use inventory_backend::cloud::postgres::command_signing_key;
use inventory_backend::edge::{
    EdgeInventory, EdgeRole, MoveRequest, MovementCause, NodeContext, ReceiveRequest, SaleRequest,
    SiteId, SqliteEdge, SqliteSyncStore,
};
use inventory_backend::sync::port::SyncStore;
use inventory_backend::tender::{PaymentMethod, SaleTender};
use serde_json::json;
use uuid::Uuid;

const KEY: &str = "pricing-test-key";
const SHOP: &str = "store-07";

/// What the shop was told each shirt cost when it arrived in the stockroom.
/// Deliberately unlike every published price in this file.
const INTAKE_PRICE: i64 = 55_000;

struct Shop {
    edge: SqliteEdge,
    sync: SqliteSyncStore,
    next_seq: i64,
}

impl Shop {
    fn open() -> Self {
        let site = SiteId::new(SHOP).unwrap_or_else(|e| panic!("site: {e}"));
        let node =
            NodeContext::new(SHOP, EdgeRole::Store, site).unwrap_or_else(|e| panic!("node: {e}"));
        let edge = SqliteEdge::open_in_memory(node).unwrap_or_else(|e| panic!("edge: {e}"));
        let sync = SqliteSyncStore::new(edge.connection());
        Self {
            edge,
            sync,
            next_seq: 1,
        }
    }

    fn seq(&mut self) -> i64 {
        let seq = self.next_seq;
        self.next_seq += 1;
        seq
    }

    async fn deliver(&mut self, command_type: &str, payload: serde_json::Value) {
        let seq = self.seq();
        let command_id = Uuid::new_v4();
        let key = command_signing_key(KEY);
        let signature = sign_command(
            key.as_bytes(),
            seq,
            &command_id,
            command_type,
            &payload,
            None,
            false,
        );
        let command = PushedCommand {
            seq,
            command_id,
            command_type: command_type.to_string(),
            payload,
            expires_at: None,
            revoked: false,
            signature,
        };
        let report = self
            .sync
            .apply_commands(key.as_bytes(), &[command])
            .await
            .unwrap_or_else(|e| panic!("deliver {command_type}: {e}"));
        assert_eq!(
            report.blocked, None,
            "{command_type} was refused by the shop"
        );
        assert_eq!(report.applied, 1, "{command_type} did not apply");
    }

    /// Deliver the centre's product list, each product its own style.
    async fn deliver_catalogue(&mut self, skus: &[(&str, &str)]) {
        let owned: Vec<(String, &str, &str)> = skus
            .iter()
            .map(|(sku, name)| (format!("ART-{sku}"), *sku, *name))
            .collect();
        self.deliver_styled_catalogue(&owned).await;
    }

    /// The same, with the style said out loud.
    ///
    /// Several SKUs under one `article_code` is the ordinary case — a shirt in
    /// three sizes is three SKUs and one style — and it is the only way to
    /// exercise a markdown written against a range.
    async fn deliver_styled_catalogue(&mut self, rows: &[(String, &str, &str)]) {
        let items: Vec<CatalogItem> = rows
            .iter()
            .map(|(article, sku, name)| CatalogItem {
                sku_code: (*sku).into(),
                name: (*name).into(),
                uom: "EA".into(),
                barcode: None,
                tax_category: "STANDARD".into(),
                active: true,
                base_price_minor: Some(INTAKE_PRICE),
                article_code: Some(article.clone()),
                division_code: Some("PRIA".into()),
                tags: Vec::new(),
                image_url: None,
            })
            .collect();
        let payload = json!({
            "snapshot_id": Uuid::new_v4(),
            "generation": 1,
            "chunk_index": 0,
            "chunk_count": 1,
            "content_hash": catalog_content_hash(&items),
            "items": items,
        });
        self.deliver(COMMAND_CATALOG_CHUNK, payload).await;
    }

    /// Deliver a price book, exactly as `dispatch_publication` builds one.
    async fn deliver_prices(&mut self, version: i64, rules: Vec<serde_json::Value>) {
        let payload = json!({
            "publication_id": Uuid::new_v4(),
            "version": version,
            "name": format!("Harga v{version}"),
            "effective_from": "2020-01-01T00:00:00Z",
            "effective_to": null,
            "tax_rules": [
                {"tax_category": "STANDARD", "rate_bps": 1100, "tax_inclusive": true}
            ],
            "price_rules": rules,
        });
        self.deliver(COMMAND_ACTIVATE_PUBLICATION, payload).await;
    }

    /// Take one item into the shop and put it on the floor, so it can be sold.
    fn stock_one(&self, epc: &str, sku: &str) {
        self.edge
            .receive_store(ReceiveRequest {
                idempotency_key: format!("{epc}-recv"),
                actor_id: "gudang".into(),
                epc: epc.into(),
                sku_code: sku.into(),
                unit_price_minor: INTAKE_PRICE,
                source_dc_id: None,
                shipment_reference: None,
            })
            .unwrap_or_else(|e| panic!("receive: {e}"));
        self.edge
            .move_stock(MoveRequest {
                idempotency_key: format!("{epc}-move"),
                actor_id: "gudang".into(),
                epc: epc.into(),
                from: format!("{SHOP}.warehouse:on_hand"),
                to: format!("{SHOP}.floor:on_hand"),
                quantity: 1,
                cause: MovementCause::NormalMove,
                reason: "Pindah ke lantai jual".into(),
                reference_type: None,
                reference_id: None,
            })
            .unwrap_or_else(|e| panic!("move: {e}"));
    }

    /// What the receipt says, line by line: price charged and on whose authority.
    fn receipt_lines(&self) -> Vec<(String, i64, Option<String>)> {
        let connection = self.edge.connection();
        let guard = connection.lock().unwrap_or_else(|e| panic!("lock: {e}"));
        let mut statement = guard
            .prepare(
                "SELECT sku_code, unit_price_minor, price_source
                   FROM sale_line ORDER BY sku_code",
            )
            .unwrap_or_else(|e| panic!("prepare: {e}"));
        let rows = statement
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
            .unwrap_or_else(|e| panic!("query: {e}"));
        rows.map(|row| row.unwrap_or_else(|e| panic!("row: {e}")))
            .collect()
    }
}

fn rule(sku_code: &str, site_id: Option<&str>, minor: i64) -> serde_json::Value {
    json!({
        "sku_id": Uuid::new_v4(),
        "sku_code": sku_code,
        "site_id": site_id,
        "channel": "STORE",
        "sellable": true,
        "currency": "IDR",
        "unit_price_minor": minor,
        "tax_category": "STANDARD",
    })
}

/// A sale settled the ordinary way, so the tests below read as sales rather
/// than as payment plumbing. The interesting tenders are spelled out where they
/// are the point.
fn cash(amount_minor: i64) -> Vec<SaleTender> {
    vec![SaleTender {
        voucher_authorization_id: None,
        acquirer: None,
        card_kind: None,
        method: PaymentMethod::Cash,
        amount_minor,
        reference: None,
    }]
}

#[tokio::test]
async fn a_published_price_is_what_the_shop_charges() {
    let mut shop = Shop::open();
    shop.deliver_catalogue(&[("KEM001", "Kemeja Putih")]).await;
    shop.deliver_prices(1, vec![rule("KEM001", None, 149_000)])
        .await;

    // The catalogue screen.
    let catalogue = shop
        .edge
        .store_catalog()
        .unwrap_or_else(|e| panic!("catalogue: {e}"));
    assert_eq!(catalogue.len(), 1);
    assert_eq!(catalogue[0].sku_code, "KEM001");
    assert_eq!(catalogue[0].name, "Kemeja Putih");
    assert_eq!(
        catalogue[0].unit_price_minor, 149_000,
        "the catalogue must quote the published price"
    );
    assert_eq!(catalogue[0].price_source, "COMPANY_PRICE");

    // The counter.
    shop.stock_one("EPC00000001", "KEM001");
    let sale = shop
        .edge
        .complete_sale(SaleRequest {
            charges: Vec::new(),
            coupon_codes: Vec::new(),
            customer_id: None,
            idempotency_key: "sale-1".into(),
            actor_id: "kasir".into(),
            epcs: vec!["EPC00000001".into()],
            tenders: cash(149_000),
            coupon_authorizations: Vec::new(),
        })
        .unwrap_or_else(|e| panic!("sale: {e}"));

    assert_eq!(
        sale.total_minor, 149_000,
        "the till charged {} but the published price is 149000 — \
         the intake price was {INTAKE_PRICE}",
        sale.total_minor
    );
    assert_eq!(
        shop.receipt_lines(),
        vec![("KEM001".to_string(), 149_000, Some("COMPANY_PRICE".into()))],
        "the receipt must record which authority set the price"
    );
}

#[tokio::test]
async fn a_shop_specific_price_beats_the_company_one_at_the_counter() {
    let mut shop = Shop::open();
    shop.deliver_catalogue(&[("KEM001", "Kemeja Putih")]).await;
    shop.deliver_prices(
        1,
        vec![
            rule("KEM001", None, 149_000),
            rule("KEM001", Some(SHOP), 119_000),
        ],
    )
    .await;

    let catalogue = shop
        .edge
        .store_catalog()
        .unwrap_or_else(|e| panic!("catalogue: {e}"));
    assert_eq!(catalogue[0].unit_price_minor, 119_000);
    assert_eq!(catalogue[0].price_source, "SITE_PRICE");

    shop.stock_one("EPC00000002", "KEM001");
    let sale = shop
        .edge
        .complete_sale(SaleRequest {
            charges: Vec::new(),
            coupon_codes: Vec::new(),
            customer_id: None,
            idempotency_key: "sale-2".into(),
            actor_id: "kasir".into(),
            epcs: vec!["EPC00000002".into()],
            tenders: cash(119_000),
            coupon_authorizations: Vec::new(),
        })
        .unwrap_or_else(|e| panic!("sale: {e}"));
    assert_eq!(sale.total_minor, 119_000);
    assert_eq!(
        shop.receipt_lines()[0].2.as_deref(),
        Some("SITE_PRICE"),
        "a branch price must be visible as such on the receipt"
    );
}

#[tokio::test]
async fn a_second_price_book_changes_the_price_the_till_takes() {
    let mut shop = Shop::open();
    shop.deliver_catalogue(&[("KEM001", "Kemeja Putih")]).await;
    shop.deliver_prices(1, vec![rule("KEM001", None, 149_000)])
        .await;
    shop.deliver_prices(2, vec![rule("KEM001", None, 99_000)])
        .await;

    let catalogue = shop
        .edge
        .store_catalog()
        .unwrap_or_else(|e| panic!("catalogue: {e}"));
    assert_eq!(
        catalogue[0].unit_price_minor, 99_000,
        "the newest price book governs"
    );
    assert_eq!(catalogue[0].publication_version, 2);

    shop.stock_one("EPC00000003", "KEM001");
    let sale = shop
        .edge
        .complete_sale(SaleRequest {
            charges: Vec::new(),
            coupon_codes: Vec::new(),
            customer_id: None,
            idempotency_key: "sale-3".into(),
            actor_id: "kasir".into(),
            epcs: vec!["EPC00000003".into()],
            tenders: cash(99_000),
            coupon_authorizations: Vec::new(),
        })
        .unwrap_or_else(|e| panic!("sale: {e}"));
    assert_eq!(
        sale.total_minor, 99_000,
        "a price change published at the centre must reach the receipt"
    );
}

#[tokio::test]
async fn a_shop_that_has_never_received_a_price_book_can_still_sell() {
    // A till must not be bricked by a condition the cashier cannot fix. With
    // no publication resident, the intake price stands — and the receipt says
    // so, so the centre can see how much of the fleet is still in this state.
    let shop = Shop::open();
    shop.stock_one("EPC00000004", "KEM001");
    let sale = shop
        .edge
        .complete_sale(SaleRequest {
            charges: Vec::new(),
            coupon_codes: Vec::new(),
            customer_id: None,
            idempotency_key: "sale-4".into(),
            actor_id: "kasir".into(),
            epcs: vec!["EPC00000004".into()],
            tenders: cash(INTAKE_PRICE),
            coupon_authorizations: Vec::new(),
        })
        .unwrap_or_else(|e| panic!("sale: {e}"));
    assert_eq!(sale.total_minor, INTAKE_PRICE);
    assert_eq!(
        shop.receipt_lines()[0].2.as_deref(),
        Some("INTAKE_PRICE"),
        "a sale priced off the old basis must be identifiable as one"
    );
}

#[tokio::test]
async fn an_item_missing_from_a_live_price_book_is_refused_not_guessed() {
    // The opposite case to the one above, and the reason it must be a
    // different code path: here the price book IS here and does not list the
    // item. Falling back to the intake price would sell it at a number nobody
    // approved, and would look exactly like a normal sale afterwards.
    let mut shop = Shop::open();
    shop.deliver_catalogue(&[("KEM001", "Kemeja Putih"), ("CEL001", "Celana Chino")])
        .await;
    shop.deliver_prices(1, vec![rule("KEM001", None, 149_000)])
        .await;

    shop.stock_one("EPC00000005", "CEL001");
    let refused = shop.edge.complete_sale(SaleRequest {
        charges: Vec::new(),
        coupon_codes: Vec::new(),
        customer_id: None,
        idempotency_key: "sale-5".into(),
        actor_id: "kasir".into(),
        epcs: vec!["EPC00000005".into()],
        tenders: cash(INTAKE_PRICE),
        coupon_authorizations: Vec::new(),
    });
    assert!(
        refused.is_err(),
        "an unpriced item must stop the sale, not be sold at the intake price"
    );

    // And it is not on the shelf either, so nobody could have been quoted it.
    let catalogue = shop
        .edge
        .store_catalog()
        .unwrap_or_else(|e| panic!("catalogue: {e}"));
    let listed: Vec<&str> = catalogue.iter().map(|row| row.sku_code.as_str()).collect();
    assert_eq!(listed, vec!["KEM001"]);
}

#[tokio::test]
async fn one_shops_price_never_governs_another() {
    let mut shop = Shop::open();
    shop.deliver_catalogue(&[("KEM001", "Kemeja Putih")]).await;
    shop.deliver_prices(
        1,
        vec![
            rule("KEM001", None, 149_000),
            // A rule for a different branch. The centre would not normally
            // send this one here at all; if it ever does, it must not apply.
            rule("KEM001", Some("store-99"), 10_000),
        ],
    )
    .await;

    let catalogue = shop
        .edge
        .store_catalog()
        .unwrap_or_else(|e| panic!("catalogue: {e}"));
    assert_eq!(
        catalogue[0].unit_price_minor, 149_000,
        "a bargain at another branch is not a bargain here"
    );
}

// ---------------------------------------------------------------------------
// Markdown, promotion, coupon — the whole way down
// ---------------------------------------------------------------------------

impl Shop {
    /// Deliver a price book that also carries clearance, promotions and codes.
    async fn deliver_commercial(
        &mut self,
        version: i64,
        prices: Vec<serde_json::Value>,
        markdowns: Vec<serde_json::Value>,
        rules: Vec<serde_json::Value>,
        coupons: Vec<serde_json::Value>,
    ) {
        self.deliver_full(version, prices, markdowns, rules, coupons, vec![])
            .await;
    }

    async fn deliver_full(
        &mut self,
        version: i64,
        prices: Vec<serde_json::Value>,
        markdowns: Vec<serde_json::Value>,
        rules: Vec<serde_json::Value>,
        coupons: Vec<serde_json::Value>,
        campaigns: Vec<serde_json::Value>,
    ) {
        let payload = json!({
            "publication_id": Uuid::new_v4(),
            "version": version,
            "name": format!("Harga v{version}"),
            "effective_from": "2020-01-01T00:00:00Z",
            "effective_to": null,
            "tax_rules": [
                {"tax_category": "STANDARD", "rate_bps": 1100, "tax_inclusive": true}
            ],
            "price_rules": prices,
            "markdowns": markdowns,
            "rules": rules,
            "coupons": coupons,
            "campaigns": campaigns,
        });
        self.deliver(COMMAND_ACTIVATE_PUBLICATION, payload).await;
    }

    /// Every fact this shop has queued for the centre, oldest first.
    fn queued_facts(&self) -> Vec<(String, serde_json::Value)> {
        let connection = self.edge.connection();
        let guard = connection.lock().unwrap_or_else(|e| panic!("lock: {e}"));
        let mut statement = guard
            .prepare("SELECT event_type, payload FROM sync_fact_log ORDER BY seq")
            .unwrap_or_else(|e| panic!("prepare: {e}"));
        let rows = statement
            .query_map([], |row| {
                let payload: String = row.get(1)?;
                Ok((row.get::<_, String>(0)?, payload))
            })
            .unwrap_or_else(|e| panic!("query: {e}"));
        rows.map(|row| {
            let (event_type, payload) = row.unwrap_or_else(|e| panic!("row: {e}"));
            (
                event_type,
                serde_json::from_str(&payload).unwrap_or_else(|e| panic!("payload: {e}")),
            )
        })
        .collect()
    }

    /// Pull the switch on a campaign, the way `switch_campaign` does at the centre.
    ///
    /// A lane of its own, and that is the point being tested: before this
    /// command existed, a campaign's status only ever reached a shop inside a
    /// price book. Books are frozen and seasonal, so "stop the promo" changed
    /// Postgres and nothing at any counter until somebody happened to cut a new
    /// one — which is to say, not on the day it mattered.
    async fn switch_campaign(&mut self, campaign_id: &str, status: &str) {
        let payload = json!({
            "switched_at": "2026-09-03T00:00:00Z",
            "campaigns": [{
                "campaign_id": campaign_id,
                "status": status,
                "valid_from": null,
                "valid_to": null,
            }],
        });
        self.deliver(COMMAND_COMMERCIAL_CAMPAIGN, payload).await;
    }

    fn sell(
        &self,
        epc: &str,
        handed_over: i64,
        coupons: &[&str],
    ) -> inventory_backend::edge::SaleResult {
        self.edge
            .complete_sale(SaleRequest {
                charges: Vec::new(),
                coupon_codes: coupons.iter().map(|c| (*c).to_string()).collect(),
                customer_id: None,
                idempotency_key: format!("{epc}-sale"),
                actor_id: "kasir".into(),
                epcs: vec![epc.into()],
                tenders: cash(handed_over),
                coupon_authorizations: Vec::new(),
            })
            .unwrap_or_else(|e| panic!("sale: {e}"))
    }
}

fn markdown(sku: &str, minor: i64) -> serde_json::Value {
    json!({
        "markdown_id": format!("MD-{sku}"),
        "sku_code": sku,
        "site_id": null,
        "replacement_unit_price_minor": minor,
        "priority": 0,
        "effective_from": "2020-01-01T00:00:00Z",
        "effective_to": null,
    })
}

/// A clearance written against a whole style, not one product.
fn article_markdown(article: &str, minor: i64) -> serde_json::Value {
    json!({
        "markdown_id": format!("MD-{article}"),
        "article_code": article,
        "site_id": null,
        "replacement_unit_price_minor": minor,
        "priority": 0,
        "effective_from": "2020-01-01T00:00:00Z",
        "effective_to": null,
    })
}

/// A clearance that runs only between two hours of the day, in the shop's time.
fn flash_markdown(sku: &str, minor: i64, from_minute: u32, to_minute: u32) -> serde_json::Value {
    let mut drop = markdown(sku, minor);
    drop["from_minute"] = json!(from_minute);
    drop["to_minute"] = json!(to_minute);
    drop
}

/// A clearance that belongs to a campaign, rather than standing on its own.
fn markdown_under(sku: &str, minor: i64, campaign_id: &str) -> serde_json::Value {
    let mut drop = markdown(sku, minor);
    drop["campaign_id"] = json!(campaign_id);
    drop
}

fn percent_off(id: &str, bps: i64) -> serde_json::Value {
    json!({
        "rule_id": id,
        "name": format!("Diskon {}%", bps / 100),
        "status": "ACTIVE",
        "effect": {"kind": "PERCENT", "bps": bps},
        "stacking": "ALONE",
        "priority": 0,
    })
}

#[tokio::test]
async fn a_clearance_price_published_at_the_centre_is_charged_at_the_counter() {
    let mut shop = Shop::open();
    shop.deliver_catalogue(&[("KEM001", "Kemeja Putih")]).await;
    shop.deliver_commercial(
        1,
        vec![rule("KEM001", None, 200_000)],
        vec![markdown("KEM001", 99_000)],
        vec![],
        vec![],
    )
    .await;

    let catalogue = shop
        .edge
        .store_catalog()
        .unwrap_or_else(|e| panic!("catalogue: {e}"));
    assert_eq!(catalogue[0].unit_price_minor, 99_000, "what it costs now");
    assert_eq!(
        catalogue[0].base_unit_price_minor, 200_000,
        "and what it was, so the shelf edge can show both"
    );
    assert_eq!(catalogue[0].price_source, "MARKDOWN");

    shop.stock_one("EPC10000001", "KEM001");
    let sale = shop.sell("EPC10000001", 99_000, &[]);
    assert_eq!(sale.total_minor, 99_000);
    assert_eq!(
        shop.receipt_lines()[0].2.as_deref(),
        Some("MARKDOWN"),
        "a clearance sale must be identifiable as one, not booked as a discount"
    );
}

#[tokio::test]
async fn a_promotion_published_at_the_centre_comes_off_at_the_counter() {
    let mut shop = Shop::open();
    shop.deliver_catalogue(&[("KEM001", "Kemeja Putih")]).await;
    shop.deliver_commercial(
        1,
        vec![rule("KEM001", None, 200_000)],
        vec![],
        vec![percent_off("R1", 2_500)],
        vec![],
    )
    .await;

    shop.stock_one("EPC10000002", "KEM001");
    let sale = shop.sell("EPC10000002", 150_000, &[]);
    assert_eq!(sale.total_minor, 150_000, "25% off two hundred thousand");
    assert_eq!(sale.promotions.len(), 1);
    assert!(sale.promotions[0].applied);
    assert_eq!(sale.promotions[0].benefit_minor, 50_000);
}

#[tokio::test]
async fn a_coupon_gates_the_promotion_it_unlocks() {
    let mut shop = Shop::open();
    shop.deliver_catalogue(&[("KEM001", "Kemeja Putih")]).await;
    let mut gated = percent_off("R1", 2_000);
    gated["coupon_code"] = json!("LEBARAN");
    shop.deliver_commercial(
        1,
        vec![rule("KEM001", None, 200_000)],
        vec![],
        vec![gated],
        vec![json!({
            "code": "LEBARAN",
            "rule_id": "R1",
            "active": true,
            "customer_id": null,
            "valid_from": null,
            "valid_to": null,
            "max_uses": null,
        })],
    )
    .await;

    shop.stock_one("EPC10000003", "KEM001");
    shop.stock_one("EPC10000004", "KEM001");

    let without = shop.sell("EPC10000003", 200_000, &[]);
    assert_eq!(without.total_minor, 200_000, "no code, no discount");
    assert_eq!(
        without.promotions[0].reason.as_deref(),
        Some("this promotion needs a coupon code"),
        "the cashier is told why, not left guessing"
    );

    let with = shop.sell("EPC10000004", 160_000, &["LEBARAN"]);
    assert_eq!(with.total_minor, 160_000);
    assert!(with.promotions[0].applied);
}

#[tokio::test]
async fn a_markdown_and_a_promotion_stack_in_the_right_order() {
    let mut shop = Shop::open();
    shop.deliver_catalogue(&[("KEM001", "Kemeja Putih")]).await;
    shop.deliver_commercial(
        1,
        vec![rule("KEM001", None, 200_000)],
        vec![markdown("KEM001", 100_000)],
        vec![percent_off("R1", 1_000)],
        vec![],
    )
    .await;

    shop.stock_one("EPC10000005", "KEM001");
    let sale = shop.sell("EPC10000005", 90_000, &[]);
    assert_eq!(
        sale.total_minor, 90_000,
        "ten per cent off the clearance price, not off the original"
    );
    assert_eq!(sale.promotions[0].benefit_minor, 10_000);
}

#[tokio::test]
async fn points_are_earned_without_changing_what_is_paid() {
    let mut shop = Shop::open();
    shop.deliver_catalogue(&[("KEM001", "Kemeja Putih")]).await;
    shop.deliver_commercial(
        1,
        vec![rule("KEM001", None, 200_000)],
        vec![],
        vec![json!({
            "rule_id": "E1",
            "name": "Poin belanja",
            "status": "ACTIVE",
            "effect": {
                "kind": "EARN_POINTS",
                "mode": "SPEND_RATE",
                "spend_per_point": {"minor": 10_000},
            },
        })],
        vec![],
    )
    .await;

    shop.stock_one("EPC10000006", "KEM001");
    let sale = shop.sell("EPC10000006", 200_000, &[]);
    assert_eq!(sale.total_minor, 200_000, "points cost the shopper nothing");
    assert_eq!(sale.points_earned, 20);
}

#[tokio::test]
async fn a_promotion_this_build_cannot_read_costs_an_offer_not_the_sale() {
    // The centre may run ahead of a shop. A promotion in a shape this build
    // does not understand must not take the till down with it — the prices in
    // the same publication are still correct and must still be charged.
    let mut shop = Shop::open();
    shop.deliver_catalogue(&[("KEM001", "Kemeja Putih")]).await;
    shop.deliver_commercial(
        1,
        vec![rule("KEM001", None, 200_000)],
        vec![],
        vec![json!({
            "rule_id": "R-FUTURE",
            "name": "Something from a later build",
            "status": "ACTIVE",
            "effect": {"kind": "TIME_TRAVEL_DISCOUNT", "flux": 88},
        })],
        vec![],
    )
    .await;

    shop.stock_one("EPC10000007", "KEM001");
    let sale = shop.sell("EPC10000007", 200_000, &[]);
    assert_eq!(
        sale.total_minor, 200_000,
        "the price still applies even though the promotion could not be read"
    );
    assert!(sale.promotions.is_empty());
}

#[tokio::test]
async fn a_markdown_that_names_nothing_is_refused_at_the_door() {
    let mut shop = Shop::open();
    shop.deliver_catalogue(&[("KEM001", "Kemeja Putih")]).await;

    let payload = json!({
        "publication_id": Uuid::new_v4(),
        "version": 1,
        "name": "Harga v1",
        "effective_from": "2020-01-01T00:00:00Z",
        "effective_to": null,
        "tax_rules": [{"tax_category": "STANDARD", "rate_bps": 1100, "tax_inclusive": true}],
        "price_rules": [rule("KEM001", None, 200_000)],
        "markdowns": [{
            "markdown_id": "MD-EVERYTHING",
            "sku_code": null,
            "article_code": null,
            "replacement_unit_price_minor": 1_000,
            "effective_from": "2020-01-01T00:00:00Z",
        }],
    });
    let seq = shop.seq();
    let command_id = Uuid::new_v4();
    let key = command_signing_key(KEY);
    let signature = sign_command(
        key.as_bytes(),
        seq,
        &command_id,
        COMMAND_ACTIVATE_PUBLICATION,
        &payload,
        None,
        false,
    );
    let report = shop
        .sync
        .apply_commands(
            key.as_bytes(),
            &[PushedCommand {
                seq,
                command_id,
                command_type: COMMAND_ACTIVATE_PUBLICATION.to_string(),
                payload,
                expires_at: None,
                revoked: false,
                signature,
            }],
        )
        .await
        .unwrap_or_else(|e| panic!("apply: {e}"));

    assert!(
        report.blocked.is_some(),
        "a markdown naming neither a product nor a style would clear the whole shop"
    );
}

// ---------------------------------------------------------------------------
// What the centre is told about a sale
// ---------------------------------------------------------------------------

/// The one sale fact this shop has queued.
fn sale_fact(shop: &Shop) -> serde_json::Value {
    let facts = shop.queued_facts();
    let money: Vec<&serde_json::Value> = facts
        .iter()
        .filter(|(kind, _)| kind == "sales.completed")
        .map(|(_, payload)| payload)
        .collect();
    assert_eq!(money.len(), 1, "exactly one money fact per sale");
    money[0].clone()
}

#[tokio::test]
async fn the_centre_is_told_what_was_charged_not_what_the_unit_cost_at_intake() {
    // The bug this guards: the fact carried the intake price on its lines while
    // the header carried the promoted total. The centre re-sums the lines and
    // refuses a sale that does not reconcile — so every sale from a shop with a
    // price book would have been rejected at ingest. Rejected sales are
    // invisible revenue, not a visible error.
    let mut shop = Shop::open();
    shop.deliver_catalogue(&[("KEM001", "Kemeja Putih")]).await;
    shop.deliver_commercial(
        1,
        vec![rule("KEM001", None, 200_000)],
        vec![],
        vec![percent_off("R1", 2_500)],
        vec![],
    )
    .await;

    shop.stock_one("EPC20000001", "KEM001");
    let sale = shop.sell("EPC20000001", 150_000, &[]);
    assert_eq!(sale.total_minor, 150_000);

    let fact = sale_fact(&shop);
    assert_eq!(fact["total_minor"], 150_000);
    let lines = fact["lines"]
        .as_array()
        .unwrap_or_else(|| panic!("no lines on the fact"));
    let summed: i64 = lines
        .iter()
        .map(|line| line["line_total_minor"].as_i64().unwrap_or(0))
        .sum();
    assert_eq!(
        summed, 150_000,
        "the centre re-sums these and refuses a sale that does not reconcile"
    );
    assert_eq!(fact["discount_total_minor"], 50_000);
    assert_eq!(lines[0]["price_source"], "COMPANY_PRICE");
    assert_eq!(lines[0]["publication_version"], 1);
    assert!(
        fact["pricing_trace_id"]
            .as_str()
            .is_some_and(|id| !id.is_empty()),
        "a disputed receipt must be reproducible, not arguable"
    );
}

#[tokio::test]
async fn the_centre_accepts_the_sale_it_is_told_about() {
    // The same check the cloud runs at ingest, run here against the real fact,
    // so this suite fails at the shop rather than at the boundary.
    let mut shop = Shop::open();
    shop.deliver_catalogue(&[("KEM001", "Kemeja Putih"), ("CEL001", "Celana")])
        .await;
    shop.deliver_commercial(
        1,
        vec![rule("KEM001", None, 200_000), rule("CEL001", None, 300_000)],
        vec![markdown("KEM001", 150_000)],
        vec![percent_off("R1", 1_000)],
        vec![],
    )
    .await;

    shop.stock_one("EPC20000002", "KEM001");
    shop.stock_one("EPC20000003", "CEL001");
    let sale = shop
        .edge
        .complete_sale(SaleRequest {
            charges: Vec::new(),
            coupon_codes: Vec::new(),
            customer_id: None,
            idempotency_key: "sale-two-lines".into(),
            actor_id: "kasir".into(),
            epcs: vec!["EPC20000002".into(), "EPC20000003".into()],
            tenders: cash(405_000),
            coupon_authorizations: Vec::new(),
        })
        .unwrap_or_else(|e| panic!("sale: {e}"));
    // 150,000 + 300,000 = 450,000, less ten per cent = 405,000.
    assert_eq!(sale.total_minor, 405_000);

    let parsed = inventory_backend::cloud::domain::parse_sales_completed(&sale_fact(&shop))
        .unwrap_or_else(|error| panic!("the centre would have refused this sale: {error}"));
    assert_eq!(parsed.total_minor, 405_000);
    assert_eq!(parsed.discount_total_minor, 45_000);
}

#[tokio::test]
async fn a_shop_on_the_old_basis_still_reconciles_at_the_centre() {
    // No price book, so the intake price stands and no line total is sent. The
    // centre must reconstruct the old meaning rather than read a missing field
    // as zero revenue.
    let shop = Shop::open();
    shop.stock_one("EPC20000004", "KEM001");
    shop.sell("EPC20000004", INTAKE_PRICE, &[]);

    let mut fact = sale_fact(&shop);
    // Strip the new field, exactly as a shop running an older build would.
    for line in fact["lines"]
        .as_array_mut()
        .unwrap_or_else(|| panic!("no lines"))
    {
        line.as_object_mut()
            .unwrap_or_else(|| panic!("line is not an object"))
            .remove("line_total_minor");
    }
    let parsed = inventory_backend::cloud::domain::parse_sales_completed(&fact)
        .unwrap_or_else(|error| panic!("an older shop must still be understood: {error}"));
    assert_eq!(parsed.total_minor, INTAKE_PRICE);
}

// ---------------------------------------------------------------------------
// Campaigns and group prices, over the wire
// ---------------------------------------------------------------------------

fn campaign(id: &str, status: &str) -> serde_json::Value {
    json!({
        "campaign_id": id,
        "name": format!("Kampanye {id}"),
        "status": status,
        "valid_from": null,
        "valid_to": null,
        "budget_minor": null,
        "max_uses": null,
    })
}

#[tokio::test]
async fn pausing_a_campaign_at_the_centre_stops_its_offers_at_the_shop() {
    let mut shop = Shop::open();
    shop.deliver_catalogue(&[("KEM001", "Kemeja Putih")]).await;
    let mut offer = percent_off("R1", 2_000);
    offer["campaign_id"] = json!("C1");
    offer["stacking"] = json!("STACKABLE");

    shop.deliver_full(
        1,
        vec![rule("KEM001", None, 200_000)],
        vec![],
        vec![offer.clone()],
        vec![],
        vec![campaign("C1", "ACTIVE")],
    )
    .await;
    shop.stock_one("EPC30000001", "KEM001");
    let running = shop.sell("EPC30000001", 160_000, &[]);
    assert_eq!(running.total_minor, 160_000);

    // A second publication, with the campaign paused.
    shop.deliver_full(
        2,
        vec![rule("KEM001", None, 200_000)],
        vec![],
        vec![{
            let mut later = offer.clone();
            later["rule_id"] = json!("R2");
            later
        }],
        vec![],
        vec![campaign("C1-PAUSED", "PAUSED")],
    )
    .await;
    // Point the second version's rule at the paused campaign.
    {
        let connection = shop.edge.connection();
        let guard = connection.lock().unwrap_or_else(|e| panic!("lock: {e}"));
        guard
            .execute(
                "UPDATE commercial_rule
                    SET definition_json = json_set(definition_json,'$.campaign_id','C1-PAUSED')
                  WHERE rule_id='R2'",
                [],
            )
            .unwrap_or_else(|e| panic!("repoint: {e}"));
        guard
            .execute("DELETE FROM commercial_rule WHERE rule_id='R1'", [])
            .unwrap_or_else(|e| panic!("retire: {e}"));
    }

    shop.stock_one("EPC30000002", "KEM001");
    let paused = shop.sell("EPC30000002", 200_000, &[]);
    assert_eq!(
        paused.total_minor, 200_000,
        "one switch at the centre stops the promotion at every till"
    );
}

#[tokio::test]
async fn an_offer_whose_campaign_never_arrived_does_not_run() {
    // The dangerous default would treat a missing campaign as no campaign,
    // leaving the offer running with no envelope — so pausing it at the centre
    // would stop it everywhere except the shops already out of date.
    let mut shop = Shop::open();
    shop.deliver_catalogue(&[("KEM001", "Kemeja Putih")]).await;
    let mut orphan = percent_off("R1", 5_000);
    orphan["campaign_id"] = json!("C-MISSING");

    shop.deliver_full(
        1,
        vec![rule("KEM001", None, 200_000)],
        vec![],
        vec![orphan],
        vec![],
        vec![], // the campaign is not sent
    )
    .await;

    shop.stock_one("EPC30000003", "KEM001");
    let sale = shop.sell("EPC30000003", 200_000, &[]);
    assert_eq!(sale.total_minor, 200_000);
    assert_eq!(
        sale.promotions[0].reason.as_deref(),
        Some("this shop has not received that promotion")
    );
}

#[tokio::test]
async fn a_price_for_a_group_of_shops_reaches_the_shops_in_it() {
    let mut shop = Shop::open();
    shop.deliver_catalogue(&[("KEM001", "Kemeja Putih")]).await;
    let mut grouped = rule("KEM001", None, 175_000);
    grouped["site_ids"] = json!([SHOP, "store-08"]);

    shop.deliver_commercial(
        1,
        vec![rule("KEM001", None, 200_000), grouped],
        vec![],
        vec![],
        vec![],
    )
    .await;

    let catalogue = shop
        .edge
        .store_catalog()
        .unwrap_or_else(|e| panic!("catalogue: {e}"));
    assert_eq!(catalogue[0].unit_price_minor, 175_000);
    assert_eq!(catalogue[0].price_source, "SITE_GROUP_PRICE");

    shop.stock_one("EPC30000004", "KEM001");
    assert_eq!(shop.sell("EPC30000004", 175_000, &[]).total_minor, 175_000);
}

#[tokio::test]
async fn a_group_that_does_not_include_this_shop_leaves_it_on_the_company_price() {
    let mut shop = Shop::open();
    shop.deliver_catalogue(&[("KEM001", "Kemeja Putih")]).await;
    let mut elsewhere = rule("KEM001", None, 50_000);
    elsewhere["site_ids"] = json!(["store-08", "store-09"]);

    shop.deliver_commercial(
        1,
        vec![rule("KEM001", None, 200_000), elsewhere],
        vec![],
        vec![],
        vec![],
    )
    .await;

    let catalogue = shop
        .edge
        .store_catalog()
        .unwrap_or_else(|e| panic!("catalogue: {e}"));
    assert_eq!(
        catalogue[0].unit_price_minor, 200_000,
        "a bargain for other branches is not a bargain here"
    );
}

#[tokio::test]
async fn a_price_that_claims_two_levels_is_refused_at_the_door() {
    let mut shop = Shop::open();
    shop.deliver_catalogue(&[("KEM001", "Kemeja Putih")]).await;
    let mut confused = rule("KEM001", Some(SHOP), 150_000);
    confused["site_ids"] = json!(["store-08"]);

    let payload = json!({
        "publication_id": Uuid::new_v4(),
        "version": 1,
        "name": "Harga v1",
        "effective_from": "2020-01-01T00:00:00Z",
        "effective_to": null,
        "tax_rules": [{"tax_category": "STANDARD", "rate_bps": 1100, "tax_inclusive": true}],
        "price_rules": [confused],
    });
    let seq = shop.seq();
    let command_id = Uuid::new_v4();
    let key = command_signing_key(KEY);
    let signature = sign_command(
        key.as_bytes(),
        seq,
        &command_id,
        COMMAND_ACTIVATE_PUBLICATION,
        &payload,
        None,
        false,
    );
    let report = shop
        .sync
        .apply_commands(
            key.as_bytes(),
            &[PushedCommand {
                seq,
                command_id,
                command_type: COMMAND_ACTIVATE_PUBLICATION.to_string(),
                payload,
                expires_at: None,
                revoked: false,
                signature,
            }],
        )
        .await
        .unwrap_or_else(|e| panic!("apply: {e}"));
    assert!(
        report.blocked.is_some(),
        "a price claiming two levels has no single right reading; picking one \
         silently is how the centre and a till come to disagree"
    );
}

// ---------------------------------------------------------------------------
// Promotions that are actually counted
// ---------------------------------------------------------------------------

impl Shop {
    /// Deliver what the centre has counted so far — and, as a centre does, how
    /// far it had applied this shop's stream when it counted. Here: everything
    /// the shop has queued, because these tests stand for a centre that has
    /// caught up with every sale they rang.
    async fn deliver_usage(&mut self, counts: Vec<serde_json::Value>) {
        let (origin_id, generation, head) = self.stream_head();
        self.deliver_usage_through(
            counts,
            json!([{
                "origin_id": origin_id, "generation": generation, "applied_seq": head,
            }]),
        )
        .await;
    }

    /// The same, with the centre's position said out loud.
    async fn deliver_usage_through(
        &mut self,
        counts: Vec<serde_json::Value>,
        applied_through: serde_json::Value,
    ) {
        self.deliver(
            inventory_backend::cloud::domain::COMMAND_COMMERCIAL_USAGE,
            json!({
                "counted_at": "2026-09-01T00:00:00Z",
                "counts": counts,
                "applied_through": applied_through,
            }),
        )
        .await;
    }

    /// A count from a centre older than `applied_through`, which says nothing
    /// about how far it had got.
    async fn deliver_usage_from_an_older_centre(&mut self, counts: Vec<serde_json::Value>) {
        self.deliver(
            inventory_backend::cloud::domain::COMMAND_COMMERCIAL_USAGE,
            json!({ "counted_at": "2026-09-01T00:00:00Z", "counts": counts }),
        )
        .await;
    }

    /// This shop's stream, and the last seq it has queued.
    fn stream_head(&self) -> (String, i64, i64) {
        let connection = self.edge.connection();
        let guard = connection.lock().unwrap_or_else(|e| panic!("lock: {e}"));
        guard
            .query_row(
                "SELECT origin_id, generation, next_seq FROM sync_origin WHERE singleton = 1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap_or_else(|e| panic!("stream head: {e}"))
    }

    /// What this till is counting on its own, per (kind, key).
    fn local_usage(&self) -> Vec<(String, String, i64, i64)> {
        let connection = self.edge.connection();
        let guard = connection.lock().unwrap_or_else(|e| panic!("lock: {e}"));
        let mut statement = guard
            .prepare(
                "SELECT kind, key, SUM(uses), SUM(spent_minor) FROM commercial_usage_local
                  GROUP BY kind, key ORDER BY kind, key",
            )
            .unwrap_or_else(|e| panic!("prepare: {e}"));
        let rows = statement
            .query_map([], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
            })
            .unwrap_or_else(|e| panic!("query: {e}"));
        rows.map(|row| row.unwrap_or_else(|e| panic!("row: {e}")))
            .collect()
    }

    /// Run a statement against the till's own database, for the states a test
    /// cannot reach through the node's API.
    fn execute(&self, sql: &str) {
        let connection = self.edge.connection();
        let guard = connection.lock().unwrap_or_else(|e| panic!("lock: {e}"));
        guard
            .execute_batch(sql)
            .unwrap_or_else(|e| panic!("{sql}: {e}"));
    }
}

#[tokio::test]
async fn a_sale_tells_the_centre_which_promotion_came_off_and_who_bought_it() {
    // Only the total used to travel, which left two questions unanswerable:
    // what a promotion cost, and whether a single-use coupon had been spent.
    let mut shop = Shop::open();
    shop.deliver_catalogue(&[("KEM001", "Kemeja Putih")]).await;
    let mut gated = percent_off("R1", 2_000);
    gated["coupon_code"] = json!("LEBARAN");
    shop.deliver_commercial(
        1,
        vec![rule("KEM001", None, 200_000)],
        vec![],
        vec![gated],
        vec![json!({
            "code": "LEBARAN", "rule_id": "R1", "active": true,
            "customer_id": null, "valid_from": null, "valid_to": null,
            "max_uses": 1,
        })],
    )
    .await;

    shop.stock_one("EPC40000001", "KEM001");
    let sale = shop
        .edge
        .complete_sale(SaleRequest {
            charges: Vec::new(),
            coupon_codes: vec!["LEBARAN".into()],
            customer_id: Some("member-1".into()),
            idempotency_key: "sale-counted".into(),
            actor_id: "kasir".into(),
            epcs: vec!["EPC40000001".into()],
            tenders: cash(160_000),
            coupon_authorizations: Vec::new(),
        })
        .unwrap_or_else(|e| panic!("sale: {e}"));
    assert_eq!(sale.total_minor, 160_000);

    let fact = sale_fact(&shop);
    assert_eq!(
        fact["customer_id"], "member-1",
        "points travel with a sale; without the member there is nobody to credit"
    );
    let promotions = fact["promotions"]
        .as_array()
        .unwrap_or_else(|| panic!("no promotions on the fact: {fact}"));
    assert_eq!(promotions.len(), 1);
    assert_eq!(promotions[0]["rule_id"], "R1");
    assert_eq!(promotions[0]["benefit_minor"], 40_000);
    assert_eq!(
        promotions[0]["coupon_code"], "LEBARAN",
        "the centre cannot count a redemption it is never told about"
    );

    // The whole fact still passes the centre's own check.
    inventory_backend::cloud::domain::parse_sales_completed(&fact)
        .unwrap_or_else(|error| panic!("the centre would have refused this sale: {error}"));
}

#[tokio::test]
async fn a_refused_coupon_is_not_reported_as_redeemed() {
    // A code typed and rejected has not been spent. Counting it would burn a
    // customer's coupon for a discount they never got.
    let mut shop = Shop::open();
    shop.deliver_catalogue(&[("KEM001", "Kemeja Putih")]).await;
    let mut gated = percent_off("R1", 2_000);
    gated["coupon_code"] = json!("LEBARAN");
    shop.deliver_commercial(
        1,
        vec![rule("KEM001", None, 200_000)],
        vec![],
        vec![gated],
        vec![json!({
            "code": "LEBARAN", "rule_id": "R1", "active": false,
            "customer_id": null, "valid_from": null, "valid_to": null,
            "max_uses": null,
        })],
    )
    .await;

    shop.stock_one("EPC40000002", "KEM001");
    let sale = shop.sell("EPC40000002", 200_000, &["LEBARAN"]);
    assert_eq!(
        sale.total_minor, 200_000,
        "an inactive coupon opens nothing"
    );

    let fact = sale_fact(&shop);
    assert!(
        fact["promotions"].as_array().is_some_and(Vec::is_empty),
        "nothing was redeemed, so nothing may be counted: {fact}"
    );
}

#[tokio::test]
async fn a_single_use_coupon_stops_working_once_the_centre_has_counted_it() {
    // The hole this closes: the use count lived inside the publication, which
    // is immutable once published and travels on the rhythm of a season. So
    // nothing ever incremented it, and a single-use coupon worked at every
    // shop, forever.
    let mut shop = Shop::open();
    shop.deliver_catalogue(&[("KEM001", "Kemeja Putih")]).await;
    let mut gated = percent_off("R1", 2_000);
    gated["coupon_code"] = json!("LEBARAN");
    shop.deliver_commercial(
        1,
        vec![rule("KEM001", None, 200_000)],
        vec![],
        vec![gated],
        vec![json!({
            "code": "LEBARAN", "rule_id": "R1", "active": true,
            "customer_id": null, "valid_from": null, "valid_to": null,
            "max_uses": 1,
        })],
    )
    .await;

    shop.stock_one("EPC40000003", "KEM001");
    shop.stock_one("EPC40000004", "KEM001");
    assert_eq!(
        shop.sell("EPC40000003", 160_000, &["LEBARAN"]).total_minor,
        160_000,
        "the first use works"
    );

    // The centre counts it and tells the fleet — a lane of its own, because a
    // count changes with every sale and a price book does not.
    shop.deliver_usage(vec![json!({
        "kind": "COUPON", "key": "LEBARAN", "uses": 1, "spent_minor": 40_000,
    })])
    .await;

    let second = shop.sell("EPC40000004", 200_000, &["LEBARAN"]);
    assert_eq!(
        second.total_minor, 200_000,
        "the same coupon must not work twice across the fleet"
    );
    assert_eq!(
        second.promotions[0].reason.as_deref(),
        Some("that coupon has been used already")
    );
}

#[tokio::test]
async fn a_campaign_budget_actually_runs_out() {
    let mut shop = Shop::open();
    shop.deliver_catalogue(&[("KEM001", "Kemeja Putih")]).await;
    let mut offer = percent_off("R1", 2_000);
    offer["campaign_id"] = json!("C1");
    shop.deliver_full(
        1,
        vec![rule("KEM001", None, 200_000)],
        vec![],
        vec![offer],
        vec![],
        vec![{
            let mut envelope = campaign("C1", "ACTIVE");
            envelope["budget_minor"] = json!(50_000);
            envelope
        }],
    )
    .await;

    shop.stock_one("EPC40000005", "KEM001");
    shop.stock_one("EPC40000006", "KEM001");
    assert_eq!(
        shop.sell("EPC40000005", 160_000, &[]).total_minor,
        160_000,
        "there was budget for the first"
    );

    // Forty thousand of the fifty is gone; the centre says so.
    shop.deliver_usage(vec![json!({
        "kind": "CAMPAIGN", "key": "C1", "uses": 1, "spent_minor": 40_000,
    })])
    .await;

    let second = shop.sell("EPC40000006", 190_000, &[]);
    assert_eq!(
        second.total_minor, 190_000,
        "only ten thousand of budget was left, so only ten thousand came off"
    );

    // And once it is spent, the promotion closes rather than going negative.
    shop.deliver_usage(vec![json!({
        "kind": "CAMPAIGN", "key": "C1", "uses": 2, "spent_minor": 50_000,
    })])
    .await;
    shop.stock_one("EPC40000007", "KEM001");
    let third = shop.sell("EPC40000007", 200_000, &[]);
    assert_eq!(third.total_minor, 200_000);
    assert_eq!(
        third.promotions[0].reason.as_deref(),
        Some("the promotion budget is used up")
    );
}

/// A clearance on a whole style reaches every size in it.
///
/// This is a regression test for a fault that was total and silent. The engine
/// matches an article-wide markdown on `CartLine::article_code`, and it is told
/// that field rather than deriving it from the SKU code — deliberately, because
/// an engine that knew how a SKU code is built would break the day the format
/// changed. But nothing told it: every caller in the system built its lines
/// with `CartLine::new`, which leaves the style empty.
///
/// So a range-wide markdown was authored, validated, stored, published,
/// delivered to every shop, loaded into the snapshot — and then matched
/// nothing, at the centre and at the till alike. Nothing failed. The clearance
/// simply did not happen, and the only evidence was a shelf ticket disagreeing
/// with a receipt.
#[tokio::test]
async fn a_clearance_on_a_whole_style_reaches_every_size_in_it() {
    let mut shop = Shop::open();
    shop.deliver_styled_catalogue(&[
        ("ART-KEMEJA".to_string(), "KEM-S", "Kemeja Putih S"),
        ("ART-KEMEJA".to_string(), "KEM-M", "Kemeja Putih M"),
        ("ART-CELANA".to_string(), "CEL-M", "Celana Chino M"),
    ])
    .await;
    shop.deliver_commercial(
        1,
        vec![
            rule("KEM-S", None, 200_000),
            rule("KEM-M", None, 200_000),
            rule("CEL-M", None, 300_000),
        ],
        vec![article_markdown("ART-KEMEJA", 99_000)],
        vec![],
        vec![],
    )
    .await;

    let catalogue = shop
        .edge
        .store_catalog()
        .unwrap_or_else(|e| panic!("catalogue: {e}"));
    let priced = |sku: &str| {
        catalogue
            .iter()
            .find(|row| row.sku_code == sku)
            .unwrap_or_else(|| panic!("{sku} is not in the catalogue"))
            .clone()
    };

    let small = priced("KEM-S");
    assert_eq!(
        small.unit_price_minor, 99_000,
        "the small shirt is in the style being cleared"
    );
    assert_eq!(small.price_source, "MARKDOWN");
    assert_eq!(
        priced("KEM-M").unit_price_minor,
        99_000,
        "so is the medium — a style is every size of it, or the markdown is a \
         rule nobody can predict"
    );
    assert_eq!(
        priced("CEL-M").unit_price_minor,
        300_000,
        "the trousers are a different style and must be untouched"
    );
    assert_eq!(priced("CEL-M").price_source, "COMPANY_PRICE");
}

/// Every kind of promotion survives the journey to a shop.
///
/// A rule is stored as the engine's own document and read back the same way, so
/// the round trip ought to be lossless by construction. It had never been
/// proven for anything but a percentage: `PERCENT` and `EARN_POINTS` were the
/// only effects any test had sent down the wire, while the engine's own tests
/// exercise all six against Rust values that never touch JSON.
///
/// The gap matters because of how the shop fails. `load_rules` logs a warning
/// and SKIPS a promotion it cannot parse — the right call, since an unreadable
/// offer must cost a discount and never the ability to sell — but it means a
/// merchandiser who authored "buy one get one" would see it accepted at the
/// centre and simply not happen at any till, with the only evidence in a log
/// nobody reads.
#[tokio::test]
async fn every_kind_of_promotion_reaches_the_shop_intact() {
    let effects = [
        ("E-PCT", json!({"kind": "PERCENT", "bps": 1_000})),
        (
            "E-AMT",
            json!({"kind": "AMOUNT", "amount": {"minor": 5_000}}),
        ),
        (
            "E-FIX",
            json!({"kind": "FIXED_UNIT_PRICE", "unit_price": {"minor": 80_000}}),
        ),
        ("E-MGN", json!({"kind": "MARGIN", "bps": 3_000})),
        (
            "E-FREE",
            json!({"kind": "FREE_ITEM", "quantity": 1, "every_matched_quantity": 2}),
        ),
        (
            "E-PTS",
            json!({"kind": "EARN_POINTS", "mode": "FIXED_POINTS", "points": 10}),
        ),
    ];

    let mut shop = Shop::open();
    shop.deliver_catalogue(&[("KEM001", "Kemeja Putih")]).await;
    let rules: Vec<serde_json::Value> = effects
        .iter()
        .map(|(id, effect)| {
            let mut rule = percent_off(id, 1_000);
            rule["effect"] = effect.clone();
            // Stackable so none of them displaces another: this is a test of
            // what ARRIVES, not of which offer wins.
            rule["stacking"] = json!("STACKABLE");
            rule
        })
        .collect();
    shop.deliver_commercial(
        1,
        vec![rule("KEM001", None, 200_000)],
        vec![],
        rules,
        vec![],
    )
    .await;

    let held: Vec<String> = shop
        .edge
        .connection()
        .lock()
        .unwrap_or_else(|error| panic!("connection: {error}"))
        .prepare("SELECT definition_json FROM commercial_rule ORDER BY rule_id")
        .and_then(|mut statement| {
            statement
                .query_map([], |row| row.get::<_, String>(0))
                .and_then(|rows| rows.collect())
        })
        .unwrap_or_else(|error| panic!("stored rules: {error}"));
    assert_eq!(held.len(), effects.len(), "every rule was stored");

    // The shop reads them the way it reads them at a till. Anything this build
    // cannot parse is skipped there, so a shorter list is the whole failure.
    let readable: Vec<String> = held
        .iter()
        .filter_map(|document| {
            serde_json::from_str::<pricing_engine::Rule>(document)
                .ok()
                .map(|parsed| parsed.rule_id)
        })
        .collect();
    for (id, effect) in &effects {
        assert!(
            readable.iter().any(|read| read == id),
            "the shop cannot read a {} promotion, so it would silently skip it",
            effect["kind"]
        );
    }
}

/// A receipt says which promotion took the money off, not just that one did.
///
/// The shop has always sent this — which rules applied, the campaign each sat
/// in, the code that unlocked it, and what each was worth. The centre added it
/// to the running totals and dropped the list, so all that survived on the sale
/// was one `discount_total_minor`: a discount happened, and nothing about which.
///
/// That is the question asked at a counter with a customer waiting, and it had
/// no answer while the answer was arriving every time and being thrown away.
#[tokio::test]
async fn a_sale_keeps_the_promotions_that_came_off_it() {
    let mut shop = Shop::open();
    shop.deliver_catalogue(&[("KEM001", "Kemeja Putih")]).await;
    let mut offer = percent_off("R-KEM", 2_000);
    offer["coupon_code"] = json!("HEMAT20");
    shop.deliver_commercial(
        1,
        vec![rule("KEM001", None, 200_000)],
        vec![],
        vec![offer],
        vec![json!({
            "code": "HEMAT20",
            "rule_id": "R-KEM",
            "active": true,
        })],
    )
    .await;

    shop.stock_one("EPC-KEM-1", "KEM001");
    shop.sell("EPC-KEM-1", 160_000, &["HEMAT20"]);
    let fact = sale_fact(&shop);
    let parsed = inventory_backend::cloud::domain::parse_sales_completed(&fact)
        .unwrap_or_else(|e| panic!("the sale fact: {e}"));

    assert_eq!(
        parsed.promotions.len(),
        1,
        "the shop reports the promotion that applied: {fact}"
    );
    let promotion = &parsed.promotions[0];
    assert_eq!(promotion.rule_id, "R-KEM");
    assert_eq!(
        promotion.coupon_code.as_deref(),
        Some("HEMAT20"),
        "and the code that unlocked it, so a receipt can say why"
    );
    assert_eq!(
        promotion.benefit_minor, 40_000,
        "and what it was worth on its own, not folded into a total"
    );
    assert_eq!(
        parsed.discount_total_minor, 40_000,
        "the total and the detail come from one fact, so they cannot disagree"
    );
}

/// A book that only adds a promotion, leaving the prices where they were.
///
/// This is what a merchandiser actually writes most weeks, and until now the
/// shape was impossible: a publication had to carry at least one price rule, so
/// adding a discount meant restating a base price too. Restating it is not
/// harmless — the newest book naming a product wins, so a book meant to add
/// twenty per cent off would also quietly republish whatever price the author
/// happened to type, and the range would move without anybody deciding it had.
#[tokio::test]
async fn a_book_that_only_adds_a_promotion_leaves_the_price_alone() {
    let mut shop = Shop::open();
    shop.deliver_catalogue(&[("KEM001", "Kemeja Putih")]).await;
    // Week one: the price.
    shop.deliver_prices(1, vec![rule("KEM001", None, 200_000)])
        .await;
    // Week two: the promotion, and only the promotion.
    let payload = json!({
        "publication_id": Uuid::new_v4(),
        "version": 2,
        "name": "Diskon akhir pekan",
        "effective_from": "2020-01-01T00:00:00Z",
        "effective_to": null,
        "tax_rules": [],
        "price_rules": [],
        "rules": [percent_off("R1", 2_000)],
    });
    shop.deliver(COMMAND_ACTIVATE_PUBLICATION, payload).await;

    shop.stock_one("EPC10000030", "KEM001");
    let sale = shop.sell("EPC10000030", 160_000, &[]);
    assert_eq!(
        sale.total_minor, 160_000,
        "20% off the two hundred thousand the first book set, which book two never mentioned"
    );
    assert!(sale.promotions[0].applied);
}

/// A book carrying nothing at all is still refused.
///
/// It would dispatch to every shop, activate, and leave all of them exactly as
/// they were — the publish-and-change-nothing fault this area keeps producing,
/// which is only ever noticed when somebody asks why a price did not move.
#[test]
fn a_book_that_changes_nothing_is_refused() {
    let payload = json!({
        "publication_id": Uuid::new_v4(),
        "version": 9,
        "name": "Buku kosong",
        "effective_from": "2020-01-01T00:00:00Z",
        "effective_to": null,
        "tax_rules": [],
        "price_rules": [],
    });
    let refusal = inventory_backend::cloud::domain::parse_activate_publication(&payload);
    assert!(
        refusal.is_err(),
        "an empty book must be refused before it reaches thirty shops"
    );
}

/// The same promotion, run again in a later book.
///
/// The most ordinary thing a merchandiser does — last weekend's twenty per cent
/// off, repeated — and the centre accepts it: its ids are unique per
/// publication, so the same `rule_id` may appear in two books, and usage is
/// counted per rule id across all of them precisely so a promotion run twice
/// reads as one promotion.
///
/// A shop keys `commercial_rule` on `rule_id` alone, so the second book's copy
/// collides with the first and takes the WHOLE BOOK down with it — prices,
/// markdowns and every other promotion in it. The shop then goes on charging
/// last week's prices, and nothing at a counter says why.
#[tokio::test]
async fn a_promotion_repeated_in_a_later_book_does_not_take_the_book_down_with_it() {
    let mut shop = Shop::open();
    shop.deliver_catalogue(&[("KEM001", "Kemeja Putih")]).await;
    shop.deliver_commercial(
        1,
        vec![rule("KEM001", None, 200_000)],
        vec![],
        vec![percent_off("R1", 2_000)],
        vec![],
    )
    .await;
    // The same offer, run again, in a book that also cuts the price.
    shop.deliver_commercial(
        2,
        vec![rule("KEM001", None, 180_000)],
        vec![],
        vec![percent_off("R1", 2_500)],
        vec![],
    )
    .await;

    shop.stock_one("EPC10000040", "KEM001");
    let sale = shop.sell("EPC10000040", 135_000, &[]);
    assert_eq!(
        sale.total_minor, 135_000,
        "the second book's price and its 25% should both be in force"
    );
}

/// The same clearance, extended into a later book.
#[tokio::test]
async fn a_markdown_repeated_in_a_later_book_does_not_take_the_book_down_with_it() {
    let mut shop = Shop::open();
    shop.deliver_catalogue(&[("KEM001", "Kemeja Putih")]).await;
    shop.deliver_commercial(
        1,
        vec![rule("KEM001", None, 200_000)],
        vec![markdown("KEM001", 150_000)],
        vec![],
        vec![],
    )
    .await;
    shop.deliver_commercial(
        2,
        vec![rule("KEM001", None, 200_000)],
        vec![markdown("KEM001", 120_000)],
        vec![],
        vec![],
    )
    .await;

    shop.stock_one("EPC10000041", "KEM001");
    let sale = shop.sell("EPC10000041", 120_000, &[]);
    assert_eq!(sale.total_minor, 120_000, "the newer clearance price wins");
}

// ---------------------------------------------------------------------------
// A campaign of markdowns — price drops the business runs as one thing
// ---------------------------------------------------------------------------
//
// The shape retail calls a flash sale was not expressible here at all. A
// campaign enveloped promotion RULES only, so a set of markdowns could not
// carry one name, one banner or one clock — and, worse, could not be stopped
// with one switch. These tests are the whole chain for that: published at the
// centre, charged at the counter, and turned off between price books.

/// A banner-carrying campaign, as `dispatch_publication` sends one.
fn campaign_with_banner(id: &str, headline: &str) -> serde_json::Value {
    let mut envelope = campaign(id, "ACTIVE");
    envelope["headline"] = json!(headline);
    envelope["image_url"] = json!(format!("https://cdn.example/campaign/{id}.jpg"));
    envelope["terms"] = json!("Selama persediaan masih ada.");
    envelope
}

#[tokio::test]
async fn a_campaign_of_markdowns_is_charged_and_named_at_the_shop() {
    let mut shop = Shop::open();
    shop.deliver_catalogue(&[("KEM001", "Kemeja Putih")]).await;
    shop.deliver_full(
        1,
        vec![rule("KEM001", None, 200_000)],
        vec![markdown_under("KEM001", 120_000, "CMP-FLASH")],
        vec![],
        vec![],
        vec![campaign_with_banner("CMP-FLASH", "Flash Sale Lebaran")],
    )
    .await;

    // The counter charges the cleared price.
    shop.stock_one("EPC40000001", "KEM001");
    let sold = shop.sell("EPC40000001", 120_000, &[]);
    assert_eq!(sold.total_minor, 120_000);
    assert_eq!(
        shop.receipt_lines()[0].2.as_deref(),
        Some("MARKDOWN"),
        "the receipt must say the price came from a clearance, not a discount"
    );

    // And the shop floor can say what it is called and when it stops — which is
    // the half that did not exist. A drop with no campaign can only be reported
    // as an anonymous window.
    let offers = shop
        .edge
        .store_offers()
        .unwrap_or_else(|e| panic!("offers: {e}"));
    assert_eq!(offers.price_drops.len(), 1);
    let run = &offers.price_drops[0];
    assert_eq!(run.campaign_id.as_deref(), Some("CMP-FLASH"));
    assert_eq!(
        run.name.as_deref(),
        Some("Flash Sale Lebaran"),
        "a cashier reads the poster's words, not the filing id"
    );
    assert!(run.has_image, "the banner travelled with the book");
    assert_eq!(run.product_count, 1);
    assert_eq!(run.state, "RUNNING");
}

#[tokio::test]
async fn pausing_a_campaign_puts_its_cleared_prices_back_up() {
    let mut shop = Shop::open();
    shop.deliver_catalogue(&[("KEM001", "Kemeja Putih")]).await;
    shop.deliver_full(
        1,
        vec![rule("KEM001", None, 200_000)],
        vec![markdown_under("KEM001", 120_000, "CMP-FLASH")],
        vec![],
        vec![],
        vec![campaign_with_banner("CMP-FLASH", "Flash Sale Lebaran")],
    )
    .await;
    shop.stock_one("EPC40000002", "KEM001");
    assert_eq!(shop.sell("EPC40000002", 120_000, &[]).total_minor, 120_000);

    // One command on the switch lane — no new price book, no publication.
    shop.switch_campaign("CMP-FLASH", "PAUSED").await;

    shop.stock_one("EPC40000003", "KEM001");
    let after = shop.sell("EPC40000003", 200_000, &[]);
    assert_eq!(
        after.total_minor, 200_000,
        "stopping the campaign at the centre must put the price back at the counter"
    );
    assert_eq!(
        shop.receipt_lines()
            .iter()
            .find(|line| line.1 == 200_000)
            .and_then(|line| line.2.clone())
            .as_deref(),
        Some("COMPANY_PRICE"),
        "and the receipt must say it is charging the list price again"
    );

    // The board agrees with the counter. A poster still advertising a stopped
    // sale is the failure this pair of assertions exists to catch.
    let offers = shop
        .edge
        .store_offers()
        .unwrap_or_else(|e| panic!("offers: {e}"));
    assert!(offers.price_drops.is_empty());
}

#[tokio::test]
async fn restarting_a_paused_campaign_brings_the_prices_back_down() {
    let mut shop = Shop::open();
    shop.deliver_catalogue(&[("KEM001", "Kemeja Putih")]).await;
    shop.deliver_full(
        1,
        vec![rule("KEM001", None, 200_000)],
        vec![markdown_under("KEM001", 120_000, "CMP-FLASH")],
        vec![],
        vec![],
        vec![campaign_with_banner("CMP-FLASH", "Flash Sale Lebaran")],
    )
    .await;
    shop.switch_campaign("CMP-FLASH", "PAUSED").await;
    shop.switch_campaign("CMP-FLASH", "ACTIVE").await;

    // The switch is a switch, not a one-way door: the markdown rows were never
    // touched, so restarting the campaign is all it takes.
    shop.stock_one("EPC40000004", "KEM001");
    assert_eq!(shop.sell("EPC40000004", 120_000, &[]).total_minor, 120_000);
}

#[tokio::test]
async fn a_campaign_the_shop_never_received_still_honours_its_cleared_prices() {
    let mut shop = Shop::open();
    shop.deliver_catalogue(&[("KEM001", "Kemeja Putih")]).await;
    // The markdown names a campaign; the campaign is not in the book. A shop
    // whose sync stalled between the two lands exactly here.
    shop.deliver_full(
        1,
        vec![rule("KEM001", None, 200_000)],
        vec![markdown_under("KEM001", 120_000, "CMP-MISSING")],
        vec![],
        vec![],
        vec![],
    )
    .await;

    // **The asymmetry, end to end.** An offer whose campaign never arrived does
    // not run — that is the test above this one, and it is right, because the
    // shopper simply pays the price they would have paid anyway. A CLEARANCE
    // whose campaign never arrived must still be honoured, because the garment
    // has 120.000 on its ticket and the poster in the window says 120.000. The
    // safe direction is not the same direction, and reading them as one rule is
    // how a till comes to overcharge at the branch furthest behind on sync.
    shop.stock_one("EPC40000005", "KEM001");
    let sold = shop.sell("EPC40000005", 120_000, &[]);
    assert_eq!(sold.total_minor, 120_000);

    // It is charged, so it is also reported — but as an anonymous window, since
    // the shop cannot name a campaign it does not hold.
    let offers = shop
        .edge
        .store_offers()
        .unwrap_or_else(|e| panic!("offers: {e}"));
    assert_eq!(offers.price_drops.len(), 1);
    assert_eq!(offers.price_drops[0].campaign_id, None);
    assert_eq!(offers.price_drops[0].name, None);
}

#[tokio::test]
async fn a_switch_for_a_campaign_the_shop_does_not_hold_changes_nothing() {
    let mut shop = Shop::open();
    shop.deliver_catalogue(&[("KEM001", "Kemeja Putih")]).await;
    shop.deliver_full(
        1,
        vec![rule("KEM001", None, 200_000)],
        vec![markdown_under("KEM001", 120_000, "CMP-MISSING")],
        vec![],
        vec![],
        vec![],
    )
    .await;

    // The switch lane UPDATEs and never INSERTs. If it inserted, this would
    // conjure a campaign with no budget, no limits and no name — and the offers
    // that name it would start being gated by a row nobody authored.
    shop.switch_campaign("CMP-MISSING", "PAUSED").await;

    shop.stock_one("EPC40000006", "KEM001");
    assert_eq!(shop.sell("EPC40000006", 120_000, &[]).total_minor, 120_000);
}

#[tokio::test]
async fn the_promotions_board_shows_what_the_counter_would_charge() {
    let mut shop = Shop::open();
    shop.deliver_catalogue(&[("KEM001", "Kemeja Putih")]).await;
    let mut offer = percent_off("R1", 2_000);
    offer["campaign_id"] = json!("CMP-LEBARAN");
    shop.deliver_full(
        1,
        vec![rule("KEM001", None, 200_000)],
        vec![],
        vec![offer],
        vec![],
        vec![campaign_with_banner("CMP-LEBARAN", "Lebaran Sale")],
    )
    .await;

    // On the board.
    let offers = shop
        .edge
        .store_offers()
        .unwrap_or_else(|e| panic!("offers: {e}"));
    assert_eq!(offers.running.len(), 1);
    assert_eq!(offers.running[0].rule_id, "R1");
    assert_eq!(
        offers.running[0].campaign_name.as_deref(),
        Some("Lebaran Sale")
    );
    assert!(offers.running[0].live_now);

    // And at the counter, for the same money.
    shop.stock_one("EPC40000007", "KEM001");
    assert_eq!(shop.sell("EPC40000007", 160_000, &[]).total_minor, 160_000);

    // Stop it, and both agree again. This is the assertion that would have
    // caught a board reading `status` instead of asking the engine.
    shop.switch_campaign("CMP-LEBARAN", "PAUSED").await;
    let stopped = shop
        .edge
        .store_offers()
        .unwrap_or_else(|e| panic!("offers: {e}"));
    assert!(stopped.running.is_empty());
    shop.stock_one("EPC40000008", "KEM001");
    assert_eq!(shop.sell("EPC40000008", 200_000, &[]).total_minor, 200_000);
}

#[tokio::test]
async fn a_clearance_published_with_hours_only_charges_within_them() {
    let mut shop = Shop::open();
    shop.deliver_catalogue(&[("KEM001", "Kemeja Putih")]).await;
    // Midnight to one in the morning: a window this test is certainly outside
    // of, whatever hour it happens to run at, without the test having to know
    // the clock. The pair of assertions below is what matters — the shop holds
    // the schedule, and the schedule keeps the price up outside it.
    shop.deliver_full(
        1,
        vec![rule("KEM001", None, 200_000)],
        vec![flash_markdown("KEM001", 120_000, 0, 1)],
        vec![],
        vec![],
        vec![],
    )
    .await;

    let held: (Option<i64>, Option<i64>) = {
        let connection = shop.edge.connection();
        let guard = connection.lock().unwrap_or_else(|e| panic!("lock: {e}"));
        guard
            .query_row(
                "SELECT from_minute, to_minute FROM commercial_markdown",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap_or_else(|e| panic!("read schedule: {e}"))
    };
    assert_eq!(held, (Some(0), Some(1)), "the hours reached the shop");

    // One minute of the day is in the window and 1.439 are not, so the price on
    // the shelf is the list price essentially always — which is exactly what a
    // flash sale outside its hour must charge.
    let catalogue = shop
        .edge
        .store_catalog()
        .unwrap_or_else(|e| panic!("catalogue: {e}"));
    assert_eq!(catalogue.len(), 1);
    if catalogue[0].unit_price_minor != 120_000 {
        assert_eq!(
            catalogue[0].unit_price_minor, 200_000,
            "outside its hours a clearance must not set the price"
        );
        assert_eq!(catalogue[0].price_source, "COMPANY_PRICE");
    }
}

// ---------------------------------------------------------------------------
// A promotion that has started stops moving
// ---------------------------------------------------------------------------

impl Shop {
    /// The centre's product list, with each product's tags said out loud.
    ///
    /// `deliver_catalogue` sends none, which is right for the price tests
    /// above and useless here: a promotion that selects on a tag is a promotion
    /// whose membership is decided by exactly this field.
    async fn deliver_tagged_catalogue(&mut self, rows: &[(&str, &[&str])]) {
        let items: Vec<CatalogItem> = rows
            .iter()
            .map(|(sku, tags)| CatalogItem {
                sku_code: (*sku).into(),
                name: format!("Celana {sku}"),
                uom: "EA".into(),
                barcode: None,
                tax_category: "STANDARD".into(),
                active: true,
                base_price_minor: Some(INTAKE_PRICE),
                article_code: Some(format!("ART-{sku}")),
                division_code: Some("PRIA".into()),
                tags: tags.iter().map(|tag| (*tag).to_string()).collect(),
                image_url: None,
            })
            .collect();
        let payload = json!({
            "snapshot_id": Uuid::new_v4(),
            "generation": 1,
            "chunk_index": 0,
            "chunk_count": 1,
            "content_hash": catalog_content_hash(&items),
            "items": items,
        });
        self.deliver(COMMAND_CATALOG_CHUNK, payload).await;
    }

    /// What the centre resolved each started promotion to.
    ///
    /// The lane that makes a running promotion's membership stop moving. Sent
    /// after the book, as it is in production: the book is published in August
    /// and frozen, and the rule's window opens on a Saturday morning.
    async fn deliver_eligibility(&mut self, frozen: &[(&str, &[&str])]) {
        let payload = json!({
            "resolved_at": "2026-09-12T03:00:00Z",
            "rules": frozen
                .iter()
                .map(|(rule_id, skus)| json!({
                    "rule_id": rule_id,
                    "resolved_at": "2026-09-12T03:00:00Z",
                    "applies_to": skus,
                    "effect_on": null,
                }))
                .collect::<Vec<_>>(),
        });
        self.deliver(COMMAND_COMMERCIAL_ELIGIBILITY, payload).await;
    }
}

/// A promotion that reads a tag rather than naming its products.
fn tag_promotion(id: &str, tag: &str, bps: i64) -> serde_json::Value {
    let mut promotion = percent_off(id, bps);
    promotion["scope"] = json!({ "applicability": { "on": "TAG", "tags": [tag] } });
    promotion
}

/// Without a frozen set, a shop decides membership from today's catalogue.
///
/// Here to prove what the next test changes. This is not a bug being
/// documented — it is the correct behaviour for a promotion the centre has not
/// resolved yet, which is any promotion that has not started.
#[tokio::test]
async fn an_unfrozen_promotion_reads_the_catalogue_as_it_stands() {
    let mut shop = Shop::open();
    shop.deliver_tagged_catalogue(&[("CEL001", &[])]).await;
    shop.deliver_commercial(
        1,
        vec![rule("CEL001", None, 200_000)],
        vec![],
        vec![tag_promotion("R-DENIM", "DENIM", 2_500)],
        vec![],
    )
    .await;

    shop.stock_one("EPC20000001", "CEL001");
    let before = shop.sell("EPC20000001", 200_000, &[]);
    assert_eq!(before.total_minor, 200_000, "no tag, no promotion");

    // The article is tagged at head office and the list comes down again.
    shop.deliver_tagged_catalogue(&[("CEL001", &["DENIM"])])
        .await;
    shop.stock_one("EPC20000002", "CEL001");
    let after = shop.sell("EPC20000002", 150_000, &[]);
    assert_eq!(
        after.total_minor, 150_000,
        "an unfrozen promotion follows the catalogue"
    );
}

/// A promotion that has started prices the products it started with.
///
/// The three cases the owner set out, in the one place they are actually
/// decided — the till, on a real sale, through the pricing engine:
///
///  1. a product the promotion resolved to is still in it;
///  2. a product tagged AFTERWARDS does not join it;
///  3. a product that LOSES the tag afterwards does not fall out of it.
///
/// Before the frozen set reached the shop, (2) and (3) both silently followed
/// the catalogue, which meant an edit to an article at head office quietly
/// changed what a running promotion gave away in thirteen shops.
#[tokio::test]
async fn a_started_promotion_prices_the_products_it_started_with() {
    let mut shop = Shop::open();
    shop.deliver_tagged_catalogue(&[
        ("CEL001", &["DENIM"]),
        ("CEL002", &["DENIM"]),
        ("CEL003", &[]),
    ])
    .await;
    shop.deliver_commercial(
        1,
        vec![
            rule("CEL001", None, 200_000),
            rule("CEL002", None, 200_000),
            rule("CEL003", None, 200_000),
        ],
        vec![],
        vec![tag_promotion("R-DENIM", "DENIM", 2_500)],
        vec![],
    )
    .await;
    // The window opened; the centre resolved the tag to the two products that
    // carried it at that moment.
    shop.deliver_eligibility(&[("R-DENIM", &["CEL001", "CEL002"])])
        .await;

    shop.stock_one("EPC20000010", "CEL001");
    let inside = shop.sell("EPC20000010", 150_000, &[]);
    assert_eq!(inside.total_minor, 150_000, "it was in the answer");
    assert_eq!(inside.promotions.len(), 1);
    assert!(inside.promotions[0].applied);

    // Tomorrow: a third product is given the tag.
    shop.deliver_tagged_catalogue(&[
        ("CEL001", &["DENIM"]),
        ("CEL002", &["DENIM"]),
        ("CEL003", &["DENIM"]),
    ])
    .await;
    shop.stock_one("EPC20000011", "CEL003");
    let joined_late = shop.sell("EPC20000011", 200_000, &[]);
    assert_eq!(
        joined_late.total_minor, 200_000,
        "tagging an article does not put it into a promotion that has already started"
    );
    assert!(
        joined_late.promotions.iter().all(|one| !one.applied),
        "and nothing came off it: {:?}",
        joined_late.promotions
    );

    // And the tag is taken off one that was in the answer.
    shop.deliver_tagged_catalogue(&[
        ("CEL001", &["DENIM"]),
        ("CEL002", &[]),
        ("CEL003", &["DENIM"]),
    ])
    .await;
    shop.stock_one("EPC20000012", "CEL002");
    let still_inside = shop.sell("EPC20000012", 150_000, &[]);
    assert_eq!(
        still_inside.total_minor, 150_000,
        "untagging an article does not take it out of a promotion that has already started"
    );
    assert!(still_inside.promotions[0].applied);
}

/// A frozen set that matched nothing is an answer, not a missing one.
///
/// The failure this guards is the tempting shortcut: treating an empty set as
/// "nothing frozen" and falling back to the selector. A promotion that matched
/// no products when it started gives nothing away until somebody decides
/// otherwise, and the till must not decide it by reading tomorrow's catalogue.
#[tokio::test]
async fn a_promotion_frozen_over_nothing_gives_nothing_away() {
    let mut shop = Shop::open();
    shop.deliver_tagged_catalogue(&[("CEL001", &["DENIM"])])
        .await;
    shop.deliver_commercial(
        1,
        vec![rule("CEL001", None, 200_000)],
        vec![],
        vec![tag_promotion("R-DENIM", "DENIM", 2_500)],
        vec![],
    )
    .await;
    shop.deliver_eligibility(&[("R-DENIM", &[])]).await;

    shop.stock_one("EPC20000020", "CEL001");
    let sale = shop.sell("EPC20000020", 200_000, &[]);
    assert_eq!(
        sale.total_minor, 200_000,
        "it matched nothing when it started, and the tag on this garment is not a second chance"
    );
}

// ---------------------------------------------------------------------------
// A till counts what it gave away itself (edge 0043)
// ---------------------------------------------------------------------------

/// A shop with one rule, a campaign budget of fifty thousand behind it and a
/// single-use code in front of it, and four shirts to sell.
async fn counted_shop() -> Shop {
    let mut shop = Shop::open();
    shop.deliver_catalogue(&[("KEM001", "Kemeja Putih")]).await;
    let mut offer = percent_off("R1", 2_000);
    offer["campaign_id"] = json!("C1");
    shop.deliver_full(
        1,
        vec![rule("KEM001", None, 200_000)],
        vec![],
        vec![offer],
        vec![],
        vec![{
            let mut envelope = campaign("C1", "ACTIVE");
            envelope["budget_minor"] = json!(50_000);
            envelope
        }],
    )
    .await;
    for epc in ["EPC43000001", "EPC43000002", "EPC43000003", "EPC43000004"] {
        shop.stock_one(epc, "KEM001");
    }
    shop
}

#[tokio::test]
async fn a_single_use_coupon_is_spent_at_this_till_before_the_centre_counts_it() {
    // The hole this closes: the counter learned a code was spent only once the
    // sale had gone to the centre, been counted and come back. In between, the
    // same code passed again at the same counter.
    let mut shop = Shop::open();
    shop.deliver_catalogue(&[("KEM001", "Kemeja Putih")]).await;
    let mut gated = percent_off("R1", 2_000);
    gated["coupon_code"] = json!("SEKALI");
    shop.deliver_commercial(
        1,
        vec![rule("KEM001", None, 200_000)],
        vec![],
        vec![gated],
        vec![json!({
            "code": "SEKALI", "rule_id": "R1", "active": true,
            "customer_id": null, "valid_from": null, "valid_to": null,
            "max_uses": 1,
        })],
    )
    .await;
    shop.stock_one("EPC43000011", "KEM001");
    shop.stock_one("EPC43000012", "KEM001");

    assert_eq!(
        shop.sell("EPC43000011", 160_000, &["SEKALI"]).total_minor,
        160_000
    );
    let second = shop.sell("EPC43000012", 200_000, &["SEKALI"]);
    assert_eq!(
        second.total_minor, 200_000,
        "the code was spent at this counter a moment ago; nothing has come back from the centre yet"
    );
    assert_eq!(
        second.promotions[0].reason.as_deref(),
        Some("that coupon has been used already")
    );
}

#[tokio::test]
async fn a_budget_spent_here_trims_the_next_basket_before_the_centre_counts_it() {
    let shop = counted_shop().await;
    assert_eq!(shop.sell("EPC43000001", 160_000, &[]).total_minor, 160_000);
    assert_eq!(
        shop.local_usage(),
        vec![
            ("CAMPAIGN".into(), "C1".into(), 1, 40_000),
            ("RULE".into(), "R1".into(), 1, 40_000),
        ],
        "the same keys and the same arithmetic the centre will apply"
    );
    assert_eq!(
        shop.sell("EPC43000002", 190_000, &[]).total_minor,
        190_000,
        "forty of the fifty went on the first basket, at this till"
    );
}

#[tokio::test]
async fn the_centres_count_takes_over_once_it_has_applied_the_sale() {
    let mut shop = counted_shop().await;
    shop.sell("EPC43000001", 160_000, &[]);

    // The centre has applied the sale and counts it. From here its figure is
    // the whole truth, and the till's own row would count the sale twice.
    shop.deliver_usage(vec![
        json!({ "kind": "CAMPAIGN", "key": "C1", "uses": 1, "spent_minor": 40_000 }),
        json!({ "kind": "RULE", "key": "R1", "uses": 1, "spent_minor": 40_000 }),
    ])
    .await;
    assert!(
        shop.local_usage().is_empty(),
        "the sale is inside the centre's figure now"
    );
    assert_eq!(
        shop.sell("EPC43000002", 190_000, &[]).total_minor,
        190_000,
        "counted once: ten thousand left, not nothing"
    );
}

#[tokio::test]
async fn a_count_taken_before_the_sale_was_applied_keeps_the_tills_own() {
    let mut shop = counted_shop().await;
    shop.sell("EPC43000001", 160_000, &[]);
    let (origin_id, generation, _) = shop.stream_head();

    // The centre counted before it reached this sale: its figure says nothing
    // was spent, and it says how far it had got — not far enough.
    shop.deliver_usage_through(
        vec![],
        json!([{ "origin_id": origin_id, "generation": generation, "applied_seq": 0 }]),
    )
    .await;
    assert!(
        !shop.local_usage().is_empty(),
        "the centre has not counted it yet"
    );
    assert_eq!(
        shop.sell("EPC43000002", 190_000, &[]).total_minor,
        190_000,
        "still counted here, so still only ten thousand left"
    );
}

#[tokio::test]
async fn a_count_for_another_shop_changes_nothing_here() {
    let mut shop = counted_shop().await;
    shop.sell("EPC43000001", 160_000, &[]);
    let (_, generation, head) = shop.stream_head();
    shop.deliver_usage_through(
        vec![],
        json!([{ "origin_id": "another-shop", "generation": generation, "applied_seq": head }]),
    )
    .await;
    assert!(
        !shop.local_usage().is_empty(),
        "another shop's position says nothing about this shop's sales"
    );
}

#[tokio::test]
async fn an_older_centre_releases_only_what_it_has_received() {
    // A centre that predates `applied_through` says nothing about how far it
    // had got. The till then trusts what the centre has acknowledged receiving
    // — and until then counts the sale itself, even if that briefly counts it
    // twice. Twice is a brake applied early; nowhere is a coupon spent twice.
    let mut shop = counted_shop().await;
    shop.sell("EPC43000001", 160_000, &[]);
    shop.deliver_usage_from_an_older_centre(vec![json!({
        "kind": "CAMPAIGN", "key": "C1", "uses": 1, "spent_minor": 40_000,
    })])
    .await;
    assert!(
        !shop.local_usage().is_empty(),
        "nothing acknowledged yet, so kept"
    );

    let (origin_id, generation, head) = shop.stream_head();
    shop.execute(&format!(
        "INSERT INTO sync_watermark (origin_id, generation, durable_seq, updated_at)
         VALUES ('{origin_id}', {generation}, {head}, '2026-09-01T00:00:00Z')
         ON CONFLICT (origin_id, generation) DO UPDATE SET durable_seq = excluded.durable_seq"
    ));
    shop.deliver_usage_from_an_older_centre(vec![json!({
        "kind": "CAMPAIGN", "key": "C1", "uses": 1, "spent_minor": 40_000,
    })])
    .await;
    assert!(
        shop.local_usage().is_empty(),
        "received, so inside the count"
    );
    assert_eq!(shop.sell("EPC43000002", 190_000, &[]).total_minor, 190_000);
}

#[tokio::test]
async fn a_renumbered_sale_is_still_found_by_its_event_id() {
    // A new generation renumbers the unacknowledged backlog. A row that had
    // stored the old seq would now point at the wrong fact, or none; the row
    // names the fact, and the log says where it is now.
    let mut shop = counted_shop().await;
    shop.sell("EPC43000001", 160_000, &[]);
    let (origin_id, _, head) = shop.stream_head();
    shop.execute(
        "UPDATE sync_fact_log SET generation = 2;
         UPDATE sync_origin SET generation = 2;",
    );

    // Generation 1 is not where the sale is any more.
    shop.deliver_usage_through(
        vec![],
        json!([{ "origin_id": origin_id, "generation": 1, "applied_seq": head }]),
    )
    .await;
    assert!(!shop.local_usage().is_empty());

    shop.deliver_usage_through(
        vec![json!({ "kind": "CAMPAIGN", "key": "C1", "uses": 1, "spent_minor": 40_000 })],
        json!([{ "origin_id": origin_id, "generation": 2, "applied_seq": head }]),
    )
    .await;
    assert!(shop.local_usage().is_empty());
}

#[tokio::test]
async fn a_sale_the_centre_will_never_hear_about_stays_counted_here() {
    let mut shop = counted_shop().await;
    shop.execute("UPDATE sync_origin SET enqueue_enabled = 0");
    shop.sell("EPC43000001", 160_000, &[]);
    shop.execute("UPDATE sync_origin SET enqueue_enabled = 1");
    shop.deliver_usage(vec![]).await;
    assert_eq!(
        shop.local_usage().len(),
        2,
        "never queued, so no count from the centre can ever include it"
    );
    assert_eq!(shop.sell("EPC43000002", 190_000, &[]).total_minor, 190_000);
}

// ---------------------------------------------------------------------------
// A shop holds its own allowance under a split limit (edge 0044)
// ---------------------------------------------------------------------------

impl Shop {
    /// Deliver a count carrying this shop's allowance under campaign C1.
    async fn deliver_allowance(&mut self, fleet_spent: i64, budget: Option<i64>, own_spent: i64) {
        let (origin_id, generation, head) = self.stream_head();
        let allowances = match budget {
            Some(budget) => json!([{
                "origin_id": origin_id, "kind": "CAMPAIGN", "key": "C1",
                "budget_minor": budget, "max_uses": null,
                "own_uses": 0, "own_spent_minor": own_spent,
            }]),
            None => json!([]),
        };
        self.deliver(
            inventory_backend::cloud::domain::COMMAND_COMMERCIAL_USAGE,
            json!({
                "counted_at": "2026-09-01T00:00:00Z",
                "counts": [{ "kind": "CAMPAIGN", "key": "C1", "uses": 0, "spent_minor": fleet_spent }],
                "applied_through": [{
                    "origin_id": origin_id, "generation": generation, "applied_seq": head,
                }],
                "allowances": allowances,
            }),
        )
        .await;
    }
}

/// A shop with a campaign whose fleet budget is a million, far more than any
/// test here spends — so anything that stops the offer is the allowance.
async fn allowance_shop() -> Shop {
    let mut shop = Shop::open();
    shop.deliver_catalogue(&[("KEM001", "Kemeja Putih")]).await;
    let mut offer = percent_off("R1", 2_000);
    offer["campaign_id"] = json!("C1");
    shop.deliver_full(
        1,
        vec![rule("KEM001", None, 200_000)],
        vec![],
        vec![offer],
        vec![],
        vec![{
            let mut envelope = campaign("C1", "ACTIVE");
            envelope["budget_minor"] = json!(1_000_000);
            envelope
        }],
    )
    .await;
    for epc in ["EPC44000001", "EPC44000002", "EPC44000003"] {
        shop.stock_one(epc, "KEM001");
    }
    shop
}

#[tokio::test]
async fn a_shop_stops_at_its_allowance_while_the_fleet_budget_has_plenty() {
    let mut shop = allowance_shop().await;
    shop.deliver_allowance(0, Some(50_000), 0).await;

    assert_eq!(shop.sell("EPC44000001", 160_000, &[]).total_minor, 160_000);
    assert_eq!(
        shop.sell("EPC44000002", 190_000, &[]).total_minor,
        190_000,
        "fifty thousand was this shop's to give; forty went on the first basket, \
         counted here before the centre heard of it"
    );
}

#[tokio::test]
async fn an_allowance_counts_the_shops_own_sales_the_centre_has_counted() {
    let mut shop = allowance_shop().await;
    // The centre has counted forty thousand of this shop's own sales under
    // the limit, and granted it fifty.
    shop.deliver_allowance(40_000, Some(50_000), 40_000).await;
    assert_eq!(shop.sell("EPC44000001", 190_000, &[]).total_minor, 190_000);
}

#[tokio::test]
async fn a_split_switched_off_goes_back_to_the_fleets_count() {
    let mut shop = allowance_shop().await;
    shop.deliver_allowance(0, Some(10_000), 0).await;
    assert_eq!(shop.sell("EPC44000001", 190_000, &[]).total_minor, 190_000);

    shop.deliver_allowance(10_000, None, 0).await;
    assert_eq!(
        shop.sell("EPC44000002", 160_000, &[]).total_minor,
        160_000,
        "no allowance any more: the fleet's million applies"
    );
}

#[tokio::test]
async fn the_fleets_count_still_binds_when_it_is_tighter_than_the_allowance() {
    // A later book lowered the limit below what this shop was granted. Grants
    // are never taken back, so the fleet's count is what stops the offer.
    let mut shop = allowance_shop().await;
    shop.deliver_allowance(990_000, Some(500_000), 0).await;
    assert_eq!(
        shop.sell("EPC44000001", 190_000, &[]).total_minor,
        190_000,
        "ten thousand left in the fleet, however much this shop was granted"
    );
}
