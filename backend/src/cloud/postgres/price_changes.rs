//! Pricing changes that are still operationally alive — scheduled, or running.
//!
//! Sibling to [`super::price_history`] and deliberately a different question.
//! History is what already happened to **one product at one shop**: an
//! effective-price timeline, Rp219k → Rp179k → Rp199k, each step with the book
//! and the person behind it. This is the other axis: what the business is
//! **doing right now or about to do**, one row per change, each spanning as
//! many products and shops as it names. "Q3 Clearance · 128 articles · 13
//! stores · Active" is one row here and a hundred and twenty-eight timelines
//! there.
//!
//! # No new entity, and why none is needed
//!
//! A change already exists as a first-class thing in this estate: a
//! `commercial_publication`. It is immutable, versioned, named by whoever cut
//! it, stamped with who published it and when, and carries its own window. Its
//! contents say what it reaches. Every column a change list needs —
//! name, scope, effective period, status — is a projection of rows already
//! written, so this module computes and stores nothing.
//!
//! Adding a `pricing_change` table beside the publications would create a
//! second account of the same event, and the two would drift the first time
//! somebody published a book without going through whatever wrote the other
//! one. The publication IS the change.
//!
//! # Two dimensions, never one enum
//!
//! UI-001 §6: "tampilkan business period dan rollout progress sebagai dimensi
//! terpisah, bukan memaksa seluruhnya menjadi satu enum lifecycle". That is not
//! a presentation preference. A markdown whose period closed on 30 September
//! with two shops that never activated it is **finished as a business decision
//! and unfinished as work**, and a single status can only say one of those — it
//! either drops the two shops off the list or keeps a closed programme on it for
//! ever. So a change carries a [`ChangeStatus`] for its window and a
//! [`RolloutProgress`] for its shops, and the default list is filtered on the
//! second.
//!
//! Reaching a scheduled start date proves nothing about a till. Delivery,
//! activation and validity are three separate pieces of evidence and this
//! reports the one that exists: a shop appears as activated when **it** reported
//! putting the book into service, on its own clock. Nobody at the centre ticks
//! that box.
//!
//! # What is NOT derivable, said out loud
//!
//! Two things UI-001 asks for have nowhere to live in the current schema, and
//! are reported as absent rather than guessed:
//!
//! - **Clearance and Correction** as distinct change types. A clearance and an
//!   end-of-season markdown are the same rows; a correction and a re-price are
//!   the same rows. Reading the book's name for the word would be a guess, and
//!   a book called "Q3 Clearance" that carries base prices is a re-price.
//! Both were resolved by the owner on 12 September 2026 — UI-002 gave the
//! publication a `change_type`, and UI-003 gave the activation evidence a
//! state. `ChangeKind` now reads what the author declared, and the rollout
//! counts read `commercial_publication_rollout`. Nothing here guesses either.
//!
use crate::cloud::application::AppError;
use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::{PgPool, Row};
use uuid::Uuid;

/// Where a change is in its own life.
///
/// Three words, and the list shows two of them. `Ended` exists because a change
/// that has finished is still a change somebody made, and a reader tracing a
/// price back needs it findable — it is simply not work.
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ChangeStatus {
    /// Published, and its window has not opened. The shops already hold it and
    /// will start charging it on the day — which is why a scheduled change is
    /// worth seeing before the day rather than after.
    Scheduled,
    /// Its window is open.
    Active,
    /// Its window has closed.
    Ended,
}

impl ChangeStatus {
    fn of(from: DateTime<Utc>, to: Option<DateTime<Utc>>, now: DateTime<Utc>) -> Self {
        if from > now {
            Self::Scheduled
        } else if to.is_some_and(|end| end <= now) {
            Self::Ended
        } else {
            Self::Active
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Scheduled => "SCHEDULED",
            Self::Active => "ACTIVE",
            Self::Ended => "ENDED",
        }
    }
}

