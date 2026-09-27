import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { Fingerprint, MonitorOff, UserX } from "lucide-react"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { ExceptionQueue, type Exception } from "@/components/ui/exception-queue"
import { Field, Input, Select } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { MiniCell, MiniRow, MiniTable, SubHead } from "@/components/ui/rows"
import { Toolbar } from "@/components/ui/segmented"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState } from "@/components/ui/states"
import { SubTabs } from "@/components/ui/sub-tabs"
import { Tag } from "@/components/ui/tag"
import { Timeline } from "@/components/ui/timeline"
import { count, day, moment } from "@/lib/format"
import { problemOf } from "@/lib/problem"
import {
  listEmployees,
  listTerminals,
  peopleKeys,
  publishEmployeeBook,
  punchKeys,
  readEnrolment,
  registerTerminal,
  setTerminalStatus,
  withdrawFinger,
} from "@/lib/queries/people"
import { siteChoices, useUnits } from "@/lib/queries/organisation"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"
import { tableSetup, type TableSetup } from "@/lib/table"
import { UnitChoice, useUnit } from "@/screens/people/parts"
import type {
  EmployeeSummary,
  EnrolmentRow,
  EnrolmentView,
  TerminalRow,
} from "@itulah/contract"

/// The fingerprint stations, and whose fingers each unit's station knows.
///
/// # The two decisions this screen exists to carry
///
/// **Templates are stored centrally and enrolment happens at the store.** So a
/// person moved from store-03 to store-07 does not re-enrol, and a station that
/// dies does not take a unit's enrolments with it. A station pulls only the
/// templates of the people posted to its own unit — which is why the enrolment
/// half of this screen is about *one* unit and says which, rather than
/// offering a company-wide list of fingers that corresponds to nothing any
/// device holds.
///
/// **Fingerprint is the only way in.** The owner was asked twice and
/// reaffirmed it: no PIN, no card, no exception. That makes
/// `can_clock_in === false` the loudest fact this screen can carry — it does
/// not mean somebody's biometric shortcut is missing, it means that person
/// cannot record attendance *at all*, today and every day, until somebody
/// enrols them at a station. So it leads the screen as a queue of named
/// people, not as a grey column somebody scrolls past.
///
/// # Nothing here touches a template, and nothing here could
///
/// The bytes live in a Rust type with no `Serialize`, so no view, body, log
/// line or error message can carry one. What arrives in the browser is which
/// fingers somebody has on file, who captured each one, at which station and
/// when. This screen therefore has **no control that shows, uploads,
/// downloads or re-captures a template** — see "What this screen deliberately
/// does not offer" below. It administers enrolment; it does not perform it.
///
/// # Why the station list is every unit and the enrolment list is one
///
/// The station list is asked for with no place, because the server bounds it by
/// the caller's own reach: a store manager is served their own unit's stations
/// and head office is served all of them. That is the point — the question
/// "which of the thirteen shops has a station nobody has punched at since
/// Monday" has to be answerable *before* payroll, and a screen that showed one
/// unit at a time would make somebody click fourteen times to find the one
/// that was unplugged.
///
/// The enrolment list cannot be widened the same way: there is no route that
/// answers "everybody with no finger on file", so naming them costs one read
/// per person. One unit's team is a handful of reads; the company is ninety.
/// So it follows the unit picker, like the roster does, and says whose list it
/// is. Where a unit's people cannot be named — any unit but the chosen one —
/// the queue falls back to the count the station row already carries. Named
/// where we can, counted where we cannot.

type Tab = "stations" | "people"

const TABS = [
  { value: "stations", label: "Stations" },
  { value: "people", label: "Who can clock in" },
] as const

/// The stored finger codes, spelled for a person. The server's vocabulary is
/// the authority — this only decides how it is read out loud.
const FINGERS: Readonly<Record<string, string>> = {
  RIGHT_THUMB: "Right thumb",
  RIGHT_INDEX: "Right index",
  RIGHT_MIDDLE: "Right middle",
  RIGHT_RING: "Right ring",
  RIGHT_LITTLE: "Right little",
  LEFT_THUMB: "Left thumb",
  LEFT_INDEX: "Left index",
  LEFT_MIDDLE: "Left middle",
  LEFT_RING: "Left ring",
  LEFT_LITTLE: "Left little",
}

/// The append-only log's four kinds. `ERASED_ON_TERMINATION` is the one nobody
/// decides, which is why its row carries no actor.
const EVENTS: Readonly<Record<string, string>> = {
  ENROLLED: "Enrolled",
  REPLACED: "Captured again",
  WITHDRAWN: "Withdrawn and deleted",
  ERASED_ON_TERMINATION: "Erased when employment ended",
}

function said(map: Readonly<Record<string, string>>, code: string): string {
  return map[code] ?? code
}

function statusTone(status: string): "ok" | "warn" | "bad" {
  if (status === "ACTIVE") return "ok"
  if (status === "SUSPENDED") return "warn"
  return "bad"
}

function statusWord(status: string): string {
  if (status === "ACTIVE") return "Active"
  if (status === "SUSPENDED") return "Suspended"
  if (status === "REVOKED") return "Revoked"
  return status
}

/// Local midnight on this week's Monday.
///
/// The statutory week is a week rather than a rolling seven days, and "has not
/// seen a finger since Monday" is how somebody actually asks it. Computed in
/// **local** time on purpose: `punched_at` is an instant, and the boundary a
/// person means is midnight where they are standing.
function mondayStart(): number {
  const at = new Date()
  at.setHours(0, 0, 0, 0)
  at.setDate(at.getDate() - ((at.getDay() + 6) % 7))
  return at.getTime()
}

