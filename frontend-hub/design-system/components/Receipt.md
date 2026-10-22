# Receipt

A Receipt is the green banner that says, where a write was asked, what it did in numbers worth reading; its neighbours are the quiet foot of a list that has more (`LoadMore`) and the warning over a list that was cut (`Truncated`).

## Pick by what happened

| What happened | Say it with | Where |
| --- | --- | --- |
| A save landed and the screen already shows the result | `toast.success("PO-161026-010 created")` | Bottom left (see `Toast`) |
| A save minted a number | The button's `said`, the pill pulled into the row, then a toast | Never a dialog over the list |
| A write finished with facts to read: "3 drafted · 2 posted · 1 failed", "3 lines accepted.", "Returned to Garmen Nusantara, PT." | `Receipt` | In the place it was asked: above the list, in a dialog's body, in the strip over a grid |
| A write failed | `Problem` | Under the form (see `ErrorState`) |
| A list holds more rows than it drew | `LoadMore`, or `DataTable more` | The foot of the box that scrolls |
| A list was cut at a limit nobody can count past | `Truncated` | Above the list |

## Receipt

- It is `Banner tone="ok"`: an `ok-bg` wash with `ok-fg` words, radius 8px (`r-inner`), padding 10px 14px, 15px at 1.625 leading, no border, no icon, no dismiss.
- It says what the write did: a count, a name, or both, with a middle dot between facts. "It saved" alone is not a receipt: that is the button's `said` and a toast.
- It stays until the screen moves on: the dialog closes, the list is read again.
- In a dialog it stands in the body and the foot changes with it: Cancel becomes Close and the act becomes Done.
- It is the good twin of `Problem`, which draws nothing when there is no error; draw a Receipt only when there is something to say.

## LoadMore

| State | Draws |
| --- | --- |
| More to come | Nothing but a 1px marker, watched. The next page is asked for as the marker comes within 400px of the end of the box that scrolls, so the list reads as one list |
| On its way | "Loading more…" in `body`, 15px, centred, 10px above and below |
| Refused | The server's sentence in `bad` ("The next page could not be read." when it said none) and a ghost "Try again", "Trying again…" while it asks. It stops asking by itself, or a dead endpoint would be asked for ever |
| None left | Nothing. The list stopping is the answer |

- Put it inside the box that scrolls, or let `DataTable` place it with `more`. Watched against the viewport, it would pull every page in at once.
- A page that arrives and leaves the marker in view asks for the next straight away.
- A reload of the pages already held is not "loading more": that is `RefreshStamp`.

## Truncated

- A `warn` banner: "Showing the first 500 of 612 credit notes. This list is searched and sorted in the browser, over these rows only, so there may be more that never arrived — **do not read the figures below as totals.**" The last clause is at weight 500.
- `total` left out: "Showing the first 500 credit notes." `total` null (the count was not asked for): the total is "—", never 0, and "The full count was not asked for on this request." follows.
- Draw it only while the rows returned reach the limit asked for. It does not fix anything; the fix is `q`, `sort` and a cursor on the wire. It stops the screen lying quietly meanwhile.
- One screen draws it today: `finance/credit-notes.tsx`, a limit of 500.

## Rules

- A receipt is read once, so write what changed and stop: facts, not thanks. No "successfully", no exclamation mark.
- A toast confirms an action that did not change the screen. A fact the page keeps, such as a batch's result, sits on the page as a Receipt.
- A list that has more never needs a button the reader has to find. A list that was cut says so above the figures, not below them.

## Retired

- **`SavedDialog` for what mints a number.** A PO, a supplier or a count says it with the button's `said` and a toast. `SavedDialog` is still drawn by 13 files (`procurement/import.tsx`, `procurement/setups.tsx`, `operations/picking/picking.tsx`, `operations/despatch/trucks.tsx`, `allotment/returns.tsx`, `commercial/promotions.tsx`, `campaigns.tsx`, `change-price-sheet.tsx`, `pricelist-editor.tsx`, `workplace/chat.tsx`, `chat-info.tsx`, `setup/company-sheet.tsx`, `inventory/missing-list.tsx`). It centres a 416px card on a veil: a 56px `ok-bg` disc with a tick, the title at 24px (`title` is 17px), a 16px line under it, an optional ghost verb or a red Undo that empties over 5s, and a bar that empties over 3s before it lets itself go. Whether the other receipts (New articles, Allotment, Picklist, Dispatch, Return to HO) become toasts too is still open (16 Oct 2026).
- **A banner that stays to say that a save landed.** That is a toast. A banner stays for a batch's facts only.
- **"Show more" written by hand.** `operations/articles/articles.tsx:204` draws a `soft` button, "Show more · 40 left"; the variant is retired and `LoadMore` already speaks when a page is refused.
- **The mechanism in `Truncated`.** "This list is searched and sorted in the browser, over these rows only, so there may be more that never arrived" explains how the strip came to be. Keep the count and the last clause.
- **A loading phrase.** "Loading more…" is the family `LoadingState` retires; the house form names the thing: "Reading more orders…".
- **A second `Receipt`.** `commercial/pricelist.tsx` defines its own, a price breakdown with `ReceiptRow`s ("Tax on top"). Give it another name.

## What you provide

| Component | Prop | Type | Notes |
| --- | --- | --- | --- |
| `Receipt` | `children` | `ReactNode` | What the write did |
| | `className` | `string` | Layout only |
| `LoadMore` | `query` | `Pageable` | `hasNextPage`, `isFetchingNextPage`, `isFetchNextPageError?`, `error`, `fetchNextPage`: a TanStack infinite query result fits as it stands |
| | `className` | `string` | |
| `Truncated` | `limit` | `number` | The rows asked for, not the rows returned |
| | `noun` | `string` | "credit notes" |
| | `total` | `number \| null` | How many there are in all. `null` means not asked for; leave it out where there is no total |
| | `className` | `string` | |
| `SavedDialog` | `open`, `onOpenChange`, `title`, `children`, `action`, `undo` | | Retired for a number; `action` and `undo` are `{ label, onClick }` |

Source: `frontend-hub/src/components/ui/states.tsx` (`Receipt`, `LoadMore`, `Truncated`, `Banner`), `dialog.tsx` (`SavedDialog`).
