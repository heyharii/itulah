import { useQuery } from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import { BadgeCheck, FileSignature, MapPin, Users } from "lucide-react"
import type {
  EmployeeList,
  EmployeeSummary,
  EmployeeView,
} from "@itulah/contract"

import { ApiError, api } from "@/lib/api"
import { count, day, today } from "@/lib/format"
import { useCursorList } from "@/lib/list"
import { useQueryState } from "@/lib/query-state"
import { useDebounced } from "@/lib/use-debounced"
import { boundedTo, useReach, whoseList } from "@/lib/reach"
import type { TableSetup } from "@/lib/table"
import { Loaded, PageHead, Toolbar } from "@/kit/page"
import { SearchField } from "@/kit/field"
import { Sheet } from "@/kit/sheet"
import { Table } from "@/kit/table"
import { Tabs } from "@/kit/tabs"
import { Tag } from "@/kit/tag"
import { Empty, Failed, Loading, NoAccess, NoMatch } from "@/kit/state"
import { Fact, Facts, Line, Quiet, SubHead, Term } from "@/modules/people/parts"
import { daysBetween, statusLabel, statusTone } from "@/modules/people/labels"

/// The workforce: who works here, under what contract, and where they are
/// posted.
///
/// ## It says whose list it is, at the top, every time
///
/// `GET /employees` is bounded on the SERVER by the caller's own posting — a
/// supervisor at one shop is served that shop and nothing else, and asking for
/// another place's is refused rather than quietly re-filtered. So the screen's
/// whole job about scope is to *say so*. A directory that showed eight people
/// where the company has ninety would read as a company of eight, and nothing
/// on the page would be wrong. See `lib/reach.ts`.
///
/// The same fact removes a column: when every row is posted to the same place,
/// a column repeating that place ninety times is a column that says nothing.
///
/// ## No personal data, deliberately
///
/// NIK, address and date of birth live behind their own route and their own
/// privilege. `EmployeeSummary` carries a name and nothing else from the
/// profile, and this screen asks for nothing more — a list read this often has
/// no business carrying sixteen digits of national identity number because
/// somebody widened a struct. There are no money fields on this type either:
/// pay is an agreement with its own screen and its own audience.
///
/// ## Every narrowing is the server's
///
/// This screen was first written against a `GET /employees` that took `status`,
/// `place_id` and `limit`, answered with a bare array capped at a thousand, and
/// reported no total. It had no search box and no sort, deliberately: a box
/// that narrowed the rows already in the browser would have been narrowing
/// whatever happened to fit inside the cap and reporting it as the answer —
/// see `lib/table.ts`.
///
/// The route now carries a scope struct, a keyset cursor and an envelope. `q`
/// searches the employee number and the name **on the server** — and only those
/// two, never the personal data the summary omits. `sort` takes four keys the
/// server names, `total` counts the whole matched set, and the status facets
/// count each tab before it is pressed. So the search box and the sortable
/// headers are real, and the count beside them is about the company rather than
/// about the download.
///
/// The keyset is why "whose term runs out first" can be asked here at all: the
/// server orders by `COALESCE(ends_on, '9999-12-31')`, so the eighteen
/// permanent contracts sort last instead of ending the page at the first of
/// them. `NULLS LAST` would have stopped paging there, silently.
const PAGE = 50

