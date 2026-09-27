import { node } from "@/lib/api"
import type {
  LetterDetail,
  LetterEdit,
  LetterList,
  LetterSource,
  LetterTemplate,
  NewLetter,
  NewTemplate,
  VoidLetter,
} from "@itulah/contract"

/// Letters — the paperwork somebody signs.
///
/// Two kinds today, both drawn from records the centre already holds: a goods
/// receipt note against a supplier's delivery (surat terima barang) and a
/// delivery note against an allotment going out to a shop (surat jalan).
///
/// The shapes are generated from `cloud/postgres/letters.rs`, so nothing here
/// re-declares them. What this file adds is the vocabulary the screens speak:
/// which kinds exist, what each is called on paper, and the keys the cache is
/// filed under.

export type LetterKind = "GOODS_RECEIPT" | "DELIVERY_NOTE" | "GENERAL"
export type LetterStatus = "DRAFT" | "ISSUED" | "VOID"

/// What each kind is called, and what its series is.
///
/// The names are Indonesian because the documents are: a warehouse clerk looks
/// for "Surat Jalan" in the folder, not for "delivery note", and the number
/// printed on it starts with the same letters as the name they filed it under.
/// `appLabel` is the separate English name the screen CHROME uses instead —
/// the register row, the kind filter — because the owner asked GA's screens to
/// read in English (2026-09-27) while what prints stays Indonesian for the
/// supplier, driver or store holding the paper.
export const LETTER_KINDS: readonly {
  readonly value: LetterKind
  readonly label: string
  readonly english: string
  readonly appLabel: string
  readonly prefix: string
  /// What it is drawn from, said the way somebody picking one would say it.
  readonly source: string
}[] = [
  {
    value: "GOODS_RECEIPT",
    label: "Surat Terima Barang",
    english: "Goods receipt note",
    appLabel: "Goods receipt note",
    prefix: "STB",
    source: "a delivery a DC has counted against a purchase order",
  },
  {
    value: "DELIVERY_NOTE",
    label: "Surat Jalan",
    english: "Delivery note",
    appLabel: "Delivery note",
    prefix: "SJ",
    source: "an allotment going out to a shop",
  },
  {
    value: "GENERAL",
    label: "Surat",
    english: "Blank letter",
    appLabel: "Letter",
    prefix: "SRT",
    // The only one written from nothing. Most of a company's letters are this
    // kind — a covering note, a letter appointing somebody to collect goods —
    // and none of them has a row to be drawn from.
    source: "nothing — you write the whole of it",
  },
]

/// Whether this kind is drawn from a record at all.
export function drawnFromRecord(kind: LetterKind): boolean {
  return kind !== "GENERAL"
}

export function letterKind(kind: string): string {
  return LETTER_KINDS.find((one) => one.value === kind)?.label ?? kind
}

/// The kind, in the app's own English — for the register row, the kind
/// filter, and anywhere else the SCREEN names a letter rather than the paper.
/// `letterKind` above is what the paper prints, in Indonesian, and the two
/// stay separate on purpose: see the note on `LETTER_KINDS`.
export function letterKindLabel(kind: string): string {
  return LETTER_KINDS.find((one) => one.value === kind)?.appLabel ?? kind
}

export const LETTER_STATUS_LABEL: Readonly<Record<string, string>> = {
  DRAFT: "Draft",
  ISSUED: "Issued",
  VOID: "Void",
}

/// Where a letter stands, in the app's own status vocabulary.
///
/// A draft is `info` — in motion, not yet a document. An issued letter is
/// `ok`: it exists, it has a number, it is finished. A void one is `bad`
/// rather than neutral, because a person holding a printed copy of it is
/// holding something that no longer counts, and that is worth a colour.
export function letterTone(status: string): "info" | "ok" | "bad" | "neutral" {
  if (status === "DRAFT") return "info"
  if (status === "ISSUED") return "ok"
  if (status === "VOID") return "bad"
  return "neutral"
}

export interface LetterQuery {
  readonly kind?: LetterKind | null
  readonly status?: LetterStatus | null
  readonly q?: string
}

export const letterKeys = {
  all: ["letters"] as const,
  list: (query: LetterQuery) =>
    [
      "letters",
      "list",
      query.kind ?? "any",
      query.status ?? "any",
      query.q ?? "",
    ] as const,
  detail: (id: string) => ["letters", "detail", id] as const,
  templates: (kind: LetterKind) => ["letters", "templates", kind] as const,
  /// Keyed by kind, because the two draw on different records entirely — one
  /// asks the receipts, the other the allotments.
  sources: (kind: LetterKind) => ["letters", "sources", kind] as const,
}

function search(query: LetterQuery): string {
  const params = new URLSearchParams()
  if (query.kind) params.set("kind", query.kind)
  if (query.status) params.set("status", query.status)
  if (query.q && query.q.trim() !== "") params.set("q", query.q.trim())
  const encoded = params.toString()
  return encoded === "" ? "" : `?${encoded}`
}

/// One page of the register. `cursor` is the previous page's `next_cursor`;
/// absent asks for the first page. Neither is part of `LetterQuery` because
/// neither changes the question — they walk the answer.
export function listLetters(
  query: LetterQuery,
  page: { readonly cursor?: string; readonly limit?: number } = {},
  signal?: AbortSignal
): Promise<LetterList> {
  const params = new URLSearchParams(search(query).slice(1))
  params.set("limit", String(page.limit ?? LETTERS_PAGE))
  if (page.cursor !== undefined) params.set("cursor", page.cursor)
  return node.get<LetterList>(`/api/v1/letters?${params.toString()}`, {
    signal,
  })
}

