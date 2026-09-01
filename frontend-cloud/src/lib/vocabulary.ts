import { node } from "@/lib/api"
import { useQuery } from "@tanstack/react-query"
import { useMemo } from "react"

/// The words the catalogue may be described with, and what they read as.
///
/// The wire carries codes — `KAUS_KAKI`, `WOMENSWEAR` — because a code is what
/// a filter addresses and what does not change when somebody edits a label.
/// But a code is not what a buyer should be reading, and the screens were
/// showing them raw. The labels live in `tag` and `division`; this is how they
/// reach the browser.
interface VocabularyTerm {
  code: string
  label: string
}

interface CatalogueVocabulary {
  divisions: VocabularyTerm[]
  tags: VocabularyTerm[]
}

/// Shown where a term has no label yet — a code minted after this page loaded,
/// or one whose row was deactivated. Better than a blank chip, which reads as
/// "no tag" rather than "a tag nobody told me the name of".
function fallback(code: string): string {
  return code
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ")
}

/// Cached hard: this changes when somebody adds a division, which is a
/// deliberate act a few times a year, not something a buyer should pay a round
/// trip for on every screen.
export function useVocabulary() {
  const query = useQuery({
    queryKey: ["catalogue", "vocabulary"],
    queryFn: ({ signal }) =>
      node.get<CatalogueVocabulary>("/api/v1/catalogue/vocabulary", { signal }),
    staleTime: 60 * 60 * 1000,
  })

  return useMemo(() => {
    const divisions = new Map(query.data?.divisions.map((t) => [t.code, t.label]))
    const tags = new Map(query.data?.tags.map((t) => [t.code, t.label]))
    return {
      /// `Unclassified` is not a division code and has no row; it passes
      /// through as itself, which is what it should read as.
      division: (code: string) => divisions.get(code) ?? fallback(code),
      tag: (code: string) => tags.get(code) ?? fallback(code),
      /// The order the business thinks in, for a facet that should not be
      /// alphabetical.
      divisionOrder: query.data?.divisions.map((t) => t.code) ?? [],
      /// Every tag the catalogue may use, for a screen offering a choice
      /// rather than describing one.
      tagCodes: query.data?.tags.map((t) => t.code) ?? [],
    }
  }, [query.data])
}

export type Vocabulary = ReturnType<typeof useVocabulary>
