import {
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQueries,
} from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { Plus } from "lucide-react"
import { Suspense, useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/field"
import { FilterChips } from "@/components/ui/filter-chips"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { PageHeader } from "@/components/ui/page-header"
import { Toolbar } from "@/components/ui/segmented"
import { SubTabs } from "@/components/ui/sub-tabs"
import { count, day, money } from "@/lib/format"
import { giroBoardQueries, periodsQuery } from "@/lib/queries/finance"
import { deliverGiro } from "@/lib/queries/giros"
import { cn } from "@/lib/utils"
import { todayIso } from "@/screens/finance/chart"
import {
  GiroActSheet,
  GiroListTable,
  GiroOpeningForm,
  GiroOpeningTable,
  GiroReplaceSheet,
  GiroSheet,
  type GiroBooks,
  type GiroMove,
} from "@/screens/finance/giro-list"
import {
  giroWord,
  isLate,
  isOpeningGiro,
  isOut,
  isThisWeek,
  laneOf,
  lateWord,
  sumOf,
  useGiroAccounts,
  type GiroFilter,
  type GiroLane,
  type GiroTab,
} from "@/screens/finance/giro-words"
import { useSupplierName } from "@/screens/finance/hooks"
import { ScreenPending } from "@/screens/finance/pending"

import type { GiroRow } from "@itulah/contract"

/// Giro: BG Keluar from writing to clearing — what is already promised out of
/// which bank, and when. Tabs Board · List · Opening giro, after
/// `scr-cash2.js` (Cash & Bank › Giro). BG Keluar only: the client is not paid
/// by giro, so there is no BG Masuk.

export function GiroBoard() {
  return (
    <Suspense
      fallback={
        <ScreenPending
          crumb="Finance · Cash & Bank"
          title="Giro"
          className="max-md:hidden"
        >
          Reading the giros…
        </ScreenPending>
      }
    >
      <GiroScreen />
    </Suspense>
  )
}

function GiroScreen() {
  const navigate = useNavigate()
  const reads = useSuspenseQueries({
    queries: giroBoardQueries(),
    combine: (results) => ({ rows: results.flatMap((result) => result.data) }),
  })
  const periods = useQuery(periodsQuery())

  const [tab, setTab] = useState<GiroTab>("board")
  const [filter, setFilter] = useState<GiroFilter>("all")
  const [search, setSearch] = useState("")
  const [open, setOpen] = useState<GiroRow | null>(null)
  const [move, setMove] = useState<{ kind: GiroMove; row: GiroRow } | null>(
    null
  )
  const [adding, setAdding] = useState(false)

  // Only what we wrote.
  const all = useMemo(
    () =>
      reads.rows.filter(
        (row) => row.direction === "OUT" && laneOf(row) !== null
      ),
    [reads.rows]
  )
  const accounts = useGiroAccounts(all)
  const books: GiroBooks = accounts

  const began = useMemo(() => {
    const first = (periods.data ?? [])
      .map((row) => row.year * 12 + (row.month - 1))
      .sort((a, b) => a - b)[0]
    if (first === undefined) return null
    return `${Math.floor(first / 12)}-${String((first % 12) + 1).padStart(2, "0")}-01`
  }, [periods.data])
  const monthClosed = useMemo(() => {
    const closed = new Set(
      (periods.data ?? [])
        .filter((row) => row.status.toUpperCase() !== "OPEN")
        .map((row) => `${row.year}-${String(row.month).padStart(2, "0")}`)
    )
    return (iso: string | null) => iso !== null && closed.has(iso.slice(0, 7))
  }, [periods.data])

  const out = all.filter(isOut)
  const week = all.filter(isThisWeek)
  const late = all.filter(isLate)
  const bounced = all.filter((row) => laneOf(row) === "bounced")
  const opening = all.filter((row) => isOpeningGiro(row, began))

  const supplierName = useSupplierName()
  const rows = useMemo(() => {
    const test: Record<GiroFilter, (row: GiroRow) => boolean> = {
      all: () => true,
      written: (row) => laneOf(row) === "written",
      with: (row) => laneOf(row) === "with",
      week: isThisWeek,
      late: isLate,
      cleared: (row) => laneOf(row) === "cleared",
      bounced: (row) => laneOf(row) === "bounced",
    }
    const needle = search.trim().toLowerCase()
    const rank = (row: GiroRow) =>
      isOut(row) ? 0 : laneOf(row) === "bounced" ? 1 : 2
    return all
      .filter(test[filter])
      .filter(
        (row) =>
          needle === "" ||
          row.number.toLowerCase().includes(needle) ||
          row.bank.toLowerCase().includes(needle) ||
          (row.cash_document_number ?? row.payment_number ?? "")
            .toLowerCase()
            .includes(needle) ||
          (row.party_name === null
            ? ""
            : supplierName(row.party_name, row.party_name)
          )
            .toLowerCase()
            .includes(needle)
      )
      .sort(
        (a, b) =>
          rank(a) - rank(b) ||
          (rank(a) === 0
            ? a.due_date.localeCompare(b.due_date)
            : b.due_date.localeCompare(a.due_date))
      )
  }, [all, filter, search, supplierName])

  const goList = (next: GiroFilter) => {
    setFilter(next)
    setTab("list")
  }
  const counted = (word: string, n: number) => (
    <>
      {word}
      <span className="ml-1.5 text-mute tabular-nums">{count(n)}</span>
    </>
  )
  const figure = (xs: readonly GiroRow[]) =>
    `${count(xs.length)} · ${money(sumOf(xs))}`

  const chip = (value: GiroFilter, label: string, xs: readonly GiroRow[]) => ({
    value,
    label,
    count: xs.length,
  })

  return (
    <PageContent>
      <PageHeader
        crumb="Finance · Cash & Bank"
        title="Giro"
        actions={
          tab === "opening" ? (
            <Button variant="primary" onClick={() => setAdding(true)}>
              <Plus />
              Add opening giro
            </Button>
          ) : (
            <Button
              variant="primary"
              onClick={() =>
                void navigate({ to: "/finance/cash-bank/bkk/new" } as never)
              }
            >
              <Plus />
              Write giro
            </Button>
          )
        }
      />

      <KpiStrip className="md:grid-cols-4 xl:grid-cols-4">
        <Kpi label="Will leave the bank" value={money(sumOf(out))} />
        <Kpi
          label="Due this week"
          value={figure(week)}
          onClick={() => goList("week")}
        />
        <Kpi
          label="Late"
          value={
            <span className={late.length > 0 ? "text-bad-fg" : undefined}>
              {figure(late)}
            </span>
          }
          onClick={() => goList("late")}
        />
        <Kpi
          label="Bounced"
          value={
            <span className={bounced.length > 0 ? "text-bad-fg" : undefined}>
              {figure(bounced)}
            </span>
          }
          onClick={() => goList("bounced")}
        />
      </KpiStrip>

      <Toolbar
        className="group/bar"
        lead={
          <SubTabs
            value={tab}
            onChange={(next) => setTab(next as GiroTab)}
            tabs={[
              {
                value: "board",
                label: counted("Board", out.length + bounced.length),
                short: "Board",
              },
              {
                value: "list",
                label: counted("List", all.length),
                short: "List",
              },
              {
                value: "opening",
                label: counted("Opening giro", opening.length),
                short: "Opening giro",
              },
            ]}
          />
        }
      >
        {tab === "list" && (
          <span className="inline-flex w-72 max-w-full shrink-0">
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="BG no, supplier or BKK"
              aria-label="Search giros"
            />
          </span>
        )}
      </Toolbar>

      {tab === "board" && (
        <Lanes
          rows={all}
          books={books}
          onOpen={setOpen}
          onMove={(kind, row) => setMove({ kind, row })}
        />
      )}

      {tab === "list" && (
        <>
          <FilterChips
            label="Giro"
            value={filter === "all" ? null : filter}
            onChange={(next) => setFilter((next ?? "all") as GiroFilter)}
            className="mb-3"
            options={[
              { value: null, label: "All", count: all.length },
              chip(
                "written",
                "Written",
                all.filter((r) => laneOf(r) === "written")
              ),
              chip(
                "with",
                "With supplier",
                all.filter((r) => laneOf(r) === "with")
              ),
              chip("week", "Due this week", week),
              chip("late", "Late", late),
              chip(
                "cleared",
                "Cleared",
                all.filter((r) => laneOf(r) === "cleared")
              ),
              chip("bounced", "Bounced", bounced),
            ]}
          />
          <GiroListTable rows={rows} books={books} onOpen={setOpen} />
        </>
      )}

      {tab === "opening" && (
        <GiroOpeningTable rows={opening} onOpen={setOpen} />
      )}

      <GiroSheet
        row={open}
        opening={open !== null && isOpeningGiro(open, began)}
        books={books}
        monthClosed={monthClosed}
        onClose={() => setOpen(null)}
        onMove={(kind, row) => {
          setOpen(null)
          setMove({ kind, row })
        }}
      />
      <GiroActSheet
        act={move !== null && move.kind !== "replace" ? move.kind : null}
        row={move?.row ?? null}
        onClose={() => setMove(null)}
      />
      <GiroReplaceSheet
        row={move?.kind === "replace" ? move.row : null}
        onClose={() => setMove(null)}
      />
      <GiroOpeningForm
        open={adding}
        banks={[...new Set(all.map((row) => row.bank))].sort()}
        onClose={() => setAdding(false)}
      />
    </PageContent>
  )
}

// ---------------------------------------------------------------------------
// The board: Written · With supplier · Cleared · Bounced
// ---------------------------------------------------------------------------

function Lanes({
  rows,
  books,
  onOpen,
  onMove,
}: {
  rows: readonly GiroRow[]
  books: GiroBooks
  onOpen: (row: GiroRow) => void
  onMove: (kind: GiroMove, row: GiroRow) => void
}) {
  const today = todayIso()
  const monthStart = `${today.slice(0, 7)}-01`
  const monthName = new Date(`${monthStart}T00:00:00`).toLocaleString("en", {
    month: "long",
  })
  const byDue = (a: GiroRow, b: GiroRow) => a.due_date.localeCompare(b.due_date)
  const lanes: readonly [GiroLane, string, GiroRow[]][] = [
    [
      "written",
      "Written",
      rows.filter((r) => laneOf(r) === "written").sort(byDue),
    ],
    [
      "with",
      "With supplier",
      rows.filter((r) => laneOf(r) === "with").sort(byDue),
    ],
    [
      "cleared",
      `Cleared · ${monthName}`,
      rows
        .filter(
          (r) => laneOf(r) === "cleared" && (r.cleared_on ?? "") >= monthStart
        )
        .sort((a, b) => (b.cleared_on ?? "").localeCompare(a.cleared_on ?? "")),
    ],
    ["bounced", "Bounced", rows.filter((r) => laneOf(r) === "bounced")],
  ]
  return (
    <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {lanes.map(([key, label, xs]) => (
        <div key={key} className="flex min-w-0 flex-col">
          <div className="border-b border-hairline pb-2">
            <div className="flex items-center gap-2">
              <span className="text-[0.9375rem] font-semibold text-ink">
                {label}
              </span>
              <span className="text-[0.9375rem] text-mute tabular-nums">
                {count(xs.length)}
              </span>
            </div>
            <div className="mt-0.5 text-[0.9375rem] text-body tabular-nums">
              {money(sumOf(xs))}
            </div>
          </div>
          <div className="mt-3 flex flex-col gap-3">
            {xs.length === 0 ? (
              <p className="py-2 text-[0.9375rem] text-mute">None</p>
            ) : (
              xs.map((row) => (
                <GiroCard
                  key={row.giro_id}
                  row={row}
                  books={books}
                  onOpen={onOpen}
                  onMove={onMove}
                />
              ))
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

function GiroCard({
  row,
  books,
  onOpen,
  onMove,
}: {
  row: GiroRow
  books: GiroBooks
  onOpen: (row: GiroRow) => void
  onMove: (kind: GiroMove, row: GiroRow) => void
}) {
  const client = useQueryClient()
  const supplierName = useSupplierName()
  const lane = laneOf(row)
  const balance = books.balanceOf(row)
  const give = useMutation({
    mutationFn: () => deliverGiro(row.giro_id),
    onSuccess: () =>
      client.invalidateQueries({ queryKey: ["finance", "giros"] }),
  })

  const when =
    lane === "cleared" ? (
      `Cleared ${row.cleared_on === null ? "—" : day(row.cleared_on)}`
    ) : lane === "bounced" ? (
      <span className="text-bad-fg">
        Bounced {row.rejected_on === null ? "—" : day(row.rejected_on)}
      </span>
    ) : isLate(row) ? (
      <>
        <span className="text-bad-fg">{lateWord(row.days_overdue)}</span> · due{" "}
        {day(row.due_date)}
      </>
    ) : (
      `Due ${day(row.due_date)}`
    )

  const act =
    lane === "written" ? (
      <Button
        variant="primary"
        size="sm"
        pending={give.isPending}
        onClick={(event) => {
          event.stopPropagation()
          give.mutate()
        }}
      >
        Given to supplier
      </Button>
    ) : lane === "with" ? (
      <Button
        variant="primary"
        size="sm"
        onClick={(event) => {
          event.stopPropagation()
          onMove("clear", row)
        }}
      >
        Mark cleared
      </Button>
    ) : lane === "bounced" && row.replaced_by === null ? (
      <Button
        variant="primary"
        size="sm"
        onClick={(event) => {
          event.stopPropagation()
          onMove("replace", row)
        }}
      >
        Replace
      </Button>
    ) : null

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(row)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault()
          onOpen(row)
        }
      }}
      className="flex cursor-pointer flex-col gap-1 rounded-card border border-hairline bg-canvas px-4 py-3.5 shadow-soft transition-transform duration-(--t-press) ease-(--ease-out) active:scale-[0.99]"
    >
      <span className="truncate text-[1rem] font-medium text-ink">
        {row.party_name === null ? (
          <span className="text-faint">No party</span>
        ) : (
          supplierName(row.party_name, row.party_name)
        )}
      </span>
      <span className="mt-1 text-[1.125rem] font-semibold text-ink tabular-nums">
        {money(row.amount_minor)}
      </span>
      <span className="text-[0.9375rem] text-mute">
        BG {row.number} · {row.bank}
      </span>
      <span className="text-[0.9375rem] text-mute">{when}</span>
      {balance !== null && (
        <>
          <span className="text-[0.9375rem] text-mute">
            Balance on due date
          </span>
          <span
            className={cn(
              "text-[0.9375rem] text-ink tabular-nums",
              balance < 0 && "text-bad-fg"
            )}
          >
            {money(balance)}
          </span>
        </>
      )}
      {lane === "bounced" && row.replaced_by !== null && (
        <span className="text-[0.9375rem] text-ok-fg">
          Replaced by {row.replacement_number ?? row.replaced_by}
        </span>
      )}
      {give.isError && (
        <span className="text-[0.9375rem] text-bad-fg">
          It could not be marked as given
        </span>
      )}
      {act !== null && <div className="mt-2">{act}</div>}
      <span className="sr-only">{giroWord(row)[0]}</span>
    </div>
  )
}
