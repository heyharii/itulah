import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import type { CommercialProduct } from "@/lib/commercial-products"
import { productsKey, searchProducts } from "@/lib/commercial-products"
import { money } from "@/lib/money"
import { cn } from "@/lib/utils"
import { useQuery } from "@tanstack/react-query"
import { Search } from "lucide-react"
import { useState } from "react"

/// Pick the product a price is being written for.
///
/// The current price is shown beside each result, and that is the point rather
/// than decoration: a price book is a list of CHANGES, and the commonest
/// expensive mistake here is restating a price that had not changed — which
/// republishes it under a newer version and takes whatever was typed as the new
/// truth. Somebody who can see 200.000 next to the shirt does not retype
/// 200.000 by accident.
export function ProductPicker({
  value,
  onPick,
  placeholder = "Search a code or a name…",
}: {
  value: string
  onPick: (product: CommercialProduct) => void
  placeholder?: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const products = useQuery({
    queryKey: productsKey(query),
    queryFn: ({ signal }) => searchProducts(query, signal),
    enabled: open,
  })

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            className={cn(
              "flex h-8 w-full items-center gap-1.5 rounded-md border px-2 text-left text-[12px]",
              "hover:bg-accent/50",
              value === "" && "text-muted-foreground",
            )}
          >
            <Search className="size-3.5 shrink-0 opacity-60" />
            <span className="truncate">{value === "" ? placeholder : value}</span>
          </button>
        }
      />
      <PopoverContent className="w-90 p-0" align="start">
        <div className="border-b p-1.5">
          <Input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Code, style or description"
            className="h-8 text-[12px]"
          />
        </div>
        <div className="max-h-72 overflow-y-auto py-1">
          {products.isPending ? (
            <p className="text-muted-foreground px-3 py-4 text-center text-[11.5px]">
              Looking…
            </p>
          ) : (products.data?.length ?? 0) === 0 ? (
            <p className="text-muted-foreground px-3 py-4 text-center text-[11.5px]">
              Nothing matches that.
            </p>
          ) : (
            products.data?.map((product) => (
              <button
                key={product.sku_id}
                type="button"
                className="hover:bg-accent/60 flex w-full items-center gap-2 px-2.5 py-1.5 text-left"
                onClick={() => {
                  onPick(product)
                  setOpen(false)
                }}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px]">
                    {product.article_name}
                    {product.color !== null && (
                      <span className="text-muted-foreground"> · {product.color}</span>
                    )}
                    {product.size !== null && (
                      <span className="text-muted-foreground"> · {product.size}</span>
                    )}
                  </span>
                  <span className="text-muted-foreground block truncate font-mono text-[10.5px]">
                    {product.sku_code}
                  </span>
                </span>
                {/* Never a zero. A product no book has priced shows as "not
                    priced", because "no price" and "free" are different facts. */}
                <span className="shrink-0 font-mono text-[11px] tabular-nums">
                  {product.unit_price_minor === null ? (
                    <span className="text-muted-foreground">not priced</span>
                  ) : (
                    money(product.unit_price_minor)
                  )}
                </span>
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