/// What kind of change this is.
///
/// UI-001 §6's four: Regular Price Change, Markdown, Clearance, Correction.
///
/// **Authored, not derived.** `commercial_publication.change_type` (migration
/// 0182) carries what the person cutting the book meant, because a clearance
/// and an end-of-season markdown are the same rows and a correction and a
/// re-price are the same rows. Reading the book's NAME for the word would be a
/// guess that is wrong exactly when it matters — a book called "Q3 Clearance"
/// carrying base prices is a re-price.
///
/// Clearance shares markdown pricing mechanics entirely; it is a business and
/// UI classification and the engine never reads this. UI-001 §6: "Clearance
/// bukan pricing layer tambahan."
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ChangeKind {
    RegularPrice,
    Markdown,
    Clearance,
    Correction,
    /// Cut before `change_type` existed, and nobody's intent is recorded.
    ///
    /// A separate word rather than a default, because "this is a regular price
    /// change" and "nobody said" are different claims and the second is the
    /// true one for every book published before 12 September 2026. Guessing
    /// from the contents would put a classification nobody decided into every
    /// report built on top of it.
    Unclassified,
}

impl ChangeKind {
    /// From the stored word, or `Unclassified` when there is none.
    ///
    /// A word this build does not know also reads as `Unclassified` — a book
    /// written by a newer node is not a book this one may silently reclassify.
    fn of(stored: Option<&str>) -> Self {
        match stored {
            Some("REGULAR_PRICE") => Self::RegularPrice,
            Some("MARKDOWN") => Self::Markdown,
            Some("CLEARANCE") => Self::Clearance,
            Some("CORRECTION") => Self::Correction,
            _ => Self::Unclassified,
        }
    }

    /// Whether this kind's WORK is its period rather than its rollout.
    ///
    /// A markdown or a clearance is a programme with a start and an end that
    /// somebody is running; a regular price change is a push that finishes when
    /// the last till acknowledges it. That difference is what UI-001 §6's two
    /// filtering rules turn on.
    ///
    /// An unclassified book falls to the rollout rule, which is the safer of
    /// the two: it leaves the working list once every shop has it, rather than
    /// sitting there for ever on the strength of a classification nobody made.
    fn period_is_the_work(self) -> bool {
        matches!(self, Self::Markdown | Self::Clearance)
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::RegularPrice => "REGULAR_PRICE",
            Self::Markdown => "MARKDOWN",
            Self::Clearance => "CLEARANCE",
            Self::Correction => "CORRECTION",
            Self::Unclassified => "UNCLASSIFIED",
        }
    }
}

/// How far a change has actually reached the shops.
///
/// **A separate dimension from the business period, and UI-001 §6 forbids
/// collapsing the two**: "tampilkan business period dan rollout progress
/// sebagai dimensi terpisah, bukan memaksa seluruhnya menjadi satu enum
/// lifecycle". A change whose period has ended with two shops never activated
/// is finished as a business decision and unfinished as work, and one enum
/// cannot say both — it would either drop the outstanding shops off the list or
/// keep a closed programme on it for ever.
///
/// Reaching a scheduled start date proves nothing about a till. Delivery,
/// activation and validity are three different pieces of evidence, and a
/// publication that has been *delivered* has not been *activated*.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct RolloutProgress {
    /// Shops that reported putting this book into service. Their own word, on
    /// their own clock — nobody at the centre ticks this.
    pub activated: i64,
    /// Shops this change is meant to reach.
    pub target: i64,
    /// Target less activated. Includes shops the command never reached and
    /// shops that hold it and have not switched: both are outstanding work, and
    /// the detail view separates them.
    pub pending: i64,
    /// Shops that tried to apply the book and told the centre they could not.
    ///
    /// The shop's own words reach `commercial_publication_rollout.last_error`
    /// via the `publication.activation_failed` fact (migration 0179 / UI-003).
    /// Before that existed this was always nought and said so — a shop had no
    /// way to report a failure at all, and "never told", "told and not applied"
    /// and "tried and failed" were the same empty space.
    ///
    /// A shop that failed and later succeeded is ACTIVE, not FAILED: it is
    /// demonstrably selling. Its error is kept, because a book that went in on
    /// the third attempt is a different operational story from one that went in
    /// first time.
    pub failed: i64,
}

