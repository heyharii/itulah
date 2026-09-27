import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { Day } from "@/components/ui/day"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, Input, Select, Textarea } from "@/components/ui/field"
import { Pill } from "@/components/ui/pill"
import { Segmented, Toolbar } from "@/components/ui/segmented"
import { Banner, EmptyState } from "@/components/ui/states"
import { Timeline } from "@/components/ui/timeline"
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

/// Which days are red, for a year.
///
/// # Why this is typed in rather than compiled in
///
/// Indonesian public holidays are fixed each year by a *Surat Keputusan
/// Bersama* of three ministries. They move: several follow the Hijri calendar
/// and are confirmed only weeks ahead, and *cuti bersama* is routinely added,
/// removed or shifted after the year has started. A table in the code would
/// need a release every time the government changed its mind, and by then
/// somebody has already been marked absent.
///
/// # Cuti bersama is not an ordinary holiday
///
/// By the same decree that announces it, it is **charged against the
/// employee's annual leave**: the company closes and the days come out of the
/// twelve. Filing it and a national holiday both as "a red day" is how a leave
/// balance ends up wrong by exactly the number of long weekends in the year.
/// So the kind is a choice on the form and a pill in the list, and the server
/// sends `consumes_annual_leave` rather than letting this screen re-derive it.
///
/// # Published once, amended for ever after
///
/// There is no republish. What is stored is the set as first published plus an
/// append-only list of amendments, each with its own authority — which is what
/// makes "the calendar March payroll was settled under" answerable in June.

const KINDS = [
  { value: "NATIONAL", label: "National holiday" },
  {
    value: "CUTI_BERSAMA",
    label: "Cuti bersama — charged against annual leave",
  },
  { value: "REGIONAL", label: "Regional — observed only in named places" },
] as const

function thisYear(): number {
  return new Date().getFullYear()
}

export function Holidays() {
  const years = useQuery({
    queryKey: leaveKeys.calendarYears(),
    queryFn: ({ signal }) => publishedYears(signal),
  })
  const published = years.data?.years ?? []
  const [year, setYear] = useState<number | null>(null)
  const chosen = year ?? published.at(-1) ?? thisYear()

  const calendar = useQuery({
    queryKey: leaveKeys.calendar(chosen),
    queryFn: ({ signal }) => readCalendar(chosen, signal),
    // A year nobody has published is a 404, and that is a real answer rather
    // than a failure: it is why a leave request spanning it is refused.
    retry: false,
    enabled: published.includes(chosen),
  })

  return (
    <>
      {/* The year this panel is about. It was the page header's action until
          the four setup screens became one tabbed screen; a tab cannot own the
          page title, so the control that belongs to this tab sits in the tab. */}
      {published.length > 0 && (
        <Toolbar>
          <Segmented
            value={String(chosen)}
            onChange={(value) => setYear(Number(value))}
            options={published.map((value) => ({
              value: String(value),
              label: String(value),
            }))}
          />
        </Toolbar>
      )}

      {!published.includes(chosen) ? (
        <>
          <Banner tone="warn" className="mb-4">
            No calendar has been published for {chosen}. Leave spanning it
            cannot be filed, because which days it charges cannot be settled.
          </Banner>
          <PublishYear year={chosen} />
        </>
      ) : (
        <>
          <Card className="mb-4 overflow-hidden">
            <CardHeader>
              <CardTitle>{chosen}</CardTitle>
            </CardHeader>
            {queryState(calendar, {
              loading: "Reading the calendar…",
              render: (data) =>
                data.holidays.length === 0 ? (
                  <EmptyState>
                    No red days. The year is published and holds nothing — which
                    is a decision, not a gap.
                  </EmptyState>
                ) : (
                  <div className="px-4 pb-4">
                    {data.holidays.map((holiday) => (
                      <div
                        key={holiday.date}
                        className="flex items-baseline gap-3 border-b border-hairline py-2.5 last:border-0"
                      >
                        <span className="w-28 shrink-0 text-body">
                          {day(holiday.date)}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-ink">
                          {holiday.name}
                        </span>
                        {holiday.consumes_annual_leave && (
                          <Pill tone="warn">Comes out of annual leave</Pill>
                        )}
                        {holiday.places !== null && (
                          <Pill tone="neutral">
                            {holiday.places.join(", ")}
                          </Pill>
                        )}
                      </div>
                    ))}
                  </div>
                ),
            })}
          </Card>

          {(calendar.data?.amendments.length ?? 0) > 0 && (
            <Card className="mb-4 overflow-hidden">
              <CardHeader>
                <CardTitle>Amended since publication</CardTitle>
              </CardHeader>
              <div className="px-4 pb-4">
                <Timeline
                  events={(calendar.data?.amendments ?? []).map(
                    (amendment) => ({
                      id: `${amendment.change}-${amendment.holiday.date}`,
                      title: `${amendment.change === "ADDED" ? "Added" : "Withdrew"} ${amendment.holiday.name}`,
                      detail: `${day(amendment.holiday.date)} · ${amendment.actor} · ${amendment.reason}`,
                      at: moment(amendment.at),
                      // Every amendment has happened; none of them is a step
                      // somebody is waiting on.
                      state: "done" as const,
                    })
                  )}
                />
              </div>
            </Card>
          )}

          <AmendYear year={chosen} />
        </>
      )}
    </>
  )
}

