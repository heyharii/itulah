import { useSuspenseQueries } from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { Check, Search } from "lucide-react"
import { Suspense, useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { DockTools } from "@/components/shell/dock-tools"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Input } from "@/components/ui/field"
import { FilterChips } from "@/components/ui/filter-chips"
import { SHEET_ROW } from "@/components/ui/list-chrome"
import { PageHeader } from "@/components/ui/page-header"
import { CardName, PhoneCard } from "@/components/ui/phone-cards"
import { BottomSheet } from "@/components/ui/picker-sheet"
import { RefreshStrip } from "@/components/ui/refresh-stamp"
import { EmptyState, LoadingState } from "@/components/ui/states"
import { SubTabs } from "@/components/ui/sub-tabs"
import { useColourwayFill } from "@/lib/colourway-fill"
import { count, day, money } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import { useCatalogueIdentity } from "@/lib/operations/catalogue"
import {
  unmatchedQuery,
  type UnmatchedKind,
  type UnmatchedSale,
  type UnmatchedStatus,
} from "@/lib/queries/unmatched"
import { useSheet } from "@/lib/sheets"
import { tableSetup, type TableSetup } from "@/lib/table"
import { cn } from "@/lib/utils"
import { ROOMY } from "@/screens/operations/roomy"
import { UnmatchedSheet } from "@/screens/sales/unmatched-sheet"
import {
  ALL_ICON,
  KIND_ICON,
  KIND_WORD,
  KINDS,
  TABS,
  countDoc,
  haystack,
  nameOf,
  ordered,
  overdue,
  variantLine,
} from "@/screens/sales/unmatched-model"
import { ArticleThumb } from "@/screens/sales/unmatched-parts"

/// Sales › Unmatched sales: the lines a till sold that it could not take from
/// its own store's stock (`unmatched-sales-prototype.html`, owner 23 Oct 2026).
///
/// The sale always belongs to the store where the shopper paid; head office
/// pairs it later with a piece held at a store or at HO, and that piece leaves
/// that place's stock. So the page is a to-do list and its record: **To match**
/// is the work, **Matched** and **Found** are what became of it.
///
/// No figures over the list (owner: "ga usah ada kpi"). The head, the tabs, the
/// kind chips, one search box and the table, in that order.

export function UnmatchedSales() {
  return (
    <PageContent>
      <PageHeader title="Unmatched sales" />
      <Suspense
        fallback={<LoadingState>Loading unmatched sales…</LoadingState>}
      >
        <UnmatchedBody />
      </Suspense>
    </PageContent>
  )
}

type Row = UnmatchedSale

interface Drawing {
  readonly identities: ReturnType<typeof useCatalogueIdentity>
  readonly fill: ReturnType<typeof useColourwayFill>
}

/// The article cell: its picture, its name, and in grey its colour, size and
/// SKU (or "No SKU" while nobody has said which article it was).
function ArticleCell({ row, draw }: { row: Row; draw: Drawing }) {
  return (
    <span className="flex min-w-0 items-center gap-3">
      <ArticleThumb
        skuCode={row.sku_code}
        name={nameOf(row)}
        colour={row.colour}
        identities={draw.identities}
        fill={draw.fill}
      />
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-ink">{nameOf(row)}</span>
        <span className="truncate text-mute">{variantLine(row)}</span>
      </span>
    </span>
  )
}

const plain = (text: string) => <span className="block truncate">{text}</span>

type Column = ColumnDef<TableSetup, Row>

/// One column. Nothing sorts: the order is the tab's own (the oldest sale
/// first on To match, the latest decision first after).
function column(
  id: string,
  header: string,
  size: number,
  cell: (row: Row) => React.ReactNode,
  meta: { align?: "right"; grow?: number } = {}
): Column {
  return {
    id,
    accessorFn: (row) => row.id,
    header,
    size,
    enableSorting: false,
    meta,
    cell: ({ row }) => cell(row.original),
  }
}

/// Sold goes red on To match once a sale has waited longer than 30 days.
const sold = (row: Row) => (
  <span className={cn("tabular-nums", overdue(row) && "text-bad-fg")}>
    {day(row.sold_at)}
  </span>
)

