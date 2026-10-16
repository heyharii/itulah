/* The map of every way a PO can go, drawn like a transit map: one trunk
   (New PO → Submit → Receiving), then a branch for each thing a count can
   find, all meeting again at Done — except Recount, which loops back to
   Receiving. Lines not yet walked are hairline grey; walked ones are ink; the
   blue dot is the order. */
import type { CSSProperties } from "react"
import { lerp } from "../motion"
import type { ScenarioId } from "../scenarios"
import { BRANCHES } from "../scenarios"

const Y0 = 206
const GAP = 84
export const branchY = (i: number) => Y0 + i * GAP
const TRUNK = [
  { x: 200, label: "New PO" },
  { x: 430, label: "Submit" },
  { x: 660, label: "Receiving" },
] as const
const SPINE = 660
const END = 1580
const DONE = { x: 1730, y: branchY(2.5) }

export const STATIONS: Record<ScenarioId, { x: number; label: string }[]> = {
  match: [
    { x: 860, label: "Pas" },
    { x: 1160, label: "Diterima otomatis" },
  ],
  shortKeep: [
    { x: 860, label: "Kurang" },
    { x: 1160, label: "Partial Receive" },
    { x: 1420, label: "Kiriman berikutnya" },
  ],
  shortClose: [
    { x: 860, label: "Kurang" },
    { x: 1160, label: "Close Short" },
  ],
  over: [
    { x: 860, label: "Lebih" },
    { x: 1160, label: "Submit" },
    { x: 1420, label: "Return PO" },
  ],
  wrong: [
    { x: 860, label: "Tidak sesuai" },
    { x: 1160, label: "Partial / Close Short" },
    { x: 1420, label: "Return PO" },
  ],
  mixed: [
    { x: 860, label: "Lebih + tidak sesuai" },
    { x: 1160, label: "Submit" },
    { x: 1420, label: "Return PO" },
  ],
  recount: [{ x: 860, label: "Recount" }],
}

/** The branch's path from Receiving, as points (the corner is drawn round). */
function points(i: number) {
  const y = branchY(i)
  const id = BRANCHES[i]
  const last = id === "recount" ? 860 : END
  return [
    { x: SPINE, y: Y0 },
    { x: SPINE, y },
    { x: last, y },
  ]
}

/** Where the dot is, k of the way along branch i (0 = Receiving). */
export function dotOn(i: number, k: number) {
  const pts = points(i)
  const lens = pts.slice(1).map((p, j) => Math.hypot(p.x - pts[j].x, p.y - pts[j].y))
  const total = lens.reduce((a, b) => a + b, 0)
  let d = k * total
  for (let j = 0; j < lens.length; j++) {
    if (d <= lens[j] || j === lens.length - 1) {
      const f = lens[j] === 0 ? 1 : Math.min(1, d / lens[j])
      return {
        x: lerp(pts[j].x, pts[j + 1].x, f),
        y: lerp(pts[j].y, pts[j + 1].y, f),
      }
    }
    d -= lens[j]
  }
  return pts[pts.length - 1]
}

const branchPath = (i: number) => {
  const y = branchY(i)
  const id = BRANCHES[i]
  if (i === 0) return `M ${SPINE} ${Y0} L ${END} ${y} C ${END + 80} ${y}, ${DONE.x - 70} ${DONE.y}, ${DONE.x} ${DONE.y}`
  const corner = `M ${SPINE} ${Y0} L ${SPINE} ${y - 28} Q ${SPINE} ${y} ${SPINE + 28} ${y}`
  if (id === "recount") return `${corner} L 860 ${y}`
  return `${corner} L ${END} ${y} C ${END + 80} ${y}, ${DONE.x - 70} ${DONE.y}, ${DONE.x} ${DONE.y}`
}

const LOOP = (() => {
  const y = branchY(6)
  return `M 860 ${y} C 960 ${y}, 960 ${y + 64}, 860 ${y + 64} L 600 ${y + 64} Q 560 ${y + 64} 560 ${y + 24} L 560 ${Y0 + 28} Q 560 ${Y0} 600 ${Y0} L 634 ${Y0}`
})()

export interface MapState {
  /** 0..1: the trunk and the branches being drawn in, in order. */
  draw?: number
  /** Branches walked to their end: inked. */
  walked?: readonly number[]
  /** The branch being walked now, and how far the dot is along it. */
  current?: { i: number; k: number }
  /** Other branches step back while one is shown. */
  focus?: number
  /** The dot's position on the trunk instead (0 = New PO … 2 = Receiving). */
  trunk?: number
  style?: CSSProperties
}

