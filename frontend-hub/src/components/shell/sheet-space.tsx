import { useCallback, useState } from "react"

import {
  SheetSpaceContext,
  SheetsOpenContext,
  type SheetSpace as Space,
} from "@/lib/sheet-space"

/// The counter's one writer. What it is for is written in `lib/sheet-space.ts`.
export function SheetSpace({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(0)
  /// Stable for the life of the provider, so a panel's effect fires when the
  /// panel opens or closes and at no other time.
  const claim = useCallback(() => {
    setOpen((count) => count + 1)
    return () => setOpen((count) => Math.max(0, count - 1))
  }, [])
  const [space] = useState<Space>(() => ({ claim }))

  return (
    <SheetSpaceContext.Provider value={space}>
      <SheetsOpenContext.Provider value={open}>
        {children}
      </SheetsOpenContext.Provider>
    </SheetSpaceContext.Provider>
  )
}
