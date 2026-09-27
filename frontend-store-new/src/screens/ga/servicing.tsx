import { useState } from "react"

import { Card } from "@/components/ui/card"
import { Pill } from "@/components/ui/pill"
import { Segmented } from "@/components/ui/segmented"
import { Tag } from "@/components/ui/tag"
import { count } from "@/lib/format"
import { useGaTasks } from "@/lib/queries/ga"
import {
  dueOf,
  intervalWords,
  SERVICING_HORIZON_DAYS,
} from "@/screens/ga/format"
import {
  GaScreen,
  RowTable,
  Toolbar,
  TwoLine,
  type RowColumn,
} from "@/screens/ga/parts"
import { gaState } from "@/screens/ga/state"
import type { GaMaintenanceTaskRow } from "@itulah/contract"

/// The standing services head office has scheduled for this shop — the AC
/// washed every three months, the genset serviced, the lift inspected, the
/// van's KIR renewed. Read-only: GA keeps the schedule and sends the vendor.
///
/// What the shop gets from it is warning. A technician turning up to wash the
/// AC on a Saturday afternoon is a surprise only if nobody looked, and a
/// service that is overdue is something the shop can chase before the thing
/// breaks. So the list opens on what is due inside a month, overdue first.
export function Servicing() {
  return (
    <GaScreen sub="What head office has scheduled to be serviced here, and when it is next due.">
      {(site) => <Schedule site={site} />}
    </GaScreen>
  )
}

type Phase = "SOON" | "ALL"

const columns: readonly RowColumn<GaMaintenanceTaskRow>[] = [
  {
    id: "service",
    header: "Service",
    className: "max-w-[24rem] whitespace-normal",
    cell: (row) => (
      <TwoLine
        top={row.title}
        under={
          row.notes !== null && row.notes.trim() !== "" ? row.notes : undefined
        }
      />
    ),
  },
  {
    id: "for",
    header: "For",
    // A task names a thing or the place, never both.
    cell: (row) => row.asset_name ?? "The shop",
  },
  {
    id: "every",
    header: "How often",
    cell: (row) => intervalWords(row.interval_kind, row.interval_value),
  },
  {
    id: "contract",
    header: "Under",
    card: "hide",
    cell: (row) => row.contract_number ?? <span className="text-faint">—</span>,
  },
  {
    id: "next",
    header: "Next due",
    card: "status",
    cell: (row) => {
      if (row.status === "PAUSED") return <Tag>Paused</Tag>
      const due = dueOf(row.next_due)
      return due.tone === "neutral" ? (
        <span className="text-meta text-body tabular-nums">{due.label}</span>
      ) : (
        <Pill tone={due.tone}>{due.label}</Pill>
      )
    },
  },
]

/// Soonest first; a task with no calendar date (by odometer) and a paused
/// one sink to the foot, because neither has a day anybody can plan around.
function bySoonest(a: GaMaintenanceTaskRow, b: GaMaintenanceTaskRow): number {
  const key = (row: GaMaintenanceTaskRow) =>
    row.status === "PAUSED" || row.next_due === null ? "9999" : row.next_due
  return key(a).localeCompare(key(b))
}

function Schedule({ site }: { site: string }) {
  const tasks = useGaTasks(site)
  const [phase, setPhase] = useState<Phase>("SOON")

  return gaState(tasks, {
    loading: "Reading this shop's service schedule…",
    render: (rows) => {
      if (rows.length === 0) {
        return (
          <Card>
            <p className="mx-auto max-w-[30em] px-4 py-12 text-center text-meta text-body">
              Head office has scheduled no regular service for this shop. AC
              washing, genset and lift checks show here once GA puts them on the
              schedule.
            </p>
          </Card>
        )
      }
      const soon = rows.filter((row) => {
        if (row.status === "PAUSED") return false
        const due = dueOf(row.next_due)
        return due.days !== null && due.days <= SERVICING_HORIZON_DAYS
      })
      const overdue = soon.filter((row) => dueOf(row.next_due).tone === "bad")
      const shown = [...(phase === "SOON" ? soon : rows)].sort(bySoonest)
      return (
        <>
          <Toolbar>
            <Segmented<Phase>
              value={phase}
              onChange={setPhase}
              className="md:w-auto [&>button]:px-3.5 [&>button]:whitespace-nowrap pointer-coarse:[&>button]:h-tap md:pointer-fine:[&>button]:h-8"
              options={[
                {
                  value: "SOON",
                  label: `Next ${SERVICING_HORIZON_DAYS} days · ${count(soon.length)}`,
                },
                { value: "ALL", label: `All · ${count(rows.length)}` },
              ]}
            />
            {overdue.length > 0 && (
              <span className="text-meta text-bad-fg tabular-nums">
                {count(overdue.length)} overdue — worth a call to GA
              </span>
            )}
          </Toolbar>
          <Card>
            <RowTable
              rows={shown}
              columns={columns}
              rowKey={(row) => row.task_id}
              empty={`Nothing is due in the next ${SERVICING_HORIZON_DAYS} days. The whole schedule is under All.`}
            />
          </Card>
        </>
      )
    },
  })
}
