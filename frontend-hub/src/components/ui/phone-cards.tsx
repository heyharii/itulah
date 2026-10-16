import { ChevronDown } from "lucide-react"

import { Button } from "@/components/ui/button"
import { LoadMore, type Pageable } from "@/components/ui/states"
import { EMPTY, day, dayMonth, monthName } from "@/lib/format"
import { FOCUSED, openable } from "@/lib/openable"
import { cn } from "@/lib/utils"

/// The phone's record card, written once.
///
/// One card for every list on a phone (owner, 2026-10-06): the thing on the
/// left — its name over a thin mono code — and the ONE figure that matters on
/// the right (24px, semibold, a 14px caption under it); a hairline; then what
/// the record says about itself on the left of the foot, and on the right ONE
/// tint word button (`<CardButton>`, or a `<Button variant="tint" size="card">`)
/// or one status (`<Status>`; a `<Pill>` where the status is the card's whole
/// point). A tap anywhere on the card does what the button does.
///
/// Use PhoneCards or DataTable's card mode?
///  - **`DataTable` with `cardLead`** when the rows are ALSO a table on a desk:
///    the card is read off the columns' `meta.card` roles (title, lead, foot,
///    status), and sorting, hidden columns and paging come with the table.
///  - **`PhoneCards` / `PhoneCard`** when the phone's list is its own thing —
///    the desk draws a grid, a board, a `MiniTable` or something else — so there
///    are no columns to read roles from: you say the parts of the card as a
///    function of the row. A list that is a few hand-laid cards (a day's
///    takings, a ledger) is a `PhoneList` of `PhoneCard`s.
/// Both draw the SAME frame — `DataTable` renders `PhoneCard` — so a change to
/// the card is made here and nowhere else. Do not write another one.

/// The desk's toolbar row, for a screen whose search, filters and status are the
/// dock's on a phone: not drawn there. A plain row rather than `<Toolbar>`, which
/// would put its own "Filters" button in the dock for the moment before the
/// dock's tools claim it.
export const DESK_BAR =
  "mb-3.5 flex flex-wrap items-center gap-[0.4375rem] max-md:hidden"

/// Whether a part has something to draw: not nothing, not an empty string.
function filled(part: React.ReactNode): boolean {
  return part !== undefined && part !== null && part !== false && part !== ""
}

/// The lines a `CardLines` says: one, or one to an element.
function linesOf(line: CardLines): React.ReactNode[] {
  return (
    Array.isArray(line)
      ? (line as React.ReactNode[])
      : [line as React.ReactNode]
  ).filter(filled)
}

// ---------------------------------------------------------------------------
// The pieces
// ---------------------------------------------------------------------------

/// How a figure reads: `quiet` for a zero or an absence, `warn` and `bad` for a
/// figure that says something is wrong.
export type FigureTone = "quiet" | "warn" | "bad"

const FIGURE_TONE: Record<FigureTone, string> = {
  quiet: "text-mute",
  warn: "text-warn-fg",
  bad: "text-bad-fg",
}

/// What a name has under it: one quiet line of words, or several, one to a line
/// (a place, then who holds it). A line that is nothing is left out.
export type CardLines = React.ReactNode | readonly React.ReactNode[]

/// The thing a card is about: its name over a thin mono code and any quiet
/// lines of words. The code is for what the name does not already say (a
/// number, a SKU); `muted` greys a record that is over.
export function CardName({
  name,
  code,
  line,
  muted = false,
}: {
  name: React.ReactNode
  /// The thin mono line: a voucher's code, an article's number.
  code?: React.ReactNode
  /// Quiet lines of words under it ("Cikupa · 3 lines"), where one says
  /// something. An array is one line to an element.
  line?: CardLines
  muted?: boolean
}) {
  return (
    <span className="flex min-w-0 flex-col gap-0.5">
      <span
        className={cn(
          "min-w-0 text-card-title font-semibold break-words",
          muted ? "text-mute" : "text-ink"
        )}
      >
        {name}
      </span>
      {filled(code) && (
        <span className="truncate font-mono text-[0.9375rem] font-normal text-mute">
          {code}
        </span>
      )}
      {linesOf(line).map((one, index) => (
        <span
          key={index}
          className="min-w-0 text-[0.9375rem] font-normal break-words text-mute"
        >
          {one}
        </span>
      ))}
    </span>
  )
}

