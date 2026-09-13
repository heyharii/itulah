# The buyer's basket

**Status:** implemented and in the tree, with the target model recorded beside
it. Code references are read off `feat/handheld-rfid` at `15cd477` **and the
uncommitted work in the tree beside it** — `frontend-hub-2` is untracked and
`domain/auth.rs` is modified, and both are marked where they carry a fact.

**The app in service is `frontend-hub`.** The owner's steer of 2026-09-12 is to
work on it and set `frontend-hub-2` aside. `frontend-hub-2` is still described
here wherever it settled a question well, because the answers it reached are
the ones a reader needs — but it is a precedent now, not the thing being
shipped, and every section below says which app it is talking about.

After this: [purchase order](./purchase-order.md) — the document a basket
becomes, and the only thing it can become. Vocabulary is fixed in
[`../CONTEXT.md`](../CONTEXT.md).

Sections marked **Target** are the rules to build to. Sections marked **As-is**
describe today's code and are true until the gap beside them is closed. §8 is
the full gap list; §9 is what the owner has still to decide.

---

## 0. The word, before anything else

**This repository uses "basket" for two unrelated things, and that is the
reason a conversation about one keeps arriving in the other.**

| | The buyer's basket | The till's basket |
|---|---|---|
| What it holds | supplier items somebody is thinking of buying | merchandise a customer is about to pay for |
| Whose | one buyer's, private | one sale's, on a shop's node |
| Where | `sourcing_basket_line`, at the centre | a checkout on the edge, never stored here |
| Becomes | a purchase order | a sale |
| Named in | this document | [`commercial-v1.md`](./commercial-v1.md), the pricing engine's `WholeCart`, every "basket discount" |

They share no table, no route, no code and no concept. The only thing they
share is the noun.

**Target.** In procurement the thing is **the basket**, and it is always the
buyer's. At the till the thing is **the sale**, and its lines are **sale
lines**; "basket" there survives only inside pricing, where it means
*sale-wide* as opposed to *per line* — `WholeCart`, basket discount, basket
threshold. No screen says "basket" at a till.

**As-is.** `CONTEXT.md` now carries **Basket** and the avoid-list beside it,
added with this document. The other half is still loose: the till's own
documents call a sale a basket throughout, and the word reaches screens from
there. → **B8**

---

## 1. What a basket is

**Target.**

> A basket is what one buyer has picked out and not yet ordered. It belongs to
> a person, not to a team and not to a machine. It has no states: a line is in
> it or it is not.

