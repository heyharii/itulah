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
  /// What this is. Shown in the header and read out to a screen reader.
  title: React.ReactNode
  /// The identifier under the title — a code, a date, a supplier.
  subtitle?: React.ReactNode
  /// Said to a screen reader only. The visible header is a heading, not a
  /// description of what the panel is for.
  description: string
  /// Actions that belong to the whole sheet, left of the navigation.
  /// At most two stay visible; the rest collapse into `···`.
  actions?: React.ReactNode
  /// The detail composer — a note, a quantity, the one thing you came to press.
  /// Chrome actions do not live here; they belong in `actions`.
  footer?: React.ReactNode
  /// Every row the list behind is showing, in the order it is showing them.
  /// Given this, the header grows ↑/↓ and the arrow keys move between records
  /// without closing the sheet.
  rows?: readonly string[]
  /// Which of `rows` is open.
  current?: string | null
  onMove?: (id: string) => void
  side?: "right" | "left" | "bottom"
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
/// The panel floats: inset ~22px, 16px radius, `--os-shadow-float`, over the
/// WHITE veil. Full-bleed only below `sm`. The flush square column is the old
/// rail and is not used here.
export function SheetShell({
  open,
  onClose,
  title,
  subtitle,
  description,
  actions,
  footer,
  rows,
  current = null,
  onMove,
  side = "right",
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
        className={cn("flex flex-col gap-0 overflow-hidden p-0 sm:max-w-lg", className)}
      >
        <div className="flex h-13 shrink-0 items-center justify-between gap-3 border-b border-[var(--os-hairline,#eeeef1)] bg-[var(--os-canvas,#fff)] pr-2 pl-4">
          <div className="flex min-w-0 items-baseline gap-2">
            <SheetTitle className="truncate text-[15.5px] font-semibold tracking-[-0.015em]">
              {title}
            </SheetTitle>
            {subtitle !== undefined && (
              <span className="shrink-0 font-mono text-[11.5px] text-[var(--os-body,#74747b)]">
                {subtitle}
              </span>
            )}
          </div>
          <SheetDescription className="sr-only">{description}</SheetDescription>
          <TooltipProvider delay={200}>
            <div className="flex shrink-0 items-center gap-1">
              <HeaderActions>{actions}</HeaderActions>
              {onMove !== undefined && (
                <>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label="Previous"
                          disabled={previous === undefined}
                          onClick={toPrevious}
                        />
                      }
                    >
                      <ChevronUp className="size-4" />
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
                          aria-label="Next"
                          disabled={next === undefined}
                          onClick={toNext}
                        />
                      }
                    >
                      <ChevronDown className="size-4" />
                    </TooltipTrigger>
                    <TooltipContent>
                      Next <Kbd>↓</Kbd>
                    </TooltipContent>
                  </Tooltip>
                  <Separator orientation="vertical" className="mx-0.5 h-4" />
                </>
              )}
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Close"
                onClick={onClose}
              >
                <X className="size-4" />
              </Button>
            </div>
          </TooltipProvider>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>

        {footer !== undefined && (
          <div className="shrink-0 border-t border-[var(--os-hairline,#eeeef1)] p-3">
            {footer}
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

/// At most two visible actions; the rest sit behind `···`. Stepping and close
/// are chrome, not actions, and stay outside this count.
function HeaderActions({ children }: { children: React.ReactNode }) {
  const items = Children.toArray(children).filter((child) => isValidElement(child))
  if (items.length === 0) return null
  if (items.length <= 2) return <>{items}</>
  const visible = items.slice(0, 2)
  const overflow = items.slice(2)
  return (
    <>
      {visible}
      <DropdownMenu>
        <DropdownMenuTrigger
          className="hover:bg-muted inline-flex size-8 items-center justify-center rounded-full"
          aria-label="More actions"
        >
          <MoreHorizontal className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-40">
          {overflow.map((item, index) => (
            <DropdownMenuItem key={index} className="p-0">
              <div className="w-full [&_button]:w-full [&_button]:justify-start">
                {item}
              </div>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  )
}