export function DirectoryScreen() {
  const url = useQueryState()
  // The one narrowing this endpoint can honour. A TAB rather than a filter,
  // because it is one value or none and the server takes exactly one.
  const status = url.one("status")
  const openId = url.one("person")

  const typed = url.one("q")
  const q = useDebounced(typed, 200)
  const sortKey = url.one("sort") || "code"
  const sortDesc = url.one("dir") === "desc"

  const reach = useReach()
  const bounded = boundedTo(reach.data)

  // Four keys the server names — `code`, `name`, `contract_end`, `place`.
  // Anything else it falls back to `code` rather than refusing, so a bookmark
  // made before a column moved still opens.
  const onSort = (key: string) => {
    const same = sortKey === key
    url.set({ sort: key, dir: same ? (sortDesc ? null : "desc") : "desc" })
  }

  const people = useCursorList<EmployeeSummary>({
    key: ["people", "employees"],
    path: "/api/v1/employees",
    // No `place_id`. A bounded caller is already bounded on the server, and an
    // unbounded one has nothing to pick from — there is no places endpoint on
    // this surface, so a place filter would be a box to type an identifier
    // into. It is left out rather than half-built. The server sends
    // `facets.places` regardless, which is what such a filter would be built
    // from when it is built.
    params: {
      q,
      status: status || null,
      sort: sortKey === "code" ? null : sortKey,
      dir: sortDesc ? "desc" : null,
    },
    limit: PAGE,
  })

  const head = people.head as EmployeeList | undefined

  const columns: ColumnDef<TableSetup, EmployeeSummary>[] = [
    {
      id: "code",
      header: "Number",
      size: 13,
      // No `priority`: it is the key everybody in the business actually uses,
      // and it is on the badge, the roster and the payslip. It is also the
      // server's default order, which is why the strip opens sorted by it.
      meta: { min: 110, sortKey: "code" },
      cell: ({ row }) => (
        <span className="text-ink font-mono">{row.original.employee_code}</span>
      ),
    },
    {
      id: "name",
      header: "Name",
      size: 22,
      meta: {
        icon: <Users className="size-[15px]" />,
        min: 180,
        sortKey: "name",
      },
      // Never drops out, and never falls back to blank. A record can exist
      // before anybody has enrolled a profile against it, and "Not enrolled
      // yet" is a fact about the record; an empty cell reads as a fault.
      cell: ({ row }) =>
        row.original.full_name ? (
          <span
            className="text-ink truncate font-medium"
            title={row.original.full_name}
          >
            {row.original.full_name}
          </span>
        ) : (
          <Quiet>Not enrolled yet</Quiet>
        ),
    },
    {
      id: "status",
      header: "Status",
      size: 14,
      meta: { priority: 3, min: 140 },
      cell: ({ row }) => (
        <Tag tone={statusTone(row.original.status)}>
          {statusLabel(row.original.status)}
        </Tag>
      ),
    },
    {
      id: "place",
      header: "Posted to",
      size: 14,
      meta: {
        icon: <MapPin className="size-[15px]" />,
        priority: 4,
        min: 130,
        sortKey: "place",
      },
      // The place's NAME. `store-01` is what this system files a shop under;
      // `Store 01` is what it is called.
      cell: ({ row }) =>
        row.original.place_id === null ? (
          <Quiet>Unposted</Quiet>
        ) : (
          <span className="truncate">
            {row.original.place_name ?? row.original.place_id}
          </span>
        ),
    },
    {
      id: "position",
      header: "Job",
      size: 14,
      meta: { priority: 2, min: 130 },
      cell: ({ row }) =>
        row.original.position === null ? (
          <Quiet />
        ) : (
          <span className="truncate">{row.original.position}</span>
        ),
    },
    {
      id: "contract",
      header: "Contract",
      size: 10,
      meta: {
        icon: <FileSignature className="size-[15px]" />,
        priority: 1,
        min: 110,
      },
      // PKWT is a fixed term and PKWTT is permanent — UU 13/2003 art. 59. The
      // amber is on the one that ends, because the one that ends is the one
      // somebody has to do something about.
      cell: ({ row }) =>
        row.original.contract_kind === null ? (
          <Quiet>None</Quiet>
        ) : (
          <Tag
            tone={row.original.contract_kind === "PKWT" ? "warn" : "neutral"}
          >
            {row.original.contract_kind}
          </Tag>
        ),
    },
    {
      id: "term",
      header: "Term ends in",
      size: 13,
      // No `priority`. A fixed term that ran out while nobody was looking is
      // the one thing on this list that is somebody's problem today — and now
      // it is sortable, so "who first" is one click rather than a second screen.
      meta: { align: "right", min: 140, sortKey: "contract_end" },
      cell: ({ row }) => (
        <Term days={daysBetween(today(), row.original.contract_ends_on)} />
      ),
    },
  ]

  // Dropped for a bounded caller, not hidden by width — a different question,
  // answered in a different place. `meta.priority` is the width one.
  const shown = columns.filter(
    (column) => column.id !== "place" || bounded === null,
  )

  // The counts are the server's, over everything the SEARCH matches and
  // deliberately ignoring which tab is open — so a tab reads as "how many of
  // these there are" rather than "how many are left after what you already
  // pressed", which would put a zero on every tab but the open one.
  //
  // A status missing from the facets is drawn as **zero**, not as blank. The
  // server groups over the matched rows, so absent means none matched — and a
  // tab that says nobody is suspended is the tab worth not pressing. The blank
  // is reserved for the one case where it is true: before the first answer has
  // arrived, when every count really is unknown.
  const counted = new Map(
    head?.facets.statuses.map((facet) => [facet.value, facet.count]) ?? [],
  )
  const tabs = [
    { value: "", label: "Everyone", count: head?.total },
    ...["ACTIVE", "CANDIDATE", "SUSPENDED", "TERMINATED"].map((value) => ({
      value,
      label: statusLabel(value),
      count: head === undefined ? undefined : (counted.get(value) ?? 0),
    })),
  ]

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHead
        module="People"
        title="Directory"
        description={whoseList(reach.data, {
          everywhere: "Everyone employed here, across every place you reach.",
          at: (place) => `Everyone posted to ${place}.`,
        })}
      />

      <Tabs
        label="Employment status"
        value={status}
        onChange={(value) => url.set({ status: value || null }, false)}
        tabs={tabs}
      />

      <Toolbar
        trailing={
          people.query.isError ? (
            // An em dash rather than "0 of 0" when the read failed. Nothing
            // loaded and nothing answered look alike in a corner of the toolbar
            // and are not the same finding — `count(null)` is the dash, see
            // `lib/format.ts`.
            <>{count(null)} loaded</>
          ) : (
            <Loaded
              loaded={people.rows.length}
              total={people.total}
              pending={people.query.isPending}
              noun="employees"
            />
          )
        }
      >
        <SearchField
          value={typed}
          onChange={(value) => url.set({ q: value || null })}
          // Says what it searches, because the answer is narrower than the row:
          // the summary carries a name and a number and nothing else, and the
          // server searches exactly those two.
          placeholder="Search a name or an employee number"
          className="w-[22rem]"
        />
      </Toolbar>

      <Body
        rows={people.rows}
        total={people.total}
        pending={people.query.isPending}
        error={people.query.isError ? people.query.error : null}
        onRetry={() => void people.query.refetch()}
        columns={shown}
        status={status}
        q={q}
        onClear={() => url.set({ q: null, status: null }, false)}
        sort={{ key: sortKey, desc: sortDesc }}
        onSort={onSort}
        hasMore={people.hasMore}
        loadingMore={people.loadingMore}
        onNeedMore={people.loadMore}
        openId={openId}
        onOpen={(id) => url.set({ person: id }, false)}
      />

      <PersonSheet
        openId={openId}
        row={people.rows.find((row) => row.employee_id === openId)}
        onClose={() => url.set({ person: null }, false)}
      />
    </div>
  )
}

