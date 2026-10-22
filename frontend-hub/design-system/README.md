# Central design system

The rules every Central (frontend-hub) screen follows, extracted from the live hub in its All white look. Read this before any UI work in `frontend-hub`.

| | |
| --- | --- |
| This file | Principles, words, colour, type, layout, icons, the brand, the one way to do each job, a checklist |
| [Page anatomy](01-pages.md) | List, Report, Dashboard, Form and Board, slot by slot, with exact spacing |
| [Sheet anatomy](02-sheets.md) | Sizes, head, body, foot, Edit in place, layers, states |
| [Words and formats](03-words.md) | Status words, verbs, casing, money, dates, quantities, people |
| [Motion](04-motion.md) | The two moves and the small motions, with their tokens |
| [Phone](05-phone.md) | The dock, the Fab, cards, drawers, touch |
| [Retired](06-retired.md) | What screens still do that goes, where it is, and what replaces it |
| [Components and patterns](#components-and-patterns) | 66 cards: whole-screen patterns and kit components, with rules, props and sources |
| [Previews](previews/index.html) | Open in a browser: static renditions of every pattern and component |
| `tokens.json` · `tokens.css` · `bundle.css` | The tokens as data, as CSS variables, and the `ds-*` classes that draw the kit |

The live version, with every preview, is the Design System artifact at https://claude.ai/artifact/7HCU8xkkzkM37w2uTreoz8 (private until it is shared from its page).

**Two styles, until the client chooses (owner, 2026-10-20).** The hub has two styles. **Now** is the default (owner, 2026-10-21): All white as it stood on 20 Oct, and what this document describes. **Soft** is a choice in Profile › Look.

Soft is drawn over All white by `src/styles/soft.css`, keyed on `<html data-style="soft">`. It changes these things:
- the ground: pastel, where Now has stone
- figures, every table's heading and totals (a list's, a screen's own, a card's mini table; not the matrix grids), an order's totals, and its notes: soft bands with round ends
- fields: filled, with no line — every box you type in or pick from: inputs, pickers, a textarea, a screen's own search capsule, and the variant grid's price boxes beside its pieces. One being typed in, or wrong, keeps Now's ring; one standing on a totals band stays white
- a list's tabs: a segmented track
- phone cards: they float on a tinted page; a table of lines on a phone is one white card too
- the rail's departments: matte pictures (`MattePicture`), in colour only where you are
- the phone's bar: each icon painted matte, from top to foot. The tab you are on is filled pastel with a blue line; the rest are grey. These are the 132 screen icons, painted, not drawn as pictures one by one.

Buttons, rows and type are the same in both styles.

Each person picks a style in Profile › Look. The choice is kept in the `hub-style` cookie, and `?style=now` or `?style=soft` in a link sets it.

Write rules for both styles. A style lands on shared classes only (`kpi-card`, `sub-tabs`, `table.dt`, `ui-field`, `phone-card`, `list-said`, `items-box`, `order-totals`, `record-note`), never on one screen. When the client picks, delete the other style: `soft.css`, `LookStyle` in `lib/look.ts`, and the Look row.

The source is `po-matte-options.html` "Soft cards" at the repo root. The client's copy is `po-soft-preview.html`.

## Keeping it true

- **The code holds the values.** The hub's `src/styles/index.css`, `src/styles/white.css` and `src/components/ui` are the source of every number here.
  - When a token or a kit component changes, change this folder in the same commit.
  - Then run `node scripts/design-tokens-css.mjs` to rebuild `tokens.css` from `tokens.json`.
- **A rule the code does not follow yet is a row in [Retired](06-retired.md).** Fix the code, then remove the row. Do not mark a family consistent because this folder describes it.
- **Prototypes** are plain HTML at the repo root.
  - Link `frontend-hub/design-system/tokens.css` and `bundle.css`, and draw with the `ds-*` classes, so a prototype looks like the hub without measuring it again.
  - The type styles are `ds-text-<style>`: `ds-text-title`, `ds-text-figure` and so on.

## Components and patterns

