import type { ColumnDef } from "@tanstack/react-table"
import { Clock4 } from "lucide-react"
import type { ShiftView } from "@itulah/contract"

import { ApiError } from "@/lib/api"
import { count } from "@/lib/format"
import { useReport } from "@/lib/list"
import type { TableSetup } from "@/lib/table"
import { PageHead, Toolbar } from "@/kit/page"
import { Table } from "@/kit/table"
import { Tag } from "@/kit/tag"
import { Empty, Failed, Loading, NoAccess } from "@/kit/state"
import { Quiet } from "@/modules/people/parts"
import { minutes } from "@/modules/people/labels"

/// The patterns a roster is built out of.
///
/// ## Why head office sets these and a shop does not
///
/// A shop that could invent its own idea of "Pagi" is a shop whose attendance
/// cannot be compared with the shop beside it: two stores would both report
/// somebody on the morning shift and mean different hours, and every figure
/// folded over both — lateness, planned cost, coverage — would be an average of
/// two different questions. The pattern is the unit the whole company measures
/// in, so it is set once, centrally, exactly like the attendance policy and the
/// holiday calendar it sits beside.
///
/// Reading them needs nothing but a session, and that is deliberate on the
/// server: somebody whose week is built out of these is entitled to know what
/// they are.
///
/// ## Retire, never delete
///
/// A roster day names its shift. Deleting a pattern would leave last March's
/// roster pointing at nothing, and a schedule that cannot be read back cannot
/// answer "was this person supposed to be here". `POST
/// /attendance-shifts/{id}/retirement` takes the pattern out of tomorrow's
/// choices and leaves yesterday legible.
///
/// ## What this list cannot show, and why the count says so
///
/// `GET /attendance-shifts` calls `list_shifts(db, false)` with the
/// include-retired flag hard-coded, and takes **no query parameters at all** —
/// so a retired pattern is invisible on this surface. That matters more than it
/// sounds: a roster day from March may name a pattern that is not in this list,
/// and somebody reading the two together would conclude the roster pointed at
/// nothing. The toolbar says so rather than leaving the list to imply it is
/// complete. Showing them needs a parameter the route does not have.
///
/// ## `planned_work_minutes` is the server's, never recomputed
///
/// It is the span less the unpaid break, and it is what a rostered day is
/// WORTH in paid time. Two arithmetics for one number is one number that will
/// eventually disagree with itself — and this is the one a payroll run reads.

export function ShiftsScreen() {
  const shifts = useReport<ShiftView[]>({
    key: ["people", "shifts"],
    // Genuinely no parameters. The handler takes no `Query` at all.
    path: "/api/v1/attendance-shifts",
    params: {},
  })

  const rows = shifts.data ?? []

  const columns: ColumnDef<TableSetup, ShiftView>[] = [
    {
      id: "name",
      header: "Pattern",
      size: 26,
      meta: { icon: <Clock4 className="size-[15px]" />, min: 170 },
      cell: ({ row }) => (
        <span className="text-ink truncate font-medium">{row.original.name}</span>
      ),
    },
    {
      id: "id",
      header: "Code",
      size: 16,
      // The key a roster day actually stores. It is what somebody reading a
      // March roster against this list would be matching on, so it is a column
      // rather than something to open a panel for.
      meta: { priority: 3, min: 120 },
      cell: ({ row }) => (
        <span className="text-ink-2 truncate font-mono">{row.original.id}</span>
      ),
    },
    {
      id: "span",
      header: "Hours",
      size: 18,
      // Never dropped: it is the pattern, said in the only terms a rota is
      // written in.
      meta: { min: 140 },
      cell: ({ row }) => (
        <span className="text-ink tabular-nums">
          {row.original.starts_at}–{row.original.ends_at}
        </span>
      ),
    },
    {
      id: "midnight",
      header: "Ends",
      size: 14,
      meta: { priority: 2, min: 120 },
      // Stated rather than inferred from `ends_at < starts_at`, exactly as the
      // server refuses to infer it: a shift from 09:00 to 09:00 is either
      // nothing or twenty-four hours, and guessing which is worse than asking.
      cell: ({ row }) =>
        row.original.crosses_midnight ? (
          <Tag tone="info">Next day</Tag>
        ) : (
          <Quiet>Same day</Quiet>
        ),
    },
    {
      id: "break",
      header: "Unpaid break",
      size: 13,
      meta: { align: "right", priority: 1, min: 120 },
      cell: ({ row }) =>
        row.original.unpaid_break_minutes === 0 ? (
          <Quiet>None</Quiet>
        ) : (
          minutes(row.original.unpaid_break_minutes)
        ),
    },
    {
      id: "paid",
      header: "Paid time",
      size: 13,
      // No priority. This is the figure the screen exists for — what a day on
      // this pattern is worth — and a table that hid it to fit would have
      // stopped being the list somebody asked for.
      meta: { align: "right", min: 120 },
      cell: ({ row }) => (
        <span className="text-ink font-medium">
          {minutes(row.original.planned_work_minutes)}
        </span>
      ),
    },
  ]

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHead
        module="People"
        title="Shift patterns"
        description="The hours a rostered day is worth. Set once for every place, because a shop that names its own shifts cannot be compared with the shop beside it."
      />

      <Toolbar
        trailing={
          shifts.data === undefined
            ? "Loading…"
            : `${count(rows.length)} in use`
        }
      >
        <span className="text-ctl text-ink-3">
          In use only. A retired pattern is still named by the roster days it
          produced, and this endpoint has no parameter that would show one.
        </span>
      </Toolbar>

      {shifts.isPending ? (
        <Loading rows={5} cols={columns.length} />
      ) : shifts.isError ? (
        shifts.error instanceof ApiError && shifts.error.status === 403 ? (
          <NoAccess what="shift patterns" reach={shifts.error.detail} />
        ) : (
          <Failed
            what="the shift patterns"
            error={shifts.error}
            onRetry={() => void shifts.refetch()}
          />
        )
      ) : rows.length === 0 ? (
        // There is no narrowing on this screen, so an empty answer can only
        // mean one thing — and the consequence is worth stating, because it is
        // not obvious: without a pattern the Roster screen cannot schedule
        // anybody at all.
        <Empty
          what="shift patterns"
          detail="No pattern is defined, so no day can be scheduled: every scheduled day names the pattern it is worth. A roster can still record rest days and public holidays."
        />
      ) : (
        <Table
          columns={columns}
          rows={rows}
          rowId={(row) => row.id}
          caption="Shift patterns in use"
          foot={{
            name: (
              <>
                <b className="text-ink">{count(rows.length)}</b>{" "}
                {rows.length === 1 ? "pattern" : "patterns"}
              </>
            ),
            paid: (
              // The longest pattern, not a sum. Summing paid time across
              // patterns would be adding up hours nobody works — they are
              // alternatives, not a schedule.
              <span className="tabular-nums">
                longest{" "}
                {minutes(
                  Math.max(...rows.map((row) => row.planned_work_minutes)),
                )}
              </span>
            ),
          }}
        />
      )}
    </div>
  )
}
