import {
  infiniteQueryOptions,
  queryOptions,
  useQuery,
} from "@tanstack/react-query"

import { node } from "@/lib/api"
import type {
  ApproveGaRepairRequest,
  ArchiveGaContractRequest,
  DecideGaDisposalRequest,
  GaAssetHub,
  GaAssetPage,
  GaAssetRow,
  GaBuildSchema,
  GaContractHub,
  GaContractPage,
  GaContractRow,
  GaContractType,
  GaDisposalPage,
  GaDisposalRow,
  GaInspectionPage,
  GaInspectionRow,
  GaLocationHub,
  GaLocationRow,
  GaMaintenanceTaskPage,
  GaMaintenanceTaskRow,
  GaMeterReading,
  GaOverview,
  GaRepairObject,
  GaRepairPage,
  GaRepairRow,
  GaReplacementPage,
  GaReplacementRow,
  GaSupplyCategory,
  GaSupplyPage,
  GaSupplyRequestRow,
  MoveGaRepairRequest,
  MoveGaReplacementRequest,
  MoveGaSupplyRequestRequest,
  RecordGaContractRequest,
  RecordGaInspectionRequest,
  RecordGaRepairRequest,
  RecordGaReplacementRequest,
  RecordGaSupplyRequestRequest,
  RecordGaTaskRequest,
  RecordMeterReadingRequest,
  RegisterGaAssetRequest,
  RequestGaDisposalRequest,
  TransferGaAssetRequest,
  UpdateGaAssetRequest,
  UpdateGaContractRequest,
  UpdateGaLocationRequest,
  UpdateGaTaskRequest,
  GaBillRequest,
  SupplierBill,
} from "@itulah/contract"

