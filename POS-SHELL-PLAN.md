# The till — what it is, what it is missing, and what it should run inside

Written 2026-09-03; §5 rewritten the same day, after the work landed.
Two questions were asked together and they have different
answers, so they are answered separately: **what our POS backend actually does**
(§1–§2), and **what shell the cashier screen should live in** (§3–§5).

Every file:line below was verified against the working tree that day. Five
reference codebases were read: `~/Documents/fresh`, `~/Documents/retail/internal`,
`~/Documents/retail/final-product/backend`, `~/newton`, `~/Documents/slowdown`.

---

## 0. Rulings

| Question | Ruling |
|---|---|
| Is C# + HTML/CSS/JS possible? | **Yes — and it is where `fresh` finished**, after trying Electron and then Tauri. `pos-app` is WinForms hosting WebView2 and loading a React build. |
| Should we do that now? | **No.** Not until a till has a device the browser cannot reach. Today none of ours does. |
| Electron? | **No.** Nothing in the reference tree still uses it; `fresh` deleted its copy. Ships a second Chromium next to the Edge one already on the machine. |
| Tauri? | **Only if we stay cross-platform.** On Windows it is the same WebView2, so it buys nothing there and costs a Rust FFI binding to a C DLL — the exact layer `fresh` deleted. |
| What blocks the shell decision? | Nothing — and as of 2026-09-03 the backend no longer does either: the receipt, the shift and the reversal are built (§5). What remains is hardware. |
| Where do ESC/POS receipts belong? | **In `backend/src/edge/`, beside `printing.rs`** — not in a desktop app. The edge is already the party on the printer's LAN. |
| Language target | Ours stays Rust. `slowdown`'s "100% Go" ruling is that repo's, and does not travel. |

---

## 1. What the till is today

Twenty endpoints, of which **seven are the shop's own**
(`backend/src/edge/http.rs:274`); the other thirteen are shared with the DC
(`http.rs:300` — health, auth, catalog identities, RFID sessions, pools,
movements, sync).

| Route | What it does |
|---|---|
| `POST /store/sales` | Take the money. `SaleRequest` (`contracts.rs:259`) → `SaleResult` (`contracts.rs:365`) |
| `POST /store/quote` | Price a basket without selling it |
| `GET /store/catalog` | The shop's sellable range, at the shop's prices |
| `POST /store/receive`, `/store/receive-batch` | Goods arriving from the DC |
| `POST /store/movements` | Move stock between pools |
| `GET /store/reports/sales/{series,window}` | What this shop took |

**The sale is one shot and stateless.** There is no server-side cart. The
basket lives in the browser's `localStorage`
(`frontend-store-new/src/lib/basket.ts`, key `till.basket.v1`) and the whole
transaction arrives at once: `epcs[]`, `tenders[]`, coupon codes, customer id,
idempotency key. `complete_sale` (`sqlite.rs:3428`) opens one immediate
transaction, replays on the idempotency key, prices through the shared
evaluator, and writes `sale` / `sale_line` / `sale_tender` plus a movement
group.

What is genuinely good and should not be rebuilt:

- **Pricing is one engine, shared with the centre.** The price a customer is
  quoted from a screen is the price the counter charges. Promotions, coupons,
  campaigns, markdowns and tax rules all reach the till as a published price
  book.
- **Multi-tender is real** (`backend/src/tender.rs`). Half card, half cash is
  an ordinary basket. `screen_reference` refuses anything shaped like a PAN at
  the door.
- **`POST /store/quote` exists**, so a cashier can be told *why* a discount did
  not come off before the money is taken, not after.
- **Idempotency is enforced in the same transaction as the write**, so a till
  that retries a sale over a flaky link does not sell the garment twice.

### One naming trap

`store_receipt` (`0001_edge_inventory.sql:102`) is **goods receiving** — stock
arriving from a DC. It is not a customer receipt. We have no customer-receipt
table at all.

---

## 2. What the references have that we do not

