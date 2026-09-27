import { node } from "@/lib/api"
import type { Identity } from "@itulah/contract/client"

/// Head office, reached **through this shop's own node**.
///
/// Everything else in this app is answered out of the SQLite file on the
/// machine behind the counter. The HR and GA screens are the exception: the
/// Edge has no employees, no rota, no leave and no asset register — those live
/// in the company's one Postgres at the centre. Until 2026-09-25 these screens
/// talked to the cloud directly, under a second, head-office sign-in. On the
/// owner's decision the till now talks to ONE server with ONE sign-in: the node
/// relays an allowlisted set of HR and GA calls to the centre on behalf of
/// whoever is signed in here (`/api/v1/store/central/{path}` →
/// `{cloud}/api/v1/{path}`; see `docs/store-edge-hr-relay.md`).
///
/// So this is not a second client. It is the node's own client — the same
/// cookie, the same CSRF token — with the path moved under the relay's prefix.
/// Every screen keeps writing the centre's own path (`/api/v1/employees`), which
/// is also the path the relay's allowlist and the hub's screens are written
/// in, so a call can be compared across the three by eye.
///
/// What the node and the centre enforce, and this file does not have to:
/// the person must be a head-office account assigned to this node (a LOCAL
/// break-glass login is refused), the path must be on the allowlist, and every
/// read is cut down to this node's own place. When the line to head office is
/// down the node answers 503 with a sentence rather than inventing an answer.
const RELAY = "/api/v1/store/central"
const CENTRE = "/api/v1/"

function relayed(path: string): string {
  if (!path.startsWith(CENTRE)) {
    throw new Error(
      `cloud path "${path}" must be the centre's own /api/v1/… path — the relay prefix is added here`,
    )
  }
  return `${RELAY}/${path.slice(CENTRE.length)}`
}

type Options = Parameters<typeof node.get>[1]

export const cloud = {
  get: <T>(path: string, options?: Options) =>
    node.get<T>(relayed(path), options),
  post: <T>(path: string, body: unknown, options?: Options) =>
    node.post<T>(relayed(path), body, options),
  put: <T>(path: string, body: unknown, options?: Options) =>
    node.put<T>(relayed(path), body, options),
  patch: <T>(path: string, body: unknown, options?: Options) =>
    node.patch<T>(relayed(path), body, options),
  delete: <T>(path: string, options?: Options) =>
    node.delete<T>(relayed(path), options),
}

/// Whether the person signed in at this till can be relayed for.
///
///  - `ready` — a head-office account projected onto this node (`CLOUD`).
///  - `local` — a break-glass account that exists only in this node's SQLite;
///    the centre has never heard of it, so the node will not relay for it.
///  - `development` — a node running with sign-in switched off: there is no
///    person to relay for, and "the node" is not somebody the centre knows.
///  - `signed-out` — nobody.
export type RelayAccess = "ready" | "local" | "development" | "signed-out"

export function relayAccess(
  identity: Identity | null | undefined,
): RelayAccess {
  if (identity === null || identity === undefined) return "signed-out"
  const source = "source" in identity ? identity.source : "CLOUD"
  if (source === "CLOUD") return "ready"
  if (source === "DEVELOPMENT") return "development"
  return "local"
}

/// Every query answered by head office sits under this prefix, so signing out
/// of the till — which ends the relay too — can drop them in one call.
export const CENTRAL_KEY_PREFIX = "central"
