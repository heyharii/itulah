import {
  queryOptions,
  useMutation,
  useQueries,
  useQueryClient,
  useSuspenseQueries,
  useSuspenseQuery,
} from "@tanstack/react-query"
import { Suspense, useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Field, Input, Money, Select } from "@/components/ui/field"
import { FilterChips } from "@/components/ui/filter-chips"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { BarSpacer, ExpandingSearch } from "@/components/ui/list-chrome"
import { PageHeader } from "@/components/ui/page-header"
import { Pill, Status } from "@/components/ui/pill"
import { MiniCell, MiniRow, MiniTable, Section } from "@/components/ui/rows"
import { CellMoney } from "@/components/ui/rows-switch"
import { Toolbar } from "@/components/ui/segmented"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { SheetFooter } from "@/components/ui/sheet-footer"
import { LoadingState } from "@/components/ui/states"
import { SubTabs } from "@/components/ui/sub-tabs"
import { day, money, weekday } from "@/lib/format"
import {
  accountLedger,
  cashCountsQuery,
  financeKeys,
  recordDeposit,
  storeBoxQuery,
} from "@/lib/queries/finance"
import { toast } from "@/lib/toast"
import { unitsQuery, type UnitView } from "@/lib/queries/organisation"
import { saleDaysOnQuery } from "@/lib/queries/stores-close"
import { listDeposits } from "@/lib/queries/finance"
import { todayIso } from "@/screens/finance/chart"
import { useMoneyAccounts } from "@/screens/finance/hooks"
import {
  openStoresOf,
  STORE_BOX_CODES,
  type StoreBox,
} from "@/screens/finance/store-units"
import {
  addDays,
  Dash,
  daysBetween,
  GridTable,
  plural,
  ShopCell,
  type Col,
} from "@/screens/finance/stores-grid"
import type {
  CashCountRow,
  GeneralLedgerRow,
  StoreDeposit,
} from "@itulah/contract"

/// Finance › Stores › Store cash. 7Soft's Kas Kecil, Modal Kasir and Setoran.
/// Each shop's cash chain: float (Modal Kasir) → cash on hand → deposit in
/// transit → bank.

type Tab = "shops" | "deposits" | "petty"
type ShopKind = "short" | "late" | "over" | "stale" | "ok"
type DepKind = "landed" | "transit" | "late"

const ROLES: StoreBox[] = ["cash", "petty_cash", "cashier_float"]
const SINCE_DAYS = 7

const SHOP_WORD: Record<ShopKind, [string, "ok" | "warn" | "bad"]> = {
  short: ["Short", "bad"],
  late: ["Deposit late", "bad"],
  over: ["Over", "warn"],
  stale: ["Not counted for a week", "warn"],
  ok: ["Counted", "ok"],
}
const DEP_WORD: Record<DepKind, [string, "ok" | "info" | "bad"]> = {
  landed: ["Landed", "ok"],
  transit: ["In transit", "info"],
  late: ["Late", "bad"],
}

const depKind = (d: StoreDeposit): DepKind =>
  d.status === "LANDED" ? "landed" : d.days_in_transit > 1 ? "late" : "transit"

interface Shop {
  readonly unit: UnitView
  readonly float: number
  readonly cash: number
  readonly petty: number
  readonly transit: number
  readonly short: number
  readonly last: string | null
  readonly kind: ShopKind
}

