//! How far one price book has actually reached the shops.
//!
//! UI-001 §6 asks a Changes row to say "10/13 stores · 2 pending, 1 failed".
//! Until migration 0179 only the first number existed: a row in the activation
//! table meant a shop had the book in service and its absence meant nothing at
//! all, so "never told", "told and still working on it" and "tried and could
//! not" were one empty space. Pending was a subtraction — target less activated
//! — and failed was permanently nought, with `price_changes` saying so out loud
//! because there was nowhere for it to come from.
//!
//! This module owns the three-state table 0179 made of that evidence: the rule
//! that decides the state, the three writes that reach it, and the read that
//! answers §6.
//!
//! # Why the state is decided in Rust and written by dumb SQL
//!
//! [`settle_rollout`] is the whole rule and it is a pure function of two values. It
//! could have been an `ON CONFLICT DO UPDATE ... CASE` instead, and then the
//! rule would live in three SQL statements that have to agree with each other
//! and with whatever the next reader believes — two implementations of one
//! truth, which is the disease this repository has had three times. So the
//! statements here lock the row, ask [`settle_rollout`], and write what it says. The
//! cost is one extra round trip inside a transaction that is already doing
//! several, and it buys a rule that can be tested with no database at all.
//!
//! The one exception is [`record_told`], where the SQL *is* the rule because
//! the rule is "change nothing": `ON CONFLICT DO NOTHING` is exactly
//! `settle_rollout(Some(anything), RolloutReport::Told)`, and a test says so.

use crate::cloud::application::AppError;
use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::{PgPool, Postgres, Row, Transaction};
use uuid::Uuid;

/// Where one shop stands on one price book.
///
/// Three states and not two, because "has not got it yet" and "could not take
/// it" send somebody to different places. A shop that is behind by a book
/// published four minutes ago needs nothing; a shop that tried eleven times and
/// failed needs a phone call.
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RolloutState {
    /// The centre handed this shop the book and the shop has not reported back.
    /// Outstanding work, and the time it has been outstanding is `told_at`.
    Pending,
    /// The shop reported putting it into service, on its own clock. Nobody at
    /// the centre ticks this.
    Active,
    /// The shop reported that it could not apply it, and said why.
    Failed,
}

impl RolloutState {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "PENDING",
            Self::Active => "ACTIVE",
            Self::Failed => "FAILED",
        }
    }

    /// Read one back off a row.
    ///
    /// `None` for anything else rather than a silent default: the column is
    /// constrained to these three, so a fourth value means the schema and this
    /// enum have parted company and guessing would hide it.
    fn from_column(text: &str) -> Option<Self> {
        match text {
            "PENDING" => Some(Self::Pending),
            "ACTIVE" => Some(Self::Active),
            "FAILED" => Some(Self::Failed),
            _ => None,
        }
    }
}

/// What just arrived about one shop and one book.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RolloutReport {
    /// The centre handed the book over. Not evidence about the shop at all —
    /// evidence about the centre, which is why it can never overwrite anything
    /// the shop itself has said.
    Told,
    /// The shop put the book into service.
    Activated,
    /// The shop could not apply the book.
    Failed,
}

/// What a report does to the state a shop is already in.
///
/// Three decisions are load-bearing and none of them is obvious:
///
/// **A redelivered activation changes nothing.** The lane already deduplicates
/// by event id, but a fact can be re-sequenced after a generation bump and the
/// apply path is retried inside a transaction that may roll back. So `Activated`
/// on a row that is already `Active` must be a no-op rather than a second
/// attempt — otherwise a stalled sender inflates `attempt_count` into a
/// retry storm that never happened, and `activated_at` walks forward off the
/// shop's real clock.
///
/// **A failure after an activation does not reopen anything.** The shop is
/// demonstrably charging these prices: it said so. A later `Failed` for the same
/// book is the delivery lane complaining, not the till — the edge's own apply is
/// idempotent and returns early on a book it already holds — and walking the
/// state back would take a correct price off the screen and send somebody to a
/// shop that is fine. The attempt and the error text are still recorded; only
/// the verdict is not.
///
/// **An activation after a failure wins.** That is a shop that retried and got
/// there, which is the ordinary and hoped-for ending. The error stays in
/// `last_error` as the evidence of what happened, because a rollout that took
/// three days and two failures is not the same operational story as one that
/// worked first time, and the state alone cannot tell them apart.
pub fn settle_rollout(current: Option<RolloutState>, report: RolloutReport) -> RolloutState {
    match report {
        // Being told again is not news. `told_at` is when the clock STARTED,
        // and restamping it would reset the age of the oldest outstanding
        // rollout in the fleet to zero every time anything was republished.
        RolloutReport::Told => current.unwrap_or(RolloutState::Pending),
        RolloutReport::Activated => RolloutState::Active,
        RolloutReport::Failed => match current {
            Some(RolloutState::Active) => RolloutState::Active,
            _ => RolloutState::Failed,
        },
    }
}

