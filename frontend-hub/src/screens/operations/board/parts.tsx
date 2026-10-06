import { ArrowRight, ChevronsLeft, ChevronsRight, Flag } from "lucide-react"

import { AppLink } from "@/components/ui/app-link"
import { Checkbox } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { ErrorState, LoadingState } from "@/components/ui/states"
import { count } from "@/lib/format"
import type { SheetKey } from "@/lib/sheets"
import { useOpenHere } from "@/screens/operations/board/open-here"
import { cn } from "@/lib/utils"
import type { BoardView } from "@/screens/operations/board/board-view"
import { ViewSwitch } from "@/screens/operations/board/stage-table"
import { useLayout } from "@/lib/layout"

/// The page header. The two boards are different datasets and different
/// menus (Allotment, Return to supplier), so there is nothing to switch here.
export function BoardHeader({
  board,
  title,
  actions,
  view,
}: {
  /// Names the saved lane widths. Every board passes its own.
  board: string
  /// The heading. Absent, the board's name says it: the supplier board is
  /// "Return to supplier", every other board is the Allotment.
  title?: string
  /// Board or table, on the boards that have both.
  view?: [BoardView, (next: BoardView) => void]
  /// Search and the store filter, on the board that has them.
  actions?: React.ReactNode
}) {
  // A phone is always the table (`useBoardView`), so there is no switch.
  const phone = useLayout() === "phone"
  return (
    <PageHeader
      title={title ?? (board === "suppliers" ? "Return PO" : "Allotment")}
      actions={
        <>
          {actions}
          {view && !phone && <ViewSwitch value={view[0]} onChange={view[1]} />}
        </>
      }
    />
  )
}

/// The row of lanes: the large kanban of the Outbox prototype. Every lane is
/// one width — wide enough for a supplier's whole name and a PO number — and the
/// row scrolls sideways on its own, never the page: a page that scrolls
/// sideways loses its header.
///
/// `board` names the board, for anything that wants to find it.
export function Lanes({
  board,
  children,
}: {
  board: string
  children: React.ReactNode
}) {
  return (
    <div
      data-board={board}
      className="-mx-1 flex min-h-0 flex-1 [scrollbar-width:thin] items-stretch gap-4 overflow-x-auto px-1"
    >
      {children}
    </div>
  )
}

/// A lane: its title and how many cards, then the cards, then its total in
/// pieces. Empty, it folds to a strip.
export function Lane({
  id,
  tone,
  title,
  pieces,
  unit,
  cards,
  summary,
  footer,
  problem,
  loading,
  onFold,
  children,
}: {
  /// Stable across renders and reloads.
  id: string
  tone: string
  title: string
  pieces: number
  /// What the lane counts, when it is not pieces: "koli".
  unit?: string
  cards: number
  /// Under the cards, outside their scroll: the lane's one action.
  footer?: React.ReactNode
  /// A line under the title, for a column that has something to say there.
  summary?: React.ReactNode
  problem?: unknown
  loading?: boolean
  /// A lane that can fold away to the `DoneRail`: this folds it.
  onFold?: () => void
  children: React.ReactNode
}) {
  if (cards === 0 && !problem && !loading) {
    return (
      <section
        data-lane={id}
        aria-label={`${title}, empty`}
        title={`${title}: empty`}
        className="flex min-h-64 w-[3.25rem] shrink-0 flex-col items-center gap-3 rounded-card border border-hairline bg-soft-2 py-4"
      >
        <span className={cn("size-2 rounded-full", tone)} />
        <span className="font-medium whitespace-nowrap text-body [writing-mode:vertical-rl]">
          {title}
        </span>
        <span className="rounded-full bg-canvas px-2 text-mute">0</span>
      </section>
    )
  }
  return (
    <section
      data-lane={id}
      aria-label={title}
      className="flex min-h-0 w-[19rem] shrink-0 flex-col rounded-card border border-hairline bg-soft-2 min-[112.5rem]:w-[21rem]"
    >
      <header className="px-4 pt-4 pb-3">
        <div className="flex items-center gap-3">
          <span className={cn("size-2 shrink-0 rounded-full", tone)} />
          <h2 className="min-w-0 truncate font-semibold text-ink">{title}</h2>
          <span className="ml-auto rounded-inner bg-canvas px-2 font-medium text-body tabular-nums shadow-soft">
            {count(cards)}
          </span>
          {onFold && (
            <button
              type="button"
              onClick={onFold}
              aria-label={`Fold ${title}`}
              className="-my-3 -mr-3 grid size-11 shrink-0 place-items-center rounded-inner text-mute transition-[color,transform] duration-(--t-press) ease-(--ease-out) hover:text-ink active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100"
            >
              <ChevronsRight className="size-4" aria-hidden />
            </button>
          )}
        </div>
        {summary !== undefined && (
          <div className="mt-1 text-body tabular-nums">{summary}</div>
        )}
      </header>
      <div className="flex min-h-28 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2 [&>*]:min-h-0 [&>*]:shrink-0">
        {problem ? (
          <ErrorState error={problem} />
        ) : loading ? (
          <LoadingState />
        ) : (
          children
        )}
      </div>
      {footer && <div className="px-2 pb-2">{footer}</div>}
      <footer className="border-t border-hairline px-4 py-3 text-body tabular-nums">
        {count(pieces)} {unit ?? (pieces === 1 ? "pc" : "pcs")}
      </footer>
    </section>
  )
}

