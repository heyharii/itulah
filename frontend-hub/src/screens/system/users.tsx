import { useForm } from "@tanstack/react-form"
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { flexRender, useTable } from "@tanstack/react-table"
import { ChevronDown, ChevronUp, ChevronsUpDown } from "lucide-react"
import { Fragment, useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { AppLink } from "@/components/ui/app-link"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Field, Input, Select } from "@/components/ui/field"
import { FilterPanel } from "@/components/ui/filter-panel"
import { PageHeader } from "@/components/ui/page-header"
import { Pill, Status } from "@/components/ui/pill"
import { Segmented, Toolbar } from "@/components/ui/segmented"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import {
  Banner,
  EmptyState,
  LoadMore,
  type Pageable,
} from "@/components/ui/states"
import { Tag } from "@/components/ui/tag"
import { useFilterState, type Filter, type FilterField } from "@/lib/filters"
import { count, day, moment } from "@/lib/format"
import { useRoles } from "@/lib/queries/invitations"
import {
  createUser,
  resetUserPassword,
  setUserActive,
  unlockUser,
  setUserRole,
  systemKeys,
  usersPage,
  type UserRow,
  type UserScope,
} from "@/lib/queries/system"
import { statusLabel } from "@/lib/queries/people"
import { queryState } from "@/lib/query-state"
import { useCanWrite } from "@/lib/session"
import { useSheet } from "@/lib/sheets"
import { tableSetup, type TableSetup } from "@/lib/table"
import { useDebounced } from "@/lib/use-debounced"
import { cn } from "@/lib/utils"
import { InviteSheet } from "@/screens/people/invite-sheet"
import { Secret } from "@/screens/system/shared"
import { saying } from "@/screens/system/units"
import type { Role } from "@itulah/contract"

/// Users & roles — who can sign in at the centre, what each of them may do,
/// and the roles that answer that question.
///
/// Merged 2026-09-27 from three screens: the account register (formerly
/// System › Account), the people half of System › Access, and this app's new
/// Roles list, which never had a screen of its own before now. The register
/// is the "Users" tab; the roles are the "Roles" tab.
///
/// Access at a STORE SERVER is no longer typed in here. It used to be — a
/// separate "Grant access" form, a password of its own, a role that was not
/// the person's role at the centre — and that form is gone: a server now
/// derives who may sign in and as what from the person's job role and their
/// unit, which the backend computes. Where the old per-server grant still
/// differs from that derivation, it shows on the person's own sheet as
/// read-only information, in `<NodeAccess>` below — a fact worth knowing, not
/// a field to fill in.

/// Job roles moved to HR › Job roles on 2026-09-29 (owner: a job role is an HR
/// thing, and System holds only the accounts).
export function Users() {
  return (
    <PageContent>
      <PageHeader
        crumb="System"
        title="Users"
        sub="Who can sign in at the centre, and as which job role. Job roles themselves are kept in HR."
      />
      <UsersTab />
    </PageContent>
  )
}

// ── users ────────────────────────────────────────────────────────────────

const roles: readonly Role[] = ["CASHIER", "SUPERVISOR", "ADMIN"]

const SORTS: Record<string, string> = {
  username: "username",
  role: "role",
  last_login: "last_login",
  created_at: "created",
}

const STATE_WORD: Readonly<Record<string, string>> = {
  ACTIVE: "Active",
  LEFT_OPEN: "Left, still open",
  DISABLED: "Blocked",
}

const FIELDS: FilterField[] = [
  {
    column: "role",
    label: "Job Role",
    spec: { kind: "option", single: true, operators: ["isAnyOf"] },
  },
  {
    column: "state",
    label: "State",
    spec: {
      kind: "option",
      single: true,
      operators: ["isAnyOf"],
      format: (value) => STATE_WORD[value] ?? value,
    },
  },
  {
    column: "unit_id",
    label: "Unit",
    spec: { kind: "option", single: true, operators: ["isAnyOf"] },
  },
]

/// How the register is split apart — by store unless somebody picks another
/// fact to compare across accounts (owner, 2026-09-29: accounts are handed
/// out per store, so that is how the list is read).
type GroupBy = "none" | "place" | "record" | "role"

