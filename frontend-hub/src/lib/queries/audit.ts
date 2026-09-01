import type { AuditEntry } from "@itulah/contract"

import { node } from "@/lib/api"

/// Who did what, to which record.
///
/// `AuditEntry` is generated from the Rust struct the server serialises — see
/// `cloud/postgres/audit.rs`. Do not transcribe it here.
export type { AuditEntry }

export const auditKeys = {
  all: ["audit"] as const,
  /// One record's history. Keyed by the pair, so two sheets open on two
  /// records do not share an answer.
  subject: (kind: string, id: string) =>
    ["audit", "subject", kind, id] as const,
  feed: (actor: string | null) => ["audit", "feed", actor] as const,
}

export function auditForSubject(
  kind: string,
  id: string,
  signal?: AbortSignal
): Promise<AuditEntry[]> {
  const params = new URLSearchParams({
    subject_kind: kind,
    subject_id: id,
    limit: "100",
  })
  return node.get<AuditEntry[]>(`/api/v1/audit?${params.toString()}`, {
    signal,
  })
}

export function recentAudit(
  actor: string | null,
  limit = 200,
  signal?: AbortSignal
): Promise<AuditEntry[]> {
  const params = new URLSearchParams({ limit: String(limit) })
  if (actor) params.set("actor", actor)
  return node.get<AuditEntry[]>(`/api/v1/audit?${params.toString()}`, {
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
