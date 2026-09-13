import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { CalendarCheck, Lock } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Field, Input } from "@/components/ui/field"
import { Pill } from "@/components/ui/pill"
import { KeyValue } from "@/components/ui/rows"
import { Section } from "@/components/ui/screen"
import { Segmented } from "@/components/ui/segmented"
import { Banner } from "@/components/ui/states"
import { moment } from "@/lib/format"
import {
  closePeriod,
  hrKeys,
  isoMonth,
  periodAt,
  readMonth,
  type StoreScope,
} from "@/lib/queries/hr"
import { centreState, describeCentre } from "@/screens/hr/centre"
import { HrWorkspace } from "@/screens/hr/workspace"
import type { CloseReadinessView } from "@itulah/contract"

/// Signing this shop's month off.
///
/// It is the whole of a store's contribution to payroll, by Hari's decision
/// and by `menu-final.md`: "Store mengusulkan komponen dan menutup data waktu.
/// HR HO menyusun payroll." A manager never sees a run, a slip or a salary on
/// this surface — Payroll is withheld from a store in the approved menu, and
/// there is no screen here that could show one.
///
/// **Closing is the shop's; reopening is head office's.** The centre routes
/// them apart on purpose — a place that could reopen its own close has not
/// closed anything — so this screen has one button and it only ever goes one
/// way.
export function HrPeriod() {
  return <HrWorkspace>{(scope) => <Period scope={scope} />}</HrWorkspace>
}

const MONTHS = [
  { value: "last", label: "Last month" },
  { value: "this", label: "This month" },
] as const

function Period({ scope }: { scope: StoreScope }) {
  // Two months and not a calendar: a month is signed off in the first days of
  // the one after it, and every other month is either already closed or has
  // not happened. In local state rather than the URL because it is a two-way
  // switch on one screen, not a place somebody sends a colleague.
  const [which, setWhich] = useState<(typeof MONTHS)[number]["value"]>("last")
  const now = new Date()
  const period =
    which === "this"
      ? isoMonth(now)
      : isoMonth(new Date(now.getFullYear(), now.getMonth() - 1, 1))

  const month = useQuery({
    queryKey: hrKeys.period(scope.id, period),
    queryFn: ({ signal }) => periodAt(scope.id, period, signal),
  })

  return (
    <Section title={readMonth(period)}>
      <div className="pb-4">
        <Segmented options={MONTHS} value={which} onChange={setWhich} />
      </div>

      {centreState(month, {
        loading: "Asking head office about this month…",
        render: (view) => (
          <>
            <Card className="mb-4">
              <div className="flex items-center gap-2.5 bg-soft px-3 py-2.5">
                <span className="grid size-[1.6875rem] shrink-0 place-items-center rounded-inner border border-hairline-2 bg-canvas text-line-ico [&_svg]:size-[0.9375rem]">
                  {view.status === "CLOSED" ? <Lock /> : <CalendarCheck />}
                </span>
                <span className="min-w-0 flex-1 truncate text-card-title font-semibold text-ink">
                  {view.place_id} · {readMonth(view.period)}
                </span>
                <Pill tone={view.status === "CLOSED" ? "ok" : "info"}>
                  {view.status === "CLOSED" ? "Closed" : "Open"}
                </Pill>
              </div>
              <div className="px-3.5 py-1">
                {/* A frequently reopened period is a governance signal, which
                    is why the centre makes it a field rather than something to
                    derive from the history. It is drawn only when it is one. */}
                {view.reopen_count > 0 && (
                  <KeyValue term="Reopened" tone="bad">
                    {view.reopen_count} time
                    {view.reopen_count === 1 ? "" : "s"}
                  </KeyValue>
                )}
                {view.history.length === 0 ? (
                  <KeyValue term="History">nothing has happened yet</KeyValue>
                ) : (
                  view.history.map((event) => (
                    <KeyValue
                      key={`${event.event}-${event.at}`}
                      term={`${event.event === "CLOSED" ? "Closed" : "Reopened"} by ${event.actor}`}
                    >
                      {moment(event.at)}
                    </KeyValue>
                  ))
                )}
              </div>
            </Card>

            {view.readiness === null ? (
              <Banner tone="ok">
                This month is closed. Reopening it is head office's, not this
                shop's — which is what makes the close mean anything.
              </Banner>
            ) : (
              <Readiness
                scope={scope}
                period={view.period}
                readiness={view.readiness}
              />
            )}
          </>
        ),
      })}
    </Section>
  )
}

/// What stands between this month and a close, and the close itself.
///
/// The counts come from the centre and are recomputed there when the button is
/// pressed: "the readiness is computed here from stored facts, never taken
/// from the body — a client supplying its own zeros would close a month over
/// anything it liked". So what is drawn is a statement of the shop's position,
/// not an argument the shop gets to make.
function Readiness({
  scope,
  period,
  readiness,
}: {
  scope: StoreScope
  period: string
  readiness: CloseReadinessView
}) {
  const client = useQueryClient()
  const [reason, setReason] = useState("")

  const close = useMutation({
    mutationFn: () => closePeriod({ place: scope.id, period, reason }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: hrKeys.period(scope.id, period) })
    },
  })

  return (
    <>
      <Card className="mb-4 px-3.5 py-1">
        <KeyValue
          term="Leave still undecided"
          tone={readiness.unresolved_leave > 0 ? "bad" : "ok"}
        >
          {readiness.unresolved_leave}
        </KeyValue>
        <KeyValue
          term="Overtime unanswered"
          tone={readiness.unanswered_overtime > 0 ? "bad" : "ok"}
        >
          {readiness.unanswered_overtime}
        </KeyValue>
        {/* `null` means NOT ASSESSED, and a zero here would be a claim that
            somebody looked and found none. There is no punch source anywhere
            in this system, so nothing was looked at — and that is what this
            row says, in those words. */}
        <KeyValue term="Corrections open">
          {readiness.open_corrections ?? "not assessed"}
        </KeyValue>
        <KeyValue term="Days worked off the rota">
          {readiness.unrostered_punch_days ?? "not assessed"}
        </KeyValue>
        <KeyValue term="On the books, never rostered">
          {readiness.employees_without_roster}
        </KeyValue>
      </Card>

      {!readiness.punches_assessed && (
        <Banner tone="warn" className="mb-4">
          Nothing about attendance was assessed: there is no punch source, so
          the two rows above are unanswered rather than clean. Closing this
          month signs off the rota and the decisions, and says nothing about who
          was actually here.
        </Banner>
      )}

      <Card className="p-4">
        <p className="mb-4 text-meta text-body">
          Closing hands this month's time data to head office, who build payroll
          from it. It is not a payment and it is not an approval of one.
        </p>
        <Field
          label="Why"
          hint="Head office refuses a close with no reason on it."
        >
          <Input
            value={reason}
            placeholder="September time data checked and complete"
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
        {close.error !== null && (
          <Banner tone="bad" className="mt-3">
            {describeCentre(close.error)}
          </Banner>
        )}
        {!readiness.can_close && (
          <Banner tone="warn" className="mt-3">
            Head office will refuse this close while anything above is still
            waiting on a decision. Settle the leave and the overtime first.
          </Banner>
        )}
        <Button
          variant="primary"
          size="lg"
          block
          className="mt-4"
          disabled={
            !readiness.can_close || reason.trim() === "" || close.isPending
          }
          onClick={() => close.mutate()}
        >
          {close.isPending ? "Closing…" : `Close ${readMonth(period)}`}
        </Button>
      </Card>
    </>
  )
}
