import { useState, type ReactNode } from "react"
import { createPortal } from "react-dom"

/// The name of an icon, said the moment the pointer — or the keyboard — is on
/// it (the owner, 2026-10-05: a hover for the rail's icons).
///
/// The browser's own `title` waits about a second and says nothing at all in
/// the desktop shell, and a rail of icons is looked at forty times a day, so the
/// label is instant and does not animate. Drawn through a portal at the icon's
/// edge, because the rail scrolls and would clip a bubble drawn inside it.
/// Wraps its child without a box of its own (`display: contents`), so the rail's
/// layout is exactly what it was.
export function RailTip({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null)
  const show = (target: EventTarget & HTMLElement) => {
    const anchor = target.firstElementChild
    if (anchor === null) return
    const box = anchor.getBoundingClientRect()
    setAt({ x: box.right + 10, y: box.top + box.height / 2 })
  }
  return (
    <span
      className="contents"
      onPointerOver={(event) => show(event.currentTarget)}
      onPointerOut={() => setAt(null)}
      onFocus={(event) => show(event.currentTarget)}
      onBlur={() => setAt(null)}
    >
      {children}
      {at !== null &&
        createPortal(
          <span
            role="tooltip"
            style={{ left: at.x, top: at.y }}
            className="pointer-events-none fixed z-[70] -translate-y-1/2 rounded-inner bg-ink px-2.5 py-1.5 text-[0.875rem] leading-none font-medium whitespace-nowrap text-canvas shadow-float"
          >
            {label}
          </span>,
          document.body,
        )}
    </span>
  )
}
