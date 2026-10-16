import { useState } from "react"

import { Button } from "@/components/ui/button"
import { CardList } from "@/components/ui/card-list"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { LeadCard } from "@/components/ui/lead-card"
import { SheetSection } from "@/components/ui/people-sheet"
import { Pill, Status } from "@/components/ui/pill"
import { Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState } from "@/components/ui/states"
import { count } from "@/lib/format"
import { useGaRepairs } from "@/lib/queries/ga"
import {
  dateLead,
  day,
  REPAIR_FLOW,
  repairIsOpen,
  repairObjectWords,
  repairRungWords,
  repairStageTone,
  repairStageWords,
  today,
} from "@/screens/ga/format"
import {
  Facts,
  GaScreen,
  ListBar,
  StageLadder,
  type GaContext,
} from "@/screens/ga/parts"
import { RepairComposer } from "@/screens/ga/repair-composer"
import { gaState } from "@/screens/ga/state"
import { personByLogin } from "@/screens/hr/words"
import type { GaRepairRow } from "@itulah/contract"

/// What this shop has reported broken, and how far each report has got.
///
/// The shop files; head office climbs the ladder — approves it, sends the
/// vendor, marks it fixed, closes it. So this screen is a READING of that
/// ladder plus one act, "New repair request", which lands a repair on GA's book
/// the moment it is sent. A repair about one of the shop's things can also be
/// filed from that thing's sheet under Assets.
///
/// No money here. A repair carries its estimate, its approved budget and
/// Finance's actual cost, and none of them is the shop's to act on: the quote
/// is between GA and the vendor, and the bill is Finance's. So a card's one
/// figure is the day the shop noticed the fault.
export function Repairs() {
  const [composing, setComposing] = useState(false)
  const [filed, setFiled] = useState(false)
  const start = () => {
    setFiled(false)
    setComposing(true)
  }
  return (
    <GaScreen primary={{ label: "New repair request", onClick: start }}>
      {({ site, team }) => (
        <>
          {filed && (
            <Banner tone="ok" className="mb-4" onDismiss={() => setFiled(false)}>
              Sent to head office.
            </Banner>
          )}
          <RepairList site={site} team={team} onNew={start} />
          <RepairComposer
            open={composing}
            onClose={() => setComposing(false)}
            site={site}
            onFiled={(what) => setFiled(what === "repair")}
          />
        </>
      )}
    </GaScreen>
  )
}

type Phase = "OPEN" | "DONE" | "ALL"
type Order = "newest" | "oldest" | "title"

const ORDERS: readonly { readonly value: Order; readonly label: string }[] = [
  { value: "newest", label: "Newest" },
  { value: "oldest", label: "Oldest" },
  { value: "title", label: "Title" },
]

