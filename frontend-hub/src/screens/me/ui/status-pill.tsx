import { Pill, type PillTone } from "@/screens/me/ui/pill"

/// The tone a status is read in.
///
/// Four, not one per status: a person glancing at their own leave history is
/// reading colour before words, and "waiting on somebody" versus "settled"
/// versus "refused" is the whole of what they need from that glance.
type Tone = "waiting" | "good" | "bad" | "quiet"

const tones: Record<Tone, PillTone> = {
  waiting: "warn",
  good: "ok",
  bad: "bad",
  quiet: "neutral",
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
  // Overtime, as the server's state machine actually spells it.
  AWAITING_CONSENT: { tone: "waiting", label: "Needs your reply" },
  AGREED: { tone: "good", label: "Agreed" },
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
  // Attendance, as the server's derivation actually spells it. A day carries an
  // outcome *set* rather than one status — `LATE` and `AGREED_OVERTIME` are both
  // true of the same evening — so these are rendered several to a row, and the
  // seven below are the whole vocabulary. `PRESENT`/`INCOMPLETE`/`REST` above
  // were this app's own guesses at it and are kept only because other screens
  // still pass leave and employment states through here.
  ON_TIME: { tone: "good", label: "On time" },
  EARLY_LEAVE: { tone: "waiting", label: "Left early" },
  // Not "absent": nothing was recorded at one end, which is a hole in the day
  // rather than a day nobody worked. Calling it absence is the mistake the
  // whole derivation is built to avoid.
  MISSING_PUNCH: { tone: "bad", label: "A punch is missing" },
  APPROVED_LEAVE: { tone: "quiet", label: "Approved leave" },
  AGREED_OVERTIME: { tone: "good", label: "Overtime agreed" },
  // The plan, for the days that have no outcome to show.
  SCHEDULED: { tone: "quiet", label: "Scheduled" },
  REST_DAY: { tone: "quiet", label: "Rest day" },
  PUBLIC_HOLIDAY: { tone: "quiet", label: "Public holiday" },
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
    <Pill tone={tones[known_.tone]} className={className}>
      {known_.label}
    </Pill>
  )
}
