> **Superseded, 2026-10-05 (later the same day).** The owner rejected the
> separate "Keranjang Offline" screen, its menu entry and the word *draft*:
> an order made without a connection is made on the **New PO form itself**.
> Offline, Submit keeps the finished order on the device (IndexedDB,
> `lib/offline/po-outbox.ts`), the order stands in the Purchase Orders list
> with the status *Offline*, and it is sent by itself when the line is back.
> New items are typed on the form ("New item") and created with the order; the
> catalogue browser is gone from the PO form, so nothing here matches codes
> any more. What survives from this plan: the reference cache
> (`lib/offline/reference.ts`: suppliers, divisions, tags, units, destinations,
> terms, colours) and the offline Suppliers menu. Read the rest as history.

# The offline basket — drafting purchase orders where the internet is not

Written 2026-10-05. A buyer standing in a supplier's showroom or a pasar
stalls lane has no line to head office, and that is exactly where purchasing
decisions are made. This plan gives that buyer a place to capture an order —
supplier, items, quantities, prices, division, tags — with the cloud
unreachable, and one press that turns the capture into a real purchase order
when the line returns.

Scope, fixed by the owner the same day: **purchase orders only**, and the
offline reference data is **suppliers, divisions and supplier tags** — no
article/SKU catalogue, no supplier-item catalogue. The buyer types the
supplier's own codes; the centre matches them later.

Everything below was read before it was written: `docs/purchase-order.md`,
`docs/sourcing-basket.md`, `CONTEXT.md` (vocabulary), `PO-IMPORT-DOCJEV-PLAN.md`;
`frontend-hub/src/screens/procurement/{sourcing,basket,composer,shared,import}.tsx`,
`frontend-hub/src/lib/queries/{procurement,po-import}.ts`, `frontend-hub/src/{main,sw}.tsx`,
`frontend-hub/vite.config.ts`; `backend/src/cloud/http/{mod,basket,suppliers}.rs`,
`backend/src/cloud/postgres/{basket,suppliers,sync,units}.rs`,
`backend/src/cloud/domain/supplier.rs`; migrations `0022`, `0027`, `0032`,
`0038`, `0039`, `0382` (one read-only scout covered the surfaces; anchors are
theirs or mine, none invented).

---

## 0. Rulings

