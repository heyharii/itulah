/**
 * System query options — the only place a system cache key exists.
 *
 * `queryOptions` pairs a key with its fetcher and its cache class in one typed
 * object, so the route loader, the screen and the role-permission write all
 * name the same query without repeating it. See docs/frontend-rules.md §Q1.
 */

import { queryOptions } from "@tanstack/react-query"

import { STALE } from "@/lib/api/stale"
import { fetchAccessCatalogue, fetchAuditTrail } from "./api"

export const systemQueries = {
  all: () => ["system"] as const,

  /**
   * Roles, the permission catalogue and the user list role membership
   * implies — cloud-hub's whole RBAC surface in one call. All three change on
   * a change-request, not on a shift, so `reference` rather than
   * `operational`.
   */
  accessCatalogue: () =>
    queryOptions({
      queryKey: [...systemQueries.all(), "access-catalogue"] as const,
      queryFn: ({ signal }) => fetchAccessCatalogue(signal),
      ...STALE.reference,
    }),

  /**
   * The audit trail. An append-only record people read to answer "what
   * happened", so `ledger` — always revalidated, and reconciled on focus.
   */
  auditTrail: () =>
    queryOptions({
      queryKey: [...systemQueries.all(), "audit-trail"] as const,
      queryFn: ({ signal }) => fetchAuditTrail(signal),
      ...STALE.ledger,
    }),
}
