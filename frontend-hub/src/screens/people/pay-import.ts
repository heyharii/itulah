/// Reading a sheet of pay changes — Talenta's employee import for salary,
/// with the month prorated by the payroll engine from the date each takes
/// effect (0814). Columns, by heading: `employee_code`, `effective_from`
/// (YYYY-MM-DD), `base_salary`, optional `allowances` as `CODE:amount`
/// pairs separated by `;`, and optional `reason`. Comma or semicolon.

export interface PayRow {
  readonly line: number
  readonly employeeCode: string
  readonly effectiveFrom: string
  readonly baseMinor: number
  readonly allowances: readonly { code: string; minor: number }[]
  readonly reason: string
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

export function readPaySheet(
  text: string,
  fallbackReason: string
): { rows: PayRow[]; problems: string[] } {
  const lines = text
    .replace(new RegExp(`^${String.fromCharCode(0xfeff)}`), "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "")
  if (lines.length < 2) return { rows: [], problems: ["The file has no rows."] }
  const head = lines[0] ?? ""
  const separator =
    (head.match(/;/g) ?? []).length > (head.match(/,/g) ?? []).length
      ? ";"
      : ","
  // With `;` as the separator, allowances are written with `|` between pairs.
  const pairSeparator = separator === ";" ? "|" : ";"
  const heading = cells(head, separator).map((one) => one.toLowerCase())
  const at = (names: string[]) =>
    heading.findIndex((one) => names.includes(one))
  const code = at(["employee_code", "kode karyawan", "nik karyawan"])
  const from = at(["effective_from", "berlaku", "tanggal berlaku"])
  const base = at(["base_salary", "gaji pokok", "base"])
  const allowances = at(["allowances", "tunjangan"])
  const reason = at(["reason", "alasan", "keterangan"])
  if (code < 0 || from < 0 || base < 0) {
    return {
      rows: [],
      problems: [
        "Headings expected: employee_code, effective_from, base_salary.",
      ],
    }
  }
  const rows: PayRow[] = []
  const problems: string[] = []
  lines.slice(1).forEach((line, index) => {
    const number = index + 2
    const row = cells(line, separator)
    const effectiveFrom = row[from] ?? ""
    const baseMinor = Number((row[base] ?? "").replace(/[^\d]/g, ""))
    if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)) {
      problems.push(`Line ${number}: the date is not YYYY-MM-DD.`)
      return
    }
    if (!(baseMinor > 0)) {
      problems.push(`Line ${number}: the base salary is not a positive figure.`)
      return
    }
    const pairs = allowances >= 0 ? (row[allowances] ?? "") : ""
    const parsed: { code: string; minor: number }[] = []
    let bad = false
    for (const pair of pairs
      .split(pairSeparator)
      .map((p) => p.trim())
      .filter(Boolean)) {
      const [allowance, amount] = pair.split(":")
      const minor = Number((amount ?? "").replace(/[^\d]/g, ""))
      if (!allowance || !(minor > 0)) bad = true
      else parsed.push({ code: allowance.trim().toUpperCase(), minor })
    }
    if (bad) {
      problems.push(`Line ${number}: an allowance is not CODE:amount.`)
      return
    }
    rows.push({
      line: number,
      employeeCode: (row[code] ?? "").toUpperCase(),
      effectiveFrom,
      baseMinor,
      allowances: parsed,
      reason: ((reason >= 0 ? row[reason] : "") ?? "").trim() || fallbackReason,
    })
  })
  return { rows, problems }
}
