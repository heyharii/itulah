//! A file in a folder becomes a statement in the books, exactly once.
//!
//! The unit tests in `cloud::domain::statement_intake` and `cloud::intake::parse`
//! prove the two decisions and the reader. What they cannot prove is the thing
//! the gateway exists for: that a second pass over the same folder imports
//! nothing, that a file nobody claimed leaves a trace, and that a rule with a
//! wrong mapping fails in a way somebody can read. All three need the tables.
//!
//! The source here is a directory rather than a mailbox, and that is not a
//! shortcut — it is the deployment most clients start on, and `DirSource` and
//! `ImapSource` differ only in where a `Message` comes from.

use inventory_backend::cloud::intake::{dir::DirSource, Gateway};
use inventory_backend::cloud::postgres::{self as cloud, SaveStatementSourceRequest};
use serde_json::json;
use sqlx::{PgPool, Row};
use std::path::PathBuf;

const ACTOR: &str = "ana";
/// The client's own giro account at BCA, a postable leaf under `1011002 BANK`.
///
/// Not seeded here: since 0243 the chart is written by the migrations and is
/// the client's, so a test that minted its own `…00100` leaf would be inventing
/// an account the books do not have — and 0244's
/// `ledger_account_carries_no_unit` would refuse it for naming a unit besides.
const GIRO: &str = "1011002001";

/// A folder of this test's own, emptied first so a rerun is a fresh run.
fn folder(name: &str) -> PathBuf {
    let path = std::env::temp_dir().join(format!("itulah-intake-{name}"));
    let _ = std::fs::remove_dir_all(&path);
    let _ = std::fs::create_dir_all(&path);
    path
}

const KORAN: &str = "\
Tanggal,Keterangan,Ref,Debet,Kredit,Saldo
01/06/2026,SETORAN TUNAI,TRF001,,\"5.000.000,00\",\"15.000.000,00\"
02/06/2026,BIAYA ADMIN BULANAN,,\"25.000,00\",,\"14.975.000,00\"
";

fn csv_mapping() -> serde_json::Value {
    json!({
        "columns": {
            "value_date": "Tanggal",
            "description": "Keterangan",
            "reference": "Ref",
            "debit": "Debet",
            "credit": "Kredit",
            "balance": "Saldo"
        }
    })
}

