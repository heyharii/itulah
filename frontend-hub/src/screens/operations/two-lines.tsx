import { cn } from "@/lib/utils"

/// Name over a quieter second line (article over SKU, supplier over PO).
/// The 4px between the lines and the 4px more above and below take the cell
/// to the 14px the rule asks for on top of the table's own cell padding.
export function TwoLines({
  top,
  bottom,
  mono,
  className,
}: {
  top: React.ReactNode
  bottom: React.ReactNode
  /// The second line is an id (a SKU, a document number).
  mono?: boolean
  className?: string
}) {
  return (
    <span className={cn("block min-w-0 py-1", className)}>
      <span className="block truncate leading-[1.4] font-medium text-ink">
        {top}
      </span>
      <span
        className={cn(
          "mt-1 block truncate text-[0.9375rem] leading-[1.4] text-mute",
          mono && "font-mono"
        )}
      >
        {bottom}
      </span>
    </span>
  )
}