/// How a station has gone quiet, if it has.
///
/// `null` on the wire means **never**, not zero, for both instants — and the
/// two silences are different holes. A station that never synced holds no
/// templates and therefore admits nobody; a station that syncs and never
/// reports a punch is a station standing in a shop with its cable out. Neither
/// is a zero somebody may add up at the end of the month.
function silence(
  row: TerminalRow,
  monday: number
): "unsynced" | "never" | "stale" | null {
  if (row.synced_at === null) return "unsynced"
  if (row.punched_at === null) return "never"
  return Date.parse(row.punched_at) < monday ? "stale" : null
}

/// One person, beside what their enrolment turned out to be.
interface Standing {
  readonly person: EmployeeSummary
  readonly enrolment: EnrolmentView | undefined
  readonly pending: boolean
  readonly failed: boolean
}

function personName(person: EmployeeSummary): string {
  return person.full_name ?? person.employee_code
}

/// Columns built at module scope with their handlers passed in, so a cell can
/// never close over a stale render. The same shape `system/access.tsx` uses.
function stationColumns(monday: number): ColumnDef<TableSetup, TerminalRow>[] {
  return [
    {
      accessorKey: "id",
      header: "Station",
      size: 160,
      // The id is the provenance every punch this station takes will name, so
      // it is set in the mono face like every other identifier in the app.
      meta: { mono: true, card: "id" },
    },
    {
      accessorKey: "name",
      header: "Where it stands",
      size: 190,
      meta: { card: "title" },
      cell: ({ row }) => (
        <span className="font-medium text-ink">{row.original.name}</span>
      ),
    },
    {
      id: "unit",
      accessorFn: (row) => row.unit_name ?? row.unit_id,
      header: "Unit",
      size: 150,
      meta: { card: "meta" },
    },
    {
      accessorKey: "status",
      header: "Trust",
      size: 110,
      meta: { card: "status" },
      // No row button, and that is decision six rather than an omission: every
      // write here carries a reason the server refuses to accept blank, so
      // suspending a station is a decision with a sentence attached and it
      // belongs where the sentence can be typed. A one-click Suspend in the
      // row would be a reason field somebody has to be sent back for.
      cell: ({ row }) => (
        <Pill tone={statusTone(row.original.status)}>
          {statusWord(row.original.status)}
        </Pill>
      ),
    },
    {
      id: "synced",
      // `0` for never, so the never-synced stations sort to the top of an
      // ascending sort rather than to the bottom of a descending one.
      accessorFn: (row) =>
        row.synced_at === null ? 0 : Date.parse(row.synced_at),
      header: "Templates taken",
      size: 140,
      meta: { align: "right", priority: 2, card: "meta" },
      cell: ({ row }) =>
        row.original.synced_at === null ? (
          <span className="font-medium text-bad-fg">Never</span>
        ) : (
          day(row.original.synced_at)
        ),
    },
    {
      id: "punched",
      accessorFn: (row) =>
        row.punched_at === null ? 0 : Date.parse(row.punched_at),
      header: "Last punch",
      size: 140,
      // The decision metric, and the reason this column is what the list is
      // sorted by: a station nobody has clocked in at is a hole in the month,
      // and it is answerable here rather than when the month is counted.
      meta: { align: "right", card: "metric" },
      cell: ({ row }) =>
        row.original.punched_at === null ? (
          <span className="font-medium text-bad-fg">Never</span>
        ) : (
          <span
            className={
              Date.parse(row.original.punched_at) < monday
                ? "font-medium text-warn-fg"
                : undefined
            }
          >
            {day(row.original.punched_at)}
          </span>
        ),
    },
    {
      accessorKey: "enrolled_people",
      header: "Fingers on file",
      size: 130,
      meta: { align: "right", priority: 3, card: "meta" },
      // How many people posted to this station's UNIT have at least one finger
      // enrolled — a place-level number carried on every row of that place, so
      // it must never be summed across the rows of one unit.
      cell: ({ row }) =>
        row.original.enrolled_people === 0 ? (
          <span className="font-medium text-bad-fg">Nobody</span>
        ) : (
          count(row.original.enrolled_people)
        ),
    },
  ]
}

function personColumns(): ColumnDef<TableSetup, Standing>[] {
  return [
    {
      id: "person",
      accessorFn: (row) => personName(row.person),
      header: "Person",
      size: 220,
      meta: { card: "title" },
      cell: ({ row }) => (
        <span className="font-medium text-ink">
          {personName(row.original.person)}
        </span>
      ),
    },
    {
      id: "code",
      accessorFn: (row) => row.person.employee_code,
      header: "Code",
      size: 120,
      meta: { mono: true, priority: 3, card: "id" },
    },
    {
      id: "clock",
      // Numeric so that "cannot" sorts first on an ascending sort, which is
      // the order this list is read in. A person still being looked up is a 2
      // — it must not be filed with the people who cannot clock in, because
      // that queue is a work list and a pending read is not work.
      accessorFn: (row) =>
        row.pending ? 2 : row.enrolment?.can_clock_in === true ? 1 : 0,
      header: "Can clock in",
      size: 150,
      meta: { card: "status" },
      cell: ({ row }) => {
        if (row.original.failed) return <Pill tone="warn">Not answered</Pill>
        if (row.original.pending) return <Pill tone="neutral">Checking…</Pill>
        return row.original.enrolment?.can_clock_in === true ? (
          <Pill tone="ok">Yes</Pill>
        ) : (
          <Pill tone="bad">No — cannot clock in</Pill>
        )
      },
    },
    {
      id: "fingers",
      accessorFn: (row) => row.enrolment?.fingers.length ?? -1,
      header: "Fingers",
      size: 190,
      meta: { card: "meta" },
      cell: ({ row }) => {
        const fingers = row.original.enrolment?.fingers ?? []
        if (fingers.length === 0) return <span className="text-mute">—</span>
        return (
          <span className="flex flex-wrap gap-1">
            {fingers.map((finger) => (
              <Tag key={finger.finger}>{said(FINGERS, finger.finger)}</Tag>
            ))}
          </span>
        )
      },
    },
    {
      id: "enrolled",
      accessorFn: (row) =>
        Math.max(
          0,
          ...(row.enrolment?.fingers ?? []).map((finger) =>
            Date.parse(finger.enrolled_at)
          )
        ),
      header: "Last enrolled",
      size: 130,
      meta: { align: "right", priority: 2, card: "meta" },
      cell: ({ row }) => {
        const latest = (row.original.enrolment?.fingers ?? [])
          .map((finger) => finger.enrolled_at)
          .sort()
          .at(-1)
        return latest === undefined ? (
          <span className="text-mute">—</span>
        ) : (
          day(latest)
        )
      },
    },
  ]
}

