import { useQuery } from "@tanstack/react-query"
import { useMemo } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states"
import { money } from "@/lib/format"
import {
  domainKeys,
  listTaxPeriods,
  listTaxTypes,
  taxReconciliation,
} from "@/lib/queries/finance-domains"
import { Grid, Note, NumberCard, Td, Th } from "@/screens/finance-final/parts"

/// Tax — what is owed, what has been paid in advance, and never the two added
/// together.
///
/// PPh 25 is a CREDIT and PPh 29 is a PAYABLE. They are the same tax and
/// opposite balances, and the subledger refuses to record one against the
/// other. This screen keeps them on separate lines for the same reason: a
/// single "tax" figure would be the netting the accounting refuses.
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

  const rows = useMemo(() => periods.data ?? [], [periods.data])
  const payable = rows
    .filter((row) => row.nature === "PAYABLE")
    .reduce((total, row) => total + row.outstanding_minor, 0)
  const credit = rows
    .filter((row) => row.nature === "CREDIT")
    .reduce((total, row) => total + row.outstanding_minor, 0)
  const mismatched = (control.data ?? []).filter(
    (row) => row.difference_minor !== 0
  ).length

  return (
    <PageContent>
      <PageHeader
        crumb="Finance"
        title="Pajak"
        sub="Per jenis dan per masa. Kredit dan utang tidak pernah dijaringkan."
      />

      <Grid>
        <NumberCard label="Utang pajak belum disetor" value={payable} />
        <NumberCard label="Kredit pajak belum dipakai" value={credit} />
        <NumberCard
          label="Masa yang tidak cocok dengan buku besar"
          value={mismatched}
          tone={mismatched === 0 ? "ok" : "bad"}
        />
      </Grid>

      <Note>
        PPh 25 adalah kredit — uang yang sudah disetor dan bisa diperhitungkan.
        PPh 29 adalah utang. Keduanya pajak penghasilan yang sama dan saldo yang
        berlawanan; subledger menolak mencatat kewajiban pada jenis kredit.
      </Note>

      {types.isPending ? (
        <LoadingState />
      ) : types.isError ? (
        <ErrorState error={types.error} />
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <Th>Jenis</Th>
              <Th>Sifat</Th>
              <Th>Akun (meaning)</Th>
              <Th>Catatan</Th>
            </tr>
          </thead>
          <tbody>
            {(types.data ?? []).map((row) => (
              <tr key={row.code}>
                <Td>{row.name}</Td>
                <Td>
                  <Pill tone={row.nature === "CREDIT" ? "info" : "warn"}>
                    {row.nature === "CREDIT" ? "kredit" : "utang"}
                  </Pill>
                </Td>
                <Td>{row.semantic_key}</Td>
                <Td>{row.note ?? ""}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <PageHeader title="Masa pajak" sub="Terbaru lebih dulu." />
      {periods.isPending ? (
        <LoadingState />
      ) : periods.isError ? (
        <ErrorState error={periods.error} />
      ) : rows.length === 0 ? (
        <EmptyState>Belum ada masa pajak</EmptyState>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <Th>Masa</Th>
              <Th>Jenis</Th>
              <Th align="right">Kewajiban</Th>
              <Th align="right">Kredit</Th>
              <Th align="right">Disetor</Th>
              <Th align="right">Sisa</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.period_id}>
                <Td>
                  {row.period_year}-{String(row.period_month).padStart(2, "0")}
                </Td>
                <Td>{row.tax_type_name}</Td>
                <Td align="right">
                  {row.nature === "PAYABLE" ? money(row.obligation_minor) : "—"}
                </Td>
                <Td align="right">
                  {row.nature === "CREDIT" ? money(row.credit_minor) : "—"}
                </Td>
                <Td align="right">{money(row.settled_minor)}</Td>
                <Td align="right">{money(row.outstanding_minor)}</Td>
                <Td>
                  <Pill
                    tone={
                      row.status === "SETTLED"
                        ? "ok"
                        : row.status === "FILED"
                          ? "info"
                          : "warn"
                    }
                  >
                    {row.status}
                  </Pill>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </PageContent>
  )
}
