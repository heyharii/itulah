import {
  ArrowRight,
  ChevronLeft,
  ChevronsLeft,
  ChevronsRight,
  Flag,
} from "lucide-react"

import { AppLink } from "@/components/ui/app-link"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states"
import { count } from "@/lib/format"
import type { SheetKey } from "@/lib/sheets"
import { useOpenHere } from "@/screens/operations/board/open-here"
import { cn } from "@/lib/utils"
import type { BoardView } from "@/screens/operations/board/board-view"
import {
  SWITCHED_OFF,
  ViewSwitch,
} from "@/screens/operations/board/stage-table"
import { useLayout } from "@/lib/layout"
import { DraggableCard } from "@/screens/operations/board/drag"
import {
  useDropRef,
  useDropTarget,
  type DraggedCard,
} from "@/screens/operations/board/drag-state"

/// The page header. The two boards are different datasets and different
/// menus (Allotment, Return to supplier), so there is nothing to switch here.
export function BoardHeader({
  board,
  title,
  actions,
  view,
  closeTo,
}: {
  /// Where the × goes, on a board shown full screen (owner, 10 Oct 2026: the
  /// Ops allotment board has no sidebar, so it needs its own way out).
  closeTo?: string
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
  const name = title ?? (board === "suppliers" ? "Return PO" : "Allotment")
  // The board shown full screen has no sidebar: its header is a white bar of
  // its own, with a Back at the left where the × was (owner, 2026-10-10).
  if (closeTo !== undefined) {
    return (
      <div className="mb-4 -ml-4 flex w-[calc(100%+2rem)] items-center gap-3 border-b border-hairline bg-canvas px-4 py-2.5 md:-mt-7 md:-ml-8 md:w-[calc(100%+4rem)] md:px-8">
        <AppLink
          to={closeTo}
          variant="ghost"
          aria-label="Back"
          className="-ml-2 gap-1 pr-3 pl-2"
        >
          <ChevronLeft className="size-4" />
          Back
        </AppLink>
        <h1 className="min-w-0 truncate text-[0.9375rem] leading-5 font-semibold text-ink">
          {name}
        </h1>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {actions}
          {view && !phone && <ViewSwitch value={view[0]} onChange={view[1]} />}
        </div>
      </div>
    )
  }
  return (
    <PageHeader
      title={name}
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

export type { DraggedCard } from "@/screens/operations/board/drag-state"

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
  foot,
  problem,
  loading,
  onFold,
  onDropCard,
  accepts,
  folds = true,
  total = true,
  empty,
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
  /// The total along the bottom, when pieces alone do not say it: "5 koli · 128 pcs".
  foot?: React.ReactNode
  problem?: unknown
  loading?: boolean
  /// A lane that can fold away to the `DoneRail`: this folds it.
  onFold?: () => void
  /// Given, the lane is a drop target: a card dragged onto it hands itself
  /// here. The drop never writes — what it opens (a sheet, a form) asks
  /// first. Without it the lane ignores drags.
  onDropCard?: (card: DraggedCard, lane: string) => void
  /// From which lanes a card may land here, and what the lane says while it
  /// is up: `{ pick: "Pick" }`.
  accepts?: Record<string, string>
  /// Empty, the lane folds to a strip. The Allotment board's three lanes
  /// never fold and share the width (owner, 16 Oct 2026: nothing written
  /// sideways).
  folds?: boolean
  /// The total along the lane's foot. The Allotment board has none (owner,
  /// 16 Oct 2026).
  total?: boolean
  /// What an empty lane says, when it does not fold: "Nothing to pick".
  empty?: string
  children: React.ReactNode
}) {
  const target =
    onDropCard === undefined || accepts === undefined
      ? undefined
      : { accepts, onDrop: onDropCard }
  const dropRef = useDropRef(id, target)
  const drop = useDropTarget(id, target)
  const dropProps = { ref: dropRef }
  const dropClass = cn(
    drop.mode === "over"
      ? "border-accent bg-accent-bg shadow-[0_0_0_1px_var(--color-accent)]"
      : drop.mode === "can"
        ? "border-hairline-strong"
        : "border-hairline",
    drop.mode === "no" && "opacity-45"
  )
  const hint =
    drop.mode === "can" || drop.mode === "over" ? (
      <DropHint over={drop.mode === "over"} upright={cards === 0}>
        {drop.hint}
      </DropHint>
    ) : null
  if (cards === 0 && !problem && !loading && folds) {
    return (
      <section
        data-lane={id}
        aria-label={`${title}, empty`}
        title={`${title}: empty`}
        {...dropProps}
        className={cn(
          "board-lane relative flex min-h-64 w-[3.25rem] shrink-0 flex-col items-center gap-3 rounded-card border bg-soft-2 py-4 transition-[border-color,background-color,opacity]",
          dropClass
        )}
      >
        <span className={cn("size-2 rounded-full", tone)} />
        <span className="font-medium whitespace-nowrap text-body [writing-mode:vertical-rl]">
          {title}
        </span>
        <span className="rounded-full bg-canvas px-2 text-mute">0</span>
        {hint}
      </section>
    )
  }
  return (
    <section
      data-lane={id}
      aria-label={title}
      {...dropProps}
      className={cn(
        folds
          ? "w-[19rem] shrink-0 min-[112.5rem]:w-[21rem]"
          : "w-[19rem] min-w-[19rem] flex-1",
        "board-lane relative flex min-h-0 flex-col rounded-card border bg-soft-2 transition-[border-color,background-color,opacity]",
        dropClass
      )}
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
        ) : cards === 0 && empty !== undefined ? (
          // A lane that never folds says it is empty (owner, 16 Oct 2026).
          <div className="grid flex-1 place-items-center py-10">
            <EmptyState>{empty}</EmptyState>
          </div>
        ) : (
          children
        )}
      </div>
      {footer && <div className="px-2 pb-2">{footer}</div>}
      {total && (
        <footer className="board-lane-foot border-t border-hairline px-4 py-3 text-body tabular-nums">
          {foot ?? `${count(pieces)} ${unit ?? (pieces === 1 ? "pc" : "pcs")}`}
        </footer>
      )}
      {hint}
    </section>
  )
}

