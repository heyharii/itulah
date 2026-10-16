import { Pill } from "@/components/ui/pill"
import { count } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { GaContractRow } from "@itulah/contract"

/// The two desk markers (brief §10.2): a small word that says whose figure it
/// is, set beside the number it belongs to.
///
/// GA's screens are written to keep the departments apart — GA holds the deal,
/// Finance holds the money — so a rupiah that appears here is always somebody
/// else's answer read over the fence. A mark beside the figure is cheaper than
/// a caption under the table and harder to scroll past than a footnote: the
/// person reading "Billed" can see, where the number is, that the number is
/// Finance's ledger and not this register's.
///
/// Two words, not a pill with a dot and a tone: the mark carries no state, and
/// dressing it like a status would make "Finance" read as *bad Finance* the
/// day the figure is zero. Same quiet shape as a `Field`'s `aside`.

/// Beside a figure Finance owns — billed, remaining, the recurring templates.
export function FinanceMark({ className }: { className?: string }) {
  return <Mark className={className}>Finance</Mark>
}

/// Beside a GA-owned fact shown on a Finance surface — the other half of the
/// same rule. Nothing on these screens carries it (a GA desk reads its own
/// figures unmarked); it ships now because tahap 6's bill lines carry the
/// `contract` reference, and that is Finance's surface reading a GA record.
export function GaMark({ className }: { className?: string }) {
  return <Mark className={className}>GA</Mark>
}

function Mark({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-inner bg-soft-2 px-[0.375rem] text-[0.9375rem] font-medium text-body",
        className
      )}
    >
      {children}
    </span>
  )
}

/// The contract's own lifecycle, in the words the prototype's pills used.
///
/// The server computes the standing from the window and `reminder_days` — per
/// contract, not one threshold — and this only translates. SEGERA_HABIS names
/// the deadline, because "Expires in 37 days" is the sentence that gets somebody to
/// open the renewal conversation this week.
export function StandingPill({ row }: { row: GaContractRow }) {
  switch (row.standing) {
    case "AKTIF":
      return <Pill tone="ok">Active</Pill>
    case "SEGERA_HABIS":
      return (
        <Pill tone="warn">
          {row.days_to_end === null
            ? "Expiring soon"
            : `Expires in ${count(row.days_to_end)} days`}
        </Pill>
      )
    case "HABIS":
      return <Pill tone="neutral">Expired</Pill>
    case "BELUM_MULAI":
      return <Pill tone="neutral">Not started</Pill>
    case "DIHENTIKAN":
      return <Pill tone="neutral">Terminated</Pill>
    default:
      return <Pill tone="neutral">Draft</Pill>
  }
}
