import { useQuery } from "@tanstack/react-query"
import { useCallback } from "react"

import { listSuppliers, procurementKeys } from "@/lib/queries/procurement"
import {
  findSupplier,
  formatPhones,
  supplierDisplayName,
} from "@/screens/procurement/supplier-format"

/// A supplier's name as the company writes it, "Sepatu Sejahtera, CV", for the
/// screens that only hold the supplier's code and the bare name an order
/// carries. Read from the supplier book every procurement screen shares, so
/// asking again costs nothing. A supplier the book does not know (seeded demo
/// data) keeps the name it came with.
// eslint-disable-next-line react-refresh/only-export-components
export function useSupplierName() {
  const suppliers = useQuery({
    queryKey: procurementKeys.suppliers(),
    queryFn: ({ signal }) => listSuppliers(undefined, signal),
    staleTime: 5 * 60 * 1000,
  })
  return useCallback(
    (
      code: string | null | undefined,
      name: string | null | undefined,
      id?: string | null
    ) => {
      const book = suppliers.data ?? []
      const found =
        (id == null ? undefined : findSupplier(book, id, "")) ??
        findSupplier(book, code, name)
      if (found !== undefined) return supplierDisplayName(found)
      return name ?? code ?? "—"
    },
    [suppliers.data]
  )
}

/// The supplier's RECORD id, for opening its sheet, from what an order or a
/// count carries: its code and bare name (and the record id itself, when the
/// order kept one). Null when the book does not know the supplier.
// eslint-disable-next-line react-refresh/only-export-components
export function useSupplierRecordId() {
  const suppliers = useQuery({
    queryKey: procurementKeys.suppliers(),
    queryFn: ({ signal }) => listSuppliers(undefined, signal),
    staleTime: 5 * 60 * 1000,
  })
  return useCallback(
    (
      code: string | null | undefined,
      name: string | null | undefined,
      id?: string | null
    ): string | null => {
      if (id != null && id !== "") return id
      const book = suppliers.data ?? []
      return findSupplier(book, code, name)?.supplier_id ?? null
    },
    [suppliers.data]
  )
}

/// The same, as a cell for a column declared outside any component.
export function SupplierName({
  code,
  name,
  id,
}: {
  code: string | null | undefined
  name: string | null | undefined
  id?: string | null
}) {
  const nameOf = useSupplierName()
  return <>{nameOf(code, name, id)}</>
}

/// A supplier's address and telephone as paper writes them, for the documents
/// addressed to them (the return delivery note's "Kepada"). Read from the same
/// book as the name; a supplier the book does not know, or one with neither
/// filled in, has none.
// eslint-disable-next-line react-refresh/only-export-components
export function useSupplierContact() {
  const suppliers = useQuery({
    queryKey: procurementKeys.suppliers(),
    queryFn: ({ signal }) => listSuppliers(undefined, signal),
    staleTime: 5 * 60 * 1000,
  })
  return useCallback(
    (
      code: string | null | undefined,
      name: string | null | undefined
    ): { address: string | null; phone: string | null } => {
      const found = findSupplier(suppliers.data ?? [], code, name)
      return {
        address: found?.address?.trim() || null,
        phone: found?.phone ? formatPhones(found.phone) : null,
      }
    },
    [suppliers.data]
  )
}
