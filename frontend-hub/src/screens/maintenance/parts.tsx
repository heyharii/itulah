import { Pill } from "@/components/ui/pill"

import {
  disposalStageWords,
  repairStageWords,
  replacementStageWords,
  taskState,
  wordsFor,
} from "@/screens/maintenance/format"

/// The maintenance stage pills and the stage line — the drawings only.
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

/// The stage line a sheet draws across its flow: the stages behind it in
/// green, the stage it stands on in accent, the rest quiet. One drawing for
/// the three flows, because three shapes of the same sentence is exactly the
/// drift the pills exist to prevent.
export function StageLine({
  flow,
  status,
}: {
  flow: readonly string[]
  status: string
}) {
  const rejected = status === "CANCELLED" || status === "REJECTED"
  const at = flow.indexOf(status)
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {flow.map((stage, i) => (
        <Pill
          key={stage}
          tone={
            rejected
              ? "neutral"
              : i < at
                ? "ok"
                : i === at
                  ? "accent"
                  : "neutral"
          }
        >
          {wordsFor(flow, stage)}
        </Pill>
      ))}
      {rejected && <Pill tone="bad">{wordsFor(flow, status)}</Pill>}
    </div>
  )
}

export function ResultPill({ result }: { result: string }) {
  switch (result) {
    case "BAIK":
      return <Pill tone="ok">Baik</Pill>
    case "PERHATIAN":
      return <Pill tone="warn">Perlu perhatian</Pill>
    default:
      return <Pill tone="bad">Rusak</Pill>
  }
}

export function TaskStatePill({ nextDue }: { nextDue: string | null }) {
  const state = taskState(nextDue)
  return <Pill tone={state.tone}>{state.label}</Pill>
}
