import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Lock } from "lucide-react"
import { useState } from "react"

import { Field, Input } from "@/components/ui/field"
import { PeopleSheet, SheetSection } from "@/components/ui/people-sheet"
import { PeopleTable } from "@/components/ui/people-table"
import { Pill } from "@/components/ui/pill"
import { Stat, StatStrip } from "@/components/ui/stat-strip"
import { Banner } from "@/components/ui/states"
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
import { Facts, PersonPicker, Submit } from "@/screens/hr/parts"
import { personName, useTeam } from "@/screens/hr/words"
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
export function HrTraining() {
  return (
    <HrWorkspace>
      {(scope) => <Training scope={scope} />}
    </HrWorkspace>
  )
}

function Training({ scope }: { scope: StoreScope }) {
  const team = useTeam(scope)
  const programs = useQuery({
    queryKey: hrKeys.training(),
    queryFn: ({ signal }) => trainingPrograms(signal),
  })
  const [open, setOpen] = useState<TrainingProgramView | null>(null)

  return centreState(programs, {
    loading: "Loading…",
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
      return (
        <>
          <StatStrip>
            <Stat label="Scheduled" value={upcoming.length} />
            <Stat
              label="Next"
              value={
                upcoming.find((program) => !program.attendance_open)
                  ?.on_date === undefined
                  ? "—"
                  : readDate(
                      upcoming.find((program) => !program.attendance_open)
                        ?.on_date ?? "",
                    )
              }
            />
            <Stat label="Done" value={rows.length - upcoming.length} />
          </StatStrip>
          <PeopleTable
            rows={sorted}
            rowKey={(program) => program.id}
            onRowClick={setOpen}
            empty="No programmes scheduled."
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
                card: "meta",
                cell: (program) => readDate(program.on_date, true),
              },
              {
                key: "where",
                header: "Where",
                card: "meta",
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
                card: "hide",
                cell: () => (
                  <span
                    className="inline-flex items-center gap-1 text-mute"
                    title="Head office's"
                  >
                    <Lock className="size-3.5" />
                    HO
                  </span>
                ),
              },
              {
                key: "state",
                header: "Status",
                card: "status",
                cell: (program) =>
                  program.state === "DONE" ? (
                    <Pill tone="ok">Done</Pill>
                  ) : (
                    <Pill tone="accent">Scheduled</Pill>
                  ),
              },
            ]}
          />
          {open !== null && (
            <ProgramSheet
              key={open.id}
              program={open}
              team={team.data}
              onClose={() => setOpen(null)}
            />
          )}
        </>
      )
    },
  })
}