`~/Documents/fresh/crates/store-edge` is the fullest POS in the tree: ~90k
lines of Rust, `http_pos.rs` alone 5,026. `~/Documents/retail/internal/store/pos`
is the Go oracle it was ported from: 17.7k lines with `transaction.go` at 2,243
and `returns.go` at 1,608. Both agree on what a till needs, and we are missing
most of it.

| Missing | Where it exists | Size |
|---|---|---|
| **Returns / refunds** | `fresh/…/returns.rs`, `internal/store/pos/returns.go`, `/pos/return/*` (8 routes) | 1,342 / 1,608 |
| **Exchange** | `fresh/…/exchange.rs`, `POST /exchange` | 1,045 |
| **Void / cancel** | `POST /void`, `/pos/txn/:id/cancel` | — |
| **Cash shift, blind close, X/Z report** | `fresh/…/cashshift.rs`, `http_cashoffice.rs`, `http_cashrecon.rs` | 1,954 / 2,164 / 1,483 |
| **Server-side cart, hold & resume** | `/cart/open|add|remove|hold|resume`, `/pos/txn/:id/hold` | — |
| **ESC/POS receipt + cash-drawer kick** | `fresh/…/escpos.rs`, `receipt.rs` | 199 / 666 |
| **Gift card, store credit** | `internal/store/pos/{gift_card,store_credit}.go` | 269 / 214 |
| **Member lookup at the till** | `fresh/…/http_members.rs`, `loyalty.rs`, `points.rs` | 1,193 |
| **Manager approval / PIN override** | `fresh/…/approvals.rs`, `/pos/approval`, `/auth/verify-pin` | — |
| **Manual discount / price override** | `internal/store/pos/discount.go` | 750 |
| **Non-RFID item entry** | `/catalog/search`, `/counter/search`, `/catalog/emergency-register` | — |

**The schema blocks the first three outright.** `sale.status` is
`CHECK (status = 'COMPLETED')` (`0001_edge_inventory.sql:115`). A sale in our
edge cannot be anything else — not voided, not returned against. Returns are
not a feature to bolt on; they need that constraint opened and a reversal
model, which is the one place the append-only fact discipline has to be got
right the first time.

### What the other three references contribute

- **`~/Documents/retail/final-product/backend`** — the parity port. Its
  `pricing-engine`, `checkout-benefits` and `return-policy` crates are
  differential-tested field-for-field against the Go oracle. If we build
  returns, **`return-policy` is the donor**: specificity-first `resolve_policy`
  plus `evaluate`, already proven against `internal/returnpolicy`.
- **`~/newton`** — a Next.js agent harness driving the *DC* over 56 Go tools.
  No POS. Nothing to take for the till.
- **`~/Documents/slowdown`** — a normative target architecture doc (1,704
  lines) freezing that repo on 100% Go with Rust demoted to "design oracle,
  donor invariant, donor test". Its **truth lanes** — identity / subject /
  position / value — are worth reading before touching returns, because a
  return is a position fact and a refund is a value fact and conflating them is
  how a till starts disagreeing with the ledger. The Go ruling itself does not
  apply here.

---

## 3. The shell — an experiment already run

`fresh` shipped the cashier terminal three times.

**1. `pos-electron`** — gone from the tree. Only referenced in the past tense.

**2. `pos-tauri` + `pos-rfid-host`** — a Rust shell spawning a .NET console app
as a child over stdio JSON-RPC. Two runtimes on a till, plus sidecar restart
and backoff logic that existed only to survive the arrangement.

**3. `pos-app`** — WinForms hosting WebView2, with `pos-rfid-host` demoted from
a console app to a **library referenced in-process**. The reasoning is written
into the projects themselves, unhedged:

> This used to be a stdio JSON-RPC child spawned by a Rust shell. The shell is
> gone: the POS app is C#, so the device layer is simply referenced and called.
> That deletes the IPC hop, the second runtime, and the sidecar restart/backoff
> that only existed to survive it.
> — `pos-rfid-host/PosRfidHost.csproj`

