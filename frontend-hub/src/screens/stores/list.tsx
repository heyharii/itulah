import { useQuery } from "@tanstack/react-query"
import { Link, useNavigate, type LinkProps } from "@tanstack/react-router"
import { Plus } from "lucide-react"
import { useEffect, useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { DockTools } from "@/components/shell/dock-tools"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Fab } from "@/components/ui/fab"
import { Input } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { EmptyState } from "@/components/ui/states"
import { day } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import { listStores, storesKeys, type StoreSummary } from "@/lib/queries/stores"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"
import {
  CardFigure,
  CardFoot,
  CardName,
  PhoneCard,
} from "@/components/ui/phone-cards"
import {
  ReadinessRing,
  ServerDot,
  serverStateLabel,
  storeStatusLabel,
  storeStatusTone,
} from "@/screens/stores/shared"
import { OpenStoresSheet } from "@/screens/setup/open-stores-sheet"

/// Every store, whether it is still getting ready or already trading — the
/// owner's own front door onto the whole estate.
///
/// The row reads left to right in the order a person checks it: is it ready
/// (the ring), is it open (the pill), is its server up, are its tills on.
/// Everything past the ring is read off `StoreSummary`, which the server
/// composes from the node register, the enrolment queue and the workforce
/// list once per store — this screen never re-derives readiness itself.
///
/// "Open a new store" raises the same sheet Locations and the setup wizard
/// use (`screens/setup/open-stores-sheet.tsx`): a store is made in exactly one
/// place, whichever screen the button sits on.
export function StoresList() {
  // A phone keeps the search and "Open a new store" in the drawer over the
  // bottom bar and reads each store as a card.
  const phone = useLayout() === "phone"
  const opening = useSheet("new-stores")
  const [search, setSearch] = useState("")
  const navigate = useNavigate()

  const stores = useQuery({
    queryKey: storesKeys.list(),
    queryFn: ({ signal }) => listStores(signal),
    // A server's heartbeat and a till's last-seen move by the second; a shop
    // watched from this list should not look five minutes stale.
    refetchInterval: 30_000,
  })

  const items = stores.data?.items ?? []
  const canManage = stores.data?.can_manage ?? false

  // A supervisor or a store manager whose reach is one unit never sees a
  // list to choose from — head office's own reach reads as `Every`, so
  // landing here at all with exactly one row and no management rights means
  // that row is the caller's own store. Go straight to its page rather than
  // a one-row list nobody would otherwise choose from.
  const solePosting = !canManage && items.length === 1 ? items[0].unit_id : null
  useEffect(() => {
    if (solePosting === null) return
    void navigate({
      to: `/stores/${encodeURIComponent(solePosting)}` as LinkProps["to"],
      replace: true,
    })
  }, [solePosting, navigate])

  const rows = useMemo(() => {
    const text = search.trim().toLowerCase()
    if (text === "") return items
    return items.filter(
      (store) =>
        store.name.toLowerCase().includes(text) ||
        store.code.toLowerCase().includes(text) ||
        (store.city ?? "").toLowerCase().includes(text)
    )
  }, [items, search])

  if (solePosting !== null) return null

  return (
    <PageContent>
      <PageHeader
        crumb="Stores"
        title="Stores"
        sub={
          canManage
            ? "Open a new store, pair its server, and watch every shop from one page."
            : "Your own store, and its server."
        }
        actions={
          phone ? undefined : (
            <>
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="h-8 w-48"
              />
              {canManage && (
                <Button variant="primary" onClick={() => opening.open(true)}>
                  <Plus className="size-4" />
                  Open a new store
                </Button>
              )}
            </>
          )
        }
      />

      {canManage && (
        <Fab label="Open a new store" onClick={() => opening.open(true)} />
      )}
      <DockTools
        search={{ value: search, onChange: setSearch, label: "Search Stores" }}
      />

      <Card className="overflow-hidden max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
        {queryState(stores, {
          loading: "Reading the stores…",
          render: () =>
            rows.length === 0 ? (
              items.length === 0 ? (
                <EmptyState>
                  {canManage
                    ? `No store has been opened yet. "Open a new store" makes its unit, its shop site and its stock pools together.`
                    : "No store is posted to you yet."}
                </EmptyState>
              ) : (
                <EmptyState>No store matches that search.</EmptyState>
              )
            ) : (
              <ul
                className={
                  phone ? "flex flex-col gap-2.5" : "divide-y divide-hairline"
                }
              >
                {rows.map((store) =>
                  phone ? (
                    <StoreCard key={store.unit_id} store={store} />
                  ) : (
                    <StoreRow key={store.unit_id} store={store} />
                  )
                )}
              </ul>
            ),
        })}
      </Card>

      <OpenStoresSheet open={opening.isOpen} onClose={opening.close} />
    </PageContent>
  )
}

