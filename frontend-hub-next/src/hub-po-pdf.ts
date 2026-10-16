import { purchaseOrdersHtml } from "@/screens/procurement/po-print"
import type { Paper, PrintableOrder, VariantName } from "@/screens/procurement/po-print"

/// Use the browser's print-to-PDF flow in this prototype. The full Hub's
/// jsPDF/canvg bundle has a Vite-specific dependency and is not part of the
/// PO/Receiving performance surface.
export function downloadOrdersPdf({
  orders,
  phone,
  paper,
  variantName,
}: {
  orders: readonly PrintableOrder[]
  phone: (value: string | null | undefined) => string | null
  paper: Paper
  variantName?: VariantName
}): void {
  const printWindow = window.open("")
  if (printWindow === null) return
  printWindow.opener = null
  printWindow.document.open()
  printWindow.document.write(purchaseOrdersHtml({
    orders,
    divisionLabel: (code) => code ?? "—",
    phone,
    paper,
    variantName,
  }))
  printWindow.document.close()
  printWindow.addEventListener("load", () => {
    printWindow.focus()
    printWindow.print()
  }, { once: true })
}
