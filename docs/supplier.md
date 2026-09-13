# Supplier — who we buy from, and the catalogue they offer

**Status:** the as-is is recorded in full and is true of the code. The rules
marked **Target** are what the rest of the chain already assumes; they are
**proposed, not decided** — the owner has taken no supplier decisions yet, and
§10 is the list waiting for them. Code references are read off
`feat/handheld-rfid` at `15cd477`. Row counts are from the development database
`inventory_tanstack` on 2026-09-12 and are seeded data, not the client's.

Vocabulary: [`../CONTEXT.md`](../CONTEXT.md). This is the front of the chain —
nothing in purchasing exists before a supplier does:

| Stage | Document |
|---|---|
| **A party we may buy from, and what they sell** | this document |
| What a buyer has picked out of the catalogue | [the buyer's basket](./sourcing-basket.md) |
| The commitment to buy | [purchase order](./purchase-order.md) |
| A lorry arrives, one person counts | [receiving — count](./receiving-count.md) |
| A second person accepts, stock exists | [receiving — verification](./receiving-verification.md) |
| Finance matches the bill, books it, pays | [supplier bill](./supplier-bill.md) |
| The goods get our own identity | [product master](./product-master.md) |

This document owns **who a supplier is, how they are identified everywhere they
are named, what they offer, and whether we may buy from them today**. It does
not own the order, the arrival or the money.

---

## 1. What a supplier is

**Target.**

> A **Supplier** is one party the company buys from: one counterparty, one
> record, one identity. A **Supplier Item** is one thing that party sells, in
> their own words and their own code.

The master exists to answer three questions and no others:

1. **Who is this** — enough to put on an order and to recognise on a bill.
2. **May we buy from them today.**
3. **How are they paid** — the terms and the account money goes to.

Question 3 has no answer in the system at all today (§7). Questions 1 and 2 do.

**As-is.** `supplier` since `0032_supplier_catalog.sql`: a uuid primary key, a
`supplier_code` with a normalised (uppercased) twin that carries the only
uniqueness constraint, a name, four optional contact facts (contact name,
phone, email, one free-text address), `status`, a `version`, and
created/updated by-and-at. `created_by` is checked text and deliberately not a
foreign key to `app_user`, because a node running with
`INVENTORY_AUTH_MODE=disabled` writes as the synthetic actor `development`.

Every write is optimistic and replayable: `If-Match: "3"` carries the expected
version and an `Idempotency-Key` is mandatory
(`backend/src/cloud/http/suppliers.rs:189`, `:204`). The whole surface is
`SUPERVISOR`, reads included — a till token may not read what a supplier
charges (`backend/src/cloud/domain/auth.rs:114`).

Dev data: **30 suppliers, all ACTIVE**; 2,814 supplier items.

---

## 2. One supplier, three keys

This is the deepest thing wrong in the area, and it is not visible from any one
screen. The master's identity is a uuid. Nothing downstream carries it.

| Where a supplier is named | Column | What it holds today | Joins to the master |
|---|---|---|---|
| The master | `supplier.supplier_id` (uuid) + `supplier_code` | canonical | — |
| An order raised from the catalogue | `purchase_order.supplier_ref_id` + `supplier_id` | the uuid **and** the code | yes |
| An order raised free-hand | `purchase_order.supplier_id` | any non-empty text the caller sent | no |
| The command sent to the DC, and the DC's copy | payload `supplier_id` | the **code** | no |
| An accepted receipt coming back | `goods_receipt.supplier_id` (text) | the code | no |
| Finance's bill | `supplier_invoice.supplier_id` (text, no FK) | in dev, the **uuid** | no |
| Supplier balance and ageing | `GROUP BY supplier_invoice.supplier_id` | that same text | no |

Counted rather than argued:

- 23 purchase orders. **5** were raised through the catalogue and carry
  `supplier_ref_id`; **18** were raised free-hand and carry none. The free-hand
  path asks only that the string be non-blank
  (`backend/src/cloud/domain/sync.rs:2302`).
- **2 of 2** accepted receipts key the supplier by its code.
- **29 of 29** bills key the supplier by the master's uuid in a text column,
  and **0** of them by a code. A bill and a receipt for the same supplier
  therefore share no key.
- `payables_aging` groups by that text and labels the group with
  `MAX(supplier_name)` (`backend/src/cloud/postgres/payables.rs:1113`), while
  the unbilled-receipt exposure list groups by the receipt's code
  (`:1004`). Two lists about the same supplier, keyed two ways, never added
  together.

Nothing is broken *yet* because the bill reaches its receipts through
`supplier_invoice_receipt` (receipt ids), not through the supplier. What is
already lost is the sentence "here is everything about this supplier": there is
no query that can write it.

**Target.**

> The uuid is the identity. Every document that names a supplier carries it,
> plus a code-and-name snapshot for the paper and the wire. Finance names the
> master; a bill cannot be recorded against a supplier that does not exist.

The snapshots stay. A supplier renamed after a bill is posted must not silently
restate history — that is the same rule the order lines already follow.

---

## 3. May we buy from them

**Target.**

```
        ACTIVE ──retire──▶ RETIRED ──bring back──▶ ACTIVE
```

**Retire** means one thing: nothing **new** may be raised against them. Every
order, receipt, bill and payment that already exists is untouched, and the
supplier stays readable forever. There is no delete, and deliberately so: a
supplier names transactions in last year's ledger, and `ever_used` — the test
the [product master](./product-master.md) applies to a division or a tag — is
true of a supplier the moment anybody buys anything.

**As-is.**

- `ACTIVE` / `INACTIVE`, flipped by
  `POST /api/v1/suppliers/{id}/activate|deactivate` with `If-Match`. There is
  **no DELETE route** for a supplier or for a supplier item; `0032` says so in
  a table comment.
- An inactive supplier, and an inactive item, are refused when an order is
  raised **through the catalogue**
  (`backend/src/cloud/postgres/suppliers.rs:2040`, `:2074`). The free-hand path
  refuses nothing, because it never looks the supplier up.
- **Retiring a supplier does not take their goods out of Sourcing.**
  `search_supplier_items` filters on the item's status and never on the
  supplier's (`postgres/suppliers.rs:1147`). A retired supplier's items stay
  browsable, sortable and addable to a basket; the buyer finds out at the
  moment they press the button that raises the order.
- The screen already says **Retire** and **Bring back**
  (`frontend-hub/src/screens/procurement/suppliers.tsx`), and the wire says
  `INACTIVE`. The screen's word is the right one, and CONTEXT.md should settle
  which the API speaks.

---

## 4. The catalogue

**Target.**

> A supplier quotes **one price per style**. What it comes in — colours and
> sizes — is two lists, not a row per combination. A supplier who really prices
> per variant is two supplier items with two of their own codes, because that is
> how their own price list says it.
>
> A purchase line is a **snapshot, not a pointer**: what the order pays and
> calls the goods is fixed when the order is raised, and a catalogue edit the
> next morning does not reach it.

**As-is.** `supplier_item` since `0032`: the supplier's code (unique per
supplier, uppercased), name, description, image, `unit_price_minor`, currency
(`IDR` only, enforced in the schema and again in the domain), an optional link
to one of our articles (§5), and a status of its own.

