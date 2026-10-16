import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { useLayout } from "@/lib/layout"
import { DockChoice } from "@/components/shell/dock-tools"
import { Fab } from "@/components/ui/fab"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Day } from "@/components/ui/day"
import { Field, Input, Select, Textarea } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { Segmented, Toolbar } from "@/components/ui/segmented"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState, Problem } from "@/components/ui/states"
import { day, moment } from "@/lib/format"
import {
  amendCalendar,
  leaveKeys,
  publishCalendar,
  publishedYears,
  readCalendar,
  type NewHoliday,
} from "@/lib/queries/people"
import { queryState } from "@/lib/query-state"
import { useCanWrite } from "@/lib/session"
import { CardDate, CardFoot, CardName } from "@/components/ui/phone-cards"
import { tableSetup, type TableSetup } from "@/lib/table"
import { SheetFooter } from "@/screens/people/settings-kit"
import { useOpener } from "@/screens/people/settings-lib"
import type { CalendarAmendmentView, HolidayView } from "@itulah/contract"

/// Settings › Holidays — which days are red, for a year.
///
/// Indonesian public holidays are fixed each year by a decree of three
/// ministries and move after the year has started, so they are typed in, not
/// compiled in. *Collective leave* is charged against annual leave, which is why
/// the kind is on every row. A year is published once and amended for ever
/// after, so "the calendar March payroll was settled under" stays answerable.

const KINDS = [
  { value: "NATIONAL", label: "National holiday" },
  {
    value: "CUTI_BERSAMA",
    label: "Collective leave — charged against annual leave",
  },
  { value: "REGIONAL", label: "Regional — observed only in named places" },
] as const

const KIND_SHORT: Record<string, string> = {
  NATIONAL: "National",
  CUTI_BERSAMA: "Collective leave",
  REGIONAL: "Regional",
}

const NO_HOLIDAYS: HolidayView[] = []
const NO_AMENDMENTS: CalendarAmendmentView[] = []

const kindOf = (holiday: HolidayView) =>
  KIND_SHORT[holiday.kind] ?? holiday.kind

const observedAt = (holiday: HolidayView) =>
  holiday.units === null ? "Everywhere" : holiday.units.join(", ")

const holidayColumns: ColumnDef<TableSetup, HolidayView>[] = [
  {
    id: "date",
    accessorFn: (row) => row.date,
    header: "Date",
    size: 180,
    meta: { card: "hide" },
    cell: ({ row }) => day(row.original.date),
  },
  {
    accessorKey: "name",
    header: "Name",
    size: 280,
    meta: { card: "hide" },
  },
  {
    accessorKey: "kind",
    header: "Kind",
    size: 360,
    meta: { card: "hide" },
    cell: ({ row }) => (
      <>
        {kindOf(row.original)}
        {row.original.consumes_annual_leave && (
          <Pill tone="warn" className="ml-2">
            Comes out of annual leave
          </Pill>
        )}
      </>
    ),
  },
  {
    id: "observed",
    accessorFn: (row) => observedAt(row),
    header: "Observed at",
    size: 200,
    meta: { card: "hide" },
  },
  // Three columns that exist only on a card (`cardLead`; a phone): the name
  // over where it is observed, the day as the figure, and what kind it is.
  {
    id: "head",
    accessorFn: (row) => row.name,
    header: "",
    enableHiding: false,
    enableSorting: false,
    meta: { card: "title" },
    cell: ({ row }) => (
      <CardName
        name={row.original.name}
        line={`Observed at ${observedAt(row.original)}`}
      />
    ),
  },
  {
    id: "lead",
    accessorFn: (row) => row.date,
    header: "",
    enableHiding: false,
    enableSorting: false,
    meta: { card: "lead" },
    cell: ({ row }) => <CardDate iso={row.original.date} />,
  },
  {
    id: "foot",
    accessorFn: (row) => row.kind,
    header: "",
    enableHiding: false,
    enableSorting: false,
    meta: { card: "foot" },
    cell: ({ row }) => (
      <CardFoot
        status={
          row.original.consumes_annual_leave ? (
            <Pill tone="warn">Comes out of annual leave</Pill>
          ) : undefined
        }
      >
        {kindOf(row.original)}
      </CardFoot>
    ),
  },
]

const changeOf = (row: CalendarAmendmentView) =>
  `${row.change === "ADDED" ? "Added" : "Withdrew"} ${row.holiday.name}`

