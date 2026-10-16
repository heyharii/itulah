/* Chapter 4 · Return PO. 20 s, authored at 30 fps.

   0-150    Procurement › Return PO: everything going back, a card per
            supplier, Rp 0 owed — the order was only valued at what matched
   150-260  RS-00000001's sheet: the PO it came off, the reason, the pieces
   260-420  Ops › Return PO (the Gudang): Generate Delivery Note, the person
            in charge, then Print — the surat jalan retur for the supplier
   420-600  Confirm, when the goods are handed over: Completed */
import { EASE_IN_OUT, lerp, press, progress, typed } from "../motion"
import narration from "../narration/ch4.json"
import durations from "../narration/ch4.durations.json"
import { useT } from "../timing"
import { AppWindow } from "../ui/AppWindow"
import { Camera, type Shot } from "../ui/Camera"
import { Button, Dialog, Input, Label, Pointer, Sheet, Veil } from "../ui/kit"
import { Band, BUYER, Caption, GUDANG } from "../ui/Overlay"
import { ReturnBoard, ReturnSheet, type NoteStatus, type ReturnGroup } from "../ui/Returns"
import { pointerAt } from "./cursor"
import { Frame } from "./Frame"
import { Voice } from "./Voice"
import { makeWarp } from "./warp"
import { SFX, Sfx, clicks } from "./Sfx"

/* Timed by hand at 30 fps; each segment is held until its sentence of
   src/narration/ch4.json has been said (warp.ts). */
const AUTHORED = 600
const W = makeWarp(
  [
  { id: "return", from: 0 },
  { id: "sheet", from: 151 },
  { id: "note", from: 262 },
  { id: "confirm", from: 422 },
  ],
  narration,
  durations,
  AUTHORED
)
export const CH4_LEN = W.len

const groups = (status: NoteStatus): ReturnGroup[] => [
  {
    supplier: "Garmen Nusantara, PT",
    rows: [
      { po: "PO-081026-004", rs: "RS-00000001", pieces: 20, reason: "Over Delivery", status, date: "08 Oct 2026" },
      { po: "PO-081026-005", rs: "RS-00000002", pieces: 15, reason: "Not as Ordered", status, date: "08 Oct 2026" },
      { po: "PO-081026-006", rs: "RS-00000003", pieces: 30, reason: "Over Delivery · Not as Ordered", status, date: "08 Oct 2026" },
    ],
  },
]


