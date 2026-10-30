import { blankDetails } from "@/lib/queries/papers"
import type {
  EmployeeDetails,
  EmployeeDossierView,
  PersonalChanges,
} from "@itulah/contract"

/// A person's file as a form holds it — shared by *New Employee* (a hire
/// proposal's dossier) and *Change Data* (a data update on an existing
/// employee). The form itself is `person-form.tsx`; this is what it edits.
///
/// Apart from the form because that one exports components, and a file that
/// exports both cannot be hot-reloaded as a component module.

export const BLOOD_TYPES = ["A", "B", "AB", "O"] as const

export interface PersonalDraft {
  full_name: string
  nik: string
  birth_date: string
  address: string
  phone: string
  email: string
  details: EmployeeDetails
  /// The scans picked, by kind.
  papers: Record<string, File | undefined>
}

export function blankDraft(): PersonalDraft {
  return {
    full_name: "",
    nik: "",
    birth_date: "",
    address: "",
    phone: "",
    email: "",
    details: blankDetails(),
    papers: {},
  }
}

/// The file as it stands, so a change starts from what head office holds.
export function draftOf(
  dossier: EmployeeDossierView | undefined,
): PersonalDraft {
  return {
    full_name: dossier?.personal?.full_name ?? "",
    nik: dossier?.personal?.nik ?? "",
    birth_date: dossier?.personal?.birth_date ?? "",
    address: dossier?.personal?.address ?? "",
    phone: dossier?.personal?.phone ?? "",
    email: dossier?.personal?.email ?? "",
    details: dossier?.details?.details ?? blankDetails(),
    papers: {},
  }
}

const PERSONAL_KEYS = [
  "full_name",
  "nik",
  "birth_date",
  "address",
  "phone",
  "email",
] as const satisfies readonly (keyof PersonalChanges)[]

/// What a draft changes against the file it started from: the personal fields
/// that differ (the rest are `null` and left alone), and whether the detail set
/// differs — it goes as one revision.
export function changesOf(
  draft: PersonalDraft,
  original: PersonalDraft,
): { personal: PersonalChanges; touched: number; detailsChanged: boolean } {
  const personal: PersonalChanges = {
    full_name: null,
    nik: null,
    birth_date: null,
    address: null,
    phone: null,
    email: null,
  }
  let touched = 0
  for (const key of PERSONAL_KEYS) {
    if (draft[key] !== original[key]) {
      personal[key] = draft[key]
      touched += 1
    }
  }
  return {
    personal,
    touched,
    detailsChanged:
      JSON.stringify(draft.details) !== JSON.stringify(original.details),
  }
}

/// The detail set is one revision: the card's own four and the birth place go
/// together, and an emergency contact is a name with a number.
export function detailsIncomplete(details: EmployeeDetails): boolean {
  const named = (details.emergency_name ?? "").trim() !== ""
  const rung = (details.emergency_phone ?? "").trim() !== ""
  return (
    details.birth_place.trim() === "" ||
    details.gender === "" ||
    details.religion === "" ||
    details.marital_status === "" ||
    named !== rung
  )
}

/// The scans picked, as the list a filing uploads.
export function pickedScans(
  papers: PersonalDraft["papers"],
): { kind: string; file: File }[] {
  return Object.entries(papers).flatMap(([kind, file]) =>
    file === undefined ? [] : [{ kind, file }],
  )
}
