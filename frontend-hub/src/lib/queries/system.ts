import { node } from "@/lib/api"
import type {
  ChangePasswordRequest,
  CreateUserRequest,
  NotificationPage,
  ResetPasswordRequest,
  Role,
  SetEdgeAssignmentActiveRequest,
  SetUserActiveRequest,
  SetUserRoleRequest,
  UpsertEdgeAssignmentRequest,
} from "@itulah/contract"

/// System reads and writes: the node register, the command lane, the identity
/// store, and the notification list.
///
/// Request bodies come from `@itulah/contract` wherever the server generates
/// them with ts-rs. The *responses* mostly do not: `cloud/http/auth.rs` and the
/// sync handlers in `cloud/http/mod.rs` build their answers with `json!()`
/// rather than serialising a struct, so ts-rs has nothing to generate from and
/// the interfaces below are transcribed from those literals by hand. They are
/// not checked against the server at build time — if a field moves, this file
/// is where it goes stale, and it is the first place to look when a column
/// reads `undefined`.
///
/// Nothing here ever returns a secret into the app. `edge_password` and
/// `ingest_key` travel one way only, and the one-time `device_key` the server
/// hands back from an RFID register or rotate is deliberately not modelled: a
/// value this app cannot render is a value it should not hold.

/// Somebody with an account at the centre.
export interface UserRow {
  readonly id: string
  readonly username: string
  readonly display_name: string
  readonly role: Role
  readonly active: boolean
  readonly created_by: string
  readonly created_at: string
  /// Null until they have signed in once. A dormant account is the one a
  /// person actually has to decide about.
  readonly last_login_at: string | null
}

/// A node the centre has issued an ingest key to. The key itself is never in
/// this answer — `list_origin_credentials` selects around it on purpose.
export interface SyncOrigin {
  readonly origin_id: string
  readonly label: string | null
  readonly site_id: string | null
  readonly node_role: string | null
  /// The epoch fence. A node that was rebuilt comes back on a new generation
  /// and everything stamped with the old one is refused.
  readonly active_generation: number
  readonly inventory_enabled: boolean
  readonly created_at: string
  readonly rotated_at: string | null
}

/// Why one node stopped applying the command stream, and since when.
export interface FleetBlock {
  readonly seq: number
  readonly reason: string | null
  readonly since: string | null
}

/// One node's position in the downstream command lane.
export interface FleetRow {
  readonly origin_id: string
  readonly label: string | null
  readonly issued_seq: number
  readonly acked_seq: number
  /// Issued minus acknowledged — the backlog this node still owes.
  readonly pending: number
  readonly converged: boolean
  readonly last_ack_age_seconds: number | null
  readonly blocked: FleetBlock | null
}

export interface Fleet {
  readonly stores: number
  readonly converged: number
  readonly behind: number
  readonly blocked: number
  readonly items: readonly FleetRow[]
}

/// A fact the centre refused, kept rather than dropped.
export interface DeadLetter {
  readonly origin_id: string
  readonly generation: number
  readonly seq: number
  readonly event_id: string
  readonly event_type: string
  readonly payload: unknown
  readonly reason: string
  readonly rejected_at: string
}

/// Where the centre's arithmetic and a node's own claim disagree about one
/// pool. An empty list is the ordinary state.
export interface PoolDiscrepancy {
  readonly origin_id: string
  readonly site_id: string
  readonly pool_id: string
  readonly computed_on_hand: number
  readonly observed_on_hand: number
  readonly difference: number
  readonly computed_allotted: number
  readonly observed_allotted: number
  readonly allotted_difference: number
  readonly snapshot_seq: number
  readonly applied_seq: number
}

export interface Reconciliation {
  readonly reconciled: boolean
  readonly discrepancy_count: number
  readonly discrepancies: readonly PoolDiscrepancy[]
}

export interface CommandSettled {
  readonly origin_id: string
  readonly seq: number
}

export interface CommandPending {
  readonly origin_id: string
  readonly seq: number
  readonly acked_seq: number
  readonly blocked_at_seq: number | null
  readonly blocked_reason: string | null
}

/// How far one command has actually travelled.
export interface CommandReach {
  readonly command_id: string
  readonly command_type: string
  readonly issued_by: string
  readonly issued_at: string
  readonly expires_at: string | null
  readonly revoked_at: string | null
  readonly revoked_reason: string | null
  readonly converged: boolean
  readonly settled_count: number
  readonly pending_count: number
  readonly settled: readonly CommandSettled[]
  readonly pending: readonly CommandPending[]
}

