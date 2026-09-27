//! The catalogue of claim types.
//!
//! A vocabulary the whole company files under, head office's to define — the
//! `LeaveType` shape with the money dimension the claims module exists for:
//! the code is also the `employee_expense` qualifier the approval posting
//! carries, which is why a type is retired and never deleted. Every line ever
//! filed under it names a code that must still resolve, and every map row
//! minted for it must still say where its debits go.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use super::error::ClaimError;

pub const MAX_CODE_LEN: usize = 40;
pub const MAX_NAME_LEN: usize = 140;

fn validated(field: &'static str, raw: &str, max: usize) -> Result<String, ClaimError> {
    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed.chars().any(char::is_control) || trimmed.chars().count() > max
    {
        return Err(ClaimError::InvalidId { field });
    }
    Ok(trimmed.to_owned())
}

/// One claim type, by its code.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct ClaimTypeCode(String);

impl ClaimTypeCode {
    /// Uppercased on the way in, so `travel` and `TRAVEL` are one type rather
    /// than two that separately run out — and one qualifier on the map rather
    /// than two.
    pub fn try_new(raw: &str) -> Result<Self, ClaimError> {
        validated("claim_type_code", raw, MAX_CODE_LEN).map(|code| Self(code.to_uppercase()))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl TryFrom<String> for ClaimTypeCode {
    type Error = ClaimError;
    fn try_from(value: String) -> Result<Self, Self::Error> {
        Self::try_new(&value)
    }
}

impl From<ClaimTypeCode> for String {
    fn from(value: ClaimTypeCode) -> Self {
        value.0
    }
}

impl std::fmt::Display for ClaimTypeCode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

/// One entry of the catalogue.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ClaimType {
    code: ClaimTypeCode,
    name: String,
    retired_at: Option<DateTime<Utc>>,
    created_at: DateTime<Utc>,
}

impl ClaimType {
    pub fn try_new(
        code: ClaimTypeCode,
        name: &str,
        created_at: DateTime<Utc>,
    ) -> Result<Self, ClaimError> {
        let name = validated("claim_type_name", name, MAX_NAME_LEN)?;
        Ok(Self {
            code,
            name,
            retired_at: None,
            created_at,
        })
    }

    /// The stored shape, so decoding re-runs the rules. A type cannot be
    /// rebuilt retired and retired at once nothing — retirement arrives
    /// through [`ClaimType::retire`] and is dated by the server.
    pub fn try_from_parts(
        code: ClaimTypeCode,
        name: String,
        retired_at: Option<DateTime<Utc>>,
        created_at: DateTime<Utc>,
    ) -> Result<Self, ClaimError> {
        let name = validated("claim_type_name", &name, MAX_NAME_LEN)?;
        Ok(Self {
            code,
            name,
            retired_at,
            created_at,
        })
    }

    /// Retire, never delete: every line filed under this code keeps naming a
    /// type that exists, and every map row minted for it keeps saying where
    /// its debits go.
    pub fn retire(&mut self, at: DateTime<Utc>) {
        self.retired_at = Some(at);
    }

    pub fn code(&self) -> &ClaimTypeCode {
        &self.code
    }
    pub fn name(&self) -> &str {
        &self.name
    }
    pub fn retired_at(&self) -> Option<DateTime<Utc>> {
        self.retired_at
    }
    pub fn created_at(&self) -> DateTime<Utc> {
        self.created_at
    }
    pub fn is_retired(&self) -> bool {
        self.retired_at.is_some()
    }
}

/// Every type the company has defined, retired ones included — a claim filed
/// under a type last year still reads back with its name.
#[derive(Debug, Clone, Default)]
pub struct ClaimTypeCatalogue {
    types: Vec<ClaimType>,
}

impl ClaimTypeCatalogue {
    pub fn try_new(types: Vec<ClaimType>) -> Result<Self, ClaimError> {
        let mut seen: Vec<ClaimTypeCode> = Vec::new();
        for claim_type in &types {
            if seen.contains(claim_type.code()) {
                return Err(ClaimError::DuplicateClaimType {
                    code: claim_type.code().to_string(),
                });
            }
            seen.push(claim_type.code().clone());
        }
        Ok(Self { types })
    }

    pub fn define(&mut self, claim_type: ClaimType) -> Result<(), ClaimError> {
        if self.types.iter().any(|t| t.code() == claim_type.code()) {
            return Err(ClaimError::DuplicateClaimType {
                code: claim_type.code().to_string(),
            });
        }
        self.types.push(claim_type);
        Ok(())
    }

    pub fn require(&self, code: &ClaimTypeCode) -> Result<&ClaimType, ClaimError> {
        self.types
            .iter()
            .find(|t| t.code() == code)
            .ok_or_else(|| ClaimError::UnknownClaimType {
                code: code.to_string(),
            })
    }

    /// The type a new line may name. Retired ones stay readable and refuse
    /// new claims — the catalogue's whole retirement discipline in one gate.
    pub fn require_active(&self, code: &ClaimTypeCode) -> Result<&ClaimType, ClaimError> {
        let claim_type = self.require(code)?;
        if let Some(retired_at) = claim_type.retired_at() {
            let retired_on = retired_at.date_naive();
            return Err(ClaimError::ClaimTypeRetired {
                code: code.to_string(),
                retired_at: retired_on,
            });
        }
        Ok(claim_type)
    }

    pub fn types(&self) -> &[ClaimType] {
        &self.types
    }
}
