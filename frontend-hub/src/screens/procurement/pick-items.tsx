import { useInfiniteQuery } from "@tanstack/react-query"
import { Check, Search } from "lucide-react"
import { useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/field"
import { Sheet } from "@/components/ui/sheet"
import { EmptyState } from "@/components/ui/states"
import { Swatches } from "@/components/ui/swatch"
import { Thumbnail } from "@/components/ui/thumbnail"
import { count, money } from "@/lib/format"
import {
  procurementKeys,
  searchSupplierItems,
  type SourcingScope,
} from "@/lib/queries/procurement"
import { queryState } from "@/lib/query-state"
import { useDebounced } from "@/lib/use-debounced"
import { cn } from "@/lib/utils"
import type { SourcedItem } from "@itulah/contract"

/// Shopping one supplier's catalogue, from inside the order being written.
///
/// **A catalogue is browsed, not queried.** This replaced a typeahead in the
/// composer's header — a 22rem box that answered with a list of names and
/// prices. That is a control for somebody who already knows the item's name,
/// and it made the ordinary case — a buyer who wants to SEE what this supplier
/// sells — impossible without leaving the half-written order. Sourcing has
/// always known this: it is a grid of photographs, and so is this.
///
/// It is deliberately the smaller cousin of that screen rather than a reuse of
/// it. Sourcing asks "who sells this, and for how much" across every supplier,
/// with facets, sorting, a basket and a detail sheet behind each card. Here the
/// supplier is already decided by the order, nothing is being compared, and the
/// only verb is "put it on". Filters over a single supplier's shelf would be
/// chrome around a question that has one answer.
///
/// **Many at once, then one confirm.** Adding a line is not the end of the job
/// — an order is usually several — so a card toggles a tick and the footer says
/// how many are held. Adding on click and closing would make a five-line order
/// five trips through this sheet.

export function CataloguePicker({
  open,
  supplierId,
  supplierName,
  already,
  onClose,
  onPick,
}: {
  open: boolean
  supplierId: string
  supplierName: string
  /// What is already on the order. Shown as chosen and not selectable: adding
  /// the same item twice is a validation error the server raises, and offering
  /// somebody a choice that can only fail is worse than not offering it.
  already: readonly string[]
  onClose: () => void
  onPick: (rows: readonly SourcedItem[]) => void
}) {
  const [search, setSearch] = useState("")
  const [held, setHeld] = useState<readonly string[]>([])
  // Delayed rather than a debounced fetch, for the reason `use-debounced`
  // gives: it keeps one query key per search somebody actually made instead of
  // one per keystroke.
  const typed = useDebounced(search.trim(), 250)

  /// Everything left behind when the sheet shuts. What was picked is either on
  /// the order by then or was abandoned; either way it must not be waiting the
  /// next time this opens.
  ///
  /// Compared during render rather than in an effect, which is the idiom the
  /// item form uses for the same job: an effect would paint the stale search
  /// and the stale ticks for one frame on the way back in, and React itself
  /// says a state that follows a prop belongs here.
  const [wasOpen, setWasOpen] = useState(open)
  if (wasOpen !== open) {
    setWasOpen(open)
    if (!open) {
      setSearch("")
      setHeld([])
    }
  }

  const scope = useMemo<SourcingScope>(
    () => ({
      supplierIds: [supplierId],
      q: typed === "" ? undefined : typed,
      status: "ACTIVE",
      limit: 24,
    }),
    [supplierId, typed]
  )

  const catalogue = useInfiniteQuery({
    queryKey: procurementKeys.sourcing(scope),
    queryFn: ({ pageParam, signal }) =>
      searchSupplierItems({ ...scope, cursor: pageParam }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    enabled: open,
  })

  const rows = useMemo(
    () => catalogue.data?.pages.flatMap((page) => page.items) ?? [],
    [catalogue.data]
  )

  const toggle = (id: string) =>
    setHeld((was) =>
      was.includes(id) ? was.filter((one) => one !== id) : [...was, id]
    )

  const add = () => {
    const picked = rows.filter((row) =>
      held.includes(row.item.supplier_item_id)
    )
    onPick(picked)
    onClose()
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title="Add from the catalogue"
      id={supplierName === "" ? undefined : supplierName}
      width="wide"
      // `md:`, not a bare width — see the same note on the composer. A plain
      // `w-*` loses to the rail's own `md:w-[27.5rem]` at every breakpoint
      // except a phone, which is the one place it must not win.
      className="md:w-[72rem]"
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className="text-meta text-mute">
            {held.length === 0
              ? "Nothing picked yet."
              : `${count(held.length)} picked.`}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" disabled={held.length === 0} onClick={add}>
              {held.length === 0
                ? "Put on the order"
                : `Put ${count(held.length)} on the order`}
            </Button>
          </div>
        </div>
      }
    >
      <div className="@container flex flex-col gap-4">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3.5 size-3.5 -translate-y-1/2 text-line-ico" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search this supplier's catalogue"
            className="pl-9"
            aria-label="Search this supplier's catalogue"
          />
        </div>

        {queryState(catalogue, {
          loading: "Reading the catalogue…",
          render: () =>
            rows.length === 0 ? (
              <EmptyState>
                {typed === ""
                  ? "This supplier has nothing on offer yet. Add an item instead."
                  : "Nothing in this catalogue matches."}
              </EmptyState>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3 @2xl:grid-cols-4 @5xl:grid-cols-5">
                  {rows.map((row) => (
                    <PickCard
                      key={row.item.supplier_item_id}
                      row={row}
                      on={already.includes(row.item.supplier_item_id)}
                      picked={held.includes(row.item.supplier_item_id)}
                      onToggle={() => toggle(row.item.supplier_item_id)}
                    />
                  ))}
                </div>

                {catalogue.hasNextPage && (
                  <div className="flex justify-center">
                    <Button
                      onClick={() => catalogue.fetchNextPage()}
                      disabled={catalogue.isFetchingNextPage}
                    >
                      {catalogue.isFetchingNextPage ? "Fetching…" : "Show more"}
                    </Button>
                  </div>
                )}
              </>
            ),
        })}
      </div>
    </Sheet>
  )
}

/// One thing on the shelf, as something to pick up.
///
/// The whole card is the control. A card with an "Add" button on it spends the
/// same click and asks the eye to find a 26px target inside a 200px one.
function PickCard({
  row,
  on,
  picked,
  onToggle,
}: {
  row: SourcedItem
  /// Already on the order.
  on: boolean
  picked: boolean
  onToggle: () => void
}) {
  const { item } = row
  const chosen = on || picked

  return (
    <button
      type="button"
      disabled={on}
      onClick={onToggle}
      aria-pressed={chosen}
      className={cn(
        "overflow-hidden rounded-card border bg-canvas text-left shadow-soft transition duration-150",
        chosen
          ? "border-ink"
          : "border-hairline hover:-translate-y-0.5 hover:shadow-pop",
        on && "opacity-60"
      )}
    >
      <Thumbnail
        url={item.image_url}
        fallback="No photograph"
        className="h-[7.5rem] w-full"
      >
        {/* The tick rides on the photograph rather than sitting under it: what
            is picked has to be readable at a glance across twenty cards, and a
            word in the body copy is not. */}
        {chosen && (
          <span className="absolute top-2 right-2 grid size-5 place-items-center rounded-full bg-ink text-white">
            <Check className="size-3" />
          </span>
        )}
      </Thumbnail>
      <div className="px-2.5 py-2">
        <div className="truncate text-[0.8125rem] font-medium text-ink">
          {item.name}
        </div>
        {item.colours.length > 0 && (
          <div className="mt-1.5">
            <Swatches colours={item.colours} cap={5} />
          </div>
        )}
        <div className="mt-1 text-[0.8125rem] font-semibold text-ink tabular-nums">
          {money(item.unit_price_minor)}
        </div>
        {on && (
          <div className="mt-1 text-[0.6875rem] text-mute">On the order</div>
        )}
      </div>
    </button>
  )
}
