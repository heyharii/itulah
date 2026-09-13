import type { NewComment, RecordComment, RecordInfo } from "@itulah/contract"

import { node } from "@/lib/api"

/// One record's surroundings, from the one route that serves every kind.
///
/// `RecordInfo` and everything under it is generated from the Rust the server
/// serialises — see `cloud/postgres/records.rs`. Do not transcribe it here.
export type { RecordComment, RecordInfo }

export const recordKeys = {
  all: ["record"] as const,
  /// Keyed by the pair, so two sheets open on two records do not share an
  /// answer — the same rule the activity panel already followed.
  info: (kind: string, id: string) => ["record", kind, id, "info"] as const,
}

export function recordInfo(
  kind: string,
  id: string,
  signal?: AbortSignal
): Promise<RecordInfo> {
  return node.get<RecordInfo>(
    `/api/v1/records/${encodeURIComponent(kind)}/${encodeURIComponent(id)}/info`,
    { signal }
  )
}

export function addComment(
  kind: string,
  id: string,
  body: string
): Promise<RecordComment> {
  const request: NewComment = { body }
  return node.post<RecordComment>(
    `/api/v1/records/${encodeURIComponent(kind)}/${encodeURIComponent(id)}/comments`,
    request
  )
}

export function editComment(
  commentId: string,
  body: string
): Promise<RecordComment> {
  return node.patch<RecordComment>(`/api/v1/comments/${commentId}`, { body })
}

export function removeComment(commentId: string): Promise<void> {
  return node.delete<void>(`/api/v1/comments/${commentId}`)
}

/// File a record under a word, and take it off again.
///
/// `PUT` rather than `POST` because tagging what is already tagged is not an
/// error: the control is a toggle and a double click is not a mistake worth a
/// 409. The server agrees — it inserts `ON CONFLICT DO NOTHING`.
export function tagRecord(
  kind: string,
  id: string,
  code: string
): Promise<void> {
  return node.put<void>(
    `/api/v1/records/${encodeURIComponent(kind)}/${encodeURIComponent(id)}/tags/${encodeURIComponent(code)}`,
    {}
  )
}

export function untagRecord(
  kind: string,
  id: string,
  code: string
): Promise<void> {
  return node.delete<void>(
    `/api/v1/records/${encodeURIComponent(kind)}/${encodeURIComponent(id)}/tags/${encodeURIComponent(code)}`
  )
}
