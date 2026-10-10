import { PhotoImg } from "@/components/ui/photo-img"
import { ZoomPhoto } from "@/components/ui/photo-viewer"
import { count } from "@/lib/format"

/// One variant of an order line as the bay counts it and the buyer reviews it
/// (owner, 2026-10-10): "Linen Shirt Black XL" — the article, then the colour
/// master's name and the size vocabulary's label. A code the masters do not
/// know is said as the code.
export function variantLabel(
  article: string,
  variant: {
    readonly colour_code: string | null
    readonly colour_label?: string | null
    readonly size_code: string | null
    readonly size_label?: string | null
  }
): string {
  return [
    article,
    variant.colour_label ?? variant.colour_code,
    variant.size_label ?? variant.size_code,
  ]
    .filter((part): part is string => part !== null && part !== "")
    .join(" ")
}

/// The same key the server keeps a variant's count under: its colour and its
/// size, never the variant row's id (a line's variants are rewritten whole on
/// every edit, 0961).
export function variantKey(variant: {
  readonly colour_code: string | null
  readonly size_code: string | null
}): string {
  return `${variant.colour_code ?? ""}|${variant.size_code ?? ""}`
}

/// A variant's photograph at the head of its row: the first of its own, else
/// the line's picture, else nothing (owner, 2026-10-10). A tap shows it full
/// size; "+2" says the buyer attached more. `slot` keeps the 40px box when there
/// is nothing to show, so the labels of one line's variants stay in a column.
export function VariantPhoto({
  urls,
  fallback,
  name,
  slot = false,
}: {
  urls: readonly string[] | undefined
  fallback: string | null | undefined
  name: string
  slot?: boolean
}) {
  const own = urls ?? []
  const first = own[0] ?? fallback ?? null
  const more = own.length - 1
  if (first === null || first === "")
    return slot ? <span aria-hidden className="size-10 shrink-0" /> : null
  return (
    <span className="flex shrink-0 items-center gap-1.5">
      <ZoomPhoto url={first} name={name} className="size-10">
        <span className="block size-10 overflow-hidden rounded-inner bg-soft-2">
          <PhotoImg url={first} alt={name} className="size-10 object-cover" />
        </span>
      </ZoomPhoto>
      {more > 0 && (
        <span className="text-[0.875rem] text-mute tabular-nums">
          {`+${count(more)}`}
        </span>
      )}
    </span>
  )
}
