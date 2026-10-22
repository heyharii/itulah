# Sheet

A sheet opens one record, form or task as a layer over the page, always in one anatomy: head, figures, lines, notes, activity, foot.

## When to use it

| Job | Use |
| --- | --- |
| Read a record: a PO, a supplier, an article, a count | `Sheet`, read mode |
| Fill a form that makes or changes a record | `Sheet`; Edit swaps the contents in place |
| Open an object that appears inside a record (an item, a supplier, a SKU) | A second `Sheet` as a layer, through `record-link` |
| Ask a yes/no, or one reason, before something that cannot be undone | `Dialog` or `ConfirmButton`, never a sheet |
| A whole screen of its own: a report, a board | A page |
| Pick a number or one choice on a phone | `NumberPad` or a picker sheet, from inside a field |

## Anatomy

A slot may be empty, never moved or restyled. There are no tabs inside a record or a form.

```
head     Purchase Orders / PO-161026-010                          ×
         Garmen Nusantara, PT  ● Active
         Created by Rina Kusuma · 16 Oct 2026
figures  Delivery date · Payment · Ordered · Grand total
lines    the main table, then its totals
notes    Terms and conditions · Notes
         › Activity (1)
foot                                   Print   Cancel order   Edit
```

### Head

The head never scrolls and holds no actions. Padding is 24px 28px 16px, with a `hairline` under it.

- **Crumb**: 15/18 in `mute`. "Purchase Orders / PO-161026-010": where the record sits, then its business number, with the slash in `crumb-sep`. It stands 8px over the title. Pressing the first part closes the sheet back to that screen. A layer names its opener: "PO-161026-010 / ITM-339B8C9A". The number reads in the face of the words around it, never mono.
- **Title**: `title` (17/24, 600, -0.3px) in `ink`. The record's own name: a supplier, an employee. Never a verb or the screen's name. It wraps to two lines before it cuts. A name that has a detail of its own is a `record-link`: "Garmen Nusantara, PT" opens the supplier as a layer.
- **Status**: ONE status, a dot and a word through `statusWord()`, 10px right of the title. No second status, no stamp, no count or version in this slot.
- **Caption**: one line in `mute`, 15/20, under the title: "Created by Rina Kusuma · 16 Oct 2026". Provenance, never instructions.
- **×**: 36px, radius 8px, an `ink` glyph at 17px, `soft-2` on hover. A record opened from another screen can show "‹ Back" at the left of the head instead (`closeAs="back"`), and a nested record "‹ Back to {parent}" (`back`).
- **Photo**: `media` puts a 64px tile at the left of the head, for an article.
- **⋯ More**: a 36px quiet glyph opening a short menu (Print, Download, Duplicate). No screen passes it today; Print stands in the foot.

### Body

The body scrolls and is padded 20px 28px 24px. `stack` makes it a column of sections 24px apart; nobody sets a margin.

1. **Figures** come first: a `KpiStrip`, 32px above the table (24px of gap plus 8px).
2. **Lines**: the record's main table, and the totals under it, right-aligned in a 304px column.
3. **Notes**: each a section with its title in `section` (15/20, 600) and its count after it in `mute`.
4. **Activity**: folded, "› Activity (1)", 14px under a `hairline`. Passing `subject` appends it.

No `Card` inside a sheet: the sheet is the card. A record with more than one thing to say passes `tabs` and the sheet draws them as sections in ONE scroll: the first is the body, the rest stand under their titles behind a hairline, and the sheet takes the widest `size` any of them asks for. `tab` scrolls to one.

### Foot

A hairline over it, at least 64px, padded 12px 28px. Buttons are 36px (`control`) with 16px padding, and every one stands at the right, in this order:

1. Print: a ghost with its printer glyph.
2. A red Cancel, or the destructive act.
3. ONE solid primary, last.

Read mode with no primary shows Edit as the blue one; beside a primary (Review Count) it is a ghost. A failed write is a banner above the foot. A sheet with no `footer` still gets a ghost Close foot: the head and the foot are always there. The full foot is the `SheetFooter` card.

## Sizes

Chosen by what the sheet holds, never by a screen's own width.

| `size` | Width at 1440 | Holds | Examples |
| --- | --- | --- | --- |
| `rail` | 480px | A record of ten facts or fewer, or a form of eight fields or fewer. The only size that stands beside its list. | A term, a colour, a count, a store, a user |
| `wide` | 1040px (960 at 1280; all but 80px of a tablet) | A document with lines | PO, supplier, return, article |
| `table` | 1024px | A grid read across | Receiving count, pool, SKU matrix |
| `workspace` | 1344px | A list and the work beside it | New articles, Import, a campaign |
| none | 760px | The legacy panel. Retired. | |

No sheet is wider than the window less 24px. A rail on a page 1300px wide or more stands beside the list with no veil and the list stays clickable; opened from another sheet it is a layer like any other.

## Layers and modes

A desk sheet floats 12px off the window, radius 16px, `shadow-sheet` (an edge ring, not a border), over `scrim` with a 2px blur.

- **Layer**: a sheet opened over another slides in from the right over `t-sheet` (280ms) on `ease-drawer` and stands 12px further in, 24px off the window. The sheet under it dims in place under the same `scrim`; the new veil is clear, so the page is not dimmed twice. Leaving takes `t-exit` (200ms). Esc and × walk back one layer at a time.
- **Mode**: `swap` is for Edit over a record. Nothing travels: the frame stays, the contents fade out over 100ms and the form fades in over 160ms. The foot swaps to Cancel and the act: Save changes, or Review order on the PO.

