# TimeTravel

Time travel is the tester's clock: the business time in the screens panel's foot and, for an Admin where the node has test controls, the panel that pushes it forward, with a violet card that says this time is not real.

## Who sees what

| Who | Sees |
| --- | --- |
| Everyone, on a desk | The business time in the screens panel's foot: an 18px face in `line-ico` and "17 Oct 2026 · 10:56" at 15px and 500 in `ink`, as plain text |
| An Admin, where the clock endpoint answers (a node with test controls) | The same, as a 32px quiet button (`soft-2` under the pointer and while open) that opens the panel |
| An Admin on a tablet | `bar`: in the top bar a 32px button with a clock glyph and "Time" |
| Anyone else on a tablet or a phone | Nothing |
| While the clock is bent | The pill "● Virtual clock" before the date, which carries "· 20 days ahead" in `mute`. On the tablet bar the button wears `warn-bg` with a `warn-fg` word and the short date ("06 Nov") |

The business time is always Asia/Jakarta (UTC+7, no daylight saving), whatever zone the browser is in. The clock draws after hydration, so the hands never jump on arrival.

## The panel

| Part | Drawn as |
| --- | --- |
| Popover | 24rem (384px), 32px less than the window at most. `canvas`, 1px `hairline`, radius 10px (`r-card`), `shadow-pop`, 8px under its trigger, aligned to its end. Grows from its trigger over `t-pop` |
| Head | Padding 16px 20px. "Time travel" at 600, then the face and the moment. With the real clock: a 72px face in `ink` with ticks, "Sat 17 Oct 2026 · 10:56" at 18px and 600, and "Real time" in `mute`. With a bent clock: the violet card below |
| Jumps | A `hairline` over it, padding 16px 20px, 16px between rows: four ghosts in two columns, 10px apart (+1 day, +7 days, +30 days, Next month); one date field, "Pick a date" (40px; today and earlier are dead); a quiet "Back to real time" while bent; a problem in `bad-fg` |
| Advanced | A closed 40px row under a `hairline`: a speed box ("Speed, times real", 1 to 60 000) with "Set speed", and Pause or Resume while bent |

- A chosen day goes to its midnight. A chosen day, or a jump of 30 days or more, asks first: "Jump to Fri 06 Nov 2026 · 14:05?" with "Cancel" then "Advance", and "Business time moves 30 days ahead. It cannot be moved back; records made from now on carry the new dates." Shorter jumps run at once and a toast says "Now 18 Oct 2026".
- "Back to real time?" asks first, too: "Business time returns to the real clock. Records made while it was ahead keep their dates."
- A target that is not after now is refused where it is asked: "Time only moves forward. Pick a moment after now."
- From the wall clock the first jump starts a virtual clock at real speed from the target. After that every jump is `advance_to` and keeps the speed it has.

## The virtual clock card

Violet is the one colour that means this time is not real. The `space-*` tokens are drawn here and nowhere else.

| Part | Drawn as |
| --- | --- |
| Field | A 90° gradient: `space-a` to 25%, `space-mid` at 55%, `space-b` from 90%; a 1px inset ring in `space-dust` at 14%. Radius 10px in the panel, fully round in the pill |
| Label | "Virtual clock" at 500 in `space-ink` after an 8px `space-core` dot that breathes (2.4s: 65% to 100%, scale 0.9 to 1.1). After each jump a ring leaves the dot once (2s, to 3.2 times its size) |
| Moment | 18px at 600, -0.01em, in `space-ink`; under it "20 days ahead of real" in `space-ink-2`, and the speed ("Running 24× faster than real", "Paused", "Stopped at this moment") when it is not real speed |
| Disc | `space-core`, opaque: 72px face and 8px of disc (80px) in the card, 20px and 4px (24px) in the pill. White hands in `on-dark` (8.0:1), ticks at 12, 3, 6 and 9 on the big face |
| Pill | 28px high, 208px wide (13rem), 12px in at the left and 2px at the right, the face at its end |
| Dust | A canvas under the words: 1 or 2px square grains and a few round dots up to 3px. 70% of them drift toward the disc along gentle curves, quicker as they near, and fade and shrink to nothing on arrival; the rest twinkle in place. `space-dust` over the pale half, white grains from 25% to 60% across, never darker than 30% over the label |

Ink holds 6.0:1 or better on the field up to 69% across, `space-ink-2` 5.6:1.

## Motion

