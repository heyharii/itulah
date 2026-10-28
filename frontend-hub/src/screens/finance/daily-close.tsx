import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { AlertTriangle } from "lucide-react"
import { Suspense, useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { FilterChips } from "@/components/ui/filter-chips"
import { Field, Input, Select } from "@/components/ui/field"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { BarSpacer, ExpandingSearch } from "@/components/ui/list-chrome"
import { PageHeader } from "@/components/ui/page-header"
import { Pill, Status } from "@/components/ui/pill"
import {
  MiniCell,
  MiniRow,
  MiniTable,
  Section,
  TotalsLadder,
} from "@/components/ui/rows"
import { CellMoney } from "@/components/ui/rows-switch"
import { Toolbar } from "@/components/ui/segmented"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { SheetFooter } from "@/components/ui/sheet-footer"
import { Banner, EmptyState, LoadingState } from "@/components/ui/states"
import { SubTabs } from "@/components/ui/sub-tabs"
import { count, day, dayTime, money, sku, time, weekday } from "@/lib/format"
import { toast } from "@/lib/toast"
import type { WindowTransaction } from "@/lib/queries/analytics"
import { cashCountsQuery, postCashCount } from "@/lib/queries/finance"
import { useNameOfLogin } from "@/lib/queries/hr-employees"
import { type UnitView, unitsQuery } from "@/lib/queries/organisation"
import {
  generateSalesPosting,
  postSalesPosting,
} from "@/lib/queries/sales-postings"
import { saleReceipt, shopSaleDetail } from "@/lib/queries/storeops"
import { saleDaysOnQuery } from "@/lib/queries/stores-close"
import { useQuery } from "@tanstack/react-query"
import { todayIso } from "@/screens/finance/chart"
import {
  customerCode,
  useReadOn,
  useReceipts,
  useReturns,
} from "@/screens/finance/sales-data"
import { openStoresOf, STORE_BOX_CODES } from "@/screens/finance/store-units"
import {
  addDays,
  DayPick,
  Dash,
  Diff,
  GridTable,
  plural,
  ShopCell,
  type Col,
} from "@/screens/finance/stores-grid"
import type { CashCountRow, SaleDayRow } from "@itulah/contract"

/// Finance › Stores › Daily close. Replaces 7Soft's Penjualan Cash · POS, Info
/// Penjualan and Retur Penjualan. The tills write every receipt; Finance
/// checks one close per shop per day: what the POS says per payment, what was
/// counted or what the bank will pay, the difference, then posts it.
///
/// Composed from the sale days (what each till took, per payment), the cash
/// counts (what was in the drawer), the sales window (receipts) and the
/// returns list. A return swaps the piece; no money goes back.

type Tab = "days" | "receipts" | "returns" | "voids"
type CloseState = "posted" | "ready" | "diff" | "open"

const STATE_WORD: Record<
  CloseState,
  [string, "ok" | "info" | "warn" | "bad" | "neutral"]
> = {
  posted: ["Posted", "neutral"],
  ready: ["Ready to post", "info"],
  diff: ["Difference", "warn"],
  open: ["Not closed", "bad"],
}

interface Close {
  readonly unit: UnitView
  readonly siteId: string
  readonly code: string
  readonly name: string
  readonly date: string
  readonly row: SaleDayRow | null
  readonly gross: number
  readonly cashExp: number
  readonly debit: number
  readonly credit: number
  readonly qris: number
  readonly other: number
  readonly card: number
  readonly receipts: number
  readonly refunds: number
  readonly count: CashCountRow | null
  readonly counted: number | null
  readonly diff: number
  readonly state: CloseState
}

function closeOf(
  unit: UnitView,
  date: string,
  row: SaleDayRow | undefined,
  counts: readonly CashCountRow[]
): Close {
  const siteId = unit.sites[0]?.id ?? ""
  const found = counts
    .filter(
      (one) =>
        one.account_code === STORE_BOX_CODES.cash &&
        one.counted_on === date &&
        (one.site_id === siteId || one.site_id === unit.id)
    )
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0]
  const cashExp = row ? row.cash_tendered_minor - row.change_minor : 0
  const counted = found ? found.counted_minor : null
  const diff = counted === null ? 0 : counted - cashExp
  const debit = row?.card_debit_minor ?? 0
  const credit = row?.card_credit_minor ?? 0
  const qris = row?.qris_minor ?? 0
  const other = row
    ? row.ewallet_minor + row.voucher_minor + row.other_minor
    : 0
  const state: CloseState =
    row?.entry_id != null
      ? "posted"
      : counted === null
        ? "open"
        : diff !== 0
          ? "diff"
          : "ready"
  return {
    unit,
    siteId,
    code: unit.code,
    name: unit.name,
    date,
    row: row ?? null,
    gross: row?.gross_minor ?? 0,
    cashExp,
    debit,
    credit,
    qris,
    other,
    card: debit + credit + qris,
    receipts: row?.sales_count ?? 0,
    refunds: row?.refunds_minor ?? 0,
    count: found ?? null,
    counted,
    diff,
    state,
  }
}

