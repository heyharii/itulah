import { useQuery } from "@tanstack/react-query"

import { DockTools, type DockStatus } from "@/components/shell/dock-tools"
import { dockSortOf } from "@/components/ui/data-table"
import { PageHeader } from "@/components/ui/page-header"
import { storeInboundQuery } from "@/lib/operations/queries"
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

/// The head of Receiving PO and Receiving Return: the title, and the dock.
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
  stages,
}: {
  tab: "orders" | "returns"
  search: ReturnType<typeof useIntakeSearch>
  searchLabel: string
  /// The list's table: what it can be sorted by is offered in the dock.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  table: any
  /// Store returns only: which of its two lists is open.
  returns?: { value: ReturnsStatus; onChange: (next: ReturnsStatus) => void }
  /// Purchase orders only: the stages as the dock's status on a phone, where
  /// the tabs under the title are not drawn.
  stages?: DockStatus
}) {
  // The same query the Receiving Return menu counts, so the number never lags it.
  const inTransit = useQuery(storeInboundQuery("IN_TRANSIT"))
  const onTheWay = inTransit.data?.length ?? 0
  // Purchase orders carry their stages (to count, in review, completed — owner,
  // 2026-10-16); store returns have two: on the way, and counted.
  const status: DockStatus | undefined =
    tab === "orders"
      ? stages
      : returns !== undefined
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
      {/* Two menus now, each its own title (owner, 2026-10-15) — no tabs. */}
      <PageHeader
        title={tab === "orders" ? "Receiving PO" : "Receiving Return"}
      />
      <DockTools
        search={{ ...search, label: searchLabel }}
        sort={dockSortOf(table)}
        status={status}
      />
    </>
  )
}
