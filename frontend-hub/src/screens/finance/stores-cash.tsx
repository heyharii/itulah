import {
  useSuspenseInfiniteQuery,
  useSuspenseQueries,
  useSuspenseQuery,
} from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { Suspense, useDeferredValue, useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Select } from "@/components/ui/field"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { ExpandingSearch } from "@/components/ui/list-chrome"
import { PageHeader } from "@/components/ui/page-header"
import { CellMoney } from "@/components/ui/rows-switch"
import { Toolbar } from "@/components/ui/segmented"
import { EmptyState, LoadingState } from "@/components/ui/states"
import { SubTabs } from "@/components/ui/sub-tabs"
import { count, day, money } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import { storeBoxLedgerQuery, storeBoxQuery } from "@/lib/queries/finance"
import { useUnits } from "@/lib/queries/organisation"
import { tableSetup, type TableSetup } from "@/lib/table"
import { useDebounced } from "@/lib/use-debounced"
import { cn } from "@/lib/utils"
import { todayIso } from "@/screens/finance/chart"
import { ExpenseCodes } from "@/screens/finance/expense-codes"
import { PhoneFigures } from "@/screens/finance/parts"
import type { GeneralLedgerRow } from "@itulah/contract"
import { ExpensesByWeek } from "@/screens/finance/stores"
import {
  STORE_BOX_CODES,
  lastMonthTabs,
  type StoreBox,
} from "@/screens/finance/store-units"
import {
  StoreFrame,
  useOpenStore,
  useOpenStores,
} from "@/screens/finance/stores-frame"

/// Finance › Stores › Cash on hand, Petty cash, Cashier float (owner,
/// 2026-10-01). Cash takings land in the shop's Cash on hand; card and QRIS
/// go to the bank. Petty cash and the cashier's float are the shop's other two
/// cash boxes, each its own account.

type Role = StoreBox

/// The account roles' codes in the client's chart (`store-units.ts`). The
/// ledger is asked by code.
const CODES = STORE_BOX_CODES

const ROLE_TEXT: Record<Role, { title: string; empty: string }> = {
  cash: {
    title: "Cash on hand",
    empty: "Nothing moved in Cash on hand this month.",
  },
  petty_cash: {
    title: "Petty cash",
    empty: "Nothing moved in Petty cash this month.",
  },
  cashier_float: {
    title: "Cashier float",
    empty: "Nothing moved in the Cashier float this month.",
  },
}

// ---------------------------------------------------------------------------
// Overview: every shop, three boxes
// ---------------------------------------------------------------------------

export function StoresOverview() {
  return (
    <PageContent>
      <PageHeader crumb="Finance" title="Stores" />
      <Suspense fallback={<LoadingState>Reading the shops…</LoadingState>}>
        <StoresOverviewBody />
      </Suspense>
    </PageContent>
  )
}

const ROLES: Role[] = ["cash", "petty_cash", "cashier_float"]

