import { createContext, useMemo, useState } from "react"

/// Which allotment rows are opened out to show their goods.
export interface Expanding {
  readonly isOpen: (id: string) => boolean
  readonly toggle: (id: string) => void
}

export const ExpandContext = createContext<Expanding | null>(null)

/// Which allotments are opened out, and the context their chevrons read.
export function useExpanding() {
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set())
  const expanding = useMemo<Expanding>(
    () => ({
      isOpen: (id) => open.has(id),
      toggle: (id) =>
        setOpen((was) => {
          const next = new Set(was)
          if (!next.delete(id)) next.add(id)
          return next
        }),
    }),
    [open]
  )
  return expanding
}
