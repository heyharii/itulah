//! Head office giving a delivery its identity, and sending the tags down.
//!
//! # The shape of it
//!
//! A delivery has been counted and the count has been accepted, so the
//! goods exist — as a quantity of an article, sitting in `unidentified`.
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
    /// What the article is described as (0968). Absent or `null` takes the
    /// description of the supplier item the line was ordered as; a blank one
    /// says the article has none. Left out of the serialized form when absent
    /// so a retried request from before this field digests as it did.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub currency: String,
    pub colours: Vec<NewSetupColour>,
    pub variants: Vec<NewSetupVariant>,
    pub created_by: String,
}

/// One article of a delivery line being split into several: its own
/// colourways and its own share of the pieces.
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct NewSetupPart {
    pub colours: Vec<NewSetupColour>,
    pub variants: Vec<NewSetupVariant>,
}

/// One delivery line set up as several sibling articles at once (0825).
///
/// The owner, 2026-10-02: an article with too many variants for one article is
/// split into peers — the same name, division, tags and price, each with its
/// own freshly minted code and its own SKUs. There is no parent article. Every
/// part becomes an ordinary session, all opened in one transaction, so a line
/// is still set up exactly once: either every part opens or none does.
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct NewSplitSetup {
    pub receipt_line_id: Uuid,
    pub article_name: String,
    pub division_code: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub image_url: Option<String>,
    /// One description for every article of the split, read as on a single
    /// session.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub currency: String,
    pub articles: Vec<NewSetupPart>,
    pub created_by: String,
}

/// Parts of one split, at most — one per letter the form names them by.
const MAX_SPLIT_ARTICLES: usize = 26;

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
    pub issue_state: Option<String>,
    pub issue_error: Option<String>,
    pub created_by: String,
    pub created_at: DateTime<Utc>,
}

async fn enqueue_setup_issue_tx(
    tx: &mut Transaction<'_, Postgres>,
    sessions: &[Uuid],
    issued_by: &str,
) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO article_setup_issue_queue(session_id,issued_by)
         SELECT session_id,$2 FROM unnest($1::uuid[]) AS session_id",
    )
    .bind(sessions)
    .bind(issued_by.trim())
    .execute(&mut **tx)
    .await?;
    Ok(())
}

/// Retry a failed mint without keeping a browser request open for its work.
/// A session's row lock and one queue row prevent duplicate scheduling.
pub async fn enqueue_setup_issue(
    pool: &PgPool,
    session_id: Uuid,
    issued_by: &str,
) -> Result<(), AppError> {
    if issued_by.trim().is_empty() {
        return Err(AppError::Validation(
            "issuing a setup session must name who did it".into(),
        ));
    }
    let mut tx = pool.begin().await?;
    let status: String = sqlx::query_scalar(
        "SELECT status FROM article_setup_session WHERE session_id=$1 FOR UPDATE",
    )
    .bind(session_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("no setup session {session_id}")))?;
    if status == "OPEN" {
        sqlx::query(
            "INSERT INTO article_setup_issue_queue(session_id,issued_by) VALUES($1,$2)
             ON CONFLICT(session_id) DO UPDATE SET state='QUEUED',attempts=0,
                 issued_by=EXCLUDED.issued_by,next_attempt_at=now(),last_error=NULL,
                 lease_id=NULL,lease_until=NULL,finished_at=NULL
             WHERE article_setup_issue_queue.state='FAILED'",
        )
        .bind(session_id)
        .bind(issued_by.trim())
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    Ok(())
}

/// Bounded work for the shared job runtime. Leases recover crashes; minting
/// itself still locks the session and commits its ledger/price facts together.
pub async fn process_setup_issue_queue(pool: &PgPool) -> Result<u64, AppError> {
    let mut processed = 0;
    for _ in 0..4 {
        let lease_id = Uuid::new_v4();
        let job = sqlx::query(
            "UPDATE article_setup_issue_queue queue
             SET state='PROCESSING',attempts=attempts+1,lease_id=$1,
                 lease_until=now()+interval '2 minutes'
             WHERE queue.session_id=(
                 SELECT session_id FROM article_setup_issue_queue
                 WHERE (state='QUEUED' AND next_attempt_at<=now())
                    OR (state='PROCESSING' AND lease_until<=now())
                 ORDER BY created_at,session_id FOR UPDATE SKIP LOCKED LIMIT 1)
             RETURNING session_id,issued_by,attempts",
        )
        .bind(lease_id)
        .fetch_optional(pool)
        .await?;
        let Some(job) = job else {
            break;
        };
        let session_id: Uuid = job.get("session_id");
        let issued_by: String = job.get("issued_by");
        let attempts: i32 = job.get("attempts");
        let result = issue_setup_session(pool, session_id, &issued_by).await;
        // A manual mint, or a recovered lease, may already have committed the
        // exact session. Treat that as completion, never mint another job.
        let status: String =
            sqlx::query_scalar("SELECT status FROM article_setup_session WHERE session_id=$1")
                .bind(session_id)
                .fetch_one(pool)
                .await?;
        if result.is_ok() || status != "OPEN" {
            sqlx::query("UPDATE article_setup_issue_queue SET state='DONE',finished_at=now(),last_error=NULL,lease_id=NULL,lease_until=NULL WHERE session_id=$1 AND lease_id=$2")
                .bind(session_id).bind(lease_id).execute(pool).await?;
        } else if let Err(error) = result {
            tracing::warn!(%session_id,%error,attempts,"article setup mint failed");
            sqlx::query(
                "UPDATE article_setup_issue_queue SET state=$3,last_error=$4,
                     next_attempt_at=now()+($5::integer*interval '30 seconds'),
                     lease_id=NULL,lease_until=NULL
                 WHERE session_id=$1 AND lease_id=$2",
            )
            .bind(session_id)
            .bind(lease_id)
            .bind(if attempts >= 3 { "FAILED" } else { "QUEUED" })
            .bind(error.to_string())
            .bind(attempts.min(3))
            .execute(pool)
            .await?;
        }
        processed += 1;
    }
    Ok(processed)
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
    create_setup_session_inner(pool, request, None).await
}

