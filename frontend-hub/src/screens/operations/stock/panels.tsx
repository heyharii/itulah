import { ArrowLeft, ArrowUpRight, Search } from "lucide-react"
import { useMemo, useState } from "react"

import { AppLink } from "@/components/ui/app-link"
import { Button } from "@/components/ui/button"
import { Panel } from "@/components/ui/dialog"
import { Input } from "@/components/ui/field"
import { EmptyState, LoadingState } from "@/components/ui/states"
import { count, quantity, sku as skuNumber } from "@/lib/format"
import { cn } from "@/lib/utils"
import { TwoLines } from "@/screens/operations/two-lines"
import {
  STAGES,
  STAGE_LABEL,
  due,
  useOutboundCards,
  usePoolLines,
  type ArticleLine,
  type OutboundCard,
  type Stage,
  type StockData,
} from "@/screens/operations/stock/data"

/// Everything on Ops › Stock that drills down opens in one big dialog, with a
/// Back from a detail to the list it came out of. The one exception is a
/// purchase order: that is Procurement's own sheet, kept in the URL (`?order=`).

export type ListKind = "order" | "unid" | "unal" | "over" | "returns"

export type View =
  | { readonly kind: "list"; readonly which: ListKind }
  | { readonly kind: "division"; readonly code: string }
  | { readonly kind: "return"; readonly id: string }
  | { readonly kind: "return-stock"; readonly storeId?: string }
  | { readonly kind: "pick-area" }
  | { readonly kind: "stage"; readonly stage: Stage }
  | { readonly kind: "store"; readonly storeId: string; readonly stage?: Stage }

/// Where a click can go: a view of this dialog, or a purchase order (Buying's
/// sheet, which lives in the URL so a link to it can be sent).
export type Target = View | { readonly kind: "order"; readonly id: string }

const LIST_TITLE: Readonly<Record<ListKind, string>> = {
  order: "On order",
  unid: "Unidentified",
  unal: "Unallotted",
  over: "Over-delivery",
  returns: "Returns",
}

const pcs = (n: number) => `${quantity(n)}`