/// The form both halves share. A day is a day whether it is being published
/// with the year or added to it in March.
function HolidayFields({
  draft,
  onChange,
}: {
  draft: NewHoliday
  onChange: (next: NewHoliday) => void
}) {
  const regional = draft.kind === "REGIONAL"
  return (
    <>
      <Field label="Date">
        <Day
          value={draft.date}
          onChange={(next) => onChange({ ...draft, date: next })}
        />
      </Field>
      <Field label="Name">
        <Input
          value={draft.name}
          onChange={(event) => onChange({ ...draft, name: event.target.value })}
          placeholder="Idul Fitri"
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
              // everybody, withheld from most of them by a data-entry slip.
              // The server refuses the pair; the form does not offer it.
              places: next === "REGIONAL" ? draft.places : [],
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
      {regional && (
        <Field
          label="Observed at"
          hint="Comma-separated place ids. A regional day that names nowhere is not a holiday, and is refused."
        >
          <Input
            value={draft.places.join(", ")}
            onChange={(event) =>
              onChange({
                ...draft,
                places: event.target.value
                  .split(",")
                  .map((place) => place.trim())
                  .filter((place) => place !== ""),
              })
            }
            placeholder="store-07, store-09"
          />
        </Field>
      )}
    </>
  )
}

function emptyDay(): NewHoliday {
  return { date: "", name: "", kind: "NATIONAL", places: [] }
}

/// One line of a pasted or uploaded calendar that could not be read.
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
  regional: "REGIONAL",
  daerah: "REGIONAL",
}

/// `YYYY-MM-DD`, `D/M/YYYY` and `D-M-YYYY`, because the three ministries'
/// decree is copied out of a PDF, a spreadsheet or a WhatsApp message and each
/// of them punctuates a date differently. Rejecting two of the three would send
/// somebody back to retype sixteen rows they already have.
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

/// A date that is *shaped* right is not a date that *exists*: `2026-09-99` and
/// `2026-02-30` both pass a regular expression, and a calendar that accepted
/// them would publish a holiday on a day that never comes and refuse the leave
/// somebody files around it. Built in UTC and read back in UTC so a browser
/// west of Greenwich does not roll the day backwards.
function real(iso: string): string | null {
  const [y, m, d] = iso.split("-").map(Number)
  const at = new Date(Date.UTC(y, m - 1, d))
  const same =
    at.getUTCFullYear() === y &&
    at.getUTCMonth() === m - 1 &&
    at.getUTCDate() === d
  return same ? iso : null
}

