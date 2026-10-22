# Tooltip

A tooltip is a small dark chip beside an icon that says its name and nothing else, so it is never the only place a fact is written.

## When to use it

| The job | Use |
| --- | --- |
| Name a bare icon in the rail: a department, Search | `RailTip`, the one tooltip in the kit |
| Name an icon-only button elsewhere (×, ⋯, the pencil, the bin) | An `aria-label`. These glyphs are read by everybody, so they carry no chip |
| Say why a button is off, what a figure is made of, a date in full | Not a tooltip. Write it on the page: `SheetFooter note`, a Facts value, or a layer |
| The figures behind a chart point | The chart's own tooltip (see the Chart card) |

## Anatomy

- **Chip**: `tooltip` fill with `on-dark` words, radius 8px (`r-inner`), padding 6px 10px, 15px at 500 on a 15px line, so 27px high. `shadow-float`. One line, never wrapped.
- **Words**: the icon's name, and a shortcut after two spaces: "Procurement", "Search  ⌘K".
- **Place**: 10px to the right of the icon's right edge, centred on its height. No arrow.
- **Layer**: drawn into `body` at z-index 70 with `pointer-events: none`, because the rail scrolls and would clip a chip drawn inside it. The pointer passes through the chip. The wrapper has no box of its own (`display: contents`), so the rail's layout is what it was.
- **Opens** on pointer-over and on keyboard focus, **goes** on pointer-out and on blur. It reads `role="tooltip"`.
- **Motion**: none. It appears at once and leaves at once, because a rail of icons is looked at forty times a day.

## Sizes

| Part | Size |
| --- | --- |
| Chip | 27px high; as wide as its words plus 20px |
| Gap to the icon | 10px |
| Rail tile it names | 40px (`rail-button`), radius 8px; the Search tile 10px |

## Rules

- A tooltip names. It never explains, instructs or reports, and it is never the only place something is written.
- It names a glyph nobody can be expected to know. A word already on screen needs none.
- Every icon-only control has an `aria-label` as well; a tooltip is not its replacement.
- The chip is the one dark surface in the chrome. Do not draw another.
- A tooltip anywhere else follows Emil Kowalski's rule: the first waits a beat, and once one is open its neighbours open at once and without motion. The rail skips the wait, because naming icons is all it does.
- The browser's `title` is not a tooltip here: it waits about a second, cannot be styled and says nothing in the desktop shell.

## Retired

- **The wrong black.** `RailTip` fills with `ink` (#1d1d1f) and words in `canvas`; the surface has its own token, `tooltip` (#101012), with `on-dark` words. Use them.
- **A second dark chip.** `procurement/setups.tsx:2365` hangs one under a SKU price: the markup on hover ("12,5% markup") and the live total while it is typed. It is radius 6px, padding 4px 10px, `shadow-pop`, 400. Those are figures: say them in the row.
- **A tooltip that is a card.** `commercial/pricelist.tsx:2600` gives `role="tooltip"` to a 288px white card of price lines (base price, store price, the markdown, charged now). That is information: open it as a layer.
- **`title` as a name.** About 200 elements in 115 files set the browser's `title` ("Show the screens  ⌘B", the Fab's word). Give them an `aria-label`, and keep a fact out of a `title` altogether.

## What you provide

| Prop | Type | Notes |
| --- | --- | --- |
| `label` | `string` | The name, and an optional shortcut after two spaces. |
| `children` | `ReactNode` | The icon's own element. Its first child element is the anchor the chip is placed against. |

Source: `frontend-hub/src/components/ui/rail-tip.tsx`, used by `components/shell/nav-column.tsx` (the folded rail's departments and Search); the `tooltip` and `on-dark` tokens in `styles/index.css`.
