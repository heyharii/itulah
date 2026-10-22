# Motion

If you cannot say why something moves, it does not move. Motion has four jobs in Central:
- explain where something came from;
- confirm a press;
- show that a state changed;
- soften a change that would otherwise jump.

The more often a thing happens, the less it moves.

## The two moves

**1. Layer: something opens over what you were on.**
- On a desk a sheet slides in from the right: translate and opacity over `t-sheet` (280ms) on `ease-drawer`.
- It leaves the same way over `t-exit` (200ms), faster than it came.
- The veil fades in with it. The page under it dims and never moves.
- A layer opened from a sheet stands 12px further in, and the sheet under it dims in place.
- On a phone the drawer rises the full height over `t-drawer` (450ms) on `ease-drawer`, follows the finger, and closes on a flick.

**2. Mode: the same record switches between read and edit.**
- The sheet's frame stays put. Its contents fade out over `t-swap-out` (100ms) and the new ones fade in over `t-swap-in` (160ms) on `ease-out`.
- Nothing slides, nothing scales, the width does not change.

There is no third move: no clip-path widening, no step-back scale, no per-screen variation. A screen that seems to need one fits into these two.

## The small motions

| What | How | Token |
| --- | --- | --- |
| A press on any button | `scale(0.97)` (the Fab 0.96) | `t-press` 120ms · `ease-out` |
| A hover colour | background or colour only | `t-hover` 120ms · `ease-out` |
| A tooltip or popover | fade and scale from 0.96, from its trigger | `t-pop` 160ms |
| A dropdown, select or the panel folding | fade, and translate where it travels | `t-panel` 200ms; `ease-in-out` for the fold |
| A confirmation dialog | fade and scale from 0.96, centred | `t-panel` 200ms · `ease-out` |
| A photograph opened full size (`PhotoViewer`) | the black fades in and the photograph comes up from 0.96, centred; it leaves the same way. Never flown out of the thumbnail | `t-panel` 200ms · `ease-out` |
| One screen replacing another | the view transition | `t-page` 180ms |
| The screens panel changing department | the new list rises 4px as it fades in | `t-page` · `ease-out` |
| A tab's rule | slides to the chosen tab | `t-panel` |
| A count on the orb that rises while you are on the page | pops from 0.6 to 1 on the spring, the red fading in first; the counts a page opens with, and a count that falls, stay still | `t-spring` 500ms · `spring`, red `t-pop` |
| A row asked for with `+` (Not as Ordered on a count) | replaces the `+` row in place, fades in and settles 4px; its input is focused | `t-pop` 160ms · `ease-out` (`row-in`) |
| A field's problem line appearing | fades in and settles 2px down. No shake: the red already says it | `t-pop` 160ms · `ease-out` |
| A changing total (allocated, remaining) | Number Flow, tabular | short, and stops under reduced motion |
| A stamp pressed by your own change (Cancel, Close short, Accept) | falls from 1.2 onto the paper on the spring, the ink fades in first; a document opened already finished keeps its stamp still | `t-spring` 500ms · `spring`, ink `t-pop` |

## Never

- Do not use `ease-in` on anything a person is watching.
- Do not animate a keyboard shortcut, a row hover past `t-hover`, a live table's quiet refresh, or the clock.
- Do not scale from 0. Start at 0.96 or more, together with opacity. The one exception is the orb's 18px count, which pops from 0.6: at 0.96 it would not be seen to move.
- Do not animate width or height when a transform will do.
- Do not write a duration or a curve inline: use the `t-*` and `ease-*` tokens.

## Reduced motion

`prefers-reduced-motion` takes every move to its end state. Opacity changes may stay. Positions, scales and the sign-in door's drift stop.