/// Write down that this shop has been handed this book.
///
/// Called from the transaction that publishes it, so "which shops are
/// outstanding" is a record with a time on it rather than a subtraction. The
/// subtraction could count; it could never say WHEN a shop was told, and the
/// gap between told and applied is the number worth watching.
///
/// `DO NOTHING` on conflict, which is [`settle_rollout`]'s `Told` arm written in SQL:
/// nothing the centre does may overwrite what the shop itself has reported.
pub(super) async fn record_told(
    tx: &mut Transaction<'_, Postgres>,
    publication_id: Uuid,
    version: i64,
    origin_id: &str,
    site_id: &str,
    told_at: DateTime<Utc>,
) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO commercial_publication_rollout
             (publication_id, origin_id, site_id, version, state, told_at, attempt_count)
         VALUES ($1,$2,$3,$4,'PENDING',$5,0)
         ON CONFLICT (publication_id, origin_id) DO NOTHING",
    )
    .bind(publication_id)
    .bind(origin_id)
    .bind(site_id)
    .bind(version)
    .bind(told_at)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

/// The state this shop is in for this book, locked for the rest of the
/// transaction.
///
/// `FOR UPDATE` rather than a plain read: two facts from the same shop apply in
/// sequence on one connection today, but a read-then-write that is not locked is
/// a lost update waiting for the day they do not.
async fn current_state(
    tx: &mut Transaction<'_, Postgres>,
    publication_id: Uuid,
    origin_id: &str,
) -> Result<Option<RolloutState>, AppError> {
    let held: Option<String> = sqlx::query_scalar(
        "SELECT state FROM commercial_publication_rollout
          WHERE publication_id = $1 AND origin_id = $2 FOR UPDATE",
    )
    .bind(publication_id)
    .bind(origin_id)
    .fetch_optional(&mut **tx)
    .await?;
    match held {
        None => Ok(None),
        Some(text) => RolloutState::from_column(&text).map(Some).ok_or_else(|| {
            AppError::Conflict(format!(
                "shop {origin_id} holds rollout state {text}, which this build does not know"
            ))
        }),
    }
}

/// Record that this shop has put the book into service.
///
/// Settles whatever state the row was in, including the PENDING row the publish
/// wrote. A row already ACTIVE is left entirely alone — see [`settle_rollout`].
pub(super) async fn record_activated(
    tx: &mut Transaction<'_, Postgres>,
    publication_id: Uuid,
    origin_id: &str,
    site_id: Option<&str>,
    version: i64,
    activated_at: DateTime<Utc>,
    price_rule_count: i64,
    reported_at: DateTime<Utc>,
) -> Result<(), AppError> {
    let current = current_state(tx, publication_id, origin_id).await?;
    if current == Some(RolloutState::Active) {
        return Ok(());
    }
    // An upsert rather than a read-then-insert, because `FOR UPDATE` on a row
    // that does not exist yet locks nothing: a publish writing this shop's
    // PENDING row at the same moment as the shop's own report would otherwise
    // collide on the primary key, and a duplicate-key error here blocks the
    // shop's whole fact stream over a race that has a correct answer.
    //
    // `last_error` is deliberately not cleared. A book that went in on the third
    // try is not the same operational story as one that went in first time, and
    // the state alone cannot tell them apart.
    sqlx::query(
        "INSERT INTO commercial_publication_rollout
             (publication_id, origin_id, site_id, version, state,
              activated_at, reported_at, price_rule_count,
              first_attempt_at, last_attempt_at, attempt_count)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$6,$6,1)
         ON CONFLICT (publication_id, origin_id) DO UPDATE
            SET state = EXCLUDED.state,
                site_id = COALESCE(EXCLUDED.site_id, commercial_publication_rollout.site_id),
                version = EXCLUDED.version,
                activated_at = EXCLUDED.activated_at,
                reported_at = EXCLUDED.reported_at,
                price_rule_count = EXCLUDED.price_rule_count,
                first_attempt_at =
                    COALESCE(commercial_publication_rollout.first_attempt_at,
                             EXCLUDED.first_attempt_at),
                last_attempt_at = EXCLUDED.last_attempt_at,
                attempt_count = commercial_publication_rollout.attempt_count + 1
          -- The early return above catches a redelivery this transaction can
          -- see. This catches the one it cannot: a row settled ACTIVE by another
          -- connection between the read and this statement. Without it a
          -- redelivered fact would count a second attempt that never happened.
          WHERE commercial_publication_rollout.state <> 'ACTIVE'",
    )
    .bind(publication_id)
    .bind(origin_id)
    .bind(site_id)
    .bind(version)
    .bind(settle_rollout(current, RolloutReport::Activated).as_str())
    .bind(activated_at)
    .bind(reported_at)
    .bind(price_rule_count)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

