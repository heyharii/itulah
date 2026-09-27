//! Setting a company up from the hub: the three answers the setup wizard
//! asks for, and the list of what is still to do before its stores trade.
//!
//! # Opening a store is data
//!
//! A store is not one row. It is a site, its floor, back-room and reject
//! pools, a return pool for it at the warehouse, a leaf per outbound stage at
//! the warehouse with its name on it (0009, 0252), a place per pool per state,
//! a posting for HR (`org_place`) and the payment methods its tills show
//! (0474). That shape has changed a dozen times since 0002 wrote it with
//! `generate_series(1, 13)`, and it will change again.
//!
//! So the shape is data: `site_template_row` (0521) holds whole pool and place
//! rows taken from the first store and the head office, with the ids and the
//! name as tokens. Opening a store — or making the head office, for a company
//! that has none — puts the new values in and inserts the rows through
//! `jsonb_populate_record`. No store has to exist for the first one to be
//! opened, and nothing here names a pool.
//!
//! # Payment methods: cash only
//!
//! A new store's tills take cash. QRIS and cards need a merchant id or a
//! terminal for that store, which do not exist the moment it is opened, so the
//! other methods are switched on later (Shop Payment Methods) — and until they
//! are, the `payments` task says so on the home screen.
//!
//! # The tasks are read, never stored
//!
//! "Undang tim" is done when a second person can sign in, "Pasang server
//! toko" when every store's node has a credential. A checkbox somebody ticks
//! would say what they believed; the data says what is true.

use super::{begin_idempotent, complete_idempotent, open_period};
use crate::cloud::application::AppError;
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Postgres, Row, Transaction};
use uuid::Uuid;

const LEGAL_FORMS: [&str; 4] = ["PT", "CV", "UD", "PERORANGAN"];
const MAX_STORES_AT_ONCE: usize = 50;

