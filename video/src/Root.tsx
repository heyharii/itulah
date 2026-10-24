import "./index.css"
import { Composition, Folder } from "remotion"
import { Ch1NewPo, CH1_BEATS as B1, CH1_LEN } from "./film/Ch1NewPo"
import { Ch2Count, CH2_LEN } from "./film/Ch2Count"
import { BRANCH_LEN, Ch3Branch, Ch3Outcomes, CH3_LEN } from "./film/Ch3Outcomes"
import { Ch4Return, CH4_LEN } from "./film/Ch4Return"
import { Ch5Done, CH5_LEN } from "./film/Ch5Done"
import { contact } from "./film/Contact"
import { GuideCut, GUIDE_LEN } from "./film/GuideCut"
import { BRANCHES } from "./scenarios"
import { Ob1Create, OB1_BEATS as O1, OB1_LEN } from "./film/outbound/Ob1Create"
import { Ob2Work, OB2_BEATS as O2, OB2_LEN } from "./film/outbound/Ob2Work"
import { Ob3Edit, OB3_BEATS as O3, OB3_LEN } from "./film/outbound/Ob3Edit"
import { Ob4Cancel, OB4_BEATS as O4, OB4_LEN } from "./film/outbound/Ob4Cancel"
import { Ob5Short, OB5_BEATS as O5, OB5_LEN } from "./film/outbound/Ob5Short"
import { OutboundCut, OUTBOUND_LEN } from "./film/outbound/OutboundCut"
import { Bk1Verbs, BK1_BEATS as K1, BK1_LEN } from "./film/back/Bk1Verbs"
import { Bk2Po, BK2_BEATS as K2, BK2_LEN } from "./film/back/Bk2Po"
import { Bk3Store, BK3_BEATS as K3, BK3_LEN } from "./film/back/Bk3Store"
import { Bk4Return, BK4_BEATS as K4, BK4_LEN } from "./film/back/Bk4Return"
import { Bk5Locked, BK5_BEATS as K5, BK5_LEN } from "./film/back/Bk5Locked"
import { BackCut, BACK_LEN } from "./film/back/BackCut"
import { LayersFilm, LAYERS_LEN } from "./film/layers/LayersFilm"
import { PosOpen, POS_LEN } from "./film/pos/PosOpen"
import { PosShots, POS_SHOTS } from "./film/pos/PosShots"

/* The one place the frame rate lives (see timing.ts). 30 while drafting;
   the release renders at 60 and nothing else changes. */
export const FPS = 30
const at = (authored: number) => Math.round((authored * FPS) / 30)
const HD = { fps: FPS, width: 1920, height: 1080 } as const

/** Nine frames spread over [from, to) of a chapter. */
const spread = (from: number, to: number) =>
  Array.from({ length: 9 }, (_, i) => Math.round(from + ((to - from) * (i + 0.5)) / 9))