const amendmentColumns: ColumnDef<TableSetup, CalendarAmendmentView>[] = [
  {
    id: "change",
    accessorFn: (row) => changeOf(row),
    header: "Change",
    size: 280,
    meta: { card: "hide" },
  },
  {
    id: "day",
    accessorFn: (row) => row.holiday.date,
    header: "Day",
    size: 160,
    meta: { card: "hide" },
    cell: ({ row }) => day(row.original.holiday.date),
  },
  {
    accessorKey: "actor",
    header: "By",
    size: 160,
    meta: { card: "hide" },
  },
  {
    accessorKey: "reason",
    header: "Why",
    size: 280,
    meta: { card: "hide" },
    cell: ({ row }) => (
      <span className="block whitespace-normal">{row.original.reason}</span>
    ),
  },
  {
    accessorKey: "at",
    header: "When",
    size: 200,
    meta: { card: "hide" },
    cell: ({ row }) => moment(row.original.at),
  },
  // Three columns that exist only on a card (`cardLead`; a phone): what
  // changed over who did it and why, the day as the figure, and when.
  {
    id: "head",
    accessorFn: (row) => changeOf(row),
    header: "",
    enableHiding: false,
    enableSorting: false,
    meta: { card: "title" },
    cell: ({ row }) => (
      <CardName
        name={changeOf(row.original)}
        line={`${row.original.actor} · ${row.original.reason}`}
      />
    ),
  },
  {
    id: "lead",
    accessorFn: (row) => row.holiday.date,
    header: "",
    enableHiding: false,
    enableSorting: false,
    meta: { card: "lead" },
    cell: ({ row }) => <CardDate iso={row.original.holiday.date} />,
  },
  {
    id: "foot",
    accessorFn: (row) => row.at,
    header: "",
    enableHiding: false,
    enableSorting: false,
    meta: { card: "foot" },
    cell: ({ row }) => moment(row.original.at),
  },
]

