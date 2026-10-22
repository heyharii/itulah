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

export const rfidKeys = {
  checks: () => ["dc", "koli-rfid"] as const,
  epcs: (koliId: string) => ["dc", "koli-rfid", "epcs", koliId] as const,
}

export async function rfidChecks(signal?: AbortSignal): Promise<RfidCheck[]> {
  const body = await dcNode().get<{ items: RfidCheck[] }>(
    "/api/v1/dc/koli-rfid",
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

export function verifyRfid(request: {
  koli_ids: readonly string[]
  epcs: readonly string[]
}) {
  return dcNode().post<{ items: RfidCheck[]; extra: string[] }>(
    "/api/v1/dc/koli-rfid/verify",
    request
  )
}