/// The company as its owner described it.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SetupCompany {
    pub name: String,
    /// `PT`, `CV`, `UD` or `PERORANGAN`. Empty only for a company that
    /// existed before the wizard and has not been asked yet.
    pub legal_form: Option<String>,
    pub address: String,
    pub has_warehouse: bool,
    /// The NPWP, sixteen digits, once somebody has entered it.
    pub tax_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SaveSetupCompanyRequest {
    pub name: String,
    pub legal_form: String,
    pub address: String,
    pub has_warehouse: bool,
    /// The NPWP as typed — dots and dashes are dropped, and an old
    /// fifteen-digit number gets its leading zero (PMK 112/2022). Absent or
    /// blank clears it; the wizard does not ask, and sends what it was given.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub tax_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SetupStore {
    /// The client code, `C001` — what the store is called on paper.
    pub unit_code: String,
    pub name: String,
    pub city: String,
    pub timezone: String,
    pub node_connected: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SetupBooks {
    pub chart: String,
    pub first_period: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SetupTask {
    pub id: String,
    pub done: bool,
    /// How many are still waiting, where the task is a count of stores.
    pub pending: Option<i32>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SetupStatus {
    pub company: Option<SetupCompany>,
    pub stores: Vec<SetupStore>,
    pub books: Option<SetupBooks>,
    /// The company and the books are both answered. Stores are not required:
    /// a company may be set up before its first shop is.
    pub finished: bool,
    pub tasks: Vec<SetupTask>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct NewStore {
    pub name: String,
    /// Empty when not known yet; the clock then defaults to WIB.
    pub city: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct OpenStoresRequest {
    pub stores: Vec<NewStore>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct OpenStoresAnswer {
    pub created: Vec<SetupStore>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct StartBooksRequest {
    /// `STANDARD` or `IMPORTED`.
    pub chart: String,
    pub file_id: Option<Uuid>,
    /// `YYYY-MM`.
    pub first_period: String,
}

// ── the read ─────────────────────────────────────────────────────────────

pub async fn setup_status(pool: &PgPool) -> Result<SetupStatus, AppError> {
    let company_row =
        sqlx::query("SELECT name, legal_form, address, has_warehouse, tax_id FROM company_profile")
            .fetch_optional(pool)
            .await?;
    let (company, has_tax_id) = match company_row {
        Some(row) => (
            Some(SetupCompany {
                name: row.try_get("name")?,
                legal_form: row.try_get("legal_form")?,
                address: row.try_get("address")?,
                has_warehouse: row.try_get("has_warehouse")?,
                tax_id: row.try_get("tax_id")?,
            }),
            row.try_get::<Option<String>, _>("tax_id")?.is_some(),
        ),
        None => (None, false),
    };

    let books = sqlx::query("SELECT chart, first_period FROM setup_books")
        .fetch_optional(pool)
        .await?
        .map(|row| -> Result<SetupBooks, sqlx::Error> {
            Ok(SetupBooks {
                chart: row.try_get("chart")?,
                first_period: row.try_get("first_period")?,
            })
        })
        .transpose()?;

    let store_rows = sqlx::query(
        "SELECT COALESCE(s.client_code, s.id) AS unit_code, s.name, s.city, s.timezone,
                EXISTS (SELECT 1 FROM sync_origin_credential c
                         WHERE c.site_id = s.id) AS node_connected,
                EXISTS (SELECT 1 FROM payment_method_site m
                          JOIN payment_method p ON p.code = m.method_code
                         WHERE m.site_id = s.id AND p.is_active
                           AND p.tender_type <> 'CASH') AS takes_cards,
                EXISTS (SELECT 1 FROM ga_location_detail d
                         WHERE d.site_id = s.id
                           AND btrim(COALESCE(d.address, '')) <> '') AS has_address
           FROM site s
          WHERE s.kind = 'STORE'
          ORDER BY s.client_code NULLS LAST, s.id",
    )
    .fetch_all(pool)
    .await?;

    let mut stores = Vec::with_capacity(store_rows.len());
    let (mut without_node, mut without_cards, mut without_address) = (0, 0, 0);
    for row in &store_rows {
        let store = SetupStore {
            unit_code: row.try_get("unit_code")?,
            name: row.try_get("name")?,
            city: row.try_get("city")?,
            timezone: row.try_get("timezone")?,
            node_connected: row.try_get("node_connected")?,
        };
        if !store.node_connected {
            without_node += 1;
        }
        if !row.try_get::<bool, _>("takes_cards")? {
            without_cards += 1;
        }
        if !row.try_get::<bool, _>("has_address")? {
            without_address += 1;
        }
        stores.push(store);
    }

    let people: i32 = sqlx::query_scalar("SELECT count(*)::int FROM app_user WHERE active")
        .fetch_one(pool)
        .await?;
    let has_bank: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM bank_account WHERE is_company_account AND active)",
    )
    .fetch_one(pool)
    .await?;

    let counted = |id: &str, pending: i32| SetupTask {
        id: id.to_owned(),
        done: pending == 0,
        pending: Some(pending),
    };
    let mut tasks = vec![
        SetupTask {
            id: "team".into(),
            done: people > 1,
            pending: None,
        },
        counted("store_nodes", without_node),
        counted("payments", without_cards),
        counted("store_addresses", without_address),
        SetupTask {
            id: "bank_accounts".into(),
            done: has_bank,
            pending: None,
        },
        SetupTask {
            id: "tax_id".into(),
            done: has_tax_id,
            pending: None,
        },
    ];
    // Only a company that came from other software has balances to bring.
    if books
        .as_ref()
        .is_some_and(|books| books.chart == "IMPORTED")
    {
        let opened: bool = sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM opening_balance_line)")
            .fetch_one(pool)
            .await?;
        tasks.push(SetupTask {
            id: "opening_balances".into(),
            done: opened,
            pending: None,
        });
    }

    Ok(SetupStatus {
        finished: company.is_some() && books.is_some(),
        company,
        stores,
        books,
        tasks,
    })
}

// ── step 1: the company ──────────────────────────────────────────────────

/// Write the company, and the letterhead with it — every slip already prints
/// from the letterhead, so it carries the name the way it is written on paper,
/// legal form after it.
pub async fn save_setup_company(
    pool: &PgPool,
    request: SaveSetupCompanyRequest,
    actor: &str,
) -> Result<SetupCompany, AppError> {
    let name = required(&request.name, "business name", 120)?;
    let address = required(&request.address, "head office address", 300)?;
    let legal_form = request.legal_form.trim().to_uppercase();
    if !LEGAL_FORMS.contains(&legal_form.as_str()) {
        return Err(AppError::Validation(
            "legal form must be PT, CV, UD or PERORANGAN".into(),
        ));
    }
    let tax_id = tax_id_of(request.tax_id.as_deref())?;

    let printed = if legal_form == "PERORANGAN" {
        name.clone()
    } else {
        format!("{name}, {legal_form}")
    };

    let mut transaction = pool.begin().await?;
    // A company with no head office yet gets one, from the template: the
    // office and, when there is one, the warehouse are the same site today.
    if head_office(&mut transaction).await?.is_none() {
        open_head_office(&mut transaction).await?;
    }
    let row = sqlx::query(
        "INSERT INTO company_profile
                (name, legal_form, address, has_warehouse, set_by, tax_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (only_row) DO UPDATE
            SET name = EXCLUDED.name,
                legal_form = EXCLUDED.legal_form,
                address = EXCLUDED.address,
                has_warehouse = EXCLUDED.has_warehouse,
                tax_id = EXCLUDED.tax_id,
                set_by = EXCLUDED.set_by,
                set_at = now()
         RETURNING name, legal_form, address, has_warehouse, tax_id",
    )
    .bind(&name)
    .bind(&legal_form)
    .bind(&address)
    .bind(request.has_warehouse)
    .bind(actor)
    .bind(&tax_id)
    .fetch_one(&mut *transaction)
    .await?;

    sqlx::query(
        "INSERT INTO company_letterhead (name, address, phone, set_by)
         VALUES ($1, $2, '', $3)
         ON CONFLICT (only_row) DO UPDATE
            SET name = EXCLUDED.name,
                address = EXCLUDED.address,
                set_by = EXCLUDED.set_by,
                set_at = now()",
    )
    .bind(&printed)
    .bind(&address)
    .bind(actor)
    .execute(&mut *transaction)
    .await?;
    transaction.commit().await?;

    Ok(SetupCompany {
        name: row.try_get("name")?,
        legal_form: row.try_get("legal_form")?,
        address: row.try_get("address")?,
        has_warehouse: row.try_get("has_warehouse")?,
        tax_id: row.try_get("tax_id")?,
    })
}

// ── step 2: the stores ───────────────────────────────────────────────────

/// Open one store or fifty, in one transaction — all of them or none.
pub async fn open_stores(
    pool: &PgPool,
    request: OpenStoresRequest,
    actor: &str,
    idempotency_key: &str,
    digest: &str,
) -> Result<OpenStoresAnswer, AppError> {
    if request.stores.is_empty() {
        return Err(AppError::Validation("name at least one store".into()));
    }
    if request.stores.len() > MAX_STORES_AT_ONCE {
        return Err(AppError::Validation(format!(
            "at most {MAX_STORES_AT_ONCE} stores at once"
        )));
    }
    let mut wanted = Vec::with_capacity(request.stores.len());
    for store in &request.stores {
        let name = required(&store.name, "store name", 80)?;
        let city = store.city.trim().to_owned();
        if city.chars().count() > 80 {
            return Err(AppError::Validation(format!(
                "the city for {name} is too long"
            )));
        }
        wanted.push((name, city));
    }

    let mut transaction = pool.begin().await?;
    if let Some(response) = begin_idempotent(
        &mut transaction,
        idempotency_key,
        "setup.stores.open",
        digest,
    )
    .await?
    {
        return Ok(serde_json::from_value(response)?);
    }
    // Two people opening stores at once would read the same "next number".
    sqlx::query("SELECT pg_advisory_xact_lock(hashtext('setup.stores.open'))")
        .execute(&mut *transaction)
        .await?;

    // A store's return pool and outbound leaves live at the head office, so
    // there must be one — and a template to make the store from.
    let ho_id = head_office(&mut transaction)
        .await?
        .ok_or_else(|| AppError::Conflict("describe the business first".into()))?;
    let has_template: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM site_template_row WHERE template = 'STORE')",
    )
    .fetch_one(&mut *transaction)
    .await?;
    if !has_template {
        return Err(AppError::Conflict(
            "there is no store template to open a store from".into(),
        ));
    }

    let mut next_id: i32 = sqlx::query_scalar(
        "SELECT COALESCE(max(substring(id FROM '^store-([0-9]+)$')::int), 0) FROM site",
    )
    .fetch_one(&mut *transaction)
    .await?;
    let mut next_code: i32 = sqlx::query_scalar(
        "SELECT COALESCE(max(substring(client_code FROM '^C([0-9]+)$')::int), 0) FROM site",
    )
    .fetch_one(&mut *transaction)
    .await?;

    let mut created = Vec::with_capacity(wanted.len());
    for (name, city) in wanted {
        next_id += 1;
        next_code += 1;
        let site_id = format!("store-{next_id:02}");
        let code = format!("C{next_code:03}");
        let timezone = timezone_of(&city);

        sqlx::query(
            "INSERT INTO site (id, name, kind, edge_node_id, client_code, city, timezone)
             VALUES ($1, $2, 'STORE', $3, $4, $5, $6)",
        )
        .bind(&site_id)
        .bind(&name)
        .bind(format!("store-edge-{next_id:02}"))
        .bind(&code)
        .bind(&city)
        .bind(timezone)
        .execute(&mut *transaction)
        .await
        .map_err(|error| duplicate_as_conflict(error, &name))?;

        instantiate(&mut transaction, "STORE", &site_id, &name, &ho_id).await?;

        sqlx::query("INSERT INTO org_place (id, name, kind, site_id) VALUES ($1, $2, 'STORE', $1)")
            .bind(&site_id)
            .bind(&name)
            .execute(&mut *transaction)
            .await?;

        sqlx::query(
            "INSERT INTO payment_method_site (method_code, site_id, set_by)
             SELECT code, $1, $2 FROM payment_method
              WHERE is_active AND tender_type = 'CASH'",
        )
        .bind(&site_id)
        .bind(actor)
        .execute(&mut *transaction)
        .await?;

        created.push(SetupStore {
            unit_code: code,
            name,
            city,
            timezone: timezone.to_owned(),
            node_connected: false,
        });
    }

    let answer = OpenStoresAnswer { created };
    complete_idempotent(
        &mut transaction,
        idempotency_key,
        &serde_json::to_value(&answer)?,
    )
    .await?;
    transaction.commit().await?;
    Ok(answer)
}

/// The head office, when there is one: the first site of kind HO.
async fn head_office(
    transaction: &mut Transaction<'_, Postgres>,
) -> Result<Option<String>, AppError> {
    Ok(
        sqlx::query_scalar("SELECT id FROM site WHERE kind = 'HO' ORDER BY created_at, id LIMIT 1")
            .fetch_optional(&mut **transaction)
            .await?,
    )
}

/// Make the head office for a company that has none: the site, its pools and
/// places from the template, and the HR posting everybody at head office is
/// filed under.
///
/// The id is `dc` because `operational_pool` still checks it by name on a
/// store's return pool (0001, see 0521). It is internal and never shown; the
/// code people see is `HO`.
async fn open_head_office(transaction: &mut Transaction<'_, Postgres>) -> Result<(), AppError> {
    const HO: &str = "dc";
    let has_template: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM site_template_row WHERE template = 'HEAD_OFFICE')",
    )
    .fetch_one(&mut **transaction)
    .await?;
    if !has_template {
        return Err(AppError::Conflict(
            "there is no head-office template to set the company up from".into(),
        ));
    }
    sqlx::query(
        "INSERT INTO site (id, name, kind, edge_node_id, client_code)
         VALUES ($1, 'Head office', 'HO', $2, 'HO')",
    )
    .bind(HO)
    .bind(format!("{HO}-edge-01"))
    .execute(&mut **transaction)
    .await?;
    // The head-office unit that people are posted to comes with the site:
    // the insert above names no unit, so `site_resolves_its_unit` (0620)
    // finds or makes the one of kind HO. `org_place` is gone (0601).
    instantiate(transaction, "HEAD_OFFICE", "no-store", "no-store", HO).await?;
    Ok(())
}

/// Insert a template's rows with the tokens replaced: pools first, then the
/// places on them.
///
/// The replacement is textual, on the JSON, so the name goes in JSON-escaped —
/// a store called `Toko "Baru"` must not end the string it is written into.
async fn instantiate(
    transaction: &mut Transaction<'_, Postgres>,
    template: &str,
    site_id: &str,
    name: &str,
    ho_id: &str,
) -> Result<(), AppError> {
    let quoted = serde_json::to_string(name)?;
    let escaped_name = &quoted[1..quoted.len() - 1];
    for table in ["operational_pool", "inventory_place"] {
        // The table is one of two literals above, never input.
        sqlx::query(&format!(
            "INSERT INTO {table}
             SELECT (jsonb_populate_record(NULL::{table},
                      replace(replace(replace(r.row_json::text,
                          '{{{{store}}}}', $2),
                          '{{{{store_name}}}}', $3),
                          '{{{{ho}}}}', $4)::jsonb)).*
               FROM site_template_row r
              WHERE r.template = $1 AND r.table_name = '{table}'
              ORDER BY r.position"
        ))
        .bind(template)
        .bind(site_id)
        .bind(escaped_name)
        .bind(ho_id)
        .execute(&mut **transaction)
        .await?;
    }
    Ok(())
}

// ── step 3: the books ────────────────────────────────────────────────────

/// Say how the books start, and open the first month.
///
/// `STANDARD` keeps the chart that is installed. Today that is the chart the
/// migrations carry (0348); installing the forty-account template onto an
/// empty ledger is the job of the same refactor that takes that chart out of
/// the migrations, and until then an empty ledger is refused by name rather
/// than left half-built. `IMPORTED` records the uploaded file for Finance to
/// match against the chart.
pub async fn start_books(
    pool: &PgPool,
    request: StartBooksRequest,
    actor: &str,
) -> Result<SetupBooks, AppError> {
    let chart = request.chart.trim().to_uppercase();
    if chart != "STANDARD" && chart != "IMPORTED" {
        return Err(AppError::Validation(
            "chart must be STANDARD or IMPORTED".into(),
        ));
    }
    if chart == "IMPORTED" && request.file_id.is_none() {
        return Err(AppError::Validation(
            "upload the chart from the old software first".into(),
        ));
    }
    let file_id = if chart == "IMPORTED" {
        request.file_id
    } else {
        None
    };
    let (year, month) = period_of(&request.first_period)?;

    let has_company: bool = sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM company_profile)")
        .fetch_one(pool)
        .await?;
    if !has_company {
        return Err(AppError::Conflict("describe the business first".into()));
    }
    let has_chart: bool = sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM ledger_account)")
        .fetch_one(pool)
        .await?;
    if !has_chart {
        return Err(AppError::Conflict(
            "no chart of accounts is installed, and installing the template from the hub is not available yet".into(),
        ));
    }

    // First, because it is the half that can be refused (a closed month) and
    // it is harmless to repeat: an open month asked to open again is a no-op.
    open_period(pool, year, month).await?;

    let first_period = format!("{year}-{month:02}");
    let inserted = sqlx::query(
        "INSERT INTO setup_books (chart, imported_file_id, first_period, started_by)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (only_row) DO NOTHING",
    )
    .bind(&chart)
    .bind(file_id)
    .bind(&first_period)
    .bind(actor)
    .execute(pool)
    .await?;
    if inserted.rows_affected() == 0 {
        return Err(AppError::Conflict(
            "the books have already been started".into(),
        ));
    }

    Ok(SetupBooks {
        chart,
        first_period,
    })
}

