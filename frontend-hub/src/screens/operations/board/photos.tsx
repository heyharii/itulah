import { useQueries } from "@tanstack/react-query"
import { useState } from "react"

import { Thumbnail } from "@/components/ui/thumbnail"
import { cn } from "@/lib/utils"
import { useColourwayFill } from "@/lib/colourway-fill"
import { useCatalogueIdentity } from "@/lib/operations/catalogue"
import { photoKeyOf } from "@/lib/operations/photo-key"
import { koliManifestQuery, pickRoundQuery } from "@/lib/operations/queries"
import { ArticleSheet } from "@/screens/master/detail"

/// How many pictures a card carries before it says "+N".
const SHOWN = 4

/// **The articles on a card, as pictures** (owner, 16 Oct 2026: "semua
/// article pick pack dispatch bisa dilihat fotonya … saat ngambil perlu lihat
/// foto articlenya"). One picture per article, or per colour when its colours have photographs
/// of their own (`photoKeyOf`) — the photograph, or the Garment placeholder — in the order the SKUs
/// come, with "+N" for the rest.
export function ArticlePhotos({
  skus,
  className = "mt-2",
}: {
  skus: readonly string[]
  className?: string
}) {
  const catalogue = useCatalogueIdentity()
  const fill = useColourwayFill()
  /// A picture opens that article's master sheet, without stock.
  const [opened, setOpened] = useState<string | null>(null)
  const seen = new Map<
    string,
    {
      code: string | null
      url: string | null
      name: string
      division: string | null
      colour: string | null
    }
  >()
  const keyOf = photoKeyOf(skus, catalogue)
  for (const sku of skus) {
    const identity = catalogue.get(sku)
    const key = keyOf(sku)
    if (seen.has(key)) continue
    seen.set(key, {
      code: identity?.article_code ?? null,
      url: identity?.image_url ?? null,
      name: identity?.article_name ?? "",
      division: identity?.division_code ?? null,
      colour: identity?.colour ?? null,
    })
  }
  const all = [...seen.entries()]
  if (all.length === 0) return null
  const more = all.length - SHOWN
  return (
    <span className={cn("flex shrink-0 items-center gap-1.5", className)}>
      {all.slice(0, more > 0 ? SHOWN - 1 : SHOWN).map(([key, one]) => {
        const picture = (
          <Thumbnail
            url={one.url}
            name={one.name}
            division={one.division}
            colours={fill(one.colour)}
            className="size-12 shrink-0 rounded-inner"
          />
        )
        const code = one.code
        if (code === null) return <span key={key}>{picture}</span>
        const stop = (event: { stopPropagation: () => void }) =>
          event.stopPropagation()
        return (
          // A span acting as a button: the board card around it is a
          // button already, and a button may not hold another.
          <span
            key={key}
            role="button"
            tabIndex={0}
            aria-label={`Open ${one.name}`}
            onClick={(event) => {
              event.stopPropagation()
              event.preventDefault()
              setOpened(code)
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== " ") return
              event.stopPropagation()
              event.preventDefault()
              setOpened(code)
            }}
            onPointerDown={stop}
            onMouseDown={stop}
            onTouchStart={stop}
            className="shrink-0 cursor-pointer rounded-inner transition-transform duration-150 active:scale-[0.96]"
          >
            {picture}
          </span>
        )
      })}
      {more > 0 && (
        <span className="grid size-12 shrink-0 place-items-center rounded-inner bg-soft text-body tabular-nums">
          +{more + 1}
        </span>
      )}
      {opened !== null && (
        <ArticleSheet
          articleCode={opened}
          open
          onClose={() => setOpened(null)}
          stock={false}
          readOnly
        />
      )}
    </span>
  )
}

/// A store's picked pile, as pictures: what its picklists still hold for
/// packing.
export function PilePhotos({ sessions }: { sessions: readonly string[] }) {
  const reads = useQueries({
    queries: sessions.map((id) => ({
      ...pickRoundQuery(id),
      staleTime: 60_000,
    })),
  })
  const skus = reads.flatMap((read) =>
    (read.data?.lines ?? [])
      .filter((line) => line.waiting > 0)
      .map((line) => line.sku_code)
  )
  return <ArticlePhotos skus={skus} />
}

/// A store's sealed koli, as pictures: what is inside them.
export function KoliPhotos({
  koli,
  className,
}: {
  koli: readonly string[]
  className?: string
}) {
  const reads = useQueries({
    queries: koli.map((id) => ({
      ...koliManifestQuery(id),
      staleTime: 60_000,
    })),
  })
  const skus = reads.flatMap((read) =>
    (read.data?.lines ?? []).map((line) => line.sku_code)
  )
  return <ArticlePhotos skus={skus} className={className} />
}
