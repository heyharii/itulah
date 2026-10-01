/// Reading a sheet of one-offs — Talenta's "Import payroll": a CSV with one
/// row per person per component, filed through the same route as the form,
/// so every row is checked exactly as a hand-filed one is.
///
/// Columns, matched by heading in either language: `employee_code` /
/// `nik karyawan`, `component_code` / `komponen`, `amount` / `jumlah`, and
/// an optional `reason` / `keterangan`. Comma or semicolon: an Indonesian
/// Excel saves CSV with semicolons.

export interface ImportRow {
  readonly line: number
  readonly employeeCode: string
  readonly componentCode: string
  readonly amountMinor: number
  readonly reason: string
}

export interface ImportSheet {
  readonly rows: readonly ImportRow[]
  readonly problems: readonly string[]
}

function cells(line: string, separator: string): string[] {
  const out: string[] = []
  let current = ""
  let quoted = false
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"'
        i += 1
      } else quoted = !quoted
    } else if (ch === separator && !quoted) {
      out.push(current.trim())
      current = ""
    } else current += ch
  }
  out.push(current.trim())
  return out
}

const HEADINGS = {
  employee: [
    "employee_code",
    "employee",
    "kode karyawan",
    "nik karyawan",
    "karyawan",
  ],
  component: ["component_code", "component", "komponen", "kode komponen"],
  amount: ["amount", "jumlah", "nominal", "nilai"],
  reason: ["reason", "keterangan", "alasan", "catatan"],
} as const

export function readOneOffSheet(
  text: string,
  fallbackReason: string
): ImportSheet {
  const lines = text
    .replace(new RegExp(`^${String.fromCharCode(0xfeff)}`), "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "")
  if (lines.length < 2) {
    return { rows: [], problems: ["The file has a heading and no rows."] }
  }
  const head = lines[0] ?? ""
  const separator =
    (head.match(/;/g) ?? []).length > (head.match(/,/g) ?? []).length
      ? ";"
      : ","
  const heading = cells(head, separator).map((one) => one.toLowerCase())
  const column = (names: readonly string[]) =>
    heading.findIndex((one) => names.includes(one))
  const at = {
    employee: column(HEADINGS.employee),
    component: column(HEADINGS.component),
    amount: column(HEADINGS.amount),
    reason: column(HEADINGS.reason),
  }
  const missing = (["employee", "component", "amount"] as const).filter(
    (key) => at[key] < 0
  )
  if (missing.length > 0) {
    return {
      rows: [],
      problems: [
        `No ${missing.join(", ")} column. Headings expected: employee_code, component_code, amount, reason.`,
      ],
    }
  }

  const rows: ImportRow[] = []
  const problems: string[] = []
  lines.slice(1).forEach((line, index) => {
    const number = index + 2
    const row = cells(line, separator)
    const employeeCode = (row[at.employee] ?? "").toUpperCase()
    const componentCode = (row[at.component] ?? "").toUpperCase()
    // Whole rupiah: "1.500.000", "1,500,000" and "1500000" are one figure.
    const digits = (row[at.amount] ?? "").replace(/[^\d]/g, "")
    const amountMinor = Number(digits)
    const reason =
      (at.reason >= 0 ? (row[at.reason] ?? "") : "").trim() || fallbackReason
    if (employeeCode === "" || componentCode === "") {
      problems.push(
        `Line ${number}: an employee and a component are both needed.`
      )
    } else if (digits === "" || amountMinor <= 0) {
      problems.push(`Line ${number}: the amount is not a positive figure.`)
    } else {
      rows.push({
        line: number,
        employeeCode,
        componentCode,
        amountMinor,
        reason,
      })
    }
  })
  return { rows, problems }
}
