import { ImageOff } from "lucide-react"

import { words } from "@/lib/format"

/// The one way the store app names an article or a SKU in a list: a photo
/// tile (52×64, a neutral placeholder when there is none), the id, the name,
/// the division and the tags.
export function ArticleCell({
  photo,
  id,
  name,
  division,
  tags,
}: {
  /// The picture, drawn to fill the tile; null draws the placeholder.
  photo: React.ReactNode | null
  /// Article id, or a SKU id already through the sku formatter.
  id: string
  name: string
  division: string | null
  tags: readonly string[]
}) {
  return (
    <div className="flex min-w-0 items-center gap-4">
      <div className="grid h-16 w-[3.25rem] shrink-0 place-items-center overflow-hidden rounded-md bg-soft-2 text-line-ico">
        {photo ?? <ImageOff className="size-5" aria-label="No photograph" />}
      </div>
      <div className="flex min-w-0 flex-col gap-1 leading-5">
        <div className="truncate text-[0.9375rem] font-semibold text-ink">
          {name}
        </div>
        <div className="truncate font-mono text-[0.9375rem] text-mute">
          {id}
        </div>
        <div className="mt-0.5 flex min-w-0 items-center gap-1.5 overflow-hidden text-[0.9375rem] whitespace-nowrap text-body">
          <span className="mr-1 shrink-0 font-medium">
            {division ? words(division) : "No division"}
          </span>
          {tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex h-6 shrink-0 items-center rounded-full border border-hairline-2 bg-canvas px-2.5 text-[0.9375rem] font-medium text-ink shadow-[0_1px_0_rgb(16_24_40/4%)]"
            >
              {words(tag)}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
