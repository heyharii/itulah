import {
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { Check } from "lucide-react"
import { Suspense, useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { DockTools } from "@/components/shell/dock-tools"
import { AppLink } from "@/components/ui/app-link"
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
import { MiniCell, MiniRow, MiniTable } from "@/components/ui/rows"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState, Problem } from "@/components/ui/states"
import { SubTabs } from "@/components/ui/sub-tabs"
import { count, label, moment } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import {
  financeKeys,
  removeRolePermission,
  rolePermissionsQuery,
  setRolePermission,
} from "@/lib/queries/finance"
import { rolesQuery } from "@/lib/queries/invitations"
import { usersPage } from "@/lib/queries/system"
import { queryState } from "@/lib/query-state"
import { tableSetup, type TableSetup } from "@/lib/table"
import { useColumnFit } from "@/screens/finance/column-fit"
import { Code } from "@/screens/finance-final/parts"
import { financeNav } from "@/screens/finance/nav"
import { ScreenPending } from "@/screens/finance/pending"
import type { JobRole, RolePermission } from "@itulah/contract"

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

/// 7Soft's menu grid for a group — View, Tambah, Edit, Hapus per menu — read
/// off the hub's overrides.
///
/// The hub does not grant a menu four ticks. A route answers to the least
/// rung that may call it, by HTTP method: GET is View, POST is Tambah, PUT and
/// PATCH are Edit, DELETE is Hapus. Each row is a path prefix an override
/// names, each cell the rung its method asks for ("Any method" counts for all
/// four); a cell with no override answers to the built-in rule. This is a
/// reading of the overrides, not a second place to set them.
interface MenuRow {
  readonly path: string
  readonly view: string | null
  readonly add: string | null
  readonly edit: string | null
  readonly remove: string | null
}

function menuRows(overrides: readonly RolePermission[]): MenuRow[] {
  const byPath = new Map<string, RolePermission[]>()
  for (const one of overrides)
    byPath.set(one.path_prefix, [...(byPath.get(one.path_prefix) ?? []), one])
  const rungOf = (rows: readonly RolePermission[], methods: string[]) =>
    rows.find((one) => methods.includes(one.method))?.min_role ??
    rows.find((one) => one.method === "*")?.min_role ??
    null
  return [...byPath.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, rows]) => ({
      path,
      view: rungOf(rows, ["GET"]),
      add: rungOf(rows, ["POST"]),
      edit: rungOf(rows, ["PUT", "PATCH"]),
      remove: rungOf(rows, ["DELETE"]),
    }))
}

function Rung({ role }: { role: string | null }) {
  return role === null ? (
    <span className="text-faint">Built-in</span>
  ) : (
    <Pill tone={roleTone(role)}>{label(role)}</Pill>
  )
}

const menuColumns: ColumnDef<TableSetup, MenuRow>[] = [
  {
    accessorKey: "path",
    header: "Menu",
    size: 360,
    meta: { card: "title", grow: 240 },
    cell: ({ row }) => (
      <span className="font-mono break-all text-ink">{row.original.path}</span>
    ),
  },
  {
    id: "view",
    accessorFn: (row) => row.view ?? "",
    header: "View",
    size: 130,
    meta: { align: "center", card: "metric" },
    cell: ({ row }) => <Rung role={row.original.view} />,
  },
  {
    id: "add",
    accessorFn: (row) => row.add ?? "",
    header: "Tambah",
    size: 130,
    meta: { align: "center", card: "metric" },
    cell: ({ row }) => <Rung role={row.original.add} />,
  },
  {
    id: "edit",
    accessorFn: (row) => row.edit ?? "",
    header: "Edit",
    size: 130,
    meta: { align: "center", card: "metric" },
    cell: ({ row }) => <Rung role={row.original.edit} />,
  },
  {
    id: "remove",
    accessorFn: (row) => row.remove ?? "",
    header: "Hapus",
    size: 130,
    meta: { align: "center", card: "metric" },
    cell: ({ row }) => <Rung role={row.original.remove} />,
  },
]

