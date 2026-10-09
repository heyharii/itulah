import { node } from "@/lib/api"
import type { PrintableNote } from "@/screens/procurement/return-print"

/// The public link of a Surat Jalan Retur (0962): the QR on the printed note
/// opens `/n/{token}`, a read-only page of that surat jalan with no login.
///
/// A note's key is its return numbers, comma-joined: printing the same note
/// twice finds the same link, and the first snapshot sent is the one the page
/// keeps.
export function noteKey(note: PrintableNote): string {
  return note.returns.map((one) => one.number).join(",")
}

/// Makes the note's link, or finds it. Signed in. The note goes up exactly as
/// it is printed, minus the link itself.
export function createReturnNoteLink(
  key: string,
  note: PrintableNote,
  signal?: AbortSignal
): Promise<{ token: string }> {
  const { qrUrl: _link, ...snapshot } = note
  return node.post<{ token: string }>(
    "/api/v1/return-notes",
    { key, note: snapshot },
    { signal }
  )
}

/// `?business=<slug>` of the page's own address: on a sandbox server the link
/// names the business whose database holds the note, because the person who
/// scans it has never chosen one.
export function businessOfLocation(): string | null {
  const slug = new URLSearchParams(window.location.search).get("business")
  return slug !== null && /^[a-z0-9-]{1,80}$/.test(slug) ? slug : null
}

/// The note behind a link, for anybody holding it: no session, no cookies
/// needed. `null` when no such surat jalan exists.
export async function getPublicReturnNote(
  token: string,
  signal?: AbortSignal
): Promise<PrintableNote | null> {
  const headers: Record<string, string> = { Accept: "application/json" }
  const business = businessOfLocation()
  if (business !== null) headers["x-itulah-business"] = business
  const response = await fetch(
    `/api/v1/public/return-notes/${encodeURIComponent(token)}`,
    { headers, signal, cache: "no-store" }
  )
  if (response.status === 404) return null
  if (!response.ok)
    throw new Error(`could not read the surat jalan (${response.status})`)
  const body = (await response.json()) as { note?: PrintableNote }
  return body.note ?? null
}
