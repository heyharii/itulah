//! What a started promotion matched, and what editing an article would change.
//!
//! # Why these particular tests
//!
//! Two things were invisible before `0175`, and both of them are commercial
//! rather than cosmetic:
//!
//!  - **a running promotion had no record of what it covers.** `Tag = Denim` is
//!    the question; the answer moved every time somebody tagged an article, and
//!    nobody could see it move.
//!  - **editing an article is a commercial act.** Adding a tag puts a product
//!    into every promotion that selects on it, and the person doing it is
//!    looking at a product form that says nothing about promotions.
//!
//! So what is guarded here is: a started rule resolves once and never again on
//! its own; a scheduled rule is reported as changeable, because it is; and a
//! tag nothing selects on produces no warning at all — a warning that fires on
//! every edit is a warning nobody reads.
//!
//! # How the fixture is planted
//!
//! With SQL. The subject is the eligibility pass and the consequence query, not
//! the composer that authors a book — and a rule written by hand is a rule
//! whose selector this file can state plainly. Every code carries `T-` or
//! `TEST_` so an assertion is about this suite's rows rather than about the
//! demo seed.

use chrono::{DateTime, Duration, Utc};
use inventory_backend::cloud::postgres::{
    article_change_consequences, freeze_started_rule_eligibility, ProposedArticle,
};
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

fn now() -> DateTime<Utc> {
    Utc::now()
}

/// One article, its tags and one SKU. Enough to be matched by a selector and
/// to appear in a frozen set.
async fn plant_article(pool: &PgPool, code: &str, division: Option<&str>, tags: &[&str]) {
    let id = Uuid::new_v4();
    sqlx::query("INSERT INTO article (id, article_code, name, division_code) VALUES ($1,$2,$3,$4)")
        .bind(id)
        .bind(code)
        .bind(format!("Test {code}"))
        .bind(division)
        .execute(pool)
        .await
        .unwrap_or_else(|e| panic!("article {code}: {e}"));
    for tag in tags {
        sqlx::query("INSERT INTO article_tag (article_id, tag_code) VALUES ($1,$2)")
            .bind(id)
            .bind(tag)
            .execute(pool)
            .await
            .unwrap_or_else(|e| panic!("tag {tag} on {code}: {e}"));
    }
    sqlx::query("INSERT INTO sku (id, article_id, sku_code, active) VALUES ($1,$2,$3,true)")
        .bind(Uuid::new_v4())
        .bind(id)
        .bind(format!("{code}-01"))
        .execute(pool)
        .await
        .unwrap_or_else(|e| panic!("sku for {code}: {e}"));
}

/// A published book with one rule in it, whose window is what the test is
/// about. `starts` in the past is a promotion that has started; in the future,
/// one that is scheduled.
async fn plant_rule(
    pool: &PgPool,
    rule_id: &str,
    name: &str,
    applicability: serde_json::Value,
    starts: DateTime<Utc>,
) {
    let book = Uuid::new_v4();
    let version: i64 =
        sqlx::query_scalar("SELECT COALESCE(MAX(version), 0) + 1 FROM commercial_publication")
            .fetch_one(pool)
            .await
            .unwrap_or_else(|e| panic!("next version: {e}"));
    // DRAFT first and published at the end: `protect_commercial_rule` refuses
    // to insert a rule into a book that is already out, which is the guard that
    // makes a published price immutable. The composer works the same way.
    sqlx::query(
        "INSERT INTO commercial_publication
             (id, version, name, status, effective_from, created_by)
         VALUES ($1, $2, $3, 'DRAFT', $4, 'test')",
    )
    .bind(book)
    .bind(version)
    .bind(format!("book for {rule_id}"))
    .bind(now() - Duration::days(30))
    .execute(pool)
    .await
    .unwrap_or_else(|e| panic!("book for {rule_id}: {e}"));

    // The document as the engine serialises it. Every field the engine cannot
    // default is present, because a rule this build cannot read is one the
    // pass skips — which would make a test pass by doing nothing.
    let definition = json!({
        "rule_id": rule_id,
        "name": name,
        "status": "ACTIVE",
        "scope": { "applicability": applicability },
        "conditions": { "effective_from": starts },
        "effect": { "kind": "PERCENT", "bps": 2000 },
    });
    sqlx::query(
        "INSERT INTO commercial_rule
             (id, publication_id, rule_id, name, definition, status, priority)
         VALUES ($1, $2, $3, $4, $5, 'ACTIVE', 0)",
    )
    .bind(Uuid::new_v4())
    .bind(book)
    .bind(rule_id)
    .bind(name)
    .bind(definition)
    .execute(pool)
    .await
    .unwrap_or_else(|e| panic!("rule {rule_id}: {e}"));

    sqlx::query(
        "UPDATE commercial_publication
            SET status = 'PUBLISHED', published_by = 'test', published_at = now()
          WHERE id = $1",
    )
    .bind(book)
    .execute(pool)
    .await
    .unwrap_or_else(|e| panic!("publish {rule_id}: {e}"));
}

