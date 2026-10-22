# WorkspacePage

The template for a queue you work through and the room to work it in: the queue stands as a page of cards, the work opens in a `workspace`-size sheet with its reference beside it, or takes the whole page when its grid needs the width.

## Copy this screen

- **New articles**, route `/merchandise/new-articles`, file `frontend-hub/src/screens/master/new-articles.tsx`, which draws `SetupWorkspace` in `screens/procurement/setups.tsx`: the queue and the sheet. Start from it for any list worked one item at a time with a form and a reference.
- **New allotment**, route `/allotment/new`, file `screens/allotment/matrix.tsx` (`NewAllotment`). It starts from the Unallotted tab of Allotments (`to-allot.tsx`), the same queue of supplier cards with a tick on each article. Start from it for a task that needs the page's whole width.

## When to use it

| The screen is for | Use |
| --- | --- |
| Working a queue one item at a time, each with a form and a count or a document beside it | A `workspace` sheet over the queue's page |
| Filling one grid that needs the page's whole width, supplier by supplier | A workspace page with the screens panel folded |
| Reading or editing one record | A `wide` or `rail` sheet (Sheet) |
| Finding, filtering and opening many records | ListPage |

## Slots, top to bottom

### The queue: a page of cards

| Slot | Component | Drawn as | Space after |
| --- | --- | --- | --- |
| Head | `PageHeader` | "New Articles". No primary: the work is in the cards. | 24px (`head-gap`) |
| Figures | `KpiStrip` | New Articles · Pcs · Suppliers. | 32px (`figures-to-tabs`) |
| Bar | `Toolbar` | Search "Search New Articles or Supplier"; a supplier typed into it narrows the queue. | 12px (`bar-to-table`) |
| Cards | one per supplier | A 44px head: chevron, the supplier at 17px/600, "12 items · 240 pcs" in `mute`, "Set up all" as a 32px card button. Under it one card per waiting line: a 48px picture, the article at 500 with its PO number in `mute`, "24 pcs" at 600 and "2h ago" in `mute` at the right. | 12px between suppliers, 8px between lines |

- A supplier card is 1px `hairline` and `r-card`; it folds on its head. A line card is `soft` under the pointer; the line that is open is `soft-2` with an `ink` edge.
- The queue reads again every 2s while a mint is processing and loses a line the moment it is set up.

### The work in a sheet