const sheets = {
  ch1: contact(Ch1NewPo, [
    B1.intro + 60, B1.menu + 30, B1.menu + 120, B1.header + 44, B1.header + 102, B1.header + 160,
    B1.newitem + 90, B1.units + 120, B1.pieces + 100,
  ]),
  ch1b: contact(Ch1NewPo, [
    B1.review + 70, B1.submit + 54, B1.submit + 70, B1.submit + 140, B1.offline + 40, B1.offline + 110,
    B1.offline + 190, B1.cancel + 60, B1.cancel + 140,
  ]),
  ch2: contact(Ch2Count, spread(0, CH2_LEN)),
  ch3a: contact(Ch3Outcomes, spread(0, CH3_LEN / 2)),
  ch3b: contact(Ch3Outcomes, spread(CH3_LEN / 2, CH3_LEN)),
  ch4: contact(Ch4Return, spread(0, CH4_LEN)),
  ch5: contact(Ch5Done, spread(0, CH5_LEN)),
  bk1: contact(Bk1Verbs, spread(0, BK1_LEN)),
  bk3a: contact(Bk3Store, [
    K3.pick + 10, K3.pick + 80, K3.pick + 150, K3.part + 40, K3.part + 120, K3.rest + 80,
    K3.transit + 40, K3.transit + 120, K3.count + 60,
  ]),
  bk3b: contact(Bk3Store, [
    K3.count + 120, K3.receipt + 40, K3.receipt + 160, K3.closed + 20, K3.closed + 100, K3.closed + 160,
    BK3_LEN - 5, K3.pick + 105, K3.count + 92,
  ]),
  bk4a: contact(Bk4Return, [
    K4.ask + 30, K4.ask + 120, K4.sent + 50, K4.sent + 120, K4.received + 30, K4.received + 120,
    K4.cancel + 10, K4.cancel + 40, K4.cancel + 160,
  ]),
  bk4b: contact(Bk4Return, [
    K4.handed + 30, K4.handed + 70, K4.handed + 140, K4.settle + 30, K4.settle + 90, K4.settle + 170,
    BK4_LEN - 5, K4.ask + 68, K4.sent + 84,
  ]),
  bk5a: contact(Bk5Locked, [
    K5.intro + 30, K5.list1 + 40, K5.list1 + 150, K5.list2 + 60, K5.list3 + 60, K5.list3 + 170,
    K5.partly + 60, K5.race + 10, K5.race + 40,
  ]),
  bk5b: contact(Bk5Locked, [
    K5.race + 80, K5.race + 170, K5.retry + 20, K5.retry + 60, K5.retry + 100, K5.retry + 160,
    BK5_LEN - 80, BK5_LEN - 30, BK5_LEN - 2,
  ]),
  bk2a: contact(Bk2Po, [
    K2.intro + 40, K2.intro + 110, K2.form + 60, K2.submit + 16, K2.submit + 60, K2.recall + 50,
    K2.notyet + 60, K2.recalled + 16, K2.recalled + 50,
  ]),
  bk2b: contact(Bk2Po, [
    K2.recalled + 110, K2.same + 60, K2.recount + 40, K2.recount + 80, K2.recount + 150, K2.accept + 70,
    K2.stock + 40, K2.line + 40, K2.line + 120,
  ]),
  bk2c: contact(Bk2Po, [
    K2.instead + 60, K2.return + 20, K2.return + 70, K2.rest + 40, K2.rest + 120, K2.rest + 200,
    BK2_LEN - 5, K2.stock + 10, K2.accept + 30,
  ]),
  ob1a: contact(Ob1Create, [
    O1.intro + 40, O1.unallotted + 40, O1.select + 20, O1.select + 50, O1.matrix + 30, O1.matrix + 70,
    O1.fill + 16, O1.fill + 30, O1.fill + 60,
  ]),
  ob1b: contact(Ob1Create, [
    O1.tweak + 20, O1.tweak + 50, O1.tweak + 80, O1.submit + 10, O1.submit + 40, O1.submit + 80,
    O1.submit + 100, O1.submit + 130, OB1_LEN - 5,
  ]),
  ob2a: contact(Ob2Work, [
    O2.board + 40, O2.card + 30, O2.pick + 10, O2.pick + 40, O2.pick + 90, O2.pack + 16,
    O2.pack + 40, O2.pack + 62, O2.pack + 76,
  ]),
  ob2b: contact(Ob2Work, [
    O2.pack + 100, O2.dispatch + 20, O2.dispatch + 34, O2.dispatch + 70, O2.dispatch + 92, O2.dispatch + 120,
    O2.received + 30, O2.md + 30, OB2_LEN - 5,
  ]),
  ob4a: contact(Ob4Cancel, [
    O4.cancel + 10, O4.cancel + 40, O4.cancel + 60, O4.cancel + 90, O4.costs + 30, O4.ack + 20,
    O4.ack + 50, O4.ack + 86, O4.cancelled + 40,
  ]),
  ob4b: contact(Ob4Cancel, [
    O4.remove + 20, O4.remove + 42, O4.remove + 70, O4.stamp + 40, O4.stamp + 80, O4.moveback + 20,
    O4.moveback + 60, O4.moveback + 86, O4.moveback + 120,
  ]),
  ob5a: contact(Ob5Short, [
    O5.short + 20, O5.short + 50, O5.report + 40, O5.report + 80, O5.report + 112, O5.goes + 20,
    O5.goes + 70, O5.goes + 120, O5.md + 50,
  ]),
  ob5b: contact(Ob5Short, [
    O5.close + 30, O5.close + 60, O5.inv + 40, O5.found + 30, O5.found + 80, O5.revive + 20,
    O5.revive + 60, O5.received + 60, OB5_LEN - 5,
  ]),
  ob3a: contact(Ob3Edit, [
    O3.edit + 40, O3.edit + 100, O3.steps + 70, O3.lock + 40, O3.save + 50, O3.strip + 40,
    O3.blocked + 40, O3.sheet + 50, O3.moveback + 60,
  ]),
  ob3b: contact(Ob3Edit, [
    O3.racks + 50, O3.normal + 60, O3.partial + 70, O3.transit + 40, O3.add + 30, O3.add + 60,
    O3.add + 120, O3.add + 160, OB3_LEN - 10,
  ]),
}

