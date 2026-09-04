//! What is on offer across every published book, as three lists.
//!
//! Promotions, coupons and campaigns each live inside a price book, and until
//! now the only way to read one back was to open a book. So the screens that
//! list them fetched every publication and then fetched each one again —
//! twelve round trips in dev, and one more with every publish. The cost is not
//! the reason to end it; the *shape* is. A screen whose job is "which offers
//! exist" was expressing that as "open every book and see", which is a
//! different question that happens to have the same answer today.
//!
//! **Newest published book wins, per key.** That is not a choice made here: it
//! is what a shop resolves, in `cloud/postgres/pricing.rs` — `load_rules`,
//! `load_coupons` and `load_campaigns`, each `DISTINCT ON (key) ORDER BY
//! version DESC`. Those three are the reference, and this module deliberately
//! mirrors their SQL rather than inventing a second rule, because a centre that
//! lists one promotion where a till applies another is worse than no list.
//!
//! A promotion repeated in a later book is one promotion amended, never two —
//! which is also why `commercial_usage` is keyed by rule id across every
//! publication rather than per book.
//!
//! Only PUBLISHED books are considered. A promotion sitting in a draft is
//! authored, not running, and listing it beside live ones would invite somebody
//! to wonder why it has never fired.

use chrono::{DateTime, Utc};
use serde_json::{json, Value};
use sqlx::{PgPool, Row};
use uuid::Uuid;

use crate::cloud::application::AppError;

/// The shops that have put a book into service, as the detail endpoint shapes
/// them.
///
/// Carried on every row rather than fetched per book, because "has this offer
/// reached anywhere" is the question the screens ask of each row, and a second
/// round trip to answer it would reinstate half the N+1 this module removes. It
/// repeats across rules that share a book; at a fleet of thirteen that is a few
/// hundred bytes and worth it for a list that needs no follow-up call.
const ACTIVATED_BY: &str = "COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'origin_id', a.origin_id,
             'site_id', a.site_id,
             'activated_at', a.activated_at,
             'reported_at', a.reported_at,
             'price_rule_count', a.price_rule_count
           ) ORDER BY a.origin_id)
      FROM commercial_publication_activation a
     WHERE a.publication_id = p.id), '[]'::jsonb) AS activated_by";

/// How many published books the answer was drawn from.
///
/// Carried on every response because the screens already show it, and because
/// it is the honest denominator: "no promotions, from eleven books" and "no
/// promotions, from none" look identical without it and mean opposite things.
async fn published_book_count(pool: &PgPool) -> Result<i64, AppError> {
    Ok(
        sqlx::query_scalar(
            "SELECT count(*) FROM commercial_publication WHERE status = 'PUBLISHED'",
        )
        .fetch_one(pool)
        .await?,
    )
}

/// Every promotion any published book declares.
///
/// The rule is handed back as the engine serialised it — `definition`, whole.
/// A second reading of it here would be a second opinion about what a promotion
/// does, and the screens already parse that document against the generated
/// contract type.
pub async fn commercial_rules(pool: &PgPool) -> Result<Value, AppError> {
    let rows = sqlx::query(&format!(
        "SELECT DISTINCT ON (r.rule_id)
                r.rule_id, r.name, r.status, r.priority, r.definition,
                p.id AS publication_id, p.version, p.name AS book_name,
                p.effective_from, p.effective_to, {activated}
           FROM commercial_rule r
           JOIN commercial_publication p ON p.id = r.publication_id
          WHERE p.status = 'PUBLISHED'
          ORDER BY r.rule_id, p.version DESC",
        activated = ACTIVATED_BY
    ))
    .fetch_all(pool)
    .await?;

    let items: Vec<Value> = rows
        .into_iter()
        .map(|row| {
            json!({
                "rule_id": row.get::<String, _>("rule_id"),
                "name": row.get::<String, _>("name"),
                "status": row.get::<String, _>("status"),
                "priority": row.get::<i32, _>("priority"),
                "definition": row.get::<Value, _>("definition"),
                // Which book carried it. The screens name the publication on a
                // detail sheet, and without this they would have to open one to
                // find out — the round trip this module exists to remove.
                "publication_id": row.get::<Uuid, _>("publication_id"),
                "version": row.get::<i64, _>("version"),
                "book_name": row.get::<String, _>("book_name"),
                "effective_from": row.get::<DateTime<Utc>, _>("effective_from"),
                "effective_to": row.get::<Option<DateTime<Utc>>, _>("effective_to"),
                "activated_by": row.get::<Value, _>("activated_by"),
            })
        })
        .collect();

    Ok(json!({ "items": items, "book_count": published_book_count(pool).await? }))
}

