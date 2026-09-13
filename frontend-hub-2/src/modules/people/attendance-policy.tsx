import type { ColumnDef } from "@tanstack/react-table"
import type { PolicyScheduleView, PolicyVersionView } from "@itulah/contract"

import { ApiError } from "@/lib/api"
import { count, day, today } from "@/lib/format"
import { useReport } from "@/lib/list"
import { useQueryState } from "@/lib/query-state"
import type { TableSetup } from "@/lib/table"
import { PageHead, Toolbar } from "@/kit/page"
import { ScopeLine } from "@/kit/scope"
import { Table } from "@/kit/table"
import { Tag } from "@/kit/tag"
import { Empty, Failed, Loading, NoAccess } from "@/kit/state"
import { Measure, Measures, NotAssessed, Quiet } from "@/modules/people/parts"
import { minutes } from "@/modules/people/labels"

/// What "late" means, and who gets to say so.
///
/// ## Reading this is not a privilege
///
/// Somebody being measured against a tolerance is entitled to know what it is:
/// a rule kept from the people it governs is not a rule, it is a trap. So the
/// READ is open to any signed-in caller and the server asks for no key at all.
/// Setting it is `ATTENDANCE_POLICY_SET`, which is head office's — this is the
/// number that decides whether a month of arrivals were late — and that is why
/// the nav row carries `audience: "employer"`. The row is offered to whoever
/// may change the rule; the rule itself is readable by anybody who lands here.
///
/// ## A version is never edited
///
/// Writing a new one closes the version it supersedes, on the day before the
/// new one starts, in the same transaction. A schedule with two open versions
/// does not load back at all, which is why the server refuses a version slipped
/// in behind the current one rather than accepting it and failing later.
///
/// So this screen is a TIMELINE and there is no "edit" anywhere on it. What is
/// in force is the one covering the date being asked about, and the rest is the
/// record of what was in force when.
///
/// ## `uncovered` is sent rather than derived
///
/// "No version is in force on this date" is the state that matters — every
/// figure computed for such a day has no rule behind it — and a browser
/// deriving it from an absence of flags would report it as a loading glitch.
/// The server says so in a field and this screen draws the sentence.
///
/// ## One of the four tolerances currently governs nothing
///
/// The duplicate-punch window is a rule about punches, and there is no punch
/// source anywhere in the cloud. It is drawn as not assessable rather than as a
/// number in force, because a tolerance with nothing to apply to is not a
/// tolerance anybody is being measured against yet — and printing it beside
/// three live ones invites the reader to assume all four are doing work.

