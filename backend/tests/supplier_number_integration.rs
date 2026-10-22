//! A supplier's number is the server's to give, and its legal form is checked.
//!
//! The owner's rules of 2026-09-26: a supplier registered without a code is
//! numbered by the server — four digits, `0001` upward, after Save — and it
//! names a legal form from a closed list (PT, CV, UD). A code typed by hand is
//! still honoured, and the next number skips past it rather than colliding.

use inventory_backend::cloud::domain::SupplierStatus;
use inventory_backend::cloud::postgres::{self as cloud, CreateSupplierRequest};
use sqlx::PgPool;

const ACTOR: &str = "supplier-number-test";

fn request(name: &str, code: Option<&str>, legal_form: Option<&str>) -> CreateSupplierRequest {
    CreateSupplierRequest {
        supplier_code: code.map(str::to_owned),
        name: name.to_owned(),
        contact_name: None,
        phone: Some("0887 7993 12312".to_owned()),
        email: None,
        address: Some("Jl. Industri Raya No. 14, Bandung".to_owned()),
        status: SupplierStatus::Active,
        category: None,
        expense_account_code: None,
        npwp: None,
        is_pkp: None,
        default_payment_terms_code: None,
        legal_form: legal_form.map(str::to_owned),
        notes: None,
        kind: None,
    }
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_supplier_without_a_code_is_numbered_in_four_digits(pool: PgPool) {
    // Past whatever the seed already filed as a four-digit number.
    let highest: Option<i32> = sqlx::query_scalar(
        "SELECT max(supplier_code::integer) FROM supplier WHERE supplier_code ~ '^[0-9]{4}$'",
    )
    .fetch_one(&pool)
    .await
    .unwrap_or_else(|e| panic!("highest: {e}"));
    let start = highest.unwrap_or(0);

    let first = cloud::create_supplier(
        &pool,
        request("Sepatu Sejahtera", None, Some("cv")),
        ACTOR,
        "n-1",
        "d1",
    )
    .await
    .unwrap_or_else(|e| panic!("first: {e}"));
    let second =
        cloud::create_supplier(&pool, request("Tas Makmur", None, None), ACTOR, "n-2", "d2")
            .await
            .unwrap_or_else(|e| panic!("second: {e}"));

    assert_eq!(first.supplier_code, format!("{:04}", start + 1));
    assert_eq!(second.supplier_code, format!("{:04}", start + 2));
    // Typed in lower case, stored as the form's own word.
    assert_eq!(first.legal_form.as_deref(), Some("CV"));
    assert_eq!(second.legal_form, None);

    // A retry with the same key is answered with the number it was given the
    // first time, not the next one.
    let again = cloud::create_supplier(
        &pool,
        request("Sepatu Sejahtera", None, Some("cv")),
        ACTOR,
        "n-1",
        "d1",
    )
    .await
    .unwrap_or_else(|e| panic!("retry: {e}"));
    assert_eq!(again.supplier_code, first.supplier_code);
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_typed_number_is_skipped_past_and_an_unknown_legal_form_refused(pool: PgPool) {
    let typed = cloud::create_supplier(
        &pool,
        request("Kain Jaya", Some("9000"), None),
        ACTOR,
        "t-1",
        "d1",
    )
    .await
    .unwrap_or_else(|e| panic!("typed: {e}"));
    assert_eq!(typed.supplier_code, "9000");

    let next = cloud::create_supplier(
        &pool,
        request("Benang Abadi", None, None),
        ACTOR,
        "t-2",
        "d2",
    )
    .await
    .unwrap_or_else(|e| panic!("next: {e}"));
    assert_eq!(next.supplier_code, "9001");

    let refused = cloud::create_supplier(
        &pool,
        request("Kancing Baru", None, Some("LLC")),
        ACTOR,
        "t-3",
        "d3",
    )
    .await;
    assert!(refused.is_err(), "LLC is not a legal form this book knows");
}