/// Record that this shop could not apply the book, in the shop's own words.
///
/// The half of the rollout picture that did not exist: nothing anywhere let a
/// till say "I failed", so `RolloutProgress::failed` was nought by construction
/// and the screen's third number was a promise.
pub(super) async fn record_failed(
    tx: &mut Transaction<'_, Postgres>,
    publication_id: Uuid,
    origin_id: &str,
    site_id: Option<&str>,
    version: i64,
    attempted_at: DateTime<Utc>,
    error: &str,
    reported_at: DateTime<Utc>,
) -> Result<(), AppError> {
    let current = current_state(tx, publication_id, origin_id).await?;
    // Bounded here rather than trusted: this is text a till composed, it is
    // shown on an operations screen, and 0164's `last_error` took the same
    // precaution for the same reason.
    let error: String = error.trim().chars().take(500).collect();
    // The shop's own account of what went wrong is the only description anybody
    // has, so an empty one still has to say something — a FAILED row with
    // nothing in it is the empty space this whole migration exists to close, and
    // the CHECK on the table refuses it.
    let error = if error.is_empty() {
        "the shop reported a failure and gave no reason".to_owned()
    } else {
        error
    };
    let state = settle_rollout(current, RolloutReport::Failed);
    if state == RolloutState::Active {
        // The shop is charging these prices — it said so itself. Record that
        // something went wrong and leave the verdict alone.
        sqlx::query(
            "UPDATE commercial_publication_rollout
                SET last_attempt_at = $3,
                    attempt_count = attempt_count + 1,
                    last_error = $4
              WHERE publication_id = $1 AND origin_id = $2",
        )
        .bind(publication_id)
        .bind(origin_id)
        .bind(attempted_at)
        .bind(&error)
        .execute(&mut **tx)
        .await?;
        return Ok(());
    }
    sqlx::query(
        "INSERT INTO commercial_publication_rollout
             (publication_id, origin_id, site_id, version, state, reported_at,
              first_attempt_at, last_attempt_at, attempt_count, last_error)
         VALUES ($1,$2,$3,$4,$8,$5,$6,$6,1,$7)
         ON CONFLICT (publication_id, origin_id) DO UPDATE
            SET state = EXCLUDED.state,
                site_id = COALESCE(EXCLUDED.site_id, commercial_publication_rollout.site_id),
                reported_at = EXCLUDED.reported_at,
                first_attempt_at =
                    COALESCE(commercial_publication_rollout.first_attempt_at,
                             EXCLUDED.first_attempt_at),
                last_attempt_at = EXCLUDED.last_attempt_at,
                attempt_count = commercial_publication_rollout.attempt_count + 1,
                last_error = EXCLUDED.last_error
          -- The state was read a statement ago, and between the two another
          -- connection could have settled this shop as ACTIVE. Without this the
          -- upsert would walk it back to FAILED and take a correct price off the
          -- screen — the one outcome `settle_rollout` exists to forbid.
          WHERE commercial_publication_rollout.state <> 'ACTIVE'",
    )
    .bind(publication_id)
    .bind(origin_id)
    .bind(site_id)
    .bind(version)
    .bind(reported_at)
    .bind(attempted_at)
    .bind(&error)
    .bind(state.as_str())
    .execute(&mut **tx)
    .await?;
    Ok(())
}

/// One shop's standing on one price book.
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
#[derive(Clone, Debug, Serialize)]
pub struct ShopRollout {
    pub origin_id: String,
    pub site_id: Option<String>,
    /// What a person calls this shop. The origin id is a node name and nobody
    /// on an operations desk thinks in them.
    pub label: Option<String>,
    pub state: RolloutState,
    pub version: i64,
    /// The centre's clock: when this shop was handed the book.
    ///
    /// `None` for a rollout that predates 0179 and whose command is no longer on
    /// file. That reads as "the centre never wrote down when it told this shop",
    /// which is true — the alternative was a plausible timestamp nobody could
    /// check.
    pub told_at: Option<DateTime<Utc>>,
    /// The shop's clock, both ends. Equal when it went in first time.
    pub first_attempt_at: Option<DateTime<Utc>>,
    pub last_attempt_at: Option<DateTime<Utc>>,
    /// How many times the shop has reported trying. A shop on its eleventh
    /// attempt and one that has never tried are both outstanding and are not
    /// the same problem.
    pub attempt_count: i32,
    /// Since when this shop has been charging these prices — its own clock.
    pub activated_at: Option<DateTime<Utc>>,
    /// When the centre found out. The gap against `activated_at` is the number
    /// worth watching.
    pub reported_at: Option<DateTime<Utc>>,
    /// How much of the book the shop holds, so a truncated delivery shows as a
    /// number rather than as a wrong price weeks later.
    pub price_rule_count: Option<i64>,
    /// The shop's own account of what went wrong, kept even after a later
    /// attempt succeeded.
    pub last_error: Option<String>,
}

