import { queryOptions, useQueries, useQuery } from "@tanstack/react-query"

import { gaContracts, gaKeys, gaRepairs } from "@/lib/queries/ga"
import {
  listBills,
  listBillTemplates,
  searchAccounts,
} from "@/lib/queries/finance"
import {
  procurementKeys,
  supplierBankAccounts,
  supplierContacts,
  supplierPage,
  type SupplierCategory,
} from "@/lib/queries/procurement"
import { useSections } from "@/lib/session"
import { PAGE } from "@/screens/vendors/book-data"
import type { Supplier } from "@itulah/contract"

/// The reads the Suppliers list and its sheet make beside the book itself.
///
/// None of them holds the screen up: every figure and every section reads on
/// its own and is drawn when it arrives, or left out when the person's role
/// cannot read it (Finance's bills and templates are Finance's).

/// Whether this person may add or change a supplier. The book is Procurement's
/// and Finance's to keep; GA reads it to pick a vendor and sees it here
/// read-only, the same split the server's section gate makes.
export function useMayEditSuppliers(): boolean {
  const { sections, bypass } = useSections()
  return (
    bypass || sections.includes("procurement") || sections.includes("finance")
  )
}

/// Every supplier of both books, read to the end: what the figures over the
/// register are counted from. Its key sits under the book's prefix, so a save
/// that invalidates `suppliers()` refreshes the figures with it.
export const vendorRegisterQuery = () =>
  queryOptions({
    queryKey: [...procurementKeys.suppliers(), "register"] as const,
    queryFn: async ({ signal }) => {
      const rows: Supplier[] = []
      for (const category of ["EXPENSE", "AFFILIATE"] as const) {
        let cursor: string | undefined
        // Ten pages of a hundred a book: more than the department will ever
        // keep, and a bound so that a wrong cursor cannot loop for ever.
        for (let page = 0; page < 10; page++) {
          const body = await supplierPage(
            { category, limit: PAGE, cursor },
            signal
          )
          rows.push(...body.rows)
          if (!body.next_cursor) break
          cursor = body.next_cursor
        }
      }
      return rows
    },
    staleTime: 30_000,
  })

/// One count, asked as a page of one row: the server's `total` is the answer.
/// What the tabs print beside their words, over whatever the search leaves.
export const vendorCountQuery = (scope: {
  readonly category: SupplierCategory
  readonly q?: string
}) =>
  queryOptions({
    queryKey: [...procurementKeys.suppliers(scope), "count"] as const,
    queryFn: ({ signal }) => supplierPage({ ...scope, limit: 1 }, signal),
    select: (page) => page.total,
  })

/// How many suppliers a living contract names. The contract book takes up to a
/// thousand rows a page, which is every deal a department keeps.
export const contractedSuppliersQuery = () =>
  queryOptions({
    queryKey: [...gaKeys.contracts({ archived: false }), "suppliers"] as const,
    queryFn: ({ signal }) =>
      gaContracts({ archived: false, limit: 1000 }, signal),
    select: (page) =>
      new Set(
        page.rows
          .map((row) => row.supplier_id)
          .filter((id): id is string => id !== null)
      ).size,
  })

/// The names of the accounts the suppliers' bills debit, read from the chart.
///
/// The supplier row carries only the code; the chart carries the name, and it
/// is the name a person reads ("Biaya Kebersihan (Cleaning)") — the code
/// beneath it is what an accountant checks it against. The chart is one
/// request per code because it is a thousand-account book and the screen needs
/// a dozen of them. A role that cannot read the chart gets the codes alone.
export function useAccountNames(
  codes: readonly (string | null)[]
): ReadonlyMap<string, string> {
  const wanted = [
    ...new Set(codes.filter((code): code is string => code !== null)),
  ].sort()
  return useQueries({
    queries: wanted.map((code) => ({
      queryKey: ["vendors", "account-name", code] as const,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        searchAccounts(code, { limit: 20 }, signal).then(
          (page) =>
            page.rows.find((row) => row.account_code === code)?.name ?? null
        ),
      staleTime: Infinity,
      retry: false,
    })),
    combine: (results) =>
      new Map(
        results.flatMap((result, at) =>
          typeof result.data === "string"
            ? ([[wanted[at], result.data]] as const)
            : []
        )
      ),
  })
}

/// A supplier's accounts and people, as the two panels read them: retired ones
/// included, so the panels' keys and these are one entry. The read view draws
/// the live ones.
export const vendorBankQuery = (supplierId: string) =>
  queryOptions({
    queryKey: procurementKeys.supplierBankAccounts(supplierId),
    queryFn: ({ signal }) => supplierBankAccounts(supplierId, true, signal),
  })

export const vendorPeopleQuery = (supplierId: string) =>
  queryOptions({
    queryKey: procurementKeys.supplierContacts(supplierId),
    queryFn: ({ signal }) => supplierContacts(supplierId, true, signal),
  })

/// The contracts that name this supplier. The register searches the supplier's
/// name, and what comes back is narrowed to this one supplier's id, so a
/// namesake is not counted.
export function useVendorContracts(supplier: Supplier | undefined) {
  return useQuery({
    queryKey: [
      ...gaKeys.contracts({ q: supplier?.name, archived: false }),
      "of-supplier",
      supplier?.supplier_id ?? null,
    ] as const,
    queryFn: ({ signal }) =>
      gaContracts({ q: supplier?.name, archived: false, limit: 200 }, signal),
    select: (page) =>
      page.rows.filter((row) => row.supplier_id === supplier?.supplier_id),
    enabled: supplier !== undefined,
  })
}

/// The repairs that name this supplier, from the repair book: it takes no
/// supplier of its own, so the book is read and narrowed here.
export function useVendorRepairs(supplier: Supplier | undefined) {
  return useQuery({
    queryKey: [
      ...gaKeys.repairs({}),
      "of-supplier",
      supplier?.supplier_id ?? null,
    ] as const,
    queryFn: ({ signal }) => gaRepairs({ limit: 200 }, signal),
    select: (page) =>
      page.rows.filter((row) => row.supplier_id === supplier?.supplier_id),
    enabled: supplier !== undefined,
  })
}

/// What was billed this year, read from the posted bills: Finance's figure, so
/// a role that cannot read bills gets no figure rather than a zero.
export function useBilledThisYear(supplier: Supplier | undefined) {
  const year = new Date().getFullYear().toString()
  return useQuery({
    queryKey: [
      "finance",
      "bills",
      "of-supplier",
      supplier?.supplier_id ?? null,
      year,
    ] as const,
    queryFn: ({ signal }) =>
      listBills(
        {
          supplier: supplier?.supplier_id,
          status: "POSTED",
          sort: "date",
          dir: "desc",
          limit: 200,
        },
        signal
      ),
    select: (page) =>
      page.rows
        .filter((row) => row.invoice_date.startsWith(year))
        .reduce((sum, row) => sum + row.total_minor, 0),
    enabled: supplier !== undefined,
    retry: false,
  })
}

/// The recurring bills raised for this supplier. The route answers every
/// template, so they are narrowed here — by the supplier's id, or by its code,
/// which is what the older templates were written with.
export function useVendorTemplates(supplier: Supplier | undefined) {
  return useQuery({
    queryKey: ["finance", "bill-templates", "of-supplier"] as const,
    queryFn: ({ signal }) => listBillTemplates(signal),
    select: (rows) =>
      rows.filter(
        (row) =>
          row.supplier_id === supplier?.supplier_id ||
          row.supplier_id === supplier?.supplier_code
      ),
    enabled: supplier !== undefined,
    retry: false,
  })
}