> What did NOT change: the UI. WebView2 is the same engine Tauri uses on
> Windows, loading the same React build.
> — `pos-app/Program.cs`

The whole shell is **354 lines of C#** (`Program.cs` 65, `MainForm.cs` 289).
The UI it hosts is an ordinary Vite + React + TanStack build, served from disk
under a virtual host (`https://pos.local/`) rather than `file://`, because
`file://` breaks `fetch` and anything origin-scoped.

### Why C# won there, and whether it applies to us

Not performance. `fresh/docs/design/rfid-r3s-native-callback.md` says so
directly: the reasons were **one self-contained `.exe` with no JRE across 13
stores**, and **fewer layers** — P/Invoke straight into `UHFAPI.dll` versus
JVM → JNA → jar → wrapper. The decisive fact is that the vendor RFID SDK is a
native Windows x64 DLL with a C callback (`setOnDataReceived`), and the only
runtime that speaks to it without a bridge is .NET.

**That fact is not ours.** Our RFID lane is networked and signed: a reader
proves possession of an enrolment key and POSTs a batch to
`/api/v1/rfid/observations` (`backend/src/edge/rfid.rs:472` — HMAC over
`POST\n{path}\n{device_id}\n{timestamp}\n{sequence}\n{body_sha256}`, monotonic
sequence, 300s skew ceiling). Our handheld is Android. Nothing in our design
requires a process on the till to open a USB device.

So the C# argument only bites when a till gets a **USB reader on Windows** —
and then it bites hard, because it is the shortest path to `UHFAPI.dll` and
`pos-app` is 354 lines we can read.

### The other thing `fresh` decided

It **deleted its server-rendered HTMX cashier UI** — about 8.1k lines of HTML
rendering — and wrote the epitaph into `crates/store-edge/src/lib.rs:268`:

> HTMX is not coming back, so nothing here serves CSS or JS any more.

We are already on the other side of that: our edge serves a built SPA via
`ServeDir` and the JSON surface stays JSON. **Do not put HTML rendering back
into the Rust edge.**

---

## 4. What actually decides the shell

Not taste — the device list. A browser can reach almost everything if the edge
is on the LAN, because the edge already opens raw TCP sockets to printers
(`backend/src/edge/printing.rs:1`).

| Device | Browser alone? | Notes |
|---|---|---|
| Network RFID reader | **Yes** | The reader reports to the edge itself; the till never touches it |
| Barcode scanner (USB) | **Yes** | HID keyboard-wedge — it types |
| Receipt printer on LAN `:9100` | **Yes, via the edge** | Same shape as ZPL today. Build it as an edge endpoint |
| Cash drawer | **Yes, via the edge** | The kick rides the receipt printer's RJ11 port — `ESC p 0 25 250` |
| Customer display / second screen | **Yes** | A second browser window on the same edge |
| **USB RFID reader (R3S / `UHFAPI.dll`)** | **No** | Native Windows DLL, C callback |
| **EDC / payment terminal (serial)** | **No** | Usually COM or vendor SDK |
| **Fingerprint (ZKFinger)** | **No** | Native SDK |

The three "No" rows are the entire case for a native shell. Note that
`fresh` solved fingerprint **without** putting it in the shell — a separate
`hardware-agent` process exposing local HTTP plus an event cursor
(`attendance-tauri/README.md`). That pattern keeps the shell thin and is worth
copying if the EDC lands before the reader does.

---

## 5. What was built (2026-09-03)

Phase 1 and the desk landed the same day this was written. What follows is
what is in the tree, not a plan.

### The schema — `0024_a_sale_the_shop_can_take_back.sql`

