// The virtual business clock (VIRTUAL-TIME-PLAN.md).
//
// One handle, three sources: `System` (wall clock — the production default,
// byte-for-byte the behaviour the binary had before this module existed),
// `Controlled` (frozen at a moment, moved by hand — the Stripe test-clock
// shape, also what the in-process DES simulator will drive), and `Scaled`
// (linear compression that advances itself off the wall clock: one anchor
// pair plus a factor, so every node that agrees on the anchors derives the
// same virtual time without per-tick synchronisation).
//
// The handle is shared (`Arc<ClockHandle>`), so control operations
// (`set_mode`, `rescale`, `pause`, `resume`, `advance_to`) mutate one
// interior state guarded by a short critical section; `now()` takes the same
// lock and is cheap and uncontended.
//
// Two invariants are enforced here, not at call sites:
//   1. Virtual time never goes backwards through the mapping — a wall-clock
//      step back (NTP) cannot move the business clock backwards; only an
//      operator's explicit `allow_backward` re-anchor can, and the control
//      layer refuses that on `Scaled` (plan §7.2).
//   2. `rescale` is continuity-preserving: the virtual instant does not move
//      when only the speed changes.
//
// Security time (sessions, lockouts, leases, sync breakers) never reads this
// module; it stays on `Utc::now()` — enforced by `tests/clock_authority.rs`
// from the other direction.

use chrono::{DateTime, Duration, Utc};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};

/// Factor bounds (plan §1.4): below 1.0 the clock slows rather than
/// compresses; above 60 000 one virtual minute is under a real millisecond
/// and minute-resolution business stamps stop meaning anything.
pub const MIN_FACTOR: f64 = 1.0;
pub const MAX_FACTOR: f64 = 60_000.0;

/// How far in the future a supplied wall-clock anchor may sit (clock skew).
const ANCHOR_FUTURE_TOLERANCE: Duration = Duration::minutes(5);

/// What drives the business clock. Serialized for the control endpoint and
/// for the boot configuration env; tagged by `mode` so the hub can render it.
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "mode", rename_all = "snake_case")]
pub enum ClockMode {
    /// The wall clock. Production default.
    System,
    /// Frozen at one instant; every `now()` answers `at` until it is moved.
    /// Jumps in any direction are allowed here — this is the disposable,
    /// in-process/DES shape (plan §7.1).
    Controlled { at: DateTime<Utc> },
    /// `virtual = anchor_virtual + (real - anchor_real) * factor`.
    /// E.g. factor 876 runs the year 2026 through ten wall hours.
    Scaled {
        anchor_real: DateTime<Utc>,
        anchor_virtual: DateTime<Utc>,
        factor: f64,
    },
}

impl ClockMode {
    pub fn kind(&self) -> &'static str {
        match self {
            ClockMode::System => "system",
            ClockMode::Controlled { .. } => "controlled",
            ClockMode::Scaled { .. } => "scaled",
        }
    }

    /// The env bootstrap for config structs: `None` when the env is unset or
    /// explicitly `system`, `Some(mode)` when a virtual clock is configured.
    /// A malformed value is an error, not a silent fallback — a demo rig that
    /// asked for a compressed year must never quietly boot on the wall clock.
    pub fn from_env_opt() -> Result<Option<ClockMode>, ClockError> {
        let raw = match std::env::var("ITULAH_CLOCK") {
            Ok(v) => v.trim().to_ascii_lowercase(),
            Err(_) => return Ok(None),
        };
        match raw.as_str() {
            "" | "system" | "real" | "wall" => Ok(None),
            "controlled" | "controlled_clock" => {
                let at = parse_env_instant("ITULAH_CLOCK_AT")?;
                Ok(Some(ClockMode::Controlled { at }))
            }
            "scaled" | "scaled_clock" => {
                let anchor_real = parse_env_instant("ITULAH_CLOCK_ANCHOR_REAL")?;
                let anchor_virtual = parse_env_instant("ITULAH_CLOCK_ANCHOR_VIRTUAL")?;
                let raw_factor = std::env::var("ITULAH_CLOCK_FACTOR").map_err(|_| {
                    ClockError::Validation("ITULAH_CLOCK=scaled needs ITULAH_CLOCK_FACTOR".into())
                })?;
                let factor: f64 = raw_factor.trim().parse().map_err(|_| {
                    ClockError::Validation(format!(
                        "ITULAH_CLOCK_FACTOR {raw_factor:?} is not a number"
                    ))
                })?;
                Ok(Some(ClockMode::Scaled {
                    anchor_real,
                    anchor_virtual,
                    factor,
                }))
            }
            other => Err(ClockError::Validation(format!(
                "ITULAH_CLOCK={other:?} is not system|controlled|scaled"
            ))),
        }
    }
}

