// Central on the desktop: the hosted hub in its own window, not a copy.
//
// Loading the real hub (rather than a bundled build) keeps it on its own
// origin, so the `SameSite=Strict` session cookie and the `/api` proxy work
// exactly as in a browser, and every deploy reaches the desktop at once.
// What the shell adds is what a browser tab cannot do: a tray icon, starting
// at login, native notifications from the notification stream (a webview has
// no Web Push) that open what they are about when clicked, updating itself,
// and — on macOS, where WKWebView ignores them — printing and downloads.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};
use tauri::ipc::CapabilityBuilder;
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::webview::{DownloadEvent, NewWindowResponse, PageLoadEvent};
use tauri::{AppHandle, Manager, Url, Webview, WebviewUrl, WebviewWindowBuilder, WindowEvent};
#[cfg(target_os = "macos")]
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_autostart::ManagerExt as _;
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_updater::{Update, UpdaterExt};
use tauri_plugin_window_state::StateFlags;
use user_notify::{NotificationBuilder, NotificationManager, NotificationResponseAction};

const MAIN: &str = "main";
const DEFAULT_HUB_URL: &str = "https://hub.34-128-98-21.sslip.io";
/// Passed by the login item, so a start at login lands in the tray.
const HIDDEN_ARG: &str = "--hidden";
/// `Central --quit` asks the running Central to quit as if from the tray, so
/// a pending update goes in (installers, IT scripts).
const QUIT_ARG: &str = "--quit";
/// The address a Windows notification opens when clicked: Windows starts
/// `Central central://…`, from the banner or from Notification Center, even
/// when Central is not running; the installer registers it.
const NOTIFICATION_SCHEME: &str = "central";
/// How often a running Central asks whether there is a newer one.
const UPDATE_EVERY: Duration = Duration::from_secs(6 * 60 * 60);

/// The hub's address: `ITULAH_HUB_URL` at run time (dev), then at build time
/// (a build for another deployment), then the hosted hub.
fn hub_url() -> Url {
    std::env::var("ITULAH_HUB_URL")
        .ok()
        .or_else(|| option_env!("ITULAH_HUB_URL").map(str::to_owned))
        .and_then(|raw| Url::parse(&raw).ok())
        .unwrap_or_else(|| Url::parse(DEFAULT_HUB_URL).expect("default hub url"))
}

fn is_hub(url: &Url, hub: &Url) -> bool {
    url.origin() == hub.origin()
}

fn data_url(html: &str) -> Result<Url, url::ParseError> {
    Url::parse(&format!(
        "data:text/html;charset=utf-8,{}",
        utf8_percent_encode(html, NON_ALPHANUMERIC)
    ))
}

/// What the window opens on: a page that goes to the hub as soon as it
/// answers, and says so plainly when it does not — instead of a blank window.
fn launch_url(hub: &Url) -> Url {
    let hub_json = format!("\"{}\"", hub.as_str().replace(['"', '\\', '<'], ""));
    data_url(&include_str!("launch.html").replace("__HUB__", &hub_json)).expect("launch page")
}

/// Everything the page learns about the shell. Runs in the main frame of the
/// hub window only, before the hub's own scripts.
fn bridge_script() -> String {
    let mut script = String::from(
        r#"(() => {
  if (window.itulahDesktop) return
  const invoke = (cmd, args) => window.__TAURI_INTERNALS__.invoke(cmd, args)
  Object.defineProperty(window, "itulahDesktop", {
    value: Object.freeze({
      isDesktop: true,
      notify: (title, body, url) =>
        invoke("notify", {
          title: String(title),
          body: String(body ?? ""),
          url: url == null ? null : String(url),
        }).catch(() => {}),
    }),
  })
"#,
    );
    // WKWebView drops `window.print()` without a word; hand it to the shell,
    // which opens the system print panel for the same page.
    //
    // A blank `window.open` view that the page writes a document into and
    // prints (the supplier sheet) cannot be printed at all from WKWebView, so
    // the page gets a stand-in that collects what is written and asks the
    // shell to open and print it in a window of its own.
    if cfg!(target_os = "macos") {
        script.push_str(
            r#"  window.print = () => { invoke("print").catch(() => {}) }
  const open = window.open.bind(window)
  window.open = (url, ...rest) => {
    if (url && String(url) !== "about:blank") return open(url, ...rest)
    let html = ""
    const view = {
      closed: false,
      document: {
        open() { html = "" },
        write(...parts) { html += parts.join("") },
        writeln(...parts) { html += parts.join("") + "\n" },
        close() {},
      },
      focus() {},
      close() { view.closed = true },
      print() { invoke("print_html", { html }).catch(() => {}) },
    }
    return view
  }
"#,
        );
    }
    script.push_str("})()\n");
    script
}

