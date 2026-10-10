import { money, percentBps } from "@/lib/format"
import type { SlipLineRow } from "@itulah/contract"

/// How a payslip writes a rate and says what a line was worked out from.
/// Shared by the run's payslip and the payroll settings.

/// Hundredths of a percent, as a payslip writes a rate: `0,24%`, `2%`.
export function percent(bp: number): string {
  return percentBps(bp)
}

function hours(minutes: number): string {
  return `${(minutes / 60).toLocaleString("id-ID", { maximumFractionDigits: 2 })} h`
}

/// What a line was worked out from, in one short phrase.
export function lineBasis(line: SlipLineRow): string | null {
  switch (line.basis) {
    case "STATUTORY":
      if (
        line.component_code === "THR" &&
        line.rate_bp !== null &&
        line.base_of_minor !== null
      ) {
        const months = Math.round((line.rate_bp * 12) / 10_000)
        return `${months}/12 × ${money(line.base_of_minor)}`
      }
      if (line.component_code === "PPH21_RETURN") {
        return "the year settled: withheld more than it owed"
      }
      if (line.rate_bp !== null && line.base_of_minor !== null) {
        return `${percent(line.rate_bp)} × ${money(line.base_of_minor)}`
      }
      if (line.base_of_minor !== null) {
        // The last month of the tax year: Pasal 17 on the year, no TER rate.
        return `the year's tax on ${money(line.base_of_minor)} this month, less what was withheld`
      }
      return null
    case "SHARE_OF_BASE":
      return line.rate_bp !== null && line.base_of_minor !== null
        ? `${percent(line.rate_bp)} × ${money(line.base_of_minor)}`
        : null
    case "FRACTION_OF_BASE_PER_UNIT":
      return line.units !== null && line.rate_minor !== null
        ? `${hours(line.units)} × ${money(line.rate_minor)}`
        : null
    case "RATE_PER_UNIT":
      if (line.units === null || line.rate_minor === null) return null
      return line.unit?.startsWith("OVERTIME")
        ? `${hours(line.units)} × ${money(line.rate_minor)}`
        : `${line.units} × ${money(line.rate_minor)}`
    case "PER_OCCASION":
      return "one-off this month"
    default:
      return null
  }
}
