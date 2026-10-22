# FormSheet

The template for making or changing one record in a sheet: a head, the fields in a grid, the lines with Add item, the totals as a strip, Notes, and a foot of Cancel and Save.

## Copy this screen

- A document with lines: the PO composer, `frontend-hub/src/screens/procurement/composer.tsx` (`/procurement/orders?new-order`).
- A form without lines: the supplier form, `screens/procurement/suppliers.tsx` (`SupplierComposer`, and its edit inside `SupplierSheet`).
- The small version on a rail: New color, `screens/master/colours.tsx` (`ColourSheet`).

## Pick the size by what the form holds

| `size` | Width | Fields | Holds |
| --- | --- | --- | --- |
| `wide` | 1040px (960 at 1280) | 4 across: 228px each at 1040 | A document with lines: a PO, a supplier, a return |
| `rail` | 480px (`sheet-rail`) | 2 across: 200px each | Eight fields or fewer and no lines: a color, a term, a store, a user |

Every sheet declares a `size`. Never set a width through `className`.

## Slots, top to bottom

| Slot | Drawn as |
| --- | --- |
| Head | Crumb in `mute`: "Purchase Orders". Title "New order" in `title`. No status while the record is new. × at the right. Padding 24 28 16, a `hairline` under it. |
| Fields | One grid: 24px between columns and between rows. Label 15px in `mute`, 8px above a 40px box. Required: a `bad` asterisk. Refused: a `bad` border and one sentence under the box. |
| Lines | A section title ("Order items") with its count in `mute`, and "Add item" at the right of that line: a ghost with its plus. Then the lines table: Item · Quantity · Unit price · Amount, the pencil and the bin at the end of each row. |
| Totals | A second `KpiStrip` under the lines: Quantity · Total · Discount · Grand total. The Discount cell is the one figure you type, as a `%` box. |
| Notes | A section title and a `Textarea`, three rows by default. |
| Foot | `SheetFooter`: Cancel (red), then Save (primary), both at the right. 36px buttons, at least 64px, padded 12 28, a `hairline` over it. |

- The body is padded 20 28 24 and the sections stand 24px apart (`section-gap`). Nobody sets a margin.
- The wide fields on the PO are Supplier, Delivery date, Payment terms and Payment method. A fifth field wraps to a second row.
- The strip keeps 8px under it inside a sheet, and the body's 24px does the rest.
- "Add item" puts a line into the record you are editing, so it is a ghost: Save is the one primary. A line that is wrong is changed with the pencil and removed with the bin, an `ink` glyph.
- An empty list says what to do: "Nothing on this order yet. Add what is being ordered."

## Editing the same record

- Edit swaps the sheet's contents in place (`swap`): out in 100ms, in 160ms. The frame, the width, the sections and their order stay.
- The head then reads like the record's: crumb "Purchase Orders / PO-161026-010", the record's name as the title and its ONE `Pill`. The foot is Cancel (red) and Save changes.
- Esc while editing cancels the edit. `dirty` makes ×, Esc, a swipe and a tap on the veil ask "Discard your changes?" once.

## On a phone

- The sheet is the bottom drawer: full height less 12px, a 36 × 4 grip in `hairline-strong`, 16px top corners and `shadow-float`. Head padding 16px, body 24px 16px, foot 12px 16px.
- The grid is one column, the lines stack as cards, and a numeric field opens the `NumberPad`.
- The foot keeps its order, with 44px buttons that share the width.

## Rules

Do:
- Group the fields in one grid and keep one scroll of sections. A form has no tabs.
- Make a record with "New order"; put a line into it with "Add item".
- Mark every required field, and none else. Say what is wrong under the box, in a sentence.
- Say Save or Save changes. When Save is off, the foot's `note` says why in a few words.
- Use the kit's `Select`, `Day`, `Money` and `Checkbox`, and write labels in sentence case.

Don't:
- Put a Submit row or the primary in the body.
- Read a record as disabled inputs: reading is `Facts`, and Edit swaps in the fields.
- Open a form in a `Dialog` or a centred `Panel`.
- Write a hint that is a sentence.

## Retired

Follows it: the supplier form: `size="wide"`, `dirty`, a `SheetFooter` (Cancel and the primary, with a `note` when Save is off) and sections in one scroll. Its fields are two across at 24px.

Drifts in the PO composer:
- `width="wide"` (the old prop) and a hand-made foot: Cancel and "Review order", then "Back to editing" and "Submit".
- Fields two across at 16px (`gap-4`), under an "Order details" heading, with Title Case labels ("Delivery Date", "Payment Terms", "Payment Method").
- "Add item" is a solid primary beside the foot's primary.
- The head says "New purchase order" where the button says "New order", and an edit's title is "Edit purchase order" with the supplier in the caption: the title of a record is its name.
- The totals are a 24rem box at the bottom right (`order-totals`) with a Segmented `%` or `Rp` inside it and "Grand Total".
- "Additional information" holds Notes and "Terms and Conditions" side by side. The discard dialog is titled "Discard This Order?".
- An edit shows the supplier as a read-only `Input` (`composer.tsx:2305`).

Drifts in the others:
- The supplier form says "Create supplier" and writes "Legal Form", "Phone Number" and "Contact Person" in Title Case.
- New color has no `size` (it gets the legacy 760px panel), a `SubmitRow` in the body ("Add Color", a quiet Delete) with the automatic Close foot under it, and "New Color" in Title Case.
- Three field grids, three gaps: 16px in the composer, 24px in the supplier form, 12px in New color. The grid is written by hand each time.
- 195 of 291 sheets give no `size`; 61 use `width`; 43 pass `actions`; 28 put the primary in the body; 69 feet are hand-made.
- Tabs inside a form: `finance/cash-documents.tsx:2133`. A centred `Panel` as a form: `finance-lab-2/cash-counts.tsx:356`, `bank-reconciliation.tsx:639`, `bank-accounts.tsx:275`. A hand-built sheet: `procurement/count-review.tsx:316`.
- Edit opens a second sheet in Promotions, vouchers, campaigns, the catalogue and people.

## What you provide

| Slot | You pass |
| --- | --- |
| `Sheet` | `open`, `onOpenChange`, `size`, `title`, `id` (the number, once there is one), `badge` (one `Pill`, when editing), `stack`, `dirty`, `swap`, `footer` |
| Fields | `Field` with `label`, `required`, `problem`, around `Input`, `Select`, `Day`, `Money` or `Textarea`. The grid is a `grid` of 4 columns on `wide` and 2 on `rail`, `gap-6` |
| Lines | `SheetSection` or `SubHead` with `aside` for the count and one `Button`; `ItemsTable` for a PO, `MiniTable` elsewhere |
| Totals | `KpiStrip className="mb-2!"` holding `Kpi` (`label`, `value`) |
| Foot | `SheetFooter` with `onCancel`, `primary` (`label`, `pending`, `said`, `disabled`), `note`, `error` |

Source: `frontend-hub/src/screens/procurement/composer.tsx`, `suppliers.tsx`; `screens/master/colours.tsx`, `term-form.tsx`; `components/ui/sheet.tsx`, `sheet-footer.tsx`, `field.tsx`, `kpi.tsx`; the look in `styles/white.css` (Sheets, Fields).