pub async fn create_setup_session_background(
    pool: &PgPool,
    request: &NewSetupSession,
    key: &str,
) -> Result<Uuid, AppError> {
    create_setup_session_inner(pool, request, Some(key)).await
}

async fn create_setup_session_inner(
    pool: &PgPool,
    request: &NewSetupSession,
    background_key: Option<&str>,
) -> Result<Uuid, AppError> {
    let total = validate_setup_request(request)?;

    let mut tx = pool.begin().await?;
    if let Some(key) = background_key {
        let digest = super::payload_digest(request)?;
        if let Some(response) =
            super::begin_idempotent(&mut tx, key, "SETUP_BACKGROUND", &digest).await?
        {
            let id: Uuid = serde_json::from_value(response)?;
            tx.commit().await?;
            return Ok(id);
        }
    }
    let line = lock_waiting_line(&mut tx, request.receipt_line_id).await?;
    let receipt_quantity = line.matched_quantity;

    // The quantities must account for the delivery exactly.
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

    let session_id = insert_setup_session(&mut tx, request, &line, total).await?;
    if let Some(key) = background_key {
        enqueue_setup_issue_tx(&mut tx, &[session_id], &request.created_by).await?;
        super::complete_idempotent(&mut tx, key, &json!(session_id)).await?;
    }
    tx.commit().await?;
    Ok(session_id)
}

/// Open one delivery line as several sibling articles, in one transaction.
///
/// Each part is checked exactly as a single session is, and becomes one: its
/// own minted code, its own colour digits, its own share of the pieces. The
/// shares must add up to what was matched, and a colour x size may be in one
/// part only — the owner's rule: the same garment is one SKU of one article.
/// Returns the sessions in the order the parts were given, which is also the
/// order their codes were minted in.
pub async fn create_split_setup(
    pool: &PgPool,
    request: &NewSplitSetup,
) -> Result<Vec<Uuid>, AppError> {
    create_split_setup_inner(pool, request, None).await
}

pub async fn create_split_setup_background(
    pool: &PgPool,
    request: &NewSplitSetup,
    key: &str,
) -> Result<Vec<Uuid>, AppError> {
    create_split_setup_inner(pool, request, Some(key)).await
}

async fn create_split_setup_inner(
    pool: &PgPool,
    request: &NewSplitSetup,
    background_key: Option<&str>,
) -> Result<Vec<Uuid>, AppError> {
    if request.articles.is_empty() {
        return Err(AppError::Validation(
            "a split needs at least one article".into(),
        ));
    }
    if request.articles.len() > MAX_SPLIT_ARTICLES {
        return Err(AppError::Validation(format!(
            "a delivery line can be split into at most {MAX_SPLIT_ARTICLES} articles; {} were given",
            request.articles.len()
        )));
    }
    let parts: Vec<NewSetupSession> = request
        .articles
        .iter()
        .map(|part| NewSetupSession {
            receipt_line_id: request.receipt_line_id,
            // Always minted: a split makes new articles, it never adds to one.
            article_code: None,
            article_name: request.article_name.clone(),
            division_code: request.division_code.clone(),
            tags: request.tags.clone(),
            image_url: request.image_url.clone(),
            description: request.description.clone(),
            currency: request.currency.clone(),
            colours: part.colours.clone(),
            variants: part.variants.clone(),
            created_by: request.created_by.clone(),
        })
        .collect();
    let letter = |index: usize| char::from(b'A' + index as u8);

    let mut totals = Vec::with_capacity(parts.len());
    let mut owner: std::collections::HashMap<(String, String), usize> =
        std::collections::HashMap::new();
    for (index, part) in parts.iter().enumerate() {
        totals.push(validate_setup_request(part)?);
        let colour_of: std::collections::HashMap<&str, String> = part
            .colours
            .iter()
            .map(|colour| {
                (
                    colour.colour_digit.trim(),
                    colour.colour_code.trim().to_uppercase(),
                )
            })
            .collect();
        for variant in &part.variants {
            let colour = colour_of
                .get(variant.colour_digit.trim())
                .cloned()
                .unwrap_or_default();
            let size = variant.size_code.trim().to_string();
            let key = (colour, size);
            match owner.get(&key).copied() {
                Some(first) if first != index => {
                    return Err(AppError::Validation(format!(
                        "colour {} size {} is in article {} and article {}; \
                         a SKU belongs to one article",
                        key.0,
                        key.1,
                        letter(first),
                        letter(index)
                    )));
                }
                Some(_) => {}
                None => {
                    owner.insert(key, index);
                }
            }
        }
    }
    let mut total = 0i64;
    for part_total in &totals {
        total = total
            .checked_add(*part_total)
            .ok_or_else(|| AppError::Validation("the declared quantities overflow".into()))?;
    }

    let mut tx = pool.begin().await?;
    if let Some(key) = background_key {
        let digest = super::payload_digest(request)?;
        if let Some(response) =
            super::begin_idempotent(&mut tx, key, "SPLIT_SETUP_BACKGROUND", &digest).await?
        {
            let ids: Vec<Uuid> = serde_json::from_value(response)?;
            tx.commit().await?;
            return Ok(ids);
        }
    }
    let line = lock_waiting_line(&mut tx, request.receipt_line_id).await?;
    let receipt_quantity = line.matched_quantity;
    if total != receipt_quantity {
        return Err(AppError::Validation(format!(
            "the articles account for {total} units but {receipt_quantity} were received \
             and accepted. Every piece must be accounted for, in one article or another"
        )));
    }
    for (index, part_total) in totals.iter().enumerate() {
        if *part_total > MAX_TAGGING_JOB_UNITS {
            return Err(AppError::Validation(format!(
                "article {} has {part_total} units, more than the {MAX_TAGGING_JOB_UNITS} \
                 a single tagging job can carry",
                letter(index)
            )));
        }
    }

    let mut sessions = Vec::with_capacity(parts.len());
    for (part, part_total) in parts.iter().zip(&totals) {
        sessions.push(insert_setup_session(&mut tx, part, &line, *part_total).await?);
    }
    if let Some(key) = background_key {
        enqueue_setup_issue_tx(&mut tx, &sessions, &request.created_by).await?;
        super::complete_idempotent(&mut tx, key, &json!(sessions)).await?;
    }
    tx.commit().await?;
    Ok(sessions)
}