/// The list, or the one sentence that stands in for it.
///
/// Five states and five different next actions — see `kit/state.tsx`. The one
/// worth naming here is `NoAccess`: a caller with no open posting is REFUSED
/// this route, and a refusal drawn as an empty list sends somebody looking for
/// their colleagues in the wrong place for an afternoon.
function Body({
  rows,
  total,
  pending,
  error,
  onRetry,
  columns,
  status,
  q,
  onClear,
  sort,
  onSort,
  hasMore,
  loadingMore,
  onNeedMore,
  openId,
  onOpen,
}: {
  rows: EmployeeSummary[]
  total: number
  pending: boolean
  error: unknown
  onRetry: () => void
  columns: ColumnDef<TableSetup, EmployeeSummary>[]
  status: string
  q: string
  onClear: () => void
  sort: { key: string; desc: boolean }
  onSort: (key: string) => void
  hasMore: boolean
  loadingMore: boolean
  onNeedMore: () => void
  openId: string
  onOpen: (id: string) => void
}) {
  if (pending) return <Loading rows={9} cols={columns.length} />

  if (error !== null) {
    if (error instanceof ApiError && error.status === 403) {
      return (
        <NoAccess
          what="the workforce"
          reach={
            error.detail || "The server did not say which places you reach."
          }
        />
      )
    }
    return <Failed what="the workforce" error={error} onRetry={onRetry} />
  }

  if (rows.length === 0) {
    // "Nobody works here" and "nobody matched what you asked for" are opposite
    // findings and they look identical as an empty box. There are two
    // narrowings now — the tab and the search — so an empty answer is only
    // `Empty` when NEITHER is set.
    return status === "" && q === "" ? (
      <Empty
        what="employees"
        detail="Nothing has been registered against the places you reach."
      />
    ) : (
      <NoMatch what="employees" onClear={onClear} />
    )
  }

  return (
    <Table
      columns={columns}
      rows={rows}
      rowId={(row) => row.employee_id}
      caption="The workforce"
      onRowClick={(row) => onOpen(row.employee_id)}
      isOpen={(row) => row.employee_id === openId}
      sort={sort}
      onSort={onSort}
      hasMore={hasMore}
      loadingMore={loadingMore}
      onNeedMore={onNeedMore}
      foot={{
        // The server's total, which is every row the search, the tab and this
        // caller's reach match — not the rows that have arrived. The toolbar
        // beside it says how many of them are loaded, and the two answering
        // different questions is the point.
        code: (
          <>
            <b className="text-ink">{count(total)}</b>{" "}
            {total === 1 ? "employee" : "employees"}
          </>
        ),
      }}
    />
  )
}

