use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CountKind {
    Full,
    Cycle,
    Targeted,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CountStatus {
    Draft,
    Active,
    Review,
    Closed,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CountClassification {
    Match,
    Shortage,
    Gain,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct CountComparison {
    pub expected: i64,
    pub found: i64,
    pub classification: CountClassification,
    pub difference: i64,
}

pub fn compare_count(expected: i64, found: i64) -> CountComparison {
    let (classification, difference) = if found == expected {
        (CountClassification::Match, 0)
    } else if found < expected {
        (CountClassification::Shortage, expected - found)
    } else {
        (CountClassification::Gain, found - expected)
    };
    CountComparison {
        expected,
        found,
        classification,
        difference,
    }
}

#[derive(Debug, Error, Eq, PartialEq)]
pub enum CountError {
    #[error("invalid count lifecycle transition: {0:?} -> {1:?}")]
    InvalidTransition(CountStatus, CountStatus),
}

pub fn validate_count_transition(from: CountStatus, to: CountStatus) -> Result<(), CountError> {
    if matches!(
        (from, to),
        (CountStatus::Draft, CountStatus::Active)
            | (CountStatus::Active, CountStatus::Review)
            | (CountStatus::Review, CountStatus::Closed)
    ) {
        Ok(())
    } else {
        Err(CountError::InvalidTransition(from, to))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn official_count_compares_expected_and_found() {
        assert_eq!(
            compare_count(100, 97),
            CountComparison {
                expected: 100,
                found: 97,
                classification: CountClassification::Shortage,
                difference: 3
            }
        );
        assert_eq!(
            compare_count(4, 6).classification,
            CountClassification::Gain
        );
    }
}