| Question | Ruling |
|---|---|
| Is this a "draft PO"? | **No such thing, and the word stays banned** (`CONTEXT.md` Basket avoid-list; `docs/purchase-order.md` §1: *there is no draft*). The offline artifact is **a basket the centre has not seen** — the buyer's picks, held on the buyer's machine because the centre is unreachable. A purchase order exists only when `POST /purchase-orders/catalog` answers 201. UI may say *Draft* colloquially; the data model never does. |
| What is cached offline? | **Suppliers as full entities, capped at the first 1 000 rows sorted by name** (~1 KB each ≈ 1 MB — fits the localStorage quota; the owner asked for exactly this: menu Suppliers offline, and 1 000 full rows is affordable). Beyond the cap nothing more is cached — the menu says how many it is not showing and search stays online; the basket's picker falls back to typing a code. Beside it: **tags and divisions vocabulary** and the three tiny masters the submit needs (delivery destinations, payment methods, units). **No supplier-item catalogue, no article catalogue, and nothing image-shaped, ever.** The offline basket is typed text: codes, names, numbers, divisions, tags. |
| Does an offline line carry a `supplier_item_id`? | **No.** Offline a line is typed fact: the supplier's own code, a name, pieces (or a unit like KODI/LUSIN), an agreed price, a division and tags. The id is resolved at match time, online. This is why the cached set can stay this small. |
| Another database on the device? | **No new engine.** The capture lives in **localStorage** — the estate's own pattern for small durable state: `frontend-hub/src/lib/…/allotment/draft.ts` in this very app, `pos.outbox.v1` at the till. Two keys: `po.reference.v1` (the cached masters) and `po.baskets.v1` (the captures). IndexedDB was considered and dropped: its advantages (quota, async, blobs) are bought by exactly the data this plan banned — catalogues and images — so at a few KB of text they cost (a second storage paradigm, a dependency, upgrade lifecycle) buy nothing. **Flip condition, stated so the choice is auditable:** if offline item search or image caching ever un-bans itself, the store moves to IndexedDB behind `lib/offline/`'s own load/save functions — a one-file change no screen sees. A quota failure is loud on screen, never a silent loss. |
| Thousands of suppliers? | **Full entities are capped at 1 000 (~1 MB)**; past that the cache stops, the menu shows the count it is not holding, and a supplier not in the cache is typed by code and resolved online at match, exactly like an item code (`GET /suppliers?q=` matches code, name or contact — `http/suppliers.rs:270-273`). Escalation stays: a compact directory endpoint when the wire cost of refreshing full rows hurts, then IndexedDB when even the capped set is too big — in that order, endpoint first because it fixes the data cost, IndexedDB second because it fixes only the storage. |
| How does a typed line become an order line? | **Match-then-raise.** On reconnect, each typed code is matched with one small query — `GET /api/v1/supplier-items?q={code}&supplier_id={id}` (`SourcingQuery.q` matches an item's name or code, `http/suppliers.rs:38-51`) — a text payload a few hundred bytes; no item pages are pulled and no image is fetched by this lane at all (`image_url` rides as a URL string in the answer, and rendering it is the online composer's business). An exact match becomes a catalogue-path line carrying the typed price/name/division/tags as the existing per-line overrides; no match is **not submittable** — it becomes "supplier item belum terdaftar", a sourcing task, never a silent free-hand line. |
| Which raise path? | **Only `POST /api/v1/purchase-orders/catalog`** — the idempotent, snapshotting path. The legacy direct route (`POST /purchase-orders`, no idempotency, client-minted number) is gap G2 and stays the import lane's business; offline drafting does not grow it. |
| One idempotency key per…? | **Draft, minted when the capture is created and stored with it** — the till's outbox lesson (`pos-desktop/ui/src/outbox.ts`) applied here: every attempt, today's and the one after a laptop sleep, carries the same key, and the server's `replay_or_begin` (`postgres/suppliers.rs`) answers a redelivery with the first receipt. |
| One basket, one supplier? | Kept: **one offline capture = one supplier** (a PO names one supplier — `purchase-order.md` B1). A day at the pasar yields several captures, each raised separately, in capture order. |
| Who owns an offline basket? | **The machine, not the buyer** — the honest tradeoff. The server basket follows a username across desks (`0039`); an offline basket lives in the buyer's browser until it is raised, and raising is the only sync. Nobody else can see it, lose it, or approve it. |
| A PO number offline? | **None.** The catalogue route mints `PO-DDMMYY-NNN` when `po_number` is absent (`CatalogPurchaseOrderRequest`), which is the target model's answer to G4. Offline capture never suggests a number; the browser-suggested `nextPoNumber` stays an online-composer behaviour. |
| What if the world moved while offline? | The existing raise-time refusals are the reconciliation and are kept, surfaced per line: supplier deactivated (409), item inactive, item not the supplier's, non-IDR. A typed `unit_price_minor` is the agreed price — the feature, not an error (`sourcing-basket.md` §3). |
| Revise, cancel, close-short offline? | **No.** Offline is capture only. Everything that mutates an existing order stays online, exactly as today. |

---

## 1. What exists — and this plan mostly assembles it

**The order path is already offline-shaped at the wire.** The catalogue raise
is one idempotent POST whose line payload is *ids plus deliberate overrides*:
`supplier_item_id`, `quantity`, `promised_date`, and — optionally —
`unit_price_minor`, `article_name`, `image_url`, `division_code`, `tags`,
`base_price_minor`/`markup_bps`, colour×size `variants`,
`unit_code`/`unit_quantity`/`order_unit_price_minor`
(`CatalogPurchaseLineRequest`, `postgres/suppliers.rs:2246-2284`). The server
snapshots everything else from `supplier_item` and never trusts a browser
price it was not given. The header carries supplier, destination (optional —
defaulted), discount, payment terms/method, notes
(`suppliers.rs:2326-2375`). **An offline capture is precisely this payload
minus the ids**, which is why it can be typed anywhere.

**The reference reads are small, bounded and already there**: suppliers
(`GET /suppliers`, paged ≤1000), vocabulary — divisions and tags together
(`GET /catalogue/vocabulary`), units with conversions (`GET /units`),
destinations (`GET /purchase-destinations`, DC sites, deliberately unpaginated),
payment methods (`GET /payment-terms` book). Nine active divisions
(`0382_divisions_are_the_clients_nine.sql`), twenty-one tags (`0027` + `0041`).
The one dataset this plan does **not** cache — supplier items — is the one
that is big (seed: 2 806 items) and the reason the owner's "no catalog" ruling
makes the whole thing cheap.

**The hub is already a PWA that opens offline**: `vite-plugin-pwa` +
`injectManifest`, workbox precache of the shell, navigation fallback that
serves the app for any route (`frontend-hub/src/sw.ts:69-80`), push beside
it. What the worker does not do is touch `/api` — every screen today is
network-bound, TanStack Query is in-memory only, and the app persists no
domain state anywhere (`main.tsx:63-73`; the only local stores are UI
preferences and `allotment/draft.ts`, both localStorage). So the shell loads
in the showroom; the screens cannot. **That is the whole gap — and the
answer is the app's own existing pattern, not a new engine.**