/// What a drop on a lane does, over the lane's foot while a card is up: a
/// dashed box ("Pack", "Put back"), blue while the card is above it.
function DropHint({
  over,
  upright,
  children,
}: {
  over: boolean
  upright: boolean
  children: React.ReactNode
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "pointer-events-none absolute grid place-items-center rounded-card border-[1.5px] border-dashed bg-canvas/95 font-medium transition-[opacity,color,border-color] duration-150 ease-(--ease-out) starting:opacity-0",
        upright
          ? "inset-x-1 top-28 bottom-3 [writing-mode:vertical-rl]"
          : "inset-x-2 bottom-14 h-12",
        over ? "border-accent text-accent" : "border-hairline-strong text-body"
      )}
    >
      {children}
    </span>
  )
}

/// A finished lane, folded to the right edge of the board: its name and how
/// many it holds. Pressing it opens the lane in full.
export function DoneRail({
  id,
  title,
  cards,
  onOpen,
  accepts,
  onDropCard,
}: {
  id?: string
  title: string
  cards: number
  onOpen: () => void
  /// As a lane's: what may be dropped on the rail and what it says.
  accepts?: Record<string, string>
  onDropCard?: (card: DraggedCard, lane: string) => void
}) {
  const target =
    accepts === undefined || onDropCard === undefined
      ? undefined
      : { accepts, onDrop: onDropCard }
  const dropRef = useDropRef(id ?? title, target)
  const drop = useDropTarget(id ?? title, target)
  return (
    <button
      type="button"
      ref={dropRef}
      onClick={onOpen}
      aria-label={`Show ${title}, ${count(cards)}`}
      className={cn(
        "board-lane sticky right-0 flex min-h-64 w-[3.25rem] shrink-0 flex-col items-center gap-3 rounded-card border bg-soft-2 py-4 text-body transition-[border-color,background-color,opacity,transform] duration-(--t-press) ease-(--ease-out) hover:border-hairline-strong active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100",
        drop.mode === "over"
          ? "border-accent bg-accent-bg"
          : drop.mode === "can"
            ? "border-hairline-strong"
            : "border-hairline",
        drop.mode === "no" && "opacity-45"
      )}
    >
      <ChevronsLeft className="size-4 text-mute" aria-hidden />
      <span className="font-medium whitespace-nowrap [writing-mode:vertical-rl]">
        {title}
      </span>
      <span className="rounded-full bg-canvas px-2 text-mute tabular-nums">
        {count(cards)}
      </span>
      {(drop.mode === "can" || drop.mode === "over") && (
        <DropHint over={drop.mode === "over"} upright>
          {drop.hint}
        </DropHint>
      )}
    </button>
  )
}

