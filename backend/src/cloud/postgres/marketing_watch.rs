//! Head office, told what its promotions are doing — and the shops, told the
//! count the moment it matters.
//!
//! Two passes live here, on two clocks.
//!
//! **The usage watch** ([`watch_commercial_usage`]) runs on the apply loop,
//! straight after each apply pass, because that is the only moment a count
//! changes. It records every budget or basket cap that has just been crossed
//! (`commercial_cap_alert`, 0386), tells head office once per line, and sends
//! the fleet a fresh count: at once when a line was crossed, otherwise once the
//! last count is a few minutes old — and, when nothing has changed, only as an
//! hourly heartbeat for a till that starts with none. It
//! replaces the fixed fifteen-minute beat, which sent the same count to every
//! shop whether or not anything had happened and let a crossed budget wait up
//! to a quarter of an hour to reach a till.
//!
//! **The marketing scheduler** ([`run_marketing_watch`]) runs on its own
//! minute-long clock and notices what no sale causes: a shop that could not put
//! a price book into service, one that has said nothing about it, one still
//! enforcing from an old count, a campaign guardrail crossed, and the
//! promotions that start or end tomorrow. Each notice is claimed once in
//! `scheduled_job_run`, the way the HR nudges and the reminders are, so a
//! restarted node or a second worker never tells anybody twice.
//!
//! **Nothing here gates a sale.** The tills refuse a spent offer from their own
//! counts; this module only makes those counts fresher and makes sure somebody
//! at head office knows. It also never runs inside the transaction that applies
//! a sale: a notice that could not be written must not stop a shop's stream.

use chrono::{DateTime, Duration, NaiveDate, Utc};
use serde_json::{json, Value};
use sqlx::{PgPool, Postgres, Row, Transaction};

use crate::cloud::application::AppError;
use crate::cloud::domain::marketing_watch::{self as watch, jobs, kinds, Band, Crossing, Measure};
use crate::cloud::postgres::{
    self as infrastructure, claim_run, finish_run, NewNotification, SchedulerJobResult,
};

/// The name on every notice and count this module sends.
pub const WATCH_ACTOR: &str = "marketing-watch";

/// What the usage watch carries between ticks of the apply loop.
///
/// Held in memory on purpose. Every decision it feeds is safe to repeat — an
/// alert is recorded once by its key, and a count sent twice is a count sent —
/// so a restarted node that starts from nothing costs at most one extra count.
#[derive(Debug, Default)]
pub struct UsageWatch {
    /// The total of every `uses` column when the caps were last looked at.
    /// `uses` only ever rises, so an unchanged total is an unchanged table.
    checked_uses: Option<i64>,
    /// The newest `last_used_at` seen then, so the next look reads only the
    /// rows that moved — with a margin, because a row is stamped when its
    /// transaction started, not when it committed.
    checked_through: Option<DateTime<Utc>>,
    /// The total when the last count went out.
    sent_uses: Option<i64>,
    /// When the last count went out. `None` until asked once of the command
    /// log, then kept here.
    last_sent: Option<Option<DateTime<Utc>>>,
}

/// What one tick of the usage watch did.
#[derive(Debug, Default)]
pub struct UsageWatchReport {
    /// Lines crossed and announced on this tick.
    pub announced: usize,
    /// Allowances raised under split limits on this tick.
    pub regranted: usize,
    /// The receipt of the count sent to the fleet, when one was.
    pub sent: Option<Value>,
}

/// How far back a first look reaches. A promotion that ran out last month is
/// history, not news, and announcing every one of them the first time this
/// runs would bury the one that ran out this morning.
const FIRST_LOOK_HOURS: i64 = 24;

/// The margin a look reaches back past the last one. See `checked_through`.
const LOOK_BACK_MARGIN_MINUTES: i64 = 2;

