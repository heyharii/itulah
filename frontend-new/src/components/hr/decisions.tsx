import { useState } from "react"
import { z } from "zod"

import { useAppForm } from "@/shared/form"
import { Icon, paths } from "@/components/dashboard/parts"
import { SheetShell, sheetButton } from "@/components/dashboard/sheet-shell"
import { Avatar, KIND_ICON } from "@/components/hr/parts"
import { LOCATIONS, allEmployees, employeeOf, locationOf, locationStats } from "@/components/hr/data"
import {
  changedFields,
  DAY_STATUS,
  payrollTotal,
  rupiah,
  useHr,
  type Payslip,
  type PayrollRun,
  type PayrollSubmission,
  type RecordChange,
  type PeopleRequest,
} from "@/components/hr/store"
import { VirtualRows } from "@/shared/table"
import { cn } from "@/lib/utils"

const LOCATION_PAYROLL_COLUMNS = "190px 118px minmax(0,1fr) 126px"

const DECIDER = "People"

const SUBMISSION_META: Record<PayrollSubmission["status"], { label: string; hue: string }> = {
  draft: { label: "In progress", hue: "var(--ink-4)" },
  submitted: { label: "Handed in", hue: "var(--honey)" },
  returned: { label: "Sent back", hue: "var(--ember)" },
  approved: { label: "Approved", hue: "var(--grass)" },
}

