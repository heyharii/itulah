import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Plus, Search, X } from "lucide-react"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { DockTools } from "@/components/shell/dock-tools"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable, dockSortOf } from "@/components/ui/data-table"
import { Input, Select } from "@/components/ui/field"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { PageHeader } from "@/components/ui/page-header"
import { SubTabs } from "@/components/ui/sub-tabs"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { EmptyState, Problem } from "@/components/ui/states"
import { Thumbnail } from "@/components/ui/thumbnail"
import { cn } from "@/lib/utils"
import { ago, count, dayMonth, quantity, recentMoment, countPcs } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import { tableSetup, type TableSetup } from "@/lib/table"
import { useNameOfLogin } from "@/lib/queries/hr-employees"
import { colourKeys, listColours } from "@/lib/queries/colours"
import { catalogueVocabulary, procurementKeys } from "@/lib/queries/procurement"
import {
  countQuantityCheck,
  listQuantityChecks,
  quantityCheckKeys,
  type QuantityCheck,
  type QuantityCheckCell,
  type QuantityCheckRow,
} from "@/lib/queries/quantity-checks"
import { queryState } from "@/lib/query-state"
import { useIntakeSearch } from "@/screens/operations/intake/header"
import { COUNT_HEAD, COUNT_ROW } from "@/screens/operations/intake/receiving"
import { ROOMY } from "@/screens/operations/roomy"
import { TwoLines } from "@/screens/operations/two-lines"
import { titled } from "@/screens/procurement/po-print"
import { STAMP, termLabel } from "@/screens/procurement/shared"
import { VariantPhoto, variantLabel } from "@/screens/procurement/variant-photo"
import {
  SupplierName,
  useSupplierName,
} from "@/screens/procurement/supplier-name"

/// **Quantity Checks** — counts head office asked the warehouse for.
///
/// From New articles, while a delivery is being named: how many of each colour
/// and size actually came. The answer is a flat list — a colour, a size, a
/// quantity — and the name is not the warehouse's to change. It is a reference
/// for whoever is naming the article; nothing waits for it and nothing is
/// compared with the delivery's own count.
type Stage = "REQUESTED" | "COUNTED"

/// What a counted check came to, in pieces.
const piecesOf = (one: QuantityCheck) =>
  one.lines.reduce((sum, line) => sum + line.quantity, 0)

/// The search over the table, as Receiving PO sets it.
const SEARCH_LABEL = "Search articles, orders or suppliers"

