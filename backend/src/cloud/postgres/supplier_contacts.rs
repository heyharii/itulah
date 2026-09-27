//! The people at a supplier.
//!
//! `supplier` (0032) carries `contact_name`, `phone` and `email` — one person,
//! on the party's own row. Every real supplier has more than one: the sales rep
//! who quotes, the admin who sends the invoice, the number of the driver
//! somebody wrote on a delivery note. Three columns force each of those to
//! overwrite the next, which is the version that loses the person who answered
//! last time. `0302` gives them a table and this module gives them a door.
//!
//! The same shape as `supplier_banks`, deliberately: a child of the party, a
//! flag marking the one a screen shows when it has room for exactly one, and a
//! retirement rather than a delete. ERPNext reaches it from the other end with
//! a `Contact` doctype linked to the party, for the same reasons.
//!
//! # What this module refuses to decide
//!
//! Whether the three columns on `supplier` still mean anything. They do, until
//! the last screen reading them is moved — 0302 says so at length and this
//! module does not second-guess it. A contact created here does NOT write back
//! to them: two places holding the same fact and each correcting the other is
//! how they drift.

use super::{begin_idempotent, complete_idempotent, NullablePatch};
use crate::cloud::application::AppError;
use serde::{Deserialize, Serialize};
use sqlx::{postgres::PgRow, PgPool, Row};
use uuid::Uuid;

/// One person at a supplier, as a screen shows them.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SupplierContact {
    pub contact_id: Uuid,
    pub supplier_id: Uuid,
    /// As it will be read. The normalised form uniqueness is judged on is not
    /// returned: nothing outside the database has a use for it.
    pub name: String,
    /// What they are for — "Sales", "Admin", "Gudang". Free text, read rather
    /// than matched: a master for it would be four rows nobody maintains.
    pub role: Option<String>,
    /// Both optional individually, and at least one required by the table's
    /// own CHECK: a contact with a name and no way to reach them is a note.
    pub phone: Option<String>,
    pub email: Option<String>,
    /// Where this person is, when it is not the company's own address.
    /// See migration 0396.
    pub address: Option<String>,
    pub note: Option<String>,
    /// The one a screen shows when it has room for exactly one. At most one
    /// per supplier among the live contacts, and the database holds that
    /// rather than this code — see 0302.
    pub is_primary: bool,
    /// Hidden from the pickers, still readable on everything they ever
    /// appeared on. Returned when the caller asks for them, for the reason
    /// every master here does it: a retirement nobody can find is a
    /// retirement nobody can undo.
    pub retired: bool,
    /// What a PATCH must quote in `If-Match`.
    pub version: i32,
}

/// A new contact for a supplier.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CreateSupplierContactRequest {
    pub name: String,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub role: Option<String>,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub phone: Option<String>,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub email: Option<String>,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub address: Option<String>,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub note: Option<String>,
    /// Absent means "decide for me": the first live contact a supplier has is
    /// the primary one, because a supplier with one contact and nothing marked
    /// is a screen asking a question with one answer.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "boolean | null"))]
    pub is_primary: Option<bool>,
}

/// Correct a contact, make them the primary one, retire them or bring them
/// back.
///
/// There is no delete, for the same reason there is none on an account: a
/// person who signed for a delivery is part of what that delivery note said.
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct UpdateSupplierContactRequest {
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub name: Option<String>,
    // Absent leaves it alone, `null` clears it, a string sets it — the three
    // states `NullablePatch` exists for.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub role: NullablePatch<String>,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub phone: NullablePatch<String>,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub email: NullablePatch<String>,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub note: NullablePatch<String>,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub address: NullablePatch<String>,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "boolean | null"))]
    pub is_primary: Option<bool>,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "boolean | null"))]
    pub retired: Option<bool>,
}

const CONTACT_COLUMNS: &str = "contact_id, supplier_id, name, role, phone, email, address, note, \
                               is_primary, (retired_at IS NOT NULL) AS retired, version";

