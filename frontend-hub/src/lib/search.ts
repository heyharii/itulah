import type { QueryClient } from "@tanstack/react-query"

import { node } from "@/lib/api"

import { articleKeys, searchArticles } from "@/lib/queries/articles"
import { listCashDocuments } from "@/lib/queries/cash-documents"
import {
  financeKeys,
  listGiros,
  listAssets,
  listBills,
  listJournal,
  listPayments,
  searchAccounts,
} from "@/lib/queries/finance"
import { inventoryKeys, listAllotments } from "@/lib/queries/inventory"
import { listEmployees, peopleKeys } from "@/lib/queries/people"
import { listSuppliers, procurementKeys } from "@/lib/queries/procurement"
import { listSales, storeopsKeys } from "@/lib/queries/storeops"
import { listUsers, systemKeys } from "@/lib/queries/system"
import { listThreads, workplaceKeys } from "@/lib/queries/workplace"
import type { SheetKey } from "@/lib/sheets"
import { supplierLabel } from "@/screens/procurement/supplier-format"

/// The supplier book, for writing a supplier's name with its legal form. A
/// failed read leaves the bare names rather than failing the search.
async function supplierBook(client: QueryClient, signal?: AbortSignal) {
  try {
    return await client.fetchQuery({
      queryKey: procurementKeys.suppliers(),
      queryFn: () => listSuppliers(undefined, signal),
      staleTime: 5 * 60 * 1000,
    })
  } catch {
    return []
  }
}

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

/// The server's `global_search` (migrations 0718 and 0816), not a loaded page
/// of a list: an order from three months back is found by its number, and a
/// supplier by its code or name, without anybody scrolling to it first. One
/// request serves every kind, so the sources below share it through Query.
function serverSearch(query: string, client: QueryClient, signal: AbortSignal) {
  return client.fetchQuery({
    queryKey: ["search", "global", query] as const,
    staleTime: 10_000,
    queryFn: async () =>
      (
        await node.get<{
          items: {
            kind: string
            record_id: string
            title: string
            subtitle: string
          }[]
        }>(`/api/v1/search?${new URLSearchParams({ q: query, limit: "12" })}`, {
          signal,
        })
      ).items,
  })
}

