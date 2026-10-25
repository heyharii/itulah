import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Flag, Store, Wrench } from "lucide-react"
import { useState } from "react"

import { Day } from "@/components/ui/day"
import { Field, Input, Select } from "@/components/ui/field"
import { Choices, Section } from "@/components/ui/form"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { SheetFooter } from "@/components/ui/sheet-footer"
import { today } from "@/lib/calendar"
import { day } from "@/lib/format"
import { useGaSites } from "@/lib/queries/ga"
import {
  useEveryEmployee,
  useNameOfLogin,
} from "@/lib/queries/hr-employees"
import {
  addProjectTask,
  closeProject,
  createProject,
  daysBetween,
  DEPARTMENT_LABEL,
  updateProjectTask,
  type GaProjectPage,
  type GaProjectTask,
  type ProjectDepartment,
} from "@/lib/queries/projects"
import { toast } from "@/lib/toast"
import { countdown } from "@/screens/projects/shared"

/// The people a task or a project can name as PIC: everyone with a login.
export function PicSelect({
  value,
  onChange,
}: {
  value: string
  onChange: (username: string) => void
}) {
  const people = useEveryEmployee()
  const options = (people.data ?? [])
    .filter((person) => person.username)
    .map((person) => ({
      value: person.username ?? "",
      label: person.full_name ?? person.username ?? "",
    }))
    .sort((a, b) => a.label.localeCompare(b.label))
  return (
    <Select value={value} onChange={onChange} aria-label="PIC">
      <option value="">Not named yet</option>
      {options.map((one) => (
        <option key={one.value} value={one.value}>
          {one.label}
        </option>
      ))}
    </Select>
  )
}