/// One close per open shop for the day.
function useCloses(date: string) {
  const units = useSuspenseQuery(unitsQuery())
  const days = useSuspenseQuery(saleDaysOnQuery(date, date))
  const counts = useSuspenseQuery(cashCountsQuery())
  return useMemo(() => {
    const stores = openStoresOf(units.data)
    return stores.map((unit) =>
      closeOf(
        unit,
        date,
        days.data.rows.find((r) => unit.sites.some((s) => s.id === r.site_id)),
        counts.data
      )
    )
  }, [units.data, days.data, counts.data, date])
}

export function DailyClose() {
  return (
    <PageContent>
      <Suspense
        fallback={
          <>
            <PageHeader crumb="Finance › Stores" title="Daily close" />
            <LoadingState>Reading the days…</LoadingState>
          </>
        }
      >
        <DailyCloseBody />
      </Suspense>
    </PageContent>
  )
}

function DailyCloseBody() {
  const last = useMemo(() => addDays(todayIso(), -1), [])
  const [date, setDate] = useState(last)
  const [tab, setTab] = useState<Tab>("days")
  const [state, setState] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [shop, setShop] = useState("")
  const [opened, setOpened] = useState<string | null>(null)
  const [receipt, setReceipt] = useState<WindowTransaction | null>(null)
  const all = useCloses(date)
  const name = useNameOfLogin()
  const client = useQueryClient()

  const by = (k: CloseState) => all.filter((d) => d.state === k)
  const ready = by("ready")
  const diff = by("diff")
  const open = by("open")
  const take = all.reduce((a, d) => a + d.gross, 0)
  const card = all.reduce((a, d) => a + d.card, 0)
  const cashDiff = all.reduce(
    (a, d) => a + (d.counted === null ? 0 : d.diff),
    0
  )
  const toPost = ready.length + diff.length

  // Receipts, returns and voids come from the sales window of the whole
  // chain for the day; the totals ride on its first page.
  const receipts = useReceipts("", date, date)
  useReadOn(receipts)
  const returns = useReturns("", date, date)
  const takings = receipts.data?.pages[0]
  const sold = useMemo(
    () => (receipts.data?.pages ?? []).flatMap((page) => page.transactions),
    [receipts.data]
  )
  const returnRows = useMemo(
    () => (returns.data?.pages ?? []).flatMap((page) => page.rows),
    [returns.data]
  )
  const voidsN = takings?.sales.voided_count ?? 0
  const recsN = takings?.sales.count ?? all.reduce((a, d) => a + d.receipts, 0)

  const postReady = useMutation({
    mutationFn: async (closes: readonly Close[]) => {
      for (const one of closes) await postDay(one, "")
      return closes.length
    },
    onSuccess: (n) => {
      toast.success(`${plural(n, "day")} posted`)
      void client.invalidateQueries({ queryKey: ["finance"] })
    },
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : "Could not post"),
  })

  const storeOf = (siteId: string) =>
    all.find((d) => d.unit.sites.some((s) => s.id === siteId))

  const chips = [
    { value: null, label: "All", count: all.length },
    { value: "ready", label: "Ready to post", count: ready.length },
    { value: "diff", label: "Difference", count: diff.length },
    { value: "open", label: "Not closed", count: open.length },
    { value: "posted", label: "Posted", count: by("posted").length },
  ]

  const needle = query.trim().toLowerCase()
  const rows = all
    .filter((d) => state === null || d.state === state)
    .filter(
      (d) =>
        needle === "" ||
        `${d.code} ${d.name} ${d.count?.counted_by ?? ""}`
          .toLowerCase()
          .includes(needle)
    )
  const sum = (f: (d: Close) => number) => rows.reduce((a, d) => a + f(d), 0)

  const dayCols: Col<Close>[] = [
    {
      id: "shop",
      header: "Shop",
      cell: (d) => <ShopCell code={d.code} name={d.name} />,
    },
    {
      id: "take",
      header: "Takings",
      size: 150,
      num: true,
      cell: (d) => <CellMoney minor={d.gross} />,
    },
    {
      id: "cash",
      header: "Cash",
      size: 140,
      num: true,
      cell: (d) => <CellMoney minor={d.cashExp} />,
    },
    {
      id: "card",
      header: "Card & QRIS",
      size: 150,
      num: true,
      cell: (d) => <CellMoney minor={d.card} />,
    },
    {
      id: "counted",
      header: "Cash counted",
      size: 150,
      num: true,
      cell: (d) =>
        d.counted === null ? <Dash /> : <CellMoney minor={d.counted} />,
    },
    {
      id: "diff",
      header: "Difference",
      size: 120,
      num: true,
      cell: (d) => <Diff minor={d.counted === null ? null : d.diff} />,
    },
    {
      id: "st",
      header: "Status",
      size: 180,
      cell: (d) => (
        <Status tone={STATE_WORD[d.state][1]}>{STATE_WORD[d.state][0]}</Status>
      ),
    },
  ]

  const receiptRows = sold
    .filter((r) => shop === "" || storeOf(r.site_id)?.code === shop)
    .filter(
      (r) =>
        needle === "" ||
        `${r.sale_number} ${r.customer_id ?? ""} ${name(r.actor_id)}`
          .toLowerCase()
          .includes(needle)
    )
  const receiptCols: Col<WindowTransaction>[] = [
    {
      id: "no",
      header: "Receipt",
      size: 190,
      cell: (r) => (
        <span className="font-medium text-ink">{r.sale_number}</span>
      ),
    },
    {
      id: "shop",
      header: "Shop",
      size: 170,
      cell: (r) => storeOf(r.site_id)?.name ?? "—",
    },
    { id: "time", header: "Time", size: 90, cell: (r) => time(r.completed_at) },
    { id: "cashier", header: "Cashier", cell: (r) => name(r.actor_id) },
    {
      id: "member",
      header: "Member",
      size: 130,
      cell: (r) => (r.customer_id === null ? <Dash /> : customerCode(r)),
    },
    {
      id: "by",
      header: "Paid by",
      size: 150,
      cell: (r) =>
        r.methods.length === 0 ? (
          <Dash />
        ) : (
          r.methods.map(methodWord).join(" + ")
        ),
    },
    {
      id: "items",
      header: "Items",
      size: 90,
      num: true,
      cell: (r) => count(r.units),
    },
    {
      id: "total",
      header: "Total",
      size: 150,
      num: true,
      cell: (r) => <CellMoney minor={r.total_minor} />,
    },
  ]

  const returnCols: Col<(typeof returnRows)[number]>[] = [
    {
      id: "no",
      header: "Return",
      size: 160,
      cell: (r) => (
        <span className="font-medium text-ink">{r.return_number}</span>
      ),
    },
    {
      id: "shop",
      header: "Shop",
      size: 190,
      cell: (r) => storeOf(r.site_id)?.name ?? "—",
    },
    { id: "sale", header: "Receipt", size: 190, cell: (r) => r.sale_number },
    {
      id: "why",
      header: "Brought back",
      cell: (r) => (
        <span className="block truncate">
          {r.reason === "" ? "—" : r.reason}
        </span>
      ),
    },
    { id: "took", header: "Taken instead", cell: () => <Dash /> },
    { id: "to", header: "Piece goes to", size: 150, cell: () => <Dash /> },
    {
      id: "top",
      header: "Top-up paid",
      size: 140,
      num: true,
      cell: (r) =>
        r.refund_total_minor === 0 ? (
          <Dash />
        ) : (
          <CellMoney minor={r.refund_total_minor} />
        ),
    },
  ]

  const tabs = [
    { value: "days", label: `Days · ${all.length}` },
    { value: "receipts", label: `Receipts · ${count(recsN)}` },
    {
      value: "returns",
      label: `Returns · ${count(takings?.returns.count ?? returnRows.length)}`,
    },
    { value: "voids", label: `Voids · ${count(voidsN)}` },
  ]

  const bar = (children: React.ReactNode) => (
    <Toolbar
      className="group/bar"
      lead={
        <SubTabs
          value={tab}
          onChange={(next) => setTab(next as Tab)}
          tabs={tabs}
        />
      }
    >
      <DayPick value={date} last={last} onChange={setDate} />
      {children}
    </Toolbar>
  )

  return (
    <>
      <PageHeader
        crumb="Finance › Stores"
        title="Daily close"
        actions={
          tab === "days" && ready.length > 0 ? (
            <Button
              variant="primary"
              pending={postReady.isPending}
              onClick={() => postReady.mutate(ready)}
            >
              Post {plural(ready.length, "ready day")}
            </Button>
          ) : undefined
        }
      />
      <KpiStrip className="grid-cols-2 md:grid-cols-5 xl:grid-cols-5">
        <Kpi label="Takings" value={money(take)} />
        <Kpi label="Card & QRIS to the banks" value={money(card)} />
        <Kpi
          label="Cash difference"
          value={
            cashDiff === 0
              ? "0"
              : `${cashDiff < 0 ? "−" : "+"}${money(Math.abs(cashDiff))}`
          }
          onClick={() => {
            setTab("days")
            setState("diff")
          }}
        />
        <Kpi
          label="Shops closed"
          value={`${all.length - open.length} of ${all.length}`}
          onClick={() => {
            setTab("days")
            setState("open")
          }}
        />
        <Kpi
          label="To post"
          value={String(toPost)}
          onClick={() => {
            setTab("days")
            setState("ready")
          }}
        />
      </KpiStrip>

      {tab === "days" && (
        <>
          {bar(
            <>
              <FilterChips
                label="Status"
                value={state}
                options={chips}
                onChange={setState}
              />
              <BarSpacer />
              <ExpandingSearch
                value={query}
                onChange={setQuery}
                label="Shop or cashier"
              />
            </>
          )}
          <GridTable
            rows={rows}
            cols={dayCols}
            id={(d) => d.code}
            onRow={(d) => setOpened(d.code)}
            empty="No shop matches"
            foot={{
              shop: plural(rows.length, "shop"),
              take: money(sum((d) => d.gross)),
              cash: money(sum((d) => d.cashExp)),
              card: money(sum((d) => d.card)),
              counted: money(sum((d) => d.counted ?? 0)),
              diff: money(sum((d) => (d.counted === null ? 0 : d.diff))),
            }}
          />
        </>
      )}

      {tab === "receipts" && (
        <>
          {bar(
            <>
              <Select
                value={shop}
                onChange={setShop}
                aria-label="Shop"
                className="h-control w-52"
              >
                <option value="">All shops</option>
                {all.map((d) => (
                  <option key={d.code} value={d.code}>
                    {d.name} · {d.code}
                  </option>
                ))}
              </Select>
              <ExpandingSearch
                value={query}
                onChange={setQuery}
                label="Receipt, member or article"
              />
              <BarSpacer />
              <span className="text-[0.9375rem] text-body">
                {plural(receiptRows.length, "receipt")} shown of {count(recsN)}
              </span>
            </>
          )}
          {takings === undefined ? (
            <LoadingState>Reading the receipts…</LoadingState>
          ) : (
            <GridTable
              rows={receiptRows}
              cols={receiptCols}
              id={(r) => r.id}
              onRow={setReceipt}
              empty="No receipt matches"
            />
          )}
        </>
      )}

      {tab === "returns" && (
        <>
          {bar(
            <>
              <BarSpacer />
              <span className="text-[0.9375rem] text-body">
                {plural(returnRows.length, "return")} · goods worth{" "}
                {money(
                  returnRows.reduce((a, r) => a + r.refund_total_minor, 0)
                )}
              </span>
            </>
          )}
          <GridTable
            rows={returnRows}
            cols={returnCols}
            id={(r) => r.id}
            empty="No returns on this day"
          />
        </>
      )}

      {tab === "voids" && (
        <>
          {bar(
            <>
              <BarSpacer />
              <span className="text-[0.9375rem] text-body">
                {plural(voidsN, "void")}
              </span>
            </>
          )}
          {/* The server counts voided receipts but lists none of them. */}
          <GridTable
            rows={[] as { id: string }[]}
            cols={voidCols}
            id={(r) => r.id}
            empty={
              voidsN === 0
                ? "No voids on this day"
                : `${plural(voidsN, "void")} on this day — the list is not carried yet`
            }
          />
        </>
      )}

      <CloseSheet
        close={all.find((d) => d.code === opened) ?? null}
        onClose={() => setOpened(null)}
        onReceipt={setReceipt}
      />
      <ReceiptSheet
        sale={receipt}
        shop={receipt ? (storeOf(receipt.site_id)?.name ?? "—") : ""}
        cashier={receipt ? name(receipt.actor_id) : ""}
        onClose={() => setReceipt(null)}
      />
    </>
  )
}

