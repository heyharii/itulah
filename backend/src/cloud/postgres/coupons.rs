//! Coupons: the set somebody authored, the codes it produced, and every time
//! one was actually spent.
//!
//! Before migration `0170` the whole of this was a counter. `commercial_usage`
//! knew that `LEBARAN10` had been redeemed 47 times and could not say by whom,
//! on which sale, or whether the 48th was currently sitting in a basket at
//! till 3. A count is an observation; a coupon is a thing with a state, and the
//! difference is the reason a code could be spent twice and nobody found out
//! until the sales synced.
//!
//! **The hold is the point of this module, and it is deliberately not new.**
//! `voucher_authorization` settled the shape in `0162` and this follows it line
//! for line: a hold row with an expiry, availability computed as cap minus
//! redemptions minus open holds INSIDE a `SELECT … FOR UPDATE`, and commit and
//! release as separate calls that a till makes when it knows which happened.
//! Two hold mechanisms with two vocabularies would be the bug — anybody who has
//! read the voucher module can read this one without learning anything.
//!
//! Two things here are NOT the voucher's shape, and both are because a set is
//! not a card:
//!
//!   * the SET row is locked before the code row. A voucher's cap lives on the
//!     card, so locking the card is enough. A coupon set's cap is shared by
//!     every code in it, and two tills presenting two different codes from one
//!     mailing lock different rows — so without the set lock a total cap of one
//!     admits two baskets. Parent then child, the same order everywhere below,
//!     so the pair cannot be taken backwards into a deadlock.
//!   * a hold reserves a USE, not an amount. A voucher is money and comes off
//!     in parts; a coupon either applies to a basket or does not. What it took
//!     off is recorded at commit, when the till knows, and is never a thing the
//!     hold negotiates.

use crate::cloud::{
    application::AppError,
    domain::{mint_code, normalize_code},
};
use chrono::{DateTime, Utc};
use pricing_engine::RejectionReason;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::{PgPool, Postgres, Row, Transaction};
use std::str::FromStr;
use uuid::Uuid;

// ---------------------------------------------------------------------------
// The part that is arithmetic, and has no database in it
//
// Everything below this line up to `CouponSetRow` decides admission from
// numbers alone. It is separated because the decision is the thing worth
// testing exhaustively and a Postgres round trip per case would mean it never
// was: the tests at the bottom of this file run the state machine and the three
// caps without a connection string.
// ---------------------------------------------------------------------------

/// Whether a set is one code everybody types, or one code per person.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub enum CouponSetKind {
    /// `LEBARAN10`. One row in `coupon_code`, presented by everybody.
    Shared,
    /// A mailing. One row per person, each good once.
    Unique,
}

impl CouponSetKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Shared => "SHARED",
            Self::Unique => "UNIQUE",
        }
    }
}

impl FromStr for CouponSetKind {
    type Err = AppError;

    fn from_str(raw: &str) -> Result<Self, Self::Err> {
        match raw.trim().to_ascii_uppercase().as_str() {
            "SHARED" => Ok(Self::Shared),
            "UNIQUE" => Ok(Self::Unique),
            other => Err(AppError::Validation(format!(
                "a coupon set is SHARED or UNIQUE, not {other:?}"
            ))),
        }
    }
}

/// Where one code has got to.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub enum CouponState {
    /// Minted, nothing against it.
    Issued,
    /// A checkout is holding it. Capacity remains, but not all of it is free.
    Reserved,
    /// Used up. For a single-use code that is one redemption; for a shared one
    /// it is `max_uses` of them.
    Redeemed,
    /// Past its window, as a sweep found it. Never consulted when admitting a
    /// basket — see [`admit_coupon`], which measures the window itself.
    Expired,
    /// Somebody stopped it. The only state here that is a decision rather than
    /// an observation, and the only one that survives a recount.
    Cancelled,
}

impl CouponState {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Issued => "ISSUED",
            Self::Reserved => "RESERVED",
            Self::Redeemed => "REDEEMED",
            Self::Expired => "EXPIRED",
            Self::Cancelled => "CANCELLED",
        }
    }
}

impl FromStr for CouponState {
    type Err = AppError;

    fn from_str(raw: &str) -> Result<Self, Self::Err> {
        match raw.trim().to_ascii_uppercase().as_str() {
            "ISSUED" => Ok(Self::Issued),
            "RESERVED" => Ok(Self::Reserved),
            "REDEEMED" => Ok(Self::Redeemed),
            "EXPIRED" => Ok(Self::Expired),
            "CANCELLED" => Ok(Self::Cancelled),
            other => Err(AppError::Validation(format!(
                "{other:?} is not a coupon state"
            ))),
        }
    }
}

/// What a code's state becomes once its redemptions and holds are counted.
///
/// The state column is a CACHE of those two numbers and never a third opinion
/// about them — the fault `0086` went back and removed from this very area was
/// one count with two sources. So it is recomputed from the facts inside the
/// same locked transaction that changes them, and never incremented.
///
/// `CANCELLED` is the one state a recount cannot undo, because it is a decision
/// somebody took rather than a consequence of arithmetic. `EXPIRED` is NOT
/// terminal on purpose: a merchandiser who extends a set's window has un-lapsed
/// its codes, and the next thing that touches one should say so.
pub fn settled_coupon_state(
    current: CouponState,
    redemptions: i64,
    open_holds: i64,
    max_uses: Option<i64>,
) -> CouponState {
    if current == CouponState::Cancelled {
        return CouponState::Cancelled;
    }
    if max_uses.is_some_and(|cap| redemptions >= cap) {
        return CouponState::Redeemed;
    }
    if open_holds > 0 {
        return CouponState::Reserved;
    }
    CouponState::Issued
}

/// One cap, what has been taken against it, and what is currently spoken for.
///
/// `cap: None` is uncapped and NOT "cap of zero" — the distinction is the
/// difference between a promotion with no limit and a promotion nobody can use,
/// and reading a null as a number is how the second gets shipped as the first.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct CouponCapacity {
    pub cap: Option<i64>,
    pub redemptions: i64,
    pub open_holds: i64,
}

impl CouponCapacity {
    /// The invariant, in one place: `available = cap − redemptions − holds`.
    ///
    /// Saturating, because a cap lowered after codes were already spent leaves
    /// a genuinely negative remainder, and a negative "available" read by
    /// something expecting a count is worse than a zero that means the same
    /// thing here: nothing is free.
    pub fn available(&self) -> Option<i64> {
        self.cap
            .map(|cap| (cap - self.redemptions - self.open_holds).max(0))
    }

    /// Is there room for one more basket?
    pub fn admits_one(&self) -> bool {
        self.available().is_none_or(|left| left > 0)
    }
}

/// Why a coupon was not honoured.
///
/// The sentences come from [`RejectionReason::describe`] wherever the pricing
/// engine already has a name for the case. That is deliberate: a cashier hears
/// one vocabulary whether the refusal came from the engine deciding a basket or
/// from the centre deciding a hold, and the same words are written down once.
/// Only the three cases the engine has no name for carry their own.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CouponRefusal {
    SetNotActive,
    NotStarted,
    Expired,
    Cancelled,
    CodeUsedUp,
    SetExhausted,
    CustomerLimitReached,
    /// The set counts per customer and the basket has nobody in it. Refused
    /// rather than waved through: a per-customer cap that stops applying the
    /// moment a shopper declines to identify themselves is not a cap.
    CustomerUnknown,
    BelongsToSomeoneElse,
}

impl CouponRefusal {
    pub fn describe(self) -> &'static str {
        match self {
            Self::SetNotActive => RejectionReason::CouponNotActive.describe(),
            Self::NotStarted => RejectionReason::NotStarted.describe(),
            Self::Expired => RejectionReason::CouponExpired.describe(),
            Self::Cancelled => "that coupon was stopped",
            Self::CodeUsedUp => RejectionReason::CouponUsedUp.describe(),
            Self::SetExhausted => RejectionReason::UsageExhausted.describe(),
            Self::CustomerLimitReached => "that shopper has used this offer as often as it allows",
            Self::CustomerUnknown => {
                "that coupon is limited per shopper, so the shopper has to be identified"
            }
            Self::BelongsToSomeoneElse => RejectionReason::CouponBelongsToSomeoneElse.describe(),
        }
    }

    /// The short name a till can branch on, when a sentence is not enough.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::SetNotActive => "SET_NOT_ACTIVE",
            Self::NotStarted => "NOT_STARTED",
            Self::Expired => "EXPIRED",
            Self::Cancelled => "CANCELLED",
            Self::CodeUsedUp => "CODE_USED_UP",
            Self::SetExhausted => "SET_EXHAUSTED",
            Self::CustomerLimitReached => "CUSTOMER_LIMIT_REACHED",
            Self::CustomerUnknown => "CUSTOMER_UNKNOWN",
            Self::BelongsToSomeoneElse => "BELONGS_TO_SOMEONE_ELSE",
        }
    }
}

/// Everything the decision needs, and nothing that would require a database to
/// evaluate.
pub struct CouponAdmission<'a> {
    pub state: CouponState,
    pub set_active: bool,
    pub valid_from: Option<DateTime<Utc>>,
    pub valid_to: Option<DateTime<Utc>>,
    pub code: CouponCapacity,
    pub set: CouponCapacity,
    /// `None` when the set declares no per-customer cap. `Some` carries the cap
    /// and what this shopper has already taken.
    pub per_customer: Option<CouponCapacity>,
    /// The person this code was minted to. `None` is bearer paper.
    pub minted_to: Option<&'a str>,
    /// The person standing at the counter, if the basket names one.
    pub presenter: Option<&'a str>,
}