/// New project: what kind, where, and the day it opens. Its tasks come from
/// the kind's template, counted back from that day.
export function NewProjectSheet({
  open,
  onClose,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  onCreated: (projectId: string) => void
}) {
  const client = useQueryClient()
  const { sites } = useGaSites(open)
  const [form, setForm] = useState({
    kind: "STORE_OPENING" as "STORE_OPENING" | "RENOVATION",
    name: "",
    site_id: "",
    opens_on: "",
    pic: "",
  })
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((current) => ({ ...current, [key]: value }))
  const save = useMutation({
    mutationFn: () =>
      createProject({
        name: form.name.trim(),
        kind: form.kind,
        site_id: form.site_id,
        opens_on: form.opens_on,
        pic: form.pic === "" ? null : form.pic,
      }),
    onSuccess: (page) => {
      void client.invalidateQueries({ queryKey: ["ga", "projects"] })
      toast.success(`${page.project.name} · ${page.tasks.length} tasks`)
      onClose()
      onCreated(page.project.project_id)
    },
  })
  const ready =
    form.name.trim() !== "" && form.site_id !== "" && form.opens_on !== ""
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      size="rail"
      context="Projects"
      title="New project"
      dirty={form.name !== "" || form.site_id !== ""}
      footer={
        <SheetFooter
          error={save.error}
          primary={{
            label: "Create",
            onClick: () => save.mutate(),
            pending: save.isPending,
            disabled: !ready,
          }}
        />
      }
    >
      <div className="flex flex-col gap-6">
        <Choices
          label="Kind"
          columns={2}
          value={form.kind}
          onChange={(next) => set("kind", next)}
          options={[
            { value: "STORE_OPENING", label: "Store opening", icon: Store },
            { value: "RENOVATION", label: "Renovation", icon: Wrench },
          ]}
        />
        <Field label="Name" required>
          <Input
            value={form.name}
            onChange={(event) => set("name", event.target.value)}
            placeholder={
              form.kind === "STORE_OPENING" ? "Opening Wonosobo" : "Renovasi Cikupa"
            }
          />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Site" required>
            <Select value={form.site_id} onChange={(next) => set("site_id", next)}>
              <option value="">Choose…</option>
              {sites.map((site) => (
                <option key={site.value} value={site.value}>
                  {site.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label={form.kind === "STORE_OPENING" ? "Opens" : "Ready by"}
            required
          >
            <Day
              value={form.opens_on}
              onChange={(next) => set("opens_on", next)}
              clearable={false}
            />
          </Field>
        </div>
        <Field label="PIC">
          <PicSelect value={form.pic} onChange={(next) => set("pic", next)} />
        </Field>
      </div>
    </Sheet>
  )
}

/// Add a task by hand: what, who, by when.
export function AddTaskSheet({
  open,
  projectId,
  opensOn,
  onClose,
  onSaved,
}: {
  open: boolean
  projectId: string
  opensOn: string | null
  onClose: () => void
  onSaved: (page: GaProjectPage) => void
}) {
  const [form, setForm] = useState({
    name: "",
    department: "ga" as ProjectDepartment,
    pic: "",
    due_on: "",
  })
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((current) => ({ ...current, [key]: value }))
  const save = useMutation({
    mutationFn: () =>
      addProjectTask(projectId, {
        name: form.name.trim(),
        department: form.department,
        pic: form.pic === "" ? null : form.pic,
        due_on: form.due_on,
      }),
    onSuccess: (page) => {
      toast.success("Task added")
      onSaved(page)
      onClose()
    },
  })
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      size="rail"
      context="Tasks"
      title="Add task"
      dirty={form.name !== ""}
      footer={
        <SheetFooter
          error={save.error}
          primary={{
            label: "Add",
            onClick: () => save.mutate(),
            pending: save.isPending,
            disabled: form.name.trim() === "" || form.due_on === "",
          }}
        />
      }
    >
      <div className="flex flex-col gap-6">
        <Field label="Task" required>
          <Input
            value={form.name}
            onChange={(event) => set("name", event.target.value)}
          />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Department">
            <Select
              value={form.department}
              onChange={(next) => set("department", next as ProjectDepartment)}
            >
              {(Object.keys(DEPARTMENT_LABEL) as ProjectDepartment[]).map(
                (key) => (
                  <option key={key} value={key}>
                    {DEPARTMENT_LABEL[key]}
                  </option>
                )
              )}
            </Select>
          </Field>
          <Field label="PIC">
            <PicSelect value={form.pic} onChange={(next) => set("pic", next)} />
          </Field>
        </div>
        <Field
          label="Due"
          required
          aside={
            form.due_on !== "" && opensOn !== null
              ? countdown(daysBetween(form.due_on, opensOn))
              : undefined
          }
        >
          <Day
            value={form.due_on}
            onChange={(next) => set("due_on", next)}
            clearable={false}
          />
        </Field>
      </div>
    </Sheet>
  )
}

/// One task over the project: who, when, where it is done, and Mark done.
export function TaskSheet({
  open,
  projectId,
  task,
  opensOn,
  readOnly,
  onClose,
  onSaved,
}: {
  open: boolean
  projectId: string
  task: GaProjectTask | undefined
  opensOn: string | null
  readOnly: boolean
  onClose: () => void
  onSaved: (page: GaProjectPage) => void
}) {
  const nameOf = useNameOfLogin()
  const save = useMutation({
    mutationFn: (change: { done?: boolean; pic?: string }) =>
      updateProjectTask(projectId, task?.task_id ?? "", change),
    onSuccess: (page) => onSaved(page),
    onError: (error) => toast.error(error.message),
  })
  const late = task !== undefined && task.done_on === null && task.due_on < today()
  return (
    <Sheet
      open={open && task !== undefined}
      onOpenChange={(next) => !next && onClose()}
      size="rail"
      context="Tasks"
      title={task?.name ?? "Task"}
      badge={
        task === undefined ? undefined : task.done_on !== null ? (
          <span className="text-ok-fg">Done</span>
        ) : late ? (
          <span className="text-bad-fg">Late</span>
        ) : undefined
      }
      footer={
        readOnly || task === undefined ? undefined : (
          <SheetFooter
            error={save.error}
            primary={{
              label: task.done_on === null ? "Mark done" : "Not done",
              onClick: () => save.mutate({ done: task.done_on === null }),
              pending: save.isPending,
            }}
          />
        )
      }
    >
      {task !== undefined && (
        <Facts>
          <Fact term="PIC">
            {readOnly ? (
              task.pic === null ? "Not named yet" : nameOf(task.pic)
            ) : (
              <PicSelect
                value={task.pic ?? ""}
                onChange={(next) => save.mutate({ pic: next })}
              />
            )}
          </Fact>
          <Fact term="Department">{DEPARTMENT_LABEL[task.department]}</Fact>
          <Fact term="Due">
            {day(task.due_on)}
            {opensOn !== null &&
              ` · ${countdown(daysBetween(task.due_on, opensOn))}`}
          </Fact>
          <Fact term="Done">
            {task.done_on === null
              ? "—"
              : `${day(task.done_on)} · ${nameOf(task.done_by ?? "")}`}
          </Fact>
          <Fact term="From">
            {task.from_template ? "The project's template" : "Added by hand"}
          </Fact>
          {task.milestone && (
            <Fact term="Milestone">
              <Flag className="inline size-4 text-accent" /> Yes
            </Fact>
          )}
        </Facts>
      )}
    </Sheet>
  )
}

/// GA's close: the place is ready. Lists what is not done; closing anyway is
/// GA's call.
export function CloseProjectSheet({
  open,
  page,
  onClose,
  onSaved,
}: {
  open: boolean
  page: GaProjectPage
  onClose: () => void
  onSaved: (page: GaProjectPage) => void
}) {
  const [readyOn, setReadyOn] = useState(today())
  const notDone = page.tasks.filter((task) => task.done_on === null)
  const save = useMutation({
    mutationFn: () => closeProject(page.project.project_id, readyOn),
    onSuccess: (next) => {
      toast.success("Project closed")
      onSaved(next)
      onClose()
    },
  })
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      size="rail"
      context={page.project.name}
      title="Close project"
      footer={
        <SheetFooter
          error={save.error}
          primary={{
            label: "Close project",
            onClick: () => save.mutate(),
            pending: save.isPending,
            disabled: readyOn === "",
          }}
        />
      }
    >
      <div className="flex flex-col gap-6">
        <Facts>
          <Fact term="Assets">{page.assets.length}</Fact>
          <Fact term="Work">{page.work.length}</Fact>
          <Fact term="Tasks done">
            {page.tasks.length - notDone.length} of {page.tasks.length}
          </Fact>
        </Facts>
        {notDone.length > 0 && (
          <Section title="Not done">
            <ul className="flex flex-col gap-1.5 text-[0.9375rem] text-warn-fg">
              {notDone.map((task) => (
                <li key={task.task_id}>{task.name}</li>
              ))}
            </ul>
          </Section>
        )}
        <Field label="Ready on" required>
          <Day value={readyOn} onChange={setReadyOn} clearable={false} />
        </Field>
      </div>
    </Sheet>
  )
}
