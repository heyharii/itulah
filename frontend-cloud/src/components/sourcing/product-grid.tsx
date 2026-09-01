import { Checkbox } from "@/components/ui/checkbox"
import { money } from "@/lib/money"
import { cn } from "@/lib/utils"
import { Plus } from "lucide-react"
import { StatusDot, Tag, Thumb } from "./columns"
import type { SourcingRow } from "./rows"

/// The same rows as the table, looked at rather than compared.
///
/// Clothing is bought by eye first: a buyer scanning for a shape or a colour is
/// not reading a price column. This view exists for that pass and deliberately
/// shows less — photo, name, supplier, price — with the rest one click away in
/// the item itself.
export function ProductGrid({
  rows,
  held,
  isSelected,
  onSelect,
  onAdd,
  onOpen,
}: {
  rows: readonly SourcingRow[]
  held: Map<string, number>
  isSelected: (id: string) => boolean
  onSelect: (id: string, selected: boolean) => void
  onAdd: (id: string) => void
  onOpen: (id: string) => void
}) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(178px,1fr))] gap-2.5 p-3.5">
      {rows.map((row) => {
        const selected = isSelected(row.id)
        const inBasket = held.get(row.id) ?? 0
        const onHold = row.status !== "ACTIVE"
        return (
          <article
            key={row.id}
            className={cn(
              "group relative flex flex-col overflow-hidden rounded-lg border transition-colors",
              selected ? "border-primary ring-primary/20 ring-2" : "hover:border-foreground/20",
            )}
          >
            {/* The whole card opens the item, the way a product tile does.
                The controls layered on top stop the click from reaching it. */}
            <button
              type="button"
              onClick={() => onOpen(row.id)}
              aria-label={`Open ${row.name}`}
              className="text-left"
            >
              <Thumb row={row} className="aspect-4/5 w-full rounded-none object-cover" />
            </button>

            <div
              className={cn(
                "absolute top-2 left-2 transition-opacity",
                selected
                  ? "opacity-100"
                  : "opacity-0 group-hover:opacity-100 focus-within:opacity-100",
              )}
            >
              <Checkbox
                checked={selected}
                onCheckedChange={(checked) => onSelect(row.id, checked === true)}
                aria-label={`Select ${row.name}`}
                className="bg-background/90 backdrop-blur"
              />
            </div>

            <button
              type="button"
              disabled={onHold}
              aria-label={`Add one ${row.name} to the basket`}
              title={onHold ? "On hold — cannot be ordered" : "Add one to the basket"}
              onClick={() => onAdd(row.id)}
              className={cn(
                "bg-background/90 absolute top-2 right-2 grid size-7 place-items-center rounded-md backdrop-blur transition-opacity",
                "disabled:pointer-events-none disabled:opacity-30",
                inBasket > 0
                  ? "opacity-100"
                  : "opacity-0 group-hover:opacity-100 focus:opacity-100",
              )}
            >
              <Plus className="size-4" />
            </button>

            {inBasket > 0 && (
              <span className="absolute top-2 right-11 rounded-md bg-emerald-600 px-1.5 py-0.5 font-mono text-[10.5px] font-medium text-white">
                {inBasket}
              </span>
            )}

            <div className="flex min-w-0 flex-1 flex-col gap-1 p-2.5">
              <button
                type="button"
                onClick={() => onOpen(row.id)}
                className="truncate text-left text-[13px] font-medium hover:underline"
              >
                {row.name}
              </button>
              <div className="text-muted-foreground truncate font-mono text-[10.5px]">
                {row.code}
              </div>
              <div className="text-muted-foreground truncate text-[11.5px]">{row.supplier}</div>
              <div className="mt-auto flex items-center justify-between gap-2 pt-1.5">
                <span className="font-mono text-xs font-medium tabular-nums">
                  {money(row.price, row.currency)}
                </span>
                <StatusDot status={row.status} />
              </div>
              {row.tags.length > 0 && (
                <div className="flex flex-wrap gap-1 pt-0.5">
                  {row.tags.slice(0, 3).map((tag) => (
                    <Tag key={tag}>{tag}</Tag>
                  ))}
                </div>
              )}
            </div>
          </article>
        )
      })}
    </div>
  )
}
