import { useQuery } from "@tanstack/react-query"
import { Download } from "lucide-react"
import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { count, day } from "@/lib/format"
import { getPublicReturnNote } from "@/lib/queries/return-notes"
import { COMPANY } from "@/screens/finance-lab/print"
import {
  NOT_AS_ORDERED_PAPER_ROW,
  UNKNOWN_NOTE,
} from "@/screens/procurement/return-lines"
import {
  noteFigures,
  type PrintableNote,
} from "@/screens/procurement/return-print"

/// The public page of a Surat Jalan Retur: `/n/{token}`, opened from the QR on
/// the printed note (owner, 2026-10-10).
///
/// Read-only and without a login — the supplier's driver scans the paper with
/// a phone. It stands outside the signed-in shell (`App.tsx` renders it before
/// it asks whether anybody is signed in), reads nothing from this browser but
/// the token in its own address, and shows the note as it was printed, in the
/// note's own Indonesian words. Not for search engines, and it counts nothing.
export function ReturnNotePage({ token }: { token: string }) {
  const note = useQuery({
    queryKey: ["public-return-note", token],
    queryFn: ({ signal }) => getPublicReturnNote(token, signal),
    retry: false,
    staleTime: Infinity,
  })

  // Not for search engines while the page is shown.
  useEffect(() => {
    const meta = document.createElement("meta")
    meta.name = "robots"
    meta.content = "noindex"
    document.head.appendChild(meta)
    const was = document.title
    document.title = "Surat Jalan Retur"
    return () => {
      meta.remove()
      document.title = was
    }
  }, [])

  const shaped = note.data != null && Array.isArray(note.data.returns)

  return (
    <div className="fixed inset-0 overflow-y-auto bg-soft">
      <main className="mx-auto flex w-full max-w-[46rem] flex-col gap-4 px-4 py-6 pb-[max(2rem,env(safe-area-inset-bottom))] sm:py-10">
        {note.isPending && (
          <p className="py-16 text-center text-[0.9375rem] text-body">
            Loading the surat jalan…
          </p>
        )}

        {note.isError && (
          <Notice
            title="This surat jalan could not be loaded"
            body="Check the connection and scan the code again."
          />
        )}

        {note.isSuccess && !shaped && (
          <Notice
            title="This surat jalan was not found"
            body="The code may be damaged, or the link may be wrong."
          />
        )}

        {shaped && <Paper note={note.data!} />}
      </main>
    </div>
  )
}

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-card border border-hairline bg-canvas px-5 py-10 text-center shadow-soft">
      <h1 className="text-[1.125rem] font-semibold text-ink">{title}</h1>
      <p className="text-[0.9375rem] text-body">{body}</p>
    </div>
  )
}

