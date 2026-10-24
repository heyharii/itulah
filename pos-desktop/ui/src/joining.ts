/// A till finding its shop's node and asking to join it — the window's side.
///
/// Every call here is a shell command (`src-tauri/src/discovery.rs`,
/// `src-tauri/src/join.rs`), not an edge call: the node being joined is not
/// yet this till's node, and the key the till minted must never reach this
/// window. What comes back is the code, the number and the outcome — nothing
/// that could be used to sign.

import { shellCall } from "@/session"

/// `NodeIdentity` in `backend/src/sync/device.rs`: who a node says it is.
export type NodeIdentity = {
  readonly service: string
  readonly origin_id: string
  readonly site_id: string
  /// The shop in head office's words — `C004-TOKO`, `Bumiayu` — from the
  /// node's site directory. Absent until the node has heard from head office,
  /// and from a node older than the directory.
  readonly site_code?: string | null
  readonly site_name?: string | null
  readonly node_role: string
  readonly version: string
  readonly join_path: string
}

/// A node heard on the LAN, or an address typed and checked.
export type FoundNode = {
  readonly base_url: string
  readonly host: string
  /// Null when it would not answer as our node; `problem` says why.
  readonly identity: NodeIdentity | null
  /// What its advertisement claimed. Shown only beside a failure.
  readonly advertised_site: string | null
  readonly problem: string | null
  /// Its DNS-SD instance name when it was heard on the LAN; null for a typed
  /// address. Handed to the shell with `host` when asking to join, so the
  /// till can find the node again under a new address.
  readonly instance: string | null
}

/// `JoinView` in `src-tauri/src/join.rs`.
export type JoinView = {
  readonly status: "PENDING" | "APPROVED" | "REFUSED"
  readonly base_url: string
  readonly code: string | null
  readonly verification: string | null
  readonly expires_at: string | null
  readonly node: NodeIdentity | null
  readonly label: string | null
  /// `REJECTED`, `EXPIRED` or `UNKNOWN`.
  readonly reason: string | null
  /// Who approved it, once head office has (the store never does).
  readonly approver: string | null
}

/// Listen on the LAN for about three seconds.
export const discoverNodes = () => shellCall<FoundNode[]>("discover_nodes")

/// Check a typed address the way a discovered one is checked.
export const identifyNode = (baseUrl: string) =>
  shellCall<FoundNode>("identify_node", { baseUrl })

/// A request left waiting when the app last closed. Asks the node nothing.
export const currentJoin = () => shellCall<JoinView | null>("join_current")

/// Ask to join. A node heard on the LAN is asked with the names it answers
/// to there, which the till keeps once it is let in; a typed address has none.
export const beginJoin = (baseUrl: string, found?: FoundNode) =>
  shellCall<JoinView>("join_begin", {
    baseUrl,
    instance: found?.instance ?? null,
    host: found !== undefined && found.instance !== null ? found.host : null,
  })

/// `ok: false` means the node could not be asked this time — keep polling. A
/// refusal is an answer and comes back `ok` with status `REFUSED`.
export const pollJoin = () => shellCall<JoinView>("join_poll")

export const cancelJoin = () => shellCall<null>("join_cancel")

/// Which shop a node is, as a person at the counter reads it: "C004-TOKO ·
/// Bumiayu". The site id only while the node has not heard from head office —
/// an id is a label, and nobody standing at a till recognises one.
export function siteTitle(
  site:
    | {
        readonly site_id: string
        readonly site_code?: string | null
        readonly site_name?: string | null
      }
    | null
    | undefined,
): string {
  if (site === null || site === undefined) return ""
  const words = [site.site_code, site.site_name]
    .map((word) => (word ?? "").trim())
    .filter((word) => word !== "")
  return words.length > 0 ? words.join(" · ") : site.site_id
}

/// "482913" → "482 913": read aloud across a counter in two breaths.
export function spaced(digits: string | null): string {
  if (digits === null) return ""
  return digits.length === 6 ? `${digits.slice(0, 3)} ${digits.slice(3)}` : digits
}

/// Why a request ended without a yes, in the words a cashier reads.
export function refusedBecause(reason: string | null): string {
  switch (reason) {
    case "REJECTED":
      return "Kantor pusat menolak POS ini."
    case "EXPIRED":
      return "Kantor pusat belum menyetujui dalam 24 jam, jadi permintaan ini kedaluwarsa."
    case "UNKNOWN":
      return "Server toko tidak lagi mengenal permintaan ini; mungkin dipulihkan dari cadangan."
    default:
      return reason === null
        ? "POS ini tidak disetujui."
        : `POS ini tidak disetujui (${reason.toLowerCase()}).`
  }
}