/// How many letters one page of the register asks for. A step, not a
/// ceiling: the server clamps anything above 500.
export const LETTERS_PAGE = 100

export function readLetter(
  id: string,
  signal?: AbortSignal
): Promise<LetterDetail> {
  return node.get<LetterDetail>(`/api/v1/letters/${encodeURIComponent(id)}`, {
    signal,
  })
}

/// What a letter of this kind could still be written against, and how many
/// records already carry one.
///
/// The server leaves out anything that already has a live letter, so this list
/// is what somebody may actually choose — not everything, with the taken ones
/// greyed out. A record whose letter was voided comes back onto it.
///
/// `taken` exists because an empty list has two opposite meanings — nothing has
/// arrived yet, or everything already has its letter — and a picker that cannot
/// tell them apart leaves somebody staring at a blank sheet wondering what they
/// did wrong.
export interface LetterSources {
  readonly items: LetterSource[]
  readonly taken: number
}

export function letterSources(
  kind: LetterKind,
  signal?: AbortSignal
): Promise<LetterSources> {
  return node.get<LetterSources>(
    `/api/v1/letters/sources?kind=${encodeURIComponent(kind)}`,
    { signal }
  )
}

/// The patterns offered for a kind of letter.
///
/// A template is the WRITABLE half of a letter saved under a name — the
/// wording and the typed head — and never its table of goods: those come from
/// the record every time, and a saved one would be last month's delivery
/// printed onto this month's letter.
export function letterTemplates(
  kind: LetterKind,
  signal?: AbortSignal
): Promise<{ items: LetterTemplate[] }> {
  return node.get<{ items: LetterTemplate[] }>(
    `/api/v1/letters/templates?kind=${encodeURIComponent(kind)}`,
    { signal }
  )
}

export function saveTemplate(
  request: NewTemplate,
  signal?: AbortSignal
): Promise<{ template_id: string }> {
  return node.post<{ template_id: string }>(
    "/api/v1/letters/templates",
    request,
    { signal }
  )
}

export function retireTemplate(
  id: string,
  signal?: AbortSignal
): Promise<void> {
  return node.delete<void>(
    `/api/v1/letters/templates/${encodeURIComponent(id)}`,
    { signal }
  )
}

export function draftLetter(
  request: NewLetter,
  signal?: AbortSignal
): Promise<LetterDetail> {
  return node.post<LetterDetail>("/api/v1/letters", request, { signal })
}

export function saveLetter(
  id: string,
  edit: LetterEdit,
  signal?: AbortSignal
): Promise<LetterDetail> {
  return node.patch<LetterDetail>(
    `/api/v1/letters/${encodeURIComponent(id)}`,
    edit,
    { signal }
  )
}

export function issueLetter(
  id: string,
  signal?: AbortSignal
): Promise<LetterDetail> {
  return node.post<LetterDetail>(
    `/api/v1/letters/${encodeURIComponent(id)}/issue`,
    {},
    { signal }
  )
}

export function voidLetter(
  id: string,
  request: VoidLetter,
  signal?: AbortSignal
): Promise<LetterDetail> {
  return node.post<LetterDetail>(
    `/api/v1/letters/${encodeURIComponent(id)}/void`,
    request,
    { signal }
  )
}

export function discardLetter(id: string, signal?: AbortSignal): Promise<void> {
  return node.delete<void>(`/api/v1/letters/${encodeURIComponent(id)}`, {
    signal,
  })
}

/// The fields on a letter a person fills in, as opposed to the ones the record
/// answered. Nothing here comes from the database, and nothing the database
/// said is editable — which is the whole shape of this feature.
///
/// Kept as a table although the screen no longer draws a form from it: these
/// are the keys `document.tsx` writes into `facts`, and the one list of them
/// is what stops the paper and the server disagreeing about what a letter's
/// hand-written half is called.
export const WRITTEN_FACTS: readonly {
  readonly key: string
  readonly label: string
  readonly placeholder: string
  /// The kinds that offer this field. Absent means all of them.
  readonly kinds?: readonly LetterKind[]
}[] = [
  // A blank letter has no record to say who it is to or what it answers, so
  // those two are typed. On the other two they come from the record and must
  // not be.
  {
    key: "counterparty",
    label: "Kepada",
    placeholder: "Nama penerima surat",
    kinds: ["GENERAL"],
  },
  {
    key: "reference",
    label: "Perihal / No. rujukan",
    placeholder: "Perihal surat",
    kinds: ["GENERAL"],
  },
  { key: "carrier", label: "Dibawa oleh", placeholder: "Nama pengantar" },
  { key: "vehicle", label: "Kendaraan", placeholder: "Nomor polisi" },
  { key: "received_by", label: "Diterima oleh", placeholder: "Nama penerima" },
]

export function writtenFactsFor(kind: string) {
  return WRITTEN_FACTS.filter(
    (one) => one.kinds === undefined || one.kinds.includes(kind as LetterKind)
  )
}

export function fact(facts: unknown, key: string): string {
  if (typeof facts !== "object" || facts === null) return ""
  const value = (facts as Record<string, unknown>)[key]
  return typeof value === "string" ? value : ""
}

export function factNumber(facts: unknown, key: string): number | null {
  if (typeof facts !== "object" || facts === null) return null
  const value = (facts as Record<string, unknown>)[key]
  return typeof value === "number" ? value : null
}
