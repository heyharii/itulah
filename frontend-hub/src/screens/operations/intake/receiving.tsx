import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Plus, X } from "lucide-react"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useEffect, useMemo, useRef, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { SavedDialog } from "@/components/ui/dialog"
import { DataTable } from "@/components/ui/data-table"
import { Input, Select } from "@/components/ui/field"
import {
  IntakeHeader,
  useIntakeSearch,
} from "@/screens/operations/intake/header"
import { ROOMY } from "@/screens/operations/roomy"
import { TwoLines } from "@/screens/operations/two-lines"
import {
  SupplierName,
  useSupplierName,
} from "@/screens/procurement/supplier-name"
import { Sheet } from "@/components/ui/sheet"
import { EmptyState, Problem } from "@/components/ui/states"
import { dc } from "@/lib/api"
import { wholeProduct } from "@/lib/decimal"
import { count, label, recentMoment } from "@/lib/format"
import {
  procurementKeys,
  purchaseOrderDetail,
  purchaseOrderPage,
} from "@/lib/queries/procurement"
import { keys } from "@/lib/operations/keys"
import { queryState } from "@/lib/query-state"
import { cn } from "@/lib/utils"
import { useEdgeActor } from "@/lib/edge-session"
import { useNameOfLogin } from "@/lib/queries/hr-employees"
import { titled } from "@/screens/procurement/po-print"
import { useSheet } from "@/lib/sheets"
import { tableSetup, type TableSetup } from "@/lib/table"
import { idempotencyKey } from "@itulah/contract/client"
import type {
  PurchaseCountAwaitingVerification,
  PurchaseWorkLine,
} from "@itulah/contract"

/// **Receiving** — the loading bay, as one list of orders.
///
/// The station used to be four screens: a delivery was opened, counted on a
/// second screen, verified on a third, and goods without an order arrived on a
/// fourth. What a person on the bay actually has in front of them is a lorry
/// against an order, so the list here is **the orders this DC is still owed**
/// and the work happens in a sheet beside the row.
///
/// The three-step ceremony survives, because it is the control that makes a
/// delivery evidence rather than paperwork:
///
///   1. **Count receive** — write down what physically arrived. The sheet
///      never shows the ordered quantity: a count taken while looking at the
///      number it is supposed to produce confirms the paperwork and proves
///      nothing. The delivery document is opened underneath, not by hand.
///   2. **Review** — not here. Whoever raised the PO reviews the count, from
///      Procurement › Purchase orders (`procurement/count-review.tsx`). This list
///      only says that a count is in and waiting for them.
///
/// Whoever raised the PO may count it too, and one person may count and accept
/// (owner, 2026-10-05): which of the two a caller may do is a permission, not
/// two names. An exact count is received at once, whoever took it.
export interface OrderRow {
  readonly po_number: string
  readonly supplier_id: string
  readonly supplier_name: string | null
  /// Lines still owed against this order.
  readonly lines: readonly PurchaseWorkLine[]
  /// Counts on this order waiting for a second pair of eyes.
  readonly awaiting: readonly PurchaseCountAwaitingVerification[]
}

/// The latest of the counts waiting on an order: who counted it and when are
/// read from that one, and the pieces are all of them added.
function latestOf(
  awaiting: readonly PurchaseCountAwaitingVerification[]
): PurchaseCountAwaitingVerification {
  return awaiting.reduce((a, b) => (b.counted_at > a.counted_at ? b : a))
}

/// The count in one cell: the pieces, and under them who counted and when.
function CountedCell({
  awaiting,
}: {
  awaiting: readonly PurchaseCountAwaitingVerification[]
}) {
  const nameOfLogin = useNameOfLogin()
  const latest = latestOf(awaiting)
  return (
    <span className="flex flex-col items-end leading-5 whitespace-nowrap tabular-nums">
      <span className="font-medium text-ink">
        {`${count(awaiting.reduce((sum, one) => sum + one.counted_quantity, 0))} pcs`}
      </span>
      {/* A login can be 32 characters, and 32 characters and a time are wider
          than the column: ellipsis at the end of the NAME (the time is what
          is compared across rows), the whole line on hover. */}
      <span
        className="flex max-w-[16.5rem] text-mute"
        title={`${titled(nameOfLogin(latest.counted_by))} · ${recentMoment(latest.counted_at)}`}
      >
        <span className="min-w-0 truncate">
          {titled(nameOfLogin(latest.counted_by))}
        </span>
        <span className="shrink-0">
          {" · "}
          {recentMoment(latest.counted_at)}
        </span>
      </span>
    </span>
  )
}

