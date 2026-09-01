import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import {
  activeFilterCount,
  toggleFilter,
  type AllotmentFilters,
  type StockFilter,
  NO_FILTERS,
} from "@/lib/allotment-filters"
import { units } from "@/lib/money"
import type { PurchaseOrderRow } from "@/lib/purchase-orders"
import { listPurchaseOrders } from "@/lib/purchase-orders"
import { cn } from "@/lib/utils"
import type { Vocabulary } from "@/lib/vocabulary"
import { ApiError } from "@itulah/contract/client"
import { useQuery } from "@tanstack/react-query"
import { Check, Search } from "lucide-react"
import { useState } from "react"

const STOCK_CHOICES: { value: StockFilter; label: string; hint: string }[] = [
  { value: "any", label: "Any", hint: "Every article in the catalogue" },
  { value: "in", label: "In stock", hint: "The warehouse holds at least one" },
  {
    value: "out",
    label: "Nothing on hand",
    hint: "Promised out, missing, or never arrived",
  },
]

/// The filters, in a sheet over the grid rather than in a bar above it.
///
/// A row of dropdowns would push the stores down the screen, and the stores are
/// the screen. A sheet borrows the space while a decision is being made and
/// gives it back: the grid stays exactly where it was, filtered.
export function FilterSheet({
  filters,
  divisions,
  tags,
  vocabulary,
  onChange,
  children,
}: {
  filters: AllotmentFilters
  divisions: readonly string[]
  tags: readonly string[]
  vocabulary: Vocabulary
  onChange: (filters: AllotmentFilters) => void
  children: React.ReactNode
}) {
  const count = activeFilterCount(filters)
  return (
    <Sheet>
      <SheetTrigger render={children as never} />
      <SheetContent side="right" className="sm:max-w-sm">
        <SheetHeader>
          <SheetTitle className="text-sm">Narrow the catalogue</SheetTitle>
          <SheetDescription className="text-[11.5px]">
            {count === 0
              ? "Every article the warehouse knows about."
              : `${count} filter${count === 1 ? "" : "s"} on.`}
          </SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-auto">
          <Section title="On hand">
            {STOCK_CHOICES.map((choice) => (
              <button
                key={choice.value}
                type="button"
                onClick={() => onChange({ ...filters, stock: choice.value })}
                className="flex w-full items-start gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-muted/60"
              >
                <span
                  className={cn(
                    "mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border",
                    filters.stock === choice.value
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-input"
                  )}
                >
                  {filters.stock === choice.value && (
                    <Check className="size-3" />
                  )}
                </span>
                <span className="min-w-0">
                  <span className="block text-[12.5px] leading-tight">
                    {choice.label}
                  </span>
                  <span className="block text-[10.5px] leading-tight text-muted-foreground">
                    {choice.hint}
                  </span>
                </span>
              </button>
            ))}
          </Section>

          <Section title="Division">
            {divisions.length === 0 ? (
              <Empty>No article on this list carries a division yet.</Empty>
            ) : (
              divisions.map((code) => (
                <Tick
                  key={code}
                  label={vocabulary.division(code)}
                  checked={filters.divisions.includes(code)}
                  onToggle={() =>
                    onChange({
                      ...filters,
                      divisions: toggleFilter(filters.divisions, code),
                    })
                  }
                />
              ))
            )}
          </Section>

          <Section title="Tags">
            {tags.length === 0 ? (
              <Empty>No article on this list carries a tag yet.</Empty>
            ) : (
              tags.map((code) => (
                <Tick
                  key={code}
                  label={vocabulary.tag(code)}
                  checked={filters.tags.includes(code)}
                  onToggle={() =>
                    onChange({
                      ...filters,
                      tags: toggleFilter(filters.tags, code),
                    })
                  }
                />
              ))
            )}
          </Section>
        </div>

        <div className="flex shrink-0 items-center gap-2 border-t px-4 py-2.5">
          <span className="text-[11px] text-muted-foreground">
            {count === 0 ? "Nothing filtered" : `${count} on`}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto"
            disabled={count === 0}
            // The order is cleared with everything else: it is a filter like
            // the rest, and leaving it standing after "clear" is how a person
            // concludes the warehouse is empty.
            onClick={() => onChange(NO_FILTERS)}
          >
            Clear all
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}

/// Pick the delivery, and the grid becomes what that delivery brought in.
///
/// Separate from the other filters because it is a different question: those
/// narrow the catalogue by what things ARE, this one narrows it to one event.
/// Allocating a delivery out to the shops is the commonest reason to open this
/// screen at all, and it deserves its own list rather than a line in a form.
export function PurchaseOrderSheet({
  selected,
  onSelect,
  children,
}: {
  selected: string
  onSelect: (purchaseOrderId: string) => void
  children: React.ReactNode
}) {
  const [search, setSearch] = useState("")
  const orders = useQuery({
    queryKey: ["purchase-orders"],
    queryFn: ({ signal }) => listPurchaseOrders(signal),
    staleTime: 60_000,
  })

  const needle = search.trim().toLowerCase()
  const shown = (orders.data ?? []).filter(
    (order) =>
      needle === "" ||
      `${order.po_number} ${order.supplier_name ?? ""} ${order.supplier_id}`
        .toLowerCase()
        .includes(needle)
  )

  return (
    <Sheet>
      <SheetTrigger render={children as never} />
      <SheetContent side="right" className="sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="text-sm">Allot one order</SheetTitle>
          <SheetDescription className="text-[11.5px]">
            The grid becomes the articles this order brought in.
          </SheetDescription>
        </SheetHeader>

        <div className="shrink-0 border-b px-4 py-2">
          <label className="relative block">
            <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Order number or supplier…"
              aria-label="Search the orders"
              className="h-7 pl-7 text-xs"
            />
          </label>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          <SheetClose
            onClick={() => onSelect("")}
            render={
              <button
                type="button"
                className="flex w-full items-center gap-2 border-b px-4 py-2 text-left hover:bg-muted/60"
              />
            }
          >
            <span
              className={cn(
                "grid size-4 shrink-0 place-items-center rounded-full border",
                selected === ""
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-input"
              )}
            >
              {selected === "" && <Check className="size-3" />}
            </span>
            <span className="text-[12.5px]">Every order</span>
          </SheetClose>

          {orders.isPending ? (
            <Empty>Reading the orders…</Empty>
          ) : orders.isError ? (
            <p className="px-4 py-6 text-center text-xs text-destructive">
              {orders.error instanceof ApiError
                ? orders.error.message
                : "The orders could not be loaded."}
            </p>
          ) : shown.length === 0 ? (
            <Empty>No order matches that.</Empty>
          ) : (
            shown.map((order) => (
              <OrderRow
                key={order.purchase_order_id}
                order={order}
                selected={selected === order.purchase_order_id}
                onSelect={() => onSelect(order.purchase_order_id)}
              />
            ))
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

function OrderRow({
  order,
  selected,
  onSelect,
}: {
  order: PurchaseOrderRow
  selected: boolean
  onSelect: () => void
}) {
  return (
    <SheetClose
      onClick={onSelect}
      render={
        <button
          type="button"
          className="flex w-full items-center gap-2 border-b px-4 py-2 text-left hover:bg-muted/60"
        />
      }
    >
      <span
        className={cn(
          "grid size-4 shrink-0 place-items-center rounded-full border",
          selected
            ? "border-primary bg-primary text-primary-foreground"
            : "border-input"
        )}
      >
        {selected && <Check className="size-3" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-mono text-[12px] leading-tight">
          {order.po_number}
        </span>
        <span className="block truncate text-[10.5px] leading-tight text-muted-foreground">
          {order.supplier_name ?? order.supplier_id}
        </span>
      </span>
      {/* What arrived is the number that matters here: an order still on the
          water has nothing in the warehouse to promise. */}
      <span className="shrink-0 font-mono text-[10.5px] text-muted-foreground tabular-nums">
        {units(order.received_stock_units)} in
      </span>
    </SheetClose>
  )
}

function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="border-b px-2 py-2.5">
      <p className="px-2 pb-1 text-[10.5px] font-medium tracking-wide text-muted-foreground uppercase">
        {title}
      </p>
      {children}
    </div>
  )
}

function Tick({
  label,
  checked,
  onToggle,
}: {
  label: string
  checked: boolean
  onToggle: () => void
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-muted/60">
      <Checkbox checked={checked} onCheckedChange={onToggle} />
      <span className="text-[12.5px]">{label}</span>
    </label>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-4 py-4 text-center text-[11px] text-muted-foreground">
      {children}
    </p>
  )
}