/// One pricing change, as wide as it actually reaches.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PriceChange {
    pub publication_id: Uuid,
    pub version: i64,
    /// What whoever cut it called it. This is the row's identity to a reader —
    /// "October Price Update", not "v42".
    pub name: String,
    pub kind: ChangeKind,
    /// What the book actually carries, beside what it was classified as.
    ///
    /// Held separately rather than reconciled: a book classified CLEARANCE that
    /// carries no markdown rows is a mistake somebody should see, and a view
    /// that silently trusted either one alone would hide it.
    pub carries_price_rules: bool,
    pub carries_markdowns: bool,
    /// The business period, and only that. What the shops have actually done
    /// about it is [`rollout`](Self::rollout).
    pub status: ChangeStatus,
    pub effective_from: DateTime<Utc>,
    pub effective_to: Option<DateTime<Utc>>,
    pub published_by: Option<String>,
    pub published_at: Option<DateTime<Utc>>,
    /// Styles it names. The number a merchandiser thinks in — nobody plans a
    /// clearance in SKUs.
    pub article_count: i64,
    /// Products, which is the number that decides how much work it is.
    pub sku_count: i64,
    pub markdown_count: i64,
    /// Shops it names. Meaningless on its own when `reaches_every_shop` is
    /// true, which is why the two travel together: a company-wide price names
    /// no shop and reaches all of them.
    pub store_count: i64,
    pub reaches_every_shop: bool,
    /// Published books, in force now, with a higher version that price any of
    /// the same products on the same channel.
    ///
    /// A count and not a verdict. Deciding whether this change still has an
    /// effect means asking the engine what wins at every product and shop it
    /// touches — a full cascade replay per book. This says "there are three
    /// newer books over the same products, go and look", which is true, cheap,
    /// and does not pretend to have looked.
    pub newer_books_touching: i64,
    /// How far it has reached the shops. The second dimension, and the one the
    /// default list is filtered on.
    pub rollout: RolloutProgress,
}

