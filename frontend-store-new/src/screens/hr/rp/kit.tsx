import { X, ChevronLeft } from "lucide-react"
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import { createPortal } from "react-dom"
import { toast as say } from "sonner"

import "./rp.css"

import { RpContext, type RpApi } from "./context"

/// What the Schedule and Attendance pages share: the frame that holds the
/// toast and the one sheet a page has (the dates and the shift colours are in
/// `dates.ts`). The hub's `screens/people/rp/kit.tsx`, copied — without its
/// strip of stores, because this app is one shop.

// ── the frame: a toast with an Undo ─────────────────────────────────────────

/// The page's frame. The line at the foot is this app's own toast (sonner), so
/// it rises above the phone's dock and looks like every other line the app says.
export function RpFrame({ children }: { children: ReactNode }) {
  const toast = useCallback((text: string, undo?: () => void) => {
    say(text, {
      id: "rp-page",
      duration: 6000,
      action: undo === undefined ? undefined : { label: "Undo", onClick: undo },
    })
  }, [])
  const api = useMemo<RpApi>(() => ({ toast }), [toast])
  return (
    <RpContext.Provider value={api}>
      <div className="rp">{children}</div>
    </RpContext.Provider>
  )
}

/// Draws `children` on the body, still inside a `.rp`, so a sheet or a menu
/// stands over the shell — its bottom bar included — rather than inside the
/// screen's own stacking context.
export function RpPortal({ children }: { children: ReactNode }) {
  return createPortal(<div className="rp">{children}</div>, document.body)
}

/// The one sheet a page has: slides in from the right over a dimmed page. The
/// page owns what is inside it and says when it is open.
export function RpSheet({
  open,
  onClose,
  children,
}: {
  open: boolean
  onClose: () => void
  children: ReactNode
}) {
  const [mounted, setMounted] = useState(false)
  const [entered, setEntered] = useState(false)
  // Mount the moment it is asked for; the slide in and out are the timers'.
  if (open && !mounted) setMounted(true)
  useEffect(() => {
    if (open) {
      // Off-screen for a beat, then in: that is the slide. (A timer, not a
      // frame: a hidden tab holds its frames back and the sheet would never come.)
      const id = window.setTimeout(() => setEntered(true), 30)
      return () => window.clearTimeout(id)
    }
    const id = window.setTimeout(() => {
      setMounted(false)
      setEntered(false)
    }, 220)
    return () => window.clearTimeout(id)
  }, [open])
  const shown = open && entered
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [open, onClose])
  if (!mounted && !open) return null
  return (
    <RpPortal>
      <div className={`scrim${shown ? "" : "off"}`} onPointerDown={onClose} />
      <aside
        className={`sheet${shown ? "" : "off closing"}`}
        role="dialog"
        aria-modal="true"
      >
        {mounted ? children : null}
      </aside>
    </RpPortal>
  )
}

/// The head of a sheet: a title, an optional line under it, and a way out.
export function SheetHead({
  title,
  sub,
  back,
  onClose,
}: {
  title: ReactNode
  sub?: ReactNode
  back?: () => void
  onClose: () => void
}) {
  return (
    <div className="shead">
      {back && (
        <button
          className="icbtn"
          type="button"
          aria-label="Back"
          onClick={back}
        >
          <ChevronLeft className="lucide" />
        </button>
      )}
      {sub ? (
        <div className="who2" style={{ flex: 1 }}>
          <h2>{title}</h2>
          <span className="r num">{sub}</span>
        </div>
      ) : (
        <h2>{title}</h2>
      )}
      <button
        className="icbtn"
        type="button"
        aria-label="Close"
        onClick={onClose}
      >
        <X className="lucide" />
      </button>
    </div>
  )
}