/// One tick: record and announce new crossings, then send a count if one is due.
pub async fn watch_commercial_usage(
    pool: &PgPool,
    state: &mut UsageWatch,
) -> Result<UsageWatchReport, AppError> {
    let now = Utc::now();
    let totals = sqlx::query(
        "SELECT COALESCE(sum(uses), 0)::bigint AS uses, max(last_used_at) AS newest
           FROM commercial_usage",
    )
    .fetch_one(pool)
    .await?;
    let total_uses: i64 = totals.get("uses");
    let newest: Option<DateTime<Utc>> = totals.get("newest");

    let mut report = UsageWatchReport::default();
    if state.checked_uses != Some(total_uses) {
        let since = match state.checked_through {
            Some(through) => through - Duration::minutes(LOOK_BACK_MARGIN_MINUTES),
            None => now - Duration::hours(FIRST_LOOK_HOURS),
        };
        // Neither of these may stop the count going out below. A notice that
        // could not be written is worth a warning; a shop left enforcing an
        // old count because of it is the fault this whole module exists to
        // prevent.
        let mut looked = true;
        match record_crossings(pool, since).await {
            Ok(announced) => report.announced = announced,
            Err(error) => {
                looked = false;
                tracing::warn!(%error, "cap crossings not recorded; the count is still sent");
            }
        }
        // The split limits, re-run on the same trigger: a shop topped up must
        // be told before it stops at an allowance the pool could still fill.
        match super::cap_allocation::rebalance_allocations(pool).await {
            Ok(regranted) => report.regranted = regranted,
            Err(error) => {
                looked = false;
                tracing::warn!(%error, "split limits not rebalanced; the count is still sent");
            }
        }
        // Only after the look succeeded: a failed one is repeated next tick
        // rather than skipped.
        if looked {
            state.checked_uses = Some(total_uses);
            state.checked_through = newest.or(state.checked_through);
        }
    }

    if state.last_sent.is_none() {
        let sent: Option<DateTime<Utc>> = sqlx::query_scalar(
            "SELECT max(issued_at) FROM sync_command WHERE command_type = $1",
        )
        .bind(crate::cloud::domain::COMMAND_COMMERCIAL_USAGE)
        .fetch_one(pool)
        .await?;
        state.last_sent = Some(sent);
    }
    let changed = state.sent_uses != Some(total_uses);
    let last_sent = state.last_sent.flatten();
    let urgent = report.announced > 0 || report.regranted > 0;
    if watch::count_due(now, changed || report.regranted > 0, last_sent, urgent) {
        match super::commercial::publish_commercial_usage_to_fleet(pool, WATCH_ACTOR).await {
            Ok(receipt) => report.sent = Some(receipt),
            // No shop is registered, so there is nobody to send it to. Not a
            // failure of the watch, and not worth asking again every tick.
            Err(AppError::Conflict(_)) => {}
            Err(error) => return Err(error),
        }
        state.last_sent = Some(Some(now));
        state.sent_uses = Some(total_uses);
    }
    Ok(report)
}

/// Every counted promotion, campaign and code that declares a limit, with the
/// limit the newest published book gives it and who published that book.
///
/// The same resolution as the usage screen (`commercial::commercial_usage`):
/// the newest published book that names a thing is the one whose limit
/// stands. Read only for the rows touched since `$1`.
const CAPPED_USAGE: &str = "
    WITH live AS (
        SELECT id, version, published_by FROM commercial_publication
         WHERE status = 'PUBLISHED'
    ), rule AS (
        SELECT DISTINCT ON (r.rule_id) r.rule_id AS key, r.name, p.published_by,
               (r.definition->'caps'->'budget'->>'minor')::bigint AS budget_minor,
               (r.definition->'caps'->>'max_uses')::bigint AS max_uses
          FROM commercial_rule r JOIN live p ON p.id = r.publication_id
         ORDER BY r.rule_id, p.version DESC
    ), campaign AS (
        SELECT DISTINCT ON (c.campaign_id) c.campaign_id AS key, c.name, p.published_by,
               c.budget_minor, c.max_uses::bigint AS max_uses
          FROM commercial_campaign c JOIN live p ON p.id = c.publication_id
         ORDER BY c.campaign_id, p.version DESC
    ), coupon AS (
        SELECT DISTINCT ON (c.code) c.code AS key, p.published_by,
               c.max_uses::bigint AS max_uses
          FROM commercial_coupon c JOIN live p ON p.id = c.publication_id
         ORDER BY c.code, p.version DESC
    )
    SELECT u.kind, u.key, u.uses, u.spent_minor,
           CASE u.kind WHEN 'RULE' THEN r.name WHEN 'CAMPAIGN' THEN g.name END AS name,
           CASE u.kind WHEN 'RULE' THEN r.budget_minor
                       WHEN 'CAMPAIGN' THEN g.budget_minor END AS budget_minor,
           CASE u.kind WHEN 'RULE' THEN r.max_uses
                       WHEN 'CAMPAIGN' THEN g.max_uses
                       WHEN 'COUPON' THEN o.max_uses END AS max_uses,
           CASE u.kind WHEN 'RULE' THEN r.published_by
                       WHEN 'CAMPAIGN' THEN g.published_by
                       WHEN 'COUPON' THEN o.published_by END AS owner
      FROM commercial_usage u
      LEFT JOIN rule r ON u.kind = 'RULE' AND r.key = u.key
      LEFT JOIN campaign g ON u.kind = 'CAMPAIGN' AND g.key = u.key
      LEFT JOIN coupon o ON u.kind = 'COUPON' AND o.key = u.key
     WHERE u.last_used_at > $1";

