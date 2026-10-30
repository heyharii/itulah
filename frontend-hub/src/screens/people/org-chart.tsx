import { useQuery } from "@tanstack/react-query"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Fab } from "@/components/ui/fab"
import { Field } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { PickOne } from "@/components/ui/pick"
import { SubHead } from "@/components/ui/rows"
import { Toolbar } from "@/components/ui/segmented"
import { Sheet } from "@/components/ui/sheet"
import { EmptyState } from "@/components/ui/states"
import { useLayout } from "@/lib/layout"
import { useUnits, type UnitView } from "@/lib/queries/organisation"
import {
  departments,
  listEmployees,
  orgChartQuery,
  orgKeys,
  peopleKeys,
} from "@/lib/queries/people"
import { queryState } from "@/lib/query-state"
import { useCanWrite } from "@/lib/session"
import { awaiting } from "@/screens/people/awaiting"
import { EmployeePick } from "@/screens/people/employee-pick"
import {
  belongsTo,
  initialsOf,
  isUnplaced,
  nameOf,
  reportsIndex,
  roleOf,
  type Positions,
  unitLabel,
} from "@/screens/people/org-chart-lib"
import { OrgPersonSheet } from "@/screens/people/org-person-sheet"
import { PlacementPanel } from "@/screens/people/placement"
import type { OrgChartNode } from "@itulah/contract"

import "./org-chart.css"

/// The organisation chart: who reports to whom, as boxes from the top down,
/// one unit at a time — head office, or a store (owner, 2026-10-30).
///
/// A person shows on the chart of the unit they are posted to. Somebody whose
/// boss is in another unit has nobody above them here, so they stand as a tree
/// of their own and their sheet says who the boss is. A manager whose reports
/// lead nobody stacks them under their card, which keeps a store's chart
/// narrow; a chart wider than its box scrolls inside the box, never the page.
/// Everybody nobody has placed yet waits under the tree, each with a Place.
export function OrgChart() {
  const depts = useQuery({
    queryKey: orgKeys.departments(),
    queryFn: ({ signal }) => departments(signal),
  })
  const units = useUnits()
  const [department, setDepartment] = useState<string | null>(null)
  const [unitPick, setUnitPick] = useState<string | null>(null)
  const [placing, setPlacing] = useState(false)
  const canWrite = useCanWrite()
  const phone = useLayout() === "phone"

  const live = (units.data ?? []).filter((one) => one.status !== "CLOSED")
  const home = live.find((one) => one.kind === "HO")
  // Head office until somebody picks another.
  const unitId = unitPick ?? home?.id ?? live[0]?.id ?? null

  const choices = (depts.data ?? [])
    .filter((one) => !one.retired)
    .map((one) => ({ value: one.code, label: one.name }))
  const unitChoices = live.map((one) => ({
    value: one.id,
    label: unitLabel(one),
  }))

  return (
    <PageContent>
      <PageHeader
        title="Org chart"
        actions={
          !phone &&
          canWrite && (
            <Button variant="primary" onClick={() => setPlacing(true)}>
              Place someone
            </Button>
          )
        }
      />
      {/* On a phone the two filters are the Filters button over the bottom
          bar, and placing somebody is its round +. */}
      <Toolbar>
        <PickOne
          label="Unit"
          placeholder="Unit"
          choices={unitChoices}
          value={unitId}
          onChange={setUnitPick}
          required
          className="max-md:w-full md:w-64"
        />
        <PickOne
          label="Department"
          placeholder="All departments"
          choices={choices}
          value={department}
          onChange={setDepartment}
          className="max-md:w-full md:w-56"
        />
      </Toolbar>
      {phone && canWrite && (
        <Fab label="Place someone" onClick={() => setPlacing(true)} />
      )}
      <Card className="overflow-hidden p-4">
        {queryState(units, {
          loading: "Drawing the chart…",
          render: (list) =>
            awaiting(orgChartQuery(), {
              loading: "Drawing the chart…",
              render: (nodes) => (
                <Chart
                  nodes={nodes}
                  units={list}
                  unitId={unitId}
                  department={department}
                  canWrite={canWrite}
                />
              ),
            }),
        })}
      </Card>
      <PlaceSheet open={placing} onClose={() => setPlacing(false)} />
    </PageContent>
  )
}

