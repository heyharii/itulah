/* POS · Buka kasir, narrated (Charon). The client's opening flow, drawn from
   the live prototype (pos-classic-prototype.html on :5397) rather than
   redrawn: each scene is one still of it, loaded with `.bare.still` so
   nothing inside moves on its own clock, and the camera, the pointer and the
   cross-fades are this file's.

   signin   the sign-in card, then filled in; Sign in
   menu     Menu: Kasir
   popup    the Open Kasir pop up, sensor waiting
   finger   the finger is read: the sensor fills blue with a check
   float    the opening float, Rp 500.000 already in
   open     Open Kasir
   ready    the till, empty, then a basket read off the RFID pad
   keys     a pan along the F-key toolbar */
import type { ReactNode } from "react"
import { IFrame } from "remotion"
import { EASE_IN_OUT, lerp, progress } from "../../motion"
import narration from "../../narration/pos1.json"
import durations from "../../narration/pos1.durations.json"
import { useT } from "../../timing"
import { frameAt, STAGE, type Shot } from "../../ui/Camera"
import { Pointer } from "../../ui/kit"
import { Band, Caption } from "../../ui/Overlay"
import { layout } from "../beats"
import { pointerAt } from "../cursor"
import { Frame } from "../Frame"
import { SFX, Sfx, clicks } from "../Sfx"
import { Voice } from "../Voice"

const MINS = {
  signin: 120,
  menu: 90,
  popup: 90,
  finger: 110,
  float: 110,
  open: 70,
  ready: 120,
  keys: 200,
}
const L = layout(narration, durations, MINS)
export const POS_LEN = L.total + 24
const b = L.start
export const POS_BEATS = b

/* ── The prototype's screen ─────────────────────────────────────────── */

const SCREEN = { w: 1366, h: 768 }
const PROTO = "http://127.0.0.1:5397/pos-classic-prototype.html"
const STILLS = ["signin", "signin2", "menu", "float", "floatok", "sell", "basket"] as const
type Still = (typeof STILLS)[number]
const src = (step: Still, i: number) => `${PROTO}?f=${i}#D.${step}.bare.still`

/* Measured in the prototype at 1366 × 768. */
const P = {
  user: { x: 683, y: 310 },
  signIn: { x: 683, y: 457 },
  kasir: { x: 683, y: 375 },
  sensor: { x: 533, y: 186, r: 42 },
  amount: { x: 683, y: 314 },
  open: { x: 683, y: 672 },
  rest: { x: 1040, y: 560 },
}

/* The finger is accepted here; the cross-fade and the blue disk hang on it. */
const OK = b.finger + 44

function opacities(t: number): Record<Still, number> {
  const fade = (at: number, len = 10) => progress(t, at, at + len)
  const filled = fade(b.signin + 34, 12)
  const onMenu = fade(b.menu - 4, 10)
  const onPopup = fade(b.popup - 4, 10)
  const ok = fade(OK - 2, 10)
  const onSell = fade(b.ready - 2, 10)
  const onBasket = fade(b.ready + 52, 12)
  return {
    signin: 1 - filled,
    signin2: filled * (1 - onMenu),
    menu: onMenu * (1 - onPopup),
    float: onPopup * (1 - ok),
    floatok: ok * (1 - onSell),
    sell: onSell * (1 - onBasket),
    basket: onBasket,
  }
}

/* The camera of ui/Camera.tsx, framing the 1366 × 768 screen instead of the
   hub's window. */
function PosCamera({ t, shots, children }: { t: number; shots: readonly Shot[]; children: ReactNode }) {
  const { scale, cx, cy } = frameAt(t, shots)
  return (
    <div
      className="absolute overflow-hidden rounded-[20px]"
      style={{ left: STAGE.x, top: STAGE.y, width: STAGE.w, height: STAGE.h }}
    >
      <div
        className="absolute"
        style={{
          left: STAGE.w / 2 - cx * scale,
          top: STAGE.h / 2 - cy * scale,
          width: SCREEN.w,
          height: SCREEN.h,
          scale: String(scale),
          transformOrigin: "0 0",
        }}
      >
        {children}
      </div>
    </div>
  )
}

/* The sensor's "yes": the blue disk and its check, which the still cannot
   show because its own animation is switched off. */
function Accepted({ t }: { t: number }) {
  const k = progress(t, OK, OK + 10)
  const ink = progress(t, OK + 5, OK + 15)
  if (k <= 0) return null
  const { x, y, r } = P.sensor
  return (
    <div
      className="absolute grid place-items-center rounded-full"
      style={{
        left: x - r,
        top: y - r,
        width: r * 2,
        height: r * 2,
        background: "#2862dc",
        opacity: k,
        scale: String(lerp(0.55, 1, k)),
      }}
    >
      <svg viewBox="0 0 24 24" width={34} height={34} fill="none">
        <path
          d="M6.5 12.5l3.8 3.8 7.2-8.3"
          stroke="#fff"
          strokeWidth={2.4}
          strokeLinecap="round"
          strokeLinejoin="round"
          pathLength={1}
          strokeDasharray={1}
          strokeDashoffset={1 - ink}
        />
      </svg>
    </div>
  )
}