const GROUP_OPTIONS: readonly { value: GroupBy; label: string }[] = [
  { value: "place", label: "Store" },
  { value: "role", label: "Job role" },
  { value: "record", label: "Record" },
  { value: "none", label: "No grouping" },
]

interface UserGroup {
  readonly key: string
  readonly label: string
  readonly rows: UserRow[]
  /// The catch-all bucket ("No store", "Nobody — machine or
  /// unbound") sorts after every named one rather than wherever its label
  /// would otherwise fall alphabetically.
  readonly fallback: boolean
}

/// Buckets the rows already loaded into this page into named groups. Client
/// side, over whatever pages are in memory — the register is read a page or
/// two at a time regardless, and a further page just joins its group once it
/// arrives.
function groupUsers(rows: readonly UserRow[], by: GroupBy): UserGroup[] {
  if (by === "none") {
    return [{ key: "all", label: "", rows: [...rows], fallback: false }]
  }

  const buckets = new Map<string, UserGroup>()
  for (const row of rows) {
    const [key, label, fallback] =
      by === "place"
        ? row.unit_id === null
          ? (["none", "No store", true] as const)
          : ([row.unit_id, row.unit_name ?? row.unit_id, false] as const)
        : by === "record"
          ? row.employee_id === null
            ? (["none", "Nobody — machine or unbound", true] as const)
            : (["has", "Has an employment record", false] as const)
          : ([row.role_code, row.role_name, false] as const)

    const bucket = buckets.get(key)
    if (bucket) bucket.rows.push(row)
    else buckets.set(key, { key, label, rows: [row], fallback })
  }

  return [...buckets.values()].sort((a, b) =>
    a.fallback !== b.fallback
      ? a.fallback
        ? 1
        : -1
      : a.label.localeCompare(b.label)
  )
}

function scopeFromFilters(filters: readonly Filter[]): {
  role?: string
  state?: string
  unit_id?: string
} {
  const scope: { role?: string; state?: string; unit_id?: string } = {}
  for (const { column, operator, values } of filters) {
    if (values.length === 0 || operator !== "isAnyOf") continue
    if (column === "role") scope.role = values[0]
    else if (column === "state") scope.state = values[0]
    else if (column === "unit_id") scope.unit_id = values[0]
  }
  return scope
}

const columns: ColumnDef<TableSetup, UserRow>[] = [
  {
    // Who, then the login under it — one column, not three that each said a
    // version of the same name (owner, 2026-09-29: "masih ga rapi").
    accessorKey: "username",
    header: "Person",
    size: 240,
    cell: ({ row }) => (
      <span className="block min-w-0 leading-tight">
        <span className="block truncate font-medium text-ink">
          {row.original.employee_name ?? row.original.display_name}
        </span>
        <span className="block truncate text-[0.875rem] text-mute">
          <span className="font-mono">{row.original.username}</span>
          {row.original.employee_id === null && " · no employee record"}
        </span>
      </span>
    ),
  },
  {
    id: "job_role",
    // A grant made by hand before access followed role and unit
    // (`derived: false`) is said quietly beside the role — the exception
    // somebody should notice, without a coloured tag on every row.
    accessorFn: (row) => row.role_name,
    header: "Job Role",
    size: 200,
    enableSorting: false,
    cell: ({ row }) => (
      <span className="block leading-tight">
        <span className="block truncate text-ink">
          {row.original.role_name}
        </span>
        {row.original.nodes.some((node) => !node.derived) && (
          <span className="block truncate text-[0.875rem] text-warn-fg">
            Legacy access
          </span>
        )}
      </span>
    ),
  },
  {
    id: "state",
    accessorFn: (row) =>
      row.active && row.employee_status === "TERMINATED"
        ? "Left, still open"
        : row.active
          ? "Active"
          : "Blocked",
    header: "State",
    size: 150,
    enableSorting: false,
    cell: ({ row }) =>
      row.original.active && row.original.employee_status === "TERMINATED" ? (
        <Status tone="bad">Left, still open</Status>
      ) : row.original.active && row.original.login_blocked_until ? (
        <Status tone="warn">Locked</Status>
      ) : row.original.active ? (
        <Status tone="ok">Active</Status>
      ) : (
        <Status tone="bad">Blocked</Status>
      ),
  },
  {
    id: "last_login",
    accessorFn: (row) =>
      row.last_login_at === null ? 0 : Date.parse(row.last_login_at),
    header: "Last Sign-in",
    size: 140,
    meta: { align: "right" },
    cell: ({ row }) =>
      row.original.last_login_at === null ? (
        <span className="text-mute">Never</span>
      ) : (
        day(row.original.last_login_at)
      ),
  },
  {
    accessorKey: "created_at",
    header: "Created",
    size: 120,
    meta: { align: "right" },
    cell: ({ row }) => day(row.original.created_at),
  },
]