/// One instant's answer: what the clock says and where it came from.
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
#[derive(Clone, Debug, Serialize)]
pub struct ClockStatus {
    pub real_now: DateTime<Utc>,
    /// `None` while the clock is `System` — there is no separate virtual
    /// time to report.
    pub virtual_now: Option<DateTime<Utc>>,
    pub paused: bool,
    pub source: ClockMode,
}

/// Why a control operation was refused. `BackwardJump` is special-cased so
/// the control endpoint can answer 409 with the dry-run-style consequence
/// the plan promises, while everything else stays a 422/400 validation.
#[derive(Debug, thiserror::Error)]
pub enum ClockError {
    #[error("{0}")]
    Validation(String),
    #[error(
        "moving the business clock backwards from {current} to {attempted} rewrites keyed \
         business documents (plan §7.2); re-anchor forward or rescale instead"
    )]
    BackwardJump {
        current: DateTime<Utc>,
        attempted: DateTime<Utc>,
    },
}

struct ClockState {
    source: ClockMode,
    /// `Some(virtual_instant)` while paused: the frozen point the clock is
    /// holding. `System` cannot pause.
    paused_at: Option<DateTime<Utc>>,
    /// Monotonic guard over virtual time: the largest instant this handle has
    /// ever reported. A wall-clock step back cannot move the business clock
    /// backwards through the mapping (plan §1.2).
    last: Option<DateTime<Utc>>,
}

/// The shared handle every reader goes through. `Arc<ClockHandle>` sits in
/// the cloud `AppState` and in the edge state; the production default is
/// `system()`, which makes `now()` exactly `Utc::now()`.
pub struct ClockHandle {
    state: Mutex<ClockState>,
}

impl ClockHandle {
    /// The production default: `now()` is `Utc::now()`, nothing else moves.
    pub fn system() -> Self {
        Self {
            state: Mutex::new(ClockState {
                source: ClockMode::System,
                paused_at: None,
                last: None,
            }),
        }
    }

    /// Validate and adopt a configured mode (endpoint and boot path share
    /// this). The virtual instant under the new mode may not sit before the
    /// current virtual instant unless `allow_backward` — which only the
    /// `Controlled` (disposable) path passes.
    pub fn from_mode(mode: ClockMode) -> Result<Self, ClockError> {
        Self::validate(&mode)?;
        Ok(Self {
            state: Mutex::new(ClockState {
                source: mode,
                paused_at: None,
                last: None,
            }),
        })
    }

    /// Bootstrap from the environment:
    /// `ITULAH_CLOCK=system|controlled|scaled`, with
    /// `ITULAH_CLOCK_AT` (controlled) and
    /// `ITULAH_CLOCK_ANCHOR_REAL` / `ITULAH_CLOCK_ANCHOR_VIRTUAL` /
    /// `ITULAH_CLOCK_FACTOR` (scaled), all instants RFC 3339.
    /// Missing or `system` yields the production default.
    pub fn from_env() -> Result<Self, ClockError> {
        match ClockMode::from_env_opt()? {
            Some(mode) => Self::from_mode(mode),
            None => Ok(Self::system()),
        }
    }

    fn validate(mode: &ClockMode) -> Result<(), ClockError> {
        match mode {
            ClockMode::System => Ok(()),
            ClockMode::Controlled { .. } => Ok(()),
            ClockMode::Scaled {
                anchor_real,
                factor,
                ..
            } => {
                if *anchor_real > Utc::now() + ANCHOR_FUTURE_TOLERANCE {
                    return Err(ClockError::Validation(
                        "anchor_real lies in the future; anchor the clock at (or before) now"
                            .into(),
                    ));
                }
                if !factor.is_finite() || *factor < MIN_FACTOR || *factor > MAX_FACTOR {
                    return Err(ClockError::Validation(format!(
                        "factor {factor} outside the supported range [{MIN_FACTOR}, {MAX_FACTOR}]"
                    )));
                }
                Ok(())
            }
        }
    }

