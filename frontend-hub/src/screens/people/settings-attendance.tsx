import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Day } from "@/components/ui/day"
import { Field, Input, Textarea } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { MiniCell, MiniRow, MiniTable } from "@/components/ui/rows"
import { Toolbar } from "@/components/ui/segmented"
import { Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState, Problem } from "@/components/ui/states"
import { count, day } from "@/lib/format"
import {
  MAX_DUPLICATE_PUNCH_WINDOW_MINUTES,
  MAX_LATE_GRACE_MINUTES,
  peopleKeys,
  readAttendancePolicy,
  readMinutes,
  setAttendancePolicy,
} from "@/lib/queries/people"
import { queryState } from "@/lib/query-state"
import { useCanWrite } from "@/lib/session"
import { useOpener } from "@/screens/people/settings-lib"
import { ListCard, SheetFooter } from "@/screens/people/settings-kit"
import type { PolicyVersionView } from "@itulah/contract"

/// Settings › Attendance rules — what "late" means, and who gets to say so.
///
/// Reading the policy is not a privilege: somebody clocking in is entitled to
/// know the tolerance they are measured against. Writing it is head office's,
/// and every version records who decided it and why. A version is never
/// edited — a new one closes the version it supersedes, on the day before it
/// starts, so a month of arrivals can always be judged by the rules of that
/// month.
export function AttendanceRuleSettings() {
  const canWrite = useCanWrite()
  const sheet = useOpener()
  const [asOf, setAsOf] = useState("")

  const schedule = useQuery({
    queryKey: peopleKeys.policy(asOf === "" ? undefined : asOf),
    queryFn: ({ signal }) =>
      readAttendancePolicy(asOf === "" ? undefined : asOf, signal),
  })

  const rows = useMemo(
    () =>
      [...(schedule.data?.versions ?? [])].sort((a, b) =>
        b.effective_from.localeCompare(a.effective_from)
      ),
    [schedule.data]
  )
  const inForce = rows.find((one) => one.in_force) ?? null
  const openFrom =
    rows.length > 0
      ? rows.reduce(
          (latest, one) =>
            one.effective_from > latest ? one.effective_from : latest,
          rows[0].effective_from
        )
      : null

  return (
    <PageContent>
      <PageHeader
        crumb="People"
        title="Attendance rules"
        sub="The tolerances a month of arrivals is judged against. Anybody signed in may read them; only head office may change them."
        actions={
          canWrite && (
            <Button variant="primary" onClick={() => sheet.show()}>
              New version
            </Button>
          )
        }
      />

      <Toolbar>
        <Field label="" className="w-52">
          <Day value={asOf} label="As at" onChange={setAsOf} />
        </Field>
        <Toolbar.Spacer />
        {inForce && (
          <span className="text-[0.875rem] text-mute">
            In force: v{inForce.version}, since {day(inForce.effective_from)}
          </span>
        )}
      </Toolbar>

      {/* `uncovered` is sent rather than derived from the flags, because "no
          version is in force" is the state that matters. */}
      {schedule.data?.uncovered && (
        <Banner tone="bad" className="mb-4">
          No policy version covers {day(schedule.data.as_of)}. Until one does,
          nothing decides whether an arrival that day was late.
        </Banner>
      )}
      {asOf !== "" && (
        <Banner tone="info" className="mb-4" onDismiss={() => setAsOf("")}>
          Showing the schedule as it stood on {day(asOf)}, not today.
        </Banner>
      )}

      <ListCard>
        {queryState(schedule, {
          loading: "Reading the schedule…",
          render: () =>
            rows.length === 0 ? (
              <EmptyState>
                Head office has not decided yet. Until the first version is
                written with New version there is no tolerance to measure
                against.
              </EmptyState>
            ) : (
              <MiniTable
                head={[
                  "Version",
                  "From",
                  "Until",
                  "State",
                  { label: "Late Grace", align: "right" },
                  { label: "Early Leave", align: "right" },
                  { label: "Overtime from", align: "right" },
                  { label: "Duplicate Punch", align: "right" },
                ]}
              >
                {rows.map((row) => (
                  <MiniRow key={`${row.policy_id}-${row.version}`}>
                    <MiniCell>
                      <span className="font-mono text-id text-body">
                        v{row.version}
                      </span>
                    </MiniCell>
                    <MiniCell>{day(row.effective_from)}</MiniCell>
                    <MiniCell>
                      {row.effective_to ? (
                        day(row.effective_to)
                      ) : (
                        <span className="text-mute">Still open</span>
                      )}
                    </MiniCell>
                    <MiniCell>
                      {row.in_force ? (
                        <Pill tone="ok">In force</Pill>
                      ) : (
                        <span className="text-mute">Superseded</span>
                      )}
                    </MiniCell>
                    <MiniCell align="right">
                      {readMinutes(row.late_grace_minutes)}
                    </MiniCell>
                    <MiniCell align="right">
                      {readMinutes(row.early_leave_grace_minutes)}
                    </MiniCell>
                    <MiniCell align="right">
                      {readMinutes(row.overtime_minimum_minutes)}
                    </MiniCell>
                    <MiniCell align="right">
                      {readMinutes(row.duplicate_punch_window_minutes)}
                    </MiniCell>
                  </MiniRow>
                ))}
              </MiniTable>
            ),
        })}
      </ListCard>

      <NewVersionSheet
        key={sheet.n}
        open={sheet.isOpen}
        onClose={sheet.hide}
        openFrom={openFrom}
        current={inForce}
      />
    </PageContent>
  )
}