#[derive(Default)]
struct Shell {
    /// Where each download is going, by url: WKWebView only names the url
    /// when it finishes.
    downloads: Mutex<HashMap<String, PathBuf>>,
}

struct Notifier(Arc<dyn NotificationManager>);

/// The update that has been downloaded and checked, waiting for Central to
/// quit; and the tray item that offers to install it now.
struct Updates {
    ready: Mutex<Option<(Update, Vec<u8>)>>,
    /// The version waiting, while its banner is offered in the window.
    offered: Mutex<Option<String>>,
    menu: Menu<tauri::Wry>,
    item: MenuItem<tauri::Wry>,
}

fn clip(text: &str, max: usize) -> String {
    text.chars().take(max).collect()
}

/// Shows a notification that, when clicked, brings Central forward on `url`.
fn send_notification(app: &AppHandle, title: &str, body: &str, url: Option<String>) {
    let notifier = app.state::<Notifier>().0.clone();
    let mut info = HashMap::new();
    if let Some(url) = url {
        info.insert("url".to_owned(), url);
    }
    let builder = NotificationBuilder::new()
        .title(&clip(title, 200))
        .body(&clip(body, 1000))
        .set_user_info(info);
    tauri::async_runtime::spawn(async move {
        // macOS asks the person once, the first time there is something to say.
        let _ = notifier.first_time_ask_for_notification_permission().await;
        let _ = notifier.send_notification(builder).await;
    });
}

/// A notification clicked on Windows arrives as a `central://` argument, to a
/// Central starting up or (through single-instance) to the one running.
fn open_notification_links(app: &AppHandle, args: &[String]) -> bool {
    let prefix = format!("{NOTIFICATION_SCHEME}:");
    let Some(link) = args.iter().find(|arg| arg.starts_with(&prefix)) else {
        return false;
    };
    #[cfg(windows)]
    if let Ok(response) = user_notify::windows::decode_deeplink(link) {
        if response.action == NotificationResponseAction::Default {
            open_from_notification(app, response.user_info.get("url").cloned());
        }
        return true;
    }
    let _ = link;
    show_main(app);
    true
}

/// A clicked notification: Central comes forward, on the page it was about.
fn open_from_notification(app: &AppHandle, url: Option<String>) {
    show_main(app);
    let hub = hub_url();
    let target = url.and_then(|url| hub.join(&url).ok());
    if let (Some(target), Some(window)) = (target, app.get_webview_window(MAIN)) {
        if is_hub(&target, &hub) {
            let _ = window.navigate(target);
        }
    }
}

#[tauri::command]
fn notify(app: AppHandle, title: String, body: String, url: Option<String>) {
    send_notification(&app, &title, &body, url);
}

#[tauri::command]
fn print(webview: Webview) -> Result<(), String> {
    webview.print().map_err(|error| error.to_string())
}

