import { ChevronRight } from "lucide-react"

import { AppLink } from "@/components/ui/app-link"
import { Card } from "@/components/ui/card"
import { count } from "@/lib/format"
import {
  useMonthNotOpenCount,
  useOverdueBillCount,
  useUnmappedMeaningCount,
} from "@/screens/finance/badges"
import { useUnagreedLineCount } from "@/screens/finance-lab-2/hooks"

/// What is waiting on Finance, each row opening the door and tab where it is
/// done (owner, 2026-10-16, `finance-final-prototype.html` Overview). The same
/// counts the doors' badges draw, so a row here and the badge it explains are
/// one answer. Nothing waiting: nothing drawn.
export function NeedsAttention() {
  const overdue = useOverdueBillCount()
  const unmatched = useUnagreedLineCount()
  const notOpen = useMonthNotOpenCount()
  const unlinked = useUnmappedMeaningCount()
  const rows = [
    {
      n: overdue,
      label: "Bills past due",
      to: "/finance/payables/aging",
      tone: "text-warn-fg",
    },
    {
      n: unmatched,
      label: "Bank lines to match",
      to: "/finance/cash-bank/bank-reconciliation",
      tone: "text-ink",
    },
    {
      n: notOpen,
      label: "Month not open",
      to: "/finance/setup/periods",
      tone: "text-warn-fg",
    },
    {
      n: unlinked,
      label: "Postings with no account",
      to: "/finance/setup/posting-readiness",
      tone: "text-bad-fg",
    },
  ].filter((row) => (row.n ?? 0) > 0)
  if (rows.length === 0) return null
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-[0.9375rem] font-semibold text-ink">
        Needs attention
      </h2>
      <Card className="divide-y divide-hairline overflow-hidden">
        {rows.map((row) => (
          <AppLink
            key={row.to}
            to={row.to}
            className="flex min-h-12 items-center gap-3 px-4 text-[0.9375rem] text-ink transition-colors duration-(--t-hover) hover:bg-soft"
          >
            <span className="min-w-0 flex-1 truncate">{row.label}</span>
            <span className={`font-semibold tabular-nums ${row.tone}`}>
              {count(row.n ?? 0)}
            </span>
            <ChevronRight className="size-4 shrink-0 text-line-ico" />
          </AppLink>
        ))}
      </Card>
    </section>
  )
}
