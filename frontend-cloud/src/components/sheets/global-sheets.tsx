import { NotificationSheet } from "@/components/notifications/notification-sheet"
import { BasketSheet } from "@/components/sourcing/basket-sheet"

/// Every sheet that belongs to the whole app, mounted once.
///
/// There are no conditionals here on purpose. Each sheet reads its own
/// parameter out of the URL and decides for itself whether it is open, which
/// is what makes a sheet openable from somewhere that is not its ancestor —
/// the rail, a floating bar over a table, a keystroke, a notification, a link
/// somebody pasted into a conversation. A `useState` in the screen that owns
/// the list can do none of those.
///
/// Mounted by the root route, so it survives every navigation below it. That
/// matters for the two here: the basket and the inbox are opened in the middle
/// of doing something else, and unmounting them on a route change would be the
/// route change they exist to avoid.
///
/// **A sheet only belongs here if it needs no screen behind it.** The record
/// sheets are all mounted by the list they walk — `OrderSheet` by the orders
/// table, `PersonSheet` by the workforce list — because ↑/↓ have to move
/// through the rows that list is showing, filtered and sorted as the reader
/// left them, and nothing outside the screen knows what those are. A sheet
/// here would either lose the arrows or invent an order of its own.
///
/// Both kinds are opened the same way and neither one knows which it is.
export function GlobalSheets() {
  return (
    <>
      <BasketSheet />
      <NotificationSheet />
    </>
  )
}
