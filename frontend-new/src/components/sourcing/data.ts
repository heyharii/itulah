export interface Supplier {
  id: string
  name: string
  /**
   * The mill or workshop inside the supplier.
   *
   * Optional because Internal does not send it: `master_suppliers` carries no
   * such column. The fixtures below still set it — they are design fixtures,
   * and that is exactly how a field nobody supplies came to look populated.
   */
  division?: string
  country: string
  hue: string
}

export type ProductStatus = "active" | "sampling" | "paused"

export interface Product {
  id: string
  name: string
  sku: string
  category: string
  /** Wholesale price per unit, in USD. */
  price: number
  /** Minimum order quantity the supplier will accept. */
  moq: number
  /** Production lead time in days. */
  leadTime: number
  supplierId: string
  tags: string[]
  status: ProductStatus
  /** Hex swatches — the colourways this style is offered in. */
  colorways: string[]
  material: string
  /** Minutes since the record was last touched. */
  updated: number
}

export const SUPPLIERS: Supplier[] = [
  {
    id: "s-aurora",
    name: "Aurora Textiles",
    division: "Knit Division",
    country: "Portugal",
    hue: "#7b5cfa",
  },
  {
    id: "s-baltic",
    name: "Baltic Mills",
    division: "Woven Division",
    country: "Lithuania",
    hue: "#0086fc",
  },
  {
    id: "s-cedar",
    name: "Cedar & Co.",
    division: "Denim Atelier",
    country: "Türkiye",
    hue: "#00c978",
  },
  {
    id: "s-kumo",
    name: "Kumo Apparel",
    division: "Outerwear Line",
    country: "Japan",
    hue: "#ff58ae",
  },
  {
    id: "s-sol",
    name: "Sol Fabrica",
    division: "Jersey Division",
    country: "Peru",
    hue: "#ffbb26",
  },
  {
    id: "s-harbor",
    name: "Harbor Works",
    division: "Accessories Unit",
    country: "Vietnam",
    hue: "#64c6ff",
  },
]

export const supplierOf = (id: string) => SUPPLIERS.find((s) => s.id === id)

export const CATEGORIES = [
  "Outerwear",
  "Knitwear",
  "Denim",
  "Jersey",
  "Shirting",
  "Accessories",
] as const

export const STATUS_META: Record<
  ProductStatus,
  { label: string; hue: string }
> = {
  active: { label: "In line", hue: "var(--grass)" },
  sampling: { label: "Sampling", hue: "var(--honey)" },
  paused: { label: "On hold", hue: "var(--ink-4)" },
}

/** Tags share a hue within a family, so colour carries meaning. */
export const TAG_HUE: Record<string, string> = {
  organic: "#00c978",
  recycled: "#00c978",
  "low-impact": "#00c978",
  core: "#0086fc",
  seasonal: "#ffbb26",
  capsule: "#ffbb26",
  premium: "#7b5cfa",
  heavyweight: "#7b5cfa",
  "quick-ship": "#ff58ae",
  restock: "#ff58ae",
}

export const ALL_TAGS = Object.keys(TAG_HUE)