export const searchSources: readonly SearchSource[] = [
  {
    module: "procurement",
    label: "Purchase orders",
    run: async (query, client, signal) =>
      (await serverSearch(query, client, signal))
        .filter((hit) => hit.kind === "purchase_order")
        .map((hit) => ({
          id: hit.record_id,
          title: hit.title,
          subtitle: hit.subtitle,
          to: "/procurement/orders",
          sheet: { key: "order" as const, value: hit.record_id },
        })),
  },
  {
    module: "finance",
    label: "Journal entries",
    run: async (query, client, signal) => {
      const entries = await client.fetchQuery({
        queryKey: financeKeys.journal(null, null, null, null),
        // The envelope's `rows`. The palette narrows locally over one
        // page, as it has always done — it is a jump list, not the
        // register.
        queryFn: () => listJournal({ limit: 200 }, signal).then((p) => p.rows),
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
          to: "/finance/accounting/journal-entries",
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
        queryFn: () => listBills({}, signal).then((page) => page.rows),
      })
      const book = await supplierBook(client, signal)
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
          subtitle: supplierLabel(book, bill.supplier_id, bill.supplier_name),
          to: "/finance/payables/bills",
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
        queryFn: () =>
          listPayments({ limit: 200 }, signal).then((page) => page.rows),
      })
      const book = await supplierBook(client, signal)
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
            (payment.allocations[0] === undefined
              ? null
              : supplierLabel(
                  book,
                  payment.allocations[0].supplier_id,
                  payment.allocations[0].supplier_name
                )) ??
            payment.allocations[0]?.invoice_number ??
            payment.method,
          to: "/finance/payables/payments",
          sheet: { key: "payment" as const, value: payment.payment_id },
        }))
    },
  },
  {
    module: "finance",
    label: "Cash vouchers",
    /// BKK and BKM by number, by who was paid or paid us, by the memo and by
    /// the giro written on them — the paper somebody is holding.
    run: async (query, client, signal) => {
      const documents = await client.fetchQuery({
        queryKey: [...financeKeys.all, "cash-documents", "search"] as const,
        queryFn: () => listCashDocuments({ limit: 300 }, signal),
        staleTime: 60_000,
      })
      const book = await supplierBook(client, signal)
      return documents
        .filter((doc) =>
          matches(
            query,
            doc.number,
            doc.party_name,
            doc.memo,
            doc.reference,
            doc.giro_number,
            doc.entry_number
          )
        )
        .slice(0, 8)
        .map((doc) => {
          const word =
            doc.kind === "PAY" ? "bkk" : doc.kind === "RECEIVE" ? "bkm" : null
          return {
            id: doc.document_id,
            title: doc.number ?? `Draft ${doc.kind === "PAY" ? "BKK" : "BKM"}`,
            subtitle: [
              doc.party_type === "SUPPLIER"
                ? supplierLabel(book, doc.supplier_id, doc.party_name)
                : doc.party_name,
              doc.memo,
            ]
              .filter(Boolean)
              .join(" · "),
            to:
              word === null
                ? "/finance/cash-bank/bkk"
                : `/finance/cash-bank/${word}/${doc.document_id}`,
          }
        })
    },
  },
  {
    module: "finance",
    label: "Giros",
    run: async (query, client, signal) => {
      const giros = await client.fetchQuery({
        queryKey: ["finance", "giros", "search"] as const,
        queryFn: () => listGiros({ limit: 1000 }, signal),
        staleTime: 60_000,
      })
      const book = await supplierBook(client, signal)
      return giros
        .filter((giro) =>
          matches(
            query,
            giro.number,
            giro.party_name,
            giro.payment_number,
            giro.cash_document_number
          )
        )
        .slice(0, 8)
        .map((giro) => ({
          id: giro.giro_id,
          title: giro.number,
          subtitle: [
            giro.party_name === null
              ? null
              : supplierLabel(book, giro.party_name, giro.party_name),
            giro.bank,
            giro.status.toLowerCase(),
          ]
            .filter(Boolean)
            .join(" · "),
          to: "/finance/cash-bank/giro",
        }))
    },
  },
  {
    module: "finance",
    label: "Contractor projects",
    run: async (query, client, signal) => {
      const projects = await client.fetchQuery({
        queryKey: ["finance", "contractor-projects"] as const,
        queryFn: () =>
          node.get<
            {
              project_id: string
              project_number: string
              name: string
              supplier_name: string | null
              supplier_id: string
            }[]
          >("/api/v1/finance/contractor-projects", { signal }),
        staleTime: 60_000,
      })
      const book = await supplierBook(client, signal)
      return projects
        .filter((row) =>
          matches(
            query,
            row.project_number,
            row.name,
            row.supplier_name,
            row.supplier_id
          )
        )
        .slice(0, 8)
        .map((row) => ({
          id: row.project_id,
          title: row.name,
          subtitle: `${row.project_number} · ${supplierLabel(book, row.supplier_id, row.supplier_name)}`,
          to: "/finance/assets/contractor-projects",
        }))
    },
  },
  {
    module: "finance",
    label: "Assets",
    run: async (query, client, signal) => {
      const assets = await client.fetchQuery({
        queryKey: financeKeys.assets(false, null),
        queryFn: () => listAssets({}, signal).then((p) => p.rows),
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
          to: "/finance/assets/capitalization",
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
        queryFn: () =>
          searchAccounts(query, { limit: 50 }, signal).then((p) => p.rows),
      })
      return accounts.slice(0, 8).map((account) => ({
        id: account.account_code,
        title: account.account_code,
        subtitle: account.name,
        to: "/finance/accounting/chart-of-accounts",
        sheet: { key: "account" as const, value: account.account_code },
      }))
    },
  },
  {
    // Suppliers answers in the Master module since 2026-10-04, so scoping
    // the palette to "here" on the suppliers screen still finds them.
    module: "master",
    label: "Suppliers",
    run: async (query, client, signal) => {
      const book = await supplierBook(client, signal)
      return (await serverSearch(query, client, signal))
        .filter((hit) => hit.kind === "supplier")
        .map((hit) => ({
          id: hit.record_id,
          title: supplierLabel(book, hit.record_id, hit.title),
          subtitle: hit.subtitle,
          to: "/procurement/suppliers",
          sheet: { key: "supplier" as const, value: hit.record_id },
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
        subtitle: `${thread.subject_label} · ${thread.subject_id}`,
        to: "/discussions",
        sheet: { key: "thread" as const, value: thread.thread_id },
      }))
    },
  },
  {
    module: "sales",
    label: "Receipts",
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
          to: "/sales",
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
      return users.rows
        .filter((user) => matches(query, user.username, user.display_name))
        .slice(0, 8)
        .map((user) => ({
          id: user.id,
          title: user.display_name,
          subtitle: user.role,
          to: "/system/users",
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