export function HolidaySettings() {
  const canWrite = useCanWrite()
  const phone = useLayout() === "phone"
  const years = useQuery({
    queryKey: leaveKeys.calendarYears(),
    queryFn: ({ signal }) => publishedYears(signal),
  })
  const published = years.data?.years ?? []
  const [year, setYear] = useState<number | null>(null)
  const chosen = year ?? published.at(-1) ?? new Date().getFullYear()
  const isPublished = published.includes(chosen)

  const calendar = useQuery({
    queryKey: leaveKeys.calendar(chosen),
    queryFn: ({ signal }) => readCalendar(chosen, signal),
    // A year nobody has published is a 404, and that is a real answer rather
    // than a failure: it is why a leave request spanning it is refused.
    retry: false,
    enabled: isPublished,
  })

  const publish = useOpener()
  const add = useOpener()
  const one = useOpener<HolidayView>()

  const holidays = calendar.data?.holidays ?? NO_HOLIDAYS
  const amendments = calendar.data?.amendments ?? NO_AMENDMENTS
  const holidayTable = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: holidays,
        columns: holidayColumns,
        getRowId: (row: HolidayView) => row.date,
        // The card's own columns are drawn on a phone and never on a desk.
        state: { columnVisibility: { head: phone, lead: phone, foot: phone } },
      }),
      [holidays, phone]
    )
  )
  const amendmentTable = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: amendments,
        columns: amendmentColumns,
        getRowId: (row: CalendarAmendmentView) =>
          `${row.change}-${row.holiday.date}-${row.at}`,
        // The card's own columns are drawn on a phone and never on a desk.
        state: { columnVisibility: { head: phone, lead: phone, foot: phone } },
      }),
      [amendments, phone]
    )
  )

  return (
    <PageContent>
      <PageHeader
        crumb="People"
        title="Holidays"
        sub="Which days are red, and which of them come out of somebody's annual leave."
        actions={
          !phone &&
          canWrite &&
          years.isSuccess &&
          (isPublished ? (
            <Button variant="primary" onClick={() => add.show()}>
              Add holiday
            </Button>
          ) : (
            <Button variant="primary" onClick={() => publish.show()}>
              Publish {chosen}
            </Button>
          ))
        }
      />

      {/* On a phone the year is the chip over the bottom bar and the one
          action is the round + (a toolbar there would be a second chip). */}
      {phone ? (
        <>
          <DockChoice
            value={String(chosen)}
            onChange={(value) => setYear(Number(value))}
            options={[...new Set([...published, chosen])]
              .sort((a, b) => a - b)
              .map((value) => ({
                value: String(value),
                label: String(value),
                short: String(value),
              }))}
          />
          {canWrite && years.isSuccess && (
            <Fab
              label={isPublished ? "Add holiday" : `Publish ${chosen}`}
              onClick={() => (isPublished ? add.show() : publish.show())}
            />
          )}
        </>
      ) : (
        <Toolbar>
          <Segmented
            value={String(chosen)}
            onChange={(value) => setYear(Number(value))}
            options={[...new Set([...published, chosen])]
              .sort((a, b) => a - b)
              .map((value) => ({ value: String(value), label: String(value) }))}
          />
        </Toolbar>
      )}

      {years.isSuccess && !isPublished && (
        <Banner tone="warn" className="mb-4">
          No calendar has been published for {chosen}. Leave spanning it cannot
          be filed, because which days it charges cannot be settled.
        </Banner>
      )}

      <Card className="mb-4 overflow-hidden max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
        <CardHeader>
          <CardTitle>{String(chosen)}</CardTitle>
        </CardHeader>
        {!isPublished ? (
          <EmptyState>
            Nothing to list yet. Publish {chosen} sets the year&rsquo;s red days
            in one go.
          </EmptyState>
        ) : (
          queryState(calendar, {
            loading: "Reading the calendar…",
            render: (data) =>
              data.holidays.length === 0 ? (
                <EmptyState>
                  No red days. The year is published and holds nothing — which
                  is a decision, not a gap. Add holiday adds one.
                </EmptyState>
              ) : (
                <DataTable<HolidayView>
                  refresh={[calendar]}
                  table={holidayTable}
                  onRowClick={(holiday) => one.show(holiday)}
                  isSelected={(holiday) =>
                    one.isOpen && holiday.date === one.item?.date
                  }
                  cardsApart
                  cardLead
                  cardSort={false}
                />
              ),
          })
        )}
      </Card>

      {amendments.length > 0 && (
        <Card className="mb-4 overflow-hidden max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
          <CardHeader>
            <CardTitle>Amended since publication</CardTitle>
          </CardHeader>
          <DataTable<CalendarAmendmentView>
            table={amendmentTable}
            cardsApart
            cardLead
            cardSort={false}
          />
        </Card>
      )}

      <PublishSheet
        key={`pub-${publish.n}-${chosen}`}
        open={publish.isOpen}
        onClose={publish.hide}
        year={chosen}
      />
      <AddSheet
        key={`add-${add.n}`}
        open={add.isOpen}
        onClose={add.hide}
        year={chosen}
      />
      <HolidaySheet
        key={`one-${one.n}`}
        open={one.isOpen}
        onClose={one.hide}
        year={chosen}
        holiday={one.item}
        canWrite={canWrite}
      />
    </PageContent>
  )
}