| Group | Cards |
| --- | --- |
| Patterns | [ListPage](components/ListPage.md) · [ListPhone](components/ListPhone.md) · [FormSheet](components/FormSheet.md) · [ReportPage](components/ReportPage.md) · [DashboardPage](components/DashboardPage.md) · [BoardPage](components/BoardPage.md) · [WorkspacePage](components/WorkspacePage.md) · [MatrixPage](components/MatrixPage.md) · [SignInDoor](components/SignInDoor.md) · [PrintPaper](components/PrintPaper.md) |
| Page | [AccountOrb](components/AccountOrb.md) · [CommandPalette](components/CommandPalette.md) · [DoorTabs](components/DoorTabs.md) · [NotificationBell](components/NotificationBell.md) · [PageHeader](components/PageHeader.md) · [Shell](components/Shell.md) · [SubTabs](components/SubTabs.md) · [TimeTravel](components/TimeTravel.md) |
| Actions | [Button](components/Button.md) · [RecordLink](components/RecordLink.md) · [TintButton](components/TintButton.md) |
| Status | [CountBadge](components/CountBadge.md) · [DocStamp](components/DocStamp.md) · [Status](components/Status.md) · [Tag](components/Tag.md) |
| Figures | [Chart](components/Chart.md) · [KpiStrip](components/KpiStrip.md) · [Meter](components/Meter.md) |
| Lists | [DataTable](components/DataTable.md) · [FilterChips](components/FilterChips.md) · [FilterPanel](components/FilterPanel.md) (alias) · [ListFilters](components/ListFilters.md) · [RefreshStamp](components/RefreshStamp.md) · [Toolbar](components/Toolbar.md) |
| Records | [Allocation](components/Allocation.md) · [Card](components/Card.md) · [ExceptionQueue](components/ExceptionQueue.md) · [Facts](components/Facts.md) · [MiniTable](components/MiniTable.md) · [Timeline](components/Timeline.md) |
| Overlays | [Dialog](components/Dialog.md) · [Menu](components/Menu.md) · [Sheet](components/Sheet.md) · [SheetFooter](components/SheetFooter.md) · [Tooltip](components/Tooltip.md) |
| Inputs | [DayRange](components/DayRange.md) · [Field](components/Field.md) · [FindMany](components/FindMany.md) · [FormSection](components/FormSection.md) · [NumberPad](components/NumberPad.md) · [Pick](components/Pick.md) · [ScanField](components/ScanField.md) · [Segmented](components/Segmented.md) · [Switch](components/Switch.md) |
| Feedback | [EmptyState](components/EmptyState.md) · [ErrorState](components/ErrorState.md) · [LoadingState](components/LoadingState.md) · [Receipt](components/Receipt.md) · [Toast](components/Toast.md) |
| Phone | [AppLauncher](components/AppLauncher.md) · [Dock](components/Dock.md) · [PhoneCards](components/PhoneCards.md) |
| Media | [ColourSwatch](components/ColourSwatch.md) · [Garment](components/Garment.md) · [PhotoSheet](components/PhotoSheet.md) · [Thumbnail](components/Thumbnail.md) |

---

Central is the hub that a retail business's head office, warehouse and stores sign in to: purchase orders, receiving, stock, pricing, sales, finance and people, on a desk and on a phone. Its look is **one white surface, with colour only where it means something**. The calm comes from having fewer things on screen, not from making them smaller.

Where screens disagree with each other, this system names the one way to do it. The Retired section lists what goes.

## Principles

1. **One format, one motion.**
   - Every page reads head → figures → tabs → bar → table.
   - Every sheet reads head → figures → lines → notes → activity → foot.
   - A slot may be left empty, but never moved or restyled.
   - There are two moves and no third: a layer slides in from the right, and a mode swaps the sheet's contents in place.
2. **Bold hierarchy, calm surface.**
   - Hierarchy comes from the `title` (17px/600), the `figure` (16px/600) and weight.
   - The surface stays calm: white, hairlines instead of shadows, no chips, no tiles, no grey bands.
   - Colour goes only to the one primary action, a real problem, and the dot of a state.
3. **Same on every device.**
   - A screen offers the same controls, in the same order, with the same words, on a desk and on a phone.
   - Only the layout of the data adapts: a table becomes cards, and the figures become two columns.
   - On a phone every action moves to the bottom.
4. **Everything with a detail opens.**
   - An article, a supplier, a PO number, a SKU or a photo opens its own detail as a layer over what you were on.
   - Close and Esc walk back one layer at a time.
5. **Say the figure.**
   - Write numbers, not bars: "260 pcs · 40 pcs short", "82%".
   - A difference carries its sign (−19.800, +200).
   - A missing value is "—".
6. **Simplify by removing.**
   - A new screen reuses this kit.
   - If a need seems to call for a new pattern, a new colour or a third motion, fit it into what is here first.
   - Fewer menu rows, fewer names for one state, fewer ways to do one job.