async fn frozen_skus(pool: &PgPool, rule_id: &str) -> Vec<String> {
    sqlx::query_scalar(
        "SELECT sku_code FROM commercial_rule_eligibility_sku
          WHERE rule_id = $1 ORDER BY sku_code",
    )
    .bind(rule_id)
    .fetch_all(pool)
    .await
    .unwrap_or_else(|e| panic!("frozen skus: {e}"))
}

/// The article's state as the form would propose it, with one tag dropped.
fn without(tags: &[&str], dropped: &str) -> ProposedArticle {
    ProposedArticle {
        division_code: None,
        tags: tags
            .iter()
            .filter(|tag| **tag != dropped)
            .map(|tag| (*tag).to_owned())
            .collect(),
    }
}

// ---------------------------------------------------------------------------

/// A promotion that has started resolves once, and nothing later moves it.
///
/// This is the whole point of the table. `Tag = Denim` matched one article when
/// the window opened; tagging a second article the next morning is a change to
/// the catalogue, not to what that promotion resolved to, and the record has to
/// go on saying what it said.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_started_promotion_keeps_what_it_matched(pool: PgPool) {
    sqlx::query("INSERT INTO tag (code, label) VALUES ('TEST_DENIM','Test Denim')")
        .execute(&pool)
        .await
        .unwrap_or_else(|e| panic!("tag: {e}"));
    plant_article(&pool, "T-JACKET", None, &["TEST_DENIM"]).await;
    plant_article(&pool, "T-SHIRT", None, &[]).await;
    plant_rule(
        &pool,
        "T-RULE-STARTED",
        "Denim Weekend",
        json!({ "on": "TAG", "tags": ["TEST_DENIM"] }),
        now() - Duration::days(1),
    )
    .await;

    let frozen = freeze_started_rule_eligibility(&pool)
        .await
        .unwrap_or_else(|e| panic!("freeze: {e}"));
    assert_eq!(frozen, 1, "the started rule resolves");
    assert_eq!(
        frozen_skus(&pool, "T-RULE-STARTED").await,
        vec!["T-JACKET-01".to_owned()],
        "one article carried the tag when the window opened"
    );

    // The next morning, a second article is given the tag.
    sqlx::query(
        "INSERT INTO article_tag (article_id, tag_code)
         SELECT id, 'TEST_DENIM' FROM article WHERE article_code = 'T-SHIRT'",
    )
    .execute(&pool)
    .await
    .unwrap_or_else(|e| panic!("tag the shirt: {e}"));

    let again = freeze_started_rule_eligibility(&pool)
        .await
        .unwrap_or_else(|e| panic!("second pass: {e}"));
    assert_eq!(again, 0, "a resolved rule is not resolved again");
    assert_eq!(
        frozen_skus(&pool, "T-RULE-STARTED").await,
        vec!["T-JACKET-01".to_owned()],
        "the new article does not join a promotion that has already started"
    );

    // And the tag is taken off the article that was in it.
    sqlx::query("DELETE FROM article_tag WHERE tag_code = 'TEST_DENIM'")
        .execute(&pool)
        .await
        .unwrap_or_else(|e| panic!("untag: {e}"));
    freeze_started_rule_eligibility(&pool)
        .await
        .unwrap_or_else(|e| panic!("third pass: {e}"));
    assert_eq!(
        frozen_skus(&pool, "T-RULE-STARTED").await,
        vec!["T-JACKET-01".to_owned()],
        "what it resolved to is a fact about the past, so unpicking cannot edit it"
    );
}