/** The three things Head Office decides: who joins, who leaves, and payroll. */
export function Decisions({ onOpenLocation }: { onOpenLocation: (id: string) => void }) {
  const {
    requests,
    payroll,
    decideRequest,
    releasePayroll,
    netFor,
    payslipsFor,
    submissionFor,
    returnPayroll,
    approveSubmission,
    fixes,
    decideFix,
    changes,
    decideChange,
  } = useHr()
  const [open, setOpen] = useState<PeopleRequest | null>(null)
  const [payrollSheet, setPayrollSheet] = useState<PayrollRun | null>(null)
  const [openLocation, setOpenLocation] = useState<string | null>(null)
  const [changeSheet, setChangeSheet] = useState<RecordChange | null>(null)

  const pending = requests.filter((r) => r.status === "pending")
  const hires = pending.filter((r) => r.kind === "hire")
  const exits = pending.filter((r) => r.kind === "exit")
  const settled = requests.filter((r) => r.status !== "pending")
  const pendingPayroll = payroll.filter((p) => p.status !== "released")
  const openRun = payroll.find((p) => p.status !== "released")
  const prepared = LOCATIONS.map((l) => ({
    location: l,
    submission: submissionFor(openRun?.id ?? "", l.id),
    net: netFor(l.id),
  }))
  const notApproved = prepared.filter((row) => row.submission.status !== "approved")
  const pendingFixes = fixes.filter((f) => f.status === "pending")
  const pendingChanges = changes.filter((c) => c.status === "pending")

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="grid gap-3 p-3.5 lg:grid-cols-2">
        <Queue
          title="New hires"
          hint="Stores asking to fill a gap against plan"
          icon={paths.plus}
          requests={hires}
          onOpen={(r) => setOpen(r)}
          empty="No hiring requests waiting."
        />
        <Queue
          title="Leavers"
          hint="Exits to confirm before the last working day"
          icon={paths.close}
          requests={exits}
          onOpen={(r) => setOpen(r)}
          empty="No exits waiting."
        />
      </div>

      {/* a store keeps its own team's details current; the record only moves
          once Head Office has read what changed */}
      {pendingChanges.length > 0 && (
        <div className="px-3.5 pb-3.5">
          <section className="overflow-hidden rounded-panel border border-line-strong">
            <div className="flex items-center gap-2 border-b border-line px-3.5 py-2.5">
              <span>
                <span className="block text-[12.5px] font-semibold text-ink">People records</span>
                <span className="block text-[11px] text-ink-4">
                  New joiners and corrections waiting to be written in
                </span>
              </span>
              <span className="ml-auto grid h-[18px] min-w-[18px] place-items-center rounded-full bg-accent px-1.5 font-mono text-[10.5px] font-semibold text-white">
                {pendingChanges.length}
              </span>
            </div>

            {pendingChanges.map((change) => {
              const before = employeeOf(change.employeeId ?? null)
              const diff = changedFields(before, change.draft)
              return (
                <button
                  key={change.id}
                  type="button"
                  onClick={() => setChangeSheet(change)}
                  className="flex w-full items-center gap-3 border-b border-line px-3.5 py-2.5 text-left transition-colors last:border-b-0 hover:bg-hover"
                >
                  {before ? (
                    <Avatar employee={before} size={26} />
                  ) : (
                    <span className="grid size-[26px] shrink-0 place-items-center rounded-full bg-accent-tint text-accent-ink">
                      <Icon path={paths.plus} size={14} width={2.2} />
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] font-medium text-ink">
                      {change.kind === "add" ? `New joiner — ${change.draft.name}` : change.draft.name}
                    </span>
                    <span className="block truncate text-[11px] text-ink-4">
                      {change.kind === "add"
                        ? `${change.draft.role} · ${locationOf(change.locationId)?.name}`
                        : diff.map((row) => row.field).join(", ") || "No fields changed"}
                      {" · by "}
                      {change.raisedBy}
                    </span>
                  </span>
                  <span className="shrink-0 font-mono text-[11px] text-ink-4">{change.age}d</span>
                  <Icon path={paths.chevronRight} size={14} width={2} className="shrink-0 text-ink-4" />
                </button>
              )
            })}
          </section>
        </div>
      )}

      {/* corrections a store raised after its payroll had already gone up */}
      {pendingFixes.length > 0 && (
        <div className="px-3.5 pb-3.5">
          <section className="overflow-hidden rounded-panel border border-line-strong">
            <div className="flex items-center gap-2 border-b border-line px-3.5 py-2.5">
              <span>
                <span className="block text-[12.5px] font-semibold text-ink">
                  Attendance corrections
                </span>
                <span className="block text-[11px] text-ink-4">
                  Days a store wants changed after payroll was handed in
                </span>
              </span>
              <span className="ml-auto grid h-[18px] min-w-[18px] place-items-center rounded-full bg-honey px-1.5 font-mono text-[10.5px] font-semibold text-ink">
                {pendingFixes.length}
              </span>
            </div>

            {pendingFixes.map((fix) => {
              const person = employeeOf(fix.employeeId)
              return (
                <div
                  key={fix.id}
                  className="flex items-center gap-3 border-b border-line px-3.5 py-2.5 last:border-b-0"
                >
                  {person && <Avatar employee={person} size={26} />}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] font-medium text-ink">
                      {person?.name}
                      <span className="font-normal text-ink-4">
                        {" · "}
                        {new Date(`${fix.date}T12:00:00`).toLocaleDateString("en-GB", {
                          day: "numeric",
                          month: "short",
                        })}
                      </span>
                    </span>
                    <span className="block truncate text-[11px] text-ink-4">
                      {fix.note} · {fix.raisedBy}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5 text-[11px] font-medium">
                    <span
                      style={{ background: DAY_STATUS[fix.claim].hue }}
                      className="size-2 rounded-full"
                    />
                    {DAY_STATUS[fix.claim].label}
                  </span>
                  <span className="flex w-[104px] shrink-0 justify-end gap-1">
                    <button
                      type="button"
                      onClick={() => decideFix(fix.id, "declined", DECIDER)}
                      className="inline-flex h-[26px] items-center rounded-control px-2 text-[11px] font-medium text-ink-3 transition-colors hover:bg-hover hover:text-ember"
                    >
                      Reject
                    </button>
                    <button
                      type="button"
                      onClick={() => decideFix(fix.id, "approved", DECIDER)}
                      className="inline-flex h-[26px] items-center rounded-control bg-ink px-2 text-[11px] font-medium text-white transition-opacity hover:opacity-90"
                    >
                      Approve
                    </button>
                  </span>
                </div>
              )
            })}
          </section>
        </div>
      )}

      {/* every location prepares its own payroll; Head Office reads what the
          system worked out and either approves it or sends it back */}
      <div className="px-3.5 pb-3.5">
        <section className="overflow-hidden rounded-panel border border-line-strong">
          <div className="flex items-center gap-2 border-b border-line px-3.5 py-2.5">
            <span>
              <span className="block text-[12.5px] font-semibold text-ink">
                Payroll preparation
              </span>
              <span className="block text-[11px] text-ink-4">
                What each location has handed in for {openRun?.period.toLowerCase()}
              </span>
            </span>
            {notApproved.length > 0 && (
              <span className="ml-auto grid h-[18px] min-w-[18px] place-items-center rounded-full bg-honey px-1.5 font-mono text-[10.5px] font-semibold text-ink">
                {notApproved.length}
              </span>
            )}
          </div>

          {prepared.map(({ location, submission, net }) => {
            const meta = SUBMISSION_META[submission.status]
            return (
              <button
                key={location.id}
                type="button"
                disabled={submission.status === "draft"}
                onClick={() => setOpenLocation(location.id)}
                className="flex w-full items-center gap-3 border-b border-line px-3.5 py-2.5 text-left transition-colors last:border-b-0 hover:bg-hover disabled:cursor-default disabled:hover:bg-transparent"
              >
                <Icon
                  path={KIND_ICON[location.kind]}
                  size={15}
                  width={1.8}
                  className="shrink-0 text-ink-4"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-medium text-ink">
                    {location.name}
                  </span>
                  <span className="block truncate text-[11px] text-ink-4">
                    {submission.status === "draft"
                      ? "Still being prepared in store"
                      : submission.status === "returned"
                        ? `Sent back — ${submission.note}`
                        : `Handed in by ${submission.submittedBy}`}
                  </span>
                </span>
                <span className="shrink-0 font-mono text-[12.5px] tabular-nums text-ink-2">
                  {rupiah(net)}
                </span>
                <span
                  style={{ color: meta.hue }}
                  className="flex w-[110px] shrink-0 items-center justify-end gap-1.5 text-[11px] font-medium"
                >
                  <span style={{ background: meta.hue }} className="size-1.5 rounded-full" />
                  {meta.label}
                </span>
              </button>
            )
          })}
        </section>
      </div>

      {/* payroll is a single decision per period, not a queue of rows */}
      <div className="px-3.5 pb-3.5">
        <section className="overflow-hidden rounded-panel border border-line-strong">
          <div className="flex items-center gap-2 border-b border-line px-3.5 py-2.5">
            <span>
              <span className="block text-[12.5px] font-semibold text-ink">Payroll</span>
              <span className="block text-[11px] text-ink-4">
                Released once per period, for every location at once
              </span>
            </span>
            {pendingPayroll.length > 0 && (
              <span className="ml-auto grid h-[18px] min-w-[18px] place-items-center rounded-full bg-accent px-1.5 font-mono text-[10.5px] font-semibold text-white">
                {pendingPayroll.length}
              </span>
            )}
          </div>

          {payroll.map((run) => (
            <button
              key={run.id}
              type="button"
              onClick={() => setPayrollSheet(run)}
              className="flex w-full items-center gap-3 border-b border-line px-3.5 py-3 text-left transition-colors last:border-b-0 hover:bg-hover"
            >
              <span className="grid size-[30px] shrink-0 place-items-center rounded-panel bg-inset text-ink-3 shadow-[inset_0_0_0_1px_var(--line)]">
                <Icon path={paths.doc} size={15} width={1.8} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-ink">{run.period}</span>
                <span className="block truncate text-[11px] text-ink-4">
                  {Object.keys(run.byLocation).length} locations
                  {run.releasedBy && ` · released by ${run.releasedBy}`}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block font-mono text-[13px] font-medium tabular-nums text-ink">
                  {rupiah(
                    run.status === "released"
                      ? payrollTotal(run)
                      : prepared.reduce((sum, row) => sum + row.net, 0)
                  )}
                </span>
                <span
                  className={cn(
                    "block text-[11px]",
                    run.status === "released" ? "text-grass" : "text-honey"
                  )}
                >
                  {run.status === "released" ? "Released" : "Awaiting release"}
                </span>
              </span>
            </button>
          ))}
        </section>
      </div>

      {settled.length > 0 && (
        <div className="px-3.5 pb-4">
          <div className="pb-2 text-[10.5px] font-semibold tracking-[0.05em] text-ink-4 uppercase">
            Decided
          </div>
          <ul className="overflow-hidden rounded-panel border border-line-strong">
            {settled.map((r) => (
              <li
                key={r.id}
                className="flex items-center gap-2.5 border-b border-line px-3 py-2 text-xs last:border-b-0"
              >
                <Icon
                  path={r.status === "approved" ? paths.check : paths.close}
                  size={13}
                  width={2.4}
                  className={cn("shrink-0", r.status === "approved" ? "text-grass" : "text-ember")}
                />
                <span className="min-w-0 flex-1 truncate text-ink-2">
                  {r.kind === "hire" ? `Hire ${r.role}` : `Exit ${employeeOf(r.employeeId ?? null)?.name}`}
                  <span className="text-ink-4"> · {locationOf(r.locationId)?.name}</span>
                </span>
                <span className="shrink-0 text-[11px] text-ink-4">by {r.decidedBy}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* one request, with the staffing picture behind it */}
      <RequestSheet
        request={open}
        onOpenLocation={onOpenLocation}
        onClose={() => setOpen(null)}
        onDecide={(id, status, note) => decideRequest(id, status, DECIDER, note || undefined)}
      />

      {/* what exactly is being written, before it is written */}
      <SheetShell
        open={Boolean(changeSheet)}
        eyebrow={changeSheet?.kind === "add" ? "New joiner" : "Record correction"}
        title={changeSheet?.draft.name ?? ""}
        onRequestClose={() => setChangeSheet(null)}
        footer={
          <>
            <span className="flex-1" />
            <button
              type="button"
              onClick={() => {
                if (changeSheet) decideChange(changeSheet.id, "declined", DECIDER)
                setChangeSheet(null)
              }}
              className="inline-flex h-[30px] items-center gap-1.5 rounded-control bg-surface px-2.5 text-xs font-medium text-ember shadow-btn transition-colors hover:bg-hover"
            >
              Decline
            </button>
            <button
              type="button"
              onClick={() => {
                if (changeSheet) decideChange(changeSheet.id, "approved", DECIDER)
                setChangeSheet(null)
              }}
              className={sheetButton.primary}
            >
              <Icon path={paths.check} size={14} width={2.2} />
              {changeSheet?.kind === "add" ? "Add to the directory" : "Apply the change"}
            </button>
          </>
        }
      >
        {changeSheet && <ChangeDetail change={changeSheet} />}
      </SheetShell>

      <LocationPayrollSheet
        locationId={openLocation}
        period={openRun?.period ?? ""}
        locationName={locationOf(openLocation ?? "")?.name ?? ""}
        payslips={openLocation ? payslipsFor(openLocation) : []}
        onClose={() => setOpenLocation(null)}
        onApprove={() =>
          openLocation && approveSubmission(openRun?.id ?? "", openLocation, DECIDER)
        }
        onReturn={(note) =>
          openLocation && returnPayroll(openRun?.id ?? "", openLocation, DECIDER, note)
        }
      />

      <SheetShell
        open={Boolean(payrollSheet)}
        size="wide"
        eyebrow="Payroll"
        title={payrollSheet?.period ?? ""}
        onRequestClose={() => setPayrollSheet(null)}
        footer={
          <>
            {payrollSheet?.status !== "released" && notApproved.length > 0 ? (
              <span className="flex-1 truncate text-[11.5px] text-ember">
                {notApproved.length} location{notApproved.length === 1 ? "" : "s"} not approved yet
              </span>
            ) : (
              <span className="flex-1" />
            )}
            <button
              type="button"
              onClick={() => setPayrollSheet(null)}
              className={sheetButton.secondary}
            >
              Close
            </button>
            {payrollSheet?.status !== "released" && (
              <button
                type="button"
                disabled={notApproved.length > 0}
                onClick={() => {
                  if (payrollSheet) releasePayroll(payrollSheet.id, DECIDER)
                  setPayrollSheet(null)
                }}
                className={cn(
                  sheetButton.primary,
                  "disabled:pointer-events-none disabled:opacity-45"
                )}
              >
                <Icon path={paths.check} size={14} width={2.2} />
                Release payroll
              </button>
            )}
          </>
        }
      >
        {payrollSheet && <PayrollDetail run={payrollSheet} rows={prepared} />}
      </SheetShell>
    </div>
  )
}

function Queue({
  title,
  hint,
  icon,
  requests,
  onOpen,
  empty,
}: {
  title: string
  hint: string
  icon: React.ReactNode
  requests: PeopleRequest[]
  onOpen: (request: PeopleRequest) => void
  empty: string
}) {
  return (
    <section className="overflow-hidden rounded-panel border border-line-strong">
      <div className="flex items-center gap-2 border-b border-line px-3.5 py-2.5">
        <Icon path={icon} size={14} width={2} className="shrink-0 text-ink-4" />
        <span className="min-w-0">
          <span className="block truncate text-[12.5px] font-semibold text-ink">{title}</span>
          <span className="block truncate text-[11px] text-ink-4">{hint}</span>
        </span>
        {requests.length > 0 && (
          <span className="ml-auto grid h-[18px] min-w-[18px] place-items-center rounded-full bg-accent px-1.5 font-mono text-[10.5px] font-semibold text-white">
            {requests.length}
          </span>
        )}
      </div>

      {requests.length === 0 ? (
        <div className="px-3.5 py-8 text-center text-[11.5px] text-ink-4">{empty}</div>
      ) : (
        <ul>
          {requests.map((r) => {
            const person = employeeOf(r.employeeId ?? null)
            const location = locationOf(r.locationId)
            const stats = locationStats(r.locationId)
            return (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => onOpen(r)}
                  className="flex w-full items-start gap-2.5 border-b border-line px-3 py-2.5 text-left transition-colors last:border-b-0 hover:bg-hover"
                >
                  {person ? (
                    <Avatar employee={person} size={30} />
                  ) : (
                    <span className="grid size-[30px] shrink-0 place-items-center rounded-full bg-inset text-ink-4 shadow-[inset_0_0_0_1px_var(--line)]">
                      <Icon path={paths.people} size={14} width={1.8} />
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium text-ink">
                      {person ? person.name : r.role}
                    </span>
                    <span className="block truncate text-[11px] text-ink-4">
                      {location?.name} · raised by {r.raisedBy}
                    </span>
                    <span className="mt-1 block truncate text-[11px] text-ink-3">{r.reason}</span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block font-mono text-[10.5px] text-ink-4">{r.age}d</span>
                    {stats.gap > 0 && (
                      <span className="block font-mono text-[10.5px] text-ember">−{stats.gap}</span>
                    )}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

const decisionNoteInput = z.object({ note: z.string() })

/** one request, with the staffing picture behind it. Approving and declining
 *  both carry whatever note was typed — there is no rule requiring one. */
function RequestSheet({
  request,
  onOpenLocation,
  onClose,
  onDecide,
}: {
  request: PeopleRequest | null
  onOpenLocation: (id: string) => void
  onClose: () => void
  onDecide: (id: string, status: "approved" | "declined", note: string) => void
}) {
  return (
    <SheetShell
      open={Boolean(request)}
      eyebrow={request?.kind === "hire" ? "Hiring request" : "Exit request"}
      title={
        request?.kind === "hire"
          ? (request?.role ?? "")
          : (employeeOf(request?.employeeId ?? null)?.name ?? "")
      }
      onRequestClose={onClose}
      footer={null}
    >
      {request && (
        <RequestForm
          key={request.id}
          request={request}
          onOpenLocation={onOpenLocation}
          onClose={onClose}
          onDecide={onDecide}
        />
      )}
    </SheetShell>
  )
}

function RequestForm({
  request,
  onOpenLocation,
  onClose,
  onDecide,
}: {
  request: PeopleRequest
  onOpenLocation: (id: string) => void
  onClose: () => void
  onDecide: (id: string, status: "approved" | "declined", note: string) => void
}) {
  const form = useAppForm({
    defaultValues: { note: "" },
    validators: { onChange: decisionNoteInput },
    onSubmit: async () => {},
  })

  const decide = (status: "approved" | "declined") => {
    onDecide(request.id, status, form.state.values.note.trim())
    onClose()
  }

  return (
    <div className="flex min-h-full flex-col">
      <div className="flex-1">
        <form.AppField name="note">
          {(field) => (
            <RequestDetail
              request={request}
              note={field.state.value}
              onNote={field.handleChange}
              onOpenLocation={onOpenLocation}
            />
          )}
        </form.AppField>
      </div>
      <div className="flex shrink-0 items-center gap-2 border-t border-line px-3.5 py-3">
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => decide("declined")}
          className="inline-flex h-[30px] items-center gap-1.5 rounded-control bg-surface px-2.5 text-xs font-medium text-ember shadow-btn transition-colors hover:bg-hover"
        >
          Decline
        </button>
        <button type="button" onClick={() => decide("approved")} className={sheetButton.primary}>
          <Icon path={paths.check} size={14} width={2.2} />
          Approve
        </button>
      </div>
    </div>
  )
}

function RequestDetail({
  request,
  note,
  onNote,
  onOpenLocation,
}: {
  request: PeopleRequest
  note: string
  onNote: (v: string) => void
  onOpenLocation: (id: string) => void
}) {
  const person = employeeOf(request.employeeId ?? null)
  const stats = locationStats(request.locationId)
  const location = stats.location

  return (
    <div className="px-[18px] pt-4 pb-[18px]">
      {person && (
        <div className="flex items-center gap-3 pb-4">
          <Avatar employee={person} size={44} />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{person.name}</div>
            <div className="truncate text-xs text-ink-4">
              {person.role} · {person.division}
            </div>
          </div>
        </div>
      )}

      {/* the staffing picture that makes the decision obvious */}
      <button
        type="button"
        onClick={() => onOpenLocation(request.locationId)}
        className="mb-4 flex w-full items-center gap-2.5 rounded-panel bg-inset px-3 py-2.5 text-left shadow-[inset_0_0_0_1px_var(--line)] transition-colors hover:bg-hover"
      >
        <Icon
          path={KIND_ICON[location?.kind ?? "store"]}
          size={16}
          width={1.8}
          className="shrink-0 text-ink-3"
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12.5px] font-medium text-ink">{location?.name}</span>
          <span className="block truncate text-[11px] text-ink-4">
            {stats.headcount} of {stats.plan} filled
            {stats.gap > 0 && ` · ${stats.gap} short`}
            {stats.overtime > 0 && ` · ${stats.overtime} over on overtime`}
          </span>
        </span>
        <Icon path={paths.chevronRight} size={14} width={2} className="shrink-0 text-ink-4" />
      </button>

      {[
        { label: "Raised by", value: request.raisedBy },
        { label: "Waiting", value: `${request.age} days` },
        ...(request.role ? [{ label: "Role", value: request.role }] : []),
      ].map((row) => (
        <div key={row.label} className="flex items-start gap-3 border-t border-line py-[9px]">
          <span className="w-[92px] shrink-0 pt-px text-xs text-ink-4">{row.label}</span>
          <span className="min-w-0 flex-1 text-xs font-medium text-ink-2">{row.value}</span>
        </div>
      ))}

      <div className="border-t border-b border-line py-[9px]">
        <div className="flex items-start gap-3">
          <span className="w-[92px] shrink-0 pt-px text-xs text-ink-4">Reason</span>
          <span className="min-w-0 flex-1 text-xs leading-[1.55] text-ink-2">{request.reason}</span>
        </div>
      </div>

      <label htmlFor="decision-note" className="mt-4 block pb-1.5 text-xs font-medium text-ink-2">
        Decision note <span className="font-normal text-ink-4">optional</span>
      </label>
      <textarea
        id="decision-note"
        value={note}
        onChange={(e) => onNote(e.target.value)}
        placeholder="What the store should know…"
        className="min-h-[76px] w-full resize-y rounded-control bg-field px-2.5 py-2 text-[13px] leading-[1.55] font-medium text-ink shadow-[inset_0_0_0_1px_var(--line-strong)] outline-none focus:bg-surface focus:shadow-[inset_0_0_0_1px_var(--accent),0_0_0_3px_var(--accent-tint)]"
      />
    </div>
  )
}

function ChangeDetail({ change }: { change: RecordChange }) {
  const before = employeeOf(change.employeeId ?? null)
  const diff = changedFields(before, change.draft)
  const rule = "border-b border-b-[color-mix(in_srgb,var(--line)_78%,transparent)]"

  const rows =
    change.kind === "add"
      ? [
          { field: "Role", from: "—", to: change.draft.role },
          { field: "Division", from: "—", to: change.draft.division },
          { field: "Location", from: "—", to: locationOf(change.draft.locationId)?.name ?? "—" },
          { field: "Employment", from: "—", to: change.draft.employmentType },
          { field: "Contract ends", from: "—", to: change.draft.contractEndsOn ?? "—" },
        ]
      : diff

  return (
    <div className="px-4 py-4">
      <div className="mb-3 rounded-panel bg-inset px-3 py-2.5 text-[11.5px] leading-[1.5] text-ink-3 shadow-[inset_0_0_0_1px_var(--line)]">
        {change.reason}
        <span className="block pt-1 text-ink-4">
          Raised by {change.raisedBy} · {change.age === 0 ? "today" : `${change.age}d ago`}
        </span>
      </div>

      {rows.length === 0 ? (
        <p className="py-8 text-center text-xs text-ink-4">Nothing actually changed.</p>
      ) : (
        <table className="w-full table-fixed border-separate border-spacing-0 text-[13px]">
          <colgroup>
            <col style={{ width: 128 }} />
            <col />
            <col style={{ width: 26 }} />
            <col />
          </colgroup>
          <thead>
            <tr className="[&>th]:h-9 [&>th]:border-y [&>th]:border-y-line-strong [&>th]:bg-surface [&>th]:px-2.5 [&>th]:text-[11px] [&>th]:font-semibold [&>th]:tracking-[0.04em] [&>th]:text-ink-3 [&>th]:uppercase">
              <th className="text-left">Field</th>
              <th className="text-left">{change.kind === "add" ? "—" : "Now"}</th>
              <th />
              <th className="text-left">Becomes</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.field}>
                <td className={cn("h-row px-2.5 align-middle text-xs text-ink-3", rule)}>
                  {row.field}
                </td>
                <td className={cn("px-2.5 align-middle text-xs text-ink-4 line-through", rule)}>
                  {row.from}
                </td>
                <td className={cn("align-middle text-center text-ink-4", rule)}>
                  <Icon path={paths.chevronRight} size={12} width={2.2} />
                </td>
                <td className={cn("px-2.5 align-middle text-xs font-medium text-ink", rule)}>
                  {row.to}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

const returnNoteInput = z.object({ note: z.string() })

/** every location prepares its own payroll; Head Office reads what the
 *  system worked out and either approves it or sends it back with a note */
function LocationPayrollSheet({
  locationId,
  period,
  locationName,
  payslips,
  onClose,
  onApprove,
  onReturn,
}: {
  locationId: string | null
  period: string
  locationName: string
  payslips: Payslip[]
  onClose: () => void
  onApprove: () => void
  onReturn: (note: string) => void
}) {
  return (
    <SheetShell
      open={Boolean(locationId)}
      size="wide"
      eyebrow={`${period} · prepared payroll`}
      title={locationName}
      onRequestClose={onClose}
      footer={null}
    >
      {locationId && (
        <LocationPayrollForm
          key={locationId}
          payslips={payslips}
          onClose={onClose}
          onApprove={onApprove}
          onReturn={onReturn}
        />
      )}
    </SheetShell>
  )
}

function LocationPayrollForm({
  payslips,
  onClose,
  onApprove,
  onReturn,
}: {
  payslips: Payslip[]
  onClose: () => void
  onApprove: () => void
  onReturn: (note: string) => void
}) {
  const form = useAppForm({
    defaultValues: { note: "" },
    validators: { onChange: returnNoteInput },
    onSubmit: async () => {},
  })

  return (
    <div className="flex min-h-full flex-col">
      <div className="flex-1">
        <LocationPayroll payslips={payslips} />
      </div>
      <div className="flex shrink-0 items-center gap-2 border-t border-line px-3.5 py-3">
        <form.AppField name="note">
          {(field) => (
            <input
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
              placeholder="Reason, if you are sending it back"
              className="h-[30px] flex-1 rounded-control bg-field px-2.5 text-xs text-ink shadow-[inset_0_0_0_1px_var(--line-strong)] outline-none focus:bg-surface focus:shadow-[inset_0_0_0_1px_var(--accent)] placeholder:text-ink-4"
            />
          )}
        </form.AppField>
        <form.Subscribe selector={(state) => state.values.note}>
          {(note) => (
            <button
              type="button"
              disabled={!note.trim()}
              onClick={() => {
                onReturn(note.trim())
                onClose()
              }}
              className="inline-flex h-[30px] items-center gap-1.5 rounded-control bg-surface px-2.5 text-xs font-medium text-ember shadow-btn transition-colors hover:bg-hover disabled:pointer-events-none disabled:opacity-40"
            >
              Send back
            </button>
          )}
        </form.Subscribe>
        <button
          type="button"
          onClick={() => {
            onApprove()
            onClose()
          }}
          className={sheetButton.primary}
        >
          <Icon path={paths.check} size={14} width={2.2} />
          Approve
        </button>
      </div>
    </div>
  )
}

function LocationPayroll({ payslips }: { payslips: Payslip[] }) {
  const net = payslips.reduce((sum, p) => sum + p.net, 0)
  const manual = payslips.reduce((n, p) => n + p.lines.filter((l) => l.manual).length, 0)

  return (
    <div className="px-4 py-4">
      <div className="mb-3 grid grid-cols-3 gap-2">
        {[
          { label: "People", value: String(payslips.length) },
          { label: "Entered by hand", value: String(manual) },
          { label: "Net", value: rupiah(net) },
        ].map((stat) => (
          <div
            key={stat.label}
            className="rounded-panel bg-inset px-3 py-2.5 shadow-[inset_0_0_0_1px_var(--line)]"
          >
            <div className="pb-1 text-[10.5px] font-semibold tracking-[0.04em] text-ink-4 uppercase">
              {stat.label}
            </div>
            <div className="truncate font-mono text-[15px] font-medium tracking-[-0.02em] text-ink">
              {stat.value}
            </div>
          </div>
        ))}
      </div>

      <VirtualRows
        rows={payslips.filter((slip) => employeeOf(slip.employeeId))}
        rowKey={(slip) => slip.employeeId}
        columns={LOCATION_PAYROLL_COLUMNS}
        rowHeight={44}
        header={
          <>
            <span className="px-2.5 text-left">Person</span>
            <span className="px-2.5 text-right">Base</span>
            <span className="px-2.5 text-left">What the system worked out</span>
            <span className="px-2.5 text-right">Net</span>
          </>
        }
        renderRow={(slip) => {
          const person = employeeOf(slip.employeeId)!
          return (
            <>
              <span role="gridcell" className="px-2.5 py-2">
                <span className="flex items-center gap-2">
                  <Avatar employee={person} size={22} />
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-medium text-ink">
                      {person.name}
                    </span>
                    <span className="block truncate text-[10.5px] text-ink-4">{person.role}</span>
                  </span>
                </span>
              </span>
              <span
                role="gridcell"
                className="px-2.5 text-right font-mono text-xs tabular-nums text-ink-4"
              >
                {rupiah(slip.base)}
              </span>
              <span role="gridcell" className="px-2.5">
                <span className="flex flex-wrap gap-1">
                  {slip.lines.map((line) => (
                    <span
                      key={line.id}
                      title={line.detail}
                      className={cn(
                        "inline-flex h-[19px] items-center gap-1 rounded-[6px] px-1.5 text-[10.5px] font-medium",
                        line.kind === "earning"
                          ? "bg-green-tint text-green"
                          : "bg-red-tint text-red",
                        line.manual && "shadow-[inset_0_0_0_1px_currentColor]"
                      )}
                    >
                      {line.label} {line.kind === "earning" ? "+" : "−"}
                      {Math.round(line.amount / 1000)}k
                    </span>
                  ))}
                </span>
              </span>
              <span
                role="gridcell"
                className="px-2.5 text-right font-mono text-[12.5px] font-medium tabular-nums text-ink"
              >
                {rupiah(slip.net)}
              </span>
            </>
          )
        }}
      />

      <p className="pt-2 text-[11px] text-ink-4">
        An outlined chip was entered by the store; everything else came out of the roster and
        attendance for the month.
      </p>
    </div>
  )
}

function PayrollDetail({
  run,
  rows,
}: {
  run: PayrollRun
  rows: { location: (typeof LOCATIONS)[number]; submission: PayrollSubmission; net: number }[]
}) {
  const rule = "border-b border-b-[color-mix(in_srgb,var(--line)_78%,transparent)]"
  const live = run.status !== "released"
  const total = live ? rows.reduce((sum, row) => sum + row.net, 0) : payrollTotal(run)
  const waiting = rows.filter((row) => row.submission.status !== "approved").length

  return (
    <div className="px-4 py-4">
      <div className="mb-3 grid grid-cols-3 gap-2">
        {[
          { label: "Locations", value: String(rows.length) },
          { label: "Not approved", value: String(live ? waiting : 0) },
          { label: "Net", value: rupiah(total) },
        ].map((stat) => (
          <div
            key={stat.label}
            className="rounded-panel bg-inset px-3 py-2.5 shadow-[inset_0_0_0_1px_var(--line)]"
          >
            <div className="pb-1 text-[10.5px] font-semibold tracking-[0.04em] text-ink-4 uppercase">
              {stat.label}
            </div>
            <div className="truncate font-mono text-[15px] font-medium tracking-[-0.02em] text-ink">
              {stat.value}
            </div>
          </div>
        ))}
      </div>

      <table className="w-full table-fixed border-separate border-spacing-0 text-[13px]">
        <colgroup>
          <col />
          <col style={{ width: 74 }} />
          <col style={{ width: 118 }} />
          <col style={{ width: 148 }} />
        </colgroup>
        <thead>
          <tr className="[&>th]:h-9 [&>th]:border-y [&>th]:border-y-line-strong [&>th]:bg-surface [&>th]:px-2.5 [&>th]:text-[11px] [&>th]:font-semibold [&>th]:tracking-[0.04em] [&>th]:text-ink-3 [&>th]:uppercase">
            <th className="text-left">Location</th>
            <th className="text-right">People</th>
            <th className="text-left">Status</th>
            <th className="text-right">Net</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ location, submission, net }) => {
            const people = allEmployees().filter((e) => e.locationId === location.id).length
            const meta = SUBMISSION_META[submission.status]
            return (
              <tr key={location.id} className="hover:[&>td]:bg-hover">
                <td className={cn("px-2.5 py-2 align-middle", rule)}>
                  <span className="flex items-center gap-2">
                    <Icon
                      path={KIND_ICON[location.kind]}
                      size={14}
                      width={1.8}
                      className="shrink-0 text-ink-4"
                    />
                    <span className="truncate text-xs font-medium text-ink">{location.name}</span>
                  </span>
                </td>
                <td
                  className={cn(
                    "px-2.5 text-right align-middle font-mono text-xs tabular-nums text-ink-3",
                    rule
                  )}
                >
                  {people}
                </td>
                <td className={cn("px-2.5 align-middle", rule)}>
                  <span
                    style={{ color: live ? meta.hue : "var(--grass)" }}
                    className="flex items-center gap-1.5 text-[11px] font-medium"
                  >
                    <span
                      style={{ background: live ? meta.hue : "var(--grass)" }}
                      className="size-1.5 rounded-full"
                    />
                    {live ? meta.label : "Released"}
                  </span>
                </td>
                <td
                  className={cn(
                    "px-2.5 text-right align-middle font-mono text-[12.5px] tabular-nums text-ink-2",
                    rule
                  )}
                >
                  {rupiah(live ? net : (run.byLocation[location.id] ?? 0))}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
