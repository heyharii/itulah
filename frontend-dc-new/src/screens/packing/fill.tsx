import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { StorePicker } from "@/components/store-picker"
import { AppLink } from "@/components/ui/app-link"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { PageHeader } from "@/components/ui/page-header"
import { MiniTable } from "@/components/ui/rows"
import { ScanField } from "@/components/ui/scan-field"
import { Banner, EmptyState, Problem, Receipt } from "@/components/ui/states"
import { dc } from "@/lib/api"
import { count, label } from "@/lib/format"
import { keys } from "@/lib/queries/keys"
import { queryState } from "@/lib/query-state"
import { useActor } from "@/lib/session"
import { useSheet } from "@/lib/sheets"
import { idempotencyKey } from "@itulah/contract/client"
import type { FulfillmentProgressResult } from "@itulah/contract"

/// Filling a box — where the outbound flow actually decides something.
///
/// Picking fetched a SKU for nobody in particular. Putting a piece in a box
/// for a shop is what fulfils an allotment line: **the oldest line still
/// wanting that SKU for that shop, chosen by the server**, not by the packer.
/// If no line wants it the pack is refused rather than quietly recorded.
///
/// The destination is in the URL because every read here is scoped to it, and
/// because a packer sent to help at another bench is sent a link rather than
/// told a store id over a warehouse's noise.
export function FillBox() {
  const store = useSheet("store")
  const destination = store.value ?? null

  return (
    <PageContent>
      <PageHeader
        crumb="Packing"
        title="Fill a box"
        sub="Scan pieces into one carton for one shop. The server decides which line each fulfils."
      />

      <StorePicker hint="A shop's first ever carton has to be possible to type, so this is not a closed list." />

      {destination === null ? (
        <Banner tone="info">
          Name the shop this carton is for. Until it is named there is nothing
          honest to show: what can go in a box depends entirely on which shop it
          is going to.
        </Banner>
      ) : (
        <div className="grid gap-[1.125rem] xl:grid-cols-[minmax(0,1fr)_23rem] xl:items-start">
          <Scan destination={destination} />
          <Owed destination={destination} />
        </div>
      )}
    </PageContent>
  )
}