/// Opens the document a page wrote into a blank view in a window of its own
/// and prints it once it has been drawn. Async, because a window built from a
/// command on the main thread deadlocks on Windows.
#[tauri::command]
async fn print_html(app: AppHandle, html: String) -> Result<(), String> {
    let url = data_url(&html).map_err(|error| error.to_string())?;
    let printed = AtomicBool::new(false);
    view_builder(&app, url)
        .inner_size(820.0, 1000.0)
        .on_page_load(move |webview, payload| {
            if payload.event() == PageLoadEvent::Finished && !printed.swap(true, Ordering::Relaxed)
            {
                let _ = webview.print();
            }
        })
        .build()
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn open_outside(app: &AppHandle, url: &Url) {
    let _ = app.opener().open_url(url.as_str(), None::<&str>);
}

/// A second window of Central: a hub page opened from a `target="_blank"`
/// link, or a document to print. It keeps to the hub like the main one.
fn view_builder(app: &AppHandle, url: Url) -> WebviewWindowBuilder<'_, tauri::Wry, AppHandle> {
    static NEXT: AtomicUsize = AtomicUsize::new(1);
    let label = format!("view-{}", NEXT.fetch_add(1, Ordering::Relaxed));
    let hub = hub_url();
    let outside = app.clone();
    WebviewWindowBuilder::new(app, label, WebviewUrl::External(url))
        .title("Central")
        .inner_size(1280.0, 860.0)
        .on_document_title_changed(|window, title| {
            let _ = window.set_title(&title);
        })
        .on_navigation(move |url| {
            if matches!(url.scheme(), "http" | "https") && !is_hub(url, &hub) {
                open_outside(&outside, url);
                return false;
            }
            true
        })
}

fn create_main(app: &AppHandle, hidden: bool) -> tauri::Result<()> {
    let hub = hub_url();
    let nav_app = app.clone();
    let nav_hub = hub.clone();
    let popup_app = app.clone();
    let popup_hub = hub.clone();
    let download_app = app.clone();

    WebviewWindowBuilder::new(app, MAIN, WebviewUrl::External(launch_url(&hub)))
        .title("Central")
        .inner_size(1440.0, 900.0)
        .min_inner_size(960.0, 600.0)
        .background_color(tauri::window::Color(247, 248, 250, 255))
        .visible(!hidden)
        .initialization_script(bridge_script())
        // A page loaded afresh still shows a waiting update.
        .on_page_load(|webview, payload| {
            if payload.event() == PageLoadEvent::Finished {
                offer_update(webview.app_handle());
            }
        })
        // The hub stays in the window; anything else opens in the browser.
        .on_navigation(move |url| {
            if matches!(url.scheme(), "http" | "https") && !is_hub(url, &nav_hub) {
                open_outside(&nav_app, url);
                return false;
            }
            true
        })
        // A blank view is left to the webview (macOS never gets here: the
        // bridge stands in for it); a hub page opens in a Central window of
        // its own; anything else in the browser.
        .on_new_window(move |url, _features| {
            if url.scheme() == "about" {
                return NewWindowResponse::Allow;
            }
            if is_hub(&url, &popup_hub) {
                let _ = view_builder(&popup_app, url).build();
            } else {
                open_outside(&popup_app, &url);
            }
            NewWindowResponse::Deny
        })
        // An export lands in Downloads, as in a browser, and says so.
        .on_download(move |_webview, event| {
            let shell = download_app.state::<Shell>();
            match event {
                DownloadEvent::Requested { url, destination } => {
                    shell
                        .downloads
                        .lock()
                        .unwrap()
                        .insert(url.to_string(), destination.clone());
                }
                DownloadEvent::Finished { url, path, success } => {
                    let went = shell.downloads.lock().unwrap().remove(url.as_str());
                    if success {
                        if let Some(name) = path
                            .or(went)
                            .as_deref()
                            .and_then(|path| path.file_name())
                            .map(|name| name.to_string_lossy().into_owned())
                        {
                            send_notification(&download_app, "Downloaded", &name, None);
                        }
                    }
                }
                _ => {}
            }
            true
        })
        .build()?;
    Ok(())
}

/// Checks for a newer Central now and every few hours, and downloads it in
/// the background. It installs when Central quits — never in the middle of
/// somebody's work — or straight away from the tray.
fn watch_for_updates(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(10)).await;
        loop {
            if let Err(error) = fetch_update(&app).await {
                eprintln!("update check: {error}");
            }
            tokio::time::sleep(UPDATE_EVERY).await;
        }
    });
}

