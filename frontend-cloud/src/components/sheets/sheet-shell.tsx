import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Kbd } from "@/components/ui/kbd"
import { Separator } from "@/components/ui/separator"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { ChevronDown, ChevronUp, MoreHorizontal, X } from "lucide-react"
import { Children, isValidElement, useCallback, useEffect } from "react"

export interface SheetShellProps {
  open: boolean
  onClose: () => void
  /// The record's own identifier — `PO-2091`, `TRN-0412`. Mono, quiet, on the
  /// top line beside the status. It is what a colleague asks for by name, so
  /// it goes above the title rather than under it.
  recordId?: React.ReactNode
  /// The record's state, as a `StatusPill`. Shares the id line.
  status?: React.ReactNode
  /// What this is. The heading under the id line, and what a screen reader
  /// hears as the panel's name.
  title: React.ReactNode
  /// One quiet line under the title — a supplier, a date, a count.
  subtitle?: React.ReactNode
  /// Said to a screen reader only. The visible header is a heading, not a
  /// description of what the panel is for.
  description: string
  /// The record's verbs, pinned in the header above the fold. At most two stay
  /// visible; the rest collapse into `···`.
  ///
  /// They are here rather than at the foot because a record is a long scroll
  /// and its actions are not: burying "Record receipt" under eight fact rows
  /// makes the reader hunt for the thing they opened the sheet to do. This is
  /// the prototype's shape, and it is better than DESIGN.md's.
  actions?: React.ReactNode
  /// The detail composer — a note, a quantity, the one thing you came to press.
  /// **Record actions do not live here**; they belong in `actions`.
  footer?: React.ReactNode
  /// Every row the list behind is showing, in the order it is showing them.
  /// Given this, the header grows ↑/↓ and the arrow keys move between records
  /// without closing the sheet.
  rows?: readonly string[]
  /// Which of `rows` is open.
  current?: string | null
  onMove?: (id: string) => void
  side?: "right" | "left" | "bottom"
  /// Put the body on the measured 20/18 gutters. Off by default because the
  /// record panels each bring their own padding; a panel that renders bare
  /// content should turn it on rather than invent a gutter of its own.
  padded?: boolean
  className?: string
  children: React.ReactNode
}