export function Terminals() {
  const client = useQueryClient()
  const unit = useUnit()
  const place = unit.place
  const sheet = useSheet("terminal")
  const [tab, setTab] = useState<Tab>("stations")
  const [query, setQuery] = useState("")
  const [failed, setFailed] = useState<string | null>(null)
  // Composer state: which record a form is being written FOR, never which
  // record is open for reading. A half-typed reason must not be linkable, and
  // a withdrawal that is half-decided must not survive a reload.
  const [registering, setRegistering] = useState(false)
  const [withdrawing, setWithdrawing] = useState<{
    readonly person: EmployeeSummary
    readonly finger: EnrolmentRow
    readonly only: boolean
  } | null>(null)
  const [chosen, setChosen] = useState<string | null>(null)

  const monday = useMemo(() => mondayStart(), [])

  /// Asked with no place on purpose — the server bounds it by the caller's own
  /// reach, so one call serves a store manager their unit and head office all
  /// thirteen. See the module note on why this half is wider than the other.
  const stations = useQuery({
    queryKey: punchKeys.terminals(null),
    queryFn: ({ signal }) => listTerminals(undefined, signal),
  })

  const team = useQuery({
    queryKey: peopleKeys.employees({
      status: "ACTIVE",
      placeId: place ?? undefined,
      limit: 500,
    }),
    queryFn: ({ signal }) =>
      listEmployees(
        { status: "ACTIVE", placeId: place ?? undefined, limit: 500 },
        signal
      ),
    enabled: place !== null,
  })

  // Memoised, not `stations.data ?? []` inline: while a query is in flight the
  // fallback is a fresh array on every render, which is enough to make every
  // memo and every table built from it recompute for the whole time the screen
  // is loading.
  const rows = useMemo(() => stations.data ?? [], [stations.data])
  const people = useMemo(() => team.data ?? [], [team.data])

  /// One read per person, because there is no route that answers "everybody
  /// with no finger on file" and the alternative is a count nobody can act on.
  /// Bounded to the chosen unit's active team for exactly that reason.
  ///
  /// `combine` rather than a `useMemo` over the results: `useQueries` hands
  /// back a fresh array every render, so a memo keyed on it would never hold.
  const enrolments = useQueries({
    queries: people.map((person) => ({
      queryKey: punchKeys.enrolment(person.employee_id),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        readEnrolment(person.employee_id, signal),
      // A person the reach does not cover and a node that does not answer are
      // the two ways this fails, and asking either three times changes
      // nothing.
      retry: false,
      staleTime: 60_000,
    })),
    combine: (
      results
    ): { readonly rows: Standing[]; readonly pending: boolean } => ({
      rows: results.map((result, index) => ({
        person: people[index],
        enrolment: result.data,
        pending: result.isPending,
        failed: result.isError,
      })),
      pending: results.some((result) => result.isPending),
    }),
  })

  const standing = enrolments.rows
  const here = useMemo(
    () => rows.filter((row) => row.unit_id === place),
    [rows, place]
  )
  const open = rows.find((row) => row.id === sheet.value)

  /// Everything that stops a punch being recorded, in one queue.
  ///
  /// One queue rather than two, because it is one question — *can this unit
  /// record attendance tomorrow* — asked of two kinds of subject. A person
  /// with no finger on file and a station with its cable out are both answers
  /// of "no", and filing them separately is how one of the two lists stops
  /// being opened.
  ///
  /// Built in the render body and deliberately not memoised: every entry's
  /// `onOpen` closes over the sheet's navigate and the unit picker's setter,
  /// both of which are rebuilt on every render, so a memo over them would
  /// never hold — it would only hide that it never holds. Twenty small objects
  /// cost nothing next to the table below.
  const exceptions = ((): Exception[] => {
    const out: Exception[] = []
    const unitName = unit.name ?? place ?? "this unit"

    // A unit with no station at all, or none that is trusted. The most
    // consequential row on the screen: a suspended station attests nothing, so
    // every punch it believes it took is refused on the way in.
    if (place !== null && !team.isPending) {
      const active = here.filter((row) => row.status === "ACTIVE")
      if (here.length === 0) {
        out.push({
          id: "no-station",
          severity: "high",
          icon: <MonitorOff className="size-4 stroke-[1.7]" />,
          title: `${unitName} has no punch station`,
          detail:
            "Fingerprint is the only way in, so nobody here can clock in until a station is registered.",
          amount: `${count(people.length)} people`,
          onOpen: () => setRegistering(true),
        })
      } else if (active.length === 0) {
        out.push({
          id: "no-active-station",
          severity: "high",
          icon: <MonitorOff className="size-4 stroke-[1.7]" />,
          title: `No trusted station at ${unitName}`,
          detail:
            "Every station here is suspended or revoked. A station that is not active attests nothing, so no punch it takes is recorded.",
          amount: `${count(people.length)} people`,
          onOpen: () => sheet.open(here[0].id),
        })
      }
    }

    // The people, by name. `can_clock_in === false` is not a flag: it is a
    // person who cannot record attendance on any day until somebody enrols
    // them at a station.
    const stuck = standing.filter(
      (one) =>
        !one.pending && !one.failed && one.enrolment?.can_clock_in !== true
    )
    stuck.slice(0, 6).forEach((one) => {
      out.push({
        id: `enrol-${one.person.employee_id}`,
        severity: "high",
        icon: <UserX className="size-4 stroke-[1.7]" />,
        title: personName(one.person),
        detail: `${unitName} · no finger on file, so no way in — enrol at a station in the unit.`,
        amount: "Cannot clock in",
        onOpen: () => {
          setTab("people")
          setChosen(one.person.employee_id)
        },
      })
    })
    if (stuck.length > 6) {
      out.push({
        id: "enrol-more",
        severity: "high",
        icon: <UserX className="size-4 stroke-[1.7]" />,
        title: `${count(stuck.length - 6)} more people at ${unitName} cannot clock in`,
        detail: "Nobody has enrolled a finger for them.",
        onOpen: () => setTab("people"),
      })
    }

    // The stations that have gone quiet, across every unit the caller reaches
    // — which is the point of asking for them all. A revoked station is not a
    // hole: it was deliberately destroyed, and its silence is the intent.
    rows
      .filter((row) => row.status !== "REVOKED")
      .forEach((row) => {
        const how = silence(row, monday)
        if (how === null) return
        const where = row.unit_name ?? row.unit_id
        out.push({
          id: `quiet-${row.id}`,
          severity: "medium",
          icon: <MonitorOff className="size-4 stroke-[1.7]" />,
          title:
            how === "unsynced"
              ? `${row.name} has never taken its templates`
              : how === "never"
                ? `${row.name} has never delivered a punch`
                : `${row.name} has taken no punch since Monday`,
          detail:
            how === "unsynced"
              ? `${where} · it holds no templates, so it admits nobody. Publish the unit's book and check the station is on the network.`
              : `${where} · a month counted against this station would be counted against a hole rather than a zero.`,
          amount:
            how === "stale" && row.punched_at !== null
              ? day(row.punched_at)
              : "Never",
          onOpen: () => sheet.open(row.id),
        })
      })

    // Where a unit's people cannot be named, the station row's own count is
    // the only signal there is. Skipped for the chosen unit, whose people are
    // named above — the same fact twice reads as two problems.
    rows
      .filter(
        (row) =>
          row.status === "ACTIVE" &&
          row.unit_id !== place &&
          row.enrolled_people === 0
      )
      .forEach((row) => {
        out.push({
          id: `empty-${row.id}`,
          severity: "high",
          icon: <Fingerprint className="size-4 stroke-[1.7]" />,
          title: `Nobody is enrolled at ${row.unit_name ?? row.unit_id}`,
          detail: `${row.name} is active and holds no fingers, so the whole unit is locked out. Pick the unit above to see who.`,
          amount: "0 on file",
          onOpen: () => unit.setPlace(row.unit_id),
        })
      })

    return out
  })()

  const publish = useMutation({
    mutationFn: () => publishEmployeeBook(place ?? ""),
    onSuccess: () => setFailed(null),
    onError: (error) => setFailed(problemOf(error)),
  })

  return (
    <PageContent>
      <PageHeader
        crumb="People · Settings"
        title="Punch stations"
        sub="The fingerprint stations, and whose fingers each unit's station knows. Templates are kept centrally and captured at the store, so nobody re-enrols when they move and no station takes a unit's enrolments with it when it dies."
        actions={
          <>
            <UnitChoice
              place={place}
              places={unit.places}
              onChange={unit.setPlace}
            />
            <Button variant="primary" onClick={() => setRegistering(true)}>
              Register a station
            </Button>
          </>
        }
      />

      {failed !== null && (
        <Banner tone="bad" className="mb-3" onDismiss={() => setFailed(null)}>
          {failed}
        </Banner>
      )}
      {place === null && !unit.choosing && (
        <Banner tone="warn" className="mb-3">
          You are not posted anywhere, so no unit's stations are yours to see.
        </Banner>
      )}

      {/* Exceptions first, and this queue is the screen's argument: a station
          nobody has punched at and a person with no finger on file are both
          months that will not add up, and both are cheap to fix today and
          expensive to discover in the payroll run. */}
      <ExceptionQueue
        title="What stops a punch being recorded"
        exceptions={exceptions}
        empty={
          stations.isPending || enrolments.pending
            ? "Reading the stations and who they know…"
            : "Every station has reported this week, and everybody in this unit has a finger on file."
        }
      />

      <SubTabs
        tabs={TABS}
        value={tab}
        onChange={(next) => setTab(next as Tab)}
      />

      {tab === "stations" ? (
        <>
          <Toolbar>
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search stations"
              className="h-8 w-56"
            />
            <Toolbar.Spacer />
            {/* Publishing is explicit rather than only on a timer, because
                "the station is running last week's roster" has to be fixable
                by somebody pressing a button while a person stands at the
                reader. It goes to the UNIT, not to one station, so it is a
                list action and not a row one. */}
            <Button
              variant="ghost"
              pending={publish.isPending}
              disabled={place === null}
              onClick={() => publish.mutate()}
            >
              {publish.isPending
                ? "Publishing…"
                : `Publish ${unit.name ?? "this unit"}'s book`}
            </Button>
          </Toolbar>

          <Card className="overflow-hidden">
            {queryState(stations, {
              loading: "Reading the stations…",
              refused: (
                <EmptyState>
                  You are not posted anywhere, so no punch station is yours to
                  see. Which devices a unit runs is that unit's business.
                </EmptyState>
              ),
              render: () =>
                rows.length === 0 ? (
                  <EmptyState
                    action={
                      <Button
                        variant="primary"
                        onClick={() => setRegistering(true)}
                      >
                        Register a station
                      </Button>
                    }
                  >
                    No station is registered anywhere you reach. Until one is,
                    nobody can clock in at all — a punch can only be created by
                    a registered, active device standing in a unit.
                  </EmptyState>
                ) : (
                  <StationTable
                    rows={rows}
                    monday={monday}
                    query={query}
                    onQuery={setQuery}
                    openId={sheet.value}
                    onOpen={(row) => sheet.open(row.id)}
                  />
                ),
            })}
          </Card>
        </>
      ) : (
        <PeopleTab
          place={place}
          unitName={unit.name}
          standing={standing}
          chosen={chosen}
          onChoose={setChosen}
          onWithdraw={setWithdrawing}
          state={team}
        />
      )}

      <StationSheet
        station={open}
        monday={monday}
        missing={sheet.isOpen && open === undefined && !stations.isPending}
        onClose={sheet.close}
        onDone={() => setFailed(null)}
      />
      <RegisterSheet
        open={registering}
        place={place}
        onClose={() => setRegistering(false)}
        onDone={() => setFailed(null)}
      />
      <WithdrawSheet
        target={withdrawing}
        onClose={() => setWithdrawing(null)}
        onDone={() => {
          setFailed(null)
          void client.invalidateQueries({ queryKey: punchKeys.terminals(null) })
        }}
      />
    </PageContent>
  )
}

