import { createIsomorphicFn } from "@tanstack/react-start"
import { getCookie, getRequestHeader } from "@tanstack/react-start/server"

/// What the request says about the screen it will be drawn on, for the parts
/// of the first HTML that differ by layout: the server cannot measure a
/// window, so it reads what the browser told it last time (the `hub-vw`
/// cookie, `rememberViewport`) and otherwise guesses from the user agent. The
/// browser hydrates with the same answer — the server writes it on
/// `<html data-device data-vw>` (`routes/__root.tsx`) — before measuring for
/// real, so a refresh is drawn in the right shell from the first byte instead
/// of re-laying itself once the scripts run.
export interface DeviceHint {
  /// A touch phone: a coarse pointer, whatever the width.
  readonly phone: boolean
  /// The window's CSS width, as last measured, or the usual one for the kind.
  readonly width: number
}

/// The cookie the browser keeps its window width in.
const VIEWPORT_COOKIE = "hub-vw"
/// A first visit's guesses: an iPhone XR (the phone baseline) and a laptop.
const PHONE_WIDTH = 414
const DESK_WIDTH = 1440

export const deviceHint = createIsomorphicFn()
  .server((): DeviceHint => {
    // Chromium sends the client hint; Safari and Firefox do not, so the user
    // agent decides there. An absent header reads as "".
    const hint = getRequestHeader("sec-ch-ua-mobile")
    // "Mobi" is every phone browser's own word (Android tablets leave it
    // out); iPhones also say "iPhone".
    const phone = hint
      ? hint === "?1"
      : /Mobi|iPhone/.test(getRequestHeader("user-agent") ?? "")
    const measured = Number(getCookie(VIEWPORT_COOKIE))
    const width =
      Number.isFinite(measured) && measured > 0
        ? measured
        : phone
          ? PHONE_WIDTH
          : DESK_WIDTH
    return { phone, width }
  })
  .client((): DeviceHint => {
    const root = document.documentElement
    const phone = root.dataset.device === "phone"
    const width = Number(root.dataset.vw)
    return {
      phone,
      width: width > 0 ? width : phone ? PHONE_WIDTH : DESK_WIDTH,
    }
  })

/// Keeps the cookie the next request reads in step with the window. Called
/// once from the client boot; a resize writes the new width when it settles.
export function rememberViewport(): void {
  let timer: ReturnType<typeof setTimeout> | undefined
  const write = () => {
    document.cookie = `${VIEWPORT_COOKIE}=${window.innerWidth}; path=/; max-age=31536000; samesite=lax`
  }
  write()
  window.addEventListener("resize", () => {
    clearTimeout(timer)
    timer = setTimeout(write, 300)
  })
}
