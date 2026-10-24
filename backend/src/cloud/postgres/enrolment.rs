//! Terminals, and the sealed template store.
//!
//! # Why the sealing is here and not in the domain
//!
//! Because this is where the key is. The pay module already set the precedent
//! and stated the reason: the bank account number is masked in the storage
//! layer rather than in the view, *so no caller can reach the number by asking
//! a different layer*. A biometric template is the same problem with a
//! regulator attached.
//!
//! So `seal` and `open` are private to this module, the plaintext exists only
//! inside one function at a time, and what leaves is either
//! [`SealedTemplate`] — which has no `Serialize` — or a bundle bound for one
//! terminal.
//!
//! # No key means no enrolment
//!
//! `ATTENDANCE_TEMPLATE_KEY` is 64 hex characters (32 bytes) and there is no
//! default. A deployment that has not set one cannot enrol and cannot serve a
//! sync bundle, and says so by name. The alternative — a built-in key, or
//! storing the template in the clear "for now" — is how regulated data ends up
//! unprotected in production with a comment promising to fix it.
//!
//! This is the same shape the overtime caps take: no row means no policy, which
//! refuses. An absent key is not a weaker key.

use crate::cloud::application::AppError;
use crate::cloud::domain::{
    AttendanceTerminal, Authorization, EnrolmentKind, EnrolmentRecord, Finger,
    IdentificationMethod, SealedTemplate, TemplateFormat, TerminalEvent, TerminalId,
    TerminalStatus, UnitId, TEMPLATE_NONCE_LEN,
};
use chrono::{DateTime, Utc};
use ring::aead::{Aad, LessSafeKey, Nonce, UnboundKey, CHACHA20_POLY1305};
use ring::rand::{SecureRandom, SystemRandom};
use serde::Serialize;
use sqlx::{PgPool, Postgres, Row, Transaction};

/// A stored row that cannot be true. See `postgres::employment` for why this is
/// a configuration fault rather than a validation error.
fn corrupt(what: &str, detail: String) -> AppError {
    AppError::Configuration(format!(
        "stored {what} does not hydrate: {detail}. The rows disagree with the rules they encode."
    ))
}

// ── the key ──────────────────────────────────────────────────────────────

/// The key that seals templates, and the id recorded beside every row it
/// sealed.
struct TemplateKey {
    key: LessSafeKey,
    id: String,
}

/// Read the sealing key from the environment, or refuse by name.
///
/// Not cached in a `OnceLock`: the refusal must stay a refusal if somebody
/// starts the node without the key, fixes the environment and restarts, and a
/// cached `Err` would make the second start fail for the first start's reason.
/// Deriving a key costs microseconds and enrolment is not a hot path.
fn template_key() -> Result<TemplateKey, AppError> {
    let raw = std::env::var("ATTENDANCE_TEMPLATE_KEY").map_err(|_| {
        AppError::Configuration(
            "ATTENDANCE_TEMPLATE_KEY is not set, so fingerprint templates cannot be sealed. \
             Biometric data is regulated personal data and this node will not store it in the \
             clear: set 64 hex characters (32 random bytes) and restart."
                .to_owned(),
        )
    })?;
    let bytes = hex::decode(raw.trim()).map_err(|_| {
        AppError::Configuration(
            "ATTENDANCE_TEMPLATE_KEY must be 64 hex characters (32 bytes)".to_owned(),
        )
    })?;
    if bytes.len() != 32 {
        return Err(AppError::Configuration(format!(
            "ATTENDANCE_TEMPLATE_KEY must be 32 bytes; it is {}",
            bytes.len()
        )));
    }
    let key = UnboundKey::new(&CHACHA20_POLY1305, &bytes).map_err(|_| {
        AppError::Configuration("ATTENDANCE_TEMPLATE_KEY is not a usable key".to_owned())
    })?;
    Ok(TemplateKey {
        key: LessSafeKey::new(key),
        // A label, not a secret. It exists so a key can be rotated without
        // anybody having to guess which rows are still under the old one.
        id: std::env::var("ATTENDANCE_TEMPLATE_KEY_ID").unwrap_or_else(|_| "k1".to_owned()),
    })
}

