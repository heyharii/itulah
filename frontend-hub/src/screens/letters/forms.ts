import type { JSONContent } from "@tiptap/react"

import { COMPANY } from "@/screens/finance-lab/print"

/// The letters a person writes (owner, 2026-10-17, letter-writer-prototype.html).
///
/// # Only the ones the system does not write
///
/// A surat jalan, a goods receipt note from receiving and a return note are
/// made by their own flows, from records; they show in the register under
/// "By system" and never in New letter. What is here is the paperwork no
/// record knows about: a BPKB taken to Samsat, a laptop handed to a new admin,
/// a warning letter. So every question is a plain text box and every item is
/// typed — nothing is picked from stock (owner: "semua form itu free text").
///
/// # The two halves
///
/// The details form asks the few things the paper cannot guess, at most two a
/// row. Writing the letter turns them into the paper: the head lines, the
/// opening prose, the items table, the signatures. From then on the paper is
/// the editor. The server knows each form by `key` and numbers it in its own
/// series (`cloud/postgres/letters.rs`, `FORMS`) — keep the two lists alike.

export type LetterGroup = "goods" | "people" | "notices"

export const LETTER_GROUPS: readonly {
  readonly value: LetterGroup
  readonly label: string
}[] = [
  { value: "goods", label: "Goods & documents" },
  { value: "people", label: "People" },
  { value: "notices", label: "Notices & requests" },
]

/// One question in the details form — always a text box.
export interface FormField {
  readonly key: string
  readonly label: string
}

/// A line in the letter's head: the Indonesian label printed on the paper and
/// the fact it shows. A `blank` line is left for the pen or for later; the
/// side lists it under To fill by its English name.
export interface HeadLine {
  readonly key: string
  readonly label: string
  readonly blank?: string
}

/// A signature block: the caption over the line, and the fact that names who
/// signs it (`author` is whoever wrote the letter).
export interface SignBlock {
  readonly caption: string
  readonly name?: string
  readonly role?: string
}

export interface WrittenForm {
  readonly key: string
  readonly group: LetterGroup
  /// What the screen calls it.
  readonly name: string
  /// What the paper calls it.
  readonly paper: string
  /// The details form, a row at a time; never more than two in a row.
  readonly fields: readonly (readonly FormField[])[]
  /// Whether the paper carries a typed table of items.
  readonly items?: boolean
  readonly head: readonly HeadLine[]
  readonly signs: readonly SignBlock[]
  /// The sentence under the items table.
  readonly closing?: string
  /// The opening prose, a paragraph per string, written once from the details.
  readonly prose: (facts: WrittenFacts, author: string) => readonly string[]
  /// The register's second line and its recipient.
  readonly reference: (facts: WrittenFacts) => string
  readonly recipient: (facts: WrittenFacts) => string
}

export type WrittenFacts = Readonly<Record<string, string>>

const TO = { key: "to", label: "To" }
const DATE = { key: "letter_date", label: "Date" }
const EMPLOYEE = { key: "employee", label: "Employee" }
const ROLE = { key: "role", label: "Role" }

/// Lower-case the first letter, so "Perpanjangan STNK" reads inside a sentence.
const low = (text: string) =>
  text === "" ? "…" : text.charAt(0).toLowerCase() + text.slice(1)
const or = (text: string) => (text === "" ? "…" : text)

const LEVEL_WORDS: Readonly<Record<string, string>> = {
  "1": "pertama",
  "2": "kedua",
  "3": "ketiga",
}

/// "SP 1" → "pertama (SP 1)"; anything else is printed as it was typed.
function level(text: string): string {
  const number = /SP\s*([123])/i.exec(text)?.[1]
  return number ? `${LEVEL_WORDS[number]} (SP ${number})` : or(text)
}

