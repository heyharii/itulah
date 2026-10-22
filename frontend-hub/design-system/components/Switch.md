# Switch

One family for on/off and choose-one: a switch for a state of the world, a switch pill to narrow a list, a toggle that changes the questions, tiles to choose one of a few, and a stepper for a small count.

## Pick by the job

| The question | Use | Looks |
| --- | --- | --- |
| A state of the world that changes the moment it is released: active, paused, live | `Switch` | A 30 × 18 track and a 14px knob |
| Narrow a list by a yes/no, in the bar | `SwitchPill` | A switch with its words, in a bordered box |
| A yes/no that changes what the form asks next | `Toggle` | A switch, its word, and a note on what is true now |
| One out of a handful, where each needs a sentence | `Choices` | Tiles, exactly one on |
| One of two or three words, switching a view | `Segmented` | Its own card |
| A yes/no kept among the other answers of a form | `Checkbox` | The Field card |
| A small count: units, baskets, a limit | `Stepper` | A minus, the figure, a plus |

## Anatomy

- **Switch**: a `role="switch"` button, 30px by 18px (`switch-w`), a full pill. Off is `soft-3`, on is `accent`. The knob is 14px in `canvas`, 2px in from the edge, and travels 12px by transform alone over `t-pop` (160ms) on `ease-out`. No ring, no shadow. Pending is faded to 70% and `aria-busy`: it is about to move. Disabled is 50%: it never will. A press stops at the switch and never opens the row under it.
- **SwitchPill**: the switch and its words inside one bordered box, 36px high (`control`), padding 0 10px, 8px between switch and word, radius 8px, 1px `hairline-2`, 15px `ink`. The whole box is the target, and it grows to 44px under a finger. A bare switch beside text reads as nothing, because `soft-3` is the lightest wash; the pill gives it a frame.
- **Toggle**: padding 10px 12px, radius 8px, 1px `hairline`, `canvas`; on, the fill is `accent-bg`. The switch stands 2px down at the left. The word is 15px at 500 in `ink`, and under it the note is 15px in `body`. The note says what is true now and changes with the switch.
- **Choices**: a radio group of tiles in a grid of one, two or three columns, 8px apart, one column on a phone. A tile is padding 10px 12px, radius 8px, 1px `hairline-2`. The chosen tile is `accent-bg` with a 1px `accent` ring inside it and its word turns `accent`. The word is 15px at 500; an optional note is 15px in `mute`; an optional 30px glyph stands at the left. An option that is refused stays visible on a row of its own with its reason written on it. The arrow keys move between tiles.
- **Stepper**: in a form it is the form's box: 40px, radius 8px, 1px `hairline-2`, with 32px round steps whose 14px glyphs are `line-ico`, and the figure centred, tabular, 15px. In a bar it is a 36px `soft-2` pill. Empty is not zero: "no limit" and "0" are opposite instructions.

## Rules

- A switch acts when released. A value that is kept and sent later is a `Checkbox`, a `Toggle` or `Choices`.
- The label names what is controlled, in sentence case, and never flips with the state: "Group by supplier", "Active order".
- A toggle's note states what is true now: "Suppliers deliver straight to the stores." / "Suppliers deliver to the warehouse, and it ships to the stores." A note that does not change with the switch is a helper sentence: delete it.
- Tiles are for a handful of options where each one needs a sentence. A longer list is a `Select`.
- Exactly one tile is on, always.
- In a bar use `SwitchPill`; in a form use `Toggle`. Do not stand a bare `Switch` among words.

## Retired

- **`capitalize` on the words.** The `Toggle` and `Checkbox` labels carry it. Labels are sentence case; remove the class from the kit. (`SwitchPill` dropped it on 17 Oct 2026, so "Group by supplier" now reads as written.)
- **A pill-shaped Stepper in a bar.** The group is a full pill with round steps; `r-full` is for round things only. Copy the form's box.
- **A hand-made switch or tile.** Draw it with this family, so the knob, the ring and the tint stay one.

## What you provide

| Part | Props | Notes |
| --- | --- | --- |
| `Switch` | `on`, `onToggle`, `label`, `busy?`, `disabled?` | `label` is the accessible name. |
| `SwitchPill` | `on`, `onToggle`, `label`, `count?`, `className?` | `label` is also the visible word. `count` is how many rows the switch would leave, after the word in `mute` as a tab's count is ("Due for renewal 4"). |
| `Toggle` | `on`, `onToggle`, `label`, `note`, `busy?`, `disabled?`, `className?` | `note` is required, and changes with `on`. |
| `Choices` | `options`, `value`, `onChange`, `columns?` (1, 2 or 3), `label?`, `disabled?`, `invalid?`, `required?`, `className?` | A tile is `{ value, label, note?, icon?, tag?, refused? }`. `refused` is the reason, and disables it. |
| `Stepper` | `value` (text), `onChange(text)`, `min?` (0), `max?`, `suffix?`, `label`, `disabled?`, `invalid?`, `required?` | `""` is empty, not zero. |

Source: `frontend-hub/src/components/ui/form.tsx` (`Switch`, `SwitchPill`, `Toggle`, `Choices`, `Stepper`); look in `styles/white.css` (`.choice-tile`, `.switch-row`).
