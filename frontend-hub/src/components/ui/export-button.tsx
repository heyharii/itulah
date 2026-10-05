import { Download } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { exportXlsx, type ExportSheet } from "@/lib/export-xlsx"
import { toast } from "@/lib/toast"

/// "Export" in a page header: writes the report on screen to an `.xlsx`.
///
/// `build` is called when the button is pressed, not while rendering, so a
/// screen assembles its rows once per export rather than once per paint. It
/// returns `null` while there is nothing to write yet — and the button is
/// disabled then, so it is only a guard.
export function ExportButton({
  build,
  disabled,
  variant = "quiet",
}: {
  build: () => ExportSheet | null
  /// `ghost` where the button stands in a toolbar among bordered controls.
  variant?: "quiet" | "ghost"
  /// Nothing to export yet: still loading, or an empty report.
  disabled?: boolean
}) {
  const [pending, setPending] = useState(false)
  return (
    <Button
      variant={variant}
      disabled={disabled}
      pending={pending}
      onClick={() => {
        const sheet = build()
        if (sheet === null) {
          // A table still on its way (the button can be live a moment before
          // the rows it exports are): say so rather than do nothing.
          toast("The report is still loading — try again in a moment.")
          return
        }
        setPending(true)
        exportXlsx(sheet)
          .catch(() => toast.error("The Excel file could not be written."))
          .finally(() => setPending(false))
      }}
    >
      <Download />
      Export
    </Button>
  )
}
