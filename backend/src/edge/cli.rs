//! The one command line both node roles share.
//!
//! ```text
//! <binary>                  run in the foreground (a developer, or systemd)
//! <binary> enroll --code K  enrol this machine and wait for approval
//! <binary> stage-code K     leave a code for the node to claim on its next start
//! <binary> diagnose         check everything and write a report
//! <binary> service          (Windows) what the Service Control Manager starts
//! <binary> install-service  (Windows) register, configure and start the service
//! <binary> uninstall-service (Windows) stop and remove it; the data stays
//! <binary> can-uninstall    exit 3 unless head office released it and nothing
//!                           would be lost (`edge/removal.rs`); --ui says why
//!                           in a window
//! <binary> wipe-data        remove the data directory, copying the database
//!                           aside first when anything is still unsent
//! <binary> --version
//! ```
//!
//! **Why this is one function and not two binaries.** `store` and `dc` used to
//! be two entry points: `store` ran the whole node — enrolment, heartbeat, the
//! operations runner, the updater, backups, the LAN advertisement, the console
//! — and `dc` ran a bare router with an auth layer and a sync agent. The
//! deployed Gudang ran the second one (`render.yaml`'s `dc` service sets
//! `APP_BIN=dc`; `deploy/edge/dc-edge.service` starts `/usr/local/bin/dc`), so
//! the warehouse's node never sent a heartbeat. Everything the centre decides
//! from a heartbeat then read "no node there": a shop's return was never
//! announced to the Gudang (`origin_takes_goods_routes_tx` reads
//! `node_heartbeat`), the hub's Fleet page showed nothing, server operations
//! were never delivered, and no backup ran. One runtime, two callers, and the
//! role is the only difference — which is what `edge::node` already assumed.
//!
//! Installed — `ITULAH_DATA_DIR` set, or running as the Windows service — the
//! node keeps its configuration, database, logs and incident journal in that
//! directory and runs unattended (`edge/node.rs`). Without it nothing changes
//! for a developer: `.env` and the old defaults decide.

use crate::edge::{diagnose, enrolment, node, removal, EdgeRole};
use std::{env, path::PathBuf};

type BoxError = Box<dyn std::error::Error + Send + Sync>;

fn flag(args: &[String], name: &str) -> Option<String> {
    args.iter()
        .position(|arg| arg == name)
        .and_then(|index| args.get(index + 1))
        .cloned()
}

fn runtime() -> Result<tokio::runtime::Runtime, BoxError> {
    Ok(tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()?)
}

