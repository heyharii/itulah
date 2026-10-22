# Sheet anatomy

Every record, form and task that opens over a list opens in a `Sheet`, with one anatomy. A sheet is glass: it floats 12px off the window with `r-sheet` corners and `shadow-sheet`, over the `scrim` veil with a 2px blur. What was under it stays where it was.

```
┌──────────────────────────────────────────────────────────────┐
│ Purchase Orders / PO-161026-010                           ×  │ crumb (mute) · close
│ Garmen Nusantara, PT  ● Active                               │ title (record-link) · ONE status
│ Created by Rina Kusuma · 16 Oct 2026                         │ caption (mute), optional
├──────────────────────────────────────────────────────────────┤
│ Delivery date │ Payment │ Ordered │ Grand total              │ figures: KpiStrip
│ 29 Oct 2026   │ 30 days │ 24 pcs  │ Rp 2.040.000             │
│ Order items 1                                                │ section title + count
│ ┌ Item ───────────── Quantity ── Price ───── Amount ┐        │ MiniTable / items box
│ └───────────────────────────────────────────────────┘        │
│ Notes                                                        │
│ Activity ▸                                                   │ collapsed, reads on open
├──────────────────────────────────────────────────────────────┤
│                         [Print] [Cancel order] [Edit]        │ foot: all at the right
└──────────────────────────────────────────────────────────────┘
```

## Size — chosen by what it holds

| `size` | Width | Holds |
| --- | --- | --- |
| `rail` | 480 (`sheet-rail`) | Ten facts or fewer and short tables, or a form of eight fields or fewer: a term, a colour, a store, a user. The only size that stands beside its list on a wide monitor. |
| `wide` | 1040 at 1440, 960 at 1280 (`sheet-wide`) | A document with lines: a PO, a supplier, a return, an article, a composer. |
| `table` | up to 1024 (`sheet-table`) | A grid read across: a receiving count, a pool, a SKU matrix. |
| `workspace` | up to 1344 (`sheet-workspace`) | A list and the work beside it: New articles, Import, a campaign. |

- Every sheet declares a `size`. A sheet with none gets the old 760px panel, which is legacy.
- Never set a width through `className`.
- On a phone every sheet is the bottom drawer: full height less 12px, with a grip, swiped down to close.

## Head — fixed; it never scrolls and never holds verbs

- **Crumb:** where the record sits, in `mute` — the list's name, a `crumb-sep` slash, then the record's number.
- **Title:** the record's own name — a supplier, an employee, the order number when there is no better name — in `title`.
  - It wraps to two lines before it truncates.
  - When it is another record (the PO's supplier), it is a `record-link`.
  - It is never a verb or the screen's name.
- **One status** beside the title (`badge`): a single `Pill`, with its dot and word in the tone's `-fg` at weight 500. One status, never two; a count or a version is not a status.
- **Caption:** one `mute` line of provenance ("Created by Rina Kusuma · 16 Oct 2026"), never an instruction.
- **⋯** for Print, Download or Duplicate when the foot has no room. **×** closes. Both are 36px glyph buttons.

## Body — one scroll of sections

The sections come in this order:
1. figures;
2. the record's lines;
3. totals;
4. Notes;
5. Activity.

- Sections stand 24px apart (`stack`). Nobody sets a margin.
- A section's title is `section` (`SubHead`). Its count or its total ("of Rp 8.400.000") stands at the right end of that line, in `mute`.
- Facts are `Facts`: two columns, the label over the value, values that wrap (an email is never cut), eight short values at most.
- Lines are a `MiniTable` (it stacks on a phone) or the framed items box.
- No `Card` inside a sheet: the sheet is the card.
- **No tabs in a record or a form.** A record with more to say passes `tabs`, and the sheet draws them as one scroll of sections, with Activity last.
- A finished document wears a `DocStamp` over its corner: Fully received (ok), Closed short (bad), Cancelled (mute).
- Activity (`subject`) comes once, collapsed, at the foot of the body.

## Foot — the only home of the verbs

- A hairline above it, at least 64px tall, padded 12/28. Its buttons are 36px with 16px sides, 44px on a phone.
- **Every button stands at the right:** Print (ghost) first, then the red Cancel or destructive verb, then ONE solid primary, last.
- **Read mode:** `[Print] [Edit]`. Edit is the blue one when nothing else is; beside a primary (Review Count) it is a ghost.
- **Edit mode:** `[Cancel] [Save changes]`.
- A `FootNote` says, in a few words, why the primary is disabled.
- A failed write is one banner above the foot.
- A sheet with no verbs ends in a ghost Close, so the foot is always there.
- Do not put a Submit row in the body: verbs go in `footer`. Do not use the `actions` prop.

## Edit — the mode move

- Edit swaps the sheet's contents in place (`swap`): the frame stays put, the contents fade out over 100ms and back in over 160ms.
- The edit form keeps the width, the sections and the order of the read view.
- Esc while editing cancels the edit; × leaves the sheet.
- Unsaved typing (`dirty`) makes ×, Esc, a swipe and a tap on the veil ask "Discard your changes?" once.

## Layers — the layer move

- A record opened from inside a sheet (an item, a supplier, a SKU) opens as a layer:
  - it slides in from the right over `t-sheet` (280ms) on `ease-drawer`;
  - it stands 12px further in;
  - the sheet under it dims under the `scrim` and does not move.
- Close and Esc walk back one layer, over `t-exit` (200ms).
- Opening a record that is already in the stack goes back to that layer instead of stacking a duplicate.
- Only the front sheet is live.

## States

- **Loading:** `SheetLoading`. The head already shows the number from the address.
- **Empty:** `SheetEmpty`, one quiet line and the action.
- **Failed:** `SheetError`, with Try again.
- `SheetQuery` does all three.

## Dialog, not a sheet

A centred `Dialog` is only for "are you sure?":
- a short question as its title;
- one line on what cannot be undone;
- Cancel, then the act.

Beside a red irreversible act, Cancel is the blue one. A form never opens in a dialog.