/// May this basket hold a use of this code?
///
/// The order of the checks is the order a cashier would want to hear them: what
/// the promotion is, then whose coupon it is, then whether there is any left.
/// "That coupon belongs to another customer" answered before "it is used up"
/// means the shopper is told the true reason rather than a consequence of it.
pub fn admit_coupon(
    admission: &CouponAdmission<'_>,
    now: DateTime<Utc>,
) -> Result<(), CouponRefusal> {
    if admission.state == CouponState::Cancelled {
        return Err(CouponRefusal::Cancelled);
    }
    if !admission.set_active {
        return Err(CouponRefusal::SetNotActive);
    }
    // The window is measured here and the stored `EXPIRED` is not consulted.
    // A swept status is a report that is true until the next sweep; the dates
    // are the rule, and they are the same rule whether or not anything has run.
    if let Some(from) = admission.valid_from {
        if now < from {
            return Err(CouponRefusal::NotStarted);
        }
    }
    if let Some(to) = admission.valid_to {
        if now >= to {
            return Err(CouponRefusal::Expired);
        }
    }
    if let Some(owner) = admission.minted_to {
        // An unnamed basket fails this too. A code minted to one shopper is
        // evidence about that shopper, and "we could not tell" is not the same
        // answer as "it is them".
        if admission.presenter != Some(owner) {
            return Err(CouponRefusal::BelongsToSomeoneElse);
        }
    }
    if !admission.code.admits_one() {
        return Err(CouponRefusal::CodeUsedUp);
    }
    if !admission.set.admits_one() {
        return Err(CouponRefusal::SetExhausted);
    }
    if let Some(per_customer) = admission.per_customer {
        if admission.presenter.is_none() {
            return Err(CouponRefusal::CustomerUnknown);
        }
        if !per_customer.admits_one() {
            return Err(CouponRefusal::CustomerLimitReached);
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// The wire
// ---------------------------------------------------------------------------

/// A set, as a list draws it.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CouponSetRow {
    pub coupon_set_id: Uuid,
    /// The handle a person types. For a SHARED set it is also the code itself.
    pub set_code: String,
    pub name: String,
    pub rule_id: String,
    pub kind: CouponSetKind,
    pub valid_from: Option<DateTime<Utc>>,
    pub valid_to: Option<DateTime<Utc>>,
    pub max_redemptions: Option<i64>,
    pub max_per_customer: Option<i64>,
    pub hold_seconds: i32,
    pub active: bool,
    pub created_at: DateTime<Utc>,
    pub created_by: String,
    pub note: Option<String>,
    /// How many codes exist. One for a SHARED set; whatever was minted for a
    /// UNIQUE one.
    pub code_count: i64,
    /// Redemptions that were not given back. The number a merchandiser means by
    /// "how did it go", and the number the total cap is measured against.
    pub redeemed_count: i64,
    /// Uses currently sitting in somebody's basket. Counted separately because
    /// it is the one number that will be different in a minute, and adding it
    /// to the redemptions would make a report that reads high and then falls.
    pub held_count: i64,
    /// What the set has given away, in minor units.
    pub discount_minor: i64,
}

/// One code and where it has got to.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CouponCodeRow {
    pub coupon_code_id: Uuid,
    pub code: String,
    pub set_code: String,
    pub state: CouponState,
    pub max_uses: Option<i64>,
    pub customer_id: Option<String>,
    pub issued_at: DateTime<Utc>,
    pub issued_by: String,
    pub cancelled_at: Option<DateTime<Utc>>,
    pub cancel_reason: Option<String>,
    pub redeemed_count: i64,
    pub held_count: i64,
}

/// One time a code was actually spent.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CouponRedemptionRow {
    pub redemption_id: Uuid,
    pub sale_id: Uuid,
    pub checkout_id: String,
    pub customer_id: Option<String>,
    pub discount_minor: i64,
    pub status: String,
    pub site_id: Option<String>,
    pub actor: String,
    pub redeemed_at: DateTime<Utc>,
    pub cancelled_at: Option<DateTime<Utc>>,
}

/// A code and everything that has happened to it.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CouponCodeDetail {
    pub code: CouponCodeRow,
    pub set: CouponSetRow,
    pub redemptions: Vec<CouponRedemptionRow>,
}

/// What authoring a set says.
///
/// `deny_unknown_fields`, because a misspelled cap is a set published with no
/// cap at all — and the caller believes they set one.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CreateCouponSetRequest {
    pub set_code: String,
    pub name: String,
    pub rule_id: String,
    pub kind: CouponSetKind,
    #[serde(default)]
    pub valid_from: Option<DateTime<Utc>>,
    #[serde(default)]
    pub valid_to: Option<DateTime<Utc>>,
    #[serde(default)]
    pub max_redemptions: Option<i64>,
    #[serde(default)]
    pub max_per_customer: Option<i64>,
    /// How long a till may hold a use. Omitted takes the estate default, which
    /// is the same fifteen minutes a voucher hold gets.
    #[serde(default)]
    pub hold_seconds: Option<i32>,
    /// Only meaningful for a SHARED set: how often its one code may be
    /// presented. Usually left out, with the limit expressed once as
    /// `max_redemptions`.
    #[serde(default)]
    pub code_max_uses: Option<i64>,
    #[serde(default)]
    pub note: Option<String>,
}

/// What a bulk mint asks for.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct MintCouponsRequest {
    /// How many bearer codes to make. Ignored when `customer_ids` is given,
    /// because then the list decides.
    #[serde(default)]
    pub count: Option<i64>,
    /// One code per named shopper. The shape a mailing actually takes: the
    /// codes are not interchangeable and the point is that they are not.
    #[serde(default)]
    pub customer_ids: Vec<String>,
}

/// What a mint produced.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct MintedCoupons {
    pub set_code: String,
    pub minted: i64,
    /// Every code, in the order they were made. Returned in full because the
    /// caller has to do something with them — print them, mail them — and a
    /// mint that only said "10000 codes" would need a second endpoint to be of
    /// any use at all.
    pub codes: Vec<String>,
}

/// A till asking to hold a use while a basket is paid for.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct AuthorizeCouponRequest {
    pub checkout_id: String,
    pub actor_id: String,
    #[serde(default)]
    pub customer_id: Option<String>,
    #[serde(default)]
    pub site_id: Option<String>,
    /// Overrides the set's own hold length. A till that knows it is slow today
    /// may ask for longer; it may not ask for forever, because an abandoned
    /// hold blocks the next shopper.
    #[serde(default)]
    pub hold_seconds: Option<i64>,
}

/// The sale landed.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CommitCouponRequest {
    pub checkout_id: String,
    pub actor_id: String,
    pub sale_id: Uuid,
    /// What the coupon took off this basket, in minor units. Recorded rather
    /// than recomputed: the rule that produced it lives in a price book that
    /// will be republished, and asking next year what a promotion cost should
    /// not mean re-running a rule that no longer exists.
    #[serde(default)]
    pub discount_minor: i64,
}

/// Stopping a code.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CancelCouponRequest {
    /// Required, and not for tidiness. A code that stopped working is a
    /// complaint somebody will have to answer, and "cancelled, no reason given"
    /// is an answer nobody can give.
    pub reason: String,
}

/// The checkout died.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ReleaseCouponRequest {
    pub checkout_id: String,
    pub actor_id: String,
    #[serde(default)]
    pub reason: Option<String>,
}

// ---------------------------------------------------------------------------
// The database
// ---------------------------------------------------------------------------

/// The same fifteen minutes a voucher hold gets. One number for both, because a
/// cashier's patience does not depend on which kind of paper is in their hand.
const DEFAULT_HOLD_SECONDS: i64 = 900;

/// A hold may be asked to last an hour, and no longer. Beyond that an abandoned
/// basket is not a hold, it is a code out of circulation for the afternoon.
///
/// A request above it is REFUSED rather than quietly shortened. A till told it
/// has two hours, and given fifteen minutes, does not find out until it commits
/// against a lapsed hold — which is at the counter, with the shopper waiting,
/// and is the worst moment this system has to deliver bad news.
const MAX_HOLD_SECONDS: i64 = 3_600;

/// How many codes one mint may make.
///
/// A ceiling rather than no ceiling because the request is a number typed by a
/// person, and a slipped keystroke on an uncapped endpoint writes ten million
/// rows before anybody can look at it.
const MAX_MINT: i64 = 50_000;

fn map_coupon_write_error(error: sqlx::Error) -> AppError {
    if let sqlx::Error::Database(database) = &error {
        let constraint = database.constraint().unwrap_or_default();
        return match database.code().as_deref() {
            Some("23505") if constraint == "ux_coupon_redemption_one_per_single_use_code" => {
                AppError::Conflict(CouponRefusal::CodeUsedUp.describe().to_owned())
            }
            Some("23505") if constraint == "coupon_redemption_one_per_sale" => AppError::Conflict(
                "that sale has already counted this coupon — one code counts once per receipt"
                    .to_owned(),
            ),
            Some("23505") if constraint == "coupon_set_set_code_key" => AppError::Conflict(
                "a coupon set with that code already exists — a code names one set".to_owned(),
            ),
            Some("23505") if constraint == "coupon_code_code_key" => AppError::Conflict(
                "that code already exists — a code names one coupon, whichever set it came from"
                    .to_owned(),
            ),
            Some("23505") => AppError::Conflict(database.message().to_owned()),
            Some("23514") | Some("23502") => AppError::Validation(database.message().to_owned()),
            _ => AppError::Database(error),
        };
    }
    AppError::Database(error)
}

fn optional_text(raw: Option<&str>) -> Option<String> {
    raw.map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
}

fn required_text(raw: &str, what: &str) -> Result<String, AppError> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(AppError::Validation(format!("{what} cannot be blank")));
    }
    Ok(trimmed.to_owned())
}

/// A code as the database stores it.
///
/// The normalisation is the voucher's, reused rather than rewritten: upper
/// case, no spaces or dashes, letters and digits only. `lebaran-10` and
/// `LEBARAN 10` are one coupon, for exactly the reason they are one card — a
/// shopper copies down whatever was printed, in whatever shape they copy it.
/// Only the sentence is re-worded, because "voucher" is the wrong noun to put
/// in front of somebody holding a coupon.
fn normalize_coupon_code(raw: &str) -> Result<String, AppError> {
    normalize_code(raw).map_err(|_| {
        AppError::Validation(format!(
            "a coupon code is 6 to 32 letters and digits, not {raw:?}"
        ))
    })
}

/// A code nobody has to guess at, and nobody can guess.
///
/// The voucher's minting, for the voucher's reason: a coupon posted to a named
/// shopper is a bearer token until it is presented, and a sequence anybody can
/// count up from is a mailing that redeems itself.
fn mint_coupon_code() -> String {
    let bytes = *Uuid::new_v4().as_bytes();
    let mut random = [0_u8; 12];
    random.copy_from_slice(&bytes[..12]);
    mint_code(random)
}

/// One set, locked, with the caps that decide admission.
///
/// Locked FIRST — before the code — because the set's total cap is one counter
/// shared by every code in it. Two tills presenting two different codes from
/// one mailing lock different code rows and would both pass a cap of one. The
/// order is the same in every path in this file so the pair cannot be taken
/// backwards into a deadlock.
struct LockedSet {
    coupon_set_id: Uuid,
    set_code: String,
    /// Carried so an authorize can tell the till WHICH promotion the code just
    /// opened. Without it a till holds a use and still has to go and ask what
    /// it is for.
    rule_id: String,
    kind: CouponSetKind,
    active: bool,
    valid_from: Option<DateTime<Utc>>,
    valid_to: Option<DateTime<Utc>>,
    max_redemptions: Option<i64>,
    max_per_customer: Option<i64>,
    hold_seconds: i32,
}

