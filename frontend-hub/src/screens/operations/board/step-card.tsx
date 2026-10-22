import { ChevronDown, ChevronRight } from "lucide-react"
import { Children, Fragment, useState } from "react"

import { STICKY_HEADING } from "@/components/ui/phone-cards"
import { DocStamp } from "@/components/ui/doc-stamp"
import { count, countPcs } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { ChangeTag } from "@/screens/operations/board/owed"
import { SWITCHED_OFF } from "@/screens/operations/board/stage-table"

/// **The Allotment board, option A** (owner, 17 Oct 2026, from
/// allotment-board-options.html: "ga jelas kalau bisa drag and drop, atau
/// harus ngapain", "ga usah pake foto di cardnya", then "update yg A ke kita").
///
/// No drag. The lanes are grey trays with a › between them, so they read as
/// places the goods move through, left to right. A card is one press: it opens
/// the step its foot names in blue ("Pick ›"), or in red when pieces have to go
/// back first ("Put back 6 ›"). No pictures on a card; the sheet has them.
///
/// Return Store keeps `Lane` and `Tile` (parts.tsx) as they were.

/// The row of trays, a › between each two. It scrolls sideways inside itself
/// on a narrow page, never the page.
export function Trays({ children }: { children: React.ReactNode }) {
  const trays = Children.toArray(children)
  return (
    <div
      data-board="outbound"
      // One 17rem-minimum column per lane with a 14px › column between
      // each two: four lanes since In transit (owner, 18 Oct 2026). A tray is
      // as tall as its cards, never taller than the page: the row is the
      // page's height and the tray starts at its top (pack-sheet-options).
      style={{
        gridTemplateColumns: trays
          .map(() => "minmax(17rem,1fr)")
          .join(" 14px "),
        gridTemplateRows: "minmax(0,1fr)",
      }}
      className="-mx-1 grid min-h-0 flex-1 [scrollbar-width:thin] items-start gap-1 overflow-x-auto px-1"
    >
      {trays.map((tray, index) => (
        <Fragment key={index}>
          {index > 0 && (
            <span
              aria-hidden
              className="flex justify-center pt-[1.0625rem] text-faint"
            >
              <ChevronRight className="size-4" strokeWidth={2.4} />
            </span>
          )}
          {tray}
        </Fragment>
      ))}
    </div>
  )
}

/// One lane: its dot, its name and how many cards, then the cards, scrolling
/// inside it. Empty, it says so in its middle (`empty`).
export function Tray({
  title,
  tone,
  cards,
  empty,
  action,
  gap = "gap-2",
  children,
}: {
  title: string
  /// The dot's colour class: `bg-mute` Pick, `bg-warn` Picked, `bg-info`
  /// Packed, `bg-ok` In transit.
  tone: string
  /// How many cards; absent while the board is still being read.
  cards?: number
  /// What an empty tray says, centred.
  empty?: React.ReactNode
  /// A small button in the header beside the count: Packed's "Dispatch"
  /// (owner, 18 Oct 2026).
  action?: React.ReactNode
  /// The space between what stands in it: 8 by default, 10 where the cards
  /// stand two across (a tablet).
  gap?: string
  children?: React.ReactNode
}) {
  return (
    <section
      aria-label={title}
      className="board-tray flex max-h-full min-h-0 flex-col rounded-[14px] bg-soft-2"
    >
      <header className="flex min-h-[3.25rem] shrink-0 items-center gap-2.5 px-3.5 pt-3.5 pb-2.5">
        <span className={cn("size-2 shrink-0 rounded-full", tone)} />
        <h2 className="min-w-0 truncate font-semibold text-ink">{title}</h2>
        {cards !== undefined && (
          <span className="ml-auto font-medium text-body tabular-nums">
            {count(cards)}
          </span>
        )}
        {action !== undefined && (
          <span className={cn("ml-2", cards === undefined && "ml-auto")}>
            {action}
          </span>
        )}
      </header>
      <div
        className={cn(
          "flex min-h-0 flex-1 [scrollbar-width:thin] flex-col overflow-y-auto px-2 pb-2 [&>*]:shrink-0",
          gap
        )}
      >
        {cards === 0 ? (
          <div className="grid flex-1 place-items-center">{empty}</div>
        ) : (
          children
        )}
      </div>
    </section>
  )
}

