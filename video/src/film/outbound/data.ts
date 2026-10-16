/* The outbound film's book: one board the chapters share, so a card that is
   made in chapter 1 is the one picked in chapter 2. Store names, suppliers
   and SKUs follow outbound-board-prototype.html; ALT-0408's Store PIK is
   already on the road so MD's edit has a locked row to show (Hari, 9 Oct). */
import type { AllotmentRow, BoardCard } from "../../ui/outbound"

export const OB_STEPS = ["Allotment", "To pick", "Picked", "Packed", "In transit", "Received"] as const

export const BASE: BoardCard[] = [
  { id: "s1", lane: "pick", store: "Store Senayan", ref: "ALT-0411", pcs: 96, meta: "6 SKUs" },
  { id: "s2", lane: "pick", store: "Store PIK", ref: "ALT-0412", pcs: 180, meta: "5 SKUs" },
  { id: "s3", lane: "pick", store: "Store Bintaro", ref: "ALT-0409", pcs: 3, meta: "1 SKU", shortPick: true },
  { id: "s4", lane: "pick", store: "Store Kemang", ref: "ALT-0412", pcs: 240, meta: "4 SKUs" },
  { id: "p1", lane: "picked", store: "Store Bintaro", ref: "ALT-0410", pcs: 120, meta: "4 SKUs" },
  { id: "p2", lane: "picked", store: "Store BSD", ref: "ALT-0410", pcs: 150, meta: "3 SKUs" },
  { id: "k1", lane: "packed", store: "Store Kemang", ref: "ALT-0408", pcs: 300, meta: "4 koli" },
  { id: "k2", lane: "packed", store: "Store Kelapa Gading", ref: "ALT-0407", pcs: 80, meta: "1 koli" },
  { id: "k3", lane: "packed", store: "Store BSD", ref: "ALT-0405", pcs: 90, meta: "2 koli" },
  { id: "t1", lane: "transit", store: "Store PIK", ref: "SJ-091026-001", pcs: 210, meta: "3 koli" },
  { id: "t2", lane: "transit", store: "Store BSD", ref: "SJ-280926-002", pcs: 140, meta: "2 koli" },
  { id: "t3", lane: "transit", store: "Store Senayan", ref: "SJ-290926-004", pcs: 260, meta: "3 koli" },
  { id: "r1", lane: "recv", store: "Store PIK", ref: "SJ-260926-003", pcs: 220, got: 214, meta: "3 koli", missing: 6 },
  { id: "r2", lane: "recv", store: "Store Kemang", ref: "SJ-270926-001", pcs: 190, got: 190, meta: "2 koli" },
]

/* Chapter 1's allotment: Kemeja Oxford Slim, 6 SKUs × 40, split over six
   stores (7,7,7,7,6,6), then Navy · M moved 3 from Bintaro to Kemang. */
export const STORES = [
  { name: "Kemang", code: "S01", full: "Store Kemang" },
  { name: "PIK", code: "S02", full: "Store PIK" },
  { name: "Senayan", code: "S03", full: "Store Senayan" },
  { name: "BSD", code: "S04", full: "Store BSD" },
  { name: "Bintaro", code: "S05", full: "Store Bintaro" },
  { name: "Kelapa Gading", code: "S06", full: "Store Kelapa Gading" },
]

export const OXFORD_SKUS = [
  { label: "Navy · S", code: "00000021101", stock: 40 },
  { label: "Navy · M", code: "00000021102", stock: 40 },
  { label: "Navy · L", code: "00000021103", stock: 40 },
  { label: "White · S", code: "00000021201", stock: 40 },
  { label: "White · M", code: "00000021202", stock: 40 },
  { label: "White · L", code: "00000021203", stock: 40 },
]

export const EVEN = [7, 7, 7, 7, 6, 6]

/** The split after the tweak: Navy · M is 10 to Kemang and 3 to Bintaro. */
export const SPLIT: number[][] = OXFORD_SKUS.map((_, i) =>
  i === 1 ? [10, 7, 7, 7, 3, 6] : [...EVEN]
)

export const columnTotal = (j: number) => SPLIT.reduce((s, row) => s + row[j], 0)

/** The six picklists ALT-0413 puts on the board. */
export const NEW_0413: BoardCard[] = STORES.map((st, j) => ({
  id: `n${j}`,
  lane: "pick" as const,
  store: st.full,
  ref: "ALT-0413",
  pcs: columnTotal(j),
  meta: "6 SKUs",
}))

/** Store Kemang's picklist of ALT-0413, line by line. */
export const KEMANG_0413 = OXFORD_SKUS.map((k, i) => ({
  name: `Kemeja Oxford Slim · ${k.label}`,
  sku: k.code,
  qty: SPLIT[i][0],
}))

export const ALLOTTED: AllotmentRow[] = [
  { id: "ALT-0413", supplier: "PT Tekstil Jaya", stores: 6, pcs: 240, where: "5 to pick · 1 on the road", status: "Active" },
  { id: "ALT-0412", supplier: "PT Sinar Garmen", stores: 2, pcs: 420, where: "2 to pick", status: "Active" },
  { id: "ALT-0411", supplier: "CV Benang Mas", stores: 1, pcs: 96, where: "1 to pick", status: "Active" },
  { id: "ALT-0410", supplier: "Konveksi Anugerah", stores: 4, pcs: 420, where: "1 to pick · 1 picked · 1 packed · 1 on the road", status: "Active" },
  { id: "ALT-0409", supplier: "Konveksi Anugerah", stores: 1, pcs: 12, where: "1 to pick · 1 received", status: "Active" },
  { id: "ALT-0408", supplier: "PT Tekstil Jaya", stores: 2, pcs: 510, where: "1 packed · 1 on the road", status: "Active" },
  { id: "ALT-0407", supplier: "CV Kain Nusantara", stores: 1, pcs: 80, where: "1 on the road", status: "Active" },
  { id: "ALT-0402", supplier: "CV Benang Mas", stores: 1, pcs: 190, where: "1 received", status: "Completed" },
  { id: "ALT-0401", supplier: "PT Sinar Garmen", stores: 1, pcs: 214, where: "1 received", note: "Received 214/220 · 6 short", status: "Received short" },
]
