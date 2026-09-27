# Product master — the article and the four lists it is described with

**Status:** implemented and in the tree. Owner decisions of 2026-09-12 are
incorporated, including the conservative `ever_used` policy of §4.2, and the
decision of 2026-09-25 that the divisions are the client's nine (§2, §7.1). Code
references are read off `feat/handheld-rfid` at `eb53b99`.

Vocabulary: [`../CONTEXT.md`](../CONTEXT.md) — note especially that *article*,
*product* and *SKU* all mean **our** identity, which does not exist until
Article Setup. Before this: [purchase order](./purchase-order.md) ·
[receiving — count](./receiving-count.md). After this:
[promotion eligibility](./promotion-eligibility.md), which is what makes
editing one of these lists a commercial act rather than a clerical one.

This document owns what an article is described with, what may be done to those
descriptions, and why a value can never simply be deleted. It does not own
pricing, promotions or the setup session that mints an article.

---

## 1. What the module holds, and what it does not

`/master` is **Articles**: the record, and the four lists an article is
described with.

```
Articles
─────────────
Divisions   Colours   Sizes   Tags
```

Named after the record rather than the filing cabinet. It was "Master data"
until 2026-09-12 and the owner's objection stands: master data is a
data-modelling word for something nobody in the business does. Nobody opens the
app to visit master data; they open it to look at an article. The heading the
four lists used to sit under — "Vocabulary" — is a hairline now, because every
word tried for them named a category of table rather than anything the business
does.

**Not here, and each for its own reason:**

| | Where it lives | Why |
|---|---|---|
| Suppliers | Procurement (`/procurement/suppliers`) | A party the company transacts with, not a word an article is described with. Moved back 2026-09-12; the old path redirects (`NavItem.moved`, `frontend-hub/src/lib/navigation.ts:81`). |
| Article setups | Procurement, in the order book's header | A setup turns a delivery that arrived under no article into one. A delivery is a purchase. |
| Chart of accounts | Finance | Master data by every definition — 7,528 rows — but nobody looks for an account outside Finance. |

---

## 2. What describes an article

**Target.**

> An **Article** has **exactly one Division** and **zero or more Tags**. Its
> variants carry a **Colour** and a **Size**.

**Division** is one primary, top-level, business-defined bucket. The system
guarantees the *shape* — exactly one, mandatory — and takes no position on the
axis: whether the business divides by customer segment or by product type is a
fact about the company, not about the software.

The company's answer (owner, 2026-09-25, §7.1) is the client's own: the nine
divisions of their *Summary Penjualan per Divisi* report, seeded by `0382` with
`display_order` = the client's KODE DIVISI so every list sorts the way their
report does.

| KODE | Code | Label |
|---|---|---|
| 1 | `WANITA` | Wanita |
| 2 | `PRIA` | Pria |
| 3 | `ANAK_LAKI` | Anak Laki-laki |
| 4 | `ANAK_PEREMPUAN` | Anak Perempuan |
| 5 | `PERLENGKAPAN_BAYI` | Perlengkapan Bayi |
| 6 | `SANDAL_SEPATU` | Sandal dan Sepatu |
| 7 | `TAS` | Tas |
| 8 | `AKSESORIS` | Aksesoris |
| 9 | `NON_DIVISI` | Non Divisi |

The six the seed started with — `MENSWEAR`, `WOMENSWEAR`, `KIDS`, `FOOTWEAR`,
`ACCESSORY` (0022), `DIVIDED` (0043) — are **retired**, not deleted: whatever
already holds them keeps them (§4).

The nine still mix axes — segment for 1–5, product type for 6–8 — so a woman's
sandal is `WANITA` or `SANDAL_SEPATU`. That is accepted, not overlooked; tags
carry the other axis:

```
Division = SANDAL_SEPATU   Division = WANITA
Tags     = Women,          Tags     = Footwear,
           Running,                   Running,
           Sport                      Sport
```

**Tags** are the flexible secondary classification. Several per article, no
hierarchy, no second taxonomy. There is deliberately no
category/subcategory/sub-subcategory anywhere: one division, many tags, a
colour and a size is the whole model.

**Colour** and **Size** describe the variant, and both are positions in the
SKU rather than names beside it:

```text
   1 2 3 4 5 6 7 8   9   10 11
   └──── article ─┘   │   └ size ┘
                   colour
        12345678       1      03
```

| Digits | What it is | Where it comes from |
|---|---|---|
| 1–8 | **Article code** | Minted by the setup session. Eight digits, fixed for the life of the article. |
| 9 | **Colour digit** | An index **into this article's own colourways**, 0–9 — not a company-wide colour id. `article_colour(article_id, colour_digit) → colour_code` is the mapping, and the screen calls the ten slots "0 of 10 digits used". |
| 10–11 | **Size code** | The global two-digit code from the size master. `03` is M on every article in the company. |

`cloud/domain/identity.rs:31` is the authority, and its golden vectors are
lifted from the handhelds already in the field. Two consequences worth stating
where somebody will look for them:

- **Ten colourways per article, permanently.** The colour is one digit, so the
  eleventh cannot be expressed. Not "awkwardly many" — ten.
