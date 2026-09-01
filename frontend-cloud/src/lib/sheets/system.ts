import { useCallback } from "react"

import { useSheet } from "./use-sheet"

/// The two sheets that are not about any one screen.
///
/// Both hang off the rail and both are opened in the middle of doing something
/// else, which is the whole reason they are sheets: picking things out and
/// looking at what you have picked are one activity, and reading what arrived
/// is something you do without abandoning the screen you are on.
///
/// They carry no identifier — there is one basket and one inbox — so the
/// generic `open` wants a `true` nobody should have to write at a call site.
/// That is what these two wrappers are for.
export function useBasketSheet() {
  const { isOpen, open, close } = useSheet("basket")
  return {
    isOpen,
    open: useCallback(() => open(true), [open]),
    close,
  }
}

export function useNotificationSheet() {
  const { isOpen, open, close } = useSheet("notifications")
  return {
    isOpen,
    open: useCallback(() => open(true), [open]),
    close,
  }
}
