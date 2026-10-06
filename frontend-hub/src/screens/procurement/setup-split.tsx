import { Popover } from "@base-ui/react/popover"
import { ChevronDown, X, Plus } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { button } from "@/components/ui/button-style"
import { Input } from "@/components/ui/field"
import { POPUP } from "@/lib/filter-chrome"
import { cn } from "@/lib/utils"
import {
  filledCells,
  splitCount,
  tabLabel,
  type ArticleTab,
  type SplitMode,
} from "@/screens/procurement/setup-split-model"

/// The row of articles over the variants: one tab while the delivery line is one
/// article, a tab each once it is split, and "Split Article" at the far end
/// (owner, 2026-10-05) — the way a browser ends its tabs with a plus. Every tab
/// but a lone one can be removed; its pieces go with it, and the counter says so.
const SPLIT_ARTICLE_SHOWN = false

export function ArticleTabStrip({
  tabs,
  pieces,
  active,
  onPick,
  onRemove,
  onAdd,
  canAdd,
}: {
  tabs: readonly ArticleTab[]
  /// Pieces counted into each tab, in tab order.
  pieces: readonly number[]
  active: number
  onPick: (index: number) => void
  onRemove: (index: number) => void
  /// Adds an article, and so a tab.
  onAdd: () => void
  canAdd: boolean
}) {
  return (
    <div
      role="tablist"
      aria-label="Articles"
      className="mb-5 flex items-end gap-0.5 overflow-x-auto shadow-[inset_0_-1px_0_var(--color-hairline)]"
    >
      {tabs.map((tab, index) => (
        <span
          key={tab.id}
          className={cn(
            "flex shrink-0 items-center border-b-2",
            index === active ? "border-ink" : "border-transparent"
          )}
        >
          <button
            type="button"
            role="tab"
            aria-selected={index === active}
            onClick={() => onPick(index)}
            className={cn(
              "px-3 pt-2 pb-2.5 text-[0.875rem] font-medium whitespace-nowrap transition-colors",
              index === active ? "text-ink" : "text-body hover:text-ink"
            )}
          >
            {tabs.length === 1 ? "Article" : tabLabel(index)}
            {/* Said only once there is more than one: pieces counted into
                each, to see where the delivery's pieces went. */}
            {tabs.length > 1 && (
              <span className="ml-1.5 font-normal text-mute tabular-nums">
                {pieces[index] ?? 0} pcs
              </span>
            )}
          </button>
          {tabs.length > 1 && (
            <button
              type="button"
              aria-label={`Remove ${tabLabel(index)}`}
              onClick={() => onRemove(index)}
              className="mr-1 inline-flex rounded-[0.375rem] p-1 text-mute transition-colors hover:bg-soft-2 hover:text-ink"
            >
              <X className="size-3.5" />
            </button>
          )}
        </span>
      ))}
      {/* Hidden (owner, 2026-10-06): Split Article stays out of sight for now. */}
      {SPLIT_ARTICLE_SHOWN && (
        <button
          type="button"
          onClick={onAdd}
          disabled={!canAdd}
          className="mb-1 ml-auto inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-inner px-2.5 py-1.5 text-[0.875rem] font-medium text-body transition-colors enabled:hover:bg-soft-2 enabled:hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Plus className="size-4" />
          Split Article
        </button>
      )}
    </div>
  )
}

/// "Split automatically": the open tab's counted variants moved into new tabs
/// by colour, by size, or N at a time. Each choice says how many articles it
/// makes, and one that would make fewer than two — or more than there is room
/// for — cannot be picked.
export function SplitMenu({
  tab,
  sizeOrder,
  room,
  onSplit,
}: {
  tab: ArticleTab
  sizeOrder: readonly string[]
  /// How many articles the open tab may become.
  room: number
  onSplit: (mode: SplitMode) => void
}) {
  const [open, setOpen] = useState(false)
  const [asking, setAsking] = useState(false)
  const [n, setN] = useState("")
  const filled = filledCells(tab, sizeOrder).length
  const every = Number(n.replace(/[^\d]/g, "")) || 0
  const everyCount = every > 0 ? Math.ceil(filled / every) : 0
  const fits = (made: number) => made >= 2 && made <= room
  const pick = (mode: SplitMode) => {
    onSplit(mode)
    setOpen(false)
  }

  const choice = (label: string, mode: SplitMode) => {
    const made = splitCount(tab, mode, sizeOrder)
    return (
      <button
        type="button"
        disabled={!fits(made)}
        onClick={() => pick(mode)}
        className="flex w-full items-center justify-between gap-4 rounded-inner px-3 py-2 text-left text-[0.9375rem] text-ink transition-colors hover:bg-soft-2 disabled:pointer-events-none disabled:opacity-50"
      >
        {label}
        <span className="text-[0.875rem] text-mute tabular-nums">
          {made} {made === 1 ? "article" : "articles"}
        </span>
      </button>
    )
  }

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) {
          setAsking(false)
          setN("")
        }
      }}
    >
      <Popover.Trigger
        disabled={filled < 2}
        className={cn(button({ variant: "quiet" }))}
      >
        Split automatically
        <ChevronDown />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          className="z-50"
          side="bottom"
          align="end"
          sideOffset={6}
        >
          <Popover.Popup className={cn(POPUP, "w-[18rem] p-1.5")}>
            {asking ? (
              <div className="p-2.5">
                <p className="mb-3 text-[0.9375rem] font-medium text-ink">
                  Variants per article
                </p>
                <Input
                  autoFocus
                  aria-label="Variants per article"
                  inputMode="numeric"
                  value={n}
                  onChange={(event) =>
                    setN(event.target.value.replace(/[^\d]/g, ""))
                  }
                  onKeyDown={(event) => {
                    if (event.key !== "Enter") return
                    // Never the setup form's Enter.
                    event.preventDefault()
                    event.stopPropagation()
                    if (fits(everyCount)) pick({ by: "count", n: every })
                  }}
                  className="h-10 text-right text-[0.9375rem] tabular-nums"
                />
                <div className="mt-3 flex items-center justify-between gap-3">
                  <span className="text-[0.875rem] text-mute tabular-nums">
                    {every > 0
                      ? `${everyCount} ${everyCount === 1 ? "article" : "articles"}`
                      : `${filled} variants`}
                  </span>
                  <Button
                    variant="primary"
                    type="button"
                    disabled={!fits(everyCount)}
                    onClick={() => pick({ by: "count", n: every })}
                  >
                    Submit
                  </Button>
                </div>
              </div>
            ) : (
              <>
                {choice("By colour", { by: "colour" })}
                {choice("By size", { by: "size" })}
                <button
                  type="button"
                  onClick={() => setAsking(true)}
                  className="flex w-full items-center rounded-inner px-3 py-2 text-left text-[0.9375rem] text-ink transition-colors hover:bg-soft-2"
                >
                  Every N variants…
                </button>
              </>
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}
