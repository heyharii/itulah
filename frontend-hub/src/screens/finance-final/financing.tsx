import { useQuery } from "@tanstack/react-query"
import { useMemo } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states"
import { money } from "@/lib/format"
import { domainKeys, listFacilities, listPrincipals } from "@/lib/queries/finance-domains"
import { Code, Grid, Note, NumberCard, Td, Th } from "@/screens/finance-final/parts"

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
  const current = rows.reduce((total, row) => total + row.current_portion_minor, 0)
  const equity = (owners.data ?? []).reduce((total, row) => total + row.equity_minor, 0)

  return (
    <PageContent>
      <PageHeader
        crumb="Finance"
        title="Pinjaman & pemilik"
        sub="Fasilitas yang berjalan, dan modal yang masuk atau ditarik."
      />

      <Grid>
        <NumberCard label="Pokok belum dibayar" value={outstanding} />
        <NumberCard
          label="Jatuh tempo dalam setahun"
          value={current}
          note="bagian lancar, dihitung dari tanggal hari ini"
        />
        <NumberCard label="Modal pemilik" value={equity} />
      </Grid>

      <Note>
        Jadwal angsuran datang dari kontrak, bukan dari rumus amortisasi di sini.
        Yang ditegakkan hanyalah bahwa jadwalnya melunasi pinjamannya.
      </Note>

      {facilities.isPending ? (
        <LoadingState />
      ) : facilities.isError ? (
        <ErrorState error={facilities.error} />
      ) : rows.length === 0 ? (
        <EmptyState>Belum ada fasilitas — Kontrak pinjaman dan leasing dicatat di sini setelah datanya ada.</EmptyState>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <Th>Nomor</Th>
              <Th>Jenis</Th>
              <Th>Pemberi</Th>
              <Th align="right">Pokok</Th>
              <Th align="right">Sisa pokok</Th>
              <Th align="right">Bunga dibayar</Th>
              <Th>Jatuh tempo</Th>
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
                  <Pill tone={row.status === "ACTIVE" ? "info" : "ok"}>{row.status}</Pill>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <PageHeader title="Pemilik & investor" sub="Modal, prive, dan pinjaman dari pemilik." />
      {owners.isPending ? (
        <LoadingState />
      ) : owners.isError ? (
        <ErrorState error={owners.error} />
      ) : (owners.data ?? []).length === 0 ? (
        <EmptyState>Belum ada pemilik terdaftar</EmptyState>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <Th>Kode</Th>
              <Th>Nama</Th>
              <Th align="right">Modal disetor</Th>
              <Th align="right">Prive</Th>
              <Th align="right">Modal bersih</Th>
              <Th align="right">Pinjaman ke perusahaan</Th>
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
