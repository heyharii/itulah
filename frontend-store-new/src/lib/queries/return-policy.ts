import { queryOptions, useQuery } from "@tanstack/react-query"

import { node } from "@/lib/api"

/// The return policy head office set, as this shop's node relays it
/// (`GET /api/v1/store/return-policy`). Read-only here.
///
/// Hand-written against `ReturnPolicySnapshot` in
/// `backend/src/cloud/domain/return_policy.rs`; the generated barrel does not
/// carry it yet.

export type ReturnScopeKind = "GLOBAL" | "DIVISION" | "TAG" | "ARTICLE"

export interface ReturnPolicySetting {
  readonly max_days: number
  readonly require_hang_tag: boolean
  readonly require_receipt: boolean
  readonly same_item_exchange: boolean
  readonly same_item_same_cost: boolean
  readonly same_item_same_supplier: boolean
  readonly one_return_per_receipt: boolean
  readonly return_receipt_returnable: boolean
}

export interface ReturnPolicyRule {
  readonly name: string
  readonly scope_kind: ReturnScopeKind
  /// Division, tag or article codes. Empty for GLOBAL.
  readonly targets: readonly string[]
  readonly max_days: number
  /// False: the goods it covers are never taken back.
  readonly exchangeable: boolean
}

export interface ReturnPolicySnapshot {
  readonly setting: ReturnPolicySetting
  readonly rules: readonly ReturnPolicyRule[]
}

export const RETURN_POLICY_POLL_MS = 60_000

export const returnPolicyKey = ["store", "return-policy"] as const

export const returnPolicyQuery = () =>
  queryOptions({
    queryKey: returnPolicyKey,
    queryFn: ({ signal }) =>
      node.get<ReturnPolicySnapshot>("/api/v1/store/return-policy", { signal }),
    staleTime: RETURN_POLICY_POLL_MS,
  })

export function useReturnPolicy() {
  return useQuery({
    ...returnPolicyQuery(),
    refetchInterval: RETURN_POLICY_POLL_MS,
  })
}