fn updater_builder(app: &AppHandle) -> Result<tauri_plugin_updater::UpdaterBuilder, String> {
    let mut updater = app.updater_builder();
    // Another feed, for trying a release before it goes out.
    if let Ok(feed) = std::env::var("CENTRAL_UPDATE_URL") {
        let feed = feed
            .parse()
            .map_err(|error: url::ParseError| error.to_string())?;
        updater = updater
            .endpoints(vec![feed])
            .map_err(|error| error.to_string())?;
    }
    Ok(updater)
}

async fn fetch_update(app: &AppHandle) -> Result<(), String> {
    let updates = app.state::<Updates>();
    if updates.ready.lock().unwrap().is_some() {
        return Ok(());
    }
    let update = updater_builder(app)?
        .build()
        .map_err(|error| error.to_string())?;
    let Some(update) = update.check().await.map_err(|error| error.to_string())? else {
        return Ok(());
    };
    let bytes = update
        .download(|_, _| {}, || {})
        .await
        .map_err(|error| error.to_string())?;
    let version = update.version.clone();
    *updates.ready.lock().unwrap() = Some((update, bytes));
    if main_hidden(app) {
        install_quietly(app.clone());
        return Ok(());
    }
    let _ = updates
        .item
        .set_text(format!("Restart to install {version}"));
    let _ = updates.menu.insert(&updates.item, 0);
    *updates.offered.lock().unwrap() = Some(version);
    offer_update(app);
    Ok(())
}

/// The banner at the top of the window while an update waits for somebody
/// who is using Central: Restart now, or it goes in when the window closes.
/// Drawn in a shadow root so the hub's styles and Central's cannot touch.
fn update_banner_script(version: &str) -> String {
    let version = version.replace(
        |c: char| !(c.is_ascii_alphanumeric() || c == '.' || c == '-'),
        "",
    );
    format!(
        r#"(() => {{
  const version = "{version}"
  if (document.getElementById("central-update")) return
  try {{ if (sessionStorage.getItem("central-update-dismissed") === version) return }} catch {{}}
  const host = document.createElement("div")
  host.id = "central-update"
  host.style.cssText = "position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:2147483647"
  const root = host.attachShadow({{ mode: "closed" }})
  root.innerHTML = `<style>
    .bar {{ display:flex; align-items:center; gap:12px; height:48px; padding:0 6px 0 16px; border-radius:12px;
      background:#18181b; color:#fafafa; font:400 14px/1 Inter,-apple-system,"Segoe UI",system-ui,sans-serif;
      box-shadow:0 8px 24px rgba(0,0,0,.18); white-space:nowrap; }}
    button {{ font:inherit; cursor:pointer; border:0; border-radius:8px; height:36px; }}
    .restart {{ padding:0 14px; background:#fafafa; color:#18181b; font-weight:500; }}
    .close {{ width:36px; background:transparent; color:#a1a1aa; font-size:18px; }}
    .close:hover {{ color:#fafafa; }}
  </style>
  <div class="bar" role="status"><span>Central ${{version}} is ready</span>
    <button class="restart" type="button">Restart</button>
    <button class="close" type="button" aria-label="Later">&times;</button></div>`
  root.querySelector(".restart").addEventListener("click", () => {{
    root.querySelector(".restart").textContent = "Restarting…"
    window.__TAURI_INTERNALS__.invoke("install_update_now").catch(() => {{}})
  }})
  root.querySelector(".close").addEventListener("click", () => {{
    try {{ sessionStorage.setItem("central-update-dismissed", version) }} catch {{}}
    host.remove()
  }})
  document.documentElement.appendChild(host)
}})()
"#
    )
}

fn offer_update(app: &AppHandle) {
    let Some(updates) = app.try_state::<Updates>() else {
        return;
    };
    let Some(version) = updates.offered.lock().unwrap().clone() else {
        return;
    };
    if let Some(window) = app.get_webview_window(MAIN) {
        let _ = window.eval(update_banner_script(&version));
    }
}

