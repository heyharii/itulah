import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import type { Role } from "@itulah/contract"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Checkbox, Field, Input, Select } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState } from "@/components/ui/states"
import { Tag } from "@/components/ui/tag"
import {
  deleteRole,
  SECTION_LABEL,
  SECTIONS,
  roleHint,
  roleKeys,
  sectionsOf,
  updateRole,
  useRoles,
  type JobRole,
  type SectionCode,
} from "@/lib/queries/invitations"
import { queryState } from "@/lib/query-state"
import { useCanWrite } from "@/lib/session"
import { useSheet } from "@/lib/sheets"
import { saying } from "@/screens/system/units"

/// HR › Job roles — every job role a person can be invited as, and the
/// sections of the app each one may see. Moved out of System › Users on
/// 2026-09-29: a job role is an HR decision. Changing one is still an Admin
/// write at the server (`/api/v1/roles` PUT/DELETE), so HR reads the list and
/// the Admin edits it — HR never reaches System.
export function JobRoles() {
  return (
    <PageContent>
      <PageHeader
        crumb="People"
        title="Job roles"
        sub="Every job role a person can be invited as, and which parts of Central each one may see."
      />
      <RolesTab />
    </PageContent>
  )
}

function RolesTab() {
  const roleList = useRoles()
  const canWrite = useCanWrite()
  const role = useSheet("role")

  return (
    <>
      <p className="mb-3.5 text-[0.875rem] text-body">
        Every job role a person can be invited as, and the sections of this app
        each one may see. OWNER and ADMIN see every section regardless of what
        is ticked here — that bypass is not editable.
      </p>
      <Card className="overflow-hidden">
        {queryState(roleList, {
          loading: "Loading job roles…",
          render: () =>
            (roleList.data ?? []).length === 0 ? (
              <EmptyState>No job role is seeded on this node yet.</EmptyState>
            ) : (
              <div className="divide-y divide-hairline">
                {(roleList.data ?? []).map((item) => (
                  <button
                    key={item.code}
                    type="button"
                    onClick={() => canWrite && role.open(item.code)}
                    disabled={!canWrite}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-soft disabled:cursor-default disabled:hover:bg-transparent"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <b className="font-medium text-ink">{item.name}</b>
                        <span className="font-mono text-id text-mute">
                          {item.code}
                        </span>
                        {item.builtin && <Tag>Built in</Tag>}
                      </div>
                      {roleHint(item) && (
                        <p className="mt-0.5 truncate text-meta text-body">
                          {roleHint(item)}
                        </p>
                      )}
                    </div>
                    <span className="shrink-0 text-meta text-mute">
                      {item.rung} · {item.holders}{" "}
                      {item.holders === 1 ? "holder" : "holders"}
                    </span>
                    <div className="flex max-w-64 shrink-0 flex-wrap justify-end gap-1">
                      {sectionsOf(item.sections).length === 0 ? (
                        <span className="text-meta text-mute">No sections</span>
                      ) : (
                        sectionsOf(item.sections).map((section) => (
                          <Tag key={section}>{SECTION_LABEL[section]}</Tag>
                        ))
                      )}
                    </div>
                  </button>
                ))}
              </div>
            ),
        })}
      </Card>

      <RoleSheet
        key={role.value ?? "none"}
        role={
          (roleList.data ?? []).find((item) => item.code === role.value) ?? null
        }
        open={role.value !== undefined}
        onClose={role.close}
      />
    </>
  )
}

const RUNGS: readonly Role[] = ["CASHIER", "SUPERVISOR", "ADMIN"]

const NODE_REACH: readonly { value: string; label: string; hint: string }[] = [
  { value: "NONE", label: "No server", hint: "Signs in at the centre only." },
  {
    value: "UNIT",
    label: "This unit's server",
    hint: "The store or gudang server the person is posted to.",
  },
  { value: "EVERY", label: "Every server", hint: "Head office roles only." },
]

