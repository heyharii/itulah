# pos-desktop — the counter terminal

A desktop till for a shop counter: React in a Tauri window, talking to that
shop's own `store-edge` node over the LAN.

```
                      cloud
                        │  sync
                    store-edge          ← one per shop, the authority
                   ┌────┴────┬────────┐
                   │         │        │
              pos-desktop  tablet  frontend-store-new
              (this app)   (till)   (shop app)
```

## What this app is, and what it refuses to be

It is a **terminal**. Stock, price, promotion, the sale and its sequence number,
the cash session and the sync to head office all belong to the node, and there
is exactly one node per shop. A terminal that kept its own opinion about any of
them would be a second authority in a building that is supposed to have one, and
the disagreement would surface weeks later as a stock count nobody can explain.

The single exception is **the basket that has not been sold yet**, which is
terminal-local on purpose. `POS-TABLET-PLAN.md` §1 spells out what the
alternative costs: six or more round trips per basket, and a half-finished
transaction left on a server every time shop wifi drops mid-sale.

So the rule, written once:

> The shell holds no domain state — except the unsold basket, which is the
> terminal's.

## Why Tauri and not C#

`POS-SHELL-PLAN.md` ruled "C# + WebView2, but not yet", and `fresh` had already
run the experiment three times: `pos-electron` (deleted), `pos-tauri` + a .NET
sidecar over stdio (two runtimes on a till), then `pos-app` — WinForms hosting
WebView2, 354 lines. Its ruling on Tauri was *"only if we stay cross-platform"*.

That condition is now met, and it is not a preference: this estate is developed
on a Mac, where a C# WebView2 shell cannot be built or run at all. Tauri builds
and runs here, which is the difference between a shell somebody can look at and
a shell somebody has to take on trust.

What the same document said about the *hardware* still stands, with one
counter-specific addition: the Chainway R3 is attached directly to the Windows
till and reads one tag at a time.

| Device | Whether .NET wins |
|---|---|
| RFID | No. The networked lane still POSTs signed sweeps to `/api/v1/rfid/observations`. The counter's Chainway R3 is the local exception: Rust calls Chainway's Windows C SDK, keeps the reader open with its buzzer muted, verifies the buzzer before each single-tag read, then sends that EPC through the same basket validation as a keyboard scan. |
| Fingerprint | No, though it looks like it does. `pos-fp-host/Native/ZkfpNative.cs` is a P/Invoke surface over `libzkfp.dll` from `libzkfp.h` — a plain **C** API. Rust binds a C API the same way. What C# has is a binding that already works, not a capability Rust lacks. **And it is not Windows-bound:** ZKTeco publishes an official ZKFinger SDK for Linux covering the SLK20R and ZK series, so a Linux till — or a Linux VM with USB passthrough, for testing — uses the same FFI. No official native macOS SDK was found; the only macOS mention is a third-party wrapper needing .NET/Mono, which is not evidence of a driver. Verify against the model actually bought. |
| Printer / drawer | No. Receipts are ESC/POS from the edge, which is already the party on the printer's LAN. |

If a device turns out to need .NET after all, the answer is one small
`fp-host.exe` spoken to over stdio — which is what `pos-tauri` did — not a
rewrite of the shell.

**The caveat that must not be forgotten:** Tauri uses WKWebView on macOS and
WebView2 on Windows. What is tested here is not the engine the counter runs.
Layout and logic carry; anything touching a device, and any rendering quirk,
has to be seen on Windows before it is believed.

## Layout

```
ui/              React + Vite. The shape is prototypes/pos.
  src/app.tsx    Sale screen, payment page, receipt.
  src/edge.ts    The only thing that knows the shell exists.
  src/pos.css    Taken from the prototype unchanged.
src-tauri/
  src/edge.rs    Proxy to the shop node. Holds the address, the token, the timeout.
  src/device.rs  The Chainway R3 read command, fingerprint and drawer status.
  src/rfid.rs    Windows SDK binding; reader kept open, reads refuse unless the buzzer is verified off.
  src/discovery.rs  Finds the shop's node on the LAN (mDNS), confirms each answer.
  src/join.rs       Asks the node to let this till in; the key never reaches the page.
  src/peripherals.rs  What is plugged into this till, reported to the node.
```

### Why calls go through Rust