- Classification arrived in `0038`: an optional `division_code` and
  `supplier_item_tag`, both borrowing **our** vocabulary rather than a second
  one, so a supplier's shirt and our shirt are the same word.
- Variants arrived in `0092`: `supplier_item_colour` and `supplier_item_size`,
  also from our masters. Colours travel with label and hex so a card can draw a
  swatch without a second request; sizes come back in size order.
- Dev data: 2,814 items, 2,813 active, **6 unclassified**, 2,808 tagged, 2,812
  with colours and 2,812 with sizes — the seed is dense, a scraped feed will
  not be, and "nobody has broken this down" is a real state the filters can ask
  for (`colour_null=true`).
- Facets are counted **per item, not per variant**, so the colour counts sum to
  more than the total. That is correct and matches the tag counts.
- One request answers the whole browse screen: a page of items, each with its
  supplier attached, plus `total`, plus the facets counted over everything the
  text search matches rather than over the current selection. Paging is keyset
  on the sort's own key, so changing the sort starts again.
- **There is no price history.** An edit overwrites `unit_price_minor` and
  bumps `version`. The audit log records it as
  `PATCH /api/v1/supplier-items/{id} → 200` and nothing else: the middleware
  writes an empty payload on purpose, because bodies here carry passwords and
  personal data (`http/audit.rs:112`). So the only surviving record of what a
  supplier used to charge is
  `purchase_order_line.supplier_item_price_snapshot` (`0045`) — the catalogue's
  asking price at the moment an order was raised, kept beside the price the
  buyer actually agreed.

