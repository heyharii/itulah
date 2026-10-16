import { useSuspenseQuery } from "@tanstack/react-query"
import { Link, useNavigate } from "@tanstack/react-router"
import { Plus } from "lucide-react"
import { Suspense, useEffect, useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { DockTools } from "@/components/shell/dock-tools"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Fab } from "@/components/ui/fab"
import { Input } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { EmptyState, LoadingState } from "@/components/ui/states"
import { day } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import { storesListQuery, type StoreSummary } from "@/lib/queries/stores"
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
  useStorePath,
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
/// "Add store" raises the same sheet Locations uses
/// (`screens/setup/open-stores-sheet.tsx`): a store is made in exactly one
/// place, whichever screen the button sits on. Making it is not opening it —
/// opening is the last button on the store's own page.
export function StoresList() {
  // The title stands at once; the stores wait for the list and stream in with
  // it (the server starts the read too). The head's buttons depend on whether
  // the person may manage stores, so they arrive with the list.
  return (
    <PageContent>
      <Suspense
        fallback={
          <>
            <PageHeader crumb="Stores" title="Stores" />
            <LoadingState>Reading the stores…</LoadingState>
          </>
        }
      >
        <StoreBook />
      </Suspense>
    </PageContent>
  )
}

function StoreBook() {
  // A phone keeps the search and "Add store" in the drawer over the bottom
  // bar and reads each store as a card.
  const phone = useLayout() === "phone"
  const opening = useSheet("new-stores")
  const [search, setSearch] = useState("")
  const navigate = useNavigate()
  const storePath = useStorePath()

  const stores = useSuspenseQuery(storesListQuery())

  const items = stores.data.items
  const canManage = stores.data.can_manage

  // A supervisor or a store manager whose reach is one unit never sees a
  // list to choose from — head office's own reach reads as `Every`, so
  // landing here at all with exactly one row and no management rights means
  // that row is the caller's own store. Go straight to its page rather than
  // a one-row list nobody would otherwise choose from.
  const solePosting = !canManage && items.length === 1 ? items[0].unit_id : null
  useEffect(() => {
    if (solePosting === null) return
    void navigate({
      to: storePath(solePosting),
      replace: true,
    })
  }, [solePosting, navigate, storePath])

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
    <>
      <PageHeader
        crumb="Stores"
        title="Stores"
        sub={
          canManage
            ? "Add a store, install its server, and watch every shop from one page."
            : "Your own store, and its server."
        }
        actions={
          phone ? undefined : (
            <>
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search"
                className="h-8 w-48"
              />
              {canManage && (
                <Button variant="primary" onClick={() => opening.open(true)}>
                  <Plus className="size-4" />
                  Add store
                </Button>
              )}
            </>
          )
        }
      />

      {canManage && (
        <Fab label="Add store" onClick={() => opening.open(true)} />
      )}
      <DockTools
        search={{ value: search, onChange: setSearch, label: "Search Stores" }}
      />

      <Card className="overflow-hidden max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
        {rows.length === 0 ? (
          items.length === 0 ? (
            <EmptyState>
              {canManage
                ? `No store has been added yet. "Add store" makes its unit, its shop site and its stock pools together.`
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
        )}
      </Card>

      <OpenStoresSheet open={opening.isOpen} onClose={opening.close} />
    </>
  )
}

function StoreRow({ store }: { store: StoreSummary }) {
  const storePath = useStorePath()
  const complete = store.status !== "GETTING_READY"
  return (
    <li>
      {/* A concrete path, not the templated `/stores/$unit` `AppLink`
          declares — Router matches the URL it is given against every
          registered pattern regardless of how the string was built, and
          `AppLink`'s own registry check exists for paths declared as literals,
          which a per-store URL never is. */}
      <Link
        to={storePath(store.unit_id)}
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
            {store.city || "—"}
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
  const storePath = useStorePath()
  const getting = store.status === "GETTING_READY"
  return (
    <PhoneCard
      onOpen={() => void navigate({ to: storePath(store.unit_id) })}
      head={
        <CardName
          name={store.name}
          code={store.code}
          line={
            <>
              {store.city || "—"}
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
