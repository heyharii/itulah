import writeExcelFile from "write-excel-file/universal"
import type { SheetData } from "write-excel-file/universal"

/// One way to hand a Finance report to Excel.
///
/// The client's finance team lived in 7Soft and lives in spreadsheets: a
/// report that can only be read on the glass, or that leaves as CSV and loses
/// its number formats the moment Excel opens it, is a report they re-key. So
/// every Finance report writes what is on screen — same rows, same filters —
/// as a real `.xlsx`, through this one function.
///
/// Money arrives here exactly as `money()` in `format.ts` receives it: whole
/// rupiah (the server's "minor" unit is already the rupiah), so nothing is
/// divided. It is written as a number with a thousands format, never as the
/// "Rp 1.234.567" string the screen draws, so a column can be summed.

export type ExportKind = "text" | "money" | "number" | "percent" | "date"

export interface ExportColumn {
  readonly header: string
  /// Width in characters; a sensible one is guessed from the header and kind.
  readonly width?: number
  readonly kind: ExportKind
}

export type ExportCell = string | number | null | undefined

/// How a row of a tree is drawn: a heading or subtotal in bold, a child
/// indented under its parent. `indent` counts levels; the first column only.
export interface ExportRowStyle {
  readonly bold?: boolean
  readonly indent?: number
}

export interface ExportSheet {
  /// The file name, with or without `.xlsx`.
  readonly filename: string
  /// The worksheet's tab. Excel allows 31 characters and no `\ / ? * [ ] :`.
  readonly sheet: string
  readonly title?: string
  /// The filters, as a sentence: "1 Sep 2026 – 30 Sep 2026 · every unit".
  readonly subtitle?: string
  readonly columns: readonly ExportColumn[]
  /// Row-major, one value per column. `percent` values are fractions
  /// (0.125 is 12.5%); `date` values are `YYYY-MM-DD`; `money` and `number`
  /// values are numbers.
  readonly rows: readonly (readonly ExportCell[])[]
  /// One entry per row (or fewer), for tree-shaped reports.
  readonly rowStyles?: readonly (ExportRowStyle | undefined)[]
  /// The closing line, drawn bold under a rule.
  readonly totalRow?: readonly ExportCell[]
}

const MONEY_FORMAT = "#,##0"
const NUMBER_FORMAT = "#,##0"
const PERCENT_FORMAT = "0.0%"
const DATE_FORMAT = "dd mmm yyyy"

const INK = "#1a1a1a"
const MUTE = "#6b6b6b"
const HAIRLINE = "#c9c9c9"
const HEADER_FILL = "#f2f2f2"

/// A calendar day as the date Excel stores: UTC midnight, so the sheet shows
/// the same day in Jakarta as anywhere else. Anything that is not an ISO day
/// is kept as text rather than lost.
function dateOf(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (match === null) return null
  return new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  )
}

function cellOf(
  value: ExportCell,
  kind: ExportKind,
  extra: Record<string, unknown> = {}
): SheetData[number][number] {
  if (value === null || value === undefined || value === "") return null
  if (kind === "text") return { value: String(value), type: String, ...extra }
  if (kind === "date") {
    const date = typeof value === "string" ? dateOf(value) : null
    return date === null
      ? { value: String(value), type: String, ...extra }
      : {
          value: date,
          type: Date,
          format: DATE_FORMAT,
          align: "left",
          ...extra,
        }
  }
  const number = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(number))
    return { value: String(value), type: String, ...extra }
  return {
    value: number,
    type: Number,
    format:
      kind === "money"
        ? MONEY_FORMAT
        : kind === "percent"
          ? PERCENT_FORMAT
          : NUMBER_FORMAT,
    ...extra,
  }
}

function guessWidth(column: ExportColumn): number {
  if (column.width !== undefined) return column.width
  switch (column.kind) {
    case "money":
      return Math.max(16, column.header.length + 2)
    case "number":
      return Math.max(12, column.header.length + 2)
    case "percent":
      return Math.max(9, column.header.length + 2)
    case "date":
      return Math.max(13, column.header.length + 2)
    default:
      return Math.max(24, column.header.length + 2)
  }
}

/// The name Excel will take for a tab.
function tabName(name: string): string {
  const clean = name.replace(/[\\/?*[\]:]/g, " ").trim()
  return (clean === "" ? "Sheet1" : clean).slice(0, 31)
}

/// Build the sheet and hand it to the browser as a download. Resolves when
/// the file has been given to the browser, with the file's name and size.
export async function exportXlsx(
  spec: ExportSheet
): Promise<{ filename: string; bytes: number }> {
  const width = spec.columns.length
  let leadingText = 0
  while (leadingText < 2 && spec.columns[leadingText]?.kind === "text")
    leadingText++
  const data: SheetData = []

  if (spec.title !== undefined) {
    data.push([
      {
        value: spec.title,
        type: String,
        fontWeight: "bold",
        fontSize: 14,
        textColor: INK,
      },
    ])
  }
  if (spec.subtitle !== undefined) {
    data.push([{ value: spec.subtitle, type: String, textColor: MUTE }])
  }
  if (spec.title !== undefined || spec.subtitle !== undefined) data.push([])

  const headerAt = data.length
  data.push(
    spec.columns.map((column) => ({
      value: column.header,
      type: String,
      fontWeight: "bold",
      backgroundColor: HEADER_FILL,
      bottomBorderColor: HAIRLINE,
      bottomBorderStyle: "thin",
      align:
        column.kind === "text" || column.kind === "date" ? "left" : "right",
    }))
  )

  spec.rows.forEach((row, index) => {
    const style = spec.rowStyles?.[index]
    data.push(
      spec.columns.map((column, at) =>
        cellOf(row[at] ?? null, column.kind, {
          ...(style?.bold === true ? { fontWeight: "bold" } : {}),
          ...(at === 0 && style?.indent !== undefined && style.indent > 0
            ? { indent: style.indent }
            : {}),
        })
      )
    )
  })

  if (spec.totalRow !== undefined) {
    const total = spec.totalRow
    data.push(
      spec.columns.map(
        (column, at) =>
          cellOf(total[at] ?? null, column.kind, {
            fontWeight: "bold",
            topBorderColor: INK,
            topBorderStyle: "thin",
          }) ?? {
            value: "",
            type: String,
            topBorderColor: INK,
            topBorderStyle: "thin",
          }
      )
    )
  }

  const blob = await writeExcelFile(data, {
    sheet: tabName(spec.sheet),
    columns: spec.columns.map((column) => ({ width: guessWidth(column) })),
    // Freeze through the header row, and the leading text columns (code,
    // account) when there are figures enough to scroll across.
    stickyRowsCount: headerAt + 1,
    stickyColumnsCount: width > 3 ? leadingText : 0,
    showGridLines: false,
  }).toBlob()

  const filename = /\.xlsx$/i.test(spec.filename)
    ? spec.filename
    : `${spec.filename}.xlsx`
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  // Revoked on the next task: some browsers start reading the blob after the
  // click returns.
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
  return { filename, bytes: blob.size }
}

/// `2026-09` for a file name, from any ISO day.
export function monthStamp(iso: string): string {
  return iso.slice(0, 7)
}

/// A file name part that survives every file system: letters, digits and
/// dashes.
export function fileSafe(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}
