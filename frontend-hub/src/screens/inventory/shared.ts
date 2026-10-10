import { useNavigate } from "@tanstack/react-router"

import { EMPTY, percent as sharePercent } from "@/lib/format"
import { allNavItems } from "@/lib/navigation"
import { useIdentity } from "@/lib/session"
import type { FleetPool } from "@/lib/queries/inventory"

/// The small facts every inventory screen needs and no shared module owns.
///
/// Nothing here is a component, so it lives in a `.ts` beside the screens
/// rather than in `components/ui`: these are this module's readings of its own
/// data, not new primitives for the app.

/// Who the ledger will record as having done this.
///
/// Every inventory write names an actor and the server has no default — so an
/// empty string here is not a placeholder to send, it is the reason a write
/// button is disabled. `username` rather than a display name: the ledger holds
/// the identity, not the greeting.
export function useActor(): string {
  const identity = useIdentity()
  return identity.data?.username ?? ""
}

/// `<AppLink>`, for the places a link cannot go.
///
/// `<ExceptionQueue>` takes an `onOpen` callback rather than a destination, so
/// the queue on the overview needs to navigate in code. This does what
/// `<AppLink>` does and for the same reason: Router cannot type a generated
/// route tree, so the path is checked against the navigation registry instead —
/// in development a path nothing declares throws where it is written rather
/// than 404ing when somebody clicks it.
export function useGo() {
  const navigate = useNavigate()
  return (to: string) => {
    if (import.meta.env.DEV && !allNavItems.some((item) => item.path === to)) {
      throw new Error(
        `useGo("${to}") — no nav entry declares that path. Add it to the module's nav.ts, or fix the typo.`
      )
    }
    navigate({ to: to as never })
  }
}

/// Pools goods can actually sit in.
///
/// A rollup is a sum of other pools, not a place: nothing can be counted in
/// one, allotted out of one, or corrected into one, so it never belongs in a
/// picker even though it belongs in a list.
export function placements(pools: readonly FleetPool[]): FleetPool[] {
  return pools.filter((pool) => !pool.is_rollup)
}

/// The pools this node may still write to.
///
/// A pool whose site is owned by a live Edge node is shadowed: Cloud can read
/// the number but must not post against it, and the fleet read says so per row
/// rather than leaving it to be inferred from the site id.
export function writablePools(pools: readonly FleetPool[]): FleetPool[] {
  return placements(pools).filter((pool) => pool.authority.cloud_writable)
}

export interface Site {
  readonly site_id: string
  readonly site_name: string
}

/// The sites that hold stock, derived from the pools rather than asked for
/// separately: every site with a pool appears here, and its name comes from
/// the read the picker already needed.
export function sitesOf(pools: readonly FleetPool[], kind?: string): Site[] {
  const seen = new Map<string, Site>()
  for (const pool of pools) {
    if (kind !== undefined && pool.site_kind !== kind) continue
    if (seen.has(pool.site_id)) continue
    seen.set(pool.site_id, {
      site_id: pool.site_id,
      site_name: pool.site_name ?? pool.site_id,
    })
  }
  return [...seen.values()].sort((left, right) =>
    left.site_id.localeCompare(right.site_id)
  )
}

/// Every Edge stream Cloud has ingested from, with the generation it is on.
///
/// The sync debugger needs an origin and a generation and there is no endpoint
/// that lists them for this module — but the fleet read already carries both
/// on every Edge-derived row, so the picker is a fold over what is on screen.
export function edgeOrigins(
  pools: readonly FleetPool[]
): { origin_id: string; generation: number; label: string }[] {
  const seen = new Map<
    string,
    { origin_id: string; generation: number; label: string }
  >()
  for (const pool of pools) {
    if (pool.source_type !== "EDGE_FACT_POSITION") continue
    if (pool.fact_generation === null) continue
    if (seen.has(pool.origin_id)) continue
    seen.set(pool.origin_id, {
      origin_id: pool.origin_id,
      generation: pool.fact_generation,
      label: pool.owner_label ?? pool.origin_id,
    })
  }
  return [...seen.values()].sort((left, right) =>
    left.origin_id.localeCompare(right.origin_id)
  )
}

