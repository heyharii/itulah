import { useQuery } from "@tanstack/react-query"
import { ChevronRight } from "lucide-react"
import { use } from "react"

import { Thumbnail } from "@/components/ui/thumbnail"
import { useColourwayFill } from "@/lib/colourway-fill"
import { count } from "@/lib/format"
import {
  allotmentDetail,
  inventoryKeys,
  type AllotmentLine,
} from "@/lib/queries/inventory"
import { queryState } from "@/lib/query-state"
import { cn } from "@/lib/utils"
import { ExpandContext } from "@/screens/allotment/expanding"

/// An allotment's goods, opened out under its row: an article at a time, its
/// SKUs beneath. The chevron is the only thing that opens it — the row itself
/// still opens the sheet.

export function ExpandToggle({ id, number }: { id: string; number: string }) {
  const expanding = use(ExpandContext)
  if (expanding === null) throw new Error("ExpandContext is missing")
  const open = expanding.isOpen(id)
  return (
    <span
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
      className="-mx-1 flex"
    >
      <button
        type="button"
        aria-expanded={open}
        aria-label={`Show the items of ${number}`}
        onClick={() => expanding.toggle(id)}
        className="grid size-8 place-items-center rounded-full text-line-ico transition-colors hover:bg-soft-2 hover:text-text pointer-coarse:size-tap"
      >
        <ChevronRight
          className={cn(
            "size-4 transition-transform duration-150",
            open && "rotate-90"
          )}
        />
      </button>
    </span>
  )
}

interface ArticleGroup {
  readonly id: string
  readonly name: string
  readonly code: string
  readonly image: string | null
  /// The first colourway the article is allotted in; the placeholder wears it.
  readonly colour: string | null
  readonly pieces: number
  readonly skus: readonly {
    readonly id: string
    readonly code: string
    readonly variant: string
    readonly pieces: number
  }[]
}

type Mutable = {
  -readonly [
    K in keyof ArticleGroup
  ]: ArticleGroup[K] extends readonly (infer U)[]
    ? { -readonly [J in keyof U]: U[J] }[]
    : ArticleGroup[K]
}

/// The lines folded to an article each, SKUs summed across stores.
function groupsOf(lines: readonly AllotmentLine[]): readonly ArticleGroup[] {
  const articles = new Map<string, Mutable>()
  for (const line of lines) {
    let article = articles.get(line.article_id)
    if (!article) {
      article = {
        id: line.article_id,
        name: line.article_name,
        code: line.article_code,
        image: line.image_url,
        colour: line.colour,
        pieces: 0,
        skus: [],
      }
      articles.set(line.article_id, article)
    }
    article.pieces += line.quantity
    const sku = article.skus.find((one) => one.id === line.sku_id)
    if (sku) sku.pieces += line.quantity
    else
      article.skus.push({
        id: line.sku_id,
        code: line.sku_code,
        variant:
          [line.colour, line.size].filter((one) => one).join(" · ") || "—",
        pieces: line.quantity,
      })
  }
  return [...articles.values()]
}

/// The block under an opened allotment row.
export function AllotmentItems({ id }: { id: string }) {
  const colourFill = useColourwayFill()
  const detail = useQuery({
    queryKey: inventoryKeys.allotment(id),
    queryFn: ({ signal }) => allotmentDetail(id, signal),
  })
  return (
    <div className="bg-soft py-2 pr-5 pl-14">
      {queryState(detail, {
        loading: "Reading the items…",
        render: (data) => {
          const groups = groupsOf(data.lines)
          return groups.length === 0 ? (
            <p className="py-2 text-[0.875rem] text-body">No items.</p>
          ) : (
            groups.map((article) => (
              <div key={article.id} className="py-1.5">
                <div className="flex min-h-12 items-center gap-3">
                  <Thumbnail
                    url={article.image}
                    name={article.name}
                    colours={colourFill(article.colour)}
                    className="size-10 shrink-0 rounded-inner"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[0.9375rem] text-ink">
                      {article.name}
                    </span>
                    <span className="block truncate font-mono text-[0.875rem] text-mute">
                      {article.code}
                    </span>
                  </span>
                  <span className="shrink-0 text-[0.9375rem] text-ink tabular-nums">
                    {count(article.pieces)} pcs
                  </span>
                </div>
                {article.skus.map((sku) => (
                  <div
                    key={sku.id}
                    className="flex min-h-9 items-center gap-3 pl-[3.25rem] text-[0.875rem]"
                  >
                    <span className="min-w-0 flex-1 truncate text-body">
                      {sku.variant}{" "}
                      <span className="font-mono text-mute">{sku.code}</span>
                    </span>
                    <span className="shrink-0 text-body tabular-nums">
                      {count(sku.pieces)} pcs
                    </span>
                  </div>
                ))}
              </div>
            ))
          )
        },
      })}
    </div>
  )
}