/// Split one CSV line, honouring double quotes so a name containing a comma
/// survives. Deliberately hand-written: a parser dependency for four columns is
/// a dependency to audit for four columns.
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
  return out.map((one) => one.trim())
}

/// Turn a pasted calendar into days, and say what could not be read.
///
/// **Nothing is skipped quietly.** A row this cannot parse comes back in
/// `rejected` with its line number and the reason, because a calendar that
/// silently loaded fifteen of sixteen days is a calendar somebody publishes and
/// then discovers in March, when one shop charged a working day as leave.
function parseCalendar(
  text: string,
  year: number
): {
  days: NewHoliday[]
  rejected: Rejected[]
} {
  const days: NewHoliday[] = []
  const rejected: Rejected[] = []
  const seen = new Set<string>()

  text.split(/\r?\n/).forEach((line, index) => {
    const at = index + 1
    if (line.trim() === "") return
    const parts = cells(line)
    // A header row, recognised rather than required: exports carry one and
    // hand-typed lists do not.
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
        why: `"${parts[2]}" is not nasional, cuti bersama or regional`,
      })
      return
    }
    const places = (parts[3] ?? "")
      .split(/[;|]/)
      .map((place) => place.trim())
      .filter((place) => place !== "")
    if (kind === "REGIONAL" && places.length === 0) {
      rejected.push({
        line: at,
        text: line,
        why: "a regional day names no place",
      })
      return
    }
    if (kind !== "REGIONAL" && places.length > 0) {
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
    days.push({ date, name, kind, places })
  })

  days.sort((a, b) => a.date.localeCompare(b.date))
  return { days, rejected }
}

/// Sixteen days, typed one at a time, is how a calendar gets published in
/// February.
///
/// The decree arrives as a table — a PDF, a spreadsheet, a message somebody
/// forwards — and every one of those pastes as lines. So this takes the lines,
/// and takes a file for the same reason: whoever has the calendar has it as a
/// file more often than as sixteen separate facts.
///
/// It parses in the browser and posts the year the way the form already does.
/// There is no upload endpoint, and there should not be: the server already
/// accepts a whole year in one request, and a second door into the same table
/// is a second place for the rules to be enforced differently.
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
        <span className="text-[0.875rem] text-mute">
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
          <span className="inline-flex h-8 cursor-pointer items-center rounded-full border border-hairline-strong px-3 text-[0.875rem] font-medium text-text hover:bg-soft-2">
            Choose a file
          </span>
        </label>
      </div>

      <Textarea
        rows={4}
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder={`2026-01-01, Tahun Baru Masehi, nasional\n2026-03-20, Idulfitri 1447 H, nasional\n2026-03-23, Cuti bersama Idulfitri, cuti bersama\n2026-07-14, Sedekah Bumi, regional, store-04;store-09`}
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
          <span className="text-[0.875rem] text-body">
            {loaded} day{loaded === 1 ? "" : "s"} added
            {rejected !== null && rejected.length > 0
              ? `, ${rejected.length} refused`
              : ""}
          </span>
        )}
      </div>

      {/* Every refused line, named. The alternative — a count, or nothing — is
          how fifteen of sixteen days get published. */}
      {rejected !== null && rejected.length > 0 && (
        <Banner tone="warn">
          <div className="flex flex-col gap-1">
            <span>These lines were not added:</span>
            {rejected.slice(0, 6).map((one) => (
              <span key={one.line} className="text-[0.875rem]">
                <b>Line {one.line}</b> — {one.why}:{" "}
                <span className="font-mono text-id">
                  {one.text.slice(0, 60)}
                </span>
              </span>
            ))}
            {rejected.length > 6 && (
              <span className="text-[0.875rem]">
                …and {rejected.length - 6} more.
              </span>
            )}
          </div>
        </Banner>
      )}
    </div>
  )
}