/// GA's own namespace on the wire.
///
/// The first segment is the domain, as it is for every module, so signing out
/// drops the whole department's answers by prefix. `ga` and not `finance`
/// because the two are different people's surfaces — see `http/ga.rs` — and a
/// screen that read its overview out of the books' namespace would be one more
/// place to remember that they are not the same thing.
export const gaKeys = {
  all: ["ga"] as const,

  /// One answer, and one key. The overview is a single question asked once —
  /// "what wants looking at today" — and every section in it comes from the
  /// same server-side thresholds. Splitting it per section would let a screen
  /// draw an expiring contract beside a repair that is two days stale.
  overview: () => ["ga", "overview"] as const,

  /// Every argument that changes the ANSWER is in the key, and nothing else.
  ///
  /// `q` and the five filters narrow the rows the server sends, so two searches
  /// of the register are two different answers; holding them under one key
  /// would serve the first to arrive to the second. `limit` is deliberately
  /// absent: it is a ceiling, not a question.
  assets: (scope: {
    q?: string
    site?: string
    class?: string
    build?: string
    condition?: string
    status?: string
    draft?: boolean
  }) =>
    [
      "ga",
      "assets",
      scope.q ?? null,
      scope.site ?? null,
      scope.class ?? null,
      scope.build ?? null,
      scope.condition ?? null,
      scope.status ?? null,
      scope.draft ?? null,
    ] as const,

  /// One asset, as GA keeps it. Addressed by id, so it cannot collide with the
  /// list: the register's answer for "everything at dc" and this record's
  /// answer are different shapes of the same table.
  asset: (assetId: string) => ["ga", "asset", assetId] as const,

  /// The build schemas. One key, no arguments: the eleven are the client's own
  /// list and do not change while somebody is filling a form in.
  builds: () => ["ga", "asset-builds"] as const,

  /// The contract register. Every argument that changes the ANSWER is in the
  /// key, for the same reason `assets` spells its scope out: a search for
  /// "pln" and the unfiltered register are two different answers, and a shared
  /// key would serve the first to arrive to the second. `limit` is absent for
  /// the same reason it is absent there — a ceiling, not a question.
  contracts: (scope: {
    q?: string
    type?: string
    group?: string
    site?: string
    standing?: string
    archived?: boolean
  }) =>
    [
      "ga",
      "contracts",
      scope.q ?? null,
      scope.type ?? null,
      scope.group ?? null,
      scope.site ?? null,
      scope.standing ?? null,
      scope.archived ?? null,
    ] as const,

  /// One contract, as GA keeps it: the deal, its bills, its meter readings,
  /// the templates that point at it and its documents. Addressed by id, so it
  /// cannot collide with the list above.
  contract: (contractId: string) => ["ga", "contract", contractId] as const,

  /// The seventeen contract types, with the accounts each one proposes at ONE
  /// site. Keyed by the site because the account map is per site: the codes a
  /// type proposes at the DC are not the codes it proposes at a shop, and a
  /// composer that cached one site's answer would propose them everywhere.
  contractTypes: (site: string | null) =>
    ["ga", "contract-types", site] as const,

  /// The maintenance schedule: recurring tasks for one asset or one location.
  /// `q` narrows the rows the server sends, so it is in the key for the same
  /// reason it is in `contracts`' — two searches are two different answers.
  maintenanceTasks: (scope: { q?: string; site?: string }) =>
    ["ga", "maintenance-tasks", scope.q ?? null, scope.site ?? null] as const,

  /// The inspections, newest history first. `asset` is in the key because the
  /// register's per-asset reading and the schedule's whole book are two
  /// answers over one table.
  inspections: (scope: { asset?: string }) =>
    ["ga", "inspections", scope.asset ?? null] as const,

  /// The repair book. Status and site change which rows come back, so both
  /// ride in the key like every scope above; `limit` stays out, a ceiling
  /// and not a question.
  repairs: (scope: { q?: string; site?: string; status?: string }) =>
    [
      "ga",
      "repairs",
      scope.q ?? null,
      scope.site ?? null,
      scope.status ?? null,
    ] as const,

  /// The replacement book — the happenings on assets, not a kind of asset.
  replacements: (scope: { status?: string }) =>
    ["ga", "replacements", scope.status ?? null] as const,

  /// The disposals. Nothing draws this list in tahap 4 — a disposal is read
  /// from its record sheet and from the asset's own status — but the key is
  /// declared beside its siblings so the Finance half (tahap 6) reads the
  /// same cache the request forms write into.
  disposals: (scope: { status?: string }) =>
    ["ga", "disposals", scope.status ?? null] as const,

  /// One repair, with the names and the actual cost read beside it.
  repair: (repairId: string) => ["ga", "repair", repairId] as const,

  /// One replacement, and the assets at both of its ends.
  replacement: (replacementId: string) =>
    ["ga", "replacement", replacementId] as const,

  /// One disposal request, and what Finance decided about it.
  disposal: (disposalId: string) => ["ga", "disposal", disposalId] as const,

  /// The eleven repair objects, with the account each one's bills propose.
  /// One key, no arguments, like `builds`: the server VALIDATES `objek`
  /// against this table, so a form and a validator cannot disagree.
  repairObjects: () => ["ga", "repair-objects"] as const,

  /// The places the company operates from — the `site` table read as
  /// facilities rather than as an accounting dimension. `q` narrows the rows
  /// the server sends, so it rides in the key like every other search; a list
  /// that left it out would serve one lookup's answer to the next.
  locations: (scope: { q?: string }) =>
    ["ga", "locations", scope.q ?? null] as const,

  /// One place, as GA keeps it: the detail beside the site, and everything
  /// that points back at it — assets, contracts, utilities, repairs, the
  /// schedule and the supplies asked for from here. Addressed by site id under
  /// its own singular segment, exactly as `contract` is, so a search in the
  /// list above cannot collide with one record's answer.
  location: (siteId: string) => ["ga", "location", siteId] as const,

  /// The supply requests. `site` and `status` narrow the rows the server
  /// sends, so both ride in the key like every other scope; `limit` stays
  /// out, a ceiling and not a question.
  supplies: (scope: { site?: string; status?: string }) =>
    ["ga", "supplies", scope.site ?? null, scope.status ?? null] as const,

  /// One supply request, as the request sheet opens it. Its own singular
  /// segment, as `repair` and `contract` have, so it cannot collide with the
  /// list above.
  supply: (requestId: string) => ["ga", "supply", requestId] as const,

  /// The seven GA supply categories, with the account each one proposes. One
  /// key, no arguments, like `builds` and `repairObjects`: the server
  /// VALIDATES `category_code` against this table, so a form that read its
  /// choices from anywhere else could offer a category the validator refuses.
  supplyCategories: () => ["ga", "supply-categories"] as const,
}

function search(
  params: Readonly<Record<string, string | number | boolean | undefined | null>>
): string {
  const parts = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue
    parts.set(key, String(value))
  }
  const text = parts.toString()
  return text === "" ? "" : `?${text}`
}

