import { dcNode } from "@/lib/api"

/// RFID verify (owner, 21 Oct 2026): the last check of a koli — how many of
/// its tags the handheld read, and when every one was (`verified_at`).
export interface RfidCheck {
  readonly koli_id: string
  readonly total: number
  readonly missing: number
  readonly checked_by: string
  readonly checked_at: string
  readonly verified_at: string | null
}

/// One tag of a koli, and whether the last check read it (`null`: never
/// checked).
export interface KoliEpc {
  readonly epc: string
  readonly sku_code: string
  readonly read: boolean | null
}

/// Verify RFID (owner, 25 Oct 2026): a store waiting for the C5 handheld to
/// read its packed koli. It leaves the list when the C5 verifies it or the
/// store has no packed koli left.
export interface RfidRequest {
  readonly store_id: string
  readonly store_code: string
  readonly store_name: string
  readonly requested_by: string
  readonly requested_at: string
  readonly total: number
  readonly koli: readonly {
    readonly koli_id: string
    readonly koli_number: string
    readonly total: number
  }[]
}

export const rfidKeys = {
  checks: () => ["dc", "koli-rfid"] as const,
  requests: () => ["dc", "koli-rfid", "requests"] as const,
  epcs: (koliId: string) => ["dc", "koli-rfid", "epcs", koliId] as const,
}

export async function rfidChecks(signal?: AbortSignal): Promise<RfidCheck[]> {
  const body = await dcNode().get<{ items: RfidCheck[] }>(
    "/api/v1/dc/koli-rfid",
    { signal }
  )
  return body.items
}

export async function rfidRequests(signal?: AbortSignal): Promise<RfidRequest[]> {
  const body = await dcNode().get<{ items: RfidRequest[] }>(
    "/api/v1/dc/koli-rfid/requests",
    { signal }
  )
  return body.items
}

export function koliEpcs(koliId: string, signal?: AbortSignal) {
  return dcNode().get<{
    koli_id: string
    epcs: KoliEpc[]
    check: RfidCheck | null
  }>(`/api/v1/dc/koli/${encodeURIComponent(koliId)}/epcs`, { signal })
}

export function sendToC5(storeIds: readonly string[]) {
  return dcNode().post<{ items: RfidRequest[] }>(
    "/api/v1/dc/koli-rfid/requests",
    { store_ids: storeIds }
  )
}