/// Seal a vendor template.
///
/// The employee id and the finger are bound in as additional authenticated
/// data, so a sealed template cannot be moved to another person's row or
/// relabelled as another finger: the seal opens only under the identity it was
/// sealed for. Moving bytes between rows in `psql` produces a row that fails to
/// open rather than one that matches the wrong person.
fn seal(
    plaintext: &[u8],
    employee_id: &str,
    finger: Finger,
    format: TemplateFormat,
) -> Result<SealedTemplate, AppError> {
    if plaintext.is_empty() {
        return Err(AppError::Validation(
            "an empty capture is not a fingerprint template".to_owned(),
        ));
    }
    let key = template_key()?;
    let mut nonce_bytes = [0u8; TEMPLATE_NONCE_LEN];
    SystemRandom::new()
        .fill(&mut nonce_bytes)
        .map_err(|_| AppError::Configuration("no system randomness available".to_owned()))?;
    let mut buffer = plaintext.to_vec();
    key.key
        .seal_in_place_append_tag(
            Nonce::assume_unique_for_key(nonce_bytes),
            Aad::from(aad(employee_id, finger)),
            &mut buffer,
        )
        .map_err(|_| AppError::Configuration("sealing the template failed".to_owned()))?;
    SealedTemplate::new(buffer, nonce_bytes.to_vec(), &key.id, format)
        .map_err(|error| AppError::Configuration(error.to_string()))
}

/// Open a sealed template. The plaintext lives only as long as the caller's
/// own local.
fn open(sealed: &SealedTemplate, employee_id: &str, finger: Finger) -> Result<Vec<u8>, AppError> {
    let key = template_key()?;
    if key.id != sealed.key_id() {
        return Err(AppError::Configuration(format!(
            "template was sealed under key `{}` and this node holds `{}`; \
             set ATTENDANCE_TEMPLATE_KEY_ID to the key the rows were written with",
            sealed.key_id(),
            key.id
        )));
    }
    let nonce: [u8; TEMPLATE_NONCE_LEN] = sealed
        .nonce()
        .try_into()
        .map_err(|_| corrupt("template nonce", "wrong width".to_owned()))?;
    let mut buffer = sealed.sealed().to_vec();
    let plaintext = key
        .key
        .open_in_place(
            Nonce::assume_unique_for_key(nonce),
            Aad::from(aad(employee_id, finger)),
            &mut buffer,
        )
        .map_err(|_| {
            corrupt(
                "fingerprint template",
                "the seal does not open under this key and this identity".to_owned(),
            )
        })?;
    Ok(plaintext.to_vec())
}

/// The identity a seal is bound to.
fn aad(employee_id: &str, finger: Finger) -> Vec<u8> {
    format!("{employee_id}/{}", finger.code()).into_bytes()
}

// ── terminals ────────────────────────────────────────────────────────────

fn decode_terminal(row: &sqlx::postgres::PgRow) -> Result<AttendanceTerminal, AppError> {
    let id: String = row.try_get("id")?;
    let unit: String = row.try_get("unit_id")?;
    let name: String = row.try_get("name")?;
    let status: String = row.try_get("status")?;
    let method: String = row.try_get("method")?;
    let registered: serde_json::Value = row.try_get("registered")?;
    let history: serde_json::Value = row.try_get("history")?;

    AttendanceTerminal::try_new(
        TerminalId::try_new(&id).map_err(|error| corrupt("terminal id", error.to_string()))?,
        UnitId::try_new(&unit).map_err(|error| corrupt("terminal unit", error.to_string()))?,
        &name,
        TerminalStatus::parse(&status)
            .ok_or_else(|| corrupt("terminal status", format!("`{status}` is not a status")))?,
        IdentificationMethod::parse(&method)
            .map_err(|error| corrupt("terminal method", error.to_string()))?,
        serde_json::from_value::<Authorization>(registered)
            .map_err(|error| corrupt("terminal registration", error.to_string()))?,
        serde_json::from_value::<Vec<TerminalEvent>>(history)
            .map_err(|error| corrupt("terminal history", error.to_string()))?,
    )
    .map_err(|error| corrupt("attendance terminal", error.to_string()))
}

