import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { AppLink } from "@/components/ui/app-link"
import { Field, Input } from "@/components/ui/field"
import { PickOne } from "@/components/ui/pick"
import { SheetSection } from "@/components/ui/rows"
import { SheetFooter } from "@/components/ui/sheet-footer"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { today } from "@/lib/calendar"
import {
  departments,
  jobLevels,
  orgKeys,
  placeEmployee,
  placements,
} from "@/lib/queries/people"
import { toast } from "@/lib/toast"
import {
  belongsTo,
  initialsOf,
  isUnplaced,
  nameOf,
  roleOf,
  type Positions,
  withEveryoneUnder,
  type ReportsIndex,
} from "@/screens/people/org-chart-lib"
import type { OrgChartNode } from "@itulah/contract"

import "./org-chart.css"

/// One person on the org chart: their facts, and — for head office — who they
/// report to.
///
/// Head office changes the boss directly (owner, 2026-10-30), by placing the
/// person again from today with everything else about their placement as it
/// is. So the sheet first reads their placements, takes the one in force, and
/// sends it back whole with only the boss changed; sending just the boss
/// would blank their department, level and grade. Somebody nobody has placed
/// has nothing to keep, so there it also asks for a department and a level.
///
/// The list is everyone on the unit's chart except the person and the people
/// under them: a boss picked from beneath would close a loop and leave
/// nobody at the top. Somebody in another unit is picked from the field
/// under the list, and then stands in it, ticked.
export function OrgPersonSheet({
  open,
  onClose,
  person,
  index,
  nodes,
  positions,
  unitId,
  homeId,
  unitNames,
  canWrite,
}: {
  open: boolean
  onClose: () => void
  person: OrgChartNode
  index: ReportsIndex
  nodes: readonly OrgChartNode[]
  positions: Positions
  /// The unit whose chart this was opened from.
  unitId: string | null
  /// Head office, where somebody posted nowhere is shown.
  homeId: string | null
  unitNames: ReadonlyMap<string, string>
  canWrite: boolean
}) {
  const client = useQueryClient()
  const id = person.employee_id
  const unplaced = isUnplaced(person, index.under)

  const history = useQuery({
    queryKey: orgKeys.placements(id),
    queryFn: ({ signal }) => placements(id, signal),
  })
  const depts = useQuery({
    queryKey: orgKeys.departments(),
    queryFn: ({ signal }) => departments(signal),
    enabled: unplaced && canWrite,
  })
  const levels = useQuery({
    queryKey: orgKeys.levels(),
    queryFn: ({ signal }) => jobLevels(signal),
    enabled: unplaced && canWrite,
  })

  // What is in force today: the newest placement not dated in the future.
  const now = serverToday()
  const current = history.data?.find((row) => row.effective_from <= now)

  const bossOf =
    person.reports_to === null ? undefined : index.byId.get(person.reports_to)
  // A boss in another unit stands in the list ticked, from the start.
  const outsideBoss =
    bossOf !== undefined && !belongsTo(bossOf, unitId, homeId)
      ? bossOf.employee_id
      : null

  // `undefined` is "not touched": the sheet shows what is in force until
  // somebody changes it, and no effect has to copy it in once it has loaded.
  const [bossPick, setBossPick] = useState<string | null | undefined>()
  const [deptPick, setDeptPick] = useState<string | null | undefined>()
  const [levelPick, setLevelPick] = useState<string | null | undefined>()
  const [extra, setExtra] = useState<string | null>(outsideBoss)
  const [find, setFind] = useState("")
  const [reason, setReason] = useState("")

  const boss = bossPick === undefined ? person.reports_to : bossPick
  const department =
    deptPick === undefined ? (current?.department_code ?? null) : deptPick
  const level =
    levelPick === undefined ? (current?.level_code ?? null) : levelPick
  const changed =
    boss !== person.reports_to ||
    department !== (current?.department_code ?? null) ||
    level !== (current?.level_code ?? null)

  const bossNode = boss === null ? undefined : index.byId.get(boss)
  const save = useMutation({
    mutationFn: () =>
      placeEmployee(id, {
        effective_from: serverToday(),
        department_code: department,
        level_code: level,
        grade_code: current?.grade_code ?? null,
        reports_to: boss,
        reason: reason.trim(),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: orgKeys.chart() })
      void client.invalidateQueries({ queryKey: orgKeys.placements(id) })
      void client.invalidateQueries({ queryKey: orgKeys.departments() })
      toast.success(
        bossNode === undefined
          ? `${nameOf(person)} reports to nobody`
          : `${nameOf(person)} reports to ${nameOf(bossNode)}`
      )
      onClose()
    },
  })

  // Everyone but the person and the people under them.
  const barred = withEveryoneUnder(id, index.under)
  const candidates = nodes.filter((one) => !barred.has(one.employee_id))
  // The boss they have now stands first, so a long list opens on it.
  const here = candidates
    .filter(
      (one) => belongsTo(one, unitId, homeId) && one.employee_id !== extra
    )
    .sort(
      (a, b) =>
        Number(b.employee_id === person.reports_to) -
        Number(a.employee_id === person.reports_to)
    )
  const elsewhere = candidates.filter((one) => !belongsTo(one, unitId, homeId))
  const extraNode = extra === null ? undefined : index.byId.get(extra)
  const needle = find.trim().toLowerCase()
  const shown =
    needle === ""
      ? here
      : here.filter((one) =>
          `${nameOf(one)} ${roleOf(one, positions)}`
            .toLowerCase()
            .includes(needle)
        )

  const bossLine =
    bossOf === undefined
      ? "Nobody"
      : `${nameOf(bossOf)} · ${unitNames.get(bossOf.unit_id ?? homeId ?? "") ?? "No unit"}`
  const reports = index.under.get(id)?.length ?? 0

  const profile = (
    <AppLink
      to="/people"
      sheet={{ key: "employee", value: id }}
      variant="ghost"
      className="max-md:h-11 md:h-9"
    >
      Open profile
    </AppLink>
  )

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      size="rail"
      stack
      dirty={changed || reason !== ""}
      id={person.employee_code}
      title={nameOf(person)}
      caption={
        roleOf(person, positions) === person.employee_code
          ? undefined
          : roleOf(person, positions)
      }
      footer={
        canWrite ? (
          <SheetFooter
            error={save.error}
            onCancel={onClose}
            secondary={profile}
            primary={{
              label: unplaced ? "Place" : "Save",
              pendingLabel: unplaced ? "Placing…" : "Saving…",
              pending: save.isPending,
              disabled:
                history.data === undefined || !changed || reason.trim() === "",
              onClick: () => save.mutate(),
            }}
          />
        ) : (
          <SheetFooter
            onCancel={onClose}
            cancelLabel="Close"
            secondary={profile}
          />
        )
      }
    >
      <Facts>
        <Fact term="Department">{person.department_name ?? "—"}</Fact>
        <Fact term="Job level">{person.level_name ?? "—"}</Fact>
        <Fact term="Unit">
          {unitNames.get(person.unit_id ?? "") ?? "Not posted to a unit"}
        </Fact>
        <Fact term="Direct reports">{reports === 0 ? "—" : reports}</Fact>
        <Fact term="Reports to" wide>
          {bossLine}
        </Fact>
      </Facts>

      {canWrite && (
        <>
          {unplaced && (
            <SheetSection title="Place">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Department">
                  <PickOne
                    label="Department"
                    choices={(depts.data ?? [])
                      .filter((one) => !one.retired)
                      .map((one) => ({ value: one.code, label: one.name }))}
                    value={department}
                    onChange={setDeptPick}
                  />
                </Field>
                <Field label="Job level">
                  <PickOne
                    label="Job level"
                    choices={(levels.data ?? [])
                      .filter((one) => !one.retired)
                      .map((one) => ({ value: one.code, label: one.name }))}
                    value={level}
                    onChange={setLevelPick}
                  />
                </Field>
              </div>
            </SheetSection>
          )}

          <SheetSection title="Reports to">
            {here.length > 6 && (
              <Input
                type="search"
                aria-label="Find a person"
                placeholder="Find a person"
                value={find}
                onChange={(event) => setFind(event.target.value)}
              />
            )}
            <div className="oc-pick" role="radiogroup" aria-label="Reports to">
              <Pick
                checked={boss === null}
                onPick={() => setBossPick(null)}
                avatar="—"
                name="Nobody"
                line="Top of the chart"
              />
              {extraNode !== undefined && (
                <Pick
                  checked={boss === extraNode.employee_id}
                  onPick={() => setBossPick(extraNode.employee_id)}
                  avatar={initialsOf(extraNode)}
                  name={nameOf(extraNode)}
                  line={`${roleOf(extraNode, positions)} · ${unitNames.get(extraNode.unit_id ?? homeId ?? "") ?? "No unit"}`}
                />
              )}
              {shown.map((one) => (
                <Pick
                  key={one.employee_id}
                  checked={boss === one.employee_id}
                  onPick={() => setBossPick(one.employee_id)}
                  avatar={initialsOf(one)}
                  name={nameOf(one)}
                  line={roleOf(one, positions)}
                />
              ))}
            </div>
            {elsewhere.length > 0 && (
              <PickOne
                label="Reports to, in another unit"
                placeholder="Someone in another unit"
                choices={elsewhere.map((one) => ({
                  value: one.employee_id,
                  label: `${nameOf(one)} · ${unitNames.get(one.unit_id ?? homeId ?? "") ?? "No unit"}`,
                }))}
                value={null}
                onChange={(next) => {
                  if (next === null) return
                  setExtra(next)
                  setBossPick(next)
                }}
              />
            )}
          </SheetSection>

          <Field label="Reason" required>
            <Input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
        </>
      )}
    </Sheet>
  )
}

/// Today, as the server will read it. The server's day is the date on its own
/// clock — UTC — so from midnight to seven in the morning in Indonesia the
/// browser's date is a day ahead of it, and a placement dated by the browser
/// would not be in force until the server's day caught up and the chart would
/// seem not to have changed. The earlier of the two dates is never ahead of
/// either clock.
function serverToday() {
  const local = today()
  const utc = new Date().toISOString().slice(0, 10)
  return local < utc ? local : utc
}

/// One radio row: avatar, name and what they do.
function Pick({
  checked,
  onPick,
  avatar,
  name,
  line,
}: {
  checked: boolean
  onPick: () => void
  avatar: string
  name: string
  line: string
}) {
  return (
    <label className="oc-opt">
      <input type="radio" name="boss" checked={checked} onChange={onPick} />
      <span className="oc-av" aria-hidden>
        {avatar}
      </span>
      <span className="oc-tx" title={`${name} · ${line}`}>
        <b>{name}</b>
        <span>{line}</span>
      </span>
    </label>
  )
}