fn contact_from_row(row: &PgRow) -> Result<SupplierContact, AppError> {
    Ok(SupplierContact {
        contact_id: row.try_get("contact_id")?,
        supplier_id: row.try_get("supplier_id")?,
        name: row.try_get("name")?,
        role: row.try_get("role")?,
        phone: row.try_get("phone")?,
        email: row.try_get("email")?,
        address: row.try_get("address")?,
        note: row.try_get("note")?,
        is_primary: row.try_get("is_primary")?,
        retired: row.try_get("retired")?,
        version: row.try_get("version")?,
    })
}

/// "Budi Santoso", "budi santoso" and "Budi  Santoso" are one person.
///
/// Uniqueness is judged on this, never on what was typed — otherwise the same
/// person entered twice with a stray space is two contacts, and the second is
/// a duplicate nobody can see. The same rule `supplier_code_normalized` (0032)
/// and `bank_name_normalized` (0221) follow.
fn normalize_name(value: &str) -> Result<(String, String), AppError> {
    let display = value.split_whitespace().collect::<Vec<_>>().join(" ");
    if display.is_empty() {
        return Err(AppError::Validation("contact name cannot be blank".into()));
    }
    let normalized: String = display
        .chars()
        .filter(char::is_ascii_alphanumeric)
        .collect::<String>()
        .to_uppercase();
    if normalized.is_empty() {
        return Err(AppError::Validation(
            "contact name must contain a letter or a digit".into(),
        ));
    }
    Ok((display, normalized))
}

fn optional(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|one| !one.is_empty())
        .map(str::to_owned)
}

/// Say which constraint refused, in the words of the person who tripped it.
fn map_write_error(error: sqlx::Error) -> AppError {
    if let sqlx::Error::Database(database) = &error {
        return match database.code().as_deref() {
            Some("23505") => {
                AppError::Conflict("this supplier already has a contact by that name".to_owned())
            }
            // The supplier in the path does not exist. A 404 rather than a
            // 500, because the caller asked about somebody who is not there.
            Some("23503") => AppError::NotFound("Supplier".to_owned()),
            Some("23514") if database.message().contains("reachable") => AppError::Validation(
                "a contact needs a phone number or an email address".to_owned(),
            ),
            Some("23514") | Some("23502") => AppError::Validation(database.message().to_owned()),
            _ => AppError::Database(error),
        };
    }
    AppError::Database(error)
}

/// Every contact a supplier has, the primary one first.
///
/// `include_retired` is the picker/master split: a form choosing who to send a
/// PO to wants the live ones, and the screen that retired somebody has to be
/// able to find them again.
pub async fn supplier_contacts(
    pool: &PgPool,
    supplier_id: Uuid,
    include_retired: bool,
) -> Result<Vec<SupplierContact>, AppError> {
    let rows = sqlx::query(&format!(
        "SELECT {CONTACT_COLUMNS}
           FROM supplier_contact
          WHERE supplier_id = $1
            AND ($2 OR retired_at IS NULL)
          ORDER BY (retired_at IS NOT NULL), is_primary DESC, name"
    ))
    .bind(supplier_id)
    .bind(include_retired)
    .fetch_all(pool)
    .await?;

    rows.iter().map(contact_from_row).collect()
}

/// Every live contact of every supplier, for the supplier list's CSV export.
///
/// One read rather than one per supplier: an export of four hundred suppliers
/// should be one round trip, not four hundred. Retired people are left out —
/// the export is who to call, not who used to answer.
pub async fn all_live_supplier_contacts(pool: &PgPool) -> Result<Vec<SupplierContact>, AppError> {
    let rows = sqlx::query(&format!(
        "SELECT {CONTACT_COLUMNS}
           FROM supplier_contact
          WHERE retired_at IS NULL
          ORDER BY supplier_id, is_primary DESC, name"
    ))
    .fetch_all(pool)
    .await?;
    rows.iter().map(contact_from_row).collect()
}

pub async fn get_supplier_contact(
    pool: &PgPool,
    contact_id: Uuid,
) -> Result<SupplierContact, AppError> {
    let row = sqlx::query(&format!(
        "SELECT {CONTACT_COLUMNS} FROM supplier_contact WHERE contact_id = $1"
    ))
    .bind(contact_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound("Supplier contact".to_owned()))?;
    contact_from_row(&row)
}