/// Record each newly crossed line and tell head office, once per limit, at the
/// highest band newly recorded. Returns how many notices were raised.
///
/// One transaction per counted thing: its alert rows and its notice commit
/// together, so a notice that failed leaves no alert behind to say it was sent.
async fn record_crossings(pool: &PgPool, since: DateTime<Utc>) -> Result<usize, AppError> {
    let rows = sqlx::query(CAPPED_USAGE).bind(since).fetch_all(pool).await?;
    let mut announced = 0;
    for row in rows {
        let kind: String = row.get("kind");
        let key: String = row.get("key");
        let found = watch::crossings(
            row.get("uses"),
            row.get("spent_minor"),
            row.get("budget_minor"),
            row.get("max_uses"),
        );
        if found.is_empty() {
            continue;
        }
        let name: Option<String> = row.get("name");
        let owner: Option<String> = row.get("owner");

        let mut tx = pool.begin().await?;
        let mut newly: Vec<Crossing> = Vec::new();
        for crossing in &found {
            let inserted = sqlx::query(
                "INSERT INTO commercial_cap_alert
                     (kind, key, measure, limit_value, band, observed)
                 VALUES ($1, $2, $3, $4, $5, $6)
                 ON CONFLICT DO NOTHING",
            )
            .bind(&kind)
            .bind(&key)
            .bind(crossing.measure.as_str())
            .bind(crossing.limit)
            .bind(crossing.band.as_str())
            .bind(crossing.observed.max(0))
            .execute(&mut *tx)
            .await?
            .rows_affected()
                == 1;
            if inserted {
                newly.push(*crossing);
            }
        }
        for measure in [Measure::Budget, Measure::Uses] {
            let Some(top) = newly
                .iter()
                .filter(|crossing| crossing.measure == measure)
                .max_by_key(|crossing| crossing.band)
            else {
                continue;
            };
            let recipients = head_office_and(&mut tx, owner.as_deref()).await?;
            let what = subject_label(&kind, &key, name.as_deref());
            let (title, body) = cap_words(&what, top);
            infrastructure::raise_notification(
                &mut tx,
                NewNotification {
                    kind: top.band.kind(),
                    title,
                    body,
                    subject: subject_of(&kind, &key),
                    origin_id: None,
                    payload: json!({
                        "source": WATCH_ACTOR,
                        "usage_kind": kind,
                        "key": key,
                        "measure": top.measure.as_str(),
                        "band": top.band.as_str(),
                        "limit": top.limit,
                        "observed": top.observed,
                    }),
                },
                &recipients,
            )
            .await?;
            announced += 1;
        }
        tx.commit().await?;
    }
    Ok(announced)
}

/// Head office, and the person who published the book the limit came from
/// when they still have an account. Deduplicated: an administrator who
/// published it is told once.
async fn head_office_and(
    tx: &mut Transaction<'_, Postgres>,
    owner: Option<&str>,
) -> Result<Vec<String>, AppError> {
    let mut recipients = infrastructure::recipients_with_role(tx, &["ADMIN"]).await?;
    if let Some(owner) = owner.map(str::trim).filter(|owner| !owner.is_empty()) {
        let active: Option<String> = sqlx::query_scalar(
            "SELECT username FROM app_user WHERE active AND username = $1",
        )
        .bind(owner)
        .fetch_optional(&mut **tx)
        .await?;
        if let Some(username) = active {
            if !recipients.contains(&username) {
                recipients.push(username);
            }
        }
    }
    Ok(recipients)
}