// ── small things ─────────────────────────────────────────────────────────

fn required(value: &str, label: &str, max: usize) -> Result<String, AppError> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(AppError::Validation(format!("{label} is required")));
    }
    if trimmed.chars().count() > max {
        return Err(AppError::Validation(format!(
            "{label} is at most {max} characters"
        )));
    }
    Ok(trimmed.to_owned())
}

/// An NPWP as somebody typed it, as the sixteen digits that are stored.
///
/// Punctuation is dropped (`01.234.567.8-901.000` is how it is printed on the
/// card), and a fifteen-digit number from before PMK 112/2022 gets the leading
/// zero that makes it the same taxpayer's sixteen. Blank means "not known".
fn tax_id_of(value: Option<&str>) -> Result<Option<String>, AppError> {
    let digits: String = value
        .unwrap_or_default()
        .chars()
        .filter(|c| c.is_ascii_digit())
        .collect();
    match digits.len() {
        0 if value.unwrap_or_default().trim().is_empty() => Ok(None),
        15 => Ok(Some(format!("0{digits}"))),
        16 => Ok(Some(digits)),
        _ => Err(AppError::Validation("NPWP must be 16 digits".into())),
    }
}

/// `2026-10` → (2026, 10).
fn period_of(value: &str) -> Result<(i32, i32), AppError> {
    let refused = || AppError::Validation("the first month must be YYYY-MM".into());
    let (year, month) = value.trim().split_once('-').ok_or_else(refused)?;
    let year: i32 = year.parse().map_err(|_| refused())?;
    let month: i32 = month.parse().map_err(|_| refused())?;
    if !(2000..=2999).contains(&year) || !(1..=12).contains(&month) {
        return Err(refused());
    }
    Ok((year, month))
}

