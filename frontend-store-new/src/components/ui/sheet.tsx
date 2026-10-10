import { Dialog } from "@base-ui/react/dialog"
import { Drawer } from "@base-ui/react/drawer"
import { X } from "lucide-react"
import { useState } from "react"

import { useLayout } from "@/lib/layout"
import { cn } from "@/lib/utils"

/// The record sheet — the hub's (`frontend-hub/src/components/ui/sheet.tsx`),
/// cut down to what a shop's screens need: a record opened over its list, and a
/// form that is a task rather than a record.
///
/// ## Anatomy
///
///   head   — the record's `id` in mono above the `title`, ONE `badge` (a
///            status `Pill`/`Status`), a quiet `caption` under the title, the
///            ✕, and header `actions` (desk)
///   tabs   — optional sections, a strip under the head; they wrap on a phone
///            rather than scroll sideways
///   body   — scrolls on its own; facts are label over value (`Facts`/`Fact`
///            below), never disabled inputs
///   footer — the record's actions, pinned: on a phone this is where they live
///            (a thumb reaches the bottom), 36px buttons, `variant="primary"`
///            for the one that matters
///
/// ## Where it lands
///
/// On a desk it is the hub's floating rail — inset 20px from the top, right and
/// bottom with the shell's corners and the float shadow, over the white veil
/// (never a dark dim). On a phone it rises from the bottom edge as a Vaul-style
/// sheet that stops short of the top, so the list it came from still shows
/// above it; a pull down puts it away. Escape closes it on a desk. Base UI's
/// Drawer keeps the keyboard below the footer, so a form's button rides above
/// it.
///
/// What it leaves behind is the hub's machinery a shop has no use for: the
/// beside-the-list column on a monitor (this shell reserves no space for it)
/// and the record's comment panel.
export function Sheet({
  open,
  onOpenChange,
  title,
  id,
  caption,
  actions,
  badge,
  footer,
  tabs,
  tab: shown,
  onTabChange,
  width = "rail",
  children,
  className,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: React.ReactNode
  /// The record's own identifier, set in mono above the title.
  id?: React.ReactNode
  /// One quiet line UNDER the title: where this record came from, and when.
  caption?: React.ReactNode
  /// What the record IS, beside its name — ONE status badge. In the head
  /// rather than the body because it is read before anything else and does not
  /// belong to any one section.
  badge?: React.ReactNode
  /// At most two, plus an overflow — pinned in the header on a desk. On a
  /// phone they drop to a row under the title, so a screen puts the same
  /// actions in `footer` there instead.
  actions?: React.ReactNode
  /// The record's actions, or the form's buttons, pinned under the body. Buttons
  /// in the foot are one height on every screen — 36px — whatever the pointer:
  /// a thumb-tall bar of them read as oversized (owner, 2026-10-05).
  footer?: React.ReactNode
  /// The record's sections, when it has more than one thing to say. The strip
  /// sits between the head and the body, outside the scroll, so the sections do
  /// not scroll away from each other.
  tabs?: readonly {
    readonly value: string
    readonly label: React.ReactNode
    readonly content: React.ReactNode
  }[]
  /// Which section is showing, when the caller needs to move it. Left out, the
  /// sheet keeps it to itself, which is what nearly every sheet wants.
  tab?: string | null
  onTabChange?: (tab: string) => void
  /// `rail` for a record, `wide` for a form somebody writes a sentence into:
  /// two thirds of the window, never narrower than the rail.
  width?: "rail" | "wide"
  children?: React.ReactNode
  className?: string
}) {
  const phone = useLayout() === "phone"
  // Which section is showing. Kept here rather than by the caller because the
  // caller would have to reset it every time a different record opens in the
  // same sheet — the tab you left on the last record is not a question you are
  // still asking about this one.
  const [own, setOwn] = useState<string | null>(null)
  const tab = shown !== undefined ? shown : own
  const setTab = (value: string) => {
    setOwn(value)
    onTabChange?.(value)
  }
  const [seen, setSeen] = useState({ id, open })
  if (seen.id !== id || seen.open !== open) {
    setSeen({ id, open })
    setOwn(null)
  }
  const here = tabs?.find((one) => one.value === tab) ?? tabs?.[0] ?? null

  /// What the sheet holds — head, tabs, body, foot — drawn by either shell: the
  /// desk's Dialog or the phone's Drawer, whose Title and Close parts are
  /// passed in so each is wired to its own root.
  const body = (Parts: {
    Title: React.ElementType
    Close: React.ElementType
  }) => (
    <>
      <div
        className={cn(
          "flex shrink-0 flex-wrap items-center gap-x-4 gap-y-3 border-b border-hairline px-4 py-4 md:flex-nowrap md:px-7",
          // A sheet with tabs gets a header of its own, with room: the title
          // is not the first tab's lid.
          tabs ? "md:py-5" : "md:py-3",
        )}
      >
        <div className="min-w-0 flex-1">
          {id !== undefined && (
            <div className="mb-0.5 truncate font-mono text-id text-body">
              {id}
            </div>
          )}
          <div className="flex min-w-0 items-center gap-2.5">
            <Parts.Title className="truncate text-[1rem] leading-6 font-semibold tracking-[-0.01em] text-ink">
              {title}
            </Parts.Title>
            {badge !== undefined && <span className="shrink-0">{badge}</span>}
          </div>
          {caption !== undefined && (
            <div className="mt-0.5 truncate text-meta text-mute">{caption}</div>
          )}
        </div>
        {actions !== undefined && (
          <div className="flex shrink-0 items-center gap-1.5 max-md:order-3 max-md:w-full max-md:flex-wrap">
            {actions}
            <span
              aria-hidden
              className="mx-0.5 h-5 w-px bg-hairline max-md:hidden"
            />
          </div>
        )}
        <Parts.Close
          aria-label="Close"
          className="grid size-8 shrink-0 place-items-center rounded-inner text-line-ico transition-colors hover:bg-soft-2 hover:text-ink max-md:order-2 pointer-coarse:size-tap"
        >
          <X className="size-4" />
        </Parts.Close>
      </div>
      {tabs !== undefined && here !== null && (
        <nav
          role="tablist"
          aria-label="Record sections"
          className="flex shrink-0 [scrollbar-width:none] items-stretch gap-2 overflow-x-auto border-b border-hairline px-4 max-md:flex-wrap max-md:gap-x-3 max-md:overflow-visible md:px-7 [&::-webkit-scrollbar]:hidden"
        >
          {tabs.map((section) => {
            const current = section.value === here.value
            return (
              <button
                key={section.value}
                role="tab"
                type="button"
                aria-selected={current}
                onClick={() => setTab(section.value)}
                className={cn(
                  "-mb-px inline-flex h-12 shrink-0 items-center gap-1.5 border-b-2 px-3 text-[0.9375rem] font-medium whitespace-nowrap transition-colors",
                  current
                    ? "border-accent font-semibold text-accent"
                    : "border-transparent text-body hover:text-ink",
                  "pointer-coarse:h-tap",
                )}
              >
                {section.label}
              </button>
            )
          })}
        </nav>
      )}
      {/* Keyed on the section, so a different tab starts at its own top rather
          than wherever the last one was scrolled to. */}
      <div
        key={here?.value}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-6 md:px-7 md:py-8"
      >
        {tabs !== undefined && here !== null ? here.content : children}
      </div>
      {footer !== undefined && (
        // Buttons in the foot are one height on every screen — 36px, the
        // desk's — whatever the pointer.
        <div className="shrink-0 border-t border-hairline px-4 py-3 md:px-7 md:py-3.5 [&_button]:h-9">
          {footer}
        </div>
      )}
    </>
  )

  // A phone: a sheet in the Vaul sense. It rises from the bottom edge and stops
  // short of the top — the page it came from still shows as a strip above it —
  // carries a grip, and a pull down puts it away.
  if (phone) {
    return (
      <Drawer.Root open={open} onOpenChange={onOpenChange}>
        <Drawer.VirtualKeyboardProvider>
          <Drawer.Portal>
            <Drawer.Backdrop
              forceRender
              className="fixed inset-0 z-40 bg-[var(--scrim)] opacity-[calc(1-var(--drawer-swipe-progress,0))] transition-opacity duration-(--t-drawer) ease-(--ease-out) data-[ending-style]:opacity-0 data-[ending-style]:duration-(--t-exit) data-[starting-style]:opacity-0 data-[swiping]:transition-none"
            />
            <Drawer.Viewport className="fixed inset-0 z-40 flex items-end pb-[var(--drawer-keyboard-inset,0px)]">
              <Drawer.Popup
                className={cn(
                  "flex w-full flex-col overflow-hidden rounded-t-sheet border-t border-hairline bg-canvas pb-[env(safe-area-inset-bottom)] shadow-float outline-none",
                  // Up to 12px under the notch, less whatever the keyboard
                  // takes, so the foot's buttons ride above it.
                  "h-[calc(100dvh-env(safe-area-inset-top,0px)-0.75rem-var(--drawer-keyboard-inset,0px))]",
                  // Up from the bottom edge on the iOS sheet curve, back down
                  // it faster. The finger's drag is `--drawer-swipe-movement-y`
                  // on `transform`, apart from the enter/exit on `translate`,
                  // so a let-go mid-drag settles from where the sheet actually
                  // is rather than snapping.
                  "[transform:translateY(var(--drawer-swipe-movement-y,0px))] transition-[translate,transform] duration-(--t-drawer) ease-(--ease-drawer) data-[ending-style]:duration-(--t-exit)",
                  "data-[ending-style]:translate-y-full data-[starting-style]:translate-y-full data-[swiping]:transition-none",
                  "motion-reduce:data-[ending-style]:translate-none motion-reduce:data-[starting-style]:translate-none",
                  className,
                )}
              >
                <div aria-hidden className="flex shrink-0 justify-center pt-2">
                  <span className="h-1 w-9 rounded-full bg-hairline-strong" />
                </div>
                {body(Drawer)}
              </Drawer.Popup>
            </Drawer.Viewport>
          </Drawer.Portal>
        </Drawer.VirtualKeyboardProvider>
      </Drawer.Root>
    )
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-[var(--scrim)] transition-opacity duration-(--t-sheet) ease-(--ease-out) data-[ending-style]:opacity-0 data-[ending-style]:duration-(--t-exit) data-[starting-style]:opacity-0" />
        <Dialog.Popup
          className={cn(
            "fixed top-5 right-5 bottom-5 z-40 flex max-w-[calc(100vw-2.5rem)] flex-col overflow-hidden rounded-shell border border-hairline bg-canvas shadow-float outline-none",
            // From the edge it lives on, and back there on the way out —
            // translate only, faster leaving than arriving. Reduced motion
            // keeps a fade and drops the travel.
            "transition-[translate,opacity] duration-(--t-sheet) ease-(--ease-drawer) data-[ending-style]:duration-(--t-exit)",
            "data-[ending-style]:translate-x-[calc(100%+1.25rem)] data-[starting-style]:translate-x-[calc(100%+1.25rem)]",
            "motion-reduce:data-[ending-style]:translate-none motion-reduce:data-[ending-style]:opacity-0 motion-reduce:data-[starting-style]:translate-none motion-reduce:data-[starting-style]:opacity-0",
            width === "wide"
              ? "w-[clamp(27.5rem,72vw,56rem)]"
              : "w-[clamp(27.5rem,62vw,47.5rem)]",
            className,
          )}
        >
          {body(Dialog)}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

/// The two-column fact grid a record detail leads with: a plain term over its
/// tabular value, label/value — never a disabled input.
export function Facts({
  className,
  ...props
}: React.HTMLAttributes<HTMLDListElement>) {
  return (
    <dl
      className={cn("grid grid-cols-2 gap-x-4 gap-y-3.5", className)}
      {...props}
    />
  )
}

export function Fact({
  term,
  wide = false,
  children,
}: {
  term: React.ReactNode
  /// Spans both columns — an address, a note.
  wide?: boolean
  children: React.ReactNode
}) {
  return (
    <div className={cn("min-w-0", wide && "col-span-2")}>
      {/* `body`, not `faint`: the term is the half that says what the number
          means, and it cannot be the half that disappears. */}
      <dt className="text-[0.875rem] leading-[1.125rem] text-body">{term}</dt>
      <dd
        className={cn(
          "mt-[0.3125rem] text-[0.875rem] leading-[1.375rem] text-ink tabular-nums",
          !wide && "truncate",
        )}
      >
        {children}
      </dd>
    </div>
  )
}