/// The checks that need nothing but the request. Returns the pieces it
/// declares.
fn validate_setup_request(request: &NewSetupSession) -> Result<i64, AppError> {
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
    Ok(total)
}

/// What a session needs to know about the delivery line it is opened against.
struct WaitingLine {
    matched_quantity: i64,
    supplier_article_code: String,
    destination_site_id: String,
    /// The supplier item's description, for a session that was given none.
    supplier_description: Option<String>,
}

/// Read the delivery line a setup is for, locked, and refuse one that already
/// has an identity.
///
/// The lock is what makes "set up once" hold now that a line may carry several
/// sessions (0825): two people pressing at once queue here, and the second
/// finds the first one's sessions.
async fn lock_waiting_line(
    tx: &mut Transaction<'_, Postgres>,
    receipt_line_id: Uuid,
) -> Result<WaitingLine, AppError> {
    // What was received, and where. Reading it here rather than trusting the
    // caller means a session can only ever be opened against real goods.
    let receipt = sqlx::query(
        "SELECT r.quantity, r.matched_quantity, r.excess_quantity,
                l.article_code, o.destination_site_id, si.description AS supplier_description
         FROM goods_receipt_line r
         JOIN purchase_order_line l ON l.po_line_id = r.po_line_id
         JOIN purchase_order o ON o.purchase_order_id = l.purchase_order_id
         LEFT JOIN supplier_item si ON si.supplier_item_id = l.supplier_item_id
         WHERE r.receipt_line_id = $1
         FOR UPDATE OF r",
    )
    .bind(receipt_line_id)
    .fetch_optional(&mut **tx)
    .await?
    .ok_or_else(|| {
        AppError::Validation(format!(
            "no accepted delivery line {}: goods must be received before they can be identified",
            receipt_line_id
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
            receipt_line_id
        )));
    }
    // The supplier's own code, kept for traceability and never used as an
    // identity. It arrived on the order; it says what the supplier calls the
    // thing, not what it is.
    let supplier_article_code: String = receipt.get("article_code");
    let destination_site_id: String = receipt.get("destination_site_id");
    let supplier_description: Option<String> = receipt.get("supplier_description");

    let already: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM article_setup_session WHERE receipt_line_id = $1)",
    )
    .bind(receipt_line_id)
    .fetch_one(&mut **tx)
    .await?;
    if already {
        return Err(AppError::Validation(format!(
            "delivery line {receipt_line_id} has already been set up"
        )));
    }

    Ok(WaitingLine {
        matched_quantity: receipt_quantity,
        supplier_article_code,
        destination_site_id,
        supplier_description,
    })
}

