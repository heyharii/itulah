import { useEffect, useRef } from "react"
import autoAnimate from "@formkit/auto-animate"

/// Animate a list whose ITEMS come and go.
///
/// The browser has no transition for "this row was not here and now it is, and
/// the ones below it moved down". CSS can fade a thing in; it cannot say where
/// its neighbours went. That gap is the whole reason for the 2 KB.
///
/// ## Where it must NOT go
///
/// **Not on a virtualised table body.** Rows there mount and unmount as a
/// matter of course — that is what virtualising IS — so every flick of the
/// scroll wheel would look like thirty rows being inserted. The list moves
/// under the window; the rows are not arriving.
///
/// **Not on anything the server reordered.** When a sort flips, every row moves
/// at once; animating that is thirty simultaneous travels, which reads as the
/// page shaking rather than as an order changing.
///
/// So: short lists, whose length actually changes, that a person is watching
/// while they change it. The filter panel is the case — ticking a box or typing
/// in the search takes facets out of the list, and without this they simply
/// blink out from under the cursor.
export function useAnimatedList<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  useEffect(() => {
    if (!ref.current) return
    // `prefers-reduced-motion` is honoured by the library itself; the duration
    // is our panel band, so a facet leaving settles at the same speed as
    // everything else in this app.
    autoAnimate(ref.current, {
      duration: 200,
      easing: "cubic-bezier(0.23,1,0.32,1)",
    })
  }, [])
  return ref
}
