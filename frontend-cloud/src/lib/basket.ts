import { node } from "@/lib/api"
import type {
  AddToBasketRequest,
  BasketLine,
  PurchaseDestination,
  SetBasketQuantityRequest,
} from "@itulah/contract"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

/// The buyer's basket, kept by the server.
///
/// This used to be a set of ids in `localStorage`. That made the basket a
/// property of a browser rather than of a person: it did not follow anyone to a
/// second machine, it did not survive clearing site data, and the server could
/// not see it at all. It is now `sourcing_basket_line`, scoped to the signed-in
/// user by the session — no path here names a user, because no caller may
/// address anyone else's basket.
const KEY = ["sourcing", "basket"] as const

export function readBasket(signal?: AbortSignal): Promise<BasketLine[]> {
  return node.get<BasketLine[]>("/api/v1/sourcing-basket", { signal })
}

export function useBasket() {
  return useQuery({ queryKey: KEY, queryFn: ({ signal }) => readBasket(signal) })
}

/// Everything that changes the basket, sharing one cache entry.
///
/// The mutations are separate because they mean different things to a person —
/// picking something up, saying how many, putting it back — but they all land
/// on the same list, so each invalidates it rather than trying to predict the
/// server's answer. A basket is small and the round trip is honest: the
/// quantity shown is the quantity stored.
export function useBasketActions() {
  const queryClient = useQueryClient()
  const settle = () => queryClient.invalidateQueries({ queryKey: KEY })

  const add = useMutation({
    mutationFn: (request: AddToBasketRequest) =>
      node.post<BasketLine>("/api/v1/sourcing-basket", request),
    onSuccess: settle,
  })

  const setQuantity = useMutation({
    mutationFn: ({ supplierItemId, quantity }: { supplierItemId: string; quantity: number }) =>
      node.request<BasketLine | undefined>(
        "PATCH",
        `/api/v1/sourcing-basket/${supplierItemId}`,
        { quantity } satisfies SetBasketQuantityRequest,
      ),
    onSuccess: settle,
  })

  const remove = useMutation({
    mutationFn: (supplierItemId: string) =>
      node.post<void>(`/api/v1/sourcing-basket/${supplierItemId}/remove`, {}),
    onSuccess: settle,
  })

  const clear = useMutation({
    mutationFn: () => node.post<void>("/api/v1/sourcing-basket/clear", {}),
    onSuccess: settle,
  })

  return { add, setQuantity, remove, clear, refresh: settle }
}

/// Where a purchase order can be delivered.
///
/// Not `/api/v1/sync/origins`: that is Admin-only by a decision the backend has
/// a test defending — knowing which nodes exist is administration. A Supervisor
/// raising an order needs the site names and nothing else, which is what this
/// answers.
export function useDestinations() {
  return useQuery({
    queryKey: ["purchase-destinations"],
    queryFn: ({ signal }) =>
      node.get<PurchaseDestination[]>("/api/v1/purchase-destinations", { signal }),
  })
}