/// The form both the publication and an amendment share. A day is a day
/// whether it is published with the year or added to it in March.
function HolidayFields({
  draft,
  onChange,
}: {
  draft: NewHoliday
  onChange: (next: NewHoliday) => void
}) {
  return (
    <>
      <Field label="Date" required>
        <Day
          value={draft.date}
          onChange={(next) => onChange({ ...draft, date: next })}
        />
      </Field>
      <Field label="Name" required>
        <Input
          value={draft.name}
          onChange={(event) => onChange({ ...draft, name: event.target.value })}
        />
      </Field>
      <Field label="Kind">
        <Select
          value={draft.kind}
          onChange={(next) =>
            onChange({
              ...draft,
              kind: next as NewHoliday["kind"],
              // A national day narrowed to some shops is a day the law gives
              // everybody, withheld from most of them by a slip. The server
              // refuses the pair; the form does not offer it.
              units: next === "REGIONAL" ? draft.units : [],
            })
          }
        >
          {KINDS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </Field>
      {draft.kind === "REGIONAL" && (
        <Field
          label="Observed at"
          required
          hint="Comma-separated place ids. A regional day that names nowhere is refused."
        >
          <Input
            value={draft.units.join(", ")}
            onChange={(event) =>
              onChange({
                ...draft,
                units: event.target.value
                  .split(",")
                  .map((unit) => unit.trim())
                  .filter((unit) => unit !== ""),
              })
            }
          />
        </Field>
      )}
    </>
  )
}

function emptyDay(): NewHoliday {
  return { date: "", name: "", kind: "NATIONAL", units: [] }
}

// ── reading a pasted calendar ───────────────────────────────────────────────

interface Rejected {
  readonly line: number
  readonly text: string
  readonly why: string
}

const KIND_WORDS: Record<string, NewHoliday["kind"]> = {
  national: "NATIONAL",
  nasional: "NATIONAL",
  "libur nasional": "NATIONAL",
  cuti_bersama: "CUTI_BERSAMA",
  "cuti bersama": "CUTI_BERSAMA",
  cutibersama: "CUTI_BERSAMA",
  collective: "CUTI_BERSAMA",
  "collective leave": "CUTI_BERSAMA",
  collective_leave: "CUTI_BERSAMA",
  regional: "REGIONAL",
  daerah: "REGIONAL",
}

/// `YYYY-MM-DD`, `D/M/YYYY` and `D-M-YYYY`, because the decree is copied out
/// of a PDF, a spreadsheet or a message and each punctuates a date differently.
function readDate(raw: string): string | null {
  const text = raw.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return real(text)
  const parts = text.split(/[/.-]/).map((part) => part.trim())
  if (parts.length !== 3) return null
  const [d, m, y] = parts
  if (!/^\d{1,2}$/.test(d) || !/^\d{1,2}$/.test(m) || !/^\d{4}$/.test(y)) {
    return null
  }
  return real(`${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`)
}

/// A date that is shaped right is not a date that exists: `2026-02-30` passes a
/// regular expression. Built and read back in UTC so a browser west of
/// Greenwich does not roll the day backwards.
function real(iso: string): string | null {
  const [y, m, d] = iso.split("-").map(Number)
  const at = new Date(Date.UTC(y, m - 1, d))
  const same =
    at.getUTCFullYear() === y &&
    at.getUTCMonth() === m - 1 &&
    at.getUTCDate() === d
  return same ? iso : null
}

/// Split one CSV line, honouring double quotes so a name with a comma survives.
function cells(line: string): string[] {
  const out: string[] = []
  let cell = ""
  let quoted = false
  for (let at = 0; at < line.length; at += 1) {
    const ch = line[at]
    if (ch === '"') {
      if (quoted && line[at + 1] === '"') {
        cell += '"'
        at += 1
      } else {
        quoted = !quoted
      }
    } else if ((ch === "," || ch === ";" || ch === "\t") && !quoted) {
      out.push(cell)
      cell = ""
    } else {
      cell += ch
    }
  }
  out.push(cell)
  return out.map((value) => value.trim())
}

/// Turn a pasted calendar into days, and say what could not be read. Nothing
/// is skipped quietly: a calendar that silently loaded fifteen of sixteen days
/// is discovered in March, when one shop charged a working day as leave.
function parseCalendar(
  text: string,
  year: number
): { days: NewHoliday[]; rejected: Rejected[] } {
  const days: NewHoliday[] = []
  const rejected: Rejected[] = []
  const seen = new Set<string>()

  text.split(/\r?\n/).forEach((line, index) => {
    const at = index + 1
    if (line.trim() === "") return
    const parts = cells(line)
    if (at === 1 && /tanggal|date/i.test(parts[0] ?? "")) return

    const date = readDate(parts[0] ?? "")
    if (date === null) {
      rejected.push({ line: at, text: line, why: "the date could not be read" })
      return
    }
    if (!date.startsWith(`${year}-`)) {
      rejected.push({ line: at, text: line, why: `not in ${year}` })
      return
    }
    const name = (parts[1] ?? "").trim()
    if (name === "") {
      rejected.push({ line: at, text: line, why: "no name" })
      return
    }
    const kindRaw = (parts[2] ?? "").trim().toLowerCase()
    const kind: NewHoliday["kind"] | undefined =
      kindRaw === "" ? "NATIONAL" : KIND_WORDS[kindRaw]
    if (kind === undefined) {
      rejected.push({
        line: at,
        text: line,
        why: `"${parts[2]}" is not national, collective leave or regional`,
      })
      return
    }
    const units = (parts[3] ?? "")
      .split(/[;|]/)
      .map((unit) => unit.trim())
      .filter((unit) => unit !== "")
    if (kind === "REGIONAL" && units.length === 0) {
      rejected.push({
        line: at,
        text: line,
        why: "a regional day names no place",
      })
      return
    }
    if (kind !== "REGIONAL" && units.length > 0) {
      rejected.push({
        line: at,
        text: line,
        why: "only a regional day may name places",
      })
      return
    }
    if (seen.has(date)) {
      rejected.push({
        line: at,
        text: line,
        why: `${date} is already on the list`,
      })
      return
    }
    seen.add(date)
    days.push({ date, name, kind, units })
  })

  days.sort((a, b) => a.date.localeCompare(b.date))
  return { days, rejected }
}

/// Sixteen days typed one at a time is how a calendar gets published in
/// February. The decree arrives as lines or a file, so this takes either and
/// parses in the browser; the server already accepts a whole year in one
/// request.
function LoadCalendar({
  year,
  onLoaded,
}: {
  year: number
  onLoaded: (days: NewHoliday[]) => void
}) {
  const [text, setText] = useState("")
  const [rejected, setRejected] = useState<Rejected[] | null>(null)
  const [loaded, setLoaded] = useState<number | null>(null)

  const take = (raw: string) => {
    const { days, rejected: bad } = parseCalendar(raw, year)
    setRejected(bad)
    setLoaded(days.length)
    if (days.length > 0) onLoaded(days)
  }

  return (
    <div className="flex flex-col gap-2.5 rounded-inner bg-soft-3 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-meta font-medium text-ink">
          Load a year at once
        </span>
        <span className="text-[0.9375rem] text-mute">
          date, name, kind, places — one day per line
        </span>
        <label className="ml-auto">
          <input
            type="file"
            accept=".csv,.tsv,.txt,text/csv,text/plain"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (!file) return
              const reader = new FileReader()
              reader.onload = () => {
                const raw = String(reader.result ?? "")
                setText(raw)
                take(raw)
              }
              reader.readAsText(file)
              // So choosing the same file twice still fires.
              event.target.value = ""
            }}
          />
          <span className="inline-flex h-8 cursor-pointer items-center rounded-inner border border-hairline-strong px-3 text-[0.9375rem] font-medium text-text hover:bg-soft-2">
            Choose a file
          </span>
        </label>
      </div>

      <Textarea
        rows={4}
        value={text}
        onChange={(event) => setText(event.target.value)}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="soft"
          disabled={text.trim() === ""}
          onClick={() => take(text)}
        >
          Read the lines
        </Button>
        {loaded !== null && (
          <span className="text-[0.9375rem] text-body">
            {loaded} day{loaded === 1 ? "" : "s"} added
            {rejected !== null && rejected.length > 0
              ? `, ${rejected.length} refused`
              : ""}
          </span>
        )}
      </div>

      {rejected !== null && rejected.length > 0 && (
        <Banner tone="warn">
          <div className="flex flex-col gap-1">
            <span>These lines were not added:</span>
            {rejected.slice(0, 6).map((bad) => (
              <span key={bad.line} className="text-[0.9375rem]">
                <b>Line {bad.line}</b> — {bad.why}:{" "}
                <span className="font-mono text-id">
                  {bad.text.slice(0, 60)}
                </span>
              </span>
            ))}
            {rejected.length > 6 && (
              <span className="text-[0.9375rem]">
                …and {rejected.length - 6} more.
              </span>
            )}
          </div>
        </Banner>
      )}
    </div>
  )
}