/// A promotion that has not started is exactly what a warning is for.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn removing_a_tag_names_the_promotion_that_has_not_started(pool: PgPool) {
    sqlx::query("INSERT INTO tag (code, label) VALUES ('TEST_DENIM','Test Denim')")
        .execute(&pool)
        .await
        .unwrap_or_else(|e| panic!("tag: {e}"));
    plant_article(&pool, "T-JACKET", None, &["TEST_DENIM"]).await;
    plant_rule(
        &pool,
        "T-RULE-SOON",
        "Denim Weekend",
        json!({ "on": "TAG", "tags": ["TEST_DENIM"] }),
        now() + Duration::days(8),
    )
    .await;

    let answer =
        article_change_consequences(&pool, "T-JACKET", &without(&["TEST_DENIM"], "TEST_DENIM"))
            .await
            .unwrap_or_else(|e| panic!("consequences: {e}"));

    assert_eq!(answer.scheduled.len(), 1, "one promotion moves: {answer:?}");
    let one = &answer.scheduled[0];
    assert_eq!(one.rule_id, "T-RULE-SOON");
    assert_eq!(one.name, "Denim Weekend");
    assert!(!one.gains, "the article would leave it, not join it");
    assert!(one.starts_at.is_some(), "and the warning can say when");
    assert!(answer.started.is_empty(), "nothing has started: {answer:?}");

    // A rule nothing has resolved yet has no frozen record to report.
    let frozen = freeze_started_rule_eligibility(&pool)
        .await
        .unwrap_or_else(|e| panic!("freeze: {e}"));
    assert_eq!(frozen, 0, "a scheduled rule is not resolved early");
}

/// A tag no promotion selects on is not a warning.
///
/// The failure this guards is the one that makes a warning worthless: firing on
/// every edit because the tag is "used somewhere". Usage is not consequence.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn an_unselected_tag_is_not_a_consequence(pool: PgPool) {
    for code in ["TEST_DENIM", "TEST_BASIC"] {
        sqlx::query("INSERT INTO tag (code, label) VALUES ($1, $1)")
            .bind(code)
            .execute(&pool)
            .await
            .unwrap_or_else(|e| panic!("tag {code}: {e}"));
    }
    plant_article(&pool, "T-JACKET", None, &["TEST_DENIM", "TEST_BASIC"]).await;
    plant_rule(
        &pool,
        "T-RULE-SOON",
        "Denim Weekend",
        json!({ "on": "TAG", "tags": ["TEST_DENIM"] }),
        now() + Duration::days(8),
    )
    .await;

    let answer = article_change_consequences(
        &pool,
        "T-JACKET",
        &without(&["TEST_DENIM", "TEST_BASIC"], "TEST_BASIC"),
    )
    .await
    .unwrap_or_else(|e| panic!("consequences: {e}"));

    assert!(
        answer.scheduled.is_empty() && answer.started.is_empty(),
        "no promotion reads TEST_BASIC, so nothing is affected: {answer:?}"
    );

    // And the same fixture DOES answer for the tag the promotion reads, which
    // is what stops this test passing because the rule was unreadable.
    let denim = article_change_consequences(
        &pool,
        "T-JACKET",
        &without(&["TEST_DENIM", "TEST_BASIC"], "TEST_DENIM"),
    )
    .await
    .unwrap_or_else(|e| panic!("consequences: {e}"));
    assert_eq!(
        denim.scheduled.len(),
        1,
        "the promotion is live enough to answer for its own tag: {denim:?}"
    );
}