export const PRODUCTS: Product[] = [
  {
    id: "p1",
    name: "Cropped Shell Parka",
    sku: "OW-1042",
    category: "Outerwear",
    price: 128.0,
    moq: 300,
    leadTime: 75,
    supplierId: "s-kumo",
    tags: ["premium", "seasonal"],
    status: "active",
    colorways: ["#1c1c1c", "#3d4a5c", "#8a7f6d"],
    material: "Recycled nylon ripstop",
    updated: 45,
  },
  {
    id: "p2",
    name: "Merino Rib Crewneck",
    sku: "KN-2210",
    category: "Knitwear",
    price: 62.5,
    moq: 250,
    leadTime: 60,
    supplierId: "s-aurora",
    tags: ["core", "premium"],
    status: "active",
    colorways: ["#e8dcc8", "#2f2f2f", "#7a1f2b"],
    material: "18.5µ merino wool",
    updated: 120,
  },
  {
    id: "p3",
    name: "Selvedge Straight Jean",
    sku: "DN-3301",
    category: "Denim",
    price: 84.0,
    moq: 400,
    leadTime: 90,
    supplierId: "s-cedar",
    tags: ["heavyweight", "core"],
    status: "active",
    colorways: ["#26364d", "#11161f"],
    material: "13.5oz selvedge denim",
    updated: 260,
  },
  {
    id: "p4",
    name: "Boxy Pocket Tee",
    sku: "JS-4120",
    category: "Jersey",
    price: 18.75,
    moq: 600,
    leadTime: 35,
    supplierId: "s-sol",
    tags: ["organic", "core", "quick-ship"],
    status: "active",
    colorways: ["#f4f1ea", "#1c1c1c", "#5b6b52", "#b8493c"],
    material: "Organic combed cotton, 220gsm",
    updated: 30,
  },
  {
    id: "p5",
    name: "Garment-Dyed Overshirt",
    sku: "SH-5006",
    category: "Shirting",
    price: 46.0,
    moq: 350,
    leadTime: 55,
    supplierId: "s-baltic",
    tags: ["seasonal", "low-impact"],
    status: "sampling",
    colorways: ["#8a7f6d", "#4a5b48", "#2f3540"],
    material: "Cotton twill, 260gsm",
    updated: 15,
  },
  {
    id: "p6",
    name: "Felted Wool Cap",
    sku: "AC-6011",
    category: "Accessories",
    price: 24.0,
    moq: 500,
    leadTime: 40,
    supplierId: "s-harbor",
    tags: ["capsule", "quick-ship"],
    status: "active",
    colorways: ["#1c1c1c", "#6d5b4a"],
    material: "Boiled lambswool",
    updated: 480,
  },
  {
    id: "p7",
    name: "Quilted Liner Vest",
    sku: "OW-1088",
    category: "Outerwear",
    price: 74.0,
    moq: 300,
    leadTime: 70,
    supplierId: "s-kumo",
    tags: ["recycled", "seasonal"],
    status: "sampling",
    colorways: ["#3d4a5c", "#7a6a58"],
    material: "Recycled polyester wadding",
    updated: 90,
  },
  {
    id: "p8",
    name: "Chunky Cable Cardigan",
    sku: "KN-2264",
    category: "Knitwear",
    price: 96.0,
    moq: 200,
    leadTime: 80,
    supplierId: "s-aurora",
    tags: ["premium", "heavyweight", "seasonal"],
    status: "active",
    colorways: ["#e8dcc8", "#3a4a3f"],
    material: "Lambswool blend, 7gg",
    updated: 600,
  },
  {
    id: "p9",
    name: "Relaxed Carpenter Pant",
    sku: "DN-3355",
    category: "Denim",
    price: 68.0,
    moq: 400,
    leadTime: 85,
    supplierId: "s-cedar",
    tags: ["core", "restock"],
    status: "active",
    colorways: ["#8a7f6d", "#26364d", "#1c1c1c"],
    material: "11oz rigid denim",
    updated: 1400,
  },
  {
    id: "p10",
    name: "Heavy Loopback Hoodie",
    sku: "JS-4188",
    category: "Jersey",
    price: 42.0,
    moq: 400,
    leadTime: 45,
    supplierId: "s-sol",
    tags: ["heavyweight", "organic", "restock"],
    status: "active",
    colorways: ["#5a5a5a", "#1c1c1c", "#d8d2c4"],
    material: "Organic loopback, 380gsm",
    updated: 200,
  },
  {
    id: "p11",
    name: "Poplin Camp Shirt",
    sku: "SH-5042",
    category: "Shirting",
    price: 32.5,
    moq: 450,
    leadTime: 45,
    supplierId: "s-baltic",
    tags: ["seasonal", "quick-ship"],
    status: "paused",
    colorways: ["#f4f1ea", "#93b0c4", "#c9a227"],
    material: "Cotton poplin, 130gsm",
    updated: 4300,
  },
  {
    id: "p12",
    name: "Webbing Belt",
    sku: "AC-6055",
    category: "Accessories",
    price: 12.0,
    moq: 800,
    leadTime: 30,
    supplierId: "s-harbor",
    tags: ["recycled", "quick-ship", "core"],
    status: "active",
    colorways: ["#1c1c1c", "#5b6b52", "#7a1f2b"],
    material: "Recycled polyester webbing",
    updated: 320,
  },
  {
    id: "p13",
    name: "Wool Topcoat",
    sku: "OW-1120",
    category: "Outerwear",
    price: 215.0,
    moq: 150,
    leadTime: 110,
    supplierId: "s-kumo",
    tags: ["premium", "capsule"],
    status: "sampling",
    colorways: ["#2f3540", "#6d5b4a"],
    material: "Melton wool, 720gsm",
    updated: 60,
  },
  {
    id: "p14",
    name: "Fine-Gauge Polo",
    sku: "KN-2298",
    category: "Knitwear",
    price: 54.0,
    moq: 300,
    leadTime: 55,
    supplierId: "s-aurora",
    tags: ["core", "low-impact"],
    status: "active",
    colorways: ["#e8dcc8", "#3d4a5c", "#7a1f2b"],
    material: "Cotton-silk, 14gg",
    updated: 900,
  },
  {
    id: "p15",
    name: "Canvas Tote",
    sku: "AC-6080",
    category: "Accessories",
    price: 16.5,
    moq: 700,
    leadTime: 35,
    supplierId: "s-harbor",
    tags: ["organic", "restock"],
    status: "active",
    colorways: ["#d8d2c4", "#1c1c1c"],
    material: "Organic canvas, 16oz",
    updated: 2600,
  },
  {
    id: "p16",
    name: "Washed Denim Jacket",
    sku: "DN-3390",
    category: "Denim",
    price: 92.0,
    moq: 250,
    leadTime: 95,
    supplierId: "s-cedar",
    tags: ["seasonal", "premium"],
    status: "paused",
    colorways: ["#5c7391", "#26364d"],
    material: "12oz washed denim",
    updated: 5200,
  },
]

export const money = (value: number) =>
  value.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  })

export const compactMoney = (value: number) =>
  value.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  })

export function updatedLabel(minutes: number) {
  if (minutes < 60) return `${Math.max(1, minutes)}m`
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)}h`
  const days = Math.round(minutes / (60 * 24))
  if (days < 30) return `${days}d`
  return `${Math.round(days / 30)}mo`
}