async fn lock_set_by_id(
    tx: &mut Transaction<'_, Postgres>,
    coupon_set_id: Uuid,
) -> Result<LockedSet, AppError> {
    let row = sqlx::query(
        "SELECT coupon_set_id, set_code, rule_id, kind, active, valid_from, valid_to,
                max_redemptions, max_per_customer, hold_seconds
           FROM coupon_set WHERE coupon_set_id = $1 FOR UPDATE",
    )
    .bind(coupon_set_id)
    .fetch_optional(&mut **tx)
    .await?
    .ok_or_else(|| AppError::NotFound("Coupon set".to_owned()))?;
    let kind: String = row.try_get("kind")?;
    Ok(LockedSet {
        coupon_set_id: row.try_get("coupon_set_id")?,
        set_code: row.try_get("set_code")?,
        rule_id: row.try_get("rule_id")?,
        kind: CouponSetKind::from_str(&kind)?,
        active: row.try_get("active")?,
        valid_from: row.try_get("valid_from")?,
        valid_to: row.try_get("valid_to")?,
        max_redemptions: row.try_get("max_redemptions")?,
        max_per_customer: row.try_get("max_per_customer")?,
        hold_seconds: row.try_get("hold_seconds")?,
    })
}

struct LockedCode {
    coupon_code_id: Uuid,
    state: CouponState,
    max_uses: Option<i64>,
    customer_id: Option<String>,
}

/// Find a code, lock its set, then lock the code.
///
/// Two statements rather than a join with two `FOR UPDATE` clauses, because the
/// ORDER matters and a join does not promise one. The first read is unlocked and
/// exists only to learn which set to lock; nothing is decided from it.
async fn lock_set_then_code(
    tx: &mut Transaction<'_, Postgres>,
    code: &str,
) -> Result<(LockedSet, LockedCode), AppError> {
    let set_id: Uuid = sqlx::query_scalar("SELECT coupon_set_id FROM coupon_code WHERE code = $1")
        .bind(code)
        .fetch_optional(&mut **tx)
        .await?
        .ok_or_else(|| AppError::NotFound("Coupon".to_owned()))?;

    let set = lock_set_by_id(tx, set_id).await?;

    let row = sqlx::query(
        "SELECT coupon_code_id, state, max_uses, customer_id
           FROM coupon_code WHERE code = $1 FOR UPDATE",
    )
    .bind(code)
    .fetch_optional(&mut **tx)
    .await?
    .ok_or_else(|| AppError::NotFound("Coupon".to_owned()))?;
    let state: String = row.try_get("state")?;
    Ok((
        set,
        LockedCode {
            coupon_code_id: row.try_get("coupon_code_id")?,
            state: CouponState::from_str(&state)?,
            max_uses: row.try_get("max_uses")?,
            customer_id: row.try_get("customer_id")?,
        },
    ))
}

/// The three caps, each measured twice: what has been spent against it, and
/// what is currently spoken for. Taken in ONE statement inside the lock.
///
/// One round trip rather than six, and not for tidiness: the set row is held
/// for the whole of this, so every trip is time that every other till in the
/// estate spends waiting on the same set.
///
/// An expired hold stops counting against availability — the same rule `0162`
/// applies to a voucher's. It is still a row, and committing it is still
/// refused loudly, because a lapsed clock is not evidence the checkout failed.
struct CouponCounts {
    code_redemptions: i64,
    code_holds: i64,
    set_redemptions: i64,
    set_holds: i64,
    customer_redemptions: i64,
    customer_holds: i64,
}

async fn count_against_caps(
    tx: &mut Transaction<'_, Postgres>,
    coupon_set_id: Uuid,
    coupon_code_id: Uuid,
    customer_id: Option<&str>,
) -> Result<CouponCounts, AppError> {
    let row = sqlx::query(
        "SELECT
           (SELECT count(*) FROM coupon_redemption r
             WHERE r.coupon_code_id = $2 AND r.status <> 'CANCELLED')                  AS code_redemptions,
           (SELECT count(*) FROM coupon_authorization a
             WHERE a.coupon_code_id = $2 AND a.status = 'AUTHORIZED'
               AND a.expires_at > now())                                               AS code_holds,
           (SELECT count(*) FROM coupon_redemption r
              JOIN coupon_code c ON c.coupon_code_id = r.coupon_code_id
             WHERE c.coupon_set_id = $1 AND r.status <> 'CANCELLED')                   AS set_redemptions,
           (SELECT count(*) FROM coupon_authorization a
              JOIN coupon_code c ON c.coupon_code_id = a.coupon_code_id
             WHERE c.coupon_set_id = $1 AND a.status = 'AUTHORIZED'
               AND a.expires_at > now())                                               AS set_holds,
           (SELECT count(*) FROM coupon_redemption r
              JOIN coupon_code c ON c.coupon_code_id = r.coupon_code_id
             WHERE c.coupon_set_id = $1 AND r.status <> 'CANCELLED'
               AND r.customer_id = $3::text)                                                 AS customer_redemptions,
           (SELECT count(*) FROM coupon_authorization a
              JOIN coupon_code c ON c.coupon_code_id = a.coupon_code_id
             WHERE c.coupon_set_id = $1 AND a.status = 'AUTHORIZED'
               AND a.expires_at > now() AND a.customer_id = $3::text)                        AS customer_holds",
    )
    .bind(coupon_set_id)
    .bind(coupon_code_id)
    .bind(customer_id)
    .fetch_one(&mut **tx)
    .await?;
    Ok(CouponCounts {
        code_redemptions: row.try_get("code_redemptions")?,
        code_holds: row.try_get("code_holds")?,
        set_redemptions: row.try_get("set_redemptions")?,
        set_holds: row.try_get("set_holds")?,
        customer_redemptions: row.try_get("customer_redemptions")?,
        customer_holds: row.try_get("customer_holds")?,
    })
}

/// Write the code's state back from what the two authorities now say.
///
/// Called after every change to a redemption or a hold, in the same transaction
/// as the change. The column is a cache and this is the only thing that fills
/// it, so it cannot drift from the rows it summarises.
async fn resettle_state(
    tx: &mut Transaction<'_, Postgres>,
    coupon_code_id: Uuid,
    current: CouponState,
    max_uses: Option<i64>,
) -> Result<CouponState, AppError> {
    // Re-read rather than take the numbers the caller already had and add one.
    // The arithmetic would be right — every writer holds the code row first, so
    // nothing else can have moved either count — but a cache that is filled by
    // counting cannot drift, and one that is filled by incrementing is the
    // thing this column exists to not be.
    //
    // Deliberately NOT `count_against_caps`: the state depends on this code
    // alone, and the set-wide and per-shopper counts are two joins that would
    // be paid for here while the whole set waits on the lock.
    let row = sqlx::query(
        "SELECT
           (SELECT count(*) FROM coupon_redemption r
             WHERE r.coupon_code_id = $1 AND r.status <> 'CANCELLED') AS redemptions,
           (SELECT count(*) FROM coupon_authorization a
             WHERE a.coupon_code_id = $1 AND a.status = 'AUTHORIZED'
               AND a.expires_at > now())                              AS holds",
    )
    .bind(coupon_code_id)
    .fetch_one(&mut **tx)
    .await?;
    let redemptions: i64 = row.try_get("redemptions")?;
    let holds: i64 = row.try_get("holds")?;

    let next = settled_coupon_state(current, redemptions, holds, max_uses);
    if next != current {
        sqlx::query("UPDATE coupon_code SET state = $2 WHERE coupon_code_id = $1")
            .bind(coupon_code_id)
            .bind(next.as_str())
            .execute(&mut **tx)
            .await
            .map_err(map_coupon_write_error)?;
    }
    Ok(next)
}

/// Author a set.
///
/// A SHARED set gets its one code here and not later. There is no moment at
/// which `LEBARAN10` exists as a set with no code to type: a shopper presenting
/// it the second after publication would be told there is no such coupon, and
/// the merchandiser would have no idea why.
pub async fn create_coupon_set(
    pool: &PgPool,
    request: CreateCouponSetRequest,
    actor: &str,
) -> Result<CouponSetRow, AppError> {
    let set_code = normalize_coupon_code(&request.set_code)?;
    let name = required_text(&request.name, "a coupon set's name")?;
    let rule_id = required_text(&request.rule_id, "the rule a coupon set opens")?;
    if let (Some(from), Some(to)) = (request.valid_from, request.valid_to) {
        if to <= from {
            return Err(AppError::Validation(
                "a coupon set has to end after it starts".into(),
            ));
        }
    }
    for (label, value) in [
        ("max_redemptions", request.max_redemptions),
        ("max_per_customer", request.max_per_customer),
        ("code_max_uses", request.code_max_uses),
    ] {
        if value.is_some_and(|cap| cap <= 0) {
            return Err(AppError::Validation(format!(
                "{label} is a limit, so it has to be above zero — leave it out to mean no limit"
            )));
        }
    }
    if request.kind == CouponSetKind::Unique && request.code_max_uses.is_some() {
        return Err(AppError::Validation(
            "a UNIQUE set's codes are single-use by definition; code_max_uses is for a SHARED set"
                .into(),
        ));
    }
    let hold_seconds = request
        .hold_seconds
        .filter(|seconds| *seconds > 0)
        .unwrap_or(DEFAULT_HOLD_SECONDS as i32);
    if i64::from(hold_seconds) > MAX_HOLD_SECONDS {
        return Err(AppError::Validation(format!(
            "a hold lasts at most {MAX_HOLD_SECONDS} seconds, and this set asked for {hold_seconds}"
        )));
    }

    let coupon_set_id = Uuid::new_v4();
    let mut tx = pool.begin().await?;
    sqlx::query(
        "INSERT INTO coupon_set
             (coupon_set_id, set_code, name, rule_id, kind, valid_from, valid_to,
              max_redemptions, max_per_customer, hold_seconds, active, created_by, note)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true, $11, $12)",
    )
    .bind(coupon_set_id)
    .bind(&set_code)
    .bind(&name)
    .bind(&rule_id)
    .bind(request.kind.as_str())
    .bind(request.valid_from)
    .bind(request.valid_to)
    .bind(request.max_redemptions)
    .bind(request.max_per_customer)
    .bind(hold_seconds)
    .bind(actor)
    .bind(optional_text(request.note.as_deref()))
    .execute(&mut *tx)
    .await
    .map_err(map_coupon_write_error)?;

    if request.kind == CouponSetKind::Shared {
        sqlx::query(
            "INSERT INTO coupon_code
                 (coupon_code_id, coupon_set_id, code, state, max_uses, issued_by)
             VALUES ($1, $2, $3, 'ISSUED', $4, $5)",
        )
        .bind(Uuid::new_v4())
        .bind(coupon_set_id)
        .bind(&set_code)
        .bind(request.code_max_uses)
        .bind(actor)
        .execute(&mut *tx)
        .await
        .map_err(map_coupon_write_error)?;
    }

    let row = read_set_row(&mut tx, coupon_set_id).await?;
    tx.commit().await?;
    Ok(row)
}

