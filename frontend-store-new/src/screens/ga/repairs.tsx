import { Plus } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Pill } from "@/components/ui/pill"
import { RecordSheet } from "@/components/ui/record-sheet"
import { Segmented } from "@/components/ui/segmented"
import { Banner } from "@/components/ui/states"
import { count } from "@/lib/format"
import { useGaRepairs } from "@/lib/queries/ga"
import {
  day,
  REPAIR_FLOW,
  repairIsOpen,
  repairObjectIcon,
  repairObjectWords,
  repairStageTone,
  repairStageWords,
} from "@/screens/ga/format"
import {
  Fact,
  Facts,
  GaScreen,
  RowTable,
  SheetBlock,
  StageLadder,
  Toolbar,
  TwoLine,
  type RowColumn,
} from "@/screens/ga/parts"
import { RepairComposer } from "@/screens/ga/repair-composer"
import { gaState } from "@/screens/ga/state"
import type { GaRepairRow } from "@itulah/contract"

/// What this shop has reported broken, and how far each report has got.
///
/// The shop files; head office climbs the ladder — approves it, sends the
/// vendor, marks it fixed, closes it. So this screen is a READING of that
/// ladder plus one act, "New request", which lands a repair on GA's book the
/// moment it is sent. A repair about one of the shop's things can also be
/// filed from that thing's sheet under Assets.
///
/// No money here. A repair carries its estimate, its approved budget and
/// Finance's actual cost, and none of them is the shop's to act on: the quote
/// is between GA and the vendor, and the bill is Finance's.
export function Repairs() {
  const [composing, setComposing] = useState(false)
  const [filed, setFiled] = useState(false)
  return (
    <GaScreen
      actions={
        <Button
          variant="primary"
          onClick={() => {
            setFiled(false)
            setComposing(true)
          }}
        >
          <Plus />
          New request
        </Button>
      }
    >
      {(site) => (
        <>
          {filed && (
            <Banner tone="ok" className="mb-4">
              Sent to head office.
            </Banner>
          )}
          <RepairList site={site} onNew={() => setComposing(true)} />
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

const columns: readonly RowColumn<GaRepairRow>[] = [
  {
    id: "repair",
    header: "Repair",
    className: "max-w-[24rem]",
    cell: (row) => (
      <TwoLine
        icon={repairObjectIcon(row.objek)}
        top={row.title}
        under={row.asset_name ?? repairObjectWords(row.objek, row.objek_name)}
      />
    ),
  },
  {
    id: "reported",
    header: "Noticed",
    cell: (row) => <span className="tabular-nums">{day(row.failure_at)}</span>,
  },
  {
    id: "vendor",
    header: "Supplier",
    cell: (row) => row.supplier_name,
  },
  {
    id: "status",
    header: "Status",
    card: "status",
    cell: (row) => (
      <Pill tone={repairStageTone(row.status)}>
        {repairStageWords(row.status)}
      </Pill>
    ),
  },
]

function RepairList({ site, onNew }: { site: string; onNew: () => void }) {
  const repairs = useGaRepairs(site)
  const [phase, setPhase] = useState<Phase>("OPEN")
  const [openId, setOpenId] = useState<string | null>(null)
  const [showing, setShowing] = useState(false)

  return (
    <>
      {gaState(repairs, {
        loading: "Loading…",
        render: (rows) => {
          const open = rows.filter((row) => repairIsOpen(row.status))
          const done = rows.filter((row) => !repairIsOpen(row.status))
          const shown = phase === "OPEN" ? open : phase === "DONE" ? done : rows
          if (rows.length === 0) {
            return (
              <Card>
                <div className="mx-auto flex max-w-[30em] flex-col items-center gap-4 px-4 py-12 text-center">
                  <p className="text-meta text-body">
                    No repairs reported.
                  </p>
                  <Button variant="ghost" onClick={onNew}>
                    <Plus />
                    New request
                  </Button>
                </div>
              </Card>
            )
          }
          return (
            <>
              <Toolbar>
                <Segmented<Phase>
                  value={phase}
                  onChange={setPhase}
                  className="md:w-auto [&>button]:px-3.5 [&>button]:whitespace-nowrap pointer-coarse:[&>button]:h-tap md:pointer-fine:[&>button]:h-8"
                  options={[
                    { value: "OPEN", label: `Open · ${count(open.length)}` },
                    { value: "DONE", label: `Done · ${count(done.length)}` },
                    { value: "ALL", label: `All · ${count(rows.length)}` },
                  ]}
                />
              </Toolbar>
              <Card>
                <RowTable
                  rows={shown}
                  columns={columns}
                  rowKey={(row) => row.repair_id}
                  onOpen={(row) => {
                    setOpenId(row.repair_id)
                    setShowing(true)
                  }}
                  empty={
                    phase === "OPEN"
                      ? "Nothing open."
                      : "Nothing closed yet."
                  }
                />
              </Card>
            </>
          )
        },
      })}

      <RepairSheet
        repair={repairs.data?.find((row) => row.repair_id === openId) ?? null}
        open={showing}
        onClose={() => setShowing(false)}
      />
    </>
  )
}

/// One repair: where it is on the ladder, what it is about, who has it.
function RepairSheet({
  repair,
  open,
  onClose,
}: {
  repair: GaRepairRow | null
  open: boolean
  onClose: () => void
}) {
  if (repair === null) return null
  return (
    <RecordSheet
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
      caption={`Reported by ${repair.created_by} · ${day(repair.created_at)}`}
    >
      <SheetBlock title="Where it has got to">
        <StageLadder
          flow={REPAIR_FLOW}
          at={repair.status}
          words={repairStageWords}
          exit="CANCELLED"
        />
      </SheetBlock>

      <SheetBlock title="The repair">
        <Facts>
          <Fact term="About">
            {repair.asset_name ??
              repairObjectWords(repair.objek, repair.objek_name)}
          </Fact>
          <Fact term="Kind">
            {repairObjectWords(repair.objek, repair.objek_name)}
          </Fact>
          <Fact term="Supplier">{repair.supplier_name}</Fact>
          <Fact term="Under contract">
            {repair.contract_number ??
              (repair.contract_id === null ? "No" : "Yes")}
          </Fact>
          <Fact term="Noticed">{day(repair.failure_at)}</Fact>
          <Fact term="Fixed">
            {repair.completed_at === null
              ? "Not yet"
              : day(repair.completed_at)}
          </Fact>
          {repair.approved_at !== null && (
            <Fact term="Approved">
              {day(repair.approved_at)}
              {repair.approved_by !== null && ` · ${repair.approved_by}`}
            </Fact>
          )}
          {repair.notes !== null && repair.notes.trim() !== "" && (
            <Fact term="Notes" wide>
              <span className="whitespace-pre-line">{repair.notes}</span>
            </Fact>
          )}
        </Facts>
      </SheetBlock>
    </RecordSheet>
  )
}
