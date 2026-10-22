# LoadingState

A loading state is a quiet sentence with no spinner, or, in the lists opened all day, the pale shape of the table that is coming.

## Pick by where it stands

| Where | Use | Looks |
| --- | --- | --- |
| A screen or a card waiting on a query | `LoadingState`, usually through `queryState(query, { loading })` | A centred sentence in `body`, 15px, 56px above and below, at most 28em wide |
| The same, under Operations, Procurement, Master or Merchandise | `LoadingState`, which draws `ListSkeleton` there | Eight 56px rows in a frame |
| Inside an open sheet | `SheetLoading`, or `SheetQuery` | A `mute` sentence over two pale bars, at the left |
| The first paint of the whole app | `BootSkeleton` | The shell's silhouette |

## Anatomy

- **LoadingState**: "Reading the basket…" in 15px `body`, centred, `max-w` 28em, padding 56px 16px. Left out, the sentence is "Loading…".
- **ListSkeleton** (drawn by `LoadingState` itself; it is not exported): a frame of 1px `hairline` and radius 8px. Eight rows, each 56px tall with 16px at the sides and 24px between its bars, a `hairline` between rows. Each row has a name bar (widths of 40%, 33%, 50%, 40%, 28%, 50% in turn), a 64px bar pushed to the right and an 80px bar, all 14px tall bars in `soft` with round ends. The sentence is kept for a screen reader. The bars pulse slowly and are held still for anyone who asked for less motion.
- **SheetLoading**: "Reading the supplier…" (`mute`, 15px) and, 12px under it, two bars 14px tall, two thirds and half of the width, 10px apart. The head already shows the number from the address, so nothing else is needed.
- **BootSkeleton**: see below.

## The boot skeleton

It should match the floating-panel shell. Its shape nearly does; the hub's copy has no styles at all.

- **Shape.** On `stone`, a 68px rail with the mark and four dots; a 216px white panel, radius 16px, with a label bar and four row bars; and the page, white, radius 16px, padded 24px 28px, with a 176px title bar and 40px bars. Panel and page stand 12px off the window and the rail is 68px wide, as in the shell. It differs in four small ways: the 12px gap also stands between the rail and the panel (the panel is at 80px, the shell's at 68px); there is no `shadow-panel` or `shadow-page`; its nav bars are 13px on a 25px pitch where a real row is 36px; and the page bars stand in for the head and the table. That is close enough for a first paint.
- **State today.** The rules (`#boot`, `.b-rail`, `.b-panel`, `.b-body` and the bars) sat in the hub's `index.html`. They were not carried over when the hub moved to TanStack Start on 16 Oct 2026, and `index.html` is gone. On the running hub the markup draws nothing: every element measures 0px tall and transparent. The store app still has them (`frontend-store-new/index.html`), and the preview draws them as written there. Put the rules in the root route's head, or the first paint stays blank.
- The component and the document's inline markup must stay one picture.

## Rules

- Say what is being read: "Reading the basket…", "Reading the supplier…". One verb, the thing in lower case, a real ellipsis.
- No spinner. On a 400ms fetch a spinner is a flash; on a hang it claims work is happening.
- A skeleton is for the lists and boards opened all day, where a line of text that becomes a table moves the whole page, and for an open sheet. Everywhere else the sentence.
- In a sheet, never the page's `LoadingState`: it is a band for a whole screen and leaves 100px of air for each section.
- A refresh over data already on screen is not a loading state. The rows stay, and if the refresh fails a warning banner says so: "Couldn't refresh — showing what loaded at 10:48."
- Loading is not empty and not failed: when the query settles it becomes the list, `EmptyState` or `ErrorState`.

## Retired

- **Loading phrases.** The 6 Oct 2026 audit found about ninety ("Loading…" 21 times, "Loading the order…", "Opening the pool…", a bare "…"). Use "Reading the {thing}…". The PO sheet still says "Loading the order…" and the count sheet "Opening the count…".
- **The page's `LoadingState` inside a sheet.** The PO sheet passes `queryState` its `loading` string and gets the centred band. `SheetLoading` is used in two screens (the supplier sheet and the sales explorer's detail) and `SheetQuery` in none.
- **A spinner**, or a hand-written "Loading…".
- **`bg-card` on the skeleton's frame.** It is not a token, so the frame has no fill. The bars are `soft` (#fafafb), which only just shows on `canvas`.

## What you provide

| Part | Props | Notes |
| --- | --- | --- |
| `LoadingState` | `children` | The sentence. Default "Loading…". |
| `queryState(query, options)` | `loading`, `refused`, `render` | Draws `LoadingState`, `ErrorState` or the data. |
| `SheetLoading` | `what`, `className` | `what` is the thing in lower case: "supplier". |
| `SheetQuery` | `query`, `what`, `children(data)` | Loading, then error with Try again, then the record. |
| `BootSkeleton` | none | The first render, while the session is asked. |

Source: `frontend-hub/src/components/ui/states.tsx`, `sheet-states.tsx`, `src/components/boot-skeleton.tsx`, `src/lib/query-state.tsx`; the boot rules in `frontend-store-new/index.html`.
