import type { ColumnDef } from "@tanstack/react-table"
import { AlertTriangle, CalendarRange, MapPin } from "lucide-react"
import type { PayrollRunView, PayrollSlipRow } from "@itulah/contract"

import { ApiError } from "@/lib/api"
import { count, day, rp } from "@/lib/format"
import { useReport } from "@/lib/list"
import { useQueryState } from "@/lib/query-state"
import type { TableSetup } from "@/lib/table"
import { Button } from "@/kit/button"
import { PageHead, Toolbar } from "@/kit/page"
import { Sheet } from "@/kit/sheet"
import { Table } from "@/kit/table"
import { Tag } from "@/kit/tag"
import { Tile, Tiles } from "@/kit/tiles"
import { Empty, Failed, Loading, NoAccess } from "@/kit/state"
import {
  Fact,
  Facts,
  Line,
  Person,
  Quiet,
  SubHead,
} from "@/modules/people/parts"
import { minutes, runStateLabel, runStateTone } from "@/modules/people/labels"

/// Payroll runs — one place, one month, and the two people who sign it.
///
/// ## Read `incomplete_because` before reading a figure
///
/// A run says what it does not know, and `complete` is the field that says
/// whether it knows anything at all. Today it is routinely false: there is no
/// punch source anywhere in the cloud, so nothing here knows what was actually
/// worked. `incomplete_because` carries the SENTENCE for that — written by the
/// server, in words, for a person — and this screen shows it above the figures
/// rather than beside them. A total somebody reads before the caveat is a total
/// they remember.
///
/// It is never collapsed into a tick and a cross. "Incomplete" on its own is a
/// badge; the sentence is the finding.
///
/// ## Nothing here is net
///
/// No tax, no BPJS, no deductions. A slip is the agreement in force plus the
/// facts this system recorded, and the column that would hold a deduction does
/// not exist. Reading `statutory_base_minor` as take-home would be wrong by
/// every statutory rule at once.
///
/// ## This screen signs nothing
///
/// Verify, approve, seal and reopen are four separate routes, each refusing a
/// reason-less body, and the server refuses an approval by the same person who
/// verified — two signatures means two people. Those are writes with real
/// consequences and they belong with the form that collects the reason; until
/// that is written here, this screen reads.
///
/// ## What the endpoint cannot do
///
/// `GET /payroll/runs` takes one optional `place` and nothing else: no period
/// range, no state filter, no cap, no ordering. And there is no route on this
/// surface that LISTS places, so `place` cannot be a picker — it is honoured
/// when a link carries it, and there is a way back out. A drop-down of shops is
/// waiting on an org endpoint, not on this screen.

