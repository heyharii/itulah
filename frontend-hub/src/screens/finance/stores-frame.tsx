import { useNavigate, useSearch } from "@tanstack/react-router"
import { useMemo } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { PageHeader } from "@/components/ui/page-header"
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states"
import { useUnits, type UnitView } from "@/lib/queries/organisation"
import { cn } from "@/lib/utils"

/// The frame every Finance › Stores page stands in: the shops down the left,
/// the page of the chosen shop on the right.
///
/// The chosen shop lives in the URL (`?store=<unit id>`) and is also
/// remembered for the session, because the sidebar's sub-menu links carry no
/// search: going from Cash on hand to Petty cash should land on the same shop.

const REMEMBERED = "finance.stores.unit"

function remembered(): string | null {
  try {
    return window.sessionStorage.getItem(REMEMBERED)
  } catch {
    return null
  }
}

function remember(id: string) {
  try {
    window.sessionStorage.setItem(REMEMBERED, id)
  } catch {
    // Private window or blocked storage: the URL still carries the choice.
  }
}

/// Every open shop, by code.
export function useOpenStores() {
  const units = useUnits()
  const stores = useMemo(
    () =>
      (units.data ?? [])
        .filter((unit) => unit.kind === "STORE" && unit.status !== "CLOSED")
        .sort((a, b) => a.code.localeCompare(b.code)),
    [units.data]
  )
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
  sub,
  children,
}: {
  title: string
  sub: string
  children: (unit: UnitView) => React.ReactNode
}) {
  const { units, stores } = useOpenStores()
  const search = useSearch({ strict: false }) as { store?: unknown }
  const navigate = useNavigate()
  const wanted =
    search.store === undefined ? remembered() : String(search.store)
  const unit = stores.find((one) => one.id === wanted) ?? stores[0]

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

  return (
    <PageContent>
      <PageHeader crumb="Finance › Stores" title={title} sub={sub} />

      {units.isPending ? (
        <LoadingState>Reading the shops…</LoadingState>
      ) : units.isError ? (
        <ErrorState error={units.error} />
      ) : unit === undefined ? (
        <EmptyState>No shop is open yet.</EmptyState>
      ) : (
        <div className="flex items-start gap-6">
          <nav
            aria-label="Shops"
            className="sticky top-4 w-56 shrink-0 overflow-hidden rounded-card border border-hairline-2 bg-canvas shadow-soft"
          >
            {stores.map((store) => (
              <button
                key={store.id}
                type="button"
                onClick={() => choose(store.id)}
                aria-current={store.id === unit.id ? "page" : undefined}
                className={cn(
                  "flex w-full flex-col items-start border-b border-hairline px-4 py-3 text-left transition-colors last:border-b-0",
                  store.id === unit.id ? "bg-accent-bg" : "hover:bg-soft"
                )}
              >
                <span
                  className={cn(
                    "truncate",
                    store.id === unit.id ? "font-medium text-ink" : "text-text"
                  )}
                >
                  {store.name}
                </span>
                <span className="font-mono text-[0.875rem] text-mute">
                  {store.code}
                </span>
              </button>
            ))}
          </nav>

          <div className="min-w-0 flex-1">
            <div className="mb-4 flex items-baseline justify-between gap-3">
              <h2 className="text-[1.125rem] font-semibold text-ink">
                {unit.name}
              </h2>
              <span className="font-mono text-[0.875rem] text-mute">
                {unit.code}
              </span>
            </div>
            {children(unit)}
          </div>
        </div>
      )}
    </PageContent>
  )
}
