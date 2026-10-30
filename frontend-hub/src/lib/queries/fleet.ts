import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { node } from "@/lib/api"

/// The fleet status page — System › Store servers › Health, Sync and
/// Incidents, and the compact strips on a store's own page.
///
/// Owner's decisions of 28 Sep 2026 (`CONTEXT.md`), backend on
/// `backend/src/cloud/postgres/fleet_status.rs` and `http/fleet.rs`. Typed by
/// hand rather than through `@itulah/contract`: the read side answers
/// `serde_json::Value` (`FleetRowView.sync`, `fleet_status_of`, `fleet_sync`,
/// the incident rows) rather than a `ts_rs`-derived struct, because each
/// shape is assembled from parts that do not all carry one Rust type — so
/// there is nothing for `ts-rs` to export. Only the settings round-trip
/// (`FleetSettings`) is a plain struct, and even that stays here beside its
/// reads rather than split across two files. Field names and shapes are
/// transcribed from the structs' own doc comments; a mismatch is this file's
/// bug; see `postgres/fleet_status.rs` before changing either side.

// ---- Colours and states ---------------------------------------------------

export type FleetState = "OK" | "WARN" | "BAD" | "UNKNOWN"
export type FleetColour = "green" | "yellow" | "red" | "grey"

export const FLEET_DOT: Readonly<Record<FleetColour, string>> = {
  green: "bg-ok",
  yellow: "bg-warn",
  red: "bg-bad",
  grey: "bg-mute",
}

// ---- Parts: one component's state, judged now, plus its history -----------

/// `DEVICE`'s own kind — `FleetPart.device_kind` on the wire.
export type FleetDeviceKind =
  | "TILL"
  | "WAREHOUSE"
  | "PRINTER"
  | "HANDHELD"
  | "RFID_READER"
  | "EDC"
  | "ATTENDANCE_TERMINAL"

export type FleetComponentKind =
  | "SERVER"
  | "SYNC"
  | "DEVICE"
  | "DESK_READER"
  | "BACKUP"
  | "VERSION"
  | "POWER"
  | "DISK"
  | "HO_API"
  | "HO_JOB"

/// One day's bar, oldest-first over ninety days (`FleetDayBar`).
export interface FleetDayBar {
  readonly day: string
  /// `OK`, `WARN`, `BAD`, `UNKNOWN`, or `NONE` for a day with no history at
  /// all — draw it as an empty tick, not grey.
  readonly state: FleetState | "NONE"
  readonly colour: FleetColour | "none"
  readonly uptime_percent: number | null
  readonly bad_seconds: number
  readonly warn_seconds: number
  readonly known_seconds: number
}

/// One component on a row (`FleetComponentView`).
export interface FleetComponent {
  /// Stable within its row: `server`, `sync`, `backup`, `version`, `power`,
  /// `disk`, `device:<id>`, `desk_reader:<till id>`, `server:<origin>`,
  /// `ho.api`, `ho.sync_apply`, `ho.postings`, `ho.notifications`, `ho.brief`.
  readonly component: string
  readonly kind: FleetComponentKind
  readonly device_kind: FleetDeviceKind | string | null
  readonly label: string
  readonly state: FleetState
  readonly colour: FleetColour
  readonly code: string
  readonly sentence: string
  readonly detail: unknown
  /// When this colour began, as the sweep last saw it.
  readonly since: string
  readonly checked_at: string | null
  readonly uptime_90d: number | null
  /// `GET /fleet/status/{unit}` only: ninety bars, oldest first.
  readonly days?: readonly FleetDayBar[]
}

// ---- Sync: freshness and queues, never a percentage ------------------------

export interface FleetQueuedFacts {
  readonly kind: "SALES" | "STOCK" | "ATTENDANCE" | "OTHER" | string
  readonly count: number
  readonly oldest_at: string | null
}

export interface FleetUpstreamQueue {
  readonly waiting: number | null
  readonly by_kind: readonly FleetQueuedFacts[] | null
  readonly oldest_unsent_at: string | null
  readonly oldest_unsent_age_seconds: number | null
  readonly data_up_to: string | null
  readonly last_ack_at: string | null
  readonly acked_seq: number | null
  readonly rejected: number
  readonly as_of: string | null
}

export interface FleetPendingCommandGroup {
  readonly label: string
  readonly command_type: string
  readonly count: number
  readonly oldest_sent_at: string
  readonly age_seconds: number
  readonly expired: number
  readonly revoked: number
}

export interface FleetDownstreamQueue {
  readonly pending: number
  readonly commands: readonly FleetPendingCommandGroup[]
  readonly oldest_sent_at: string | null
  readonly oldest_age_seconds: number | null
  readonly issued_seq: number
  readonly acked_seq: number
  readonly last_ack_at: string | null
  readonly blocked: unknown
}

export type FleetOutageCause = "INTERNET" | "SWITCHED_OFF" | "CRASH" | "STOPPED"

export interface FleetOutage {
  readonly cause: FleetOutageCause
  readonly from: string | null
  readonly to: string | null
  readonly kept_selling: boolean
  readonly facts_written?: number | null
  readonly sales_written?: number | null
  readonly sentence: string
}

