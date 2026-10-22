# Status

A status is a dot and a word that say what state a record is in: draw it with `Status` in a list or on a card and with one `Pill` in a sheet head, always from `statusWord()` and `statusTone()`.

## Pick by place

| Place | Draw it with | Looks |
| --- | --- | --- |
| A list cell, a phone card's foot, a fact in a sheet | `Status` | A 6px dot (`dot`) in the tone's colour, 8px gap, the word in `ink` at 400 (`warn-fg` and `bad-fg` for those two tones) |
| The head of a sheet, 10px right of the title | One `Pill` in `badge` | A 6px dot and the word, both in the tone's `-fg` colour at 500, 7px gap (`dot-gap`), 24px high |

- Neither has an outline, a fill or a radius. A column of statuses reads as words, not as chips. The comments in `pill.tsx` describe an outlined chip with a 30% border; white.css removes it, and the white look wins.
- A finished purchase order has no Pill in its head: its `DocStamp` says it.
- On a phone card the status stands in the foot at the right, the received figure ("Received 0 pcs") at the left.

## The nine words

`STATUS` in `src/lib/words.ts` is the whole vocabulary. Each word has one tone and one meaning.

| Word | Tone | Means |
| --- | --- | --- |
| Active | `ok` | On: master data in use. Marketing's "Live" is Active |
| Inactive | `neutral` | Master data switched off: articles, terms, suppliers, users |
| Cancelled | `bad` | A document ended before it was done: PO, voucher, order |
| Closed | `ok` | Finished and sealed: a period, a count, a return |
| Retired | `neutral` | Assets only |
| Pending | `warn` | An approval waiting for a decision |
| Approved | `ok` | An approval, and only that |
| Rejected | `bad` | An approval, and only that |
| Withdrawn | `neutral` | An approval its maker took back |

## Tones

| Tone | Dot in `Status` | Word in `Status` | Word in `Pill` | Means |
| --- | --- | --- | --- | --- |
| `ok` | `ok` | `ink` | `ok-fg` | Good, done, in use: Active, Approved, Fully received |
| `warn` | `warn` | `warn-fg` | `warn-fg` | Waits on somebody: Pending, Draft, Partially received |
| `bad` | `bad` | `bad-fg` | `bad-fg` | A problem or called off: Cancelled, Rejected, Failed |
| `info` | `info` | `ink` | `info-fg` | In motion and only that: In transit, Issued, Processing |
| `neutral` | `mute` | `ink` | `body` | Off or idle: Inactive, Retired, Withdrawn |

`accent`, `new` and `done` exist on the component; `statusTone()` never returns them. `accent` means selected and is never a state.

## Rules

- The word comes from `statusWord(code)` and the tone from `statusTone(code)`. Never write a word or a tone map on a screen.
- `statusWord()` makes a server code readable (`PARTIALLY_RECEIVED` becomes Partially received) and maps older names onto the nine (Live is Active). `statusTone()` falls back to the retail taxonomy: Paid, Posted, Settled are `ok`; Draft, Awaiting, Low are `warn`; Issued, Shipped, In transit, Processing are `info`; Failed, Void, Out are `bad`; anything else is `neutral`.
- `info` is sky and only means in motion. `accent` means selected. They never swap.
- A sheet head holds exactly one Pill: no second status, no count or version in the badge.
- A missing state is a dash (`EMPTY`), not "n/a" or a blank.
- A category, a code or a type is a `Tag`, not a status.

## Retired

- A second `Pill` in `screens/me/ui/pill.tsx` and `status-pill.tsx`, about 10 local `*Pill` wrappers and about 111 local tone maps. Everything goes through `Pill` (441 uses today) and `Status` (125).
- Local `Status` components: `master/payment-templates.tsx:135` writes Cancelled for an inactive record; `finance-final/sales-postings.tsx:432` prints the server's capitals.
- The words Waiting, Refused, Declined, Taken back, Non-active, Live as a state, Done, and Completed where Closed is meant. Use Pending, Rejected, Withdrawn, Inactive, Active and Closed.
- A coloured word with no dot. The PO list draws Active as a green word while Suppliers draws "● Active"; two neighbours must read alike.
- A `Pill` in a list cell: `master/articles.tsx:239` and `procurement/suppliers.tsx:205` draw their status column as Pills (a coloured word at 500) while People draws `Status`. A list cell is `Status`; the Pill is for the sheet head.

## What you provide

| Prop | Type | Notes |
| --- | --- | --- |
| `tone` | `"ok" \| "warn" \| "bad" \| "info" \| "accent" \| "neutral" \| "new" \| "done"` | Both components. Default `neutral`. From `statusTone(code)` |
| `children` | `ReactNode` | The word, from `statusWord(code)` |
| `className` | `string` | Layout only (`w-fit`); never a colour |
| `withDot` | `boolean` | `Pill` only. Draws a 5px dot element in place of the 6px dot the white look already draws. A few legends use it; leave it out in new code |

Source: `frontend-hub/src/components/ui/pill.tsx` (`Pill`, `Status`), `src/lib/words.ts`; white look in `styles/white.css` (Status: a dot and a word).
