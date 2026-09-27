//! What this node knows about its own site and the others — from head office.
//!
//! Owner's ruling, 2026-09-27: nothing derives meaning from an id. A node has
//! no `site` table, so before this it read everything about where it stood
//! off the spelling of its own id. Head office now sends its `site` rows with
//! the auth policy (`cloud::domain::SiteProfile`), and `site_directory`
//! (0049) keeps the latest copy.
//!
//! Every reader here has an answer for a node that has not heard yet — an
//! older centre, a node enrolled five minutes ago — and that answer is what
//! the node did before: Asia/Jakarta's offset, and the site id where a code
//! would go. A missing directory must never stop a till or a printer.

use crate::cloud::domain::SiteProfile;
use crate::ids::SiteKind;
use crate::reporting::DEFAULT_UTC_OFFSET_MINUTES;
use rusqlite::{params, Connection, OptionalExtension, Transaction};

/// One site, as the directory holds it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct KnownSite {
    pub site_id: String,
    /// `None` for a kind this build does not know.
    pub kind: Option<SiteKind>,
    pub code: Option<String>,
    pub name: String,
    pub timezone: String,
    pub utc_offset_minutes: i32,
}

impl KnownSite {
    /// What to print for this site: its display code, or its id when head
    /// office has given it none.
    pub fn display_code(&self) -> &str {
        self.code.as_deref().unwrap_or(&self.site_id)
    }
}

/// Replace the directory with what one auth policy says.
///
/// Called only for a policy newer than the one applied, so an old command
/// replayed late cannot put back a code or a clock that has since changed.
pub fn replace(
    tx: &Transaction<'_>,
    own: Option<&SiteProfile>,
    sites: &[SiteProfile],
    policy_version: i64,
    received_at: &str,
) -> rusqlite::Result<()> {
    tx.execute("DELETE FROM site_directory", [])?;
    let write = |profile: &SiteProfile, is_own: bool| {
        tx.execute(
            "INSERT INTO site_directory
                 (site_id, kind, code, name, timezone, utc_offset_minutes, is_own,
                  policy_version, received_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
             ON CONFLICT(site_id) DO UPDATE SET
                 kind = excluded.kind, code = excluded.code, name = excluded.name,
                 timezone = excluded.timezone,
                 utc_offset_minutes = excluded.utc_offset_minutes,
                 is_own = MAX(site_directory.is_own, excluded.is_own),
                 policy_version = excluded.policy_version,
                 received_at = excluded.received_at",
            params![
                profile.site_id,
                profile.kind,
                profile.code,
                profile.name,
                profile.timezone,
                profile.utc_offset_minutes.clamp(-14 * 60, 14 * 60),
                i64::from(is_own),
                policy_version,
                received_at,
            ],
        )
        .map(|_| ())
    };
    for profile in sites {
        write(profile, false)?;
    }
    if let Some(own) = own {
        write(own, true)?;
    }
    Ok(())
}

const COLUMNS: &str = "SELECT site_id, kind, code, name, timezone, utc_offset_minutes
                         FROM site_directory";

fn known_site(row: &rusqlite::Row<'_>) -> rusqlite::Result<KnownSite> {
    Ok(KnownSite {
        site_id: row.get(0)?,
        kind: SiteKind::from_code(&row.get::<_, String>(1)?),
        code: row.get(2)?,
        name: row.get(3)?,
        timezone: row.get(4)?,
        utc_offset_minutes: row.get(5)?,
    })
}

/// The site this node stands in, as head office last described it.
pub fn own(connection: &Connection) -> Option<KnownSite> {
    connection
        .query_row(&format!("{COLUMNS} WHERE is_own = 1"), [], known_site)
        .optional()
        // A database without the table (a test fixture, a half-built file) is
        // a node that has not heard, not a failure.
        .ok()
        .flatten()
}

/// Any site head office holds, by id.
pub fn known(connection: &Connection, site_id: &str) -> Option<KnownSite> {
    connection
        .query_row(
            &format!("{COLUMNS} WHERE site_id = ?1"),
            params![site_id],
            known_site,
        )
        .optional()
        .ok()
        .flatten()
}

/// Minutes east of UTC where this node's day turns over, when head office
/// has said; `None` when it has not.
pub fn own_utc_offset_minutes(connection: &Connection) -> Option<i32> {
    own(connection).map(|site| site.utc_offset_minutes)
}

/// Minutes east of UTC where this node's day turns over: its site's, or
/// Asia/Jakarta's until head office has said.
pub fn utc_offset_minutes(connection: &Connection) -> i32 {
    own_utc_offset_minutes(connection).unwrap_or(DEFAULT_UTC_OFFSET_MINUTES)
}

/// What to print for this node's own site: its display code, or `fallback`
/// (the node's site id) until head office has said.
pub fn own_display_code(connection: &Connection, fallback: &str) -> String {
    own(connection)
        .map(|site| site.display_code().to_string())
        .unwrap_or_else(|| fallback.to_string())
}

/// What to print for any site: its display code, or its id.
pub fn display_code(connection: &Connection, site_id: &str) -> String {
    known(connection, site_id)
        .map(|site| site.display_code().to_string())
        .unwrap_or_else(|| site_id.to_string())
}

/// What kind a site is, when head office has said. `None` means "not told",
/// never "not a shop" — a caller refuses only on a kind it was told.
pub fn kind_of(connection: &Connection, site_id: &str) -> Option<SiteKind> {
    known(connection, site_id).and_then(|site| site.kind)
}
