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
  /// Who is signed in at this till to approve it, if anybody.
  readonly approver: string | null
}

/// A till already at the node, as the replacement choice lists it.
export type TillRow = {
  readonly device_id: string
  readonly label: string
  readonly status: string
  readonly last_seen_at: string | null
}

export type SupervisorHere = {
  readonly username: string
  readonly tills: readonly TillRow[]
  readonly problem: string | null
}

export type ApprovedHere = {
  readonly label: string
  readonly approved_by: string
  readonly replaced_terminal_id: string | null
}

/// Listen on the LAN for about three seconds.
export const discoverNodes = () => shellCall<FoundNode[]>("discover_nodes")

/// Check a typed address the way a discovered one is checked.
export const identifyNode = (baseUrl: string) =>
  shellCall<FoundNode>("identify_node", { baseUrl })

/// A request left waiting when the app last closed. Asks the node nothing.
export const currentJoin = () => shellCall<JoinView | null>("join_current")

export const beginJoin = (baseUrl: string) =>
  shellCall<JoinView>("join_begin", { baseUrl })

/// `ok: false` means the node could not be asked this time — keep polling. A
/// refusal is an answer and comes back `ok` with status `REFUSED`.
export const pollJoin = () => shellCall<JoinView>("join_poll")

export const cancelJoin = () => shellCall<null>("join_cancel")

export const supervisorSignIn = (username: string, password: string) =>
  shellCall<SupervisorHere>("join_supervisor_sign_in", { username, password })

export const approveHere = (
  replacesTerminalId: string | null,
  label: string | null,
) =>
  shellCall<ApprovedHere>("join_approve_here", { replacesTerminalId, label })

export const supervisorLeave = () => shellCall<null>("join_supervisor_leave")

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
      return "Supervisor menolak permintaan kasir ini."
    case "EXPIRED":
      return "Tidak ada yang menyetujui dalam 15 menit, jadi permintaannya kedaluwarsa."
    case "UNKNOWN":
      return "Node tidak lagi mengenal permintaan ini — mungkin node dipulihkan dari cadangan."
    default:
      return reason === null
        ? "Permintaan kasir ini tidak disetujui."
        : `Permintaan kasir ini tidak disetujui (${reason.toLowerCase()}).`
  }
}

/// Minutes and seconds until `expiresAt`, or null once it has passed.
export function timeLeft(expiresAt: string | null, now: number): string | null {
  if (expiresAt === null) return null
  const until = Date.parse(expiresAt) - now
  if (!Number.isFinite(until) || until <= 0) return null
  const seconds = Math.floor(until / 1000)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
}
