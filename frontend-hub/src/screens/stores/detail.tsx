import { useQuery } from "@tanstack/react-query"
import { useParams } from "@tanstack/react-router"
import { useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { EmptyState } from "@/components/ui/states"
import { SubTabs } from "@/components/ui/sub-tabs"
import { storeDetail, storesKeys } from "@/lib/queries/stores"
import { queryState } from "@/lib/query-state"
import { ActivityTab } from "@/screens/stores/actions"
import { DevicesTab } from "@/screens/stores/devices-tab"
import {
  PaymentsTab,
  StockTab,
  TeamTab,
  FacilitiesTab,
} from "@/screens/stores/misc-tabs"
import { OverviewTab } from "@/screens/stores/overview-tab"
import { ServerTab } from "@/screens/stores/server-tab"
import { storeStatusLabel, storeStatusTone } from "@/screens/stores/shared"

const TABS = [
  { value: "overview", label: "Overview" },
  { value: "server", label: "Server" },
  { value: "devices", label: "Devices" },
  { value: "activity", label: "Activity" },
  { value: "team", label: "Team" },
  { value: "payments", label: "Payments" },
  { value: "stock", label: "Stock" },
  { value: "facilities", label: "Facilities" },
] as const

type Tab = (typeof TABS)[number]["value"]

/// One store, one page, in tabs — the mock's §4 brought together: Overview's
/// checklist and the Open store button, the server's install/approve dance,
/// the devices at this site, the team, the payments this shop takes, what is
/// moving in or out of its stock, and its facilities record.
///
/// `unit` is a real path parameter, `/stores/$unit` — the one route in this
/// app that is not addressed as a sheet over a list. Every OTHER record here
/// opens as a sheet on the screen that lists it (see `lib/sheets.ts`), but a
/// store has seven tabs' worth of its own screens rather than one record
/// panel, and a sheet that wide would not be a sheet any more.
export function StoreDetail() {
  // `strict: false`: this route is built generically in `routes.tsx` from
  // `lib/navigation.ts` rather than declared as a named, typed route the way
  // file-based routing would give one, so there is no `Route.useParams` to
  // reach for — every path in this app is typed as plain `string` for the
  // same reason `AppLink` casts its own `to` (see that file's doc comment).
  const params = useParams({ strict: false }) as unknown as { unit: string }
  const unit = params.unit
  const [tab, setTab] = useState<Tab>("overview")

  const detail = useQuery({
    queryKey: storesKeys.detail(unit),
    queryFn: ({ signal }) => storeDetail(unit, signal),
  })

  return (
    <PageContent>
      <PageHeader
        crumb="Stores"
        title={detail.data?.store.name ?? "Store"}
        sub={
          detail.data
            ? [
                detail.data.store.code,
                detail.data.address ?? detail.data.store.city,
                detail.data.store.timezone,
              ]
                .filter((part): part is string => part !== null)
                .join(" · ")
            : undefined
        }
        actions={
          detail.data && (
            <Pill tone={storeStatusTone(detail.data.store.status)}>
              {storeStatusLabel(detail.data.store.status)}
            </Pill>
          )
        }
      />

      {queryState(detail, {
        loading: "Reading the store…",
        render: (data) => {
          const siteId = data.store.site_id
          return (
            <>
              <SubTabs
                tabs={TABS}
                value={tab}
                onChange={(next) => setTab(next as Tab)}
              />
              {tab === "overview" && <OverviewTab detail={data} />}
              {tab === "server" && (
                <ServerTab store={data.store} canManage={data.can_manage} />
              )}
              {tab === "devices" &&
                (siteId ? (
                  <DevicesTab
                    unit={unit}
                    siteId={siteId}
                    tills={data.store.tills}
                  />
                ) : (
                  <NoSiteYet />
                ))}
              {tab === "activity" && <ActivityTab unit={unit} />}
              {tab === "team" && <TeamTab store={data.store} />}
              {tab === "payments" &&
                (siteId ? <PaymentsTab siteId={siteId} /> : <NoSiteYet />)}
              {tab === "stock" &&
                (siteId ? <StockTab siteId={siteId} /> : <NoSiteYet />)}
              {tab === "facilities" &&
                (siteId ? <FacilitiesTab siteId={siteId} /> : <NoSiteYet />)}
            </>
          )
        },
      })}
    </PageContent>
  )
}

/// The rare store that has no shop site yet — `StoreSummary.site_id` is
/// `null` only for a unit the wizard has not finished opening. Devices,
/// Payments, Stock and Facilities all read a site, so each says this rather
/// than passing a site id that does not exist.
function NoSiteYet() {
  return (
    <EmptyState>
      This store has no shop site yet, so there is nothing to read here.
    </EmptyState>
  )
}
