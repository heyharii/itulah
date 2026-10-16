import { useQuery } from "@tanstack/react-query"
import { useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { DockChoice } from "@/components/shell/dock-tools"
import { AppLink } from "@/components/ui/app-link"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Fab } from "@/components/ui/fab"
import { Field } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { PickOne } from "@/components/ui/pick"
import { Status } from "@/components/ui/pill"
import { Toolbar } from "@/components/ui/segmented"
import { Sheet } from "@/components/ui/sheet"
import { EmptyState } from "@/components/ui/states"
import { useUnits } from "@/lib/queries/organisation"
import { departments, orgKeys, orgChartQuery } from "@/lib/queries/people"
import { useLayout } from "@/lib/layout"
import { useCanWrite } from "@/lib/session"
import { cn } from "@/lib/utils"
import { EmployeePick } from "@/screens/people/employee-pick"
import { PlacementPanel } from "@/screens/people/placement"
import type { OrgChartNode } from "@itulah/contract"
import { awaiting } from "@/screens/people/awaiting"

/// The organisation chart, as Talenta draws it: who reports to whom, from
/// the top down, with each person's department and level.
///
/// Drawn as an indented tree rather than boxes and lines, so it reads on a
/// phone and a hundred people still fit a screen. Everybody working today is
/// on it: somebody nobody has placed sits at the top level and says so,
/// rather than vanishing from the chart.
export function OrgChart() {
  const depts = useQuery({
    queryKey: orgKeys.departments(),
    queryFn: ({ signal }) => departments(signal),
  })
  const [department, setDepartment] = useState<string | null>(null)
  const [placing, setPlacing] = useState(false)
  const canWrite = useCanWrite()
  const phone = useLayout() === "phone"

  const choices = (depts.data ?? [])
    .filter((one) => !one.retired)
    .map((one) => ({ value: one.code, label: one.name }))

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
      {/* On a phone the department is the chip over the bottom bar and
          placing somebody is its round +. */}
      {phone ? (
        <>
          <DockChoice
            title="Department"
            value={department ?? ""}
            onChange={(next) => setDepartment(next === "" ? null : next)}
            options={[
              { value: "", label: "All departments", short: "All departments" },
              ...choices.map((one) => ({ ...one, short: one.label })),
            ]}
          />
          {canWrite && (
            <Fab label="Place someone" onClick={() => setPlacing(true)} />
          )}
        </>
      ) : (
        <Toolbar>
          <PickOne
            label="Department"
            placeholder="All departments"
            choices={choices}
            value={department}
            onChange={setDepartment}
            className="w-56"
          />
        </Toolbar>
      )}
      <Card className="overflow-hidden p-4">
        {awaiting(orgChartQuery(), {
          loading: "Drawing the chart…",
          render: (nodes) => {
            const shown =
              department === null
                ? nodes
                : nodes.filter((node) => node.department_code === department)
            return shown.length === 0 ? (
              <EmptyState>
                {department === null
                  ? "Nobody is working here yet."
                  : "Nobody is placed in this department."}
              </EmptyState>
            ) : (
              <Tree nodes={shown} />
            )
          },
        })}
      </Card>
      <PlaceSheet open={placing} onClose={() => setPlacing(false)} />
    </PageContent>
  )
}

/// Place somebody in the organisation from here: pick them, then the same
/// placement form their own sheet's Position tab carries.
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

function Tree({ nodes }: { nodes: readonly OrgChartNode[] }) {
  const units = useUnits()
  const unitNames = new Map((units.data ?? []).map((one) => [one.id, one.name]))
  const here = new Set(nodes.map((node) => node.employee_id))
  const under = new Map<string, OrgChartNode[]>()
  const tops: OrgChartNode[] = []
  for (const node of nodes) {
    // A manager outside the filter (another department) makes this person a
    // top of the filtered chart, not a hidden branch.
    if (node.reports_to !== null && here.has(node.reports_to)) {
      const list = under.get(node.reports_to) ?? []
      list.push(node)
      under.set(node.reports_to, list)
    } else {
      tops.push(node)
    }
  }
  return (
    <ul className="flex flex-col gap-1">
      {tops.map((node) => (
        <Branch
          key={node.employee_id}
          node={node}
          under={under}
          unitNames={unitNames}
          depth={0}
        />
      ))}
    </ul>
  )
}

function Branch({
  node,
  under,
  unitNames,
  depth,
}: {
  node: OrgChartNode
  under: ReadonlyMap<string, OrgChartNode[]>
  unitNames: ReadonlyMap<string, string>
  depth: number
}) {
  const reports = under.get(node.employee_id) ?? []
  const [open, setOpen] = useState(depth < 2)
  const unplaced = node.department_code === null && node.level_name === null
  return (
    <li>
      <div
        className={cn(
          "flex flex-wrap items-center gap-2 rounded-inner px-2 py-1.5 hover:bg-soft-2",
          depth > 0 && "border-l border-hairline"
        )}
        style={{ marginLeft: `${depth * 1.25}rem` }}
      >
        {reports.length > 0 ? (
          <button
            type="button"
            aria-expanded={open}
            aria-label={open ? "Fold" : "Unfold"}
            onClick={() => setOpen(!open)}
            className="w-4 text-mute"
          >
            {open ? "▾" : "▸"}
          </button>
        ) : (
          <span className="w-4" />
        )}
        <AppLink
          to="/people"
          sheet={{ key: "employee", value: node.employee_id }}
          className="text-[0.9375rem] font-medium text-ink hover:underline"
        >
          {node.full_name ?? node.employee_code}
        </AppLink>
        <span className="text-[0.9375rem] text-mute">
          {[
            node.level_name,
            node.department_name,
            node.unit_id === null ? null : unitNames.get(node.unit_id),
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
        {unplaced && <Status tone="warn">Not placed</Status>}
        {reports.length > 0 && (
          <span className="text-[0.9375rem] text-mute">
            {reports.length} report{reports.length === 1 ? "" : "s"}
          </span>
        )}
      </div>
      {open && reports.length > 0 && (
        <ul className="flex flex-col gap-1">
          {reports.map((child) => (
            <Branch
              key={child.employee_id}
              node={child}
              under={under}
              unitNames={unitNames}
              depth={depth + 1}
            />
          ))}
        </ul>
      )}
    </li>
  )
}
