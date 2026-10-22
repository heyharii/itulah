import { DocStamp } from "@/components/ui/doc-stamp"
import { Dialog as BaseDialog } from "@base-ui/react/dialog"
import { Drawer } from "@base-ui/react/drawer"
import { useForm } from "@tanstack/react-form"
import { useRouterState } from "@tanstack/react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Check,
  CircleAlert,
  CircleCheck,
  FileText,
  Upload,
  X,
} from "lucide-react"
import { Fragment, useCallback, useEffect, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { ConfirmButton } from "@/components/ui/dialog"
import { Field, Input, Money } from "@/components/ui/field"
import { Switch } from "@/components/ui/form"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { Pill } from "@/components/ui/pill"
import { PhoneDrawer } from "@/components/ui/phone-drawer"
import { Fact, Facts } from "@/components/ui/sheet"
import { Problem, Receipt } from "@/components/ui/states"
import { dc } from "@/lib/api"
import { useNameOfLogin } from "@/lib/queries/hr-employees"
import { recordKeys } from "@/lib/queries/records"
import {
  count,
  day,
  label,
  money,
  percentBps,
  recentMoment,
} from "@/lib/format"
import { useLayout } from "@/lib/layout"
import { screenForPath } from "@/lib/navigation"
import { useSheetLayer } from "@/lib/sheet-stack"
import { pullIn, useSaid, type PullIn } from "@/lib/pull-in"
import { useEdgeActor, useEdgeNodeIdentity } from "@/lib/edge-session"
import { keys } from "@/lib/operations/keys"
import { setBenchActor, useBenchActor } from "@/lib/operations/bench"
import {
  closeLineShort,
  procurementKeys,
  purchaseOrderDetail,
  purchaseOrderPage,
  raisePurchaseReturn,
} from "@/lib/queries/procurement"
import {
  recordSettlement,
  replacementOf,
  supplierReturnKeys,
  supplierReturns,
} from "@/lib/queries/supplier-returns"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"
import { cn } from "@/lib/utils"
import { lineValue, unitPriceText } from "@/screens/procurement/shared"
import {
  useSupplierName,
  useSupplierRecordId,
} from "@/screens/procurement/supplier-name"
import { useCountsAwaiting } from "@/screens/procurement/count-review-state"
import { LineSheet } from "@/screens/procurement/line-sheet"
import { SupplierSheet } from "@/screens/procurement/suppliers"
import { OrderSheet } from "@/screens/procurement/purchase-orders"
import { OperationsGate } from "@/screens/operations/gate"
import { TwoLines } from "@/screens/operations/two-lines"
import {
  VariantPhoto,
  variantKey,
  variantLabel,
} from "@/screens/procurement/variant-photo"
import { idempotencyKey } from "@itulah/contract/client"
import type {
  InvoiceDocumentView,
  PurchaseCountAwaitingVerification,
} from "@itulah/contract"
import type { PurchaseOrderDetail } from "@/lib/queries/procurement"

/// **Review count** — the buyer's half of a delivery.
///
/// Ops › Receiving only COUNTS (blind, at the warehouse). Whoever raised the PO
/// reviews that count, here, from Procurement › Purchase orders: the order's row
/// and its sheet carry "Review count" once the warehouse has counted something.
///
/// The count is read from the DC, so it needs the warehouse sign-in. The
/// dialog stands inside `OperationsGate`, which exchanges the Central session
/// for a DC one and asks only when that fails.
///
/// One dialog, line by line — Ordered · Counted · Difference — and the way out
/// depends on what it shows:
///
///   · short → keep the rest on order, or close it short;
///   · over  → return the extra pieces to the supplier;
///   · any case, even a match → Count again, with a reason, on ticked lines.
///
/// Who may review a count is their role and permission (owner, 2026-10-04):
/// the person who took the count, or raised the order, may also be the one
/// who accepts it.

type Count = PurchaseCountAwaitingVerification

/// "Review count" on a PO that has a count waiting; nothing otherwise.
export function ReviewCountButton({
  po,
  size = "sm",
  inline = false,
  cancelled = false,
}: {
  po: string
  /// A cancelled order takes no goods: nothing to review on it.
  cancelled?: boolean
  size?: "sm" | "default"
  /// In a list's Status cell: a small filled blue button standing where the status
  /// word would — an order with a count waiting is always an active one, so
  /// the action takes the status's place.
  inline?: boolean
}) {
  const review = useSheet("verify")
  const waiting = useCountsAwaiting().get(po)
  if (cancelled || waiting === undefined || waiting.length === 0) return null
  if (inline) {
    return (
      <Button
        variant="primary"
        size="sm"
        // The same solid blue button on every screen (owner, 2026-10-06):
        // the soft capsule it wore on a phone is gone, one look to learn.
        className="relative -my-1 w-fit after:absolute after:inset-x-0 after:-inset-y-2 after:content-['']"
        onClick={(event) => {
          event.stopPropagation()
          review.open(po)
        }}
      >
        Review Count
      </Button>
    )
  }
  return (
    <Button
      variant="ghost"
      size={size}
      onClick={(event) => {
        event.stopPropagation()
        review.open(po)
      }}
    >
      Review Count
    </Button>
  )
}

/// What the review's head says once the count is read: the supplier is the
/// sheet's name (owner, 14 Oct: "yang utama ya supplier"), the line under it
/// says what this is and who counted. Primitives, so the body can hand them
/// up from an effect without re-rendering the head in a loop.
interface ReviewHead {
  readonly supplier: string | undefined
  readonly supplierId: string | null
  readonly orderId: string | null
  readonly caption: string
}

/// The review, over the order's page. `po` is the order's number (`?verify=`);
/// nothing is mounted while it is null.
export function CountReview({
  po,
  onClose,
}: {
  po: string | null
  onClose: () => void
}) {
  const [flag, setFlag] = useState<"ok" | "warn" | null>(null)
  const [heading, setHeading] = useState<ReviewHead | null>(null)
  /// The sheet opens with the focus on ×, as every record sheet does.
  const closeRef = useRef<HTMLButtonElement>(null)
  // What the head names opens as a layer over the review, like every name
  // here: the supplier, the order (back to it when it is the one underneath).
  const [supplierShown, setSupplierShown] = useState<string | null>(null)
  const [orderShown, setOrderShown] = useState<string | null>(null)
  const orderUnder = useSheet("order").value
  const phone = useLayout() === "phone"
  const Parts: { Title: React.ElementType; Close: React.ElementType } = phone
    ? Drawer
    : BaseDialog

  // The record sheet's anatomy (hub-ui-patterns): where it sits in grey — the
  // screen, then the order's number — the name, × at the right.
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const where = screenForPath(pathname)?.label
  const layer = useSheetLayer(po !== null && !phone, false)
  const head = (
    <div className="sheet-head flex shrink-0 items-center gap-x-4 border-b border-hairline px-4 py-4 max-md:items-start md:px-7 md:py-3">
      <div className="sheet-headtext min-w-0 flex-1">
        {po !== null && (
          <div className="sheet-id mb-0.5 truncate text-id text-body">
            {where && (
              <>
                <Parts.Close tabIndex={-1} className="sheet-crumb">
                  {where}
                </Parts.Close>
                <span aria-hidden className="sheet-crumb-sep">
                  /
                </span>
              </>
            )}
            {heading?.orderId != null ? (
              <button
                type="button"
                className="record-link"
                onClick={() =>
                  orderUnder === heading.orderId
                    ? onClose()
                    : setOrderShown(heading.orderId)
                }
              >
                {po}
              </button>
            ) : (
              <span>{po}</span>
            )}
          </div>
        )}
        <Parts.Title className="sheet-title flex items-center gap-2 text-card-title font-semibold text-ink">
          {heading?.supplier === undefined ? (
            "Review Count"
          ) : heading.supplierId === null ? (
            heading.supplier
          ) : (
            <button
              type="button"
              className="record-link text-left"
              onClick={() => setSupplierShown(heading.supplierId)}
            >
              {heading.supplier}
            </button>
          )}
          {/* What the count found, said once, by the title: a mark and no
            sentence — the table and the question below carry the numbers. */}
          {flag === "warn" && (
            <CircleAlert
              className="size-5 text-bad-fg"
              aria-label="The count differs from the order"
            />
          )}
          {flag === "ok" && (
            <CircleCheck
              className="size-5 text-ok-fg"
              aria-label="The count matches the order"
            />
          )}
        </Parts.Title>
        <div className="sheet-caption mt-0.5 text-meta text-mute">
          {heading?.caption ?? "Review Count"}
        </div>
      </div>
      <Parts.Close
        ref={closeRef}
        aria-label="Close"
        className="sheet-close btn-iconly grid size-8 shrink-0 place-items-center self-start rounded-inner text-line-ico transition-colors hover:bg-soft-2 hover:text-ink pointer-coarse:size-tap"
      >
        <X className="size-4" />
        <span aria-hidden className="btn-word hidden">
          Close
        </span>
      </Parts.Close>
    </div>
  )
  const body = po !== null && (
    <OperationsGate>
      <ReviewBody
        po={po}
        onClose={onClose}
        onSaved={(saved) => void pullIn(saved)}
        onFlag={setFlag}
        onHead={setHeading}
      />
    </OperationsGate>
  )
  const layers = (
    <>
      <SupplierSheet
        id={supplierShown}
        context={po ?? undefined}
        onClose={() => setSupplierShown(null)}
      />
      <OrderSheet
        id={orderShown}
        onClose={() => setOrderShown(null)}
        onEdit={() => setOrderShown(null)}
      />
    </>
  )

  // A phone reviews in a sheet from the bottom, as every other overlay there.
  if (phone) {
    return (
      <>
        <PhoneDrawer
          open={po !== null}
          onOpenChange={(next) => !next && onClose()}
          tall
        >
          {head}
          {body}
        </PhoneDrawer>
        {layers}
      </>
    )
  }

  return (
    <>
      <BaseDialog.Root
        open={po !== null}
        onOpenChange={(next) => !next && onClose()}
      >
        <BaseDialog.Portal>
          <BaseDialog.Backdrop
            data-quiet={layer.over ? "" : undefined}
            className="sheet-veil fixed inset-0 z-40 bg-[var(--scrim)] transition-opacity duration-(--t-sheet) ease-(--ease-out) data-[ending-style]:opacity-0 data-[ending-style]:duration-(--t-exit) data-[starting-style]:opacity-0"
          />
          {/* A record sheet from the right like every other (hub-ui-patterns,
          14 Oct: one format, one motion) — over the list, or over the order's
          own sheet, 12px further in. It was a dialog in the middle. */}
          <BaseDialog.Popup
            initialFocus={closeRef}
            data-under={layer.under ? "" : undefined}
            data-over={layer.over ? "" : undefined}
            className="sheet-pop fixed top-5 right-5 bottom-5 z-40 flex w-[calc(100vw-5rem)] flex-col overflow-hidden rounded-shell border border-hairline bg-canvas shadow-float transition-[translate,opacity] duration-(--t-sheet) ease-(--ease-drawer) outline-none data-[ending-style]:translate-x-[calc(100%+1.25rem)] data-[ending-style]:duration-(--t-exit) data-[starting-style]:translate-x-[calc(100%+1.25rem)] motion-reduce:data-[ending-style]:translate-none motion-reduce:data-[ending-style]:opacity-0 motion-reduce:data-[starting-style]:translate-none motion-reduce:data-[starting-style]:opacity-0 xl:w-[min(60rem,calc(100vw-18.75rem))] min-[90rem]:w-[min(65rem,calc(100vw-22.5rem))]"
          >
            {head}
            {body}
          </BaseDialog.Popup>
        </BaseDialog.Portal>
      </BaseDialog.Root>
      {layers}
    </>
  )
}

function ReviewBody({
  po,
  onClose,
  onSaved,
  onFlag,
  onHead,
}: {
  po: string
  onClose: () => void
  onSaved: (saved: PullIn) => void
  onFlag: (flag: "ok" | "warn" | null) => void
  onHead: (head: ReviewHead | null) => void
}) {
  const queue = useQuery({
    queryKey: keys.verifyQueue(),
    queryFn: ({ signal }) => dc.countsAwaitingVerification(signal),
  })
  return queryState(queue, {
    loading: "Reading the count…",
    render: (all) => (
      <Review
        key={po}
        po={po}
        live={all.filter((row) => row.po_number === po)}
        onClose={onClose}
        onSaved={onSaved}
        onFlag={onFlag}
        onHead={onHead}
      />
    ),
  })
}

type Short = "keep" | "close"

const lines = (n: number) => `${count(n)} ${n === 1 ? "item" : "items"}`
const pcs = (n: number) => `${count(n)} ${n === 1 ? "pc" : "pcs"}`

/// The cloud's copy of an order, found by its number.
async function orderOf(po: string) {
  const page = await purchaseOrderPage({ q: po })
  const found = page.rows.find((one) => one.po_number === po)
  if (found === undefined) throw new Error(`${po} is not at head office yet.`)
  return purchaseOrderDetail(found.purchase_order_id)
}

/// When the order is a replacement for a supplier return (its note says so),
/// tell that return the pieces that came in. True when it was recorded.
async function settleReplacement(po: string, pieces: number) {
  if (pieces <= 0) return false
  let allotment: string | null
  try {
    allotment = replacementOf((await orderOf(po)).notes)
  } catch {
    // Not at head office yet: nothing to say it is a replacement.
    return false
  }
  if (allotment === null) return false
  const found = (await supplierReturns()).find(
    (one) => one.allotment_number === allotment
  )
  if (found === undefined) return false
  await recordSettlement(found.allotment_id, {
    kind: "REPLACEMENT",
    quantity: pieces,
    reference: po,
  })
  return true
}

/// Pieces of a count that are within what was still owed, and pieces beyond —
/// both reckoned on the pieces that match the order. What the checker wrote
/// as not as ordered was on the lorry but was never quantity this order could
/// take; it leaves with the excess, on a return to the supplier.
// A node older than the field has not sent `outstanding_stock_units`; reading
// it as undefined made every figure on the sheet NaN. Until the node is
// updated the order's own quantity stands in for what is owed.
const owed = (row: Count) =>
  Number.isFinite(row.outstanding_stock_units)
    ? row.outstanding_stock_units
    : row.expected_stock_units
/// The wrong pieces ride on the line as part of what the node stored
/// (`counted_quantity` = what was ordered + what was not), so the ordered
/// article's own count is the difference.
/// A node that has not learnt "not as ordered" yet sends no figure: none.
const wrongOf = (row: Count) => row.wrong_quantity ?? 0
const correct = (row: Count) => row.counted_quantity - wrongOf(row)
const gap = (row: Count) => correct(row) - owed(row)

function Review({
  po,
  live,
  onClose,
  onSaved,
  onFlag,
  onHead,
}: {
  po: string
  live: readonly Count[]
  onClose: () => void
  onSaved: (saved: PullIn) => void
  onFlag: (flag: "ok" | "warn" | null) => void
  onHead: (head: ReviewHead | null) => void
}) {
  const actor = useEdgeActor()
  const client = useQueryClient()
  const where = useEdgeNodeIdentity()
  const bench = useBenchActor()
  // A DC with sign-in switched off writes whatever `actor_id` it is given, and
  // an unnamed browser would stamp the acceptance with no one's name. Naming
  // the person is the fix, before anything is accepted.
  const unnamed = where.data?.auth === "DISABLED" && bench === null

  // The supplier is on the order, not on the count: read it from the book.
  const book = useQuery({
    queryKey: procurementKeys.ordersPage({ q: po }),
    queryFn: ({ signal }) => purchaseOrderPage({ q: po }, signal),
  })
  const order = book.data?.rows.find((one) => one.po_number === po)
  // Under each article: its division and tags, as the order itself shows it.
  const detail = useQuery({
    queryKey: procurementKeys.order(order?.purchase_order_id ?? ""),
    queryFn: ({ signal }) =>
      purchaseOrderDetail(order!.purchase_order_id, signal),
    enabled: order !== undefined,
  })
  const kindOf = (row: Count) => {
    const line = detail.data?.lines.find(
      (one) => one.po_line_id === row.po_line_id
    )
    if (line === undefined) return row.article_code
    return [
      line.division_code === null ? "Unclassified" : label(line.division_code),
      ...line.tags.map((tag) => label(tag)),
    ].join(" \u00b7 ")
  }
  /// The line's own picture, for a variant without photographs of its own.
  const imageOf = (row: Count) =>
    detail.data?.lines.find((one) => one.po_line_id === row.po_line_id)
      ?.image_url ?? null
  const nameOf = useSupplierName()
  const supplier =
    order === undefined || order.supplier_name === null
      ? undefined
      : nameOf(order.supplier_id, order.supplier_name)
  // What the review names, each opening its own record as a layer over it
  // (owner, 14 Oct: "item di review count bisa di klik keluar detailnya").
  const [lineShown, setLineShown] = useState<
    PurchaseOrderDetail["lines"][number] | null
  >(null)
  const recordOf = useSupplierRecordId()
  const itemOf = (row: Count) =>
    detail.data?.lines.find((one) => one.po_line_id === row.po_line_id) ?? null
  /// The line's name, as a link to its record once the order is read.
  const itemName = (row: Count, className: string) => {
    const line = itemOf(row)
    return line === null ? (
      <div className={className}>{row.article_name}</div>
    ) : (
      <button
        type="button"
        onClick={() => setLineShown(line)}
        className={cn("record-link block text-left", className)}
      >
        {row.article_name}
      </button>
    )
  }
  const cancelled = order?.lifecycle === "CANCELLED"

  const [hideMatched, setHideMatched] = useState(false)
  // The receiving that came before, read in a dialog over this one.
  const [lastReceiving, setLastReceiving] = useState(false)
  // What was accepted, kept after the counts leave the queue: the buyer is
  // still owed the invoice box, and a retry still needs the rows.
  const [frozen, setFrozen] = useState<readonly Count[] | null>(null)
  const [accepted, setAccepted] = useState<readonly Count[] | null>(null)

  const rows = live.length > 0 ? live : (frozen ?? [])

  const shorts = rows.filter((row) => gap(row) < 0)
  const overs = rows.filter((row) => gap(row) > 0)
  const shortQty = shorts.reduce((sum, row) => sum - gap(row), 0)
  // Everything beyond the order leaves with the not-as-ordered pieces: a return
  // takes a receipt line's whole excess.
  const overQty = overs.reduce((sum, row) => sum + gap(row), 0)
  const totalWrong = rows.reduce((sum, row) => sum + wrongOf(row), 0)
  // A column's total is the sum of its rows: what was counted, as counted.
  const totalCounted = rows.reduce((sum, row) => sum + correct(row), 0)
  // Once something has come in, the table says what is still LEFT of the order
  // (the same pieces the count is compared with), and so do its totals;
  // before that it is simply what was ordered (owner, 2026-10-12).
  const part = (detail.data?.lines ?? []).some(
    (line) => line.received_quantity > 0
  )
  const orderedHead = part ? "Ordered Left" : "Ordered"
  // The money this count brings, at the agreed price: shown whenever every
  // line carries one. Procurement reviews, and each choice at the foot has a
  // cost — closing short takes the missing pieces at their price and leaves the
  // discount on what stays.
  const priced =
    rows.length > 0 && rows.every((row) => row.unit_price_minor !== null)
  const priceOf = (row: Count) => row.unit_price_minor ?? 0
  const amountOf = (row: Count) =>
    Math.min(correct(row), owed(row)) * priceOf(row)
  const leftGross = rows.reduce((sum, row) => sum + owed(row) * priceOf(row), 0)
  const shortGross = rows.reduce(
    (sum, row) => sum + Math.max(0, owed(row) - correct(row)) * priceOf(row),
    0
  )
  const orderGross = (detail.data?.lines ?? []).reduce(
    (sum, line) => sum + lineValue(line, line.ordered_quantity),
    0
  )
  const discountBps =
    detail.data === undefined
      ? 0
      : (detail.data.discount_bps ??
        (orderGross > 0
          ? Math.round((detail.data.discount_minor * 10000) / orderGross)
          : 0))
  // The discount on what stays, as the centre bills it: the order's own
  // rupiah discount in proportion to the value accepted (sync.rs shares it
  // over the lines, then by matched pieces), not the rounded percentage —
  // 1,38% of Rp 40.600.000 is Rp 280 off the Rp 560.000 the bill says.
  const discountMinor =
    detail.data !== undefined && orderGross > 0
      ? Math.round(
          (detail.data.discount_minor * (leftGross - shortGross)) / orderGross
        )
      : Math.round(((leftGross - shortGross) * discountBps) / 10000)
  const totalOrdered = rows.reduce((sum, row) => sum + owed(row), 0)
  // The discount per piece, as the order's page says it: the order's own
  // discount over the pieces it ordered, so the two pages never differ by a
  // rupiah of rounding.
  const orderPieces = (detail.data?.lines ?? []).reduce(
    (sum, line) => sum + line.ordered_quantity,
    0
  )
  const discountPerPiece =
    detail.data !== undefined && orderPieces > 0
      ? Math.round(detail.data.discount_minor / orderPieces)
      : 0
  const nameOfLogin = useNameOfLogin()
  // The delivery's unit, when the order was typed in one (kodi, lusin…), so
  // "not as ordered" can be said the way it was counted.
  const unitRow = rows.find(
    (row) => row.order_unit_code !== null && Number(row.unit_factor) > 1
  )
  // What the count found, for the title: any line off the order, short, over
  // or not as ordered. Before any early return — a hook cannot follow one.
  // The long delivery in one line, for the head: how many lines are off, so the
  // table need not be read to know what kind of count it is.
  const offCount = rows.filter(
    (row) => gap(row) !== 0 || wrongOf(row) > 0
  ).length
  // Matched lines can be set aside to read only what is off.
  const canHide = offCount > 0 && offCount < rows.length
  const visible =
    canHide && hideMatched
      ? rows.filter((row) => gap(row) !== 0 || wrongOf(row) > 0)
      : rows
  const flagged = rows.some((row) => gap(row) !== 0 || wrongOf(row) > 0)
    ? "warn"
    : "ok"
  useEffect(() => {
    onFlag(flagged)
    return () => onFlag(null)
  }, [flagged, onFlag])
  const counters = [...new Set(rows.map((row) => row.counted_by))]
  // A recount says so in the head: when the first count was taken, and why it
  // was sent back.
  const firstCounted = rows
    .map((row) => row.first_counted_at)
    .filter((at): at is string => at != null)
    .sort()[0]
  const recounted = firstCounted !== undefined
  // The Recount button's own note ("Count again") is not a reason.
  const recountReason = rows
    .find((row) => {
      const said = (row.recount_reason ?? "").trim()
      return said !== "" && said !== "Count again"
    })
    ?.recount_reason?.trim()
  const latest = rows.reduce(
    (newest, row) => (row.counted_at > newest ? row.counted_at : newest),
    rows[0]?.counted_at ?? ""
  )
  // The head, as the record sheet draws it: the supplier is the name; under it
  // what this is, who counted and when — and, for a recount, when the first
  // count was and why it was sent back.
  const counterNames =
    counters.length === 1
      ? nameOfLogin(counters[0])
      : `${count(counters.length)} people`
  const headCaption = [
    "Review Count",
    rows.length === 0
      ? null
      : `${recounted ? "Recounted" : "Counted"} by ${counterNames}, ${recentMoment(latest)}`,
    firstCounted === undefined ? null : `First count ${day(firstCounted)}`,
    recountReason === undefined ? null : `Recount reason: ${recountReason}`,
  ]
    .filter(Boolean)
    .join(" \u00b7 ")
  const headSupplierId =
    order === undefined
      ? null
      : recordOf(order.supplier_id, order.supplier_name)
  const headOrderId = order?.purchase_order_id ?? null
  useEffect(() => {
    onHead({
      supplier,
      supplierId: headSupplierId,
      orderId: headOrderId,
      caption: headCaption,
    })
  }, [supplier, headSupplierId, headOrderId, headCaption, onHead])
  useEffect(() => () => onHead(null), [onHead])

  // Minted once per count and per verb and kept across a retry: the batch is a
  // loop, and a retry after the third line failed resends the first two.
  const minted = useRef(new Map<string, string>())
  // Kept across a retry too, or the second try waits for excess that landed.
  const baseline = useRef<Map<string, number> | null>(null)
  // Set once the return has been told, so a retry does not tell it twice.
  const replacementRecorded = useRef(false)
  const keyFor = (subject: string) => {
    const existing = minted.current.get(subject)
    if (existing !== undefined) return existing
    const fresh = idempotencyKey()
    minted.current.set(subject, fresh)
    return fresh
  }

  const refresh = () => {
    // Accepted goods become stock, leave the queue and change the order.
    void client.invalidateQueries({ queryKey: keys.verifyQueue() })
    void client.invalidateQueries({ queryKey: keys.receipts() })
    void client.invalidateQueries({ queryKey: keys.purchaseWork() })
    void client.invalidateQueries({ queryKey: keys.pools() })
    void client.invalidateQueries({ queryKey: ["inventory", "movements"] })
    void client.invalidateQueries({ queryKey: keys.taggingJobs() })
    void client.invalidateQueries({ queryKey: procurementKeys.orders() })
    void client.invalidateQueries({ queryKey: procurementKeys.returns() })
    void client.invalidateQueries({ queryKey: recordKeys.all })
  }

  /// Why the rest was closed short, typed in the dialog; read when the count
  /// is accepted.
  const closeReason = useRef("")
  const accept = useMutation({
    mutationFn: async (choice: Short) => {
      const targets = rows
      setFrozen(targets)
      // What goes back to the supplier: everything beyond the order on a line
      // the checker marked as not as ordered — the wrong pieces and any over
      // that came with them — plus the over on the other lines too: it all
      // goes back, there is no option to keep it.
      const returnRows = rows.filter((row) => gap(row) > 0 || wrongOf(row) > 0)
      // What the order held in excess before this count lands, so the return
      // below waits for exactly this count's excess and not an older one.
      if (baseline.current === null) {
        baseline.current =
          returnRows.length > 0
            ? new Map(
                (await orderOf(po)).lines.map((line) => [
                  line.po_line_id,
                  line.excess_quantity,
                ])
              )
            : new Map<string, number>()
      }
      const before = baseline.current
      // Sequential: these writes land in the same delivery's movement group.
      for (const row of targets) {
        await dc.verifyPurchase({
          count_id: row.count_id,
          verifier_actor_id: actor,
          decision: "Accept",
          note: null,
          invoiced_price_minor: null,
          idempotency_key: keyFor(`Accept:${row.count_id}`),
        })
      }
      if (shorts.length > 0 && choice === "close") {
        await closeRestShort(
          shorts,
          actor,
          closeReason.current.trim() === ""
            ? "Closed short at count review"
            : closeReason.current.trim()
        )
      }
      if (returnRows.length > 0) {
        await returnOver(po, returnRows, before, keyFor(`Return:${po}`))
      }
      // A replacement order settles the return it was raised for.
      let replaced = false
      if (!replacementRecorded.current) {
        const pieces = targets.reduce(
          (sum, row) => sum + Math.min(correct(row), owed(row)),
          0
        )
        replaced = await settleReplacement(po, pieces)
        replacementRecorded.current = true
      }
      return { targets, replaced }
    },
    onSuccess: ({ targets, replaced }) => {
      minted.current.clear()
      baseline.current = null
      replacementRecorded.current = false
      refresh()
      void client.invalidateQueries({ queryKey: procurementKeys.orders() })
      if (replaced) {
        void client.invalidateQueries({ queryKey: supplierReturnKeys.all })
      }
      // The button says it, the sheet closes, the order's row takes it in
      // (owner, 2026-10-10: pull in + toast).
      void acceptSaid.say("Received").then(() => {
        setAccepted(targets)
        onClose()
        onSaved({
          from: acceptSaid.start(),
          rowId: order?.purchase_order_id,
          pill: lines(targets.length),
          title: `${lines(targets.length)} received${replaced ? " · replacement recorded" : ""}`,
          description: po,
        })
      })
    },
    onError: () => refresh(),
  })

  /// Recount goes straight back to the counter (owner, 2026-10-10: "recount
  /// langsung ke recount"): no ticking, no reason to type. The lines that are
  /// off go back, or every line when none is.
  const acceptSaid = useSaid()
  const recountSaid = useSaid()
  const recount = useMutation({
    mutationFn: async () => {
      // Kept on screen while the queue refetches, so the button can say it.
      setFrozen(rows)
      const off = rows.filter((row) => gap(row) !== 0 || wrongOf(row) > 0)
      const targets = off.length > 0 ? off : rows
      for (const row of targets) {
        await dc.verifyPurchase({
          count_id: row.count_id,
          verifier_actor_id: actor,
          decision: "Recount",
          note: "Count again",
          invoiced_price_minor: null,
          idempotency_key: keyFor(`Recount:${row.count_id}`),
        })
      }
      return targets.length
    },
    onSuccess: (n) => {
      minted.current.clear()
      refresh()
      void recountSaid.say("Sent to count").then(() => {
        onClose()
        onSaved({
          from: recountSaid.start(),
          rowId: order?.purchase_order_id,
          pill: lines(n),
          title: `${lines(n)} sent back to count`,
          description: po,
        })
      })
    },
  })

  // After accepting: the supplier's paper, which the DC will only take against
  // goods that were accepted. Then Done.
  if (accepted !== null) {
    const receiptId = accepted[0]?.receipt_id ?? null
    return (
      <>
        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-6">
          <Receipt>{lines(accepted.length)} accepted.</Receipt>
          {receiptId !== null && (
            <InvoiceBlock
              key={receiptId}
              receiptId={receiptId}
              counts={accepted}
            />
          )}
        </div>
        <div className="flex items-center justify-end border-t border-hairline px-6 py-4">
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </div>
      </>
    )
  }

  if (cancelled) {
    return <p className="p-6 text-body">This order is cancelled.</p>
  }

  if (rows.length === 0) {
    return <p className="p-6 text-body">Nothing to review.</p>
  }

  /// A labelled button beside the one that accepts, not an icon (owner,
  /// 2026-10-08: "bikin sebelah submit, jangan icon"): sending lines back to
  /// be counted again is a decision about this count, so it reads as one.
  const recountButton = (
    <Button
      variant="ghost"
      pending={recount.isPending}
      said={recountSaid.said}
      disabled={unnamed || rows.length === 0 || accept.isPending}
      onClick={(event) => {
        recountSaid.mark(event.currentTarget)
        recount.mutate()
      }}
    >
      Recount
    </Button>
  )

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-4 pt-4 pb-6 md:px-7 md:pt-6 md:pb-8 [&>*]:shrink-0">
        {unnamed && <NameTheVerifier />}

        {/* The figures, first — the one format of every record (hub-ui-patterns:
            head · figures · table · totals · foot): what was ordered, what
            was counted, what goes into stock, and what is off — short, extra
            or not as ordered, in red. Nothing is closed short yet: that is a
            choice in the foot, not a figure. */}
        {rows.length > 0 && (
          <KpiStrip className="mb-0!">
            <Kpi
              label={part ? "Ordered Left" : "Ordered"}
              value={pcs(totalOrdered)}
            />
            <Kpi label="Received" value={pcs(totalCounted + totalWrong)} />
            <Kpi label="Accepted" value={pcs(totalCounted - overQty)} />
            {shortQty > 0 && (
              <Kpi
                label="Short"
                value={<span className="text-bad-fg">{pcs(shortQty)}</span>}
              />
            )}
            {overQty > 0 && (
              <Kpi
                label="Extra"
                value={<span className="text-bad-fg">{pcs(overQty)}</span>}
              />
            )}
            {totalWrong > 0 && (
              <Kpi
                label="Not as Ordered"
                value={<span className="text-bad-fg">{pcs(totalWrong)}</span>}
              />
            )}
          </KpiStrip>
        )}

        {/* The verdict, the table it is about and what it is worth read as
          one block: closer to each other than to the rest. */}
        <div className="flex flex-col gap-4">
          {canHide && (
            <label className="flex items-center justify-end gap-2 text-[0.9375rem] text-body">
              Hide matched
              <Switch
                on={hideMatched}
                label="Hide Matched Items"
                onToggle={() => setHideMatched((v) => !v)}
              />
            </label>
          )}

          <ul className="flex flex-col gap-3 md:hidden">
            {visible.map((row) => {
              const diff = gap(row)
              return (
                <li
                  key={row.count_id}
                  className="flex flex-col gap-3 rounded-card border border-hairline p-4"
                >
                  <div className="min-w-0">
                    <TwoLines
                      top={
                        <>
                          {itemOf(row) === null ? (
                            row.article_name
                          ) : (
                            <button
                              type="button"
                              onClick={() => setLineShown(itemOf(row))}
                              className="record-link text-left"
                            >
                              {row.article_name}
                            </button>
                          )}
                          {(row.variants ?? []).length === 1 && (
                            <span className="font-normal">
                              {` ${variantLabel("", row.variants![0]).trim()}`}
                            </span>
                          )}
                        </>
                      }
                      bottom={kindOf(row)}
                    />
                  </div>
                  <dl className="grid grid-cols-2 gap-3 text-[0.9375rem]">
                    {/* With variants the counts are theirs, below; the card
                      keeps only the price and what it comes to. One variant
                      is the line itself: its name rides on the title. */}
                    {(row.variants ?? []).length <= 1 && (
                      <>
                        <div className="flex flex-col gap-0.5">
                          <dt className="text-mute">{orderedHead}</dt>
                          <dd className="text-body tabular-nums">
                            <Qty pieces={owed(row)} row={row} />
                          </dd>
                        </div>
                        <div className="flex flex-col gap-0.5">
                          <dt className="text-mute">Received</dt>
                          <dd className="tabular-nums">
                            <Qty
                              pieces={correct(row)}
                              row={row}
                              tone={diff === 0 ? "text-ok-fg" : "text-bad-fg"}
                            />
                            {diff !== 0 && (
                              <span className="block text-[0.9375rem] text-bad-fg">
                                {diff < 0
                                  ? `${inUnit(-diff, row)} short`
                                  : `+${inUnit(diff, row)} over`}
                              </span>
                            )}
                          </dd>
                        </div>
                      </>
                    )}
                    <div className="flex flex-col gap-0.5">
                      <dt className="text-mute">Unit Price</dt>
                      <dd className="text-ink tabular-nums">
                        {row.unit_price_minor === null
                          ? "—"
                          : `${money(row.unit_price_minor)} / pc`}
                      </dd>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <dt className="text-mute">Amount</dt>
                      <dd className="font-medium text-ink tabular-nums">
                        {row.unit_price_minor === null || correct(row) === 0
                          ? "—"
                          : money(amountOf(row))}
                      </dd>
                    </div>
                  </dl>
                  {/* Counted per variant (owner, 2026-10-10): each variant
                    under the line, its figures under the line's headings. */}
                  {(row.variants ?? []).length > 1 && (
                    <div className="ml-5 flex flex-col gap-3 border-l-[1.5px] border-hairline pl-3">
                      {(row.variants ?? []).map((variant, at) => {
                        const name = variantLabel(row.article_name, variant)
                        const own = variantLabel("", variant).trim()
                        return (
                          <div
                            key={variantKey(variant)}
                            className="flex flex-col gap-2"
                          >
                            <div className="flex min-w-0 items-center gap-3">
                              <VariantPhoto
                                urls={variant.image_urls}
                                fallback={imageOf(row)}
                                name={name}
                              />
                              <span
                                title={name}
                                className="line-clamp-2 min-w-0 text-[0.9375rem] text-ink"
                              >
                                {own}
                              </span>
                            </div>
                            <dl className="grid grid-cols-3 gap-3 text-[0.9375rem]">
                              <div className="flex flex-col">
                                <dt
                                  className={at === 0 ? "text-mute" : "sr-only"}
                                >
                                  {orderedHead}
                                </dt>
                                <dd className="text-body tabular-nums">
                                  {pcs(variant.outstanding_quantity)}
                                </dd>
                              </div>
                              <div className="flex flex-col">
                                <dt
                                  className={at === 0 ? "text-mute" : "sr-only"}
                                >
                                  Received
                                </dt>
                                <dd className="text-body tabular-nums">
                                  {pcs(variant.counted_quantity)}
                                </dd>
                              </div>
                              <div className="flex flex-col">
                                <dt
                                  className={at === 0 ? "text-mute" : "sr-only"}
                                >
                                  Difference
                                </dt>
                                <dd className="font-medium">
                                  <VariantDiff
                                    diff={
                                      variant.counted_quantity -
                                      variant.outstanding_quantity
                                    }
                                  />
                                </dd>
                              </div>
                            </dl>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>

          <div className="hidden overflow-clip rounded-card border border-hairline md:block">
            <div className="overflow-clip">
              <table className="w-full min-w-[44rem] table-fixed border-collapse">
                <colgroup>
                  <col />
                  <col className="w-[8.5rem]" />
                  <col className="w-[9.5rem]" />
                  <col className="w-[9.5rem]" />
                  <col className="w-[9.5rem]" />
                </colgroup>
                <thead>
                  <tr>
                    <th className={HEAD}>Item</th>
                    <th className={cn(HEAD, "text-right")}>{orderedHead}</th>
                    <th className={cn(HEAD, "text-right")}>Received</th>
                    <th className={cn(HEAD, "text-right")}>Unit Price</th>
                    <th className={cn(HEAD, "text-right")}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((row) => {
                    const diff = gap(row)
                    const variants = row.variants ?? []
                    return (
                      <Fragment key={row.count_id}>
                        {variants.length === 0 ? (
                          <tr className={ARTICLE_ROW}>
                            <td className={CELL}>
                              <div
                                title={row.article_name}
                                className="min-w-0 py-1"
                              >
                                {itemName(
                                  row,
                                  "line-clamp-2 leading-[1.4] font-medium text-ink"
                                )}
                                <div className="mt-1 truncate text-[0.9375rem] leading-[1.4] text-mute">
                                  {kindOf(row)}
                                </div>
                              </div>
                            </td>
                            <td className={cn(CELL, NUMR)}>
                              <Qty pieces={owed(row)} row={row} end />
                            </td>
                            <td className={cn(CELL, NUMR)}>
                              {/* Green when the count is what was expected, red
                                when it is over or under, and by how much
                                (owner, 2026-10-12). */}
                              <Qty
                                pieces={correct(row)}
                                row={row}
                                end
                                tone={diff === 0 ? "text-ok-fg" : "text-bad-fg"}
                              />
                              {diff !== 0 && (
                                <span className="block text-[0.9375rem] text-bad-fg">
                                  {diff < 0
                                    ? `${inUnit(-diff, row)} short`
                                    : `+${inUnit(diff, row)} over`}
                                </span>
                              )}
                            </td>
                            <td className={cn(CELL, NUMR, "text-ink")}>
                              {row.unit_price_minor === null
                                ? "—"
                                : `${money(row.unit_price_minor)} / pc`}
                            </td>
                            <td
                              className={cn(CELL, NUMR, "font-medium text-ink")}
                            >
                              {row.unit_price_minor === null ||
                              correct(row) === 0 ? (
                                <span className="text-faint">—</span>
                              ) : (
                                money(amountOf(row))
                              )}
                            </td>
                          </tr>
                        ) : (
                          /* Variants are the rows (owner, 2026-10-18): no row
                          for the article. Its name and kind ride on the first
                          variant; the rest hang off it on a guide line, the
                          price said once. */
                          variants.map((variant, at) => {
                            const name = variantLabel(row.article_name, variant)
                            const own = variantLabel("", variant).trim()
                            const vdiff =
                              variant.counted_quantity -
                              variant.outstanding_quantity
                            return (
                              <tr
                                key={variantKey(variant)}
                                className={
                                  at === 0
                                    ? ARTICLE_ROW
                                    : "border-t border-dashed border-hairline"
                                }
                              >
                                <td className={CELL}>
                                  <div className="flex min-w-0 items-center gap-3">
                                    {at > 0 && (
                                      <span
                                        aria-hidden
                                        className={cn(
                                          GUIDE,
                                          at === variants.length - 1 &&
                                            "before:bottom-1/2"
                                        )}
                                      />
                                    )}
                                    <VariantPhoto
                                      urls={variant.image_urls}
                                      fallback={imageOf(row)}
                                      name={name}
                                      slot
                                    />
                                    {at === 0 ? (
                                      <div
                                        title={name}
                                        className="min-w-0 py-1"
                                      >
                                        <div className="flex min-w-0 items-baseline gap-1.5">
                                          {itemName(
                                            row,
                                            "truncate leading-[1.4] font-medium text-ink"
                                          )}
                                          <span className="shrink-0 text-ink">
                                            {own}
                                          </span>
                                        </div>
                                        <div className="mt-1 truncate text-[0.9375rem] leading-[1.4] text-mute">
                                          {kindOf(row)}
                                        </div>
                                      </div>
                                    ) : (
                                      <span
                                        title={name}
                                        className="line-clamp-2 min-w-0 text-ink"
                                      >
                                        {own}
                                      </span>
                                    )}
                                  </div>
                                </td>
                                <td className={cn(CELL, NUMR)}>
                                  {pcs(variant.outstanding_quantity)}
                                </td>
                                <td className={cn(CELL, NUMR)}>
                                  <span
                                    className={
                                      vdiff === 0 ? "text-ok-fg" : "text-bad-fg"
                                    }
                                  >
                                    {pcs(variant.counted_quantity)}
                                  </span>
                                  <span className="block font-medium">
                                    <VariantDiff diff={vdiff} />
                                  </span>
                                </td>
                                <td className={cn(CELL, NUMR, "text-ink")}>
                                  {at > 0 ? (
                                    <span className="text-faint">〃</span>
                                  ) : row.unit_price_minor === null ? (
                                    "—"
                                  ) : (
                                    `${money(row.unit_price_minor)} / pc`
                                  )}
                                </td>
                                <td
                                  className={cn(
                                    CELL,
                                    NUMR,
                                    "font-medium text-ink"
                                  )}
                                >
                                  {row.unit_price_minor === null ||
                                  variant.counted_quantity === 0 ? (
                                    <span className="text-faint">—</span>
                                  ) : (
                                    money(
                                      Math.min(
                                        variant.counted_quantity,
                                        variant.outstanding_quantity
                                      ) * row.unit_price_minor
                                    )
                                  )}
                                </td>
                              </tr>
                            )
                          })
                        )}
                      </Fragment>
                    )
                  })}
                </tbody>
                <tfoot>
                  {totalWrong > 0 && (
                    <tr className="border-t border-hairline bg-soft-2">
                      <td
                        className={cn(
                          CELL,
                          "font-medium whitespace-nowrap text-body"
                        )}
                      >
                        Not as Ordered
                      </td>
                      <td className={CELL} />
                      <td className={cn(CELL, NUMR)}>
                        <Qty
                          pieces={totalWrong}
                          row={unitRow ?? rows[0]}
                          tone="text-bad-fg"
                          end
                        />
                      </td>
                      <td className={CELL} />
                      <td className={cn(CELL, NUMR, "text-faint")}>—</td>
                    </tr>
                  )}
                </tfoot>
              </table>
            </div>
          </div>
        </div>

        {/* Under the table, at the right: the money only — what the order
          is worth and what this count accepts of it (owner, 14 Oct: "di total
          bawah kanan ya harganya total berapa lalu accepted berapa"). The
          pieces are the figures at the top. */}
        {priced && (
          <div className="flex justify-end">
            <dl className="order-totals grid w-full grid-cols-[1fr_auto] items-center gap-x-10 gap-y-2.5 text-[0.9375rem] tabular-nums md:w-[19rem]">
              <dt className="text-body">
                {part ? "Total PO Left" : "Total PO"}
                <span className="text-mute"> · {pcs(totalOrdered)}</span>
              </dt>
              <dd className="text-right text-ink">{money(leftGross)}</dd>
              {discountBps > 0 && (
                <>
                  <dt className="text-body">
                    {`Discount \u00b7 ${percentBps(discountBps)}`}
                    {/* Per piece, under it, as the order's page says it. */}
                    {discountPerPiece > 0 && (
                      <span className="block text-mute">
                        {money(discountPerPiece)} / pc
                      </span>
                    )}
                  </dt>
                  <dd className="text-right text-ink">
                    {money(-discountMinor)}
                  </dd>
                </>
              )}
              <div
                aria-hidden
                className="col-span-2 border-t border-hairline"
              />
              {/* As the order's own totals say it: the pieces beside the word. */}
              <dt className="font-semibold text-ink">
                Accepted · {pcs(totalCounted - overQty)}
              </dt>
              <dd className="text-right text-base leading-[1.375rem] font-semibold text-ink">
                {money(leftGross - shortGross - discountMinor)}
              </dd>
              {/* What goes back to the supplier on Submit: the extra and the
                  not as ordered (owner, 2026-10-16). */}
              {overQty + totalWrong > 0 && (
                <>
                  <dt className="mt-3 text-body">To Be Returned</dt>
                  <dd className="mt-3 text-right text-bad-fg">
                    {pcs(overQty + totalWrong)}
                  </dd>
                </>
              )}
            </dl>
          </div>
        )}

        <Problem error={accept.error ?? recount.error} />
      </div>

      {/* One row on every screen, the main action last — not a grid on a phone
          with it on top and full width, and a row on a desk with it at the
          right (the owner, 2026-10-05: "jangan dibedakan"). It wraps only when
          the buttons cannot share the width. */}
      <div className="flex flex-wrap items-center gap-2 border-t border-hairline px-4 py-3 md:min-h-16 md:px-7 md:py-3 [&_button]:h-9 max-md:[&_button]:h-11 max-md:[&>*]:flex-1">
        {/* Once something has already come in: what it was, from the left of
          the foot — read-only, so quiet (owner, 2026-10-12). */}
        {part && (
          <Button variant="ghost" onClick={() => setLastReceiving(true)}>
            Last Receiving
          </Button>
        )}
        <span className="flex-1" />
        {/* A short count's one decision is the button itself: no choice to
          set and then confirm. Primary is the one that keeps the order
          open; closing it short is the deliberate other. */}
        {shorts.length > 0 ? (
          <>
            {/* Closing short cannot be undone, so it asks, in a dialog. Keeping
              the order open asks nothing: the rest can still be closed
              later. */}
            {/* Recount always first, at the left of the three (owner,
              2026-10-10); Close Short in red; the primary last. */}
            {recountButton}
            <ConfirmButton
              label="Close Short"
              tone="danger"
              variant="destructive"
              title="Close This Short?"
              // What closing short does, worked out before it is done (owner,
              // 2026-10-16): the order, what is closed, what is accepted.
              description={
                <div className="flex flex-col gap-4">
                  <span>
                    The PO completes as received. This can&apos;t be undone.
                  </span>
                  <dl className="grid grid-cols-[1fr_auto] items-center gap-x-8 gap-y-2 text-[0.9375rem] tabular-nums">
                    <dt className="text-body">{`${part ? "Total PO Left" : "Total PO"} \u00b7 ${pcs(totalOrdered)}`}</dt>
                    <dd className="text-right text-ink">
                      {priced ? money(leftGross) : ""}
                    </dd>
                    <dt className="text-body">{`Closed Short \u00b7 ${pcs(shortQty)}`}</dt>
                    <dd className="text-right text-bad-fg">
                      {priced ? money(-shortGross) : ""}
                    </dd>
                    {priced && discountBps > 0 && (
                      <>
                        <dt className="text-body">
                          {`Discount \u00b7 ${percentBps(discountBps)}`}
                          {discountPerPiece > 0 && (
                            <span className="block text-mute">
                              {money(discountPerPiece)} / pc
                            </span>
                          )}
                        </dt>
                        <dd className="text-right text-ink">
                          {money(-discountMinor)}
                        </dd>
                      </>
                    )}
                    <div
                      aria-hidden
                      className="col-span-2 border-t border-hairline"
                    />
                    <dt className="font-semibold text-ink">
                      {`Accepted \u00b7 ${pcs(totalCounted - overQty)}`}
                    </dt>
                    <dd className="text-right font-semibold text-ink">
                      {priced
                        ? money(leftGross - shortGross - discountMinor)
                        : ""}
                    </dd>
                    {overQty + totalWrong > 0 && (
                      <>
                        <dt className="text-body">To Be Returned</dt>
                        <dd className="text-right text-bad-fg">
                          {pcs(overQty + totalWrong)}
                        </dd>
                      </>
                    )}
                  </dl>
                </div>
              }
              confirmLabel="Close Short"
              reason={{ label: "Reason for Closing", optional: true }}
              disabled={unnamed || rows.length === 0 || accept.isPending}
              pending={accept.isPending}
              onConfirm={(reason) => {
                closeReason.current = reason
                return accept.mutateAsync("close")
              }}
            />
            <Button
              variant="primary"
              pending={accept.isPending}
              title={`${pcs(shortQty)} stay open on the order`}
              disabled={unnamed || rows.length === 0}
              said={acceptSaid.said}
              onClick={(event) => {
                acceptSaid.mark(event.currentTarget)
                accept.mutate("keep")
              }}
            >
              {!accept.isPending && <Check />}
              {accept.isPending ? "Submitting…" : "Partial Receive"}
            </Button>
          </>
        ) : (
          <>
            {recountButton}
            <Button
              variant="primary"
              pending={accept.isPending}
              disabled={unnamed || rows.length === 0}
              said={acceptSaid.said}
              onClick={(event) => {
                acceptSaid.mark(event.currentTarget)
                accept.mutate("keep")
              }}
            >
              {!accept.isPending && <Check />}
              {accept.isPending ? "Submitting…" : "Submit"}
            </Button>
          </>
        )}
      </div>
      <LastReceiving
        open={lastReceiving}
        onOpenChange={setLastReceiving}
        order={detail.data}
        supplier={supplier}
      />
      <LineSheet line={lineShown} po={po} onClose={() => setLineShown(null)} />
    </>
  )
}

/// A column heading as every hub table sets one.
const HEAD =
  "border-b border-hairline bg-soft px-4 py-2.5 text-left text-eyebrow leading-tight font-medium text-body lg:whitespace-nowrap"
const CELL = "px-4 py-3.5 align-middle"
/// A figure set against the right edge of its column, in tabular digits.
const NUMR = "text-right text-[0.9375rem] text-body tabular-nums"
/// The first row of an article: a darker rule sets it off from the one above.
const ARTICLE_ROW =
  "h-16 border-t border-hairline-strong first:border-t-hairline"
/// A later variant's tie to the first: a line down the photo column, one
/// stroke out to its own photo.
const GUIDE =
  "relative w-10 shrink-0 self-stretch before:absolute before:-top-[15px] before:-bottom-[15px] before:left-[19px] before:border-l-[1.5px] before:border-hairline before:content-[''] after:absolute after:top-1/2 after:left-[19px] after:w-3.5 after:border-t-[1.5px] after:border-hairline after:content-['']"

/// Raise the return for what came beyond the order, once head office holds the
/// receipt. The acceptance is written at the DC and reaches head office a few
/// seconds later; asking before it lands finds no excess to return.
async function returnOver(
  po: string,
  rows: readonly Count[],
  before: ReadonlyMap<string, number>,
  key: string
) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const order = await orderOf(po)
    const landed = rows.every((row) => {
      const line = order.lines.find((one) => one.po_line_id === row.po_line_id)
      return (
        line !== undefined &&
        line.excess_quantity >=
          (before.get(row.po_line_id) ?? 0) +
            Math.max(0, gap(row)) +
            wrongOf(row)
      )
    })
    if (landed) {
      await raisePurchaseReturn(
        order.purchase_order_id,
        { po_line_ids: rows.map((row) => row.po_line_id) },
        key
      )
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 3000))
  }
  throw new Error(
    "The goods were accepted, but head office has not received them yet — return the extra from the order once it shows."
  )
}

/// The supplier's paper, and the arithmetic that says whether it agrees.
///
/// **The verifier's, not the checker's.** The checker is counting garments off
/// a pallet with the ordered quantity deliberately hidden from them; the
/// invoice is a price list for the same delivery, and handing it to them is
/// handing them the answer. It belongs one station along, with the person who
/// is already comparing.
///
/// Three things happen here, in the order a person does them: the page is
/// **uploaded**, the numbers on it are **typed**, and the total is
/// **compared** against what the same goods are worth at the agreed price.
/// The comparison is the point of the other two — a difference does not hold
/// the delivery, it goes to whoever raised the order.
function InvoiceBlock({
  receiptId,
  counts,
}: {
  receiptId: string
  /// The counts on this delivery that are still waiting, which is what the
  /// invoice gets compared against.
  counts: readonly PurchaseCountAwaitingVerification[]
}) {
  const actor = useEdgeActor()
  const client = useQueryClient()

  const receipts = useQuery({
    queryKey: keys.receipts(),
    queryFn: ({ signal }) => dc.goodsReceipts(signal),
  })
  const receipt = (receipts.data ?? []).find(
    (row) => row.receipt_id === receiptId
  )

  const upload = useMutation({
    mutationFn: (file: File) =>
      dc.uploadInvoiceDocument(receiptId, file, actor),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.receipts() })
      void client.invalidateQueries({
        queryKey: keys.invoiceDocument(receiptId),
      })
    },
  })

  const record = useMutation({
    mutationFn: (value: { number: string; date: string; totalMinor: string }) =>
      dc.recordInvoice(receiptId, {
        receipt_id: receiptId,
        invoice_number: value.number.trim(),
        // The day on the supplier's paper, sent as the day. Passing it through
        // a clock is how a date-only field acquires a timezone: `new Date(day)`
        // reads a non-ISO value as WIB, and `toISOString()` then files it as
        // the day before. The column at the centre is a `date`.
        invoice_date: value.date.trim() === "" ? null : value.date.trim(),
        invoice_total_minor: Number(value.totalMinor),
        // The uploaded page IS the reference now. It was a string somebody
        // typed — a folder name, a shelf — and a reference nobody can follow
        // is a field that only looks filled in.
        invoice_document_ref: null,
        actor_id: actor,
        // The invoice is money. Recorded twice against one delivery it is a
        // second liability the supplier never issued.
        idempotency_key: idempotencyKey(),
      }),
    onSuccess: () => {
      form.reset()
      void client.invalidateQueries({ queryKey: keys.receipts() })
    },
  })

  const form = useForm({
    defaultValues: { number: "", date: "", totalMinor: "" },
    onSubmit: ({ value }) => {
      if (value.number.trim() === "") return
      record.mutate(value)
    },
  })

  // What the goods on this delivery are worth at the price that was agreed
  // when the order was raised. Lines whose price the order never carried are
  // counted as unpriced rather than as zero: a missing price is not free
  // goods, and silently treating it as nothing understates the total the
  // verifier is comparing against.
  // Only this order's lines, and only what was accepted: pieces beyond the
  // order go back to the supplier, so they are not worth the agreed price.
  const priced = counts.filter((row) => row.unit_price_minor !== null)
  const agreedMinor = priced.reduce(
    (total, row) =>
      total + Math.min(correct(row), owed(row)) * (row.unit_price_minor ?? 0),
    0
  )
  const invoicedMinor = receipt?.invoice_total_minor ?? null
  const difference = invoicedMinor === null ? null : invoicedMinor - agreedMinor
  // The node files an invoice only against goods somebody has already
  // accepted (`record_receipt_invoice`: an invoice fact queued ahead of the
  // first line fact is one the centre can never apply). So the paper is typed
  // while comparing, and recorded once the first line is in — refusing the
  // press here, with the reason, instead of letting the node refuse it.
  const nothingAccepted = (receipt?.accepted_lines ?? 0) === 0
  // A delivery counts every order of one supplier under one receipt. An
  // invoice that is on it without this review having recorded it was filed
  // with another order: its total is not this order's to compare.
  const filedBefore = receipt?.invoice_number != null && !record.isSuccess

  return (
    <div className="rounded-inner border border-hairline p-3.5">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="text-[0.9375rem] font-semibold text-ink">
          Invoice for this order
        </h3>
        <span className="font-mono text-[0.9375rem] text-mute">
          {receipt?.receipt_number}
        </span>
      </div>

      {/* The page on the left, what is typed off it on the right. Stacked,
          these three fields were single lines the width of the whole sheet —
          a 60rem box for an invoice number is a line the eye loses its place
          on, and it is the shape the wide sheet had to be tidied out of. */}
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <InvoicePage
            receiptId={receiptId}
            onFile={(file) => upload.mutate(file)}
            uploading={upload.isPending}
            uploaded={upload.data ?? null}
          />
          <Problem error={upload.error} className="mt-2.5" />
        </div>

        {filedBefore ? (
          <p className="text-body">
            {`Invoice ${receipt?.invoice_number} was filed with receipt ${receipt?.receipt_number} for several orders.`}
          </p>
        ) : receipt?.invoice_number ? (
          <div>
            <Facts>
              <Fact term="Invoice">{receipt.invoice_number}</Fact>
              <Fact term="Billed">{money(invoicedMinor)}</Fact>
              <Fact term="Price for what was counted">
                {money(agreedMinor)}
              </Fact>
            </Facts>

            {difference !== null && (
              <div className="mt-3">
                <Pill tone={difference === 0 ? "ok" : "bad"}>
                  {difference === 0
                    ? "The invoice agrees"
                    : `${money(Math.abs(difference))} ${difference > 0 ? "over" : "under"} the agreed price`}
                </Pill>
              </div>
            )}
          </div>
        ) : (
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault()
              form.handleSubmit()
            }}
          >
            <form.Field name="number">
              {(field) => (
                <Field label="Invoice Number" required>
                  <Input
                    className="font-mono"
                    value={field.state.value}
                    onChange={(event) => field.handleChange(event.target.value)}
                  />
                </Field>
              )}
            </form.Field>
            <form.Field name="totalMinor">
              {(field) => (
                <Field label="Invoice Total">
                  <Money
                    prefix="Rp"
                    value={field.state.value}
                    onChange={field.handleChange}
                  />
                </Field>
              )}
            </form.Field>
            <form.Field name="date">
              {(field) => (
                <Field label="Invoice Date">
                  <Input
                    type="date"
                    value={field.state.value}
                    onChange={(event) => field.handleChange(event.target.value)}
                  />
                </Field>
              )}
            </form.Field>
            <div className="flex items-center gap-3">
              <p className="flex-1 text-[0.9375rem] text-mute">
                {nothingAccepted && "Accept the goods first."}
              </p>
              <Button
                variant="primary"
                type="submit"
                pending={record.isPending}
                disabled={nothingAccepted}
              >
                {record.isPending ? "Submitting…" : "Submit"}
              </Button>
            </div>
            <Problem error={record.error} />
          </form>
        )}
      </div>
    </div>
  )
}

/// The page itself: what is on file, or the control that puts one there.
///
/// The bytes are fetched rather than linked. This node authenticates with a
/// bearer token the client holds, so an `<img src>` or an anchor arrives
/// without it and is refused.
///
/// The object URL is made where it is used and revoked the moment it has been
/// — on the image's own `load`, and a tick after the tab opens. Not held in
/// state: an object URL in `useState` is revoked by an effect's cleanup, and
/// under StrictMode that cleanup runs once before the component is really
/// mounted, leaving a picture pointing at a URL the browser has already
/// forgotten.
function InvoicePage({
  receiptId,
  onFile,
  uploading,
  uploaded,
}: {
  receiptId: string
  onFile: (file: File) => void
  uploading: boolean
  uploaded: InvoiceDocumentView | null
}) {
  const page = useQuery({
    queryKey: keys.invoiceDocument(receiptId),
    queryFn: ({ signal }) => dc.invoiceDocument(receiptId, signal),
    // A delivery with no page on file answers 404, which is an answer and not
    // a failure. Retrying it four times is four requests saying the same
    // thing.
    retry: false,
  })

  const bytes = page.data ?? null
  const pdf = bytes?.type === "application/pdf"

  const draw = useCallback(
    (element: HTMLImageElement | null) => {
      if (element === null || bytes === null) return
      const url = URL.createObjectURL(bytes)
      const done = () => URL.revokeObjectURL(url)
      element.onload = done
      element.onerror = done
      element.src = url
    },
    [bytes]
  )

  const openPdf = () => {
    if (bytes === null) return
    const url = URL.createObjectURL(bytes)
    window.open(url, "_blank", "noreferrer")
    // The tab has the bytes by now; the URL is only the handle it was passed.
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }

  return (
    <div className="flex flex-col gap-2.5">
      {bytes !== null &&
        (pdf ? (
          <Button variant="soft" className="justify-start" onClick={openPdf}>
            <FileText />
            Open the invoice (PDF)
          </Button>
        ) : (
          <img
            ref={draw}
            alt="Supplier invoice"
            className="max-h-[16rem] w-full rounded-inner border border-hairline bg-soft-2 object-contain"
          />
        ))}

      <label className="flex min-h-tap cursor-pointer items-center justify-center gap-2 rounded-full border border-dashed border-hairline-2 px-3.5 text-[0.9375rem] text-body transition-colors hover:border-hairline-strong hover:bg-soft">
        <Upload className="size-4 text-line-ico" />
        {uploading
          ? "Uploading…"
          : bytes !== null || uploaded !== null
            ? "Replace"
            : "Upload invoice"}
        <input
          type="file"
          accept="image/*,application/pdf"
          className="sr-only"
          disabled={uploading}
          onChange={(event) => {
            const file = event.target.files?.[0]
            // Cleared so choosing the same file twice — after a failed upload
            // — still fires a change.
            event.target.value = ""
            if (file !== undefined) onFile(file)
          }}
        />
      </label>
    </div>
  )
}

/// Who is standing at the bay, asked where they are blocked.
///
/// The same name `Node → Account` collects, in the one place a person actually
/// discovers they need it: a verifier who has never opened the node's own
/// settings has no reason to know that a warehouse with sign-in switched off
/// needs to be told a name before it will let a count be accepted.
function NameTheVerifier() {
  const [name, setName] = useState("")
  return (
    <form
      className="flex flex-wrap items-center gap-3 rounded-inner border border-hairline bg-soft px-4 py-3.5"
      onSubmit={(event) => {
        event.preventDefault()
        if (name.trim() !== "") setBenchActor(name)
      }}
    >
      <span className="min-w-[10rem] flex-1 text-body">Who is verifying?</span>
      <Input
        className="w-[11rem]"
        aria-label="Who is verifying"
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <Button variant="primary" type="submit" disabled={name.trim() === ""}>
        Submit
      </Button>
    </form>
  )
}

/// Close short what is still owed on accepted lines, at head office.
///
/// The acceptance is written at the DC and reaches head office as a receipt a
/// few seconds later; closing short before it lands would record the whole
/// line as missing. So each line is retried until head office has the receipt
/// — a refusal saying nothing is outstanding means it is already settled.
async function closeRestShort(
  rows: readonly PurchaseCountAwaitingVerification[],
  actor: string,
  note: string
) {
  const reason =
    note.trim() === "" ? "Closed short at verification" : note.trim()
  for (const row of rows) {
    if (correct(row) >= row.outstanding_stock_units) continue
    let settled = false
    for (let attempt = 0; attempt < 20 && !settled; attempt += 1) {
      const page = await purchaseOrderPage({ q: row.po_number })
      const order = page.rows.find((one) => one.po_number === row.po_number)
      const line =
        order === undefined
          ? undefined
          : (await purchaseOrderDetail(order.purchase_order_id)).lines.find(
              (one) => one.po_line_id === row.po_line_id
            )
      // What head office should hold once this count lands: what was
      // already matched before it, plus this count.
      const want =
        line === undefined
          ? Number.POSITIVE_INFINITY
          : line.ordered_quantity - row.outstanding_stock_units + correct(row)
      const landed = line !== undefined && line.received_quantity >= want
      if (landed) {
        await closeLineShort(row.po_line_id, actor, reason)
        settled = true
      } else {
        await new Promise((resolve) => setTimeout(resolve, 3000))
      }
    }
    if (!settled)
      throw new Error(
        `${row.article_name} was accepted, but head office has not received it yet — close it short from the order once it shows as received.`
      )
  }
}

/// A variant's difference, signed, as the line's is drawn: "−3 pcs", "+2 pcs".
function VariantDiff({ diff }: { diff: number }) {
  if (diff === 0)
    return (
      <span className="inline-flex items-center gap-1.5 text-ok-fg">
        <Check className="size-4" />
        Matches
      </span>
    )
  return (
    <span className="inline-block rounded-inner bg-bad-bg px-2.5 py-1 whitespace-nowrap text-bad-fg">
      {diff < 0 ? `−${pcs(-diff)}` : `+${pcs(diff)}`}
    </span>
  )
}

/// A quantity in pieces, said in the line's order unit: 185 pcs of a KODI
/// line is "9 kodi 5 pcs". Pieces stay the truth; the unit is how people talk.
/// A line ordered in pieces (no unit, or a factor of 1) is just "N pcs".
function inUnit(quantity: number, row: Count) {
  const piece = (row.stock_unit_code ?? "PCS").toLowerCase()
  const factor = Number(row.unit_factor)
  const code = row.order_unit_code
  const said = (n: number) =>
    `${count(n)} ${piece === "pcs" && n === 1 ? "pc" : piece}`
  if (code === null || !Number.isFinite(factor) || factor <= 1)
    return said(quantity)
  const whole = Math.floor(quantity / factor)
  const rest = quantity - whole * factor
  const parts = [
    whole > 0 ? `${count(whole)} ${code.toLowerCase()}` : "",
    rest > 0 ? said(rest) : "",
  ].filter((part) => part !== "")
  return parts.length === 0 ? `0 ${code.toLowerCase()}` : parts.join(" ")
}

/// A quantity cell: the unit amount in bold, the pieces under it in quiet type
/// when the line has a unit. Nothing is a dash.
function Qty({
  pieces,
  row,
  tone = "text-body",
  end = false,
}: {
  pieces: number
  row: Count
  tone?: string
  /// Set against the right edge, where the figures of a column stand.
  end?: boolean
}) {
  if (pieces === 0) return <span className="text-mute">—</span>
  const unit = row.order_unit_code !== null && Number(row.unit_factor) > 1
  // Pieces first, whatever unit the order was typed in; the unit, when there
  // is one, stands under them.
  return (
    <span
      className={cn(
        "flex flex-col leading-tight",
        end ? "items-end" : "items-start"
      )}
    >
      <span className={tone}>
        {pieces === 1 && (row.stock_unit_code ?? "PCS") === "PCS"
          ? "1 pc"
          : `${count(pieces)} ${(row.stock_unit_code ?? "PCS").toLowerCase()}`}
      </span>
      {unit && (
        <span className="text-[0.9375rem] font-normal text-mute">
          {inUnit(pieces, row)}
        </span>
      )}
    </span>
  )
}

/// The receiving that came before this count, as a dialog over Review Count
/// and in its own dress: Item | Ordered (Left) | Received | Unit Price | Amount,
/// the figures and the money below, Done at the right (owner, 2026-10-12). The
/// latest receiving only; the earlier ones are on the order's page.
function LastReceiving({
  open,
  onOpenChange,
  order,
  supplier,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  order: PurchaseOrderDetail | undefined
  supplier: string | undefined
}) {
  const nameOfLogin = useNameOfLogin()
  const all =
    order?.lines.flatMap((line) =>
      (line.receipts ?? []).map((receipt) => ({ line, receipt }))
    ) ?? []
  const latest = all.reduce<(typeof all)[number] | null>(
    (best, one) =>
      best === null ||
      one.receipt.received_at > best.receipt.received_at ||
      (one.receipt.received_at === best.receipt.received_at &&
        one.receipt.receipt_number > best.receipt.receipt_number)
        ? one
        : best,
    null
  )
  if (order === undefined || latest === null) return null
  const mine = all.filter(
    (one) => one.receipt.receipt_number === latest.receipt.receipt_number
  )
  const earlier = new Set(all.map((one) => one.receipt.receipt_number)).size - 1
  // What was still expected going into this receiving.
  const leftThen = (one: (typeof all)[number]) =>
    Math.max(
      0,
      one.line.ordered_quantity -
        (one.line.received_quantity - one.receipt.matched_quantity)
    )
  const first = earlier === 0
  const gross = mine.reduce(
    (sum, one) => sum + lineValue(one.line, one.receipt.matched_quantity),
    0
  )
  const orderGross = order.lines.reduce(
    (sum, line) => sum + lineValue(line, line.ordered_quantity),
    0
  )
  const bps =
    order.discount_bps ??
    (orderGross > 0
      ? Math.round((order.discount_minor * 10000) / orderGross)
      : 0)
  const discount = Math.round((gross * bps) / 10000)
  const figure = (term: string, pieces: number, at: number) => (
    <div
      key={term}
      className={cn(
        "px-5 py-2",
        at === 0 ? "max-md:pl-0" : "border-l border-hairline"
      )}
    >
      <dt className="text-body">{term}</dt>
      <dd className="text-[1.125rem] leading-6 font-semibold tracking-[-0.02em] text-ink tabular-nums">
        {count(pieces)}
        <span className="ml-1 text-[0.9375rem] font-normal tracking-normal text-body">
          pcs
        </span>
      </dd>
    </div>
  )
  return (
    <BaseDialog.Root open={open} onOpenChange={onOpenChange}>
      <BaseDialog.Portal>
        <BaseDialog.Backdrop
          forceRender
          className="fixed inset-0 z-50 bg-[var(--scrim)] transition-opacity duration-(--t-panel) ease-(--ease-out) data-[ending-style]:opacity-0 data-[starting-style]:opacity-0"
        />
        <BaseDialog.Popup className="fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100vh-3rem)] w-[min(56rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-shell border border-hairline bg-canvas shadow-float transition-[opacity,scale] duration-(--t-panel) ease-(--ease-out) outline-none data-[ending-style]:scale-[0.96] data-[ending-style]:opacity-0 data-[starting-style]:scale-[0.96] data-[starting-style]:opacity-0 motion-reduce:data-[ending-style]:scale-100 motion-reduce:data-[starting-style]:scale-100">
          <div className="flex items-center gap-3 border-b border-hairline px-4 py-4 md:px-7 md:py-3">
            <div className="min-w-0 flex-1">
              <BaseDialog.Title className="text-card-title font-semibold text-ink">
                Last Receiving
              </BaseDialog.Title>
              <div className="flex flex-wrap gap-x-4 text-[0.9375rem] text-mute">
                {supplier !== undefined && <span>{supplier}</span>}
                <span className="font-mono">{order.po_number}</span>
                <span>
                  {latest.receipt.received_by
                    ? `Received by ${nameOfLogin(latest.receipt.received_by)}, ${day(latest.receipt.received_at)}`
                    : `Received ${day(latest.receipt.received_at)}`}
                </span>
              </div>
            </div>
            {/* A receiving read back is a finished document: it wears the
                stamp, with its day. */}
            <DocStamp
              word="Received"
              at={latest.receipt.received_at}
              tone="ok"
              className="static mr-2 shrink-0"
            />
            <BaseDialog.Close
              aria-label="Close"
              className="sheet-close btn-iconly grid size-8 shrink-0 place-items-center rounded-inner text-line-ico transition-colors hover:bg-soft-2 hover:text-ink pointer-coarse:size-tap"
            >
              <X className="size-4" />
              <span aria-hidden className="btn-word hidden">
                Close
              </span>
            </BaseDialog.Close>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-4 pt-4 pb-6 md:px-8 md:pt-5 md:pb-8 [&>*]:shrink-0">
            <div className="overflow-x-auto rounded-card border border-hairline">
              <table className="w-full min-w-[40rem] table-fixed border-collapse">
                <colgroup>
                  <col />
                  <col className="w-[8.5rem]" />
                  <col className="w-[9.5rem]" />
                  <col className="w-[9.5rem]" />
                  <col className="w-[9.5rem]" />
                </colgroup>
                <thead>
                  <tr>
                    <th className={HEAD}>Item</th>
                    <th className={cn(HEAD, "text-right")}>
                      {first ? "Ordered" : "Ordered Left"}
                    </th>
                    <th className={cn(HEAD, "text-right")}>Received</th>
                    <th className={cn(HEAD, "text-right")}>Unit Price</th>
                    <th className={cn(HEAD, "text-right")}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {mine.map((one) => (
                    <tr
                      key={one.line.po_line_id}
                      className="border-t border-hairline"
                    >
                      <td className={CELL}>
                        <div className="line-clamp-2 leading-[1.4] font-medium text-ink">
                          {one.line.article_name}
                        </div>
                      </td>
                      <td className={cn(CELL, NUMR)}>{pcs(leftThen(one))}</td>
                      <td className={cn(CELL, NUMR, "text-ink")}>
                        {pcs(one.receipt.matched_quantity)}
                      </td>
                      <td className={cn(CELL, NUMR, "text-ink")}>
                        {one.line.unit_price_minor === null
                          ? "—"
                          : unitPriceText(one.line)}
                      </td>
                      <td className={cn(CELL, NUMR, "font-medium text-ink")}>
                        {money(
                          lineValue(one.line, one.receipt.matched_quantity)
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-start justify-end gap-3 max-md:flex-col max-md:items-stretch">
              <dl className="flex items-stretch max-md:[&>div]:flex-1">
                {figure(
                  first ? "Total Ordered" : "Total Ordered Left",
                  mine.reduce((sum, one) => sum + leftThen(one), 0),
                  0
                )}
                {figure(
                  "Total Received",
                  mine.reduce(
                    (sum, one) => sum + one.receipt.matched_quantity,
                    0
                  ),
                  1
                )}
              </dl>
              <dl className="grid w-full grid-cols-[1fr_auto] gap-x-10 gap-y-2 rounded-card border border-hairline bg-soft px-4 py-2.5 text-[0.9375rem] tabular-nums md:w-auto md:grid-cols-[auto_auto]">
                <dt className="text-body">Total</dt>
                <dd className="text-right text-ink">{money(gross)}</dd>
                {bps > 0 && (
                  <>
                    <dt className="text-body">
                      {`Discount \u00b7 ${percentBps(bps)}`}
                    </dt>
                    <dd className="text-right text-ink">{money(-discount)}</dd>
                  </>
                )}
                <div
                  aria-hidden
                  className="col-span-2 border-t border-hairline"
                />
                <dt className="font-semibold text-ink">Grand Total</dt>
                <dd className="text-right font-semibold text-ink">
                  {money(gross - discount)}
                </dd>
              </dl>
            </div>
            {earlier > 0 && (
              <p className="text-body">
                {`${earlier} earlier receiving${earlier === 1 ? "" : "s"} on the order's page.`}
              </p>
            )}
          </div>
          <div className="flex items-center justify-end gap-2 border-t border-hairline px-4 py-3 md:px-6 md:py-4 [&_button]:h-9">
            <BaseDialog.Close
              render={<Button variant="primary">Done</Button>}
            />
          </div>
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  )
}
