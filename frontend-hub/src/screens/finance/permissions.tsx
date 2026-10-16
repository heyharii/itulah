import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { Suspense, useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { DockTools } from "@/components/shell/dock-tools"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable, dockSortOf } from "@/components/ui/data-table"
import { Field, Input, Select } from "@/components/ui/field"
import { Fab } from "@/components/ui/fab"
import {
  BarSpacer,
  ColumnsMenu,
  ExpandingSearch,
} from "@/components/ui/list-chrome"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { Sheet } from "@/components/ui/sheet"
import { EmptyState, Problem } from "@/components/ui/states"
import { count, label, moment } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import {
  financeKeys,
  removeRolePermission,
  rolePermissionsQuery,
  setRolePermission,
} from "@/lib/queries/finance"
import { queryState } from "@/lib/query-state"
import { tableSetup, type TableSetup } from "@/lib/table"
import { useColumnFit } from "@/screens/finance/column-fit"
import { Code } from "@/screens/finance-final/parts"
import { ScreenPending } from "@/screens/finance/pending"
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

/// What an override says: its method and path at the left, the least rung it
/// asks for, who set it and when, and the Remove button at the right. On a
/// phone the same columns are the card, the rung as its lead.
function columnsFor(
  remove: (row: RolePermission) => void,
  removing: boolean,
  phone: boolean
): ColumnDef<TableSetup, RolePermission>[] {
  return [
    {
      id: "method",
      accessorFn: (row) => (row.method === "*" ? "ANY" : row.method),
      header: "Method",
      size: 110,
      meta: { card: "meta" },
      cell: ({ row }) => (
        <Code>{row.original.method === "*" ? "ANY" : row.original.method}</Code>
      ),
    },
    {
      accessorKey: "path_prefix",
      header: "Path prefix",
      size: 380,
      meta: { card: "title", grow: 240 },
      cell: ({ row }) => (
        <span className="font-mono break-all text-ink">
          {row.original.path_prefix}
        </span>
      ),
    },
    {
      accessorKey: "min_role",
      header: "Least rung",
      size: 150,
      meta: { card: "lead" },
      cell: ({ row }) => (
        <Pill tone={roleTone(row.original.min_role)}>
          {label(row.original.min_role)}
        </Pill>
      ),
    },
    {
      id: "note",
      accessorFn: (row) => row.note ?? "",
      header: "Note",
      size: 260,
      meta: { card: "meta", priority: 3 },
      cell: ({ row }) => (
        <span className="text-mute">{row.original.note ?? ""}</span>
      ),
    },
    {
      id: "set",
      accessorFn: (row) =>
        row.set_by || row.set_at
          ? `${row.set_by ?? ""}${row.set_at ? ` · ${moment(row.set_at)}` : ""}`
          : "",
      header: "Set",
      size: 240,
      meta: { card: "foot", priority: 2 },
      cell: ({ row }) => (
        <span className="text-faint">
          {row.original.set_by ?? ""}
          {row.original.set_at ? ` · ${moment(row.original.set_at)}` : ""}
        </span>
      ),
    },
    {
      id: "remove",
      header: "",
      size: 110,
      enableSorting: false,
      enableHiding: false,
      meta: { align: "right", card: "status" },
      cell: ({ row }) => (
        <Button
          size={phone ? "card" : "sm"}
          variant={phone ? "tint" : "quiet"}
          pending={removing}
          onClick={(event) => {
            event.stopPropagation()
            remove(row.original)
          }}
        >
          Remove
        </Button>
      ),
    },
  ]
}

export function Permissions() {
  return (
    <Suspense
      fallback={
        <ScreenPending crumb="Finance · Settings" title="Rung Permissions">
          Reading the overrides…
        </ScreenPending>
      }
    >
      <PermissionsScreen />
    </Suspense>
  )
}

function PermissionsScreen() {
  const phone = useLayout() === "phone"
  /// The phone's form is a sheet the dock's + opens.
  const [adding, setAdding] = useState(false)
  const client = useQueryClient()
  const list = useSuspenseQuery(rolePermissionsQuery())
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
    return [...list.data]
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

  const [sorting, setSorting] = useState<SortingState>([])
  const columns = useMemo(
    () => columnsFor((row) => remove.mutate(row), remove.isPending, phone),
    // `remove.mutate` is stable; its pending state is what the button shows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [remove.isPending, phone]
  )
  const [measure, fit] = useColumnFit(columns, phone)
  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns,
        getRowId: (row: RolePermission) => `${row.method}\t${row.path_prefix}`,
        state: {
          sorting,
          columnVisibility: fit.visibility,
        },
        onSortingChange: setSorting,
        onColumnVisibilityChange: fit.onChange,
      }),
      // `fit` is new each render: the room is measured, and the columns the
      // card has no room for are given up.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [rows, columns, sorting, phone, fit]
    )
  )

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
      <PageHeader crumb="Finance · Settings" title="Rung Permissions" />

      <div className="group/bar mb-3 flex min-h-[2.25rem] flex-wrap items-center gap-2 max-md:hidden">
        <ExpandingSearch
          value={needle}
          onChange={setNeedle}
          label="Search overrides"
        />
        <BarSpacer />
        <ColumnsMenu table={table} />
      </div>

      {phone && (
        <>
          <Fab label="Add override" onClick={() => setAdding(true)} />
          <DockTools
            search={{
              value: needle,
              onChange: setNeedle,
              label: "Search overrides",
            }}
            sort={dockSortOf(table)}
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
        <div ref={measure} className="min-w-0">
          <Card className="overflow-clip max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
            {queryState(list, {
              render: () =>
                rows.length === 0 ? (
                  <EmptyState>
                    {needle.trim() === ""
                      ? "No override: every route answers to its built-in rule."
                      : "No override matches the search."}
                  </EmptyState>
                ) : (
                  <DataTable<RolePermission>
                    table={table}
                    refresh={[list]}
                    empty="No override matches the search."
                    pageScroll
                    cardsApart
                    cardLead
                    cardSort={false}
                    summary={{
                      path_prefix: (
                        <span>
                          {count(rows.length)}{" "}
                          <span className="font-normal text-body">
                            {rows.length === 1 ? "override" : "overrides"}
                          </span>
                        </span>
                      ),
                    }}
                  />
                ),
            })}
            <Problem error={remove.error} className="m-3" />
          </Card>
        </div>

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
