//! What a promotion resolved to, and what an edit to an article would change.
//!
//! # The gap this closes
//!
//! A rule selects products by a set of strings — `Applicability::Tag`,
//! `Applicability::Division` — and the match is recomputed on every basket from
//! whatever the catalogue says at that moment. Nothing recorded what a selector
//! meant when the promotion started, so two things were invisible:
//!
//!  - **what a running promotion actually covers.** "Tag = Denim" is the
//!    question, not the answer, and the answer moved every time somebody tagged
//!    an article.
//!  - **that editing an article is a commercial act.** Adding `DENIM` to a
//!    jacket puts it into every promotion that selects on that tag, and the
//!    person doing it is looking at a product form that says nothing about
//!    promotions.
//!
//! This module writes the first down and answers the second.
//!
//! # Two questions, deliberately not one
//!
//! *Usage* is "a promotion names this tag" — [`super::vocabulary`] answers that
//! for the master lists, and it is what stops a tag being deleted.
//!
//! *Consequence* is "removing this tag from THIS article changes whether the
//! article matches that promotion". It is a different query and a more useful
//! answer: a tag used by forty promotions is not a reason to stop editing an
//! article, and the one promotion whose membership actually moves is.
//!
//! # Where the phases come from
//!
//! Nothing here invents a state. A rule's stored status is
//! `DRAFT | ACTIVE | PAUSED | EXPIRED` and the phase people read is derived
//! from that plus the window in `conditions` — exactly as `phaseOf` in
//! `screens/commercial/promotions.tsx` derives it, and for the reason written
//! there: a status meaning "the date has passed" is wrong from the moment it is
//! written unless something rewrites it at midnight.
//!
//! So: **started** is a published, ACTIVE rule whose window has opened and not
//! closed; **scheduled** is a published, ACTIVE rule whose window has not
//! opened yet. Only the second can still change what it will cover, which is
//! why it is the one a consequence warning is about.

use super::pricing::{load_merchandise, Merchandise};
use crate::cloud::application::AppError;
use crate::cloud::domain::FrozenEligibility;
use chrono::{DateTime, Utc};
use pricing_engine::rule::{Applicability, Rule, RuleStatus};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::{PgPool, Postgres, Row, Transaction};
use std::collections::{BTreeMap, BTreeSet};
use uuid::Uuid;

/// One rule as this module needs it: the document, and which book it came from.
struct LiveRule {
    rule_id: String,
    name: String,
    publication_id: Uuid,
    rule: Rule,
}

/// Where a rule stands against the clock. The three phases this module
/// distinguishes; `promotions.tsx` draws a fourth (`PAUSED`) from the same
/// facts, and a paused rule is simply not live here.
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RulePhase {
    /// Published, active, and inside its window.
    Active,
    /// Published, active, and its window has not opened yet.
    Scheduled,
    /// Paused, draft, or past its window. Nothing here reports these.
    Dormant,
}

fn phase_of(rule: &Rule, at: DateTime<Utc>) -> RulePhase {
    // Order copied from `phaseOf`: a closed window outranks a switch that is
    // off, because both say the offer is not running and only one of them says
    // turning it back on would change nothing.
    if rule.status == RuleStatus::Expired {
        return RulePhase::Dormant;
    }
    if rule.conditions.effective_to.is_some_and(|to| to <= at) {
        return RulePhase::Dormant;
    }
    if rule.status != RuleStatus::Active {
        return RulePhase::Dormant;
    }
    if rule.conditions.effective_from.is_some_and(|from| from > at) {
        return RulePhase::Scheduled;
    }
    RulePhase::Active
}

