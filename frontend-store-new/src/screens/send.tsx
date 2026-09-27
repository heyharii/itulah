import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Field, Input, Select } from "@/components/ui/field"
import { ListTable, type ListColumn } from "@/components/ui/list-table"
import { Screen } from "@/components/ui/screen"
import { Banner, EmptyState, LoadingState } from "@/components/ui/states"
import { describe } from "@/lib/errors"
import { count } from "@/lib/format"
import {
  destinationsKey,
  fetchDestinations,
  fetchOutstanding,
  outstandingKey,
  pick,
} from "@/lib/queries"
import { useIdentity, useNodeIdentity } from "@/lib/session"
import { PLACES, type PlaceCode } from "@/screens/stock/shared"
import type { DestinationDemand, OutstandingLine } from "@itulah/contract"
import { idempotencyKey } from "@itulah/contract/client"

/// **Send** — every site this shop still owes something to, and the pick that
/// sends it on its way.
///
/// The same act a DC's Picking screen describes, from the other side: a
/// quantity off one of this shop's three places, assigned to accepted
/// allotment lines in FIFO order by the server. There is no line or EPC to
/// choose here, on purpose — a pick commits to a destination by nothing more
/// than "this many, off that rack", and koli, sealing and dispatch stay a DC's
/// job.
///
/// `packable` on the list is never summed across destinations — see
/// `DestinationDemand` — so this screen only ever shows it beside the one row
/// it describes.
const columns: readonly ListColumn<DestinationDemand>[] = [
  {
    id: "destination",
    header: "Destination",
    card: "title",
    cell: (row) => (
      <span className="text-ink font-medium">{row.destination_id}</span>
    ),
  },
  {
    id: "skus",
    header: "SKUs owed",
    card: "meta",
    cell: (row) => count(row.sku_count),
  },
  {
    id: "wanted",
    header: "Wanted",
    align: "right",
    card: "meta",
    cell: (row) => count(row.wanted),
  },
  {
    id: "packable",
    header: "Can send now",
    align: "right",
    cell: (row) => (
      <span className="text-ink font-medium">{count(row.packable)}</span>
    ),
  },
]

export function Send() {
  const destinations = useQuery({
    queryKey: destinationsKey(),
    queryFn: ({ signal }) => fetchDestinations(signal),
  })

  if (destinations.isPending) {
    return (
      <Screen>
        <LoadingState>Reading who this shop still owes…</LoadingState>
      </Screen>
    )
  }

  if (destinations.isError) {
    return (
      <Screen>
        <Banner tone="bad">{describe(destinations.error)}</Banner>
      </Screen>
    )
  }

  const rows = destinations.data ?? []

  return (
    <Screen sub="Every site this shop still owes something to. Open one to pick what can honestly go now.">
      <Card>
        <ListTable
          rows={rows}
          columns={columns}
          rowKey={(row) => row.destination_id}
          detail={(row) => <SendDetail destination={row} />}
          empty="Nothing owed. This shop has no open allotment line to another site."
        />
      </Card>
    </Screen>
  )
}

function SendDetail({ destination }: { destination: DestinationDemand }) {
  const where = useNodeIdentity()
  const identity = useIdentity()
  const site = where.data?.site_id ?? null
  const client = useQueryClient()
  const [from, setFrom] = useState<PlaceCode>("warehouse")
  const [quantities, setQuantities] = useState<
    Readonly<Record<string, string>>
  >({})

  const outstanding = useQuery({
    queryKey: outstandingKey(destination.destination_id),
    queryFn: ({ signal }) =>
      fetchOutstanding(destination.destination_id, signal),
  })

  const send = useMutation({
    // One line, one pick, one idempotency key each — they are separate
    // writes on separate SKUs, and sharing a key between them would let a
    // retry of the first quietly stand in for the second.
    mutationFn: async (lines: readonly { sku: string; quantity: number }[]) => {
      if (site === null)
        throw new Error("This till does not know its own site.")
      for (const line of lines) {
        await pick({
          source_pool_id: `${site}.${from}`,
          sku_code: line.sku,
          quantity: line.quantity,
          actor_id: identity.data?.username ?? "",
          idempotency_key: idempotencyKey(),
          pick_session_id: null,
        })
      }
    },
    onSuccess: () => {
      setQuantities({})
      void client.invalidateQueries({ queryKey: destinationsKey() })
      void client.invalidateQueries({
        queryKey: outstandingKey(destination.destination_id),
      })
    },
  })

  if (outstanding.isPending)
    return <LoadingState>Reading what is owed…</LoadingState>
  if (outstanding.isError)
    return <Banner tone="bad">{describe(outstanding.error)}</Banner>

  const lines = outstanding.data ?? []
  const toSend = lines
    .map((line) => ({
      sku: line.sku_code,
      quantity: Math.min(
        Math.max(0, Math.trunc(Number(quantities[line.sku_code] ?? "0"))),
        line.outstanding,
      ),
    }))
    .filter((line) => line.quantity > 0)

  return (
    <div className="flex flex-col gap-4">
      {where.data === undefined || site === null ? (
        <Banner tone="warn">
          This till has not been told which shop it is standing in, so it cannot
          say which place a pick comes off.
        </Banner>
      ) : (
        <Field label="Pick from" className="max-w-[16rem]">
          <Select value={from} onChange={(next) => setFrom(next as PlaceCode)}>
            {PLACES.map((place) => (
              <option key={place.code} value={place.code}>
                {place.label}
              </option>
            ))}
          </Select>
        </Field>
      )}

      {lines.length === 0 ? (
        <EmptyState>
          Nothing off this shop's racks can honestly go to this destination
          right now.
        </EmptyState>
      ) : (
        <div className="divide-hairline rounded-inner border-hairline flex flex-col divide-y border">
          {lines.map((line) => (
            <OutstandingRow
              key={line.sku_code}
              line={line}
              value={quantities[line.sku_code] ?? ""}
              onChange={(value) =>
                setQuantities((current) => ({
                  ...current,
                  [line.sku_code]: value,
                }))
              }
            />
          ))}
        </div>
      )}

      {send.isError && <Banner tone="bad">{describe(send.error)}</Banner>}
      {send.isSuccess && (
        <Banner tone="ok">Sent. The pick is off the racks.</Banner>
      )}

      <Button
        variant="primary"
        disabled={toSend.length === 0 || site === null || send.isPending}
        onClick={() => send.mutate(toSend)}
      >
        Send {count(toSend.reduce((total, line) => total + line.quantity, 0))}{" "}
        piece{toSend.length === 1 && toSend[0]!.quantity === 1 ? "" : "s"}
      </Button>
    </div>
  )
}

function OutstandingRow({
  line,
  value,
  onChange,
}: {
  line: OutstandingLine
  value: string
  onChange: (value: string) => void
}) {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5">
      <span className="min-w-0 flex-1">
        <span className="text-ink block truncate font-medium">
          {line.sku_code}
        </span>
        <span className="text-meta text-mute block">
          {count(line.outstanding)} can go now · {count(line.wanted)} wanted
        </span>
      </span>
      <Input
        type="number"
        min={0}
        max={line.outstanding}
        inputMode="numeric"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="0"
        className="h-10 w-20 text-right"
      />
    </div>
  )
}
