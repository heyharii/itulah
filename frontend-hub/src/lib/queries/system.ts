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
  SyncFleetHealth,
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
  /// Who this credential belongs to, from `app_user.employee_id`.
  ///
  /// Null in all of them together means nobody: a machine account moving stock
  /// between nodes, or a login HR has not finished the paperwork for. The two
  /// read the same here and the console says so in words rather than leaving a
  /// blank cell to be read as a loading bug.
  readonly employee_id: string | null
  readonly employee_code: string | null
  /// The employment record's status, not the account's. `TERMINATED` beside
  /// `active: true` is a live credential for somebody who has left.
  readonly employee_status: string | null
  readonly employee_name: string | null
  readonly place_id: string | null
  readonly place_name: string | null
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
  health: () => ["system", "health"] as const,
  command: (id: string) => ["system", "commands", id] as const,
  notifications: () => ["system", "notifications"] as const,
  edgeAssignments: () => ["system", "edge-assignments"] as const,
  rfidDevices: () => ["system", "rfid-devices"] as const,
  enrolments: () => ["system", "enrolments"] as const,
  nodeHealth: () => ["system", "node-health"] as const,
  nodeIncidents: (originId: string) =>
    ["system", "node-incidents", originId] as const,
  devices: () => ["system", "devices"] as const,
  deviceHistory: (deviceId: string) =>
    ["system", "device-history", deviceId] as const,
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

// ---- Enrolling a machine ---------------------------------------------------
//
// The replacement for typing keys into the sheet above: an Admin issues a
// one-time code for a site, the machine in the shop claims it with a key it
// minted itself, and an Admin approves after reading back the six-digit
// verification number with the shop. See `backend/src/sync/enrolment.rs` and
// `STORE-SERVER-PLAN.md` §2. Transcribed by hand from
// `cloud/postgres/node_enrolment.rs`.

export type EnrolmentStatus =
  | "ISSUED"
  | "EXPIRED"
  | "CLAIMED"
  | "STALE"
  | "APPROVED"
  | "REJECTED"
  | "REVOKED"

export interface EnrolmentMachine {
  readonly hostname: string
  readonly os: string
  readonly arch: string
  readonly version: string
}

export interface Enrolment {
  readonly enrolment_id: string
  readonly site_id: string
  readonly site_name: string | null
  readonly origin_id: string
  readonly node_role: string
  readonly label: string | null
  readonly status: EnrolmentStatus
  readonly issued_by: string
  readonly issued_at: string
  readonly expires_at: string
  readonly claimed_at: string | null
  readonly verification: string | null
  readonly machine: EnrolmentMachine | null
  readonly claimed_from: string | null
  readonly decided_by: string | null
  readonly decided_at: string | null
  readonly active_generation: number | null
  readonly delivered_at: string | null
}

export interface IssueEnrolmentRequest {
  readonly site_id: string
  readonly node_role?: string
  readonly label?: string
  readonly ttl_minutes?: number
}

/// The code comes back once, here, and no read ever returns it again.
export interface IssuedEnrolment {
  readonly enrolment_id: string
  readonly site_id: string
  readonly origin_id: string
  readonly node_role: string
  readonly code: string
  readonly expires_at: string
}

/// Per stream, what the new node was sent, or `{ error }` for a stream that
/// failed and can be sent again from the node's sheet.
export type BootstrapReport = Readonly<Record<string, unknown>>

export function listEnrolments(signal?: AbortSignal) {
  return node
    .get<{ items: Enrolment[] }>("/api/v1/sync/enrollments", { signal })
    .then((body) => body.items)
}

export function issueEnrolment(request: IssueEnrolmentRequest) {
  return node.post<IssuedEnrolment>("/api/v1/sync/enrollments", request)
}

export function approveEnrolment(id: string) {
  return node.post<{ enrolment: Enrolment; bootstrap: BootstrapReport }>(
    `/api/v1/sync/enrollments/${encodeURIComponent(id)}/approve`,
    {}
  )
}

export function refuseEnrolment(id: string) {
  return node.post<Enrolment>(
    `/api/v1/sync/enrollments/${encodeURIComponent(id)}/refuse`,
    {}
  )
}

/// Send an enrolled node everything the fleet already knows, again.
export function bootstrapOrigin(originId: string) {
  return node.post<BootstrapReport>(
    `/api/v1/sync/origins/${encodeURIComponent(originId)}/bootstrap`,
    {}
  )
}

// ---- Shop servers' health ---------------------------------------------------
//
// What each store server last said about itself in its heartbeat, judged by
// the same function its own console uses (`backend/src/sync/node_status.rs`),
// so the sentence here is the sentence the shop sees. Transcribed by hand
// from `cloud/postgres/node_health.rs`.