export const RemotionRoot = () => (
  <>
    <Composition id="Guide" component={GuideCut} durationInFrames={at(GUIDE_LEN)} {...HD} />
    <Composition id="OutboundGuide" component={OutboundCut} durationInFrames={at(OUTBOUND_LEN)} {...HD} />
    <Composition id="BatasMundur" component={BackCut} durationInFrames={at(BACK_LEN)} {...HD} />
    <Composition id="PosOpen" component={PosOpen} durationInFrames={at(POS_LEN)} {...HD} />
    <Composition id="PosShots" component={PosShots} durationInFrames={POS_SHOTS.length} fps={30} width={2732} height={1536} />
    <Folder name="Layers">
      <Composition id="Layers-C" component={LayersFilm} durationInFrames={at(LAYERS_LEN)} {...HD} defaultProps={{ look: "c" as const }} />
      <Composition id="Layers-A" component={LayersFilm} durationInFrames={at(LAYERS_LEN)} {...HD} defaultProps={{ look: "a" as const }} />
      <Composition id="Layers1-Contact" component={contact(LayersFilm, [440, 500, 540, 560, 600, 640, 700, 750, 790])} durationInFrames={at(LAYERS_LEN)} {...HD} />
      <Composition id="Layers2-Contact" component={contact(LayersFilm, [826, 870, 900, 960, 1050, 1100, 1160, 1210, 1250])} durationInFrames={at(LAYERS_LEN)} {...HD} />
      <Composition id="Layers3-Contact" component={contact(LayersFilm, [1300, 1340, 1420, 1470, 1525, 1565, 1605, 1645, 1700])} durationInFrames={at(LAYERS_LEN)} {...HD} />
      <Composition id="Layers4-Contact" component={contact(LayersFilm, [1730, 1770, 1810, 1850, 1890, 1930, 1960, 1990, 2025])} durationInFrames={at(LAYERS_LEN)} {...HD} />
    </Folder>
    <Folder name="Back">
      <Composition id="Bk1-Verbs" component={Bk1Verbs} durationInFrames={at(BK1_LEN)} {...HD} />
      <Composition id="Bk2-Po" component={Bk2Po} durationInFrames={at(BK2_LEN)} {...HD} />
      <Composition id="Bk3-Store" component={Bk3Store} durationInFrames={at(BK3_LEN)} {...HD} />
      <Composition id="Bk4-Return" component={Bk4Return} durationInFrames={at(BK4_LEN)} {...HD} />
      <Composition id="Bk5-Locked" component={Bk5Locked} durationInFrames={at(BK5_LEN)} {...HD} />
      <Composition id="Bk1-Contact" component={sheets.bk1} durationInFrames={at(BK1_LEN)} {...HD} />
      <Composition id="Bk3a-Contact" component={sheets.bk3a} durationInFrames={at(BK3_LEN)} {...HD} />
      <Composition id="Bk3b-Contact" component={sheets.bk3b} durationInFrames={at(BK3_LEN)} {...HD} />
      <Composition id="Bk4a-Contact" component={sheets.bk4a} durationInFrames={at(BK4_LEN)} {...HD} />
      <Composition id="Bk4b-Contact" component={sheets.bk4b} durationInFrames={at(BK4_LEN)} {...HD} />
      <Composition id="Bk5a-Contact" component={sheets.bk5a} durationInFrames={at(BK5_LEN)} {...HD} />
      <Composition id="Bk5b-Contact" component={sheets.bk5b} durationInFrames={at(BK5_LEN)} {...HD} />
      <Composition id="Bk2a-Contact" component={sheets.bk2a} durationInFrames={at(BK2_LEN)} {...HD} />
      <Composition id="Bk2b-Contact" component={sheets.bk2b} durationInFrames={at(BK2_LEN)} {...HD} />
      <Composition id="Bk2c-Contact" component={sheets.bk2c} durationInFrames={at(BK2_LEN)} {...HD} />
    </Folder>
    <Folder name="Outbound">
      <Composition id="Ob1-Create" component={Ob1Create} durationInFrames={at(OB1_LEN)} {...HD} />
      <Composition id="Ob2-Work" component={Ob2Work} durationInFrames={at(OB2_LEN)} {...HD} />
      <Composition id="Ob3-Edit" component={Ob3Edit} durationInFrames={at(OB3_LEN)} {...HD} />
      <Composition id="Ob4-Cancel" component={Ob4Cancel} durationInFrames={at(OB4_LEN)} {...HD} />
      <Composition id="Ob5-Short" component={Ob5Short} durationInFrames={at(OB5_LEN)} {...HD} />
      <Composition id="Ob1a-Contact" component={sheets.ob1a} durationInFrames={at(OB1_LEN)} {...HD} />
      <Composition id="Ob1b-Contact" component={sheets.ob1b} durationInFrames={at(OB1_LEN)} {...HD} />
      <Composition id="Ob2a-Contact" component={sheets.ob2a} durationInFrames={at(OB2_LEN)} {...HD} />
      <Composition id="Ob2b-Contact" component={sheets.ob2b} durationInFrames={at(OB2_LEN)} {...HD} />
      <Composition id="Ob4a-Contact" component={sheets.ob4a} durationInFrames={at(OB4_LEN)} {...HD} />
      <Composition id="Ob4b-Contact" component={sheets.ob4b} durationInFrames={at(OB4_LEN)} {...HD} />
      <Composition id="Ob5a-Contact" component={sheets.ob5a} durationInFrames={at(OB5_LEN)} {...HD} />
      <Composition id="Ob5b-Contact" component={sheets.ob5b} durationInFrames={at(OB5_LEN)} {...HD} />
      <Composition id="Ob3a-Contact" component={sheets.ob3a} durationInFrames={at(OB3_LEN)} {...HD} />
      <Composition id="Ob3b-Contact" component={sheets.ob3b} durationInFrames={at(OB3_LEN)} {...HD} />
    </Folder>
    <Folder name="Chapters">
      <Composition id="Ch1-NewPo" component={Ch1NewPo} durationInFrames={at(CH1_LEN)} {...HD} />
      <Composition id="Ch2-Count" component={Ch2Count} durationInFrames={at(CH2_LEN)} {...HD} />
      <Composition id="Ch3-Outcomes" component={Ch3Outcomes} durationInFrames={at(CH3_LEN)} {...HD} />
      <Composition id="Ch4-Return" component={Ch4Return} durationInFrames={at(CH4_LEN)} {...HD} />
      <Composition id="Ch5-Done" component={Ch5Done} durationInFrames={at(CH5_LEN)} {...HD} />
    </Folder>
    <Folder name="Branches">
      {BRANCHES.map((id) => (
        <Composition
          key={id}
          id={`Branch-${id}`}
          component={() => <Ch3Branch id={id} />}
          durationInFrames={at(BRANCH_LEN[id])}
          {...HD}
        />
      ))}
    </Folder>
    <Folder name="Checks">
      <Composition id="Ch1-Contact" component={sheets.ch1} durationInFrames={at(CH1_LEN)} {...HD} />
      <Composition id="Ch1b-Contact" component={sheets.ch1b} durationInFrames={at(CH1_LEN)} {...HD} />
      <Composition id="Ch2-Contact" component={sheets.ch2} durationInFrames={at(CH2_LEN)} {...HD} />
      <Composition id="Ch3a-Contact" component={sheets.ch3a} durationInFrames={at(CH3_LEN)} {...HD} />
      <Composition id="Ch3b-Contact" component={sheets.ch3b} durationInFrames={at(CH3_LEN)} {...HD} />
      <Composition id="Ch4-Contact" component={sheets.ch4} durationInFrames={at(CH4_LEN)} {...HD} />
      <Composition id="Ch5-Contact" component={sheets.ch5} durationInFrames={at(CH5_LEN)} {...HD} />
    </Folder>
  </>
)
