/**
 * Owns the Files display vocabulary and its formatting helpers. `FileNode` is
 * the shape cloud-hub's Document Library rows (`/api/v1/documents/library`) are
 * mapped onto; the FILES fixture below is the offline fallback used when that
 * route cannot be reached.
 */

export type FileKind =
  | "folder"
  | "doc"
  | "sheet"
  | "slide"
  | "pdf"
  | "image"
  | "video"
  | "archive"

export interface Owner {
  id: string
  name: string
  hue: string
}

export interface FileNode {
  id: string
  name: string
  kind: FileKind
  parentId: string | null
  /** Bytes. Folders carry 0 and derive their size from their children. */
  size: number
  /** Minutes since the last edit. */
  modified: number
  ownerId: string
  /** True for rows the hub returned, false/absent for the offline fixture. */
  live?: boolean

  /** Starred by the signed-in viewer. Undefined on a hub without favourites. */
  starred?: boolean
  /** Subjects holding a direct grant. Undefined on a hub without sharing. */
  sharedWith?: string[]

  // ── live Document Library metadata ────────────────────────────────────────
  /** Display name for the uploader when one is resolvable; the hub has no user
   *  directory on this surface, so live rows fall back to the subject id. */
  ownerName?: string
  mimeType?: string
  /** The record the attachment hangs off (`kind = "document"`). */
  recordId?: string
  recordTitle?: string
  recordStatus?: string
  /** Owning module, e.g. procurement / hr / finance. */
  sourceDomain?: string
  /** Entity kind within the module, e.g. po / grn / payslip. */
  sourceEntityType?: string
  sourceEntityId?: string
  /** AI-extracted title, distinct from the file name. */
  documentTitle?: string
  summary?: string
  /** Business date read out of the document, not the upload stamp. */
  documentDate?: string
  language?: string
  /** True when searchable text was extracted (LiteParse/OCR). */
  hasText?: boolean
  /** Extraction outcome: pending | done | empty | unsupported | failed. */
  textStatus?: string
  extractedAt?: string
  uploadedAt?: string
  /** True when the bytes live in the object store rather than an external URL. */
  stored?: boolean
  /** Ready-to-use inline content URL served by the hub. */
  contentUrl?: string
  tags?: string[]

  // ── drive state (cloud-hub migration 734) ─────────────────────────────────
  /** Containing folder id; absent at the library root. */
  folderId?: string
  /** Soft-deleted. Undefined on a hub without a trash. */
  trashed?: boolean
  trashedAt?: string
  trashedBy?: string
  /** True when this file was shared with the signed-in viewer by someone else. */
  sharedWithMe?: boolean
  /** Live file count the hub reports for a folder, used before its children load. */
  hubFileCount?: number
}

export const ROOT = "root"

export const OWNERS: Record<string, Owner> = {
  me: { id: "me", name: "You", hue: "#0086fc" },
  devi: { id: "devi", name: "Devi Kusuma", hue: "#7b5cfa" },
  lars: { id: "lars", name: "Lars Meyer", hue: "#00c978" },
  amara: { id: "amara", name: "Amara Obi", hue: "#ff58ae" },
  omar: { id: "omar", name: "Omar Haddad", hue: "#64c6ff" },
  priya: { id: "priya", name: "Priya Sharma", hue: "#ff3e00" },
}

/** Module label per `source_domain` — the library's primary facet. */
const MODULE_LABEL: Record<string, string> = {
  procurement: "Procurement",
  hr: "HR",
  ho: "Head Office",
  finance: "Finance",
  accounting: "Accounting",
  assets: "Assets",
  storeops: "Store Ops",
  masterdata: "Master Data",
  reports: "Reports",
  records: "Records",
  documents: "Documents",
}

/** Names a module without inventing one: an unmapped domain keeps its own id. */
export function moduleLabel(domain?: string): string {
  if (!domain) return "\u2014"
  return MODULE_LABEL[domain] ?? domain
}

