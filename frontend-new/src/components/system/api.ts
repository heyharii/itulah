/*
 * System's backend boundary — cloud-hub (Go, `github.com/retailos/backbone`).
 *
 * Access control on this backend is RBAC, not a capability grant model: there
 * is no action catalogue, no grant aggregate and no account lifecycle command.
 * There is a permission catalogue, a role catalogue, a role→permission join and
 * a user→role join, all mounted under `/api/v1/permissions`, plus an audit log
 * under `/api/v1/audit`. The routes below are the whole surface this app has.
 *
 *   GET    /v1/permissions/permissions              the 150-permission catalogue
 *   GET    /v1/permissions/roles                    23 roles, each with its
 *                                                   permissions embedded
 *   GET    /v1/permissions/roles/{id}               one role
 *   GET    /v1/permissions/roles/{id}/permissions   that role's permissions
 *   GET    /v1/permissions/roles/{id}/users         user ids holding the role
 *   POST   /v1/permissions/roles/{id}/permissions   grant one permission
 *   DELETE /v1/permissions/roles/{id}/permissions/{permId}   revoke one
 *   GET    /v1/permissions/users/{id}/roles         roles held by a user
 *   GET    /v1/permissions/users/{id}/role-assignments  …with scope and grantor
 *   GET    /v1/audit                                the audit log
 *
 * Three things about this backend shaped the module, none of them obvious from
 * the route list:
 *
 *  1. THERE IS NO USER DIRECTORY AN API KEY CAN READ. `identity_users` holds 40
 *     rows, but the only route that lists them — `GET /api/v1/auth/users` — is
 *     JWT-gated and demands `platform.users.manage`; it answers 401 to an
 *     API-key caller, and this app authenticates with an API key by design. So
 *     the user list is assembled from the one user-facing thing the permissions
 *     API will disclose: the membership of each role. That reaches every user
 *     who holds at least one role (40 of them, which happens to be every row in
 *     the table) and yields ids only — no display name, no email, no status.
 *     Those columns stay empty rather than being filled from somewhere else.
 *
 *  2. ROLE EDITS ARE PER-PERMISSION, NOT A SET REPLACEMENT. There is no
 *     `PUT …/permissions` and no version token, so a role edit is a sequence of
 *     grants and revokes with no optimistic-concurrency check available. The
 *     editor therefore reports exactly which calls succeeded and which failed
 *     instead of pretending the whole save was atomic.
 *
 *  3. THE AUDIT LOG IS OPERATIONAL, NOT ACCESS-CONTROL. Its rows are
 *     `actor_id` / `action` / `resource_type` strings (pricing edits, auth
 *     failures, voucher changes); they carry no subject or account uuid, so
 *     there is nothing to resolve them against and no name is manufactured.
 *
 * Writes carry an `Idempotency-Key`; cloud-hub's middleware treats it as an
 * opaque replay key and does not require one.
 */

import {
  api,
  checkContract,
  getErrorMessage,
  qs,
  useDomainQuery,
  type ApiRequestOptions,
} from "@/lib/api"
import { systemQueries } from "./queries"
import {
  AuditEventRow,
  PermissionRow,
  RoleAssignmentRow,
  RoleMemberEntry,
  RoleRow,
} from "./contracts"

/* ------------------------------------------------------------------ shapes */

export interface SystemPermission {
  id: string
  /** `finance.settle` — the code the rest of the platform authorises against. */
  code: string
  module: string
  action: string
  resource: string
  description: string
  createdAt: string
}

export interface SystemRole {
  id: string
  /** `superadmin` — the role code, distinct from its uuid-ish id. */
  key: string
  name: string
  description: string
  /** System roles are seeded by the platform and should not be reshaped lightly. */
  isSystem: boolean
  status: string
  /** Permission ids the role holds, in catalogue order. */
  permissionIds: string[]
  permissionCodes: string[]
  permissionCount: number
  /** Users holding this role, from `…/roles/{id}/users`. Ids only. */
  userIds: string[]
  userCount: number
  createdAt: string
  updatedAt: string
}

