//! Head office giving a delivery its identity, and sending the tags down.
//!
//! # The shape of it
//!
//! A delivery has been counted and a second person has accepted the count, so
//! the goods exist — as a quantity of an article, sitting in `unidentified`.
//! They cannot be picked or sold, because there is nothing yet to pick BY.
//!
//! Head office opens a setup session against that receipt, names the article,
//! files it under a division, splits it into the colour/size variants that
//! actually arrived, and prices each one. Issuing the session does four things
//! in one transaction:
//!
//!   1. mints the article and its SKUs, if this is the first delivery of them;
//!   2. draws a serial range per SKU from the centre's counter;
//!   3. encodes every EPC;
//!   4. sends the lot down as one tagging job.
//!
//! # Why all four are one transaction
//!
//! A serial range drawn and then not sent is a hole in the numbering that
//! nothing will ever fill. A job sent against SKUs that failed to mint is a
//! DC printing labels for products the centre does not have. Either half
//! without the other is worse than neither.

use super::sync::issue_command_tx;
use crate::cloud::application::AppError;
use crate::cloud::domain::{
    encode_epc_range, sku_code, validate_article_code, COMMAND_TAGGING_JOB_ACTIVATE,
    MAX_TAGGING_JOB_UNITS,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::{PgPool, Postgres, Row, Transaction};
use uuid::Uuid;

/// One colourway being declared: which digit it occupies in the SKU, and which
/// colour of the company's own list that digit stands for.
///
/// This used to be a free-text label with an optional hex, and that is what
/// `0081` came to fix: three sessions typing "Navy", "navy" and "Biru Navy"
/// produced three colours nothing could tell apart, so a colour filter over
/// the catalogue answered a question about spelling. The colour is picked from
/// `colour` now. The name and the swatch live there, once, and renaming one
/// renames it everywhere rather than on the article somebody remembered.
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct NewSetupColour {
    pub colour_digit: String,
    pub colour_code: String,
}

/// One (colour, size) actually present in the delivery.
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct NewSetupVariant {
    pub colour_digit: String,
    pub size_code: String,
    pub quantity: i64,
    pub base_price_minor: i64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct NewSetupSession {
    /// The line of the delivery this identity is being decided for. One
    /// truck brings several articles, and each is a different product — so a
    /// session works out a line, not a whole receipt.
    ///
    /// Everything hangs off it: a session that named no delivery could mint
    /// stock by describing it.
    pub receipt_line_id: Uuid,
    /// Which article this delivery is, when it is one we already sell.
    ///
    /// `None` means a product new to the company, and a fresh eight-digit code
    /// is minted for it. `Some` attaches this delivery to an article that
    /// already exists, so a second shipment reuses the SKUs the first one
    /// created instead of quietly becoming a different product.
    ///
    /// The code on the purchase order is never used here: that one is the
    /// supplier's.
    #[serde(default)]
    pub article_code: Option<String>,
    pub article_name: String,
    pub division_code: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub image_url: Option<String>,
    pub currency: String,
    pub colours: Vec<NewSetupColour>,
    pub variants: Vec<NewSetupVariant>,
    pub created_by: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct SetupSessionSummary {
    pub session_id: Uuid,
    pub receipt_line_id: Uuid,
    pub article_code: String,
    pub article_name: String,
    pub division_code: String,
    pub receipt_quantity: i64,
    pub declared_quantity: i64,
    pub destination_site_id: String,
    pub status: String,
    pub created_by: String,
    pub created_at: DateTime<Utc>,
}

fn single_digit(value: &str, what: &str) -> Result<char, AppError> {
    let trimmed = value.trim();
    let mut chars = trimmed.chars();
    match (chars.next(), chars.next()) {
        (Some(digit), None) if digit.is_ascii_digit() => Ok(digit),
        _ => Err(AppError::Validation(format!(
            "{what} {value:?} must be a single digit 0-9"
        ))),
    }
}

/// Mint the next article code.
///
/// Called when a product enters this company's catalogue for the first time.
/// The eight digits are ours and only ours: the code on the purchase order is
/// the supplier's, and it helps a warehouse match a carton to a line and
/// nothing more. Two suppliers will use the same code for different goods, and
/// one supplier will change theirs between shipments, so it can never be an
/// identity.
///
/// This matters concretely rather than philosophically: a SKU is this code
/// plus a colour digit plus a size code. An article code that did not come
/// from here can never have a SKU, so it can never be tagged, priced or sold.
pub async fn mint_article_code(pool: &PgPool) -> Result<String, AppError> {
    let next: i64 = sqlx::query_scalar("SELECT nextval('article_code_seq')")
        .fetch_one(pool)
        .await?;
    format_article_code(next)
}

async fn mint_article_code_tx(tx: &mut Transaction<'_, Postgres>) -> Result<String, AppError> {
    let next: i64 = sqlx::query_scalar("SELECT nextval('article_code_seq')")
        .fetch_one(&mut **tx)
        .await?;
    format_article_code(next)
}

fn format_article_code(next: i64) -> Result<String, AppError> {
    crate::cloud::domain::article_code(next as u64).map_err(|error| {
        // The sequence is capped at eight digits, so reaching here means the
        // company has run out of article codes — not that an argument was bad.
        AppError::Configuration(format!("article codes are exhausted: {error}"))
    })
}

/// Open a session for a delivery that has been received and accepted.
///
/// The article code is not chosen here — it comes from the purchase order the
/// goods were bought against, because that is what the warehouse counted and
/// what the supplier shipped. Head office decides what the article IS, not
/// what it is called by the ordering system.
pub async fn create_setup_session(
    pool: &PgPool,
    request: &NewSetupSession,
) -> Result<Uuid, AppError> {
    if request.article_name.trim().is_empty() {
        return Err(AppError::Validation("the article needs a name".into()));
    }
    if request.created_by.trim().is_empty() {
        return Err(AppError::Validation(
            "a setup session must name who opened it".into(),
        ));
    }
    if request.currency.trim().len() != 3 {
        return Err(AppError::Validation(
            "currency must be a three-letter code".into(),
        ));
    }
    if request.colours.is_empty() {
        return Err(AppError::Validation(
            "an article needs at least one colourway".into(),
        ));
    }
    if request.variants.is_empty() {
        return Err(AppError::Validation(
            "a setup session must say what actually arrived".into(),
        ));
    }
    // One digit of colour means ten colourways, ever. Saying so here is far
    // kinder than letting the eleventh fail somewhere deeper.
    if request.colours.len() > 10 {
        return Err(AppError::Validation(format!(
            "an article can carry at most ten colourways; {} were declared. \
             The colour is one digit of the SKU, so there is no eleventh value",
            request.colours.len()
        )));
    }

    let mut tx = pool.begin().await?;

    // What was received, and where. Reading it here rather than trusting the
    // caller means a session can only ever be opened against real goods.
    let receipt = sqlx::query(
        "SELECT r.quantity, r.matched_quantity, r.excess_quantity,
                l.article_code, o.destination_site_id
         FROM goods_receipt_line r
         JOIN purchase_order_line l ON l.po_line_id = r.po_line_id
         JOIN purchase_order o ON o.purchase_order_id = l.purchase_order_id
         WHERE r.receipt_line_id = $1",
    )
    .bind(request.receipt_line_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| {
        AppError::Validation(format!(
            "no accepted delivery line {}: goods must be received before they can be identified",
            request.receipt_line_id
        ))
    })?;

    // The MATCHED quantity, not everything that came off the lorry. Goods
    // beyond what the order had outstanding are in the warehouse and are not
    // yet the company's to name, price and put a label on — a buyer has still
    // to say whether they are being kept or sent back.
    //
    // It is the quantity and not the whole line that waits: a delivery of 105
    // against an order of 100 gives 100 the company certainly bought, and
    // holding those up because five it did not buy shared the pallet would be
    // a control nobody asked for.
    let receipt_quantity: i64 = receipt.get("matched_quantity");
    let excess_quantity: i64 = receipt.get("excess_quantity");
    if receipt_quantity <= 0 {
        return Err(AppError::Validation(format!(
            "every piece on delivery line {} arrived beyond what the order had outstanding \
             ({excess_quantity} of them); a buyer decides whether they are kept before they \
             can be identified",
            request.receipt_line_id
        )));
    }
    // The supplier's own code, kept for traceability and never used as an
    // identity. It arrived on the order; it says what the supplier calls the
    // thing, not what it is.
    let supplier_article_code: String = receipt.get("article_code");
    let destination_site_id: String = receipt.get("destination_site_id");

    // Ours is minted here — or reused, when head office says this delivery is
    // more of something we already sell.
    let article_code = match request.article_code.as_deref().map(str::trim) {
        None | Some("") => mint_article_code_tx(&mut tx).await?,
        Some(existing) => {
            validate_article_code(existing).map_err(AppError::Validation)?;
            let known: Option<String> =
                sqlx::query_scalar("SELECT article_code FROM article WHERE article_code = $1")
                    .bind(existing)
                    .fetch_optional(&mut *tx)
                    .await?;
            // Attaching to an article that does not exist would create it with
            // a code nothing minted, which is the hole this whole rule exists
            // to close.
            known.ok_or_else(|| {
                AppError::Validation(format!(
                    "no article {existing}: leave the code empty to mint a new one, \
                     or give the code of an article that already exists"
                ))
            })?
        }
    };

    // Every variant must name a colour the session declared, and the
    // quantities must account for the delivery exactly.
    let declared: std::collections::HashSet<&str> = request
        .colours
        .iter()
        .map(|colour| colour.colour_digit.trim())
        .collect();
    let mut total = 0i64;
    for variant in &request.variants {
        if !declared.contains(variant.colour_digit.trim()) {
            return Err(AppError::Validation(format!(
                "variant uses colour {} which this session never declared",
                variant.colour_digit
            )));
        }
        if variant.quantity <= 0 {
            return Err(AppError::Validation(
                "a variant of nothing is not a variant".into(),
            ));
        }
        if variant.base_price_minor < 0 {
            return Err(AppError::Validation(
                "a selling price cannot be negative".into(),
            ));
        }
        total = total
            .checked_add(variant.quantity)
            .ok_or_else(|| AppError::Validation("the declared quantities overflow".into()))?;
    }
    if total != receipt_quantity {
        return Err(AppError::Validation(format!(
            "the variants account for {total} units but {receipt_quantity} were received \
             and accepted. Every piece must be accounted for: anything less strands goods \
             in `unidentified` with no job to rescue them, anything more invents stock"
        )));
    }
    if total > MAX_TAGGING_JOB_UNITS {
        return Err(AppError::Validation(format!(
            "a delivery of {total} units exceeds the {MAX_TAGGING_JOB_UNITS} a single \
             tagging job can carry"
        )));
    }

    let session_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO article_setup_session
             (session_id, receipt_line_id, article_code, supplier_article_code, receipt_quantity,
              destination_site_id, article_name, division_code, image_url, currency,
              created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
    )
    .bind(session_id)
    .bind(request.receipt_line_id)
    .bind(&article_code)
    .bind(&supplier_article_code)
    .bind(receipt_quantity)
    .bind(&destination_site_id)
    .bind(request.article_name.trim())
    .bind(request.division_code.trim())
    .bind(&request.image_url)
    .bind(request.currency.trim().to_uppercase())
    .bind(request.created_by.trim())
    .execute(&mut *tx)
    .await
    .map_err(|error| {
        // The UNIQUE on receipt_line_id is the guard that stops one delivery
        // line being given two identities.
        if is_unique_violation(&error) {
            AppError::Validation(format!(
                "delivery line {} has already been set up",
                request.receipt_line_id
            ))
        } else {
            AppError::from(error)
        }
    })?;

    // Tags come from the vocabulary, so a word nobody has defined is refused
    // here rather than quietly filed under a spelling that does not exist.
    for tag in &request.tags {
        sqlx::query(
            "INSERT INTO article_setup_session_tag (session_id, tag_code) VALUES ($1, $2)
             ON CONFLICT DO NOTHING",
        )
        .bind(session_id)
        .bind(tag.trim())
        .execute(&mut *tx)
        .await
        .map_err(|error| {
            AppError::Validation(format!("tag {tag:?} is not in the tag vocabulary: {error}"))
        })?;
    }

    for colour in &request.colours {
        let digit = single_digit(&colour.colour_digit, "colour")?;
        let code = colour.colour_code.trim().to_uppercase();
        if code.is_empty() {
            return Err(AppError::Validation(format!(
                "colour {digit} names no colour; colours are picked from the master, not typed"
            )));
        }
        // Refused here rather than left to the foreign key, because "insert or
        // update violates foreign key constraint" names a constraint and not
        // the word somebody got wrong. A retired colour is refused too: a
        // delivery being set up today is new goods, and new goods should not
        // be filed under a shade merchandising has stopped offering.
        let offered: bool =
            sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM colour WHERE code = $1 AND active)")
                .bind(&code)
                .fetch_one(&mut *tx)
                .await?;
        if !offered {
            return Err(AppError::Validation(format!(
                "colour {code:?} is not in the colour master, or has been retired; \
                 pick one that is on offer"
            )));
        }
        sqlx::query(
            "INSERT INTO article_setup_colour (session_id, colour_digit, colour_code)
             VALUES ($1,$2,$3)",
        )
        .bind(session_id)
        .bind(digit.to_string())
        .bind(&code)
        .execute(&mut *tx)
        .await
        .map_err(|error| {
            if is_unique_violation(&error) {
                AppError::Validation(format!(
                    "colour {code:?} is declared twice under different digits; \
                     two SKUs no picker can tell apart"
                ))
            } else {
                AppError::from(error)
            }
        })?;
    }

    for variant in &request.variants {
        let digit = single_digit(&variant.colour_digit, "colour")?;
        sqlx::query(
            "INSERT INTO article_setup_variant
                 (session_id, colour_digit, size_code, target_quantity, base_price_minor)
             VALUES ($1,$2,$3,$4,$5)",
        )
        .bind(session_id)
        .bind(digit.to_string())
        .bind(variant.size_code.trim())
        .bind(variant.quantity)
        .bind(variant.base_price_minor)
        .execute(&mut *tx)
        .await
        .map_err(|error| {
            if is_unique_violation(&error) {
                AppError::Validation(format!(
                    "colour {} size {} appears twice",
                    variant.colour_digit, variant.size_code
                ))
            } else {
                AppError::from(error)
            }
        })?;
    }

    tx.commit().await?;
    Ok(session_id)
}

fn is_unique_violation(error: &sqlx::Error) -> bool {
    matches!(error, sqlx::Error::Database(db) if db.code().as_deref() == Some("23505"))
}

/// Draw the next `quantity` serials for a SKU.
///
/// The row lock is the whole mechanism: two jobs for the same SKU issued at
/// the same instant queue behind each other and get adjacent ranges. Without
/// it they would read the same `last_serial` and mint the same EPCs, and two
/// garments carrying one identity cannot be untangled once the tags are on.
async fn allocate_serials(
    tx: &mut Transaction<'_, Postgres>,
    sku: &str,
    quantity: i64,
) -> Result<i64, AppError> {
    sqlx::query(
        "INSERT INTO epc_serial_counter (sku_code, last_serial) VALUES ($1, 0)
         ON CONFLICT (sku_code) DO NOTHING",
    )
    .bind(sku)
    .execute(&mut **tx)
    .await?;
    let last: i64 = sqlx::query_scalar(
        "SELECT last_serial FROM epc_serial_counter WHERE sku_code = $1 FOR UPDATE",
    )
    .bind(sku)
    .fetch_one(&mut **tx)
    .await?;
    let start = last
        .checked_add(1)
        .ok_or_else(|| AppError::Validation(format!("serial counter for {sku} overflowed")))?;
    let end = start
        .checked_add(quantity - 1)
        .ok_or_else(|| AppError::Validation(format!("serial counter for {sku} overflowed")))?;
    sqlx::query(
        "UPDATE epc_serial_counter SET last_serial = $2, updated_at = now() WHERE sku_code = $1",
    )
    .bind(sku)
    .bind(end)
    .execute(&mut **tx)
    .await?;
    Ok(start)
}

/// Publish the prices a setup just decided, as a price book of its own.
///
/// Price reaches a till through exactly one mechanism — a commercial
/// publication — and this is where a newly minted SKU gets its first one. The
/// alternative was a second authority: a `base_price_minor` sitting on the SKU
/// that the pricing engine never read, which is how a garment came to carry one
/// price on its label and another at the counter.
///
/// One book per setup session rather than per SKU: a session issues every
/// colour and size at once, so that is the natural unit and it keeps the number
/// of publications down to the number of decisions.
///
/// STORE only. Setup does not know which channels this business runs, and
/// asserting an online price for a channel that may not operate would be
/// inventing a commercial decision rather than recording one.
async fn publish_setup_prices(
    tx: &mut Transaction<'_, Postgres>,
    job_lines: &[Value],
    currency: &str,
    article_name: &str,
    issued_by: &str,
) -> Result<i64, AppError> {
    if job_lines.is_empty() {
        return Ok(0);
    }
    // Serialise version allocation without blocking readers. Two setups issued
    // at the same moment would otherwise pick the same number, and a version is
    // unique across the fleet.
    sqlx::query("SELECT pg_advisory_xact_lock(hashtext('commercial_publication_version'))")
        .execute(&mut **tx)
        .await?;
    let version: i64 =
        sqlx::query_scalar("SELECT COALESCE(MAX(version), 0) + 1 FROM commercial_publication")
            .fetch_one(&mut **tx)
            .await?;

    let publication_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO commercial_publication
             (id, version, name, status, effective_from, created_by)
         VALUES ($1, $2, $3, 'DRAFT', now(), $4)",
    )
    .bind(publication_id)
    .bind(version)
    .bind(format!("Harga awal · {article_name}"))
    .bind(issued_by)
    .execute(&mut **tx)
    .await?;

    // Every price needs a tax category, and a SKU has none anywhere in the
    // master data — so one is named here. The right home for it is the setup
    // form, beside division and tags: a tax class is a property of the goods,
    // not of a price. Until it lives there, this is the constant the rest of
    // the system already assumes.
    sqlx::query(
        "INSERT INTO commercial_tax_rule (id, publication_id, tax_category, rate_bps, tax_inclusive)
         VALUES (gen_random_uuid(), $1, $2, 0, true)",
    )
    .bind(publication_id)
    .bind(SETUP_TAX_CATEGORY)
    .execute(&mut **tx)
    .await?;

    for line in job_lines {
        let sku_code = line["sku_code"].as_str().unwrap_or_default();
        let base_price_minor = line["base_price_minor"].as_i64().unwrap_or_default();
        let sku_id: Uuid = sqlx::query_scalar("SELECT id FROM sku WHERE sku_code = $1")
            .bind(sku_code)
            .fetch_one(&mut **tx)
            .await?;
        // A price and the permission to sell are authored together. One
        // without the other is either a priced product nobody may sell or a
        // sellable one with no price, and the publication check refuses both.
        sqlx::query(
            "INSERT INTO commercial_assortment_rule
                 (id, publication_id, sku_id, site_id, channel, sellable)
             VALUES (gen_random_uuid(), $1, $2, NULL, 'STORE', true)",
        )
        .bind(publication_id)
        .bind(sku_id)
        .execute(&mut **tx)
        .await?;
        sqlx::query(
            "INSERT INTO commercial_price_rule
                 (id, publication_id, sku_id, site_id, channel, currency,
                  unit_price_minor, tax_category)
             VALUES (gen_random_uuid(), $1, $2, NULL, 'STORE', $3, $4, $5)",
        )
        .bind(publication_id)
        .bind(sku_id)
        .bind(currency)
        .bind(base_price_minor)
        .bind(SETUP_TAX_CATEGORY)
        .execute(&mut **tx)
        .await?;
    }

    sqlx::query(
        "UPDATE commercial_publication
            SET status = 'PUBLISHED', published_by = $2, published_at = now()
          WHERE id = $1",
    )
    .bind(publication_id)
    .bind(issued_by)
    .execute(&mut **tx)
    .await?;

    super::commercial::dispatch_publication(tx, publication_id, issued_by).await?;
    Ok(version)
}

/// The tax class a setup-published price is filed under.
///
/// A placeholder with a name, so it is searchable when tax comes back.
const SETUP_TAX_CATEGORY: &str = "STANDARD";

/// Mint the identity and send the tagging job down.
///
/// Returns the job that was created and the command that carries it.
pub async fn issue_setup_session(
    pool: &PgPool,
    session_id: Uuid,
    issued_by: &str,
) -> Result<(Uuid, Uuid), AppError> {
    if issued_by.trim().is_empty() {
        return Err(AppError::Validation(
            "issuing a setup session must name who did it".into(),
        ));
    }
    let mut tx = pool.begin().await?;

    let session = sqlx::query(
        "SELECT receipt_line_id, article_code, article_name, division_code, image_url, currency,
                receipt_quantity, destination_site_id, status
         FROM article_setup_session WHERE session_id = $1 FOR UPDATE",
    )
    .bind(session_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("no setup session {session_id}")))?;

    let status: String = session.get("status");
    if status != "OPEN" {
        return Err(AppError::Validation(format!(
            "setup session {session_id} was already {}",
            status.to_lowercase()
        )));
    }
    let receipt_line_id: Uuid = session.get("receipt_line_id");
    let article_code: String = session.get("article_code");
    let article_name: String = session.get("article_name");
    let division_code: String = session.get("division_code");
    let image_url: Option<String> = session.get("image_url");
    let currency: String = session.get("currency");
    let receipt_quantity: i64 = session.get("receipt_quantity");
    let destination_site_id: String = session.get("destination_site_id");

    // The DC that owns this site's inventory is the one that will do the
    // tagging. Resolving it here means an unroutable job is refused at the
    // desk rather than vanishing.
    let target: Option<String> = sqlx::query_scalar(
        "SELECT origin_id FROM sync_origin_credential
         WHERE site_id = $1 AND inventory_enabled AND node_role = 'DC'",
    )
    .bind(&destination_site_id)
    .fetch_optional(&mut *tx)
    .await?;
    let Some(target) = target else {
        return Err(AppError::Validation(format!(
            "no registered DC owns site '{destination_site_id}'; \
             there is nobody to send this tagging job to"
        )));
    };

    // --- Mint the article, if this is its first delivery -------------------
    let article_id: Uuid = sqlx::query_scalar(
        "INSERT INTO article (id, article_code, name, division_code, image_url,
                              created_by_session_id)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5)
         ON CONFLICT (article_code) DO UPDATE SET name = article.name
         RETURNING id",
    )
    .bind(&article_code)
    .bind(&article_name)
    .bind(&division_code)
    .bind(&image_url)
    .bind(session_id)
    .fetch_one(&mut *tx)
    .await?;

    // The article carries the tags the session declared. A second delivery of
    // the same article adds any new ones without disturbing what is there.
    sqlx::query(
        "INSERT INTO article_tag (article_id, tag_code)
         SELECT $1, tag_code FROM article_setup_session_tag WHERE session_id = $2
         ON CONFLICT DO NOTHING",
    )
    .bind(article_id)
    .bind(session_id)
    .execute(&mut *tx)
    .await?;

    // The delivery was usually valued before this article existed (receipts
    // post within a minute of acceptance), so its cost layer could not be
    // opened then. It opens now, in this transaction, so the ledger's
    // inventory and the FIFO queue agree from the moment the article exists.
    super::payables_flow::cost_layer_on_setup(&mut tx, receipt_line_id).await?;

    // --- Mint the colourways -----------------------------------------------
    let colours = sqlx::query(
        "SELECT colour_digit, colour_code FROM article_setup_colour
         WHERE session_id = $1 ORDER BY colour_digit",
    )
    .bind(session_id)
    .fetch_all(&mut *tx)
    .await?;
    for colour in &colours {
        let digit: String = colour.get("colour_digit");
        let code: String = colour.get("colour_code");
        // A digit already in use on this article keeps the colour it has: a
        // second delivery does not get to repoint the first one's digit, which
        // would rename goods already tagged and on a shelf without changing a
        // single SKU code.
        sqlx::query(
            "INSERT INTO article_colour (article_id, colour_digit, colour_code)
             VALUES ($1,$2,$3)
             ON CONFLICT (article_id, colour_digit) DO NOTHING",
        )
        .bind(article_id)
        .bind(&digit)
        .bind(&code)
        .execute(&mut *tx)
        .await
        .map_err(|error| {
            if is_unique_violation(&error) {
                AppError::Validation(format!(
                    "article {article_code} already carries colour {code} \
                     under a different digit"
                ))
            } else {
                AppError::from(error)
            }
        })?;
    }

    // --- Mint the SKUs and draw their serials ------------------------------
    let variants = sqlx::query(
        "SELECT v.colour_digit, v.size_code, v.target_quantity, v.base_price_minor,
                m.label AS colour_label, s.label AS size_label
         FROM article_setup_variant v
         JOIN article_setup_colour c
              ON c.session_id = v.session_id AND c.colour_digit = v.colour_digit
         -- The colour's name comes from the master now, and is copied onto the
         -- job line below. That copy is deliberate and stays a copy: a printed
         -- label is a snapshot of the day it was printed, and must not change
         -- when somebody renames the colour a year later.
         JOIN colour m ON m.code = c.colour_code
         JOIN size_code s ON s.code = v.size_code
         WHERE v.session_id = $1
         ORDER BY v.colour_digit, v.size_code",
    )
    .bind(session_id)
    .fetch_all(&mut *tx)
    .await?;
    if variants.is_empty() {
        return Err(AppError::Validation(format!(
            "setup session {session_id} declares no variants"
        )));
    }

    let job_id = Uuid::new_v4();
    let issued_at = Utc::now();
    // The job header lands before its lines, because the lines point at it.
    sqlx::query(
        "INSERT INTO tagging_job
             (job_id, session_id, site_id, article_code, article_name, image_url,
              total_quantity, issued_by, issued_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
    )
    .bind(job_id)
    .bind(session_id)
    .bind(&destination_site_id)
    .bind(&article_code)
    .bind(&article_name)
    .bind(&image_url)
    .bind(receipt_quantity)
    .bind(issued_by.trim())
    .bind(issued_at)
    .execute(&mut *tx)
    .await?;

    let mut job_lines: Vec<Value> = Vec::with_capacity(variants.len());
    let mut declared_total = 0i64;

    for variant in &variants {
        let colour_digit: String = variant.get("colour_digit");
        let size_code: String = variant.get("size_code");
        let quantity: i64 = variant.get("target_quantity");
        let base_price_minor: i64 = variant.get("base_price_minor");
        let colour_label: String = variant.get("colour_label");
        let size_label: String = variant.get("size_label");

        let digit = single_digit(&colour_digit, "colour")?;
        // Derived, never accepted. A malformed article code or an
        // out-of-range colour cannot reach the catalogue through here.
        let sku = sku_code(&article_code, digit, &size_code).map_err(AppError::Validation)?;
        let qr = crate::cloud::domain::qr_payload(&sku).map_err(AppError::Validation)?;
        let barcode = crate::cloud::domain::barcode_payload(&sku).map_err(AppError::Validation)?;

        sqlx::query(
            "INSERT INTO sku (id, article_id, sku_code, color, size, colour_digit, size_code,
                              base_price_minor, currency, qr_payload, created_by_session_id)
             VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
             ON CONFLICT (sku_code) DO NOTHING",
        )
        .bind(article_id)
        .bind(&sku)
        .bind(&colour_label)
        .bind(&size_label)
        .bind(&colour_digit)
        .bind(&size_code)
        .bind(base_price_minor)
        .bind(&currency)
        .bind(&qr)
        .bind(session_id)
        .execute(&mut *tx)
        .await?;

        let serial_from = allocate_serials(&mut tx, &sku, quantity).await?;
        let epcs = encode_epc_range(&sku, serial_from as u64, quantity as u64)
            .map_err(AppError::Validation)?;

        sqlx::query(
            "INSERT INTO tagging_job_line
                 (job_id, sku_code, colour_digit, colour_label, size_code, size_label,
                  quantity, serial_from, serial_to, qr_payload, barcode_payload,
                  base_price_minor)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
        )
        .bind(job_id)
        .bind(&sku)
        .bind(&colour_digit)
        .bind(&colour_label)
        .bind(&size_code)
        .bind(&size_label)
        .bind(quantity)
        .bind(serial_from)
        .bind(serial_from + quantity - 1)
        .bind(&qr)
        .bind(&barcode)
        .bind(base_price_minor)
        .execute(&mut *tx)
        .await?;

        job_lines.push(json!({
            "sku_code": sku,
            "colour_digit": colour_digit,
            "colour_label": colour_label,
            "size_code": size_code,
            "size_label": size_label,
            "quantity": quantity,
            "qr_payload": qr,
            "barcode_payload": barcode,
            "base_price_minor": base_price_minor,
            "epcs": epcs,
        }));
        declared_total += quantity;
    }

    if declared_total != receipt_quantity {
        // The session checked this when it was opened; checking again at issue
        // catches anything edited in between.
        return Err(AppError::Validation(format!(
            "the variants account for {declared_total} units but {receipt_quantity} \
             were received"
        )));
    }

    // The setup's own price book, published and on its way to the shops before
    // the tagging job leaves. A garment cannot arrive somewhere unsellable.
    let _price_book_version =
        publish_setup_prices(&mut tx, &job_lines, &currency, &article_name, issued_by).await?;

    let payload = json!({
        "job_id": job_id,
        "session_id": session_id,
        "receipt_line_id": receipt_line_id,
        "site_id": destination_site_id,
        "article_code": article_code,
        "article_name": article_name,
        "image_url": image_url,
        "total_quantity": receipt_quantity,
        "issued_at": issued_at,
        "lines": job_lines,
    });

    let command_id = issue_command_tx(
        &mut tx,
        COMMAND_TAGGING_JOB_ACTIVATE,
        &payload,
        issued_by.trim(),
        None,
        std::slice::from_ref(&target),
    )
    .await?;

    sqlx::query("UPDATE tagging_job SET command_id = $2 WHERE job_id = $1")
        .bind(job_id)
        .bind(command_id)
        .execute(&mut *tx)
        .await?;
    sqlx::query(
        "UPDATE article_setup_session
         SET status = 'ISSUED', issued_by = $2, issued_at = $3, tagging_command_id = $4
         WHERE session_id = $1",
    )
    .bind(session_id)
    .bind(issued_by.trim())
    .bind(issued_at)
    .bind(command_id)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok((job_id, command_id))
}