async fn add_source(
    pool: &PgPool,
    label: &str,
    from: &str,
    filename: &str,
    settings: serde_json::Value,
) {
    cloud::save_statement_source(
        pool,
        None,
        &SaveStatementSourceRequest {
            label: label.into(),
            enabled: true,
            account_code: GIRO.into(),
            site_id: "ho".into(),
            from_pattern: from.into(),
            subject_pattern: String::new(),
            filename_pattern: filename.into(),
            format: "CSV".into(),
            settings,
            priority: 100,
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("save source: {error}"));
}

fn gateway(pool: &PgPool, folder: &PathBuf) -> Gateway {
    Gateway::new(pool.clone(), Box::new(DirSource::new(folder.clone())))
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_dropped_file_becomes_a_statement_and_a_second_pass_imports_nothing(pool: PgPool) {
    add_source(&pool, "BCA giro", "klikbca", "*.csv", csv_mapping()).await;

    let folder = folder("happy");
    let _ = std::fs::write(folder.join("rk-juni.csv"), KORAN);
    let _ = std::fs::write(
        folder.join("rk-juni.csv.meta.json"),
        br#"{"from":"no-reply@klikbca.co.id","subject":"Rekening Koran"}"#,
    );

    let stats = gateway(&pool, &folder)
        .run_once()
        .await
        .unwrap_or_else(|error| panic!("first pass: {error}"));
    assert_eq!(stats.ingested, 1, "the file was claimed and read");
    assert_eq!(stats.lines, 2);
    assert_eq!(stats.skipped, 0);

    // The list answers with an envelope now — rows, a cursor, a total and
    // facet counts — the shape every other finance list answers in.
    let statements = cloud::bank_statement_page(&pool, Default::default())
        .await
        .unwrap_or_else(|error| panic!("{error}"))
        .rows;
    assert_eq!(statements.len(), 1);
    assert_eq!(statements[0].account_code, GIRO);
    // The window is the span of the lines, not of the filename or of today.
    assert_eq!(statements[0].period_start.to_string(), "2026-06-01");
    assert_eq!(statements[0].period_end.to_string(), "2026-06-02");
    // 15.000.000 after a 5.000.000 credit means 10.000.000 before it, and the
    // ledger has to walk from one to the other.
    assert_eq!(statements[0].opening_minor, 10_000_000);
    assert_eq!(statements[0].closing_minor, 14_975_000);
    assert_eq!(statements[0].imported_by, "system:statement-intake");

    // The same folder again. The file is still there — nothing moves it — and
    // this is the whole reason `bank_statement_intake` exists.
    let stats = gateway(&pool, &folder)
        .run_once()
        .await
        .unwrap_or_else(|error| panic!("second pass: {error}"));
    assert_eq!(stats.already_seen, 1);
    assert_eq!(stats.ingested, 0);
    assert_eq!(
        cloud::bank_statement_page(&pool, Default::default())
            .await
            .map(|page| page.total)
            .unwrap_or_default(),
        1,
        "a second pass must not produce a second statement"
    );

    let _ = std::fs::remove_dir_all(&folder);
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_file_no_rule_wanted_leaves_a_trace_rather_than_vanishing(pool: PgPool) {
    add_source(&pool, "BCA giro", "klikbca", "*.csv", csv_mapping()).await;

    let folder = folder("unmatched");
    // Right shape, wrong sender: the rule wants klikbca and the sidecar says
    // somebody else.
    let _ = std::fs::write(folder.join("mystery.csv"), KORAN);
    let _ = std::fs::write(
        folder.join("mystery.csv.meta.json"),
        br#"{"from":"newsletter@example.com","subject":"Promo"}"#,
    );

    let stats = gateway(&pool, &folder)
        .run_once()
        .await
        .unwrap_or_else(|error| panic!("{error}"));
    assert_eq!(stats.skipped, 1);
    assert_eq!(stats.ingested, 0);

    let log = cloud::recent_statement_intake(&pool, 10)
        .await
        .unwrap_or_else(|error| panic!("{error}"));
    assert_eq!(log.len(), 1);
    assert_eq!(log[0].status, "skipped_no_match");
    assert_eq!(log[0].filename, "mystery.csv");
    assert_eq!(log[0].sender, "newsletter@example.com");
    assert!(log[0].source_id.is_none());

    let _ = std::fs::remove_dir_all(&folder);
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_rule_that_claims_a_file_it_cannot_read_says_which_column_is_missing(pool: PgPool) {
    // A mapping that passes validation — it names a date and an amount — but
    // names a column this particular file does not have.
    add_source(
        &pool,
        "BCA giro",
        "klikbca",
        "*.csv",
        json!({
            "columns": {
                "value_date": "Tanggal",
                "description": "Keterangan",
                "debit": "Pengeluaran",
                "credit": "Pemasukan"
            }
        }),
    )
    .await;

    let folder = folder("mismapped");
    let _ = std::fs::write(folder.join("rk.csv"), KORAN);
    let _ = std::fs::write(
        folder.join("rk.csv.meta.json"),
        br#"{"from":"no-reply@klikbca.co.id"}"#,
    );

    let stats = gateway(&pool, &folder)
        .run_once()
        .await
        .unwrap_or_else(|error| panic!("{error}"));
    assert_eq!(stats.failed, 1);
    assert_eq!(stats.ingested, 0);

    let log = cloud::recent_statement_intake(&pool, 10)
        .await
        .unwrap_or_default();
    assert_eq!(log[0].status, "unparsed");
    // The complaint names the column that is missing AND the ones the file
    // has, because that is what turns a failure into a one-line fix.
    assert!(log[0].detail.contains("Pengeluaran"), "{}", log[0].detail);
    assert!(log[0].detail.contains("Debet"), "{}", log[0].detail);
    // Nothing was imported, so nothing is half-imported.
    assert!(cloud::bank_statement_page(&pool, Default::default())
        .await
        .unwrap_or_else(|error| panic!("{error}"))
        .rows
        .is_empty());

    let _ = std::fs::remove_dir_all(&folder);
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn the_lines_land_where_the_matcher_will_look_for_them(pool: PgPool) {
    add_source(&pool, "BCA giro", "", "*.csv", csv_mapping()).await;

    let folder = folder("lines");
    let _ = std::fs::write(folder.join("rk.csv"), KORAN);
    gateway(&pool, &folder)
        .run_once()
        .await
        .unwrap_or_else(|error| panic!("{error}"));

    let statements = cloud::bank_statement_page(&pool, Default::default())
        .await
        .unwrap_or_else(|error| panic!("{error}"))
        .rows;
    let lines = cloud::statement_lines(&pool, statements[0].statement_id)
        .await
        .unwrap_or_else(|error| panic!("{error}"));
    assert_eq!(lines.len(), 2);
    // A credit on the bank's statement is money arriving; a debit is money
    // leaving. The matcher reads exactly this.
    assert_eq!(lines[0].credit_minor, 5_000_000);
    assert_eq!(lines[0].debit_minor, 0);
    assert_eq!(lines[0].reference.as_deref(), Some("TRF001"));
    assert_eq!(lines[1].debit_minor, 25_000);
    assert!(lines
        .iter()
        .all(|line| line.matched_journal_line_id.is_none()));

    let _ = std::fs::remove_dir_all(&folder);
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_rule_with_a_mapping_that_cannot_work_is_refused_at_the_screen(pool: PgPool) {
    let refused = cloud::save_statement_source(
        &pool,
        None,
        &SaveStatementSourceRequest {
            label: "half a rule".into(),
            enabled: true,
            account_code: GIRO.into(),
            site_id: "ho".into(),
            from_pattern: String::new(),
            subject_pattern: String::new(),
            filename_pattern: String::new(),
            format: "CSV".into(),
            // A date and nothing to put against it.
            settings: json!({ "columns": { "value_date": "Tanggal" } }),
            priority: 100,
        },
        ACTOR,
    )
    .await;
    assert!(
        refused.is_err(),
        "a rule with no amount column must not save"
    );

    // And nothing was written, so the list is not showing a rule that cannot
    // run.
    let count: i64 = sqlx::query("SELECT count(*)::bigint AS n FROM bank_statement_source")
        .fetch_one(&pool)
        .await
        .and_then(|row| row.try_get("n"))
        .unwrap_or(-1);
    assert_eq!(count, 0);
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn deleting_a_rule_keeps_the_record_of_what_it_already_took(pool: PgPool) {
    add_source(&pool, "BCA giro", "", "*.csv", csv_mapping()).await;

    let folder = folder("deleted");
    let _ = std::fs::write(folder.join("rk.csv"), KORAN);
    gateway(&pool, &folder)
        .run_once()
        .await
        .unwrap_or_else(|error| panic!("{error}"));

    let sources = cloud::list_statement_sources(&pool)
        .await
        .unwrap_or_default();
    cloud::delete_statement_source(&pool, sources[0].source_id)
        .await
        .unwrap_or_else(|error| panic!("{error}"));

    // The history survives the rule. If it did not, the same file would be
    // imported all over again by whatever rule replaced it.
    let log = cloud::recent_statement_intake(&pool, 10)
        .await
        .unwrap_or_default();
    assert_eq!(log.len(), 1);
    assert_eq!(log[0].status, "ingested");
    assert!(log[0].source_id.is_none(), "the reference is released");

    let stats = gateway(&pool, &folder)
        .run_once()
        .await
        .unwrap_or_else(|error| panic!("{error}"));
    assert_eq!(stats.already_seen, 1);
    assert_eq!(stats.ingested, 0);

    let _ = std::fs::remove_dir_all(&folder);
}
