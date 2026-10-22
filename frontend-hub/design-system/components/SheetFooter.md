# SheetFooter

The foot of a sheet holds every verb of the record, all at the right: Print, then a red Cancel, then ONE solid primary.

## Pick the foot by the sheet's mode

| Mode | Left to right | Example |
| --- | --- | --- |
| Read, nothing waiting | Print · Edit | A supplier. Edit is the one blue button. |
| Editing a record, or a form | Cancel (red) · Save changes | Edit purchase order |
| A document with a next step | Print · Cancel order (red) · Review Count | A PO with a count waiting |
| A flow, one verb per status | The one verb | A count: Start counting, Send to review, Approve |
| An approval that can be refused | Reject (red, `danger`) · Approve | |
| A reader who cannot act | Close, a ghost, and no primary | The asset register |

- The `Sheet` draws the band: a `hairline` over it, at least 64px tall, padded 12px 28px, 36px buttons (`control`), 44px (`tap`) on a phone, clear of the home bar.
- `SheetFooter` draws what stands in it, the same on every width. Buttons wrap onto a second line when the foot is narrow, still at the right.

## Anatomy

```
banner   The server could not be reached.                 only after a failed write
note     A name, legal form, address and phone number are needed.
                                        Print   Cancel order   Review Count
```

- **Banner**: `error` puts the server's sentence in a red banner above everything else. It draws nothing when there is no error.
- **Note**: one line above the buttons, 15/20 in `mute`. It says why the primary is off. It wraps, because a refusal that is cut off is not read.
- **Buttons**, in this order: Print · `start` · `danger` · Cancel · `secondary` · the primary.

## Variants of one button

| Button | Looks | Notes |
| --- | --- | --- |
| Print | Ghost with the printer glyph, 16px | First of the verbs, never in the head. |
| Cancel | `destructive`: `bad-fg` fill, `on-dark` word at 600 | Leaves without writing. Asked for with `onCancel`; left out, there is none. |
| Close | Ghost | `cancelLabel="Close"` for a reader who cannot act. |
| The primary | `cta` fill, `cta-fg` word at 600, `shadow-primary` | ONE. A ready-made button, or described by `primary`. |
| Edit | Ghost with `data-support="edit"` | With no primary beside it, `white.css` makes it blue; beside one it stays a ghost. |
| Danger | `ConfirmButton` | For what cannot be walked back: Close Short, Reject. |

## Rules

- One primary, last. Its word is the act's own: "Save changes", "Review Count", "Approve". Never "Submit" for a save.
- While the write is on its way the same verb becomes a participle: "Saving changes…". The kit turns known verbs over (`pendingLabel`); for another, pass `pendingLabel`. There is no spinner.
- After the write lands the primary can say so in place for a moment, green with a tick (`said`: "Sent to count").
- A disabled primary always has a `note` saying why, in words. Never a tooltip.
- `noteTone="bad"` only once somebody has pressed the primary and it was refused; `warn` for something to read first. The default is `mute`.
- A failed write is `error`, above the foot, not a toast.
- Print stands first of the buttons, and every button stands at the right. Nothing is pushed to the left.
- Pass the foot as the sheet's `footer`. Do not hand-draw a foot, and do not put the primary in the body.

## Retired

- **Hand-made feet.** Only 45 files use `SheetFooter`; 69 feet are hand-made `div`s and 9 are custom components. Use `SheetFooter`.
- **A primary in the body (`SubmitRow`).** 28 sheets put it there and also get the automatic Close foot under it: two feet. Move the primary into `SheetFooter`.
- **A sheet with no footer.** The kit gives it a ghost "Close" foot (the head and the foot are always there); pass a real one.
- **The kit notes that put `danger`, `start` and Print "on the left"** are out of date. Every foot button stands at the right (owner, 15 Oct 2026), and Print comes first of them. The note that `FootNote` is 14px is out of date too: it is 15px.
- **A Submit that saves.** 36 buttons say Submit. A save says Save or Save changes.
- **Quiet or tinted Cancel.** Cancel is solid red wherever it is written.
- **The `danger` variant.** `primary.tone="danger"` draws through the retired `danger` button variant, which `white.css` repaints as `destructive`. Say `destructive`.

## What you provide

| Prop | Type | Notes |
| --- | --- | --- |
| `primary` | `FooterAction \| ReactElement` | `{ label, onClick, pending?, pendingLabel?, said?, disabled?, tone? }`, or a ready-made button. `tone="danger"` makes the one verb red. |
| `onCancel` | `() => void` | Draws Cancel in red. |
| `cancelLabel` | `ReactNode` | Default `Cancel`. Any other word draws a ghost. |
| `onPrint` | `() => void` | Draws Print first. |
| `secondary` | `ReactNode` | Another verb between Cancel and the primary, such as Edit. |
| `danger` | `ReactNode` | A `ConfirmButton`. |
| `start` | `ReactNode` | Anything else, before `danger`. |
| `note` | `ReactNode` | Why the primary is off, or what the act will do. |
| `noteTone` | `"mute" \| "warn" \| "bad"` | Default `mute`. `bad` is announced as an alert. |
| `error` | `unknown` | The failed write; the server's sentence is shown. |
| `className` | `string` | |

`FootNote` is exported on its own for a body that needs the same quiet line.

Source: `frontend-hub/src/components/ui/sheet-footer.tsx`, `button.tsx`, `pending-label.ts`, `states.tsx` (`Problem`); look in `styles/white.css` (Sheets, `.sheet-foot`).