/// One terminal, or `None`.
///
/// The load path every punch goes through: the terminal is fetched by the id
/// the punch names, and `AttendanceTerminal::attest` then refuses unless it is
/// active. A caller cannot supply one.
pub async fn load_attendance_terminal(
    pool: &PgPool,
    id: &str,
) -> Result<Option<AttendanceTerminal>, AppError> {
    let row = sqlx::query(
        "SELECT t.id, s.unit_id, t.name, t.status, t.method, t.registered, t.history
           FROM attendance_terminal t
           JOIN site s ON s.id = t.site_id
          WHERE t.id = $1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?;
    row.as_ref().map(decode_terminal).transpose()
}

/// What a Devices screen shows, and it deliberately shows the two instants a
/// person actually needs: when the station last took its templates, and when it
/// last delivered a punch. "One of them will be unplugged on a Monday" is the
/// owner's own observation about thirteen shops, and it is answerable here
/// before payroll rather than after.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct TerminalRow {
    pub id: String,
    /// Where the station is installed: a premises, not an organisation.
    pub site_id: String,
    pub site_name: Option<String>,
    /// The unit it attests for — the one that owns its site.
    pub unit_id: String,
    pub unit_name: Option<String>,
    pub name: String,
    pub status: String,
    pub method: String,
    pub registered_by: String,
    pub registered_at: DateTime<Utc>,
    pub synced_at: Option<DateTime<Utc>>,
    pub punched_at: Option<DateTime<Utc>>,
    /// How many people posted to this terminal's unit have at least one
    /// enrolled finger. Sent because a station with no templates admits nobody
    /// — fingerprint is the only way in — and that is worth seeing on the
    /// screen rather than discovering at opening time.
    pub enrolled_people: i64,
}

/// Every terminal, newest first, optionally bounded to one unit.
pub async fn list_attendance_terminals(
    pool: &PgPool,
    unit: Option<&str>,
) -> Result<Vec<TerminalRow>, AppError> {
    let rows = sqlx::query(
        "SELECT t.id, t.site_id, s.name AS site_name, s.unit_id, u.name AS unit_name,
                t.name, t.status, t.method, t.registered, t.synced_at, t.punched_at,
                (SELECT count(DISTINCT f.employee_id)
                   FROM fingerprint_template f
                   JOIN employee_assignment a ON a.employee_id = f.employee_id
                                             AND a.valid_to IS NULL
                  WHERE a.unit_id = s.unit_id) AS enrolled_people
           FROM attendance_terminal t
           JOIN site s ON s.id = t.site_id
           JOIN unit u ON u.id = s.unit_id
          WHERE ($1::text IS NULL OR s.unit_id = $1)
          ORDER BY s.unit_id, t.site_id, t.created_at DESC",
    )
    .bind(unit)
    .fetch_all(pool)
    .await?;

    rows.iter()
        .map(|row| {
            let registered: serde_json::Value = row.try_get("registered")?;
            let authority = serde_json::from_value::<Authorization>(registered)
                .map_err(|error| corrupt("terminal registration", error.to_string()))?;
            Ok(TerminalRow {
                id: row.try_get("id")?,
                site_id: row.try_get("site_id")?,
                site_name: row.try_get("site_name")?,
                unit_id: row.try_get("unit_id")?,
                unit_name: row.try_get("unit_name")?,
                name: row.try_get("name")?,
                status: row.try_get("status")?,
                method: row.try_get("method")?,
                registered_by: authority.actor().to_string(),
                registered_at: authority.at(),
                synced_at: row.try_get("synced_at")?,
                punched_at: row.try_get("punched_at")?,
                enrolled_people: row.try_get("enrolled_people")?,
            })
        })
        .collect()
}