/**
 * A user as this backend will disclose one to an API-key caller: an id, and the
 * roles it holds. Everything else about the person is behind the JWT-gated
 * identity API — see the module header.
 */
export interface SystemUser {
  id: string
  roleIds: string[]
  roleNames: string[]
  /** Distinct permission codes reachable through those roles. */
  permissionCodes: string[]
}

export interface SystemRoleAssignment {
  userId: string
  roleId: string
  roleName: string
  roleKey: string
  /** `*` for an unscoped assignment; a store or location id otherwise. */
  scope: string
  assignedAt: string
  assignedBy: string
}

export interface SystemAccessCatalogue {
  roles: SystemRole[]
  permissions: SystemPermission[]
  users: SystemUser[]
  fetchedAt: string
}

export interface SystemAuditEvent {
  id: string
  occurredAt: string
  /** A username, a service name or an api-key actor — not a uuid. */
  actorId: string
  actorType: string
  action: string
  severity: string
  resourceType: string
  resourceId: string
  storeId: string | null
  ipAddress: string | null
  oldValue: string | null
  newValue: string | null
  metadata: Record<string, string>
}

export interface SystemAuditTrail {
  events: SystemAuditEvent[]
  /** What the server says exists, which can exceed what was fetched. */
  total: number
}

/* ------------------------------------------------------------ raw decoding */

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function stringValue(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value.trim()
  if (value == null) return fallback
  return String(value)
}

function nullableString(value: unknown): string | null {
  const text = stringValue(value)
  return text ? text : null
}

/** Every list route on this hub answers `{count, items}`. */
function itemsOf(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload
  const record = asRecord(payload)
  if (!record) return []
  for (const key of ["items", "data", "results", "entries"]) {
    const value = record[key]
    if (Array.isArray(value)) return value
  }
  return []
}

function totalOf(payload: unknown, fallback: number): number {
  const record = asRecord(payload)
  if (!record) return fallback
  for (const key of ["total", "count"]) {
    const value = record[key]
    if (typeof value === "number" && Number.isFinite(value)) return value
  }
  return fallback
}

function stringMap(value: unknown): Record<string, string> {
  const record = asRecord(value)
  if (!record) return {}
  const out: Record<string, string> = {}
  for (const [key, entry] of Object.entries(record))
    out[key] = stringValue(entry)
  return out
}

/** cloud-hub's idempotency middleware keys replays off this header. */
function idempotencyKey(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID()
  }
  const hex = "0123456789abcdef"
  let out = ""
  for (let index = 0; index < 36; index += 1) {
    if (index === 8 || index === 13 || index === 18 || index === 23) out += "-"
    else if (index === 14) out += "4"
    else if (index === 19)
      out += hex[(Math.floor(Math.random() * 16) & 0x3) | 0x8]
    else out += hex[Math.floor(Math.random() * 16)]
  }
  return out
}

function writeOptions(signal?: AbortSignal): ApiRequestOptions {
  return {
    headers: { "Idempotency-Key": idempotencyKey() },
    ...(signal ? { signal } : {}),
  }
}

function readOptions(signal?: AbortSignal): ApiRequestOptions | undefined {
  return signal ? { signal } : undefined
}

/* ----------------------------------------------------------------- mappers */

function permissionFromApi(raw: unknown): SystemPermission | null {
  const record = asRecord(raw)
  if (!record) return null
  const id = stringValue(record.id)
  const code = stringValue(record.code)
  if (!id && !code) return null
  const [derivedModule = "", ...rest] = code.split(".")
  return {
    id: id || `perm-${code}`,
    code: code || id,
    module: stringValue(record.module) || derivedModule,
    action: stringValue(record.action) || rest[rest.length - 1] || "",
    resource: stringValue(record.resource),
    description: stringValue(record.description),
    createdAt: stringValue(record.created_at),
  }
}

