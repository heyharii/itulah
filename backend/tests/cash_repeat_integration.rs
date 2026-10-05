//! A BKK that repeats (0716): what may repeat is decided when it is saved, not
//! the first time it fails.

use chrono::NaiveDate;
use inventory_backend::cloud::postgres::{save_cash_document_repeat, SaveCashDocumentRepeatRequest};
use serde_json::json;
use sqlx::PgPool;

fn repeat(voucher: serde_json::Value) -> SaveCashDocumentRepeatRequest {
    SaveCashDocumentRepeatRequest {
        repeat_id: None,
        name: "Sewa gudang".into(),
        voucher,
        frequency: "MONTHLY".into(),
        next_date: NaiveDate::from_ymd_opt(2026, 11, 5).expect("date"),
        end_date: None,
        is_active: true,
    }
}

fn bkk(method: &str, line: serde_json::Value) -> serde_json::Value {
    json!({
        "direction": "OUT",
        "money": { "semantic_key": "bank_giro", "qualifier": "BCA" },
        "method": method,
        "party_name": "PT Gudang Jaya",
        "memo": "Sewa gudang bulanan",
        "lines": [line],
    })
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_bkk_that_settles_a_bill_or_pays_by_giro_cannot_repeat(pool: PgPool) {
    let settle = bkk(
        "TRANSFER",
        json!({ "kind": "SETTLE", "invoice_id": uuid::Uuid::new_v4(), "amount_minor": 5_000_000 }),
    );
    let refused = save_cash_document_repeat(&pool, &repeat(settle), "finance")
        .await
        .expect_err("a bill is settled once");
    assert!(refused.to_string().contains("only Other lines can repeat"), "{refused}");

    let giro = bkk(
        "GIRO",
        json!({ "kind": "OTHER", "account": { "account_code": "6301" }, "amount_minor": 5_000_000 }),
    );
    let refused = save_cash_document_repeat(&pool, &repeat(giro), "finance")
        .await
        .expect_err("a giro is one piece of paper");
    assert!(refused.to_string().contains("cannot repeat"), "{refused}");

    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM cash_document_repeat")
        .fetch_one(&pool)
        .await
        .expect("count");
    assert_eq!(count, 0, "a refused repeat leaves nothing behind");
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_repeat_of_other_lines_is_kept_without_its_date(pool: PgPool) {
    let mut body = bkk(
        "TRANSFER",
        json!({ "kind": "OTHER", "account": { "account_code": "6301" }, "amount_minor": 5_000_000 }),
    );
    body["doc_date"] = json!("2026-01-01");
    let saved = save_cash_document_repeat(&pool, &repeat(body), "finance")
        .await
        .expect("other lines repeat");
    assert_eq!(saved.direction, "OUT");
    assert_eq!(saved.amount_minor, 5_000_000);
    assert_eq!(saved.party_name, "PT Gudang Jaya");
    assert!(
        saved.voucher.get("doc_date").is_none(),
        "the date belongs to each run, not to the repeat"
    );
}