export function PayrollScreen() {
  const url = useQueryState()
  const place = url.one("place")
  const openId = url.one("run")

  const runs = useReport<PayrollRunView[]>({
    key: ["people", "payroll", "runs"],
    path: "/api/v1/payroll/runs",
    params: { place: place || null },
  })

  const rows = runs.data ?? []
  // Whether there is an ANSWER, as distinct from whether there are rows. The
  // tiles draw an em dash until there is one — `count(null)` is that dash. A
  // tile reading `0 missing something` while the request is still in flight is
  // a reassurance nobody earned, on the screen where reassurance is most
  // expensive.
  const answered = runs.data !== undefined
  const incomplete = answered
    ? rows.filter((row) => !row.complete).length
    : null
  const sealed = answered
    ? rows.filter((row) => row.state === "SEALED").length
    : null

  const columns: ColumnDef<TableSetup, PayrollRunView>[] = [
    {
      id: "period",
      header: "Month",
      size: 13,
      meta: { icon: <CalendarRange className="size-[15px]" />, min: 110 },
      // `YYYY-MM`, as the server spells it, rather than "September 2026". A run
      // is filed, quoted and argued about by its period string, and this is the
      // one place in the app where the machine's spelling is what people say.
      cell: ({ row }) => (
        <span className="text-ink font-mono">{row.original.period}</span>
      ),
    },
    {
      id: "place",
      header: "Place",
      size: 18,
      meta: { icon: <MapPin className="size-[15px]" />, min: 130 },
      cell: ({ row }) => (
        <span className="text-ink-2 truncate font-mono">
          {row.original.place_id}
        </span>
      ),
    },
    {
      id: "state",
      header: "Where it has got to",
      size: 26,
      meta: { min: 220 },
      cell: ({ row }) => (
        <Tag tone={runStateTone(row.original.state)}>
          {runStateLabel(row.original.state)}
        </Tag>
      ),
    },
    {
      id: "known",
      header: "What it knows",
      size: 29,
      // Never dropped. A run's figures mean nothing without this column, and a
      // narrow frame is not a reason to hide the caveat and keep the number.
      meta: { min: 200 },
      cell: ({ row }) =>
        row.original.complete ? (
          <span className="text-ok-ink">Everything the month needs</span>
        ) : (
          <>
            <span className="text-warn-ink flex items-center gap-[5px] font-medium">
              <AlertTriangle className="size-[13px] shrink-0 stroke-[2.2]" />
              Incomplete
            </span>
            {/* The server's own sentence, not a word standing in for it.
                Clipped to the cell here and whole in the sheet — which is why
                the row opens one. */}
            <span
              className="text-label text-ink-4 block truncate"
              title={row.original.incomplete_because ?? undefined}
            >
              {row.original.incomplete_because ??
                "The server did not say what is missing."}
            </span>
          </>
        ),
    },
    {
      id: "verified",
      header: "Checked by",
      size: 14,
      meta: { priority: 1, min: 130 },
      // `null` after a reopen, because the next approval is a fresh pair of
      // signatures. "Nobody yet" rather than a dash: this is a state somebody
      // has to act on, not a field that does not apply.
      cell: ({ row }) =>
        row.original.verified_by === null ? (
          <Quiet>Nobody yet</Quiet>
        ) : (
          <span className="text-label truncate font-mono">
            {row.original.verified_by}
          </span>
        ),
    },
  ]

  const open = rows.find((row) => row.id === openId)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHead
        module="People · Pay"
        title="Payroll runs"
        description="One place, one month, and the two people who sign it. Head office's work: a place manager's whole part in payroll is closing their attendance month."
      />

      <Toolbar
        trailing={
          runs.isPending
            ? "Loading…"
            : `${count(answered ? rows.length : null)} runs`
        }
      >
        {place === "" ? (
          <span className="text-ctl text-ink-3">
            Every place. This route takes one place as a filter and there is no
            endpoint yet that lists them, so it is set by a link rather than
            picked here.
          </span>
        ) : (
          <>
            <span className="text-ctl text-ink-3">
              Only <b className="text-ink-2 font-medium">{place}</b>, from the
              link you followed.
            </span>
            <Button
              variant="quiet"
              onClick={() => url.set({ place: null }, false)}
            >
              Show every place
            </Button>
          </>
        )}
      </Toolbar>

      <Tiles>
        <Tile
          label="Runs"
          value={count(answered ? rows.length : null)}
          note="opened so far"
        />
        <Tile
          label="Missing something"
          value={count(incomplete)}
          tone={incomplete !== null && incomplete > 0 ? "warn" : undefined}
          note={
            incomplete === null
              ? "not counted yet"
              : "read the sentence before the figures"
          }
        />
        <Tile
          label="Sealed"
          value={count(sealed)}
          tone={sealed !== null && sealed > 0 ? "ok" : undefined}
          note={sealed === null ? "not counted yet" : "signed twice and closed"}
        />
      </Tiles>

      {runs.isPending ? (
        <Loading rows={6} cols={columns.length} />
      ) : runs.isError ? (
        runs.error instanceof ApiError && runs.error.status === 403 ? (
          // Payroll is head office's, and the refusal comes from the SERVER —
          // this screen does not decide it from the caller's reach. Reach says
          // which places somebody's data is; whether they may read a payroll
          // run is their rung, re-checked on the route. Pre-empting it here
          // would be a second, weaker copy of the rule.
          <NoAccess
            what="payroll runs"
            reach={
              runs.error.detail ||
              "Payroll is head office's work; a place signs its attendance month instead."
            }
          />
        ) : (
          <Failed
            what="the payroll runs"
            error={runs.error}
            onRetry={() => void runs.refetch()}
          />
        )
      ) : rows.length === 0 ? (
        <Empty
          what="runs"
          detail="No run has been opened. A month has to be signed off in Period close before its payroll can be built — while attendance is open the facts are still moving."
        />
      ) : (
        <Table
          columns={columns}
          rows={rows}
          rowId={(row) => row.id}
          caption="Payroll runs"
          onRowClick={(row) => url.set({ run: row.id }, false)}
          isOpen={(row) => row.id === openId}
          foot={{
            period: (
              <>
                <b className="text-ink">{count(rows.length)}</b> runs
              </>
            ),
            known:
              incomplete === null || incomplete === 0 ? null : (
                <span className="text-warn-ink font-medium">
                  {count(incomplete)} missing something
                </span>
              ),
          }}
        />
      )}

      <RunSheet run={open} onClose={() => url.set({ run: null }, false)} />
    </div>
  )
}

