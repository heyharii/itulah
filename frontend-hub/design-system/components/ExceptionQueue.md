# ExceptionQueue

The ExceptionQueue is the list of things that need somebody, at the top of an overview: one row each, saying what is wrong, how much it matters and where to open it.

## When to use it

| The job | Use |
| --- | --- |
| What is wrong, stuck or mismatched across the business: bills past due, a contract ending, a POS left open, a server that stopped | `ExceptionQueue`, under the figures and above the lists |
| Requests waiting for the signed-in person to decide | The screen's own queue of requests, not this |
| One thing that went wrong on this page | A `Banner` |
| A list of records to browse | `DataTable` |
| A day with nothing wrong | Leave the queue out |

Seven screens draw one: the Sales overview ("POS left open"), Finance, People ("Needs attention") and the People directory ("Contracts running out"), System health and Nodes ("Servers needing a person"), and the Library ("In the drawer, but the bytes are gone").

## Anatomy

- **Frame**: a `Card` (1px `hairline`, radius 10px), clipped. 18px of margin under it; screens that set their own rhythm pass `mb-0` or `mt-4`.
- **Head**: the card's head. The title at 16px/600, "Needs attention" unless a screen names its own, and at the right the count of rows in `mute`, tabular. The count is drawn only when there are rows.
- **Row**: a whole-width button, 11px above and below, 12px between its parts, a `row-line` rule under it except the last; two lines make it 66px. The row under the pointer takes a `soft` wash. A press opens the thing it names.
- **Tile**: 30px square, radius 8px (`r-inner`), a 15px glyph. High is `bad-bg` with a `bad-fg` glyph, medium `warn-bg` with `warn-fg`, low `soft-2` with `body`.
- **Words**: the title at 15px/500 in `ink` and, under it, the detail at 15px in `mute`: who, when, what. "Rina Kusuma has not answered an overtime order" over "Thu, 29 Oct 2026 · ordered by Budi Hartono".
- **Amount**: the number that says how much it matters, at the right in 15px/600, tabular and never wrapped: "Rp 12.500.000", "2h", "9d". It always carries its unit.
- **Severity**: a 21px capsule: High in `bad-fg`, Medium in `warn-fg`, Low in `body`.
- **Chevron**: 15px in `faint`, the last thing in the row.
- **Empty**: the head and one sentence in `body`, 16px under it: "Every POS is square — nothing is sitting open." Worth writing for each screen. Where all clear is no news, draw nothing: an empty card is one people learn to scroll past.

## Sizes

| Part | Size |
| --- | --- |
| Row | 66px with two lines; 53px with one |
| Tile | 30px |
| Severity capsule | 21px |
| Head | 48px |

## Rules

- One queue to a screen, ordered worst first: a contract that has ended outranks one about to end.
- A row is something a person has to do. A list of green numbers is not a queue.
- Name the queue for what it holds ("Servers needing a person"), not "Exceptions".
- The detail is a fact, not an explanation. People by their full name, dates with the year.
- The press opens the record as a layer (`onOpen`), like every object with a detail. The queue takes a callback, not a path, so the screen decides where.
- Money through `money()`, counts through `count()`.

## Retired

- **Details written as sentences.** `finance/overview.tsx` explains in each row ("There is no goods-received-not-invoiced account, so none of it is in the books."; "Either still in transit, or never booked. The two have different answers."). That is a helper sentence. Say the fact.
- **A coloured tile.** The system draws no coloured icon tiles outside the phone launcher. The glyph stands alone in the severity's `-fg` colour.
- **A severity word in a capsule drawn two ways.** White.css outlines the High and Medium capsules (it only repaints the toned washes) and leaves Low as a filled `soft-2` capsule. A severity is a dot and a word, as every state is: `Status` with `bad`, `warn` and `neutral`.
- **A margin of its own.** The 18px under the card fights the page's spacing; two screens undo it with `mb-0` and `mt-4`.
- **An amount without a unit.** A bare "64" beside "3 past months are still open" read as a fourth month, a sum or nothing; `amount` takes a node so the unit goes in it.

## What you provide

| Prop | Type | Notes |
| --- | --- | --- |
| `exceptions` | `Exception[]` | Worst first. |
| `title` | `ReactNode` | Default "Needs attention". |
| `empty` | `ReactNode` | The sentence when the queue is clear. Default "Nothing needs attention." |
| `className` | `string` | Layout only. |

`Exception`: `id`, `title`, `detail?`, `amount?`, `severity` (`"high" \| "medium" \| "low"`), `icon?` and `onOpen?`.

Source: `frontend-hub/src/components/ui/exception-queue.tsx`, with `card.tsx`; rows built in `screens/sales/overview.tsx`, `screens/finance/overview.tsx`, `screens/people/overview.tsx`, `screens/system/nodes.tsx`; look in `styles/white.css` (cards, hand-written state capsules).
