//! What the setup page checks on the PC before the code, and again once Ready.
//!
//! Every row here is something that went wrong on 28 Oct 2026, when C015's
//! server was installed on a laptop in front of an audience and fixed by hand
//! with a dozen commands (docs/research/2026-10-29-install-laptop-c015.md):
//! the store app missing from the install, a Wi-Fi Windows called Public (the
//! firewall rule opens Private networks only), the laptop on battery and free
//! to sleep, and the POS on the same laptop still joined to another store.
//! The page shows them before anyone types a code. Two of them — the
//! network and sleep — the MSI fixes as it installs (`prepare_pc`), and the
//! page fixes again with one click and Windows' administrator question.
//!
//! # Loopback only
//!
//! Like the console, these answer only to the machine itself. Before
//! enrolment the setup server listens on 127.0.0.1 anyway; after it, the
//! node checks the caller.

use axum::{
    extract::{ConnectInfo, State},
    http::StatusCode,
    response::{Html, IntoResponse, Response},
    routing::get,
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::{net::SocketAddr, path::PathBuf, time::Duration};

#[derive(Clone)]
pub struct Laptop {
    /// The store app this node serves (`<exe>/web` when installed).
    pub frontend: PathBuf,
    /// Central's address, when this build or the enrolment knows it.
    pub cloud: Option<String>,
    pub bind: SocketAddr,
    pub client: reqwest::Client,
}

impl Laptop {
    pub fn new(frontend: PathBuf, cloud: Option<String>, bind: SocketAddr) -> Self {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(6))
            .build()
            .unwrap_or_default();
        Self {
            frontend,
            cloud,
            bind,
            client,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Tone {
    Ok,
    Warn,
    Bad,
}

#[derive(Debug, Serialize)]
pub struct Check {
    pub id: &'static str,
    pub tone: Tone,
    pub title: String,
    pub detail: String,
    /// What the page offers for it (`network`, `awake`): both run `prepare-pc`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fix: Option<&'static str>,
    /// Setting up goes no further until this one is fixed.
    pub blocks: bool,
}

impl Check {
    fn new(
        id: &'static str,
        tone: Tone,
        title: impl Into<String>,
        detail: impl Into<String>,
    ) -> Self {
        Self {
            id,
            tone,
            title: title.into(),
            detail: detail.into(),
            fix: None,
            blocks: false,
        }
    }
    fn fix(mut self, fix: &'static str) -> Self {
        self.fix = Some(fix);
        self
    }
    fn blocking(mut self) -> Self {
        self.blocks = true;
        self
    }
}

#[derive(Debug, Serialize)]
pub struct Report {
    /// The PC's name, as Central will show it.
    pub pc: String,
    /// Where tills and tablets open the store app: the LAN IP, never `.local`.
    pub address: Option<String>,
    /// The network those tills and tablets share with this PC.
    pub network: Option<String>,
    pub version: &'static str,
    pub checks: Vec<Check>,
}

/// What Windows says about itself, in one PowerShell run.
#[derive(Debug, Default, Deserialize)]
struct Probe {
    os: Option<String>,
    free: Option<i64>,
    net: Option<Net>,
    battery: Option<Battery>,
    /// The AC "sleep after" index; 0 is never.
    sleep_ac: Option<i64>,
    /// The AC lid-close action; 0 is do nothing.
    lid_ac: Option<i64>,
    firewall: Option<bool>,
    #[serde(default)]
    pos: Vec<PosFile>,
}

#[derive(Debug, Deserialize)]
struct Net {
    name: Option<String>,
    index: Option<i64>,
    category: Option<String>,
}

#[derive(Debug, Deserialize)]
struct Battery {
    charge: Option<i64>,
    status: Option<i64>,
}

/// A Central POS's `node.json` on this PC, one per Windows user.
#[derive(Debug, Deserialize)]
struct PosFile {
    base_url: Option<String>,
    label: Option<String>,
    site: Option<String>,
    name: Option<String>,
}

/// The network the default route leaves by, its category, the battery, the
/// AC sleep and lid settings, the firewall rule `install-service` adds and
/// every Central POS's settings file. Errors leave fields empty, never fail.
const PROBE: &str = r#"
$ErrorActionPreference='SilentlyContinue'
[Console]::OutputEncoding=[Text.Encoding]::UTF8
$os=(Get-CimInstance Win32_OperatingSystem).Caption
$disk=Get-CimInstance Win32_LogicalDisk -Filter ("DeviceID='"+$env:SystemDrive+"'")
$route=Get-NetRoute -DestinationPrefix '0.0.0.0/0' | Sort-Object RouteMetric | Select-Object -First 1
$net=$null
if($route){$p=Get-NetConnectionProfile -InterfaceIndex $route.ifIndex | Select-Object -First 1
  if($p){$net=@{name=$p.Name;index=[int]$p.InterfaceIndex;category=[string]$p.NetworkCategory}}}
$b=Get-CimInstance Win32_Battery | Select-Object -First 1
$bat=$null; if($b){$bat=@{charge=[int]$b.EstimatedChargeRemaining;status=[int]$b.BatteryStatus}}
function AcIndex($sub,$setting){$m=[regex]::Matches((powercfg /query SCHEME_CURRENT $sub $setting | Out-String),'0x[0-9a-fA-F]{8}')
  if($m.Count -ge 2){[Convert]::ToInt64($m[$m.Count-2].Value,16)}else{-1}}
$fw=[bool](Get-NetFirewallRule -DisplayName 'itulah Store Server' | Where-Object {$_.Enabled -eq 'True'})
$pos=@(Get-ChildItem 'C:\Users\*\AppData\Roaming\id.itulah.kasir.desktop\node.json' | ForEach-Object {
  $j=Get-Content $_.FullName -Raw -Encoding UTF8 | ConvertFrom-Json
  @{base_url=$j.base_url;label=$j.joined.label;site=$j.joined.site_code;name=$j.joined.site_name}})
@{os=$os;free=[int64]$disk.FreeSpace;net=$net;battery=$bat;sleep_ac=(AcIndex SUB_SLEEP STANDBYIDLE);lid_ac=(AcIndex SUB_BUTTONS LIDACTION);firewall=$fw;pos=$pos} | ConvertTo-Json -Compress -Depth 4
"#;

#[cfg(windows)]
fn powershell(script: &str) -> Option<String> {
    use std::os::windows::process::CommandExt as _;
    // No console window flashing up on the person's screen.
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let output = std::process::Command::new("powershell.exe")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            script,
        ])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .ok()?;
    output
        .status
        .success()
        .then(|| String::from_utf8_lossy(&output.stdout).trim().to_owned())
}

#[cfg(not(windows))]
fn powershell(_script: &str) -> Option<String> {
    None
}

fn probe() -> Probe {
    powershell(PROBE)
        .and_then(|text| serde_json::from_str(text.trim_start_matches('\u{feff}')).ok())
        .unwrap_or_default()
}

fn pc_name() -> String {
    std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_else(|_| "This PC".into())
}

fn host_of(url: &str) -> &str {
    let rest = url.split("://").nth(1).unwrap_or(url);
    rest.split(['/', ':']).next().unwrap_or(rest)
}

/// Win32_Battery's status: 1 discharging, 4 low, 5 critical — on battery.
fn on_battery(status: Option<i64>) -> bool {
    matches!(status, Some(1 | 4 | 5))
}

/// A POS that already talks to this PC: loopback, or this PC's own address.
fn joined_here(base_url: &str, address: Option<&str>, port: u16) -> bool {
    let host = host_of(base_url);
    let same_port =
        base_url.ends_with(&format!(":{port}")) || base_url.contains(&format!(":{port}/"));
    same_port
        && (host == "127.0.0.1"
            || host == "localhost"
            || address.is_some_and(|address| host_of(address) == host))
}

fn gigabytes(bytes: i64) -> i64 {
    bytes / 1_000_000_000
}

impl Laptop {
    async fn central(&self) -> Check {
        let Some(cloud) = self.cloud.as_deref() else {
            return Check::new(
                "central",
                Tone::Bad,
                "Central",
                "This build doesn't know Central's address",
            )
            .blocking();
        };
        let host = host_of(cloud).to_owned();
        let answer = self
            .client
            .get(format!("{}/api/v1/health", cloud.trim_end_matches('/')))
            .send()
            .await;
        match answer {
            Ok(response) if response.status().is_success() => {
                Check::new("central", Tone::Ok, "Central", format!("{host} answers"))
            }
            Ok(response) => Check::new(
                "central",
                Tone::Bad,
                "Central",
                format!("{host} answers {}", response.status()),
            )
            .blocking(),
            Err(_) => Check::new(
                "central",
                Tone::Bad,
                "Central",
                format!("{host} doesn't answer · check the internet"),
            )
            .blocking(),
        }
    }

    pub async fn report(&self) -> Report {
        let probe = tokio::task::spawn_blocking(probe).await.unwrap_or_default();
        let address = crate::edge::discovery::app_address(&pc_name(), self.bind);
        let mut checks = Vec::new();

        let mut about = Vec::new();
        if let Some(os) = probe.os.as_deref().filter(|os| !os.is_empty()) {
            about.push(os.trim_start_matches("Microsoft ").to_owned());
        }
        if let Some(free) = probe.free.filter(|free| *free > 0) {
            about.push(format!("{} GB free", gigabytes(free)));
        }
        checks.push(Check::new("pc", Tone::Ok, pc_name(), about.join(" · ")));
        checks.push(self.central().await);

        checks.push(if self.frontend.join("index.html").is_file() {
            Check::new(
                "store_app",
                Tone::Ok,
                "Store app",
                format!("Served on port {}", self.bind.port()),
            )
        } else {
            Check::new(
                "store_app",
                Tone::Bad,
                "Store app",
                "Missing from this install · ask head office for the installer again",
            )
            .blocking()
        });

        let network = probe.net.as_ref().and_then(|net| net.name.clone());
        if let Some(net) = &probe.net {
            let name = net.name.clone().unwrap_or_else(|| "Network".into());
            let private = matches!(
                net.category.as_deref(),
                Some("Private" | "DomainAuthenticated")
            );
            checks.push(if private {
                Check::new(
                    "network",
                    Tone::Ok,
                    name,
                    "Private · POS and tablets on it can reach this PC",
                )
            } else {
                Check::new(
                    "network",
                    Tone::Warn,
                    name,
                    "Public · POS and tablets can't reach this PC",
                )
                .fix("network")
                .blocking()
            });
        }
        if let Some(open) = probe.firewall {
            checks.push(if open {
                Check::new(
                    "firewall",
                    Tone::Ok,
                    "Firewall",
                    format!("Port {} open on Private networks", self.bind.port()),
                )
            } else {
                Check::new(
                    "firewall",
                    Tone::Warn,
                    "Firewall",
                    format!(
                        "Port {} is closed · run the installer again",
                        self.bind.port()
                    ),
                )
            });
        }
        if let Some(battery) = &probe.battery {
            let charge = battery
                .charge
                .map(|charge| format!(", {charge}%"))
                .unwrap_or_default();
            checks.push(if on_battery(battery.status) {
                Check::new(
                    "power",
                    Tone::Warn,
                    "Power",
                    format!("On battery{charge} · plug in the charger"),
                )
            } else {
                Check::new("power", Tone::Ok, "Power", "Plugged in")
            });
        }
        if let (Some(sleep), Some(lid)) = (probe.sleep_ac, probe.lid_ac) {
            // -1: Windows did not say (no lid setting on this PC); sleep decides.
            let awake = sleep == 0 && (lid <= 0 || probe.battery.is_none());
            checks.push(if awake {
                Check::new("awake", Tone::Ok, "Sleep", "Off while plugged in")
            } else {
                Check::new(
                    "awake",
                    Tone::Warn,
                    "Sleep",
                    "On · the server stops when this PC sleeps or its lid closes",
                )
                .fix("awake")
            });
        }
        for pos in &probe.pos {
            let label = pos.label.clone().unwrap_or_else(|| "Central POS".into());
            let store = match (&pos.site, &pos.name) {
                (Some(site), Some(name)) if name.contains(site.trim_end_matches("-TOKO")) => {
                    name.clone()
                }
                (Some(site), Some(name)) => format!("{site} · {name}"),
                (Some(only), None) | (None, Some(only)) => only.clone(),
                (None, None) => "no store".into(),
            };
            let here = pos
                .base_url
                .as_deref()
                .is_some_and(|url| joined_here(url, address.as_deref(), self.bind.port()));
            checks.push(if here {
                Check::new(
                    "pos",
                    Tone::Ok,
                    "Central POS on this PC",
                    format!("{label} of this store"),
                )
            } else {
                Check::new(
                    "pos",
                    Tone::Warn,
                    "Central POS on this PC",
                    format!("{label} of {store} · it can move here once this server is ready"),
                )
            });
        }
        Report {
            pc: pc_name(),
            address,
            network,
            version: env!("CARGO_PKG_VERSION"),
            checks,
        }
    }
}

/// Make the network this PC reaches Central by Private when Windows calls it
/// Public, and keep the PC awake on mains (sleep never, lid does nothing).
/// Needs an administrator: the MSI runs it as SYSTEM right after installing
/// the service, and the setup page's buttons run it through
/// `central-store://prepare-pc` (`open_link`), which asks Windows' UAC. The
/// service itself runs as `NT SERVICE\ItulahStore` and may do neither.
const PREPARE: &str = r#"
$ErrorActionPreference='Stop'
$route=Get-NetRoute -DestinationPrefix '0.0.0.0/0' | Sort-Object RouteMetric | Select-Object -First 1
if($route){$p=Get-NetConnectionProfile -InterfaceIndex $route.ifIndex | Select-Object -First 1
  if($p -and [string]$p.NetworkCategory -eq 'Public'){Set-NetConnectionProfile -InterfaceIndex $route.ifIndex -NetworkCategory Private}}
powercfg /setacvalueindex SCHEME_CURRENT SUB_SLEEP STANDBYIDLE 0
powercfg /setacvalueindex SCHEME_CURRENT SUB_BUTTONS LIDACTION 0
powercfg /setactive SCHEME_CURRENT
"#;

pub fn prepare_pc() -> Result<(), String> {
    powershell(PREPARE)
        .map(|_| ())
        .ok_or_else(|| "Windows refused the change; run it as an administrator.".into())
}

/// Who listens on `port` on this PC, other than this server's own service:
/// "store-edge.exe (C:\Program Files\StoreEdge\store-edge.exe)". On
/// riza-1 an old StoreEdge held 8082 and the setup window opened on nothing
/// (30 Oct 2026); `install-service` asks this first and says who it is.
pub fn port_holder(port: u16) -> Option<String> {
    let script = format!(
        r#"$ErrorActionPreference='SilentlyContinue'
$c = Get-NetTCPConnection -LocalPort {port} -State Listen | Select-Object -First 1
if (-not $c) {{ exit 0 }}
$own = (Get-CimInstance Win32_Service -Filter "Name='ItulahStore'").ProcessId
if ($own -and $c.OwningProcess -eq $own) {{ exit 0 }}
$p = Get-CimInstance Win32_Process -Filter ("ProcessId=" + $c.OwningProcess)
"$($p.Name) ($($p.ExecutablePath))""#
    );
    powershell(&script).filter(|text| !text.trim().is_empty())
}

/// A PC that was another store's server, which Central no longer knows — its
/// store removed or its server disconnected — starts again as a new one: the
/// old data moves aside (kept, never deleted) and the server comes back
/// waiting for an install code. Only when Central refuses this PC's key: a
/// server Central still knows is replaced from Central, not here.
///
/// On DESKTOP-6Q3F7V9 (30 Oct 2026) the service stopped, the folder never
/// moved and the server stayed down: the database was still held a moment
/// after Stop-Service returned, and the script ended before Start-Service.
/// Now the service's own process is waited for (and ended if it lingers), the
/// move is retried for ten seconds, and the service is started again whatever
/// happened — a PC is never left without its server.
const START_OVER: &str = r#"
$ErrorActionPreference='Stop'
$s = Invoke-RestMethod http://127.0.0.1:8082/console/status -TimeoutSec 8
if ([string]$s.status.sync.last_error -notmatch '403|forbidden') { exit 3 }
$dir = Join-Path $env:ProgramData 'itulah\store'
$moved = $false
try {
  $svc = (Get-CimInstance Win32_Service -Filter "Name='ItulahStore'").ProcessId
  Stop-Service ItulahStore -Force -NoWait -ErrorAction SilentlyContinue
  for ($i = 0; $i -lt 30 -and (Get-Service ItulahStore).Status -ne 'Stopped'; $i++) { Start-Sleep -Milliseconds 500 }
  if ($svc) { Stop-Process -Id $svc -Force -ErrorAction SilentlyContinue }
  for ($i = 0; $i -lt 20 -and -not $moved; $i++) {
    try { Rename-Item $dir ('store.old-' + (Get-Date -Format 'yyyyMMdd-HHmmss')) -ErrorAction Stop; $moved = $true }
    catch { Start-Sleep -Milliseconds 500 }
  }
} finally {
  Start-Service ItulahStore -ErrorAction SilentlyContinue
}
if (-not $moved) { exit 4 }
"#;

pub fn start_over() -> Result<(), String> {
    powershell(START_OVER).map(|_| ()).ok_or_else(|| {
        "Not started over: Central still knows this PC, or its old data could not be moved \
         aside (the server is running again). Close Central POS, Gudang and the store app, then \
         try again."
            .into()
    })
}

/// `store.exe open-link central-store://prepare-pc` (or `start-over`),
/// registered by the MSI as the handler of `central-store:` links: run that
/// command elevated, which is where Windows asks the person at the PC for an
/// administrator's yes.
pub fn open_link(link: &str) -> Result<(), String> {
    let link = link.trim_end_matches('/');
    let command = ["prepare-pc", "start-over"]
        .into_iter()
        .find(|command| link.ends_with(command))
        .ok_or_else(|| format!("Central Store Server opens no link like {link}."))?;
    let exe = std::env::current_exe().map_err(|error| error.to_string())?;
    let exe = exe.display().to_string().replace('\'', "''");
    powershell(&format!(
        "Start-Process -FilePath '{exe}' -ArgumentList '{command}' -Verb RunAs -WindowStyle Hidden -Wait"
    ))
    .map(|_| ())
    .ok_or_else(|| "Not changed: Windows' administrator question was declined.".into())
}

fn not_here() -> Response {
    (
        StatusCode::FORBIDDEN,
        "Setup answers only on the server machine itself (127.0.0.1).",
    )
        .into_response()
}

async fn page(ConnectInfo(from): ConnectInfo<SocketAddr>) -> Response {
    if !from.ip().is_loopback() {
        return not_here();
    }
    Html(include_str!("enrolment_setup.html")).into_response()
}

async fn checks(
    ConnectInfo(from): ConnectInfo<SocketAddr>,
    State(laptop): State<Laptop>,
) -> Response {
    if !from.ip().is_loopback() {
        return not_here();
    }
    Json(laptop.report().await).into_response()
}

/// The checks. `with_page` adds `/setup` itself, for the running
/// node: before enrolment the setup server serves the page, and after it the
/// same page keeps answering (it used to 404, which read as broken).
pub fn router(laptop: Laptop, with_page: bool) -> Router {
    let routes = Router::new().route("/setup/checks", get(checks));
    let routes = if with_page {
        routes.route("/setup", get(page))
    } else {
        routes
    };
    routes.with_state(laptop)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_pos_on_this_pc_is_one_that_talks_to_it() {
        let here = Some("http://192.168.1.20:8082");
        assert!(joined_here("http://127.0.0.1:8082", here, 8082));
        assert!(joined_here("http://192.168.1.20:8082", here, 8082));
        assert!(!joined_here("http://192.168.1.242:8092", here, 8082));
        assert!(!joined_here("http://192.168.1.20:8092", here, 8082));
    }

    #[test]
    fn windows_answer_reads_whole() {
        let text = r#"{"os":"Microsoft Windows 11 Pro","free":212000000000,"net":{"name":"Hari Riza","index":12,"category":"Public"},"battery":{"charge":51,"status":1},"sleep_ac":900,"lid_ac":1,"firewall":true,"pos":[{"base_url":"http://192.168.1.242:8092","label":"Kasir 2","site":"C001-TOKO","name":"C001 · Cikupa"}]}"#;
        let probe: Probe = serde_json::from_str(text).unwrap_or_default();
        assert_eq!(
            probe.net.and_then(|net| net.category).as_deref(),
            Some("Public")
        );
        assert!(on_battery(probe.battery.and_then(|battery| battery.status)));
        assert_eq!(probe.pos.len(), 1);
    }
}