/// Orders with a button to press — still to count — lead the list.
const TO_COUNT_FIRST = { id: "to-count", desc: false } as const

export function Receiving() {
  const counting = useSheet("delivery")
  const search = useIntakeSearch()
  const nameOf = useSupplierName()
  const [sorting, setSorting] = useState<SortingState>([
    { id: "po_number", desc: false },
  ])

  // `useSheet` hands back a fresh object every render, so the opener can not
  // be a memo dependency: columns built from it would be rebuilt on every
  // render, and a table rebuilt on every render is one that loses what the
  // user was doing to it. The button reads the current one out of a ref
  // instead, and the columns are built once.
  const openers = useRef({ count: counting.open })
  useEffect(() => {
    openers.current = { count: counting.open }
  })

  const work = useQuery({
    queryKey: keys.purchaseWork(),
    queryFn: ({ signal }) => dc.purchaseWork(signal),
    // New orders arrive while the page is open: look again while it is seen.
    refetchInterval: 10_000,
    refetchOnWindowFocus: true,
  })
  const queue = useQuery({
    queryKey: keys.verifyQueue(),
    queryFn: ({ signal }) => dc.countsAwaitingVerification(signal),
    refetchInterval: 10_000,
    refetchOnWindowFocus: true,
  })

  // One row per order, built from the two lists the node answers with. The
  // work list is the spine — an order leaves it when nothing is owed on it any
  // more — but a count awaiting a verifier is joined on rather than looked up,
  // so the button on the row can say which of the two jobs is waiting.
  const all = useMemo<OrderRow[]>(() => {
    const byOrder = new Map<string, OrderRow>()
    for (const line of work.data ?? []) {
      const found = byOrder.get(line.po_number)
      if (found) {
        byOrder.set(line.po_number, {
          ...found,
          lines: [...found.lines, line],
        })
      } else {
        byOrder.set(line.po_number, {
          po_number: line.po_number,
          supplier_id: line.supplier_id,
          supplier_name: line.supplier_name,
          lines: [line],
          awaiting: [],
        })
      }
    }
    for (const waiting of queue.data ?? []) {
      const found = byOrder.get(waiting.po_number)
      byOrder.set(waiting.po_number, {
        po_number: waiting.po_number,
        supplier_id: found?.supplier_id ?? waiting.supplier_id,
        supplier_name: found?.supplier_name ?? null,
        lines: found?.lines ?? [],
        awaiting: [...(found?.awaiting ?? []), waiting],
      })
    }
    return [...byOrder.values()]
  }, [work.data, queue.data])
  // What the search asks for: an order by its number or its supplier's name.
  const rows = useMemo(
    () =>
      search.needle === ""
        ? all
        : all.filter(
            (row) =>
              row.po_number.toLowerCase().includes(search.needle) ||
              nameOf(row.supplier_id, row.supplier_name)
                .toLowerCase()
                .includes(search.needle)
          ),
    [all, search.needle, nameOf]
  )

  const columns = useMemo<ColumnDef<TableSetup, OrderRow>[]>(
    () => [
      {
        // The order as the PO list draws it: the supplier, and its number under
        // it. Sorted by the number, as the screen has always opened.
        id: "po_number",
        accessorFn: (row: OrderRow) => row.po_number,
        header: "PO",
        size: 320,
        meta: { card: "title", grow: 320 },
        cell: ({ row }) => {
          // The buyer sent a count back: their reason, under the order.
          const reason = row.original.lines.find(
            (line) => line.recount_reason !== null
          )?.recount_reason
          return (
            <span className="flex min-w-0 flex-col gap-0.5 py-1 leading-5">
              <span className="block truncate font-medium text-ink">
                <SupplierName
                  code={row.original.supplier_id}
                  name={row.original.supplier_name}
                />
              </span>
              <span className="font-mono text-id text-mute">
                {row.original.po_number}
              </span>
              {reason ? (
                <span className="block truncate text-body">
                  {`“${reason}”`}
                </span>
              ) : null}
            </span>
          )
        },
      },
      {
        // How many articles the order still owes — never how many pieces:
        // the count is blind, and an ordered quantity on the list would hand
        // the checker the number the count is meant to produce.
        id: "items",
        accessorFn: (row: OrderRow) => row.lines.length,
        header: "Items",
        size: 100,
        meta: { align: "right", card: "metric" },
        cell: ({ row }) => count(row.original.lines.length),
      },
      {
        // One column for the count: what was counted, who and when, once it is
        // counted; the Count receive button while it is not (owner, 2026-10-05).
        id: "count",
        accessorFn: (row: OrderRow) =>
          row.awaiting.reduce((sum, one) => sum + one.counted_quantity, 0),
        header: "Count",
        size: 300,
        meta: { align: "right", card: "status" },
        cell: ({ row }) => {
          const order = row.original
          if (order.awaiting.length > 0)
            return <CountedCell awaiting={order.awaiting} />
          const again = order.lines.some((line) => line.recount_reason !== null)
          return (
            <Button
              variant="primary"
              // Soft blue capsule on a phone, as Review Count is on the order
              // list: the card's status, not a second solid button.
              className="max-md:h-7 max-md:rounded-full max-md:bg-accent-bg max-md:px-3 max-md:text-[0.875rem] max-md:text-accent max-md:hover:bg-accent-bg/70 max-md:pointer-coarse:h-7 max-md:pointer-coarse:px-3"
              onClick={(event) => {
                event.stopPropagation()
                openers.current.count(order.po_number)
              }}
            >
              {again ? "Count again" : "Count receive"}
            </Button>
          )
        },
      },
      {
        // Never drawn, only sorted on: orders still to count lead the list
        // whatever the headings sort by.
        id: TO_COUNT_FIRST.id,
        accessorFn: (row: OrderRow) => (row.awaiting.length === 0 ? 0 : 1),
        header: "",
        enableHiding: false,
      },
    ],
    []
  )

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns,
        getRowId: (row: OrderRow) => row.po_number,
        // The hidden key leads whatever was chosen, and is taken back out of
        // anything the table hands back.
        state: {
          sorting: [TO_COUNT_FIRST, ...sorting],
          columnVisibility: { [TO_COUNT_FIRST.id]: false },
        },
        onSortingChange: (
          next: SortingState | ((prev: SortingState) => SortingState)
        ) =>
          setSorting((was) =>
            (typeof next === "function"
              ? next([TO_COUNT_FIRST, ...was])
              : next
            ).filter((one) => one.id !== TO_COUNT_FIRST.id)
          ),
      }),
      [rows, columns, sorting]
    )
  )

  return (
    <PageContent>
      <IntakeHeader
        tab="orders"
        search={search}
        searchLabel="Search Orders"
        table={table}
      />

      <Card className="overflow-hidden">
        {queryState(work, {
          loading: "Reading the orders…",
          render: () =>
            rows.length === 0 ? (
              <EmptyState>
                {all.length === 0 ? "Nothing to count." : "No orders match."}
              </EmptyState>
            ) : (
              <DataTable<OrderRow>
                table={table}
                touch
                onRowClick={(row) => {
                  if (row.awaiting.length === 0) counting.open(row.po_number)
                }}
                isSelected={(row) => row.po_number === counting.value}
                pageScroll
                cardSort={false}
                className={ROOMY}
              />
            ),
        })}
      </Card>

      <CountSheet
        order={rows.find((row) => row.po_number === counting.value) ?? null}
        open={counting.value !== undefined}
        onClose={counting.close}
      />
    </PageContent>
  )
}

