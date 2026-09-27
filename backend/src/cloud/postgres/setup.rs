//! Setting a company up from the hub: the three answers the setup wizard
//! asks for, and the list of what is still to do before its stores trade.
//!
//! # Opening a store is data
//!
//! A store is not one row. It is a unit — what owns the books and the people,
//! and what the client's code names (0600) — and the unit's shop: a site, its
//! back-room, floor, reject and outbound pools, a return pool for it at the
//! Gudang, a place per pool per state, and the payment methods its tills show
//! (0474). That shape has changed a dozen times since 0002 wrote it with
//! `generate_series(1, 13)`, and it will change again.
//!
//! So the shape is data, and none of it is written here. Which pools a site
//! of each kind gets is `pool_template` (0610), and the database furnishes a
//! site the moment it is inserted: `site_is_given_its_pools` gives it every
//! pool its kind's template names, each with its places, and
//! `store_unit_is_given_its_return_pools` gives a new store unit its return
//! pool at head office's Gudang. Opening a store — or making head office, for
//! a company that has none — is inserting the unit and then its site. No
//! store has to exist for the first one to be opened, and nothing here names
//! a pool. (0521's `site_template_row`, which copied the first store's rows,
//! was a second source of the same shape; 0622 retired it.)
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
/// The longest client code a store may be given. `unit.code` sets no length,
/// but the shop prints as the code with `-TOKO` after it, and `site.code`
/// holds at most 32 characters (0603).
const MAX_UNIT_CODE: usize = 20;
/// The longest number read as part of the client's `C001` series: nine
/// digits, which an `int` holds on both sides of the wire.
const MAX_SERIES_DIGITS: usize = 9;

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
    /// The store's client code, `C001` — its unit's code (`unit.code`), what
    /// the store is called on paper.
    pub unit_code: String,
    /// The unit's name, `Bumiayu`.
    pub name: String,
    /// Where its shop is, and the clock the shop keeps.
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
    /// The client's own code for the store, `C014`, when the caller has one.
    /// It becomes the unit's code (`unit.code`), the one place a client code
    /// lives, and the shop prints as `C014-TOKO`. Absent or blank, the store
    /// is given the next number in the client's `C001` series — which is what
    /// the wizard does: it sends no code and shows that number as a preview.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub code: Option<String>,
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

    // A store is a unit of kind STORE, called by its code and its name; the
    // city, the clock, the node, the tender and the address are its shop's.
    // One row per shop — which is one per store while no store trades from
    // two premises.
    let store_rows = sqlx::query(
        "SELECT u.code AS unit_code, u.name, s.city, s.timezone,
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
           JOIN unit u ON u.id = s.unit_id
          WHERE u.kind = 'STORE' AND s.kind = 'STORE'
          ORDER BY u.code, s.id",
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
    // A company with no head office yet gets one: its unit and its site, the
    // site furnished from the pool template. The office and, when there is
    // one, the warehouse are the same site today.
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
///
/// # The unit first, then its shop
///
/// A store is a unit (0600): what owns the books and the people, and what the
/// client's code names. So each one is made in that order — the unit, with its
/// code and its name, and then its shop, a site that belongs to it
/// (`site.unit_id`), keeps the city's clock and prints as `C014-TOKO`
/// (`site.code`, 0603). The code is written on the unit and nowhere else, and
/// the database furnishes both as they land: the unit its return pool at the
/// Gudang, the shop its own pools and places (0610).
///
/// # The code
///
/// The caller's own, when it sends one; otherwise the next number in the
/// client's `C001` series, after the highest any unit holds — not after the
/// count, so a store that closed never has its code handed out again. A code
/// another unit already holds is refused by name before anything is written.
///
/// # Ids are minted, never read back
///
/// The unit's and the shop's id are internal and never shown. They are made
/// from the code at birth — `store-c014`, the shop keyed like its unit, as
/// every store so far is — so they are unique without asking anything, and
/// nothing reads meaning out of them afterwards: the next store's code comes
/// from `unit.code`, and what a site is comes from its row.
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
    // Each store as asked for: its own code when one was sent, its name and
    // its city.
    let mut wanted: Vec<(Option<String>, String, String)> =
        Vec::with_capacity(request.stores.len());
    for store in &request.stores {
        let name = required(&store.name, "store name", 80)?;
        let code = unit_code_of(store.code.as_deref(), &name)?;
        let city = store.city.trim().to_owned();
        if city.chars().count() > 80 {
            return Err(AppError::Validation(format!(
                "the city for {name} is too long"
            )));
        }
        if let Some(code) = &code {
            if wanted
                .iter()
                .any(|(other, _, _)| other.as_ref() == Some(code))
            {
                return Err(AppError::Validation(format!(
                    "the code {code} is given to two stores"
                )));
            }
        }
        wanted.push((code, name, city));
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
    // Two people opening stores at once would read the same next number, or
    // both find a code free.
    sqlx::query("SELECT pg_advisory_xact_lock(hashtext('setup.stores.open'))")
        .execute(&mut *transaction)
        .await?;

    // A store's returned goods land at head office's Gudang, so there must be
    // a head office — found by its kind — and a shop must have pools to open
    // with.
    if head_office(&mut transaction).await?.is_none() {
        return Err(AppError::Conflict("describe the business first".into()));
    }
    if !has_pool_template(&mut transaction, "STORE").await? {
        return Err(AppError::Conflict(
            "there is no store template to open a store from".into(),
        ));
    }

    // The client's series continues after the highest number any unit holds,
    // and after any the caller sent, so a code given in this batch is not
    // given again to the row below it.
    let mut highest: i32 = sqlx::query_scalar(
        "SELECT COALESCE(max(substring(code FROM '^C([0-9]{1,9})$')::int), 0) FROM unit",
    )
    .fetch_one(&mut *transaction)
    .await?;
    for (code, _, _) in &wanted {
        if let Some(number) = code.as_deref().and_then(series_number) {
            highest = highest.max(number);
        }
    }
    let mut stores = Vec::with_capacity(wanted.len());
    for (code, name, city) in wanted {
        let code = match code {
            Some(code) => code,
            None => {
                highest += 1;
                format!("C{highest:03}")
            }
        };
        stores.push((code, name, city));
    }

    // A code somebody already has is refused by name, before any row is
    // written, so the owner reads which one rather than a unique index.
    let codes: Vec<String> = stores.iter().map(|(code, _, _)| code.clone()).collect();
    let taken: Vec<String> =
        sqlx::query_scalar("SELECT code FROM unit WHERE code = ANY($1) ORDER BY code")
            .bind(&codes)
            .fetch_all(&mut *transaction)
            .await?;
    if !taken.is_empty() {
        let verb = if taken.len() == 1 {
            "belongs"
        } else {
            "belong"
        };
        return Err(AppError::Conflict(format!(
            "{} already {verb} to another unit",
            taken.join(", ")
        )));
    }

    let mut created = Vec::with_capacity(stores.len());
    for (code, name, city) in stores {
        let unit_id = format!("store-{}", code.to_ascii_lowercase());
        let site_id = unit_id.clone();
        let timezone = timezone_of(&city);

        // The unit: the books, the people and the client's code are its. Its
        // return pool at the Gudang comes with it
        // (`store_unit_is_given_its_return_pools`).
        sqlx::query("INSERT INTO unit (id, code, name, kind) VALUES ($1, $2, $3, 'STORE')")
            .bind(&unit_id)
            .bind(&code)
            .bind(&name)
            .execute(&mut *transaction)
            .await
            .map_err(|error| duplicate_as_conflict(error, &code))?;

        // Its shop, which belongs to it and prints as its code. Its pools and
        // their places come with it (`site_is_given_its_pools`).
        sqlx::query(
            "INSERT INTO site (id, name, kind, edge_node_id, unit_id, code, city, timezone)
             VALUES ($1, $2, 'STORE', $3, $4, $5, $6, $7)",
        )
        .bind(&site_id)
        .bind(&name)
        .bind(format!("{site_id}-edge"))
        .bind(&unit_id)
        .bind(format!("{code}-TOKO"))
        .bind(&city)
        .bind(timezone)
        .execute(&mut *transaction)
        .await
        .map_err(|error| duplicate_as_conflict(error, &code))?;

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

/// Head office's site, when there is one — found by its kind, through the one
/// definition of head office (`head_office_site_id()`, 0603), and never by an
/// id.
async fn head_office(
    transaction: &mut Transaction<'_, Postgres>,
) -> Result<Option<String>, AppError> {
    Ok(
        sqlx::query_scalar::<_, Option<String>>("SELECT head_office_site_id()")
            .fetch_one(&mut **transaction)
            .await?,
    )
}

/// Whether the pool template furnishes a site of this kind (0610). Without it
/// a site would open with nowhere to put a single piece, so it is refused
/// instead.
async fn has_pool_template(
    transaction: &mut Transaction<'_, Postgres>,
    site_kind: &str,
) -> Result<bool, AppError> {
    Ok(sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS (SELECT 1 FROM pool_template WHERE site_kind = $1)",
    )
    .bind(site_kind)
    .fetch_one(&mut **transaction)
    .await?)
}

/// Make head office for a company that has none: its unit, then its site — the
/// same order a store is made in, and the same furnishing: the site is given
/// the Gudang's pools and places by the template as it lands (0610). A company
/// that already has the unit of kind HO keeps it (`head_office_unit_id()`,
/// 0605); only the premises are made.
///
/// Both ids are minted here, where there is nothing yet to look up: `ho` for
/// the unit, as head office's unit is keyed wherever it already exists, and
/// `ho-gudang` for its site. They are internal and never shown — people read
/// the unit's code, `HO`, and the site's, `HO-GUDANG` — and everything after
/// the insert finds head office by its kind.
async fn open_head_office(transaction: &mut Transaction<'_, Postgres>) -> Result<(), AppError> {
    if !has_pool_template(transaction, "HO").await? {
        return Err(AppError::Conflict(
            "there is no head-office template to set the company up from".into(),
        ));
    }

    // The unit people at head office are posted to, and whose books carry
    // every inter-unit balance: the one of kind HO, made when absent.
    let existing = sqlx::query_scalar::<_, Option<String>>("SELECT head_office_unit_id()")
        .fetch_one(&mut **transaction)
        .await?;
    let unit_id: String = match existing {
        Some(unit_id) => unit_id,
        None => {
            sqlx::query_scalar(
                "INSERT INTO unit (id, code, name, kind)
                 VALUES ('ho', 'HO', 'Head Office', 'HO')
                 RETURNING id",
            )
            .fetch_one(&mut **transaction)
            .await?
        }
    };

    sqlx::query(
        "INSERT INTO site (id, name, kind, edge_node_id, unit_id, code)
         VALUES ('ho-gudang', 'Head office', 'HO', 'ho-gudang-edge', $1, 'HO-GUDANG')",
    )
    .bind(&unit_id)
    .execute(&mut **transaction)
    .await?;
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

/// A store's client code as the caller sent it, if it sent one: ` c014` is
/// `C014`, and blank is none — the store is then given the next number in the
/// series.
///
/// Letters and digits, as `unit.code` admits (0600), and short enough that
/// the shop's printed code, `C014-TOKO`, still fits `site.code` (0603).
fn unit_code_of(value: Option<&str>, store: &str) -> Result<Option<String>, AppError> {
    let code = value.unwrap_or_default().trim().to_ascii_uppercase();
    if code.is_empty() {
        return Ok(None);
    }
    if code.len() > MAX_UNIT_CODE
        || !code
            .chars()
            .all(|character| character.is_ascii_uppercase() || character.is_ascii_digit())
    {
        return Err(AppError::Validation(format!(
            "{code} is not a store code for {store}: letters and digits only, at \
             most {MAX_UNIT_CODE}, e.g. C014"
        )));
    }
    Ok(Some(code))
}

/// The number a code holds in the client's `C001` series — `C014` is 14 — or
/// `None` for a code outside it. The same reading as the SQL that finds the
/// highest one (`open_stores`) and the hub's preview (`screens/setup/names.ts`).
fn series_number(code: &str) -> Option<i32> {
    let digits = code.strip_prefix('C')?;
    if digits.is_empty()
        || digits.len() > MAX_SERIES_DIGITS
        || !digits.chars().all(|character| character.is_ascii_digit())
    {
        return None;
    }
    digits.parse().ok()
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
    const WITA: [&str; 18] = [
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
        "tarakan",
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

/// A unique index that refused a new unit or its shop, as a conflict naming
/// the store's code: another request took it in the meantime, or a site
/// already has the id or the printed code the new one would get.
fn duplicate_as_conflict(error: sqlx::Error, code: &str) -> AppError {
    match &error {
        sqlx::Error::Database(db) if db.code().as_deref() == Some("23505") => AppError::Conflict(
            format!("store {code} collides with a unit or a site that already exists"),
        ),
        _ => AppError::Database(error),
    }
}