async fn read_set_row(
    tx: &mut Transaction<'_, Postgres>,
    coupon_set_id: Uuid,
) -> Result<CouponSetRow, AppError> {
    let row = sqlx::query(&format!("{SET_ROW_SELECT} WHERE s.coupon_set_id = $1"))
        .bind(coupon_set_id)
        .fetch_optional(&mut **tx)
        .await?
        .ok_or_else(|| AppError::NotFound("Coupon set".to_owned()))?;
    set_row(&row)
}

/// The set, with its counts folded in.
///
/// The counts are subqueries rather than three left joins with a `GROUP BY`.
/// Joining a set to its codes and then to their redemptions multiplies the rows
/// before it counts them, and the shape that fixes that — `count(DISTINCT …)` —
/// is a sort per group on a list that a merchandiser refreshes all afternoon.
const SET_ROW_SELECT: &str = "
    SELECT s.coupon_set_id, s.set_code, s.name, s.rule_id, s.kind, s.valid_from,
           s.valid_to, s.max_redemptions, s.max_per_customer, s.hold_seconds,
           s.active, s.created_at, s.created_by, s.note,
           (SELECT count(*) FROM coupon_code c
             WHERE c.coupon_set_id = s.coupon_set_id) AS code_count,
           (SELECT count(*) FROM coupon_redemption r
              JOIN coupon_code c ON c.coupon_code_id = r.coupon_code_id
             WHERE c.coupon_set_id = s.coupon_set_id
               AND r.status <> 'CANCELLED') AS redeemed_count,
           (SELECT count(*) FROM coupon_authorization a
              JOIN coupon_code c ON c.coupon_code_id = a.coupon_code_id
             WHERE c.coupon_set_id = s.coupon_set_id
               AND a.status = 'AUTHORIZED' AND a.expires_at > now()) AS held_count,
           (SELECT COALESCE(sum(r.discount_minor), 0)::bigint FROM coupon_redemption r
              JOIN coupon_code c ON c.coupon_code_id = r.coupon_code_id
             WHERE c.coupon_set_id = s.coupon_set_id
               AND r.status <> 'CANCELLED') AS discount_minor
      FROM coupon_set s";

fn set_row(row: &sqlx::postgres::PgRow) -> Result<CouponSetRow, AppError> {
    let kind: String = row.try_get("kind")?;
    Ok(CouponSetRow {
        coupon_set_id: row.try_get("coupon_set_id")?,
        set_code: row.try_get("set_code")?,
        name: row.try_get("name")?,
        rule_id: row.try_get("rule_id")?,
        kind: CouponSetKind::from_str(&kind)?,
        valid_from: row.try_get("valid_from")?,
        valid_to: row.try_get("valid_to")?,
        max_redemptions: row.try_get("max_redemptions")?,
        max_per_customer: row.try_get("max_per_customer")?,
        hold_seconds: row.try_get("hold_seconds")?,
        active: row.try_get("active")?,
        created_at: row.try_get("created_at")?,
        created_by: row.try_get("created_by")?,
        note: row.try_get("note")?,
        code_count: row.try_get("code_count")?,
        redeemed_count: row.try_get("redeemed_count")?,
        held_count: row.try_get("held_count")?,
        discount_minor: row.try_get("discount_minor")?,
    })
}

pub async fn list_coupon_sets(pool: &PgPool) -> Result<Vec<CouponSetRow>, AppError> {
    let rows = sqlx::query(&format!("{SET_ROW_SELECT} ORDER BY s.created_at DESC"))
        .fetch_all(pool)
        .await?;
    rows.iter().map(set_row).collect()
}

pub async fn coupon_set_detail(pool: &PgPool, set_code: &str) -> Result<CouponSetRow, AppError> {
    let set_code = normalize_coupon_code(set_code)?;
    let row = sqlx::query(&format!("{SET_ROW_SELECT} WHERE s.set_code = $1"))
        .bind(&set_code)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound("Coupon set".to_owned()))?;
    set_row(&row)
}

/// Bulk-issue single-use codes for a UNIQUE set.
///
/// Refused for a SHARED set, and that refusal is the whole reason `kind` is a
/// column: minting a second code beside `LEBARAN10` produces a set where the
/// code on the poster is one of two things a shopper might type, and the second
/// one is nowhere.
pub async fn mint_coupon_codes(
    pool: &PgPool,
    set_code: &str,
    request: MintCouponsRequest,
    actor: &str,
) -> Result<MintedCoupons, AppError> {
    let set_code = normalize_coupon_code(set_code)?;

    // The named shoppers win over `count` when both are given: a mailing is a
    // list of people, and a count that disagreed with it would silently decide
    // which of them do not get a coupon.
    let customers: Vec<String> = request
        .customer_ids
        .iter()
        .filter_map(|id| optional_text(Some(id)))
        .collect();
    let wanted = if customers.is_empty() {
        request.count.unwrap_or(0)
    } else {
        customers.len() as i64
    };
    if wanted <= 0 {
        return Err(AppError::Validation(
            "a mint has to say how many codes to make, or name the shoppers to make them for"
                .into(),
        ));
    }
    if wanted > MAX_MINT {
        return Err(AppError::Validation(format!(
            "a mint makes at most {MAX_MINT} codes at a time, not {wanted}"
        )));
    }

    // Every code lands or none of them do, and a collision retries the WHOLE
    // batch rather than topping it up. A partial mint cannot be repaired by
    // adding the shortfall: the codes are aligned to the shoppers they were
    // made for, and nothing in `RETURNING` says WHICH of them failed — so a
    // top-up would give one shopper two codes and another none, silently, in a
    // mailing already on its way to the printer.
    //
    // The collision itself is 60 bits from a CSPRNG and does not happen. The
    // loop is here so that "does not happen" is not the same sentence as "is
    // not handled".
    let mut attempt = 0;
    loop {
        attempt += 1;
        let mut tx = pool.begin().await?;
        let set_id: Uuid =
            sqlx::query_scalar("SELECT coupon_set_id FROM coupon_set WHERE set_code = $1")
                .bind(&set_code)
                .fetch_optional(&mut *tx)
                .await?
                .ok_or_else(|| AppError::NotFound("Coupon set".to_owned()))?;
        let set = lock_set_by_id(&mut tx, set_id).await?;
        if set.kind == CouponSetKind::Shared {
            return Err(AppError::Validation(format!(
                "{} is a SHARED set: it has one code, which is the set code itself",
                set.set_code
            )));
        }

        let ids: Vec<Uuid> = (0..wanted).map(|_| Uuid::new_v4()).collect();
        let codes: Vec<String> = (0..wanted).map(|_| mint_coupon_code()).collect();
        // Aligned with the codes above, so the nth code belongs to the nth
        // shopper. Empty when the mint is for bearer codes, in which case every
        // entry is null and the array still has to be the same length — a
        // shorter one would make `unnest` drop rows, which is a mint that
        // quietly produces fewer codes than it was asked for.
        let owners: Vec<Option<String>> = (0..wanted as usize)
            .map(|index| customers.get(index).cloned())
            .collect();

        let outcome = sqlx::query(
            "INSERT INTO coupon_code
                 (coupon_code_id, coupon_set_id, code, state, max_uses, customer_id, issued_by)
             SELECT minted.id, $1, minted.code, 'ISSUED', 1, minted.owner, $5
               FROM unnest($2::uuid[], $3::text[], $4::text[]) AS minted(id, code, owner)",
        )
        .bind(set_id)
        .bind(&ids)
        .bind(&codes)
        .bind(&owners)
        .bind(actor)
        .execute(&mut *tx)
        .await;

        match outcome {
            Ok(_) => {
                tx.commit().await?;
                return Ok(MintedCoupons {
                    set_code,
                    minted: codes.len() as i64,
                    codes,
                });
            }
            Err(sqlx::Error::Database(database))
                if database.constraint() == Some("coupon_code_code_key") && attempt < 5 =>
            {
                // Rolled back by dropping `tx`; round again with fresh codes.
                continue;
            }
            Err(error) => return Err(map_coupon_write_error(error)),
        }
    }
}

const CODE_ROW_SELECT: &str = "
    SELECT c.coupon_code_id, c.code, s.set_code, c.state, c.max_uses, c.customer_id,
           c.issued_at, c.issued_by, c.cancelled_at, c.cancel_reason,
           (SELECT count(*) FROM coupon_redemption r
             WHERE r.coupon_code_id = c.coupon_code_id
               AND r.status <> 'CANCELLED') AS redeemed_count,
           (SELECT count(*) FROM coupon_authorization a
             WHERE a.coupon_code_id = c.coupon_code_id
               AND a.status = 'AUTHORIZED' AND a.expires_at > now()) AS held_count
      FROM coupon_code c
      JOIN coupon_set s ON s.coupon_set_id = c.coupon_set_id";

fn code_row(row: &sqlx::postgres::PgRow) -> Result<CouponCodeRow, AppError> {
    let state: String = row.try_get("state")?;
    Ok(CouponCodeRow {
        coupon_code_id: row.try_get("coupon_code_id")?,
        code: row.try_get("code")?,
        set_code: row.try_get("set_code")?,
        state: CouponState::from_str(&state)?,
        max_uses: row.try_get("max_uses")?,
        customer_id: row.try_get("customer_id")?,
        issued_at: row.try_get("issued_at")?,
        issued_by: row.try_get("issued_by")?,
        cancelled_at: row.try_get("cancelled_at")?,
        cancel_reason: row.try_get("cancel_reason")?,
        redeemed_count: row.try_get("redeemed_count")?,
        held_count: row.try_get("held_count")?,
    })
}

async fn read_code_row(
    tx: &mut Transaction<'_, Postgres>,
    code: &str,
) -> Result<CouponCodeRow, AppError> {
    let row = sqlx::query(&format!("{CODE_ROW_SELECT} WHERE c.code = $1"))
        .bind(code)
        .fetch_optional(&mut **tx)
        .await?
        .ok_or_else(|| AppError::NotFound("Coupon".to_owned()))?;
    code_row(&row)
}