function useStoreCash() {
  const today = todayIso()
  const units = useSuspenseQuery(unitsQuery())
  const stores = useMemo(() => openStoresOf(units.data), [units.data])
  const boxes = useSuspenseQueries({
    queries: stores.flatMap((store) =>
      ROLES.map((role) =>
        storeBoxQuery(store.id, role, STORE_BOX_CODES[role], today)
      )
    ),
  })
  const counts = useSuspenseQuery(cashCountsQuery())
  const deposits = useSuspenseQuery({
    queryKey: [...financeKeys.all, "store-cash-deposits"],
    queryFn: ({ signal }) => listDeposits({ sort: "banked_on" }, signal),
    refetchInterval: 10_000,
  })
  const shops = useMemo<Shop[]>(
    () =>
      stores.map((unit, i) => {
        const books = (r: number) =>
          boxes[i * ROLES.length + r]?.data.closing_minor ?? 0
        const mine = counts.data.filter(
          (c) =>
            unit.sites.some((s) => s.id === c.site_id) || c.site_id === unit.id
        )
        const latest = (code: string): CashCountRow | undefined =>
          mine
            .filter((c) => c.account_code === code)
            .sort((a, b) => b.counted_on.localeCompare(a.counted_on))[0]
        const found = ROLES.map((r) => latest(STORE_BOX_CODES[r]))
        const last = found.some((f) => f === undefined)
          ? null
          : (found.map((f) => (f as CashCountRow).counted_on).sort()[0] ?? null)
        const short = latest(STORE_BOX_CODES.cash)?.variance_minor ?? 0
        const mineDeps = deposits.data.rows.filter((d) => d.unit_id === unit.id)
        const transit = mineDeps
          .filter((d) => d.status !== "LANDED")
          .reduce((a, d) => a + d.amount_minor, 0)
        const lateDep = mineDeps.some((d) => depKind(d) === "late")
        const kind: ShopKind =
          short < 0
            ? "short"
            : lateDep
              ? "late"
              : short > 0
                ? "over"
                : last === null || daysBetween(last, today) > 7
                  ? "stale"
                  : "ok"
        return {
          unit,
          cash: books(0),
          petty: books(1),
          float: books(2),
          transit,
          short,
          last,
          kind,
        }
      }),
    [stores, boxes, counts.data, deposits.data, today]
  )
  return { stores, shops, deposits: deposits.data, today, counts: counts.data }
}

/// A month of the petty cash box of every shop, one read each.
const pettyOf = (unit: string, from: string, to: string) =>
  queryOptions({
    queryKey: [...financeKeys.all, "store-cash-petty", unit, from, to],
    queryFn: ({ signal }) =>
      accountLedger(
        STORE_BOX_CODES.petty_cash,
        { unit, from, to, limit: 200 },
        signal
      ),
  })

export function StoreCash() {
  return (
    <PageContent>
      <Suspense
        fallback={
          <>
            <PageHeader crumb="Finance › Stores" title="Store cash" />
            <LoadingState>Reading the shops…</LoadingState>
          </>
        }
      >
        <StoreCashBody />
      </Suspense>
    </PageContent>
  )
}