/// The card's outside: a link to its station, or a button that opens the work
/// in place. It answers the press at once (Apple: respond on pointer-down),
/// and holds still for anyone who asked for less motion.
///
/// `inert` is a card switched off: nothing opens from it, it only reads.
function Card({
  onOpen,
  to,
  sheet,
  className,
  inert = false,
  children,
}: {
  onOpen?: () => void
  to: string
  sheet?: { key: SheetKey; value: string }
  className?: string
  inert?: boolean
  children: React.ReactNode
}) {
  const here = useOpenHere()(sheet)
  onOpen = onOpen ?? here
  if (inert)
    return (
      <div className={cn(CARD_FRAME, "cursor-default", className)}>
        {children}
      </div>
    )
  if (onOpen)
    return (
      <button
        type="button"
        data-press
        onClick={onOpen}
        className={cn(CARD, "w-full", className)}
      >
        {children}
      </button>
    )
  return (
    <AppLink to={to} sheet={sheet} data-press className={cn(CARD, className)}>
      {children}
    </AppLink>
  )
}

const CARD_FRAME =
  "board-card group/card relative flex flex-col overflow-hidden rounded-[0.625rem] border border-hairline bg-canvas text-left shadow-soft"

const CARD = `${CARD_FRAME} transition-[border-color,transform] duration-(--t-press) ease-(--ease-out) hover:border-hairline-strong active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100`

