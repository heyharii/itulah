# Stores, Setup, System, GA, Workplace and the landing screens — branch map (9 Oct 2026, read-only survey)

All paths are under `/Users/hari/Documents/itulah/frontend-hub/src/` unless said otherwise. Routes come from the nav registry (`routes.tsx`);
the sheet that is open is a URL search parameter (`lib/sheets.ts`), so a test can deep-link: `/supplies?supply=<id>`,
`/assets?asset=<id>`, `/maintenance?repair=<id>`, `/contracts?contract=<id>`, `/locations?location=<site>`, `/discussions?thread=<id>`,
`/chat?conversation=<id>`, `/maintenance/replacements?replacement=<id>`.

**Components that decide how a test must drive the screen**

- `Select` (`components/ui/field.tsx`) is not a native `<select>`: a `combobox` trigger named by its label and a popup of `option` rows
  (a phone opens `PickerSheet`). `selectOption` fails with "not a <select> element".
- `Segmented` is a group of `button`s with `aria-pressed` (not radios). `Choices` (tiles) is a `RadioGroup`: `radio` roles whose name is label (+ note).
- `SubTabs` are `tab`s on a desk; on a phone the tabs fold into one dock button `Status: <current>`.
- Disabled menu rows (`Menu.Item`) keep their reason inside the accessible name: `menuitem "Update server Not from this menu yet…"`.
- `SavedDialog` closes itself after 3 s (5 s with undo): assert it first. `ConfirmButton` puts a server refusal inside the dialog.
- Hub reads are slow on the shared rig (load average ~35 on the VM): the default 5 s assertion window is not enough, tests pass `{ timeout: 60_000 }`.

## 1. Stores (`screens/stores/`, nav `stores/nav.ts`)

| Screen | Route | Component | Notes |
|---|---|---|---|
| Stores list | `/stores` | `StoresList` list.tsx | `GET /api/v1/stores` → `{items, can_manage}`; rows are links `✓ Name Cxxx · open since dd Mon yyyy Open Online …`; search textbox has no accessible name; "Open a new store" (desk button + `Fab`); a manager whose reach is one store with no `can_manage` is redirected to `/stores/<unit>` (list.tsx:60) |
| Store page | `/stores/$unit` | `StoreDetail` detail.tsx | tabs Overview · Server · Devices · Activity · Team · Payments · Stock · Facilities; tabs other than Overview need `site_id` else "This store has no shop site yet…" |
| Exceptions | `/stores/exceptions` | `StoreExceptions` exceptions.tsx | sheet params `exceptions-state` (open/unacknowledged/acknowledged/resolved/all), `exceptions-unit`, `exceptions-kind`; `Thresholds` button only for `bypass` (owner/admin); phone: dock status + Filters sheet |

Branches (backend: `GET /stores`, `GET/POST /stores/{u}`, `POST /stores/{u}/open`, `PUT /stores/{u}/tills`, `POST /stores/{u}/server/install`,
`GET/POST /stores/{u}/actions[/{key}]`, `GET /stores/{u}/actions/history`, `GET /exceptions`, `POST /exceptions/{id}/acknowledge`, `POST /setup/stores`):

- Row = ReadinessRing (done/total, or ✓ when not GETTING_READY) · name+code · city+open-since · status pill (Getting ready / Open / Closed) · server dot+word
  (Not installed / Waiting to be installed / Waiting for approval / Pulling its first data / Online / Offline) · tills (`N seats · a/b online`, or `a/b online · w waiting`).
- Phone card: figure = `done/total steps done` while getting ready, else `online/active tills online`; foot = server word + `N seats` / `w waiting`.
- Overview (overview-tab.tsx): fleet strip, exceptions card (All clear / N open), facts, banner for OPEN stores, else checklist `Ready to open` + `Open store 🎉`
  (`ConfirmButton`, disabled unless `can_open`, note optional; 409 sentence from the server). `can_manage` is Admin-only.
