import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Day } from "@/components/ui/day"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, Input, Select } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { Segmented } from "@/components/ui/segmented"
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
    <PageContent>
      <PageHeader
        crumb="People · Setup"
        title="Holiday calendar"
        sub="Which days are red, and which of them come out of somebody's annual leave."
        actions={
          published.length > 0 ? (
            <Segmented
              value={String(chosen)}
              onChange={(value) => setYear(Number(value))}
              options={published.map((value) => ({
                value: String(value),
                label: String(value),
              }))}
            />
          ) : null
        }
      />

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
    </PageContent>
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
            variant="dark"
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
            variant="dark"
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
