import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { ChevronDown, Columns3, Rows3 } from "lucide-react"
import { Fragment, useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Checkbox } from "@/components/ui/field"
import {
  CardButton,
  CardFigure,
  CardName,
  PhoneCard,
  STICKY_HEADING,
} from "@/components/ui/phone-cards"
import { RefreshStrip, type Refreshable } from "@/components/ui/refresh-stamp"
import { EmptyState } from "@/components/ui/states"
import { Segmented } from "@/components/ui/segmented"
import { count as figure } from "@/lib/format"
import { ago } from "@/lib/format"
import { useAppNavigate } from "@/lib/navigate"
import { useLayout } from "@/lib/layout"
import type { SheetKey } from "@/lib/sheets"
import { useOpenHere } from "@/screens/operations/board/open-here"
import { tableSetup, type TableSetup } from "@/lib/table"
import { cn } from "@/lib/utils"
import { button } from "@/components/ui/button-style"
import { ROOMY } from "@/screens/operations/roomy"
import { TwoLines } from "@/screens/operations/two-lines"

import { byStage, type BoardView } from "@/screens/operations/board/board-view"

export function ViewSwitch({
  value,
  onChange,
}: {
  value: BoardView
  onChange: (next: BoardView) => void
}) {
  return (
    <Segmented<BoardView>
      value={value}
      onChange={onChange}
      options={[
        {
          value: "board",
          label: (
            <span className="inline-flex items-center gap-1.5">
              <Columns3 className="size-4" />
              Board
            </span>
          ),
        },
        {
          value: "table",
          label: (
            <span className="inline-flex items-center gap-1.5">
              <Rows3 className="size-4" />
              Table
            </span>
          ),
        },
      ]}
    />
  )
}

/// One card, as a row: the same facts the card shows, plus the lane it sits in.
export interface StageRow {
  readonly key: string
  readonly stage: {
    readonly id: string
    readonly label: string
    /// The lane's dot colour class, e.g. `bg-warn`.
    readonly tone: string
    /// The lane's place in the flow.
    readonly order: number
  }
  readonly title: React.ReactNode
  readonly doc?: React.ReactNode
  /// A second grouping the board lays out by (Spread's supplier).
  readonly group?: string
  readonly detail?: React.ReactNode
  readonly pieces: number
  readonly of?: number
  readonly flag?: React.ReactNode
  readonly at?: string | null
  readonly late?: boolean
  /// What the card does when pressed; absent = the row does nothing.
  readonly open?: {
    readonly to: string
    readonly sheet?: { readonly key: SheetKey; readonly value: string }
  }
  readonly onOpen?: () => void
  /// The verb the card's button says.
  readonly act?: string
  /// A leading tick, on the rows that can be picked (Packed cartons).
  /// `disabled` is a row that cannot be picked, and `title` says why.
  readonly pick?: {
    readonly checked: boolean
    readonly onChange: (checked: boolean) => void
    readonly label: string
    readonly disabled?: boolean
    readonly title?: string
  }
  /// What the card's strip says, in words. `text` is the whole sentence the
  /// table reads ("Edited −50 · 50 pcs to move back"); on a phone's card the
  /// `strip` is the band across its top and `detail` the line under it, so the
  /// band's words are not said twice. Amber for `warn`, red for `bad`.
  readonly mark?: {
    readonly tone: "warn" | "bad"
    readonly text: string
    readonly strip?: string
    readonly detail: string
  }
  /// The stamp across a switched-off card ("CANCELLED").
  readonly stamp?: string
  /// What the row held and what is still wanted of it: pieces read "300 → 250".
  readonly change?: { readonly from: number; readonly to: number }
  /// Switched off (MD cancelled it): nothing opens from the row, and its one
  /// live thing is `moveBack`.
  readonly off?: boolean
  /// The Move back button, as `act` says it. Opens the dialog; never writes.
  readonly moveBack?: () => void
  /// What MD changed that the warehouse has not acknowledged ("Added +20",
  /// "300 → 330", "Cancelled"), and the button that acknowledges it.
  readonly tags?: readonly {
    readonly tone: "warn" | "bad"
    readonly label: string
    readonly was?: number
    readonly now?: number
  }[]
  /// MD changed it and nobody opened it yet: a blue dot by the name.
  readonly dot?: boolean
  /// The "OK" of a leftover cancelled row; no other row has a button for
  /// MD's change — opening the work is seeing it.
  readonly ack?: {
    readonly label: string
    readonly onClick: () => void
    readonly pending?: boolean
  }
}