/// The eleven forms a thing can come in, and the fields each one asks for.
///
/// Fetched rather than written down here, and that is the point: the server
/// VALIDATES `specs` against the same table it draws this from, so a form that
/// asks for a warranty date and a validator that refuses one cannot both be
/// right. A list kept in the browser would drift the first time somebody adds
/// a field, and the symptom would be a form that will not submit.
export function gaAssetBuilds(signal?: AbortSignal): Promise<GaBuildSchema> {
  return node.get<GaBuildSchema>("/api/v1/ga/asset-builds", { signal })
}

/// What wants somebody's attention, as of the business clock's today.
///
/// No arguments: the thresholds are the server's, deliberately. A caller that
/// could pass a window would be a caller that could ask a different question
/// from the one the sidebar badge counts.
export function gaOverview(signal?: AbortSignal): Promise<GaOverview> {
  return node.get<GaOverview>("/api/v1/ga/overview", { signal })
}

/// The register, from GA's side: identity, place, holder and condition.
///
/// Not `/api/v1/finance/assets`: that one answers what a thing is WORTH, and
/// the money columns ride on every row. This one carries no rupiah at all, so a
/// shop manager can be asked to walk the floor with it.
export function gaAssets(
  scope: {
    q?: string
    site?: string
    class?: string
    build?: string
    condition?: string
    status?: string
    draft?: boolean
    limit?: number
    /// The previous page's `next_cursor`, verbatim.
    cursor?: string
  } = {},
  signal?: AbortSignal
): Promise<GaAssetPage> {
  return node.get<GaAssetPage>(`/api/v1/ga/assets${search(scope)}`, { signal })
}

/// One asset and everything GA keeps beside it: its history, and the papers
/// with a date on them.
export function gaAssetHub(
  assetId: string,
  signal?: AbortSignal
): Promise<GaAssetHub> {
  return node.get<GaAssetHub>(
    `/api/v1/ga/assets/${encodeURIComponent(assetId)}`,
    { signal }
  )
}

/// Registering one. Identity, place and build only — no money, because none is
/// known yet and because it is not this screen's business.
export function registerGaAsset(
  request: RegisterGaAssetRequest,
  signal?: AbortSignal
): Promise<GaAssetRow> {
  return node.post<GaAssetRow>("/api/v1/ga/assets", request, { signal })
}

/// Correcting what GA knows. A new fact and not a rewrite: changing the
/// condition or the holder writes a line in the asset's history, which is why
/// this takes a reason-free body and the server decides what to record.
export function updateGaAsset(
  assetId: string,
  request: UpdateGaAssetRequest,
  signal?: AbortSignal
): Promise<GaAssetRow> {
  return node.patch<GaAssetRow>(
    `/api/v1/ga/assets/${encodeURIComponent(assetId)}`,
    request,
    { signal }
  )
}

/// Moving one. The only way a site or a sub-location changes: a thing that
/// moves without a reason and a date is a thing nobody can reconcile, and
/// Finance's next month of depreciation follows the site.
export function transferGaAsset(
  assetId: string,
  request: TransferGaAssetRequest,
  signal?: AbortSignal
): Promise<GaAssetRow> {
  return node.post<GaAssetRow>(
    `/api/v1/ga/assets/${encodeURIComponent(assetId)}/transfer`,
    request,
    { signal }
  )
}

/// The contract register: the deals behind the bills, as GA keeps them.
///
/// Grouped and typed on the server — the six group paths and the two hidden
/// views are readings of this one answer, and a client-side filter would count
/// its summary strip over a page the server had already cut.
export function gaContracts(
  scope: {
    q?: string
    type?: string
    group?: string
    site?: string
    standing?: string
    archived?: boolean
    /// `site` reads the register place first; absent is the house order.
    sort?: "site"
    limit?: number
    /// The previous page's `next_cursor`, verbatim.
    cursor?: string
  } = {},
  signal?: AbortSignal
): Promise<GaContractPage> {
  return node.get<GaContractPage>(`/api/v1/ga/contracts${search(scope)}`, {
    signal,
  })
}

/// One contract and everything beside it: the bills that point at it, its
/// meter readings, the recurring templates raised under it, its documents.
export function gaContractHub(
  contractId: string,
  signal?: AbortSignal
): Promise<GaContractHub> {
  return node.get<GaContractHub>(
    `/api/v1/ga/contracts/${encodeURIComponent(contractId)}`,
    { signal }
  )
}