/// The record a notice links to, in `record_kind`'s words.
fn subject_of(kind: &str, key: &str) -> Option<(&'static str, String)> {
    match kind {
        "RULE" => Some(("commercial_rule", key.to_owned())),
        "CAMPAIGN" => Some(("campaign", key.to_owned())),
        "COUPON" => Some(("coupon", key.to_owned())),
        _ => None,
    }
}

fn subject_label(kind: &str, key: &str, name: Option<&str>) -> String {
    let name = name.map(str::trim).filter(|name| !name.is_empty()).unwrap_or(key);
    match kind {
        "RULE" => format!("Promotion \u{201c}{name}\u{201d}"),
        "CAMPAIGN" => format!("Campaign \u{201c}{name}\u{201d}"),
        _ => format!("Coupon {key}"),
    }
}

fn cap_words(what: &str, crossing: &Crossing) -> (String, String) {
    let observed = watch::describe(crossing.measure, crossing.observed);
    let limit = watch::describe(crossing.measure, crossing.limit);
    match (crossing.measure, crossing.band) {
        (Measure::Budget, Band::Near) => (
            format!("{what} has used 80% of its budget"),
            format!("{observed} of {limit} given away."),
        ),
        (Measure::Budget, Band::Reached) => (
            format!("{what} has used its whole budget"),
            format!(
                "{observed} of {limit} given away. Every shop is being sent the new count, \
                 so the offer stops at each till as soon as it syncs."
            ),
        ),
        (Measure::Uses, Band::Near) => (
            format!("{what} has used 80% of its limit"),
            format!("{observed} of {limit}."),
        ),
        (Measure::Uses, Band::Reached) => (
            format!("{what} has reached its limit"),
            format!(
                "{observed} of {limit}. Every shop is being sent the new count, \
                 so it stops at each till as soon as it syncs."
            ),
        ),
    }
}

// ── the marketing scheduler ─────────────────────────────────────────────────

/// Run every marketing job for this minute, catching each one's failure so one
/// refused query does not silence the others.
///
/// `sweep_guardrails` is the caller's clock for the heavier job: measuring a
/// campaign reads its takings, which is worth doing every few minutes rather
/// than every one.
pub async fn run_marketing_watch(
    pool: &PgPool,
    now: DateTime<Utc>,
    today: NaiveDate,
    sweep_guardrails: bool,
) -> Vec<SchedulerJobResult> {
    let mut results = Vec::new();
    let mut record = |job: &str, outcome: Result<Value, AppError>| {
        results.push(match outcome {
            Ok(detail) => SchedulerJobResult {
                job: job.to_owned(),
                status: "RAN".into(),
                detail,
            },
            Err(error) => SchedulerJobResult {
                job: job.to_owned(),
                status: "FAILED".into(),
                detail: json!({ "error": error.to_string() }),
            },
        });
    };
    record(jobs::ROLLOUT_FAILED, rollout_failed(pool).await);
    record(jobs::ROLLOUT_STALLED, rollout_stalled(pool, now).await);
    record(jobs::USAGE_STALE, usage_stale(pool, now, today).await);
    if sweep_guardrails {
        record(jobs::GUARDRAIL, guardrails(pool).await);
    }
    record(jobs::CALENDAR, calendar(pool, today).await);
    results
}

