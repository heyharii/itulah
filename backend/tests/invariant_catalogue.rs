//! The consistency catalogue (`backend/invariants/`), kept honest.
//!
//! The catalogue is a set of SELECTs that each return the rows breaking one
//! rule — run by `scripts/check-invariants.py` against any database, production
//! included. Two things can quietly make such a catalogue worthless, and each
//! test here closes one of them.
//!
//! **Drift.** A migration renames a column a check reads, and on the night the
//! check is needed it answers `ERROR` instead of a finding. So the first test
//! runs every file against a freshly migrated database: every table it
//! declares must exist, every query must run, and a database with nothing in it
//! must have nothing wrong with it.
//!
//! **Blindness.** A check that cannot go red is worse than no check, because it
//! is trusted. So the second test builds a little of everything through the
//! real writers — the poster, the stock ledger, sync ingest and apply, vouchers,
//! points — asserts the critical and high rules find nothing in what those
//! writers produced, and then, for every rule, applies the rule's own
//! `-- mutate:` corruption with triggers off (the damage a hand edit, a second
//! writer or a migration run with triggers disabled would do) and asserts the
//! check's findings CHANGE. Rolled back every time.
//!
//! A rule the fixture cannot give data to is listed in `NOT_EXERCISED` with the
//! reason, and the list is checked both ways: a rule missing from it that was
//! not exercised fails, and so does a rule on it that now is.

use std::path::{Path, PathBuf};

use chrono::{Duration, NaiveDate, Utc};
use inventory_backend::cloud::{
    application::{
        CommandRequest, CommercialCampaignInput, CreateCommercialPublicationRequest,
        CreateMovementRequest, MovementLineRequest,
    },
    domain::{IngestBatch, SyncFact, FACT_SALES_COMPLETED},
    postgres::{
        self as cloud, AuthorizeVoucherRequest, IssueVoucherRequest, LineAccount, NewCostLayer,
        PostingIntent, PostingLine, RedeemPointsRequest, RedeemVoucherRequest, StockOutflow,
    },
};
use serde_json::json;
use sqlx::{PgPool, Postgres, Row, Transaction};
use uuid::Uuid;

const ACTOR: &str = "ana";
/// Head office's UNIT id — the books are keyed by unit since 0605, and 0600
/// creates exactly this one on every database (`INSERT INTO unit … 'ho'`).
/// `site.id` is a premises and is a different thing: `dc` on the seeded
/// database, `ho-gudang` on one opened through the hub.
const HO: &str = "ho";
const STORE: &str = "store-01";

/// Rules the fixture below gives no data to, and why. Every one of them is
/// still exercised by `scripts/check-invariants.py --mutation-check` against a
/// seeded database.
const NOT_EXERCISED: &[(&str, &str)] = &[
    (
        "sync.po_counter_not_behind",
        "needs a DC enrolment, a supplier and a catalogue item before one PO exists",
    ),
    (
        "stock.epc_serials_never_reused",
        "needs a tagging job, which needs an article with colours and sizes",
    ),
];

// ---------------------------------------------------------------------------
// The catalogue
// ---------------------------------------------------------------------------

#[derive(Debug)]
struct Rule {
    id: String,
    severity: String,
    requires: Vec<String>,
    mutate: Vec<String>,
    sql: String,
    path: PathBuf,
}

fn catalogue() -> Vec<Rule> {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("invariants");
    let mut files = Vec::new();
    collect(&root, &mut files);
    files.sort();
    assert!(!files.is_empty(), "no rules under {}", root.display());
    let rules: Vec<Rule> = files.iter().map(|path| parse(path)).collect();
    let mut ids: Vec<&str> = rules.iter().map(|rule| rule.id.as_str()).collect();
    ids.sort_unstable();
    let before = ids.len();
    ids.dedup();
    assert_eq!(before, ids.len(), "two rules share an id");
    rules
}

fn collect(dir: &Path, out: &mut Vec<PathBuf>) {
    let entries =
        std::fs::read_dir(dir).unwrap_or_else(|error| panic!("read {}: {error}", dir.display()));
    for entry in entries {
        let path = entry
            .unwrap_or_else(|error| panic!("entry in {}: {error}", dir.display()))
            .path();
        if path.is_dir() {
            collect(&path, out);
        } else if path.extension().is_some_and(|ext| ext == "sql") {
            out.push(path);
        }
    }
}

