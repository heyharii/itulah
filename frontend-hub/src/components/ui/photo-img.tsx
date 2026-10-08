import { usePhoto } from "@/lib/use-photo"
import { cn } from "@/lib/utils"

/// A photograph as a plain `<img>`, small. For the places that draw one beside
/// a name rather than inside a `Thumbnail` — the colourway tile, the article's
/// cover.
export function PhotoImg({
  url,
  alt,
  className,
  eager,
}: {
  url: string
  alt: string
  className?: string
  eager?: boolean
}) {
  const photo = usePhoto(url, { eager })
  return (
    <img
      {...photo.imgProps}
      alt={alt}
      className={cn(
        "transition-opacity duration-150 ease-out",
        photo.loaded ? "opacity-100" : "opacity-0",
        className
      )}
    />
  )
}
