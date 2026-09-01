import { useForm } from "@tanstack/react-form"
import { useQuery } from "@tanstack/react-query"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/field"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { PageHeader } from "@/components/ui/page-header"
import { Progress } from "@/components/ui/progress"
import { Banner, EmptyState } from "@/components/ui/states"
import { Lifecycle } from "@/components/ui/timeline"
import { dc } from "@/lib/api"
import { count } from "@/lib/format"
import { keys } from "@/lib/queries/keys"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"

/// "Has this shop's stock actually left, or is it still on the road?"
///
/// One allotment line, and how far along it is — **counted from containment**,
/// not read off a tally kept beside it. That distinction is the point of the
/// endpoint: a carton cannot claim to be on a truck it was never loaded onto,
/// because nothing stores where it is. The four numbers are worked out from
/// which box holds the pieces and where that box has got to.
///
/// The line id is typed or arrived at from a carton's manifest. There is no
/// list here and there should not be: an allotment line is a decision made at
/// the centre, and the DC's business with it is only "did it get there".
export function LinePosition() {
  const line = useSheet("allotment")

  const position = useQuery({
    queryKey: keys.linePosition(line.value ?? ""),
    queryFn: ({ signal }) => dc.allotmentLinePosition(line.value!, signal),
    enabled: line.value !== undefined,
  })

  const form = useForm({
    defaultValues: { id: line.value ?? "" },
    onSubmit: ({ value }) => {
      if (value.id.trim() === "") return
      line.open(value.id.trim())
    },
  })

  const found = position.data
  const total = found
    ? found.packed + found.in_shipment + found.loaded + found.in_transit
    : 0

  return (
    <PageContent>
      <PageHeader
        crumb="Picking"
        title="Line position"
        sub="Where one shop's stock has actually got to."
      />

      <Card className="mb-[1.125rem] overflow-hidden">
        <CardHeader>
          <CardTitle>Which line</CardTitle>
        </CardHeader>
        <form
          className="flex gap-2 border-t border-hairline px-4 py-3.5"
          onSubmit={(event) => {
            event.preventDefault()
            form.handleSubmit()
          }}
        >
          <form.Field name="id">
            {(field) => (
              <Input
                className="flex-1 font-mono"
                placeholder="Allotment line id"
                aria-label="Allotment line id"
                autoCapitalize="off"
                autoCorrect="off"
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
              />
            )}
          </form.Field>
          <Button variant="dark" type="submit">
            Find it
          </Button>
        </form>
        <p className="px-4 pb-3.5 text-[0.71875rem] text-mute">
          Line ids come off a carton's manifest — open a box under Packing and
          every line it fulfils is a link straight to here.
        </p>
      </Card>

      {line.value === undefined ? (
        <Banner tone="info">
          Nothing chosen. This screen answers one question about one line, and
          it answers it from where the goods physically are.
        </Banner>
      ) : (
        queryState(position, {
          loading: "Counting where the pieces are…",
          render: (where) =>
            total === 0 ? (
              <Card>
                <EmptyState>
                  Nothing from this line has been packed yet. It is either still
                  owed on the picklist, or the line belongs to another DC.
                </EmptyState>
              </Card>
            ) : (
              <>
                <KpiStrip className="grid-cols-2 xl:grid-cols-4">
                  <Kpi
                    label="Packed"
                    value={count(where.packed)}
                    delta="in a box here"
                  />
                  <Kpi
                    label="In a consignment"
                    value={count(where.in_shipment)}
                    delta="on the dock"
                  />
                  <Kpi
                    label="Loaded"
                    value={count(where.loaded)}
                    delta="on the truck, on the yard"
                  />
                  <Kpi
                    label="On the road"
                    value={count(where.in_transit)}
                    delta="gone"
                  />
                </KpiStrip>

                <Card className="overflow-hidden">
                  <CardHeader>
                    <CardTitle>How far along</CardTitle>
                    <span className="text-[0.75rem] text-mute">
                      {count(total)} pieces accounted for
                    </span>
                  </CardHeader>
                  <div className="flex flex-col gap-4 border-t border-hairline px-4 py-4">
                    {/* Where the bulk of it is. The current step is the one
                        dark mark on the screen — a position on a track, not
                        something to press. */}
                    <Lifecycle
                      steps={[
                        {
                          label: "Packed",
                          state:
                            where.packed > 0
                              ? "current"
                              : total > where.packed
                                ? "done"
                                : "todo",
                        },
                        {
                          label: "Consignment",
                          state:
                            where.in_shipment > 0
                              ? "current"
                              : where.loaded + where.in_transit > 0
                                ? "done"
                                : "todo",
                        },
                        {
                          label: "Loaded",
                          state:
                            where.loaded > 0
                              ? "current"
                              : where.in_transit > 0
                                ? "done"
                                : "todo",
                        },
                        {
                          label: "On the road",
                          state: where.in_transit > 0 ? "current" : "todo",
                        },
                      ]}
                    />

                    <Progress
                      label="Left the DC"
                      value={where.in_transit}
                      of={total}
                      // Sky, and only here: in transit is the one stage on
                      // this screen that means *in motion*.
                      tone={where.in_transit === total ? "ok" : "accent"}
                      detail={`${count(where.in_transit)}/${count(total)}`}
                    />
                  </div>
                </Card>
              </>
            ),
        })
      )}
    </PageContent>
  )
}
