import { useQuery } from "@tanstack/react-query"

import { catalogueQuery } from "@/lib/queries"

interface Facts {
  readonly division: string | null
  readonly tags: readonly string[]
}

const cache = new WeakMap<object, Map<string, Facts>>()

/// Division and tags of an article code, from the price book in hand.
export function useArticleFacts(): (code: string) => Facts {
  const book = useQuery(catalogueQuery())
  const items = book.data?.items
  return (code) => {
    if (!items) return { division: null, tags: [] }
    let index = cache.get(items)
    if (!index) {
      const tags = new Map<string, Set<string>>()
      index = new Map()
      for (const row of items) {
        const key = row.article_code ?? row.sku_code
        const set = tags.get(key) ?? new Set<string>()
        for (const tag of row.tags) set.add(tag)
        tags.set(key, set)
        index.set(key, { division: row.division_code, tags: [] })
      }
      for (const [key, set] of tags)
        index.set(key, { ...index.get(key)!, tags: [...set].sort() })
      cache.set(items, index)
    }
    return index.get(code) ?? { division: null, tags: [] }
  }
}
