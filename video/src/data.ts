/* The demo book the film is shot on. Names come from the demo seed
   (scripts/demo-seed.sh, scripts/build-sourcing-seed.py); prices from
   scripts/demo-populate.py — Kemeja Oxford at Rp 85.000 a piece, agreed by
   the dozen at Rp 1.020.000. */

export const SUPPLIER = "Garmen Nusantara, PT"
export const ARTICLE = "Kemeja Oxford Lengan Panjang"
export const PRICE_PER_LUSIN = 1_020_000
export const ORDERED = 600
/** 600 pcs at Rp 1.020.000 a lusin: 600 × 1.020.000 ÷ 12, rounded once. */
export const VALUE = Math.round((ORDERED * PRICE_PER_LUSIN) / 12)

export interface ListRow {
  supplier: string
  po: string
  items: number
  delivery: string
  overdue?: boolean
  ordered: number
  orderedValue: number
  received: number
  beyond?: number
  receivedValue: number
  status:
    | "Active"
    | "Partially received"
    | "Fully received"
    | "Closed short"
    | "Offline"
    | "Review"
}

/** The rest of the book, under whichever order the scene is about. */
export const BOOK: readonly ListRow[] = [
  {
    supplier: "Sepatu Sejahtera, CV",
    po: "PO-071026-004",
    items: 2,
    delivery: "12 Oct 2026",
    ordered: 240,
    orderedValue: 34_800_000,
    received: 120,
    receivedValue: 17_400_000,
    status: "Partially received",
  },
  {
    supplier: "Sinar Tekstil Nusantara, PT",
    po: "PO-061026-002",
    items: 3,
    delivery: "14 Oct 2026",
    ordered: 480,
    orderedValue: 28_320_000,
    received: 0,
    receivedValue: 0,
    status: "Active",
  },
  {
    supplier: "Srikandi Busana Mandiri, CV",
    po: "PO-051026-003",
    items: 1,
    delivery: "07 Oct 2026",
    overdue: true,
    ordered: 120,
    orderedValue: 8_640_000,
    received: 0,
    receivedValue: 0,
    status: "Active",
  },
  {
    supplier: "Garmen Nusantara, PT",
    po: "PO-041026-011",
    items: 1,
    delivery: "10 Oct 2026",
    ordered: 360,
    orderedValue: 12_600_000,
    received: 0,
    receivedValue: 0,
    status: "Active",
  },
  {
    supplier: "Sepatu Sejahtera, CV",
    po: "PO-031026-006",
    items: 2,
    delivery: "09 Oct 2026",
    ordered: 96,
    orderedValue: 15_360_000,
    received: 0,
    receivedValue: 0,
    status: "Active",
  },
]

/** The order every chapter follows, as the list shows it when it is new. */
export const OURS = (po: string, patch: Partial<ListRow> = {}): ListRow => ({
  supplier: SUPPLIER,
  po,
  items: 1,
  delivery: "15 Oct 2026",
  ordered: ORDERED,
  orderedValue: VALUE,
  received: 0,
  receivedValue: 0,
  status: "Active",
  ...patch,
})