/// Write one session, its tags, colourways and variants, for `quantity`
/// pieces of the line — all of it, or this article's share of a split.
async fn insert_setup_session(
    tx: &mut Transaction<'_, Postgres>,
    request: &NewSetupSession,
    line: &WaitingLine,
    quantity: i64,
) -> Result<Uuid, AppError> {
    // Ours is minted here — or reused, when head office says this delivery is
    // more of something we already sell.
    let article_code = match request.article_code.as_deref().map(str::trim) {
        None | Some("") => mint_article_code_tx(tx).await?,
        Some(existing) => {
            validate_article_code(existing).map_err(AppError::Validation)?;
            let known: Option<String> =
                sqlx::query_scalar("SELECT article_code FROM article WHERE article_code = $1")
                    .bind(existing)
                    .fetch_optional(&mut **tx)
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

    // What head office wrote, or — when the form sent nothing — what the
    // supplier item says. A blank one is a decision too: no description.
    let description = match request.description.as_deref() {
        Some(written) => clean_description(Some(written)),
        None => clean_description(line.supplier_description.as_deref()),
    };

    let session_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO article_setup_session
             (session_id, receipt_line_id, article_code, supplier_article_code, receipt_quantity,
              destination_site_id, article_name, division_code, image_url, currency,
              created_by, description)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
    )
    .bind(session_id)
    .bind(request.receipt_line_id)
    .bind(&article_code)
    .bind(&line.supplier_article_code)
    .bind(quantity)
    .bind(&line.destination_site_id)
    .bind(request.article_name.trim())
    .bind(request.division_code.trim())
    .bind(&request.image_url)
    .bind(request.currency.trim().to_uppercase())
    .bind(request.created_by.trim())
    .bind(&description)
    .execute(&mut **tx)
    .await?;
    // A line set up twice is refused before this, in `lock_waiting_line`: the
    // UNIQUE on receipt_line_id that used to do it is gone with 0825.

    // The line has its identity now, so the form saved for it (0956) has done
    // its job. Deleted here, in the same transaction, so a draft never outlives
    // the setup it was a draft of. A split runs this once per article; the
    // later deletes find nothing.
    sqlx::query("DELETE FROM article_setup_draft WHERE receipt_line_id = $1")
        .bind(request.receipt_line_id)
        .execute(&mut **tx)
        .await?;

    // Validate all vocabulary references together, then write each relation
    // with one INSERT. A setup with many sizes used to wait on PostgreSQL once
    // per tag, colour and variant while this transaction held the receipt row.
    let tag_codes: Vec<String> = request
        .tags
        .iter()
        .map(|tag| tag.trim().to_owned())
        .collect();
    let colours: Vec<(String, String)> = request
        .colours
        .iter()
        .map(|colour| {
            let digit = single_digit(&colour.colour_digit, "colour")?;
            let code = colour.colour_code.trim().to_uppercase();
            if code.is_empty() {
                return Err(AppError::Validation(format!(
                    "colour {digit} names no colour; colours are picked from the master, not typed"
                )));
            }
            Ok((digit.to_string(), code))
        })
        .collect::<Result<_, _>>()?;
    let colour_codes: Vec<String> = colours.iter().map(|(_, code)| code.clone()).collect();
    let (known_tags, offered_colours): (Vec<String>, Vec<String>) = sqlx::query_as(
        "SELECT
             COALESCE((SELECT array_agg(code) FROM tag WHERE code = ANY($1)), ARRAY[]::text[]),
             COALESCE((SELECT array_agg(code) FROM colour
                        WHERE code = ANY($2) AND active), ARRAY[]::text[])",
    )
    .bind(&tag_codes)
    .bind(&colour_codes)
    .fetch_one(&mut **tx)
    .await?;

    let known_tags: std::collections::HashSet<&str> =
        known_tags.iter().map(String::as_str).collect();
    for (tag, code) in request.tags.iter().zip(&tag_codes) {
        if !known_tags.contains(code.as_str()) {
            return Err(AppError::Validation(format!(
                "tag {tag:?} is not in the tag vocabulary"
            )));
        }
    }
    if !tag_codes.is_empty() {
        sqlx::query(
            "INSERT INTO article_setup_session_tag (session_id, tag_code)
             SELECT $1, tags.tag_code FROM unnest($2::text[]) AS tags(tag_code)
             ON CONFLICT DO NOTHING",
        )
        .bind(session_id)
        .bind(&tag_codes)
        .execute(&mut **tx)
        .await?;
    }

    let offered_colours: std::collections::HashSet<&str> =
        offered_colours.iter().map(String::as_str).collect();
    let mut seen_digits = std::collections::HashSet::new();
    let mut seen_colours = std::collections::HashSet::new();
    for (digit, code) in &colours {
        // Refused here rather than left to the foreign key, because "insert or
        // update violates foreign key constraint" names a constraint and not
        // the word somebody got wrong. A retired colour is refused too: a
        // delivery being set up today is new goods, and new goods should not
        // be filed under a shade merchandising has stopped offering.
        if !offered_colours.contains(code.as_str()) {
            return Err(AppError::Validation(format!(
                "colour {code:?} is not in the colour master, or has been retired; \
                 pick one that is on offer"
            )));
        }
        if !seen_digits.insert(digit.as_str()) || !seen_colours.insert(code.as_str()) {
            return Err(AppError::Validation(format!(
                "colour {code:?} is declared twice under different digits; \
                 two SKUs no picker can tell apart"
            )));
        }
    }
    if !colours.is_empty() {
        let digits: Vec<String> = colours.iter().map(|(digit, _)| digit.clone()).collect();
        sqlx::query(
            "INSERT INTO article_setup_colour (session_id, colour_digit, colour_code)
             SELECT $1, colours.colour_digit, colours.colour_code
               FROM unnest($2::text[], $3::text[]) AS colours(colour_digit, colour_code)",
        )
        .bind(session_id)
        .bind(&digits)
        .bind(&colour_codes)
        .execute(&mut **tx)
        .await?;
    }

    let mut variants = Vec::with_capacity(request.variants.len());
    let mut seen_variants = std::collections::HashSet::new();
    for variant in &request.variants {
        let digit = single_digit(&variant.colour_digit, "colour")?.to_string();
        let size_code = variant.size_code.trim().to_owned();
        if !seen_variants.insert((digit.clone(), size_code.clone())) {
            return Err(AppError::Validation(format!(
                "colour {} size {} appears twice",
                variant.colour_digit, variant.size_code
            )));
        }
        variants.push((digit, size_code, variant.quantity, variant.base_price_minor));
    }
    if !variants.is_empty() {
        let digits: Vec<String> = variants
            .iter()
            .map(|(digit, _, _, _)| digit.clone())
            .collect();
        let sizes: Vec<String> = variants
            .iter()
            .map(|(_, size, _, _)| size.clone())
            .collect();
        let quantities: Vec<i64> = variants
            .iter()
            .map(|(_, _, quantity, _)| *quantity)
            .collect();
        let prices: Vec<i64> = variants.iter().map(|(_, _, _, price)| *price).collect();
        sqlx::query(
            "INSERT INTO article_setup_variant
                 (session_id, colour_digit, size_code, target_quantity, base_price_minor)
             SELECT $1, variants.colour_digit, variants.size_code,
                    variants.target_quantity, variants.base_price_minor
               FROM unnest($2::text[], $3::text[], $4::bigint[], $5::bigint[])
                    AS variants(colour_digit, size_code, target_quantity, base_price_minor)",
        )
        .bind(session_id)
        .bind(&digits)
        .bind(&sizes)
        .bind(&quantities)
        .bind(&prices)
        .execute(&mut **tx)
        .await?;
    }

    Ok(session_id)
}

/// A description as it is kept: trimmed, and blank is none.
fn clean_description(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(str::to_owned)
}

/// Change what an open session will describe its article as, before it is
/// issued. A session already issued keeps what it minted: the article's own
/// description is edited on the article from then on.
pub async fn set_setup_description(
    pool: &PgPool,
    session_id: Uuid,
    description: &str,
) -> Result<(), AppError> {
    sqlx::query(
        "UPDATE article_setup_session SET description = $2
         WHERE session_id = $1 AND status = 'OPEN'",
    )
    .bind(session_id)
    .bind(clean_description(Some(description)))
    .execute(pool)
    .await?;
    Ok(())
}

fn is_unique_violation(error: &sqlx::Error) -> bool {
    matches!(error, sqlx::Error::Database(db) if db.code().as_deref() == Some("23505"))
}

#[derive(Clone, Debug)]
struct PreparedSetupVariant {
    sku_code: String,
    colour_digit: String,
    colour_label: String,
    size_code: String,
    size_label: String,
    quantity: i64,
    base_price_minor: i64,
    qr_payload: String,
    barcode_payload: String,
}

/// Reserve one serial range per SKU in a single statement.
///
/// The unique-key upsert is the row lock: concurrent issues of the same SKU
/// serialize at that counter and receive disjoint ranges. Sorting the source
/// rows gives concurrent multi-SKU jobs the same lock order.
async fn allocate_serial_ranges(
    tx: &mut Transaction<'_, Postgres>,
    variants: &[PreparedSetupVariant],
) -> Result<std::collections::HashMap<String, i64>, AppError> {
    if variants.is_empty() {
        return Ok(std::collections::HashMap::new());
    }
    let mut requested: Vec<(String, i64)> = variants
        .iter()
        .map(|variant| (variant.sku_code.clone(), variant.quantity))
        .collect();
    requested.sort_by(|left, right| left.0.cmp(&right.0));
    let sku_codes: Vec<String> = requested.iter().map(|(sku, _)| sku.clone()).collect();
    let quantities: Vec<i64> = requested.iter().map(|(_, quantity)| *quantity).collect();

    let rows = sqlx::query(
        "INSERT INTO epc_serial_counter (sku_code, last_serial)
         SELECT requested.sku_code, requested.quantity
           FROM unnest($1::text[], $2::bigint[])
                AS requested(sku_code, quantity)
          ORDER BY requested.sku_code
         ON CONFLICT (sku_code) DO UPDATE
             SET last_serial = epc_serial_counter.last_serial + EXCLUDED.last_serial,
                 updated_at = now()
           WHERE epc_serial_counter.last_serial <=
                 9223372036854775807::bigint - EXCLUDED.last_serial
         RETURNING rtrim(sku_code::text) AS sku_code, last_serial",
    )
    .bind(&sku_codes)
    .bind(&quantities)
    .fetch_all(&mut **tx)
    .await?;

    let last_by_sku: std::collections::HashMap<String, i64> = rows
        .into_iter()
        .map(|row| (row.get("sku_code"), row.get("last_serial")))
        .collect();
    let mut starts = std::collections::HashMap::with_capacity(requested.len());
    for (sku, quantity) in requested {
        let Some(last) = last_by_sku.get(&sku).copied() else {
            return Err(AppError::Validation(format!(
                "serial counter for {sku} overflowed"
            )));
        };
        let start = last
            .checked_sub(quantity)
            .and_then(|previous| previous.checked_add(1))
            .ok_or_else(|| AppError::Validation(format!("serial counter for {sku} overflowed")))?;
        starts.insert(sku, start);
    }
    Ok(starts)
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
    variants: &[PreparedSetupVariant],
    currency: &str,
    article_name: &str,
    issued_by: &str,
) -> Result<i64, AppError> {
    if variants.is_empty() {
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

    let sku_codes: Vec<String> = variants.iter().map(|line| line.sku_code.clone()).collect();
    let prices: Vec<i64> = variants.iter().map(|line| line.base_price_minor).collect();
    // Both rules draw from the same small input relation. A setup with many
    // colour/size combinations therefore uses one database request for the
    // whole price book instead of looking up a SKU and writing two rules per
    // combination.
    let inserted: i64 = sqlx::query_scalar(
        "WITH setup_lines AS MATERIALIZED (
             SELECT s.id AS sku_id, requested.base_price_minor
               FROM unnest($2::text[], $4::bigint[])
                    AS requested(sku_code, base_price_minor)
               JOIN sku s ON s.sku_code = requested.sku_code
         ), assortment AS (
             INSERT INTO commercial_assortment_rule
                 (id, publication_id, sku_id, site_id, channel, sellable)
             SELECT gen_random_uuid(), $1, setup_lines.sku_id, NULL, 'STORE', true
               FROM setup_lines
             RETURNING sku_id
         ), prices AS (
             INSERT INTO commercial_price_rule
                 (id, publication_id, sku_id, site_id, channel, currency,
                  unit_price_minor, tax_category)
             SELECT gen_random_uuid(), $1, setup_lines.sku_id, NULL, 'STORE', $3,
                    setup_lines.base_price_minor, $5
               FROM setup_lines
             RETURNING sku_id
         )
         SELECT count(*)::bigint FROM prices",
    )
    .bind(publication_id)
    .bind(&sku_codes)
    .bind(currency)
    .bind(&prices)
    .bind(SETUP_TAX_CATEGORY)
    .fetch_one(&mut **tx)
    .await?;
    if inserted != variants.len() as i64 {
        return Err(AppError::Validation(
            "one or more setup SKUs could not be found for pricing".into(),
        ));
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
/// Returns the job that was created and the command that carries it — none
/// when the cloud runs the Gudang itself (DC-CLOUD-NATIVE.md): then there is
/// nobody to send it to, and the job's goods are stocked here instead.
pub async fn issue_setup_session(
    pool: &PgPool,
    session_id: Uuid,
    issued_by: &str,
) -> Result<(Uuid, Option<Uuid>), AppError> {
    if issued_by.trim().is_empty() {
        return Err(AppError::Validation(
            "issuing a setup session must name who did it".into(),
        ));
    }
    let mut tx = pool.begin().await?;

    let session = sqlx::query(
        "SELECT receipt_line_id, article_code, article_name, division_code, image_url, currency,
                receipt_quantity, destination_site_id, status, description
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
    let description: Option<String> = session.get("description");
    let currency: String = session.get("currency");
    let receipt_quantity: i64 = session.get("receipt_quantity");
    let destination_site_id: String = session.get("destination_site_id");

    // The DC that owns this site's inventory is the one that will do the
    // tagging. Resolving it here means an unroutable job is refused at the
    // desk rather than vanishing.
    //
    // When the cloud runs the Gudang (DC-CLOUD-NATIVE.md) there is no DC node
    // to resolve: the job is the cloud's own work, read from `tagging_job` by
    // `cloud::dc::tagging`, and `target` stays None.
    let target: Option<String> = if crate::cloud::dc::common::hosted() {
        None
    } else {
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
        Some(target)
    };

    // --- Mint the article, if this is its first delivery -------------------
    // A later delivery of an article we already sell fills its description
    // only when it has none: what somebody wrote on the article is not
    // overwritten by what a supplier item says.
    let article_id: Uuid = sqlx::query_scalar(
        "INSERT INTO article (id, article_code, name, division_code, image_url,
                              created_by_session_id, description)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6)
         ON CONFLICT (article_code) DO UPDATE SET name = article.name,
             description = COALESCE(article.description, EXCLUDED.description)
         RETURNING id",
    )
    .bind(&article_code)
    .bind(&article_name)
    .bind(&division_code)
    .bind(&image_url)
    .bind(session_id)
    .bind(clean_description(description.as_deref()))
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

    let mut prepared = Vec::with_capacity(variants.len());
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
        prepared.push(PreparedSetupVariant {
            sku_code: sku,
            colour_digit,
            colour_label,
            size_code,
            size_label,
            quantity,
            base_price_minor,
            qr_payload: qr,
            barcode_payload: barcode,
        });
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

    // Mint all missing SKUs at once. A repeated delivery reuses the existing
    // SKU, exactly as the former per-variant INSERT ... DO NOTHING did.
    let sku_codes: Vec<String> = prepared.iter().map(|line| line.sku_code.clone()).collect();
    let colour_digits: Vec<String> = prepared
        .iter()
        .map(|line| line.colour_digit.clone())
        .collect();
    let colour_labels: Vec<String> = prepared
        .iter()
        .map(|line| line.colour_label.clone())
        .collect();
    let size_codes: Vec<String> = prepared.iter().map(|line| line.size_code.clone()).collect();
    let size_labels: Vec<String> = prepared
        .iter()
        .map(|line| line.size_label.clone())
        .collect();
    let prices: Vec<i64> = prepared.iter().map(|line| line.base_price_minor).collect();
    let qr_payloads: Vec<String> = prepared
        .iter()
        .map(|line| line.qr_payload.clone())
        .collect();
    sqlx::query(
        "INSERT INTO sku (id, article_id, sku_code, color, size, colour_digit, size_code,
                          base_price_minor, currency, qr_payload, created_by_session_id)
         SELECT gen_random_uuid(), $1, line.sku_code, line.colour_label, line.size_label,
                line.colour_digit, line.size_code, line.base_price_minor, $2,
                line.qr_payload, $3
           FROM unnest($4::text[], $5::text[], $6::text[], $7::text[], $8::text[],
                       $9::bigint[], $10::text[])
                AS line(sku_code, colour_digit, colour_label, size_code, size_label,
                        base_price_minor, qr_payload)
         ON CONFLICT (sku_code) DO NOTHING",
    )
    .bind(article_id)
    .bind(&currency)
    .bind(session_id)
    .bind(&sku_codes)
    .bind(&colour_digits)
    .bind(&colour_labels)
    .bind(&size_codes)
    .bind(&size_labels)
    .bind(&prices)
    .bind(&qr_payloads)
    .execute(&mut *tx)
    .await?;

    let serial_starts = allocate_serial_ranges(&mut tx, &prepared).await?;
    let mut job_lines: Vec<Value> = Vec::with_capacity(prepared.len());
    let mut serial_starts_by_line = Vec::with_capacity(prepared.len());
    for line in &prepared {
        let serial_from = serial_starts.get(&line.sku_code).copied().ok_or_else(|| {
            AppError::Validation(format!("no serial range for {}", line.sku_code))
        })?;
        let epcs = encode_epc_range(&line.sku_code, serial_from as u64, line.quantity as u64)
            .map_err(AppError::Validation)?;
        serial_starts_by_line.push(serial_from);
        job_lines.push(json!({
            "sku_code": line.sku_code,
            "colour_digit": line.colour_digit,
            "colour_label": line.colour_label,
            "size_code": line.size_code,
            "size_label": line.size_label,
            "quantity": line.quantity,
            "qr_payload": line.qr_payload,
            "barcode_payload": line.barcode_payload,
            "base_price_minor": line.base_price_minor,
            "epcs": epcs,
        }));
    }

    // A job's SKU rows also arrive together. The serial ranges above remain
    // one per SKU and are reserved atomically under their counter row locks.
    let serial_quantities: Vec<i64> = prepared.iter().map(|line| line.quantity).collect();
    let barcode_payloads: Vec<String> = prepared
        .iter()
        .map(|line| line.barcode_payload.clone())
        .collect();
    sqlx::query(
        "INSERT INTO tagging_job_line
             (job_id, sku_code, colour_digit, colour_label, size_code, size_label,
              quantity, serial_from, serial_to, qr_payload, barcode_payload,
              base_price_minor)
         SELECT $1, line.sku_code, line.colour_digit, line.colour_label,
                line.size_code, line.size_label, line.quantity, line.serial_from,
                line.serial_from + (line.quantity - 1), line.qr_payload,
                line.barcode_payload, line.base_price_minor
           FROM unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::text[],
                       $7::bigint[], $8::bigint[], $9::text[], $10::text[], $11::bigint[])
                AS line(sku_code, colour_digit, colour_label, size_code, size_label,
                        quantity, serial_from, qr_payload, barcode_payload, base_price_minor)",
    )
    .bind(job_id)
    .bind(&sku_codes)
    .bind(&colour_digits)
    .bind(&colour_labels)
    .bind(&size_codes)
    .bind(&size_labels)
    .bind(&serial_quantities)
    .bind(&serial_starts_by_line)
    .bind(&qr_payloads)
    .bind(&barcode_payloads)
    .bind(&prices)
    .execute(&mut *tx)
    .await?;

    // The setup's own price book, published and on its way to the shops before
    // the tagging job leaves. A garment cannot arrive somewhere unsellable.
    let _price_book_version =
        publish_setup_prices(&mut tx, &prepared, &currency, &article_name, issued_by).await?;

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

    let command_id = match &target {
        Some(target) => Some(
            issue_command_tx(
                &mut tx,
                COMMAND_TAGGING_JOB_ACTIVATE,
                &payload,
                issued_by.trim(),
                None,
                std::slice::from_ref(target),
            )
            .await?,
        ),
        // The cloud-run Gudang (DC-CLOUD-NATIVE.md): no command. The same
        // check a command gets at the desk (every EPC decodes back to its
        // line's SKU), then what a DC server does when the job arrives — the
        // delivery's pieces become one unit per EPC on the Gudang's racks.
        None => {
            crate::cloud::domain::parse_tagging_job(&payload).map_err(AppError::Validation)?;
            crate::cloud::dc::tagging::stock_issued_job_tx(
                &mut tx,
                job_id,
                issued_by.trim(),
                issued_at,
            )
            .await?;
            None
        }
    };

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

    sqlx::query("UPDATE article_setup_issue_queue SET state='DONE',finished_at=now(),last_error=NULL WHERE session_id=$1")
        .bind(session_id).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok((job_id, command_id))
}