/// The receipt from issuing a command: the id to trace it by, and who it went
/// to once the server expanded an empty target list to the whole fleet.
export interface IssuedCommand {
  readonly command_id: string
  readonly command_type: string
  readonly targets: readonly string[]
}

/// Somebody's access at ONE node. Their role here is not their role at the
/// centre: a supervisor at head office can be an ordinary cashier at the till.
export interface EdgeAssignment {
  readonly origin_id: string
  readonly user_id: string
  readonly username: string
  readonly display_name: string
  readonly role: Role
  readonly active: boolean
  /// How long this node may keep honouring the assignment while it cannot
  /// reach the centre.
  readonly offline_ttl_seconds: number
  readonly updated_at: string
}

/// A reader on a node's floor. Its key is not here and never will be.
export interface RfidDevice {
  readonly device_id: string
  readonly origin_id: string
  readonly label: string
  readonly active: boolean
  readonly offline_ttl_seconds: number
  readonly pools: readonly string[]
  readonly created_at: string
  readonly updated_at: string
  readonly last_seen_at: string | null
}

/// What a policy publication produced. Every identity write publishes one, so
/// this comes back from a grant, a suspension, a device change and the
/// explicit publish alike.
export interface PolicyReceipt {
  readonly snapshot_id: string
  readonly version: number
  readonly origin_id: string
  readonly valid_until: string
  readonly user_count: number
  readonly device_count: number
  readonly command_id: string
}

/// Keys live beside the function that fetches them, first segment = the domain
/// namespace so signing out drops this module's answers by prefix.
export const systemKeys = {
  all: ["system"] as const,
  users: () => ["system", "users"] as const,
  origins: () => ["system", "origins"] as const,
  fleet: () => ["system", "fleet"] as const,
  deadLetters: () => ["system", "dead-letters"] as const,
  reconciliation: () => ["system", "reconciliation"] as const,
  command: (id: string) => ["system", "commands", id] as const,
  notifications: () => ["system", "notifications"] as const,
  edgeAssignments: () => ["system", "edge-assignments"] as const,
  rfidDevices: () => ["system", "rfid-devices"] as const,
}

// ---- The node register ----------------------------------------------------

export function listOrigins(signal?: AbortSignal) {
  return node
    .get<{ items: SyncOrigin[] }>("/api/v1/sync/origins", { signal })
    .then((body) => body.items)
}

/// Register a node, or rotate the key one already has.
///
/// `ingest_key` is write-only in both directions: it is typed once, sent once,
/// and no read on this node ever returns it. Omitting `inventory_enabled`
/// during a rotation preserves whatever the origin already had — which is why
/// it is optional rather than defaulted here.
export interface RegisterOriginRequest {
  readonly origin_id: string
  readonly ingest_key: string
  readonly label?: string
  readonly site_id?: string
  readonly node_role?: string
  readonly active_generation?: number
  readonly inventory_enabled?: boolean
}

/// The master key, when the node has one configured, is the operator's and is
/// held for exactly one request. It is never stored and never read back.
export function registerOrigin(
  request: RegisterOriginRequest,
  masterKey: string,
  signal?: AbortSignal
) {
  return node.post<{ status: string; origin_id: string }>(
    "/api/v1/sync/origins",
    request,
    { signal, headers: masterKey ? { "x-sync-key": masterKey } : undefined }
  )
}

export function fleetStatus(signal?: AbortSignal) {
  return node.get<Fleet>("/api/v1/sync/fleet", { signal })
}

// ---- The command lane -----------------------------------------------------

export function commandReach(id: string, signal?: AbortSignal) {
  return node.get<CommandReach>(
    `/api/v1/sync/commands/${encodeURIComponent(id)}`,
    { signal }
  )
}

export interface IssueCommandRequest {
  readonly command_type: string
  readonly payload: unknown
  readonly issued_by: string
  readonly expires_at?: string | null
  /// Empty means the whole registered fleet, and the server says so in its
  /// answer by expanding the list.
  readonly targets: readonly string[]
}

