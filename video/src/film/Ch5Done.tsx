/* Chapter 5 · Selesai. Authored at 30 fps; no invoice (Hari, 9 Oct).

   0-64     Completed PO: one stamp per order, each one the way it ended
   64-138   the list, held while the last sentence is said
   140-344  The whole map, walked. The dot leaves Done and settles into the
            C of the mark. No closing line (Hari, 9 Oct) */
import { AbsoluteFill } from "remotion"
import { BOOK, OURS, VALUE } from "../data"
import { EASE_IN_OUT, EASE_OUT, arc, lerp, progress } from "../motion"
import narration from "../narration/ch5.json"
import durations from "../narration/ch5.durations.json"
import { BRANCHES, SCENARIOS } from "../scenarios"
import { useT } from "../timing"
import { AppWindow } from "../ui/AppWindow"
import { Camera, type Shot } from "../ui/Camera"
import { FlowMap, branchY } from "../ui/FlowMap"
import { BrandMark, Stamp } from "../ui/kit"
import { Band, BUYER, Caption } from "../ui/Overlay"
import { PoList } from "../ui/PoList"
import { Frame } from "./Frame"
import { SFX, Sfx } from "./Sfx"
import { Voice } from "./Voice"
import { makeWarp } from "./warp"

/* Timed by hand at 30 fps; each segment is held until its sentence of
   src/narration/ch5.json has been said (warp.ts), and every boundary sits
   just before a change of picture. */
const AUTHORED = 344
const W = makeWarp(
  [{ id: "completed", from: 0 }, { id: "done", from: 64 }, { from: 138 }],
  narration,
  durations,
  AUTHORED
)
export const CH5_LEN = W.len

const STAMP_AT = 16
const ENDING = 140

const slam = (t: number, at: number) => {
  const k = progress(t, at, at + 7, EASE_OUT)
  return { opacity: k, scale: String(lerp(1.5, 1, k)), rotate: "-6deg" }
}

const FINISHED = [
  { id: "match", label: "Fully received", tone: "done" },
  { id: "shortKeep", label: "Fully received", tone: "done" },
  { id: "shortClose", label: "Closed short", tone: "bad" },
  { id: "over", label: "Fully received", tone: "done" },
  { id: "mixed", label: "Fully received", tone: "done" },
] as const

const SHOTS: Shot[] = [
  { at: 0, rect: { x: 300, y: 10, w: 1140, h: 760 } },
  { at: 80, len: 40, rect: { x: 300, y: 0, w: 1140, h: 880 } },
]

export function Ch5Done() {
  const tn = useT()
  const t = W.authored(tn)
  const mapIn = progress(t, ENDING, ENDING + 12)

  const rows = FINISHED.map((f) => {
    const sc = SCENARIOS[f.id]
    return OURS(sc.po, {
      items: sc.lines.length,
      received: f.id === "shortClose" ? 580 : 600,
      receivedValue: f.id === "shortClose" ? Math.round(VALUE * (580 / 600)) : VALUE,
      status: f.label === "Closed short" ? "Closed short" : "Fully received",
    })
  })

  return (
    <Frame>
      {mapIn < 1 && (
        <AbsoluteFill style={{ opacity: 1 - mapIn }}>
          <Camera t={t} shots={SHOTS}>
            <AppWindow dept="procurement" active="Purchase Orders" badges={{ "Purchase Orders": 3, "Return PO": 0 }}>
              <PoList
                tab="completed"
                rows={[...rows, BOOK[0]]}
                kpis={{ orders: 12, open: 4, overdue: 0, onOrder: "Rp 420 jt" }}
                looks={Object.fromEntries(
                  FINISHED.map((f, i) => [
                    SCENARIOS[f.id].po,
                    {
                      stamp:
                        t >= STAMP_AT + i * 9 ? (
                          <Stamp tone={f.tone} date="8 Oct 2026" style={slam(t, STAMP_AT + i * 9)}>
                            {f.label}
                          </Stamp>
                        ) : undefined,
                    },
                  ])
                )}
              />
            </AppWindow>
          </Camera>
          <Band chapter={5} title="Selesai" who={BUYER} at={5} done={5} />
        </AbsoluteFill>
      )}
      {mapIn > 0 && <Ending t={t} />}
      <Sfx
        cues={W.cues([
          ...FINISHED.map((_, i) => ({ at: STAMP_AT + i * 9, src: SFX.stamp, volume: 0.4 })),
          { at: ENDING + 58, src: SFX.whoosh, volume: 0.3 },
          { at: ENDING + 90, src: SFX.ding, volume: 0.35 },
        ])}
      />
      <Caption t={tn} lines={W.captions} />
      <Voice chapter="ch5" ids={W.voiceIds} start={W.voiceStart} />
    </Frame>
  )
}

/** The map, walked; then the dot goes home to the mark. Frames count from
    the ending's start. */
function Ending({ t: at }: { t: number }) {
  const t = at - ENDING
  const mapIn = progress(t, 0, 12)
  const walk = progress(t, 16, 48, EASE_IN_OUT)
  const mapOut = progress(t, 64, 80)
  const fly = progress(t, 58, 90, EASE_IN_OUT)
  const mark = progress(t, 68, 84, EASE_OUT)
  const word = progress(t, 90, 104, EASE_OUT)
  const SIZE = 120
  const MARK = { x: 960 - (SIZE + 28 + 316) / 2, y: 470 - SIZE / 2 }
  const home = { x: MARK.x + (23.4 / 32) * SIZE, y: MARK.y + (16 / 32) * SIZE }
  const done = { x: 1730, y: branchY(2.5) }
  const dot = arc(fly, done, { x: 1400, y: 160 }, home)
  const landed = t >= 90
  const r = lerp(13, (2.2 / 32) * SIZE, fly)
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ opacity: mapIn * (1 - mapOut), scale: String(1 - mapOut * 0.04) }}>
        <FlowMap
          walked={BRANCHES.map((_, i) => i)}
          current={walk < 1 ? { i: 0, k: walk } : undefined}
          trunk={2}
        />
      </AbsoluteFill>
      <div
        className="absolute flex items-center gap-7"
        style={{
          left: MARK.x,
          top: MARK.y,
          opacity: mark,
          scale: String(0.94 + 0.06 * mark),
          transformOrigin: "60px 60px",
        }}
      >
        <BrandMark size={SIZE} dot={landed} />
        <span
          className="text-[5.5rem] leading-none font-semibold tracking-[-0.035em] text-ink"
          style={{ opacity: word, translate: `${(1 - word) * -12}px 0px` }}
        >
          Central
        </span>
      </div>
      {fly > 0 && !landed && (
        <span
          className="absolute rounded-full bg-accent"
          style={{ left: dot.x - r, top: dot.y - r, width: r * 2, height: r * 2 }}
        />
      )}
    </AbsoluteFill>
  )
}
