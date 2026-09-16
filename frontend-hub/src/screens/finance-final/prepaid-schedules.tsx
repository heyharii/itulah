import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states"
import { money } from "@/lib/format"
import {
  allocatePrepaidMonth,
  domainKeys,
  listPrepaidSchedules,
} from "@/lib/queries/finance-domains"
import { Code, Grid, Note, NumberCard, Td, Th } from "@/screens/finance-final/parts"

/// Prepaid schedules — what was paid for in advance, and the months it belongs
/// to.
///
/// The screen does not create the prepayment: the bill did that, and this is
/// the plan for taking it back out. One button posts a month for every schedule
/// that covers it, and pressing it twice is safe — the second press reports what
/// it found rather than posting again.
export function PrepaidSchedules() {
  const client = useQueryClient()
  const now = new Date()
  const [month, setMonth] = useState({
    year: now.getFullYear(),
    month: now.getMonth() + 1,
  })
  const [status, setStatus] = useState<string | undefined>("ACTIVE")

  const schedules = useQuery({
    queryKey: domainKeys.prepaidSchedules(undefined, status),
    queryFn: ({ signal }) => listPrepaidSchedules(signal, { status }),
  })

  const allocate = useMutation({
    mutationFn: () => allocatePrepaidMonth({ year: month.year, month: month.month }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["finance"] })
    },
  })

  const rows = useMemo(() => schedules.data ?? [], [schedules.data])
  const remaining = rows.reduce((total, row) => total + row.remaining_minor, 0)
  const due = rows.filter((row) => {
    const start = row.start_period.slice(0, 7)
    const end = row.end_period.slice(0, 7)
    const asked = `${month.year}-${String(month.month).padStart(2, "0")}`
    return row.status === "ACTIVE" && start <= asked && asked <= end
  }).length

  return (
    <PageContent>
      <PageHeader
        crumb="Finance"
        title="Biaya dibayar dimuka"
        sub="Jadwal, dan bulan-bulan yang sudah diambil dari padanya."
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
              disabled={allocate.isPending}
              onClick={() => allocate.mutate()}
            >
              Alokasikan bulan ini
            </button>
          </div>
        }
      />

      <Grid>
        <NumberCard label="Jadwal berjalan" value={rows.length} />
        <NumberCard label="Sisa belum dibebankan" value={remaining} />
        <NumberCard
          label="Menunggu bulan dipilih"
          value={due}
          tone={due === 0 ? "ok" : "warn"}
        />
      </Grid>

      {allocate.data === undefined ? null : (
        <Note>
          {allocate.data.posted} jadwal diposting, {allocate.data.already_posted}{" "}
          sudah ada sebelumnya, {allocate.data.completed} selesai. Total{" "}
          {money(allocate.data.amount_minor)}.
        </Note>
      )}

      <div className="flex gap-2">
        {["ACTIVE", "COMPLETED", "CANCELLED", undefined].map((option) => (
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
        ))}
      </div>

      {schedules.isPending ? (
        <LoadingState />
      ) : schedules.isError ? (
        <ErrorState error={schedules.error} />
      ) : rows.length === 0 ? (
        <EmptyState>Belum ada jadwal</EmptyState>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <Th>Nomor</Th>
              <Th>Unit</Th>
              <Th>Akun</Th>
              <Th>Periode</Th>
              <Th align="right">Nilai</Th>
              <Th align="right">Sudah dibebankan</Th>
              <Th align="right">Sisa</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.schedule_id}>
                <Td>
                  <Code>{row.schedule_number}</Code>
                </Td>
                <Td>{row.site_id}</Td>
                <Td>
                  {row.prepaid_account_name}
                  <div className="text-mute text-[0.6875rem]">
                    → {row.expense_account_name}
                  </div>
                </Td>
                <Td>
                  {row.start_period.slice(0, 7)} — {row.end_period.slice(0, 7)}
                  <div className="text-mute text-[0.6875rem]">
                    {row.periods_allocated}/{row.periods} bulan
                  </div>
                </Td>
                <Td align="right">{money(row.amount_minor)}</Td>
                <Td align="right">{money(row.allocated_minor)}</Td>
                <Td align="right">{money(row.remaining_minor)}</Td>
                <Td>
                  <Pill
                    tone={
                      row.status === "ACTIVE"
                        ? "info"
                        : row.status === "COMPLETED"
                          ? "ok"
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
