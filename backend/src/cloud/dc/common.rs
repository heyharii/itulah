//! What every area of the cloud-run Gudang shares (DC-CLOUD-NATIVE.md).

use crate::cloud::AppError;
use sqlx::{PgPool, Postgres, Transaction};

/// The origin the cloud-run Gudang's records carry where the cloud's tables
/// require one (`goods_receipt.origin_id`, a fact's `(origin, generation,
/// seq)`). Registered as role DC at the head-office site with inventory
/// DISABLED: it owns no site, so the resolvers (`inventory_dc_owner_tx`,
/// `sole_dc_origin_tx`) find no node and the cloud executes the Gudang's
/// allotments and counts itself; nothing is ever sent to it.
pub const CLOUD_DC_ORIGIN: &str = "dc-cloud";
/// Its stream never rotates: the cloud is the Gudang.
pub const CLOUD_DC_GENERATION: i64 = 1;

/// Whether this cloud runs the Gudang (`INVENTORY_DC_HOSTING=cloud`). The
/// default is a DC server in the warehouse.
pub fn hosted() -> bool {
    std::env::var("INVENTORY_DC_HOSTING")
        .map(|value| value.trim().eq_ignore_ascii_case("cloud"))
        .unwrap_or(false)
}

/// Every Gudang route starts here: a deployment whose warehouse runs its own
/// server answers that it does, instead of doing the work twice.
pub fn require_hosted() -> Result<(), AppError> {
    if hosted() {
        Ok(())
    } else {
        Err(AppError::NotFound(
            "this Gudang runs on its own server; its work is done there (/edge)".into(),
        ))
    }
}

/// The Gudang's site: head office, found by its kind (0603), never by id.
pub async fn gudang_site(db: &PgPool) -> Result<String, AppError> {
    let site: Option<String> = sqlx::query_scalar("SELECT head_office_site_id()")
        .fetch_one(db)
        .await?;
    site.ok_or_else(|| {
        AppError::Unprocessable(
            "there is no head-office site yet; finish the setup before receiving goods".into(),
        )
    })
}

/// The same, inside a transaction.
pub async fn gudang_site_tx(tx: &mut Transaction<'_, Postgres>) -> Result<String, AppError> {
    let site: Option<String> = sqlx::query_scalar("SELECT head_office_site_id()")
        .fetch_one(&mut **tx)
        .await?;
    site.ok_or_else(|| {
        AppError::Unprocessable(
            "there is no head-office site yet; finish the setup before receiving goods".into(),
        )
    })
}

/// Make sure [`CLOUD_DC_ORIGIN`] is registered (once; cheap after). Its key
/// is random and thrown away: nothing ever syncs as this origin.
pub async fn ensure_origin(db: &PgPool) -> Result<(), AppError> {
    let present: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM sync_origin_credential WHERE origin_id = $1)",
    )
    .bind(CLOUD_DC_ORIGIN)
    .fetch_one(db)
    .await?;
    if present {
        return Ok(());
    }
    let site = gudang_site(db).await?;
    let key = format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    );
    crate::cloud::postgres::register_origin_credential_binding(
        db,
        CLOUD_DC_ORIGIN,
        &key,
        Some("The Gudang, run by the cloud"),
        Some(&site),
        Some("DC"),
        Some(CLOUD_DC_GENERATION),
        Some(false),
    )
    .await
}

/// The next position in the cloud-run Gudang's own record stream: what the
/// appliers key a record by when a DC server would have sent a fact
/// (`(CLOUD_DC_ORIGIN, CLOUD_DC_GENERATION, seq)`). Never reused (0915).
pub async fn next_seq(tx: &mut Transaction<'_, Postgres>) -> Result<i64, AppError> {
    Ok(sqlx::query_scalar("SELECT nextval('cloud_dc_record_seq')")
        .fetch_one(&mut **tx)
        .await?)
}

/// The next number of a document series in a year — koli, surat jalan,
/// dispatch, goods receipt — gap-free and per site (0915). Taken inside the
/// transaction that writes the document, so a rolled-back document gives its
/// number back.
pub async fn next_number(
    tx: &mut Transaction<'_, Postgres>,
    site_id: &str,
    series: &str,
    year: i32,
) -> Result<i64, AppError> {
    Ok(sqlx::query_scalar(
        "INSERT INTO dc_number_series (site_id, series, year, last_number)
         VALUES ($1, $2, $3, 1)
         ON CONFLICT (site_id, series, year)
         DO UPDATE SET last_number = dc_number_series.last_number + 1
         RETURNING last_number",
    )
    .bind(site_id)
    .bind(series)
    .bind(year)
    .fetch_one(&mut **tx)
    .await?)
}

/// The site's code as it is printed on documents (`HO-GUDANG`), falling back
/// to the id upper-cased.
pub async fn site_code_tx(
    tx: &mut Transaction<'_, Postgres>,
    site_id: &str,
) -> Result<String, AppError> {
    let code: Option<String> = sqlx::query_scalar("SELECT code FROM site WHERE id = $1")
        .bind(site_id)
        .fetch_optional(&mut **tx)
        .await?
        .flatten();
    Ok(code
        .filter(|code| !code.trim().is_empty())
        .unwrap_or_else(|| site_id.to_ascii_uppercase()))
}
