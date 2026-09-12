# The four master lists, and what may be done to a value in one

**Divisions · Tags · Colours · Sizes.** Decided with the owner on 2026-09-12 and
implemented the same day (migration `0167`, `postgres/vocabulary.rs`,
`postgres/colours.rs`, `screens/master/lifecycle.tsx`). This file is the written
form of the rule, the map it depends on, and the three things still open.

## 1. The lifecycle

```text
        ACTIVE ──retire──▶ RETIRED ──restore──▶ ACTIVE

        ACTIVE + never used ──delete──▶ gone
```

**Active** means the value may be chosen for something new — an article being
created or edited, a colourway being mapped, a supplier item being classified.

**Retired** means it may not, and nothing else. It is a decision about the
future, never an edit to the past:

- the 86 articles tagged `DENIM` keep the tag;
- a promotion selecting `Tag = Denim` keeps running until somebody stops the
  promotion;
- last year's report still groups by the division nobody files under any more;
- no reference is rewritten, unlinked or cleaned up. Nothing cascades.

**Delete** exists for one case: the value created a minute ago with the word
spelt wrong. It is offered only when nothing has *ever* named the value. It is
absent, not disabled, when the answer is no — a greyed-out control invites
somebody to hunt for the state that would enable it, and there is no such
state.

## 2. What can name a master value

Fifteen tables and one document. `Articles` — the column on the master screens —
is **one** of them, which is why "Articles: 0" was never a licence to delete.

| Master     | Foreign keys pointing at it                                                                        | No foreign key                       |
| ---------- | -------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `division` | `article`, `article_setup_session`, `purchase_order_line`, `supplier_item`                           | `commercial_rule.definition` (jsonb) |
| `tag`      | `article_tag`, `article_setup_session_tag`, `purchase_order_line_tag`, `supplier_item_tag`, `document_tag` | `commercial_rule.definition` (jsonb) |
| `size_code`| `sku`, `article_setup_variant`, `supplier_item_size`                                                 | —                                    |
| `colour`   | `article_colour`, `article_setup_colour`, `supplier_item_colour`                                     | —                                    |

The jsonb column is the dangerous one. A published promotion stores the
serialised engine `Rule`, and `Applicability::Division { divisions }` /
`Applicability::Tag { tags }` hold plain sets of strings. The database has no
reference to follow, so a tag can be spoken for by a live promotion while every
table in the catalogue says nothing points at it. Both `scope.applicability` and
`scope.effect_on` are searched (`PROMOTIONS_BY_TAG` in `postgres/vocabulary.rs`).

Colours and sizes have no promotion arm in the engine today. If one is added, it
belongs in the same sweep.

`GET /api/v1/vocabulary/{kind}/{code}/usage` and `GET /api/v1/colours/{code}/usage`
answer the whole map at once — every place, including the ones counting zero —
plus `ever_used`, `can_delete` and, when it cannot, `blocked`: the sentence that
says why. The screen draws its buttons from that answer and the `DELETE` handler
re-runs the same function, so a button is never offered for something the server
will refuse.

## 3. `ever_used`, and the one thing it cannot see

"Nothing references it **today**" is not "nothing ever did". A tag is unpicked
from the last article that carried it and its live count falls to zero, while a
printed label, a report and an audit line still read the word.

Nothing in this estate recorded that. `audit_log` stores the method, the path
and the status — deliberately not the body — so the removal of a tag from an
article is not recoverable from it. So `0167` adds a boolean `ever_used` to the
four master tables, set by statement-level triggers on all fifteen referencing
tables and **never cleared**. Retiring, restoring and unpicking the last
reference all leave it standing.

The triggers are statement-level over the transition table with an
`AND NOT ever_used` guard: a setup session minting a few thousand SKUs of one
size runs one no-op `UPDATE`, not one per row, and takes no lock after the first
use of that code.

**The hole, named:** the backfill marks what is referenced at migration time. A
value used and then unpicked *before* 2026-09-12 looks never-used and is
deletable. That hole closes with time, and it is smaller than the alternative of
never letting a typo be removed.

## 4. Rules checked against this codebase

