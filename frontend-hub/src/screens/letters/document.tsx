import { useState } from "react"

import { day } from "@/lib/format"
import { fact, letterKind } from "@/lib/queries/letters"
import { cn } from "@/lib/utils"
import { COMPANY } from "@/screens/finance-lab/print"
import type { LetterDetail, LetterLine } from "@itulah/contract"

/// The letter itself, as it goes on paper.
///
/// # Why the screen shows the paper rather than a form
///
/// Because what somebody is deciding is what the paper will SAY, and a form
/// with a Preview button asks them to hold the layout in their head until they
/// press it. The editable part — the prose, and the three fields nobody but a
/// person can fill in — is edited in place, in the document, at the size it
/// will print.
///
/// # The print stylesheet
///
/// Lifted from `finance-lab/print.tsx`, which arrived at it the hard way: the
/// one Print button this app had called `window.print()` and produced the
/// browser's idea of the page — sidebar, filter row, table cut off at the
/// margin. `visibility` rather than `display`, because collapsing the app's
/// layout mid-print is how a document ends up on page three.
///
/// The class prefix is this module's own (`srt-`, for surat) rather than
/// shared, because the two stylesheets hide different things: that one hides
/// everything outside a Sheet, this one everything outside the paper.
const PRINT_CSS = `
@media print {
  body * { visibility: hidden !important; }
  .srt-print, .srt-print * { visibility: visible !important; }
  .srt-print {
    position: absolute !important;
    left: 0; top: 0; right: 0;
    padding: 0 !important;
    margin: 0 !important;
    box-shadow: none !important;
    border: 0 !important;
    background: #fff !important;
  }
  .srt-noprint { display: none !important; }

  /* A delivery of sixty lines runs over pages: repeat the heading on each,
     never split a row across the fold, and keep the signatures together. */
  .srt-print thead { display: table-header-group; }
  .srt-print tr { break-inside: avoid; page-break-inside: avoid; }
  .srt-print .srt-keep { break-inside: avoid; page-break-inside: avoid; }

  @page { margin: 14mm; }
}
`

export function PrintStyles() {
  return <style>{PRINT_CSS}</style>
}

/// A word on the letter that a person may change, changed where it is read.
///
/// # Why not a field in the sidebar
///
/// It was one, and the owner's question was the right one: "kenapa ga perihal,
/// kepada, tanggal, dan text dan nama dan tanda tangan bisa editable saja?"
/// Because a letter is a layout, and typing "Kepada" into a box beside the
/// paper asks somebody to imagine where it will land. The body was already
/// edited in place; the head and the signatures being somewhere else was an
/// inconsistency, not a design.
///
/// # Why it is uncontrolled
///
/// A `contentEditable` whose children React rewrites on every keystroke puts
/// the caret back at the start on every letter typed. So the initial text is
/// captured once and never re-rendered: what the person types stays in the
/// DOM, and what they typed travels out through `onChange`. The one moment the
/// text must come back from the server — the letter is issued and goes
/// read-only — is a different branch of this component entirely.
function Editable({
  value,
  placeholder,
  editable,
  onChange,
  className,
}: {
  value: string
  placeholder: string
  editable: boolean
  onChange: (next: string) => void
  className?: string
}) {
  // Captured on the first render and deliberately never updated. State rather
  // than a ref: a ref read during render is exactly the mistake the hooks lint
  // is looking for, and this is a value React renders.
  const [initial] = useState(value)

  if (!editable) {
    return (
      <span className={className}>
        {value === "" ? <span className="text-mute">—</span> : value}
      </span>
    )
  }

  return (
    <span
      role="textbox"
      tabIndex={0}
      contentEditable
      suppressContentEditableWarning
      data-placeholder={placeholder}
      onInput={(event) => onChange(event.currentTarget.textContent ?? "")}
      // Enter would put a line break in a field that is one line.
      onKeyDown={(event) => {
        if (event.key === "Enter") event.preventDefault()
      }}
      className={cn(
        "-mx-0.5 inline-block min-w-[6rem] rounded-[3px] px-0.5 outline-none",
        "border-b border-dashed border-line-ico/70 hover:bg-soft focus:border-solid focus:border-accent",
        // On paper none of that exists: a printed letter must not show where
        // the boxes were.
        "print:mx-0 print:border-0 print:px-0",
        "empty:before:text-mute empty:before:content-[attr(data-placeholder)]",
        className
      )}
    >
      {initial}
    </span>
  )
}

/// One labelled fact in the head of the letter.
function Fact({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex gap-2 text-[0.875rem] leading-[1.6]">
      <span className="w-28 shrink-0 text-body">{label}</span>
      <span className="shrink-0 text-body">:</span>
      <span className="min-w-0 font-medium text-ink">{children}</span>
    </div>
  )
}

