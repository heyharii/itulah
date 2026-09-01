/**
 * System writes.
 *
 * Role and permission changes are authorization. Rendering a grant or revoke
 * before cloud-hub confirms it would tell a user something that may be false
 * about their own access — so this mutation is never optimistic, in either
 * shape from docs/tanstack-gap-plan.md §0. No `onMutate`, no `setQueryData`
 * ahead of the response. The screen shows `mutation.isPending` for a
 * "Saving…" state and reads the returned `RolePermissionsSaveResult` off
 * `mutation.data` once it lands — see rule F7.
 *
 * cloud-hub has no set-replacement route for a role's permissions and no
 * version token (see api.ts's module header): `saveRolePermissions` already
 * performs the grant/revoke sequence and re-reads the role, succeeding or
 * failing per permission. This mutation only owns the cache effect around
 * that call, per rule M1.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query"

import { saveRolePermissions } from "./api"
import { systemQueries } from "./queries"

export interface SaveRolePermissionsInput {
  roleId: string
  nextPermissionIds: string[]
  currentPermissionIds: string[]
}

/**
 * Invalidates the access catalogue (roles + permissions + the user list
 * derived from them) and the audit trail — a role edit is exactly the kind
 * of event the audit log records. Both are the narrowest prefixes this
 * domain has: `systemQueries` exposes no finer-grained key for a single
 * role, because cloud-hub embeds every role's permissions in the one
 * catalogue response.
 */
export function useSaveRolePermissions() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: SaveRolePermissionsInput) =>
      saveRolePermissions(
        input.roleId,
        input.nextPermissionIds,
        input.currentPermissionIds
      ),
    onSettled: () => {
      void client.invalidateQueries({
        queryKey: systemQueries.accessCatalogue().queryKey,
      })
      void client.invalidateQueries({
        queryKey: systemQueries.auditTrail().queryKey,
      })
    },
  })
}
