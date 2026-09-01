import { node } from "@/lib/api"
import { attachmentUrl } from "@/lib/chat"
import { discussionAttachmentUrl } from "@/lib/discussion"
import type { FileInContext, StoredFile } from "@itulah/contract"

export const filesKey = () => ["files"] as const

/// Upload first, attach afterwards.
///
/// Two steps on purpose: a photograph finishes uploading while the message is
/// still being typed, and the message then names a `file_id` it already has.
/// A slow attachment never blocks a send, and a send that fails does not lose
/// the upload.
///
/// The name and content type go in the query string because that is what the
/// server reads — a header would need a wider preflight, and multipart would
/// mean re-encoding bytes the browser can hand to `fetch` as they are.
export function uploadFile(file: File): Promise<StoredFile> {
  const params = new URLSearchParams({ name: file.name })
  if (file.type !== "") params.set("type", file.type)
  return node.upload<StoredFile>(`/api/v1/files?${params.toString()}`, file)
}

/// Every file this person can actually reach, newest first.
///
/// Not a file system, and the shape says so: each row carries the room it
/// belongs to, because that room's route is the only way to open it. The rows
/// come from conversations the caller is in plus discussions, which everybody
/// signed in may read.
export function listFiles(limit = 200, signal?: AbortSignal): Promise<FileInContext[]> {
  return node.get<FileInContext[]>(`/api/v1/files?limit=${limit}`, { signal })
}

/// The one route that reaches a file's bytes, chosen by the room it came from.
export function fileUrl(row: FileInContext): string {
  return row.source_kind === "DISCUSSION"
    ? discussionAttachmentUrl(row.source_id, row.file.file_id)
    : attachmentUrl(row.source_id, row.file.file_id)
}

/// Where the room itself is, so a file can be read in the argument it belongs
/// to rather than on its own.
export function fileRoom(row: FileInContext): { to: string; params: Record<string, string> } {
  return row.source_kind === "DISCUSSION"
    ? { to: "/discussions/$threadId", params: { threadId: row.source_id } }
    : { to: "/chat/$conversationId", params: { conversationId: row.source_id } }
}

/// The extension, for the small square that stands in for a preview.
export function fileKind(name: string): string {
  const dot = name.lastIndexOf(".")
  if (dot < 0 || dot === name.length - 1) return "FILE"
  return name.slice(dot + 1).toUpperCase().slice(0, 4)
}
