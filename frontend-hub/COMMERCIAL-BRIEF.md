
---

## 18. The N+1 is gone

`GET /api/v1/commercial/{rules,coupons,campaigns}` — new, in `cloud/postgres/catalogue.rs` with handlers in `cloud/http/catalogue.rs`, registered with the same two-line discipline as `performance`. Promotions and Campaign now make **four flat requests** where they made one plus one per published book (twelve, growing with every publish).

The round trips are not the point. **The de-duplication moved to SQL**, where it belongs: `DISTINCT ON (key) ORDER BY p.version DESC`, mirroring `load_rules` / `load_coupons` / `load_campaigns` in `pricing.rs` — the code a shop actually resolves with. It was previously a `Set` in the browser reimplementing that rule from memory, and a centre that lists one promotion where a till applies another is worse than no list at all. Only `PUBLISHED` books are considered, for the same reason the engine only loads those.

Each row carries the book that declared it — `publication_id`, `version`, `book_name`, `effective_from`, `effective_to` — plus **`activated_by`**, the shops that put that book into service, aggregated with `jsonb_agg` in the same query. That last one is what keeps this to four requests: "has this offer reached anywhere" is asked of every row, and answering it separately would reinstate half the N+1. It repeats across rules sharing a book; at thirteen shops that is a few hundred bytes.

`listPriceBooks` stays in the set for one thing only: `next_version`, the number a new book must carry to win. The catalogue rows know only the books that happen to declare an offer.

The screens' captions changed from "Built by opening N books one at a time — there is no endpoint that lists promotions" to "Drawn from N published books". The book count stays, because it is the honest denominator: "no promotions, from twelve books" and "no promotions, from none" mean opposite things.

Verified live: rules 1 item / coupons 0 / campaigns 1, each from 12 books, and both screens render with the chart above and no error under it.

---

## 19. Seeded, verified, and the version numbers are gone

### The grid stopped naming books

Every `v13`-style mark is off the Pricelist — the cell, the "behind" flag, the drill-down's rungs, the "From book" fact and the publish receipt. Where a book still needs identifying it is now **named**: "Season offers", "Bandung + Surabaya cap clearance". A merchandiser can act on a name and can do nothing with a number whose screen this app deliberately does not have.

The **rank column went with them.** It carried one chip on one row in three and left a column of blank beside every other; what it said — the top row is what the till charges — the cell weight already says, rank 0 in ink and medium against muted below. One frozen column now, not two.

Also gone: the stray scrollbar stub at the end of the tab strip. `<SubTabs>` scrolls horizontally for modules with more tabs than fit; four always fit, so the scroller only ever drew its own bar. Hidden from `CommercialTabs` rather than by changing the shared component, which other modules do need.

### The chart is twice the height

140 → 260 in the viewBox, `h-32` → `h-64`. Under five tiles the old one was a strip, and a twelve-point series at that height read as texture rather than as a shape.

### Dev now has offers worth looking at

Book **v13 "Season offers"** publishes **3 campaigns binding 11 promotions**, which is the relation the model actually has: a rule names its campaign (`rule.campaign_id`), and a rule is live only when both it and its campaign are. Lebaran holds four offers, Back to School three (one gated by coupon `PELAJAR30`), Q3 Clearance two (one PAUSED, so the paused path is visible), and two rules sit outside any campaign. Effects vary across `PERCENT`, `AMOUNT` and `FIXED_UNIT_PRICE`.

The 48 sample sales were redistributed across ten of those rules, so the figures differ per campaign — Lebaran 467.500 over 19 baskets, Back to School 412.500 over 15, Q3 Clearance 234.000 over 5 — and the chart has a shape instead of a flat line.

### The forms reach the backend — verified by using one

"New promotion" was filled in and published from the browser: name, campaign `lebaran`, article `ART-CAP`, 12% off. It wrote book **v14** and the rule came back from `/commercial/rules` attached to its campaign. So the write path — form → `writeAndPublish` → `POST /publications` → `/publish` → fleet dispatch — works end to end.

Two notes from doing it. The panel no longer stamps the book number on its header or its footer; a book is the unit of publication, not the author's concern while writing an offer. And clicking by `ref_` coordinate missed the button twice while the viewport was emulated — the DOM click was the reliable one.

### Three things asked for and not done

- **Picking promotions from the campaign form.** The membership is one-directional by design — a rule names its campaign — so the campaign form has nowhere to list them, while the *rule* form has a "Part of a campaign" select that works (it is what v14 used). Making it work from the campaign side means republishing the selected rules with `campaign_id` set: a real write of several rules, not a form field.
- **Vouchers.** Nothing can be seeded because nothing stores one. It needs the three pieces §16 names — a table, an issuing command that books the liability, a tender type at the till — and the first is a new migration on a branch where several sessions already hold uncommitted ones.
- **Article photographs.** `article.image_url` is NULL for all six seeded styles, so the grid draws its placeholder box. Not a Commercial gap: articles are another module's master data.