function StoresOverviewBody() {
  const { stores } = useOpenStores()
  const open = useOpenStore()
  const today = todayIso()
  const roles = ROLES
  const phone = useLayout() === "phone"
  const balances = useSuspenseQueries({
    queries: stores.flatMap((store) =>
      roles.map((role) => storeBoxQuery(store.id, role, CODES[role], today))
    ),
  })
  const at = (storeIndex: number, roleIndex: number) =>
    balances[storeIndex * roles.length + roleIndex]
  const total = (roleIndex: number) =>
    stores.reduce(
      (sum, _store, i) => sum + (at(i, roleIndex)?.data?.closing_minor ?? 0),
      0
    )

  /// The shops and what their three boxes hold today. A row opens the shop;
  /// on a card the shop names it and its code sits over it.
  const columns = useMemo<ColumnDef<TableSetup, ShopRow>[]>(
    () => [
      {
        id: "shop",
        accessorFn: (row) => row.store.name,
        header: "Shop",
        size: 260,
        enableSorting: false,
        meta: { card: "title", grow: 220 },
        cell: ({ row }) => (
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-ink">{row.original.store.name}</span>
            <span className="font-mono text-[0.9375rem] text-mute">
              {row.original.store.code}
            </span>
          </span>
        ),
      },
      ...roles.map((role, r): ColumnDef<TableSetup, ShopRow> => ({
        id: role,
        accessorFn: (row) => row.boxes[r]?.data?.closing_minor ?? null,
        header: ROLE_TEXT[role].title,
        size: 190,
        enableSorting: false,
        meta: { align: "right", card: "metric" },
        cell: ({ row }) => {
          const one = row.original.boxes[r]
          return one?.isPending ? (
            "…"
          ) : one?.data === undefined ? (
            "—"
          ) : (
            <CellMoney minor={one.data.closing_minor} />
          )
        },
      })),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )
  const shops = stores.map((store, i): ShopRow => ({
    store,
    boxes: roles.map((_role, r) => at(i, r)),
  }))
  const table = useTable({
    features: tableSetup,
    data: shops,
    columns,
    getRowId: (row: ShopRow) => row.store.id,
  })

  return (
    <>
      {stores.length === 0 ? (
        <EmptyState>No shop is open yet.</EmptyState>
      ) : (
        <>
          {phone && (
            <PhoneFigures
              items={roles.map((role, r) => ({
                label: ROLE_TEXT[role].title,
                value: total(r),
              }))}
            />
          )}
          <Card className="overflow-clip max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
            <DataTable<ShopRow>
              table={table}
              onRowClick={(row) =>
                open("/finance/stores/cash-on-hand", row.store.id)
              }
              summary={{
                shop: `All shops · ${count(stores.length)}`,
                ...Object.fromEntries(
                  roles.map((role, r) => [role, money(total(r))])
                ),
              }}
              pageScroll
              cardSort={false}
              cardsApart
            />
          </Card>
        </>
      )}
    </>
  )
}

/// One shop, and what each of its boxes answered.
interface ShopRow {
  readonly store: ReturnType<typeof useOpenStores>["stores"][number]
  readonly boxes: readonly (
    { isPending: boolean; data?: { closing_minor: number } } | undefined
  )[]
}

// ---------------------------------------------------------------------------
// One box, one shop
// ---------------------------------------------------------------------------

export const StoresCashOnHand = () => <StoreCashPage role="cash" />
export const StoresPettyCash = () => <StoreCashPage role="petty_cash" />
export const StoresCashierFloat = () => <StoreCashPage role="cashier_float" />

function StoreCashPage({ role }: { role: Role }) {
  const text = ROLE_TEXT[role]
  return (
    <StoreFrame title={text.title}>
      {(unit, picker) => (
        <CashLedger
          key={`${unit.id}-${role}`}
          role={role}
          unitId={unit.id}
          picker={picker}
        />
      )}
    </StoreFrame>
  )
}

function CashLedger({
  role,
  unitId,
  picker,
}: {
  role: Role
  unitId: string
  picker: React.ReactNode
}) {
  const code = CODES[role]
  const months = useMemo(() => lastMonthTabs(6), [])
  const [month, setMonth] = useState(months[months.length - 1].value)
  const [view, setView] = useState<"ledger" | "weekly" | "codes">("ledger")
  const [needle, setNeedle] = useState("")
  const q = useDebounced(needle.trim(), 250)
  const range =
    months.find((one) => one.value === month) ?? months[months.length - 1]

  // The balance now is its own question: the window may be an old month.
  const now = useSuspenseQuery(storeBoxQuery(unitId, role, code, todayIso()))

  // The month and the search answer at once; the ledger trails them, and the
  // lines in hand stay (dimmed) until the next are read.
  const askedFrom = useDeferredValue(range.from)
  const askedTo = useDeferredValue(range.to)
  const askedQ = useDeferredValue(q)
  const stale = askedFrom !== range.from || askedQ !== q
  const pages = useSuspenseInfiniteQuery(
    storeBoxLedgerQuery(unitId, role, code, askedFrom, askedTo, askedQ)
  )
  const first = pages.data.pages[0]
  const rows = useMemo(
    () => pages.data.pages.flatMap((page) => page.rows),
    [pages.data]
  )

  /// The ledger of the box, oldest first as it was written. A card is the
  /// description over its entry number and the date, with what moved and the
  /// balance after it.
  const columns = useMemo<ColumnDef<TableSetup, GeneralLedgerRow>[]>(
    () => [
      {
        id: "date",
        accessorFn: (row) => row.posting_date,
        header: "Date",
        size: 120,
        enableSorting: false,
        meta: { card: "meta" },
        cell: ({ row }) => (
          <span className="text-body">{day(row.original.posting_date)}</span>
        ),
      },
      {
        id: "entry",
        accessorFn: (row) => row.entry_number,
        header: "Entry",
        size: 130,
        enableSorting: false,
        meta: { card: "id", priority: 3 },
        cell: ({ row }) => (
          <span className="font-mono text-[0.9375rem] text-mute">
            {row.original.entry_number}
          </span>
        ),
      },
      {
        id: "description",
        accessorFn: (row) => row.memo ?? row.account_name,
        header: "Description",
        size: 240,
        enableSorting: false,
        meta: { card: "title", grow: 200 },
        cell: ({ row }) => (
          <span
            className="block truncate text-ink"
            title={row.original.memo ?? row.original.account_name}
          >
            {row.original.memo ?? row.original.account_name}
          </span>
        ),
      },
      {
        id: "in",
        accessorFn: (row) => (row.debit_minor === 0 ? null : row.debit_minor),
        header: "In",
        size: 130,
        enableSorting: false,
        meta: { align: "right", card: "metric" },
        cell: ({ row }) =>
          row.original.debit_minor === 0 ? (
            <span className="text-mute">·</span>
          ) : (
            <CellMoney minor={row.original.debit_minor} />
          ),
      },
      {
        id: "out",
        accessorFn: (row) => (row.credit_minor === 0 ? null : row.credit_minor),
        header: "Out",
        size: 130,
        enableSorting: false,
        meta: { align: "right", card: "metric" },
        cell: ({ row }) =>
          row.original.credit_minor === 0 ? (
            <span className="text-mute">·</span>
          ) : (
            <CellMoney minor={row.original.credit_minor} />
          ),
      },
      {
        id: "balance",
        accessorFn: (row) => row.running_minor,
        header: "Balance",
        size: 150,
        enableSorting: false,
        meta: { align: "right", card: "metric" },
        cell: ({ row }) => (
          <span className={cn(q === "" && "text-ink")}>
            <CellMoney minor={row.original.running_minor} />
          </span>
        ),
      },
    ],
    [q]
  )
  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns,
        getRowId: (row: GeneralLedgerRow) => row.line_id,
      }),
      [rows, columns]
    )
  )

  const viewTabs = role === "petty_cash" && (
    <SubTabs
      tabs={[
        { value: "ledger", label: "Ledger" },
        { value: "weekly", label: "Spending by week" },
        { value: "codes", label: "Approval codes" },
      ]}
      value={view}
      onChange={(next) => setView(next as "ledger" | "weekly" | "codes")}
    />
  )

  return (
    <>
      {/* The month's three figures lead the ledger — the server's, over the
          whole window — and the other two views (spending, codes) have none. */}
      {view === "ledger" && (
        <KpiStrip className="grid-cols-2 md:grid-cols-3 xl:grid-cols-3">
          <div title="As of today">
            <Kpi
              label="Balance now"
              value={money(now.data?.closing_minor ?? null)}
            />
          </div>
          <Kpi
            label="In this month"
            value={money(first?.window_debit_minor ?? null)}
            delta={range.label}
            tone="flat"
          />
          <Kpi
            label="Out this month"
            value={money(first?.window_credit_minor ?? null)}
            delta={range.label}
            tone="flat"
          />
        </KpiStrip>
      )}

      {/* Petty cash's views, then the month, lead each view's toolbar. */}
      {view === "codes" ? (
        <>
          <Toolbar lead={viewTabs}>{picker}</Toolbar>
          <ExpenseCodes unitId={unitId} />
        </>
      ) : view === "weekly" ? (
        <>
          <Toolbar lead={viewTabs}>{picker}</Toolbar>
          <WeeklySpending unitId={unitId} />
        </>
      ) : (
        <>
          <Toolbar
            className="group/bar"
            lead={
              <>
                {viewTabs}
                {/* On a phone the month is one of the Filters, not a second
                    chip in the dock beside the shop's. */}
                <SubTabs
                  className="max-md:hidden"
                  tabs={months.map((one) => ({
                    value: one.value,
                    label: one.label,
                  }))}
                  value={month}
                  onChange={setMonth}
                />
              </>
            }
          >
            {picker}
            <Select
              value={month}
              onChange={setMonth}
              aria-label="Month"
              className="md:hidden"
            >
              {months.map((one) => (
                <option key={one.value} value={one.value}>
                  {one.label}
                </option>
              ))}
            </Select>
            <ExpandingSearch
              value={needle}
              onChange={setNeedle}
              label="Search the ledger"
            />
          </Toolbar>

          {rows.length === 0 ? (
            <EmptyState>
              {q !== "" ? `No line matches “${q}”.` : ROLE_TEXT[role].empty}
            </EmptyState>
          ) : (
            <div className="list-swap" aria-busy={stale || undefined}>
              <Card className="overflow-clip max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
                <DataTable<GeneralLedgerRow>
                  refresh={[pages]}
                  table={table}
                  more={pages}
                  // Where the month began: the first line is the one that
                  // follows it.
                  renderBefore={(_row, index) =>
                    index === 0 ? (
                      <div className="flex items-baseline justify-between gap-3 bg-soft px-3 py-2 text-[0.9375rem] text-mute">
                        <span>Balance at the start of {range.label}</span>
                        <span className="tabular-nums">
                          {first ? money(first.opening_minor) : "—"}
                        </span>
                      </div>
                    ) : null
                  }
                  pageScroll
                  cardSort={false}
                  cardsApart
                />
              </Card>
              <p className="mt-3 text-[0.9375rem] text-mute">
                {count(rows.length)} of {count(first?.total ?? rows.length)}{" "}
                lines
                {q !== ""
                  ? ". The balance column is the account's own, so it skips the lines the search hides."
                  : "."}{" "}
                Closing balance of {range.label}:{" "}
                {first ? money(first.closing_minor) : "—"}.
              </p>
            </div>
          )}
        </>
      )}
    </>
  )
}

function WeeklySpending({ unitId }: { unitId: string }) {
  const units = useUnits()
  const unit = (units.data ?? []).find((one) => one.id === unitId)
  if (unit === undefined)
    return <LoadingState>Reading petty cash…</LoadingState>
  return <ExpensesByWeek unit={unit} />
}