export function FlowMap({ draw = 1, walked = [], current, focus, trunk, style }: MapState) {
  const trunkDraw = Math.min(1, draw * 3)
  const branchDraw = (i: number) => Math.max(0, Math.min(1, (draw - 0.3) / 0.5 - i * 0.06))
  const dim = (i: number) =>
    focus === undefined || focus === i ? 1 : walked.includes(i) ? 0.5 : 0.3
  const dot =
    current !== undefined
      ? dotOn(current.i, current.k)
      : {
          x: lerp(TRUNK[0].x, TRUNK[2].x, Math.min(2, Math.max(0, trunk ?? 2)) / 2),
          y: Y0,
        }
  return (
    <div className="absolute inset-0" style={style}>
      <svg width={1920} height={1080} className="absolute inset-0">
        {/* trunk */}
        <line
          x1={TRUNK[0].x}
          y1={Y0}
          x2={TRUNK[2].x}
          y2={Y0}
          stroke="var(--ink)"
          strokeWidth={8}
          strokeLinecap="round"
          pathLength={1}
          strokeDasharray={1}
          strokeDashoffset={1 - trunkDraw}
        />
        {BRANCHES.map((id, i) => {
          const k = branchDraw(i)
          return (
            <g key={id} opacity={dim(i)}>
              <path
                d={branchPath(i)}
                fill="none"
                stroke="var(--hairline-2)"
                strokeWidth={8}
                strokeLinecap="round"
                strokeLinejoin="round"
                pathLength={1}
                strokeDasharray={1}
                strokeDashoffset={1 - k}
              />
              {walked.includes(i) ? (
                <path
                  d={branchPath(i)}
                  fill="none"
                  stroke="var(--ink)"
                  strokeWidth={8}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ) : current?.i === i ? (
                /* Only as far as the dot: the same polyline it rides. */
                <polyline
                  points={points(i).map((p) => `${p.x},${p.y}`).join(" ")}
                  fill="none"
                  stroke="var(--ink)"
                  strokeWidth={8}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  pathLength={1}
                  strokeDasharray={1}
                  strokeDashoffset={1 - current.k}
                />
              ) : null}
              {id === "recount" && (
                <path
                  d={LOOP}
                  fill="none"
                  stroke={walked.includes(i) ? "var(--ink)" : "var(--hairline-strong)"}
                  strokeWidth={4}
                  strokeDasharray="10 10"
                  opacity={k}
                />
              )}
            </g>
          )
        })}
      </svg>

      {/* stations and their names */}
      {TRUNK.map((st, j) => (
        <Station key={st.label} x={st.x} y={Y0} label={st.label} on={trunkDraw > j / 3} inked big={j === 2} />
      ))}
      {BRANCHES.map((id, i) =>
        STATIONS[id].map((st, j) => (
          <Station
            key={`${id}-${j}`}
            x={st.x}
            y={branchY(i)}
            label={st.label}
            on={branchDraw(i) > (st.x - SPINE) / (END - SPINE)}
            inked={walked.includes(i) || (current?.i === i && dotOn(i, current.k).x >= st.x - 1)}
            first={j === 0}
            opacity={dim(i)}
          />
        ))
      )}
      <Station
        x={DONE.x}
        y={DONE.y}
        label="Done"
        on={draw >= 1}
        inked={walked.length > 0}
        big
        right
      />
      {/* recount's loop label */}
      <div
        className="absolute text-[1.25rem] text-mute"
        style={{ left: 600, top: branchY(6) + 76, opacity: branchDraw(6) * dim(6) }}
      >
        kembali ke Receiving
      </div>

      {/* the order */}
      <span
        className="absolute size-[26px] rounded-full bg-accent shadow-[0_0_0_8px_rgb(37_99_235/16%)]"
        style={{ left: dot.x - 13, top: dot.y - 13 }}
      />
    </div>
  )
}

function Station({
  x,
  y,
  label,
  on,
  inked,
  big,
  first,
  right,
  opacity = 1,
}: {
  x: number
  y: number
  label: string
  on: boolean
  inked?: boolean
  big?: boolean
  first?: boolean
  right?: boolean
  opacity?: number
}) {
  const r = big ? 15 : 11
  return (
    <div style={{ opacity: on ? opacity : 0 }}>
      <span
        className="absolute rounded-full bg-canvas"
        style={{
          left: x - r,
          top: y - r,
          width: r * 2,
          height: r * 2,
          border: `${big ? 5 : 4}px solid ${inked ? "var(--ink)" : "var(--hairline-strong)"}`,
        }}
      />
      <span
        className={
          "absolute text-[1.375rem] leading-7 whitespace-nowrap " +
          (first || big ? "font-semibold " : "") +
          (inked ? "text-ink" : "text-mute")
        }
        style={
          right
            ? { left: x + 26, top: y - 14 }
            : { left: x, top: y - 50, translate: "-50% 0" }
        }
      >
        {label}
      </span>
    </div>
  )
}
