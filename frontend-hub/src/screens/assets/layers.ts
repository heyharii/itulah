import { useState } from "react"

/// A sheet opened over the asset sheet by local state, for the records that
/// have no address of their own (a paper, a handover, one expense).
///
/// The value is kept after the layer closes: a sheet that lost its record the
/// instant it was asked to close would leave in the middle of its own exit.
/// `session` counts the openings, so a layer that keeps typing or a mode of its
/// own can be keyed by it and start clean each time.
export function useLayer<T>() {
  const [state, setState] = useState<{
    value: T | null
    isOpen: boolean
    session: number
  }>({ value: null, isOpen: false, session: 0 })
  return {
    value: state.value,
    isOpen: state.isOpen,
    session: state.session,
    open: (value: T) =>
      setState((current) => ({
        value,
        isOpen: true,
        session: current.session + 1,
      })),
    close: () => setState((current) => ({ ...current, isOpen: false })),
  }
}
