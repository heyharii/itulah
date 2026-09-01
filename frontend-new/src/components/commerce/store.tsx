import { createContext, useCallback, useContext, useMemo, useState } from "react"

import { PRODUCTS, SUPPLIERS, type Product, type Supplier } from "@/components/sourcing/catalogue"
import { SEED_PAYMENTS, type Payment } from "@/components/finance/data"

export interface ShortlistEntry {
  productId: string
  /** The colourway the buyer picked while browsing. */
  colorwayId: string
  note?: string
  addedAt: number
}

export interface PoLine {
  id: string
  /** null for a line typed by hand rather than drawn from the catalogue. */
  productId: string | null
  /** Optional supplier-product provenance retained on the backend PO line. */
  sourcingItemId?: string
  /** Only used by manual lines; catalogue lines take their name from the product. */
  name?: string
  quantity: number
  /** Unit price, editable — catalogue lines start from the catalogue price. */
  unitPrice: number
  /** The making division for this article. Seeded from the supplier, editable. */
  division: string
  /** Article tags. Seeded from the catalogue, editable, and free on manual lines. */
  tags: string[]
  /** Evidence URLs required by the Internal procurement contract. */
  photoUrls?: string[]
  note?: string
}

/**
 * UI-only draft states plus the canonical lifecycle values returned by the
 * internal procurement API. The latter are kept verbatim so the screen never
 * turns a server state into a made-up approval transition.
 */
export type PoStatus =
  | "draft"
  | "in-review"
  | "approved"
  | "sent"
  | "active"
  | "closed"
  | "cancelled"

export interface PurchaseOrder {
  id: string
  number: string
  /** A catalogue supplier, when the order came from one. */
  supplierId: string | null
  /** Requested delivery for the whole order, as yyyy-mm-dd. */
  deliveryDate: string
  /** Order-level discount, agreed once for the whole PO. */
  discountKind: "none" | "percent" | "amount"
  discountValue: number
  status: PoStatus
  lines: PoLine[]
  createdAt: number
  /** Filled once the review gate is passed. */
  approvedBy?: string
  reviewNote?: string
}

interface CommerceValue {
  shortlist: ShortlistEntry[]
  orders: PurchaseOrder[]
  /** Catalogue suppliers plus any raised while drafting an order. */
  suppliers: Supplier[]
  addSupplier: (supplier: Omit<Supplier, "id" | "hue">) => Supplier
  /** Payments made against a supplier, not against one invoice. */
  payments: Payment[]
  addPayment: (payment: Omit<Payment, "id">) => void
  isShortlisted: (productId: string) => boolean
  addToShortlist: (productId: string, colorwayId?: string) => void
  removeFromShortlist: (productId: string) => void
  clearShortlist: () => void
  setShortlistColorway: (productId: string, colorwayId: string) => void
  createOrder: (order: PurchaseOrder) => void
  updateOrder: (id: string, patch: Partial<PurchaseOrder>) => void
}

const CommerceContext = createContext<CommerceValue | null>(null)

const productById = (id: string) => PRODUCTS.find((p) => p.id === id)

const SEED_ORDERS: PurchaseOrder[] = [
  {
    id: "po-1",
    number: "PO-2026-0041",
    supplierId: PRODUCTS[0]?.supplierId ?? "s-aurora",
    status: "sent",
    deliveryDate: "",
    discountKind: "none",
    discountValue: 0,
    createdAt: 4300,
    approvedBy: "Devi Kusuma",
    lines: PRODUCTS.slice(0, 2).map((p, i) => ({
      id: `l${i}`,
      productId: p.id,
      quantity: p.moq,
      unitPrice: p.price,
      division: "",
      tags: p.tags,
    })),
  },
]