## Content fundamentals

**Language.** The screens are in English.

Indonesian stays only where the document itself is Indonesian:
- printed papers handed to Indonesian parties: delivery notes (Surat Jalan), packing lists and picklists, letters, giro. The PO print is in English;
- the client's own data, such as account names.

These words are kept as they are on screen:
- PPh, BPJS, THR, QRIS, Koli;
- abbreviations: PO, SKU, BKK, BKM, HO, DC, GA, HR, NPWP, NIK, EDC, MDR.

When the owner names a label in Indonesian, it is the idea, not the copy: "harga beli" becomes "Purchase price".

**Casing.**
- The name of a place — a department, a screen, a document type in a crumb — is Title Case: Purchase Orders, Cash & Bank, Bank Reconciliation.
- Everything else is sentence case: buttons (New order, Save changes), tabs (Active PO), column headings (Delivery date), labels (Still open), statuses (Partially received), switches (Group by supplier).
- Nothing is set in capitals. The only exceptions are a printed form copied from the client's own paper, and the abbreviations above.

**Voice.** Short and plain, from the reader's side of the screen.
- A button states exactly what happens. The toast after it says that it happened, in the past tense: Send to count → "Sent to count".
- An error says what went wrong and how to fix it, without apologising.
- Never write explanatory subtitles, notes, footnotes, "who does what" tables, or helper sentences under options. History and Activity already say who did what.

**Verbs.** One verb per job:

| Job | Say | Never |
| --- | --- | --- |
| Create a record you own | **New** order · New supplier · New promotion | Create, Make, + alone |
| Put something into the record being edited | **Add** item · Add photo | New item, inside a form |
| Log what already happened elsewhere | **Record** bill · Record repair | New bill |
| Ask somebody to approve | **Request** leave · Request supplies | Submit |
| Keep edits | **Save** · Save changes | Submit, OK, Done (as a save) |
| Call something off | **Cancel** order · Close short · End now | Void, Abort |
| An approval | **Approve** · **Reject** | Accept, Refuse, Decline |
| Book to the ledger | **Post** to the books | Submit, Confirm |

**People** appear by their full name, capitalised ("Rina Kusuma"), never by a login. `useNameOfLogin()` resolves a login to the employee's name.

**Numbers and dates** always go through `lib/format.ts`:
- `day()` gives "29 Oct 2026", and every date carries its year.
- `dayTime()` gives "29 Oct 2026, 14:28".
- `money()` gives "Rp 2.040.000" and "−Rp 1.000", with a true minus.
- `moneyCompact()` gives "Rp 102,7 M", with the letters K/M/B/T, never rb/jt/miliar.
- `quantity()` gives "24 pcs", under the heading "Quantity", never "Qty".
- `signed()` gives "−16", "+200".
- `percent()` gives "82%" and "0,25%".
- Never call `toLocaleString`/`toLocaleDateString` on a screen.

The Words and formats section has the full list.

**States** use nine words, with no synonyms:
- Active, Inactive, Cancelled, Closed, Retired;
- Pending, Approved, Rejected, Withdrawn.

Plus the retail flow words: Draft, Paid, In transit, Partially received, Fully received. Every state goes through `statusWord()`.

**The product** is called Central on every surface it owns. The company name never appears on a hub screen.

## Visual foundations

