# frontend-floor — RETIRED (2026-09-26)

**Lantai**, the DC floor app for phones, is retired as of **2026-09-26**. Do not
build on it, run it for demos, or point a DC edge node's `FRONTEND_DIR` at its
`dist/`.

## Why

Its stations — receiving (terima-periksa, the two-person count and verify),
tagging, picking, packing and despatch — were folded into **frontend-hub** as
the **Operations** module. Keeping a second app for the same DC edge endpoints
meant two copies of every station drifting apart, and the hub is where the
work is now done and checked. The app was never deployed: it is not in
`render.yaml`, the Makefile's `FRONTENDS`, CI or the Dockerfile.

## What replaces it

| Floor app station | Hub screen (login to the DC node inside the hub) |
|---|---|
| Terima (receiving, count, verify) | Operations → Receiving — `/operations/intake` |
| Tag | Operations → Tagging — `/operations/tagging` |
| Ambil (picking) | Operations → Outbound → Picking — `/operations/picking` |
| Kemas (packing) | Operations → Outbound → Packing — `/operations/packing` |
| Kirim (despatch) | Operations → Outbound → Shipments — `/operations/despatch` |
| Opname (stock take) | Inventory → Counts — `/inventory/counts` |
| Node (Sinkron, Belum terkirim, Ganti sandi) | Operations → Sync / Account — `/operations/node`, `/operations/node/account` |

Handheld scanning at the DC stays with the `handheld/` Android app.

## What was done on retirement

Nothing here was deleted — the source stays for reference (the handheld app's
design tokens cite this app's kit). The following were removed so nothing
starts it any more:

- its dev-server and DC-served entries in `.claude/launch.json`;
- the `floor` service (:5351) in `scripts/demo-services.sh` (install/uninstall
  now unload a leftover `id.itulah.demo.floor` agent);
- the references in `docs/DEMO.md`, `docs/finance-menu.md` and
  `FINANCE-CONNECT-BRIEF.md`, which now point at the hub's Operations screens.
