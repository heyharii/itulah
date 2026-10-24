import { ChevronRight, Search } from "lucide-react"
import { useDeferredValue, useState } from "react"

import { DockChoice, DockTools } from "@/components/shell/dock-tools"
import { Card } from "@/components/ui/card"
import { CardList } from "@/components/ui/card-list"
import { Input } from "@/components/ui/field"
import { FilterChips, type ChipOption } from "@/components/ui/filter-chips"
import { SheetChoiceRows } from "@/components/ui/list-chrome"
import { ListTable, type ListColumn } from "@/components/ui/list-table"
import { PeopleTabs } from "@/components/ui/people-tabs"
import { BottomSheet } from "@/components/ui/picker-sheet"
import { EmptyState } from "@/components/ui/states"
import { count, day } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import {
  useUnmatched,
  type UnmatchedKind,
  type UnmatchedSale,
  type UnmatchedStatus,
} from "@/lib/queries/unmatched"
import { queryState } from "@/lib/query-state"
import { cn } from "@/lib/utils"
import { MoneyScreen } from "@/screens/money/parts"
import {
  ALL_KINDS,
  KINDS,
  STATUSES,
  countDocOf,
  haystackOf,
  kindWord,
  matchedWithOf,
  overdue,
  sorted,
} from "@/screens/money/unmatched-model"
import { ArticleCell, UnmatchedCard } from "@/screens/money/unmatched-parts"
import { UnmatchedSheet } from "@/screens/money/unmatched-sheet"
import { useOpenRecord } from "@/screens/stock/open-record"
import { money } from "@itulah/contract/money"

/// Money › Unmatched sales (owner, 23 Oct 2026; `unmatched-sales-prototype.html`
/// `?app=store`): the sales this shop made of a piece its own stock could not
/// account for — a tag the shop does not hold, a SKU typed off the label, an
/// item nobody could name. The shopper paid and the sale is this shop's; head
/// office matches it later to a piece somewhere, and this shop only reads where
/// each one stands.
///
///  - **To match** — still waiting, the oldest first. A sale more than 30 days
///    old is dated in red.
///  - **Matched** — head office has taken the piece from somewhere.
///  - **Found** — the piece turned up at a count.
///
/// Read-only, so no button anywhere: a row opens its facts in a sheet. Nothing
/// sits over a phone's list but the dock — the tab is its status chip, the kind
/// a sheet behind its ⚙ (`DockTools`), and the chips a desk shows are that
/// sheet's rows.
export function UnmatchedSales() {
  const phone = useLayout() === "phone"
  const lists = {
    open: useUnmatched("open"),
    matched: useUnmatched("matched"),
    found: useUnmatched("found"),
  } as const
  const [tab, setTab] = useState<UnmatchedStatus>("open")
  const [kind, setKind] = useState<UnmatchedKind | null>(null)
  const [typed, setTyped] = useState("")
  const [kindSheet, setKindSheet] = useState(false)
  const needle = useDeferredValue(typed).trim().toLowerCase()
  const record = useOpenRecord("unmatched")

  const current = lists[tab]
  const inTab = current.data
  const sizeOf = (status: UnmatchedStatus) => lists[status].data?.length
  const kindSize = (one: UnmatchedKind | null) =>
    inTab === undefined
      ? undefined
      : one === null
        ? inTab.length
        : inTab.filter((row) => row.kind === one).length

  const shown = sorted(
    (inTab ?? []).filter(
      (row) =>
        (kind === null || row.kind === kind) &&
        (needle === "" || haystackOf(row).includes(needle)),
    ),
    tab,
  )
  const opened =
    record.value === undefined
      ? undefined
      : [
          ...(lists.open.data ?? []),
          ...(lists.matched.data ?? []),
          ...(lists.found.data ?? []),
        ].find((row) => row.id === record.value)

  const choose = (next: UnmatchedStatus) => {
    setTab(next)
    setKind(null)
  }
  const chips: ChipOption[] = [
    {
      value: null,
      label: ALL_KINDS.label,
      icon: ALL_KINDS.icon,
      count: kindSize(null),
    },
    ...KINDS.map((one) => ({
      value: one.value as string,
      label: one.label,
      icon: one.icon,
      count: kindSize(one.value),
    })),
  ]

  return (
    <MoneyScreen>
      <DockTools
        search={{ value: typed, onChange: setTyped, label: "Search" }}
        filter={{
          count: kind === null ? 0 : 1,
          onOpen: () => setKindSheet(true),
          label: "Kind",
        }}
      />

      {phone ? (
        <DockChoice
          title="Status"
          value={tab}
          onChange={(next) => choose(next as UnmatchedStatus)}
          options={STATUSES.map((one) => {
            const size = sizeOf(one.value)
            return {
              value: one.value,
              short:
                size === undefined
                  ? one.label
                  : `${one.label} · ${count(size)}`,
              label: (
                <span className="flex items-baseline gap-2">
                  <span className="min-w-0 flex-1 truncate">{one.label}</span>
                  {size !== undefined && (
                    <span className="text-body tabular-nums">
                      {count(size)}
                    </span>
                  )}
                </span>
              ),
            }
          })}
        />
      ) : (
        <>
          <PeopleTabs<UnmatchedStatus>
            value={tab}
            onChange={choose}
            plainCount
            zeros
            tabs={STATUSES.map((one) => ({
              value: one.value,
              label: one.label,
              count: sizeOf(one.value),
            }))}
          />
          <FilterChips
            label="Kind"
            value={kind}
            options={chips}
            onChange={(next) => setKind(next as UnmatchedKind | null)}
            className="mb-3.5"
          />
          <div className="relative mb-3 w-85 max-w-full">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-line-ico" />
            <Input
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              placeholder="Search article, SKU or receipt"
              aria-label="Search"
              className="h-9 pl-9"
            />
          </div>
        </>
      )}

      {queryState(current, {
        loading: "Reading the unmatched sales…",
        render: () =>
          shown.length === 0 ? (
            <Card>
              <EmptyState art={null}>
                {tab === "open" && needle === "" && kind === null
                  ? "Everything is matched"
                  : "Nothing here"}
              </EmptyState>
            </Card>
          ) : phone ? (
            <CardList>
              {shown.map((row) => (
                <UnmatchedCard
                  key={row.id}
                  row={row}
                  status={tab}
                  onOpen={() => record.open(row.id)}
                />
              ))}
            </CardList>
          ) : (
            <Card>
              <ListTable
                rows={shown}
                columns={columnsOf(tab)}
                rowKey={(row) => row.id}
                onOpen={(row) => record.open(row.id)}
                roomy
                // Widths as declared, a long name cut with an ellipsis rather
                // than widening the table — and a floor under it, so a narrow
                // tablet scrolls the card sideways instead of squeezing the
                // article away.
                className="[&_table]:min-w-[62rem] [&_table]:table-fixed"
                empty=""
              />
            </Card>
          ),
      })}

      <UnmatchedSheet row={opened} onClose={record.close} />

      {phone && (
        <BottomSheet open={kindSheet} onOpenChange={setKindSheet} title="Kind">
          <div className="min-h-0 overflow-y-auto overscroll-contain px-2 pb-3">
            <SheetChoiceRows
              options={chips.map((one) => {
                const Glyph = one.icon
                return {
                  value: one.value ?? "",
                  label: (
                    <span className="flex items-center gap-3">
                      {Glyph !== undefined && (
                        <Glyph
                          aria-hidden
                          className="size-5 shrink-0 text-line-ico"
                        />
                      )}
                      {one.label}
                    </span>
                  ),
                  trailing:
                    one.count === undefined ? undefined : count(one.count),
                }
              })}
              value={kind ?? ""}
              onPick={(next) => {
                setKind(next === "" ? null : (next as UnmatchedKind))
                setKindSheet(false)
              }}
            />
          </div>
        </BottomSheet>
      )}
    </MoneyScreen>
  )
}