/** Display an owner id without inventing a directory name for live rows. */
export function ownerLabel(node: Pick<FileNode, "ownerId" | "ownerName">): string {
  return OWNERS[node.ownerId]?.name ?? node.ownerName ?? (node.ownerId && node.ownerId !== "unknown" ? node.ownerId : "Unknown uploader")
}

/** Each kind gets its own hue and glyph, so a list scans by shape and colour. */
export const KIND_META: Record<FileKind, { label: string; hue: string }> = {
  folder: { label: "Folder", hue: "#7e7e7d" },
  doc: { label: "Document", hue: "#0086fc" },
  sheet: { label: "Spreadsheet", hue: "#00c978" },
  slide: { label: "Presentation", hue: "#ffbb26" },
  pdf: { label: "PDF", hue: "#ff3e00" },
  image: { label: "Image", hue: "#7b5cfa" },
  video: { label: "Video", hue: "#ff58ae" },
  archive: { label: "Archive", hue: "#64c6ff" },
}

export const FILES: FileNode[] = [
  // ── top level ──
  { id: "f-finance", name: "Finance", kind: "folder", parentId: ROOT, size: 0, modified: 120, ownerId: "devi", sharedWith: ["me", "priya"] },
  { id: "f-suppliers", name: "Suppliers", kind: "folder", parentId: ROOT, size: 0, modified: 45, ownerId: "me", starred: true },
  { id: "f-warehouse", name: "Warehouse", kind: "folder", parentId: ROOT, size: 0, modified: 900, ownerId: "lars", sharedWith: ["me", "omar"] },
  { id: "f-brand", name: "Brand assets", kind: "folder", parentId: ROOT, size: 0, modified: 4300, ownerId: "amara" },
  { id: "n-handbook", name: "Operations handbook.pdf", kind: "pdf", parentId: ROOT, size: 4_820_000, modified: 2600, ownerId: "me", starred: true },
  { id: "n-roadmap", name: "2026 roadmap.slide", kind: "slide", parentId: ROOT, size: 12_400_000, modified: 780, ownerId: "omar", sharedWith: ["me"] },

  // ── Finance ──
  { id: "f-month-end", name: "Month end", kind: "folder", parentId: "f-finance", size: 0, modified: 60, ownerId: "priya", sharedWith: ["me", "devi"] },
  { id: "n-aging", name: "Aging report — August.sheet", kind: "sheet", parentId: "f-finance", size: 890_000, modified: 44, ownerId: "priya", sharedWith: ["me"], starred: true },
  { id: "n-refunds", name: "Refund policy.doc", kind: "doc", parentId: "f-finance", size: 128_000, modified: 620, ownerId: "devi" },
  { id: "n-ledger", name: "Ledger export.archive", kind: "archive", parentId: "f-finance", size: 61_300_000, modified: 1500, ownerId: "devi" },

  // ── Finance / Month end ──
  { id: "n-close-aug", name: "August close.sheet", kind: "sheet", parentId: "f-month-end", size: 1_240_000, modified: 55, ownerId: "priya", sharedWith: ["me", "devi"] },
  { id: "n-close-jul", name: "July close.sheet", kind: "sheet", parentId: "f-month-end", size: 1_180_000, modified: 43_200, ownerId: "priya" },
  { id: "n-checklist", name: "Close checklist.doc", kind: "doc", parentId: "f-month-end", size: 46_000, modified: 70, ownerId: "me" },

  // ── Suppliers ──
  { id: "f-contracts", name: "Contracts", kind: "folder", parentId: "f-suppliers", size: 0, modified: 300, ownerId: "me", sharedWith: ["amara"] },
  { id: "n-supplier-list", name: "Supplier master.sheet", kind: "sheet", parentId: "f-suppliers", size: 2_100_000, modified: 40, ownerId: "me", starred: true },
  { id: "n-onboarding", name: "Onboarding a supplier.doc", kind: "doc", parentId: "f-suppliers", size: 92_000, modified: 1800, ownerId: "amara", sharedWith: ["me"] },
  { id: "n-audit", name: "Quality audit 2026.pdf", kind: "pdf", parentId: "f-suppliers", size: 7_400_000, modified: 5200, ownerId: "amara" },

  // ── Suppliers / Contracts ──
  { id: "n-alpine", name: "Alpine Churn — MSA.pdf", kind: "pdf", parentId: "f-contracts", size: 3_200_000, modified: 320, ownerId: "me" },
  { id: "n-delta", name: "Delta Dairy — MSA.pdf", kind: "pdf", parentId: "f-contracts", size: 2_900_000, modified: 4000, ownerId: "me" },
  { id: "n-cape", name: "Cape Vanilla — amendment.doc", kind: "doc", parentId: "f-contracts", size: 74_000, modified: 90, ownerId: "amara", sharedWith: ["me"] },

  // ── Warehouse ──
  { id: "n-stock", name: "Stock count — week 34.sheet", kind: "sheet", parentId: "f-warehouse", size: 3_600_000, modified: 240, ownerId: "lars", sharedWith: ["me", "omar"] },
  { id: "n-layout", name: "Bergen floor layout.image", kind: "image", parentId: "f-warehouse", size: 8_900_000, modified: 2000, ownerId: "omar" },
  { id: "n-walkthrough", name: "Site walkthrough.video", kind: "video", parentId: "f-warehouse", size: 248_000_000, modified: 6000, ownerId: "omar", sharedWith: ["me", "lars"] },

  // ── Brand assets ──
  { id: "n-logo", name: "Logo pack.archive", kind: "archive", parentId: "f-brand", size: 22_800_000, modified: 4300, ownerId: "amara" },
  { id: "n-palette", name: "Palette.image", kind: "image", parentId: "f-brand", size: 1_100_000, modified: 4400, ownerId: "amara" },
]