/// Add a contact to a supplier.
///
/// Guarded by an idempotency key like every other write here: a browser that
/// retries a slow request must not end up with the same person twice — and it
/// would be refused by the unique index with a message about a clash the
/// caller did not cause.
pub async fn create_supplier_contact(
    pool: &PgPool,
    supplier_id: Uuid,
    request: CreateSupplierContactRequest,
    actor: &str,
    idempotency_key: &str,
    digest: &str,
) -> Result<SupplierContact, AppError> {
    let (name, name_normalized) = normalize_name(&request.name)?;
    let role = optional(request.role.as_deref());
    let phone = optional(request.phone.as_deref());
    let email = optional(request.email.as_deref());
    let note = optional(request.note.as_deref());
    let address = optional(request.address.as_deref());
    // Said here as well as by the CHECK, because a sentence beats an SQLSTATE
    // and this is the mistake the form makes most.
    if phone.is_none() && email.is_none() {
        return Err(AppError::Validation(
            "a contact needs a phone number or an email address".to_owned(),
        ));
    }

    let mut transaction = pool.begin().await?;
    if let Some(response) = begin_idempotent(
        &mut transaction,
        idempotency_key,
        "supplier_contact.create",
        digest,
    )
    .await?
    {
        return Ok(serde_json::from_value(response)?);
    }

    // Absent means "the first one is the primary". Asked for explicitly, it
    // takes the flag from whoever holds it — inside the transaction, so two
    // requests arriving together cannot both win.
    let wants_primary = match request.is_primary {
        Some(asked) => asked,
        None => {
            let live: i64 = sqlx::query_scalar(
                "SELECT count(*) FROM supplier_contact
                  WHERE supplier_id = $1 AND retired_at IS NULL",
            )
            .bind(supplier_id)
            .fetch_one(&mut *transaction)
            .await?;
            live == 0
        }
    };
    if wants_primary {
        sqlx::query(
            "UPDATE supplier_contact SET is_primary = false
              WHERE supplier_id = $1 AND is_primary",
        )
        .bind(supplier_id)
        .execute(&mut *transaction)
        .await?;
    }

    let contact_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO supplier_contact
             (contact_id, supplier_id, name, name_normalized, role, phone, email,
              note, is_primary, created_by, updated_by, address)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10, $11)",
    )
    .bind(contact_id)
    .bind(supplier_id)
    .bind(&name)
    .bind(&name_normalized)
    .bind(&role)
    .bind(&phone)
    .bind(&email)
    .bind(&note)
    .bind(wants_primary)
    .bind(actor)
    .bind(&address)
    .execute(&mut *transaction)
    .await
    .map_err(map_write_error)?;

    // Read back rather than assembled here, so what this answers with and what
    // the next list shows cannot disagree about who is primary.
    let contact = contact_from_row(
        &sqlx::query(&format!(
            "SELECT {CONTACT_COLUMNS} FROM supplier_contact WHERE contact_id = $1"
        ))
        .bind(contact_id)
        .fetch_one(&mut *transaction)
        .await?,
    )?;
    complete_idempotent(
        &mut transaction,
        idempotency_key,
        &serde_json::to_value(&contact)?,
    )
    .await?;
    transaction.commit().await?;
    Ok(contact)
}