export const WRITTEN_FORMS: readonly WrittenForm[] = [
  {
    key: "goods_out",
    group: "goods",
    name: "Goods out letter",
    paper: "Surat Keluar Barang",
    fields: [
      [TO, DATE],
      [
        { key: "from", label: "From" },
        { key: "purpose", label: "Purpose" },
      ],
    ],
    items: true,
    head: [
      { key: "to", label: "Kepada" },
      { key: "letter_date", label: "Tanggal" },
      { key: "from", label: "Dari" },
      { key: "purpose", label: "Keperluan" },
      { key: "carrier", label: "Dibawa oleh", blank: "Carried by" },
      { key: "phone", label: "No. HP", blank: "Carrier's phone" },
    ],
    signs: [
      { caption: "Dikeluarkan oleh", name: "author" },
      { caption: "Dibawa oleh", name: "carrier" },
      { caption: "Diterima oleh" },
    ],
    closing:
      "Mohon barang diperiksa saat diterima, lalu surat ini ditandatangani sebagai tanda terima.",
    prose: (f) => [
      "Dengan hormat,",
      `Bersama surat ini kami keluarkan barang berikut dari ${or(f.from ?? "")} kepada ${or(f.to ?? "")} untuk keperluan ${low(f.purpose ?? "")}:`,
    ],
    reference: (f) => f.purpose ?? "",
    recipient: (f) => f.to ?? "",
  },
  {
    key: "goods_in",
    group: "goods",
    name: "Goods in letter",
    paper: "Surat Terima Barang",
    fields: [
      [{ key: "from", label: "From" }, DATE],
      [
        { key: "to", label: "Received at" },
        { key: "purpose", label: "Purpose" },
      ],
    ],
    items: true,
    head: [
      { key: "from", label: "Dari" },
      { key: "letter_date", label: "Tanggal" },
      { key: "to", label: "Diterima di" },
      { key: "purpose", label: "Keperluan" },
      { key: "giver", label: "Diserahkan oleh", blank: "Handed over by" },
    ],
    signs: [
      { caption: "Diserahkan oleh", name: "giver" },
      { caption: "Diterima oleh", name: "author" },
    ],
    closing:
      "Barang diterima dalam keadaan baik dan lengkap sesuai rincian di atas.",
    prose: (f) => [
      "Dengan hormat,",
      `Telah kami terima dari ${or(f.from ?? "")} di ${or(f.to ?? "")} barang berikut untuk keperluan ${low(f.purpose ?? "")}:`,
    ],
    reference: (f) => f.purpose ?? "",
    recipient: (f) => f.from ?? "",
  },
  {
    key: "handover",
    group: "goods",
    name: "Handover record",
    paper: "Berita Acara Serah Terima",
    fields: [
      [{ key: "to", label: "Handed to" }, DATE],
      [{ key: "purpose", label: "Subject" }],
    ],
    items: true,
    head: [
      { key: "purpose", label: "Perihal" },
      { key: "letter_date", label: "Tanggal" },
    ],
    signs: [
      { caption: "Pihak pertama", name: "author" },
      { caption: "Pihak kedua", name: "to" },
    ],
    closing:
      "Sejak tanggal serah terima, barang tersebut menjadi tanggung jawab pihak kedua.",
    prose: (f, author) => [
      `Pada hari ini, ${or(f.letter_date ?? "")}, yang bertanda tangan di bawah ini:`,
      `Pihak pertama: ${or(author)}`,
      `Pihak kedua: ${or(f.to ?? "")}`,
      "Pihak pertama menyerahkan kepada pihak kedua barang berikut dalam keadaan baik:",
    ],
    reference: (f) => f.purpose ?? "",
    recipient: (f) => f.to ?? "",
  },
  {
    key: "authority",
    group: "goods",
    name: "Authority to collect",
    paper: "Surat Kuasa Pengambilan Barang",
    fields: [
      [{ key: "to", label: "Collect at" }, DATE],
      [{ key: "subject", label: "What to collect" }],
    ],
    head: [
      { key: "to", label: "Kepada" },
      { key: "letter_date", label: "Tanggal" },
      { key: "collector", label: "Penerima kuasa", blank: "Collector" },
      { key: "collector_role", label: "Jabatan", blank: "Collector's role" },
    ],
    signs: [
      { caption: "Pemberi kuasa", name: "author" },
      { caption: "Penerima kuasa", name: "collector" },
    ],
    prose: (f, author) => [
      `Yang bertanda tangan di bawah ini, ${or(author)}, memberikan kuasa kepada penerima kuasa tersebut di atas untuk mengambil ${low(f.subject ?? "")} di ${or(f.to ?? "")} pada tanggal ${or(f.letter_date ?? "")}.`,
      "Demikian surat kuasa ini dibuat untuk dipergunakan sebagaimana mestinya.",
    ],
    reference: (f) => f.subject ?? "",
    recipient: (f) => f.to ?? "",
  },
  {
    key: "assignment",
    group: "people",
    name: "Assignment letter",
    paper: "Surat Tugas",
    fields: [
      [EMPLOYEE, ROLE],
      [
        { key: "subject", label: "Task" },
        { key: "place_to", label: "Place" },
      ],
      [DATE],
    ],
    head: [
      { key: "employee", label: "Nama" },
      { key: "role", label: "Jabatan" },
      { key: "letter_date", label: "Tanggal" },
      { key: "duration", label: "Lama tugas", blank: "Duration" },
    ],
    signs: [
      { caption: "Hormat kami", name: "author" },
      { caption: "Yang ditugaskan", name: "employee", role: "role" },
    ],
    prose: (f) => [
      `Dengan ini kami menugaskan karyawan tersebut di atas untuk melaksanakan ${low(f.subject ?? "")} di ${or(f.place_to ?? "")} mulai tanggal ${or(f.letter_date ?? "")}.`,
      "Demikian surat tugas ini dibuat untuk dilaksanakan dengan penuh tanggung jawab.",
    ],
    reference: (f) => f.subject ?? "",
    recipient: (f) => f.employee ?? "",
  },
  {
    key: "warning",
    group: "people",
    name: "Warning letter",
    paper: "Surat Peringatan",
    fields: [
      [EMPLOYEE, ROLE],
      [
        { key: "subject", label: "Reason" },
        { key: "level", label: "Level" },
      ],
      [DATE],
    ],
    head: [
      { key: "employee", label: "Nama" },
      { key: "role", label: "Jabatan" },
      { key: "letter_date", label: "Tanggal" },
      { key: "incident", label: "Kejadian", blank: "What happened" },
    ],
    signs: [
      { caption: "Hormat kami", name: "author" },
      { caption: "Diterima oleh", name: "employee", role: "role" },
    ],
    prose: (f) => [
      `Surat ini diberikan kepada karyawan tersebut di atas sebagai peringatan ${level(f.level ?? "")} atas ${low(f.subject ?? "")}.`,
      "Peringatan ini berlaku enam bulan sejak tanggal surat. Bila pelanggaran yang sama terulang, perusahaan akan memberikan peringatan berikutnya.",
    ],
    reference: (f) => f.subject ?? "",
    recipient: (f) => f.employee ?? "",
  },
  {
    key: "employment",
    group: "people",
    name: "Employment certificate",
    paper: "Surat Keterangan Kerja",
    fields: [
      [EMPLOYEE, ROLE],
      [{ key: "subject", label: "Purpose" }, DATE],
    ],
    head: [
      { key: "employee", label: "Nama" },
      { key: "role", label: "Jabatan" },
      { key: "start_date", label: "Mulai bekerja", blank: "Start date" },
      { key: "letter_date", label: "Tanggal" },
    ],
    signs: [{ caption: "Hormat kami", name: "author" }],
    prose: (f) => [
      `Yang bertanda tangan di bawah ini menerangkan bahwa karyawan tersebut di atas adalah benar karyawan ${COMPANY.name} yang masih aktif bekerja hingga surat ini dibuat.`,
      `Surat keterangan ini dibuat untuk keperluan ${low(f.subject ?? "")}.`,
    ],
    reference: (f) => f.subject ?? "",
    recipient: (f) => f.employee ?? "",
  },
  {
    key: "notice",
    group: "notices",
    name: "Notice",
    paper: "Surat Pemberitahuan",
    fields: [[TO, DATE], [{ key: "subject", label: "Subject" }]],
    head: [
      { key: "to", label: "Kepada" },
      { key: "letter_date", label: "Tanggal" },
      { key: "subject", label: "Perihal" },
    ],
    signs: [{ caption: "Hormat kami", name: "author" }],
    prose: (f) => [
      "Dengan hormat,",
      `Bersama ini kami sampaikan ${low(f.subject ?? "")}.`,
      "Atas perhatiannya kami ucapkan terima kasih.",
    ],
    reference: (f) => f.subject ?? "",
    recipient: (f) => f.to ?? "",
  },
  {
    key: "request",
    group: "notices",
    name: "Request",
    paper: "Surat Permohonan",
    fields: [[TO, DATE], [{ key: "subject", label: "Subject" }]],
    head: [
      { key: "to", label: "Kepada" },
      { key: "letter_date", label: "Tanggal" },
      { key: "subject", label: "Perihal" },
    ],
    signs: [{ caption: "Hormat kami", name: "author" }],
    prose: (f) => [
      "Dengan hormat,",
      `Dengan ini kami mengajukan permohonan ${low(f.subject ?? "")}.`,
      "Atas perhatian dan kerja samanya kami ucapkan terima kasih.",
    ],
    reference: (f) => f.subject ?? "",
    recipient: (f) => f.to ?? "",
  },
  {
    key: "blank",
    group: "notices",
    name: "Blank letter",
    paper: "Surat",
    fields: [[TO, DATE], [{ key: "subject", label: "Subject" }]],
    head: [
      { key: "to", label: "Kepada" },
      { key: "letter_date", label: "Tanggal" },
      { key: "subject", label: "Perihal" },
    ],
    signs: [{ caption: "Hormat kami", name: "author" }],
    prose: () => ["Dengan hormat,", ""],
    reference: (f) => f.subject ?? "",
    recipient: (f) => f.to ?? "",
  },
]

