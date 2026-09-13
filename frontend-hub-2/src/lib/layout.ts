import { useEffect, useState } from "react"

/// Where the navigation lives, decided by width.
///
/// Two breakpoints, and each is the width at which something specific stops
/// working rather than a number off a device chart:
///
///   `docked` (≥ 1024) — rail and sidebar both stand beside the content. Below
///     this the two of them take 304px, and a six-column list is left with a
///     frame too narrow for the three columns it may never drop. The list
///     cannot solve that by hiding more; the shell has to give the width back.
///
///   `rail` (≥ 768) — the rail stays, the sidebar becomes a drawer over the
///     content. 56px for a strip that switches department is a fair price at
///     tablet width and it keeps navigation one press away.
///
///   `bare` (< 768) — both fold into a drawer behind a top bar. A permanent
///     56px strip on a 375px screen is a seventh of it, for something a thumb
///     opens once a session.
export type Layout = "docked" | "rail" | "bare"

export function useLayout(): Layout {
  const [layout, setLayout] = useState<Layout>(() => read())
  useEffect(() => {
    // Two queries rather than a resize listener: the browser only wakes this
    // up when a boundary is actually crossed, instead of on every pixel of a
    // drag.
    const wide = window.matchMedia("(min-width: 1024px)")
    const mid = window.matchMedia("(min-width: 768px)")
    const on = () => setLayout(read())
    wide.addEventListener("change", on)
    mid.addEventListener("change", on)
    return () => {
      wide.removeEventListener("change", on)
      mid.removeEventListener("change", on)
    }
  }, [])
  return layout
}

function read(): Layout {
  if (typeof window === "undefined") return "docked"
  if (window.matchMedia("(min-width: 1024px)").matches) return "docked"
  if (window.matchMedia("(min-width: 768px)").matches) return "rail"
  return "bare"
}