`sale.status` was `CHECK (status = 'COMPLETED')`, so the table is rebuilt to
allow `VOIDED`; rows are copied unchanged. Added: `cash_shift` (with a partial
unique index enforcing **one open shift per terminal** in the database rather
than in application code), `cash_movement` (signed, so the expected drawer is
one `SUM`), `sale_return` + `sale_return_line` (with a unique index making a
unit returnable **once**), and `sale_line.base_unit_price_minor` — the engine
computed the list price, the fact carried it to the centre, and the shop's own
copy threw it away, so a receipt could say what was charged and never what the
markdown was worth.

### The code

| File | What |
|---|---|
| `backend/src/edge/escpos.rs` | ESC/POS receipt renderer + drawer kick (`ESC p 0 25 250`). Emits **bytes**, not text. 58mm/80mm. |
| `backend/src/edge/till.rs` | The shift, the supervisor step-up, the reversal rows, the receipt assembly. |
| `backend/src/edge/printing.rs` | `send_bytes` added; `send_document` delegates to it. One guarded socket path for labels and receipts. |
| `backend/src/edge/sqlite.rs` | Nine trait methods, the movement commands, the shift stamped onto every sale. |
| `backend/src/edge/http.rs` | Nine routes. |

### The routes

```
POST   /api/v1/store/shifts                     open the drawer
GET    /api/v1/store/shifts/active              the shift running here (null is ordinary)
GET    /api/v1/store/shifts/{id}                the Z report
POST   /api/v1/store/shifts/{id}/movements      drop · payout · pickup · correction
POST   /api/v1/store/shifts/{id}/close          blind close
POST   /api/v1/store/sales/{id}/void            undo the whole sale
POST   /api/v1/store/returns                    take part of it back
GET    /api/v1/store/sales/{id}/receipt         the document
POST   /api/v1/store/sales/{id}/receipt         render it and print it
```

### Rulings made while building

- **The close is blind.** The declaration arrives with the request and the
  expectation is computed server-side; both numbers and their difference are
  stored. A cashier shown the expected figure counts toward it.
- **A supervisor is a step-up, not a session.** `verify_supervisor` checks a
  second person against `edge_user` and issues nothing; the cashier stays
  signed in. One refusal message for every failure, so the endpoint cannot be
  used to enumerate who can authorise a void. **Consequence:** a node running
  `INVENTORY_AUTH_MODE=disabled` has no identities at all, so voids and returns
  are impossible there. That is correct — a reversal nobody signed is a
  reversal nobody can be asked about — but it means dev nodes need auth on.
- **Only cash is in the drawer.** Expected = float + cash movements + cash
  taken − change given − cash refunded. A report that added card sales would
  show a shortage every evening for exactly the card takings.
- **`CustomerReturn` already existed** in the movement domain
  (`External{Customer}` → `StoreFloor` or `StoreReject`). The invariants were
  right; only the till surface was missing.
- **The receipt prints in the machine's LOCAL time.** The node runs in the
  shop, so its clock is the shop's clock. Printing the wire's RFC 3339 put
  `2026-09-03T03:33:05.597444Z` on 32-column paper and pushed its own label off
  the row — caught on a real socket, fixed, and pinned by a test.

### The desk — `frontend-store-new`

`/sell` renders as the **pos-electron shape in Cloud Hub tokens**: left column
at 42% for the scan field and a three-by-two function board that never scrolls
and never moves, right column for the basket, the total and one black CTA.
Below `md` it stacks, so a tablet on a counter still works. The floating
squircle tab bar is hidden at the width the desk appears at — the board carries
the same destinations, and two navigations on one screen is two places to look.

New: `components/shell/desk.tsx`, `lib/till.ts`, `screens/shift.tsx`
(Z report · cash in/out · blind close · printer), `screens/returns.tsx`
(find the sale → scan each garment → sellable or damaged → refund, with a
separate red button for voiding the whole sale). Receipt printing on
`screens/receipt.tsx`; every print after the first is stamped a copy.

### Verified end to end

