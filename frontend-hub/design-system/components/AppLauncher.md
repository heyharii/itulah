# AppLauncher

The app launcher is the phone's first tab: a greeting, then one 56px row per department, each with an icon in its own hue, so a department is found by its colour before it is read.

## When to use it

| Job | Use |
| --- | --- |
| Offer every department a phone may open | `Apps`, the launcher screen (`/apps`) |
| Show a department's icon | `AppIcon`, sized `lg`, `md` or `sm` |
| Open the department's other screens from the bottom of a phone | `AppSheet`, from the bottom bar's More tab |

A desk has no launcher: the rail does this job. A cashier has no apps: the launcher is empty, and their messages, notifications and profile are the account orb's.

## Anatomy of the screen

| Part | Drawn as |
| --- | --- |
| Greeting | The date above in 15px at 500 in `mute` ("Sat 17 Oct"), then the page's large title: 28px, line height 1.12, 600, -0.025em, in `ink` ("Good morning, Rina": the hour and the first word of the person's name; "Hello" until the page is hydrated, because the browser alone knows the hour). No card round it. One of the four welcome screens that are bigger than `title` |
| Unread row | Only while something is unread: 64px high at least, 24px under it, a `hairline` frame, radius 16px, 16px padding. A 40px disc with a bell, then "2 unread notifications" at 600, then a ›. A press gives `scale(0.985)` |
| Apps label | "Apps", 15px at 600 in `ink`, 10px above the list, 4px in |
| List | One white panel, a 1px `hairline` frame, radius 24px, a `hairline` between rows. Rows are not boxes |
| Row | 56px high, 14px sides, 12px between parts: the tile, the name at 16px and 500, the count, a 16px › in `line-ico`. A press is `soft` under the row and `scale(0.92)` on the tile, over `t-press` |
| Search row | "Search or jump to…" as one more row, 12px under the list, the same frame: a 36px tile in `soft-2` with a glass in `body`. It opens the command palette, and is drawn only inside the shell |
| Count | At the end of a row: what waits in the department, the same total as the desk rail's dot. Nothing at zero, 99+ at most |

## The tile

| Size | Tile | Radius | Glyph | Where |
| --- | --- | --- | --- | --- |
| `lg` | 56px | 17px | 26px | The default |
| `md` | 36px | 11px | 18px | A launcher row |
| `sm` | 32px | 10px | 17px | The head of `AppSheet` |

- A white glyph at stroke 1.9 on the department's own hue, the department's own lucide icon. The hue is looked up by the tile's id (`--app-<id>`); a tile with no hue of its own takes `app-system`'s grey rather than a guess.
- The tile catches a soft top light: white at 20% fading to clear by 58% over the hue, a `0 1px 2px` shadow at 12% and a 0.5px inset edge at 6% black.

## The hues

One hue per department, used for exactly one thing: the icon tile. On a launcher colour is how a tile is found: fifteen identical white squares were read tile by tile; a blue cart and a purple megaphone are found before they are read. Each carries a white glyph at 3:1 or better.

| Token | Tile |
| --- | --- |
| `app-home` | Home (hidden today) |
| `app-executive` | Executive |
| `app-buying` | Procurement |
| `app-merchandise` | Merchandise |
| `app-ops` | Ops |
| `app-inventory` | Inventory |
| `app-marketing` | Marketing |
| `app-selling` | Sales |
| `app-finance` | Finance |
| `app-hr` | HR |
| `app-ga` | GA |
| `app-library` | Files |
| `app-reports` | Reports |
| `app-system` | System, and Master, which has no hue of its own |

## Rules

- The `app-*` hues are drawn here and nowhere else: not a chip, a row, a rail icon or a chart.
- A row goes straight into its department, on the screen its desk rail opens on (`landingOf`), never to a list to choose from first (owner, 6 Oct 2026). A department with exactly one screen opens that screen. The others are the bottom bar.
- Rows, not a grid of icons (owner, 6 Oct 2026: the launcher is rows only): four icons across 375px left each name 83px, and "Procurement" and "Merchandise" touched.
- Departments in the owner's order of 28 Sep 2026: Executive first, then the order goods and money move (bought, described, handled, held, priced, sold, paid), then the people and the places; then Files, Reports and, for an admin, System.
- The audience is by role for now (owner, 25 Sep 2026): a cashier sees none, a supervisor every department, an admin every department and System. The server's refusal is still the control.
- `AppSheet` lists the same rows as the desk's column (`DepartmentScreens`), with the same audience rules and counts, 44px under a finger, so the phone cannot disagree with the desk. Any link inside closes it.

## Retired

- **Tinted counts.** `Waiting` draws the count in `bad-bg` or `warn-bg`, 28px wide, amber by default. A count is the red `CountBadge`.
- **The unread row's blue disc and its second line.** A notification never takes the selection colour, and "What is waiting on you" is a helper line. The orb already carries the total.
- **A stale empty sentence.** "No office apps for this account. Your messages, notifications and profile are in the bar below." The bar lost Chat and Activity on 16 Oct 2026; they are the orb's tiles.
- **Radii outside the tokens.** 24px on the list and the search row, 16px on the unread row, 11px, 17px and 10px on the tiles: none is `r-card` (10px) or `r-sheet` (16px). `shadow-soft` on the same boxes is switched off by white.css; remove the class.
- **The dark `AppSheet`.** `tone="dark"` draws the charcoal of the rail the white look retired, and `--rail` is `transparent` in white.css, so `bg-rail` leaves the sheet with no fill. Use the light `BottomSheet`.
- **Hues that name nothing.** `app-finance-new` is a Finance that was folded into one module on 26 Sep 2026, and `app-home` waits for a Home tile that is hidden.

## What you provide

| Piece | Prop | Type | Notes |
| --- | --- | --- | --- |
| `AppIcon` | `id` | `string` | Picks `--app-<id>`. |
| | `icon` | `LucideIcon` | The department's own icon. |
| | `size` | `"lg" \| "md" \| "sm"` | Default `lg`. |
| | `className` | `string` | Layout and the press scale only. |
| `AppSheet` | `tile` | `AppTile \| null` | The department whose screens it lists. |
| | `open`, `onOpenChange` | `boolean`, `(open: boolean) => void` | |
| `Apps` | none | | The screen. Reads the identity, the notification feed and the palette opener. |

`appsFor(role)` returns the tiles a role is offered. An `AppTile` has `id`, `label`, `icon`, `modules`, `useCount?` (a hook, read only by the row that draws it) and `badge?`.

Source: `frontend-hub/src/screens/mobile/apps.tsx`, `src/components/shell/app-icon.tsx`, `app-sheet.tsx`, `src/lib/apps.ts`; hues in `styles/index.css` (`--app-*`, `.app-icon`).
