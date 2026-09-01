import { useQuery } from "@tanstack/react-query"

import { PageContent } from "@/components/shell/app-shell"
import { AppLink } from "@/components/ui/app-link"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { PageHeader } from "@/components/ui/page-header"
import { MiniTable } from "@/components/ui/rows"
import { SessionBar } from "@/components/ui/session-bar"
import { Fact, Facts } from "@/components/ui/sheet"
import { EmptyState } from "@/components/ui/states"
import { dc } from "@/lib/api"
import { clock, count } from "@/lib/format"
import { keys } from "@/lib/queries/keys"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"

/// "This trip round the racks — what came back?"
///
/// A picker does not walk out for one SKU. They take the sheet of everything
/// still owed, walk the aisles once, and confirm each SKU as it comes off its
/// rack. The pick event stays per SKU because that is the unit of what happens
/// at a rack; the round is what gathers them into the trip they belonged to.
///
/// The round id is in the URL, so a handheld that slept in somebody's hand
/// comes back to the same one instead of tempting them to open a second.
export function PickRounds() {
  const round = useSheet("pick")

  // `{ ready: true }` on the wire means "still open". The rounds somebody
  // could pick up are exactly these.
  const open = useQuery({
    queryKey: keys.pickRounds({ ready: true }),
    queryFn: ({ signal }) => dc.pickSessions({ ready: true }, signal),
  })

  const summary = useQuery({
    queryKey: keys.pickRound(round.value ?? ""),
    queryFn: ({ signal }) => dc.pickSession(round.value!, signal),
    enabled: round.value !== undefined,
  })

  return (
    <PageContent>
      <PageHeader
        crumb="Picking"
        title="Rounds"
        sub="One trip round the aisles, and everything that came back from it."
      />

      <div className="grid gap-[1.125rem] xl:grid-cols-[23rem_minmax(0,1fr)] xl:items-start">
        <SessionBar
          kind="Pick"
          urlKey="pick"
          open={open.data ?? []}
          isLoading={open.isPending}
          onOpen={(actor) =>
            dc.openPickSession({ actor_id: actor, note: null })
          }
          onClose={(id) => dc.closePickSession(id)}
          invalidates={[keys.pickRounds({ ready: true }), keys.picklist()]}
        >
          {summary.data && (
            <Facts>
              <Fact term="SKUs">{count(summary.data.sku_count)}</Fact>
              <Fact term="Pieces">{count(summary.data.total_picked)}</Fact>
              <Fact term="Started">
                {clock(summary.data.session.started_at)}
              </Fact>
              <Fact term="Racks visited">
                {count(summary.data.lines.length)}
              </Fact>
            </Facts>
          )}
        </SessionBar>

        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle>What came back</CardTitle>
            {summary.data && (
              <span className="text-[0.75rem] text-mute">
                {count(summary.data.total_picked)} pieces
              </span>
            )}
          </CardHeader>

          {round.value === undefined ? (
            <EmptyState
              action={
                <AppLink to="/picking" variant="soft">
                  Go to the picklist
                </AppLink>
              }
            >
              No round is open. Picks are recorded either way — a round is what
              lets somebody read a trip back afterwards.
            </EmptyState>
          ) : (
            queryState(summary, {
              loading: "Reading the round…",
              render: (round_) =>
                round_.lines.length === 0 ? (
                  <EmptyState
                    action={
                      <AppLink to="/picking" variant="soft">
                        Go to the picklist
                      </AppLink>
                    }
                  >
                    Nothing off the racks yet in this round.
                  </EmptyState>
                ) : (
                  <div className="px-4 pt-1 pb-3.5">
                    <MiniTable head={["SKU", "Picked", "Trips"]}>
                      {round_.lines.map((line) => (
                        <tr
                          key={line.sku_code}
                          className="border-t border-hairline"
                        >
                          <td className="py-2.5 pr-2 font-mono text-[0.71875rem] text-ink">
                            {line.sku_code}
                          </td>
                          <td className="py-2.5 text-right tabular-nums">
                            {count(line.picked)}
                          </td>
                          {/* More than one means a picker came back to the
                              same rack — a rack that keeps needing second
                              trips is a rack in the wrong place. */}
                          <td className="py-2.5 text-right tabular-nums">
                            <span
                              className={
                                line.events > 1 ? "text-warn-fg" : "text-mute"
                              }
                            >
                              {count(line.events)}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </MiniTable>
                  </div>
                ),
            })
          )}
        </Card>
      </div>
    </PageContent>
  )
}
