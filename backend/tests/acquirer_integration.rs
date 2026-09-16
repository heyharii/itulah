//! Settling a card sale, from the shop's evening to the bank's credit.
//!
//! Against a real Postgres, because most of what matters here is enforced
//! there: a reconciliation is unique per shop, day, tender and terminal because
//! two partial unique indexes say so; a decision is one per receipt because
//! another does; and a curated settlement balances because a deferred
//! constraint trigger says so. A test with a stubbed database would prove the
//! Rust agrees with itself.
//!
//! Sales are inserted as raw `edge_sale` rows rather than pushed through sync,
//! for the reason `sales_posting_integration` gives: what is under test is the
//! reconciliation, and going through ingest would make each of these a test of
//! the sync contract too, so a change to either would turn both red and neither
//! message would say which.

use chrono::{DateTime, NaiveDate, TimeZone, Utc};
use inventory_backend::cloud::postgres::{self as cloud};
use sqlx::{PgPool, Row};
use uuid::Uuid;

const ACTOR: &str = "ana";
const SITE: &str = "store-01";
const HQ: &str = "dc";

fn day() -> NaiveDate {
    NaiveDate::from_ymd_opt(2026, 9, 15).unwrap_or_else(|| panic!("bad date"))
}

fn date(year: i32, month: u32, of: u32) -> NaiveDate {
    NaiveDate::from_ymd_opt(year, month, of).unwrap_or_else(|| panic!("bad date"))
}

/// Noon at the shop, which is 05:00 UTC — comfortably inside the business day
/// however the window is rounded.
fn midday() -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 9, 15, 5, 0, 0)
        .single()
        .unwrap_or_else(|| panic!("bad instant"))
}

// ---------------------------------------------------------------------------
// The chart, and the meanings pointed at it
// ---------------------------------------------------------------------------

/// A chart shaped like the client's: root → ten-digit rung → location leaf.
///
/// Two locations, because that is the whole shape of a settlement. The
/// receivable and the fee belong to the shop that made the sale; the bank
/// account the money lands in belongs to head office. An entry that could only
/// touch one of them would be an entry this module cannot write.
async fn seed_chart(pool: &PgPool) {
    for (code, name) in [
        ("1", "ASSET"),
        ("2", "LIABILITIES"),
        ("4", "PENDAPATAN"),
        ("6", "BEBAN PENJUALAN"),
        ("8", "BEBAN NON OPERASIONAL"),
    ] {
        sqlx::query(
            "INSERT INTO ledger_account (account_code, name, parent_code, is_group)
             VALUES ($1,$2,NULL,true)
             ON CONFLICT (account_code) DO NOTHING",
        )
        .bind(code)
        .bind(name)
        .execute(pool)
        .await
        .unwrap_or_else(|error| panic!("{code}: {error}"));
    }

    // (rung, leaf, name, which location's books the leaf belongs to).
    let accounts: [(&str, &str, &str, &str); 13] = [
        ("1011001001", "101100100101", "Cash On Hand C001", SITE),
        (
            "1011101001",
            "101110100101",
            "Piutang kartu Kredit C001",
            SITE,
        ),
        (
            "1011101002",
            "101110100201",
            "Piutang Debit Card C001",
            SITE,
        ),
        ("1011101003", "101110100301", "Piutang QRIS C001", SITE),
        ("1011002001", "101100200100", "Cash In Bank Giro BCA HO", HQ),
        (
            "2012101003",
            "201210100301",
            "Hutang PPN Keluaran C001",
            SITE,
        ),
        ("4010110001", "401011000101", "Penjualan Tunai C001", SITE),
        (
            "4010111001",
            "401011100101",
            "Penjualan Debit BCA C001",
            SITE,
        ),
        ("4010214001", "401021400101", "Retur Penjualan C001", SITE),
        ("6010110002", "601011000201", "Biaya Credit Card C001", SITE),
        (
            "8010110002",
            "801011000201",
            "Selisih pembulatan C001",
            SITE,
        ),
        // The two sides of what head office and the shop owe each other. A
        // settlement puts money in head office's bank against a debt carried in
        // the shop's books, which is an inter-unit entry — so the balancer adds
        // the affiliate legs and they need somewhere to land.
        (
            "1021401",
            "102140100200",
            "Piutang Affiliasi Pembiayaan CIKUPA - HO",
            HQ,
        ),
        (
            "2012301",
            "201230100101",
            "Hutang Affiliasi Pembiayaan HEAD OFFICE - C001",
            SITE,
        ),
    ];
    for (rung, leaf, name, site) in accounts {
        sqlx::query(
            "INSERT INTO ledger_account (account_code, name, parent_code, is_group)
             VALUES ($1,$2,$3,true) ON CONFLICT DO NOTHING",
        )
        .bind(rung)
        .bind(name)
        .bind(&rung[..1])
        .execute(pool)
        .await
        .unwrap_or_else(|error| panic!("{rung}: {error}"));
        sqlx::query(
            "INSERT INTO ledger_account (account_code, name, parent_code, is_group, site_id)
             VALUES ($1,$2,$3,false,$4)
             ON CONFLICT (account_code) DO NOTHING",
        )
        .bind(leaf)
        .bind(name)
        .bind(rung)
        .bind(site)
        .execute(pool)
        .await
        .unwrap_or_else(|error| panic!("{leaf}: {error}"));
    }
    register_bank_account(pool, "101100200100", "dc").await;
}

