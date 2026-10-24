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
till and reads the garments on its pad when the cashier asks.

| Device | Whether .NET wins |
|---|---|
| RFID | No. The networked lane still POSTs signed sweeps to `/api/v1/rfid/observations`. The counter's Chainway R3 is the local exception: Rust calls Chainway's Windows C SDK, keeps the reader open with its buzzer muted, EPC-only output, this counter's power, no tag filter and a pinned radio profile, asks the buzzer and the power before each read of the pad (a reset moves one or the other, and then everything is set again), then sends each EPC through the same basket validation as a keyboard scan. |
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
  src/device.rs  The Chainway R3 commands (off the window's thread), fingerprint and drawer status.
  src/rfid.rs    Windows SDK binding; SDK loaded once, reader kept open, one short inventory per read of the pad.
  src/fingerprint.rs  ZKTeco scanner on Windows (libzkfp.dll): identify against the node's roster, 3-press enrolment.
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

The Chainway R3 USB binding is implemented for Windows, for the R3 and the R3S.
The reader is known by its USB identity: Chainway's SDK opens only VID 0x2047 /
PID 0x0301, so a reader that answers on the link is one of them. Its firmware
version is read, never judged: **Test reader** shows it and every open logs it
with the bytes the SDK handed back, so an R3S's real one can be recorded on the
bench. Not done yet: the **price-check-to-basket** path for a garment whose tag has come
off (it has to be re-tagged; the wire has no field for a line without one);
and cash movements beyond the simple in/out — DROP and PICKUP are
wired, PAYOUT and CORRECTION are not, because their supervisor field is not.

## Windows POS build

`.github/workflows/pos-windows.yml` builds on a pinned `windows-2022` GitHub
runner, downloads the official Chainway R3 Windows SDK, verifies its archive and
DLL hashes, copies the x64 Visual C++ runtime the SDK imports (`vcruntime140`,
`vcruntime140_1`, `msvcp140`, app-local beside it in `rfid-native/`), tests the
native commands, and packages an MSI. Pull requests and pushes that touch
`pos-desktop` upload the MSI as a 30-day Actions artifact. The Windows build
keeps the vendor DLLs in the installer without committing them to this
repository. A local Windows build needs the same five DLLs in
`src-tauri/rfid-native/` (`tauri.windows.conf.json` lists them), so copy the
three runtime DLLs from `C:\Windows\System32` beside the SDK's two.

### The fingerprint scanner (ZKTeco, ZKFinger SDK 5.3.0.33)

`src-tauri/src/fingerprint.rs` binds `libzkfp.dll` the way the owner's working
attendance bridge does (`retail/attendance-terminal/zk-bridge/ZkDevice.cs`).
The DLL is not self-contained — it needs its capture plug-ins and the vendor's
libusb0 kernel driver — so the till ships the vendor's installer,
`src-tauri/fingerprint-native/ZKFinger-setup.exe` (SHA-256 checked in CI), and
loads `libzkfp.dll` from `System32`, where that installer puts it. On a new
till: Till devices → Sidik jari → **Pasang driver**, finish the installer,
replug the scanner, **Periksa**. The door and the Kepala toko's approval then
listen to the scanner on their own; enrolment is in the same section (pick the
person and the finger, press three times, saved at the node).

### The Chainway R3 at the counter

The reader button beside the scan field reads **the pad**: one short continuous
inventory (start, collect for the read window, stop, collect what was already
on its way), each EPC once with the strongest signal it was heard at. Every
tag of this shop's goes through the same scan path a keyboard scan does, so
"already in the basket" and one tag one item are decided in one place; tags
that are not this shop's are counted and left alone. Nothing reads on its own —
an always-reading mode is left out until the bench says whether it is wanted.

The shell opens the reader once and sets it up: any inventory a previous run
left going stopped, the buzzer muted, EPC-only output, the power set *without*
saving it in the reader and read back, tag filters cleared, the radio profile
pinned. While the till holds the reader no other app can change it; what can
is a reset putting back what the reader has saved, which turns the buzzer back
on and puts back the reader's saved power. So each read of the pad asks those
two first:

| Before a read | Round trips |
|---|---|
| Buzzer off and power as this till set it, the counter's | 2, then the read |
| Buzzer on, power moved or changed in *Till devices*, or the last read came back with TID bytes | about 25: set up again exactly as on opening, then the read |
| No answer, or the SDK reports the link lost | the reader is told to stop, then reopened, which sets everything up |

A read that comes back with TID bytes shows the reader reverted anyway: it is
not used and the cashier is asked to read again. **Blind spot:** a reset of
the radio alone — Chainway keeps the buzzer with the reader's own settings and
the rest with the radio's — on a reader whose saved power happens to equal
this counter's moves neither answer, and unless its saved output carries TIDs
the read runs on whatever the reader had saved. The SDK and its DLLs are
loaded once per process and never unloaded.

**The radio profile is pinned, never inherited** from whatever app used the
reader last. Tag filters are cleared on the EPC, TID and USER banks the way
Chainway's demo resets them (length 0, not saved) — the SDK cannot read a
filter back, so the reader's answer is what is checked. FastID and Tag Focus
are switched off, and the Query asks session S0 for target A, every other Gen2
field (Q, any Select, the link frequency) written back as the reader held it.
On the handheld's module our own tags lost 16 of 58 to FastID, answered 11 of
31 on a Gen2X link, and stayed silent long after a read in S2 and S3. A Gen2X
RF link (modes 10–15 in Chainway's API document) is moved to the PR-ASK mode
with the same Miller encoding and link frequency (0–5); any other link is left
and shown. Fast Inventory is switched off, and a wait time between reads is
set to 0 (the work time kept as the reader held it; the values it had are
logged). Nothing is saved in the reader, and everything it can read back is
read back once all of it is set. A reader that will not take a setting, or
whose link cannot be read, is not read at all and the cashier is told why.
What the till does not set is read too: a wait that still reads back other
than 0, an air protocol other than Gen2 or an output other than EPC only
refuses the reader, and the antenna mask is logged and shown, never judged (one
reader is no proof of its byte order). The work mode, dual/single target and
the reader's own repeat filter are not asked: on the first R3 probed each
answered only −1 after the full 1.5 s, which would add 4.5 s to every open. A
getter the reader does not answer is logged, never held against it. **Test
read** shows the firmware, the profile the read ran with (the work and wait
time among it), the antenna mask, and the region and channels the reader is
set to, by Chainway's names (read only: the band is the owner's decision; an
empty channel list shows as the region's own channels). Measure the bench
values below with this profile in place.

**Status and errors.** A chip beside the reader button, and the same on *Till
devices*, says how the R3 stands: **Ready**, **Busy**, **Needs attention** or
**Not connected**. The sale screen asks the shell every 5 s without touching
the reader, and again after every read. Every failure is a code from one
catalogue (`R3-05`, …) with one sentence and one action for the cashier, and
the detail for support in the chip's tooltip and the log;
[`docs/rfid-status-and-errors.md`](../docs/rfid-status-and-errors.md) lists
each code with what support checks. The node's refusals of a tag (already
sold, in the stockroom, not this shop's item) are shown as `TAG-` codes in the
same words. *Till devices* also has:

- **Check tag**: the EPC of a tag fixed at the pad, never sold. Every read
  leaves it out of the basket and looks for it; missing, or under 2 dB above
  the floor, the read needs attention.
- **Test reader**: the R3 opened afresh and timed, its settings read back,
  then three reads a second apart, with PASS or FAIL and the reason (the
  recipe, open and read times, tags per read and whether they were the same,
  records and distinct EPCs per read — the bench R3 stalled at about 35
  records an inventory — the weakest tag and its margin to the floor, the
  check tag).
- **Calibrate**: three reads of the test items on the pad; it suggests the
  weakest tag's RSSI less 3 dB and warns when a tag off the pad is within 6
  dB. Saved only when the installer presses *Use*.
- **Copy diagnostics**: app version and recipe id, SDK hashes, firmware and
  `C8` bytes, region and channels, the profile read back, the settings, and
  the last reads, faults and 40 SDK calls, as text on the clipboard.

To take one unit off a line of several, press × on the line and read the
garment being handed back on the pad (or scan or pick its tag): that tag is the
one removed, after the supervisor's approval, never the last one scanned.

**Bench values — measure these on the real counter before a shop uses it**, in
*Till devices* (saved in this till's `node.json` as `r3_power_dbm`,
`r3_read_ms`, `r3_min_rssi_dbm`):

| Setting | Default | What to measure |
|---|---|---|
| Weakest kept | −70 dBm (−100 to −20) | Installation calibration, preserved when the recipe is applied. RSSI does not guarantee the pad boundary; test missing inside tags and extra outside tags together. Lay garments on the pad and others where the racks, the bag shelf and the customer's side of the counter are. **Calibrate** suggests it from the test items on the pad, and **Test reader** lists the pad's garments with their signal and, under "Left out", every tag below the floor with its own; the floor goes between the weakest of the pad's and the strongest of the rest, then check a full pile on the pad still reads completely. On the bench R3 a tag a metre away read −75 to −79 dBm and one at the pad's edge −73, so −70 cut both. |
| Power | 15 dBm (fixed recipe) | It did not change the reach on the bench R3 (5 against 25 dBm: +0.1 dB median over 16 tags, and the tag a metre away read −75 to −78 dBm at 5, 15 and 25). At 30 dBm that R3 read nothing and fell back to its saved 12 dBm, so 25 is the top. Whether it takes effect after a power cycle is not tested yet. |
| One read | 2000 ms (fixed recipe) | Conservative production candidate, trading speed for a longer listening window. Old saved windows are replaced when the configuration loads. Earlier bench evidence: The bench R3 read all 14 EPCs 8 times out of 8 at 1000 ms and more, at every power; at 500 ms it missed one in 1 to 3 of 8. A read stopped at about 35 records whatever the window. |
| Between reads | 1000 ms (fixed, `R3_READ_GAP_MS`) | A read starts no sooner than this after the last one ended, waiting out the rest. Back to back, the bench R3 alternated about 30 and about 15 records; a second apart it was steady. |
| Exclusive access | — | With the till holding the R3 (after a **Test reader** run), open Chainway's demo app and try to connect to the R3: it must fail. If it connects, another app can change the reader under the till, which the two questions before each read do not cover. |

The bench's 16 test tags carry 14 EPCs: two EPCs are each on two chips. A pad
read is keyed by EPC, so each pair counts once, which is right for a shop whose
EPCs are unique. After a close the shell waits 1.2 s before opening the reader
again: the SDK's USB thread for the closed link can outlive the close by up to
a second and, when it ends, leave the next link with no queue. That is the
likeliest cause of the bench's reads 2 to 5 failing as "disconnected" with no
USB event; the shell also counts a lost link only by its own id now.

**The first R3 probed** (23 Oct, getters only, firmware `V2.2.9,R3,2023-08-09`):
- region 0x02 China Standard2 (920–925 MHz), not Indonesia; left as it is (the
  band is the owner's decision);
- saved power 12 dBm, EPC-only output, antenna mask `00 0F` with antenna 1
  reading, and an empty channel list (the region's own channels);
- buzzer, FastID, Tag Focus and Fast Inventory all off;
- the work-time getter answered −1, and the work-mode, dual/single and
  repeat-filter getters −1 after 1.5 s each;
- a 1 s read heard 15 tags at −34 to −76 dBm and stopped cleanly, with no
  late records. Under the −70 dBm default floor the weakest of them would
  count as too weak: the bench decides the floor.

The same R3 read again afterwards: region 0x02, saved power 12 dBm and EPC-only
output were unchanged.
