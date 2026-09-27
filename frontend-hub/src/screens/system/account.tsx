import { useForm } from "@tanstack/react-form"
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { AppLink } from "@/components/ui/app-link"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Field, Input, Select } from "@/components/ui/field"
import { FilterPanel } from "@/components/ui/filter-panel"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { Toolbar } from "@/components/ui/segmented"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState } from "@/components/ui/states"
import { Tag } from "@/components/ui/tag"
import { cacheKey } from "@/lib/api"
import { useFilterState, type Filter, type FilterField } from "@/lib/filters"
import { count, day, moment } from "@/lib/format"
import {
  changeOwnPassword,
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
import { useIdentity } from "@/lib/session"
import { useSheet } from "@/lib/sheets"
import { tableSetup, type TableSetup } from "@/lib/table"
import { useDebounced } from "@/lib/use-debounced"
import { Secret, Section } from "@/screens/system/shared"
import { saying } from "@/screens/system/units"
import type { Role } from "@itulah/contract"

/// Accounts at the centre: your own, and everybody's.
///
/// Every password on this screen travels one way. There is no field that shows
/// one, no response that carries one back, and no reveal toggle — a secret that
/// can be read out of the page is one screenshot away from being somebody
/// else's. What the server does return after a password write is a username and
/// whether the account is still suspended, and that is all this screen has.
///
/// Two acts the server refuses on your own account — demoting yourself and
/// suspending yourself — are disabled here with the reason on the control,
/// rather than left to fail with a 409. The node must always keep at least one
/// usable administrator.

const roles: readonly Role[] = ["CASHIER", "SUPERVISOR", "ADMIN"]

/// Which column means which order the endpoint names. A column not in here
/// cannot be sorted — sorting it would sort the loaded pages.
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

/// Every narrowing here is a parameter the endpoint answers; the counts beside
/// each option are the server's, over everything the search matches.
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
    column: "place_id",
    label: "Posted at",
    spec: { kind: "option", single: true, operators: ["isAnyOf"] },
  },
]

function scopeFromFilters(filters: readonly Filter[]): {
  role?: string
  state?: string
  place_id?: string
} {
  const scope: { role?: string; state?: string; place_id?: string } = {}
  for (const { column, operator, values } of filters) {
    if (values.length === 0 || operator !== "isAnyOf") continue
    if (column === "role") scope.role = values[0]
    else if (column === "state") scope.state = values[0]
    else if (column === "place_id") scope.place_id = values[0]
  }
  return scope
}