/// How far one book has reached, shop by shop and in total.
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
#[derive(Clone, Debug, Serialize)]
pub struct PublicationRollout {
    pub publication_id: Uuid,
    /// Shops that reported putting it into service.
    pub activated: i64,
    /// Shops that were handed it and have not reported.
    pub pending: i64,
    /// Shops that reported they could not apply it.
    pub failed: i64,
    /// Shops the centre has a record of handing it to. Not the fleet: a book
    /// scoped to six shops that reached all six is finished, and measuring it
    /// against thirteen would report it as six-thirteenths done for ever.
    pub target: i64,
    pub shops: Vec<ShopRollout>,
}

/// Who is running one price book, who is outstanding, and who could not.
///
/// # Where `target` comes from
///
/// Two sources, unioned, and the second is the reason books published before
/// 0179 are not reported as having reached nobody:
///
/// * the rollout rows themselves — every shop the publish told, since 0179;
/// * `sync_command_delivery`, which has recorded what was handed to which shop
///   since long before any of this. It carries no status, which is why it could
///   never answer the question on its own, but it is an honest record of who was
///   told.
///
/// A shop in the delivery ledger with no rollout row is PENDING, and that is a
/// reading of real evidence rather than a subtraction: the centre handed it over
/// and the shop has not reported. A shop in neither is not on this list at all,
/// because nothing says the book was ever meant for it.
pub async fn rollout_for(
    pool: &PgPool,
    publication_id: Uuid,
) -> Result<PublicationRollout, AppError> {
    let rows = sqlx::query(
        // The payload is compared as text rather than cast to uuid. Postgres is
        // free to evaluate the comparison before the command-type filter, and a
        // cast would then fail on some other command's payload — a whole screen
        // lost to a row that was never relevant.
        "WITH handed_over AS (
             SELECT d.origin_id, min(c.issued_at) AS issued_at
               FROM sync_command_delivery d
               JOIN sync_command c ON c.command_id = d.command_id
              WHERE c.command_type = $2
                AND c.payload ->> 'publication_id' = $1::text
              GROUP BY d.origin_id
         ),
         shops AS (
             SELECT origin_id FROM handed_over
             UNION
             SELECT origin_id FROM commercial_publication_rollout
              WHERE publication_id = $1
         )
         SELECT s.origin_id,
                COALESCE(r.site_id, cred.site_id) AS site_id,
                cred.label,
                COALESCE(r.state, 'PENDING') AS state,
                COALESCE(r.version,
                         (SELECT version FROM commercial_publication WHERE id = $1),
                         0) AS version,
                -- The rollout row's own stamp first, and the command's issue
                -- time behind it. A book dispatched before 0179 has no rollout
                -- row at all, and the command that carried it is a real record
                -- of when that shop was told — reading it is not the same as
                -- inventing one, and refusing to read it would report every
                -- older book as having reached nobody at no particular time.
                COALESCE(r.told_at, h.issued_at) AS told_at,
                r.first_attempt_at, r.last_attempt_at,
                COALESCE(r.attempt_count, 0) AS attempt_count,
                r.activated_at, r.reported_at, r.price_rule_count, r.last_error
           FROM shops s
           LEFT JOIN commercial_publication_rollout r
                  ON r.publication_id = $1 AND r.origin_id = s.origin_id
           LEFT JOIN handed_over h ON h.origin_id = s.origin_id
           LEFT JOIN sync_origin_credential cred ON cred.origin_id = s.origin_id
          ORDER BY s.origin_id",
    )
    .bind(publication_id)
    .bind(crate::cloud::domain::COMMAND_ACTIVATE_PUBLICATION)
    .fetch_all(pool)
    .await?;

    let mut shops = Vec::with_capacity(rows.len());
    let (mut activated, mut pending, mut failed) = (0i64, 0i64, 0i64);
    for row in rows {
        let held: String = row.get("state");
        let state = RolloutState::from_column(&held).ok_or_else(|| {
            AppError::Conflict(format!(
                "rollout state {held} is not one this build knows about"
            ))
        })?;
        match state {
            RolloutState::Active => activated += 1,
            RolloutState::Pending => pending += 1,
            RolloutState::Failed => failed += 1,
        }
        shops.push(ShopRollout {
            origin_id: row.get("origin_id"),
            site_id: row.get("site_id"),
            label: row.get("label"),
            state,
            version: row.get("version"),
            told_at: row.get("told_at"),
            first_attempt_at: row.get("first_attempt_at"),
            last_attempt_at: row.get("last_attempt_at"),
            attempt_count: row.get("attempt_count"),
            activated_at: row.get("activated_at"),
            reported_at: row.get("reported_at"),
            price_rule_count: row.get("price_rule_count"),
            last_error: row.get("last_error"),
        });
    }
    Ok(PublicationRollout {
        publication_id,
        activated,
        pending,
        failed,
        target: shops.len() as i64,
        shops,
    })
}

