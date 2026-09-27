import { useForm } from "@tanstack/react-form"
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { AppLink } from "@/components/ui/app-link"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Checkbox, Field, Input, Select } from "@/components/ui/field"
import { FilterPanel } from "@/components/ui/filter-panel"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { Toolbar } from "@/components/ui/segmented"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState } from "@/components/ui/states"
import { SubTabs } from "@/components/ui/sub-tabs"
import { Tag } from "@/components/ui/tag"
import { useFilterState, type Filter, type FilterField } from "@/lib/filters"
import { count, day, moment } from "@/lib/format"
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
import {
  createUser,
  resetUserPassword,
  setUserActive,
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

type Tab = "users" | "roles"

const TABS: readonly { value: Tab; label: string }[] = [
  { value: "users", label: "Users" },
  { value: "roles", label: "Roles" },
]

export function Users() {
  const [tab, setTab] = useState<Tab>("users")
  return (
    <PageContent>
      <PageHeader
        crumb="System"
        title="Users & roles"
        sub="Who can sign in at the centre, what each of them may do, and the roles that answer that."
      />
      <SubTabs tabs={TABS} value={tab} onChange={(next) => setTab(next as Tab)} />
      {tab === "users" ? <UsersTab /> : <RolesTab />}
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
  DISABLED: "Suspended",
}

const FIELDS: FilterField[] = [
  {
    column: "role",
    label: "Role",
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
    accessorKey: "username",
    header: "Username",
    size: 150,
    cell: ({ row }) => (
      <span className="font-mono text-id text-body">
        {row.original.username}
      </span>
    ),
  },
  {
    accessorKey: "display_name",
    header: "Person",
    size: 200,
    enableSorting: false,
    cell: ({ row }) => (
      <span className="font-medium text-ink">{row.original.display_name}</span>
    ),
  },
  {
    id: "person",
    accessorFn: (row) => row.employee_name ?? row.employee_code ?? "",
    header: "Employment record",
    size: 190,
    enableSorting: false,
    cell: ({ row }) =>
      row.original.employee_id === null ? (
        <span className="text-mute">Nobody — machine or unbound</span>
      ) : (
        <span className="text-ink">
          {row.original.employee_name ?? row.original.employee_code}
          {row.original.unit_name && (
            <span className="text-mute"> · {row.original.unit_name}</span>
          )}
        </span>
      ),
  },
  {
    id: "job_role",
    // The job role — OWNER, FINANCE, STORE_MANAGER and the rest — in place of
    // the bare rung this column used to show. A row with a grant somebody
    // made by hand before access followed role and unit (`derived: false`)
    // carries a second, quieter tag — the exception this list is for
    // somebody to notice, without opening the sheet to find it.
    accessorFn: (row) => row.role_name,
    header: "Job role",
    size: 190,
    enableSorting: false,
    cell: ({ row }) => (
      <span className="flex flex-wrap items-center gap-1">
        <Tag tone={row.original.role === "ADMIN" ? "accent" : "neutral"}>
          {row.original.role_name}
        </Tag>
        {row.original.nodes.some((node) => !node.derived) && (
          <Tag tone="warn">Legacy access</Tag>
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
          : "Suspended",
    header: "State",
    size: 130,
    enableSorting: false,
    cell: ({ row }) =>
      row.original.active && row.original.employee_status === "TERMINATED" ? (
        <Pill tone="bad">Left, still open</Pill>
      ) : (
        <Pill tone={row.original.active ? "ok" : "bad"}>
          {row.original.active ? "Active" : "Suspended"}
        </Pill>
      ),
  },
  {
    id: "last_login",
    accessorFn: (row) =>
      row.last_login_at === null ? 0 : Date.parse(row.last_login_at),
    header: "Last sign-in",
    size: 140,
    meta: { align: "right" },
    cell: ({ row }) =>
      row.original.last_login_at === null ? (
        <span className="font-medium text-warn-fg">Never</span>
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
          placeholder="Search"
          className="h-8 w-48"
        />
        <FilterPanel model={model} />
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

      <Card className="overflow-hidden">
        {queryState(users, {
          loading: "Loading the accounts…",
          render: () =>
            rows.length === 0 ? (
              needle !== "" || filters.filters.length > 0 ? (
                <EmptyState>Nobody matches what you asked for.</EmptyState>
              ) : (
                <EmptyState>
                  There are no accounts on this node yet. Nobody can sign in
                  until one is created.
                </EmptyState>
              )
            ) : (
              <DataTable<UserRow>
                table={table}
                more={users}
                onRowClick={(row) => user.open(row.username)}
                isSelected={(row) => row.username === user.value}
                className="max-h-[calc(100vh-22rem)]"
              />
            ),
        })}
      </Card>

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
              .join(", ") || "This unit's server";

  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-[0.875rem] text-ink">
        {user.node_reach === "UNIT" ? `${summary} — ${user.role_name}` : summary}
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
                {row.active ? "Active" : "Suspended"}
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

  const reset = useMutation({
    mutationFn: () => resetUserPassword(user!.id, { new_password: password }),
    onSuccess: () => {
      setPassword("")
      void invalidate()
    },
  })

  const failure = changeRole.error ?? changeActive.error ?? reset.error

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
              {user.active ? "Active" : "Suspended"}
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
              <Field label="Role" className="flex-1">
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
                  {changeRole.isPending ? "Saving…" : "Save role"}
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
                {user.active ? (
                  <Button
                    variant="danger"
                    pending={changeActive.isPending}
                    onClick={() => changeActive.mutate(false)}
                  >
                    {changeActive.isPending ? "Suspending…" : "Suspend account"}
                  </Button>
                ) : (
                  <Button
                    pending={changeActive.isPending}
                    onClick={() => changeActive.mutate(true)}
                  >
                    {changeActive.isPending ? "Restoring…" : "Restore account"}
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
                {add.isPending ? "Creating…" : "Create"}
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
              label="Role"
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

// ── roles ────────────────────────────────────────────────────────────────

function RolesTab() {
  const roleList = useRoles()
  const canWrite = useCanWrite()
  const role = useSheet("role")

  return (
    <>
      <p className="mb-3.5 text-[0.875rem] text-body">
        Every job role a person can be invited as, and the sections of this
        app each one may see. OWNER and ADMIN see every section regardless of
        what is ticked here — that bypass is not editable.
      </p>
      <Card className="overflow-hidden">
        {queryState(roleList, {
          loading: "Loading roles…",
          render: () =>
            (roleList.data ?? []).length === 0 ? (
              <EmptyState>No role is seeded on this node yet.</EmptyState>
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
          (roleList.data ?? []).find((item) => item.code === role.value) ??
          null
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
      title={role ? `${role.name} — ${role.code}` : "Role"}
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
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      }
    >
      {role === null ? (
        <p className="text-meta text-body">That role is no longer listed.</p>
      ) : (
        <div className="flex flex-col gap-3.5">
          <Field label="Name" required>
            <Input value={name} onChange={(event) => setName(event.target.value)} />
          </Field>
          <Field label="Description" hint="One line, shown on the invite form.">
            <Input
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </Field>
          <Field label="Rung" hint="Where this role stands on the CASHIER / SUPERVISOR / ADMIN ladder.">
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
