import { AppShell, ScreenBody, ScreenHeader } from "@/components/app-shell"
import { FinanceNav } from "@/components/finance/finance-nav"
import type { FinanceRoute } from "@/components/finance/finance-nav"
import { Nav } from "@/components/nav"
import {
  financeKeys,
  listAccounts,
  listJournal,
  listPeriods,
  trialBalance,
} from "@/lib/finance"
import { money } from "@/lib/money"
import { cn } from "@/lib/utils"
import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { ArrowRight, CheckCircle2, CircleDashed, TriangleAlert } from "lucide-react"

/// What finance has to deal with, and — right now — what it needs before it can
/// deal with anything.
///
/// # Why this is a readiness board and not a dashboard
///
/// A finance dashboard shows overdue bills, cash position, ageing. None of
/// those exist yet, and a screen of zeroes would read as "nothing is overdue"
/// rather than "nothing is built". So while the module is being assembled this
/// answers the question that is actually live: can the books take a posting
/// yet, and what is stopping them.
///
/// Each tile carries the same four things the reference module insists on — what
/// it is, how much of it there is, whether it needs attention, and the one place
/// to go and act. A tile that cannot say all four is a number, not work.
export function FinanceOverview() {
  const chart = useQuery({
    queryKey: financeKeys.accounts(),
    queryFn: ({ signal }) => listAccounts({}, signal).then((page) => page.rows),
    staleTime: 10 * 60 * 1000,
  })
  const periods = useQuery({
    queryKey: financeKeys.periods(),
    queryFn: ({ signal }) => listPeriods(signal).then((page) => page.rows),
  })
  const journal = useQuery({
    queryKey: financeKeys.journal(),
    queryFn: ({ signal }) =>
      listJournal({ limit: 200 }, signal).then((page) => page.rows),
  })
  const balance = useQuery({
    queryKey: financeKeys.trialBalance(),
    queryFn: ({ signal }) => trialBalance({}, signal),
  })

  const roots = chart.data?.length ?? 0
  const openPeriods = (periods.data ?? []).filter((p) => p.status === "OPEN").length
  const entries = journal.data?.length ?? 0

  return (
    <AppShell nav={<Nav />} section={<FinanceNav />}>
      <ScreenHeader title="Finance" subtitle="CENTRAL FASHION STORE" />
      <ScreenBody card={false} className="flex flex-col">
        <p className="mb-4 max-w-2xl text-[0.75rem] text-[var(--os-body,#74747b)]">
          The books stand on the client's own chart of accounts. Nothing posts until a
          role is linked to an account (in the hub's Account Links) and a month is open — both refusals come from the
          database, and both name what is missing rather than guessing.
        </p>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <Tile
            title="Chart of accounts"
            state={roots === 0 ? "blocked" : "done"}
            figure={roots === 0 ? "not imported" : `${roots} root classes`}
            detail={
              roots === 0
                ? "Run scripts/import-coa.py against the client's master export."
                : "CENTRAL FASHION STORE's own chart, imported verbatim."
            }
            to="/finance/accounts"
            action="Browse the chart"
            loading={chart.isPending}
          />

          <Tile
            title="Open period"
            state={openPeriods === 0 ? "blocked" : "done"}
            figure={openPeriods === 0 ? "none open" : `${openPeriods} open`}
            detail={
              openPeriods === 0
                ? "Nothing can be posted at all until a month is open."
                : "Entries can be posted into the open months."
            }
            to="/finance/periods"
            action="Manage periods"
            loading={periods.isPending}
          />

          <Tile
            title="Journal"
            state={entries === 0 ? "waiting" : "done"}
            figure={entries === 0 ? "empty" : `${entries} entries`}
            detail={
              entries === 0
                ? "Nothing posted yet. Append-only: corrections are reversing entries."
                : "Every entry, newest first, with the lines behind it."
            }
            to="/finance/journal"
            action="Open the journal"
            loading={journal.isPending}
          />

          <Tile
            title="Trial balance"
            state={
              balance.data === undefined
                ? "waiting"
                : balance.data.rows.length === 0
                  ? "waiting"
                  : balance.data.balanced
                    ? "done"
                    : "blocked"
            }
            figure={
              balance.data === undefined || balance.data.rows.length === 0
                ? "nothing posted"
                : money(balance.data.total_debit_minor)
            }
            detail={
              balance.data === undefined || balance.data.rows.length === 0
                ? "Appears as soon as something is posted."
                : balance.data.balanced
                  ? "Debits and credits agree."
                  : "The books do not balance. This needs looking at now."
            }
            to="/finance/trial-balance"
            action="Check the balance"
            loading={balance.isPending}
          />

        </div>
      </ScreenBody>
    </AppShell>
  )
}

type TileState = "done" | "blocked" | "waiting"

/// One piece of work, or one thing standing in its way.
///
/// Three states rather than two. "Blocked" is something a person can go and fix
/// now; "waiting" is something that cannot be fixed yet because it depends on
/// the blocked thing. Colouring both amber would send somebody to a screen
/// where there is nothing for them to do.
function Tile({
  title,
  state,
  figure,
  detail,
  to,
  action,
  loading,
}: {
  title: string
  state: TileState
  figure: string
  detail: string
  to: FinanceRoute
  action: string
  loading: boolean
}) {
  const Icon =
    state === "done" ? CheckCircle2 : state === "blocked" ? TriangleAlert : CircleDashed
  return (
    <div
      className={cn(
        "os-card flex flex-col gap-2 p-[0.9375rem]",
        state === "blocked" && "border-[var(--os-warn,#b7791f)]/40 bg-[var(--os-warn-bg,#f8f1de)]",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-[13px] font-medium">{title}</p>
        <Icon
          className={cn(
            "size-4 shrink-0",
            state === "done"
              ? "text-[var(--os-ok,#2e9e5b)]"
              : state === "blocked"
                ? "text-[var(--os-warn,#b7791f)]"
                : "text-[var(--os-mute,#a6a6ad)]",
          )}
        />
      </div>
      <p
        className={cn(
          "font-mono text-lg leading-none tabular-nums",
          loading && "text-muted-foreground/40",
        )}
      >
        {loading ? "…" : figure}
      </p>
      <p className="text-muted-foreground flex-1 text-[11.5px] leading-snug">{detail}</p>
      <Link
        to={to}
        className="text-foreground/80 hover:text-foreground flex items-center gap-1 text-[11.5px]"
      >
        {action}
        <ArrowRight className="size-3" />
      </Link>
    </div>
  )
}
