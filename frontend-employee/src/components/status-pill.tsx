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
  // Leave, as the server's state machine actually spells it. The proposal in
  // `types.ts` guessed SUBMITTED/CANCELLED/TAKEN; the real one is
  // PENDING/APPROVED/REJECTED/WITHDRAWN, and `WITHDRAWN` is a word worth
  // keeping — only the person who filed a request may take it back, and
  // anybody else who wants it gone must reject it under their own name.
  PENDING: { tone: "waiting", label: "Waiting" },
  APPROVED: { tone: "good", label: "Approved" },
  REJECTED: { tone: "bad", label: "Refused" },
  WITHDRAWN: { tone: "quiet", label: "Taken back" },
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
  // Employment, as the server's state machine actually spells it. CANDIDATE
  // is not a mistake and not "inactive": somebody has been taken on and has
  // not started, which is normal for a fortnight and alarming for a year.
  CANDIDATE: { tone: "waiting", label: "Not started" },
  ACTIVE: { tone: "good", label: "Active" },
  SUSPENDED: { tone: "bad", label: "Suspended" },
  TERMINATED: { tone: "quiet", label: "Left" },
  // Kept because the leave routes still answer with it, and it costs a line.
  ON_LEAVE: { tone: "waiting", label: "On leave" },
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
