import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Check } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Status } from "@/components/ui/pill"
import { Banner } from "@/components/ui/states"
import { node } from "@/lib/api"
import { count, money, moment } from "@/lib/format"

/// "Cek pembukuan": the books asked whether they agree, before a month is
/// shut.
///
/// 7Soft's Closing Periode has two rows, Test Validasi Transaksi and Test
/// Validasi Accounting, each with Test and View Problem, and a tick "Setuju
/// abaikan validasi" to close over what they find. This is the one button
/// that replaces both:
///
/// - `POST /finance/integrity/run` asks every control equation now (the same
///   engine the close checklist reads — journals balance, subledgers agree
///   with their control accounts, units net to nil) and answers with what each
///   one said.
/// - `GET /finance/ledger-health` is the list of structural faults the
///   database itself keeps — an entry with no period, a line on a group
///   account — read after the run.
///
/// Findings are listed in place, worst first, with the figure that is off. The
/// tick that waves a finding through is not here on purpose: the close
/// checklist refuses a month over a critical failure and there is no way
/// around it, which is the one place the hub is stricter than 7Soft. Nothing
/// is posted by this button; it reads.
///
/// 7Soft's third row, "Proses saldo awal program ke neraca awal", and the
/// Reproses menu have no equivalent: the ledger is posted when a document is,
/// so there is nothing to reprocess and no opening balance to carry forward
/// by a button.

/// What the engine answers; hand-written because `make contract` has not
/// exported these structs yet.
interface IntegrityResult {
  readonly key: string
  readonly title: string
  readonly area: string
  readonly state: "BALANCED" | "PENDING" | "EXCEPTION" | "BLOCKED" | string
  readonly difference_minor: number
  readonly details: {
    readonly summary: string
    readonly rows: readonly {
      readonly label: string
      readonly expected_minor: number
      readonly actual_minor: number
      readonly difference_minor: number
    }[]
  }
  readonly evaluated_at: string
}

interface IntegrityRun {
  readonly as_of: string
  readonly worst_state: string | null
  readonly failure: string | null
  readonly results: readonly IntegrityResult[]
  readonly open_items: number
}

interface LedgerHealthRow {
  readonly check_kind: string
  readonly subject: string
  readonly subject_scope: string
  readonly detail: string
  readonly unhealthy: boolean
  readonly checked_at: string | null
}

const RANK: Record<string, number> = {
  BLOCKED: 0,
  EXCEPTION: 1,
  PENDING: 2,
  BALANCED: 3,
}

function stateWord(state: string): string {
  switch (state) {
    case "BALANCED":
      return "Agrees"
    case "PENDING":
      return "Waiting"
    case "EXCEPTION":
      return "Off"
    case "BLOCKED":
      return "Cannot be checked"
    default:
      return state
  }
}

function stateTone(state: string): "ok" | "info" | "bad" | "warn" {
  switch (state) {
    case "BALANCED":
      return "ok"
    case "PENDING":
      return "info"
    case "EXCEPTION":
      return "bad"
    default:
      return "warn"
  }
}

const healthKey = ["finance", "ledger-health"] as const

/// The button and, once pressed, what the books said. `asOf` is the day the
/// equations are asked about, `YYYY-MM-DD` — the last day of the month being
/// closed, or today if that is still ahead.
export function BookCheck({ asOf }: { asOf: string }) {
  const client = useQueryClient()

  const run = useMutation({
    mutationFn: async () => {
      const result = await node.post<IntegrityRun>(
        "/api/v1/finance/integrity/run",
        { as_of: asOf }
      )
      // Read after the run, not before: the health view is recomputed by the
      // same night job and a stale answer beside a fresh run would disagree.
      await client.invalidateQueries({ queryKey: healthKey })
      return result
    },
  })

  const health = useQuery({
    queryKey: healthKey,
    queryFn: ({ signal }) =>
      node.get<LedgerHealthRow[]>("/api/v1/finance/ledger-health", { signal }),
    enabled: run.isSuccess,
  })

  const result = run.data
  const faults = (health.data ?? []).filter((row) => row.unhealthy)
  const findings = (result?.results ?? [])
    .filter((one) => one.state !== "BALANCED")
    .sort((a, b) => (RANK[a.state] ?? 9) - (RANK[b.state] ?? 9))
  const agreeing = (result?.results ?? []).length - findings.length
  const clean =
    result !== undefined &&
    findings.length === 0 &&
    faults.length === 0 &&
    result.failure === null

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Button
          variant="primary"
          pending={run.isPending}
          onClick={() => run.mutate()}
        >
          Cek pembukuan
        </Button>
        {result !== undefined && (
          <span className="text-[0.9375rem] text-mute">
            As of {moment(result.as_of)} · {count(agreeing)} of{" "}
            {count(result.results.length)} agree
          </span>
        )}
      </div>

      {run.isError && (
        <Banner tone="bad">
          {run.error instanceof Error
            ? run.error.message
            : "The books could not be checked."}
        </Banner>
      )}

      {result?.failure != null && <Banner tone="bad">{result.failure}</Banner>}

      {clean && (
        <p className="flex items-center gap-2 text-[0.9375rem] text-ok-fg">
          <Check className="size-4 stroke-[2.25]" />
          Every equation agrees and the ledger holds no fault.
        </p>
      )}

      {findings.length > 0 && (
        <ul className="divide-y divide-hairline rounded-card border border-hairline">
          {findings.map((one) => (
            <li key={one.key} className="flex flex-col gap-1.5 px-4 py-3">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="text-[0.9375rem] font-medium text-ink">
                  {one.title}
                </span>
                <Status tone={stateTone(one.state)}>
                  {stateWord(one.state)}
                </Status>
                {one.difference_minor !== 0 && (
                  <span className="text-[0.9375rem] font-medium text-bad-fg tabular-nums">
                    {money(one.difference_minor)}
                  </span>
                )}
              </div>
              <p className="text-[0.9375rem] text-body">
                {one.details.summary}
              </p>
              {one.details.rows.length > 0 && (
                <ul className="flex flex-col gap-0.5 text-[0.9375rem] text-mute">
                  {one.details.rows.slice(0, 8).map((row) => (
                    <li
                      key={row.label}
                      className="flex justify-between gap-4 tabular-nums"
                    >
                      <span>{row.label}</span>
                      <span>{money(row.difference_minor)}</span>
                    </li>
                  ))}
                  {one.details.rows.length > 8 && (
                    <li>and {count(one.details.rows.length - 8)} more</li>
                  )}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}

      {faults.length > 0 && (
        <ul className="divide-y divide-hairline rounded-card border border-hairline">
          {faults.map((row) => (
            <li
              key={`${row.check_kind}:${row.subject}`}
              className="flex flex-col gap-0.5 px-4 py-3"
            >
              <span className="text-[0.9375rem] font-medium text-ink">
                {row.check_kind.replaceAll("_", " ")} · {row.subject}
              </span>
              <span className="text-[0.9375rem] text-body">{row.detail}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
