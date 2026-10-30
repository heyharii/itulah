//! Finance Connect (25 Sep 2026): every domain reaches Finance on the client's
//! 267 leaves. One file for the checks the brief asks for, run against the
//! migrations alone — no fixture maps, because the maps ARE the deliverable.
//!
//! * stage 0 — every meaning a writer names resolves at every site, and each
//!   source kind posts through the client chart;
//! * stage 2 — a sales day with cash, debit, credit, QRIS on a bank's EDC, a
//!   QRIS with no bank, an online tender, a free voucher and a discount posts
//!   as one balanced entry and parks the two bad lines; the MDR check;
//! * affiliate rules (client accountant) — each site balances in its own books
//!   through the affiliate accounts, unit to unit goes through head office,
//!   and the pair nets to zero company-wide.

use chrono::{DateTime, NaiveDate, TimeZone, Utc};
use inventory_backend::cloud::postgres::{
    self as cloud, CreateAcquirerSettlementRequest, CurateSettlementRequest,
    GenerateSalesPostingRequest, PostingIntent, PostingLine, ResolveSalesExceptionRequest,
};
use sqlx::{PgPool, Row};
use uuid::Uuid;

const ACTOR: &str = "ana";
const SITE: &str = "store-01";

fn day() -> NaiveDate {
    NaiveDate::from_ymd_opt(2026, 9, 15).unwrap_or_else(|| panic!("bad date"))
}

fn midday() -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 9, 15, 5, 0, 0)
        .single()
        .unwrap_or_else(|| panic!("bad instant"))
}

async fn open_september(pool: &PgPool) {
    cloud::open_period(pool, 2026, 9)
        .await
        .unwrap_or_else(|error| panic!("open period: {error}"));
}

async fn bank_account(pool: &PgPool, ledger: &str, site: &str, bank: &str, number: &str) {
    cloud::describe_account(
        pool,
        &cloud::DescribeBankAccountRequest {
            ledger_account_code: ledger.into(),
            unit_id: site.into(),
            bank_code: Some(bank.into()),
            bank_name: String::new(),
            account_no: number.into(),
            account_holder: "PT Contoh".into(),
            branch: None,
            kind: "GIRO".into(),
            is_primary: Some(true),
            note: None,
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("bank account {ledger}: {error}"));
}

async fn post(pool: &PgPool, intent: &PostingIntent) -> Result<Uuid, String> {
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    let posted = cloud::post(&mut tx, intent, None, ACTOR)
        .await
        .map_err(|e| e.to_string())?;
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(posted.entry_id)
}

fn intent(kind: &str, lines: Vec<PostingLine>) -> PostingIntent {
    PostingIntent {
        posting_date: day(),
        source_kind: kind.into(),
        source_id: Some(Uuid::new_v4().to_string()),
        rule_version: "finance_connect_test/1".into(),
        currency: "IDR".into(),
        memo: Some(format!("{kind} through the client chart")),
        lines,
    }
}

async fn balance(pool: &PgPool, code: &str, unit: Option<&str>) -> i64 {
    sqlx::query_scalar(
        "SELECT COALESCE(SUM(debit_minor - credit_minor), 0)::bigint FROM journal_line
          WHERE account_code = $1 AND ($2::text IS NULL OR unit_id = $2)",
    )
    .bind(code)
    .bind(unit)
    .fetch_one(pool)
    .await
    .unwrap_or_else(|error| panic!("balance {code}: {error}"))
}

/// Every journal balances in total and in every unit's own books; and every
/// line whose unit differs from the rest of its entry is carried by the
/// affiliate accounts. The client accountant's rule, checked over the ledger.
async fn every_unit_balances_in_its_own_books(pool: &PgPool) {
    let out: Vec<(Uuid, String, i64)> = sqlx::query_as(
        "SELECT entry_id, unit_id, SUM(debit_minor - credit_minor)::bigint
           FROM journal_line GROUP BY entry_id, unit_id
         HAVING SUM(debit_minor - credit_minor) <> 0",
    )
    .fetch_all(pool)
    .await
    .unwrap_or_else(|error| panic!("per site: {error}"));
    assert!(out.is_empty(), "entries out of balance at a site: {out:?}");
    let affiliate: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(debit_minor - credit_minor), 0)::bigint FROM journal_line
          WHERE account_code IN ('1057', '1058', '1059', '2028', '2029', '2030')",
    )
    .fetch_one(pool)
    .await
    .unwrap_or_else(|error| panic!("affiliate: {error}"));
    assert_eq!(
        affiliate, 0,
        "the affiliate pair must net to zero company-wide"
    );
}

// ---------------------------------------------------------------------------
// Stage 0
// ---------------------------------------------------------------------------

