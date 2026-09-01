/**
 * The frame every app screen sits in: the 240-ish px navigation rail on the
 * left, the content pane on the right.
 *
 * Fourteen screens each hand-rolled the same two elements —
 *
 *     <div className={cn("grid h-dvh", railHidden ? … : "grid-cols-[240px_minmax(0,1fr)]")}>
 *       <div className={cn("h-full min-h-0", railHidden && "invisible")}>…</div>
 *       <main>…</main>
 *     </div>
 *
 * — with no responsive behaviour at all, so below about 1024px the fixed
 * 240px track plus the 52px app rail left the content pane 83px wide at a
 * 375px viewport. Nothing inside a pane that narrow can lay itself out; the
 * screens were not misbehaving, the frame was.
 *
 * Below `lg` the navigation track collapses to nothing and its contents move
 * into a modal drawer, opened by `<SidebarTrigger />` in the pane's own
 * header. At `lg` and above this renders exactly the markup quoted above —
 * same elements, same classes, same order — so the desktop layout is not
 * merely close to what it was, it is the same DOM.
 *
 * The drawer is a real `<dialog>` opened with `showModal()`. That buys the
 * focus trap, the inert background, the Escape key and the `::backdrop`
 * from the platform rather than from a pile of listeners.
 */

import { useRouterState } from "@tanstack/react-router"
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react"

import { Icon } from "@/components/dashboard/parts"
import { useIsDesktop } from "@/lib/breakpoint"
import { cn } from "@/lib/utils"

/** Matches `w-[52px]` on `<AppRail>`; the drawer starts to its right. */
const RAIL_WIDTH = 52

interface ShellContextValue {
  desktop: boolean
  open: boolean
  label: string
  railWidth: number
  openDrawer: () => void
  closeDrawer: () => void
  openerRef: React.RefObject<HTMLButtonElement | null>
}

const ShellContext = createContext<ShellContextValue | null>(null)

function useShell(caller: string) {
  const ctx = use(ShellContext)
  if (!ctx) throw new Error(`<${caller}> must be rendered inside <AppShell>`)
  return ctx
}

export function AppShell({
  cols,
  label,
  railWidth = 240,
  className,
  children,
}: {
  /**
   * The desktop `grid-template-columns` utility, written as a literal in the
   * calling screen so Tailwind can see it (the rail is 240px on most apps,
   * 232px on Buying, 236px on Chat, and 0px while collapsed).
   */
  cols: string
  /** Names the drawer for assistive technology, e.g. "Commercial navigation". */
  label: string
  railWidth?: number
  className?: string
  children: React.ReactNode
}) {
  const desktop = useIsDesktop()
  const openerRef = useRef<HTMLButtonElement | null>(null)

  /* Openness is stored as the URL it was opened at, so navigating away closes
   * the drawer by arithmetic rather than by an effect that races the route
   * change. Crossing to desktop closes it for the same reason. */
  const href = useRouterState({ select: (s) => s.location.href })
  const [openedAt, setOpenedAt] = useState<string | null>(null)
  const open = !desktop && openedAt !== null && openedAt === href

  const openDrawer = useCallback(() => setOpenedAt(href), [href])
  const closeDrawer = useCallback(() => setOpenedAt(null), [])

  return (
    <ShellContext
      value={{
        desktop,
        open,
        label,
        railWidth,
        openDrawer,
        closeDrawer,
        openerRef,
      }}
    >
      <div
        className={cn(
          "grid h-dvh",
          desktop ? cols : "grid-cols-[minmax(0,1fr)]",
          className
        )}
      >
        {children}
      </div>
    </ShellContext>
  )
}

/**
 * Wraps a screen's `<aside>`. On desktop it is the plain grid cell it always
 * was; below `lg` the same children are rendered inside the drawer instead.
 */
export function AppShellSidebar({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
}) {
  const { desktop } = useShell("AppShellSidebar")

  if (desktop) {
    return <div className={cn("h-full min-h-0", className)}>{children}</div>
  }
  return <SidebarDrawer>{children}</SidebarDrawer>
}

function SidebarDrawer({ children }: { children: React.ReactNode }) {
  const { open, label, railWidth, closeDrawer, openerRef } =
    useShell("AppShellSidebar")
  const dialogRef = useRef<HTMLDialogElement | null>(null)

  /* Drive the element from the state, not the other way round. `showModal()`
   * is what puts the dialog in the top layer, and the top layer is what makes
   * the focus trap and the inert background real. */
  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  /* Escape and the backdrop both fire `close` on the element; the state has to
   * follow, and focus has to land back on the control that opened it. */
  const onClose = useCallback(() => {
    closeDrawer()
    openerRef.current?.focus()
  }, [closeDrawer, openerRef])

  return (
    <dialog
      ref={dialogRef}
      aria-label={label}
      onClose={onClose}
      onCancel={onClose}
      onClick={(event) => {
        /* A click that lands on the dialog box itself is a click on the area
         * outside the panel — the panel is a child and would be the target
         * otherwise. */
        if (event.target === dialogRef.current) closeDrawer()
      }}
      className={cn(
        "m-0 h-dvh max-h-none w-dvw max-w-none border-0 bg-transparent p-0 text-ink outline-none",
        "backdrop:bg-[color-mix(in_srgb,var(--ink)_38%,transparent)]",
        "backdrop:animate-in backdrop:duration-150 backdrop:fade-in",
        "motion-reduce:backdrop:animate-none"
      )}
    >
      {/* The panel is inset by the app rail's width, so the rail stays legible
       * behind the backdrop and is one tap away the moment the drawer closes. */}
      <div
        style={{
          width: railWidth,
          marginLeft: RAIL_WIDTH,
          maxWidth: `calc(100dvw - ${RAIL_WIDTH}px)`,
        }}
        className={cn(
          "flex h-full flex-col overflow-hidden bg-page shadow-card",
          "animate-in duration-200 ease-out slide-in-from-left motion-reduce:animate-none"
        )}
      >
        {children}
      </div>
    </dialog>
  )
}

/**
 * The control that opens the drawer. Renders nothing on desktop, where the
 * navigation is already on screen — which is also why dropping it into a
 * screen's header cannot change that screen at `lg`.
 */
export function SidebarTrigger({ className }: { className?: string }) {
  /* Tolerant of a missing shell on purpose: panes like `<OrdersPane>` are
   * mounted by one screen today and could be mounted outside one tomorrow. */
  const ctx = use(ShellContext)
  if (!ctx || ctx.desktop) return null
  const { open, label, openDrawer, openerRef } = ctx

  return (
    <button
      ref={openerRef}
      type="button"
      aria-label={`Open ${label}`}
      aria-haspopup="dialog"
      aria-expanded={open}
      onClick={openDrawer}
      className={cn(
        "grid size-[30px] shrink-0 place-items-center rounded-control text-ink-3 transition-colors duration-[120ms] hover:bg-hover hover:text-ink",
        className
      )}
    >
      <Icon path={<path d="M4 7h16M4 12h16M4 17h16" />} size={18} />
    </button>
  )
}
