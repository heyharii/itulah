# ErrorState

An error says what went wrong in the server's own words, in the place where it happened, and offers Try again; it never invents a code.

## Pick by what failed

| What failed | Use | Where it shows |
| --- | --- | --- |
| A read: the list or the page would not load | `ErrorState`, through `queryState` | Centred, in place of the data |
| A read inside a sheet | `SheetError` | A red banner at the left, where the record would be |
| A refresh over data already on screen | A `warn` banner from `queryState` | Above the rows, which stay: "Couldn't refresh — showing what loaded at 10:48." |
| A write | `Problem` | Under the form, or above the foot (`SheetFooter error`) |
| Refused, not failed | `NoAccessState` | The empty block, in words |
| A list cut off by a limit | `Truncated` | A `warn` banner above the list |
| A fact that sits on the page | `Banner` in `info`, `warn` or `ok` | Above the content |

## Anatomy

- **ErrorState**: centred, at most 28em wide, padding 56px 16px, 12px between its parts. The sentence is 15px in `bad`; under it a ghost "Try again" at 36px, only when there is something to retry. No picture, no icon, no code.
- **Banner**: radius 8px, padding 10px 14px, 15px with relaxed leading (1.625), no border and no icon. The wash and the words come in a pair: `bad-bg` with `bad-fg`, `warn-bg` with `warn-fg`, `info-bg` with `info-fg`, `ok-bg` with `ok-fg`. The default tone is `info`. An optional "Dismiss" stands at the right, underlined.
- **Try again inside a banner** is a word, not a button: underlined, at 500, in the banner's own colour, at the end of the sentence.
- **NoAccessState** is the `EmptyState` block with a fixed text: "You do not have access to {what}. This is about permission, not about the data being absent." and, when the role's reach is known, a line saying what it does cover.
- **Truncated** is blunt on purpose: it says the figures below are not totals.

## Rules

- Quote the server's sentence when there is one (`problemOf`). When there is none, the sentence is "The server could not be reached." Never invent a code or a retry countdown.
- An error is `bad`. Never `warn`, never `accent`. A `warn` banner is for something stale, cut off or waiting, not for a failure.
- Say what went wrong first and what to do in the same breath: "The Excel file could not be written." Try again is a button or a word, never a second sentence.
- A refusal is not a failure. A 403 does not get Try again: pass `queryState` a `refused` block, written by the screen, because only it knows what was being asked for.
- Say it where it happened. A failed write is under its form; a failed read is where the data would be. Not a toast, and not a banner at the other end of the page.
- `Problem` draws nothing when there is no error, so put it under any form unconditionally.
- Keep the rows. A background refresh that fails over data already on screen never turns the table into an error page.

## Retired

- **Read errors drawn at the top, at the bottom, or not at all** (6 Oct 2026 audit). There is one place for each kind, above.
- **A toast for a failed write.** Nine `onError: … toast.error(error.message)` handlers exist today. Where the write started in a sheet's foot, use `error` on `SheetFooter`.
- **The second sentence in `NoAccessState`.** "This is about permission, not about the data being absent." explains what the first already said, and the house rule is no helper sentences. Keep "You do not have access to the journal." and the one line of `reach`.
- **`ErrorState` for a refusal.** It offers a Try again that will never work.
- **A local error colour or box.** Use `Banner` and the tone pairs above.

## What you provide

| Part | Props | Notes |
| --- | --- | --- |
| `ErrorState` | `error`, `onRetry?` | `error` may be an `ApiError`, an `Error` or anything. |
| `Problem` | `error`, `className?` | A failed write. Renders nothing for `null`. |
| `Banner` | `tone` (`ok` \| `warn` \| `bad` \| `info`), `onDismiss?`, `className?`, `children` | Default `info`. |
| `NoAccessState` | `what`, `reach?` | `what` completes "You do not have access to …". |
| `Truncated` | `limit`, `noun`, `total?`, `className?` | `total` is `null` when the count was not asked for; it is drawn as "—", never 0. |
| `SheetError` | `error`, `onRetry?`, `className?` | Banner `bad` with the server's sentence and Try again. |

Source: `frontend-hub/src/components/ui/states.tsx`, `sheet-states.tsx`, `src/lib/problem.ts`, `src/lib/query-state.tsx`.