// ── The table ───────────────────────────────────────────────────────────────

type Column = ListColumn<UnmatchedSale>

/// The sale's day; a sale still waiting after 30 days is dated in red.
function soldColumn(tab: UnmatchedStatus): Column {
  return {
    id: "sold",
    header: "Sold",
    className: `${CLIP} w-[8.125rem]`,
    cell: (row) => (
      <span
        className={cn(
          "tabular-nums",
          tab === "open" && overdue(row.sold_at) && "text-bad-fg",
        )}
      >
        {day(row.sold_at)}
      </span>
    ),
  }
}

/// What a cell does with more than its column holds: an ellipsis.
const CLIP = "overflow-hidden text-ellipsis"

/// The article takes what the other columns leave.
const ARTICLE: Column = {
  id: "article",
  header: "Article",
  card: "title",
  // 14px above and below the 40px tile, as the prototype's rows are: the
  // table's roomy 16 would make every row 4px taller.
  className: `${CLIP} [td&]:py-3.5`,
  cell: (row) => <ArticleCell row={row} />,
}

const kindColumn = (width: string): Column => ({
  id: "kind",
  header: "Kind",
  className: `${CLIP} ${width}`,
  cell: (row) => kindWord(row.kind),
})

/// The arrow at the row's end that says it opens.
const GO: Column = {
  id: "go",
  header: "",
  align: "right",
  className: "w-10 pl-0",
  cell: () => (
    <ChevronRight aria-hidden className="inline size-4 text-line-ico" />
  ),
}

function columnsOf(tab: UnmatchedStatus): readonly Column[] {
  if (tab === "open")
    return [
      soldColumn(tab),
      ARTICLE,
      kindColumn("w-[9.375rem]"),
      {
        id: "receipt",
        header: "Receipt",
        className: `${CLIP} w-[14.375rem]`,
        cell: (row) => <span className="tabular-nums">{row.receipt_no}</span>,
      },
      {
        id: "cashier",
        header: "Cashier",
        className: `${CLIP} w-[12.5rem]`,
        cell: (row) => row.cashier_name ?? "—",
      },
      GO,
    ]
  if (tab === "matched")
    return [
      soldColumn(tab),
      ARTICLE,
      kindColumn("w-[8.75rem]"),
      {
        id: "with",
        header: "Matched with",
        className: `${CLIP} w-[15rem]`,
        cell: (row) => matchedWithOf(row),
      },
      {
        id: "on",
        header: "Matched on",
        className: `${CLIP} w-[8.125rem]`,
        cell: (row) => (row.matched_at === null ? "—" : day(row.matched_at)),
      },
      GO,
    ]
  return [
    soldColumn(tab),
    ARTICLE,
    {
      id: "count",
      header: "Count",
      className: `${CLIP} w-[7.5rem]`,
      cell: (row) => countDocOf(row),
    },
    {
      id: "on",
      header: "Found on",
      className: `${CLIP} w-[8.125rem]`,
      cell: (row) => (row.matched_at === null ? "—" : day(row.matched_at)),
    },
    {
      id: "cost",
      header: "Cost",
      align: "right",
      className: `${CLIP} w-[7.5rem]`,
      cell: (row) => (
        <span className="tabular-nums">
          {row.cost_minor === undefined || row.cost_minor === null
            ? "—"
            : money(row.cost_minor)}
        </span>
      ),
    },
    GO,
  ]
}