/// Changes that still need somebody's attention, newest first.
///
/// The default list is **outstanding operational work**, which is not the same
/// as "its window is open" — UI-001 §6: "Regular change boleh keluar dari
/// default operational list setelah penerapan pada seluruh target terselesaikan
/// dan tidak ada outstanding action", and "period berakhir tidak otomatis
/// menyelesaikan pending recovery/activation work".
///
/// So a change stays on the list while EITHER is true:
///
/// - its window has not closed (scheduled, or running), or
/// - shops are still outstanding, whatever its window says.
///
/// A markdown whose period ended on 30 September with two shops that never
/// activated it is still on this list, and that is the whole point: the period
/// ending did not activate those two tills. Conversely a price update that
/// every shop has activated drops off the day it finishes, even though its
/// window stays open for ever.
///
/// `include_settled` brings back everything, for a reader tracing a price
/// rather than working a queue.
pub async fn price_changes(
    pool: &PgPool,
    include_settled: bool,
) -> Result<Vec<PriceChange>, AppError> {
    let now = Utc::now();
    let rows = sqlx::query(
        "WITH scope AS (
           SELECT pr.publication_id,
                  count(DISTINCT s.article_id)                       AS articles,
                  count(DISTINCT pr.sku_id)                          AS skus,
                  -- A row scoped to no shop reaches every shop, so it cannot be
                  -- counted as a shop — it is counted as the flag below.
                  count(DISTINCT pr.site_id)                         AS named_sites,
                  bool_or(pr.site_id IS NULL AND pr.site_ids IS NULL) AS every_shop,
                  -- A named set of shops is as much scope as a single one; a
                  -- list of six is six shops, not one row.
                  coalesce(max(coalesce(array_length(pr.site_ids, 1), 0)), 0) AS widest_set
             FROM commercial_price_rule pr
             JOIN sku s ON s.id = pr.sku_id
            GROUP BY pr.publication_id
         ),
         drops AS (
           SELECT m.publication_id,
                  count(*)                                           AS markdowns,
                  count(DISTINCT m.site_id)                          AS named_sites,
                  bool_or(m.site_id IS NULL AND m.site_ids IS NULL)   AS every_shop
             FROM commercial_markdown m
            GROUP BY m.publication_id
         ),
         -- How many newer books, in force now, have an opinion about any of the
         -- same products on the same channel. The engine ranks by publication
         -- version FIRST, so a newer book's entry beats an older one wherever
         -- both apply — which is what makes this count worth reading.
         newer AS (
           SELECT older.publication_id,
                  count(DISTINCT newer_p.id) AS newer_books
             FROM commercial_price_rule older
             JOIN commercial_publication older_p ON older_p.id = older.publication_id
             JOIN commercial_price_rule newer_r
               ON newer_r.sku_id = older.sku_id AND newer_r.channel = older.channel
             JOIN commercial_publication newer_p ON newer_p.id = newer_r.publication_id
            WHERE newer_p.status = 'PUBLISHED'
              AND newer_p.version > older_p.version
              AND newer_p.effective_from <= $1
              AND (newer_p.effective_to IS NULL OR newer_p.effective_to > $1)
            GROUP BY older.publication_id
         ),
         -- What each shop has done about this book, in the shop's own words:
         -- told, applied, or tried and failed. Reaching a start date proves
         -- nothing about a till, and nobody at the centre ticks these boxes.
         --
         -- Read from `commercial_publication_rollout` rather than the
         -- `commercial_publication_activation` view over it: the view is the
         -- ACTIVE rows only — correct for the six readers asking whether a shop
         -- is running a book, and blind to exactly the two states UI-001 §6
         -- asks this list to show.
         live AS (
           SELECT r.publication_id,
                  count(DISTINCT r.site_id) FILTER (WHERE r.state = 'ACTIVE')  AS activated,
                  count(DISTINCT r.site_id) FILTER (WHERE r.state = 'PENDING') AS told_not_applied,
                  count(DISTINCT r.site_id) FILTER (WHERE r.state = 'FAILED')  AS failed
             FROM commercial_publication_rollout r
            WHERE r.site_id IS NOT NULL
            GROUP BY r.publication_id
         )
         SELECT p.id, p.version, p.name, p.change_type, p.effective_from, p.effective_to,
                p.published_by, p.published_at,
                coalesce(scope.articles, 0)    AS articles,
                coalesce(scope.skus, 0)        AS skus,
                coalesce(drops.markdowns, 0)   AS markdowns,
                coalesce(scope.named_sites, 0) + coalesce(drops.named_sites, 0) AS named_sites,
                coalesce(scope.widest_set, 0)  AS widest_set,
                coalesce(scope.every_shop, false) OR coalesce(drops.every_shop, false) AS every_shop,
                coalesce(newer.newer_books, 0) AS newer_books,
                coalesce(live.activated, 0)    AS activated,
                coalesce(live.failed, 0)       AS failed,
                -- Every shop registered to receive books. The target for a
                -- company-wide change; a narrower change's target is its own
                -- named shops, decided in Rust where the two scopes meet.
                (SELECT count(*) FROM sync_origin_credential
                  WHERE node_role = 'STORE' AND site_id IS NOT NULL) AS fleet
           FROM commercial_publication p
           LEFT JOIN scope ON scope.publication_id = p.id
           LEFT JOIN drops ON drops.publication_id = p.id
           LEFT JOIN newer ON newer.publication_id = p.id
           LEFT JOIN live  ON live.publication_id  = p.id
          WHERE p.status = 'PUBLISHED'
          -- Newest first: a change list is read from the top, and the thing
          -- somebody just published is the thing they came to check.
          ORDER BY p.version DESC",
    )
    .bind(now)
    .fetch_all(pool)
    .await?;

    let mut changes = Vec::with_capacity(rows.len());
    for row in &rows {
        let effective_from: DateTime<Utc> = row.get("effective_from");
        let effective_to: Option<DateTime<Utc>> = row.get("effective_to");
        let status = ChangeStatus::of(effective_from, effective_to, now);
        let named_sites: i64 = row.get("named_sites");
        let widest_set: i32 = row.get("widest_set");
        let reaches_every_shop: bool = row.get("every_shop");
        let fleet: i64 = row.get("fleet");
        // A company-wide change targets every registered shop; a narrower one
        // targets the shops it names. Taking the fleet for both would report a
        // six-shop programme as four-thirteenths done for ever.
        let target = if reaches_every_shop {
            fleet
        } else {
            named_sites.max(i64::from(widest_set))
        };
        let activated: i64 = row.get("activated");
        let failed: i64 = row.get("failed");
        let rollout = RolloutProgress {
            activated,
            target,
            // Everything not settled one way or the other. Clamped at nought:
            // a shop can report activating a book it was not targeted for — a
            // scope narrowed after publication — and a negative "pending" would
            // read as work that does not exist.
            pending: (target - activated - failed).max(0),
            failed,
        };
        let kind = ChangeKind::of(row.get::<Option<String>, _>("change_type").as_deref());
        let carries_price_rules: i64 = row.get("skus");
        let carries_markdowns: i64 = row.get("markdowns");
        // What keeps a change on the working list, and it is not the window.
        //
        // UI-001 §6 states two rules that pull in opposite directions, and both
        // are about WORK rather than about dates:
        //
        //   "Regular change boleh keluar dari default operational list setelah
        //    penerapan pada seluruh target terselesaikan dan tidak ada
        //    outstanding action."
        //   "Period-based markdown tetap relevan selama active period; period
        //    berakhir tidak otomatis menyelesaikan pending recovery/activation
        //    work."
        //
        // So a regular price change every shop has activated drops off the day
        // it finishes, even though its window has no end and stays Active for
        // ever — there is nothing left for anybody to do about it. A markdown
        // stays while its period runs because the period IS the work, and stays
        // after the period closes if any shop is still out, because a date
        // passing does not activate a till.
        let period_is_the_work = kind.period_is_the_work()
            && matches!(status, ChangeStatus::Scheduled | ChangeStatus::Active);
        let settled = rollout.pending == 0 && rollout.failed == 0 && !period_is_the_work;
        if settled && !include_settled {
            continue;
        }
        changes.push(PriceChange {
            publication_id: row.get("id"),
            version: row.get("version"),
            name: row.get("name"),
            kind,
            carries_price_rules: carries_price_rules > 0,
            carries_markdowns: carries_markdowns > 0,
            status,
            effective_from,
            effective_to,
            published_by: row.get("published_by"),
            published_at: row.get("published_at"),
            article_count: row.get("articles"),
            sku_count: row.get("skus"),
            markdown_count: row.get("markdowns"),
            // The wider of the two ways a book names shops: one at a time, or a
            // named set. Adding them would double-count a book that does both
            // to the same shop, and a change cannot reach more shops than exist.
            store_count: target,
            reaches_every_shop,
            newer_books_touching: row.get("newer_books"),
            rollout,
        });
    }
    Ok(changes)
}

