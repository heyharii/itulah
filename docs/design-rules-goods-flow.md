# Design rules — goods-flow screens (owner, 1 Oct 2026)

Apply to every screen built from the goods-flow prototypes (repo root `*-prototype.html`).

## Spacious
- Table rows at least 64px tall for one line of text. A cell with two lines (name over SKU, number
  over date, supplier over PO) gets about 14px above and below and 4px between the two lines — it
  must never look squeezed.
- Page title, then about 20px, then the tabs or the content. Cards and sheets with comfortable
  padding (16–24px). Buttons in a row with breathing room.
- Never shrink text below 14px to fit; give it room instead.

## No useless words
- No subtitle under a page title that explains the page.
- No notes, hints, footnotes, helper sentences under options, or "who does what" text.
- Empty states are one short line ("Nothing missing.").
- Dialog bodies are one short line at most ("Rp 1.160.000 owed is written off."). Buttons are short verbs.
- History/timelines already say who did what — do not repeat it elsewhere.
- Labels are short and plain: Settle by · Settled · Owed · From · Age · Missing.

## Same as the prototype when the data is the same
- Same columns in the same order, same labels, same tabs, same actions, same stamps/pills.
- When the backend does not carry a piece of data the prototype shows, leave that element out (or
  show what does exist) — never fake it, never add a placeholder sentence about it.
- When the hub already has a component for the job (Card, SubTabs, Segmented, Sheet, Facts, Pill,
  DataTable, EmptyState), use it; match the prototype's spacing with it.

## Hub
- Tokens only, weights 400/500/600, text ≥ 14px, English copy, `frontend-hub/PATTERN.md`.
- Checks allowed: `npx eslint` and `npx prettier --write` on touched files, `node scripts/design-lint.mjs`.
  Not allowed: tsc, vite build, cargo.
