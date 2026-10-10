import { useCallback, useRef, useState } from "react"

import { Dialog } from "@/components/ui/dialog"

/// Asks "Discard your changes?" once before something throws typed work away.
///
/// The 6 Oct 2026 audit: only 3 of about 15 forms asked before ×, Esc, a swipe
/// down or a tap on the veil closed them, and a sheet that closes under a
/// twelve-field form has taught nobody to type into it twice.
///
/// `<Sheet dirty>` wires it to all four. A screen with its own way out — a Back
/// inside a wizard — uses it directly:
///
/// ```tsx
/// const guard = useDirtyGuard(dirty)
/// <Button onClick={() => guard.request(goBack)}>Back</Button>
/// {guard.dialog}
/// ```
///
/// `request(go)` runs `go` now when nothing is dirty, and otherwise asks; the
/// answer "Keep editing" drops the request, "Discard" runs it. One question per
/// attempt — pressing × again asks again, because the typed work is still
/// there.
export function useDirtyGuard(dirty: boolean) {
  const [asking, setAsking] = useState(false)
  const proceed = useRef<(() => void) | null>(null)

  const request = useCallback(
    (go: () => void) => {
      if (!dirty) {
        go()
        return
      }
      proceed.current = go
      setAsking(true)
    },
    [dirty]
  )

  const dialog = (
    <Dialog
      open={asking}
      onOpenChange={(next) => {
        if (next) return
        setAsking(false)
        proceed.current = null
      }}
      title="Discard your changes?"
      confirm="Discard"
      cancel="Keep editing"
      tone="danger"
      onConfirm={() => {
        const go = proceed.current
        proceed.current = null
        setAsking(false)
        go?.()
      }}
    >
      What you changed has not been saved.
    </Dialog>
  )

  return { request, dialog, asking }
}