function columnsFor(tab: UnmatchedStatus, draw: Drawing): Column[] {
  const first = [
    column("sold", "Sold", 112, sold),
    column("store", "Store", 130, (row) => plain(row.site_name)),
    column(
      "article",
      "Article",
      200,
      (row) => <ArticleCell row={row} draw={draw} />,
      { grow: 200 }
    ),
  ]
  if (tab === "open")
    return [
      ...first,
      column("kind", "Kind", 136, (row) => plain(KIND_WORD[row.kind])),
      column(
        "price",
        "Price",
        120,
        (row) => <span className="tabular-nums">{money(row.price_minor)}</span>,
        { align: "right" }
      ),
    ]
  if (tab === "matched")
    return [
      ...first,
      column("kind", "Kind", 136, (row) => plain(KIND_WORD[row.kind])),
      column("with", "Matched with", 214, (row) =>
        plain(row.matched_with ?? "—")
      ),
      column("on", "Matched on", 112, (row) => (
        <span className="tabular-nums">{day(row.matched_at)}</span>
      )),
    ]
  return [
    ...first,
    column("count", "Count", 120, (row) => plain(countDoc(row))),
    column("on", "Found on", 112, (row) => (
      <span className="tabular-nums">{day(row.matched_at)}</span>
    )),
    column(
      "cost",
      "Cost",
      120,
      (row) => (
        <span className="tabular-nums">
          {row.cost_minor == null ? "—" : money(row.cost_minor)}
        </span>
      ),
      { align: "right" }
    ),
  ]
}