function RepairList({
  site,
  team,
  onNew,
}: {
  site: string
  team: GaContext["team"]
  onNew: () => void
}) {
  const repairs = useGaRepairs(site)
  const [phase, setPhase] = useState<Phase>("OPEN")
  const [typed, setTyped] = useState("")
  const [order, setOrder] = useState<Order>("newest")
  const [openId, setOpenId] = useState<string | null>(null)
  const [showing, setShowing] = useState(false)
  const needle = typed.trim().toLowerCase()
  const all = repairs.data
  const month = today().slice(0, 7)

  return (
    <>
      <KpiStrip>
        <Kpi
          label="Open"
          value={
            all === undefined
              ? "—"
              : count(all.filter((row) => repairIsOpen(row.status)).length)
          }
        />
        <Kpi
          label="Waiting for approval"
          value={
            all === undefined
              ? "—"
              : count(all.filter((row) => row.status === "OPEN").length)
          }
        />
        <Kpi
          label="Fixed this month"
          value={
            all === undefined
              ? "—"
              : count(
                  all.filter(
                    (row) =>
                      row.completed_at !== null &&
                      row.completed_at.slice(0, 7) === month,
                  ).length,
                )
          }
        />
      </KpiStrip>

      {gaState(repairs, {
        loading: "Reading the repairs…",
        render: (rows) => {
          if (rows.length === 0) {
            return (
              <EmptyState
                action={
                  <Button variant="primary" onClick={onNew}>
                    New repair request
                  </Button>
                }
              >
                No repairs reported.
              </EmptyState>
            )
          }
          const open = rows.filter((row) => repairIsOpen(row.status))
          const done = rows.filter((row) => !repairIsOpen(row.status))
          const pool = phase === "OPEN" ? open : phase === "DONE" ? done : rows
          const shown = pool
            .filter(
              (row) =>
                needle === "" ||
                [
                  row.title,
                  row.asset_name,
                  row.supplier_name,
                  repairObjectWords(row.objek, row.objek_name),
                ].some((field) => field?.toLowerCase().includes(needle)),
            )
            .sort((a, b) =>
              order === "title"
                ? a.title.localeCompare(b.title)
                : order === "oldest"
                  ? a.failure_at.localeCompare(b.failure_at)
                  : b.failure_at.localeCompare(a.failure_at),
            )
          return (
            <>
              <ListBar
                search={{
                  value: typed,
                  onChange: setTyped,
                  label: "Search repairs",
                }}
                status={{
                  title: "Show",
                  value: phase,
                  onChange: (next) => setPhase(next as Phase),
                  options: [
                    { value: "OPEN", label: "Open", count: open.length },
                    { value: "DONE", label: "Done", count: done.length },
                    { value: "ALL", label: "All", count: rows.length },
                  ],
                }}
                sort={{
                  value: order,
                  options: ORDERS,
                  onChange: (next) => setOrder(next as Order),
                }}
              />
              {shown.length === 0 ? (
                <EmptyState
                  action={
                    needle !== "" || phase !== "ALL" ? (
                      <Button
                        onClick={() => {
                          setTyped("")
                          setPhase("ALL")
                        }}
                      >
                        Show all repairs
                      </Button>
                    ) : undefined
                  }
                >
                  {needle !== ""
                    ? `No match for “${typed.trim()}”.`
                    : phase === "OPEN"
                      ? "Nothing open."
                      : "Nothing closed yet."}
                </EmptyState>
              ) : (
                <CardList grid>
                  {shown.map((row) => (
                    <RepairCard
                      key={row.repair_id}
                      row={row}
                      onOpen={() => {
                        setOpenId(row.repair_id)
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

      <RepairSheet
        repair={repairs.data?.find((row) => row.repair_id === openId) ?? null}
        team={team}
        open={showing}
        onClose={() => setShowing(false)}
      />
    </>
  )
}

/// One repair as the uniform lead-figure card: what is wrong over what it is
/// about, the day it was noticed as the one figure, and where it has got to.
function RepairCard({
  row,
  onOpen,
}: {
  row: GaRepairRow
  onOpen: () => void
}) {
  return (
    <LeadCard
      title={row.title}
      lines={[
        row.asset_name ?? repairObjectWords(row.objek, row.objek_name),
        row.supplier_name,
      ]}
      lead={dateLead(row.failure_at, "noticed")}
      foot={{
        info: (
          <Status tone={repairStageTone(row.status)}>
            {repairStageWords(row.status)}
          </Status>
        ),
        action: { label: "Open", onClick: onOpen },
      }}
      onOpen={onOpen}
    />
  )
}

/// One repair: where it is on the ladder, what it is about, who has it.
function RepairSheet({
  repair,
  team,
  open,
  onClose,
}: {
  repair: GaRepairRow | null
  team: GaContext["team"]
  open: boolean
  onClose: () => void
}) {
  if (repair === null) return null
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title={repair.title}
      badge={
        <Pill tone={repairStageTone(repair.status)}>
          {repairStageWords(repair.status)}
        </Pill>
      }
      caption={`Reported by ${personByLogin(team, repair.created_by)} · ${day(repair.created_at)}`}
    >
      <SheetSection title="Progress">
        <StageLadder
          flow={REPAIR_FLOW}
          at={repair.status}
          words={repairRungWords}
          exit="CANCELLED"
        />
      </SheetSection>

      <SheetSection title="The repair">
        <Facts
          rows={[
            [
              "About",
              repair.asset_name ??
                repairObjectWords(repair.objek, repair.objek_name),
            ],
            ["Kind", repairObjectWords(repair.objek, repair.objek_name)],
            ["Supplier", repair.supplier_name],
            [
              "Under contract",
              repair.contract_number ??
                (repair.contract_id === null ? "No" : "Yes"),
            ],
            ["Noticed", day(repair.failure_at)],
            [
              "Fixed",
              repair.completed_at === null ? "Not yet" : day(repair.completed_at),
            ],
            repair.approved_at !== null && [
              "Approved",
              `${day(repair.approved_at)}${
                repair.approved_by !== null
                  ? ` · ${personByLogin(team, repair.approved_by)}`
                  : ""
              }`,
            ],
            repair.notes !== null &&
              repair.notes.trim() !== "" && [
                "Notes",
                <span key="notes" className="whitespace-pre-line">
                  {repair.notes}
                </span>,
                true,
              ],
          ]}
        />
      </SheetSection>
    </Sheet>
  )
}
