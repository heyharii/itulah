/// CSV, built in the browser from rows a screen already knows how to read.
///
/// One implementation for every list that exports. A column is a heading and
/// a way to read a cell off a row — the same two things a table column is —
/// so a screen describes its export as a list of those and hands over the
/// rows; quoting, line endings and the download are this file's business.

/// One column of an export: what it is headed, and what goes in the cell.
export interface CsvColumn<Row> {
  readonly label: string
  readonly value: (row: Row) => string | number | null | undefined
}

/// One cell, quoted when it has to be.
///
/// A comma, a quote or a line break inside a value would otherwise split it
/// or run it into the next row; doubling the quote inside a quoted cell is
/// how the format escapes one.
function cell(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? "" : String(value)
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/// The rows as CSV text: a header line, then one line per row.
export function toCsv<Row>(
  columns: readonly CsvColumn<Row>[],
  rows: readonly Row[]
): string {
  const header = columns.map((column) => cell(column.label)).join(",")
  const body = rows.map((row) =>
    columns.map((column) => cell(column.value(row))).join(",")
  )
  return [header, ...body].join("\r\n")
}

/// A file name from a title: punctuation out, runs of space collapsed.
export function csvName(title: string, fallback = "export"): string {
  const name = title
    .replace(/[^\w -]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  return `${name || fallback}.csv`
}

/// Hand the text to the browser as a file.
///
/// With a byte-order mark, so Excel — which is where an Indonesian office
/// opens a CSV — reads the file as UTF-8 and does not mangle an é or an em
/// dash into three characters of noise.
export function downloadCsv(fileName: string, text: string): void {
  const blob = new Blob(["﻿", text], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = fileName.endsWith(".csv") ? fileName : `${fileName}.csv`
  link.click()
  URL.revokeObjectURL(url)
}
