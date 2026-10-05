import { Dialog as BaseDialog } from "@base-ui/react/dialog"
import { Drawer } from "@base-ui/react/drawer"
import { useForm } from "@tanstack/react-form"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  ArrowLeft,
  Check,
  CircleAlert,
  CircleCheck,
  FileText,
  RotateCcw,
  Undo2,
  Upload,
  X,
} from "lucide-react"
import { Fragment, useCallback, useEffect, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { ConfirmButton, SavedDialog } from "@/components/ui/dialog"
import { Checkbox, Field, Input, Money, Textarea } from "@/components/ui/field"
import { Switch } from "@/components/ui/form"
import { Pill } from "@/components/ui/pill"
import { PhoneDrawer } from "@/components/ui/phone-drawer"
import { Fact, Facts } from "@/components/ui/sheet"
import { Problem, Receipt } from "@/components/ui/states"
import { dc } from "@/lib/api"
import { useNameOfLogin } from "@/lib/queries/hr-employees"
import { recordKeys } from "@/lib/queries/records"
import { count, label, money, recentMoment } from "@/lib/format"
import { useLayout } from "@/lib/layout"
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
import { useSupplierName } from "@/screens/procurement/supplier-name"
import { useCountsAwaiting } from "@/screens/procurement/count-review-state"
import { OperationsGate } from "@/screens/operations/gate"
import { TwoLines } from "@/screens/operations/two-lines"
import { idempotencyKey } from "@itulah/contract/client"
import type {
  InvoiceDocumentView,
  PurchaseCountAwaitingVerification,
} from "@itulah/contract"

/// **Review count** — the buyer's half of a delivery.
///
/// Ops › Receiving only COUNTS (blind, at the Gudang). Whoever raised the PO
/// reviews that count, here, from Procurement › Purchase orders: the order's row
/// and its sheet carry "Review count" once the Gudang has counted something.
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
        // Soft blue on a phone, where the round "+" is the one solid blue
        // button on the screen (owner, 2026-10-05); solid on a desk, where
        // there is no "+" beside it. On a card it is a capsule at iOS's small
        // button size (28pt tall, 14px, medium): a status beside the title
        // takes the title's weight down, never up.
        className="-my-1 w-fit relative max-md:my-0 max-md:h-7 max-md:pointer-coarse:h-7 max-md:pointer-coarse:px-3 max-md:rounded-full max-md:bg-accent-bg max-md:px-3 after:absolute after:inset-x-0 after:-inset-y-2 after:content-[''] max-md:text-[0.875rem] max-md:font-medium max-md:text-accent max-md:hover:bg-accent-bg/70"
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

/// The review, over the order's page. `po` is the order's number (`?verify=`);
/// nothing is mounted while it is null.
export function CountReview({
  po,
  onClose,
}: {
  po: string | null
  onClose: () => void
}) {
  /// The write the review made, held in the receipt dialog until it is read.
  /// State lives here — CountReview stays mounted between openings — because
  /// the body it comes from unmounts the moment the review closes.
  const [saved, setSaved] = useState<string | null>(null)
  const [flag, setFlag] = useState<"ok" | "warn" | null>(null)
  const phone = useLayout() === "phone"
  const Parts: { Title: React.ElementType; Close: React.ElementType } = phone
    ? Drawer
    : BaseDialog

  const head = (
    <div className="flex items-center gap-3 border-b border-hairline px-6 py-4 max-md:px-5">
      <div className="min-w-0 flex-1">
        <Parts.Title className="flex items-center gap-2 text-card-title font-semibold text-ink">
          Review Count
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
        {po !== null && (
          <div className="font-mono text-[0.875rem] text-mute">{po}</div>
        )}
      </div>
      <Parts.Close
        render={
          <Button variant="ghost" size="icon" aria-label="Close">
            <X />
          </Button>
        }
      />
    </div>
  )
  const body = po !== null && (
    <OperationsGate>
      <ReviewBody
        po={po}
        onClose={onClose}
        onSaved={setSaved}
        onFlag={setFlag}
      />
    </OperationsGate>
  )

  // A phone reviews in a sheet from the bottom, as every other overlay there.
  if (phone) {
    return (
      <PhoneDrawer
        open={po !== null}
        onOpenChange={(next) => !next && onClose()}
        tall
      >
        {head}
        {body}
        <SavedDialog
          open={saved !== null}
          onOpenChange={(next) => {
            if (!next) setSaved(null)
          }}
          title={saved ?? ""}
        />
      </PhoneDrawer>
    )
  }

  return (
    <BaseDialog.Root
      open={po !== null}
      onOpenChange={(next) => !next && onClose()}
    >
      <BaseDialog.Portal>
        <BaseDialog.Backdrop className="fixed inset-0 z-40 bg-[var(--scrim)] transition-opacity duration-(--t-sheet) ease-(--ease-out) data-[ending-style]:opacity-0 data-[ending-style]:duration-(--t-exit) data-[starting-style]:opacity-0" />
        {/* A sheet, like the order it is opened from: full height, so five or
          ten articles read as a page instead of a cramped window. */}
        <BaseDialog.Popup className="fixed top-5 right-5 bottom-5 z-40 flex w-[clamp(27.5rem,72vw,56rem)] max-w-[calc(100vw-2.5rem)] flex-col overflow-hidden rounded-shell border border-hairline bg-canvas shadow-float transition-[translate,opacity] duration-(--t-sheet) ease-(--ease-drawer) outline-none data-[ending-style]:translate-x-[calc(100%+1.25rem)] data-[ending-style]:duration-(--t-exit) data-[starting-style]:translate-x-[calc(100%+1.25rem)] motion-reduce:data-[ending-style]:translate-x-0 motion-reduce:data-[ending-style]:opacity-0 motion-reduce:data-[starting-style]:translate-x-0 motion-reduce:data-[starting-style]:opacity-0">
          {head}
          {body}
          <SavedDialog
            open={saved !== null}
            onOpenChange={(next) => {
              if (!next) setSaved(null)
            }}
            title={saved ?? ""}
          />
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  )
}

function ReviewBody({
  po,
  onClose,
  onSaved,
  onFlag,
}: {
  po: string
  onClose: () => void
  onSaved: (said: string) => void
  onFlag: (flag: "ok" | "warn" | null) => void
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
}: {
  po: string
  live: readonly Count[]
  onClose: () => void
  onSaved: (said: string) => void
  onFlag: (flag: "ok" | "warn" | null) => void
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
  const nameOf = useSupplierName()
  const supplier =
    order === undefined || order.supplier_name === null
      ? undefined
      : nameOf(order.supplier_id, order.supplier_name)
  const cancelled = order?.lifecycle === "CANCELLED"

  const [mode, setMode] = useState<"decide" | "recount">("decide")
  const [hideMatched, setHideMatched] = useState(true)
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set())
  const [why, setWhy] = useState("")
  // What was accepted, kept after the counts leave the queue: the buyer is
  // still owed the invoice box, and a retry still needs the rows.
  const [frozen, setFrozen] = useState<readonly Count[] | null>(null)
  const [accepted, setAccepted] = useState<readonly Count[] | null>(null)

  const rows = live.length > 0 ? live : (frozen ?? [])

  const shorts = rows.filter((row) => gap(row) < 0)
  const overs = rows.filter((row) => gap(row) > 0)
  const wrongRows = rows.filter((row) => wrongOf(row) > 0)
  // The extra on lines with no mismatch: a mismatched line's whole excess goes
  // back with it, so only these are "just extra".
  const cleanOvers = overs.filter((row) => wrongOf(row) === 0)
  const shortQty = shorts.reduce((sum, row) => sum - gap(row), 0)
  // Everything beyond the order leaves with the not-as-ordered pieces: a return
  // takes a receipt line's whole excess.
  const overQty = overs.reduce((sum, row) => sum + gap(row), 0)
  const wrongQty = wrongRows.reduce((sum, row) => sum + wrongOf(row), 0)
  const totalOwed = rows.reduce((sum, row) => sum + owed(row), 0)
  const totalWrong = rows.reduce((sum, row) => sum + wrongOf(row), 0)
  // A column's total is the sum of its rows: what was counted, as counted.
  const totalCounted = rows.reduce((sum, row) => sum + correct(row), 0)
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
  // Matched lines can be set aside to read only what is off; never while
  // counting again, which needs every line to tick.
  const canHide = mode === "decide" && offCount > 0 && offCount < rows.length
  const visible =
    canHide && hideMatched
      ? rows.filter((row) => gap(row) !== 0 || wrongOf(row) > 0)
      : rows
  const extraQty = rows.reduce((sum, row) => sum + Math.max(gap(row), 0), 0)
  const flagged = rows.some((row) => gap(row) !== 0 || wrongOf(row) > 0)
    ? "warn"
    : "ok"
  useEffect(() => {
    onFlag(flagged)
    return () => onFlag(null)
  }, [flagged, onFlag])
  const counters = [...new Set(rows.map((row) => row.counted_by))]
  const latest = rows.reduce(
    (newest, row) => (row.counted_at > newest ? row.counted_at : newest),
    rows[0]?.counted_at ?? ""
  )

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
      // Both facts — accepted and received — in the one receipt; the invoice
      // block under it is the working surface (owner, 2026-10-02).
      onSaved(
        `${lines(targets.length)} received${replaced ? " · replacement recorded" : ""}`
      )
      setAccepted(targets)
      onClose()
    },
    onError: () => refresh(),
  })

  const recount = useMutation({
    mutationFn: async () => {
      const targets = rows.filter((row) => picked.has(row.count_id))
      for (const row of targets) {
        await dc.verifyPurchase({
          count_id: row.count_id,
          verifier_actor_id: actor,
          decision: "Recount",
          note: why.trim(),
          invoiced_price_minor: null,
          idempotency_key: keyFor(`Recount:${row.count_id}`),
        })
      }
      return targets.length
    },
    onSuccess: (n) => {
      minted.current.clear()
      refresh()
      onSaved(`${lines(n)} sent back to count`)
      onClose()
    },
  })

  const toggle = (id: string) =>
    setPicked((was) => {
      const next = new Set(was)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const startRecount = () => {
    const off = rows.filter((row) => gap(row) !== 0)
    setPicked(new Set((off.length > 0 ? off : rows).map((r) => r.count_id)))
    setMode("recount")
  }

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

  const recounting = mode === "recount"
  const allPicked =
    rows.length > 0 && rows.every((row) => picked.has(row.count_id))

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-4 pt-4 pb-6 md:gap-8 md:px-8 md:pt-5 md:pb-8 [&>*]:shrink-0">
        {unnamed && <NameTheVerifier />}

        {/* The head of the report: who, when, which order — reference, not the
          point of the screen. Label and value on one line, plain weight, so
          the table below is what the eye lands on. */}
        <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-2 text-[0.9375rem] md:grid-cols-[max-content_minmax(0,1fr)_max-content_minmax(0,1fr)] md:[&_dd]:mr-6">
          {/* Two columns: who and when on the left, the totals on the right,
            then what the count found — for a count of any length. */}
          {(() => {
            const fact = (
              name: string,
              value: React.ReactNode,
              tone = "text-body"
            ) => (
              <Fragment key={name}>
                <dt className="text-mute">{name}</dt>
                <dd className={cn("tabular-nums", tone)}>{value}</dd>
              </Fragment>
            )
            // Who and when are one fact: "Rina Kusuma · 04 Oct 2026, 17:12".
            const counted = fact(
              "Counted",
              `${
                counters.length === 1
                  ? nameOfLogin(counters[0])
                  : `${count(counters.length)} people`
              } · ${recentMoment(latest)}`
            )
            const from =
              supplier !== null && supplier !== undefined
                ? fact("Supplier", supplier)
                : null
            // Who counted and whose goods: the two things the table cannot say.
            return [from, counted]
          })()}
          {/* The table says it for a few items; for many, one line says what
            kind of count this is before the table is read. */}
          {rows.length > 4 && (
            <>
              <dt className="mt-1 text-mute">Difference</dt>
              <dd
                className={cn(
                  "col-span-3 mt-1",
                  offCount > 0 ? "text-bad-fg" : "text-ok-fg"
                )}
              >
                {offCount === 0
                  ? "Matches the order"
                  : [
                      `${count(offCount)} of ${count(rows.length)} items differ`,
                      shortQty > 0 ? `${pcs(shortQty)} short` : null,
                      extraQty > 0 ? `${pcs(extraQty)} extra` : null,
                      totalWrong > 0
                        ? `${pcs(totalWrong)} not as ordered`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
              </dd>
            </>
          )}
        </dl>

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
              const index = rows.indexOf(row)
              const diff = gap(row)
              return (
                <li
                  key={row.count_id}
                  onClick={() => recounting && toggle(row.count_id)}
                  className={cn(
                    "flex flex-col gap-3 rounded-card border border-hairline p-4",
                    recounting && "cursor-pointer"
                  )}
                >
                  <div className="flex items-start gap-3">
                    {recounting && (
                      <span onClick={(event) => event.stopPropagation()}>
                        <Checkbox
                          label={
                            <span className="sr-only">{`Count ${row.article_code} again`}</span>
                          }
                          checked={picked.has(row.count_id)}
                          onChange={() => toggle(row.count_id)}
                        />
                      </span>
                    )}
                    <span className="w-5 shrink-0 pt-0.5 text-right text-body text-mute tabular-nums">
                      {index + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <TwoLines top={row.article_name} bottom={kindOf(row)} />
                    </div>
                  </div>
                  <dl className="grid grid-cols-3 gap-3 text-[0.9375rem]">
                    <div className="flex flex-col gap-0.5">
                      <dt className="text-mute">Ordered</dt>
                      <dd className="text-body tabular-nums">
                        <Qty pieces={owed(row)} row={row} />
                      </dd>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <dt className="text-mute">Counted</dt>
                      <dd className="text-body tabular-nums">
                        <Qty pieces={correct(row)} row={row} />
                      </dd>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <dt className="text-mute">Difference</dt>
                      <dd className="font-medium">
                        {diff === 0 ? (
                          <span className="inline-flex items-center gap-1 text-ok-fg">
                            <Check className="size-4" />
                            Matches
                          </span>
                        ) : diff < 0 ? (
                          <span className="inline-block rounded-inner bg-bad-bg px-2.5 py-1 whitespace-nowrap text-bad-fg">
                            {`−${inUnit(-diff, row)}`}
                          </span>
                        ) : (
                          <span className="inline-block rounded-inner bg-bad-bg px-2.5 py-1 whitespace-nowrap text-bad-fg">
                            {`+${inUnit(diff, row)}`}
                          </span>
                        )}
                      </dd>
                    </div>
                  </dl>
                </li>
              )
            })}
            <li className="flex items-center justify-between rounded-card bg-soft-2 px-4 py-3.5 text-[0.9375rem]">
              <span className="font-medium text-body">Total</span>
              <span className="font-semibold text-ink tabular-nums">
                {[
                  pcs(totalCounted),
                  shortQty > 0 ? `${pcs(shortQty)} short` : null,
                  extraQty > 0 ? `${pcs(extraQty)} extra` : null,
                  shortQty === 0 && extraQty === 0 ? "matches" : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </li>
          </ul>

          <div className="hidden overflow-clip rounded-card border border-hairline md:block">
            <div className="overflow-clip">
              <table className="w-full table-fixed border-collapse">
                <colgroup>
                  {recounting && <col className="w-[3.5rem]" />}
                  <col className="w-[3.5rem]" />
                  <col />
                  <col className="w-[8rem] lg:w-[10rem]" />
                  <col className="w-[8rem] lg:w-[10rem]" />
                  <col className="w-[9.5rem]" />
                </colgroup>
                <thead>
                  <tr>
                    {recounting && (
                      <th className={cn(HEAD, "text-center")}>
                        <Checkbox
                          label={
                            <span className="sr-only">Tick every line</span>
                          }
                          checked={allPicked}
                          disabled={rows.length === 0}
                          onChange={(next) =>
                            setPicked(
                              next
                                ? new Set(rows.map((row) => row.count_id))
                                : new Set()
                            )
                          }
                        />
                      </th>
                    )}
                    <th className={cn(HEAD, "text-right")}>No.</th>
                    <th className={HEAD}>Article</th>
                    <th className={HEAD}>Ordered Quantity</th>
                    <th className={HEAD}>Counted Quantity</th>
                    <th className={HEAD}>Difference</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((row) => {
                    const index = rows.indexOf(row)
                    const diff = gap(row)
                    return (
                      <tr
                        key={row.count_id}
                        onClick={() => recounting && toggle(row.count_id)}
                        className={cn(
                          "h-16 border-t border-hairline transition-colors",
                          recounting && "cursor-pointer hover:bg-soft"
                        )}
                      >
                        {recounting && (
                          <td
                            className={cn(CELL, "text-center")}
                            onClick={(event) => event.stopPropagation()}
                          >
                            <Checkbox
                              label={
                                <span className="sr-only">{`Count ${row.article_code} again`}</span>
                              }
                              checked={picked.has(row.count_id)}
                              onChange={() => toggle(row.count_id)}
                            />
                          </td>
                        )}
                        <td className={cn(CELL, NUM, "text-right text-mute")}>
                          {index + 1}
                        </td>
                        <td className={CELL}>
                          <div
                            title={row.article_name}
                            className="min-w-0 py-1"
                          >
                            <div className="line-clamp-2 leading-[1.4] font-medium text-ink">
                              {row.article_name}
                            </div>
                            <div className="mt-1 truncate text-[0.875rem] leading-[1.4] text-mute">
                              {kindOf(row)}
                            </div>
                          </div>
                        </td>
                        <td className={cn(CELL, NUM)}>
                          <Qty pieces={owed(row)} row={row} />
                        </td>
                        <td className={cn(CELL, NUM)}>
                          <Qty pieces={correct(row)} row={row} />
                        </td>
                        <td className={cn(CELL, NUM, "font-medium")}>
                          {diff === 0 ? (
                            <span className="inline-flex items-center gap-1.5 text-ok-fg">
                              <Check className="size-4" />
                              Matches
                            </span>
                          ) : diff < 0 ? (
                            <span className="inline-block rounded-inner bg-bad-bg px-2.5 py-1 whitespace-nowrap text-bad-fg">
                              {`−${inUnit(-diff, row)}`}
                            </span>
                          ) : (
                            <span className="inline-block rounded-inner bg-bad-bg px-2.5 py-1 whitespace-nowrap text-bad-fg">
                              {`+${inUnit(diff, row)}`}
                            </span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t border-hairline bg-soft-2">
                    {recounting && <td className={CELL} />}
                    <td className={CELL} />
                    <td
                      className={cn(
                        CELL,
                        "font-medium whitespace-nowrap text-body"
                      )}
                    >
                      Total
                    </td>
                    <td className={NUM_TOTAL}>{pcs(totalOwed)}</td>
                    <td className={NUM_TOTAL}>{pcs(totalCounted)}</td>
                    <td className={cn(NUM_TOTAL, "font-medium text-bad-fg")}>
                      {/* Short and extra apart: an extra on one line is not
                        ours, so it never makes up a short on another. */}
                      {shortQty === 0 && extraQty === 0 ? (
                        <span className="text-body">—</span>
                      ) : (
                        <span className="flex flex-col leading-tight">
                          {shortQty > 0 && (
                            <span>{`${pcs(shortQty)} short`}</span>
                          )}
                          {extraQty > 0 && (
                            <span>{`${pcs(extraQty)} extra`}</span>
                          )}
                        </span>
                      )}
                    </td>
                  </tr>
                  {totalWrong > 0 && (
                    <tr className="border-t border-hairline bg-soft-2">
                      {recounting && <td className={CELL} />}
                      <td className={CELL} />
                      <td
                        className={cn(
                          CELL,
                          "font-medium whitespace-nowrap text-body"
                        )}
                      >
                        Not as Ordered
                      </td>
                      <td className={NUM_TOTAL} />
                      <td className={NUM_TOTAL}>
                        <Qty
                          pieces={totalWrong}
                          row={unitRow ?? rows[0]}
                          tone="text-bad-fg"
                        />
                      </td>
                      <td className={NUM_TOTAL} />
                    </tr>
                  )}
                </tfoot>
              </table>
            </div>
          </div>
        </div>

        {recounting ? (
          <div className="flex flex-col gap-3">
            <h3 className="text-[1rem] font-semibold text-ink">
              Why should it be counted again?
            </h3>
            <Textarea
              value={why}
              autoFocus
              rows={3}
              aria-label="Why should it be counted again?"
              onChange={(event) => setWhy(event.target.value)}
            />
          </div>
        ) : (
          <>
            {/* What goes back to the supplier: one plain line under the table, no
              box. A return takes a line's whole excess, so the extra on a line
              with not-as-ordered pieces goes with them. */}
            {(wrongRows.length > 0 || cleanOvers.length > 0) && (
              <p className="flex items-center gap-2.5 px-1 text-[0.9375rem] text-body">
                <Undo2 className="size-[18px] shrink-0 text-info-fg" />
                <span>
                  {wrongRows.length > 0 && cleanOvers.length > 0 ? (
                    <>
                      <b className="font-medium text-ink">
                        {pcs(wrongQty + overQty)}
                      </b>{" "}
                      will be returned to the supplier
                      <span className="text-mute">
                        {` · ${count(wrongQty)} not as ordered, ${count(overQty)} extra`}
                      </span>
                    </>
                  ) : (
                    <>
                      <b className="font-medium text-ink">
                        {pcs(
                          wrongRows.length > 0 ? wrongQty + overQty : overQty
                        )}
                      </b>{" "}
                      {wrongRows.length > 0 ? "not as ordered" : "extra"} will
                      be returned to the supplier
                    </>
                  )}
                </span>
              </p>
            )}
          </>
        )}

        <Problem error={accept.error ?? recount.error} />
      </div>

      <div className="grid grid-cols-2 gap-2 border-t border-hairline px-4 py-3 md:flex md:items-center md:gap-3 md:px-6 md:py-4">
        {recounting ? (
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setMode("decide")
                recount.reset()
              }}
            >
              <ArrowLeft />
              Back
            </Button>
            <span className="flex-1 text-body">
              {`${count(picked.size)} of ${lines(rows.length)} ticked`}
            </span>
            <Button
              variant="primary"
              pending={recount.isPending}
              disabled={picked.size === 0 || why.trim() === ""}
              onClick={() => recount.mutate()}
            >
              {`Send ${lines(picked.size)} back to count`}
            </Button>
          </>
        ) : (
          <>
            <Button
              variant="soft"
              className={cn(
                "max-md:justify-center",
                shorts.length === 0 && "max-md:col-span-2"
              )}
              disabled={unnamed || rows.length === 0 || accept.isPending}
              onClick={startRecount}
            >
              <RotateCcw />
              Recount
            </Button>
            <span className="flex-1 max-md:hidden" />
            {/* A short count's one decision is the button itself: no choice to
              set and then confirm. Primary is the one that keeps the order
              open; closing it short is the deliberate other. */}
            {shorts.length > 0 ? (
              <>
                {/* Closing short cannot be undone, so it asks, in a dialog. Keeping
                  the order open asks nothing: the rest can still be closed
                  later. */}
                <ConfirmButton
                  label="Close Short"
                  variant="soft"
                  tone="danger"
                  className="max-md:justify-center"
                  title="Close This Short?"
                  description={`${pcs(shortQty)} will be removed from the order, and the PO completes as received. This can't be undone.`}
                  confirmLabel="Close Short"
                  reason={{ label: "Reason for Closing" }}
                  disabled={unnamed || rows.length === 0 || accept.isPending}
                  pending={accept.isPending}
                  onConfirm={(reason) => {
                    closeReason.current = reason
                    return accept.mutateAsync("close")
                  }}
                />
                <Button
                  variant="primary"
                  className="max-md:order-first max-md:col-span-2 max-md:justify-center"
                  pending={accept.isPending}
                  title={`${pcs(shortQty)} stay open on the order`}
                  disabled={unnamed || rows.length === 0}
                  onClick={() => accept.mutate("keep")}
                >
                  {!accept.isPending && <Check />}
                  {accept.isPending ? "Submitting…" : "Partial Receive"}
                </Button>
              </>
            ) : (
              <Button
                variant="primary"
                className="max-md:order-first max-md:col-span-2 max-md:justify-center"
                pending={accept.isPending}
                disabled={unnamed || rows.length === 0}
                onClick={() => accept.mutate("keep")}
              >
                {!accept.isPending && <Check />}
                {accept.isPending ? "Submitting…" : "Submit"}
              </Button>
            )}
          </>
        )}
      </div>
    </>
  )
}

/// A column heading as every hub table sets one.
const HEAD =
  "border-b border-hairline bg-soft px-4 py-2.5 text-left text-eyebrow leading-tight font-medium text-body lg:whitespace-nowrap"
const CELL = "px-4 py-3.5 align-middle"
/// Figures line up on the right in tabular digits.
const NUM = "text-left text-[0.9375rem] text-body tabular-nums"
const NUM_TOTAL = `${CELL} ${NUM}`

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
        <h3 className="text-[0.875rem] font-semibold text-ink">
          Invoice for this order
        </h3>
        <span className="font-mono text-[0.875rem] text-mute">
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
              <p className="flex-1 text-[0.875rem] text-mute">
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

      <label className="flex min-h-tap cursor-pointer items-center justify-center gap-2 rounded-full border border-dashed border-hairline-2 px-3.5 text-[0.875rem] text-body transition-colors hover:border-hairline-strong hover:bg-soft">
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
}: {
  pieces: number
  row: Count
  tone?: string
}) {
  if (pieces === 0) return <span className="text-mute">—</span>
  const unit = row.order_unit_code !== null && Number(row.unit_factor) > 1
  // Pieces first, whatever unit the order was typed in; the unit, when there
  // is one, stands under them.
  return (
    <span className="flex flex-col items-start leading-tight">
      <span className={tone}>
        {pieces === 1 && (row.stock_unit_code ?? "PCS") === "PCS"
          ? "1 pc"
          : `${count(pieces)} ${(row.stock_unit_code ?? "PCS").toLowerCase()}`}
      </span>
      {unit && (
        <span className="text-[0.875rem] font-normal text-mute">
          {inUnit(pieces, row)}
        </span>
      )}
    </span>
  )
}
