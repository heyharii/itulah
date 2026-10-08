import { useCallback, useState } from "react"

import { hasNoThumb, thumbUrl } from "@/lib/thumb"

/// How a catalogue photograph is drawn small: its thumbnail first
/// (`lib/thumb.ts`), the photograph itself if there is none, and a failure said
/// as a failure when neither comes.
///
/// It also decides when the picture appears. An `<img>` that is still coming
/// is a grey box and one that arrives is a flash; the picture fades in over
/// 150ms instead, from the box that was already there, and one the browser has
/// already got (the same photograph two rows up) is simply there.
export function usePhoto(
  url: string | null | undefined,
  options: { eager?: boolean } = {}
) {
  // The photograph that failed, so a new `url` starts clean without an effect
  // to clear it.
  const [failed, setFailed] = useState<string | null>(null)
  const [arrived, setArrived] = useState<string | null>(null)
  // Only to draw again once `hasNoThumb` has been told something.
  const [, again] = useState(0)

  const given = url === null || url === undefined || url === "" ? null : url
  const thumb = thumbUrl(given)
  const gone = given !== null && failed === given
  const src = gone ? null : (thumb ?? given)
  const loaded = src !== null && arrived === src

  // Held by the render that asked for it: a thumbnail that is not there turns
  // into the photograph; the photograph that is not there is `broken`.
  const onError = () => {
    if (given === null) return
    if (src !== null && src === thumb) {
      hasNoThumb(given)
      // Draw again: `thumbUrl` now says there is none, so `src` is the
      // photograph.
      again((count) => count + 1)
      return
    }
    setFailed(given)
  }

  // An image the browser already had is complete before `onLoad` can be
  // attached, and would otherwise wait at nought opacity for ever.
  const ref = useCallback(
    (node: HTMLImageElement | null) => {
      if (
        node !== null &&
        src !== null &&
        node.complete &&
        node.naturalWidth > 0
      )
        setArrived(src)
    },
    [src]
  )

  return {
    broken: gone,
    src,
    loaded,
    imgProps: {
      ref,
      src: src ?? undefined,
      loading: options.eager ? ("eager" as const) : ("lazy" as const),
      decoding: "async" as const,
      onError,
      onLoad: () => setArrived(src),
    },
  }
}
