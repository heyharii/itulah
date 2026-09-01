import { AllotmentDraft } from "@/components/allotment/allotment-draft"
import { AllotmentsView } from "@/components/allotment/allotments-view"
import { ChatView } from "@/components/chat/chat-view"
import { FleetView } from "@/components/commercial/fleet-view"
import { BookComposer } from "@/components/commercial/book-composer"
import { PriceBooksView } from "@/components/commercial/price-books-view"
import { AccountMapScreen } from "@/components/finance/account-map"
import { ChartOfAccounts } from "@/components/finance/chart-of-accounts"
import { GeneralLedgerScreen } from "@/components/finance/general-ledger"
import { JournalScreen } from "@/components/finance/journal"
import { FinanceOverview } from "@/components/finance/overview"
import { PeriodsScreen } from "@/components/finance/periods"
import { AssetRegisterScreen } from "@/components/finance/asset-register"
import { BankReconciliationScreen } from "@/components/finance/bank-reconciliation"
import { PositionScreen } from "@/components/finance/position"
import { StatementScreen } from "@/components/finance/statement"
import { SupplierBillsScreen } from "@/components/finance/supplier-bills"
import { TrialBalanceScreen } from "@/components/finance/trial-balance"
import { PricesView } from "@/components/commercial/prices-view"
import { SimulateView } from "@/components/commercial/simulate-view"
import {
  DiscussionsView,
  type DiscussionSearch,
} from "@/components/discussion/discussions-view"
import { ThreadView } from "@/components/discussion/thread-view"
import { FilesView } from "@/components/files/files-view"
import { AttendancePolicyView } from "@/components/people/attendance-policy-view"
import { PeopleView } from "@/components/people/people-view"
import { PoDraft } from "@/components/po/po-draft"
import { PriceAmendmentsView } from "@/components/po/price-amendments-view"
import { PurchaseOrdersView } from "@/components/po/purchase-orders-view"
import { SalesView, type SalesSearch } from "@/components/sales/sales-view"
import { BasketView } from "@/components/sourcing/basket-view"
import { GlobalSheets } from "@/components/sheets/global-sheets"
import { SourcingView } from "@/components/sourcing/sourcing-view"
import { validateSheetSearch } from "@/lib/sheets/params"
import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  redirect,
} from "@tanstack/react-router"

/// Where the buyer is, in the URL rather than in a variable.
///
/// This replaced a `useState` discriminated union in a `Workspace` component,
/// and the difference is not tidiness. A draft purchase order could not be
/// linked to, could not survive a reload, and the browser's back button left
/// the app entirely — three things a person reasonably expects of a screen
/// they are half way through filling in.
///
/// Routes are code-based rather than file-based: six routes do not need a
/// codegen step, and keeping the tree in one readable file is worth more here
/// than the convention.
/// Which sheet is open is a search parameter, and it is declared here so that
/// it is legal on every route below.
///
/// TanStack Router merges the validated search of every matched route, so a key
/// the root claims survives on all sixty-seven of them, and a route with its own
/// `validateSearch` — sales, discussions, the ledger — adds to this rather than
/// replacing it. See `lib/sheets/params.ts` for the registry.
const rootRoute = createRootRoute({
  validateSearch: validateSheetSearch,
  // The screen, and whatever is open over it. `GlobalSheets` is mounted here
  // rather than inside `AppShell` because it has to outlive the screens: the
  // basket and the inbox are opened in the middle of doing something else, and
  // a mount point that unmounted on a route change would be the route change
  // they exist to avoid.
  component: () => (
    <>
      <Outlet />
      <GlobalSheets />
    </>
  ),
})

const sourcingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: SourcingView,
})

const basketRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/basket",
  component: BasketView,
})

const ordersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/orders",
  component: PurchaseOrdersView,
})

/// The draft names only its supplier, and reads the quantities from the basket
/// when it opens.
///
/// Deliberately not "the lines I was handed at the moment I was opened": a
/// route that carried a snapshot of the basket could be reloaded into a draft
/// that disagreed with the basket it came from. Naming the supplier and reading
/// the rest means the link stays honest whenever it is followed.
const draftRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/orders/new/$supplierId",
  component: PoDraft,
})