### 4.1 How the catalogue is asked

`GET /api/v1/supplier-items` is the one endpoint Sourcing, Catalogue and a
supplier's own offering are all three drawn from. Free text matches four
things — the item's name, the item's code, the supplier's name, the supplier's
code — which are the four somebody actually holds when they come looking.

Five facets, and **each is asked in three shapes**, ANDed together
(`postgres/suppliers.rs:1147`):

| Shape | Parameter | Means |
|---|---|---|
| is one of | `division=KIDS,MEN` | any of these |
| is none of | `division_not=KIDS` | anything but these |
| is empty | `division_null=true` | the rows nobody has filled in |

Two rules in that table carry weight, and both were bugs before they were
rules:

- **`ANY`, never `ALL`.** A buyer ticking Navy and Black is naming what would
  do, not writing a specification.
- **A negation keeps the unfiled rows.** An item nobody has classified *is*,
  truthfully, not kidswear. SQL's three-valued logic answers otherwise, which
  would hide exactly the unfinished rows somebody asking for
  anything-but-kidswear is hunting (`postgres/suppliers.rs:1236`). The
  is-empty shape exists for the same reason: the facet list has counted
  unclassified items under a synthetic `Unclassified` since `0038`, and until
  `division_null` existed, ticking that count returned an empty page.

`price_min` and `price_max` narrow on the server too — a slider that filtered
only the rows already fetched tells a buyer there is nothing cheaper when there
is.

**A cursor belongs to the order it was issued under.** Presented under a
different sort it is *dropped* rather than honoured, which restarts the list —
continuing it would skip rows and repeat others and nothing downstream could
tell (`postgres/suppliers.rs:960`). Four orders: relevance, newest, price low,
price high. There is deliberately no "popular" and no "best selling"; the
engine says why, and the reason is §5.

Two asymmetries with the supplier book beside it, both small and both live:

- A misspelled filter on the **supplier book** is refused, because
  `SupplierListQuery` is `deny_unknown_fields`. The same mistake on the
  **catalogue** is ignored: `SourcingQuery` is not, so `?divison=KIDS` narrows
  nothing, answers 200, and hands back the whole catalogue to a caller who
  believes they asked for a part of it (`http/suppliers.rs:36` vs `:257`).
  → **P11**
- One idea, three envelopes. The supplier book answers `rows`, the catalogue
  answers `items`, and a supplier's own items answer
  `{items, limit, next_cursor}` with no total and a cursor ordered by uuid
  rather than by the list's own order (`postgres/suppliers.rs:451`, `:933`,
  `:1509`). Every reader reconciles them by hand. → **P12**

### 4.2 The number in the corner

Counting the facets over the search rather than over the selection — the last
bullet above — is what makes the list usable at all: one that counted only the
surviving rows would print a zero beside every option nobody has ticked, and
could not answer "what if I looked at menswear instead".

It also makes `total` a different number from the one most screens assume, and
that is a contract every reader of this endpoint has to keep:

> `total` is the size of the catalogue being browsed, **not** the size of the
> narrowed list. A screen printing "120 of 2,814" with three facets on is
> claiming a number nobody computed.

So the sentence in the corner has to change with whether anything is ticked, and
Sourcing's does: with nothing on it reads "120 **of 2,814** shown"; with a
filter on it drops the total and reads "120 items match", or "120 shown, more to
load" while pages remain (`screens/procurement/sourcing.tsx:437`), and the
reasoning is written beside the line it governs (`:308`).

It is stricter than the contract requires, in a way worth knowing before copying
it: the total is dropped as soon as a **word** is typed as well
(`filtered = needle !== "" || filters.filters.length > 0`, `:393`), although a
typed word is exactly what `total` does count. "120 of 340 matching kaos" is a
sentence this endpoint can support and the screen declines to say.

