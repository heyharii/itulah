# RecordLink

RecordLink is the one way to make an object open its detail as a layer: a word in `accent` that opens the record, or, inside a row that already opens, the same word in `ink` with a › at the row's end on hover.

There is no shared `RecordLink` component yet. The `record-link` class in `styles/white.css` and the `openable()` helper in `lib/openable.ts` are the source. A shared component that takes `onOpen`, wears the class, stays a `button` and stops the row's own click is the fix for the 111 hand-made copies below.

## Pick by job

| What opens | How |
| --- | --- |
| A name among other words: a supplier in a sheet's title, an item in an editable row | `<button type="button" className="record-link text-left" onClick={…}>` |
| A whole row or card that opens its own record | `openable(open)` spread on the `tr` or `li`: one target, nothing blue in it |
| Another screen, or "show me this order" | `AppLink to="…" sheet={{ key, value }}`, which keeps the layer in the address |
| A name that has no detail | Plain `ink` text. Not every word is a link. |

## States

| State | Look |
| --- | --- |
| Rest | The words around it, in `accent`, no underline. It takes the size, weight and face of its neighbours. |
| Hover | An underline appears in the same colour (3px below), over `t-hover` (120ms, `ease-out`), where hover exists. |
| Focus | A 2px `accent` outline, 2px off, on a 4px radius (`r-link`). |
| Inside a row that opens | `ink`, not blue. The row is one target; the link underlines under the pointer and still opens its own record. |
| The row's › | 16px in `mute`, at the right end of a `tr[data-opens]` under the pointer. Not drawn where the last cell holds a button or a link, and not on a card. |

`openable(open)` returns `data-opens`, `tabIndex: 0` and a key handler: Enter or Space opens, Up and Down walk to the row above or below, and a key pressed on a control inside the row is that control's. Add `FOCUSED` for the inset ring.

## Rules

- Every object with a detail opens it: an item, a supplier, a PO number, a SKU, a photo. It opens as a layer over what you were on, and Close and Esc walk back one layer.
- Blue means one of three things: the one primary button, a selection, or a word that opens another record outside a row. Nothing else in a row is blue.
- A link inside a row that opens stops the click (`event.stopPropagation()`), so it opens its own record and not the row's.
- The layer's key goes in the address (`useSheet(key).open(id)`), so a colleague can be sent the link. A record already in the stack goes back to that layer instead of stacking a copy.
- Stay a `button`. Use `AppLink` only where it goes to a path.
- No size, weight or mono of its own: a PO number reads in the face of the words beside it.

## Retired

- Blue link buttons styled by hand: 111 of them in 65 files, each with its own colour, underline and hover (`procurement/suppliers.tsx:2442`).
- `record-link` itself is used in only 4 files: `procurement/items-table.tsx`, `procurement/count-review.tsx`, `procurement/purchase-orders.tsx`, `people/directory.tsx`.
- Names shown as plain text where they have a record: `SupplierName` draws text and is used in 22 files, and sheets name a supplier or an item without opening it: `finance/supplier-bills.tsx:1658`, `maintenance/hub.tsx:245`, `sales/sale-sheet.tsx:214`, `procurement/supplier-returns.tsx:1169`, `inventory/pools.tsx:1214`, `operations/quantity-checks/quantity-checks.tsx:123`.
- Everything in a row drawn blue, or an underline at rest.

## What you provide

| Piece | Notes |
| --- | --- |
| `className="record-link"` | On a `button`, with `text-left`. White.css draws it. |
| `openable(open)` | From `lib/openable.ts`. Spread it on a row or a card. |
| `FOCUSED` | The row's keyboard ring, from `lib/openable.ts`. |
| `AppLink` | `to` a path in the nav registry, `sheet={{ key, value }}` to open a layer on arrival. |
| `useSupplierRecordId()` | The supplier's record id from an order's code and name, `null` when the book does not know it. `SupplierName` itself draws text only. |

Source: `frontend-hub/src/styles/white.css` (`.record-link`, `[data-opens]`, the › on `tr[data-opens]`), `src/lib/openable.ts`, `src/components/ui/app-link.tsx`, `src/screens/procurement/supplier-name.tsx`.