/// The unit a site belongs to, for a station about to be installed there.
///
/// `None` for a site that does not exist. The registration handler builds the
/// domain terminal with this unit, and [`insert_attendance_terminal`] refuses a
/// terminal whose unit is not the site's — so the unit a terminal attests for
/// is always read off where it hangs, never typed in beside it.
pub async fn unit_of_site(pool: &PgPool, site_id: &str) -> Result<Option<UnitId>, AppError> {
    let unit: Option<String> = sqlx::query_scalar("SELECT unit_id FROM site WHERE id = $1")
        .bind(site_id)
        .fetch_optional(pool)
        .await?;
    unit.as_deref()
        .map(UnitId::try_new)
        .transpose()
        .map_err(|error| corrupt("site unit", error.to_string()))
}

/// Insert a newly registered terminal at a site, or refuse a duplicate id.
///
/// The row stores the site; the unit is the site's. A terminal built for one
/// unit and installed at another unit's site is refused here rather than stored
/// as a device attesting for a unit its own row does not name.
pub async fn insert_attendance_terminal(
    pool: &PgPool,
    terminal: &AttendanceTerminal,
    site_id: &str,
) -> Result<(), AppError> {
    if unit_of_site(pool, site_id).await?.as_ref() != Some(terminal.unit()) {
        return Err(AppError::Conflict(format!(
            "site {site_id} is not a site of unit {}, so a station there cannot attest for it",
            terminal.unit()
        )));
    }
    let registered = serde_json::to_value(terminal.registered())?;
    let affected = sqlx::query(
        "INSERT INTO attendance_terminal
            (id, site_id, name, status, method, registered, history)
         VALUES ($1, $2, $3, $4, $5, $6, '[]'::jsonb)
         ON CONFLICT (id) DO NOTHING",
    )
    .bind(terminal.id().as_str())
    .bind(site_id)
    .bind(terminal.name())
    .bind(terminal.status().code())
    .bind(terminal.method().code())
    .bind(&registered)
    .execute(pool)
    .await?
    .rows_affected();
    if affected == 0 {
        return Err(AppError::Conflict(format!(
            "a terminal with id {} is already registered",
            terminal.id()
        )));
    }
    Ok(())
}

/// Write back a terminal whose trust changed, history and all.
pub async fn save_attendance_terminal(
    pool: &PgPool,
    terminal: &AttendanceTerminal,
) -> Result<(), AppError> {
    let history = serde_json::to_value(terminal.history())?;
    sqlx::query(
        "UPDATE attendance_terminal
            SET status = $2, name = $3, history = $4, updated_at = now()
          WHERE id = $1",
    )
    .bind(terminal.id().as_str())
    .bind(terminal.status().code())
    .bind(terminal.name())
    .bind(&history)
    .execute(pool)
    .await?;
    Ok(())
}

/// Note that a terminal reached us. Two instants rather than one `last_seen`,
/// because "it collected its templates" and "it delivered a punch" fail
/// separately and a single column could not say which happened.
pub async fn touch_terminal_sync(pool: &PgPool, id: &str) -> Result<(), AppError> {
    sqlx::query("UPDATE attendance_terminal SET synced_at = now() WHERE id = $1")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

pub(super) async fn touch_terminal_punch(
    tx: &mut Transaction<'_, Postgres>,
    id: &str,
) -> Result<(), AppError> {
    sqlx::query("UPDATE attendance_terminal SET punched_at = now() WHERE id = $1")
        .bind(id)
        .execute(&mut **tx)
        .await?;
    Ok(())
}

// ── enrolment ────────────────────────────────────────────────────────────

/// What an HR screen may see about somebody's enrolment.
///
/// Everything except the template — see `domain::attendance::enrolment` for why
/// the bytes are in a type with no `Serialize` and this is a different type
/// rather than the same one with a field hidden.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct EnrolmentRow {
    pub employee_id: String,
    pub finger: String,
    pub format: String,
    /// `null` when the device reported none. **Not zero** — zero is a claim the
    /// capture was worthless.
    pub quality: Option<i32>,
    pub terminal_id: String,
    pub terminal_name: Option<String>,
    pub enrolled_by: String,
    pub enrolled_at: DateTime<Utc>,
    pub revision: i32,
}