/// The contract types, with the accounts each one proposes at one site.
///
/// The list is the server's (`contract_type`, seeded by 0360) for the same
/// reason the asset builds are: the server VALIDATES `contract_type` against
/// this table, so a form offering a type the validator refuses cannot both be
/// right. The account codes ride along resolved for `site` — the map is per
/// site, so the proposal is per site — and the composer reads them rather
/// than keeping the prepaid_kind vocabulary in the browser.
export function gaContractTypes(
  site: string | null,
  signal?: AbortSignal
): Promise<readonly GaContractType[]> {
  return node.get<readonly GaContractType[]>(
    `/api/v1/ga/contract-types${search({ site: site ?? undefined })}`,
    { signal }
  )
}

/// Recording one. The paper's own number travels with it if it has one; the
/// accounts are Finance's to decide afterwards, so the request carries none.
export function recordGaContract(
  request: RecordGaContractRequest,
  signal?: AbortSignal
): Promise<GaContractRow> {
  return node.post<GaContractRow>("/api/v1/ga/contracts", request, { signal })
}

/// Correcting what GA knows about the deal — parties, window, notes, the
/// reminder window. Not the money: that is Finance's half.
export function updateGaContract(
  contractId: string,
  request: UpdateGaContractRequest,
  signal?: AbortSignal
): Promise<GaContractRow> {
  return node.patch<GaContractRow>(
    `/api/v1/ga/contracts/${encodeURIComponent(contractId)}`,
    request,
    { signal }
  )
}

/// Archiving one. There is no delete on this register (brief §12): a contract
/// a bill has ever pointed at must stay answerable, and an archived one only
/// leaves the default list.
export function archiveGaContract(
  contractId: string,
  request: ArchiveGaContractRequest,
  signal?: AbortSignal
): Promise<GaContractRow> {
  return node.post<GaContractRow>(
    `/api/v1/ga/contracts/${encodeURIComponent(contractId)}/archive`,
    request,
    { signal }
  )
}

/// The meter readings on one contract, oldest first is the server's call —
/// the usage chart reads them in the order they were measured.
export function gaMeterReadings(
  contractId: string,
  signal?: AbortSignal
): Promise<readonly GaMeterReading[]> {
  return node.get<readonly GaMeterReading[]>(
    `/api/v1/ga/contracts/${encodeURIComponent(contractId)}/meter-readings`,
    { signal }
  )
}

/// Recording one reading. The server upserts on (contract, period): a
/// correction to a month already measured is an ordinary event, and two rows
/// for one month would leave the chart to guess which is true.
export function recordMeterReading(
  contractId: string,
  request: RecordMeterReadingRequest,
  signal?: AbortSignal
): Promise<GaMeterReading> {
  return node.post<GaMeterReading>(
    `/api/v1/ga/contracts/${encodeURIComponent(contractId)}/meter-readings`,
    request,
    { signal }
  )
}

// ── maintenance (tahap 4) ───────────────────────────────────────────────────
//
// The same fence as everything above: GA records the fact and names the KIND
// of object; the rupiah is Finance's bill that points back at the fact. The
// actual cost a repair reports is read out of those bills, never typed here.

/// The recurring schedule — "cuci AC tiap 3 bulan", "uji KIR tiap 6 bulan".
/// The interval and its unit travel separately because the server is the one
/// that rolls the next date forward from them; a free-text "3 bulan" could
/// not be computed with.
export function gaMaintenanceTasks(
  scope: { site?: string; limit?: number; cursor?: string } = {},
  signal?: AbortSignal
): Promise<GaMaintenanceTaskPage> {
  return node.get<GaMaintenanceTaskPage>(
    `/api/v1/ga/maintenance-tasks${search(scope)}`,
    { signal }
  )
}

/// Recording one task. Exactly one of asset / site — a task is for a thing or
/// for a place ("cuci AC 13 toko"), never vaguely for both.
export function recordGaTask(
  request: RecordGaTaskRequest,
  signal?: AbortSignal
): Promise<GaMaintenanceTaskRow> {
  return node.post<GaMaintenanceTaskRow>(
    "/api/v1/ga/maintenance-tasks",
    request,
    { signal }
  )
}

/// Correcting a task in place, or moving its next date after the service was
/// done. Every field the request leaves `null` stays as it is.
export function updateGaMaintenanceTask(
  taskId: string,
  request: UpdateGaTaskRequest,
  signal?: AbortSignal
): Promise<GaMaintenanceTaskRow> {
  return node.patch<GaMaintenanceTaskRow>(
    `/api/v1/ga/maintenance-tasks/${encodeURIComponent(taskId)}`,
    request,
    { signal }
  )
}

