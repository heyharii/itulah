//! The store server.
//!
//! ```text
//! store                     run in the foreground (a developer, or systemd)
//! store enroll --code K     enrol this machine and wait for approval
//! store stage-code K [URL]  leave a code for the node to claim on its next start
//! store diagnose            check everything and write a report
//! store service             (Windows) what the Service Control Manager starts
//! store install-service     (Windows) register, configure and start the service
//! store uninstall-service   (Windows) stop and remove it; the data stays
//! store --version
//! ```
//!
//! Installed — `ITULAH_DATA_DIR` set, or running as the Windows service — the
//! node keeps its configuration, database, logs and incident journal in that
//! directory and runs unattended (`edge/node.rs`). Without it nothing changes
//! for a developer: `.env` and the old defaults decide.

use inventory_backend::edge::{diagnose, enrolment, node};
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

fn main() -> Result<(), BoxError> {
    let args: Vec<String> = env::args().skip(1).collect();
    let command = args.first().map(String::as_str).unwrap_or("run");

    #[cfg(windows)]
    match command {
        "service" => return inventory_backend::edge::winservice::run_dispatcher(),
        "install-service" => return inventory_backend::edge::winservice::install(),
        "uninstall-service" => return inventory_backend::edge::winservice::uninstall(),
        _ => {}
    }

    if command == "--version" || command == "version" {
        println!("itulah-store {}", env!("CARGO_PKG_VERSION"));
        return Ok(());
    }

    // On Windows an installed node's home is known even without the variable
    // (`%ProgramData%\itulah\store`), which is what lets the MSI stage a code
    // or run a diagnosis from a plain elevated prompt.
    let data_dir = node::installed_data_dir(cfg!(windows) && command != "run");
    node::prepare_environment(data_dir.as_deref())?;

    match command {
        "stage-code" => {
            let code = args
                .get(1)
                .ok_or("usage: store stage-code XXXXX-XXXXX [CLOUD_URL]")?;
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
            let _logs = node::init_logging(None);
            let code = flag(&args, "--code")
                .ok_or("usage: store enroll --code XXXXX-XXXXX [--cloud URL]")?;
            let cloud = flag(&args, "--cloud")
                .or_else(|| env::var("ITULAH_CLOUD_URL").ok())
                .ok_or("--cloud URL (or ITULAH_CLOUD_URL) is required")?;
            let dir = data_dir.unwrap_or_else(|| PathBuf::from("."));
            runtime()?.block_on(enrolment::enroll_headless(dir, &cloud, &code))?;
            Ok(())
        }
        "diagnose" => {
            let report = runtime()?.block_on(diagnose::diagnose(data_dir.as_deref()));
            diagnose::print_and_save(&report);
            // Non-zero when something failed, so a script or a remote command
            // can tell without parsing the report.
            if report.verdict == diagnose::Verdict::Fail {
                std::process::exit(2);
            }
            Ok(())
        }
        "run" => {
            let _logs = node::init_logging(data_dir.as_deref());
            let exit =
                runtime()?.block_on(node::run(data_dir, node::terminal_or_supervisor_stop()))?;
            if exit == node::Exit::Restart {
                std::process::exit(node::RESTART_EXIT_CODE);
            }
            Ok(())
        }
        other => Err(format!("unknown command {other:?}; see the top of bin/store.rs").into()),
    }
}
