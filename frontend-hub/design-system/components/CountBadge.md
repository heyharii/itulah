# CountBadge

A count badge is a red pill with a white number for what waits on somebody: at the end of a screen's row, after a tab's word, or as a bare dot on a department's icon.

## Pick by place

| Place | Shape | Looks |
| --- | --- | --- |
| End of a screen's row in the panel | Count | At least 20px wide and 20px high, 5px a side, fully round, `bad-fg` fill, the number in `on-dark` at 600 (15px, tabular), a 2px `panel` ring. 8px after the label |
| A department's icon in the rail | Dot | 8px, `bad-fg`, a 2px `stone` ring, 6px in from the icon's top right corner. No number: the number is on the panel's rows |
| After a tab's word in `SubTabs` | Alert | The same 20px pill, 6px after the word, no ring |

## Rules

- Red and white, always. `NavItem.badge` may ask for `warn` or `bad`; white.css paints every count `bad-fg`.
- The one exception is `badge: "quiet"` (Sales › Unmatched sales, owner 23 Oct 2026): a plain grey number in `mute` at 500, no pill, no ring, on the active row too. It says how many there are, not that somebody is waited on, so it never adds to a department's rail dot.
- A zero draws nothing, and so does a count that is not known yet (`null`).
- 99+ at most. Below that the number is grouped with `count()`.
- A notification never takes the selection colour. On the active row (`accent-bg`, an `accent` word at 600) the count stays red with its white ring.
- The department you are in has no dot: its counts are on the rows of its panel. Every other department shows the dot when anything counts inside it.
- A count says what waits for somebody (a count to review, a request to decide, an order overdue). A total of active records is not a notification.
- Counts come from a `useCount` hook on the navigation entry, never from a number written into the menu.

## Retired

- Tinted pills: `screens/mobile/apps.tsx` (`Waiting`) draws the count in `bad-bg` or `warn-bg`, 28px wide.
- Counts in blue: unread counts in `workplace/chat.tsx:794` and `workplace/discussions.tsx:1114` (`bg-accent`), and the phone tab bar's waiting dot (`shell/bottom-bar.tsx`, `bg-accent`). Blue is selection.
- The account orb's badge (`shell/account-orb.tsx`): 18px high, 12px digits at 700. It is the one owner-approved small-digit badge; do not copy it.

## What you provide

There is no exported component. `Count` in `nav-column.tsx` draws the row and the rail shapes, and `SubTabs` draws its own alert.

| Where | Prop | Type | Notes |
| --- | --- | --- | --- |
| `NavItem`, `AppModule`, `AppDomain` | `useCount` | `() => number \| null \| undefined` | A hook. `null` means not asked yet; `0` means nothing waits. Both draw nothing |
| `NavItem`, `AppModule`, `AppDomain` | `badge` | `"bad" \| "warn"` (`NavItem` also `"quiet"`) | Read, then repainted red in the white look. `"quiet"` stays a grey number |
| `SubTab` | `alert` | `number` | Draws the Alert after the tab's label |

Source: `frontend-hub/src/components/shell/nav-column.tsx` (`Count`), `sub-sidebar.tsx`, `src/components/ui/sub-tabs.tsx`; white look in `styles/white.css` (`.nav-badge`, `.nav-count`, `.nav-dot`).
