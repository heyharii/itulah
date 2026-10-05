# POS integration, headless

A till sale followed from the counter to the books: the store node, the store
app, the cloud and the hub, every screen driven by
[`agent-browser`](https://github.com/vercel-labs/agent-browser) in headless
Chromium.

```bash
e2e/pos-flow/provision.sh     # rig `pos-e2e`: cloud :8480, DC :8481, store :8482, seeded day
python3 e2e/pos-flow/run.py   # the test; starts the three dev servers if they are not up
```

Re-run `run.py` as often as the floor has stock (two units a run); run
`provision.sh` again to start over. The report, with a screenshot per step,
lands in `runs/pos-e2e/report/<stamp>/report.md`.

| app | port | talks to |
|---|---|---|
| till (`pos-desktop/ui` via `pos-shim.vite.mjs`) | 5419 | store node 8482 |
| store app (`frontend-store-new`) | 5482 | store node 8482 |
| hub (`frontend-hub`) | 5480 | cloud 8480 |

`.claude/launch.json` has them as `pos-e2e-till`, `pos-e2e-store` and
`pos-e2e-hub`.

## The till in a browser

`pos-desktop/ui` never calls `fetch`: every node call goes through the Tauri
shell's `edge_call`, and outside the shell it refuses on purpose.
`pos-shim.vite.mjs` serves the same UI with a stand-in for that bridge — the
base URL, the bearer token and `X-Terminal-Id`, as `session_attempt` in
`src-tauri/src/edge.rs` sends them — through a same-origin proxy to the node.
Devices report "not attached" and receipts go nowhere; the screens and every
call they make are the real app's.

## What it covers

- **till** — dian signs in on POS-01, rings a shoe on the 15% promotion for
  member Sari (cash, change) and a second article on BCA debit; the totals on
  screen equal the node's quote.
- **store** — both sales on the node, both units off the floor, the store
  app's Money › Sales, Stock and Promotions.
- **cloud** — both sales synced as `EDGE`, the member's points, visits and
  spend.
- **hub** — Selling › Sales, Members, Inventory › Stock and Commercial ›
  Promotions agree with the nodes.
- **finance** — the day generated and posted from Finance › Sales Postings;
  the SALE_DAY journal balances and carries the whole day, the COGS entries
  are live for one attempt only, Journal Entries lists it.

The seeded day is already posted when the till rings, and the hub has no
Reverse action on Sales Postings, so the test reverses it through the API and
says so in the report's findings.
