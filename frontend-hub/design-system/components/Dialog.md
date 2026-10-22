# Dialog

A dialog asks one question in a small centred card before something that cannot be taken back; it is never a form, and a form is always a sheet.

## When to use it

| Job | Use |
| --- | --- |
| A yes/no before an act that cannot be undone: cancel an order, close short, end a campaign, delete | `ConfirmButton` (the button with its dialog), or `Dialog` when something else opens it |
| The same, when the server wants a reason | The same, with `reason`: one textarea, optional or required |
| Typed work is about to be thrown away | `dirty` on the sheet (`useDirtyGuard`): "Discard your changes?" |
| A receipt for a flow whose screen does not change under it | `SavedDialog`: "Company saved", "Picklist accepted" |
| A PO, a supplier or a count was saved | The button's `said`, a pill pulled into the row, then a `Toast` |
| A form, a list, a working surface | A `Sheet` |

## Anatomy

- **Card**: 384px wide, never wider than the window less 32px, centred. `size="wide"` is 900px with the body scrolling under a pinned foot (a hairline over it), for the one question whose answer must show in lines what it will do: Return & reallot (owner, 18 Oct 2026). Never for a form. Padding 20px, radius 10px (`r-card`), 1px `hairline-2`, `shadow-float`. It floats on `scrim` with a 2px blur, drawn even over a sheet, so the sheet behind it is not left sharp.
- **Title**: the question in sentence case, 16px at 600 (`card-name`): "Close short PO-161026-010?".
- **Sentence**: what will happen, in one or two sentences, 15px in `body`, 8px under the title: "40 pcs will be removed from the order, and the PO completes as received. This can't be undone." Left out when the title already says it all.
- **Reason**: optional. A `Field` 16px under the sentence with a three-row textarea that takes focus. The label is "Reason" unless the question needs another word ("Reason for closing"). When it is required the label carries the `bad` asterisk and the act stays off while the box is blank.
- **Problem**: a write that failed, as a red banner under the question and 16px above the foot. The dialog stays open.
- **Foot**: 20px under, at the right, 8px between two buttons of 36px. On a phone the two are 44px and share the width.

## The foot

| The act | Cancel | The act's button |
| --- | --- | --- |
| Irreversible (`tone="danger"`) | Blue, `primary` | Red, `destructive` |
| Anything else | The plain word "Cancel" is solid red wherever it is written; any other word stays quiet | Blue, `primary` |

- Beside a red act the way out is the blue one, so the two never wear the same red (owner, 16 Oct 2026). A custom word for the way out reads as the answer, not as the act: "Keep order", "Keep editing".
- The act repeats the verb of the button that asked: "Cancel order" asks "Cancel PO-161026-010?" and the act is "Cancel order". While the write is on its way it says the participle ("Cancelling order…") and is disabled.

## SavedDialog

A receipt, said in the middle of the screen and then gone.

- 416px wide, padding 28px. A 56px circle in `ok-bg` holds a 28px tick in `ok-fg`. The receipt is set in `lead-figure` (24/30, 600, tabular): "Picklist accepted". One 16px line in `body` may follow for the total or the next step.
- It has no OK button. It closes itself after 3 seconds, or 5 when it carries an undo. A pointer resting on it holds the count, and Esc still closes it. A 112px by 4px bar (`soft-2` track, `ok-fg` at 50%) empties to show the wait; reduced motion does not draw it.
- `action` adds a ghost verb under the receipt ("View rollout"). `undo` adds a red 44px button whose fill empties with the time left; it says "Cancelling…" while it runs.

## Motion

The card scales in from 0.96 with opacity over `t-panel` (200ms) on `ease-out`, and leaves the same way. Reduced motion keeps the fade and drops the scale. On a phone the question is a drawer from the bottom (`PhoneDrawer`), made of the same parts.

## Rules

- Ask one question. Say what will happen in the sentence. Never "Are you sure?" and never a warning triangle.
- `ConfirmButton`: return the write's promise from `onConfirm` (`mutateAsync`). The dialog then stays open and pending until it settles, closes on success and says why under the question on failure. Return nothing and it closes at once.
- A dialog is local state. Nobody links to it and a refresh closes it.
- Hold the act back with `ready={false}` until the body has what it needs; a missing required reason does the same.
- No fields beyond one `reason`. Anything with more is a sheet.

## Retired

- **A centred `Panel` as a form.** `Panel` (a card 832px or 1152px wide, with a head and a scrolling body) was written for a working surface such as the print queue. Used as a form it is retired: `finance-lab-2/cash-counts.tsx:356`, `bank-reconciliation.tsx:639`, `bank-accounts.tsx:275`. Use a `Sheet`.
- **Title Case in the words.** "Close This Short?", "Keep Order", "Cancel Order" and "Reason for Cancelling" (`procurement/purchase-orders.tsx`, `held-orders.tsx`) are sentence case in this system.
- **A dark backdrop.** `components/operations/outbound-papers.tsx:99` draws `bg-ink/55`. Nothing darkens: use `scrim`.
- **`window.confirm`** and an unsaid "Are you sure?".
- **The `danger` variant.** The dialog's act and `ConfirmButton`'s trigger pass the retired `danger` variant, which `white.css` repaints as `destructive`. Say `destructive`.
- **The kit comment** that gives the foot as "[Cancel, quiet] [the act]" is out of date, and so is the one in `lib/toast.ts` that says a PO receipt is a `SavedDialog`.
- `Dialog` itself is fine: its 14 direct uses are all confirmations.

## What you provide

`Dialog`

| Prop | Type | Notes |
| --- | --- | --- |
| `open`, `onOpenChange` | `boolean`, `(open) => void` | |
| `title` | `ReactNode` | The question. |
| `children` | `ReactNode` | What the act will do. |
| `confirm` | `ReactNode` | The act's verb. |
| `cancel` | `ReactNode` | Default `Cancel`. |
| `tone` | `"primary" \| "danger"` | `danger` for anything that cannot be walked back. |
| `pending` | `boolean` | The act's word becomes its participle. |
| `reason` | `{ label?, hint?, optional? }` | Required unless `optional`. |
| `problem` | `unknown` | A failed write, said under the question. |
| `ready` | `boolean` | `false` holds the act back. |
| `onConfirm` | `(reason: string) => void` | |

`ConfirmButton` takes `label`, `title`, `description`, `confirmLabel` (default `label`), `cancelLabel`, `tone`, `variant`, `size`, `disabled`, `pending`, `reason` and `onConfirm` (return a promise), and draws its own trigger: ghost, or red for `tone="danger"`.

`SavedDialog` takes `open`, `onOpenChange`, `title`, `children` (one line), `action` (`{ label, onClick }`) and `undo` (`{ label, onClick }`).

Source: `frontend-hub/src/components/ui/dialog.tsx` (`Dialog`, `ConfirmButton`, `SavedDialog`, `Panel`), `dirty-guard.tsx`, `button.tsx`, `phone-drawer.tsx`.
