import { useSuspenseQuery } from "@tanstack/react-query"
import { useNavigate, useSearch } from "@tanstack/react-router"
import { Suspense } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Select } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Toolbar } from "@/components/ui/segmented"
import { EmptyState, LoadingState } from "@/components/ui/states"
import { unitsQuery, type UnitView } from "@/lib/queries/organisation"
import { PhoneChoice } from "@/screens/finance/parts"
import {
  chosenStoreOf,
  openStoresOf,
  remember,
  useRemembered,
} from "@/screens/finance/store-units"

/// The frame every Finance › Stores page stands in: the head, then the page
/// of the chosen shop, whose bar carries the shop picker.
///
/// The chosen shop lives in the URL (`?store=<unit id>`) and is also
/// remembered for the session, because the sidebar's sub-menu links carry no
/// search: going from Cash on hand to Petty cash should land on the same shop.

/// Every open shop, by code. Read inside a `<Suspense>`: the units are there
/// or the boundary waits.
export function useOpenStores() {
  const units = useSuspenseQuery(unitsQuery())
  const stores = openStoresOf(units.data)
  return { units, stores }
}

/// Opens a shop's page: `to` is the sub-menu, the shop rides in `store`.
export function useOpenStore() {
  const navigate = useNavigate()
  return (to: string, unitId: string) => {
    remember(unitId)
    void navigate({
      to,
      search: { store: unitId } as never,
      viewTransition: false,
    } as never)
  }
}

export function StoreFrame({
  title,
  children,
}: {
  title: string
  /// The page of the chosen shop. `picker` is the shop select for the page's
  /// bar (desk); a phone has the same choice as a chip in the dock.
  children: (unit: UnitView, picker: React.ReactNode) => React.ReactNode
}) {
  return (
    <PageContent>
      {/* A phone's top bar already names the screen. */}
      <PageHeader
        className="max-md:hidden"
        crumb="Finance › Stores"
        title={title}
      />
      <Suspense fallback={<LoadingState>Reading the shops…</LoadingState>}>
        <ChosenStore>{children}</ChosenStore>
      </Suspense>
    </PageContent>
  )
}

/// The shop the page is for, and the page of that shop. Its own boundary: the
/// shop picker stands while the shop's figures are read.
function ChosenStore({
  children,
}: {
  children: (unit: UnitView, picker: React.ReactNode) => React.ReactNode
}) {
  const { stores } = useOpenStores()
  const search = useSearch({ strict: false }) as { store?: unknown }
  const navigate = useNavigate()
  const kept = useRemembered()
  const wanted = search.store === undefined ? kept : String(search.store)
  const unit = chosenStoreOf(stores, wanted)

  const choose = (id: string) => {
    remember(id)
    void navigate({
      to: ".",
      search: ((prev: Record<string, unknown>) => ({
        ...prev,
        store: id,
      })) as never,
      replace: true,
      viewTransition: false,
    } as never)
  }

  if (unit === undefined) return <EmptyState>No shop is open yet.</EmptyState>

  const picker = (
    <Select
      value={unit.id}
      onChange={choose}
      aria-label="Shop"
      className="h-control w-64 max-md:hidden"
    >
      {stores.map((store) => (
        <option key={store.id} value={store.id}>
          {store.name} · {store.code}
        </option>
      ))}
    </Select>
  )

  return (
    <>
      <Suspense
        key={unit.id}
        fallback={
          <>
            <Toolbar>{picker}</Toolbar>
            <LoadingState>Reading the shop…</LoadingState>
          </>
        }
      >
        {children(unit, picker)}
      </Suspense>
      {/* After the screen's own dock pieces, so its chip is the last. */}
      <PhoneChoice
        title="Shop"
        value={unit.id}
        onChange={choose}
        options={stores.map((store) => ({
          value: store.id,
          label: `${store.name} · ${store.code}`,
          short: store.name,
        }))}
      />
    </>
  )
}