function UnmatchedBody() {
  // Every tab's rows are read, not only the one on screen: the tabs carry
  // their counts and the sheet finds its record in whichever list holds it.
  const [open, matched, found] = useSuspenseQueries({
    queries: [
      unmatchedQuery("open"),
      unmatchedQuery("matched"),
      unmatchedQuery("found"),
    ],
  })
  const lists = useMemo(
    () => ({ open: open.data, matched: matched.data, found: found.data }),
    [open.data, matched.data, found.data]
  )

  const sheet = useSheet("unmatched")
  const phone = useLayout() === "phone"
  const identities = useCatalogueIdentity()
  const fill = useColourwayFill()

  const [tab, setTab] = useState<UnmatchedStatus>("open")
  const [kind, setKind] = useState<UnmatchedKind | null>(null)
  const [typed, setTyped] = useState("")
  const [kindSheet, setKindSheet] = useState(false)

  const inTab = lists[tab]
  const needle = typed.trim().toLowerCase()
  const rows = useMemo(
    () =>
      ordered(
        inTab.filter(
          (row) =>
            (kind === null || row.kind === kind) &&
            (needle === "" || haystack(row).includes(needle))
        ),
        tab
      ),
    [inTab, kind, needle, tab]
  )
  const countOf = (which: UnmatchedKind | null) =>
    which === null
      ? inTab.length
      : inTab.filter((row) => row.kind === which).length

  const chooseTab = (next: string) => {
    setTab(next as UnmatchedStatus)
    setKind(null)
  }

  const draw = useMemo<Drawing>(
    () => ({ identities, fill }),
    [identities, fill]
  )
  const columns = useMemo(() => columnsFor(tab, draw), [tab, draw])
  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns,
        getRowId: (row: Row) => row.id,
      }),
      [rows, columns]
    )
  )

  const everything = useMemo(
    () => [...lists.open, ...lists.matched, ...lists.found],
    [lists]
  )
  const record = everything.find((row) => row.id === sheet.value) ?? null

  const kinds = [
    { value: null, label: "All", icon: ALL_ICON },
    ...KINDS.map((one) => ({
      value: one,
      label: KIND_WORD[one],
      icon: KIND_ICON[one],
    })),
  ]
  const search = "Search article, SKU, receipt or store"

  return (
    <>
      {/* On a phone the tabs are the dock's status, the chips its filter and the
          search its field; none of them is drawn at the top of the list. */}
      <DockTools
        search={{ value: typed, onChange: setTyped, label: "Search" }}
        status={{
          value: tab,
          options: TABS.map((one) => ({
            value: one.value,
            label: one.label,
            count: lists[one.value].length,
          })),
          onChange: chooseTab,
        }}
        filter={{
          count: kind === null ? 0 : 1,
          onOpen: () => setKindSheet(true),
        }}
      />
      {phone && (
        <BottomSheet open={kindSheet} onOpenChange={setKindSheet} title="Kind">
          <div className="min-h-0 overflow-y-auto overscroll-contain px-2 pb-3">
            {kinds.map((one) => {
              const on = one.value === kind
              const Glyph = one.icon
              return (
                <button
                  key={one.value ?? "all"}
                  type="button"
                  aria-pressed={on}
                  onClick={() => {
                    setKind(one.value)
                    setKindSheet(false)
                  }}
                  className={cn(SHEET_ROW, on && "font-medium text-accent")}
                >
                  <Glyph
                    aria-hidden
                    className={cn(
                      "size-5 shrink-0 stroke-[1.7]",
                      on ? "text-accent" : "text-line-ico"
                    )}
                  />
                  <span className="flex-1">{one.label}</span>
                  <span className="text-body tabular-nums">
                    {count(countOf(one.value))}
                  </span>
                  <Check
                    className={cn("size-4 shrink-0", on ? "" : "opacity-0")}
                  />
                </button>
              )
            })}
          </div>
        </BottomSheet>
      )}

      <SubTabs
        className="max-md:hidden"
        value={tab}
        onChange={chooseTab}
        tabs={TABS.map((one) => ({
          value: one.value,
          label: (
            <span>
              {one.label}
              <span className="ml-1.5 text-body tabular-nums">
                {count(lists[one.value].length)}
              </span>
            </span>
          ),
        }))}
      />
      <FilterChips
        className="mb-3.5 max-md:hidden"
        label="Kind"
        value={kind}
        onChange={(next) => setKind(next as UnmatchedKind | null)}
        options={kinds.map((one) => ({
          ...one,
          count: countOf(one.value),
        }))}
      />
      <div className="relative mb-3.5 w-[21.25rem] max-w-full max-md:hidden">
        <Search
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-mute"
        />
        <Input
          type="search"
          aria-label={search}
          placeholder={search}
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          className="pl-9"
        />
      </div>

      <Card className="overflow-clip max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
        <RefreshStrip queries={[open, matched, found]} />
        {rows.length === 0 ? (
          <EmptyState>
            {tab === "open" && needle === "" && kind === null
              ? "Everything is matched"
              : "Nothing here"}
          </EmptyState>
        ) : phone ? (
          <ul className="flex flex-col gap-2.5">
            {rows.map((row) => (
              <PhoneCard
                key={row.id}
                selected={row.id === sheet.value}
                onOpen={() => sheet.open(row.id)}
                head={
                  <span className="flex min-w-0 items-center gap-3">
                    <ArticleThumb
                      skuCode={row.sku_code}
                      name={nameOf(row)}
                      colour={row.colour}
                      identities={identities}
                      fill={fill}
                    />
                    <CardName
                      name={nameOf(row)}
                      line={[
                        variantLine(row),
                        [
                          row.site_name,
                          day(row.sold_at),
                          KIND_WORD[row.kind],
                        ].join(" · "),
                        tab === "open"
                          ? money(row.price_minor)
                          : tab === "matched"
                            ? `${row.matched_with ?? "—"} · ${day(row.matched_at)}`
                            : `${countDoc(row)} · ${day(row.matched_at)}`,
                      ]}
                    />
                  </span>
                }
              />
            ))}
          </ul>
        ) : (
          <DataTable<Row>
            table={table}
            onRowClick={(row) => sheet.open(row.id)}
            isSelected={(row) => row.id === sheet.value}
            cardSort={false}
            cardsApart
            className={ROOMY}
            pageScroll
          />
        )}
      </Card>

      <UnmatchedSheet row={record} onClose={sheet.close} />
    </>
  )
}