/// Every coupon any published book declares.
///
/// Not narrowed by validity, matching `load_coupons`: to the engine a code that
/// is absent and one that has lapsed are different answers — "no such code"
/// against "that one expired on Friday" — and dropping the lapsed ones here
/// would have the centre give the first where a till gives the second.
pub async fn commercial_coupons(pool: &PgPool) -> Result<Value, AppError> {
    let rows = sqlx::query(&format!(
        "SELECT DISTINCT ON (c.code)
                c.code, c.rule_id, c.active, c.customer_id,
                c.valid_from, c.valid_to, c.max_uses,
                p.id AS publication_id, p.version, p.name AS book_name,
                p.effective_from, p.effective_to, {activated}
           FROM commercial_coupon c
           JOIN commercial_publication p ON p.id = c.publication_id
          WHERE p.status = 'PUBLISHED'
          ORDER BY c.code, p.version DESC",
        activated = ACTIVATED_BY
    ))
    .fetch_all(pool)
    .await?;

    let items: Vec<Value> = rows
        .into_iter()
        .map(|row| {
            json!({
                "code": row.get::<String, _>("code"),
                "rule_id": row.get::<String, _>("rule_id"),
                "active": row.get::<bool, _>("active"),
                "customer_id": row.get::<Option<String>, _>("customer_id"),
                "valid_from": row.get::<Option<DateTime<Utc>>, _>("valid_from"),
                "valid_to": row.get::<Option<DateTime<Utc>>, _>("valid_to"),
                "max_uses": row.get::<Option<i32>, _>("max_uses"),
                "publication_id": row.get::<Uuid, _>("publication_id"),
                "version": row.get::<i64, _>("version"),
                "book_name": row.get::<String, _>("book_name"),
                "effective_from": row.get::<DateTime<Utc>, _>("effective_from"),
                "effective_to": row.get::<Option<DateTime<Utc>>, _>("effective_to"),
                "activated_by": row.get::<Value, _>("activated_by"),
            })
        })
        .collect();

    Ok(json!({ "items": items, "book_count": published_book_count(pool).await? }))
}

/// Every campaign any published book declares.
///
/// A campaign is the envelope its rules share — one window, one budget, one
/// switch — so what is listed here is the *declaration*. What it has actually
/// spent is an observation and lives in `commercial_usage`, joined by the
/// caller: a limit is frozen with the book that set it, a count changes with
/// every sale in the fleet, and keeping them in one row would freeze the wrong
/// one.
pub async fn commercial_campaigns(pool: &PgPool) -> Result<Value, AppError> {
    let rows = sqlx::query(&format!(
        "SELECT DISTINCT ON (g.campaign_id)
                g.campaign_id, g.name, g.status, g.valid_from, g.valid_to,
                g.budget_minor, g.max_uses, g.image_url, g.headline, g.terms,
                p.id AS publication_id, p.version, p.name AS book_name,
                p.effective_from, p.effective_to, {activated}
           FROM commercial_campaign g
           JOIN commercial_publication p ON p.id = g.publication_id
          WHERE p.status = 'PUBLISHED'
          ORDER BY g.campaign_id, p.version DESC",
        activated = ACTIVATED_BY
    ))
    .fetch_all(pool)
    .await?;

    let items: Vec<Value> = rows
        .into_iter()
        .map(|row| {
            json!({
                "campaign_id": row.get::<String, _>("campaign_id"),
                "name": row.get::<String, _>("name"),
                "status": row.get::<String, _>("status"),
                "valid_from": row.get::<Option<DateTime<Utc>>, _>("valid_from"),
                "valid_to": row.get::<Option<DateTime<Utc>>, _>("valid_to"),
                "budget_minor": row.get::<Option<i64>, _>("budget_minor"),
                "max_uses": row.get::<Option<i32>, _>("max_uses"),
                // What a shopper sees. Editable after publication, unlike
                // everything above it — a banner is not a price.
                "image_url": row.get::<Option<String>, _>("image_url"),
                "headline": row.get::<Option<String>, _>("headline"),
                "terms": row.get::<Option<String>, _>("terms"),
                "publication_id": row.get::<Uuid, _>("publication_id"),
                "version": row.get::<i64, _>("version"),
                "book_name": row.get::<String, _>("book_name"),
                "effective_from": row.get::<DateTime<Utc>, _>("effective_from"),
                "effective_to": row.get::<Option<DateTime<Utc>>, _>("effective_to"),
                "activated_by": row.get::<Value, _>("activated_by"),
            })
        })
        .collect();

    Ok(json!({ "items": items, "book_count": published_book_count(pool).await? }))
}
