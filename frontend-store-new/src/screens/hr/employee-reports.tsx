import { useState } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Banner } from "@/components/ui/states"
import { bossName } from "@/lib/line"
import type { StoreScope } from "@/lib/queries/hr"
import { useProposeBoss, type LineRead } from "@/lib/queries/line"
import { describeCentre } from "@/screens/hr/centre"
import { Block, Blank, Fact, Facts } from "@/screens/hr/employee-parts"
import { ReportsTo } from "@/screens/hr/line-pick"

/// *Reports To* on a person's page — the shop's line of report, and the way to
/// ask head office to change it. Where the hub keeps a person's *Position*
/// (`placement.tsx`, head office's own), a shop keeps this.
///
/// Facts first — who they report to now, and who reports to them — then the
/// picker (`line-pick.tsx`) and the one button. The button is *Propose to HO*,
/// enabled only when somebody other than the present boss is ticked and the
/// reason is written; head office decides, and the chart goes on showing the
/// present boss until it does. A person at the top has no picker and no
/// button, and one with a change already waiting has neither: the block says
/// what was asked.
export function ReportsToBlock({
  scope,
  id,
  line,
}: {
  scope: StoreScope
  id: string
  line: LineRead
}) {
  const propose = useProposeBoss(scope)
  const [picked, setPicked] = useState<string | null>(null)
  const [reason, setReason] = useState("")

  const ready = line.state === "ready" ? line.line : null
  const current = ready?.boss(id) ?? null
  const changed = picked !== null && picked !== current
  const canAsk =
    ready !== null && current !== null && ready.waiting(id) === undefined
  const reports = ready?.reports(id) ?? []

  return (
    <Block title="Reports To">
      <div className="flex flex-col gap-5">
        <Facts>
          <Fact term="Reports To">
            {ready === null ? <Blank /> : bossName(ready, id)}
          </Fact>
          <Fact term="Direct Reports" wide>
            {ready === null || reports.length === 0 ? (
              <Blank />
            ) : (
              reports
                .map((one) => ready.member(one)?.name)
                .filter(Boolean)
                .join(", ")
            )}
          </Fact>
        </Facts>

        <ReportsTo
          read={line}
          id={id}
          chosen={picked}
          onChoose={setPicked}
          reason={reason}
          onReason={setReason}
        />

        {propose.error !== null && (
          <Banner tone="bad">{describeCentre(propose.error)}</Banner>
        )}
        {canAsk && (
          <div className="flex justify-end">
            <Button
              variant="primary"
              pending={propose.isPending}
              disabled={!changed || reason.trim() === ""}
              onClick={() => {
                if (picked === null) return
                propose.mutate(
                  { employeeId: id, bossId: picked, reason: reason.trim() },
                  {
                    onSuccess: () => {
                      toast("Sent to head office")
                      setPicked(null)
                      setReason("")
                    },
                  },
                )
              }}
            >
              {propose.isPending ? "Sending…" : "Propose to HO"}
            </Button>
          </div>
        )}
      </div>
    </Block>
  )
}
