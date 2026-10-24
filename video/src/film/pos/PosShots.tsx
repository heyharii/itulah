/* Stills of the POS prototype's key map, one frame each, at 2× the till's
   1366 × 768: rendered as a PNG sequence for review, never as a film. */
import { AbsoluteFill, IFrame, Sequence } from "remotion"

export const POS_SHOTS = [
  "D.exchange",
  "D.exchange2",
  "D.void",
] as const

export function PosShots() {
  return (
    <AbsoluteFill style={{ background: "#fff" }}>
      {POS_SHOTS.map((hash, i) => (
        <Sequence key={hash} from={i} durationInFrames={1} layout="none">
          <IFrame
            src={`http://127.0.0.1:5397/pos-classic-prototype.html?shot=${i}#${hash}.bare.still`}
            style={{ width: 1366, height: 768, border: 0, transform: "scale(2)", transformOrigin: "0 0" }}
          />
        </Sequence>
      ))}
    </AbsoluteFill>
  )
}