/** The role list embeds each role's permissions in full; the detail route agrees. */
function roleFromApi(raw: unknown, userIds: string[] = []): SystemRole | null {
  const record = asRecord(raw)
  if (!record) return null
  const id = stringValue(record.id)
  if (!id) return null
  const permissions = itemsOf({ items: record.permissions })
    .map(permissionFromApi)
    .filter((permission): permission is SystemPermission => Boolean(permission))
  return {
    id,
    key: stringValue(record.code, id),
    name: stringValue(record.name, id),
    description: stringValue(record.description),
    isSystem: record.is_system === true,
    status: stringValue(record.status, "active"),
    permissionIds: permissions.map((permission) => permission.id),
    permissionCodes: permissions.map((permission) => permission.code),
    permissionCount: permissions.length,
    userIds,
    userCount: userIds.length,
    createdAt: stringValue(record.created_at),
    updatedAt: stringValue(record.updated_at),
  }
}

function assignmentFromApi(raw: unknown): SystemRoleAssignment | null {
  const record = asRecord(raw)
  if (!record) return null
  const roleId = stringValue(record.role_id)
  if (!roleId) return null
  const role = asRecord(record.role)
  return {
    userId: stringValue(record.user_id),
    roleId,
    roleName: stringValue(role?.name) || roleId,
    roleKey: stringValue(role?.code),
    scope: stringValue(record.scope_value, "*"),
    assignedAt: stringValue(record.assigned_at),
    assignedBy: stringValue(record.assigned_by),
  }
}

function auditFromApi(raw: unknown): SystemAuditEvent | null {
  const record = asRecord(raw)
  if (!record) return null
  const id = stringValue(record.id)
  if (!id) return null
  return {
    id,
    occurredAt: stringValue(record.timestamp),
    actorId: stringValue(record.actor_id, "unknown"),
    actorType: stringValue(record.actor_type, "unknown"),
    action: stringValue(record.action, "unknown"),
    severity: stringValue(record.severity, "info"),
    resourceType: stringValue(record.resource_type, "unknown"),
    resourceId: stringValue(record.resource_id),
    storeId: nullableString(record.store_id),
    ipAddress: nullableString(record.ip_address),
    oldValue: nullableString(record.old_value),
    newValue: nullableString(record.new_value),
    metadata: stringMap(record.metadata),
  }
}

/* --------------------------------------------------------------- catalogue */

/**
 * Roles, the permission catalogue, and the user list that role membership
 * implies.
 *
 * `…/roles/{id}/users` is the only user-facing route an API-key caller may
 * read, so it is called once per role (23 calls) and the results are inverted
 * into a user→roles index. A role whose membership call fails is kept with an
 * empty membership rather than dropping the role from the catalogue.
 */
export async function fetchAccessCatalogue(
  signal?: AbortSignal
): Promise<SystemAccessCatalogue> {
  const [rolePayload, permissionPayload] = await Promise.all([
    api.get<unknown>("/v1/permissions/roles", readOptions(signal)),
    api.get<unknown>("/v1/permissions/permissions", readOptions(signal)),
  ])

  const rawRoles = itemsOf(rolePayload)
    .map((raw) => asRecord(raw))
    .filter((record): record is Record<string, unknown> => Boolean(record))
  checkContract(RoleRow, rawRoles, "/v1/permissions/roles")
  for (const record of rawRoles) {
    if (Array.isArray(record.permissions)) {
      checkContract(
        PermissionRow,
        record.permissions,
        "/v1/permissions/roles#permissions"
      )
    }
  }

  const memberships = await Promise.all(
    rawRoles.map((record) => {
      const url = `/v1/permissions/roles/${encodeURIComponent(stringValue(record.id))}/users`
      return api
        .get<unknown>(url, readOptions(signal))
        .then((payload) => {
          const entries = itemsOf(payload)
          // Id-free label — see the "Naming the path label" note in the
          // recipe: a real role id here would dedup per role, not per route.
          checkContract(RoleMemberEntry, entries, "/v1/permissions/roles/:id/users")
          return entries.map((entry) => stringValue(entry)).filter(Boolean)
        })
        .catch(() => [] as string[])
    })
  )

  const roles = rawRoles
    .map((record, index) => roleFromApi(record, memberships[index]))
    .filter((role): role is SystemRole => Boolean(role))
    .sort((a, b) => a.name.localeCompare(b.name))

  const rawPermissions = itemsOf(permissionPayload)
  checkContract(PermissionRow, rawPermissions, "/v1/permissions/permissions")
  const permissions = rawPermissions
    .map(permissionFromApi)
    .filter((permission): permission is SystemPermission => Boolean(permission))
    .sort((a, b) => a.code.localeCompare(b.code))

  return {
    roles,
    permissions,
    users: usersFromRoles(roles),
    fetchedAt: new Date().toISOString(),
  }
}