    /// The business instant. Under `System` this is exactly the wall clock.
    pub fn now(&self) -> DateTime<Utc> {
        let state = self.state.lock();
        match (&state.source, state.paused_at) {
            (_, Some(frozen)) => frozen,
            (ClockMode::System, None) => Utc::now(),
            (ClockMode::Controlled { at }, None) => *at,
            (ClockMode::Scaled { .. }, None) => {
                let v = mapped_virtual(&state.source, Utc::now());
                match state.last {
                    Some(last) if last > v => last,
                    _ => v,
                }
            }
        }
    }

    /// What the control surface and the hub chip display.
    pub fn status(&self) -> ClockStatus {
        let state = self.state.lock();
        Self::snapshot(&state, Utc::now())
    }

    /// Build a status from an already-held state. The control methods end
    /// here rather than at `self.status()` — `status()` would take the lock
    /// the caller is still holding, and a parking_lot `Mutex` is not
    /// reentrant.
    fn snapshot(state: &ClockState, real_now: DateTime<Utc>) -> ClockStatus {
        let virtual_now = match state.source.kind() {
            "system" => None,
            _ => Some(match state.paused_at {
                Some(frozen) => frozen,
                None => match state.last {
                    Some(last) if last > mapped_virtual(&state.source, real_now) => last,
                    _ => mapped_virtual(&state.source, real_now),
                },
            }),
        };
        ClockStatus {
            real_now,
            virtual_now,
            paused: state.paused_at.is_some(),
            source: state.source.clone(),
        }
    }

    pub fn is_virtual(&self) -> bool {
        self.state.lock().source.kind() != "system"
    }

    /// Adopt a new source. Moving the virtual instant backwards is refused
    /// unless the caller vouches for a disposable environment (`allow_backward`
    /// — the `controlled` path); see plan §7.2 for what a backward move does
    /// to date-keyed business documents.
    pub fn set_mode(
        &self,
        mode: ClockMode,
        allow_backward: bool,
    ) -> Result<ClockStatus, ClockError> {
        Self::validate(&mode)?;
        let mut state = self.state.lock();
        let current = virtual_instant(&state);
        let prospective = match mode.kind() {
            "system" => None,
            _ => Some(mapped_virtual(&mode, Utc::now())),
        };
        if !allow_backward {
            if let (Some(current), Some(prospective)) = (current, prospective) {
                if prospective < current {
                    return Err(ClockError::BackwardJump {
                        current,
                        attempted: prospective,
                    });
                }
            }
        }
        state.source = mode;
        state.paused_at = None;
        state.last = prospective;
        Ok(Self::snapshot(&state, Utc::now()))
    }

    /// Change only the speed: re-anchor at the current virtual instant so the
    /// clock does not jump (plan §7.1 — the one supported way to change `f`).
    pub fn rescale(&self, factor: f64) -> Result<ClockStatus, ClockError> {
        if !factor.is_finite() || factor < MIN_FACTOR || factor > MAX_FACTOR {
            return Err(ClockError::Validation(format!(
                "factor {factor} outside the supported range [{MIN_FACTOR}, {MAX_FACTOR}]"
            )));
        }
        let mut state = self.state.lock();
        let current = virtual_instant(&state).ok_or_else(|| {
            ClockError::Validation(
                "rescale applies to a virtual clock; the wall clock has no speed".into(),
            )
        })?;
        state.source = ClockMode::Scaled {
            anchor_real: Utc::now(),
            anchor_virtual: current,
            factor,
        };
        state.last = Some(current);
        Ok(Self::snapshot(&state, Utc::now()))
    }

