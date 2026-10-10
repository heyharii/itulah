import { useQuery } from "@tanstack/react-query"

import { colourKeys, listColours } from "@/lib/queries/colours"
import { catalogueVocabulary, procurementKeys } from "@/lib/queries/procurement"
import type { ItemsVariant } from "@/screens/procurement/items-table"

/// A variant as people say it — "Black M" — from the colour master and the
/// size vocabulary; a code neither knows yet reads as itself.
export function useVariantWords() {
  const colours = useQuery({
    queryKey: colourKeys.list(),
    queryFn: ({ signal }) => listColours(signal),
    staleTime: 30 * 60 * 1000,
  })
  const vocabulary = useQuery({
    queryKey: procurementKeys.vocabulary(),
    queryFn: ({ signal }) => catalogueVocabulary(signal),
    staleTime: 30 * 60 * 1000,
  })
  return (colour: string | null, size: string | null): string =>
    [
      colour === null
        ? null
        : (colours.data?.colours.find((one) => one.code === colour)?.label ??
          colour),
      size === null
        ? null
        : (vocabulary.data?.sizes.find((one) => one.code === size)?.label ??
          size),
    ]
      .filter(Boolean)
      .join(" ")
}

/// A line's variants as the items table draws them under it: the ones with a
/// quantity, each with its first photograph.
export function useVariantRows() {
  const words = useVariantWords()
  return (
    variants: readonly {
      readonly colour: string | null
      readonly size: string | null
      readonly pieces: number
      readonly photo?: string | null
    }[]
  ): ItemsVariant[] =>
    variants
      .filter((one) => one.pieces > 0)
      .map((one) => ({
        key: `${one.colour ?? ""}|${one.size ?? ""}`,
        label: words(one.colour, one.size),
        pieces: one.pieces,
        photo: one.photo ?? null,
      }))
}