| Rule                                                       | Where it stood                                                                                                             |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| A · `0 Articles` is not a licence to delete                 | **Real, and now enforced.** Five tables and a jsonb rule document can name a tag; the screen was showing one of them.        |
| B · Retire must not stop what already runs                  | **Held already.** Retiring flips `active`; nothing else is touched, and the pricing engine never reads the master tables.     |
| C · Visible historically, unavailable prospectively         | **Was broken in the article editor. Fixed.** `/catalogue/vocabulary` returns active terms only, so an article filed under a retired division opened with the Division box *blank*, and its retired tags were invisible while still being submitted. Both now render, marked `Retired`, removable but not re-addable. |
| D · No automatic un-referencing on retire                   | **Held.** There is no such write anywhere.                                                                                    |
| E · Code immutable after first use                          | **Stricter than asked.** The code is immutable always — it is `article.division_code`, `sku.size_code`, `article_tag.tag_code`. Correcting a never-used code is delete + recreate, which is now possible. |
| F · A used code is never recycled                           | **Held for retirement** (the row keeps the code, so nothing can take it). A deleted code *can* be taken again — but only a code that never meant anything can be deleted. |

## 5. Not built

- **Merge.** `Off White` / `Offwhite` / `Off-White` still cannot be folded into
  one. It is the right answer for tags and colours and it is a repoint of every
  reference — including the jsonb rule documents — followed by leaving the old
  value as `MERGED → X` rather than erasing it. Nothing here blocks it later.
- **Dependency warnings on the article, not the master.** Removing `Denim` from
  one article can change what that article costs, and the article editor says
  nothing. This is arguably more valuable than guarding the master list, because
  it is the edit people actually make.
- **A retired term reads as its code in a facet.** `/catalogue/vocabulary`
  returns active terms only, and the facets the article search returns include
  retired ones — articles still carry them — so the chip says `MENSWEAR` rather
  than "Menswear". Cosmetic, pre-dates this work, and the honest fix is an
  `include=retired` parameter on that endpoint with the two pickers filtering
  for themselves, rather than each screen reading the master lists.
- **Saved reports and saved filters are not swept.** `report_version.spec` is
  jsonb and a filter link lives in a URL (`?f=`), outside the database entirely.
  Neither is counted. A text search of the spec would be false-precision — for a
  two-digit size code it would be nearly meaningless — and `ever_used` covers
  the realistic case, since a report naming a value implies goods once carried
  it.

## 6. The decisions still open

### What a Division divides by

The six in the seed mix three axes: `Menswear`, `Womenswear`, `Kids` are a
customer segment, `Footwear` and `Accessories` are a product type, and `Divided`
is a line. Division is mandatory and an article has exactly one, so the mixture
has a question with no answer: a woman's shoe is Womenswear or Footwear,
whichever the person filing it thought of first — and every report that groups
by division then splits on that coin toss.

Nothing here decides it, because it is a statement about how the business is
organised rather than about the software: if the company really runs a Footwear
division with its own buyer and its own margin, that is the right axis and the
segments become tags. If it does not, the segments are the axis and
`Footwear`/`Accessories`/`Denim`/`Formal` are tags. Either is workable; the
mixture is not. Whichever is chosen, the values that lose are **retired**, never
deleted — everything filed under them keeps reading them.

### Dynamic membership or a snapshot

**Is `Tag = Denim` on a promotion dynamic membership, or a snapshot taken at
activation?**

Today it is **dynamic**, and the code says so plainly: the till reads the
product's current `division_code` and tag list out of its own catalogue copy
when it prices a basket (`line_for` in `edge/pricing.rs`), and the engine matches
`Applicability::Tag` against that list (`engine.rs`). So tagging an article
`Denim` tomorrow puts it in today's promotion — as soon as the catalogue reaches
the shop, which is the one wrinkle: membership is dynamic against the *last
published catalogue*, not against head office's screen.

That means changing an article's tags or division is a commercial act, not only
a merchandising one. Which is the argument for the warning in §5, and for
answering this question before the next campaign is built on a tag.

## 7. Where the filters live

