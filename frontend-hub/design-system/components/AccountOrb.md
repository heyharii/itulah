# AccountOrb

The account orb is one round control, the same on every device, that holds chat, discussions, notifications, profile, search and sign out behind a single red badge for everything waiting.

## What a tap opens

A 3 × 2 panel of tiles, in this order:

| Tile | Does | Count |
| --- | --- | --- |
| Chat | Opens `/chat` | Its unread |
| Discussions | Opens `/discussions` | Its unread |
| Notifications | Closes the panel and opens the popup beside the orb (see `NotificationBell`) | Its unread |
| Profile | Opens `/me` | None |
| Search | Opens the command palette (see `CommandPalette`) | None |
| Sign out | Signs out; disabled while it is on its way. `bad-fg` word and glyph | None |

The orb's badge is the sum of the three counts: notifications, chat and discussions. Nothing at zero, 99+ at most. The orb's name is "Rina Kusuma, 3 waiting".

## Where it stands

| Layout | The orb |
| --- | --- |
| Desk, from 1024px | Pinned in the rail's foot: 48px, in the flow, never dragged, never resting, not hidden by a sheet. Its panel grows up and to the right |
| Tablet and phone | Floating over every screen: 56px, dragged anywhere, 16px in from every edge, below any top bar and above the bottom stack (dock and tab bar). First place: the right edge, just above the stack |
| Under a record sheet | A floating orb leaves (opacity 0, no pointer events) and an open panel shuts, so a sheet's own foot is never covered |

## Anatomy

| Part | Drawn as |
| --- | --- |
| Orb | 56px (48px pinned), fully round, `canvas` at 92% over a 14px blur, a 2px `accent` ring and `shadow-float` (the ring alone when pinned). The blue ring is the owner's call (16 Oct 2026): the orb was not clear enough, so a blue ring |
| Face | A 42px disc (38px pinned) in `accent-bg`, the first letter of the person's name at 17px and 600 in `accent` |
| Badge | 18px high and wide at least, 5px a side, fully round, `bad-fg`, white digits, a 2px `canvas` ring, 1px in from the orb's top right. In the source the digits are 12px at 700: the one owner-approved small-digit badge (see `CountBadge`). The preview draws them at 15px and 600 |
| Panel | 312px wide (8px clear of the window at most), padding 10px, radius 20px, `canvas` at 94% over an 18px blur, a 1px ring at 6% black and `shadow-float`. A 3-column grid, 4px between tiles |
| Tile | 72px high, radius 14px, glyph over word, 6px apart. Glyph 22px at stroke 1.6 in `mute`; word 15px at 500 in `ink`. `soft` under a fine pointer. Its own badge sits 6px from the top, 4px right of centre |

## Behaviour

- **Tap** opens the panel beside the orb, toward the middle of the screen: left of the orb when it stands in the right half, with its bottom edge on the orb's when it stands in the lower half. 10px between them, never closer than 8px to the window.
- **Drag** moves it with the finger; a move under 6px is still a tap. Past an edge it follows less and less (3√overshoot px) and, let go there, springs back inside. Let go inside, it **stays**: there is no pull to a wall. The place is kept per browser (`hub.account-orb`) as fractions of the window, so a resized window keeps the same corner.
- **Rest.** After 2.5s untouched it steps back to 85% opacity and 92% scale. A panel or the popup open keeps it awake. Held, it is 1.06; pressed, `scale(0.97)` over `t-press`.
- **Close.** Esc, a press anywhere else, or a tile. Esc returns focus to the orb. Enter or Space on the focused orb opens it.
- **Motion.** The panel opens over 200ms (the fade 180ms) on `ease-out` from `scale(0.95)`, its tiles following 30ms apart; it shuts over 120ms. The orb's own travel takes 0.5s on the hub's spring. A badge whose count rises while you are on the page pops from 0.6 to 1 on the spring (`t-spring`), the red fading in over `t-pop`; the counts a page opens with, and a count that falls, stay still. Reduced motion drops every scale and travel: the orb jumps, the panel, its tiles and a rising badge only fade.

## Rules

- One orb, the same on every device (owner, 16 Oct 2026). Chat, Discussions, the bell, Profile and Sign out have no control of their own anywhere.
- One badge for everything waiting. A tile carries its own count; a notification never takes the selection colour.
- The orb and the Fab must never cover a card's figure or foot (owner's phone rule). The Fab stands in the dock, so it cannot. The orb floats: it rests above the dock at the right edge, 16px in, and the person drags it off whatever it covers.
- Its place and its panel are the shell's: a screen never positions it.

## Retired

- **The five separate controls.** Chat, Discussions, the bell, Profile and Sign out stood at the rail's foot, three of them again on a tablet's top bar and two as tabs of the phone's bar. They are the orb's tiles.
- **Radii outside the tokens.** The panel's 20px and the tiles' 14px are not `r-sheet` (16px) or `r-card` (10px); the orb's 56px is round by its own value. Arbitrary radii are retired: the next change moves them to the tokens.
- **Durations written in `index.css`.** 120ms, 150ms, 180ms and 200ms, `0.3s` and `0.5s var(--spring)` are literals beside `t-press` and `t-panel`. Durations come from the `t-*` tokens.
- **The badge's 12px digits at 700.** Do not copy them. A count anywhere else is `CountBadge`: 20px, digits 15px at 600.
- **No room kept for it.** Nothing in the page reserves a gutter at the right of a phone list, so a card's lead figure and its status pass under the floating orb as the list scrolls.

## What you provide

| Prop | Type | Notes |
| --- | --- | --- |
| `onSearch` | `() => void` | Opens the ⌘K palette; the shell owns it. |
| `bars` | `string` | Changes whenever the shell swaps its bars (phone, tablet, desk, a task page), so the orb looks again for the top and bottom bars it must clear. |
| `pinned` | `boolean` | Set in the rail's foot on a desk: in the flow, not dragged, never steps back. |

The orb's bars are the elements marked `data-shell-bar="top"` and `"bottom"` (the top bar, and the stack of dock and tab bar).

Source: `frontend-hub/src/components/shell/account-orb.tsx`, `styles/index.css` (`.account-orb`, `.account-orb-menu`, `.account-orb-tile`), `nav-column.tsx` (pinned in the rail), `app-shell.tsx` (floating), `bottom-bar.tsx` (its floor); the popup is `notification-bell.tsx`.
