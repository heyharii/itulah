import { useQuery } from "@tanstack/react-query"
import { useCallback } from "react"

import { listSuppliers, procurementKeys } from "@/lib/queries/procurement"
import {
  findSupplier,
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