/// The state shape `queryState` needs, without naming Query's own generics.
interface Loadable<T> {
  isPending: boolean
  isError: boolean
  error: unknown
  data: T | undefined
  refetch: () => void
}

function StationTable({
  rows,
  monday,
  query,
  onQuery,
  openId,
  onOpen,
}: {
  rows: readonly TerminalRow[]
  monday: number
  query: string
  onQuery: (value: string) => void
  openId: string | undefined
  onOpen: (row: TerminalRow) => void
}) {
  /// Quiet first. A station that has never delivered a punch sorts to `0`, so
  /// the rows somebody came here for are the rows at the top — and nobody has
  /// to know to sort a column to find them.
  const [sorting, setSorting] = useState<SortingState>([
    { id: "punched", desc: false },
  ])
  const columns = useMemo(() => stationColumns(monday), [monday])

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows as TerminalRow[],
        columns,
        getRowId: (row: TerminalRow) => row.id,
        state: { globalFilter: query, sorting },
        onSortingChange: setSorting,
        onGlobalFilterChange: onQuery,
      }),
      [rows, columns, query, sorting, onQuery]
    )
  )

  return (
    <DataTable<TerminalRow>
      table={table}
      onRowClick={onOpen}
      isSelected={(row) => row.id === openId}
      empty="No station matches that search."
      className="max-h-[calc(100vh-26rem)]"
    />
  )
}

