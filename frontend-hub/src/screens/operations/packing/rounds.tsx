import { useQuery } from "@tanstack/react-query"
import { Package } from "lucide-react"

import { PageContent } from "@/components/shell/app-shell"
import { AppLink } from "@/components/ui/app-link"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { SessionBar } from "@/components/ui/session-bar"
import { Fact, Facts } from "@/components/ui/sheet"
import { EmptyState } from "@/components/ui/states"
import { dc } from "@/lib/api"
import { clock, count, label, positionTone } from "@/lib/format"
import { keys } from "@/lib/operations/keys"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"

/// "These two hundred pieces became how many boxes, and what is in each?"
///
/// A packing round is a shift at a bench. Cartons are claimed into it — a box
/// can exist without one, because filling a carton is ordinary work — and the
/// round is what lets a supervisor read a bench's afternoon back.
///
/// The round id is in the URL for the same reason a pick round's is: a bench
/// tablet that slept must come back to the round it was in rather than tempt
/// somebody to open a second.
export function PackRounds() {
  const round = useSheet("pack")

  const open = useQuery({
    queryKey: keys.packRounds({ ready: true }),
    queryFn: ({ signal }) => dc.packingSessions({ ready: true }, signal),
  })

  const summary = useQuery({
    queryKey: keys.packRound(round.value ?? ""),
    queryFn: ({ signal }) => dc.packingSession(round.value!, signal),
    enabled: round.value !== undefined,
  })

  return (
    <PageContent>
      <PageHeader
        crumb="Packing"
        title="Rounds"
        sub="One shift at a bench, and the cartons it built."
      />

      <div className="grid gap-[1.125rem] xl:grid-cols-[23rem_minmax(0,1fr)] xl:items-start">
        <SessionBar
          kind="Packing"
          urlKey="pack"
          open={open.data ?? []}
          isLoading={open.isPending}
          onOpen={(actor) =>
            dc.openPackingSession({ actor_id: actor, note: null })
          }
          onClose={(id) => dc.closePackingSession(id)}
          invalidates={[keys.packRounds({ ready: true }), keys.koli()]}
        >
          {summary.data && (
            <Facts>
              <Fact term="Cartons">{count(summary.data.koli_count)}</Fact>
              <Fact term="Pieces">{count(summary.data.unit_count)}</Fact>
              <Fact term="Still open">
                <span
                  className={
                    summary.data.unsealed_count > 0 ? "text-warn-fg" : undefined
                  }
                >
                  {count(summary.data.unsealed_count)}
                </span>
              </Fact>
              <Fact term="Started">
                {clock(summary.data.session.started_at)}
              </Fact>
            </Facts>
          )}
        </SessionBar>

        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle>Cartons in this round</CardTitle>
            {summary.data && (
              <span className="text-[0.75rem] text-mute">
                {count(summary.data.unit_count)} pieces
              </span>
            )}
          </CardHeader>

          {round.value === undefined ? (
            <EmptyState
              action={
                <AppLink to="/operations/packing/fill" variant="soft">
                  Fill a box
                </AppLink>
              }
            >
              No round is open. Cartons can be filled either way — a round is
              what gathers a bench's shift into one thing to read back.
            </EmptyState>
          ) : (
            queryState(summary, {
              loading: "Reading the round…",
              render: (record) =>
                record.koli.length === 0 ? (
                  <EmptyState
                    action={
                      <AppLink to="/operations/packing" variant="soft">
                        Claim a carton
                      </AppLink>
                    }
                  >
                    Nothing claimed into this round yet. A carton filled at
                    another bench can be claimed from the Boxes screen.
                  </EmptyState>
                ) : (
                  <div className="border-t border-hairline">
                    {record.koli.map((box) => (
                      <AppLink
                        key={box.koli_id}
                        to="/operations/packing"
                        sheet={{ key: "koli", value: box.koli_id }}
                        className="flex min-h-tap items-center gap-3 border-b border-hairline px-4 py-2.5 transition-colors last:border-b-0 hover:bg-soft"
                      >
                        <span className="grid size-[1.6875rem] shrink-0 place-items-center rounded-inner border border-hairline-2 bg-canvas text-body">
                          <Package className="size-[0.9375rem]" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-mono text-id text-ink">
                            {box.koli_number}
                          </span>
                          <span className="block truncate text-[0.6875rem] text-mute">
                            {box.destination_store_id} · {count(box.unit_count)}{" "}
                            pieces
                          </span>
                        </span>
                        <Pill tone={positionTone(box.position)}>
                          {label(box.position)}
                        </Pill>
                      </AppLink>
                    ))}
                  </div>
                ),
            })
          )}
        </Card>
      </div>
    </PageContent>
  )
}
