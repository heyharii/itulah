# Motion in Cloud Hub

What moves, why, and what we took from [beui.dev](https://beui.dev).

## The rule

**If you cannot say why it moves, remove the movement.** Motion here has four
legitimate jobs — explain space, confirm input, show state, soften a change —
and decoration is not one of them. This is the same instinct DESIGN.md already
had about colour and shadow ("flat, hairline > shadow", "quiet active states"),
applied to time.

Frequency decides the budget. A row hover happens a hundred times a day and has
to feel instant. A drawer happens rarely and is allowed the 280ms it needs to
explain where it came from.

## The tokens

In `src/styles/index.css`, so nothing hand-picks a duration:

| Token | Value | For |
|---|---|---|
| `--ease-out` | `cubic-bezier(0.16, 1, 0.3, 1)` | entrances and exits — respond immediately, settle quietly |
| `--ease-in-out` | `cubic-bezier(0.77, 0, 0.175, 1)` | things already on screen, accelerating and decelerating |
| `--t-press` | 120ms | press feedback |
| `--t-hover` | 120ms | hover states — the default, applied in the base layer |
| `--t-pop` | 160ms | tooltip, popover |
| `--t-panel` | 200ms | dropdown, select, sidebar collapse |
| `--t-page` | 180ms | one screen replacing another |
| `--t-sheet` | 280ms | the detail rail, drawers |

Under 300ms is the ceiling for interface motion. Anything longer is an
explanatory demo, not a control.

## The page turn

The one piece of motion here that is not a hover, a press or a panel, and the
only one that needed a decision about *when* as well as *what*.

It is the browser's own view transition — `document.startViewTransition`, which
the router calls for us. No library and no wrapper component: the browser
snapshots the screen either side of the router's state change and animates
between the two pictures. `routes.tsx` decides when one runs; `styles/index.css`
decides what it looks like.

**Only the well fades.** The scrolling content area carries
`view-transition-name: page`, which lifts it out of the root snapshot. The rail
and the sidebar are therefore exempt: their active marks answer the click
immediately, and only the content they point at is allowed 180ms to catch up.
Fading the whole frame would read as the app blinking rather than the page
turning, and it would make the nav look slower than it is.

**Only the new screen animates.** The old snapshot holds, opaque, underneath.
A true dissolve — both layers fading past each other — shows the backdrop
through the gap for a frame or two on a page this light.

**Only when the pathname changes.** Most navigations on this surface do not:
a sheet writes `?order=`, `lib/filters.ts` writes a filter, the ledger writes an
account. Those are a table refreshing in place, not a new screen, and a sheet
has an animation of its own to fight with. The rule is a predicate on
`defaultViewTransition` in `routes.tsx` rather than a flag at each call site,
because the call sites are the part that grows. `lib/sheets.ts` says it a second
time, for the browser that has view transitions but not view-transition *types*
and so never consults the predicate.

A hidden tab skips the transition and commits the navigation anyway, which is
also what a browser without the API at all does. There is no fallback to write.

## Reduced motion is a designed state

Not an off switch. Opacity and colour still carry meaning — they are how the
interface says it heard you — so they stay. What goes is travel: transforms,
scale, and anything long enough to be watched rather than felt. The base layer
handles this globally; `data-motion="travel"` marks anything that additionally
must not transform.

## Why no motion library

Everything this console animates is a colour, an opacity, a height or a
transform on **one** element, and CSS does all four without shipping a runtime.
The cases that genuinely need JS are shared-layout indicators that travel
between two elements, and drag gestures. Neither exists on this surface.

Both exist on the **till**. If Motion is ever added to this codebase, that is
where it belongs, and it should not be added here to keep the three apps
symmetrical — they are deliberately WET, and a dependency the console does not
need is not symmetry, it is weight.

## What we took from beUI, and what we left

beUI is copy-paste React built on Motion + Tailwind. Its **motion guide is
excellent and we adopted its framing wholesale** — the four-question decision
framework, the two curves, the timing bands, and reduced-motion-as-a-state are
all above.

**Left behind, deliberately.** Gooey popovers, tilt cards, metallic and
magnetic buttons, shader backgrounds, bloom menus, the Dynamic Island, glass
surfaces. These are expressive motion for marketing and consumer surfaces. This
is a console somebody uses for eight hours: it is flat, it lifts with a
hairline rather than a shadow, its overlays sit on a **white** veil rather than
glass, and its active states are quiet by rule. Borrowing that register would
not make the app livelier — it would make it a different product.

**Their command palette** has a fuzzy filter; ours matches on plain substrings
on purpose. Fuzzy matching on identifiers is worse than useless: a buyer typing
a PO number wants that PO, not five that share four digits with it.

**Worth revisiting when the need is real** — these are genuine gaps, not
missing decoration:

| beUI component | The need here |
|---|---|
| Combobox / Multi Select | We have a native `<select>`. Finance's chart is 7,528 accounts and the product picker searches a catalogue; both want a searchable panel. |
| File Tree | The chart of accounts *is* a tree, and it is currently a flat list. |
| Animated Toast Stack | DESIGN.md specifies a toast and we have none yet. |
| Bottom Sheet · Pull to Refresh · Swipeable List · Wheel Picker · Adaptive Stepper | All till and handheld patterns — `frontend-store` and `frontend-dc`, not here. |

Take the pattern, not the file: each of those would arrive in this codebase
wearing Cloud Hub's tokens, weights and white veil, or it does not arrive.