/// A table in the dialog: header row, rows at 64px, an optional total.
function Grid({
  head,
  children,
  foot,
}: {
  head: readonly { label: string; right?: boolean }[]
  children: React.ReactNode
  foot?: React.ReactNode
}) {
  return (
    <div className="overflow-hidden rounded-card border border-hairline bg-canvas">
      <table className="w-full border-collapse">
        <thead>
          <tr className="h-12 bg-soft text-left font-medium text-body">
            {head.map((h) => (
              <th
                key={h.label}
                className={cn("px-4 font-medium", h.right && "text-right")}
              >
                {h.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
        {foot && <tfoot>{foot}</tfoot>}
      </table>
    </div>
  )
}

function Row({
  onOpen,
  tone,
  children,
}: {
  onOpen?: () => void
  tone?: "soft"
  children: React.ReactNode
}) {
  return (
    <tr
      onClick={onOpen}
      onKeyDown={
        onOpen
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault()
                onOpen()
              }
            }
          : undefined
      }
      tabIndex={onOpen ? 0 : undefined}
      className={cn(
        "h-16 border-t border-hairline",
        tone === "soft" && "bg-soft",
        onOpen && "cursor-pointer transition-colors hover:bg-soft-2"
      )}
    >
      {children}
    </tr>
  )
}

const cell = "px-4 py-3.5"
const num = "px-4 py-3.5 text-right tabular-nums"

function Total({ cols, pcs: n }: { cols: number; pcs: number }) {
  return (
    <tr className="h-14 border-t border-hairline bg-soft font-semibold text-ink">
      <td className="px-4">Total</td>
      {cols > 2 && <td colSpan={cols - 2} />}
      <td className="px-4 text-right tabular-nums">{count(n)}</td>
    </tr>
  )
}

function BackAction({ onBack }: { onBack: () => void }) {
  return (
    <Button variant="quiet" onClick={onBack}>
      <ArrowLeft />
      Back
    </Button>
  )
}

function SearchBox({
  value,
  onChange,
  label,
}: {
  value: string
  onChange: (next: string) => void
  label: string
}) {
  return (
    <label className="relative block">
      <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-mute" />
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label={label}
        className="h-11 pl-10"
      />
    </label>
  )
}

// ---------------------------------------------------------------------------
// View all: the full list behind an accordion, with search.
// ---------------------------------------------------------------------------

interface ListRow {
  readonly key: string
  readonly find: string
  readonly cells: readonly React.ReactNode[]
  readonly open?: () => void
}

function listPcs(which: ListKind, data: StockData): number {
  switch (which) {
    case "order":
      return data.onOrder.pcs
    case "unid":
      return data.unidentified.figure.pcs
    case "unal":
      return data.unallotted.figure.pcs
    case "over":
      return data.overDelivery.pcs
    case "returns":
      return data.returns.pcs
  }
}

/// Unidentified, as in the accordion: each PO (number over supplier, its
/// pieces) and under it the articles that arrived on it.
function UnidentifiedList({
  data,
  onOpen,
}: {
  data: StockData
  onOpen: (target: Target) => void
}) {
  const [query, setQuery] = useState("")
  const needle = query.trim().toLowerCase()
  const groups = data.unidentified.rows
    .map((po) => {
      const whole = `${po.poNumber} ${po.supplier}`
        .toLowerCase()
        .includes(needle)
      return {
        po,
        lines: whole
          ? po.lines
          : po.lines.filter((l) => l.name.toLowerCase().includes(needle)),
      }
    })
    .filter((g) => g.lines.length > 0)

  return (
    <div className="flex flex-col gap-4">
      <SearchBox
        value={query}
        onChange={setQuery}
        label="Search Unidentified"
      />
      {groups.length === 0 ? (
        <EmptyState>Nothing found.</EmptyState>
      ) : (
        <Grid head={[{ label: "PO No." }, { label: "Pcs", right: true }]}>
          {groups.map(({ po, lines }) => (
            <PoGroup key={po.id} po={po} lines={lines} onOpen={onOpen} />
          ))}
        </Grid>
      )}
    </div>
  )
}

function PoGroup({
  po,
  lines,
  onOpen,
}: {
  po: StockData["unidentified"]["rows"][number]
  lines: StockData["unidentified"]["rows"][number]["lines"]
  onOpen: (target: Target) => void
}) {
  const poId = po.poId
  return (
    <>
      <Row
        tone="soft"
        onOpen={poId ? () => onOpen({ kind: "order", id: poId }) : undefined}
      >
        <td className={cell}>
          <TwoLines
            top={<span className="font-mono">{po.poNumber}</span>}
            bottom={po.supplier}
          />
        </td>
        <td className={cn(num, "font-medium text-ink")}>{count(po.pcs)}</td>
      </Row>
      {lines.map((l) => (
        <Row key={l.id}>
          <td className={cn(cell, "pl-10")}>{l.name}</td>
          <td className={num}>{count(l.pcs)}</td>
        </Row>
      ))}
    </>
  )
}

function ListBody({
  which,
  data,
  onOpen,
}: {
  which: ListKind
  data: StockData
  onOpen: (target: Target) => void
}) {
  const [query, setQuery] = useState("")

  const config = useMemo(() => {
    switch (which) {
      case "order":
        return {
          head: [
            { label: "PO no." },
            { label: "Supplier" },
            { label: "Delivery" },
            { label: "Pcs", right: true },
          ],
          rows: data.onOrder.rows.map((o): ListRow => ({
            key: o.id,
            find: `${o.poNumber} ${o.supplier}`,
            cells: [
              <span key="a" className="font-mono">
                {o.poNumber}
              </span>,
              o.supplier,
              due(o.due),
              count(o.pcs),
            ],
            open: () => onOpen({ kind: "order", id: o.id }),
          })),
        }
      case "unid":
        return null
      case "unal":
        return {
          head: [{ label: "Division" }, { label: "Pcs", right: true }],
          rows: data.unallotted.divisions.map((d): ListRow => ({
            key: d.code,
            find: d.name,
            cells: [d.name, count(d.pcs)],
            open: () => onOpen({ kind: "division", code: d.code }),
          })),
        }
      case "over":
        return {
          head: [
            { label: "PO no." },
            { label: "Supplier" },
            { label: "Pcs", right: true },
          ],
          rows: data.overDelivery.rows.map((o): ListRow => ({
            key: o.id,
            find: `${o.poNumber} ${o.supplier}`,
            cells: [
              <span key="a" className="font-mono">
                {o.poNumber}
              </span>,
              o.supplier,
              count(o.pcs),
            ],
            open: () => onOpen({ kind: "order", id: o.poId }),
          })),
        }
      case "returns":
        return {
          head: [
            { label: "RS no." },
            { label: "Supplier" },
            { label: "Settle by" },
            { label: "Pcs", right: true },
          ],
          rows: data.returns.rows.map((r): ListRow => ({
            key: r.id,
            find: `${r.number} ${r.supplier}`,
            cells: [
              <span key="a" className="font-mono">
                {r.number}
              </span>,
              r.supplier,
              r.settleBy,
              count(r.pcs),
            ],
            open: () => onOpen({ kind: "return", id: r.id }),
          })),
        }
    }
  }, [which, data, onOpen])

  if (which === "unid") return <UnidentifiedList data={data} onOpen={onOpen} />
  if (config === null) return null

  const needle = query.trim().toLowerCase()
  const rows = config.rows.filter((r) => r.find.toLowerCase().includes(needle))
  return (
    <div className="flex flex-col gap-4">
      <SearchBox
        value={query}
        onChange={setQuery}
        label={`Search ${LIST_TITLE[which]}`}
      />
      {rows.length === 0 ? (
        <EmptyState>Nothing found.</EmptyState>
      ) : (
        <Grid head={config.head}>
          {rows.map((r) => (
            <Row key={r.key} onOpen={r.open}>
              {r.cells.map((c, i) => (
                <td key={i} className={i === r.cells.length - 1 ? num : cell}>
                  {c}
                </td>
              ))}
            </Row>
          ))}
        </Grid>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// A supplier return's articles.
// ---------------------------------------------------------------------------

function ReturnBody({ id, data }: { id: string; data: StockData }) {
  const row = data.returns.rows.find((r) => r.id === id)
  if (!row) return null
  return (
    <Grid
      head={[{ label: "Article" }, { label: "Pcs", right: true }]}
      foot={<Total cols={2} pcs={row.pcs} />}
    >
      {row.lines.map((l) => (
        <Row key={l.code}>
          <td className={cell}>
            <TwoLines top={l.name} bottom={skuNumber(l.code)} mono />
          </td>
          <td className={num}>{count(l.pcs)}</td>
        </Row>
      ))}
    </Grid>
  )
}

// ---------------------------------------------------------------------------
// The articles behind a number: a division of Unallotted, or Return stock.
// ---------------------------------------------------------------------------

function ArticlesTable({
  lines,
  pending,
  withStore = false,
}: {
  lines: readonly ArticleLine[]
  pending: boolean
  withStore?: boolean
}) {
  if (pending && lines.length === 0) return <LoadingState />
  if (lines.length === 0) return <EmptyState>Nothing here.</EmptyState>
  return (
    <Grid
      head={[
        { label: "Article" },
        ...(withStore ? [{ label: "Store" }] : []),
        { label: "Pcs", right: true },
      ]}
      foot={
        <tr className="h-14 border-t border-hairline bg-soft font-semibold text-ink">
          <td className="px-4">Total</td>
          {withStore && <td />}
          <td className="px-4 text-right tabular-nums">
            {count(lines.reduce((sum, l) => sum + l.pcs, 0))}
          </td>
        </tr>
      }
    >
      {lines.map((l) => (
        <Row key={l.key}>
          <td className={cell}>
            <TwoLines top={l.name} bottom={skuNumber(l.code)} mono />
          </td>
          {withStore && <td className={cell}>{l.store}</td>}
          <td className={num}>{count(l.pcs)}</td>
        </Row>
      ))}
    </Grid>
  )
}

function DivisionBody({ code, data }: { code: string; data: StockData }) {
  return (
    <ArticlesTable
      lines={data.unallotted.lines.get(code) ?? []}
      pending={false}
    />
  )
}

function PickAreaBody({ data }: { data: StockData }) {
  const { lines, pending } = usePoolLines(data.pickArea.pools, true)
  return <ArticlesTable lines={lines} pending={pending} />
}

function ReturnStockBody({
  storeId,
  data,
}: {
  storeId: string | undefined
  data: StockData
}) {
  const stores = data.returnStock.stores.filter(
    (s) => storeId === undefined || s.id === storeId
  )
  // One read per pool, one pool per store of origin: the store is the label.
  const pools = stores.flatMap((s) =>
    s.poolIds.map((id) => ({ id, name: s.name }))
  )
  const { lines, pending } = usePoolLines(pools, true)
  return (
    <ArticlesTable
      lines={lines}
      pending={pending}
      withStore={stores.length !== 1}
    />
  )
}

// ---------------------------------------------------------------------------
// Outbound: a stage across stores, or a store across the stages.
// ---------------------------------------------------------------------------

const age = (d: number) => (d === 0 ? "Today" : `${d}d`)

function CardTile({
  card,
  withStore,
}: {
  card: OutboundCard
  withStore: boolean
}) {
  return (
    <div className="rounded-card border border-hairline bg-canvas px-[1.125rem] py-4">
      <div className="flex justify-between gap-3">
        <span
          className={cn(
            "min-w-0 truncate leading-[1.4] font-medium text-ink",
            !withStore && "font-mono"
          )}
        >
          {withStore ? card.storeName : card.doc}
        </span>
        <span className="font-medium text-ink tabular-nums">
          {pcs(card.pcs)}
        </span>
      </div>
      <div className="mt-1 flex justify-between gap-3 text-[0.9375rem] leading-[1.4] text-mute">
        <span className={cn("min-w-0 truncate", withStore && "font-mono")}>
          {withStore ? card.doc : ""}
        </span>
        <span className={cn(card.days >= 3 && "text-warn-fg")}>
          {age(card.days)}
        </span>
      </div>
    </div>
  )
}

function BoardLink() {
  return (
    <AppLink
      to="/operations/board"
      className="inline-flex items-center gap-1.5 font-medium text-accent hover:underline"
    >
      Open board
      <ArrowUpRight className="size-4" />
    </AppLink>
  )
}

function OutboundBody({
  stage,
  storeId,
  highlight,
  data,
}: {
  stage?: Stage
  storeId?: string
  highlight?: Stage
  data: StockData
}) {
  const { cards, pending } = useOutboundCards(true)
  return (
    <div className="flex flex-col gap-6">
      {pending && cards.length === 0 ? (
        <LoadingState />
      ) : storeId ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          {STAGES.map((s) => {
            const mine = cards.filter(
              (c) => c.stage === s && c.storeId === storeId
            )
            const sum = data.stages[s].stores.find((o) => o.id === storeId)
            return (
              <div key={s} className="min-w-0">
                <div
                  className={cn(
                    "pb-3",
                    highlight === s ? "text-accent" : "text-ink"
                  )}
                >
                  <div className="font-medium">{STAGE_LABEL[s]}</div>
                  <div className="mt-1 text-[0.9375rem] text-mute">
                    {pcs(sum?.pcs ?? 0)}
                  </div>
                </div>
                <div className="flex flex-col gap-3">
                  {mine.length === 0 ? (
                    <span className="py-4 text-faint">—</span>
                  ) : (
                    mine.map((c) => (
                      <CardTile key={c.key} card={c} withStore={false} />
                    ))
                  )}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        (() => {
          const mine = cards.filter((c) => c.stage === stage)
          return mine.length === 0 ? (
            <EmptyState>Nothing here.</EmptyState>
          ) : (
            <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2 lg:grid-cols-3">
              {mine.map((c) => (
                <CardTile key={c.key} card={c} withStore />
              ))}
            </div>
          )
        })()
      )}
      <div>
        <BoardLink />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// The dialog: one Panel for every view, so list -> detail -> Back does not
// close and reopen it.
// ---------------------------------------------------------------------------

function headOf(
  view: View,
  data: StockData
): { title: React.ReactNode; sub: React.ReactNode } {
  switch (view.kind) {
    case "list":
      return {
        title: LIST_TITLE[view.which],
        sub: pcs(listPcs(view.which, data)),
      }
    case "return": {
      const row = data.returns.rows.find((r) => r.id === view.id)
      return {
        title: row?.supplier ?? "Return",
        sub: row ? (
          <>
            <span className="font-mono">{row.number}</span>
            {` · Settle by ${row.settleBy}`}
          </>
        ) : undefined,
      }
    }
    case "division": {
      const division = data.unallotted.divisions.find(
        (d) => d.code === view.code
      )
      return {
        title: division?.name ?? "Unallotted",
        sub: division ? pcs(division.pcs) : undefined,
      }
    }
    case "return-stock": {
      const stores = data.returnStock.stores.filter(
        (s) => view.storeId === undefined || s.id === view.storeId
      )
      return {
        title: stores.length === 1 ? stores[0]!.name : "Return stock",
        sub: pcs(stores.reduce((sum, s) => sum + s.pcs, 0)),
      }
    }
    case "pick-area":
      return { title: "Pick area", sub: pcs(data.pickArea.figure.pcs) }
    case "stage":
      return {
        title: STAGE_LABEL[view.stage],
        sub: pcs(data.stages[view.stage].figure.pcs),
      }
    case "store": {
      const found = STAGES.flatMap((s) => data.stages[s].stores).find(
        (one) => one.id === view.storeId
      )
      return {
        title: found?.name ?? "Store",
        sub: pcs(
          STAGES.reduce(
            (sum, s) =>
              sum +
              (data.stages[s].stores.find((o) => o.id === view.storeId)?.pcs ??
                0),
            0
          )
        ),
      }
    }
  }
}

export function StockPanel({
  view,
  data,
  onOpen,
  onBack,
  onClose,
}: {
  view: View | null
  data: StockData
  onOpen: (target: Target) => void
  onBack?: () => void
  onClose: () => void
}) {
  const head = view ? headOf(view, data) : { title: "Stock", sub: undefined }
  const wide = view?.kind === "stage" || view?.kind === "store"
  return (
    <Panel
      open={view !== null}
      onOpenChange={(next) => !next && onClose()}
      title={head.title}
      sub={head.sub}
      actions={onBack ? <BackAction onBack={onBack} /> : undefined}
      wide={wide}
    >
      {view?.kind === "list" && (
        <ListBody which={view.which} data={data} onOpen={onOpen} />
      )}
      {view?.kind === "return" && <ReturnBody id={view.id} data={data} />}
      {view?.kind === "division" && (
        <DivisionBody code={view.code} data={data} />
      )}
      {view?.kind === "return-stock" && (
        <ReturnStockBody storeId={view.storeId} data={data} />
      )}
      {view?.kind === "pick-area" && <PickAreaBody data={data} />}
      {view?.kind === "stage" && (
        <OutboundBody stage={view.stage} data={data} />
      )}
      {view?.kind === "store" && (
        <OutboundBody
          storeId={view.storeId}
          highlight={view.stage}
          data={data}
        />
      )}
    </Panel>
  )
}
