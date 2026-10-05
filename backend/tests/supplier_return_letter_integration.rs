//! Confirming a return to a supplier issues its surat.
//!
//! The return (0717's `supplier_return`) and the paper it travels on are one
//! act since 0828: pressing Confirm draws a `SUPPLIER_RETURN` letter from the
//! return's allotment, takes the next number in the SJR series and freezes
//! both in the transaction that writes the return. These tests pin the parts
//! the supplier-facing paper depends on — the kind, the series, the facts it
//! prints (reason, supplier, person in charge, the note), the table of goods
//! — and that the register stops offering a return that already has one.

use inventory_backend::cloud::{
    domain::{
        auth::Role,
        flow::Actor,
    },
    postgres::{letters, supplier_returns},
};
use sqlx::{PgPool, Row};
use uuid::Uuid;

fn actor() -> Actor {
    Actor {
        id: "rina".into(),
        rung: Role::Admin,
        flow_roles: None,
    }
}

/// Return stock at the head-office site, one supplier, and nothing else.
async fn seed(pool: &PgPool) -> String {
    sqlx::query(
        "INSERT INTO operational_pool (id, site_id, group_code, pool_code, label, display_order) \
         VALUES ('dc.return.stock', 'dc', 'RETURN', 'RETURN', 'Return stock', 99)",
    )
    .execute(pool)
    .await
    .unwrap_or_else(|e| panic!("return pool: {e}"));

    let supplier_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO supplier (supplier_id, supplier_code, supplier_code_normalized, name, \
                               created_by, updated_by) \
         VALUES ($1, 'SUP-RET', 'sup-ret', 'Cv Penerima Retur', 'test', 'test')",
    )
    .bind(supplier_id)
    .execute(pool)
    .await
    .unwrap_or_else(|e| panic!("supplier: {e}"));

    // raise_supplier_return matches the supplier by id or code.
    "SUP-RET".into()
}

