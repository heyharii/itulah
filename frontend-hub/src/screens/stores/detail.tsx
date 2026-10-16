import { useQuery } from "@tanstack/react-query"
import { useParams } from "@tanstack/react-router"

import { PageContent } from "@/components/shell/app-shell"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { SubTabs } from "@/components/ui/sub-tabs"
import { storeDetail, storesKeys } from "@/lib/queries/stores"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"
import { OverviewTab, type StoreTab } from "@/screens/stores/overview-tab"
import { ServerTab } from "@/screens/stores/server-tab"
import { storeStatusLabel, storeStatusTone } from "@/screens/stores/shared"
import { StatusTab } from "@/screens/stores/status-tab"

/// One store, one page, in three tabs: Overview's facts, checklist and the
/// Open store button; the Server's install code, first data and machine; and
/// the Status page — every component of the store with ninety days of bars.
/// The devices, team, payments, stock and facilities each have a screen of
/// their own elsewhere in the hub, and the checklist links to them.
///
/// `unit` is a real path parameter, `/stores/$unit` — the one route in this
/// app that is not addressed as a sheet over a list. Every OTHER record here
/// opens as a sheet on the screen that lists it (see `lib/sheets.ts`), but a
/// store has three tabs' worth of its own screens rather than one record
/// panel, and a sheet that wide would not be a sheet any more. The tab lives
/// in the URL (`?store-tab=server`), so the "Add store" sheet can land
/// somebody straight on it.
export function StoreDetail() {
  // `strict: false`: this route is built generically in `routes.tsx` from
  // `lib/navigation.ts` rather than declared as a named, typed route the way
  // file-based routing would give one, so there is no `Route.useParams` to
  // reach for — every path in this app is typed as plain `string` for the
  // same reason `AppLink` casts its own `to` (see that file's doc comment).
  const params = useParams({ strict: false }) as unknown as { unit: string }
  const unit = params.unit
  const tabParam = useSheet("store-tab")
  const tab: StoreTab = tabParam.value ?? "overview"
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
          const pending = data.checks.filter((check) => !check.ok).length
          const tabs = [
            {
              value: "overview",
              short: "Overview",
              label: (
                <>
                  Overview
                  {pending > 0 && data.store.status === "GETTING_READY" && (
                    <span className="ml-1.5 text-warn-fg">{pending}</span>
                  )}
                </>
              ),
            },
            { value: "server", label: "Server" },
            { value: "status", label: "Status" },
          ]
          return (
            <>
              <SubTabs
                tabs={tabs}
                value={tab}
                onChange={(next) => tabParam.replace(next)}
              />
              {tab === "overview" && (
                <OverviewTab
                  detail={data}
                  onOpenTab={(next) => tabParam.replace(next)}
                />
              )}
              {tab === "server" && (
                <ServerTab store={data.store} canManage={data.can_manage} />
              )}
              {tab === "status" && <StatusTab store={data.store} />}
            </>
          )
        },
      })}
    </PageContent>
  )
}