// ── the sheets ──────────────────────────────────────────────────────────────

function PublishSheet({
  open,
  onClose,
  year,
}: {
  open: boolean
  onClose: () => void
  year: number
}) {
  const client = useQueryClient()
  const [holidays, setHolidays] = useState<NewHoliday[]>([])
  const [draft, setDraft] = useState<NewHoliday>(emptyDay())
  const [reason, setReason] = useState("")

  const publish = useMutation({
    mutationFn: () => publishCalendar(year, holidays, reason.trim()),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: leaveKeys.calendarYears() })
      void client.invalidateQueries({ queryKey: leaveKeys.calendar(year) })
      onClose()
    },
  })

  const complete = draft.date !== "" && draft.name.trim() !== ""

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      width="wide"
      title={`Publish ${year}`}
      footer={
        <SheetFooter
          onCancel={onClose}
          onSave={() => publish.mutate()}
          saveLabel={`Publish ${year}`}
          pendingLabel="Publishing…"
          pending={publish.isPending}
          disabled={holidays.length === 0 || reason.trim() === ""}
        />
      }
    >
      <div className="flex flex-col gap-3.5">
        <Problem error={publish.error} />
        <Banner tone="info">
          A year is published once. After that it is changed by amendment, so
          that what a settled month was charged stays answerable.
        </Banner>

        <LoadCalendar
          year={year}
          onLoaded={(days) =>
            // Merged rather than replaced, and the file wins on a clash: a
            // second paste is somebody correcting the first.
            setHolidays((current) => {
              const byDate = new Map(
                current.map((entry) => [entry.date, entry])
              )
              days.forEach((entry) => byDate.set(entry.date, entry))
              return [...byDate.values()].sort((a, b) =>
                a.date.localeCompare(b.date)
              )
            })
          }
        />

        {holidays.length > 0 && (
          <div>
            {holidays.map((holiday, index) => (
              <div
                key={`${holiday.date}-${holiday.name}`}
                className="flex items-baseline gap-3 border-b border-hairline py-2 last:border-0"
              >
                <span className="w-28 shrink-0 text-body">
                  {day(holiday.date)}
                </span>
                <span className="min-w-0 flex-1 truncate text-ink">
                  {holiday.name}
                </span>
                <Button
                  variant="quiet"
                  onClick={() =>
                    setHolidays(holidays.filter((_, at) => at !== index))
                  }
                >
                  Remove
                </Button>
              </div>
            ))}
          </div>
        )}

        <HolidayFields draft={draft} onChange={setDraft} />
        <div>
          <Button
            variant="soft"
            disabled={!complete}
            onClick={() => {
              setHolidays([...holidays, draft])
              setDraft(emptyDay())
            }}
          >
            Add to the year
          </Button>
        </div>

        <Field label="Why" hint="Recorded against the publication." required>
          <Input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
      </div>
    </Sheet>
  )
}

