import type { gaAssetBookQuery } from "@/lib/queries/ga"

/// The register's two tabs, as the `status` list each asks the server for.
///
/// A thing the company still holds — whatever it is waiting for — is in use:
/// a DRAFT a posted bill minted, a project still being built (IN_PROGRESS) and
/// a thing waiting on a disposal decision are all still the company's. One
/// that has left the register, replaced or disposed of, is not.
///
/// A module of its own so `prefetch.ts` can warm the opening page without
/// pulling the whole screen into the prefetch map.
export type Shelf = "IN_USE" | "GONE"

export const IN_USE_STATUSES: readonly string[] = [
  "DRAFT",
  "IN_PROGRESS",
  "REGISTERED",
  "IN_SERVICE",
  "DISPOSAL_REQUESTED",
]
export const GONE_STATUSES: readonly string[] = ["REPLACED", "DISPOSED"]

export const SHELF_STATUSES: Record<Shelf, string> = {
  IN_USE: IN_USE_STATUSES.join(","),
  GONE: GONE_STATUSES.join(","),
}

/// The page the screen opens on: the In use tab, nothing narrowed.
export const OPENING_SCOPE: Parameters<typeof gaAssetBookQuery>[0] = {
  status: SHELF_STATUSES.IN_USE,
}