#[tauri::command]
fn install_update_now(app: AppHandle) {
    if install_update(&app, true) {
        app.restart();
    }
}

fn main_hidden(app: &AppHandle) -> bool {
    app.get_webview_window(MAIN)
        .map(|window| !window.is_visible().unwrap_or(true))
        .unwrap_or(false)
}

/// Central lives in the tray and is rarely quit, so a downloaded update also
/// goes in whenever nobody is looking at it: the window closed to the tray.
/// Central then comes back on its own, straight into the tray.
fn install_quietly(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        if let Err(error) = install_into_tray(&app).await {
            eprintln!("quiet update: {error}");
        }
    });
}

async fn install_into_tray(app: &AppHandle) -> Result<(), String> {
    let Some((update, bytes)) = app.state::<Updates>().ready.lock().unwrap().take() else {
        return Ok(());
    };
    // Windows: the installer starts Central again once it is done, hidden.
    // The update is fetched again (only the feed, not the file) because what
    // the installer is told is fixed when the updater is built.
    #[cfg(windows)]
    {
        let relaunch = updater_builder(app)?
            .installer_args(["/R", "/ARGS", HIDDEN_ARG])
            .build()
            .map_err(|error| error.to_string())?;
        let Some(same) = relaunch.check().await.map_err(|error| error.to_string())? else {
            return Ok(());
        };
        if same.version != update.version {
            return Ok(());
        }
        same.restart_after_install(false)
            .install(bytes)
            .map_err(|error| error.to_string())?;
    }
    // macOS: the new bundle is in place; Central quits and is opened again
    // into the tray a moment later, once this one has gone.
    #[cfg(target_os = "macos")]
    {
        update.install(bytes).map_err(|error| error.to_string())?;
        let bundle = std::env::current_exe()
            .ok()
            .and_then(|exe| exe.ancestors().nth(3).map(|path| path.to_path_buf()))
            .ok_or("no app bundle")?;
        std::process::Command::new("/bin/sh")
            .arg("-c")
            .arg(format!("sleep 2; open -n -a \"$0\" --args {HIDDEN_ARG}"))
            .arg(&bundle)
            .spawn()
            .map_err(|error| error.to_string())?;
        app.exit(0);
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        update.install(bytes).map_err(|error| error.to_string())?;
        app.restart();
    }
    Ok(())
}

/// Installs the downloaded update, if there is one, and opens Central again
/// afterwards only when asked to (`restart`): quitting means quitting. On
/// Windows the installer takes over from here and closes Central itself.
fn install_update(app: &AppHandle, restart: bool) -> bool {
    let Some(updates) = app.try_state::<Updates>() else {
        return false;
    };
    let Some((update, bytes)) = updates.ready.lock().unwrap().take() else {
        return false;
    };
    match update.restart_after_install(restart).install(bytes) {
        Ok(()) => true,
        Err(error) => {
            eprintln!("update install: {error}");
            false
        }
    }
}

fn create_tray(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open Central", true, None::<&str>)?;
    let at_login = CheckMenuItem::with_id(
        app,
        "at-login",
        "Start at login",
        true,
        app.autolaunch().is_enabled().unwrap_or(false),
        None::<&str>,
    )?;
    let quit = MenuItem::with_id(app, "quit", "Quit Central", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&open, &at_login, &separator, &quit])?;
    // Joins the menu, at the top, once an update has been downloaded.
    let update = MenuItem::with_id(app, "update", "Restart to install", true, None::<&str>)?;
    app.manage(Updates {
        ready: Mutex::new(None),
        offered: Mutex::new(None),
        menu: menu.clone(),
        item: update,
    });

    let toggle = at_login.clone();
    let mut tray = TrayIconBuilder::with_id("central")
        .tooltip("Central")
        .menu(&menu)
        .on_menu_event(move |app, event| match event.id.as_ref() {
            "open" => show_main(app),
            "at-login" => {
                let autolaunch = app.autolaunch();
                let on = autolaunch.is_enabled().unwrap_or(false);
                let _ = if on {
                    autolaunch.disable()
                } else {
                    autolaunch.enable()
                };
                let _ = toggle.set_checked(autolaunch.is_enabled().unwrap_or(!on));
            }
            "update" => {
                if install_update(app, true) {
                    app.restart();
                }
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            // Windows: a click opens Central, the menu is on the right button.
            // macOS: a click opens the menu, as every menu-bar item does.
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                if !cfg!(target_os = "macos") {
                    show_main(tray.app_handle());
                }
            }
        });
    if !cfg!(target_os = "macos") {
        tray = tray.show_menu_on_left_click(false);
    }
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

