import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ChevronRight, Lock } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Field, Input, Select } from "@/components/ui/field"
import {
  PeopleSheet,
  SheetFoot,
  SheetSection,
} from "@/components/ui/people-sheet"
import { PeopleTable } from "@/components/ui/people-table"
import { Pill, Status } from "@/components/ui/pill"
import { Stat, StatStrip } from "@/components/ui/stat-strip"
import { Banner } from "@/components/ui/states"
import { moment } from "@/lib/format"
import {
  hrKeys,
  nominate,
  recordTrainingAttendance,
  readDate,
  trainingParticipants,
  trainingPrograms,
  type StoreScope,
} from "@/lib/queries/hr"
import { centreState } from "@/screens/hr/centre"
import { dateLead, Facts, PersonPicker, Submit } from "@/screens/hr/parts"
import { personByLogin, useTeam, type Tone } from "@/screens/hr/words"
import { HrWorkspace } from "@/screens/hr/workspace"
import type {
  EmployeeList,
  TrainingParticipantView,
  TrainingProgramView,
} from "@itulah/contract"

/// Training, for a shop — the prototype's store Training.
///
/// "Toko menominasikan karyawan dan mencatat kehadiran. Program dan biayanya
/// dari HO": head office runs the programmes and owns their cost; the shop
/// puts its people forward. The cost per head is locked here (🔒) as the
/// prototype locks it — it is booked to manpower development at head office.
///
/// The list is head office's programmes. A programme opens into a sheet of this
/// shop's nominees; "New nomination" and each person's attendance are their own
/// small sheets, which stand in for the programme's while they are open.
export function HrTraining() {
  return <HrWorkspace>{(scope) => <Training scope={scope} />}</HrWorkspace>
}

/// A programme's state in a word: head office marks it done once it has run.
function programState(program: TrainingProgramView): {
  label: string
  tone: Tone
} {
  return program.state === "DONE"
    ? { label: "Done", tone: "ok" }
    : { label: "Scheduled", tone: "info" }
}

/// One nominee's attendance in a word. Before the attendance window opens an
/// empty record is only not-yet; once it is open it is something to do.
function attendanceState(
  attended: boolean | null,
  windowOpen: boolean,
): { label: string; tone: Tone } {
  if (attended === null) {
    return { label: "Not recorded", tone: windowOpen ? "warn" : "neutral" }
  }
  return attended
    ? { label: "Attended", tone: "ok" }
    : { label: "Absent", tone: "bad" }
}

function Training({ scope }: { scope: StoreScope }) {
  const team = useTeam(scope)
  const programs = useQuery({
    queryKey: hrKeys.training(),
    queryFn: ({ signal }) => trainingPrograms(signal),
  })
  const [open, setOpen] = useState<TrainingProgramView | null>(null)

  return (
    <>
      {centreState(programs, {
        loading: "Reading the training programmes…",
        what: "the training programmes",
        render: (rows) => {
          const upcoming = rows.filter((program) => program.state !== "DONE")
          const sorted = [...rows].sort((left, right) =>
            left.state === right.state
              ? left.on_date.localeCompare(right.on_date)
              : left.state === "DONE"
                ? 1
                : -1,
          )
          const next = sorted.find(
            (program) => program.state !== "DONE" && !program.attendance_open,
          )
          return (
            <>
              <StatStrip>
                <Stat label="Scheduled" value={upcoming.length} />
                <Stat
                  label="Next"
                  value={next === undefined ? "—" : readDate(next.on_date)}
                />
                <Stat label="Done" value={rows.length - upcoming.length} />
              </StatStrip>
              <PeopleTable
                rows={sorted}
                rowKey={(program) => program.id}
                onRowClick={setOpen}
                empty="No programmes scheduled."
                card={(program) => {
                  const state = programState(program)
                  return {
                    title: program.title,
                    code: program.id,
                    lines: [program.place, `${program.participants} nominated`],
                    lead: dateLead(program.on_date),
                    foot: {
                      info: <Status tone={state.tone}>{state.label}</Status>,
                      action: {
                        label: "Open",
                        onClick: () => setOpen(program),
                      },
                    },
                  }
                }}
                columns={[
                  {
                    key: "title",
                    header: "Programme",
                    cell: (program) => (
                      <span className="flex flex-col">
                        <span className="font-medium text-ink">
                          {program.title}
                        </span>
                        <span className="font-mono text-meta text-mute">
                          {program.id}
                        </span>
                      </span>
                    ),
                  },
                  {
                    key: "date",
                    header: "Date",
                    cell: (program) => readDate(program.on_date, true),
                  },
                  {
                    key: "where",
                    header: "Where",
                    cell: (program) => program.place,
                  },
                  {
                    key: "people",
                    header: "Participants",
                    align: "right",
                    cell: (program) => program.participants,
                  },
                  {
                    key: "cost",
                    header: "Cost",
                    align: "right",
                    cell: () => (
                      <span
                        className="inline-flex items-center gap-1 text-mute"
                        title="Set at head office"
                      >
                        <Lock className="size-3.5" />
                        HO
                      </span>
                    ),
                  },
                  {
                    key: "state",
                    header: "Status",
                    cell: (program) => {
                      const state = programState(program)
                      return <Status tone={state.tone}>{state.label}</Status>
                    },
                  },
                ]}
              />
              {open !== null && (
                <ProgramFlow
                  key={open.id}
                  program={open}
                  team={team.data}
                  onClose={() => setOpen(null)}
                />
              )}
            </>
          )
        },
      })}
    </>
  )
}

