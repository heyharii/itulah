/// A product photograph in the sale grid and on the item card. The node serves
/// it (`/api/v1/catalog/image?sku=`), the shell hands it over as a data URL
/// (`edgeImage`), and it is kept per SKU for as long as the till is open —
/// scanning the same garment twenty times is one fetch. Without a photograph
/// (or while it is on its way) a plain square holds the place; never a broken
/// image.

import { useEffect, useState } from "react"

import { edgeImage } from "@/edge"

const KEPT = new Map<string, Promise<string | null>>()
// A few at a time: a basket read off the reader can name twenty SKUs at once.
let flying = 0
const waiting: Array<() => void> = []

function turn(): void {
  while (flying < 4 && waiting.length > 0) waiting.shift()?.()
}

export function photoOf(sku: string): Promise<string | null> {
  const kept = KEPT.get(sku)
  if (kept !== undefined) return kept
  const asked = new Promise<string | null>((resolve) => {
    waiting.push(() => {
      flying += 1
      void edgeImage(sku)
        .catch(() => null)
        .then((url) => {
          flying -= 1
          // Not having one is remembered for a minute, not for the day: the
          // node may not have been up yet.
          if (url === null) setTimeout(() => KEPT.delete(sku), 60_000)
          resolve(url)
          turn()
        })
    })
    turn()
  })
  KEPT.set(sku, asked)
  return asked
}

export function usePhoto(sku: string, has: boolean): string | null {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    setUrl(null)
    if (!has || sku === "") return
    let live = true
    void photoOf(sku).then((found) => live && setUrl(found))
    return () => {
      live = false
    }
  }, [sku, has])
  return url
}

export function Photo({
  sku,
  has,
  className,
}: {
  sku: string
  has: boolean
  className?: string
}) {
  const url = usePhoto(sku, has)
  const classes = className === undefined ? "ph" : `ph ${className}`
  return url === null ? (
    <span className={`${classes} none`} aria-hidden="true" />
  ) : (
    <img className={classes} src={url} alt="" decoding="async" draggable={false} />
  )
}
