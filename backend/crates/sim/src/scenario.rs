//! Scenario files: one TOML file declares the whole run (SIMULATION-PLAN §7).
//!
//! A scenario is data, never code: the same engine runs `po-smoke` today and
//! whatever lane is authored next, and the resolved configuration is stored
//! with the run result so a report is never ambiguous about what ran.

use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct Scenario {
    pub name: String,
    #[serde(default = "default_seed")]
    pub seed: u64,
    pub clock: ClockSection,
    pub topology: Topology,
}

#[derive(Debug, Deserialize)]
pub struct ClockSection {
    /// Business-local RFC 3339 instant the virtual calendar starts on.
    pub start: String,
    /// How many virtual days the run spans.
    pub days: u32,
}

#[derive(Debug, Deserialize)]
pub struct Topology {
    /// Supplier code the buyer persona registers during bootstrap.
    pub supplier: String,
    /// Supplier item codes the supplier catalogue carries.
    pub supplier_items: Vec<String>,
    /// How many units of each item the buyer orders, aligned with `supplier_items`.
    pub order_qty: Vec<i64>,
    /// Destination site of the purchase orders (`dc` for the PO lane).
    pub destination: String,
}

fn default_seed() -> u64 {
    42
}

impl Scenario {
    pub fn load(path: &str) -> Result<Self, String> {
        let raw = std::fs::read_to_string(path)
            .map_err(|e| format!("cannot read scenario {path}: {e}"))?;
        let scenario: Scenario =
            toml::from_str(&raw).map_err(|e| format!("scenario {path} is invalid TOML: {e}"))?;
        scenario.validate()?;
        Ok(scenario)
    }

    fn validate(&self) -> Result<(), String> {
        if self.topology.supplier_items.len() != self.topology.order_qty.len() {
            return Err(format!(
                "scenario {}: {} supplier items but {} order quantities — they must align",
                self.name,
                self.topology.supplier_items.len(),
                self.topology.order_qty.len()
            ));
        }
        if self.topology.supplier_items.is_empty() {
            return Err(format!("scenario {}: no supplier items to buy", self.name));
        }
        Ok(())
    }
}
