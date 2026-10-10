import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Field, Input, Select } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { EmptyState, Problem } from "@/components/ui/states"
import { DockTools } from "@/components/shell/dock-tools"
import { Fab } from "@/components/ui/fab"
import { Sheet } from "@/components/ui/sheet"
import { label, moment } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import {
  financeKeys,
  listRolePermissions,
  removeRolePermission,
  setRolePermission,
} from "@/lib/queries/finance"
import { queryState } from "@/lib/query-state"
import { Code, Grid, Td, Th } from "@/screens/finance-final/parts"
import { PhoneCard, PhoneList } from "@/components/ui/phone-cards"
import type { RolePermission } from "@itulah/contract"

/// Who may call what, on top of the built-in roles (ERPNext Role Permission
/// Manager).
///
/// An override names a method and a path prefix and the least role that may
/// call it. The longest matching prefix wins; removing an override puts the
/// built-in rule back. Applies the moment it is saved — the server forgets its
/// cached overrides on every change.
const METHODS = ["*", "GET", "POST", "PUT", "PATCH", "DELETE"] as const
const ROLES = ["CASHIER", "SUPERVISOR", "ADMIN"] as const

function roleTone(role: string): "neutral" | "info" | "warn" {
  if (role === "ADMIN") return "warn"
  if (role === "SUPERVISOR") return "info"
  return "neutral"
}