/// The inspections, newest first — the history the schedule is checked
/// against, and the paper a repair-from-a-finding points back at.
export function gaInspections(
  scope: { limit?: number; cursor?: string } = {},
  signal?: AbortSignal
): Promise<GaInspectionPage> {
  return node.get<GaInspectionPage>(`/api/v1/ga/inspections${search(scope)}`, {
    signal,
  })
}

/// Recording one. Append-only on the server (brief §12): an inspection is a
/// fact somebody walked the floor for, and a fact that can be quietly edited
/// is not evidence. A wrong one is corrected by a later one.
export function recordGaInspection(
  request: RecordGaInspectionRequest,
  signal?: AbortSignal
): Promise<GaInspectionRow> {
  return node.post<GaInspectionRow>("/api/v1/ga/inspections", request, {
    signal,
  })
}

/// The repair book.
export function gaRepairs(
  scope: { site?: string; limit?: number; cursor?: string } = {},
  signal?: AbortSignal
): Promise<GaRepairPage> {
  return node.get<GaRepairPage>(`/api/v1/ga/repairs${search(scope)}`, {
    signal,
  })
}

/// One repair: the fact, the names beside it, and the actual cost read from
/// the bills that point at it.
export function gaRepair(
  repairId: string,
  signal?: AbortSignal
): Promise<GaRepairRow> {
  return node.get<GaRepairRow>(
    `/api/v1/ga/repairs/${encodeURIComponent(repairId)}`,
    { signal }
  )
}

/// Recording one. Site is required even when there is no asset — "plafon
/// bocor" happened SOMEWHERE, and the site is what makes the cost readable
/// per location. The object rides null when an asset is named: the server
/// derives it from the asset's class, so the form and the validator cannot
/// disagree about what a laptop's repair is billed as.
export function recordGaRepair(
  request: RecordGaRepairRequest,
  signal?: AbortSignal
): Promise<GaRepairRow> {
  return node.post<GaRepairRow>("/api/v1/ga/repairs", request, { signal })
}

/// Moving a repair one step — OPEN → APPROVED → IN_PROGRESS → COMPLETED →
/// CLOSED, with CANCELLED reachable from anywhere but the ends. The server
/// refuses an illegal from→to and names both; the form offers only the legal
/// ones because a card that always 409s is a card nobody trusts.
export function moveGaRepair(
  repairId: string,
  request: MoveGaRepairRequest,
  signal?: AbortSignal
): Promise<GaRepairRow> {
  return node.post<GaRepairRow>(
    `/api/v1/ga/repairs/${encodeURIComponent(repairId)}/move`,
    request,
    { signal }
  )
}

/// Approving the budget — the checker's half of maker ≠ checker (brief §11).
/// The server refuses the repair's own creator here, and so does the button.
export function approveGaRepairBudget(
  repairId: string,
  request: ApproveGaRepairRequest,
  signal?: AbortSignal
): Promise<GaRepairRow> {
  return node.post<GaRepairRow>(
    `/api/v1/ga/repairs/${encodeURIComponent(repairId)}/approve-budget`,
    request,
    { signal }
  )
}

/// The replacement book — a happening on an asset, not a kind of asset.
export function gaReplacements(
  scope: { limit?: number; cursor?: string } = {},
  signal?: AbortSignal
): Promise<GaReplacementPage> {
  return node.get<GaReplacementPage>(
    `/api/v1/ga/replacements${search(scope)}`,
    { signal }
  )
}

/// One replacement, with the names at both of its ends.
export function gaReplacement(
  replacementId: string,
  signal?: AbortSignal
): Promise<GaReplacementRow> {
  return node.get<GaReplacementRow>(
    `/api/v1/ga/replacements/${encodeURIComponent(replacementId)}`,
    { signal }
  )
}

/// Proposing one. No money travels with it: whether the new thing is
/// capitalised or expensed is decided by its class, on the bill Finance
/// records — this form records that a swap was proposed, by whom and why.
export function recordGaReplacement(
  request: RecordGaReplacementRequest,
  signal?: AbortSignal
): Promise<GaReplacementRow> {
  return node.post<GaReplacementRow>("/api/v1/ga/replacements", request, {
    signal,
  })
}