/// Whose fingers this unit's station knows, and who it does not know at all.
function PeopleTab({
  place,
  unitName,
  standing,
  chosen,
  onChoose,
  onWithdraw,
  state,
}: {
  place: string | null
  unitName: string | null
  standing: readonly Standing[]
  chosen: string | null
  onChoose: (employeeId: string | null) => void
  onWithdraw: (target: {
    person: EmployeeSummary
    finger: EnrolmentRow
    only: boolean
  }) => void
  state: Loadable<EmployeeSummary[]>
}) {
  /// Ascending, so the people who cannot clock in are the first thing read.
  const [sorting, setSorting] = useState<SortingState>([
    { id: "clock", desc: false },
  ])
  const [query, setQuery] = useState("")
  const columns = useMemo(() => personColumns(), [])

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: standing as Standing[],
        columns,
        getRowId: (row: Standing) => row.person.employee_id,
        state: { globalFilter: query, sorting },
        onSortingChange: setSorting,
        onGlobalFilterChange: setQuery,
      }),
      [standing, columns, query, sorting]
    )
  )

  const selected = standing.find((one) => one.person.employee_id === chosen)

  return (
    <>
      <Toolbar>
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search people"
          className="h-8 w-56"
        />
      </Toolbar>

      <Card className="mb-[1.125rem] overflow-hidden">
        <CardHeader>
          <CardTitle>{unitName ?? "This unit"}</CardTitle>
          <span className="text-[0.875rem] text-mute">
            only the people posted here — a station pulls no other templates
          </span>
        </CardHeader>
        {place === null ? (
          <EmptyState>
            Pick a unit above. Enrolment is a fact about one unit's station, so
            there is no company-wide list of fingers to show.
          </EmptyState>
        ) : (
          queryState(state, {
            loading: "Reading who is posted here…",
            render: () =>
              standing.length === 0 ? (
                <EmptyState>
                  Nobody is posted here, so there is nobody for the station to
                  know.
                </EmptyState>
              ) : (
                <DataTable<Standing>
                  table={table}
                  onRowClick={(row) => onChoose(row.person.employee_id)}
                  isSelected={(row) => row.person.employee_id === chosen}
                  empty="Nobody matches that search."
                  className="max-h-[calc(100vh-32rem)]"
                />
              ),
          })
        )}
      </Card>

      {/* Selected rather than opened in a sheet, and deliberately: the sheet
          key this screen owns is the STATION, and an enrolment is not a record
          with an address of its own — it is what the row already says, read at
          full length. Everything below is already in hand from the row's own
          query, so choosing somebody costs no request. */}
      {selected !== undefined && (
        <Enrolment standing={selected} onWithdraw={onWithdraw} />
      )}
    </>
  )
}

