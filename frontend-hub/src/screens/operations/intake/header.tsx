import { useQuery } from "@tanstack/react-query"

import { DockTools } from "@/components/shell/dock-tools"
import { dockSortOf } from "@/components/ui/data-table"
import { PageHeader } from "@/components/ui/page-header"
import { SubTabs } from "@/components/ui/sub-tabs"
import { dc } from "@/lib/api"
import { useAppNavigate } from "@/lib/navigate"
import { keys } from "@/lib/operations/keys"
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
/// On a phone the tabs are not drawn at the top of the page: the same choice
/// is the status button over the bottom bar, beside the search, where the
/// thumb is (`DockTools`). With store returns open that button also carries
/// the list's own In transit / Received, so nothing is left up at the top.
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
  const inTransit = useQuery({
    queryKey: keys.storeInbound("IN_TRANSIT"),
    queryFn: ({ signal }) => dc.storeInboundList("IN_TRANSIT", signal),
  })
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
  const status =
    tab === "orders"
      ? {
          value: "orders",
          options: [
            { value: "orders", label: "Purchase Orders", count: owed },
            { value: "returns", label: "Store Returns", count: onTheWay },
          ],
        }
      : {
          value: returns?.value ?? "IN_TRANSIT",
          options: [
            { value: "orders", label: "Purchase Orders", count: owed },
            {
              value: "IN_TRANSIT",
              label: "Store Returns · In Transit",
              count: onTheWay,
            },
            { value: "RECEIVED", label: "Store Returns · Received" },
          ],
        }
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
        status={{
          ...status,
          onChange: (next) => {
            if (next === "orders") void navigate("/operations/intake")
            else if (next === "returns")
              void navigate("/operations/intake/returns")
            else returns?.onChange(next as ReturnsStatus)
          },
        }}
      />
    </>
  )
}
