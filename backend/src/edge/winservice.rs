//! The store node as a Windows service.
//!
//! One executable, three ways in (the pattern `retail/cmd/printer-agent`
//! settled on, and the one that survived there):
//!
//! - `store.exe service` — what the Service Control Manager starts. Never run
//!   by hand; it blocks waiting for the SCM.
//! - `store.exe install-service` — registers the service, sets it to restart on
//!   failure, gives it a data directory only it and administrators can read,
//!   opens the port to the private network — TCP 8082 for the tills' calls,
//!   UDP 5353 so they can find it (`edge/discovery.rs`) — and starts it. The
//!   installer runs this; so can a person with an elevated prompt.
//! - `store.exe uninstall-service` — stops and removes it. The data directory
//!   is kept: it holds the shop's unsynced sales.
//!
//! # What keeps it running
//!
//! Automatic (delayed) start, so it comes up after the network after every
//! boot. Recovery actions restart it 5 s, 30 s and 60 s after a failure, the
//! count resetting daily, and failure includes a *non-crash* exit — which is
//! how the node's own watchdog (`edge/node.rs`) turns a hang into a restart:
//! it exits with a non-zero code, and the SCM treats that as a failure.
//!
//! # Who it runs as
//!
//! Its own virtual account, `NT SERVICE\ItulahStore`, not LocalSystem. The
//! node needs its data directory and a port; it does not need the machine.

use crate::edge::{node, EdgeRole};
use std::{
    ffi::{OsStr, OsString},
    process::Command,
    sync::Mutex,
    time::Duration,
};
use windows_service::{
    define_windows_service,
    service::{
        ServiceAccess, ServiceAction, ServiceActionType, ServiceControl, ServiceControlAccept,
        ServiceErrorControl, ServiceExitCode, ServiceFailureActions, ServiceFailureResetPeriod,
        ServiceInfo, ServiceStartType, ServiceState, ServiceStatus, ServiceType,
    },
    service_control_handler::{self, ServiceControlHandlerResult},
    service_dispatcher,
    service_manager::{ServiceManager, ServiceManagerAccess},
};

pub const SERVICE_NAME: &str = "ItulahStore";
/// The service is a shop's node: `cli.rs` refuses it for the Gudang's.
const ROLE: EdgeRole = EdgeRole::Store;
const DISPLAY_NAME: &str = "itulah Store Server";
const DESCRIPTION: &str = "The shop's own node: sells offline, syncs with head office.";
const FIREWALL_RULE: &str = "itulah Store Server";
/// The rule that lets tills hear this node on the LAN (`edge/discovery.rs`):
/// multicast DNS, UDP 5353 in. Its own name, so it is added and removed
/// without touching the one for 8082.
const DISCOVERY_RULE: &str = "itulah Store Server discovery";

type BoxError = Box<dyn std::error::Error + Send + Sync>;

define_windows_service!(ffi_service_main, service_main);

/// Hand the thread to the SCM. Returns when the service has stopped.
pub fn run_dispatcher() -> Result<(), BoxError> {
    service_dispatcher::start(SERVICE_NAME, ffi_service_main)?;
    Ok(())
}

fn service_main(_arguments: Vec<OsString>) {
    if let Err(error) = run_service() {
        tracing::error!(%error, "the store service stopped with an error");
    }
}

fn status(state: ServiceState, exit: u32) -> ServiceStatus {
    ServiceStatus {
        service_type: ServiceType::OWN_PROCESS,
        current_state: state,
        controls_accepted: if state == ServiceState::Running {
            ServiceControlAccept::STOP | ServiceControlAccept::SHUTDOWN
        } else {
            ServiceControlAccept::empty()
        },
        exit_code: if exit == 0 {
            ServiceExitCode::Win32(0)
        } else {
            ServiceExitCode::ServiceSpecific(exit)
        },
        checkpoint: 0,
        wait_hint: if state == ServiceState::StopPending {
            Duration::from_secs(20)
        } else {
            Duration::default()
        },
        process_id: None,
    }
}

fn run_service() -> Result<(), BoxError> {
    let (stop, stopped) = tokio::sync::oneshot::channel::<()>();
    let stop = Mutex::new(Some(stop));
    let handle = service_control_handler::register(SERVICE_NAME, move |control| match control {
        ServiceControl::Stop | ServiceControl::Shutdown | ServiceControl::Preshutdown => {
            if let Some(stop) = stop.lock().ok().and_then(|mut slot| slot.take()) {
                let _ = stop.send(());
            }
            ServiceControlHandlerResult::NoError
        }
        ServiceControl::Interrogate => ServiceControlHandlerResult::NoError,
        _ => ServiceControlHandlerResult::NotImplemented,
    })?;
    handle.set_service_status(status(ServiceState::Running, 0))?;

    let data_dir = node::installed_data_dir(ROLE, true);
    let prepared = node::prepare_environment(data_dir.as_deref());
    let _logs = node::init_logging(ROLE, data_dir.as_deref());
    let result = match prepared {
        Ok(()) => tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
            .map_err(BoxError::from)
            .and_then(|runtime| {
                runtime.block_on(node::run(ROLE, data_dir, async move {
                    let _ = stopped.await;
                    tracing::info!("stop requested by the Service Control Manager");
                }))
            }),
        Err(error) => Err(error),
    };
    // Non-zero on failure — and on a restart the console asked for — so the
    // SCM's recovery actions start the service again.
    let exit = match &result {
        Ok(node::Exit::Stopped) => 0,
        Ok(node::Exit::Restart) => node::RESTART_EXIT_CODE as u32,
        Err(_) => 1,
    };
    handle.set_service_status(status(ServiceState::Stopped, exit))?;
    result.map(|_| ())
}

