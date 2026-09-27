//! Getting goods into the estate the way they really arrive: a buyer raises a
//! purchase order, the floor app at the receiving site counts and verifies the
//! delivery (a `goods_receipt.line` fact over sync), head office names the
//! goods (article setup), and Finance values the delivery.

#![allow(dead_code)]

use super::harness::*;
use chrono::{Duration, Utc};
use serde_json::{json, Value};
use uuid::Uuid;

/// One product line of a delivery.
#[derive(Clone, Debug)]
pub struct Goods {
    pub supplier_code: &'static str,
    pub name: &'static str,
    pub quantity: i64,
    pub unit_cost: i64,
    pub sale_price: i64,
    /// Shopping bags: customer supplies on 1030, not merchandise.
    pub supply: bool,
}

/// What arrived and what it is now called.
#[derive(Clone, Debug)]
pub struct Received {
    pub po_id: String,
    pub receipt_id: String,
    pub receipt_number: String,
    pub receipt_line_ids: Vec<String>,
    pub po_line_ids: Vec<String>,
    pub articles: Vec<String>,
    pub skus: Vec<String>,
}

pub async fn supplier(api: &Api, code: &str) -> String {
    let created = api
        .post(
            INVENTORY,
            "/api/v1/suppliers",
            json!({
                "supplier_code": code,
                "name": format!("PT {code}"),
                "status": "ACTIVE",
            }),
        )
        .await;
    created["supplier_id"]
        .as_str()
        .or_else(|| created["id"].as_str())
        .unwrap_or_else(|| panic!("supplier id: {created}"))
        .to_string()
}

/// The floor app of a receiving site: a DC-role node that owns the site's
/// inventory (the PO is sent to it and it receives against it).
pub async fn receiving_node(api: &Api, site: &str) -> String {
    let origin = format!("{site}-floor");
    api.node(&origin, site, "DC").await;
    origin
}

/// Raise the order, receive it at `site` through `origin`, name the goods and
/// let Finance value the delivery.
pub async fn receive(
    api: &Api,
    origin: &str,
    site: &str,
    supplier_id: &str,
    goods: &[Goods],
) -> Received {
    let received = deliver(api, origin, site, supplier_id, goods).await;
    let named = name_goods(api, &received, goods).await;
    value_receipt(api, &named.receipt_id).await;
    named
}

/// The order and the verified delivery, with nothing named or valued yet.
pub async fn deliver(
    api: &Api,
    origin: &str,
    site: &str,
    supplier_id: &str,
    goods: &[Goods],
) -> Received {
    let po_number = format!("PO-{}", &Uuid::new_v4().simple().to_string()[..8]);
    let raised = api
        .post(
            INVENTORY,
            "/api/v1/purchase-orders",
            json!({
                "po_number": po_number,
                "supplier_id": supplier_id,
                "supplier_name": "PT Pemasok",
                "destination_site_id": site,
                "origin_kind": "DIRECT",
                "currency": "IDR",
                "created_by": INVENTORY,
                "lines": goods.iter().map(|g| json!({
                    "article_code": g.supplier_code,
                    "article_name": g.name,
                    "division_code": "PRIA",
                    "tags": [],
                    "ordered_quantity": g.quantity,
                    "unit_price_minor": g.unit_cost,
                })).collect::<Vec<_>>(),
            }),
        )
        .await;
    let po_id = raised["purchase_order_id"]
        .as_str()
        .unwrap_or_else(|| panic!("po id: {raised}"))
        .to_string();
    let detail = api
        .get(INVENTORY, &format!("/api/v1/purchase-orders/{po_id}"))
        .await;
    let po_lines: Vec<String> = detail["lines"]
        .as_array()
        .unwrap_or_else(|| panic!("po lines: {detail}"))
        .iter()
        .map(|l| l["po_line_id"].as_str().unwrap_or_default().to_string())
        .collect();

    let receipt_id = Uuid::new_v4();
    let receipt_number = format!("GRN-{}", &receipt_id.simple().to_string()[..8]);
    let arrived = Utc::now() - Duration::minutes(30);
    let mut facts = Vec::new();
    let mut receipt_lines = Vec::new();
    for (g, po_line) in goods.iter().zip(&po_lines) {
        let line_id = Uuid::new_v4();
        receipt_lines.push(line_id.to_string());
        facts.push((
            "goods_receipt.line",
            json!({
                "receipt_id": receipt_id,
                "receipt_number": receipt_number,
                "supplier_id": supplier_id,
                "arrived_at": arrived,
                "opened_by": "penerima",
                "opened_at": arrived,
                "receipt_line_id": line_id,
                "count_id": Uuid::new_v4(),
                "po_line_id": po_line,
                "movement_group_id": Uuid::new_v4(),
                "quantity": g.quantity,
                "matched_quantity": g.quantity,
                "excess_quantity": 0,
                "agreed_unit_price_minor": g.unit_cost,
                "counted_by": "penghitung",
                "verified_by": "pemeriksa",
                "counted_at": arrived,
                "verified_at": arrived,
            }),
        ));
    }
    api.ingest(origin, facts).await.ok("goods receipt facts");
    Received {
        po_id,
        receipt_id: receipt_id.to_string(),
        receipt_number,
        receipt_line_ids: receipt_lines,
        po_line_ids: po_lines,
        articles: Vec::new(),
        skus: Vec::new(),
    }
}

