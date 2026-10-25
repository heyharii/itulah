import { useQuery } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { CircleCheck, FolderKanban, FolderOpen, Plus } from "lucide-react"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { DockTools } from "@/components/shell/dock-tools"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Fab } from "@/components/ui/fab"
import { Input } from "@/components/ui/field"
import { FilterChips } from "@/components/ui/filter-chips"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { MiniCell, MiniTable } from "@/components/ui/rows"
import { EmptyState } from "@/components/ui/states"
import { today } from "@/lib/calendar"
import { day } from "@/lib/format"
import {
  KIND_LABEL,
  projectsQuery,
  type GaProjectRow,
} from "@/lib/queries/projects"
import { queryState } from "@/lib/query-state"
import { NewProjectSheet } from "@/screens/projects/forms"
import {
  projectPath,
  STATUS_TONE,
  STATUS_WORD,
} from "@/screens/projects/shared"

/// GA › Projects: every store opening and renovation, open ones first.
///
/// A project opens on its own page (`/projects/$project`), not as a sheet: it
/// holds tasks, assets, work and files, and each of those opens as a sheet of
/// its own over the page.
export function ProjectsList() {
  const [view, setView] = useState<"open" | "closed">("open")
  const [search, setSearch] = useState("")
  const [creating, setCreating] = useState({ open: false, round: 0 })
  const navigate = useNavigate()
  const projects = useQuery({ ...projectsQuery(), refetchInterval: 10_000 })

  const rows = projects.data ?? []
  const open = rows.filter((row) => row.status === "OPEN")
  const shown = useMemo(() => {
    const text = search.trim().toLowerCase()
    return rows
      .filter((row) => (view === "open") === (row.status === "OPEN"))
      .filter(
        (row) =>
          text === "" ||
          row.name.toLowerCase().includes(text) ||
          row.project_number.toLowerCase().includes(text) ||
          (row.site_name ?? "").toLowerCase().includes(text)
      )
  }, [rows, view, search])
  const month = today().slice(0, 7)
  const add = () =>
    setCreating((current) => ({ open: true, round: current.round + 1 }))

  return (
    <PageContent>
      <PageHeader
        title="Projects"
        actions={
          <>
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search projects"
              className="h-8 w-56 max-md:hidden"
            />
            <Button variant="primary" onClick={add} className="max-md:hidden">
              <Plus className="size-4" />
              New project
            </Button>
          </>
        }
      />
      <Fab label="New project" onClick={add} />

      <KpiStrip>
        <Kpi label="Open" value={open.length} />
        <Kpi
          label="Opening this month"
          value={open.filter((row) => row.opens_on?.startsWith(month)).length}
        />
        <Kpi
          label="Late tasks"
          value={open.reduce((sum, row) => sum + row.tasks_late, 0)}
        />
        <Kpi
          label="Waiting for Finance"
          value={rows.filter((row) => row.status === "READY").length}
        />
      </KpiStrip>

      <DockTools
        search={{ value: search, onChange: setSearch, label: "Search projects" }}
        status={{
          value: view,
          options: [
            { value: "open", label: "Open", count: open.length },
            {
              value: "closed",
              label: "Closed",
              count: rows.length - open.length,
            },
          ],
          onChange: (next) => setView(next as "open" | "closed"),
        }}
      />
      <FilterChips
        className="mb-3.5 max-md:hidden"
        label="Projects"
        value={view === "open" ? null : view}
        onChange={(next) => setView(next === "closed" ? "closed" : "open")}
        options={[
          { value: null, label: "Open", icon: FolderOpen, count: open.length },
          {
            value: "closed",
            label: "Closed",
            icon: CircleCheck,
            count: rows.length - open.length,
          },
        ]}
      />

      <Card className="overflow-hidden">
        {queryState(projects, {
          loading: "Reading the projects…",
          render: () =>
            shown.length === 0 ? (
              <EmptyState>
                {rows.length === 0
                  ? "No project yet."
                  : view === "open"
                    ? "No open project."
                    : "No closed project."}
              </EmptyState>
            ) : (
              <MiniTable
                head={[
                  "Project",
                  { label: "Site", align: "left" },
                  { label: "Kind", align: "left" },
                  { label: "Opens", align: "left" },
                  "Tasks left",
                  "Assets",
                  { label: "Status", align: "left" },
                ]}
              >
                {shown.map((row) => (
                  <ProjectRow
                    key={row.project_id}
                    row={row}
                    onOpen={() =>
                      void navigate({ to: projectPath(row.project_id) })
                    }
                  />
                ))}
              </MiniTable>
            ),
        })}
      </Card>

      <NewProjectSheet
        key={creating.round}
        open={creating.open}
        onClose={() => setCreating((c) => ({ ...c, open: false }))}
        onCreated={(projectId) => void navigate({ to: projectPath(projectId) })}
      />
    </PageContent>
  )
}

function ProjectRow({
  row,
  onOpen,
}: {
  row: GaProjectRow
  onOpen: () => void
}) {
  return (
    <tr
      className="cursor-pointer border-t border-hairline transition-colors hover:bg-soft-2"
      onClick={onOpen}
    >
      <MiniCell>
        <span className="flex min-w-0 items-center gap-3">
          <span className="grid size-[1.875rem] shrink-0 place-items-center rounded-inner bg-soft-2 text-body">
            <FolderKanban className="size-4 stroke-[1.7]" />
          </span>
          <span className="min-w-0">
            <span className="block truncate font-medium text-ink">
              {row.name}
            </span>
            <span className="block truncate text-mute">
              {row.project_number}
            </span>
          </span>
        </span>
      </MiniCell>
      <MiniCell>{row.site_name ?? "—"}</MiniCell>
      <MiniCell>{KIND_LABEL[row.kind]}</MiniCell>
      <MiniCell>{day(row.opens_on)}</MiniCell>
      <MiniCell align="right">
        <span className={row.tasks_late > 0 ? "text-bad-fg" : undefined}>
          {row.tasks_left}
        </span>
      </MiniCell>
      <MiniCell align="right">{row.assets}</MiniCell>
      <MiniCell>
        <Pill tone={STATUS_TONE[row.status]}>{STATUS_WORD[row.status]}</Pill>
      </MiniCell>
    </tr>
  )
}
