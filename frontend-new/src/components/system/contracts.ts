/**
 * Wire schemas for the permissions/roles/audit read models.
 *
 * Every fetch in `./api.ts` goes `api.get<unknown>` into a defensive mapper
 * (`permissionFromApi`, `roleFromApi`, `assignmentFromApi`, `auditFromApi`)
 * that already tolerates a missing field with a fallback or drops the row.
 * These schemas run alongside that path through `checkContract`, which never
 * throws — the value is the report, not a guard.
 *
 * Field names are the wire's snake_case, matching what `api.ts` reads off
 * `record.*` — these describe the payload, not the mapped `System*` shape
 * it becomes.
 */

import { z } from "zod"

export const PermissionRow = z.object({
  id: z.string().nullish(),
  code: z.string().nullish(),
  module: z.string().nullish(),
  action: z.string().nullish(),
  resource: z.string().nullish(),
  description: z.string().nullish(),
  created_at: z.string().nullish(),
})
export type PermissionRow = z.infer<typeof PermissionRow>

/** The role list embeds its permissions in full — `permissions` is checked
 * separately, once unwrapped, against `PermissionRow`. */
export const RoleRow = z.object({
  id: z.string().nullish(),
  code: z.string().nullish(),
  name: z.string().nullish(),
  description: z.string().nullish(),
  is_system: z.boolean().nullish(),
  // Displayed with an "active" fallback, not switched on via a Record — loose.
  status: z.string().nullish(),
  created_at: z.string().nullish(),
  updated_at: z.string().nullish(),
})
export type RoleRow = z.infer<typeof RoleRow>

/** `…/roles/{id}/users` answers a bare list of user-id entries. */
export const RoleMemberEntry = z.union([z.string(), z.number()]).nullish()

export const RoleAssignmentRow = z.object({
  user_id: z.string().nullish(),
  role_id: z.string().nullish(),
  role: z
    .object({
      name: z.string().nullish(),
      code: z.string().nullish(),
    })
    .nullish(),
  // "*" for unscoped, a store/location id otherwise — displayed, not
  // switched on — loose.
  scope_value: z.string().nullish(),
  assigned_at: z.string().nullish(),
  assigned_by: z.string().nullish(),
})
export type RoleAssignmentRow = z.infer<typeof RoleAssignmentRow>

export const AuditEventRow = z.object({
  id: z.string().nullish(),
  timestamp: z.string().nullish(),
  actor_id: z.string().nullish(),
  actor_type: z.string().nullish(),
  action: z.string().nullish(),
  // Displayed with an "info" fallback, not switched on via a Record — loose.
  severity: z.string().nullish(),
  resource_type: z.string().nullish(),
  resource_id: z.string().nullish(),
  store_id: z.string().nullish(),
  ip_address: z.string().nullish(),
  old_value: z.string().nullish(),
  new_value: z.string().nullish(),
  // stringMap() coerces every value to a string regardless of what arrives —
  // loose by design, this is an operational metadata bag, not a typed field.
  metadata: z.record(z.string(), z.unknown()).nullish(),
})
export type AuditEventRow = z.infer<typeof AuditEventRow>
