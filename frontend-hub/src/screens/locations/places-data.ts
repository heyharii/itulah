import { queryOptions } from "@tanstack/react-query"
import { Building2, Globe, MapPin, Store, type LucideIcon } from "lucide-react"
import { useMemo } from "react"

import { gaKeys, gaLocation, gaLocations } from "@/lib/queries/ga"
import { useUnits } from "@/lib/queries/organisation"
import type { GaLocationRow } from "@itulah/contract"

/// Every place GA keeps, narrowed by what was searched: the one read the
/// Sites list is made of. Shared with the prefetcher (`prefetch.ts`) so the
/// server's answer is the screen's own.
export const placesQuery = (scope: { readonly q?: string }) =>
  queryOptions({
    queryKey: gaKeys.locations(scope),
    queryFn: ({ signal }) => gaLocations(scope, signal),
  })

/// One place and everything that points at it: the sheet's read. Shared with
/// the list, which starts it when a row is rested on.
export const placeQuery = (siteId: string) =>
  queryOptions({
    queryKey: gaKeys.location(siteId),
    queryFn: ({ signal }) => gaLocation(siteId, signal),
  })

/// What kind of place it is, in the words a person says. The register's own
/// kind is `HO` or `STORE`; GA's free-text "Toko ruko" is the building, and
/// has a fact of its own.
export function kindWords(kind: string): string {
  switch (kind) {
    case "HO":
      return "Head office"
    case "STORE":
      return "Store"
    case "ONLINE":
      return "Online"
    default:
      return (
        kind.charAt(0).toUpperCase() +
        kind.slice(1).toLowerCase().replaceAll("_", " ")
      )
  }
}

/// The mark that tells one kind from another at a glance.
export function kindIcon(kind: string): LucideIcon {
  switch (kind) {
    case "HO":
      return Building2
    case "STORE":
      return Store
    case "ONLINE":
      return Globe
    default:
      return MapPin
  }
}

/// Head office first, then the stores, then anything else by name.
const KIND_ORDER = ["HO", "STORE"]

export function compareKinds(a: string, b: string): number {
  const at = KIND_ORDER.indexOf(a)
  const bt = KIND_ORDER.indexOf(b)
  if (at !== -1 || bt !== -1)
    return (at === -1 ? 99 : at) - (bt === -1 ? 99 : bt)
  return a.localeCompare(b)
}

const empty = (value: string | null) => value === null || value.trim() === ""

/// A site nobody has told GA about: no address, no building, nobody to ring.
/// The list does not hide it — it is the list that answers "what have we not
/// filled in yet".
export function detailsMissing(row: GaLocationRow): boolean {
  return (
    empty(row.address) &&
    empty(row.kind) &&
    empty(row.contact_name) &&
    empty(row.contact_phone)
  )
}

/// A place as people read it.
export interface Place {
  /// The unit's name ("Cikupa"), and the site's own after it when the unit
  /// keeps several. The site's name ("Store 01") when the units are not read.
  readonly name: string
  /// The client's code for the unit ("C001"); none until the units are read.
  /// The site's own code (`C001-TOKO`) is not on the wire.
  readonly code: string | null
  /// The unit's name alone.
  readonly unit: string | null
}

/// Each site's place, from the register every screen shares. The units are
/// read beside the list and never hold it up: until they arrive, or for a
/// reader who may not see them, a place reads as the site's own name.
export function usePlaces(): (
  row: Pick<GaLocationRow, "site_id" | "site_name">
) => Place {
  const units = useUnits()
  return useMemo(() => {
    const byId = new Map<string, Place>()
    for (const unit of units.data ?? []) {
      for (const site of unit.sites) {
        byId.set(site.id, {
          name:
            unit.sites.length > 1 ? `${unit.name} — ${site.name}` : unit.name,
          code: unit.code,
          unit: unit.name,
        })
      }
    }
    return (row) =>
      byId.get(row.site_id) ?? { name: row.site_name, code: null, unit: null }
  }, [units.data])
}