/// Place somebody in the organisation from here: pick them, then the same
/// placement form their own sheet's Position tab carries. It is the whole
/// form — date, department, level, grade — and the only way in for somebody
/// who has not started yet and so is not on the chart to be clicked.
function PlaceSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [who, setWho] = useState<string | null>(null)
  const close = () => {
    setWho(null)
    onClose()
  }
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && close()}
      title="Place someone"
    >
      <div className="flex flex-col gap-4">
        <Field label="Employee" required>
          <EmployeePick
            value={who}
            onChange={setWho}
            statuses={["ACTIVE", "CANDIDATE"]}
          />
        </Field>
        {who !== null && <PlacementPanel key={who} employeeId={who} />}
      </div>
    </Sheet>
  )
}

/// A person and everybody beneath them, within the people being drawn.
interface Branch {
  readonly node: OrgChartNode
  readonly reports: readonly Branch[]
}

/// The trees of the people drawn: those whose boss is not among them stand at
/// the top. Anybody a loop in old data would hide is set at the top too, so
/// nobody working is left off the chart.
function treesOf(drawn: readonly OrgChartNode[]): Branch[] {
  const here = new Set(drawn.map((node) => node.employee_id))
  const under = new Map<string, OrgChartNode[]>()
  const tops: OrgChartNode[] = []
  for (const node of drawn) {
    if (node.reports_to !== null && here.has(node.reports_to)) {
      const list = under.get(node.reports_to) ?? []
      list.push(node)
      under.set(node.reports_to, list)
    } else {
      tops.push(node)
    }
  }
  const seen = new Set<string>()
  const grow = (node: OrgChartNode): Branch => {
    seen.add(node.employee_id)
    return {
      node,
      reports: (under.get(node.employee_id) ?? [])
        .filter((report) => !seen.has(report.employee_id))
        .map(grow),
    }
  }
  const trees = tops.map(grow)
  for (const node of drawn) {
    if (!seen.has(node.employee_id)) trees.push(grow(node))
  }
  return trees
}

