import { useQuery } from "@tanstack/react-query"

import { createReturnNoteLink, noteKey } from "@/lib/queries/return-notes"
import { useTenancy } from "@/lib/tenancy"
import type { PrintableNote } from "@/screens/procurement/return-print"

/// The note's public link, made once as soon as the note exists (owner,
/// 2026-10-10: the QR on the surat jalan opens it, no login).
///
/// Print and Download are clicked, and a print window opened after an await is
/// blocked as a pop-up — so the link cannot be asked for in the click. It is
/// asked for here, when the sheet opens or the note is generated, kept by the
/// note's key, and the click reads what is already held: `qrUrl` is `undefined`
/// until then (or when the link could not be made), and the note prints with
/// the plain-text QR instead.
///
/// Only a note that names its person in charge gets a link: the page keeps the
/// FIRST snapshot sent, so a note still without one is not sent yet. The link
/// is `{origin}/n/{token}`, with `?business=<slug>` on a sandbox server.
export function useReturnNoteLink(
  note: PrintableNote | null
): NoteLink | undefined {
  const tenancy = useTenancy()
  const business =
    tenancy.mode === "sandbox" ? (tenancy.business?.slug ?? null) : null
  const key = note === null ? "" : noteKey(note)
  const ready = note !== null && key !== "" && (note.pic ?? "").trim() !== ""
  const link = useQuery({
    queryKey: ["return-note-link", business, key] as const,
    queryFn: ({ signal }) => createReturnNoteLink(key, note!, signal),
    enabled: ready,
    staleTime: Infinity,
    gcTime: 30 * 60_000,
    retry: false,
  })
  if (!ready || link.data === undefined) return undefined
  const path = `${window.location.origin}/n/${encodeURIComponent(link.data.token)}`
  return {
    url: business === null ? path : `${path}?business=${business}`,
    number: link.data.number,
  }
}

/// What the server gives a note once: its public link and its number.
export interface NoteLink {
  readonly url: string
  readonly number: string
}

/// The note with its link and number, when it has them.
export function withNoteLink(
  note: PrintableNote,
  link: NoteLink | undefined
): PrintableNote {
  return link === undefined
    ? note
    : { ...note, qrUrl: link.url, number: link.number }
}
