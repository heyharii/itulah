# DocStamp

A DocStamp presses a finished document's state over its corner like a rubber date stamp, the word over the day it was reached: use it on a finished document and never on an open one.

## Anatomy

- The word: 18px on 24px at 700, centred, in `ok-fg`, `bad-fg`, `warn-fg` or `mute`. It is the one bold word on a screen; 700 is the source's own.
- The day under it: 15px on 20px, tabular, from `dayMonth()` ("17 Oct", no year). Left out when the document has no day.
- An optional note under the day: 15px at 500, at most 224px wide, in the stamp's own ink. A cancel's reason.
- The box: a 3px double rule in the word's colour, radius 6px, padding 2px 10px, turned -6deg (-12deg under 1024px), 85% opaque and multiplied into the paper so a figure under it still reads.
- Place: laid over the document, not given a row. `top 0`, `right 8px`, `z-index` 10 in a `relative` parent, `aria-hidden`, never takes a click.
- In a list row the same stamp stands in the Status cell as the `STAMP` class (`procurement/shared.ts`) at 15px on 20px.

Sentence case. `STAMP` still carries `uppercase` and 0.06em tracking, and white.css cancels both, so the word reads "Fully received", not "FULLY RECEIVED".

## Motion

- Pressed in front of you, it lands: when a change you just made (Cancel, Close short, Accept) finishes the document, the stamp falls from 1.2 onto the paper on `spring` over `t-spring`, and its ink fades in over `t-pop`. The spring's dip under 1 is the rubber giving.
- Everywhere else it stands still: a document opened already finished, a poll redrawing it, a list row. Opening finished documents happens many times a day; the press is news once.
- "Just now" is a change of this tab's that succeeded in the last 8 seconds (`pressedJustNow`), decided once when the stamp appears. A change that runs by itself and finishes nothing (the Operations sign-in, seeing MD's changes) carries `meta: { finishesNothing: true }` and does not count. Reduced motion keeps the fade and drops the fall.
- The class is `stamp-land` in `styles/index.css`. Never animate the `STAMP` class on rows.

## Tones

| `tone` | Word colour | Used for | Words today |
| --- | --- | --- | --- |
| `ok` | `ok-fg` | Finished as planned | Fully received, Received, Completed |
| `bad` | `bad-fg` | Finished short | Closed short |
| `mute` | `mute` | Called off | Cancelled |
| `warn` | `warn-fg` | No screen uses it yet | |

## Rules

- A stamp says a state that was reached: a finished or called-off document. An open document has no stamp and keeps its status word.
- A stamped document's head has no Pill; the stamp is its status. A finished purchase order shows no badge beside its title.
- One stamp for one document, at its top right corner.
- The word comes from the document's own state (`Fully received`, `Closed short`, `Cancelled`); the day is the last thing that happened to it, the last receipt or change.
- Where it stands in a head's row instead of over the body (the receiving read-back), pass `className="static mr-2 shrink-0"`.
- Never type a stamp by hand: no bold capitals, no new rotation.

## Retired

- Hand-made stamps, bold and uppercase: `operations/board/stage-table.tsx:559` ("CANCELLED"), `operations/board/parts.tsx:693`, `procurement/purchase-orders.tsx:3071` ("RETURNED"). Use `DocStamp`.
- A cancelled allotment drawn as a Pill (`allotment/allotments.tsx:1760`). It is a finished document: use `DocStamp`.
- Only 4 files use `DocStamp` today (`trucks`, `supplier-returns`, `count-review`, `purchase-orders`); seven screen files press the raw `STAMP` class on rows.

## What you provide

| Prop | Type | Notes |
| --- | --- | --- |
| `word` | `string` | The state, in sentence case. |
| `at` | `string \| null \| undefined` | The day it was reached. Required; `null` leaves the day out. |
| `tone` | `"ok" \| "warn" \| "bad" \| "mute"` | The word and the rule's colour. |
| `note` | `string \| null` | A short line in the stamp's ink. |
| `className` | `string` | Position only. |

Source: `frontend-hub/src/components/ui/doc-stamp.tsx`, `STAMP` in `src/screens/procurement/shared.ts`; white look in `styles/white.css` (sentence case: no uppercase).