/// Scan pieces into a box.
///
/// The EPCs are gathered here and sent in one request, because the box is the
/// unit the server records: one destination, many allotment lines, one
/// movement group. Sending them one at a time would be one carton per piece.
function Scan({ destination }: { destination: string }) {
  const actor = useActor()
  const client = useQueryClient()
  /// Not a form: nothing here is typed or edited. A chip is either in the box
  /// or tapped back out of it, and this list is gone the moment it is sent.
  const [epcs, setEpcs] = useState<string[]>([])
  const [packed, setPacked] = useState<FulfillmentProgressResult | null>(null)

  const pack = useMutation({
    mutationFn: () =>
      dc.packKoli({
        destination_store_id: destination,
        epcs,
        actor_id: actor,
        // A box packed twice is a second carton holding pieces that are
        // already in the first one — and the movements to match.
        idempotency_key: idempotencyKey(),
      }),
    onSuccess: (result) => {
      setPacked(result)
      setEpcs([])
      // A packed box changes the boxes on the floor, what this shop still has
      // coming, the round's totals, and the outbound pools behind all of them.
      // The whole DC surface is a view of those two things.
      void client.invalidateQueries({ queryKey: keys.dc.all })
      void client.invalidateQueries({ queryKey: keys.pools() })
    },
  })

  const add = (value: string) => {
    const epc = value.toUpperCase()
    // A tag swept twice is one piece. Silently ignoring the second scan is
    // right here: the alternative is a box that claims more than it holds.
    setEpcs((current) => (current.includes(epc) ? current : [...current, epc]))
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle>Into the box</CardTitle>
        <span className="text-[0.75rem] text-mute">
          {epcs.length === 0
            ? "nothing scanned"
            : `${count(epcs.length)} scanned`}
        </span>
      </CardHeader>

      <div className="border-t border-hairline">
        <ScanField
          placeholder="Scan a piece"
          action="In"
          hint="Scanning the same tag twice adds it once."
          onSubmit={add}
        />
      </div>

      {epcs.length > 0 && (
        <>
          <div className="flex flex-wrap gap-1.5 border-t border-hairline px-4 py-3">
            {epcs.map((epc) => (
              <button
                key={epc}
                type="button"
                aria-label={`Take ${epc} back out`}
                onClick={() =>
                  setEpcs((current) => current.filter((other) => other !== epc))
                }
                className="min-h-[2.25rem] rounded-full bg-soft-2 px-3 font-mono text-[0.6875rem] text-body transition-colors hover:bg-bad-bg hover:text-bad-fg"
              >
                {epc}
              </button>
            ))}
          </div>
          <div className="border-t border-hairline px-4 py-3">
            <Button
              variant="dark"
              className="w-full"
              disabled={pack.isPending}
              onClick={() => pack.mutate()}
            >
              {pack.isPending
                ? "Packing…"
                : `Pack ${count(epcs.length)} for ${destination}`}
            </Button>
          </div>
        </>
      )}

      <Problem error={pack.error} className="mx-4 my-3" />

      {packed !== null && (
        <div className="border-t border-hairline px-4 py-3.5">
          <Receipt className="mb-3">
            {count(packed.units.length)} pieces packed · {label(packed.stage)} ·
            carton {packed.koli_id.slice(0, 8)}…
          </Receipt>
          <h4 className="mb-2 text-card-title font-semibold text-ink">
            What each piece went to
          </h4>
          <p className="mb-2 text-[0.71875rem] text-mute">
            Attribution happens here, not at the rack. Each piece went to the
            oldest allotment line still wanting that SKU for this shop.
          </p>
          <MiniTable head={["Tag", "SKU", "Line"]}>
            {packed.units.map((unit) => (
              <tr key={unit.epc} className="border-t border-hairline">
                <td className="py-2 pr-2 font-mono text-[0.6875rem] text-body">
                  {unit.epc}
                </td>
                <td className="py-2 text-right font-mono text-[0.6875rem] text-ink">
                  {unit.sku_code}
                </td>
                <td className="py-2 text-right">
                  <AppLink
                    to="/picking/lines"
                    sheet={{ key: "allotment", value: unit.allotment_line_id }}
                    className="font-mono text-[0.65625rem] text-info-fg underline underline-offset-2"
                  >
                    {unit.allotment_line_id.slice(0, 8)}…
                  </AppLink>
                </td>
              </tr>
            ))}
          </MiniTable>
        </div>
      )}
    </Card>
  )
}

/// What can honestly go in a box for this shop right now.
///
/// Three numbers, and the third is the only one that is a decision: what the
/// shop still has coming, what is actually off the racks and standing in the
/// outbound area for nobody in particular, and the **smaller of the two**.
function Owed({ destination }: { destination: string }) {
  const outstanding = useQuery({
    queryKey: keys.outstanding(destination),
    queryFn: ({ signal }) => dc.outstandingFor(destination, signal),
  })

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle>What can go in</CardTitle>
        <span className="font-mono text-id text-body">{destination}</span>
      </CardHeader>
      {queryState(outstanding, {
        loading: "Reading what this shop is owed…",
        render: (lines) =>
          lines.length === 0 ? (
            <EmptyState>
              Nothing can go in a box for this shop right now — either it has
              nothing coming, or nobody has fetched it off the racks yet.
            </EmptyState>
          ) : (
            <div className="border-t border-hairline">
              {lines.map((line) => (
                <div
                  key={line.sku_code}
                  className="flex min-h-tap items-center gap-3 border-b border-hairline px-4 py-2.5 last:border-b-0"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono text-id text-ink">
                      {line.sku_code}
                    </span>
                    <span className="block truncate text-[0.6875rem] text-mute">
                      {count(line.wanted)} wanted · {count(line.available)} off
                      the racks
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span
                      className={`block text-[0.9375rem] font-semibold tabular-nums ${
                        line.outstanding === 0 ? "text-mute" : "text-ink"
                      }`}
                    >
                      {count(line.outstanding)}
                    </span>
                    <span className="block text-[0.625rem] text-mute">
                      can go now
                    </span>
                  </span>
                </div>
              ))}
            </div>
          ),
      })}
    </Card>
  )
}
