import { useEffect, useMemo, useRef, useState } from "react"

import { Icon, paths } from "@/components/dashboard/parts"
import { Thumb, money, supplierOf } from "@/components/sourcing/product-views"
import type { Product, Supplier } from "@/components/sourcing/catalogue"
import {
  useCreateSourcingSupplier,
  useSourcingCatalog,
  useSourcingShortlist,
  type SourcingDivision,
} from "@/components/sourcing/api"
import { useCreatePurchaseOrder } from "@/components/po/mutations"
import {
  lineTotal,
  orderDiscount,
  orderNet,
  orderTotal,
  orderUnits,
  type PoLine,
  type PurchaseOrder,
} from "@/components/commerce/store"
import { getErrorMessage } from "@/lib/api"
import { cue } from "@/components/dashboard/use-interaction-sounds"
import { SheetShell, sheetButton } from "@/components/dashboard/sheet-shell"
import { VirtualRows } from "@/shared/table"
import { cn } from "@/lib/utils"

const REVIEW_LINES_COLUMNS = "340px 156px 96px 116px minmax(0,1fr)"

/* The review-step grid's row is not a click target, but the original `<tr>`
 * still washed the whole row on hover as a visual cue, so it asks VirtualRows
 * for `hoverable` without claiming the click. The wash belongs on the row
 * element: cells are `items-center` grid items and only as tall as their own
 * content, so tinting them paints ragged disconnected blocks, not one row. */

/* A one-shot token for the create command. It lives outside the component so
 * the lint rules that police render purity do not have to reason about a
 * callback that is only ever reached from a click. */
function newIdempotencyKey(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID()
  }
  return `po-${new Date().getTime()}-${String(Math.trunc(performance.now() * 1000))}`
}

const product = (id: string | null, products: Product[]) =>
  // A sourcing code is display-only. Draft PO membership is keyed by the
  // Internal sourcing-item UUID carried in Product.id.
  id ? products.find((p) => p.id === id) : undefined

/** A line's display name, whether it came from the catalogue or was typed. */
const lineName = (line: PoLine, products: Product[]) =>
  product(line.productId, products)?.name ??
  (line.name?.trim() || "Untitled line")

const isoInDays = (days: number) => {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

const daysUntil = (iso: string) => {
  if (!iso) return null
  const then = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(then.getTime())) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.round((then.getTime() - today.getTime()) / 86400000)
}

interface Issue {
  lineId: string
  severity: "block" | "warn"
  message: string
}

function divisionLabel(id: string, divisions: SourcingDivision[]): string {
  return divisions.find((division) => division.id === id)?.name ?? id
}

/** Every reason this order should not be sent as it stands. */
function reviewIssues(lines: PoLine[], products: Product[] = []): Issue[] {
  const issues: Issue[] = []
  const currencies = new Set<string>()

  for (const line of lines) {
    const p = product(line.productId, products)
    const label = lineName(line, products)

    if (!p?.sourcingItemId) {
      issues.push({
        lineId: line.id,
        severity: "block",
        message: `${label}: choose an active Internal sourcing item; direct/manual lines cannot be staged for a sourced PO.`,
      })
    } else if (p.status !== "active") {
      issues.push({
        lineId: line.id,
        severity: "block",
        message: `${label}: this Internal sourcing item is not active.`,
      })
    }
    if (p && (!p.currency || !/^[A-Z]{3}$/.test(p.currency))) {
      issues.push({
        lineId: line.id,
        severity: "block",
        message: `${label}: Internal has not supplied a valid currency.`,
      })
    } else if (p?.currency) {
      currencies.add(p.currency)
    }

    if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
      issues.push({
        lineId: line.id,
        severity: "block",
        message: `${label}: quantity must be above zero.`,
      })
    } else if (p && line.quantity < p.moq) {
      // only a catalogue line carries a supplier minimum
      issues.push({
        lineId: line.id,
        severity: "block",
        message: `${label}: ${line.quantity} is below the supplier's MOQ of ${p.moq}.`,
      })
    }

    if (line.unitPrice <= 0) {
      issues.push({
        lineId: line.id,
        severity: "block",
        message: `${label}: needs a unit price.`,
      })
    } else if (p) {
      const drift = (line.unitPrice - p.price) / p.price
      if (Math.abs(drift) > 0.15) {
        issues.push({
          lineId: line.id,
          severity: "warn",
          message: `${label}: price is ${drift > 0 ? "above" : "below"} catalogue by ${Math.round(Math.abs(drift) * 100)}%.`,
        })
      }
    }

    if (!p?.sourcingItemId && !line.division.trim()) {
      issues.push({
        lineId: line.id,
        severity: "block",
        message: `${label}: pick a division.`,
      })
    }
    if (p?.sourcingItemId && !p.divisionId) {
      issues.push({
        lineId: line.id,
        severity: "block",
        message: `${label}: Internal has not supplied a division.`,
      })
    }
    if (p?.sourcingItemId && !p.tags.length) {
      issues.push({
        lineId: line.id,
        severity: "block",
        message: `${label}: add at least one master tag before creating a PO.`,
      })
    }
    if (
      p?.sourcingItemId &&
      !p.colorways.some((colorway) => colorway.image.trim())
    ) {
      issues.push({
        lineId: line.id,
        severity: "block",
        message: `${label}: add a reference photo before creating a PO.`,
      })
    }
  }

  if (currencies.size > 1) {
    issues.push({
      lineId: "order",
      severity: "block",
      message: "Internal sourcing items in one PO must share a currency.",
    })
  }

  return issues
}

/** Lead-time checks belong to the order, since delivery is set once. */
function deliveryIssues(
  lines: PoLine[],
  deliveryDate: string,
  products: Product[] = []
): Issue[] {
  const lead = daysUntil(deliveryDate)
  if (lead === null) {
    return [
      {
        lineId: "order",
        severity: "block",
        message: "Set a delivery date for the order.",
      },
    ]
  }
  return lines.flatMap((line) => {
    const p = product(line.productId, products)
    if (!p || lead >= p.leadTime) return []
    return [
      {
        lineId: line.id,
        severity: "warn" as const,
        message: `${lineName(line, products)}: ${lead} days is inside the ${p.leadTime}-day lead time.`,
      },
    ]
  })
}

