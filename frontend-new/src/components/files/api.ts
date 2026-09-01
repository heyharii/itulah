/*
 * Files' backend boundary.
 *
 * The backing service is cloud-hub (Go, `github.com/retailos/backbone`). Its
 * Drive-shaped surface is the cross-module **Document Library**:
 *
 *   GET /api/v1/documents/library         one row per FILE, server-paginated
 *   GET /api/v1/documents/library/facets  distinct domain/type/status/tag values
 *
 * A library row is an *attachment* (`record_attachments`) joined onto the
 * `kind = "document"` record it hangs off, so every row carries both file facts
 * (name, content type, size, uploader, upload time, extraction state) and the
 * facts of the owning business record (title, status, tags, source module).
 *
 * Since migration 734 the hub also owns a real Drive surface — folders, per-
 * viewer favourites, soft-delete trash and per-file shares — and the library
 * response carries a `folders` array plus `folder_id` / `trashed_at` /
 * `favourite` / `shared_with` on every row.
 *
 * That is the ONE capability signal this module uses: a response with a
 * `folders` array is a hub that has the drive routes. Against an older binary
 * the key is absent, and the module falls back to exactly what it did before —
 * a tree derived from `source_domain` → `source_entity_type`, with folder
 * creation, starring, trash and sharing withheld rather than faked.
 *
 * The whole listing is walked once instead of per-folder, because the screen
 * derives breadcrumbs, folder sizes and child counts client-side from a single
 * flat list.
 */

import {
  api,
  checkContract,
  qs,
  useDomainQuery,
  type ApiRequestOptions,
} from "@/lib/api"
import {
  FacetsPayload,
  FolderRow,
  LibraryItemRow,
} from "@/components/files/contracts"
import { fileQueries } from "@/components/files/queries"
import {
  ROOT,
  moduleLabel,
  type FileKind,
  type FileNode,
} from "@/components/files/data"

const LIBRARY_ROUTE = "/v1/documents/library"
const FACETS_ROUTE = "/v1/documents/library/facets"
/** The handler defaults `limit` to 50 and does not clamp it; 200 keeps the
 *  walk short without asking for an unbounded page. */
const PAGE_SIZE = 200
const MAX_PAGES = 40

/** One library row, exactly as `documents.libraryItemDTO` serialises it. */
interface ApiLibraryItem {
  attachment_id?: unknown
  record_id?: unknown
  file_name?: unknown
  content_type?: unknown
  size_bytes?: unknown
  blob_key?: unknown
  url?: unknown
  uploaded_by?: unknown
  uploaded_at?: unknown
  title?: unknown
  status?: unknown
  tags?: unknown
  source_domain?: unknown
  source_entity_type?: unknown
  source_entity_id?: unknown
  has_text?: unknown
  text_status?: unknown
  extracted_at?: unknown
  doc_title?: unknown
  doc_summary?: unknown
  doc_date?: unknown
  doc_language?: unknown
  content_url?: unknown
  // ── drive fields (migration 734; absent on an older hub) ──
  folder_id?: unknown
  trashed_at?: unknown
  trashed_by?: unknown
  favourite?: unknown
  shared_with?: unknown
  shared_with_me?: unknown
}

/** One node of the hub's folder tree (`document_folders`). */
interface ApiFolder {
  id?: unknown
  name?: unknown
  parent_id?: unknown
  created_by?: unknown
  created_at?: unknown
  updated_at?: unknown
  trashed_at?: unknown
  file_count?: unknown
}

/** Distinct filter values across the whole library, not just the loaded page. */
export interface LibraryFacets {
  domains: string[]
  types: string[]
  statuses: string[]
  tags: string[]
}

export interface DocumentLibrary {
  /** Live files, plus their folders (real ones when the hub has them). */
  nodes: FileNode[]
  /** Soft-deleted files and folders; the Trash scope reads these. */
  trashed: FileNode[]
  /** How many of `nodes` are files rather than folders. */
  fileCount: number
  /** `total` as reported by the hub for the live listing. */
  total: number
  /**
   * True when the hub answered with a folder tree — i.e. it has migration 734
   * and the drive routes. False against an older binary, and every write below
   * stays disabled rather than calling a route that would 404.
   */
  drive: boolean
  facets?: LibraryFacets
  fetchedAt: string
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string"
    ? value.trim()
    : value == null
      ? fallback
      : String(value)
}

function numberValue(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}

