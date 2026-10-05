import { useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Plus } from "lucide-react"

import { Button } from "@/components/ui/button"
import { PageHeader } from "@/components/ui/page-header"
import { SubTabs } from "@/components/ui/sub-tabs"
import { InstallSheet } from "@/screens/system/enrolments"
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
type Tab = "servers" | "sync" | "register" | "health" | "incidents"

const TABS: readonly { value: Tab; label: string }[] = [
  { value: "servers", label: "Servers" },
  { value: "sync", label: "Sync" },
  { value: "register", label: "Register" },
  { value: "health", label: "Health" },
  { value: "incidents", label: "Incidents" },
]

export function StoreServers() {
  const [tab, setTab] = useState<Tab>("servers")
  const [installing, setInstalling] = useState(false)

  return (
    <PageContent>
      <PageHeader
        crumb="System"
        title="Store Servers"
        sub="Every shop's own machine: whether it is up, whether data is moving, and what to do about it."
        actions={
          // On the page, not inside one tab: installing a server is the
          // thing somebody opens this page to do on a new store's first day.
          <Button variant="primary" onClick={() => setInstalling(true)}>
            <Plus className="size-4" />
            Install server
          </Button>
        }
      />

      <SubTabs
        tabs={TABS}
        value={tab}
        onChange={(next) => setTab(next as Tab)}
      />

      {/* One question per tab (owner, 2026-09-29): the uptime board and the
          register used to sit one above the other on Servers, two tables of
          the same eleven machines answering different things. */}
      {tab === "servers" && <Monitoring />}
      {tab === "register" && <Nodes embedded />}
      {tab === "health" && <FleetHealth />}
      {tab === "incidents" && <FleetIncidents />}
      {tab === "sync" && <FleetSync />}

      <InstallSheet open={installing} onClose={() => setInstalling(false)} />
    </PageContent>
  )
}
