# frontend-dc and frontend-store — rebuild plan

Both are rebuilt in the Cloud Hub ("ollama") language, the same way
`frontend-hub` was. Neither is a copy of it: they talk to the **edge** node
(`backend/src/edge/http.rs`, 60 endpoints) and they are used standing up, not
sitting down.

The design system is deliberately WET — `frontend-contract` stays framework-free,
so each app keeps its own copy of `styles/index.css`, `components/ui/**` and the
shell. The tokens are identical; the shells are not, and that is the point.

## What the endpoints say about the shape

**DC (45 endpoints) is a flow, not a set of lists.** intake → tagging → counting
→ picking → packing → koli → shipment → dispatch → depart. Every endpoint is a
step in one journey a carton makes. A rail of nine independent modules would be
lying about the work.

**Store (7 endpoints, plus shared auth/sync) is a till.** catalog, sales,
receive, movements, two sales reports, sync. Someone standing at a counter with
a customer waiting.

## frontend-dc

Shell: keep the 58px icon rail — but the tiles are **stations**, not modules, and
they run in the order the goods move. Sidebar as in the hub. Design reference is
`ollama/fulfillment-prototype.html` (its Distribution nav is this flow).

| Station | Endpoints |
|---|---|
| Intake | `POST intake`, `goods-receipts`, `.../invoice`, `purchase-orders`, `purchase-verifications`, `purchase-counts` |
| Tagging | `tagging-jobs`, `tagging-confirmations`, `print-sessions` (+ printer / run / reprint) |
| Counting | `official-counts` (+ entries / submit), `movements` |
| Picking | `picklist`, `pick-sessions` (+ close), `picks`, `allotment-lines/{id}/position` |
| Packing | `packing-sessions` (+ close), `packing-boxes` (+ capture), `koli` (+ label / seal / session / shipment / in-transit / dispatch) |
| Despatch | `shipments`, `dispatches` (+ depart), `destinations/{store}/outstanding` |
| Node | `sync/status`, `sync/trigger`, `auth/*`, `health` |

Two things the hub does not need:

- **A station is a session.** Pick, pack and print all open a session, do work
  against it, and close it. That session id belongs in the URL like a sheet key
  does — a handheld that sleeps mid-pick must come back to the same session.
- **Touch targets.** Warehouse staff use handhelds and gloves. Rows go to the
  44px floor from DESIGN.md's mobile rules even on the desktop layout; the
  32px pill button is for the office, not the floor.

## frontend-store

**No rail and no sidebar.** DESIGN.md's phone expression: full-bleed, and a
floating squircle tab bar of 3–5 destinations, ~52–56px each, active tile solid
indigo. Everything else behind the drawer.

| Tab | Endpoints |
|---|---|
| Sell | `store/catalog`, `POST store/sales` |
| Receive | `POST store/receive` |
| Stock | `inventory/pools`, `inventory/movements`, `POST store/movements` |
| Reports | `store/reports/sales/window`, `store/reports/sales/series` |
| (drawer) | `sync/status`, `sync/trigger`, `auth/change-password`, sign out |

Constraints that change the code, not just the layout:

- **Offline is mandatory, not a degraded mode.** A till that stops selling when
  the network drops is broken. Reads are Query with a long `staleTime`; a sale
  is a mutation that must survive a reload, so it is queued and retried rather
  than lost with the tab. This is the one place `retry: false` is wrong.
- **A sale is money.** Every `POST store/sales` carries an `Idempotency-Key`
  held across retries — a double tap must not ring twice.
- **Never a table.** A till is thumbs and glances. Record cards, big numerals,
  tabular-nums totals.

## Order of work

1. Finish `frontend-hub` (it is the design system's proving ground).
2. `frontend-dc` — closer to the hub, so it validates how much of the kit
   travels.
3. `frontend-store` — the shell diverges most, and it should be built knowing
   what the kit could not carry.