const markTone = (mark: NonNullable<StageRow["mark"]>) =>
  mark.tone === "bad" ? "text-bad-fg" : "text-warn-fg"

const tagTone = (tag: { readonly tone: "warn" | "bad" }) =>
  tag.tone === "bad" ? "text-bad-fg" : "text-accent"

/// One of MD's changes as the row says it: "<s>300</s> 250 pcs by MD", or
/// its word ("Cancelled", "Added +20").
function TagText({ tag }: { tag: NonNullable<StageRow["tags"]>[number] }) {
  if (tag.was === undefined || tag.now === undefined)
    return <span className={tagTone(tag)}>{tag.label}</span>
  return (
    <span className="font-normal text-body tabular-nums">
      <s className="text-mute">{figure(tag.was)}</s>{" "}
      <span className="font-semibold text-ink">{figure(tag.now)}</span>{" "}
      {tag.now === 1 ? "pc" : "pcs"} by MD
    </span>
  )
}

/// The blue dot of a row MD changed that nobody has opened yet.
function Dot() {
  return (
    <span
      title="Changed by MD"
      className="inline-block size-[7px] shrink-0 rounded-full bg-accent"
    >
      <span className="sr-only">Changed by MD</span>
    </span>
  )
}

/// The hatched layer of a card that is switched off: it reads as something
/// that no longer works, whatever is written on it. It never takes a press, so
/// a button above it (z-2) stays the card's one live thing.
export const SWITCHED_OFF =
  "pointer-events-none absolute inset-0 z-[1] bg-[repeating-linear-gradient(135deg,color-mix(in_oklab,var(--ink)_5%,transparent)_0_7px,transparent_7px_14px)]"