export function writtenForm(key: unknown): WrittenForm | undefined {
  return typeof key === "string"
    ? WRITTEN_FORMS.find((form) => form.key === key)
    : undefined
}

/// One row of a written letter's items table — typed, never a stock line.
export interface WrittenItem {
  /// Steady across edits, so a row keeps its own text when one above it goes.
  readonly id: string
  readonly name: string
  readonly quantity: string
  readonly unit: string
  readonly note: string
}

export function newItem(): WrittenItem {
  return {
    id: Math.random().toString(36).slice(2, 10),
    name: "",
    quantity: "1",
    unit: "pcs",
    note: "",
  }
}

/// The items off `facts.items`, read defensively: facts are `unknown` on the
/// wire.
export function itemsOf(facts: unknown): WrittenItem[] {
  const raw = (facts as Record<string, unknown> | null)?.items
  if (!Array.isArray(raw)) return []
  return raw.flatMap((one, index): WrittenItem[] => {
    if (typeof one !== "object" || one === null) return []
    const row = one as Record<string, unknown>
    const text = (key: string) =>
      typeof row[key] === "string"
        ? (row[key] as string)
        : typeof row[key] === "number"
          ? String(row[key])
          : ""
    return [
      {
        id: text("id") || `row-${index}`,
        name: text("name"),
        quantity: text("quantity"),
        unit: text("unit"),
        note: text("note"),
      },
    ]
  })
}

/// Every string fact, for the form's own sentences.
export function writtenFacts(facts: unknown): WrittenFacts {
  if (typeof facts !== "object" || facts === null) return {}
  return Object.fromEntries(
    Object.entries(facts as Record<string, unknown>).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string"
    )
  )
}

/// The opening prose as an editor document, a paragraph per sentence.
export function proseDocument(paragraphs: readonly string[]): JSONContent {
  return {
    type: "doc",
    content: paragraphs.map((text) =>
      text === ""
        ? { type: "paragraph" }
        : { type: "paragraph", content: [{ type: "text", text }] }
    ),
  }
}

/// What the register reads off a written letter — its second line, who it
/// is to, and how many items — kept on the facts the list already shows.
export function registerFacts(
  form: WrittenForm,
  facts: WrittenFacts,
  items: readonly WrittenItem[]
): Record<string, unknown> {
  return {
    reference: form.reference(facts),
    counterparty: form.recipient(facts),
    quantity: form.items
      ? items.filter((item) => item.name.trim() !== "").length
      : 0,
  }
}
