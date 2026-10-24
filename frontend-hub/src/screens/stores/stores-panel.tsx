import { useQuery } from "@tanstack/react-query"
import { Link, type LinkProps } from "@tanstack/react-router"
import { Plus } from "lucide-react"
import { useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/field"
import { count } from "@/lib/format"
import {
  storesListQuery,
  waitingAtStore,
  type StoreStatus,
  type StoreSummary,
} from "@/lib/queries/stores"
import { useSheet } from "@/lib/sheets"
import { cn } from "@/lib/utils"
import { storeStatusLabel, useStorePath } from "@/screens/stores/shared"

/// The Stores menu's panel (owner, 2026-10-24: `store-opening-prototype.html`,
/// `storesNav()`): the light column beside the rail, in place of the list of
/// screens every other department draws there.
///
/// Add store at the top, a search, All stores with how many there are, then
/// every store under where it stands — Getting ready, Open, Stopped, Removed —
/// by its code and name, with a small blue count while something waits for head
/// office (a new POS asking to join, a finger recorded at the store). A press
/// on a store opens its page in the content beside, so the shops are managed
/// one by one.
///
/// Drawn by `SubSidebar` for the Stores module (`AppModule.sidebar`). On a
/// phone, and wherever the panel is away, All stores (`list.tsx`) is the way to
/// the same stores.
export function StoresSidebar() {
  const stores = useQuery(storesListQuery())
  const storePath = useStorePath()
  const opening = useSheet("new-stores")
  const [search, setSearch] = useState("")

  const items = stores.data?.items
  const canManage = stores.data?.can_manage === true

  const groups = useMemo(() => {
    const text = search.trim().toLowerCase()
    const shown =
      items?.filter(
        (store) =>
          text === "" ||
          store.name.toLowerCase().includes(text) ||
          store.code.toLowerCase().includes(text) ||
          (store.city ?? "").toLowerCase().includes(text)
      ) ?? []
    return GROUP_ORDER.map((status) => ({
      status,
      label: storeStatusLabel(status),
      stores: shown.filter((store) => groupOf(store) === status),
    })).filter((group) => group.stores.length > 0)
  }, [items, search])

  // A removed store never counts under All stores: the list has its own chip
  // for it, and its row here is under Removed.
  const total = items?.filter((store) => groupOf(store) !== "CLOSED").length

  return (
    <>
      {canManage && (
        <Button
          variant="primary"
          className="mb-2 w-full"
          onClick={() => opening.open(true)}
        >
          <Plus />
          Add store
        </Button>
      )}
      <Input
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Search stores"
        aria-label="Search stores"
        autoComplete="off"
        className="mb-2 w-full"
      />

      <Link
        to={"/stores" as LinkProps["to"]}
        activeOptions={{ exact: true, includeSearch: false }}
        className={ROW}
      >
        <span className="min-w-0 flex-1 truncate">All stores</span>
        {total !== undefined && (
          <span className="shrink-0 text-mute tabular-nums">
            {count(total)}
          </span>
        )}
      </Link>

      {groups.map((group) => (
        <div
          key={group.status}
          className="mt-[1.375rem] flex flex-col gap-px first:mt-0"
        >
          <span className="mb-1 ml-1.5 h-[1.5rem] self-start rounded-[0.375rem] bg-soft-2 px-2 text-[0.9375rem] leading-[1.5rem] font-semibold whitespace-nowrap text-mute">
            {group.label}
          </span>
          {group.stores.map((store) => (
            <StoreRow
              key={store.unit_id}
              store={store}
              to={storePath(store.unit_id)}
            />
          ))}
        </div>
      ))}

      {items !== undefined && search.trim() !== "" && groups.length === 0 && (
        <p className="px-2.5 pt-2 text-[0.9375rem] text-mute">
          No store matches
        </p>
      )}
    </>
  )
}

function StoreRow({ store, to }: { store: StoreSummary; to: LinkProps["to"] }) {
  const waiting = waitingAtStore(store)
  return (
    <Link
      to={to}
      activeOptions={{ includeSearch: false }}
      className={ROW}
      title={`${store.code} · ${store.name}`}
    >
      <span className="min-w-0 flex-1 truncate">{store.name}</span>
      <span className="shrink-0 font-mono text-mute">{store.code}</span>
      {waiting > 0 && (
        <span
          aria-label={`${waiting} waiting for head office`}
          className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-accent px-1.5 text-[0.9375rem] leading-none font-semibold text-white! tabular-nums"
        >
          {waiting > 99 ? "99+" : count(waiting)}
        </span>
      )}
    </Link>
  )
}

/// A row of the light panel, as every other department's rows are drawn
/// (`TONE.panel` in `components/shell/nav-column.tsx`): the row you are on is
/// the accent's wash.
const ROW = cn(
  "flex h-9 shrink-0 items-center gap-2 rounded-inner px-2.5 text-[0.9375rem] text-body transition-colors hover:bg-soft-2 hover:text-ink pointer-coarse:min-h-tap",
  "data-[status=active]:bg-accent-bg data-[status=active]:font-medium data-[status=active]:text-accent"
)

/// The order the panel stacks the groups in: the stores that need something
/// first, the ones that are gone last.
const GROUP_ORDER: readonly StoreStatus[] = [
  "GETTING_READY",
  "OPEN",
  "STOPPED",
  "CLOSED",
]

/// Where a store stands, for the panel's groups. `StoreSummary.status` is
/// already derived (stopped, removed); the removal date is read as well, so a
/// store head office removed never lands under Open.
function groupOf(store: StoreSummary): StoreStatus {
  if (store.status === "CLOSED" || store.removed_at !== null) return "CLOSED"
  if (store.status === "STOPPED") return "STOPPED"
  if (store.status === "GETTING_READY") return "GETTING_READY"
  return "OPEN"
}
