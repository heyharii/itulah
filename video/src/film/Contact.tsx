/* A contact sheet: nine frames of a chapter side by side, for checking a
   whole chapter's staging in one still. */
import type { ComponentType } from "react"
import { AbsoluteFill, Freeze, useVideoConfig } from "remotion"
import { AUTHORED_FPS } from "../timing"

export function contact(Scene: ComponentType, frames: readonly number[]) {
  return function Contact() {
    const { fps } = useVideoConfig()
    return (
      <AbsoluteFill style={{ background: "#d9d9de" }}>
        {frames.map((f, i) => (
          <div
            key={f}
            className="absolute overflow-hidden"
            style={{
              left: (i % 3) * 640,
              top: Math.floor(i / 3) * 360,
              width: 1920,
              height: 1080,
              scale: String(1 / 3),
              transformOrigin: "0 0",
            }}
          >
            <Freeze frame={Math.round((f * fps) / AUTHORED_FPS)}>
              <Scene />
            </Freeze>
            <span
              className="absolute top-4 left-4 rounded bg-black/70 px-3 py-1 font-mono text-[48px] text-white"
            >
              {f}
            </span>
          </div>
        ))}
      </AbsoluteFill>
    )
  }
}