function booleanValue(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase()
    if (normalized === "true") return true
    if (normalized === "false") return false
  }
  return fallback
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((entry) => stringValue(entry)).filter(Boolean)
}

function itemsFrom(payload: unknown): ApiLibraryItem[] {
  if (Array.isArray(payload)) return payload as ApiLibraryItem[]
  const items = asRecord(payload)?.items
  return Array.isArray(items) ? (items as ApiLibraryItem[]) : []
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".")
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : ""
}

/** The hub stores a mime type per attachment; extension only breaks ties. */
function fileKind(fileName: string, contentType: string): FileKind {
  const mime = contentType.toLowerCase()
  const extension = extensionOf(fileName)

  if (mime === "application/pdf" || extension === "pdf") return "pdf"
  if (
    mime.startsWith("image/") ||
    ["png", "jpg", "jpeg", "gif", "webp", "svg", "heic"].includes(extension)
  ) {
    return "image"
  }
  if (
    mime.startsWith("video/") ||
    ["mp4", "mov", "webm", "avi", "mkv"].includes(extension)
  ) {
    return "video"
  }
  if (
    mime.includes("spreadsheet") ||
    mime.includes("excel") ||
    mime === "text/csv" ||
    ["csv", "tsv", "xls", "xlsx", "ods"].includes(extension)
  ) {
    return "sheet"
  }
  if (
    mime.includes("presentation") ||
    mime.includes("powerpoint") ||
    ["ppt", "pptx", "odp"].includes(extension)
  ) {
    return "slide"
  }
  if (
    mime.includes("zip") ||
    mime.includes("compressed") ||
    mime.includes("tar") ||
    ["zip", "tar", "gz", "7z", "rar"].includes(extension)
  ) {
    return "archive"
  }
  return "doc"
}

function minutesSince(value: unknown): number {
  const raw = stringValue(value)
  if (!raw) return 0
  const timestamp = Date.parse(raw)
  if (!Number.isFinite(timestamp)) return 0
  return Math.max(0, Math.round((Date.now() - timestamp) / 60_000))
}

const DOMAIN_PREFIX = "hub-domain:"
const TYPE_PREFIX = "hub-type:"

/**
 * Where a file sits in the derived tree: `source_domain` is the first level and
 * `source_entity_type` the second. A row missing either column simply sits one
 * level higher rather than being filed under an invented name.
 */
function parentFor(domain: string, entityType: string): string {
  if (!domain) return ROOT
  if (!entityType) return `${DOMAIN_PREFIX}${domain}`
  return `${TYPE_PREFIX}${domain}/${entityType}`
}

function toNode(raw: ApiLibraryItem, drive: boolean): FileNode | null {
  const id = stringValue(raw.attachment_id)
  const name = stringValue(raw.file_name)
  if (!id || !name) return null

  const contentType = stringValue(raw.content_type)
  const domain = stringValue(raw.source_domain)
  const entityType = stringValue(raw.source_entity_type)
  const uploadedBy = stringValue(raw.uploaded_by)
  const blobKey = stringValue(raw.blob_key)
  // The DTO always fills content_url: the streamed blob route when the file is
  // in the object store, otherwise whatever external URL the row carries.
  const contentUrl = stringValue(raw.content_url) || stringValue(raw.url)

  // A hub with folders places the file itself; without them the module/type
  // provenance is the only honest tree available.
  const parentId = drive
    ? stringValue(raw.folder_id) || ROOT
    : parentFor(domain, entityType)

  return {
    id,
    live: true,
    name,
    kind: fileKind(name, contentType),
    parentId,
    size: Math.max(0, numberValue(raw.size_bytes)),
    modified: minutesSince(raw.uploaded_at),
    // No user directory is reachable from this API surface, so the uploader is
    // shown as the subject id the hub recorded — never a made-up display name.
    ownerId: uploadedBy || "unknown",
    mimeType: contentType || undefined,
    documentTitle: stringValue(raw.doc_title) || undefined,
    summary: stringValue(raw.doc_summary) || undefined,
    documentDate: stringValue(raw.doc_date) || undefined,
    language: stringValue(raw.doc_language) || undefined,
    tags: stringList(raw.tags),
    recordId: stringValue(raw.record_id) || undefined,
    recordTitle: stringValue(raw.title) || undefined,
    recordStatus: stringValue(raw.status) || undefined,
    sourceDomain: domain || undefined,
    sourceEntityType: entityType || undefined,
    sourceEntityId: stringValue(raw.source_entity_id) || undefined,
    hasText: booleanValue(raw.has_text),
    textStatus: stringValue(raw.text_status) || undefined,
    extractedAt: stringValue(raw.extracted_at) || undefined,
    uploadedAt: stringValue(raw.uploaded_at) || undefined,
    stored: Boolean(blobKey),
    contentUrl: contentUrl || undefined,
    // Drive state. Only trusted when the hub advertised folders — an older
    // binary simply has no such columns, and a missing field must read as
    // "unknown", never as "not starred / not shared".
    folderId: drive ? stringValue(raw.folder_id) || undefined : undefined,
    starred: drive ? booleanValue(raw.favourite) : undefined,
    trashed: drive ? Boolean(stringValue(raw.trashed_at)) : undefined,
    trashedAt: drive ? stringValue(raw.trashed_at) || undefined : undefined,
    trashedBy: drive ? stringValue(raw.trashed_by) || undefined : undefined,
    sharedWith: drive ? stringList(raw.shared_with) : undefined,
    sharedWithMe: drive ? booleanValue(raw.shared_with_me) : undefined,
  }
}