/// The figure a card leads with, at its right: 24px, semibold, with what it
/// counts under it in the quiet colour.
export function CardFigure({
  value,
  caption,
  tone,
}: {
  value: React.ReactNode
  /// A few words under it — its unit ("pcs", "balance").
  caption?: React.ReactNode
  tone?: FigureTone
}) {
  return (
    <span className="flex flex-col items-end text-right tabular-nums">
      <span
        className={cn(
          "text-[1.5rem] leading-tight font-semibold tracking-tight whitespace-nowrap",
          tone === undefined ? "text-ink" : FIGURE_TONE[tone]
        )}
      >
        {value}
      </span>
      {filled(caption) && (
        <span className="max-w-[10rem] text-[0.9375rem] text-mute">
          {caption}
        </span>
      )}
    </span>
  )
}

/// A date as a card's figure: the day and month large, the year under it.
export function CardDate({
  iso,
  label,
  tone,
}: {
  iso: string | null | undefined
  /// What the date is, in lower case, said before the year: "expires 2026".
  label?: string
  tone?: FigureTone
}) {
  if (!iso) return <CardFigure value={EMPTY} tone="quiet" />
  const year = day(iso).split(" ").at(-1)
  return (
    <CardFigure
      value={dayMonth(iso)}
      caption={label === undefined ? year : `${label} ${year}`}
      tone={tone}
    />
  )
}

/// A month ("2026-09") as a card's figure: the month large, the year under.
export function CardMonth({
  period,
  tone,
}: {
  period: string
  tone?: FigureTone
}) {
  const month = monthName(period)
  if (month === EMPTY || !/^\d{4}/.test(period))
    return <CardFigure value={period} tone={tone} />
  return <CardFigure value={month} caption={period.slice(0, 4)} tone={tone} />
}

/// The one button on a card's foot: a word, never an icon. It opens what the
/// card's own tap opens, so the tap on the button does not also fall through to
/// the card.
export function CardButton({
  label,
  onClick,
  disabled,
  ariaLabel,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  ariaLabel?: string
}) {
  return (
    <Button
      variant="tint"
      size="card"
      disabled={disabled}
      aria-label={ariaLabel}
      onClick={(event) => {
        event.stopPropagation()
        onClick()
      }}
    >
      {label}
    </Button>
  )
}

/// A foot's left side: a status over a line of facts, or either alone.
export function CardFoot({
  status,
  children,
}: {
  status?: React.ReactNode
  children?: React.ReactNode
}) {
  return (
    <span className="flex min-w-0 flex-col gap-1 leading-5">
      {status}
      {children !== undefined && children !== null && <span>{children}</span>}
    </span>
  )
}

/// The figures of a phone list as one sentence under the title, in place of a
/// strip of tiles: "Rp 4.200.000 is still out on 12 live vouchers." Each figure
/// is a `<Fig>`.
export function Sentence({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <p
      className={cn(
        "mb-4 text-[0.9375rem] leading-normal text-pretty text-body",
        className
      )}
    >
      {children}
    </p>
  )
}

export function Fig({
  children,
  tone,
}: {
  children: React.ReactNode
  tone?: "bad" | "warn"
}) {
  return (
    <b
      className={cn(
        "font-semibold tabular-nums",
        tone === "bad"
          ? "text-bad-fg"
          : tone === "warn"
            ? "text-warn-fg"
            : "text-ink"
      )}
    >
      {children}
    </b>
  )
}

// ---------------------------------------------------------------------------
// The card
// ---------------------------------------------------------------------------

/// What a card says. The same parts whether the card is one of a hand-laid
/// `PhoneList`, one row of `PhoneCards`, or a `DataTable` row drawn as a card.
export interface PhoneCardProps {
  /// The thing. With `code` and `line` it is drawn as a `<CardName>`.
  readonly title?: React.ReactNode
  /// A thin mono line under the title. Leave it out when it only repeats it.
  readonly code?: React.ReactNode
  /// Quiet words under the title, one line or several (`CardLines`).
  readonly line?: CardLines
  /// A record that is switched off or finished: its title recedes.
  readonly muted?: boolean
  /// The whole head, for the card whose head is not a name over a line (a
  /// thumbnail beside it). Replaces `title`, `code` and `line`.
  readonly head?: React.ReactNode
  /// The figure the card is read for. A string or a number is drawn as a
  /// `<CardFigure>` with `caption` and `tone`; a node is drawn as it is.
  readonly lead?: React.ReactNode
  readonly caption?: React.ReactNode
  readonly tone?: FigureTone
  /// A section of its own between the head and the foot, under a hairline:
  /// the lines of figures or the one field the card is also for (a date typed
  /// against it). A press on a control in it does not open the card.
  readonly body?: React.ReactNode
  /// What the foot says on the left: where the record stands, a date.
  readonly foot?: React.ReactNode
  /// The right of the foot: ONE tint word button or one status.
  readonly action?: React.ReactNode
  /// The foot takes a light red wash: this one needs somebody.
  readonly alert?: boolean
  /// The record open beside the list (a tablet, a wide phone): a tint.
  readonly selected?: boolean
  /// A row that has just arrived.
  readonly fresh?: boolean
  /// A tap on the card. Left out, the card only reads.
  readonly onOpen?: () => void
  /// Pointer, focus and touch handlers that tell the screen the card is about
  /// to be opened (`DataTable`'s `onRowIntent`, `lib/row-intent.tsx`).
  readonly intent?: React.HTMLAttributes<HTMLElement>
  readonly className?: string
  /// Under the foot, inside the card: what an opened card unfolds.
  readonly children?: React.ReactNode
}