/// Where the previous page of head office's queue stopped — as a ROW, not a
/// position, so a delivery identified between two pages moves nothing.
#[derive(Serialize, Deserialize)]
struct UnidentifiedCursor {
    verified_at: DateTime<Utc>,
    receipt_line_id: Uuid,
}

/// A page of the queue unless the caller asks for less. The queue is read by
/// people, and a person works through hundreds of deliveries, not millions.
pub const UNIDENTIFIED_PAGE: i64 = 500;
const UNIDENTIFIED_PAGE_MAX: i64 = 2000;

/// Deliveries that have been received and accepted but not yet given an
/// identity — head office's queue, its first page.
pub async fn unidentified_receipts(pool: &PgPool) -> Result<Vec<Value>, AppError> {
    Ok(unidentified_receipts_page(pool, None, None).await?.0)
}

/// How many deliveries wait in the queue, counted up to `cap` and no further.
///
/// The badge on every screen needs a number, never the rows: reading the whole
/// queue to take its length is what held two million receipt lines in memory
/// and took the server down. A count that stops at `cap` costs the same
/// whether the queue holds ten deliveries or ten million.
pub async fn unidentified_receipt_count(pool: &PgPool, cap: i64) -> Result<i64, AppError> {
    Ok(sqlx::query_scalar(
        "SELECT count(*)::bigint FROM (
             SELECT 1 FROM goods_receipt_line r
              WHERE r.matched_quantity > 0
                AND NOT EXISTS (SELECT 1 FROM article_setup_session s
                                 WHERE s.receipt_line_id = r.receipt_line_id)
              LIMIT $1
         ) waiting",
    )
    .bind(cap.max(1))
    .fetch_one(pool)
    .await?)
}