/// The count sheet's four tracks — item, the amounts, the total, and what of
/// it is not the ordered article — shared by its header and every row so the
/// columns hold. The amounts track is a fixed width, not `auto`: each row is
/// its own grid, and an `auto` track sized itself to whatever that row held,
/// so the header's "Counted" sat over nothing. 15.25rem is one amount's
/// controls: the figure (5rem), the unit (7rem) and the remove slot (2.25rem),
/// with their two gaps.
///
/// On a phone the three do not fit beside each other: the item and its total
/// share the first line, and the amounts take the whole of the line under it.
const COUNT_ROW =
  "grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 gap-y-2 px-4 sm:grid-cols-[minmax(0,1fr)_17rem_7rem]"

/// A column heading as every hub table sets one (`DataTable`): sentence case,
/// medium, the quiet body colour — not the old mono micro-caps.
const COUNT_HEAD = "text-eyebrow font-medium whitespace-nowrap text-body"

/// One amount of a count, in one unit.
type CountPart = { quantity: string; unit: string }

/// Counting an order, blind.
///
/// No ordered quantity, no earlier count, no progress against a target — the
/// wire does not carry them here either (`expected_stock_units` is null on this
/// view and populated only for the verifier).
///
/// The delivery document is opened underneath rather than by hand. It is still
/// a real document with a number minted at this DC, and it is still what the
/// counts hang off; it just is not a thing anybody has to remember to create
/// before the goods can be written down. An open document for the same
/// supplier is reused, because a lorry is one arrival with one invoice.
export function CountSheet({
  order,
  open,
  onClose,
}: {
  order: OrderRow | null
  open: boolean
  onClose: () => void
}) {
  const actor = useEdgeActor()
  const client = useQueryClient()
  const supplierName = useSupplierName()
  // Under each article: its division and tags, as the order shows them. Read
  // from head office's copy of the order; where that is not reachable the
  // article's code stands in.
  const poNumber = order?.po_number ?? null
  const book = useQuery({
    queryKey: procurementKeys.ordersPage({ q: poNumber ?? "" }),
    queryFn: ({ signal }) => purchaseOrderPage({ q: poNumber ?? "" }, signal),
    enabled: open && poNumber !== null,
  })
  const headOffice = book.data?.rows.find((one) => one.po_number === poNumber)
  const kinds = useQuery({
    queryKey: procurementKeys.order(headOffice?.purchase_order_id ?? ""),
    queryFn: ({ signal }) =>
      purchaseOrderDetail(headOffice!.purchase_order_id, signal),
    enabled: headOffice !== undefined,
  })
  const kindOf = (line: { po_line_id: string; article_code: string }) => {
    const found = kinds.data?.lines.find(
      (one) => one.po_line_id === line.po_line_id
    )
    if (found === undefined) return line.article_code
    return [
      found.division_code === null
        ? "Unclassified"
        : label(found.division_code),
      ...found.tags.map((tag) => label(tag)),
    ].join(" \u00b7 ")
  }
  /// What has been written for each line: one amount or several, each in a
  /// unit the item can be counted in — "10 KODI + 50 PCS" is one count
  /// (the owner, 2026-09-29). Unset is one empty amount in the unit the order
  /// was placed in, or pieces; the counter may switch (owner, 2026-09-26).
  const [parts, setParts] = useState<Record<string, CountPart[]>>({})
  /// What the counter writes as not matching the order, per line, in pieces:
  /// cartons where the supplier's picker put another colour, model or
  /// article. Part of the count, never of the acceptance — at review these
  /// pieces go back to the supplier on a purchase return.
  /// Pieces of the whole delivery that are not what was ordered: ONE total
  /// (the owner, 2026-10-04), not a figure on every line.
  const [wrongText, setWrongText] = useState("")
  /// The unit that figure is written in — "20 KODI" — one of the units the
  /// delivery's lines can be counted in. Empty is pieces.
  const [wrongUnit, setWrongUnit] = useState("")

  const receipts = useQuery({
    queryKey: keys.receipts(),
    queryFn: ({ signal }) => dc.goodsReceipts(signal),
  })

  // Minted once per thing being written, and kept across a retry. A bay with
  // bad wifi is exactly where a retried POST becomes a second document, or a
  // second count against goods that arrived once — so the key that makes the
  // retry harmless has to survive the failure that caused it.
  const minted = useRef(new Map<string, string>())
  const keyFor = (subject: string) => {
    const existing = minted.current.get(subject)
    if (existing !== undefined) return existing
    const fresh = idempotencyKey()
    minted.current.set(subject, fresh)
    return fresh
  }

  const record = useMutation({
    mutationFn: async (
      entries: {
        line: string
        quantity: number
        wrong: number
        unit: string | null
        unitQuantity: string | null
      }[]
    ) => {
      const supplier = order!.supplier_id
      // Only a receipt still being unloaded: one that already carries the
      // supplier's invoice belongs to an earlier delivery, and counting this
      // order into it paired the new goods with the old invoice.
      const existing = (receipts.data ?? (await dc.goodsReceipts())).find(
        (row) => row.supplier_id === supplier && row.invoice_number === null
      )
      const receiptId =
        existing?.receipt_id ??
        (
          await dc.openGoodsReceipt({
            supplier_id: supplier,
            // Null means now. Nobody on a bay types the time the lorry came in
            // while it is still being unloaded.
            arrived_at: null,
            actor_id: actor,
            idempotency_key: keyFor(`receipt:${order!.po_number}`),
          })
        ).receipt_id
      // Sequential, not parallel: the first line is what creates the movement
      // group the rest join, and four counts racing into one document is four
      // chances to be told the document is not there yet.
      for (const entry of entries) {
        await dc.countPurchase({
          receipt_id: receiptId,
          po_line_id: entry.line,
          counted_quantity: entry.quantity,
          wrong_quantity: entry.wrong,
          counted_unit_code: entry.unit,
          counted_unit_quantity: entry.unitQuantity,
          actor_id: actor,
          idempotency_key: keyFor(`count:${entry.line}`),
        })
      }
      return entries.length
    },
    onSuccess: (sent) => {
      setParts({})
      setWrongText("")
      setWrongUnit("")
      minted.current.clear()
      void client.invalidateQueries({ queryKey: keys.verifyQueue() })
      void client.invalidateQueries({ queryKey: keys.receipts() })
      void client.invalidateQueries({ queryKey: keys.purchaseWork() })
      // Done is said once, in the receipt dialog over the list, and the sheet
      // goes: a count sent is not a form to keep looking at (owner,
      // 2026-10-02). This component stays mounted between openings, so the
      // state survives the close.
      setSentCount(
        `Count sent · ${count(sent)} ${sent === 1 ? "line" : "lines"}`
      )
      onClose()
    },
  })

  /// The count the sheet sent, held in the receipt dialog until it is read.
  const [sentCount, setSentCount] = useState<string | null>(null)

  // The count sent for one order is not the next one's banner.
  const { reset } = record
  useEffect(() => reset(), [poNumber, reset])

  type Line = OrderRow["lines"][number]
  /// The units a line may be counted in, the one it starts in, and the one
  /// its totals are printed in — the article's stock unit, PCS for nearly
  /// everything and for lines sent before the centre said which.
  const unitsOf = (line: Line) => {
    const units = line.count_units ?? []
    const stock = units.find((one) => one.is_stock)?.code ?? "PCS"
    const first = line.order_unit_code ?? units[0]?.code ?? stock
    return { units, stock, first }
  }
  const factorOf = (line: Line, code: string) =>
    unitsOf(line).units.find((one) => one.code === code)?.factor ?? "1"
  const partsOf = (line: Line): CountPart[] =>
    parts[line.po_line_id] ?? [{ quantity: "", unit: unitsOf(line).first }]
  const writeParts = (line: Line, next: CountPart[]) =>
    setParts((current) => ({ ...current, [line.po_line_id]: next }))
  /// Another amount, in the first unit the line is not already counted in —
  /// pieces first, because "and fifty loose" is what a second amount almost
  /// always is.
  const addPart = (line: Line) => {
    const { units, stock } = unitsOf(line)
    const used = new Set(partsOf(line).map((part) => part.unit))
    const unit =
      [stock, ...units.map((one) => one.code)].find(
        (code) => !used.has(code)
      ) ?? stock
    writeParts(line, [...partsOf(line), { quantity: "", unit }])
  }
  /// What a line's amounts come to in pieces — exactly, so 9.5 KODI is 190.
  /// `undefined` while nothing is written; `null` when an amount is not a
  /// whole number of pieces, which the node would refuse.
  const piecesOf = (line: Line): number | null | undefined => {
    const written = partsOf(line).filter((part) => part.quantity.trim() !== "")
    if (written.length === 0) return undefined
    let total = 0
    for (const part of written) {
      const pieces = wholeProduct(part.quantity, factorOf(line, part.unit))
      if (pieces === null) return null
      total += pieces
    }
    return total
  }
  /// What "not as ordered" comes to for the delivery: `undefined` when nothing
  /// is written, `null` when what is written is not whole pieces, else the
  /// number.
  /// Every unit any line of the delivery can be counted in, once each: the
  /// delivery's one "not as ordered" figure may be written in any of them.
  const deliveryUnits = (() => {
    const seen = new Map<
      string,
      { code: string; label: string; factor: string }
    >()
    for (const line of order?.lines ?? []) {
      for (const one of unitsOf(line).units) {
        if (!seen.has(one.code)) {
          seen.set(one.code, {
            code: one.code,
            label: one.label,
            factor: one.factor,
          })
        }
      }
    }
    return [...seen.values()]
  })()
  const wrongFactor =
    deliveryUnits.find((one) => one.code === wrongUnit)?.factor ?? "1"
  const wrongValue =
    wrongText.trim() === ""
      ? undefined
      : wholeProduct(wrongText.trim(), wrongFactor)
  /// Not part of the count: a supplier can send more of the wrong thing than
  /// of the right one, so there is no ceiling — only whole pieces.
  const wrongPieces = wrongValue
  const wrongProblem = "Must be a whole number of pieces"
  /// The node keeps the figure per counted line, and refuses one larger than
  /// the line's own count. The delivery's one total is therefore laid onto the
  /// counted lines in order, each taking what it can hold; the screen only
  /// ever speaks of the total.
  const withCount = (order?.lines ?? []).flatMap((line) => {
    const quantity = piecesOf(line)
    // A line written as 0 is a count too (owner, 2026-10-05): it says the
    // supplier did not send it, and puts the shortage in front of the buyer. A
    // line left blank is not counted at all.
    return quantity === undefined || quantity === null || quantity < 0
      ? []
      : [{ line, quantity }]
  })
  /// The node keeps the wrong pieces as a part of the line's stored count
  /// (`counted_quantity` = ordered article + not as ordered) and sends them
  /// back to the supplier once the count is confirmed. The delivery's one
  /// figure rides on the first counted line — or, when only wrong goods came,
  /// on the order's first line.
  const wrongTotal = typeof wrongPieces === "number" ? wrongPieces : 0
  const carrier =
    withCount.length > 0 || wrongTotal <= 0 || order?.lines[0] === undefined
      ? withCount
      : [{ line: order.lines[0], quantity: 0 }]
  const placed = {
    rows: carrier.map((one, index) => ({
      ...one,
      wrong: index === 0 ? wrongTotal : 0,
    })),
  }
  const entries = placed.rows.map(({ line, quantity, wrong }) => {
    // One amount in a unit other than pieces is kept as it was written
    // (9.5 KODI); a mix is kept as the pieces it comes to, which is what the
    // ledger holds either way.
    const written = partsOf(line).filter((part) => part.quantity.trim() !== "")
    const only = written.length === 1 ? written[0] : null
    // The wrong pieces are in the stored count, so a unit amount written for
    // the right ones alone would no longer add up to it.
    const inUnit =
      only !== null && wrong === 0 && factorOf(line, only.unit) !== "1"
    return {
      line: line.po_line_id,
      quantity: quantity + wrong,
      wrong,
      unit: inUnit ? only.unit : null,
      unitQuantity: inUnit ? only.quantity.trim().replace(",", ".") : null,
    }
  })
  /// A total that cannot be sent — not whole, or more than was counted — holds
  /// the whole submission until it is fixed.
  const miswritten = wrongPieces === null

  /// What has been written down so far, by the unit it is kept in — nearly
  /// always pieces. Beside the lines rather than at the bottom (the owner,
  /// 2026-09-29): an order of forty lines is counted a screen at a time, and
  /// the running total has to stay in sight while the list scrolls.
  const counted = (order?.lines ?? []).flatMap((line) => {
    const pieces = piecesOf(line)
    if (pieces === undefined || pieces === null || pieces <= 0) return []
    return [{ line, pieces, unit: unitsOf(line).stock.toLowerCase() }]
  })
  const totals = [...new Set(counted.map((one) => one.unit))].map((unit) => ({
    unit,
    pieces: counted
      .filter((one) => one.unit === unit)
      .reduce((sum, one) => sum + one.pieces, 0),
  }))

  /// What the lines come to, as the table's own total row says it.
  const countedText =
    totals.length === 0
      ? "0 pcs"
      : totals
          .map(
            (total) =>
              `${count(total.pieces)} ${total.pieces === 1 && total.unit === "pcs" ? "pc" : total.unit}`
          )
          .join(" + ")

  return (
    <>
      <Sheet
        open={open}
        onOpenChange={(next) => !next && onClose()}
        id={order?.po_number}
        title={
          order === undefined || order === null
            ? "Order"
            : supplierName(order.supplier_id, order.supplier_name)
        }
        width="table"
        footer={
          order !== null && (
            <div className="flex items-center justify-end gap-3">
              <Button
                variant="primary"
                pending={record.isPending}
                disabled={entries.length === 0 || miswritten}
                onClick={() => record.mutate(entries)}
              >
                {record.isPending ? "Sending…" : "Submit count"}
              </Button>
            </div>
          )
        }
      >
        {order === null ? (
          <EmptyState>Nothing to count.</EmptyState>
        ) : (
          <div className="flex flex-col gap-5">
            <div className="flex min-w-0 flex-col gap-4">
              {/* One grid, header and rows sharing the same three tracks, set
                the way every hub table is (`Card` + `DataTable`'s heading
                row): what, what was counted, and what that comes to. */}
              <Card className="overflow-hidden">
                <div
                  className={cn(
                    COUNT_ROW,
                    "h-10 items-center border-b border-hairline bg-soft"
                  )}
                >
                  <span className={COUNT_HEAD}>Article</span>
                  <span className={cn(COUNT_HEAD, "max-sm:hidden")}>
                    Counted
                  </span>
                  <span className={cn(COUNT_HEAD, "text-right")}>
                    In pieces
                  </span>
                </div>
                <div className="divide-y divide-hairline">
                  {order.lines.map((line) => {
                    const { units, stock } = unitsOf(line)
                    const lineParts = partsOf(line)
                    const pieces = piecesOf(line)
                    return (
                      <div
                        key={line.po_line_id}
                        className={cn(COUNT_ROW, "py-3.5")}
                      >
                        <TwoLines
                          top={line.article_name}
                          bottom={`${kindOf(line)}${line.received_stock_units > 0 ? ` · ${count(line.received_stock_units)} already in` : ""}`}
                          className="min-h-11"
                        />

                        <div className="flex flex-col gap-2 max-sm:order-last max-sm:col-span-2">
                          {lineParts.map((part, index) => (
                            <div
                              key={index}
                              className="flex items-center gap-2"
                            >
                              <Input
                                className="h-11 w-24 text-center font-semibold"
                                inputMode="decimal"
                                autoComplete="off"
                                aria-label={`Counted ${part.unit} of ${line.article_code}`}
                                padLabel={`${line.article_name} · ${part.unit}`}
                                value={part.quantity}
                                onChange={(event) =>
                                  writeParts(
                                    line,
                                    lineParts.map((one, at) =>
                                      at === index
                                        ? {
                                            ...one,
                                            quantity: event.target.value,
                                          }
                                        : one
                                    )
                                  )
                                }
                              />
                              {/* Any unit the item can be counted in; an amount
                              that is not whole pieces is refused before it is
                              sent. */}
                              {units.length > 1 ? (
                                <Select
                                  aria-label={`Unit counted for ${line.article_code}`}
                                  value={part.unit}
                                  onChange={(code) =>
                                    writeParts(
                                      line,
                                      lineParts.map((one, at) =>
                                        at === index
                                          ? { ...one, unit: code }
                                          : one
                                      )
                                    )
                                  }
                                  className="h-11 w-28"
                                >
                                  {units.map((one) => (
                                    <option key={one.code} value={one.code}>
                                      {one.label}
                                    </option>
                                  ))}
                                </Select>
                              ) : (
                                <span className="w-28 text-[0.875rem] text-body">
                                  {stock.toLowerCase()}
                                </span>
                              )}
                              {/* The slot stays when there is nothing to remove,
                              so every row's fields line up. */}
                              <span className="flex size-11 items-center justify-center">
                                {lineParts.length > 1 && (
                                  <Button
                                    variant="quiet"
                                    size="sm"
                                    aria-label="Remove this amount"
                                    onClick={() =>
                                      writeParts(
                                        line,
                                        lineParts.filter(
                                          (_, at) => at !== index
                                        )
                                      )
                                    }
                                  >
                                    <X />
                                  </Button>
                                )}
                              </span>
                            </div>
                          ))}
                          {units.length > 1 && (
                            <Button
                              variant="quiet"
                              size="sm"
                              onClick={() => addPart(line)}
                              className="-ml-2 self-start"
                            >
                              <Plus />
                              Another unit
                            </Button>
                          )}
                        </div>

                        <span
                          className={cn(
                            "flex min-h-11 items-center justify-end text-right tabular-nums",
                            pieces === null
                              ? "text-[0.875rem] text-bad-fg"
                              : pieces === undefined
                                ? "text-mute"
                                : "font-medium text-ink"
                          )}
                        >
                          {pieces === null
                            ? "Not whole pieces"
                            : pieces === undefined
                              ? "—"
                              : `${count(pieces)} ${stock.toLowerCase()}`}
                        </span>
                      </div>
                    )
                  })}
                </div>

                {/* The counted amounts added up — the table's total, in the
                  same column as each line's own figure. */}
                <div
                  className={cn(
                    COUNT_ROW,
                    "border-t border-hairline bg-soft py-3.5"
                  )}
                >
                  <span className="flex min-h-11 items-center font-medium text-ink">
                    Total Counted
                  </span>
                  <span className="max-sm:hidden" />
                  <span className="flex min-h-11 items-center justify-end text-right font-medium text-ink tabular-nums">
                    {countedText}
                  </span>
                </div>

                {/* One figure for the whole delivery, not one per line: its
                  field sits under the counted amounts, in the same column. */}
                <div
                  className={cn(
                    COUNT_ROW,
                    "border-t border-hairline bg-soft py-3.5"
                  )}
                >
                  <label
                    htmlFor="not-as-ordered"
                    className="flex min-h-11 flex-col justify-center"
                  >
                    <span className="font-medium text-ink">Not as Ordered</span>
                    <span className="text-[0.875rem] text-mute">
                      Damaged or wrong items
                    </span>
                  </label>
                  <div className="flex flex-col gap-2 max-sm:order-last max-sm:col-span-2">
                    <div className="flex items-center gap-2">
                      <Input
                        id="not-as-ordered"
                        className="h-11 w-24 text-center font-semibold"
                        inputMode="decimal"
                        autoComplete="off"
                        placeholder="0"
                        padLabel="Not as ordered · Damaged or wrong items"
                        aria-invalid={wrongPieces === null}
                        value={wrongText}
                        onChange={(event) => setWrongText(event.target.value)}
                      />
                      {deliveryUnits.length > 1 ? (
                        <Select
                          aria-label="Unit for not as ordered"
                          value={wrongUnit}
                          onChange={(code) => setWrongUnit(code)}
                          className="h-11 w-28"
                        >
                          <option value="">Piece</option>
                          {deliveryUnits
                            .filter((one) => one.factor !== "1")
                            .map((one) => (
                              <option key={one.code} value={one.code}>
                                {one.label}
                              </option>
                            ))}
                        </Select>
                      ) : (
                        <span className="w-28 text-[0.875rem] text-body">
                          pieces
                        </span>
                      )}
                      <span className="size-11" />
                    </div>
                  </div>
                  <span
                    className={cn(
                      "flex min-h-11 items-center justify-end text-right tabular-nums",
                      wrongPieces === null
                        ? "text-[0.875rem] text-bad-fg"
                        : wrongPieces === undefined || wrongPieces === 0
                          ? "text-mute"
                          : "font-medium text-bad-fg"
                    )}
                  >
                    {wrongPieces === null
                      ? wrongProblem
                      : wrongPieces === undefined
                        ? "—"
                        : `${count(wrongPieces)} pcs`}
                  </span>
                </div>
              </Card>

              <Problem error={record.error} />
            </div>
          </div>
        )}
      </Sheet>
      <SavedDialog
        open={sentCount !== null}
        onOpenChange={(next) => {
          if (!next) setSentCount(null)
        }}
        title={sentCount ?? ""}
      />
    </>
  )
}
