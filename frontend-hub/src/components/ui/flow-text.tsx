import NumberFlow, { NumberFlowGroup } from "@number-flow/react"

/// A figure that rolls to its next value instead of being swapped (owner,
/// 2026-10-15: "untuk kpi … number flow untuk motionnya"). Purpose: state
/// indication — a KPI that changes with a tab, a filter or a refresh says so.
///
/// The screens hand a KPI its value already written ("Rp 42,7 M", "18 / 18
/// pcs", "20 Oct 2026"), so this reads the numbers back out of the text and
/// rolls only them, each in exactly the form it was written: dots for
/// thousands where the text had them, a comma and as many decimals as it had,
/// no grouping where there was none (a year stays 2026). The words around
/// them stand still.
///
/// Motion: transform and opacity only, the app's strong ease-out, 300ms — a
/// UI figure, not a show. NumberFlow honours prefers-reduced-motion itself.
const EASE = "cubic-bezier(0.23, 1, 0.32, 1)"
const TIMING = { duration: 300, easing: EASE }
const FADE = { duration: 200, easing: "ease-out" }

/// "1.800.000", "42,7", "18" — a run of digits with Indonesian separators.
const NUMBER = /\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:,\d+)?/g

export function FlowText({ text }: { text: string }) {
  const parts: React.ReactNode[] = []
  let last = 0
  let index = 0
  for (const match of text.matchAll(NUMBER)) {
    const at = match.index ?? 0
    if (at > last) parts.push(text.slice(last, at))
    const raw = match[0]
    const [whole, fraction = ""] = raw.split(",")
    const value = Number(`${whole.replaceAll(".", "")}.${fraction || "0"}`)
    parts.push(
      <NumberFlow
        key={index++}
        value={value}
        locales="id-ID"
        format={{
          useGrouping: whole.includes("."),
          minimumFractionDigits: fraction.length,
          maximumFractionDigits: fraction.length,
        }}
        transformTiming={TIMING}
        spinTiming={TIMING}
        opacityTiming={FADE}
      />
    )
    last = at + raw.length
  }
  if (last < text.length) parts.push(text.slice(last))
  // One group: numbers in the same figure roll together.
  return <NumberFlowGroup>{parts}</NumberFlowGroup>
}
