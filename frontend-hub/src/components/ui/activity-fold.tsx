import { Collapsible } from "@base-ui/react/collapsible"
import { ChevronRight } from "lucide-react"

import { cn } from "@/lib/utils"

/// **Activity, folded** (owner, 16 Oct 2026: "history semua ganti ke activity
/// dan tertutup"): a record's history at the end of its sheet as one line,
/// "› Activity (5)", opened on demand — the same fold `RecordPanel` draws for
/// an untabbed sheet, so every sheet ends alike.
export function ActivityFold({
  count,
  className,
  children,
}: {
  /// How many entries, said beside the word; left out when unknown.
  count?: number
  className?: string
  children: React.ReactNode
}) {
  return (
    <Collapsible.Root
      className={cn("border-t border-hairline pt-3.5", className)}
    >
      <Collapsible.Trigger className="group flex min-h-tap w-full items-center gap-1.5 text-left text-[0.9375rem] font-medium text-body transition-colors hover:text-ink md:min-h-0">
        <ChevronRight className="size-3.5 text-line-ico transition-transform duration-150 group-data-[panel-open]:rotate-90" />
        Activity
        {count !== undefined && count > 0 && (
          <span className="font-normal text-mute tabular-nums">({count})</span>
        )}
      </Collapsible.Trigger>
      <Collapsible.Panel className="fold-panel">
        <div className="pt-3">{children}</div>
      </Collapsible.Panel>
    </Collapsible.Root>
  )
}