export type HealthTone = "OK" | "INFO" | "WARN" | "BAD"

export interface NodeAssessment {
  readonly tone: HealthTone
  readonly code: string
  readonly label: string
  readonly headline: string
  readonly sentence: string
  readonly since: string | null
  readonly needs: "NOBODY" | "SHOP" | "HEAD_OFFICE" | "DEVELOPER"
}

export type NodeIncident =
  | {
      readonly kind: "STARTED"
      readonly at: string
      readonly version: string
      readonly previous: PreviousExit
    }
  | { readonly kind: "STOPPED"; readonly at: string; readonly reason: string }
  | {
      readonly kind: "HUNG"
      readonly at: string
      readonly stalled_seconds: number
    }
  | {
      readonly kind: "CRASH_LOOP"
      readonly at: string
      readonly starts_in_window: number
      readonly hold_seconds: number
    }
  | { readonly kind: "AWAITING_ENROLMENT"; readonly at: string }
  | { readonly kind: "ENROLLED"; readonly at: string; readonly site_id: string }

export type PreviousExit =
  | { readonly how: "FIRST_START" }
  | { readonly how: "CLEAN"; readonly at: string }
  | { readonly how: "HUNG"; readonly at: string }
  | {
      readonly how: "UNCLEAN"
      readonly last_seen: string
      readonly machine_restarted: boolean | null
    }

export interface NodeStatusSnapshot {
  readonly taken_at: string
  readonly version: string
  readonly started_at: string
  readonly hostname: string
  readonly os: string
  readonly sync: {
    readonly last_success_at: string | null
    readonly pending_facts: number
    readonly oldest_pending_at: string | null
    readonly consecutive_failures: number
    readonly dead_lettered: number
    readonly last_error: string | null
  }
  readonly machine: {
    readonly disk_free_bytes: number | null
    readonly disk_total_bytes: number | null
    readonly memory_used_bytes: number | null
    readonly memory_total_bytes: number | null
    readonly database_bytes: number | null
    readonly machine_uptime_seconds: number | null
    readonly clock_skew_seconds: number | null
  }
  readonly devices: {
    readonly terminals_active: number
    readonly terminals_seen_recently: number
    readonly rfid_active: number
    readonly rfid_seen_recently: number
  }
  readonly till: {
    readonly open_shifts: number
    readonly open_shift_terminals: readonly string[]
  }
}

export interface FleetNodeHealth {
  readonly origin_id: string
  readonly site_id: string | null
  readonly site_name: string | null
  readonly last_heard_at: string | null
  readonly version: string | null
  readonly assessment: NodeAssessment
  readonly status: NodeStatusSnapshot | null
  /// Four hours in 16 slots of 15 minutes, oldest first; `null` = no heartbeat.
  readonly strip: readonly (HealthTone | null)[]
  readonly alerted_code: string | null
}

export function listNodeHealth(signal?: AbortSignal) {
  return node
    .get<{ items: FleetNodeHealth[] }>("/api/v1/sync/nodes", { signal })
    .then((body) => body.items)
}

export function nodeIncidents(originId: string, signal?: AbortSignal) {
  return node
    .get<{ items: NodeIncident[] }>(
      `/api/v1/sync/nodes/${encodeURIComponent(originId)}/incidents`,
      { signal }
    )
    .then((body) => body.items)
}

// ---- Devices ------------------------------------------------------------------
//
// Every machine enrolled to a node — tills, printers, readers — as the nodes
// report them in their heartbeats. Transcribed by hand from
// `cloud/postgres/devices.rs` (`RegistryDevice`, `DeviceStatusEvent`).

export type DeviceKind =
  | "TILL"
  | "HANDHELD"
  | "RFID_READER"
  | "PRINTER"
  | "EDC"
  | "ATTENDANCE_TERMINAL"

export type DeviceStatus = "ACTIVE" | "SUSPENDED" | "REVOKED"

export interface RegistryDevice {
  readonly device_id: string
  readonly kind: DeviceKind
  readonly origin_id: string
  readonly node_label: string | null
  readonly site_id: string
  readonly site_name: string | null
  readonly label: string
  /// What the node last reported. The node is the authority for a till and a
  /// printer; head office's ask is `requested_status` until it agrees.
  readonly status: DeviceStatus
  readonly requested_status: DeviceStatus | null
  readonly requested_by: string | null
  readonly requested_at: string | null
  readonly requested_reason: string | null
  readonly last_seen_at: string | null
  /// Kind-specific and never secret: a printer's host and port, a till's
  /// peripherals and machine, a reader's pools.
  readonly config: Readonly<Record<string, unknown>>
  readonly replaces_device_id: string | null
  readonly rfid_device_id: string | null
  readonly attendance_terminal_id: string | null
  readonly registered_at: string | null
  readonly registered_by: string | null
  readonly first_reported_at: string
  readonly updated_at: string
  /// Whether head office can suspend, reactivate or revoke it from here.
  readonly switchable: boolean
}