/// A press on a button or a link inside part of a card is that control's, not
/// the card's. Everything else in the part opens the card.
function ownClick(event: React.MouseEvent<HTMLElement>) {
  if (
    event.target instanceof Element &&
    event.target.closest("button, a, input, select, textarea, label") !== null
  )
    event.stopPropagation()
}

/// One record as a card. Put it in a `PhoneList`; a `<li>`.
export function PhoneCard({
  title,
  code,
  line,
  muted,
  head,
  lead,
  caption,
  tone,
  body,
  foot,
  action,
  alert = false,
  selected = false,
  fresh = false,
  onOpen,
  intent,
  className,
  children,
}: PhoneCardProps) {
  return (
    <li
      {...intent}
      onClick={onOpen}
      {...(onOpen === undefined ? {} : openable(onOpen))}
      data-selected={selected || undefined}
      data-fresh={fresh || undefined}
      aria-current={selected || undefined}
      className={cn(
        "relative flex flex-col rounded-card border border-hairline bg-canvas shadow-soft",
        fresh && "row-fresh",
        onOpen !== undefined && cn("cursor-pointer", FOCUSED),
        selected ? "bg-accent-bg" : onOpen !== undefined && "active:bg-soft",
        className
      )}
    >
      <div className="flex items-start gap-3 p-4">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          {head !== undefined ? (
            head
          ) : (
            <CardName name={title} code={code} line={line} muted={muted} />
          )}
        </div>
        {filled(lead) && (
          <div className="min-w-0 shrink-0">
            {typeof lead === "string" || typeof lead === "number" ? (
              <CardFigure value={lead} caption={caption} tone={tone} />
            ) : (
              lead
            )}
          </div>
        )}
      </div>
      {filled(body) && (
        <div className="border-t border-hairline px-4 py-3" onClick={ownClick}>
          {body}
        </div>
      )}
      {/* A card with no foot and no action is its head alone: the bar under
          the hairline is drawn only when a part says something for it. */}
      {(foot !== undefined || action !== undefined) && (
        <div
          className={cn(
            "flex items-center justify-between gap-3 rounded-b-card border-t px-4 py-3",
            alert ? "border-bad/10 bg-bad-bg/50" : "border-hairline"
          )}
        >
          <div className="min-w-0 text-[0.9375rem] text-mute">{foot}</div>
          <div className="flex shrink-0 items-center" onClick={ownClick}>
            {action}
          </div>
        </div>
      )}
      {children}
    </li>
  )
}

/// The ground the heading of a group is stuck to, while its cards pass under
/// it: the page's own, since the cards pass behind. The air above a group is
/// the heading's margin, not its padding, so a heading stuck to the top takes
/// no more room than its own line.
export const STICKY_HEADING =
  "sticky top-0 z-10 -mx-1 bg-canvas px-1 not-first:mt-3"

