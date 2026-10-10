import { useEffect, useRef } from "react"

import { count, quantity } from "@/lib/format"
import { useIdentity } from "@/lib/session"
import { cn } from "@/lib/utils"

/// What the supplier book comes to, said as a sentence under the title on a
/// phone (owner, 2026-10-06: "Suppliers like Orders") — the five figures of the
/// strip, which a desk keeps as cards, in the header band the order book has.
///
///  "Hi Rina, **4 suppliers** are active and 2 are not. 8 orders are open,
///   21.060 pcs, Rp 4,0 B."
///
/// The band is the white of the top bar carried down under the title, with the
/// bar's own rule dropped while it is in view (`top-bar.tsx` reads
/// `data-header-band`); it scrolls away with the list.
export function SupplierBand({
  active,
  inactive,
  orders,
  pieces,
  value,
  className,
}: {
  /// All the server's own figures, or undefined while they are read.
  active: number | undefined
  inactive: number | undefined
  orders: number | undefined
  pieces: number | undefined
  /// "Rp 4,0 B", already short.
  value: string | undefined
  className?: string
}) {
  const identity = useIdentity()
  const first = (
    identity.data?.display_name ??
    identity.data?.username ??
    ""
  ).split(" ")[0]
  const band = useRef<HTMLParagraphElement>(null)
  useEffect(() => {
    const root = document.documentElement
    const node = band.current
    if (node === null || getComputedStyle(node).display === "none") return
    const watch = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) root.dataset.headerBand = ""
      else delete root.dataset.headerBand
    })
    watch.observe(node)
    return () => {
      watch.disconnect()
      delete root.dataset.headerBand
    }
  }, [])
  const ready =
    active !== undefined &&
    inactive !== undefined &&
    orders !== undefined &&
    pieces !== undefined &&
    value !== undefined
  return (
    <p
      ref={band}
      className={cn(
        "min-h-6 text-[0.9375rem] leading-normal text-pretty text-body max-md:-mx-4 max-md:-mt-4 max-md:mb-4 max-md:border-b max-md:border-hairline max-md:bg-canvas max-md:px-4 max-md:pt-0.5 max-md:pb-3.5",
        className
      )}
    >
      {ready && (
        <span className="transition-opacity duration-200 ease-(--ease-out) starting:opacity-0">
          {first !== "" && `Hi ${first}, `}
          <b className="font-semibold text-ink tabular-nums">
            {count(active)} {active === 1 ? "supplier" : "suppliers"}
          </b>{" "}
          {active === 1 ? "is" : "are"} active
          {inactive > 0 && (
            <>
              {" "}
              and {count(inactive)} {inactive === 1 ? "is" : "are"} not
            </>
          )}
          .{" "}
          {orders === 0
            ? "No order is open."
            : `${count(orders)} ${orders === 1 ? "order is" : "orders are"} open, ${quantity(pieces)}, ${value}.`}
        </span>
      )}
    </p>
  )
}
