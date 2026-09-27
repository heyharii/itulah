//! GA tahap 6: the handoff to Finance.
//!
//! What 0370 installed and what `postgres::ga_accounts`, `payables`, the GA
//! readers and `payment_instructions` enforce: the references a bill line can
//! carry, the account it proposes (brief §8.2), the draft GA files (§8.3), the
//! six warnings before posting (§8.4), the hold that stops payment, the draft a
//! payment request becomes, and the figures GA reads back from POSTED lines.
//!
//! The style follows the other GA suites: a helper builds the ordinary case so
//! each test says only what it is about.

use chrono::NaiveDate;
use inventory_backend::cloud::postgres as cloud;
use sqlx::PgPool;
use uuid::Uuid;

const ACTOR: &str = "ana";
/// The second pair of eyes: the maker may not approve their own budget.
const CHECKER: &str = "budi";
const SITE: &str = "dc";

fn day(year: i32, month: u32, day: u32) -> NaiveDate {
    NaiveDate::from_ymd_opt(year, month, day).unwrap_or_else(|| panic!("bad date"))
}

/// The business day every read is answered against: late September 2026.
fn today() -> NaiveDate {
    day(2026, 9, 24)
}

async fn map(pool: &PgPool, key: &str, qualifier: &str, code: &str, category: Option<&str>) {
    cloud::set_account_link(
        pool,
        &cloud::SetAccountLinkRequest {
            role: key.into(),
            source_type: "COMPANY".into(),
            source_id: qualifier.into(),
            scope_type: "SITE".into(),
            scope_key: SITE.into(),
            account_code: code.into(),
            category_code: category.map(str::to_string),
            note: None,
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("map {key}/{qualifier}: {error}"));
}

/// The meanings a posted expense bill needs: the payable it credits, and an
/// open month to post into.
async fn seed_payables(pool: &PgPool) {
    map(pool, "non_merchandise_payable", "", "2004", None).await;
    cloud::open_period(pool, 2026, 9)
        .await
        .unwrap_or_else(|error| panic!("open period: {error}"));
}

/// A registered supplier. Returns its ID as the text a bill carries.
async fn a_supplier(pool: &PgPool, name: &str, expense_account: Option<&str>) -> String {
    let id = Uuid::new_v4();
    let suffix = id.simple().to_string();
    sqlx::query(
        "INSERT INTO supplier (supplier_id, supplier_code, supplier_code_normalized, name,
                               category, expense_account_code, created_by, updated_by)
         VALUES ($1,$2,$3,$4,'EXPENSE',$5,$6,$6)",
    )
    .bind(id)
    .bind(format!("SUP-GA6-{}", &suffix[..8]))
    .bind(format!("sup-ga6-{}", &suffix[..8]))
    .bind(name)
    .bind(expense_account)
    .bind(ACTOR)
    .execute(pool)
    .await
    .unwrap_or_else(|error| panic!("supplier: {error}"));
    id.to_string()
}

/// One of a supplier's bank accounts, in whatever verification state a test
/// needs.
async fn a_bank(pool: &PgPool, supplier_id: &str, verification: &str) {
    let verified_at = if verification == "UNVERIFIED" {
        "NULL::timestamptz"
    } else {
        "now()"
    };
    let verified_by = if verification == "UNVERIFIED" {
        "NULL::text"
    } else {
        "'budi'"
    };
    let sql = format!(
        "INSERT INTO bank_account
           (account_id, is_company_account, party_type, party_id, party_name, account_holder,
            owner_domain, account_number_enc, account_number_mask, verification_status,
            verified_by, verified_at, active, created_by, updated_by)
         VALUES (gen_random_uuid(), false, 'SUPPLIER', $1, $2, $2, 'FINANCE',
                 '\\x00'::bytea, '••••3456', $3, {verified_by}, {verified_at}, true, $4, $4)"
    );
    sqlx::query(&sql)
        .bind(supplier_id)
        .bind(format!("PT {supplier_id}"))
        .bind(verification)
        .bind(ACTOR)
        .execute(pool)
        .await
        .unwrap_or_else(|error| panic!("bank account: {error}"));
}

/// A line with everything unset except what the test is about.
fn a_line(account: &str, amount: i64) -> cloud::RecordBillLine {
    cloud::RecordBillLine {
        account_code: account.into(),
        site_id: SITE.into(),
        amount_minor: amount,
        category_code: None,
        asset_class_code: None,
        draws_reserve: false,
        asset_id: None,
        contract_id: None,
        repair_id: None,
        replacement_id: None,
        supply_request_id: None,
        service_period_start: None,
        service_period_end: None,
        account_overridden: false,
        memo: None,
    }
}

fn a_bill_request(
    supplier_id: &str,
    number: &str,
    amount: i64,
    lines: Vec<cloud::RecordBillLine>,
) -> cloud::RecordBillRequest {
    cloud::RecordBillRequest {
        invoice_number: number.into(),
        supplier_id: supplier_id.into(),
        supplier_name: Some(format!("PT {supplier_id}")),
        site_id: SITE.into(),
        invoice_date: day(2026, 9, 10),
        due_date: Some(day(2026, 9, 30)),
        subtotal_minor: amount,
        tax_minor: 0,
        discount_minor: 0,
        note: None,
        kind: Some("EXPENSE".into()),
        lines: Some(lines),
        receipt_ids: None,
        matching: None,
        withholding_code: None,
        submitted_by_domain: None,
        document_ref: None,
    }
}

async fn a_draft(
    pool: &PgPool,
    supplier_id: &str,
    number: &str,
    amount: i64,
    lines: Vec<cloud::RecordBillLine>,
) -> cloud::SupplierBill {
    cloud::record_bill_draft(pool, &a_bill_request(supplier_id, number, amount, lines), ACTOR)
        .await
        .unwrap_or_else(|error| panic!("draft {number}: {error}"))
}

async fn a_posted(
    pool: &PgPool,
    supplier_id: &str,
    number: &str,
    amount: i64,
    lines: Vec<cloud::RecordBillLine>,
) -> cloud::SupplierBill {
    cloud::record_bill(pool, &a_bill_request(supplier_id, number, amount, lines), ACTOR)
        .await
        .unwrap_or_else(|error| panic!("posted {number}: {error}"))
}