**The import lane is a neighbour, not a rival.** `PO-IMPORT-DOCJEV-PLAN.md`
extracts orders from Excel/PDF/photos server-side and raises through the
legacy direct route. It captures paper that already exists; the offline
basket captures a decision being made. No overlap, no shared wire.

---

## 2. The gap, precisely

| # | Gap | Anchor |
|---|---|---|
| 1 | No persisted data layer in the hub: query cache is memory, SW caches no API, and no domain state is written to disk — an offline screen has nowhere to read or write. The estate's own answer for small durable state (localStorage, as `allotment/draft.ts` and the till's outbox already do) simply has no procurement member yet. | `main.tsx:63-73`, `sw.ts:69-100` |
| 2 | No reference snapshot: the three cached sets have no offline home, no fetched-at stamp, no refresh trigger. | — |
| 3 | No capture surface: the composer seeds from the server basket (`composer.tsx:340`) and the basket is server state (`0039`); neither exists without the cloud. | `composer.tsx`, `basket.rs` |
| 4 | No submit queue: the raise is a live mutation with a per-attempt key (`useIdempotencyKey`); a flaky reconnect must not become two orders. | `shared.ts`, `suppliers.rs` `replay_or_begin` |
| 5 | No match flow: typed supplier codes have no reconciliation screen against the item search (`GET /api/v1/supplier-items?q=&supplier_id=`). | `http/suppliers.rs:38-51,150-165` |
| 6 | Session-shaped thinking: nothing says "you are offline, this is local, it raises when you are back" — the honest sentence the estate demands of every degraded state. | — |

---

## 3. Phases

### Phase 1 — The offline basket (capture, with the line dead)