function StoreCashBody() {
  const { stores, shops, deposits, today } = useStoreCash()
  const [tab, setTab] = useState<Tab>("shops")
  const [state, setState] = useState<string | null>(null)
  const [depState, setDepState] = useState<string | null>(null)
  const [kind, setKind] = useState<string | null>(null)
  const [shopPick, setShopPick] = useState("")
  const [query, setQuery] = useState("")
  const [opened, setOpened] = useState<string | null>(null)
  const [recording, setRecording] = useState<string | null>(null)

  const from = today.slice(0, 7) + "-01"
  const petty = useQueries({
    queries: stores.map((s) => pettyOf(s.id, from, today)),
  })
  const pettyRows = useMemo(
    () =>
      stores
        .flatMap((unit, i) =>
          (petty[i]?.data?.rows ?? []).map((row) => ({ unit, row }))
        )
        .sort(
          (a, b) =>
            b.row.posting_date.localeCompare(a.row.posting_date) ||
            a.unit.code.localeCompare(b.unit.code)
        ),
    [stores, petty]
  )

  const needle = query.trim().toLowerCase()
  const unitOf = (id: string) => stores.find((s) => s.id === id)
  const inTransit = deposits.in_transit_minor
  const shopKinds = (k: string) =>
    shops.filter((x) =>
      k === "short" ? x.kind === "short" || x.kind === "over" : x.kind === k
    ).length

  const shopRows = shops
    .filter(
      (x) =>
        state === null ||
        (state === "short"
          ? x.kind === "short" || x.kind === "over"
          : x.kind === state)
    )
    .filter(
      (x) =>
        needle === "" ||
        `${x.unit.code} ${x.unit.name}`.toLowerCase().includes(needle)
    )
  const shopCols: Col<Shop>[] = [
    {
      id: "shop",
      header: "Shop",
      cell: (x) => <ShopCell code={x.unit.code} name={x.unit.name} />,
    },
    {
      id: "float",
      header: "Float",
      size: 130,
      num: true,
      cell: (x) => <CellMoney minor={x.float} />,
    },
    {
      id: "cash",
      header: "Cash on hand",
      size: 150,
      num: true,
      cell: (x) => <CellMoney minor={x.cash} />,
    },
    {
      id: "transit",
      header: "In transit",
      size: 150,
      num: true,
      cell: (x) =>
        x.transit === 0 ? (
          <Dash />
        ) : (
          <span className={x.kind === "late" ? "text-bad-fg" : undefined}>
            <CellMoney minor={x.transit} />
          </span>
        ),
    },
    {
      id: "petty",
      header: "Petty cash",
      size: 130,
      num: true,
      cell: (x) => <CellMoney minor={x.petty} />,
    },
    {
      id: "last",
      header: "Last counted",
      size: 120,
      cell: (x) => (x.last === null ? <Dash /> : day(x.last)),
    },
    {
      id: "st",
      header: "Status",
      size: 220,
      cell: (x) => (
        <Status tone={SHOP_WORD[x.kind][1]}>{SHOP_WORD[x.kind][0]}</Status>
      ),
    },
  ]

  const depList = deposits.rows
    .filter((d) => depState === null || depKind(d) === depState)
    .filter(
      (d) =>
        needle === "" ||
        `${d.deposit_number} ${unitOf(d.unit_id)?.code ?? ""} ${unitOf(d.unit_id)?.name ?? ""} ${d.slip_reference}`
          .toLowerCase()
          .includes(needle)
    )
    .sort(
      (a, b) =>
        b.banked_on.localeCompare(a.banked_on) ||
        a.deposit_number.localeCompare(b.deposit_number)
    )
  const nDep = (k: DepKind) =>
    deposits.rows.filter((d) => depKind(d) === k).length
  const depCols: Col<StoreDeposit>[] = [
    {
      id: "no",
      header: "Deposit",
      size: 150,
      cell: (d) => (
        <span className="font-medium text-ink">{d.deposit_number}</span>
      ),
    },
    { id: "shop", header: "Shop", cell: (d) => unitOf(d.unit_id)?.name ?? "—" },
    {
      id: "date",
      header: "Date",
      size: 100,
      cell: (d) =>
        depKind(d) === "late" ? (
          <span className="text-bad-fg">{day(d.banked_on)}</span>
        ) : (
          day(d.banked_on)
        ),
    },
    {
      id: "amt",
      header: "Amount",
      size: 160,
      num: true,
      cell: (d) => <CellMoney minor={d.amount_minor} />,
    },
    { id: "into", header: "Into", size: 190, cell: (d) => d.bank_account_name },
    {
      id: "landed",
      header: "Landed",
      size: 110,
      cell: (d) => (d.landed_on === null ? <Dash /> : day(d.landed_on)),
    },
    {
      id: "st",
      header: "Status",
      size: 160,
      cell: (d) => (
        <Status tone={DEP_WORD[depKind(d)][1]}>
          {DEP_WORD[depKind(d)][0]}
        </Status>
      ),
    },
  ]

  type Petty = (typeof pettyRows)[number]
  const pettyList = pettyRows
    .filter((p) => shopPick === "" || p.unit.id === shopPick)
    .filter(
      (p) =>
        kind === null ||
        (kind === "spent" ? p.row.credit_minor > 0 : p.row.debit_minor > 0)
    )
    .filter(
      (p) =>
        needle === "" ||
        `${p.row.memo ?? ""} ${p.unit.code} ${p.unit.name} ${p.row.entry_number}`
          .toLowerCase()
          .includes(needle)
    )
  const pettyBase = pettyRows.filter(
    (p) => shopPick === "" || p.unit.id === shopPick
  )
  const pettyCols: Col<Petty>[] = [
    {
      id: "date",
      header: "Date",
      size: 80,
      cell: (p) => day(p.row.posting_date),
    },
    {
      id: "shop",
      header: "Shop",
      size: 160,
      cell: (p) => <ShopCell code={p.unit.code} name={p.unit.name} />,
    },
    {
      id: "for",
      header: "For",
      cell: (p) => (
        <span className="block truncate">
          {p.row.memo ?? p.row.account_name}
        </span>
      ),
    },
    {
      id: "receipt",
      header: "Receipt",
      size: 180,
      cell: (p) => (
        <span className="font-medium text-ink">{p.row.entry_number}</span>
      ),
    },
    { id: "by", header: "By", size: 170, cell: () => <Dash /> },
    {
      id: "spent",
      header: "Spent",
      size: 140,
      num: true,
      cell: (p) =>
        p.row.credit_minor > 0 ? <CellMoney minor={p.row.credit_minor} /> : "",
    },
    {
      id: "top",
      header: "Top-up",
      size: 150,
      num: true,
      cell: (p) =>
        p.row.debit_minor > 0 ? <CellMoney minor={p.row.debit_minor} /> : "",
    },
  ]

  const tabs = [
    { value: "shops", label: `Shops · ${shops.length}` },
    { value: "deposits", label: `Deposits · ${deposits.rows.length}` },
    { value: "petty", label: `Petty cash · ${pettyRows.length}` },
  ]
  const bar = (children: React.ReactNode) => (
    <Toolbar
      className="group/bar"
      lead={
        <SubTabs
          value={tab}
          onChange={(next) => {
            setTab(next as Tab)
            setQuery("")
          }}
          tabs={tabs}
        />
      }
    >
      {children}
    </Toolbar>
  )
  const shortN = shops.filter((x) => x.kind === "short").length

  return (
    <>
      <PageHeader
        crumb="Finance › Stores"
        title="Store cash"
        actions={
          <Button variant="primary" onClick={() => setRecording("")}>
            Record deposit
          </Button>
        }
      />
      <KpiStrip className="grid-cols-2 md:grid-cols-4 xl:grid-cols-4">
        <Kpi
          label="Cash in shops"
          value={money(shops.reduce((a, x) => a + x.cash + x.float, 0))}
        />
        <Kpi
          label="In transit to banks"
          value={money(inTransit)}
          onClick={() => setTab("deposits")}
        />
        <Kpi
          label="Petty cash left"
          value={money(shops.reduce((a, x) => a + x.petty, 0))}
          onClick={() => setTab("petty")}
        />
        <Kpi
          label="Shops short"
          value={String(shortN)}
          onClick={() => {
            setTab("shops")
            setState("short")
          }}
        />
      </KpiStrip>

      {tab === "shops" &&
        bar(
          <>
            <FilterChips
              label="Status"
              value={state}
              onChange={setState}
              options={[
                { value: null, label: "All", count: shops.length },
                {
                  value: "short",
                  label: "Short or over",
                  count: shopKinds("short"),
                },
                {
                  value: "late",
                  label: "Deposit late",
                  count: shopKinds("late"),
                },
                {
                  value: "stale",
                  label: "Not counted",
                  count: shopKinds("stale"),
                },
              ]}
            />
            <BarSpacer />
            <ExpandingSearch value={query} onChange={setQuery} label="Shop" />
          </>
        )}
      {tab === "shops" && (
        <GridTable
          rows={shopRows}
          cols={shopCols}
          id={(x) => x.unit.id}
          onRow={(x) => setOpened(x.unit.id)}
          empty="No shop matches"
          foot={{
            shop: plural(shopRows.length, "shop"),
            float: money(shopRows.reduce((a, x) => a + x.float, 0)),
            cash: money(shopRows.reduce((a, x) => a + x.cash, 0)),
            transit: money(shopRows.reduce((a, x) => a + x.transit, 0)),
            petty: money(shopRows.reduce((a, x) => a + x.petty, 0)),
          }}
        />
      )}

      {tab === "deposits" &&
        bar(
          <>
            <FilterChips
              label="Status"
              value={depState}
              onChange={setDepState}
              options={[
                { value: null, label: "All", count: deposits.rows.length },
                {
                  value: "transit",
                  label: "In transit",
                  count: nDep("transit"),
                },
                { value: "late", label: "Late", count: nDep("late") },
                { value: "landed", label: "Landed", count: nDep("landed") },
              ]}
            />
            <ExpandingSearch
              value={query}
              onChange={setQuery}
              label="Deposit, shop or slip"
            />
          </>
        )}
      {tab === "deposits" && (
        <GridTable
          rows={depList}
          cols={depCols}
          id={(d) => d.deposit_id}
          onRow={(d) => setOpened(d.unit_id)}
          empty="No deposit matches"
          foot={{
            no: plural(depList.length, "deposit"),
            amt: money(depList.reduce((a, d) => a + d.amount_minor, 0)),
          }}
        />
      )}

      {tab === "petty" &&
        bar(
          <>
            <Select
              value={shopPick}
              onChange={setShopPick}
              aria-label="Shop"
              className="h-control w-52"
            >
              <option value="">All shops</option>
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} · {s.code}
                </option>
              ))}
            </Select>
            <FilterChips
              label="Kind"
              value={kind}
              onChange={setKind}
              options={[
                { value: null, label: "All", count: pettyBase.length },
                {
                  value: "spent",
                  label: "Spent",
                  count: pettyBase.filter((p) => p.row.credit_minor > 0).length,
                },
                {
                  value: "top",
                  label: "Top-ups",
                  count: pettyBase.filter((p) => p.row.debit_minor > 0).length,
                },
              ]}
            />
            <ExpandingSearch
              value={query}
              onChange={setQuery}
              label="What for, shop or who"
            />
          </>
        )}
      {tab === "petty" && (
        <GridTable
          rows={pettyList}
          cols={pettyCols}
          id={(p) => p.row.line_id}
          onRow={(p) => setOpened(p.unit.id)}
          empty="No petty cash line matches"
          foot={{
            shop: plural(pettyList.length, "line"),
            spent: money(pettyList.reduce((a, p) => a + p.row.credit_minor, 0)),
            top: money(pettyList.reduce((a, p) => a + p.row.debit_minor, 0)),
          }}
        />
      )}

      <ShopSheet
        shop={shops.find((x) => x.unit.id === opened) ?? null}
        deposits={deposits.rows}
        onClose={() => setOpened(null)}
        onRecord={(id) => setRecording(id)}
      />
      <DepositSheet
        unitId={recording}
        shops={shops}
        onClose={() => setRecording(null)}
      />
    </>
  )
}