/// Run the node's command line, with `default_role` deciding what an
/// environment that names no role runs as.
pub fn main(default_role: EdgeRole) -> Result<(), BoxError> {
    let args: Vec<String> = env::args().skip(1).collect();
    let command = args.first().map(String::as_str).unwrap_or("run");

    #[cfg(windows)]
    match command {
        // A Gudang's node is installed as a systemd unit on Linux
        // (`deploy/edge/dc-edge.service`); the Windows wrapper is a shop's,
        // because that is the node the MSI ships. Refused by name rather than
        // installing a service called `ItulahStore` for a warehouse.
        "service" | "install-service" | "uninstall-service" if default_role == EdgeRole::Dc => {
            return Err(
                "the Windows service wrapper is a shop's node; a Gudang's node is installed as \
                 a systemd unit on Linux (deploy/edge/dc-edge.service)"
                    .into(),
            )
        }
        "service" => return crate::edge::winservice::run_dispatcher(),
        "install-service" => return crate::edge::winservice::install(),
        "uninstall-service" => return crate::edge::winservice::uninstall(),
        // The MSI, as SYSTEM, and the setup page's buttons through UAC
        // (`edge/laptop.rs`): the shop's network Private, awake on mains.
        "prepare-pc" => {
            crate::edge::laptop::prepare_pc()?;
            println!("This PC's network is Private and it stays awake while plugged in.");
            return Ok(());
        }
        "start-over" => {
            crate::edge::laptop::start_over()?;
            println!("The old data moved aside; this PC waits for a new install code.");
            return Ok(());
        }
        "open-link" => {
            let link = args.get(1).map(String::as_str).unwrap_or_default();
            if let Err(refusal) = crate::edge::laptop::open_link(link) {
                crate::edge::notice::alert("Central Store Server", &refusal);
            }
            return Ok(());
        }
        _ => {}
    }

    if command == "--version" || command == "version" {
        println!(
            "{} {}",
            match default_role {
                EdgeRole::Dc => "itulah-dc",
                EdgeRole::Store => "itulah-store",
            },
            env!("CARGO_PKG_VERSION")
        );
        return Ok(());
    }

    // On Windows an installed node's home is known even without the variable
    // (`%ProgramData%\itulah\store`, or `…\dc` for the Gudang), which is what
    // lets the MSI stage a code or run a diagnosis from a plain elevated
    // prompt.
    let data_dir = node::installed_data_dir(default_role, cfg!(windows) && command != "run");

    // The uninstaller's two questions (deploy/windows/store.wxs,
    // install-store.sh --uninstall), asked before `node.env` is loaded: they
    // read only the database and the release, and a key that will not unseal
    // must not keep a PC from being removed.
    match command {
        "can-uninstall" => {
            return match removal::may_uninstall(default_role, data_dir.as_deref()) {
                Ok(()) => {
                    println!("Nothing on this PC is waiting for Central: it may be uninstalled.");
                    Ok(())
                }
                Err(refusal) => {
                    eprintln!("{refusal}");
                    if args.iter().any(|arg| arg == "--ui") {
                        crate::edge::notice::alert("Central Store Server", &refusal);
                    }
                    std::process::exit(3);
                }
            };
        }
        "wipe-data" => {
            match removal::wipe(default_role, data_dir.as_deref())? {
                Some(kept) => println!(
                    "Data removed; what had not reached Central is kept at {}",
                    kept.display()
                ),
                None => println!("Data removed."),
            }
            return Ok(());
        }
        _ => {}
    }
    node::prepare_environment(data_dir.as_deref())?;

    match command {
        "stage-code" => {
            let code = args
                .get(1)
                .ok_or("usage: stage-code XXXXX-XXXXX [CLOUD_URL]")?;
            let dir = data_dir
                .ok_or("ITULAH_DATA_DIR is not set: stage a code only on an installed node")?;
            enrolment::stage_code(&dir, code, args.get(2).map(String::as_str))?;
            println!(
                "Code staged in {}; the node claims it on its next start.",
                dir.display()
            );
            Ok(())
        }
        "enroll" => {
            let _logs = node::init_logging(default_role, None);
            let code =
                flag(&args, "--code").ok_or("usage: enroll --code XXXXX-XXXXX [--cloud URL]")?;
            let cloud = enrolment::baked_cloud()
                .map(str::to_owned)
                .or_else(|| flag(&args, "--cloud"))
                .or_else(|| env::var("ITULAH_CLOUD_URL").ok())
                .ok_or("--cloud URL (or ITULAH_CLOUD_URL) is required")?;
            let dir = data_dir.unwrap_or_else(|| PathBuf::from("."));
            runtime()?.block_on(enrolment::enroll_headless(dir, &cloud, &code))?;
            Ok(())
        }
        "diagnose" => {
            let report = runtime()?.block_on(diagnose::diagnose(default_role, data_dir.as_deref()));
            diagnose::print_and_save(&report);
            // Non-zero when something failed, so a script or a remote command
            // can tell without parsing the report.
            if report.verdict == diagnose::Verdict::Fail {
                std::process::exit(2);
            }
            Ok(())
        }
        "run" => {
            // An update installed a newer build in the data directory: become
            // it before anything else starts (`edge/update.rs`).
            if let Some(dir) = &data_dir {
                crate::edge::update::hand_over(dir);
            }
            let _logs = node::init_logging(default_role, data_dir.as_deref());
            let exit = runtime()?.block_on(node::run(
                default_role,
                data_dir,
                node::terminal_or_supervisor_stop(),
            ))?;
            if exit == node::Exit::Restart {
                std::process::exit(node::RESTART_EXIT_CODE);
            }
            Ok(())
        }
        other => Err(format!("unknown command {other:?}; see the top of edge/cli.rs").into()),
    }
}
