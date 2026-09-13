import { useQuery } from "@tanstack/react-query"
import { IdCard } from "lucide-react"

import { RecordCard } from "@/components/ui/card"
import { Pill } from "@/components/ui/pill"
import { KeyValue } from "@/components/ui/rows"
import { CardList, Section } from "@/components/ui/screen"
import { Banner, EmptyState } from "@/components/ui/states"
import { label, toneFor } from "@/lib/format"
import { hrKeys, readDate, teamAt, type StoreScope } from "@/lib/queries/hr"
import { centreState } from "@/screens/hr/centre"
import { HrWorkspace } from "@/screens/hr/workspace"

/// Who works at this shop.
///
/// `GET /api/v1/employees?place_id=…`, which is the one HR route that narrows
/// by a parameter as well as by the caller's posting — and it narrows twice:
/// the reach is applied beside the filter, "so the day somebody edits the
/// reconciliation without reading it, the answer narrows rather than widens".
///
/// # What it deliberately does not show
///
/// No NIK, no address, no date of birth, and not because they were left out of
/// the layout: the workforce list does not carry them. "Who works here" and
/// "what is this person's NIK" are different questions with different
/// audiences, and the centre answers the second on its own route with its own
/// privilege. A counter tablet is the last place in this estate that should be
/// able to ask it, so this screen never does.
///
/// `menu-final.md` also gives a store manager submissions from here — a new
/// employee, a change, a proposed pay component. None of those has an endpoint
/// at the centre yet, so none of them has a button: a control that cannot
/// reach anything is worse than no control.
export function HrTeam() {
  return <HrWorkspace>{(scope) => <Team scope={scope} />}</HrWorkspace>
}

/// Whole days from today, or `null` when there is no date. Negative means it
/// has already passed, which is a thing a contract list has to be able to say.
function daysUntil(iso: string | null): number | null {
  if (iso === null) return null
  const then = new Date(`${iso}T00:00:00`).getTime()
  if (Number.isNaN(then)) return null
  const now = new Date()
  const midnight = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime()
  return Math.round((then - midnight) / 86_400_000)
}

function Team({ scope }: { scope: StoreScope }) {
  const team = useQuery({
    queryKey: hrKeys.team(scope.id),
    queryFn: ({ signal }) => teamAt(scope.id, signal),
  })

  return (
    <Section title="On the books">
      {centreState(team, {
        loading: "Reading who works here…",
        render: (page) => (
          <>
            <Banner tone="info" className="mb-4">
              {page.total} on the books at {page.place_id ?? scope.id}. Head
              office echoes back which place it answered for, which is the
              difference between "the workforce" and "this shop's workforce".
            </Banner>

            {page.rows.length === 0 ? (
              <EmptyState>
                Head office has nobody posted to {scope.id}. Somebody working
                here who is not on this list has not been posted yet, which is
                HR's paperwork rather than a fault of this screen.
              </EmptyState>
            ) : (
              <CardList>
                {page.rows.map((person) => {
                  const left = daysUntil(person.contract_ends_on)
                  return (
                    <RecordCard
                      key={person.employee_id}
                      icon={<IdCard />}
                      id={person.full_name ?? person.employee_code}
                      status={
                        <Pill tone={toneFor(person.status)}>
                          {label(person.status)}
                        </Pill>
                      }
                    >
                      <div className="px-3.5 py-1">
                        <KeyValue term="Badge">{person.employee_code}</KeyValue>
                        {person.position !== null && (
                          <KeyValue term="Job">{person.position}</KeyValue>
                        )}
                        {/* The most recent contract, whether or not it is
                            still in force — so a date in the past is a fact
                            about the paperwork, not a rendering mistake. */}
                        {person.contract_kind !== null && (
                          <KeyValue
                            term="Contract"
                            tone={
                              left !== null && left <= 30 ? "bad" : "normal"
                            }
                          >
                            {/* Not through `label()`: PKWT and PKWTT are the
                                Act's own initials, and "Pkwtt" is a word
                                nobody in an Indonesian shop has ever read. */}
                            {person.contract_kind}
                            {person.contract_ends_on !== null &&
                              ` · ${readDate(person.contract_ends_on)}`}
                            {left !== null &&
                              left <= 30 &&
                              (left < 0
                                ? " · ended"
                                : ` · ${left} day${left === 1 ? "" : "s"} left`)}
                          </KeyValue>
                        )}
                        {/* A person with no login cannot open the till, and
                            that is worth seeing on the day somebody new is
                            standing at the counter unable to sign in. */}
                        <KeyValue
                          term="Login"
                          tone={person.username === null ? "bad" : "normal"}
                        >
                          {person.username ?? "none issued"}
                        </KeyValue>
                      </div>
                    </RecordCard>
                  )
                })}
              </CardList>
            )}
          </>
        ),
      })}
    </Section>
  )
}