function SupplierPicker({
  suppliers,
  value,
  onPick,
}: {
  suppliers: Supplier[]
  value: string | null
  onPick: (id: string) => void
}) {
  const current = suppliers.find((s) => s.id === value)
  const [query, setQuery] = useState("")
  const [open, setOpen] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onDown)
    return () => document.removeEventListener("mousedown", onDown)
  }, [open])

  const q = query.trim().toLowerCase()
  const matches = suppliers.filter(
    (s) =>
      !q ||
      s.name.toLowerCase().includes(q) ||
      /* Optional: Internal sends no supplier division, so this matches only
       * where a fixture supplies one. It used to match the literal word
       * "Supplier" on every row, which made a search for "sup" return the
       * whole list. */
      (s.division?.toLowerCase().includes(q) ?? false)
  )

  return (
    <div ref={wrap} className="relative">
      <input
        id="po-supplier"
        value={open ? query : (current?.name ?? "")}
        onChange={(e) => {
          setQuery(e.target.value)
          setOpen(true)
        }}
        onFocus={() => {
          setQuery("")
          setOpen(true)
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false)
          if (e.key === "Enter" && matches.length) {
            e.preventDefault()
            onPick(matches[0].id)
            setOpen(false)
          }
        }}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        placeholder="Search suppliers…"
        className="h-[32px] w-full rounded-control bg-field px-2.5 text-[12.5px] font-medium text-ink shadow-[inset_0_0_0_1px_var(--line-strong)] outline-none placeholder:font-normal placeholder:text-ink-4 focus:bg-surface focus:shadow-[inset_0_0_0_1px_var(--accent)]"
      />

      {open && (
        <div className="absolute top-[calc(100%+4px)] left-0 z-40 max-h-[280px] w-[300px] overflow-auto rounded-panel bg-surface p-1 shadow-[0_0_0_1px_var(--line-strong),var(--shadow-overlay)]">
          {matches.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => {
                onPick(s.id)
                setOpen(false)
              }}
              className={cn(
                "flex w-full items-center gap-2 rounded-chip px-2 py-1.5 text-left transition-colors hover:bg-hover",
                s.id === value && "bg-hover"
              )}
            >
              <span
                style={{ background: s.hue }}
                className="grid size-[20px] shrink-0 place-items-center rounded-chip text-[9px] font-semibold text-white uppercase"
              >
                {s.name[0]}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[12.5px] font-medium text-ink">
                  {s.name}
                </span>
                <span className="block truncate text-[10.5px] text-ink-4">
                  {s.division}
                </span>
              </span>
            </button>
          ))}

          {!matches.length && (
            <div className="px-2 py-3 text-center text-[11.5px] text-ink-4">
              No supplier matches. Use + to add one.
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/* Cells carry no chrome of their own — the grid's hairlines already say where
 * one ends. A cell only shows it is editable when the pointer or focus is on
 * it, which keeps a dense sheet readable. */
const CELL =
  "h-full w-full bg-transparent px-2.5 text-[12.5px] text-ink outline-none transition-colors duration-[110ms] " +
  "hover:bg-hover focus:bg-accent-tint focus:shadow-[inset_0_0_0_1.5px_var(--accent)] placeholder:text-ink-4"

/* Spinners crowd a dense sheet and invite mis-clicks; the field still takes
 * arrow keys, it just does not draw the little arrows. */
const NO_SPINNER =
  "[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-inner-spin-button]:m-0"

const NUM_CELL = `${CELL} ${NO_SPINNER} text-right font-mono tabular-nums`

/** Marks the one field that is wrong, rather than only tinting the row. */
const INVALID = "shadow-[inset_0_0_0_1.5px_var(--ember)]"

type Step = "edit" | "review"

export function PoDraft({
  productIds,
  onClose,
  onCreated,
}: {
  productIds: string[]
  onClose: () => void
  onCreated: (order: PurchaseOrder) => void
}) {
  const catalogResource = useSourcingCatalog()
  const shortlistResource = useSourcingShortlist()
  const products = useMemo(
    () => catalogResource.data?.products ?? [],
    [catalogResource.data?.products]
  )
  const suppliers = useMemo(
    () => catalogResource.data?.suppliers ?? [],
    [catalogResource.data?.suppliers]
  )
  const divisions = useMemo(
    () => catalogResource.data?.divisions ?? [],
    [catalogResource.data?.divisions]
  )
  const locations = useMemo(
    () => catalogResource.data?.locations ?? [],
    [catalogResource.data?.locations]
  )
  const shortlist = useMemo(
    () => shortlistResource.data?.entries ?? [],
    [shortlistResource.data?.entries]
  )
  const [step, setStep] = useState<Step>("edit")
  const [note, setNote] = useState("")
  const [lines, setLines] = useState<PoLine[]>([])
  const [deliveryDate, setDeliveryDate] = useState("")
  const [deliveryLocationId, setDeliveryLocationId] = useState("")
  const [supplierId, setSupplierId] = useState<string | null>(null)
  const [catalogueInitialized, setCatalogueInitialized] = useState(false)
  const [submitBusy, setSubmitBusy] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [supplierBusy, setSupplierBusy] = useState(false)
  const [picking, setPicking] = useState(false)
  const [pickQuery, setPickQuery] = useState("")
  const [pickSource, setPickSource] = useState<"catalogue" | "shortlist">(
    "catalogue"
  )
  const idempotencyKey = useRef<string | null>(null)
  const createOrder = useCreatePurchaseOrder()
  const createSupplier = useCreateSourcingSupplier()

  const supplier = supplierId
    ? suppliers.find((s) => s.id === supplierId)
    : undefined
  const [discountKind, setDiscountKind] = useState<
    "none" | "percent" | "amount"
  >("none")
  const [discountValue, setDiscountValue] = useState(0)
  const [supplierSheet, setSupplierSheet] = useState<"create" | "view" | null>(
    null
  )
  const [newSupplier, setNewSupplier] = useState({
    name: "",
    code: "",
    address: "",
  })

  useEffect(() => {
    // The resource starts in idle before its own effect marks it loading. Wait
    // for a successful payload so the first render cannot permanently freeze an
    // empty draft or choose an invented destination/division.
    if (
      catalogueInitialized ||
      catalogResource.isLoading ||
      !catalogResource.data
    )
      return

    const initialProducts = productIds
      .map((id) => product(id, products))
      .filter((p): p is NonNullable<typeof p> => Boolean(p))
    setLines(
      initialProducts.map((p, i) => ({
        id: `l${i}-${p.id}`,
        productId: p.id,
        sourcingItemId: p.sourcingItemId,
        quantity: p.moq > 0 ? p.moq : 1,
        unitPrice: p.price,
        division: p.divisionId ?? divisions[0]?.id ?? "",
        tags: [...p.tags],
        photoUrls: p.colorways
          .map((colorway) => colorway.image.trim())
          .filter(Boolean),
      }))
    )
    const longest = initialProducts
      .map((p) => p.leadTime || 45)
      .reduce((max, days) => Math.max(max, days), 45)
    setDeliveryDate(isoInDays(longest + 14))
    setSupplierId(initialProducts[0]?.supplierId ?? null)
    setCatalogueInitialized(true)
    setDeliveryLocationId(catalogResource.data.locations[0]?.id ?? "")
  }, [
    catalogResource.data,
    catalogResource.isLoading,
    catalogueInitialized,
    divisions,
    locations,
    productIds,
    products,
  ])
  /** Catalogue lines from a different supplier than the order is addressed to. */
  const strayLines = lines.filter((l) => {
    const s = product(l.productId, products)?.supplierId
    return s && supplierId && s !== supplierId
  })

  const addCatalogueLine = (id: string) => {
    const p = product(id, products)
    if (!p) return
    setLines((list) => [
      ...list,
      {
        id: `c${Date.now()}-${p.id}`,
        productId: p.id,
        sourcingItemId: p.sourcingItemId,
        quantity: p.moq > 0 ? p.moq : 1,
        unitPrice: p.price,
        division: p.divisionId ?? divisions[0]?.id ?? "",
        tags: [...p.tags],
        photoUrls: p.colorways
          .map((colorway) => colorway.image.trim())
          .filter(Boolean),
      },
    ])
    if (!supplierId) setSupplierId(p.supplierId)
  }

  const orderIssues: Issue[] = []
  if (!supplierId) {
    orderIssues.push({
      lineId: "order",
      severity: "block",
      message: "Name the supplier this order goes to.",
    })
  }
  if (!deliveryLocationId) {
    orderIssues.push({
      lineId: "order",
      severity: "block",
      message: "Choose the delivery location for this order.",
    })
  }
  if (!lines.length) {
    orderIssues.push({
      lineId: "order",
      severity: "block",
      message: "Add at least one line.",
    })
  }
  if (strayLines.length) {
    orderIssues.push({
      lineId: "order",
      severity: "block",
      message: "A sourced PO can contain items from one supplier only.",
    })
  }
  if (discountKind === "amount") {
    orderIssues.push({
      lineId: "order",
      severity: "block",
      message:
        "Internal procurement accepts percentage discounts per line; fixed order discounts cannot be posted yet.",
    })
  }

  const issues = useMemo(
    () => [
      ...reviewIssues(lines, products),
      ...deliveryIssues(lines, deliveryDate, products),
    ],
    [lines, deliveryDate, products]
  )
  const allIssues = [...orderIssues, ...issues]
  const blocks = allIssues.filter((i) => i.severity === "block")
  const warns = allIssues.filter((i) => i.severity === "warn")

  const patch = (id: string, next: Partial<PoLine>) =>
    setLines((list) => list.map((l) => (l.id === id ? { ...l, ...next } : l)))

  const remove = (id: string) =>
    setLines((list) => list.filter((l) => l.id !== id))

  const subtotal = orderTotal({ lines })
  const units = orderUnits({ lines })
  const discountable = { lines, discountKind, discountValue }
  const discount = orderDiscount(discountable)
  const total = orderNet(discountable)
  const orderCurrency =
    lines
      .map((line) => product(line.productId, products)?.currency)
      .find((currency): currency is string => Boolean(currency)) ?? "USD"

  const submit = async () => {
    if (!supplierId || !lines.length || blocks.length > 0 || submitBusy) return
    setSubmitError(null)
    setSubmitBusy(true)
    try {
      if (!idempotencyKey.current) idempotencyKey.current = newIdempotencyKey()
      const created = await createOrder.execute({
        idempotencyKey: idempotencyKey.current,
        supplier_id: supplierId,
        delivery_to: deliveryLocationId,
        currency: orderCurrency,
        expected_arrival: deliveryDate || null,
        notes: note.trim() || null,
        items: lines.map((line) => {
          const p = product(line.productId, products)
          return {
            sourcing_item_id: p?.sourcingItemId ?? line.sourcingItemId ?? "",
            name: p?.name ?? line.name ?? "",
            quantity: line.quantity,
            unit_price: line.unitPrice,
            photo_urls:
              p?.colorways
                .map((colorway) => colorway.image.trim())
                .filter(Boolean) ??
              line.photoUrls ??
              [],
            division_id: p?.divisionId ?? line.division,
            tags: p?.tags ?? line.tags,
            tags_per_unit: 1,
            ...(discountKind === "percent"
              ? { discount_percent: Math.trunc(discountValue) }
              : {}),
          }
        }),
      })
      cue("success")
      onCreated(created)
    } catch (error: unknown) {
      setSubmitError(getErrorMessage(error))
    } finally {
      setSubmitBusy(false)
    }
  }

  const rule =
    "border-b border-b-[color-mix(in_srgb,var(--line)_78%,transparent)]"
  const vrule =
    "border-r border-r-[color-mix(in_srgb,var(--line)_78%,transparent)]"

  const shortlistIds = new Set(shortlist.map((e) => e.sourcingItemId))

  const pickable = products.filter((p) => {
    if (lines.some((l) => l.productId === p.id)) return false
    if (pickSource === "shortlist" && !shortlistIds.has(p.id)) return false
    const q = pickQuery.trim().toLowerCase()
    if (!q) return true
    const sup = supplierOf(p.supplierId, suppliers)
    return (
      p.name.toLowerCase().includes(q) ||
      p.sku.includes(q) ||
      Boolean(sup?.name.toLowerCase().includes(q)) ||
      Boolean(sup?.division?.toLowerCase().includes(q))
    )
  })

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* the two steps are explicit, so nobody sends an order by reflex */}
      <div className="flex h-[52px] shrink-0 items-center gap-3 border-b border-line pr-2.5 pl-3.5">
        <button
          type="button"
          onClick={onClose}
          aria-label="Discard draft"
          className="grid size-[30px] shrink-0 place-items-center rounded-control text-ink-3 transition-colors hover:bg-hover hover:text-ink"
        >
          <Icon path={paths.close} size={15} width={2} />
        </button>

        <div className="min-w-0">
          <div className="truncate text-sm font-semibold tracking-[-0.01em]">
            {step === "edit"
              ? "Draft purchase order"
              : "Review before creating"}
          </div>
          <div className="truncate text-[11.5px] text-ink-4">
            {supplier
              ? `${supplier.name} · ${supplier.division}`
              : "No supplier"}
          </div>
        </div>

        <div className="ml-3 flex items-center gap-1.5">
          {(["edit", "review"] as const).map((s, i) => (
            <span
              key={s}
              className={cn(
                "inline-flex h-[26px] items-center gap-1.5 rounded-full px-2.5 text-[11.5px] font-medium transition-colors",
                step === s ? "bg-ink text-white" : "bg-inset text-ink-4"
              )}
            >
              <span className="font-mono">{i + 1}</span>
              {s === "edit" ? "Lines" : "Review"}
            </span>
          ))}
        </div>

        <span className="ml-auto flex items-center gap-4 font-mono text-[11px] text-ink-4">
          <span>
            <span className="text-ink-2">{lines.length}</span> lines
          </span>
          <span>
            <span className="text-ink-2">{units.toLocaleString()}</span> units
          </span>
          {discount > 0 && (
            <span className="text-ember">
              −{money(discount, orderCurrency)}
            </span>
          )}
          <span className="text-[13px] font-medium text-ink">
            {money(total, orderCurrency)}
          </span>
        </span>
      </div>

      {catalogResource.isLoading && (
        <div className="border-b border-line bg-inset px-3.5 py-2 text-[11.5px] text-ink-3">
          Loading the Internal catalogue…
        </div>
      )}
      {catalogResource.errorMessage && (
        <div className="border-b border-ember/20 bg-ember/5 px-3.5 py-2 text-[11.5px] text-ember">
          Catalogue unavailable: {catalogResource.errorMessage}. No local
          catalogue is being used.
          <button
            type="button"
            onClick={() => catalogResource.reload()}
            className="ml-2 underline underline-offset-2"
          >
            Retry
          </button>
        </div>
      )}

      {step === "edit" ? (
        <>
          <div className="min-h-0 flex-1 overflow-auto">
            <div className="flex flex-wrap items-end gap-2.5 border-b border-line px-3.5 py-3">
              <div className="min-w-[212px]">
                <label
                  htmlFor="po-supplier"
                  className="block pb-1.5 text-xs font-medium text-ink-2"
                >
                  Supplier <span className="text-ember">*</span>
                </label>
                <span className="flex items-center gap-1.5">
                  <span className="min-w-0 flex-1">
                    <SupplierPicker
                      suppliers={suppliers}
                      value={supplierId}
                      onPick={setSupplierId}
                    />
                  </span>
                  <button
                    type="button"
                    aria-label="Add a supplier"
                    title="Add a supplier"
                    onClick={() => setSupplierSheet("create")}
                    className="grid size-[32px] shrink-0 place-items-center rounded-control bg-surface text-ink-2 shadow-btn transition-colors hover:bg-hover hover:text-ink"
                  >
                    <Icon path={paths.plus} size={15} width={2.2} />
                  </button>
                  <button
                    type="button"
                    aria-label="Supplier details"
                    title="Supplier details"
                    disabled={!supplier}
                    onClick={() => setSupplierSheet("view")}
                    className="grid size-[32px] shrink-0 place-items-center rounded-control bg-surface text-ink-2 shadow-btn transition-colors hover:bg-hover hover:text-ink disabled:pointer-events-none disabled:opacity-40"
                  >
                    <Icon path={paths.more} size={15} width={2} />
                  </button>
                </span>
              </div>

              <div className="min-w-[190px]">
                <label
                  htmlFor="po-location"
                  className="block pb-1.5 text-xs font-medium text-ink-2"
                >
                  Deliver to <span className="text-ember">*</span>
                </label>
                <select
                  id="po-location"
                  value={deliveryLocationId}
                  onChange={(e) => setDeliveryLocationId(e.target.value)}
                  className="h-[32px] w-full rounded-control bg-field px-2 text-[12px] font-medium text-ink shadow-[inset_0_0_0_1px_var(--line-strong)] outline-none focus:bg-surface focus:shadow-[inset_0_0_0_1px_var(--accent)]"
                >
                  <option value="">Choose location…</option>
                  {locations.map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.name} ({location.code})
                    </option>
                  ))}
                </select>
              </div>

              <div className="min-w-[168px]">
                <label
                  htmlFor="po-delivery"
                  className="block pb-1.5 text-xs font-medium text-ink-2"
                >
                  Delivery <span className="text-ember">*</span>
                </label>
                <input
                  id="po-delivery"
                  type="date"
                  value={deliveryDate}
                  onChange={(e) => setDeliveryDate(e.target.value)}
                  className="h-[32px] w-full rounded-control bg-field px-2 font-mono text-[12px] text-ink shadow-[inset_0_0_0_1px_var(--line-strong)] outline-none focus:bg-surface focus:shadow-[inset_0_0_0_1px_var(--accent)]"
                />
              </div>

              {/* one discount for the order, either a rate or a flat sum */}
              <div className="min-w-[178px]">
                <span className="block pb-1.5 text-xs font-medium text-ink-2">
                  Discount
                </span>
                <div className="flex h-[32px] items-center rounded-control bg-field shadow-[inset_0_0_0_1px_var(--line-strong)] focus-within:bg-surface focus-within:shadow-[inset_0_0_0_1px_var(--accent)]">
                  <select
                    value={discountKind}
                    onChange={(e) =>
                      setDiscountKind(
                        e.target.value as "none" | "percent" | "amount"
                      )
                    }
                    aria-label="Discount type"
                    className="h-full shrink-0 rounded-l-control bg-transparent pr-1 pl-2 text-[12px] font-medium text-ink-2 outline-none"
                  >
                    <option value="none">None</option>
                    <option value="percent">%</option>
                    <option value="amount">$</option>
                  </select>
                  <input
                    type="number"
                    min={0}
                    value={discountKind === "none" ? "" : discountValue}
                    disabled={discountKind === "none"}
                    onChange={(e) => setDiscountValue(Number(e.target.value))}
                    aria-label="Discount value"
                    placeholder="0"
                    className={cn(
                      "h-full w-full min-w-0 bg-transparent px-1.5 text-right font-mono text-[12.5px] text-ink tabular-nums outline-none",
                      NO_SPINNER,
                      "disabled:text-ink-4"
                    )}
                  />
                </div>
              </div>

              <span className="flex-1" />

              <button
                type="button"
                onClick={() => {
                  setPickSource(shortlist.length ? "shortlist" : "catalogue")
                  setPicking(true)
                }}
                className="inline-flex h-[32px] items-center gap-1.5 rounded-control bg-surface px-2.5 text-xs font-medium text-ink shadow-btn transition-colors hover:bg-hover"
              >
                <Icon path={paths.plus} size={14} width={2.1} />
                Add styles
                {shortlist.length > 0 && (
                  <span className="font-mono text-[11px] text-ink-4">
                    {shortlist.length} ★
                  </span>
                )}
              </button>
            </div>

            {/* the order is addressed to one supplier; catalogue lines from
                another are flagged rather than forbidden */}
            {strayLines.length > 0 && (
              <div className="m-3.5 flex items-start gap-2 rounded-panel bg-orange-tint px-3 py-2.5 text-[12px] text-ink-2 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--orange)_30%,transparent)]">
                <Icon
                  path={paths.alert}
                  size={14}
                  width={2}
                  className="mt-px shrink-0 text-orange"
                />
                {strayLines.length} line
                {strayLines.length === 1 ? " comes" : "s come"} from a different
                catalogue supplier than this order is addressed to.
              </div>
            )}

            <table className="w-full min-w-[880px] table-fixed border-separate border-spacing-0 text-[13px]">
              <colgroup>
                <col style={{ width: 300 }} />
                <col style={{ width: 108 }} />
                <col style={{ width: 116 }} />
                <col style={{ width: 196 }} />
                <col style={{ width: 116 }} />
                <col style={{ width: 44 }} />
              </colgroup>
              <thead>
                <tr className="[&>th]:sticky [&>th]:top-0 [&>th]:z-5 [&>th]:h-9 [&>th]:border-b [&>th]:border-b-line-strong [&>th]:bg-surface [&>th]:px-3 [&>th]:text-[11px] [&>th]:font-semibold [&>th]:tracking-[0.04em] [&>th]:text-ink-3 [&>th]:uppercase">
                  <th className="pl-3.5 text-left">Article</th>
                  <th className="text-left">Division</th>
                  <th className="text-right">Qty</th>
                  <th className="text-right">Unit price</th>
                  <th className="text-right">Line total</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => {
                  const p = product(line.productId, products)
                  const lineIssues = issues.filter((i) => i.lineId === line.id)
                  const blocked = lineIssues.some((i) => i.severity === "block")

                  return (
                    <tr
                      key={line.id}
                      className={cn(
                        "group/line",
                        blocked &&
                          "[&>td]:bg-[color-mix(in_srgb,var(--ember)_5%,var(--surface))]"
                      )}
                    >
                      {/* the article itself stays read-only for catalogue lines */}
                      <td
                        className={cn(
                          "py-2 pr-2 pl-3.5 align-middle",
                          rule,
                          vrule
                        )}
                      >
                        <span className="flex items-center gap-2.5">
                          {p ? (
                            <Thumb
                              product={p}
                              className="h-[46px] w-[35px] rounded-chip"
                            />
                          ) : (
                            <span className="grid h-[46px] w-[35px] shrink-0 place-items-center rounded-chip bg-inset text-ink-4 shadow-[inset_0_0_0_1px_var(--line)]">
                              <Icon path={paths.edit} size={14} width={1.8} />
                            </span>
                          )}
                          <span className="min-w-0 flex-1">
                            {p ? (
                              <>
                                <span className="block truncate text-[12.5px] font-medium text-ink">
                                  {p.name}
                                </span>
                                <span className="block truncate font-mono text-[10.5px] text-ink-4">
                                  {p.sku}
                                </span>
                                <span className="mt-1 flex flex-wrap gap-1">
                                  {line.tags.length ? (
                                    line.tags.map((tag) => (
                                      <span
                                        key={tag}
                                        className="inline-flex h-[18px] max-w-[110px] items-center truncate rounded-[5px] bg-inset px-1.5 text-[10.5px] font-medium text-ink-3 shadow-[inset_0_0_0_1px_var(--line)]"
                                      >
                                        {tag}
                                      </span>
                                    ))
                                  ) : (
                                    <span className="text-[10.5px] text-ink-4">
                                      No Internal tags
                                    </span>
                                  )}
                                </span>
                              </>
                            ) : (
                              <>
                                <span className="block text-[11px] text-ember">
                                  Not an Internal sourcing item
                                </span>
                              </>
                            )}
                          </span>
                        </span>
                      </td>

                      <td
                        className={cn("h-[62px] p-0 align-middle", rule, vrule)}
                      >
                        {/* the control is the cell — no inset pill, no rounding */}
                        <select
                          value={
                            divisions.some(
                              (division) => division.id === line.division
                            )
                              ? line.division
                              : "__none"
                          }
                          onChange={(e) =>
                            patch(line.id, {
                              division:
                                e.target.value === "__none"
                                  ? ""
                                  : e.target.value,
                            })
                          }
                          aria-label={`Division for ${lineName(line, products)}`}
                          disabled={Boolean(p?.sourcingItemId)}
                          className={cn(
                            CELL,
                            "cursor-pointer appearance-none rounded-none bg-[length:11px] bg-[right_10px_center] bg-no-repeat pr-7",
                            line.division ? "text-ink" : "text-ink-4",
                            !line.division && INVALID
                          )}
                          style={{
                            backgroundImage:
                              "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%237e7e7d' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'><path d='m6 9 6 6 6-6'/></svg>\")",
                          }}
                        >
                          <option value="__none">—</option>
                          {divisions.map((division) => (
                            <option key={division.id} value={division.id}>
                              {division.name}
                            </option>
                          ))}
                        </select>
                      </td>

                      <td
                        className={cn("h-[62px] p-0 align-middle", rule, vrule)}
                      >
                        <input
                          type="number"
                          min={0}
                          value={line.quantity}
                          onChange={(e) =>
                            patch(line.id, { quantity: Number(e.target.value) })
                          }
                          aria-label={`Quantity for ${lineName(line, products)}`}
                          className={cn(
                            NUM_CELL,
                            line.quantity <= 0 && INVALID
                          )}
                        />
                      </td>

                      <td
                        className={cn("h-[62px] p-0 align-middle", rule, vrule)}
                      >
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          value={line.unitPrice}
                          onChange={(e) =>
                            patch(line.id, {
                              unitPrice: Number(e.target.value),
                            })
                          }
                          aria-label={`Unit price for ${lineName(line, products)}`}
                          readOnly={Boolean(p?.sourcingItemId)}
                          title={
                            p?.sourcingItemId
                              ? "Unit cost is sourced from Internal"
                              : undefined
                          }
                          className={cn(
                            NUM_CELL,
                            line.unitPrice <= 0 && INVALID
                          )}
                        />
                      </td>

                      <td
                        className={cn(
                          "px-2.5 text-right align-middle font-mono text-[12.5px] font-medium text-ink tabular-nums",
                          rule,
                          vrule
                        )}
                      >
                        {money(lineTotal(line), p?.currency || orderCurrency)}
                      </td>

                      <td
                        className={cn("pr-2.5 text-center align-middle", rule)}
                      >
                        <button
                          type="button"
                          aria-label={`Remove ${lineName(line, products)}`}
                          onClick={() => remove(line.id)}
                          className="grid size-[24px] place-items-center rounded-chip text-ink-4 opacity-0 transition-colors group-hover/line:opacity-100 hover:bg-hover-2 hover:text-ember"
                        >
                          <Icon path={paths.trash} size={13} width={1.9} />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>

            {!lines.length && (
              <div className="flex h-[220px] flex-col items-center justify-center gap-2 text-ink-4">
                <span className="grid size-[34px] place-items-center rounded-panel bg-inset shadow-[inset_0_0_0_1px_var(--line-strong)]">
                  <Icon path={paths.doc} size={17} width={1.8} />
                </span>
                <span className="text-xs">No lines yet.</span>
                <span className="flex gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setPickSource(
                        shortlist.length ? "shortlist" : "catalogue"
                      )
                      setPicking(true)
                    }}
                    className="inline-flex h-[30px] items-center gap-1.5 rounded-control bg-surface px-2.5 text-xs font-medium text-ink shadow-btn transition-colors hover:bg-hover"
                  >
                    <Icon path={paths.plus} size={14} width={2.1} />
                    Add styles
                  </button>
                </span>
              </div>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-2 border-t border-line px-3.5 py-3">
            {blocks.length > 0 ? (
              <span className="flex min-w-0 items-center gap-1.5 text-[11.5px] text-ember">
                <Icon
                  path={paths.alert}
                  size={13}
                  width={2}
                  className="shrink-0"
                />
                <span className="truncate">{blocks[0].message}</span>
                {blocks.length > 1 && (
                  <span className="shrink-0 font-mono text-ink-4">
                    +{blocks.length - 1} more
                  </span>
                )}
              </span>
            ) : (
              <span className="font-mono text-[11px] text-ink-4">
                {warns.length > 0
                  ? `${warns.length} thing${warns.length === 1 ? "" : "s"} to check at review`
                  : "Ready for review"}
              </span>
            )}
            <span className="flex-1" />
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-[30px] items-center rounded-control bg-surface px-2.5 text-xs font-medium text-ink shadow-btn transition-colors hover:bg-hover"
            >
              Discard
            </button>
            <button
              type="button"
              disabled={blocks.length > 0}
              onClick={() => setStep("review")}
              className="inline-flex h-[30px] items-center gap-1.5 rounded-control bg-accent px-2.5 text-xs font-medium text-white shadow-[0_1px_2px_rgb(0_134_252/.3)] transition-[filter] hover:brightness-105 disabled:pointer-events-none disabled:opacity-45"
            >
              Continue to review
              <Icon path={paths.chevronRight} size={14} width={2.2} />
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="min-h-0 flex-1 overflow-auto">
            <div className="grid grid-cols-3 gap-2 px-3.5 pt-4 pb-3">
              {[
                { label: "Units", value: units.toLocaleString() },
                {
                  label: discount > 0 ? "Discount" : "Subtotal",
                  value:
                    discount > 0
                      ? `−${money(discount, orderCurrency)}`
                      : money(subtotal, orderCurrency),
                },
                { label: "Order value", value: money(total, orderCurrency) },
              ].map((stat) => (
                <div
                  key={stat.label}
                  className="rounded-panel bg-inset px-3 py-2.5 shadow-[inset_0_0_0_1px_var(--line)]"
                >
                  <div className="pb-1 text-[10.5px] font-semibold tracking-[0.04em] text-ink-4 uppercase">
                    {stat.label}
                  </div>
                  <div className="font-mono text-[17px] font-medium tracking-[-0.02em] text-ink">
                    {stat.value}
                  </div>
                </div>
              ))}
            </div>

            {/* the same grid as the edit step, now read-only */}
            <VirtualRows
              rows={lines}
              rowKey={(line) => line.id}
              columns={REVIEW_LINES_COLUMNS}
              rowHeight={62}
              className="min-w-[720px]"
              hoverable
              header={
                <>
                  <span className="pl-3.5">Article</span>
                  <span className="px-2.5">Division</span>
                  <span className="px-2.5 text-right">Qty</span>
                  <span className="px-2.5 text-right">Unit price</span>
                  <span className="pr-3.5 pl-2.5 text-right">Line total</span>
                </>
              }
              renderRow={(line) => {
                const p = product(line.productId, products)
                return (
                  <>
                    <span
                      role="gridcell"
                      className="py-2 pr-2.5 pl-3.5"
                    >
                      <span className="flex items-center gap-2.5">
                        {p ? (
                          <Thumb
                            product={p}
                            className="h-[46px] w-[35px] rounded-chip"
                          />
                        ) : (
                          <span className="grid h-[46px] w-[35px] shrink-0 place-items-center rounded-chip bg-inset text-ink-4 shadow-[inset_0_0_0_1px_var(--line)]">
                            <Icon path={paths.edit} size={14} width={1.8} />
                          </span>
                        )}
                        <span className="min-w-0">
                          <span className="block truncate text-[12.5px] font-medium text-ink">
                            {lineName(line, products)}
                          </span>
                          <span className="block truncate font-mono text-[10.5px] text-ink-4">
                            {p?.sku ?? "manual line"}
                          </span>
                          {line.tags.length > 0 && (
                            <span className="mt-1 flex flex-wrap gap-1">
                              {line.tags.map((t) => (
                                <span
                                  key={t}
                                  className="inline-flex h-[18px] max-w-[110px] items-center truncate rounded-[5px] bg-inset px-1.5 text-[10.5px] font-medium text-ink-3 shadow-[inset_0_0_0_1px_var(--line)]"
                                >
                                  {t}
                                </span>
                              ))}
                            </span>
                          )}
                        </span>
                      </span>
                    </span>
                    <span
                      role="gridcell"
                      className="px-2.5 text-[12px] text-ink-2"
                    >
                      {line.division ? (
                        divisionLabel(line.division, divisions)
                      ) : (
                        <span className="text-ink-4">—</span>
                      )}
                    </span>
                    <span
                      role="gridcell"
                      className="px-2.5 text-right font-mono text-[12.5px] text-ink-2 tabular-nums"
                    >
                      {line.quantity.toLocaleString()}
                    </span>
                    <span
                      role="gridcell"
                      className="px-2.5 text-right font-mono text-[12.5px] text-ink-2 tabular-nums"
                    >
                      {money(line.unitPrice, p?.currency || orderCurrency)}
                    </span>
                    <span
                      role="gridcell"
                      className="pr-3.5 pl-2.5 text-right font-mono text-[12.5px] font-medium text-ink tabular-nums"
                    >
                      {money(lineTotal(line), p?.currency || orderCurrency)}
                    </span>
                  </>
                )
              }}
            />

            <div className="px-3.5 py-4">
              {submitError && (
                <div className="mb-3 rounded-panel border border-ember/20 bg-ember/5 px-3 py-2 text-[11.5px] text-ember">
                  Purchase order was not created: {submitError}
                </div>
              )}
              {warns.length > 0 && (
                <ul className="mb-3 flex flex-col rounded-panel border border-line-strong">
                  {warns.map((issue, i) => (
                    <li
                      key={`${issue.lineId}-${i}`}
                      className="flex items-start gap-2 border-b border-line px-3 py-2 text-[12px] text-ink-2 last:border-b-0"
                    >
                      <Icon
                        path={paths.alert}
                        size={13}
                        width={2}
                        className={cn(
                          "mt-px shrink-0",
                          issue.severity === "block"
                            ? "text-ember"
                            : "text-orange"
                        )}
                      />
                      {issue.message}
                    </li>
                  ))}
                </ul>
              )}

              <label
                htmlFor="po-note"
                className="block pb-1.5 text-xs font-medium text-ink-2"
              >
                Note <span className="font-normal text-ink-4">optional</span>
              </label>
              <textarea
                id="po-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Anything the supplier should know…"
                className="min-h-[80px] w-full resize-y rounded-control bg-field px-2.5 py-2 text-[13px] leading-[1.55] font-medium text-ink shadow-[inset_0_0_0_1px_var(--line-strong)] outline-none focus:bg-surface focus:shadow-[inset_0_0_0_1px_var(--accent),0_0_0_3px_var(--accent-tint)]"
              />
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2 border-t border-line px-3.5 py-3">
            <button
              type="button"
              onClick={() => setStep("edit")}
              className="inline-flex h-[30px] items-center gap-1.5 rounded-control px-2.5 text-xs font-medium text-ink-3 transition-colors hover:bg-hover hover:text-ink"
            >
              <Icon
                path={paths.chevronRight}
                size={14}
                width={2.2}
                className="rotate-180"
              />
              Back to lines
            </button>
            <span className="flex-1" />
            {blocks.length > 0 && (
              <span className="font-mono text-[11px] text-ember">
                {blocks.length} blocking issue{blocks.length === 1 ? "" : "s"}
              </span>
            )}
            <button
              type="button"
              disabled={blocks.length > 0 || submitBusy}
              onClick={submit}
              className="inline-flex h-[30px] items-center gap-1.5 rounded-control bg-accent px-2.5 text-xs font-medium text-white shadow-[0_1px_2px_rgb(0_134_252/.3)] transition-[filter] hover:brightness-105 disabled:pointer-events-none disabled:opacity-45"
            >
              <Icon path={paths.check} size={14} width={2.2} />
              {submitBusy ? "Creating…" : "Create purchase order"}
            </button>
          </div>
        </>
      )}

      <SheetShell
        open={supplierSheet !== null}
        eyebrow="Supplier"
        title={
          supplierSheet === "create" ? "Add a supplier" : (supplier?.name ?? "")
        }
        onRequestClose={() => setSupplierSheet(null)}
        footer={
          supplierSheet === "create" ? (
            <>
              <span className="flex-1" />
              <button
                type="button"
                onClick={() => setSupplierSheet(null)}
                className={sheetButton.secondary}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={
                  !newSupplier.name.trim() ||
                  !newSupplier.code.trim() ||
                  !newSupplier.address.trim() ||
                  supplierBusy
                }
                onClick={async () => {
                  setSupplierBusy(true)
                  try {
                    const created = await createSupplier.execute({
                      name: newSupplier.name.trim(),
                      code: newSupplier.code.trim(),
                      address: newSupplier.address.trim(),
                      status: "active",
                    })
                    const id =
                      created &&
                      typeof created === "object" &&
                      "supplier_id" in created
                        ? String(
                            (created as { supplier_id: unknown }).supplier_id
                          )
                        : ""
                    if (!id)
                      throw new Error(
                        "Internal did not return the new supplier id"
                      )
                    setSupplierId(id)
                    setNewSupplier({ name: "", code: "", address: "" })
                    setSupplierSheet(null)
                  } catch (error: unknown) {
                    setSubmitError(getErrorMessage(error))
                  } finally {
                    setSupplierBusy(false)
                  }
                }}
                className={cn(
                  sheetButton.primary,
                  "disabled:pointer-events-none disabled:opacity-45"
                )}
              >
                <Icon path={paths.check} size={14} width={2.2} />
                {supplierBusy ? "Adding…" : "Add supplier"}
              </button>
            </>
          ) : (
            <>
              <span className="flex-1" />
              <button
                type="button"
                onClick={() => setSupplierSheet(null)}
                className={sheetButton.secondary}
              >
                Close
              </button>
            </>
          )
        }
      >
        {supplierSheet === "create" ? (
          <div className="px-[18px] pt-4 pb-[18px]">
            <label
              htmlFor="sup-name"
              className="block pb-1.5 text-xs font-medium text-ink-2"
            >
              Name <span className="text-ember">*</span>
            </label>
            <input
              id="sup-name"
              value={newSupplier.name}
              onChange={(e) =>
                setNewSupplier((v) => ({ ...v, name: e.target.value }))
              }
              placeholder="Who are you buying from?"
              className="mb-4 h-[36px] w-full rounded-control bg-field px-2.5 text-[13.5px] font-medium text-ink shadow-[inset_0_0_0_1px_var(--line-strong)] outline-none placeholder:font-normal placeholder:text-ink-4 focus:bg-surface focus:shadow-[inset_0_0_0_1px_var(--accent),0_0_0_3px_var(--accent-tint)]"
            />
            <label
              htmlFor="sup-code"
              className="block pb-1.5 text-xs font-medium text-ink-2"
            >
              Code <span className="text-ember">*</span>
            </label>
            <input
              id="sup-code"
              value={newSupplier.code}
              onChange={(e) =>
                setNewSupplier((v) => ({ ...v, code: e.target.value }))
              }
              placeholder="Supplier code"
              className="mb-4 h-[36px] w-full rounded-control bg-field px-2.5 text-[13.5px] font-medium text-ink shadow-[inset_0_0_0_1px_var(--line-strong)] outline-none placeholder:font-normal placeholder:text-ink-4 focus:bg-surface focus:shadow-[inset_0_0_0_1px_var(--accent),0_0_0_3px_var(--accent-tint)]"
            />
            <label
              htmlFor="sup-address"
              className="block pb-1.5 text-xs font-medium text-ink-2"
            >
              Address <span className="text-ember">*</span>
            </label>
            <input
              id="sup-address"
              value={newSupplier.address}
              onChange={(e) =>
                setNewSupplier((v) => ({ ...v, address: e.target.value }))
              }
              placeholder="Supplier address"
              className="h-[36px] w-full rounded-control bg-field px-2.5 text-[13.5px] font-medium text-ink shadow-[inset_0_0_0_1px_var(--line-strong)] outline-none placeholder:font-normal placeholder:text-ink-4 focus:bg-surface focus:shadow-[inset_0_0_0_1px_var(--accent),0_0_0_3px_var(--accent-tint)]"
            />
          </div>
        ) : supplier ? (
          <div className="px-[18px] pt-4 pb-[18px]">
            <div className="flex items-center gap-3 pb-4">
              <span
                style={{ background: supplier.hue }}
                className="grid size-11 shrink-0 place-items-center rounded-panel text-base font-semibold text-white uppercase"
              >
                {supplier.name[0]}
              </span>
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold">
                  {supplier.name}
                </div>
                <div className="truncate text-xs text-ink-4">
                  {supplier.division}
                </div>
              </div>
            </div>

            {[
              { label: "Division", value: supplier.division },
              { label: "Country", value: supplier.country },
              {
                label: "On this order",
                value: `${lines.length} line${lines.length === 1 ? "" : "s"} · ${money(total, orderCurrency)}`,
              },
              {
                label: "Catalogue styles",
                value: String(
                  products.filter((p) => p.supplierId === supplier.id).length
                ),
              },
            ].map((row) => (
              <div
                key={row.label}
                className="flex items-start gap-3 border-t border-line py-[9px]"
              >
                <span className="w-[104px] shrink-0 pt-px text-xs text-ink-4">
                  {row.label}
                </span>
                <span className="min-w-0 flex-1 text-xs font-medium text-ink-2">
                  {row.value}
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </SheetShell>

      <SheetShell
        open={picking}
        size="wide"
        eyebrow="Add to order"
        title="Pick from the catalogue"
        onRequestClose={() => setPicking(false)}
      >
        <div className="sticky top-0 z-5 flex items-center gap-2.5 border-b border-line bg-surface px-4 py-3">
          <div
            role="tablist"
            className="flex shrink-0 items-center gap-0.5 rounded-control bg-inset p-0.5"
          >
            {(
              [
                ["shortlist", `Shortlist`, shortlist.length],
                ["catalogue", "Catalogue", products.length],
              ] as const
            ).map(([id, label, count]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={pickSource === id}
                onClick={() => setPickSource(id)}
                className={cn(
                  "inline-flex h-[26px] items-center gap-1.5 rounded-[7px] px-2.5 text-xs font-medium transition-[background-color,color,box-shadow] duration-[130ms]",
                  pickSource === id
                    ? "bg-surface font-semibold text-ink shadow-[0_0_0_1px_var(--line-strong),0_1px_2px_rgb(18_18_18/.05)]"
                    : "text-ink-3 hover:text-ink-2"
                )}
              >
                {label}
                <span className="font-mono text-[10.5px] text-ink-4">
                  {count}
                </span>
              </button>
            ))}
          </div>

          <label className="flex h-[34px] flex-1 items-center gap-2 rounded-control bg-field px-2.5 text-ink-4 shadow-[inset_0_0_0_1px_var(--line-strong)] focus-within:bg-surface focus-within:shadow-[inset_0_0_0_1px_var(--accent)]">
            <Icon path={paths.search} size={14} width={1.9} />
            <input
              value={pickQuery}
              onChange={(e) => setPickQuery(e.target.value)}
              placeholder="Search styles, SKU or supplier…"
              aria-label="Search catalogue"
              className="w-full text-[13px] font-medium outline-none placeholder:font-normal placeholder:text-ink-4"
            />
            <span className="shrink-0 font-mono text-[11px] text-ink-4">
              {pickable.length}
            </span>
          </label>
        </div>

        <div className="grid grid-cols-[repeat(auto-fill,minmax(178px,1fr))] gap-2.5 p-4">
          {pickable.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => addCatalogueLine(p.id)}
              className="group/pick flex flex-col overflow-hidden rounded-panel border border-line-strong bg-surface text-left transition-[border-color,box-shadow] duration-[130ms] hover:border-accent hover:shadow-card"
            >
              <span className="relative block aspect-[3/4] w-full overflow-hidden bg-inset">
                <Thumb
                  product={p}
                  className="size-full transition-transform duration-[400ms] ease-out-strong group-hover/pick:scale-[1.03]"
                />
                <span className="absolute inset-x-0 bottom-0 flex translate-y-full items-center justify-center gap-1 bg-accent py-1.5 text-[11.5px] font-semibold text-white transition-transform duration-[180ms] ease-out-strong group-hover/pick:translate-y-0">
                  <Icon path={paths.plus} size={12} width={2.4} />
                  Add to order
                </span>
              </span>
              <span className="flex flex-1 flex-col gap-1 p-2.5">
                <span className="flex items-baseline gap-1.5">
                  <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-ink">
                    {p.name}
                  </span>
                  <span className="shrink-0 font-mono text-[12px] text-ink tabular-nums">
                    {money(p.price, p.currency || orderCurrency)}
                  </span>
                </span>
                <span className="truncate font-mono text-[10.5px] text-ink-4">
                  {p.sku}
                </span>
                <span className="truncate text-[11px] text-ink-3">
                  {supplierOf(p.supplierId, suppliers)?.name} ·{" "}
                  {supplierOf(p.supplierId, suppliers)?.division}
                </span>
                <span className="mt-auto pt-1 font-mono text-[10.5px] text-ink-4">
                  MOQ {p.moq} · {p.leadTime}d
                </span>
              </span>
            </button>
          ))}
          {!pickable.length && (
            <div className="col-span-full py-14 text-center text-xs text-ink-4">
              {pickSource === "shortlist" && !shortlist.length
                ? "Nothing shortlisted yet — star styles in Sourcing."
                : "Nothing matches that."}
            </div>
          )}
        </div>
      </SheetShell>
    </div>
  )
}
