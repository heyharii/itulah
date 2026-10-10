import { ArrowUpRight, ChevronRight } from "lucide-react"
import { Fragment, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { PageHeader } from "@/components/ui/page-header"
import { SubTabs } from "@/components/ui/sub-tabs"
import { ErrorState, LoadingState } from "@/components/ui/states"
import { count, dateText } from "@/lib/format"
import { useAppNavigate } from "@/lib/navigate"
import { useSheet } from "@/lib/sheets"
import { cn } from "@/lib/utils"
import { SHOW_MISSING } from "@/lib/features"
import { useMissingRows } from "@/screens/inventory/missing-data"
import { MissingList } from "@/screens/inventory/missing-list"
import {
  STAGES,
  STAGE_LABEL,
  due,
  useStock,
  useStockStatus,
  type Figure,
  type Stage,
} from "@/screens/operations/stock/data"
import {
  StockPanel,
  type ListKind,
  type Target,
  type View,
} from "@/screens/operations/stock/panels"
import { TwoLines } from "@/screens/operations/two-lines"
import { OrderSheet } from "@/screens/procurement/purchase-orders"

/// **Stock: one flat table, always open** (stock-options-prototype.html, A).
///
/// Pool · On hand · Seen · Last count, in the order the goods travel: On order
/// · Unidentified · Unallotted · Allotted (Unpicked · Picked · Packed ·
/// Dispatch, each by store) · Return stock · To supplier · Missing. The warehouse
/// total leaves out On order (not here yet) and Missing (not in a pool).
///
/// Five rows fold their own detail behind a chevron at the far right — On
/// order, Unidentified (by PO, its articles under each), Unallotted,
/// Over-delivery, Returns — five rows deep (five POs for Unidentified), then
/// one "View all". Everything that drills down opens in one big dialog
/// (`panels.tsx`); a purchase order opens Procurement's own sheet (`?order=`) and
/// its Edit goes to Procurement. See `data.ts` for what feeds each row.
///
/// This screen reads the CLOUD, not the DC node, so it is registered outside
/// `OperationsGate` in `screens/operations/index.tsx`.

/// How many rows an open accordion shows before "View all".
const FOLDED = 5

const monthDay = (iso: string) =>
  dateText(new Date(iso), { day: "numeric", month: "short" })

type Tier = "head" | "sub" | "leaf"

const TIER: Readonly<Record<Tier, string>> = {
  head: "bg-soft-2 font-semibold text-ink",
  sub: "bg-soft font-medium text-ink",
  leaf: "text-text",
}

/// One row of the table. `indent` is in steps of 20px from the 16px edge.
function Line({
  tier,
  indent = 0,
  label,
  pcs,
  figure,
  quiet,
  onOpen,
  expanded,
  arrow,
}: {
  tier: Tier
  indent?: number
  label: React.ReactNode
  pcs: number
  figure?: Figure
  /// Under an accordion: a "—" where there is nothing, as the prototype has.
  quiet?: boolean
  onOpen?: () => void
  /// Set on an accordion's own row: whether it is open.
  expanded?: boolean
  arrow?: boolean
}) {
  const none = <span className="text-faint">—</span>
  const dash = tier !== "leaf" || quiet === true
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
      aria-expanded={expanded}
      className={cn(
        "h-16 border-t border-hairline",
        TIER[tier],
        onOpen && "cursor-pointer transition-colors hover:bg-soft-2"
      )}
    >
      <td className="py-3.5 pr-4" style={{ paddingLeft: 16 + indent * 20 }}>
        {label}
      </td>
      <td className="px-4 text-right tabular-nums">
        {pcs > 0 ? count(pcs) : none}
      </td>
      <td className="px-4 text-right tabular-nums">
        {figure?.seen !== undefined && figure.seen !== null
          ? count(figure.seen)
          : dash && figure
            ? none
            : null}
      </td>
      <td className="px-4 text-right tabular-nums">
        {figure?.counted
          ? monthDay(figure.counted)
          : dash && figure
            ? none
            : null}
      </td>
      <td className="w-px px-4">
        {expanded !== undefined ? (
          <ChevronRight
            className={cn(
              "size-4 text-mute transition-transform duration-(--t-press) ease-(--ease-out)",
              expanded && "rotate-90"
            )}
          />
        ) : arrow ? (
          <ArrowUpRight className="size-4 text-mute" />
        ) : null}
      </td>
    </tr>
  )
}

/// The whole row is the button: 64px, spanning every column.
function ViewAll({
  rows,
  unit,
  onOpen,
}: {
  rows: number
  unit?: string
  onOpen: () => void
}) {
  return (
    <tr className="border-t border-hairline">
      <td colSpan={5} className="p-0">
        <button
          type="button"
          onClick={onOpen}
          className="flex h-16 w-full items-center justify-center font-medium text-ink transition-colors hover:bg-soft"
        >
          View all {count(rows)}
          {unit ? ` ${unit}` : ""}
        </button>
      </td>
    </tr>
  )
}

