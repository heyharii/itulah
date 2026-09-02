import { useNavigate, useSearch } from "@tanstack/react-router"
import { useCallback } from "react"
import type { SheetKey, SheetSearch, SheetValue } from "./params"

/// The element that opened the sheet, so closing can put focus back where the
/// person left it.
///
/// There is no trigger component to return to: a sheet opens because a query
/// parameter was written, and that can happen from a table row, the rail, a
/// floating bar or a keystroke. Base UI restores focus to a trigger it can
/// see, and here it cannot see one — without this, closing a sheet reached by
/// keyboard drops focus on `body` and the next Tab starts from the top of the
/// page.
let opener: HTMLElement | null = null

/// Put focus back on whatever opened the sheet. A no-op when the sheet was
/// reached by a pasted link, which is the correct answer for that case.
///
/// Here rather than in the shell so that every sheet gets it, including the
/// two that keep the raw primitive because their panel brings its own header.
function restoreOpenerFocus(): void {
  const element = opener
  opener = null
  // On the next tick, not this one: the popup is still mounted and holding
  // focus while the close is being navigated.
  if (element !== null) setTimeout(() => element.focus(), 0)
}

export interface Sheet<K extends SheetKey> {
  /// What the sheet is open on, or `null` when it is shut.
  readonly value: SheetValue<K> | null
  readonly isOpen: boolean
  open: (value: SheetValue<K>) => void
  close: () => void
}

/// One sheet's parameter, read and written.
///
/// `strict: false` on the read because a sheet is opened from anywhere — the
/// rail, a table cell, a floating bar — and the hook cannot know which of the
/// sixty-seven routes it is being called under. The keys are still validated:
/// the root route's `validateSheetSearch` has already narrowed them by the
/// time this sees them.
///
/// **Opening pushes, closing replaces**, and the asymmetry is deliberate. A
/// push means the browser's Back button closes the sheet, which is what a
/// person expects of something that opened over what they were reading. A
/// replace on the way out means closing it by the X or by Escape does not
/// leave an entry that Back would reopen, and — the case that decides it —
/// closing a sheet somebody arrived on by pasted link does not walk them out
/// of the app.
/// Write some sheet keys and leave the rest of the search alone.
///
/// A merge over the whole search rather than a fresh object: the screen behind
/// the sheet keeps its span, its filters and its account, and closing the sheet
/// has to give that screen back exactly as it was. A key set to `null` is
/// deleted, which is how a closed sheet leaves no trace in the address bar.
function useWriteSheet() {
  const navigate = useNavigate()
  return useCallback(
    (changes: Record<string, unknown>, replace: boolean) => {
      const opening = Object.values(changes).some((value) => value !== null)
      if (opening) {
        if (document.activeElement instanceof HTMLElement) {
          opener = document.activeElement
        }
      } else {
        restoreOpenerFocus()
      }
      void navigate({
        // Stay where we are. Not the same as omitting `to`: without it the
        // router cannot resolve which route's search is being edited, and the
        // reducer's return type collapses to `never`.
        to: ".",
        search: (previous: Record<string, unknown>) => {
          const merged = { ...previous }
          for (const [key, value] of Object.entries(changes)) {
            if (value === null) delete merged[key]
            else merged[key] = value
          }
          return merged
        },
        replace,
        // Said here as well as in `router.tsx`, and not redundantly. The
        // router's predicate reads `pathChanged`, but the browser only
        // consults a predicate at all if it supports view-transition *types*;
        // one that has view transitions without them would take the default
        // and fade the screen behind every sheet that opened. A sheet already
        // animates, and the page under it is meant to stay still.
        viewTransition: false,
      })
    },
    [navigate]
  )
}

export function useSheet<K extends SheetKey>(key: K): Sheet<K> {
  const write = useWriteSheet()
  const search = useSearch({ strict: false }) as SheetSearch
  const value = (search[key] ?? null) as SheetValue<K> | null

  return {
    value,
    isOpen: value !== null,
    open: useCallback(
      (next: SheetValue<K>) => write({ [key]: next }, false),
      [write, key]
    ),
    close: useCallback(() => write({ [key]: null }, true), [write, key]),
  }
}

export interface SheetParams<K extends SheetKey> {
  /// Every one of `keys` that is present in the URL.
  readonly params: { [P in K]?: SheetValue<P> }
  /// True when all of them are.
  readonly isOpen: boolean
  open: (values: { [P in K]: SheetValue<P> }) => void
  close: () => void
}

/// A sheet identified by more than one parameter.
///
/// The sales panel is the case: a cell in that table is a shop *and* a span, so
/// three keys travel together and either all of them are in the URL or the
/// sheet is shut. Opening writes them in one navigation, and closing clears
/// them in one — a sheet that dropped its keys one at a time would repaint
/// through two states that mean nothing.
///
/// Pass `keys` as a constant declared outside the component. A fresh array
/// every render only costs new callbacks rather than correctness, but the
/// domain hooks below all declare theirs once and there is no reason not to.
export function useSheetParams<K extends SheetKey>(
  keys: readonly K[]
): SheetParams<K> {
  const write = useWriteSheet()
  const search = useSearch({ strict: false }) as SheetSearch

  const params = {} as { [P in K]?: SheetValue<P> }
  for (const key of keys) {
    const value = search[key]
    if (value !== undefined) params[key] = value as SheetValue<typeof key>
  }

  return {
    params,
    isOpen: keys.every((key) => params[key] !== undefined),
    open: useCallback(
      (values: { [P in K]: SheetValue<P> }) => write(values, false),
      [write]
    ),
    close: useCallback(() => {
      const cleared: Record<string, null> = {}
      for (const key of keys) cleared[key] = null
      write(cleared, true)
    }, [write, keys]),
  }
}
