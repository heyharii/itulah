import { AppShell, ScreenBody, ScreenHeader, ScreenState } from "@/components/app-shell"
import { Nav } from "@/components/nav"
import { Button } from "@/components/ui/button"
import {
  attendancePolicyKey,
  MAX_DUPLICATE_PUNCH_WINDOW_MINUTES,
  MAX_LATE_GRACE_MINUTES,
  readAttendancePolicy,
  readMinutes,
  setAttendancePolicy,
  type NewPolicy,
} from "@/lib/attendance"
import { useIdentity } from "@/lib/identity"
import { cn } from "@/lib/utils"
import type { PolicyVersionView } from "@itulah/contract"
import { ApiError } from "@itulah/contract/client"
import { useForm, useStore } from "@tanstack/react-form"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link, useNavigate } from "@tanstack/react-router"
import { AlertTriangle, IdCard } from "lucide-react"
import { useMemo, useState } from "react"

/// What counts as late.
///
/// Four numbers, and every one of them decides somebody's pay. So this screen
/// is built around two things that are easy to leave out: the fact that a
/// change is a **new version** rather than an edit — last month's timesheet
/// still folds under last month's rules — and the fact that a date no version
/// covers has **no policy at all**, which the server says out loud rather than
/// papering over with a default.
///
/// That second one is why the banner exists. An operator who has never written
/// a policy is not in a broken state and not in a default state; they are in a
/// state where nothing can be derived, and the only useful thing a screen can
/// do is say so plainly.
export function AttendancePolicyView() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const identity = useIdentity()
  const [drafting, setDrafting] = useState(false)

  const policy = useQuery({
    queryKey: attendancePolicyKey(),
    queryFn: ({ signal }) => readAttendancePolicy(undefined, signal),
  })

  const write = useMutation({
    mutationFn: (draft: NewPolicy) => setAttendancePolicy(draft),
    onSuccess: () => {
      setDrafting(false)
      /// The whole prefix, not `attendancePolicyKey()` alone. Writing a version
      /// closes the one currently open the day before, so every cached answer
      /// under every `as_of` has just changed — this is one of the few writes
      /// that genuinely touches all of them.
      void queryClient.invalidateQueries({ queryKey: ["attendance-policy"] })
    },
  })

  const versions = policy.data?.versions ?? []
  const current = versions.find((version) => version.in_force)
  const canWrite = identity.data?.role === "ADMIN"

  return (
    <AppShell nav={<Nav />}>
      <ScreenHeader
        title="Attendance policy"
        subtitle={
          policy.isPending
            ? "loading…"
            : current
              ? `${readMinutes(current.late_grace_minutes)} of lateness allowed · version ${current.version}`
              : "nothing decided yet"
        }
      >
        <Button
          size="sm"
          variant="outline"
          nativeButton={false}
          render={<Link to="/people" />}
        >
          <IdCard className="size-3.5" />
          People
        </Button>
        {canWrite && !drafting && (
          <Button size="sm" onClick={() => setDrafting(true)}>
            New version
          </Button>
        )}
      </ScreenHeader>

      {policy.data?.uncovered && versions.length > 0 && (
        <Uncovered asOf={policy.data.as_of} />
      )}

      {write.isError && (
        <div className="text-destructive border-b px-3.5 py-2 text-[11.5px]">
          {write.error instanceof ApiError
            ? write.error.message
            : "The version could not be written."}
        </div>
      )}

      {drafting && (
        <Draft
          busy={write.isPending}
          onCancel={() => setDrafting(false)}
          onSubmit={(draft) => write.mutate(draft)}
          previous={current}
        />
      )}

      <ScreenBody>
        {policy.isPending ? (
          <ScreenState>Loading the policy…</ScreenState>
        ) : policy.isError ? (
          <ScreenState
            tone="problem"
            action={
              <Button size="sm" variant="outline" onClick={() => void policy.refetch()}>
                Try again
              </Button>
            }
          >
            {policy.error instanceof ApiError
              ? policy.error.message
              : "The policy could not be loaded."}
          </ScreenState>
        ) : versions.length === 0 ? (
          <ScreenState
            action={
              canWrite ? (
                <Button size="sm" onClick={() => setDrafting(true)}>
                  Decide it
                </Button>
              ) : undefined
            }
          >
            Nobody has decided what counts as late. Until somebody does, no
            attendance can be judged — there is no default, deliberately.
          </ScreenState>
        ) : (
          <ol className="divide-y">
            {[...versions].reverse().map((version) => (
              <VersionRow
                key={version.version}
                version={version}
                onOpenPeople={() => void navigate({ to: "/people" })}
              />
            ))}
          </ol>
        )}
      </ScreenBody>
    </AppShell>
  )
}