interface PolicyDraft {
  effectiveFrom: string
  late: string
  early: string
  overtime: string
  duplicate: string
  reason: string
}

/// The ceilings the server enforces, restated so a box refuses before a round
/// trip rather than after one. The server checks them again.
function problemsOf(
  draft: PolicyDraft,
  openFrom: string | null
): Record<"from" | "late" | "duplicate", string | undefined> {
  const late = Number(draft.late)
  const duplicate = Number(draft.duplicate)
  return {
    from:
      draft.effectiveFrom === ""
        ? "A version starts on a day."
        : openFrom !== null && draft.effectiveFrom <= openFrom
          ? `A version already starts on ${day(openFrom)}. A new one supersedes the current one and cannot be slipped in behind it.`
          : undefined,
    late:
      !Number.isInteger(late) || late < 0 || late > MAX_LATE_GRACE_MINUTES
        ? `Between 0 and ${count(MAX_LATE_GRACE_MINUTES)} minutes.`
        : undefined,
    duplicate:
      !Number.isInteger(duplicate) ||
      duplicate < 0 ||
      duplicate > MAX_DUPLICATE_PUNCH_WINDOW_MINUTES
        ? `Between 0 and ${count(MAX_DUPLICATE_PUNCH_WINDOW_MINUTES)} minutes.`
        : undefined,
  }
}

function NewVersionSheet({
  open,
  onClose,
  openFrom,
  current,
}: {
  open: boolean
  onClose: () => void
  openFrom: string | null
  current: PolicyVersionView | null
}) {
  const client = useQueryClient()
  // The tolerances start at whatever is in force, so a version that changes one
  // of them does not silently reset the other three.
  const [draft, setDraft] = useState<PolicyDraft>({
    effectiveFrom: "",
    late: String(current?.late_grace_minutes ?? 15),
    early: String(current?.early_leave_grace_minutes ?? 15),
    overtime: String(current?.overtime_minimum_minutes ?? 30),
    duplicate: String(current?.duplicate_punch_window_minutes ?? 5),
    reason: "",
  })
  const set = (patch: Partial<PolicyDraft>) =>
    setDraft((prev) => ({ ...prev, ...patch }))
  const problems = problemsOf(draft, openFrom)
  const ready =
    draft.reason.trim() !== "" &&
    Object.values(problems).every((one) => one === undefined) &&
    Number.isInteger(Number(draft.early)) &&
    Number.isInteger(Number(draft.overtime))

  const write = useMutation({
    mutationFn: () =>
      setAttendancePolicy({
        effectiveFrom: draft.effectiveFrom,
        lateGraceMinutes: Number(draft.late),
        earlyLeaveGraceMinutes: Number(draft.early),
        overtimeMinimumMinutes: Number(draft.overtime),
        duplicatePunchWindowMinutes: Number(draft.duplicate),
        reason: draft.reason.trim(),
      }),
    onSuccess: () => {
      // Every `as_of` this browser has asked about, because a new version
      // changes which one is in force on any date after it starts.
      void client.invalidateQueries({ queryKey: peopleKeys.policies() })
      onClose()
    },
  })

  const minutes = (
    key: "late" | "early" | "overtime" | "duplicate",
    label: string,
    problem?: string
  ) => (
    <Field label={label} hint="minutes" problem={problem}>
      <Input
        type="number"
        min={0}
        value={draft[key]}
        onChange={(event) => set({ [key]: event.target.value })}
      />
    </Field>
  )

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title="New version"
      footer={
        <SheetFooter
          onCancel={onClose}
          onSave={() => write.mutate()}
          saveLabel="Write the version"
          pendingLabel="Writing…"
          pending={write.isPending}
          disabled={!ready}
        />
      }
    >
      <div className="flex flex-col gap-3.5">
        <Problem error={write.error} />
        <Field
          label="Effective from"
          hint="The first day the new tolerances apply."
          required
          problem={problems.from}
        >
          <Day
            value={draft.effectiveFrom}
            onChange={(next) => set({ effectiveFrom: next })}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          {minutes("late", "Late grace", problems.late)}
          {minutes("early", "Early leave grace")}
          {minutes("overtime", "Overtime from")}
          {minutes("duplicate", "Duplicate punch", problems.duplicate)}
        </div>
        <Field
          label="Reason"
          hint="Recorded with the version. The server refuses one without it."
          required
        >
          <Textarea
            rows={2}
            value={draft.reason}
            onChange={(event) => set({ reason: event.target.value })}
          />
        </Field>
      </div>
    </Sheet>
  )
}
