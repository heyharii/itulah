# Central — desktop

The hub as a desktop app (STORE-SERVER-PLAN §7). It loads the hosted hub in
its own window rather than a bundled copy, so sign-in, cookies and every deploy
behave exactly as in a browser.

```
npm install
npm run dev      # against the Vite dev server on localhost:5273
npm run dist     # build the installer (.dmg / .exe) into dist/
```

The hub's address is `itulah.hubUrl` in `package.json`, or `ITULAH_HUB_URL`.
Notifications come from the hub's notification stream through
`window.itulahDesktop.notify` (`src/lib/notification-stream.ts`), because
Electron cannot receive Web Push. Closing the window keeps it in the tray;
"Keluar" quits. Unsigned builds warn on first open until a signing identity is
set up (STORE-SERVER-PLAN §10).
