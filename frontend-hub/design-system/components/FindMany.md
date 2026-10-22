# FindMany

FindMany searches a catalogue too large to hold, a typed word at a time, and keeps what is picked as chips in the field.

## Pick by the size of the list

| The list is | Use |
| --- | --- |
| Held by the page: five divisions, a dozen sizes, forty tags | `PickOne` or `PickMany`. See the Pick card |
| Held by the server: five hundred articles, every SKU, the member directory | `FindMany` |
| Several of them | `FindMany` as it stands |
| One of them (the member a voucher belongs to) | `FindMany`, keeping only the last pick, so a second replaces the first |
| Anything in the app, from anywhere | The command palette (⌘K) |

Two screens use it: the promotion's scope in `commercial/rule-form.tsx` (Articles, SKUs) and the voucher's Member in `commercial/vouchers.tsx`.

## Anatomy

- **Field**: the form's box. 40px least, padding 4px 14px, radius 8px (`r-inner`), 1px `hairline-2`, `canvas`, 6px between its parts, wrapping as chips are added. Focus is an `accent` border and `shadow-focus`.
- **Glass**: a 14px search glyph in `line-ico` at the left, then the chips, the input, and a 14px chevron at the far right.
- **Chips**: the `Tag` in its accent tone: 24px, 8px padding, the word at 600 in `accent`, outlined, with a 10px × that goes to `ink` under the pointer. Each is a thing that was found and kept.
- **Asking**: the word is held 200ms after the last key (`useDebounced`), so one question goes out, not six. Nothing is asked under two characters. An answer is kept for a minute and a failed one is not retried.
- **List**: opens 6px under the field, as wide as the field and at least 256px, in the Pick panel: radius 10px, `hairline`, `shadow-pop`, padding 5px, 352px high at most.
- **Row**: two lines. The label in `ink` and under it the note in `mute` ("00000010 · Tas"); at the right the aside in `mute`, tabular ("4 SKUs") and, on a thing already kept, a 14px tick in `accent`. 57px high; 12px between the two halves. The row under the pointer or the keys is `soft-2`.
- **Staying open**: a press toggles that row and the panel stays, with the word still typed, because the second style somebody wants is nearly always in the same answer. The chips are the screen's own `chosen`, not the combobox's.
- **Before an answer**, one centred line in `mute`, 12px above and below: "Two characters is enough to start.", "Searching…", "Nothing matches “kanvs”.", and the screen's `offline` sentence for a route that answers 404 ("Catalogue unavailable."): an endpoint newer than the node is a fact with its own remedy, not an empty search.
- **Motion**: the Pick panel's: scale from 0.95 and fade over `t-pop` (160ms) on `ease-out`.

## Sizes

| Part | Size |
| --- | --- |
| Field | 40px (`field`), 44px under a finger |
| Chip | 24px |
| Row | 57px with its note; 36px without one |
| List | 256px wide at least, 352px high at most |

## Rules

- The server filters. Give `search(needle, signal)` the signal so a slower answer is dropped, and return `value`, `label`, an optional `note` (code, division, colour and size) and an optional `aside` (a count, a price).
- Name the field for what is searched: `label` is its accessible name ("The articles this promotion applies to").
- `offline` says which thing did not answer ("The member directory is not answering."), never "Error".
- Mark a required answer on its `Field`, as every question is marked.
- Do not hold the list in the page and hand it to `FindMany`: that is `PickMany`.

## Retired

- **A 47px box.** Both calls in `commercial/rule-form.tsx` (994, 1025) pass `min-h-[2.9375rem]`, a height from before the form's box was 40px. Take the form's box, as `PickMany` does.
- **A field that does not read its `Field`.** `FindMany` does not use `useFieldAria`, so a `Field` with `required` or a `problem` marks nothing on it: no `aria-invalid`, no `aria-required`, no red border. `PickOne` and `PickMany` do.
- **A radius of its own.** The box asks for `rounded-[1.125rem]` (18px); white.css overrides it to 8px for every `.ui-field`. Drop it.
- **A tick in `accent`** (`find.tsx:202`). A picker's tick is `line-ico`, as in `PickMany`.
- **A line that instructs.** "Two characters is enough to start." tells the buyer what to do. The list can stay shut until the second character.

## What you provide

| Prop | Type | Notes |
| --- | --- | --- |
| `chosen`, `onChange` | `Found[]`, `(next) => void` | What is kept; `onChange` gets the whole set. |
| `queryKey` | `(needle: string) => readonly unknown[]` | The React Query key for one needle, in the caller's own namespace. |
| `search` | `(needle, signal?) => Promise<Found[]>` | The server's answer. |
| `label` | `string` | The accessible name. |
| `offline` | `string` | Said on a 404. |
| `className` | `string` | Layout only. |

`Found`: `value`, `label`, `note?` (the second line) and `aside?` (the right-hand column).

Source: `frontend-hub/src/components/ui/find.tsx`, with `lib/filter-chrome.ts` (`POPUP`, `ITEM`), `tag.tsx` and `lib/use-debounced.ts`; look in `styles/white.css` (Fields).
