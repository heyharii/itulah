import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Download, Printer, ChevronRight } from "lucide-react"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { ConfirmButton, SavedDialog } from "@/components/ui/dialog"
import { Input, Select } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Segmented } from "@/components/ui/segmented"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { Collapsible } from "@base-ui/react/collapsible"
import { SubTabs } from "@/components/ui/sub-tabs"
import { Tag } from "@/components/ui/tag"
import { EmptyState, Problem } from "@/components/ui/states"
import { Timeline, type TimelineEvent } from "@/components/ui/timeline"
import { count, day, money } from "@/lib/format"
import { useAppNavigate } from "@/lib/navigate"
import {
  fleetPools,
  idempotencyKey,
  inventoryKeys,
  poolAvailability,
} from "@/lib/queries/inventory"
import {
  catalogueVocabulary,
  procurementKeys,
  purchaseDestinations,
  purchaseOrderDetail,
  purchaseOrderPage,
  purchaseReturns,
} from "@/lib/queries/procurement"
import {
  REASON_LABEL,
  SETTLE_LABEL,
  STATUS_LABEL,
  closeShort,
  createSupplierReturn,
  expectsReplacement,
  isReplacementPo,
  raiseReplacementOrder,
  skuSuppliers,
  supplierReturnKeys,
  supplierReturns,
  type SettleBy,
  type SupplierReturn,
  type SupplierReturnReason,
} from "@/lib/queries/supplier-returns"
import { queryState } from "@/lib/query-state"
import { useNameOfLogin } from "@/lib/queries/hr-employees"
import { useSheet } from "@/lib/sheets"
import { cn } from "@/lib/utils"
import { sourcePoolsFor } from "@/screens/inventory/shared"
import { titled } from "@/screens/procurement/po-print"
import { termLabel } from "@/screens/procurement/shared"
import { openPrintWindow, printInto } from "@/screens/procurement/print"
import {
  groupBySupplier,
  ReturnGroups,
  usePoDates,
} from "@/screens/procurement/supplier-return-groups"
import { downloadReturnPdf } from "@/screens/procurement/return-pdf"
import {
  supplierReturnHtml,
  type PrintableNote,
} from "@/screens/procurement/return-print"
import { useActor } from "@/screens/procurement/shared"
import { useSupplierName } from "@/screens/procurement/supplier-name"

/// Buying › Return PO.
///
/// Two books in one list: returns out of HO return stock (over-delivery,
/// items that don't match the order — the supplier owes something back,
/// tracked in rupiah until nothing is owed) and over-delivery returns raised
/// from a PO (nothing comes back; they close when the Gudang hands the goods
/// over). Confirming a return of the first book issues its surat — the
/// numbered return delivery note, QR-tracked, the supplier signs against.

type Tab = "open" | "closed"
type Tone = "ok" | "warn" | "bad" | "info" | "accent" | "neutral" | "done"

/// One line of the list, whichever book it came from.
export interface Row {
  readonly id: string
  readonly number: string
  readonly supplier: string
  readonly reason: string
  readonly reference: string | null
  /// The order's id, for the link into its sheet; null where the book has none.
  readonly poId: string | null
  readonly pcs: number
  readonly settleBy: SettleBy | null
  readonly valueMinor: number
  readonly settledMinor: number
  readonly owedMinor: number
  readonly byKind: Readonly<Partial<Record<SettleBy, number>>>
  readonly status: string
  readonly tone: Tone
  readonly open: boolean
  readonly raisedAt: string
  readonly raisedBy: string
  readonly handedOverAt: string | null
  readonly lines: readonly {
    sku: string
    name: string | null
    qty: number
    cost: number
  }[]
  readonly settlements: SupplierReturn["settlements"]
  readonly closedShortReason: string | null
  readonly canCloseShort: boolean
  /// The surat issued when the return was confirmed, if the row is a
  /// cloud-book return — over-delivery rows raised from a PO have none.
  readonly letterId: string | null
  readonly letterNumber: string | null
  /// The Gudang's person in charge of the hand-over, and when the surat jalan
  /// was generated — both null until it is. Only an over-delivery return has
  /// them; the register's problem-goods returns leave through the picklist.
  readonly pic: string | null
  readonly noteAt: string | null
  /// The return itself, for the actions that raise something from it.
  readonly raw: SupplierReturn | null
}