/// The same header grammar `scripts/check-invariants.py` reads: `-- key: value`
/// lines until the first line that is neither a comment nor blank.
fn parse(path: &Path) -> Rule {
    let text = std::fs::read_to_string(path)
        .unwrap_or_else(|error| panic!("read {}: {error}", path.display()));
    let (mut id, mut severity) = (String::new(), String::new());
    let (mut requires, mut mutate, mut body) = (Vec::new(), Vec::new(), Vec::new());
    let mut in_header = true;
    for line in text.lines() {
        if in_header {
            if let Some((key, value)) = line
                .strip_prefix("--")
                .and_then(|rest| rest.trim_start().split_once(':'))
                .filter(|(key, _)| key.chars().all(|c| c.is_ascii_lowercase() || c == '_'))
            {
                let value = value.trim().to_string();
                match key {
                    "id" => id = value,
                    "severity" => severity = value,
                    "requires" => requires.extend(
                        value
                            .split(',')
                            .map(str::trim)
                            .filter(|t| !t.is_empty())
                            .map(String::from),
                    ),
                    "mutate" => mutate.push(value),
                    _ => {}
                }
                continue;
            }
            if line.starts_with("--") || line.trim().is_empty() {
                continue;
            }
            in_header = false;
        }
        body.push(line);
    }
    let sql = body
        .join("\n")
        .trim()
        .trim_end_matches(';')
        .trim()
        .to_string();
    assert!(
        !id.is_empty() && !sql.is_empty(),
        "{}: needs an id and a query",
        path.display()
    );
    assert!(
        matches!(severity.as_str(), "critical" | "high" | "medium" | "low"),
        "{}: severity {severity:?}",
        path.display()
    );
    Rule {
        id,
        severity,
        requires,
        mutate,
        sql,
        path: path.to_path_buf(),
    }
}

/// `(findings, md5 of the sorted findings)` — the md5 so that corrupting a row
/// that was already wrong still shows as a change.
async fn fingerprint(
    tx: &mut Transaction<'_, Postgres>,
    rule: &Rule,
) -> Result<(i64, String), String> {
    let sql = format!(
        "SELECT count(*)::bigint AS n, md5(coalesce(string_agg(r, '|' ORDER BY r), '')) AS digest
           FROM (SELECT row_to_json(v)::text AS r FROM ({}) v) f",
        rule.sql
    );
    let row = sqlx::query(&sql)
        .fetch_one(&mut **tx)
        .await
        .map_err(|error| error.to_string())?;
    Ok((row.get("n"), row.get("digest")))
}

// ---------------------------------------------------------------------------
// 1. Every rule reads the schema the migrations build today
// ---------------------------------------------------------------------------

#[sqlx::test(migrations = "./migrations/postgres")]
async fn every_rule_reads_the_current_schema_and_an_empty_estate_is_clean(pool: PgPool) {
    let mut faults = Vec::new();
    for rule in catalogue() {
        for table in &rule.requires {
            let exists: bool = sqlx::query_scalar("SELECT to_regclass($1) IS NOT NULL")
                .bind(table)
                .fetch_one(&pool)
                .await
                .unwrap_or_else(|error| panic!("regclass: {error}"));
            if !exists {
                faults.push(format!(
                    "{}: declares `{table}`, which no migration builds",
                    rule.id
                ));
            }
        }
        let mut tx = pool.begin().await.unwrap_or_else(|e| panic!("begin: {e}"));
        match fingerprint(&mut tx, &rule).await {
            Ok((0, _)) => {}
            Ok((n, _)) => faults.push(format!(
                "{}: {n} finding(s) on a freshly migrated database",
                rule.id
            )),
            Err(error) => faults.push(format!("{} ({}): {error}", rule.id, rule.path.display())),
        }
        tx.rollback()
            .await
            .unwrap_or_else(|e| panic!("rollback: {e}"));
    }
    assert!(
        faults.is_empty(),
        "the catalogue has drifted from the schema:\n  {}",
        faults.join("\n  ")
    );
}

// ---------------------------------------------------------------------------
// 2. Every rule goes red when the data it guards is corrupted
// ---------------------------------------------------------------------------

