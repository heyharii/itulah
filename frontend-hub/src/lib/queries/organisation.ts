import { useQuery } from "@tanstack/react-query"
import type { UnitPic, UnitSite, UnitView } from "@itulah/contract"

import { node } from "@/lib/api"

export type { UnitPic, UnitSite, UnitView }

/// The organisation's units — head office and each store — with the sites
/// each owns and who is in charge.
///
/// Not `lib/queries/units`: that is units of *measure* (PCS, LUSIN), which kept
/// the word before this vocabulary existed. A unit here is what owns books and
/// people; its `id` is internal and never shown — people read `code` (C004)
/// and `name` (Bumiayu). See migrations 0450–0452.

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
export function useUnits() {
  return useQuery({
    queryKey: organisationKeys.units(),
    queryFn: ({ signal }) => listUnits(signal),
    staleTime: 5 * 60_000,
  })
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
      label:
        unit.sites.length === 1
          ? `${unit.code} · ${unit.name}`
          : `${unit.code} · ${unit.name} — ${site.name}`,
    }))
  )
}
