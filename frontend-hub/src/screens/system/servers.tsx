import { useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { PageHeader } from "@/components/ui/page-header"
import { SubTabs } from "@/components/ui/sub-tabs"
import { FleetHealth } from "@/screens/system/fleet-health"
import { FleetIncidents } from "@/screens/system/fleet-incidents"
import { FleetSync } from "@/screens/system/fleet-sync"
import { Monitoring } from "@/screens/system/monitoring"
import { Nodes } from "@/screens/system/nodes"

/// Store servers — one page, four tabs, where five rows used to stand.
///
/// The owner's complaint was specific: "Nodes" read as the org chart rather
/// than the machines, and a register, an uptime board, a health board, an
/// incident log and a sync console are all questions about the SAME thing —
/// the shop's own server — asked five different ways. So they are one row
/// now, and which question is showing is a tab rather than a URL.
///
/// Every tab is still its own file, doing its own fetching on its own
/// schedule. "Servers" is the register (`<Nodes embedded>`) plus the up/down
/// board (`<Monitoring>`) above it — the owner's tab list named four
/// ("Servers · Health · Incidents · Sync"), and Monitoring is a fact about the
/// servers as a fleet rather than a fifth question of its own, so it opens
/// the first tab instead of asking for one.
///
/// Health, Incidents and Sync (0640, 28 Sep 2026) are the fleet status page —
/// `screens/system/fleet-health.tsx`, `fleet-incidents.tsx`, `fleet-sync.tsx`
/// — reading `GET /api/v1/fleet/*` (`backend/src/cloud/postgres/fleet_status.rs`)
/// rather than the older per-node `/sync/health` and `/sync/fleet` boards
/// those three tabs used to show. Those older screens (`health.tsx`,
/// `sync.tsx`, `monitoring.tsx`'s `Incidents`) are left in the tree unused
/// rather than deleted here, in case something else still reads them.
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
      {tab === "health" && <FleetHealth />}
      {tab === "incidents" && <FleetIncidents />}
      {tab === "sync" && <FleetSync />}
    </PageContent>
  )
}
