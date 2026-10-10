import { useQuery } from "@tanstack/react-query"

import { DockTools } from "@/components/shell/dock-tools"
import { dockSortOf } from "@/components/ui/data-table"
import { PageHeader } from "@/components/ui/page-header"
import { SubTabs } from "@/components/ui/sub-tabs"
import { useAppNavigate } from "@/lib/navigate"
import { storeInboundQuery } from "@/lib/operations/queries"
import { useWaiting } from "@/lib/operations/waiting"
import { useSheet } from "@/lib/sheets"

/// What the two Receiving lists are searched by: one `q` in the URL, so a
/// reload or a shared link keeps it, read here and filtered by each list.
export function useIntakeSearch() {
  const search = useSheet("q")
  const value = search.value ?? ""
  return {
    value,
    /// What the rows are compared with: trimmed, lower case.
    needle: value.trim().toLowerCase(),
    onChange: (next: string) => (next ? search.open(next) : search.close()),
  }
}

/// Which list of store returns is on show.
export type ReturnsStatus = "IN_TRANSIT" | "RECEIVED"

/// Receiving's title and its two tabs — each with what is waiting in it.
///
/// On a phone the tabs are not drawn at the top of the page, and there is no
/// status button for the orders (see `status` below); with store returns open
/// the button over the bottom bar carries the list's own In transit / Received.
export function IntakeHeader({
  tab,
  search,
  searchLabel,
  table,
  returns,
}: {
  tab: "orders" | "returns"
  search: ReturnType<typeof useIntakeSearch>
  searchLabel: string
  /// The list's table: what it can be sorted by is offered in the dock.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  table: any
  /// Store returns only: which of its two lists is open.
  returns?: { value: ReturnsStatus; onChange: (next: ReturnsStatus) => void }
}) {
  const navigate = useAppNavigate()
  const owed = useWaiting().owed
  // The same query the Store returns tab reads, so the number never lags it.
  const inTransit = useQuery(storeInboundQuery("IN_TRANSIT"))
  const onTheWay = inTransit.data?.length ?? 0
  const tabs = [
    {
      value: "orders",
      label: `Purchase orders${owed > 0 ? ` · ${owed}` : ""}`,
      path: "/operations/intake",
    },
    {
      value: "returns",
      label: `Store returns${onTheWay > 0 ? ` · ${onTheWay}` : ""}`,
      path: "/operations/intake/returns",
    },
  ] as const
  // Purchase orders have no status — an order is owed a count or it is not on
  // the list — so there is no chip over the bottom bar for them (owner,
  // 2026-10-06). Store returns have two real ones: on the way, and counted.
  const status =
    tab === "returns" && returns !== undefined
      ? {
          value: returns.value,
          options: [
            {
              value: "IN_TRANSIT",
              label: "In Transit",
              count: onTheWay,
            },
            { value: "RECEIVED", label: "Received" },
          ],
          onChange: (next: string) => returns.onChange(next as ReturnsStatus),
        }
      : undefined
  return (
    <>
      <PageHeader title="Receiving" />
      <SubTabs
        className="max-md:hidden"
        tabs={tabs}
        value={tab}
        onChange={(next) => {
          const to = tabs.find((one) => one.value === next)
          if (to) void navigate(to.path)
        }}
      />
      <DockTools
        search={{ ...search, label: searchLabel }}
        sort={dockSortOf(table)}
        status={status}
      />
    </>
  )
}