/// One code, its set, and every redemption against it.
pub async fn coupon_code_detail(pool: &PgPool, code: &str) -> Result<CouponCodeDetail, AppError> {
    let code = normalize_coupon_code(code)?;
    let row = sqlx::query(&format!("{CODE_ROW_SELECT} WHERE c.code = $1"))
        .bind(&code)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound("Coupon".to_owned()))?;
    let code_row = code_row(&row)?;

    let set = sqlx::query(&format!("{SET_ROW_SELECT} WHERE s.set_code = $1"))
        .bind(&code_row.set_code)
        .fetch_one(pool)
        .await?;

    let redemptions = sqlx::query(
        "SELECT redemption_id, sale_id, checkout_id, customer_id, discount_minor,
                status, site_id, actor, redeemed_at, cancelled_at
           FROM coupon_redemption
          WHERE coupon_code_id = $1
          ORDER BY redeemed_at",
    )
    .bind(code_row.coupon_code_id)
    .fetch_all(pool)
    .await?;

    Ok(CouponCodeDetail {
        code: code_row,
        set: set_row(&set)?,
        redemptions: redemptions
            .iter()
            .map(|row| {
                Ok(CouponRedemptionRow {
                    redemption_id: row.try_get("redemption_id")?,
                    sale_id: row.try_get("sale_id")?,
                    checkout_id: row.try_get("checkout_id")?,
                    customer_id: row.try_get("customer_id")?,
                    discount_minor: row.try_get("discount_minor")?,
                    status: row.try_get("status")?,
                    site_id: row.try_get("site_id")?,
                    actor: row.try_get("actor")?,
                    redeemed_at: row.try_get("redeemed_at")?,
                    cancelled_at: row.try_get("cancelled_at")?,
                })
            })
            .collect::<Result<Vec<_>, AppError>>()?,
    })
}

// ---------------------------------------------------------------------------
// A price book's limited coupon, as a coupon set
//
// A coupon can be authored two ways. A coupon SET (`create_coupon_set`) is the
// thing this module is about. A price book can also carry a coupon of its own
// (`commercial_coupon`: HEMAT50 → rule-hemat50, `max_uses` 100), which reaches
// every till inside the publication. Uncapped, that needs nothing from here:
// the till's engine opens the rule on the code alone. CAPPED, it cannot be
// admitted from a till's snapshot at all — the count in it is as old as the
// last sync — so the engine refuses it until head office holds a use
// (`CouponNeedsOnlineAuthorization`), and the hold has to be held against a
// set. So a capped book coupon BECOMES a set: SHARED, its one code the book's
// code, `max_redemptions` the book's `max_uses`, the window and the active
// flag the book's. Made when the book is published, and — for a book published
// before this existed — the first time a till asks for the code.
//
// Counting starts at the set. A capped book coupon could never be redeemed
// before this (the engine refused it), so there are no earlier uses to carry
// over. The older `commercial_usage` counter goes on counting from sale facts
// as it always has; the set's redemptions are the count the cap is kept by.
// ---------------------------------------------------------------------------

/// Written on every set a price book made, so a later book can tell its own
/// sets from one a merchandiser authored by hand — and update only the first.
const BOOK_COUPON_NOTE: &str = "Made from a price book's limited coupon";

/// One capped coupon as a book declares it.
struct BookCoupon {
    code: String,
    rule_id: String,
    active: bool,
    customer_id: Option<String>,
    valid_from: Option<DateTime<Utc>>,
    valid_to: Option<DateTime<Utc>>,
    max_uses: i64,
}

/// Write `coupon` down as a SHARED set and its one code, idempotently.
///
/// `refresh` is for publishing: a newer book restating the coupon (a raised
/// cap, a longer window) restates the set — but only a set a book made. A set
/// somebody authored by hand under the same code is theirs, and is left alone.
/// A till asking does not refresh: the set a book made is already the newest
/// book's word.
///
/// Set first, code second — the order every path in this file locks them in.
async fn upsert_book_coupon_set(
    tx: &mut Transaction<'_, Postgres>,
    coupon: &BookCoupon,
    actor: &str,
    refresh: bool,
) -> Result<(), AppError> {
    let code = normalize_coupon_code(&coupon.code)?;
    // A window the set's own CHECK would refuse is dropped rather than failing
    // the whole publication over one coupon: the till's engine still reads the
    // book's window, and refuses outside it.
    let (valid_from, valid_to) = match (coupon.valid_from, coupon.valid_to) {
        (Some(from), Some(to)) if to <= from => (None, None),
        window => window,
    };
    let max_redemptions = Some(coupon.max_uses);
    let name = format!("Kupon {code}");
    let conflict = if refresh {
        "ON CONFLICT (set_code) DO UPDATE SET
             rule_id = excluded.rule_id, valid_from = excluded.valid_from,
             valid_to = excluded.valid_to, max_redemptions = excluded.max_redemptions,
             active = excluded.active
           WHERE coupon_set.note = excluded.note"
    } else {
        "ON CONFLICT (set_code) DO NOTHING"
    };
    sqlx::query(&format!(
        "INSERT INTO coupon_set
             (coupon_set_id, set_code, name, rule_id, kind, valid_from, valid_to,
              max_redemptions, max_per_customer, hold_seconds, active, created_by, note)
         VALUES ($1, $2, $3, $4, 'SHARED', $5, $6, $7, NULL, $8, $9, $10, $11)
         {conflict}"
    ))
    .bind(Uuid::new_v4())
    .bind(&code)
    .bind(&name)
    .bind(coupon.rule_id.trim())
    .bind(valid_from)
    .bind(valid_to)
    .bind(max_redemptions)
    .bind(DEFAULT_HOLD_SECONDS as i32)
    .bind(coupon.active)
    .bind(actor)
    .bind(BOOK_COUPON_NOTE)
    .execute(&mut **tx)
    .await
    .map_err(map_coupon_write_error)?;
    // Read back rather than trusting the id just generated: under a conflict
    // the set is the one already there.
    let coupon_set_id: Uuid =
        sqlx::query_scalar("SELECT coupon_set_id FROM coupon_set WHERE set_code = $1")
            .bind(&code)
            .fetch_one(&mut **tx)
            .await?;
    sqlx::query(
        "INSERT INTO coupon_code
             (coupon_code_id, coupon_set_id, code, state, max_uses, customer_id, issued_by)
         VALUES ($1, $2, $3, 'ISSUED', NULL, $4, $5)
         ON CONFLICT (code) DO NOTHING",
    )
    .bind(Uuid::new_v4())
    .bind(coupon_set_id)
    .bind(&code)
    .bind(optional_text(coupon.customer_id.as_deref()))
    .bind(actor)
    .execute(&mut **tx)
    .await
    .map_err(map_coupon_write_error)?;
    Ok(())
}

fn book_coupon(row: &sqlx::postgres::PgRow) -> Result<Option<BookCoupon>, AppError> {
    let max_uses: Option<i32> = row.try_get("max_uses")?;
    // A cap of nought is a coupon nobody can use; the till already says
    // "used up" for it, and a set cannot be capped at nothing.
    Ok(max_uses.filter(|max| *max > 0).map(|max_uses| BookCoupon {
        code: row.get("code"),
        rule_id: row.get("rule_id"),
        active: row.get("active"),
        customer_id: row.get("customer_id"),
        valid_from: row.get("valid_from"),
        valid_to: row.get("valid_to"),
        max_uses: i64::from(max_uses),
    }))
}

/// Make a set of every capped coupon in a book that is being published.
///
/// Inside the publishing transaction: the book and the sets its limited
/// coupons are held against exist together or not at all. A coupon whose code
/// cannot be a set code (too short, odd characters) is skipped with a warning
/// rather than failing the publication — the till's engine goes on refusing it
/// as needing authorization, which is what it did before sets existed.
pub async fn ensure_book_coupon_sets_for_publication(
    tx: &mut Transaction<'_, Postgres>,
    publication_id: Uuid,
    actor: &str,
) -> Result<(), AppError> {
    let rows = sqlx::query(
        "SELECT code, rule_id, active, customer_id, valid_from, valid_to, max_uses
           FROM commercial_coupon
          WHERE publication_id = $1 AND max_uses IS NOT NULL
          ORDER BY code",
    )
    .bind(publication_id)
    .fetch_all(&mut **tx)
    .await?;
    for row in &rows {
        let Some(coupon) = book_coupon(row)? else {
            continue;
        };
        if normalize_coupon_code(&coupon.code).is_err() {
            tracing::warn!(
                code = %coupon.code,
                "a limited coupon's code cannot name a coupon set, so no till can hold it"
            );
            continue;
        }
        upsert_book_coupon_set(tx, &coupon, actor, true).await?;
    }
    Ok(())
}

/// The lazy half: a code with no set yet, which a book in force does declare
/// as a limited coupon, becomes one now. A code with a set, or one no book
/// declares as limited, is left exactly as it is — the lock that follows
/// answers "no such coupon" for the second.
async fn ensure_book_coupon_set(
    tx: &mut Transaction<'_, Postgres>,
    code: &str,
    actor: &str,
) -> Result<(), AppError> {
    let exists: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM coupon_code WHERE code = $1)")
            .bind(code)
            .fetch_one(&mut **tx)
            .await?;
    if exists {
        return Ok(());
    }
    // The newest PUBLISHED declaration of the code wins, as it does for the
    // till's own snapshot (`pricing::load_coupons`). Matched on the same
    // normalisation a set code gets, so `hemat-50` in a book is `HEMAT50` here.
    let Some(row) = sqlx::query(
        "SELECT c.code, c.rule_id, c.active, c.customer_id, c.valid_from, c.valid_to,
                c.max_uses
           FROM commercial_coupon c
           JOIN commercial_publication p ON p.id = c.publication_id
          WHERE p.status = 'PUBLISHED'
            AND upper(regexp_replace(c.code, '[^A-Za-z0-9]', '', 'g')) = $1
          ORDER BY p.version DESC
          LIMIT 1",
    )
    .bind(code)
    .fetch_optional(&mut **tx)
    .await?
    else {
        return Ok(());
    };
    let Some(coupon) = book_coupon(&row)? else {
        // In force and uncapped: the till never needs to ask about it.
        return Ok(());
    };
    upsert_book_coupon_set(tx, &coupon, actor, false).await
}

// ---------------------------------------------------------------------------
// The hold, committed by the sale that used it
// ---------------------------------------------------------------------------

/// What became of one hold a sale fact named.
enum FactCommit {
    Committed,
    /// It was already this sale's — a redelivered fact.
    AlreadyCommitted,
    /// Not committed, and why. Written down, never raised.
    Skipped(String),
}

