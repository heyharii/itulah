# The store server — installed like software, enrolled from head office, run from a distance

Written 2026-09-26. Covers four things that turned out to be one design:

1. a shop's edge node (`backend/src/bin/store.rs`) shipped as a **Windows
   installer** that is ready the moment it is installed;
2. **enrolling** that machine from the hub with a one-time code instead of a
   hand-pasted `store.env`;
3. the **screens** that watch it — one in the shop, one at head office;
4. what head office may **do** to it from a distance: restart, resnapshot,
   update, collect diagnostics, retire.

Plus the two client shells that were asked about in the same breath: the hub
on phones (PWA) and on desktops (Electron).

Everything below was read before it was written: `bin/store.rs`,
`edge/sync.rs` (`EdgeSyncConfig`), `cloud/postgres/sync.rs`
(`register_origin_credential_binding`, `issue_command`, `commands_for`,
`publish_catalog_if_changed`), `cloud/postgres/auth_policy.rs`,
`deploy/scripts/provision-store.sh`, `deploy/edge/*`, `deploy/README.md`,
`frontend-hub/src/screens/system/nodes.tsx`, `pos-desktop/`.

---

## 0. Rulings

| Question | Ruling |
|---|---|
| What is the store server? | **A headless Rust service**, the same `store` binary as today. Not Electron, not Tauri: a server must run with nobody logged in, survive a reboot unattended, and restart itself after a crash. A GUI app can do none of that. |
| Linux or Windows? | **Linux for a dedicated box, Windows when the server has to be the shop's existing PC** (§3a). Both run the same binary: `rusqlite` is `bundled`, TLS is rustls, the only Unix-only code is a `cfg(unix)` signal handler in `bin/cloud.rs`. Linux is the better appliance — it can detect a *hung* process and a *frozen OS*, not only a crash, and it never reboots itself for an update at noon — but a Windows service with SCM recovery is not a toy, and a shop that already owns a Windows PC should not have to buy a second box. |
| How is it installed? | **One signed MSI**: service + tray + console, firewall rule, data folder, Start-menu shortcut. Silent-installable with the enrolment code as a property, so an IT person can roll out thirteen shops without visiting any. |
| How is it enrolled? | **One-time code from the hub, claimed by the machine, approved by a person at head office** who reads back a verification number with the shop over the phone (§2). Nobody types, sees or pastes the long-lived key. |
| Where is the "Grafana / btop"? | Two screens, one data source. **In the shop**: a live console served by the service itself at `localhost:8082/console`, plus a tray light. **At head office**: a Fleet page in the hub fed by a heartbeat that rides the sync cycle. **No Grafana per shop** — thirteen Prometheus stacks is thirteen more things to break. An optional `/metrics` endpoint keeps the door open for a central Grafana later. |
| How does HO control it? | **Signed commands that ride the sync reply**, exactly like catalogue and prices already do. The cloud never dials a shop — that principle is kept, and it is also why this works behind any shop router with no port forwarding. Deep support (a screen, a shell) goes over the existing headscale tailnet with RustDesk, outside the product. |
| Auto-start / auto-restart? | Windows service **Automatic (Delayed Start)** with SCM recovery **restart after 5 s / 30 s / 60 s**, reset daily. A crash loop is reported to HO on the next successful cycle. |
| Updates? | **Pulled, signed, windowed, reversible.** HO sets a desired version per ring (canary → stable); the node downloads, verifies an Ed25519 signature, applies only inside the maintenance window and only with no open cash session, health-checks, and rolls back binary **and database** on failure (§5). |
| Hub on phones | **PWA + Web Push**, iOS 16.4+ and Android alike. No Xcode, no Play Console, same origin, so the `SameSite=Strict` cookie keeps working. |
| Hub on desktops | **Electron**, loading the hosted hub (dev: `localhost:5273`). Chromium matches what Android and Chrome desktop run, `electron-updater` is the most mature update path there is, and an office PC does not care about 120 MB. **`pos-desktop` stays Tauri** — it is a small signed terminal on low-spec till PCs with Rust-side HMAC and a printer DLL; moving it buys nothing. |
| Create a brand-new store from the hub? | **Later, and separately (§8).** A site is not a row: `account_map` must resolve every meaning at every site (FINANCE-HARD-RULES I9), plus `org_place`, pools, inventory places, EDC terminals. Enrolment ships first for the thirteen sites that already exist. |

