# Button

A button does the record's work in one word: one solid blue primary per surface, neutral ghosts for everything that supports it, and solid red for calling something off.

## Pick the variant by what the press does

| Variant | Looks | Use it for | Examples |
| --- | --- | --- | --- |
| `primary` | `cta` fill, `cta-fg` word at 600, `shadow-primary` | The one thing this page or sheet is for. At most one on a surface. | New order, Save changes, Review Count, Post to the books |
| `ghost` | `canvas` fill, 1px `hairline-2` border, `ink` word at 500 | A supporting action that reads, opens or arranges | Print, Edit (beside a primary), Columns, Filter, Export CSV |
| `quiet` | No fill, no border, `ink` word | A control that must stay out of the way: a menu row's trigger, × in a toolbar | ⋯ More |
| `destructive` | `bad-fg` fill, `on-dark` word at 600 | Calling something off or taking it away for good | Cancel, Cancel order, Close short, Delete, End now |

- A plain **Cancel** is red wherever it is written: `Button` turns a ghost, quiet or unset Cancel into `destructive` by itself. Do not pass a variant to make it red.
- A verb that takes something away (Delete, Remove) reads red even as a ghost (`btn-takes-away`), except a row's bin icon, which stays an `ink` glyph.
- In a sheet foot with no primary, **Edit** is the blue one; beside a primary it is a ghost (`data-support="edit"`).

## Sizes

| `size` | Height | Padding | Where |
| --- | --- | --- | --- |
| `default` | 36px (`control`) | 10px a side; 16px in a sheet foot | Page head, bar, sheet foot |
| `sm` | 28px | 8px | Inside a table row only |
| `card` | 32px (`card-button`), hit area 44px | 14px | The one button at the foot of a record card |
| `lg` | 44px (`tap`) | 16px | A form's own button beside 44px fields (sign-in) |
| `icon` | 36 × 36 | 0 | A glyph with an `aria-label`: × closes, a pencil edits, a bin removes |

Under a finger (`pointer: coarse`) every size grows to 44px. The pointer decides, not the width.

## Rules

- One primary per surface. On a page it stands at the right of the head; in a sheet it stands last in the foot, at the right.
- Every button says what it does, sentence case, verb first: "New order", "Save changes", never "OK", "Submit" for a save, or "Click here".
- A "New …" or "Add …" button carries the plus glyph. Print, Columns, Filter and Export CSV carry their own glyph. Other verbs carry none.
- A button that goes somewhere is an `AppLink` styled with `button()`, never a `<button>` inside an `<a>`.
- Pending writes pass `pending` ("Saving…" as the word): disabled, `aria-busy`, faded less than a dead button. No spinner.
- A landed write may say so in place for a moment with `said` ("Sent to count"), green with a tick.
- Pressed, every button gives `scale(0.97)` over `t-press` on `ease-out`.
- Do not use `soft`, `tint` or `danger`: they are retired. White.css repaints them as ghost, primary and destructive, which hides a second primary in the code. Use `ghost`, `primary` or `destructive`. A tinted look, an accent or red wash that still reads as a button, is [TintButton](TintButton.md); `Button` cannot draw it.
- Do not override the height with a class (`h-11`, `h-12`); pick a `size`.

## What you provide

| Prop | Type | Notes |
| --- | --- | --- |
| `variant` | `"primary" \| "ghost" \| "quiet" \| "destructive"` | Default `ghost`. |
| `size` | `"default" \| "sm" \| "card" \| "lg" \| "icon"` | Default `default`. |
| `pending` | `boolean` | The write is on its way. |
| `said` | `string \| null` | The write landed; shown in place, green. |
| `word` | `string` | The word an icon-only button would show; read off `aria-label` when left out. |
| `aria-label` | `string` | Required on an icon-only button. |
| `children` | `ReactNode` | A lucide glyph (16px) and the word. |

Source: `frontend-hub/src/components/ui/button.tsx`, `button-style.ts`; white look in `styles/white.css` (Buttons).
