# RFID label printing demo — the laptop is the DC

Cloud stays on Render. The distribution centre moves onto this laptop. The
printer sits on the same LAN as the laptop, and nothing else changes.

```
  Render                          this laptop                    the bench
  ┌──────────────┐   sync +      ┌──────────────────┐   TCP     ┌─────────┐
  │ cloud        │ ◄─ commands ─►│ dc  :8092        │ ── 9100 ─►│ printer │
  │ Postgres     │               │ SQLite           │           └─────────┘
  │ mints EPCs   │               │ frontend-dc-new  │
  └──────────────┘               │      :5276       │
                                 └──────────────────┘
```

## Why the DC has to be the laptop

Printing never goes cloud-to-printer. The centre decides *what* to print and
sends it down as a tagging job; the DC decides *when*, because the DC is the
only party on the same LAN as the printer (`backend/src/edge/printing.rs:1`).
The `dc` service already deployed on Render cannot open a socket to a printer
in a room in Indonesia, and never could. This is not a workaround for the demo
— it is the shape the system was designed in.

## What the labels are made of

Everything a tag carries — EPC, article name, colour, size, base price — comes
from the tagging job payload the cloud sends down, snapshotted at queue time
(`job_label` in `backend/src/edge/printing.rs`). **A brand-new SQLite is
enough.** No catalogue sync, no price book, no historical data has to reach the
laptop before the first tag can print.

## The one real risk: the printer is a TSC

The renderer emits a strict subset of ZPL II, and it was written against a
**Printronix T6204e running ZGL** (`backend/src/edge/zpl.rs:4`). A TSC printer
speaks TSPL natively. Two things follow:

1. If the TSC is not switched into ZPL/ZGL emulation, nothing prints at all.
   Loud failure, easy to spot.
2. If it *is* in emulation, `^RFW` — the RFID write — is the likeliest command
   for that emulation to accept and quietly drop. **The tag prints perfectly
   and carries no EPC.** Nobody sees it until somebody scans a tag and finds
   it empty.

So the acceptance test for this demo is not "a label came out". It is "a label
came out **and a handheld reads the EPC back off it**".

    python3 scripts/printer-probe.py scan          # find it on the LAN
    python3 scripts/printer-probe.py ask <ip>      # which language does it answer in

`ask` reports TSPL-only, ZPL-capable, or silence, and says what each means.
If it is TSPL-only: switch the command language in TSC Console, or the node
needs a TSPL renderer written against that model's manual — which is a change
to `backend/src/edge/zpl.rs`, not a setting.

## Proving the chain without a printer

`scripts/label-sink.py` listens where a printer listens and reports what it was
handed: how many labels, and the EPC on each one — or `EPC NONE`, which is
exactly what a dropped `^RFW` looks like.

    python3 -u scripts/label-sink.py --save /tmp/jobs

Then point the print bench's **Printer host** at the machine running it. This
is worth doing once before the printer is plugged in, because it separates "the
node did not send" from "the printer did not print".

## Runbook

### 1. Free the origin (Render dashboard, by hand)

Suspend the **`dc`** service. Two nodes claiming origin `dc-01` interleave their
facts into one ledger stream, and neither DC's stock can be recovered from the
result. Note its `SYNC_UPLOAD_KEY` before suspending — the laptop needs it.

### 2. Point the laptop at the cloud

In `demo/dc/.env` (not in the repo — see `deploy/edge/dc-demo.env.example`):

    SYNC_UPLOAD_URL=https://itulah-cloud.onrender.com
    SYNC_UPLOAD_KEY=<the key from step 1>

Leave `INVENTORY_ORIGIN_GENERATION=1` for now.

### 3. Boot once at generation 1, and let the backlog clear

    cd demo/dc && ../../backend/target/debug/dc

A fresh SQLite is born at generation 1 and enqueues one bootstrap fact. The node
**refuses** to advance to generation 2 while that fact is unacknowledged, and
the refusal is correct: a rollover that outruns an ack swallows facts. The cloud
skips this one as a duplicate (`seq <= durable`,
`backend/src/cloud/postgres/sync.rs:389`) and acknowledges it within a cycle.

### 4. Roll to generation 2

Register the new epoch at the cloud first, then restart the node on it. Order
matters: a node uploading at a generation the cloud has not activated simply
queues, forever.

    curl -sS -X POST https://itulah-cloud.onrender.com/api/v1/sync/origins \
      -H "x-sync-key: $MASTER_SYNC_INGEST_KEY" \
      -H 'content-type: application/json' \
      -d '{"origin_id":"dc-01","ingest_key":"<same key as step 1>",
           "site_id":"dc-01","node_role":"DC",
           "active_generation":2,"inventory_enabled":true}'

Then set `INVENTORY_ORIGIN_GENERATION=2` in `demo/dc/.env` and restart.

Passing the *same* ingest key is deliberate: rotating it here would lock out the
Render `dc` service permanently, and step 1 is meant to be reversible.

### 5. Bring up the console

    # .claude/launch.json → "dc-demo"
    cd frontend-dc-new && VITE_API_TARGET=http://127.0.0.1:8092 npm run dev -- --port 5276 --host

Vite proxies `/api` to the node so the browser sees one origin. That is not
tidiness: the session cookie is `SameSite=Strict` and a cross-origin dev setup
drops it, which looks like a login that succeeds and instantly fails.

`--host` matters if the demo is driven from a phone or tablet on the LAN.

### 6. Issue a tagging job from the cloud

Head office accepts a delivery whose destination site is `dc-01`, names the
article, and issues. The job routes to whichever origin is registered as the DC
owning that site (`backend/src/cloud/postgres/tagging.rs:621`) — after step 4,
that is this laptop. It appears under **Tagging → Jobs** within a sync cycle
(5s).

### 7. Print

**Tagging → Print bench** → pick the job → set **Printer host** to the printer
(or to the sink) → queue the run. Then read a printed tag back with a handheld.
That read is the demo.

## Rollback

Set `INVENTORY_ORIGIN_GENERATION` back on nothing — generations do not regress,
and the node refuses to. To hand the site back to Render: resume the `dc`
service and register `dc-01` again at the generation that service is running,
or leave the laptop as the DC. Nothing else in the fleet is touched: the cloud,
both stores and every browser surface are untouched by all of the above.

## Verified on 2026-09-02

* Render cloud answers `/api/v1/health` → 200.
* The `dc` binary boots from `demo/dc/`, creates its SQLite and its bootstrap
  admin, and serves `dc-01` on `127.0.0.1:8092`.
* `frontend-dc-new` signs into that node through the Vite proxy and reaches
  **Tagging → Print bench**, which reports "Nothing to print. The centre issues
  tagging jobs when goods are accepted" — the correct state for a node whose
  sender is still off.
* `scripts/label-sink.py` parses a real rendered job: EPC, bit length, bank,
  byte count, ink fields, and flags a label with no `^RFW`.

Not yet verified, because each needs something this machine does not have:
the sync link to Render (needs the keys), a tagging job arriving (needs the
link), and anything at all about the printer (needs the printer).
