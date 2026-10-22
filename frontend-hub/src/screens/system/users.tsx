import {
  useMutation,
  useQueryClient,
  useSuspenseInfiniteQuery,
} from "@tanstack/react-query"
import { useHydrated } from "@tanstack/react-router"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { ChevronDown } from "lucide-react"
import {
  Suspense,
  useDeferredValue,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react"

import { PageContent } from "@/components/shell/app-shell"
import { AppLink } from "@/components/ui/app-link"
import { Button } from "@/components/ui/button"
import { DockTools } from "@/components/shell/dock-tools"
import { Card } from "@/components/ui/card"
import { DataTable, dockSortOf } from "@/components/ui/data-table"
import { Fab } from "@/components/ui/fab"
import { Field, Select } from "@/components/ui/field"
import { FilterPanel } from "@/components/ui/filter-panel"
import { PageHeader } from "@/components/ui/page-header"
import { Pill, Status } from "@/components/ui/pill"
import { BarSpacer } from "@/components/ui/list-chrome"
import { Segmented } from "@/components/ui/segmented"
import { Fact, Facts, Sheet, type SheetTab } from "@/components/ui/sheet"
import { Banner, EmptyState, LoadingState } from "@/components/ui/states"
import { Tag } from "@/components/ui/tag"
import {
  useFilterState,
  type Filter,
  type FilterField,
  type FilterState,
} from "@/lib/filters"
import { count, day, moment } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import { roleAccess, useRoles } from "@/lib/queries/invitations"
import {
  resetUserPassword,
  setUserActive,
  unlockUser,
  setUserRole,
  type UserRow,
  type UserScope,
} from "@/lib/queries/system"
import { statusLabel } from "@/lib/queries/people"
import { useCanWrite } from "@/lib/session"
import { useSheet } from "@/lib/sheets"
import { tableSetup, type TableSetup } from "@/lib/table"
import { useDebounced } from "@/lib/use-debounced"
import { cn } from "@/lib/utils"
import { InviteSheet } from "@/screens/people/invite-sheet"
import { usersFeedQuery } from "@/screens/system/data"
import { CopyButton } from "@/screens/people/invite-sheet"
import { saying } from "@/screens/system/units"

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
  const canWrite = useCanWrite()
  const invite = useSheet("invite")
  const phone = useLayout() === "phone"
  return (
    <PageContent>
      {/* The screen's one action stands in its head; a phone has the + at the
          thumb instead. */}
      <PageHeader
        crumb="System"
        title="Users"
        sub="Who can sign in at the centre, and as which job role. Job roles themselves are kept in HR."
        actions={
          canWrite && !phone ? (
            <Button variant="primary" onClick={() => invite.open(true)}>
              Add account
            </Button>
          ) : undefined
        }
      />
      <UsersTab />
    </PageContent>
  )
}

// ── users ────────────────────────────────────────────────────────────────

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

/// A row as the table draws it: the account, and the group it stands under.
/// The register is grouped client side (`groupUsers`), so the rows arrive in
/// group order and each carries what its group's heading says.
interface UserCard extends UserRow {
  readonly group: string
  readonly groupLabel: string
  readonly groupCount: number
}

const stateOf = (row: UserRow) =>
  row.active && row.employee_status === "TERMINATED" ? (
    <Status tone="bad">Left, still open</Status>
  ) : row.active && row.login_blocked_until ? (
    <Status tone="warn">Locked</Status>
  ) : row.active ? (
    <Status tone="ok">Active</Status>
  ) : (
    <Status tone="bad">Blocked</Status>
  )