/// One order used to be a screen. It is a sheet over the list now, and this
/// stays as a redirect into it.
///
/// Kept rather than deleted because the address is out in the world — in
/// bookmarks, in conversations, in messages a warehouse sent about a delivery
/// — and a link that worked last week should not answer with a blank page. It
/// resolves before anything renders, so a follower lands on the list with the
/// order already open, which is the same place the old route took them.
const orderRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/orders/$purchaseOrderId",
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/orders",
      search: { order: params.purchaseOrderId },
    })
  },
})

/// What the centre has promised out of its own warehouses.
///
/// `/allotments/new` sits above `/allotments/$allotmentId` in the tree only for
/// reading; the router ranks a static segment over a dynamic one itself, so
/// "new" is a screen and never an id.
const allotmentsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/allotments",
  component: AllotmentsView,
})

const allotmentDraftRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/allotments/new",
  component: AllotmentDraft,
})

/// An allotment used to be a screen. Redirected into the sheet for the reason
/// the order route is: the address is out in the world and should keep working.
const allotmentRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/allotments/$allotmentId",
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/allotments",
      search: { allotment: params.allotmentId },
    })
  },
})

const amendmentsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/amendments",
  component: PriceAmendmentsView,
})

/// What the shops are charging, and the books that decided it.
///
/// Two screens rather than one, because they answer questions asked by
/// different people on different days: "what is Bandung selling this shirt for"
/// is a daily question with a shop and an instant in it, and "has last week's
/// repricing gone out" is asked once and needs the fleet, not one branch.
///
/// `/commercial` is the priced range because that is the one people open
/// without being sent — the books are where you go when a price is wrong.
const pricesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/commercial",
  component: PricesView,
})

const priceBooksRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/commercial/books",
  component: PriceBooksView,
})

/// Write one. A book is a list of changes rather than a catalogue, so this
/// screen asks for changes and nothing else — a price, a markdown, a promotion,
/// a coupon, a campaign — and saves them as a DRAFT. Sending it to thirty tills
/// is the second decision, made on the shelf behind it.
///
/// Declared before `/commercial/books/$publicationId` so "new" is a screen and
/// not read as the id of a book nobody has.
const bookComposerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/commercial/books/new",
  component: BookComposer,
})

/// One book, whole. A published book is immutable, so this is the only record
/// of what it said — and until it existed there was none.
/// A book used to be a screen. Redirected into the sheet for the reason the
/// order route is: the address is out in the world and should keep working.
const priceBookRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/commercial/books/$publicationId",
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/commercial/books",
      search: { book: params.publicationId },
    })
  },
})

/// Who is charging what, out there. The counterpart to `/commercial`: that one
/// asks what one shop charges, this one asks whether the fleet has caught up.
const fleetRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/commercial/fleet",
  component: FleetView,
})

/// Price a basket nobody is buying, and read why each promotion did or did not
/// come off. A write in shape only: nothing is sold and nothing is counted.
const simulateRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/commercial/simulate",
  component: SimulateView,
})

/// Talking, which is two things and not one.
///
/// A CONVERSATION is between people: ordered, private to its participants,
/// unread against a position. A DISCUSSION hangs off a record and everybody
/// signed in may read it, because an argument about a purchase order is
/// business record rather than correspondence. They are separate routes for
/// the same reason they are separate tables.
///
/// `/chat` and `/chat/$conversationId` are one component. On a wide screen the
/// list and the thread sit side by side and the id only says which row is
/// selected; on a phone they take turns. Either way the conversation is in the
/// URL, so it can be linked to and survives a reload.
const chatRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/chat",
  component: ChatView,
})

const conversationRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/chat/$conversationId",
  component: ChatView,
})

/// The filter lives in the URL for the reason the draft order did: a filtered
/// list is a thing people send each other, and a reload should not throw the
/// filter away.
const discussionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/discussions",
  validateSearch: (search: Record<string, unknown>): DiscussionSearch => ({
    // Narrowed rather than passed through: `feed` reaches the server, which
    // knows two values, and a hand-edited URL should not be able to ask it a
    // question it has to refuse.
    feed:
      search.feed === "bookmarked" || search.feed === "mine"
        ? search.feed
        : undefined,
    kind: typeof search.kind === "string" ? search.kind : undefined,
    tag: typeof search.tag === "string" ? search.tag : undefined,
    status:
      search.status === "open" ||
      search.status === "resolved" ||
      search.status === "locked"
        ? search.status
        : undefined,
    q: typeof search.q === "string" && search.q !== "" ? search.q : undefined,
  }),
  component: DiscussionsView,
})

const threadRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/discussions/$threadId",
  component: ThreadView,
})

/// Everything attached anywhere this person can reach. Not a file system —
/// each row belongs to a room, and that room's route is the only way to the
/// bytes.
const filesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/files",
  component: FilesView,
})

/// The books.
///
/// A section rather than a screen: finance is ten groups and about fifty
/// screens once it is finished, and the six below are the ones that make a
/// ledger usable — the chart it stands on, the map into that chart, the journal,
/// an account's own ledger, the trial balance, and the months.
///
/// `/finance` is the readiness board rather than a redirect to one of the
/// others, because until the map is filled in and a month is open nothing else
/// on this list can do anything, and being sent to an empty journal would not
/// say why.
const financeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/finance",
  component: FinanceOverview,
})

const financeAccountsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/finance/accounts",
  component: ChartOfAccounts,
})

const financeAccountMapRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/finance/account-map",
  component: AccountMapScreen,
})

const financeJournalRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/finance/journal",
  component: JournalScreen,
})

/// The account is in the URL, so "look at cash at store 07" is a link somebody
/// can send rather than a set of instructions.
const financeLedgerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/finance/ledger",
  component: GeneralLedgerScreen,
  validateSearch: (search: Record<string, unknown>): { account?: string } => ({
    account: typeof search.account === "string" ? search.account : undefined,
  }),
})

const financeTrialBalanceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/finance/trial-balance",
  component: TrialBalanceScreen,
})

const financePeriodsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/finance/periods",
  component: PeriodsScreen,
})

/// A `YYYY-MM-DD` out of a query string, or nothing.
///
/// Shape-checked rather than passed through: these two reach the server as a
/// date span, and `Deserialize` on a `NaiveDate` would answer a hand-edited
/// URL with a 400 that says less than showing the default span would.
function isoDay(value: unknown): string | undefined {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? value
    : undefined
}

/// What the shops sold. The counterpart to `/commercial`, which says what they
/// are charging — this says what anybody paid.
///
/// The granularity and the span are in the URL for the same reason the
/// discussion filters are: a range somebody has narrowed down is a thing they
/// send to a colleague, and a reload should not throw it away.
const salesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/sales",
  validateSearch: (search: Record<string, unknown>): SalesSearch => ({
    // Narrowed rather than passed through: both reach the server as a date
    // span, and a hand-edited URL should not be able to ask for a year of
    // single days.
    bucket:
      search.bucket === "day" ||
      search.bucket === "week" ||
      search.bucket === "month"
        ? search.bucket
        : undefined,
    span:
      typeof search.span === "number" && Number.isInteger(search.span)
        ? search.span
        : undefined,
    shop:
      typeof search.shop === "string" && search.shop !== ""
        ? search.shop
        : undefined,
    // What the figures are measured against. Narrowed like the rest: a
    // hand-edited URL should not be able to ask for a comparison mode the
    // screen has no code for.
    cmp:
      search.cmp === "prev" || search.cmp === "year" || search.cmp === "custom"
        ? search.cmp
        : undefined,
    cmpFrom: isoDay(search.cmpFrom),
    cmpTo: isoDay(search.cmpTo),
  }),
  component: SalesView,
})

/// Who works here.
///
/// A list and one person, and nothing between them: the record is small enough
/// that a person opens whole, and the tabs inside it are tabs rather than
/// routes because they are three views of one record, not three places.
const peopleRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/people",
  component: PeopleView,
})

/// What counts as late.
///
/// Under `/people` rather than a settings area of its own: it is a rule about
/// the people on that list, and somebody who has just noticed a run of late
/// arrivals is one click from the tolerance that decided they were late.
const attendancePolicyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/people/attendance-policy",
  component: AttendancePolicyView,
})

/// A person used to be a screen. Redirected into the sheet for the reason the
/// order route is: the address is out in the world and should keep working.
const personRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/people/$employeeId",
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/people", search: { employee: params.employeeId } })
  },
})

