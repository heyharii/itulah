/// How a supplier's facts are written — shared by the supplier screen, the
/// order composer's quick add, and anything that prints a supplier's name.

/// The legal forms a supplier may name, as the server's CHECK allows them.
export const LEGAL_FORMS = ["PT", "CV", "UD"] as const

/// A name or an address as it is typed into a form: the first letter of every
/// word capitalised, and nothing else touched. "riyu style" becomes "Riyu
/// Style", while "PT Maju" and "CV" keep the capitals they were typed with —
/// lower-casing the rest would turn them into "Pt" and "Cv". A word starts
/// after a space, a line break, a hyphen, a slash or an opening bracket. The
/// result is exactly as long as the input, so a caret held in the box stays put.
export function titleCaseTyping(value: string): string {
  return value.replace(
    /(^|[\s\-/(])(\p{L})/gu,
    (_match, edge: string, letter: string) =>
      edge + letter.toLocaleUpperCase("id-ID")
  )
}

/// Prose as it is typed: the first letter capital and the rest as written, so
/// a description starts like a sentence without every word being shouted.
export function capitaliseFirst(value: string): string {
  return value.replace(
    /^(\s*)(\p{L})/u,
    (_match, space: string, letter: string) =>
      space + letter.toLocaleUpperCase("id-ID")
  )
}

/// The value of a text box, written in Title Case as it is typed. The box is
/// controlled, so setting a differently-cased value would throw the caret to
/// the end; the case change never moves a character, so the caret is put back
/// where it was a frame later.
export function titled(
  event: { target: HTMLInputElement | HTMLTextAreaElement },
  apply: (value: string) => void,
  shape: (value: string) => string = titleCaseTyping
) {
  const box = event.target
  const { selectionStart, selectionEnd } = box
  apply(shape(box.value))
  requestAnimationFrame(() => {
    if (document.activeElement === box && selectionStart !== null)
      box.setSelectionRange(selectionStart, selectionEnd)
  })
}

/// The name as the company writes it on its own paperwork: the legal form
/// after the name, "Sepatu Sejahtera, CV". A supplier nobody has given a legal
/// form to is just its name.
export function supplierDisplayName(supplier: {
  readonly name: string
  readonly legal_form?: string | null
}): string {
  return withLegalForm(supplier.name, supplier.legal_form)
}

/// A bare name with its legal form after a comma. Safe on a name that already
/// carries one ("Maju Jaya, UD" stays as it is), and a missing form leaves the
/// name alone — never a trailing comma.
export function withLegalForm(
  name: string,
  legalForm: string | null | undefined
): string {
  const form = legalForm?.trim()
  if (!form || name.trim() === "") return name
  if (/,\s*(PT|CV|UD)\.?\s*$/i.test(name)) return name
  return `${name.trimEnd()}, ${form}`
}

type BookEntry = {
  readonly supplier_id: string
  readonly supplier_code: string
  readonly name: string
  readonly legal_form?: string | null
}

// Query results are immutable snapshots. Share one index per snapshot across
// cells and screens; a refetched book gets a new index, and old books can be
// collected. Names shared by two suppliers stay ambiguous.
const supplierIndexes = new WeakMap<
  readonly BookEntry[],
  {
    references: Map<string, BookEntry>
    names: Map<string, BookEntry | undefined>
  }
>()

function supplierIndex(book: readonly BookEntry[]) {
  const cached = supplierIndexes.get(book)
  if (cached !== undefined) return cached
  const references = new Map<string, BookEntry>()
  const names = new Map<string, BookEntry | undefined>()
  for (const entry of book) {
    // Preserve the first matching row if a code happens to equal another id.
    for (const reference of [entry.supplier_id, entry.supplier_code]) {
      if (!references.has(reference)) references.set(reference, entry)
    }
    const name = entry.name.trim().toLowerCase()
    names.set(name, names.has(name) ? undefined : entry)
  }
  const index = { references, names }
  supplierIndexes.set(book, index)
  return index
}

/// The supplier book entry a row points at: by register id or code first, and
/// for a row that carries only a bare name (an accrual, a giro's payee), the
/// one entry that bears that name. Two suppliers sharing a bare name are not
/// guessed between.
export function findSupplier<T extends BookEntry>(
  book: readonly T[],
  reference: string | null | undefined,
  name?: string | null
): T | undefined {
  const index = supplierIndex(book)
  if (reference != null && reference !== "") {
    const byRef = index.references.get(reference) as T | undefined
    if (byRef !== undefined) return byRef
  }
  const bare = (name ?? reference ?? "").trim().toLowerCase()
  if (bare === "") return undefined
  return index.names.get(bare) as T | undefined
}

/// A reference (and the bare name the row carried) written in full; the bare
/// name, else the reference, when the book does not know the supplier.
export function supplierLabel(
  book: readonly BookEntry[],
  reference: string | null | undefined,
  fallback?: string | null
): string {
  const found = findSupplier(book, reference, fallback)
  if (found !== undefined) return supplierDisplayName(found)
  return fallback ?? reference ?? "—"
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

/// A supplier's numbers are kept in the one `phone` column, separated by
/// commas ("0812 3456 7890, 021 5551 2345"), so a company can be reached on
/// several without a second table. The form edits them one to a row.
export function splitPhones(value: string): string[] {
  return value.split(/[,;\n]/).map((part) => part.trim())
}

/// The numbers as they are stored and shown: each one grouped, none empty.
export function formatPhones(value: string): string {
  return splitPhones(value)
    .filter((part) => part !== "")
    .map(formatPhone)
    .join(", ")
}

/// The first thing wrong with any of the numbers, or null.
export function phonesProblem(value: string): string | null {
  for (const one of splitPhones(value)) {
    const problem = phoneProblem(one)
    if (problem !== null) return problem
  }
  return null
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

/// An NPWP's sixteen digits, and nothing else — what is stored and sent.
///
/// PMK 112/PMK.03/2022: since 14 July 2022 (and for every service since
/// 1 July 2024) an NPWP is 16 digits — an individual's is their NIK, and a
/// company's is its old 15-digit NPWP with a 0 in front
/// (`01.234.567.8-901.000` becomes `0012345678901000`). The dots below are
/// for reading only; the record keeps the digits, so a tax export never has
/// to take them back out.
export function npwpDigits(value: string): string {
  return value.replace(/\D/g, "").slice(0, 16)
}

/// An NPWP grouped for reading, as it is typed: `0012.3456.7890.1000`.
///
/// Four and four, dotted — the owner asked for the number tidied as it is
/// typed (2026-09-28), and sixteen digits in a run is a number nobody can
/// check against a card. Anything that is not a digit is dropped, so a number
/// pasted off an old faktur in the `01.234.567.8-901.000` shape is regrouped.
export function formatNpwp(value: string): string {
  const digits = npwpDigits(value)
  return (digits.match(/.{1,4}/g) ?? []).join(".")
}

/// An old 15-digit NPWP, finished off as the 16-digit one it now is: a 0 in
/// front. Applied when the box is left, not while typing — fifteen digits is
/// also where a sixteen-digit number is one keystroke from done.
export function completeNpwp(value: string): string {
  const digits = npwpDigits(value)
  return formatNpwp(digits.length === 15 ? `0${digits}` : digits)
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