function PublishYear({ year }: { year: number }) {
  const client = useQueryClient()
  const [holidays, setHolidays] = useState<NewHoliday[]>([])
  const [draft, setDraft] = useState<NewHoliday>(emptyDay())
  const [reason, setReason] = useState("")
  const [failed, setFailed] = useState<string | null>(null)

  const publish = useMutation({
    mutationFn: () => publishCalendar(year, holidays, reason.trim()),
    onSuccess: () => {
      setFailed(null)
      void client.invalidateQueries({ queryKey: leaveKeys.calendarYears() })
      void client.invalidateQueries({ queryKey: leaveKeys.calendar(year) })
    },
    onError: (error: Error) => setFailed(error.message),
  })

  const complete = draft.date !== "" && draft.name.trim() !== ""

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle>Publish {year}</CardTitle>
      </CardHeader>
      <div className="flex flex-col gap-3 px-4 pb-4">
        {failed !== null && <Banner tone="bad">{failed}</Banner>}
        <Banner tone="info">
          A year is published once. After that it is changed by amendment, so
          that what a settled month was charged stays answerable.
        </Banner>

        <LoadCalendar
          year={year}
          onLoaded={(days) =>
            // Merged rather than replaced, and the file wins on a clash: a
            // second paste is somebody correcting the first, not starting over.
            setHolidays((current) => {
              const byDate = new Map(current.map((one) => [one.date, one]))
              days.forEach((one) => byDate.set(one.date, one))
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

        <Field label="Why" hint="Recorded against the publication.">
          <Input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="SKB tiga menteri 2026"
          />
        </Field>
        <div>
          <Button
            variant="primary"
            disabled={
              holidays.length === 0 || reason.trim() === "" || publish.isPending
            }
            onClick={() => publish.mutate()}
          >
            Publish {year}
          </Button>
        </div>
      </div>
    </Card>
  )
}

function AmendYear({ year }: { year: number }) {
  const client = useQueryClient()
  const [change, setChange] = useState<"ADDED" | "REMOVED">("ADDED")
  const [draft, setDraft] = useState<NewHoliday>(emptyDay())
  const [reason, setReason] = useState("")
  const [failed, setFailed] = useState<string | null>(null)

  const amend = useMutation({
    mutationFn: () => amendCalendar(year, change, draft, reason.trim()),
    onSuccess: () => {
      setFailed(null)
      setDraft(emptyDay())
      setReason("")
      void client.invalidateQueries({ queryKey: leaveKeys.calendar(year) })
    },
    onError: (error: Error) => setFailed(error.message),
  })

  const ready =
    draft.date !== "" && draft.name.trim() !== "" && reason.trim() !== ""

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle>Amend {year}</CardTitle>
      </CardHeader>
      <div className="flex flex-col gap-3 px-4 pb-4">
        {failed !== null && <Banner tone="bad">{failed}</Banner>}
        <Segmented
          value={change}
          onChange={(value) => setChange(value as "ADDED" | "REMOVED")}
          options={[
            { value: "ADDED", label: "Add a day" },
            { value: "REMOVED", label: "Withdraw a day" },
          ]}
        />
        {/* A withdrawal has to name the day it is withdrawing, not just its
            date: matching on the date alone would let an operator delete a
            national holiday while believing they had removed a regional one.
            So the same fields, both ways. */}
        <HolidayFields draft={draft} onChange={setDraft} />
        <Field label="Why" hint="Recorded against the amendment.">
          <Input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="SKB revisi"
          />
        </Field>
        <div>
          <Button
            variant="primary"
            disabled={!ready || amend.isPending}
            onClick={() => amend.mutate()}
          >
            {change === "ADDED" ? "Add it" : "Withdraw it"}
          </Button>
        </div>
      </div>
    </Card>
  )
}