function columnsFor(
  first: string,
  group: string | undefined,
  pickable: boolean,
  stages: boolean
) {
  const out: ColumnDef<TableSetup, StageRow>[] = []
  if (pickable) {
    out.push({
      id: "pick",
      header: "",
      size: 64,
      enableSorting: false,
      enableHiding: false,
      meta: { card: "status" },
      cell: ({ row }) => {
        const pick = row.original.pick
        if (!pick) return null
        return (
          <span
            className="-my-3 inline-flex"
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
        )
      },
    })
  }
  out.push(
    {
      id: "no",
      header: "No.",
      size: 70,
      enableSorting: false,
      meta: { align: "right", priority: 2, card: "hide" },
      cell: ({ row }) => <span className="text-mute">{row.index + 1}</span>,
    },
    {
      id: "name",
      header: first,
      size: 260,
      meta: { card: "title", grow: 240 },
      enableSorting: false,
      cell: ({ row }) => (
        <TwoLines
          top={
            row.original.dot ? (
              <span className="inline-flex items-center gap-2">
                <Dot />
                {row.original.title}
              </span>
            ) : (
              row.original.title
            )
          }
          bottom={row.original.doc ?? ""}
          mono
        />
      ),
    },
    {
      id: "stage",
      header: "Stage",
      size: 170,
      meta: { swap: true, card: "hide" },
      accessorFn: (row) => row.stage.order,
      cell: ({ row }) => (
        <span className="inline-flex items-center gap-2">
          <span
            className={cn("size-2 rounded-full", row.original.stage.tone)}
          />
          {row.original.stage.label}
        </span>
      ),
    }
  )
  if (group !== undefined) {
    out.push({
      id: "group",
      header: group,
      size: 200,
      meta: { priority: 2, card: "hide" },
      accessorFn: (row) => row.group ?? "",
    })
  }
  out.push(
    {
      id: "pieces",
      header: "Pcs",
      size: 130,
      meta: { align: "right", card: "hide" },
      accessorFn: (row) => row.pieces,
      cell: ({ row }) => {
        const one = row.original
        if (one.change !== undefined)
          return (
            <span className="tabular-nums">
              <span className="text-mute">{figure(one.change.from)}</span> →{" "}
              <span className="font-semibold text-ink">
                {figure(one.change.to)}
              </span>
            </span>
          )
        return (
          <span className="tabular-nums">
            <span className={cn(one.flag !== undefined && "text-bad-fg")}>
              {figure(one.pieces)}
            </span>
            {one.of !== undefined && ` / ${figure(one.of)}`}
          </span>
        )
      },
    },
    {
      id: "detail",
      header: "Detail",
      size: 180,
      meta: { priority: 2, card: "hide" },
      enableSorting: false,
      cell: ({ row }) => (
        <span className="flex flex-col">
          {row.original.detail}
          {row.original.mark !== undefined && (
            <span className={markTone(row.original.mark)}>
              {row.original.mark.text}
            </span>
          )}
          {row.original.tags?.map((tag) => (
            <TagText key={tag.label} tag={tag} />
          ))}
          {row.original.flag !== undefined && (
            <span className="text-bad-fg">{row.original.flag}</span>
          )}
        </span>
      ),
    },
    {
      id: "age",
      header: "Time",
      size: 130,
      meta: { priority: 3, card: "hide" },
      accessorFn: (row) => row.at ?? "",
      cell: ({ row }) => (
        <span className={cn(row.original.late && "text-warn-fg")}>
          {row.original.at ? ago(row.original.at) : ""}
        </span>
      ),
    }
  )
  // Three columns that exist only on a card (`cardLead`; a phone): the figure
  // it leads with — the pieces — the foot's left side — the lane it sits in,
  // and what it is made of and how long it has waited — and, at the foot's
  // right, the verb the card's press does (owner, 2026-10-06).
  out.push(
    {
      id: "lead",
      header: "",
      enableHiding: false,
      enableSorting: false,
      accessorFn: (row) => row.pieces,
      meta: { card: "lead" },
      cell: ({ row }) => {
        const one = row.original
        // An edited card leads with what is still wanted, and says what it was.
        const shown = one.change === undefined ? one.pieces : one.change.to
        return (
          <span className="flex flex-col items-end tabular-nums">
            <span
              className={cn(
                "text-[1.5rem] leading-tight font-semibold tracking-tight text-ink",
                one.flag !== undefined && "text-bad-fg",
                one.off === true && "text-mute"
              )}
            >
              {figure(shown)}
            </span>
            <span className="text-[0.9375rem] text-mute">
              {one.of !== undefined && one.change === undefined
                ? `of ${figure(one.of)} pcs`
                : "pcs"}
            </span>
          </span>
        )
      },
    },
    {
      id: "foot",
      header: "",
      enableHiding: false,
      enableSorting: false,
      accessorFn: (row) => row.stage.order,
      meta: { card: "foot" },
      cell: ({ row }) => {
        const one = row.original
        return (
          <span className="flex flex-col leading-6">
            {/* The lane is the heading the card stands under; said again in
            every foot it was the same word thirty times. */}
            {(one.detail !== undefined || one.at) && (
              <span className="flex flex-wrap gap-x-1.5">
                {one.detail}
                {one.at && (
                  <span className={cn(one.late && "text-warn-fg")}>
                    {ago(one.at)}
                  </span>
                )}
              </span>
            )}
            {one.flag !== undefined && (
              <span className="text-bad-fg">{one.flag}</span>
            )}
          </span>
        )
      },
    },
    {
      id: "act",
      header: "",
      enableHiding: false,
      enableSorting: false,
      accessorFn: (row) => row.act ?? "",
      meta: { card: "status" },
      cell: ({ row }) =>
        row.original.moveBack !== undefined ? (
          <CardButton
            label={row.original.act ?? "Put back"}
            onClick={row.original.moveBack}
          />
        ) : row.original.act === undefined ? null : (
          <span className={cn(button({ variant: "tint", size: "card" }))}>
            {row.original.act}
          </span>
        ),
    }
  )
  return stages ? out : out.filter((column) => column.id !== "stage")
}

/// The lanes in the order the goods move, then — inside one — the rows with a
/// button to press first, oldest first.
function byLane(rows: readonly StageRow[]): StageRow[] {
  return [...rows].sort(
    (left, right) =>
      left.stage.order - right.stage.order ||
      Number(right.act !== undefined) - Number(left.act !== undefined) ||
      (left.at ?? "").localeCompare(right.at ?? "")
  )
}

