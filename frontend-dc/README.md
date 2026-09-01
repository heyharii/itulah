# frontend-dc — the warehouse console

One surface for the operations a DC Edge node actually performs. Nothing here
calls an endpoint the node does not serve, and nothing here is a screen for a
decision taken somewhere else: allotments and purchase orders are authored at
the centre, and this app works the queues they produce.

| Screen | What it drives |
| --- | --- |
| Work | The queue home. Every operation with what is waiting in it. |
| Receiving | Open a delivery, count it blind, verify it as a second person, record the invoice. |
| Tagging | Print the EPCs head office minted, then confirm the tags are on the goods. |
| Picking | The recomputed picklist, optional pick rounds, quantity off a rack. |
| Packing | Destination, box, EPCs or an RFID sweep, seal, manifest. |
| Shipping | Sealed boxes → consignment → truck → departure. |
| Counts | Official counts activated at the centre, executed and submitted here. |
| Outbox | What this node has written and not yet sent. |

## Two shells, one taxonomy

The same destinations in the same order appear as a rail from `md` up and as a
bottom bar below it — see `src/lib/destinations.ts`. Touch targets come from a
single `--tap` token in `src/index.css`: 44px anywhere, 56px under 768px,
because this is used while holding goods rather than while sitting down.

## Running it against a node

The dev server proxies `/api/*` so the browser sees one origin — the session
cookie is `SameSite=Strict` and would not survive two.

```bash
VITE_API_TARGET=http://127.0.0.1:8377 npm run dev
```

A local DC node to point it at, with authentication off so no account has to
exist:

```bash
cd ../backend && BIND_ADDR=127.0.0.1:8377 INVENTORY_AUTH_MODE=disabled INVENTORY_DATABASE_PATH=/tmp/dc.sqlite3 FRONTEND_DIR=/tmp cargo run --bin dc
```

With auth off the node answers `/auth/me` as a development identity and skips
every permission check; with it on, the same screens work and the node fills in
`actor_id` from the session rather than trusting the browser.

## Where the types come from

Every request and response shape is generated from the Rust struct the server
serialises (`make contract`), and every call goes through the shared `Dc`
client in `frontend-contract/src/client/dc.ts`. Nothing in `src/` hand-writes a
path or a wire shape — the one exception is the narrow pool row in
`src/lib/api.ts`, whose handler composes its JSON inline and so has no struct
to generate from.