The WebView is `tauri://` and the node is `http://…:8082`; the edge sends no CORS
headers, deliberately — it serves its own SPA same-origin, and
`backend/src/cloud/http/mod.rs` is the only place in the estate that opens an
allow-list. Widening the shop node's door so one client could skip a proxy is
the wrong trade, so `edge_call` forwards instead, and the node's address, the
device credential and the timeout live in one file rather than thirty call sites.

### Why the basket is tags and never quantities

Stock is tagged per unit and `SaleRequest` is `{ epcs, tenders, … }` — the node
is told which tags were sold. There is no field for a line with no tag, so a
barcode cannot become a basket line; it answers "how much is this" instead. A
till that offered a quantity box would be promising something the wire cannot
carry, and the refusal would arrive with a customer already holding out cash.

The EPC decoder is **not** copied here. It mirrors
`backend/src/cloud/domain/identity.rs`, and a third implementation of a 96-bit
format is the bug an architecture review already found once — so `@epc` is
aliased to the existing TypeScript one in `frontend-store-new/src/lib/epc.ts`.
It belongs in `frontend-contract`; moving it there is a one-line change to the
alias.

## Running it

```bash
cd pos-desktop/ui && npm install
npm run tauri dev          # from pos-desktop/, once tauri-cli is on PATH
```

The UI alone also runs in an ordinary browser (`npm run dev`, port 5410). There
is no shell there, so every call to the node and every device answers with the
same honest refusal a dead node would — never a fake success, which is the one
thing that teaches you a till works when it does not.

### What the terminal remembers

Which node it belongs to, which till it is, and the session token — in the
user's own config directory, written by the shell and never by the page. A till
is set up once by whoever installs it and then used by people who were never
told what a node address is; a terminal that forgot its shop every time it was
closed would be found broken in the morning by a cashier.

## Joining a node

A new till does not need an address typed or an admin's pairing:

1. **Setelan → Gabungkan ke node** (or the prompt on the sign-in card) listens
   for `_itulah-store._tcp` on the LAN (`src-tauri/src/discovery.rs`) and lists
   the nodes that confirmed themselves at `GET /api/v1/node/identity`, by the
   shop's display code and name ("C004-TOKO · Bumiayu") once the node has heard
   them from head office. A typed address is checked the same way — a router
   that drops multicast is common.
2. The shell mints a key, sends only its SHA-256 to `POST /api/v1/devices/join`
   (`src-tauri/src/join.rs`), and the screen shows a code and a six-digit
   number.
3. On a till that has already joined, a supervisor opens **Setelan → Kasir
   menunggu** — the top bar says when a till is waiting — checks the number
   matches, and approves with a finger or PIN, as a new till or as the
   replacement for one (which keeps its name). A replacement waits until the
   old till's cash shift is closed: the shift is kept by that name. A shop's
   *first* till is approved by a supervisor signing in on the new till itself;
   the node accepts that only for the first till, or from an Admin.
4. The till polls with an HMAC proof, and on approval keeps the node's
   `terminal_id` beside its key, exactly where a paired till keeps its pairing.
   Its name ("Kasir N") becomes its terminal name on receipts and shifts.

A joined till also keeps the node's mDNS instance and host. When the router
gives the node a new address and a call cannot connect, the shell listens
again, takes the new address only from a machine answering as the same origin,
and sends the call once more (`src-tauri/src/edge.rs`).

Discovery needs the machine's consent. On Windows the first listen raises the
firewall's prompt for the app: allow it on **private** networks. On macOS 15
and later the app asks for **Local Network** access (`src-tauri/Info.plist`);
refused, the till can neither hear the node nor reach it at a LAN address.

**Perangkat kasir** (from Setelan) records what is plugged into the till — the
customer display (optionally opened at start), the desk reader, the drawer, the
scanner, and the receipt printer: none, the typed address, a printer the node
recorded (by `printer_id`), or USB. It is kept by the shell and reported to
`POST /api/v1/devices/self/peripherals` signed as the till; an unacknowledged
report goes again at the next start.

A **USB receipt printer** is printed to by the till itself
(`src-tauri/src/printer.rs`): the node renders the receipt as it renders every
receipt (`POST /api/v1/store/sales/{id}/receipt/escpos`) and the shell sends
the bytes through the Windows spooler as a RAW job, or to a CUPS queue with
`lp -o raw` on a Mac or Linux till. The printer is chosen by the name the
machine lists it under, and *Cetak tes* proves it.

