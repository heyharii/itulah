import type { FileInContext } from "@itulah/contract"

import type { GaPaper } from "@/lib/queries/ga-records"
import {
  documentContentUrl,
  fileUrl,
  type WorkplaceDocument,
} from "@/lib/queries/workplace"

/// One row of the vault, whichever of the two drawers it came out of.
///
/// # Why there is one drawer now and not two
///
/// There were two screens. Documents read the `document` table, whose migration
/// (`0075_documents.sql`) opens by saying it is "modelled on midday's Vault" —
/// title, summary, folder, tags, document date, full-text search in two
/// languages. Files read `stored_file`, the attachments, and it was the one
/// that had midday's *look*: the grid, the tiles, the previews, the view
/// switch.
///
/// So the model was on one screen and the shape was on the other, and a person
/// looking for a PDF had to know which of two identical-sounding icons somebody
/// else had put it behind. Asked for 2026-09-04: "hapus documents jika sudah
/// ada files, kenapa double double".
///
/// The two are NOT the same thing underneath and this type does not pretend
/// otherwise — that is what `source` is for. A filed document is a thing in its
/// own right: named, foldered, tagged, and searched on the server. An
/// attachment is reached only through the room that carries it, which is a rule
/// `0040_collaboration.sql` enforces by refusing `stored_file` a `url` column
/// at all. One list, one grid, one filter — and a facet that says which kind of
/// thing each row is, so the distinction survives the merge instead of being
/// papered over.
export type VaultSource = "FILED" | "THREAD" | "CHAT"

export const SOURCE_LABEL: Record<VaultSource, string> = {
  FILED: "Filed",
  THREAD: "Thread",
  CHAT: "Chat",
}

/// Where a row's bytes are, and how the reader is allowed to have proved they
/// may see them.
export interface VaultRoom {
  readonly kind: "DISCUSSION" | "CHAT"
  readonly id: string
  readonly title: string
}

export interface VaultRow {
  /// Unique across both drawers. A document and the attachment it was filed
  /// from would otherwise collide on nothing at all — they have different ids —
  /// but the prefix is what lets `getRowId` stay honest when a third source
  /// arrives.
  readonly key: string
  readonly id: string
  readonly source: VaultSource
  /// The filename, always. What the bytes are called on disk.
  readonly name: string
  /// What a person would call it: a document's title, or the filename.
  readonly title: string
  /// The three lines under the title on a tile. A document's extracted summary;
  /// for an attachment, what the room is about — which is the truest one-line
  /// answer to "why is this file here" that we hold.
  readonly summary: string | null
  readonly folder: readonly string[]
  readonly tags: readonly string[]
  readonly room: VaultRoom | null
  readonly contentType: string
  readonly byteSize: number
  readonly available: boolean
  /// `PENDING`/`PROCESSING`/`COMPLETED`/`FAILED` for a filed document; null for
  /// an attachment, which nothing extracts.
  readonly processing: string | null
  readonly at: string
  readonly by: string
  /// A same-origin path the bytes really come back from, or null when they are
  /// gone. Both drawers have one now — see `documents::content` in the backend,
  /// added for exactly this: an `<img>` cannot carry a five-minute signed URL
  /// fetched after the tile has painted.
  readonly href: string | null
  readonly docDate: string | null
  /// The paper GA keeps behind this file — its number, what it is about and
  /// where its hard copy is. Absent for a file that has none.
  readonly paper?: GaPaper | null
}

/// A paper GA has filed before it was scanned: it has a record and a hard
/// copy, and no bytes yet, so the document drawer does not list it.
export function fromPaper(paper: GaPaper): VaultRow {
  return {
    key: `document:${paper.document_id}`,
    id: paper.document_id,
    source: "FILED",
    name: paper.title,
    title: paper.title,
    summary: null,
    folder: [],
    tags: [],
    room: null,
    contentType: "",
    byteSize: 0,
    available: true,
    processing: null,
    at: paper.issued_on ?? "",
    by: "",
    href: null,
    docDate: null,
    paper,
  }
}