Against a live node with auth on: shift opened → two garments sold for
Rp 450.000 cash from Rp 500.000 → drawer read 500.000 + 500.000 − 50.000 =
950.000 → one garment returned DAMAGED at the price it was charged
(Rp 200.000), landing in `store-07.reject` → drawer 750.000 → the same tag
refused a second time → the rest voided → receipt stamped `** RETUR **` then
`** BATAL **` → the paper rendered onto a real TCP socket, 525 bytes, `ESC @`
first, drawer kick present, `GS V` cut last. Thirteen new unit tests.

### Running it

```
INVENTORY_BOOTSTRAP_ADMIN_PASSWORD=<pick one> \
  <launch the `till-edge` entry in .claude/launch.json>
```

The launch entry sets `INVENTORY_AUTH_MODE=required` on purpose — with auth
disabled there are no identities, so no void and no return can be authorised.
The bootstrap password is not in the file; export it in the shell the first
time, and the node creates `admin` once.

### Still not built

- **Gift card and store credit.** No instrument is issued yet.
- **Server-side cart, hold and resume.** The `localStorage` basket is honest
  about surviving a reload, and nothing needs a second terminal to resume one.
- **Selling a garment whose tag is dead.** `SaleRequest.epcs` means a unit is
  sold by its tag. Searching for it already works (`GET /store/catalog?q=`),
  but *selling* it does not — that needs quantity-lot sales, which is the
  subject model, not the till. This is the largest remaining hole.
- **Member and manual discount at the till.** The left column has room for the
  panels; the endpoints are the gap.

### Phase 2 — keep the UI shell-agnostic from now on

Do this while building Phase 1 screens, not afterwards. One module —
`frontend-store-new/src/lib/device.ts` — is the only place that knows a device
exists:

```ts
// Browser: every capability reports false, and the screen offers the edge path.
// WebView2: chrome.webview.postMessage / addEventListener('message').
// Same envelope either way: { cmd, ... } out, { topic, payload } in.
```

That envelope is exactly `MainForm.cs`'s bridge, which is thin on purpose:
*"It forwards commands and forwards events; it holds no rules. Business
decisions belong to Store Edge, and a second opinion here could only ever
disagree with the authority."* Keep that rule. Every screen must work with the
bridge absent.

### Phase 3 — the shell, when and only when hardware demands it

Trigger: a till gets a USB RFID reader, an EDC, or a fingerprint pad.

Then port `fresh/pos-app` — it is 354 lines and the hard parts are already
solved (WebView2 virtual host, UI-thread marshalling of native callbacks,
ordered teardown so the reader is not left stuck until somebody unplugs it,
evidence flushing on a timer rather than on checkout so an abandoned basket
does not erase the fact that goods were physically present).

Three deltas to close on the way in:

1. **Sign the evidence.** `ObservedClient.cs` posts with a plain `x-api-key` to
   `api/v1/rfid/observed`. Ours is `/api/v1/rfid/observations` and requires the
   device proof. Port `sign_rfid_request` to C# and enrol the till as a device.
2. **Vendor natives.** `UHFAPI.dll` and `libusb-1.0.dll` are not in this repo.
3. **Windows only.** `net8.0-windows`, WebView2 Runtime as a deployment
   prerequisite. Our dev machine is a Mac, so this is a CI-and-a-test-terminal
   arrangement from day one — do not discover that at deployment.

If we ever need Linux or a tablet at the counter, **that** is when Tauri is
reconsidered — not before, and the cost is a Rust binding to a C DLL that C#
gets for free.

---

## 6. What not to do

- **Do not build the shell first.** It changes nothing a shop can feel. Returns
  and a cash shift do — which is why they were built first.
- **Do not render HTML in the Rust edge.** `fresh` deleted 8.1k lines of that
  and said so in writing.
- **Do not use Electron.** WebView2 is already on every Windows terminal.
- **Do not put pricing, tax or return rules in the shell.** One engine, at the
  edge. The two-POS divergence this repo has already lived through started
  exactly there.
- **Do not model a return as a negative sale row.** `sale.status` is checked
  for a reason; open it into a real reversal or the ledger will disagree with
  the drawer.