/// Deliveries that have been received and accepted but not yet given an
/// identity — head office's queue.
pub async fn unidentified_receipts(pool: &PgPool) -> Result<Vec<Value>, AppError> {
    let rows = sqlx::query(
        "SELECT r.receipt_line_id, r.matched_quantity AS quantity, r.excess_quantity,
                r.verified_at, l.article_code, l.article_name,
                l.image_url, l.division_code, o.destination_site_id, o.po_number,
                g.receipt_number, g.supplier_id, g.invoice_number,
                COALESCE((SELECT array_agg(t.tag_code ORDER BY t.tag_code)
                          FROM purchase_order_line_tag t
                          WHERE t.po_line_id = l.po_line_id), '{}')::text[] AS tags
         FROM goods_receipt_line r
         JOIN goods_receipt g ON g.receipt_id = r.receipt_id
         JOIN purchase_order_line l ON l.po_line_id = r.po_line_id
         JOIN purchase_order o ON o.purchase_order_id = l.purchase_order_id
         WHERE NOT EXISTS (
             SELECT 1 FROM article_setup_session s
             WHERE s.receipt_line_id = r.receipt_line_id
         )
           -- A line that is nothing but excess has nothing to identify yet.
           -- It is not lost: it sits in the buyer's excess queue until they
           -- say whether the company is keeping it.
           AND r.matched_quantity > 0
         ORDER BY r.verified_at",
    )
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|row| {
            json!({
                "receipt_line_id": row.get::<Uuid, _>("receipt_line_id"),
                "receipt_number": row.get::<String, _>("receipt_number"),
                "supplier_id": row.get::<String, _>("supplier_id"),
                "invoice_number": row.get::<Option<String>, _>("invoice_number"),
                "quantity": row.get::<i64, _>("quantity"),
                // Beyond the order, and deliberately not part of the quantity
                // above: identified goods are goods the company agreed to buy.
                "excess_quantity": row.get::<i64, _>("excess_quantity"),
                "verified_at": row.get::<DateTime<Utc>, _>("verified_at"),
                // The supplier's code, named as such. Nothing downstream may
                // mistake it for ours: it never becomes part of a SKU.
                "supplier_article_code": row.get::<String, _>("article_code"),
                // Presets, not decisions. These pre-fill the setup form with
                // what the buyer wrote on the order; head office is free to
                // replace every one of them.
                "article_name": row.get::<String, _>("article_name"),
                "division_code": row.get::<Option<String>, _>("division_code"),
                "tags": row.get::<Vec<String>, _>("tags"),
                "image_url": row.get::<Option<String>, _>("image_url"),
                "site_id": row.get::<String, _>("destination_site_id"),
                "po_number": row.get::<String, _>("po_number"),
            })
        })
        .collect())
}

