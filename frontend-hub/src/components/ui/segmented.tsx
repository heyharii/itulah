import { Toggle } from "@base-ui/react/toggle"
import { ToggleGroup } from "@base-ui/react/toggle-group"
import { ListFilter } from "lucide-react"
import { createContext, useLayoutEffect, useRef, useState } from "react"

import { DockPortal, useDock } from "@/components/shell/dock"
import { useInDoor } from "@/components/ui/door-status"
import { BottomSheet } from "@/components/ui/picker-sheet"
import { cn } from "@/lib/utils"

/// True around a `Toolbar`'s `lead`: the screen's own tabs, which in a door
/// are a choice wherever the toolbar is drawn — its row, or the Filters sheet.
export const ToolbarLead = createContext(false)

/// The segmented control: switch which slice of one dataset is shown.
///
/// Distinct from `<SubTabs>`, and the distinction is load-bearing. A segment
/// filters one dataset (Payables / Receivables); a sub-tab switches to a
/// different dataset. Using the wrong one tells the reader the wrong thing
/// about what changed.
///
/// Base UI's toggle group draws it: one tab stop, the arrow keys move along
/// the row, and each segment says `aria-pressed`. It is single-select, and a
/// segmented control always has one slice showing — so pressing the segment
/// that is already on, which Base UI reports as "nothing pressed", is ignored
/// rather than passed on as a value the caller has no slice for.
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  className,
}: {
  options: readonly { readonly value: T; readonly label: React.ReactNode }[]
  value: T
  onChange: (value: T) => void
  className?: string
}) {
  const root = useRef<HTMLDivElement>(null)
  const place = useSlidingThumb(root, value)
  return (
    <ToggleGroup
      ref={root}
      value={[value]}
      onValueChange={(next) => {
        const picked = next[0] as T | undefined
        if (picked !== undefined && picked !== value) onChange(picked)
      }}
      // Never wider than what it stands in: a five-way switch is wider than a
      // phone, and it pushed the whole page sideways. On a desk it scrolls
      // inside its own pill, its scrollbar hidden; on a phone it wraps onto a
      // second row instead, because nothing scrolls sideways there (owner,
      // 2026-10-06) — a pill past the edge is a choice nobody sees.
      className={cn(
        "segmented relative inline-flex max-w-full [scrollbar-width:none] overflow-x-auto rounded-inner bg-soft-2 p-0.5 max-md:flex max-md:flex-wrap max-md:overflow-visible [&::-webkit-scrollbar]:hidden",
        place !== null && "has-thumb",
        className
      )}
    >
      {/* The chosen slice's white ground, one piece that SLIDES to the next
          choice (Emil: spatial consistency; Apple's segmented control) rather
          than one segment going white as another goes grey. Transform for the
          travel, width for the size — one small element; the strong
          ease-in-out because it moves on screen; 200ms. Not drawn while the
          pill wraps onto two rows on a phone: there each segment wears its
          own ground, as before. Reduced motion: it jumps. */}
      {place !== null && (
        <span
          aria-hidden
          className={cn(
            "segmented-thumb pointer-events-none absolute top-0.5 bottom-0.5 left-0 rounded-[0.375rem] bg-canvas shadow-soft motion-reduce:transition-none",
            place.animate &&
              "transition-[transform,width] duration-(--t-panel) ease-(--ease-in-out)"
          )}
          style={{
            transform: `translateX(${place.x}px)`,
            width: place.width,
          }}
        />
      )}
      {options.map((option) => (
        <Toggle
          key={option.value}
          value={option.value}
          className={cn(
            "relative z-[1] h-[1.75rem] shrink-0 rounded-[0.375rem] px-2.5 text-meta font-medium whitespace-nowrap transition-colors max-md:grow",
            // Under a finger: 40 inside the pill's 2px rim is a 44px control,
            // and the pseudo-element makes the whole 44 the target, rim
            // included (D1).
            "pointer-coarse:relative pointer-coarse:h-10 pointer-coarse:px-3 pointer-coarse:after:absolute pointer-coarse:after:inset-x-0 pointer-coarse:after:-inset-y-0.5 pointer-coarse:after:content-['']",
            option.value === value
              ? place !== null
                ? "text-ink"
                : "bg-canvas text-ink shadow-soft"
              : "text-body hover:text-ink"
          )}
        >
          {option.label}
        </Toggle>
      ))}
    </ToggleGroup>
  )
}

