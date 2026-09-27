// The only thing the hub page learns about being in a desktop app: that it is,
// and how to hand a notification to the operating system. Nothing else of
// Electron or Node reaches the page (contextIsolation, sandbox).
const { contextBridge, ipcRenderer } = require("electron")

contextBridge.exposeInMainWorld("itulahDesktop", {
  isDesktop: true,
  notify: (title, body, url) =>
    ipcRenderer.send("notify", {
      title: String(title).slice(0, 200),
      body: String(body).slice(0, 1000),
      url: url ? String(url).slice(0, 500) : null,
    }),
})
