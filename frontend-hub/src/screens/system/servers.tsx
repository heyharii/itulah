import { useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { PageHeader } from "@/components/ui/page-header"
import { SubTabs } from "@/components/ui/sub-tabs"
import { Health } from "@/screens/system/health"
import { Incidents, Monitoring } from "@/screens/system/monitoring"
import { Nodes } from "@/screens/system/nodes"
import { SyncLane } from "@/screens/system/sync"

/// Store servers — one page, four tabs, where five rows used to stand.
///
/// The owner's complaint was specific: "Nodes" read as the org chart rather
/// than the machines, and a register, an uptime board, a health board, an
/// incident log and a sync console are all questions about the SAME thing —
/// the shop's own server — asked five different ways. So they are one row
/// now, and which question is showing is a tab rather than a URL.
///
/// Every tab is still its own file, doing its own fetching on its own
/// schedule: `<Nodes embedded>`, `<Health embedded>` and the rest are the same
/// components the standalone pages used to mount, just asked to leave out
/// their own `PageHeader` and fold their header actions into a plain row.
/// Nothing about how any of them talks to the server changed.
///
/// "Servers" also carries `<Monitoring>` — the up/down board — above the
/// register: the owner's tab list named four ("Servers · Health · Incidents ·
/// Sync"), and Monitoring is a fact about the servers as a fleet rather than a
/// fifth question of its own, so it opens the first tab instead of asking for
/// one.
type Tab = "servers" | "health" | "incidents" | "sync"

const TABS: readonly { value: Tab; label: string }[] = [
  { value: "servers", label: "Servers" },
  { value: "health", label: "Health" },
  { value: "incidents", label: "Incidents" },
  { value: "sync", label: "Sync" },
]

export function StoreServers() {
  const [tab, setTab] = useState<Tab>("servers")

  return (
    <PageContent>
      <PageHeader
        crumb="System"
        title="Store servers"
        sub="Every shop's own machine: whether it is up, whether data is moving, and what to do about it."
      />

      <SubTabs tabs={TABS} value={tab} onChange={(next) => setTab(next as Tab)} />

      {tab === "servers" && (
        <>
          <Monitoring />
          <div className="mt-5">
            <Nodes embedded />
          </div>
        </>
      )}
      {tab === "health" && <Health embedded />}
      {tab === "incidents" && <Incidents embedded />}
      {tab === "sync" && <SyncLane embedded />}
    </PageContent>
  )
}