export function AttendancePolicyScreen() {
  const url = useQueryState()
  const asOf = url.one("as_of") || today()

  const schedule = useReport<PolicyScheduleView>({
    key: ["people", "attendance-policy"],
    path: "/api/v1/attendance-policy",
    // The one parameter the route declares. `as_of` decides which version the
    // `in_force` flags are computed against, so it is a real question about the
    // past and belongs in the URL like every other narrowing here.
    params: { as_of: asOf },
  })

  const versions = schedule.data?.versions ?? []
  const inForce = versions.find((version) => version.in_force)

  const columns: ColumnDef<TableSetup, PolicyVersionView>[] = [
    {
      id: "version",
      header: "Version",
      size: 11,
      meta: { min: 100 },
      cell: ({ row }) => (
        <span className="text-ink font-mono">v{row.original.version}</span>
      ),
    },
    {
      id: "from",
      header: "From",
      size: 15,
      meta: { min: 120 },
      cell: ({ row }) => day(row.original.effective_from),
    },
    {
      id: "to",
      header: "Until",
      size: 15,
      meta: { min: 120 },
      cell: ({ row }) =>
        row.original.effective_to === null ? (
          // Open-ended, which is what a new version always is: "and from now
          // on". Closing it is what the next version does.
          <Quiet>Still open</Quiet>
        ) : (
          day(row.original.effective_to)
        ),
    },
    {
      id: "state",
      header: "State",
      size: 14,
      meta: { priority: 3, min: 130 },
      cell: ({ row }) =>
        row.original.in_force ? (
          <Tag tone="ok">In force</Tag>
        ) : (
          <Quiet>Superseded</Quiet>
        ),
    },
    {
      id: "late",
      header: "Late grace",
      size: 12,
      meta: { align: "right", min: 110 },
      cell: ({ row }) => minutes(row.original.late_grace_minutes),
    },
    {
      id: "early",
      header: "Early leave",
      size: 12,
      meta: { align: "right", priority: 1, min: 110 },
      cell: ({ row }) => minutes(row.original.early_leave_grace_minutes),
    },
    {
      id: "overtime",
      header: "Overtime from",
      size: 13,
      meta: { align: "right", priority: 2, min: 120 },
      cell: ({ row }) => minutes(row.original.overtime_minimum_minutes),
    },
    {
      id: "duplicate",
      header: "Duplicate punch",
      size: 14,
      meta: { align: "right", priority: 4, min: 130 },
      // Drawn quietly because it governs nothing yet — see the note above. The
      // figure is real and is shown; it is the only column whose value nothing
      // on this backend can currently apply.
      cell: ({ row }) => (
        <Quiet>{minutes(row.original.duplicate_punch_window_minutes)}</Quiet>
      ),
    },
  ]

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHead
        module="People"
        title="Attendance policy"
        description="The tolerances every place is measured against. Set once, centrally, because a shop with its own idea of late is a shop whose attendance cannot be compared with the shop beside it."
      />

      <ScopeLine
        scope={{ kind: "asAt", date: asOf }}
        // Every place, always. There is one schedule on this backend and no
        // route that varies it by place — saying "every unit you reach" would
        // imply somebody else has a different one.
        unit="every place"
        note="The rule in force on this date"
      />

      {schedule.isPending ? (
        <Loading rows={4} cols={columns.length} />
      ) : schedule.isError ? (
        schedule.error instanceof ApiError && schedule.error.status === 403 ? (
          <NoAccess what="the attendance policy" reach={schedule.error.detail} />
        ) : (
          <Failed
            what="the attendance policy"
            error={schedule.error}
            onRetry={() => void schedule.refetch()}
          />
        )
      ) : versions.length === 0 ? (
        <Empty
          what="policy versions"
          // Not an error, and the server is explicit about that: the route
          // exists and the operator simply has not decided yet. Which is worth
          // saying plainly, because until they do there is no tolerance at all.
          detail="Nobody has set a tolerance. Until somebody does, there is no rule saying what counts as late, and no arrival can be judged against one."
        />
      ) : (
        <>
          {schedule.data?.uncovered && (
            <div className="border-warn/40 bg-warn-wash text-ctl text-warn-ink shrink-0 border-b px-4 py-2">
              <b className="font-medium">
                No version was in force on {day(asOf)}.
              </b>{" "}
              The date falls before the first version, or in a gap between two.
              Nothing measured on that day has a rule behind it.
            </div>
          )}

          {inForce !== undefined && <InForce version={inForce} />}

          <Toolbar
            trailing={`${count(versions.length)} ${versions.length === 1 ? "version" : "versions"} on record`}
          >
            <span className="text-ctl text-ink-3">
              A version is never edited. Writing a new one closes the one it
              supersedes, the day before the new one starts.
            </span>
          </Toolbar>

          <Table
            columns={columns}
            rows={versions}
            rowId={(row) => String(row.version)}
            caption="Attendance policy versions"
            isOpen={(row) => row.in_force}
            foot={{
              version: (
                <>
                  <b className="text-ink">{count(versions.length)}</b>{" "}
                  {versions.length === 1 ? "version" : "versions"}
                </>
              ),
            }}
          />
        </>
      )}
    </div>
  )
}

/// The rule actually governing the date being asked about.
///
/// Drawn above the history because it is the question — "what is the tolerance"
/// — and the table below it is the record of how it got there.
function InForce({ version }: { version: PolicyVersionView }) {
  return (
    <Measures>
      <Measure
        label="Late grace"
        note="Arriving inside this is on time"
        tone="ok"
      >
        {minutes(version.late_grace_minutes)}
      </Measure>
      <Measure label="Early leave grace" note="Leaving inside this is a full day">
        {minutes(version.early_leave_grace_minutes)}
      </Measure>
      <Measure label="Overtime counts from" note="Kepmenaker 102/2004 applies above it">
        {minutes(version.overtime_minimum_minutes)}
      </Measure>
      <Measure
        label="Duplicate punch window"
        note={`${minutes(version.duplicate_punch_window_minutes)} on record`}
      >
        {/* The figure is real; nothing can apply it. An em dash with the
            reason, rather than a number that implies a rule is doing work —
            see `NotAssessed` in `parts.tsx`. */}
        <NotAssessed why="There is no punch source anywhere in the cloud, so this tolerance governs nothing yet. The figure on record is in the table below." />
      </Measure>
      <Measure label="In force since" note={`Version ${version.version}`}>
        <span className="text-cell">{day(version.effective_from)}</span>
      </Measure>
    </Measures>
  )
}