---

## 1. What exists, and the gap

- **Identity**: one ingest key per origin; the cloud keeps `sha256(key)` in
  `sync_origin_credential` and signs downstream commands per store with it.
  Origin is locked to its site and role once registered. Good — kept as is.
- **Registration**: `POST /api/v1/sync/origins`, guarded by the cloud's
  **master** key. `provision-store.sh` generates the key, prints it and a
  break-glass password into a `store.env`, and a person pastes that onto the
  box. The hub's *Register a node* sheet asks the operator to type the master
  key into a browser. Both put long-lived secrets through human hands.
- **Bootstrap**: there is none. Commands fan out to the origins registered
  *when they are issued*. A node enrolled after the last catalogue, price or
  policy publication receives nothing until something changes again.
- **Packaging**: systemd unit and Render only. No installer, no Windows
  service, no updater.
- **Observation**: `/sync/fleet` knows the watermarks. Nothing knows the
  machine — disk, clock, version, crashes.

---

## 2. Enrolment

```
 HUB (Admin)                     CLOUD                          SHOP MACHINE
 ───────────                     ─────                          ────────────
 "Pasang server" for store-07
   ──── POST /sync/enrollments ──▶ code K (shown once), 60 min,
                                   sha256(K) stored, site+role fixed
                                                                  install MSI → service starts
                                                                  unconfigured → /setup (localhost only)
                                                                  operator types K
                                                                  generates ingest key S locally
                                   ◀── POST /sync/enroll/claim ── {K, sha256(S), machine facts}
                                   50-bit, spent once, expires
                                   ── {enrollment_id, verify} ──▶ shows "482 913"
 Fleet shows pending claim:
 store-07 · DESKTOP-TOKO07 ·
 Win 11 · 10.0.4.23 · "482 913"
 (phones the shop: same number?)
   ──── POST …/approve ──────────▶ register origin with sha256(S)
                                   (existing binding rules:
                                    gen 1, or gen+1 on a new machine)
                                   enqueue bootstrap for this origin
                                   ◀── GET /sync/enroll/{id}  ──── x-sync-key: S
                                   ── approved + node config ───▶ writes node.json, key protected
                                                                  leaves setup mode, first cycle
                                   ◀══ handshake / ingest ══════▶ bootstrap commands drain
 Fleet: Menunggu → Terhubung → Sinkron awal 80% → Siap
```

Properties, each one a reason:

- **The code is not the key.** Ten Crockford-base32 characters (50 bits),
  single use, 60-minute default life, bound at issue to one site and role, five
  claim attempts. A leaked screenshot is worth nothing after an hour, or after
  one use.
- **The key is born on the machine.** The claim carries `sha256(S)`, which is
  all the cloud has ever stored. `S` crosses the wire only the way every sync
  request already sends it, over TLS in `x-sync-key`.
- **A code alone does not enrol.** A person at head office approves, reading a
  verification number derived from the code and the key digest back with the
  shop. Someone who stole the code shows a different machine and a different
  number.
- **The master key never leaves the cloud.** Approval is an Admin session in
  the hub, not `x-sync-key: <master>`. `/sync/origins` stays for scripts.
- **A replacement machine is the same flow** with `active_generation + 1`.
  `register_origin_credential_binding` already refuses the rollover while the
  old generation has durable facts that were never applied — which is exactly
  the moment a human must decide about a dead machine's unsynced sales.
- **No break-glass password.** Users and the SSO public key arrive in the
  bootstrap's `auth.policy.replace`. `INVENTORY_BOOTSTRAP_ADMIN_PASSWORD`
  remains for development and for the Linux script.

### Bootstrap

