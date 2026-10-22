import { X } from "lucide-react"
import { useState } from "react"
import { createPortal } from "react-dom"

import { cn } from "@/lib/utils"
import { COMPANY } from "@/screens/finance-lab/print"
import { TrackQr } from "@/screens/letters/document"
import { PROSE_CSS, proseHtml } from "@/screens/letters/editor"
import type {
  WrittenFacts,
  WrittenForm,
  WrittenItem,
} from "@/screens/letters/forms"
import type { LetterDetail } from "@itulah/contract"

/// A letter a person wrote from a template, on its sheet of paper.
///
/// Ink on white at A4 (PrintPaper): the letterhead and the title with its
/// number, the head lines, the prose, the items table, the signatures, and —
/// once issued — the QR that tracks it. While it is a draft every word on it
/// is typed where it is read (owner, 2026-09: "kenapa ga perihal, kepada,
/// tanggal … bisa editable saja?"); the head lines left blank show a dashed
/// line and are listed under To fill, and an issued letter prints them as a
/// dotted line for the pen.
export function WrittenPaper({
  letter,
  form,
  facts,
  items,
  author,
  editable,
  onFact,
  onItems,
  prose,
  copy,
}: {
  letter: LetterDetail
  form: WrittenForm
  facts: WrittenFacts
  items: readonly WrittenItem[]
  /// The writer's full name, for the blocks they sign.
  author: string
  editable: boolean
  onFact?: (key: string, value: unknown) => void
  onItems?: (items: WrittenItem[]) => void
  /// The prose: the editor while it is a draft, its HTML on a printed copy.
  prose: React.ReactNode
  /// "Lembar 1 · Asli" on a printed copy.
  copy?: string
}) {
  const write = (key: string, value: unknown) => onFact?.(key, value)
  const signatures = signatureNames(letter.facts)
  const shownItems = editable
    ? items
    : items.filter((item) => item.name.trim() !== "")

  const editItem = (index: number, key: keyof WrittenItem, value: string) => {
    const next = items.map((item, at) =>
      at === index ? { ...item, [key]: value } : item
    )
    onItems?.(next)
  }

  return (
    <div className="relative flex min-h-[1123px] w-[794px] flex-col bg-canvas px-14 pt-[3.25rem] pb-12 text-ink">
      {copy !== undefined && (
        <div className="absolute top-6 right-14 text-[0.75rem] text-body">
          {copy}
        </div>
      )}
      <div className="flex items-end justify-between gap-6 border-b-2 border-ink pb-3">
        <div className="min-w-0">
          <div className="text-[1.1875rem] font-semibold tracking-[0.04em] uppercase">
            {COMPANY.name}
          </div>
          <div className="mt-0.5 text-[0.8125rem] text-body">
            {COMPANY.address}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-[1.125rem] font-semibold tracking-[0.01em] uppercase">
            {form.paper}
          </div>
          <div
            className={cn(
              "mt-0.5 font-mono text-[0.8125rem]",
              letter.letter_number === null ? "text-body" : "text-ink"
            )}
          >
            {/* A draft says so on the paper: somebody printing one to walk it
                round for a signature must not hold a document that looks
                numbered when it is not. */}
            {letter.letter_number ?? "BELUM DITERBITKAN"}
          </div>
        </div>
      </div>

      <div className="mt-4 mb-5 grid grid-cols-2 gap-x-7 gap-y-1">
        {form.head.map((line) => (
          <div
            key={line.key}
            className="flex gap-2 text-[0.875rem] leading-[1.6]"
          >
            <span className="w-[6.5rem] shrink-0 text-body">{line.label}</span>
            <span className="text-body">:</span>
            <PaperText
              value={facts[line.key] ?? ""}
              editable={editable}
              fact={line.key}
              placeholder={line.blank !== undefined ? line.label.toLowerCase() : ""}
              blank={line.blank !== undefined}
              onChange={(next) => write(line.key, next)}
              className="min-w-0 font-medium"
            />
          </div>
        ))}
      </div>

      {prose}

      {form.items && (
        <table className="mt-3 mb-4 w-full border-collapse text-[0.84375rem]">
          <thead>
            <tr className="border-y-[1.5px] border-ink">
              <th className="w-9 px-2 py-1.5 text-center font-semibold">No</th>
              <th className="px-2 py-1.5 text-left font-semibold">
                Nama barang
              </th>
              <th className="w-20 px-2 py-1.5 text-right font-semibold">
                Jumlah
              </th>
              <th className="w-20 px-2 py-1.5 text-left font-semibold">
                Satuan
              </th>
              <th className="w-40 px-2 py-1.5 text-left font-semibold">
                Keterangan
              </th>
              {editable && <th className="srt-noprint w-6" />}
            </tr>
          </thead>
          <tbody>
            {shownItems.map((item, index) => (
              <tr
                key={item.id}
                data-item={index}
                className="group border-b border-hairline-2"
              >
                <td className="px-2 py-1.5 text-center align-top tabular-nums">
                  {index + 1}
                </td>
                {(["name", "quantity", "unit", "note"] as const).map((key) => (
                  <td
                    key={key}
                    className={cn(
                      "px-2 py-1.5 align-top",
                      key === "quantity" && "text-right tabular-nums",
                      key === "unit" && "text-body"
                    )}
                  >
                    <PaperText
                      value={item[key]}
                      editable={editable}
                      placeholder={key === "name" ? "nama barang" : ""}
                      onChange={(next) => editItem(index, key, next)}
                      className={cn(
                        "w-full",
                        key === "quantity" && "text-right"
                      )}
                    />
                  </td>
                ))}
                {editable && (
                  <td className="srt-noprint py-1 align-top">
                    <button
                      type="button"
                      aria-label="Remove row"
                      onClick={() =>
                        onItems?.(items.filter((_, at) => at !== index))
                      }
                      className="grid size-6 place-items-center rounded-inner text-faint opacity-0 transition-opacity group-hover:opacity-100 hover:bg-soft-2 hover:text-ink focus-visible:opacity-100"
                    >
                      <X className="size-3.5" />
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {form.closing !== undefined && (
        <p className="mb-2.5 text-[0.875rem] leading-[1.65]">
          <PaperText
            value={facts.closing ?? form.closing}
            editable={editable}
            onChange={(next) => write("closing", next)}
          />
        </p>
      )}

      <div
        className="srt-keep mt-6 grid gap-7"
        style={{
          gridTemplateColumns: `repeat(${Math.max(form.signs.length, 2)}, minmax(0, 1fr))`,
        }}
      >
        {form.signs.map((sign, index) => {
          const derived =
            sign.name === "author"
              ? author
              : sign.name !== undefined
                ? (facts[sign.name] ?? "")
                : ""
          const own = signatures[index] ?? ""
          const name = own !== "" ? own : derived
          const role = sign.role !== undefined ? (facts[sign.role] ?? "") : ""
          return (
            <div key={sign.caption} className="text-center text-[0.84375rem]">
              <div className="text-body">{sign.caption},</div>
              <div className="h-20 border-b border-ink" />
              <div className="mt-1.5 min-h-[1.4em] font-medium">
                {/* Follows the fact it comes from (the carrier typed in the
                    head) until somebody types a name of their own here. */}
                <PaperText
                  key={own !== "" ? "own" : derived}
                  value={name}
                  editable={editable}
                  placeholder="nama"
                  onChange={(next) => {
                    const names = form.signs.map((_, at) => signatures[at] ?? "")
                    names[index] = next
                    onFact?.("signatures", names)
                  }}
                />
              </div>
              {role !== "" && (
                <div className="text-[0.8125rem] text-body">{role}</div>
              )}
            </div>
          )
        })}
      </div>

      <div className="mt-auto flex items-end gap-3.5 pt-7 text-[0.75rem] text-body">
        {letter.letter_number !== null && <TrackQr letter={letter} />}
      </div>

      {letter.status === "VOID" && (
        <div className="mt-4 border-t border-bad pt-2 text-[0.8125rem] font-medium text-bad-fg">
          SURAT INI DIBATALKAN
          {letter.void_reason !== null && ` — ${letter.void_reason}`}
        </div>
      )}
    </div>
  )
}

/// The signature names somebody typed over the defaults, in block order.
function signatureNames(facts: unknown): string[] {
  const raw = (facts as Record<string, unknown> | null)?.signatures
  if (Array.isArray(raw))
    return raw.map((one) => (typeof one === "string" ? one : ""))
  if (typeof raw === "string") {
    try {
      const parsed: unknown = JSON.parse(raw)
      if (Array.isArray(parsed))
        return parsed.map((one) => (typeof one === "string" ? one : ""))
    } catch {
      return []
    }
  }
  return []
}

/// A word on the paper that a person may change, changed where it is read.
///
/// Uncontrolled, as `document.tsx`'s Editable is and for the same reason: a
/// `contentEditable` whose children React rewrites on every keystroke puts the
/// caret back at the start. The text is captured once; what is typed travels
/// out through `onChange`.
///
/// A blank shows its placeholder over a dashed line while it is a draft, and
/// prints as a dotted line once issued — the space somebody fills in by pen.
export function PaperText({
  value,
  editable,
  onChange,
  placeholder = "",
  blank = false,
  fact,
  className,
}: {
  value: string
  editable: boolean
  onChange: (next: string) => void
  placeholder?: string
  blank?: boolean
  /// Names the element for To fill, which moves the caret here.
  fact?: string
  className?: string
}) {
  const [initial] = useState(value)

  if (!editable) {
    return value === "" && blank ? (
      <span className="inline-block min-w-40 border-b border-dotted border-ink" />
    ) : (
      <span className={className}>{value}</span>
    )
  }

  return (
    <span
      role="textbox"
      tabIndex={0}
      contentEditable
      suppressContentEditableWarning
      spellCheck={false}
      data-fact={fact}
      data-placeholder={placeholder}
      onInput={(event) => {
        const text = event.currentTarget.textContent ?? ""
        // An emptied box shows its placeholder again: the browser leaves a
        // <br> behind, which is not empty to CSS.
        if (text === "") event.currentTarget.innerHTML = ""
        onChange(text)
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.preventDefault()
      }}
      className={cn(
        "-mx-0.5 inline-block min-w-[1.5rem] rounded-[3px] px-0.5 outline-none transition-[background-color,box-shadow] duration-(--t-hover)",
        "hover:bg-soft focus:bg-canvas focus:shadow-[0_0_0_2px_var(--focus-ring)]",
        "empty:before:font-normal empty:before:text-faint empty:before:content-[attr(data-placeholder)]",
        blank && "empty:min-w-36 empty:border-b empty:border-dashed empty:border-hairline-strong",
        className
      )}
    >
      {initial}
    </span>
  )
}

/// The copies that go to the printer, mounted at the end of the page and seen
/// only by the printer: `Lembar 1 · Asli`, `Lembar 2 · Pembawa`, `Lembar 3 ·
/// Arsip`, a page each, on the paper chosen in the print sheet.
export const COPY_NAMES = [
  "Lembar 1 · Asli",
  "Lembar 2 · Pembawa",
  "Lembar 3 · Arsip",
] as const

export function PrintCopies({
  copies,
  paper,
  render,
}: {
  copies: number
  paper: "A4" | "A5"
  render: (copy: string | undefined) => React.ReactNode
}) {
  if (typeof document === "undefined") return null
  // A5 is A4 at 0.707: the same layout, smaller on the sheet.
  const zoom = paper === "A5" ? 0.707 : 1
  return createPortal(
    <div className="letter-copies" aria-hidden>
      <style>{`
        .letter-copies { display: none; }
        @media print {
          body * { visibility: hidden !important; }
          .letter-copies, .letter-copies * { visibility: visible !important; }
          .letter-copies { display: block; position: absolute; left: 0; top: 0; }
          .letter-copy { break-after: page; zoom: ${zoom}; }
          .letter-copy:last-child { break-after: auto; }
          .letter-copy > div { min-height: auto; padding: 0; width: 182mm; }
          @page { size: ${paper}; margin: ${paper === "A5" ? "9mm" : "14mm"}; }
        }
      `}</style>
      {Array.from({ length: copies }, (_, index) => (
        <div key={index} className="letter-copy">
          {render(copies > 1 ? COPY_NAMES[index] : undefined)}
        </div>
      ))}
    </div>,
    document.body
  )
}

/// The prose of a printed copy: what the editor holds, as HTML.
export function PrintedProse({ body }: { body: unknown }) {
  return (
    <div
      className={PROSE_CSS}
      dangerouslySetInnerHTML={{ __html: proseHtml(body) }}
    />
  )
}