/// 7Soft's header of a group — Nama Group, Keterangan, Aktif — over its users
/// and its Menu grid. A group is a job role here: the hub keeps the roles, and
/// the people who hold them, under People › Roles. A role has no off switch,
/// so Aktif is always Yes.
const groupColumns: ColumnDef<TableSetup, JobRole>[] = [
  {
    accessorKey: "name",
    header: "Nama Group",
    size: 240,
    meta: { card: "title", grow: 160 },
    cell: ({ row }) => (
      <span className="font-medium text-ink">{row.original.name}</span>
    ),
  },
  {
    accessorKey: "description",
    header: "Keterangan",
    size: 420,
    meta: { card: "meta", grow: 240 },
    cell: ({ row }) => (
      <span className="font-normal whitespace-normal text-body">
        {row.original.description === "" ? "—" : row.original.description}
      </span>
    ),
  },
  {
    id: "active",
    accessorFn: () => "Yes",
    header: "Aktif",
    size: 100,
    meta: { align: "center", card: "hide" },
    cell: () => (
      <Check className="mx-auto size-4 text-ok-fg" aria-label="Aktif" />
    ),
  },
  {
    accessorKey: "holders",
    header: "User",
    size: 100,
    meta: { align: "right", card: "metric" },
    cell: ({ row }) => (
      <span className="tabular-nums">{count(row.original.holders)}</span>
    ),
  },
]

/// 7Soft's Menu grid for a group: every menu of the Finance module, its Modul,
/// and the four flags. A job role holds a section and no more: a section it
/// holds is View, and unless the role is read only it is Tambah, Edit and
/// Hapus too. The finer line — which rung may delete — is the Path rules tab.
interface GroupMenu {
  readonly path: string
  readonly display: string
  readonly modul: string
}

const GROUP_MENUS: readonly GroupMenu[] = financeNav.sections.flatMap(
  (section, index) =>
    section.items
      .filter((item) => item.hidden !== true)
      .map((item) => ({
        path: item.path,
        display: item.label,
        modul: section.label ?? (index === 0 ? "Kas - Bank" : "Finance"),
      }))
)

const Flag = ({ on }: { on: boolean }) =>
  on ? (
    <Check className="ml-auto size-4 text-ok-fg" aria-label="Ya" />
  ) : (
    <span className="ml-auto text-faint">—</span>
  )

function GroupSheet({
  role,
  onClose,
}: {
  role: JobRole | undefined
  onClose: () => void
}) {
  const users = useQuery({
    queryKey: ["finance", "group-users", role?.code ?? ""],
    queryFn: ({ signal }) => usersPage({ role: role?.code }, signal),
    enabled: role !== undefined,
  })
  const sees = role?.sections.includes("finance") === true
  const writes = sees && role?.read_only === false
  return (
    <Sheet
      open={role !== undefined}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title={role?.name ?? "Group"}
    >
      {role !== undefined && (
        <div className="flex flex-col gap-6">
          <Facts>
            <Fact term="Nama Group">{role.name}</Fact>
            <Fact term="Aktif">Yes</Fact>
            <Fact term="Keterangan" wide>
              {role.description === "" ? "—" : role.description}
            </Fact>
          </Facts>

          <div>
            <h4 className="mb-2 text-card-title font-semibold text-ink">
              Detail User
            </h4>
            {users.data === undefined ? (
              <p className="text-body">Reading the users…</p>
            ) : users.data.rows.length === 0 ? (
              <EmptyState>Nobody holds this group.</EmptyState>
            ) : (
              <MiniTable
                head={[
                  { label: "Nama User", align: "left" },
                  { label: "Nama Lengkap", align: "left" },
                  { label: "Jabatan", align: "left" },
                  { label: "Report", align: "left" },
                  { label: "Mulai Tanggal", align: "left" },
                  { label: "Sampai Tanggal", align: "left" },
                ]}
              >
                {users.data.rows.map((user) => (
                  <MiniRow key={user.id}>
                    <MiniCell className="font-mono">{user.username}</MiniCell>
                    <MiniCell>
                      {user.employee_name ?? user.display_name}
                    </MiniCell>
                    <MiniCell>{user.role_name}</MiniCell>
                    <MiniCell>
                      <span className="text-faint">—</span>
                    </MiniCell>
                    <MiniCell>
                      <span className="text-faint">—</span>
                    </MiniCell>
                    <MiniCell>
                      <span className="text-faint">—</span>
                    </MiniCell>
                  </MiniRow>
                ))}
              </MiniTable>
            )}
          </div>

          <div>
            <h4 className="mb-2 text-card-title font-semibold text-ink">
              Detail Menu
            </h4>
            <MiniTable
              head={[
                { label: "Display", align: "left" },
                { label: "Modul", align: "left" },
                { label: "Deskripsi Menu", align: "left" },
                { label: "View", align: "right" },
                { label: "Tambah", align: "right" },
                { label: "Edit", align: "right" },
                { label: "Hapus", align: "right" },
              ]}
            >
              {GROUP_MENUS.map((menu) => (
                <MiniRow key={menu.path}>
                  <MiniCell className="text-ink">{menu.display}</MiniCell>
                  <MiniCell>{menu.modul}</MiniCell>
                  <MiniCell>
                    <span className="text-faint">—</span>
                  </MiniCell>
                  <MiniCell align="right">
                    <Flag on={sees} />
                  </MiniCell>
                  <MiniCell align="right">
                    <Flag on={writes} />
                  </MiniCell>
                  <MiniCell align="right">
                    <Flag on={writes} />
                  </MiniCell>
                  <MiniCell align="right">
                    <Flag on={writes} />
                  </MiniCell>
                </MiniRow>
              ))}
            </MiniTable>
          </div>
        </div>
      )}
    </Sheet>
  )
}

