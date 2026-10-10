import { queryOptions, useQuery } from "@tanstack/react-query"
import type { UnitPic, UnitSite, UnitView } from "@itulah/contract"
import { useCallback, useMemo } from "react"

import { node } from "@/lib/api"

export type { UnitPic, UnitSite, UnitView }

/// The organisation's units — head office and each store — with the sites
/// each owns and who is in charge.
///
/// Not `lib/queries/units`: that is units of *measure* (PCS, LUSIN), which kept
/// the word before this vocabulary existed. A unit here is what owns books and
/// people; its `id` is internal and never shown — people read `code` (C004)
/// and `name` (Bumiayu). See migrations 0600–0602.

export const organisationKeys = {
  all: ["organisation"] as const,
  units: () => ["organisation", "units"] as const,
  pic: (unit: string) => ["organisation", "units", unit, "pic"] as const,
}

/// Every unit, head office first, with its PIC in force today.
export function listUnits(signal?: AbortSignal): Promise<UnitView[]> {
  return node.get<UnitView[]>("/api/v1/organisation/units", { signal })
}

/// The units, for a screen that shows or picks one. Small and slow-moving —
/// fourteen rows that change when a store opens.
export const unitsQuery = () =>
  queryOptions({
    queryKey: organisationKeys.units(),
    queryFn: ({ signal }) => listUnits(signal),
    staleTime: 5 * 60_000,
  })

export function useUnits() {
  return useQuery(unitsQuery())
}

/// Everybody who has been in charge of one unit, newest first.
export function unitPicHistory(
  unit: string,
  signal?: AbortSignal
): Promise<UnitPic[]> {
  return node.get<UnitPic[]>(
    `/api/v1/organisation/units/${encodeURIComponent(unit)}/pic`,
    { signal }
  )
}

/// Put somebody in charge of a unit. Head office's (Admin). The server refuses
/// anybody who is not an active employee posted at that unit on `validFrom`,
/// and closes the standing appointment on the same day.
export function appointPic(
  unit: string,
  body: { employeeId: string; validFrom?: string; reason: string }
): Promise<UnitPic[]> {
  return node.post<UnitPic[]>(
    `/api/v1/organisation/units/${encodeURIComponent(unit)}/pic`,
    {
      employee_id: body.employeeId,
      valid_from: body.validFrom ?? null,
      reason: body.reason,
    }
  )
}

/// What a person reads for a unit: the client's code and its name, "C004 ·
/// Bumiayu". The id is ours and appears on no screen.
export function unitLabel(unit: {
  readonly code: string
  readonly name: string
}): string {
  return `${unit.code} · ${unit.name}`
}

/// What a person reads for a site: the unit's label when the unit keeps one
/// site (a store and its shop), and the site's own name after it when the unit
/// keeps several (head office's office and the warehouse).
export function siteLabel(unit: UnitView, site: UnitSite): string {
  return unit.sites.length === 1
    ? unitLabel(unit)
    : `${unitLabel(unit)} — ${site.name}`
}

/// Head office: the unit of kind `HO`, found by its kind and never by an id.
export function headOffice(units: readonly UnitView[]): UnitView | undefined {
  return units.find((unit) => unit.kind === "HO")
}

/// Every site, labelled with the unit that owns it — what a form asks for
/// when the thing it registers is installed somewhere (a punch station).
export interface SiteChoice {
  readonly siteId: string
  readonly unitId: string
  readonly label: string
}

export function siteChoices(units: readonly UnitView[]): SiteChoice[] {
  return units.flatMap((unit) =>
    unit.sites.map((site) => ({
      siteId: site.id,
      unitId: unit.id,
      label: siteLabel(unit, site),
    }))
  )
}

/// Unit ids as people read them, from the one register every screen shares.
///
/// An id the register does not hold reads as "…" while it loads and as the id
/// itself after — the one honest thing to draw for a unit nobody registered,
/// and a sign that something upstream named a unit that does not exist.
export function useUnitLabel(): (unitId: string | null | undefined) => string {
  const units = useUnits()
  const byId = useMemo(
    () => new Map((units.data ?? []).map((unit) => [unit.id, unitLabel(unit)])),
    [units.data]
  )
  const loading = units.isPending
  return useCallback(
    (unitId) =>
      unitId === null || unitId === undefined || unitId === ""
        ? "—"
        : (byId.get(unitId) ?? (loading ? "…" : unitId)),
    [byId, loading]
  )
}

/// Site ids as people read them — `siteLabel` for every site the register
/// knows, with the same fallbacks as `useUnitLabel`.
export function useSiteLabel(): (siteId: string | null | undefined) => string {
  const units = useUnits()
  const byId = useMemo(
    () =>
      new Map(
        (units.data ?? []).flatMap((unit) =>
          unit.sites.map((site) => [site.id, siteLabel(unit, site)] as const)
        )
      ),
    [units.data]
  )
  const loading = units.isPending
  return useCallback(
    (siteId) =>
      siteId === null || siteId === undefined || siteId === ""
        ? "—"
        : (byId.get(siteId) ?? (loading ? "…" : siteId)),
    [byId, loading]
  )
}