/// The line that opens a group of cards: what the group is, how many it holds,
/// what they come to, and — when `onToggle` is given — a chevron that folds the
/// group. Drawn inside `renderBefore` of a `DataTable` (which wraps it in its
/// own `<li>`), or as a `<PhoneHeading>` in a `PhoneList`.
export function GroupHeading({
  title,
  mark,
  count,
  total,
  open = true,
  onToggle,
}: {
  title: React.ReactNode
  /// What stands before the title: a stage's dot.
  mark?: React.ReactNode
  /// How many it holds: "3 items".
  count?: React.ReactNode
  /// What it comes to, at the right: "120 pcs", "Rp 4,0 B".
  total?: React.ReactNode
  open?: boolean
  onToggle?: () => void
}) {
  const inside = (
    <>
      {mark}
      <span className="min-w-0 text-[1rem] font-semibold break-words text-ink">
        {title}
      </span>
      {filled(count) && (
        <span className="shrink-0 text-[0.9375rem] text-mute tabular-nums">
          {count}
        </span>
      )}
      <span className="flex-1" />
      {filled(total) && (
        <span className="shrink-0 text-[0.9375rem] text-mute tabular-nums">
          {total}
        </span>
      )}
      {onToggle !== undefined && (
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-line-ico transition-[rotate] duration-200 ease-(--ease-out) motion-reduce:transition-none",
            !open && "-rotate-90"
          )}
        />
      )}
    </>
  )
  return onToggle === undefined ? (
    <div className="flex w-full items-center gap-2 px-1 py-2">{inside}</div>
  ) : (
    <button
      type="button"
      aria-expanded={open}
      onClick={onToggle}
      className="flex w-full items-center gap-2 px-1 py-2 text-left transition-opacity active:opacity-60"
    >
      {inside}
    </button>
  )
}

/// A `GroupHeading` as an item of a `PhoneList`.
export function PhoneHeading(props: React.ComponentProps<typeof GroupHeading>) {
  return (
    <li data-sub className={STICKY_HEADING}>
      <GroupHeading {...props} />
    </li>
  )
}

/// A column of cards, each standing apart.
///
/// Give it `PhoneCard`s (and `PhoneHeading`s) as children, or `rows` — each a
/// card's parts and its `key` — for a list whose cards are only data.
export function PhoneList({
  rows,
  children,
  className,
}: {
  rows?: readonly (PhoneCardProps & { readonly key: string })[]
  children?: React.ReactNode
  className?: string
}) {
  return (
    <ul className={cn("flex flex-col gap-2.5", className)}>
      {rows?.map(({ key, ...card }) => (
        <PhoneCard key={key} {...card} />
      ))}
      {children}
    </ul>
  )
}

// ---------------------------------------------------------------------------
// A list of records
// ---------------------------------------------------------------------------

/// A card as a function of a row. Each part is read at render, so a spec that
/// closes over the screen's state never goes stale; a part that returns
/// nothing is not drawn (a line) or leaves the bar bare (the foot).
export interface CardSpec<T> {
  /// The thing: `<CardName>`, or its words as they are.
  readonly title: (row: T) => React.ReactNode
  /// Lines under the title, one to a line. A line that returns nothing is left
  /// out; the number of lines is fixed for a screen.
  readonly meta?: readonly ((row: T) => React.ReactNode)[]
  /// The one figure that matters, on the right: `<CardFigure>`.
  readonly lead?: (row: T) => React.ReactNode
  /// What the foot says on the left.
  readonly foot?: (row: T) => React.ReactNode
  /// The right of the foot: one tint word button or one status.
  readonly action?: (row: T) => React.ReactNode
  /// The foot takes a light red wash for this row.
  readonly alert?: (row: T) => boolean
}

/// A list of records as a phone draws them: a `PhoneCard` per row, `empty` when
/// there are none, the next page asked for as the foot comes into view.
export function PhoneCards<T>({
  rows,
  rowId,
  spec,
  onOpen,
  selected,
  more,
  empty,
  className,
}: {
  rows: readonly T[]
  rowId: (row: T) => string
  spec: CardSpec<T>
  /// A tap on the card: the same sheet the card's own button opens.
  onOpen?: (row: T) => void
  selected?: (row: T) => boolean
  /// The infinite query behind the rows.
  more?: Pageable
  empty?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn("min-h-0", className)}>
      {rows.length === 0 ? (
        <div className="px-3.5 py-10 text-center text-meta text-body">
          {empty ?? "Nothing to show."}
        </div>
      ) : (
        <PhoneList>
          {rows.map((row) => (
            <PhoneCard
              key={rowId(row)}
              head={
                <>
                  <div className="text-card-title font-semibold text-ink">
                    {spec.title(row)}
                  </div>
                  {spec.meta
                    ?.map((line) => line(row))
                    .filter(filled)
                    .map((line, index) => (
                      <div key={index} className="text-[0.9375rem] text-mute">
                        {line}
                      </div>
                    ))}
                </>
              }
              lead={spec.lead?.(row)}
              foot={spec.foot?.(row)}
              action={spec.action?.(row)}
              alert={spec.alert?.(row)}
              selected={selected?.(row)}
              onOpen={onOpen === undefined ? undefined : () => onOpen(row)}
            />
          ))}
        </PhoneList>
      )}
      {more !== undefined && <LoadMore query={more} />}
    </div>
  )
}
