import { STATUS_LABEL, subjectLabel } from "@/lib/discussion"
import { cn } from "@/lib/utils"
import { FileText } from "lucide-react"

/// The record being argued about.
///
/// This is what stands where a forum would put a category. The identifier is
/// the one a person reads out — `PO-2607-0108`, `SUP-0311` — because the thread
/// is stored against that text rather than a foreign key, so that it survives
/// its subject being archived.
export function SubjectChip({
  kind,
  subjectId,
  className,
}: {
  kind: string
  subjectId: string
  className?: string
}) {
  return (
    <span
      title={subjectLabel(kind)}
      className={cn(
        "bg-muted text-muted-foreground inline-flex max-w-full items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px]",
        className,
      )}
    >
      <FileText className="size-3 shrink-0 opacity-70" />
      {subjectLabel(kind)}
      <span className="truncate font-mono text-[10.5px] font-medium">{subjectId}</span>
    </span>
  )
}

export function StatusPill({ status, className }: { status: string; className?: string }) {
  return (
    <span
      className={cn(
        "rounded-full px-1.5 py-0.5 text-[10px]",
        status === "resolved" && "bg-emerald-500/10 text-emerald-600",
        status === "locked" && "bg-amber-500/10 text-amber-600",
        status === "open" && "bg-muted text-muted-foreground",
        className,
      )}
    >
      {STATUS_LABEL[status] ?? status}
    </span>
  )
}
