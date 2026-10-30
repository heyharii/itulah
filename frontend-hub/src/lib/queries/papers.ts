import { queryOptions, useQuery } from "@tanstack/react-query"

import { node } from "@/lib/api"
import type {
  DecideDataUpdateBody,
  DocumentFiling,
  EmployeeDataUpdateView,
  EmployeeDetails,
  EmployeeDocumentView,
  EmployeeDossierView,
  FileDataUpdateBody,
  FileDocumentsBody,
  HireDossierView,
  SaveDetailsBody,
  SaveHireDossierBody,
  StoredFile,
} from "@itulah/contract"

/// A person's papers (1001): the file in one read — personal data, the detail
/// set, the scans, the store's changes — and the acts on it. Head office
/// writes directly; a store's change waits here for head office to take.
///
/// `cloud/http/dossier.rs` is the server's half.

const enc = encodeURIComponent

export const papersKeys = {
  all: () => ["people", "papers"] as const,
  dossier: (employeeId: string) =>
    ["people", "papers", "dossier", employeeId] as const,
  updatesAll: () => ["people", "papers", "updates"] as const,
  updates: (all: boolean) => ["people", "papers", "updates", all] as const,
  hire: (proposalId: string) =>
    ["people", "papers", "hire", proposalId] as const,
}

// ── a person's file ─────────────────────────────────────────────────────────

/// `GET /api/v1/employees/{id}/dossier`
export function readDossier(
  employeeId: string,
  signal?: AbortSignal
): Promise<EmployeeDossierView> {
  return node.get<EmployeeDossierView>(
    `/api/v1/employees/${enc(employeeId)}/dossier`,
    { signal }
  )
}

export const dossierQuery = (employeeId: string) =>
  queryOptions({
    queryKey: papersKeys.dossier(employeeId),
    queryFn: ({ signal }) => readDossier(employeeId, signal),
  })

export function useDossier(employeeId: string | null) {
  return useQuery({
    ...dossierQuery(employeeId ?? ""),
    enabled: employeeId !== null,
  })
}

/// Head office writes the detail set directly, as a new revision.
/// `PUT /api/v1/employees/{id}/details`
export function saveDetails(
  employeeId: string,
  body: SaveDetailsBody
): Promise<EmployeeDossierView> {
  return node.put<EmployeeDossierView>(
    `/api/v1/employees/${enc(employeeId)}/details`,
    body
  )
}

/// Bytes first, as their own step: the answer's `file_id` is then named in a
/// filing. Name and type travel as query parameters (`cloud/http/files.rs`).
export function uploadPaper(file: File): Promise<StoredFile> {
  const params = new URLSearchParams({ name: file.name })
  if (file.type !== "") params.set("type", file.type)
  return node.upload<StoredFile>(`/api/v1/files?${params.toString()}`, file)
}

/// Head office puts papers straight onto the file; each replaces the one of
/// its kind in force. `POST /api/v1/employees/{id}/documents`
export function fileDocuments(
  employeeId: string,
  body: FileDocumentsBody
): Promise<EmployeeDossierView> {
  return node.post<EmployeeDossierView>(
    `/api/v1/employees/${enc(employeeId)}/documents`,
    body
  )
}

/// A scan's bytes, for an `<img>` or a new tab through an object URL — the
/// route is behind the session, so a plain link cannot reach it.
export function paperBlob(documentId: string): Promise<Blob> {
  return node.download(`/api/v1/employee-documents/${enc(documentId)}/content`)
}

/// Take back a scan still waiting with a proposal or a change.
export function removePaper(
  documentId: string,
  reason: string
): Promise<EmployeeDocumentView[]> {
  return node.post<EmployeeDocumentView[]>(
    `/api/v1/employee-documents/${enc(documentId)}/removal`,
    { reason }
  )
}

// ── a store's change, and head office's answer ──────────────────────────────

/// `POST /api/v1/employees/{id}/data-updates`
export function fileDataUpdate(
  employeeId: string,
  body: FileDataUpdateBody
): Promise<EmployeeDataUpdateView> {
  return node.post<EmployeeDataUpdateView>(
    `/api/v1/employees/${enc(employeeId)}/data-updates`,
    body
  )
}

/// Head office's queue, within the caller's reach. `GET /api/v1/data-updates`
export function listDataUpdates(
  all: boolean,
  signal?: AbortSignal
): Promise<EmployeeDataUpdateView[]> {
  return node.get<EmployeeDataUpdateView[]>(
    `/api/v1/data-updates${all ? "?all=true" : ""}`,
    { signal }
  )
}

export function useDataUpdates(all: boolean, enabled = true) {
  return useQuery({
    queryKey: papersKeys.updates(all),
    queryFn: ({ signal }) => listDataUpdates(all, signal),
    enabled,
  })
}

