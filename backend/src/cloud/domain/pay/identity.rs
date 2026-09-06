//! What payroll needs to pay somebody that is not the amount.
//!
//! # Masked on the way out, whole on the way in
//!
//! A bank account number is the most sensitive field this module holds. The
//! screen that exists to check an account is right needs the **last four
//! digits**, not the number — somebody reading their own card can confirm four
//! digits, and nobody else needs the rest. So the record stores it whole,
//! because a payment file needs it whole, and [`BankAccount::masked`] is what a
//! view is built from.
//!
//! # Recorded, never applied
//!
//! [`PtkpStatus`] is the marital-and-dependants code PPh 21 brackets turn on.
//! It is recorded because a payslip has to say which one applied; the bracket
//! it selects is statutory arithmetic and is not computed anywhere in this
//! backend.

use super::error::PayError;
use crate::cloud::domain::employment::Authorization;
use chrono::NaiveDate;
use serde::{Deserialize, Serialize};

/// Marital status and dependants, as PPh 21 codes them: `TK/0` … `K/3`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct PtkpStatus {
    married: bool,
    dependants: u8,
}

impl PtkpStatus {
    /// Three dependants is the statutory ceiling — a fourth child does not
    /// raise the allowance — so a fourth is a data-entry error rather than a
    /// bigger number.
    pub fn try_new(married: bool, dependants: u8) -> Result<Self, PayError> {
        if dependants > 3 {
            return Err(PayError::UnknownPtkp {
                value: format!("{dependants} dependants"),
            });
        }
        Ok(Self {
            married,
            dependants,
        })
    }

    pub fn parse(raw: &str) -> Result<Self, PayError> {
        let (prefix, count) = raw
            .trim()
            .split_once('/')
            .ok_or_else(|| PayError::UnknownPtkp {
                value: raw.to_owned(),
            })?;
        let married = match prefix.to_uppercase().as_str() {
            "TK" => false,
            "K" => true,
            _ => {
                return Err(PayError::UnknownPtkp {
                    value: raw.to_owned(),
                })
            }
        };
        Self::try_new(
            married,
            count.trim().parse().map_err(|_| PayError::UnknownPtkp {
                value: raw.to_owned(),
            })?,
        )
    }

    pub const fn married(self) -> bool {
        self.married
    }
    pub const fn dependants(self) -> u8 {
        self.dependants
    }
}

impl std::fmt::Display for PtkpStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "{}/{}",
            if self.married { "K" } else { "TK" },
            self.dependants
        )
    }
}

impl From<PtkpStatus> for String {
    fn from(value: PtkpStatus) -> Self {
        value.to_string()
    }
}

impl TryFrom<String> for PtkpStatus {
    type Error = PayError;
    fn try_from(value: String) -> Result<Self, Self::Error> {
        Self::parse(&value)
    }
}

/// Where the money goes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "BankAccountWire")]
pub struct BankAccount {
    bank: String,
    number: String,
    holder: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BankAccountWire {
    pub bank: String,
    pub number: String,
    pub holder: String,
}

impl TryFrom<BankAccountWire> for BankAccount {
    type Error = PayError;
    fn try_from(wire: BankAccountWire) -> Result<Self, Self::Error> {
        Self::try_new(&wire.bank, &wire.number, &wire.holder)
    }
}

impl BankAccount {
    /// An account number with no bank and no holder is three ways of being
    /// unable to pay somebody, so all three are required together.
    ///
    /// The holder's name matters as much as the number: Indonesian transfers
    /// are rejected on a name mismatch, and a payroll file that fails at the
    /// bank fails for everybody in it.
    pub fn try_new(bank: &str, number: &str, holder: &str) -> Result<Self, PayError> {
        let bank = bank.trim();
        let number = number.trim();
        let holder = holder.trim();
        if bank.is_empty() {
            return Err(PayError::MalformedIdentity { field: "bank" });
        }
        if holder.is_empty() {
            return Err(PayError::MalformedIdentity {
                field: "account holder",
            });
        }
        if number.is_empty() || !number.chars().all(|character| character.is_ascii_digit()) {
            return Err(PayError::MalformedIdentity {
                field: "account number",
            });
        }
        Ok(Self {
            bank: bank.to_owned(),
            number: number.to_owned(),
            holder: holder.to_owned(),
        })
    }

    pub fn bank(&self) -> &str {
        &self.bank
    }
    /// The number in full. Only a payment file should ever ask.
    pub fn number(&self) -> &str {
        &self.number
    }
    pub fn holder(&self) -> &str {
        &self.holder
    }

