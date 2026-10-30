import { useQuery } from "@tanstack/react-query"

import { CENTRAL_KEY_PREFIX, cloud } from "@/lib/cloud"
import type {
  DocumentFiling,
  EmployeeDataUpdateView,
  EmployeeDetails,
  EmployeeDocumentView,
  EmployeeDossierView,
  FileDataUpdateBody,
  HireDossierView,
  SaveHireDossierBody,
  StoredFile,
} from "@itulah/contract"

/// A person's papers, from the shop (1001; owner, 2026-10-25: "create
/// karyawan profile, approve by HO", "ngedit data bisa toko, approval HO").
///
/// The shop reads its own people's file and keys in two kinds of filing, both
/// answered at head office: a new hire's dossier on their hire proposal, and a
/// change to an existing employee's data. Everything goes through this node's
/// relay (`lib/cloud.ts`), bounded to this node's place at the centre. The
/// scans' bytes go up but never come back down: a till files papers, it does
/// not browse them.

const enc = encodeURIComponent

export const papersKeys = {
  all: () => [CENTRAL_KEY_PREFIX, "papers"] as const,
  dossier: (employeeId: string) =>
    [CENTRAL_KEY_PREFIX, "papers", "dossier", employeeId] as const,
  hire: (proposalId: string) =>
    [CENTRAL_KEY_PREFIX, "papers", "hire", proposalId] as const,
}

/// `GET /api/v1/employees/{id}/dossier`
export function readDossier(
  employeeId: string,
  signal?: AbortSignal,
): Promise<EmployeeDossierView> {
  return cloud.get<EmployeeDossierView>(
    `/api/v1/employees/${enc(employeeId)}/dossier`,
    { signal },
  )
}

export function useDossier(employeeId: string | null) {
  return useQuery({
    queryKey: papersKeys.dossier(employeeId ?? ""),
    queryFn: ({ signal }) => readDossier(employeeId ?? "", signal),
    enabled: employeeId !== null,
  })
}

/// `POST /api/v1/employees/{id}/data-updates` — waits on head office.
export function fileDataUpdate(
  employeeId: string,
  body: FileDataUpdateBody,
): Promise<EmployeeDataUpdateView> {
  return cloud.post<EmployeeDataUpdateView>(
    `/api/v1/employees/${enc(employeeId)}/data-updates`,
    body,
  )
}

/// The filer takes their change back while it waits; its scans go with it.
export function withdrawDataUpdate(
  id: string,
  reason: string,
): Promise<EmployeeDataUpdateView> {
  return cloud.post<EmployeeDataUpdateView>(
    `/api/v1/data-updates/${enc(id)}/withdrawal`,
    { reason },
  )
}

/// `GET /api/v1/hire-proposals/{id}/dossier`
export function readHireDossier(
  proposalId: string,
  signal?: AbortSignal,
): Promise<HireDossierView> {
  return cloud.get<HireDossierView>(
    `/api/v1/hire-proposals/${enc(proposalId)}/dossier`,
    { signal },
  )
}

export function useHireDossier(proposalId: string | null) {
  return useQuery({
    queryKey: papersKeys.hire(proposalId ?? ""),
    queryFn: ({ signal }) => readHireDossier(proposalId ?? "", signal),
    enabled: proposalId !== null,
  })
}

/// Key in the new hire's personal data and scans, while head office has not
/// answered the proposal yet. `PUT /api/v1/hire-proposals/{id}/dossier`
export function saveHireDossier(
  proposalId: string,
  body: SaveHireDossierBody,
): Promise<HireDossierView> {
  return cloud.put<HireDossierView>(
    `/api/v1/hire-proposals/${enc(proposalId)}/dossier`,
    body,
  )
}

/// Take back a scan still waiting with a proposal or a change.
export function removePaper(
  documentId: string,
  reason: string,
): Promise<EmployeeDocumentView[]> {
  return cloud.post<EmployeeDocumentView[]>(
    `/api/v1/employee-documents/${enc(documentId)}/removal`,
    { reason },
  )
}

/// The longest side a photographed scan keeps. A phone's 12-megapixel photo
/// of a KTP reads as well at this size and goes up in a second, not twenty.
const SCAN_EDGE = 2000

/// A photo, shrunk to `SCAN_EDGE` as a JPEG; a PDF or a small image as it
/// came. The relay carries at most 8 MiB.
export async function shrinkScan(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.size < 1_500_000) return file
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, SCAN_EDGE / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement("canvas")
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    canvas
      .getContext("2d")
      ?.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.85),
    )
    if (!blob) return file
    const name = file.name.replace(/\.[^.]+$/, "") + ".jpg"
    return new File([blob], name, { type: "image/jpeg" })
  } catch {
    return file
  }
}

/// Bytes first, through the relay: the answer's `file_id` is then named in a
/// filing.
export async function uploadPaper(file: File): Promise<StoredFile> {
  const scan = await shrinkScan(file)
  const params = new URLSearchParams({ name: scan.name })
  if (scan.type !== "") params.set("type", scan.type)
  return cloud.upload<StoredFile>(`/api/v1/files?${params.toString()}`, scan)
}

/// Upload each picked file, then name them for a filing.
export async function uploadPapers(
  picked: readonly { kind: string; file: File }[],
): Promise<DocumentFiling[]> {
  const filed: DocumentFiling[] = []
  for (const { kind, file } of picked) {
    const stored = await uploadPaper(file)
    filed.push({ kind, file_id: stored.file_id })
  }
  return filed
}

/// The papers a shop keys in, in the order the form asks. KTP and KK are
/// required (owner, 2026-10-25).
export const PAPER_KINDS: readonly {
  readonly kind: string
  readonly label: string
  readonly required: boolean
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

export function wordFor(
  list: readonly { readonly value: string; readonly label: string }[],
  code: string | null | undefined,
): string {
  if (!code) return ""
  return list.find((entry) => entry.value === code)?.label ?? code
}

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

/// The rule number the roster is held to (`hr_policy`, 1001).
export const MIN_WEEKLY_HOURS_KEY = "roster.min_weekly_hours"