Decided the same day, and it is the same principle applied to layout rather
than to data. Articles kept its facets in a 15.5rem column on the LEFT, which
made the screen read as three layers of chrome before any work — rail, module
sidebar, filters, catalogue. A filter is not navigation: it does not say where
you are, it says which part of what you are looking at you want to see.

```text
LEFT              CENTER                    RIGHT
Navigation        Work                      Context
──────────        ────                      ───────
Articles          Article grid / table      Filters
Divisions
Tags
Colours
Sizes
```

The facets now open in the panel every other list in this app uses — `<Sheet>`,
docked as a 27.5rem column on the right from 96rem up and over the page below
that. A `[Filters n]` chip in the toolbar opens it, the count says how many are
on, and the active facets stay visible as chips above the results with a
`Clear all` beside them: the panel is dismissible and the evidence that the list
is short for a reason must not go with it.

The four master lists get no permanent filter sidebar. `[All] [Active]
[Retired]` and a search box is the whole of what they need; the numeric
"Articles is 0" clause they already had opens the same right-hand panel from the
same kind of button.

## 8. What a promotion resolved to, and what an article edit changes

Added 2026-09-12, immediately after the master lifecycle above, because it is
the other half of the same objection: a tag is not just a word in a list, it is
what a promotion selects on.

### The promotion state machine, as it actually exists

Nothing here was invented, and there is no Draft anywhere in it that was not
already there:

| Where | States |
| --- | --- |
| `commercial_publication.status` | `DRAFT`, `PUBLISHED` (a price book, not a promotion) |
| `RuleStatus` (in the rule document) | `DRAFT`, `ACTIVE`, `PAUSED`, `EXPIRED` — **and nothing ever writes `EXPIRED`** |
| `CampaignStatus` | `DRAFT`, `SCHEDULED`, `ACTIVE`, `PAUSED`, `EXPIRED`, `CANCELLED` |
| The phase people read | derived, not stored: `ACTIVE`, `PAUSED`, `ENDED`, `SCHEDULED` |

The phase comes from the status plus `conditions.effective_from` /
`effective_to` in the rule document — `phaseOf` in
`screens/commercial/promotions.tsx` is the definition, and the comment there
says why: a status meaning "the date has passed" is wrong from the moment it is
written unless something rewrites it at midnight.

So "scheduled" is a real, existing thing: a published rule, `ACTIVE`, whose
window has not opened. There is no activation event — nothing in the estate
fires when a timestamp goes by.

### Freezing

`0175` adds `commercial_rule_eligibility` (+ its SKU rows). When a rule's
window is found open, its selector is resolved once against the catalogue and
the answer is kept with the selector and the timestamp. Written once, never
rewritten: re-resolving a running promotion is a decision, not a background job.

The pass runs in the transaction that publishes a book (for rules already
in-window) and on the catalogue publisher's five-minute tick (for windows that
open later). Keyed by `rule_id`, like `commercial_usage`, because the shop's
model is `DISTINCT ON (rule_id)` — a promotion republished is one promotion
amended.

**The honest limit, stated plainly.** This is the centre's record. A till still
matches `Applicability::Tag` against the tags in its own copy of the catalogue,
so an article edit does still reach a running promotion. Making the frozen set
what shops price against means the set has to travel — either inside the
published rule document (which is immutable once published, so it would take a
new publication) or as a new field the engine reads (in a crate a second lane is
rewriting this week). Neither was in scope here, and the UI does not claim
otherwise: the warning says what is true today.

### The consequence check

`POST /api/v1/articles/{code}/consequences` takes the state the form is
proposing — a division and a complete tag set — and answers with the promotions
whose membership would change, split in two:

- **scheduled**: has not started, so its product set will be resolved against
  whatever the article looks like then. This is the half worth interrupting
  somebody for, and the article form shows it above the Save button with the
  promotion's name and start date, then takes two presses to save.
- **started**: already running. Reported quietly, with when it resolved and
  whether this article was in that answer.

Usage and consequence are deliberately different queries. "This tag is used by
40 promotions" is not a reason to stop editing an article; "removing this tag
takes this article out of Denim Weekend, which starts on Saturday" is.
