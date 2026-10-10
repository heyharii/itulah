//! `sim` — the retail simulator's binary.
//!
//!     sim run --scenario po-smoke --env runs/<id>/env
//!
//! The env file is the rig's frozen run configuration (see scripts/rig.sh):
//! it carries the cloud/dc/store URLs this run talks to. The simulator itself
//! is stateless between runs; isolation comes from the run boundary (one
//! database per run, world model in memory, evidence on disk).

mod actors;
mod client;
mod clock;
mod report;
mod scenario;

use crate::client::{Nodes, Recorder};
use crate::clock::SimClock;
use crate::report::RunReport;
use crate::scenario::Scenario;
use std::collections::BTreeMap;
use std::path::PathBuf;

const USAGE: &str = "\
sim — run the retail business through the real API

USAGE:
  sim run --scenario <name|path.toml> --env <runs/<id>/env> [--seed N] [--out <dir>]
  sim help
";

#[tokio::main]
async fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        Some("run") => match run_command(&args[1..]).await {
            Ok(code) => std::process::exit(code),
            Err(e) => {
                eprintln!("sim: {e}");
                std::process::exit(2);
            }
        },
        Some("help") | Some("--help") | Some("-h") => print!("{USAGE}"),
        _ => {
            eprint!("{USAGE}");
            std::process::exit(2);
        }
    }
}

async fn run_command(args: &[String]) -> Result<i32, String> {
    let mut scenario_path: Option<String> = None;
    let mut env_path: Option<String> = None;
    let mut out_dir: Option<PathBuf> = None;
    let mut seed_override: Option<u64> = None;
    let mut rest = args.iter();
    while let Some(flag) = rest.next() {
        let mut value = || {
            rest.next()
                .cloned()
                .ok_or_else(|| format!("flag {flag} needs a value"))
        };
        match flag.as_str() {
            "--scenario" => scenario_path = Some(value()?),
            "--env" => env_path = Some(value()?),
            "--out" => out_dir = Some(PathBuf::from(value()?)),
            "--seed" => {
                let raw = value()?;
                seed_override = Some(raw.parse::<u64>().map_err(|_| "--seed needs a number")?);
            }
            other => return Err(format!("unknown flag {other}")),
        }
    }
    let scenario_path = scenario_path
        .ok_or("--scenario is required (name under crates/sim/scenarios, or a .toml path)")?;
    let env_path = env_path.ok_or("--env is required (a rig run's env file)")?;

    let scenario = resolve_scenario(&scenario_path)?;
    let seed = seed_override.unwrap_or(scenario.seed);
    let env = read_env_file(&env_path)?;
    let run_id = env
        .get("RUN_ID")
        .cloned()
        .unwrap_or_else(|| "sim-run".to_string());
    let cloud = env
        .get("CLOUD_URL")
        .cloned()
        .ok_or_else(|| "env file lacks CLOUD_URL — is this a rig env file?".to_string())?;
    let port_of = |key: &str| -> Result<String, String> {
        let port = env.get(key).ok_or(format!("env file lacks {key}"))?;
        Ok(format!("http://127.0.0.1:{port}"))
    };
    let nodes = Nodes::new(
        cloud,
        port_of("DC_PORT")?,
        port_of("STORE_PORT")?,
        run_id.clone(),
    );

    let out = out_dir.unwrap_or_else(|| {
        PathBuf::from(&env_path)
            .parent()
            .map(|p| p.to_path_buf())
            .unwrap_or_default()
    });
    let mut recorder = Recorder::open(&out).map_err(|e| e.to_string())?;

    let start = chrono::DateTime::parse_from_rfc3339(&scenario.clock.start)
        .map_err(|e| format!("scenario {}: bad clock.start: {e}", scenario.name))?;
    let mut clock = SimClock::start(start);

    println!(
        "sim: scenario '{}' seed {seed} against cloud {} for {} virtual days",
        scenario.name, nodes.cloud, scenario.clock.days
    );

    let world = actors::run_scenario(&scenario, seed, &nodes, &mut recorder, &mut clock)
        .await
        .map_err(|e| format!("run failed: {e}"))?;

    let report = RunReport {
        run_id,
        scenario: scenario.name.clone(),
        seed,
        clock_start: scenario.clock.start.clone(),
        clock_end: clock.now().to_rfc3339(),
        result: if recorder.failures == 0 {
            "pass"
        } else {
            "fail"
        },
        world,
    };
    report.write(&out)?;

    println!(
        "sim: {} — {} intents, {} failures; report at {}/sim_result.json",
        report.result,
        recorder.total,
        recorder.failures,
        out.display()
    );
    Ok(if recorder.failures == 0 { 0 } else { 1 })
}

/// `po-smoke` resolves to `crates/sim/scenarios/po-smoke.toml`; a path with a
/// `.toml` suffix is taken literally.
fn resolve_scenario(name_or_path: &str) -> Result<Scenario, String> {
    if name_or_path.ends_with(".toml") {
        return Scenario::load(name_or_path);
    }
    let path = format!(
        "{}/scenarios/{name_or_path}.toml",
        env!("CARGO_MANIFEST_DIR")
    );
    Scenario::load(&path)
}

/// The rig freezes `KEY=value` lines; a tiny reader beats a shell dependency.
fn read_env_file(path: &str) -> Result<BTreeMap<String, String>, String> {
    let raw =
        std::fs::read_to_string(path).map_err(|e| format!("cannot read env file {path}: {e}"))?;
    let mut map = BTreeMap::new();
    for line in raw.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let (key, value) = line
            .split_once('=')
            .ok_or_else(|| format!("env file {path}: line is not KEY=value: {line}"))?;
        map.insert(key.trim().to_string(), value.trim().to_string());
    }
    Ok(map)
}
