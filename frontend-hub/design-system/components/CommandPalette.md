# CommandPalette

The command palette is the hub's one global search: ⌘K (Ctrl+K) or the rail's Search tile opens a centred dialog that jumps to any screen and opens any record, everywhere by default.

## How it opens

| Where | Door |
| --- | --- |
| Desk | ⌘K or Ctrl+K, which also closes it again. The Search tile at the top of the rail: 40px, radius 10px, a glass in `rail-text`, and an instant tooltip "Search  ⌘K" 10px to its right |
| Tablet | The drawer's "Search or jump to…" row, and the account orb's Search tile |
| Phone | The account orb's Search tile, and the "Search or jump to…" row at the foot of the Apps launcher. A phone has no ⌘K |
| A screen | `useOpenPalette()` returns the opener, or `null` outside the shell. Only a place with no keyboard and no rail asks for it |

There is no search banner above the working surface and no "Find anything" bar (UI-PATTERNS, 14 Oct 2026).

## Anatomy

| Part | Drawn as |
| --- | --- |
| Veil | `scrim` over the whole window |
| Dialog | 576px wide (36rem), 32px less than the window at most, centred, its top 15% of the window height down. `canvas`, 1px `hairline`, radius 10px (`r-card`), `shadow-float`, corners clipped. It appears and leaves with no motion |
| Search row | Padding 12px 14px, 10px between parts, a `hairline` under it: the scope chip, the text field, the `tab` keycap |
| Scope chip | 26px high, fully round, 10px padding, 15px at 500. **Everywhere**: `accent-bg` with an `accent` word and a 12px globe. **A module** ("Procurement"): `soft-2` with a `body` word, `ink` on hover |
| Text field | No border, 15px in `ink`, no placeholder; its name is the dialog's hidden title, "Search". 16px under 48rem, so iOS does not zoom |
| `tab` keycap | 15px in `body`, a 1px `hairline-2` box, 6px radius. Not drawn under 48rem |
| Screens | First, under no heading. At most 12 |
| Records | A `hairline` rule 6px under the screens, then the label "Records" (15px at 600 in `mute`) with 10px above it and 4px under it |
| Row | Padding 8px 14px, 10px between parts: a 16px glyph in `line-ico` (a record has an empty 16px slot), the name at 500 in `ink` on one line, the subtitle in `mute` at the right on one line. The highlighted row is `soft` and ends with a 12px ↵ in `faint`. 44px high under a finger |
| Results box | Scrolls past 384px (24rem), 6px of air above and below |
| Notes | One 15px line in the box: "Looking through every module…" in `mute`; "Nothing in any module matches “zzz”." centred in `body`, 24px above and below |

A screen row reads *Purchase Orders* at the left and *Procurement* at the right. A record row reads *PO-161026-010* at the left and *Purchase orders · Garmen Nusantara, PT · Active* at the right: the list it came from, then the record's own subtitle.

## Keys

| Key | Does |
| --- | --- |
| ↑ ↓ | Moves the highlight. Hovering a row moves it too |
| Enter | Opens the highlighted row. The row is a form submit, so it survives an IME |
| Tab | Flips between Everywhere and the module you are in |
| Esc | Closes it |

## Rules

- One search for the whole hub: screens and records in one box, kept apart by the Records label.
- It starts at **Everywhere** (owner, 1 Oct 2026). Across the modules one word names a supplier, a store and an employee, so Tab narrows it, and the chip says out loud which scope it is in: a search that narrows quietly makes missing results look like missing data.
- A match is a plain, case-insensitive substring, never fuzzy: someone typing a PO number wants that PO. Records are asked for from 2 characters.
- Screens come from the navigation registry, so a screen added to the menu is findable in the same commit. It offers only what the menu would show this person: the same section check, no `soon` module, and no department this deployment hides (HR and GA on the public demo). ⌘K is not a side door.
- Records come from 16 sources, each naming itself in the subtitle: purchase orders and suppliers (the server's `global_search`, newest first within a rank), accounts, discussions and articles (a `q` on the server; an article matches its code, a SKU, its name, a QR payload, an EPC and the supplier's own code), and the loaded lists of the rest. A hit opens as a layer on its own screen, through its `sheet` key.
- A source that fails leaves the others standing: the box never empties because one list is down.
- The highlighted screen is fetched once the highlight rests for 120ms, so Enter lands warm.
- The palette is the one centred layer that is not a confirmation. It stands on Base UI's `Dialog` directly, not on the kit's `Dialog` (384px, padding 20px, scale-in): do not copy its size for a form.
- Nothing darkens. The veil is `scrim`.

## Retired

- **The scope chip's `info-fg` word.** `info` means in motion; a chosen scope is selection, so `accent-bg` takes an `accent` word.
- **The `tab` keycap in mono, at radius 5px.** White.css's mono override reaches neither a `kbd` nor anything portalled outside `.shell-page`. The rail's own ⌘K keycap is already `font-sans`. Use the sans face and `r-chip` (6px).
- **Instructions in the empty line.** "Press tab to search everywhere." and "Type to search." say how the box works. Say only what was not found.
- **A "nothing matches" line while the records are still loading.** The line depends on `rows`, which is empty until the query lands, so a narrowed search draws "Nothing in Procurement matches …" and "Looking through Procurement…" together.
- **A veil with no blur.** `Dialog.Backdrop` here is `scrim` alone; every other veil is `scrim` with a 2px backdrop blur.
- **Three different resets.** Closing with Esc or a press outside puts the next opening back on Everywhere. Choosing a row (`dismiss()`) puts it on the module you land in. Closing with ⌘K changes nothing, so the old query and scope are still there. Every opening starts empty, at Everywhere.
- **The old doors.** The top bar's "Find anything" and the sidebar's ⌘K rows were taken out on purpose; do not bring them back.

## What you provide

| Prop | Type | Notes |
| --- | --- | --- |
| `open` | `boolean` | Held by `AppShell`, which also binds ⌘K. |
| `onOpenChange` | `(open: boolean) => void` | |

To make a new kind of record findable, add a `SearchSource` to `searchSources` in `lib/search.ts`: `module` (a module id), `label` (what the subtitle says: "Purchase orders"), and `run(query, client, signal)` returning `SearchHit`s: `id`, `title`, `subtitle?`, `to` (the screen) and `sheet?` (`{ key, value }`, the record to open there).

Source: `frontend-hub/src/components/shell/command-palette.tsx`, `palette-opener.ts`, `lib/search.ts`, `components/ui/rail-tip.tsx`; the opener is bound in `app-shell.tsx`, the rail's tile is `RailFinders` in `nav-column.tsx`, and `screens/mobile/apps.tsx` reads the opener. `use-jump.ts` is the virtual clock's jump detector, not the palette's: see `TimeTravel`.
