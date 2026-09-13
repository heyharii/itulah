import { AlertTriangle, ArrowRight, Check, Lock, Unlink } from "lucide-react"

import { AppLink } from "@/kit/app-link"
import { PageHead } from "@/kit/page"
import { ScopeLine } from "@/kit/scope"
import { Tile, Tiles } from "@/kit/tiles"
import { Failed, Loading } from "@/kit/state"
import { count, today } from "@/lib/format"
import { useReport } from "@/lib/list"

/// Finance overview — what needs doing, not how the month went.
///
/// ## Why a work queue rather than a dashboard of figures
///
/// Because the figures are on the screens that own them, and repeating them
/// here produces two places a number can be read and one place it can be
/// wrong. What a landing screen can do that no other screen can is say **which
/// of eleven screens to open first** — and that is a different question from
/// any figure.
///
/// So every card here is a count of things somebody has to deal with, and every
/// one of them is a link to the place they are dealt with. A card that is zero
/// is drawn as settled rather than hidden: knowing that nothing is overdue is
/// worth the row, and a card that disappears when it is good teaches people to
/// distrust its absence.
///
/// ## What this endpoint answers, exactly
///
/// `GET /finance/attention` returns four integers for one month:
/// `overdue_bills`, `unmapped_pairs`, `month_not_open` and their sum. It is
/// untyped on the wire — `Json<Value>` in Rust, with no `ts-rs` derive — so the
/// shape below is declared here and will not be checked by the compiler if the
/// server changes it. That is a real gap and it is named rather than papered
/// over: every other read in this module is typed from the contract.
interface Attention {
  readonly overdue_bills: number
  readonly unmapped_pairs: number
  readonly month_not_open: number
  readonly attention: number
}

export function OverviewScreen() {
  const now = today()
  const [year, month] = now.split("-").map(Number)

  const report = useReport<Attention>({
    key: ["finance", "attention"],
    path: "/api/v1/finance/attention",
    params: { year, month },
  })

  const data = report.data

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHead
        module="Finance"
        title="Overview"
        description="What finance has to deal with today, and where each of those things is dealt with."
      />

      <ScopeLine
        scope={{ kind: "asAt", date: now }}
        note="counts for the month in progress"
      />

      {report.isError ? (
        <Failed
          what="the attention counts"
          error={report.error}
          onRetry={() => void report.refetch()}
        />
      ) : report.isPending ? (
        <Loading rows={3} cols={4} />
      ) : (
        <>
          <Tiles>
            <Tile
              label="Needs attention"
              value={count(data?.attention ?? 0)}
              tone={(data?.attention ?? 0) > 0 ? "warn" : "ok"}
              note={
                (data?.attention ?? 0) === 0
                  ? "nothing is waiting"
                  : "the three below, added up"
              }
            />
          </Tiles>

          <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
            <Card
              icon={<AlertTriangle className="size-4" />}
              n={data?.overdue_bills ?? 0}
              title="Bills past their due date"
              settled="No bill is past its due date."
              // The link carries the filter. A card that lands somebody on an
              // unfiltered list has made them do the narrowing twice.
              to="/finance/bills"
              search={{ status: "POSTED" }}
              cta="Open payables"
            />
            <Card
              icon={<Unlink className="size-4" />}
              n={data?.unmapped_pairs ?? 0}
              title="Postings with no account mapped"
              settled="Every posting resolves to an account."
              detail="Until a pair is mapped, the money it moves has nowhere to land — so it is missing from the ledger rather than wrong in it."
              to="/finance/ledger"
              cta="Open the trial balance"
            />
            <Card
              icon={<Lock className="size-4" />}
              n={data?.month_not_open ?? 0}
              title="This month is not open"
              settled="The month is open for posting."
              detail="Nothing new can be posted into a closed period. If that is not deliberate, it is the first thing to fix."
              one
            />
          </div>
        </>
      )}
    </div>
  )
}

function Card({
  icon,
  n,
  title,
  settled,
  detail,
  to,
  search,
  cta,
  one,
}: {
  icon: React.ReactNode
  n: number
  title: string
  /// What to say when the count is zero. Written as a full sentence in the
  /// affirmative — "No bill is past its due date" rather than "0" — because a
  /// zero is read as an absence of information as often as an absence of
  /// problems.
  settled: string
  detail?: string
  to?: string
  search?: Record<string, string>
  cta?: string
  /// A flag rather than a count: "this month is not open" is one fact, and
  /// drawing it as `1` invites somebody to wonder what the other one would be.
  one?: boolean
}) {
  const clear = n === 0
  return (
    <div className="rounded-card border-line-2 bg-canvas shadow-btn flex flex-col border p-3">
      <div className="flex items-start gap-2">
        <span
          className={
            clear
              ? "rounded-tag bg-ok-wash text-ok-ink mt-0.5 grid size-6 shrink-0 place-items-center"
              : "rounded-tag bg-warn-wash text-warn-ink mt-0.5 grid size-6 shrink-0 place-items-center"
          }
        >
          {clear ? <Check className="size-4" /> : icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-cell text-ink font-medium">{title}</div>
          <p className="text-ctl text-ink-3 mt-0.5">
            {clear ? settled : (detail ?? "")}
          </p>
        </div>
        {!clear && !one && (
          <span className="text-metric text-warn-ink font-semibold tabular-nums">
            {count(n)}
          </span>
        )}
      </div>
      {to && !clear && (
        <AppLink
          to={to}
          search={search}
          className="text-ctl text-blue mt-2 inline-flex items-center gap-1 self-start font-medium"
        >
          {cta} <ArrowRight className="size-3.5" />
        </AppLink>
      )}
    </div>
  )
}