export interface DeviceStatusEvent {
  readonly source: "NODE" | "HUB"
  readonly from_status: DeviceStatus | null
  readonly to_status: DeviceStatus
  readonly actor: string
  readonly reason: string | null
  readonly at: string
}

export function listDevices(signal?: AbortSignal) {
  return node
    .get<{ items: RegistryDevice[] }>("/api/v1/sync/devices", { signal })
    .then((body) => body.items)
}

export function deviceHistory(deviceId: string, signal?: AbortSignal) {
  return node
    .get<{ items: DeviceStatusEvent[] }>(
      `/api/v1/sync/devices/${encodeURIComponent(deviceId)}/history`,
      { signal }
    )
    .then((body) => body.items)
}

/// Ask a device's node to suspend, reactivate or revoke it. The answer is the
/// device with `requested_status` set; its `status` changes when the node's
/// next heartbeat reports it.
export function setDeviceStatus(
  deviceId: string,
  request: { readonly status: DeviceStatus; readonly reason?: string }
) {
  return node.post<RegistryDevice>(
    `/api/v1/sync/devices/${encodeURIComponent(deviceId)}/status`,
    request
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

/// One value a system list can be narrowed by, and how many rows it leaves.
/// Counted over what the search leaves, ignoring the filters applied — so the
/// number beside a value answers "how many of these are there".
export interface SystemFacet {
  readonly value: string
  readonly label: string | null
  readonly count: number
}

export interface DeadLetterFacets {
  readonly origins: readonly SystemFacet[]
  readonly event_types: readonly SystemFacet[]
  readonly reasons: readonly SystemFacet[]
}

/// A page of rejections, and the shape of everything it was drawn from.
///
/// This replaced a bare `{ items }`. `total` is the number the sync console
/// could not previously state: it asked for a hundred and had no way of
/// knowing whether that was the backlog.
export interface DeadLetterList {
  readonly rows: readonly DeadLetter[]
  readonly next_cursor: string | null
  readonly total: number
  readonly facets: DeadLetterFacets
}

export function listDeadLetters(limit = 100, signal?: AbortSignal) {
  return node.get<DeadLetterList>(`/api/v1/sync/dead-letters?limit=${limit}`, {
    signal,
  })
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

export interface UserFacets {
  readonly roles: readonly SystemFacet[]
  readonly states: readonly SystemFacet[]
  readonly places: readonly SystemFacet[]
}

/// A page of logins, and exactly how many there are. Exact because this
/// answers "who can sign in", and a rough count of that reads as a fact
/// without being one.
export interface UserList {
  readonly rows: readonly UserRow[]
  readonly next_cursor: string | null
  readonly total: number
  readonly facets: UserFacets
}

export function listUsers(signal?: AbortSignal) {
  return node.get<UserList>("/api/v1/auth/users", { signal })
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

export interface EdgeAssignmentFacets {
  readonly origins: readonly SystemFacet[]
  readonly roles: readonly SystemFacet[]
  readonly states: readonly SystemFacet[]
}

/// A page of grants, and exactly how many there are.
export interface EdgeAssignmentList {
  readonly rows: readonly EdgeAssignment[]
  readonly next_cursor: string | null
  readonly total: number
  readonly facets: EdgeAssignmentFacets
}

export function listEdgeAssignments(signal?: AbortSignal) {
  return node.get<EdgeAssignmentList>("/api/v1/auth/edge-assignments", {
    signal,
  })
}

/// Grant somebody access at one node, or rotate the password they use there.
///
/// Deliberately does NOT restore a suspended assignment: rotating a password and
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

export interface RfidDeviceFacets {
  readonly origins: readonly SystemFacet[]
  readonly states: readonly SystemFacet[]
}

/// A page of readers, and exactly how many there are.
export interface RfidDeviceList {
  readonly rows: readonly RfidDevice[]
  readonly next_cursor: string | null
  readonly total: number
  readonly facets: RfidDeviceFacets
}

export function listRfidDevices(signal?: AbortSignal) {
  return node.get<RfidDeviceList>("/api/v1/auth/rfid-devices", { signal })
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

// ---- Health ---------------------------------------------------------------

/// Both lanes of the sync, every node, and the security posture, in one read.
///
/// One endpoint rather than six stitched together in the browser: the verdict
/// is computed on the server, where its thresholds are policy and its rule has
/// tests. The response is typed from the Rust struct the server serialises —
/// the one answer in this module that is not transcribed by hand.
export function syncHealth(signal?: AbortSignal) {
  return node.get<SyncFleetHealth>("/api/v1/sync/health", { signal })
}