/// One page of head office's queue, oldest delivery first, and where the next
/// page starts (`None` on the last one).
pub async fn unidentified_receipts_page(
    pool: &PgPool,
    limit: Option<i64>,
    cursor: Option<&str>,
) -> Result<(Vec<Value>, Option<String>), AppError> {
    let limit = limit.unwrap_or(UNIDENTIFIED_PAGE).clamp(1, UNIDENTIFIED_PAGE_MAX);
    let after = cursor
        .map(str::trim)
        .filter(|raw| !raw.is_empty())
        .map(super::decode_cursor::<UnidentifiedCursor>)
        .transpose()?;
    let rows = sqlx::query(
        "SELECT r.receipt_line_id, r.matched_quantity AS quantity, r.excess_quantity,
                r.verified_at, l.article_code, l.article_name,
                l.image_url, l.division_code, o.destination_site_id, o.po_number,
                g.receipt_number, g.supplier_id, g.invoice_number,
                COALESCE((SELECT array_agg(t.tag_code ORDER BY t.tag_code)
                          FROM purchase_order_line_tag t
                          WHERE t.po_line_id = l.po_line_id), '{}')::text[] AS tags,
                -- What one piece cost: the price agreed when THIS delivery was
                -- accepted, or the order's own for a receipt from before that
                -- was kept (0178). Per piece either way (0656). Net of the
                -- order discount: this receipt's share of it (0178), spread
                -- over its matched pieces, comes off each one.
                GREATEST(0, COALESCE(r.agreed_unit_price_minor, l.unit_price_minor)
                    - ROUND(r.allocated_discount_minor::numeric
                            / NULLIF(r.matched_quantity, 0))::bigint) AS purchase_price_minor,
                l.base_price_minor, l.markup_bps,
                (SELECT si.description FROM supplier_item si
                  WHERE si.supplier_item_id = l.supplier_item_id) AS description,
                COALESCE((SELECT jsonb_agg(jsonb_build_object(
                                     'colour_code', v.colour_code,
                                     'size_code', v.size_code,
                                     'quantity', v.quantity,
                                     'base_price_minor', v.base_price_minor,
                                     'image_urls', to_jsonb(v.image_urls),
                                     -- What the bay counted of it, when the
                                     -- line was counted per variant (0963);
                                     -- null for a line counted as a whole.
                                     'counted_quantity',
                                         (SELECT x.counted_quantity
                                            FROM dc_receiving_count_variant x
                                           WHERE x.count_id = r.count_id
                                             AND COALESCE(x.colour_code, '') = COALESCE(v.colour_code, '')
                                             AND COALESCE(x.size_code, '') = COALESCE(v.size_code, '')))
                                 ORDER BY v.colour_code, v.size_code)
                          FROM purchase_order_line_variant v
                          WHERE v.po_line_id = l.po_line_id), '[]'::jsonb) AS variants
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
           AND ($1::timestamptz IS NULL
                OR (r.verified_at, r.receipt_line_id) > ($1::timestamptz, $2::uuid))
         ORDER BY r.verified_at, r.receipt_line_id
         LIMIT $3",
    )
    .bind(after.as_ref().map(|c| c.verified_at))
    .bind(after.as_ref().map(|c| c.receipt_line_id))
    .bind(limit)
    .fetch_all(pool)
    .await?;
    let next_cursor = match rows.last() {
        Some(last) if rows.len() as i64 == limit => Some(super::encode_cursor(&UnidentifiedCursor {
            verified_at: last.try_get("verified_at")?,
            receipt_line_id: last.try_get("receipt_line_id")?,
        })?),
        _ => None,
    };
    let items = rows
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
                // The supplier item's description (0968), the form's preset
                // for what the article is described as. Null when it has none.
                "description": clean_description(
                    row.get::<Option<String>, _>("description").as_deref()
                ),
                "site_id": row.get::<String, _>("destination_site_id"),
                "po_number": row.get::<String, _>("po_number"),
                // The pricing the buyer decided on the order (0398), for the
                // form to start from: cost per piece, the markup over it, the
                // selling price, and the SKU split with each one's own price
                // where it is not the base. All presets, like the rest.
                "purchase_price_minor": row.get::<i64, _>("purchase_price_minor"),
                "base_price_minor": row.get::<Option<i64>, _>("base_price_minor"),
                "markup_bps": row.get::<Option<i32>, _>("markup_bps"),
                "variants": row.get::<Value, _>("variants"),
            })
        })
        .collect();
    Ok((items, next_cursor))
}