const KIND_BAR: Record<SettleBy, string> = {
  REPLACEMENT: "bg-accent",
  REFUND: "bg-ok",
  CREDIT_NOTE: "bg-info",
}

const STATUS_TONE: Record<SupplierReturn["status"], Tone> = {
  TO_HAND_OVER: "neutral",
  WAITING: "warn",
  PARTLY_SETTLED: "accent",
  SETTLED: "ok",
  CLOSED_SHORT: "bad",
}

function fromSupplierReturn(
  r: SupplierReturn,
  supplierName: ReturnType<typeof useSupplierName>,
  person: (login: string) => string
): Row {
  const byKind: Partial<Record<SettleBy, number>> = {}
  for (const s of r.settlements) {
    byKind[s.kind] = (byKind[s.kind] ?? 0) + s.amount_minor
  }
  return {
    id: r.allotment_id,
    number: r.allotment_number,
    supplier: supplierName(r.supplier_id, r.supplier_name),
    reason: REASON_LABEL[r.reason],
    reference: null,
    poId: null,
    pcs: r.quantity,
    settleBy: r.settle_by,
    valueMinor: r.value_minor,
    settledMinor: r.settled_minor,
    owedMinor: r.owed_minor,
    byKind,
    status: STATUS_LABEL[r.status],
    tone: STATUS_TONE[r.status],
    open: !["SETTLED", "CLOSED_SHORT"].includes(r.status),
    raisedAt: r.raised_at,
    raisedBy: person(r.raised_by),
    handedOverAt: r.handed_over_at,
    lines: r.lines.map((l) => ({
      sku: l.sku_code,
      name: l.article_name,
      qty: l.quantity,
      cost: l.unit_cost_minor,
    })),
    settlements: r.settlements,
    closedShortReason: r.closed_short_reason,
    canCloseShort: ["WAITING", "PARTLY_SETTLED"].includes(r.status),
    letterId: r.letter_id,
    pic: null,
    noteAt: null,
    letterNumber: r.letter_number,
    raw: r,
  }
}

/// Rupiah settled, one colour per kind, and what is still owed.
function Settled({ row, wide }: { row: Row; wide?: boolean }) {
  if (row.settleBy === null) {
    return <span className="text-mute">None needed</span>
  }
  if (row.handedOverAt === null || row.valueMinor === 0) {
    return <span className="text-mute">—</span>
  }
  const kinds = Object.entries(row.byKind) as [SettleBy, number][]
  return (
    <span className={wide ? "block" : "block py-1"}>
      <span className="flex h-1.5 w-full max-w-48 overflow-hidden rounded-full bg-soft-2">
        {kinds.map(([kind, amount]) => (
          <span
            key={kind}
            className={KIND_BAR[kind]}
            style={{
              width: `${Math.min(100, (amount / row.valueMinor) * 100)}%`,
            }}
          />
        ))}
      </span>
      <span className="mt-1.5 block tabular-nums">
        <span className="text-ink">{money(row.settledMinor)}</span>
        {row.owedMinor > 0 && (
          <span className="text-warn-fg"> · {money(row.owedMinor)} owed</span>
        )}
      </span>
    </span>
  )
}

