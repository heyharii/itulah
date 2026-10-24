import { Thumbnail } from "@/components/ui/thumbnail"
import type { Identity } from "@/lib/operations/catalogue"
import { cn } from "@/lib/utils"

/// The article's picture, 40px: its photograph when the catalogue has one, else
/// the garment drawn in its colour. An item nobody has identified yet has
/// neither, and gets the silhouette its typed name asks for.
export function ArticleThumb({
  skuCode,
  name,
  colour,
  identities,
  fill,
  className,
}: {
  skuCode: string | null
  name: string
  colour: string | null
  identities: ReadonlyMap<string, Identity>
  fill: (colour: string | null | undefined) => readonly string[]
  className?: string
}) {
  const identity = skuCode === null ? undefined : identities.get(skuCode)
  return (
    <Thumbnail
      url={identity?.image_url ?? null}
      name={name}
      division={identity?.division_code}
      colours={fill(colour ?? identity?.colour ?? null)}
      className={cn("size-10 shrink-0 rounded-[8px]", className)}
    />
  )
}

/// The round mark of a choice of one: empty, or filled in the accent. Drawn
/// for a row that is the choice, so the row itself is the radio.
export function RadioDot({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid size-5 shrink-0 place-items-center rounded-full border-[1.5px] transition-[border-color] duration-(--t-press) ease-(--ease-out)",
        on ? "border-accent" : "border-hairline-strong"
      )}
    >
      <span
        className={cn(
          "size-2.5 rounded-full bg-accent transition-[scale] duration-(--t-press) ease-(--ease-out) motion-reduce:transition-none",
          on ? "scale-100" : "scale-0"
        )}
      />
    </span>
  )
}