export function QuantityChecks() {
  const [opened, setOpened] = useState<string | null>(null)
  /// Where a check stands (owner, 16 Oct 2026): asked of the warehouse, or
  /// counted by it. Those are the two statuses the node keeps.
  const [tab, setTab] = useState<Stage>("REQUESTED")
  const search = useIntakeSearch()
  const nameOf = useSupplierName()
  const [sorting, setSorting] = useState<SortingState>([
    { id: "asked", desc: true },
  ])
  const open = useQuery({
    queryKey: quantityCheckKeys.book(),
    queryFn: ({ signal }) => listQuantityChecks(signal),
    refetchInterval: 15_000,
  })
  const all = useMemo(() => open.data ?? [], [open.data])
  const asked = all.filter((one) => one.status === "REQUESTED")
  const counted = all.filter((one) => one.status === "COUNTED")
  const countedPieces = counted.reduce((sum, one) => sum + piecesOf(one), 0)
  const rows = useMemo(
    () =>
      all.filter(
        (one) =>
          one.status === tab &&
          (search.needle === "" ||
            one.article_name.toLowerCase().includes(search.needle) ||
            one.po_number.toLowerCase().includes(search.needle) ||
            nameOf(one.supplier_id, one.supplier_name)
              .toLowerCase()
              .includes(search.needle))
      ),
    [all, tab, search.needle, nameOf]
  )
  // One still asked for opens to be answered; one counted opens to be read.
  const chosen = all.find((one) => one.check_id === opened) ?? null

  const columns = useMemo<ColumnDef<TableSetup, QuantityCheck>[]>(
    () => [
      {
        // The article as head office named it, its photo, and the order it
        // came on under it.
        id: "article",
        accessorFn: (row: QuantityCheck) => row.article_name,
        header: "Article",
        size: 280,
        meta: { card: "title", grow: 280 },
        cell: ({ row }) => (
          <span className="flex min-w-0 items-center gap-3 py-1">
            <Thumbnail
              url={row.original.image_url}
              name={row.original.article_name}
              className="size-11 shrink-0 rounded-inner border border-hairline"
            />
            <span className="flex min-w-0 flex-col gap-0.5 leading-5">
              <span className="block truncate font-medium text-ink max-md:font-semibold">
                {row.original.article_name}
              </span>
              <span className="font-mono text-id text-mute">
                {row.original.po_number}
              </span>
            </span>
          </span>
        ),
      },
      {
        id: "supplier",
        accessorFn: (row: QuantityCheck) =>
          row.supplier_name ?? row.supplier_id,
        header: "Supplier",
        size: 210,
        meta: { card: "hide" },
        cell: ({ row }) => (
          <span className="block truncate">
            <SupplierName
              code={row.original.supplier_id}
              name={row.original.supplier_name}
            />
          </span>
        ),
      },
      {
        // Who asked, and when: the newest ask leads.
        id: "asked",
        accessorFn: (row: QuantityCheck) => row.requested_at,
        header: "Asked",
        size: 160,
        meta: { card: "hide" },
        cell: ({ row }) => <AskedCell check={row.original} />,
      },
      {
        id: "received",
        accessorFn: (row: QuantityCheck) => row.receipt_quantity,
        header: "Received",
        size: 100,
        meta: { align: "right", card: "hide" },
        cell: ({ row }) => `${countPcs(row.original.receipt_quantity)}`,
      },
      // Two columns that exist only on a card (a phone), as Receiving PO's:
      // the figure it leads with, and the foot's left side.
      {
        id: "lead",
        accessorFn: (row: QuantityCheck) => row.receipt_quantity,
        header: "",
        enableHiding: false,
        enableSorting: false,
        meta: { card: "lead" },
        cell: ({ row }) => (
          <span className="flex flex-col items-end tabular-nums">
            <span className="text-[1.5rem] leading-tight font-semibold tracking-tight text-ink">
              {count(row.original.receipt_quantity)}
            </span>
            <span className="text-[0.9375rem] text-mute">pcs received</span>
          </span>
        ),
      },
      {
        id: "foot",
        accessorFn: (row: QuantityCheck) => row.requested_at,
        header: "",
        enableHiding: false,
        enableSorting: false,
        meta: { card: "foot" },
        cell: ({ row }) => <AskedCell check={row.original} card />,
      },
      {
        // One column for the count: what was counted, who and when, once it is
        // counted; the Count button while it is not.
        id: "count",
        accessorFn: (row: QuantityCheck) =>
          row.status === "COUNTED" ? piecesOf(row) : -1,
        header: "Count",
        size: 230,
        meta: { align: "right", card: "status" },
        cell: function Status({ row }) {
          const check = row.original
          const card = useLayout() === "phone"
          if (check.status === "COUNTED")
            return card ? (
              <span className={cn(STAMP, "text-ok-fg")}>
                Counted
                {check.counted_at !== null && (
                  <span className="block tabular-nums">
                    {dayMonth(check.counted_at)}
                  </span>
                )}
              </span>
            ) : (
              <CountedCell check={check} />
            )
          return (
            <Button
              variant="primary"
              size="card"
              onClick={(event) => {
                event.stopPropagation()
                setOpened(check.check_id)
              }}
            >
              Count
            </Button>
          )
        },
      },
    ],
    []
  )

  const phone = useLayout() === "phone"
  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns,
        getRowId: (row: QuantityCheck) => row.check_id,
        state: {
          sorting,
          columnVisibility: { lead: phone, foot: phone },
        },
        onSortingChange: (
          next: SortingState | ((prev: SortingState) => SortingState)
        ) =>
          setSorting((was) => (typeof next === "function" ? next(was) : next)),
      }),
      [rows, columns, sorting, phone]
    )
  )
  const stages = [
    { value: "REQUESTED", label: "To count", count: asked.length },
    { value: "COUNTED", label: "Counted", count: counted.length },
  ]

  return (
    <PageContent>
      <PageHeader crumb="Operations" title="Quantity Checks" />
      <DockTools
        search={{ ...search, label: SEARCH_LABEL }}
        sort={dockSortOf(table)}
        status={{
          value: tab,
          options: stages,
          onChange: (next) => setTab(next as Stage),
        }}
      />
      <KpiStrip className="grid-cols-3">
        <Kpi
          label="To count"
          value={`${count(asked.length)} ${asked.length === 1 ? "check" : "checks"}`}
        />
        <Kpi
          label="Counted"
          value={`${count(counted.length)} ${counted.length === 1 ? "check" : "checks"}`}
        />
        <Kpi label="Pieces counted" value={quantity(countedPieces)} />
      </KpiStrip>
      {/* On a phone the two stages are the dock's status button. */}
      <SubTabs
        className="max-md:hidden"
        value={tab}
        onChange={(next) => setTab(next as Stage)}
        tabs={stages.map((one) => ({
          value: one.value,
          label: `${one.label} ${count(one.count)}`,
        }))}
      />
      {/* On a desk the search sits over the table; on a phone it is the
          dock's, as on Receiving PO. */}
      <div className="relative mb-3.5 w-80 max-md:hidden">
        <Search
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-mute"
        />
        <Input
          type="search"
          aria-label={SEARCH_LABEL}
          placeholder={SEARCH_LABEL}
          value={search.value}
          onChange={(event) => search.onChange(event.target.value)}
          className="pl-9"
        />
      </div>

      <Card className="overflow-hidden max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
        {queryState(open, {
          loading: "Loading the counts asked for…",
          render: () =>
            rows.length === 0 ? (
              <EmptyState>
                {search.needle !== ""
                  ? "No checks match."
                  : tab === "COUNTED"
                    ? "Nothing counted yet."
                    : "Nothing to count."}
              </EmptyState>
            ) : (
              <DataTable<QuantityCheck>
                refresh={[open]}
                table={table}
                touch
                onRowClick={(row) => setOpened(row.check_id)}
                isSelected={(row) => row.check_id === opened}
                pageScroll
                cardSort={false}
                cardsApart
                cardLead
                className={ROOMY}
              />
            ),
        })}
      </Card>
      <CountSheet
        check={chosen?.status === "REQUESTED" ? chosen : null}
        onClose={() => setOpened(null)}
      />
      <CountedSheet
        check={chosen?.status === "COUNTED" ? chosen : null}
        onClose={() => setOpened(null)}
      />
    </PageContent>
  )
}

