import { AllotmentDetailView } from "@/components/allotment/allotment-detail"
import { AllotmentDraft } from "@/components/allotment/allotment-draft"
import { AllotmentsView } from "@/components/allotment/allotments-view"
import { ChatView } from "@/components/chat/chat-view"
import { BookDetailView } from "@/components/commercial/book-detail"
import { FleetView } from "@/components/commercial/fleet-view"
import { PriceBooksView } from "@/components/commercial/price-books-view"
import { AccountMapScreen } from "@/components/finance/account-map"
import { ChartOfAccounts } from "@/components/finance/chart-of-accounts"
import { GeneralLedgerScreen } from "@/components/finance/general-ledger"
import { JournalScreen } from "@/components/finance/journal"
import { FinanceOverview } from "@/components/finance/overview"
import { PeriodsScreen } from "@/components/finance/periods"
import { TrialBalanceScreen } from "@/components/finance/trial-balance"
import { PricesView } from "@/components/commercial/prices-view"
import { SimulateView } from "@/components/commercial/simulate-view"
import {
  DiscussionsView,
  type DiscussionSearch,
} from "@/components/discussion/discussions-view"
import { ThreadView } from "@/components/discussion/thread-view"
import { FilesView } from "@/components/files/files-view"
import { PeopleView } from "@/components/people/people-view"
import { PersonDetail } from "@/components/people/person-detail"
import { OrderDetail } from "@/components/po/order-detail"
import { PoDraft } from "@/components/po/po-draft"
import { PriceAmendmentsView } from "@/components/po/price-amendments-view"
import { PurchaseOrdersView } from "@/components/po/purchase-orders-view"
import { SalesView, type SalesSearch } from "@/components/sales/sales-view"
import { BasketView } from "@/components/sourcing/basket-view"
import { SourcingView } from "@/components/sourcing/sourcing-view"
import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
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
const rootRoute = createRootRoute({ component: Outlet })

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

const orderRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/orders/$purchaseOrderId",
  component: OrderDetail,
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

const allotmentRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/allotments/$allotmentId",
  component: AllotmentDetailView,
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

/// One book, whole. A published book is immutable, so this is the only record
/// of what it said — and until it existed there was none.
const priceBookRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/commercial/books/$publicationId",
  component: BookDetailView,
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
      search.feed === "bookmarked" || search.feed === "mine" ? search.feed : undefined,
    kind: typeof search.kind === "string" ? search.kind : undefined,
    tag: typeof search.tag === "string" ? search.tag : undefined,
    status:
      search.status === "open" || search.status === "resolved" || search.status === "locked"
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
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined
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
      search.bucket === "day" || search.bucket === "week" || search.bucket === "month"
        ? search.bucket
        : undefined,
    span:
      typeof search.span === "number" && Number.isInteger(search.span)
        ? search.span
        : undefined,
    shop:
      typeof search.shop === "string" && search.shop !== "" ? search.shop : undefined,
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

const personRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/people/$employeeId",
  component: PersonDetail,
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
  peopleRoute,
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
