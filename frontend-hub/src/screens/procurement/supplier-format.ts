/// How a supplier's facts are written — shared by the supplier screen, the
/// order composer's quick add, and anything that prints a supplier's name.

/// The legal forms a supplier may name, as the server's CHECK allows them.
export const LEGAL_FORMS = ["PT", "CV", "UD"] as const

/// The name as the company writes it on its own paperwork: the legal form
/// after the name, "Sepatu Sejahtera, CV". A supplier nobody has given a legal
/// form to is just its name.
export function supplierDisplayName(supplier: {
  readonly name: string
  readonly legal_form?: string | null
}): string {
  const form = supplier.legal_form?.trim()
  return form ? `${supplier.name}, ${form}` : supplier.name
}

/// A phone number grouped as it is read aloud: `0887 7993 12312`.
///
/// Four, four, then the rest — the owner's format (2026-09-26). A leading `+`
/// is kept for a number written with its country code. Everything else that
/// is not a digit is dropped as it is typed, so the box never holds a letter.
export function formatPhone(value: string): string {
  const plus = value.trimStart().startsWith("+")
  const digits = value.replace(/\D/g, "").slice(0, 15)
  const groups = [digits.slice(0, 4), digits.slice(4, 8), digits.slice(8)]
  return (plus ? "+" : "") + groups.filter((part) => part !== "").join(" ")
}

/// What is wrong with a phone number, in a sentence, or null.
///
/// Shape, not existence: nothing here can tell whether a number rings. What it
/// catches is a run of digits too short or too long to be any Indonesian
/// number — a mobile is 10-13 digits, a landline with its area code 8-11, and
/// `+62` adds two.
export function phoneProblem(value: string): string | null {
  const text = value.trim()
  if (text === "") return null
  const digits = text.replace(/\D/g, "")
  if (digits.length < 8) return "That is too short for a phone number."
  if (digits.length > 15) return "That is too long for a phone number."
  return null
}

/// An NPWP as the tax office writes it now: sixteen digits and nothing else.
///
/// PMK 112/PMK.03/2022: since 14 July 2022 (and for every service since
/// 1 July 2024) an NPWP is 16 digits with no dots or dashes — an individual's
/// is their NIK, and a company's is its old 15-digit NPWP with a 0 in front
/// (`01.234.567.8-901.000` becomes `0012345678901000`). Anything that is not a
/// digit is dropped as it is typed, so a number pasted off an old faktur in
/// the dotted shape lands as digits.
export function formatNpwp(value: string): string {
  return value.replace(/\D/g, "").slice(0, 16)
}

/// An old 15-digit NPWP, finished off as the 16-digit one it now is: a 0 in
/// front. Applied when the box is left, not while typing — fifteen digits is
/// also where a sixteen-digit number is one keystroke from done.
export function completeNpwp(value: string): string {
  const digits = formatNpwp(value)
  return digits.length === 15 ? `0${digits}` : digits
}

export function npwpProblem(value: string): string | null {
  const digits = value.replace(/\D/g, "")
  if (digits === "") return null
  if (digits.length !== 16)
    return "An NPWP has 16 digits — an old 15-digit one gets a 0 in front."
  return null
}

/// The same for an email address: one @, something on each side of it, and a
/// dot in the domain. Deliberately not RFC 5322 — this catches the two
/// mistakes people make, the missing @ and the truncated domain.
export function emailProblem(value: string): string | null {
  const text = value.trim()
  if (text === "") return null
  if (/\s/.test(text)) return "An email address has no spaces in it."
  if (!/^[^@]+@[^@]+$/.test(text))
    return "An email address carries one @, with a name and a domain around it."
  const domain = text.slice(text.indexOf("@") + 1)
  if (!domain.includes(".") || domain.startsWith(".") || domain.endsWith("."))
    return "The domain looks unfinished — orders@sinartekstil.co.id."
  return null
}