#[sqlx::test(migrations = "./migrations/postgres")]
async fn every_rule_goes_red_when_the_data_it_guards_is_corrupted(pool: PgPool) {
    build_an_estate(&pool).await;
    let rules = catalogue();

    // What the real writers produced has to be clean where it matters. Medium
    // rules are leads, not faults (a receipt whose bill has not come is a
    // stock-versus-GL difference by design), so only the two top levels count.
    let mut dirty = Vec::new();
    for rule in rules
        .iter()
        .filter(|r| matches!(r.severity.as_str(), "critical" | "high"))
    {
        let mut tx = pool.begin().await.unwrap_or_else(|e| panic!("begin: {e}"));
        match fingerprint(&mut tx, rule).await {
            Ok((0, _)) => {}
            Ok((n, _)) => {
                let sample: Vec<String> = sqlx::query_scalar(&format!(
                    "SELECT row_to_json(v)::text FROM ({}) v LIMIT 3",
                    rule.sql
                ))
                .fetch_all(&mut *tx)
                .await
                .unwrap_or_default();
                dirty.push(format!("{}: {n} finding(s) {sample:?}", rule.id));
            }
            Err(error) => dirty.push(format!("{}: {error}", rule.id)),
        }
        tx.rollback()
            .await
            .unwrap_or_else(|e| panic!("rollback: {e}"));
    }
    assert!(
        dirty.is_empty(),
        "the real writers left data a critical or high rule calls wrong:\n  {}",
        dirty.join("\n  ")
    );

    let (mut blind, mut unexercised) = (Vec::new(), Vec::new());
    for rule in &rules {
        assert!(
            !rule.mutate.is_empty(),
            "{} has no `-- mutate:` line",
            rule.id
        );
        let mut tx = pool.begin().await.unwrap_or_else(|e| panic!("begin: {e}"));
        let before = fingerprint(&mut tx, rule)
            .await
            .unwrap_or_else(|error| panic!("{} before: {error}", rule.id));
        // Triggers and foreign keys off: the corruption this simulates is the
        // kind that did not come through the guards. CHECKs still hold, so a
        // mutation has to be a corruption the schema can physically store.
        sqlx::query("SET LOCAL session_replication_role = replica")
            .execute(&mut *tx)
            .await
            .unwrap_or_else(|error| panic!("replica role: {error}"));
        let mut touched = 0;
        for statement in &rule.mutate {
            touched += sqlx::query(statement)
                .execute(&mut *tx)
                .await
                .unwrap_or_else(|error| panic!("{} mutate `{statement}`: {error}", rule.id))
                .rows_affected();
        }
        let after = fingerprint(&mut tx, rule)
            .await
            .unwrap_or_else(|error| panic!("{} after: {error}", rule.id));
        tx.rollback()
            .await
            .unwrap_or_else(|e| panic!("rollback: {e}"));

        if touched == 0 {
            unexercised.push(rule.id.clone());
        } else if before.1 == after.1 {
            blind.push(format!(
                "{}: corrupted {touched} row(s) and the findings did not change ({} before and after)",
                rule.id, before.0
            ));
        }
    }
    assert!(
        blind.is_empty(),
        "checks that cannot go red:\n  {}",
        blind.join("\n  ")
    );

    let listed: Vec<&str> = NOT_EXERCISED.iter().map(|(id, _)| *id).collect();
    let missing: Vec<&String> = unexercised
        .iter()
        .filter(|id| !listed.contains(&id.as_str()))
        .collect();
    let stale: Vec<&&str> = listed
        .iter()
        .filter(|id| !unexercised.iter().any(|u| u == *id))
        .collect();
    assert!(
        missing.is_empty(),
        "the fixture gave these rules nothing to corrupt; give it data or list them in NOT_EXERCISED: {missing:?}"
    );
    assert!(
        stale.is_empty(),
        "NOT_EXERCISED lists rules that are now exercised: {stale:?}"
    );
}

// ---------------------------------------------------------------------------
// The estate: a little of everything, through the real writers only
// ---------------------------------------------------------------------------

fn day() -> NaiveDate {
    NaiveDate::from_ymd_opt(2026, 9, 15).unwrap_or_else(|| panic!("bad date"))
}

fn intent(kind: &str, lines: Vec<PostingLine>) -> PostingIntent {
    PostingIntent {
        posting_date: day(),
        source_kind: kind.into(),
        source_id: Some(Uuid::new_v4().to_string()),
        rule_version: "invariant_catalogue/1".into(),
        currency: "IDR".into(),
        memo: Some(format!("{kind} for the invariant catalogue")),
        lines,
    }
}

async fn post(pool: &PgPool, kind: &str, lines: Vec<PostingLine>) -> Uuid {
    let mut tx = pool.begin().await.unwrap_or_else(|e| panic!("begin: {e}"));
    let posted = cloud::post(&mut tx, &intent(kind, lines), None, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("{kind} must post: {error}"));
    tx.commit().await.unwrap_or_else(|e| panic!("commit: {e}"));
    posted.entry_id
}

