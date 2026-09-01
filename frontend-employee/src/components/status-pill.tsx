import { cn } from "@/lib/utils"

/// The tone a status is read in.
///
/// Four, not one per status: a person glancing at their own leave history is
/// reading colour before words, and "waiting on somebody" versus "settled"
/// versus "refused" is the whole of what they need from that glance.
type Tone = "waiting" | "good" | "bad" | "quiet"

const tones: Record<Tone, string> = {
  waiting:
    "bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-200",
  good: "bg-emerald-100 text-emerald-900 dark:bg-emerald-500/15 dark:text-emerald-200",
  bad: "bg-red-100 text-red-900 dark:bg-red-500/15 dark:text-red-200",
  quiet: "bg-muted text-muted-foreground",
}

/// Written out rather than inferred from the string, so a status the server
/// adds later shows up quietly grey instead of silently reading as approved.
const known: Record<string, { tone: Tone; label: string }> = {
  SUBMITTED: { tone: "waiting", label: "Waiting" },
  APPROVED: { tone: "good", label: "Approved" },
  TAKEN: { tone: "quiet", label: "Taken" },
  REJECTED: { tone: "bad", label: "Rejected" },
  CANCELLED: { tone: "quiet", label: "Cancelled" },
  ORDERED: { tone: "waiting", label: "Needs your reply" },
  ACKNOWLEDGED: { tone: "good", label: "Accepted" },
  DECLINED: { tone: "bad", label: "Declined" },
  WORKED: { tone: "quiet", label: "Worked" },
  PRESENT: { tone: "good", label: "Present" },
  LATE: { tone: "waiting", label: "Late" },
  INCOMPLETE: { tone: "bad", label: "Missing clock-out" },
  ABSENT: { tone: "bad", label: "Absent" },
  LEAVE: { tone: "quiet", label: "Leave" },
  HOLIDAY: { tone: "quiet", label: "Holiday" },
  REST: { tone: "quiet", label: "Rest day" },
  ACTIVE: { tone: "good", label: "Active" },
  ON_LEAVE: { tone: "waiting", label: "On leave" },
  SUSPENDED: { tone: "bad", label: "Suspended" },
  EXITED: { tone: "quiet", label: "Left" },
}

export function StatusPill({
  status,
  className,
}: {
  status: string
  className?: string
}) {
  const known_ = known[status] ?? { tone: "quiet" as Tone, label: status }
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap",
        tones[known_.tone],
        className
      )}
    >
      {known_.label}
    </span>
  )
}