/// A finished lane, folded to the right edge of the board: its name and how
/// many it holds. Pressing it opens the lane in full.
export function DoneRail({
  title,
  cards,
  onOpen,
}: {
  title: string
  cards: number
  onOpen: () => void
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Show ${title}, ${count(cards)}`}
      className="sticky right-0 flex min-h-64 w-[3.25rem] shrink-0 flex-col items-center gap-3 rounded-card border border-hairline bg-soft-2 py-4 text-body transition-[border-color,transform] duration-(--t-press) ease-(--ease-out) hover:border-hairline-strong active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100"
    >
      <ChevronsLeft className="size-4 text-mute" aria-hidden />
      <span className="font-medium whitespace-nowrap [writing-mode:vertical-rl]">
        {title}
      </span>
      <span className="rounded-full bg-canvas px-2 text-mute tabular-nums">
        {count(cards)}
      </span>
    </button>
  )
}

/// The card's outside: a link to its station, or a button that opens the work
/// in place. It answers the press at once (Apple: respond on pointer-down),
/// and holds still for anyone who asked for less motion.
function Card({
  onOpen,
  to,
  sheet,
  className,
  children,
}: {
  onOpen?: () => void
  to: string
  sheet?: { key: SheetKey; value: string }
  className?: string
  children: React.ReactNode
}) {
  const here = useOpenHere()(sheet)
  onOpen = onOpen ?? here
  if (onOpen)
    return (
      <button
        type="button"
        onClick={onOpen}
        className={cn(CARD, "w-full", className)}
      >
        {children}
      </button>
    )
  return (
    <AppLink to={to} sheet={sheet} className={cn(CARD, className)}>
      {children}
    </AppLink>
  )
}

const CARD =
  "group/card flex flex-col overflow-hidden rounded-[0.625rem] border border-hairline bg-canvas text-left shadow-soft transition-[border-color,transform] duration-(--t-press) ease-(--ease-out) hover:border-hairline-strong active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100"

/// One card: who it is for, then how many pieces and the one fact about it;
/// along the foot, either the exception it carries or the step it waits for.
/// The whole card opens the station that owns it.
export function Tile({
  to,
  sheet,
  title,
  sub,
  meta,
  pieces,
  unit,
  of,
  pill,
  flag,
  act,
  onOpen,
  pick,
  className,
}: {
  to: string
  sheet?: { key: SheetKey; value: string }
  /// Open the work in place instead of going to its station.
  onOpen?: () => void
  title: React.ReactNode
  /// Under the title: the document number or the supplier.
  sub?: React.ReactNode
  /// One fact, right of the second line: "3 koli", "12 SKUs".
  meta?: React.ReactNode
  pieces: number
  /// What is counted, when it is not pieces: "koli".
  unit?: string
  /// Of how many — red when the card also carries a flag.
  of?: number
  /// A status beside the pieces: "Short −300".
  pill?: React.ReactNode
  /// The exception, along the foot of the card: "12 missing".
  flag?: React.ReactNode
  /// The step the card is waiting for, along the foot, with an arrow.
  act?: string
  /// A tick in the card's top-left corner, beside (never inside) the press
  /// that opens it: ticking picks the card, pressing it still opens it.
  pick?: {
    checked: boolean
    onChange: (checked: boolean) => void
    label: string
  }
  className?: string
}) {
  const short = of !== undefined && flag !== undefined
  if (pick) {
    return (
      <div className="relative">
        <Tile
          to={to}
          sheet={sheet}
          onOpen={onOpen}
          title={title}
          sub={sub}
          meta={meta}
          pieces={pieces}
          unit={unit}
          of={of}
          pill={pill}
          flag={flag}
          act={act}
          className={cn(
            "[&>span:first-child]:pl-10",
            pick.checked && "border-accent hover:border-accent",
            className
          )}
        />
        <span
          className="absolute top-1 left-1"
          onClick={(event) => event.stopPropagation()}
        >
          <Checkbox
            label={<span className="sr-only">{pick.label}</span>}
            checked={pick.checked}
            onChange={pick.onChange}
            className="[&>label]:size-11 [&>label]:justify-center"
          />
        </span>
      </div>
    )
  }
  return (
    <Card onOpen={onOpen} to={to} sheet={sheet} className={className}>
      <span className="flex flex-col gap-1 px-4 pt-4 pb-4">
        <span className="flex items-baseline justify-between gap-3">
          <span
            className="min-w-0 truncate text-[1.0625rem] leading-6 font-semibold text-ink"
            title={typeof title === "string" ? title : undefined}
          >
            {title}
          </span>
          {meta !== undefined && (
            <span className="shrink-0 whitespace-nowrap text-body">{meta}</span>
          )}
        </span>
        {sub !== undefined && (
          <span
            className="min-w-0 truncate text-body"
            title={typeof sub === "string" ? sub : undefined}
          >
            {sub}
          </span>
        )}
        <span className="mt-2 flex items-center justify-between gap-3">
          <span className="font-semibold whitespace-nowrap text-ink tabular-nums">
            <span className={cn(short && "text-bad-fg")}>{count(pieces)}</span>
            {of !== undefined && ` / ${count(of)}`}{" "}
            <span className="font-normal text-body">
              {unit ?? (pieces === 1 ? "pc" : "pcs")}
            </span>
          </span>
          {pill}
        </span>
      </span>
      {flag !== undefined && (
        <span className="flex min-h-11 items-center gap-2 border-t border-hairline px-4 py-2 text-bad-fg">
          <Flag className="size-4 shrink-0" aria-hidden />
          <span className="min-w-0">{flag}</span>
        </span>
      )}
      {act !== undefined && (
        <span
          className="flex min-h-11 items-center justify-between gap-2 border-t border-hairline px-4 py-2 text-body transition-colors group-hover/card:text-ink"
          aria-hidden
        >
          {act}
          <ArrowRight className="size-4 shrink-0" />
        </span>
      )}
    </Card>
  )
}
