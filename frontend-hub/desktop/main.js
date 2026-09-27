// The hub on the desktop: the hosted hub in its own window, not a copy.
//
// Loading the real hub (rather than a bundled build) keeps it on its own
// origin, so the `SameSite=Strict` session cookie and the `/api` proxy work
// exactly as in a browser, and every deploy reaches the desktop at once.
// What the shell adds is what a browser tab cannot do: a tray icon, starting
// at login, native notifications from the notification stream (Electron has no
// Web Push), and updating itself.

const {
  app,
  BrowserWindow,
  Menu,
  Notification,
  Tray,
  ipcMain,
  nativeImage,
  shell,
} = require("electron")
const path = require("node:path")

const HUB_URL = process.env.ITULAH_HUB_URL || require("./package.json").itulah.hubUrl
const HUB_ORIGIN = new URL(HUB_URL).origin

let win = null
let tray = null
let quitting = false

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on("second-instance", () => show())
}

function show(url) {
  if (!win) return
  if (url) win.loadURL(new URL(url, HUB_URL).toString())
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    title: "Central",
    backgroundColor: "#f7f8fa",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      partition: "persist:hub",
    },
  })
  win.once("ready-to-show", () => win.show())
  win.loadURL(HUB_URL)

  // The hub stays in the window; anything else opens in the real browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (new URL(url).origin !== HUB_ORIGIN) shell.openExternal(url)
    else show(url)
    return { action: "deny" }
  })
  win.webContents.on("will-navigate", (event, url) => {
    if (new URL(url).origin !== HUB_ORIGIN) {
      event.preventDefault()
      shell.openExternal(url)
    }
  })

  // Closing hides to the tray, so notifications keep arriving; Quit quits.
  win.on("close", (event) => {
    if (!quitting) {
      event.preventDefault()
      win.hide()
    }
  })
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, "icon.png"))
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon.resize({ width: 18, height: 18 }))
  tray.setToolTip("Central")
  const menu = () =>
    Menu.buildFromTemplate([
      { label: "Buka Central", click: () => show() },
      {
        label: "Mulai saat login",
        type: "checkbox",
        checked: app.getLoginItemSettings().openAtLogin,
        click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked, openAsHidden: true }),
      },
      { type: "separator" },
      { label: "Keluar", click: () => { quitting = true; app.quit() } },
    ])
  tray.setContextMenu(menu())
  tray.on("click", () => show())
}

ipcMain.on("notify", (_event, { title, body, url }) => {
  if (!Notification.isSupported()) return
  const note = new Notification({ title, body, silent: false })
  note.on("click", () => show(url || undefined))
  note.show()
})

app.whenReady().then(() => {
  app.setAppUserModelId("id.itulah.hub")
  createWindow()
  createTray()
  if (app.isPackaged) {
    // Downloads in the background and installs on the next quit — never in
    // the middle of somebody's work.
    try {
      require("electron-updater").autoUpdater.checkForUpdatesAndNotify()
    } catch (error) {
      console.warn("update check skipped:", error.message)
    }
  }
})

app.on("activate", () => show())
app.on("before-quit", () => { quitting = true })
