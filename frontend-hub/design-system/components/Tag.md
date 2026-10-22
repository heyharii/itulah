# Tag

A tag is a small outlined word that names a category, a code or a type beside a record: it is never a state, and it stays neutral unless the colour means something.

## Variants

All six share one box: 24px high, 8px a side, radius 6px (`r-chip`), no fill, a 1px `hairline-2` ring. Only the word's colour changes.

| `tone` | Word colour | Today it marks | Example |
| --- | --- | --- | --- |
| `neutral` | `body` | A division, a store, a payment method, a contract kind | Pria, Sandal dan Sepatu, QRIS, PKWTT |
| `accent` | `accent` | A word somebody typed to file a record under | Faktur |
| `info` | `info-fg` | Where a record came from, or who can see it | POS, Shared |
| `ok` | `ok-fg` | A promotion on a basket | Promotion |
| `warn` | `warn-fg` | A contract that ends; a return that is over-delivery | PKWT, Over-delivery |
| `bad` | `bad-fg` | A return whose items are wrong | Items don't match the order |

## Sizes

One size: 24px high, 15px at 600. There is no small tag.

## Rules

- A tag is a category, a code or a type. A state (Active, Returned, Allotted) is a `Status`.
- Leave it neutral. Colour only when the type itself means something, as on a return's reason.
- Sentence case. Write Promotion, not PROMOTION. A code keeps its capitals because they are its name (PKWT, QRIS).
- The word is set in the page's own face at 600, never mono: white.css swaps the face, whatever the component's comment says.
- A long word truncates inside the tag and never wraps: give the tag `max-w-full`, wrap the word in a `truncate` span and put the whole word in `title`.
- A tag is a label, not a control. A thing that opens a record is a `record-link`.

## Retired

- Tags that say a state: `sales/sale-sheet.tsx:440` (Returned), `inventory/reconciliations.tsx:170` (ALLOTTED, UNEXPLAINED), `workplace/library.tsx:130` (FILED). Draw them as `Status`.
- Capitals typed into a tag: PROMOTION, UNKNOWN, SUM OF ITS SHOPS, "12 CODES", FLOOR, REJECT, THREAD. Use sentence case.
- A second tag style: `TagChip` in `workplace/discussions.tsx` (26px, fully round), and the Pricelist's `TAG_TONE` and `TAG_TEXT` (`commercial/pricelist.tsx:1899`), which paint Promo, Markdown, Below cost and Changes with hex colours. Use `Tag` and its tones.
- To tell a tag from a status, ask whether the word can change while the record stays the same. If it can, it is a status. Tag is used 107 times today, Pill 441 and Status 125.

## What you provide

| Prop | Type | Notes |
| --- | --- | --- |
| `tone` | `"neutral" \| "accent" \| "ok" \| "warn" \| "bad" \| "info"` | Default `neutral`. |
| `children` | `ReactNode` | The word. Wrap a long one in `<span className="truncate">`. |
| `className` | `string` | `max-w-full` where the tag may truncate. |
| `title` | `string` | The whole word, when it truncates. |

Source: `frontend-hub/src/components/ui/tag.tsx`; white look in `styles/white.css` (a small tag: outlined, not filled; one font in a table).