    /// Freeze the virtual clock at the instant it now reports.
    pub fn pause(&self) -> Result<ClockStatus, ClockError> {
        let mut state = self.state.lock();
        if state.source.kind() == "system" {
            return Err(ClockError::Validation(
                "the wall clock cannot be paused; switch to a virtual mode first".into(),
            ));
        }
        if state.paused_at.is_none() {
            let current = virtual_instant(&state).unwrap_or_else(Utc::now);
            state.paused_at = Some(current);
            state.last = Some(current);
        }
        Ok(Self::snapshot(&state, Utc::now()))
    }

    /// Continue from the frozen point: the anchor moves to now, the virtual
    /// anchor to the frozen instant — no jump, the elapsed pause simply never
    /// happened to the business calendar.
    pub fn resume(&self) -> Result<ClockStatus, ClockError> {
        let mut state = self.state.lock();
        let frozen = state
            .paused_at
            .take()
            .ok_or_else(|| ClockError::Validation("the clock is not paused".into()))?;
        state.source = match state.source.clone() {
            ClockMode::System => ClockMode::System,
            ClockMode::Controlled { .. } => ClockMode::Controlled { at: frozen },
            ClockMode::Scaled { factor, .. } => ClockMode::Scaled {
                anchor_real: Utc::now(),
                anchor_virtual: frozen,
                factor,
            },
        };
        state.last = Some(frozen);
        Ok(Self::snapshot(&state, Utc::now()))
    }

    /// Move a virtual clock to a chosen instant (the Stripe `advance`): a
    /// `Controlled` clock adopts it; a `Scaled` clock re-anchors there,
    /// keeping its factor. Backwards only under `allow_backward`.
    pub fn advance_to(
        &self,
        at: DateTime<Utc>,
        allow_backward: bool,
    ) -> Result<ClockStatus, ClockError> {
        let mut state = self.state.lock();
        let factor = match state.source.clone() {
            ClockMode::System => {
                return Err(ClockError::Validation(
                    "the wall clock cannot be advanced; switch to a virtual mode first".into(),
                ))
            }
            ClockMode::Controlled { .. } => None,
            ClockMode::Scaled { factor, .. } => Some(factor),
        };
        let current = virtual_instant(&state);
        if !allow_backward {
            if let Some(current) = current {
                if at < current {
                    return Err(ClockError::BackwardJump {
                        current,
                        attempted: at,
                    });
                }
            }
        }
        state.source = match factor {
            None => ClockMode::Controlled { at },
            Some(factor) => ClockMode::Scaled {
                anchor_real: Utc::now(),
                anchor_virtual: at,
                factor,
            },
        };
        state.paused_at = None;
        state.last = Some(at);
        Ok(Self::snapshot(&state, Utc::now()))
    }
}

fn virtual_instant(state: &ClockState) -> Option<DateTime<Utc>> {
    match state.source.kind() {
        "system" => None,
        _ => {
            let mapped = match state.paused_at {
                Some(frozen) => frozen,
                None => mapped_virtual(&state.source, Utc::now()),
            };
            // The control operations reason about the instant the clock has
            // been *reporting* — the guarded one — never the raw mapping,
            // which can sit earlier after a wall-clock step back.
            Some(match state.last {
                Some(last) if last > mapped => last,
                _ => mapped,
            })
        }
    }
}

/// The pure mapping: where the source says the virtual clock is, given the
/// wall clock right now. No guards — `now()`/`status()` apply pause and the
/// monotonic guard on top.
fn mapped_virtual(source: &ClockMode, real: DateTime<Utc>) -> DateTime<Utc> {
    match source {
        ClockMode::System => real,
        ClockMode::Controlled { at } => *at,
        ClockMode::Scaled {
            anchor_real,
            anchor_virtual,
            factor,
        } => {
            let elapsed_ms = (real - *anchor_real).num_milliseconds();
            // i64 milliseconds through f64 is exact well past any real run
            // (years of milliseconds stay under f64's 2^53), and the round
            // keeps sub-millisecond compression from biasing the calendar.
            let scaled_ms = (elapsed_ms as f64 * factor).round() as i64;
            *anchor_virtual + Duration::milliseconds(scaled_ms)
        }
    }
}