const voidCols: Col<{ id: string }>[] = [
  { id: "no", header: "Void", size: 160, cell: () => <Dash /> },
  { id: "shop", header: "Shop", size: 190, cell: () => <Dash /> },
  { id: "time", header: "Time", size: 90, cell: () => <Dash /> },
  { id: "cashier", header: "Cashier", cell: () => <Dash /> },
  { id: "head", header: "Approved by", cell: () => <Dash /> },
  { id: "why", header: "Reason", size: 210, cell: () => <Dash /> },
  { id: "amt", header: "Amount", size: 140, num: true, cell: () => <Dash /> },
]

function methodWord(method: string): string {
  const words: Record<string, string> = {
    CASH: "Cash",
    DEBIT: "Debit",
    DEBIT_CARD: "Debit",
    CREDIT: "Credit",
    CREDIT_CARD: "Credit",
    QRIS: "QRIS",
  }
  return (
    words[method.toUpperCase()] ??
    method
      .replace(/_/g, " ")
      .toLowerCase()
      .replace(/^\w/, (c) => c.toUpperCase())
  )
}

/// Posting a day: build the document, post it, and put a counted difference
/// in the books with the reason that was given.
async function postDay(one: Close, reason: string) {
  const doc = await generateSalesPosting({
    site_id: one.siteId,
    business_date: one.date,
  })
  if (doc.posting.status !== "POSTED")
    await postSalesPosting(doc.posting.posting_id)
  if (
    one.count !== null &&
    one.count.variance_minor !== 0 &&
    one.count.entry_id === null
  )
    await postCashCount(one.count.count_id, {
      reason: reason || one.count.reason || "Cash difference at the close",
    })
}

