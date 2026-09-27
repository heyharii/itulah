//! The run result: one JSON document that says what ran and what it found
//! (SIMULATION-PLAN §13.1), written next to the intent journal.

use serde_json::{json, Value};
use std::path::Path;

pub struct RunReport {
    pub run_id: String,
    pub scenario: String,
    pub seed: u64,
    pub clock_start: String,
    pub clock_end: String,
    pub result: &'static str,
    pub world: Value,
}

impl RunReport {
    pub fn write(&self, out_dir: &Path) -> Result<(), String> {
        let document = json!({
            "run_id": self.run_id,
            "scenario": self.scenario,
            "seed": self.seed,
            "clock": { "start": self.clock_start, "end": self.clock_end },
            "intents": { "total": self.world.get("intents_total"), "failures": self.world.get("intent_failures") },
            "result": self.result,
            "world": self.world,
        });
        let path = out_dir.join("sim_result.json");
        std::fs::write(&path, document.to_string())
            .map_err(|e| format!("cannot write {}: {e}", path.display()))
    }
}
