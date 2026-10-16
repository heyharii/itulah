import { money } from "@/lib/format"
import type { ChangeProposalView } from "@/lib/queries/people"

/// The fields a proposal can name, as the person filing it reads them.
export const FIELD_LABEL: Readonly<Record<string, string>> = {
  unit_id: "Posted to",
  base_minor: "Base salary",
  position: "Job",
  grade: "Grade",
}

/// A proposed value as a person reads it: a unit by its name, a salary as
/// rupiah. The server sends every value as text.
export function valueOf(
  field: string,
  value: string,
  unitName: (id: string) => string
): string {
  if (value === "" || value === "—") return "—"
  if (field === "unit_id") return unitName(value)
  if (field === "base_minor" && /^\d+$/.test(value)) return money(Number(value))
  return value
}

/// A change in one line: its first field, from and to, and how many more —
/// also the Overview inbox's Detail.
export function changeSummary(
  change: ChangeProposalView,
  unitName: (id: string) => string
): string {
  const first = change.props[0]
  if (first === undefined) return "—"
  const more = change.props.length > 1 ? ` +${change.props.length - 1}` : ""
  return `${FIELD_LABEL[first.field] ?? first.field}: ${valueOf(first.field, first.from, unitName)} → ${valueOf(first.field, first.to, unitName)}${more}`
}