/// A shop that reported it could not put a price book into service. One notice
/// per shop per book: the shop's own words say what went wrong, and a retry
/// that fails the same way is not news.
async fn rollout_failed(pool: &PgPool) -> Result<Value, AppError> {
    let rows = sqlx::query(
        "SELECT r.publication_id, r.origin_id, r.version, r.last_error,
                p.name AS book_name, cred.label
           FROM commercial_publication_rollout r
           JOIN commercial_publication p ON p.id = r.publication_id
           LEFT JOIN sync_origin_credential cred ON cred.origin_id = r.origin_id
          WHERE r.state = 'FAILED'
            AND COALESCE(r.last_attempt_at, r.reported_at, r.told_at) > now() - interval '7 days'
          ORDER BY r.publication_id, r.origin_id",
    )
    .fetch_all(pool)
    .await?;
    let mut raised = 0;
    for row in rows {
        let publication_id: uuid::Uuid = row.get("publication_id");
        let origin_id: String = row.get("origin_id");
        let run_key = format!("{publication_id}:{origin_id}");
        let shop = row
            .get::<Option<String>, _>("label")
            .unwrap_or_else(|| origin_id.clone());
        let version: i64 = row.get("version");
        let book: String = row.get("book_name");
        let error: Option<String> = row.get("last_error");
        let body = match error.as_deref().map(str::trim).filter(|text| !text.is_empty()) {
            Some(text) => format!("v{version} \u{201c}{book}\u{201d}. The shop said: {text}"),
            None => format!("v{version} \u{201c}{book}\u{201d}. The shop gave no reason."),
        };
        if raise_once(
            pool,
            jobs::ROLLOUT_FAILED,
            &run_key,
            kinds::ROLLOUT_FAILED,
            &format!("{shop} could not apply a price book"),
            &body,
            Some(("publication", publication_id.to_string())),
            Some(&origin_id),
        )
        .await?
        {
            raised += 1;
        }
    }
    Ok(json!({ "raised": raised }))
}

/// Shops handed a price book half an hour ago that have said nothing about it.
/// One notice per book, naming every shop newly found stalled on it.
async fn rollout_stalled(pool: &PgPool, now: DateTime<Utc>) -> Result<Value, AppError> {
    let cutoff = now - Duration::minutes(watch::ROLLOUT_STALLED_AFTER_MINUTES);
    let rows = sqlx::query(
        "SELECT r.publication_id, r.origin_id, r.version, p.name AS book_name, cred.label
           FROM commercial_publication_rollout r
           JOIN commercial_publication p ON p.id = r.publication_id
           LEFT JOIN sync_origin_credential cred ON cred.origin_id = r.origin_id
          WHERE r.state = 'PENDING'
            AND r.told_at IS NOT NULL
            AND r.told_at < $1
            AND r.told_at > now() - interval '7 days'
          ORDER BY r.publication_id, r.origin_id",
    )
    .bind(cutoff)
    .fetch_all(pool)
    .await?;

    let mut by_book: Vec<(uuid::Uuid, i64, String, Vec<(String, String)>)> = Vec::new();
    for row in rows {
        let publication_id: uuid::Uuid = row.get("publication_id");
        let origin_id: String = row.get("origin_id");
        let shop = row
            .get::<Option<String>, _>("label")
            .unwrap_or_else(|| origin_id.clone());
        match by_book.last_mut() {
            Some((id, _, _, shops)) if *id == publication_id => shops.push((origin_id, shop)),
            _ => by_book.push((
                publication_id,
                row.get("version"),
                row.get("book_name"),
                vec![(origin_id, shop)],
            )),
        }
    }

    let mut raised = 0;
    for (publication_id, version, book, shops) in by_book {
        // Claimed per shop, told per book: a shop already reported stalled on
        // this book is not reported again when a second one joins it.
        let mut fresh: Vec<(String, String)> = Vec::new();
        for (origin_id, shop) in shops {
            if claim_run(pool, jobs::ROLLOUT_STALLED, &format!("{publication_id}:{origin_id}"))
                .await?
            {
                fresh.push((origin_id, shop));
            }
        }
        if fresh.is_empty() {
            continue;
        }
        let names: Vec<&str> = fresh.iter().map(|(_, shop)| shop.as_str()).collect();
        let title = if fresh.len() == 1 {
            format!("{} has not applied a price book", names[0])
        } else {
            format!("{} shops have not applied a price book", fresh.len())
        };
        let body = format!(
            "v{version} \u{201c}{book}\u{201d} was sent {} minutes ago or more and has not been \
             reported in service by: {}.",
            watch::ROLLOUT_STALLED_AFTER_MINUTES,
            names.join(", ")
        );
        let outcome = raise_to_head_office(
            pool,
            kinds::ROLLOUT_STALLED,
            &title,
            &body,
            Some(("publication", publication_id.to_string())),
            None,
        )
        .await;
        let stamp = if outcome.is_ok() { "RAN" } else { "FAILED" };
        for (origin_id, _) in &fresh {
            let _ = finish_run(
                pool,
                jobs::ROLLOUT_STALLED,
                &format!("{publication_id}:{origin_id}"),
                stamp,
                json!({ "publication_id": publication_id, "origin_id": origin_id }),
            )
            .await;
        }
        outcome?;
        raised += 1;
    }
    Ok(json!({ "raised": raised }))
}