/// A started promotion is reported apart from a scheduled one, and with the
/// facts that make it readable: when it resolved, and whether this article was
/// in the answer.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_started_promotion_is_reported_as_already_resolved(pool: PgPool) {
    sqlx::query("INSERT INTO tag (code, label) VALUES ('TEST_DENIM','Test Denim')")
        .execute(&pool)
        .await
        .unwrap_or_else(|e| panic!("tag: {e}"));
    plant_article(&pool, "T-JACKET", None, &["TEST_DENIM"]).await;
    plant_rule(
        &pool,
        "T-RULE-STARTED",
        "Denim Weekend",
        json!({ "on": "TAG", "tags": ["TEST_DENIM"] }),
        now() - Duration::days(1),
    )
    .await;
    freeze_started_rule_eligibility(&pool)
        .await
        .unwrap_or_else(|e| panic!("freeze: {e}"));

    let answer =
        article_change_consequences(&pool, "T-JACKET", &without(&["TEST_DENIM"], "TEST_DENIM"))
            .await
            .unwrap_or_else(|e| panic!("consequences: {e}"));

    assert!(
        answer.scheduled.is_empty(),
        "it has started, so it is not in the half a warning shouts about: {answer:?}"
    );
    assert_eq!(
        answer.started.len(),
        1,
        "and it is in the other: {answer:?}"
    );
    let one = &answer.started[0];
    assert!(one.resolved_at.is_some(), "it says when it resolved");
    assert!(one.in_frozen_set, "and that this article was in the answer");
    assert!(
        answer.started_note.is_some(),
        "with the sentence that says what that means today"
    );
}

/// A rule that selects on a division moves with the division.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn changing_the_division_is_a_consequence_too(pool: PgPool) {
    plant_article(&pool, "T-JACKET", Some("MENSWEAR"), &[]).await;
    plant_rule(
        &pool,
        "T-RULE-MENS",
        "Menswear week",
        json!({ "on": "DIVISION", "divisions": ["MENSWEAR"] }),
        now() + Duration::days(3),
    )
    .await;

    let answer = article_change_consequences(
        &pool,
        "T-JACKET",
        &ProposedArticle {
            division_code: Some("WOMENSWEAR".to_owned()),
            tags: Vec::new(),
        },
    )
    .await
    .unwrap_or_else(|e| panic!("consequences: {e}"));

    assert_eq!(
        answer.scheduled.len(),
        1,
        "the division rule moves: {answer:?}"
    );
    assert!(!answer.scheduled[0].gains, "it would leave the promotion");

    // And the other direction: an article moved INTO the division joins it.
    plant_article(&pool, "T-DRESS", Some("WOMENSWEAR"), &[]).await;
    let joining = article_change_consequences(
        &pool,
        "T-DRESS",
        &ProposedArticle {
            division_code: Some("MENSWEAR".to_owned()),
            tags: Vec::new(),
        },
    )
    .await
    .unwrap_or_else(|e| panic!("consequences: {e}"));
    assert_eq!(joining.scheduled.len(), 1, "{joining:?}");
    assert!(
        joining.scheduled[0].gains,
        "an article that starts matching is as much a consequence as one that stops"
    );
}

/// A repeated pass leaves a resolved promotion exactly as it found it.
///
/// Guarded on its own, and not only as a line in the test above, because this
/// is the property the whole design rests on: the pass runs every five minutes
/// forever, and a pass that rewrote what it found would move a live offer
/// silently, once per tick, for as long as the promotion ran.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_second_pass_does_not_rewrite_what_the_first_resolved(pool: PgPool) {
    sqlx::query("INSERT INTO tag (code, label) VALUES ('TEST_DENIM','Test Denim')")
        .execute(&pool)
        .await
        .unwrap_or_else(|e| panic!("tag: {e}"));
    plant_article(&pool, "T-JACKET", None, &["TEST_DENIM"]).await;
    plant_rule(
        &pool,
        "T-RULE-TWICE",
        "Denim Weekend",
        json!({ "on": "TAG", "tags": ["TEST_DENIM"] }),
        now() - Duration::days(1),
    )
    .await;

    freeze_started_rule_eligibility(&pool)
        .await
        .unwrap_or_else(|e| panic!("first pass: {e}"));
    let first: DateTime<Utc> =
        sqlx::query_scalar("SELECT resolved_at FROM commercial_rule_eligibility WHERE rule_id = $1")
            .bind("T-RULE-TWICE")
            .fetch_one(&pool)
            .await
            .unwrap_or_else(|e| panic!("read resolved_at: {e}"));

    plant_article(&pool, "T-SECOND", None, &["TEST_DENIM"]).await;
    for _ in 0..3 {
        freeze_started_rule_eligibility(&pool)
            .await
            .unwrap_or_else(|e| panic!("later pass: {e}"));
    }

    assert_eq!(
        frozen_skus(&pool, "T-RULE-TWICE").await,
        vec!["T-JACKET-01".to_owned()],
        "three more passes and the answer is the one the first pass gave"
    );
    let again: DateTime<Utc> =
        sqlx::query_scalar("SELECT resolved_at FROM commercial_rule_eligibility WHERE rule_id = $1")
            .bind("T-RULE-TWICE")
            .fetch_one(&pool)
            .await
            .unwrap_or_else(|e| panic!("read resolved_at: {e}"));
    assert_eq!(first, again, "and it still says when it was resolved");
}