/// Moving one along PROPOSED → APPROVED → PURCHASED → INSTALLED → CLOSED.
/// INSTALLED is the interesting one: the server copies the old asset into a
/// new one (name, class, site, specs) and marks the old one REPLACED, in one
/// transaction — unless the caller names a `new_asset_id` that was already
/// registered, which it then adopts instead.
export function moveGaReplacement(
  replacementId: string,
  request: MoveGaReplacementRequest,
  signal?: AbortSignal
): Promise<GaReplacementRow> {
  return node.post<GaReplacementRow>(
    `/api/v1/ga/replacements/${encodeURIComponent(replacementId)}/move`,
    request,
    { signal }
  )
}

/// The disposal requests. No screen lists them in tahap 4 — Finance's half
/// lands in tahap 6 — but the sheet reads one record, and the request form
/// writes one.
export function gaDisposals(
  scope: { status?: string; limit?: number } = {},
  signal?: AbortSignal
): Promise<GaDisposalPage> {
  return node.get<GaDisposalPage>(`/api/v1/ga/disposals${search(scope)}`, {
    signal,
  })
}

/// One disposal request.
export function gaDisposal(
  disposalId: string,
  signal?: AbortSignal
): Promise<GaDisposalRow> {
  return node.get<GaDisposalRow>(
    `/api/v1/ga/disposals/${encodeURIComponent(disposalId)}`,
    { signal }
  )
}

/// Requesting one. The asset is marked `DISPOSAL_REQUESTED` on the way in —
/// GA's own status, never Finance's — and put back if the request is
/// refused. Nothing here posts a journal: the gain or loss is the other
/// desk's entry, in an account that does not exist yet (brief §4.2).
export function requestGaDisposal(
  request: RequestGaDisposalRequest,
  signal?: AbortSignal
): Promise<GaDisposalRow> {
  return node.post<GaDisposalRow>("/api/v1/ga/disposals", request, { signal })
}

/// Deciding one — approve or refuse. Maker ≠ checker applies (brief §11):
/// whoever proposed the disposal cannot be the one who waves it through.
/// The close, after Finance has posted the books, is that desk's route.
export function decideGaDisposal(
  disposalId: string,
  request: DecideGaDisposalRequest,
  signal?: AbortSignal
): Promise<GaDisposalRow> {
  return node.post<GaDisposalRow>(
    `/api/v1/ga/disposals/${encodeURIComponent(disposalId)}/decide`,
    request,
    { signal }
  )
}

/// The eleven objects a repair can be about, each with the account its bills
/// propose. The server's list, like the build schemas: the request's `objek`
/// is validated against this very table, so a form that read it from anywhere
/// else could offer a choice the validator refuses.
export function gaRepairObjects(
  signal?: AbortSignal
): Promise<readonly GaRepairObject[]> {
  return node.get<readonly GaRepairObject[]>("/api/v1/ga/repair-objects", {
    signal,
  })
}

// ── locations (tahap 5) ─────────────────────────────────────────────────────
//
// The `site` table read as facilities rather than as an accounting dimension.
// The left join to `ga_location_detail` is the server's, and it is the whole
// point: a place that has no detail yet still appears, because this is a list
// of PLACES and not a list of the details that happen to exist.

/// The places the company operates from.
///
/// No page type: the endpoint answers the whole list, and `q` narrows it. The
/// counts on each row (`asset_count`, `contract_count`, `open_repair_count`,
/// `billed_this_month_minor`) are read back through the references that point
/// at the site, not copied from anywhere — brief §2.1's "terkait" pages are
/// queries, not snapshots.
export function gaLocations(
  scope: { q?: string } = {},
  signal?: AbortSignal
): Promise<readonly GaLocationRow[]> {
  return node.get<readonly GaLocationRow[]>(
    `/api/v1/ga/locations${search(scope)}`,
    { signal }
  )
}

/// One choice in a GA form's site dropdown.
export type GaSiteOption = { value: string; label: string }

/// Every place a GA record can name, for the forms' site dropdowns.
///
/// From GA's own list, not Finance's asset facet. That facet sits behind the
/// finance section, which the GA role does not hold, and it only knows the
/// sites that already hold an asset — a new store could not be picked on its
/// first repair.
export function useGaSites(enabled = true): {
  sites: readonly GaSiteOption[]
  isPending: boolean
} {
  const query = useQuery({
    queryKey: gaKeys.locations({}),
    queryFn: ({ signal }) => gaLocations({}, signal),
    enabled,
    staleTime: 5 * 60 * 1000,
  })
  return {
    sites: (query.data ?? []).map((one) => ({
      value: one.site_id,
      label: one.site_name,
    })),
    isPending: query.isPending,
  }
}

