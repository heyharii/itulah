import { createContext, useContext } from "react"

/// Opens the ⌘K palette. The shell provides it; a screen that wants to offer
/// the palette a place to be found — the phone's Home, where there is no
/// keyboard to press ⌘K on and no rail to hold its row — reads it. Null
/// outside the shell.
export const PaletteOpener = createContext<(() => void) | null>(null)

export function useOpenPalette(): (() => void) | null {
  return useContext(PaletteOpener)
}