/** Inverts role membership into the user list. Ids only — see the header. */
export function usersFromRoles(roles: SystemRole[]): SystemUser[] {
  const byUser = new Map<
    string,
    { roleIds: string[]; roleNames: string[]; codes: Set<string> }
  >()
  for (const role of roles) {
    for (const userId of role.userIds) {
      const entry = byUser.get(userId) ?? {
        roleIds: [],
        roleNames: [],
        codes: new Set<string>(),
      }
      entry.roleIds.push(role.id)
      entry.roleNames.push(role.name)
      for (const code of role.permissionCodes) entry.codes.add(code)
      byUser.set(userId, entry)
    }
  }
  return [...byUser.entries()]
    .map<SystemUser>(([id, entry]) => ({
      id,
      roleIds: entry.roleIds,
      roleNames: entry.roleNames.sort((a, b) => a.localeCompare(b)),
      permissionCodes: [...entry.codes].sort(),
    }))
    .sort((a, b) => a.id.localeCompare(b.id))
}

export function useAccessCatalogue() {
  return useDomainQuery(systemQueries.accessCatalogue())
}

/* --------------------------------------------------------------- one user */

/** The live assignment records for one user: scope, grantor and timestamp. */
export async function fetchRoleAssignments(
  userId: string,
  signal?: AbortSignal
): Promise<SystemRoleAssignment[]> {
  const url = `/v1/permissions/users/${encodeURIComponent(userId)}/role-assignments`
  const payload = await api.get<unknown>(url, readOptions(signal))
  const rows = itemsOf(payload)
  // Id-free label — see "Naming the path label" in the recipe.
  checkContract(RoleAssignmentRow, rows, "/v1/permissions/users/:id/role-assignments")
  return rows
    .map(assignmentFromApi)
    .filter((assignment): assignment is SystemRoleAssignment =>
      Boolean(assignment)
    )
    .sort((a, b) => b.assignedAt.localeCompare(a.assignedAt))
}

/* ------------------------------------------------------------------- audit */

/** `/v1/audit` caps `limit` at 500 and pages with `offset`; it reports a total. */
const AUDIT_PAGE_SIZE = 500

export async function fetchAuditTrail(
  signal?: AbortSignal
): Promise<SystemAuditTrail> {
  const auditPath = "/v1/audit"
  const first = await api.get<unknown>(
    `${auditPath}${qs({ limit: AUDIT_PAGE_SIZE })}`,
    readOptions(signal)
  )
  const rows = [...itemsOf(first)]
  const total = totalOf(first, rows.length)

  if (total > rows.length && rows.length > 0) {
    const offsets: number[] = []
    for (let at = rows.length; at < total; at += AUDIT_PAGE_SIZE)
      offsets.push(at)
    const pages = await Promise.all(
      offsets.map((offset) =>
        api.get<unknown>(
          `${auditPath}${qs({ limit: AUDIT_PAGE_SIZE, offset })}`,
          readOptions(signal)
        )
      )
    )
    for (const page of pages) rows.push(...itemsOf(page))
  }
  checkContract(AuditEventRow, rows, auditPath)

  return {
    events: rows
      .map(auditFromApi)
      .filter((event): event is SystemAuditEvent => Boolean(event))
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)),
    total,
  }
}

