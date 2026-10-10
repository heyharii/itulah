import { useInfiniteQuery, useQueries } from "@tanstack/react-query"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Input, Select } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Toolbar } from "@/components/ui/segmented"
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states"
import { SubTabs } from "@/components/ui/sub-tabs"
import { count, dateText, day, money } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import { accountLedger, financeKeys } from "@/lib/queries/finance"
import { useUnits } from "@/lib/queries/organisation"
import { useDebounced } from "@/lib/use-debounced"
import { cn } from "@/lib/utils"
import {
  Grid,
  NumberCard,
  Td,
  Th,
  TotalRow,
} from "@/screens/finance-final/parts"
import { isoDay, todayIso } from "@/screens/finance/chart"
import { ExpenseCodes } from "@/screens/finance/expense-codes"
import { CardFigure, PhoneList } from "@/components/ui/phone-cards"
import { PhoneFigures } from "@/screens/finance/parts"
import { ExpensesByWeek } from "@/screens/finance/stores"
import {
  StoreFrame,
  useOpenStore,
  useOpenStores,
} from "@/screens/finance/stores-frame"

/// Finance › Stores › Cash on hand, Petty cash, Cashier float (owner,
/// 2026-10-01). Cash takings land in the shop's Cash on hand; card and QRIS
/// go to the bank. Petty cash and the cashier's float are the shop's other two
/// cash boxes, each its own account.

type Role = "cash" | "petty_cash" | "cashier_float"

/// The account roles' codes in the client's chart (1002 CASH ON HAND, 1003
/// PETTY CASH, 1004 MODAL KASIR). The ledger is asked by code.
const CODES: Record<Role, string> = {
  cash: "1002",
  petty_cash: "1003",
  cashier_float: "1004",
}

const ROLE_TEXT: Record<Role, { title: string; sub: string; empty: string }> = {
  cash: {
    title: "Cash on hand",
    sub: "Cash the shop holds: till takings less what was banked or spent.",
    empty: "Nothing moved in Cash on hand this month.",
  },
  petty_cash: {
    title: "Petty cash",
    sub: "The shop's small-spending box: top-ups in, expenses out.",
    empty: "Nothing moved in Petty cash this month.",
  },
  cashier_float: {
    title: "Cashier float",
    sub: "The float left in each till for change.",
    empty: "Nothing moved in the Cashier float this month.",
  },
}

// ---------------------------------------------------------------------------
// Overview: every shop, three boxes
// ---------------------------------------------------------------------------

export function StoresOverview() {
  const { units, stores } = useOpenStores()
  const open = useOpenStore()
  const today = todayIso()
  const roles: Role[] = ["cash", "petty_cash", "cashier_float"]
  const phone = useLayout() === "phone"
  const balances = useQueries({
    queries: stores.flatMap((store) =>
      roles.map((role) => ({
        queryKey: [
          ...financeKeys.all,
          "store-box",
          store.id,
          role,
          today,
        ] as const,
        queryFn: ({ signal }: { signal: AbortSignal }) =>
          accountLedger(
            CODES[role],
            { unit: store.id, from: today, to: today, limit: 1 },
            signal
          ),
        staleTime: 60_000,
      }))
    ),
  })
  const at = (storeIndex: number, roleIndex: number) =>
    balances[storeIndex * roles.length + roleIndex]
  const total = (roleIndex: number) =>
    stores.reduce(
      (sum, _store, i) => sum + (at(i, roleIndex)?.data?.closing_minor ?? 0),
      0
    )

  return (
    <PageContent>
      <PageHeader
        className="max-md:hidden"
        crumb="Finance"
        title="Stores"
        sub="The cash each shop holds today: on hand, in petty cash and in the cashier float."
      />
      {units.isPending ? (
        <LoadingState>Reading the shops…</LoadingState>
      ) : units.isError ? (
        <ErrorState error={units.error} />
      ) : stores.length === 0 ? (
        <EmptyState>No shop is open yet.</EmptyState>
      ) : (
        <>
          {phone ? (
            <>
              <PhoneFigures
                items={roles.map((role, r) => ({
                  label: ROLE_TEXT[role].title,
                  value: total(r),
                }))}
              />
              <PhoneList
                rows={stores.map((store, i) => {
                  const box = (r: number) =>
                    at(i, r)?.isPending
                      ? "…"
                      : at(i, r)?.data === undefined
                        ? "—"
                        : money(at(i, r)?.data?.closing_minor ?? 0)
                  return {
                    key: store.id,
                    title: store.name,
                    code: store.code,
                    lead: <CardFigure value={box(0)} caption="cash on hand" />,
                    foot: (
                      <span className="tabular-nums">
                        Petty cash {box(1)} · Float {box(2)}
                      </span>
                    ),
                    onOpen: () =>
                      open("/finance/stores/cash-on-hand", store.id),
                  }
                })}
              />
            </>
          ) : (
            <Grid>
              <thead>
                <tr>
                  <Th>Shop</Th>
                  <Th align="right" width="12rem">
                    Cash on hand
                  </Th>
                  <Th align="right" width="12rem">
                    Petty cash
                  </Th>
                  <Th align="right" width="12rem">
                    Cashier float
                  </Th>
                </tr>
              </thead>
              <tbody>
                {stores.map((store, i) => (
                  <tr
                    key={store.id}
                    className="cursor-pointer"
                    onClick={() =>
                      open("/finance/stores/cash-on-hand", store.id)
                    }
                  >
                    <Td className="max-w-0">
                      <span className="block truncate text-ink">
                        {store.name}
                      </span>
                      <span className="block font-mono text-[0.875rem] text-mute">
                        {store.code}
                      </span>
                    </Td>
                    {roles.map((role, r) => {
                      const one = at(i, r)
                      return (
                        <Td key={role} align="right">
                          {one?.isPending
                            ? "…"
                            : one?.data === undefined
                              ? "—"
                              : money(one.data.closing_minor)}
                        </Td>
                      )
                    })}
                  </tr>
                ))}
                <TotalRow>
                  <Td>All shops · {count(stores.length)}</Td>
                  {roles.map((role, r) => (
                    <Td key={role} align="right">
                      {money(total(r))}
                    </Td>
                  ))}
                </TotalRow>
              </tbody>
            </Grid>
          )}
          <p className="mt-3 text-[0.875rem] text-mute">
            Balances as of today. Cash takings go to the shop's Cash on hand;
            card and QRIS takings go to the bank.
          </p>
        </>
      )}
    </PageContent>
  )
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
    <StoreFrame title={text.title} sub={text.sub}>
      {(unit) => (
        <CashLedger key={`${unit.id}-${role}`} role={role} unitId={unit.id} />
      )}
    </StoreFrame>
  )
}

