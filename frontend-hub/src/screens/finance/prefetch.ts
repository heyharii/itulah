import type { QueryClient } from "@tanstack/react-query"

import {
  warmData,
  warmInfinite,
  warmQuery,
  type PrefetchMap,
} from "@/lib/prefetch"
import { dailyReportQuery } from "@/lib/queries/analytics"
import { cashDocumentsQuery } from "@/lib/queries/cash-documents"
import {
  accountBalancesQuery,
  accountChildrenQuery,
  accountLinksQuery,
  accrualsQuery,
  assetClassesQuery,
  assetPagesQuery,
  assetsAllQuery,
  balanceStatementQuery,
  bankStatementsQuery,
  bankRulesQuery,
  bankTotalQuery,
  cashCountsQuery,
  cashFlowStatementQuery,
  companyBankAccountsQuery,
  billTemplatesQuery,
  cogsQuery,
  contractorProjectsQuery,
  creditNotesQuery,
  dimensionResultsQuery,
  dimensionsQuery,
  edcMachinesQuery,
  expenseCategoriesQuery,
  financeSettingsQuery,
  giroBoardQueries,
  giroClearanceQueries,
  giroPrintTemplatesQuery,
  goodsInTransitQuery,
  inventoryValuationQuery,
  journalRepeatsQuery,
  journalTemplatesQuery,
  ledgerWindowQuery,
  lineCategoriesQuery,
  moneyOverviewQuery,
  openDeliveriesQuery,
  payablesAgingQuery,
  payComponentsQuery,
  paymentMethodsQuery,
  periodClosingsQuery,
  periodsQuery,
  postingReadinessQuery,
  postedBillPagesQuery,
  postingSwitchesQuery,
  projectionBillsQuery,
  projectionGirosQuery,
  projectionOrdersQuery,
  projectionTermsQuery,
  projectionUnbilledQuery,
  resultStatementQuery,
  rolePermissionsQuery,
  stockAdjustmentsQuery,
  stockVsLedgerQuery,
  storeBoxLedgerQuery,
  storeBoxQuery,
  storeCashCountsQuery,
  taxTemplatesQuery,
  taxTypesQuery,
  trialBalanceQuery,
  unassessedAssetsQuery,
} from "@/lib/queries/finance"
import {
  advanceControlQuery,
  closeReadinessQuery,
  facilitiesQuery,
  financeControlsQuery,
  principalsQuery,
  taxPeriodsQuery,
  taxReconciliationQuery,
  advancePagesQuery,
  prepaidDueQuery,
  prepaidSchedulePagesQuery,
  profitAndLossQuery,
} from "@/lib/queries/finance-domains"
import {
  expensesByMonthQuery,
  salesByDivisionQuery,
  withholdingReportQuery,
} from "@/lib/queries/finance-reports"
import { unitsQuery } from "@/lib/queries/organisation"
import { supplierNamesQuery } from "@/lib/queries/procurement"
import {
  defaultMonth,
  lastDayOf,
} from "@/screens/finance-final/reports/two-year"
import {
  dayBefore,
  defaultWindow,
  lastMonths,
  monthWindowOf,
  previousMonthOf,
  todayIso,
  yearToDate,
} from "@/screens/finance/chart"
import {
  STORE_BOX_CODES,
  chosenStoreOf,
  lastDays,
  lastMonthTabs,
  openStoresOf,
  type StoreBox,
} from "@/screens/finance/store-units"

/// What Finance asks first, before the screen is open (`lib/prefetch.ts`).
///
/// Every query warmed here is read by its screen with `useSuspenseQuery` under
/// the same options (`lib/queries/finance*.ts`), so the server's HTML carries
/// the figures and the browser's first render is the same one. A query a
/// screen reads with a plain `useQuery` (a label, a picker, a panel opened by
/// hand) is NOT warmed: the server would start it and the browser would
/// render different markup from the server's skeleton.
///
/// A screen whose state lives in the address bar or in a control (a window, a
/// unit, a filter) warms only its default: the window is worked out here the
/// way the screen works it out (`defaultWindow`, `yearToDate`).
///
/// Not here, and why: Supplier Ledger (it opens on no supplier), the BKK/BKM
/// composers (nothing to read until a supplier is chosen), Bank Transactions
/// and Bank Reconciliation Summary (a read per statement, from a list that is
/// itself a fan-out), and Supplier Bills (it draws a "no access" screen for a
/// 403 of its own, which a suspended read would hand to the route's error
/// boundary instead).
///
/// The same holds for the screens kept in `finance-final` and `finance-lab-2`.
/// Payment Entry and the Journal Entry register draw a "no access" card of
/// their own, so Payment Entry warms nothing and the Journal warms only the
/// calendar its window opens on. Cash Transactions, Card & EDC Settlement and
/// Sales Postings wait for a unit or a shop to be chosen, and Deposits reads a
/// list of lines per bank statement; for those the calendar is all there is to
/// warm. The Bank Account screen's summary strip walks every posted bill, so
/// it is left to the browser. The sidebar's count of unagreed bank lines
/// reads the statement list this file warms for Bank Reconciliation, and waits
/// for hydration for that reason (`useUnagreedLineCount`).

