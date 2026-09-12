# Promotion eligibility — what a promotion covers, and what an article edit moves

**Status:** implemented end to end, including the till. Owner decisions of
2026-09-12 are incorporated. Code references are read off `feat/handheld-rfid`
at `eb53b99`.

Before this: [product master](./product-master.md) — the four lists a promotion
selects on. Beside it: the Commercial V1 baseline, in Indonesian
([acuan utama](./commercial-v1.md) ·
[keputusan dan invariant](./commercial-v1-decisions-and-invariants.md)), which
owns how a promotion is priced. This document owns only *which products a
promotion applies to, and when that is decided*.

The problem it exists for: a rule selects products by a set of strings —
`Tag = Denim` — and the match was recomputed on every basket from whatever the
catalogue said at that moment. Two things were therefore invisible, and both
are commercial rather than cosmetic:

- **what a running promotion actually covers.** `Tag = Denim` is the question.
  The answer moved every time somebody tagged an article, and nobody could see
  it move.
- **that editing an article is a decision about money.** Adding `DENIM` to a
  jacket puts it into every promotion that selects on that tag, and the person
  doing it is looking at a product form that says nothing about promotions.

---

## 1. The states that exist

Nothing here is new. **There is no Draft for promotions in this design**, and
none was added; the two Drafts below were already in the estate and mean other
things.

| Where | States |
|---|---|
| `commercial_publication.status` | `DRAFT`, `PUBLISHED` — a **price book**, not a promotion |
| `RuleStatus`, inside the rule document | `DRAFT`, `ACTIVE`, `PAUSED`, `EXPIRED` — and **nothing ever writes `EXPIRED`** |
| `CampaignStatus` | `DRAFT`, `SCHEDULED`, `ACTIVE`, `PAUSED`, `EXPIRED`, `CANCELLED` |
| The phase a person reads | derived, never stored: `ACTIVE`, `PAUSED`, `ENDED`, `SCHEDULED` |

The phase comes from the stored status plus `conditions.effective_from` /
`effective_to` in the rule document. `phaseOf`
(`frontend-hub/src/screens/commercial/promotions.tsx:326`) is the definition,
and the comment beside it says why nothing is stored: a status meaning "the
date has passed" is wrong from the moment it is written unless something
rewrites it at midnight.

`phase_of` (`backend/src/cloud/postgres/eligibility.rs:77`) is the server's
copy of exactly that order, and it distinguishes the three cases this document
needs: **Active** (published, `ACTIVE`, inside its window), **Scheduled**
(published, `ACTIVE`, window not open yet), **Dormant** (everything else —
paused, draft, ended; reported nowhere here).

> **There is no activation event.** Nothing in this estate fires when a
> timestamp goes by. Anything that must happen "when a promotion starts" is
> therefore a pass, not a trigger, and this document says so wherever it
> matters.

The selector is the engine's own `Applicability`:
`Sku`, `Article`, `Division`, `Tag`, `WholeCart`, held inside
`commercial_rule.definition` as jsonb. Both halves of a rule's product scope are
read — `scope.applicability` and `scope.effect_on` — because "buy a suit, get
50% off a shirt" names the shirts in the second, and an article that stops being
a shirt has left that promotion just as surely as one that stops being a suit
(`covers`, `eligibility.rs:153`).

---

## 2. What a started promotion resolved to

**Target.**

> On the **first eligibility pass after a rule's window has opened**, its
> selector is resolved **once** against the catalogue as it stands at that
> moment. The answer, the selector that produced it and the timestamp are kept.
> It is never re-resolved on its own.

**As-is.** Migration `0175` adds `commercial_rule_eligibility` and its SKU rows.

- **When.** In the transaction that publishes a book, for a rule whose window
  is already open (`postgres/commercial.rs:632`), and on the catalogue
  publisher's five-minute tick for the windows that open later
  (`bin/cloud.rs:109`).

  **A pass, not an instant, and the difference is visible.** A promotion whose
  window opens at 10:00 is resolved by the pass that runs at, say, 10:05, and
  the set it stores is the catalogue **as it stood at 10:05** — an article
  tagged at 10:02 is inside it. That delay is accepted for V1 rather than
  papered over: building a scheduler to fire on a timestamp would be a new
  moving part for five minutes of precision on a promotion that runs for a
  fortnight. What must never happen is the pass running twice and changing its
  mind, which is `a_second_pass_does_not_rewrite_what_the_first_resolved`.