async fn map(pool: &PgPool, key: &str, site: &str, qualifier: &str, code: &str) {
    cloud::set_account_mapping(
        pool,
        &cloud::SetAccountMappingRequest {
            semantic_key: key.into(),
            site_id: site.into(),
            qualifier: qualifier.into(),
            account_code: code.into(),
            note: None,
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("map {key}/{site}/{qualifier}: {error}"));
}

/// Every meaning a settlement can touch, at the location that carries it.
///
/// `card_fee` is qualified by the acquirer even though the client keeps one
/// `Biaya Credit Card` — every qualifier points at the same leaf, which is what
/// lets the fee be split by acquirer in a report without a posting rule
/// changing. `sales_return` is qualified the same way because a chargeback
/// residual is booked with the acquirer's name on it.
async fn map_everything(pool: &PgPool) {
    map(pool, "cash", SITE, "", "101100100101").await;
    map(pool, "vat_out", SITE, "", "201210100301").await;
    map(pool, "revenue_cash", SITE, "", "401011000101").await;
    map(pool, "rounding", SITE, "", "801011000201").await;
    map(pool, "revenue_debit", SITE, "BCA", "401011100101").await;
    map(pool, "revenue_debit", SITE, "MANDIRI", "401011100101").await;
    map(pool, "card_receivable_debit", SITE, "BCA", "101110100201").await;
    map(
        pool,
        "card_receivable_debit",
        SITE,
        "MANDIRI",
        "101110100201",
    )
    .await;
    map(pool, "card_receivable_credit", SITE, "VISA", "101110100101").await;
    map(pool, "qris_receivable", SITE, "GOPAY", "101110100301").await;
    map(pool, "card_fee", SITE, "BCA", "601011000201").await;
    map(pool, "card_fee", SITE, "MANDIRI", "601011000201").await;
    map(pool, "card_fee", HQ, "BCA", "601011000201").await;
    map(pool, "sales_return", SITE, "BCA", "401021400101").await;
    map(pool, "bank_giro", HQ, "BCA", "101100200100").await;
    // What the balancer needs to book the two halves of an inter-unit entry.
    // Qualified by the other unit, which is how one account per pair is kept
    // apart from one account per counterparty.
    map(
        pool,
        "affiliate_receivable",
        HQ,
        &format!("PEMBIAYAAN:{SITE}"),
        "102140100200",
    )
    .await;
    map(
        pool,
        "affiliate_payable",
        SITE,
        &format!("PEMBIAYAAN:{HQ}"),
        "201230100101",
    )
    .await;
}

async fn open_september(pool: &PgPool) {
    cloud::open_period(pool, 2026, 9)
        .await
        .unwrap_or_else(|error| panic!("open period: {error}"));
}

// ---------------------------------------------------------------------------
// Sales
// ---------------------------------------------------------------------------

/// One completed sale as a shop synced it, with one card tender behind it.
async fn card_sale(pool: &PgPool, amount_minor: i64, acquirer: &str) -> Uuid {
    let sale_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO edge_sale
           (sale_id, origin_id, generation, seq, movement_group_id, site_id, actor_id,
            occurred_at, currency, total_minor, paid_minor, change_minor,
            discount_total_minor)
         VALUES ($1,'store-edge-01',1,nextval('journal_entry_number_seq'),$2,$3,'kasir',
                 $4,'IDR',$5,$5,0,0)",
    )
    .bind(sale_id)
    .bind(Uuid::new_v4())
    .bind(SITE)
    .bind(midday())
    .bind(amount_minor)
    .execute(pool)
    .await
    .unwrap_or_else(|error| panic!("sale: {error}"));

    sqlx::query(
        "INSERT INTO edge_sale_tender
           (sale_id, tender_seq, method, amount_minor, acquirer, card_kind)
         VALUES ($1,0,'CARD',$2,$3,'DEBIT')",
    )
    .bind(sale_id)
    .bind(amount_minor)
    .bind(acquirer)
    .execute(pool)
    .await
    .unwrap_or_else(|error| panic!("tender: {error}"));
    sale_id
}

