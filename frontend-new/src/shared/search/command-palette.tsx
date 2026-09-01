/**
 * Global search, as a command palette.
 *
 * The point of this component is the one thing a per-screen search box can
 * never do: find a record **from anywhere** and land on it with its detail
 * sheet open — an article while you are in accounting, a supplier while you are
 * counting stock.
 *
 * It works because every detail sheet in this app already reads an `open` search
 * param, and because `record_type` is a stable fact about a record while
 * `route_path` is not (see `./routes.ts`). So the palette navigates to
 * `{ to, search: { open: recordId } }` and the destination screen opens the
 * sheet on arrival, without knowing search exists.
 *
 * Mounted once in the app shell. Opened with ⌘K / Ctrl-K.
 *
 * ## Why this file is only the hotkey
 *
 * It is mounted on every screen and opened on almost none of them, but it used
 * to pull `cmdk` and the whole `ui/command` tree into the entry chunk — bytes
 * every user downloads before the first screen paints, to render nothing.
 *
 * So the dialog lives in `./palette-dialog` behind `lazy()`, and this shell
 * keeps only what has to be live from the first keystroke: the open state and
 * the ⌘K listener. Measured: this moved 117 kB out of the entry chunk.
 *
 * The chunk is then warmed the moment a modifier key goes down, which is the
 * earliest honest signal of intent — ⌘K sends `Meta` before it sends `k`, so
 * the fetch starts a keystroke before it is needed and the palette still opens
 * without a visible wait. A timer would have been simpler and worse: it
 * downloads the chunk on the floor iPads, which have no ⌘K and will never open
 * this, and on every idle tab.
 */

import { Suspense, lazy, useEffect, useState } from "react"

const PaletteDialog = lazy(() => import("./palette-dialog"))

/* Import returns the same promise once started, so repeated calls are free and
 * no "already warmed" flag is needed. */
const warm = () => void import("./palette-dialog")

export function CommandPalette() {
  const [open, setOpen] = useState(false)
  /* Stays true once opened, so closing the palette does not unmount the dialog
   * and replay its enter animation from scratch the next time. */
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      /* Meta/Control going down is the head start: the browser fetches the
       * chunk while the user is still reaching for `k`. */
      if (event.key === "Meta" || event.key === "Control") {
        warm()
        return
      }

      if (event.key === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        setMounted(true)
        setOpen((value) => !value)
      }
    }

    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [])

  if (!mounted) return null

  return (
    <Suspense fallback={null}>
      <PaletteDialog open={open} onOpenChange={setOpen} />
    </Suspense>
  )
}