## Testing the fingerprint path without a fingerprint

The interesting half of this feature is not the sensor. It is the roster coming
down to a paired terminal, the claim being signed, the sequence being burned so
a captured claim cannot be replayed, and a supervisor's grant being spent once
and then expiring. None of that needs a scanner, and all of it is wrong in ways
a demo would never show if it were only ever tried on the day the hardware
arrives.

So a **development build** can be told whose finger to pretend matched: Setelan
terminal → *Simulasikan sidik jari milik*. Every answer it produces is labelled
`SIMULASI` in the words the cashier reads, and the block that implements it is
behind `#[cfg(debug_assertions)]` — a release has no code to read the setting
with, so a till in a shop cannot be talked into simulating a supervisor by
editing a config file.

There is a second rehearsal, and it is not a simulation at all: **the PIN.** A
node whose `till_step_up` is `PIN` (one row — `edge/pin.rs`, asked at
`GET /api/v1/auth/methods`) checks the secret itself, so signing in, the
supervisor's grant on a return or a void, and unlocking the counter after the
idle lock all run the production claim code with no scanner anywhere nearby.
The pad only appears when the node says it takes PINs, and a production node
refuses the whole route at the door — which is its own sentence, shown as the
node worded it.

What the simulation does not test, and what nothing on this desk can, is
whether the vendor matcher says yes to the right finger.

To test that, the blocker on this desk is **the absence of a scanner**, not the
operating system. ZKTeco ships a Linux SDK, so a Linux box — or a VM with USB
passthrough — exercises the real matcher without needing a Windows machine at
all. What cannot be arranged is a real answer from a device nobody has plugged
in.

### The other alternative, and why it is not a substitute

`pos-electron` also ships WebAuthn (`use-webauthn.ts`), used in exactly the
three places we care about — opening a shift, settings, and supervisor auth. On
a Mac that is Touch ID; on Windows, Hello. It works here today.

But it answers a different question. WebAuthn proves *the person enrolled on
this machine*; the roster proves *which member of this shop's staff*. A cashier
enrolled at till 1 cannot press at till 2, and covering somebody's break is the
ordinary case. So WebAuthn is worth having as a second factor for a terminal —
it is not a replacement for a shop-wide roster, and using it as one would be a
shop that discovers the difference on a busy Saturday.

## Not built yet

Receipt printing is built — the node renders and prints ESC/POS
(`POST /store/sales/{id}/receipt`), or renders it for the USB printer on the
till to print (`…/receipt/escpos`); the drawer opens through the printer's
pulse, and a reprint is stamped as a copy. So are: the PIN step-up (sign-in,
supervisor grants, and unlocking the idle lock — `scripts/pin-step-up-e2e.mjs`
is the executable contract), held baskets that survive a restart
(`pos.holds.v1`, terminal storage — the unsold basket is the terminal's to
keep), and pulling a handheld's sweep onto the basket (`GET
/api/v1/rfid/sessions`, board button or F6 — the reader's lane ends at the
node, so the till pulls and never polls).

The Chainway R3 USB binding is implemented for Windows. The **fingerprint
scanner** remains an honest stub (`src-tauri/src/device.rs`; it needs the ZK SDK
on Linux or Windows); the **price-check-to-basket** path for a garment whose tag has come
off (it has to be re-tagged; the wire has no field for a line without one);
the **finger enrolment screen** (the commands and the API exist; no screen
calls them); and cash movements beyond the simple in/out — DROP and PICKUP are
wired, PAYOUT and CORRECTION are not, because their supervisor field is not.

## Windows POS build

`.github/workflows/pos-windows.yml` builds on a pinned `windows-2022` GitHub
runner, tests the native commands, downloads the official Chainway R3 Windows
SDK, verifies its archive and DLL hashes, and packages an MSI. Pull requests
and pushes that touch `pos-desktop` upload the MSI as a 30-day Actions artifact.
The Windows build keeps the vendor DLLs in the installer without committing
them to this repository. In the sale screen, **Baca R3** performs one read on
a reader that stays open between scans (opened on first use, reopened once if
it was unplugged); the command refuses to inventory unless the SDK identifies
an R3 and the buzzer reads back as off.