/// Today falls in a gap between versions.
///
/// Its own banner rather than a row state, because it is not a property of any
/// version — it is the absence of one, and nothing in the list below can show
/// an absence.
function Uncovered({ asOf }: { asOf: string }) {
  return (
    <div className="flex items-start gap-1.5 border-b bg-amber-50/60 px-3.5 py-2.5 text-[11.5px] dark:bg-amber-950/15">
      <AlertTriangle className="mt-px size-3.5 shrink-0 text-amber-600" />
      <span>
        <span className="font-medium">No version covers {asOf}.</span> Attendance
        on this date cannot be judged: the gap is not filled by the nearest rule,
        and nothing is assumed in its place.
      </span>
    </div>
  )
}

function Limit({ label, minutes }: { label: string; minutes: number }) {
  return (
    <div>
      <div className="text-muted-foreground text-[10.5px]">{label}</div>
      <div className="text-xs tabular-nums">{readMinutes(minutes)}</div>
    </div>
  )
}

function VersionRow({
  version,
  onOpenPeople,
}: {
  version: PolicyVersionView
  onOpenPeople: () => void
}) {
  return (
    <li
      className={cn(
        "px-3.5 py-2.5",
        version.in_force && "border-l-2 border-emerald-500",
      )}
    >
      <div className="mb-1.5 flex items-baseline gap-2">
        <span className="font-mono text-xs font-medium">v{version.version}</span>
        <span className="text-muted-foreground text-[11.5px]">
          {version.effective_from} → {version.effective_to ?? "still in force"}
        </span>
        {version.in_force && (
          <span className="text-[11px] text-emerald-600 dark:text-emerald-400">
            in force
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 sm:grid-cols-4">
        <Limit label="Late allowed" minutes={version.late_grace_minutes} />
        <Limit label="Early leave allowed" minutes={version.early_leave_grace_minutes} />
        <Limit label="Overtime counts after" minutes={version.overtime_minimum_minutes} />
        <Limit
          label="Double-tap window"
          minutes={version.duplicate_punch_window_minutes}
        />
      </div>
      <button
        type="button"
        onClick={onOpenPeople}
        className="text-muted-foreground hover:text-foreground mt-1.5 text-[10.5px] underline underline-offset-2"
      >
        Who this applies to
      </button>
    </li>
  )
}

/// The four fields that are a duration. Named as a union rather than
/// `keyof NewPolicy` so the shared number box cannot be pointed at the date or
/// the reason, which are typed by a person and not clamped to a positive
/// integer.
type MinuteField =
  | "lateGraceMinutes"
  | "earlyLeaveGraceMinutes"
  | "overtimeMinimumMinutes"
  | "duplicatePunchWindowMinutes"

/// The form.
///
/// Pre-filled from the version in force, because a policy change is almost
/// always one number moving — retyping the other three is how the other three
/// get typed wrong.
function Draft({
  previous,
  busy,
  onCancel,
  onSubmit,
}: {
  previous?: PolicyVersionView
  busy: boolean
  onCancel: () => void
  onSubmit: (draft: NewPolicy) => void
}) {
  /// Memoised, and not as a tidiness measure. `useForm` re-applies
  /// `defaultValues` on every render while the form is still untouched, so a
  /// fresh object literal here would keep putting the version in force back
  /// over the numbers somebody is in the middle of changing.
  const defaultValues = useMemo<NewPolicy>(
    () => ({
      effectiveFrom: "",
      lateGraceMinutes: previous?.late_grace_minutes ?? 15,
      earlyLeaveGraceMinutes: previous?.early_leave_grace_minutes ?? 10,
      overtimeMinimumMinutes: previous?.overtime_minimum_minutes ?? 30,
      duplicatePunchWindowMinutes: previous?.duplicate_punch_window_minutes ?? 2,
      reason: "",
    }),
    [previous],
  )

  const form = useForm({
    defaultValues,
    onSubmit: ({ value }) => {
      onSubmit(value)
    },
  })

  /// Judged against what is being typed rather than against what was sent, so
  /// somebody who types 600 is told by the box instead of by a refusal that
  /// arrives after a round trip.
  const values = useStore(form.store, (state) => state.values)
  const tooLate = values.lateGraceMinutes > MAX_LATE_GRACE_MINUTES
  const tooWide = values.duplicatePunchWindowMinutes > MAX_DUPLICATE_PUNCH_WINDOW_MINUTES
  const ready =
    values.effectiveFrom !== "" && values.reason.trim() !== "" && !tooLate && !tooWide

  const number = (label: string, name: MinuteField, problem?: string) => (
    <form.Field name={name}>
      {(field) => (
        <label className="block">
          <span className="text-muted-foreground text-[10.5px]">{label}</span>
          <input
            type="number"
            min={0}
            value={field.state.value}
            onBlur={field.handleBlur}
            onChange={(event) =>
              field.handleChange(Math.max(0, Number(event.target.value) || 0))
            }
            className={cn(
              "bg-background mt-0.5 w-full rounded border px-1.5 py-1 text-xs tabular-nums",
              problem && "border-destructive",
            )}
          />
          {problem && <span className="text-destructive text-[10.5px]">{problem}</span>}
        </label>
      )}
    </form.Field>
  )

  return (
    <div className="space-y-3 border-b px-3.5 py-3">
      <p className="text-[11.5px]">
        A new version, in force from the date you give. The one currently open is
        closed the day before — {" "}
        <span className="text-muted-foreground">
          nothing already judged is re-judged.
        </span>
      </p>

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        <form.Field name="effectiveFrom">
          {(field) => (
            <label className="block">
              <span className="text-muted-foreground text-[10.5px]">In force from</span>
              <input
                type="date"
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
                className="bg-background mt-0.5 w-full rounded border px-1.5 py-1 text-xs"
              />
            </label>
          )}
        </form.Field>
        {number(
          "Late allowed (min)",
          "lateGraceMinutes",
          tooLate
            ? `A grace over ${MAX_LATE_GRACE_MINUTES} minutes covers a shift`
            : undefined,
        )}
        {number("Early leave allowed (min)", "earlyLeaveGraceMinutes")}
        {number("Overtime counts after (min)", "overtimeMinimumMinutes")}
        {number(
          "Double-tap window (min)",
          "duplicatePunchWindowMinutes",
          tooWide
            ? `Two punches over ${MAX_DUPLICATE_PUNCH_WINDOW_MINUTES} minutes apart are two events`
            : undefined,
        )}
      </div>

      <form.Field name="reason">
        {(field) => (
          <label className="block">
            <span className="text-muted-foreground text-[10.5px]">
              Why — recorded against the version, and read by whoever asks later
            </span>
            <input
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.target.value)}
              placeholder="e.g. traffic on the Bandung route, agreed with store managers"
              className="bg-background mt-0.5 w-full rounded border px-1.5 py-1 text-xs"
            />
          </label>
        )}
      </form.Field>

      <div className="flex gap-1.5">
        <Button
          size="sm"
          disabled={!ready || busy}
          onClick={() => void form.handleSubmit()}
        >
          {busy ? "Writing…" : "Write version"}
        </Button>
        <Button size="sm" variant="outline" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