- **`lib/offline/`** in `frontend-hub`: two localStorage keys, the same
  pattern `allotment/draft.ts` already uses in this app — no new storage
  engine, no dependency:
  - `po.reference.v1` — the cached masters with a `fetched_at` stamp per
    set. **Suppliers are `supplier_id` + name only** (ACTIVE rows at fetch
    time), ~60 bytes a row; the full entity is never cached — it is fetched
    **per supplier, online, on demand** (`GET /suppliers/{id}`, ETag)
    a handful of times for the one supplier a capture is about, never in
    bulk. Beside it: vocabulary (divisions + tags), units, destinations,
    payment methods. Refresh is **pull-based, lazy and online-only** — no
    polling, no push: masters on app start, suppliers when stale past 24 h,
    and a manual *Perbarui data* on the capture screen (the buyer on office
    wifi before a trip wants this morning's new supplier). Because the
    supplier refresh pulls paged full entities over the wire even though
    only id and name are kept, it is deferred while the connection reports
    itself metered or data-saver (`navigator.connection` — a courtesy, not a
    promise; the manual button ignores it). A stale set is *usable and
    stamped*, never hidden — staleness is guarded by the raise's own
    re-validation (409), so the cache is a picker convenience, never
    authority.
  - `po.baskets.v1` — the captures, one array under one key (the till
    outbox's shape; additive writes, `storage`-event merge for a second
    tab). One record per offline basket: `id` (uuid, minted at creation),
    `idempotency_key` (minted at creation, never regenerated),
    `supplier_id` (**nullable until match** — a supplier picked from the
    cache carries it immediately; one typed by code offline does not) +
    the supplier snapshot (code as typed, name as cached if it was), order
    fields
    (`destination_site_id`, `payment_method`, `payment_terms_code`,
    `promised_date`, `discount_minor`, `notes`), and lines — each:
    `supplier_item_code` (typed), `article_name` (typed), `quantity`,
    `unit_code`/`unit_quantity` (optional), `unit_price_minor` (optional —
    absent = catalogue's at match), `division_code`, `tags[]`, `note`. Plus
    `created_at`, `captured_offline: true`, `state: capturing | matching |
    raised | refused`. A text capture is a few KB; dozens of trips fit in a
    rounding error of the quota — and a quota or disabled-storage failure is
    a red banner, never a silent session-only fallback (the mistake the
    till's outbox comment already warns about).
- **The capture screen**, reachable from Sourcing and from the rail: works
  with `/api` dead — supplier picker from the cached set, or a code typed
  by hand when the supplier is not in the cache (marked *belum
  terdaftar — cocokkan nanti*, resolved at match), lines typed against
  cached divisions/tags, totals at typed prices labelled *harga diketik —
  belum ada harga katalog*, and the honest banner: *Offline — tersimpan di
  perangkat ini; menjadi PO saat dikirim*. Adding a second supplier starts a
  second basket (the one-supplier rule, visible as two captures, not a
  warning).
- **Basket discipline travels**: quantity ≥ 1, one line per typed code
  (re-typing a code raises its quantity — the `0039` primary-key behaviour,
  reproduced locally), the 200-line guard rail carried over as the same
  read-then-write cap it is online (`basket.rs:63`).
- **Nothing is deleted after raise** until the server's receipt is stored
  with the record; a refused basket stays for a person, exactly like the
  till's outbox refusal rule.

### Phase 2 — Match-then-raise (the line is back)

- **The supplier resolves first, the same way a code does**: a capture whose
  supplier came from the cache already carries its `supplier_id`; one whose
  supplier was typed by code offline (not in the cache — new at head office
  since the last refresh) resolves at match with `GET /suppliers?q={code}`
  — one match takes it, none is *supplier belum terdaftar* (creating one is
  online admin), ambiguous is a picker. Item matching below needs that id,
  so nothing item-shaped is fetched until the supplier is settled.

- **Match**: for one basket, each typed code becomes one small query —
  `GET /api/v1/supplier-items?q={code}&supplier_id={id}` — a text answer of
  a few hundred bytes; no item pages are pulled wholesale and no image bytes
  are ever fetched by this lane. Exact normalized match
  (`supplier_item_code_normalized`) decides. Outcomes per line, shown as a
  review list before anything is sent:
  - **one match** → line ready; the typed price/name/division/tags ride as
    the catalogue path's overrides (send only what was typed — the composer's
    diff discipline, `composer.tsx:1590-1670`, kept);
  - **no match** → *item belum terdaftar* — fix the code, or park the line as
    a supplier-item-to-create task (the existing supplier item admin, online);
  - **ambiguous** → a picker of the candidates.
  A supplier deactivated while away fails the whole raise with the server's
  own sentence (409) — shown on the basket, per `sourcing-basket.md` §5.
- **Raise**: one `POST /purchase-orders/catalog` per basket, in capture
  order, each with the key minted at creation. Success stores the receipt
  (`po_number`, `purchase_order_id`, totals) on the record; the screen shows
  the typed-vs-catalogue price diff for the record. Failure keeps the basket
  in `refused` with the server's sentence — a person decides, the queue never
  retries a reasoned refusal (the till outbox's `shouldRetry` rule, applied).
- **No server change in this phase.** Every endpoint, the idempotency replay
  and the override payload already exist; this phase is hub-only.

### Phase 3 — The edges, only if the field asks

- Background submit attempt on `online`/`visibilitychange` for baskets whose
  match is fully resolved (the pump pattern from the till), still one key per
  basket.
- Optional merge-to-server-basket instead of direct raise **only after
  sourcing-basket B1 lands** (the basket line today holds one number —
  `0039` — and would silently drop the typed overrides; until B1's columns
  exist, direct raise is the only path that keeps them).
- Offline capture of colour×size `variants` and images — deliberately not in
  v1; variants are catalogue knowledge, which is exactly what this lane chose
  not to cache.

---

## 4. Verification

Per the repo's order — targeted E2E through the real surfaces first; there is
no backend change to integration-test.

- **E2E, agent-browser against the hub (Portless)**: with the cloud stopped —
  install/open the PWA, open the offline basket, pick a cached supplier, type
  three lines (one priced, one KODI, one tagless), kill the tab, reopen:
  everything still there, stamps honest. Restart the cloud — match screen:
  two codes resolve, one does not (*belum terdaftar*), fix it, raise → one PO
  with the typed price as override and the catalogue's for the rest; press
  send twice → one order, same receipt (idempotency replay).
- **Refusal leg**: deactivate the supplier server-side between capture and
  raise → the basket shows the 409 sentence and stays; nothing is lost.
- **Unit, only where they explain the above**: the normalized-code matcher;
  the one-key-per-basket mint; quantity merge on re-typed code.

## 5. Risks

| Risk | Mitigation |
|---|---|
| Typed code matches the wrong item (supplier reuses codes) | Exact normalized match only, review list before send, typed name shown beside the catalogue name — the buyer confirms, the record keeps both. |
| Reference set stale in a long trip | `fetched_at` stamped on screen; a supplier deactivated since is caught by the raise's 409 — the same staleness rule the online basket already lives by (`sourcing-basket.md` §5). |
| Local-only loss (laptop dies before raise) | Accepted and stated: the capture lives on the machine until it is raised. The counter's outbox answer (shell-owned file) is a desktop-shell concern, not v1. |
| Two raises of one basket | Key minted at creation + server `replay_or_begin` — the double-press and the retry-after-sleep are the same case. |
| Vocabulary drift ("draft PO") | The artifact is an offline basket in code and docs; screens may say *Draft* as a label only. |

## 6. Non-goals

No server-side draft PO (contradicts the target model; B1's basket columns are
that lane's decision, made there); no offline supplier-item or article
catalogue; no offline revise/cancel/close-short; no offline basket sharing or
hand-over (§9.1 of the basket doc stays open on its own terms); no overlap
with the DocJev import lane; no new sync protocol — this is hub-local capture
plus the existing idempotent raise.