/// Where the sliding ground stands: under the pressed segment, measured after
/// layout and again when the pill resizes. Null while the segments wrap onto
/// more than one row (a phone), or before the first measure. The first place
/// is set without a transition, so the ground does not fly in on mount.
function useSlidingThumb(
  root: React.RefObject<HTMLDivElement | null>,
  value: string
) {
  const [place, setPlace] = useState<{
    x: number
    width: number
    animate: boolean
  } | null>(null)
  useLayoutEffect(() => {
    const box = root.current
    if (box === null) return
    const measure = () => {
      const segments = [...box.querySelectorAll<HTMLElement>("[aria-pressed]")]
      const chosen = segments.find(
        (one) => one.getAttribute("aria-pressed") === "true"
      )
      const oneRow = segments.every(
        (one) => one.offsetTop === segments[0]?.offsetTop
      )
      if (chosen === undefined || !oneRow) {
        setPlace(null)
        return
      }
      setPlace((was) => ({
        x: chosen.offsetLeft,
        width: chosen.offsetWidth,
        animate: was !== null,
      }))
    }
    measure()
    // Again once the face is in (a label measured in the fallback font is a
    // pixel off), and whenever the pill or any segment changes size.
    void document.fonts?.ready.then(measure)
    const watch = new ResizeObserver(measure)
    watch.observe(box)
    for (const one of box.querySelectorAll("[aria-pressed]")) watch.observe(one)
    return () => watch.disconnect()
  }, [root, value])
  return place
}

/// A row of buttons fused into one pill — "Day / Week / Month", "Export / Print".
/// Unlike `<Segmented>` these are actions, not a selection, so none of them is
/// ever "on".
export function ButtonGroup({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "button-group inline-flex overflow-hidden rounded-inner border border-hairline-2",
        "[&>button]:h-8 [&>button]:px-3 [&>button]:text-[0.9375rem] [&>button]:font-medium [&>button]:text-text pointer-coarse:[&>button]:h-11",
        "[&>button:hover]:bg-soft-2",
        "[&>button+button]:border-l [&>button+button]:border-hairline",
        className
      )}
      {...props}
    />
  )
}

/// The list toolbar: title-adjacent controls, with `<Toolbar.Spacer />` pushing
/// the rest right.
///
/// On a phone, a toolbar is not a row of controls at the top of the page: it is
/// one "Filters" button in the dock over the bottom bar and the sheet it opens,
/// with the controls stacked in it (owner, 2026-10-06: nothing to search or
/// filter at the top, nothing to scroll sideways, the same pattern on every
/// list). Left alone where it already stands in a sheet or a dialog, and where
/// the screen has a dock of its own (`DockTools` claims the search slot) and
/// hides the controls it has moved there.
export function Toolbar({
  className,
  children,
  inline = false,
  lead,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  /// Stay in the page on a phone: for a bar that is not a filter and has no
  /// business in the dock.
  inline?: boolean
  /// The screen's own `SubTabs`, first in the row. Inside a door they are a
  /// choice (`SubTabs`), so the screen keeps one row of tabs — the door's —
  /// and on a phone they are the first choice in the Filters sheet rather
  /// than another button in the dock (owner, 2026-10-16).
  lead?: React.ReactNode
}) {
  const dock = useDock()
  const probe = useRef<HTMLSpanElement>(null)
  /// Whether this toolbar stands inside a sheet or a dialog, found once it is
  /// in the document: nothing above it says so.
  const [inside, setInside] = useState<boolean | null>(null)
  useLayoutEffect(() => {
    setInside(probe.current?.closest('[role="dialog"]') != null)
  }, [])
  const docked =
    !inline &&
    dock?.available === true &&
    inside === false &&
    dock.claimed.search === 0
  const first = lead && (
    <ToolbarLead.Provider value>{lead}</ToolbarLead.Provider>
  )
  if (docked)
    return (
      <DockedToolbar>
        {first}
        {children}
      </DockedToolbar>
    )
  return (
    <div
      className={cn(
        "mb-3.5 flex flex-wrap items-center gap-[0.4375rem]",
        className
      )}
      {...props}
    >
      <span ref={probe} hidden aria-hidden />
      {first}
      {children}
    </div>
  )
}

/// The toolbar as the dock draws it: a button, and a sheet holding the controls.
function DockedToolbar({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  // In a door the dock already carries the door's button, so Filters is the
  // round icon the ⚙ of `DockTools` is: the word would crowd the row.
  const round = useInDoor()
  return (
    <>
      <DockPortal slot="tabs">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          aria-label="Filters"
          className={cn(
            "inline-flex h-11 max-w-full shrink-0 items-center gap-1.5 rounded-full bg-soft-2 text-[0.9375rem] font-medium text-ink transition-[scale] duration-(--t-press) ease-(--ease-out) active:scale-[0.97]",
            round ? "w-11 justify-center" : "pr-4 pl-3.5"
          )}
        >
          <ListFilter className="size-4 shrink-0 text-line-ico" />
          {!round && "Filters"}
        </button>
      </DockPortal>
      <BottomSheet open={open} onOpenChange={setOpen} title="Filters">
        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto overscroll-contain px-4 pb-4 [&>*]:max-w-full [&>*:is(select,input,button)]:w-full">
          {children}
        </div>
      </BottomSheet>
    </>
  )
}

Toolbar.Spacer = function ToolbarSpacer() {
  return <div className="flex-1 max-md:hidden" />
}
