import { useQuery } from "@tanstack/react-query"

import { ZoomPhoto } from "@/components/ui/photo-viewer"
import { Thumbnail } from "@/components/ui/thumbnail"
import { useColourwayFill } from "@/lib/colourway-fill"
import {
  articleImage,
  articleMainImage,
  procurementKeys,
} from "@/lib/queries/procurement"
import { cn } from "@/lib/utils"

/// A photograph does not change, a presigned link expires. Ten minutes sits
/// inside the server's own read TTL (the same figure `article-pictures.ts`
/// uses), so every row of one colourway shares one read.
const STALE = 10 * 60 * 1000

/// A SKU code is the article's eight digits, one colour digit and a size
/// (`backend/src/cloud/media.rs`), so the colourway a SKU belongs to is read
/// off the code. `null` when the code does not start with the article's.
export function colourDigitOf(
  articleCode: string,
  skuCode: string
): string | null {
  if (!skuCode.startsWith(articleCode)) return null
  const digit = skuCode.charAt(articleCode.length)
  return /^\d$/.test(digit) ? digit : null
}

/// The small photograph beside an article or a colourway on the Allotment
/// screens: 32px, a tap shows it full size, and a missing photograph is the
/// painted silhouette the rest of the hub draws.
///
/// `url` is what the screen's own payload carried (`image_url`). A colourway
/// that has a photograph of its own (`digit`) shows that one, and an article
/// whose payload had none looks for its main picture — each a read keyed by
/// article and colour, so the rows of one colourway ask once and a list that
/// only draws what is on screen asks for what is on screen.
export function ArticleThumb({
  url,
  name,
  division,
  colour,
  articleCode,
  digit,
  bare = false,
  className,
}: {
  url: string | null | undefined
  name: string
  division?: string | null
  colour?: string | null
  articleCode: string
  /// The colourway's digit, for a row that is one colourway; leave out for the
  /// article's own row.
  digit?: string | null
  /// Nothing at all when there is no photograph: no painted silhouette and no
  /// empty box. For the allotment grid, where a stand-in on every row said
  /// nothing the row did not (owner, 2026-10-10).
  bare?: boolean
  /// The size; `size-8` unless the row is taller than its neighbours.
  className?: string
}) {
  const fill = useColourwayFill()
  const own = useQuery({
    queryKey: procurementKeys.articleImage(articleCode, digit ?? ""),
    queryFn: ({ signal }) => articleImage(articleCode, digit ?? "", signal),
    enabled: articleCode !== "" && digit != null,
    staleTime: STALE,
  })
  const main = useQuery({
    queryKey: procurementKeys.articleMainImage(articleCode),
    queryFn: ({ signal }) => articleMainImage(articleCode, signal),
    enabled: articleCode !== "" && digit == null && !url,
    staleTime: STALE,
  })
  const shown = own.data?.url ?? url ?? main.data?.url ?? null

  if (bare && shown === null) return null

  return (
    <ZoomPhoto
      url={shown}
      name={name}
      placeholder={
        bare ? undefined : (
        <Thumbnail
          url={null}
          name={name}
          division={division}
          colours={fill(colour)}
          className="size-[min(20rem,70vw)] rounded-card"
        />
        )
      }
      className={cn("block size-8 shrink-0", className)}
    >
      <Thumbnail
        url={shown}
        name={name}
        division={division}
        colours={fill(colour)}
        className={cn(
          "size-8 shrink-0 rounded-inner border border-hairline",
          className
        )}
      />
    </ZoomPhoto>
  )
}