/// The rules a shop would price against: newest published book per `rule_id`.
///
/// The same `DISTINCT ON` the pricing snapshot uses, and for the same reason —
/// a promotion republished is one promotion amended, not two. Reading it any
/// other way here would make this module disagree with the till about which
/// document is the promotion.
async fn live_rules(tx: &mut Transaction<'_, Postgres>) -> Result<Vec<LiveRule>, AppError> {
    let rows = sqlx::query(
        "SELECT DISTINCT ON (r.rule_id) r.rule_id, r.name, r.publication_id, r.definition
           FROM commercial_rule r
           JOIN commercial_publication p ON p.id = r.publication_id
          WHERE p.status = 'PUBLISHED'
          ORDER BY r.rule_id, p.version DESC",
    )
    .fetch_all(&mut **tx)
    .await?;

    let mut rules = Vec::with_capacity(rows.len());
    for row in rows {
        let definition: Value = row.try_get("definition")?;
        // A document this build cannot read is skipped rather than fatal. The
        // alternative is a product form that refuses to save because a
        // promotion somebody wrote last year has a field this binary does not
        // know — which would make an unrelated screen unusable.
        let Ok(rule) = serde_json::from_value::<Rule>(definition) else {
            continue;
        };
        rules.push(LiveRule {
            rule_id: row.try_get("rule_id")?,
            name: row.try_get("name")?,
            publication_id: row.try_get("publication_id")?,
            rule,
        });
    }
    Ok(rules)
}

/// What an article is, as a selector reads it.
#[derive(Clone, Debug, Default)]
pub struct ArticleFacts {
    pub article_code: String,
    pub division_code: Option<String>,
    pub tags: BTreeSet<String>,
    /// The article's own SKU codes. What a `Sku` selector names and what a
    /// frozen set holds.
    pub sku_codes: BTreeSet<String>,
}

/// Does this selector cover this article?
///
/// The engine's own [`Applicability`] rather than a second reading of it: the
/// selector is the promotion's, and a copy of "what a tag rule means" that
/// lives in another module is a copy that will one day disagree with the till.
///
/// [`Applicability::WholeCart`] is not a product selector — the basket is the
/// subject and no article is in or out of it — so it never produces a
/// consequence and is never frozen.
fn covers(applicability: &Applicability, article: &ArticleFacts) -> bool {
    match applicability {
        Applicability::Sku { sku_codes } => article
            .sku_codes
            .iter()
            .any(|code| sku_codes.contains(code)),
        Applicability::Article { article_codes } => article_codes.contains(&article.article_code),
        Applicability::Division { divisions } => article
            .division_code
            .as_ref()
            .is_some_and(|code| divisions.contains(code)),
        Applicability::Tag { tags } => article.tags.iter().any(|tag| tags.contains(tag)),
        Applicability::WholeCart => false,
    }
}

/// Both halves of a rule's product scope: what it applies to, and where the
/// money lands when that is somewhere else.
///
/// "Buy a suit, get 50% off a shirt" names the shirts in `effect_on`, and an
/// article that stops being a shirt has left that promotion just as surely as
/// one that stops being a suit.
fn selectors(rule: &Rule) -> Vec<&Applicability> {
    rule.scope
        .applicability
        .iter()
        .chain(rule.scope.effect_on.iter())
        .collect()
}

fn covered_by_rule(rule: &Rule, article: &ArticleFacts) -> bool {
    selectors(rule).into_iter().any(|one| covers(one, article))
}

// ---------------------------------------------------------------------------
// Freezing what a started promotion matched.

/// Resolve every started rule that has no resolution yet, and keep the answer.
///
/// Idempotent and additive: a rule with a row is left exactly as it was, so
/// running this twice a minute costs two reads and changes nothing. That is
/// also the whole safety property — a pass that re-resolved would quietly move
/// what a live promotion covers, which is a decision, not a background job.
///
/// Returns how many rules were resolved, for the log line.
pub async fn freeze_started_rule_eligibility(pool: &PgPool) -> Result<usize, AppError> {
    let mut tx = pool.begin().await?;
    let frozen = freeze_started_rules(&mut tx, Utc::now()).await?;
    tx.commit().await?;
    if frozen > 0 {
        // A frozen set the shops never receive would leave the centre saying
        // one thing and every till doing another, which is worse than not
        // freezing at all. Sent after the commit rather than inside it: the
        // command is a message about a fact, and the fact has to be true first.
        publish_rule_eligibility_to_fleet(pool, "system:eligibility-pass").await?;
    }
    Ok(frozen)
}