/// Where one setup session stands, with the job it produced.
pub async fn setup_session_status(pool: &PgPool, session_id: Uuid) -> Result<Value, AppError> {
    let session = sqlx::query(
        // The supplier comes back through the delivery this session was opened
        // against. It is not on the session row and it should not be: a
        // session records what head office DECIDED, and who sent the goods is
        // a fact about the receipt. Left-joined because a receipt line can be
        // removed from under a session that has already minted, and a record
        // that 404s because its delivery was tidied away is worse than one
        // that cannot name the supplier.
        "SELECT s.receipt_line_id, s.article_code, s.supplier_article_code, s.article_name,
                s.division_code,
                s.receipt_quantity, s.destination_site_id, s.status, s.currency,
                s.created_by, s.created_at, s.issued_at, s.tagged_at,
                j.job_id, j.status AS job_status, j.confirmed_by, j.confirmed_at,
                g.supplier_id
         FROM article_setup_session s
         LEFT JOIN tagging_job j ON j.session_id = s.session_id
         LEFT JOIN goods_receipt_line r ON r.receipt_line_id = s.receipt_line_id
         LEFT JOIN goods_receipt g ON g.receipt_id = r.receipt_id
         WHERE s.session_id = $1",
    )
    .bind(session_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("no setup session {session_id}")))?;

    let lines = sqlx::query(
        "SELECT l.sku_code, l.colour_digit, l.colour_label, l.size_code, l.size_label,
                l.quantity, l.serial_from, l.serial_to, l.qr_payload, l.base_price_minor
         FROM tagging_job_line l
         JOIN tagging_job j ON j.job_id = l.job_id
         WHERE j.session_id = $1
         ORDER BY l.sku_code",
    )
    .bind(session_id)
    .fetch_all(pool)
    .await?;

    let tags: Vec<String> = sqlx::query_scalar(
        "SELECT tag_code FROM article_setup_session_tag WHERE session_id = $1 ORDER BY tag_code",
    )
    .bind(session_id)
    .fetch_all(pool)
    .await?;

    Ok(json!({
        "session_id": session_id,
        "receipt_line_id": session.get::<Uuid, _>("receipt_line_id"),
        "article_code": session.get::<String, _>("article_code"),
        "supplier_article_code": session.get::<Option<String>, _>("supplier_article_code"),
        // The supplier's CODE — `SUP02` — which is what the receipt carries
        // and what the supplier book is keyed by. The name is looked up where
        // it is read, so this answer does not go stale when somebody renames a
        // supplier.
        "supplier_code": session.get::<Option<String>, _>("supplier_id"),
        "article_name": session.get::<String, _>("article_name"),
        "division_code": session.get::<String, _>("division_code"),
        "tags": tags,
        "currency": session.get::<String, _>("currency").trim(),
        "receipt_quantity": session.get::<i64, _>("receipt_quantity"),
        "site_id": session.get::<String, _>("destination_site_id"),
        "status": session.get::<String, _>("status"),
        "created_by": session.get::<String, _>("created_by"),
        "created_at": session.get::<DateTime<Utc>, _>("created_at"),
        "issued_at": session.get::<Option<DateTime<Utc>>, _>("issued_at"),
        "tagged_at": session.get::<Option<DateTime<Utc>>, _>("tagged_at"),
        "job": session.get::<Option<Uuid>, _>("job_id").map(|job_id| json!({
            "job_id": job_id,
            "status": session.get::<Option<String>, _>("job_status"),
            "confirmed_by": session.get::<Option<String>, _>("confirmed_by"),
            "confirmed_at": session.get::<Option<DateTime<Utc>>, _>("confirmed_at"),
        })),
        "variants": lines.into_iter().map(|row| json!({
            "sku_code": row.get::<String, _>("sku_code"),
            "colour_digit": row.get::<String, _>("colour_digit"),
            "colour_label": row.get::<String, _>("colour_label"),
            "size_code": row.get::<String, _>("size_code"),
            "size_label": row.get::<String, _>("size_label"),
            "quantity": row.get::<i64, _>("quantity"),
            "serial_from": row.get::<i64, _>("serial_from"),
            "serial_to": row.get::<i64, _>("serial_to"),
            "qr_payload": row.get::<String, _>("qr_payload"),
            "base_price_minor": row.get::<i64, _>("base_price_minor"),
        })).collect::<Vec<_>>(),
    }))
}

/// Sessions waiting on head office, oldest first.
pub async fn pending_setup_sessions(pool: &PgPool) -> Result<Vec<SetupSessionSummary>, AppError> {
    let rows = sqlx::query(
        "SELECT s.session_id, s.receipt_line_id, s.article_code, s.article_name, s.division_code,
                s.receipt_quantity, s.destination_site_id, s.status, s.created_by, s.created_at,
                COALESCE(SUM(v.target_quantity), 0)::bigint AS declared
         FROM article_setup_session s
         LEFT JOIN article_setup_variant v ON v.session_id = s.session_id
         WHERE s.status = 'OPEN'
         GROUP BY s.session_id
         ORDER BY s.created_at",
    )
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|row| SetupSessionSummary {
            session_id: row.get("session_id"),
            receipt_line_id: row.get("receipt_line_id"),
            article_code: row.get("article_code"),
            article_name: row.get("article_name"),
            division_code: row.get("division_code"),
            receipt_quantity: row.get("receipt_quantity"),
            declared_quantity: row.get("declared"),
            destination_site_id: row.get("destination_site_id"),
            status: row.get("status"),
            created_by: row.get("created_by"),
            created_at: row.get("created_at"),
        })
        .collect())
}