- Between jumps the hands glide a few degrees (400ms, `ease-out`) and the digits swap.
- On a jump the hands whirl on, the minute hand three extra turns and the hour hand one (650ms), and each digit group rolls out and in, 240ms, 45ms apart: day, month, hour, minute. The dust streaks and brightens for 650ms.
- A jump is a leap of more than ten minutes between two renders (more at speed): an Advance, Back to real time, or somebody else's jump seen on the next poll.
- The dust paints 30 frames a second at most, none while the tab is hidden or the clock is paused, and one still frame under reduced motion. At speed it flows up to 4 times as fast.
- The readout is redrawn every 30 seconds, every second while the clock runs faster than real.
- Reduced motion: the hands do not whirl, a roll is a 150ms fade, the dot holds still and the ring never leaves.

## Rules

- Forward only (owner, 2 Oct 2026). There is no rewind and no extra warning. The one way back is "Back to real time". If something must be rewound, restore the data from a snapshot.
- When the clock is bent, say so in words ("Virtual clock") and not by colour alone.
- Violet and the dust belong to this clock. Do not borrow them for anything else, and do not add another motion to the clock.
- The clock writes a moment as `Sat 17 Oct 2026 · 10:56`: weekday, year, a middle dot, 24-hour time, always in Jakarta. The weekday goes only where 15px leaves no room, as in the panel's foot.

## Retired

- **The desk's top strip.** `DeskBar` held the clock alone; on 4 Oct 2026 the time moved to the panel's foot. The component is still in `top-bar.tsx`.
- **Heights set with a class.** The four jump buttons and "Back to real time" are written `h-10` (40px). Buttons are 36px (`control`); only the date field is 40px.
- **A pill wider than its place.** The pill is 208px and the panel's foot has 184px between its paddings (216px, less 16px a side), before the date.
- **Tokens missing from the list.** `--space-dust` (the ring and the dust over the pale half) and `--space-grain` (white grains) are in `styles/index.css` but not in the token file.
- **A second form of the moment.** `momentLabel` writes `Fri 06 Nov 2026 · 14:05`; `dayTime` in `lib/format.ts` writes `06 Nov 2026, 14:05`. One fact has two forms.
- **Motion beyond the two moves.** Animating the clock is against `04-motion`. It stays for this one tool, from the owner's reference; copy none of it to another surface.

## What you provide

| Piece | Prop | Type | Notes |
| --- | --- | --- | --- |
| `TimeTravel` | `place` | `"header" \| "bar"` | `header`: the panel's foot, shown to everyone. `bar`: the tablet's top bar, only for whoever may move the clock |
| `TimeTravelPanel` | `status`, `bent`, `business`, `jump`, `burst`, `busy`, `problem` | `ClockStatus`, `boolean`, `number`, `Jump \| null`, `boolean`, `boolean`, `string \| null` | The popover's body |
| | `onJump`, `onBack`, `onControl`, `onSpeed` | functions | A jump asks first when `chosen` or 30 days or more |
| `AnalogClock` | `ms`, `jump`, `size` | `number`, `Jump \| null`, `number` | A ring and two hands in `currentColor` |
| | `ticks`, `weight`, `className` | `boolean`, `number`, `string` | Ticks only on a big face; `weight` is the stroke in a 24-unit box (1.7, or 0.9 on the 72px face) |
| `Moment` | `ms`, `jump`, `wrap`, `weekday` | `number`, `Jump \| null`, `boolean`, `boolean` | `wrap` may break between groups; `weekday` is on by default |
| `SpaceClock` | `ms`, `jump`, `size`, `pad` | `number`, `Jump \| null`, `number`, `number` | The face in its disc |
| `VirtualPill`, `VirtualLabel` | `ms`, `jump`, `speed`, `paused`, `burst` | | The pill and the label inside it |
| `ParticleField` | `target`, `speed`, `burst`, `paused` | `{ x, y }` (0 to 1), `number`, `boolean`, `boolean` | The dust, aimed at the disc |
| `useJump(ms, threshold)` | | `Jump \| null` | `{ id, dir }`: null until a leap, and for the first instant it sees |
| `useBurst(jump, ms = 650)` | | `boolean` | True for 650ms after each jump; a jump on record at mount is old news |

Source: `frontend-hub/src/components/shell/time-travel.tsx`, `time-travel-panel.tsx`, `time-clock.tsx`, `particle-field.tsx`, `use-jump.ts`, with `src/lib/time-travel.ts` and `styles/index.css` (`--space-*`, `.space-bg`, `.space-core`, `time-*`). It is mounted in `sub-sidebar.tsx` (the panel's foot) and `top-bar.tsx`.