/// Issue a command to named nodes, or to everything registered.
///
/// No `Idempotency-Key`: the cloud node's dedupe table covers the inventory
/// command paths, not this one, so sending the header would look like a
/// guarantee that is not there. The screen disables its own submit instead.
export function issueCommand(
  request: IssueCommandRequest,
  masterKey: string,
  signal?: AbortSignal
) {
  return node.post<IssuedCommand>("/api/v1/sync/commands", request, {
    signal,
    headers: masterKey ? { "x-sync-key": masterKey } : undefined,
  })
}

/// Recall a command. Nodes that have not applied it yet skip it; nodes that
/// already applied it are unaffected — a recall is not an undo, and the
/// answer says how many were caught in time.
export function revokeCommand(
  id: string,
  reason: string,
  masterKey: string,
  signal?: AbortSignal
) {
  return node.post<{
    command_id: string
    status: string
    stores_caught_in_time: number
  }>(
    `/api/v1/sync/commands/${encodeURIComponent(id)}/revoke`,
    { reason },
    { signal, headers: masterKey ? { "x-sync-key": masterKey } : undefined }
  )
}

export function listDeadLetters(limit = 100, signal?: AbortSignal) {
  return node
    .get<{ items: DeadLetter[] }>(`/api/v1/sync/dead-letters?limit=${limit}`, {
      signal,
    })
    .then((body) => body.items)
}

export function reconciliation(signal?: AbortSignal) {
  return node.get<Reconciliation>("/api/v1/sync/reconciliation", { signal })
}

/// Close the breaker and retry now. Deliberately a person's decision: the
/// breaker opened because retrying was making an incident worse.
export function resetBreaker(signal?: AbortSignal) {
  return node.post<{ status: string }>(
    "/api/v1/sync/breaker/reset",
    {},
    { signal }
  )
}

// ---- The identity store ---------------------------------------------------

export function listUsers(signal?: AbortSignal) {
  return node
    .get<{ items: UserRow[] }>("/api/v1/auth/users", { signal })
    .then((body) => body.items)
}

export function createUser(request: CreateUserRequest, signal?: AbortSignal) {
  return node.post<{
    id: string
    username: string
    display_name: string
    role: Role
    active: boolean
  }>("/api/v1/auth/users", request, { signal })
}

/// Suspend or restore an account everywhere at once. The server revokes every
/// live session for that user and republishes the policy to each node they are
/// assigned to, so the answer carries both.
export function setUserActive(
  id: string,
  request: SetUserActiveRequest,
  signal?: AbortSignal
) {
  return node.post<{
    user: { id: string; username: string; active: boolean }
    policies: unknown
  }>(`/api/v1/auth/users/${encodeURIComponent(id)}/active`, request, { signal })
}

/// Promote or demote at the centre only. The same person's role AT a node
/// lives on their assignment, and the server says so in `edge_roles_unchanged`.
export function setUserRole(
  id: string,
  request: SetUserRoleRequest,
  signal?: AbortSignal
) {
  return node.post<{
    username: string
    role: Role
    previous_role: Role
    edge_roles_unchanged: boolean
  }>(`/api/v1/auth/users/${encodeURIComponent(id)}/role`, request, { signal })
}

/// An administrator setting a password for somebody who cannot supply the old
/// one. Sent, never echoed: the answer carries a username and whether the
/// account is still suspended, and nothing else.
export function resetUserPassword(
  id: string,
  request: ResetPasswordRequest,
  signal?: AbortSignal
) {
  return node.post<{ username: string; reset: boolean; active: boolean }>(
    `/api/v1/auth/users/${encodeURIComponent(id)}/password`,
    request,
    { signal }
  )
}

/// Somebody changing their OWN password. The server clears the session cookie
/// in the same response, so the caller is signed out by the act of succeeding.
export function changeOwnPassword(
  request: ChangePasswordRequest,
  signal?: AbortSignal
) {
  return node.post<{ username: string; changed: boolean }>(
    "/api/v1/auth/change-password",
    request,
    { signal }
  )
}

// ---- Access at a node -----------------------------------------------------

export function listEdgeAssignments(signal?: AbortSignal) {
  return node
    .get<{ items: EdgeAssignment[] }>("/api/v1/auth/edge-assignments", {
      signal,
    })
    .then((body) => body.items)
}

