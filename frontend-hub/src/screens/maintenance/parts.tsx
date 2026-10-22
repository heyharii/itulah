import { Pill } from "@/components/ui/pill"
import { cn } from "@/lib/utils"

import {
  disposalStageWords,
  repairStageWords,
  replacementStageWords,
  taskState,
} from "@/screens/maintenance/format"

/// The maintenance stage pills and the glyph name cell — the drawings only.
///
/// The words and the flow lists they read live in `./format`, because this
/// file exports components and react-refresh allows no functions beside them.

export function RepairStagePill({ status }: { status: string }) {
  switch (status) {
    case "OPEN":
      return <Pill tone="warn">{repairStageWords(status)}</Pill>
    case "APPROVED":
      return <Pill tone="accent">{repairStageWords(status)}</Pill>
    case "IN_PROGRESS":
      return <Pill tone="info">{repairStageWords(status)}</Pill>
    case "COMPLETED":
      return <Pill tone="ok">{repairStageWords(status)}</Pill>
    default:
      return <Pill tone="neutral">{repairStageWords(status)}</Pill>
  }
}

export function ReplacementStagePill({ status }: { status: string }) {
  switch (status) {
    case "PROPOSED":
      return <Pill tone="warn">{replacementStageWords(status)}</Pill>
    case "APPROVED":
    case "PURCHASED":
      return <Pill tone="accent">{replacementStageWords(status)}</Pill>
    case "INSTALLED":
      return <Pill tone="info">{replacementStageWords(status)}</Pill>
    default:
      return <Pill tone="ok">{replacementStageWords(status)}</Pill>
  }
}

export function DisposalStagePill({ status }: { status: string }) {
  switch (status) {
    case "REQUESTED":
      return <Pill tone="warn">{disposalStageWords(status)}</Pill>
    case "APPROVED":
      return <Pill tone="accent">{disposalStageWords(status)}</Pill>
    case "POSTED":
      return <Pill tone="ok">{disposalStageWords(status)}</Pill>
    default:
      return <Pill tone="bad">{disposalStageWords(status)}</Pill>
  }
}

export function ResultPill({ result }: { result: string }) {
  switch (result) {
    case "BAIK":
      return <Pill tone="ok">Good</Pill>
    case "PERHATIAN":
      return <Pill tone="warn">Needs attention</Pill>
    default:
      return <Pill tone="bad">Broken</Pill>
  }
}

export function TaskStatePill({ nextDue }: { nextDue: string | null }) {
  const state = taskState(nextDue)
  return <Pill tone={state.tone}>{state.label}</Pill>
}

/// The name cell of a list row: a glyph tile that says what kind of thing the
/// row is, the name beside it and one grey line under it. The same tile the
/// forms' choices and the asset sheet's sections wear, so a row looks like the
/// choice that made it.
export function GlyphName({
  icon: Glyph,
  name,
  quiet,
  className,
}: {
  icon: React.ComponentType<{ className?: string }>
  name: React.ReactNode
  quiet?: React.ReactNode
  className?: string
}) {
  return (
    <span className={cn("flex min-w-0 items-center gap-3", className)}>
      <span
        aria-hidden
        className="grid size-[1.875rem] shrink-0 place-items-center rounded-inner bg-soft-2 text-body"
      >
        <Glyph className="size-4 stroke-[1.7]" />
      </span>
      <span className="flex min-w-0 flex-col">
        <span
          className="truncate font-medium text-ink"
          title={typeof name === "string" ? name : undefined}
        >
          {name}
        </span>
        {quiet !== undefined && quiet !== null && quiet !== "" && (
          <span
            className="truncate text-mute"
            title={typeof quiet === "string" ? quiet : undefined}
          >
            {quiet}
          </span>
        )}
      </span>
    </span>
  )
}