export function CommerceProvider({ children }: { children: React.ReactNode }) {
  const [shortlist, setShortlist] = useState<ShortlistEntry[]>([])
  const [orders, setOrders] = useState<PurchaseOrder[]>(SEED_ORDERS)
  const [customSuppliers, setCustomSuppliers] = useState<Supplier[]>([])

  const suppliers = useMemo(() => [...SUPPLIERS, ...customSuppliers], [customSuppliers])
  const [payments, setPayments] = useState<Payment[]>(SEED_PAYMENTS)

  const addPayment = useCallback(
    (payment: Omit<Payment, "id">) =>
      setPayments((list) => [{ ...payment, id: `pay-${Date.now()}` }, ...list]),
    []
  )

  const HUES = ["#0086fc", "#00c978", "#ffbb26", "#ff58ae", "#7b5cfa", "#64c6ff", "#ff3e00"]

  const addSupplier = useCallback((input: Omit<Supplier, "id" | "hue">) => {
    const supplier: Supplier = {
      ...input,
      id: `s-new-${Date.now()}`,
      hue: HUES[Math.floor(Math.random() * HUES.length)],
    }
    setCustomSuppliers((list) => [...list, supplier])
    return supplier
  }, [])

  const isShortlisted = useCallback(
    (productId: string) => shortlist.some((s) => s.productId === productId),
    [shortlist]
  )

  const addToShortlist = useCallback((productId: string, colorwayId?: string) => {
    setShortlist((list) => {
      if (list.some((s) => s.productId === productId)) return list
      const product = productById(productId)
      if (!product) return list
      return [
        ...list,
        {
          productId,
          colorwayId: colorwayId ?? product.colorways[0].id,
          addedAt: Date.now(),
        },
      ]
    })
  }, [])

  const removeFromShortlist = useCallback(
    (productId: string) => setShortlist((list) => list.filter((s) => s.productId !== productId)),
    []
  )

  const clearShortlist = useCallback(() => setShortlist([]), [])

  const setShortlistColorway = useCallback(
    (productId: string, colorwayId: string) =>
      setShortlist((list) =>
        list.map((s) => (s.productId === productId ? { ...s, colorwayId } : s))
      ),
    []
  )

  const createOrder = useCallback(
    (order: PurchaseOrder) => setOrders((list) => [order, ...list]),
    []
  )

  const updateOrder = useCallback(
    (id: string, patch: Partial<PurchaseOrder>) =>
      setOrders((list) => list.map((o) => (o.id === id ? { ...o, ...patch } : o))),
    []
  )

  const value = useMemo(
    () => ({
      shortlist,
      orders,
      suppliers,
      addSupplier,
      payments,
      addPayment,
      isShortlisted,
      addToShortlist,
      removeFromShortlist,
      clearShortlist,
      setShortlistColorway,
      createOrder,
      updateOrder,
    }),
    [
      shortlist,
      orders,
      suppliers,
      addSupplier,
      payments,
      addPayment,
      isShortlisted,
      addToShortlist,
      removeFromShortlist,
      clearShortlist,
      setShortlistColorway,
      createOrder,
      updateOrder,
    ]
  )

  return <CommerceContext.Provider value={value}>{children}</CommerceContext.Provider>
}

export function useCommerce() {
  const value = useContext(CommerceContext)
  if (!value) throw new Error("useCommerce must be used inside CommerceProvider")
  return value
}

/** The next PO number, continuing the existing run. */
export function nextPoNumber(orders: PurchaseOrder[]) {
  const year = new Date().getFullYear()
  const highest = orders.reduce((max, o) => {
    const n = Number(o.number.split("-").pop())
    return Number.isFinite(n) ? Math.max(max, n) : max
  }, 0)
  return `PO-${year}-${String(highest + 1).padStart(4, "0")}`
}

/** A line's extended cost. */
export const lineTotal = (line: PoLine) => line.quantity * line.unitPrice

export const orderTotal = (order: Pick<PurchaseOrder, "lines">) =>
  order.lines.reduce((sum, l) => sum + lineTotal(l), 0)

export const orderUnits = (order: Pick<PurchaseOrder, "lines">) =>
  order.lines.reduce((sum, l) => sum + l.quantity, 0)

/** The money taken off the subtotal, whichever way it was expressed. */
export function orderDiscount(
  order: Pick<PurchaseOrder, "lines" | "discountKind" | "discountValue">
) {
  const subtotal = orderTotal(order)
  if (order.discountKind === "percent") {
    return subtotal * (Math.min(100, Math.max(0, order.discountValue)) / 100)
  }
  if (order.discountKind === "amount") {
    return Math.min(subtotal, Math.max(0, order.discountValue))
  }
  return 0
}

export const orderNet = (
  order: Pick<PurchaseOrder, "lines" | "discountKind" | "discountValue">
) => orderTotal(order) - orderDiscount(order)

export { productById }
export type { Product }