/// The clock a city keeps. The same guess the hub shows while the city is
/// typed (`screens/setup/names.ts`), decided here because the site stores it.
/// Western Indonesia unless the city is one of the central or eastern ones.
fn timezone_of(city: &str) -> &'static str {
    const WITA: [&str; 17] = [
        "bali",
        "denpasar",
        "badung",
        "gianyar",
        "tabanan",
        "makassar",
        "manado",
        "balikpapan",
        "samarinda",
        "banjarmasin",
        "mataram",
        "lombok",
        "kupang",
        "palu",
        "kendari",
        "gorontalo",
        "bontang",
    ];
    const WIT: [&str; 10] = [
        "jayapura",
        "ambon",
        "sorong",
        "merauke",
        "ternate",
        "manokwari",
        "timika",
        "biak",
        "tual",
        "fakfak",
    ];
    // Whole words, so "Purbalingga" does not read as Bali.
    let lower = city.to_lowercase();
    let words: Vec<&str> = lower
        .split(|c: char| !c.is_alphanumeric())
        .filter(|word| !word.is_empty())
        .collect();
    if words.iter().any(|word| WIT.contains(word)) {
        "WIT"
    } else if words.iter().any(|word| WITA.contains(word)) {
        "WITA"
    } else {
        "WIB"
    }
}

fn duplicate_as_conflict(error: sqlx::Error, name: &str) -> AppError {
    match &error {
        sqlx::Error::Database(db) if db.code().as_deref() == Some("23505") => AppError::Conflict(
            format!("store {name} collides with a code that already exists"),
        ),
        _ => AppError::Database(error),
    }
}
