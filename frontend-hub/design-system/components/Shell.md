# Shell

The shell is three floating layers on a `stone` ground: the rail that names the department, the screens panel that names the screen, and the white page that holds the work.

## Anatomy

| Layer | Size and edge | Holds |
| --- | --- | --- |
| Ground | `stone`, the whole window | Nothing. It is never a content surface |
| Rail | 68px wide, no fill | Search at the top, then one icon per department, the account orb at the foot |
| Screens panel | 216px (`panel-width`), `panel` white, radius 16px (`r-sheet`), `shadow-panel`, 12px (`float`) off the top and the bottom, flush to the rail | The department's name and its screens |
| Page | White, radius 16px, `shadow-page`, 12px off the top, right and bottom and 12px right of the panel, clipped to its corners | One screen: head, figures, tabs, bar, table |

- **Rail buttons**: 40px (`rail-button`), 2px apart, an 18px icon at stroke 1.6 in `rail-mute` (`rail-text` under the pointer, on a `rail-hover` wash). A department's tile has radius 8px (`r-inner`); the Search tile at the top has 10px. The department you are in is a white tile (`rail-tile`, `shadow-rail-tile`) with its icon in `accent`. Another department with something waiting wears a red dot (see `CountBadge`).
- **Panel head**: 52px. The department's name at 20px on 28px at 600, -0.4px (`panel-title`) in `panel-ink`, and a 32px fold button (`mute`) at the right; ⌘B folds the panel away and the choice is remembered per browser.
- **Panel rows**: 36px (`nav-row`), 2px apart, radius 8px, 10px a side, 15px at 400 in `panel-body`; a count sits 8px after the word. Hover is `panel-hover`. The row you are on is `accent-bg` with an `accent` word at 600. A group label is a 22px chip, 12px at 600 in `panel-mute` on `soft-2`, radius 6px, 22px above its rows: the one text under 15px in the chrome.
- **Panel foot**: 52px, the business time ("17 Oct 2026 · 10:56") as a 32px quiet button (no border, a `soft-2` wash on hover) at 15px and 500, with a clock glyph.
- **Page**: `PageContent` gives it 28px gutters and 24px at the top; the head sticks while the rows scroll under it.

## Widths

- From 1280px the rail and the panel stand beside the page. A department with one screen has no panel, because a panel of one row only repeats its icon.
- From 1024px to 1280px (a tablet held sideways) only the rail stands. Pressing a department's icon floats its panel over the page, with a scrim to tap away.
- Under 1024px the rail and the panel become one drawer that slides in from the left over `t-sheet` and leaves over `t-exit`, behind the top bar's handle. A phone navigates from its bottom bar instead.
- When the page itself is 1300px wide or more, an open `rail` sheet stands beside the list and the page narrows to leave it room.

## Rules

- The ground is `stone` and never a surface for content. Nothing in Central darkens: the veil behind a sheet is `scrim` with a 2px blur.
- `accent` is selection: the screen you are on and the current department's icon. A count never takes it.
- The panel is the only navigation inside a department: flat rows under 12px chip labels, no fold, no second level. A tab of a door is not a row (see `DoorTabs`).
- The rail does not fold. The panel does, and a page that wants the room asks for the panel to start folded (New allotment).
- Say Central in the shell, never itulah.

## Retired

- The charcoal rail. Comments in `nav-column.tsx`, `sub-sidebar.tsx` and `app-shell.tsx` still call it dark; the `--rail*` ramp in `index.css` still holds the old greys. The rail is transparent on `stone`.
- The More fold (`SHOW_MORE = false`) and the top bar on a desk: the time moved to the panel's foot.
- The old panel head (15px title, hairlines above and below it): white.css makes it 20px and hides the rules.
- The black veil under the floating panel on a compact desk (`app-shell.tsx`, `bg-black/20`). Use `scrim` with its 2px blur, as the drawer does.

## What you provide

`AppShell` takes no props: the rail and the panel are read from `lib/navigation.ts` (departments, modules and items with `label`, `icon`, `path`, `useCount`, `badge`, `tabs`).

| Piece | Prop | Type | Notes |
| --- | --- | --- | --- |
| `PageContent` | `fill` | `boolean` | Make the column exactly as tall as the scroll area, so one long table takes the leftover height |
| `PageContent` | `children` | `ReactNode` | Every screen renders into it |
| `NavColumn` | `folded`, `variant` | `boolean`, `"docked" \| "drawer"` | The rail (docked, folded) or the drawer's full column |
| `SubSidebar` | `onFold`, `panel` | `() => void`, `NavPanel \| null` | The panel, or another department's when floating |

Source: `frontend-hub/src/components/shell/app-shell.tsx`, `nav-column.tsx`, `sub-sidebar.tsx`; white look in `styles/white.css` (the shell: stone, rail, floating panel, floating page).
