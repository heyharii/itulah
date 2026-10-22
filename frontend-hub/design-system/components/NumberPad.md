# NumberPad

On a phone a number is picked on a sheet of big keys from the bottom edge, never typed on the system keyboard, with the figure shown large above the keys.

## When it opens

| The box is | On a phone | On a desk |
| --- | --- | --- |
| A numeric `Input`, or `Money` | Opens the pad; the system keyboard never rises | Typed in |
| A code that only looks like a number (an account number, a tax id) | Typed: pass `keyboard` | Typed in |
| A signed figure (`Money signed`) | Typed: the pad has no minus | Typed in |
| Read-only or disabled | Does nothing | Does nothing |

The width of the page alone decides (under 768px): a phone-sized window on a desk gets the pad, and a thumb always does. A quantity typed on a phone raises a keyboard over half the screen, covers the very row being counted, and brings letters and an emoji key to a box that takes digits (owner, 6 Oct 2026).

## Anatomy

- **Sheet**: a bottom drawer with 16px top corners, a `hairline` over its top edge and `shadow-float`, over `scrim`. A grip, 36px by 4px in `hairline-strong`, stands 8px below the top edge. It rises over `t-drawer` (450ms) on `ease-drawer`, leaves over `t-exit` (200ms), and a pull down closes it.
- **Title**: what is being counted, so the thumb knows what it is answering: the article, the colour, the size ("Kemeja Flanel Pria · Black M"). 15/20 at 500 in `body`. The sheet covers the row that asked, which is why the title says it. A 44px × stands at the right, its 16px glyph in `line-ico`.
- **Figure**: 40/44 at 600, tracked -0.03em, tabular, in `ink`, 16px in from the left. Empty, it is a faint 0 (`mute` at half strength).
- **Keys**: three columns 8px apart; 56px high, radius 16px, `soft-2` fill, the digit 24px at 500, tabular. Delete is the one quiet key: no fill, its glyph in `body`. A whole number has no point key; a field that takes fractions gets ".".
- **Foot**: a `hairline` over a 44px Done in `cta`, full width. Done only puts the pad away.

## How it behaves

- The figure the field held arrives selected, on an `accent-bg` ground, and the first key replaces it, as a picker does: correcting 12 to 18 is two taps, not a backspace and a retype. After that, keys go in at the caret.
- The caret moves like a phone keyboard's: tap the figure to put it between two digits, or hold and slide. A tap right of the figure puts it at the end, left of it at the start. Delete takes the digit to its left.
- The thousands points ("125.000") are drawn, never typed, so the caret only stands between digits.
- Every key writes through at once: the field behind the sheet is already right when the sheet goes away. A pull down or × leaves what was entered.
- No leading zeros: 0 then 5 is 5. `maxLength` is honoured, so a count cannot grow past the field's own limit.
- A key pressed gives `scale(0.96)` over `t-press`, and its fill goes to `hairline`.

## Rules

- Quantities and amounts on a phone are picked. Do not set `keyboard` on a quantity, only on a code.
- The title names the thing counted. The fallback "Enter a number" is for a box that has no label.
- Do not shrink the keys. 56px is the whole point: a thumb, one hand, at the end of a shift.
- Whole numbers are the default; ask for fractions only where the field is decimal.

## Retired

- **The system keyboard for a quantity on a phone.** Use the pad; pass `keyboard` only for a code.
- **A key pressed to 0.96.** Every other press in the kit is `scale(0.97)`. Use 0.97.

## What you provide

| Prop | Type | Notes |
| --- | --- | --- |
| `open`, `onOpenChange` | `boolean`, `(open) => void` | An `Input` opens and closes it for you. |
| `title` | `string` | What is being counted. |
| `value` | `string` | What the field holds now, as the field wrote it. |
| `decimal` | `boolean` | Draws the point key. |
| `maxLength` | `number` | Optional. |
| `onChange` | `(next: string) => void` | Called on every key. |

Source: `frontend-hub/src/components/ui/number-pad.tsx`; opened by `field.tsx` (`Input`, `Money`); `src/lib/number-input.ts`.