function UsersTab() {
  const [query, setQuery] = useState("")
  const [adding, setAdding] = useState(false)
  const canWrite = useCanWrite()
  const user = useSheet("user")
  const invite = useSheet("invite")
  const [sorting, setSorting] = useState<SortingState>([
    { id: "last_login", desc: false },
  ])

  const filters = useFilterState(FIELDS)
  const [groupBy, setGroupBy] = useState<GroupBy>("place")

  const needle = useDebounced(query.trim(), 400)
  const scope = useMemo<UserScope>(() => {
    const by = sorting[0]
    return {
      ...scopeFromFilters(filters.filters),
      ...(needle === "" ? {} : { q: needle }),
      sort: by === undefined ? undefined : SORTS[by.id],
      desc: by?.desc === true,
    }
  }, [filters.filters, needle, sorting])

  const users = useInfiniteQuery({
    queryKey: systemKeys.userList(scope),
    queryFn: ({ pageParam, signal }) =>
      usersPage({ ...scope, cursor: pageParam }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    placeholderData: (previous) => previous,
  })

  const rows = useMemo(
    () => users.data?.pages.flatMap((page) => page.rows) ?? [],
    [users.data]
  )
  const head = users.data?.pages[0]

  const model = useMemo(
    () => ({
      ...filters,
      fields: head
        ? FIELDS.map((field) => ({
            ...field,
            spec: {
              ...field.spec,
              counted:
                field.column === "role"
                  ? head.facets.roles
                  : field.column === "state"
                    ? head.facets.states
                    : head.facets.units,
              ...(field.column === "unit_id"
                ? {
                    format: (value: string) =>
                      head.facets.units.find((one) => one.value === value)
                        ?.label ?? value,
                  }
                : {}),
            },
          }))
        : FIELDS,
    }),
    [filters, head]
  )

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns,
        getRowId: (row: UserRow) => row.username,
        state: { sorting },
        manualSorting: true,
        onSortingChange: setSorting,
      }),
      [rows, sorting]
    )
  )

  const groups = useMemo(() => groupUsers(rows, groupBy), [rows, groupBy])

  return (
    <>
      <Banner tone="info" className="mb-3.5">
        Adding somebody by hand still works below, but{" "}
        <AppLink to="/people/invitations" className="font-medium underline">
          Invite people
        </AppLink>{" "}
        is the door most people should come in through: they set their own
        password, and nothing here ever has to hold one of theirs.
      </Banner>

      <Toolbar>
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="h-8 w-48"
        />
        <FilterPanel model={model} />
        <Segmented
          options={GROUP_OPTIONS}
          value={groupBy}
          onChange={setGroupBy}
        />
        <Toolbar.Spacer />
        {head && (
          <span className="text-[0.875rem] text-mute tabular-nums">
            {count(head.total)} accounts
          </span>
        )}
        {canWrite && (
          <>
            <Button variant="primary" onClick={() => invite.open(true)}>
              Invite people
            </Button>
            <Button variant="quiet" onClick={() => setAdding(true)}>
              Add user directly
            </Button>
          </>
        )}
      </Toolbar>

      {queryState(users, {
        loading: "Loading the accounts…",
        render: () =>
          rows.length === 0 ? (
            <Card className="overflow-hidden">
              {needle !== "" || filters.filters.length > 0 ? (
                <EmptyState>Nobody matches what you asked for.</EmptyState>
              ) : (
                <EmptyState>
                  There are no accounts on this node yet. Nobody can sign in
                  until one is created.
                </EmptyState>
              )}
            </Card>
          ) : groupBy === "none" ? (
            <Card className="overflow-hidden">
              <DataTable<UserRow>
                table={table}
                more={users}
                onRowClick={(row) => user.open(row.username)}
                isSelected={(row) => row.username === user.value}
                className="max-h-[calc(100dvh-22rem)]"
              />
            </Card>
          ) : (
            <Card className="overflow-hidden">
              <GroupedDataTable
                table={table}
                groups={groups}
                onRowClick={(row) => user.open(row.username)}
                isSelected={(row) => row.username === user.value}
                more={users}
              />
            </Card>
          ),
      })}

      <UserSheet
        key={user.value ?? "none"}
        user={rows.find((row) => row.username === user.value) ?? null}
        open={user.value !== undefined}
        onClose={user.close}
        canWrite={canWrite}
      />

      <AddUserSheet open={adding} onClose={() => setAdding(false)} />
      <InviteSheet open={invite.isOpen} onClose={invite.close} />
    </>
  )
}