/// Send every frozen rule to every shop.
///
/// Whole rather than incremental, exactly like the usage counts and the
/// campaign switches this rides beside: a shop that missed one message is
/// behind rather than permanently wrong, and the next pass repairs it. See
/// `COMMAND_COMMERCIAL_ELIGIBILITY`.
///
/// A DC gets it too. It prices nothing today, but the command is the fleet's
/// statement of what a promotion covers, and a node that holds half of that is
/// a node that will answer half a question later.
pub async fn publish_rule_eligibility_to_fleet(
    pool: &PgPool,
    issued_by: &str,
) -> Result<Option<Uuid>, AppError> {
    let targets: Vec<String> = sqlx::query_scalar(
        "SELECT origin_id FROM sync_origin_credential
          WHERE site_id IS NOT NULL ORDER BY origin_id",
    )
    .fetch_all(pool)
    .await?;
    if targets.is_empty() {
        return Ok(None);
    }

    let rows = sqlx::query(
        "SELECT e.rule_id, e.resolved_at,
                COALESCE(
                    array_agg(s.sku_code ORDER BY s.sku_code)
                        FILTER (WHERE s.role = 'APPLIES_TO'),
                    '{}'
                ) AS applies_to,
                array_agg(s.sku_code ORDER BY s.sku_code)
                    FILTER (WHERE s.role = 'EFFECT_ON') AS effect_on
           FROM commercial_rule_eligibility e
           LEFT JOIN commercial_rule_eligibility_sku s ON s.rule_id = e.rule_id
          GROUP BY e.rule_id, e.resolved_at
          ORDER BY e.rule_id",
    )
    .fetch_all(pool)
    .await?;

    let rules: Vec<Value> = rows
        .iter()
        .map(|row| {
            json!({
                "rule_id": row.get::<String, _>("rule_id"),
                "resolved_at": row.get::<DateTime<Utc>, _>("resolved_at"),
                "applies_to": row.get::<Vec<String>, _>("applies_to"),
                // Null, not an empty list: a rule with no second scope must not
                // arrive looking like one whose second scope matched nothing.
                "effect_on": row.get::<Option<Vec<String>>, _>("effect_on"),
            })
        })
        .collect();

    let payload = json!({ "resolved_at": Utc::now(), "rules": rules });
    let (command_id, _sent_to) = super::sync::issue_command(
        pool,
        crate::cloud::domain::COMMAND_COMMERCIAL_ELIGIBILITY,
        &payload,
        issued_by,
        // No expiry, for the reason the usage and switch lanes have none: a
        // shop back from a week offline needs the newest answer it can get,
        // and a stale frozen set is nearer the truth than the selector it
        // would otherwise re-evaluate against today's catalogue.
        None,
        &targets,
    )
    .await?;
    Ok(Some(command_id))
}

/// What each frozen rule covers, for a caller that is about to price with it.
///
/// The centre's own pricing path reads this so that a simulation, a resolved
/// offer list and a till agree about who is in an offer. See
/// `domain::commercial::narrow_to_frozen`, which is what both of them do with
/// the answer.
pub async fn frozen_eligibility(
    tx: &mut Transaction<'_, Postgres>,
) -> Result<BTreeMap<String, FrozenEligibility>, AppError> {
    let rows = sqlx::query(
        "SELECT rule_id, role, array_agg(sku_code ORDER BY sku_code) AS codes
           FROM commercial_rule_eligibility_sku
          GROUP BY rule_id, role",
    )
    .fetch_all(&mut **tx)
    .await?;

    // Every frozen rule, including one whose set is empty: a rule that matched
    // nothing when it started matches nothing now, and leaving it out would let
    // the selector be read again.
    let mut frozen: BTreeMap<String, FrozenEligibility> =
        sqlx::query_scalar::<_, String>("SELECT rule_id FROM commercial_rule_eligibility")
            .fetch_all(&mut **tx)
            .await?
            .into_iter()
            .map(|rule_id| (rule_id, FrozenEligibility::default()))
            .collect();
    for row in rows {
        let rule_id: String = row.try_get("rule_id")?;
        let role: String = row.try_get("role")?;
        let codes: Vec<String> = row.try_get("codes")?;
        let entry = frozen.entry(rule_id).or_default();
        if role == "EFFECT_ON" {
            entry.effect_on = Some(codes.into_iter().collect());
        } else {
            entry.applies_to = codes.into_iter().collect();
        }
    }
    Ok(frozen)
}