/// A contract with a free-text counterparty, so a bill pointing at it can be
/// built without a supplier row.
async fn a_contract(
    pool: &PgPool,
    value: Option<i64>,
    ends_on: Option<NaiveDate>,
) -> cloud::GaContractRow {
    cloud::ga_contract_record(
        pool,
        &cloud::RecordGaContractRequest {
            contract_number: Some(format!("LK/{value:?}")),
            contract_type: "SEWA_TOKO".into(),
            objek: None,
            supplier_id: None,
            counterparty_name: Some("Pasar Raya Inkubator".into()),
            site_id: Some(SITE.into()),
            site_scope: None,
            asset_id: None,
            starts_on: day(2026, 1, 1),
            ends_on,
            contract_value_minor: value,
            is_signed: true,
            signed_by: Some("Bpk. Har".into()),
            customer_number: None,
            reminder_days: 60,
            notes: None,
        },
        ACTOR,
        today(),
    )
    .await
    .unwrap_or_else(|error| panic!("contract: {error}"))
}

async fn an_asset(pool: &PgPool, class_code: &str) -> Uuid {
    let id = Uuid::new_v4();
    let suffix = id.simple().to_string();
    sqlx::query(
        "INSERT INTO fixed_asset
           (asset_id, asset_number, name, category_code, site_id, acquired_on, status, registered_by)
         VALUES ($1,$2,$3,$4,'dc',$5,'REGISTERED','ana')",
    )
    .bind(id)
    .bind(format!("AST-GA6-{}", &suffix[..8]))
    .bind(format!("Aset {class_code}"))
    .bind(class_code)
    .bind(today())
    .execute(pool)
    .await
    .unwrap_or_else(|error| panic!("asset: {error}"));
    id
}

async fn a_repair(pool: &PgPool, asset_id: Option<Uuid>, objek: &str) -> cloud::GaRepairRow {
    let supplier_id = Uuid::new_v4();
    let suffix = supplier_id.simple().to_string();
    sqlx::query(
        "INSERT INTO supplier (supplier_id, supplier_code, supplier_code_normalized, name,
                               created_by, updated_by)
         VALUES ($1,$2,$3,'Teknisi Servis Nusantara','ana','ana')",
    )
    .bind(supplier_id)
    .bind(format!("SUP-REP-{}", &suffix[..8]))
    .bind(format!("sup-rep-{}", &suffix[..8]))
    .execute(pool)
    .await
    .unwrap_or_else(|error| panic!("repair supplier: {error}"));

    cloud::ga_repair_record(
        pool,
        &cloud::RecordGaRepairRequest {
            site_id: SITE.into(),
            asset_id,
            objek: Some(objek.into()),
            title: "AC cassette tidak dingin".into(),
            supplier_id,
            contract_id: None,
            task_id: None,
            inspection_id: None,
            estimated_cost_minor: Some(5_000_000),
            failure_at: day(2026, 9, 20),
            notes: None,
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("repair: {error}"))
}

async fn a_supply_request(pool: &PgPool) -> cloud::GaSupplyRequestRow {
    cloud::ga_supply_record(
        pool,
        &cloud::RecordGaSupplyRequestRequest {
            site_id: SITE.into(),
            requested_by: "Rina".into(),
            category_code: "ATK".into(),
            item: "Kertas A4 80gsm".into(),
            quantity: Some("10 rim".into()),
            needed_by: Some(day(2026, 10, 1)),
            estimated_cost_minor: Some(750_000),
            notes: None,
        },
        ACTOR,
        None,
    )
    .await
    .unwrap_or_else(|error| panic!("supply request: {error}"))
}

// ---------------------------------------------------------------------------
// 1. The migration
// ---------------------------------------------------------------------------

/// The columns exist, the two CHECKs really refuse, and the service period runs
/// forward.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn the_migration_installs_the_references_and_the_holds(pool: PgPool) {
    let line_columns: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM information_schema.columns
          WHERE table_name = 'supplier_invoice_expense_line'
            AND column_name IN ('contract_id','repair_id','replacement_id','supply_request_id',
                                'service_period_start','service_period_end','account_overridden')",
    )
    .fetch_one(&pool)
    .await
    .unwrap_or_else(|error| panic!("line columns: {error}"));
    assert_eq!(line_columns, 7, "the seven bill-line columns must exist");

    let bill_columns: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM information_schema.columns
          WHERE table_name = 'supplier_invoice'
            AND column_name IN ('on_hold','hold_reason','release_date','submitted_by_domain',
                                'returned_reason')",
    )
    .fetch_one(&pool)
    .await
    .unwrap_or_else(|error| panic!("bill columns: {error}"));
    assert_eq!(bill_columns, 5, "the five bill columns must exist");

    // A hold with no reason is refused by the database, not only by Rust.
    seed_payables(&pool).await;
    let supplier = a_supplier(&pool, "PT Uji", Some("6045")).await;
    let bill = a_draft(&pool, &supplier, "MIG-1", 1_000, vec![a_line("6045", 1_000)]).await;
    let held = sqlx::query("UPDATE supplier_invoice SET on_hold = true, hold_reason = NULL WHERE invoice_id = $1")
        .bind(bill.invoice_id)
        .execute(&pool)
        .await;
    assert!(held.is_err(), "an unexplained hold must be refused");

    // A service period that ends before it starts is refused too.
    let line_id: Uuid = sqlx::query_scalar(
        "SELECT line_id FROM supplier_invoice_expense_line WHERE invoice_id = $1",
    )
    .bind(bill.invoice_id)
    .fetch_one(&pool)
    .await
    .unwrap_or_else(|error| panic!("line: {error}"));
    let backwards = sqlx::query(
        "UPDATE supplier_invoice_expense_line
            SET service_period_start = DATE '2026-12-31', service_period_end = DATE '2026-01-01'
          WHERE line_id = $1",
    )
    .bind(line_id)
    .execute(&pool)
    .await;
    assert!(backwards.is_err(), "a backwards service period must be refused");
}

// ---------------------------------------------------------------------------
// 2. One line, one object
// ---------------------------------------------------------------------------