The count is not free. It is five aggregations over the whole catalogue, and it
is recomputed **for every page of the same scroll**, always with the same
answer, because it is taken at the end of `search_supplier_items` whether or not
a cursor was presented (`postgres/suppliers.rs:1346`).

Measured rather than estimated, and twice: `EXPLAIN (ANALYZE)` against the same
seeded database (2,814 items) reported **19–25 ms warm after a 127 ms first
run** in one session, and **274–372 ms** in another an hour later. The spread is
the laptop — several sessions on it — not the query, so neither number is a
production figure. What survives either is the shape of the waste: the second
page of a scroll pays the whole count again for an answer that cannot have
changed. → **P13**

### 4.3 What a supplier may offer that we cannot record

A supplier item's colour list has no ceiling. **Ours has ten**, and the reason
belongs to [product master §2](./product-master.md) rather than here: the
colour is one digit of the eleven-digit SKU. The consequence is this
document's — a supplier may offer twenty-four colourways of a style, which the
feed these photographs came from routinely does (`cloud/media.rs:40`), and we
can record ten of them. *Today's seed tops out at five colours per item, so
nothing has collided yet.*

Nothing reconciles the two, and nothing has had to, because **the variants
never cross the border**. A purchase line carries the supplier item's division
and tags — `tagging` reads them back off the line when it mints the article
(`postgres/tagging.rs:902`) — and carries nothing about colours or sizes
(`postgres/suppliers.rs:2180`). So a garment the catalogue describes as coming
in five colours, S to XXL, reaches the moment we mint our own identity carrying
its name, its code, its photograph and its filing — and not one word about what
it comes in. Somebody decides the colourways again, from the carton. Whether
that is right is
[the basket's §9.3](./sourcing-basket.md#9-open-decisions), which asks the same
question from the other end.

---

## 5. The link to our own article, and the column nobody writes

`supplier_item.internal_article_code` has existed since `0032` and is written
by **nothing**.

- **0 of 2,814** rows carry one.
- Two queries read it: the article search matches a supplier's item code
  through it (`postgres/articles.rs:240`), and an article's detail lists who
  sells it (`:537`).
- The item form removes the field on purpose, with a comment saying the link is
  "minted at goods receipt" (`item-form.tsx:257`). Goods receipt does not mint
  it: article setup stores the supplier's code as text on
  `article_setup_session.supplier_article_code` (`postgres/tagging.rs:313`) and
  never points back at the catalogue row.

Three consequences, each already visible:

1. The article search's "supplier code" arm — named in
   [product master](./product-master.md) §3 — can never match.
2. An article's "who sells this" panel is always empty.
3. The catalogue can offer no popularity or best-selling order, and the engine
   says so itself: best selling "needs every supplier item to carry our own
   article code. None do yet" (`postgres/suppliers.rs`, `SourcingSort`).

**Target.** Either the setup that mints an article writes the link back — it
holds the purchase line, and the purchase line holds `supplier_item_id` — or
the column goes and the two readers go with it. A column that half the code
believes in is worse than either.

---

## 6. The screens

```
Procurement                      in the sidebar        arrived at from a screen
  Purchase orders     ●  the order book (the module lands here)
  Suppliers           ●  who we buy from  ← this document
  Sourcing               ·                what is on offer, browsed
  Catalogue              ·                the same rows, as master data
  Outstanding            ·                a line that arrived short
  Price amendments       ·                a price change, accepted or refused
  Destinations           ·                where a delivery may land
```

Two rows in the sidebar; the other five are declared, routed and findable in ⌘K
but `hidden`, because each is a place somebody *arrives at* from another screen
rather than one they set out for (`procurement/nav.ts`).

**Suppliers** (`screens/procurement/suppliers.tsx`) carries four columns —
Supplier, Status, **On offer**, Last touched — and no phone number: a buyer
scanning it asks one question, which of these can I raise an order against
today, and the contact facts are one click away in the sheet. It sorts by *On
offer* ascending, so an active supplier with an empty catalogue is the first row
rather than the last. The sheet is Details · Catalogue · Orders, and
`?supplier=new` opens the same sheet on a blank form.

Suppliers **moved back into Procurement on 2026-09-12** from Master data, where
it had been since 2026-09-03; the old path is declared `moved` so every link
anybody has sent still opens the screen (`lib/navigation.ts`, `procurement/nav.ts`).
A supplier is a party the company transacts with, not a word an article is
described with.

Two as-is details worth knowing before trusting the screen:

- It reads `GET /api/v1/suppliers` with **no limit**, so it shows at most the
  server's default of 200 (`SUPPLIER_DEFAULT_LIMIT`, ceiling 1,000), and the
  client helper throws the envelope away — `total`, the cursor and the facet
  counts included (`lib/queries/procurement.ts:700`). At 30 suppliers nothing is
  lost; at 300 the list would stop at 200 with nothing saying so.
- Status is filtered **in the browser** although the server takes `status`, and
  **On offer** comes from a `limit=1` sourcing read taken for its facets alone.
  That count is over the whole catalogue, so it counts a retired item too.

**Catalogue** is the only screen that creates a supplier item; **Sourcing**
browses what it makes. Both read the same endpoint and ask different questions
of it.

---

## 7. What the master does not hold, and who needs it

| Missing | Who needs it | Today |
|---|---|---|
| Bank account | Every payment. Transfer is the normal instrument | `supplier_payment` names **our** account (`account_key`) and never theirs; the number lives in somebody's WhatsApp |
| Tax id (NPWP) | PPh 23 withholding, which the payment table already has columns for (`withholding_minor`, `withholding_key`) | nowhere |
| Payment terms | The due date on every bill | typed by hand per bill; `due_date` is nullable |
| More than one contact | A buyer, an AP clerk and a driver do not phone the same person | one `contact_name`, one `phone` |
| A ship-from address | Nothing yet; it is the DC that receives | one free-text `address` |
| Performance | "Do they deliver on time, and in full" — the question the whole receiving chain generates evidence for | no record, no screen, no endpoint |

None of these is guessed at in this document. Each is a column and a screen,
and each waits on §10.

---

## 8. Invariants

1. A supplier code is unique, case-insensitively, across the estate.
2. A supplier item's code is unique within its supplier, not globally.
3. A supplier item is quoted in `IDR`, and in one price for the style.
4. A supplier, and a supplier item, are never deleted.
5. Retired means: nothing new. Nothing that already names it changes.
6. Every write to either record carries the expected version and an
   idempotency key, and a replay returns the first answer rather than acting
   twice.
7. A purchase line keeps what it was told, never a pointer to what the
   catalogue says now.
8. *(Target, not true today)* Every document naming a supplier carries the
   master's id, and no document may name a supplier that does not exist.
9. *(Target, not true today)* A retired supplier's goods are not on offer.

---

## 9. Gap list

| | Gap | Evidence | Fix |
|---|---|---|---|
| **P1** | Bills and receipts key the same supplier differently, so no supplier statement can be built | 29/29 bills hold the uuid, 2/2 receipts hold the code, 0 rows match | Give `supplier_invoice` a real reference to the master, backfill from the code, keep the snapshot name |
| **P2** | A bill may name a supplier that does not exist | `payables.rs:807` binds trimmed text with no lookup | Resolve against the master on record; a picker on the screen, not a text box |
| **P3** | The free-hand order path bypasses the master entirely | `sync.rs:2302`; 18 of 23 orders have no `supplier_ref_id` | [purchase order](./purchase-order.md) §9.2 already asks whether that path stays; if it does, make it resolve a supplier |
| **P4** | Retiring a supplier leaves their items on offer | `search_supplier_items` filters `i.status` only | Filter on both, or mark the card "supplier retired" and refuse the basket |
| **P5** | `internal_article_code` is read by two queries and written by none | 0 of 2,814 rows | Write it at article setup, or delete the column and both readers |
| **P6** | No price history on the catalogue | overwritten in place; audit stores no body | A dated price row, or accept that the only history is on orders and say so on the screen |
| **P7** | The supplier list silently stops at 200 and throws away `total` | `queries/procurement.ts:700` | Use `supplierPage`, show the count, page or search server-side |
| **P8** | No bank account, tax id or terms on the master | §7 | Three columns and a section on the sheet; needed before any payment run |
| **P9** | No test covers a supplier write | `sourcing_integration.rs` uses `create_supplier` only as a fixture | §11 |
| **P10** | `UpdateSupplierItemRequest` carries the ts-rs derive but is not named in `contract_types.rs`, so the published contract has no such type and the hub hand-writes it | `frontend-contract/src/contract/` lacks it while a stale copy sits in `backend/bindings/contract/` from 2026-09-05; the hand-written one is `queries/procurement.ts:321` | Name it in `contract_types.rs` (`NullablePatch` needs a ts-rs form), or declare the hand-written type the contract and say so where it is written |
| **P11** | A misspelled filter on the catalogue narrows nothing and says nothing; the same mistake on the supplier book is refused | `http/suppliers.rs:36` vs `:257` | `deny_unknown_fields` on `SourcingQuery` too |
| **P12** | Three envelopes for one idea — `rows`, `items`, and `{items, limit, next_cursor}` with no total and a cursor that is not the list's own order | `postgres/suppliers.rs:451`, `:933`, `:1509` | One envelope: `rows`, `next_cursor`, `total`, `facets` |
| **P13** | The facets are recomputed identically for every page of one scroll — 19–372 ms of server execution at 2,814 items, measured in two sessions (§4.2) | `postgres/suppliers.rs:1346` | Count them only when no cursor was presented, or cache per (search, status) |
| **P14** | An unknown **division** is refused by the foreign key and reported as "referenced Supplier or internal Article does not exist", naming two things that are not the problem. Tags, colours and sizes are each refused **by name** | `postgres/suppliers.rs:176` vs `:2397` | Check the division the way the other three are checked |
| **P15** | What a supplier item comes in stops at the catalogue: the order line carries division and tags and nothing about colours or sizes, so Article Setup decides the colourways from the carton | `postgres/suppliers.rs:2180`, `postgres/tagging.rs:902` | §4.3; the decision itself is [the basket's §9.3](./sourcing-basket.md#9-open-decisions) |

---

## 10. Open decisions

1. **Is the supplier code ours or theirs?** `SUP01`…`SUP30` is ours; `DENIMCO`
   reads like a name. If it is ours, it should be allocated rather than typed,
   and the question of reissuing a retired code arises exactly as it does for a
   size code.
2. **One supplier master, or a party master?** The same company can be somebody
   we buy goods from, somebody who bills us for electricity (`0094` expense
   bills), and somebody we sell to. Today only the first has a record.
3. **May a duplicate be merged?** Two rows for one company will happen — and,
   given §2, may already have happened in a way nothing can see. Merge means
   repointing orders, bills and payments, so it is a decision before it is work.
4. **Payment terms: on the supplier or on the bill?** A default on the master
   with an override per bill is the ordinary answer, and it needs saying before
   anybody keys a hundred due dates by hand.
5. **Who may create a supplier?** Everything here is `SUPERVISOR`, so the
   person raising an order can invent the counterparty they raise it against.
   That is the sort of thing an auditor asks about.
6. **Does a supplier belong to a site?** Bills are per site because the client
   keeps a P&L per site. The supplier is not, and nothing says whether a store
   may buy from anybody.

---

## 11. Tests this document requires

Nothing today tests a supplier write: `sourcing_integration.rs` has twenty
tests and they are all about the catalogue's filters, with `create_supplier`
used as a fixture.

1. a second supplier cannot take an existing code in a different case;
2. two items of two suppliers may share an item code, and two items of one
   supplier may not;
3. a stale `If-Match` is refused and the record is unchanged;
4. a replayed idempotency key returns the first answer and writes nothing;
5. an update that names no field is refused;
6. `null` clears a phone number and absent leaves it alone;
7. an inactive supplier is refused for a new order — **and the same for the
   free-hand path**;
8. an inactive item is refused, and the rest of the order is not written;
9. a retired supplier's items do not appear in a sourcing page (P4);
10. `total` is unchanged by ticking a facet and changes with the search — the
    contract §4.2 rests on;
11. a cursor issued under `price_low` and replayed under `newest` restarts the
    list rather than skipping rows;
12. an unknown division code is refused by name, as an unknown tag already is
    (P14);
13. a negated facet still returns the rows nobody has classified;
14. a bill cannot be recorded against a supplier the master does not hold (P2);
15. a supplier's bills and its unbilled receipts are reachable from one key
    (P1).
