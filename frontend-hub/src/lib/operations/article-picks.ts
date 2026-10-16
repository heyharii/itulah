import { useMemo } from "react"

import type { AllotmentPick } from "@itulah/contract"

import { useCatalogueIdentity, type Identity } from "@/lib/operations/catalogue"

/// A picklist as the Gudang works it: one ARTICLE of one allotment for one
/// store (owner, 16 Oct 2026: "pick itu per article per store"). The node
/// answers per allotment × store; an allotment made before one-article-per-
/// allotment can hold several articles, so it is split here, by the
/// catalogue. A line the catalogue does not know yet stays on a card of its
/// own under its SKU code.
export type ArticlePick = AllotmentPick & {
  readonly article_code: string
  readonly article_name: string | null
}

export function splitByArticle(
  picks: readonly AllotmentPick[],
  identities: ReadonlyMap<string, Identity>
): ArticlePick[] {
  return picks.flatMap((pick) => {
    const by = new Map<string, ArticlePick>()
    for (const line of pick.lines) {
      const identity = identities.get(line.sku_code)
      const code = identity?.article_code ?? line.sku_code
      const card = by.get(code) ?? {
        ...pick,
        lines: [],
        pieces: 0,
        article_code: code,
        article_name: identity?.article_name ?? null,
      }
      card.lines.push(line)
      by.set(code, { ...card, pieces: card.pieces + line.outstanding })
    }
    return [...by.values()]
  })
}

/// `splitByArticle` over the catalogue the hub already reads.
export function useArticlePicks(
  picks: readonly AllotmentPick[] | undefined
): ArticlePick[] {
  const identities = useCatalogueIdentity()
  return useMemo(
    () => splitByArticle(picks ?? [], identities),
    [picks, identities]
  )
}

/// The key a picklist not yet accepted is opened by — there is no id for one
/// until `createPicklist` mints a session, so the allotment, the store and
/// the article together are the identity.
export function articlePickKey(pick: ArticlePick): string {
  return `${pick.allotment_id}~${pick.destination_id}~${pick.article_code}`
}