function Enrolment({
  standing,
  onWithdraw,
}: {
  standing: Standing
  onWithdraw: (target: {
    person: EmployeeSummary
    finger: EnrolmentRow
    only: boolean
  }) => void
}) {
  const view = standing.enrolment
  const fingers = view?.fingers ?? []

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle>{personName(standing.person)}</CardTitle>
        {view !== undefined &&
          (view.can_clock_in ? (
            <Pill tone="ok">Can clock in</Pill>
          ) : (
            <Pill tone="bad">Cannot clock in</Pill>
          ))}
      </CardHeader>

      <div className="flex flex-col gap-3.5 px-4 pb-4">
        {standing.failed && (
          <Banner tone="warn">
            This person's enrolment could not be read. Nothing is claimed about
            it either way — an unanswered read is not an empty one.
          </Banner>
        )}

        {view !== undefined && !view.can_clock_in && (
          <Banner tone="bad">
            Nobody has enrolled a finger for {personName(standing.person)}.
            Fingerprint is the only way in — there is no PIN and no card — so
            they cannot record attendance on any day until somebody enrols them
            at a station in this unit. Every day until then is a manual
            attendance correction.
          </Banner>
        )}

        <div>
          <SubHead
            aside={
              fingers.length === 0
                ? undefined
                : `${count(fingers.length)} on file`
            }
          >
            Fingers on file
          </SubHead>
          {fingers.length === 0 ? (
            <p className="py-6 text-center text-meta text-body">
              Nothing on file. Capture happens at the station with the reader in
              front of the person — never from this screen.
            </p>
          ) : (
            <MiniTable
              head={[
                "Finger",
                { label: "Quality", align: "right" },
                { label: "Captured at", align: "left" },
                { label: "By", align: "left" },
                { label: "When", align: "right" },
                { label: "", align: "right" },
              ]}
            >
              {fingers.map((finger) => (
                <MiniRow key={finger.finger}>
                  <MiniCell>{said(FINGERS, finger.finger)}</MiniCell>
                  {/* `null` is the device reporting no score, and it is NOT a
                      zero — zero is a claim the capture was worthless. */}
                  <MiniCell align="right">
                    {finger.quality === null ? (
                      <span className="text-mute">Not scored</span>
                    ) : (
                      count(finger.quality)
                    )}
                  </MiniCell>
                  <MiniCell>
                    {finger.terminal_name ?? finger.terminal_id}
                  </MiniCell>
                  <MiniCell>{finger.enrolled_by}</MiniCell>
                  <MiniCell align="right">{day(finger.enrolled_at)}</MiniCell>
                  <MiniCell align="right">
                    <Button
                      variant="quiet"
                      size="sm"
                      onClick={() =>
                        onWithdraw({
                          person: standing.person,
                          finger,
                          only: fingers.length === 1,
                        })
                      }
                    >
                      Withdraw
                    </Button>
                  </MiniCell>
                </MiniRow>
              ))}
            </MiniTable>
          )}
        </div>

        {/* Withdrawing deletes the template and keeps the evidence, and the
            sentence belongs here — where the control is — rather than in a
            document nobody opens. */}
        {fingers.length > 0 && (
          <p className="text-[0.875rem] text-mute">
            Withdrawing a finger deletes the template. A cancelled-but-present
            biometric is regulated data held with no purpose, so the bytes go
            and the event stays: the log below keeps who withdrew it, when, and
            why.
          </p>
        )}

        {(view?.history.length ?? 0) > 0 && (
          <div>
            <SubHead aside="append-only">What happened to it</SubHead>
            <Timeline
              events={(view?.history ?? []).map((event, index) => ({
                id: `${event.kind}-${event.finger}-${event.at}-${index}`,
                title: `${said(EVENTS, event.kind)} · ${said(FINGERS, event.finger)}`,
                detail: [
                  // `null` for the automatic erasure on termination, which
                  // nobody decides — so it says that rather than showing a
                  // dash where an actor should be.
                  event.actor ?? "automatic, when employment ended",
                  event.terminal_id,
                  event.reason,
                ]
                  .filter((part) => part !== null && part !== "")
                  .join(" · "),
                at: moment(event.at),
                // Everything in an append-only log has happened. None of it is
                // a step somebody is waiting on.
                state: "done" as const,
              }))}
            />
          </div>
        )}
      </div>
    </Card>
  )
}

