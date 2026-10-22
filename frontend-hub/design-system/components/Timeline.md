# Timeline

Timeline shows where a record has been and where it is going: the lifecycle ribbon at the head of a sheet's body, the steps of a flow, and the record's Activity, folded shut at the foot.

## Pick by job

| You are showing | Use |
| --- | --- |
| Where the record stands in a fixed run of states (Issued, Receiving, Closed) | `Lifecycle`, one ribbon at the top of the body |
| The stages of one document, with who and when | `Timeline`: numbered nodes down a line |
| Who did what to the record | Activity at the foot of the sheet: `Sheet` draws it from `subject`; `ActivityFold` holds a trail the screen builds itself |

The status itself is not a timeline. It is one `Status` in the sheet head.

## Anatomy

| Part | Drawn as |
| --- | --- |
| Timeline node | A 25px tile, radius 7, its number or icon at 600. Done: `ok-bg` with `ok-fg`. Current: solid `info` with white, because it is in motion. Not reached: `soft-2` with `body`. |
| Timeline line | 1.5px in `hairline-2`, from node to node, and none after the last. |
| Timeline text | The title at 500 in `ink` (`mute` for a step not reached), its detail lines in `mute`, the moment at the right in `body`, tabular. |
| Lifecycle step | A 17px circle and the word at 600. Done: `ok-bg` circle with a tick, the word in `text`. Current: an `ink` circle with its number in white, the word in `ink`. Not reached: `soft-2` with a `faint` number, the word in `mute`. |
| Lifecycle line | 2px between steps: `ok` after a step that is done, `hairline` after the rest. The one dark mark in the row is the current step: a position on a track, not something to press. |
| Activity entry | A name, then what was done, then the moment. The name is the person's full name at 500 in `ink`; the act follows in `body` ("counted 24 pcs of Kemeja Flanel Kotak", "approved this order"); the moment, "16 Oct 2026, 14:28", stands under it in `mute`, tabular. |
| Activity dot | 11px, a 2px `canvas` ring, `ok` for a write that landed and `bad` for one that was refused. A 1px `hairline-2` line joins the dots. A refused entry adds "— the request was refused" in `bad`. |
| Activity fold | One line, "Activity (3)": 15px at 500 in `body`, the count at 400 in `mute`, a chevron in `line-ico` that turns a quarter as it opens. A hairline over it. The trail opens in place under it, newest first. |

## Rules

- Activity comes once in a sheet, last, and closed. It is not a tab and it is not a second block.
- It is called Activity, never History.
- The sheet reads the trail when it opens and again every 15s while it is up. The fold only draws what is there, so a closed line already says how many.
- The trail records writes only, refusals included, and never the request body. Do not write who did what anywhere else in the sheet.
- Colours follow the two-blue rule: `info` is a step in motion, `accent` is selection and never a timeline.
- Every word is 15px or more.

## Retired

- A second Activity block in one sheet: `allotment/allotments.tsx`, `assets/hub.tsx`. One, through `subject`.
- A copy of the fold written locally: `procurement/supplier-returns.tsx:1241` defines its own `ActivityFold`. Use the kit's.
- A history drawn as a table of dates, statuses and people, as the unrouted `finance-lab/payments.tsx` does. Use Activity.
- A numbered tile in mono: nothing is set in mono, and white.css resets it.

## What you provide

| Component | Prop | Notes |
| --- | --- | --- |
| `Timeline` | `events` | Each `{ id, title, detail?, at?, state, icon? }`. `state` is `"done"`, `"current"` or `"todo"`. A step not reached has no `at`. |
| `Lifecycle` | `steps` | Each `{ label, state }`. |
| `ActivityFold` | `children` | The trail. |
| | `count` | Said in brackets after the word; left out when unknown. |
| `Sheet` | `subject` | `{ kind, id }`, `kind` a word of the server's `record_kind`. Draws the folded Activity at the foot of the body. |

Source: `frontend-hub/src/components/ui/timeline.tsx` (`Timeline`, `Lifecycle`), `components/ui/activity-fold.tsx`, and the trail in `components/ui/record-panel.tsx` that `Sheet`'s `subject` mounts; the audit rules in `frontend-hub/AUDIT.md`.