/** Maps one hub folder onto the display model. */
function toFolderNode(raw: ApiFolder): FileNode | null {
  const id = stringValue(raw.id)
  const name = stringValue(raw.name)
  if (!id || !name) return null
  return {
    id,
    live: true,
    name,
    kind: "folder",
    parentId: stringValue(raw.parent_id) || ROOT,
    size: 0,
    modified: minutesSince(raw.updated_at ?? raw.created_at),
    ownerId: stringValue(raw.created_by) || "unknown",
    folderId: stringValue(raw.parent_id) || undefined,
    trashed: Boolean(stringValue(raw.trashed_at)),
    trashedAt: stringValue(raw.trashed_at) || undefined,
    hubFileCount: Math.max(0, numberValue(raw.file_count)),
  }
}

/**
 * Materialises the module/type folders the files were filed under. A folder is
 * only created because at least one row named that domain (or domain + type);
 * its "modified" is the freshest upload it contains.
 */
function deriveFolders(files: FileNode[]): FileNode[] {
  const folders = new Map<string, FileNode>()

  const touch = (id: string, name: string, parentId: string, node: FileNode) => {
    const existing = folders.get(id)
    if (existing) {
      existing.modified = Math.min(existing.modified, node.modified)
      return
    }
    folders.set(id, {
      id,
      live: true,
      name,
      kind: "folder",
      parentId,
      size: 0,
      modified: node.modified,
      ownerId: "unknown",
    })
  }

  for (const file of files) {
    const domain = file.sourceDomain
    if (!domain) continue
    const domainId = `${DOMAIN_PREFIX}${domain}`
    touch(domainId, moduleLabel(domain), ROOT, file)

    const entityType = file.sourceEntityType
    if (!entityType) continue
    touch(`${TYPE_PREFIX}${domain}/${entityType}`, entityType, domainId, file)
  }

  return [...folders.values()]
}

/**
 * Walks `limit`/`offset` pages until the hub's own `total` is reached. The
 * response echoes `limit` and `offset` back, and there is no cursor on this
 * route — offset paging is the contract.
 *
 * `folders` rides along with every page on a drive-capable hub; it is the whole
 * (small) tree, not a page of it, so the last response wins. Its presence is
 * also the capability signal: `undefined` means an older binary.
 */
async function fetchListing(
  params: Record<string, string | number | boolean | undefined>,
  signal?: AbortSignal
): Promise<{ items: ApiLibraryItem[]; folders?: ApiFolder[]; total: number }> {
  const options: ApiRequestOptions | undefined = signal ? { signal } : undefined
  const items: ApiLibraryItem[] = []
  let folders: ApiFolder[] | undefined
  let total = 0
  let offset = 0

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const path = `${LIBRARY_ROUTE}${qs({ ...params, limit: PAGE_SIZE, offset: offset || undefined })}`
    const payload = await api.get<unknown>(path, options)
    const record = asRecord(payload)
    const pageItems = itemsFrom(payload)
    checkContract(LibraryItemRow, pageItems, path)
    items.push(...pageItems)
    if (Array.isArray(record?.folders)) {
      folders = record.folders as ApiFolder[]
      checkContract(FolderRow, folders, `${path}#folders`)
    }
    total = numberValue(record?.total, total)
    offset += pageItems.length

    if (pageItems.length < PAGE_SIZE) break
    if (offset >= total) break
  }

  return { items, folders, total }
}