/// One station: what it is, what it has been doing, and how much it is
/// trusted.
///
/// Which station is open lives in the URL, so the row somebody found can be
/// sent to whoever has to walk over to it.
function StationSheet({
  station,
  monday,
  missing,
  onClose,
  onDone,
}: {
  station: TerminalRow | undefined
  /// Handed down rather than recomputed here, so the week boundary the table
  /// colours a row against and the one this panel writes a sentence about
  /// cannot be two different Mondays.
  monday: number
  missing: boolean
  onClose: () => void
  onDone: () => void
}) {
  const client = useQueryClient()
  const [reason, setReason] = useState("")

  const change = useMutation({
    mutationFn: (status: string) =>
      setTerminalStatus(station?.id ?? "", status, reason.trim()),
    onSuccess: () => {
      onDone()
      // Invalidated rather than written into the cache from the response: the
      // endpoint answers with the rows for THAT station's place, and this
      // screen holds the unplaced list of everything the caller reaches.
      // Writing a one-place answer over an all-places key would quietly delete
      // every other unit's stations from the screen.
      void client.invalidateQueries({ queryKey: punchKeys.terminals(null) })
      setReason("")
      onClose()
    },
  })

  const how = station === undefined ? null : silence(station, monday)
  const ready = reason.trim() !== "" && !change.isPending

  return (
    <Sheet
      open={station !== undefined || missing}
      onOpenChange={(next) => {
        if (!next) {
          setReason("")
          change.reset()
          onClose()
        }
      }}
      id={station?.id}
      title={station?.name ?? "Station"}
      caption={
        station === undefined
          ? undefined
          : `${station.unit_name ?? station.unit_id} · registered by ${station.registered_by} on ${day(station.registered_at)}`
      }
      badge={
        station === undefined ? undefined : (
          <Pill tone={statusTone(station.status)}>
            {statusWord(station.status)}
          </Pill>
        )
      }
      footer={
        <div className="flex justify-end">
          <Button variant="quiet" onClick={onClose}>
            Close
          </Button>
        </div>
      }
    >
      {missing || station === undefined ? (
        <Banner tone="warn">
          No station with that id is registered, or it is not one you reach.
        </Banner>
      ) : (
        <div className="flex flex-col gap-4">
          <Facts>
            <Fact term="Unit">{station.unit_name ?? station.unit_id}</Fact>
            <Fact term="Installed at">{station.site_name ?? station.site_id}</Fact>
            <Fact term="How it identifies">
              {station.method === "FINGERPRINT"
                ? "Fingerprint"
                : station.method}
            </Fact>
            <Fact term="Templates last taken">
              {station.synced_at === null ? "Never" : moment(station.synced_at)}
            </Fact>
            <Fact term="Last punch">
              {station.punched_at === null
                ? "Never"
                : moment(station.punched_at)}
            </Fact>
            <Fact term="Fingers on file in this unit">
              {station.enrolled_people === 0
                ? "Nobody"
                : count(station.enrolled_people)}
            </Fact>
            <Fact term="Registered">{day(station.registered_at)}</Fact>
          </Facts>

          {how === "unsynced" && (
            <Banner tone="bad">
              This station has never collected its templates, so it knows
              nobody's finger and admits nobody. Publish the unit's book and
              check it can reach the network.
            </Banner>
          )}
          {how === "never" && (
            <Banner tone="warn">
              No punch has ever arrived from this station. Until one does, a
              month counted here is counted against a hole rather than a zero.
            </Banner>
          )}
          {how === "stale" && (
            <Banner tone="warn">
              Nothing has been punched at this station since before Monday.
              Somebody should look at the device before the month is counted.
            </Banner>
          )}
          {station.enrolled_people === 0 && station.status === "ACTIVE" && (
            <Banner tone="bad">
              Nobody in this unit has a finger on file, and fingerprint is the
              only way in. Enrol somebody at this station before opening time.
            </Banner>
          )}

          {station.status === "REVOKED" ? (
            <Banner tone="info">
              Revoked is permanent and has no way back. The physical device this
              identity named is gone, and a row edited back to active would
              resurrect an identity somebody decided to destroy — register the
              replacement under its own id.
            </Banner>
          ) : (
            <div className="flex flex-col gap-3">
              <SubHead aside="recorded against the change">
                Change how much it is trusted
              </SubHead>
              <Field
                label="Why"
                required
                hint="The server refuses a blank reason. Trust in a device that can create attendance is a decision, and a decision with no sentence behind it is not auditable."
              >
                <Input
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="Moved to the stockroom counter"
                />
              </Field>
              <div className="flex flex-wrap gap-2">
                {station.status === "ACTIVE" ? (
                  <Button
                    variant="soft"
                    disabled={!ready}
                    onClick={() => change.mutate("SUSPENDED")}
                  >
                    Suspend
                  </Button>
                ) : (
                  <Button
                    variant="primary"
                    disabled={!ready}
                    onClick={() => change.mutate("ACTIVE")}
                  >
                    Restore
                  </Button>
                )}
                <Button
                  variant="danger"
                  disabled={!ready}
                  onClick={() => change.mutate("REVOKED")}
                >
                  Revoke for good
                </Button>
              </div>
              <p className="text-[0.875rem] text-mute">
                Suspending is reversible and is the answer to a station that has
                moved, is under repair, or is sending traffic nobody can
                explain. Revoking is not reversible.
              </p>
              {change.isError && (
                <Banner tone="bad">{problemOf(change.error)}</Banner>
              )}
            </div>
          )}
        </div>
      )}
    </Sheet>
  )
}

/// Registering a station creates attendance authority where there was none.
///
/// Local state rather than the URL, for the reason `system/access.tsx` gives
/// about its own composers: this is a form being written *for* a unit, not a
/// record open for reading, and a half-typed registration must not be
/// linkable.
interface StationDraft {
  readonly terminalId: string
  /// Where it is installed. A site, not a unit: the unit it attests for is the
  /// one that owns the site, and the server reads it from there.
  readonly siteId: string
  readonly name: string
  readonly reason: string
}

