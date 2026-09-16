import { useQuery } from "@tanstack/react-query"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states"
import { money } from "@/lib/format"
import { advanceControl, domainKeys, listAdvances } from "@/lib/queries/finance-domains"
import { Code, Grid, Note, NumberCard, Td, Th } from "@/screens/finance-final/parts"

/// Advances — money out with somebody, and how old it is.
///
/// Ageing is derived from the day the money left, not stored, so it cannot
/// disagree with the balance beside it.
export function Advances() {
  const [status, setStatus] = useState<string | undefined>(undefined)
  const advances = useQuery({
    queryKey: domainKeys.advances(undefined, status),
    queryFn: ({ signal }) => listAdvances(signal, { status }),
  })
  const control = useQuery({
    queryKey: domainKeys.advanceControl(),
    queryFn: ({ signal }) => advanceControl(signal),
  })

  const rows = useMemo(() => advances.data ?? [], [advances.data])
  const outstanding = rows
    .filter((row) => row.status === "PAID" || row.status === "PARTIALLY_SETTLED")
    .reduce((total, row) => total + row.outstanding_minor, 0)
  const old = rows.filter(
    (row) =>
      (row.status === "PAID" || row.status === "PARTIALLY_SETTLED") &&
      (row.age_days ?? 0) > 30
  )
  const difference = (control.data ?? []).reduce(
    (total, row) => total + row.difference_minor,
    0
  )

  return (
    <PageContent>
      <PageHeader
        crumb="Finance"
        title="Uang muka"
        sub="Perjalanan, kontraktor, dan keperluan yang belum ada tagihannya."
      />

      <Grid>
        <NumberCard label="Masih di tangan orang" value={outstanding} />
        <NumberCard
          label="Lebih dari 30 hari"
          value={old.length}
          tone={old.length === 0 ? "ok" : "warn"}
        />
        <NumberCard
          label="Selisih dengan buku besar"
          value={difference}
          tone={difference === 0 ? "ok" : "bad"}
        />
      </Grid>

      <Note>
        Uang muka yang sudah dibayar tidak bisa dibatalkan — ia dipertanggung-
        jawabkan dengan bukti, atau uangnya dikembalikan. Keduanya mengurangi
        saldo lewat jurnalnya sendiri.
      </Note>

      <div className="flex gap-2">
        {[undefined, "REQUESTED", "APPROVED", "PAID", "PARTIALLY_SETTLED", "SETTLED"].map(
          (option) => (
            <button
              key={option ?? "ALL"}
              type="button"
              className={
                status === option
                  ? "rounded-control border border-accent px-2 py-1 text-sm text-accent"
                  : "rounded-control border border-hairline px-2 py-1 text-sm"
              }
              onClick={() => setStatus(option)}
            >
              {option ?? "Semua"}
            </button>
          )
        )}
      </div>

      {advances.isPending ? (
        <LoadingState />
      ) : advances.isError ? (
        <ErrorState error={advances.error} />
      ) : rows.length === 0 ? (
        <EmptyState>Belum ada uang muka</EmptyState>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <Th>Nomor</Th>
              <Th>Kepada</Th>
              <Th>Keperluan</Th>
              <Th>Unit</Th>
              <Th align="right">Nilai</Th>
              <Th align="right">Sisa</Th>
              <Th align="right">Umur</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.advance_id}>
                <Td>
                  <Code>{row.advance_number}</Code>
                </Td>
                <Td>
                  {row.party_label}
                  <div className="text-mute text-[0.6875rem]">{row.party_kind}</div>
                </Td>
                <Td>{row.purpose}</Td>
                <Td>{row.site_id}</Td>
                <Td align="right">{money(row.amount_minor)}</Td>
                <Td align="right">{money(row.outstanding_minor)}</Td>
                <Td align="right">
                  {row.age_days === null ? "—" : `${row.age_days} hari`}
                </Td>
                <Td>
                  <Pill
                    tone={
                      row.status === "SETTLED"
                        ? "ok"
                        : row.status === "CANCELLED"
                          ? "neutral"
                          : (row.age_days ?? 0) > 30
                            ? "warn"
                            : "info"
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
