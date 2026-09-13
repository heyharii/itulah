/// The tarsier line-mark — the only illustration in the system.
///
/// The simplified four-stroke form from the prototypes (head, two eyes, body)
/// rather than the full `mascot.svg`: at the sizes this surface uses it — the
/// login screen and the drawer's identity card — the ears, tee and tail
/// collapse into noise. It inherits `currentColor`, so it is `{ink}` on white
/// and white on a dark surface without a second asset.
export function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 116" aria-hidden="true" className={className}>
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth="4.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M50 8 C30 8 20 21 20 39 C20 54 31 63 50 63 C69 63 80 54 80 39 C80 21 70 8 50 8 Z" />
        <circle cx="36" cy="37" r="12" />
        <circle cx="64" cy="37" r="12" />
        <path d="M30 64 C26 82 30 103 50 103 C70 103 74 82 70 64" />
      </g>
      <g fill="currentColor" stroke="none">
        <circle cx="37" cy="39" r="4.6" />
        <circle cx="63" cy="39" r="4.6" />
      </g>
    </svg>
  )
}
