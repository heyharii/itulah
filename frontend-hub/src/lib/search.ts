import type { QueryClient } from "@tanstack/react-query"

import { articleKeys, searchArticles } from "@/lib/queries/articles"
import {
  financeKeys,
  listAssets,
  listBills,
  listJournal,
  listPayments,
  searchAccounts,
} from "@/lib/queries/finance"
import { inventoryKeys, listAllotments } from "@/lib/queries/inventory"
import { listEmployees, peopleKeys } from "@/lib/queries/people"
import {
  listPurchaseOrders,
  listSuppliers,
  procurementKeys,
} from "@/lib/queries/procurement"
import { listSales, storeopsKeys } from "@/lib/queries/storeops"
import { listUsers, systemKeys } from "@/lib/queries/system"
import { listThreads, workplaceKeys } from "@/lib/queries/workplace"
import type { SheetKey } from "@/lib/sheets"

/// Global search, scoped to the module you are standing in.
///
/// The scope is the point. A console covering ten modules and ~150 endpoints
/// has thousands of records whose names collide — a supplier, a store and an
/// employee can all be "Sejahtera" — so an unscoped list of matches is a
/// disambiguation puzzle rather than an answer. The palette therefore searches
/// the active module first and offers "Everywhere" as a deliberate second step.
///
/// **Most sources run against what Query already holds**, fetching the module's
/// list if the cache is cold. That is honest at today's volumes and it is a
/// real limit: a list that grows past what a screen would sensibly load needs a
/// server-side search instead.
///
/// Three have already crossed that line and take a `q` on the server —
/// finance's accounts, the discussion board, and the article master. A chart
/// of accounts of 7.528 rows and a garment catalogue are simply too large to
/// hold in a palette, and those endpoints take a `q` precisely so they do not
/// have to be. The difference is confined to the `run` below, which is why the
/// two kinds sit side by side here without a caller knowing which is which.

export interface SearchHit {
  readonly id: string
  readonly title: string
  readonly subtitle?: string
  /// The screen to land on.
  readonly to: string
  /// The sheet to open once there, if the hit is a record rather than a screen.
  readonly sheet?: { readonly key: SheetKey; readonly value: string }
}

export interface SearchSource {
  /// The module id from `lib/navigation.ts`. Only the active scope's sources
  /// run, unless the scope is "everywhere".
  readonly module: string
  /// Named in the results, so a hit says which list it came from.
  readonly label: string
  readonly run: (
    query: string,
    client: QueryClient,
    signal: AbortSignal
  ) => Promise<readonly SearchHit[]>
}

/// Matching is a plain case-insensitive substring, deliberately. Fuzzy matching
/// on identifiers is worse than useless: a buyer typing a PO number wants that
/// PO, not five that share four digits with it.
function matches(needle: string, ...haystack: (string | null | undefined)[]) {
  const lower = needle.toLowerCase()
  return haystack.some((value) => value?.toLowerCase().includes(lower))
}