export function Permissions() {
  const phone = useLayout() === "phone"
  /// The phone's form is a sheet the dock's + opens.
  const [adding, setAdding] = useState(false)
  const client = useQueryClient()
  const list = useQuery({
    queryKey: financeKeys.permissions(),
    queryFn: ({ signal }) => listRolePermissions(signal),
  })
  const [needle, setNeedle] = useState("")
  const [method, setMethod] = useState<string>("POST")
  const [prefix, setPrefix] = useState("/api/v1/finance/")
  const [role, setRole] = useState<string>("ADMIN")
  const [note, setNote] = useState("")

  const add = useMutation({
    mutationFn: () =>
      setRolePermission({
        method,
        path_prefix: prefix.trim(),
        min_role: role,
        note: note.trim() === "" ? null : note.trim(),
      }),
    onSuccess: (rows) => {
      client.setQueryData(financeKeys.permissions(), rows)
      setNote("")
      setAdding(false)
    },
  })
  const remove = useMutation({
    mutationFn: (row: RolePermission) =>
      removeRolePermission({
        method: row.method,
        path_prefix: row.path_prefix,
      }),
    onSuccess: (rows) => client.setQueryData(financeKeys.permissions(), rows),
  })

  const rows = useMemo(() => {
    const text = needle.trim().toLowerCase()
    return [...(list.data ?? [])]
      .filter(
        (row) =>
          text === "" ||
          row.path_prefix.toLowerCase().includes(text) ||
          (row.note ?? "").toLowerCase().includes(text)
      )
      .sort(
        (a, b) =>
          a.path_prefix.localeCompare(b.path_prefix) ||
          a.method.localeCompare(b.method)
      )
  }, [list.data, needle])

  /// The form's fields, once: in a card beside the list on a desk, in a sheet
  /// on a phone.
  const fields = (
    <>
      <Problem error={add.error} />
      <Field label="Method">
        <Select value={method} onChange={setMethod}>
          {METHODS.map((one) => (
            <option key={one} value={one}>
              {one === "*" ? "Any method" : one}
            </option>
          ))}
        </Select>
      </Field>
      <Field
        label="Path prefix"
        required
        hint="Every path that starts with this, e.g. /api/v1/finance/journal"
      >
        <Input
          value={prefix}
          onChange={(event) => setPrefix(event.target.value)}
          className="font-mono"
        />
      </Field>
      <Field label="Least rung">
        <Select value={role} onChange={setRole}>
          {ROLES.map((one) => (
            <option key={one} value={one}>
              {label(one)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Note">
        <Input value={note} onChange={(event) => setNote(event.target.value)} />
      </Field>
    </>
  )
  const submit = (
    <Button
      variant="primary"
      pending={add.isPending}
      disabled={!prefix.trim().startsWith("/api/")}
      onClick={() => add.mutate()}
    >
      {add.isPending ? "Submitting…" : "Submit"}
    </Button>
  )

  return (
    <PageContent>
      <PageHeader
        crumb="Finance · Settings"
        title="Rung Permissions"
        sub="The least rung that may call a route, on top of the built-in rules. The longest matching path wins; removing an override restores the built-in rule."
        // Search and the new override are in the dock on a phone.
        actions={
          phone ? undefined : (
            <Input
              value={needle}
              onChange={(event) => setNeedle(event.target.value)}
              className="h-8 w-56"
            />
          )
        }
      />

      {phone && (
        <>
          <Fab label="Add override" onClick={() => setAdding(true)} />
          <DockTools
            search={{
              value: needle,
              onChange: setNeedle,
              label: "Search overrides",
            }}
          />
          <Sheet
            open={adding}
            onOpenChange={setAdding}
            title="Add or change an override"
            footer={<div className="flex justify-end">{submit}</div>}
          >
            <div className="flex flex-col gap-3">{fields}</div>
          </Sheet>
        </>
      )}

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <Card className="overflow-hidden max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
          {queryState(list, {
            loading: "Reading the overrides…",
            render: () =>
              rows.length === 0 ? (
                <EmptyState>
                  {needle.trim() === ""
                    ? "No override: every route answers to its built-in rule."
                    : "No override matches the search."}
                </EmptyState>
              ) : phone ? (
                <PhoneList>
                  {rows.map((row) => (
                    <PhoneCard
                      key={`${row.method}\t${row.path_prefix}`}
                      title={
                        <span className="font-mono text-[0.9375rem] break-all">
                          {row.path_prefix}
                        </span>
                      }
                      line={[row.method === "*" ? "ANY" : row.method, row.note]
                        .filter(Boolean)
                        .join(" · ")}
                      lead={
                        <Pill tone={roleTone(row.min_role)}>
                          {label(row.min_role)}
                        </Pill>
                      }
                      foot={
                        row.set_by || row.set_at
                          ? `${row.set_by ?? ""}${row.set_at ? ` · ${moment(row.set_at)}` : ""}`
                          : undefined
                      }
                      action={
                        <Button
                          size="card"
                          variant="tint"
                          pending={remove.isPending}
                          onClick={() => remove.mutate(row)}
                        >
                          Remove
                        </Button>
                      }
                    />
                  ))}
                </PhoneList>
              ) : (
                <Grid>
                  <thead>
                    <tr>
                      <Th>Method</Th>
                      <Th>Path prefix</Th>
                      <Th>Least rung</Th>
                      <Th>Note</Th>
                      <Th>Set</Th>
                      <Th />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={`${row.method}\t${row.path_prefix}`}>
                        <Td>
                          <Code>{row.method === "*" ? "ANY" : row.method}</Code>
                        </Td>
                        <Td>
                          <span className="font-mono text-ink">
                            {row.path_prefix}
                          </span>
                        </Td>
                        <Td>
                          <Pill tone={roleTone(row.min_role)}>
                            {label(row.min_role)}
                          </Pill>
                        </Td>
                        <Td>
                          <span className="text-mute">{row.note ?? ""}</span>
                        </Td>
                        <Td>
                          <span className="text-faint">
                            {row.set_by ?? ""}
                            {row.set_at ? ` · ${moment(row.set_at)}` : ""}
                          </span>
                        </Td>
                        <Td align="right">
                          <Button
                            size="sm"
                            variant="quiet"
                            pending={remove.isPending}
                            onClick={() => remove.mutate(row)}
                          >
                            Remove
                          </Button>
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Grid>
              ),
          })}
          <Problem error={remove.error} className="m-3" />
        </Card>

        {!phone && (
          <Card className="flex flex-col gap-3 p-4">
            <h3 className="text-card-title font-semibold text-ink">
              Add or change an override
            </h3>
            {fields}
            <div className="flex justify-end">{submit}</div>
          </Card>
        )}
      </div>
    </PageContent>
  )
}