// ---------------------------------------------------------------------------
// One shop: what it holds, the week's chain from takings to the bank, what moved
// ---------------------------------------------------------------------------

function ShopSheet({
  shop,
  deposits,
  onClose,
  onRecord,
}: {
  shop: Shop | null
  deposits: readonly StoreDeposit[]
  onClose: () => void
  onRecord: (unitId: string) => void
}) {
  return (
    <Sheet
      open={shop !== null}
      onOpenChange={(next) => !next && onClose()}
      size="wide"
      context="Store cash"
      title={shop ? `${shop.unit.code} · ${shop.unit.name}` : "Shop"}
      badge={
        shop ? (
          <Pill
            tone={
              SHOP_WORD[shop.kind][1] === "ok"
                ? "neutral"
                : SHOP_WORD[shop.kind][1]
            }
          >
            {SHOP_WORD[shop.kind][0]}
          </Pill>
        ) : undefined
      }
      footer={
        shop && (
          <SheetFooter
            onPrint={() => window.print()}
            primary={
              <Button variant="primary" onClick={() => onRecord(shop.unit.id)}>
                Record deposit
              </Button>
            }
          />
        )
      }
    >
      {shop && <ShopBody shop={shop} deposits={deposits} />}
    </Sheet>
  )
}

function ShopBody({
  shop,
  deposits,
}: {
  shop: Shop
  deposits: readonly StoreDeposit[]
}) {
  const today = todayIso()
  const to = addDays(today, -1)
  const from = addDays(today, -SINCE_DAYS)
  const siteId = shop.unit.sites[0]?.id ?? ""
  const days = useMemo(() => {
    const out: string[] = []
    for (let d = from; d <= to; d = addDays(d, 1)) out.push(d)
    return out
  }, [from, to])
  const [saleDays, counts, ...ledgers] = useQueries({
    queries: [
      saleDaysOnQuery(from, to, siteId),
      cashCountsQuery(),
      ...ROLES.map((role) =>
        queryOptions({
          queryKey: [
            ...financeKeys.all,
            "store-cash-moves",
            shop.unit.id,
            role,
            from,
            to,
          ],
          queryFn: ({ signal }) =>
            accountLedger(
              STORE_BOX_CODES[role],
              { unit: shop.unit.id, from, to: today, limit: 200 },
              signal
            ),
        })
      ),
    ],
  })
  const mine = deposits.filter((d) => d.unit_id === shop.unit.id)
  const chain = days.map((date) => {
    const row = (
      saleDays.data as
        | {
            rows: {
              trading_day: string
              cash_tendered_minor: number
              change_minor: number
            }[]
          }
        | undefined
    )?.rows.find((r) => r.trading_day === date)
    const cashExp = row ? row.cash_tendered_minor - row.change_minor : 0
    const count = (counts.data as CashCountRow[] | undefined)?.find(
      (c) =>
        c.account_code === STORE_BOX_CODES.cash &&
        c.counted_on === date &&
        (c.site_id === siteId || c.site_id === shop.unit.id)
    )
    const dep = mine.find((d) => d.banked_on === addDays(date, 1))
    return {
      date,
      cashExp,
      count,
      dep,
      diff: count ? count.counted_minor - cashExp : 0,
    }
  })
  const moves = ledgers
    .flatMap((q, r) =>
      ((q.data as { rows: GeneralLedgerRow[] } | undefined)?.rows ?? []).map(
        (row) => ({
          row,
          box: ["Cash on hand", "Petty cash", "Modal Kasir"][r],
        })
      )
    )
    .sort((a, b) => b.row.posting_date.localeCompare(a.row.posting_date))
  const lateWord = (n: number) => `${plural(n, "day")} late`
  return (
    <div className="flex flex-col gap-6">
      <KpiStrip className="mb-0 grid-cols-2 md:grid-cols-5 xl:grid-cols-5">
        <Kpi label="Float" value={money(shop.float)} />
        <Kpi label="Cash on hand" value={money(shop.cash)} />
        <Kpi label="In transit" value={money(shop.transit)} />
        <Kpi label="Petty cash" value={money(shop.petty)} />
        <Kpi
          label="Short or over"
          value={
            shop.short === 0
              ? "0"
              : `${shop.short < 0 ? "−" : "+"}${money(Math.abs(shop.short))}`
          }
        />
      </KpiStrip>
      <Section
        title="Chain"
        quiet
        actions={
          <span className="text-mute">
            {day(days[0])} – {day(days[days.length - 1])}
          </span>
        }
      >
        <MiniTable
          head={[
            "Day",
            "Cash takings",
            "Counted",
            { label: "Deposit", align: "left" },
            "Deposited",
            { label: "Landed on the bank", align: "left" },
          ]}
        >
          {chain.map((c) => (
            <MiniRow key={c.date}>
              <MiniCell>
                {weekday(c.date)} {day(c.date)}
              </MiniCell>
              <MiniCell align="right">{money(c.cashExp)}</MiniCell>
              <MiniCell align="right">
                {c.count === undefined ? (
                  "—"
                ) : (
                  <span
                    className={
                      c.diff < 0
                        ? "text-bad-fg"
                        : c.diff > 0
                          ? "text-warn-fg"
                          : undefined
                    }
                  >
                    {money(c.count.counted_minor)}
                  </span>
                )}
              </MiniCell>
              <MiniCell>{c.dep ? c.dep.deposit_number : "—"}</MiniCell>
              <MiniCell align="right">
                {c.dep ? money(c.dep.amount_minor) : "—"}
              </MiniCell>
              <MiniCell>
                {!c.dep ? (
                  c.count === undefined ? (
                    "—"
                  ) : (
                    <span className="text-mute">Not deposited yet</span>
                  )
                ) : c.dep.landed_on ? (
                  day(c.dep.landed_on)
                ) : depKind(c.dep) === "late" ? (
                  <Status tone="bad">{lateWord(c.dep.days_in_transit)}</Status>
                ) : (
                  <Status tone="info">In transit</Status>
                )}
              </MiniCell>
            </MiniRow>
          ))}
        </MiniTable>
      </Section>
      <Section
        title="Movements"
        quiet
        actions={<span className="text-mute">Since {day(from)}</span>}
      >
        <MiniTable
          head={[
            "Date",
            { label: "Document", align: "left" },
            { label: "Box", align: "left" },
            { label: "For", align: "left" },
            "In",
            "Out",
          ]}
        >
          {moves.length === 0 ? (
            <MiniRow>
              <MiniCell colSpan={6}>Nothing moved this week</MiniCell>
            </MiniRow>
          ) : (
            moves.map(({ row, box }) => (
              <MiniRow key={row.line_id}>
                <MiniCell>{day(row.posting_date)}</MiniCell>
                <MiniCell className="font-medium text-ink">
                  {row.entry_number}
                </MiniCell>
                <MiniCell>{box}</MiniCell>
                <MiniCell>{row.memo ?? row.account_name}</MiniCell>
                <MiniCell align="right">
                  {row.debit_minor ? money(row.debit_minor) : ""}
                </MiniCell>
                <MiniCell align="right">
                  {row.credit_minor ? money(row.credit_minor) : ""}
                </MiniCell>
              </MiniRow>
            ))
          )}
          {moves.length > 0 && (
            <MiniRow>
              <MiniCell colSpan={2} className="font-medium text-ink">
                {plural(moves.length, "line")}
              </MiniCell>
              <MiniCell colSpan={2}>{""}</MiniCell>
              <MiniCell align="right">
                {money(moves.reduce((a, m) => a + m.row.debit_minor, 0))}
              </MiniCell>
              <MiniCell align="right">
                {money(moves.reduce((a, m) => a + m.row.credit_minor, 0))}
              </MiniCell>
            </MiniRow>
          )}
        </MiniTable>
      </Section>
      <Facts>
        <Fact term="Cash on hand">{STORE_BOX_CODES.cash}</Fact>
        <Fact term="Petty cash">{STORE_BOX_CODES.petty_cash}</Fact>
        <Fact term="Modal Kasir">{STORE_BOX_CODES.cashier_float}</Fact>
        <Fact term="Head of shop">{shop.unit.pic?.name ?? "—"}</Fact>
      </Facts>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Record a deposit
// ---------------------------------------------------------------------------

function DepositSheet({
  unitId,
  shops,
  onClose,
}: {
  unitId: string | null
  shops: readonly Shop[]
  onClose: () => void
}) {
  return (
    <Sheet
      open={unitId !== null}
      onOpenChange={(next) => !next && onClose()}
      size="rail"
      context="Store cash"
      title="Record deposit"
      noFoot
    >
      {unitId !== null && (
        <DepositForm
          key={unitId}
          fixed={unitId}
          shops={shops}
          onClose={onClose}
        />
      )}
    </Sheet>
  )
}

function DepositForm({
  fixed,
  shops,
  onClose,
}: {
  fixed: string
  shops: readonly Shop[]
  onClose: () => void
}) {
  const client = useQueryClient()
  const [unitId, setUnitId] = useState(fixed || shops[0]?.unit.id || "")
  const shop = shops.find((s) => s.unit.id === unitId)
  const banks = useMoneyAccounts(unitId).filter(
    (a) => a.account_key === "bank_giro" || a.account_key === "bank_savings"
  )
  const [amount, setAmount] = useState("")
  const [bank, setBank] = useState("")
  const [slip, setSlip] = useState("")
  const [date, setDate] = useState(todayIso())
  const chosen = banks.find((b) => b.account_code === bank) ?? banks[0]
  const n = Number(amount || 0)
  const over = shop !== undefined && n > shop.cash
  const save = useMutation({
    mutationFn: () =>
      recordDeposit({
        unit_id: unitId,
        drawer_account_code: STORE_BOX_CODES.cash,
        bank_account_code: chosen?.account_code ?? "",
        amount_minor: n,
        banked_on: date,
        carried_by: shop?.unit.pic?.name ?? shop?.unit.name ?? "",
        slip_reference: slip.trim(),
        note: "",
        bank_now: true,
      }),
    onSuccess: (d) => {
      toast.success(`Deposit ${d.deposit_number} recorded`, {
        description: `${money(d.amount_minor)} in transit to ${d.bank_account_name}`,
      })
      void client.invalidateQueries({ queryKey: financeKeys.all })
      onClose()
    },
  })
  const problem =
    n === 0
      ? "Type the amount"
      : over
        ? `More than the cash on hand at ${shop?.unit.code} · ${money(shop?.cash)}`
        : chosen === undefined
          ? "This shop has no bank account to deposit into"
          : null
  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-4">
        {fixed === "" && (
          <Field label="Shop" required>
            <Select value={unitId} onChange={setUnitId}>
              {shops.map((s) => (
                <option key={s.unit.id} value={s.unit.id}>
                  {s.unit.name} · {s.unit.code}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="Amount" required problem={over ? problem : undefined}>
          <Money
            value={amount}
            onChange={setAmount}
            prefix="Rp"
            label="Amount"
          />
        </Field>
        <Field label="Into">
          <Select value={chosen?.account_code ?? ""} onChange={setBank}>
            {banks.map((b) => (
              <option
                key={`${b.account_key}${b.account_qualifier}`}
                value={b.account_code}
              >
                {b.account_name}
                {b.account_qualifier ? ` · ${b.account_qualifier}` : ""}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Slip no">
            <Input
              value={slip}
              onChange={(e) => setSlip(e.target.value)}
              placeholder="On the bank's slip"
            />
          </Field>
          <Field label="Date">
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </Field>
        </div>
      </div>
      <SheetFooter
        error={save.error}
        note={problem ?? undefined}
        primary={{
          label: "Save deposit",
          pending: save.isPending,
          disabled: problem !== null,
          onClick: () => save.mutate(),
        }}
      />
    </div>
  )
}