function AddSheet({
  open,
  onClose,
  year,
}: {
  open: boolean
  onClose: () => void
  year: number
}) {
  const client = useQueryClient()
  const [draft, setDraft] = useState<NewHoliday>(emptyDay())
  const [reason, setReason] = useState("")
  const amend = useMutation({
    mutationFn: () => amendCalendar(year, "ADDED", draft, reason.trim()),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: leaveKeys.calendar(year) })
      onClose()
    },
  })
  const ready =
    draft.date !== "" && draft.name.trim() !== "" && reason.trim() !== ""
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title={`Add a holiday to ${year}`}
      footer={
        <SheetFooter
          onCancel={onClose}
          onSave={() => amend.mutate()}
          saveLabel="Submit"
          pending={amend.isPending}
          disabled={!ready}
        />
      }
    >
      <div className="flex flex-col gap-3.5">
        <Problem error={amend.error} />
        <HolidayFields draft={draft} onChange={setDraft} />
        <Field label="Why" hint="Recorded against the amendment." required>
          <Input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
      </div>
    </Sheet>
  )
}

/// One red day: its facts, and withdrawing it — which asks why, and names the
/// whole day so a national holiday is never withdrawn by mistaking it for a
/// regional one.
function HolidaySheet({
  open,
  onClose,
  year,
  holiday,
  canWrite,
}: {
  open: boolean
  onClose: () => void
  year: number
  holiday: HolidayView | null
  canWrite: boolean
}) {
  const client = useQueryClient()
  const [reason, setReason] = useState("")
  const withdraw = useMutation({
    mutationFn: () =>
      amendCalendar(
        year,
        "REMOVED",
        {
          date: holiday?.date ?? "",
          name: holiday?.name ?? "",
          kind: (holiday?.kind ?? "NATIONAL") as NewHoliday["kind"],
          units: holiday?.units ?? [],
        },
        reason.trim()
      ),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: leaveKeys.calendar(year) })
      onClose()
    },
  })
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title={holiday?.name ?? "Holiday"}
      footer={
        <SheetFooter
          onCancel={onClose}
          danger={
            canWrite &&
            holiday && (
              <Button
                variant="danger"
                pending={withdraw.isPending}
                disabled={reason.trim() === ""}
                onClick={() => withdraw.mutate()}
              >
                {withdraw.isPending ? "Withdrawing…" : "Withdraw this day"}
              </Button>
            )
          }
        />
      }
    >
      {holiday && (
        <div className="flex flex-col gap-4">
          <Facts>
            <Fact term="Date">{day(holiday.date)}</Fact>
            <Fact term="Kind">{KIND_SHORT[holiday.kind] ?? holiday.kind}</Fact>
            <Fact term="Annual leave">
              {holiday.consumes_annual_leave
                ? "Charged against it"
                : "Not charged"}
            </Fact>
            <Fact term="Observed at">
              {holiday.units === null ? "Everywhere" : holiday.units.join(", ")}
            </Fact>
          </Facts>
          {canWrite && (
            <Field
              label="Why withdraw it"
              hint="Needed before the day can be withdrawn."
            >
              <Input
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </Field>
          )}
          <Problem error={withdraw.error} />
        </div>
      )}
    </Sheet>
  )
}
