import { useQuery } from "@tanstack/react-query"

import { Field, Select } from "@/components/ui/field"
import { money } from "@/lib/format"
import { useSupplierName } from "@/screens/finance/hooks"
import {
  SETTLE_LABEL,
  supplierReturnKeys,
  supplierReturns,
  type SettleBy,
  type SupplierReturn,
} from "@/lib/queries/supplier-returns"

/// An optional link from a finance document to the supplier return it settles.
/// Lists the returns the supplier still owes on — the ones agreed as `kind`
/// first. Picking one means the amount is recorded against it as a settlement
/// once the document is saved (see `settleReturn` in the callers).
export function ReturnPicker({
  label,
  kind,
  supplierId,
  value,
  onChange,
}: {
  label: string
  kind: SettleBy
  /// Narrow to one supplier; left out, every supplier's open returns.
  supplierId?: string
  value: string
  onChange: (allotmentId: string) => void
}) {
  const returns = useQuery({
    queryKey: supplierReturnKeys.list(),
    queryFn: ({ signal }) => supplierReturns(signal),
    // The register is optional here: a node without it simply offers nothing.
    retry: false,
  })
  const supplierName = useSupplierName()
  const open = (returns.data ?? [])
    .filter(
      (one: SupplierReturn) =>
        one.owed_minor > 0 &&
        (supplierId === undefined || one.supplier_id === supplierId)
    )
    .sort(
      (a, b) =>
        Number(b.settle_by === kind) - Number(a.settle_by === kind) ||
        a.allotment_number.localeCompare(b.allotment_number)
    )
  if (open.length === 0) return null
  return (
    <Field label={label}>
      <Select value={value} onChange={onChange}>
        <option value="">None</option>
        {open.map((one) => (
          <option key={one.allotment_id} value={one.allotment_id}>
            {one.allotment_number} ·{" "}
            {supplierName(one.supplier_id, one.supplier_name)} ·{" "}
            {SETTLE_LABEL[one.settle_by]} · {money(one.owed_minor)} owed
          </option>
        ))}
      </Select>
    </Field>
  )
}