/// Shops that have not taken what head office sent them for half an hour.
///
/// Read off the command stream rather than the usage messages alone: a shop
/// applies its commands in order, so the oldest one it has not applied is how
/// far behind it is on everything — promotion counts, campaign switches and
/// price books alike. One notice per shop per day.
async fn usage_stale(
    pool: &PgPool,
    now: DateTime<Utc>,
    today: NaiveDate,
) -> Result<Value, AppError> {
    let cutoff = now - Duration::minutes(watch::USAGE_STALE_AFTER_MINUTES);
    let rows = sqlx::query(
        "SELECT cur.origin_id, cur.acked_at, cur.blocked_reason, c.issued_at, cred.label
           FROM sync_command_cursor cur
           JOIN sync_origin_credential cred
                ON cred.origin_id = cur.origin_id AND cred.node_role = 'STORE'
           JOIN sync_command_delivery d
                ON d.origin_id = cur.origin_id AND d.seq = cur.acked_seq + 1
           JOIN sync_command c ON c.command_id = d.command_id
          WHERE cur.acked_seq < cur.next_seq
            AND c.issued_at < $1
          ORDER BY cur.origin_id",
    )
    .bind(cutoff)
    .fetch_all(pool)
    .await?;
    let mut raised = 0;
    for row in rows {
        let origin_id: String = row.get("origin_id");
        let shop = row
            .get::<Option<String>, _>("label")
            .unwrap_or_else(|| origin_id.clone());
        let issued_at: DateTime<Utc> = row.get("issued_at");
        let minutes = (now - issued_at).num_minutes();
        let blocked: Option<String> = row.get("blocked_reason");
        let body = match blocked.as_deref().map(str::trim).filter(|text| !text.is_empty()) {
            Some(reason) => format!(
                "It stopped on a message from head office {minutes} minutes ago: {reason}. \
                 Until that is cleared it is enforcing old promotion counts and holds no \
                 price or campaign change sent since."
            ),
            None => format!(
                "The oldest message it has not taken was sent {minutes} minutes ago. Until it \
                 syncs it is enforcing old promotion counts and holds no price or campaign \
                 change sent since."
            ),
        };
        if raise_once(
            pool,
            jobs::USAGE_STALE,
            &format!("{origin_id}:{today}"),
            kinds::USAGE_STALE,
            &format!("{shop} is behind on head office's messages"),
            &body,
            None,
            Some(&origin_id),
        )
        .await?
        {
            raised += 1;
        }
    }
    Ok(json!({ "raised": raised }))
}