**Colour.**
- Text and lines:
  - `ink` (#1d1d1f) is for names, figures and titles.
  - `body`/`mute` (#6e6e73) is for everything that supports them.
  - `hairline` (#e8e8ec) frames cards and tables and rules under heads.
  - `hairline-2` (#dcdce1) is the border of a control.
  - `row-line` (#eeeef1) runs between rows.
- Surfaces:
  - `canvas` is the one surface.
  - `stone` (#e8ebf0) is the ground the floating page and the screens panel stand on.
- There is one blue, `accent`/`cta` (#2862dc):
  - solid, it is the one button to press;
  - as a word or a wash (`accent-bg`), it is selection: the screen you are on, a chosen tile, the focus ring, a word that opens another record.
  - The two uses never trade places, and nothing else on the screen is solid blue.
- A state is a dot and a word, in one of four tones:
  - `ok` for done or good;
  - `warn` for waiting on somebody;
  - `bad` for a problem or calling something off;
  - `info` for in motion, and only that.
- In a list or a card (`Status`):
  - the 6px dot carries the tone;
  - the word stays `ink`, and takes `warn-fg` or `bad-fg` only when it needs somebody.
- In a sheet's head (`Pill`), the one state is drawn with both the dot and the word in its tone's `-fg`.
- Red fills only Cancel and destructive buttons, and the count badge.
- The categorical colours (`a-*`, `fill-*`) are for charts only. The department colours (`app-*`) are for the phone launcher's tiles only. The violet `space-*` colours mean only that time travel is on.
- Nothing darkens: the veil behind a sheet is `scrim`, a light grey with a 2px blur. No black scrim.
- The only gradient is on the sign-in door.

**Type.**
- The face is Inter Variable (`sans`), and 15px is the floor for every word on a screen: labels, tabs, badges and table cells included.
- A quieter line is quieter by colour or weight, never by size.
- The scale:

  | Style | Size and weight | Used for |
  | --- | --- | --- |
  | `panel-title` | 20/28, 600 | The department in the screens panel |
  | `title` | 17/24, 600, −0.3px | A page or sheet title |
  | `lead-figure` | 24/30, 600 | A phone card's one figure |
  | `card-name` | 16/20, 600 | A phone card's name |
  | `figure` | 16/22, 600 | A KPI figure |
  | `section` | 15/20, 600 | A section title |
  | `body` | 15, 400 | Everything else |
  | `body-medium` | 15, 500 | A row's leading name, a tab, a column heading |

- Weights are 400, 500 and 600 only.
- Figures use tabular numbers.
- Mono is never used on a screen: a PO number reads in the same face as the name it belongs to, quieter in `mute`.
- Nothing is uppercase.

**Space and layout.**
- The shell is three layers 12px apart (`float`):
  - the `stone` ground with a 68px `rail` of department icons;
  - a 216px white screens panel;
  - the white page, radius 16.
- On a page:
  - The side edge is `page-gutter` (28px), and the title, the figures, the bar and the table all share it.
  - The page head is padded 24/28/16 and sticks as the page scrolls.
  - The vertical rhythm is head → 24 → figures → 32 → tabs → 16 → bar → 12 → table.
- Controls are 36px (`control`), fields are 40px (`field`), and anything under a finger is 44px (`tap`).
- Table rows are at least 52px, with 12/16 cell padding.
- Sheets use the same 28px sides.
- A phone has 16px gutters.

**Radius.**
- `r-inner` (8) for controls and fields.
- `r-chip` (6) for a small tag.
- `r-card` (10) for cards and framed tables.
- `r-sheet` (16) for sheets, the floating page and the panel.
- `r-full` for dots, avatars, count badges, switches and the Fab only. A button or a tag is never a pill.

**Elevation.**
- Content is separated by hairlines, never by shadows.
- Shadows belong only to glass that floats:
  - `shadow-page` and `shadow-panel` on the stone;
  - `shadow-sheet` over the veil;
  - `shadow-pop` under menus and toasts;
  - `shadow-float` under the phone's drawer;
  - `shadow-primary`, a 1px lift, under the primary button.

**States of a control.**
- Hover is a `soft-2` wash, and only where hover exists (`hover: hover`).
- Focus is a 2px `accent` outline, or an `accent` border plus `shadow-focus` on a field.
- Press is `scale(0.97)`.
- Disabled is 50% opacity. Pending is 75%, plus `aria-busy`, and the word says it ("Saving…").
- Invalid is a `bad` border with one line in `bad-fg` under the field.

**Motion.** The Motion section lists the two moves and the tokens (`t-*`, `ease-*`). What never animates:
- a row hover, past `t-hover`;
- a keyboard shortcut;
- the clock.

`prefers-reduced-motion` cuts movement to the end state.

## Iconography

- Icons are lucide-react (0.469): line glyphs, 2px stroke, round caps. They are 16px in buttons, bars and cells; 17px for the sheet's ×; 20px in the rail and on the Fab.
- An icon stands beside its word, in `line-ico` or the button's colour.
- An icon-only button exists only for a glyph everybody reads: × closes, the pencil edits, the bin removes, ⋯ shows more. It always carries an `aria-label`.
- No emoji, and no coloured icon tiles. The one exception is the phone launcher's department tiles (`app-*`).

## Brand

The mark is the app icon, Matte · Deep (owner, 20 Oct): a matte blue tile (`brand-tile`, #4277e6 top to #1f4fc0 foot), a pale C (#fff to #d3e0fa) with a soft contact shadow, and a yellow dot (#ffd766 to #eaa20f) in its mouth. It has no shine. `BrandMark` draws it, and `scripts/pwa-icons.mjs` draws the same picture into `public/pwa-*.png` and `apple-touch-icon.png`. It replaced the black tile with a white C and a blue dot. It lives in `assets/Logos`.

The sign-in door sets the name "Central" in Inter 600 with the blue dot after it. In the white look its left half is white with a fine grain and a slow blue glow (the source's charcoal half became transparent on 13 Oct). It is the one screen with a gradient and ambient motion.

Do not draw any other wordmark, and do not use the company name on a hub surface.

## The one way to do each job

| Job | Use | Not |
| --- | --- | --- |
| A page's title and its main action | `PageHeader` | A hand-made `<h1>`, `ListHead`, the `sub` line |
| Figures above a list or in a sheet | `KpiStrip` / `Kpi` | `NumberCard`, `ReportSummary`, `KpiBox`, `.figure-box`, equal boxes |
| Switching between datasets on a page | `SubTabs` (`DoorTabs` in a department door) | Segmented or chip rows used as a status filter, tabs inside a sheet |
| Search, filter and view controls | `Toolbar` + `ExpandingSearch` + `FilterPanel` | A hand-written bar, a hand-made `<input>`, `DeskFilterChips` |
| A list of records | `DataTable` (cards on a phone, `pageScroll`) | A `<table>` by hand, a `div` grid with `min-w-[78rem]`, `Grid` for a list, an inner scroll box |
| A record's state | `Status` in a list, one `Pill` in a sheet head, via `statusWord()` | Local `*Pill`, tone maps, `screens/me/ui/pill`, a green word with no dot |
| A secondary or take-back action that must look pressable | `TintButton` (the one solid primary stays `Button`) | A blue or red word with no fill, `Button variant="tint"` or `"danger"`, a class string copied between screens |
| A finished document | `DocStamp` | A bold uppercase stamp drawn by hand |
| Opening a record or a form | `Sheet` with a `size` and a `SheetFooter` | Unsized 760px sheets, `width`, `actions`, a centred `Panel` holding a form |
| Reading a record's facts | `Facts` / `Fact` | `KeyValue`, a raw `<dl>`, disabled inputs |
| Lines inside a sheet | `MiniTable` under a `SubHead` | A `Card` inside a sheet |
| Linking to another record | `record-link` + `openable` (as a layer) | A blue button styled by hand, a plain name |
| Asking "are you sure?" | `Dialog` / `ConfirmButton` | `window.confirm`, a sheet for a yes/no |
| Telling that a write landed | `toast()` (bottom left) | A banner that stays |
| Nothing to show, still loading, failed | `EmptyState`, `LoadingState`, `ErrorState` / `Problem` | A hand-written "Loading…" |
| Phone actions | `DockTools` + `Fab` + the sheet foot | A button or a search box at the top |
| A whole screen | The Patterns cards: `ListPage`, `ListPhone`, `FormSheet`, `ReportPage`, `DashboardPage`, `BoardPage`, `WorkspacePage`, `MatrixPage` | A new layout drawn from scratch |
| Choosing one or many from a list | `PickOne` / `PickMany` (a `PickerSheet` on a phone) | A hand-styled `<select>`, chip rows |
| A menu or a popover | The shared `POPUP` / `ITEM` (36px rows) | A dropdown drawn by hand, 32px copies |
| Naming an icon | `Tooltip` in the `tooltip` colour | A tooltip that carries information the screen needs |
| Scanning a barcode or a tag | `ScanField` | A plain input |
| Grouping a form's fields | `FormSection` | A hand-made grid, a section with a glyph or an explaining aside |
| Finding anything | `CommandPalette` (⌘K) | A search box above the page |
| What waits on somebody | `CountBadge`, `NotificationBell`, `ExceptionQueue` | Blue counts, two attention lists on one page |

## Before a screen ships

- [ ] It follows the closest page or sheet anatomy, and every slot is in its place.
- [ ] There is one solid primary. Cancel is red. Everything else is a ghost, or a `TintButton` where an action would otherwise be a coloured word.
- [ ] Every word is 15px or more; there are three sizes at most; nothing is uppercase or mono.
- [ ] Every state goes through `Status`; every date has its year; money and quantities go through `lib/format.ts`.
- [ ] Every object with a detail opens it as a layer.
- [ ] At 414px nothing scrolls sideways; actions sit in the dock or the foot; the list is cards.
- [ ] At 1440px the table stays inside the page; the list scrolls with the page.
