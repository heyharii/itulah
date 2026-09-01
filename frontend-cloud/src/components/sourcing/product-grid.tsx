import { Checkbox } from "@/components/ui/checkbox"
import { money } from "@/lib/money"
import { cn } from "@/lib/utils"
import { Star } from "lucide-react"
import { StatusDot, Tag, Thumb } from "./columns"
import type { SourcingRow } from "./rows"

/// The same rows as the table, looked at rather than compared.
///
/// Clothing is bought by eye first: a buyer scanning for a shape or a colour is
/// not reading a price column. This view exists for that pass and deliberately
/// shows less — photo, name, supplier, price — with everything else a click
/// away in the table.
export function ProductGrid({
  rows,
  isSelected,
  onSelect,
  isShortlisted,
  onToggleShortlist,
}: {
  rows: readonly SourcingRow[]
  isSelected: (id: string) => boolean
  onSelect: (id: string, selected: boolean) => void
  isShortlisted: (id: string) => boolean
  onToggleShortlist: (id: string) => void
}) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(178px,1fr))] gap-2.5 p-3.5">
      {rows.map((row) => {
        const selected = isSelected(row.id)
        const staged = isShortlisted(row.id)
        return (
          <article
            key={row.id}
            className={cn(
              "group relative flex flex-col overflow-hidden rounded-lg border transition-colors",
              selected ? "border-primary ring-primary/20 ring-2" : "hover:border-foreground/20",
            )}
          >
            <div className="relative">
              <Thumb row={row} className="aspect-4/5 w-full rounded-none object-cover" />
              <div
                className={cn(
                  "absolute top-2 left-2 transition-opacity",
                  selected ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-within:opacity-100",
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
                aria-pressed={staged}
                aria-label={staged ? "Remove from shortlist" : "Add to shortlist"}
                onClick={() => onToggleShortlist(row.id)}
                className={cn(
                  "bg-background/90 absolute top-2 right-2 grid size-7 place-items-center rounded-md backdrop-blur transition-opacity",
                  staged ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus:opacity-100",
                )}
              >
                <Star
                  className={cn(
                    "size-4",
                    staged ? "fill-amber-400 text-amber-500" : "text-muted-foreground",
                  )}
                />
              </button>
            </div>

            <div className="flex min-w-0 flex-1 flex-col gap-1 p-2.5">
              <div className="truncate text-[13px] font-medium">{row.name}</div>
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