#[sqlx::test(migrations = "./migrations/postgres")]
async fn two_references_on_one_line_are_refused_with_an_example(pool: PgPool) {
    let supplier = a_supplier(&pool, "PT Dua", Some("6045")).await;
    let contract = a_contract(&pool, Some(1_000_000), None).await;
    let repair = a_repair(&pool, None, "AC").await;

    let mut line = a_line("6045", 1_000);
    line.contract_id = Some(contract.contract_id);
    line.repair_id = Some(repair.repair_id);
    let refused = cloud::record_bill_draft(
        &pool,
        &a_bill_request(&supplier, "DUA-1", 1_000, vec![line]),
        ACTOR,
    )
    .await
    .expect_err("one line naming two objects must be refused");
    let message = refused.to_string();
    assert!(
        message.contains("one line is for one object") && message.contains("TWO lines"),
        "the refusal should show the split, said: {message}"
    );
}

// ---------------------------------------------------------------------------
// 3. A reference must exist
// ---------------------------------------------------------------------------

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_reference_to_nothing_is_refused_by_name(pool: PgPool) {
    let supplier = a_supplier(&pool, "PT Hilang", Some("6045")).await;
    let mut line = a_line("6045", 1_000);
    line.repair_id = Some(Uuid::new_v4());
    let refused = cloud::record_bill_draft(
        &pool,
        &a_bill_request(&supplier, "HILANG-1", 1_000, vec![line]),
        ACTOR,
    )
    .await
    .expect_err("a reference to nothing must be refused");
    let message = refused.to_string();
    assert!(
        message.contains("line 1") && message.contains("repair"),
        "the refusal should name the line and the object, said: {message}"
    );
}

// ---------------------------------------------------------------------------
// 4. Draft from GA
// ---------------------------------------------------------------------------

/// A GA draft is a DRAFT with the GA mark and a line whose account the repair
/// proposed; posting it keeps the SAME id and puts it in the books (AP) for the
/// first time.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_ga_draft_becomes_the_same_bill_once_posted(pool: PgPool) {
    seed_payables(&pool).await;
    map(&pool, "repair_expense", "AC", "6072", None).await;
    let supplier = a_supplier(&pool, "PT Servis", Some("6045")).await;
    let repair = a_repair(&pool, None, "AC").await;

    // What the GA form does: no account_code, so the server proposes one.
    let suggestion = cloud::suggest_account(
        &pool,
        SITE,
        &cloud::LineRefs {
            repair_id: Some(repair.repair_id),
            supplier_id: Some(supplier.clone()),
            ..Default::default()
        },
    )
    .await
    .unwrap_or_else(|error| panic!("suggest: {error}"));
    assert_eq!(suggestion.account_code.as_deref(), Some("6072"));

    let mut line = a_line(suggestion.account_code.as_deref().unwrap(), 5_000_000);
    line.repair_id = Some(repair.repair_id);
    let request = cloud::RecordBillRequest {
        submitted_by_domain: Some("GA".into()),
        ..a_bill_request(&supplier, "GA-1", 5_000_000, vec![line])
    };
    let draft = cloud::record_bill_draft(&pool, &request, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("ga draft: {error}"));

    assert_eq!(draft.status, "DRAFT");
    assert_eq!(draft.submitted_by_domain.as_deref(), Some("GA"));
    assert!(draft.journal_entry_id.is_none(), "a draft is not AP yet");
    let line = draft.lines.as_ref().and_then(|lines| lines.first()).unwrap();
    assert_eq!(line.repair_id, Some(repair.repair_id));

    // Not a debt until it posts.
    let aging = cloud::payables_aging(&pool, today(), None)
        .await
        .unwrap_or_else(|error| panic!("aging: {error}"));
    assert_eq!(aging.total.total_minor, 0, "a draft is not a payable");

    let posted = cloud::post_bill(&pool, draft.invoice_id, None, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("post: {error}"));
    assert_eq!(posted.invoice_id, draft.invoice_id, "the id never moves");
    assert_eq!(posted.status, "POSTED");
    assert!(posted.journal_entry_id.is_some(), "posting makes it AP");

    let after = cloud::payables_aging(&pool, today(), None)
        .await
        .unwrap_or_else(|error| panic!("aging: {error}"));
    assert_eq!(after.total.total_minor, 5_000_000, "now it is a payable");
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn the_ga_inbox_filter_narrows_on_the_server(pool: PgPool) {
    let supplier = a_supplier(&pool, "PT Inbox", Some("6045")).await;
    let ga = cloud::RecordBillRequest {
        submitted_by_domain: Some("GA".into()),
        ..a_bill_request(&supplier, "INBOX-GA", 1_000, vec![a_line("6045", 1_000)])
    };
    cloud::record_bill_draft(&pool, &ga, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("ga: {error}"));
    // Finance's own draft, which the inbox must NOT show.
    cloud::record_bill_draft(
        &pool,
        &a_bill_request(&supplier, "INBOX-FIN", 2_000, vec![a_line("6045", 2_000)]),
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("finance: {error}"));

    let page = cloud::bill_page(
        &pool,
        cloud::BillScope {
            draft_from: Some("GA".into()),
            ..Default::default()
        },
    )
    .await
    .unwrap_or_else(|error| panic!("page: {error}"));
    assert_eq!(page.total, 1, "only the GA draft is in the inbox");
    assert_eq!(page.rows.len(), 1);
    assert_eq!(page.rows[0].submitted_by_domain.as_deref(), Some("GA"));
}

// ---------------------------------------------------------------------------
// 5. The account precedence (brief §8.2)
// ---------------------------------------------------------------------------

