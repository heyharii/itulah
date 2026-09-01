use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct RfidRead {
    pub epc: String,
    pub antenna: Option<String>,
    pub rssi: Option<f32>,
    pub phase: Option<f32>,
    pub frequency: Option<f32>,
    #[serde(default = "one")]
    pub read_count: i32,
}

const fn one() -> i32 {
    1
}

#[derive(Clone, Debug, PartialEq)]
pub struct ConsolidatedRead {
    pub epc: String,
    pub read_count: i64,
    pub best_rssi: Option<f32>,
    pub antenna: Option<String>,
}

pub fn consolidate_reads(reads: &[RfidRead]) -> Vec<ConsolidatedRead> {
    let mut result: BTreeMap<String, ConsolidatedRead> = BTreeMap::new();
    for read in reads {
        let epc = read.epc.trim().to_ascii_uppercase();
        if epc.is_empty() {
            continue;
        }
        let entry = result.entry(epc.clone()).or_insert(ConsolidatedRead {
            epc,
            read_count: 0,
            best_rssi: None,
            antenna: read.antenna.clone(),
        });
        entry.read_count += i64::from(read.read_count.max(1));
        entry.best_rssi = match (entry.best_rssi, read.rssi) {
            (Some(a), Some(b)) => Some(a.max(b)),
            (None, value) => value,
            (value, None) => value,
        };
    }
    result.into_values().collect()
}

pub fn belongs_to_same_burst(
    last_seen: DateTime<Utc>,
    observed_at: DateTime<Utc>,
    window_seconds: i64,
) -> bool {
    observed_at >= last_seen && observed_at - last_seen <= Duration::seconds(window_seconds)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn burst_reads_consolidate_by_epc_and_keep_best_rssi() {
        let reads = vec![
            RfidRead {
                epc: "epc001".into(),
                antenna: None,
                rssi: Some(-53.0),
                phase: None,
                frequency: None,
                read_count: 1,
            },
            RfidRead {
                epc: "EPC001".into(),
                antenna: None,
                rssi: Some(-46.0),
                phase: None,
                frequency: None,
                read_count: 79,
            },
            RfidRead {
                epc: "EPC002".into(),
                antenna: None,
                rssi: None,
                phase: None,
                frequency: None,
                read_count: 1,
            },
        ];
        let result = consolidate_reads(&reads);
        assert_eq!(result.len(), 2);
        assert_eq!(result[0].read_count, 80);
        assert_eq!(result[0].best_rssi, Some(-46.0));
    }
}
