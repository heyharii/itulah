# NotificationBell

The notification bell is the account orb's Notifications tile and the popup it opens: the newest five things that need somebody, counted once on the orb's badge, with the switch for push on this device at its foot.

## What is a notification

| | Log (`audit_log`) | Notification |
| --- | --- | --- |
| Records | Every write, and every refusal | What is worth interrupting somebody for |
| Calls anybody | Never | Always |
| Read from | A record's Activity, and System › Activity | The bell |

- A notification is raised for the people who can act on it, at the place it happened: "A supplier invoiced a different price", "Goods arrived without an identity", "Cikupa's server is ready", a promotion that crossed its guardrail, a discussion that mentioned you.
- A thing that merely happened is the log's. "A notification for everything that merely happened trains people to dismiss all of them."
- Active totals are not notifications. A count on a department says what waits for somebody (see `CountBadge`).

## Where it shows

| Surface | Shows |
| --- | --- |
| The orb | One red badge for everything waiting: notifications, chat and discussions together. Nothing at zero, 99+ at most |
| The orb's Notifications tile | Its own count, and opens the popup |
| The popup | The newest five |
| System › Notifications | The whole list, Unread or All (the popup's "See everything") |
| The Apps launcher on a phone | An "N unread notifications" row above the apps |
| The device | Web Push when it is switched on, and the app badge |
| A toast | Only the `store.server.*` kinds: "Cikupa's server is ready", with Open, for 9s (`StoreServerNews`) |

## The popup

| Part | Drawn as |
| --- | --- |
| Placement | Beside the orb, 10px off it, toward the middle of the screen, 8px clear of the window. It grows from the orb over `t-pop` (160ms) from 0.95 with a fade, and goes the same way |
| Popup | 352px wide (22rem), 16px less than the window at most. `canvas`, 1px `hairline`, radius 10px (`r-card`), `shadow-pop`, no padding. Scrolls past 352px |
| Head | Padding 8px 12px, a `hairline` under it. "Notifications" at 600 in `ink`; at the right "2 unread" in `mute`, only while something is unread |
| Row | Padding 10px 12px, 8px between a dot and the text, a `hairline` between rows. Title 15px at 500 in `ink`; the body two lines at most in `body`; the time in `mute` as `dayTime` ("17 Oct 2026, 10:56"). 2px between lines |
| Unread row | A `soft` wash and a 6px `accent` dot. A read row has a `hairline-2` dot |
| Row that leads somewhere | The whole row is the target, `soft-2` under the pointer. A kind no screen shows by id (`recordRoute`) stands as a plain sentence |
| Empty | "Nothing is waiting for you." centred in `mute`, 24px above and below |
| Push | A `hairline` over it, padding 10px 12px: `PushControl` |
| Foot | A `hairline` over it, padding 8px 12px: "See everything" at 500 in `accent` |

Following any link in it closes it. A press elsewhere or Esc closes it too.

## Push, one state at a time

| State | Says | Control |
| --- | --- | --- |
| Off | "Get notified on this device, even when the app is closed." (retired, see below) | "Turn on notifications" with a bell-ring glyph; "Turning on…" while it asks. The browser's permission question comes only after this press, never on load |
| On | "Notifications are on for this device." | "Turn off" |
| Asked and not given | "Permission has not been given. Press again if you want to receive notifications." | The same button |
| Blocked | "Notifications are blocked for this site. Allow them in the browser’s site settings, then reload the page." | None |
| Server not set up | "Push notifications are not turned on for this server yet." | None |
| Browser cannot | "This browser cannot receive push notifications. This list still updates while the page is open." | None |
| iPhone or iPad, not installed | Why, then three steps: Share, Add to Home Screen, open Central and turn it on | None |

A failed attempt says the server's sentence in `bad-fg`, or "Notifications could not be turned on. Try again." "Install app" stands under any state when the browser offers it. The control draws only after hydration: the browser alone knows its permission.

## Rules

- Say what happened in the title, as a sentence, and the facts in the body: who, what, how much. Dates and times come from `dayTime`.
- A popup is a glance: "is there anything" and "what is the newest". Anything longer is a reading task for the page, with its filters.
- The stream keeps the badge and the popup current the moment something arrives or is read elsewhere. While it is down, one poll a minute stands in.
- A state that explains why somebody will not be told keeps its sentence. A state with a button says nothing else.
- A toast is for news the person is waiting for (a store server connecting), never for the list.

## Retired

- **The bell as a control of its own.** It was an icon on the rail, on a tablet's top bar and a phone's Activity tab. It is the orb's tile (owner, 16 Oct 2026).
- **The `activity` broadcast.** Every successful action raises a notification to every active user (the console's "notify on every action"). That is the noise the log exists to absorb: keep the log and stop raising `activity` once the queue is the problem (`AUDIT.md`).
- **A helper sentence in Push.** "Get notified on this device, even when the app is closed." The button says it. Keep the iPhone steps, which push cannot work without, and the sentences that say why somebody will not be told.
- **Small buttons in a popup.** "Turn on notifications", "Turn off" and "Install app" are `size="sm"` (28px), a size for a table row, and "Install app" and "Turn off" are `quiet`. Every supporting action is a 36px ghost.
- **A foot that scrolls out of sight.** The popup takes `POPUP` from the filter menus (`max-h` 22rem, scrolls), so five rows push the push control and "See everything" below the fold.

## What you provide

| Piece | Prop | Type | Notes |
| --- | --- | --- | --- |
| `useNotificationFeed()` | none | query | The one cache entry behind the badge, the launcher line and the popup: the newest 8, 30s stale |
| `NotificationsPopover` | `feed` | `useNotificationFeed()` | |
| | `open`, `onOpenChange` | `boolean`, `(open: boolean) => void` | Controlled and triggerless: the orb is what is pressed |
| | `anchor` | `RefObject<Element \| null>` | The orb |
| | `side`, `align` | `"left" \| "right"`, `"start" \| "end"` | Toward the middle of the screen |
| `PushControl` | `className` | `string` | Layout only |
| `StoreServerNews` | none | | Mounted once; draws nothing, only listens |

A row reads `title`, `body`, `created_at`, `read_at`, and `subject_kind` with `subject_id`, which `recordRoute` turns into a screen and the record's `sheet`.

Source: `frontend-hub/src/components/shell/notification-bell.tsx`, `push-control.tsx`, `store-server-news.tsx`, with `lib/notification-stream.ts`, `lib/record-route.ts`, `lib/filter-chrome.ts` (`POPUP`) and `frontend-hub/AUDIT.md`.
