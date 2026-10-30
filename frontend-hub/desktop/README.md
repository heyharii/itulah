# Central — desktop

The hub as a desktop app (STORE-SERVER-PLAN §7), built with Tauri 2. It loads
the hosted hub in its own window rather than a bundled copy, so sign-in,
cookies and every deploy behave exactly as in a browser: a hub deploy reaches
every desktop at once, with no new installer.

```
npm install
npm run dev      # against the hub on localhost:5480 (ITULAH_HUB_URL to change)
npm run release  # build, sign and publish this platform's update (see below)
```

The hub's address is `DEFAULT_HUB_URL` in `src-tauri/src/main.rs`, or
`ITULAH_HUB_URL` at run time or at build time. It opens through a small launch
page (`src-tauri/src/launch.html`) that goes to the hub as soon as it answers
and shows "Can't reach Central" with a retry when it does not.

What the shell adds:

- **Tray** with Open, Start at login and Quit. Closing the window hides it, so
  notifications keep arriving; Quit quits.
- **Notifications** from the hub's notification stream through
  `window.itulahDesktop.notify` (`src/lib/notification-stream.ts`), because a
  webview has no Web Push. Clicking one brings Central forward on the page it
  is about (`user-notify`: UserNotifications on macOS; on Windows the toast
  opens `central://…`, registered by the installer, so a click from
  Notification Center or after Central was closed still lands).
- **Updates** of the shell itself (the hub updates with every deploy). Central
  checks `https://storage.googleapis.com/itulah-central-desktop/latest.json`
  ten seconds after it starts and every six hours and downloads in the
  background. With the window closed to the tray it installs straight away and
  comes back into the tray; with the window in use it waits (toast, tray
  "Restart to install") until the window is closed or Central quits.
  `Central --quit` quits a running Central as the tray would.
- **Printing and downloads on macOS**, which WKWebView ignores: `window.print()`
  goes to the system print panel, a blank `window.open` view that is written
  into and printed (the supplier sheet) opens in a window of its own, and
  exports land in Downloads. Windows (WebView2) does all three natively.
- **Links** to other sites open in the browser; hub links with
  `target="_blank"` open in another Central window.
- **Fingerprint enrolment** on HR's PC (Windows): People › an employee ›
  Fingerprints › Enrol finger reaches the ZKTeco scanner through
  `window.itulahDesktop.scanner` (`src-tauri/src/fingerprint.rs`,
  `src/lib/desktop-scanner.ts`): three presses merged into one template, each
  press announced as a `central-fingerprint` event. IT installs the vendor's
  ZKFinger driver on that PC (the installer the POS ships under
  `pos-desktop/src-tauri/fingerprint-native/`); Central does not carry it.

The hub is remote, so it can call only `notify`, `print`, `print_html`,
`install_update_now`, `scanner_status`, `capture_finger` and `cancel_capture`,
granted to its own origin at run time (`build.rs` lists them).

## Releasing

1. Bump `version` in `src-tauri/tauri.conf.json` (and `Cargo.toml`,
   `package.json`).
2. Mac: `npm run release`. It builds, signs the update with
   `~/.tauri/central-updater.key`, uploads to `gs://itulah-central-desktop`
   and adds the platform to `latest.json`.
3. Windows, same version, without a Windows PC: `deploy/windows/stage-central.sh`
   builds it on Cloud Build with cargo-xwin, and when that finishes
   `deploy/windows/fetch-central.sh <build id>` brings the setup down. Or, on
   a Windows PC, `npx tauri build --config
   '{"bundle":{"createUpdaterArtifacts":false}}'` and copy
   `Central_<version>_x64-setup.exe` to the Mac. Either way, the last step is
   here: `scripts/publish.sh <version> windows-x86_64 <setup.exe> <setup.exe>`.
   The key stays on the Mac.

First-time installers stay at `…/Central.dmg` and `…/Central-setup.exe`.

The signing key is the only way to ship an update to Centrals already
installed: keep a copy somewhere safe, never in the repository. Its public
half is `plugins.updater.pubkey` in `tauri.conf.json`.

Windows installs WebView2 if it is missing (the bootstrapper is embedded).
Unsigned builds warn on first open until a signing identity is set up
(STORE-SERVER-PLAN §10).
