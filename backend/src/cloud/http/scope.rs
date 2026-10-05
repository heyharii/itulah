//! Which units a request may touch — resolved once, enforced in one place.
//!
//! # Why this module exists
//!
//! Two gates run in the middleware for every request: the rung
//! (`domain::auth::required_role`) and the section (`job_role::section_gate`).
//! Both answer *what* a caller may do. Neither answers *where*, and until this
//! module the "where" was asked by hand: the HR routes and the store-money
//! routes each resolved a [`Reach`] and each wrote their own "is this unit
//! mine" and "bound this list to my unit". The finance routes wrote nothing,
//! so a store supervisor holding `finance` could read any unit's general
//! ledger by putting `?unit=` on the address — or every unit's, by leaving it
//! off.
//!
//! [`Scope`] is the one answer, and the routes that carry a unit or a site ask
//! it rather than re-spelling it. It is ERPNext's User Permission in this
//! codebase's terms: a caller's reach is resolved from their job role (0700)
//! and their posting (`employment::reach_of`), and every list is cut to it and
//! every write refused outside it, by the same four functions.
//!
//! # The four questions
//!
//! * [`Scope::require_unit`] / [`Scope::require_site`] — may the caller act on
//!   this one record? For writes, and for reads of one thing.
//! * [`Scope::units`] / [`Scope::sites`] — the filter a list query may use.
//!   An empty request is *not* "no filter" for a bounded caller: it becomes
//!   their own unit (or their unit's sites), because "I did not say which" from
//!   a store supervisor means "mine", never "everybody's".
//!
//! `Reach::Nowhere` — a login with no posting and no company-wide role — is
//! refused by all four. We do not know whose records are theirs, and the safe
//! reading of an unanswered question is "none".
//!
//! # As an extractor
//!
//! A handler takes `scope: Scope` beside `State` and `Extension<Principal>`;
//! axum resolves it from the principal the auth middleware put on the request.
//! One query per request that asks, none for the requests that do not.

use super::auth::Principal;
use crate::cloud::{
    application::{AppError, AppState},
    domain::Reach,
    postgres as infrastructure,
};
use axum::{extract::FromRequestParts, http::request::Parts};

/// A caller's reach over units, for one request.
#[derive(Clone, Debug)]
pub struct Scope {
    reach: Reach,
    username: String,
}

impl Scope {
    /// Resolve the caller's scope: their job role's `unit_reach`, their
    /// posting, and — for a call a store's node relayed — that node's unit.
    pub async fn of(state: &AppState, principal: &Principal) -> Result<Self, AppError> {
        Ok(Self {
            reach: super::employment::reach_of(state, principal).await?,
            username: principal.username.clone(),
        })
    }

    /// A scope that reaches every unit, for the jobs the server runs on its
    /// own behalf. Never built from a request.
    pub fn everywhere(actor: &str) -> Self {
        Self {
            reach: Reach::Everywhere,
            username: actor.to_owned(),
        }
    }

    pub fn reach(&self) -> &Reach {
        &self.reach
    }

    /// Does this scope reach every unit — so a list needs no filter at all?
    pub fn is_everywhere(&self) -> bool {
        matches!(self.reach, Reach::Everywhere)
    }

    fn nowhere(&self) -> AppError {
        AppError::Forbidden(format!(
            "{} has no posting and no role that reaches a unit, so there is no unit whose \
             records it may see. Ask HR to post this login, or give it a role that works \
             across units",
            self.username
        ))
    }

    fn outside(&self, what: &str) -> AppError {
        AppError::Forbidden(format!("{} does not reach {what}", self.username))
    }

    /// May the caller act on a record that belongs to this unit?
    pub fn require_unit(&self, unit_id: &str) -> Result<(), AppError> {
        match &self.reach {
            Reach::Everywhere => Ok(()),
            Reach::Nowhere => Err(self.nowhere()),
            Reach::Only(mine) if mine.as_str() == unit_id => Ok(()),
            Reach::Only(_) => Err(self.outside(unit_id)),
        }
    }

