import { useQuery } from "@tanstack/react-query"

import { PageContent } from "@/components/shell/app-shell"
import { StorePicker } from "@/components/store-picker"
import { Allocation, AllocationRow } from "@/components/ui/allocation"
import { AppLink } from "@/components/ui/app-link"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { PageHeader } from "@/components/ui/page-header"
import { Progress } from "@/components/ui/progress"
import { Banner, EmptyState } from "@/components/ui/states"
import { dc } from "@/lib/api"
import { count } from "@/lib/format"
import { keys } from "@/lib/queries/keys"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"

/// What one shop is still owed, and how much of it this DC can actually send.
///
/// Three numbers per SKU, and only the third is a decision: **wanted** is what
/// the shop still has coming across all its open allotment lines,
/// **available** is what is off the racks standing in the outbound area for
/// nobody in particular, and **outstanding** is the smaller of the two — what
/// can honestly go in a box right now.
///
/// The gap between wanted and available is the useful reading on this screen:
/// it is the difference between "the shop is waiting on the racks" and "the
/// shop is waiting on a packer".
export function Destinations() {
  const store = useSheet("store")
  const destination = store.value ?? null

  const outstanding = useQuery({
    queryKey: keys.outstanding(destination ?? ""),
    queryFn: ({ signal }) => dc.outstandingFor(destination!, signal),
    enabled: destination !== null,
  })

  const lines = outstanding.data ?? []
  const wanted = lines.reduce((total, line) => total + line.wanted, 0)
  const sendable = lines.reduce((total, line) => total + line.outstanding, 0)

  return (
    <PageContent>
      <PageHeader
        crumb="Despatch"
        title="Destinations"
        sub="What a shop is still owed, and how much of it can leave today."
      />

      <StorePicker hint="There is no list of every destination on an edge node — this DC knows only the shops it has actually packed for." />

      {destination === null ? (
        <Banner tone="info">
          Name a shop. There is no list of every destination on an edge node —
          allotments are authored at the centre, and this DC knows only the
          shops it has actually packed for.
        </Banner>
      ) : (
        queryState(outstanding, {
          loading: "Reading what this shop is owed…",
          render: () =>
            lines.length === 0 ? (
              <Card>
                <EmptyState>
                  Nothing outstanding for {destination}. Either it has nothing
                  coming, or everything it is owed has already left.
                </EmptyState>
              </Card>
            ) : (
              <Card className="overflow-hidden">
                <CardHeader>
                  <CardTitle>{destination}</CardTitle>
                  <span className="text-[0.75rem] text-mute">
                    {count(lines.length)} SKUs
                  </span>
                </CardHeader>
                <div className="border-t border-hairline px-4 py-3.5">
                  <Progress
                    className="mb-3.5"
                    label="Can go now"
                    value={sendable}
                    of={wanted}
                    tone={sendable === wanted ? "ok" : "warn"}
                    detail={`${count(sendable)}/${count(wanted)}`}
                  />

                  <Allocation
                    left={{ label: "Wanted", total: count(wanted) }}
                    right={{ label: "Can go", total: count(sendable) }}
                  >
                    {lines.map((line) => (
                      <AllocationRow
                        key={line.sku_code}
                        name={line.sku_code}
                        sub={
                          line.outstanding === 0
                            ? "waiting on the racks"
                            : line.outstanding < line.wanted
                              ? "part of it can go"
                              : "all of it can go"
                        }
                        expected={count(line.wanted)}
                        found={count(line.available)}
                        difference={{
                          value: count(line.outstanding),
                          agrees: line.outstanding >= line.wanted,
                        }}
                      />
                    ))}
                  </Allocation>

                  <p className="mt-3 text-[0.71875rem] text-mute">
                    Wanted is what the shop still has coming. The middle column
                    is what is off the racks for nobody in particular — picking
                    commits to no destination. The last is the smaller of the
                    two, which is all a packer can honestly put in a box.
                  </p>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <AppLink
                      to="/packing/fill"
                      sheet={{ key: "store", value: destination }}
                      variant="dark"
                    >
                      Pack for {destination}
                    </AppLink>
                    {sendable < wanted && (
                      <AppLink to="/picking" variant="ghost">
                        Go and pick the rest
                      </AppLink>
                    )}
                  </div>
                </div>
              </Card>
            ),
        })
      )}
    </PageContent>
  )
}