/// Correct a contact, make them primary, retire them or bring them back.
pub async fn update_supplier_contact(
    pool: &PgPool,
    contact_id: Uuid,
    expected_version: i32,
    request: UpdateSupplierContactRequest,
    actor: &str,
    idempotency_key: &str,
    digest: &str,
) -> Result<SupplierContact, AppError> {
    if expected_version <= 0 {
        return Err(AppError::Validation(
            "If-Match version must be positive".into(),
        ));
    }

    let name = request.name.as_deref().map(normalize_name).transpose()?;
    let changes_role = !matches!(request.role, NullablePatch::Missing);
    let changes_phone = !matches!(request.phone, NullablePatch::Missing);
    let changes_email = !matches!(request.email, NullablePatch::Missing);
    let changes_note = !matches!(request.note, NullablePatch::Missing);
    let changes_address = !matches!(request.address, NullablePatch::Missing);
    if name.is_none()
        && !changes_role
        && !changes_phone
        && !changes_email
        && !changes_note
        && !changes_address
        && request.is_primary.is_none()
        && request.retired.is_none()
    {
        return Err(AppError::Validation(
            "Supplier contact update must contain at least one field".into(),
        ));
    }

    let mut transaction = pool.begin().await?;
    if let Some(response) = begin_idempotent(
        &mut transaction,
        idempotency_key,
        "supplier_contact.update",
        digest,
    )
    .await?
    {
        return Ok(serde_json::from_value(response)?);
    }

    let current = sqlx::query(
        "SELECT supplier_id, version FROM supplier_contact WHERE contact_id = $1 FOR UPDATE",
    )
    .bind(contact_id)
    .fetch_optional(&mut *transaction)
    .await?
    .ok_or_else(|| AppError::NotFound("Supplier contact".to_owned()))?;
    let supplier_id: Uuid = current.try_get("supplier_id")?;
    let actual_version: i32 = current.try_get("version")?;
    if actual_version != expected_version {
        return Err(AppError::Conflict(format!(
            "Supplier contact has moved on: If-Match said {expected_version}, it is now \
             {actual_version}"
        )));
    }

    // Retiring takes the primary flag with it. The index in 0302 only counts
    // live rows, so a retired row could keep the flag and nothing would
    // complain — and the next screen to read "the contact" would name somebody
    // who has left.
    let retiring = request.retired == Some(true);
    let becoming_primary = request.is_primary == Some(true) && !retiring;
    if becoming_primary {
        sqlx::query(
            "UPDATE supplier_contact SET is_primary = false
              WHERE supplier_id = $1 AND contact_id <> $2 AND is_primary",
        )
        .bind(supplier_id)
        .bind(contact_id)
        .execute(&mut *transaction)
        .await?;
    }

    sqlx::query(
        "UPDATE supplier_contact
            SET name            = COALESCE($2, name),
                name_normalized = COALESCE($3, name_normalized),
                role            = CASE WHEN $4 THEN $5 ELSE role END,
                phone           = CASE WHEN $6 THEN $7 ELSE phone END,
                email           = CASE WHEN $8 THEN $9 ELSE email END,
                note            = CASE WHEN $10 THEN $11 ELSE note END,
                address         = CASE WHEN $16 THEN $17 ELSE address END,
                is_primary      = CASE
                                      WHEN $12 THEN false
                                      WHEN $13 IS NULL THEN is_primary
                                      ELSE $13
                                  END,
                retired_at      = CASE
                                      WHEN $14 IS NULL THEN retired_at
                                      WHEN $14 THEN COALESCE(retired_at, now())
                                      ELSE NULL
                                  END,
                version         = version + 1,
                updated_by      = $15,
                updated_at      = now()
          WHERE contact_id = $1",
    )
    .bind(contact_id)
    .bind(name.as_ref().map(|(display, _)| display))
    .bind(name.as_ref().map(|(_, normalized)| normalized))
    .bind(changes_role)
    .bind(match &request.role {
        NullablePatch::Value(value) => optional(Some(value.as_str())),
        _ => None,
    })
    .bind(changes_phone)
    .bind(match &request.phone {
        NullablePatch::Value(value) => optional(Some(value.as_str())),
        _ => None,
    })
    .bind(changes_email)
    .bind(match &request.email {
        NullablePatch::Value(value) => optional(Some(value.as_str())),
        _ => None,
    })
    .bind(changes_note)
    .bind(match &request.note {
        NullablePatch::Value(value) => optional(Some(value.as_str())),
        _ => None,
    })
    .bind(retiring)
    .bind(request.is_primary)
    .bind(request.retired)
    .bind(actor)
    .bind(changes_address)
    .bind(match &request.address {
        NullablePatch::Value(value) => optional(Some(value.as_str())),
        _ => None,
    })
    .execute(&mut *transaction)
    .await
    .map_err(map_write_error)?;

    let contact = contact_from_row(
        &sqlx::query(&format!(
            "SELECT {CONTACT_COLUMNS} FROM supplier_contact WHERE contact_id = $1"
        ))
        .bind(contact_id)
        .fetch_one(&mut *transaction)
        .await?,
    )?;
    complete_idempotent(
        &mut transaction,
        idempotency_key,
        &serde_json::to_value(&contact)?,
    )
    .await?;
    transaction.commit().await?;
    Ok(contact)
}
