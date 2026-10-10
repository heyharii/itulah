# How TesterArmy "e2e" fits the itulah codebase, and a pilot

Scope: a read-only survey of `/Users/hari/Documents/itulah` (branch `handheld-rfid`, 2026-10-09) checked against the e2e docs in `scratchpad/e2e-docs/llms-full.txt`. In this file, "Lnnnn" means a line in that file. The docs pages live at https://e2e.tester.army/docs/... and each repo path is relative to the repo root. Nothing was run, installed or started.

---

## 1. What testing does itulah have today? (frontends, frameworks, test dependencies, how apps start, CI)

### Takeaway
All the web frontends are Vite + React 19 + TanStack Router/Query SPAs. None of them has a test runner (no Playwright, Vitest, Cypress or Jest), there are no `data-testid` attributes, and CI checks only Rust and the generated contract. UI-level end-to-end testing exists in two forms: one Python script that drives the real apps through vercel-labs `agent-browser`, and agent-run manual browser passes written up as markdown reports. e2e would be the first TypeScript test runner in the repo. There is no Playwright suite to migrate.

### Cited Findings
- These top-level dirs have a `package.json`: `frontend-hub` (Central/HO), `frontend-store-new` (shop back office), `frontend-customer`, `frontend-employee`, `frontend-cloud`, `frontend-contract` (wire types generated from Rust), `pos-desktop/ui` (till UI) and `video` (Remotion). Two native Android projects sit beside them: `tablet/` and `handheld/`. Source: repo listing.
- `frontend-hub`: react ^19.2.6, vite ^8, @tanstack/react-router ^1.170.32, @tanstack/react-query ^5.101.4, vite-plugin-pwa ^1.3.0. Its scripts are `dev`, `build`, `lint`, `format`, `typecheck`, `preview`, `design-lint` and `endpoint-audit`. It has no test script and no test dependencies — [frontend-hub/package.json](/Users/hari/Documents/itulah/frontend-hub/package.json). `frontend-store-new`, `frontend-customer`, `frontend-employee` and `frontend-cloud` use the same stack and also have no test dependencies (their package.json files).
- `pos-desktop/ui`: react ^19.2.6, vite ^7.2.4. Scripts: `dev`, `dev:web` (`vite --mode web`), `build` and `build:web` — [pos-desktop/ui/package.json](/Users/hari/Documents/itulah/pos-desktop/ui/package.json).
- Hub routes are written in code and generated from one registry, `lib/navigation.ts`. They are not file-based — [frontend-hub/src/routes.tsx:15-24](/Users/hari/Documents/itulah/frontend-hub/src/routes.tsx).
- The only tracked JS/TS test file in the repo is `prototypes/finance/src/engine.test.ts`. "Playwright" appears only in a prototype QA note (`hr-talenta-prototype/QA.md:5`) — `git ls-files` / `git grep -i playwright`.
- `data-testid` occurs 0 times across `frontend-hub/src`, `frontend-store-new/src` and `pos-desktop/ui/src`. `aria-label=` occurs 605 times in `frontend-hub/src` — grep counts.
- Dev servers come from `.claude/launch.json` (about 130 configurations). The pos-e2e rig entries are: `pos-e2e-hub` :5480 (VITE_API_TARGET 8480, VITE_EDGE_TARGET 8481, `NODE_OPTIONS=--max-old-space-size=768`), `pos-e2e-store` :5482 (API 8482, CLOUD 8480), `pos-e2e-till` :5484 (`pos-desktop/ui` `npm run dev:web`, API 8482) and `pos-e2e-customer` :5485 (API 8480) — [.claude/launch.json](/Users/hari/Documents/itulah/.claude/launch.json).
- Backends come from `scripts/rig.sh new|up|reset|down|ps <run-id>`. Each run is one Postgres DB cloned from the `sim_golden` template, plus `runs/<id>/` holding the edges' SQLite files and logs. The script drops only `sim_rig_*` DBs, stops only PIDs it recorded, and refuses non-local Postgres unless `SIM_ALLOW_REMOTE=1`. Defaults: auth disabled, clock `scaled`, ports 8180/8181/8182 — [scripts/rig.sh header](/Users/hari/Documents/itulah/scripts/rig.sh).
- `e2e/pos-flow/provision.sh` builds the `pos-e2e` rig with cloud 8480, DC 8481, store 8482, `RIG_AUTH_MODE=required`, admin password `Password01` and `RIG_CLOCK=system`. If the rig already exists it calls `rig.sh reset`. It starts a label sink on :9109, then runs `scripts/demo-seed.sh` and `scripts/demo-populate.py --only goods,outbound,commercial,sales` — [e2e/pos-flow/provision.sh](/Users/hari/Documents/itulah/e2e/pos-flow/provision.sh). `runs/pos-e2e/env` records `AUTH_MODE=required` (line 10) and `CLOCK_MODE=system` (line 12).
- CI (`.github/workflows/ci.yml`) has four jobs: `gates`, `contract`, `lints` and `tests`. All of them are Rust or contract checks. The header comment says no frontend is checked, and it records `lints` and `tests` as red on the committed tree. Other workflows: `pos-windows.yml`, `store-server.yml` — [.github/workflows/ci.yml:1-50, 61, 117, 145, 165](/Users/hari/Documents/itulah/.github/workflows/ci.yml).
- Makefile targets: `db`, `run-cloud/dc/store`, `check`, `test` (unit + integration), `invariants`, `rfid-demo`, `contract`, `contract-check`, `front`, `front-check` — [Makefile](/Users/hari/Documents/itulah/Makefile).
- Agent-run manual UI testing is already in use. The 1–2 Oct pass was "tested in the browser through the hub UI" by three testers on the `pos-e2e` rig. It found critical bugs: a cancelled PO can still be received, and one GRN/invoice was shared across several POs — [E2E-TEST-REPORT-2026-10-02.md:1-3 and "Bugs › Critical"](/Users/hari/Documents/itulah/E2E-TEST-REPORT-2026-10-02.md). Related reports: `E2E-REPORT-A-procurement.md` and `E2E-REPORT-B-allotment-outbound.md`.
- `runs/` is gitignored ([.gitignore:40](/Users/hari/Documents/itulah/.gitignore)), so run reports are never committed.
- The local Node is v24.21.0 (`node --version`). e2e requires Node 24.8+ (or 22.22.3+ on Node 22), and on Windows it must run inside WSL — [Quickstart](https://e2e.tester.army/docs/quickstart) (L6843).

### Inferences
- e2e should go in as its own package (for example `e2e/agentic/package.json`) so that no app's `package.json` or lockfile changes. That fits the "no heavy checks" working rule and keeps the pilot easy to remove.
- The team already does "agent opens the hub and tries the flow", but by hand and with no replay. e2e mainly adds a repeatable, reportable version of the 1–2 Oct style of pass.
- Because there are no test ids, deterministic locators will have to use role, label and text (`getByRole`, `getByLabel`). That works because the hub uses `aria-label`/`Field label` heavily. Agent steps cover the places where no stable locator exists.

### Gaps
- `make front` / `front-check` was not read in detail, so it may or may not run lint or typecheck for every app.
- No app was started, so dev-server boot time and how heavy the hub dev build is are unmeasured.

---

## 2. What do `e2e/po-flow/run.py` and `e2e/pos-flow` do, and what would e2e add or duplicate?

### Takeaway
`po-flow` is an API-only Python invariant test of the whole goods chain (PO → DC → allotment → store → till → returns). It is fast, needs no model, and checks numbers. `pos-flow` is a browser-level Python test. It drives the real till, store app and hub through `agent-browser` with a hand-written role/name locator layer, and checks what the screens show against the nodes' APIs. e2e would mostly duplicate `pos-flow`'s browser layer, giving it typed tests, sessions, a replay cache, reports and CI support. It adds agent steps for the many hub flows that are tested only by hand today. `po-flow` should stay as it is.

### Cited Findings
- **po-flow** (Python, 685 lines plus 267 in `review_states.py`). Its docstring lists the phases: 1 normal PO (12 pcs → DC counts → rina verifies → invoice → article set up → tags printed); 2 to the shop (allot → pick → pack → surat jalan → in transit → store counts blind); 3 floor and till (till quotes, then refuses once the unit goes back); 4 PO variants (short + close short, over-delivery + return, recount, rejected delivery, cancelled PO). A failed `check()` prints FAIL and the run continues — [e2e/po-flow/run.py:1-20, 44-49](/Users/hari/Documents/itulah/e2e/po-flow/run.py).
- po-flow goes through the HTTP routes the apps use: `/api/v1/purchase-orders`, `/purchase-order-lines/`, `/suppliers`, `/dc/purchase-counts`, `/dc/purchase-verifications`, `/dc/goods-receipts`, `/dc/purchase-returns`, `/dc/tagging-jobs`, `/inventory/allotments`, `/dc/koli/`, `/store/inbound`, `/store/quote` and `/sync/trigger`. It signs in per node as rina (cloud), yusuf/nina (DC), maya and dian (store), and it reads the edges' SQLite read-only — run.py (grep of routes; `as_(...)` calls at lines 95, 102, 215, 232, 443; `edge_db` around line 118).
- **pos-flow** (Python, 618 lines). "Every screen is driven by `agent-browser` (headless Chromium)". It uses one named session per app and person. HTTP is used "only to take a baseline… and to reconcile", with one exception: reversing a posted sales day, because the hub has no Reverse action — [e2e/pos-flow/run.py:1-41](/Users/hari/Documents/itulah/e2e/pos-flow/run.py), [README](/Users/hari/Documents/itulah/e2e/pos-flow/README.md).
- pos-flow's locator layer parses `agent-browser snapshot -i -c` lines of the form `- role "name" [ref=eN]` with a regex, then clicks or fills by `@ref`. Waits poll `get text body` and normalise NBSP and NNBSP inside "Rp" amounts — run.py:138-201.
- The till steps use Indonesian labels: "Pindai tag", "Nomor member", "Perkiraan poin", "Bayar Rp…", "Metode pembayaran", "Tunai", "Debit", radio "BCA", "Kode approval EDC", "Lunas", "Selesaikan transaksi", "Transaksi selesai", "Kembalian", "Transaksi berikutnya", "Modal awal", "Buka shift" — run.py:305-352, 393-394.
- Screens it visits:
  - store app: `/money/sales`, `/stock`, `/promotions` (run.py ≈435-452)
  - hub: `/sales`, `/members`, `/inventory`, `/commercial/promotions`, `/finance/receivables/sales-postings` (buttons "Generate draft", "Post to ledger", "Confirm post"), `/finance/accounting/journal-entries` (run.py ≈486-582)
- What it checks: the screen total equals the node's `/api/v1/store/quote`, the sales synced with source `EDGE`, the member's points, the stock went down by two, and the SALE_DAY journal balances. It writes `runs/pos-e2e/report/<stamp>/report.md` with a PNG per step. The last run, `20260928-153148`, passed 32/32 — [runs/pos-e2e/report/20260928-153148/report.md](/Users/hari/Documents/itulah/runs/pos-e2e/report/20260928-153148/report.md).
- Operating limits: "Re-run `run.py` as often as the floor has stock (two units a run); run `provision.sh` again to start over" — pos-flow README.
- `agent-browser` is installed on this machine (an fnm multishell path from `which agent-browser`), with state in `~/.agent-browser/sessions`.
- e2e's matching pieces:
  - `screen.getByRole/getByLabel` locators, `expect`, and `agent.act/assert/waitFor/extract` ([How agent steps work](https://e2e.tester.army/docs/agent-steps), L1-129)
  - API tests in the same files and run, using `fetch` and `toMatchSchema` (Zod/Standard Schema), with a cookie-forwarding fixture for signed-in calls ([API](https://e2e.tester.army/docs/api-testing), L353-419)
  - a replay cache that reruns verified `act` steps without model calls ([Caching](https://e2e.tester.army/docs/cache), L1361-1739)

### Inferences
- **Duplicated if ported:** pos-flow's `Browser` class (ref parsing, click/fill, `wait_text`, screenshots) and its `Api` class. e2e's `screen` locators and the `fetch` fixture replace both directly. Porting pos-flow is a reasonable second step, not the pilot. It already passes deterministically and uses no LLM.
- **Added by e2e:**
  - UI coverage for hub flows that only the manual 1–2 Oct pass exercised (supplier/PO composer, Review count, Receiving branches, New articles, allotments, outbound)
  - typed TypeScript tests in the same language as the apps
  - setup tests with session reuse
  - per-step reports, traces and video
  - a CI story
  - agent steps that survive copy and layout churn (the hub's UI is redesigned often; see the memory notes on phone docks and sheets)
- **Not worth porting:** po-flow's API invariants. They are cheaper and more exact in Python, and e2e brings no advantage when no screen is involved.

### Gaps
- Wall-clock times for po-flow and pos-flow are not recorded in the files read. They would need a run, which is out of scope.

---

## 3. Which itulah surfaces can e2e drive, and how? (hub, store app, POS desktop/Tauri, tablet POS, others)

### Takeaway
The web engine can drive the hub, the store app, the customer and employee apps, and the till's web edition today, all as plain Vite dev URLs on the rig. The Tauri desktop till can only be reached through its web edition or the pos-flow shim; e2e has no Tauri/WebView2 engine. The tablet till is native Kotlin/Jetpack Compose, so only e2e's mobile engine (agent-device on an Android emulator) can reach it. It has no `testTag`s and an RFID-first input path, which makes it a poor pilot target.

### Cited Findings
- **Hub (Central)**: an SPA on :5480 against cloud :8480, with the edge on 8481 (launch.json `pos-e2e-hub`). Real paths include `/procurement/orders` (14 refs), `/procurement/suppliers`, `/procurement/returns`, `/procurement/outstanding`, `/operations/intake` (17 refs), `/operations/packing`, `/operations/despatch`, `/operations/board`, `/operations/stock` and `/inventory/allotments` (grep of `frontend-hub/src`). The PO list button reads "New order", with a floating button on phone ([purchase-orders.tsx:1482-1487](/Users/hari/Documents/itulah/frontend-hub/src/screens/procurement/purchase-orders.tsx)). The composer uses "New PO" ([composer.tsx:1969](/Users/hari/Documents/itulah/frontend-hub/src/screens/procurement/composer.tsx)).
- **Store app**: :5482 against store node :8482 and cloud :8480. Its routes include `/receive`, `/stock`, `/stock/count`, `/stock/returns`, `/money/sales`, `/money/cash-count`, `/promotions`, `/node/tills` and `/hr/*` (grep of `path:` in `frontend-store-new/src`).
- **Till, Tauri desktop**: `productName` "itulah kasir", `devUrl` http://localhost:5410, `frontendDist` ../ui/dist, a 1440×900 window — [pos-desktop/src-tauri/tauri.conf.json](/Users/hari/Documents/itulah/pos-desktop/src-tauri/tauri.conf.json). "pos-desktop/ui never calls fetch: every node call goes through the Tauri shell's `edge_call`… outside the shell it refuses on purpose" — [e2e/pos-flow/README.md](/Users/hari/Documents/itulah/e2e/pos-flow/README.md).
- **Till, web edition**: the same code built with `vite --mode web`. It offers "sign in with a password, sell, pay, return and void with a supervisor's password, shifts, and receipts on a network printer". It leaves out the R3 reader, fingerprints/PINs, USB printer, drawer, customer display and joining — [pos-desktop/ui/src/edition.ts:1-16](/Users/hari/Documents/itulah/pos-desktop/ui/src/edition.ts). With `VITE_API_TARGET` set, `/api` is proxied to the node for same-origin calls — [pos-desktop/ui/vite.config.ts](/Users/hari/Documents/itulah/pos-desktop/ui/vite.config.ts). The launch entry is `pos-e2e-till` on :5484.
- **Till shim** (the older route pos-flow uses, on :5419): `pos-shim.vite.mjs` injects a stand-in bridge (base URL, bearer token, `X-Terminal-Id` POS-01) through a same-origin `/__edge` proxy. Devices answer "not attached" — [e2e/pos-flow/pos-shim.vite.mjs:1-60](/Users/hari/Documents/itulah/e2e/pos-flow/pos-shim.vite.mjs).
- **Tablet till**: native Android with `applicationId "id.itulah.kasir"`, minSdk 26 and `compose = true` ([tablet/app/build.gradle.kts:9-19](/Users/hari/Documents/itulah/tablet/app/build.gradle.kts)). A WebView shell was "considered and rejected by the user" in favour of "a native Android till, Kotlin and Compose" ([POS-TABLET-PLAN.md:17-20](/Users/hari/Documents/itulah/POS-TABLET-PLAN.md)). Without a reader it shows "Tanpa pembaca · pemindai keyboard" and summons the soft keyboard ([DeskScreen.kt:125-131, 172](/Users/hari/Documents/itulah/tablet/app/src/main/java/id/itulah/kasir/ui/DeskScreen.kt)). There are 0 `testTag` uses in `tablet/app/src`. A debug build exists at `tablet/app/build/outputs/apk/debug/app-debug.apk`. Returns and voids are "not built here yet" ([tablet/README.md](/Users/hari/Documents/itulah/tablet/README.md)).
- e2e mobile engine: `@e2e-dev/mobile` "runs tests on iOS simulators, Android emulators, and phones connected to your machine. It is built on agent-device". It needs the Android SDK with an emulator (checked with `npx agent-device doctor`), lists Jetpack Compose among supported UI stacks, and installs an `.apk` named by `app.appPath` — [Mobile](https://e2e.tester.army/docs/mobile) (L5815-5890).
- e2e engines: the docs cover `web()` (Playwright-based) and `mobile()`, plus a "Writing an engine" guide for custom engines (L16341-end). No Tauri or desktop-WebView engine is documented (docs index).
- **Others**: `frontend-customer` (:5485 on the rig) and `frontend-employee` are the same Vite SPA shape (launch.json). The hub also has a Tauri desktop wrapper (`frontend-hub/desktop`), which is out of scope.

### Inferences
- Pilot targets, in order of fit: (1) hub, (2) store app, (3) till web edition. All three are plain browser targets with seeded users on the existing rig.
- The web-edition till is now the cleaner way to test the till than pos-flow's shim. It ships as a real product edition and keeps its token in sessionStorage (§4). The shim's only advantage is that it exercises the desktop edition's UI branches, without hardware.
- Tablet testing through agent-device is technically possible (Compose exposes semantics, there is a keyboard-scanner fallback, and a debug APK exists). It would need an Android SDK and emulator on the Mac, network access from the emulator to the store node (10.0.2.2:8482 or `RIG_EDGE_HOST=0.0.0.0`), and Compose semantics without `testTag`s. Leave it for after the web pilot.
- Hardware paths (R3 RFID, EDC, fingerprint, printers, drawer) are not reachable by either engine. They stay manual or simulator-based (`rfid-sim/`, the label sink on :9109).

### Gaps
- No check was made of whether the emulator can reach a loopback-bound rig, or whether the tablet build has a configurable node URL for debug builds.
- The `handheld/` Android app was not surveyed beyond its existence.

---

## 4. How does sign-in work, and how does it map to e2e's "Signing in" (setup test, session reuse, secrets)?

### Takeaway
The hub and the store app sign in with username and password into an HttpOnly session cookie plus a CSRF cookie. e2e browser sessions save cookies, localStorage and IndexedDB, so one setup test per role, followed by `{ session: 'rina' }` in each test, fits well. The web till keeps its token in sessionStorage, which e2e sessions do not list, so till tests must sign in inside the test or a fixture. One-device sign-in is off on the rig unless an env flag is set.

### Cited Findings
- Cloud `login` sets an HttpOnly session cookie and a non-HttpOnly CSRF cookie. It also returns the token: "Native/CLI clients may use the same opaque value as a Bearer token. The browser ignores it and relies on the HttpOnly cookie below." — [backend/src/cloud/http/auth.rs:649-667](/Users/hari/Documents/itulah/backend/src/cloud/http/auth.rs).
- Hub sign-in form: `Field label="Username"`, `label="Password"`, a submit button and page title "Sign in" — [frontend-hub/src/components/login-form.tsx:180, 203, 258](/Users/hari/Documents/itulah/frontend-hub/src/components/login-form.tsx), [App.tsx:191](/Users/hari/Documents/itulah/frontend-hub/src/App.tsx). The store app has the same labels and button text "Sign in"/"Signing in…" ([frontend-store-new/src/components/login-form.tsx:29, 167, 190, 251](/Users/hari/Documents/itulah/frontend-store-new/src/components/login-form.tsx)), and its queries use `credentials: "include"` ([queries.ts:88](/Users/hari/Documents/itulah/frontend-store-new/src/lib/queries.ts)).
- The hub also signs in to an edge node separately (`edge.postWithoutCredentials("/api/v1/auth/login")`) — [frontend-hub/src/lib/edge-session.tsx:82](/Users/hari/Documents/itulah/frontend-hub/src/lib/edge-session.tsx).
- Web till: "The token lives in `sessionStorage`, one tab's worth… close the tab and the till is signed out", and "Cookies are not sent". The key is `pos.web.token.v1` — [pos-desktop/ui/src/web.ts:11-17, 26](/Users/hari/Documents/itulah/pos-desktop/ui/src/web.ts). Till sign-in uses `aria-label="Nama pengguna"` and `"Kata sandi"` with the button "Masuk" — [pos-desktop/ui/src/screens/login.tsx:178, 204, 226](/Users/hari/Documents/itulah/pos-desktop/ui/src/screens/login.tsx).
- One-device sign-in is "Off unless `INVENTORY_ONE_DEVICE_SIGN_IN=true`. The owner switched it off for now (2026-09-29)" — [backend/src/security.rs:29-36](/Users/hari/Documents/itulah/backend/src/security.rs). `runs/pos-e2e/env` does not set it.
- The rig seeds people with password `Password01` (provision.sh). The users are rina (buyer, cloud), yusuf/nina (DC), maya (store) and dian (cashier, store-01) — po-flow/pos-flow.
- e2e "Signing in":
  - A `test.setup(..., { sessions: ['admin'] })` signs in and calls `session.save()`; tests then take `{ session: 'admin' }`.
  - "On a browser target, a session holds cookies, local storage, and IndexedDB. It does not include server or database state."
  - Sessions last one run, are encrypted on disk and are deleted afterwards.
  - Credentials are declared in config and can be overridden by `E2E_USER_<NAME>_USERNAME/PASSWORD`. A password is an opaque `Secret` that the model never sees.
  - "After a secret fill, screenshots are withheld for the rest of the attempt, and in tests that restore the session it saved."
  - Source: [Signing in](https://e2e.tester.army/docs/authentication) (L420-757).
- "e2e loads no `.env` files"; variables must be exported or loaded with `process.loadEnvFile()` — [Models](https://e2e.tester.army/docs/models) (L6667, L6694).

### Inferences
- Hub and store app: one setup per role (`rina@hub`, `maya@store`) restores cleanly, because cookie and CSRF cookie are both in the session.
- Web till: sign in as dian inside each till test, through a small fixture. sessionStorage is not listed among the session contents, and the till deliberately signs out per tab.
- Screenshots are withheld after a secret fill, and that carries into every test that restores such a session. The pilot's `vision: true` checks (phone layout) therefore need either the doc's "sign in with screenshots kept" method (the section linked from L757 was not read) or a separate test that signs in without a `Secret`. The second option is acceptable only because the rig password is a public demo value.
- API fixtures that change state through the hub origin probably also need the CSRF cookie echoed as a header. The cookie-forwarding fixture example sends cookies only. This needs checking against `backend/src/security.rs` / auth middleware.
- Invite links (link-only invites) mint one-time tokens. Agent steps that read them hit the cache's `minted-token` gap (§6), so leave them out of the pilot.

### Gaps
- My memory note says "curl login kicks the browser", but `security.rs` says one-device is off by default. The kick may come from an older rig binary or a different mechanism. This was not verified, and the rig was not touched per the constraints.
- Not checked: which hub screens (Ops/edge) need the second edge session, and whether that session survives an e2e session restore.

---

## 5. Locale, IDR prices and phone-first layouts: do agent goals and viewports map cleanly?

### Takeaway
Money is formatted in code as id-ID ("Rp 1.234.567" with a no-break space), so the browser locale does not matter. The till is in Indonesian and the hub in English, and the model reads both fine as text. The real mismatch is phone emulation. e2e's web engine sets viewport size only (no `isMobile`, `hasTouch` or device presets), while the hub switches several phone behaviours on `(pointer: coarse)`. A 414×896 target exercises the width-based layout but not the touch-only parts. Offline (the PO outbox) also cannot be emulated.

### Cited Findings
- `new Intl.NumberFormat("id-ID", …)` for rupiah and plain numbers — [frontend-hub/src/lib/format.ts:42, 68](/Users/hari/Documents/itulah/frontend-hub/src/lib/format.ts). pos-flow strips ` `/` ` before matching "Rp" ([run.py:162-164](/Users/hari/Documents/itulah/e2e/pos-flow/run.py)) and computes "today" in WIB (`timezone(timedelta(hours=7))`, run.py header).
- Hub phone switches:
  - `/` redirects to `/apps` when `matchMedia("(width < 48rem)")` is true ([routes.tsx:111-118](/Users/hari/Documents/itulah/frontend-hub/src/routes.tsx))
  - `(pointer: coarse)` checks in [components/ui/button.tsx:63](/Users/hari/Documents/itulah/frontend-hub/src/components/ui/button.tsx), [screens/procurement/item-form.tsx:427](/Users/hari/Documents/itulah/frontend-hub/src/screens/procurement/item-form.tsx), [lib/layout.ts:147](/Users/hari/Documents/itulah/frontend-hub/src/lib/layout.ts) and [styles/index.css:850](/Users/hari/Documents/itulah/frontend-hub/src/styles/index.css)
- The hub has an IndexedDB offline PO outbox ([frontend-hub/src/lib/offline/po-outbox.ts](/Users/hari/Documents/itulah/frontend-hub/src/lib/offline/po-outbox.ts)). It registers its service worker in dev too (`devOptions.enabled: true`, `registerType: "prompt"`) — [frontend-hub/vite.config.ts:93-94, 146-150](/Users/hari/Documents/itulah/frontend-hub/vite.config.ts).
- e2e web options include `userAgent`, `locale` (sets `navigator.language`, `Intl` and Accept-Language), `timezoneId`, `initScripts`, and `testIdAttribute` (default `data-testid`) — [Browser reference](https://e2e.tester.army/docs/reference/web) (L14265-14300). Viewports work per target (`web({ viewport: { width, height } })`), and `browser.setViewport()` resizes mid-test — [Web](https://e2e.tester.army/docs/web) (≈L16185-16250).
- From the Playwright mapping table:
  - "`devices['iPhone 15']`, `deviceScaleFactor`, `isMobile`, `hasTouch` | not yet; `web({ viewport })` sets the size only | missing"
  - `colorScheme`, `geolocation`, `permissions` | not yet
  - `offline`, `proxy`, `ignoreHTTPSErrors` | not yet
  - Source: [From Playwright](https://e2e.tester.army/docs/migrate/playwright) (L5318-5325).
- Agent judgments can take `vision: true | 'only'`, which needs a judge model that accepts images — [agent reference](https://e2e.tester.army/docs/reference/agent) (≈L7430).

### Inferences
- Targets: `hub-desk` at 1440×900, the same size as the Tauri till window, and `hub-phone` at 414×896 (the iPhone XR baseline in the team's phone rules). Set `timezoneId: 'Asia/Jakarta'` on both, because business dates and "Today" labels are computed in WIB.
- Leave `locale` alone. Setting `id-ID` would not change hub formatting, since that is hard-coded, but it would change Accept-Language and might flip any `navigator.language`-dependent copy.
- To reach the `(pointer: coarse)` paths (the NumberPad drawer, touch button behaviour), an `initScripts` entry could patch `window.matchMedia` so that `(pointer: coarse)` returns true. This is a workaround, not a documented e2e feature. It still would not produce touch events.
- The memory rules ("actions bottom, no h-scroll", "dock, never top filters", "same on every device") map to agent assertions, preferably `agent.assert(..., { vision: true })` on `hub-phone`, subject to the screenshot-after-secret-fill caveat in §4.
- Offline-PO behaviour (IndexedDB outbox, "Offline" status on the list) cannot be tested until e2e supports `offline`, or until a custom project tool toggles the network.

### Gaps
- Not checked: whether `browser: 'webkit'` (shown in the docs' phone example) changes anything for the hub's coarse-pointer logic.
- Not checked: how agent steps behave with the dev service worker's caching when a session is restored.

---

## 6. Where should tests and the replay cache live, how would they run against the pos-e2e rig, and which model (OpenRouter, OpenAI-compatible, local)?

### Takeaway
Put the suite in a self-contained `e2e/agentic/` package next to the existing `po-flow` and `pos-flow`. Bring the rig up first with the existing scripts, because e2e's `app.command` starts only the app process, not Postgres or the nodes. Point targets at the rig's Vite ports with `command.reuseExisting` for local runs. Models plug in through the AI SDK. OpenRouter has a first-class provider (`@openrouter/ai-sdk-provider`, `OPENROUTER_API_KEY`), and any OpenAI-compatible endpoint works through `@ai-sdk/openai-compatible`. The team's existing OpenRouter setup (Gemma 4, ZDR) can therefore be reused. Whether Gemma 4 is strong enough to drive multi-step `act` reliably is unproven.

### Cited Findings
- The replay cache is stored as "a JSON file under `.e2e/cache/`, named by a hash of its key". It holds actions, target descriptions and typed text, but no prompts, screenshots or secret values. "Other typed values are stored verbatim." Modes: `read-write` is the local default, `read-only` the CI default, and `off` is set with `--no-cache`. "`e2e init` adds `.e2e/cache/` to `.gitignore`… To share replays, remove that line and commit the directory." "Upgrading `e2e` to a version that changes how entries are matched re-keys every entry" — [Caching](https://e2e.tester.army/docs/cache) (≈L1589-1630).
- Cache gaps: values "the agent read off the screen… or worked out from the date" are not replayed. The named rules include `minted-token` ("a code or id the app showed as its own word") and `date`. "Values from the instruction or `params`… replay" — Caching (≈L1580-1585).
- `app.command` starts a dev server and waits for `app.url` or `readyUrl`. `command.reuseExisting: true` uses an already-running server locally, but "CI ignores this and reports `APP_ALREADY_RUNNING`". "This version starts only `app.command`… Databases, mocks, and other processes… have `app.command` start a script that brings them up" — [Web](https://e2e.tester.army/docs/web) (≈L16030-16095, L1255-1257, L1913).
- Targets: "Every test runs on every target unless it is scoped with `platforms` or `requires`; `--target <name>` selects at run time" — Web (≈L16114-16118). `--config <path>` appears on CLI commands such as `e2e cache` and `e2e mcp` — [CLI](https://e2e.tester.army/docs/cli) (≈L7725, L7998).
- Models:
  - e2e uses the AI SDK and "all AI SDK providers that support tool calls"
  - OpenRouter: "Install `@openrouter/ai-sdk-provider` and set `OPENROUTER_API_KEY`"
  - local or self-hosted: `createOpenAICompatible({ name, baseURL: 'http://127.0.0.1:11434/v1' })`
  - per-agent models and a separate `judge` model, which can be chosen through an env var
  - tests without agent steps need no model
  - Source: [Models](https://e2e.tester.army/docs/models) (L6531-6824).
- The backend already calls OpenRouter: `OPENROUTER_API_KEY` / `OPENROUTER_BASE_URL` ([backend/src/cloud/application/mod.rs:224-225](/Users/hari/Documents/itulah/backend/src/cloud/application/mod.rs)), model `google/gemma-4-31b-it` ([backend/src/cloud/http/assistant.rs:2600](/Users/hari/Documents/itulah/backend/src/cloud/http/assistant.rs)), with request provider preferences `{ "require_parameters": true, "zdr": true }` (assistant.rs:748).
- The `act` prompt contains "a redacted text snapshot of the screen's roles, names, text, and states" and excludes "raw HTML, cookies, headers, and environment values" — [How agent steps work](https://e2e.tester.army/docs/agent-steps) (L1-40).
- Telemetry can be turned off with `export E2E_TELEMETRY_DISABLED=1`, `export DO_NOT_TRACK=1`, or `npx e2e telemetry disable` (saved in `~/.config/e2e/telemetry.json`). In CI the distinct id is `ci:<vendor>` — [Telemetry](https://e2e.tester.army/docs/telemetry) (L15444-15530).

### Inferences
- Proposed layout:
  ```
  e2e/
    po-flow/            (unchanged, API invariants)
    pos-flow/           (unchanged until ported)
    agentic/
      package.json      e2e, @e2e-dev/web, @openrouter/ai-sdk-provider, zod
      hub.config.ts     targets hub-desk (1440×900) + hub-phone (414×896) → :5480
      store.config.ts   target store → :5482
      till.config.ts    target till-web → :5484
      support/rig.ts    API fixture: bearer login per node (as po-flow's Rig/Api), CSRF-aware
      tests/*.e2e.ts
      .e2e/cache/       committed only after review (typed values verbatim)
  ```
  Use one config per app, or `--target`. Otherwise every hub test would also run against the store app and till URLs, because tests run on every target by default.
- Run order: `e2e/pos-flow/provision.sh` (or `scripts/rig.sh reset <id>` + seed), then the Vite servers from launch.json, then `E2E_TELEMETRY_DISABLED=1 npx e2e run --config e2e/agentic/hub.config.ts`. `reuseExisting` lets locally running `pos-e2e-*` servers be reused.
- Model choice: start with OpenRouter, since the key and ZDR habit already exist. Put the model id in an env var, and use a separate, stronger judge for `assert`/`extract`. Try Gemma 4 as a cost floor once the cache is warm. Replayed steps then make no model calls, so model quality matters mainly when recording and repairing. A local Ollama endpoint through openai-compatible is possible but untested for tool-call quality.
- If ZDR is required, check that the AI SDK OpenRouter provider can pass OpenRouter's `provider: { zdr: true }`. Otherwise use OpenRouter account-level privacy settings.

### Gaps
- Not verified: whether `e2e run` accepts `--config <path>` (the flag was seen only on `cache` and `mcp` in the CLI page excerpt).
- Not verified: whether `@openrouter/ai-sdk-provider` can pass per-request `provider.zdr`.
- Unknown whether the cache key includes `params` values. If it does, date-valued params (delivery dates) would re-record daily. The cache key definition (≈L1469) was not read in full.

---

## 7. What are the risks? (data mutation on shared rigs, nondeterminism, cost, telemetry, secrets reaching the model, pre-1.0 churn)

### Takeaway
The biggest practical risks are shared-rig mutation and seed drift. Tests consume stock and mint PO numbers on the same `pos-e2e` rig that Hari browses as rina. Second come pre-1.0 churn (cache re-keys on upgrade) and the content (not the passwords) that reaches the model provider. All of these can be managed with a dedicated rig id, ZDR or local models, telemetry off, and a small pilot.

### Cited Findings
- Rig consumption: pos-flow can rerun only "as often as the floor has stock (two units a run)". Starting over means `provision.sh` again (pos-flow README). `rig.sh reset` wipes only that run's `sim_rig_*` DB and `runs/<id>/` (rig.sh header). The hub on :5480 is wired to this rig in launch.json (`pos-e2e-hub`, `pos-e2e-hub-lan` :5481, `audit-hub` :5360 and `colour-hub` :5486 all target 8480).
- "Navigation and secret fills have no origin allowlist. The agent can follow the app to other sites and use the secrets supplied to the current step there" — [Security model](https://e2e.tester.army/docs/security) (L14959-14963).
- "Shared cache entries… can replay actions without consulting a model and are not signed". They are validated, are ≤1 MiB, and an entry "recorded on the app's origin never replays on a page from another origin" — Security model (L15121-15134).
- Cost drivers: `assert`/`extract` make one judgment (plus a possible repair call); `waitFor` skips calls while the screen is unchanged; screenshots add input tokens; the replay cache removes calls for passing `act` steps. Budgets raise `STEP_BUDGET_EXHAUSTED`/`STEP_TIMEOUT` — How agent steps work (L95-115).
- Verdicts are `passed`, `failed` or `blocked`, with exit codes 1/2/3. Examples: `ENVIRONMENT_UNAVAILABLE` exits 3, `SEED_DATA_MISSING` exits 2 — How agent steps work (L60-90).
- Telemetry is on by default ("The `e2e` CLI sends anonymous usage data") and can be opted out (§6) — Telemetry (L15444-15460).
- Pre-1.0: the docs' sample PR comment shows "e2e 0.13.0" (L4166). Many Playwright features are listed as "not yet" (L5318-5325). Cache upgrades re-key all entries (Caching).
- The demo seed puts personal-looking data on screen, such as member "Sari Wulandari" with phone `081311110001` ([pos-flow/run.py](/Users/hari/Documents/itulah/e2e/pos-flow/run.py) `MEMBER` constant). Passwords are `Secret`s and never sent ([Signing in](https://e2e.tester.army/docs/authentication)).
- CI cost: the rig needs local Postgres plus debug binaries in `backend/target/debug` (rig.sh `bin_dir`). Current CI runs no frontend and has red jobs (ci.yml header).
- Windows: e2e "On Windows, run inside WSL" (Quickstart L6843). That matters if anyone wants to run it on the Windows till machines.

### Inferences
- Use a dedicated rig id and ports (for example `scripts/rig.sh new agentic` with `RIG_PORT_CLOUD=8580…`) for e2e runs, so they never mutate the rig Hari uses interactively. Reset it at the start of each suite. Have every test create its own data through API fixtures (supplier, PO), with a unique tag such as po-flow's `--tag UJI1`, rather than relying on seed rows.
- Nondeterminism: use `expect` and API reconciliation for every number (totals, quantities, journal balance). Use agent steps for navigation and form filling, never as the only proof of a figure. That matches pos-flow's "screen total = node quote" pattern.
- Secrets and privacy: only demo data is on the rig, so content exposure is acceptable when the provider has ZDR or the model is local. Never point a pilot target at `gcp-hub` / sslip.io or onrender (launch.json has such entries). Navigation has no origin allowlist, so the agent itself must not be the guard.
- Set `E2E_TELEMETRY_DISABLED=1` in the package's run script and in any CI job.
- Pre-1.0 churn: pin an exact e2e version, and re-record or review cache diffs when upgrading. Keep tests thin enough that a breaking API change costs hours, not days.
- Agent steps can open and run real actions on a live rig. Keep destructive verbs ("Post to ledger", "Cancel order") inside tests that create their own records.

### Gaps
- No price data for the candidate models was collected, so the cost per run is unquantified.
- e2e's own default budgets (`maxSteps`, `maxModelCalls`, timeouts) were not tabulated (agent reference ≈L7300).

---

## 8. What would a sensible pilot look like? (scope, success criteria, 2–3 test sketches on real routes)

### Takeaway
Run a two-week, local-only pilot with three tests on a dedicated rig: (1) hub sign-in setup plus PO creation at desk and phone sizes, (2) a regression for the 2 Oct critical bug "a cancelled PO can still be received", built from API setup plus agent UI steps, and (3) a web-till sale ported from pos-flow. The pilot succeeds if the tests are green twice in a row on a fresh rig, the second run replays mostly from cache, at least one real regression is caught or confirmed, and cost per run stays low enough to run on every UI-heavy branch.

### Cited Findings
- The test API shape follows the docs (Signing in L420-470; agent reference L7098-7440; Web L16100-16118):
  - `import { test } from '@e2e-dev/web'` and `import { expect, credentials } from 'e2e'`
  - `test.setup(name, { sessions: [...] }, async ({ app, screen, session, browser }) => …)` and `test(name, { session }, async ({ app, screen, agent, browser }) => …)`
  - `agent.act(instruction, { params })`, `agent.assert(...)`, `agent.waitFor(...)` and `agent.extract(..., { schema: z.object(...) })`
  - `screen.getByRole(role, name)` and `getByLabel(label)`
  - `expect(browser).toHaveURL()`, `toBeVisible()`, `toContainText()` and `expect.poll`
- The bug to guard: "A cancelled PO can still be received. With a count waiting, Cancel order is allowed, the sheet still shows Review count, and Receive then works. PO-021026-009 is Cancelled yet shows 2 pcs / Rp 170.000 received" — [E2E-TEST-REPORT-2026-10-02.md, Bugs › Critical 1](/Users/hari/Documents/itulah/E2E-TEST-REPORT-2026-10-02.md).
- po-flow phase 4 already covers "cancelled PO" at API level and shows how to create a PO and a DC count through `/api/v1/purchase-orders` and `/api/v1/dc/purchase-counts` ([e2e/po-flow/run.py:15-20](/Users/hari/Documents/itulah/e2e/po-flow/run.py)).
- Till labels and flow: "Nama pengguna", "Kata sandi", "Masuk", "Modal awal", "Buka shift", "Pindai tag", "Bayar Rp…", "Tunai", "Lunas", "Selesaikan transaksi", "Transaksi selesai" ([pos-desktop/ui/src/screens/login.tsx](/Users/hari/Documents/itulah/pos-desktop/ui/src/screens/login.tsx); [e2e/pos-flow/run.py:305-352, 393-394](/Users/hari/Documents/itulah/e2e/pos-flow/run.py)). `/api/v1/store/quote` prices a basket (run.py `quote()`).

### Inferences

**Pilot plan (about 2 weeks, local only, no CI yet)**
1. Create the `e2e/agentic/` package (§6). Pin the e2e version, set `E2E_TELEMETRY_DISABLED=1`, and pick an OpenRouter model plus a judge through env vars.
2. Use a dedicated rig: `RIG_PORT_CLOUD=8580 RIG_PORT_DC=8581 RIG_PORT_STORE=8582 RIG_AUTH_MODE=required RIG_ADMIN_PASSWORD=Password01 RIG_CLOCK=system scripts/rig.sh new agentic`, then the same seed steps as `provision.sh`, then hub/store/till Vite servers on new ports. Copy the `pos-e2e-*` launch entries rather than reusing :5480.
3. Write the three tests below. Run each three times: cold with no cache, warm, and after a `rig.sh reset`. Record replay counts (`Cache N replayed · …`), model calls, wall time and flakiness.
4. Decide: commit `.e2e/cache/`? Port pos-flow? Add a CI job? The CI job would need Postgres and the Rust debug build, so it is heavy.

**Success criteria:** the suite is green on a fresh rig. The second run replays most `act` steps with zero model calls. There are no false passes, which you check by breaking a label or reverting a fix and watching the test fail. Test 2 catches the bug if it is still open, or guards the fix.

**Sketch 1 — hub sign-in setup + PO creation (desk and phone).** The supplier and article names come from the seed and must be confirmed (gap).
```ts
// e2e/agentic/tests/hub.auth.setup.e2e.ts
import { test } from '@e2e-dev/web';
import { credentials } from 'e2e';

test.setup('rina signs in to Central', { sessions: ['rina'] }, async ({ app, screen, agent, session }) => {
  const rina = credentials.user('rina');               // password from E2E_USER_RINA_PASSWORD
  await app.open('/');
  await screen.getByLabel('Username').fill(rina.username);
  await screen.getByLabel('Password').fill(rina.password);
  await screen.getByRole('button', 'Sign in').tap();
  // '/' redirects to the first module on a desk and to /apps on a phone (routes.tsx:111-118)
  await agent.waitFor('the Central shell is shown and the Sign in form is gone');
  await session.save('rina');
});

// e2e/agentic/tests/po-create.e2e.ts   (runs on hub-desk 1440×900 and hub-phone 414×896)
import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { z } from 'zod';
import { rig } from '../support/rig';                  // bearer-token API client, like po-flow's Rig

test('a buyer raises a PO and it is listed', { session: 'rina' }, async ({ app, agent, screen }) => {
  const tag = `UJI-${Date.now().toString(36)}`;
  const supplier = await rig.cloud('rina').createSupplier({ name: `QA ${tag}` }); // POST /api/v1/suppliers
  await app.open('/procurement/orders');
  await agent.act(
    'Start a new order for supplier {supplier}, add {qty} pcs of the first article offered, ' +
    'write {note} in the notes, review it and submit it',
    { params: { supplier: supplier.name, qty: '12', note: tag } },
  );
  const po = await agent.extract('the number and status of the order just submitted', {
    schema: z.object({ number: z.string().regex(/^PO-\d{6}-\d{3}$/), status: z.string() }),
  });
  // the number is minted by the app → 'minted-token' cache gap; assert it through the API, not by replay
  const row = await rig.cloud('rina').findPo(po.number);  // GET /api/v1/purchase-orders
  expect(row.lines[0].quantity).toBe(12);
  await expect(screen.getByText(po.number)).toBeVisible();
});

test('phone: PO list keeps actions at the bottom, nothing scrolls sideways', { session: 'rina' },
  async ({ app, agent }) => {
    await app.open('/procurement/orders');
    await agent.assert('the New order action sits at the bottom of the screen and no table or strip scrolls sideways',
      { vision: true });   // NB: screenshots are withheld in sessions saved after a secret fill (Signing in) — needs the doc's workaround
  });
```
Scope the phone test with a target-only option (`requires`/`platforms` or `--target hub-phone`) so it does not run on the desk target.

**Sketch 2 — regression: a cancelled PO cannot be received (API setup + UI action + API proof).**
```ts
// e2e/agentic/tests/po-cancelled-not-receivable.e2e.ts
test('a cancelled PO with a waiting count cannot be received', { session: 'rina' }, async ({ app, agent }) => {
  const tag = `UJI-${Date.now().toString(36)}`;
  const po = await rig.cloud('rina').createPo({ tag, qty: 2 });          // as po-flow phase 1/4
  await rig.dc('yusuf').countDelivery(po.id, { qty: 2 });               // POST /api/v1/dc/purchase-counts
  await app.open(`/procurement/orders`);
  await agent.act('Open order {number} and cancel it with the reason {reason}',
    { params: { number: po.number, reason: `test ${tag}` } });
  await agent.assert('the order shows as Cancelled and offers neither Review count nor Receive');
  // the bug report's evidence was "Cancelled yet shows 2 pcs received" — prove it at the source
  await expect.poll(async () => (await rig.cloud('rina').getPo(po.id)).received_quantity).toBe(0);
});
```
If the bug is still open, this test should fail on the assert, or on the poll if Receive is reachable. Once it is fixed, the test guards the fix. That makes it a clean way to judge whether e2e earns its place.

**Sketch 3 — web till sale (ports pos-flow's till part; the till signs in inside the test because its token is in sessionStorage).**
```ts
// e2e/agentic/tests/till-cash-sale.e2e.ts   (till.config.ts → http://localhost:<till-web port>)
test('cashier rings one unit for cash and the screen total equals the node quote', async ({ app, screen, agent }) => {
  const dian = credentials.user('dian');
  const unit = await rig.store('maya').pickFloorUnit();                 // as pos-flow pick_units()
  const quote = await rig.store('maya').quote(unit.epc);                // POST /api/v1/store/quote
  await app.open('/');
  await screen.getByLabel('Nama pengguna').fill(dian.username);
  await screen.getByLabel('Kata sandi').fill(dian.password);
  await screen.getByRole('button', 'Masuk').tap();
  await agent.act('If a shift has to be opened, open it with {float} as opening cash', { params: { float: '500000' } });
  await screen.getByLabel('Pindai tag').fill(unit.epc);                 // label used by pos-flow (role textbox)
  await screen.getByLabel('Pindai tag').press('Enter');                 // verify the press API name
  await expect(screen.getByRole('button', `Bayar ${rupiah(quote.total_minor)}`)).toBeVisible();
  await agent.act('Pay in cash with the smallest suggested amount above the total and complete the sale');
  await agent.waitFor('the screen says Transaksi selesai');
  const sale = await rig.store('maya').latestSale();
  expect(sale.total_minor).toBe(quote.total_minor);
});
```
Here `rupiah()` copies pos-flow's formatter (`"Rp " + 1.234.567`). Agent text is matched loosely, so a no-break space is less of a problem than it is in regex.

**After the pilot:** port the rest of pos-flow (store app and hub reconciliation) as `@e2e-dev/web` tests sharing `support/rig.ts`. Add the 1–2 Oct manual pass (receiving branches, allotment, outbound) as agent-step tests. Only then consider the tablet via the mobile engine and a CI job.

### Gaps
- Exact seeded supplier and article names on a fresh `pos-e2e`-style rig were not read (`scripts/demo-seed.sh`, `scripts/demo-populate.py`).
- The CSRF requirements for cookie-based API fixtures on the hub origin, and whether the hub's Vite dev server proxies `/api` to `VITE_API_TARGET`, were not verified. The sketch assumes bearer-token API clients straight to the nodes, as po-flow does.
- These e2e API names were not confirmed in the docs excerpts read: `locator.press`, `.not` matchers, and `run --config`. Check them against the reference before writing real tests.
- How long it takes to record and replay a hub flow with OpenRouter models is unmeasured. It needs an actual pilot run.
