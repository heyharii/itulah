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

## Power is a floor decision

Everything else in Setelan is set once at commissioning. **Reader power is not**:
a fader in Setelan moves the antenna between 5 and 30 dBm, and the figure above
it is what the module reported back after the change, not what the finger asked
for.

Full power reaches the back of a rack — and, in a shop, the rack on the other
side of the wall. That is how a floor count quietly acquires the stockroom, and
it is wrong in the one way nobody checks, because a count that is too high looks
like a count. Turn it down when the sweep is supposed to mean the aisle you are
standing in.

### What power actually buys, measured

Two relationships, easy to confuse, both true:

| | law | rule of thumb |
|---|---|---|
| **Read range** — can the tag power up at all | `r ∝ √P` | **+6 dB doubles the distance** |
| **RSSI** — how loud the answer comes back | `P_rx ∝ P_tx / r⁴` | **1 dB per dB**; −12 dB per doubling of distance |

Measured on a C5 against a fixed set of tags, ten seconds per step:

| dBm | tags read |
|---|---|
| 30 | 7 |
| 28 | 4 |
| 26 | 2 |
| 25 | 1 |
| 24 and below | 0 |

The best-sampled tag gave peaks of −71.6 / −74.2 / −75.9 dBm at 30 / 28 / 26 —
a slope of **1.08 dB per dB**, which is the round-trip law above. Tags with few
reads scattered by several dB; that is multipath, and it is why a reading has to
be averaged over many sightings before it means anything.

Two things worth knowing before trusting any of it:

**A tag does not fade, it vanishes.** RSSI slides gently with power, then the
tag stops answering the moment it can no longer power up. Every tag has its own
cliff, set by its distance. That is why the table above is an extinction curve
rather than a gradient.

**Range is chip sensitivity, not signal strength.** The tag still readable alone
at 25 dBm was the *weakest* of the set at −83 dBm, while tags answering at −72
had already dropped out. How far a tag reads and how loud it answers are
different parameters, so you cannot infer distance from RSSI across tag types.

It is reachable from both places it is needed. **Setelan** has the full card,
with the prose. On the **sweep screen** the reading in the corner of the count
card is itself the control: tap it and the fader unfolds under the count, which
costs the list no room until somebody wants it. Changing it mid-sweep stops
inventory, moves the power and starts it again — a tenth of a second, and
nothing is lost, because the collector is not the radio.

The choice is kept in prefs under `reader_power` (0 = nobody has chosen) and
pushed to the module at the start of every sweep, so a handheld turned down last
night is still turned down in the morning.

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
- The module comes up at **14 dBm**. Reading is fine there, writing is not, so
  with no preference stored `Reader.init` takes as much as the module will give.
  The power getter returns 0 while inventory runs, so every figure this app
  shows is one taken at rest — including the one the fader snaps back to.
- There is **no API to ask the module its range**. `MIN_POWER`/`MAX_POWER` are
  the 5–30 dBm window this hardware accepts; a refused figure walks down rather
  than giving up, and the screen reports what came back, never what was asked.
- **`setPower` on an already-open module is silently unradiated.** It returns
  true, `getPower` echoes the new figure, and the antenna stops transmitting.
  Measured on a C5 (E710_V7.10.1) against fixed tags: 40 reads at 30 dBm became
  **zero at 29 dBm** — not something one decibel can do to a tag sitting at
  −78 dBm. Applying the figure during `init` is the only order that moves the
  radio, so `Reader.setPower` closes and re-opens the module. Same species of
  trap as `setFilter` above: the call succeeds, the read-back agrees, the
  hardware does not do it.
- That re-open costs **about seven seconds** of dead antenna, measured from the
  gap between tag reads. Mid-sweep the screen therefore goes `busy` and stops
  offering Finish — seven silent seconds is a rack walked past.
- `setFilter()` is **silently ignored** by `writeDataToEpc(pwd, epc)` on this
  module. Any write must carry its filter inline:
  `writeDataToEpc(pwd, bank, ptr, len, filter, epc)`. This app does not write
  tags; the note is here because the next person to add it will need it.

## Design

**Cloud Hub**, the same design language as `frontend-hub`, `frontend-store-new`
and `frontend-floor`. This app used to carry one of its own — "Planet DS v5",
one ink at fixed alphas over three greys — which was coherent and was a second
system, and a grey chosen by alpha drifts away from a grey chosen by hex the
moment either side is touched.

The palette in `ui/theme/Tokens.kt` is
`frontend-hub/src/styles/index.css`'s, value for value: ink ramp
`#20242c → #394150 → #626b78 → #737c89`, white canvas over `#f8f9fb`, hairline
`#e7eaf0`, one blue `#2563eb` that is both the accent (selected) and the CTA,
radii 16 / 12 / 7. **If this app ever looks a generation behind the console,
diff those two palettes first** — that is almost always the whole of it.

What is NOT taken from the console is density. The type scale and the touch
targets are `frontend-floor`'s, which is this language's phone expression: a
44 dp floor under every target, 56 dp for the one action a screen exists for,
and a scale one step up from the desk's because this is read at arm's length.

The composites are the reference screens': cards are a hairline and a whisper
shadow, never a drop; the status pill is **outlined**, its border 30% of the
label's own colour, because a border as strong as its label turns the tag into a
box; the app bar is borderless with a centred 17/600 title; and the tab bar is
five **floating squircles** with no containing bar and no labels — the bar above
has already said which one you are in. Blue means selected. The level on the
power fader is data, so it is grey.

Motion is the console's two curves and five timing bands (`Motion` in
`Tokens.kt`), so the apps do not drift on timing the way they drifted on colour:
direction-aware page transitions, digits that roll rather than blink, and a
press that is a 120 ms wash and a 0.99 scale rather than a spring — a card that
flinches looks broken on the tenth press of a shift. `LocalMotion` reads the
system animator scale; when someone has turned animation off, everything here
goes still.

## Build

```
ANDROID_HOME=/opt/homebrew/share/android-commandlinetools ./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```
