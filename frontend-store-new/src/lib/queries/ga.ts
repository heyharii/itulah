import { queryOptions, useQuery } from "@tanstack/react-query"

import { CENTRAL_KEY_PREFIX, cloud } from "@/lib/cloud"
import { ApiError } from "@itulah/contract/client"
import type {
  GaAssetEvent,
  GaAssetHub,
  GaAssetPage,
  GaContractHub,
  GaContractRow,
  GaContractType,
  GaLocationHub,
  GaMaintenanceTaskPage,
  GaMaintenanceTaskRow,
  GaRepairObject,
  GaRepairPage,
  GaRepairRow,
  GaSupplyCategory,
  GaSupplyRequestRow,
  NoteGaAssetRequest,
  RecordGaRepairRequest,
  RecordGaSupplyRequestRequest,
} from "@itulah/contract"

/// Everything the GA screens ask head office, and the key each answer is
/// cached under.
///
/// # One shop, always, and never a picker
///
/// Every list below takes `site` and it is always this node's own `site_id`.
/// The calls are exactly the ones the edge→cloud relay allowlists, and the
/// relay forces the site to the node's own; passing it from here is how the
/// screen says which shop it means, and the relay's rewrite is what makes it
/// true. Nothing in this file asks for vendors, letters, disposals,
/// replacement decisions, approvals, transfers, bill requests or `/overview`
/// — those are head office's desk, and a till that asked would be refused.
///
/// # Three places the wire is narrower than it looks
///
///  - `/ga/repairs` and `/ga/maintenance-tasks` take only `limit` on today's
///    cloud: `refuse_unknown_parameters` answers a `site` with a 400. They are
///    asked WITH the site anyway, and on that exact refusal the rows are taken
///    from `/ga/locations/{site}`, which reads the same two lists and narrows
///    them to the place on the server. When the lists learn `site`, the
///    fallback simply stops being reached.
///  - `/ga/contracts?site=` matches `site_id = ANY(…)`, so a contract that
///    covers ALL_STORES or ALL_SITES — the company's property insurance, the
///    cleaning crew that walks every shop — is not in its answer. The location
///    hub adds those (`contracts_touching`), which is why the Contracts screen
///    reads the hub rather than the register.
///  - `/ga/assets`' facets are counted over the SEARCH and ignore every
///    filter, the site included — they describe the whole estate. Nothing here
///    reads them; the class counts a shop sees are counted from its own rows.

export const gaKeys = {
  /// The prefix. Under `central` so signing out of head office — or out of
  /// the till — drops GA's answers with everything else the centre said.
  all: () => [CENTRAL_KEY_PREFIX, "ga"] as const,
  /// The place and everything that points at it — the overview's one answer.
  place: (site: string) => [CENTRAL_KEY_PREFIX, "ga", "place", site] as const,
  assets: (site: string) => [CENTRAL_KEY_PREFIX, "ga", "assets", site] as const,
  asset: (assetId: string) =>
    [CENTRAL_KEY_PREFIX, "ga", "asset", assetId] as const,
  contract: (contractId: string) =>
    [CENTRAL_KEY_PREFIX, "ga", "contract", contractId] as const,
  /// Keyed by the site because the server resolves each type's accounts per
  /// site. This screen reads only the names, but the key follows the answer.
  contractTypes: (site: string) =>
    [CENTRAL_KEY_PREFIX, "ga", "contract-types", site] as const,
  repairs: (site: string) =>
    [CENTRAL_KEY_PREFIX, "ga", "repairs", site] as const,
  repairObjects: () => [CENTRAL_KEY_PREFIX, "ga", "repair-objects"] as const,
  tasks: (site: string) => [CENTRAL_KEY_PREFIX, "ga", "tasks", site] as const,
  supplies: (site: string) =>
    [CENTRAL_KEY_PREFIX, "ga", "supplies", site] as const,
  supplyCategories: () =>
    [CENTRAL_KEY_PREFIX, "ga", "supply-categories"] as const,
}

/// The eight builds that are things a shop can walk up to. Software, deferred
/// pre-opening cost and work in progress are the register's too, but they are
/// COSTS rather than objects — there is nothing on the floor to check them
/// against, so a shop's register leaves them to Finance.
export const PHYSICAL_BUILDS = [
  "LAND",
  "BUILDING",
  "TECH",
  "VEHICLE",
  "FFE",
  "IT",
  "AUDIO",
  "OE",
] as const