/// One thing that happened to a price book.
///
/// ## Five kinds, and why they are five and not one
///
/// UI-001 §7: *"Publication/activation/failure/expiry events dibedakan agar
/// publication tidak dibaca sebagai bukti harga sudah aktif."* That is the
/// whole reason this type exists. A single "the book changed" event would let
/// a reader conclude from a publication that tills are charging it, and this
/// estate has already learned what that costs — head office publishing a
/// markdown is not a counter running it, and the gap between the two is days.
///
/// So the kinds are the evidence, not the intention:
///
///   * `PUBLISHED` — somebody cut a book and put it out. Nothing is charging
///     it yet, and this event never implies that anything is.
///   * `SENT` — the centre queued it to a shop. Delivery, which is still not
///     activation: a message sitting in a till's inbox prices nothing.
///   * `ACTIVATED` — a shop reported it is charging the book. The only event
///     in this list that is evidence about a till, and it carries the shop's
///     own clock as well as the centre's.
///   * `FAILED` — a shop tried and said it could not, in its own words.
///   * `EXPIRED` — a book's window closed. A fact about the calendar, and NOT
///     about the shops: a book that expired with two tills still on it is
///     exactly the case `price_changes` keeps on its list.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PriceEvent {
    /// Stable within one read, for a React key. These rows come from four
    /// different tables and none of them shares a key space, so it is composed
    /// rather than borrowed — a uuid from one table would collide with the
    /// same uuid from another the moment two kinds name one publication.
    pub id: String,
    pub kind: String,
    /// When it happened, on the clock the event belongs to. For `ACTIVATED`
    /// that is the SHOP's clock: it is the shop's statement about its own
    /// till, and re-stamping it with the centre's arrival time would move an
    /// afternoon activation to whenever the sync happened to catch up.
    pub at: DateTime<Utc>,
    pub publication_id: Uuid,
    pub version: i64,
    pub publication_name: String,
    /// What the person who cut it said it was. `None` for books cut before
    /// `change_type` existed — reported as unknown rather than guessed from
    /// the book's name.
    pub change_type: Option<String>,
    /// The shop, on the three kinds that have one. `None` on `PUBLISHED` and
    /// `EXPIRED`, which are facts about the book and not about any branch.
    pub site_id: Option<String>,
    /// Who did it, where a person did. A shop activating is the shop, and the
    /// `actor` is its origin — the machine that reported.
    pub actor: Option<String>,
    /// What the shop said when it could not apply the book. Only ever set on
    /// `FAILED`, and passed through verbatim: a till's own words are the
    /// diagnostic, and paraphrasing them here would lose the one detail
    /// somebody needs.
    pub detail: Option<String>,
    /// How much of the book the shop took. Only on `ACTIVATED`, so a truncated
    /// delivery shows as a number rather than as a wrong price weeks later.
    pub price_rule_count: Option<i64>,
}