/// The three lines somebody signs under.
///
/// Three and not two: the person who handed the goods over, the person who
/// carried them, and the person who took them in. A delivery note with two
/// signatures cannot answer the only question it is ever produced to answer —
/// which of them had the boxes when they went missing.
function Signatures({
  roles,
  names,
  editable,
  onName,
}: {
  roles: readonly string[]
  /// One typed name per block, in the same order. Nothing in this database
  /// knows who will sign a letter, so this is the one part that has no source
  /// but a person.
  names: readonly string[]
  editable: boolean
  onName: (index: number, value: string) => void
}) {
  return (
    <div
      className={cn(
        "srt-keep mt-10 grid gap-6",
        roles.length === 2 ? "grid-cols-2" : "grid-cols-3"
      )}
    >
      {roles.map((role, index) => (
        <div key={role} className="text-center">
          <div className="text-[0.875rem] text-body">{role}</div>
          {/* The gap is where the pen goes. The name is printed under the
              line, the way every signed letter in this country prints it. */}
          <div className="mt-12 border-t border-ink pt-1 text-[0.875rem] text-ink">
            {editable || (names[index] ?? "") !== "" ? (
              <Editable
                value={names[index] ?? ""}
                placeholder="Nama"
                editable={editable}
                onChange={(next) => onName(index, next)}
                className="min-w-[5rem] text-center"
              />
            ) : (
              <span className="text-[0.875rem] text-mute">
                Nama &amp; tanda tangan
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

function Goods({
  lines,
  kind,
}: {
  lines: readonly LetterLine[]
  kind: string
}) {
  const total = lines.reduce((sum, line) => sum + line.quantity, 0)
  const short = lines.some(
    (line) => line.ordered !== null && line.ordered !== line.quantity
  )

  return (
    <table className="mt-5 w-full border-collapse text-[0.875rem]">
      <thead>
        <tr className="border-y border-ink">
          <th className="w-8 py-1.5 text-left font-semibold">No</th>
          <th className="py-1.5 text-left font-semibold">Nama barang</th>
          <th className="w-32 py-1.5 text-left font-semibold">Kode</th>
          {/* Only where the two can differ. A goods receipt note has nothing to
              compare a count against — what arrived is what arrived — and an
              empty column headed "Diminta" invites somebody to fill it in. */}
          {short && (
            <th className="w-20 py-1.5 text-right font-semibold">Diminta</th>
          )}
          <th className="w-20 py-1.5 text-right font-semibold">
            {kind === "GOODS_RECEIPT" ? "Diterima" : "Dikirim"}
          </th>
          {/* The unit column carries its own gutter. Without it a right-aligned
              figure ends exactly where the word begins, and the heading read
              "DikirimSatuan". */}
          <th className="w-16 py-1.5 pl-3 text-left font-semibold">Satuan</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((line, index) => (
          <tr
            key={`${line.code}-${index}`}
            className="border-b border-hairline"
          >
            <td className="py-1.5 align-top tabular-nums">{index + 1}</td>
            <td className="py-1.5 align-top">
              {line.description}
              {line.variant !== null && (
                <span className="text-body"> · {line.variant}</span>
              )}
            </td>
            <td className="py-1.5 align-top font-mono text-[0.875rem]">
              {line.code}
            </td>
            {short && (
              <td className="py-1.5 text-right align-top tabular-nums">
                {line.ordered ?? ""}
              </td>
            )}
            <td className="py-1.5 text-right align-top font-medium tabular-nums">
              {line.quantity}
            </td>
            <td className="py-1.5 pl-3 align-top">{line.unit}</td>
          </tr>
        ))}
        <tr className="border-b-2 border-ink">
          <td className="py-1.5 font-semibold" colSpan={short ? 4 : 3}>
            Jumlah
          </td>
          <td className="py-1.5 text-right font-semibold tabular-nums">
            {total}
          </td>
          <td />
        </tr>
      </tbody>
    </table>
  )
}

/// The whole letter, on its sheet of paper.
///
/// `children` is where the prose goes — the editor while it is a draft, the
/// same words rendered read-only once it is issued. The document does not care
/// which, and that is deliberate: there is one layout, so what somebody edits
/// is what prints.
export function LetterPaper({
  letter,
  editable = false,
  onFact,
  children,
}: {
  letter: LetterDetail
  /// Whether the parts a person owns may be changed. A draft, in other words —
  /// an issued letter is evidence and every one of these becomes plain text.
  editable?: boolean
  onFact?: (key: string, value: unknown) => void
  children?: React.ReactNode
}) {
  const goods = letter.kind === "GOODS_RECEIPT"
  // A letter written from nothing. It has no table of goods and no record to
  // name, so the head is two lines a person typed rather than four read off a
  // row — and the words change with it: a covering note is not "from" a
  // supplier, it is "to" somebody.
  const blank = letter.kind === "GENERAL"
  const reference = fact(letter.facts, "reference")
  const counterparty = fact(letter.facts, "counterparty")
  const place = fact(letter.facts, "place")
  const occurred = fact(letter.facts, "occurred_at")

  const write = (key: string, value: unknown) => onFact?.(key, value)

  /// Which parts this letter lets a person write.
  ///
  /// The head of a goods receipt note is not one of them: the supplier, the
  /// order and the arrival date are what the DC counted, and a letter whose
  /// head could be retyped would be a letter that can disagree with the record
  /// it claims to be about. A blank letter has no record, so all of it is
  /// somebody's to write.
  const head = editable && blank
  /// These have no source anywhere — who carried the goods, in what, and who
  /// took them in — so every kind lets a person write them.
  const byHand = editable

  const names: string[] = Array.isArray(
    (letter.facts as Record<string, unknown>)?.signatures
  )
    ? (((letter.facts as Record<string, unknown>).signatures as unknown[]).map(
        (one) => (typeof one === "string" ? one : "")
      ) as string[])
    : []

  const roles = blank
    ? ["Hormat kami", "Diterima oleh"]
    : goods
      ? ["Pengirim / Pemasok", "Diperiksa oleh", "Diterima oleh"]
      : ["Dikirim oleh", "Dibawa oleh", "Diterima oleh"]

  /// The date on the paper.
  ///
  /// An issued letter is dated the day it was issued, and that is not a
  /// preference: the number and the date are the pair an auditor matches. A
  /// blank draft is dated by whoever writes it — a letter is often dated the
  /// day it will be handed over rather than the day it was typed — and the
  /// other two take the date of the delivery they describe.
  const dated =
    letter.issued_at !== null
      ? day(letter.issued_at)
      : blank
        ? fact(letter.facts, "letter_date")
        : day(occurred)

  return (
    <div className="srt-print rounded-card border border-hairline bg-canvas px-10 py-8 text-ink shadow-soft print:shadow-none">
      {/* The letterhead. The company's own name and address, from the one
          place the app keeps them — see `finance-lab/print`. */}
      <div className="flex items-start justify-between gap-6 border-b-2 border-ink pb-2">
        <div className="min-w-0">
          <div className="text-[0.9375rem] font-semibold tracking-[0.04em] text-ink uppercase">
            {COMPANY.name}
          </div>
          <div className="text-[0.875rem] text-body">{COMPANY.address}</div>
          <div className="text-[0.875rem] text-body">{COMPANY.phone}</div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-[0.9375rem] font-semibold tracking-[0.06em] text-ink uppercase">
            {letterKind(letter.kind)}
          </div>
          <div className="mt-0.5 font-mono text-[0.875rem] text-body">
            {/* A draft says so on the paper. Somebody printing one to walk it
                round for a signature must not end up with a document that
                looks numbered when it is not. */}
            {letter.letter_number ?? "BELUM DITERBITKAN"}
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-x-8 gap-y-1 sm:grid-cols-2">
        <Fact label={blank ? "Perihal" : goods ? "No. PO" : "No. Alokasi"}>
          <Editable
            value={reference}
            placeholder="Perihal surat"
            editable={head}
            onChange={(next) => write("reference", next)}
          />
        </Fact>
        <Fact label="Tanggal">
          <Editable
            value={dated}
            placeholder="Tanggal surat"
            editable={head}
            onChange={(next) => write("letter_date", next)}
          />
        </Fact>
        <Fact label={blank ? "Kepada" : goods ? "Pemasok" : "Tujuan"}>
          <Editable
            value={counterparty}
            placeholder="Nama penerima"
            editable={head}
            onChange={(next) => write("counterparty", next)}
          />
        </Fact>
        {!blank && (
          <Fact label={goods ? "Diterima di" : "Dikirim dari"}>
            {goods ? place : COMPANY.name}
          </Fact>
        )}
        {/* Shown on a draft whether or not they are filled in, because an
            empty line is how somebody knows they may write on it. Once the
            letter is issued they appear only if they say something: a printed
            letter with "Kendaraan: —" on it is a question nobody answered. */}
        {(byHand || fact(letter.facts, "carrier") !== "") && (
          <Fact label="Dibawa oleh">
            <Editable
              value={fact(letter.facts, "carrier")}
              placeholder="Nama pengantar"
              editable={byHand}
              onChange={(next) => write("carrier", next)}
            />
          </Fact>
        )}
        {(byHand || fact(letter.facts, "vehicle") !== "") && (
          <Fact label="Kendaraan">
            <Editable
              value={fact(letter.facts, "vehicle")}
              placeholder="Nomor polisi"
              editable={byHand}
              onChange={(next) => write("vehicle", next)}
            />
          </Fact>
        )}
      </div>

      {/* No table where there are no goods. A blank letter with an empty grid
          headed "Nama barang" under it is a form somebody will feel obliged to
          fill in. */}
      {letter.lines.length > 0 && (
        <Goods lines={letter.lines} kind={letter.kind} />
      )}

      {children && <div className="mt-5">{children}</div>}

      <Signatures
        roles={roles}
        names={names}
        editable={byHand}
        onName={(index, value) => {
          const next = roles.map((_, at) => names[at] ?? "")
          next[index] = value
          write("signatures", next)
        }}
      />

      {letter.status === "VOID" && (
        <div
          className={cn(
            "mt-6 border-t border-bad pt-2 text-[0.875rem] font-medium text-bad-fg"
          )}
        >
          SURAT INI DIBATALKAN
          {letter.void_reason !== null && ` — ${letter.void_reason}`}
        </div>
      )}
    </div>
  )
}