/// One place and everything that points back at it: its detail, its assets,
/// its contracts (with the Langganan ones split out as utilities), its repairs,
/// its schedule, the supplies asked for from here.
export function gaLocation(
  siteId: string,
  signal?: AbortSignal
): Promise<GaLocationHub> {
  return node.get<GaLocationHub>(
    `/api/v1/ga/locations/${encodeURIComponent(siteId)}`,
    { signal }
  )
}

/// Correcting the facility facts beside a site — address, kind, floor area,
/// contacts, notes. This does NOT create a site: the register comes first and
/// GA adds the half it was never asked for. A place with no detail row yet is
/// filled in by this same call, because the server upserts on `site_id`.
export function updateGaLocation(
  siteId: string,
  request: UpdateGaLocationRequest,
  signal?: AbortSignal
): Promise<GaLocationRow> {
  return node.patch<GaLocationRow>(
    `/api/v1/ga/locations/${encodeURIComponent(siteId)}`,
    request,
    { signal }
  )
}

// ── supplies (tahap 5) ──────────────────────────────────────────────────────
//
// The same fence that runs through the whole module: GA records the request
// and names the category; the account is the category's proposal and the
// bill is Finance's. Procurement non-dagang does not exist yet, so the PO is
// a typed `po_reference` and nothing more (brief §15 tahap 5).

/// The supply requests, newest first is the server's call. `site` and
/// `status` narrow them.
export function gaSupplies(
  scope: { site?: string; status?: string; limit?: number } = {},
  signal?: AbortSignal
): Promise<readonly GaSupplyRequestRow[]> {
  return node.get<readonly GaSupplyRequestRow[]>(
    `/api/v1/ga/supplies${search(scope)}`,
    { signal }
  )
}

/// The supply register a page at a time, with the total and the stage counts.
///
/// A route of its own rather than a cursor on `/ga/supplies`: that one is the
/// plain array a shop's till and the site hub read, and wrapping it in a page
/// would change their answer under them.
export function gaSupplyBook(
  scope: {
    site?: string
    status?: string
    q?: string
    limit?: number
    cursor?: string
  } = {},
  signal?: AbortSignal
): Promise<GaSupplyPage> {
  return node.get<GaSupplyPage>(`/api/v1/ga/supply-book${search(scope)}`, {
    signal,
  })
}

/// One supply request, wherever in the register it sits — what the request
/// sheet opens, so a link to one past the first page still lands.
export function gaSupply(
  requestId: string,
  signal?: AbortSignal
): Promise<GaSupplyRequestRow> {
  return node.get<GaSupplyRequestRow>(
    `/api/v1/ga/supplies/${encodeURIComponent(requestId)}`,
    { signal }
  )
}

/// The seven categories GA may ask for, each with the account its bills
/// propose. The server's own list: the request's `category_code` is validated
/// against this very table, so the form and the validator cannot disagree —
/// and the two that are somebody else's (Customer Supplies 6004, kantong
/// belanja) are absent from it by design.
export function gaSupplyCategories(
  signal?: AbortSignal
): Promise<readonly GaSupplyCategory[]> {
  return node.get<readonly GaSupplyCategory[]>("/api/v1/ga/supply-categories", {
    signal,
  })
}

/// Asking for something. The requester and the site are facts of the request,
/// not defaults — a request with no place and no name is a request nobody can
/// act on.
export function recordGaSupplyRequest(
  request: RecordGaSupplyRequestRequest,
  signal?: AbortSignal
): Promise<GaSupplyRequestRow> {
  return node.post<GaSupplyRequestRow>("/api/v1/ga/supplies", request, {
    signal,
  })
}

/// Moving one request one step along REQUESTED → APPROVED → ORDERED →
/// RECEIVED → BILLED, with REJECTED the one exit. The server enforces the
/// flow (`supply_may_move`), requires a reason for REJECTED and accepts a
/// `po_reference` only on the way to ORDERED; the form offers only what the
/// server would accept.
export function moveGaSupplyRequest(
  requestId: string,
  request: MoveGaSupplyRequestRequest,
  signal?: AbortSignal
): Promise<GaSupplyRequestRow> {
  return node.post<GaSupplyRequestRow>(
    `/api/v1/ga/supplies/${encodeURIComponent(requestId)}/move`,
    request,
    { signal }
  )
}

// ── bills to Finance ────────────────────────────────────────────────────────