/// Where a programme's sheet has gone: nowhere (its own), the form that puts
/// somebody forward, or one nominee's attendance. The form stands in for the
/// programme's sheet while it is open; closing it returns to the programme.
type Step =
  | { readonly kind: "nominate" }
  | { readonly kind: "attend"; readonly participant: TrainingParticipantView }

/// One programme, this shop's nominees, and their attendance record.
function ProgramFlow({
  program,
  team,
  onClose,
}: {
  program: TrainingProgramView
  team: EmployeeList | undefined
  onClose: () => void
}) {
  const [step, setStep] = useState<Step | null>(null)
  const roster = useQuery({
    queryKey: hrKeys.trainingParticipants(program.id),
    queryFn: ({ signal }) => trainingParticipants(program.id, signal),
  })

  if (step?.kind === "nominate") {
    return (
      <NominateSheet
        program={program}
        team={team}
        taken={roster.data?.map((participant) => participant.employee_id)}
        onClose={() => setStep(null)}
      />
    )
  }
  if (step?.kind === "attend") {
    return (
      <AttendanceSheet
        key={step.participant.employee_id}
        program={program}
        participant={step.participant}
        team={team}
        onClose={() => setStep(null)}
      />
    )
  }

  const state = programState(program)
  const nominationsOpen = program.state !== "DONE"
  return (
    <PeopleSheet
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      id={program.id}
      crumb="Training"
      title={program.title}
      sub={readDate(program.on_date, true)}
      status={<Pill tone={state.tone}>{state.label}</Pill>}
      foot={
        nominationsOpen ? (
          <SheetFoot>
            <Button
              variant="primary"
              onClick={() => setStep({ kind: "nominate" })}
            >
              New nomination
            </Button>
          </SheetFoot>
        ) : undefined
      }
    >
      <Facts
        rows={[
          ["Where", program.place],
          ["Cost per head", "Set at head office"],
          [
            "Attendance",
            program.attendance_open
              ? "Open"
              : `Opens on ${readDate(program.on_date, true)}`,
          ],
        ]}
      />
      <SheetSection
        title="Participants"
        aside={roster.data?.length}
        className="mt-6"
      >
        {roster.isPending ? (
          <p className="text-meta text-body">Reading the participants…</p>
        ) : roster.isError ? (
          <Banner tone="bad">
            {roster.error instanceof Error
              ? roster.error.message
              : "The participant list could not be read."}
          </Banner>
        ) : roster.data.length === 0 ? (
          <p className="text-meta text-body">
            {nominationsOpen
              ? "Nobody is nominated yet."
              : "Nobody was nominated."}
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-hairline">
            {roster.data.map((participant) => (
              <li key={participant.employee_id}>
                <ParticipantLine
                  participant={participant}
                  windowOpen={program.attendance_open}
                  onOpen={() => setStep({ kind: "attend", participant })}
                />
              </li>
            ))}
          </ul>
        )}
      </SheetSection>
    </PeopleSheet>
  )
}

/// One nominee in the programme's list. While attendance is open the row opens
/// the form that records it; before that it is only read.
function ParticipantLine({
  participant,
  windowOpen,
  onOpen,
}: {
  participant: TrainingParticipantView
  windowOpen: boolean
  onOpen: () => void
}) {
  const state = attendanceState(participant.attended, windowOpen)
  const inner = (
    <>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-cell font-medium text-ink">
          {participant.full_name ?? participant.employee_code}
        </span>
        {participant.full_name !== null && (
          <span className="block font-mono text-meta text-mute">
            {participant.employee_code}
          </span>
        )}
      </span>
      <Status tone={state.tone}>{state.label}</Status>
      {windowOpen && <ChevronRight className="size-4 shrink-0 text-line-ico" />}
    </>
  )
  return windowOpen ? (
    <button
      type="button"
      onClick={onOpen}
      className="flex min-h-11 w-full items-center gap-3 py-2.5 text-left transition-colors active:bg-soft"
    >
      {inner}
    </button>
  ) : (
    <div className="flex min-h-11 items-center gap-3 py-2.5">{inner}</div>
  )
}