/// Turn the hold a sale's coupon carried into that sale's redemption, as the
/// sale fact is applied.
///
/// The voucher's `commit_voucher_hold_for_fact`, with one deliberate
/// difference: **this never fails the fact.** A sale fact that is refused
/// blocks every later fact from that shop until somebody repairs it by hand —
/// its takings, its stock, every member's points (bug B1 was exactly that). A
/// voucher is money and earns that severity; a coupon hold that lapsed or was
/// let go is a bookkeeping question about a discount already given on a real
/// receipt. So anything wrong — a hold never granted, released, committed to a
/// different sale, a database refusal — is recorded in
/// `coupon_hold_exception` and the fact goes on. The whole attempt sits inside
/// a SAVEPOINT, so even a constraint the database raises halfway is rolled
/// back to here rather than poisoning the sync transaction.
///
/// Idempotent: a redelivered fact finds the hold COMMITTED to this very sale
/// and writes nothing.
///
/// "Was the hold live?" is asked of the SALE's time, not the clock's. The shop
/// checked the hold when it rang the sale (`vouched_coupon_holds`), and a shop
/// whose line was down for an hour delivers the fact after the hold's fifteen
/// minutes are up — that is ordinary, and the use was taken while it was held.
#[allow(clippy::too_many_arguments)]
pub async fn commit_coupon_hold_for_fact(
    tx: &mut Transaction<'_, Postgres>,
    authorization_id: &str,
    sale_id: Uuid,
    occurred_at: DateTime<Utc>,
    coupon_code: Option<&str>,
    discount_minor: i64,
    sale_site_id: &str,
    actor: &str,
) -> Result<(), AppError> {
    sqlx::query("SAVEPOINT coupon_hold_commit")
        .execute(&mut **tx)
        .await?;
    let attempt = commit_fact_hold(
        tx,
        authorization_id,
        sale_id,
        occurred_at,
        coupon_code,
        discount_minor,
        sale_site_id,
        actor,
    )
    .await;
    let problem = match attempt {
        Ok(FactCommit::Committed) | Ok(FactCommit::AlreadyCommitted) => None,
        Ok(FactCommit::Skipped(why)) => Some(why),
        Err(error) => Some(error.to_string()),
    };
    match &problem {
        None => {
            sqlx::query("RELEASE SAVEPOINT coupon_hold_commit")
                .execute(&mut **tx)
                .await?;
        }
        Some(_) => {
            sqlx::query("ROLLBACK TO SAVEPOINT coupon_hold_commit")
                .execute(&mut **tx)
                .await?;
            sqlx::query("RELEASE SAVEPOINT coupon_hold_commit")
                .execute(&mut **tx)
                .await?;
        }
    }
    if let Some(problem) = problem {
        tracing::warn!(
            %sale_id,
            authorization_id,
            problem = %problem,
            "a sale's coupon hold could not be committed; recorded, sync goes on"
        );
        sqlx::query(
            "INSERT INTO coupon_hold_exception
                 (sale_id, authorization_id, coupon_code, site_id, discount_minor, problem)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (sale_id, authorization_id) DO NOTHING",
        )
        .bind(sale_id)
        .bind(authorization_id.trim())
        .bind(coupon_code.map(str::trim))
        .bind(sale_site_id.trim())
        .bind(discount_minor.max(0))
        .bind(&problem)
        .execute(&mut **tx)
        .await?;
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
async fn commit_fact_hold(
    tx: &mut Transaction<'_, Postgres>,
    authorization_id: &str,
    sale_id: Uuid,
    occurred_at: DateTime<Utc>,
    coupon_code: Option<&str>,
    discount_minor: i64,
    sale_site_id: &str,
    actor: &str,
) -> Result<FactCommit, AppError> {
    let Ok(authorization_id) = Uuid::parse_str(authorization_id.trim()) else {
        return Ok(FactCommit::Skipped(format!(
            "the sale names a malformed coupon hold id {authorization_id:?}"
        )));
    };
    // Unlocked, to learn which set and code to lock — in the order every other
    // path takes them: set, then code, then the hold.
    let Some(parents) = sqlx::query(
        "SELECT c.coupon_set_id, c.coupon_code_id
           FROM coupon_authorization a
           JOIN coupon_code c ON c.coupon_code_id = a.coupon_code_id
          WHERE a.authorization_id = $1",
    )
    .bind(authorization_id)
    .fetch_optional(&mut **tx)
    .await?
    else {
        return Ok(FactCommit::Skipped(
            "the sale names a coupon hold head office never granted".into(),
        ));
    };
    let coupon_set_id: Uuid = parents.try_get("coupon_set_id")?;
    let coupon_code_id: Uuid = parents.try_get("coupon_code_id")?;
    lock_set_by_id(tx, coupon_set_id).await?;
    let code_row = sqlx::query(
        "SELECT code, state, max_uses FROM coupon_code WHERE coupon_code_id = $1 FOR UPDATE",
    )
    .bind(coupon_code_id)
    .fetch_one(&mut **tx)
    .await?;
    let code: String = code_row.try_get("code")?;
    let state: String = code_row.try_get("state")?;
    let state = CouponState::from_str(&state)?;
    let max_uses: Option<i64> = code_row.try_get("max_uses")?;
    if let Some(named) = coupon_code {
        if normalize_coupon_code(named).ok().as_deref() != Some(code.as_str()) {
            return Ok(FactCommit::Skipped(format!(
                "the sale names coupon {named:?}, but its hold belongs to {code}"
            )));
        }
    }

    let hold = sqlx::query(
        "SELECT status, expires_at, customer_id, site_id, checkout_id, redemption_id
           FROM coupon_authorization WHERE authorization_id = $1 FOR UPDATE",
    )
    .bind(authorization_id)
    .fetch_one(&mut **tx)
    .await?;
    let status: String = hold.try_get("status")?;
    let expires_at: DateTime<Utc> = hold.try_get("expires_at")?;
    let customer_id: Option<String> = hold.try_get("customer_id")?;
    let site_id: Option<String> = hold.try_get("site_id")?;
    let checkout_id: String = hold.try_get("checkout_id")?;
    let redemption_id: Option<Uuid> = hold.try_get("redemption_id")?;

    if status == "COMMITTED" {
        let committed_sale: Option<Uuid> = match redemption_id {
            Some(id) => {
                sqlx::query_scalar("SELECT sale_id FROM coupon_redemption WHERE redemption_id = $1")
                    .bind(id)
                    .fetch_optional(&mut **tx)
                    .await?
            }
            None => None,
        };
        if committed_sale == Some(sale_id) {
            return Ok(FactCommit::AlreadyCommitted);
        }
        return Ok(FactCommit::Skipped(format!(
            "that coupon hold was already committed to sale {committed_sale:?}"
        )));
    }
    if status != "AUTHORIZED" {
        return Ok(FactCommit::Skipped(format!(
            "that coupon hold was {status} before the sale reached head office"
        )));
    }
    if occurred_at >= expires_at {
        return Ok(FactCommit::Skipped(format!(
            "the sale was rung at {occurred_at}, after its coupon hold lapsed at {expires_at}"
        )));
    }
    let sale_site_id = sale_site_id.trim();
    if site_id
        .as_deref()
        .is_some_and(|held_for| held_for != sale_site_id)
    {
        return Ok(FactCommit::Skipped(format!(
            "the sale came from {sale_site_id:?}, but its coupon hold was granted to {site_id:?}"
        )));
    }

    let redemption_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO coupon_redemption
             (redemption_id, coupon_code_id, sale_id, checkout_id, customer_id,
              discount_minor, status, site_id, actor)
         VALUES ($1, $2, $3, $4, $5, $6, 'REDEEMED', $7, $8)",
    )
    .bind(redemption_id)
    .bind(coupon_code_id)
    .bind(sale_id)
    .bind(&checkout_id)
    .bind(&customer_id)
    .bind(discount_minor.max(0))
    .bind(sale_site_id)
    .bind(actor)
    .execute(&mut **tx)
    .await
    .map_err(map_coupon_write_error)?;
    sqlx::query(
        "UPDATE coupon_authorization
            SET status = 'COMMITTED', settled_at = now(), redemption_id = $2
          WHERE authorization_id = $1",
    )
    .bind(authorization_id)
    .bind(redemption_id)
    .execute(&mut **tx)
    .await
    .map_err(map_coupon_write_error)?;
    resettle_state(tx, coupon_code_id, state, max_uses).await?;
    Ok(FactCommit::Committed)
}

/// Hold a use of a code, or hand back the hold this checkout already has.
///
/// Idempotent by `(coupon_code_id, checkout_id)` rather than by an idempotency
/// header, for the reason `0162` gives: a till asking twice for the same basket
/// means the same question however many times the network ate the answer. A
/// header key makes a RETRY safe; this makes the QUESTION safe.
pub async fn authorize_coupon(
    pool: &PgPool,
    code: &str,
    request: AuthorizeCouponRequest,
) -> Result<Value, AppError> {
    let code = normalize_coupon_code(code)?;
    let checkout_id = required_text(&request.checkout_id, "a hold's basket")?;
    let actor = required_text(&request.actor_id, "a hold's operator")?;
    let customer_id = optional_text(request.customer_id.as_deref());

    let mut tx = pool.begin().await?;
    // A limited coupon published in a price book (HEMAT50, `max_uses` 100) is a
    // coupon set the moment a till first asks for it, if publishing did not
    // already make it one — a book published before books made their sets.
    ensure_book_coupon_set(&mut tx, &code, &actor).await?;
    let (set, held_code) = lock_set_then_code(&mut tx, &code).await?;

    // The hold this basket already has, if it asked before. Returned unchanged
    // rather than renewed: a retry is the same question, and extending the
    // expiry every time a flaky till repeats itself is a hold that never lapses.
    if let Some(row) = sqlx::query(
        "SELECT authorization_id, status, expires_at
           FROM coupon_authorization
          WHERE coupon_code_id = $1 AND checkout_id = $2",
    )
    .bind(held_code.coupon_code_id)
    .bind(&checkout_id)
    .fetch_optional(&mut *tx)
    .await?
    {
        let status: String = row.try_get("status")?;
        if status == "AUTHORIZED" {
            let authorization_id: Uuid = row.try_get("authorization_id")?;
            let until: DateTime<Utc> = row.try_get("expires_at")?;
            tx.commit().await?;
            return Ok(json!({
                "authorization_id": authorization_id,
                "code": code,
                "set_code": set.set_code,
                "status": "AUTHORIZED",
                "expires_at": until,
                "replayed": true,
            }));
        }
        return Err(AppError::Conflict(format!(
            "this basket already has a {status} hold on that coupon"
        )));
    }

    let counts = count_against_caps(
        &mut tx,
        set.coupon_set_id,
        held_code.coupon_code_id,
        customer_id.as_deref(),
    )
    .await?;

    // The invariant, inside the lock.
    let admission = CouponAdmission {
        state: held_code.state,
        set_active: set.active,
        valid_from: set.valid_from,
        valid_to: set.valid_to,
        code: CouponCapacity {
            cap: held_code.max_uses,
            redemptions: counts.code_redemptions,
            open_holds: counts.code_holds,
        },
        set: CouponCapacity {
            cap: set.max_redemptions,
            redemptions: counts.set_redemptions,
            open_holds: counts.set_holds,
        },
        per_customer: set.max_per_customer.map(|cap| CouponCapacity {
            cap: Some(cap),
            redemptions: counts.customer_redemptions,
            open_holds: counts.customer_holds,
        }),
        minted_to: held_code.customer_id.as_deref(),
        presenter: customer_id.as_deref(),
    };
    if let Err(refusal) = admit_coupon(&admission, Utc::now()) {
        return Err(AppError::Conflict(format!(
            "{} ({})",
            refusal.describe(),
            refusal.as_str()
        )));
    }

    let seconds = request
        .hold_seconds
        .filter(|value| *value > 0)
        .unwrap_or(i64::from(set.hold_seconds));
    if seconds > MAX_HOLD_SECONDS {
        return Err(AppError::Validation(format!(
            "a hold lasts at most {MAX_HOLD_SECONDS} seconds, and this one asked for {seconds}"
        )));
    }
    let until = Utc::now() + chrono::Duration::seconds(seconds);
    let authorization_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO coupon_authorization
             (authorization_id, coupon_code_id, checkout_id, customer_id, status,
              site_id, actor, expires_at)
         VALUES ($1, $2, $3, $4, 'AUTHORIZED', $5, $6, $7)",
    )
    .bind(authorization_id)
    .bind(held_code.coupon_code_id)
    .bind(&checkout_id)
    .bind(&customer_id)
    .bind(optional_text(request.site_id.as_deref()))
    .bind(&actor)
    .bind(until)
    .execute(&mut *tx)
    .await
    .map_err(map_coupon_write_error)?;

    let state = resettle_state(
        &mut tx,
        held_code.coupon_code_id,
        held_code.state,
        held_code.max_uses,
    )
    .await?;
    tx.commit().await?;

    Ok(json!({
        "authorization_id": authorization_id,
        "code": code,
        "set_code": set.set_code,
        "rule_id": set.rule_id,
        "status": "AUTHORIZED",
        "state": state.as_str(),
        "expires_at": until,
        "replayed": false,
    }))
}