export function fromDocument(document: WorkplaceDocument): VaultRow {
  return {
    key: `document:${document.document_id}`,
    id: document.document_id,
    source: "FILED",
    name: document.name,
    title: document.title ?? document.name,
    summary: document.summary,
    folder: document.path_tokens,
    tags: document.tags,
    room: null,
    contentType: document.content_type,
    byteSize: document.byte_size,
    available: document.available,
    processing: document.processing_status,
    at: document.created_at,
    by: document.uploaded_by,
    href: document.available ? documentContentUrl(document.document_id) : null,
    docDate: document.doc_date,
  }
}

export function fromAttachment(row: FileInContext): VaultRow {
  return {
    key: `file:${row.file.file_id}`,
    id: row.file.file_id,
    source: row.source_kind === "DISCUSSION" ? "THREAD" : "CHAT",
    name: row.file.file_name,
    title: row.file.file_name,
    summary: row.source_title,
    folder: [],
    tags: [],
    room: {
      kind: row.source_kind === "DISCUSSION" ? "DISCUSSION" : "CHAT",
      id: row.source_id,
      title: row.source_title,
    },
    contentType: row.file.content_type,
    byteSize: row.file.byte_size,
    available: row.file.available,
    processing: null,
    at: row.file.uploaded_at,
    by: row.file.uploaded_by,
    href: row.file.available ? fileUrl(row) : null,
    docDate: null,
  }
}

/// The folder as one string, for a column and a facet. `—` rather than an empty
/// cell: a facet whose commonest value is blank reads as a bug.
export function folderOf(row: VaultRow): string {
  return row.folder.length === 0 ? "—" : `/${row.folder.join("/")}`
}

/// Where a row is kept, as the list's Where column and the sheet's crumb say
/// it: the folder for a filed document (`GA / Aset`), the room for an
/// attachment.
export function placeOf(row: VaultRow): string {
  if (row.room !== null) return row.room.title
  return row.folder.length === 0 ? "—" : row.folder.join(" / ")
}

/// What the tile and the list call the state of a row, in one word each.
///
/// The decision metric this screen sorts by: a row whose bytes are gone, or
/// whose text was never read, is the only kind anybody has to act on. A row
/// still being read is only waiting, so it is said quietly and not sorted up
/// (owner, 17 Oct 2026, library-tidy-options.html A). "Ready" is a filter
/// choice, never drawn in a row.
export function stateOf(row: VaultRow): string {
  if (row.paper != null && !row.paper.has_scan) return "No scan"
  if (!row.available) return "Missing"
  if (row.processing === "FAILED") return "Not read"
  if (row.processing !== null && row.processing !== "COMPLETED")
    return "Reading"
  return "Ready"
}

/// Lowest first, so the rows that need somebody are at the top by default.
export function attention(row: VaultRow): number {
  if (!row.available) return 0
  if (row.processing === "FAILED") return 1
  return 2
}

/// The family a content type belongs to, for the facet. `application/pdf` and
/// `image/png` are what a person filters by; `application/vnd.openxml…` is not
/// a word anybody would pick out of a menu.
export function kindOf(row: VaultRow): string {
  const base = row.contentType.split(";")[0]?.trim().toLowerCase() ?? ""
  if (base === "") return "Unknown"
  if (base === "application/pdf") return "PDF"
  if (base.startsWith("image/")) return "Image"
  if (base === "text/csv" || base.includes("spreadsheet")) return "Spreadsheet"
  if (base.startsWith("text/")) return "Text"
  if (base.includes("word") || base.includes("document")) return "Document"
  return "Other"
}

/// The kind as the grey line under a name says it: `PDF`, the extension for a
/// picture (`JPG`), else the family.
export function kindWord(row: VaultRow): string {
  const kind = kindOf(row)
  if (kind !== "Image") return kind
  const dot = row.name.lastIndexOf(".")
  return dot < 0 || dot === row.name.length - 1
    ? kind
    : row.name.slice(dot + 1).toUpperCase()
}

/// Types a browser will really draw. The same allow-list the server enforces in
/// `cloud/http/files.rs`; kept in step here so a tile does not point an
/// `<object>` at a response the server will send as an attachment, which
/// renders as a blank box rather than as a fallback.
export function previewable(row: VaultRow): boolean {
  if (!row.available || row.href === null) return false
  const base = row.contentType.split(";")[0]?.trim().toLowerCase() ?? ""
  return base === "application/pdf" || base.startsWith("image/")
}