#[sqlx::test(migrations = "./migrations/postgres")]
async fn every_meaning_a_writer_names_resolves_at_every_site(pool: PgPool) {
    // (meaning, qualifier) as the writers spell them.
    let named = [
        ("cash", ""),
        ("petty_cash", ""),
        ("cashier_float", ""),
        ("cash_variance", ""),
        ("cash_shortage", ""),
        ("store_manager_receivable", ""),
        ("employee_receivable", ""),
        ("payroll_expense", "SALARY"),
        // Only SALARY and THR are seeded: 0466 deleted the pay classes the word
        // search had produced, because a component now brings its own link
        // (`define_component` in this file, and the Pay Component screen).
        ("payroll_expense", "THR"),
        ("payroll_payable", ""),
        ("thr_payable", ""),
        ("employee_claim_payable", ""),
        ("employee_claim_payable", "MEDICAL"),
        ("advance", ""),
        ("advance", "PERJALANAN"),
        ("advance_purchase", ""),
        ("trade_payable", ""),
        ("non_merchandise_payable", ""),
        ("purchase_discount", ""),
        ("purchase_price_variance", ""),
        ("inventory", ""),
        ("cogs", ""),
        ("stock_loss", ""),
        ("inventory_damage", ""),
        ("customer_supplies", ""),
        ("bag_inventory", ""),
        ("goods_in_transit", ""),
        ("revenue_cash", ""),
        ("sales_discount", ""),
        ("sales_return", ""),
        ("rounding", ""),
        ("rounding_loss", ""),
        ("other_income_expense", ""),
        ("other_expense", ""),
        ("card_receivable_debit", "BCA"),
        ("card_receivable_debit", "BNI"),
        ("revenue_debit", "BNI"),
        ("card_receivable_credit", "VISA"),
        ("revenue_credit", "VISA"),
        ("card_fee", ""),
        ("card_fee", "BCA"),
        ("bank_admin_fee", ""),
        ("marketing_expense", ""),
        ("giro_outstanding", "BCA"),
        ("time_deposit", "BCA"),
        ("bank_giro", "BCA"),
        ("bank_savings", "BCA"),
        ("loan_principal", ""),
        ("loan_principal", "BCA"),
        ("interest_expense", ""),
        ("interest_income", ""),
        ("tax_on_interest", ""),
        ("capital_contributed", ""),
        ("owner_drawings", ""),
        ("pph21_payable", ""),
        ("pph23_payable", ""),
        ("pph_final_payable", ""),
        ("pph25_credit", ""),
        ("pph29_payable", ""),
        ("pbb_payable", ""),
        ("bad_debt_expense", ""),
        ("asset_disposal_result", ""),
        ("asset_disposal_loss", ""),
        ("work_in_progress", ""),
        ("intangible_asset", "PRE_OPENING"),
        ("amortisation_expense", "PRE_OPENING"),
        ("accumulated_amortisation", "PRE_OPENING"),
        ("prepaid_expense", ""),
        ("electricity_expense", ""),
        ("water_expense", ""),
        ("telephone_expense", ""),
        ("expense", "expense_household"),
        ("expense", "expense_stationery"),
        // `repair_expense` has no bare link: it is linked per ASSET CLASS
        // (`COMPANY`/AC, FFE, KENDARAAN, …), so a repair always says what it is
        // a repair OF.
        ("expense", "expense_transport"),
        ("cleaning_expense", ""),
        ("miscellaneous_expense", ""),
        ("affiliate_receivable", "LAIN"),
        ("affiliate_payable", "LAIN"),
    ];
    let mut missing = Vec::new();
    for (key, qualifier) in named {
        let unresolved: Vec<String> = sqlx::query_scalar(
            "SELECT u.id FROM unit u
              WHERE NOT EXISTS (
                  SELECT 1 FROM account_resolution m
                    JOIN ledger_account a ON a.account_code = m.account_code
                   WHERE m.role = $1 AND m.unit_id = u.id
                     AND m.source_id = $2
                     AND a.is_active AND NOT a.is_group AND m.category_code IS NULL)",
        )
        .bind(key)
        .bind(qualifier)
        .fetch_all(&pool)
        .await
        .unwrap_or_else(|error| panic!("{key}: {error}"));
        if !unresolved.is_empty() {
            missing.push(format!("{key}({qualifier}) at {}", unresolved.join(",")));
        }
    }
    assert!(
        missing.is_empty(),
        "meanings a writer names with no leaf: {missing:#?}"
    );

    // And no map row points anywhere but an active 267 leaf.
    let retired: i64 = sqlx::query_scalar(
        "SELECT COUNT(*)::bigint FROM account_link m JOIN ledger_account a USING (account_code)
          WHERE NOT a.is_active OR a.is_group",
    )
    .fetch_one(&pool)
    .await
    .unwrap_or_else(|error| panic!("retired: {error}"));
    assert_eq!(
        retired, 0,
        "a map row points at a retired or heading account"
    );
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn each_source_kind_posts_through_the_client_chart(pool: PgPool) {
    open_september(&pool).await;
    bank_account(&pool, "1005", "ho", "BCA", "8880012345").await;
    let d =
        |key: &str, site: &str, q: &str| PostingLine::debit(key, site, 100_000).with_qualifier(q);
    let c =
        |key: &str, site: &str, q: &str| PostingLine::credit(key, site, 100_000).with_qualifier(q);
    let cases: Vec<(&str, Vec<PostingLine>)> = vec![
        (
            "PAYROLL_RUN",
            vec![
                d("payroll_expense", SITE, "SALARY"),
                c("payroll_payable", SITE, ""),
            ],
        ),
        // An expense CATEGORY is a source of its own since the chart's links
        // moved under `EXPENSE_CATEGORY`; naming it as a plain qualifier looks
        // for a company-default link that does not exist.
        (
            "EXPENSE_CLAIM",
            vec![
                d("expense", SITE, "").from_source("EXPENSE_CATEGORY", "expense_transport"),
                c("employee_claim_payable", SITE, ""),
            ],
        ),
        (
            "EXPENSE_CLAIM_PAYOUT",
            vec![
                d("employee_claim_payable", SITE, "").from_source("EXPENSE_CATEGORY", "MEDICAL"),
                c("petty_cash", SITE, ""),
            ],
        ),
        (
            "ADVANCE",
            vec![d("advance", SITE, "PERJALANAN"), c("petty_cash", SITE, "")],
        ),
        (
            "CASH_SHIFT",
            vec![d("cash_shortage", SITE, ""), c("cash", SITE, "")],
        ),
        (
            "CASH_COUNT",
            vec![d("cash", SITE, ""), c("cash_variance", SITE, "")],
        ),
        // The two halves of a remittance as one entry: shop Dr 1057, head
        // office Cr 2028. The poster's balancer closes each site through the
        // pair, which is why the company-wide affiliate nets to zero.
        (
            "STORE_DEPOSIT",
            vec![
                PostingLine::debit("affiliate_receivable", SITE, 100_000)
                    .with_qualifier("PEMBIAYAAN")
                    .with_counter_unit("ho"),
                PostingLine::credit("affiliate_payable", "ho", 100_000)
                    .with_qualifier("PEMBIAYAAN")
                    .with_counter_unit(SITE),
            ],
        ),
        (
            "STORE_EXPENSE",
            vec![
                d("electricity_expense", SITE, ""),
                c("petty_cash", SITE, ""),
            ],
        ),
        (
            "GIRO",
            vec![
                d("trade_payable", "ho", ""),
                c("giro_outstanding", "ho", "BCA"),
            ],
        ),
        (
            "PAYMENT",
            vec![
                d("giro_outstanding", "ho", "BCA"),
                c("bank_giro", "ho", "BCA"),
            ],
        ),
        (
            "TAX_SETTLEMENT",
            vec![d("pph21_payable", "ho", ""), c("bank_giro", "ho", "BCA")],
        ),
        (
            "SUPPLIER_ADVANCE",
            vec![d("advance_purchase", "ho", ""), c("bank_giro", "ho", "BCA")],
        ),
        (
            "EQUITY_MOVEMENT",
            vec![
                d("bank_giro", "ho", "BCA"),
                c("capital_contributed", "ho", ""),
            ],
        ),
        // 3004 Prive is reached by EQUITY_MOVEMENT and HO journals only (0380).
        (
            "TRANSFER",
            vec![d("inventory", "ho", ""), c("inventory", "ho", "")],
        ),
        (
            "ASSET_DISPOSAL",
            vec![
                d("asset_disposal_loss", "ho", ""),
                c("work_in_progress", "ho", ""),
            ],
        ),
        (
            "AMORTIZATION_RUN",
            vec![
                d("amortisation_expense", SITE, "PRE_OPENING"),
                c("accumulated_amortisation", SITE, "PRE_OPENING"),
            ],
        ),
        (
            "PREPAID_ALLOCATION",
            vec![
                d("miscellaneous_expense", SITE, ""),
                c("prepaid_expense", SITE, ""),
            ],
        ),
        (
            "INVENTORY_WRITE_OFF",
            vec![d("inventory_damage", SITE, ""), c("inventory", SITE, "")],
        ),
        (
            "STOCK_COUNT",
            vec![d("stock_loss", SITE, ""), c("inventory", SITE, "")],
        ),
        (
            "GOODS_RECEIPT",
            vec![d("inventory", "ho", ""), c("trade_payable", "ho", "")],
        ),
        (
            "SUPPLIER_INVOICE",
            vec![
                d("repair_expense", "ho", "FFE"),
                c("non_merchandise_payable", "ho", ""),
            ],
        ),
        (
            "FULL_AND_FINAL",
            vec![
                d("employee_claim_payable", SITE, ""),
                c("petty_cash", SITE, ""),
            ],
        ),
        (
            "PETTY_REPLENISH",
            vec![d("petty_cash", "ho", ""), c("bank_giro", "ho", "BCA")],
        ),
    ];
    let mut refused = Vec::new();
    for (kind, lines) in cases {
        if let Err(error) = post(&pool, &intent(kind, lines)).await {
            refused.push(format!("{kind}: {error}"));
        }
    }
    assert!(
        refused.is_empty(),
        "source kinds refused on the client chart: {refused:#?}"
    );
    every_unit_balances_in_its_own_books(&pool).await;
}

// ---------------------------------------------------------------------------
// Stage 2
// ---------------------------------------------------------------------------

#[allow(clippy::too_many_arguments)]
async fn synced_sale(
    pool: &PgPool,
    total_minor: i64,
    change_minor: i64,
    discount_minor: i64,
    method: &str,
    acquirer: Option<&str>,
    card_kind: Option<&str>,
    terminal: Option<&str>,
) {
    let sale_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO edge_sale
           (sale_id, origin_id, generation, seq, movement_group_id, site_id, actor_id,
            occurred_at, currency, total_minor, paid_minor, change_minor,
            discount_total_minor)
         VALUES ($1,'store-edge-01',1,
                 (SELECT COALESCE(max(seq), 0) + 1 FROM edge_sale WHERE origin_id = 'store-edge-01'),
                 $2,$3,'kasir',
                 $4,'IDR',$5,$6,$7,$8)",
    )
    .bind(sale_id)
    .bind(Uuid::new_v4())
    .bind(SITE)
    .bind(midday())
    .bind(total_minor)
    .bind(total_minor + change_minor)
    .bind(change_minor)
    .bind(discount_minor)
    .execute(pool)
    .await
    .unwrap_or_else(|error| panic!("sale: {error}"));
    sqlx::query(
        "INSERT INTO edge_sale_tender
           (sale_id, tender_seq, method, amount_minor, acquirer, card_kind, terminal_id)
         VALUES ($1,0,$2,$3,$4,$5,$6)",
    )
    .bind(sale_id)
    .bind(method)
    .bind(total_minor + change_minor)
    .bind(acquirer)
    .bind(card_kind)
    .bind(terminal)
    .execute(pool)
    .await
    .unwrap_or_else(|error| panic!("tender: {error}"));
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_mixed_day_posts_once_and_parks_what_it_cannot_place(pool: PgPool) {
    open_september(&pool).await;
    bank_account(&pool, "1005", "ho", "BCA", "8880012345").await;
    bank_account(&pool, "1008", "ho", "BNI", "8880012346").await;
    sqlx::query(
        "INSERT INTO edc_terminal
             (site_id, terminal_id, bank_code, takes_debit, takes_credit, takes_qris, created_by)
         VALUES ($1, 'T-BNI-01', 'BNI', true, true, true, 'test')",
    )
    .bind(SITE)
    .execute(&pool)
    .await
    .unwrap_or_else(|error| panic!("terminal: {error}"));
    // The settlement half below still needs one acquirer that pays later;
    // BCA's debit cards are that bank here. QRIS on BNI's machine is direct
    // (0722/1004), which is the rule this test also proves.
    sqlx::query(
        "UPDATE payment_method SET settlement_mode = 'VIA_RECEIVABLE' WHERE code = 'DEBIT_BCA'",
    )
    .execute(&pool)
    .await
    .unwrap_or_else(|error| panic!("debit BCA receivable: {error}"));

    synced_sale(&pool, 1_110_000, 90_000, 111_000, "CASH", None, None, None).await;
    synced_sale(
        &pool,
        2_220_000,
        0,
        0,
        "CARD",
        Some("BCA"),
        Some("DEBIT"),
        None,
    )
    .await;
    synced_sale(
        &pool,
        3_330_000,
        0,
        0,
        "CARD",
        Some("VISA"),
        Some("CREDIT"),
        None,
    )
    .await;
    // QRIS on BNI's EDC: the POS sent only the terminal.
    synced_sale(&pool, 555_000, 0, 0, "QRIS", None, None, Some("T-BNI-01")).await;
    // QRIS naming a wallet, on no known terminal: parked.
    synced_sale(&pool, 444_000, 0, 0, "QRIS", Some("GOPAY"), None, None).await;
    // Online marketplace: the company does not sell online — parked.
    synced_sale(&pool, 333_000, 0, 0, "OTHER", Some("TOKOPEDIA"), None, None).await;
    // A free voucher spent at the till: a discount.
    synced_sale(&pool, 200_000, 0, 0, "VOUCHER", None, None, None).await;

    let draft = cloud::sales_posting_generate(
        &pool,
        &GenerateSalesPostingRequest {
            site_id: SITE.into(),
            business_date: day(),
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("generate: {error}"));
    assert_eq!(
        draft.exceptions.len(),
        2,
        "two lines wait: {:?}",
        draft.exceptions
    );
    assert!(draft
        .lines
        .iter()
        .any(|line| line.method == "QRIS" && line.acquirer == "BNI"));

    let posted = cloud::sales_posting_post(&pool, draft.posting.posting_id, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("post: {error}"));
    assert_eq!(posted.posting.status, "POSTED");

    // BCA's debit card is the one that still settles later; QRIS on BNI's
    // machine and the VISA credit taken there land in BNI's bank account.
    assert_eq!(balance(&pool, "1021", Some(SITE)).await, 2_220_000);
    assert_eq!(balance(&pool, "1020", Some(SITE)).await, 0);
    assert_eq!(
        balance(&pool, "1008", Some("ho")).await,
        3_330_000 + 555_000,
        "VISA credit + QRIS on BNI's EDC into BNI"
    );
    assert!(
        balance(&pool, "4006", Some(SITE)).await < 0,
        "BNI debit-card sales carry the QRIS"
    );
    assert!(
        balance(&pool, "4007", Some(SITE)).await < 0,
        "the VISA credit is still credited to 4007"
    );
    // The free voucher is a discount; the promotion is not — it is inside the
    // price charged (owner decision 25 Sep 2026), so 4012 holds the voucher only.
    assert_eq!(balance(&pool, "4012", Some(SITE)).await, 200_000);
    assert_eq!(
        balance(&pool, "2033", None).await,
        0,
        "no voucher liability"
    );
    assert_eq!(
        balance(&pool, "4009", None).await + balance(&pool, "4010", None).await,
        0
    );

    // The QRIS whose bank Finance now names posts on its own.
    let qris = posted
        .exceptions
        .iter()
        .find(|x| x.method == "QRIS")
        .unwrap_or_else(|| panic!("no QRIS exception"));
    let resolved = cloud::sales_posting_exception_resolve(
        &pool,
        qris.exception_id,
        &ResolveSalesExceptionRequest {
            bank_code: "BCA".into(),
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("resolve: {error}"));
    assert!(resolved.exceptions.iter().any(|x| x.status == "RESOLVED"));
    assert_eq!(
        balance(&pool, "1021", Some(SITE)).await,
        2_220_000,
        "the resolved QRIS does not open a debit-card receivable"
    );
    assert_eq!(
        balance(&pool, "1005", Some("ho")).await,
        444_000,
        "the resolved QRIS on BCA's EDC goes into BCA"
    );
    // The online line cannot be resolved by naming a bank.
    let online = posted
        .exceptions
        .iter()
        .find(|x| x.method == "OTHER")
        .unwrap_or_else(|| panic!("no online exception"));
    assert!(cloud::sales_posting_exception_resolve(
        &pool,
        online.exception_id,
        &ResolveSalesExceptionRequest {
            bank_code: "BCA".into()
        },
        ACTOR,
    )
    .await
    .is_err());

    // The MDR check: Finance's rate for BCA debit is 0.15%.
    sqlx::query(
        "INSERT INTO acquirer_fee_rate (bank_code, fee_kind, rate_percent, effective_from, set_by)
         VALUES ('BCA', 'DEBIT_ON_US', 0.15, '2026-01-01', 'test')",
    )
    .execute(&pool)
    .await
    .unwrap_or_else(|error| panic!("rate: {error}"));
    let settle = |mdr: i64| CreateAcquirerSettlementRequest {
        acquirer: "BCA".into(),
        settlement_date: NaiveDate::from_ymd_opt(2026, 9, 16).unwrap_or_default(),
        business_from: day(),
        business_to: day(),
        gross_minor: 2_220_000,
        mdr_minor: mdr,
        lines: vec![cloud::AcquirerSettlementLineInput {
            sale_id: None,
            tender_seq: None,
            site_id: SITE.into(),
            tender_kind: "CARD_DEBIT".into(),
            auth_code: None,
            amount_minor: 2_220_000,
            mdr_minor: mdr,
        }],
    };
    let curate = CurateSettlementRequest {
        bank_key: "bank_giro".into(),
        bank_qualifier: "BCA".into(),
        posting_date: None,
    };
    // 20,000 against an expected 3,330: beyond tolerance, refused and flagged.
    let wide = cloud::acq_settlement_create(&pool, &settle(20_000), ACTOR)
        .await
        .unwrap_or_else(|error| panic!("create: {error}"));
    let refused = cloud::acq_settlement_curate(&pool, wide.settlement_id, &curate, ACTOR).await;
    assert!(refused.is_err(), "a wide MDR must not post quietly");
    let flagged = cloud::acq_settlement_accept_mdr_variance(&pool, wide.settlement_id, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("accept: {error}"));
    assert_eq!(flagged.mdr_check, "ACCEPTED");
    let curated = cloud::acq_settlement_curate(&pool, wide.settlement_id, &curate, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("curate after accepting: {error}"));
    assert_eq!(curated.mdr_expected_minor, Some(3_330));
    // The MDR stays in the unit's books; head office only receives the money.
    assert_eq!(balance(&pool, "6005", Some(SITE)).await, 20_000);
    assert_eq!(balance(&pool, "6005", Some("ho")).await, 0);
    every_unit_balances_in_its_own_books(&pool).await;
}

// ---------------------------------------------------------------------------
// Affiliate rules (client accountant, 25 Sep)
// ---------------------------------------------------------------------------

async fn legs_of(pool: &PgPool, entry: Uuid) -> Vec<(String, String, String, i64)> {
    sqlx::query(
        "SELECT unit_id, account_code, COALESCE(counter_unit_id, '') AS counter,
                (debit_minor - credit_minor)::bigint AS net
           FROM journal_line WHERE entry_id = $1 AND counter_unit_id IS NOT NULL
          ORDER BY unit_id, account_code",
    )
    .bind(entry)
    .fetch_all(pool)
    .await
    .unwrap_or_else(|error| panic!("legs: {error}"))
    .iter()
    .map(|row| {
        (
            row.get::<String, _>("unit_id"),
            row.get::<String, _>("account_code"),
            row.get::<String, _>("counter"),
            row.get::<i64, _>("net"),
        )
    })
    .collect()
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn every_crossing_goes_through_the_affiliate_accounts(pool: PgPool) {
    open_september(&pool).await;
    bank_account(&pool, "1005", "ho", "BCA", "8880012345").await;

    // A unit pays head office's supplier out of its sales cash: HO Dr 2002 /
    // Cr 1057 (counter unit); unit Dr 2028 (counter HO) / Cr 1002. The unit
    // side is always hutang, head office's always piutang (owner, 25 Sep).
    let paid = post(
        &pool,
        &intent(
            "PAYMENT",
            vec![
                PostingLine::debit("trade_payable", "ho", 750_000),
                PostingLine::credit("cash", SITE, 750_000),
            ],
        ),
    )
    .await
    .unwrap_or_else(|error| panic!("payment: {error}"));
    assert_eq!(
        legs_of(&pool, paid).await,
        vec![
            ("ho".into(), "1057".into(), SITE.into(), -750_000),
            (SITE.into(), "2028".into(), "ho".into(), 750_000),
        ]
    );

    // A unit's local bill paid from its own cash: one site, no affiliate.
    let local = post(
        &pool,
        &intent(
            "PAYMENT",
            vec![
                PostingLine::debit("cleaning_expense", SITE, 50_000),
                PostingLine::credit("petty_cash", SITE, 50_000),
            ],
        ),
    )
    .await
    .unwrap_or_else(|error| panic!("local: {error}"));
    assert!(legs_of(&pool, local).await.is_empty());

    // Goods from one unit to another: legs only against head office, on the
    // goods family (Atas Barang), never unit to unit.
    let moved = post(
        &pool,
        &intent(
            "TRANSFER",
            vec![
                PostingLine::debit("inventory", "store-02", 300_000),
                PostingLine::credit("inventory", SITE, 300_000),
            ],
        ),
    )
    .await
    .unwrap_or_else(|error| panic!("transfer: {error}"));
    let legs = legs_of(&pool, moved).await;
    assert_eq!(legs.len(), 4);
    assert!(legs
        .iter()
        .all(|(site, _, counter, _)| site == "ho" || counter == "ho"));
    assert!(legs
        .iter()
        .all(|(_, code, _, _)| code == "1058" || code == "2029"));

    // A fixed asset moved: Lain-lain, 1059 at head office and 2030 at the unit
    // (owner decision 25 Sep, 0380).
    let asset = post(
        &pool,
        &intent(
            "ASSET_TRANSFER",
            vec![
                PostingLine::debit("work_in_progress", SITE, 90_000),
                PostingLine::credit("work_in_progress", "ho", 90_000),
            ],
        ),
    )
    .await
    .unwrap_or_else(|error| panic!("asset transfer: {error}"));
    let asset_legs = legs_of(&pool, asset).await;
    assert_eq!(asset_legs.len(), 2, "{asset_legs:?}");
    assert!(
        asset_legs.iter().all(|(site, code, _, _)| {
            if site == "ho" {
                code == "1059"
            } else {
                code == "2030"
            }
        }),
        "Lain-lain is 1059 at HO and 2030 at the unit: {asset_legs:?}"
    );

    every_unit_balances_in_its_own_books(&pool).await;
}

// ---------------------------------------------------------------------------
// Stage 3 — payroll (client accountant, 25 Sep)
// ---------------------------------------------------------------------------

async fn employee(pool: &PgPool, id: &str) {
    sqlx::query("INSERT INTO employee (id, code, status) VALUES ($1, $1, 'ACTIVE')")
        .bind(id)
        .execute(pool)
        .await
        .unwrap_or_else(|error| panic!("employee {id}: {error}"));
}

async fn slip(pool: &PgPool, run: &str, employee_id: &str, base: i64, gross: i64, deductions: i64) {
    sqlx::query(
        "INSERT INTO payroll_slip (run_id, employee_id, base_minor, fixed_allowances,
                                   statutory_base_minor, leave_days_taken, overtime_minutes,
                                   rostered_days, gross_minor, deduction_total_minor, net_minor)
         VALUES ($1, $2, $3, '[]'::jsonb, $3, 0, 0, 22, $4, $5, $4 - $5)",
    )
    .bind(run)
    .bind(employee_id)
    .bind(base)
    .bind(gross)
    .bind(deductions)
    .execute(pool)
    .await
    .unwrap_or_else(|error| panic!("slip: {error}"));
}

async fn slip_line(
    pool: &PgPool,
    run: &str,
    employee_id: &str,
    n: i32,
    kind: &str,
    code: &str,
    amount: i64,
) {
    sqlx::query(
        "INSERT INTO pay_component (code, label, kind, basis, defined)
         VALUES ($1, $1, $2, 'FIXED_AMOUNT', '{}'::jsonb) ON CONFLICT DO NOTHING",
    )
    .bind(code)
    .bind(kind)
    .execute(pool)
    .await
    .unwrap_or_else(|error| panic!("component: {error}"));
    sqlx::query(
        "INSERT INTO payroll_slip_line (run_id, employee_id, line_no, kind, component_code,
                                        label, basis, amount_minor)
         VALUES ($1, $2, $3, $4, $5, $5, 'FIXED_AMOUNT', $6)",
    )
    .bind(run)
    .bind(employee_id)
    .bind(n)
    .bind(kind)
    .bind(code)
    .bind(amount)
    .execute(pool)
    .await
    .unwrap_or_else(|error| panic!("slip line: {error}"));
}

/// How Finance sets a component up on its screen (0466): the flags, then one
/// link per role and kind of unit. `links` is (role, `STORE`/`HO`, account).
///
/// `UNIT_KIND`, not the `SITE_KIND` this used to say: 0606 moved an account
/// link's scope from the premises to the books, and the server refuses a scope
/// name it does not know rather than ignoring it — which is how this test came
/// to fail every component it defines.
async fn define_component(
    pool: &PgPool,
    code: &str,
    kind: &str,
    employer_borne: bool,
    links: &[(&str, &str, &str)],
) {
    sqlx::query(
        "INSERT INTO pay_component (code, label, kind, basis, defined)
         VALUES ($1, $1, $2, 'FIXED_AMOUNT', '{}'::jsonb) ON CONFLICT DO NOTHING",
    )
    .bind(code)
    .bind(kind)
    .execute(pool)
    .await
    .unwrap_or_else(|error| panic!("component: {error}"));
    cloud::set_pay_component_posting(
        pool,
        code,
        &cloud::SetPayComponentPostingRequest {
            employer_borne,
            paid_from_accrual: false,
        },
    )
    .await
    .unwrap_or_else(|error| panic!("{code} flags: {error}"));
    for (role, unit_kind, account) in links {
        cloud::set_account_link(
            pool,
            &cloud::SetAccountLinkRequest {
                role: (*role).into(),
                source_type: "PAY_COMPONENT".into(),
                source_id: code.into(),
                scope_type: "UNIT_KIND".into(),
                scope_key: (*unit_kind).into(),
                account_code: (*account).into(),
                category_code: None,
                note: None,
            },
            ACTOR,
        )
        .await
        .unwrap_or_else(|error| panic!("{code} {role} {unit_kind}: {error}"));
    }
}

/// Three people, two at a store and one at head office. Month end charges
/// each component to the store or head-office leaf against 2017; paying
/// (store from petty cash, head office from the bank) leaves 2017 at zero.
/// An employer BPJS component is the company's insurance cost (6017 at a
/// shop, 6031 at head office) — not salary, and not a medical cost, although
/// `BPJS_KESEHATAN` contains the word for health.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn an_employer_bpjs_component_lands_on_the_insurance_expense(pool: PgPool) {
    cloud::open_period(&pool, 2026, 9)
        .await
        .unwrap_or_else(|error| panic!("open: {error}"));
    // The accrual posts on today's date, so today's month must be open too.
    let today = Utc::now().date_naive();
    let _ = cloud::open_period(
        &pool,
        chrono::Datelike::year(&today),
        chrono::Datelike::month(&today) as i32,
    )
    .await;
    employee(&pool, "emp-a").await;
    sqlx::query(
        "INSERT INTO payroll_run (id, unit_id, period, state, complete, history)
         VALUES ('run-bpjs', $1, '2026-09-01', 'APPROVED', true, '[]'::jsonb)",
    )
    .bind(SITE)
    .execute(&pool)
    .await
    .unwrap_or_else(|error| panic!("run: {error}"));
    for code in ["BPJS_KESEHATAN_PERUSAHAAN", "BPJS_TK_PERUSAHAAN"] {
        define_component(
            &pool,
            code,
            "EARNING",
            false,
            &[
                ("payroll_expense", "STORE", "6017"),
                ("payroll_expense", "HO", "6031"),
            ],
        )
        .await;
    }
    slip(&pool, "run-bpjs", "emp-a", 4_000_000, 4_280_000, 0).await;
    slip_line(
        &pool,
        "run-bpjs",
        "emp-a",
        1,
        "EARNING",
        "BPJS_KESEHATAN_PERUSAHAAN",
        160_000,
    )
    .await;
    slip_line(
        &pool,
        "run-bpjs",
        "emp-a",
        2,
        "EARNING",
        "BPJS_TK_PERUSAHAAN",
        120_000,
    )
    .await;

    cloud::payroll_accrual_post(&pool, "run-bpjs", SITE, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("accrual: {error}"));

    assert_eq!(
        balance(&pool, "6017", Some(SITE)).await,
        280_000,
        "employer BPJS"
    );
    assert_eq!(
        balance(&pool, "6016", Some(SITE)).await,
        0,
        "not a medical cost"
    );
    assert_eq!(
        balance(&pool, "6012", Some(SITE)).await,
        4_000_000,
        "salary is only the base"
    );
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn payroll_accrues_by_component_and_payment_clears_the_payable(pool: PgPool) {
    cloud::open_period(&pool, 2026, 9)
        .await
        .unwrap_or_else(|error| panic!("open: {error}"));
    let today = Utc::now().date_naive();
    let _ = cloud::open_period(
        &pool,
        chrono::Datelike::year(&today),
        chrono::Datelike::month(&today) as i32,
    )
    .await;
    bank_account(&pool, "1005", "ho", "BCA", "8880012345").await;
    for id in ["emp-a", "emp-b", "emp-c"] {
        employee(&pool, id).await;
    }
    for (run, place) in [("run-store", SITE), ("run-ho", "ho")] {
        sqlx::query(
            "INSERT INTO payroll_run (id, unit_id, period, state, complete, history)
             VALUES ($1, $2, '2026-09-01', 'APPROVED', true, '[]'::jsonb)",
        )
        .bind(run)
        .bind(place)
        .execute(&pool)
        .await
        .unwrap_or_else(|error| panic!("run: {error}"));
    }
    define_component(
        &pool,
        "LEMBUR",
        "EARNING",
        false,
        &[("payroll_expense", "STORE", "6013")],
    )
    .await;
    define_component(
        &pool,
        "UANG_MAKAN",
        "EARNING",
        false,
        &[("payroll_expense", "HO", "6028")],
    )
    .await;
    // PPh 21 is the company's (owner, 25 Sep): its expense beside salary, and
    // the tax owed on 2011.
    define_component(
        &pool,
        "PPH21",
        "DEDUCTION",
        true,
        &[
            ("payroll_expense", "STORE", "6012"),
            ("payroll_expense", "HO", "6026"),
            ("payroll_deduction", "STORE", "2011"),
            ("payroll_deduction", "HO", "2011"),
        ],
    )
    .await;
    define_component(
        &pool,
        "BPJS_KARYAWAN",
        "DEDUCTION",
        false,
        &[
            ("payroll_deduction", "STORE", "2021"),
            ("payroll_deduction", "HO", "2021"),
        ],
    )
    .await;
    // Store: two people, one with overtime and a PPh 21 withholding.
    slip(&pool, "run-store", "emp-a", 4_000_000, 4_500_000, 100_000).await;
    slip_line(&pool, "run-store", "emp-a", 1, "EARNING", "LEMBUR", 500_000).await;
    slip_line(
        &pool,
        "run-store",
        "emp-a",
        2,
        "DEDUCTION",
        "PPH21",
        100_000,
    )
    .await;
    slip(&pool, "run-store", "emp-b", 3_600_000, 3_600_000, 0).await;
    // Head office: one person with a meal allowance and a BPJS deduction.
    slip(&pool, "run-ho", "emp-c", 6_000_000, 6_600_000, 120_000).await;
    slip_line(
        &pool,
        "run-ho",
        "emp-c",
        1,
        "EARNING",
        "UANG_MAKAN",
        600_000,
    )
    .await;
    slip_line(
        &pool,
        "run-ho",
        "emp-c",
        2,
        "DEDUCTION",
        "BPJS_KARYAWAN",
        120_000,
    )
    .await;

    cloud::payroll_accrual_post(&pool, "run-store", SITE, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("store accrual: {error}"));
    cloud::payroll_accrual_post(&pool, "run-ho", "ho", ACTOR)
        .await
        .unwrap_or_else(|error| panic!("ho accrual: {error}"));

    // Store staff on selling-expense leaves, head office on employee leaves.
    assert_eq!(
        balance(&pool, "6013", Some(SITE)).await,
        500_000,
        "store overtime"
    );
    let store_thr = 4_000_000 / 12 + 3_600_000 / 12;
    // 7,600,000 of salary plus the 100,000 PPh 21 the company bears on top.
    assert_eq!(
        balance(&pool, "6012", Some(SITE)).await,
        7_700_000,
        "store salary + employer PPh 21"
    );
    assert_eq!(
        balance(&pool, "6018", Some(SITE)).await,
        store_thr,
        "store THR accrual"
    );
    assert_eq!(
        balance(&pool, "6028", Some("ho")).await,
        600_000,
        "head-office meal"
    );
    assert_eq!(
        balance(&pool, "6026", Some("ho")).await,
        6_000_000,
        "head-office salary"
    );
    assert_eq!(balance(&pool, "6012", Some("ho")).await, 0);
    assert_eq!(
        balance(&pool, "2011", None).await,
        -100_000,
        "PPh 21 withheld"
    );
    // BPJS is its own liability (owner, 25 Sep) rather than folded into 2017,
    // and PPh 21 is the company's expense — so the employee's net is the whole
    // gross and 2017 carries all 8,100,000.
    assert_eq!(balance(&pool, "2017", Some(SITE)).await, -8_100_000);
    assert_eq!(
        balance(&pool, "2017", Some("ho")).await,
        -(6_600_000 - 120_000)
    );
    assert_eq!(
        balance(&pool, "2021", Some("ho")).await,
        -120_000,
        "BPJS withheld, waiting on Finance to remit it"
    );
    assert_eq!(
        balance(&pool, "2018", None).await,
        -(store_thr + 6_000_000 / 12)
    );

    // Paying: the store from petty cash funded by head office (two halves);
    // head office staff and the BPJS remittance from the bank.
    let fund = cloud::operating_fund_send(
        &pool,
        &cloud::SendFundRequest {
            unit_id: SITE.into(),
            custodian_employee_id: "emp-a".into(),
            amount_minor: 8_100_000,
            value_date: day(),
            due_date: None,
            bank_key: "bank_giro".into(),
            bank_qualifier: "BCA".into(),
            payout_bank_name: "BCA".into(),
            payout_account_no: "7712345678".into(),
            payout_account_name: "A".into(),
            note: None,
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("send: {error}"));
    let fund_id: Uuid = serde_json::from_value(fund["fund_id"].clone())
        .unwrap_or_else(|error| panic!("fund id: {error}"));
    assert_eq!(
        balance(&pool, "1057", Some("ho")).await,
        8_100_000,
        "HO half: Dr 1057"
    );
    assert_eq!(
        balance(&pool, "1003", Some(SITE)).await,
        0,
        "not yet received"
    );
    cloud::operating_fund_receive(
        &pool,
        fund_id,
        &cloud::ReceiveFundRequest { received_on: day() },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("receive: {error}"));
    assert_eq!(
        balance(&pool, "2028", Some(SITE)).await,
        -8_100_000,
        "unit half: Cr 2028"
    );
    cloud::fund_settlement_record(
        &pool,
        &cloud::SettleFundRequest {
            fund_id,
            allocation_id: None,
            kind: "PAYROLL".into(),
            reference_id: None,
            expense_key: None,
            amount_minor: 8_100_000,
            settled_on: day(),
            proof_file_id: None,
            note: None,
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("store payout: {error}"));
    post(
        &pool,
        &intent(
            "PAYROLL_RUN",
            vec![
                PostingLine::debit("payroll_payable", "ho", 6_480_000),
                PostingLine::debit("bpjs_payable", "ho", 120_000),
                PostingLine::credit("bank_giro", "ho", 6_600_000).with_qualifier("BCA"),
            ],
        ),
    )
    .await
    .unwrap_or_else(|error| panic!("ho payment: {error}"));
    assert_eq!(
        balance(&pool, "2017", None).await,
        0,
        "2017 cleared by the payments"
    );
    assert_eq!(balance(&pool, "2021", Some("ho")).await, 0, "BPJS remitted");
    assert_eq!(
        balance(&pool, "1003", Some(SITE)).await,
        0,
        "petty cash received and spent"
    );
    every_unit_balances_in_its_own_books(&pool).await;
}

// ---------------------------------------------------------------------------
// A newly added bank's EDC takings go to its own account (1004)
// ---------------------------------------------------------------------------

/// "Tambah bank" and a method saved without a mode must start on
/// DIRECT_TO_BANK. 0722 fixed the rows that existed on 1 Oct 2026; the two
/// creation paths did not, so a new bank's cards landed on Piutang.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_new_bank_takes_its_cards_into_the_bank(pool: PgPool) {
    cloud::add_bank(
        &pool,
        &cloud::AddBankRequest {
            bank_code: "BSI".into(),
            bank_name: "BSI".into(),
            giro: true,
            savings: false,
            debit_card: true,
            account_no: None,
            account_holder: None,
            account_unit_id: None,
            terminals: Vec::new(),
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("add bank: {error}"));

    let modes: Vec<(String, String)> = sqlx::query_as(
        "SELECT code, settlement_mode FROM payment_method
          WHERE bank_code = 'BSI' ORDER BY code",
    )
    .fetch_all(&pool)
    .await
    .unwrap_or_else(|error| panic!("methods: {error}"));
    assert_eq!(
        modes,
        vec![
            ("DEBIT_BSI".into(), "DIRECT_TO_BANK".into()),
            ("QRIS_BSI".into(), "DIRECT_TO_BANK".into()),
        ],
        "a new bank's cards and QRIS start on the bank"
    );

    let saved = cloud::save_payment_method(
        &pool,
        &cloud::SavePaymentMethodRequest {
            code: "CREDIT_AMEX".into(),
            name: "Kartu kredit AMEX".into(),
            tender_type: "CREDIT_CARD".into(),
            bank_code: "AMEX".into(),
            settlement_mode: None,
            mdr_bps: 0,
            point_value_minor: None,
            is_active: true,
            note: None,
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("save method: {error}"));
    assert_eq!(
        saved.settlement_mode, "DIRECT_TO_BANK",
        "a card saved without a mode lands in the bank"
    );
}