- Server (server-tab.tsx): NOT_INSTALLED → "Install server"; WAITING_TO_INSTALL → code + QR shown once (reload says it was shown once), "Issue a new code"
  cancels the old; WAITING_FOR_APPROVAL → verification number, "The numbers match — approve" / "Reject" (needs a claimed node); SYNCING banner; OFFLINE banner.
  `Actions` menu (actions.tsx): restart/resend/back-up/diagnose/sync/update; danger or note-required ones open a confirm dialog; disabled rows give `reason_disabled`.
- Devices (devices-tab.tsx): tills-online card, seat card (`Number of till seats`, 1..50, Admin only, "Submit"), device rows with `Test print` and device actions.
- Activity: `StoreActionEntry` rows (Queued/Sent/Running/Done/Failed/Expired). Team: PIC card + employees of the unit. Payments: enabled methods + "Manage in Finance". Stock: open flow documents. Facilities: "Open facilities" → `LocationHubSheet`.
- Exceptions: kinds SHIFT_NOT_CLOSED, DEPOSIT_MISSING, RECEIVE_OVERDUE, MISSING_OPEN, CASH_DIFFERENCE, CHECKOUT_UNRESOLVED; Acknowledge (note optional) only on OPEN rows; resolved rows have no button.
- Authority: nina/yusuf (OPERATIONS) get 403 `does not include Stores`; maya (store manager) sees only store-01.

## 2. Setup (`screens/setup/`)

- Wizard `Onboarding` onboarding.tsx — mounted by `App.tsx:233` only while `GET /api/v1/setup` says `finished=false` and the session has not deferred it (`sessionStorage central.hub.setup-deferred`).
  Steps: 1 Business (name, legal form pills, head-office address, Warehouse toggle) → 2 Stores (`StoreList`: name, city, manager per row; Enter adds a row, Backspace on an empty row removes it, pasting tab/newline text fills rows; "Open store"/"Open N stores") → 3 Books (Start fresh | Moving from other software + CSV/Excel upload; "Start recording from" month; "Finish") → done screen with manager links.
  "Finish later" defers. On this rig setup is finished, so the wizard is unreachable.
- `SetupCard` (home): "Setup is not finished / Continue setup" while unfinished; afterwards "Get the stores ready to open — N of 7 done" with rows team, store_nodes (→ /stores), payments (→ /finance/setup/shop-payment-methods), store_addresses (→ /locations), bank_accounts, tax_id ("Add NPWP" → `CompanySheet`), opening_balances; "Hide" (localStorage `central.hub.setup-card-hidden`).
- `CompanySheet`: Business name, Legal form (required), Head office address, NPWP (15/16 digits: "NPWP is 16 digits."), Warehouse toggle, "Printed as …", Submit/Cancel (`PUT /api/v1/setup/company`).
- `OpenStoresSheet` (open-stores-sheet.tsx) — the same sheet from Stores, Locations and the wizard: title "Open store" → after saving "Send these links" (`ManagerLinks`: link, Copy, WhatsApp, "Expires in 72 h", "install its server from its page") and the `SavedDialog` "Store C0xx created". `POST /api/v1/setup/stores` is idempotent per `Idempotency-Key` and refuses the whole batch if a store has no manager.
- Rig facts: legal_form is null on the rig's company, books IMPORTED/2026-10, tasks done: team, bank_accounts; pending: store_nodes (15), payments (3), store_addresses (16), tax_id, opening_balances.

## 3. System (`screens/system/`, nav `system/nav.ts`, Admin only)