#[sqlx::test(migrations = "./migrations/postgres")]
async fn the_suggestion_follows_the_brief_order(pool: PgPool) {
    // 1. A line that buys an asset proposes the class's fixed-asset account.
    map(&pool, "fixed_asset", "AIR_CONDITIONER", "1067", None).await;
    let bought = cloud::suggest_account(
        &pool,
        SITE,
        &cloud::LineRefs {
            asset_class_code: Some("AIR_CONDITIONER".into()),
            ..Default::default()
        },
    )
    .await
    .unwrap_or_else(|error| panic!("class suggest: {error}"));
    assert_eq!(bought.account_code.as_deref(), Some("1067"));
    assert!(bought.source.starts_with("kelas aset"), "{}", bought.source);

    // 2. A line that pays for a repair proposes the repair object's account.
    map(&pool, "repair_expense", "AC", "6072", None).await;
    let repair = a_repair(&pool, None, "AC").await;
    let repaired = cloud::suggest_account(
        &pool,
        SITE,
        &cloud::LineRefs {
            repair_id: Some(repair.repair_id),
            ..Default::default()
        },
    )
    .await
    .unwrap_or_else(|error| panic!("repair suggest: {error}"));
    assert_eq!(repaired.account_code.as_deref(), Some("6072"));
    assert!(repaired.source.starts_with("objek perbaikan"));

    // 3a. A contract paid in advance speaks `prepaid_kind`, not the type.
    map(&pool, "prepaid_expense", "SEWA_TOKO_BAYAR_DIMUKA", "1038", None).await;
    let contract = a_contract(&pool, Some(240_000_000), None).await;
    let prepaid = cloud::suggest_account(
        &pool,
        SITE,
        &cloud::LineRefs {
            contract_id: Some(contract.contract_id),
            prepaid: true,
            ..Default::default()
        },
    )
    .await
    .unwrap_or_else(|error| panic!("prepaid suggest: {error}"));
    assert_eq!(prepaid.account_code.as_deref(), Some("1038"));
    assert!(prepaid.source.contains("bayar dimuka"), "{}", prepaid.source);

    // 3b. A contract NOT paid in advance goes by its type.
    map(&pool, "contract_expense", "SEWA_TOKO", "7004", None).await;
    let charge = cloud::suggest_account(
        &pool,
        SITE,
        &cloud::LineRefs {
            contract_id: Some(contract.contract_id),
            ..Default::default()
        },
    )
    .await
    .unwrap_or_else(|error| panic!("contract suggest: {error}"));
    assert_eq!(charge.account_code.as_deref(), Some("7004"));

    // 3c. JASA_MAINTENANCE follows the object it maintains.
    map(&pool, "repair_expense", "AC", "6072", None).await;
    let maintenance = cloud::ga_contract_record(
        &pool,
        &cloud::RecordGaContractRequest {
            contract_number: Some("MT/1".into()),
            contract_type: "JASA_MAINTENANCE".into(),
            objek: Some("AC".into()),
            supplier_id: None,
            counterparty_name: Some("Vendor Servis".into()),
            site_id: Some(SITE.into()),
            site_scope: None,
            asset_id: None,
            starts_on: day(2026, 1, 1),
            ends_on: None,
            contract_value_minor: None,
            is_signed: true,
            signed_by: Some("Bpk. Har".into()),
            customer_number: None,
            reminder_days: 60,
            notes: None,
        },
        ACTOR,
        today(),
    )
    .await
    .unwrap_or_else(|error| panic!("maintenance: {error}"));
    let follows = cloud::suggest_account(
        &pool,
        SITE,
        &cloud::LineRefs {
            contract_id: Some(maintenance.contract_id),
            ..Default::default()
        },
    )
    .await
    .unwrap_or_else(|error| panic!("maintenance suggest: {error}"));
    assert_eq!(follows.account_code.as_deref(), Some("6072"));
    assert!(follows.source.starts_with("kontrak maintenance"));

    // 4. A supply request proposes its category's account.
    let request = a_supply_request(&pool).await;
    let supply = cloud::suggest_account(
        &pool,
        SITE,
        &cloud::LineRefs {
            supply_request_id: Some(request.request_id),
            ..Default::default()
        },
    )
    .await
    .unwrap_or_else(|error| panic!("supply suggest: {error}"));
    assert_eq!(supply.account_code.as_deref(), Some("6041"));
    assert!(supply.source.starts_with("kategori supplies"));

    // 5. Nothing else proposes the vendor's own default.
    let vendor = a_supplier(&pool, "PT Default", Some("6057")).await;
    let default = cloud::suggest_account(
        &pool,
        SITE,
        &cloud::LineRefs {
            supplier_id: Some(vendor.clone()),
            ..Default::default()
        },
    )
    .await
    .unwrap_or_else(|error| panic!("default suggest: {error}"));
    assert_eq!(default.account_code.as_deref(), Some("6057"));
    assert_eq!(default.source, "akun default vendor");

    // And a type with no account is an ANSWER, not a guess: account None and
    // `missing` filled, so Finance knows what to decide (brief §4.2).
    // Record a SEWA_KENDARAAN directly: the register's own writer.
    let van = cloud::ga_contract_record(
        &pool,
        &cloud::RecordGaContractRequest {
            contract_number: Some("VAN/1".into()),
            contract_type: "SEWA_KENDARAAN".into(),
            objek: None,
            supplier_id: None,
            counterparty_name: Some("Pemilik van".into()),
            site_id: Some(SITE.into()),
            site_scope: None,
            asset_id: None,
            starts_on: day(2026, 1, 1),
            ends_on: None,
            contract_value_minor: Some(12_000_000),
            is_signed: false,
            signed_by: None,
            customer_number: None,
            reminder_days: 30,
            notes: None,
        },
        ACTOR,
        today(),
    )
    .await
    .unwrap_or_else(|error| panic!("van: {error}"));
    let missing = cloud::suggest_account(
        &pool,
        SITE,
        &cloud::LineRefs {
            contract_id: Some(van.contract_id),
            ..Default::default()
        },
    )
    .await
    .unwrap_or_else(|error| panic!("missing suggest: {error}"));
    assert_eq!(missing.account_code, None, "an absent account is not invented");
    assert!(missing.missing.is_some(), "and it names what Finance must decide");
}

// ---------------------------------------------------------------------------
// 6. Σ POSTED lines, and no double counting
// ---------------------------------------------------------------------------

