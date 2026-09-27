// Shared in shape with frontend-hub's `components/ui/picker-sheet.tsx`: the
// same sheet, motion and keyboard handling, so a choice made on the floor
// and one made at the desk rise, settle and swipe away identically. Kept as
// a copy (the two apps share no UI package yet) — change both together.
import { Drawer } from "@base-ui/react/drawer"
import { Check, ChevronLeft, Plus, Search } from "lucide-react"
import { useLayoutEffect, useMemo, useRef, useState } from "react"

import { cn } from "@/lib/utils"

/// A choice made on a phone, from the bottom of the glass.
///
/// On a desk a dropdown is a panel hanging off the field, and that is right:
/// the pointer is already there. On a phone the same panel was a 13rem box
/// under a field the keyboard had just covered half of, with 30px rows for a
/// thumb, and a multi-pick that did not close when you tapped away from it.
/// So under 48rem on a touch screen every picker in the app — `<Select>`,
/// `<PickOne>`, `<PickMany>` — opens this instead: a sheet up from the bottom
/// edge, rows a thumb can hit, a search box when the list is long enough to
/// need one, and a swipe down to put it away.
///
/// **Not the platform's own picker.** A `<select>` would give the iPhone its
/// wheel and Android its dialog, and the two would behave differently for the
/// same form — and neither can search, hold several values, or offer "Create a
/// new supplier" at the foot of the list. The people using this carry both.
///
/// **Base UI's Drawer, not vaul.** Every dialog in this app is Base UI; a
/// second dialog library would bring its own focus trap, scroll lock and
/// Escape handling to disagree with the first. The Drawer brings the swipe,
/// and `VirtualKeyboardProvider` keeps the sheet above the keyboard while the
/// search box has it.

export interface SheetOption {
  readonly value: string
  readonly label: React.ReactNode
  /// What the search box matches against, when the label is not a string.
  readonly text?: string
  readonly disabled?: boolean
  readonly leading?: React.ReactNode
}

/// Above this many options the sheet carries a search box. Eight rows fit on
/// the shortest phone without scrolling; past that, typing three letters is
/// faster than reading.
const SEARCH_ABOVE = 8