/// The last six months, newest last; each a tab.
function lastMonths(n: number) {
  const now = new Date()
  const months: { value: string; label: string; from: string; to: string }[] =
    []
  for (let back = n - 1; back >= 0; back -= 1) {
    const first = new Date(now.getFullYear(), now.getMonth() - back, 1)
    const last = new Date(first.getFullYear(), first.getMonth() + 1, 0)
    months.push({
      value: isoDay(first).slice(0, 7),
      label: dateText(first, { month: "short", year: "numeric" }),
      from: isoDay(first),
      to: isoDay(last),
    })
  }
  return months
}

const PAGE = 100

function CashLedger({ role, unitId }: { role: Role; unitId: string }) {
  const code = CODES[role]
  const months = useMemo(() => lastMonths(6), [])
  const [month, setMonth] = useState(months[months.length - 1].value)
  const [view, setView] = useState<"ledger" | "weekly" | "codes">("ledger")
  const [needle, setNeedle] = useState("")
  const q = useDebounced(needle.trim(), 250)
  const range =
    months.find((one) => one.value === month) ?? months[months.length - 1]
  const phone = useLayout() === "phone"

  // The balance now is its own question: the window may be an old month.
  const now = useQueries({
    queries: [
      {
        queryKey: [
          ...financeKeys.all,
          "store-box",
          unitId,
          role,
          todayIso(),
        ] as const,
        queryFn: ({ signal }: { signal: AbortSignal }) =>
          accountLedger(
            code,
            { unit: unitId, from: todayIso(), to: todayIso(), limit: 1 },
            signal
          ),
        staleTime: 60_000,
      },
    ],
  })[0]

  const pages = useInfiniteQuery({
    queryKey: [
      ...financeKeys.all,
      "store-box-ledger",
      unitId,
      role,
      range.from,
      range.to,
      q,
    ],
    queryFn: ({ pageParam, signal }) =>
      accountLedger(
        code,
        {
          unit: unitId,
          from: range.from,
          to: range.to,
          q: q === "" ? undefined : q,
          limit: PAGE,
          cursor: pageParam,
        },
        signal
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    placeholderData: (previous) => previous,
  })
  const first = pages.data?.pages[0]
  const rows = useMemo(
    () => pages.data?.pages.flatMap((page) => page.rows) ?? [],
    [pages.data]
  )

  return (
    <>
      {role === "petty_cash" && (
        <SubTabs
          className="mb-4"
          tabs={[
            { value: "ledger", label: "Ledger" },
            { value: "weekly", label: "Spending by week" },
            { value: "codes", label: "Approval codes" },
          ]}
          value={view}
          onChange={(next) => setView(next as "ledger" | "weekly" | "codes")}
        />
      )}

      {view === "codes" ? (
        <ExpenseCodes unitId={unitId} />
      ) : view === "weekly" ? (
        <WeeklySpending unitId={unitId} />
      ) : (
        <>
          <PhoneFigures
            items={[
              { label: "Balance now", value: now.data?.closing_minor ?? null },
              {
                label: "In this month",
                value: first?.window_debit_minor ?? null,
              },
              {
                label: "Out this month",
                value: first?.window_credit_minor ?? null,
              },
            ]}
          />
          <div className="mb-4 grid grid-cols-1 gap-3 max-md:hidden sm:grid-cols-3">
            <NumberCard
              label="Balance now"
              value={now.data?.closing_minor ?? null}
              note="As of today"
            />
            <NumberCard
              label="In this month"
              value={first?.window_debit_minor ?? null}
              note={range.label}
            />
            <NumberCard
              label="Out this month"
              value={first?.window_credit_minor ?? null}
              note={range.label}
            />
          </div>

          {/* On a phone the month is one of the Filters, not a second chip in
              the dock beside the shop's. */}
          <SubTabs
            className="max-md:hidden"
            tabs={months.map((one) => ({ value: one.value, label: one.label }))}
            value={month}
            onChange={setMonth}
          />
          <Toolbar className="mt-4">
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
            <Input
              value={needle}
              onChange={(event) => setNeedle(event.target.value)}
              aria-label="Search the ledger"
              placeholder="Search the ledger"
              className="w-72"
            />
          </Toolbar>

          {pages.isPending ? (
            <LoadingState>Reading the ledger…</LoadingState>
          ) : pages.isError ? (
            <ErrorState error={pages.error} />
          ) : rows.length === 0 ? (
            <EmptyState>
              {q !== "" ? `No line matches “${q}”.` : ROLE_TEXT[role].empty}
            </EmptyState>
          ) : (
            <>
              {phone ? (
                <>
                  <p className="mb-2.5 text-[0.875rem] text-mute tabular-nums">
                    Balance at the start of {range.label}:{" "}
                    {first ? money(first.opening_minor) : "—"}
                  </p>
                  <PhoneList
                    rows={rows.map((row) => {
                      const incoming = row.debit_minor !== 0
                      return {
                        key: row.line_id,
                        title: row.memo ?? row.account_name,
                        code: row.entry_number,
                        lead: (
                          <CardFigure
                            value={money(
                              incoming ? row.debit_minor : row.credit_minor
                            )}
                            caption={incoming ? "in" : "out"}
                          />
                        ),
                        foot: (
                          <span className="tabular-nums">
                            {day(row.posting_date)} · Balance{" "}
                            {money(row.running_minor)}
                          </span>
                        ),
                      }
                    })}
                  />
                </>
              ) : (
                <Grid>
                  <thead>
                    <tr>
                      <Th width="8rem">Date</Th>
                      <Th width="9rem">Entry</Th>
                      <Th>Description</Th>
                      <Th align="right" width="10rem">
                        In
                      </Th>
                      <Th align="right" width="10rem">
                        Out
                      </Th>
                      <Th align="right" width="11rem">
                        Balance
                      </Th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr data-total className="h-12">
                      <Td colSpan={5} className="text-mute">
                        Balance at the start of {range.label}
                      </Td>
                      <Td align="right" className="text-mute">
                        {first ? money(first.opening_minor) : "—"}
                      </Td>
                    </tr>
                    {rows.map((row) => (
                      <tr key={row.line_id}>
                        <Td className="text-body">{day(row.posting_date)}</Td>
                        <Td className="font-mono text-[0.875rem] text-mute">
                          {row.entry_number}
                        </Td>
                        <Td className="max-w-0">
                          <span
                            className="block truncate text-ink"
                            title={row.memo ?? row.account_name}
                          >
                            {row.memo ?? row.account_name}
                          </span>
                        </Td>
                        <Td align="right">
                          {row.debit_minor === 0 ? (
                            <span className="text-mute">·</span>
                          ) : (
                            money(row.debit_minor)
                          )}
                        </Td>
                        <Td align="right">
                          {row.credit_minor === 0 ? (
                            <span className="text-mute">·</span>
                          ) : (
                            money(row.credit_minor)
                          )}
                        </Td>
                        <Td
                          align="right"
                          className={cn(q === "" && "text-ink")}
                        >
                          {money(row.running_minor)}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Grid>
              )}
              {pages.hasNextPage && (
                <div className="mt-3">
                  <Button
                    variant="ghost"
                    disabled={pages.isFetchingNextPage}
                    onClick={() => void pages.fetchNextPage()}
                  >
                    {pages.isFetchingNextPage ? "Loading…" : "Show more lines"}
                  </Button>
                </div>
              )}
              <p className="mt-3 text-[0.875rem] text-mute">
                {count(rows.length)} of {count(first?.total ?? rows.length)}{" "}
                lines
                {q !== ""
                  ? ". The balance column is the account's own, so it skips the lines the search hides."
                  : "."}{" "}
                Closing balance of {range.label}:{" "}
                {first ? money(first.closing_minor) : "—"}.
              </p>
            </>
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