/// A lane as the heading of its section, on a phone: its colour, its name, how
/// many cards and how many pieces are in it. A tap folds it away.
function LaneHeading({
  stage,
  count,
  pieces,
  open,
  onToggle,
}: {
  stage: StageRow["stage"]
  count: number
  pieces: number
  open: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className="flex w-full items-center gap-2 px-1 py-2 text-left transition-opacity active:opacity-60"
    >
      <span className={cn("size-2 shrink-0 rounded-full", stage.tone)} />
      <span className="text-[1rem] font-semibold text-ink">{stage.label}</span>
      <span className="text-[0.9375rem] text-mute tabular-nums">
        {figure(count)}
      </span>
      <span className="flex-1" />
      <span className="text-[0.9375rem] text-mute tabular-nums">
        {`${figure(pieces)} pcs`}
      </span>
      <ChevronDown
        className={cn(
          "size-4 shrink-0 text-line-ico transition-[rotate] duration-200 ease-(--ease-out) motion-reduce:transition-none",
          !open && "-rotate-90"
        )}
      />
    </button>
  )
}

/// One row as a phone's card: the hub's `PhoneCard` — name over its code and
/// the figure at the right, a hairline, the foot — with what MD or the picker
/// said about it. A band across the top edge (inside the rounded corners), a
/// "was → now" row under the head, and for a cancelled card a stamp that sits
/// in a row of its own (so it can never cover the name or the button) under a
/// hatched layer that never takes a press. The one live thing on a card with a
/// Move back is its 44px button.
function StageCard({
  row,
  onPress,
}: {
  row: StageRow
  onPress: (row: StageRow) => void
}) {
  const off = row.off === true
  const shown = row.change === undefined ? row.pieces : row.change.to
  // MD's change on the very figure the card leads with: its "was" goes in
  // the caption ("was 220 · pcs"), not again in the body.
  const struck =
    row.change === undefined
      ? row.tags?.find((tag) => tag.was !== undefined && tag.now === shown)
      : undefined
  const bodyTags = row.tags?.filter((tag) => tag !== struck)
  // A carton MD took out has no tick: its reason is the line under it.
  const tick = row.pick !== undefined && row.pick.disabled !== true
  const caption =
    row.of !== undefined && row.change === undefined
      ? `of ${figure(row.of)} pcs`
      : "pcs"
  const captionShown =
    struck?.was === undefined ? (
      caption
    ) : (
      <>
        <s>{figure(struck.was)}</s> {caption}
      </>
    )
  return (
    <PhoneCard
      head={
        <CardName
          name={
            row.dot ? (
              <span className="inline-flex items-center gap-2">
                <Dot />
                {row.title}
              </span>
            ) : (
              row.title
            )
          }
          code={row.doc}
          muted={off}
        />
      }
      lead={
        <span className={cn(off && "opacity-50")}>
          <CardFigure
            value={figure(shown)}
            caption={captionShown}
            tone={row.flag !== undefined ? "bad" : off ? "quiet" : undefined}
          />
        </span>
      }
      body={
        row.change !== undefined ? (
          <span className="text-[0.9375rem] text-body tabular-nums">
            {figure(row.change.from)} →{" "}
            <span className="font-semibold text-ink">
              {figure(row.change.to)}
            </span>{" "}
            pcs{" "}
            <span className="font-medium text-bad-fg">
              {figure(row.change.to - row.change.from)}
            </span>
          </span>
        ) : off ? (
          <span className="flex h-16 items-center justify-center">
            <span className="rotate-[-7deg] rounded-[0.625rem] border-[3px] border-bad-fg px-3.5 text-[1.375rem] leading-8 font-bold tracking-[0.06em] whitespace-nowrap text-bad-fg">
              {row.stamp ?? "CANCELLED"}
            </span>
          </span>
        ) : bodyTags !== undefined && bodyTags.length > 0 ? (
          <span className="flex flex-col gap-3">
            <span className="flex flex-wrap gap-x-3 text-[0.9375rem] font-semibold tabular-nums">
              {bodyTags.map((tag) => (
                <TagText key={tag.label} tag={tag} />
              ))}
            </span>
            {/* The foot holds one button: Move back keeps it, so OK sits
            here instead. */}
            {row.ack !== undefined && row.moveBack !== undefined && (
              <Button
                variant="tint"
                size="lg"
                pending={row.ack.pending}
                onClick={() => row.ack?.onClick()}
              >
                {row.ack.label}
              </Button>
            )}
          </span>
        ) : undefined
      }
      foot={
        <span className="flex flex-col leading-6">
          {(row.detail !== undefined || row.at) && (
            <span className="flex flex-wrap gap-x-1.5">
              {row.detail}
              {row.at && (
                <span className={cn(row.late && "text-warn-fg")}>
                  {ago(row.at)}
                </span>
              )}
            </span>
          )}
          {row.flag !== undefined && (
            <span className="text-bad-fg">{row.flag}</span>
          )}
        </span>
      }
      action={
        row.moveBack === undefined && row.ack !== undefined ? (
          <Button
            variant="tint"
            size="lg"
            className="relative z-[2]"
            pending={row.ack.pending}
            onClick={(event) => {
              event.stopPropagation()
              row.ack?.onClick()
            }}
          >
            {row.ack.label}
          </Button>
        ) : row.moveBack !== undefined ? (
          <Button
            variant="tint"
            size="lg"
            className="relative z-[2]"
            onClick={(event) => {
              event.stopPropagation()
              row.moveBack?.()
            }}
          >
            {row.act ?? "Put back"}
          </Button>
        ) : tick && row.pick !== undefined ? (
          <span title={row.pick.title}>
            <Checkbox
              label={<span className="sr-only">{row.pick.label}</span>}
              checked={row.pick.checked}
              onChange={row.pick.onChange}
              className="[&>label]:size-11 [&>label]:justify-center"
            />
          </span>
        ) : row.act === undefined ? undefined : (
          <span className={cn(button({ variant: "tint", size: "card" }))}>
            {row.act}
          </span>
        )
      }
      alert={
        row.flag !== undefined ||
        row.mark?.tone === "bad" ||
        row.tags?.some((tag) => tag.tone === "bad") === true
      }
      onOpen={off ? undefined : () => onPress(row)}
      className={cn("overflow-hidden", off && "bg-soft")}
    >
      {row.mark?.strip !== undefined && (
        <span
          className={cn(
            "order-first flex h-7 shrink-0 items-center px-4 text-[0.9375rem] font-semibold text-white",
            row.mark.tone === "bad" ? "bg-bad-fg" : "bg-warn-fg"
          )}
        >
          {row.mark.strip}
        </span>
      )}
      {off && <span aria-hidden className={SWITCHED_OFF} />}
    </PhoneCard>
  )
}

