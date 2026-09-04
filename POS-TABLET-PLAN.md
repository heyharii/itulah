# The tablet till — one shell, one reader, and the desk we already built

Written 2026-09-04. Supersedes §3–§5 of `POS-SHELL-PLAN.md` on the question of
*what the cashier screen runs inside*: the answer is no longer "browser until a
till gets a device", because a till is getting a device — an R3 on a tablet.

Everything below was read before it was written: `~/Documents/retail/pos-android`
(8,467 lines of Kotlin), `~/Documents/retail/pos-electron/renderer`,
`~/Documents/fresh/pos-app`, and our own `handheld/` and `frontend-store-new/`.

---

## 0. Rulings

| Question | Ruling |
|---|---|
| Tablet or Windows/C#? | **Tablet.** The R3 is a USB-C sled; a tablet plus a sled is one object a cashier can be handed. Windows needs a Windows machine we do not have, and `pos-app`'s value was WebView2 — which Android has for free. |
| Which reference is the R3 POS? | `~/Documents/retail/pos-android`, `hardware/RfidManager.kt` → `RFIDWithUHFUSB`. |
| A WebView shell over the till we already have? | **Considered and rejected by the user.** It would have cost the least code, but a POS is the one screen in this estate that is touched ten hours a day, and a WebView on a tablet is where scroll, focus, keyboard and latency all go slightly wrong at once. |
| So what do we build? | **A native Android till**, Kotlin and Compose, against `/api/v1/store/*`. It reads `pos-android`'s hardware and layout lessons and none of its API. |
| Port those 8,467 lines? | **No — read them, then write against our own contracts.** Their screens are shaped around a server-side cart (§1) that our edge does not have and should not grow. |
| Which vendor library? | The one we already ship: `handheld/app/libs/DeviceAPI_ver20251103_release.aar` contains `RFIDWithUHFUSB`. The 2020 jar in `pos-android` is not needed. |
| Where does the till come from? | The edge serves it (`backend/src/edge/http.rs:222`). The tablet points at the node; upgrading the till is a deploy, not an APK. |
| Layout | The pos-electron shape — which `/sell` already is. Better where we can be (§3). |

---

## 1. What pos-android actually is, and why we do not want its middle

`pos-android` talks to the Go **store-router** with a server-side transaction:

```
POST pos/txn/start  →  POST pos/txn/{id}/item  (per garment)
                    →  POST pos/discount/evaluate  →  POST pos/discount/apply
                    →  POST pos/payment  →  POST pos/txn/{id}/complete
```

Six or more round trips per basket, each one a place where shop wifi can leave
a half-finished transaction on a server that now believes a sale is in progress.
`ApiService.kt` is 200 lines of that surface.

Ours is one shot. The basket lives in the browser
(`frontend-store-new/src/lib/basket.ts`), and `POST /api/v1/store/sales` carries
`epcs[]`, `tenders[]`, coupons and an idempotency key in a single body that is
priced, written and settled in one SQLite transaction. A till that retries over
a flaky link does not sell the garment twice.

**That difference is the reason not to port.** The Compose screens are shaped
around a server-side cart; they cannot be lifted without lifting the model
underneath them.

## 2. What we take

- **The reader lifecycle.** `RfidManager.kt` is the piece worth reading closely:
  USB permission broadcast → `getUsbDeviceList` → `init` → poll thread over
  `readTagFromBuffer()`. It matches what `handheld/core/Reader.kt` already does
  over UART, so one class serves both once the transport is a parameter.
- **The field-empty boundary.** `FIELD_CLEAR_MS = 3000`: once no retail tag has
  been seen for three seconds the pad was cleared, so the next read starts a
  fresh basket and the same physical tags can be scanned again. Without it a
  second customer's identical shirt is silently ignored as a duplicate.
- **The band.** `FREQ_MODE_ID_CN920` (0x02) for Indonesia's 920–925 MHz. The
  module keeps the last band across power cycles, so a unit tested elsewhere
  inits fine and reads nothing.
- **The layout.** Left column for scanning and a function board that never
  moves, right column for the basket, one CTA. `/sell` is already this.

## 3. Where we intend to be better

1. **The page is the till, not a copy of it.** One desk, one pricing path,
   shipped from the node. pos-electron and pos-android are two renderings of
   one POS and they have already drifted (`pos-android` has no hold list; the
   Electron one has a bag picker the Android one models differently).
2. **Device proof instead of a shared key.** `pos-android` puts a static
   `X-API-Key` in prefs and sends it forever. Our handheld signs each body with
   HMAC-SHA256 over `METHOD\npath\ndevice\nts\nseq\nsha256(body)` and the
   sequence only climbs, so a captured request cannot be replayed. The till
   gets the same treatment — a reader's evidence is signed, a cashier's session
   is a bearer, and the ledger keeps both answers.
