import { useQuery } from "@tanstack/react-query"
import { useMemo } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states"
import { money } from "@/lib/format"
import {
  domainKeys,
  listFacilities,
  listPrincipals,
} from "@/lib/queries/finance-domains"
import {
  Code,
  Grid,
  Note,
  NumberCard,
  Td,
  Th,
} from "@/screens/finance-final/parts"

/// Financing and owners — money borrowed on terms, and money the owners moved.
///
/// The two are on one screen because they answer one question: who has put
/// money into this company and on what terms. A bank lends it, an owner lends
/// it, or an owner owns it — and the third is not a debt however it is spent.
export function Financing() {
  const facilities = useQuery({
    queryKey: domainKeys.facilities(),
    queryFn: ({ signal }) => listFacilities(signal),
  })
  const owners = useQuery({
    queryKey: domainKeys.principals(),
    queryFn: ({ signal }) => listPrincipals(signal),
  })

  const rows = useMemo(() => facilities.data ?? [], [facilities.data])
  const outstanding = rows.reduce(
    (total, row) => total + row.outstanding_principal_minor,
    0
  )
  const current = rows.reduce(
    (total, row) => total + row.current_portion_minor,
    0
  )
  const equity = (owners.data ?? []).reduce(
    (total, row) => total + row.equity_minor,
    0
  )

  return (
    <PageContent>
      <PageHeader
        crumb="Finance · Payables"
        title="Loans"
        sub="Bank loans and leases we owe, and what the owners put in or took out."
      />

      <Grid>
        <NumberCard label="Principal still owed" value={outstanding} />
        <NumberCard
          label="Due within a year"
          value={current}
          note="The current part, counted from today"
        />
        <NumberCard label="Owners' equity" value={equity} />
      </Grid>

      <Note>
        Jadwal angsuran datang dari kontrak, bukan dari rumus amortisasi di
        sini. Yang ditegakkan hanyalah bahwa jadwalnya melunasi pinjamannya.
      </Note>

      {facilities.isPending ? (
        <LoadingState />
      ) : facilities.isError ? (
        <ErrorState error={facilities.error} />
      ) : rows.length === 0 ? (
        <EmptyState>
          No loan yet. Loan and lease contracts show here once they are
          recorded.
        </EmptyState>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <Th>Number</Th>
              <Th>Type</Th>
              <Th>Lender</Th>
              <Th align="right">Principal</Th>
              <Th align="right">Principal left</Th>
              <Th align="right">Interest paid</Th>
              <Th>Matures</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.facility_id}>
                <Td>
                  <Code>{row.facility_number}</Code>
                </Td>
                <Td>{row.kind}</Td>
                <Td>{row.lender_label}</Td>
                <Td align="right">{money(row.principal_minor)}</Td>
                <Td align="right">{money(row.outstanding_principal_minor)}</Td>
                <Td align="right">{money(row.paid_interest_minor)}</Td>
                <Td>{row.maturity_date}</Td>
                <Td>
                  <Pill tone={row.status === "ACTIVE" ? "info" : "ok"}>
                    {row.status}
                  </Pill>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <PageHeader
        title="Owners & Investors"
        sub="Capital paid in, drawings, and loans from the owners."
      />
      {owners.isPending ? (
        <LoadingState />
      ) : owners.isError ? (
        <ErrorState error={owners.error} />
      ) : (owners.data ?? []).length === 0 ? (
        <EmptyState>No owner recorded yet.</EmptyState>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <Th>Code</Th>
              <Th>Name</Th>
              <Th align="right">Paid in</Th>
              <Th align="right">Drawings</Th>
              <Th align="right">Net equity</Th>
              <Th align="right">Lent to the company</Th>
            </tr>
          </thead>
          <tbody>
            {(owners.data ?? []).map((row) => (
              <tr key={row.principal_id}>
                <Td>
                  <Code>{row.code}</Code>
                </Td>
                <Td>{row.name}</Td>
                <Td align="right">{money(row.contributed_minor)}</Td>
                <Td align="right">{money(row.drawn_minor)}</Td>
                <Td align="right">{money(row.equity_minor)}</Td>
                <Td align="right">{money(row.loan_outstanding_minor)}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </PageContent>
  )
}