async fn open_card_recon(pool: &PgPool, terminal: &str) -> Uuid {
    cloud::tender_recon_open(
        pool,
        SITE,
        day(),
        &cloud::OpenTenderReconRequest {
            tender_kind: "CARD".into(),
            terminal_id: Some(terminal.into()),
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("open: {error}"))
    .recon_id
}

async fn key_in_slip(pool: &PgPool, recon_id: Uuid, auth: &str, acquirer: &str, amount: i64) {
    cloud::tender_recon_record_batch(
        pool,
        recon_id,
        &cloud::RecordTenderBatchRequest {
            lines: vec![cloud::TenderBatchLineInput {
                batch_no: "0143".into(),
                auth_code: auth.into(),
                acquirer: acquirer.into(),
                amount_minor: amount,
            }],
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("slip: {error}"));
}

/// What one account holds, over everything posted.
async fn balance(pool: &PgPool, code: &str) -> (i64, i64) {
    let row = sqlx::query(
        "SELECT COALESCE(SUM(debit_minor),0)::bigint AS d,
                COALESCE(SUM(credit_minor),0)::bigint AS c
           FROM journal_line WHERE account_code = $1",
    )
    .bind(code)
    .fetch_one(pool)
    .await
    .unwrap_or_else(|error| panic!("balance {code}: {error}"));
    (
        row.try_get("d").unwrap_or_else(|e| panic!("{e}")),
        row.try_get("c").unwrap_or_else(|e| panic!("{e}")),
    )
}

// ---------------------------------------------------------------------------
// The shop's evening
// ---------------------------------------------------------------------------

#[sqlx::test(migrations = "./migrations/postgres")]
async fn suggestions_pair_equal_amounts_and_propose_a_cross_acquirer_retender(pool: PgPool) {
    // Two card sales, both rung as BCA. One of them was actually swiped on the
    // MANDIRI machine, which is the mistake nothing downstream can find: every
    // total balances, against the wrong counterparty.
    let paid_bca = card_sale(&pool, 250_000, "BCA").await;
    let really_mandiri = card_sale(&pool, 300_000, "BCA").await;

    let bca = open_card_recon(&pool, "EDC-1").await;
    let mandiri = open_card_recon(&pool, "EDC-2").await;
    key_in_slip(&pool, bca, "AUTH-1", "BCA", 250_000).await;
    key_in_slip(&pool, mandiri, "AUTH-2", "MANDIRI", 300_000).await;

    let found = cloud::tender_recon_suggest(&pool, bca)
        .await
        .unwrap_or_else(|error| panic!("suggest: {error}"));

    assert_eq!(found.suggestions.len(), 2, "{found:#?}");
    let matched = found
        .suggestions
        .iter()
        .find(|one| one.decision == "MATCHED")
        .unwrap_or_else(|| panic!("no match in {found:#?}"));
    assert_eq!(matched.sale_id, paid_bca.to_string());
    assert_eq!(matched.from_acquirer, None);

    // The approval on the other machine is proposed as a retender, naming both
    // acquirers — because the receivable is owed by MANDIRI and the books say
    // BCA.
    let moved = found
        .suggestions
        .iter()
        .find(|one| one.decision == "RETENDER")
        .unwrap_or_else(|| panic!("no retender in {found:#?}"));
    assert_eq!(moved.sale_id, really_mandiri.to_string());
    assert_eq!(moved.from_acquirer.as_deref(), Some("BCA"));
    assert_eq!(moved.to_acquirer.as_deref(), Some("MANDIRI"));
    assert!(found.receipts_without_approval.is_empty(), "{found:#?}");
    assert!(found.approvals_without_receipt.is_empty(), "{found:#?}");
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_retender_decision_moves_the_tender_through_lane_as_path(pool: PgPool) {
    seed_chart(&pool).await;
    map_everything(&pool).await;
    open_september(&pool).await;

    let sale_id = card_sale(&pool, 300_000, "BCA").await;
    let recon = open_card_recon(&pool, "EDC-1").await;

    let outcome = cloud::tender_recon_decide(
        &pool,
        recon,
        &cloud::RecordTenderDecisionRequest {
            sale_id: Some(sale_id),
            tender_seq: Some(0),
            batch_line_id: None,
            decision: "RETENDER".into(),
            from_acquirer: Some("BCA".into()),
            to_acquirer: Some("MANDIRI".into()),
            note: Some("swiped on the wrong machine".into()),
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("decide: {error}"));

    // The decision is recorded here, and the move was performed by the module
    // that owns the receivable — one row in its table, not a second rule in
    // this one.
    assert_eq!(outcome.decision.decision, "RETENDER");
    let moved = outcome
        .retender
        .unwrap_or_else(|| panic!("the decision recorded no retender"));
    assert_eq!(moved.from_acquirer, "BCA");
    assert_eq!(moved.to_acquirer, "MANDIRI");

    let acquirer: String = sqlx::query("SELECT acquirer FROM edge_sale_tender WHERE sale_id = $1")
        .bind(sale_id)
        .fetch_one(&pool)
        .await
        .unwrap_or_else(|error| panic!("read back: {error}"))
        .try_get("acquirer")
        .unwrap_or_else(|error| panic!("{error}"));
    assert_eq!(acquirer, "MANDIRI");

    let logged: i64 = sqlx::query("SELECT COUNT(*)::bigint AS n FROM sale_tender_retender")
        .fetch_one(&pool)
        .await
        .unwrap_or_else(|error| panic!("count: {error}"))
        .try_get("n")
        .unwrap_or_else(|error| panic!("{error}"));
    assert_eq!(logged, 1);
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn closing_refuses_while_a_line_is_undecided(pool: PgPool) {
    let sale_id = card_sale(&pool, 250_000, "BCA").await;
    let recon = open_card_recon(&pool, "EDC-1").await;
    key_in_slip(&pool, recon, "AUTH-1", "BCA", 250_000).await;

    // Both lists are populated and the totals agree exactly. That is not
    // enough, and the refusal has to say so — two lists can add to the same
    // number while naming different payments.
    let refused = cloud::tender_recon_close(
        &pool,
        recon,
        &cloud::CloseTenderReconRequest::default(),
        ACTOR,
    )
    .await;
    let message = refused
        .err()
        .unwrap_or_else(|| panic!("closed with nothing decided"))
        .to_string();
    assert!(message.contains("no answer yet"), "{message}");

    // One answer covers both sides of the one payment, and now it closes.
    let batch_line_id = cloud::tender_recon_detail(&pool, recon)
        .await
        .unwrap_or_else(|error| panic!("detail: {error}"))
        .batch_lines[0]
        .batch_line_id;
    cloud::tender_recon_decide(
        &pool,
        recon,
        &cloud::RecordTenderDecisionRequest {
            sale_id: Some(sale_id),
            tender_seq: Some(0),
            batch_line_id: Some(batch_line_id),
            decision: "MATCHED".into(),
            from_acquirer: None,
            to_acquirer: None,
            note: None,
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("decide: {error}"));

    let closed = cloud::tender_recon_close(
        &pool,
        recon,
        &cloud::CloseTenderReconRequest::default(),
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("close: {error}"));
    assert_eq!(closed.status, "CLOSED");
    assert_eq!(closed.closed_by.as_deref(), Some(ACTOR));
}

// ---------------------------------------------------------------------------
// Head office's next day
// ---------------------------------------------------------------------------

/// A settlement for one shop's BCA debit takings, gross 1,000,000 less 15,000.
async fn a_bca_settlement(pool: &PgPool, sale_id: Uuid) -> Uuid {
    cloud::acq_settlement_create(
        pool,
        &cloud::CreateAcquirerSettlementRequest {
            acquirer: "BCA".into(),
            settlement_date: date(2026, 9, 16),
            business_from: day(),
            business_to: day(),
            gross_minor: 1_000_000,
            mdr_minor: 15_000,
            lines: vec![cloud::AcquirerSettlementLineInput {
                sale_id: Some(sale_id),
                tender_seq: Some(0),
                site_id: SITE.into(),
                tender_kind: "CARD_DEBIT".into(),
                auth_code: Some("AUTH-1".into()),
                amount_minor: 1_000_000,
                mdr_minor: 15_000,
            }],
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("create: {error}"))
    .settlement_id
}

fn curate() -> cloud::CurateSettlementRequest {
    cloud::CurateSettlementRequest {
        bank_key: "bank_giro".into(),
        bank_qualifier: "BCA".into(),
        posting_date: None,
    }
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_curated_settlement_posts_balanced_with_the_fee(pool: PgPool) {
    seed_chart(&pool).await;
    map_everything(&pool).await;
    open_september(&pool).await;
    let sale_id = card_sale(&pool, 1_000_000, "BCA").await;
    let settlement_id = a_bca_settlement(&pool, sale_id).await;

    let curated = cloud::acq_settlement_curate(&pool, settlement_id, &curate(), ACTOR)
        .await
        .unwrap_or_else(|error| panic!("curate: {error}"));
    assert_eq!(curated.status, "CURATED");
    assert_eq!(curated.net_minor, 985_000);
    assert_eq!(curated.expected_net_minor, Some(985_000));
    let entry_id = curated
        .journal_entry_id
        .unwrap_or_else(|| panic!("curated with no entry"));

    // The bank at head office takes the net, the shop wears the fee, and the
    // shop's receivable is discharged at gross. The entry balances in total and
    // deliberately not per location: the money genuinely moved between two sets
    // of books.
    assert_eq!(balance(&pool, "101100200100").await, (985_000, 0));
    assert_eq!(balance(&pool, "601011000201").await, (15_000, 0));
    assert_eq!(balance(&pool, "101110100201").await, (0, 1_000_000));

    let row = sqlx::query(
        "SELECT source_kind, COUNT(l.line_id)::bigint AS lines,
                COALESCE(SUM(l.debit_minor),0)::bigint AS d,
                COALESCE(SUM(l.credit_minor),0)::bigint AS c
           FROM journal_entry e JOIN journal_line l USING (entry_id)
          WHERE e.entry_id = $1 GROUP BY source_kind",
    )
    .bind(entry_id)
    .fetch_one(&pool)
    .await
    .unwrap_or_else(|error| panic!("entry: {error}"));
    assert_eq!(
        row.try_get::<String, _>("source_kind")
            .unwrap_or_else(|e| panic!("{e}")),
        "ACQ_SETTLEMENT"
    );
    // Five, not the three this rule writes. Head office's bank takes money that
    // discharges a debt carried in the shop's books, so the entry is inter-unit
    // and the balancer adds the pair of affiliate legs that leaves each of them
    // balanced on its own. Asserting three here would be asserting that a
    // settlement leaves two sets of books that cannot be published.
    assert_eq!(
        row.try_get::<i64, _>("lines")
            .unwrap_or_else(|e| panic!("{e}")),
        5
    );
    assert_eq!(
        row.try_get::<i64, _>("d").unwrap_or_else(|e| panic!("{e}")),
        row.try_get::<i64, _>("c").unwrap_or_else(|e| panic!("{e}"))
    );

    // Curating twice would discharge the same receivable twice.
    let again = cloud::acq_settlement_curate(&pool, settlement_id, &curate(), ACTOR).await;
    assert!(again.is_err(), "a curated settlement curated again");
}

/// A credit on the bank statement, at whatever the bank actually paid.
async fn bank_credit(pool: &PgPool, amount: i64) -> Uuid {
    cloud::import_statement(
        pool,
        &cloud::ImportStatementRequest {
            account_code: "101100200100".into(),
            site_id: HQ.into(),
            bank_account_id: None,
            period_start: date(2026, 9, 1),
            period_end: date(2026, 9, 30),
            opening_minor: 0,
            closing_minor: amount,
            source_name: Some("BCA".into()),
            lines: vec![cloud::ImportStatementLine {
                value_date: date(2026, 9, 16),
                description: "SETTLEMENT EDC BCA".into(),
                reference: Some("STL-0916".into()),
                debit_minor: 0,
                credit_minor: amount,
            }],
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("statement: {error}"));

    sqlx::query("SELECT line_id FROM bank_statement_line LIMIT 1")
        .fetch_one(pool)
        .await
        .unwrap_or_else(|error| panic!("line: {error}"))
        .try_get("line_id")
        .unwrap_or_else(|error| panic!("{error}"))
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn matching_links_the_bank_line_that_paid_it(pool: PgPool) {
    seed_chart(&pool).await;
    map_everything(&pool).await;
    open_september(&pool).await;
    let sale_id = card_sale(&pool, 1_000_000, "BCA").await;
    let settlement_id = a_bca_settlement(&pool, sale_id).await;
    cloud::acq_settlement_curate(&pool, settlement_id, &curate(), ACTOR)
        .await
        .unwrap_or_else(|error| panic!("curate: {error}"));

    let line_id = bank_credit(&pool, 985_000).await;
    let matched = cloud::acq_settlement_match(
        &pool,
        settlement_id,
        &cloud::MatchSettlementRequest {
            bank_statement_line_id: line_id,
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("match: {error}"));

    assert_eq!(matched.status, "MATCHED");
    assert_eq!(matched.bank_statement_line_id, Some(line_id));
    assert_eq!(matched.difference_minor, Some(0));

    // The agreement is kept where every other bank agreement is kept, against
    // the entry's own bank leg — not in a second table saying the same thing.
    let agreed: i64 =
        sqlx::query("SELECT COUNT(*)::bigint AS n FROM bank_line_match WHERE line_id = $1")
            .bind(line_id)
            .fetch_one(&pool)
            .await
            .unwrap_or_else(|error| panic!("count: {error}"))
            .try_get("n")
            .unwrap_or_else(|error| panic!("{error}"));
    assert_eq!(agreed, 1);
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_net_the_bank_disagrees_with_becomes_an_exception_that_can_be_posted(pool: PgPool) {
    seed_chart(&pool).await;
    map_everything(&pool).await;
    open_september(&pool).await;
    let sale_id = card_sale(&pool, 1_000_000, "BCA").await;
    let settlement_id = a_bca_settlement(&pool, sale_id).await;
    cloud::acq_settlement_curate(&pool, settlement_id, &curate(), ACTOR)
        .await
        .unwrap_or_else(|error| panic!("curate: {error}"));

    // The report promised 985,000 and 945,000 arrived. No match is written: a
    // match asserts the two are the same event, and at a different amount they
    // demonstrably are not.
    let line_id = bank_credit(&pool, 945_000).await;
    let flagged = cloud::acq_settlement_match(
        &pool,
        settlement_id,
        &cloud::MatchSettlementRequest {
            bank_statement_line_id: line_id,
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("match: {error}"));
    assert_eq!(flagged.status, "EXCEPTION");
    assert_eq!(flagged.difference_minor, Some(40_000));

    let bank_before = balance(&pool, "101100200100").await;
    let explained = cloud::acq_settlement_explain(
        &pool,
        settlement_id,
        &cloud::ExplainSettlementRequest {
            kind: "FEE".into(),
            explanation: "an annual terminal charge the report did not state".into(),
            site_id: Some(SITE.into()),
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("explain: {error}"));
    assert_eq!(explained.status, "EXCEPTION");

    // The residual is a cost the shop wears and money the bank never sent, so
    // the fee account grows by exactly the difference and the bank leg shrinks
    // by the same.
    assert_eq!(balance(&pool, "601011000201").await, (55_000, 0));
    let bank_after = balance(&pool, "101100200100").await;
    assert_eq!(bank_after.0, bank_before.0);
    assert_eq!(bank_after.1 - bank_before.1, 40_000);

    let posted: i64 = sqlx::query(
        "SELECT COUNT(*)::bigint AS n FROM acquirer_settlement_exception
          WHERE settlement_id = $1 AND journal_entry_id IS NOT NULL",
    )
    .bind(settlement_id)
    .fetch_one(&pool)
    .await
    .unwrap_or_else(|error| panic!("count: {error}"))
    .try_get("n")
    .unwrap_or_else(|error| panic!("{error}"));
    assert_eq!(posted, 1);
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn an_unexplained_difference_records_that_nobody_knows_yet(pool: PgPool) {
    seed_chart(&pool).await;
    map_everything(&pool).await;
    open_september(&pool).await;
    let sale_id = card_sale(&pool, 1_000_000, "BCA").await;
    let settlement_id = a_bca_settlement(&pool, sale_id).await;
    cloud::acq_settlement_curate(&pool, settlement_id, &curate(), ACTOR)
        .await
        .unwrap_or_else(|error| panic!("curate: {error}"));
    let line_id = bank_credit(&pool, 945_000).await;
    cloud::acq_settlement_match(
        &pool,
        settlement_id,
        &cloud::MatchSettlementRequest {
            bank_statement_line_id: line_id,
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("match: {error}"));

    let before = balance(&pool, "601011000201").await;
    cloud::acq_settlement_explain(
        &pool,
        settlement_id,
        &cloud::ExplainSettlementRequest {
            kind: "OPEN".into(),
            explanation: "asked BCA on the 17th, no answer yet".into(),
            site_id: None,
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("explain: {error}"));

    // Nothing is booked. An unexplained difference is not a cost until somebody
    // has decided it is one, and booking it would put a number in the books
    // whose only evidence is that nobody had time to chase it.
    assert_eq!(balance(&pool, "601011000201").await, before);
    let unposted: i64 = sqlx::query(
        "SELECT COUNT(*)::bigint AS n FROM acquirer_settlement_exception
          WHERE settlement_id = $1 AND journal_entry_id IS NULL",
    )
    .bind(settlement_id)
    .fetch_one(&pool)
    .await
    .unwrap_or_else(|error| panic!("count: {error}"))
    .try_get("n")
    .unwrap_or_else(|error| panic!("{error}"));
    assert_eq!(unposted, 1);
}

// ---------------------------------------------------------------------------
// Curation input, and what is still owed
// ---------------------------------------------------------------------------

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_pasted_report_is_read_and_kept_verbatim(pool: PgPool) {
    seed_chart(&pool).await;
    map_everything(&pool).await;
    let sale_id = card_sale(&pool, 1_000_000, "BCA").await;
    let settlement_id = a_bca_settlement(&pool, sale_id).await;

    // An Indonesian exporter's idea of a CSV: semicolons, dots for thousands,
    // a comma for the decimal point, and a trailing total that is not a line.
    let raw = "AUTH;AMOUNT;MDR;DATE\n\
               AUTH-1;1.000.000,00;15.000,00;16/09/2026\n\
               AUTH-2;oops;0;16/09/2026\n\
               TOTAL\n";
    let outcome = cloud::acq_settlement_upload_report(
        &pool,
        settlement_id,
        &cloud::UploadSettlementReportRequest {
            source_name: Some("bca-20260916.csv".into()),
            raw: raw.into(),
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("upload: {error}"));

    assert_eq!(outcome.row_count, 1);
    assert_eq!(outcome.gross_minor, 1_000_000);
    assert_eq!(outcome.mdr_minor, 15_000);
    // The row it could not read comes back whole, rather than being skipped
    // into a total that is quietly short.
    assert_eq!(outcome.rejected_count, 1);
    assert_eq!(outcome.rejected.len(), 1);

    let kept: String =
        sqlx::query("SELECT raw FROM acquirer_settlement_report WHERE report_id = $1")
            .bind(outcome.report_id)
            .fetch_one(&pool)
            .await
            .unwrap_or_else(|error| panic!("report: {error}"))
            .try_get("raw")
            .unwrap_or_else(|error| panic!("{error}"));
    assert_eq!(kept, raw, "the evidence was normalised on the way in");
}

/// A posted day of card takings, and the id of the document that posted it.
async fn a_posted_day(pool: &PgPool) -> Uuid {
    let generated = cloud::sales_posting_generate(
        pool,
        &cloud::GenerateSalesPostingRequest {
            site_id: SITE.into(),
            business_date: day(),
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("generate: {error}"));
    cloud::sales_posting_post(pool, generated.posting.posting_id, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("post: {error}"));
    generated.posting.posting_id
}

/// Curate a BCA settlement for one shop's debit-card takings.
async fn settle_bca(pool: &PgPool, gross: i64, mdr: i64) -> Uuid {
    let settlement_id = cloud::acq_settlement_create(
        pool,
        &cloud::CreateAcquirerSettlementRequest {
            acquirer: "BCA".into(),
            settlement_date: date(2026, 9, 16),
            business_from: day(),
            business_to: day(),
            gross_minor: gross,
            mdr_minor: mdr,
            lines: vec![cloud::AcquirerSettlementLineInput {
                sale_id: None,
                tender_seq: None,
                site_id: SITE.into(),
                tender_kind: "CARD_DEBIT".into(),
                auth_code: Some("AUTH-1".into()),
                amount_minor: gross,
                mdr_minor: mdr,
            }],
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("create: {error}"))
    .settlement_id;
    cloud::acq_settlement_curate(pool, settlement_id, &curate(), ACTOR)
        .await
        .unwrap_or_else(|error| panic!("curate: {error}"));
    settlement_id
}

/// What the integrity report says about one acquirer's receivable, having
/// first insisted that every control account in it agrees.
async fn receivable_control(
    pool: &PgPool,
    acquirer: &str,
) -> inventory_backend::cloud::postgres::PaymentLedgerIntegrityRow {
    let as_of = date(2026, 10, 25).max(Utc::now().date_naive());
    let integrity = cloud::payment_ledger_integrity(pool, Some(as_of), None)
        .await
        .unwrap_or_else(|error| panic!("integrity: {error}"));
    assert!(
        integrity.agrees,
        "the Payment Ledger and the books disagree: {:?}",
        integrity
            .rows
            .iter()
            .map(|row| (
                row.account_key.clone(),
                row.qualifier.clone(),
                row.ledger_outstanding_minor,
                row.gl_balance_minor
            ))
            .collect::<Vec<_>>()
    );
    integrity
        .rows
        .into_iter()
        .find(|row| row.qualifier == acquirer)
        .unwrap_or_else(|| panic!("no {acquirer} row in the integrity report"))
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn what_the_acquirer_owes_reads_the_same_in_the_ledger_and_in_the_books(pool: PgPool) {
    seed_chart(&pool).await;
    map_everything(&pool).await;
    open_september(&pool).await;

    // One evening's debit-card takings. The shop has the money on a slip; the
    // bank has it until Wednesday.
    card_sale(&pool, 1_000_000, "BCA").await;
    a_posted_day(&pool).await;

    let owed = receivable_control(&pool, "BCA").await;
    assert_eq!(owed.account_code.as_deref(), Some("101110100201"));
    assert_eq!(owed.side, "RECEIVABLE");
    assert_eq!(owed.ledger_outstanding_minor, 1_000_000);
    assert_eq!(owed.gl_balance_minor, 1_000_000);
    assert_eq!(owed.open_items, 1);

    // The settlement arrives, fifteen thousand light. The item closes at what
    // the customer paid and the fee is a cost, not a discount off a debt.
    settle_bca(&pool, 1_000_000, 15_000).await;

    let settled = receivable_control(&pool, "BCA").await;
    assert_eq!(
        settled.ledger_outstanding_minor, 0,
        "the acquirer paid, so nobody is chasing anything"
    );
    assert_eq!(settled.gl_balance_minor, 0);
    assert_eq!(settled.open_items, 0);
    assert_eq!(
        balance(&pool, "601011000201").await.0,
        15_000,
        "the MDR is its own expense line and not a smaller receivable"
    );
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_settlement_that_covers_one_evening_leaves_the_other_owed(pool: PgPool) {
    seed_chart(&pool).await;
    map_everything(&pool).await;
    open_september(&pool).await;
    card_sale(&pool, 1_000_000, "BCA").await;
    card_sale(&pool, 600_000, "BCA").await;
    a_posted_day(&pool).await;

    // BCA pays for part of the day and no more.
    settle_bca(&pool, 1_000_000, 15_000).await;

    let part_paid = receivable_control(&pool, "BCA").await;
    assert_eq!(
        part_paid.ledger_outstanding_minor, 600_000,
        "what BCA has not paid is what BCA still owes"
    );
    assert_eq!(part_paid.gl_balance_minor, 600_000);
    assert_eq!(part_paid.difference_minor, 0);
    assert_eq!(part_paid.open_items, 1);

    // And it is still one item, part settled, rather than a second debt.
    let items = cloud::ple_open_items(
        &pool,
        &cloud::PaymentLedgerFilter {
            account_key: Some("card_receivable_debit".into()),
            open_only: true,
            as_of: Some(date(2026, 10, 25)),
            limit: 50,
            ..Default::default()
        },
    )
    .await
    .unwrap_or_else(|error| panic!("open items: {error}"));
    assert_eq!(items.len(), 1);
    assert_eq!(items[0].party_id, "BCA");
    assert_eq!(items[0].amount_minor, 1_600_000);
    assert_eq!(items[0].settled_minor, 1_000_000);
    assert_eq!(items[0].outstanding_minor, 600_000);
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn ageing_splits_by_acquirer_even_when_they_share_one_account(pool: PgPool) {
    seed_chart(&pool).await;
    map_everything(&pool).await;
    open_september(&pool).await;

    // Two banks, one leaf. The client's chart keeps a single `Piutang Debit
    // Card` for every acquirer, which is exactly the case the old journal-based
    // ageing could not split — and, before that, the case it double-counted.
    card_sale(&pool, 1_000_000, "BCA").await;
    card_sale(&pool, 400_000, "MANDIRI").await;
    a_posted_day(&pool).await;

    // Forty days later. The debts are real, they are two different banks', and
    // they come to what was sold and not to twice it.
    let aged = cloud::acq_receivable_aging(&pool, date(2026, 10, 25), None, None)
        .await
        .unwrap_or_else(|error| panic!("ageing: {error}"));
    assert_eq!(aged.rows.len(), 2, "{aged:#?}");
    assert_eq!(
        aged.total.total_minor, 1_400_000,
        "one sale each, not each sale twice"
    );
    for row in &aged.rows {
        assert_eq!(row.site_id, SITE);
        assert_eq!(row.semantic_key, "card_receivable_debit");
        assert_eq!(row.account_code.as_deref(), Some("101110100201"));
        assert_eq!(row.buckets.days_31_60_minor, row.buckets.total_minor);
        assert_eq!(row.buckets.not_due_minor, 0);
    }
    let named: Vec<(&str, i64)> = aged
        .rows
        .iter()
        .map(|row| (row.acquirer.as_str(), row.buckets.total_minor))
        .collect();
    assert_eq!(named, vec![("BCA", 1_000_000), ("MANDIRI", 400_000)]);

    // On the day itself neither is due, and asking for one bank answers about
    // that bank rather than about the leaf they share.
    let fresh = cloud::acq_receivable_aging(&pool, day(), Some("BCA"), Some(SITE))
        .await
        .unwrap_or_else(|error| panic!("ageing: {error}"));
    assert_eq!(fresh.rows.len(), 1);
    assert_eq!(fresh.rows[0].acquirer, "BCA");
    assert_eq!(fresh.total.not_due_minor, 1_000_000);
    assert_eq!(fresh.total.days_31_60_minor, 0);

    // Once BCA has paid, BCA drops off the report and MANDIRI does not.
    settle_bca(&pool, 1_000_000, 15_000).await;
    let settled = cloud::acq_receivable_aging(&pool, date(2026, 10, 25), None, None)
        .await
        .unwrap_or_else(|error| panic!("ageing: {error}"));
    assert_eq!(settled.rows.len(), 1, "{settled:#?}");
    assert_eq!(settled.rows[0].acquirer, "MANDIRI");
    assert_eq!(settled.total.total_minor, 400_000);
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn an_exception_is_a_cost_and_not_a_smaller_debt(pool: PgPool) {
    seed_chart(&pool).await;
    map_everything(&pool).await;
    open_september(&pool).await;
    card_sale(&pool, 1_000_000, "BCA").await;
    card_sale(&pool, 600_000, "BCA").await;
    a_posted_day(&pool).await;

    // BCA settles one evening's worth and the bank pays 40,000 less than even
    // that settlement promised.
    let settlement_id = settle_bca(&pool, 1_000_000, 15_000).await;
    let line_id = bank_credit(&pool, 945_000).await;
    let flagged = cloud::acq_settlement_match(
        &pool,
        settlement_id,
        &cloud::MatchSettlementRequest {
            bank_statement_line_id: line_id,
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("match: {error}"));
    assert_eq!(flagged.status, "EXCEPTION");
    assert_eq!(flagged.difference_minor, Some(40_000));

    cloud::acq_settlement_explain(
        &pool,
        settlement_id,
        &cloud::ExplainSettlementRequest {
            kind: "FEE".into(),
            explanation: "an annual terminal charge the report did not state".into(),
            site_id: Some(SITE.into()),
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("explain: {error}"));

    // The shortfall went to the fee account and the bank, and touched no
    // receivable. So what is still owed is the evening BCA has not paid for —
    // not that evening less a charge somebody argued about afterwards.
    let owed = receivable_control(&pool, "BCA").await;
    assert_eq!(owed.ledger_outstanding_minor, 600_000);
    assert_eq!(owed.gl_balance_minor, 600_000);
    assert_eq!(owed.difference_minor, 0);
    assert_eq!(
        balance(&pool, "601011000201").await.0,
        15_000 + 40_000,
        "the stated MDR and the charge that was not stated, both costs"
    );
}

/// 0271: a bank statement is of a real account, so the fixture registers one.
///
/// Digits derived from the ledger binding rather than typed, so two accounts in
/// one fixture cannot collide on `UNIQUE (bank_id, account_no_digits)`.
async fn register_bank_account(pool: &sqlx::PgPool, code: &str, site: &str) {
    sqlx::query(
        "INSERT INTO company_bank_account
           (account_id, ledger_account_code, site_id, bank_id, bank_name,
            bank_name_normalized, account_no, account_no_digits, account_holder,
            kind, created_by, updated_by)
         SELECT gen_random_uuid(), $1, $2, b.bank_id, b.name, b.normalized_name,
                left(lpad(regexp_replace(md5($1 || $2), '[^0-9]', '', 'g'), 10, '0'), 10),
                left(lpad(regexp_replace(md5($1 || $2), '[^0-9]', '', 'g'), 10, '0'), 10),
                'PT Itulah Busana Nusantara', 'GIRO', 'fixture', 'fixture'
           FROM bank b WHERE b.code = 'BCA'
         ON CONFLICT (bank_id, account_no_digits) DO NOTHING",
    )
    .bind(code)
    .bind(site)
    .execute(pool)
    .await
    .unwrap_or_else(|error| panic!("register a bank account on {code} at {site}: {error}"));
}
