import { useCollaborationStream } from "@/lib/collaboration"
import { cn } from "@/lib/utils"

/// What the live connection is actually doing, said in numbers.
///
/// Not a green dot. The stream resumes from an event id, so the honest report
/// of a reconnection is which event it is catching up from — that number is
/// what explains a message arriving eight seconds late, and a dot that stays
/// green through an outage explains nothing at all.
export function LiveBadge({ className }: { className?: string }) {
  const { status, lastEventId } = useCollaborationStream()
  const label =
    status === "live" ? "Live" : status === "reconnecting" ? "Reconnecting" : "Offline"
  return (
    <span
      data-status={status}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px]",
        status === "live" && "bg-muted text-muted-foreground",
        status === "reconnecting" && "bg-amber-500/10 text-amber-600",
        status === "offline" && "bg-destructive/10 text-destructive",
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          status === "live" && "bg-emerald-500",
          status === "reconnecting" && "bg-amber-500",
          status === "offline" && "bg-destructive",
        )}
      />
      {label}
      {lastEventId > 0 && <span className="font-mono opacity-70">#{lastEventId}</span>}
    </span>
  )
}