/// Who asked for the count and how long ago. On a card's foot, a counted
/// check says what it came to instead.
function AskedCell({
  check,
  card = false,
}: {
  check: QuantityCheck
  card?: boolean
}) {
  const nameOfLogin = useNameOfLogin()
  if (card && check.status === "COUNTED")
    return (
      <span className="flex flex-col leading-6 tabular-nums">
        <span>
          {"Counted "}
          <span className="text-cell font-semibold text-ink">
            {`${countPcs(piecesOf(check))}`}
          </span>
        </span>
        {check.counted_by !== null && (
          <span className="truncate">
            {titled(nameOfLogin(check.counted_by))}
          </span>
        )}
      </span>
    )
  return (
    <span
      className={cn(
        "flex min-w-0 flex-col leading-5",
        card ? "leading-6" : "py-1"
      )}
    >
      <span className={cn("truncate", !card && "text-ink")}>
        {titled(nameOfLogin(check.requested_by))}
      </span>
      <span className="text-mute">{ago(check.requested_at)}</span>
    </span>
  )
}

/// The count in one cell: the pieces, and under them who counted and when —
/// as Receiving PO draws a count waiting for review.
function CountedCell({ check }: { check: QuantityCheck }) {
  const nameOfLogin = useNameOfLogin()
  const who = check.counted_by ? titled(nameOfLogin(check.counted_by)) : "—"
  const when = check.counted_at ? recentMoment(check.counted_at) : ""
  return (
    <span className="flex flex-col items-end leading-5 whitespace-nowrap tabular-nums">
      <span className="font-medium text-ink">{`${countPcs(piecesOf(check))}`}</span>
      <span
        className="flex max-w-[16.5rem] text-mute"
        title={when ? `${who} · ${when}` : who}
      >
        <span className="min-w-0 truncate">{who}</span>
        {when && <span className="shrink-0">{`\u00a0· ${when}`}</span>}
      </span>
    </span>
  )
}