/// Measure every running campaign that has an active guardrail, and tell head
/// office once about each breach the measuring found.
///
/// The measuring is `campaigns::check_campaign_guardrails`, unchanged — the
/// same call "Check now" makes, including the pause it dispatches when a rail
/// says to stop. A rail used to be exactly as fresh as the last time somebody
/// pressed that button.
async fn guardrails(pool: &PgPool) -> Result<Value, AppError> {
    // Only campaigns still running. A finished one keeps its rails and its
    // breaches, but re-measuring it every few minutes for ever would only move
    // `last_seen_at` on a breach nobody can do anything about any more.
    let campaigns: Vec<String> = sqlx::query_scalar(
        "SELECT DISTINCT g.campaign_id
           FROM campaign_guardrail g
           JOIN LATERAL (
                SELECT cc.status, cc.valid_to FROM commercial_campaign cc
                  JOIN commercial_publication p ON p.id = cc.publication_id
                 WHERE cc.campaign_id = g.campaign_id AND p.status = 'PUBLISHED'
                 ORDER BY p.version DESC LIMIT 1
           ) c ON true
          WHERE g.active
            AND c.status IN ('ACTIVE', 'SCHEDULED')
            AND (c.valid_to IS NULL OR c.valid_to > now())
          ORDER BY g.campaign_id",
    )
    .fetch_all(pool)
    .await?;
    let mut checked = 0;
    let mut skipped: Vec<Value> = Vec::new();
    for campaign_id in &campaigns {
        match super::campaigns::check_campaign_guardrails(pool, campaign_id, WATCH_ACTOR).await {
            Ok(_) => checked += 1,
            // A campaign no published book carries is not running, and a rail
            // on it has nothing to measure. Said in the detail, not raised.
            Err(error) => skipped.push(json!({ "campaign_id": campaign_id, "why": error.to_string() })),
        }
    }

    let breaches = sqlx::query(
        "SELECT b.breach_id, b.campaign_id, b.measure, b.threshold, b.observed,
                b.action_taken, c.name
           FROM campaign_guardrail_breach b
           LEFT JOIN LATERAL (
                SELECT cc.name FROM commercial_campaign cc
                  JOIN commercial_publication p ON p.id = cc.publication_id
                 WHERE cc.campaign_id = b.campaign_id AND p.status = 'PUBLISHED'
                 ORDER BY p.version DESC LIMIT 1
           ) c ON true
          WHERE b.acknowledged_at IS NULL
          ORDER BY b.first_seen_at",
    )
    .fetch_all(pool)
    .await?;
    let mut raised = 0;
    for row in breaches {
        let breach_id: uuid::Uuid = row.get("breach_id");
        let campaign_id: String = row.get("campaign_id");
        let name = row
            .get::<Option<String>, _>("name")
            .unwrap_or_else(|| campaign_id.clone());
        let measure: String = row.get("measure");
        let threshold: i64 = row.get("threshold");
        let observed: i64 = row.get("observed");
        let action: String = row.get("action_taken");
        let reading = guardrail_reading(&measure, threshold, observed);
        let outcome = match action.as_str() {
            "PAUSED" => " The campaign has been paused and every shop told.",
            "PAUSE_FAILED" => " The rail says to stop the campaign, and the pause could NOT be sent.",
            _ => "",
        };
        if raise_once(
            pool,
            jobs::GUARDRAIL,
            &breach_id.to_string(),
            kinds::GUARDRAIL_BREACHED,
            &format!("Campaign \u{201c}{name}\u{201d} crossed a guardrail"),
            &format!("{reading}.{outcome}"),
            Some(("campaign", campaign_id)),
            None,
        )
        .await?
        {
            raised += 1;
        }
    }
    Ok(json!({ "checked": checked, "skipped": skipped, "raised": raised }))
}

fn guardrail_reading(measure: &str, threshold: i64, observed: i64) -> String {
    let (what, unit_bps) = match measure {
        "SPEND_MINOR" => ("Given away", false),
        "SPEND_PER_DAY_MINOR" => ("Given away a day", false),
        "DISCOUNT_RATE_BPS" => ("Discount rate", true),
        "MARGIN_BPS" => ("Margin", true),
        "AVERAGE_BASKET_MINOR" => ("Average basket", false),
        other => (other, false),
    };
    let draw = |value: i64| {
        if unit_bps {
            format!("{}.{:02}%", value / 100, (value % 100).abs())
        } else {
            watch::describe(Measure::Budget, value)
        }
    };
    format!("{what} is {} against a line of {}", draw(observed), draw(threshold))
}