`/system/users` Users (filter Store/Job role/Record, grouping, "Invite people", "Add user directly" sheet: Username, Name, Password, Rung), `/system/servers` Store Servers
(tabs Servers/Sync/Register/Health/Incidents; "Install server" sheet: Role, Code valid for, Site, Label → install journey with msiexec command; "Register by key" sheet: Node id, Ingest key, Label, Site, Node role),
`/system/devices` (tabs Devices/Readers; "Register reader" sheet), `/system/notifications` (All/Unread, Mark read, Mark all read), `/system/activity` (Everything/Refused). Sidebar rows "Sync" and "Account" lead to `/operations/node…`.

## 4. GA (`screens/ga`, `assets`, `maintenance`, `supplies`, `locations`, `contracts`, `letters`)

- `/ga` Overview: sections Contract renewals, Document renewals, Assets needing details, Service schedule, Repairs in progress, Asset replacements, New supply requests; "N items shown"; each row links to its sheet.
- `/assets` register: type chips, books All/Needs details/Registered, Condition + Location menus, 9 columns; `RegisterAssetSheet` (Item name, Asset code, Class, Site, Area, Holder, Serial/plate, Date acquired, Condition, build-specific fields; Register disabled until name/code/class/site/date); asset sheet tabs Detail/Documents/History/Class accounts, actions Move (To site, Area, New holder, Date moved, Reason), Replace, Request disposal.
- `/maintenance` Repairs: `RepairComposer` ("Problem", "Asset", object tiles, "Location", "Vendor" = EXPENSE-book suppliers, "Cost estimate", "Reported"); sheet: Approve budget (four eyes: creator cannot), Move stage (OPEN→APPROVED→IN_PROGRESS→COMPLETED→CLOSED, CANCELLED), Send bill to Finance once done. `/maintenance/replacements` (routed, not in the sidebar). `/maintenance/schedule`: Tasks (recurring, per asset or per location) and Inspections; "Record done" rolls the due date.
- `/supplies`: stages REQUESTED → APPROVED → ORDERED (PO number required) → RECEIVED → BILLED, Reject (reason) only from REQUESTED.
- `/locations` Sites: hub tabs Details/Assets/Contracts/Utilities/Repairs/Schedule/Supply requests/Bills (Finance); "Edit details"/"Complete" form (Site type, Floor area digits only, Address, Contact, Contact phone, Notes); "Open store" = the shared sheet.
- `/contracts`: KPIs Active/Due for renewal/Active contract value; composer "New contract"; sheet Details/Bills/Usage/Recurring bills/Documents, Archive (reason required).
- `/letters`: kinds All/Goods receipt note/Delivery note/Return PO/Letter, status filter, "New letter" → blank draft or from a record.

## 5. Workplace

`/discussions` (threads about a record: subject kind+id, title, opening post, tags; filters All/Unread/New/Mine/Bookmarked/Watching; thread sheet: reply `Post` textarea + "Post reply", Bookmark, Copy link, Notifications level, solution/lock/pin for managers), `/chat` (rooms: DIRECT/GROUP, "New conversation", "Search people and messages", message box `Message` + `Send`, unread counts), `/library` Files (Grid/List, "Add a file", saved views).

## 6. Landing screens

`/home` (hidden module, routed): greeting, SetupCard, Trade today / Stock / Commercial cards, assistant prompts. `/executive[/stores|/stock|/finance|/customers|/people]` (period Segmented This month/Last month/This quarter/This year + store menu; phone: dock `Period:`/`Store:` chips). `/reports` (Saved; "Compose one", "Ask the assistant"). `/apps` mobile launcher: greeting, unread banner (`N unread notifications`), one row per department the role may open with its waiting count (99+ cap), "Search or jump to…"; System only for ADMIN; a cashier gets "No office apps for this account".

## Seeds
`scripts/seed-ga-demo.sh` and `seed-ga-review.py` fill GA (assets, contracts, locations, supplies); the rig has none of it (GA is empty apart from supply requests), so GA tests make their own records through `POST /api/v1/ga/*` with a `tag()` in the code or name. `seed-workplace.py`/`demo-workplace.py` fill discussions and chat (the rig has the demo threads and rooms).