/// The brief a `Row` carries inline (`Row.sync`) — enough for the status
/// page's row; `GET /fleet/sync` (`FleetFreshness`, below) has the rest.
export interface FleetSyncBrief {
  readonly state: FleetSyncState
  readonly tone: FleetState
  readonly colour: FleetColour
  readonly sentence: string
  readonly behind_seconds: number | null
  readonly sales_complete_up_to_local: string | null
}

export type FleetSyncState = "SYNCED" | "BEHIND" | "OFFLINE" | "NEVER_SEEN"

/// A store's sync, both directions (`FleetFreshness`) — the Sync tab's own
/// row, and `fleet_status_of`'s `sync`.
export interface FleetFreshness {
  readonly state: FleetSyncState
  readonly tone: FleetState
  readonly colour: FleetColour
  readonly sentence: string
  readonly last_heard_at: string | null
  readonly offline_since: string | null
  readonly behind_seconds: number | null
  readonly up: FleetUpstreamQueue
  readonly down: FleetDownstreamQueue
  readonly sales_complete_up_to: string | null
  readonly sales_complete_up_to_local: string | null
  readonly sales_complete_today: boolean
  readonly last_outage: FleetOutage | null
}

/// One row of `GET /fleet/sync`'s `stores`: `FleetFreshness` plus the row's
/// own naming fields, flattened onto it server-side.
export interface FleetSyncRow extends FleetFreshness {
  readonly key: string
  readonly site_id: string | null
  readonly site_code: string | null
  readonly unit_code: string | null
  readonly name: string
  readonly kind: FleetRowKind
  readonly origin_id: string | null
}

export interface FleetSyncPage {
  readonly generated_at: string
  readonly thresholds: {
    readonly synced_within_seconds: number
    readonly behind_alert_minutes: number
    readonly offline_after_seconds: number
  }
  readonly summary: {
    readonly synced: number
    readonly behind: number
    readonly offline: number
    readonly never_seen: number
  }
  readonly stores: readonly FleetSyncRow[]
}

// ---- Rows: a store, the warehouse, or head office ------------------------------

export type FleetRowKind = "STORE" | "GUDANG" | "HEAD_OFFICE"

/// One row of the status page (`FleetRowView`).
export interface FleetRow {
  readonly key: string
  readonly site_id: string | null
  readonly site_code: string | null
  readonly unit_id: string | null
  readonly unit_code: string | null
  readonly name: string
  readonly kind: FleetRowKind
  readonly origin_id: string | null
  readonly state: FleetState
  readonly colour: FleetColour
  /// The worst part's sentence, prefixed with its label.
  readonly headline: string
  readonly last_heard_at: string | null
  /// The server's (head office: the API's) uptime over ninety days.
  readonly uptime_90d: number | null
  readonly open_incidents: number
  /// `null` for head office, which has no sync of its own.
  readonly sync: FleetSyncBrief | null
  readonly components: readonly FleetComponent[]
}

export interface FleetSummary {
  readonly rows: number
  readonly green: number
  readonly yellow: number
  readonly red: number
  readonly grey: number
  readonly head_office: FleetColour
  readonly open_incidents: number
}

export interface FleetStatusPage {
  readonly generated_at: string
  readonly summary: FleetSummary
  readonly head_office: FleetRow
  readonly stores: readonly FleetRow[]
}

/// `GET /fleet/status/{unit}`: one row, its components with ninety days
/// each, its sync in full (`null` for head office), its server's last
/// outages, and its incidents of the last thirty days.
export interface FleetStatusOf {
  readonly generated_at: string
  readonly row: FleetRow
  readonly sync: FleetFreshness | null
  readonly server_outages: readonly unknown[] | null
  readonly incidents: readonly FleetIncident[]
}

// ---- Incidents --------------------------------------------------------------

export type FleetIncidentState = "OPEN" | "ACKNOWLEDGED" | "RESOLVED"

export interface FleetIncident {
  readonly incident_id: string
  readonly state: FleetIncidentState
  readonly subject: string
  readonly unit_id: string | null
  readonly unit_code: string | null
  readonly site_id: string | null
  readonly origin_id: string | null
  readonly component: string
  readonly component_label: string | null
  readonly rule: string
  readonly code: string
  readonly title: string
  readonly body: string
  readonly opened_at: string
  readonly filed_at: string
  readonly notified_at: string | null
  readonly notified_to: readonly string[]
  readonly acknowledged_at: string | null
  readonly acknowledged_by: string | null
  readonly acknowledged_note: string | null
  readonly escalated_at: string | null
  readonly resolved_at: string | null
  readonly duration_seconds: number
}

export interface FleetIncidentsPage {
  readonly items: readonly FleetIncident[]
  readonly total: number
}

export interface FleetIncidentQuery {
  readonly unit?: string
  readonly component?: string
  readonly from?: string
  readonly state?: "open" | "all"
  readonly limit?: number
}

// ---- Alert settings (Admin) -------------------------------------------------