/// The shape of cards still on their way, in a tray or a phone section.
export function CardSkeletons({ count: many }: { count: number }) {
  return (
    <>
      {Array.from({ length: many }, (_, index) => (
        <div
          key={index}
          aria-hidden
          className="flex flex-col gap-2.5 rounded-[14px] bg-canvas p-4 motion-safe:animate-pulse"
        >
          <span className="h-3.5 w-3/5 rounded-full bg-soft-2" />
          <span className="h-3.5 w-2/5 rounded-full bg-soft-2" />
          <span className="mt-2 h-3.5 w-1/3 rounded-full bg-soft-2" />
        </div>
      ))}
    </>
  )
}

/// A phone has no room for trays: each lane is a heading that folds, in the
/// order the goods move, with the same cards under it as on a desk.
export function TraySections({
  sections,
}: {
  sections: readonly {
    id: string
    title: string
    tone: string
    cards?: number
    pieces?: number
    empty?: React.ReactNode
    /// The lane's one button, at the top of its open body (Packed's Dispatch).
    action?: React.ReactNode
    children?: React.ReactNode
  }[]
}) {
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set())
  return (
    <div className="flex flex-col">
      {sections.map((one) => {
        const open = !folded.has(one.id)
        return (
          <section key={one.id} aria-label={one.title}>
            <div className={STICKY_HEADING}>
              <button
                type="button"
                aria-expanded={open}
                onClick={() =>
                  setFolded((was) => {
                    const next = new Set(was)
                    if (next.has(one.id)) next.delete(one.id)
                    else next.add(one.id)
                    return next
                  })
                }
                className="flex w-full items-center gap-2 px-1 py-2 text-left transition-opacity active:opacity-60"
              >
                <span
                  className={cn("size-2 shrink-0 rounded-full", one.tone)}
                />
                <span className="text-[1rem] font-semibold text-ink">
                  {one.title}
                </span>
                {one.cards !== undefined && (
                  <span className="text-mute tabular-nums">
                    {count(one.cards)}
                  </span>
                )}
                <span className="flex-1" />
                {one.pieces !== undefined && (
                  <span className="text-mute tabular-nums">
                    {countPcs(one.pieces)}
                  </span>
                )}
                <ChevronDown
                  className={cn(
                    "size-4 shrink-0 text-line-ico transition-[rotate] duration-200 ease-(--ease-out) motion-reduce:transition-none",
                    !open && "-rotate-90"
                  )}
                />
              </button>
            </div>
            {open && (
              <div className="flex flex-col gap-2.5 pb-2">
                {one.action !== undefined && one.cards !== 0 && (
                  <div className="flex justify-end px-1">{one.action}</div>
                )}
                {one.cards === 0 ? (
                  <p className="px-1 pb-2 text-body">{one.empty}</p>
                ) : (
                  one.children
                )}
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}

/// MD's changes as words after the card's fact: "−6 by MD", "Added +20".
function TagWords({ tags }: { tags: readonly ChangeTag[] }) {
  return (
    <>
      {tags.map((tag) => {
        if (tag.was === undefined || tag.now === undefined)
          return (
            <Fragment key={tag.label}>
              {" · "}
              <span
                className={cn(
                  "font-semibold",
                  tag.tone === "bad" ? "text-bad-fg" : "text-accent"
                )}
              >
                {tag.label}
              </span>
            </Fragment>
          )
        const less = tag.now < tag.was
        return (
          <Fragment key={tag.label}>
            {" · "}
            <span
              className={cn(
                "font-semibold tabular-nums",
                less ? "text-bad-fg" : "text-accent"
              )}
            >
              {less ? "−" : "+"}
              {count(Math.abs(tag.now - tag.was))}
            </span>{" "}
            by MD
          </Fragment>
        )
      })}
    </>
  )
}

/// **One card**: who it is for and its pieces on one line, the store and the
/// allotment under it, a store's koli when it has any, then its fact at the
/// left of the foot and its step at the right. The whole card is the press.
///
/// `id` names it for the flight to the next lane (`useHandOff`).
export function StepCard({
  id,
  title,
  pieces,
  from,
  unit,
  sub,
  meta,
  tags,
  lines,
  strip,
  picture,
  cancelled = false,
  step,
  pending = false,
  onOpen,
}: {
  id: string
  title: React.ReactNode
  /// The pieces it holds; with `from`, what MD left of them: "30 → 24 pcs".
  pieces: number
  from?: number
  /// What `pieces` counts, when it is not pieces.
  unit?: string
  sub?: React.ReactNode
  /// The fact at the left of the foot: "4 SKUs", "2 koli".
  meta?: React.ReactNode
  /// What MD changed that nobody opened yet, after the fact.
  tags?: readonly ChangeTag[]
  /// A store's koli, under a dashed rule: "Koli 1 · KOLI-0012 — 30 pcs".
  lines?: readonly {
    key: string
    label: string
    code?: string
    pieces: number
    /// What MD wants out of it before it may go.
    owed?: number
    /// Said at the right instead of the pieces: an In transit trip's store
    /// reads "In transit", "Received" or "Short −2 · MD reviews". Plain words,
    /// as the line's own colour (pack-sheet-options).
    status?: string
    /// Makes the line a button of its own (a Packed koli opens its
    /// contents). The card then stops being one button, so the two never nest.
    onPress?: () => void
  }[]
  /// The band across the top: amber "Short pick", red "Edited −6", blue
  /// "Edited by MD". The reason is the tooltip.
  strip?: { tone: "warn" | "bad" | "info"; label: string; title?: string }
  /// The article's picture at the left of the title row: Pick cards only
  /// (owner, 18 Oct 2026: a store or a trip has no picture).
  picture?: React.ReactNode
  /// MD called the whole card off: hatched and stamped; the press is the one
  /// thing left (Put back, or OK).
  cancelled?: boolean
  /// What the press does, said at the foot: blue, red for pieces going back.
  step?: { label: string; tone?: "bad"; chevron?: boolean }
  pending?: boolean
  /// Absent, the card is only read: an In transit trip, whose next step is
  /// the store's receiving, not the Gudang's.
  onOpen?: () => void
}) {
  // A card whose lines are buttons cannot itself be a <button>.
  const nested = lines?.some((line) => line.onPress !== undefined) === true
  const Card = (onOpen === undefined || nested ? "div" : "button") as "button"
  return (
    <Card
      type={onOpen === undefined || nested ? undefined : "button"}
      data-card={id}
      data-pieces={pieces}
      onClick={pending ? undefined : onOpen}
      {...(nested && onOpen !== undefined
        ? {
            role: "button",
            tabIndex: 0,
            "aria-disabled": pending || undefined,
            onKeyDown: (event: React.KeyboardEvent) => {
              if (
                event.target === event.currentTarget &&
                (event.key === "Enter" || event.key === " ")
              ) {
                event.preventDefault()
                onOpen()
              }
            },
          }
        : {})}
      disabled={onOpen === undefined || nested ? undefined : pending}
      className={cn(
        "board-card relative flex w-full flex-col overflow-hidden rounded-[14px] border border-hairline bg-canvas text-left transition-[border-color,box-shadow,transform] duration-(--t-press) ease-(--ease-out) disabled:opacity-60 motion-reduce:transition-none",
        onOpen !== undefined &&
          "hover:border-hairline-2 active:scale-[0.98] motion-reduce:active:scale-100",
        cancelled && "bg-soft"
      )}
    >
      {strip !== undefined && (
        <span
          title={strip.title}
          className={cn(
            "flex h-7 shrink-0 items-center px-4 font-semibold whitespace-nowrap text-white",
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
      <span className="flex flex-col px-4 py-3.5">
        <span
          className={cn("flex flex-col", cancelled && "opacity-50 grayscale")}
        >
          {/* The picture (a Pick card's) stands at the left of BOTH lines, the
          title and the store under it, centred on them. */}
          <span
            className={cn(
              "flex gap-2.5",
              picture !== undefined ? "items-center" : "items-start"
            )}
          >
            {picture}
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 flex-1 truncate text-[1.0625rem] leading-[1.4] font-semibold text-ink">
                  {title}
                </span>
                <span className="shrink-0 font-semibold whitespace-nowrap text-ink tabular-nums">
                  {from !== undefined && (
                    <span className="font-normal text-body">
                      {count(from)} →{" "}
                    </span>
                  )}
                  {count(pieces)}{" "}
                  <span className="font-normal text-body">
                    {unit ?? (pieces === 1 ? "pc" : "pcs")}
                  </span>
                </span>
              </span>
              {sub !== undefined && (
                <span className="min-w-0 truncate text-body">{sub}</span>
              )}
            </span>
          </span>
          {lines !== undefined && lines.length > 0 && (
            <span className="mt-2 flex flex-col gap-0.5 border-t border-dashed border-hairline pt-2">
              {lines.map((line) => {
                const text = (
                  <>
                    <span
                      className={cn(
                        "min-w-0 truncate",
                        // A koli opens what is inside it: its words are
                        // underlined, quietly, so they read as pressable
                        // (pack-sheet-options `.sclk`).
                        line.onPress !== undefined &&
                          "underline decoration-faint decoration-1 underline-offset-[3px] group-hover/line:decoration-current"
                      )}
                    >
                      {line.label}
                      {line.code !== undefined && ` · ${line.code}`}
                    </span>
                    <span className="inline-flex shrink-0 items-center gap-0.5 whitespace-nowrap">
                      {line.owed !== undefined && line.owed > 0 && (
                        <span className="mr-2 font-medium text-bad-fg">
                          take out {count(line.owed)}
                        </span>
                      )}
                      {line.status !== undefined ? (
                        line.status
                      ) : (
                        <>
                          {count(line.pieces)}{" "}
                          {line.pieces === 1 ? "pc" : "pcs"}
                        </>
                      )}
                    </span>
                  </>
                )
                return line.onPress === undefined ? (
                  <span
                    key={line.key}
                    className="flex items-baseline justify-between gap-3 text-body tabular-nums"
                  >
                    {text}
                  </span>
                ) : (
                  <button
                    key={line.key}
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation()
                      line.onPress?.()
                    }}
                    className="group/line -mx-1.5 flex items-baseline justify-between gap-3 rounded-md px-1.5 py-0.5 text-left text-body tabular-nums transition-colors pointer-coarse:min-h-11 pointer-coarse:items-center"
                  >
                    {text}
                  </button>
                )
              })}
            </span>
          )}
        </span>
        {cancelled && (
          <span className="relative z-[2] flex justify-center pt-3 pb-1">
            <DocStamp
              word="Cancelled"
              tone="mute"
              at={null}
              className="static"
            />
          </span>
        )}
        <span className="relative z-[2] mt-2.5 flex min-h-[1.875rem] items-center justify-between gap-3">
          <span
            className={cn(
              "min-w-0 truncate text-body",
              cancelled && "opacity-50"
            )}
          >
            {meta}
            {tags !== undefined && <TagWords tags={tags} />}
          </span>
          {step !== undefined && (
            <span
              className={cn(
                "inline-flex shrink-0 items-center gap-0.5 font-semibold whitespace-nowrap",
                step.tone === "bad" ? "text-bad-fg" : "text-accent"
              )}
            >
              {step.label}
              {step.chevron !== false && (
                <ChevronRight
                  className="size-4"
                  strokeWidth={2.6}
                  aria-hidden
                />
              )}
            </span>
          )}
        </span>
      </span>
      {cancelled && <span aria-hidden className={SWITCHED_OFF} />}
    </Card>
  )
}