export const searchSources: readonly SearchSource[] = [
  {
    module: "procurement",
    label: "Purchase orders",
    run: async (query, client, signal) => {
      const orders = await client.fetchQuery({
        queryKey: procurementKeys.orders(),
        queryFn: () => listPurchaseOrders(undefined, signal),
      })
      return orders
        .filter((order) =>
          matches(
            query,
            order.po_number,
            order.supplier_name,
            order.supplier_id
          )
        )
        .slice(0, 8)
        .map((order) => ({
          id: order.purchase_order_id,
          title: order.po_number,
          subtitle: order.supplier_name ?? order.supplier_id,
          to: "/procurement/orders",
          sheet: { key: "order" as const, value: order.purchase_order_id },
        }))
    },
  },
  {
    module: "finance",
    label: "Journal entries",
    run: async (query, client, signal) => {
      const entries = await client.fetchQuery({
        queryKey: financeKeys.journal(null, null, null, null),
        queryFn: () => listJournal({ limit: 200 }, signal),
      })
      return entries
        .filter((entry) =>
          matches(query, entry.entry_number, entry.memo, entry.source_kind)
        )
        .slice(0, 8)
        .map((entry) => ({
          id: entry.entry_id,
          title: entry.entry_number,
          subtitle: entry.memo ?? entry.source_kind,
          to: "/finance/journal",
          sheet: { key: "entry" as const, value: entry.entry_id },
        }))
    },
  },
  {
    module: "finance",
    label: "Supplier bills",
    run: async (query, client, signal) => {
      const bills = await client.fetchQuery({
        queryKey: financeKeys.bills(null),
        queryFn: () => listBills({}, signal),
      })
      return bills
        .filter((bill) =>
          matches(
            query,
            bill.invoice_number,
            bill.supplier_name,
            bill.supplier_id
          )
        )
        .slice(0, 8)
        .map((bill) => ({
          id: bill.invoice_id,
          title: bill.invoice_number,
          subtitle: bill.supplier_name ?? bill.supplier_id,
          to: "/finance/bills",
          sheet: { key: "bill" as const, value: bill.invoice_id },
        }))
    },
  },
  {
    module: "finance",
    label: "Payments",
    /// A payment is found by its own number, by the bank reference somebody
    /// is holding, and by who was paid — which lives on the allocations,
    /// because one bank line settling two suppliers is an ordinary Friday.
    ///
    /// It opens the record, now that `payment` is a key in `lib/sheets.ts` —
    /// it was the one gap in this module's findability, where a hit landed on
    /// the register and left somebody to find the number again by eye.
    run: async (query, client, signal) => {
      const payments = await client.fetchQuery({
        queryKey: financeKeys.payments(null, null, null),
        queryFn: () => listPayments({ limit: 200 }, signal),
      })
      return payments
        .filter((payment) =>
          matches(
            query,
            payment.payment_number,
            payment.reference,
            ...payment.allocations.map((row) => row.supplier_name),
            ...payment.allocations.map((row) => row.invoice_number)
          )
        )
        .slice(0, 8)
        .map((payment) => ({
          id: payment.payment_id,
          title: payment.payment_number,
          subtitle:
            payment.allocations[0]?.supplier_name ??
            payment.allocations[0]?.invoice_number ??
            payment.method,
          to: "/finance/payments",
          sheet: { key: "payment" as const, value: payment.payment_id },
        }))
    },
  },
  {
    module: "finance",
    label: "Assets",
    run: async (query, client, signal) => {
      const assets = await client.fetchQuery({
        queryKey: financeKeys.assets(false, null),
        queryFn: () => listAssets({}, signal),
      })
      return assets
        .filter((asset) =>
          matches(query, asset.asset_number, asset.name, asset.category_name)
        )
        .slice(0, 8)
        .map((asset) => ({
          id: asset.asset_id,
          title: asset.name,
          subtitle: asset.asset_number,
          to: "/finance/assets",
          sheet: { key: "asset" as const, value: asset.asset_id },
        }))
    },
  },
  {
    module: "finance",
    label: "Accounts",
    /// The first source to break the cached-list rule, and the reason `run`
    /// takes a query rather than being handed a list: the client's chart is
    /// 7,528 accounts and is never loaded whole. This asks the server, which
    /// matches codes by prefix and names anywhere.
    run: async (query, client, signal) => {
      const accounts = await client.fetchQuery({
        queryKey: financeKeys.accountSearch(query, false),
        queryFn: () => searchAccounts(query, { limit: 50 }, signal),
      })
      return accounts.slice(0, 8).map((account) => ({
        id: account.account_code,
        title: account.account_code,
        subtitle: account.name,
        to: "/finance/accounts",
        sheet: { key: "account" as const, value: account.account_code },
      }))
    },
  },
  {
    module: "procurement",
    label: "Suppliers",
    run: async (query, client, signal) => {
      const suppliers = await client.fetchQuery({
        queryKey: procurementKeys.suppliers(),
        queryFn: () => listSuppliers(undefined, signal),
      })
      return suppliers
        .filter((supplier) =>
          matches(query, supplier.supplier_code, supplier.name)
        )
        .slice(0, 8)
        .map((supplier) => ({
          id: supplier.supplier_id,
          title: supplier.name,
          subtitle: supplier.supplier_code,
          to: "/procurement/suppliers",
          sheet: { key: "supplier" as const, value: supplier.supplier_id },
        }))
    },
  },
  {
    module: "inventory",
    label: "Allotments",
    run: async (query, client, signal) => {
      const answer = await client.fetchQuery({
        queryKey: inventoryKeys.allotmentList("", ""),
        queryFn: () => listAllotments("", "", signal),
      })
      return answer.items
        .filter((allotment) =>
          matches(query, allotment.allotment_number, allotment.notes)
        )
        .slice(0, 8)
        .map((allotment) => ({
          id: allotment.id,
          title: allotment.allotment_number,
          subtitle: allotment.type,
          to: "/inventory/allotments",
          sheet: { key: "allotment" as const, value: allotment.id },
        }))
    },
  },
  // Commercial has no palette source. A price book stopped being a screen on
  // 2026-09-02 — it is the envelope a Pricelist publish writes, not a thing
  // anybody navigates to — and the grid's own search reaches articles, which
  // is what a merchandiser actually types.
  {
    module: "master",
    label: "Articles",
    /// Server-side, like finance's accounts and workplace's discussions: the
    /// catalogue is far too large to hold in a palette, and the endpoint takes
    /// a `q` precisely so it does not have to be.
    ///
    /// That `q` matches six things at once — the article code, a SKU code, the
    /// name, a QR payload, an EPC-96 hex and the supplier's own code for the
    /// article — which is invisible from this call site and is the whole reason
    /// this is the one box worth pasting a scanned tag into. Somebody holding a
    /// garment has a number off its label, its swing tag or a reader, and does
    /// not know which of the six they are holding; the palette should not make
    /// them work that out before it will answer.
    ///
    /// It searches the master rather than `/commercial/products`, which is a
    /// price list: that endpoint always carries a company price, cannot see an
    /// article nobody has priced yet, and landed every hit on the pricing
    /// screen — so the only way to look a product up was to ask what it costs.
    run: async (query, client, signal) => {
      const scope = { q: query, limit: 20 }
      const page = await client.fetchQuery({
        queryKey: articleKeys.list(scope),
        queryFn: () => searchArticles(scope, signal),
      })
      return page.items.slice(0, 8).map((article) => ({
        id: article.article_code,
        title: article.name,
        // The code, then what tells two articles with one name apart. A
        // catalogue repeats names across divisions and seasons — "Kaos Polos"
        // is not one product — so a bare name is a hit somebody has to open to
        // identify.
        subtitle: [
          article.article_code,
          article.division_code,
          `${article.colours.length} colourway${article.colours.length === 1 ? "" : "s"}`,
          `${article.sku_count} SKU${article.sku_count === 1 ? "" : "s"}`,
        ]
          .filter(Boolean)
          .join(" · "),
        to: "/master",
        sheet: { key: "article" as const, value: article.article_code },
      }))
    },
  },
  {
    module: "people",
    label: "People",
    run: async (query, client, signal) => {
      const people = await client.fetchQuery({
        queryKey: peopleKeys.employees(),
        queryFn: () => listEmployees({}, signal),
      })
      return people
        .filter((person) =>
          matches(
            query,
            person.full_name,
            person.employee_code,
            person.username
          )
        )
        .slice(0, 8)
        .map((person) => ({
          id: person.employee_id,
          // `full_name` is nullable: a record can exist before anybody has
          // typed a name on it, and the code is what it is filed under anyway.
          title: person.full_name ?? person.employee_code,
          subtitle: person.employee_code,
          to: "/people",
          sheet: { key: "employee" as const, value: person.employee_id },
        }))
    },
  },
  {
    module: "discussions",
    label: "Discussions",
    /// Server-side, like finance's accounts and the article master: the
    /// discussions endpoint takes a `q`, and a thread body is not something a
    /// list response carries for the client to grep.
    run: async (query, client, signal) => {
      const threads = await client.fetchQuery({
        queryKey: workplaceKeys.threads({ q: query }),
        queryFn: () => listThreads({ q: query }, signal),
      })
      return threads.slice(0, 8).map((thread) => ({
        id: thread.thread_id,
        title: thread.title,
        subtitle: thread.subject_kind,
        to: "/discussions",
        sheet: { key: "thread" as const, value: thread.thread_id },
      }))
    },
  },
  {
    module: "storeops",
    label: "Sales",
    run: async (query, client, signal) => {
      const sales = await client.fetchQuery({
        queryKey: storeopsKeys.sales(),
        queryFn: () => listSales({}, signal),
      })
      return sales
        .filter((sale) => matches(query, sale.sale_number, sale.site_id))
        .slice(0, 8)
        .map((sale) => ({
          id: sale.id,
          title: sale.sale_number,
          subtitle: sale.site_id,
          to: "/storeops/sales",
          sheet: { key: "sale" as const, value: sale.id },
        }))
    },
  },
  {
    module: "system",
    label: "Users",
    /// Name and role only. A searchable directory of operators is right for an
    /// internal console; a searchable directory that also surfaces what each
    /// one can do is a different thing, and not one the palette should be.
    run: async (query, client, signal) => {
      const users = await client.fetchQuery({
        queryKey: systemKeys.users(),
        queryFn: () => listUsers(signal),
      })
      return users
        .filter((user) => matches(query, user.username, user.display_name))
        .slice(0, 8)
        .map((user) => ({
          id: user.id,
          title: user.display_name,
          subtitle: user.role,
          to: "/system/access",
          sheet: { key: "user" as const, value: user.username },
        }))
    },
  },
]

/// Run every source in scope, tolerating the ones that fail.
///
/// One module's list being unreachable must not empty the palette: a search
/// that returns nothing because an unrelated endpoint is down looks exactly
/// like a search that found nothing, and the two need very different reactions.
export async function runSearch(
  query: string,
  scope: string | "everywhere",
  client: QueryClient,
  signal: AbortSignal
): Promise<readonly (SearchHit & { source: string })[]> {
  const inScope = searchSources.filter(
    (source) => scope === "everywhere" || source.module === scope
  )
  const results = await Promise.allSettled(
    inScope.map(async (source) =>
      (await source.run(query, client, signal)).map((hit) => ({
        ...hit,
        source: source.label,
      }))
    )
  )
  return results.flatMap((result) =>
    result.status === "fulfilled" ? result.value : []
  )
}
