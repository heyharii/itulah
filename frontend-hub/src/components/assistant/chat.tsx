import { useEffect, useRef } from "react"

import { Artifacts } from "@/components/assistant/artifact"
import { Prose } from "@/components/assistant/prose"
import {
  ArtifactSpaceContext,
  type ArtifactSpace,
} from "@/components/assistant/space"
import { type Exchange } from "@/components/assistant/state"
import { Trace } from "@/components/assistant/trace"
import { cn } from "@/lib/utils"

/// The conversation itself, wherever it is being read.
///
/// One component and two shells: a 30rem panel over whatever somebody was
/// looking at, and a page that is nothing else. They differ in width and in
/// what surrounds them, which is a layout question and belongs to the shells;
/// a turn reads the same in both, and a second copy of this would be the file
/// where one of them quietly stopped drawing the trace.

export function Transcript({
  exchanges,
  loading = false,
  space = "panel",
  className,
}: {
  readonly exchanges: readonly Exchange[]
  /// A kept chat on its way from the server. Distinct from a turn being
  /// written: this draws a shape, not a caret.
  loading?: boolean
  /// How much room the cards under an answer have. See `space.ts` — the
  /// default is the narrow one, so a surface that forgets to say gets the
  /// caps that fit everywhere.
  space?: ArtifactSpace
  className?: string
}) {
  const foot = useRef<HTMLDivElement>(null)

  // Follow the answer as it is written. `end` rather than `center` so the last
  // line sits above the composer instead of the middle of the panel.
  useEffect(() => {
    foot.current?.scrollIntoView({ block: "end", behavior: "smooth" })
  }, [exchanges])

  if (loading) {
    return (
      <div className={cn("flex flex-col gap-3 pt-2", className)}>
        {[0, 1, 2].map((row) => (
          <div
            key={row}
            className="h-3 animate-pulse rounded-full bg-soft-2"
            style={{ width: `${[70, 100, 45][row]}%` }}
          />
        ))}
      </div>
    )
  }

  return (
    <ArtifactSpaceContext value={space}>
      <div className={className}>
        {exchanges.map((exchange) => (
          <Answer key={exchange.id} exchange={exchange} />
        ))}
        <div ref={foot} />
      </div>
    </ArtifactSpaceContext>
  )
}

export function Answer({ exchange }: { exchange: Exchange }) {
  return (
    <article className="mb-6 last:mb-0">
      <p className="mb-2.5 text-[0.875rem] leading-snug font-semibold tracking-[-0.01em] text-ink">
        {exchange.question}
      </p>

      <Trace exchange={exchange} />

      {exchange.answer && (
        <Prose text={exchange.answer}>
          {exchange.streaming && (
            // The caret marks where the next word will land. It is a block, not
            // a blinking bar: a blink at 500ms beside text arriving at 30ms
            // reads as two different things happening.
            <span className="ml-0.5 inline-block h-[0.8em] w-[0.4em] translate-y-[0.05em] bg-mute" />
          )}
        </Prose>
      )}

      {exchange.error && (
        <p className="mt-2 rounded-inner border border-bad-bg bg-bad-bg px-2.5 py-2 text-meta text-bad-fg">
          {exchange.error}
        </p>
      )}

      <Artifacts runs={exchange.runs} question={exchange.question} />
    </article>
  )
}