/// A table on a desk, a card per account on a phone: the person over the
/// login, the job role under them, when they last signed in and how they
/// stand. `foot` is the card's own column and is not drawn on a desk.
const columns: ColumnDef<TableSetup, UserCard>[] = [
  {
    // Who, then the login under it — one column, not three that each said a
    // version of the same name (owner, 2026-09-29: "masih ga rapi").
    accessorKey: "username",
    header: "Person",
    size: 260,
    meta: { card: "title", grow: 200 },
    cell: ({ row }) => (
      <span className="block min-w-0 leading-tight">
        <span className="block truncate font-medium text-ink">
          {row.original.employee_name ?? row.original.display_name}
        </span>
        <span className="block truncate text-[0.9375rem] font-normal text-mute">
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
    size: 220,
    enableSorting: false,
    meta: { card: "meta" },
    cell: ({ row }) => (
      <span className="block leading-tight">
        <span className="block truncate text-ink">
          {row.original.role_name}
        </span>
        {row.original.nodes.some((node) => !node.derived) && (
          <span className="block truncate text-[0.9375rem] text-warn-fg">
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
    size: 160,
    enableSorting: false,
    meta: { card: "status" },
    cell: ({ row }) => stateOf(row.original),
  },
  {
    id: "last_login",
    accessorFn: (row) =>
      row.last_login_at === null ? 0 : Date.parse(row.last_login_at),
    header: "Last Sign-in",
    size: 140,
    meta: { align: "right", card: "hide" },
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
    meta: { align: "right", card: "hide" },
    cell: ({ row }) => day(row.original.created_at),
  },
  {
    id: "foot",
    accessorFn: (row) => row.last_login_at,
    header: "",
    enableSorting: false,
    enableHiding: false,
    meta: { card: "foot" },
    cell: ({ row }) =>
      row.original.last_login_at === null
        ? "Never signed in"
        : `Signed in ${day(row.original.last_login_at)}`,
  },
]

function UsersTab() {
  const [query, setQuery] = useState("")
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

  return (
    <Suspense fallback={<LoadingState>Loading the accounts…</LoadingState>}>
      <UserRegister
        query={query}
        setQuery={setQuery}
        sorting={sorting}
        setSorting={setSorting}
        filters={filters}
        groupBy={groupBy}
        setGroupBy={setGroupBy}
        needle={needle}
        scope={scope}
      />
    </Suspense>
  )
}

/// The register and everything drawn from its answer: the filter chips with
/// the server's counts, the tally, the grouped table and the sheet of the
/// account that is open.
function UserRegister({
  query,
  setQuery,
  sorting,
  setSorting,
  filters,
  groupBy,
  setGroupBy,
  needle,
  scope,
}: {
  query: string
  setQuery: (query: string) => void
  sorting: SortingState
  setSorting: Dispatch<SetStateAction<SortingState>>
  filters: FilterState
  groupBy: GroupBy
  setGroupBy: (groupBy: GroupBy) => void
  /// The search once the typing has stopped: what the server is asked.
  needle: string
  scope: UserScope
}) {
  const canWrite = useCanWrite()
  const user = useSheet("user")
  const invite = useSheet("invite")
  const phone = useLayout() === "phone"
  // The dock is the browser's: a boundary that streams in after the page has
  // hydrated finds the dock already there and would draw into it, where the
  // server drew nothing.
  const hydrated = useHydrated()

  /// Read for the question as it was a moment ago while a new one is on its
  /// way, so a keystroke or a chip does not blank the table to a loading line.
  const asked = useDeferredValue(scope)
  const users = useSuspenseInfiniteQuery(usersFeedQuery(asked))

  const rows = useMemo(
    () => users.data.pages.flatMap((page) => page.rows),
    [users.data]
  )
  const head = users.data.pages[0]

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

  const groups = useMemo(() => groupUsers(rows, groupBy), [rows, groupBy])
  /// The rows in group order, each knowing its group: the table draws a
  /// heading above the first row of each.
  const cards = useMemo<UserCard[]>(
    () =>
      groups.flatMap((group) =>
        group.rows.map((row) => ({
          ...row,
          group: group.key,
          groupLabel: group.label,
          groupCount: group.rows.length,
        }))
      ),
    [groups]
  )
  const grouped = groupBy !== "none"
  /// Groups that have been folded shut, by key.
  const [folded, setFolded] = useState<ReadonlySet<string>>(() => new Set())

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: cards,
        columns,
        getRowId: (row: UserCard) => row.username,
        state: {
          sorting,
          // The card's own column is drawn on a phone and never on a desk.
          columnVisibility: { foot: phone },
        },
        manualSorting: true,
        onSortingChange: setSorting,
      }),
      [cards, sorting, phone]
    )
  )

  return (
    <>
      {/* One bar: the search and what narrows the register at the left, how
          it is split in the middle, its tally at the right. The one act is the
          head's. */}
      <div className="group/bar mb-3.5 flex min-h-[2.25rem] flex-wrap items-center gap-2 max-md:hidden">
        <FilterPanel
          model={model}
          search={{ value: query, onChange: setQuery, label: "Search accounts" }}
        />
        <Segmented
          options={GROUP_OPTIONS}
          value={groupBy}
          onChange={setGroupBy}
        />
        <BarSpacer />
        {head && (
          <span className="text-[0.9375rem] text-mute tabular-nums">
            {count(head.total)} accounts
          </span>
        )}
      </div>

      {hydrated && canWrite && (
        <Fab label="Add account" onClick={() => invite.open(true)} />
      )}
      {hydrated && (
        <DockTools
          search={{
            value: query,
            onChange: setQuery,
            label: "Search accounts",
          }}
          filter={{
            count: filters.filters.length,
            panel: { model: filters, filterModel: model, table },
          }}
          sort={dockSortOf(table)}
          status={{
            value: groupBy,
            options: GROUP_OPTIONS.map((one) => ({
              value: one.value,
              label:
                one.value === "none"
                  ? one.label
                  : `By ${one.label.toLowerCase()}`,
            })),
            onChange: (next) => setGroupBy(next as GroupBy),
          }}
        />
      )}

      <div aria-busy={asked !== scope || undefined} className="list-swap">
        {rows.length === 0 ? (
          <Card className="overflow-hidden">
            {needle !== "" || filters.filters.length > 0 ? (
              <EmptyState>Nobody matches what you asked for.</EmptyState>
            ) : (
              <EmptyState>
                There are no accounts on this node yet. Nobody can sign in until
                one is created.
              </EmptyState>
            )}
          </Card>
        ) : (
          <Card className="overflow-clip max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
            <DataTable<UserCard>
              refresh={[users]}
              table={table}
              more={users}
              onRowClick={(row) => user.open(row.username)}
              isSelected={(row) => row.username === user.value}
              roomy
              pageScroll
              cardsApart
              cardLead
              cardSort={false}
              stickyBefore
              isHidden={(row) => grouped && folded.has(row.group)}
              renderBefore={(row, index, all) =>
                grouped &&
                (index === 0 || all[index - 1].group !== row.group) ? (
                  <button
                    type="button"
                    aria-expanded={!folded.has(row.group)}
                    onClick={() =>
                      setFolded((was) => {
                        const next = new Set(was)
                        if (!next.delete(row.group)) next.add(row.group)
                        return next
                      })
                    }
                    className="flex w-full items-center gap-2 px-1 py-2 text-left transition-opacity active:opacity-60 md:bg-soft md:px-3.5 md:py-2.5"
                  >
                    <span className="min-w-0 text-[1rem] font-semibold break-words text-ink">
                      {row.groupLabel}
                    </span>
                    <span className="shrink-0 text-[0.9375rem] text-mute tabular-nums">
                      {count(row.groupCount)}
                    </span>
                    <span className="flex-1" />
                    <ChevronDown
                      className={cn(
                        "size-4 shrink-0 text-line-ico transition-[rotate] duration-200 ease-(--ease-out) motion-reduce:transition-none",
                        folded.has(row.group) && "-rotate-90"
                      )}
                    />
                  </button>
                ) : null
              }
            />
          </Card>
        )}
      </div>

      <UserSheet
        key={user.value ?? "none"}
        user={rows.find((row) => row.username === user.value) ?? null}
        open={user.value !== undefined}
        onClose={user.close}
        canWrite={canWrite}
      />

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
            .join(", ") || "This unit's server"

  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-[0.9375rem] text-ink">
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
              className="flex items-center gap-2 rounded-inner bg-soft-2 px-2.5 py-1.5 text-[0.9375rem]"
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
  const held = (roleList.data ?? []).find((one) => one.code === user?.role_code)
  const sees = roleAccess(held)

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

  /// A temporary password, made here and shown once (owner, 2026-10-18): the
  /// person signs in with it and is asked to choose their own straight away
  /// (0980), so the administrator knows it only until it is used.
  const reset = useMutation({
    mutationFn: async () => {
      const temporary = temporaryPassword()
      await resetUserPassword(user!.id, { new_password: temporary })
      return temporary
    },
    onSuccess: (temporary) => {
      setPassword(temporary)
      void invalidate()
    },
  })

  const failure =
    changeRole.error ?? changeActive.error ?? unlock.error ?? reset.error

  // The record's two questions — who this is and what they may do, and how they
  // sign in — and, appended by the sheet, its Activity. A reader who cannot
  // change anything has no Sign-in tab to look at.
  const failureBanner =
    failure === undefined || failure === null ? null : (
      <Banner tone="bad">{saying(failure)}</Banner>
    )
  const tabs: readonly SheetTab[] | undefined =
    user === null
      ? undefined
      : [
          {
            value: "details",
            label: "Details",
            content: (
              <div className="flex flex-col gap-5">
                <div className="flex items-center gap-2">
                  <Pill tone={user.active ? "ok" : "bad"}>
                    {user.active ? "Active" : "Blocked"}
                  </Pill>
                  <Tag tone={user.role === "ADMIN" ? "accent" : "neutral"}>
                    {user.role_name}
                  </Tag>
                </div>

                {failureBanner}

                <Facts>
                  <Fact term="Belongs to">
                    {user.employee_id === null ? (
                      <span className="text-mute">
                        Nobody. A machine account, or a login HR has not bound
                        yet.
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
                  <Fact term="Last sign-in">
                    {user.last_login_at ? moment(user.last_login_at) : "Never"}
                  </Fact>
                  {sees !== null && (
                    <Fact term="Sees" wide>
                      {sees.text}
                    </Fact>
                  )}
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
              </div>
            ),
          },
          ...(canWrite
            ? [
                {
                  value: "signin",
                  label: "Sign-in",
                  content: (
                    <div className="flex flex-col gap-5">
                      {failureBanner}

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
                            <span className="min-w-0 flex-1 text-[0.9375rem] text-warn-fg">
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
                              {changeActive.isPending
                                ? "Blocking…"
                                : "Block sign-in"}
                            </Button>
                            <p className="text-[0.9375rem] text-mute">
                              Signs them out now, here and at every store
                              server, and keeps them out until the account is
                              restored.
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
                        {password === "" ? (
                          <Button
                            variant="primary"
                            pending={reset.isPending}
                            onClick={() => reset.mutate()}
                          >
                            Set temporary password
                          </Button>
                        ) : (
                          <div className="flex flex-col gap-3 rounded-card border border-hairline p-4">
                            <p className="text-[0.9375rem] text-body">
                              Shown once. {user.username} signs in with it and
                              chooses a new password straight away.
                            </p>
                            <p className="font-mono text-[1.125rem] font-semibold tracking-wide text-ink">
                              {password}
                            </p>
                            <div className="flex flex-wrap gap-2">
                              <CopyButton text={password} />
                              <a
                                className="inline-flex h-9 items-center rounded-inner px-3 text-[0.9375rem] font-medium text-accent hover:bg-accent-bg"
                                href={`https://wa.me/?text=${encodeURIComponent(
                                  `Password sementara Central untuk ${user.username}: ${password}\nMasuk dengan password ini, lalu buat password baru.`
                                )}`}
                                target="_blank"
                                rel="noreferrer"
                              >
                                Send on WhatsApp
                              </a>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  ),
                },
              ]
            : []),
        ]

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
      // Details, Sign-in, and the trail the server keeps of what was done to
      // this login (`app_user`) as the last tab.
      subject={user === null ? undefined : { kind: "app_user", id: user.id }}
      tabs={tabs}
    >
      {user === null ? (
        <p className="text-meta text-body">That account is no longer listed.</p>
      ) : null}
    </Sheet>
  )
}

/// Ten characters a person can read aloud and type on a phone: no 0/O, 1/l/I.
function temporaryPassword(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"
  const bytes = crypto.getRandomValues(new Uint8Array(10))
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("")
}