/// One card: who it is for, then how many pieces and the one fact about it;
/// along the foot, either the exception it carries or the step it waits for.
/// The whole card opens the station that owns it.
///
/// Three things a card can say about work somebody changed (all optional, all
/// on top of a card that is otherwise drawn as before):
///
///  - `strip`: a band across the top. Amber `warn` for "Short pick" (the card
///    still works), red `bad` for "Edited −50" (the card still works too).
///  - `change`: the row "300 → **250** pcs −50": what the card held and what
///    is still wanted of it.
///  - `stamp` + `switchedOff`: the whole card is cancelled. Hatched and
///    stamped, nothing opens from it; its one live thing is `onAction`.
///
/// `onAction` + `actionLabel` is a real button along the foot ("Move back"),
/// beside the press that opens the card, never inside it.
///
/// `tags` and `ack` are what MD changed that the warehouse has not seen
/// (owner, 10 Oct 2026): small coloured facts ("Added +20", "300 → 330") and
/// the "Got it" button that acknowledges them. Both sit beside whatever else
/// the card says; a stamped card already says "CANCELLED", so it shows no tags.
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
  drag,
  className,
  strip,
  change,
  stamp,
  switchedOff = false,
  actionLabel,
  onAction,
  tags,
  ack,
  dot = false,
  lines,
  photos,
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
  /// `disabled` is a card that cannot be ticked, and `title` says why.
  pick?: {
    checked: boolean
    onChange: (checked: boolean) => void
    label: string
    disabled?: boolean
    title?: string
  }
  /// Given, the card can be dragged to another lane: the drag carries where
  /// it came from and its own value. A press still opens; only a held move
  /// is a drag.
  drag?: DraggedCard
  className?: string
  /// A band across the top of the card: amber "Short pick", red "Edited −50".
  /// `title` is the tooltip: the reason, never on the card itself.
  strip?: { tone: "warn" | "bad" | "info"; label: string; title?: string }
  /// "was → now": replaces the pieces line with `300 → 250 pcs −50`.
  change?: { from: number; to: number }
  /// The big rotated stamp across the card: "CANCELLED".
  stamp?: string
  /// The card is not workable: hatched, its body dimmed, nothing opens from
  /// it. Only `onAction` still works.
  switchedOff?: boolean
  /// The foot's button ("Move back"), with `onAction`. Sits beside `act`.
  actionLabel?: string
  onAction?: () => void
  /// MD's changes the warehouse has not acknowledged: small facts under the
  /// pieces line.
  tags?: readonly {
    tone: "warn" | "bad"
    label: string
    was?: number
    now?: number
  }[]
  /// The one button a leftover cancelled card has ("OK"): it clears it.
  /// Other cards have none — opening the work is seeing the change.
  ack?: { label: string; onClick: () => void; pending?: boolean }
  /// A blue dot at the card's left: MD changed it and nobody opened it yet.
  dot?: boolean
  /// The articles on the card, as pictures, under the second line.
  photos?: React.ReactNode
  /// What the card holds, one row each, under a dashed rule: a store's koli
  /// ("Koli 1 · KOLI-0003 — 30 pcs"). `owed` is what has to come out first.
  lines?: readonly {
    key: string
    label: string
    code?: string
    pieces: number
    owed?: number
  }[]
}) {
  const short = of !== undefined && flag !== undefined
  /// MD's changes, said under the figure as the difference ("−2 pcs by MD"):
  /// what the server reports covers only the lines MD touched, so it is never
  /// struck on the card's own figure.
  const shownTags = tags
  const acting =
    (onAction !== undefined && actionLabel !== undefined) || ack !== undefined
  const boxed = pick !== undefined
  /// A ticked card is the accent's, border and all.
  const ticked = pick?.checked === true && "border-accent hover:border-accent"
  const inside = (
    <>
      {strip !== undefined && (
        <span
          title={strip.title}
          className={cn(
            "flex h-7 shrink-0 items-center px-4 text-[0.9375rem] font-semibold text-white",
            strip.tone === "bad"
              ? "bg-bad-fg"
              : strip.tone === "info"
                ? "bg-accent"
                : "bg-warn-fg"
          )}
        >
          {strip.label}
        </span>
      )}
      <span
        className={cn(
          "relative flex flex-col gap-1 px-4 pt-4 pb-4",
          boxed && "pl-10",
          stamp !== undefined && "pb-16"
        )}
      >
        {dot && (
          <span
            title="Changed by MD"
            className="absolute top-[1.5625rem] left-1.5 size-[7px] rounded-full bg-accent"
          >
            <span className="sr-only">Changed by MD</span>
          </span>
        )}
        <span
          className={cn(
            "flex flex-col gap-1",
            switchedOff && "opacity-50 grayscale"
          )}
        >
          <span className="flex items-baseline justify-between gap-3">
            <span
              className="min-w-0 truncate text-[1.0625rem] leading-6 font-semibold text-ink"
              title={typeof title === "string" ? title : undefined}
            >
              {title}
            </span>
            {meta !== undefined && (
              <span className="shrink-0 whitespace-nowrap text-body">
                {meta}
              </span>
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
          {photos}
          <span className="mt-2 flex items-center justify-between gap-3">
            {change === undefined ? (
              <span className="font-semibold whitespace-nowrap text-ink tabular-nums">
                <span className={cn(short && "text-bad-fg")}>
                  {count(pieces)}
                </span>
                {of !== undefined && ` / ${count(of)}`}{" "}
                <span className="font-normal text-body">
                  {unit ?? (pieces === 1 ? "pc" : "pcs")}
                </span>
              </span>
            ) : (
              <span className="whitespace-nowrap text-body tabular-nums">
                {count(change.from)} →{" "}
                <span className="font-semibold text-ink">
                  {count(change.to)}
                </span>{" "}
                {unit ?? (change.to === 1 ? "pc" : "pcs")}{" "}
                <span className="font-medium text-bad-fg">
                  {count(change.to - change.from)}
                </span>
              </span>
            )}
            {pill}
          </span>
          {shownTags !== undefined &&
            shownTags.length > 0 &&
            stamp === undefined && (
              <span className="mt-1 flex flex-wrap gap-x-3">
                {shownTags.map((tag) =>
                  tag.was !== undefined && tag.now !== undefined ? (
                    // The change itself, signed (owner, 16 Oct 2026): "−2 pcs
                    // by MD". The server's was/now cover only the lines MD
                    // touched, so they are never the card's own figure.
                    <span key={tag.label} className="text-body tabular-nums">
                      <span
                        className={cn(
                          "font-semibold",
                          tag.now < tag.was ? "text-bad-fg" : "text-accent"
                        )}
                      >
                        {tag.now < tag.was ? "−" : "+"}
                        {count(Math.abs(tag.now - tag.was))}
                      </span>{" "}
                      {Math.abs(tag.now - tag.was) === 1 ? "pc" : "pcs"} by MD
                    </span>
                  ) : (
                    <span
                      key={tag.label}
                      className={cn(
                        "font-semibold tabular-nums",
                        tag.tone === "bad" ? "text-bad-fg" : "text-accent"
                      )}
                    >
                      {tag.label}
                    </span>
                  )
                )}
              </span>
            )}
          {lines !== undefined && lines.length > 0 && (
            <span className="mt-2 flex flex-col gap-1 border-t border-dashed border-hairline pt-2">
              {lines.map((line) => (
                <span
                  key={line.key}
                  className="flex items-baseline justify-between gap-3 tabular-nums"
                >
                  <span className="min-w-0 truncate text-body">
                    {line.label}
                    {line.code !== undefined && (
                      <span className="ml-1.5 font-mono text-mute">
                        {line.code}
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 whitespace-nowrap text-body">
                    {line.owed !== undefined && line.owed > 0 && (
                      <span className="mr-2 font-medium text-bad-fg">
                        take out {count(line.owed)}
                      </span>
                    )}
                    {count(line.pieces)} {line.pieces === 1 ? "pc" : "pcs"}
                  </span>
                </span>
              ))}
            </span>
          )}
        </span>
        {stamp !== undefined && (
          <span className="pointer-events-none absolute bottom-3 left-1/2 z-[2] -translate-x-1/2 rotate-[-7deg] rounded-[0.625rem] border-[3px] border-bad-fg bg-canvas/70 px-3.5 text-[1.375rem] leading-8 font-bold tracking-[0.06em] whitespace-nowrap text-bad-fg">
            {stamp}
          </span>
        )}
      </span>
      {flag !== undefined && (
        <span className="board-flag flex min-h-11 items-center gap-2 border-t border-hairline px-4 py-2 text-bad-fg">
          <Flag className="size-4 shrink-0" aria-hidden />
          <span className="min-w-0">{flag}</span>
        </span>
      )}
      {act !== undefined && !switchedOff && (
        <span
          className="board-act flex min-h-11 items-center justify-between gap-2 border-t border-hairline px-4 py-2 text-body transition-colors group-hover/card:text-ink"
          aria-hidden
        >
          {/* The step as a word and an arrow along the foot; in the All white look
              the same two as a small solid button at the foot's end. */}
          <span className="board-act-btn contents">
            {act}
            <ArrowRight className="size-4 shrink-0" />
          </span>
        </span>
      )}
      {switchedOff && <span aria-hidden className={SWITCHED_OFF} />}
    </>
  )
  // A card with a button of its own is a frame around two things: the press
  // that opens it and the button. The frame takes the border and the press
  // feedback; the press area inside it goes flat.
  const card = acting ? (
    <div
      className={cn(
        CARD_FRAME,
        "transition-[border-color,transform] duration-(--t-press) ease-(--ease-out) hover:border-hairline-strong has-[[data-press]:active]:scale-[0.98] motion-reduce:transition-none motion-reduce:has-[[data-press]:active]:scale-100",
        switchedOff && "bg-soft",
        ticked,
        className
      )}
    >
      <Card
        to={to}
        sheet={sheet}
        onOpen={onOpen}
        inert={switchedOff}
        className="rounded-none border-0 bg-transparent shadow-none hover:border-transparent active:scale-100"
      >
        {inside}
      </Card>
      <div className="flex flex-col gap-2 px-2 pb-2">
        {ack !== undefined && (
          <Button
            variant="tint"
            className="w-full"
            pending={ack.pending}
            onClick={ack.onClick}
          >
            {ack.label}
          </Button>
        )}
        {onAction !== undefined && actionLabel !== undefined && (
          // The only card action is Put back: red, as in the prototype.
          <Button variant="danger" className="w-full" onClick={onAction}>
            {actionLabel}
          </Button>
        )}
      </div>
    </div>
  ) : (
    <Card
      onOpen={onOpen}
      to={to}
      sheet={sheet}
      inert={switchedOff}
      className={cn(switchedOff && "bg-soft", ticked, className)}
    >
      {inside}
    </Card>
  )
  const dragged =
    drag === undefined ? (
      card
    ) : (
      <DraggableCard card={drag} node={card}>
        {card}
      </DraggableCard>
    )
  if (pick === undefined) return dragged
  return (
    <div className="relative">
      {dragged}
      <span
        className={cn(
          "absolute left-1",
          strip !== undefined ? "top-8" : "top-1"
        )}
        title={pick.title}
        onClick={(event) => event.stopPropagation()}
      >
        <Checkbox
          label={<span className="sr-only">{pick.label}</span>}
          checked={pick.checked}
          onChange={pick.onChange}
          disabled={pick.disabled}
          className="[&>label]:size-11 [&>label]:justify-center"
        />
      </span>
    </div>
  )
}