/// Somebody's enrolled fingers. Never their templates.
pub async fn list_enrolments(
    pool: &PgPool,
    employee_id: &str,
) -> Result<Vec<EnrolmentRow>, AppError> {
    let rows = sqlx::query(
        "SELECT f.employee_id, f.finger, f.format, f.quality, f.terminal_id,
                t.name AS terminal_name, f.enrolled, f.revision
           FROM fingerprint_template f
           LEFT JOIN attendance_terminal t ON t.id = f.terminal_id
          WHERE f.employee_id = $1
          ORDER BY f.finger",
    )
    .bind(employee_id)
    .fetch_all(pool)
    .await?;

    rows.iter()
        .map(|row| {
            let enrolled: serde_json::Value = row.try_get("enrolled")?;
            let authority = serde_json::from_value::<Authorization>(enrolled)
                .map_err(|error| corrupt("enrolment authority", error.to_string()))?;
            Ok(EnrolmentRow {
                employee_id: row.try_get("employee_id")?,
                finger: row.try_get("finger")?,
                format: row.try_get("format")?,
                quality: row.try_get::<Option<i16>, _>("quality")?.map(i32::from),
                terminal_id: row.try_get("terminal_id")?,
                terminal_name: row.try_get("terminal_name")?,
                enrolled_by: authority.actor().to_string(),
                enrolled_at: authority.at(),
                revision: row.try_get("revision")?,
            })
        })
        .collect()
}

/// One line of the append-only enrolment log.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct EnrolmentEventRow {
    pub kind: String,
    pub finger: String,
    pub terminal_id: Option<String>,
    /// `null` for the automatic erasure on termination, which nobody decides.
    pub actor: Option<String>,
    pub reason: Option<String>,
    pub at: DateTime<Utc>,
}

/// What happened to somebody's enrolments, newest first.
///
/// Outlives the templates: a person whose employment ended has no rows in
/// `fingerprint_template` and still has their erasure here, which is the
/// evidence a data-protection audit asks for.
pub async fn list_enrolment_events(
    pool: &PgPool,
    employee_id: &str,
) -> Result<Vec<EnrolmentEventRow>, AppError> {
    let rows = sqlx::query(
        "SELECT kind, finger, terminal_id, authorized, at
           FROM fingerprint_enrolment_event
          WHERE employee_id = $1
          ORDER BY at DESC, id DESC",
    )
    .bind(employee_id)
    .fetch_all(pool)
    .await?;

    rows.iter()
        .map(|row| {
            let authorized: Option<serde_json::Value> = row.try_get("authorized")?;
            let authority = authorized
                .map(serde_json::from_value::<Authorization>)
                .transpose()
                .map_err(|error| corrupt("enrolment event authority", error.to_string()))?;
            Ok(EnrolmentEventRow {
                kind: row.try_get("kind")?,
                finger: row.try_get("finger")?,
                terminal_id: row.try_get("terminal_id")?,
                actor: authority.as_ref().map(|a| a.actor().to_string()),
                reason: authority.as_ref().map(|a| a.reason().to_string()),
                at: row.try_get("at")?,
            })
        })
        .collect()
}

