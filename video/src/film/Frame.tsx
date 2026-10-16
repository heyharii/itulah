/* The picture every chapter is drawn in: 1920 × 1080 on a grey a step under
   the hub's page, so the window reads as an object lying on it. */
import type { ReactNode } from "react"
import { AbsoluteFill } from "remotion"

export const Frame = ({ children }: { children: ReactNode }) => (
  <AbsoluteFill
    className="font-sans text-ink antialiased"
    style={{ background: "#efeff1", fontFeatureSettings: '"tnum" 1' }}
  >
    {children}
  </AbsoluteFill>
)
