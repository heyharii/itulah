import { useEffect, useRef } from "react"
import { motion, useReducedMotion } from "motion/react"

import { Icon, paths } from "@/components/dashboard/parts"
import { IconButton } from "@/components/dashboard/nav-sidebar"
import { EASE_DRAWER, EASE_OUT } from "@/lib/ease"
import { cn } from "@/lib/utils"

// The scrim and the panel land on the same beat: fast enough that a sheet
// never reads as something the user waited on, distinct enough from a hard
// cut that it reads as a layer sliding into the stack rather than a page
// swap. EASE_DRAWER is the same curve the codebase already uses for other
// off-canvas panels (see animated-sidebar.tsx), reused rather than invented.
const SCRIM_TRANSITION = { duration: 0.16, ease: EASE_OUT } as const
const PANEL_TRANSITION = { duration: 0.18, ease: EASE_DRAWER } as const
const REDUCED_TRANSITION = { duration: 0 } as const

interface SheetShellProps {
  open: boolean
  eyebrow: string
  title: React.ReactNode
  /** Called by the scrim, the close button and Escape. Guard it if needed. */
  onRequestClose: () => void
  /** Focused once the slide has started, so the caret does not jump. */
  initialFocus?: React.RefObject<HTMLElement | null>
  footer?: React.ReactNode
  children: React.ReactNode
  /** Rendered above the footer — used for the discard confirmation. */
  overlay?: React.ReactNode
  /** `wide` suits a picker that needs a grid rather than a column. */
  size?: "default" | "wide"
}

/**
 * The shared slide-over. It sits inside the same 8px inset as the rest of the
 * shell, so it reads as another surface in the stack rather than a modal
 * bolted on top of it. Detail and form both use it, so they cannot drift.
 */
export function SheetShell({
  open,
  eyebrow,
  title,
  onRequestClose,
  initialFocus,
  footer,
  children,
  overlay,
  size = "default",
}: SheetShellProps) {
  const sheetRef = useRef<HTMLElement>(null)
  const restoreTo = useRef<HTMLElement | null>(null)
  const reduce = useReducedMotion()

  useEffect(() => {
    if (!open) return
    restoreTo.current = document.activeElement as HTMLElement
    const t = setTimeout(() => {
      const target = initialFocus?.current ?? sheetRef.current?.querySelector<HTMLElement>("button")
      target?.focus()
    }, 60)
    return () => clearTimeout(t)
  }, [open, initialFocus])

  // Escape closes, and Tab stays inside the sheet while it owns the screen
  useEffect(() => {
    if (!open) return

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        onRequestClose()
        return
      }
      if (event.key !== "Tab" || !sheetRef.current) return

      const list = [
        ...sheetRef.current.querySelectorAll<HTMLElement>(
          'button, input, textarea, select, a[href], [tabindex]:not([tabindex="-1"])'
        ),
      ].filter((el) => !(el as HTMLButtonElement).disabled && el.offsetParent !== null)
      if (!list.length) return

      const first = list[0]
      const last = list[list.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [open, onRequestClose])

  const close = () => {
    restoreTo.current?.focus?.()
    onRequestClose()
  }

  return (
    <>
      <motion.div
        onClick={close}
        initial={false}
        animate={{ opacity: open ? 1 : 0 }}
        transition={reduce ? REDUCED_TRANSITION : SCRIM_TRANSITION}
        className={cn(
          "fixed inset-0 z-60 bg-[rgb(18_18_18/.28)] backdrop-blur-[1.5px]",
          open ? "" : "pointer-events-none"
        )}
      />

      <motion.aside
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === "string" ? title : eyebrow}
        aria-hidden={!open}
        initial={false}
        animate={{ x: open ? 0 : "110%" }}
        transition={reduce ? REDUCED_TRANSITION : PANEL_TRANSITION}
        className={cn(
          "fixed top-2 right-2 bottom-2 z-61 flex flex-col overflow-hidden rounded-card bg-surface",
          size === "wide"
            ? "w-[min(1000px,calc(100vw-16px))]"
            : "w-[min(452px,calc(100vw-16px))]",
          "shadow-[0_0_0_1px_var(--line-strong),0_40px_80px_-32px_rgb(18_18_18/.4)]"
        )}
      >
        <div className="flex shrink-0 items-start gap-2.5 border-b border-line py-4 pr-3 pb-3.5 pl-[18px]">
          <div className="min-w-0 flex-1">
            <div className="text-[10.5px] font-semibold tracking-[0.05em] text-ink-4 uppercase">
              {eyebrow}
            </div>
            <div className="truncate pt-[3px] text-base font-semibold tracking-[-0.015em]">
              {title}
            </div>
          </div>
          <IconButton label="Close" onClick={close}>
            <Icon path={paths.close} size={15} width={2} />
          </IconButton>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">{children}</div>

        {overlay}

        {footer && (
          <div className="flex shrink-0 items-center gap-2 border-t border-line bg-surface px-3.5 py-3">
            {footer}
          </div>
        )}
      </motion.aside>
    </>
  )
}

export const sheetButton = {
  secondary:
    "inline-flex h-[30px] items-center gap-1.5 rounded-control bg-surface px-2.5 text-xs font-medium text-ink shadow-btn transition-colors duration-[120ms] hover:bg-hover",
  primary:
    "inline-flex h-[30px] items-center gap-1.5 rounded-control bg-accent px-2.5 text-xs font-medium text-white shadow-[0_1px_2px_rgb(0_134_252/.3)] transition-[filter] duration-[120ms] hover:brightness-105",
}
