import { useQuery } from "@tanstack/react-query"
import { useCallback, useMemo } from "react"

import { readColours } from "@/lib/colour-parse"
import { colourKeys, listColours, type ColourTerm } from "@/lib/queries/colours"

/// The paint a placeholder garment wears for one colourway.
///
/// The master's hex when it has one — the company decided what "Navy" looks
/// like, and the drawing should agree with every swatch beside it. A colour
/// named before anybody chose its hex is read from its label instead, the way
/// the colour master's own hex box reads it ("Biru Tua" → a navy). A label of
/// two or three colours ("Hitam/Putih") is all of them, and the garment is
/// drawn split.
///
/// Empty when neither says anything: the caller falls back to the article's
/// name, then to grey. A guessed colour is only ever a placeholder's — it is
/// never written back to the master.
export function colourwayFill(
  label: string | null | undefined,
  hex: string | null | undefined
): readonly string[] {
  if (hex != null && /^#[0-9A-Fa-f]{6}$/.test(hex)) return [hex.toUpperCase()]
  if (label == null || label.trim() === "") return []
  return readColours(label)
    .slice(0, 3)
    .map((one) => one.hex)
}

/// `colourwayFill` for the rows that carry only a colour's code or its label —
/// a PO line, a variant, a picked colour on a form — looked up in the colour
/// master the hub already holds.
///
/// The master is one small list, shared under one query key with the picker
/// and the colour screen, so editing a hex there repaints every placeholder
/// that reads it here.
export function useColourwayFill(): (
  colour: string | null | undefined
) => readonly string[] {
  const master = useQuery({
    queryKey: colourKeys.list(),
    queryFn: ({ signal }) => listColours(signal),
    staleTime: 30 * 60 * 1000,
  })

  const termOf = useMemo(() => {
    const byKey = new Map<string, ColourTerm>()
    for (const term of master.data?.colours ?? []) {
      byKey.set(term.code.toLowerCase(), term)
      byKey.set(term.label.trim().toLowerCase(), term)
    }
    return byKey
  }, [master.data])

  return useCallback(
    (colour) => {
      if (colour == null || colour.trim() === "") return []
      const term = termOf.get(colour.trim().toLowerCase())
      return term === undefined
        ? colourwayFill(colour, null)
        : colourwayFill(term.label, term.hex_code)
    },
    [termOf]
  )
}
