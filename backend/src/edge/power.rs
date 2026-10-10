//! The UPS: is the shop on mains or on battery, and for how long can it last.
//!
//! Read, never controlled. Shutting the machine down cleanly when the battery
//! runs out is the operating system's job — NUT's `upsmon SHUTDOWNCMD` on
//! Linux, the critical-battery action on Windows — and both stop the service
//! first, which is a clean stop for the node. What the node does with the
//! reading (STORE-SERVER-PLAN §5a):
//!
//! - on battery: send the backlog to head office now, postpone the backup,
//!   and say so on the console and the Fleet page with the minutes left;
//! - back on mains: write down how long the cut lasted.
//!
//! Linux reads NUT (`upsc`); Windows reads the battery a USB HID UPS presents
//! (`GetSystemPowerStatus`). A machine with neither reports nothing — "—", not
//! "on mains".

use crate::edge::node::Journal;
use crate::sync::node_status::{Incident, PowerFacts, PowerSource};
use chrono::Utc;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

static LATEST: OnceLock<Mutex<Option<PowerFacts>>> = OnceLock::new();

fn slot() -> &'static Mutex<Option<PowerFacts>> {
    LATEST.get_or_init(|| Mutex::new(None))
}

/// The newest reading, if there is a UPS to read.
pub fn latest() -> Option<PowerFacts> {
    slot().lock().ok().and_then(|facts| facts.clone())
}

pub fn on_battery() -> bool {
    latest().is_some_and(|facts| facts.source == PowerSource::Battery)
}

/// Parse `upsc <ups>` output. Pure, for tests.
pub fn parse_nut(text: &str) -> Option<PowerFacts> {
    let field = |name: &str| {
        text.lines()
            .find_map(|line| line.strip_prefix(name)?.strip_prefix(':').map(str::trim))
    };
    let status = field("ups.status")?;
    let flags: Vec<&str> = status.split_whitespace().collect();
    let source = if flags.contains(&"OB") {
        PowerSource::Battery
    } else if flags.contains(&"OL") {
        PowerSource::Mains
    } else {
        PowerSource::Unknown
    };
    Some(PowerFacts {
        source,
        charge_percent: field("battery.charge")
            .and_then(|value| value.parse::<f64>().ok())
            .map(|v| v.round() as u8),
        runtime_seconds: field("battery.runtime")
            .and_then(|value| value.parse::<f64>().ok())
            .map(|v| v as i64),
        low: flags.contains(&"LB"),
    })
}

#[cfg(not(windows))]
fn read() -> Option<PowerFacts> {
    use std::process::Command;
    let list = Command::new("upsc").arg("-l").output().ok()?;
    let name = String::from_utf8(list.stdout)
        .ok()?
        .lines()
        .next()?
        .trim()
        .to_owned();
    if name.is_empty() {
        return None;
    }
    let output = Command::new("upsc")
        .arg(format!("{name}@localhost"))
        .output()
        .ok()?;
    parse_nut(&String::from_utf8(output.stdout).ok()?)
}

#[cfg(windows)]
fn read() -> Option<PowerFacts> {
    use windows_sys::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};
    let mut status: SYSTEM_POWER_STATUS = unsafe { std::mem::zeroed() };
    if unsafe { GetSystemPowerStatus(&mut status) } == 0 {
        return None;
    }
    // 128: "no system battery" — a desktop with no UPS on USB.
    if status.BatteryFlag == 128 || status.BatteryFlag == 255 {
        return None;
    }
    Some(PowerFacts {
        source: match status.ACLineStatus {
            0 => PowerSource::Battery,
            1 => PowerSource::Mains,
            _ => PowerSource::Unknown,
        },
        charge_percent: (status.BatteryLifePercent <= 100).then_some(status.BatteryLifePercent),
        runtime_seconds: (status.BatteryLifeTime != u32::MAX)
            .then_some(status.BatteryLifeTime as i64),
        // 2: low, 4: critical.
        low: status.BatteryFlag & (2 | 4) != 0,
    })
}

/// Read the UPS every ten seconds from now on.
pub fn spawn_monitor(
    sync: Option<Arc<crate::edge::sync::EdgeSyncHandle>>,
    journal: Option<Journal>,
) {
    tokio::spawn(async move {
        let mut battery_since: Option<chrono::DateTime<Utc>> = None;
        loop {
            let reading = tokio::task::spawn_blocking(read).await.ok().flatten();
            let was = latest();
            if let Ok(mut slot) = slot().lock() {
                *slot = reading.clone();
            }
            let now_on_battery = reading
                .as_ref()
                .is_some_and(|f| f.source == PowerSource::Battery);
            let was_on_battery = was
                .as_ref()
                .is_some_and(|f| f.source == PowerSource::Battery);
            if now_on_battery && !was_on_battery {
                let at = Utc::now();
                battery_since = Some(at);
                tracing::warn!("mains power lost: running on the UPS");
                if let Some(journal) = &journal {
                    journal.record(&Incident::OnBattery {
                        at,
                        charge_percent: reading.as_ref().and_then(|f| f.charge_percent),
                    });
                }
                // Get the backlog to head office while there is power to.
                if let Some(sync) = &sync {
                    sync.trigger();
                }
            } else if !now_on_battery && was_on_battery {
                let at = Utc::now();
                let seconds = battery_since.map_or(0, |since| (at - since).num_seconds());
                battery_since = None;
                tracing::info!(seconds, "mains power is back");
                if let Some(journal) = &journal {
                    journal.record(&Incident::PowerRestored {
                        at,
                        on_battery_seconds: seconds,
                    });
                }
            }
            tokio::time::sleep(Duration::from_secs(10)).await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nut_on_battery_with_low_charge() {
        let facts = parse_nut("battery.charge: 28\nbattery.runtime: 312\nups.status: OB LB\n");
        let facts = facts.expect("parsed");
        assert_eq!(facts.source, PowerSource::Battery);
        assert_eq!(facts.charge_percent, Some(28));
        assert_eq!(facts.runtime_seconds, Some(312));
        assert!(facts.low);
    }

    #[test]
    fn nut_on_mains() {
        let facts = parse_nut("ups.status: OL CHRG\nbattery.charge: 100\n").expect("parsed");
        assert_eq!(facts.source, PowerSource::Mains);
        assert!(!facts.low);
    }

    #[test]
    fn nothing_to_read_is_nothing_not_mains() {
        assert!(parse_nut("").is_none());
    }
}