fn account(code: &str) -> LineAccount {
    LineAccount::Account {
        account_code: code.into(),
        category_code: None,
    }
}

async fn build_an_estate(pool: &PgPool) {
    cloud::open_period(pool, 2026, 9)
        .await
        .unwrap_or_else(|error| panic!("open period: {error}"));
    books(pool).await;
    goods(pool).await;
    shop_facts(pool).await;
    money(pool).await;
}

/// A cash sale, a remittance in its two affiliate halves, a supplier bill at
/// head office, and a reversal.
async fn books(pool: &PgPool) {
    let sale = post(
        pool,
        "SALE_DAY",
        vec![
            PostingLine::debit("cash", STORE, 100_000),
            PostingLine::credit("revenue_cash", STORE, 100_000),
        ],
    )
    .await;

    post(
        pool,
        "STORE_DEPOSIT",
        vec![
            PostingLine::debit("affiliate_receivable", STORE, 100_000)
                .with_qualifier("PEMBIAYAAN")
                .with_counter_unit(HO),
            PostingLine::credit("cash", STORE, 100_000),
        ],
    )
    .await;
    cloud::describe_account(
        pool,
        &cloud::DescribeBankAccountRequest {
            ledger_account_code: "1005".into(),
            unit_id: HO.into(),
            bank_code: Some("BCA".into()),
            bank_name: String::new(),
            account_no: "8880012345".into(),
            account_holder: "PT Contoh".into(),
            branch: None,
            kind: "GIRO".into(),
            is_primary: Some(true),
            note: None,
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("bank account: {error}"));
    post(
        pool,
        "STORE_DEPOSIT",
        vec![
            PostingLine::debit("bank_giro", HO, 100_000).with_qualifier("BCA"),
            PostingLine::credit("affiliate_payable", HO, 100_000)
                .with_qualifier("PEMBIAYAAN")
                .with_counter_unit(STORE),
        ],
    )
    .await;

    // A supplier payable, which is head office's alone (I4).
    post(
        pool,
        "MANUAL",
        vec![
            PostingLine::debit("inventory", HO, 50_000),
            PostingLine::credit(account("2002"), HO, 50_000),
        ],
    )
    .await;

    // A shop's promotion spend under a STOP budget. Nothing in the estate
    // writes `budget` — it is set by hand today — so neither does this.
    sqlx::query(
        "INSERT INTO budget (budget_id, unit_id, account_code, period_start, period_end,
                             amount_minor, on_exceed, effective_from, set_by)
         VALUES ($1, $2, '6006', '2026-09-01', '2026-09-30', 1000000, 'STOP', '2026-09-01', $3)",
    )
    .bind(Uuid::new_v4())
    .bind(STORE)
    .bind(ACTOR)
    .execute(pool)
    .await
    .unwrap_or_else(|error| panic!("budget: {error}"));
    post(
        pool,
        "STORE_EXPENSE",
        vec![
            PostingLine::debit(account("6006"), STORE, 10_000),
            PostingLine::credit("cash", STORE, 10_000),
        ],
    )
    .await;

    let mut tx = pool.begin().await.unwrap_or_else(|e| panic!("begin: {e}"));
    cloud::reverse(&mut tx, sale, day(), "invariant catalogue", ACTOR)
        .await
        .unwrap_or_else(|error| panic!("reverse: {error}"));
    tx.commit().await.unwrap_or_else(|e| panic!("commit: {e}"));
}

