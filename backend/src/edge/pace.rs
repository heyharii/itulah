//! How hard the node may work in the background, judged from the machine.
//!
//! A shop's server is often a small PC doing other things too. When it is
//! short of CPU or memory, the work nobody is waiting for — sending the
//! backlog to head office — steps back so the work somebody is waiting for —
//! a cashier's sale — keeps its speed, and so the machine does not tip over.
//! The sale itself is never slowed: it is written locally either way, and the
//! backlog only drains a little later.
//!
//! One number, the factor by which the sync lane stretches its interval: 1
//! when the machine is calm, 2 when it is busy, 6 when it is short. It rises
//! at once and falls only after three calm readings in a row, so a machine at
//! the edge does not flap between the two.

use std::sync::atomic::{AtomicU32, Ordering};
use std::time::Duration;

static FACTOR: AtomicU32 = AtomicU32::new(1);

const READ_EVERY: Duration = Duration::from_secs(10);
const CALM_READINGS_TO_RELAX: u32 = 3;

/// The current stretch for background work.
pub fn factor() -> u32 {
    FACTOR.load(Ordering::Relaxed).max(1)
}

/// What the machine's state asks for. Pure, for tests.
pub fn judge(cpu_percent: f32, memory_available_ratio: f64) -> u32 {
    if cpu_percent >= 85.0 || memory_available_ratio < 0.10 {
        6
    } else if cpu_percent >= 65.0 || memory_available_ratio < 0.20 {
        2
    } else {
        1
    }
}

/// Watch the machine from now on.
pub fn spawn_monitor() {
    tokio::spawn(async move {
        let mut system = sysinfo::System::new();
        let mut calm = 0;
        loop {
            // CPU usage is a difference between two readings; the first one
            // only primes it.
            system.refresh_cpu_usage();
            system.refresh_memory();
            tokio::time::sleep(READ_EVERY).await;
            system.refresh_cpu_usage();
            system.refresh_memory();
            let total = system.total_memory().max(1) as f64;
            let wanted = judge(
                system.global_cpu_usage(),
                system.available_memory() as f64 / total,
            );
            let current = factor();
            let next = if wanted >= current {
                calm = 0;
                wanted
            } else {
                calm += 1;
                if calm >= CALM_READINGS_TO_RELAX {
                    calm = 0;
                    wanted
                } else {
                    current
                }
            };
            if next != current {
                FACTOR.store(next, Ordering::Relaxed);
                tracing::info!(
                    factor = next,
                    cpu = system.global_cpu_usage(),
                    "background sync pace changed to match the machine's load"
                );
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::judge;

    #[test]
    fn a_calm_machine_syncs_at_full_speed() {
        assert_eq!(judge(20.0, 0.6), 1);
    }

    #[test]
    fn a_busy_machine_steps_back_and_a_starved_one_steps_further() {
        assert_eq!(judge(70.0, 0.6), 2);
        assert_eq!(judge(20.0, 0.15), 2);
        assert_eq!(judge(90.0, 0.6), 6);
        assert_eq!(judge(20.0, 0.05), 6);
    }
}