/// The window a report opens on: the month the books are open in, worked out
/// from the calendar the way `useSettledWindow` does, so the calendar is read
/// first and every report that opens on it asks for the same dates.
async function settledWindow(
  client: QueryClient
): Promise<{ from: string; to: string }> {
  return defaultWindow(await warmData(client, periodsQuery()))
}

/// The shop a Stores page lands on: the one in the address (`?store=`), else
/// the first open one by code. The tab's remembered shop lives in the
/// browser's `sessionStorage`, which the server cannot see; the screen follows
/// it after hydration.
async function storeOf(
  client: QueryClient,
  wanted: unknown
): Promise<ReturnType<typeof chosenStoreOf>> {
  const units = await warmData(client, unitsQuery())
  return chosenStoreOf(
    openStoresOf(units),
    typeof wanted === "string" ? wanted : null
  )
}

/// A shop's cash box page: today's balance and the current month's first page
/// of lines, as `CashLedger` asks for them.
function cashBox(role: StoreBox) {
  return async (
    client: QueryClient,
    { search }: { search: Record<string, unknown> }
  ) => {
    const unit = await storeOf(client, search.store)
    if (unit === undefined) return
    const code = STORE_BOX_CODES[role]
    const tabs = lastMonthTabs(6)
    const month = tabs[tabs.length - 1]
    await Promise.all([
      warmQuery(client, storeBoxQuery(unit.id, role, code, todayIso())),
      warmInfinite(
        client,
        storeBoxLedgerQuery(unit.id, role, code, month.from, month.to, "")
      ),
    ])
  }
}