/// Republishing the same promotion does not replace what it already covers.
///
/// A rule identity is its `rule_id` across publications — the shop loads
/// `DISTINCT ON (rule_id)`, newest book wins — so a book cut in October that
/// carries September's promotion is the same promotion, amended. Amending it
/// must not silently re-resolve a membership that is already running: changing
/// what a live offer covers is a decision somebody makes, not a side effect of
/// publishing a price list.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn republishing_a_started_rule_keeps_the_membership_it_started_with(pool: PgPool) {
    sqlx::query("INSERT INTO tag (code, label) VALUES ('TEST_DENIM','Test Denim')")
        .execute(&pool)
        .await
        .unwrap_or_else(|e| panic!("tag: {e}"));
    plant_article(&pool, "T-JACKET", None, &["TEST_DENIM"]).await;
    plant_rule(
        &pool,
        "T-RULE-AMENDED",
        "Denim Weekend",
        json!({ "on": "TAG", "tags": ["TEST_DENIM"] }),
        now() - Duration::days(1),
    )
    .await;
    freeze_started_rule_eligibility(&pool)
        .await
        .unwrap_or_else(|e| panic!("freeze: {e}"));

    // A second article takes the tag, and the promotion is republished in a
    // newer book — the two things that would have to happen for a re-resolve
    // to look justified.
    plant_article(&pool, "T-SECOND", None, &["TEST_DENIM"]).await;
    plant_rule(
        &pool,
        "T-RULE-AMENDED",
        "Denim Weekend, again",
        json!({ "on": "TAG", "tags": ["TEST_DENIM"] }),
        now() - Duration::days(1),
    )
    .await;
    freeze_started_rule_eligibility(&pool)
        .await
        .unwrap_or_else(|e| panic!("pass after the republish: {e}"));

    assert_eq!(
        frozen_skus(&pool, "T-RULE-AMENDED").await,
        vec!["T-JACKET-01".to_owned()],
        "the newer book does not widen a promotion that is already running"
    );
}

/// What a promotion will cover is still open until it starts.
///
/// The other half of the freeze, and the reason a scheduled promotion is the
/// one a warning is about: an article edited before the window opens changes
/// what the pass will resolve, because the pass has not run.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_catalogue_change_before_the_window_opens_changes_what_gets_frozen(pool: PgPool) {
    sqlx::query("INSERT INTO tag (code, label) VALUES ('TEST_DENIM','Test Denim')")
        .execute(&pool)
        .await
        .unwrap_or_else(|e| panic!("tag: {e}"));
    plant_article(&pool, "T-JACKET", None, &["TEST_DENIM"]).await;
    // A rule that has not started: its window opens in a moment.
    plant_rule(
        &pool,
        "T-RULE-SOON",
        "Denim Weekend",
        json!({ "on": "TAG", "tags": ["TEST_DENIM"] }),
        now() + Duration::seconds(1),
    )
    .await;
    assert_eq!(
        freeze_started_rule_eligibility(&pool)
            .await
            .unwrap_or_else(|e| panic!("early pass: {e}")),
        0,
        "nothing is resolved before the window opens"
    );

    // Head office adds a second article while the promotion is still waiting.
    plant_article(&pool, "T-SECOND", None, &["TEST_DENIM"]).await;
    tokio::time::sleep(std::time::Duration::from_millis(1_100)).await;
    freeze_started_rule_eligibility(&pool)
        .await
        .unwrap_or_else(|e| panic!("pass after the window opened: {e}"));

    assert_eq!(
        frozen_skus(&pool, "T-RULE-SOON").await,
        vec!["T-JACKET-01".to_owned(), "T-SECOND-01".to_owned()],
        "both, because the edit landed before the promotion started"
    );
}