/// Turn a hold into a redemption, because the sale landed.
///
/// Replaying returns the same answer rather than counting twice: a hold that is
/// already COMMITTED is reported as committed and nothing is written.
pub async fn commit_coupon_hold(
    pool: &PgPool,
    code: &str,
    request: CommitCouponRequest,
) -> Result<Value, AppError> {
    let code = normalize_coupon_code(code)?;
    let checkout_id = required_text(&request.checkout_id, "a commit's basket")?;
    let actor = required_text(&request.actor_id, "a commit's operator")?;
    if request.discount_minor < 0 {
        return Err(AppError::Validation(
            "a coupon takes money off, so what it took cannot be negative".into(),
        ));
    }

    let mut tx = pool.begin().await?;
    let (set, held_code) = lock_set_then_code(&mut tx, &code).await?;

    let row = sqlx::query(
        "SELECT authorization_id, status, expires_at, customer_id, site_id, redemption_id
           FROM coupon_authorization
          WHERE coupon_code_id = $1 AND checkout_id = $2
          FOR UPDATE",
    )
    .bind(held_code.coupon_code_id)
    .bind(&checkout_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| {
        AppError::Conflict(
            "that basket holds nothing against this coupon — authorize before committing".into(),
        )
    })?;

    let status: String = row.try_get("status")?;
    let authorization_id: Uuid = row.try_get("authorization_id")?;
    // The shopper comes from the HOLD and not from this request. They are the
    // one the per-customer cap was measured against when the use was reserved;
    // letting the commit name somebody else would book the redemption to a
    // shopper whose allowance was never checked.
    let customer_id: Option<String> = row.try_get("customer_id")?;
    let site_id: Option<String> = row.try_get("site_id")?;

    if status == "COMMITTED" {
        let redemption_id: Option<Uuid> = row.try_get("redemption_id")?;
        tx.commit().await?;
        return Ok(json!({
            "code": code,
            "checkout_id": checkout_id,
            "status": "COMMITTED",
            "redemption_id": redemption_id,
            "replayed": true,
        }));
    }
    if status != "AUTHORIZED" {
        return Err(AppError::Conflict(format!(
            "that hold was {status} and cannot be committed"
        )));
    }
    // An expired hold is refused loudly rather than quietly honoured: the use it
    // was reserving has been available to other tills since it lapsed, and
    // committing it now is exactly the double spend the hold existed to stop.
    // Reconciling a sale that really did land is the checkout state machine's
    // job, not a clock's.
    let until: DateTime<Utc> = row.try_get("expires_at")?;
    if until <= Utc::now() {
        return Err(AppError::Conflict(
            "that hold expired before the sale landed — re-authorize against what is left".into(),
        ));
    }

    let redemption_id = Uuid::new_v4();
    sqlx::query(
        // `single_use` is deliberately not named: `0170`'s trigger fills it from
        // the code, so no writer here can get it wrong and quietly opt a
        // single-use code out of the unique index that keeps it single-use.
        "INSERT INTO coupon_redemption
             (redemption_id, coupon_code_id, sale_id, checkout_id, customer_id,
              discount_minor, status, site_id, actor)
         VALUES ($1, $2, $3, $4, $5, $6, 'REDEEMED', $7, $8)",
    )
    .bind(redemption_id)
    .bind(held_code.coupon_code_id)
    .bind(request.sale_id)
    .bind(&checkout_id)
    .bind(&customer_id)
    .bind(request.discount_minor)
    .bind(&site_id)
    .bind(&actor)
    .execute(&mut *tx)
    .await
    .map_err(map_coupon_write_error)?;

    sqlx::query(
        "UPDATE coupon_authorization
            SET status = 'COMMITTED', settled_at = now(), redemption_id = $2
          WHERE authorization_id = $1",
    )
    .bind(authorization_id)
    .bind(redemption_id)
    .execute(&mut *tx)
    .await
    .map_err(map_coupon_write_error)?;

    let state = resettle_state(
        &mut tx,
        held_code.coupon_code_id,
        held_code.state,
        held_code.max_uses,
    )
    .await?;
    tx.commit().await?;

    Ok(json!({
        "code": code,
        "set_code": set.set_code,
        "checkout_id": checkout_id,
        "status": "COMMITTED",
        "state": state.as_str(),
        "redemption_id": redemption_id,
        "sale_id": request.sale_id,
        "discount_minor": request.discount_minor,
        "replayed": false,
    }))
}

/// Give the held use back, because the checkout did not become a sale.
///
/// Releasing a hold that is already RELEASED is a success and not an error: a
/// till abandoning a basket twice means the basket is abandoned.
pub async fn release_coupon_hold(
    pool: &PgPool,
    code: &str,
    request: ReleaseCouponRequest,
) -> Result<Value, AppError> {
    let code = normalize_coupon_code(code)?;
    let checkout_id = required_text(&request.checkout_id, "a release's basket")?;
    required_text(&request.actor_id, "a release's operator")?;

    let mut tx = pool.begin().await?;
    let (set, held_code) = lock_set_then_code(&mut tx, &code).await?;

    let released = sqlx::query(
        "UPDATE coupon_authorization
            SET status = 'RELEASED', settled_at = now()
          WHERE coupon_code_id = $1 AND checkout_id = $2 AND status = 'AUTHORIZED'",
    )
    .bind(held_code.coupon_code_id)
    .bind(&checkout_id)
    .execute(&mut *tx)
    .await
    .map_err(map_coupon_write_error)?
    .rows_affected();

    let current: Option<String> = sqlx::query_scalar(
        "SELECT status FROM coupon_authorization
          WHERE coupon_code_id = $1 AND checkout_id = $2",
    )
    .bind(held_code.coupon_code_id)
    .bind(&checkout_id)
    .fetch_optional(&mut *tx)
    .await?;

    // A committed hold is NOT released. The sale happened; the use is spent.
    if current.as_deref() == Some("COMMITTED") {
        return Err(AppError::Conflict(
            "that hold was already committed to a sale and cannot be released".into(),
        ));
    }

    let state = resettle_state(
        &mut tx,
        held_code.coupon_code_id,
        held_code.state,
        held_code.max_uses,
    )
    .await?;
    tx.commit().await?;

    Ok(json!({
        "code": code,
        "set_code": set.set_code,
        "checkout_id": checkout_id,
        "released": released,
        "state": state.as_str(),
        "status": current.unwrap_or_else(|| "RELEASED".to_string()),
    }))
}

/// Stop a code, and let go of anything anybody was holding against it.
///
/// The only way CANCELLED is ever written. A leaked code that a merchandiser
/// cannot stop is a promotion running on somebody else's terms, and for a
/// SHARED set this is also how the whole promotion is stopped — its one code is
/// the promotion.
///
/// Open holds are RELEASED rather than left alone. A till that is mid-basket
/// will be refused at commit either way, and a hold left AUTHORIZED against a
/// dead code goes on counting against a cap nobody can spend, until the clock
/// gets to it.
///
/// Redemptions already taken are NOT touched. Those sales happened, the goods
/// left at that price, and rewriting them here would make the books disagree
/// with the receipts.
pub async fn cancel_coupon_code(
    pool: &PgPool,
    code: &str,
    request: CancelCouponRequest,
    actor: &str,
) -> Result<CouponCodeRow, AppError> {
    let code = normalize_coupon_code(code)?;
    let reason = required_text(&request.reason, "a cancellation's reason")?;

    let mut tx = pool.begin().await?;
    let (_set, held_code) = lock_set_then_code(&mut tx, &code).await?;
    if held_code.state == CouponState::Cancelled {
        // Stopping a stopped code is a success, not a conflict: somebody
        // clicking twice means the code should be stopped, which it is.
        let row = read_code_row(&mut tx, &code).await?;
        tx.commit().await?;
        return Ok(row);
    }

    sqlx::query(
        "UPDATE coupon_authorization
            SET status = 'RELEASED', settled_at = now()
          WHERE coupon_code_id = $1 AND status = 'AUTHORIZED'",
    )
    .bind(held_code.coupon_code_id)
    .execute(&mut *tx)
    .await
    .map_err(map_coupon_write_error)?;

    sqlx::query(
        "UPDATE coupon_code
            SET state = 'CANCELLED', cancelled_at = now(), cancel_reason = $2
          WHERE coupon_code_id = $1",
    )
    .bind(held_code.coupon_code_id)
    .bind(format!("{reason} ({actor})"))
    .execute(&mut *tx)
    .await
    .map_err(map_coupon_write_error)?;

    let row = read_code_row(&mut tx, &code).await?;
    tx.commit().await?;
    Ok(row)
}

