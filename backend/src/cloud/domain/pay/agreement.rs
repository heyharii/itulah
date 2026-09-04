//! Base pay and fixed allowances, as an effective-dated history.
//!
//! # A salary is a history, not a number
//!
//! The obvious schema is a `base_salary` column on the employee row. It is
//! wrong in a way that only shows up months later: a raise in March
//! **overwrites** the figure February was paid from, so February's payslip can
//! no longer be recomputed, an audit cannot check it, and a correction to
//! February silently uses March's rate.
//!
//! Here pay is a [`PayTimeline`] of effective-dated [`PayRecord`]s, and the only
//! way to ask about money is to ask *as of a date* ([`PayTimeline::on`]). There
//! is no setter and no "current salary" field, so the wrong question has no
//! method to call.
//!
//! # Why fixed allowances live here and variable ones do not
//!
//! Indonesian pay is conventionally split into *gaji pokok* plus *tunjangan
//! tetap* — position, housing, and the rest of the standing lines — and
//! *tunjangan tidak tetap*, the variable half tied to attendance. The split is
//! not cosmetic: statutory bases are defined against it. Overtime under
//! Kepmenaker 102/2004 is computed on base plus fixed allowances, and the same
//! boundary matters for THR and several BPJS bases.
//!
//! So the fixed half is part of the record — a standing agreement,
//! effective-dated exactly like base pay. The variable half is **not here at
//! all**: it is a function of days actually worked, and storing it as a standing
//! figure is how somebody is paid a meal allowance for a month they were never
//! in.
//!
//! # What this module will not do
//!
//! Compute anything statutory. [`PayRecord::statutory_base`] returns base plus
//! fixed allowances because that sum is a *fact about the agreement*; which
//! statutory rule multiplies it by what is not recorded here and not computed
//! here.

use super::error::PayError;
use crate::cloud::domain::employment::Authorization;
use chrono::NaiveDate;
use pricing_engine::Money;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

pub const MAX_ALLOWANCE_CODE_LEN: usize = 40;

/// What a standing allowance is called.
///
/// Keyed by code rather than an enum, because an organisation's allowance
/// vocabulary is its own — and a closed enum would mean a code change and a
/// deploy every time HR invents a line item.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct AllowanceCode(String);

impl AllowanceCode {
    pub fn try_new(raw: &str) -> Result<Self, PayError> {
        let trimmed = raw.trim();
        if trimmed.is_empty()
            || trimmed.chars().any(char::is_control)
            || trimmed.chars().count() > MAX_ALLOWANCE_CODE_LEN
        {
            return Err(PayError::InvalidId {
                field: "allowance code",
            });
        }
        Ok(Self(trimmed.to_uppercase()))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl TryFrom<String> for AllowanceCode {
    type Error = PayError;
    fn try_from(value: String) -> Result<Self, Self::Error> {
        Self::try_new(&value)
    }
}

impl From<AllowanceCode> for String {
    fn from(value: AllowanceCode) -> Self {
        value.0
    }
}

impl std::fmt::Display for AllowanceCode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

/// One standing allowance: what it is called, and what it is worth per month.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FixedAllowance {
    code: AllowanceCode,
    amount: Money,
}

impl FixedAllowance {
    /// Refuses a non-positive amount.
    ///
    /// Zero as well as negative: an allowance worth nothing is either a mistake
    /// or a removal, and a removal is expressed by leaving the line out of the
    /// next record — visibly — rather than by carrying a zero forward that
    /// nobody reads.
    pub fn try_new(code: AllowanceCode, amount: Money) -> Result<Self, PayError> {
        if amount.minor <= 0 {
            return Err(PayError::AllowanceNotPositive {
                code: code.to_string(),
            });
        }
        Ok(Self { code, amount })
    }

    pub fn code(&self) -> &AllowanceCode {
        &self.code
    }
    pub const fn amount(&self) -> Money {
        self.amount
    }
}

/// The stored shape, so a record re-runs its own constructor.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PayRecordWire {
    pub effective_from: NaiveDate,
    pub base: Money,
    #[serde(default)]
    pub fixed_allowances: Vec<FixedAllowance>,
    pub authorization: Authorization,
}

/// What a person is paid, from one date until the next record supersedes it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PayRecord {
    effective_from: NaiveDate,
    base: Money,
    // A map in memory, so two lines cannot share a code — which would make "the
    // housing allowance" an ambiguous question and the sum quietly wrong. On
    // the wire it is a list, matching the shim: a record that serialized to a
    // shape its own decoder rejects could not round-trip.
    #[serde(serialize_with = "allowances_as_list")]
    fixed_allowances: BTreeMap<AllowanceCode, Money>,
    authorization: Authorization,
}

fn allowances_as_list<S>(
    allowances: &BTreeMap<AllowanceCode, Money>,
    serializer: S,
) -> Result<S::Ok, S::Error>
where
    S: serde::Serializer,
{
    use serde::ser::SerializeSeq;
    let mut seq = serializer.serialize_seq(Some(allowances.len()))?;
    for (code, amount) in allowances {
        seq.serialize_element(&FixedAllowance {
            code: code.clone(),
            amount: *amount,
        })?;
    }
    seq.end()
}

