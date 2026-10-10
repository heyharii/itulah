import type React from "react"

/// Whether an input has declared itself a number, and whether fractions are
/// legal in it.
///
/// `inputMode` changes the phone's keyboard and nothing else — on a desktop
/// the browser still waves `-`, `+` and `e` through `type="number"`, and a
/// quantity of `-3` is a stock correction smuggled in through the side door.
/// So a field that says it takes a number is held to its declaration: digits
/// always, and a decimal point only where the field itself said fractions
/// are legal — `inputMode="decimal"`, or a `type="number"` step that is not
/// a whole number.
export function numberFieldOf(
  props: Pick<
    React.ComponentPropsWithRef<"input">,
    "type" | "inputMode" | "step"
  >,
): {
  numeric: boolean
  decimal: boolean
} {
  const numeric =
    props.type === "number" ||
    props.inputMode === "numeric" ||
    props.inputMode === "decimal"
  const decimal =
    props.inputMode === "decimal" ||
    (props.type === "number" &&
      (props.step === "any" ||
        (props.step !== undefined && !Number.isInteger(Number(props.step)))))
  return { numeric, decimal }
}

/// The keys a number field accepts. Everything else is held back on the
/// keystroke, so a minus never reaches the figure — the same
/// refuse-before-the-request rule the giro print's Nudge fields already
/// play. Keys that name themselves — Backspace, Tab, the arrows — are the
/// field's own business; only single characters can smuggle a figure, and a
/// second decimal point has nowhere to go.
export function numberKeyDown(
  decimal: boolean,
  event: React.KeyboardEvent<HTMLInputElement>,
): void {
  if (event.ctrlKey || event.metaKey || event.altKey) return
  if (event.key.length !== 1) return
  const figure = event.key >= "0" && event.key <= "9"
  const point =
    decimal && event.key === "." && !event.currentTarget.value.includes(".")
  if (!figure && !point) event.preventDefault()
}

/// What a number field is holding, as text. Everything that is not a digit is
/// dropped rather than refused — a pasted `Rp 2.000` is somebody telling us
/// the figure, the same courtesy `Money` pays — and the decimal point survives
/// once where fractions are legal, never twice.
export function numberText(text: string, decimal: boolean): string {
  if (!decimal) return text.replace(/\D/g, "")
  const kept = text.replace(/[^0-9.]/g, "")
  const first = kept.indexOf(".")
  return first === -1
    ? kept
    : kept.slice(0, first + 1) + kept.slice(first + 1).replace(/\./g, "")
}