/// Where one setup session stands, with the job it produced.
pub async fn setup_session_status(pool: &PgPool, session_id: Uuid) -> Result<Value, AppError> {
    setup_sessions_status(pool, &[session_id])
        .await?
        .into_iter()
        .next()
        .ok_or_else(|| AppError::NotFound(format!("no setup session {session_id}")))
}

/// Read one batch in input order, aggregating only these sessions' tags and
/// variants. A split response no longer performs three reads per article.
pub async fn setup_sessions_status(
    pool: &PgPool,
    session_ids: &[Uuid],
) -> Result<Vec<Value>, AppError> {
    let sessions = sqlx::query(
        "WITH selected AS MATERIALIZED (
             SELECT * FROM article_setup_session WHERE session_id=ANY($1)
         ), variants AS (
             SELECT j.session_id,jsonb_agg(jsonb_build_object(
                 'sku_code',l.sku_code,'colour_digit',l.colour_digit,
                 'colour_label',l.colour_label,'size_code',l.size_code,'size_label',l.size_label,
                 'quantity',l.quantity,'serial_from',l.serial_from,'serial_to',l.serial_to,
                 'qr_payload',l.qr_payload,'base_price_minor',l.base_price_minor)
                 ORDER BY l.sku_code) AS items
             FROM selected s JOIN tagging_job j ON j.session_id=s.session_id
             JOIN tagging_job_line l ON l.job_id=j.job_id GROUP BY j.session_id
         ), tags AS (
             SELECT t.session_id,jsonb_agg(t.tag_code ORDER BY t.tag_code) AS items
             FROM selected s JOIN article_setup_session_tag t ON t.session_id=s.session_id
             GROUP BY t.session_id
         )
         SELECT s.*,j.job_id,j.status AS job_status,j.confirmed_by,j.confirmed_at,g.supplier_id,
                queue.state AS issue_state,queue.last_error AS issue_error,
                COALESCE(variants.items,'[]'::jsonb) AS variants,COALESCE(tags.items,'[]'::jsonb) AS tags
         FROM selected s LEFT JOIN tagging_job j ON j.session_id=s.session_id
         LEFT JOIN goods_receipt_line r ON r.receipt_line_id=s.receipt_line_id
         LEFT JOIN goods_receipt g ON g.receipt_id=r.receipt_id
         LEFT JOIN article_setup_issue_queue queue ON queue.session_id=s.session_id
         LEFT JOIN variants ON variants.session_id=s.session_id
         LEFT JOIN tags ON tags.session_id=s.session_id
         ORDER BY array_position($1::uuid[],s.session_id)",
    ).bind(session_ids).fetch_all(pool).await?;
    Ok(sessions
        .into_iter()
        .map(|session| {
            json!({
                "session_id": session.get::<Uuid, _>("session_id"),
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
                // What the article is (or will be) described as (0968).
                "description": session
                    .try_get::<Option<String>, _>("description")
                    .ok()
                    .flatten(),
                "tags": session.get::<Value, _>("tags"),
                "currency": session.get::<String, _>("currency").trim(),
                "receipt_quantity": session.get::<i64, _>("receipt_quantity"),
                "site_id": session.get::<String, _>("destination_site_id"),
                "status": session.get::<String, _>("status"),
                "issue_state": session.get::<Option<String>, _>("issue_state"),
                "issue_error": session.get::<Option<String>, _>("issue_error"),
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
                "variants": session.get::<Value, _>("variants"),
            })
        })
        .collect())
}

/// Sessions waiting on head office, oldest first.
pub async fn pending_setup_sessions(pool: &PgPool) -> Result<Vec<SetupSessionSummary>, AppError> {
    let rows = sqlx::query(
        "SELECT s.session_id, s.receipt_line_id, s.article_code, s.article_name, s.division_code,
                s.receipt_quantity, s.destination_site_id, s.status, s.created_by, s.created_at,
                COALESCE(SUM(v.target_quantity), 0)::bigint AS declared,
                queue.state AS issue_state, queue.last_error AS issue_error
         FROM article_setup_session s
         LEFT JOIN article_setup_variant v ON v.session_id = s.session_id
         LEFT JOIN article_setup_issue_queue queue ON queue.session_id = s.session_id
         WHERE s.status = 'OPEN'
         GROUP BY s.session_id,queue.session_id
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
            issue_state: row.get("issue_state"),
            issue_error: row.get("issue_error"),
            created_by: row.get("created_by"),
            created_at: row.get("created_at"),
        })
        .collect())
}