export function useAuditTrail() {
  return useDomainQuery(systemQueries.auditTrail())
}

/* ------------------------------------------------------------------ writes */

export interface RolePermissionsSaveResult {
  /** True only when every grant and revoke in the diff succeeded. */
  ok: boolean
  granted: string[]
  revoked: string[]
  /** Permission ids whose call failed, with the reason the server gave. */
  failures: {
    permissionId: string
    operation: "grant" | "revoke"
    message: string
  }[]
  role: SystemRole
}

/**
 * Reshapes a role's permission set.
 *
 * This backend has no set-replacement route and no version token: the only
 * verbs are `POST …/roles/{id}/permissions` (one permission) and
 * `DELETE …/roles/{id}/permissions/{permId}`. So a save is a sequence of small
 * writes with no atomicity and no stale-write detection, and this function
 * reports each outcome individually rather than presenting a partial save as a
 * whole one. The role is re-read afterwards so the caller shows server truth.
 */
export async function saveRolePermissions(
  roleId: string,
  nextPermissionIds: string[],
  currentPermissionIds: string[],
  signal?: AbortSignal
): Promise<RolePermissionsSaveResult> {
  const next = new Set(nextPermissionIds)
  const current = new Set(currentPermissionIds)
  const toGrant = [...next].filter((id) => !current.has(id))
  const toRevoke = [...current].filter((id) => !next.has(id))

  const granted: string[] = []
  const revoked: string[] = []
  const failures: RolePermissionsSaveResult["failures"] = []

  for (const permissionId of toGrant) {
    try {
      await api.post<unknown>(
        `/v1/permissions/roles/${encodeURIComponent(roleId)}/permissions`,
        { permission_id: permissionId },
        writeOptions(signal)
      )
      granted.push(permissionId)
    } catch (error: unknown) {
      failures.push({
        permissionId,
        operation: "grant",
        message: getErrorMessage(error),
      })
    }
  }

  for (const permissionId of toRevoke) {
    try {
      await api.del<unknown>(
        `/v1/permissions/roles/${encodeURIComponent(roleId)}/permissions/${encodeURIComponent(permissionId)}`,
        writeOptions(signal)
      )
      revoked.push(permissionId)
    } catch (error: unknown) {
      failures.push({
        permissionId,
        operation: "revoke",
        message: getErrorMessage(error),
      })
    }
  }

  const role = await fetchRole(roleId, signal)
  return { ok: failures.length === 0, granted, revoked, failures, role }
}

export async function fetchRole(
  roleId: string,
  signal?: AbortSignal
): Promise<SystemRole> {
  const rolePath = `/v1/permissions/roles/${encodeURIComponent(roleId)}`
  // Id-free label — see "Naming the path label" in the recipe.
  const roleLabel = "/v1/permissions/roles/:id"
  const [rolePayload, userPayload] = await Promise.all([
    api.get<unknown>(rolePath, readOptions(signal)),
    api
      .get<unknown>(`${rolePath}/users`, readOptions(signal))
      .catch(() => undefined),
  ])
  checkContract(RoleRow, [rolePayload], roleLabel)
  const roleRecord = asRecord(rolePayload)
  if (roleRecord && Array.isArray(roleRecord.permissions)) {
    checkContract(PermissionRow, roleRecord.permissions, `${roleLabel}#permissions`)
  }
  const userEntries = itemsOf(userPayload)
  checkContract(RoleMemberEntry, userEntries, `${roleLabel}/users`)
  const userIds = userEntries
    .map((entry) => stringValue(entry))
    .filter(Boolean)
  const role = roleFromApi(rolePayload, userIds)
  if (!role) throw new Error("cloud-hub returned an unreadable role record")
  return role
}