function Chart({
  nodes,
  units,
  unitId,
  department,
  canWrite,
}: {
  nodes: readonly OrgChartNode[]
  units: readonly UnitView[]
  unitId: string | null
  department: string | null
  canWrite: boolean
}) {
  // The job title lives on the workforce list, not the chart's own read; the
  // same read (and cache entry) the other HR pickers use. Until it arrives a
  // card says level · department, then the code.
  const team = useQuery({
    queryKey: peopleKeys.employees({ status: "ACTIVE", limit: 1000 }),
    queryFn: ({ signal }) =>
      listEmployees({ status: "ACTIVE", limit: 1000 }, signal),
  })
  const positions = useMemo<Positions>(
    () =>
      new Map(
        (team.data ?? []).flatMap((one) =>
          one.position === null || one.position.trim() === ""
            ? []
            : [[one.employee_id, one.position.trim()] as const]
        )
      ),
    [team.data]
  )

  // The sheet remounts on every open (`n`), so each person starts clean, and
  // stays mounted while it closes so it can leave.
  const [sheet, setSheet] = useState({ id: "", open: false, n: 0 })
  const open = (id: string) =>
    setSheet((last) => ({ id, open: true, n: last.n + 1 }))

  const index = useMemo(() => reportsIndex(nodes), [nodes])
  const unitNames = useMemo(
    () => new Map(units.map((one) => [one.id, unitLabel(one)])),
    [units]
  )
  const homeId =
    units.find((one) => one.kind === "HO" && one.status !== "CLOSED")?.id ??
    null

  const inUnit = nodes.filter((node) => belongsTo(node, unitId, homeId))
  const waiting = inUnit.filter((node) => isUnplaced(node, index.under))
  const drawn = inUnit.filter((node) => !isUnplaced(node, index.under))
  const shown =
    department === null
      ? drawn
      : drawn.filter((node) => node.department_code === department)
  const trees = treesOf(shown)
  const unitName = unitNames.get(unitId ?? "") ?? "This unit"
  const picked = sheet.id === "" ? undefined : index.byId.get(sheet.id)

  return (
    <>
      <SubHead
        aside={`${inUnit.length} ${inUnit.length === 1 ? "person" : "people"}`}
      >
        {unitName}
      </SubHead>
      {shown.length === 0 && waiting.length === 0 ? (
        <EmptyState>
          {department === null
            ? "Nobody is posted to this unit."
            : "Nobody in this department is placed here."}
        </EmptyState>
      ) : (
        shown.length > 0 && (
          <div className="oc">
            <div className="oc-roots">
              {trees.map((tree) => (
                <ul key={tree.node.employee_id} className="oc-top">
                  <Node tree={tree} positions={positions} onOpen={open} />
                </ul>
              ))}
            </div>
          </div>
        )
      )}
      {department === null && waiting.length > 0 && (
        <section className="mt-4 border-t border-hairline pt-5">
          <SubHead aside={waiting.length}>Not placed</SubHead>
          <div className="oc-un">
            {waiting.map((node) => (
              <div key={node.employee_id} className="oc-un-item">
                <PersonCard node={node} positions={positions} onOpen={open} />
                {canWrite && (
                  <Button
                    variant="primary"
                    onClick={() => open(node.employee_id)}
                  >
                    Place
                  </Button>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
      {picked !== undefined && (
        <OrgPersonSheet
          key={sheet.n}
          open={sheet.open}
          onClose={() => setSheet((last) => ({ ...last, open: false }))}
          person={picked}
          index={index}
          nodes={nodes}
          positions={positions}
          unitId={unitId}
          homeId={homeId}
          unitNames={unitNames}
          canWrite={canWrite}
        />
      )}
    </>
  )
}

/// One person's box, and under it their reports: side by side when any of
/// them leads others, in a column when none does.
function Node({
  tree,
  positions,
  onOpen,
}: {
  tree: Branch
  positions: Positions
  onOpen: (id: string) => void
}) {
  const { node, reports } = tree
  const leaves =
    reports.length > 0 && reports.every((one) => one.reports.length === 0)
  return (
    <li>
      <PersonCard node={node} positions={positions} onOpen={onOpen} />
      {reports.length > 0 &&
        (leaves ? (
          <div className="oc-leaves">
            {reports.map((one) => (
              <PersonCard
                key={one.node.employee_id}
                node={one.node}
                positions={positions}
                onOpen={onOpen}
              />
            ))}
          </div>
        ) : (
          <ul>
            {reports.map((one) => (
              <Node
                key={one.node.employee_id}
                tree={one}
                positions={positions}
                onOpen={onOpen}
              />
            ))}
          </ul>
        ))}
    </li>
  )
}

function PersonCard({
  node,
  positions,
  onOpen,
}: {
  node: OrgChartNode
  positions: Positions
  onOpen: (id: string) => void
}) {
  const role = roleOf(node, positions)
  return (
    <button
      type="button"
      className="oc-card"
      title={`${nameOf(node)} · ${role} · ${node.employee_code}`}
      onClick={() => onOpen(node.employee_id)}
    >
      <span className="oc-av" aria-hidden>
        {initialsOf(node)}
      </span>
      <span className="oc-tx">
        <b>{nameOf(node)}</b>
        <span>{role}</span>
      </span>
    </button>
  )
}