/// Handing Finance the supplier's bill for a GA record: a repair, a supply
/// request, a contract's month. The server files it as a DRAFT in Finance's GA
/// inbox and suggests each line's account; posting stays Finance's act.
export function recordGaBillRequest(
  request: GaBillRequest,
  signal?: AbortSignal
): Promise<SupplierBill> {
  return node.post<SupplierBill>("/api/v1/ga/bill-requests", request, {
    signal,
  })
}

// ── the reads a screen opens with ───────────────────────────────────────────
//
// One options function per read, shared by the screen (which reads it with
// `useSuspenseQuery`) and by its prefetcher (`screens/{ga,maintenance,assets,
// contracts,executive}/prefetch.ts`), so the key and the request cannot drift
// apart and the server's answer is the one the first paint reads.

/// How many rows one page of a GA book asks for. A step, not a ceiling: the
/// rest arrive as the list is scrolled.
export const GA_PAGE = 100

/// What wants a GA decision today.
export const gaOverviewQuery = () =>
  queryOptions({
    queryKey: gaKeys.overview(),
    queryFn: ({ signal }) => gaOverview(signal),
  })

/// The repair book, a page at a time. Its own key under the book's prefix: the
/// replacement form reads the same scope as one plain page, and an infinite
/// answer cannot share its cache entry. `gaKeys.all` still reaches it.
export const gaRepairBookQuery = () =>
  infiniteQueryOptions({
    queryKey: [...gaKeys.repairs({}), "pages"] as const,
    queryFn: ({ pageParam, signal }) =>
      gaRepairs({ limit: GA_PAGE, cursor: pageParam }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  })

/// The recurring maintenance tasks, soonest due first (undated last).
export const gaTaskBookQuery = () =>
  infiniteQueryOptions({
    queryKey: [...gaKeys.maintenanceTasks({}), "pages"] as const,
    queryFn: ({ pageParam, signal }) =>
      gaMaintenanceTasks({ limit: GA_PAGE, cursor: pageParam }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  })

/// The inspections, newest first.
export const gaInspectionBookQuery = () =>
  infiniteQueryOptions({
    queryKey: [...gaKeys.inspections({}), "pages"] as const,
    queryFn: ({ pageParam, signal }) =>
      gaInspections({ limit: GA_PAGE, cursor: pageParam }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  })

/// The replacement book.
export const gaReplacementBookQuery = () =>
  infiniteQueryOptions({
    queryKey: [...gaKeys.replacements({}), "pages"] as const,
    queryFn: ({ pageParam, signal }) =>
      gaReplacements({ limit: GA_PAGE, cursor: pageParam }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  })

/// The asset register for one scope. Its own key under the register's prefix:
/// the pickers read the same scope as one plain page, and an infinite answer
/// and a plain one cannot share a cache entry.
export const gaAssetBookQuery = (scope: Parameters<typeof gaKeys.assets>[0]) =>
  infiniteQueryOptions({
    queryKey: [...gaKeys.assets(scope), "pages"] as const,
    queryFn: ({ pageParam, signal }) =>
      gaAssets({ ...scope, limit: GA_PAGE, cursor: pageParam }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  })

/// The contract register for one scope. Subscriptions are read by PLACE ("what
/// is connected there"), and a register order would scatter one site's
/// connections across the table, so they sort by site on the server and carry
/// their own key.
export const gaContractBookQuery = (
  scope: Parameters<typeof gaKeys.contracts>[0],
  kind: "register" | "utilities" = "register"
) =>
  infiniteQueryOptions({
    queryKey: [
      ...gaKeys.contracts(scope),
      "pages",
      kind === "utilities" ? "site" : "register",
    ] as const,
    queryFn: ({ pageParam, signal }) =>
      gaContracts(
        {
          ...scope,
          sort: kind === "utilities" ? "site" : undefined,
          limit: GA_PAGE,
          cursor: pageParam,
        },
        signal
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  })

/// Every place GA keeps, whole.
export const gaLocationsQuery = () =>
  queryOptions({
    queryKey: gaKeys.locations({}),
    queryFn: ({ signal }) => gaLocations({}, signal),
    retry: false,
  })

/// The running agreements the Executive's Team & Assets page counts down:
/// not archived, up to a thousand, under their own key beside the register's.
export const gaExecutiveContractsQuery = () =>
  queryOptions({
    queryKey: [...gaKeys.contracts({ archived: false }), "executive"] as const,
    queryFn: ({ signal }) =>
      gaContracts({ archived: false, limit: 1000 }, signal),
    retry: false,
  })