/// A business instant, as a SQL literal: the `$NOW` token in catalogue
/// expressions is replaced with this at query-build time, because a
/// `&'static str` dimension cannot carry a bind parameter (the pattern
/// `membership.rs` documents). The value is formatted by chrono, never by a
/// caller, so no untrusted text can ride in.
pub fn sql_now_literal(now: DateTime<Utc>) -> String {
    format!("'{}'::timestamptz", now.to_rfc3339())
}

fn parse_env_instant(name: &str) -> Result<DateTime<Utc>, ClockError> {
    let raw = std::env::var(name)
        .map_err(|_| ClockError::Validation(format!("{name} is required for this clock mode")))?;
    let parsed = DateTime::parse_from_rfc3339(raw.trim())
        .map_err(|e| ClockError::Validation(format!("{name} {raw:?} is not RFC 3339: {e}")))?;
    Ok(parsed.with_timezone(&Utc))
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)]
    use super::*;
    use chrono::TimeZone;

    // The plan's worked example (§1.3): the year 2026 through ten wall hours,
    // anchored at a wall clock of 2026-09-22T09:00+07.
    fn anchor_real() -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 9, 22, 2, 0, 0).unwrap() // 09:00+07
    }
    fn anchor_virtual() -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2025, 12, 31, 17, 0, 0).unwrap() // 2026-01-01T00:00+07
    }
    fn scaled() -> ClockHandle {
        // The real anchor is the run's own wall clock, so the mapping starts
        // at ~anchor_virtual wherever (whenever) the test runs; the virtual
        // anchor stays the fixed calendar point the plan's examples use.
        ClockHandle::from_mode(ClockMode::Scaled {
            anchor_real: Utc::now(),
            anchor_virtual: anchor_virtual(),
            factor: 876.0,
        })
        .unwrap()
    }
    fn utc(y: i32, m: u32, d: u32, h: u32, min: u32) -> DateTime<Utc> {
        Utc.with_ymd_and_hms(y, m, d, h, min, 0).unwrap()
    }

    #[test]
    fn two_wall_hours_land_on_15_march_2026() {
        // 2 h after the anchor:
        let real = anchor_real() + Duration::hours(2);
        let v = mapped_virtual(
            &ClockMode::Scaled {
                anchor_real: anchor_real(),
                anchor_virtual: anchor_virtual(),
                factor: 876.0,
            },
            real,
        );
        // 2026-03-15T00:00+07 == 2026-03-14T17:00Z
        assert_eq!(v, utc(2026, 3, 14, 17, 0));
    }

    #[test]
    fn the_plan_table_maps_exactly() {
        let mode = ClockMode::Scaled {
            anchor_real: anchor_real(),
            anchor_virtual: anchor_virtual(),
            factor: 876.0,
        };
        // +20 min → 13 Jan 2026 04:00+07 (12.167 virtual days)
        assert_eq!(
            mapped_virtual(&mode, anchor_real() + Duration::minutes(20)),
            utc(2026, 1, 12, 21, 0) // 04:00+07 == 21:00Z previous day
        );
        // +5 h → 2 Jul 2026 12:00+07
        assert_eq!(
            mapped_virtual(&mode, anchor_real() + Duration::hours(5)),
            utc(2026, 7, 2, 5, 0)
        );
        // +10 h → 1 Jan 2027 00:00+07 — the year is over
        assert_eq!(
            mapped_virtual(&mode, anchor_real() + Duration::hours(10)),
            utc(2026, 12, 31, 17, 0)
        );
    }

    #[test]
    fn wall_clock_step_back_cannot_move_the_business_clock_back() {
        let clock = scaled();
        // Anchor at "now": the mapping answers ~anchor_virtual and the test
        // never depends on where today sits inside the wall anchor.
        let source = clock.status().source;
        let later = anchor_virtual() + Duration::days(40);
        *state_of(&clock).lock() = ClockState {
            source,
            paused_at: None,
            last: Some(later),
        };
        // A wall step back would recompute a mapping at or before the anchor;
        // the monotonic guard holds the line at `later`.
        assert_eq!(clock.now(), later);
    }

    #[test]
    fn rescale_is_continuity_preserving() {
        let clock = scaled();
        let source = clock.status().source;
        *state_of(&clock).lock() = ClockState {
            source,
            paused_at: None,
            last: Some(anchor_virtual() + Duration::days(73)),
        };
        let before = clock.now();
        clock.rescale(31.0).unwrap();
        // The virtual instant does not move when only the speed changes; the
        // re-anchored mapping (elapsed ≈ 0 ms at the new anchor) recomputes
        // to exactly the re-anchor instant, and the guard agrees.
        assert_eq!(clock.now(), before);
    }

    #[test]
    fn pause_freezes_and_resume_continues_from_the_same_point() {
        let clock = scaled();
        let source = clock.status().source;
        *state_of(&clock).lock() = ClockState {
            source,
            paused_at: None,
            last: Some(anchor_virtual() + Duration::days(73)),
        };
        let frozen = clock.pause().unwrap();
        assert_eq!(
            frozen.virtual_now,
            Some(anchor_virtual() + Duration::days(73))
        );
        assert!(clock.status().paused);
        assert_eq!(clock.now(), frozen.virtual_now.unwrap());
        clock.resume().unwrap();
        assert!(!clock.status().paused);
        // After resume the clock advances from the frozen point (scaled fast:
        // anything ≥ the frozen point is fine; equality holds only if no real
        // time has passed).
        assert!(clock.now() >= frozen.virtual_now.unwrap());
    }

    #[test]
    fn backward_moves_are_refused_unless_allowed() {
        let clock = scaled();
        // Start one virtual year in (the 10-hour run is over). Poked via the
        // state directly — the current mapping sits at ~anchor_virtual, a
        // virtual year ahead of it, so the move below is genuinely backwards.
        let source = clock.status().source;
        *state_of(&clock).lock() = ClockState {
            source,
            paused_at: None,
            last: Some(anchor_virtual() + Duration::days(365)),
        };
        let backward = ClockMode::Scaled {
            anchor_real: Utc::now(),
            anchor_virtual: anchor_virtual(),
            factor: 876.0,
        };
        match clock.set_mode(backward.clone(), false) {
            Err(ClockError::BackwardJump { current, .. }) => {
                assert_eq!(current, anchor_virtual() + Duration::days(365));
            }
            other => panic!("expected BackwardJump, got {other:?}"),
        }
        // The controlled (disposable) path may move backwards.
        assert!(clock.set_mode(backward, true).is_ok());
    }

    #[test]
    fn advance_to_reanchors_scaled_keeping_the_factor() {
        let clock = scaled();
        let target = anchor_virtual() + Duration::days(200);
        let status = clock.advance_to(target, false).unwrap();
        assert_eq!(status.virtual_now, Some(target));
        assert_eq!(status.source.kind(), "scaled");
        match status.source {
            ClockMode::Scaled { factor, .. } => assert_eq!(factor, 876.0),
            other => panic!("expected scaled, got {other:?}"),
        }
    }

    #[test]
    fn validation_rejects_bad_factors_and_future_anchors() {
        assert!(ClockHandle::from_mode(ClockMode::Scaled {
            anchor_real: anchor_real(),
            anchor_virtual: anchor_virtual(),
            factor: 0.5,
        })
        .is_err());
        assert!(ClockHandle::from_mode(ClockMode::Scaled {
            anchor_real: anchor_real(),
            anchor_virtual: anchor_virtual(),
            factor: 100_000.0,
        })
        .is_err());
        assert!(ClockHandle::from_mode(ClockMode::Scaled {
            anchor_real: Utc::now() + Duration::hours(1),
            anchor_virtual: anchor_virtual(),
            factor: 876.0,
        })
        .is_err());
    }

    #[test]
    fn system_clock_is_the_wall_and_cannot_be_controlled() {
        let clock = ClockHandle::system();
        assert!(!clock.is_virtual());
        assert!(clock.status().virtual_now.is_none());
        assert!(clock.pause().is_err());
        assert!(clock.advance_to(anchor_virtual(), false).is_err());
        assert!(clock.rescale(876.0).is_err());
    }

    fn mode_of(clock: &ClockHandle) -> ClockMode {
        clock.status().source
    }

    fn state_of(clock: &ClockHandle) -> &Mutex<ClockState> {
        &clock.state
    }
}