export function Ch4Return() {
  const tn = useT()
  const t = W.authored(tn)
  const ops = t >= 262
  const sheet = progress(t, 160, 172) * (1 - progress(t, 250, 258))
  const make = progress(t, 302, 314) * (1 - progress(t, 372, 380))
  const generated = t >= 376
  const dialog = progress(t, 448, 456) * (1 - progress(t, 520, 528))
  const done = t >= 488
  const completed = t >= 524

  const shots: Shot[] = ops
    ? [
        { at: 262, rect: { x: 300, y: 10, w: 1140, h: 470 } },
        { at: 300, len: 20, rect: { x: 440, y: 0, w: 1000, h: 520 } },
        { at: 376, len: 20, rect: { x: 300, y: 90, w: 1140, h: 400 } },
        { at: 440, len: 18, rect: { x: 360, y: 200, w: 720, h: 500 } },
        { at: 524, len: 24, rect: { x: 300, y: 10, w: 1140, h: 470 } },
      ]
    : [
        { at: 0, rect: { x: 300, y: 10, w: 1140, h: 470 } },
        { at: 160, len: 22, rect: { x: 420, y: 10, w: 1020, h: 440 } },
        { at: 250, len: 10, rect: { x: 300, y: 10, w: 1140, h: 470 } },
      ]

  const p = pointerAt(
    t,
    [
      { at: 0, x: 900, y: 600 },
      { at: 130, x: 520, y: 252, len: 20 },
      { at: 262, x: 1000, y: 600, len: 1 },
      { at: 276, x: 1330, y: 162, len: 20 },
      { at: 318, x: 900, y: 168, len: 16 },
      { at: 350, x: 1330, y: 848, len: 16 },
      { at: 420, x: 1350, y: 162, len: 18 },
      { at: 470, x: 870, y: 516, len: 16 },
      { at: 520, x: 900, y: 700, len: 18 },
    ],
    [154, 298, 324, 370, 444, 486]
  )

  return (
    <Frame>
      <Camera t={t} shots={shots}>
        {ops ? (
          <AppWindow
            dept="ops"
            active="Return PO"
            badges={{ Receiving: 3, Allotment: 8, "Return PO": completed ? 0 : 3 }}
            overlay={
              <>
                <Veil opacity={Math.max(make, dialog * 0.7)} />
                {make > 0 && (
                  <Sheet
                    width={720}
                    title="Generate Delivery Note"
                    x={(1 - make) * 40}
                    opacity={make}
                    footer={
                      <div className="flex justify-end">
                        <Button variant="primary" pressed={press(t, 370)} hover={t > 362 && t < 374}>
                          Generate Delivery Note
                        </Button>
                      </div>
                    }
                  >
                    <div className="px-7 pt-5">
                      <div className="mb-4 text-[0.9375rem] text-body">Garmen Nusantara, PT · 3 returns · 65 pcs</div>
                      <Label required>Person in Charge</Label>
                      <Input
                        value={typed("Yusuf Ramadhan", t, 328, 0.9)}
                        caret={t >= 324 && t < 350}
                        focused={t >= 324 && t < 350}
                      />
                    </div>
                  </Sheet>
                )}
                {dialog > 0 && (
                  <Dialog
                    title={done ? "Sent back" : "Confirm Garmen Nusantara, PT?"}
                    style={{ opacity: dialog, scale: String(0.96 + 0.04 * dialog) }}
                    footer={
                      <>
                        <Button variant="ghost">{done ? "Close" : "Cancel"}</Button>
                        <Button variant="primary" pressed={press(t, 486)} hover={t > 478 && t < 490}>
                          {done ? "Done" : "Confirm"}
                        </Button>
                      </>
                    }
                  >
                    {done
                      ? "Sent back to Garmen Nusantara, PT."
                      : "3 returns, 65 pcs go back to Garmen Nusantara, PT."}
                  </Dialog>
                )}
                <Pointer {...p} />
              </>
            }
          >
            <ReturnBoard
              ops
              groups={groups(completed ? "Completed" : generated ? "Generated" : "Not Generated")}
              hot={generated ? "confirm" : "generate"}
              pressed={generated ? press(t, 444) : press(t, 298)}
            />
          </AppWindow>
        ) : (
          <AppWindow
            dept="procurement"
            active="Return PO"
            badges={{ "Purchase Orders": 4, "Return PO": 3 }}
            overlay={
              <>
                <Veil opacity={sheet} />
                {sheet > 0 && (
                  <ReturnSheet
                    row={groups("Not Generated")[0].rows[0]}
                    supplier="Garmen Nusantara, PT"
                    article="Kemeja Oxford Lengan Panjang"
                    x={(1 - sheet) * 40}
                    opacity={sheet}
                  />
                )}
                <Pointer {...p} />
              </>
            }
          >
            <ReturnBoard groups={groups("Not Generated")} />
          </AppWindow>
        )}
      </Camera>
      <Sfx
        cues={W.cues([
          ...clicks([154, 298, 324, 370, 444, 486]),
          { at: 376, src: SFX.tick, volume: 0.2 },
          { at: 524, src: SFX.ding, volume: 0.22 },
        ])}
      />
      <Caption t={tn} lines={W.captions} />
      <Voice chapter="ch4" ids={W.voiceIds} start={W.voiceStart} />
      <Band
        chapter={4}
        title="Return PO"
        who={ops ? GUDANG : BUYER}
        at={completed ? lerp(4, 5, progress(t, 540, 580, EASE_IN_OUT)) : 4}
        done={4}
      />
    </Frame>
  )
}
