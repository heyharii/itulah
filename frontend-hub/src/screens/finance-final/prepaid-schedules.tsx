import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import {
  EmptyState,
  ErrorState,
  LoadMore,
  LoadingState,
} from "@/components/ui/states"
import { money } from "@/lib/format"
import {
  allocatePrepaidMonth,
  domainKeys,
  prepaidSchedulePage,
} from "@/lib/queries/finance-domains"
import {
  Code,
  Grid,
  Note,
  NumberCard,
  Td,
  Th,
} from "@/screens/finance-final/parts"

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

  const asked = `${month.year}-${String(month.month).padStart(2, "0")}`

  // A page at a time, newest first. The cards read the server's figures over
  // every schedule the filter matches, never a sum of the pages loaded.
  const schedules = useInfiniteQuery({
    queryKey: [...domainKeys.prepaidSchedules(undefined, status), "pages"],
    queryFn: ({ pageParam, signal }) =>
      prepaidSchedulePage({ status, cursor: pageParam, limit: 100 }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    placeholderData: (previous) => previous,
  })
  // How many are due in the chosen month, asked separately so picking a month
  // re-asks one small question rather than reloading the list.
  const dueIn = useQuery({
    queryKey: [...domainKeys.prepaidSchedules(undefined, status), "due", asked],
    queryFn: ({ signal }) =>
      prepaidSchedulePage({ status, period: `${asked}-01`, limit: 1 }, signal),
  })

  const allocate = useMutation({
    mutationFn: () =>
      allocatePrepaidMonth({ year: month.year, month: month.month }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["finance"] })
    },
  })

  const rows = useMemo(
    () => schedules.data?.pages.flatMap((page) => page.rows) ?? [],
    [schedules.data]
  )
  const head = schedules.data?.pages[0]
  const remaining = head?.remaining_minor ?? null
  const due = dueIn.data?.due_in_period ?? null

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
        <NumberCard label="Jadwal berjalan" value={head?.total ?? null} />
        <NumberCard label="Sisa belum dibebankan" value={remaining} />
        <NumberCard
          label="Menunggu bulan dipilih"
          value={due}
          tone={due === null ? undefined : due === 0 ? "ok" : "warn"}
        />
      </Grid>

      {allocate.data === undefined ? null : (
        <Note>
          {allocate.data.posted} jadwal diposting,{" "}
          {allocate.data.already_posted} sudah ada sebelumnya,{" "}
          {allocate.data.completed} selesai. Total{" "}
          {money(allocate.data.amount_minor)}.
        </Note>
      )}

      <div className="flex flex-wrap gap-2">
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
      ) : schedules.isError && schedules.data === undefined ? (
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
                  <div className="text-[0.875rem] text-mute">
                    → {row.expense_account_name}
                  </div>
                </Td>
                <Td>
                  {row.start_period.slice(0, 7)} — {row.end_period.slice(0, 7)}
                  <div className="text-[0.875rem] text-mute">
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
      <LoadMore query={schedules} />
    </PageContent>
  )
}
