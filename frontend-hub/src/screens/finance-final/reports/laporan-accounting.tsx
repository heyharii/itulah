import { useSuspenseQueries, useSuspenseQuery } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { Download, Printer } from "lucide-react"
import { Suspense, useDeferredValue, useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { FilterChips } from "@/components/ui/filter-chips"
import { Select } from "@/components/ui/field"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { BarSpacer, ExpandingSearch } from "@/components/ui/list-chrome"
import { PageHeader } from "@/components/ui/page-header"
import { Segmented, Toolbar } from "@/components/ui/segmented"
import { Sheet } from "@/components/ui/sheet"
import { SheetFooter } from "@/components/ui/sheet-footer"
import { SubTabs } from "@/components/ui/sub-tabs"
import {
  exportXlsx,
  monthStamp,
  type ExportCell,
  type ExportKind,
} from "@/lib/export-xlsx"
import { count, day, money, percentOf } from "@/lib/format"
import {
  accountLinksQuery,
  balanceStatementQuery,
  cashFlowStatementQuery,
  resultStatementQuery,
} from "@/lib/queries/finance"
import { unitLabel } from "@/lib/queries/organisation"
import { toast } from "@/lib/toast"
import { lastMonths, monthLabel, todayIso } from "@/screens/finance/chart"
import { ScreenPending } from "@/screens/finance/pending"
import {
  ModelTable,
  type ModelCol,
  type ModelRow,
} from "@/screens/finance/report"
import type { Statement } from "@itulah/contract"

/// Reports: the statements read from the books, and an index of 7Soft's
/// numbered reports so the team can type "laporan 7" and land.
///
/// Built from `scr-rep.js` of the final Finance prototype. **Statements** is
/// the report chips (Profit and loss, Balance sheet, Cash flow, Gross margin by
/// article), a period select and, on the profit and loss, a Combined | By shop
/// switch. **7Soft numbers** is the searchable index of the numbered reports,
/// each landing on the hub screen that answers it.
///
/// Every figure is read from `GET /finance/statement` (profit and loss, balance
/// sheet, cash flow), the same as the standalone report screens, so a total
/// here is never a second opinion. Ledger signs are flipped once, here: income
/// reads positive and a cost negative, so each subtotal is a plain sum.

// ── the 7Soft index ────────────────────────────────────────────────────────

type Rep = "pl" | "bs" | "cf" | "gm"
type View = "all" | "shop"

const REPS: readonly { value: Rep; label: string }[] = [
  { value: "pl", label: "Profit and loss" },
  { value: "bs", label: "Balance sheet" },
  { value: "cf", label: "Cash flow" },
  { value: "gm", label: "Gross margin by article" },
]

type Dest =
  | { readonly label: string; readonly to: string }
  | { readonly label: string; readonly rep: Rep; readonly view?: View }
  | { readonly label: string; readonly outside: string }

const D7: Readonly<Record<string, Dest>> = {
  acc: { label: "Cash & Bank", to: "/finance/reports/cash-bank" },
  kartu: { label: "Cash & Bank · Kartu", to: "/finance/cash-bank/kartu" },
  bkk: { label: "BKK", to: "/finance/cash-bank/bkk" },
  bkm: { label: "BKM", to: "/finance/cash-bank/bkm" },
  giro: { label: "Giro", to: "/finance/cash-bank/giro" },
  bills: { label: "Bills", to: "/finance/payables/bills" },
  sup: { label: "Suppliers", to: "/finance/payables/supplier-ledger" },
  days: { label: "Daily close · Days", to: "/finance/stores/sales" },
  rec: {
    label: "Daily close · Receipts",
    to: "/finance/receivables/sales-postings",
  },
  ret: {
    label: "Returns — goods swapped, no refund",
    to: "/finance/sales/returns",
  },
  ju: { label: "Journal", to: "/finance/accounting/all-journals" },
  sub: {
    label: "Ledger · Buku Besar Pembantu",
    to: "/finance/accounting/info-accounting",
  },
  ns: {
    label: "Ledger · Neraca Saldo",
    to: "/finance/accounting/trial-balance",
  },
  pl: { label: "Reports · Profit and loss", rep: "pl", view: "all" },
  shop: { label: "Reports · Profit and loss by shop", rep: "pl", view: "shop" },
  bs: { label: "Reports · Balance sheet", rep: "bs" },
  cf: { label: "Reports · Cash flow", rep: "cf" },
  gm: { label: "Reports · Gross margin by article", rep: "gm" },
  reg: { label: "Assets · Register", to: "/finance/reports/asset-register" },
  depr: {
    label: "Assets · Depreciation",
    to: "/finance/reports/asset-register",
  },
  prj: {
    label: "Assets · Projects",
    to: "/finance/assets/contractor-projects",
  },
  tax: { label: "Month end · PPN and PPh 23", to: "/finance/tax/payables" },
  stock: {
    label: "Month end · Stock vs ledger",
    to: "/finance/inventory/stock-vs-ledger",
  },
  coa: {
    label: "Setup · Account",
    to: "/finance/accounting/chart-of-accounts",
  },
  po: {
    label: "Purchasing · PO, outside Finance",
    outside: "Purchasing opens outside Finance",
  },
  price: {
    label: "Catalogue · Prices, outside Finance",
    outside: "Catalogue opens outside Finance",
  },
}

const IXG: Readonly<Record<string, string>> = {
  kas: "Kas/Bank",
  buy: "Pembelian",
  sell: "Penjualan",
  acc: "Accounting",
  keu: "Keuangan",
  man: "Manajerial",
}

interface IxRow {
  readonly g: string
  readonly no: string
  readonly lo: number
  readonly hi: number
  readonly name: string
  readonly d: Dest | null
  readonly hay: string
}

type IxItem = readonly [number | string, string, string?]

const IX: IxRow[] = []
const ix = (g: string, list: readonly IxItem[]) =>
  list.forEach(([no, name, d]) => {
    const [lo, hi] = String(no).split("–").map(Number)
    const dest = d ? (D7[d] ?? null) : null
    IX.push({
      g,
      no: String(no),
      lo,
      hi: hi || lo,
      name,
      d: dest,
      hay: `laporan ${IXG[g]} ${name} ${dest ? dest.label : "not used"}`.toLowerCase(),
    })
  })
const seq = (
  names: readonly string[],
  dests: readonly string[],
  from = 1
): IxItem[] => names.map((n, i) => [from + i, n, dests[i]] as IxItem)

ix(
  "kas",
  seq(
    [
      "Laporan Harian Kas & Bank",
      "Laporan Harian Kas-Bank Detail",
      "Laporan Harian Kas-Bank Detail Per Transaksi",
      "Laporan Kas-Bank Detail Per Transaksi Periodik",
      "Laporan Kas-Bank Per Periode",
      "Laporan Kas-Bank Per Periode Detail",
      "Summary Pelunasan Piutang",
      "Detail Pelunasan Piutang",
      "Summary Pelunasan Hutang",
      "Detail Pelunasan Hutang",
      "Summary Bukti Kas Masuk (BKM)",
      "Detail Bukti Kas Masuk (BKM)",
      "Summary Bukti Kas Keluar (BKK)",
      "Detail Bukti Kas Keluar (BKK)",
      "Laporan Giro Masuk",
      "Laporan Giro Keluar",
      "Laporan Giro Masuk Belum Cair",
      "Laporan Giro Keluar Belum Cair",
      "Laporan Perincian Tolakan Giro Masuk",
      "Laporan Perincian Tolakan Giro Keluar",
    ],
    [
      "acc",
      "kartu",
      "kartu",
      "kartu",
      "acc",
      "kartu",
      "",
      "",
      "bkk",
      "bkk",
      "bkm",
      "bkm",
      "bkk",
      "bkk",
      "",
      "giro",
      "",
      "giro",
      "",
      "giro",
    ]
  )
)
ix("buy", [
  ...seq(
    [
      "Laporan Harian Detail Pembelian Item",
      "Laporan Pembelian Bulanan",
      "Summary Pembelian",
      "Rekap Detail Faktur Pembelian",
      "Laporan Barang Datang (Nilai)",
      "Laporan Harian Pembelian Item Detail Supplier",
      "Laporan Harian Pembelian Per Supplier Detail Item",
      "Laporan Bulanan Pembelian Item Detail Supplier",
      "Laporan Bulanan Pembelian Per Supplier Detail Item",
      "Laporan Daftar Harga",
      "Laporan History Harga Pembelian",
      "Summary Pembelian PPN",
    ],
    [
      "bills",
      "bills",
      "bills",
      "bills",
      "bills",
      "sup",
      "sup",
      "sup",
      "sup",
      "price",
      "bills",
      "tax",
    ]
  ),
  ["13–16", "Uang Muka Pembelian · 4 laporan", "prj"],
  ["17–21", "PO · 5 laporan", "po"],
  ["22–23", "Retur Pembelian · 2 laporan", "bills"],
  ["24–33", "Hutang dagang · 10 laporan", "sup"],
])
ix("sell", [
  ...seq(
    [
      "Laporan Harian Detail Penjualan Item",
      "Summary Penjualan",
      "Cetak Invoice Penjualan",
      "Laporan Nota Penjualan",
      "Rekap Detail Faktur Penjualan",
      "Laporan Nilai Surat Jalan",
      "Laporan Penjualan tiap User",
      "Laporan Penjualan Bulanan",
      "Summary Penjualan PPN",
      "Penjualan Barang dan Jasa",
    ],
    ["rec", "days", "rec", "rec", "rec", "", "rec", "shop", "tax", "pl"]
  ),
  ["11–14", "Penjualan per customer · 4 laporan", ""],
  ["15–20", "SO dan Surat Jalan · 6 laporan", ""],
  ["21–27", "Komisi dan omzet sales · 7 laporan", ""],
  [28, "Laporan Omset Penjualan Per Kota", "shop"],
  ["29–32", "Uang Muka Penjualan · 4 laporan", ""],
  [33, "Laporan Summary Retur Penjualan", "ret"],
  [34, "Laporan Detail Retur Penjualan", "ret"],
  ["35–42", "Piutang dagang · 8 laporan", ""],
  [43, "Laporan Detail Pelunasan Nota Penjualan", ""],
  [44, "List Customer", ""],
])
ix(
  "acc",
  seq(
    [
      "Perhitungan HPP",
      "Laporan Jurnal",
      "Laporan Jurnal Pembelian",
      "Laporan Jurnal Penjualan",
      "Laporan Jurnal Persediaan",
      "Laporan Jurnal Pengeluaran Kas (BKK)",
      "Laporan Jurnal Penerimaan Kas (BKM)",
      "Buku Besar Pembantu",
      "Laporan Persediaan Akhir Bulan",
      "Laporan Master Account",
      "Laporan Aktiva Tetap dan Penyusutan",
      "Laporan Aktiva Tetap dan Penyusutan Tahunan",
    ],
    [
      "gm",
      "ju",
      "ju",
      "ju",
      "ju",
      "ju",
      "ju",
      "sub",
      "stock",
      "coa",
      "reg",
      "depr",
    ]
  )
)
ix(
  "keu",
  seq(
    [
      "Laba/Rugi Penjualan Per Item",
      "Laba Rugi Item / Barang",
      "Laba Rugi Customer",
      "Laba Rugi Nota",
      "Laporan Laba Rugi Per sales",
      "Laba Rugi GL",
      "Laba Rugi (Barang)",
      "Laba Rugi Tahunan",
      "Neraca Saldo",
      "Laporan Neraca Ke Kanan",
      "Laporan Neraca Standard",
      "Laporan Neraca Perbandingan 2 Bulan",
      "Laporan Neraca (Common Sized)",
      "Laporan Neraca Tahunan",
      "Laporan Arus Kas",
    ],
    [
      "gm",
      "gm",
      "",
      "rec",
      "",
      "pl",
      "gm",
      "pl",
      "ns",
      "bs",
      "bs",
      "bs",
      "bs",
      "bs",
      "cf",
    ]
  )
)
ix(
  "man",
  seq(
    [
      "Laporan Fast Moving Item",
      "Laporan Fast Moving Kelompok Item",
      "Laporan Slow Moving Item",
      "Laporan 10 Top Customer",
    ],
    ["gm", "gm", "gm", ""]
  )
)

// ── the statements ─────────────────────────────────────────────────────────

type Group = "sales" | "disc" | "hpp" | "jual" | "adm" | "oth"

const GRP: readonly (readonly [Group, string])[] = [
  ["sales", "Penjualan"],
  ["disc", "Diskon"],
  ["hpp", "HPP"],
  ["jual", "Beban Penjualan"],
  ["adm", "Beban Adm & Umum"],
  ["oth", "Pendapatan/Biaya lain"],
]

const grpOf = (code: string): Group =>
  /^40101/.test(code)
    ? "sales"
    : /^40102/.test(code)
      ? "disc"
      : code[0] === "5"
        ? "hpp"
        : /^60101/.test(code)
          ? "jual"
          : /^[67]/.test(code)
            ? "adm"
            : "oth"

interface PlLine {
  readonly c: string
  readonly name: string
  readonly g: Group
  /// Income positive, a cost negative: the effect on the result.
  readonly amt: number
}

interface PlResult {
  readonly ns: number
  readonly hpp: number
  readonly gp: number
  readonly op: number
  readonly np: number
  readonly beban: number
}

const sum = <T,>(xs: readonly T[], f: (x: T) => number) =>
  xs.reduce((s, x) => s + f(x), 0)

/// The statement's accounts as the prototype groups them. A heading is not an
/// account: only the lines that carry postings are taken.
function plLines(stmt: Statement | undefined): PlLine[] {
  if (stmt === undefined) return []
  const out: PlLine[] = []
  for (const section of stmt.sections) {
    if (section.root_class < "4") continue
    for (const line of section.lines) {
      if (line.is_group || line.amount_minor === 0) continue
      out.push({
        c: line.account_code,
        name: line.name,
        g: grpOf(line.account_code),
        amt: line.amount_minor === 0 ? 0 : -line.amount_minor,
      })
    }
  }
  return out.sort((a, b) => a.c.localeCompare(b.c))
}

function plResult(lines: readonly PlLine[], stmt?: Statement): PlResult {
  const at = (g: Group) =>
    sum(
      lines.filter((l) => l.g === g),
      (l) => l.amt
    )
  const ns = at("sales") + at("disc")
  const hpp = at("hpp")
  const gp = ns + hpp
  const op = gp + at("jual") + at("adm")
  const np = stmt !== undefined ? -stmt.result_minor || 0 : op + at("oth")
  return { ns, hpp, gp, op, np, beban: at("jual") + at("adm") + at("oth") }
}

const pct = (x: number, base: number) => (base ? percentOf(x, base) : "")

/// The exported columns follow the on-screen ones.
interface Built {
  readonly cols: readonly ModelCol[]
  readonly rows: readonly ModelRow[]
  readonly foot?: { readonly cells: readonly React.ReactNode[] }
  /// One per cell in the same order; null for a group band.
  readonly raw: readonly (readonly ExportCell[] | null)[]
  readonly rawFoot?: readonly ExportCell[]
  readonly kinds: readonly ExportKind[]
}

function plTable(
  lines: readonly PlLine[],
  r: PlResult,
  open: () => void
): Built {
  const rows: ModelRow[] = []
  const raw: (ExportCell[] | null)[] = []
  const band = (label: string) => {
    rows.push({ group: label })
    raw.push([label, null, null, null])
  }
  const sub = (label: string, x: number) => {
    rows.push({
      strong: true,
      cells: [label, "", money(x), pct(x, r.ns)],
    })
    raw.push([label, null, x, pct(x, r.ns)])
  }
  for (const [g, label] of GRP) {
    const ls = lines.filter((l) => l.g === g)
    if (ls.length === 0) continue
    band(label)
    for (const l of ls) {
      rows.push({
        on: open,
        cells: [
          l.name,
          <span key="k" className="text-mute">
            {l.c}
          </span>,
          money(l.amt),
          <span key="p" className="text-mute">
            {pct(l.amt, r.ns)}
          </span>,
        ],
      })
      raw.push([l.name, l.c, l.amt, pct(l.amt, r.ns)])
    }
    if (g === "disc") sub("Penjualan bersih", r.ns)
    if (g === "hpp") sub("Laba kotor", r.gp)
    if (g === "adm") sub("Laba usaha", r.op)
  }
  return {
    cols: [
      { l: "Account" },
      { l: "Kode", w: "150px" },
      { l: "Amount", num: true, w: "180px" },
      { l: "Of sales", num: true, w: "110px" },
    ],
    rows,
    foot: { cells: ["Laba bersih", "", money(r.np), pct(r.np, r.ns)] },
    raw,
    rawFoot: ["Laba bersih", null, r.np, pct(r.np, r.ns)],
    kinds: ["text", "text", "money", "text"],
  }
}

/// A balance-sheet side: the chart's second level as a band, its third level as
/// the lines under it.
function sideRows(
  stmt: Statement,
  classes: readonly string[],
  open: () => void
): { rows: ModelRow[]; raw: (ExportCell[] | null)[]; total: number } {
  const rows: ModelRow[] = []
  const raw: (ExportCell[] | null)[] = []
  let total = 0
  for (const section of stmt.sections) {
    if (!classes.includes(section.root_class)) continue
    const flip = section.root_class === "1" ? 1 : -1
    total += flip * section.total_minor
    for (const line of section.lines) {
      if (line.depth === 2) {
        rows.push({ group: line.name })
        raw.push([line.name, null])
      } else if (line.depth === 3) {
        const amount = flip * line.amount_minor || 0
        rows.push({
          on: open,
          cells: [
            <span key="n">
              {line.name} <span className="text-mute">{line.account_code}</span>
            </span>,
            money(amount),
          ],
        })
        raw.push([`${line.name} ${line.account_code}`, amount])
      }
    }
  }
  return { rows, raw, total }
}

function bsTables(stmt: Statement, open: () => void): Built[] {
  const a = sideRows(stmt, ["1"], open)
  const p = sideRows(stmt, ["2", "3"], open)
  // The result not yet closed into equity is what balances the sheet.
  const earned = -stmt.result_minor || 0
  const pRows: ModelRow[] = [
    ...p.rows,
    {
      on: open,
      cells: [
        <span key="n">
          Laba (rugi) bulan berjalan{" "}
          <span className="text-mute">3013001003</span>
        </span>,
        money(earned),
      ],
    },
  ]
  const pRaw = [...p.raw, ["Laba (rugi) bulan berjalan 3013001003", earned]]
  const pTotal = p.total + earned
  return [
    {
      cols: [{ l: "Aktiva" }, { l: "Amount", num: true, w: "180px" }],
      rows: a.rows,
      foot: { cells: ["Total aktiva", money(a.total)] },
      raw: a.raw,
      rawFoot: ["Total aktiva", a.total],
      kinds: ["text", "money"],
    },
    {
      cols: [
        { l: "Kewajiban & ekuitas" },
        { l: "Amount", num: true, w: "180px" },
      ],
      rows: pRows,
      foot: { cells: ["Total kewajiban & ekuitas", money(pTotal)] },
      raw: pRaw,
      rawFoot: ["Total kewajiban & ekuitas", pTotal],
      kinds: ["text", "money"],
    },
  ]
}

function cfTable(stmt: Statement, from: string, to: string): Built {
  const rows: ModelRow[] = []
  const raw: (ExportCell[] | null)[] = []
  const line = (name: string, amount: number, strong = false) => {
    rows.push({
      strong,
      cells: [name, amount ? money(amount) : "—"],
    })
    raw.push([name, amount])
  }
  let net = 0
  for (const section of stmt.sections.filter((s) => s.lines.length > 0)) {
    rows.push({ group: section.title })
    raw.push([section.title, null])
    for (const l of section.lines) {
      if (l.is_group) continue
      line(l.name, l.amount_minor)
    }
    line(
      `Net cash from ${section.title.toLowerCase()}`,
      section.total_minor,
      true
    )
    net += section.total_minor
  }
  rows.push({ group: "Kas & bank" })
  raw.push(["Kas & bank", null])
  line("Kenaikan kas & bank", net)
  line(`Kas & bank ${day(from)}`, stmt.opening_cash_minor ?? 0)
  const closing =
    stmt.closing_cash_minor ?? (stmt.opening_cash_minor ?? 0) + net
  return {
    cols: [{ l: "Line" }, { l: "Amount", num: true, w: "180px" }],
    rows,
    foot: { cells: [`Kas & bank ${day(to)}`, money(closing)] },
    raw,
    rawFoot: [`Kas & bank ${day(to)}`, closing],
    kinds: ["text", "money"],
  }
}

function gmTable(r: PlResult): Built {
  return {
    cols: [
      { l: "Article" },
      { l: "Pieces", num: true, w: "100px" },
      { l: "Penjualan bersih", num: true, w: "170px" },
      { l: "HPP", num: true, w: "170px" },
      { l: "Laba kotor", num: true, w: "170px" },
      { l: "Margin", num: true, w: "100px" },
    ],
    rows: [],
    foot: {
      cells: [
        "—",
        "—",
        money(r.ns),
        money(r.hpp),
        money(r.gp),
        pct(r.gp, r.ns) || "—",
      ],
    },
    raw: [],
    rawFoot: ["—", null, r.ns, r.hpp, r.gp, pct(r.gp, r.ns)],
    kinds: ["text", "number", "money", "money", "money", "text"],
  }
}

function sheetOf(
  built: readonly Built[],
  title: string,
  subtitle: string,
  filename: string
) {
  const first = built[0]
  return {
    filename,
    sheet: title.slice(0, 31),
    title,
    subtitle,
    columns: first.cols.map((col, i) => ({
      header: col.l,
      kind: first.kinds[i],
    })),
    rows: built.flatMap((b) =>
      b.raw.map((r) => r ?? []).concat(b.rawFoot ? [b.rawFoot] : [])
    ),
    rowStyles: built.flatMap((b) =>
      b.rows
        .map((row) => ({
          bold: "group" in row || row.strong === true || undefined,
        }))
        .concat(b.rawFoot ? [{ bold: true }] : [])
    ),
  }
}

// ── the screen ─────────────────────────────────────────────────────────────

type Tab = "stmt" | "index"

function ReportsScreen({
  startTab = "stmt",
  startGroup = "all",
}: {
  startTab?: Tab
  startGroup?: string
}) {
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>(startTab)
  const [rep, setRep] = useState<Rep>("pl")
  const [view, setView] = useState<View>("all")
  const [grp, setGrp] = useState<string>(startGroup)
  const [q, setQ] = useState("")

  const go = (dest: Dest) => {
    if ("to" in dest) void navigate({ to: dest.to } as never)
    else if ("rep" in dest) {
      setRep(dest.rep)
      setView(dest.view ?? "all")
      setTab("stmt")
    } else toast(dest.outside)
  }

  return (
    <PageContent>
      {tab === "stmt" ? (
        <Statements
          tab={tab}
          setTab={setTab}
          rep={rep}
          setRep={setRep}
          view={view}
          setView={setView}
          go={go}
        />
      ) : (
        <>
          <PageHeader title="Reports" />
          <ReportTabs tab={tab} setTab={setTab} />
          <Index grp={grp} setGrp={setGrp} q={q} setQ={setQ} go={go} />
        </>
      )}
    </PageContent>
  )
}

function ReportTabs({ tab, setTab }: { tab: Tab; setTab: (tab: Tab) => void }) {
  return (
    <SubTabs
      tabs={[
        { value: "stmt", label: "Statements" },
        { value: "index", label: `7Soft numbers ${IX.length}`, short: "7Soft" },
      ]}
      value={tab}
      onChange={(next) => setTab(next as Tab)}
    />
  )
}

function Statements({
  tab,
  setTab,
  rep,
  setRep,
  view,
  setView,
  go,
}: {
  tab: Tab
  setTab: (tab: Tab) => void
  rep: Rep
  setRep: (rep: Rep) => void
  view: View
  setView: (view: View) => void
  go: (dest: Dest) => void
}) {
  const navigate = useNavigate()
  const months = useMemo(() => lastMonths(2, todayIso()).reverse(), [])
  const [per, setPer] = useState(months[0].key)
  const asked = useDeferredValue(per)
  const stale = asked !== per
  const period = months.find((m) => m.key === asked) ?? months[0]
  const label = monthLabel(period.year, period.month)
  const closed = period.key !== months[0].key

  const wantShop = rep === "pl" && view === "shop"
  const locations = useSuspenseQuery(accountLinksQuery()).data.locations
  const wantFlow = rep === "cf"
  const results = useSuspenseQueries({
    queries: [
      resultStatementQuery(period.from, period.to, null),
      balanceStatementQuery(period.to, null),
      ...(wantFlow
        ? [cashFlowStatementQuery(period.from, period.to, null)]
        : []),
      ...(wantShop
        ? locations.map((l) =>
            resultStatementQuery(period.from, period.to, l.unit_id)
          )
        : []),
    ],
  })
  const plQ = results[0]
  const bsQ = results[1]
  const cfQ = wantFlow ? results[2] : undefined
  const shopQs = results.slice(wantFlow ? 3 : 2)
  const [shopOpen, setShopOpen] = useState<string | null>(null)

  const lines = useMemo(() => plLines(plQ.data), [plQ.data])
  const res = useMemo(() => plResult(lines, plQ.data), [lines, plQ.data])
  const cash = bsQ.data.sections
    .find((s) => s.root_class === "1")
    ?.lines.find((l) => l.account_code === "10110")?.amount_minor
  const ledger = () =>
    void navigate({ to: "/finance/accounting/info-accounting" } as never)

  const shops = useMemo(
    () =>
      wantShop
        ? locations
            .map((l, i) => {
              const ls = plLines(shopQs[i]?.data)
              return { loc: l, lines: ls, r: plResult(ls, shopQs[i]?.data) }
            })
            .filter((s) => s.lines.length > 0)
        : [],
    [wantShop, locations, shopQs]
  )

  const built: Built[] = useMemo(() => {
    if (rep === "pl" && view === "shop") {
      const rows: ModelRow[] = shops.map((s) => ({
        on: () => setShopOpen(s.loc.unit_id),
        cells: [
          unitLabel(s.loc),
          s.r.ns ? money(s.r.ns) : "—",
          s.r.hpp ? money(s.r.hpp) : "—",
          s.r.gp ? money(s.r.gp) : "—",
          money(s.r.beban),
          money(s.r.np),
        ],
      }))
      return [
        {
          cols: [
            { l: "Shop" },
            { l: "Penjualan bersih", num: true, w: "170px" },
            { l: "HPP", num: true, w: "170px" },
            { l: "Laba kotor", num: true, w: "170px" },
            { l: "Beban", num: true, w: "170px" },
            { l: "Laba bersih", num: true, w: "170px" },
          ],
          rows,
          foot: {
            cells: [
              `${shops.length} ${shops.length === 1 ? "place" : "places"}`,
              money(res.ns),
              money(res.hpp),
              money(res.gp),
              money(res.beban),
              money(res.np),
            ],
          },
          raw: shops.map((s) => [
            unitLabel(s.loc),
            s.r.ns,
            s.r.hpp,
            s.r.gp,
            s.r.beban,
            s.r.np,
          ]),
          rawFoot: ["Total", res.ns, res.hpp, res.gp, res.beban, res.np],
          kinds: ["text", "money", "money", "money", "money", "money"],
        },
      ]
    }
    if (rep === "pl") return [plTable(lines, res, ledger)]
    if (rep === "bs") return bsTables(bsQ.data, ledger)
    if (rep === "cf" && cfQ !== undefined)
      return [cfTable(cfQ.data, period.from, period.to)]
    return [gmTable(res)]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rep, view, shops, lines, res, bsQ.data, cfQ.data, period])

  const repLabel = REPS.find((r) => r.value === rep)?.label ?? ""
  const exportIt = () => {
    exportXlsx(
      sheetOf(
        built,
        repLabel,
        `${label} · ${rep === "bs" ? `at ${day(period.to)}` : `${day(period.from)} – ${day(period.to)}`}`,
        `${repLabel}-${monthStamp(period.to)}`
      )
    ).catch(() => toast.error("The Excel file could not be written."))
  }

  const open =
    shopOpen === null
      ? undefined
      : shops.find((s) => s.loc.unit_id === shopOpen)

  return (
    <>
      <PageHeader
        title="Reports"
        actions={
          <Button variant="primary" onClick={exportIt}>
            <Download />
            Export XLS
          </Button>
        }
      />
      <ReportTabs tab={tab} setTab={setTab} />
      <KpiStrip className="md:grid-cols-4 xl:grid-cols-4">
        <Kpi label="Penjualan bersih" value={money(res.ns)} />
        <Kpi label="Laba kotor" value={money(res.gp)} />
        <Kpi
          label="Laba bersih"
          value={
            <span className={res.np < 0 ? "text-bad-fg" : undefined}>
              {money(res.np)}
            </span>
          }
        />
        <Kpi
          label={`Kas & Bank · ${day(period.to)}`}
          value={money(cash ?? null)}
        />
      </KpiStrip>
      <Toolbar className="group/bar">
        <FilterChips
          label="Report"
          value={rep}
          options={REPS.map((r) => ({ value: r.value, label: r.label }))}
          onChange={(next) => next !== null && setRep(next as Rep)}
        />
        <Select
          value={per}
          onChange={setPer}
          aria-label="Period"
          className="w-48"
        >
          {months.map((m) => (
            <option key={m.key} value={m.key}>
              {monthLabel(m.year, m.month)}
            </option>
          ))}
        </Select>
        {rep === "pl" && (
          <Segmented<View>
            value={view}
            onChange={setView}
            options={[
              { value: "all", label: "Combined" },
              { value: "shop", label: "By shop" },
            ]}
          />
        )}
        <BarSpacer />
        <span className="text-[0.9375rem] text-body">
          {closed
            ? `${day(period.from)} – ${day(period.to)} · closed`
            : `${day(period.from)} – ${day(period.to)}`}
        </span>
        <Button variant="ghost" onClick={() => window.print()}>
          <Printer />
          Print
        </Button>
      </Toolbar>
      <div className="list-swap" aria-busy={stale || undefined}>
        {rep === "bs" ? (
          <div className="grid items-start gap-4 lg:grid-cols-2">
            {built.map((b, i) => (
              <ModelTable key={i} cols={b.cols} rows={b.rows} foot={b.foot} />
            ))}
          </div>
        ) : (
          <ModelTable
            cols={built[0].cols}
            rows={built[0].rows}
            foot={built[0].foot}
            empty={
              rep === "gm"
                ? "No article-level sales in the books yet"
                : "Nothing posted in this period"
            }
          />
        )}
      </div>

      <Sheet
        open={open !== undefined}
        onOpenChange={(next) => {
          if (!next) setShopOpen(null)
        }}
        size="wide"
        context={`Reports / Profit and loss · ${label}`}
        title={open ? unitLabel(open.loc) : "Shop"}
        footer={
          <SheetFooter
            onPrint={() => window.print()}
            primary={{ label: "Open Buku Besar Pembantu", onClick: ledger }}
          />
        }
      >
        {open && (
          <div className="flex flex-col gap-5">
            <KpiStrip className="md:grid-cols-4 xl:grid-cols-4">
              <Kpi
                label="Penjualan bersih"
                value={open.r.ns ? money(open.r.ns) : "—"}
              />
              <Kpi
                label="Laba kotor"
                value={open.r.ns ? money(open.r.gp) : "—"}
              />
              <Kpi
                label="Laba bersih"
                value={
                  <span className={open.r.np < 0 ? "text-bad-fg" : undefined}>
                    {money(open.r.np)}
                  </span>
                }
              />
              <Kpi
                label="Of sales"
                value={open.r.ns ? pct(open.r.np, open.r.ns) : "—"}
              />
            </KpiStrip>
            {(() => {
              const t = plTable(open.lines, open.r, ledger)
              return <ModelTable cols={t.cols} rows={t.rows} foot={t.foot} />
            })()}
          </div>
        )}
      </Sheet>
    </>
  )
}

function Index({
  grp,
  setGrp,
  q,
  setQ,
  go,
}: {
  grp: string
  setGrp: (grp: string) => void
  q: string
  setQ: (q: string) => void
  go: (dest: Dest) => void
}) {
  const toks = q.toLowerCase().split(/\s+/).filter(Boolean)
  const match = (r: IxRow) =>
    toks.every((t) =>
      /^\d+$/.test(t) ? r.lo <= +t && +t <= r.hi : r.hay.includes(t)
    )
  const rows = IX.filter((r) => (grp === "all" || r.g === grp) && match(r))
  const n = (g: string) => IX.filter((r) => r.g === g).length

  const modelRows: ModelRow[] = rows.map((r) => ({
    on: r.d ? () => go(r.d as Dest) : undefined,
    dim: r.d === null,
    cells: [
      IXG[r.g],
      <span key="n" className="font-mono">
        {r.no}
      </span>,
      <span key="l" className="font-medium text-ink">
        {r.name}
      </span>,
      r.d ? (
        r.d.label
      ) : (
        <span key="o" className="text-mute">
          Not used — no credit sales
        </span>
      ),
      r.d ? (
        <Button
          key="a"
          variant="primary"
          size="sm"
          onClick={(event) => {
            event.stopPropagation()
            go(r.d as Dest)
          }}
        >
          Open
        </Button>
      ) : (
        ""
      ),
    ],
  }))

  return (
    <>
      <Toolbar className="group/bar">
        <FilterChips
          label="Group"
          value={grp === "all" ? null : grp}
          options={[
            { value: null, label: "All", count: IX.length },
            ...Object.entries(IXG).map(([k, l]) => ({
              value: k,
              label: l,
              count: n(k),
            })),
          ]}
          onChange={(next) => setGrp(next ?? "all")}
        />
        <ExpandingSearch
          value={q}
          onChange={setQ}
          label="Search 7Soft reports"
          placeholder="Type a 7Soft name or number, e.g. laporan 7"
        />
        <BarSpacer />
        <span className="text-[0.9375rem] text-body">
          {count(rows.length)} {rows.length === 1 ? "report" : "reports"}
        </span>
      </Toolbar>
      <ModelTable
        cols={[
          { l: "Group", w: "140px" },
          { l: "No", w: "80px" },
          { l: "7Soft name" },
          { l: "Opens in", w: "330px" },
          { l: "", w: "100px" },
        ]}
        rows={modelRows}
        empty="No 7Soft report by that name or number"
      />
    </>
  )
}

function Pending() {
  return (
    <ScreenPending crumb="Finance · Reports" title="Reports">
      Reading the books…
    </ScreenPending>
  )
}

export function LaporanAccounting() {
  return (
    <Suspense fallback={<Pending />}>
      <ReportsScreen />
    </Suspense>
  )
}

/// 7Soft's Laporan Keuangan: the index, opened on its group.
export function LaporanKeuangan() {
  return (
    <Suspense fallback={<Pending />}>
      <ReportsScreen startTab="index" startGroup="keu" />
    </Suspense>
  )
}

/// 7Soft's Laporan Manajerial: the index, opened on its group.
export function LaporanManajerial() {
  return (
    <Suspense fallback={<Pending />}>
      <ReportsScreen startTab="index" startGroup="man" />
    </Suspense>
  )
}
