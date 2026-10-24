//! Who signed in at the store's POS, when, where and how (owner, 24 Oct
//! 2026: head office sees each person's activity at the store). Written by
//! the sign-in routes (`http.rs`: a password, a finger, a PIN, the store head
//! opening the POS for somebody), read into the heartbeat
//! (`NodeStatus::sign_ins`) and from there onto the person's page in the hub.
//!
//! Best effort: a sign-in that could not be written down is logged and the
//! person is still let in — the till must not stop selling for an activity
//! line.

use chrono::{DateTime, Duration, SecondsFormat, Utc};
use rusqlite::{params, Connection};

use crate::sync::node_status::SignInFact;

pub const PASSWORD: &str = "PASSWORD";
pub const FINGER: &str = "FINGER";
pub const PIN: &str = "PIN";
pub const ON_BEHALF: &str = "ON_BEHALF";

/// How long a line is kept here, and how far back the heartbeat reaches.
const KEPT_DAYS: i64 = 30;
const REPORTED_HOURS: i64 = 48;
/// The most lines one heartbeat carries.
const REPORTED_MAX: i64 = 200;

fn stamp(at: DateTime<Utc>) -> String {
    at.to_rfc3339_opts(SecondsFormat::Micros, true)
}

/// Write one sign-in down, and let go of lines older than a month.
pub fn record(
    connection: &Connection,
    username: &str,
    method: &str,
    terminal: Option<&str>,
    by: Option<&str>,
) {
    let now = Utc::now();
    let terminal = terminal
        .map(str::trim)
        .filter(|terminal| !terminal.is_empty());
    let written = connection
        .execute(
            "INSERT INTO edge_sign_in (username, at, method, terminal, by_username)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                username.trim().to_ascii_lowercase(),
                stamp(now),
                method,
                terminal,
                by
            ],
        )
        .and_then(|_| {
            connection.execute(
                "DELETE FROM edge_sign_in WHERE at < ?1",
                params![stamp(now - Duration::days(KEPT_DAYS))],
            )
        });
    if let Err(error) = written {
        tracing::warn!(%error, username, method, "a sign-in was not written down");
    }
}

/// The last two days' sign-ins, newest first, for the heartbeat.
pub fn recent(connection: &Connection) -> Vec<SignInFact> {
    let since = stamp(Utc::now() - Duration::hours(REPORTED_HOURS));
    let read = connection
        .prepare(
            "SELECT username, at, method, terminal, by_username FROM edge_sign_in
              WHERE at >= ?1 ORDER BY at DESC LIMIT ?2",
        )
        .and_then(|mut statement| {
            statement
                .query_map(params![since, REPORTED_MAX], |row| {
                    let at: String = row.get(1)?;
                    Ok((
                        row.get::<_, String>(0)?,
                        at,
                        row.get::<_, String>(2)?,
                        row.get::<_, Option<String>>(3)?,
                        row.get::<_, Option<String>>(4)?,
                    ))
                })?
                .collect::<Result<Vec<_>, _>>()
        });
    match read {
        Ok(rows) => rows
            .into_iter()
            .filter_map(|(username, at, method, terminal, by)| {
                let at = DateTime::parse_from_rfc3339(&at).ok()?.with_timezone(&Utc);
                Some(SignInFact {
                    username,
                    at,
                    method,
                    terminal,
                    by,
                })
            })
            .collect(),
        Err(error) => {
            tracing::warn!(%error, "sign-ins not read for the heartbeat");
            Vec::new()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_sign_in_is_written_down_and_reported_newest_first() {
        let connection = Connection::open_in_memory().unwrap_or_else(|error| panic!("{error}"));
        connection
            .execute_batch(crate::edge::sqlite::SIGN_IN_SCHEMA)
            .unwrap_or_else(|error| panic!("{error}"));
        record(&connection, "Wira", PASSWORD, Some("KASIR-1"), None);
        record(&connection, "wira", ON_BEHALF, Some(" "), Some("wulan"));
        let recent = recent(&connection);
        assert_eq!(recent.len(), 2);
        assert_eq!(recent[0].method, ON_BEHALF);
        assert_eq!(recent[0].username, "wira");
        assert_eq!(recent[0].terminal, None);
        assert_eq!(recent[0].by.as_deref(), Some("wulan"));
        assert_eq!(recent[1].terminal.as_deref(), Some("KASIR-1"));
    }
}