/// One programme, this shop's nominees, and their attendance record.
function ProgramSheet({
  program,
  team,
  onClose,
}: {
  program: TrainingProgramView
  team: EmployeeList | undefined
  onClose: () => void
}) {
  const client = useQueryClient()
  const [employeeId, setEmployeeId] = useState("")
  const [reason, setReason] = useState("")
  const [done, setDone] = useState<string | null>(null)
  const roster = useQuery({
    queryKey: hrKeys.trainingParticipants(program.id),
    queryFn: ({ signal }) => trainingParticipants(program.id, signal),
  })
  const put = useMutation({
    mutationFn: () => nominate({ programId: program.id, employeeId, reason }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: hrKeys.training() })
      client.invalidateQueries({
        queryKey: hrKeys.trainingParticipants(program.id),
      })
      setDone(personName(team, employeeId))
      setEmployeeId("")
      setReason("")
    },
  })
  const nominationsOpen = program.state !== "DONE"
  const attendanceOpen = program.attendance_open

  return (
    <PeopleSheet
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      crumb={
        <>
          Training · <span className="font-mono">{program.id}</span>
        </>
      }
      title={program.title}
      sub={`${readDate(program.on_date, true)} · ${program.place}`}
      status={
        nominationsOpen ? (
          <Pill tone="accent">Scheduled</Pill>
        ) : (
          <Pill tone="ok">Done</Pill>
        )
      }
      foot={
        nominationsOpen ? (
          <Submit
            label="Nominate"
            pending={put.isPending}
            disabled={employeeId === "" || reason.trim() === ""}
            error={put.error}
            onSubmit={() => put.mutate()}
          />
        ) : undefined
      }
    >
      <SheetSection title="Programme">
        <Facts
          rows={[
            ["Date", readDate(program.on_date, true)],
            ["Where", program.place],
            [
              "Participants",
              `${roster.data?.length ?? program.participants} in this shop`,
            ],
            [
              "Cost per head",
              "head office's rule · booked to manpower development",
            ],
          ]}
        />
      </SheetSection>
      <SheetSection title="Participants from this shop">
        {roster.isPending ? (
          <p className="text-meta text-body">Loading…</p>
        ) : roster.isError ? (
          <Banner tone="bad">
            {roster.error instanceof Error
              ? roster.error.message
              : "The participant list could not be read."}
          </Banner>
        ) : roster.data.length === 0 ? (
          <p className="text-meta text-body">Nobody is nominated yet.</p>
        ) : (
          <div className="flex flex-col divide-y divide-hairline">
            {roster.data.map((participant) => (
              <div
                key={participant.employee_id}
                className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-medium text-ink">
                    {participant.full_name ?? participant.employee_code}
                    <span className="ml-2 font-mono text-meta text-mute">
                      {participant.employee_code}
                    </span>
                  </span>
                  <AttendancePill attended={participant.attended} />
                </div>
                {attendanceOpen ? (
                  <ParticipantAttendance
                    programId={program.id}
                    participant={participant}
                  />
                ) : (
                  <p className="text-meta text-body">
                    Attendance opens on {readDate(program.on_date, true)}.
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </SheetSection>
      {nominationsOpen ? (
        <SheetSection title="Nominate">
          <div className="flex flex-col gap-3">
            {done !== null && <Banner tone="ok">{done} is nominated.</Banner>}
            <PersonPicker
              team={team}
              exclude={roster.data?.map((participant) => participant.employee_id)}
              value={employeeId}
              onChange={setEmployeeId}
              label="From this shop"
            />
            <Field label="Why them">
              <Input
                value={reason}
                placeholder="Newly promoted to shift lead"
                onChange={(event) => setReason(event.target.value)}
              />
            </Field>
          </div>
        </SheetSection>
      ) : (
        <p className="text-meta text-body">
          Nominations closed.
        </p>
      )}
    </PeopleSheet>
  )
}

function AttendancePill({ attended }: { attended: boolean | null }) {
  if (attended === null) return <Pill tone="warn">Not recorded</Pill>
  return attended ? <Pill tone="ok">Attended</Pill> : <Pill tone="bad">Absent</Pill>
}

function ParticipantAttendance({
  programId,
  participant,
}: {
  programId: string
  participant: TrainingParticipantView
}) {
  const client = useQueryClient()
  const [attended, setAttended] = useState(participant.attended ?? true)
  const [reason, setReason] = useState("")
  const record = useMutation({
    mutationFn: () =>
      recordTrainingAttendance({
        programId,
        employeeId: participant.employee_id,
        attended,
        reason,
      }),
    onSuccess: (saved) => {
      client.setQueryData<TrainingParticipantView[]>(
        hrKeys.trainingParticipants(programId),
        (rows) => rows?.map((row) =>
          row.employee_id === saved.employee_id ? saved : row,
        ),
      )
      client.invalidateQueries({ queryKey: hrKeys.training() })
      setReason("")
    },
  })
  const latest = participant.attendance_history.at(-1)

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-hairline p-3">
      {latest && (
        <p className="text-meta text-body">
          Last recorded by {latest.actor}: {latest.reason}
        </p>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Attendance">
          <select
            className="h-10 rounded-lg border border-hairline bg-surface px-3 text-sm text-ink"
            value={attended ? "attended" : "absent"}
            onChange={(event) => setAttended(event.target.value === "attended")}
          >
            <option value="attended">Attended</option>
            <option value="absent">Absent</option>
          </select>
        </Field>
        <Field label="Reason" className="min-w-56 flex-1">
          <Input
            value={reason}
            placeholder="Checked against the signed register"
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
        <Submit
          label={participant.attended === null ? "Record" : "Save correction"}
          pending={record.isPending}
          disabled={reason.trim() === ""}
          error={record.error}
          onSubmit={() => record.mutate()}
        />
      </div>
    </div>
  )
}
