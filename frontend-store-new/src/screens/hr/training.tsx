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
  isoDay,
  nominate,
  readDate,
  trainingPrograms,
  type StoreScope,
} from "@/lib/queries/hr"
import { centreState } from "@/screens/hr/centre"
import { Facts, PersonPicker, Submit } from "@/screens/hr/parts"
import { personName, useTeam } from "@/screens/hr/words"
import { HrWorkspace } from "@/screens/hr/workspace"
import type { EmployeeList, TrainingProgramView } from "@itulah/contract"

/// Training, for a shop — the prototype's store Training.
///
/// "Toko menominasikan karyawan dan mencatat kehadiran. Program dan biayanya
/// dari HO": head office runs the programmes and owns their cost; the shop
/// puts its people forward. The cost per head is locked here (🔒) as the
/// prototype locks it — it is booked to manpower development at head office.
///
/// # What this build cannot show
///
/// The centre answers a programme with a participant *count* and no names,
/// and has no route that lists who is on one — so this screen cannot mark
/// which of the shop's people are already nominated, or record attendance on
/// the day as the prototype does. A nomination of somebody already on the list
/// is refused by the centre in its own words.
export function HrTraining() {
  return (
    <HrWorkspace sub="The shop nominates its people. Programmes and their cost are head office's.">
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
  const today = isoDay(new Date())

  return centreState(programs, {
    loading: "Reading head office's programmes…",
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
                upcoming.find((program) => program.on_date >= today)
                  ?.on_date === undefined
                  ? "—"
                  : readDate(
                      upcoming.find((program) => program.on_date >= today)
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
            empty="Head office has no training programme on the calendar."
            columns={[
              {
                key: "title",
                header: "Programme",
                cell: (program) => (
                  <span className="flex flex-col">
                    <span className="font-medium text-ink">
                      {program.title}
                    </span>
                    <span className="font-mono text-[0.6875rem] text-mute">
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

/// One programme, and nominating one of this shop's people for it.
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
  const put = useMutation({
    mutationFn: () => nominate({ programId: program.id, employeeId, reason }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: hrKeys.training() })
      setDone(personName(team, employeeId))
      setEmployeeId("")
      setReason("")
    },
  })
  const open = program.state !== "DONE"

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
        open ? (
          <Pill tone="accent">Scheduled</Pill>
        ) : (
          <Pill tone="ok">Done</Pill>
        )
      }
      foot={
        open ? (
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
            ["Participants", `${program.participants} across the company`],
            [
              "Cost per head",
              "head office's rule · booked to manpower development",
            ],
          ]}
        />
      </SheetSection>
      {open ? (
        <SheetSection title="Nominate">
          <div className="flex flex-col gap-3">
            {done !== null && <Banner tone="ok">{done} is nominated.</Banner>}
            <PersonPicker
              team={team}
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
          This programme has run; nominations are closed.
        </p>
      )}
    </PeopleSheet>
  )
}