- **The EPC carries these same eleven digits** as BCD under the `0xA0` retail
  private header, plus a 44-bit serial. A SKU code that moved would strand
  every tag already sewn into a garment, which is why neither the article code
  nor the size code is editable (§4).

**As-is.** All four are controlled lists with tables since `0022`, `0027`,
`0081` and endpoints since `0091`. Nothing about the article model changed on
2026-09-12; what changed is what may be done to the lists.

---

## 3. The screens

**Target.** Three columns with three jobs, and the middle one is the work:

```
LEFT              CENTER                    RIGHT
Navigation        Work                      Context
──────────        ────                      ───────
Articles          Article grid / table      Filters
Divisions
Colours
Sizes
Tags
```

A filter is not navigation. It does not say where you are; it says which part
of what you are looking at you want to see, so it belongs on the side this app
already puts contextual things on.

**As-is.**

- The facets stood in a 15.5rem column on the **left** until 2026-09-12, which
  made the screen three layers of chrome before any work. They now open in the
  panel every other list uses — `<Sheet>`, docked as a 27.5rem column on the
  right from 96rem up and over the page below that
  (`frontend-hub/src/screens/master/articles.tsx`).
- The trigger is `[Filters]`, or `[Filters n]` when something is on. The active
  facets stay above the results as chips with a `Clear all`: the panel is
  dismissible and the evidence that the list is short must not go with it.
- Grid/Table toggle unchanged. Search reads
  **article · SKU · name · QR · supplier code**. **EPC is deliberately not
  named** — an EPC identifies one physical garment, and this screen is the
  product definition. The server still accepts one; Inventory and global search
  are where that question belongs.
- The four list screens take `[All] [Active] [Retired]`, a **Status** column,
  and a usage count written as `0` rather than "Unused" — the word read as a
  licence to delete, which it is not (§4). Tags have no Order column and no
  Order field: every row in the seed sat at 0, which is what a field nobody has
  a use for looks like. Sizes keep it, because `XS S M L XL XXL` is neither
  alphabetical nor numeric.
- No eyebrow. A screen headed "Master data / Colours" made the reader hold a
  word the business does not use.

---

## 4. The lifecycle

**Target.**

```
        ACTIVE ──retire──▶ RETIRED ──restore──▶ ACTIVE

        ACTIVE + never used ──delete──▶ gone
```

**Retire** means one thing: this value may not be chosen for anything **new**.
It does not touch what already holds it. The 86 articles tagged `Denim` keep
the tag, a promotion that selects on `Denim` keeps running, last year's report
still groups by the division nobody files under any more, and no reference is
rewritten, unlinked or cleaned up. Nothing cascades.

**Delete** exists for the typo — the value created a minute ago with the word
spelt wrong — and for nothing else. A master value that has ever had business
meaning does not leave: a division nothing is filed under today still names
twelve thousand transactions in last year's report, and a size code is two
characters of every SKU minted in it.

**Name and Code are different things.** The name is editable. The code is what
`article.division_code`, `sku.size_code`, `article_tag.tag_code` and
`article_colour.colour_code` hold, so a code that moved would be a rename that
lost the goods. A used code is permanently reserved: `03 = M` retired must
never become `03 = EU 39`.

**As-is.**

- Retire/restore is a `PATCH` with `If-Match`; the shared UI is
  `frontend-hub/src/screens/master/lifecycle.tsx:45`, used by both the
  three-word-list screen and Colours, so the two cannot disagree about when a
  value may be destroyed.
- `DELETE /api/v1/vocabulary/{kind}/{code}` and `DELETE /api/v1/colours/{code}`
  require `If-Match` and re-run the whole sweep server-side
  (`postgres/vocabulary.rs:970`, `postgres/colours.rs:674`). The screen draws
  its buttons from the same function (`deletion_refusal`,
  `postgres/vocabulary.rs:892`), so a Delete is never offered for something the
  server will refuse.
- Delete is **absent**, not disabled, when the answer is no. A greyed-out
  control invites somebody to hunt for the state that would enable it, and
  there is no such state.
- The code is immutable **always**, which is stricter than the rule above asks.
  Correcting a never-used code is delete-and-write-again, which is now possible.

### 4.1 What speaks for a value

`in_use` — the Articles column — is **one** of fifteen places, which is why it
was never a licence to delete.

| Master | Foreign keys | No foreign key |
|---|---|---|
| `division` | `article`, `article_setup_session`, `purchase_order_line`, `supplier_item` | `commercial_rule.definition` (jsonb) |
| `tag` | `article_tag`, `article_setup_session_tag`, `purchase_order_line_tag`, `supplier_item_tag`, `document_tag` | `commercial_rule.definition` (jsonb) |
| `size_code` | `sku`, `article_setup_variant`, `supplier_item_size` | — |
| `colour` | `article_colour`, `article_setup_colour`, `supplier_item_colour` | — |