fn main() {
    let app = tauri::Builder::default()
        // First, so a second launch is turned away before anything else starts.
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if args.iter().any(|arg| arg == QUIT_ARG) {
                app.exit(0);
            } else if open_notification_links(app, &args) {
            } else if !args.iter().any(|arg| arg == HIDDEN_ARG) {
                show_main(app)
            }
        }))
        .plugin({
            let autostart = tauri_plugin_autostart::Builder::new().args([HIDDEN_ARG]);
            #[cfg(target_os = "macos")]
            let autostart = autostart.macos_launcher(MacosLauncher::LaunchAgent);
            autostart.build()
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(
            // Size and place, never visibility: Central always opens shown
            // unless it was started at login.
            tauri_plugin_window_state::Builder::new()
                .with_state_flags(StateFlags::all() & !StateFlags::VISIBLE)
                .with_filter(|label| label == MAIN)
                .build(),
        )
        .manage(Shell::default())
        .invoke_handler(tauri::generate_handler![
            notify,
            print,
            print_html,
            install_update_now
        ])
        .setup(|app| {
            // Nothing was running to quit.
            if std::env::args().any(|arg| arg == QUIT_ARG) {
                std::process::exit(0);
            }
            let hub = hub_url();
            // The hub is remote, so it reaches the shell only through what is
            // granted here: these commands, from its own origin, in the
            // windows Central opened.
            app.add_capability(
                CapabilityBuilder::new("hub")
                    .remote(format!("{}/*", hub.origin().ascii_serialization()))
                    .window(MAIN)
                    .permission("allow-notify")
                    .permission("allow-print")
                    .permission("allow-print-html")
                    .permission("allow-install-update-now"),
            )?;
            // Notifications report their click here, on any thread; the
            // window is touched on the main one.
            let notifier = user_notify::get_notification_manager(
                app.config().identifier.clone(),
                Some(NOTIFICATION_SCHEME.to_owned()),
            );
            let handle = app.handle().clone();
            notifier.register(
                Box::new(move |response| {
                    if response.action != NotificationResponseAction::Default {
                        return;
                    }
                    let url = response.user_info.get("url").cloned();
                    let app = handle.clone();
                    let _ = handle.run_on_main_thread(move || open_from_notification(&app, url));
                }),
                Vec::new(),
            )?;
            app.manage(Notifier(notifier));
            let args: Vec<String> = std::env::args().collect();
            let hidden = args.iter().any(|arg| arg == HIDDEN_ARG);
            create_main(app.handle(), hidden)?;
            create_tray(app.handle())?;
            // Started by a click on a notification while Central was closed.
            open_notification_links(app.handle(), &args);
            watch_for_updates(app.handle().clone());
            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing the hub hides it to the tray, so notifications keep
            // arriving; Quit quits. Other views close as usual.
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == MAIN {
                    api.prevent_close();
                    let _ = window.hide();
                    install_quietly(window.app_handle().clone());
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building Central");

    app.run(|app, event| match event {
        // Quitting is when a downloaded update goes in.
        tauri::RunEvent::Exit => {
            install_update(app, false);
        }
        // macOS: clicking the Dock icon brings the hidden window back.
        #[cfg(target_os = "macos")]
        tauri::RunEvent::Reopen { .. } => show_main(app),
        _ => {}
    });
}
