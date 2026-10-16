import { isoDay, lastDays } from "@/lib/queries"
import { addDays, type Span } from "@/lib/queries/dashboard"

/// The spans the dashboard offers by name, and what one means today.
///
/// Apart from `range-picker.tsx` so that file exports a component and nothing
/// else.

export type PresetId =
  "today" | "yesterday" | "7" | "30" | "91" | "month" | "last-month"

export const PRESETS: readonly {
  readonly id: PresetId
  readonly label: string
}[] = [
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "7", label: "Last 7 days" },
  { id: "30", label: "Last 30 days" },
  // Thirteen whole weeks, so a week is a week all the way back.
  { id: "91", label: "Last 3 months" },
  { id: "month", label: "This month" },
  { id: "last-month", label: "Last month" },
]

/// What is chosen: a name from the list, or two dates typed.
export type Choice =
  | { readonly preset: PresetId }
  | { readonly preset: "custom"; readonly span: Span }

export const DEFAULT_CHOICE: Choice = { preset: "91" }

/// The days a name stands for, reckoned from the clock now.
export function presetSpan(id: PresetId): Span {
  const now = new Date()
  const today = isoDay(now)
  switch (id) {
    case "today":
      return { from: today, to: today }
    case "yesterday": {
      const day = addDays(today, -1)
      return { from: day, to: day }
    }
    case "month":
      return {
        from: isoDay(new Date(now.getFullYear(), now.getMonth(), 1)),
        to: today,
      }
    case "last-month":
      return {
        from: isoDay(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
        to: isoDay(new Date(now.getFullYear(), now.getMonth(), 0)),
      }
    default:
      return lastDays(Number(id))
  }
}

export function spanOf(choice: Choice): Span {
  return choice.preset === "custom" ? choice.span : presetSpan(choice.preset)
}
