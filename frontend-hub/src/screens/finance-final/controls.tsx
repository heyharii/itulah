import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states"
import { money } from "@/lib/format"
import {
  closeReadiness,
  domainKeys,
  financeControls,
  softCloseMonth,
} from "@/lib/queries/finance-domains"
import { Grid, Note, NumberCard, Td, Th } from "@/screens/finance-final/parts"

/// Controls & close — every subledger beside the ledger it controls, and what
/// stands between this month and being shut.
///
/// # Why one screen and not eleven
///
/// The question is the same one for every domain: does what we recorded agree
/// with what posted. Eleven screens would make a reader learn eleven layouts to
/// ask it once, and the month-end answer — "these three do not agree" — would
/// be assembled in somebody's head from eleven tabs.
///
/// # Why a difference is not always a fault
///
/// A cancelled prepaid schedule leaves a balance in the ledger nobody is
/// amortising any more. That is a real difference and a real decision, and the
/// screen says so rather than hiding it: `covered = false` means nothing can
/// answer for the domain yet, which is a different statement from zero.
export function FinanceControls() {
  const client = useQueryClient()
  const now = new Date()
  const [month, setMonth] = useState({
    year: now.getFullYear(),
    month: now.getMonth() + 1,
  })

  const controls = useQuery({
    queryKey: domainKeys.controls(),
    queryFn: ({ signal }) => financeControls(signal),
  })
  const readiness = useQuery({
    queryKey: domainKeys.closeReadiness(month.year, month.month),
    queryFn: ({ signal }) => closeReadiness(month.year, month.month, signal),
  })

  const soft = useMutation({
    mutationFn: () => softCloseMonth({ year: month.year, month: month.month }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["finance"] })
    },
  })

  const rows = useMemo(() => controls.data ?? [], [controls.data])
  const disagreeing = rows.filter((row) => row.covered && row.difference_minor !== 0)
  const uncovered = rows.filter((row) => !row.covered)
  const checks = readiness.data?.checks ?? []

  return (
    <PageContent>
      <PageHeader
        crumb="Finance"
        title="Kontrol & tutup bulan"
        sub="Setiap subledger di samping buku besar yang dikendalikannya."
      />

      <Grid>
        <NumberCard
          label="Kontrol tidak cocok"
          value={disagreeing.length}
          tone={disagreeing.length === 0 ? "ok" : "bad"}
          note="selisih antara buku besar dan subledger"
        />
        <NumberCard
          label="Belum ada pembanding"
          value={uncovered.length}
          tone={uncovered.length === 0 ? undefined : "warn"}
          note="domain yang belum bisa direkonsiliasi"
        />
        <NumberCard
          label="Penghalang tutup bulan"
          value={readiness.data?.blockers ?? null}
          tone={(readiness.data?.blockers ?? 0) === 0 ? "ok" : "bad"}
          note={`status periode: ${readiness.data?.period_status ?? "—"}`}
        />
      </Grid>

      {controls.isPending ? (
        <LoadingState />
      ) : controls.isError ? (
        <ErrorState error={controls.error} />
      ) : rows.length === 0 ? (
        <EmptyState>Belum ada yang bisa dikontrol</EmptyState>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <Th>Domain</Th>
              <Th align="right">Buku besar</Th>
              <Th align="right">Subledger</Th>
              <Th align="right">Selisih</Th>
              <Th align="right">Terbuka</Th>
              <Th>Catatan</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.domain}>
                <Td>
                  {row.label}
                  {row.covered ? null : (
                    <Pill tone="warn">belum terjangkau</Pill>
                  )}
                </Td>
                <Td align="right">{money(row.gl_minor)}</Td>
                <Td align="right">
                  {row.covered ? money(row.subledger_minor) : "—"}
                </Td>
                <Td
                  align="right"
                  className={
                    row.covered && row.difference_minor !== 0 ? "text-bad-fg" : undefined
                  }
                >
                  {row.covered ? money(row.difference_minor) : "—"}
                </Td>
                <Td align="right">{row.unmatched}</Td>
                <Td>{row.note ?? ""}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <PageHeader
        title="Tutup bulan"
        sub={`${month.year}-${String(month.month).padStart(2, "0")}`}
        actions={
          <div className="flex items-center gap-2">
            <input
              type="month"
              className="rounded-control border border-hairline bg-canvas px-2 py-1 text-sm"
              value={`${month.year}-${String(month.month).padStart(2, "0")}`}
              onChange={(event) => {
                const [year, monthPart] = event.target.value.split("-")
                if (year !== undefined && monthPart !== undefined) {
                  setMonth({ year: Number(year), month: Number(monthPart) })
                }
              }}
            />
            <button
              type="button"
              className="rounded-control border border-hairline px-3 py-1 text-sm disabled:opacity-50"
              disabled={soft.isPending || readiness.data?.period_status !== "OPEN"}
              onClick={() => soft.mutate()}
            >
              Tutup untuk kasir
            </button>
          </div>
        }
      />

      <Note>
        Tutup lunak menutup bulan bagi kasir dan toko, dan membiarkannya terbuka
        untuk penyesuaian, penyusutan, alokasi, pajak, payroll dan pembalikan.
        Daftar itu ada di trigger 0051, bukan di layar ini.
      </Note>

      {readiness.isPending ? (
        <LoadingState />
      ) : readiness.isError ? (
        <ErrorState error={readiness.error} />
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <Th>Pemeriksaan</Th>
              <Th>Status</Th>
              <Th>Keterangan</Th>
            </tr>
          </thead>
          <tbody>
            {checks.map((row) => (
              <tr key={row.code}>
                <Td>{row.label}</Td>
                <Td>
                  <Pill
                    tone={
                      row.status === "OK"
                        ? "ok"
                        : row.status === "BLOCKER"
                          ? "bad"
                          : "warn"
                    }
                  >
                    {row.status}
                  </Pill>
                </Td>
                <Td>{row.detail}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </PageContent>
  )
}