export function PosOpen() {
  const t = useT()
  const op = opacities(t)

  const FULL = { x: -40, y: -24, w: SCREEN.w + 80, h: SCREEN.h + 48 }
  const shots: Shot[] = [
    { at: 0, rect: FULL },
    { at: b.signin + 6, len: 34, rect: { x: 333, y: 200, w: 700, h: 320 } },
    { at: b.menu, len: 26, rect: { x: 363, y: 190, w: 640, h: 340 } },
    { at: b.popup, len: 28, rect: { x: 283, y: 36, w: 800, h: 700 } },
    { at: b.finger + 4, len: 26, rect: { x: 343, y: 40, w: 680, h: 330 } },
    { at: b.float, len: 26, rect: { x: 383, y: 236, w: 600, h: 200 } },
    { at: b.open, len: 22, rect: { x: 383, y: 590, w: 600, h: 170 } },
    { at: b.ready - 2, len: 22, rect: FULL },
    { at: b.keys + 6, len: 30, rect: { x: -10, y: -8, w: 760, h: 345 } },
    { at: b.keys + 70, len: 100, rect: { x: 616, y: -8, w: 760, h: 345 } },
  ]

  const CLICKS = [b.signin + 92, b.menu + 52, b.open + 24]
  const p = pointerAt(
    t,
    [
      { at: 0, ...P.rest },
      { at: b.signin + 10, ...P.user, len: 18 },
      { at: b.signin + 70, ...P.signIn, len: 16 },
      { at: b.menu + 24, ...P.kasir, len: 18 },
      { at: b.popup + 10, ...P.rest, len: 20 },
      { at: b.open + 2, ...P.open, len: 18 },
      { at: b.ready + 10, ...P.rest, len: 20 },
    ],
    CLICKS
  )
  const pointerShown = progress(t, 4, 14) * (1 - progress(t, b.ready + 30, b.ready + 40))

  /* The rail: Sign in · Menu Kasir · Sidik jari · Saldo awal · Kasir siap. */
  const at =
    t < b.menu ? 0
    : t < b.popup ? 1
    : t < b.float ? 2
    : t < b.ready ? 3
    : 4
  const travel = (from: number, to: number, start: number) =>
    lerp(from, to, progress(t, start, start + 16, EASE_IN_OUT))
  const railAt =
    at === 0 ? 0
    : at === 1 ? travel(0, 1, b.menu)
    : at === 2 ? travel(1, 2, b.popup)
    : at === 3 ? travel(2, 3, b.float)
    : travel(3, 4, b.ready)

  return (
    <Frame>
      <PosCamera t={t} shots={shots}>
        <div
          className="absolute inset-0 overflow-hidden rounded-[10px]"
          style={{ boxShadow: "0 0 0 1px rgb(0 0 0 / 8%), 0 18px 48px rgb(0 0 0 / 12%)", background: "#e9eaee" }}
        >
          {STILLS.map((step, i) => {
            const o = op[step]
            const blur = step === "floatok" ? (1 - o) * 3 : 0
            return (
              <IFrame
                key={step}
                src={src(step, i + 1)}
                className="absolute inset-0 border-0"
                style={{
                  width: SCREEN.w,
                  height: SCREEN.h,
                  opacity: o,
                  filter: blur > 0.05 ? `blur(${blur}px)` : undefined,
                  pointerEvents: "none",
                }}
              />
            )
          })}
          {op.floatok > 0 && (
            <div className="absolute inset-0" style={{ opacity: op.floatok }}>
              <Accepted t={t} />
            </div>
          )}
        </div>
        {pointerShown > 0 && (
          <div className="absolute inset-0" style={{ opacity: pointerShown }}>
            <Pointer {...p} />
          </div>
        )}
      </PosCamera>
      <Caption t={t} lines={L.captions} />
      <Band
        chapter={1}
        of={1}
        title="Buka kasir"
        steps={["Sign in", "Menu Kasir", "Sidik jari", "Saldo awal", "Kasir siap"]}
        at={railAt}
        done={at}
      />
      <Voice chapter="pos1" ids={narration.map((line) => line.id)} start={b} />
      <Sfx
        cues={[
          ...clicks(CLICKS, 0.4),
          { at: OK + 4, src: SFX.ding, volume: 0.25 },
          { at: b.ready - 2, src: SFX.whoosh, volume: 0.25 },
          { at: b.ready + 52, src: SFX.tick, volume: 0.25 },
        ]}
      />
    </Frame>
  )
}
