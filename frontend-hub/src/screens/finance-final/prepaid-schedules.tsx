import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Fab } from "@/components/ui/fab"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { PageHeader } from "@/components/ui/page-header"
import { BottomSheet } from "@/components/ui/picker-sheet"
import { Pill } from "@/components/ui/pill"
import {
  EmptyState,
  ErrorState,
  LoadMore,
  LoadingState,
} from "@/components/ui/states"
import { SubTabs } from "@/components/ui/sub-tabs"
import { count, money } from "@/lib/format"
import { useLayout } from "@/lib/layout"
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
import { PhoneCard, PhoneList } from "@/components/ui/phone-cards"
import { FactsSheet } from "@/screens/finance/phone-parts"
import type { PrepaidSchedule } from "@itulah/contract"

/// Prepaid schedules — what was paid for in advance, and the months it belongs
/// to.
///
/// The screen does not create the prepayment: the bill did that, and this is
/// the plan for taking it back out. One button posts a month for every schedule
/// that covers it, and pressing it twice is safe — the second press reports what
/// it found rather than posting again.
export function PrepaidSchedules() {
  const phone = useLayout() === "phone"
  /// The phone's "allocate a month" sheet, the dock's + opens it.
  const [allocating, setAllocating] = useState(false)
  const [shown, setShown] = useState<PrepaidSchedule | null>(null)
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
      setAllocating(false)
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
        title="Prepaid Expenses"
        sub="Schedules, and the months already taken from each."
        // On a phone choosing the month and posting it is the dock's + and
        // the sheet it opens.
        actions={
          phone ? undefined : (
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
                Allocate this month
              </button>
            </div>
          )
        }
      />

      {phone ? (
        <>
          <Fab
            label="Allocate this month"
            onClick={() => setAllocating(true)}
          />
          <BottomSheet
            open={allocating}
            onOpenChange={setAllocating}
            title="Allocate this month"
          >
            <div className="flex flex-col gap-3 px-4 pb-4">
              <input
                type="month"
                aria-label="Month"
                className="h-11 w-full rounded-inner border border-hairline-2 bg-canvas px-3 text-[0.9375rem]"
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
                className="h-11 rounded-inner bg-cta px-4 text-[0.9375rem] font-semibold text-cta-fg disabled:opacity-50"
                disabled={allocate.isPending}
                onClick={() => allocate.mutate()}
              >
                Allocate this month
              </button>
            </div>
          </BottomSheet>
          <KpiStrip>
            <Kpi label="Running schedules" value={count(head?.total ?? null)} />
            <Kpi label="Left to expense" value={money(remaining)} />
            <Kpi label="Waiting in the chosen month" value={count(due)} />
          </KpiStrip>
        </>
      ) : (
        <Grid>
          <NumberCard label="Running schedules" value={head?.total ?? null} />
          <NumberCard label="Left to expense" value={remaining} />
          <NumberCard
            label="Waiting in the chosen month"
            value={due}
            tone={due === null ? undefined : due === 0 ? "ok" : "warn"}
          />
        </Grid>
      )}

      {allocate.data === undefined ? null : (
        <Note>
          {allocate.data.posted} schedules posted,{" "}
          {allocate.data.already_posted} already there,{" "}
          {allocate.data.completed} completed. Total{" "}
          {money(allocate.data.amount_minor)}.
        </Note>
      )}

      {phone && (
        // The status is the dock's button on a phone.
        <SubTabs
          tabs={[
            { value: "ACTIVE", label: "ACTIVE" },
            { value: "COMPLETED", label: "COMPLETED" },
            { value: "CANCELLED", label: "CANCELLED" },
            { value: "ALL", label: "All" },
          ]}
          value={status ?? "ALL"}
          onChange={(next) => setStatus(next === "ALL" ? undefined : next)}
        />
      )}

      <div className="flex flex-wrap gap-2 max-md:hidden">
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
            {option ?? "All"}
          </button>
        ))}
      </div>

      {schedules.isPending ? (
        <LoadingState />
      ) : schedules.isError && schedules.data === undefined ? (
        <ErrorState error={schedules.error} />
      ) : rows.length === 0 ? (
        <EmptyState>No schedules yet</EmptyState>
      ) : phone ? (
        <>
          <PhoneList>
            {rows.map((row) => (
              <PhoneCard
                key={row.schedule_id}
                title={row.prepaid_account_name}
                line={
                  <>
                    <div>→ {row.expense_account_name}</div>
                    <div className="font-mono">{row.schedule_number}</div>
                  </>
                }
                lead={money(row.remaining_minor)}
                caption="remaining"
                foot={
                  <span className="tabular-nums">
                    {row.start_period.slice(0, 7)} —{" "}
                    {row.end_period.slice(0, 7)} · {row.periods_allocated}/
                    {row.periods} months
                  </span>
                }
                action={
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
                }
                onOpen={() => setShown(row)}
              />
            ))}
          </PhoneList>
          <FactsSheet
            open={shown !== null}
            onClose={() => setShown(null)}
            title={shown?.prepaid_account_name ?? ""}
            id={shown?.schedule_number}
            caption={
              shown === null ? undefined : `→ ${shown.expense_account_name}`
            }
            facts={
              shown === null
                ? []
                : [
                    { label: "Unit", value: shown.site_id },
                    {
                      label: "Period",
                      value: `${shown.start_period.slice(0, 7)} — ${shown.end_period.slice(0, 7)}`,
                    },
                    {
                      label: "Months",
                      value: `${shown.periods_allocated}/${shown.periods}`,
                    },
                    { label: "Value", value: money(shown.amount_minor) },
                    {
                      label: "Already Expensed",
                      value: money(shown.allocated_minor),
                    },
                    { label: "Remaining", value: money(shown.remaining_minor) },
                    { label: "Status", value: shown.status },
                  ]
            }
          />
        </>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <Th>Number</Th>
              <Th>Unit</Th>
              <Th>Account</Th>
              <Th>Period</Th>
              <Th align="right">Value</Th>
              <Th align="right">Already Expensed</Th>
              <Th align="right">Remaining</Th>
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
                    {row.periods_allocated}/{row.periods} months
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