/// The table version of a board: one row per card, in lane order.
const ACT_FIRST = { id: "act-first", desc: false } as const

export function StageTable({
  rows,
  first = "Store",
  group,
  empty,
  stages = true,
  refresh,
}: {
  rows: readonly StageRow[]
  /// Header of the first named column.
  first?: string
  /// Header of the extra grouping column, when the rows carry one.
  group?: string
  empty: string
  /// Whether the lane a row sits in is a column. A list that is only a list
  /// (Return to supplier) leaves it out.
  stages?: boolean
  /// The queries behind the rows, for the stamp over the table.
  refresh?: readonly Refreshable[]
}) {
  const go = useAppNavigate()
  const openHere = useOpenHere()
  const [sorting, setSorting] = useState<SortingState>([])
  const pickable = rows.some((row) => row.pick !== undefined)
  const phone = useLayout() === "phone"
  const columns = useMemo(
    () => [
      ...columnsFor(first, group, pickable, stages),
      // Never drawn, only sorted on: rows with a button lead whatever the
      // headings sort by (owner, 2026-10-05).
      {
        id: ACT_FIRST.id,
        accessorFn: (row: StageRow) => (row.act === undefined ? 1 : 0),
        header: "",
        enableHiding: false,
      } as ColumnDef<TableSetup, StageRow>,
    ],
    [first, group, pickable, stages]
  )
  /// Lanes that are folded away, on a phone, by id.
  const [folded, setFolded] = useState<ReadonlySet<string>>(() => new Set())
  // A phone reads the lanes as sections, in the order the goods move; the desk
  // keeps the rows with a button to press ahead of everything.
  const grouped = phone && stages
  const ordered = useMemo(
    () => (grouped ? byLane(rows) : byStage(rows)),
    [rows, grouped]
  )
  const lanes = useMemo(() => {
    const out = new Map<string, { count: number; pieces: number }>()
    for (const row of ordered) {
      const lane = out.get(row.stage.id) ?? { count: 0, pieces: 0 }
      out.set(row.stage.id, {
        count: lane.count + 1,
        pieces: lane.pieces + row.pieces,
      })
    }
    return out
  }, [ordered])

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: ordered,
        columns,
        getRowId: (row: StageRow) => row.key,
        state: {
          sorting: grouped ? [] : [ACT_FIRST, ...sorting],
          columnVisibility: {
            [ACT_FIRST.id]: false,
            lead: phone,
            foot: phone,
            act: phone,
          },
        },
        onSortingChange: (
          next: SortingState | ((prev: SortingState) => SortingState)
        ) =>
          setSorting((was) =>
            (typeof next === "function"
              ? next([ACT_FIRST, ...was])
              : next
            ).filter((one) => one.id !== ACT_FIRST.id)
          ),
      }),
      [ordered, columns, sorting, phone, grouped]
    )
  )

  if (ordered.length === 0) return <EmptyState>{empty}</EmptyState>

  /// What pressing a row does. A switched-off row (MD cancelled it) does
  /// nothing: only its Move back works.
  const press = (row: StageRow) => {
    if (row.off === true) return
    const here = openHere(row.open?.sheet)
    if (row.onOpen) row.onOpen()
    else if (here) here()
    else if (row.open) void go(row.open.to, row.open.sheet)
  }

  // A phone reads the lanes as sections of cards, each lane a heading that
  // folds. The cards are drawn here, not by the table, because a card can
  // carry a band across its top edge and a stamp.
  if (grouped) {
    return (
      <>
        {refresh !== undefined && refresh.length > 0 && (
          <RefreshStrip queries={refresh} />
        )}
        <ul className="flex flex-col gap-2.5">
          {ordered.map((row, index) => (
            <Fragment key={row.key}>
              {(index === 0 ||
                ordered[index - 1].stage.id !== row.stage.id) && (
                <li data-sub className={STICKY_HEADING}>
                  <LaneHeading
                    stage={row.stage}
                    count={lanes.get(row.stage.id)?.count ?? 0}
                    pieces={lanes.get(row.stage.id)?.pieces ?? 0}
                    open={!folded.has(row.stage.id)}
                    onToggle={() =>
                      setFolded((was) => {
                        const next = new Set(was)
                        if (next.has(row.stage.id)) next.delete(row.stage.id)
                        else next.add(row.stage.id)
                        return next
                      })
                    }
                  />
                </li>
              )}
              {!folded.has(row.stage.id) && (
                <StageCard row={row} onPress={press} />
              )}
            </Fragment>
          ))}
        </ul>
      </>
    )
  }

  return (
    <Card className="overflow-clip max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
      <DataTable<StageRow>
        refresh={refresh}
        table={table}
        touch
        pageScroll
        cardsApart
        cardLead
        cardSort
        cardTone={(row) =>
          row.flag !== undefined || row.mark?.tone === "bad"
            ? "alert"
            : undefined
        }
        className={ROOMY}
        onRowClick={press}
        rowAction={(row) => {
          const ack = row.ack
          const own =
            row.moveBack !== undefined ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={(event) => {
                  event.stopPropagation()
                  row.moveBack?.()
                }}
              >
                {row.act ?? "Put back"}
              </Button>
            ) : row.act === undefined ? null : (
              <span className={cn(button({ variant: "ghost", size: "sm" }))}>
                {row.act}
              </span>
            )
          if (ack === undefined) return own
          return (
            <span className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                pending={ack.pending}
                onClick={(event) => {
                  event.stopPropagation()
                  ack.onClick()
                }}
              >
                {ack.label}
              </Button>
              {own}
            </span>
          )
        }}
      />
    </Card>
  )
}