#[sqlx::test(migrations = "./migrations/postgres")]
async fn only_posted_lines_count_and_an_object_is_counted_once(pool: PgPool) {
    seed_payables(&pool).await;
    let supplier = a_supplier(&pool, "PT Hitung", Some("6045")).await;
    let contract = a_contract(&pool, Some(100_000_000), None).await;
    let asset = an_asset(&pool, "AIR_CONDITIONER").await;
    let repair = a_repair(&pool, Some(asset), "AC").await;

    // A draft counts for nothing.
    let mut draft_line = a_line("6045", 1_000_000);
    draft_line.contract_id = Some(contract.contract_id);
    let _ = a_draft(&pool, &supplier, "HIT-DRAFT", 1_000_000, vec![draft_line]).await;

    // One posted bill: one contract line and one repair line. The repair line
    // names the repair, NOT the asset, so asset and repair read it through the
    // repair link and contract does not read it at all.
    let mut contract_line = a_line("6045", 2_000_000);
    contract_line.contract_id = Some(contract.contract_id);
    let mut repair_line = a_line("6045", 3_000_000);
    repair_line.repair_id = Some(repair.repair_id);
    let bill = a_posted(
        &pool,
        &supplier,
        "HIT-1",
        5_000_000,
        vec![contract_line, repair_line],
    )
    .await;
    assert_eq!(bill.status, "POSTED");

    let hub = cloud::ga_contract_hub_on(&pool, contract.contract_id, today())
        .await
        .unwrap_or_else(|error| panic!("contract hub: {error}"));
    assert_eq!(hub.contract.billed_minor, 2_000_000, "only the contract line");
    assert_eq!(
        hub.contract.remaining_minor,
        Some(98_000_000),
        "value less what was billed"
    );

    let repair_row = cloud::ga_repair(&pool, repair.repair_id)
        .await
        .unwrap_or_else(|error| panic!("repair row: {error}"));
    assert_eq!(repair_row.actual_cost_minor, 3_000_000);

    let asset_hub = cloud::ga_asset_hub(&pool, asset)
        .await
        .unwrap_or_else(|error| panic!("asset hub: {error}"));
    assert_eq!(
        asset_hub.related_cost_minor, 3_000_000,
        "biaya terkait = the asset's own lines OR its repairs'"
    );

    // A held POSTED bill still counts: hold is not cancellation.
    cloud::hold_bill(&pool, bill.invoice_id, "menunggu konfirmasi", None, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("hold: {error}"));
    let held_hub = cloud::ga_contract_hub_on(&pool, contract.contract_id, today())
        .await
        .unwrap_or_else(|error| panic!("held hub: {error}"));
    assert_eq!(held_hub.contract.billed_minor, 2_000_000, "hold bukan batal");

    // The supply request's own billed figure.
    let request = a_supply_request(&pool).await;
    let mut supply_line = a_line("6041", 750_000);
    supply_line.supply_request_id = Some(request.request_id);
    let _ = a_posted(&pool, &supplier, "HIT-2", 750_000, vec![supply_line]).await;
    let rows = cloud::ga_supply_requests(
        &pool,
        cloud::GaSupplyScope {
            site_id: Some(SITE.into()),
            statuses: vec![],
            needle: None,
            limit: 100,
        },
    )
    .await
    .unwrap_or_else(|error| panic!("supplies: {error}"));
    let supply = rows.iter().find(|row| row.request_id == request.request_id).unwrap();
    assert_eq!(supply.billed_minor, 750_000);
}

// ---------------------------------------------------------------------------
// 7. The six warnings
// ---------------------------------------------------------------------------

/// A helper that asks for one bill's warnings.
async fn warnings(pool: &PgPool, invoice_id: Uuid) -> Vec<cloud::BillWarning> {
    cloud::bill_warnings(pool, invoice_id)
        .await
        .unwrap_or_else(|error| panic!("warnings: {error}"))
}

