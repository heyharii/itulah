import { useState } from "react"

import { Button } from "@/components/ui/button"
import { CardList } from "@/components/ui/card-list"
import { LeadCard } from "@/components/ui/lead-card"
import { Pill, Status } from "@/components/ui/pill"
import { Sheet } from "@/components/ui/sheet"
import { Stat, StatStrip } from "@/components/ui/stat-strip"
import { EmptyState } from "@/components/ui/states"
import { count } from "@/lib/format"
import { useGaTasks } from "@/lib/queries/ga"
import {
  dateLead,
  day,
  dueOf,
  intervalWords,
  SERVICING_HORIZON_DAYS,
} from "@/screens/ga/format"
import { Facts, GaScreen, ListBar } from "@/screens/ga/parts"
import { gaState } from "@/screens/ga/state"
import type { GaMaintenanceTaskRow } from "@itulah/contract"

/// The standing services head office has scheduled for this shop — the AC
/// washed every three months, the genset serviced, the lift inspected, the
/// van's KIR renewed. Read-only: GA keeps the schedule and sends the vendor.
///
/// What the shop gets from it is warning. A technician turning up to wash the
/// AC on a Saturday afternoon is a surprise only if nobody looked, and a
/// service that is overdue is something the shop can chase before the thing
/// breaks. So the list opens on what is due inside a month, overdue first; a
/// card's one figure is the day the service is due, and its foot says how
/// close that is.
export function Servicing() {
  return <GaScreen>{({ site }) => <Schedule site={site} />}</GaScreen>
}

type Phase = "SOON" | "ALL"
type Order = "soonest" | "title"

const ORDERS: readonly { readonly value: Order; readonly label: string }[] = [
  { value: "soonest", label: "Soonest" },
  { value: "title", label: "Title" },
]

/// Soonest first; a task with no calendar date (by odometer) and a paused
/// one sink to the foot, because neither has a day anybody can plan around.
function bySoonest(a: GaMaintenanceTaskRow, b: GaMaintenanceTaskRow): number {
  const key = (row: GaMaintenanceTaskRow) =>
    row.status === "PAUSED" || row.next_due === null ? "9999" : row.next_due
  return key(a).localeCompare(key(b))
}

/// Where a service stands, as the foot of its card and the badge of its sheet.
function standingOfTask(row: GaMaintenanceTaskRow): {
  label: string
  tone: "bad" | "warn" | "neutral"
} {
  if (row.status === "PAUSED") return { label: "Paused", tone: "neutral" }
  const due = dueOf(row.next_due)
  return { label: due.label, tone: due.tone }
}

