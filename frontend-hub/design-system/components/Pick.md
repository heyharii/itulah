# Pick

Pick chooses one value or several out of a vocabulary by typing at it: a field that opens its list under it on a desk and as a bottom sheet on a phone, with a search inside and a tick on what is chosen.

## Pick the control by the list

| The list is | Use | Notes |
| --- | --- | --- |
| A handful of fixed options (payment terms, a unit) | `Select` | See the Field card. The same panel and rows, but it opens over its trigger. |
| A vocabulary the page already holds: five divisions, forty tags, the suppliers | `PickOne` (one, or none) or `PickMany` (several, held as chips) | Typed at, so nobody scrolls a hundred rows. |
| A catalogue the server holds: articles, SKUs, members | `FindMany` | See the FindMany card. |
| One of a few options that each need a sentence | `Choices` | See the Switch card. |
| Narrowing a list | A `FilterPanel` facet | Never a row of `PickOne` boxes in the bar. |

## Anatomy on a desk

- **Field**: the form's box. 40px (`field`; 44px under a finger), padding 4px 14px, radius 8px (`r-inner`), 1px `hairline-2`, `canvas`. `PickMany` grows a row at a time as its chips wrap. Focus is an `accent` border and `shadow-focus`.
- **Value**: `PickOne` writes the chosen word in `ink` in the box. The box is the search: while the list is open it holds what is being typed, and the list starts from the whole vocabulary rather than the chosen word. An empty box shows its placeholder in `mute`: a toolbar repeats the label there, a form leaves it out.
- **Clear ×**: a 12px glyph in `line-ico`, drawn only while something is chosen. A required answer and a locked box have none. `null` stays reachable on purpose: "Unclassified" is an answer.
- **Chips** (`PickMany`): the `Tag` (24px, 8px padding, 600, outlined) with a 10px × of its own. `leading` puts a mark before each word and each row: a 12px swatch for colour, which is recognised and not read.
- **List**: opens 6px under the field, as wide as the field and at least 208px. Radius 10px (`r-card`), 1px `hairline`, `shadow-pop`, 5px padding, 352px high at most, then it scrolls.
- **Row**: 36px, 8px a side, radius 8px, 15px in `ink`. The row under the pointer or the arrow keys is `soft-2`. A chosen row ends in a 14px tick in `line-ico`. A row is never filled solid and never changes colour for being chosen.
- **First match lit**: typing lights the first match, so Enter takes it. `PickOne` closes on a pick. `PickMany` stays open and clears the query, so the next word is one keystroke away.
- **Empty**: "Nothing matches." centred in `mute`, 12px above and below. While the vocabulary is on its way, `loading` says it in the same place ("Loading colours…").
- **Way out**: `action` is the last row, under a hairline: a 14px plus in `line-ico` and a verb at 500, "New supplier". It stands inside the list, not beside the field: "it is not here" is found while reading the list, and the row survives a search that matches nothing.
- **Motion**: the list scales from 0.95 and fades over `t-pop` (160ms) on `ease-out`, from the point nearest the field, and leaves the same way. Reduced motion keeps the fade.

## On a phone

Under 48rem (the width of the page alone, so a phone-sized window on a desk counts) every picker opens `PickerSheet`. The field becomes a button whose whole box is the target, and its chips lose their ×.

- **Sheet**: up from the bottom edge, radius 16px (`r-sheet`) on its top corners, a `hairline` over it, `shadow-float`, at most 85% of the window and never lower than the keyboard. A 36 × 4 grip in `hairline-strong`, then the title at 16px/600 in `ink`: the field's own label.
- **Search**: 44px, radius 8px, 1px `hairline`, a 16px glass in `line-ico`. `PickOne` and `PickMany` always have one, because a vocabulary grows; `Select` has one only above 8 options. Enter takes the first match, and a press on a row keeps the keyboard up, so one tap chooses.
- **Rows**: 48px, 12px a side, radius 8px; the chosen row is 500. One answer: a 16px tick in `accent` at the right, and the sheet closes. Several: a 20px box at the left (`hairline-strong`; `accent` with a white tick when on), and the sheet stays until **Done**, 44px at the head's right, 600 in `accent`.
- **Way out**: the same row at 48px under a hairline.
- **Motion**: rises over `t-drawer` (450ms) on `ease-drawer`, leaves over `t-exit` (200ms), and swipes down to close.
- `BottomSheet` is the one shell for everything chosen from the bottom: this list, a month in `Day`, the filter sheet, the dock's search (`live`: no veil, the page keeps working). `MorphHeight` swaps pages inside one sheet while its height travels over 300ms on `ease-drawer`.

