//! The shop's payment methods (cloud 0474; ERPNext Mode of Payment, per shop).
//!
//! Head office sets up which payment methods each shop takes; the list arrives
//! whole as `payment.methods.replace` and is kept here. The tills read it from
//! `GET /api/v1/store/payment-methods` instead of carrying their own tender
//! list, and a sale whose tender is not on it is refused — a shop cannot take a
//! wallet Finance never set up for it, and so cannot post one nowhere.
//!
//! A node that has never been sent a list (the cloud publishes only once
//! Finance turns `sync.publish_payment_methods` on) keeps taking the tenders it
//! always took: an empty list is "not set up yet", not "take nothing".

use rusqlite::{params, Connection, Transaction};

use super::contracts::EdgeError;
use crate::cloud::domain::{PaymentMethodBook, TillPaymentMethod};
use crate::tender::SaleTender;

fn db(error: rusqlite::Error) -> EdgeError {
    super::sqlite::db(error)
}

/// The shop's list, and the tender and refund tables learning the e-wallet.
///
/// SQLite cannot alter a CHECK, so each table is rebuilt from its own
/// definition — read from `sqlite_master` and `pragma_table_info` rather than
/// written out here, because other columns keep being added to them and a
/// rebuild that names them by hand drops the next one.
pub(crate) fn apply_schema(connection: &Connection) -> Result<(), EdgeError> {
    connection
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS till_payment_method (
                 code            TEXT PRIMARY KEY,
                 name            TEXT NOT NULL,
                 tender_type     TEXT NOT NULL,
                 bank_code       TEXT NOT NULL DEFAULT '',
                 settlement_mode TEXT NOT NULL,
                 position        INTEGER NOT NULL,
                 received_at     TEXT NOT NULL
             );",
        )
        .map_err(db)?;
    widen_check(connection, "sale_tender", "'VOUCHER')", "'VOUCHER','EWALLET')")?;
    widen_check(connection, "sale_return", "'QRIS','OTHER')", "'QRIS','OTHER','EWALLET')")?;
    Ok(())
}

/// Rebuild `table` with `from` replaced by `to` in its definition, once. The
/// same shape as the subject rebuild in `sqlite.rs`: foreign keys off around
/// the swap, because `sale_return` has children and the drop would otherwise
/// refuse.
fn widen_check(connection: &Connection, table: &str, from: &str, to: &str) -> Result<(), EdgeError> {
    let definition: Option<String> = connection
        .query_row(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name=?1",
            [table],
            |row| row.get(0),
        )
        .ok();
    let Some(definition) = definition else {
        return Ok(());
    };
    if definition.contains("EWALLET") || !definition.contains(from) {
        return Ok(());
    }
    let rebuilt = format!("{table}_widened");
    let widened = definition.replacen(from, to, 1).replacen(table, &rebuilt, 1);
    let columns: Vec<String> = {
        let mut statement = connection
            .prepare("SELECT name FROM pragma_table_info(?1) ORDER BY cid")
            .map_err(db)?;
        let rows = statement
            .query_map([table], |row| row.get::<_, String>(0))
            .map_err(db)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(db)?
    };
    let indexes: Vec<String> = {
        let mut statement = connection
            .prepare(
                "SELECT sql FROM sqlite_master
                  WHERE type='index' AND tbl_name=?1 AND sql IS NOT NULL",
            )
            .map_err(db)?;
        let rows = statement
            .query_map([table], |row| row.get::<_, String>(0))
            .map_err(db)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(db)?
    };
    let list = columns.join(", ");
    let indexes = indexes
        .iter()
        // Dropped with the old table, so each is created again as written.
        .map(|index| format!("{index};"))
        .collect::<Vec<_>>()
        .join("\n");
    connection
        .execute_batch(&format!(
            "PRAGMA foreign_keys=OFF;
             BEGIN IMMEDIATE;
             {widened};
             INSERT INTO {rebuilt} ({list}) SELECT {list} FROM {table};
             DROP TABLE {table};
             ALTER TABLE {rebuilt} RENAME TO {table};
             {indexes}
             COMMIT;
             PRAGMA foreign_keys=ON;"
        ))
        .map_err(db)?;
    Ok(())
}

/// Replace the shop's list with the one head office sent.
pub(crate) fn replace_book(tx: &Transaction<'_>, book: &PaymentMethodBook) -> Result<(), EdgeError> {
    let now = chrono::Utc::now().to_rfc3339();
    tx.execute("DELETE FROM till_payment_method", []).map_err(db)?;
    for (position, method) in book.methods.iter().enumerate() {
        tx.execute(
            "INSERT INTO till_payment_method
                 (code, name, tender_type, bank_code, settlement_mode, position, received_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                method.code,
                method.name,
                method.tender_type,
                method.bank_code,
                method.settlement_mode,
                position as i64,
                now
            ],
        )
        .map_err(db)?;
    }
    Ok(())
}

/// The shop's payment methods, in head office's order.
pub(crate) fn list(connection: &Connection) -> Result<Vec<TillPaymentMethod>, EdgeError> {
    let mut statement = connection
        .prepare(
            "SELECT code, name, tender_type, bank_code, settlement_mode
               FROM till_payment_method ORDER BY position",
        )
        .map_err(db)?;
    let rows = statement
        .query_map([], |row| {
            Ok(TillPaymentMethod {
                code: row.get(0)?,
                name: row.get(1)?,
                tender_type: row.get(2)?,
                bank_code: row.get(3)?,
                settlement_mode: row.get(4)?,
            })
        })
        .map_err(db)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(db)
}

/// Refuse a tender the shop was not set up to take. Nothing is refused while
/// the shop has no list yet.
pub(crate) fn assert_accepted(connection: &Connection, tenders: &[SaleTender]) -> Result<(), EdgeError> {
    let methods = list(connection)?;
    if methods.is_empty() {
        return Ok(());
    }
    for tender in tenders {
        let method = tender.method.as_str();
        let acquirer = tender
            .acquirer
            .as_deref()
            .map(|value| value.trim().to_ascii_uppercase())
            .unwrap_or_default();
        let kind = tender
            .card_kind
            .as_deref()
            .map(|value| value.trim().to_ascii_uppercase());
        let taken = methods.iter().any(|candidate| match candidate.wire() {
            Some((wire, wire_kind)) if wire == method => {
                let bank_matches = match method {
                    "CARD" | "QRIS" | "EWALLET" => {
                        acquirer.is_empty() || candidate.bank_code.eq_ignore_ascii_case(&acquirer)
                    }
                    _ => true,
                };
                let kind_matches = match (wire_kind, kind.as_deref()) {
                    (Some(expected), Some(given)) => expected == given,
                    _ => true,
                };
                bank_matches && kind_matches
            }
            _ => false,
        });
        if !taken {
            return Err(EdgeError::Validation(format!(
                "this shop does not take {method}{}; head office sets up the shop's payment \
                 methods",
                if acquirer.is_empty() {
                    String::new()
                } else {
                    format!(" through {acquirer}")
                }
            )));
        }
    }
    Ok(())
}
