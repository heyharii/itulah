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

What the same document said about the *hardware* still stands, and is the thing
to re-check before committing further:

| Device | Whether .NET wins |
|---|---|
| RFID | No. Our lane is networked and signed — a reader proves an enrolment key and POSTs a batch to `/api/v1/rfid/observations`. Nothing requires a process on the till to open a USB device. |
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
  src/device.rs  RFID, fingerprint, drawer — stubs that say so out loud.
```

### Why calls go through Rust

The WebView is `tauri://` and the node is `http://…:8081`; the edge sends no CORS
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

What it does **not** test is the only thing it cannot: whether the vendor
matcher says yes to the right finger.

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

Receipt printing, device binding, and the price-check-to-basket path for a
garment whose tag has come off (it has to be re-tagged; the wire has no field
for a line without one). Cash movements exist on the node but only the simple
in/out is wired.
