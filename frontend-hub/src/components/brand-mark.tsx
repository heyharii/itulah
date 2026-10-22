import { useId } from "react"

import { cn } from "@/lib/utils"

/// The app icon, drawn rather than loaded: Matte · Deep (owner, 2026-10-20,
/// `central-icon-options.html`: "matte deep oke"). A matte blue tile whose
/// tone darkens toward its foot, a pale C standing on it with a soft contact
/// shadow, and the one yellow dot in the C's mouth — no shine anywhere, the
/// same matte language as the department pictures. The same picture as
/// `public/pwa-*.png` (`scripts/pwa-icons.mjs`), so the mark on the sign-in
/// door is the one on the person's home screen, and sharp at any size.
///
/// It replaces the near-black tile with a white C and a blue dot (6 Oct).
export function BrandMark({ className }: { className?: string }) {
  // Each mark carries its own gradients: two on one page must not share ids.
  const id = useId().replace(/:/g, "")
  return (
    <svg
      viewBox="0 0 100 100"
      aria-hidden
      className={cn("size-8 shrink-0", className)}
    >
      <defs>
        <linearGradient id={`${id}t`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#4277e6" />
          <stop offset="1" stopColor="#1f4fc0" />
        </linearGradient>
        <linearGradient id={`${id}c`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#d3e0fa" />
        </linearGradient>
        <linearGradient id={`${id}d`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffd766" />
          <stop offset="1" stopColor="#eaa20f" />
        </linearGradient>
        <filter
          id={`${id}s`}
          x="-40%"
          y="-40%"
          width="180%"
          height="180%"
        >
          <feGaussianBlur stdDeviation="1.8" />
        </filter>
      </defs>
      <rect width="100" height="100" rx="23.4" fill={`url(#${id}t)`} />
      <ellipse
        cx="48"
        cy="84"
        rx="25"
        ry="3.4"
        fill="#0b2466"
        opacity=".4"
        filter={`url(#${id}s)`}
      />
      <path
        d="M64.32 28.88A28.25 28.25 0 1 0 64.32 68.12A7.25 7.25 0 0 0 53.89 58.05A13.75 13.75 0 1 1 53.89 38.95A7.25 7.25 0 0 0 64.32 28.88Z"
        fill={`url(#${id}c)`}
      />
      <circle cx="75.5" cy="48.5" r="8" fill={`url(#${id}d)`} />
    </svg>
  )
}