/// The frame every sheet sits in.
///
/// It exists so that the answer to "how does a sheet behave" is written once:
/// where the title goes, that Escape and the X both close it, that closing
/// puts focus back on the row you opened, and — the part worth the file — that
/// a sheet opened from a list can walk that list with ↑ and ↓ instead of
/// closing, scrolling, and opening the next one.
///
/// # The header
///
/// Three rows, not four — measured off `inventory-prototype.html`'s
/// `.drawer-h`:
///
/// 1. **identity**: the mono record id and its status pill on ONE line, with
///    the chrome (↑ ↓ ✕) right-aligned on the same line;
/// 2. **title**, 17.5/600, under it;
/// 3. **actions**: at most two visible, the rest folded into `···`.
///
/// Nothing lands in a footer except the composer. Record verbs at the foot of
/// a long scroll are verbs nobody presses.
///
/// The panel floats: inset 16, `{r.shell}`, `{hairline}`, `--os-shadow-float`,
/// 27.5rem wide, over the WHITE veil — the list behind washes light and never
/// darkens. Below `sm` it stops floating and becomes a pushed screen. The
/// flush square-cornered column is the old rail and is deprecated.
export function SheetShell({
  open,
  onClose,
  recordId,
  status,
  title,
  subtitle,
  description,
  actions,
  footer,
  rows,
  current = null,
  onMove,
  side = "right",
  padded = false,
  className,
  children,
}: SheetShellProps) {
  const index =
    rows === undefined || current === null ? -1 : rows.indexOf(current)
  const previous = index > 0 ? rows?.[index - 1] : undefined
  const next = index >= 0 && rows !== undefined ? rows[index + 1] : undefined

  const toPrevious = useCallback(() => {
    if (previous !== undefined) onMove?.(previous)
  }, [previous, onMove])
  const toNext = useCallback(() => {
    if (next !== undefined) onMove?.(next)
  }, [next, onMove])

  useEffect(() => {
    if (!open || onMove === undefined) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return
      const focused = document.activeElement
      if (
        focused instanceof HTMLElement &&
        (focused.isContentEditable ||
          focused.tagName === "INPUT" ||
          focused.tagName === "TEXTAREA" ||
          focused.tagName === "SELECT" ||
          focused.closest(
            '[role="menu"],[role="listbox"],[role="dialog"] [role="grid"]'
          ) !== null)
      ) {
        return
      }
      event.preventDefault()
      if (event.key === "ArrowUp") toPrevious()
      else toNext()
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [open, onMove, toPrevious, toNext])

  return (
    <Sheet open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <SheetContent
        side={side}
        showCloseButton={false}
        float
        data-cloudhub=""
        overlayClassName="bg-[var(--os-scrim,rgba(255,255,255,0.72))] backdrop-blur-none supports-backdrop-filter:backdrop-blur-none"
        className={cn("flex flex-col gap-0 overflow-hidden p-0", className)}
      >
        {/* `.drawer-h` — 16/20/14, 13px between the identity block and the
            action row, closed by one hairline. */}
        <div className="flex shrink-0 flex-col items-stretch gap-[0.8125rem] border-b border-[var(--os-hairline,#ececef)] bg-[var(--os-canvas,#fff)] px-5 pt-4 pb-[0.875rem]">
          {/* `.dh-block` — identity over title, 6px apart. */}
          <div className="flex min-w-0 flex-col gap-[0.375rem]">
            {/* `.dh-top` — id · status on ONE line; the chrome shares it, which
                is what the prototype's 38px right pad reserves room for. */}
            <div className="flex min-h-[1.875rem] items-center gap-[0.5625rem]">
              {recordId !== undefined && (
                <span className="shrink-0 font-mono text-[0.71875rem] tracking-[0.02em] whitespace-nowrap text-[var(--os-body,#74747b)]">
                  {recordId}
                </span>
              )}
              {status}
              <span className="min-w-[0.5rem] flex-1" />
              <TooltipProvider delay={200}>
                <div className="flex shrink-0 items-center gap-[0.4375rem]">
                  {onMove !== undefined && (
                    <>
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label="Previous record"
                              disabled={previous === undefined}
                              onClick={toPrevious}
                            />
                          }
                        >
                          <ChevronUp className="size-[0.9375rem]" />
                        </TooltipTrigger>
                        <TooltipContent>
                          Previous <Kbd>↑</Kbd>
                        </TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label="Next record"
                              disabled={next === undefined}
                              onClick={toNext}
                            />
                          }
                        >
                          <ChevronDown className="size-[0.9375rem]" />
                        </TooltipTrigger>
                        <TooltipContent>
                          Next <Kbd>↓</Kbd>
                        </TooltipContent>
                      </Tooltip>
                      <Separator
                        orientation="vertical"
                        className="mx-[0.0625rem] h-4 bg-[var(--os-hairline,#ececef)]"
                      />
                    </>
                  )}
                  {/* `.dclose` — the same ghost circle as `···`. */}
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Close"
                    onClick={onClose}
                  >
                    <X className="size-[0.9375rem]" />
                  </Button>
                </div>
              </TooltipProvider>
            </div>

            {/* `.dh-title` — 17.5/600/-0.02em. */}
            <SheetTitle className="truncate">{title}</SheetTitle>
            {subtitle !== undefined && (
              <p className="truncate text-[0.78125rem] text-[var(--os-body,#74747b)]">
                {subtitle}
              </p>
            )}
          </div>

          <SheetDescription className="sr-only">{description}</SheetDescription>

          {/* `.drawer-acts` — the record's verbs, pinned above the fold. */}
          <HeaderActions>{actions}</HeaderActions>
        </div>

        {/* `.drawer-b` — 20/18 when the panel inside brings no gutter of its
            own. Most record panels do, so this is opt-in. */}
        <div
          className={cn(
            "min-h-0 flex-1 overflow-y-auto",
            padded && "px-5 py-[1.125rem]",
          )}
        >
          {children}
        </div>

        {/* The composer only. Record verbs are in the header. */}
        {footer !== undefined && (
          <div className="shrink-0 border-t border-[var(--os-hairline,#ececef)] px-5 py-3">
            {footer}
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

/// `.drawer-acts` — at most two visible actions; the rest sit behind `···`.
///
/// Two is the cap the prototype enforces in `hoistActions()`, and the reason
/// is that a header wide enough for five buttons is a header the record id has
/// to fight for. The first is the one `variant="default"` — the single dark
/// surface on the sheet — and the caller is expected to order them so the verb
/// worth pressing comes first, because that is the one that survives the cut.
///
/// Stepping and close are chrome rather than actions and stay outside the
/// count; they live on the id line above.
function HeaderActions({ children }: { children: React.ReactNode }) {
  const items = Children.toArray(children).filter((child) => isValidElement(child))
  if (items.length === 0) return null
  const visible = items.slice(0, 2)
  const overflow = items.slice(2)
  return (
    <div className="flex flex-wrap items-center gap-[0.4375rem]">
      {visible}
      {overflow.length > 0 && (
        <DropdownMenu>
          {/* `.dmore-t` — the same ghost circle as the close control, so the
              two header buttons read as one pair. */}
          <DropdownMenuTrigger
            aria-label="More actions"
            render={<Button variant="ghost" size="icon-sm" />}
          >
            <MoreHorizontal className="size-[0.9375rem]" />
          </DropdownMenuTrigger>
          {/* `.dmore-l` — 186 declared. The menu portals to `document.body`
              too, so it carries the attribute for the same reason the sheet
              does. */}
          <DropdownMenuContent
            align="end"
            data-cloudhub=""
            className="min-w-[11.625rem]"
          >
            {overflow.map((item, index) => (
              <DropdownMenuItem key={index} className="p-0">
                {/* `.dmore-i`: an overflowed action stops being a pill and
                    becomes a menu row. `!` because the themed `[data-cloudhub]
                    [data-slot="button"]` rules are three attributes deep and
                    outrank a plain descendant utility. */}
                <div className="w-full [&_button]:h-auto! [&_button]:w-full [&_button]:justify-start [&_button]:rounded-[0.4375rem]! [&_button]:border-0! [&_button]:bg-transparent! [&_button]:px-[0.625rem]! [&_button]:py-[0.4375rem]! [&_button]:text-[0.8125rem]! [&_button]:font-medium">
                  {item}
                </div>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )
}