/// The statuses of a thing that is still standing in the shop. `DRAFT` stays
/// — a bill minted it and nobody has walked the floor for it, which is exactly
/// what a shop can confirm — and so does `DISPOSAL_REQUESTED`, which is still
/// there until the request is decided. `IN_PROGRESS` (work in progress),
/// `DISPOSED` and `REPLACED` have left the floor.
export const FLOOR_STATUSES = [
  "DRAFT",
  "REGISTERED",
  "IN_SERVICE",
  "DISPOSAL_REQUESTED",
] as const

function query(params: Readonly<Record<string, string>>): string {
  return new URLSearchParams(params).toString()
}

/// Whether the centre refused the `site` parameter itself — the one 400 this
/// module answers by asking the location hub instead. Anything else, including
/// every other 400, is a real refusal and is shown as one.
function refusedSite(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.status === 400 &&
    error.message.includes('"site"')
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// The place

/// `GET /api/v1/ga/locations/{site}` — the place's own record (address, area,
/// contact), and the assets, contracts (its own and the ones that cover it),
/// utilities, repairs, schedule and supplies that point back at it, each
/// narrowed to the place on the server.
export function placeQuery(site: string) {
  return queryOptions({
    queryKey: gaKeys.place(site),
    queryFn: ({ signal }) =>
      cloud.get<GaLocationHub>(
        `/api/v1/ga/locations/${encodeURIComponent(site)}`,
        { signal },
      ),
    staleTime: 60_000,
  })
}

export function useGaPlace(site: string) {
  return useQuery(placeQuery(site))
}

// ─────────────────────────────────────────────────────────────────────────────
// Assets

/// `GET /api/v1/ga/assets?site=…&build=…&status=…` — the shop's physical
/// register, whole. One page of up to a thousand rather than a search per
/// keystroke: a shop holds tens of things, not thousands, and filtering the
/// rows it already has is what lets the class counts be this shop's own.
export function assetsQuery(site: string) {
  return queryOptions({
    queryKey: gaKeys.assets(site),
    queryFn: ({ signal }) =>
      cloud.get<GaAssetPage>(
        `/api/v1/ga/assets?${query({
          site,
          build: PHYSICAL_BUILDS.join(","),
          status: FLOOR_STATUSES.join(","),
          limit: "1000",
        })}`,
        { signal },
      ),
  })
}

export function useGaAssets(site: string) {
  return useQuery({
    ...assetsQuery(site),
    // The server narrowed by site; this keeps a row from anywhere else off a
    // shop's screen even if a relay in between ever answered wider.
    select: (page): GaAssetPage => ({
      ...page,
      rows: page.rows.filter((row) => row.site_id === site),
    }),
  })
}

/// `GET /api/v1/ga/assets/{id}` — one thing, its history and its papers.
export function useGaAsset(assetId: string | null) {
  return useQuery({
    queryKey: gaKeys.asset(assetId ?? ""),
    queryFn: ({ signal }) =>
      cloud.get<GaAssetHub>(
        `/api/v1/ga/assets/${encodeURIComponent(assetId ?? "")}`,
        { signal },
      ),
    enabled: assetId !== null,
    staleTime: 60_000,
  })
}

/// `POST /api/v1/ga/assets/{id}/notes` — a line on the thing's history that
/// changes nothing else. The date is the server's business day.
export function noteGaAsset(
  assetId: string,
  request: NoteGaAssetRequest,
): Promise<GaAssetEvent> {
  return cloud.post<GaAssetEvent>(
    `/api/v1/ga/assets/${encodeURIComponent(assetId)}/notes`,
    request,
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Contracts

/// `GET /api/v1/ga/contract-types?site=…` — the seventeen types, in the
/// client's order, with the group each sits on.
export function contractTypesQuery(site: string) {
  return queryOptions({
    queryKey: gaKeys.contractTypes(site),
    queryFn: ({ signal }) =>
      cloud.get<GaContractType[]>(
        `/api/v1/ga/contract-types?${query({ site })}`,
        { signal },
      ),
    staleTime: 10 * 60_000,
  })
}

export function useGaContractTypes(site: string) {
  return useQuery(contractTypesQuery(site))
}

/// `GET /api/v1/ga/contracts/{id}` — one contract, its papers and its meter
/// history. Its bills ride along and are not drawn: what was paid is
/// Finance's, and a shop reads the deal, not the ledger.
export function useGaContract(contractId: string | null) {
  return useQuery({
    queryKey: gaKeys.contract(contractId ?? ""),
    queryFn: ({ signal }) =>
      cloud.get<GaContractHub>(
        `/api/v1/ga/contracts/${encodeURIComponent(contractId ?? "")}`,
        { signal },
      ),
    enabled: contractId !== null,
    staleTime: 60_000,
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Repairs

/// `GET /api/v1/ga/repairs?site=…`, newest failure first — or the location
/// hub's repairs when the centre refuses the site parameter (see the head of
/// this file).
export function repairsQuery(site: string) {
  return queryOptions({
    queryKey: gaKeys.repairs(site),
    queryFn: async ({ signal, client }): Promise<GaRepairRow[]> => {
      try {
        const page = await cloud.get<GaRepairPage>(
          `/api/v1/ga/repairs?${query({ site, limit: "500" })}`,
          { signal },
        )
        return page.rows.filter((row) => row.site_id === site)
      } catch (error) {
        if (!refusedSite(error)) throw error
        return (await client.fetchQuery(placeQuery(site))).repairs
      }
    },
    staleTime: 60_000,
  })
}

export function useGaRepairs(site: string) {
  return useQuery(repairsQuery(site))
}

/// `GET /api/v1/ga/repair-objects` — the eleven objects a repair can be
/// charged to. The server validates `objek` against this very list.
export function useGaRepairObjects(enabled = true) {
  return useQuery({
    queryKey: gaKeys.repairObjects(),
    queryFn: ({ signal }) =>
      cloud.get<GaRepairObject[]>("/api/v1/ga/repair-objects", { signal }),
    enabled,
    staleTime: 10 * 60_000,
  })
}

/// `POST /api/v1/ga/repairs` — a breakdown, filed by the shop it happened in.
export function recordGaRepair(
  request: RecordGaRepairRequest,
): Promise<GaRepairRow> {
  return cloud.post<GaRepairRow>("/api/v1/ga/repairs", request)
}

// ─────────────────────────────────────────────────────────────────────────────
// Servicing

/// `GET /api/v1/ga/maintenance-tasks?site=…` — the standing services, with the
/// same fallback as the repairs. The hub's answer carries only the tasks that
/// name the PLACE; a task on one of the shop's machines (a vehicle's KIR) is
/// only in the list's own answer, once the list takes a site.
export function tasksQuery(site: string) {
  return queryOptions({
    queryKey: gaKeys.tasks(site),
    queryFn: async ({ signal, client }): Promise<GaMaintenanceTaskRow[]> => {
      try {
        const page = await cloud.get<GaMaintenanceTaskPage>(
          `/api/v1/ga/maintenance-tasks?${query({ site, limit: "500" })}`,
          { signal },
        )
        // A task names a place or a thing, never both. One that names another
        // place is dropped; one that names a thing is the server's word that
        // the thing is here, because it answered a question about this site.
        return page.rows.filter(
          (row) => row.site_id === null || row.site_id === site,
        )
      } catch (error) {
        if (!refusedSite(error)) throw error
        return (await client.fetchQuery(placeQuery(site))).tasks
      }
    },
    staleTime: 60_000,
  })
}

export function useGaTasks(site: string) {
  return useQuery(tasksQuery(site))
}

// ─────────────────────────────────────────────────────────────────────────────
// Supplies

/// `GET /api/v1/ga/supply-categories` — the seven things GA may be asked for.
export function useGaSupplyCategories(enabled = true) {
  return useQuery({
    queryKey: gaKeys.supplyCategories(),
    queryFn: ({ signal }) =>
      cloud.get<GaSupplyCategory[]>("/api/v1/ga/supply-categories", {
        signal,
      }),
    enabled,
    staleTime: 10 * 60_000,
  })
}

/// `GET /api/v1/ga/supplies?site=…` — what this shop has asked for, newest
/// first. This list does take a site, so there is no fallback.
export function suppliesQuery(site: string) {
  return queryOptions({
    queryKey: gaKeys.supplies(site),
    queryFn: ({ signal }) =>
      cloud.get<GaSupplyRequestRow[]>(
        `/api/v1/ga/supplies?${query({ site, limit: "500" })}`,
        { signal },
      ),
    staleTime: 60_000,
  })
}

export function useGaSupplies(site: string) {
  return useQuery({
    ...suppliesQuery(site),
    select: (rows) => rows.filter((row) => row.site_id === site),
  })
}

/// `POST /api/v1/ga/supplies` — an ask. It starts REQUESTED; everything after
/// that is head office's.
export function recordGaSupply(
  request: RecordGaSupplyRequestRequest,
): Promise<GaSupplyRequestRow> {
  return cloud.post<GaSupplyRequestRow>("/api/v1/ga/supplies", request)
}

/// The vendors this shop can name on a repair without being shown the
/// company's whole vendor book: the parties on its own contracts and the ones
/// that have fixed something here before.
///
/// `supplier_id` is REQUIRED on a repair (`ga_repair.supplier_id NOT NULL`),
/// and the vendor register is head office's and not on the relay's allowlist.
/// So the choice is drawn from what this shop already has on record, and GA
/// can re-assign it on the repair afterwards.
export interface KnownVendor {
  readonly supplier_id: string
  readonly name: string
  /// Why this shop knows them — "Maintenance contract", "Fixed something
  /// here before" — said beside the name so the choice is not a bare list.
  readonly why: string
}

/// A contract that is still running (or about to), which is the only kind a
/// new repair can be filed under.
function live(contract: GaContractRow): boolean {
  return contract.standing !== "DIHENTIKAN" && contract.standing !== "HABIS"
}

export function knownVendors(
  place: GaLocationHub | undefined,
  repairs: readonly GaRepairRow[] | undefined,
): KnownVendor[] {
  const found = new Map<string, KnownVendor>()
  for (const contract of place?.contracts ?? []) {
    if (contract.supplier_id === null || contract.supplier_name === null)
      continue
    // The landlord and the service contractors fix things; the electricity
    // company and the insurer do not, so their contracts offer no vendor.
    if (contract.group_code !== "SEWA" && contract.group_code !== "JASA")
      continue
    if (!live(contract) || found.has(contract.supplier_id)) continue
    found.set(contract.supplier_id, {
      supplier_id: contract.supplier_id,
      name: contract.supplier_name,
      why: contract.contract_type_name,
    })
  }
  for (const repair of repairs ?? []) {
    if (found.has(repair.supplier_id)) continue
    found.set(repair.supplier_id, {
      supplier_id: repair.supplier_id,
      name: repair.supplier_name,
      why: "Repaired something here before",
    })
  }
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/// The maintenance contract at this shop that covers what broke: one that
/// names the asset itself, or else one for the object's kind (`AC`, `LIFT`).
/// Its vendor is who a repair should go to, and its id rides on the repair so
/// the bill that follows is read against the contract, not as a surprise.
export function coveringContract(
  place: GaLocationHub | undefined,
  assetId: string | null,
  objek: string | null,
): GaContractRow | undefined {
  const maintenance = (place?.contracts ?? []).filter(
    (one) =>
      one.contract_type === "JASA_MAINTENANCE" &&
      one.supplier_id !== null &&
      live(one),
  )
  return (
    (assetId === null
      ? undefined
      : maintenance.find((one) => one.asset_id === assetId)) ??
    (objek === null
      ? undefined
      : maintenance.find((one) => one.objek === objek && one.asset_id === null))
  )
}

/// Who fixed this thing — or this kind of thing — last time here. The list is
/// newest failure first, so the first match is the latest.
export function lastVendorFor(
  repairs: readonly GaRepairRow[] | undefined,
  assetId: string | null,
  objek: string | null,
): string | undefined {
  const rows = repairs ?? []
  return (
    (assetId === null
      ? undefined
      : rows.find((one) => one.asset_id === assetId)?.supplier_id) ??
    (objek === null
      ? undefined
      : rows.find((one) => one.objek === objek)?.supplier_id)
  )
}
