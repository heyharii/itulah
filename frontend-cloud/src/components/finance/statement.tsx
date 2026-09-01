import { AppShell, ScreenHeader, ScreenState } from "@/components/app-shell"
import { FinanceNav } from "@/components/finance/finance-nav"
import { Nav } from "@/components/nav"
import { financeKeys, statement, type StatementKind } from "@/lib/finance"
import { money } from "@/lib/money"
import { cn } from "@/lib/utils"
import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { CheckCircle2, TriangleAlert } from "lucide-react"

/// The balance sheet and the profit and loss, built from the client's own root
/// classes.
///
/// # Why the presentation flips the sign and the ledger does not
///
/// The server sends every figure as the ledger holds it: debits positive. That
/// is the honest storage — a balance does not know whether it is about to be
/// printed on a page where liabilities read as positive numbers.
///
/// A statement does know. Liabilities, equity and income are credit-natured, so
/// they are negative in the ledger and are shown flipped here. Doing that in the
/// server would mean the same number came back differently depending on which
/// screen asked, which is how two reports end up disagreeing about a figure
/// they both got right.
export function StatementScreen({
  kind,
  title,
  classes,
  byLocation = false,
}: {
  kind: StatementKind
  title: string
  /// Which of the client's root classes to show. A subset makes an expense
  /// report or a fixed-asset report out of the same statement.
  classes?: readonly string[]
  byLocation?: boolean
}) {
  const report = useQuery({
    queryKey: financeKeys.statement(kind),
    queryFn: ({ signal }) => statement(kind, {}, signal),
  })

  if (report.isPending) {
    return (
      <Frame title={title}>
        <ScreenState>Adding it up…</ScreenState>
      </Frame>
    )
  }
  if (report.error !== null) {
    return (
      <Frame title={title}>
        <ScreenState tone="problem">
          {report.error instanceof Error ? report.error.message : "could not load the statement"}
        </ScreenState>
      </Frame>
    )
  }

  const sections =
    classes === undefined
      ? report.data.sections
      : report.data.sections.filter((section) => classes.includes(section.root_class))
  const anything = sections.some((section) => section.lines.length > 0)
  const window =
    report.data.from === null
      ? `as at ${report.data.to}`
      : `${report.data.from} to ${report.data.to}`

  return (
    <Frame title={title} subtitle={window}>
      {kind === "BALANCE_SHEET" && classes === undefined && (
        <div
          className={cn(
            "flex shrink-0 items-center gap-2 border-b px-3.5 py-2 text-[12px]",
            report.data.out_of_balance_minor === 0 ? "text-emerald-700" : "text-destructive",
          )}
        >
          {report.data.out_of_balance_minor === 0 ? (
            <>
              <CheckCircle2 className="size-4 shrink-0" />
              <span>
                Assets equal liabilities and equity
                {report.data.result_minor !== 0 && (
                  <>
                    , once the period's result of{" "}
                    <span className="font-mono font-medium">
                      {money(-report.data.result_minor)}
                    </span>{" "}
                    is counted — the client keeps it as{" "}
                    <span className="font-mono">3013001003</span> Laba (Rugi) bulan
                    berjalan
                  </>
                )}
                .
              </span>
            </>
          ) : (
            <>
              <TriangleAlert className="size-4 shrink-0" />
              <span>
                Out of balance by {money(Math.abs(report.data.out_of_balance_minor))}. The
                database refuses unbalanced entries, so this needs looking at now.
              </span>
            </>
          )}
        </div>
      )}

      {!anything ? (
        <ScreenState>
          Nothing has been posted to these classes yet, so there is no statement to
          draw. It appears as soon as the first entry lands.
        </ScreenState>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <table className="w-full max-w-3xl text-[13px]">
            <tbody>
              {sections.map((section) => (
                <Section key={section.root_class} section={section} />
              ))}
            </tbody>
          </table>
          {byLocation && (
            <p className="text-muted-foreground max-w-3xl px-3.5 pb-3 text-[11px]">
              Consolidated across all fourteen locations. A per-location split needs the
              same statement asked once per site — not built yet.
            </p>
          )}
        </div>
      )}
    </Frame>
  )
}

/// One root class, with the headings under it that actually moved.
///
/// Indented by the code's own length, because that is the client's ladder:
/// 1 → 3 → 5 → 7. A depth computed any other way would disagree with their
/// chart the first time an account skipped a rung, and six of theirs do.
function Section({
  section,
}: {
  section: {
    root_class: string
    title: string
    lines: readonly { account_code: string; name: string; depth: number; amount_minor: number }[]
    total_minor: number
  }
}) {
  const present = (value: number) => {
    // Credit-natured classes read as positive on a statement. See the note at
    // the top of the file for why the flip lives here and not in the server.
    if (section.root_class === "1" || section.root_class >= "5") return value
    // `-0` is a real JavaScript value and `Intl` renders it as "-Rp 0".
    return value === 0 ? 0 : -value
  }
  return (
    <>
      <tr className="bg-muted/50">
        <td className="px-3.5 py-1.5 text-[11px] font-medium">
          {section.root_class} · {section.title}
        </td>
        <td className="px-3.5 py-1.5 text-right font-mono text-[11px] font-medium tabular-nums">
          {money(present(section.total_minor))}
        </td>
      </tr>
      {section.lines.map((line) => (
        <tr key={line.account_code} className="hover:bg-muted/30 border-b">
          <td
            className="py-1 pr-3"
            style={{ paddingLeft: `${((line.depth - 1) / 2) * 12 + 14}px` }}
          >
            <Link
              to="/finance/ledger"
              search={{ account: line.account_code }}
              className="flex items-baseline gap-2 hover:underline"
            >
              <span className="text-muted-foreground shrink-0 font-mono text-[10.5px] tabular-nums">
                {line.account_code}
              </span>
              <span className={cn("truncate", line.depth <= 3 && "font-medium")}>
                {line.name}
              </span>
            </Link>
          </td>
          <td className="px-3.5 py-1 text-right font-mono tabular-nums">
            {money(present(line.amount_minor))}
          </td>
        </tr>
      ))}
    </>
  )
}

function Frame({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: string
  children: React.ReactNode
}) {
  return (
    <AppShell nav={<Nav />} section={<FinanceNav />}>
      <ScreenHeader title={title} subtitle={subtitle} />
      {children}
    </AppShell>
  )
}