/// The same, inside a caller's transaction. Publishing calls it, so a rule
/// whose window is already open is resolved in the transaction that published
/// it rather than up to five minutes later.
pub(super) async fn freeze_started_rules(
    tx: &mut Transaction<'_, Postgres>,
    at: DateTime<Utc>,
) -> Result<usize, AppError> {
    let already: BTreeSet<String> =
        sqlx::query_scalar::<_, String>("SELECT rule_id FROM commercial_rule_eligibility")
            .fetch_all(&mut **tx)
            .await?
            .into_iter()
            .collect();

    let rules = live_rules(tx).await?;
    let pending: Vec<&LiveRule> = rules
        .iter()
        .filter(|one| !already.contains(&one.rule_id))
        .filter(|one| phase_of(&one.rule, at) == RulePhase::Active)
        // A rule that names no products has nothing to resolve: the basket is
        // its subject, and there is no set of SKUs that is "in" it.
        .filter(|one| one.rule.scope.applicability.is_some())
        .collect();
    if pending.is_empty() {
        return Ok(0);
    }

    // One read of the catalogue for every rule being resolved. The map is the
    // same one the pricing path builds, so a rule freezes over exactly the
    // products the engine would have matched.
    let merchandise = load_merchandise(tx, None).await?;
    let articles = articles_from(&merchandise);

    for one in &pending {
        // The two halves, kept apart. `scope.applicability` is what the offer
        // reads and `scope.effect_on` is where the money lands when that is
        // somewhere else; a shop that replaced the first with the union of both
        // would turn every shirt in "buy a suit, get 50% off a shirt" into a
        // buyer. See migration 0181.
        let applies_to = matching(
            &merchandise,
            &articles,
            one.rule.scope.applicability.as_ref(),
        );
        let effect_on = one
            .rule
            .scope
            .effect_on
            .as_ref()
            .map(|scope| matching(&merchandise, &articles, Some(scope)));

        let selector = serde_json::to_value(&one.rule.scope.applicability)?;
        let counted: BTreeSet<&String> = applies_to
            .iter()
            .chain(effect_on.iter().flatten())
            .collect();
        sqlx::query(
            "INSERT INTO commercial_rule_eligibility
                 (rule_id, publication_id, resolved_at, selector, sku_count)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (rule_id) DO NOTHING",
        )
        .bind(&one.rule_id)
        .bind(one.publication_id)
        .bind(at)
        .bind(&selector)
        .bind(counted.len() as i64)
        .execute(&mut **tx)
        .await?;

        for (role, codes) in [
            ("APPLIES_TO", Some(&applies_to)),
            ("EFFECT_ON", effect_on.as_ref()),
        ] {
            let Some(codes) = codes else { continue };
            if codes.is_empty() {
                continue;
            }
            sqlx::query(
                "INSERT INTO commercial_rule_eligibility_sku (rule_id, sku_code, role)
                 SELECT $1, code, $3 FROM unnest($2::text[]) AS code
                 ON CONFLICT DO NOTHING",
            )
            .bind(&one.rule_id)
            .bind(codes)
            .bind(role)
            .execute(&mut **tx)
            .await?;
        }
    }
    Ok(pending.len())
}

/// Every SKU one scope covers, in catalogue order.
///
/// `None` — a rule with no applicability — matches nothing rather than
/// everything: the freeze pass never offers such a rule in the first place, and
/// answering "everything" to a question nobody asked is how a promotion widens
/// itself.
fn matching(
    merchandise: &BTreeMap<String, Merchandise>,
    articles: &BTreeMap<String, ArticleFacts>,
    scope: Option<&Applicability>,
) -> Vec<String> {
    let Some(scope) = scope else {
        return Vec::new();
    };
    merchandise
        .iter()
        .filter(|(_, facts)| {
            articles
                .get(&facts.article_code)
                .is_some_and(|article| covers(scope, article))
        })
        .map(|(sku_code, _)| sku_code.clone())
        .collect()
}