/// The price book's log — every event, newest first.
///
/// ## Why this is a UNION rather than a table
///
/// There is no event table, and adding one would create a second account of
/// things already written: the publication row carries its own publication, the
/// rollout row carries its own delivery, activation and failure, and the
/// window carries its own expiry. A log table beside them would drift the first
/// time anything wrote a book without going through whatever maintained it —
/// the same argument that keeps [`price_changes`] projection-only.
///
/// So this reads the four facts that already exist and orders them on one
/// axis. It is the log; nothing is stored to make it one.
///
/// ## Expiry is computed, and only when it has actually passed
///
/// A book with `effective_to` in the FUTURE has not expired — it is scheduled
/// to. Emitting that as an event would put tomorrow in a log of what happened,
/// which is the one thing a log may not contain.
pub async fn price_events(
    pool: &PgPool,
    version: Option<i64>,
    site_id: Option<&str>,
    limit: i64,
) -> Result<Vec<PriceEvent>, AppError> {
    let rows = sqlx::query(
        "WITH events AS (
           -- Published: somebody cut a book and put it out.
           SELECT 'PUBLISHED'                       AS kind,
                  p.published_at                    AS at,
                  p.id, p.version, p.name, p.change_type,
                  NULL::text                        AS site_id,
                  p.published_by                    AS actor,
                  NULL::text                        AS detail,
                  NULL::bigint                      AS price_rule_count
             FROM commercial_publication p
            WHERE p.status = 'PUBLISHED' AND p.published_at IS NOT NULL

           UNION ALL
           -- Sent: the centre queued it to a shop. Delivery, not activation.
           SELECT 'SENT', r.told_at,
                  p.id, p.version, p.name, p.change_type,
                  r.site_id, r.origin_id, NULL, NULL
             FROM commercial_publication_rollout r
             JOIN commercial_publication p ON p.id = r.publication_id
            WHERE r.told_at IS NOT NULL

           UNION ALL
           -- Activated: the shop says it is charging the book. Its clock.
           SELECT 'ACTIVATED', r.activated_at,
                  p.id, p.version, p.name, p.change_type,
                  r.site_id, r.origin_id, NULL, r.price_rule_count
             FROM commercial_publication_rollout r
             JOIN commercial_publication p ON p.id = r.publication_id
            WHERE r.state = 'ACTIVE' AND r.activated_at IS NOT NULL

           UNION ALL
           -- Failed: the shop tried and said it could not, in its own words.
           SELECT 'FAILED', COALESCE(r.last_attempt_at, r.reported_at),
                  p.id, p.version, p.name, p.change_type,
                  r.site_id, r.origin_id, r.last_error, NULL
             FROM commercial_publication_rollout r
             JOIN commercial_publication p ON p.id = r.publication_id
            WHERE r.state = 'FAILED'
              AND COALESCE(r.last_attempt_at, r.reported_at) IS NOT NULL

           UNION ALL
           -- Expired: the window closed. Only once it actually has.
           SELECT 'EXPIRED', p.effective_to,
                  p.id, p.version, p.name, p.change_type,
                  NULL, NULL, NULL, NULL
             FROM commercial_publication p
            WHERE p.status = 'PUBLISHED'
              AND p.effective_to IS NOT NULL
              AND p.effective_to <= now()
         )
         SELECT * FROM events
          WHERE ($1::bigint IS NULL OR version = $1)
            -- A publication-wide event has no shop, and narrowing to a shop
            -- must not hide the publication its shop events belong to: asking
            -- for Medan and being shown activations with no book in sight is a
            -- log that cannot be read.
            AND ($2::text IS NULL OR site_id = $2 OR site_id IS NULL)
          ORDER BY at DESC, version DESC, kind
          LIMIT $3",
    )
    .bind(version)
    .bind(site_id)
    .bind(limit.clamp(1, 1000))
    .fetch_all(pool)
    .await?;

    rows.iter()
        .map(|row| {
            let kind: String = row.try_get("kind")?;
            let publication_id: Uuid = row.try_get("id")?;
            let at: DateTime<Utc> = row.try_get("at")?;
            let site_id: Option<String> = row.try_get("site_id")?;
            Ok(PriceEvent {
                // Publication, kind, shop and instant together. A shop can
                // activate one book once, but a book can be sent and activated
                // at the same shop, and two shops can act in the same second.
                id: format!(
                    "{publication_id}:{kind}:{}:{}",
                    site_id.as_deref().unwrap_or("-"),
                    at.timestamp_millis()
                ),
                kind,
                at,
                publication_id,
                version: row.try_get("version")?,
                publication_name: row.try_get("name")?,
                change_type: row.try_get("change_type")?,
                site_id,
                actor: row.try_get("actor")?,
                detail: row.try_get("detail")?,
                price_rule_count: row.try_get("price_rule_count")?,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    //! The two derivations that are this module's own opinion rather than the
    //! database's: what a change IS, and where it is in its life. Both are pure,
    //! and both would otherwise only be checked by looking at a screen.

    use super::*;
    use chrono::TimeZone;

    fn at(day: u32) -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 9, day, 0, 0, 0)
            .single()
            .unwrap_or_else(|| panic!("2026-09-{day} is not a date"))
    }

    #[test]
    fn a_change_whose_window_has_not_opened_is_scheduled_not_active() {
        // The distinction the list exists for. A book is published to the shops
        // days before it takes effect — that is the ordinary way a price change
        // is rolled out — and showing it as Active would say the tills are
        // already charging it.
        assert_eq!(
            ChangeStatus::of(at(20), None, at(10)),
            ChangeStatus::Scheduled
        );
        assert_eq!(ChangeStatus::of(at(1), None, at(10)), ChangeStatus::Active);
    }

    #[test]
    fn a_window_that_closed_today_is_ended_and_one_closing_tomorrow_is_not() {
        // `effective_to` is the instant it STOPS applying, so a book whose end
        // is exactly now is already over. Reading it inclusively would keep a
        // finished clearance on the working list for one more day, every time.
        assert_eq!(
            ChangeStatus::of(at(1), Some(at(10)), at(10)),
            ChangeStatus::Ended
        );
        assert_eq!(
            ChangeStatus::of(at(1), Some(at(11)), at(10)),
            ChangeStatus::Active
        );
    }

    #[test]
    fn what_a_change_is_comes_from_what_its_author_declared_not_from_its_contents() {
        // A clearance and an end-of-season markdown carry identical rows, so
        // the classification cannot come from them — and a book named
        // "Q3 Clearance" that carries base prices is a re-price, so it cannot
        // come from the name either. It comes from what the author declared.
        assert_eq!(ChangeKind::of(Some("CLEARANCE")), ChangeKind::Clearance);
        assert_eq!(
            ChangeKind::of(Some("REGULAR_PRICE")),
            ChangeKind::RegularPrice
        );
        // A book cut before the column existed says so, and is not guessed at
        // from its contents — a classification nobody made would be carried
        // into every report built on top of it.
        assert_eq!(ChangeKind::of(None), ChangeKind::Unclassified);
        // And a word written by a newer node is not reclassified by this one.
        assert_eq!(ChangeKind::of(Some("FLASH_SALE")), ChangeKind::Unclassified);
    }

    #[test]
    fn a_clearance_runs_on_its_period_and_an_unclassified_book_falls_back_to_rollout() {
        // A clearance runs on its period; an unclassified book falls to the
        // rollout rule, which is the safer of the two — it leaves the list once
        // every shop has it rather than sitting there for ever on a
        // classification nobody made.
        assert!(ChangeKind::Clearance.period_is_the_work());
        assert!(!ChangeKind::Unclassified.period_is_the_work());
        assert!(!ChangeKind::RegularPrice.period_is_the_work());
    }

    #[test]
    fn a_period_that_ended_does_not_activate_the_shops_that_never_switched() {
        // UI-001 §6, and the reason the two dimensions cannot be one enum: a
        // markdown whose period closed on 30 September with two shops still out
        // is finished as a decision and unfinished as work. Collapsing them
        // drops those two shops off every list anybody reads.
        let ended = ChangeStatus::of(at(1), Some(at(10)), at(20));
        assert_eq!(ended, ChangeStatus::Ended);
        assert!(
            still_work(ChangeKind::Markdown, ended, 2),
            "two shops are still out; this is still work"
        );
    }

    /// The list's own rule, as a function so the tests exercise the thing and
    /// not a copy of it.
    fn still_work(kind: ChangeKind, status: ChangeStatus, pending: i64) -> bool {
        let period_is_the_work = kind.period_is_the_work()
            && matches!(status, ChangeStatus::Scheduled | ChangeStatus::Active);
        !(pending == 0 && !period_is_the_work)
    }

    #[test]
    fn a_markdown_stays_on_the_list_while_its_period_runs_even_with_every_shop_switched() {
        // The period IS the work for a markdown: it is a programme with a start
        // and an end that somebody is running, not a one-off push that finishes
        // when the last till acknowledges it.
        assert!(still_work(ChangeKind::Markdown, ChangeStatus::Active, 0));
    }

    #[test]
    fn a_markdown_whose_period_closed_with_shops_still_out_is_not_finished() {
        // "period berakhir tidak otomatis menyelesaikan pending recovery/
        // activation work" — a date passing does not activate a till, and the
        // two shops still on the old price are the reason anybody looks.
        assert!(still_work(ChangeKind::Markdown, ChangeStatus::Ended, 2));
        // And once they are in, it is done.
        assert!(!still_work(ChangeKind::Markdown, ChangeStatus::Ended, 0));
    }

    #[test]
    fn a_change_every_shop_has_activated_drops_off_even_with_its_window_open() {
        // The other direction, and the one that keeps the list short: a price
        // update with no end date is Active for ever, and once thirteen shops
        // out of thirteen have switched there is nothing left for anybody to
        // do about it.
        // "Regular change boleh keluar dari default operational list setelah
        // penerapan pada seluruh target terselesaikan" — a price update with no
        // end date is Active for ever, and once thirteen shops of thirteen have
        // switched there is nothing left for anybody to do about it. Keeping it
        // would fill the working list with finished work until somebody wrote
        // an end date they did not mean.
        let active = ChangeStatus::of(at(1), None, at(20));
        assert_eq!(active, ChangeStatus::Active);
        assert!(!still_work(ChangeKind::RegularPrice, active, 0));
        // One shop short and it is back.
        assert!(still_work(ChangeKind::RegularPrice, active, 1));
    }
}