/// Putting one of this shop's people on the programme. The centre refuses
/// somebody who is not posted here, and the picker already leaves out whoever
/// is on it.
function NominateSheet({
  program,
  team,
  taken,
  onClose,
}: {
  program: TrainingProgramView
  team: EmployeeList | undefined
  taken: readonly string[] | undefined
  onClose: () => void
}) {
  const client = useQueryClient()
  const [employeeId, setEmployeeId] = useState("")
  const [reason, setReason] = useState("")
  const put = useMutation({
    mutationFn: () => nominate({ programId: program.id, employeeId, reason }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: hrKeys.training() })
      client.invalidateQueries({
        queryKey: hrKeys.trainingParticipants(program.id),
      })
      onClose()
    },
  })

  return (
    <PeopleSheet
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      crumb="Training"
      title="New nomination"
      sub={program.title}
      foot={
        <Submit
          label="Create nomination"
          pendingLabel="Creating…"
          pending={put.isPending}
          disabled={employeeId === "" || reason.trim() === ""}
          error={put.error}
          onSubmit={() => put.mutate()}
          onCancel={onClose}
        />
      }
    >
      <div className="flex flex-col gap-3">
        <PersonPicker
          team={team}
          exclude={taken}
          value={employeeId}
          onChange={setEmployeeId}
          label="Employee"
          required
        />
        <Field label="Reason" required>
          <Input
            value={reason}
            placeholder="Newly promoted to shift lead"
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
      </div>
    </PeopleSheet>
  )
}

/// One nominee's attendance, recorded or corrected. Every reason is kept in the
/// person's history at the centre, so the last one is shown above the form.
function AttendanceSheet({
  program,
  participant,
  team,
  onClose,
}: {
  program: TrainingProgramView
  participant: TrainingParticipantView
  team: EmployeeList | undefined
  onClose: () => void
}) {
  const client = useQueryClient()
  const [attended, setAttended] = useState(participant.attended ?? true)
  const [reason, setReason] = useState("")
  const record = useMutation({
    mutationFn: () =>
      recordTrainingAttendance({
        programId: program.id,
        employeeId: participant.employee_id,
        attended,
        reason,
      }),
    onSuccess: (saved) => {
      client.setQueryData<TrainingParticipantView[]>(
        hrKeys.trainingParticipants(program.id),
        (rows) =>
          rows?.map((row) =>
            row.employee_id === saved.employee_id ? saved : row,
          ),
      )
      client.invalidateQueries({ queryKey: hrKeys.training() })
      onClose()
    },
  })
  const latest = participant.attendance_history.at(-1)
  const first = participant.attended === null
  const state = attendanceState(participant.attended, true)

  return (
    <PeopleSheet
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      crumb={`Attendance · ${program.title}`}
      title={participant.full_name ?? participant.employee_code}
      sub={readDate(program.on_date, true)}
      status={<Pill tone={state.tone}>{state.label}</Pill>}
      foot={
        <Submit
          label={first ? "Create attendance record" : "Save changes"}
          pendingLabel={first ? "Creating…" : "Saving…"}
          pending={record.isPending}
          disabled={reason.trim() === ""}
          error={record.error}
          onSubmit={() => record.mutate()}
          onCancel={onClose}
        />
      }
    >
      {latest !== undefined && (
        <SheetSection title="Last recorded">
          <Facts
            rows={[
              ["By", personByLogin(team, latest.actor)],
              ["On", moment(latest.recorded_at)],
              ["Because", latest.reason, true],
            ]}
          />
        </SheetSection>
      )}
      <SheetSection title={first ? "Record attendance" : "Correct attendance"}>
        <div className="flex flex-col gap-3">
          <Field label="Attendance" required>
            <Select
              value={attended ? "attended" : "absent"}
              onChange={(value) => setAttended(value === "attended")}
            >
              <option value="attended">Attended</option>
              <option value="absent">Absent</option>
            </Select>
          </Field>
          <Field label="Reason" required>
            <Input
              value={reason}
              placeholder="Checked against the signed register"
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
        </div>
      </SheetSection>
    </PeopleSheet>
  )
}
