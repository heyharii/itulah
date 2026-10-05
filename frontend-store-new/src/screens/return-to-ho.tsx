import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Screen } from "@/components/ui/screen"
import {
  Banner,
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/ui/states"
import { describe } from "@/lib/errors"
import { count, moment } from "@/lib/format"
import {
  returnsKey,
  sendReturn,
  useReturns,
  type StoreReturnAsk,
  type StoreReturnSent,
} from "@/lib/returns"
import { idempotencyKey } from "@itulah/contract/client"

/// **Return to HO** — what Merchandise asked this shop to send back. The shop
/// never starts a return and picks nothing: it taps **Sent** and the whole
/// request goes on the road.
export function ReturnToHo() {
  const returns = useReturns()
  const [done, setDone] = useState<StoreReturnSent | null>(null)

  if (returns.isPending)
    return (
      <Screen>
        <LoadingState />
      </Screen>
    )
  if (returns.isError)
    return (
      <Screen>
        <ErrorState
          error={returns.error}
          onRetry={() => void returns.refetch()}
        />
      </Screen>
    )

  const rows = returns.data ?? []
  return (
    <Screen className="[&>div:first-child]:md:mb-6">
      <div className="flex flex-col gap-6">
        {done !== null && (
          <Banner tone="ok" role="status">
            {done.shipment_number} · {count(done.quantity)} pcs on the way to HO
          </Banner>
        )}
        {rows.length === 0 ? (
          <Card>
            <EmptyState>Nothing to send.</EmptyState>
          </Card>
        ) : (
          rows.map((ask) => (
            <AskCard key={ask.allotment_id} ask={ask} onSent={setDone} />
          ))
        )}
      </div>
    </Screen>
  )
}

function AskCard({
  ask,
  onSent,
}: {
  ask: StoreReturnAsk
  onSent: (sent: StoreReturnSent) => void
}) {
  const client = useQueryClient()
  // One key per request card, so a retry of a dropped answer is the same act.
  const [key] = useState(() => idempotencyKey())
  const send = useMutation({
    mutationFn: () => sendReturn(ask.allotment_id, key),
    onSuccess: (sent) => {
      onSent(sent)
      void client.invalidateQueries({ queryKey: returnsKey() })
    },
  })

  function confirm() {
    if (window.confirm(`Send ${count(ask.quantity)} pcs to HO?`)) send.mutate()
  }

  return (
    <Card>
      <div className="flex items-center gap-4 px-5 py-4">
        <div className="min-w-0 flex-1">
          <p className="truncate font-mono text-id font-semibold text-ink">
            {ask.allotment_number}
          </p>
          <p className="mt-1 text-meta text-body">{moment(ask.requested_at)}</p>
        </div>
        <span className="font-medium whitespace-nowrap text-ink tabular-nums">
          {count(ask.quantity)} pcs
        </span>
        <Button variant="primary" disabled={send.isPending} onClick={confirm}>
          Pack and send
        </Button>
      </div>
      <table className="w-full border-collapse text-cell">
        <thead>
          <tr className="border-y border-hairline bg-soft text-body">
            <th
              scope="col"
              className="h-11 w-14 pr-2 pl-5 text-right font-medium"
            >
              No.
            </th>
            <th scope="col" className="h-11 px-4 text-left font-medium">
              SKU
            </th>
            <th scope="col" className="h-11 pr-5 pl-4 text-right font-medium">
              Pcs
            </th>
          </tr>
        </thead>
        <tbody>
          {ask.lines.map((line, index) => (
            <tr
              key={line.sku_code}
              className="border-b border-hairline last:border-b-0"
            >
              <td className="w-14 py-3.5 pr-2 pl-5 text-right align-middle text-mute tabular-nums">
                {index + 1}
              </td>
              <td className="min-w-0 px-4 py-3.5 align-middle">
                <span className="block font-medium text-ink">
                  {line.name ?? line.sku_code}
                </span>
                {line.name !== null && (
                  <span className="mt-1 block text-mute">{line.sku_code}</span>
                )}
              </td>
              <td className="py-3.5 pr-5 pl-4 text-right align-middle text-ink tabular-nums">
                {count(line.quantity)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {send.isError && (
        <Banner tone="bad" className="m-4">
          {describe(send.error)}
        </Banner>
      )}
    </Card>
  )
}