    /// May the caller act on a record that happened at this site? The site is
    /// judged by the unit that owns it (`site.unit_id`, 0600).
    pub async fn require_site(&self, state: &AppState, site_id: &str) -> Result<(), AppError> {
        match &self.reach {
            Reach::Everywhere => Ok(()),
            Reach::Nowhere => Err(self.nowhere()),
            Reach::Only(mine) => {
                let unit = infrastructure::sites::unit_of_site(&state.db, site_id).await?;
                if unit == mine.as_str() {
                    Ok(())
                } else {
                    Err(self.outside(site_id))
                }
            }
        }
    }

    /// The units a list may be filtered to, from the ones the request named.
    ///
    /// Unbounded: exactly what was asked (empty means every unit). Bounded to
    /// one unit: that unit when nothing was asked, the request itself when it
    /// named only that unit, and a refusal naming the first unit it may not
    /// read otherwise — never a silent narrowing, which would show a total
    /// that is not the one the person asked for.
    pub fn units(&self, asked: Vec<String>) -> Result<Vec<String>, AppError> {
        match &self.reach {
            Reach::Everywhere => Ok(asked),
            Reach::Nowhere => Err(self.nowhere()),
            Reach::Only(mine) => {
                if let Some(other) = asked.iter().find(|unit| unit.as_str() != mine.as_str()) {
                    return Err(self.outside(other));
                }
                Ok(vec![mine.as_str().to_owned()])
            }
        }
    }

    /// [`Scope::units`] for a route that takes at most one unit.
    pub fn unit(&self, asked: Option<String>) -> Result<Option<String>, AppError> {
        match &self.reach {
            Reach::Everywhere => Ok(asked),
            _ => Ok(self.units(asked.into_iter().collect())?.into_iter().next()),
        }
    }

    /// The sites a list may be filtered to, from the ones the request named.
    ///
    /// The same rule as [`Scope::units`], with a unit's sites standing for the
    /// unit. A bounded caller whose unit holds no site yet is refused rather
    /// than handed an empty filter, because an empty filter means "every site".
    pub async fn sites(
        &self,
        state: &AppState,
        asked: Vec<String>,
    ) -> Result<Vec<String>, AppError> {
        match &self.reach {
            Reach::Everywhere => Ok(asked),
            Reach::Nowhere => Err(self.nowhere()),
            Reach::Only(mine) => {
                let own = infrastructure::sites::sites_of_unit(&state.db, mine.as_str()).await?;
                if own.is_empty() {
                    return Err(AppError::Forbidden(format!(
                        "{} reaches {}, which has no site yet, so there is nothing of a site's \
                         it may read",
                        self.username,
                        mine.as_str()
                    )));
                }
                if asked.is_empty() {
                    return Ok(own);
                }
                if let Some(other) = asked.iter().find(|site| !own.contains(site)) {
                    return Err(self.outside(other));
                }
                Ok(asked)
            }
        }
    }

    /// [`Scope::sites`] for a route that takes at most one site. A bounded
    /// caller who named none gets `None` back only when their unit has exactly
    /// one site to stand for it; otherwise they must say which.
    pub async fn site(
        &self,
        state: &AppState,
        asked: Option<String>,
    ) -> Result<Option<String>, AppError> {
        if self.is_everywhere() {
            return Ok(asked);
        }
        let sites = self.sites(state, asked.into_iter().collect()).await?;
        match sites.as_slice() {
            [one] => Ok(Some(one.clone())),
            _ => Err(AppError::Validation(
                "name the site: this login's unit has more than one".into(),
            )),
        }
    }
}

impl FromRequestParts<AppState> for Scope {
    type Rejection = AppError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        if let Some(scope) = parts.extensions.get::<Scope>() {
            return Ok(scope.clone());
        }
        let principal = parts
            .extensions
            .get::<Principal>()
            .cloned()
            .ok_or_else(|| AppError::Unauthorized("sign in first".into()))?;
        let scope = Scope::of(state, &principal).await?;
        parts.extensions.insert(scope.clone());
        Ok(scope)
    }
}