/// One person, whole.
///
/// Read from `GET /employees/{id}` rather than from the row behind it, because
/// the record carries what the list deliberately does not: every posting with
/// its dates and the officer behind it, the login binding, and the employment
/// history. A URL naming somebody the list is not holding — a link in a
/// message, a bookmark, anybody past the cap — opens the record all the same,
/// which is the promise the id in the address bar makes.
function PersonSheet({
  openId,
  row,
  onClose,
}: {
  openId: string
  /// The row from the list, when the list happens to hold it. Used only for the
  /// heading, so the panel has a name in it before the record lands.
  row: EmployeeSummary | undefined
  onClose: () => void
}) {
  const record = useQuery({
    queryKey: ["people", "employees", "one", openId] as const,
    enabled: openId !== "",
    queryFn: ({ signal }) =>
      api.get<EmployeeView>(
        `/api/v1/employees/${encodeURIComponent(openId)}`,
        signal,
      ),
  })

  const person = record.data

  return (
    <Sheet
      open={openId !== ""}
      onClose={onClose}
      width="record"
      title={
        row?.full_name ??
        row?.employee_code ??
        person?.employee_code ??
        "Employee"
      }
      subtitle={person ? statusLabel(person.status) : "Reading the record…"}
    >
      {record.isError ? (
        <Failed
          what="this record"
          error={record.error}
          onRetry={() => void record.refetch()}
        />
      ) : person === undefined ? (
        <Loading rows={5} cols={2} />
      ) : (
        <>
          <Facts>
            <Fact label="Number">
              <span className="font-mono">{person.employee_code}</span>
            </Fact>
            <Fact label="Status">
              <Tag tone={statusTone(person.status)}>
                {statusLabel(person.status)}
              </Tag>
            </Fact>
            <Fact label="Posted to">
              {person.current_place_id === null ? (
                <Quiet>Unposted</Quiet>
              ) : (
                (person.current_place_name ?? person.current_place_id)
              )}
            </Fact>
            <Fact label="Can be picked for new work">
              {/* The server's answer, not one derived here from the status.
                  Deriving "still here" in the browser is how a second idea of
                  it grows and disagrees with the domain. */}
              {person.selectable ? (
                <span className="text-ok-ink inline-flex items-center gap-[5px] font-medium">
                  <BadgeCheck className="size-[14px] stroke-[2.2]" /> Yes
                </span>
              ) : (
                <Quiet>No</Quiet>
              )}
            </Fact>
            <Fact label="Login" wide>
              {person.account === null ? (
                <Quiet>No login is bound to this record</Quiet>
              ) : (
                <>
                  <span className="font-mono">{person.account.username}</span>
                  {" — "}
                  {person.account.display_name}
                  {person.account.active ? "" : " (closed)"}
                  {person.account.linked_by === null && (
                    <span className="text-label text-ink-4 block">
                      Bound before the reason was kept; nothing records who
                      bound it or why.
                    </span>
                  )}
                </>
              )}
            </Fact>
          </Facts>

          <SubHead>Postings</SubHead>
          {person.assignments.length === 0 ? (
            <Line>
              <Quiet>Never posted anywhere.</Quiet>
            </Line>
          ) : (
            person.assignments.map((assignment, index) => (
              <Line
                key={`${assignment.place_id}-${assignment.valid_from}-${index}`}
                note={`${assignment.actor} — ${assignment.reason}`}
              >
                <span className="text-ink min-w-0 flex-1 truncate font-medium">
                  {assignment.place_name ?? assignment.place_id}
                </span>
                <span className="text-ink-3 shrink-0">
                  {day(assignment.valid_from)} —{" "}
                  {assignment.valid_to === null
                    ? "open"
                    : day(assignment.valid_to)}
                </span>
              </Line>
            ))
          )}

          <SubHead>Employment history</SubHead>
          {person.history.length === 0 ? (
            <Line>
              <Quiet>Nothing has been recorded.</Quiet>
            </Line>
          ) : (
            person.history.map((event, index) => (
              <Line
                key={`${event.transition}-${event.at}-${index}`}
                // Every employment write carries a reason, and the reason is
                // the half of the audit trail that helps anybody.
                note={`${event.actor} — ${event.reason}`}
              >
                <span className="min-w-0 flex-1 truncate">
                  {event.transition.toLowerCase()} · {event.from} → {event.to}
                </span>
                <span className="text-ink-3 shrink-0">
                  {day(event.effective_on)}
                </span>
              </Line>
            ))
          )}
        </>
      )}
    </Sheet>
  )
}
