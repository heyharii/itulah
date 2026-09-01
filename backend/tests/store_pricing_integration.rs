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
    COMMAND_CATALOG_CHUNK,
};
use inventory_backend::cloud::postgres::command_signing_key;
use inventory_backend::edge::{
    EdgeInventory, EdgeRole, MoveRequest, MovementCause, NodeContext, ReceiveRequest, SaleRequest,
    SiteId, SqliteEdge, SqliteSyncStore,
};
use inventory_backend::sync::port::SyncStore;
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

    /// Deliver the centre's product list.
    async fn deliver_catalogue(&mut self, skus: &[(&str, &str)]) {
        let items: Vec<CatalogItem> = skus
            .iter()
            .map(|(sku, name)| CatalogItem {
                sku_code: (*sku).into(),
                name: (*name).into(),
                uom: "EA".into(),
                barcode: None,
                tax_category: "STANDARD".into(),
                active: true,
                base_price_minor: Some(INTAKE_PRICE),
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
            coupon_codes: Vec::new(),
            customer_id: None,
            idempotency_key: "sale-1".into(),
            actor_id: "kasir".into(),
            epcs: vec!["EPC00000001".into()],
            cash_minor: 149_000,
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
            coupon_codes: Vec::new(),
            customer_id: None,
            idempotency_key: "sale-2".into(),
            actor_id: "kasir".into(),
            epcs: vec!["EPC00000002".into()],
            cash_minor: 119_000,
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
            coupon_codes: Vec::new(),
            customer_id: None,
            idempotency_key: "sale-3".into(),
            actor_id: "kasir".into(),
            epcs: vec!["EPC00000003".into()],
            cash_minor: 99_000,
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
            coupon_codes: Vec::new(),
            customer_id: None,
            idempotency_key: "sale-4".into(),
            actor_id: "kasir".into(),
            epcs: vec!["EPC00000004".into()],
            cash_minor: INTAKE_PRICE,
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
        coupon_codes: Vec::new(),
        customer_id: None,
        idempotency_key: "sale-5".into(),
        actor_id: "kasir".into(),
        epcs: vec!["EPC00000005".into()],
        cash_minor: INTAKE_PRICE,
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

    fn sell(&self, epc: &str, cash: i64, coupons: &[&str]) -> inventory_backend::edge::SaleResult {
        self.edge
            .complete_sale(SaleRequest {
                coupon_codes: coupons.iter().map(|c| (*c).to_string()).collect(),
                customer_id: None,
                idempotency_key: format!("{epc}-sale"),
                actor_id: "kasir".into(),
                epcs: vec![epc.into()],
                cash_minor: cash,
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
            "used": 0,
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
        fact["pricing_trace_id"].as_str().is_some_and(|id| !id.is_empty()),
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
        vec![
            rule("KEM001", None, 200_000),
            rule("CEL001", None, 300_000),
        ],
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
            coupon_codes: Vec::new(),
            customer_id: None,
            idempotency_key: "sale-two-lines".into(),
            actor_id: "kasir".into(),
            epcs: vec!["EPC20000002".into(), "EPC20000003".into()],
            cash_minor: 405_000,
        })
        .unwrap_or_else(|e| panic!("sale: {e}"));
    // 150,000 + 300,000 = 450,000, less ten per cent = 405,000.
    assert_eq!(sale.total_minor, 405_000);

    let parsed = inventory_backend::cloud::domain::parse_sales_completed(&sale_fact(&shop))
        .unwrap_or_else(|error| {
            panic!("the centre would have refused this sale: {error}")
        });
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
// Campaigns, group prices and tier prices, over the wire
// ---------------------------------------------------------------------------

fn campaign(id: &str, status: &str) -> serde_json::Value {
    json!({
        "campaign_id": id,
        "name": format!("Kampanye {id}"),
        "status": status,
        "valid_from": null,
        "valid_to": null,
        "budget_minor": null,
        "spent_minor": 0,
        "max_uses": null,
        "used": 0,
        "max_uses_per_customer": null,
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
    /// Deliver what the centre has counted so far.
    async fn deliver_usage(&mut self, counts: Vec<serde_json::Value>) {
        self.deliver(
            inventory_backend::cloud::domain::COMMAND_COMMERCIAL_USAGE,
            json!({ "counted_at": "2026-09-01T00:00:00Z", "counts": counts }),
        )
        .await;
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
            "max_uses": 1, "used": 0,
        })],
    )
    .await;

    shop.stock_one("EPC40000001", "KEM001");
    let sale = shop
        .edge
        .complete_sale(SaleRequest {
            coupon_codes: vec!["LEBARAN".into()],
            customer_id: Some("member-1".into()),
            idempotency_key: "sale-counted".into(),
            actor_id: "kasir".into(),
            epcs: vec!["EPC40000001".into()],
            cash_minor: 160_000,
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
            "max_uses": null, "used": 0,
        })],
    )
    .await;

    shop.stock_one("EPC40000002", "KEM001");
    let sale = shop.sell("EPC40000002", 200_000, &["LEBARAN"]);
    assert_eq!(sale.total_minor, 200_000, "an inactive coupon opens nothing");

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
            "max_uses": 1, "used": 0,
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
