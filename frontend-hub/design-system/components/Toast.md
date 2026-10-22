# Toast

A toast says in one line, at the bottom left, that a write landed or failed on a screen that did not change, and it goes after five seconds.

## When to use it

| Job | Use |
| --- | --- |
| A save landed and the screen already shows the result | `toast.success("PO-161026-010 created", { description, action })` |
| A write failed and there is no form to say it in | `toast.error(error.message)`: the server's own sentence |
| A quiet fact with no tone | `toast("Picklist changed by MD")`: no icon |
| An announcement with a next step | `toast(title, { description, action: { label: "Open" } })` |
| A form's failed write | `Problem` above the foot, not a toast |
| A page that failed to load, or has nothing in it | `ErrorState`, `EmptyState` or a `Banner` |
| A save that mints a number, such as a PO number | The button's `said`, a pill pulled into the row, then a toast: never a dialog that covers the list |

## Anatomy

- **Box**: `canvas`, 1px `hairline`, radius 10px (`r-card`), padding 12px 14px, `shadow-pop`. 356px wide, 10px between two toasts.
- **Icon**: 16px, 10px before the words, in its tone: `ok-fg` success, `bad-fg` error, `warn-fg` warning, `info-fg` info. A plain `toast()` has no icon.
- **Title**: 15px at 500 in `ink`.
- **Description**: 15px in `body`, 2px under the title. For the thing that was made: "Garmen Nusantara, PT · Rp 2.040.000".
- **Action**: a round `dark` pill at the right, 15px at 500 with an `on-dark` word, padding 4px 10px, aligned with the title. It is drift from the button rules: every other button is a blue or ghost 8px-radius rectangle. Say so; do not copy the pill anywhere else.

## Where and for how long

- Bottom left, 20px off the window (owner, 16 Oct 2026), so it stays clear of a sheet's foot buttons at the bottom right.
- On a phone it rises above the tab bar (68px plus the home-bar inset) with 12px at each side.
- Five seconds. A pointer resting on it holds it. A toast with an Undo is held longer: 8 to 10 seconds in the app today.
- Sonner draws the entrance and the swipe away; the kit adds no motion of its own.

## Rules

- Write what happened, in the past tense. The button says what it will do ("Send to count"); the toast says that it did ("Sent to count").
- Lead with the name or number: "PO-161026-010 created", "Count sent · 3 lines". Join a second fact with a middle dot.
- One line. A description only for what was made.
- An error says what went wrong in the server's words and may end with what to do: "The orders could not be read. Try again."
- One action at most, one verb: "View", "Undo", "Open".
- Import `toast` from `@/lib/toast`, never from `sonner`. `<Toasts />` is mounted once, in the app.
- A toast confirms an action that did not change the screen. A failure of the page belongs in a banner or an empty state.

## Retired

- **The receipt as a centred dialog** for a PO, a supplier or a count. The button says it in place, a pill is pulled into the row, and this toast keeps the number on screen. The comment in `lib/toast.ts` that calls it a `SavedDialog` is out of date.
- **A `position` per call.** The two quick-fill toasts in `allotment/matrix.tsx` still pass `top-center` because "bottom-right sits over the Submit buttons". The corner is bottom left now; drop the override.
- **A toast for a form's failed write.** Nine `onError: … toast.error(error.message)` handlers exist today. Where the write started in a sheet's foot, say it there with `error`.
- **A banner that stays** to say that a save landed.

## What you provide

| Call | Notes |
| --- | --- |
| `toast.success(title, options?)` | Green tick. |
| `toast.error(title, options?)` | Red. |
| `toast.warning(title, options?)` | `warn-fg`. One use today. |
| `toast.info(title, options?)` | `info-fg`. Not used by a screen yet. |
| `toast(title, options?)` | Neutral, no icon. |

`options`: `description` (`ReactNode`), `action` (`{ label, onClick }`), `duration` (ms; 5000 by default), `id` (a repeat replaces the toast with the same id).

`<Toasts />` sets the corner (`bottom-left`), `offset` 20, `gap` 10, `duration` 5000 and the phone offset once for the app.

Source: `frontend-hub/src/components/ui/toast.tsx`, `src/lib/toast.ts`, `src/lib/pull-in.ts`; Sonner 2.0.8.