function RoleSheet({
  role,
  open,
  onClose,
}: {
  role: JobRole | null
  open: boolean
  onClose: () => void
}) {
  const client = useQueryClient()
  const [name, setName] = useState(role?.name ?? "")
  const [rung, setRung] = useState<Role>(role?.rung ?? "CASHIER")
  const [description, setDescription] = useState(role?.description ?? "")
  const [readOnly, setReadOnly] = useState(role?.read_only ?? false)
  const [nodeReach, setNodeReach] = useState(role?.node_reach ?? "NONE")
  const [flowRoles, setFlowRoles] = useState(
    (role?.flow_roles ?? []).join(", ")
  )
  const [sections, setSections] = useState<readonly SectionCode[]>(
    sectionsOf(role?.sections)
  )

  const invalidate = () => client.invalidateQueries({ queryKey: roleKeys.all })

  const save = useMutation({
    mutationFn: () =>
      updateRole(role!.code, {
        name: name.trim(),
        rung,
        sections: [...sections],
        description: description.trim(),
        read_only: readOnly,
        node_reach: nodeReach,
        flow_roles: flowRoles
          .split(",")
          .map((one) => one.trim())
          .filter((one) => one !== ""),
      }),
    onSuccess: () => {
      void invalidate()
      onClose()
    },
  })

  const remove = useMutation({
    mutationFn: () => deleteRole(role!.code),
    onSuccess: () => {
      void invalidate()
      onClose()
    },
  })

  function toggle(section: SectionCode) {
    setSections((prev) =>
      prev.includes(section)
        ? prev.filter((one) => one !== section)
        : [...prev, section]
    )
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      id={role?.code}
      title={role ? `${role.name} — ${role.code}` : "Job Role"}
      footer={
        <div className="flex items-center gap-2">
          {role && !role.builtin && (
            <Button
              variant="danger"
              pending={remove.isPending}
              disabled={role.holders > 0}
              onClick={() => remove.mutate()}
            >
              {remove.isPending ? "Deleting…" : "Delete"}
            </Button>
          )}
          <span className="flex-1" />
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            pending={save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending ? "Submitting…" : "Submit"}
          </Button>
        </div>
      }
    >
      {role === null ? (
        <p className="text-meta text-body">That role is no longer listed.</p>
      ) : (
        <div className="flex flex-col gap-3.5">
          <Field label="Name" required>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <Field label="Description" hint="One line, shown on the invite form.">
            <Input
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </Field>
          <Field
            label="Rung"
            hint="Where this role stands on the CASHIER / SUPERVISOR / ADMIN ladder."
          >
            <Select value={rung} onChange={(next) => setRung(next as Role)}>
              {RUNGS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Store servers"
            hint="Which servers a holder signs in at, derived from their unit."
          >
            <Select value={nodeReach} onChange={setNodeReach}>
              {NODE_REACH.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>
          <Checkbox
            label="Read only"
            hint="Every write button is hidden for this role, everywhere."
            checked={readOnly}
            onChange={setReadOnly}
          />
          <Field
            label="Sections"
            hint="Which parts of the sidebar this role sees. OWNER and ADMIN see every one regardless."
          >
            <div className="grid grid-cols-2 gap-2">
              {SECTIONS.map((section) => (
                <Checkbox
                  key={section}
                  label={SECTION_LABEL[section]}
                  checked={sections.includes(section)}
                  onChange={() => toggle(section)}
                />
              ))}
            </div>
          </Field>
          <Field
            label="Flow roles"
            hint="Comma separated. The stages of a workflow this role may perform."
          >
            <Input
              value={flowRoles}
              onChange={(event) => setFlowRoles(event.target.value)}
            />
          </Field>
          {role.builtin ? (
            <p className="text-meta text-mute">
              Built in — it can be edited but not deleted.
            </p>
          ) : role.holders > 0 ? (
            <p className="text-meta text-mute">
              {role.holders} {role.holders === 1 ? "person" : "people"} hold
              this role — give them another one before deleting it.
            </p>
          ) : null}
          {(save.isError || remove.isError) && (
            <Banner tone="bad">{saying(save.error ?? remove.error)}</Banner>
          )}
        </div>
      )}
    </Sheet>
  )
}
