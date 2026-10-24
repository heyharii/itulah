/// The fingerprint sensor as the prototype draws it: idle it breathes, a
/// finger draws the ridges in while a beam reads down, a match fills it blue
/// with a check, a refusal shakes it red. Shared by the door and the Kepala
/// toko's approval. Its CSS lives under `.pdoor` in pos.css.
///
/// Enrolling (`screens/fingerprint-enrol.tsx`) adds what the door has no use
/// for: a ring of one segment per press around it, the ridges drawn in a
/// share at a time as presses are taken (`progress`), a ripple each time one
/// is (`pulse`), and a short shake when a press has to be made again
/// (`nudge`). Enrolling is rare, so it may say more than the door does.
import { useEffect, useRef, type CSSProperties } from "react"

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

/// How many rings of ridges there are, centre out.
const LEVELS = 6

/// Presses taken towards an enrolment.
export type Progress = { readonly done: number; readonly needed: number }

/// The strong ease-out the till's motion uses (`--ease-out` in pos.css), for
/// what WAAPI plays here.
const EASE_OUT = "cubic-bezier(0.23, 1, 0.32, 1)"

function reduced(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches
}

export function Sensor({
  state,
  onPress,
  small,
  progress,
  pulse = 0,
  nudge = 0,
}: {
  state: Read
  onPress: () => void
  small?: boolean
  progress?: Progress
  /// Bumped each time a press is taken: a ripple runs out from the sensor.
  pulse?: number
  /// Bumped each time a press has to be made again: the sensor shakes.
  nudge?: number
}) {
  const button = useRef<HTMLButtonElement>(null)
  const ripple = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (pulse === 0 || ripple.current === null) return
    ripple.current.animate(
      reduced()
        ? [{ opacity: 0.4 }, { opacity: 0 }]
        : [
            { opacity: 0.45, transform: "scale(1)" },
            { opacity: 0, transform: "scale(1.32)" },
          ],
      { duration: reduced() ? 200 : 620, easing: EASE_OUT },
    )
  }, [pulse])

  useEffect(() => {
    if (nudge === 0 || button.current === null || reduced()) return
    button.current.animate(
      [
        { transform: "translateX(0)" },
        { transform: "translateX(-7px)", offset: 0.2 },
        { transform: "translateX(6px)", offset: 0.42 },
        { transform: "translateX(-3px)", offset: 0.66 },
        { transform: "translateX(0)" },
      ],
      { duration: 360, easing: EASE_OUT },
    )
  }, [nudge])

  // Enrolling draws the ridges in a share per press; the door draws them all
  // at once while it reads.
  const shown =
    progress === undefined
      ? null
      : state !== "idle"
        ? LEVELS
        : Math.ceil((LEVELS * Math.min(progress.done, progress.needed)) / Math.max(progress.needed, 1))

  return (
    <button
      ref={button}
      className={`fp ${state}${small ? " sm" : ""}${shown !== null ? " staged" : ""}`}
      type="button"
      onClick={onPress}
      aria-label="Sensor sidik jari"
    >
      <span ref={ripple} className="fp-ripple" aria-hidden="true" />
      {progress !== undefined && <Ring progress={progress} complete={state === "reading" || state === "done"} />}
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
            <path
              key={d}
              pathLength={1}
              className={shown !== null && o < shown ? "on" : undefined}
              style={{ "--o": o } as CSSProperties}
              d={d}
            />
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

/// One arc per press needed, around the sensor; an arc fills as its press is
/// taken, and all of them once the template is whole.
function Ring({ progress, complete }: { progress: Progress; complete: boolean }) {
  const needed = Math.max(progress.needed, 1)
  // Each arc is its share of the circle less a gap, on a path of length 100.
  const gap = needed > 1 ? 4 : 0
  const length = 100 / needed - gap
  return (
    <svg className="fp-ring" viewBox="0 0 100 100" aria-hidden="true">
      {Array.from({ length: needed }, (_, at) => {
        const turn = -90 + (360 / needed) * at + (gap / 100) * 180
        const filled = complete || at < progress.done
        return (
          <g key={at} transform={`rotate(${turn} 50 50)`}>
            <circle className="fp-ring-track" cx="50" cy="50" r="48" pathLength={100} strokeDasharray={`${length} 100`} />
            <circle
              className={`fp-ring-fill${filled ? " on" : ""}`}
              cx="50"
              cy="50"
              r="48"
              pathLength={100}
              strokeDasharray={`${length} 100`}
              style={{ "--len": length } as CSSProperties}
            />
          </g>
        )
      })}
    </svg>
  )
}