/// The promotions and campaigns that start or end tomorrow, one notice for
/// each direction, once a day.
///
/// A promotion's own dates are the ones in its rule (`conditions`), read from
/// the newest published book that carries it and only while it is ACTIVE. A
/// campaign's are its window. "Tomorrow" is the business day after `today`, in
/// the estate's own offset.
async fn calendar(pool: &PgPool, today: NaiveDate) -> Result<Value, AppError> {
    let tomorrow = today + Duration::days(1);
    let offset: i32 = crate::reporting::DEFAULT_UTC_OFFSET_MINUTES;
    let rows = sqlx::query(
        "WITH live AS (
             SELECT id, version FROM commercial_publication WHERE status = 'PUBLISHED'
         ), rule AS (
             SELECT DISTINCT ON (r.rule_id) r.rule_id AS key, r.name, r.status,
                    (r.definition->'conditions'->>'effective_from')::timestamptz AS starts,
                    (r.definition->'conditions'->>'effective_to')::timestamptz AS ends
               FROM commercial_rule r JOIN live p ON p.id = r.publication_id
              ORDER BY r.rule_id, p.version DESC
         ), campaign AS (
             SELECT DISTINCT ON (c.campaign_id) c.campaign_id AS key, c.name, c.status,
                    c.valid_from AS starts, c.valid_to AS ends
               FROM commercial_campaign c JOIN live p ON p.id = c.publication_id
              ORDER BY c.campaign_id, p.version DESC
         ), dated AS (
             SELECT 'RULE' AS kind, key, name, starts, ends FROM rule WHERE status = 'ACTIVE'
             UNION ALL
             SELECT 'CAMPAIGN', key, name, starts, ends FROM campaign
              WHERE status IN ('ACTIVE', 'SCHEDULED')
         )
         SELECT kind, key, name,
                ((starts AT TIME ZONE 'UTC') + make_interval(mins => $2))::date = $1 AS starting,
                ((ends AT TIME ZONE 'UTC') + make_interval(mins => $2))::date = $1 AS ending
           FROM dated
          WHERE ((starts AT TIME ZONE 'UTC') + make_interval(mins => $2))::date = $1
             OR ((ends AT TIME ZONE 'UTC') + make_interval(mins => $2))::date = $1
          ORDER BY kind DESC, name",
    )
    .bind(tomorrow)
    .bind(offset)
    .fetch_all(pool)
    .await?;

    let mut starting: Vec<String> = Vec::new();
    let mut ending: Vec<String> = Vec::new();
    for row in rows {
        let kind: String = row.get("kind");
        let key: String = row.get("key");
        let name: Option<String> = row.get("name");
        let label = subject_label(&kind, &key, name.as_deref());
        if row.get::<Option<bool>, _>("starting").unwrap_or(false) {
            starting.push(label.clone());
        }
        if row.get::<Option<bool>, _>("ending").unwrap_or(false) {
            ending.push(label);
        }
    }

    let mut raised = 0;
    for (list, kind, verb, key) in [
        (&starting, kinds::PROMOTION_STARTING, "start", "starting"),
        (&ending, kinds::PROMOTION_ENDING, "end", "ending"),
    ] {
        if list.is_empty() {
            continue;
        }
        let title = if list.len() == 1 {
            format!("{} {verb}s tomorrow", list[0])
        } else {
            format!("{} promotions and campaigns {verb} tomorrow", list.len())
        };
        if raise_once(
            pool,
            jobs::CALENDAR,
            &format!("{key}:{tomorrow}"),
            kind,
            &title,
            &format!("{tomorrow}: {}.", list.join(", ")),
            None,
            None,
        )
        .await?
        {
            raised += 1;
        }
    }
    Ok(json!({ "raised": raised, "starting": starting.len(), "ending": ending.len() }))
}

// ── shared ───────────────────────────────────────────────────────────────

/// Claim one key and raise one notice under it. `Ok(false)` means the key was
/// already worked. A raise that fails stamps the claim `FAILED`, so it is
/// retried on the next tick rather than recorded as told.
#[allow(clippy::too_many_arguments)]
async fn raise_once(
    pool: &PgPool,
    job: &str,
    run_key: &str,
    kind: &str,
    title: &str,
    body: &str,
    subject: Option<(&str, String)>,
    origin_id: Option<&str>,
) -> Result<bool, AppError> {
    if !claim_run(pool, job, run_key).await? {
        return Ok(false);
    }
    match raise_to_head_office(pool, kind, title, body, subject, origin_id).await {
        Ok(()) => {
            finish_run(pool, job, run_key, "RAN", json!({ "kind": kind })).await?;
            Ok(true)
        }
        Err(error) => {
            let _ = finish_run(
                pool,
                job,
                run_key,
                "FAILED",
                json!({ "kind": kind, "error": error.to_string() }),
            )
            .await;
            Err(error)
        }
    }
}

async fn raise_to_head_office(
    pool: &PgPool,
    kind: &str,
    title: &str,
    body: &str,
    subject: Option<(&str, String)>,
    origin_id: Option<&str>,
) -> Result<(), AppError> {
    let mut tx = pool.begin().await?;
    let recipients = infrastructure::recipients_with_role(&mut tx, &["ADMIN"]).await?;
    let _: Option<uuid::Uuid> = infrastructure::raise_notification(
        &mut tx,
        NewNotification {
            kind,
            title: title.to_owned(),
            body: body.to_owned(),
            subject,
            origin_id,
            payload: json!({ "source": WATCH_ACTOR }),
        },
        &recipients,
    )
    .await?;
    tx.commit().await?;
    Ok(())
}
