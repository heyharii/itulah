import { queryOptions, useQuery } from "@tanstack/react-query"

import type { CatalogRow } from "@itulah/contract"

import { node } from "@/lib/api"
import { shapeArticle } from "@/lib/variants"

/// Return to HO as the Gudang works an allotment (owner, 25 Oct 2026):
/// Picklist → Picked → Packed → In transit → Received. The shop sees goods,
/// never HO's requests — every open request is summed by article — and sends
/// an article whole or not at all; what it does not pick stays on the
/// Picklist.
///
/// Hand-written against `backend/src/edge/store_returns.rs` (`ReturnBoard`
/// and the commands under it).

/// One SKU at one step. The same SKU can come twice in `to_pick` (one row per
/// HO request); sum them by article to draw the shop's row.
export interface ReturnPiece {
  readonly sku_code: string
  readonly article_code: string
  /// The catalogue's name: article, colour and size in one string.
  readonly name: string | null
  readonly image_url: string | null
  readonly quantity: number
}

export interface ReturnKoli {
  readonly koli: {
    readonly koli_id: string
    readonly koli_number: string
    readonly destination_store_id: string
    readonly destination_code: string
    readonly sealed_at: string | null
    readonly unit_count: number
  }
  readonly lines: readonly ReturnPiece[]
}

export interface ReturnTrip {
  readonly dispatch_id: string
  readonly dispatch_number: string
  readonly trip_note: string | null
  readonly departed_at: string | null
  readonly koli_count: number
  readonly unit_count: number
  readonly received_unit_count: number
  /// Set once HO has counted every piece in: the trip is Received.
  readonly received_at: string | null
}

export interface ReturnBoard {
  readonly to_pick: readonly ReturnPiece[]
  readonly picked: readonly ReturnPiece[]
  readonly packed: readonly ReturnKoli[]
  readonly trips: readonly ReturnTrip[]
}

/// An article as a row: its SKUs summed across HO's requests.
export interface ReturnArticle {
  readonly article_code: string
  readonly name: string
  readonly image_url: string | null
  readonly quantity: number
  readonly skus: readonly {
    readonly sku_code: string
    /// What tells this SKU from its article's others — "Off White · M".
    readonly variant: string
    readonly quantity: number
  }[]
}

/// The pieces as articles, in the order they first appear, named the way the
/// Catalogue names them (`shapeArticle`): the article's own words, then each
/// SKU's colour · size.
export function byArticle(pieces: readonly ReturnPiece[]): ReturnArticle[] {
  const groups = new Map<string, ReturnPiece[]>()
  for (const piece of pieces) {
    const group = groups.get(piece.article_code)
    if (group === undefined) groups.set(piece.article_code, [piece])
    else group.push(piece)
  }
  return [...groups.entries()].map(([article_code, group]) => {
    const skus = new Map<string, { name: string; quantity: number }>()
    for (const piece of group) {
      const was = skus.get(piece.sku_code)
      skus.set(piece.sku_code, {
        name: was?.name ?? piece.name ?? piece.sku_code,
        quantity: (was?.quantity ?? 0) + piece.quantity,
      })
    }
    // `shapeArticle` reads only a row's code and name.
    const shape = shapeArticle(
      [...skus.entries()].map(
        ([sku_code, sku]) => ({ sku_code, name: sku.name }) as CatalogRow,
      ),
    )
    return {
      article_code,
      name: shape.name,
      image_url:
        group.find((piece) => piece.image_url !== null)?.image_url ?? null,
      quantity: group.reduce((sum, piece) => sum + piece.quantity, 0),
      skus: [...skus.entries()].map(([sku_code, sku]) => {
        const variant = shape.variant.get(sku_code)
        const words = [variant?.colour, variant?.size].filter(
          (word): word is string => word !== null && word !== undefined,
        )
        return {
          sku_code,
          variant: words.length > 0 ? words.join(" · ") : sku.name,
          quantity: sku.quantity,
        }
      }),
    }
  })
}

export const returnBoardKey = () => ["store", "returns", "board"] as const

export const returnBoardQuery = () =>
  queryOptions({
    queryKey: returnBoardKey(),
    queryFn: ({ signal }) =>
      node.get<ReturnBoard>("/api/v1/store/return-requests/board", { signal }),
  })

export function useReturnBoard() {
  return useQuery({ ...returnBoardQuery(), refetchInterval: 10_000 })
}

export interface ReturnPicked {
  readonly picked: number
  /// Lines the shelf could not answer, in the node's words.
  readonly refused: readonly string[]
}

/// **Pick**: every piece still to pick of these articles, whole.
export function pickArticles(
  articleCodes: readonly string[],
  idempotencyKey: string,
) {
  return node.post<ReturnPicked>("/api/v1/store/return-requests/picks", {
    idempotency_key: idempotencyKey,
    article_codes: articleCodes,
  })
}

/// **Unpick**: an article's picked pieces back to the shelf; it is on the
/// Picklist again.
export function unpickArticles(
  articleCodes: readonly string[],
  idempotencyKey: string,
) {
  return node.post<unknown>("/api/v1/store/return-requests/unpick", {
    idempotency_key: idempotencyKey,
    article_codes: articleCodes,
  })
}

/// **Pack**: these articles' picked pieces into one koli, sealed.
export function packArticles(
  articleCodes: readonly string[],
  idempotencyKey: string,
) {
  return node.post<{ koli: readonly { koli: ReturnKoli["koli"] }[] }>(
    "/api/v1/store/return-requests/packs",
    { idempotency_key: idempotencyKey, article_codes: articleCodes },
  )
}

/// **Unpack**: a sealed koli not yet on a trip; what it held is Picked again.
export function unpackKoli(koliId: string, idempotencyKey: string) {
  return node.post<unknown>("/api/v1/store/return-requests/unpack", {
    idempotency_key: idempotencyKey,
    koli_id: koliId,
  })
}

/// **Dispatch**: these koli onto one trip to HO. `tripNote` is who carries it.
export function dispatchKoli(
  koliIds: readonly string[],
  tripNote: string,
  idempotencyKey: string,
) {
  return node.post<{ dispatch_number: string; quantity: number }>(
    "/api/v1/store/return-requests/dispatch",
    { idempotency_key: idempotencyKey, koli_ids: koliIds, trip_note: tripNote },
  )
}