/// Head office names what arrived: one article per line, one SKU each.
pub async fn name_goods(api: &Api, received: &Received, goods: &[Goods]) -> Received {
    let mut out = received.clone();
    for (g, line) in goods.iter().zip(&received.receipt_line_ids) {
        let session = api
            .post(
                INVENTORY,
                "/api/v1/article-setups",
                json!({
                    "receipt_line_id": line,
                    "article_name": g.name,
                    "division_code": "PRIA",
                    "tags": [],
                    "currency": "IDR",
                    "created_by": INVENTORY,
                    "is_customer_supply": g.supply,
                    "colours": [{ "colour_digit": "1", "colour_code": "RED" }],
                    "variants": [{
                        "colour_digit": "1",
                        "size_code": "03",
                        "quantity": g.quantity,
                        "base_price_minor": g.sale_price,
                    }],
                }),
            )
            .await;
        let session_id = session["session_id"]
            .as_str()
            .unwrap_or_else(|| panic!("session: {session}"))
            .to_string();
        let issued = api
            .post(
                INVENTORY,
                &format!("/api/v1/article-setups/{session_id}/issue"),
                json!({ "issued_by": INVENTORY }),
            )
            .await;
        out.articles.push(
            session["article_code"].as_str().unwrap_or_default().to_string(),
        );
        out.skus.push(
            issued["variants"][0]["sku_code"]
                .as_str()
                .unwrap_or_else(|| panic!("sku: {issued}"))
                .to_string(),
        );
    }
    out
}

/// Finance values the delivery (the hourly agent does the same call).
pub async fn value_receipt(api: &Api, receipt_id: &str) -> Value {
    api.post(
        FINANCE,
        &format!("/api/v1/finance/receipts/{receipt_id}/post"),
        json!({}),
    )
    .await
}

pub fn shirt(quantity: i64, cost: i64, price: i64) -> Goods {
    Goods {
        supplier_code: "SUP-KEMEJA-01",
        name: "Kemeja Lengan Panjang",
        quantity,
        unit_cost: cost,
        sale_price: price,
        supply: false,
    }
}

pub fn trousers(quantity: i64, cost: i64, price: i64) -> Goods {
    Goods {
        supplier_code: "SUP-CELANA-01",
        name: "Celana Panjang",
        quantity,
        unit_cost: cost,
        sale_price: price,
        supply: false,
    }
}

pub fn bags(quantity: i64, cost: i64) -> Goods {
    Goods {
        supplier_code: "SUP-KANTONG-01",
        name: "Kantong Belanja",
        quantity,
        unit_cost: cost,
        sale_price: 1_000,
        supply: true,
    }
}
