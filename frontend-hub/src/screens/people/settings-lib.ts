import { useState } from "react"

/// What the Settings pages share that is not a component.
///
/// Every page here is a list, and every create / edit / detail is a Sheet that
/// the page opens from `useState`. A sheet is mounted for as long as the page
/// is, so the form inside it would keep what was typed the last time it was
/// opened; the `n` counter is the answer — use it in the sheet's `key` and a
/// freshly opened sheet starts blank, while a closing one keeps its exit
/// animation.
export interface Opener<T> {
  readonly isOpen: boolean
  readonly item: T | null
  readonly n: number
  show: (item?: T) => void
  hide: () => void
}

export function useOpener<T = never>(): Opener<T> {
  const [state, setState] = useState<{
    open: boolean
    item: T | null
    n: number
  }>({ open: false, item: null, n: 0 })
  return {
    isOpen: state.open,
    item: state.item,
    n: state.n,
    show: (item) =>
      setState((prev) => ({ open: true, item: item ?? null, n: prev.n + 1 })),
    hide: () => setState((prev) => ({ ...prev, open: false })),
  }
}

/// Digits only, as a whole number, or `null` when there are none.
export function digits(raw: string): number | null {
  const only = raw.replace(/\D/g, "")
  return only === "" ? null : Number(only)
}

/// A percent typed as a payroll officer writes it — `0,24` or `2` — in
/// hundredths of a percent. `null` when it is not a number.
export function bpOf(raw: string): number | null {
  const value = Number(raw.replace(",", ".").trim())
  return raw.trim() === "" || !Number.isFinite(value)
    ? null
    : Math.round(value * 100)
}