/// A check the warehouse has answered, as facts: who counted it and when, and
/// each colour and size with what was counted against it. Nothing to type.
function CountedSheet({
  check,
  onClose,
}: {
  check: QuantityCheck | null
  onClose: () => void
}) {
  const supplierOf = useSupplierName()
  const nameOfLogin = useNameOfLogin()
  const groups: { name: string; lines: QuantityCheckRow[] }[] = []
  for (const line of check?.lines ?? []) {
    const name = line.article ? line.article : (check?.article_name ?? "")
    const group = groups.find((one) => one.name === name)
    if (group) group.lines.push(line)
    else groups.push({ name, lines: [line] })
  }
  const counted = (check?.lines ?? []).reduce(
    (sum, one) => sum + one.quantity,
    0
  )
  const received = check?.receipt_quantity ?? 0
  const photos = check?.image_url != null && check.image_url !== ""

  return (
    <Sheet
      open={check !== null}
      onOpenChange={(next) => !next && onClose()}
      id={check?.po_number}
      title={
        check === null
          ? "Quantity Check"
          : supplierOf(
              check.supplier_id,
              check.supplier_name ?? check.supplier_id,
              check.supplier_id
            )
      }
      width="table"
    >
      {check && (
        <div className="flex min-w-0 flex-col gap-4">
          <Facts>
            <Fact term="Counted by">
              {check.counted_by ? titled(nameOfLogin(check.counted_by)) : "—"}
            </Fact>
            <Fact term="Counted at">
              {check.counted_at ? recentMoment(check.counted_at) : "—"}
            </Fact>
            <Fact term="Asked by">
              {titled(nameOfLogin(check.requested_by))}
            </Fact>
            <Fact term="Asked at">{recentMoment(check.requested_at)}</Fact>
          </Facts>
          <Card className="overflow-hidden">
            <div
              className={cn(
                COUNT_ROW,
                "h-10 items-center border-b border-hairline bg-soft"
              )}
            >
              <span className={COUNT_HEAD}>Article</span>
              <span className={cn(COUNT_HEAD, "max-sm:hidden")}>Counted</span>
              <span className={cn(COUNT_HEAD, "text-right")}>In pieces</span>
            </div>
            {groups.length === 0 ? (
              <EmptyState>No pieces were counted.</EmptyState>
            ) : (
              <div className="divide-y divide-hairline">
                {groups.map((group) => {
                  const sum = group.lines.reduce(
                    (total, one) => total + one.quantity,
                    0
                  )
                  return (
                    <div key={group.name} className="pb-3.5">
                      <div className={cn(COUNT_ROW, "py-3.5")}>
                        <TwoLines
                          top={group.name}
                          bottom={
                            groups.length === 1
                              ? `${countPcs(received)} received`
                              : "—"
                          }
                          className="min-h-11"
                        />
                        <span className="max-sm:hidden" />
                        <span className="flex min-h-11 items-center justify-end text-right font-medium text-ink tabular-nums">
                          {countPcs(sum)}
                        </span>
                      </div>
                      <div className="flex flex-col gap-2">
                        {group.lines.map((line) => {
                          const label = variantLabel(check.article_name, {
                            colour_code: line.colour,
                            size_code: line.size,
                          })
                          return (
                            <div
                              key={`${line.colour}|${line.size}`}
                              className={cn(COUNT_ROW, "items-center")}
                            >
                              <span className="flex min-h-11 min-w-0 items-center gap-3">
                                <VariantPhoto
                                  urls={undefined}
                                  fallback={check.image_url}
                                  name={label}
                                  slot={photos}
                                />
                                <span className="line-clamp-2 min-w-0 text-body">
                                  {label}
                                </span>
                              </span>
                              <span className="text-[0.9375rem] text-ink tabular-nums">
                                {countPcs(line.quantity)}
                              </span>
                              <span className="max-sm:hidden" />
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </Card>

          <div className="flex justify-end">
            <dl className="grid w-full grid-cols-[1fr_auto] gap-x-12 rounded-card border border-hairline bg-soft px-5 py-2 tabular-nums md:w-auto md:min-w-[22rem]">
              <dt className="flex min-h-11 items-center text-[1rem] font-medium text-ink">
                Total Counted
              </dt>
              <dd className="flex min-h-11 items-center justify-end text-right text-[1.0625rem] font-semibold text-ink">
                {countPcs(counted)}
              </dd>
              <dt className="flex min-h-11 items-center text-[1rem] font-medium text-ink">
                Pieces Received
              </dt>
              <dd className="flex min-h-11 items-center justify-end text-right text-[1.0625rem] font-semibold text-ink">
                {countPcs(received)}
              </dd>
            </dl>
          </div>
        </div>
      )}
    </Sheet>
  )
}

interface Entry {
  readonly id: number
  readonly colour: string
  readonly size: string
  readonly quantity: string
}

let entryId = 0
const blank = (): Entry => ({
  id: (entryId += 1),
  colour: "",
  size: "",
  quantity: "",
})

/// One check, answered as a flat list. When head office chose its colours and
/// sizes the rows are fixed (article, colour and size are read-only) and the
/// warehouse only types a quantity on each; a row left empty is not sent.
/// Without them (an older check) the sheet is the editable list it always was.
function CountSheet({
  check,
  onClose,
}: {
  check: QuantityCheck | null
  onClose: () => void
}) {
  const client = useQueryClient()
  const supplierOf = useSupplierName()
  const colours = useQuery({
    queryKey: colourKeys.list(),
    queryFn: ({ signal }) => listColours(signal),
    staleTime: 30 * 60 * 1000,
  })
  const vocabulary = useQuery({
    queryKey: procurementKeys.vocabulary(),
    queryFn: ({ signal }) => catalogueVocabulary(signal),
    staleTime: 30 * 60 * 1000,
  })
  const [entries, setEntries] = useState<readonly Entry[]>(() => [blank()])
  // The sheet stays mounted between checks: rows typed for one are tagged with
  // it, so the next opens clean without an effect to clear them.
  const [forId, setForId] = useState<string | null>(null)
  const rows = forId === check?.check_id ? entries : [blank()]
  const change = (next: readonly Entry[]) => {
    setForId(check?.check_id ?? null)
    setEntries(next)
  }
  const patch = (id: number, part: Partial<Entry>) =>
    change(rows.map((one) => (one.id === id ? { ...one, ...part } : one)))

  // Head office's combinations, one fixed row each, with the quantity typed
  // against its position.
  const fixed = check?.expected ?? []
  const [typed, setTyped] = useState<Readonly<Record<number, string>>>({})
  const quantities = forId === check?.check_id ? typed : {}
  const type = (at: number, value: string) => {
    setForId(check?.check_id ?? null)
    setTyped({ ...quantities, [at]: value })
  }

  const filled: QuantityCheckRow[] =
    fixed.length > 0
      ? fixed
          .map((one, at) => ({
            ...one,
            quantity: Number(quantities[at] ?? "") || 0,
          }))
          .filter((one) => one.quantity > 0)
      : rows
          .filter(
            (one) =>
              one.colour !== "" && one.size !== "" && Number(one.quantity) > 0
          )
          .map((one) => ({
            colour: one.colour,
            size: one.size,
            quantity: Number(one.quantity),
          }))
  /// What the warehouse counted has to be what came: the total of the rows
  /// equals the pieces received, as New articles asks of its own grid.
  const counted = filled.reduce((sum, one) => sum + one.quantity, 0)
  const received = check?.receipt_quantity ?? 0
  const left = received - counted
  const balanced = left === 0
  const submit = useMutation({
    mutationFn: () => countQuantityCheck(check!.check_id, filled),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: quantityCheckKeys.all })
      setForId(null)
      onClose()
    },
  })

  /// The rows by article: a delivery split into sibling articles has one group
  /// each, as an order's lines do on the Receiving count sheet.
  const groups: {
    name: string
    cells: { cell: QuantityCheckCell; at: number }[]
  }[] = []
  fixed.forEach((cell, at) => {
    const name = cell.article ? cell.article : (check?.article_name ?? "")
    const group = groups.find((one) => one.name === name)
    if (group) group.cells.push({ cell, at })
    else groups.push({ name, cells: [{ cell, at }] })
  })
  const kind =
    check === null
      ? ""
      : [
          ...((check.division_code ?? "") !== ""
            ? [termLabel(vocabulary.data?.divisions, check.division_code)]
            : []),
          ...check.tags.map((code) => termLabel(vocabulary.data?.tags, code)),
        ].join(" · ")
  const tone =
    left < 0 ? "text-bad-fg" : balanced ? "text-ok-fg" : "text-warn-fg"
  const photos = check?.image_url != null && check.image_url !== ""

  return (
    <Sheet
      open={check !== null}
      onOpenChange={(next) => !next && onClose()}
      id={check?.po_number}
      title={
        check === null
          ? "Quantity Check"
          : supplierOf(
              check.supplier_id,
              check.supplier_name ?? check.supplier_id,
              check.supplier_id
            )
      }
      width="table"
      footer={
        check === null ? undefined : (
          <div className="flex items-center justify-end gap-3">
            <Button
              variant="primary"
              disabled={filled.length === 0 || !balanced}
              pending={submit.isPending}
              onClick={() => submit.mutate()}
            >
              {submit.isPending ? "Sending…" : "Submit count"}
            </Button>
          </div>
        )
      }
    >
      {check && (
        <div className="flex min-w-0 flex-col gap-4">
          {/* One grid, header and rows sharing the Receiving count sheet's
          own tracks: what, what was counted, and what that comes to. */}
          <Card className="overflow-hidden">
            <div
              className={cn(
                COUNT_ROW,
                "h-10 items-center border-b border-hairline bg-soft"
              )}
            >
              <span className={COUNT_HEAD}>Article</span>
              <span className={cn(COUNT_HEAD, "max-sm:hidden")}>Counted</span>
              <span className={cn(COUNT_HEAD, "text-right")}>In pieces</span>
            </div>
            {fixed.length > 0 ? (
              <div className="divide-y divide-hairline">
                {groups.map((group) => {
                  const sum = group.cells.reduce(
                    (total, { at }) =>
                      total + (Number(quantities[at] ?? "") || 0),
                    0
                  )
                  return (
                    <div key={group.name} className="pb-3.5">
                      <div className={cn(COUNT_ROW, "py-3.5")}>
                        <TwoLines
                          top={group.name}
                          bottom={
                            groups.length === 1
                              ? [`${countPcs(received)} received`, kind]
                                  .filter((part) => part !== "")
                                  .join(" · ")
                              : kind || "—"
                          }
                          className="min-h-11"
                        />
                        <span className="max-sm:hidden" />
                        <span
                          className={cn(
                            "flex min-h-11 items-center justify-end text-right tabular-nums",
                            sum > 0 ? "font-medium text-ink" : "text-mute"
                          )}
                        >
                          {sum > 0 ? `${countPcs(sum)}` : "—"}
                        </span>
                      </div>
                      <div className="flex flex-col gap-2">
                        {group.cells.map(({ cell, at }) => {
                          const label = variantLabel(check.article_name, {
                            colour_code: cell.colour,
                            size_code: cell.size,
                          })
                          return (
                            <div
                              key={`${cell.colour}|${cell.size}`}
                              className={cn(COUNT_ROW, "items-center")}
                            >
                              <span className="flex min-h-11 min-w-0 items-center gap-3">
                                <VariantPhoto
                                  urls={undefined}
                                  fallback={check.image_url}
                                  name={label}
                                  slot={photos}
                                />
                                <span className="line-clamp-2 min-w-0 text-body">
                                  {label}
                                </span>
                              </span>
                              <div className="flex items-center gap-2">
                                <Input
                                  className="h-11 w-24 text-center font-semibold"
                                  inputMode="numeric"
                                  autoComplete="off"
                                  aria-label={`Counted pieces of ${label}`}
                                  padLabel={label}
                                  value={quantities[at] ?? ""}
                                  onChange={(event) =>
                                    type(
                                      at,
                                      event.target.value.replace(/\D/g, "")
                                    )
                                  }
                                />
                                <span className="w-28 text-[0.9375rem] text-body max-sm:w-auto">
                                  pieces
                                </span>
                                <span className="size-11 max-sm:hidden" />
                              </div>
                              <span className="max-sm:hidden" />
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="flex flex-col gap-4 px-4 py-3.5">
                <TwoLines
                  top={check.article_name}
                  bottom={[`${countPcs(received)} received`, kind]
                    .filter((part) => part !== "")
                    .join(" · ")}
                />
                <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_5.5rem_2.25rem] gap-2 text-[0.9375rem] text-body">
                  <span>Color</span>
                  <span>Size</span>
                  <span>Quantity</span>
                  <span />
                </div>
                {rows.map((one) => (
                  <div
                    key={one.id}
                    className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_5.5rem_2.25rem] items-center gap-2"
                  >
                    <Select
                      aria-label="Color"
                      value={one.colour}
                      onChange={(next) => patch(one.id, { colour: next })}
                    >
                      <option value="">—</option>
                      {(colours.data?.colours ?? []).map((term) => (
                        <option key={term.code} value={term.label}>
                          {term.label}
                        </option>
                      ))}
                    </Select>
                    <Select
                      aria-label="Size"
                      value={one.size}
                      onChange={(next) => patch(one.id, { size: next })}
                    >
                      <option value="">—</option>
                      {(vocabulary.data?.sizes ?? []).map((term) => (
                        <option key={term.code} value={term.label}>
                          {term.label}
                        </option>
                      ))}
                    </Select>
                    <Input
                      inputMode="numeric"
                      className="text-right tabular-nums"
                      aria-label="Quantity"
                      value={one.quantity}
                      onChange={(event) =>
                        patch(one.id, {
                          quantity: event.target.value.replace(/\D/g, ""),
                        })
                      }
                    />
                    <button
                      type="button"
                      aria-label="Remove row"
                      disabled={rows.length === 1}
                      onClick={() =>
                        change(rows.filter((row) => row.id !== one.id))
                      }
                      className="grid size-9 place-items-center rounded-full text-mute transition-colors hover:bg-soft-2 hover:text-ink disabled:opacity-40"
                    >
                      <X className="size-4" />
                    </button>
                  </div>
                ))}
                <Button
                  variant="ghost"
                  className="self-start"
                  onClick={() => change([...rows, blank()])}
                >
                  <Plus />
                  Add Row
                </Button>
              </div>
            )}
          </Card>

          {/* The totals, in a box at the right as on the Receiving count: the
          counter sees how far from the delivery's own figure the rows are. */}
          <div className="flex justify-end">
            <dl className="grid w-full grid-cols-[1fr_auto] gap-x-12 rounded-card border border-hairline bg-soft px-5 py-2 tabular-nums md:w-auto md:min-w-[22rem]">
              <dt className="flex min-h-11 items-center text-[1rem] font-medium text-ink">
                Total Counted
              </dt>
              <dd className="flex min-h-11 items-center justify-end text-right text-[1.0625rem] font-semibold text-ink">
                {countPcs(counted)}
              </dd>
              <dt className="flex min-h-11 items-center text-[1rem] font-medium text-ink">
                Pieces Received
              </dt>
              <dd className="flex min-h-11 items-center justify-end text-right text-[1.0625rem] font-semibold text-ink">
                {countPcs(received)}
              </dd>
              <dt className="flex min-h-11 items-center text-[1rem] font-medium text-ink">
                {left < 0 ? "Over" : "Left"}
              </dt>
              <dd
                className={cn(
                  "flex min-h-11 items-center justify-end text-right text-[1.0625rem] font-semibold",
                  tone
                )}
              >
                {countPcs(Math.abs(left))}
              </dd>
            </dl>
          </div>

          <Problem error={submit.error} />
        </div>
      )}
    </Sheet>
  )
}