It is not a document, it commits nothing, and nobody is told it exists. That is
precisely what makes it the right place for an unfinished decision — and it is
why [purchase order §1](./purchase-order.md#1-what-a-purchase-order-is) says
there is no such thing as a draft order: *a commitment that has not been made
is not a document; it is a basket, and the basket already exists.*

**As-is.** `sourcing_basket_line` (`0039_sourcing_basket.sql`) — three columns
of content and two timestamps:

```
owner_username   the buyer, as text
supplier_item_id what was picked
quantity         pieces, > 0
added_at
updated_at
PRIMARY KEY (owner_username, supplier_item_id)
```

The primary key is the model. One line per item per buyer, so adding something
already in the basket **raises its quantity rather than appending a second
line** — which is what a person means by adding two of a thing, and is enforced
by the key rather than by a read-then-write two tabs could interleave
(`add_to_basket`, `postgres/basket.rs:162`).

Before `0039` this lived in `localStorage`: a set of ids that belonged to a
laptop rather than to a buyer. It did not follow anybody to a second desk, it
did not survive clearing site data, and the server could not so much as count
how many people were mid-decision.

### It can be the module's draft store, and one app made it one

Putting the basket on the server was not only about second desks. It makes a
purchase order that is still being written into rows somebody else's machine
could serve back.

`frontend-hub-2`'s composer took that literally and holds **no lines of its
own**. A purchase order being written *is* these rows, filtered to one supplier
(`modules/procurement/compose.tsx:102`, untracked); everything else about the
order — supplier, step, destination, promised date, discount, note — is in the
URL. There is no component state in that screen at all, and "the draft silently
lost a line" is not a failure it can have.

**The app in service does not work that way.** `frontend-hub`'s composer seeds
a `DraftLine[]` into `useState` from the basket and edits that
(`screens/procurement/composer.tsx:340`). The *lines* still survive a reload,
because they are the basket's and the basket is on the server — but every edit
made to them in the composer is in memory until the order is raised, including
a quantity somebody retyped there, which is never written back.

So the property is available and unclaimed. What follows is what it would cost
to claim it, and §3 is the bill.

---

## 2. Whose basket it is

**Target.** A basket is addressed by the session and by nothing else. No
request may name a user, so no request can read or empty somebody else's.

**As-is.** Exactly that. The owner comes from `Principal.username` in every
handler and no path under `/api/v1/sourcing-basket` carries a user id
(`http/basket.rs`). Four consequences, all deliberate, all worth knowing:

- **`owner_username` is text and not a foreign key**, matching `created_by` on
  `supplier` and `supplier_item`. A node running `INVENTORY_AUTH_MODE=disabled`
  hands every handler the synthetic actor `development` (`http/auth.rs:77`),
  which is not a row in `app_user` and never will be; a foreign key here would
  make the development mode this project ships fail on its first write.
- Which also means that **with auth disabled there is one basket and everybody
  is in it.** Development only, and named here because two people demonstrating
  at once will read it as a bug. → **B9**
- Usernames are never rewritten and users are deactivated rather than deleted
  (`postgres/users.rs:732`), so a basket is never orphaned. A deactivated
  buyer's lines simply stay, and nobody — not an admin — has a route that can
  see or empty them. → **B10**
- **Nobody can be shown a basket.** Not a manager, not the person who will
  approve the order it becomes. → §9.1

### Who may hold one

`required_role` decides from `(method, path)` alone. The uncommitted change in
the tree puts the whole purchasing surface — `/purchase-`, `/suppliers`,
`/supplier-items`, `/sourcing-basket` — at **Supervisor, reads included**
(`domain/auth.rs:114`), on the reasoning that what a supplier charges is
commercial information and holding a till token is not a reason to see it.

`tests/testdata/routes.json` still records `GET /api/v1/sourcing-basket` as
`Cashier`, so the `route_catalog` gate is red in the tree until somebody
blesses it. → **B6**

---

## 3. What a line can say, and what it cannot

**Target.** A basket line carries every decision a buyer has actually made
about that item before the order exists — and a buyer decides more than a
number.

**As-is.** It carries a number.

That is enough for the quantity, and it is not enough for the four things
`POST /api/v1/purchase-orders/catalog` will happily accept per line
(`CatalogPurchaseLineRequest`, `postgres/suppliers.rs:1856`):

| Override | What it is for | Where a buyer may type it today |
|---|---|---|
| `unit_price_minor` | the agreed price, when it is not the catalogue's | `frontend-hub` only, in memory |
| `article_name` | a corrected description, for this order only | `frontend-hub` only, in memory |
| `division_code` | what the goods actually are | `frontend-hub` only, in memory |
| `tags` | the same | `frontend-hub` only, in memory |

These are a real feature, not decoration: a scraped supplier catalogue goes
stale between the day something is picked out and the day it is ordered, and
raising the order is the one moment somebody has the quote and the goods in
mind at once. The classification in particular **survives the order** —
`tagging` reads `division_code` and `tags` back off the purchase line when it
mints the article at goods receipt, so a line that drops them produces an
article with no division even though the catalogue knew one.

**`frontend-hub` — the app in service — offers all four**, out of a
`DraftLine[]` in `useState` seeded from the basket by an effect whose own
comment explains that reseeding on the wrong dependency would throw away every
edit each time the window regained focus
(`screens/procurement/composer.tsx:340`). A quantity typed into that grid is
not a basket write either. So the buyer who does the most valuable thing this
module offers — correcting a stale catalogue price against the quote in front
of them — is doing it in the one place nothing is kept, and nothing on the page
says so.

**`frontend-hub-2` deliberately does not offer them**, and its comment is worth
keeping even though the app is set aside: the overrides have no durable home,
and a twelve-row editable grid in component state would put the module's one
genuinely losable thing back in memory, next to a basket that is deliberately
not — silently, because nothing on the page would say the price somebody typed
is the price the server will ignore. It chose to lose the feature rather than
lose it quietly.

Two apps, two answers, and under the steer the surviving answer is the lossy
one. → **B1**, **B7**

### Two things a line deliberately cannot say

- **A colour or a size.** A supplier item is a *style*: `0092` records which
  colours and sizes a supplier offers it in as two lists, because a supplier
  quotes one price for the style. So a basket line is pieces of a style, and
  "six navy, six black" is not expressible here — nor on the purchase line.
  The colour/size split is settled at Article Setup, after the goods arrive.
  → §9.3
- **A destination, a promised date or a discount.** Those belong to the order,
  not to the pick, and one order carries one of each.

And one thing a line is *meant* to say and does not: **what the item comes
in**. The basket's own query was written before `0092` and does not splice in
the shared classification columns, while the row reader treats an absent column
as "this caller did not ask" — so every basket line reports no colours and no
sizes, whatever the item carries (`postgres/basket.rs:92` against
`postgres/suppliers.rs:227`). No basket screen draws a swatch today, so
nothing on screen looks wrong — which is the argument for splicing the fragment
in now rather than when one does: the first screen to show what a picked-out
item comes in will be handed an empty list, with no way to tell it from a style
nobody has broken down. → **B11**

---

## 4. The four writes

**As-is** — four writes and the read, and that is the entire surface:

| | Route | Answers | Meaning |
|---|---|---|---|
| read | `GET /sourcing-basket` | `200` + every line, oldest first | no parameters, no cap, no paging |
| add | `POST /sourcing-basket` | `201` + the line | **adds to** what the line already holds; quantity defaults to one |
| set | `PATCH /sourcing-basket/{id}` | `200` + the line, or `204` | says exactly how many; **zero removes the line** |
| remove | `POST /sourcing-basket/{id}/remove` | `204` | removing what is not there is not an error |
| empty | `POST /sourcing-basket/clear` | `204` | |

- **Oldest first**, `ORDER BY added_at, name` (`basket.rs:130`): a basket read
  top to bottom tells the story of the decision in the order it was made, and a
  list that reorders itself as you add to it is one you cannot find anything
  in.
- **`POST` rather than `DELETE`** because the CORS layer permits GET, POST and
  PATCH, and widening it for one route would loosen every route.
- **`204` rather than a line with a null in it** when a quantity of zero
  removes the row: the line exists and here it is, or it does not and there is
  nothing to describe.
- **Nothing is idempotency-keyed, and that is deliberate.** Every other write in
  the catalogue creates a fact that must not be created twice; these change a
  working set only its owner can see, and the shapes are already safe to repeat
  — adding twice is what a shopper means by two, setting a quantity twice sets
  it once, removing something absent removes nothing.

### What it refuses

| Refusal | Status | Where |
|---|---|---|
| quantity `<= 0` on add | `400` "quantity must be at least one; remove the line instead" | `basket.rs:69` |
| quantity `> 1 000 000` | `400` "larger than any real order" | `basket.rs:69` |
| item does not exist | `404` | `basket.rs:179` |
| item is not `ACTIVE` | `400` "that item is on hold and cannot be ordered" | `basket.rs:182` |
| a 201st distinct item | `400` "a basket holds at most 200 different items; raise an order from what is in it first" | `basket.rs:201` |

The quantity rules are checked in Rust rather than left to the `CHECK`
constraint so the buyer is told what was wrong with the number instead of being
handed a constraint violation. The line cap is a read-then-write, so two tabs
can both pass it. → **B5**

---

## 5. A basket goes stale, and only the order notices

**Target.** A line that can no longer be ordered says so where it is read.

**As-is.** The item's status is checked **once, at the moment it is added**, and
never again. Three things can change underneath it, and all three are refused
only at the last press — by `create_catalog_purchase_order`
(`postgres/suppliers.rs:1968`), which re-reads every item `FOR SHARE`:

| Checked when added | Checked when the order is raised |
|---|---|
| item exists | item exists |
| item is `ACTIVE` | item is `ACTIVE` — **again, and it may have changed** |
| — | **the supplier is `ACTIVE`** |
| — | **the item's currency is `IDR`** |
| — | the item belongs to the named supplier |

So a buyer can hold a basket for a week, press *Create the order*, and be told
`409 inactive Supplier cannot be used for a new purchase order` about a line
that looked ordinary on screen a second earlier. Nothing marks it beforehand,
although the read already joins `supplier` and has the answer in hand.
→ **B3**

A fourth thing changes silently and is *meant* to: **the price**. The basket
screen totals at what the catalogue says today and labels the tile *"At today's
catalogue prices — the server snapshots the price when the order is raised"*.
The order records the catalogue's price, name and image as a snapshot at the
moment it is raised, and nothing flows back the other way.

---

## 6. Becoming an order

**Target.** Raising an order consumes the lines it was made from, in the same
transaction that creates the order. A basket cannot be left holding goods that
have already been bought.

**As-is.** Two steps, in the browser, in this order:

1. `POST /api/v1/purchase-orders/catalog` — idempotency-keyed, so a
   double-clicked button raises one order and is answered with the same receipt
   twice.
2. one `POST …/remove` per consumed line, fired together, **failures swallowed**
   (`frontend-hub`, `composer.tsx:432`; `frontend-hub-2` does the same at
   `compose.tsx:205`).

The direction is chosen and it is the right one: a leftover basket line is a
nuisance somebody deletes, a lost order is a purchase nobody made — and a red
banner over a purchase order that went through is worse than a line somebody
has to bin. Only the lines *this* order consumed are removed, because a basket
can hold two suppliers and raising one supplier's order must not empty the
other's.

It is still two round trips that can half-happen. **The server already has the
statement for it**: `remove_many` (`basket.rs:279`) takes the ids in one
`DELETE … = ANY($2)`, is documented as "what raising an order from the basket
does with the lines that became the order" — and **has no caller anywhere in
the estate**. → **B2**

> This exact mistake has been made once already, in the other direction.
> `frontend-hub`'s composer used to invalidate the basket and trust the server
> to have emptied it. The server has never touched the basket, so the refetch
> faithfully returned the same six pieces, and the next person to open it raised
> the same order again without knowing.

### One supplier, one order

A purchase order belongs to one supplier, so every basket screen groups by
supplier and each group is one potential order, biggest first. That is not a
display choice: a PO with two suppliers on it is not a document anybody can
send.

The two apps then differ on what happens when nobody has said whose order it
is. `frontend-hub` **pre-fills the first supplier in the basket**, once, while
the choice is still unset, so reopening the sheet does not undo a deliberate
switch (`composer.tsx:329`). `frontend-hub-2` leaves it empty and **asks**.

Both name the answer in a labelled control a buyer can change, and both offer
only the baskets that exist rather than every supplier — `frontend-hub`'s reads
"Vendor — three lines" (`composer.tsx:876`), because a line count is the only
thing that tells two baskets apart before you open one. So a buyer holding two
suppliers is never *unable* to see which order they are composing. The
difference is narrower and still real: one app makes the choice a default worth
not reading, the other makes it a question.

---

## 7. Invariants

1. One line per item per buyer. Adding again raises the quantity; it never
   appends.
2. A basket line's quantity is at least one. Zero is a removal, not a value.
3. The owner comes from the session. No request names a user; no buyer can
   read, change or empty another's basket.
4. The basket never leaves the centre. No node syncs it, no edge holds one.
5. Nothing in a basket commits anything. It is not evidence, it is not a
   document, and no figure in it is a price anyone has agreed.
6. Every write is safe to repeat, and none of them carries an idempotency key.
7. An order is for one supplier; the lines it consumes are that supplier's and
   only that supplier's.
8. A price is snapshotted by the server when the order is raised, never taken
   from what a basket screen displayed.

---

## 8. Gap list

| | Gap | Evidence | Fix |
|---|---|---|---|
| **B1** | A basket line holds exactly one number, so the four per-line overrides the order accepts have no durable home — and under the 2026-09-12 steer the app in service is the one that offers them anyway, from memory | `0039`, against `CatalogPurchaseLineRequest` | Four nullable columns on `sourcing_basket_line`, or a real draft purchase order. §9.2. **The steer makes this the module's most expensive open gap, not its tidiest** |
| **B2** | Raising an order removes the consumed lines from the browser, one request each, failures swallowed | `compose.tsx:205` | Consume them inside the order's transaction. `remove_many` (`basket.rs:279`) is already written and has **no caller** |
| **B3** | A line is status-checked only when added; a deactivated item, a deactivated supplier or a non-IDR item refuses the whole order at the last press with no warning beforehand | `basket.rs:179` vs `suppliers.rs:2040` | The basket read already joins both tables — carry the answer and mark the line |
| **B4** | **No test covers any of it.** Nothing in `backend/tests` names `sourcing-basket` except the route catalogue | `grep` | Three: adding twice sums, zero removes, one buyer cannot see another's |
| **B5** | The 200-line cap is a read-then-write; two tabs can both pass it | `basket.rs:201` | A constraint, or accept it — the number is a guard rail, not a rule |
| **B6** | `routes.json` still records `GET /sourcing-basket` as `Cashier` while `required_role` now answers `Supervisor`, so `route_catalog` is red | `routes.json:178` vs `auth.rs:114` | `BLESS_ROUTES=1 cargo test --test route_catalog` — belongs to the lane that made the change |
| **B7** | Three apps carry a basket and they disagree about what a buyer may change on a line, whether a typed quantity is stored, and whether the basket is a screen or a sheet over the shelf (`?cart=true`) | `composer.tsx:340` and `basket.tsx:66` vs `compose.tsx:102` | The 2026-09-12 steer settles which survives: `frontend-hub`. So the fix is no longer "retire the old composer" but **carry `frontend-hub-2`'s answer back into it** — a composer whose lines are the basket — which is B1 again. `frontend-cloud/src/lib/basket.ts` is the third copy |
| **B8** | Half closed. `CONTEXT.md` now defines the buyer's basket; `commercial-v1*.md` still calls a sale a basket throughout, and that is where the word reaches till screens from | §0 | Rename it there when Commercial V1 is next touched — another lane's document, not this one's |
| **B9** | With `INVENTORY_AUTH_MODE=disabled` every caller is `development`, so all baskets are one basket | `http/auth.rs:77` | Development only. Named, not fixed |
| **B10** | A deactivated buyer's basket lines stay forever and no route can reach them | `users.rs:732` | Only if it ever matters; the rows are harmless |
| **B11** | Every basket line reports no colours and no sizes, whatever the item carries: the basket's select predates `0092` and an absent column reads as "not asked" | `basket.rs:92` vs `suppliers.rs:227` | Splice `CLASSIFICATION_COLUMNS` into `BASKET_SELECT` — the fragment exists so that exactly this cannot happen |

---

## 9. Open decisions

1. **Is a basket ever anybody else's business?** Today it is strictly private —
   including from the person who will approve the order it becomes, and from a
   colleague covering for a buyer who is away. A shared or handed-over basket is
   a different product with different rules about who may remove what, and
   `0039` says so on purpose. The question is whether purchasing wants one.
2. **Where does an unfinished order live — in the basket, or in a draft order?**
   This is the decision behind **B1** and **B2** both. Columns on
   `sourcing_basket_line` are the small answer and keep one place for "what I am
   thinking of buying". A draft purchase order is the large one, and it
   contradicts [purchase order §1](./purchase-order.md#1-what-a-purchase-order-is)
   — which states flatly that there is no draft — so it is not a change anybody
   should make quietly.
3. **Should a buyer be able to order an assortment?** "Six navy, six black" is
   not expressible in a basket line or a purchase line today; the colour and
   size split is settled at Article Setup after the goods have arrived. That is
   defensible for a style priced as a style, and it means a buyer cannot state
   the breakdown they agreed with the supplier.
4. **Are 200 items and 1 000 000 pieces the business's numbers?** They were
   chosen as guard rails, not as policy.