export function PickerSheet({
  open,
  onOpenChange,
  title,
  options,
  selected,
  multiple = false,
  onPick,
  action,
  searchable: search,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /// What is being chosen — the field's own label. Read aloud as the dialog's
  /// name, and the only way a sheet that covers the form says which field of
  /// it this is.
  title: string
  options: readonly SheetOption[]
  selected: readonly string[]
  /// Several may be chosen: a tap toggles and the sheet stays until Done.
  multiple?: boolean
  onPick: (value: string) => void
  action?: {
    readonly label: string
    readonly onSelect: () => void
  }
  /// Whether the sheet carries a search box. By default only a long list
  /// does; a typeahead's list (`<PickOne>`, `<PickMany>`) always does, because
  /// it is a vocabulary that grows — six suppliers today is sixty next year,
  /// and the box should not appear the day somebody needs it.
  searchable?: boolean
}) {
  const [query, setQuery] = useState("")
  const searchable = search ?? options.length > SEARCH_ABOVE
  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (needle === "") return options
    return options.filter((one) =>
      (one.text ?? (typeof one.label === "string" ? one.label : one.value))
        .toLowerCase()
        .includes(needle),
    )
  }, [options, query])

  const pick = (value: string) => {
    onPick(value)
    if (multiple) {
      setQuery("")
    } else {
      onOpenChange(false)
    }
  }

  return (
    <BottomSheet
      open={open}
      onOpenChange={(next) => {
        if (!next) setQuery("")
        onOpenChange(next)
      }}
      title={title}
      action={
        multiple ? (
          <Drawer.Close className="h-11 shrink-0 rounded-inner px-3 text-[0.9375rem] font-semibold text-accent">
            Done
          </Drawer.Close>
        ) : undefined
      }
    >
      {searchable && (
        <div className="shrink-0 px-4 pb-2">
          <label className="flex h-11 items-center gap-2 rounded-inner border border-hairline-2 bg-soft px-3 focus-within:border-accent">
            <Search className="size-4 shrink-0 text-line-ico" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              // Enter takes the first match, the same promise the
              // desk's typeahead makes: type "basic", press Enter,
              // it is on.
              onKeyDown={(event) => {
                if (event.key !== "Enter") return
                event.preventDefault()
                const first = rows.find((one) => !one.disabled)
                if (first) pick(first.value)
              }}
              enterKeyHint={multiple ? "enter" : "done"}
              placeholder="Search"
              aria-label={`Search ${title}`}
              className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-mute"
            />
          </label>
        </div>
      )}

      <div
        role="listbox"
        aria-label={title}
        aria-multiselectable={multiple || undefined}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-2"
      >
        {rows.length === 0 && (
          <p className="px-3 py-6 text-center text-meta text-mute">
            Nothing matches.
          </p>
        )}
        {rows.map((one) => {
          const on = selected.includes(one.value)
          return (
            <button
              key={one.value}
              type="button"
              role="option"
              aria-selected={on}
              disabled={one.disabled}
              onClick={() => pick(one.value)}
              className={cn(
                "flex min-h-12 w-full items-center gap-3 rounded-inner px-3 text-left text-[0.9375rem] text-ink active:bg-soft-2",
                on && "font-medium",
                "disabled:text-mute disabled:active:bg-transparent",
              )}
            >
              {multiple && (
                <span
                  aria-hidden
                  className={cn(
                    "grid size-5 shrink-0 place-items-center rounded-[0.3125rem] border",
                    on
                      ? "border-accent bg-accent text-white"
                      : "border-hairline-strong",
                  )}
                >
                  {on && <Check className="size-3.5 stroke-[2.5]" />}
                </span>
              )}
              {one.leading}
              <span className="min-w-0 flex-1 truncate">{one.label}</span>
              {!multiple && on && (
                <Check className="size-4 shrink-0 text-accent" />
              )}
            </button>
          )
        })}
        {action !== undefined && (
          <>
            <div className="mx-3 my-1 border-t border-hairline" />
            <button
              type="button"
              onClick={() => {
                onOpenChange(false)
                action.onSelect()
              }}
              className="flex min-h-12 w-full items-center gap-3 rounded-inner px-3 text-left text-[0.9375rem] font-medium text-ink active:bg-soft-2"
            >
              <Plus className="size-4 text-line-ico" />
              {action.label}
            </button>
          </>
        )}
      </div>
    </BottomSheet>
  )
}

