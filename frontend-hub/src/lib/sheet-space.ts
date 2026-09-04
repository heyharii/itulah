import { createContext, useContext, useEffect } from "react"

/// How many record panels are on screen, so the shell can make room for one.
///
/// The shell has to know, because from 96rem up a record stands BESIDE the list
/// rather than over it and the page column has to give up the width. It cannot
/// work that out for itself: `<Sheet>` renders through a portal, so nothing in
/// the layout above it changes when one opens.
///
/// **Asked of the panel rather than read out of the URL.** `sheets.ts` holds
/// every query parameter the app uses and only some of them open a panel —
/// `?f=`, `?sort=`, `?bucket=` and `?view=` are a screen's own controls, and
/// `?report=` takes the whole screen. Inferring "a panel is open" from that
/// vocabulary would mean classifying sixty keys, and being wrong about a few
/// of them forever. The component that IS the panel already knows.
///
/// The writer is `components/shell/sheet-space.tsx`; this file is what the two
/// ends read, and they are apart for the reason the assistant's session is —
/// a file exporting both a provider and the hook that reads it cannot be hot
/// reloaded, and every screen in the app sits inside this one.

export interface SheetSpace {
  /// Register a panel. Returns the release, so it is an effect's whole body.
  claim: () => () => void
}

/// Two contexts, and this is not incidental: a panel subscribes to the claim
/// function only. If the count travelled with it, every open panel would see a
/// new context value the moment the count changed, re-run its effect, release
/// its claim and take it again — a loop that never settles.
export const SheetSpaceContext = createContext<SheetSpace | null>(null)
export const SheetsOpenContext = createContext(0)

/// Called by a panel for as long as it is on screen.
export function useSheetSpace(open: boolean) {
  const space = useContext(SheetSpaceContext)
  useEffect(() => {
    if (!open || !space) return
    return space.claim()
  }, [open, space])
}

/// Read by the shell.
export function useSheetsOpen(): number {
  return useContext(SheetsOpenContext)
}