The jsonb column is the dangerous one. A published promotion stores the
serialised engine `Rule`, and `Applicability::Division { divisions }` /
`Applicability::Tag { tags }` hold plain sets of strings with nothing to join
to — so a tag can be spoken for by a live promotion while every table in the
catalogue says nothing points at it. Both `scope.applicability` and
`scope.effect_on` are searched (`PROMOTIONS_BY_TAG`,
`postgres/vocabulary.rs:738`). Colours and sizes have no promotion arm in the
engine; if one is added it belongs in the same sweep
(`reference_sites`, `postgres/vocabulary.rs:758`; `COLOUR_REFERENCE_SITES`,
`postgres/colours.rs:602`).

`GET /api/v1/vocabulary/{kind}/{code}/usage` and
`GET /api/v1/colours/{code}/usage` answer the whole map at once — every place,
including the ones counting zero — plus `ever_used`, `can_delete` and, when it
cannot, `blocked`: the sentence saying why.

### 4.2 `ever_used`, and why everything old carries it

"Nothing references it **today**" is not "nothing ever did". `article_tag` rows
go when a merchandiser unticks a tag; a tag that clothed eighty articles last
year can have a live count of zero and a history that a printed label, a report
and an audit line still read.

Nothing recorded that. `audit_log` stores the method, the path and the status,
deliberately not the body, so the removal of a tag from an article is not
recoverable from it. Migration `0167` adds `ever_used` to the four master
tables, set by **statement-level** triggers on all fifteen referencing tables
and never cleared. Statement-level with an `AND NOT ever_used` guard: a setup
session minting a few thousand SKUs of one size runs one no-op `UPDATE`, not one
per row, and takes no lock after the first use of that code.

**`0180` closes the hole `0167` left.** That first backfill marked only what was
referenced at the moment it ran, so a value used and unpicked *before* it looked
never-used — and was therefore deletable. Since the evidence to tell the two
apart was never written down, the policy assumes the worst about everything that
already existed:

```text
a row that predates the mark  → ever_used = true  → retire only, forever
a row created after the mark  → ever_used = false → deletable while unused
                                first durable use → true, and never back
```

The cost is real and accepted: a typo made before 2026-09-12 can only be
retired, which leaves a misspelling in a list. The alternative cost is deleting
a division that names twelve thousand transactions in last year's report. Those
are not comparable.

From here the flag means what it says for every value that will ever be
created, which is what makes delete safe to offer at all.

---

## 5. Invariants

1. An article has exactly one division and zero or more tags.
2. A retired value stays valid for everything that already holds it, and is
   offered for nothing new.
3. Retiring never rewrites a reference. There is no cascade anywhere.
4. A value with `ever_used = true` cannot be deleted, whatever its live counts
   say — and every value that existed before 2026-09-12 carries it.
5. A value with any live reference cannot be deleted, whatever `ever_used`
   says.
6. A code, once used, is never reissued with a new meaning.
7. The screen and the server compute "may this be deleted" with the same
   function.

---

## 6. Gap list

| | Gap | Evidence | Fix |
|---|---|---|---|
| **P1** | A retired term reads as its code in a facet — `MENSWEAR`, not "Menswear" (sharper since `0382` retired all six original divisions) | `catalogue_vocabulary` returns active terms only (`postgres/suppliers.rs`), while the article search returns facets that include retired ones | An `include=retired` parameter on that endpoint, with the two pickers filtering for themselves — rather than each screen reading the master lists |
| **P2** | Duplicates cannot be folded together | no merge anywhere | Phase two: repoint every reference — including the jsonb rule documents — and leave the old value as merged rather than erased |
| **P3** | Saved reports and saved filters are not swept before a delete | `report_version.spec` is jsonb; a filter clause lives in a URL (`?f=`) outside the database | Left deliberately: a text match on a two-digit size code is false precision, and `ever_used` covers the realistic case |
| **P4** | A master value created before 2026-09-12 can never be hard-deleted, even if it was genuinely never used | `0180` marks every pre-existing row | **None — this is the decision, not a defect.** The evidence to tell "never used" from "used and unpicked" was never recorded, so the safe reading is the only honest one. Retire covers the case; the list carries one misspelling rather than the risk of losing a word the history still reads |

---

## 7. Open decisions

1. ~~**What a Division divides by.**~~ **Resolved by the owner, 2026-09-25:
   the client's nine** (§2). The six in the seed mixed three axes —
   `Menswear`/`Womenswear`/`Kids` a customer segment, `Footwear` and
   `Accessories` a product type, `Divided` a line — and the question was which
   axis should win. The owner's answer is neither: the divisions are the ones
   the client's *Summary Penjualan per Divisi* already reports by (KODE DIVISI
   1–9). Those mix axes too — `WANITA`…`PERLENGKAPAN_BAYI` are a segment,
   `SANDAL_SEPATU`, `TAS`, `AKSESORIS` a product type — and the mixture is
   **accepted** because the client reports by it: an article filed under a
   cleaner scheme would be an article their report cannot place. The residual
   coin toss (a woman's sandal) is a filing rule for the merchandisers, not a
   schema question. `0382` added the nine and **retired** the old six; nothing
   was deleted and no article, order line, supplier item or promotion was
   rewritten (§4).
2. **Whether `Order` should exist on Divisions at all.** It is set and read
   today. Sizes need it, Tags demonstrably did not.