const columns: ColumnDef<TableSetup, UserRow>[] = [
  {
    accessorKey: "username",
    header: "Username",
    size: 160,
    cell: ({ row }) => (
      <span className="font-mono text-id text-body">
        {row.original.username}
      </span>
    ),
  },
  {
    accessorKey: "display_name",
    header: "Person",
    size: 220,
    enableSorting: false,
    cell: ({ row }) => (
      <span className="font-medium text-ink">{row.original.display_name}</span>
    ),
  },
  {
    id: "person",
    accessorFn: (row) => row.employee_name ?? row.employee_code ?? "",
    header: "Employment record",
    size: 210,
    enableSorting: false,
    // An account list that shows only usernames cannot answer the two questions
    // somebody opens it with: which of these are people, and which belong to
    // somebody who no longer works here. Both are one join away and the console
    // did not have it.
    cell: ({ row }) =>
      row.original.employee_id === null ? (
        // A machine account moving stock between nodes, or a login HR has not
        // finished the paperwork for. The two read the same from here, and
        // saying so is better than an empty cell that reads as a fault.
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
    accessorKey: "role",
    header: "Role",
    size: 130,
    cell: ({ row }) => (
      <Tag tone={row.original.role === "ADMIN" ? "accent" : "neutral"}>
        {row.original.role}
      </Tag>
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
    size: 140,
    // Three words, and the third is the one worth a filter: "Left, still open"
    // is a working credential for somebody who has gone. The server answers
    // it as `state=LEFT_OPEN` — see the State chip.
    enableSorting: false,
    // Ending somebody's employment closes their login as part of the same act,
    // so this pairing means one of two things: a binding made before that was
    // true, or a close that failed. Either way it is a working credential for
    // somebody who has left, and it is the row on this screen worth finding.
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
    // Never-signed-in sorts before the longest-dormant, which is what the
    // ascending default below is for.
    accessorFn: (row) =>
      row.last_login_at === null ? 0 : Date.parse(row.last_login_at),
    header: "Last sign-in",
    size: 150,
    // **No filter, deliberately.** The accessor is a timestamp with `0`
    // standing for "never", so a date clause would answer for those rows as if
    // they had signed in on 1 January 1970 — "before 2026" would quietly
    // include them and "is empty" would quietly miss them, and both read as an
    // answer. The column that should carry the question is a nullable date,
    // and changing this one is changing the sort this screen opens on.
    meta: { align: "right" },
    // The decision metric on an account list. A name that has never signed in
    // is a credential somebody was issued and never used, and one dormant for
    // a year is a credential nobody would notice being used.
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
    size: 130,
    meta: { align: "right" },
    cell: ({ row }) => day(row.original.created_at),
  },
]

export function Account() {
  const [query, setQuery] = useState("")
  // Composers, not records: a half-typed form must not be linkable, and a URL
  // that reopened one would restore an empty form over somebody's work.
  const [adding, setAdding] = useState(false)
  const [changingOwn, setChangingOwn] = useState(false)
  const user = useSheet("user")
  const [sorting, setSorting] = useState<SortingState>([
    { id: "last_login", desc: false },
  ])

  const identity = useIdentity()
  const filters = useFilterState(FIELDS)

  // Debounced: every keystroke is a round trip.
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
                    : head.facets.places,
              ...(field.column === "place_id"
                ? {
                    format: (value: string) =>
                      head.facets.places.find((one) => one.value === value)
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
        // The rows arrive in the order the request asked for.
        manualSorting: true,
        onSortingChange: setSorting,
      }),
      [rows, sorting]
    )
  )

  const me = identity.data ?? null

  return (
    <PageContent>
      <PageHeader
        crumb="System"
        title="Account"
        sub="Who can sign in at the centre, and what each of them may do."
        actions={
          <>
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search"
              className="h-8 w-48"
            />
            <Button variant="primary" onClick={() => setAdding(true)}>
              Add user
            </Button>
          </>
        }
      />

      <Card className="mb-[1.125rem]">
        <CardHeader>
          <CardTitle>You</CardTitle>
          <Button onClick={() => setChangingOwn(true)}>Change password</Button>
        </CardHeader>
        <div className="border-t border-hairline px-4 py-3.5">
          <Facts>
            <Fact term="Username">{me?.username ?? "—"}</Fact>
            <Fact term="Name">{me?.display_name ?? "—"}</Fact>
            <Fact term="Role">{me?.role ?? "—"}</Fact>
          </Facts>
        </div>
      </Card>

      {/* Under the "You" card rather than beside the page title: the clauses
          narrow the register below, and a control sitting above a card it does
          not touch is a control people press once and stop trusting. */}
      <Toolbar>
        <FilterPanel model={model} />
        <Toolbar.Spacer />
        {head && (
          <span className="text-[0.875rem] text-mute tabular-nums">
            {count(head.total)} accounts
          </span>
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
                className="max-h-[calc(100vh-24rem)]"
              />
            ),
        })}
      </Card>

      <UserSheet
        // Keyed on the record so every control in the sheet — the role select,
        // the password box, the receipt — starts clean when the selection
        // moves. Remounting is what resets a form; an effect chasing the prop
        // would fight whatever has already been typed.
        key={user.value ?? "none"}
        user={rows.find((row) => row.username === user.value) ?? null}
        open={user.value !== undefined}
        onClose={user.close}
        isSelf={(username) => username === me?.username}
      />

      <AddUserSheet open={adding} onClose={() => setAdding(false)} />
      <OwnPasswordSheet
        open={changingOwn}
        onClose={() => setChangingOwn(false)}
      />
    </PageContent>
  )
}

