# TintButton

A tinted button is a secondary or a destructive action that still looks like something to press: a wash of the accent or of red with a word in the same colour, so it is never a plain coloured word.

## Why it exists

The client does not read a coloured word as an action ("ga suka text yg ga terlihat seperti button", 18 Oct 2026). The people using Pick, Pack and Dispatch are warehouse staff, mostly on tablets, and a blue word looks like a label to them.

So an action is one of three things, and never a word on its own:
- the one solid `primary` of the place: the next step (Submit 24 pcs, Seal & print Koli 1);
- a `TintButton` for everything that supports it or takes something back (Print, All in, Take out, Cannot pick);
- a `ghost` `Button` for the toolbar and page-head supporting actions (Filter, Columns, Export CSV).

`Button` cannot draw the tint. White.css repaints `variant="tint"` as a solid primary and `variant="danger"` as solid red, and a Cancel red whatever it is given, which would make Print as loud as Submit. `TintButton` draws plain `bg-*` and `text-*` classes and carries none of the `btn-*` classes white.css targets, so nothing repaints it.

## Tones

| `tone` | Looks | Use it for | Examples |
| --- | --- | --- | --- |
| `accent` | `accent-bg` fill, `accent` word at 600; `accent` at 15% under the pointer | A supporting action that moves work along or opens something | Print, All in, All picked, Print all, + Add to Koli 1, Done, Put in |
| `bad` | `bad-bg` fill, `bad-fg` word at 600; `bad-fg` at 15% under the pointer | An action that takes something back or calls it off, but is not the place's final act | Cannot pick, Back to Pick, Take out, Unpack, Remove Koli 1, Download PDF |

- Blue goes to the printer, red is a file: the print menu draws Print with `accent` and Download PDF with `bad`.
- A red tint is not a destructive button. The act that cannot be undone (Cancel order, Delete) is still the solid red `destructive` `Button`, and a plain Cancel stays red through `Button`.

## Sizes

| `size` | Height | Padding | Where |
| --- | --- | --- | --- |
| `md` (default) | 36px (`control`) | 14px a side | A strip, a head, a foot, a dialog, a row without a picture's height to match |
| `row` | 38px | 12px a side | The button at the end of a list row that stands beside a 44px picture: Put in, Put on trip |

Under a finger (`pointer: coarse`) both grow to 44px. The pointer decides, not the width. A sheet's foot sets its own buttons to 36px on a desk and 44px on a phone (`.sheet-foot`), whatever the `size`.

## Anatomy

- Radius is `r-inner` (8px). It is never a pill.
- The word is 15px at 600, sentence case, and says what happens.
- The glyph is 18px, given through `icon` and drawn before the word. Give it only for a verb that has its own glyph (Print, Download PDF, Put in).
- Pressed it gives `scale(0.97)` over `t-press` on `ease-out`. Hover is a touch darker, only where hover exists.
- Disabled is 40% opacity and does not take the pointer, where `Button` is 50%.

## Rules

- One solid `primary` per place. The tint stands beside it, before it, and is never the loudest thing on the surface.
- A tint is not a toggle or a selection. A chosen tile or chip is `accent-bg` with an `accent` border; it is not drawn by this component.
- In a sheet foot the `primary` stands last at the right, and the tints before it. A foot that holds a tint and no primary does not promote the tint: it carries `data-support`, which white.css's `.foot-lifted` skips.
- Do not write the classes again. A screen that wants a tinted action uses `TintButton`; a screen that wants a tinted strip, pill or row uses `WASH`.
- Do not pass `Button variant="tint"` or `"danger"` for this. They are retired (see [Button](Button.md)).
- Do not override the height or the radius with a class. Pick a `size`.

## The washes

`WASH` (`components/ui/wash.ts`) is the same family for things that are read, not pressed: a strip across a sheet, a pill beside a store, an article row that differs. It is exported as class strings, `bg-*` and `text-*`, indexed by `WashTone`.

| Tone | Ground | Word | Used for |
| --- | --- | --- | --- |
| `warn` | `#fdf5e8` | `warn-fg` | A strip that needs somebody (MD changed this picklist); a store's Short · MD reviews pill in a trip |
| `bad` | `#fdf0f1` | `bad-fg` | A strip or a pill for a problem (MD cancelled this picklist) |
| `ok` | `#eaf6ee` | `ok-fg` | A pill for something done (a store's Received) |
| `info` | `accent-bg` | `accent` | A pill for something in motion |
| `neutral` | `soft-2` | `body` | A pill with no urgency (a store's In transit) |

- The washes are paler than the `-bg` tokens, which are for meters and charts. They are written as hex because white.css outlines a `span` drawn on the `-bg` tokens (a small tag is outlined, not filled).
- A state in a list is still `Status`, and the state in a sheet's head is still one `Pill`. A wash is for a strip across a sheet or a pill that is part of a card.

## What you provide

| Prop | Type | Notes |
| --- | --- | --- |
| `tone` | `"accent" \| "bad"` | Default `accent`. |
| `size` | `"md" \| "row"` | Default `md`. |
| `icon` | `ReactNode` | A lucide glyph (it is sized to 18px). Left out, the button is a word. |
| `type` | `"button" \| "submit" \| "reset"` | Default `button`. |
| `children` | `ReactNode` | The word. |
| anything a `<button>` takes | | `onClick`, `disabled`, `title`, `className` (for placement such as `ml-auto`), `data-*`. |

Used today in Pick (`picking/picking.tsx`, `pick-lines.tsx`), Pack (`packing/pack-sheet.tsx`, `pack-parts.tsx`), Dispatch (`despatch/trucks.tsx`, `koli-parts.tsx`), the board (`board/board.tsx`) and the print menu (`procurement/print-menu.tsx`).

## Retired

- The local copies this replaced: a `TintButton` in `packing/pack-parts.tsx`, another in `despatch/koli-parts.tsx`, the `TINT` and `TINT_RED` class strings in `board/tints.ts`, and `TINTED`, `TO_PRINTER` and `TO_FILE` in `procurement/print-menu.tsx`. They are deleted.
- The `tint` (35) and `danger` (61) buttons counted on 17 Oct (the board's cards, Finance, the record cards) still reach white.css as a solid primary or solid red. Move one to `TintButton` only when the screen means a tint, and to `primary` or `destructive` when it means those.

Source: `frontend-hub/src/components/ui/tint-button.tsx`, `wash.ts`; the sizes and the hover are its own, and white.css has no rule for it.