export interface FleetSettings {
  synced_within_seconds: number
  behind_alert_minutes: number
  offline_after_seconds: number
  alerts_enabled: boolean
  alert_on_red: boolean
  red_after_minutes: number
  alert_on_sync_behind: boolean
  alert_on_printer_fault: boolean
  alert_on_backup: boolean
  backup_max_age_hours: number
  alert_on_reader_silent: boolean
  reader_silent_minutes: number
  escalate_after_minutes: number
  notify_roles: string[]
  notify_unit_pic: boolean
  escalate_to_roles: string[]
  quiet_from: string | null
  quiet_until: string | null
  history_days: number
}

export interface FleetSettingsView extends FleetSettings {
  readonly updated_by: string | null
  readonly updated_at: string | null
}

// ---- Reads and writes --------------------------------------------------------

export const fleetKeys = {
  all: ["fleet"] as const,
  status: () => ["fleet", "status"] as const,
  statusOf: (unit: string) => ["fleet", "status", unit] as const,
  sync: () => ["fleet", "sync"] as const,
  incidents: (query: FleetIncidentQuery) =>
    ["fleet", "incidents", query] as const,
  settings: () => ["fleet", "settings"] as const,
}

export function fleetStatus(signal?: AbortSignal): Promise<FleetStatusPage> {
  return node.get<FleetStatusPage>("/api/v1/fleet/status", { signal })
}

export function fleetStatusOf(
  unit: string,
  signal?: AbortSignal
): Promise<FleetStatusOf> {
  return node.get<FleetStatusOf>(
    `/api/v1/fleet/status/${encodeURIComponent(unit)}`,
    { signal }
  )
}

export function fleetSync(signal?: AbortSignal): Promise<FleetSyncPage> {
  return node.get<FleetSyncPage>("/api/v1/fleet/sync", { signal })
}

function incidentSearch(query: FleetIncidentQuery): string {
  const params = new URLSearchParams()
  if (query.unit) params.set("unit", query.unit)
  if (query.component) params.set("component", query.component)
  if (query.from) params.set("from", query.from)
  if (query.state) params.set("state", query.state)
  if (query.limit) params.set("limit", String(query.limit))
  const text = params.toString()
  return text === "" ? "" : `?${text}`
}

export function fleetIncidents(
  query: FleetIncidentQuery,
  signal?: AbortSignal
): Promise<FleetIncidentsPage> {
  return node.get<FleetIncidentsPage>(
    `/api/v1/fleet/incidents${incidentSearch(query)}`,
    { signal }
  )
}

export function acknowledgeFleetIncident(
  incidentId: string,
  note?: string
): Promise<FleetIncident> {
  return node.post<FleetIncident>(
    `/api/v1/fleet/incidents/${encodeURIComponent(incidentId)}/acknowledge`,
    note ? { note } : {}
  )
}

export function fleetAlertSettings(
  signal?: AbortSignal
): Promise<FleetSettingsView> {
  return node.get<FleetSettingsView>("/api/v1/fleet/alert-settings", { signal })
}

export function updateFleetAlertSettings(
  settings: FleetSettings
): Promise<FleetSettingsView> {
  return node.put<FleetSettingsView>("/api/v1/fleet/alert-settings", settings)
}

// ---- Hooks --------------------------------------------------------------------

/// Polled every thirty seconds while the tab holding it is visible — the
/// mount/unmount of whichever tab is open already stops it otherwise.
const FLEET_POLL_MS = 30_000

export function useFleetStatus() {
  return useQuery({
    queryKey: fleetKeys.status(),
    queryFn: ({ signal }) => fleetStatus(signal),
    refetchInterval: FLEET_POLL_MS,
  })
}

/// One row's ninety-day detail, fetched only once its row is expanded —
/// `enabled` is the caller's to set.
export function useFleetStatusOf(unit: string, enabled: boolean) {
  return useQuery({
    queryKey: fleetKeys.statusOf(unit),
    queryFn: ({ signal }) => fleetStatusOf(unit, signal),
    enabled,
    refetchInterval: enabled ? FLEET_POLL_MS : false,
  })
}

export function useFleetSync() {
  return useQuery({
    queryKey: fleetKeys.sync(),
    queryFn: ({ signal }) => fleetSync(signal),
    refetchInterval: FLEET_POLL_MS,
  })
}

export function useFleetIncidents(query: FleetIncidentQuery) {
  return useQuery({
    queryKey: fleetKeys.incidents(query),
    queryFn: ({ signal }) => fleetIncidents(query, signal),
    refetchInterval: FLEET_POLL_MS,
  })
}

export function useAcknowledgeFleetIncident() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ id, note }: { id: string; note?: string }) =>
      acknowledgeFleetIncident(id, note),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: fleetKeys.all })
    },
  })
}

export function useFleetAlertSettings(enabled: boolean) {
  return useQuery({
    queryKey: fleetKeys.settings(),
    queryFn: ({ signal }) => fleetAlertSettings(signal),
    enabled,
  })
}

export function useUpdateFleetAlertSettings() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (settings: FleetSettings) => updateFleetAlertSettings(settings),
    onSuccess: (view) => {
      client.setQueryData(fleetKeys.settings(), view)
    },
  })
}