async function fetchFacets(
  signal?: AbortSignal
): Promise<LibraryFacets | undefined> {
  try {
    const payload = await api.get<unknown>(
      FACETS_ROUTE,
      signal ? { signal } : undefined
    )
    checkContract(FacetsPayload, [payload], FACETS_ROUTE)
    const record = asRecord(payload)
    if (!record) return undefined
    return {
      domains: stringList(record.domains),
      types: stringList(record.types),
      statuses: stringList(record.statuses),
      tags: stringList(record.tags),
    }
  } catch {
    // Facets only decorate the header; losing them must not blank the screen.
    return undefined
  }
}

function mapNodes(
  items: ApiLibraryItem[],
  folders: ApiFolder[] | undefined,
  drive: boolean
): { nodes: FileNode[]; fileCount: number } {
  const files = items
    .map((item) => toNode(item, drive))
    .filter((node): node is FileNode => Boolean(node))

  const tree = drive
    ? (folders ?? [])
        .map(toFolderNode)
        .filter((node): node is FileNode => Boolean(node))
    : deriveFolders(files)

  return { nodes: [...tree, ...files], fileCount: files.length }
}

export async function fetchDocumentLibrary(
  signal?: AbortSignal
): Promise<DocumentLibrary> {
  const [live, facets] = await Promise.all([
    fetchListing({}, signal),
    fetchFacets(signal),
  ])
  const drive = Array.isArray(live.folders)

  // The bin is a second listing, not a filter on the first: the hub keeps the
  // two sets disjoint. It is only asked for when the hub has a trash at all.
  const binned = drive
    ? await fetchListing({ trashed: true }, signal).catch(() => undefined)
    : undefined

  const { nodes, fileCount } = mapNodes(live.items, live.folders, drive)
  const trash = binned
    ? mapNodes(binned.items, binned.folders, drive).nodes
    : []

  return {
    nodes,
    trashed: trash,
    fileCount,
    total: live.total || fileCount,
    drive,
    facets,
    fetchedAt: new Date().toISOString(),
  }
}

/** Loads cloud-hub's Document Library as the Files screen's read-only source. */
export function useDocumentLibraryResource() {
  return useDomainQuery(fileQueries.library())
}

/*
 * ── Drive writes ────────────────────────────────────────────────────────────
 *
 * Every call below exists only on a hub carrying migration 734. The screen
 * gates them on `library.drive`, so an older binary never reaches them; they
 * are plain calls rather than hooks because each one is followed by a reload of
 * the listing above, which is the single source of truth for what is on screen.
 */

/** Creates a folder under `parentId` ("" or ROOT = the library root). */
export async function createLibraryFolder(
  name: string,
  parentId: string
): Promise<void> {
  await api.post(`${LIBRARY_ROUTE}/folders`, {
    name,
    parent_id: parentId === ROOT ? "" : parentId,
  })
}

/** Stars or unstars one file for the calling user. */
export async function setLibraryFavourite(
  attachmentId: string,
  favourite: boolean
): Promise<void> {
  await api.post(`${LIBRARY_ROUTE}/${attachmentId}/favourite`, { favourite })
}

/** Soft-deletes or restores one file. Bytes are never touched. */
export async function setLibraryTrashed(
  node: FileNode,
  trashed: boolean
): Promise<void> {
  const path = node.kind === "folder" ? `folders/${node.id}` : node.id
  await api.post(
    `${LIBRARY_ROUTE}/${path}/${trashed ? "trash" : "restore"}`,
    {}
  )
}

/** Files one library file into a folder ("" or ROOT = the library root). */
export async function moveLibraryFile(
  attachmentId: string,
  folderId: string
): Promise<void> {
  await api.post(`${LIBRARY_ROUTE}/${attachmentId}/move`, {
    folder_id: folderId === ROOT ? "" : folderId,
  })
}

/** Grants one subject access to one file. */
export async function shareLibraryFile(
  attachmentId: string,
  subjectId: string
): Promise<void> {
  await api.post(`${LIBRARY_ROUTE}/${attachmentId}/shares`, {
    subject_id: subjectId,
  })
}

/** Revokes one subject's grant. */
export async function unshareLibraryFile(
  attachmentId: string,
  subjectId: string
): Promise<void> {
  await api.del(
    `${LIBRARY_ROUTE}/${attachmentId}/shares/${encodeURIComponent(subjectId)}`
  )
}