// ---------------------------------------------------------------------------
// One shop's day
// ---------------------------------------------------------------------------

const WHY_SHORT = "Kurang setor — kasir mengganti"
const WHY_OVER = "Lebih setor — kembalian kurang"
const WHY_OTHER = [
  "Salah hitung, sudah dihitung ulang",
  "Uang palsu ditolak bank",
]

function CloseSheet({
  close,
  onClose,
  onReceipt,
}: {
  close: Close | null
  onClose: () => void
  onReceipt: (sale: WindowTransaction) => void
}) {
  const client = useQueryClient()
  const navigate = useNavigate()
  const name = useNameOfLogin()
  const [why, setWhy] = useState("")
  const [note, setNote] = useState("")
  const post = useMutation({
    mutationFn: async () => {
      if (close === null) return
      const reason = [why || (close.diff < 0 ? WHY_SHORT : WHY_OVER), note]
        .filter((x) => x !== "")
        .join(" · ")
      await postDay(close, reason)
    },
    onSuccess: () => {
      if (close) toast.success(`${close.code} · ${day(close.date)} posted`)
      void client.invalidateQueries({ queryKey: ["finance"] })
      onClose()
    },
  })
  const d = close
  const [word, tone] = d ? STATE_WORD[d.state] : ["", "neutral" as const]
  const totalGot = d && d.counted !== null ? d.counted + d.card + d.other : null
  const lines =
    d === null
      ? []
      : [
          {
            m: "Cash",
            pos: d.cashExp,
            got: d.counted,
            to: `Cash on Hand · ${d.code}`,
            how:
              d.counted === null
                ? "Not counted"
                : `Counted ${dayTime(d.count?.created_at)}`,
          },
          {
            m: "Debit",
            pos: d.debit,
            got: d.debit,
            to: "Bank",
            how: "Bank pays after the close",
          },
          {
            m: "Credit",
            pos: d.credit,
            got: d.credit,
            to: "Bank",
            how: "Bank pays after the close",
          },
          {
            m: "QRIS",
            pos: d.qris,
            got: d.qris,
            to: "Bank",
            how: "Bank pays after the close",
          },
          { m: "Other", pos: d.other, got: d.other, to: "Bank", how: "—" },
        ].filter((t) => t.pos !== 0)

  return (
    <Sheet
      open={d !== null}
      onOpenChange={(next) => !next && onClose()}
      size="wide"
      context="Daily close"
      id={d ? `${weekday(d.date)} ${day(d.date)}` : undefined}
      title={d ? `${d.code} · ${d.name}` : "Day"}
      badge={d ? <Pill tone={tone}>{word}</Pill> : undefined}
      footer={
        d && (
          <SheetFooter
            onPrint={() => window.print()}
            error={post.error}
            primary={
              d.state === "ready" ? (
                <Button
                  variant="primary"
                  pending={post.isPending}
                  onClick={() => post.mutate()}
                >
                  Post day
                </Button>
              ) : d.state === "diff" ? (
                <Button
                  variant="primary"
                  pending={post.isPending}
                  onClick={() => post.mutate()}
                >
                  Post with difference
                </Button>
              ) : d.state === "open" ? (
                <Button
                  variant="primary"
                  onClick={() =>
                    toast(`Reminder sent to the head of ${d.code}`)
                  }
                >
                  Ask {d.code} to close
                </Button>
              ) : (
                <Button
                  variant="primary"
                  onClick={() =>
                    navigate({
                      to: "/finance/accounting/journal-entries",
                      search: { entry: d.row?.entry_id ?? undefined },
                    } as never)
                  }
                >
                  Open journal
                </Button>
              )
            }
          />
        )
      }
    >
      {d && (
        <div className="flex flex-col gap-6">
          {d.state === "open" && (
            <Banner tone="bad">
              <AlertTriangle className="mr-2 inline size-4" />
              The till at {d.code} was not closed. The POS shows{" "}
              {plural(d.receipts, "receipt")}, but no cash count has been sent.
            </Banner>
          )}
          <KpiStrip className="mb-0 grid-cols-2 md:grid-cols-5 xl:grid-cols-5">
            <Kpi label="Takings" value={money(d.gross)} />
            <Kpi label="Receipts" value={count(d.receipts)} />
            <Kpi label="Returns" value="—" />
            <Kpi label="Voided" value="—" />
            <Kpi
              label="Cash difference"
              value={
                d.counted === null
                  ? "—"
                  : d.diff === 0
                    ? "0"
                    : `${d.diff < 0 ? "−" : "+"}${money(Math.abs(d.diff))}`
              }
            />
          </KpiStrip>
          {d.state === "diff" && (
            <>
              <Banner tone="warn">
                <AlertTriangle className="mr-2 inline size-4" />
                Cash is {d.diff < 0 ? "short" : "over"} by{" "}
                {money(Math.abs(d.diff))}. Say why before posting — it posts to{" "}
                {d.diff < 0
                  ? "1011102001 Piutang Pegawai (the cashier pays it back)"
                  : "8010110002 Selisih pembulatan"}
                .
              </Banner>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_2fr]">
                <Field label="Why">
                  <Select
                    value={why || (d.diff < 0 ? WHY_SHORT : WHY_OVER)}
                    onChange={setWhy}
                  >
                    <option>{d.diff < 0 ? WHY_SHORT : WHY_OVER}</option>
                    {WHY_OTHER.map((w) => (
                      <option key={w}>{w}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Note">
                  <Input
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Printed on the close"
                  />
                </Field>
              </div>
            </>
          )}
          <Section title="Payments" quiet>
            <MiniTable
              head={[
                "Paid by",
                "POS says",
                "Counted or paid",
                "Difference",
                { label: "Goes to", align: "left" },
                { label: "When", align: "left" },
              ]}
            >
              {lines.map((t) => (
                <MiniRow key={t.m}>
                  <MiniCell className="font-medium text-ink">{t.m}</MiniCell>
                  <MiniCell align="right">{money(t.pos)}</MiniCell>
                  <MiniCell align="right">
                    {t.got === null ? "—" : money(t.got)}
                  </MiniCell>
                  <MiniCell align="right">
                    <Diff minor={t.got === null ? null : t.got - t.pos} />
                  </MiniCell>
                  <MiniCell>{t.to}</MiniCell>
                  <MiniCell className="text-mute">{t.how}</MiniCell>
                </MiniRow>
              ))}
              <MiniRow>
                <MiniCell className="font-medium text-ink">Total</MiniCell>
                <MiniCell align="right">
                  {money(d.cashExp + d.card + d.other)}
                </MiniCell>
                <MiniCell align="right">
                  {totalGot === null ? "—" : money(totalGot)}
                </MiniCell>
                <MiniCell align="right">
                  {d.counted === null ? "" : <Diff minor={d.diff} />}
                </MiniCell>
                <MiniCell colSpan={2}>{""}</MiniCell>
              </MiniRow>
            </MiniTable>
          </Section>
          <DayReceipts close={d} onReceipt={onReceipt} />
          <Facts>
            <Fact term="Cashiers">—</Fact>
            <Fact term="Closed">
              {d.count ? dayTime(d.count.created_at) : "—"}
            </Fact>
            <Fact term="Counted by">
              {d.count ? name(d.count.counted_by) : "—"}
            </Fact>
            <Fact term="PPN in it">—</Fact>
          </Facts>
        </div>
      )}
    </Sheet>
  )
}

// ---------------------------------------------------------------------------
// One receipt, as the till printed it
// ---------------------------------------------------------------------------

interface Line {
  readonly key: string
  readonly name: string
  readonly code: string
  readonly sku: string
  readonly qty: number
  readonly price: number
  readonly disc: number
  readonly subtotal: number
}

function ReceiptSheet({
  sale,
  shop,
  cashier,
  onClose,
}: {
  sale: WindowTransaction | null
  shop: string
  cashier: string
  onClose: () => void
}) {
  const body = useQuery({
    queryKey: ["finance", "close-receipt", sale?.source ?? "", sale?.id ?? ""],
    enabled: sale !== null,
    queryFn: async ({ signal }): Promise<Line[]> => {
      if (sale === null) return []
      if (sale.source === "EDGE") {
        const s = await shopSaleDetail(sale.id, signal)
        return s.lines.map((l, i) => ({
          key: `${l.sku_code}:${i}`,
          name: l.article_name ?? "—",
          code: l.article_code ?? "—",
          sku: sku(l.sku_code),
          qty: l.quantity,
          price: l.unit_price_minor,
          disc: 0,
          subtotal: l.line_total_minor ?? l.quantity * l.unit_price_minor,
        }))
      }
      const r = await saleReceipt(sale.id, signal)
      return r.lines.map((l) => ({
        key: l.sale_line_id,
        name: l.article_name,
        code: "—",
        sku: sku(l.sku_code),
        qty: l.quantity,
        price: l.unit_price_minor,
        disc: 0,
        subtotal: l.total_minor,
      }))
    },
  })
  const lines = body.data ?? []
  const sub = lines.reduce((a, l) => a + l.price * l.qty, 0)
  const disc = lines.reduce((a, l) => a + (l.price * l.qty - l.subtotal), 0)
  return (
    <Sheet
      open={sale !== null}
      onOpenChange={(next) => !next && onClose()}
      size="wide"
      context={`Daily close › ${shop}`}
      title={sale?.sale_number ?? "Receipt"}
      badge={<Pill tone="ok">Paid</Pill>}
      stack
      footer={
        <SheetFooter
          primary={
            <Button variant="primary" onClick={() => window.print()}>
              Print receipt again
            </Button>
          }
        />
      }
    >
      {sale && (
        <>
          <Facts>
            <Fact term="Shop">{shop}</Fact>
            <Fact term="Time">{dayTime(sale.completed_at)}</Fact>
            <Fact term="Cashier">{cashier}</Fact>
            <Fact term="Paid by">
              {sale.methods.map(methodWord).join(" + ") || "—"}
            </Fact>
            <Fact term="Member">
              {sale.customer_id === null ? "—" : customerCode(sale)}
            </Fact>
          </Facts>
          <Section title="Items" quiet>
            {body.isPending ? (
              <LoadingState>Reading the receipt…</LoadingState>
            ) : lines.length === 0 ? (
              <EmptyState>The items could not be read.</EmptyState>
            ) : (
              <MiniTable
                head={[
                  { label: "Article", align: "left" },
                  { label: "SKU", align: "left" },
                  "Qty",
                  "Price",
                  "Discount",
                  "Subtotal",
                ]}
              >
                {lines.map((l) => (
                  <MiniRow key={l.key}>
                    <MiniCell>
                      <span className="font-medium text-ink">{l.name}</span>{" "}
                      <span className="text-mute">{l.code}</span>
                    </MiniCell>
                    <MiniCell>{l.sku}</MiniCell>
                    <MiniCell align="right">{count(l.qty)}</MiniCell>
                    <MiniCell align="right">{money(l.price)}</MiniCell>
                    <MiniCell align="right">
                      {l.price * l.qty - l.subtotal > 0
                        ? money(-(l.price * l.qty - l.subtotal))
                        : "—"}
                    </MiniCell>
                    <MiniCell align="right">{money(l.subtotal)}</MiniCell>
                  </MiniRow>
                ))}
              </MiniTable>
            )}
          </Section>
          <TotalsLadder
            className="ml-auto w-full max-w-sm"
            rows={[
              { label: "Subtotal", value: money(sub) },
              { label: "Discount", value: disc > 0 ? money(-disc) : "0" },
              { label: "PPN in it", value: money(sale.tax_minor) },
            ]}
            total={{ label: "Total", value: money(sale.total_minor) }}
          />
        </>
      )}
    </Sheet>
  )
}

function DayReceipts({
  close,
  onReceipt,
}: {
  close: Close
  onReceipt: (sale: WindowTransaction) => void
}) {
  const name = useNameOfLogin()
  const receipts = useReceipts(close.siteId, close.date, close.date)
  useReadOn(receipts)
  const sold = receipts.data?.pages.flatMap((p) => p.transactions) ?? []
  return (
    <Section
      title="Receipts"
      quiet
      actions={
        <span className="text-mute">
          {sold.length} of {count(close.receipts)}
        </span>
      }
    >
      <GridTable
        rows={sold}
        id={(r) => r.id}
        onRow={onReceipt}
        empty="No receipt on this day"
        cols={[
          {
            id: "no",
            header: "Receipt",
            size: 190,
            cell: (r) => (
              <span className="font-medium text-ink">{r.sale_number}</span>
            ),
          },
          {
            id: "time",
            header: "Time",
            size: 80,
            cell: (r) => time(r.completed_at),
          },
          { id: "cashier", header: "Cashier", cell: (r) => name(r.actor_id) },
          {
            id: "by",
            header: "Paid by",
            size: 150,
            cell: (r) => r.methods.map(methodWord).join(" + ") || "—",
          },
          {
            id: "total",
            header: "Total",
            size: 140,
            num: true,
            cell: (r) => <CellMoney minor={r.total_minor} />,
          },
        ]}
      />
    </Section>
  )
}