#[cfg(test)]
mod tests {
    use super::{settle_rollout, RolloutReport, RolloutState};

    #[test]
    fn a_shop_nobody_has_heard_from_is_pending_once_it_has_been_told() {
        assert_eq!(
            settle_rollout(None, RolloutReport::Told),
            RolloutState::Pending
        );
    }

    #[test]
    fn being_told_again_does_not_disturb_what_the_shop_has_already_said() {
        // The centre republishing, or a dispatch retried, must never overwrite
        // the shop's own report. `record_told` writes this rule as ON CONFLICT
        // DO NOTHING; this is the same sentence in Rust.
        for held in [
            RolloutState::Pending,
            RolloutState::Active,
            RolloutState::Failed,
        ] {
            assert_eq!(settle_rollout(Some(held), RolloutReport::Told), held);
        }
    }

    #[test]
    fn a_shop_that_reports_putting_the_book_into_service_is_active() {
        assert_eq!(
            settle_rollout(None, RolloutReport::Activated),
            RolloutState::Active
        );
        assert_eq!(
            settle_rollout(Some(RolloutState::Pending), RolloutReport::Activated),
            RolloutState::Active
        );
    }

    #[test]
    fn a_redelivered_activation_leaves_an_active_shop_exactly_as_it_was() {
        // The state is the easy half. `record_activated` returns before writing
        // anything at all in this case, so `activated_at` cannot walk forward
        // off the shop's real clock and `attempt_count` cannot invent a retry
        // storm out of a stalled sender.
        assert_eq!(
            settle_rollout(Some(RolloutState::Active), RolloutReport::Activated),
            RolloutState::Active
        );
    }

    #[test]
    fn an_activation_after_a_failure_wins_because_the_shop_retried_and_got_there() {
        assert_eq!(
            settle_rollout(Some(RolloutState::Failed), RolloutReport::Activated),
            RolloutState::Active
        );
    }

    #[test]
    fn a_shop_that_could_not_apply_the_book_is_failed_whether_or_not_it_was_told() {
        assert_eq!(
            settle_rollout(None, RolloutReport::Failed),
            RolloutState::Failed
        );
        assert_eq!(
            settle_rollout(Some(RolloutState::Pending), RolloutReport::Failed),
            RolloutState::Failed
        );
    }

    #[test]
    fn a_failure_after_an_activation_does_not_reopen_a_shop_that_is_already_selling() {
        // The shop said it put the book into service. A later failure for the
        // same book is the delivery lane complaining — the edge returns early on
        // a book it already holds — and walking the state back would take a
        // correct price off the screen and send somebody to a shop that is fine.
        assert_eq!(
            settle_rollout(Some(RolloutState::Active), RolloutReport::Failed),
            RolloutState::Active
        );
    }

    #[test]
    fn a_second_failure_is_still_a_failure_and_not_something_new() {
        assert_eq!(
            settle_rollout(Some(RolloutState::Failed), RolloutReport::Failed),
            RolloutState::Failed
        );
    }

    #[test]
    fn every_state_survives_a_round_trip_through_the_column_it_is_stored_in() {
        // The CHECK constraint in 0179 names these three strings. A rename on
        // one side and not the other would be invisible until a row failed to
        // read back, which is a screen going blank rather than a test failing.
        for state in [
            RolloutState::Pending,
            RolloutState::Active,
            RolloutState::Failed,
        ] {
            assert_eq!(RolloutState::from_column(state.as_str()), Some(state));
        }
        assert_eq!(RolloutState::from_column("APPLIED"), None);
    }
}