/// The register, grouped — ONE table, so column widths stay identical across
/// groups. `DataTable` has no grouped-row model (nothing in
/// `components/ui/data-table.tsx` mentions "group"), so this draws its own
/// `<table>` around the SAME `useTable` instance the flat list uses: the
/// header row is rendered once, and each group is a full-width divider row
/// followed by that group's rows, pulled from `table.getRowModel().rows` in
/// group order rather than from a second table. Row rendering is a plain
/// subset of what `DataTable`'s own `Row` does — this screen never
/// virtualises or shrinks to a phone card, so it does not need that
/// machinery, but the cell markup matches it (same padding, same hover and
/// selection tint) so a grouped table reads as the same table, not a
/// different component wearing its clothes.
function GroupedDataTable({
  table,
  groups,
  onRowClick,
  isSelected,
  more,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  table: any
  groups: readonly UserGroup[]
  onRowClick: (row: UserRow) => void
  isSelected: (row: UserRow) => boolean
  more?: Pageable
}) {
  const byUsername = useMemo(
    () =>
      new Map(
        (table as ReturnType<typeof useTable<TableSetup, UserRow>>)
          .getRowModel()
          .rows.map((row) => [row.original.username, row])
      ),
    [table]
  )
  const columnCount = (
    table as ReturnType<typeof useTable<TableSetup, UserRow>>
  ).getAllLeafColumns().length

  return (
    <div className="max-h-[calc(100dvh-22rem)] min-h-0 overflow-auto">
      <table className="w-full border-collapse text-cell">
        <thead>
          {(table as ReturnType<typeof useTable<TableSetup, UserRow>>)
            .getHeaderGroups()
            .map((group) => (
              <tr key={group.id}>
                {group.headers.map((header) => {
                  const sortable = header.column.getCanSort()
                  const sorted = header.column.getIsSorted()
                  const align = header.column.columnDef.meta?.align
                  return (
                    <th
                      key={header.id}
                      aria-sort={
                        !sortable
                          ? undefined
                          : sorted === "asc"
                            ? "ascending"
                            : sorted === "desc"
                              ? "descending"
                              : "none"
                      }
                      className={cn(
                        "sticky top-0 z-10 bg-soft",
                        "border-b border-hairline",
                        "h-10 px-3.5 py-0 text-eyebrow font-medium whitespace-nowrap text-body normal-case",
                        align === "right" ? "text-right" : "text-left"
                      )}
                    >
                      {header.isPlaceholder ? null : sortable ? (
                        <button
                          type="button"
                          onClick={() => header.column.toggleSorting()}
                          className={cn(
                            "inline-flex items-center gap-1 transition-colors hover:text-ink",
                            align === "right" && "flex-row-reverse"
                          )}
                        >
                          {flexRender(
                            header.column.columnDef.header,
                            header.getContext()
                          )}
                          {sorted === "asc" ? (
                            <ChevronUp className="size-3 text-ink" />
                          ) : sorted === "desc" ? (
                            <ChevronDown className="size-3 text-ink" />
                          ) : (
                            <ChevronsUpDown className="size-3 text-faint" />
                          )}
                        </button>
                      ) : (
                        flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )
                      )}
                    </th>
                  )
                })}
              </tr>
            ))}
        </thead>
        <tbody>
          {groups.map((group) => (
            <Fragment key={group.key}>
              <tr>
                <td
                  colSpan={columnCount}
                  className="border-b border-hairline bg-soft px-3.5 pt-4 pb-2 text-[0.875rem]"
                >
                  <span className="font-semibold text-ink">{group.label}</span>
                  <span className="ml-2 text-mute tabular-nums">
                    {count(group.rows.length)}
                  </span>
                </td>
              </tr>
              {group.rows.map((original) => {
                const row = byUsername.get(original.username)
                if (row === undefined) return null
                const selected = isSelected(original)
                return (
                  <tr
                    key={row.id}
                    onClick={() => onRowClick(original)}
                    tabIndex={0}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault()
                        onRowClick(original)
                      }
                    }}
                    data-selected={selected || undefined}
                    aria-current={selected || undefined}
                    className={cn(
                      "h-row cursor-pointer border-b border-hairline last:border-b-0",
                      "outline-none focus-visible:bg-accent-bg/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent",
                      selected ? "bg-accent-bg" : "hover:bg-soft"
                    )}
                  >
                    {row.getVisibleCells().map((cell) => {
                      const align = cell.column.columnDef.meta?.align
                      return (
                        <td
                          key={cell.id}
                          className={cn(
                            "px-3.5 py-2.5 whitespace-nowrap text-text",
                            align === "right" && "text-right",
                            align === "center" && "text-center"
                          )}
                        >
                          {flexRender(
                            cell.column.columnDef.cell,
                            cell.getContext()
                          )}
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </Fragment>
          ))}
        </tbody>
      </table>
      {more !== undefined && <LoadMore query={more} />}
    </div>
  )
}

/// A person's access at store servers, read-only: the backend now derives who
/// may sign in at a server, and as what, from the person's job role and their
/// unit. This reads whatever the register still records for them and shows
/// it as a fact — never a form. A row that agrees with what the role and unit
/// would derive is exactly as unremarkable as no row at all; what is worth a
/// glance is a row that does NOT.
///
/// `node_reach` (NONE/UNIT/EVERY) says the SHAPE of it in one line — "No
/// server", "Every server" or the one unit's own server, named — and the
/// person's job role says why. `user.nodes` is read only for the exceptions:
/// a grant somebody made by hand before this was derived (`derived: false`),
/// which survives the derivation and is flagged as legacy rather than folded
/// into the summary line silently.
function NodeAccess({ user }: { user: UserRow }) {
  const legacy = user.nodes.filter((row) => !row.derived)

  const summary =
    user.node_reach === "NONE"
      ? `No server — ${user.role_name}`
      : user.node_reach === "EVERY"
        ? `Every server — ${user.role_name}`
        : user.nodes
            .filter((row) => row.derived)
            .map((row) => row.label ?? row.site_name ?? row.origin_id)
            .join(", ") || "This unit's server"

  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-[0.875rem] text-ink">
        {user.node_reach === "UNIT"
          ? `${summary} — ${user.role_name}`
          : summary}
      </p>
      {legacy.length > 0 && (
        <div className="mt-1 flex flex-col gap-1.5">
          <p className="text-meta text-mute">
            Granted by hand, before access followed role and unit — kept as a
            legacy exception:
          </p>
          {legacy.map((row) => (
            <div
              key={row.origin_id}
              className="flex items-center gap-2 rounded-inner bg-soft-2 px-2.5 py-1.5 text-[0.875rem]"
            >
              <span className="min-w-0 flex-1 truncate font-mono text-id text-body">
                {row.label ?? row.site_name ?? row.origin_id}
              </span>
              <Tag tone={row.edge_role === "ADMIN" ? "accent" : "neutral"}>
                {row.edge_role}
              </Tag>
              <Pill tone={row.active ? "ok" : "bad"}>
                {row.active ? "Active" : "Blocked"}
              </Pill>
              <Tag>Legacy</Tag>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function UserSheet({
  user,
  open,
  onClose,
  canWrite,
}: {
  user: UserRow | null
  open: boolean
  onClose: () => void
  canWrite: boolean
}) {
  const client = useQueryClient()
  const roleList = useRoles()
  const [roleCode, setRoleCode] = useState<string | null>(null)
  const [password, setPassword] = useState("")

  const chosen = roleCode ?? user?.role_code ?? ""

  const invalidate = () =>
    client.invalidateQueries({ queryKey: systemKeys.users() })

  const changeRole = useMutation({
    mutationFn: () => setUserRole(user!.id, { role_code: chosen }),
    onSuccess: () => void invalidate(),
  })

  const changeActive = useMutation({
    mutationFn: (active: boolean) => setUserActive(user!.id, { active }),
    onSuccess: () => void invalidate(),
  })

  const unlock = useMutation({
    mutationFn: () => unlockUser(user!.id),
    onSuccess: () => void invalidate(),
  })

  const reset = useMutation({
    mutationFn: () => resetUserPassword(user!.id, { new_password: password }),
    onSuccess: () => {
      setPassword("")
      void invalidate()
    },
  })

  const failure =
    changeRole.error ?? changeActive.error ?? unlock.error ?? reset.error

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setPassword("")
          onClose()
        }
      }}
      id={user?.username}
      title={user?.display_name ?? "Account"}
    >
      {user === null ? (
        <p className="text-meta text-body">That account is no longer listed.</p>
      ) : (
        <div className="flex flex-col gap-5">
          <div className="flex items-center gap-2">
            <Pill tone={user.active ? "ok" : "bad"}>
              {user.active ? "Active" : "Blocked"}
            </Pill>
            <Tag tone={user.role === "ADMIN" ? "accent" : "neutral"}>
              {user.role_name}
            </Tag>
          </div>

          {failure && <Banner tone="bad">{saying(failure)}</Banner>}

          <Facts>
            <Fact term="Belongs to">
              {user.employee_id === null ? (
                <span className="text-mute">
                  Nobody. A machine account, or a login HR has not bound yet.
                </span>
              ) : (
                <AppLink
                  to="/people"
                  sheet={{ key: "employee", value: user.employee_id }}
                  className="text-accent hover:underline"
                >
                  {user.employee_name ?? user.employee_code}
                </AppLink>
              )}
            </Fact>
            {user.employee_status !== null && (
              <Fact term="Employment">
                {user.employee_status === "TERMINATED" && user.active
                  ? "Left — and this login still signs in"
                  : statusLabel(user.employee_status)}
              </Fact>
            )}
            <Fact term="Created">{day(user.created_at)}</Fact>
            <Fact term="Created by">{user.created_by}</Fact>
            <Fact term="Last sign-in">
              {user.last_login_at ? moment(user.last_login_at) : "Never"}
            </Fact>
          </Facts>

          <div>
            <h4 className="mb-2 text-card-title font-semibold text-ink">
              Access at store servers
            </h4>
            <NodeAccess user={user} />
          </div>

          <div>
            <h4 className="mb-2 text-card-title font-semibold text-ink">
              Job role
            </h4>
            <div className="flex items-end gap-2.5">
              <Field label="Job Role" className="flex-1">
                <Select
                  value={chosen}
                  disabled={!canWrite}
                  onChange={(next) => setRoleCode(next)}
                >
                  {(roleList.data ?? []).map((option) => (
                    <option key={option.code} value={option.code}>
                      {option.name}
                    </option>
                  ))}
                </Select>
              </Field>
              {canWrite && (
                <Button
                  className="mb-[0.1875rem]"
                  pending={changeRole.isPending}
                  disabled={chosen === user.role_code || chosen === ""}
                  onClick={() => changeRole.mutate()}
                >
                  {changeRole.isPending ? "Submitting…" : "Submit"}
                </Button>
              )}
            </div>
          </div>

          {canWrite && (
            <>
              <div>
                <h4 className="mb-2 text-card-title font-semibold text-ink">
                  Access
                </h4>
                {/* Locked by wrong passwords: it lifts by itself at the time
                    shown, or now. Suspending is the blacklist — it signs the
                    person out everywhere, at the centre and at every store
                    server, until somebody restores it. */}
                {user.active && user.login_blocked_until && (
                  <div className="mb-3 flex flex-wrap items-center gap-3 rounded-inner bg-warn-bg px-3.5 py-2.5">
                    <span className="min-w-0 flex-1 text-[0.875rem] text-warn-fg">
                      Locked after too many wrong passwords, until{" "}
                      {moment(user.login_blocked_until)}.
                    </span>
                    <Button
                      size="sm"
                      pending={unlock.isPending}
                      onClick={() => unlock.mutate()}
                    >
                      {unlock.isPending ? "Unlocking…" : "Unlock now"}
                    </Button>
                  </div>
                )}
                {user.active ? (
                  <div className="flex flex-col items-start gap-1.5">
                    <Button
                      variant="danger"
                      pending={changeActive.isPending}
                      onClick={() => changeActive.mutate(false)}
                    >
                      {changeActive.isPending ? "Blocking…" : "Block sign-in"}
                    </Button>
                    <p className="text-[0.875rem] text-mute">
                      Signs them out now, here and at every store server, and
                      keeps them out until the account is restored.
                    </p>
                  </div>
                ) : (
                  <Button
                    pending={changeActive.isPending}
                    onClick={() => changeActive.mutate(true)}
                  >
                    {changeActive.isPending
                      ? "Restoring…"
                      : "Allow sign-in again"}
                  </Button>
                )}
              </div>

              <div>
                <h4 className="mb-2 text-card-title font-semibold text-ink">
                  Password
                </h4>
                <div className="flex items-end gap-2.5">
                  <Field label="New password" required className="flex-1">
                    <Secret
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                    />
                  </Field>
                  <Button
                    className="mb-[0.1875rem]"
                    pending={reset.isPending}
                    disabled={password === ""}
                    onClick={() => reset.mutate()}
                  >
                    {reset.isPending ? "Setting…" : "Set password"}
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </Sheet>
  )
}

interface UserDraft {
  username: string
  displayName: string
  password: string
  role: Role
}

function userReady(draft: UserDraft): boolean {
  return (
    draft.username.trim() !== "" &&
    draft.displayName.trim() !== "" &&
    draft.password !== ""
  )
}

/// Adding a login by hand — kept for the account nobody invites (a machine
/// account moving stock between nodes), and quieted on purpose: see the note
/// on the Users tab pointing at "Invite people" instead.
function AddUserSheet({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const client = useQueryClient()

  const add = useMutation({
    mutationFn: (draft: UserDraft) =>
      createUser({
        username: draft.username.trim(),
        display_name: draft.displayName.trim(),
        password: draft.password,
        role: draft.role,
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: systemKeys.users() })
      clear()
      onClose()
    },
  })

  const form = useForm({
    defaultValues: {
      username: "",
      displayName: "",
      password: "",
      role: "CASHIER",
    } as UserDraft,
    onSubmit: ({ value }) => add.mutate(value),
  })

  function clear() {
    form.reset()
    add.reset()
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          clear()
          onClose()
        }
      }}
      title="Add a user directly"
      footer={
        <div className="flex justify-end gap-2">
          <Button
            variant="quiet"
            onClick={() => {
              clear()
              onClose()
            }}
          >
            Cancel
          </Button>
          <form.Subscribe selector={(state) => userReady(state.values)}>
            {(ready) => (
              <Button
                pending={add.isPending}
                disabled={!ready}
                onClick={() => form.handleSubmit()}
              >
                {add.isPending ? "Submitting…" : "Submit"}
              </Button>
            )}
          </form.Subscribe>
        </div>
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault()
          if (userReady(form.state.values) && !add.isPending) {
            form.handleSubmit()
          }
        }}
        className="flex flex-col gap-3.5"
      >
        <Banner tone="info">
          Prefer Invite people — this creates a login with a password you type
          yourself, which is exactly what invitations exist to avoid.
        </Banner>
        <form.Field name="username">
          {(field) => (
            <Field
              label="Username"
              required
              hint="How they sign in. Never released once taken, and there is no delete."
            >
              <Input
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
                autoComplete="off"
              />
            </Field>
          )}
        </form.Field>
        <form.Field name="displayName">
          {(field) => (
            <Field
              label="Name"
              required
              hint="What colleagues see beside their decisions."
            >
              <Input
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
                autoComplete="off"
              />
            </Field>
          )}
        </form.Field>
        <form.Field name="password">
          {(field) => (
            <Field
              label="Password"
              required
              hint="Sent once. Nothing on this node reads it back, so hand it over now."
            >
              <Secret
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
              />
            </Field>
          )}
        </form.Field>
        <form.Field name="role">
          {(field) => (
            <Field
              label="Rung"
              hint="At the centre. Access at a store server is now derived from job role and unit."
            >
              <Select
                value={field.state.value}
                onChange={(next) => field.handleChange(next as Role)}
              >
                {roles.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </form.Field>

        {add.isError && <Banner tone="bad">{saying(add.error)}</Banner>}
      </form>
    </Sheet>
  )
}
