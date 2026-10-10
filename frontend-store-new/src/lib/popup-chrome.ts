/// The chrome a popup wears, shared by every desk dropdown — the part of the
/// hub's `lib/filter-chrome.ts` that is not about filters.
///
/// How every popup arrives and leaves: out of the control that opened it.
///
/// `--transform-origin` is Base UI's — the point on the popup nearest its
/// trigger — so a menu under a button grows down from the button and a select
/// laid over its field grows from the field, instead of appearing from nowhere
/// in the middle of itself. `scale(0.95)`, never `0`: nothing in the world
/// appears from nothing. 160ms and the strong ease-out, the dropdown band
/// (150–250ms) at its quick end — a list somebody opens a dozen times an hour.
/// Reduced motion keeps the fade and drops the growth.
export const POP_MOTION =
  "origin-(--transform-origin) transition-[opacity,scale] duration-(--t-pop) ease-(--ease-out) data-[starting-style]:scale-95 data-[starting-style]:opacity-0 data-[ending-style]:scale-95 data-[ending-style]:opacity-0 motion-reduce:data-[starting-style]:scale-100 motion-reduce:data-[ending-style]:scale-100"

/// The panel a popup is drawn on: ground, hairline, radius, shadow, padding.
export const PANEL = `z-50 min-w-[12rem] rounded-card border border-hairline bg-canvas p-[0.3125rem] text-[0.875rem] shadow-pop outline-none ${POP_MOTION}`

/// The panel for a menu that scrolls itself.
export const POPUP = `${PANEL} max-h-[22rem] overflow-y-auto`

/// The layer, which has to go on the POSITIONER rather than on the popup: Base
/// UI paints a popup inside a positioner, the popup is `position: static`, and
/// `z-index` only applies to a positioned element. A menu opened INSIDE a sheet
/// (`z-40`, fixed) would otherwise paint underneath the panel that opened it.
export const POSITIONER = "z-50"

/// One row of a popup.
export const ITEM =
  "flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-[0.4375rem] text-left text-text outline-none select-none data-[highlighted]:bg-soft-2 data-[highlighted]:text-ink"
