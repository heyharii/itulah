# Promotion eligibility — what a promotion covers, and what an article edit moves

**Status:** implemented and in the tree, with one half deliberately unfinished
and named in §3. Owner decisions of 2026-09-12 are incorporated. Code
references are read off `feat/handheld-rfid` at `eabc58c`.

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

> When a rule's window opens, its selector is resolved **once** against the
> catalogue as it stands. The answer, the selector that produced it and the
> timestamp are kept. It is never re-resolved on its own.

**As-is.** Migration `0175` adds `commercial_rule_eligibility` and its SKU rows.

- **When.** In the transaction that publishes a book, for a rule whose window
  is already open (`postgres/commercial.rs:632`), and on the catalogue
  publisher's five-minute tick for the windows that open later
  (`bin/cloud.rs:109`). Within one tick of the instant, and honest about being
  a pass — see §1.
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

## 3. What the till actually prices against

**This is the half that is not done, and the UI does not pretend otherwise.**

A shop matches `Applicability::Tag` against the tags in **its own copy of the
catalogue**, which the fleet catalogue snapshot carries per SKU and refreshes
whenever the product list is republished (`line_for`,
`backend/src/edge/pricing.rs:672`). So today an article edit still reaches a
promotion that has already started.

Making the frozen set what shops price against means the set has to travel, and
both routes are larger than this work:

| Route | What it costs |
|---|---|
| Put the resolved SKUs in the published rule document | `commercial_rule` is immutable once published (`protect_commercial_rule`), so it takes a **new publication** — an automatic, machine-issued publish of the whole book, which is a business act nobody has decided to automate |
| Add a field the engine reads beside the selector | A change to `pricing-engine`'s `Rule`, in a crate a second lane is rewriting this week, plus the sync payload and the edge |

Until one is taken, `commercial_rule_eligibility` is the **centre's record**:
what a promotion meant when it began, and the baseline every later question is
asked against. The sentence the screen prints says exactly that
(`STARTED_NOTE`, `eligibility.rs:370`):

> These promotions have already started. What each resolved to when it began is
> recorded, but a shop still matches the rule against the product as it stands —
> so this edit reaches them too.

---

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
- It answers in two lists (`article_change_consequences`,
  `eligibility.rs:374`): **`scheduled`**, which an edit really changes, soonest
  first; and **`started`**, with `resolved_at` and whether this article was in
  that answer.
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
Denim Weekend                      would leave · starts 20 Sep 2026
Their products are worked out when they start, so they will be worked
out against this article as it is then.

These promotions have already started. …
Denim September                    would leave · resolved 12 Sep 2026

              [ Save ]   Cancel        →  [ Save anyway ]   Cancel
```

---

## 5. Invariants

1. No promotion state is stored that a date makes false. `ENDED` and
   `SCHEDULED` are read off the window.
2. A rule's eligibility row is written once and never rewritten by a pass.
3. A rule that has not started has no eligibility row.
4. The consequence answer names only promotions whose membership actually
   changes — never "this tag is used".
5. A started promotion is never reported as changeable, and never claimed to be
   unaffected either (§3).
6. Matching uses the engine's own `Applicability`, including `effect_on`. There
   is no second reading of what a tag rule means.

---

## 6. Gap list

| | Gap | Evidence | Fix |
|---|---|---|---|
| **E1** | The till still matches live, so an article edit reaches a started promotion | `edge/pricing.rs:672` | §3 — one of the two routes, as a separate decision |
| **E2** | Eligibility is resolved up to five minutes after the window opens | `bin/cloud.rs:109` | Acceptable for a promotion; only a real scheduler would close it |
| **E3** | A rule amended in a later book keeps the first book's resolution | `freeze_started_rules` skips rules that have a row | Deliberate. Re-resolving a live promotion needs an explicit workflow, not a pass |
| **E4** | A rule document this build cannot read is silently skipped | `live_rules`, `eligibility.rs:102` | Deliberate; the alternative breaks an unrelated screen. Worth a count in the log if it ever happens |
| **E5** | Colour and Size cannot be selected on, so neither can be a consequence | the engine has no such `Applicability` arm | Only if the business asks for it; the plumbing is generic |

---

## 7. Open decisions

1. **Dynamic membership, or a snapshot?** Today it is **dynamic**, and the code
   says so: the till reads the product's current division and tags out of its
   own catalogue copy when it prices a basket, and the engine matches against
   that. So tagging an article tomorrow puts it into today's promotion, as soon
   as the catalogue reaches the shop — dynamic against the *last published
   catalogue*, not against head office's screen.
   The record in §2 exists so that the other answer is available without
   guesswork. Choosing it is choosing one of the two routes in §3.
2. **What happens when a running promotion must change.** Not "refresh
   eligibility" — an explicit workflow, designed on purpose, so that widening a
   live offer is an act somebody performs and can be read back.
