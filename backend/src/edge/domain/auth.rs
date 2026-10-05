//! The role ladder, kept pure so it holds on any node and any storage engine.
//!
//! Roles form a strict ladder — CASHIER < SUPERVISOR < ADMIN — because a POS
//! floor has exactly these three trust levels: the person selling, the person
//! who can move or destroy stock and approve exceptions, and the person who
//! administers the node itself.
//!
//! **What this module does NOT do is decide what a request needs.** It used to:
//! `required_role(method, path)` mapped a request to a rung, and it had no
//! caller — every node decides per handler from an [`EdgePermission`], which is
//! the only gate that also knows what the handler is about. The two disagreed:
//! the path table said a store's outbound pick was a supervisor's mutation
//! while the handler required `DcOperate` (a cashier's), and a reader could
//! believe either. The dead copy is gone rather than reconciled, because a
//! second answer to "who may do this" is the thing that made it wrong.
//!
//! [`EdgePermission`]: crate::edge::EdgePermission

use serde::{Deserialize, Serialize};
use std::{fmt, str::FromStr};
use thiserror::Error;

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Role {
    Cashier,
    Supervisor,
    Admin,
}

impl Role {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Cashier => "CASHIER",
            Self::Supervisor => "SUPERVISOR",
            Self::Admin => "ADMIN",
        }
    }
}

impl fmt::Display for Role {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl FromStr for Role {
    type Err = AuthError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "CASHIER" => Ok(Self::Cashier),
            "SUPERVISOR" => Ok(Self::Supervisor),
            "ADMIN" => Ok(Self::Admin),
            _ => Err(AuthError::UnknownRole(value.to_owned())),
        }
    }
}

#[derive(Debug, Error, Eq, PartialEq)]
pub enum AuthError {
    #[error("unknown role: {0}")]
    UnknownRole(String),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roles_form_a_strict_ladder() {
        assert!(Role::Cashier < Role::Supervisor);
        assert!(Role::Supervisor < Role::Admin);
    }

    #[test]
    fn a_role_round_trips_through_its_spelling() {
        for role in [Role::Cashier, Role::Supervisor, Role::Admin] {
            assert_eq!(role.as_str().parse::<Role>(), Ok(role));
        }
        assert_eq!(
            "MANAGER".parse::<Role>(),
            Err(AuthError::UnknownRole("MANAGER".into()))
        );
    }
}