/// The position screens.
///
/// Thirty routes and one component. Every one of them asks the same question of
/// a different subtree of the client's chart — what is this worth, per location
/// — and the only thing that differs is the code it starts from. Declaring them
/// separately rather than generating them in a loop keeps TanStack's `to` a
/// union of real paths, so a typo in a link is a type error instead of a dead
/// screen.

const payablesGiroRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/finance/payables/giro",
  component: () => <PositionScreen family="2012002" title="Outstanding Giro" />,
})

const payablesDiscountsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/finance/payables/discounts",
  component: () => (
    <PositionScreen family="8010110003" title="Purchase Discounts" />
  ),
})

const payablesNonMerchRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/finance/payables/non-merchandise",
  component: () => (
    <PositionScreen family="2012001003" title="Non-Merchandise Payables" />
  ),
})

const payablesAffiliateRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/finance/payables/affiliate",
  component: () => <PositionScreen family="20123" title="Affiliate Payables" />,
})

const payablesAccruedRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/finance/payables/accrued",
  component: () => <PositionScreen family="2012201" title="Accrued Expenses" />,
})

const expensesSellingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/finance/expenses/selling",
  component: () => <PositionScreen family="60101" title="Selling Expenses" />,
})

const expensesPayrollRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/finance/expenses/payroll",
  component: () => <PositionScreen family="60102" title="Payroll Expenses" />,
})

const expensesAdminRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/finance/expenses/admin",
  component: () => <PositionScreen family="60103" title="Admin & General" />,
})

const expensesMaintenanceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/finance/expenses/maintenance",
  component: () => (
    <PositionScreen family="60104" title="Repairs & Maintenance" />
  ),
})

const expensesRentRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/finance/expenses/rent",
  component: () => <PositionScreen family="70101" title="Rent" />,
})

const expensesPrepaidRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/finance/expenses/prepaid",
  component: () => <PositionScreen family="10113" title="Prepaid & Advances" />,
})

const cashPositionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/finance/cash/position",
  component: () => <PositionScreen family="1011001" title="Cash Position" />,
})

const cashBankRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/finance/cash/bank",
  component: () => (
    <PositionScreen
      family="10110"
      title="Bank Position"
      note="Includes cash on hand — the client keeps both under KAS & SETARA KAS."
    />
  ),
})

const receivablesCardsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/finance/receivables/cards",
  component: () => <PositionScreen family="1011101" title="Card Receivables" />,
})

const receivablesOtherRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/finance/receivables/other",
  component: () => (
    <PositionScreen family="1011102" title="Other Receivables" />
  ),
})

const receivablesInterUnitRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/finance/receivables/inter-unit",
  component: () => (
    <PositionScreen family="10214" title="Inter-unit Receivables" />
  ),
})

const receivablesDoubtfulRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/finance/receivables/doubtful",
  component: () => (
    <PositionScreen family="1011103" title="Doubtful Debt Allowance" />
  ),
})

const receivablesOtherIncomeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/finance/receivables/other-income",
  component: () => (
    <PositionScreen family="80101" title="Other Income & Rent" />
  ),
})

const inventoryValueRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/finance/inventory/value",
  component: () => <PositionScreen family="1011201" title="Inventory Value" />,
})

const inventoryTransitRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/finance/inventory/in-transit",
  component: () => (
    <PositionScreen
      family="1011203"
      title="Goods in Transit"
      note="Each account is a route, not a place: the source is named in the account, the destination is the column."
    />
  ),
})

const inventoryBagsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/finance/inventory/bags",
  component: () => <PositionScreen family="1011202" title="Shopping Bags" />,
})

const inventoryCogsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/finance/inventory/cogs",
  component: () => <PositionScreen family="50101" title="Cost of Goods" />,
})

const inventoryDamageRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/finance/inventory/damage",
  component: () => <PositionScreen family="1011299" title="Damage Allowance" />,
})

const assetsDepreciationRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/finance/assets/depreciation",
  component: () => (
    <PositionScreen family="10216" title="Accumulated Depreciation" />
  ),
})

const assetsIntangiblesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/finance/assets/intangibles",
  component: () => <PositionScreen family="10217" title="Intangible Assets" />,
})

const assetsOtherRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/finance/assets/other",
  component: () => <PositionScreen family="10318" title="Other Assets" />,
})

const loansLongTermRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/finance/loans/long-term",
  component: () => <PositionScreen family="20224" title="Long-term Loans" />,
})

const loansCurrentRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/finance/loans/current",
  component: () => <PositionScreen family="20125" title="Current Portion" />,
})

const loansInterestRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/finance/loans/interest",
  component: () => <PositionScreen family="80201" title="Interest" />,
})

const financeBillsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/finance/payables/bills",
  component: SupplierBillsScreen,
})

/// The statements. Two shapes and five screens: an expense report and a
/// fixed-asset report are the same statement narrowed to the client's own root
/// classes, not separate reports that could drift from it.
const reportBalanceSheetRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/finance/reports/balance-sheet",
  component: () => (
    <StatementScreen kind="BALANCE_SHEET" title="Balance Sheet" />
  ),
})

const reportProfitLossRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/finance/reports/profit-loss",
  component: () => <StatementScreen kind="PROFIT_LOSS" title="Profit & Loss" />,
})

const reportByLocationRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/finance/reports/by-location",
  component: () => (
    <StatementScreen kind="PROFIT_LOSS" title="P&L by Location" byLocation />
  ),
})

const reportExpensesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/finance/reports/expenses",
  component: () => (
    <StatementScreen
      kind="PROFIT_LOSS"
      title="Expense Report"
      classes={["6", "7"]}
    />
  ),
})

const reportAssetsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/finance/reports/assets",
  component: () => (
    <StatementScreen
      kind="BALANCE_SHEET"
      title="Fixed Asset Report"
      classes={["1"]}
    />
  ),
})

/// The register of individual assets, which a balance view cannot be: an
/// account balance says what the machines are worth together, not which machine
/// is which, when it went into service, or whether anybody has decided it
/// belongs in the books at all.
const assetRegisterRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/finance/assets/register",
  component: AssetRegisterScreen,
})

/// Agreeing the bank's account of events with ours. Records agreement and
/// posts nothing — see the note on the screen.
const bankReconciliationRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/finance/cash/reconciliation",
  component: BankReconciliationScreen,
})

const routeTree = rootRoute.addChildren([
  sourcingRoute,
  basketRoute,
  ordersRoute,
  draftRoute,
  orderRoute,
  amendmentsRoute,
  allotmentsRoute,
  allotmentDraftRoute,
  allotmentRoute,
  pricesRoute,
  priceBooksRoute,
  bookComposerRoute,
  priceBookRoute,
  fleetRoute,
  simulateRoute,
  chatRoute,
  conversationRoute,
  discussionsRoute,
  threadRoute,
  filesRoute,
  salesRoute,
  financeRoute,
  financeAccountsRoute,
  financeAccountMapRoute,
  financeJournalRoute,
  financeLedgerRoute,
  financeTrialBalanceRoute,
  financePeriodsRoute,
  assetRegisterRoute,
  bankReconciliationRoute,
  payablesGiroRoute,
  payablesDiscountsRoute,
  payablesNonMerchRoute,
  payablesAffiliateRoute,
  payablesAccruedRoute,
  expensesSellingRoute,
  expensesPayrollRoute,
  expensesAdminRoute,
  expensesMaintenanceRoute,
  expensesRentRoute,
  expensesPrepaidRoute,
  cashPositionRoute,
  cashBankRoute,
  receivablesCardsRoute,
  receivablesOtherRoute,
  receivablesInterUnitRoute,
  receivablesDoubtfulRoute,
  receivablesOtherIncomeRoute,
  inventoryValueRoute,
  inventoryTransitRoute,
  inventoryBagsRoute,
  inventoryCogsRoute,
  inventoryDamageRoute,
  assetsDepreciationRoute,
  assetsIntangiblesRoute,
  assetsOtherRoute,
  loansLongTermRoute,
  loansCurrentRoute,
  loansInterestRoute,
  financeBillsRoute,
  reportBalanceSheetRoute,
  reportProfitLossRoute,
  reportByLocationRoute,
  reportExpensesRoute,
  reportAssetsRoute,
  peopleRoute,
  attendancePolicyRoute,
  personRoute,
])

export const router = createRouter({ routeTree })

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}

export {
  allotmentRoute,
  discussionsRoute,
  draftRoute,
  orderRoute,
  personRoute,
  priceBookRoute,
  threadRoute,
}
