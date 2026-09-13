import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, Input } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { KeyValue } from "@/components/ui/rows"
import { Banner, EmptyState } from "@/components/ui/states"
import { Timeline } from "@/components/ui/timeline"
import { moment } from "@/lib/format"
import {
  attendancePeriods,
  closePeriod,
  reopenPeriod,
  rosterKeys,
} from "@/lib/queries/people"
import { queryState } from "@/lib/query-state"
import { UnitChoice, useUnit } from "@/screens/people/parts"
import type { PeriodView } from "@itulah/contract"

/// Signing the month off — and being honest about what the signature covers.
///
/// # The screen has to say what was not checked
///
/// The close records a readiness: what stood in the month's way when somebody
/// signed it. Two of those counts come back `null` rather than `0`, because
/// there is no punch source and so nothing was assessed — and a zero would be a
/// claim that somebody looked and found none.
///
/// So this screen never renders a `null` as a number. It says the punch checks
/// were not made, in a sentence, above the counts that were. Showing a tidy row
/// of zeros is exactly how a month gets signed off as clean when half of it was
/// never examined.
///
/// # Closing is the place's; reopening is head office's
///
/// A place that could reopen its own sign-off has not signed anything off. The
/// two buttons are therefore never both available to one person, and the server
/// refuses either way round.

function statusTone(status: string) {
  return status === "CLOSED" ? ("ok" as const) : ("warn" as const)
}

export function Periods() {
  const unit = useUnit()
  const place = unit.place
  const employer = unit.employer

  const periods = useQuery({
    queryKey: rosterKeys.periods(place ?? ""),
    queryFn: ({ signal }) => attendancePeriods(place ?? "", signal),
    enabled: place !== null,
  })

  return (
    <PageContent>
      <PageHeader
        crumb="People"
        title="Period close"
        sub={
          employer
            ? `What ${unit.name ?? "this place"} has signed off, and what head office has sent back. Pick another unit to read its months.`
            : `Signing ${unit.name ?? "your place"}'s months off. Closing freezes the roster as well as the facts.`
        }
        actions={
          <UnitChoice
            place={place}
            places={unit.places}
            onChange={unit.setPlace}
          />
        }
      />

      {/* The one thing somebody must know before they sign anything. */}
      <Banner tone="warn" className="mb-4">
        No punch source is connected, so nothing here knows what was actually
        worked — only what was planned, and what leave and overtime were
        decided. A close records that the punch checks were not made.
      </Banner>

      {place === null && !unit.choosing && (
        <Banner tone="bad" className="mb-4">
          You are not posted anywhere, so there is no month to close.
        </Banner>
      )}

      <Card className="mb-4 overflow-hidden">
        <CardHeader>
          <CardTitle>Months</CardTitle>
        </CardHeader>
        {queryState(periods, {
          loading: "Reading the months…",
          render: (rows) =>
            rows.length === 0 ? (
              <EmptyState>
                No month has been closed or reopened here yet. An unclosed month
                is the resting state, so there is nothing to show until one is
                signed off.
              </EmptyState>
            ) : (
              <div className="flex flex-col gap-4 px-4 pb-4">
                {rows.map((period) => (
                  <Month
                    key={period.period}
                    period={period}
                    employer={employer}
                    place={place ?? ""}
                  />
                ))}
              </div>
            ),
        })}
      </Card>

      {place !== null && !employer && <CloseMonth place={place} />}
    </PageContent>
  )
}

function Month({
  period,
  employer,
  place,
}: {
  period: PeriodView
  employer: boolean
  place: string
}) {
  const client = useQueryClient()
  const [reason, setReason] = useState("")
  const [failed, setFailed] = useState<string | null>(null)

  const reopen = useMutation({
    mutationFn: () => reopenPeriod(place, period.period, reason.trim()),
    onSuccess: () => {
      setFailed(null)
      setReason("")
      void client.invalidateQueries({ queryKey: rosterKeys.periods(place) })
    },
    onError: (error: Error) => setFailed(error.message),
  })

  const readiness = period.readiness
  return (
    <div className="border-b border-hairline pb-4 last:border-0 last:pb-0">
      <div className="flex items-baseline gap-3">
        <span className="text-card-title text-ink">{period.period}</span>
        <Pill tone={statusTone(period.status)}>{period.status}</Pill>
        {period.reopen_count > 0 && (
          // A frequently reopened month is a governance signal, so it is on the
          // row rather than derivable from the history below.
          <Pill tone="warn">Reopened ×{period.reopen_count}</Pill>
        )}
      </div>

      {readiness !== null && (
        <div className="mt-3">
          <KeyValue term="Leave still undecided">
            {readiness.unresolved_leave}
          </KeyValue>
          <KeyValue term="Overtime unanswered">
            {readiness.unanswered_overtime}
          </KeyValue>
          <KeyValue term="Nobody rostered">
            {readiness.employees_without_roster} · does not block
          </KeyValue>
          {/* Never a number. `null` means nobody looked, and rendering it as 0
              is the failure this whole distinction exists to prevent. */}
          {!readiness.punches_assessed && (
            <KeyValue term="Punch checks">
              not assessed — no punch source
            </KeyValue>
          )}
        </div>
      )}

      {period.history.length > 0 && (
        <div className="mt-3">
          <Timeline
            events={period.history.map((event, index) => ({
              id: `${event.event}-${index}`,
              title: event.event === "CLOSED" ? "Closed" : "Reopened",
              detail: `${event.actor} · ${event.reason}`,
              at: moment(event.at),
              state: index === period.history.length - 1 ? "current" : "done",
            }))}
          />
        </div>
      )}

      {employer && period.status === "CLOSED" && (
        <div className="mt-3 flex flex-col gap-2">
          {failed !== null && <Banner tone="bad">{failed}</Banner>}
          <Field
            label="Why"
            hint="Recorded against the reopening, and required."
          >
            <Input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="koreksi jadwal"
            />
          </Field>
          <div>
            <Button
              variant="danger"
              disabled={reason.trim() === "" || reopen.isPending}
              onClick={() => reopen.mutate()}
            >
              Reopen {period.period}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

function CloseMonth({ place }: { place: string }) {
  const client = useQueryClient()
  const [period, setPeriod] = useState(() =>
    new Date().toISOString().slice(0, 7)
  )
  const [reason, setReason] = useState("")
  const [failed, setFailed] = useState<string | null>(null)

  const close = useMutation({
    mutationFn: () => closePeriod(place, period, reason.trim()),
    onSuccess: () => {
      setFailed(null)
      setReason("")
      void client.invalidateQueries({ queryKey: rosterKeys.periods(place) })
    },
    onError: (error: Error) => setFailed(error.message),
  })

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle>Sign a month off</CardTitle>
      </CardHeader>
      <div className="flex flex-col gap-3 px-4 pb-4">
        {failed !== null && <Banner tone="bad">{failed}</Banner>}
        <Banner tone="info">
          Closing freezes the roster as well as the facts. A scheduled day added
          afterwards would turn a day nobody worked into an absence.
        </Banner>
        <Field label="Month" hint="YYYY-MM.">
          <Input
            type="month"
            value={period}
            onChange={(event) => setPeriod(event.target.value)}
          />
        </Field>
        <Field label="Why" hint="Recorded against the close, and required.">
          <Input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="absensi sudah dicek"
          />
        </Field>
        <div>
          <Button
            variant="primary"
            disabled={period === "" || reason.trim() === "" || close.isPending}
            onClick={() => close.mutate()}
          >
            Close {period}
          </Button>
        </div>
      </div>
    </Card>
  )
}