`bootstrap_origin(pool, origin_id)` issues, **to that origin only**, the
current state of every downstream stream the node would otherwise have
received over time: catalogue snapshot (`publish_catalog` at the current
publication's generation), auth policy, the active commercial publication with
usage, campaign switches and eligibility, attendance book, holiday calendar,
open purchase orders and active tagging jobs for its site. Each publisher is
already addressable by target; each must be checked to accept a late joiner.

Also exposed as a button (**Kirim ulang data awal**) and later as the
`node.sync.resnapshot` command — the same repair for a node that is already
enrolled and has drifted.

---

## 3. The package (Windows)

One binary, `itulah-store.exe`, grows subcommands; nothing else changes shape:

| Subcommand | What |
|---|---|
| `run` | Today's behaviour, foreground. `make run-store` keeps working. |
| `service` | SCM entry point (`windows-service`). Same router, same sync agent. |
| `enroll --code K` | Headless alternative to `/setup`, for scripted installs. |
| `diag` | Writes a diagnostic bundle (logs, config without secrets, metrics, `PRAGMA integrity_check`). |
| `backup` | `VACUUM INTO` a dated copy. |

Configuration moves from environment-only to **`node.json` in the data
directory**, written by enrolment; environment variables still override every
field, so development and the systemd path are untouched.

| Concern | Windows | Linux |
|---|---|---|
| Data | `C:\ProgramData\itulah\store\` — ACL: service account + Administrators | `/var/lib/itulah` |
| Secret at rest | ingest key sealed with **DPAPI (machine scope)** | `0600` file owned by `itulah` |
| Account | virtual account `NT SERVICE\ItulahStore`, not LocalSystem | `itulah` (existing unit) |
| Start / restart | Automatic (Delayed Start); recovery 5 s / 30 s / 60 s | `Restart=always` (existing) |
| Network | Firewall rule: port 8082, **Private profile, local subnet** — tills and tablets need the LAN; the internet does not | `nftables-store.conf` (existing) |
| Logs | rolling daily files, 14 days; start/stop/crash to Event Log | journald |
| Installer | **MSI (WiX)**, per-machine, `msiexec /i itulah-store.msi /qn ENROLL_CODE=K` | `.deb` later; script today |
| Signing | Azure Trusted Signing in CI (unsigned MSIs meet SmartScreen) | — |
| Build | GitHub Actions Windows runner, after `pos-windows.yml` | existing |

`/setup` and `/console` answer **only on loopback** until an admin signs in;
setup disappears once enrolled.

Shop-PC hygiene the installer sets or the console warns about: sleep off on
AC, Windows Update active hours covering opening hours, Windows Time running,
the data folder excluded from antivirus real-time scanning (SQLite WAL under
a scanner is the classic "the till is slow on Mondays").

---

## 3a. Unattended: what keeps the node alive with no developer in the room

Self-healing is layers, each catching what the one above cannot:

| Layer | Catches | Linux | Windows |
|---|---|---|---|
| Process supervisor | a crash | systemd `Restart=always`, `RestartSec=5` (existing unit) | SCM recovery: restart 5 s / 30 s / 60 s |
| Crash-loop latch | a crash that restarting cannot fix | `StartLimitBurst=5`, `StartLimitIntervalSec=600`, `OnFailure=` reports | same latch in the service (5 in 10 min, from `retail/server-electron`) |
| Liveness watchdog | a **hang** — alive but stuck | `WatchdogSec=60` + `sd_notify(WATCHDOG=1)` from the sync loop: no heartbeat, systemd kills and restarts | no OS equivalent; an in-process watchdog thread exits the process, SCM restarts it |
| Hardware watchdog | a **frozen OS** | `RuntimeWatchdogSec=30` in `system.conf`: the board reboots the box | none worth relying on |
| Self-repair | a corrupt database, a drifted node | `PRAGMA integrity_check` at boot → restore last good backup → `node.sync.resnapshot` | same |
| OS updates | security fixes without reboots at noon | `unattended-upgrades`, security only, reboot at 03:00 if needed | Windows Update active hours + a GPO; still the weakest row |
| Disk | a full disk | journald `SystemMaxUse`, log/backup pruning, alert < 10 % | same pruning, alert |
| Clock | tills refused for skew | `systemd-timesyncd` | Windows Time |
| Theft | a stolen box | LUKS bound to the TPM (`systemd-cryptenroll`): boots unattended, unreadable elsewhere; key revoked from the hub | BitLocker |
| Remote fixing | the rest | SSH over the headscale tailnet (`tag:store`, keys only, nothing exposed to the internet) + Cockpit for a web admin | RustDesk over the tailnet; OpenSSH server |

So "does it have to be Linux?" — no, but the watchdog and the
unattended-update rows are only fully covered on Linux. Default a *new*
dedicated server to a Linux mini-PC shipped as an image (Debian/Ubuntu LTS +
our `.deb` + tailscale), and support Windows for shops whose server is
the PC they already have.

A headless Linux box has no browser for `/setup`. It enrols with
`store enroll --code K` (built, §9) over the console, or the setup page is
opened to the shop LAN for the first boot only — safe because it is still
worth nothing without a valid code and head office's approval.

## 4. The screens

### In the shop — the console ("btop for the shop")

Served by the service at `http://localhost:8082/console`, live over SSE,
one page:

- **Status light** with a sentence — *Sehat*, *Perlu perhatian: sinkron
  tertunda 12 menit*, *Masalah: disk tinggal 4%*.
- **Sync**: cloud reachable, last good cycle, outbox depth and age of the
  oldest pending fact, commands pending/applied, generation, last error.
- **Machine**: CPU, memory, disk free on the data volume, DB and WAL size,
  uptime, **clock skew against the cloud** (terminal HMAC refuses skew; this
  is the first thing to look at when tills start failing).
- **Devices**: paired terminals and when each was last seen, tablets,
  handhelds/RFID readers, printers.
- **Is it safe to restart?** Open cash sessions and sales in progress. This is
  the question every support call starts with.
- **Jobs**: last backup, pending update and its window.
- **Log tail**, filterable.
- **Actions**: Sync sekarang · Backup sekarang · Restart · Buat paket diagnosa.

A **tray light** (`itulah-store-tray.exe`, a few MB of Rust) sits beside the
clock for whoever uses the PC: green/amber/red, *Buka konsol*, *Salin info
dukungan*. A service cannot draw a tray icon; this is why it is a second,
tiny process and not a feature of the service.

### Every state, and what each screen says about it

The rule for every row: **say what happened, since when, what the machine is
already doing about it, and whether a person has to do anything.** A red dot
with no sentence is not a status. The node writes each of these as an
incident (`edge/node.rs`, `incidents.ndjson`) so both screens read the same
record, and the times below are the ones the code enforces.

| State | Detected within | What the node does by itself | Shop console / till says | Head office sees | A person needed? |
|---|---|---|---|---|---|
| **Sehat** | — | — | green: *Server berjalan · tersinkron 5 detik lalu* | green row | no |
| **Offline** (no internet) | 3 failed cycles ≈ 15 s | keeps selling, queues everything | amber: *Internet putus sejak 10:42 · 37 transaksi menunggu · penjualan tetap jalan* | amber: *store-07 tidak terlihat sejak 10:42* (alert after 10 min in opening hours) | only if it lasts — check the router |
| **Sync tertinggal** | oldest queued fact > 30 min | keeps retrying with back-off | amber: *37 transaksi belum terkirim, tertua 42 menit* | amber + alert | if it keeps growing |
| **Crashed → restarted** | 5 s (supervisor) | restarts; next start records it | on the till: a 5-second *Menghubungkan ulang…*; console history: *Mati mendadak 10:42:05, pulih 10:42:10 (5 detik)* | grey note in history; alert only if repeated | no |
| **Hang → restarted** | 120 s without proof of life | own watchdog ends it (exit 70), supervisor restarts it | till: *Server tidak menjawab… menghubungkan ulang*; history: *Macet 2 menit, dimulai ulang otomatis 10:44* | amber note; alert if > 2 in a day | no, unless repeated |
| **Crash loop** | 5 starts in 10 min | holds 5 min, answers every request 503 with the reason, tries again, forever | red page (built, §9b): *Server toko berhenti sementara karena gagal 5 kali. Mencoba lagi otomatis pukul 10:52. Kantor pusat sudah diberi tahu.* | red + alert + diagnostics requested | **developer** — this is a bug or a broken machine |
| **Listrik padam → pulih** | next boot | boots (BIOS: power on after AC loss), starts, catches up | history: *Listrik padam 10:42–11:05 (23 menit) · 0 transaksi hilang* | note + outage length | no |
| **Pakai UPS** | 10 s | flushes the queue to head office, pauses backup/update | amber: *Listrik PLN padam — berjalan dengan UPS, sisa ±14 menit* | amber + alert | no (yet) |
| **Baterai UPS hampir habis** | UPS reports low | tells tills to finish, final sync, folds the WAL, shuts the OS down cleanly | red: *Server akan mati dalam 2 menit — selesaikan transaksi* | red | no; it comes back with the power |
| **Disk hampir penuh** | < 10 % warn, < 5 % critical | prunes logs, old backups | amber/red with GB left | alert | at < 5 %: yes (IT) |
| **Jam bergeser** | > 30 s vs cloud | enables NTP (Linux), warns | red: *Jam komputer selisih 3 menit — kasir bisa ditolak* | red | yes if NTP cannot fix it |
| **Database rusak** | integrity check at boot | restores the last good backup, resnapshots from cloud | red while repairing, then a history line | red + alert | if the backup is bad too |
| **Kunci ditolak** | first cycle after | stops syncing; keeps selling locally | red: *Mesin ini sudah diganti atau dicabut dari kantor pusat* | row shows the new machine | yes: this box is retired |
| **Update** | — | downloads, waits for the window and no open cash session, installs, health-checks, rolls back on failure | console: *Versi 1.4 dipasang malam ini 23:00* / *Update gagal, kembali ke 1.3* | version per store, ring progress | only on a failed rollout |
| **Menunggu pendaftaran** | — | serves `/setup` on loopback only | setup page | pending claim with the verification number | yes: approve |

Durations are always shown as *from–to (length)*, never as a bare
timestamp, because the question anybody asks is "how long was it down".

### At head office — Fleet

The hub's **System → Nodes** becomes **Fleet**. Every node reports a
heartbeat on the sync cycle (at most once a minute): version, uptime,
restarts in the last hour, CPU/memory/disk, DB size, outbox depth and oldest
age, clock skew, last backup, device counts, open cash sessions. The cloud
keeps the latest row per node and a one-minute series for 30 days.

- A table with a status light per shop, sortable by *worst first*.
- A node page with charts (recharts, already in the hub), command history,
  uploaded diagnostic bundles, enrolment history.
- **Alerts** into the existing notification table, and from there to Web Push:
  offline > 10 min during opening hours · oldest pending fact > 30 min ·
  disk < 10 % · clock skew > 30 s · no backup in 26 h · three restarts in an
  hour · version behind its ring.

---

## 5. Control from head office

New command types under `node.*`, on the existing signed, sequenced,
revocable command channel, each audited with `issued_by` and given an
`expires_at`:

| Command | Effect | Guard on the node |
|---|---|---|
| `node.sync.resnapshot` | re-run bootstrap | — |
| `node.restart` | graceful restart | deferred while a cash session is open, unless `force` |
| `node.diagnostics.upload` | bundle → cloud, authenticated by the node's key | size cap |
| `node.backup.now` | local `VACUUM INTO` (+ upload when §6 lands) | — |
| `node.update` | version, URL, sha256, signature, window | window + no open session; signature verified against a public key compiled into the binary |
| `node.config.set` | whitelisted keys only: log level, sync interval, maintenance window | unknown keys refused |
| `node.key.rotate` | node mints a new key, sends its digest; cloud swaps after the node confirms | two-phase, never leaves the node keyless |
| `node.retire` | stop syncing, lock the console, keep the data for collection | typed confirmation in the hub |

**Update, precisely**: backup DB (`VACUUM INTO`) → download → verify
signature and hash → rename the running exe to `.old` (Windows allows
renaming a running image) → place the new one → exit non-zero → the SCM
recovery action starts the new version → a good sync handshake within two
minutes or revert **both** the binary and the database copy, and report.
SQLite migrations are forward-only; that is why the database is part of the
rollback. The tablet till and the shop web apps are served by the node
(`edge/http.rs`), so they update with it.

---

## 5a. The UPS

A UPS keeps the lights on for minutes; the node's job is to use those minutes
and then go down cleanly rather than have the battery pull the plug mid-write.

- **Detect.** Linux: NUT (`upsmon`) over the UPS's USB cable. Windows: a USB
  HID UPS appears as a battery, read with `GetSystemPowerStatus`. The node
  polls every 10 s and records `POWER_ON_BATTERY` / `POWER_RESTORED`.
- **On battery.** Keep serving — the tills are usually on the same UPS.
  Push the outbox to head office immediately so the centre has the latest,
  pause backups and updates, show the remaining minutes.
- **Battery low** (≤ 30 % or ≤ 5 minutes). Tell the tills to finish the sale in
  progress, do a last sync, fold the WAL, stop the service, shut the OS down
  (NUT's `SHUTDOWNCMD`; Windows' critical-battery action).
- **Power back.** The BIOS must be set to *Restore on AC power loss: Power On*
  — the one setting no software can make. The box boots, the service starts,
  the backlog drains, and history shows the outage with its length.
- **What the UPS must carry:** the server **and the router/modem** (without
  the router, sync stops anyway), and at least one till. Size for 15 minutes.
- **Test it monthly** with the UPS's self-test; the incident journal proves it
  happened.

## 5b. Replacing a server, and a standby

Three levels, cheapest first:

| Level | How | Down for | Sales at risk | Automatic? |
|---|---|---|---|---|
| **Cold spare** (every shop can afford) | A spare box, installed but not enrolled, on a shelf (per shop or per area). Main box dies → switch the spare on → head office issues a code (or it was staged) → approve → generation + 1 → initial data from the cloud. | 10–15 min | only what had not reached head office — normally seconds of sales, unless the internet was also down | no: one person at the shop, one approval |
| **Warm standby** (large shops) | A second box on the LAN that continuously copies the primary's database (WAL streaming) and watches it. On failure, head office — or the store manager with a PIN — presses **Jadikan server utama**: the cloud revokes the old key and accepts the standby's, which continues the *same* stream because it holds the same outbox; the standby takes the shop's server address. | 1–3 min | ≈ none | one click |
| **Automatic failover** | The standby promotes itself. | seconds | — | **not recommended** |

Why not fully automatic: the usual reason a primary "disappears" from the
standby's view is the LAN or the power strip, not the primary dying. A
standby that promotes itself while the primary is alive gives the shop **two
servers selling under one identity** — two sequences for one stream, two
drawers, books that no longer reconcile (FINANCE-HARD-RULES). The only safe
referee is the cloud, and the cloud is unreachable in exactly the outages
where this matters. So: automatic *detection* and a loud alert, one-click
*promotion* by a person. (Letting the cloud promote when it is reachable and
has not heard from the primary for N minutes is a later option.)

What makes either level work, and is worth doing first:
- tills find the server by a **name**, not an IP (mDNS `itulah-store.local`, §7),
  so a replacement is found without touching every till;
- the **cold spare is pre-installed** and kept updated, so replacement is
  "switch on, approve";
- **daily backups** (§6) so even the dead box's last queue can be recovered from
  its disk when the disk survived.

## 6. Backup

Daily and before every update: `VACUUM INTO backups\store-YYYYMMDD.sqlite3`,
keep seven. Most of a node's state is re-derivable from the cloud; what is
not is the **unsynced outbox**, and that is what a backup protects. Uploading
off-site is a later step, encrypted to a head-office public key so a stolen
shop PC cannot read its own backups back.

---

## 7. Clients of the hub

- **Phones (PWA)**: manifest + icons + iOS meta, a service worker that caches
  only the app shell (`/api` and `/edge` network-only), an in-app update
  toast, an *Install* button where `beforeinstallprompt` (and `navigator.install`
  / `<install>` as Chrome ships it) exists, a three-step Add-to-Home-Screen
  sheet on iOS, and notification permission asked **after** install.
  **Web Push (VAPID)** fed from the notification table.
- **Desktop (Electron)**, `frontend-hub/desktop/`: loads the hosted hub (dev:
  `localhost:5273`, so the Vite proxy and cookies behave as today); tray and
  launch-at-login; notifications from an SSE stream (Electron has no push
  service); `electron-updater`; signed and notarised. A later option: a
  `protocol.handle` bridge that lets the desktop hub reach a DC node on the LAN
  through `/edge`, which the hosted hub cannot proxy.
- **LAN discovery**: the node advertises `_itulah-store._tcp` over mDNS and
  shows a pairing QR in its console, so tablets, handhelds and `pos-desktop`
  stop asking for a typed node URL.

---

## 8. A new store from the hub — deliberately last

Creating a site means, in one transaction: `site`, `org_place`, the three
store pools and their inventory places, the DC's per-store reject pool,
`account_map` rows so every meaning resolves (I9), and whatever finance setup
a unit needs (bank accounts, EDC terminals, tax). That is a finance design,
reviewed against FINANCE-HARD-RULES, not a side effect of the installer work.
Until then the hub enrols nodes for the sites that exist.

---

## 9. Phases

| Phase | Delivers | Depends on |
|---|---|---|
| **1. Enrolment** | enrolment table and endpoints, approve/reject/revoke, `bootstrap_origin` + *Kirim ulang data awal*, store setup mode (`/setup`, `node.json`), hub Fleet: *Pasang server* + pending approvals | — |
| **2. Package** | Windows service mode, DPAPI, logs, MSI, CI build + signing, silent install | 1 |
| **3. Watch** | heartbeat, Fleet table and charts, alerts, local console, tray | 1 (2 for tray) |
| **4. Control** | `node.*` commands, updater with rings and rollback, backups | 3 |
| **5. Clients** | hub PWA + Web Push; Electron hub; mDNS discovery | independent of 1–4; Web Push reuses 3's alerts |
| **6. New store** | site creation with its finance setup | finance review |

## 9a. What `heyharii/retail` already taught us

The older system solved several of these, mostly on Windows and mostly inside
an Electron tray app. Taken:

1. **Provisioning** (`internal/cloud/provisioning/`): Crockford codes that
   fold O/I/L, an atomic spend, only hashes stored, config locked to
   SYSTEM + Administrators after enrolment. Ours adds the key minted on the
   machine and the approval with a verification number.
2. **Watchdog policy** (`server-electron/.../router.ts`): back-off 1 s → 5 s →
   15 s → 60 s, a crash-loop latch after 5 crashes in 10 minutes shown as a red
   dot, graceful stop then forced. Ours puts it in the OS service manager,
   not in an app that only runs after somebody logs in — their own checklist
   flags that gap.
3. **Logs**: daily NDJSON, 50 MB roll, 14 days, panics wrapped rather than
   dropped, the supervisor's own events in the same stream; a viewer with
   level/domain facets, live tail, filtered export.
4. **The shop console layout**: running state, Start/Restart, uptime,
   cashiers online, sync pending by domain, last sync, breaker, *Sync now*.
5. **Windows service done right** (`cmd/printer-agent/service_windows.go`):
   one binary that is a service or a console depending on how it was started,
   with its own install/uninstall. The model for `itulah-store.exe service`.
6. **Command envelope**: expiry, allow-list, signature, ack. Ours already has
   it per store; `node.*` extends it with operations.
7. **Update policy**: download automatically, install only off-hours. They
   had no health check or rollback; ours does (§5).
8. **Monitoring**: raw numbers, `null` when unknown so the screen shows "—",
   never an invented health score.

Avoided: LAN endpoints that hand out pairing codes and secrets without
authentication; supervision that starts at user logon; hand-edited
Prometheus target lists (nodes push, the cloud never scrapes); dev secrets
committed; `irm | iex` + scheduled-task installs (and they later had to write
code to find and remove those — plan the migration away from any old install
from day one); no local backup.

## 9b. Phase 1 — status (2026-09-27)

Built and tested end to end (cloud + hub + a store node on this laptop):

- `backend/src/sync/enrolment.rs` — the shared protocol: codes, the
  verification number, wire types.
- Migration `0397` and `cloud/postgres/node_enrolment.rs` — issue, claim,
  status, approve (registration by digest, generation 1 or +1), refuse,
  `bootstrap_origin`.
- `register_origin_digest_tx` split out of `register_origin_credential_binding`;
  `dispatch_publication_to` and `publish_current_catalog_to` for one origin.
- `cloud/http/enrolment.rs` — Admin routes under `/sync/enrollments`, machine
  routes `/sync/enroll/{claim,status}`, `/sync/origins/{id}/bootstrap`.
- `edge/enrolment.rs` + `enrolment_setup.html` — `/setup` on loopback,
  `store enroll --code`, `node.env` written owner-only; an installed node
  never reads a stray `.env`.
- Hub: *Install server* sheet, the claim queue with the verification number,
  *Send initial data again* on a node.
- Tests: `tests/node_enrolment_integration.rs` (5), unit tests in the three
  modules.

Not yet: attendance book, open purchase orders and tagging jobs in the
bootstrap (reported as `pending`); DPAPI for the key on Windows.

## 9c. Phase 2 — status (2026-09-27)

Built:

- `edge/node.rs` — the unattended lifecycle: incident journal
  (`incidents.ndjson`), how the previous run ended (clean / crashed / power or
  reboot on Linux / hung), crash-loop latch (5 starts in 10 min → hold 5 min,
  answer 503 with the reason, retry; a clean stop resets the count), hang
  watchdog on its own thread (120 s, `ITULAH_HANG_TIMEOUT_SECONDS`), systemd
  `READY`/`WATCHDOG`/`STOPPING`, stop honoured in every phase, daily NDJSON logs
  kept 14 days.
- `edge/diagnose.rs` — `store diagnose`: enrolment, database integrity, queue
  depth and age, dead letters, stability over 24 h, service port, cloud reach
  and latency, clock skew, **whether the cloud still accepts the key**; a
  verdict in Indonesian and a JSON report with secrets removed; exit 2 on
  failure.
- `edge/winservice.rs` — `service`, `install-service` (virtual account,
  delayed auto start, restart 5/30/60 s incl. non-crash failures, data
  directory ACL, private-network firewall rule), `uninstall-service` (keeps
  data).
- `store stage-code` + the node claiming a staged code on its first start: a
  silent install enrols itself.
- `deploy/edge/store-edge.service` (notify, watchdog, never gives up) and
  `deploy/edge/install-store.sh` (`--code`, `--cloud`, `--appliance`,
  `--uninstall`).
- `deploy/windows/store.wxs` (MSI, `ENROLL_CODE`/`CLOUD_URL`) and
  `.github/workflows/store-server.yml` (both packages, plus an install /
  service / setup-page / uninstall smoke test on a Windows runner).

Verified on macOS against a local cloud: silent-install enrolment, crash,
clean stop, simulated hang (exit 70 after 30 s, recorded, next start says
*hung*), crash loop with the 503 explanation, clean stop while holding,
`diagnose` both with the cloud down and up, no key in reports or logs.

**Not verified here:** the Windows service, the MSI and the systemd unit
have not run on Windows or Linux yet — this machine is a Mac. The CI workflow
is where they first run; the Windows job installs, checks the service and the
setup page, and uninstalls.

## 10. Open questions

1. Is the store server a **dedicated mini-PC** or does the cashier PC double as
   it? If the latter, `pos-desktop` can carry the service as a sidecar and a
   shop installs one thing.
2. Where do release artifacts live? A private repo's GitHub Releases need
   credentials; an object store (R2/S3) or a cloud endpoint does not.
3. Who owns the code-signing identity (Azure Trusted Signing needs a verified
   organisation)?
4. Default maintenance window — opening hours differ per shop?
5. A Windows machine or VM to test the service and MSI on. CI can build it;
   someone has to install it.