export function decideDataUpdate(
  id: string,
  body: DecideDataUpdateBody
): Promise<EmployeeDataUpdateView> {
  return node.post<EmployeeDataUpdateView>(
    `/api/v1/data-updates/${enc(id)}/decision`,
    body
  )
}

export function withdrawDataUpdate(
  id: string,
  reason: string
): Promise<EmployeeDataUpdateView> {
  return node.post<EmployeeDataUpdateView>(
    `/api/v1/data-updates/${enc(id)}/withdrawal`,
    { reason }
  )
}

// ── a new hire's dossier, on their proposal ─────────────────────────────────

/// `GET /api/v1/hire-proposals/{id}/dossier`
export function readHireDossier(
  proposalId: string,
  signal?: AbortSignal
): Promise<HireDossierView> {
  return node.get<HireDossierView>(
    `/api/v1/hire-proposals/${enc(proposalId)}/dossier`,
    { signal }
  )
}

export function useHireDossier(proposalId: string | null) {
  return useQuery({
    queryKey: papersKeys.hire(proposalId ?? ""),
    queryFn: ({ signal }) => readHireDossier(proposalId ?? "", signal),
    enabled: proposalId !== null,
  })
}

/// `PUT /api/v1/hire-proposals/{id}/dossier`
export function saveHireDossier(
  proposalId: string,
  body: SaveHireDossierBody
): Promise<HireDossierView> {
  return node.put<HireDossierView>(
    `/api/v1/hire-proposals/${enc(proposalId)}/dossier`,
    body
  )
}

// ── the words ───────────────────────────────────────────────────────────────

/// The papers on a file, in the order the page lists them. KTP and KK are
/// required (owner, 2026-10-25); the server says which are missing.
export const PAPER_KINDS: readonly {
  readonly kind: string
  readonly label: string
  readonly required: boolean
  /// What the kind takes: a photo is an image, every other paper an image
  /// or a PDF (`DocumentKind::accepts`).
  readonly accept: string
}[] = [
  { kind: "PHOTO", label: "Photo", required: false, accept: "image/*" },
  {
    kind: "KTP",
    label: "KTP scan",
    required: true,
    accept: "image/*,application/pdf",
  },
  {
    kind: "KK",
    label: "KK scan",
    required: true,
    accept: "image/*,application/pdf",
  },
  {
    kind: "SKCK",
    label: "SKCK",
    required: false,
    accept: "image/*,application/pdf",
  },
  {
    kind: "CONTRACT",
    label: "Signed contract",
    required: false,
    accept: "image/*,application/pdf",
  },
  {
    kind: "NPWP",
    label: "NPWP card",
    required: false,
    accept: "image/*,application/pdf",
  },
  {
    kind: "BPJS",
    label: "BPJS card",
    required: false,
    accept: "image/*,application/pdf",
  },
]

export const GENDERS = [
  { value: "FEMALE", label: "Female" },
  { value: "MALE", label: "Male" },
] as const

export const RELIGIONS = [
  { value: "ISLAM", label: "Islam" },
  { value: "CHRISTIAN", label: "Christian" },
  { value: "CATHOLIC", label: "Catholic" },
  { value: "HINDU", label: "Hindu" },
  { value: "BUDDHIST", label: "Buddhist" },
  { value: "CONFUCIAN", label: "Confucian" },
  { value: "OTHER", label: "Other" },
] as const

export const MARITAL = [
  { value: "SINGLE", label: "Single" },
  { value: "MARRIED", label: "Married" },
  { value: "DIVORCED", label: "Divorced" },
  { value: "WIDOWED", label: "Widowed" },
] as const

export const BLOOD_TYPES = ["A", "B", "AB", "O"] as const

/// The word for a code from one of the lists above; the code itself when the
/// list has not been taught it.
export function wordFor(
  list: readonly { readonly value: string; readonly label: string }[],
  code: string | null | undefined
): string {
  if (!code) return ""
  return list.find((entry) => entry.value === code)?.label ?? code
}

/// A blank set for a form that has none yet.
export function blankDetails(): EmployeeDetails {
  return {
    birth_place: "",
    gender: "",
    religion: "",
    marital_status: "",
    children: 0,
    blood_type: null,
    nationality: "WNI",
    rt_rw: null,
    village: null,
    district: null,
    city: null,
    province: null,
    emergency_name: null,
    emergency_relation: null,
    emergency_phone: null,
  }
}

/// Upload each picked file, then name them for a filing.
export async function uploadPapers(
  picked: readonly { kind: string; file: File }[]
): Promise<DocumentFiling[]> {
  const filed: DocumentFiling[] = []
  for (const { kind, file } of picked) {
    const stored = await uploadPaper(file)
    filed.push({ kind, file_id: stored.file_id })
  }
  return filed
}

/// The rule number the roster is held to (`hr_policy`, 1001).
export const MIN_WEEKLY_HOURS_KEY = "roster.min_weekly_hours"
