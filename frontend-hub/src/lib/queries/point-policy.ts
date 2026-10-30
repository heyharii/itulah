import type {
  PointPolicyCatalogue,
  PointPolicyRow,
  PointPolicySettingsRow,
  SavePointPolicyRequest,
  SavePointPolicySettings,
} from "@itulah/contract"
import { queryOptions } from "@tanstack/react-query"

import { node } from "@/lib/api"

/// The point policy, as Marketing authors it.
///
/// Mirrors `cloud/postgres/point_policy.rs`. The setting is the everyday rate;
/// a policy names one scope kind, its codes, and optionally stores and dates.
/// Resolution is the domain's (`cloud/domain/point_policy.rs`): article beats
/// tag beats division beats the setting, and equally specific matches keep the
/// best rate. Policy points ADD to a promotion's points (owner, 30 Oct 2026).
export type {
  PointPolicyCatalogue,
  PointPolicyRow,
  PointPolicySettingsRow,
  PointScopeKind,
  SavePointPolicyRequest,
} from "@itulah/contract"

export const pointPolicyKeys = {
  all: ["point-policy"] as const,
  catalogue: () => ["point-policy", "catalogue"] as const,
}

export const pointPolicyQuery = queryOptions({
  queryKey: pointPolicyKeys.catalogue(),
  queryFn: ({ signal }) =>
    node.get<PointPolicyCatalogue>("/api/v1/commercial/point-policy", {
      signal,
    }),
})

export const savePointPolicySettings = (body: SavePointPolicySettings) =>
  node.put<PointPolicySettingsRow>(
    "/api/v1/commercial/point-policy/settings",
    body
  )

export const savePointPolicy = (body: SavePointPolicyRequest) =>
  node.post<PointPolicyRow>("/api/v1/commercial/point-policy/policies", body)

export const deletePointPolicy = (policyId: string) =>
  node.delete<void>(
    `/api/v1/commercial/point-policy/policies/${encodeURIComponent(policyId)}`
  )
