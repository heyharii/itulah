# DoorTabs

A door's tabs stand under the page title on the page head's own rule: one row of words for the several screens a menu row stands for, with a choice of view at the right when the open tab has more than one.

## Anatomy

- A door is one menu row (`NavItem.tabs`) that stands for several screens. Each tab, and each view of a tab, is a screen with its own address, so choosing one navigates: a link to "Payables › Due › Aging" is a link. The row's own path is the first tab's first view.
- The head: the door's name as the title (`title`, 17px at 600), the page's actions at the right, 12px down to the tabs. The head has no padding under it: the tabs stand on its hairline, and the head's rule is their rule.
- The tabs: the words of `SubTabs` (15px at 500, 20px apart, the chosen one `ink` over the 2px sliding rule), with no rule of their own.
- The view choice: a visible "View" label and a 224px field, 40px high, showing the chosen view ("List"), at the right end of the row and lifted 6px off the rule. It is drawn only when the open tab has more than one view. A tab with one view (Invitations) draws none. If the tabs and choice cannot fit together, the choice wraps beneath them so the tabs retain their space.
- A tab is lit on any of its views. The first view is where the tab lands. A person sees only the tabs and views their audience allows (`useAudience`): a store manager's People has no Changes.
- `PageHeader` draws it on every path a door names, so a screen never renders `DoorTabs` itself.

## On a phone

- One chip in the dock: 44px high, `soft-2`, fully round, the word at 15px and 500 with a chevron. It says where you are: the tab, or the view when it is not the tab's first ("Aging", not "Due"), then the list's own status when it is not the first ("BKK · Draft").
- It opens one sheet titled with the door's name. A tab of several views is a heading (15px at 600 in `mute`) over its views; a tab of one view is one row. Rows are 48px; the chosen one is `accent` at 500 with a check.
- The head is not drawn on a phone unless it has actions.

## Rules

- One row of tabs per page. A screen inside a door puts its own dataset choice in its toolbar as a "Show" choice, never a second row.
- A door replaces menu rows, it does not add to them. Declare it once as a navigation row with `tabs` (`people/nav.ts` and `finance/nav.ts` do it through their `door()` helper); every other path a tab names stays routed, as a `hidden` item, and found by ⌘K under the name it had.
- A tab is a kind of work (Employees, Changes, Onboarding, Invitations). A view is the same work read another way (List and Org chart; Joining and Leaving).
- Tabs here are for pages. A sheet has none.

## Retired

- A menu row per screen: HR went from 44 rows to five doors and Finance to nine (owner, 16 Oct 2026).
- A second row of tabs under a door's (owner, 16 Oct 2026: "only one row of tabs").
- A chevron at the top of a tall phone to choose a view; the choice is the dock's chip, under the thumb.

## What you provide

You do not render `DoorTabs`; you declare a door and `PageHeader` draws it. Its props are:

| Prop | Type | Notes |
| --- | --- | --- |
| `module` | `AppModule` | Whose `useAudience` filters the tabs. Give the component a `key` of the module's id |
| `title` | `string` | The door's label |
| `tabs` | `readonly NavTab[]` | `{ label, views: { label, path }[] }` |
| `tab` | `NavTab` | The open tab |
| `view` | `NavView` | The open view |

Source: `frontend-hub/src/components/ui/door-tabs.tsx`; the head in `page-header.tsx` and `styles/white.css` (`.page-head-door`, `.door-tabs`); the door in `lib/navigation.ts` (`NavItem.tabs`).