// ---------------------------------------------------------------------------
// What the server will accept, said here so nobody is offered a choice it is
// certain to refuse.
//
// Transcribed from `validate_create_line` in
// `backend/src/cloud/postgres/allotments.rs`. The server remains the one that
// decides — when this disagrees with it, its refusal is what the screen shows.

/// The DC pools goods may be fulfilled out of. **Not** the outbound leaves
/// (`PICKED`, `PACKED`, `SHIPMENT`, `LOADED`, `IN_TRANSIT`): goods already
/// picked for one store are spoken for and cannot be promised to another.
const DC_FULFILLMENT_POOL_CODES = new Set([
  "UNIDENTIFIED",
  "UNTAGGED",
  "WAREHOUSE",
  "PICKING",
  "DC_REJECT",
  "STORE_REJECT",
])

/// A store's own three pools, which are what it can send back to the DC.
const STORE_RETURN_POOL_CODES = new Set(["WAREHOUSE", "FLOOR", "REJECT"])

/// `site.kind` for the warehouse. `HO` and not `DC` since 0353 folded the
/// distribution centre into head office — they are one building, and one row.
/// A filter left on `DC` matches nothing and silently offers an empty source
/// list rather than erroring.
const WAREHOUSE_SITE_KIND = "HO"

/// The pool codes a supplier return may leave from, mirroring the server's
/// check (`validate_create_line`: a stockroom, reject or return pool at a
/// site of the head-office unit) by kind and role, never by pool id.
const SUPPLIER_RETURN_POOL_CODES: Record<string, true> = {
  WAREHOUSE: true,
  REJECT: true,
  DC_REJECT: true,
  STORE_REJECT: true,
  RETURN: true,
}

export type AllotmentKind = "TO_STORE" | "RETURN_TO_DC" | "RETURN_TO_SUPPLIER"

export function sourcePoolsFor(
  kind: AllotmentKind,
  pools: readonly FleetPool[]
): FleetPool[] {
  // A Cloud row shadowed by the Edge node that owns its site is the old ledger
  // for a shelf the node now speaks for: same id, stale number. Offering it
  // put `dc.warehouse` in the picker twice, once with the seed's stock.
  const usable = placements(pools).filter(
    (pool) => pool.authority.included_in_fleet_total
  )
  switch (kind) {
    case "TO_STORE":
      return usable.filter(
        (pool) =>
          pool.site_kind === WAREHOUSE_SITE_KIND &&
          DC_FULFILLMENT_POOL_CODES.has(pool.pool_code)
      )
    case "RETURN_TO_DC":
      return usable.filter(
        (pool) =>
          pool.site_kind === "STORE" &&
          STORE_RETURN_POOL_CODES.has(pool.pool_code)
      )
    case "RETURN_TO_SUPPLIER":
      return usable.filter(
        (pool) =>
          pool.site_kind === WAREHOUSE_SITE_KIND &&
          SUPPLIER_RETURN_POOL_CODES[pool.pool_code] === true
      )
  }
}

/// A whole-number percentage from a rate the server sends as a fraction.
export function percent(rate: number | null): string {
  if (rate === null) return EMPTY
  return sharePercent(rate * 100, { digits: rate >= 0.1 ? 0 : 1 })
}

/// Hours into something a person says out loud. 400 hours is "17 days", and
/// nobody has ever counted 400 hours.
export function age(hours: number | null): string {
  if (hours === null) return "—"
  if (hours < 48) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

/// A signed count, where the sign is the point: a count difference of zero is
/// a match, and `+3` and `-3` are two very different mornings.
export function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value)
}

/// The value a `datetime-local` input wants, from an instant.
export function localInput(at: Date): string {
  const shifted = new Date(at.getTime() - at.getTimezoneOffset() * 60_000)
  return shifted.toISOString().slice(0, 16)
}

/// …and back. Returns an empty string for an unparseable value so the caller
/// can leave the read disabled rather than asking the server about `NaN`.
export function instantFromLocal(value: string): string {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString()
}