/// Every return the Gudang and head office know of, as one list of rows: the
/// register of supplier returns and the over-delivery returns raised from a PO.
/// Shared with the Return to supplier board, whose cards open the same sheet.
export function useReturnRows() {
  const returns = useQuery({
    queryKey: supplierReturnKeys.list(),
    queryFn: ({ signal }) => supplierReturns(signal),
  })
  const over = useQuery({
    queryKey: procurementKeys.returns(),
    queryFn: ({ signal }) => purchaseReturns(undefined, signal),
  })

  const supplierName = useSupplierName()
  const nameOfLogin = useNameOfLogin()
  /// A person as the screens write one: the full name, in Title Case — never the
  /// login ("candra") the server keeps.
  const person = (login: string) => titled(nameOfLogin(login))
  const all = useMemo<Row[]>(() => {
    const own = (returns.data ?? []).map((r) =>
      fromSupplierReturn(r, supplierName, person)
    )
    const excess = (over.data ?? []).map<Row>((r) => ({
      id: r.return_id,
      number: r.return_number,
      supplier: supplierName(r.supplier_id, r.supplier_name),
      reason: "Over-delivery",
      reference: r.po_number,
      poId: r.purchase_order_id,
      pcs: r.quantity,
      settleBy: null,
      valueMinor: 0,
      settledMinor: 0,
      owedMinor: 0,
      byKind: {},
      status: r.status === "OPEN" ? "To hand over" : "Completed",
      tone: r.status === "OPEN" ? "neutral" : "done",
      open: r.status === "OPEN",
      raisedAt: r.raised_at,
      raisedBy: person(r.raised_by),
      handedOverAt: r.handed_over_at,
      lines: r.lines.map((l) => ({
        sku: l.article_code,
        name: l.article_name,
        qty: l.quantity,
        cost: 0,
      })),
      settlements: [],
      closedShortReason: null,
      canCloseShort: false,
      letterId: null,
      pic: r.note_pic ?? null,
      noteAt: r.note_generated_at ?? null,
      letterNumber: null,
      raw: null,
    }))
    return [...own, ...excess]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [returns.data, over.data, supplierName, nameOfLogin])
  return { all, returns, over }
}

export function SupplierReturns() {
  const [tab, setTab] = useState<Tab>("open")
  const [asking, setAsking] = useState(false)
  /// The return the confirm minted, held in the receipt dialog until read.
  const [savedReturn, setSavedReturn] = useState<string | null>(null)
  const sheet = useSheet("allotment")

  const { all, returns } = useReturnRows()

  const owed = all.reduce((sum, row) => sum + row.owedMinor, 0)
  const rows = useMemo(
    () => all.filter((row) => row.open === (tab === "open")),
    [all, tab]
  )
  const opened = all.find((row) => row.id === sheet.value) ?? null

  const poDates = usePoDates()
  const groups = useMemo(() => groupBySupplier(rows, poDates), [rows, poDates])

  if (asking)
    return (
      <>
        <NewReturn
          onDone={() => setAsking(false)}
          onConfirmed={setSavedReturn}
        />
        <SavedDialog
          open={savedReturn !== null}
          onOpenChange={(next) => {
            if (!next) setSavedReturn(null)
          }}
          title={savedReturn ?? ""}
        />
      </>
    )

  const openCount = all.filter((row) => row.open).length

  return (
    <PageContent>
      <PageHeader
        title="Return PO"
        actions={
          <Button variant="primary" onClick={() => setAsking(true)}>
            New return
          </Button>
        }
      />

      <div className="flex flex-wrap items-end justify-between gap-x-6">
        <SubTabs
          value={tab}
          onChange={(next) => setTab(next as Tab)}
          tabs={[
            { value: "open", label: `Open ${count(openCount)}` },
            {
              value: "closed",
              label: `Completed ${count(all.length - openCount)}`,
            },
          ]}
        />
        <span className="mb-3.5 text-body">
          Suppliers still owe{" "}
          <span className="font-semibold text-ink tabular-nums">
            {money(owed)}
          </span>
        </span>
      </div>

      {queryState(returns, {
        loading: "Reading the returns…",
        render: () =>
          groups.length === 0 ? (
            <EmptyState>Nothing here.</EmptyState>
          ) : (
            // A card per supplier, as Operations draws it (owner, 2026-10-05),
            // with who is in charge and where each return stands. Reading
            // only: the surat jalan is made and confirmed in Operations.
            <ReturnGroups
              groups={groups}
              selected={sheet.value}
              onOpen={sheet.open}
              showPic={false}
            />
          ),
      })}

      <ReturnSheet row={opened} onClose={sheet.close} />
    </PageContent>
  )
}

/// Returns as one note for their supplier, made today. Prepared by whoever
/// raised the first of them.
export function noteOf(
  returns: readonly Row[],
  pic?: string | null
): PrintableNote {
  return {
    supplier: returns[0]?.supplier ?? "",
    date: new Date().toISOString(),
    pic,
    returns: returns.map((one) => ({
      number: one.number,
      reason: one.reason,
      reference: one.reference,
      poId: one.poId,
      lines: one.lines,
    })),
  }
}

/// Print the note. Call it straight from the click: a window opened after an
/// await is blocked as a pop-up.
export function printReturnNote(note: PrintableNote) {
  const view = openPrintWindow()
  if (view !== null) printInto(view, supplierReturnHtml(note))
}

export function ReturnSheet({
  row,
  onClose,
  extra,
  form,
}: {
  row: Row | null
  onClose: () => void
  /// A step this return can take where the sheet is opened — the board's
  /// "Confirm handed over" — standing in the foot beside Close short.
  extra?: React.ReactNode
  /// A form at the head of the sheet's body — the board's Person in Charge,
  /// asked before the note can be generated.
  form?: React.ReactNode
}) {
  const client = useQueryClient()
  /// The writes this sheet made, held in the receipt dialog until they are
  /// read. The sheet stays mounted between openings, so the state survives.
  const [saved, setSaved] = useState<string | null>(null)
  const short = useMutation({
    mutationFn: (reason: string) => closeShort(row!.id, reason),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: supplierReturnKeys.all })
      setSaved("Closed short")
    },
  })

  const raw = row?.raw ?? null
  const go = useAppNavigate()
  const destinations = useQuery({
    queryKey: procurementKeys.destinations(),
    queryFn: ({ signal }) => purchaseDestinations(signal),
    enabled: raw !== null && expectsReplacement(raw),
  })
  const actor = useActor()
  // The orders raised for this return's replacement, found by their number.
  const replacements = useQuery({
    queryKey: procurementKeys.ordersPage({ q: raw?.allotment_number }),
    queryFn: ({ signal }) =>
      purchaseOrderPage({ q: raw!.allotment_number }, signal),
    enabled: raw !== null,
    select: (page) =>
      page.rows.filter((one) =>
        isReplacementPo(one.po_number, raw!.allotment_number)
      ),
  })
  const onOrder = replacements.data ?? []
  const waitingOn = onOrder.some(
    (one) =>
      one.lifecycle === "ACTIVE" || one.lifecycle === "PARTIALLY_RECEIVED"
  )
  const expect = useMutation({
    mutationFn: () => {
      const site =
        destinations.data?.find((one) => one.node_role === "DC") ??
        destinations.data?.[0]
      if (site === undefined) throw new Error("No warehouse to deliver to.")
      return raiseReplacementOrder(raw!, site.site_id, actor, onOrder.length)
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: procurementKeys.orders() })
      setSaved("Replacement expected")
    },
  })

  /// The order the return came from, for what each item is filed under: the
  /// return line knows its code and quantity, the PO line knows its division
  /// and tags.
  const order = useQuery({
    queryKey: procurementKeys.order(row?.poId ?? ""),
    queryFn: ({ signal }) => purchaseOrderDetail(row!.poId!, signal),
    enabled: !!row?.poId,
  })
  const vocabulary = useQuery({
    queryKey: procurementKeys.vocabulary(),
    queryFn: ({ signal }) => catalogueVocabulary(signal),
    staleTime: 30 * 60 * 1000,
  })
  const history: TimelineEvent[] = []
  if (row) {
    history.push({
      id: "raised",
      title: "Raised",
      detail: row.raisedBy,
      at: day(row.raisedAt),
      state: "done",
    })
    if (row.letterId) {
      history.push({
        id: "surat",
        title: `Surat ${row.letterNumber ?? "issued"}`,
        detail: "Return delivery note for the supplier to sign",
        at: day(row.raisedAt),
        state: "done",
      })
    }
    history.push(
      row.handedOverAt
        ? {
            id: "handed",
            title: "Handed over",
            at: day(row.handedOverAt),
            state: "done",
          }
        : { id: "handed", title: "To hand over", state: "current" }
    )
    onOrder.forEach((one) => {
      history.push({
        id: one.purchase_order_id,
        title: `Replacement on PO ${one.po_number}`,
        at: day(one.issued_at),
        state:
          one.lifecycle === "ACTIVE" || one.lifecycle === "PARTIALLY_RECEIVED"
            ? "current"
            : "done",
      })
    })
    row.settlements.forEach((s, index) => {
      history.push({
        id: `s${index}`,
        title:
          s.kind === "REPLACEMENT"
            ? `Replacement · ${count(s.quantity)} pcs · ${money(s.amount_minor)}`
            : `${SETTLE_LABEL[s.kind]} · ${money(s.amount_minor)}`,
        detail: [s.reference, s.recorded_by].filter(Boolean).join(" · "),
        at: day(s.recorded_at),
        state: "done",
      })
    })
    if (row.settleBy === null && row.handedOverAt) {
      history.push({ id: "end", title: "Closed", state: "done" })
    } else if (row.status === "Settled") {
      history.push({ id: "end", title: "Settled", state: "done" })
    } else if (row.status === "Closed short") {
      history.push({
        id: "end",
        title: "Closed short",
        detail: row.closedShortReason,
        state: "done",
      })
    }
  }

  return (
    <>
      <Sheet
        open={row !== null}
        onOpenChange={(next) => !next && onClose()}
        title={row?.supplier ?? "Return"}
        id={row?.number}
        // Number over supplier, and the kind of return as a tag beside them
        // (owner, 2026-10-05). The status is the stamp in the body and the
        // pieces and value are in the table, so neither is said again here.
        badge={
          row && (
            <Tag tone={row.reason === "Over-delivery" ? "warn" : "bad"}>
              {titled(row.reason.replace(/-/g, " "))}
            </Tag>
          )
        }
        actions={
          // With a step of its own in the foot (the board's Generate / Print /
          // Download / Confirm) the note's buttons live there instead.
          row &&
          extra === undefined && (
            <>
              <Button
                variant="ghost"
                onClick={() => printReturnNote(noteOf([row]))}
              >
                <Printer />
                Print
              </Button>
              <Button
                variant="ghost"
                onClick={() => downloadReturnPdf(noteOf([row]))}
              >
                <Download />
                Download
              </Button>
            </>
          )
        }
        footer={
          extra !== undefined && !row?.canCloseShort ? (
            <div className="flex items-center justify-end gap-3">{extra}</div>
          ) : row?.canCloseShort ? (
            <div className="flex items-center justify-between gap-3">
              <span className="text-body tabular-nums">
                {money(row.owedMinor)} owed
              </span>
              <span className="flex items-center gap-3">
                {raw !== null && expectsReplacement(raw) && !waitingOn && (
                  <Button
                    variant="ghost"
                    pending={expect.isPending}
                    disabled={replacements.isPending || destinations.isPending}
                    onClick={() => expect.mutate()}
                  >
                    Expect replacement
                  </Button>
                )}
                <ConfirmButton
                  label="Close Short"
                  variant="danger"
                  tone="danger"
                  title={`Close ${row.number} Short?`}
                  description={`${money(row.owedMinor)} owed is written off.`}
                  confirmLabel="Close Short"
                  reason={{ label: "Reason" }}
                  pending={short.isPending}
                  onConfirm={(reason) => short.mutateAsync(reason)}
                />
              </span>
            </div>
          ) : undefined
        }
        width="table"
      >
        {row && (
          <div className="relative flex flex-col gap-6">
            {/* The stamp the order sheet wears, over the corner once the return
                is done: green for completed, and for one closed short. It takes
                no row of its own. */}
            {!row.open && (
              <span
                aria-hidden
                className="pointer-events-none absolute top-1 right-2 z-10 inline-block -rotate-6 rounded-inner border-2 border-ok-fg px-3 py-0.5 text-[1.125rem] font-bold tracking-[0.14em] text-ok-fg opacity-40 select-none"
              >
                {row.status === "Closed short" ? "CLOSED SHORT" : "COMPLETED"}
              </span>
            )}
            {form}
            <Problem error={expect.error} />
            <Facts>
              <Fact term="Person in Charge">
                {row.pic === null ? "—" : titled(row.pic)}
              </Fact>
              {/* How the supplier settles, said only where one was chosen: a
                  "None" under it told nobody anything. */}
              {row.settleBy && (
                <Fact term="Settle by">{SETTLE_LABEL[row.settleBy]}</Fact>
              )}
              {row.reference && (
                <Fact term="PO">
                  {row.poId ? (
                    <button
                      type="button"
                      onClick={() =>
                        go("/procurement/orders", {
                          key: "order",
                          value: row.poId!,
                        })
                      }
                      className="font-mono text-accent underline-offset-2 hover:underline"
                    >
                      {row.reference}
                    </button>
                  ) : (
                    row.reference
                  )}
                </Fact>
              )}
              {row.letterId && (
                <Fact term="Surat">
                  <button
                    type="button"
                    onClick={() =>
                      go("/letters", { key: "letter", value: row.letterId! })
                    }
                    className="font-mono text-accent underline-offset-2 hover:underline"
                  >
                    {row.letterNumber ?? "Open surat"}
                  </button>
                </Fact>
              )}
              {row.settleBy !== null && row.handedOverAt !== null && (
                <Fact term="Settled">
                  <Settled row={row} wide />
                </Fact>
              )}
            </Facts>

            <div>
              <h4 className="mb-3 text-card-title font-semibold text-ink">
                Items
              </h4>
              <Card className="overflow-hidden">
                <table className="w-full border-collapse text-[0.9375rem]">
                  <thead>
                    <tr className="h-11 bg-soft text-left text-[0.875rem] font-medium text-body">
                      <th className="pl-4">SKU</th>
                      <th className="text-right">Pcs</th>
                      <th className="pr-4 text-right">Value</th>
                    </tr>
                  </thead>
                  <tbody className="[&_td]:py-3.5">
                    {row.lines.map((l) => (
                      <tr key={l.sku} className="border-t border-hairline">
                        <td className="pl-4">
                          <span className="block leading-snug font-medium text-ink">
                            {l.name ?? l.sku}
                          </span>
                          {(() => {
                            const line = order.data?.lines.find(
                              (one) => one.article_code === l.sku
                            )
                            if (!line) return null
                            const tags = line.tags ?? []
                            if (!line.division_code && tags.length === 0)
                              return null
                            return (
                              <span className="mt-1.5 flex flex-wrap gap-1.5">
                                {line.division_code && (
                                  <Tag>
                                    {termLabel(
                                      vocabulary.data?.divisions,
                                      line.division_code
                                    )}
                                  </Tag>
                                )}
                                {tags.map((tag) => (
                                  <Tag key={tag}>
                                    {termLabel(vocabulary.data?.tags, tag)}
                                  </Tag>
                                ))}
                              </span>
                            )
                          })()}
                        </td>
                        <td className="text-right tabular-nums">
                          {count(l.qty)}
                        </td>
                        <td className="pr-4 text-right tabular-nums">
                          {l.cost > 0 ? money(l.cost * l.qty) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            </div>

            <ActivityFold events={history} />
          </div>
        )}
      </Sheet>
      <SavedDialog
        open={saved !== null}
        onOpenChange={(next) => {
          if (!next) setSaved(null)
        }}
        title={saved ?? ""}
      />
    </>
  )
}

// ---------------------------------------------------------------------------
// New return
// ---------------------------------------------------------------------------

/// Items out of HO return stock, for one supplier. Over-delivery is raised
/// from the PO sheet and is not offered here.
function NewReturn({
  onDone,
  onConfirmed,
}: {
  onDone: () => void
  /// The confirm went through; the receipt is the caller's to show — this
  /// page unmounts the moment its `onDone` walks back to the book.
  onConfirmed: (said: string) => void
}) {
  const client = useQueryClient()
  const [supplier, setSupplier] = useState("")
  const [reason, setReason] = useState<SupplierReturnReason>("OVER_DELIVERY")
  const [settleBy, setSettleBy] = useState<SettleBy>("REPLACEMENT")
  const [poolId, setPoolId] = useState("")
  const [quantities, setQuantities] = useState<Record<string, string>>({})

  const fleet = useQuery({
    queryKey: inventoryKeys.fleet(),
    queryFn: ({ signal }) => fleetPools(signal),
  })
  // HO return stock; if the site keeps none apart, whatever may be returned.
  const sources = useMemo(() => {
    const usable = sourcePoolsFor("RETURN_TO_SUPPLIER", fleet.data?.items ?? [])
    const returns = usable.filter((p) => p.pool_code === "RETURN")
    return returns.length > 0 ? returns : usable
  }, [fleet.data])
  const pool = sources.find((p) => p.id === poolId) ?? sources[0] ?? null

  const stock = useQuery({
    queryKey: inventoryKeys.poolAvailability(pool?.id ?? ""),
    queryFn: ({ signal }) => poolAvailability(pool!.id, {}, signal),
    enabled: pool !== null,
  })
  const items = useMemo(
    () => (stock.data?.items ?? []).filter((item) => item.on_hand_qty > 0),
    [stock.data]
  )
  const codes = useMemo(
    () => items.map((item) => item.sku_code).sort(),
    [items]
  )
  const suppliers = useQuery({
    queryKey: supplierReturnKeys.skuSuppliers(codes),
    queryFn: ({ signal }) => skuSuppliers(codes, signal),
    enabled: codes.length > 0,
  })

  const nameOf = useSupplierName()
  const owners =
    suppliers.data ?? new Map<string, { id: string; name: string }>()
  const supplierList = useMemo(() => {
    const seen = new Map<string, string>()
    for (const item of items) {
      const owner = owners.get(item.sku_code)
      if (owner) seen.set(owner.id, nameOf(owner.id, owner.name))
    }
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, suppliers.data, nameOf])
  const goods = items.filter(
    (item) => owners.get(item.sku_code)?.id === supplier
  )

  const lines = goods
    .map((item) => ({
      item,
      qty: Math.floor(Number(quantities[item.sku_code] ?? 0)),
    }))
    .filter((one) => one.qty > 0 && one.qty <= one.item.on_hand_qty)
  const total = lines.reduce((sum, one) => sum + one.qty, 0)

  const create = useMutation({
    mutationFn: () =>
      createSupplierReturn(
        {
          supplier_id: supplier,
          reason,
          settle_by: settleBy,
          source_pool_id: pool!.id,
          lines: lines.map((one) => ({
            sku_code: one.item.sku_code,
            quantity: one.qty,
          })),
        },
        idempotencyKey()
      ),
    onSuccess: (raised) => {
      void client.invalidateQueries({ queryKey: supplierReturnKeys.all })
      void client.invalidateQueries({ queryKey: inventoryKeys.fleet() })
      // Confirming IS the act of issuing the surat: the number on the
      // receipt is the paper the supplier will sign.
      onConfirmed(
        raised.letter_number !== null
          ? `Return confirmed · surat ${raised.letter_number}`
          : "Return confirmed"
      )
      onDone()
    },
  })

  const pcsBySupplier = new Map<string, number>()
  for (const item of items) {
    const owner = owners.get(item.sku_code)
    if (owner) {
      pcsBySupplier.set(
        owner.id,
        (pcsBySupplier.get(owner.id) ?? 0) + item.on_hand_qty
      )
    }
  }

  return (
    <PageContent>
      <PageHeader
        title="New Return PO"
        actions={
          <Button variant="quiet" onClick={onDone}>
            Back
          </Button>
        }
      />

      <Problem error={create.error} className="mb-3" />

      <div className="grid items-start gap-4 lg:grid-cols-[17rem_minmax(0,1fr)]">
        <Card className="flex flex-col gap-1 p-1.5">
          {supplierList.length === 0 && (
            <EmptyState>
              {stock.isPending || suppliers.isPending
                ? "Reading the stock…"
                : "Nothing in return stock."}
            </EmptyState>
          )}
          {supplierList.map(([id, name]) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                setSupplier(id)
                setQuantities({})
              }}
              className={cn(
                "flex flex-col rounded-inner px-3 py-3 text-left transition-colors",
                id === supplier ? "bg-accent-bg" : "hover:bg-soft"
              )}
            >
              <span
                className={cn(
                  "font-medium",
                  id === supplier ? "text-accent" : "text-ink"
                )}
              >
                {name}
              </span>
              <span className="mt-1 text-mute">
                {count(pcsBySupplier.get(id) ?? 0)} in return stock
              </span>
            </button>
          ))}
        </Card>

        <div className="min-w-0">
          {supplier !== "" && (
            <>
              <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-3">
                <span className="text-body">Why</span>
                <Segmented
                  value={reason}
                  onChange={setReason}
                  options={[
                    { value: "OVER_DELIVERY", label: "Over-delivery" },
                    {
                      value: "ITEM_MISMATCH",
                      label: "Items don't match the order",
                    },
                  ]}
                />
                {sources.length > 1 && (
                  <div className="w-56">
                    <Select
                      aria-label="Taken from"
                      value={pool?.id ?? ""}
                      onChange={(next) => {
                        setPoolId(next)
                        setQuantities({})
                      }}
                    >
                      {sources.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.label}
                        </option>
                      ))}
                    </Select>
                  </div>
                )}
              </div>

              <Card className="overflow-hidden">
                {goods.length === 0 ? (
                  <EmptyState>
                    Nothing of this supplier in return stock.
                  </EmptyState>
                ) : (
                  <table className="w-full border-collapse text-body">
                    <thead>
                      <tr className="h-12 border-b border-hairline bg-soft text-left text-[0.875rem] font-medium text-body">
                        <th className="pl-4">Items</th>
                        <th className="text-right">Available</th>
                        <th className="pr-4 text-right">To Return</th>
                      </tr>
                    </thead>
                    <tbody className="[&_td]:py-3.5">
                      {goods.map((item) => (
                        <tr
                          key={item.sku_id}
                          className="h-16 border-b border-hairline last:border-b-0"
                        >
                          <td className="pl-4">
                            <span className="block leading-snug font-medium text-ink">
                              {item.article_name}
                            </span>
                            <span className="mt-1 block font-mono text-[0.875rem] text-mute">
                              {item.sku_code}
                            </span>
                          </td>
                          <td className="text-right tabular-nums">
                            {count(item.on_hand_qty)}
                          </td>
                          <td className="w-36 pr-4">
                            <Input
                              inputMode="numeric"
                              className="text-right"
                              aria-label={`Return ${item.sku_code}`}
                              value={quantities[item.sku_code] ?? ""}
                              onChange={(event) =>
                                setQuantities((was) => ({
                                  ...was,
                                  [item.sku_code]: event.target.value.replace(
                                    /\D/g,
                                    ""
                                  ),
                                }))
                              }
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Card>

              <h4 className="mt-6 mb-3 text-card-title font-semibold text-ink">
                Settle by
              </h4>
              <Segmented
                value={settleBy}
                onChange={setSettleBy}
                options={[
                  { value: "REPLACEMENT", label: "Replacement" },
                  { value: "REFUND", label: "Refund" },
                  { value: "CREDIT_NOTE", label: "Credit note" },
                ]}
              />
            </>
          )}
        </div>
      </div>

      <div className="mt-5 flex items-center justify-between gap-4">
        <span className="text-body tabular-nums">{count(total)} pcs</span>
        <Button
          variant="primary"
          pending={create.isPending}
          disabled={total === 0 || pool === null}
          onClick={() => create.mutate()}
        >
          {create.isPending ? "Confirming…" : "Confirm"}
        </Button>
      </div>
    </PageContent>
  )
}

/// What was done to the return, folded away until it is asked for — the same
/// "Activity" line every record sheet ends with, closed when the sheet opens
/// (owner, 2026-10-05).
function ActivityFold({ events }: { events: TimelineEvent[] }) {
  return (
    <Collapsible.Root>
      <Collapsible.Trigger className="group flex w-full items-center gap-1.5 border-t border-hairline pt-3.5 text-left text-[0.875rem] font-medium text-body transition-colors hover:text-ink">
        <ChevronRight className="size-3.5 text-line-ico transition-transform duration-150 group-data-[panel-open]:rotate-90" />
        Activity
        {events.length > 0 && (
          <span className="text-mute tabular-nums">{events.length}</span>
        )}
      </Collapsible.Trigger>
      <Collapsible.Panel className="overflow-hidden pt-3">
        <Timeline events={events} />
      </Collapsible.Panel>
    </Collapsible.Root>
  )
}
