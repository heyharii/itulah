import { queryOptions } from "@tanstack/react-query"

import { node } from "@/lib/api"

/// The return promise, as Marketing authors it.
///
/// Mirrors `cloud/postgres/return_policy.rs`. The setting is the fallback; a
/// policy names one scope kind and the codes it covers. Resolution is the
/// domain's (`cloud/domain/return_policy.rs`): article beats tag beats
/// division beats a global policy beats the setting, and equally specific
/// matches keep the longer window.
export type ReturnScopeKind = "GLOBAL" | "DIVISION" | "TAG" | "ARTICLE"

export interface ReturnPolicySettings {
  readonly max_days: number
  readonly require_hang_tag: boolean
  readonly require_receipt: boolean
  readonly same_item_exchange: boolean
  readonly same_item_same_cost: boolean
  readonly same_item_same_supplier: boolean
  /// Once any piece came back, the struk takes no further return (1007).
  readonly one_return_per_receipt: boolean
  /// What went out on a return may itself come back (1007).
  readonly return_receipt_returnable: boolean
  readonly updated_at: string
  readonly updated_by: string | null
}

export interface ReturnPolicyRow {
  readonly policy_id: string
  readonly name: string
  readonly scope_kind: ReturnScopeKind
  readonly max_days: number
  /// false = this scope is never taken back; `max_days` is then not a window.
  readonly exchangeable: boolean
  readonly active: boolean
  readonly note: string | null
  readonly targets: readonly string[]
  readonly created_by: string
  readonly created_at: string
  readonly updated_at: string
}

export interface ReturnPolicyCatalogue {
  readonly settings: ReturnPolicySettings
  readonly policies: readonly ReturnPolicyRow[]
}

export interface SaveReturnPolicySettings {
  readonly max_days: number
  readonly require_hang_tag: boolean
  readonly require_receipt: boolean
  readonly same_item_exchange: boolean
  readonly same_item_same_cost: boolean
  readonly same_item_same_supplier: boolean
  readonly one_return_per_receipt: boolean
  readonly return_receipt_returnable: boolean
}

export interface SaveReturnPolicy {
  readonly policy_id?: string
  readonly name: string
  readonly scope_kind: ReturnScopeKind
  readonly max_days: number
  readonly exchangeable: boolean
  readonly active: boolean
  readonly note?: string | null
  readonly targets: readonly string[]
}

export const returnPolicyKeys = {
  all: ["return-policy"] as const,
  catalogue: () => ["return-policy", "catalogue"] as const,
}

export const returnPolicyQuery = queryOptions({
  queryKey: returnPolicyKeys.catalogue(),
  queryFn: ({ signal }) =>
    node.get<ReturnPolicyCatalogue>("/api/v1/commercial/return-policy", {
      signal,
    }),
})

export const saveReturnPolicySettings = (body: SaveReturnPolicySettings) =>
  node.put<ReturnPolicySettings>(
    "/api/v1/commercial/return-policy/settings",
    body
  )

export const saveReturnPolicy = (body: SaveReturnPolicy) =>
  node.post<ReturnPolicyRow>("/api/v1/commercial/return-policy/policies", body)

export const deleteReturnPolicy = (policyId: string) =>
  node.delete<void>(
    `/api/v1/commercial/return-policy/policies/${encodeURIComponent(policyId)}`
  )

export function scopeLabel(kind: ReturnScopeKind): string {
  switch (kind) {
    case "GLOBAL":
      return "Every article"
    case "DIVISION":
      return "Division"
    case "TAG":
      return "Tag"
    case "ARTICLE":
      return "Article"
  }
}