3. **Reader power is a floor decision at the counter too.** A till running the
   antenna at 30 dBm reads the rail behind the counter into the basket. The
   handheld already learned this and exposes a fader; the till gets a
   conservative default (12 dBm, as `pos-android` uses) and the same control
   behind the settings sheet. `pos-android` has no answer for this.
4. **A basket that survives the shell.** The queue already exists
   (`lib/sale-queue.ts`); a sale taken while the node is unreachable is filed
   when it returns. `pos-android` cannot take a sale at all without the router,
   because the transaction lives there.
5. **Evidence is not a side effect of selling.** Tags the reader sees are filed
   as an observation batch whether or not the basket becomes a sale — the same
   `POST /api/v1/rfid/observations` the handheld files. An abandoned basket
   still proves the goods were on the floor.

## 4. Shape

```
tablet/                          # Gradle project, id.itulah.kasir
  core/Epc.kt                    # decode 0xA0 EPC-96 → SKU + serial. Decode only.
  core/UsbReader.kt              # RFIDWithUHFUSB: permission, band, power, poll
  data/Config.kt                 # node, terminal, printer, power. Prefs, no code.
  data/Api.kt                    # /api/v1/store/* and /auth/login. One file.
  data/Money.kt                  # minor units → what a cashier reads
  pos/TillViewModel.kt           # basket, catalogue, quote, tender, shift
  ui/DeskScreen.kt               # the counter: the pos-electron shape
  ui/{Tender,Shift,Receipt,Returns,Login,Setup}Screen.kt
```

**One rule holds the design together: the device decides nothing about money.**
The basket is a list of EPCs; the catalogue is a price *preview* the node
published; the figure that is charged is whatever `POST /store/sales` answers,
because the engine runs there and only there. If the two ever disagree, the
receipt is right and the screen was a guess.

## 5. Order of work

1. Config, Api, Epc, Money — the spine, with no screens. Compiles and logs in.
2. The desk: scan → basket → quote → tender → sale → receipt. Usable on a
   tablet with a wedge scanner and **no reader at all**.
3. `UsbReader` behind it: the same `onScan` path a wedge takes.
4. Shift: open, cash in/out, blind close, Z report.
5. Returns and void, with the supervisor step-up.
6. Observations filed with the device signature, so a basket that was never
   paid for still proves the goods were on the floor.

## 5b. The catalogue, after measuring it (2026-09-04)

The till first loaded the shop's whole price book at sign-in — 501 SKUs in
346–716 ms, which felt fine. Seeded to **100,000 SKUs** it is **32 MB over 200
requests and 14 seconds** on loopback, before wifi or a tablet's JSON parser.

Replaced by asking about what is in somebody's hand:

| Question | Endpoint | At 100k SKUs |
|---|---|---|
| What are these ten things called? | `GET /catalog/identities?skus=` | 84 ms · 2 KB |
| What do they cost? | `POST /store/quote` | 76 ms · 2 KB |
| How much is this shirt? | `GET /store/catalog?q=` | 9.5 ms · 7 KB |

Both asks run in parallel behind the same 250 ms debounce, so a basket costs one
pause. Names are cached per SKU (LRU, 4,000) for the life of the process.

**Ruling: a line never shows a price the till worked out itself.** The identity
endpoint carries `base_price_minor` — the intake figure — and using it would
repeat the failure this estate has already paid for twice, where a label and a
fact both quoted a number the counter never charged. A line shows a dash until
`quote` answers.

What was given up: the offline price preview. It was worth less than it looked —
the sale needs the node, so a till with no node cannot complete a transaction
either way.

## 6. What this does not fix

Unchanged from `POS-SHELL-PLAN.md` §5 "Still not built", and the shell cannot
help with any of them:

- **Selling a garment whose tag is dead.** `SaleRequest.epcs` means a unit is
  sold by its tag. This is the largest hole and it is a backend question.
- **Gift card and store credit.** No instrument is issued.
- **Member and manual discount at the till.** The panels have room; the
  endpoints are the gap.
- **Finding a sale to return by receipt number.** There is no
  `GET /api/v1/store/sales`; the returns screen needs one.

## 7. What not to do

- **Do not put pricing, tax, or return rules in the shell.** One engine, at the
  edge. `MainForm.cs` says it best: the bridge "holds no rules… a second
  opinion here could only ever disagree with the authority."
- **Do not make the reader mandatory.** A tablet with no sled must still sell.
- **Do not mint EPCs on the device.** The centre computes them; a second
  encoder in the field is drift this format has already paid for once.
- **Do not ship a second POS.** If a screen is missing, it is missing from
  `frontend-store-new`, and that is where it gets added.
