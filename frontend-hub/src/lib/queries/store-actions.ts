import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { node } from "@/lib/api"
import type {
  StoreActionAccepted,
  StoreActionEntry,
  StoreActionHistory,
  StoreActionMenu,
  StoreActionOption,
  StoreActionRequest,
} from "@itulah/contract"

export type {
  StoreActionAccepted,
  StoreActionEntry,
  StoreActionHistory,
  StoreActionMenu,
  StoreActionOption,
  StoreActionRequest,
}

/// A store's Actions menu (remote actions, 28 Sep 2026): what may be done to
/// its server and devices from head office, doing it, and where each request
/// got to. See `backend/src/cloud/http/stores.rs` (the "Actions menu"
/// section) and `STORE-SERVER-PLAN.md` §9e.
///
/// `StoreAction*` are generated — `backend/src/cloud/postgres/store_actions.rs`
/// — the same way `stores.ts`'s own types are; kept in a file of their own
/// because this is a second surface on the store page (a menu and a history
/// list) rather than one more field of `StoreDetail`.

export const storeActionsKeys = {
  all: ["store-actions"] as const,
  menu: (unit: string) => ["store-actions", "menu", unit] as const,
  history: (unit: string, limit: number) =>
    ["store-actions", "history", unit, limit] as const,
}

/// While any entry is still on its way, the same cadence the Server tab
/// polls a transitional server state at.
const HISTORY_POLL_MS = 5_000

export function storeActionMenu(
  unit: string,
  signal?: AbortSignal
): Promise<StoreActionMenu> {
  return node.get<StoreActionMenu>(
    `/api/v1/stores/${encodeURIComponent(unit)}/actions`,
    { signal }
  )
}

export function storeActionHistory(
  unit: string,
  limit: number,
  signal?: AbortSignal
): Promise<StoreActionHistory> {
  return node.get<StoreActionHistory>(
    `/api/v1/stores/${encodeURIComponent(unit)}/actions/history?limit=${limit}`,
    { signal }
  )
}

/// `POST /api/v1/stores/{unit}/actions/{key}`. A fresh `Idempotency-Key` per
/// call — one per click, as the plan asks — so a doubled click is a replay
/// the server recognises rather than a second restart.
export function requestStoreAction(
  unit: string,
  key: string,
  request: StoreActionRequest
): Promise<StoreActionAccepted> {
  return node.post<StoreActionAccepted>(
    `/api/v1/stores/${encodeURIComponent(unit)}/actions/${encodeURIComponent(key)}`,
    request,
    { headers: { "Idempotency-Key": crypto.randomUUID() } }
  )
}

/// Whether the history should keep polling — any entry not yet at a final
/// state (`DONE`, `FAILED`, `EXPIRED`).
function anyPending(items: readonly StoreActionEntry[]): boolean {
  return items.some(
    (item) =>
      item.state === "QUEUED" ||
      item.state === "SENT" ||
      item.state === "RUNNING"
  )
}

/// The menu, read once per store page. Absent (an error) is read by the
/// caller as "do not draw the Actions button" — the reach check can refuse
/// with 403, and a caller who may not act still gets `can_act: false` rather
/// than a refusal, so both are handled the same way: nothing to press.
export function useStoreActionMenu(unit: string) {
  return useQuery({
    queryKey: storeActionsKeys.menu(unit),
    queryFn: ({ signal }) => storeActionMenu(unit, signal),
  })
}

export function useStoreActionHistory(unit: string, limit = 30) {
  return useQuery({
    queryKey: storeActionsKeys.history(unit, limit),
    queryFn: ({ signal }) => storeActionHistory(unit, limit, signal),
    refetchInterval: (query) =>
      anyPending(query.state.data?.items ?? []) ? HISTORY_POLL_MS : false,
  })
}

export function useRequestStoreAction(unit: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({
      key,
      request,
    }: {
      key: string
      request: StoreActionRequest
    }) => requestStoreAction(unit, key, request),
    onSuccess: () => {
      // The history moves to QUEUED (or straight to SENT) the moment this
      // lands; the menu's own `enabled`/`reason_disabled` also shifts — a
      // busy action says so ("Already asked by … ago").
      void client.invalidateQueries({ queryKey: storeActionsKeys.all })
    },
  })
}