function RegisterSheet({
  open,
  place,
  onClose,
  onDone,
}: {
  open: boolean
  place: string | null
  onClose: () => void
  onDone: () => void
}) {
  const client = useQueryClient()
  const units = useUnits()
  const sites = useMemo(() => siteChoices(units.data ?? []), [units.data])
  const [draft, setDraft] = useState<StationDraft>({
    terminalId: "",
    siteId: "",
    name: "",
    reason: "",
  })

  // The unit being looked at, when it has exactly one site, is the default:
  // a store's only premises is its shop. Head office has one today too (the
  // Gudang), but a unit with two sites makes somebody choose.
  const onlySiteHere = sites.filter((one) => one.unitId === place)
  const chosenSite =
    draft.siteId !== ""
      ? draft.siteId
      : onlySiteHere.length === 1
        ? (onlySiteHere[0]?.siteId ?? "")
        : ""

  const register = useMutation({
    // Wrapped rather than passed by reference: v5 hands a mutation context as
    // the second argument, which is not the `AbortSignal` a fetcher expects.
    mutationFn: () =>
      registerTerminal({
        terminalId: draft.terminalId.trim(),
        siteId: chosenSite,
        name: draft.name.trim(),
        reason: draft.reason.trim(),
      }),
    onSuccess: () => {
      onDone()
      void client.invalidateQueries({ queryKey: punchKeys.terminals(null) })
      setDraft({ terminalId: "", siteId: "", name: "", reason: "" })
      register.reset()
      onClose()
    },
  })

  const ready =
    draft.terminalId.trim() !== "" &&
    chosenSite !== "" &&
    draft.name.trim() !== "" &&
    draft.reason.trim() !== "" &&
    !register.isPending

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          register.reset()
          onClose()
        }
      }}
      title="Register a punch station"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!ready} onClick={() => register.mutate()}>
            {register.isPending ? "Registering…" : "Register"}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3.5">
        <Banner tone="warn">
          A registered station is attendance authority: only a registered,
          active device standing in a unit can create a punch there. It starts
          active and can attest immediately.
        </Banner>

        <Field
          label="Station id"
          required
          hint="Chosen when the device is installed and never changed — it is what every punch this station takes names as its provenance."
        >
          <Input
            value={draft.terminalId}
            onChange={(event) =>
              setDraft({ ...draft, terminalId: event.target.value })
            }
            autoComplete="off"
            className="font-mono"
            placeholder="STORE-01-PUNCH-1"
          />
        </Field>

        <Field
          label="Installed at"
          required
          hint="One site, never a blank one: a station whose site can be left empty is a station that can punch anywhere. It attests for the unit that owns the site."
        >
          <Select
            value={chosenSite}
            onChange={(next) => setDraft({ ...draft, siteId: next })}
          >
            <option value="">Choose a site…</option>
            {sites.map((one) => (
              <option key={one.siteId} value={one.siteId}>
                {one.label}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Where it stands"
          required
          hint="What somebody would call it out loud."
        >
          <Input
            value={draft.name}
            onChange={(event) =>
              setDraft({ ...draft, name: event.target.value })
            }
            placeholder="Staff entrance, by the lockers"
          />
        </Field>

        <Field
          label="Why"
          hint="Recorded against the registration. The server refuses a blank reason."
          required
        >
          <Input
            value={draft.reason}
            onChange={(event) =>
              setDraft({ ...draft, reason: event.target.value })
            }
            placeholder="New station installed 13 Sep"
          />
        </Field>

        {register.isError && (
          <Banner tone="bad">{problemOf(register.error)}</Banner>
        )}
      </div>
    </Sheet>
  )
}

/// Withdrawing one finger while the person is still employed.
///
/// The row is deleted, not flagged. A retired-but-present biometric is
/// regulated data held with no purpose — so the template goes and the event
/// survives, which is what makes the disposal auditable. That sentence is on
/// the panel rather than in a policy document, because this is where somebody
/// decides.
function WithdrawSheet({
  target,
  onClose,
  onDone,
}: {
  target: {
    readonly person: EmployeeSummary
    readonly finger: EnrolmentRow
    readonly only: boolean
  } | null
  onClose: () => void
  onDone: () => void
}) {
  const client = useQueryClient()
  const [reason, setReason] = useState("")

  const withdraw = useMutation({
    mutationFn: () =>
      withdrawFinger(
        target?.person.employee_id ?? "",
        target?.finger.finger ?? "",
        reason.trim()
      ),
    onSuccess: (view) => {
      onDone()
      // The response IS this key's answer, so it is written straight in rather
      // than refetched.
      if (target !== null) {
        client.setQueryData(
          punchKeys.enrolment(target.person.employee_id),
          view
        )
      }
      setReason("")
      onClose()
    },
  })

  return (
    <Sheet
      open={target !== null}
      onOpenChange={(next) => {
        if (!next) {
          setReason("")
          withdraw.reset()
          onClose()
        }
      }}
      id={target?.person.employee_code}
      title={`Withdraw ${said(FINGERS, target?.finger.finger ?? "").toLowerCase()}`}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="danger"
            pending={withdraw.isPending}
            disabled={reason.trim() === ""}
            onClick={() => withdraw.mutate()}
          >
            {withdraw.isPending ? "Withdrawing…" : "Withdraw and delete"}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3.5">
        <Banner tone="warn">
          This deletes the template. A cancelled-but-present biometric is
          regulated data held with no purpose, so the bytes go — and the event
          stays, with who decided it, when and why, so the disposal is
          auditable.
        </Banner>

        {target?.only === true && (
          <Banner tone="bad">
            This is {personName(target.person)}'s only finger on file.
            Fingerprint is the only way in, so withdrawing it means they cannot
            clock in at all — on any day — until somebody enrols them again at a
            station in their unit.
          </Banner>
        )}

        {target !== null && (
          <Facts>
            <Fact term="Person">{personName(target.person)}</Fact>
            <Fact term="Finger">{said(FINGERS, target.finger.finger)}</Fact>
            <Fact term="Captured at">
              {target.finger.terminal_name ?? target.finger.terminal_id}
            </Fact>
            <Fact term="Enrolled">{day(target.finger.enrolled_at)}</Fact>
          </Facts>
        )}

        <Field
          label="Why"
          hint="Recorded against the withdrawal, and refused if blank."
          required
        >
          <Input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Print no longer reads; re-enrolling on the left index"
          />
        </Field>

        {withdraw.isError && (
          <Banner tone="bad">{problemOf(withdraw.error)}</Banner>
        )}
      </div>
    </Sheet>
  )
}

/// The same component under the screen's own title, because `index.ts` and
/// `nav.ts` are another lane's files and land separately: the registry may
/// name this door after its route (`Terminals`) or after what it is called on
/// screen (`Punch stations`), and an alias costs one line where a mismatched
/// import costs a broken build in somebody else's tree. Drop whichever of the
/// two the registry does not use once both sides are in one commit.
export { Terminals as PunchStations }