- `size="workspace"`: `clamp(27.5rem, 96vw, 84rem)`, so 1344px at 1440. It floats 12px off the window at `r-sheet` over the `scrim`, like every sheet.
- Size follows content. New articles asks for `workspace` once the warehouse has counted the delivery (the check stands at the right) and `wide` before; while the next line loads it keeps the width it had.
- Head: the crumb "New Articles / New Article" (the queue's name, then the kind), the line's article name as the title, the supplier as the caption. No status: the sheet is a form.
- Body: two panes once the form is 64rem across, a window of about 1130px.
  - **The form**, growing: the 144px photo with "Change photo" in `accent`, then Name, Division, Tags and Description in two columns 32px apart, fields 20px apart, blocks 28px apart. Then Base price and Markup, the Variants heading, the colour and size pickers and the colour × size grid.
  - **The aside**, 22rem (352px), sticky: 1px `hairline`, `r-card`, 14px inside. "Quantity check" as a section title, who counted and when in `mute`, the article at 500, one row per colour · size with a `hairline` over it and a tabular figure, Total in `mute`. Its own foot: Recount (ghost) then Use count (primary).
  - Narrower, the aside stands under the Variants heading, full width.
- Foot: Save as draft (ghost), Submit and next (ghost), Submit (primary), all at the right. A line at the left says in `warn-fg` why Submit is off.
- Submit and next saves and opens the next line of the queue; on the last line it closes. Typing is kept as a draft in the browser, line by line, as it changes, so closing loses nothing; Save as draft keeps it on the server for another desk.

### The work as a page

- The shell folds the screens panel away on this route (`FOCUS_PATHS` in `app-shell.tsx`) and keeps the 68px rail (owner, 14 Oct 2026). ⌘B opens the panel for that visit only; leaving the page puts it back.
- `UI-PATTERNS.md` §5 draws a 64px icon strip and a 180px rail for this. The hub does not draw them: the panel is simply away, and its rows come back when it is opened.
- The page has no `PageHeader`. Its own bar: Back (ghost), the title at 15px/600, and at the right "2 of 3" with Previous and Next, one step per supplier ticked. Under it a 64px toolbar: the filter box at the left, "To be allotted 24 pcs" (ghost) and Submit all (primary) at the right. The grid fills the rest and scrolls inside itself (see MatrixPage).
- Back with typing in the grid asks "Discard the typed quantities?".

## On a phone

- The queue is cards under supplier headings that stick and fold (`PhoneCards`); the card's one button is "Set up". Search and the supplier picker are the dock's.
- Every sheet is the bottom drawer, so the aside drops under Variants and the foot buttons are 44px.
- New allotment shows one store at a time: a picker with ‹ › arrows 44px wide, and no Stock column. Its Submit all stays in the toolbar.

## Rules

Do:
- Give the queue one row per unit of work and let the sheet walk it: the person never returns to the list between items.
- Put the reference (a count, a document) in the aside, never in a second sheet over the first.
- Declare `size`, and let it follow content, not the window.
- Let only a page that needs the width ask the shell to fold the panel.

Don't:
- Use a tab inside the sheet to hold the aside.
- Add a second primary: Submit and next is a ghost beside Submit.
- Scroll the queue sideways; a grid scrolls inside its own box.

## Retired

Follows it: New articles; Import PO (`workspace`, though a wizard rather than a queue), campaigns, price rules and Giro Templates, which are workspace sheets; New allotment as the one workspace page.

Drifts, on the reference pages themselves:
- The old `width` prop: `setups.tsx:571` passes `width="workspace"`, as do `import.tsx:381`, `finance-lab-2/journal-entry.tsx:167`, `commercial/rule-form.tsx:775`, `commercial/campaigns.tsx:2285` and `inventory/flows.tsx:421`. Only `finance/giro-print.tsx:421` says `size`.
- A hand-made foot and `noFoot`: New articles draws its own sticky bar (`setups.tsx:3929`), and Submit and Next is `quiet` (`:3981`). Use `SheetFooter` with a ghost.
- Title Case on buttons and labels (sentence case is the rule): "Save as Draft", "Submit and Next", "Base Price", "Quantity Check", "Request Quantity Check", "Show Earlier".
- Comments in `setups.tsx` that say Previous and Next walk the cards, or that closing asks "Discard this draft?" (`:222`): the sheet draws only Submit and Next and is not given `dirty`; the kept draft stands in for the question.
- The composer's head is a hand-made bar with a 15px title (`matrix.tsx` `h1`); every other page title is `title` at 17px. The owner asked for its own Back and title; the size was not his word.
- "Make new allotment" (`to-allot.tsx:187`): the verb is New allotment. Its search is a hand-made 36px input (`:215`; use `ExpandingSearch`), its selection bar (`:254`) and the checkbox in `ArticleChoice` are hand-made too.
- `font-mono` on a line card's PO number and an article code (`setups.tsx:895`, `to-allot.tsx:431`), which white.css resets; `rounded-[0.625rem]` on the supplier and line cards: use `r-card`.

Drifts elsewhere:
- The supplier card and the line card are written twice, in `setups.tsx` (`SupplierCard`, `LineCard`) and in `to-allot.tsx` (`SupplierFold`, `ArticleChoice`). One shared card would end the copy.

## What you provide

| Piece | Prop | Notes |
| --- | --- | --- |
| `Sheet` | `size="workspace"` | Or `wide` while the aside has nothing to show. |
| | `id`, `title`, `caption` | The kind of record, the line's name, the supplier. |
| | `footer` | A `SheetFooter`. |
| | `dirty` | Asks before typing is thrown away. New articles keeps a draft instead and does not pass it. |
| Queue | `SupplierCard`, `LineCard` | Local to `setups.tsx`. |
| Page | `FOCUS_PATHS` | Add the route to fold the panel. |

Source: `frontend-hub/src/screens/procurement/setups.tsx` (`SetupWorkspace`, `SessionComposer`), `screens/master/new-articles.tsx`, `screens/procurement/setup-quantity-check.tsx`, `screens/allotment/matrix.tsx`, `screens/allotment/to-allot.tsx`, `components/shell/app-shell.tsx`, `components/ui/sheet.tsx`; the sheet's size in `UI-PATTERNS.md` §5.
