import { CardList } from "@/components/ui/card-list"
import { LeadCard } from "@/components/ui/lead-card"
import { Pill } from "@/components/ui/pill"
import { EmptyState } from "@/components/ui/states"
import { readDate, type StoreScope } from "@/lib/queries/hr"
import { currentTerms, useHireRequests } from "@/lib/queries/staff"
import { centreState } from "@/screens/hr/centre"
import { shortMoment } from "@/screens/hr/requests-words"
import {
  answerOf,
  contractLine,
  employeeNumber,
  hireState,
} from "@/screens/hr/staff-words"
import type { EmployeeList } from "@itulah/contract"

/// *Requested to HO* — the people this shop has asked head office for, and what
/// head office said.
///
/// A card each: the name and what they were asked for, the state at the right
/// (*Waiting for HO* / *Approved* / *Declined*) with the employee number under
/// it once head office has opened their record, and when it was requested.
/// Head office's reason is on the card when it sent a request back or declined
/// one.
///
/// # No Withdraw
///
/// The prototype lets the store take back a request while it waits. The centre
/// has no such step: a hire proposal can be filed, decided by head office, and
/// revised after it is sent back — and none of the last two is open to a
/// shop's till (`/hire-proposals/{id}/revision` is not on the relay's
/// allowlist, and there is no withdrawal route at all). A button here would
/// have nothing to call. A request filed by mistake is one head office
/// declines.
export function RequestedList({
  scope,
  team,
}: {
  scope: StoreScope
  team: EmployeeList
}) {
  const requests = useHireRequests(scope)

  return centreState(requests, {
    loading: "Reading the requests to head office…",
    what: "this shop's requests for new people",
    render: (rows) =>
      rows.length === 0 ? (
        <EmptyState>No request yet.</EmptyState>
      ) : (
        <CardList>
          {rows.map((proposal) => {
            const terms = currentTerms(proposal)
            if (terms === undefined) return null
            const state = hireState(proposal)
            const number = employeeNumber(team, proposal)
            const answer = answerOf(proposal)
            const filed = terms.filed_at ?? proposal.created_at
            return (
              <LeadCard
                key={proposal.id}
                title={terms.candidate_name}
                lines={[
                  `${terms.position}${
                    terms.headcount > 1 ? ` × ${terms.headcount}` : ""
                  } · ${contractLine(terms.contract_kind, terms.contract_ends_on)}`,
                  `Joins ${readDate(terms.start_on)}`,
                  answer === null ? null : `“${answer}”`,
                ]}
                lead={{
                  figure: <Pill tone={state.tone}>{state.label}</Pill>,
                  caption:
                    number === null ? undefined : (
                      <span className="font-mono">{number}</span>
                    ),
                }}
                foot={{ info: `Requested ${shortMoment(filed) ?? "—"}` }}
              />
            )
          })}
        </CardList>
      ),
  })
}