fn has_code(list: &[cloud::BillWarning], code: &str) -> bool {
    list.iter().any(|warning| warning.code == code)
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_duplicate_number_is_a_warning(pool: PgPool) {
    let supplier = a_supplier(&pool, "PT Ganda", Some("6045")).await;
    let first = a_draft(&pool, &supplier, "INV/1", 1_000, vec![a_line("6045", 1_000)]).await;
    // The writer refuses this, so the second is inserted the way an older row
    // might have arrived — and the WARNING is what sees it. It is a
    // MERCHANDISE bill, which carries no lines, so the expense trigger has
    // nothing to check.
    sqlx::query(
        "INSERT INTO supplier_invoice
           (invoice_id, invoice_number, supplier_id, site_id, invoice_date, currency,
            subtotal_minor, total_minor, recorded_by, kind)
         VALUES ($1, 'inv / 1', $2, 'dc', DATE '2026-09-10', 'IDR', 1000, 1000, 'ana', 'MERCHANDISE')",
    )
    .bind(Uuid::new_v4())
    .bind(&supplier)
    .execute(&pool)
    .await
    .unwrap_or_else(|error| panic!("duplicate: {error}"));

    let list = warnings(&pool, first.invoice_id).await;
    assert!(has_code(&list, "DUPLICATE_NUMBER"), "{list:?}");
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn billing_more_than_a_contract_is_left_is_a_warning(pool: PgPool) {
    let supplier = a_supplier(&pool, "PT Kontrak", Some("6045")).await;
    let contract = a_contract(&pool, Some(1_000_000), None).await;
    let mut line = a_line("6045", 2_000_000);
    line.contract_id = Some(contract.contract_id);
    let bill = a_draft(&pool, &supplier, "OVER-C", 2_000_000, vec![line]).await;
    let list = warnings(&pool, bill.invoice_id).await;
    assert!(has_code(&list, "OVER_CONTRACT"), "{list:?}");
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn billing_more_than_a_repair_budget_is_a_warning(pool: PgPool) {
    let supplier = a_supplier(&pool, "PT Anggaran", Some("6045")).await;
    let repair = a_repair(&pool, None, "AC").await;
    cloud::ga_repair_approve_budget(
        &pool,
        repair.repair_id,
        &cloud::ApproveGaRepairRequest {
            approved_budget_minor: 1_000_000,
        },
        CHECKER,
    )
    .await
    .unwrap_or_else(|error| panic!("budget: {error}"));

    let mut line = a_line("6045", 2_000_000);
    line.repair_id = Some(repair.repair_id);
    let bill = a_draft(&pool, &supplier, "OVER-B", 2_000_000, vec![line]).await;
    let list = warnings(&pool, bill.invoice_id).await;
    assert!(has_code(&list, "OVER_BUDGET"), "{list:?}");
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_recurring_bill_off_its_promise_is_a_warning(pool: PgPool) {
    let supplier = a_supplier(&pool, "PT Rutin", Some("6045")).await;
    let promise = cloud::record_bill_template(
        &pool,
        &cloud::RecordBillTemplateRequest {
            supplier_id: supplier.clone(),
            supplier_name: Some("PT Rutin".into()),
            site_id: SITE.into(),
            expense_account_code: "6045".into(),
            expense_category_code: None,
            expense_site_id: None,
            expected_subtotal_minor: 2_100_000,
            expected_tax_minor: 0,
            tolerance_bps: 500,
            due_day: 10,
            label: "Listrik Rutin".into(),
            note: None,
            contract_id: None,
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("template: {error}"));

    let bill = a_draft(&pool, &supplier, "RUTIN Listrik Rutin 2026-09", 3_000_000, vec![a_line("6045", 3_000_000)]).await;
    sqlx::query(
        "INSERT INTO bill_template_run (template_id, period, invoice_id, raised_by)
         VALUES ($1, DATE '2026-09-01', $2, 'ana')",
    )
    .bind(promise.template_id)
    .bind(bill.invoice_id)
    .execute(&pool)
    .await
    .unwrap_or_else(|error| panic!("run: {error}"));

    let list = warnings(&pool, bill.invoice_id).await;
    assert!(has_code(&list, "ROUTINE_VARIANCE"), "{list:?}");
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_period_outside_the_contract_is_a_warning(pool: PgPool) {
    let supplier = a_supplier(&pool, "PT Periode", Some("6045")).await;
    let contract = a_contract(&pool, None, Some(day(2026, 9, 30))).await;
    let mut line = a_line("6045", 1_000_000);
    line.contract_id = Some(contract.contract_id);
    line.service_period_start = Some(day(2026, 9, 1));
    line.service_period_end = Some(day(2026, 10, 31));
    let bill = a_draft(&pool, &supplier, "PERIOD-1", 1_000_000, vec![line]).await;
    let list = warnings(&pool, bill.invoice_id).await;
    assert!(has_code(&list, "PERIOD_OUTSIDE_CONTRACT"), "{list:?}");
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_vendor_that_is_not_the_contracts_party_is_a_warning(pool: PgPool) {
    let supplier = a_supplier(&pool, "PT Salah", Some("6045")).await;
    let contract = a_contract(&pool, None, None).await;
    let mut line = a_line("6045", 1_000_000);
    line.contract_id = Some(contract.contract_id);
    let bill = a_draft(&pool, &supplier, "VENDOR-1", 1_000_000, vec![line]).await;
    let list = warnings(&pool, bill.invoice_id).await;
    assert!(has_code(&list, "VENDOR_MISMATCH"), "{list:?}");
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_warning_does_not_stop_posting(pool: PgPool) {
    seed_payables(&pool).await;
    let supplier = a_supplier(&pool, "PT Tetap", Some("6045")).await;
    let contract = a_contract(&pool, Some(1_000_000), None).await;
    let mut line = a_line("6045", 2_000_000);
    line.contract_id = Some(contract.contract_id);
    let bill = a_draft(&pool, &supplier, "WARN-1", 2_000_000, vec![line]).await;
    assert!(!warnings(&pool, bill.invoice_id).await.is_empty());

    let posted = cloud::post_bill(&pool, bill.invoice_id, None, ACTOR)
        .await
        .expect("a warning is not a block");
    assert_eq!(posted.status, "POSTED");
}

// ---------------------------------------------------------------------------
// 8. Hold
// ---------------------------------------------------------------------------

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_hold_hides_a_bill_from_ready_to_pay_and_a_release_brings_it_back(pool: PgPool) {
    seed_payables(&pool).await;
    let supplier = a_supplier(&pool, "PT Tahan", Some("6045")).await;
    let bill = a_posted(&pool, &supplier, "HOLD-1", 2_000_000, vec![a_line("6045", 2_000_000)]).await;

    // No reason is refused before the database has to.
    assert!(
        cloud::hold_bill(&pool, bill.invoice_id, "  ", None, ACTOR)
            .await
            .is_err(),
        "a hold with no reason must be refused"
    );

    let ready = cloud::payment_context_resolve(&pool, "SUPPLIER", &supplier)
        .await
        .unwrap_or_else(|error| panic!("context: {error}"));
    assert_eq!(ready.obligations.len(), 1, "offered before the hold");

    cloud::hold_bill(&pool, bill.invoice_id, "salah vendor", Some(day(2026, 10, 1)), ACTOR)
        .await
        .unwrap_or_else(|error| panic!("hold: {error}"));

    let blocked = cloud::payment_context_resolve(&pool, "SUPPLIER", &supplier)
        .await
        .unwrap_or_else(|error| panic!("context: {error}"));
    assert!(blocked.obligations.is_empty(), "a held bill is not offered");

    // Counted separately, so a screen can say "n ditahan".
    let aging = cloud::payables_aging(&pool, today(), None)
        .await
        .unwrap_or_else(|error| panic!("aging: {error}"));
    assert_eq!(aging.on_hold_count, 1);
    assert_eq!(aging.on_hold_minor, 2_000_000);
    assert_eq!(aging.total.total_minor, 0, "held is out of the buckets");

    cloud::release_bill(&pool, bill.invoice_id)
        .await
        .unwrap_or_else(|error| panic!("release: {error}"));
    let released = cloud::bill(&pool, bill.invoice_id)
        .await
        .unwrap_or_else(|error| panic!("read: {error}"));
    assert!(!released.on_hold && released.hold_reason.is_none());
    let offered = cloud::payment_context_resolve(&pool, "SUPPLIER", &supplier)
        .await
        .unwrap_or_else(|error| panic!("context: {error}"));
    assert_eq!(offered.obligations.len(), 1, "released and offered again");
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn posting_a_held_bill_is_the_one_refusal(pool: PgPool) {
    seed_payables(&pool).await;
    let supplier = a_supplier(&pool, "PT Tahan Dua", Some("6045")).await;
    let bill = a_draft(&pool, &supplier, "HOLD-2", 1_000, vec![a_line("6045", 1_000)]).await;
    cloud::hold_bill(&pool, bill.invoice_id, "cek dulu", None, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("hold: {error}"));
    let refused = cloud::post_bill(&pool, bill.invoice_id, None, ACTOR)
        .await
        .expect_err("posting a held bill must be refused");
    assert!(refused.to_string().contains("on hold"), "{refused}");
}

// ---------------------------------------------------------------------------
// 9. A payment request becomes a draft
// ---------------------------------------------------------------------------

#[sqlx::test(migrations = "./migrations/postgres")]
async fn an_approved_ask_raises_one_draft_and_a_refusal_raises_nothing(pool: PgPool) {
    seed_payables(&pool).await;
    // A vendor with a verified account and a default expense account.
    let supplier = a_supplier(&pool, "PT Ruko", Some("6045")).await;
    a_bank(&pool, &supplier, "VERIFIED").await;

    let raise = |amount: i64| cloud::RaiseInstructionRequest {
        site_id: SITE.into(),
        payee: "Pak Budi".into(),
        purpose: "Sewa ruko".into(),
        category: "expense_misc".into(),
        amount_minor: amount,
        needed_by: Some(day(2026, 9, 20)),
        bill_id: None,
        note: String::new(),
        submit: true,
    };

    // REFUSED creates nothing.
    let refused_ask = cloud::raise_instruction(&pool, &raise(1_000_000), ACTOR)
        .await
        .unwrap_or_else(|error| panic!("raise: {error}"));
    cloud::decide_instruction(
        &pool,
        refused_ask.instruction_id,
        &cloud::DecideInstructionRequest {
            approve: false,
            reason: "kontraknya belum ditandatangani".into(),
            supplier_id: None,
            supplier_name: None,
        },
        "hari",
    )
    .await
    .unwrap_or_else(|error| panic!("refuse: {error}"));
    let bills_for_supplier: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM supplier_invoice WHERE supplier_id = $1",
    )
    .bind(&supplier)
    .fetch_one(&pool)
    .await
    .unwrap_or_else(|error| panic!("count: {error}"));
    assert_eq!(bills_for_supplier, 0, "a refusal creates no bill");

    // APPROVED creates exactly one DRAFT, pointing at the ask.
    let ask = cloud::raise_instruction(&pool, &raise(2_000_000), ACTOR)
        .await
        .unwrap_or_else(|error| panic!("raise: {error}"));
    let approved = cloud::decide_instruction(
        &pool,
        ask.instruction_id,
        &cloud::DecideInstructionRequest {
            approve: true,
            reason: String::new(),
            supplier_id: Some(supplier.clone()),
            supplier_name: Some("PT Ruko".into()),
        },
        "hari",
    )
    .await
    .unwrap_or_else(|error| panic!("approve: {error}"));
    assert_eq!(approved.status, "APPROVED");
    let bill_id = approved.bill_id.expect("the ask now names its draft");
    let draft = cloud::bill(&pool, bill_id)
        .await
        .unwrap_or_else(|error| panic!("draft: {error}"));
    assert_eq!(draft.status, "DRAFT");
    assert_eq!(draft.submitted_by_domain.as_deref(), Some("PAYMENT_REQUEST"));
    assert!(draft.journal_entry_id.is_none(), "a draft is not AP");
    assert_eq!(draft.total_minor, 2_000_000);
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn an_approved_ask_carries_the_repair_its_bill_named(pool: PgPool) {
    seed_payables(&pool).await;
    let supplier = a_supplier(&pool, "PT Servis Dua", Some("6045")).await;
    a_bank(&pool, &supplier, "VERIFIED").await;
    let repair = a_repair(&pool, None, "AC").await;

    // The ask's own bill points at the repair.
    let mut line = a_line("6045", 1_500_000);
    line.repair_id = Some(repair.repair_id);
    let source = a_draft(&pool, &supplier, "ASK-SRC", 1_500_000, vec![line]).await;

    let ask = cloud::raise_instruction(
        &pool,
        &cloud::RaiseInstructionRequest {
            site_id: SITE.into(),
            payee: "Pak Servis".into(),
            purpose: "Perbaikan AC".into(),
            category: "expense_repairs".into(),
            amount_minor: 1_500_000,
            needed_by: Some(day(2026, 9, 20)),
            bill_id: Some(source.invoice_id),
            note: String::new(),
            submit: true,
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("raise: {error}"));
    let approved = cloud::decide_instruction(
        &pool,
        ask.instruction_id,
        &cloud::DecideInstructionRequest {
            approve: true,
            reason: String::new(),
            supplier_id: Some(supplier.clone()),
            supplier_name: Some("PT Servis Dua".into()),
        },
        "hari",
    )
    .await
    .unwrap_or_else(|error| panic!("approve: {error}"));

    let draft = cloud::bill(&pool, approved.bill_id.unwrap())
        .await
        .unwrap_or_else(|error| panic!("draft: {error}"));
    let line = draft.lines.as_ref().and_then(|lines| lines.first()).unwrap();
    assert_eq!(line.repair_id, Some(repair.repair_id), "the repair travels");
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_vendor_with_no_bank_account_cannot_be_approved(pool: PgPool) {
    let supplier = a_supplier(&pool, "PT Tanpa Rekening", Some("6045")).await;
    let ask = cloud::raise_instruction(
        &pool,
        &cloud::RaiseInstructionRequest {
            site_id: SITE.into(),
            payee: "Pak Tanpa".into(),
            purpose: "Sesuatu".into(),
            category: "expense_misc".into(),
            amount_minor: 1_000_000,
            needed_by: None,
            bill_id: None,
            note: String::new(),
            submit: true,
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("raise: {error}"));
    let refused = cloud::decide_instruction(
        &pool,
        ask.instruction_id,
        &cloud::DecideInstructionRequest {
            approve: true,
            reason: String::new(),
            supplier_id: Some(supplier),
            supplier_name: None,
        },
        "hari",
    )
    .await
    .expect_err("nowhere to pay means no approval");
    assert!(refused.to_string().contains("bank account"), "{refused}");
}

// ---------------------------------------------------------------------------
// 10. The duplicate number, normalised
// ---------------------------------------------------------------------------

#[sqlx::test(migrations = "./migrations/postgres")]
async fn invoice_numbers_are_compared_without_spaces(pool: PgPool) {
    let supplier = a_supplier(&pool, "PT Nomor", Some("6045")).await;
    a_draft(&pool, &supplier, "INV/1", 1_000, vec![a_line("6045", 1_000)]).await;
    let refused = cloud::record_bill_draft(
        &pool,
        &a_bill_request(&supplier, "inv / 1", 1_000, vec![a_line("6045", 1_000)]),
        ACTOR,
    )
    .await
    .expect_err("whitespace and case do not make a different number");
    let message = refused.to_string();
    assert!(
        message.contains("INV/1"),
        "the refusal must name the existing number, said: {message}"
    );
}

// ---------------------------------------------------------------------------
// 11. Bank accounts and the ready-to-pay list
// ---------------------------------------------------------------------------

#[sqlx::test(migrations = "./migrations/postgres")]
async fn an_unverified_vendor_waits_but_a_pajak_daerah_vendor_does_not(pool: PgPool) {
    seed_payables(&pool).await;
    let unverified = a_supplier(&pool, "PT Belum Verifikasi", Some("6045")).await;
    a_bank(&pool, &unverified, "UNVERIFIED").await;
    let no_account = a_supplier(&pool, "Pajak Daerah", Some("6045")).await;

    a_posted(&pool, &unverified, "UNV-1", 1_000_000, vec![a_line("6045", 1_000_000)]).await;
    a_posted(&pool, &no_account, "PDRD-1", 500_000, vec![a_line("6045", 500_000)]).await;

    let waiting = cloud::payment_context_resolve(&pool, "SUPPLIER", &unverified)
        .await
        .unwrap_or_else(|error| panic!("context: {error}"));
    assert!(
        waiting.obligations.is_empty(),
        "every account UNVERIFIED means nothing may be paid yet"
    );

    let allowed = cloud::payment_context_resolve(&pool, "SUPPLIER", &no_account)
        .await
        .unwrap_or_else(|error| panic!("context: {error}"));
    assert_eq!(
        allowed.obligations.len(),
        1,
        "a vendor with NO bank account (pajak daerah) is still offered"
    );
}

// ---------------------------------------------------------------------------
// 12. The sweep is idempotent under concurrency
// ---------------------------------------------------------------------------

#[sqlx::test(migrations = "./migrations/postgres")]
async fn two_concurrent_sweeps_raise_one_draft(pool: PgPool) {
    let supplier = a_supplier(&pool, "PT Bersamaan", Some("6045")).await;
    cloud::record_bill_template(
        &pool,
        &cloud::RecordBillTemplateRequest {
            supplier_id: supplier.clone(),
            supplier_name: Some("PT Bersamaan".into()),
            site_id: SITE.into(),
            expense_account_code: "6045".into(),
            expense_category_code: None,
            expense_site_id: None,
            expected_subtotal_minor: 1_000_000,
            expected_tax_minor: 0,
            tolerance_bps: 500,
            due_day: 10,
            label: "Langganan Bersamaan".into(),
            note: None,
            contract_id: None,
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("template: {error}"));

    let one = pool.clone();
    let two = pool.clone();
    let (a, b) = tokio::join!(
        cloud::bill_template_sweep(&one, day(2026, 9, 10), "system:a"),
        cloud::bill_template_sweep(&two, day(2026, 9, 10), "system:b"),
    );
    let a = a.unwrap_or_else(|error| panic!("sweep a: {error}"));
    let b = b.unwrap_or_else(|error| panic!("sweep b: {error}"));
    assert_eq!(
        a.raised + b.raised,
        1,
        "two sweeps raise exactly one draft, got {} and {}",
        a.raised,
        b.raised
    );

    let runs: i64 = sqlx::query_scalar("SELECT count(*) FROM bill_template_run")
        .fetch_one(&pool)
        .await
        .unwrap_or_else(|error| panic!("runs: {error}"));
    assert_eq!(runs, 1, "one run row");
    let drafts: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM supplier_invoice WHERE status = 'DRAFT'",
    )
    .fetch_one(&pool)
    .await
    .unwrap_or_else(|error| panic!("drafts: {error}"));
    assert_eq!(drafts, 1, "one draft");
}

// ---------------------------------------------------------------------------
// 13. The sweep still clamps a short month
// ---------------------------------------------------------------------------

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_promise_of_the_31st_raises_in_a_short_month(pool: PgPool) {
    let supplier = a_supplier(&pool, "PT Pendek", Some("6045")).await;
    cloud::record_bill_template(
        &pool,
        &cloud::RecordBillTemplateRequest {
            supplier_id: supplier.clone(),
            supplier_name: Some("PT Pendek".into()),
            site_id: SITE.into(),
            expense_account_code: "6045".into(),
            expense_category_code: None,
            expense_site_id: None,
            expected_subtotal_minor: 2_000_000,
            expected_tax_minor: 0,
            tolerance_bps: 500,
            due_day: 31,
            label: "Langganan Pendek".into(),
            note: None,
            contract_id: None,
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("template: {error}"));

    let february = cloud::bill_template_sweep(&pool, day(2027, 2, 28), "system")
        .await
        .unwrap_or_else(|error| panic!("february: {error}"));
    assert_eq!(february.raised, 1, "the 31st in February is the 28th");
    let again = cloud::bill_template_sweep(&pool, day(2027, 2, 28), "system")
        .await
        .unwrap_or_else(|error| panic!("again: {error}"));
    assert_eq!(again.raised, 0, "once per period");

    // And the contract is on the LINE, so it can be summed from the rows.
    let contract_id: Option<Uuid> = sqlx::query_scalar(
        "SELECT l.contract_id FROM supplier_invoice_expense_line l
           JOIN supplier_invoice i USING (invoice_id)
          WHERE i.invoice_number LIKE 'RUTIN Langganan Pendek%'",
    )
    .fetch_one(&pool)
    .await
    .unwrap_or_else(|error| panic!("line contract: {error}"));
    assert_eq!(contract_id, None, "this promise has no contract");
}

// ---------------------------------------------------------------------------
// 14. A returned draft keeps its id and its mark
// ---------------------------------------------------------------------------

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_returned_draft_stays_the_same_document(pool: PgPool) {
    let supplier = a_supplier(&pool, "PT Kembali", Some("6045")).await;
    let request = cloud::RecordBillRequest {
        submitted_by_domain: Some("GA".into()),
        ..a_bill_request(&supplier, "GA-RET", 1_000, vec![a_line("6045", 1_000)])
    };
    let draft = cloud::record_bill_draft(&pool, &request, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("draft: {error}"));

    let returned = cloud::return_bill(&pool, draft.invoice_id, "nomornya salah", ACTOR)
        .await
        .unwrap_or_else(|error| panic!("return: {error}"));
    assert_eq!(returned.invoice_id, draft.invoice_id, "the id stays");
    assert_eq!(returned.submitted_by_domain.as_deref(), Some("GA"), "and the mark");
    assert_eq!(returned.returned_reason.as_deref(), Some("nomornya salah"));
    assert_eq!(returned.status, "DRAFT", "still fixable");
}