/// The catalogue as articles rather than as SKUs.
///
/// `load_merchandise` is keyed by SKU because that is what the engine prices;
/// a selector reads an article, and rolling the map up once is cheaper than
/// asking the same question of eleven SKUs of one shirt.
fn articles_from(merchandise: &BTreeMap<String, Merchandise>) -> BTreeMap<String, ArticleFacts> {
    let mut articles: BTreeMap<String, ArticleFacts> = BTreeMap::new();
    for (sku_code, facts) in merchandise {
        let entry = articles
            .entry(facts.article_code.clone())
            .or_insert_with(|| ArticleFacts {
                article_code: facts.article_code.clone(),
                division_code: facts.division_code.clone(),
                tags: facts.tags.iter().cloned().collect(),
                sku_codes: BTreeSet::new(),
            });
        entry.sku_codes.insert(sku_code.clone());
    }
    articles
}

// ---------------------------------------------------------------------------
// What an edit to an article would change.

/// The article as the form has it now — the state being proposed, not the
/// state on record.
///
/// **Both fields are required, and neither means "unchanged".** An
/// `Option<Option<String>>` would say that in Rust and says nothing on the
/// wire — TypeScript flattens it to `string | null` — so a caller that omitted
/// the division would have been asking a different question from the one it
/// thought it was asking. A form proposing an edit knows the whole state it is
/// proposing; sending it is cheaper than a convention nobody can see.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ProposedArticle {
    /// The division the article would have. `null` is a real answer —
    /// unclassified — not "unchanged".
    pub division_code: Option<String>,
    /// The complete set of tags after the edit, not a delta.
    pub tags: Vec<String>,
}

/// One promotion an edit would move this article into or out of.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ArticleConsequence {
    pub rule_id: String,
    pub name: String,
    pub phase: RulePhase,
    /// When it starts, for a scheduled one. The sentence a warning is worth is
    /// "starts 20 Sep", not "is scheduled".
    pub starts_at: Option<DateTime<Utc>>,
    pub ends_at: Option<DateTime<Utc>>,
    /// `true` when the edit would bring the article in, `false` when it would
    /// take it out.
    pub gains: bool,
    /// For a started promotion: when its products were resolved, and whether
    /// this article was among them.
    pub resolved_at: Option<DateTime<Utc>>,
    pub in_frozen_set: bool,
}

/// What a proposed edit to one article would do to the promotions around it.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ArticleConsequences {
    pub article_code: String,
    /// Promotions that have not started. These are the ones an edit really
    /// changes: their product set is resolved when their window opens, so it
    /// will be resolved against whatever the article looks like then.
    pub scheduled: Vec<ArticleConsequence>,
    /// Promotions already running whose selector this edit would have moved
    /// the article across, had they not already been resolved.
    ///
    /// Listed precisely because that is the thing somebody fears when they
    /// untick a tag, and answered rather than left to be guessed: their
    /// membership was fixed when the window opened and this edit does not
    /// touch it. Never the loud half of a warning — see `started_note`.
    pub started: Vec<ArticleConsequence>,
    /// What is true today about a started promotion and this edit, in one
    /// sentence the screen can print without having to know the plumbing.
    pub started_note: Option<String>,
}

/// The sentence the UI prints above the started list.
///
/// It changed on 2026-09-12, when the frozen set began reaching the shops. Up
/// to then it had to say the opposite — that an edit reached a running
/// promotion too — because the till was still matching the rule against the
/// tags in its own copy of the catalogue, and telling somebody their edit was
/// harmless when it was not would have been worse than saying nothing.
///
/// It is true now because of a specific path, not a wish: the centre resolves a
/// rule when its window opens, sends the answer down
/// `commercial.eligibility.v1`, and both the till and the centre's own pricing
/// replace the rule's product scope with it (`domain::commercial::
/// narrow_to_frozen`). The proof is a checkout, in
/// `tests/store_pricing_integration.rs::a_started_promotion_prices_the_products_it_started_with`:
/// a product tagged after the window opened does not join, and one untagged
/// after it does not fall out.
const STARTED_NOTE: &str = "These promotions have already started. Each one \
covers the products it resolved to when it began, and a shop prices against \
that answer — so this edit does not change what they give away.";