export const prefetch: PrefetchMap = {
  // ── Setup ────────────────────────────────────────────────────────────────
  "/finance/setup/asset-classes": (client) =>
    warmQuery(client, assetClassesQuery()),
  "/finance/setup/expense-categories": (client) =>
    warmQuery(client, expenseCategoriesQuery()),
  "/finance/setup/pay-components": (client) =>
    warmQuery(client, payComponentsQuery()),
  "/finance/setup/payment-methods": (client) =>
    warmQuery(client, paymentMethodsQuery()),
  "/finance/setup/shop-payment-methods": (client) =>
    Promise.all([
      warmQuery(client, unitsQuery()),
      warmQuery(client, paymentMethodsQuery()),
      warmQuery(client, edcMachinesQuery()),
    ]),
  "/finance/setup/dimensions": (client) => warmQuery(client, dimensionsQuery()),
  "/finance/setup/journal-templates": (client) =>
    Promise.all([
      warmQuery(client, journalTemplatesQuery()),
      warmQuery(client, journalRepeatsQuery()),
    ]),
  "/finance/setup/giro-templates": (client) =>
    warmQuery(client, giroPrintTemplatesQuery()),
  "/finance/setup/periods": (client) => warmQuery(client, periodsQuery()),
  // The roles and the matrix: the same two reads whether or not a role's
  // sheet is open (`?mapping=`), which is only a panel over them.
  "/finance/setup/account-links": (client) =>
    Promise.all([
      warmQuery(client, accountLinksQuery()),
      warmQuery(client, postingReadinessQuery()),
    ]),
  "/finance/setup/posting-readiness": (client) =>
    warmQuery(client, postingReadinessQuery()),
  "/finance/tax-setup/withholding": (client) =>
    warmQuery(client, taxTemplatesQuery()),
  "/finance/tax-setup/types": (client) => warmQuery(client, taxTypesQuery()),
  "/finance/closing/period-closing-voucher": (client) =>
    warmQuery(client, periodClosingsQuery()),

  // ── Settings ─────────────────────────────────────────────────────────────
  "/finance/settings/accounts": (client) =>
    warmQuery(client, financeSettingsQuery()),
  "/finance/settings/permissions": (client) =>
    warmQuery(client, rolePermissionsQuery()),
  // It opens on its Switches tab; the other two tabs read their own lists
  // when they are opened.
  "/finance/settings/posting-policies": (client) =>
    warmQuery(client, postingSwitchesQuery()),

  // ── Cash & bank ──────────────────────────────────────────────────────────
  "/finance/cash-bank/bkk": (client) =>
    warmQuery(client, cashDocumentsQuery("PAY")),
  "/finance/cash-bank/bkm": (client) =>
    warmQuery(client, cashDocumentsQuery("RECEIVE")),
  "/finance/cash-bank/giro": (client) =>
    Promise.all(giroBoardQueries().map((one) => warmQuery(client, one))),
  "/finance/cash-bank/bank-clearance": (client) =>
    Promise.all(
      giroClearanceQueries(false).map((one) => warmQuery(client, one))
    ),
  "/finance/cash-bank/bank-rules": (client) =>
    warmQuery(client, bankRulesQuery(false)),

  // ── Payables ─────────────────────────────────────────────────────────────
  "/finance/payables/recurring-bills": (client) =>
    warmQuery(client, billTemplatesQuery()),
  "/finance/payables/accruals": (client) => warmQuery(client, accrualsQuery()),
  "/finance/payables/credit-notes": (client) =>
    warmQuery(client, creditNotesQuery()),
  // Every read the projection draws from, for all units (a chosen unit is a
  // control, not the address).
  "/finance/payables/projection": (client) =>
    Promise.all([
      warmQuery(client, unitsQuery()),
      warmQuery(client, projectionBillsQuery("POSTED")),
      warmQuery(client, projectionBillsQuery("DRAFT")),
      warmQuery(client, projectionGirosQuery()),
      warmQuery(client, billTemplatesQuery()),
      warmQuery(client, projectionUnbilledQuery()),
      warmQuery(client, projectionOrdersQuery()),
      warmQuery(client, supplierNamesQuery()),
      warmQuery(client, projectionTermsQuery()),
    ]),

  // ── Assets ───────────────────────────────────────────────────────────────
  "/finance/assets/contractor-projects": (client) =>
    warmQuery(client, contractorProjectsQuery()),
  // The register opens on its not-assessed rows first (`sort=treatment`), and
  // says how many there are.
  "/finance/assets/capitalization": (client) =>
    Promise.all([
      warmInfinite(client, assetPagesQuery("", { sort: "treatment" })),
      warmQuery(client, unassessedAssetsQuery("")),
    ]),

  // ── Accounting ───────────────────────────────────────────────────────────
  // The eight roots and their balances; a heading is read when it is opened.
  "/finance/accounting/chart-of-accounts": (client) =>
    Promise.all([
      warmQuery(client, accountChildrenQuery(null, false)),
      warmQuery(client, accountBalancesQuery(null, null)),
    ]),

  // ── Dashboards ───────────────────────────────────────────────────────────
  // The Overview's sections each read their own figures: twelve month-ends of
  // the bank, twelve months of profit and loss, the ageing, the stock and the
  // lists behind the payables.
  "/finance/dashboard": (client) => {
    const today = todayIso()
    const months = lastMonths(12, today)
    return Promise.all([
      ...months.map((one) => warmQuery(client, bankTotalQuery(one.to))),
      ...months.map((one) =>
        warmQuery(client, profitAndLossQuery(one.from, one.to))
      ),
      warmQuery(client, payablesAgingQuery(today)),
      warmQuery(client, stockVsLedgerQuery()),
      warmQuery(client, goodsInTransitQuery()),
      warmQuery(client, supplierNamesQuery()),
      warmQuery(client, projectionBillsQuery("POSTED")),
      warmQuery(client, openDeliveriesQuery(today)),
      warmQuery(client, projectionGirosQuery()),
    ])
  },
  "/finance/payments-dashboard": (client) => {
    const today = todayIso()
    const months = lastMonths(12, today)
    const recent = months.slice(-2)
    return Promise.all([
      ...months.map((one) => warmQuery(client, bankTotalQuery(one.to))),
      ...recent.map((one) =>
        warmQuery(client, profitAndLossQuery(one.from, one.to))
      ),
      warmQuery(client, payablesAgingQuery(today)),
    ])
  },

  // ── Inventory ────────────────────────────────────────────────────────────
  "/finance/inventory/valuation": (client) =>
    warmQuery(client, inventoryValuationQuery(null)),
  "/finance/inventory/stock-vs-ledger": (client) =>
    warmQuery(client, stockVsLedgerQuery()),
  "/finance/inventory/goods-in-transit": (client) =>
    warmQuery(client, goodsInTransitQuery()),
  "/finance/inventory/cogs": (client) =>
    warmQuery(client, cogsQuery(new Date().getFullYear())),
  "/finance/inventory/adjustments": (client) =>
    warmQuery(client, stockAdjustmentsQuery()),

  // ── Stores ───────────────────────────────────────────────────────────────
  // Every open shop and what its three cash boxes hold today.
  "/finance/stores": async (client) => {
    const units = await warmData(client, unitsQuery())
    const today = todayIso()
    const roles = Object.keys(STORE_BOX_CODES) as StoreBox[]
    await Promise.all(
      openStoresOf(units).flatMap((store) =>
        roles.map((role) =>
          warmQuery(
            client,
            storeBoxQuery(store.id, role, STORE_BOX_CODES[role], today)
          )
        )
      )
    )
  },
  // The fourteen days of the rail, for the shop's first till.
  "/finance/stores/sales": async (client, { search }) => {
    const unit = await storeOf(client, search.store)
    const siteId = unit?.sites[0]?.id ?? ""
    if (siteId === "") return
    await Promise.all(
      lastDays(14).map((date) =>
        warmQuery(client, dailyReportQuery(siteId, date))
      )
    )
  },
  "/finance/stores/cash-on-hand": cashBox("cash"),
  "/finance/stores/petty-cash": cashBox("petty_cash"),
  "/finance/stores/cashier-float": cashBox("cashier_float"),
  // Cash counts have their own picker, not the address: the first shop.
  "/finance/stores/cash-counts": async (client) => {
    const unit = await storeOf(client, null)
    if (unit === undefined) return
    await warmQuery(client, storeCashCountsQuery(unit.id))
  },

  // ── Reports ──────────────────────────────────────────────────────────────
  // The window is the month the books are open in, so the calendar comes
  // first; the dimension is the first one defined.
  "/finance/reports/dimension-results": async (client) => {
    const [periods, dimensions] = await Promise.all([
      warmData(client, periodsQuery()),
      warmData(client, dimensionsQuery()),
    ])
    const dimension = dimensions[0]?.code
    if (dimension === undefined) return
    const { from, to } = defaultWindow(periods)
    await warmQuery(client, dimensionResultsQuery(dimension, from, to))
  },
  "/finance/reports/sales-by-division": (client) => {
    const { from, to } = yearToDate()
    return warmQuery(client, salesByDivisionQuery(from, to))
  },
  "/finance/reports/expenses-by-month": (client) => {
    const { from, to } = yearToDate()
    return warmQuery(client, expensesByMonthQuery(from, to))
  },
  "/finance/reports/changes-in-equity": (client) => {
    const { from, to } = yearToDate()
    return Promise.all([
      warmQuery(client, balanceStatementQuery(dayBefore(from))),
      warmQuery(client, balanceStatementQuery(to)),
      warmQuery(client, resultStatementQuery(from, to)),
    ])
  },
  // Last month: the one being filed.
  "/finance/reports/tax-withholding": (client) => {
    const { from, to } = monthWindowOf(previousMonthOf())
    return warmQuery(client, withholdingReportQuery(from, to))
  },
  "/finance/reports/asset-register": (client) =>
    warmQuery(client, assetsAllQuery("CAPITALIZE", null)),
  "/finance/reports/asset-disposals": (client) =>
    warmQuery(client, assetsAllQuery(null, "DISPOSED")),

  // ── The screens kept in finance-final and finance-lab-2 ───────────────────

  // ── Accounting ───────────────────────────────────────────────────────────
  // The books at the day before the window opens and at the day it closes,
  // for every unit.
  "/finance/accounting/trial-balance": async (client) => {
    const { from, to } = await settledWindow(client)
    await Promise.all([
      warmQuery(client, trialBalanceQuery(dayBefore(from))),
      warmQuery(client, trialBalanceQuery(to)),
    ])
  },
  // The ledger itself is read once an account is chosen (`?account=`), so only
  // the calendar the window opens on is warmed.
  "/finance/accounting/general-ledger": (client) =>
    warmQuery(client, periodsQuery()),

  // ── Financial reports ────────────────────────────────────────────────────
  // Yearly columns, each the position at that year's last day (the window's
  // end for the year in progress). `periodsOf` lives with the report's parts,
  // which draw charts, so it is loaded only here and not with this module.
  "/finance/reports/balance-sheet": async (client) => {
    const { from, to } = await settledWindow(client)
    const { periodsOf } = await import("@/screens/finance/report")
    const periods = periodsOf(from, to, "Yearly", true)
    // More columns than the table draws shows the last one alone.
    const columns = periods.length > 24 ? periods.slice(-1) : periods
    await Promise.all(
      columns.map((period) =>
        warmQuery(client, balanceStatementQuery(period.to))
      )
    )
  },
  // This year-end and last year-end of the month the year is read up to.
  "/finance/reports/balance-sheet-2-years": async (client) => {
    const year = new Date().getFullYear()
    const month = defaultMonth(year)
    await Promise.all([
      warmQuery(client, balanceStatementQuery(lastDayOf(year, month))),
      warmQuery(client, balanceStatementQuery(lastDayOf(year - 1, month))),
    ])
  },
  // The whole window and, when it spans more than one year, each year of it.
  "/finance/reports/profit-and-loss": async (client) => {
    const { from, to } = await settledWindow(client)
    const { periodsOf } = await import("@/screens/finance/report")
    const periods = periodsOf(from, to, "Yearly", false)
    const columns = periods.length <= 1 ? [] : periods
    await Promise.all([
      warmQuery(client, resultStatementQuery(from, to)),
      ...(columns.length > 24 ? [] : columns).map((period) =>
        warmQuery(client, resultStatementQuery(period.from, period.to))
      ),
    ])
  },
  // January to the month the year is read up to, against the year before.
  "/finance/reports/profit-and-loss-by-unit": async (client) => {
    const year = new Date().getFullYear()
    const month = defaultMonth(year)
    await Promise.all([
      warmQuery(
        client,
        resultStatementQuery(`${year}-01-01`, lastDayOf(year, month))
      ),
      warmQuery(
        client,
        resultStatementQuery(`${year - 1}-01-01`, lastDayOf(year - 1, month))
      ),
    ])
  },
  "/finance/reports/cash-flow": async (client) => {
    const { from, to } = await settledWindow(client)
    await warmQuery(client, cashFlowStatementQuery(from, to))
  },
  // The money, every count, and the units that own the counted sites.
  "/finance/reports/cash-bank": (client) =>
    Promise.all([
      warmQuery(client, moneyOverviewQuery()),
      warmQuery(client, cashCountsQuery()),
      warmQuery(client, unitsQuery()),
    ]),

  // ── Payables ─────────────────────────────────────────────────────────────
  // The ageing as at today, the register of posted bills under it, and the
  // deliveries no bill covers yet.
  "/finance/payables/aging": (client) => {
    const today = todayIso()
    return Promise.all([
      warmQuery(client, payablesAgingQuery(today)),
      warmInfinite(client, postedBillPagesQuery("")),
      warmQuery(client, openDeliveriesQuery(today)),
    ])
  },
  "/finance/reports/accounts-payable-summary": (client) =>
    warmQuery(client, payablesAgingQuery(todayIso())),

  // ── Receivables ──────────────────────────────────────────────────────────
  // What every receivable account holds today, for all units, and the card
  // settlement accounts under it. The account list is the screen's own.
  "/finance/receivables/aging": async (client) => {
    const today = todayIso()
    const { RECEIVABLE_CODES } =
      await import("@/screens/finance-final/receivable")
    await Promise.all([
      ...RECEIVABLE_CODES.map((code) =>
        warmQuery(client, ledgerWindowQuery(code, null, today, today))
      ),
      warmQuery(client, moneyOverviewQuery(null, today)),
    ])
  },

  // The window is the month the books are open in; every account the four
  // families read, for all units. The account list is the screen's own.
  "/finance/accounting/accruals": async (client) => {
    const { from, to } = await settledWindow(client)
    const { FAMILY_ACCOUNT_CODES } =
      await import("@/screens/finance-final/prepaids")
    await Promise.all(
      FAMILY_ACCOUNT_CODES.map((code) =>
        warmQuery(client, ledgerWindowQuery(code, null, from, to))
      )
    )
  },

  // It opens on the Active tab, with the schedules waiting in this month
  // counted beside them.
  "/finance/accounting/prepaids": (client) =>
    Promise.all([
      warmInfinite(client, prepaidSchedulePagesQuery("ACTIVE")),
      warmQuery(client, prepaidDueQuery("ACTIVE", todayIso().slice(0, 7))),
    ]),

  // Cash & bank. Cash Transactions and Deposits wait for a unit (the first) or
  // fan out a read per bank statement (the second), so only the calendar the
  // window opens on is warmed for them. Petty cash adds the money the units
  // hold, for all units; its shop-side book is the node's own and is not read
  // here.
  "/finance/cash-bank/cash-transactions": (client) =>
    warmQuery(client, periodsQuery()),
  "/finance/cash-bank/deposits": (client) => warmQuery(client, periodsQuery()),
  "/finance/cash-bank/petty-cash": (client) =>
    Promise.all([
      warmQuery(client, periodsQuery()),
      warmQuery(client, moneyOverviewQuery()),
    ]),

  // The bank accounts the chart keeps money in, and what each holds. The
  // summary strip above them also reads every posted bill, which is a long
  // walk, so those two reads are left to the browser.
  "/finance/cash-bank/bank-accounts": (client) =>
    Promise.all([
      warmQuery(client, moneyOverviewQuery()),
      warmQuery(client, companyBankAccountsQuery()),
    ]),

  // The list of accounts; with a statement in the address the matcher opens
  // instead, and reads its own lines.
  "/finance/cash-bank/bank-reconciliation": (client, { search }) => {
    if (search.statement !== undefined) return
    return Promise.all([
      warmQuery(client, bankStatementsQuery()),
      warmQuery(client, moneyOverviewQuery()),
      warmQuery(client, companyBankAccountsQuery()),
    ])
  },

  // Every status, and the ledger's side of the same book.
  "/finance/receivables/employee": (client) =>
    Promise.all([
      warmInfinite(client, advancePagesQuery(undefined)),
      warmQuery(client, advanceControlQuery()),
    ]),

  // The loans and the owners: the screen counts both before it draws either.
  "/finance/financing/loans": (client) =>
    Promise.all([
      warmQuery(client, facilitiesQuery()),
      warmQuery(client, principalsQuery()),
    ]),
  // The periods and what the ledger says against them. The tax filter's
  // options are a label read and are left to the browser.
  "/finance/tax/payables": (client) =>
    Promise.all([
      warmQuery(client, taxPeriodsQuery()),
      warmQuery(client, taxReconciliationQuery()),
    ]),
  // The checklist is for the month the books are in now.
  "/finance/period-close": (client) => {
    const now = new Date()
    return Promise.all([
      warmQuery(client, financeControlsQuery()),
      warmQuery(
        client,
        closeReadinessQuery(now.getFullYear(), now.getMonth() + 1)
      ),
    ])
  },

  // The categories, the asset classes beside them, and the accounts that ask
  // for each family: the first level under each of the eight roots, the same
  // reads the Chart of Accounts makes.
  "/finance/setup/line-categories": (client) =>
    Promise.all([
      warmQuery(client, lineCategoriesQuery()),
      warmQuery(client, assetClassesQuery()),
      ...["1", "2", "3", "4", "5", "6", "7", "8"].map((root) =>
        warmQuery(client, accountChildrenQuery(root, false))
      ),
    ]),

  // The register itself answers a refusal with a card of its own, which a
  // suspended read would hand to the error page instead; only the calendar the
  // window opens on is warmed.
  "/finance/accounting/journal-entries": (client) =>
    warmQuery(client, periodsQuery()),

  // Everything on Card & EDC Settlement waits for a shop to be chosen; only
  // the calendar the window opens on is warmed.
  "/finance/receivables/card-settlement": (client) =>
    warmQuery(client, periodsQuery()),
}