function Schedule({ site }: { site: string }) {
  const tasks = useGaTasks(site)
  const [phase, setPhase] = useState<Phase>("SOON")
  const [typed, setTyped] = useState("")
  const [order, setOrder] = useState<Order>("soonest")
  const [openId, setOpenId] = useState<string | null>(null)
  const [showing, setShowing] = useState(false)
  const needle = typed.trim().toLowerCase()

  return (
    <>
      {gaState(tasks, {
        loading: "Reading the service schedule…",
        render: (rows) => {
          if (rows.length === 0) {
            return <EmptyState>No service scheduled.</EmptyState>
          }
          const soon = rows.filter((row) => {
            if (row.status === "PAUSED") return false
            const due = dueOf(row.next_due)
            return due.days !== null && due.days <= SERVICING_HORIZON_DAYS
          })
          const overdue = soon.filter(
            (row) => dueOf(row.next_due).tone === "bad",
          )
          const shown = [...(phase === "SOON" ? soon : rows)]
            .filter(
              (row) =>
                needle === "" ||
                [row.title, row.notes, row.asset_name, row.contract_number].some(
                  (field) => field?.toLowerCase().includes(needle),
                ),
            )
            .sort((a, b) =>
              order === "title"
                ? a.title.localeCompare(b.title)
                : bySoonest(a, b),
            )
          return (
            <>
              <ListBar
                search={{
                  value: typed,
                  onChange: setTyped,
                  label: "Search services",
                }}
                status={{
                  title: "Show",
                  value: phase,
                  onChange: (next) => setPhase(next as Phase),
                  options: [
                    {
                      value: "SOON",
                      label: `Next ${SERVICING_HORIZON_DAYS} days`,
                      count: soon.length,
                    },
                    { value: "ALL", label: "All", count: rows.length },
                  ],
                }}
                sort={{
                  value: order,
                  options: ORDERS,
                  onChange: (next) => setOrder(next as Order),
                }}
              />

              <StatStrip>
                <Stat
                  label="Overdue"
                  value={count(overdue.length)}
                  tone={overdue.length > 0 ? "bad" : undefined}
                />
                <Stat
                  label={`Due in ${SERVICING_HORIZON_DAYS} days`}
                  value={count(soon.length)}
                />
              </StatStrip>

              {shown.length === 0 ? (
                <EmptyState
                  action={
                    needle !== "" || phase === "SOON" ? (
                      <Button
                        onClick={() => {
                          setTyped("")
                          setPhase("ALL")
                        }}
                      >
                        Show all services
                      </Button>
                    ) : undefined
                  }
                >
                  {needle !== ""
                    ? `No match for “${typed.trim()}”.`
                    : `Nothing due in ${SERVICING_HORIZON_DAYS} days.`}
                </EmptyState>
              ) : (
                <CardList grid>
                  {shown.map((row) => (
                    <ServiceCard
                      key={row.task_id}
                      row={row}
                      onOpen={() => {
                        setOpenId(row.task_id)
                        setShowing(true)
                      }}
                    />
                  ))}
                </CardList>
              )}
            </>
          )
        },
      })}

      <ServiceSheet
        task={tasks.data?.find((row) => row.task_id === openId) ?? null}
        open={showing}
        onClose={() => setShowing(false)}
      />
    </>
  )
}

/// The one figure of a service: the day it is due. A task by odometer has no
/// day, so its figure is the distance between services.
function leadOf(row: GaMaintenanceTaskRow) {
  if (row.next_due !== null) {
    const lead = dateLead(row.next_due, "due")
    return row.status === "PAUSED" ? { ...lead, muted: true } : lead
  }
  return {
    figure: count(row.interval_value),
    caption: row.interval_kind === "KM" ? "km between" : undefined,
    muted: row.status === "PAUSED",
  }
}

/// One standing service as the uniform lead-figure card: what is done, to what,
/// how often, the day it is due as the one figure, and how close that is.
function ServiceCard({
  row,
  onOpen,
}: {
  row: GaMaintenanceTaskRow
  onOpen: () => void
}) {
  const standing = standingOfTask(row)
  return (
    <LeadCard
      title={row.title}
      lines={[
        row.asset_name ?? "The shop",
        intervalWords(row.interval_kind, row.interval_value),
      ]}
      lead={leadOf(row)}
      foot={{
        info: <Status tone={standing.tone}>{standing.label}</Status>,
        action: { label: "Open", onClick: onOpen },
      }}
      onOpen={onOpen}
    />
  )
}

/// One service: what it is for, how often, when it is next due and under which
/// contract. Read-only — GA keeps the schedule.
function ServiceSheet({
  task,
  open,
  onClose,
}: {
  task: GaMaintenanceTaskRow | null
  open: boolean
  onClose: () => void
}) {
  if (task === null) return null
  const standing = standingOfTask(task)
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title={task.title}
      badge={<Pill tone={standing.tone}>{standing.label}</Pill>}
      caption={task.asset_name ?? "The shop"}
    >
      <Facts
        rows={[
          ["For", task.asset_name ?? "The shop"],
          ["How often", intervalWords(task.interval_kind, task.interval_value)],
          [
            "Next due",
            task.next_due === null ? "By odometer" : day(task.next_due),
          ],
          ["Under contract", task.contract_number ?? "—"],
          task.notes !== null &&
            task.notes.trim() !== "" && ["Notes", task.notes, true],
        ]}
      />
    </Sheet>
  )
}
