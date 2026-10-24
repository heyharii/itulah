/// The fingerprint sensor as the prototype draws it: idle it breathes, a
/// finger draws the ridges in while a beam reads down, a match fills it blue
/// with a check, a refusal shakes it red. Shared by the door and the Kepala
/// toko's approval. Its CSS lives under `.pdoor` in pos.css.
import type { CSSProperties } from "react"

export type Read = "idle" | "reading" | "done" | "no"

/// lucide's fingerprint ridges, each drawn in from the centre out.
const RIDGES: readonly (readonly [string, number])[] = [
  ["M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4", 0],
  ["M14 13.12c0 2.38 0 6.38-1 8.88", 1],
  ["M8.65 22c.21-.66.45-1.32.57-2", 1],
  ["M9 6.8a6 6 0 0 1 9 5.2v2", 2],
  ["M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 .34-2", 2],
  ["M17.29 21.02c.12-.6.43-2.3.5-3.02", 3],
  ["M2 12a10 10 0 0 1 18-6", 4],
  ["M21.8 16c.2-2 .131-5.354 0-6", 4],
  ["M2 16h.01", 5],
]

export function Sensor({ state, onPress, small }: { state: Read; onPress: () => void; small?: boolean }) {
  return (
    <button className={`fp ${state}${small ? " sm" : ""}`} type="button" onClick={onPress} aria-label="Sensor sidik jari">
      <span className="fp-clip">
        <span className="fp-beam" />
      </span>
      <svg className="fp-glyph" viewBox="0 0 24 24">
        <g className="fp-base">
          {RIDGES.map(([d]) => (
            <path key={d} d={d} />
          ))}
        </g>
        <g className="fp-ink">
          {RIDGES.map(([d, o]) => (
            <path key={d} pathLength={1} style={{ "--o": o } as CSSProperties} d={d} />
          ))}
        </g>
      </svg>
      <span className="fp-fill" />
      <svg className="fp-check" viewBox="0 0 24 24">
        <path pathLength={1} d="M6.5 12.5l3.8 3.8 7.2-8.3" />
      </svg>
    </button>
  )
}


