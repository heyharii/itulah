/* Chapter 2 · Gudang menghitung. 22 s, authored at 30 fps.

   0-100    Ops › Receiving: the order owes 1 article — never how many pieces
   96       Count receive. The sheet has no ordered figure anywhere
   120-170  29 kodi, then "+ Another unit", 20 pcs: 600 pcs, counted blind
   330-450  Not as Ordered: damaged or wrong pieces are written apart
   490      Submit count; the row shows who counted, when, how many
   600-660  The dot moves on to Review Count */
import { EASE_IN_OUT, lerp, press, progress, typed } from "../motion"
import narration from "../narration/ch2.json"
import durations from "../narration/ch2.durations.json"
import { useT } from "../timing"
import { AppWindow } from "../ui/AppWindow"
import { Camera, FULL, type Shot } from "../ui/Camera"
import { Pointer, Toast, Veil } from "../ui/kit"
import { Band, Caption, GUDANG } from "../ui/Overlay"
import { CountSheet, ReceivingList, type IntakeRow } from "../ui/Receiving"
import { pointerAt } from "./cursor"
import { Frame } from "./Frame"
import { Voice } from "./Voice"
import { makeWarp } from "./warp"
import { SFX, Sfx, clicks } from "./Sfx"

/* Timed by hand at 30 fps; each segment is held until its sentence of
   src/narration/ch2.json has been said (warp.ts). */
const AUTHORED = 660
const W = makeWarp(
  [
  { id: "receiving", from: 0 },
  { id: "blind", from: 98 },
  { id: "mixed", from: 220 },
  { id: "wrong", from: 332 },
  { id: "submit", from: 456 },
  ],
  narration,
  durations,
  AUTHORED
)
export const CH2_LEN = W.len

const SHOTS: Shot[] = [
  { at: 0, rect: { x: 300, y: 10, w: 1140, h: 470 } },
  { at: 102, len: 22, rect: { x: 400, y: 70, w: 1020, h: 330 } },
  { at: 334, len: 22, rect: { x: 400, y: 250, w: 1020, h: 230 } },
  { at: 446, len: 20, rect: { x: 400, y: 260, w: 1040, h: 640 } },
  { at: 500, len: 22, rect: { x: 300, y: 10, w: 1140, h: 470 } },
  { at: 600, len: 30, rect: FULL },
]


const ROWS = (counted: boolean): IntakeRow[] => [
  {
    supplier: "Garmen Nusantara, PT",
    po: "PO-081026-001",
    items: 1,
    counted: counted ? { pieces: 600, by: "Yusuf Ramadhan", at: "08 Oct, 14:20" } : undefined,
  },
  { supplier: "Sepatu Sejahtera, CV", po: "PO-071026-004", items: 2 },
  { supplier: "Sinar Tekstil Nusantara, PT", po: "PO-061026-002", items: 3 },
  { supplier: "Srikandi Busana Mandiri, CV", po: "PO-051026-003", items: 1 },
  {
    supplier: "Garmen Nusantara, PT",
    po: "PO-041026-011",
    items: 1,
    counted: { pieces: 360, by: "Yusuf Ramadhan", at: "07 Oct, 16:40" },
  },
]

export function Ch2Count() {
  const tn = useT()
  const t = W.authored(tn)
  const p = pointerAt(
    t,
    [
      { at: 0, x: 1000, y: 420 },
      { at: 60, x: 1336, y: 189, len: 24 },
      { at: 112, x: 990, y: 184, len: 16 },
      { at: 142, x: 966, y: 312, len: 12 },
      { at: 154, x: 990, y: 236, len: 10 },
      { at: 340, x: 990, y: 390, len: 18 },
      { at: 460, x: 1350, y: 848, len: 22 },
      { at: 520, x: 1150, y: 560, len: 18 },
    ],
    [96, 118, 148, 160, 490]
  )
  const sheet = progress(t, 100, 112) * (1 - progress(t, 494, 502))
  const kodi = typed("29", t, 122, 0.3)
  const loose = t >= 150
  const extra = typed("20", t, 162, 0.3)
  const first = kodi === "29" ? 580 : kodi === "2" ? 40 : 0
  const second = extra === "20" ? 20 : extra === "2" ? 2 : 0
  const toast = progress(t, 500, 508) * (1 - progress(t, 580, 588))
  const counted = t >= 498

  return (
    <Frame>
      <Camera t={t} shots={SHOTS}>
        <AppWindow
          dept="ops"
          active="Receiving"
          badges={{ Receiving: counted ? 3 : 4, Allotment: 8, "Return PO": 2 }}
          overlay={
            <>
              <Veil opacity={sheet} />
              {sheet > 0 && (
                <CountSheet
                  po="PO-081026-001"
                  supplier="Garmen Nusantara, PT"
                  x={(1 - sheet) * 40}
                  opacity={sheet}
                  lines={[
                    {
                      article: "Kemeja Oxford Lengan Panjang",
                      kind: "Pria · Kemeja",
                      typed: kodi,
                      unit: t >= 134 ? "Kodi" : "Piece",
                      caret: t >= 118 && t < 148,
                      extra: loose ? { typed: extra, unit: "Piece", caret: t >= 160 && t < 330 } : undefined,
                      pieces: first + second,
                    },
                  ]}
                  wrong={{ typed: "0", pieces: 0, caret: t >= 380 && t < 450 }}
                  submit={{ enabled: first + second > 0, pressed: press(t, 490), hover: t > 480 && t < 494 }}
                />
              )}
              {toast > 0 && (
                <Toast style={{ opacity: toast, translate: `0px ${(1 - toast) * 8}px` }}>
                  Count sent · 1 line
                </Toast>
              )}
              <Pointer {...p} />
            </>
          }
        >
          <ReceivingList rows={ROWS(counted)} hot={{ po: "PO-081026-001", pressed: press(t, 96) }} />
        </AppWindow>
      </Camera>
      <Sfx
        cues={W.cues([
          ...clicks([96, 118, 148, 160, 490]),
          { at: 170, src: SFX.tick, volume: 0.18 },
          { at: 502, src: SFX.tick, volume: 0.2 },
        ])}
      />
      <Caption t={tn} lines={W.captions} />
      <Voice chapter="ch2" ids={W.voiceIds} start={W.voiceStart} />
      <Band
        chapter={2}
        title="Gudang menghitung"
        who={GUDANG}
        at={lerp(2, 3, progress(t, 610, 646, EASE_IN_OUT))}
        done={2}
      />
    </Frame>
  )
}