pub async fn article_change_consequences(
    pool: &PgPool,
    article_code: &str,
    proposed: &ProposedArticle,
) -> Result<ArticleConsequences, AppError> {
    let mut tx = pool.begin().await?;
    let at = Utc::now();

    let row = sqlx::query(
        "SELECT a.article_code, a.division_code,
                COALESCE(
                    (SELECT array_agg(t.tag_code ORDER BY t.tag_code)
                       FROM article_tag t WHERE t.article_id = a.id),
                    '{}'
                ) tags,
                COALESCE(
                    (SELECT array_agg(s.sku_code ORDER BY s.sku_code)
                       FROM sku s WHERE s.article_id = a.id),
                    '{}'
                ) sku_codes
           FROM article a WHERE a.article_code = $1",
    )
    .bind(article_code)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("Article {article_code}")))?;

    let before = ArticleFacts {
        article_code: row.try_get("article_code")?,
        division_code: row.try_get("division_code")?,
        tags: row.try_get::<Vec<String>, _>("tags")?.into_iter().collect(),
        sku_codes: row
            .try_get::<Vec<String>, _>("sku_codes")?
            .into_iter()
            .collect(),
    };
    let after = ArticleFacts {
        division_code: proposed.division_code.clone(),
        tags: proposed.tags.iter().cloned().collect(),
        ..before.clone()
    };

    let frozen: BTreeMap<String, (DateTime<Utc>, bool)> = frozen_for(&mut tx, &before).await?;
    let rules = live_rules(&mut tx).await?;
    tx.commit().await?;

    let mut scheduled = Vec::new();
    let mut started = Vec::new();
    for one in &rules {
        let phase = phase_of(&one.rule, at);
        if phase == RulePhase::Dormant {
            continue;
        }
        let was = covered_by_rule(&one.rule, &before);
        let will = covered_by_rule(&one.rule, &after);
        if was == will {
            continue;
        }
        let (resolved_at, in_frozen_set) = match frozen.get(&one.rule_id) {
            Some((when, inside)) => (Some(*when), *inside),
            None => (None, false),
        };
        let consequence = ArticleConsequence {
            rule_id: one.rule_id.clone(),
            name: one.name.clone(),
            phase,
            starts_at: one.rule.conditions.effective_from,
            ends_at: one.rule.conditions.effective_to,
            gains: will,
            resolved_at,
            in_frozen_set,
        };
        match phase {
            RulePhase::Scheduled => scheduled.push(consequence),
            RulePhase::Active => started.push(consequence),
            RulePhase::Dormant => {}
        }
    }
    // Soonest first: the promotion starting on Saturday is the one somebody
    // has to think about, and the one starting in March is not.
    scheduled.sort_by(|a, b| a.starts_at.cmp(&b.starts_at).then(a.name.cmp(&b.name)));
    started.sort_by(|a, b| a.name.cmp(&b.name));

    let started_note = (!started.is_empty()).then(|| STARTED_NOTE.to_owned());
    Ok(ArticleConsequences {
        article_code: before.article_code,
        scheduled,
        started,
        started_note,
    })
}

/// What each started promotion resolved to, as far as this article is
/// concerned: when, and whether any of its SKUs were in the answer.
async fn frozen_for(
    tx: &mut Transaction<'_, Postgres>,
    article: &ArticleFacts,
) -> Result<BTreeMap<String, (DateTime<Utc>, bool)>, AppError> {
    let codes: Vec<String> = article.sku_codes.iter().cloned().collect();
    let rows = sqlx::query(
        "SELECT e.rule_id, e.resolved_at,
                EXISTS (
                    SELECT 1 FROM commercial_rule_eligibility_sku s
                     WHERE s.rule_id = e.rule_id AND s.sku_code = ANY($1)
                ) AS inside
           FROM commercial_rule_eligibility e",
    )
    .bind(&codes)
    .fetch_all(&mut **tx)
    .await?;
    let mut frozen = BTreeMap::new();
    for row in rows {
        frozen.insert(
            row.try_get::<String, _>("rule_id")?,
            (
                row.try_get::<DateTime<Utc>, _>("resolved_at")?,
                row.try_get::<bool, _>("inside")?,
            ),
        );
    }
    Ok(frozen)
}