/// Grant somebody access at one node, or rotate the PIN they use there.
///
/// Deliberately does NOT restore a suspended assignment: rotating a PIN and
/// readmitting somebody are two decisions, and the server keeps them apart.
export function upsertEdgeAssignment(
  request: UpsertEdgeAssignmentRequest,
  signal?: AbortSignal
) {
  return node.post<{
    origin_id: string
    user_id: string
    role: Role
    active: boolean
    offline_ttl_seconds: number
    policy: PolicyReceipt
  }>("/api/v1/auth/edge-assignments", request, { signal })
}

export function setEdgeAssignmentActive(
  originId: string,
  userId: string,
  request: SetEdgeAssignmentActiveRequest,
  signal?: AbortSignal
) {
  return node.post<{
    origin_id: string
    user_id: string
    active: boolean
    policy: PolicyReceipt
  }>(
    `/api/v1/auth/edge-assignments/${encodeURIComponent(originId)}/${encodeURIComponent(userId)}/active`,
    request,
    { signal }
  )
}

/// Send one node the complete picture of who may sign in there and which
/// readers are trusted. Every identity write publishes one already; this is
/// the button for when a node needs it again without a change to publish.
export function publishEdgePolicy(originId: string, signal?: AbortSignal) {
  return node.post<PolicyReceipt>(
    `/api/v1/auth/edge-policies/${encodeURIComponent(originId)}/publish`,
    {},
    { signal }
  )
}

// ---- Readers --------------------------------------------------------------

export function listRfidDevices(signal?: AbortSignal) {
  return node
    .get<{ items: RfidDevice[] }>("/api/v1/auth/rfid-devices", { signal })
    .then((body) => body.items)
}

export interface RegisterRfidDeviceRequest {
  readonly device_id: string
  readonly origin_id: string
  readonly label: string
  readonly pools: readonly string[]
  readonly offline_ttl_seconds?: number | null
}

/// Register a reader.
///
/// The server mints a device key and returns it exactly once. It is not in the
/// return type here on purpose: this console never renders a secret, so the
/// value is discarded at the boundary rather than carried into a component
/// where somebody could paste it into a screenshot.
export function registerRfidDevice(
  request: RegisterRfidDeviceRequest,
  signal?: AbortSignal
) {
  return node
    .post<{ device_id: string; origin_id: string; policy: PolicyReceipt }>(
      "/api/v1/auth/rfid-devices",
      request,
      { signal }
    )
    .then(({ device_id, origin_id, policy }) => ({
      device_id,
      origin_id,
      policy,
    }))
}

export function setRfidDeviceActive(
  deviceId: string,
  active: boolean,
  signal?: AbortSignal
) {
  return node.post<{
    device_id: string
    origin_id: string
    active: boolean
    policy: PolicyReceipt
  }>(
    `/api/v1/auth/rfid-devices/${encodeURIComponent(deviceId)}/active`,
    { active },
    { signal }
  )
}

/// Retire the key a reader is using and mint another.
///
/// The old key stops working the moment the new policy reaches the node, and
/// the new one is shown nowhere — so this is the answer to a leaked key, and
/// the reader has to be provisioned again from the node afterwards. The screen
/// says exactly that before it asks.
export function rotateRfidDeviceKey(deviceId: string, signal?: AbortSignal) {
  return node
    .post<{ device_id: string; origin_id: string; policy: PolicyReceipt }>(
      `/api/v1/auth/rfid-devices/${encodeURIComponent(deviceId)}/rotate`,
      {},
      { signal }
    )
    .then(({ device_id, origin_id, policy }) => ({
      device_id,
      origin_id,
      policy,
    }))
}

// ---- Notifications --------------------------------------------------------

export function listNotifications(limit = 50, signal?: AbortSignal) {
  return node.get<NotificationPage>(`/api/v1/notifications?limit=${limit}`, {
    signal,
  })
}

export function markNotificationRead(id: string, signal?: AbortSignal) {
  return node.post<{ unread: number }>(
    `/api/v1/notifications/${encodeURIComponent(id)}/read`,
    {},
    { signal }
  )
}

/// Clear the badge, and say how many that took — the screen tells the person
/// what it did rather than merely that the number went to zero.
export function markAllNotificationsRead(signal?: AbortSignal) {
  return node.post<{ cleared: number; unread: number }>(
    "/api/v1/notifications/read-all",
    {},
    { signal }
  )
}