- **Keyed by `rule_id`**, not by publication. The shop's model is
  `DISTINCT ON (rule_id)`, newest published book wins, and `commercial_usage`
  counts the same way: a promotion republished is one promotion amended, not
  two.
- **Written once.** `freeze_started_rules` (`eligibility.rs:208`) skips any rule
  that already has a row, so running it twice a minute costs two reads and
  changes nothing. That is the safety property: a pass that re-resolved would
  quietly move what a live offer covers, which is a decision rather than a
  background job.
- **`WholeCart` and rules with no applicability are not frozen.** The basket is
  their subject; there is no set of SKUs that is "in" them.
- A rule document this build cannot deserialise is **skipped**, not fatal — the
  alternative is a product form that refuses to save because of a promotion
  somebody wrote last year.

---

## 3. What the till prices against

**The frozen set, since 2026-09-12.** This section used to say the opposite,
and the change is the point of the work rather than a detail of it.

A shop matched `Applicability::Tag` against the tags in **its own copy of the
catalogue** on every basket (`line_for`, `backend/src/edge/pricing.rs`), so
tagging an article at head office changed what a promotion that had already
started gave away, in every shop, silently.

**How the frozen set gets there.** `commercial.eligibility.v1` — a fourth lane
beside the publication, the usage counts and the campaign switch, and it exists
for the reason those three do: it is decided *between* publications. The rule's
book was published in August and is frozen; its window opens on a Saturday
morning; something has to carry the answer, and it cannot be the book.

```text
centre                                        shop
──────                                        ────
window opens
  → freeze pass resolves the selector
  → commercial_rule_eligibility (+ per role)
  → commercial.eligibility.v1 ──────────────▶ commercial_rule_eligibility
                                                (SQLite, migration 0037)
                                                        │
publish / price a basket                                ▼
  postgres/pricing.rs::load_rules            edge/pricing.rs::load_rules
        │                                              │
        └────────► domain::commercial::narrow_to_frozen ◄────────┘
                   replaces scope.applicability (and
                   effect_on) with the frozen SKU set
```

Three properties this shape was chosen for:

- **Nothing is republished.** A book is a decision somebody makes; a background
  job that issued one would be a machine making it.
- **No published rule is mutated.** `commercial_rule.definition_json` at the
  shop is the document that was sent. The frozen set is applied to a *copy* while
  the snapshot is built — the same place and the same moment `caps` already
  absorbs usage counts.
- **One definition of membership.** `narrow_to_frozen` is called by the till and
  by the centre's own pricing, so a simulation, a resolved-offer list and a
  receipt cannot disagree.

`WholeCart` is never frozen and never narrowed: the basket is its subject and no
product is in or out of it. `excluded_sku_codes` is untouched — a carve-out the
author made is not a membership the catalogue decided.

**What a shop does with a rule it has no frozen set for:** it reads the
selector, exactly as before. That is not a gap; it is what a scheduled
promotion needs, and `an_unfrozen_promotion_reads_the_catalogue_as_it_stands`
holds it down.

## 4. What an article edit would move

**Target.** Before the save, the person editing an article is told which
promotions their change moves it into or out of — by name, with the date that
makes it urgent — and the ones that have not started are the loud half.

**Usage is not consequence, and the second is the useful one.**