fn a_return(supplier: &str, reason: &str) -> supplier_returns::NewSupplierReturn {
    supplier_returns::NewSupplierReturn {
        supplier_id: supplier.into(),
        reason: reason.into(),
        settle_by: "REPLACEMENT".into(),
        source_pool_id: "dc.return.stock".into(),
        lines: vec![supplier_returns::NewSupplierReturnLine {
            sku_code: "SKU-01-S".into(),
            quantity: 2,
        }],
        note: Some("One carton beyond the order".into()),
    }
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn confirming_a_return_issues_its_surat_in_the_same_breath(pool: PgPool) {
    let supplier = seed(&pool).await;

    let raised = supplier_returns::raise_supplier_return(
        &pool,
        a_return(&supplier, "OVER_DELIVERY"),
        &actor(),
    )
    .await
    .unwrap_or_else(|e| panic!("raise: {e}"));

    let letter_id = raised
        .letter_id
        .unwrap_or_else(|| panic!("a confirmed return carries its surat"));
    let number = raised.letter_number.as_deref().unwrap_or_else(|| {
        panic!("an issued surat has its number")
    });
    assert!(
        number.starts_with("SJR/"),
        "the surat is numbered in the SJR series, got {number}"
    );

    let row = sqlx::query(
        "SELECT kind, status, subject_kind, subject_id, letter_number, facts, lines \
         FROM letter WHERE letter_id = $1",
    )
    .bind(letter_id)
    .fetch_one(&pool)
    .await
    .unwrap_or_else(|e| panic!("letter: {e}"));

    assert_eq!(row.get::<String, _>("kind"), "SUPPLIER_RETURN");
    assert_eq!(
        row.get::<String, _>("status"),
        "ISSUED",
        "there is no draft stage on this kind"
    );
    assert_eq!(
        row.get::<String, _>("subject_id"),
        raised.allotment_id.to_string(),
        "the surat is drawn from the return's allotment"
    );

    let facts = row.get::<serde_json::Value, _>("facts");
    assert_eq!(facts["reason"], "OVER_DELIVERY");
    assert_eq!(facts["counterparty"], "Cv Penerima Retur");
    assert_eq!(facts["raised_by"], "rina", "the person in charge");
    assert_eq!(facts["reference"], raised.allotment_number);
    assert_eq!(facts["notes"], "One carton beyond the order");

    // The table of goods reads the allotment's lines, in pieces.
    let lines = row.get::<serde_json::Value, _>("lines");
    let lines = lines.as_array().unwrap();
    assert_eq!(lines.len(), 1);
    assert_eq!(lines[0]["code"], "SKU-01-S");
    assert_eq!(lines[0]["quantity"], 2);

    // One surat per return: the register no longer offers the record.
    let sources = letters::letter_sources(&pool, "SUPPLIER_RETURN")
        .await
        .unwrap_or_else(|e| panic!("sources: {e}"));
    assert!(
        sources.is_empty(),
        "a return with a surat is not offered again, got {:?}",
        sources
    );

    // And it reads back on the list the screens fold into one book.
    let listed = supplier_returns::list_supplier_returns(&pool)
        .await
        .unwrap_or_else(|e| panic!("list: {e}"));
    assert_eq!(listed.items.len(), 1);
    assert_eq!(listed.items[0].letter_id, Some(letter_id));
    assert_eq!(listed.items[0].letter_number.as_deref(), Some(number));
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_return_is_raised_for_one_of_the_two_reasons_only(pool: PgPool) {
    let supplier = seed(&pool).await;

    let refused = supplier_returns::raise_supplier_return(
        &pool,
        a_return(&supplier, "DEFECT"),
        &actor(),
    )
    .await;

    let error = format!("{}", refused.unwrap_err());
    assert!(
        error.contains("OVER_DELIVERY"),
        "the refusal names the reasons there are: {error}"
    );

    // The mismatch reason stands.
    let raised = supplier_returns::raise_supplier_return(
        &pool,
        a_return(&supplier, "ITEM_MISMATCH"),
        &actor(),
    )
    .await
    .unwrap_or_else(|e| panic!("raise ITEM_MISMATCH: {e}"));
    let facts: serde_json::Value = sqlx::query_scalar(
        "SELECT facts FROM letter WHERE letter_id = $1",
    )
    .bind(raised.letter_id.unwrap())
    .fetch_one(&pool)
    .await
    .unwrap_or_else(|e| panic!("letter: {e}"));
    assert_eq!(facts["reason"], "ITEM_MISMATCH");
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn settling_the_return_leaves_its_surat_alone(pool: PgPool) {
    let supplier = seed(&pool).await;

    let raised = supplier_returns::raise_supplier_return(
        &pool,
        a_return(&supplier, "ITEM_MISMATCH"),
        &actor(),
    )
    .await
    .unwrap_or_else(|e| panic!("raise: {e}"));
    let letter_id = raised.letter_id.unwrap();

    // A settlement is recorded against the return; the surat is not rewritten.
    supplier_returns::settle_supplier_return(
        &pool,
        raised.allotment_id,
        supplier_returns::NewSettlement {
            kind: "REPLACEMENT".into(),
            quantity: Some(1),
            amount_minor: None,
            reference: Some("PO-9001".into()),
        },
        "receiving-1",
    )
    .await
    .unwrap_or_else(|e| panic!("settle: {e}"));

    let row = sqlx::query(
        "SELECT status, issued_at, facts FROM letter WHERE letter_id = $1",
    )
    .bind(letter_id)
    .fetch_one(&pool)
    .await
    .unwrap_or_else(|e| panic!("letter: {e}"));
    assert_eq!(row.get::<String, _>("status"), "ISSUED");
    assert!(
        row.get::<Option<chrono::DateTime<chrono::Utc>>, _>("issued_at").is_some(),
        "the surat keeps the moment it was issued"
    );
    assert_eq!(row.get::<serde_json::Value, _>("facts")["reason"], "ITEM_MISMATCH");
}