function GroupTab() {
  const phone = useLayout() === "phone"
  const roles = useSuspenseQuery(rolesQuery())
  const [needle, setNeedle] = useState("")
  const [open, setOpen] = useState<string | null>(null)
  const [measure, fit] = useColumnFit(groupColumns, phone)
  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: roles.data,
        columns: groupColumns,
        getRowId: (row: JobRole) => row.code,
        state: { globalFilter: needle, columnVisibility: fit.visibility },
        onGlobalFilterChange: setNeedle,
        onColumnVisibilityChange: fit.onChange,
      }),
      // `fit` is new each render, as in the tabs below.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [roles.data, needle, fit]
    )
  )
  return (
    <>
      <div className="group/bar mb-3 flex min-h-[2.25rem] flex-wrap items-center gap-2 max-md:hidden">
        <ExpandingSearch
          value={needle}
          onChange={setNeedle}
          label="Search groups"
        />
        <BarSpacer />
      </div>
      <DockTools
        search={{ value: needle, onChange: setNeedle, label: "Search groups" }}
      />
      <div ref={measure} className="min-w-0">
        <Card className="overflow-clip max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
          <DataTable<JobRole>
            table={table}
            refresh={[roles]}
            onRowClick={(row) => setOpen(row.code)}
            isSelected={(row) => row.code === open}
            empty="No group matches the search."
            pageScroll
            cardsApart
            cardSort={false}
          />
        </Card>
      </div>
      <GroupSheet
        role={roles.data.find((one) => one.code === open)}
        onClose={() => setOpen(null)}
      />
    </>
  )
}

export function Permissions() {
  return (
    <Suspense
      fallback={
        <ScreenPending crumb="Finance · Master" title="User & Group">
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
  const [tab, setTab] = useState("group")
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

  const grid = useMemo(() => menuRows(list.data), [list.data])
  const [gridMeasure, gridFit] = useColumnFit(menuColumns, phone)
  const gridTable = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: grid,
        columns: menuColumns,
        getRowId: (row: MenuRow) => row.path,
        state: { columnVisibility: gridFit.visibility },
        onColumnVisibilityChange: gridFit.onChange,
      }),
      // `gridFit` is new each render, as `fit` is.
      [grid, gridFit]
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
      <PageHeader crumb="Finance · Master" title="User & Group" />

      <SubTabs
        tabs={[
          { value: "group", label: "Group" },
          { value: "menu", label: "Path rules" },
          { value: "overrides", label: "Overrides" },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === "group" && <GroupTab />}

      {tab === "menu" && (
        <>
          <Banner tone="info" className="mb-3">
            A group is a job role and a user is a person — both are kept in{" "}
            <AppLink
              to="/people/roles"
              className="underline underline-offset-2"
            >
              People › Roles
            </AppLink>
            . Here each menu shows the least rung that may view, add, edit or
            delete in it, wherever an override sets one; the rest answer to the
            built-in rule.
          </Banner>
          <div ref={gridMeasure} className="min-w-0">
            <Card className="overflow-clip max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
              {grid.length === 0 ? (
                <EmptyState>
                  No override: every menu answers to its built-in rule.
                </EmptyState>
              ) : (
                <DataTable<MenuRow>
                  table={gridTable}
                  // The override behind the row is on the other tab.
                  onRowClick={(row) => {
                    setNeedle(row.path)
                    setTab("overrides")
                  }}
                  empty="No menu."
                  pageScroll
                  cardsApart
                  cardSort={false}
                />
              )}
            </Card>
          </div>
        </>
      )}

      {tab === "overrides" && (
        <>
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
        </>
      )}
    </PageContent>
  )
}
