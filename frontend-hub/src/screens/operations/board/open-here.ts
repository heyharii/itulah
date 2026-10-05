import { useSheet, type SheetKey } from "@/lib/sheets"

/// The work a board card can open without leaving the board: the sheet's key
/// and the record it shows. Anything else still goes to its station.
export type Here = { readonly key: SheetKey; readonly value: string }

/// Opens a board card's sheet in place — only `?sheet` changes, never the
/// path. Returns `undefined` for a card whose sheet this board does not hold.
export function useOpenHere(): (
  here: Here | undefined
) => (() => void) | undefined {
  const accept = useSheet("accept")
  const pack = useSheet("pack")
  const koli = useSheet("koli")
  const shipment = useSheet("shipment")
  return (here) => {
    if (here === undefined) return undefined
    const value = here.value
    switch (here.key) {
      case "accept":
        return () => accept.open(value)
      case "pack":
        return () => pack.open(value)
      case "koli":
        return () => koli.open(value)
      case "shipment":
        return () => shipment.open(value)
      default:
        return undefined
    }
  }
}
