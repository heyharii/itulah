import { useQuery } from "@tanstack/react-query"

import { PageHeader } from "@/components/ui/page-header"
import { SubTabs } from "@/components/ui/sub-tabs"
import { dc } from "@/lib/api"
import { useAppNavigate } from "@/lib/navigate"
import { keys } from "@/lib/operations/keys"
import { useWaiting } from "@/lib/operations/waiting"

/// Receiving's title and its two tabs — each with what is waiting in it.
export function IntakeHeader({ tab }: { tab: "orders" | "returns" }) {
  const navigate = useAppNavigate()
  const owed = useWaiting().owed
  // The same query the Store returns tab reads, so the number never lags it.
  const inTransit = useQuery({
    queryKey: keys.storeInbound("IN_TRANSIT"),
    queryFn: ({ signal }) => dc.storeInboundList("IN_TRANSIT", signal),
  })
  const tabs = [
    {
      value: "orders",
      label: `Purchase orders${owed > 0 ? ` · ${owed}` : ""}`,
      path: "/operations/intake",
    },
    {
      value: "returns",
      label: `Store returns${(inTransit.data?.length ?? 0) > 0 ? ` · ${inTransit.data?.length}` : ""}`,
      path: "/operations/intake/returns",
    },
  ] as const
  return (
    <>
      <PageHeader title="Receiving" />
      <SubTabs
        tabs={tabs}
        value={tab}
        onChange={(next) => {
          const to = tabs.find((one) => one.value === next)
          if (to) void navigate(to.path)
        }}
      />
    </>
  )
}
