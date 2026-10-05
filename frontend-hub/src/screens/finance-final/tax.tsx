import { useQuery } from "@tanstack/react-query"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Select } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Toolbar } from "@/components/ui/segmented"
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states"
import { SubTabs } from "@/components/ui/sub-tabs"
import { count, dateText, money } from "@/lib/format"
import {
  domainKeys,
  listTaxPeriods,
  listTaxTypes,
  taxReconciliation,
} from "@/lib/queries/finance-domains"
import {
  CardRow,
  Grid,
  NumberCard,
  Td,
  Th,
} from "@/screens/finance-final/parts"

/// Tax Payables — every tax period, what it owes or holds as credit, what has
/// been paid, and what is left.
///
/// PPh 25 is a CREDIT and PPh 29 is a PAYABLE: the same tax, opposite
/// balances, and the subledger refuses to record one against the other. So
/// the two totals above the list stay apart — a single "tax" figure would be
/// the netting the accounting refuses.
///
/// Redrawn 2026-10-01 in English (owner): one list of periods, narrowed by
/// tax and by status; the tax types themselves live on Tax › Tax Types.
type Show = "OPEN" | "FILED" | "SETTLED" | "ALL"

export function Tax() {
  const types = useQuery({
    queryKey: domainKeys.taxTypes(),
    queryFn: ({ signal }) => listTaxTypes(signal),
  })
  const periods = useQuery({
    queryKey: domainKeys.taxPeriods(),
    queryFn: ({ signal }) => listTaxPeriods(signal),
  })
  const control = useQuery({
    queryKey: domainKeys.taxReconciliation(),
    queryFn: ({ signal }) => taxReconciliation(signal),
  })
  const [show, setShow] = useState<Show>("OPEN")
  const [taxType, setTaxType] = useState("")

  const all = useMemo(() => periods.data ?? [], [periods.data])
  const payable = all
    .filter((row) => row.nature === "PAYABLE")
    .reduce((total, row) => total + row.outstanding_minor, 0)
  const credit = all
    .filter((row) => row.nature === "CREDIT")
    .reduce((total, row) => total + row.outstanding_minor, 0)
  const mismatched = (control.data ?? []).filter(
    (row) => row.difference_minor !== 0
  ).length

  const inStatus = (row: (typeof all)[number], which: Show) =>
    which === "ALL" ||
    (which === "OPEN"
      ? row.status !== "FILED" && row.status !== "SETTLED"
      : row.status === which)
  const rows = all.filter(
    (row) =>
      inStatus(row, show) && (taxType === "" || row.tax_type_code === taxType)
  )

  return (
    <PageContent>
      <PageHeader
        crumb="Finance · Tax"
        title="Tax Payables"
        sub="Every tax period: what it owes, what was paid, what is left."
      />

      <CardRow>
        <NumberCard
          label="Tax owed, not yet paid"
          value={payable}
          note="PPh 21, 23, 29, PPN keluaran, PBB"
        />
        <NumberCard
          label="Tax credit not yet used"
          value={credit}
          note="PPh 25 instalments, PPN masukan"
        />
        <NumberCard
          label="Periods off the ledger"
          value={mismatched}
          unit="count"
          tone={mismatched === 0 ? "ok" : "bad"}
          note={
            mismatched === 0
              ? "Every period agrees with the books"
              : "Their balance differs from the tax account"
          }
        />
      </CardRow>

      <div className="mt-6">
        <SubTabs
          tabs={[
            {
              value: "OPEN",
              label: (
                <Count
                  text="Open"
                  n={all.filter((row) => inStatus(row, "OPEN")).length}
                />
              ),
            },
            {
              value: "FILED",
              label: (
                <Count
                  text="Filed"
                  n={all.filter((row) => inStatus(row, "FILED")).length}
                />
              ),
            },
            {
              value: "SETTLED",
              label: (
                <Count
                  text="Settled"
                  n={all.filter((row) => inStatus(row, "SETTLED")).length}
                />
              ),
            },
            { value: "ALL", label: <Count text="All" n={all.length} /> },
          ]}
          value={show}
          onChange={(next) => setShow(next as Show)}
        />
      </div>

      <Toolbar>
        <Select
          value={taxType}
          onChange={setTaxType}
          className="h-control w-56"
          aria-label="Tax"
        >
          <option value="">Every tax</option>
          {(types.data ?? []).map((row) => (
            <option key={row.code} value={row.code}>
              {row.name}
            </option>
          ))}
        </Select>
        <Toolbar.Spacer />
        <span className="text-[0.875rem] text-mute">
          {count(rows.length)} {rows.length === 1 ? "period" : "periods"}
        </span>
      </Toolbar>

      {periods.isPending ? (
        <LoadingState>Reading the tax periods…</LoadingState>
      ) : periods.isError ? (
        <ErrorState error={periods.error} />
      ) : rows.length === 0 ? (
        <EmptyState>
          {all.length === 0
            ? "No tax period has been opened yet."
            : "No period matches these filters."}
        </EmptyState>
      ) : (
        <Grid>
          <thead>
            <tr>
              <Th width="9rem">Period</Th>
              <Th>Tax</Th>
              <Th align="right" width="11rem">
                Owed or credit
              </Th>
              <Th align="right" width="11rem">
                Paid
              </Th>
              <Th align="right" width="11rem">
                Left
              </Th>
              <Th width="9rem">Status</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.period_id}>
                <Td className="text-body">
                  {dateText(
                    new Date(row.period_year, row.period_month - 1, 1),
                    {
                      month: "short",
                      year: "numeric",
                    }
                  )}
                </Td>
                <Td>
                  <span className="block text-ink">{row.tax_type_name}</span>
                  <span className="block text-[0.875rem] text-mute">
                    {row.nature === "CREDIT" ? "Credit" : "Payable"}
                  </span>
                </Td>
                <Td align="right">
                  {money(
                    row.nature === "PAYABLE"
                      ? row.obligation_minor
                      : row.credit_minor
                  )}
                </Td>
                <Td align="right">{money(row.settled_minor)}</Td>
                <Td
                  align="right"
                  className={
                    row.outstanding_minor > 0
                      ? "font-medium text-ink"
                      : "text-mute"
                  }
                >
                  {row.outstanding_minor === 0
                    ? "·"
                    : money(row.outstanding_minor)}
                </Td>
                <Td>
                  <span
                    className={
                      row.status === "SETTLED"
                        ? "text-ok-fg"
                        : row.status === "FILED"
                          ? "text-body"
                          : "text-warn-fg"
                    }
                  >
                    {row.status === "SETTLED"
                      ? "Settled"
                      : row.status === "FILED"
                        ? "Filed"
                        : "Open"}
                  </span>
                </Td>
              </tr>
            ))}
          </tbody>
        </Grid>
      )}
    </PageContent>
  )
}

function Count({ text, n }: { text: string; n: number }) {
  return (
    <span>
      {text}
      <span className="ml-1.5 text-body tabular-nums">{count(n)}</span>
    </span>
  )
}
