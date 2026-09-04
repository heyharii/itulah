# itulah · kasir

The till, as a native Android app for a counter tablet with a Chainway **R3**
UHF reader on its USB port. It talks to a store-edge node over
`/api/v1/store/…` and holds no pricing, tax or return rules of its own.

Why native rather than a WebView over `frontend-store-new`, and what it takes
from `~/Documents/retail/pos-android` without taking its API: `POS-TABLET-PLAN.md`
at the repo root.

## What it does

Scan → basket → tender → sale → receipt, plus the drawer: open a shift, cash in
and out, and a blind close. Returns and voids are **not built here yet** — the
button says so rather than failing in front of a customer.

## The two things that make it fast

**The basket is local.** A tag scanned is drawn immediately; nothing on that
path touches the network. `pos-android` posts `pos/txn/{id}/item` per garment,
so a ten-item basket is ten round trips on shop wifi and ten chances to leave a
half-open transaction on a server.

**The price is asked for once, debounced.** 250 ms after the scanning stops, one
`POST /store/quote` prices the whole basket and one `GET /catalog/identities`
learns any names it has not met; a new tag cancels the previous ask outright.
Until the engine answers, a line shows a dash rather than a number the till
worked out itself.

**It does not hold the shop.** Measured on a node seeded to 100,000 SKUs:

| | Whole resident book | What this does |
|---|---|---|
| Startup | 32 MB · 200 requests · 14 s | nothing |
| A ten-item basket | — | names 84 ms + price 76 ms, in parallel, 4 KB |
| Name search | — | 9.5 ms |

The old design loaded the entire catalogue at sign-in. That is fine at 500 SKUs
and unusable at 100,000, and the range only grows. What it bought — an offline
price preview — was worth less than it looked: the sale needs the node anyway,
so a till with no node cannot finish a transaction. Names are cached per SKU for
the life of the process, so the second customer holding the same shirt costs
nothing.

## Build

```
ANDROID_HOME=/opt/homebrew/share/android-commandlinetools ./gradlew assembleDebug
```

## Install over Tailscale, with no ADB

The counter tablet (`txz-w09`) has no wireless debugging, and it does not need
any: the tailnet already reaches it.

```
tailscale serve --bg --https 8443 /path/to/app-debug.apk
```

Then open `https://haris-macbook-air-1.boga-mercat.ts.net:8443/` on the tablet
and tap the download. It is a real certificate, so there is no warning to teach
somebody to click through. Android will ask once for permission to install from
the browser.

Taildrop (`tailscale file cp app-debug.apk txz-w09:`) is the other route and is
one command shorter, but it hangs when the Android app is not accepting files —
so it is the fallback here, not the default.

`adb` remains the way in for logs and frame timings, over USB or over the
tailnet once `adb tcpip 5555` has been run from a cable one time.

## Commissioning

First run opens Setelan. Three facts and one setting:

| Field | Example | Why |
|---|---|---|
| URL node | `http://100.x.y.z:8081` | Which shop this tablet stands in. A deployment fact, so one APK serves the estate. |
| ID terminal | `till-01` | One terminal, one drawer. The database enforces one open shift per terminal, so two tablets sharing an id means the second cashier is refused. |
| Printer | host `:9100`, 58/80mm | The **node** prints, not the tablet — it is the party on the printer's LAN. |
| Daya antena | 12 dBm | A counter is short range. At 30 dBm the rail behind the till reads into the basket, and a basket with too much in it still looks like a basket. |

Then sign in. The cashier is stamped onto every sale from the bearer token.

## Design

Cloud Hub, the same language as `frontend-hub` — tokens copied from
`frontend-hub/src/styles/index.css`, which is itself authored from
`~/Documents/retail/cloud-app/ollama/DESIGN.md` v0.5. Inter and JetBrains Mono
are bundled as TTF (220 KB) rather than fetched: this tablet is a Huawei with no
Play Services, so a downloadable font is a font that never arrives.

Two deliberate departures, and only two. Targets obey the system's own
`--spacing-tap: 44px`, because this is worked standing up. And money is set
larger than `--text-kpi`, because the figure read back across a counter is not a
number on a dashboard.

## The reader

`RFIDWithUHFUSB` out of `DeviceAPI_ver20251103_release.aar` — the same vendor
library `handheld/` already ships, so no second jar. USB permission is requested
on first attach; the band is set to CN920 (920–925 MHz, Indonesia) because the
module keeps the last band across power cycles and a unit bench-tested elsewhere
inits happily and then reads nothing.

Beep and tag-focus are both off. Tag focus would silence each tag after its
first read, and the field-clear boundary depends on tags repeating while they
sit on the pad: after three seconds of an empty field the batch resets, so the
next customer's identical shirt is not swallowed as a duplicate of the last
one's.

**A tablet with no sled still sells.** Everything degrades to the wedge scanner
and the keyboard, and the reader indicator says which one is running.