/// One account, and the three decisions an administrator makes about it.
function UserSheet({
  user,
  open,
  onClose,
  isSelf,
}: {
  user: UserRow | null
  open: boolean
  onClose: () => void
  isSelf: (username: string) => boolean
}) {
  const client = useQueryClient()
  // `null` means "not touched", so the select shows the record's own role until
  // somebody chooses another. A state initialised from the prop would be wrong
  // for the render where the list has not arrived yet.
  const [role, setRole] = useState<Role | null>(null)
  const [password, setPassword] = useState("")

  const chosen = role ?? user?.role ?? "CASHIER"

  const invalidate = () =>
    client.invalidateQueries({ queryKey: systemKeys.users() })

  const changeRole = useMutation({
    mutationFn: () => setUserRole(user!.id, { role: chosen }),
    onSuccess: () => {
      void invalidate()
    },
  })

  const changeActive = useMutation({
    mutationFn: (active: boolean) => setUserActive(user!.id, { active }),
    onSuccess: () => {
      void invalidate()
    },
  })

  const reset = useMutation({
    mutationFn: () => resetUserPassword(user!.id, { new_password: password }),
    onSuccess: () => {
      setPassword("")
      void invalidate()
    },
  })

  const self = user !== null && isSelf(user.username)
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
              {user.role}
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
            <Fact term="Role at nodes">
              <AppLink
                to="/system/access"
                className="text-accent hover:underline"
              >
                See assignments
              </AppLink>
            </Fact>
          </Facts>

          <Section title="Role at the centre">
            <div className="flex items-end gap-2.5">
              <Field label="Role" className="flex-1">
                <Select
                  value={chosen}
                  disabled={self}
                  onChange={(next) => setRole(next as Role)}
                >
                  {roles.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </Select>
              </Field>
              <Button
                className="mb-[0.1875rem]"
                pending={changeRole.isPending}
                disabled={self || chosen === user.role}
                onClick={() => changeRole.mutate()}
              >
                {changeRole.isPending ? "Saving…" : "Save role"}
              </Button>
            </div>
            {self && (
              <p className="mt-1.5 text-[0.875rem] text-mute">
                You cannot change your own role. The node has to keep at least
                one usable administrator.
              </p>
            )}
          </Section>

          <Section title="Access">
            {user.active ? (
              <Button
                variant="danger"
                pending={changeActive.isPending}
                disabled={self}
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
            {self && user.active && (
              <p className="mt-1.5 text-[0.875rem] text-mute">
                You cannot suspend your own account.
              </p>
            )}
          </Section>

          <Section title="Password">
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
          </Section>
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

/// The three the server has no default for. The role always holds a value.
function userReady(draft: UserDraft): boolean {
  return (
    draft.username.trim() !== "" &&
    draft.displayName.trim() !== "" &&
    draft.password !== ""
  )
}

/// A new account. There is no self-service sign-up on this node, so this is the
/// only way anybody gets one.
function AddUserSheet({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const client = useQueryClient()

  const add = useMutation({
    // Wrapped rather than passed by reference: v5 hands a mutation context as
    // the second argument, which is not the `AbortSignal` the fetcher expects.
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

  /// The password goes with the rest of the draft. Nothing reads it back, so a
  /// closed sheet still holding one is a secret in a form nobody is looking at.
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
      title="Add a user"
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
        // The button is in the sheet's footer, outside this element, so its
        // disabled state cannot block an Enter keypress.
        onSubmit={(event) => {
          event.preventDefault()
          if (userReady(form.state.values) && !add.isPending) {
            form.handleSubmit()
          }
        }}
        className="flex flex-col gap-3.5"
      >
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
              hint="At the centre. Access at a till is granted separately."
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

/// Changing your own password.
///
/// The server clears the session cookie in the same response, so succeeding is
/// what signs you out. The screen says that before it asks, and then waits for
/// an acknowledgement rather than snapping to the login box mid-sentence.
///
/// The confirmation field only ever answers "do these two differ": it is
/// compared, never displayed, and there is deliberately no reveal control on
/// any of the three.
interface PasswordDraft {
  current: string
  next: string
  again: string
}

function mismatched(draft: PasswordDraft): boolean {
  return draft.again !== "" && draft.again !== draft.next
}

function passwordReady(draft: PasswordDraft): boolean {
  return draft.current !== "" && draft.next !== "" && !mismatched(draft)
}

function OwnPasswordSheet({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const client = useQueryClient()

  const change = useMutation({
    // Wrapped rather than passed by reference: v5 hands a mutation context as
    // the second argument, which is not the `AbortSignal` the fetcher expects.
    mutationFn: (draft: { current: string; next: string }) =>
      changeOwnPassword({
        current_password: draft.current,
        new_password: draft.next,
      }),
    // All three fields, immediately. Nothing on this screen ever reads a
    // password back — not the receipt, not an error — so the draft is the only
    // copy and it does not outlive the request.
    onSuccess: () => form.reset(),
  })

  const form = useForm({
    defaultValues: { current: "", next: "", again: "" },
    onSubmit: ({ value }) =>
      change.mutate({ current: value.current, next: value.next }),
  })

  return (
    <Sheet
      open={open}
      onOpenChange={(open) => !open && onClose()}
      title="Change your password"
      footer={
        change.isSuccess ? (
          <div className="flex justify-end">
            <Button
              onClick={() => {
                // The cookie is already gone; dropping the cached identity is
                // what puts the login box back. Not a second logout request —
                // there is no session left to end.
                void client.invalidateQueries({ queryKey: cacheKey.me() })
              }}
            >
              Sign in again
            </Button>
          </div>
        ) : (
          <div className="flex justify-end gap-2">
            <Button variant="quiet" onClick={onClose}>
              Cancel
            </Button>
            <form.Subscribe selector={(state) => passwordReady(state.values)}>
              {(ready) => (
                <Button
                  pending={change.isPending}
                  disabled={!ready}
                  onClick={() => form.handleSubmit()}
                >
                  {change.isPending ? "Changing…" : "Change password"}
                </Button>
              )}
            </form.Subscribe>
          </div>
        )
      }
    >
      {change.isSuccess ? (
        <Banner tone="ok">
          Your password is changed, and every session standing on the old one
          has ended — including this browser's.
        </Banner>
      ) : (
        <form
          // The button is in the sheet's footer, outside this element, so its
          // disabled state cannot block an Enter keypress — and a mismatched
          // confirmation must not be able to reach the server.
          onSubmit={(event) => {
            event.preventDefault()
            if (passwordReady(form.state.values) && !change.isPending) {
              form.handleSubmit()
            }
          }}
          className="flex flex-col gap-3.5"
        >
          <p className="text-[0.875rem] text-body">
            You will be signed out when this succeeds. Every other session of
            yours ends too.
          </p>
          <form.Field name="current">
            {(field) => (
              <Field label="Current password" required>
                <Secret
                  autoComplete="current-password"
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
              </Field>
            )}
          </form.Field>
          <form.Field name="next">
            {(field) => (
              <Field label="New password" required>
                <Secret
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
              </Field>
            )}
          </form.Field>
          <form.Subscribe selector={(state) => mismatched(state.values)}>
            {(mismatch) => (
              <form.Field name="again">
                {(field) => (
                  <Field
                    label="New password again"
                    // Says that they differ and nothing more. Neither value is
                    // ever shown back, here or anywhere else on this screen.
                    problem={mismatch ? "The two do not match." : undefined}
                  >
                    <Secret
                      value={field.state.value}
                      onChange={(event) =>
                        field.handleChange(event.target.value)
                      }
                    />
                  </Field>
                )}
              </form.Field>
            )}
          </form.Subscribe>

          {change.isError && <Banner tone="bad">{saying(change.error)}</Banner>}
        </form>
      )}
    </Sheet>
  )
}