/// The note, laid out as the owner drew the print: title and company, date and
/// orders, "Kepada" the supplier, the items with a row for pieces that are not
/// as ordered, the total, and "Hormat kami" with the person who sends it.
function Paper({ note }: { note: PrintableNote }) {
  const figures = noteFigures(note)
  const [saving, setSaving] = useState(false)

  const rows = [
    ...figures.items.map((one) => ({
      name: one.name,
      sub: null as string | null,
      note: figures.notes[one.sku] ?? "",
      qty: one.qty,
    })),
    ...(figures.unknown > 0
      ? [
          {
            name: NOT_AS_ORDERED_PAPER_ROW.title,
            sub: NOT_AS_ORDERED_PAPER_ROW.sub as string | null,
            note: figures.notes[UNKNOWN_NOTE] ?? "",
            qty: figures.unknown,
          },
        ]
      : []),
  ]

  /// The PDF is the same document the Gudang printed, and its QR comes back
  /// to this page. Loaded when asked for: the page itself stays small.
  const download = async () => {
    setSaving(true)
    try {
      const { downloadReturnPdf } = await import(
        "@/screens/procurement/return-pdf"
      )
      const here = new URL(window.location.href)
      here.hash = ""
      downloadReturnPdf({ ...note, qrUrl: here.toString() })
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <article
        aria-label={`Surat jalan retur ${note.supplier}`}
        className="rounded-card border border-hairline bg-canvas px-5 py-6 text-[0.9375rem] text-ink shadow-soft sm:px-9 sm:py-9"
      >
        <header className="flex flex-col gap-4 border-b-2 border-ink pb-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="mb-1.5 text-[1.25rem] font-semibold tracking-[0.04em]">
              SURAT JALAN RETUR
            </h1>
            <p className="font-semibold tracking-[0.04em] uppercase">
              {COMPANY.name}
            </p>
            <p className="text-body">{COMPANY.address}</p>
            {COMPANY.phone && <p className="text-body">{COMPANY.phone}</p>}
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 sm:max-w-[16rem]">
            {note.number && (
              <>
                <dt className="text-body">No</dt>
                <dd className="font-semibold">: {note.number}</dd>
              </>
            )}
            <dt className="text-body">Tgl</dt>
            <dd className="font-semibold">: {day(note.date)}</dd>
            <dt className="text-body">No PO</dt>
            <dd className="font-semibold break-words">
              : {figures.orders.join(", ") || "—"}
            </dd>
          </dl>
        </header>

        <section className="my-5 grid grid-cols-[auto_1fr] gap-x-3">
          <p className="text-body">Kepada :</p>
          <div>
            <p className="font-semibold">{note.supplier}</p>
            {note.address && <p>{note.address}</p>}
            {note.phone && <p>Telp. {note.phone}</p>}
          </div>
        </section>

        <table className="w-full border-collapse border border-ink">
          <thead>
            <tr className="text-left text-[0.875rem] font-medium text-body">
              <th className="border border-ink px-3 py-2 font-medium">Item</th>
              <th className="border border-ink px-3 py-2 font-medium">
                Keterangan
              </th>
              <th className="w-28 border border-ink px-3 py-2 text-right font-medium">
                Quantity
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((line, index) => (
              <tr key={`${index}-${line.name}`}>
                <td className="border border-ink px-3 py-2.5 align-top">
                  <div className="flex gap-2.5">
                    <span className="w-5 shrink-0 tabular-nums">
                      {index + 1}
                    </span>
                    <div className="min-w-0 break-words">
                      {line.name}
                      {line.sub && (
                        <p className="text-[0.875rem] text-body">{line.sub}</p>
                      )}
                    </div>
                  </div>
                </td>
                <td className="border border-ink px-3 py-2.5 align-top break-words">
                  {line.note}
                </td>
                <td className="border border-ink px-3 py-2.5 text-right align-top tabular-nums">
                  {count(line.qty)} pcs
                </td>
              </tr>
            ))}
            <tr className="font-semibold">
              <td
                colSpan={2}
                className="border border-ink px-3 py-2.5 text-right"
              >
                Total
              </td>
              <td className="border border-ink px-3 py-2.5 text-right tabular-nums">
                {count(figures.total)} pcs
              </td>
            </tr>
          </tbody>
        </table>

        <p className="mt-3">
          <span className="text-body">PIC :</span>{" "}
          <strong>{figures.pic}</strong>
        </p>

        <footer className="mt-8 flex flex-wrap items-end gap-x-14 gap-y-6">
          <div>
            <p>Hormat kami,</p>
            <div className="h-14" />
            <p className="font-semibold">( {figures.sender} )</p>
          </div>
          <div>
            <p>Penerima,</p>
            <div className="h-14" />
            <p className="font-semibold">( {note.supplier} )</p>
          </div>
        </footer>
      </article>

      <Button
        variant="primary"
        className="h-11 w-full sm:w-auto sm:self-end"
        pending={saving}
        onClick={() => void download()}
      >
        <Download />
        Download PDF
      </Button>
    </>
  )
}