fn run_quietly(program: &str, arguments: &[&str]) -> bool {
    Command::new(program)
        .args(arguments)
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

/// Register, configure and start the service. Idempotent enough for an
/// installer's repair: an existing service is reconfigured, not duplicated.
pub fn install() -> Result<(), BoxError> {
    let manager = ServiceManager::local_computer(
        None::<&str>,
        ServiceManagerAccess::CONNECT | ServiceManagerAccess::CREATE_SERVICE,
    )?;
    let info = ServiceInfo {
        name: OsString::from(SERVICE_NAME),
        display_name: OsString::from(DISPLAY_NAME),
        service_type: ServiceType::OWN_PROCESS,
        start_type: ServiceStartType::AutoStart,
        error_control: ServiceErrorControl::Normal,
        executable_path: std::env::current_exe()?,
        launch_arguments: vec![OsString::from("service")],
        dependencies: vec![],
        account_name: Some(OsString::from(format!("NT SERVICE\\{SERVICE_NAME}"))),
        account_password: None,
    };
    let access = ServiceAccess::CHANGE_CONFIG | ServiceAccess::START | ServiceAccess::QUERY_STATUS;
    let service = match manager.create_service(&info, access) {
        Ok(service) => service,
        Err(_) => {
            let service = manager.open_service(SERVICE_NAME, access)?;
            service.change_config(&info)?;
            service
        }
    };
    service.set_description(DESCRIPTION)?;
    service.set_delayed_auto_start(true)?;
    service.update_failure_actions(ServiceFailureActions {
        reset_period: ServiceFailureResetPeriod::After(Duration::from_secs(24 * 60 * 60)),
        reboot_msg: None,
        command: None,
        actions: Some(vec![
            ServiceAction {
                action_type: ServiceActionType::Restart,
                delay: Duration::from_secs(5),
            },
            ServiceAction {
                action_type: ServiceActionType::Restart,
                delay: Duration::from_secs(30),
            },
            ServiceAction {
                action_type: ServiceActionType::Restart,
                delay: Duration::from_secs(60),
            },
        ]),
    })?;
    service.set_failure_actions_on_non_crash_failures(true)?;

    // The data directory: the service account may change it, administrators
    // and SYSTEM own it, and nobody else can read it — it holds the sync key.
    if let Some(dir) = node::installed_data_dir(ROLE, true) {
        std::fs::create_dir_all(&dir)?;
        let dir = dir.to_string_lossy().into_owned();
        let account = format!("NT SERVICE\\{SERVICE_NAME}:(OI)(CI)M");
        if !run_quietly(
            "icacls",
            &[
                &dir,
                "/inheritance:r",
                "/grant:r",
                "*S-1-5-18:(OI)(CI)F",
                "*S-1-5-32-544:(OI)(CI)F",
                &account,
            ],
        ) {
            eprintln!("warning: could not restrict {dir}; restrict it by hand");
        }
    }

    // Tills and tablets reach the node over the shop's LAN. Private and
    // domain networks only: a laptop-server on café wifi stays closed.
    run_quietly(
        "netsh",
        &[
            "advfirewall",
            "firewall",
            "delete",
            "rule",
            &format!("name={FIREWALL_RULE}"),
        ],
    );
    if !run_quietly(
        "netsh",
        &[
            "advfirewall",
            "firewall",
            "add",
            "rule",
            &format!("name={FIREWALL_RULE}"),
            "dir=in",
            "action=allow",
            "protocol=TCP",
            "localport=8082",
            "profile=private,domain",
        ],
    ) {
        eprintln!("warning: could not add the firewall rule for port 8082");
    }
    // And the node answers tills looking for it: an mDNS query arrives on UDP
    // 5353, and a node whose firewall drops it is a node every till has to be
    // given by address. The same profiles, for the same reason.
    run_quietly(
        "netsh",
        &[
            "advfirewall",
            "firewall",
            "delete",
            "rule",
            &format!("name={DISCOVERY_RULE}"),
        ],
    );
    if !run_quietly(
        "netsh",
        &[
            "advfirewall",
            "firewall",
            "add",
            "rule",
            &format!("name={DISCOVERY_RULE}"),
            "dir=in",
            "action=allow",
            "protocol=UDP",
            "localport=5353",
            "profile=private,domain",
        ],
    ) {
        eprintln!(
            "warning: could not add the firewall rule for UDP 5353; tills will not find this node on the LAN and must be given its address"
        );
    }

    service.start(&[] as &[&OsStr])?;
    println!("{DISPLAY_NAME} installed and started.");
    Ok(())
}

/// Stop and remove the service and its firewall rule. The data stays.
pub fn uninstall() -> Result<(), BoxError> {
    let manager = ServiceManager::local_computer(None::<&str>, ServiceManagerAccess::CONNECT)?;
    let service = manager.open_service(
        SERVICE_NAME,
        ServiceAccess::STOP | ServiceAccess::DELETE | ServiceAccess::QUERY_STATUS,
    )?;
    if service.query_status()?.current_state != ServiceState::Stopped {
        let _ = service.stop();
        for _ in 0..30 {
            std::thread::sleep(Duration::from_secs(1));
            if service.query_status()?.current_state == ServiceState::Stopped {
                break;
            }
        }
    }
    service.delete()?;
    for rule in [FIREWALL_RULE, DISCOVERY_RULE] {
        run_quietly(
            "netsh",
            &[
                "advfirewall",
                "firewall",
                "delete",
                "rule",
                &format!("name={rule}"),
            ],
        );
    }
    println!("{DISPLAY_NAME} removed. Its data directory was kept.");
    Ok(())
}