impl<'de> Deserialize<'de> for PayRecord {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let wire = PayRecordWire::deserialize(deserializer)?;
        Self::try_new(
            wire.effective_from,
            wire.base,
            wire.fixed_allowances,
            wire.authorization,
        )
        .map_err(serde::de::Error::custom)
    }
}

impl PayRecord {
    /// Refuses a non-positive base, a repeated allowance code, an allowance
    /// worth nothing, and an authority that may not set pay.
    pub fn try_new(
        effective_from: NaiveDate,
        base: Money,
        fixed_allowances: Vec<FixedAllowance>,
        authorization: Authorization,
    ) -> Result<Self, PayError> {
        if !authorization.authorizes_pay_change() {
            return Err(PayError::ActionForbidsPayChange {
                action_key: authorization.action_key().to_owned(),
            });
        }
        if base.minor <= 0 {
            return Err(PayError::BaseNotPositive);
        }
        let mut map = BTreeMap::new();
        for allowance in fixed_allowances {
            if map
                .insert(allowance.code.clone(), allowance.amount)
                .is_some()
            {
                return Err(PayError::DuplicateAllowance {
                    code: allowance.code.to_string(),
                });
            }
        }
        // The sum has to exist before this record does. A pay agreement whose
        // total overflows is not a pay agreement, and discovering it inside a
        // payroll run is discovering it too late.
        total(base, &map)?;
        Ok(Self {
            effective_from,
            base,
            fixed_allowances: map,
            authorization,
        })
    }

    pub const fn effective_from(&self) -> NaiveDate {
        self.effective_from
    }
    /// Gaji pokok.
    pub const fn base(&self) -> Money {
        self.base
    }
    pub fn allowance(&self, code: &AllowanceCode) -> Option<Money> {
        self.fixed_allowances.get(code).copied()
    }
    pub fn allowances(&self) -> impl Iterator<Item = (&AllowanceCode, Money)> {
        self.fixed_allowances.iter().map(|(code, amount)| (code, *amount))
    }
    pub const fn authorization(&self) -> &Authorization {
        &self.authorization
    }

    /// Base plus every fixed allowance.
    ///
    /// The sum Indonesian statutory rules are conventionally computed against.
    /// This module supplies the figure and applies no rule to it.
    pub fn statutory_base(&self) -> Money {
        // Cannot overflow: the constructor already proved this sum exists.
        total(self.base, &self.fixed_allowances).unwrap_or(self.base)
    }
}

fn total(base: Money, allowances: &BTreeMap<AllowanceCode, Money>) -> Result<Money, PayError> {
    let mut sum = base;
    for amount in allowances.values() {
        sum = sum
            .minor
            .checked_add(amount.minor)
            .map(Money::new)
            .ok_or(PayError::PayOverflow)?;
    }
    Ok(sum)
}

/// One person's pay, over time.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(transparent)]
pub struct PayTimeline {
    records: Vec<PayRecord>,
}

impl<'de> Deserialize<'de> for PayTimeline {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let records = Vec::<PayRecord>::deserialize(deserializer)?;
        Self::try_new(records).map_err(serde::de::Error::custom)
    }
}

impl PayTimeline {
    /// A person with no pay record yet is a real state — a candidate whose
    /// offer has not been agreed — and it answers `None` rather than zero.
    pub fn new() -> Self {
        Self::default()
    }

    pub fn try_new(records: Vec<PayRecord>) -> Result<Self, PayError> {
        let mut timeline = Self::new();
        for record in records {
            timeline.append(record)?;
        }
        Ok(timeline)
    }

    /// Record a new agreement, effective from its own date.
    ///
    /// # Backdating is refused, and that is the point
    ///
    /// A record must be strictly later than every record already held.
    /// Inserting one *behind* the latest would change what an already-closed
    /// month was owed — the same defect that makes a mutable salary column
    /// unusable, arriving through a different door.
    ///
    /// A genuine backdated raise is still payable: it is paid as a *rapel* in a
    /// current period, which is visible on the payslip, rather than by
    /// rewriting what a closed month said.
    pub fn append(&mut self, record: PayRecord) -> Result<(), PayError> {
        if let Some(last) = self.records.last() {
            if record.effective_from <= last.effective_from {
                return Err(PayError::PayNotForward {
                    effective_from: record.effective_from,
                    latest: last.effective_from,
                });
            }
        }
        self.records.push(record);
        Ok(())
    }

    pub fn records(&self) -> &[PayRecord] {
        &self.records
    }

    /// What the person was on, on a date.
    ///
    /// `None` before the first record: there was no agreement yet, which is not
    /// the same as an agreement worth zero.
    pub fn on(&self, date: NaiveDate) -> Option<&PayRecord> {
        self.records
            .iter()
            .rev()
            .find(|record| record.effective_from <= date)
    }

    /// The latest record, whenever it takes effect.
    ///
    /// Not "the current salary": a record dated next month is the latest and is
    /// not yet in force. [`PayTimeline::on`] is what somebody is paid.
    pub fn latest(&self) -> Option<&PayRecord> {
        self.records.last()
    }

    pub fn is_empty(&self) -> bool {
        self.records.is_empty()
    }
}
