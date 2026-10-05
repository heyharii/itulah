import { cn } from "@/lib/utils"

/// The app icon, drawn rather than loaded: a black tile, a white "C", the blue
/// dot. The same picture as `public/pwa-*.png`, so the mark on the sign-in
/// door is the one on the person's home screen, and sharp at any size.
///
/// The tile carries a hairline of white on its inside edge. On charcoal a
/// black square with no edge is a hole in the page; the line is what makes it
/// an object lying on it.
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      aria-hidden
      className={cn("size-8 shrink-0", className)}
    >
      <rect width="32" height="32" rx="7.5" fill="#111214" />
      <rect
        x="0.5"
        y="0.5"
        width="31"
        height="31"
        rx="7"
        fill="none"
        stroke="rgb(255 255 255 / 10%)"
      />
      <path
        d="M18.2 11.6A6.5 6.5 0 1 0 18.2 20.4"
        fill="none"
        stroke="#fff"
        strokeWidth="3.6"
        strokeLinecap="round"
      />
      <circle cx="23.4" cy="16" r="2.2" fill="var(--accent)" />
    </svg>
  )
}
