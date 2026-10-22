# PageHeader

A PageHeader opens every page the same way: the title at 17px, the page's one action at the right, and a hairline under them that stays put while the page scrolls.

## Anatomy

- Head: padding 24px 28px 16px, bled to the page's edges so the white and the hairline reach both sides, with a 1px `hairline` under it. From 768px up it is sticky at the top of the page, and the table's heading row sticks under it (`--page-head-h`).
- Title: `title` (17px on 24px at 600, -0.3px) in `ink`, one per page, the screen's own name.
- Actions: at the right, level with the title, 8px apart, 36px high. The one solid primary stands last; a ghost, if any, stands before it.
- Under the hairline: 24px (`head-gap`) to the figures.
- A door's page (People, Pay, the Finance doors) takes the door's name for its title and draws `DoorTabs` on the head's own rule, with no padding under them.
- During navigation, the title and tabs follow the resolved page, so its actions keep the correct heading until the incoming page is ready.
- On a phone the top bar already names the screen, so a title that repeats it is not drawn, and a door's head is not drawn at all unless it has actions. The action is the dock's or the Fab's.

## Where it stands

Head, then figures, then tabs, then the bar, then the table. A slot may be empty; none moves or changes its look. A page with no action (Articles) leaves the right of the head empty.

## Rules

- The title is a name: "Purchase Orders", "Suppliers", "Articles". Not a sentence, not a verb, never bigger than 17px.
- One primary per page, at the right: "New order", "New supplier". Search, Filter, Columns and view choices belong in the bar, not the head.
- No sentence under the title and no grey crumb over it: `sub` is no longer drawn (owner, 5 Oct 2026) and `crumb` is accepted but not drawn (owner, 15 Oct 2026). The rail and the panel already say where the screen sits.
- The head sits first in `PageContent`, which gives the page 28px gutters and 24px at the top.

## Retired

- `sub`: 157 screens still pass it. Stop passing it.
- `crumb` and `small`: accepted so older screens compile, and ignored.
- The 12 screens under `/me` have their own kit (`screens/me/ui`) and no PageHeader.
- `ListHead` (`ui/list-head.tsx`), a title with a `KpiBox` at its right: no screen uses it.
- A title bigger than 17px. Only the four welcome screens draw one, at 28px: assistant/chat, home/morning, mobile/apps and setup/onboarding.

## What you provide

| Prop | Type | Notes |
| --- | --- | --- |
| `title` | `ReactNode` | The screen's name |
| `actions` | `ReactNode` | One `Button variant="primary"`, with ghosts before it if needed. Leave out on a phone, where the dock or the Fab holds it |
| `crumb` | `ReactNode` | Not drawn |
| `sub` | `ReactNode` | Not drawn |
| `small` | `boolean` | Ignored |
| `className` | `string` | Spacing only |

Source: `frontend-hub/src/components/ui/page-header.tsx`; white look in `styles/white.css` (the page head: Apple's small header).
