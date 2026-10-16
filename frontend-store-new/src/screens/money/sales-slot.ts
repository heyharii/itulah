import { useState } from "react"

/// A sheet that opens on a record and keeps drawing that record while it
/// leaves. `hide` only closes it: the value stays, so the sheet's exit plays
/// with its content still in it instead of emptying first.
///
/// `generation` counts the openings. A sheet that holds a form is keyed on it,
/// so the next opening starts from nothing instead of from what the last one
/// left typed in.
export function useSlot<T>(): {
  value: T | null
  open: boolean
  generation: number
  show: (value: T) => void
  hide: () => void
} {
  const [value, setValue] = useState<T | null>(null)
  const [open, setOpen] = useState(false)
  const [generation, setGeneration] = useState(0)
  return {
    value,
    open,
    generation,
    show: (next) => {
      setValue(next)
      setGeneration((was) => was + 1)
      setOpen(true)
    },
    hide: () => setOpen(false),
  }
}