/// Mark lapsed holds and lapsed codes for what they are.
///
/// Nothing here changes a decision. A hold past its expiry already stopped
/// counting against availability the moment the clock passed it — see
/// `count_against_caps` — and a code past its set's window is already refused by
/// [`admit_coupon`], which measures the dates itself. This only writes down what
/// was already true, so that a merchandiser looking at ten thousand minted codes
/// can see which ones lapsed without the list computing it per row.
///
/// Which is why it is safe to run, safe not to run, and safe to run twice.
pub async fn expire_lapsed_coupons(pool: &PgPool) -> Result<Value, AppError> {
    let mut tx = pool.begin().await?;
    let holds = sqlx::query(
        "UPDATE coupon_authorization
            SET status = 'EXPIRED', settled_at = now()
          WHERE status = 'AUTHORIZED' AND expires_at <= now()",
    )
    .execute(&mut *tx)
    .await
    .map_err(map_coupon_write_error)?
    .rows_affected();

    // CANCELLED is left alone: it is a decision somebody took, and a clock does
    // not get to overwrite it with a weaker statement. REDEEMED is left alone
    // for the same reason in reverse — a code that was spent did not lapse.
    let codes = sqlx::query(
        "UPDATE coupon_code c
            SET state = 'EXPIRED'
           FROM coupon_set s
          WHERE s.coupon_set_id = c.coupon_set_id
            AND s.valid_to IS NOT NULL AND s.valid_to <= now()
            AND c.state IN ('ISSUED', 'RESERVED')",
    )
    .execute(&mut *tx)
    .await
    .map_err(map_coupon_write_error)?
    .rows_affected();
    tx.commit().await?;

    Ok(json!({ "holds_expired": holds, "codes_expired": codes }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn moment(hour: u32) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(&format!("2026-09-12T{hour:02}:00:00Z"))
            .unwrap_or_else(|error| panic!("a fixed timestamp has to parse: {error}"))
            .with_timezone(&Utc)
    }

    fn free(cap: Option<i64>) -> CouponCapacity {
        CouponCapacity {
            cap,
            redemptions: 0,
            open_holds: 0,
        }
    }

    fn open_admission<'a>() -> CouponAdmission<'a> {
        CouponAdmission {
            state: CouponState::Issued,
            set_active: true,
            valid_from: None,
            valid_to: None,
            code: free(Some(1)),
            set: free(None),
            per_customer: None,
            minted_to: None,
            presenter: None,
        }
    }

    /// The arithmetic the whole module exists to get right, on its own.
    #[test]
    fn what_is_available_is_the_cap_less_what_is_spent_and_what_is_held() {
        let capacity = CouponCapacity {
            cap: Some(10),
            redemptions: 4,
            open_holds: 3,
        };
        assert_eq!(capacity.available(), Some(3));
        assert!(capacity.admits_one());
    }

    /// The case a plain "have we reached the cap" check gets wrong: nothing is
    /// redeemed, so a count-only test passes, and the last use is in a basket
    /// at another till.
    #[test]
    fn a_use_held_by_another_checkout_is_not_available_to_this_one() {
        let capacity = CouponCapacity {
            cap: Some(1),
            redemptions: 0,
            open_holds: 1,
        };
        assert_eq!(capacity.available(), Some(0));
        assert!(!capacity.admits_one());
    }

    #[test]
    fn a_cap_of_none_is_no_limit_and_not_a_limit_of_zero() {
        let capacity = CouponCapacity {
            cap: None,
            redemptions: 9_999,
            open_holds: 12,
        };
        assert_eq!(capacity.available(), None);
        assert!(capacity.admits_one());
    }

    /// A cap lowered after the codes went out leaves a negative remainder.
    #[test]
    fn a_cap_lowered_below_what_was_already_spent_reports_nothing_free() {
        let capacity = CouponCapacity {
            cap: Some(5),
            redemptions: 9,
            open_holds: 0,
        };
        assert_eq!(capacity.available(), Some(0));
        assert!(!capacity.admits_one());
    }

    #[test]
    fn a_unique_code_cannot_be_redeemed_twice() {
        let mut admission = open_admission();
        admission.code = CouponCapacity {
            cap: Some(1),
            redemptions: 1,
            open_holds: 0,
        };
        assert_eq!(
            admit_coupon(&admission, moment(10)),
            Err(CouponRefusal::CodeUsedUp)
        );
    }

    #[test]
    fn a_shared_code_can_be_redeemed_up_to_its_cap_and_not_past_it() {
        let mut admission = open_admission();
        admission.code = CouponCapacity {
            cap: Some(500),
            redemptions: 499,
            open_holds: 0,
        };
        assert_eq!(admit_coupon(&admission, moment(10)), Ok(()));
        admission.code.redemptions = 500;
        assert_eq!(
            admit_coupon(&admission, moment(10)),
            Err(CouponRefusal::CodeUsedUp)
        );
    }

    /// The reason the set row is locked as well as the code row: a mailing's
    /// codes each have room and the set does not.
    #[test]
    fn a_set_that_has_given_away_its_budget_refuses_a_code_that_is_still_fresh() {
        let mut admission = open_admission();
        admission.code = free(Some(1));
        admission.set = CouponCapacity {
            cap: Some(500),
            redemptions: 500,
            open_holds: 0,
        };
        assert_eq!(
            admit_coupon(&admission, moment(10)),
            Err(CouponRefusal::SetExhausted)
        );
    }

    #[test]
    fn a_shopper_who_has_had_their_allowance_is_refused_while_the_set_still_has_room() {
        let mut admission = open_admission();
        admission.presenter = Some("cust-1");
        admission.set = free(Some(500));
        admission.per_customer = Some(CouponCapacity {
            cap: Some(1),
            redemptions: 1,
            open_holds: 0,
        });
        assert_eq!(
            admit_coupon(&admission, moment(10)),
            Err(CouponRefusal::CustomerLimitReached)
        );
    }

    /// A per-customer cap that stops applying when nobody is identified is not
    /// a cap, and this is the arm that says so.
    #[test]
    fn a_per_customer_cap_refuses_a_basket_with_nobody_in_it() {
        let mut admission = open_admission();
        admission.presenter = None;
        admission.per_customer = Some(free(Some(1)));
        assert_eq!(
            admit_coupon(&admission, moment(10)),
            Err(CouponRefusal::CustomerUnknown)
        );
    }

    #[test]
    fn a_code_minted_to_one_shopper_is_refused_to_anybody_else_including_nobody() {
        let mut admission = open_admission();
        admission.minted_to = Some("cust-1");
        admission.presenter = Some("cust-2");
        assert_eq!(
            admit_coupon(&admission, moment(10)),
            Err(CouponRefusal::BelongsToSomeoneElse)
        );
        admission.presenter = None;
        assert_eq!(
            admit_coupon(&admission, moment(10)),
            Err(CouponRefusal::BelongsToSomeoneElse)
        );
        admission.presenter = Some("cust-1");
        assert_eq!(admit_coupon(&admission, moment(10)), Ok(()));
    }

    /// The window is measured, and the stored state is not consulted. A sweep
    /// that has not run yet must not make a lapsed coupon work.
    #[test]
    fn a_code_past_its_window_is_refused_even_though_the_sweep_has_not_run() {
        let mut admission = open_admission();
        admission.state = CouponState::Issued;
        admission.valid_to = Some(moment(9));
        assert_eq!(
            admit_coupon(&admission, moment(10)),
            Err(CouponRefusal::Expired)
        );
    }

    /// And the reverse: a code the sweep marked EXPIRED, whose window a
    /// merchandiser then extended, works again. The dates are the rule.
    #[test]
    fn a_swept_code_whose_window_was_extended_is_admitted_again() {
        let mut admission = open_admission();
        admission.state = CouponState::Expired;
        admission.valid_to = Some(moment(23));
        assert_eq!(admit_coupon(&admission, moment(10)), Ok(()));
    }

    #[test]
    fn a_code_that_has_not_started_says_so_rather_than_saying_it_is_unknown() {
        let mut admission = open_admission();
        admission.valid_from = Some(moment(14));
        assert_eq!(
            admit_coupon(&admission, moment(10)),
            Err(CouponRefusal::NotStarted)
        );
    }

    #[test]
    fn a_cancelled_code_is_refused_before_anything_else_is_looked_at() {
        let mut admission = open_admission();
        admission.state = CouponState::Cancelled;
        // Everything else about it is fine, which is the point: the refusal
        // names the decision somebody took rather than a consequence of it.
        assert_eq!(
            admit_coupon(&admission, moment(10)),
            Err(CouponRefusal::Cancelled)
        );
    }

    #[test]
    fn a_set_switched_off_shuts_every_code_in_it() {
        let mut admission = open_admission();
        admission.set_active = false;
        assert_eq!(
            admit_coupon(&admission, moment(10)),
            Err(CouponRefusal::SetNotActive)
        );
    }

    // ---- the state machine ------------------------------------------------

    #[test]
    fn a_hold_moves_a_code_to_reserved_and_a_release_moves_it_back() {
        assert_eq!(
            settled_coupon_state(CouponState::Issued, 0, 1, Some(1)),
            CouponState::Reserved
        );
        assert_eq!(
            settled_coupon_state(CouponState::Reserved, 0, 0, Some(1)),
            CouponState::Issued
        );
    }

    #[test]
    fn a_code_becomes_redeemed_only_when_its_uses_are_gone() {
        assert_eq!(
            settled_coupon_state(CouponState::Reserved, 1, 0, Some(1)),
            CouponState::Redeemed
        );
        assert_eq!(
            settled_coupon_state(CouponState::Issued, 499, 0, Some(500)),
            CouponState::Issued
        );
        assert_eq!(
            settled_coupon_state(CouponState::Issued, 500, 0, Some(500)),
            CouponState::Redeemed
        );
    }

    /// An uncapped shared code is never used up, however often it is presented.
    #[test]
    fn an_uncapped_code_never_reaches_redeemed() {
        assert_eq!(
            settled_coupon_state(CouponState::Issued, 10_000, 0, None),
            CouponState::Issued
        );
    }

    /// CANCELLED is a decision; a recount does not get to undo it. Without this
    /// arm, a stopped code that still had an open hold would come back as
    /// RESERVED the next time anything touched it.
    #[test]
    fn a_cancelled_code_stays_cancelled_however_the_counts_come_out() {
        assert_eq!(
            settled_coupon_state(CouponState::Cancelled, 0, 1, Some(5)),
            CouponState::Cancelled
        );
        assert_eq!(
            settled_coupon_state(CouponState::Cancelled, 5, 0, Some(5)),
            CouponState::Cancelled
        );
    }

    /// EXPIRED is not terminal, and deliberately: extending a set's window
    /// un-lapses its codes, and the next thing that touches one should say so.
    #[test]
    fn an_expired_code_is_recounted_rather_than_frozen() {
        assert_eq!(
            settled_coupon_state(CouponState::Expired, 0, 0, Some(1)),
            CouponState::Issued
        );
    }

    /// The vocabulary a cashier hears is the engine's own wherever the engine
    /// has a name for the case. If somebody re-words one of these, this test
    /// says the two places have parted company.
    #[test]
    fn the_refusals_speak_the_words_the_pricing_engine_already_uses() {
        assert_eq!(
            CouponRefusal::CodeUsedUp.describe(),
            RejectionReason::CouponUsedUp.describe()
        );
        assert_eq!(
            CouponRefusal::BelongsToSomeoneElse.describe(),
            RejectionReason::CouponBelongsToSomeoneElse.describe()
        );
        assert_eq!(
            CouponRefusal::SetExhausted.describe(),
            RejectionReason::UsageExhausted.describe()
        );
    }
}