/// One run: the caveat, then the slips, then who signed what.
///
/// In that order deliberately. The slips carry money, and the sentence saying
/// what the month does not know has to be read first or it will not be read.
function RunSheet({
  run,
  onClose,
}: {
  run: PayrollRunView | undefined
  onClose: () => void
}) {
  const slips = useReport<PayrollSlipRow[]>({
    // The run is in the KEY as well as in the path — `useReport` appends only
    // `params`, and these are empty, so one entry would otherwise serve every
    // run and the second one opened would show the first one's slips.
    key: ["people", "payroll", "slips", run?.id ?? ""],
    path: `/api/v1/payroll/runs/${encodeURIComponent(run?.id ?? "")}/slips`,
    params: {},
    enabled: run !== undefined,
  })

  const rows = slips.data ?? []
  const unpayable = rows.filter((row) => !row.payable).length

  return (
    <Sheet
      open={run !== undefined}
      onClose={onClose}
      width="record"
      title={run ? `${run.place_id} · ${run.period}` : "Payroll run"}
      subtitle={run ? runStateLabel(run.state) : undefined}
    >
      {run === undefined ? null : (
        <>
          {!run.complete && (
            <div className="border-line bg-warn-wash text-ctl text-warn-ink flex shrink-0 items-start gap-2 border-b px-[18px] py-3">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>
                <b className="font-medium">This month is not fully known.</b>{" "}
                {run.incomplete_because ??
                  "The server did not say what is missing."}{" "}
                Every figure below is the agreement in force plus what was
                recorded — never what was worked.
              </span>
            </div>
          )}

          <Facts>
            <Fact label="Place">
              <span className="font-mono">{run.place_id}</span>
            </Fact>
            <Fact label="Month">
              <span className="font-mono">{run.period}</span>
            </Fact>
            <Fact label="Where it has got to">
              <Tag tone={runStateTone(run.state)}>
                {runStateLabel(run.state)}
              </Tag>
            </Fact>
            <Fact label="Checked by">
              {run.verified_by === null ? (
                <Quiet>Nobody yet</Quiet>
              ) : (
                <span className="font-mono">{run.verified_by}</span>
              )}
            </Fact>
          </Facts>

          <SubHead>
            Slips{rows.length === 0 ? "" : ` · ${count(rows.length)}`}
            {unpayable > 0 && (
              <span className="text-warn-ink ml-2 font-normal">
                {count(unpayable)} cannot be paid
              </span>
            )}
          </SubHead>

          {slips.isPending ? (
            <Line>
              <Quiet>Reading the slips…</Quiet>
            </Line>
          ) : slips.isError ? (
            <Line note={(slips.error as Error).message}>
              <Quiet>The slips could not be read.</Quiet>
            </Line>
          ) : rows.length === 0 ? (
            <Line>
              <Quiet>This run holds no slips.</Quiet>
            </Line>
          ) : (
            rows.map((slip) => (
              <Line
                key={slip.employee_id}
                note={
                  <>
                    {/* Facts, not money — what this system actually recorded
                        about the month. Kept beside the figure rather than
                        summed anywhere, because a rostered day is not evidence
                        that anybody turned up. */}
                    {slip.rostered_days} rostered · {slip.leave_days_taken} days
                    leave · {minutes(slip.overtime_minutes)} overtime
                    {slip.payable ? (
                      slip.bank_account_masked && (
                        <> · {slip.bank_account_masked}</>
                      )
                    ) : (
                      <span className="text-bad-ink font-medium">
                        {" "}
                        · no account on file, so the whole payment file fails
                      </span>
                    )}
                  </>
                }
              >
                <span className="min-w-0 flex-1">
                  <Person
                    id={slip.employee_id}
                    code={slip.employee_code}
                    name={slip.full_name}
                  />
                </span>
                <span className="shrink-0 text-right">
                  <span className="text-ink block font-medium tabular-nums">
                    {rp(slip.statutory_base_minor)}
                  </span>
                  {/* Base and allowances separately, because the figure above
                      is the one statutory rules are computed AGAINST and it is
                      not what anybody is handed. */}
                  <span className="text-label text-ink-4 block tabular-nums">
                    base {rp(slip.base_minor)}
                    {slip.fixed_allowances.length > 0 &&
                      ` + ${slip.fixed_allowances.length} allowance${slip.fixed_allowances.length === 1 ? "" : "s"}`}
                  </span>
                </span>
              </Line>
            ))
          )}

          <SubHead>Signatures</SubHead>
          {run.history.length === 0 ? (
            <Line>
              <Quiet>Nobody has signed anything yet.</Quiet>
            </Line>
          ) : (
            run.history.map((event, index) => (
              <Line
                key={`${event.step}-${event.at}-${index}`}
                note={event.reason}
              >
                <span className="min-w-0 flex-1 truncate">
                  {event.step.toLowerCase()} — {event.actor}
                </span>
                <span className="text-ink-3 shrink-0">{day(event.at)}</span>
              </Line>
            ))
          )}

          <p className="border-line text-label text-ink-4 mt-auto border-t px-[18px] py-3">
            Nothing on this panel signs, reopens or pays. Verify, approve and
            seal each need a reason the server will not accept without, and the
            second signature has to be a different person — so they belong with
            the form that collects one.
          </p>
        </>
      )}
    </Sheet>
  )
}
