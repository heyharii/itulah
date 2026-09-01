# itulah · handheld

RFID handheld for the Chainway C5 (E710 UHF module). Four jobs — scan, packing,
receiving, stock count — against an Edge node, DC or shop.

## What it is for

Every screen files the same thing first: an **RFID observation batch**. That
batch is the evidence that these tags were in this pool at this time, and it
stands on its own. Packing, receiving and counting then do their own work on
top of it. If that second step fails, the app says so *and* says the
observation was filed — because it was, and sending someone back to re-sweep a
rack they already swept is worse than a confusing message.

## Talking to an Edge

The device proves itself per batch: it signs the exact body it is about to
send, plus a timestamp and a sequence that only climbs.

```
POST /api/v1/rfid/observations
x-device-id / x-device-timestamp / x-device-sequence / x-device-signature
signature = HMAC-SHA256(
    key  = sha256_hex(device_key),
    body = "POST\n/api/v1/rfid/observations\n{device}\n{ts}\n{seq}\n{sha256(body)}")
```

A human bearer token may ride alongside for attribution and for the endpoints
that need an operator (packing, receiving, count). It never replaces the device
credential: *which reader read this* and *who was holding it* are different
questions, and the ledger wants both.

Register a device from Cloud (`POST /api/v1/auth/rfid-devices`) — the response
carries `device_key` exactly once — then fill Setelan:

| Field | DC example | Shop example |
|---|---|---|
| URL Edge | `https://dc-br5g.onrender.com` | `https://store-mhpy.onrender.com` |
| Site ID | `dc-01` | `store-07` |
| Pool | `dc-01.warehouse` | `store-07.floor` |
| Device ID | `C5-DC-01` | `C5-STORE-07` |

One build serves both. Which node a handheld belongs to is a deployment fact,
not a code fact.

## Shared sessions

More than one handheld can work the same count. They do not need a coordinator,
a lock, or a leader — they need to agree on a **name**:

```
POST /api/v1/rfid/observations   { reader_session_id: "S-K7M2QP", ... }
GET  /api/v1/rfid/sessions/S-K7M2QP
```

Each reader keeps signing its own batches under its own device key; what makes
them one count is that they all file under that string. The union is a query,
not a merge, so nothing has to be reconciled afterwards and a reader that drops
off wifi mid-aisle simply contributes when it comes back.

**Deduplication is by EPC, and it has to be.** Two people sweeping the same
shelf see the same garment, and that is one unit. `tag_count` counts distinct
tags; `sighting_count` counts every filing. Reporting the second as the answer
would inflate every shared count by exactly the amount of help that was offered.

Codes are short and typable (`S-K7M2QP`, no `O`/`0`, no `I`/`1`) because they
are read aloud across a floor, not copied between machines.

## Two things that are deliberate

**It is silent.** No beeper, no vibration, and no switch to turn them on. A
count runs for an hour; a device that chirps per tag is a device the floor
turns off, and a reader nobody carries reads nothing. Feedback is on screen,
where it can say *what* was read.

**It decodes EPCs but never mints them.** The centre computes every EPC and
sends finished strings down. A second encoder in the field is the drift this
format has already paid for once — see `backend/src/cloud/domain/identity.rs`.

## Reader notes, learned the expensive way

- `setInventoryCallback` never fires on the E710. `startInventoryTag()` fills a
  buffer and `readTagFromBuffer()` drains it; that path works on every firmware
  this estate has met.
- The module comes up at **14 dBm**. Reading is fine there, writing is not —
  `Reader.init` asks for 30. The power getter returns 0 while inventory runs, so
  the figure shown is the one taken at rest.
- `setFilter()` is **silently ignored** by `writeDataToEpc(pwd, epc)` on this
  module. Any write must carry its filter inline:
  `writeDataToEpc(pwd, bank, ptr, len, filter, epc)`. This app does not write
  tags; the note is here because the next person to add it will need it.

## Design

Planet DS v5 — one ink at fixed alphas, surfaces `#F3F3F3 < #F7F7F7 < #FCFCFC`,
one blue `#2563EB` for brand, interaction and selection, and nothing else blue.
Cards are hairline rings, never shadows. Status is a quiet dot and a word.

Motion is restrained and reduced-motion-safe: a spring indicator that travels
between tabs, direction-aware content transitions, a staggered list entrance
capped so the two-hundredth tag does not wait, and a small press-spring where a
finger actually lands. `LocalMotion` reads the system animator scale; when
someone has turned animation off, everything here goes still.

## Build

```
ANDROID_HOME=/opt/homebrew/share/android-commandlinetools ./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```