export function Stock() {
  const status = useStockStatus()
  const data = useStock()
  const [tab, setTab] = useState("stock")
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set())
  const [view, setView] = useState<View | null>(null)
  const [back, setBack] = useState<View | null>(null)
  const order = useSheet("order")
  const navigate = useAppNavigate()
  const missing = useMissingRows().rows.reduce(
    (sum, row) => sum + row.quantity,
    0
  )

  const toggle = (id: string) =>
    setFolded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  /// Open a dialog view, or a purchase order's sheet. `from` is the list it
  /// was opened out of, so Back can return to it.
  const go = (target: Target, from: View | null = null) => {
    setBack(from)
    if (target.kind === "order") {
      setView(null)
      order.open(target.id)
    } else setView(target)
  }
  const close = () => {
    setView(null)
    setBack(null)
  }
  const goBack = back
    ? () => {
        setView(back)
        setBack(null)
      }
    : undefined
  const list = (which: ListKind) => () => go({ kind: "list", which })
  const from = (target: Target) => go(target, view)

  // An accordion: its own row, then its first rows, then "View all".
  function accordion<T>(config: {
    id: string
    tier: Tier
    indent: number
    label: string
    pcs: number
    figure?: Figure
    rows: readonly T[]
    row: (one: T) => {
      key: string
      label: React.ReactNode
      pcs: number
      onOpen?: () => void
      /// Rows indented under this one (a PO's articles).
      kids?: readonly { key: string; label: React.ReactNode; pcs: number }[]
    }
    which: ListKind
    /// What "View all N" counts, when it is not plain rows.
    unit?: string
  }) {
    const isOpen = folded.has(config.id)
    const has = config.rows.length > 0
    return (
      <Fragment key={config.id}>
        <Line
          tier={config.tier}
          indent={config.indent}
          label={config.label}
          pcs={config.pcs}
          figure={
            config.figure ?? { pcs: config.pcs, seen: null, counted: null }
          }
          onOpen={has ? () => toggle(config.id) : undefined}
          expanded={has ? isOpen : undefined}
        />
        {isOpen &&
          config.rows.slice(0, FOLDED).map((one) => {
            const r = config.row(one)
            return (
              <Fragment key={r.key}>
                <Line
                  tier={r.kids ? "sub" : "leaf"}
                  indent={config.indent + 2}
                  label={r.label}
                  pcs={r.pcs}
                  figure={{ pcs: r.pcs, seen: null, counted: null }}
                  quiet
                  onOpen={r.onOpen}
                />
                {r.kids?.map((kid) => (
                  <Line
                    key={kid.key}
                    tier="leaf"
                    indent={config.indent + 3}
                    label={kid.label}
                    pcs={kid.pcs}
                    figure={{ pcs: kid.pcs, seen: null, counted: null }}
                    quiet
                  />
                ))}
              </Fragment>
            )
          })}
        {isOpen && config.rows.length > FOLDED && (
          <ViewAll
            rows={config.rows.length}
            unit={config.unit}
            onOpen={list(config.which)}
          />
        )}
      </Fragment>
    )
  }

  return (
    <PageContent>
      <PageHeader title="Stock" />

      <SubTabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "stock", label: "Stock" },
          ...(SHOW_MISSING
            ? [
                {
                  value: "missing",
                  label:
                    missing > 0 ? `Missing · ${count(missing)}` : "Missing",
                },
              ]
            : []),
        ]}
      />

      {SHOW_MISSING && tab === "missing" ? (
        <MissingList canWriteOff={false} />
      ) : status.pending ? (
        <LoadingState>Reading the stock…</LoadingState>
      ) : status.error ? (
        <ErrorState error={status.error} onRetry={status.retry} />
      ) : (
        <div className="overflow-hidden rounded-card border border-hairline bg-canvas">
          <table className="w-full border-collapse">
            <thead>
              <tr className="h-12 bg-soft text-left font-medium text-body">
                <th className="px-4 font-medium">Pool</th>
                <th className="px-4 text-right font-medium">On Hand</th>
                <th className="px-4 text-right font-medium">Seen</th>
                <th className="px-4 text-right font-medium">Last Count</th>
                <th className="w-px" />
              </tr>
            </thead>
            <tbody>
              {accordion({
                id: "order",
                tier: "head",
                indent: 0,
                label: "On order",
                pcs: data.onOrder.pcs,
                rows: data.onOrder.rows,
                which: "order",
                row: (o) => ({
                  key: o.id,
                  label: (
                    <TwoLines
                      top={<span className="font-mono">{o.poNumber}</span>}
                      bottom={`${o.supplier} · ${due(o.due)}`}
                    />
                  ),
                  pcs: o.pcs,
                  onOpen: () => go({ kind: "order", id: o.id }),
                }),
              })}

              {accordion({
                id: "unid",
                tier: "head",
                indent: 0,
                label: "Unidentified",
                pcs: data.unidentified.figure.pcs,
                figure: data.unidentified.figure,
                rows: data.unidentified.rows,
                which: "unid",
                unit: "POs",
                row: (po) => ({
                  key: po.id,
                  label: (
                    <TwoLines
                      top={<span className="font-mono">{po.poNumber}</span>}
                      bottom={po.supplier}
                    />
                  ),
                  pcs: po.pcs,
                  onOpen: po.poId
                    ? () => go({ kind: "order", id: po.poId! })
                    : undefined,
                  kids: po.lines.map((l) => ({
                    key: l.id,
                    label: l.name,
                    pcs: l.pcs,
                  })),
                }),
              })}

              {accordion({
                id: "unal",
                tier: "head",
                indent: 0,
                label: "Unallotted",
                pcs: data.unallotted.figure.pcs,
                figure: data.unallotted.figure,
                rows: data.unallotted.divisions,
                which: "unal",
                row: (d) => ({
                  key: d.code,
                  label: d.name,
                  pcs: d.pcs,
                  onOpen: () => go({ kind: "division", code: d.code }),
                }),
              })}

              <Line tier="head" label="Allotted" pcs={data.allotted} />
              {STAGES.map((s: Stage) => (
                <Fragment key={s}>
                  <Line
                    tier="sub"
                    indent={1}
                    label={STAGE_LABEL[s]}
                    pcs={data.stages[s].figure.pcs}
                    figure={data.stages[s].figure}
                    onOpen={() => go({ kind: "stage", stage: s })}
                    arrow
                  />
                  {data.stages[s].stores.map((store) => (
                    <Line
                      key={store.id}
                      tier="leaf"
                      indent={2}
                      label={store.name}
                      pcs={store.pcs}
                      onOpen={() =>
                        go({ kind: "store", storeId: store.id, stage: s })
                      }
                      arrow
                    />
                  ))}
                  {s === "picked" && data.pickArea.figure.pcs > 0 && (
                    <Line
                      tier="leaf"
                      indent={2}
                      label="Pick area"
                      pcs={data.pickArea.figure.pcs}
                      onOpen={() => go({ kind: "pick-area" })}
                      arrow
                    />
                  )}
                </Fragment>
              ))}

              <Line
                tier="head"
                label="Return stock"
                pcs={data.returnStock.figure.pcs}
                figure={data.returnStock.figure}
                onOpen={() => go({ kind: "return-stock" })}
              />
              {data.returnStock.stores.map((store) => (
                <Line
                  key={store.id}
                  tier="leaf"
                  indent={1}
                  label={store.name}
                  pcs={store.pcs}
                  onOpen={() => go({ kind: "return-stock", storeId: store.id })}
                />
              ))}

              <Line tier="head" label="To supplier" pcs={data.toSupplier} />
              {accordion({
                id: "over",
                tier: "sub",
                indent: 1,
                label: "Over-delivery",
                pcs: data.overDelivery.pcs,
                rows: data.overDelivery.rows,
                which: "over",
                row: (o) => ({
                  key: o.id,
                  label: (
                    <TwoLines
                      top={<span className="font-mono">{o.poNumber}</span>}
                      bottom={o.supplier}
                    />
                  ),
                  pcs: o.pcs,
                  onOpen: () => go({ kind: "order", id: o.poId }),
                }),
              })}
              {accordion({
                id: "returns",
                tier: "sub",
                indent: 1,
                label: "Returns",
                pcs: data.returns.pcs,
                rows: data.returns.rows,
                which: "returns",
                row: (r) => ({
                  key: r.id,
                  label: (
                    <TwoLines
                      top={<span className="font-mono">{r.number}</span>}
                      bottom={`${r.supplier} · Settle by ${r.settleBy}`}
                    />
                  ),
                  pcs: r.pcs,
                  onOpen: () => go({ kind: "return", id: r.id }),
                }),
              })}
            </tbody>
            <tfoot>
              <tr className="h-14 border-t border-hairline bg-soft font-semibold text-ink">
                <td className="px-4">Total</td>
                <td className="px-4 text-right tabular-nums">
                  {count(data.gudang)}
                </td>
                <td colSpan={3} />
              </tr>
              {SHOW_MISSING && (
                <tr
                  tabIndex={0}
                  onClick={() => setTab("missing")}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault()
                      setTab("missing")
                    }
                  }}
                  className="h-14 cursor-pointer border-t border-hairline bg-soft font-semibold text-ink transition-colors hover:bg-soft-2"
                >
                  <td className="px-4">Missing</td>
                  <td
                    className={cn(
                      "px-4 text-right tabular-nums",
                      missing > 0 && "text-warn-fg"
                    )}
                  >
                    {count(missing)}
                  </td>
                  <td colSpan={3} />
                </tr>
              )}
            </tfoot>
          </table>
        </div>
      )}

      <StockPanel
        view={view}
        data={data}
        onOpen={from}
        onBack={goBack}
        onClose={close}
      />
      <OrderSheet
        id={order.value ?? null}
        onClose={order.close}
        onEdit={(id) =>
          void navigate("/procurement/orders", { key: "edit-order", value: id })
        }
      />
    </PageContent>
  )
}