| Question | Answer | Where |
|---|---|---|
| *Usage* — "does a promotion name this tag?" | Stops the **tag** being deleted | [product master §4.1](./product-master.md#41-what-speaks-for-a-value) |
| *Consequence* — "does removing this tag from **this article** change whether it matches?" | Warns the person editing the **article** | here |

A tag used by forty promotions is not a reason to stop editing an article. The
one promotion whose membership actually moves is.

**As-is.**

- `POST /api/v1/articles/{article_code}/consequences`
  (`http/mod.rs:411`) takes the state the form is **proposing** — a division and
  a complete tag set, both required, neither meaning "unchanged" — and writes
  nothing. It is a POST because the question carries a set of tags; a GET would
  put them in a query string with a length limit and worse escaping.
- It answers in two lists (`article_change_consequences`): **`scheduled`**,
  which an edit really changes, soonest first; and **`started`**, which it does
  not — those were resolved when their windows opened, and the line says
  "stays included · resolved 12 Sep 2026" rather than "would leave". Until the
  frozen set reached the shops that sentence had to say the opposite, and did.
- The article form asks it as the person edits, not only when they press Save,
  and only once the draft differs from what is on record
  (`frontend-hub/src/screens/master/form.tsx`). The proposal is **derived from
  the form's own state** rather than kept beside it — a second copy is a second
  thing to keep in step, and it is the copy that goes stale.
- The warning sits above the Save button. When something scheduled moves, Save
  takes two presses: the first is not a save, it is the moment the list stops
  being scenery. Same shape as the delete on a master value.

```
This change affects a promotion that has not started.
Denim Weekend                   would leave · starts 20 Sep 2026
Their products are worked out when they start, so they will be worked
out against this article as it is then.

These promotions have already started. Each one covers the products it
resolved to when it began, and a shop prices against that answer — so
this edit does not change what they give away.
Denim September              stays included · resolved 12 Sep 2026

              [ Save ]   Cancel     →  [ Save anyway ]   Cancel
```

---

## 5. Invariants

1. No promotion state is stored that a date makes false. `ENDED` and
   `SCHEDULED` are read off the window.
2. A rule's eligibility row is written once and never rewritten by a pass.
3. A rule that has not started has no eligibility row.
4. The consequence answer names only promotions whose membership actually
   changes — never "this tag is used".
5. A started promotion's membership is what it resolved to. Republishing the
   same `rule_id`, re-running the pass, or editing an article does not replace
   it — only an explicit workflow could, and none exists yet (§7.2).
6. What the centre records and what a till prices against are the same set,
   through the same function.
7. Matching uses the engine's own `Applicability`, including `effect_on`, and
   the two halves are frozen apart. There is no second reading of what a tag
   rule means.

---

## 6. Gap list

| | Gap | Evidence | Fix |
|---|---|---|---|
| ~~**E1**~~ | ~~The till still matches live~~ | **Closed 2026-09-12.** `commercial.eligibility.v1` carries the frozen set and both pricing paths narrow to it; proven at a checkout in `store_pricing_integration.rs` | — |
| **E2** | Eligibility is resolved on the first pass after the window opens, up to five minutes late, and reflects the catalogue at that moment rather than at the start time | `bin/cloud.rs:109` | Accepted for V1 and documented in §2. Only a scheduler firing on the timestamp would close it, and that is a new moving part for five minutes |
| **E6** | A shop that misses the eligibility message keeps the previous one until the next pass | whole-payload replace in `edge/sync.rs` | Deliberate, and the same bargain the usage counts and campaign switches make |
| **E3** | A rule amended in a later book keeps the first book's resolution | `freeze_started_rules` skips rules that have a row | Deliberate. Re-resolving a live promotion needs an explicit workflow, not a pass |
| **E4** | A rule document this build cannot read is silently skipped | `live_rules`, `eligibility.rs:102` | Deliberate; the alternative breaks an unrelated screen. Worth a count in the log if it ever happens |
| **E5** | Colour and Size cannot be selected on, so neither can be a consequence | the engine has no such `Applicability` arm | Only if the business asks for it; the plumbing is generic |

---

## 7. Open decisions

1. ~~**Dynamic membership, or a snapshot?**~~ **Decided and built, 2026-09-12:
   a snapshot, from the moment a promotion starts.** Before its window opens a
   rule is dynamic — deliberately, since its products have not been decided —
   and from the first pass after it opens the resolved set is what both the
   centre and every till price against. What remains of the old answer is the
   five minutes in §2 and the wording that says so.
2. **What happens when a running promotion must change.** Nothing here can do
   it, and that is on purpose: the pass will not re-resolve, a republished book
   will not replace a frozen set, and there is no "refresh" anywhere. Widening
   or narrowing a live offer needs an explicit workflow — an act somebody
   performs, with a record of who and why — and designing it is its own piece
   of work. Until then the answer to "the promotion is covering the wrong
   products" is to stop it and start another.