/// The sheet itself — the Drawer, its veil, its grip and its title — for
/// anything chosen from the bottom of a phone's glass: a list (`PickerSheet`
/// below) or a month (`<Day>`). One shell, so they rise, settle, give way to
/// the keyboard and swipe away identically.
export function BottomSheet({
  open,
  onOpenChange,
  title,
  action,
  onBack,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  /// Beside the title, at the trailing edge — "Done" for a multi-pick.
  action?: React.ReactNode
  /// A step back inside the sheet, drawn as ← before the title. Given only
  /// while a dynamic sheet is past its first page; see `MorphHeight`.
  onBack?: () => void
  children: React.ReactNode
}) {
  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange}>
      <Drawer.VirtualKeyboardProvider>
        <Drawer.Portal>
          {/* `forceRender`: Base UI draws no backdrop for a dialog opened
              inside another, and every picker here is opened inside a sheet
              — without it the form stayed fully lit and live-looking behind
              the list, and a tap on it read as a tap on the form. */}
          <Drawer.Backdrop
            forceRender
            className="fixed inset-0 z-50 bg-[var(--scrim)] opacity-[calc(1-var(--drawer-swipe-progress,0))] transition-opacity duration-(--t-drawer) ease-(--ease-out) data-[ending-style]:opacity-0 data-[ending-style]:duration-(--t-exit) data-[starting-style]:opacity-0 data-[swiping]:transition-none"
          />
          <Drawer.Viewport className="fixed inset-0 z-50 flex items-end pb-[var(--drawer-keyboard-inset,0px)]">
            <Drawer.Popup
              className={cn(
                "flex max-h-[min(85dvh,calc(100dvh-var(--drawer-keyboard-inset,0px)-0.75rem))] w-full flex-col rounded-t-sheet border-t border-hairline bg-canvas pb-[env(safe-area-inset-bottom)] shadow-float outline-none",
                // Up from the bottom edge on the iOS sheet curve, back down
                // it faster. The finger's drag is `--drawer-swipe-movement-y`
                // on `transform`, apart from the enter/exit on `translate`, so
                // a let-go mid-drag settles from where the sheet actually is
                // rather than snapping; nothing eases while the finger holds.
                "[transform:translateY(var(--drawer-swipe-movement-y,0px))] transition-[translate,transform] duration-(--t-drawer) ease-(--ease-drawer) data-[ending-style]:duration-(--t-exit)",
                "data-[ending-style]:translate-y-full data-[starting-style]:translate-y-full data-[swiping]:transition-none",
                "motion-reduce:data-[ending-style]:translate-none motion-reduce:data-[starting-style]:translate-none",
              )}
            >
              {/* The height gives way to the keyboard. The viewport lifts the
                  sheet by the keyboard's height (`--drawer-keyboard-inset`,
                  from `VirtualKeyboardProvider`), and at a fixed 85dvh that
                  pushed its head — the title and the search box somebody was
                  typing into — off the top of the glass on an iPhone, leaving
                  only the bottom of the list. Capped at what is left above
                  the keyboard, the head stays and the list is what scrolls. */}
              {/* The grip: says "this can be pulled down" before anybody
                  tries, which is the only way a gesture gets found. */}
              <div aria-hidden className="flex justify-center pt-2.5 pb-1">
                <span className="h-1 w-9 rounded-full bg-hairline-strong" />
              </div>
              <div className="flex shrink-0 items-center justify-between gap-3 px-4 pt-1 pb-2">
                <span className="flex min-w-0 items-center gap-1">
                  {onBack !== undefined && (
                    <button
                      type="button"
                      aria-label="Back"
                      onClick={onBack}
                      className="-ml-2 grid size-11 shrink-0 place-items-center rounded-full text-line-ico active:bg-soft-2"
                    >
                      <ChevronLeft className="size-5" />
                    </button>
                  )}
                  <Drawer.Title className="truncate text-[1rem] font-semibold text-ink">
                    {title}
                  </Drawer.Title>
                </span>
                {action}
              </div>

              {children}
            </Drawer.Popup>
          </Drawer.Viewport>
        </Drawer.Portal>
      </Drawer.VirtualKeyboardProvider>
    </Drawer.Root>
  )
}

/// A sheet whose content changes without the sheet going away — the "dynamic
/// drawer" (Family's, as rebuilt in Vaul's examples). One page is swapped for
/// the next inside the same sheet, and the sheet's height travels to fit the
/// new one instead of jumping.
///
/// The height is measured, not guessed: the inner box is watched and the outer
/// one is given its height in pixels, which is the one way CSS can animate to
/// "whatever this content needs". Height is a layout property and costs a
/// layout per frame — tolerated here, as it is for an accordion, because there
/// is no transform that says "taller" — so it is kept short, on the drawer
/// curve. The first measurement is not animated: the sheet rising is its own
/// motion. Each page arrives with a short fade and a 6px slide from the side
/// it is coming from, so forward and back read as directions.
export function MorphHeight({
  page,
  back = false,
  children,
}: {
  /// Which page is showing. Changing it is what plays the swap.
  page: string
  /// Whether the change was a step back — the new page slides in from the
  /// left instead of the right.
  back?: boolean
  children: React.ReactNode
}) {
  const inner = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState<number | null>(null)
  const [settled, setSettled] = useState(false)

  useLayoutEffect(() => {
    const node = inner.current
    if (node === null) return
    const measure = () => setHeight(node.getBoundingClientRect().height)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    // Animate from the second measurement on — see the doc comment.
    const frame = requestAnimationFrame(() => setSettled(true))
    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
    }
  }, [])

  return (
    <div
      style={{ height: height ?? undefined }}
      className={cn(
        "min-h-0 overflow-y-auto overscroll-contain",
        settled && "transition-[height] duration-300 ease-(--ease-drawer)",
      )}
    >
      <div ref={inner}>
        <div
          key={page}
          className={cn(
            "transition-[opacity,translate] duration-200 ease-(--ease-out) starting:opacity-0 motion-reduce:starting:translate-none",
            back ? "starting:-translate-x-1.5" : "starting:translate-x-1.5",
          )}
        >
          {children}
        </div>
      </div>
    </div>
  )
}