/// Seal a capture and store it, replacing whatever was enrolled for that
/// finger, and appending to the log.
///
/// One transaction, and the log line is part of it: a template stored without
/// its event is a biometric nobody can account for collecting, and an event
/// without its template is a claim that did not happen.
///
/// The plaintext is consumed here and nowhere else. It arrives as a `Vec<u8>`
/// taken by value so the caller has no copy left to log by accident.
pub async fn store_fingerprint_template(
    pool: &PgPool,
    record: &EnrolmentRecord,
    plaintext: Vec<u8>,
) -> Result<EnrolmentKind, AppError> {
    let employee_id = record.employee().as_str().to_owned();
    let sealed = seal(&plaintext, &employee_id, record.finger(), record.format())?;
    // The plaintext has served its purpose. Dropped here rather than at the end
    // of the function so nothing below can reach it.
    drop(plaintext);
    let enrolled = serde_json::to_value(record.enrolled())?;

    let mut tx = pool.begin().await?;
    let previous: Option<i32> = sqlx::query_scalar(
        "SELECT revision FROM fingerprint_template
          WHERE employee_id = $1 AND finger = $2 FOR UPDATE",
    )
    .bind(&employee_id)
    .bind(record.finger().code())
    .fetch_optional(&mut *tx)
    .await?;
    let revision = previous.unwrap_or(0).saturating_add(1);
    let kind = if previous.is_some() {
        EnrolmentKind::Replaced
    } else {
        EnrolmentKind::Enrolled
    };

    sqlx::query(
        "INSERT INTO fingerprint_template
            (employee_id, finger, sealed, nonce, key_id, format, quality,
             terminal_id, enrolled, revision)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (employee_id, finger) DO UPDATE
            SET sealed = excluded.sealed,
                nonce = excluded.nonce,
                key_id = excluded.key_id,
                format = excluded.format,
                quality = excluded.quality,
                terminal_id = excluded.terminal_id,
                enrolled = excluded.enrolled,
                revision = excluded.revision,
                updated_at = now()",
    )
    .bind(&employee_id)
    .bind(record.finger().code())
    .bind(sealed.sealed())
    .bind(sealed.nonce())
    .bind(sealed.key_id())
    .bind(record.format().code())
    .bind(record.quality().map(i16::from))
    .bind(record.terminal().as_str())
    .bind(&enrolled)
    .bind(revision)
    .execute(&mut *tx)
    .await?;

    sqlx::query(
        "INSERT INTO fingerprint_enrolment_event
            (employee_id, finger, kind, terminal_id, authorized)
         VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(&employee_id)
    .bind(record.finger().code())
    .bind(kind.code())
    .bind(record.terminal().as_str())
    .bind(&enrolled)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(kind)
}

/// Withdraw one enrolled finger while the person is still employed.
///
/// The template row is deleted rather than flagged. A retired-but-present
/// biometric is regulated data the company is still holding without a purpose,
/// and "we keep it in case they come back" is the argument that makes a
/// retention policy meaningless. The event survives.
pub async fn withdraw_fingerprint_template(
    pool: &PgPool,
    employee_id: &str,
    finger: Finger,
    authorization: &Authorization,
) -> Result<bool, AppError> {
    let authorized = serde_json::to_value(authorization)?;
    let mut tx = pool.begin().await?;
    let terminal: Option<String> = sqlx::query_scalar(
        "DELETE FROM fingerprint_template
          WHERE employee_id = $1 AND finger = $2
      RETURNING terminal_id",
    )
    .bind(employee_id)
    .bind(finger.code())
    .fetch_optional(&mut *tx)
    .await?;
    let Some(terminal) = terminal else {
        tx.rollback().await?;
        return Ok(false);
    };
    sqlx::query(
        "INSERT INTO fingerprint_enrolment_event
            (employee_id, finger, kind, terminal_id, authorized)
         VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(employee_id)
    .bind(finger.code())
    .bind(EnrolmentKind::Withdrawn.code())
    .bind(terminal)
    .bind(&authorized)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(true)
}

// ── the per-unit template sync ───────────────────────────────────────────

/// One person's templates, as a terminal receives them.
///
/// `Serialize` only, and only reachable from the node-authenticated sync route.
/// The plaintext template is hex here because it has to cross a wire the
/// hardware agent reads, and that is the one place in this system where a
/// template is in the clear — between the cloud and the unit's own terminal,
/// over the same transport the node already authenticates with its ingest key.
#[derive(Clone, Debug, Serialize)]
pub struct TemplateBundleEntry {
    pub employee_id: String,
    /// The badge number, because an agent's log is read by a person and an
    /// opaque id in it is a question nobody can answer at the counter.
    pub employee_code: String,
    pub display_name: String,
    pub finger: String,
    pub format: String,
    /// The vendor feature vector, hex-encoded.
    pub template_hex: String,
}

/// Everybody posted to one place, with their templates, for one terminal.
///
/// # What bounds it, and why that is the whole feature
///
/// The join is through `employee_assignment`'s **open** span, so the bundle is
/// "the people posted here today" rather than "the people who once enrolled
/// here". A transfer therefore needs no re-enrolment — the person simply
/// appears in the new unit's bundle and disappears from the old one — and a
/// terminal that dies takes nothing with it, because it never held the
/// authoritative copy.
///
/// Terminated people are excluded twice over: their templates were erased by
/// `0233`'s trigger, and their posting is closed. Belt and braces, because this
/// is the query that decides who can get in.
pub async fn template_bundle_for_unit(
    pool: &PgPool,
    unit_id: &str,
) -> Result<Vec<TemplateBundleEntry>, AppError> {
    let rows = sqlx::query(
        "SELECT f.employee_id, f.finger, f.format, f.sealed, f.nonce, f.key_id,
                e.code AS employee_code,
                coalesce(p.full_name, e.code) AS display_name
           FROM fingerprint_template f
           JOIN employee e ON e.id = f.employee_id
           JOIN employee_assignment a ON a.employee_id = f.employee_id
                                     AND a.valid_to IS NULL
           LEFT JOIN employee_profile p ON p.employee_id = f.employee_id
          WHERE a.unit_id = $1 AND e.status = 'ACTIVE'
          ORDER BY e.code, f.finger",
    )
    .bind(unit_id)
    .fetch_all(pool)
    .await?;

    let mut bundle = Vec::with_capacity(rows.len());
    for row in &rows {
        let employee_id: String = row.try_get("employee_id")?;
        let finger_code: String = row.try_get("finger")?;
        let finger =
            Finger::parse(&finger_code).map_err(|error| corrupt("finger", error.to_string()))?;
        let format_code: String = row.try_get("format")?;
        let format = TemplateFormat::parse(&format_code).ok_or_else(|| {
            corrupt(
                "template format",
                format!("`{format_code}` is not a format"),
            )
        })?;
        let sealed = SealedTemplate::new(
            row.try_get::<Vec<u8>, _>("sealed")?,
            row.try_get::<Vec<u8>, _>("nonce")?,
            &row.try_get::<String, _>("key_id")?,
            format,
        )
        .map_err(|error| corrupt("sealed template", error.to_string()))?;
        let plaintext = open(&sealed, &employee_id, finger)?;
        bundle.push(TemplateBundleEntry {
            employee_id,
            employee_code: row.try_get("employee_code")?,
            display_name: row.try_get("display_name")?,
            finger: finger.code().to_owned(),
            format: format.code().to_owned(),
            template_hex: hex::encode(plaintext),
        });
    }
    Ok(bundle)
}

/// One finger that opens a POS, as a shop's server keeps it (24 Oct 2026).
///
/// The same template HR enrolled for the person (`fingerprint_template`), so
/// a finger is enrolled once, by HR when it registers them, and follows them
/// to whichever server they sign in at. Base64 because that is how the
/// server keeps a template and hands it to its tills.
#[derive(Debug, Clone, Serialize)]
pub struct PosFinger {
    pub username: String,
    pub finger: String,
    pub format: String,
    pub template_base64: String,
    pub revision: i32,
}

/// The fingers that open a POS at one store server: everybody on its
/// sign-in list (`edge_identity_assignment`) whose login and employment are
/// active, with every finger HR enrolled for them. Read only by the server
/// itself, under its own `x-sync-key` — no session can ask — and a person who
/// leaves, is moved off the server or has a finger withdrawn drops out of the
/// next read, which is how the server forgets them.
pub async fn pos_fingers_for_origin(
    pool: &PgPool,
    origin_id: &str,
) -> Result<Vec<PosFinger>, AppError> {
    use base64::Engine as _;
    let rows = sqlx::query(
        "SELECT u.username, f.employee_id, f.finger, f.format, f.sealed, f.nonce, f.key_id,
                f.revision
           FROM edge_identity_assignment a
           JOIN app_user u ON u.id = a.user_id AND u.active
           JOIN employee e ON e.id = u.employee_id AND e.status = 'ACTIVE'
           JOIN fingerprint_template f ON f.employee_id = e.id
          WHERE a.origin_id = $1 AND a.active
          ORDER BY u.username, f.finger",
    )
    .bind(origin_id)
    .fetch_all(pool)
    .await?;
    let mut fingers = Vec::with_capacity(rows.len());
    for row in &rows {
        let employee_id: String = row.try_get("employee_id")?;
        let finger_code: String = row.try_get("finger")?;
        let finger =
            Finger::parse(&finger_code).map_err(|error| corrupt("finger", error.to_string()))?;
        let format_code: String = row.try_get("format")?;
        let format = TemplateFormat::parse(&format_code).ok_or_else(|| {
            corrupt(
                "template format",
                format!("`{format_code}` is not a format"),
            )
        })?;
        let sealed = SealedTemplate::new(
            row.try_get::<Vec<u8>, _>("sealed")?,
            row.try_get::<Vec<u8>, _>("nonce")?,
            &row.try_get::<String, _>("key_id")?,
            format,
        )
        .map_err(|error| corrupt("sealed template", error.to_string()))?;
        let plaintext = open(&sealed, &employee_id, finger)?;
        fingers.push(PosFinger {
            username: row.try_get("username")?,
            finger: finger.code().to_owned(),
            format: format.code().to_owned(),
            template_base64: base64::engine::general_purpose::STANDARD.encode(plaintext),
            revision: row.try_get("revision")?,
        });
    }
    Ok(fingers)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A deterministic key for the round-trip tests. Set and removed inside
    /// each test, because the environment is process-wide.
    const TEST_KEY: &str = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";

    fn with_key<T>(body: impl FnOnce() -> T) -> T {
        // SAFETY-adjacent note: these tests are the only writers of this
        // variable and they run in one process; `--test-threads` parallelism
        // is tolerated because every one of them sets the same value.
        std::env::set_var("ATTENDANCE_TEMPLATE_KEY", TEST_KEY);
        std::env::set_var("ATTENDANCE_TEMPLATE_KEY_ID", "k1");
        body()
    }

    #[test]
    fn a_sealed_template_opens_under_its_own_identity() {
        with_key(|| {
            let plaintext = b"a vendor feature vector".to_vec();
            let sealed = seal(
                &plaintext,
                "emp-1",
                Finger::RightIndex,
                TemplateFormat::ZkfingerV10,
            )
            .expect("seal");
            assert_ne!(
                sealed.sealed(),
                plaintext.as_slice(),
                "the column is not the template"
            );
            let opened = open(&sealed, "emp-1", Finger::RightIndex).expect("open");
            assert_eq!(opened, plaintext);
        });
    }

    /// The point of binding the identity into the seal: moving the bytes to
    /// another person's row in `psql` produces a row that will not open, rather
    /// than one that matches the wrong person.
    #[test]
    fn a_template_moved_to_another_identity_does_not_open() {
        with_key(|| {
            let sealed = seal(
                b"a vendor feature vector",
                "emp-1",
                Finger::RightIndex,
                TemplateFormat::ZkfingerV10,
            )
            .expect("seal");
            assert!(open(&sealed, "emp-2", Finger::RightIndex).is_err());
            assert!(open(&sealed, "emp-1", Finger::LeftThumb).is_err());
        });
    }

    /// No key means no enrolment, by name. A built-in default would be the
    /// same as no encryption with more ceremony.
    #[test]
    fn without_a_key_nothing_is_sealed_and_the_refusal_says_so() {
        std::env::remove_var("ATTENDANCE_TEMPLATE_KEY");
        let refused = seal(
            b"x",
            "emp-1",
            Finger::RightIndex,
            TemplateFormat::ZkfingerV10,
        );
        match refused {
            Err(AppError::Configuration(message)) => {
                assert!(message.contains("ATTENDANCE_TEMPLATE_KEY"));
                assert!(message.contains("will not store it in the clear"));
            }
            other => panic!("expected a named configuration refusal, got {other:?}"),
        }
        std::env::set_var("ATTENDANCE_TEMPLATE_KEY", TEST_KEY);
    }

    /// An empty capture is a device that saw nothing, and is refused rather
    /// than stored as a template that will never match.
    #[test]
    fn an_empty_capture_is_not_a_template() {
        with_key(|| {
            assert!(matches!(
                seal(
                    b"",
                    "emp-1",
                    Finger::RightIndex,
                    TemplateFormat::ZkfingerV10
                ),
                Err(AppError::Validation(_))
            ));
        });
    }
}