function StoreRow({ store }: { store: StoreSummary }) {
  const complete = store.status !== "GETTING_READY"
  return (
    <li>
      {/* A concrete path, not the templated `/stores/$unit` `AppLink`
          declares — Router matches the URL it is given against every
          registered pattern regardless of how the string was built, and
          `AppLink`'s own registry check exists for paths declared as literals,
          which a per-store URL never is. */}
      <Link
        to={`/stores/${encodeURIComponent(store.unit_id)}` as LinkProps["to"]}
        className="flex items-center gap-3.5 px-4 py-3 transition-colors hover:bg-soft-2"
      >
        <ReadinessRing
          done={store.readiness.done}
          total={store.readiness.total}
          complete={complete}
        />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <b className="truncate text-[0.9375rem] font-semibold text-ink">
              {store.name}
            </b>
            <span className="shrink-0 font-mono text-pill text-mute">
              {store.code}
            </span>
          </span>
          <span className="block truncate text-meta text-body">
            {store.city ?? "—"}
            {store.status === "OPEN" && store.opened_at
              ? ` · open since ${day(store.opened_at)}`
              : store.status === "CLOSED"
                ? " · closed"
                : " · getting ready"}
          </span>
        </span>
        <Pill tone={storeStatusTone(store.status)}>
          {storeStatusLabel(store.status)}
        </Pill>
        <span className="hidden shrink-0 items-center gap-1.5 text-meta text-body sm:flex">
          <ServerDot state={store.server.state} />
          {serverStateLabel(store.server.state)}
        </span>
        <span className="hidden w-40 shrink-0 text-right text-meta text-body md:block">
          {store.tills.waiting > 0
            ? `${store.tills.online}/${store.tills.active} online · ${store.tills.waiting} waiting`
            : `${store.tills.seats} ${store.tills.seats === 1 ? "seat" : "seats"} · ${store.tills.online}/${store.tills.active} online`}
        </span>
      </Link>
    </li>
  )
}

/// One store as a phone's card: its name over its code and where it is, how many
/// of its tills are online as the figure (while it is still getting ready, how
/// many of its steps are done), its server in the foot, and where it stands as a
/// pill. A tap opens the store's page, as the row does.
function StoreCard({ store }: { store: StoreSummary }) {
  const navigate = useNavigate()
  const getting = store.status === "GETTING_READY"
  return (
    <PhoneCard
      onOpen={() =>
        void navigate({
          to: `/stores/${encodeURIComponent(store.unit_id)}` as LinkProps["to"],
        })
      }
      head={
        <CardName
          name={store.name}
          code={store.code}
          line={
            <>
              {store.city ?? "—"}
              {store.status === "OPEN" && store.opened_at
                ? ` · open since ${day(store.opened_at)}`
                : store.status === "CLOSED"
                  ? " · closed"
                  : " · getting ready"}
            </>
          }
        />
      }
      lead={
        getting ? (
          <CardFigure
            value={`${store.readiness.done}/${store.readiness.total}`}
            caption="steps done"
          />
        ) : (
          <CardFigure
            value={`${store.tills.online}/${store.tills.active}`}
            caption="tills online"
            tone={store.tills.online === 0 ? "quiet" : undefined}
          />
        )
      }
      foot={
        <CardFoot
          status={
            <span className="inline-flex items-center gap-1.5">
              <ServerDot state={store.server.state} />
              {serverStateLabel(store.server.state)}
            </span>
          }
        >
          {store.tills.waiting > 0
            ? `${store.tills.waiting} waiting`
            : `${store.tills.seats} ${store.tills.seats === 1 ? "seat" : "seats"}`}
        </CardFoot>
      }
      action={
        <Pill tone={storeStatusTone(store.status)}>
          {storeStatusLabel(store.status)}
        </Pill>
      }
    />
  )
}