/// A cost layer received at a shop and part of it sold; one unit moved from
/// the warehouse to the floor on the centre's own movement ledger.
async fn goods(pool: &PgPool) {
    let article = Uuid::new_v4();
    let sku = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO article (id, article_code, name) VALUES ($1, 'ART-INV', 'Kemeja Invarian')",
    )
    .bind(article)
    .execute(pool)
    .await
    .unwrap_or_else(|error| panic!("article: {error}"));
    sqlx::query("INSERT INTO sku (id, article_id, sku_code) VALUES ($1, $2, 'ART-INV-M')")
        .bind(sku)
        .bind(article)
        .execute(pool)
        .await
        .unwrap_or_else(|error| panic!("sku: {error}"));
    let shop_pool: String = sqlx::query_scalar(
        "SELECT id FROM operational_pool WHERE site_id = $1 ORDER BY id LIMIT 1",
    )
    .bind(STORE)
    .fetch_optional(pool)
    .await
    .unwrap_or_else(|error| panic!("pool: {error}"))
    .unwrap_or_else(|| "dc.warehouse".to_string());

    let mut tx = pool.begin().await.unwrap_or_else(|e| panic!("begin: {e}"));
    cloud::cost_layer_create(
        &mut tx,
        &NewCostLayer {
            article_id: article,
            quantity: 10,
            gross_cost_minor: 10_000,
            discount_minor: 0,
            economic_date: day(),
            site_id: STORE.into(),
            to_pool_id: shop_pool.clone(),
            receipt_id: None,
            receipt_line_id: None,
            source_reference: Some("GRN-INV".into()),
            supplier_id: None,
            source_kind: "GOODS_RECEIPT".into(),
            source_id: Uuid::new_v4().to_string(),
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("layer: {error}"));
    tx.commit().await.unwrap_or_else(|e| panic!("commit: {e}"));

    let mut tx = pool.begin().await.unwrap_or_else(|e| panic!("begin: {e}"));
    cloud::stock_ledger_consume(
        &mut tx,
        &StockOutflow {
            article_id: article,
            sku_id: Some(sku),
            epc: None,
            lot_reference: None,
            quantity: 3,
            event_kind: "SALE".into(),
            event_id: "SALE-INV".into(),
            from_pool_id: shop_pool,
            site_id: STORE.into(),
            economic_date: day(),
            source_id: "SALE-INV".into(),
            memo: None,
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("consume: {error}"));
    tx.commit().await.unwrap_or_else(|e| panic!("commit: {e}"));

    cloud::create_movement(
        pool,
        CreateMovementRequest {
            idempotency_key: "invariant-move-1".into(),
            actor_id: ACTOR.into(),
            occurred_at: None,
            reason: "invariant catalogue".into(),
            reference_type: Some("TEST".into()),
            reference_id: Some("INV-001".into()),
            cause: Some("NORMAL_MOVE".into()),
            lines: vec![MovementLineRequest {
                subject_id: None,
                epc: Some("EPC00000006".into()),
                quantity: 1,
                from: "store-07.warehouse:on_hand".into(),
                to: "store-07.floor:on_hand".into(),
            }],
        },
    )
    .await
    .unwrap_or_else(|error| panic!("movement: {error}"));
}

/// Two shops on the sync protocol: a stock movement and a sale with a
/// campaign and a member on it, ingested and applied the way a till's upload
/// is; and the campaign's budget split between them.
async fn shop_facts(pool: &PgPool) {
    for origin in ["store-12", "store-13"] {
        cloud::register_origin_credential_binding(
            pool,
            origin,
            &format!("{origin}-invariant-catalogue-sync-key-01"),
            Some(origin),
            Some(origin),
            Some("STORE"),
            Some(1),
            Some(true),
        )
        .await
        .unwrap_or_else(|error| panic!("register {origin}: {error}"));
    }
    cloud::enrol_member(pool, "M-INV", Some("Anggota Invarian"))
        .await
        .unwrap_or_else(|error| panic!("member: {error}"));

    let created = cloud::create_commercial_publication(
        pool,
        CreateCommercialPublicationRequest {
            change_type: None,
            version: 7_001,
            name: "Kampanye invarian".into(),
            effective_from: Utc::now() - Duration::days(1),
            effective_to: None,
            tax_rules: Vec::new(),
            offer_rules: Vec::new(),
            markdowns: Vec::new(),
            rules: Vec::new(),
            coupons: Vec::new(),
            campaigns: vec![CommercialCampaignInput {
                campaign_id: "LEBARAN".into(),
                name: "Lebaran".into(),
                status: "ACTIVE".into(),
                valid_from: None,
                valid_to: None,
                budget_minor: Some(1_000_000),
                max_uses: None,
                site_ids: Vec::new(),
                image_url: None,
                headline: None,
                terms: None,
            }],
            actor_id: ACTOR.into(),
            idempotency_key: "invariant-draft".into(),
        },
    )
    .await
    .unwrap_or_else(|error| panic!("draft: {error}"));
    let id: Uuid = created["id"]
        .as_str()
        .and_then(|raw| raw.parse().ok())
        .unwrap_or_else(|| panic!("no id in {created}"));
    cloud::publish_commercial_publication(
        pool,
        id,
        CommandRequest {
            actor_id: ACTOR.into(),
            idempotency_key: "invariant-publish".into(),
        },
    )
    .await
    .unwrap_or_else(|error| panic!("publish: {error}"));

    let subject: Uuid =
        sqlx::query_scalar("SELECT id FROM inventory_subject WHERE epc = 'EPC00000011'")
            .fetch_one(pool)
            .await
            .unwrap_or_else(|error| panic!("seeded subject: {error}"));
    let receive = Uuid::new_v4();
    let facts = vec![
        SyncFact {
            seq: 1,
            event_id: receive,
            event_type: "inventory.movement".into(),
            payload: json!({
                "movement_group_id": receive,
                "cause": "STORE_RECEIVE",
                "reason": "invariant catalogue",
                "reference_type": null,
                "reference_id": null,
                "actor_id": "till-1",
                "occurred_at": Utc::now(),
                "lines": [{
                    "subject_id": subject,
                    "quantity": 1,
                    "from_place_id": "system/opening",
                    "to_place_id": "store-12.warehouse:on_hand",
                }],
            }),
            created_at: Utc::now(),
        },
        SyncFact {
            seq: 2,
            event_id: Uuid::new_v4(),
            event_type: FACT_SALES_COMPLETED.into(),
            payload: json!({
                "sale_id": Uuid::new_v4(),
                "movement_group_id": Uuid::new_v4(),
                "site_id": "store-12",
                "actor_id": "kasir-1",
                "occurred_at": Utc::now(),
                "currency": "IDR",
                "total_minor": 250_000,
                "paid_minor": 250_000,
                "change_minor": 0,
                "lines": [{
                    "subject_id": Uuid::new_v4(),
                    "epc": "EPC-INV-SALE",
                    "sku_code": "MINYAK-2L",
                    "quantity": 1,
                    "unit_price_minor": 250_000,
                }],
                "discount_total_minor": 50_000,
                "points_earned": 500,
                "customer_id": "M-INV",
                "promotions": [{
                    "rule_id": "R-LEBARAN",
                    "campaign_id": "LEBARAN",
                    "coupon_code": null,
                    "benefit_minor": 50_000,
                    "lines": [],
                }],
            }),
            created_at: Utc::now(),
        },
    ];
    cloud::ingest_batch(
        pool,
        &IngestBatch {
            origin_id: "store-12".into(),
            generation: 1,
            facts,
            command_watermark: 0,
            command_blocked: None,
        },
    )
    .await
    .unwrap_or_else(|error| panic!("ingest: {error}"));
    let applied = cloud::apply_pending(pool, 200)
        .await
        .unwrap_or_else(|error| panic!("apply: {error}"));
    assert!(
        applied.blocked.is_empty(),
        "apply blocked: {:?}",
        applied.blocked
    );

    cloud::set_cap_allocation(
        pool,
        "CAMPAIGN",
        "LEBARAN",
        cloud::CapAllocationRequest { enabled: true },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("split: {error}"));
}

/// A gift card issued, part-redeemed and held at a checkout; the member's
/// points spent on a voucher.
async fn money(pool: &PgPool) {
    let card = cloud::issue_voucher(
        pool,
        IssueVoucherRequest {
            code: None,
            kind: "GIFT_CARD".into(),
            value_minor: 100_000,
            currency: None,
            member_id: None,
            expires_at: None,
            site_id: None,
            note: None,
        },
        ACTOR,
        "invariant-issue",
        "invariant-issue-digest",
    )
    .await
    .unwrap_or_else(|error| panic!("issue: {error}"));
    cloud::redeem_voucher(
        pool,
        &card.code,
        RedeemVoucherRequest {
            amount_minor: 30_000,
            sale_id: None,
            site_id: None,
            note: None,
        },
        ACTOR,
        "invariant-redeem",
        "invariant-redeem-digest",
    )
    .await
    .unwrap_or_else(|error| panic!("redeem: {error}"));
    cloud::authorize_voucher(
        pool,
        &card.code,
        AuthorizeVoucherRequest {
            checkout_id: "CHECKOUT-INV".into(),
            amount_minor: 20_000,
            site_id: Some(STORE.into()),
            actor_id: ACTOR.into(),
            hold_seconds: Some(3_600),
        },
    )
    .await
    .unwrap_or_else(|error| panic!("hold: {error}"));

    cloud::redeem_points_to_voucher(
        pool,
        RedeemPointsRequest {
            customer_id: "M-INV".into(),
            points: 200,
            voucher_value_minor: 200,
            actor_id: ACTOR.into(),
            idempotency_key: "invariant-points".into(),
            expires_at: None,
        },
    )
    .await
    .unwrap_or_else(|error| panic!("points: {error}"));
}