## Sizes

| Part | Desk | Phone |
| --- | --- | --- |
| Field | 40px | 44px |
| Row | 36px | 48px |
| Search | the field itself | 44px |
| Clear ×, hit area | 16px | 36px |

## Rules

- A word out of a list somebody can type at is a Pick; a handful of options is a `Select`. Never a native `<select>`.
- Inside a `Field` the field owns the label, the asterisk and the red line. Outside one (a table cell) pass `invalid` and `required` yourself.
- Give every Pick a `label`: it is the control's name, and the phone sheet's title.
- A way out says "New supplier": New makes a record.
- Chosen is a tick, never a fill. The pointer is a `soft-2` row.
- A required answer cannot be cleared from the control that is asking for it.

## Retired

- **Picks as filters in the bar.** `master/articles.tsx:984` draws Division, Tag, Color and Size as four 34px, 128px boxes in the bar. A filter is a `FilterPanel` facet.
- **Four ticks.** The pickers tick at the right in `line-ico` (`Select`, `PickOne`, `PickMany`). `FindMany` ticks at the right in `accent` (`find.tsx:202`). The menus tick at the left in `accent`, and `OperatorMenu` at the left in `ink`. A picker uses the first.
- **A red border that does not draw on a desk.** `PickOne` and `PickMany` ask for `border-bad`, but the `.ui-field` border rule in white.css (lines 484–486) outranks it, so only the sentence under the box shows. A `Select` does turn red.
- **"Create a new supplier"** (`procurement/composer.tsx:2328`): create verbs are New. Say "New supplier".
- **Stale comments.** The one above `FIELD` describes a grey `soft-2` field with no border, and `FORM_BOX` a 44px box with a 10px corner. The box is white with a `hairline-2` border, 40px and 8px.
- **A see-through sheet.** `BottomSheet tone="dark"` (`shell/app-sheet.tsx`, a department's screens on a phone) asks for `bg-rail`, and `--rail` is `transparent` in the white look: the sheet and its edge draw nothing. Use the default tone.
- **A radius of its own.** The phone's check box is `rounded-[0.3125rem]` (5px); `Checkbox` is 4px.

## What you provide

| Component | Prop | Notes |
| --- | --- | --- |
| `PickOne` | `choices` | `{ value, label }[]`. Searched on both. |
| | `value`, `onChange` | `string \| null`; `onChange(value \| null)`. |
| | `label`, `placeholder` | The accessible name; what the empty box says. |
| | `action` | `{ label, onSelect }`: the way out, last in the list. |
| | `disabled`, `invalid`, `required` | `required` takes the × away. |
| `PickMany` | `choices`, `values`, `onChange` | `onChange(values)` gets the whole set. |
| | `label`, `leading`, `loading` | `leading(value)` draws a mark before each word; `loading` replaces "Nothing matches.". |
| | `disabled`, `invalid`, `required` | |
| `PickerSheet` | `open`, `onOpenChange`, `title` | `title` is read aloud as the dialog's name. |
| | `options`, `selected`, `onPick` | `{ value, label, text?, disabled?, leading? }`; `selected` is the values chosen. |
| | `multiple`, `searchable`, `action` | `multiple` adds the boxes and Done; `searchable` defaults to more than 8 options. |
| `BottomSheet` | `open`, `onOpenChange`, `title`, `children` | The shell. |
| | `action`, `onBack`, `icon`, `live` | `action` stands at the title's right. Leave `tone` at its default (see Retired). |
| `MorphHeight` | `page`, `back`, `children` | Changing `page` plays the swap; `back` slides the new page in from the left. |

Source: `frontend-hub/src/components/ui/pick.tsx`, `picker-sheet.tsx`; the list's chrome in `lib/filter-chrome.ts` (`POPUP`, `ITEM`); the box in `field-state.ts`; look in `styles/white.css` (Fields).
