# EmptyState

An empty state says in one sentence, under a small picture, which kind of nothing a list holds: never made, nothing matches, or nothing left to do.

## Pick the sentence by what the nothing means

The three kinds look alike and mean opposite things, so the caller always picks; there is no default sentence.

| The nothing is | It means | Say | Example |
| --- | --- | --- | --- |
| Never made | The thing does not exist yet | What is missing | "No supplier has offered anything yet." "Nobody has been set up as a supplier yet." |
| Narrowed away | The data is fine; the search or filters hide it | That nothing matches | "No order matches these filters." |
| Done | There is nothing left to do | That it is finished | "Every order has arrived in full." |
| Refused | Permission, not absence | `NoAccessState`: this same block with its own sentence | See ErrorState |

- `NoMatch` is the narrowed case with a count. `held` turns "nothing matches" into "there are 18 orders here, and not one of them passes the search and filters in force", which tells a reader in one line that nothing is broken. Leave `held` out when the endpoint cannot say how many exist: a made-up count is worse than none.
- Its action, "Clear the narrowing", is the ghost button that removes the filters.

## Anatomy

- **Block**: centred, at most 28em (420px) wide, padding 48px 16px, 12px between its parts. It stands where the rows would be, inside the table's frame, and has no frame of its own.
- **Picture**: 136px wide, drawn on a 160 by 112 grid, 2px line. One friendly object on a pale disc, one solid touch of colour, and three small marks (a plus and two dots). It rises 6px and fades in over 300ms once; there is no loop.
- **Sentence**: 15px in `body`, one sentence, sentence case.
- **Action**: optional, under the sentence: a ghost button that fixes the emptiness ("Go to sourcing"). A solid primary only when this is the page's one primary.

## The pictures

The picture follows the sentence; failing that it follows the department; `art={null}` draws none, for places too small to hold one.

| Picture | Chosen when the sentence says | Tint |
| --- | --- | --- |
| `search` | match, matches, found | blue |
| `done` | in full, nothing late, all done, nothing left, up to date, caught up, nothing waiting | green |
| `orders` | po, order, purchase, supplier, bill | blue |
| `box` | count, stock, carton, koli, pick, pack, allot, article, item, receive | orange |
| `truck` | truck, trip, dispatch, in transit, delivery note, shipped | blue |
| `tag` | promotion, campaign, voucher, price, discount | violet |
| `people` | member, user, account, customer, staff, employee | blue |
| `store` | store, shop, till, fleet, server | orange |
| `chart` | sold, sales, report, takings, revenue | violet |
| `calendar` | scheduled, due, this week, period | blue |
| `bell` | notification, activity, event, message, alert | orange |
| `return` | return, refund, taken back | green |
| `empty` | Anything else, and any other department: an open tray | blue |

By department the fall-back is: Procurement `orders`; Operations, Inventory, Allotment, Merchandise and Master `box`; Commercial `tag`; Sales, Executive and Reports `chart`; Stores `store`; Members `people`; System `bell`.

## Rules

- One sentence, and it names what is missing. It never explains how the button works, never holds instructions.
- A filtered list and an unfiltered one get different sentences.
- Offer an action only when it fixes the emptiness. Its word is a verb: "Go to sourcing".
- Loading is `LoadingState`, a failure is `ErrorState`; an empty state never stands in for either.
- Inside a sheet the small `SheetEmpty` is used: one `mute` line at the left and the action.
- Do not draw a grey illustration, an amber "unknown" or a dark dim of your own.

## Retired

- **Instructions in an empty state.** `procurement/import.tsx:635` puts "Files that name the same supplier and PO number are merged into one order. Every draft is checked first — no PO is created from a raw file." in one. That is help text, not an emptiness.
- **A long `NoMatch` sentence.** The component's "not one of them passes the search and filters in force", and the button word "Clear the narrowing", are wordier than the PO list's own "No order matches these filters."
- **A sentence that says nothing.** "Nothing here." (`procurement/supplier-returns.tsx:435`) and "Nothing here yet." (`procurement/purchase-orders.tsx:1588`) do not say what is missing.
- **Pictures with their own colours.** The 13 pictures are drawn with literals (line `#8a93a3`, blue `#2563eb`), not tokens, and the blue is not `accent` (`#2862dc`). Do not add another colour to them.

## What you provide

| Prop | Type | Notes |
| --- | --- | --- |
| `children` | `ReactNode` | The sentence. A string also picks the picture. |
| `action` | `ReactNode` | A ghost button. |
| `art` | `EmptyArt \| null` | Left out, it follows the sentence, then the department. `null` draws none. |

`NoMatch` takes `what` ("order"), `held` (a count, when the endpoint knows it) and `onClear`. `EmptyIllustration` takes `art` and `className`.

Source: `frontend-hub/src/components/ui/states.tsx` (`EmptyState`, `NoMatch`), `empty-art.tsx`, `empty-art-pick.ts`.