## Phone

Under 768px every sheet is a bottom drawer, whatever its size. It rises over `t-drawer` (450ms) to 12px under the top of the screen, with 16px top corners, `shadow-float`, and a grip: 36px by 4px in `hairline-strong`, 8px below the top edge. A pull down closes it.

- Head padding is 16px. Body is 24px 16px. Foot is 12px 16px, with 44px (`tap`) buttons, and it rides above the keyboard and the home bar.
- The anatomy and the order of the foot do not change. Every action stays at the bottom.

## States

- **Loading**: `SheetLoading what="supplier"` says "Reading the supplier…" in `mute`, over two pale pulsing bars. The head already shows the number from the address.
- **Empty**: `SheetEmpty` is one `mute` line and, when one fixes it, the action: "No contact person on file."
- **Failed read**: `SheetError` is a red banner with the server's sentence and an underlined "Try again".
- `SheetQuery` does all three. A refresh that failed over a record already on screen keeps the record and says so above it.
- **Dirty**: `dirty` makes ×, Esc, a pull down and a tap on the veil ask once: a `Dialog` "Discard your changes?" with "What you changed has not been saved.", Keep editing (blue) and Discard (red).

## Rules

- Pass `size`. Pass `footer={<SheetFooter … />}`. Pass `badge` with one status.
- The record's verbs live in the foot. The head holds none.
- Objects inside a sheet open as layers, never as navigation.
- Do not put a width in `className`. Do not draw a second foot in the body.
- One Activity block per sheet.

## Retired

- **No `size`.** 195 of 291 sheets get the legacy 760px panel. Pick a `size`.
- **`width`** (61 uses) is the old name of `size`. 16 sheets also set a width through `className`; a bare `w-*` does nothing on a desk and an `md:w-[…]` fights `size` (the item layer is 832px this way). Remove both.
- **`actions`** (43 sheets): verbs go in `footer`.
- **`badge` with more than one thing in it.** `badge` is used 31 times. `commercial/vouchers.tsx:918`, `commercial/promotions.tsx:1617` and `contracts/hub.tsx:74` carry two statuses; some badges are a count or a version, not a status.
- **`figures` and `print` in the head.** Figures are a `KpiStrip` in the body; Print is in the foot.
- **Tabs inside a record:** `sales/sale-sheet.tsx:139`, `vendors/vendors.tsx:542`, `inventory/stock-cards.tsx:949`, `workplace/chat-info.tsx:110`, and the form `finance/cash-documents.tsx:2133`. The supplier sheet's tabs were asked for by the owner on 15 Oct; leave those.
- **A second sheet for Edit.** `swap` is used only on the PO. Promotions, vouchers, campaigns, catalogue and people open another sheet; use `swap`.
- **A centred `Panel` as a form:** `finance-lab-2/cash-counts.tsx:356`, `bank-reconciliation.tsx:639`, `bank-accounts.tsx:275`. `procurement/count-review.tsx:316` builds a sheet by hand, and `components/operations/outbound-papers.tsx:99` draws a dark `bg-ink/55` backdrop. Use `Sheet` and `scrim`.
- **Two Activity blocks:** `allotment/allotments.tsx`, `assets/hub.tsx`.
- **`noFoot` and a Submit row in the body.** 28 sheets put the primary in the body and also get the automatic Close foot: two feet.
- **The anatomy diagram in the `sheet.tsx` comment** (mono id, a tabs row, an 18px title, a quiet Cancel, widths of 900, 1020 and 1340) is out of date. This card follows `white.css`.

## What you provide

| Prop | Type | Notes |
| --- | --- | --- |
| `open` | `boolean` | |
| `onOpenChange` | `(open, reason?) => void` | `reason` is `escape`, `close`, `veil` or `swipe`. |
| `title` | `ReactNode` | The record's own name. A `record-link` when it has a detail. |
| `id` | `ReactNode` | The business number in the crumb. Never a UUID. |
| `context` | `ReactNode \| false` | Where it sits, before the number. Default: the screen's name. A layer passes its opener's number. `false` says nothing. |
| `badge` | `ReactNode` | ONE status. |
| `caption` | `ReactNode` | One quiet line. |
| `size` | `"rail" \| "wide" \| "table" \| "workspace"` | Required in practice. |
| `stack` | `boolean` | The body is a 24px stack of sections. |
| `swap` | `boolean` | Edit over a record, in place. |
| `footer` | `ReactNode` | A `SheetFooter`. |
| `subject` | `{ kind, id }` | The record whose folded Activity ends the body. |
| `tabs`, `tab`, `onTabChange` | `SheetTab[]`, `string`, `fn` | Drawn as sections in one scroll. A tab may carry its own `size`. |
| `dirty` | `boolean` | Ask before a close throws typing away. |
| `back`, `closeAs` | `{ label, onClick }`, `"x" \| "back"` | For a record opened from another screen. |
| `media` | `ReactNode` | A 64px picture at the left of the head. |
| `more` | `SheetMoreItem[]` | The ⋯ menu. |
| `noFoot` | `boolean` | Retired. |
| `className` | `string` | Never a width. |
| `width`, `actions`, `figures`, `print` | | Retired. |

Source: `frontend-hub/src/components/ui/sheet.tsx`, `sheet-footer.tsx`, `sheet-states.tsx`, `dirty-guard.tsx`; `src/lib/sheet-stack.ts`, `src/lib/sheet-space.ts`; look in `styles/white.css` (Sheets). `Facts` and `Fact` live in the same file and have their own card.
