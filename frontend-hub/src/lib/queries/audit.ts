import type { AuditEntry, AuditFeed } from "@itulah/contract"

import { node } from "@/lib/api"

/// Who did what, to which record.
///
/// `AuditEntry` is generated from the Rust struct the server serialises — see
/// `cloud/postgres/audit.rs`. Do not transcribe it here.
export type { AuditEntry, AuditFeed }

export const auditKeys = {
  all: ["audit"] as const,
  /// One record's history. Keyed by the pair, so two sheets open on two
  /// records do not share an answer.
  subject: (kind: string, id: string) =>
    ["audit", "subject", kind, id] as const,
  /// The activity feed, keyed by everything that narrows it. Pages are the
  /// infinite query's business, so the cursor is not part of the key.
  feed: (scope: AuditScope) => ["audit", "feed", scope] as const,
}

/// One record's history. The server answers an envelope — rows, a cursor and
/// an exact total — and this sheet reads the first page of it, which is what it
/// always showed. `total` is now available to say when there is more.
export function auditForSubject(
  kind: string,
  id: string,
  signal?: AbortSignal
): Promise<AuditFeed> {
  const params = new URLSearchParams({
    subject_kind: kind,
    subject_id: id,
    limit: "100",
  })
  return node.get<AuditFeed>(`/api/v1/audit?${params.toString()}`, {
    signal,
  })
}

/// What the activity feed is asked for — every parameter `GET /api/v1/audit`
/// answers for the global feed, and nothing it would refuse (the route is
/// `deny_unknown_fields`).
export interface AuditScope {
  /// Free text over who acted, their name, the path and the record id.
  readonly q?: string
  /// One person's actions, by username.
  readonly actor?: string
  /// `POST`, `PATCH`, `PUT` or `DELETE`.
  readonly method?: string
  /// `OK` or `REFUSED` — `status >= 400`, decided by the server.
  readonly outcome?: "OK" | "REFUSED"
  /// `at`, `actor`, `path` or `status`.
  readonly sort?: "at" | "actor" | "path" | "status"
  /// Newest first is the route's own default, so only `false` is sent.
  readonly desc?: boolean
}

/// One page of the activity feed. The server clamps `limit` at 500.
export const AUDIT_PAGE = 100

/// The feed, one page at a time, walking `next_cursor`.
///
/// Only the FIRST page asks for the exact total and the facet counts: that
/// half reads the whole log whatever the page is, and the pages after it would
/// only repeat the same numbers at the same cost.
export function auditPage(
  scope: AuditScope & { readonly cursor?: string },
  signal?: AbortSignal
): Promise<AuditFeed> {
  const params = new URLSearchParams({ limit: String(AUDIT_PAGE) })
  if (scope.q) params.set("q", scope.q)
  if (scope.actor) params.set("actor", scope.actor)
  if (scope.method) params.set("method", scope.method)
  if (scope.outcome) params.set("outcome", scope.outcome)
  if (scope.sort) params.set("sort", scope.sort)
  if (scope.desc === false) params.set("dir", "asc")
  if (scope.cursor) {
    params.set("cursor", scope.cursor)
    params.set("count", "0")
  }
  return node.get<AuditFeed>(`/api/v1/audit?${params.toString()}`, {
    signal,
  })
}

/// `POST /api/v1/suppliers/{id}/activate` → "Activate".
///
/// The middleware records the shape of the request rather than a sentence,
/// because it is one function standing behind two hundred handlers. Turning
/// that back into something readable is the browser's job, and doing it here
/// means one mapping rather than one per screen.
export function readAction(entry: AuditEntry): string {
  const parts = entry.path.replace(/^\/api\/v1\//, "").split("/")

  // The generic record surface, which the rule below cannot read: its verb is
  // not the last segment. `.../tags/DENIM` would say "DENIM", which names the
  // word and not the act, and `PATCH /comments/{id}` has no verb at all and
  // would fall through to the bare "Changed".
  if (parts[0] === "records" && parts[3] === "comments") return "Commented"
  if (parts[0] === "records" && parts[3] === "tags") {
    const word = parts[4] ?? ""
    return entry.method === "DELETE" ? `Untagged ${word}` : `Tagged ${word}`
  }
  if (parts[0] === "comments") {
    return entry.method === "DELETE" ? "Comment removed" : "Comment edited"
  }

  const isId = (part: string) => /^[0-9a-f-]{20,}$/i.test(part)

  // A verb is a segment that comes AFTER the record's own id. Without that
  // test the collection name reads as the verb — `PATCH /suppliers/{id}` would
  // say "Suppliers" — because dropping the id leaves the collection last.
  const lastId = parts.map(isId).lastIndexOf(true)
  const verb =
    lastId >= 0 && lastId < parts.length - 1 ? parts[parts.length - 1] : ""

  const known: Record<string, string> = {
    activate: "Activated",
    deactivate: "Deactivated",
    publish: "Published",
    submit: "Submitted",
    approve: "Approved",
    cancel: "Cancelled",
    execute: "Executed",
    decide: "Decided",
    seal: "Sealed",
    close: "Closed",
    depart: "Departed",
    read: "Marked read",
    "close-short": "Closed short",
    "read-all": "Marked all read",
  }
  if (known[verb]) return known[verb]

  // A verb this list does not know is still a verb, and naming it is more
  // honest than calling every unrecognised POST a "Created" — which is how a
  // refused request to a path that does not exist ends up reading as a record
  // having been made.
  if (verb !== "") {
    const spoken = verb.replace(/[-_]+/g, " ")
    return spoken.charAt(0).toUpperCase() + spoken.slice(1)
  }

  if (entry.method === "POST") return "Created"
  if (entry.method === "PATCH" || entry.method === "PUT") return "Changed"
  if (entry.method === "DELETE") return "Removed"
  return entry.method
}