/* cloud-hub exposes no storage quota, so these totals describe the offline
 * fixture only and the sidebar hides the meter whenever the library is live. */
export const STORAGE_USED = 6.4 * 1024 ** 3
export const STORAGE_TOTAL = 15 * 1024 ** 3

export const childrenOf = (list: FileNode[], parentId: string) =>
  list.filter((f) => f.parentId === parentId)

/** A folder's size is whatever it contains, all the way down. */
export function sizeOf(list: FileNode[], node: FileNode): number {
  if (node.kind !== "folder") return node.size
  return childrenOf(list, node.id).reduce((sum, child) => sum + sizeOf(list, child), 0)
}

export function countOf(list: FileNode[], folderId: string) {
  return childrenOf(list, folderId).length
}

/** The chain from the root down to a folder, for the breadcrumb. */
export function pathTo(list: FileNode[], folderId: string): FileNode[] {
  const chain: FileNode[] = []
  let current = list.find((f) => f.id === folderId)
  while (current) {
    chain.unshift(current)
    current = current.parentId ? list.find((f) => f.id === current!.parentId) : undefined
  }
  return chain
}

export function formatSize(bytes: number) {
  if (bytes === 0) return "—"
  const units = ["B", "KB", "MB", "GB", "TB"]
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const value = bytes / 1024 ** i
  return `${value >= 100 || i === 0 ? Math.round(value) : value.toFixed(1)} ${units[i]}`
}

export function modifiedLabel(minutes: number) {
  if (minutes < 60) return `${Math.max(1, minutes)}m ago`
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)}h ago`
  const days = Math.round(minutes / (60 * 24))
  if (days < 7) return `${days}d ago`
  const d = new Date(Date.now() - minutes * 60000)
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(d.getFullYear() === new Date().getFullYear() ? {} : { year: "numeric" }),
  })
}

/** Strips the pseudo-extension the fixture uses to carry the kind. Live rows
 *  keep the file name the hub stored, extension and all. */
export const displayName = (node: FileNode) =>
  node.kind === "folder" || node.live
    ? node.name
    : node.name.replace(/\.(doc|sheet|slide|pdf|image|video|archive)$/, "")

export const extensionOf = (node: FileNode) =>
  node.kind === "folder" ? "" : (node.name.split(".").pop() ?? "")
