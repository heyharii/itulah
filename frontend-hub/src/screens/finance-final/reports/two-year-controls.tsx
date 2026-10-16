import { Select } from "@/components/ui/field"
import {
  MONTH_NAMES,
  yearChoices,
} from "@/screens/finance-final/reports/two-year"

/// The year and the month a two-year report is read up to.
///
/// `month` is `null` until somebody chooses one, and then the default —
/// current month in the current year, December in a year that is over — is
/// what is drawn, so switching the year back to a finished one shows the whole
/// year without the reader having to know to move the month.
export function YearMonthControl({
  year,
  month,
  onYear,
  onMonth,
}: {
  year: number
  month: number
  onYear: (year: number) => void
  onMonth: (month: number) => void
}) {
  return (
    <>
      <Select
        value={String(year)}
        onChange={(next) => onYear(Number(next))}
        className="h-control w-28"
        aria-label="Year"
      >
        {yearChoices().map((choice) => (
          <option key={choice} value={choice}>
            {choice}
          </option>
        ))}
      </Select>
      <span className="text-[0.9375rem] text-mute">up to</span>
      <Select
        value={String(month)}
        onChange={(next) => onMonth(Number(next))}
        className="h-control w-40"
        aria-label="Up to month"
      >
        {MONTH_NAMES.map((name, index) => (
          <option key={name} value={index + 1}>
            {name}
          </option>
        ))}
      </Select>
    </>
  )
}
