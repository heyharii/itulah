import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { useParams } from "@tanstack/react-router"
import {
  CircleCheck,
  Clock,
  FileSignature,
  FileText,
  Flag,
  LayoutGrid,
  Package,
  Plus,
  Wrench,
  Circle,
} from "lucide-react"
import { useMemo, useRef, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { FilterChips } from "@/components/ui/filter-chips"
import { Choices } from "@/components/ui/form"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { MiniCell, MiniTable } from "@/components/ui/rows"
import { Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState } from "@/components/ui/states"
import { SubTabs } from "@/components/ui/sub-tabs"
import { today } from "@/lib/calendar"
import { day } from "@/lib/format"
import { useNameOfLogin } from "@/lib/queries/hr-employees"
import {
  daysBetween,
  DEPARTMENT_LABEL,
  KIND_LABEL,
  linkToProject,
  projectKeys,
  projectPageQuery,
  updateProjectTask,
  type GaProjectPage,
  type GaProjectTask,
  type ProjectWorkKind,
} from "@/lib/queries/projects"
import {
  documentDownloadUrl,
  searchDocuments,
  uploadDocument,
} from "@/lib/queries/workplace"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"
import { toast } from "@/lib/toast"
import { cn } from "@/lib/utils"
import { AssetThumb } from "@/screens/assets/asset-photo"
import { AssetHubSheet } from "@/screens/assets/hub"
import { RegisterAssetSheet } from "@/screens/assets/register"
import { ContractComposer } from "@/screens/contracts/composer"
import { ContractHubSheet } from "@/screens/contracts/hub"
import { RepairSheet } from "@/screens/maintenance/hub"
import { RepairComposer } from "@/screens/maintenance/repairs"
import { CapitaliseSheet, CostsTab } from "@/screens/projects/costs"
import {
  AddTaskSheet,
  CloseProjectSheet,
  TaskSheet,
} from "@/screens/projects/forms"
import {
  countdown,
  STATUS_TONE,
  STATUS_WORD,
} from "@/screens/projects/shared"
import { SupplyComposer } from "@/screens/supplies/composer"
import { SupplySheet } from "@/screens/supplies/supplies"

/// GA's route: `/projects/$project`.
export function ProjectScreen() {
  const params = useParams({ strict: false }) as unknown as { project: string }
  return <ProjectView projectId={params.project} finance={false} />
}

/// Finance's route: Assets › Projects › one project.
export function FinanceProjectScreen() {
  const params = useParams({ strict: false }) as unknown as { project: string }
  return <ProjectView projectId={params.project} finance />
}

type Tab = "tasks" | "costs" | "assets" | "work" | "files"

/// One project, one page, in tabs: GA's Tasks · Assets · Work · Files, and
/// Finance's Costs in front of the same three. Everything in a tab opens as a
/// sheet over the page.
export function ProjectView({
  projectId,
  finance,
}: {
  projectId: string
  finance: boolean
}) {
  const client = useQueryClient()
  const page = useQuery({
    ...projectPageQuery(projectId, finance),
    refetchInterval: 10_000,
  })
  const tabParam = useSheet("project-tab")
  const tab: Tab = (tabParam.value as Tab | undefined) ?? (finance ? "costs" : "tasks")
  const [closing, setClosing] = useState(false)
  const [capitalising, setCapitalising] = useState(false)
  const keep = (next: GaProjectPage) => {
    client.setQueryData(projectKeys.page(projectId), next)
    void client.invalidateQueries({ queryKey: ["ga", "projects"], exact: true })
  }

  const project = page.data?.project
  const open = project?.status === "OPEN"
  return (
    <PageContent>
      <PageHeader
        crumb={finance ? "Assets / Projects" : "Projects"}
        title={project?.name ?? "Project"}
        sub={
          project
            ? [project.site_name, KIND_LABEL[project.kind], project.project_number]
                .filter(Boolean)
                .join(" · ")
            : undefined
        }
        actions={
          project && (
            <>
              <Pill tone={STATUS_TONE[project.status]}>
                {STATUS_WORD[project.status]}
              </Pill>
              {!finance && open && (
                <Button variant="primary" onClick={() => setClosing(true)}>
                  Close project
                </Button>
              )}
              {finance && project.status !== "CAPITALISED" && (
                <Button
                  variant="primary"
                  disabled={project.status !== "READY" && project.kind !== "CONTRACTOR"}
                  onClick={() => setCapitalising(true)}
                >
                  Capitalise
                </Button>
              )}
            </>
          )
        }
      />

      {queryState(page, {
        loading: "Reading the project…",
        render: (data) => {
          const p = data.project
          const tabs = finance
            ? [
                { value: "costs", label: "Costs" },
                { value: "assets", label: `Assets ${data.assets.length}` },
                { value: "work", label: `Work ${data.work.length}` },
                { value: "files", label: "Files" },
              ]
            : [
                {
                  value: "tasks",
                  label: `Tasks ${p.tasks_left}`,
                  alert: p.tasks_late,
                },
                { value: "assets", label: `Assets ${data.assets.length}` },
                { value: "work", label: `Work ${data.work.length}` },
                { value: "files", label: "Files" },
              ]
          return (
            <>
              {p.status === "READY" && (
                <Banner tone="info" className="mb-4 bg-soft-2 text-body">
                  <ClosedBy page={data} />
                </Banner>
              )}
              {p.status === "CAPITALISED" && (
                <Banner tone="info" className="mb-4 bg-soft-2 text-body">
                  <span className="font-medium">
                    Capitalised · in use from {day(p.capitalised_on)}
                  </span>
                </Banner>
              )}
              {!finance && (
                <KpiStrip>
                  <Kpi label="Opens" value={day(p.opens_on)} />
                  <Kpi label="Tasks left" value={p.tasks_left} />
                  <Kpi
                    label="Late"
                    value={
                      <span className={p.tasks_late > 0 ? "text-bad-fg" : undefined}>
                        {p.tasks_late}
                      </span>
                    }
                  />
                  <Kpi label="Assets" value={data.assets.length} />
                  <Kpi label="Work" value={data.work.length} />
                </KpiStrip>
              )}
              <SubTabs
                tabs={tabs}
                value={tab}
                onChange={(next) => tabParam.replace(next as never)}
              />
              {tab === "tasks" && !finance && (
                <TasksTab page={data} readOnly={!open} onSaved={keep} />
              )}
              {tab === "costs" && finance && <CostsTab page={data} />}
              {tab === "assets" && (
                <AssetsTab page={data} readOnly={finance || !open} onSaved={keep} />
              )}
              {tab === "work" && (
                <WorkTab page={data} readOnly={finance || !open} onSaved={keep} />
              )}
              {tab === "files" && (
                <FilesTab projectId={p.project_id} readOnly={finance} />
              )}
              {!finance && (
                <CloseProjectSheet
                  key={String(closing)}
                  open={closing}
                  page={data}
                  onClose={() => setClosing(false)}
                  onSaved={keep}
                />
              )}
              {finance && (
                <CapitaliseSheet
                  key={String(capitalising)}
                  open={capitalising}
                  page={data}
                  onClose={() => setCapitalising(false)}
                />
              )}
            </>
          )
        },
      })}
    </PageContent>
  )
}

function ClosedBy({ page }: { page: GaProjectPage }) {
  const nameOf = useNameOfLogin()
  return (
    <span className="font-medium">
      Closed by {nameOf(page.project.ready_by ?? "")} · ready{" "}
      {day(page.project.ready_on)}
    </span>
  )
}

/// A bar over a tab's table: the tab's action at the right.
function Bar({ children }: { children?: React.ReactNode }) {
  if (!children) return null
  return <div className="mb-3 flex items-center justify-end gap-2">{children}</div>
}

// ── tasks ───────────────────────────────────────────────────────────────

type TaskView = "open" | "late" | "done" | "all"

function TasksTab({
  page,
  readOnly,
  onSaved,
}: {
  page: GaProjectPage
  readOnly: boolean
  onSaved: (page: GaProjectPage) => void
}) {
  const nameOf = useNameOfLogin()
  const [view, setView] = useState<TaskView>("open")
  const [adding, setAdding] = useState({ open: false, round: 0 })
  const taskSheet = useSheet("project-task")
  const now = today()
  const opensOn = page.project.opens_on
  const isLate = (task: GaProjectTask) => task.done_on === null && task.due_on < now
  const counts = {
    open: page.tasks.filter((t) => t.done_on === null).length,
    late: page.tasks.filter(isLate).length,
    done: page.tasks.filter((t) => t.done_on !== null).length,
    all: page.tasks.length,
  }
  const shown = page.tasks.filter((task) =>
    view === "all"
      ? true
      : view === "open"
        ? task.done_on === null
        : view === "done"
          ? task.done_on !== null
          : isLate(task)
  )
  const tick = useMutation({
    mutationFn: (task: GaProjectTask) =>
      updateProjectTask(page.project.project_id, task.task_id, {
        done: task.done_on === null,
      }),
    onSuccess: (next, task) => {
      onSaved(next)
      toast.success(task.done_on === null ? `Done · ${task.name}` : `Not done · ${task.name}`)
    },
    onError: (error) => toast.error(error.message),
  })
  // Where "today" falls in the list: before the first task due today or later.
  const todayAt =
    view === "done" || view === "late"
      ? -1
      : shown.findIndex((task) => task.due_on >= now)

  const today_row = (
    <tr key="today" className="border-t border-hairline bg-accent-bg">
      <MiniCell colSpan={4} className="py-2 font-semibold text-accent">
        Today · {day(now)}
      </MiniCell>
    </tr>
  )
  return (
    <>
      <div className="mb-3.5 flex flex-wrap items-center gap-2">
        <FilterChips
          label="Tasks"
          value={view === "all" ? null : view}
          onChange={(next) => setView((next ?? "all") as TaskView)}
          options={[
            { value: "open", label: "To do", icon: Circle, count: counts.open },
            { value: "late", label: "Late", icon: Clock, count: counts.late },
            { value: "done", label: "Done", icon: CircleCheck, count: counts.done },
            { value: null, label: "All", icon: LayoutGrid, count: counts.all },
          ]}
        />
        {!readOnly && (
          <Button
            variant="primary"
            className="ml-auto"
            onClick={() => setAdding((a) => ({ open: true, round: a.round + 1 }))}
          >
            <Plus className="size-4" />
            Add task
          </Button>
        )}
      </div>
      <Card className="overflow-hidden">
        {shown.length === 0 ? (
          <EmptyState>
            {view === "late" ? "Nothing is late." : view === "done" ? "Nothing is done yet." : "No task here."}
          </EmptyState>
        ) : (
          <MiniTable
            head={[
              "",
              { label: "Task", align: "left" },
              { label: "PIC", align: "left" },
              { label: "Due", align: "left" },
            ]}
          >
            {shown.flatMap((task, index) => {
              const late = isLate(task)
              const row = (
                <tr
                  key={task.task_id}
                  className={cn(
                    "cursor-pointer border-t border-hairline transition-colors hover:bg-soft-2",
                    task.done_on !== null && "text-mute"
                  )}
                  onClick={() => taskSheet.open(task.task_id)}
                >
                  <MiniCell className="w-12">
                    <button
                      type="button"
                      aria-label={task.done_on === null ? "Mark done" : "Not done"}
                      aria-pressed={task.done_on !== null}
                      disabled={readOnly || tick.isPending}
                      onClick={(event) => {
                        event.stopPropagation()
                        tick.mutate(task)
                      }}
                      className={cn(
                        "grid size-[1.375rem] place-items-center rounded-full border-[1.5px] transition-[background-color,border-color,scale] duration-150 active:scale-90",
                        task.done_on !== null
                          ? "border-ok bg-ok text-white"
                          : "border-hairline-2 bg-canvas"
                      )}
                    >
                      {task.done_on !== null && <CircleCheck className="size-3.5" />}
                    </button>
                  </MiniCell>
                  <MiniCell>
                    <span className="flex min-w-0 items-center gap-2">
                      {task.milestone && (
                        <Flag className="size-3.5 shrink-0 text-accent" />
                      )}
                      <span className="min-w-0">
                        <span
                          className={cn(
                            "block truncate",
                            task.done_on === null ? "font-medium text-ink" : "text-mute"
                          )}
                        >
                          {task.name}
                        </span>
                        <span className="block truncate text-mute">
                          {DEPARTMENT_LABEL[task.department]}
                        </span>
                      </span>
                    </span>
                  </MiniCell>
                  <MiniCell>
                    <span className="block truncate">
                      {task.pic === null ? (
                        <span className="text-mute">Not named yet</span>
                      ) : (
                        nameOf(task.pic)
                      )}
                    </span>
                  </MiniCell>
                  <MiniCell>
                    <span className={cn("block", late && "text-bad-fg")}>
                      {day(task.due_on)}
                    </span>
                    <span className="block text-mute">
                      {task.done_on !== null
                        ? `Done ${day(task.done_on)}`
                        : opensOn === null
                          ? ""
                          : countdown(daysBetween(task.due_on, opensOn))}
                    </span>
                  </MiniCell>
                </tr>
              )
              return index === todayAt ? [today_row, row] : [row]
            })}
            {todayAt === -1 && view !== "done" && view !== "late" && today_row}
          </MiniTable>
        )}
      </Card>
      <AddTaskSheet
        key={adding.round}
        open={adding.open}
        projectId={page.project.project_id}
        opensOn={opensOn}
        onClose={() => setAdding((a) => ({ ...a, open: false }))}
        onSaved={onSaved}
      />
      <TaskSheet
        open={taskSheet.isOpen}
        projectId={page.project.project_id}
        task={page.tasks.find((task) => task.task_id === taskSheet.value)}
        opensOn={opensOn}
        readOnly={readOnly}
        onClose={taskSheet.close}
        onSaved={onSaved}
      />
    </>
  )
}

// ── assets ──────────────────────────────────────────────────────────────

function AssetsTab({
  page,
  readOnly,
  onSaved,
}: {
  page: GaProjectPage
  readOnly: boolean
  onSaved: (page: GaProjectPage) => void
}) {
  const [registering, setRegistering] = useState({ open: false, round: 0 })
  const assetSheet = useSheet("asset")
  const link = useMutation({
    mutationFn: (assetId: string) =>
      linkToProject(page.project.project_id, "ASSET", assetId),
    onSuccess: (next) => {
      onSaved(next)
      toast.success("Asset registered · In project")
    },
    onError: (error) => toast.error(error.message),
  })
  const word = (status: string) =>
    status === "IN_PROGRESS" ? "In project" : status === "DISPOSED" ? "Disposed" : "In use"
  return (
    <>
      <Bar>
        {!readOnly && (
          <Button
            variant="primary"
            onClick={() =>
              setRegistering((r) => ({ open: true, round: r.round + 1 }))
            }
          >
            <Plus className="size-4" />
            Register asset
          </Button>
        )}
      </Bar>
      <Card className="overflow-hidden">
        {page.assets.length === 0 ? (
          <EmptyState>No asset registered for this project yet.</EmptyState>
        ) : (
          <MiniTable
            head={[
              "Asset",
              { label: "Class", align: "left" },
              "Qty",
              { label: "Status", align: "left" },
            ]}
          >
            {page.assets.map((asset) => (
              <tr
                key={asset.asset_id}
                className="cursor-pointer border-t border-hairline transition-colors hover:bg-soft-2"
                onClick={() => assetSheet.open(asset.asset_id)}
              >
                <MiniCell>
                  <span className="flex min-w-0 items-center gap-3">
                    <AssetThumb assetId={asset.asset_id} build={asset.build} />
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-ink">
                        {asset.name}
                      </span>
                      <span className="block truncate text-mute">
                        {asset.asset_number}
                      </span>
                    </span>
                  </span>
                </MiniCell>
                <MiniCell>{asset.class_name}</MiniCell>
                <MiniCell align="right">{asset.quantity}</MiniCell>
                <MiniCell>
                  <span
                    className={
                      asset.status === "IN_PROGRESS" ? "text-info-fg" : "text-ok-fg"
                    }
                  >
                    {word(asset.status)}
                  </span>
                </MiniCell>
              </tr>
            ))}
          </MiniTable>
        )}
      </Card>
      <RegisterAssetSheet
        key={registering.round}
        open={registering.open}
        site={page.project.site_id ?? undefined}
        onClose={() => setRegistering((r) => ({ ...r, open: false }))}
        onRegistered={(assetId) => {
          setRegistering((r) => ({ ...r, open: false }))
          link.mutate(assetId)
        }}
        builds={[
          "BUILDING",
          "TECH",
          "VEHICLE",
          "FFE",
          "IT",
          "AUDIO",
          "OE",
          "SOFTWARE",
          "LAND",
        ]}
      />
      <AssetHubSheet
        assetId={assetSheet.value ?? undefined}
        open={assetSheet.isOpen}
        onClose={assetSheet.close}
      />
    </>
  )
}

// ── work ────────────────────────────────────────────────────────────────

const WORK_ICON = {
  CONTRACT: FileSignature,
  REPAIR: Wrench,
  SUPPLY_REQUEST: Package,
} as const
const WORK_WORD: Record<ProjectWorkKind, string> = {
  CONTRACT: "Contract",
  REPAIR: "Repair",
  SUPPLY_REQUEST: "Supply request",
}

function WorkTab({
  page,
  readOnly,
  onSaved,
}: {
  page: GaProjectPage
  readOnly: boolean
  onSaved: (page: GaProjectPage) => void
}) {
  const [choosing, setChoosing] = useState(false)
  const [kind, setKind] = useState<ProjectWorkKind>("CONTRACT")
  const [composing, setComposing] = useState<{
    kind: ProjectWorkKind | null
    round: number
  }>({ kind: null, round: 0 })
  const contractSheet = useSheet("contract")
  const repairSheet = useSheet("repair")
  const supplySheet = useSheet("supply")
  const link = useMutation({
    mutationFn: ({ kind, id }: { kind: ProjectWorkKind; id: string }) =>
      linkToProject(page.project.project_id, kind, id),
    onSuccess: (next, { kind }) => {
      onSaved(next)
      toast.success(`${WORK_WORD[kind]} added to ${page.project.name}`)
    },
    onError: (error) => toast.error(error.message),
  })
  const saved = (kind: ProjectWorkKind) => (id: string) => {
    setComposing((c) => ({ ...c, kind: null }))
    link.mutate({ kind, id })
  }
  const openRecord = (kind: ProjectWorkKind, id: string) => {
    if (kind === "CONTRACT") contractSheet.open(id)
    else if (kind === "REPAIR") repairSheet.open(id)
    else supplySheet.open(id)
  }
  return (
    <>
      <Bar>
        {!readOnly && (
          <Button variant="primary" onClick={() => setChoosing(true)}>
            <Plus className="size-4" />
            Add work
          </Button>
        )}
      </Bar>
      <Card className="overflow-hidden">
        {page.work.length === 0 ? (
          <EmptyState>No contract, repair or supply request yet.</EmptyState>
        ) : (
          <MiniTable
            head={[
              "What",
              { label: "Kind", align: "left" },
              { label: "Status", align: "left" },
            ]}
          >
            {page.work.map((work) => {
              const Icon = WORK_ICON[work.kind]
              return (
                <tr
                  key={`${work.kind}:${work.record_id}`}
                  className="cursor-pointer border-t border-hairline transition-colors hover:bg-soft-2"
                  onClick={() => openRecord(work.kind, work.record_id)}
                >
                  <MiniCell>
                    <span className="flex min-w-0 items-center gap-3">
                      <span className="grid size-[1.875rem] shrink-0 place-items-center rounded-inner bg-soft-2 text-body">
                        <Icon className="size-4 stroke-[1.7]" />
                      </span>
                      <span className="min-w-0">
                        {/* A contract is known by who it is with; its
                            object is a code, read as words under it. */}
                        <span className="block truncate font-medium text-ink">
                          {work.kind === "CONTRACT"
                            ? (work.party ?? work.number ?? statusWords(work.name))
                            : work.name}
                        </span>
                        <span className="block truncate text-mute">
                          {(work.kind === "CONTRACT"
                            ? [work.number, statusWords(work.name)]
                            : [work.number, work.party]
                          )
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </span>
                    </span>
                  </MiniCell>
                  <MiniCell>{WORK_WORD[work.kind]}</MiniCell>
                  <MiniCell>{statusWords(work.status)}</MiniCell>
                </tr>
              )
            })}
          </MiniTable>
        )}
      </Card>

      <Sheet
        open={choosing}
        onOpenChange={(next) => !next && setChoosing(false)}
        size="rail"
        context={page.project.name}
        title="Add work"
        footer={
          <div className="flex justify-end">
            <Button
              variant="primary"
              onClick={() => {
                setChoosing(false)
                setComposing((c) => ({ kind, round: c.round + 1 }))
              }}
            >
              Next
            </Button>
          </div>
        }
      >
        <Choices
          label="Kind"
          columns={1}
          value={kind}
          onChange={setKind}
          options={[
            { value: "CONTRACT", label: "Contract", icon: FileSignature },
            { value: "REPAIR", label: "Repair", icon: Wrench },
            { value: "SUPPLY_REQUEST", label: "Supply request", icon: Package },
          ]}
        />
      </Sheet>

      <ContractComposer
        key={`contract:${composing.round}`}
        open={composing.kind === "CONTRACT"}
        group=""
        onClose={() => setComposing((c) => ({ ...c, kind: null }))}
        onSaved={saved("CONTRACT")}
      />
      <RepairComposer
        key={`repair:${composing.round}`}
        open={composing.kind === "REPAIR"}
        onClose={() => setComposing((c) => ({ ...c, kind: null }))}
        onSaved={saved("REPAIR")}
      />
      <SupplyComposer
        key={`supply:${composing.round}`}
        open={composing.kind === "SUPPLY_REQUEST"}
        onClose={() => setComposing((c) => ({ ...c, kind: null }))}
        onSaved={saved("SUPPLY_REQUEST")}
      />

      <ContractHubSheet
        contractId={contractSheet.value ?? undefined}
        open={contractSheet.isOpen}
        onClose={contractSheet.close}
      />
      <RepairSheet
        repairId={repairSheet.value ?? undefined}
        open={repairSheet.isOpen}
        onClose={repairSheet.close}
      />
      <SupplySheet
        requestId={supplySheet.value ?? undefined}
        open={supplySheet.isOpen}
        onClose={supplySheet.close}
        onOpenSite={() => undefined}
      />
    </>
  )
}

/// A work record's status in words, from the server's upper-case code.
function statusWords(status: string): string {
  const text = status.replace(/_/g, " ").toLowerCase()
  return text.charAt(0).toUpperCase() + text.slice(1)
}

// ── files ───────────────────────────────────────────────────────────────

function FilesTab({
  projectId,
  readOnly,
}: {
  projectId: string
  readOnly: boolean
}) {
  const client = useQueryClient()
  const picker = useRef<HTMLInputElement>(null)
  const key = useMemo(() => ["documents", "project", projectId] as const, [projectId])
  const files = useQuery({
    queryKey: key,
    queryFn: ({ signal }) =>
      searchDocuments({ subjectKind: "project", subjectId: projectId }, signal),
  })
  const attach = useMutation({
    mutationFn: async (picked: readonly File[]) => {
      for (const file of picked) {
        await uploadDocument(file, {
          title: file.name,
          path_tokens: ["GA", "Projects", projectId],
          tags: [],
          links: [{ subject_kind: "project", subject_id: projectId }],
        })
      }
    },
    onSuccess: (_done, picked) => {
      void client.invalidateQueries({ queryKey: key })
      toast.success(picked.length === 1 ? "File added" : "Files added")
    },
    onError: (error) => toast.error(error.message),
  })
  const download = async (documentId: string) => {
    try {
      const { url } = await documentDownloadUrl(documentId)
      window.open(url, "_blank", "noopener")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
  }
  return (
    <>
      <Bar>
        {!readOnly && (
          <>
            <Button variant="primary" onClick={() => picker.current?.click()}>
              <Plus className="size-4" />
              {attach.isPending ? "Adding…" : "Add file"}
            </Button>
            <input
              ref={picker}
              type="file"
              multiple
              accept="image/*,application/pdf"
              className="hidden"
              onChange={(event) => {
                const picked = Array.from(event.target.files ?? [])
                event.target.value = ""
                if (picked.length > 0) attach.mutate(picked)
              }}
            />
          </>
        )}
      </Bar>
      <Card className="overflow-hidden">
        {queryState(files, {
          loading: "Reading the files…",
          render: (rows) =>
            rows.length === 0 ? (
              <EmptyState>No file yet.</EmptyState>
            ) : (
              <MiniTable
                head={[
                  "File",
                  { label: "Added", align: "left" },
                ]}
              >
                {rows.map((file) => (
                  <tr
                    key={file.document_id}
                    className="cursor-pointer border-t border-hairline transition-colors hover:bg-soft-2"
                    onClick={() => void download(file.document_id)}
                  >
                    <MiniCell>
                      <span className="flex min-w-0 items-center gap-3">
                        <span className="grid size-[1.875rem] shrink-0 place-items-center rounded-inner bg-soft-2 text-body">
                          <FileText className="size-4 stroke-[1.7]" />
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-ink">
                            {file.title ?? file.name}
                          </span>
                          <span className="block truncate text-mute">
                            {file.content_type.split("/").pop()?.toUpperCase()}
                          </span>
                        </span>
                      </span>
                    </MiniCell>
                    <MiniCell>{day(file.created_at)}</MiniCell>
                  </tr>
                ))}
              </MiniTable>
            ),
        })}
      </Card>
    </>
  )
}