    /// The last four digits, behind dots.
    ///
    /// What a screen shows. Somebody checking their own account confirms four
    /// digits; nobody else needs the rest, and a directory that carried whole
    /// account numbers is a directory worth stealing.
    pub fn masked(&self) -> String {
        let digits: Vec<char> = self.number.chars().collect();
        if digits.len() <= 4 {
            return "•".repeat(digits.len());
        }
        let tail: String = digits[digits.len() - 4..].iter().collect();
        format!("{}{tail}", "•".repeat(digits.len() - 4))
    }
}

/// What one amendment changed.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "field", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum IdentityChange {
    BankAccount { account: BankAccount },
    Npwp { npwp: String },
    Ptkp { ptkp: PtkpStatus },
    BpjsKesehatan { number: String },
    BpjsKetenagakerjaan { number: String },
}

impl IdentityChange {
    pub const fn field(&self) -> &'static str {
        match self {
            Self::BankAccount { .. } => "bank_account",
            Self::Npwp { .. } => "npwp",
            Self::Ptkp { .. } => "ptkp",
            Self::BpjsKesehatan { .. } => "bpjs_kesehatan",
            Self::BpjsKetenagakerjaan { .. } => "bpjs_ketenagakerjaan",
        }
    }
}

/// One recorded change, with the authority behind it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct IdentityAmendment {
    change: IdentityChange,
    effective_from: NaiveDate,
    authorization: Authorization,
}

impl IdentityAmendment {
    pub const fn change(&self) -> &IdentityChange {
        &self.change
    }
    pub const fn effective_from(&self) -> NaiveDate {
        self.effective_from
    }
    pub const fn authorization(&self) -> &Authorization {
        &self.authorization
    }
}

/// One person's payroll identity, as a fold over its amendments.
///
/// The same guarantee `Profile` gives over personal data: the amendments are
/// the authority, and a record whose current values they do not produce fails
/// to load rather than becoming the answer.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct PayrollIdentity {
    bank_account: Option<BankAccount>,
    npwp: Option<String>,
    ptkp: Option<PtkpStatus>,
    bpjs_kesehatan: Option<String>,
    bpjs_ketenagakerjaan: Option<String>,
    amendments: Vec<IdentityAmendment>,
}

impl PayrollIdentity {
    pub fn empty() -> Self {
        Self::default()
    }

    /// Rebuild by replaying the amendments.
    pub fn replay(amendments: Vec<IdentityAmendment>) -> Result<Self, PayError> {
        let mut identity = Self::empty();
        for amendment in amendments {
            identity.apply(amendment)?;
        }
        Ok(identity)
    }

    /// Change one field, recording who and why.
    ///
    /// One field per amendment, because two at once would be two changes
    /// recorded as one and the trail would say less than it appears to.
    pub fn amend(
        &mut self,
        change: IdentityChange,
        effective_from: NaiveDate,
        authorization: Authorization,
    ) -> Result<(), PayError> {
        if !authorization.authorizes_pay_change() {
            return Err(PayError::ActionForbidsPayChange {
                action_key: authorization.action_key().to_owned(),
            });
        }
        self.apply(IdentityAmendment {
            change,
            effective_from,
            authorization,
        })
    }

    fn apply(&mut self, amendment: IdentityAmendment) -> Result<(), PayError> {
        if !amendment.authorization.authorizes_pay_change() {
            return Err(PayError::ActionForbidsPayChange {
                action_key: amendment.authorization.action_key().to_owned(),
            });
        }
        match &amendment.change {
            IdentityChange::BankAccount { account } => {
                self.bank_account = Some(account.clone());
            }
            IdentityChange::Npwp { npwp } => self.npwp = Some(npwp.clone()),
            IdentityChange::Ptkp { ptkp } => self.ptkp = Some(*ptkp),
            IdentityChange::BpjsKesehatan { number } => {
                self.bpjs_kesehatan = Some(number.clone());
            }
            IdentityChange::BpjsKetenagakerjaan { number } => {
                self.bpjs_ketenagakerjaan = Some(number.clone());
            }
        }
        self.amendments.push(amendment);
        Ok(())
    }

    pub const fn bank_account(&self) -> Option<&BankAccount> {
        self.bank_account.as_ref()
    }
    pub fn npwp(&self) -> Option<&str> {
        self.npwp.as_deref()
    }
    pub const fn ptkp(&self) -> Option<PtkpStatus> {
        self.ptkp
    }
    pub fn bpjs_kesehatan(&self) -> Option<&str> {
        self.bpjs_kesehatan.as_deref()
    }
    pub fn bpjs_ketenagakerjaan(&self) -> Option<&str> {
        self.bpjs_ketenagakerjaan.as_deref()
    }
    pub fn amendments(&self) -> &[IdentityAmendment] {
        &self.amendments
    }

    /// Whether somebody can actually be paid.
    ///
    /// Asked before a run is verified, because a payroll file that fails at the
    /// bank fails for everybody in it.
    pub const fn payable(&self) -> bool {
        self.bank_account.is_some()
    }
}