/// The two halves of a rule's scope are frozen apart.
///
/// "Buy a suit, get 50% off a shirt" names the suits in `applicability` and the
/// shirts in `effect_on`. Flattened into one set — which is what `0175` did
/// before `0181` — a shop replacing the applicability with the union would make
/// every shirt a buyer, and the promotion would pay out on baskets that never
/// contained a suit.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_rule_with_two_scopes_freezes_each_of_them(pool: PgPool) {
    for code in ["TEST_SUIT", "TEST_SHIRT"] {
        sqlx::query("INSERT INTO tag (code, label) VALUES ($1, $1)")
            .bind(code)
            .execute(&pool)
            .await
            .unwrap_or_else(|e| panic!("tag {code}: {e}"));
    }
    plant_article(&pool, "T-SUIT", None, &["TEST_SUIT"]).await;
    plant_article(&pool, "T-SHIRT", None, &["TEST_SHIRT"]).await;

    let book = Uuid::new_v4();
    let version: i64 =
        sqlx::query_scalar("SELECT COALESCE(MAX(version), 0) + 1 FROM commercial_publication")
            .fetch_one(&pool)
            .await
            .unwrap_or_else(|e| panic!("version: {e}"));
    sqlx::query(
        "INSERT INTO commercial_publication
             (id, version, name, status, effective_from, created_by)
         VALUES ($1, $2, 'bundle book', 'DRAFT', now(), 'test')",
    )
    .bind(book)
    .bind(version)
    .execute(&pool)
    .await
    .unwrap_or_else(|e| panic!("book: {e}"));
    sqlx::query(
        "INSERT INTO commercial_rule
             (id, publication_id, rule_id, name, definition, status, priority)
         VALUES ($1, $2, 'T-RULE-BUNDLE', 'Suit and shirt', $3, 'ACTIVE', 0)",
    )
    .bind(Uuid::new_v4())
    .bind(book)
    .bind(json!({
        "rule_id": "T-RULE-BUNDLE",
        "name": "Suit and shirt",
        "status": "ACTIVE",
        "scope": {
            "applicability": { "on": "TAG", "tags": ["TEST_SUIT"] },
            "effect_on": { "on": "TAG", "tags": ["TEST_SHIRT"] }
        },
        "conditions": { "effective_from": now() - Duration::days(1) },
        "effect": { "kind": "PERCENT", "bps": 5_000 },
    }))
    .execute(&pool)
    .await
    .unwrap_or_else(|e| panic!("rule: {e}"));
    sqlx::query(
        "UPDATE commercial_publication
            SET status = 'PUBLISHED', published_by = 'test', published_at = now()
          WHERE id = $1",
    )
    .bind(book)
    .execute(&pool)
    .await
    .unwrap_or_else(|e| panic!("publish: {e}"));

    freeze_started_rule_eligibility(&pool)
        .await
        .unwrap_or_else(|e| panic!("freeze: {e}"));

    async fn by_role(pool: &PgPool, role: &str) -> Vec<String> {
        sqlx::query_scalar::<_, String>(
            "SELECT sku_code FROM commercial_rule_eligibility_sku
              WHERE rule_id = 'T-RULE-BUNDLE' AND role = $1 ORDER BY sku_code",
        )
        .bind(role)
        .fetch_all(pool)
        .await
        .unwrap_or_else(|e| panic!("read {role}: {e}"))
    }
    assert_eq!(
        by_role(&pool, "APPLIES_TO").await,
        vec!["T-SUIT-01".to_owned()],
        "the suits are what the offer reads"
    );
    assert_eq!(
        by_role(&pool, "EFFECT_ON").await,
        vec!["T-SHIRT-01".to_owned()],
        "and the shirts are where the money lands"
    );
}
