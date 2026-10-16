import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { CardList } from "@/components/ui/card-list"
import { LeadCard } from "@/components/ui/lead-card"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { Pill } from "@/components/ui/pill"
import { Screen } from "@/components/ui/screen"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState } from "@/components/ui/states"
import { describe } from "@/lib/errors"
import { count, moment } from "@/lib/format"
import {
  returnsKey,
  sendReturn,
  useReturns,
  type StoreReturnAsk,
  type StoreReturnSent,
} from "@/lib/returns"
import { queryState } from "@/lib/query-state"
import { useHeld, useOpenRecord } from "@/screens/stock/open-record"
import {
  FOOT,
  Row,
  RowList,
  SheetSection,
} from "@/screens/stock/parts"
import { idempotencyKey } from "@itulah/contract/client"

/// **Return to HO** — what Merchandise asked this shop to send back. The shop
/// never starts a return and picks nothing: it taps **Pack and send** and the
/// whole request goes on the road.
///
/// Nothing at the top but the title (the top bar's) and the figures. A
/// request is a card — its number over how many items it holds, the pieces as
/// the one figure, and in the foot when it was asked beside the word that sends
/// it — and opens as a sheet over the list (`?returning=`) with the items it
/// asks for. There is no "New return" here: the request comes from head office,
/// and the shop only answers it.
export function ReturnToHo() {
  const returns = useReturns()
  const record = useOpenRecord("returning")
  const [done, setDone] = useState<StoreReturnSent | null>(null)
  // One key per request, however it is sent — from its card or from its sheet —
  // so a retry of a dropped answer is the same act.
  const keys = useRef(new Map<string, string>())
  const keyFor = (id: string) => {
    let key = keys.current.get(id)
    if (key === undefined) {
      key = idempotencyKey()
      keys.current.set(id, key)
    }
    return key
  }

  const rows = returns.data ?? []
  const pieces = rows.reduce((sum, ask) => sum + ask.quantity, 0)
  const items = rows.reduce((sum, ask) => sum + ask.lines.length, 0)

  const ready = returns.data !== undefined

  return (
    <Screen counter>
      <KpiStrip>
        <Kpi label="Requests" value={ready ? count(rows.length) : "—"} />
        <Kpi label="Items" value={ready ? count(items) : "—"} />
        <Kpi label="Pieces to send" value={ready ? count(pieces) : "—"} />
      </KpiStrip>

      {queryState(returns, {
        loading: "Reading the return requests…",
        render: () => (
          <>
            {done !== null && (
              <Banner tone="ok" role="status" className="mb-3.5">
                {done.shipment_number} · {count(done.quantity)} pcs on the way
                to HO
              </Banner>
            )}
            {rows.length === 0 ? (
              <EmptyState>Nothing to send.</EmptyState>
            ) : (
              <>
                <CardList grid>
                  {rows.map((ask) => (
                    <AskCard
                      key={ask.allotment_id}
                      ask={ask}
                      keyFor={keyFor}
                      onSent={setDone}
                      selected={record.value === ask.allotment_id}
                      onOpen={() => record.open(ask.allotment_id)}
                    />
                  ))}
                </CardList>
              </>
            )}
          </>
        ),
      })}

      <ReturnSheet
        ask={rows.find((ask) => ask.allotment_id === record.value)}
        keyFor={keyFor}
        onSent={setDone}
        onClose={record.close}
      />
    </Screen>
  )
}

/// Sending a request: one confirmation, then the whole of it goes. Shared by the
/// card's word and the sheet's foot, which are two doors to the same act.
function useSendReturn(
  ask: StoreReturnAsk,
  keyFor: (id: string) => string,
  onSent: (sent: StoreReturnSent) => void,
) {
  const client = useQueryClient()
  const send = useMutation({
    mutationFn: () => sendReturn(ask.allotment_id, keyFor(ask.allotment_id)),
    onSuccess: (sent) => {
      onSent(sent)
      void client.invalidateQueries({ queryKey: returnsKey() })
    },
  })
  function confirm() {
    if (window.confirm(`Send ${count(ask.quantity)} pcs to HO?`)) send.mutate()
  }
  return { send, confirm }
}

/// One request as the uniform card. A failed send is said under the card, where
/// the press was.
function AskCard({
  ask,
  keyFor,
  onSent,
  selected,
  onOpen,
}: {
  ask: StoreReturnAsk
  keyFor: (id: string) => string
  onSent: (sent: StoreReturnSent) => void
  selected: boolean
  onOpen: () => void
}) {
  const { send, confirm } = useSendReturn(ask, keyFor, onSent)
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <LeadCard
        onOpen={onOpen}
        selected={selected}
        title={ask.allotment_number}
        lines={[
          `${count(ask.lines.length)} ${ask.lines.length === 1 ? "item" : "items"}`,
        ]}
        lead={{ figure: count(ask.quantity), caption: "pcs" }}
        foot={{
          info: `Asked ${moment(ask.requested_at)}`,
          action: {
            label: send.isPending ? "Sending…" : "Pack and send",
            onClick: confirm,
            pending: send.isPending,
          },
        }}
      />
      {send.isError && <Banner tone="bad">{describe(send.error)}</Banner>}
    </div>
  )
}

/// One request opened over the list: what is being asked for, item by item, and
/// the one thing to do about it. `ask` is the request asked for; `undefined` is
/// closed, and the sheet keeps the last one while it slides away (a request that
/// has just been sent leaves the list before the sheet has gone).
function ReturnSheet({
  ask,
  keyFor,
  onSent,
  onClose,
}: {
  ask: StoreReturnAsk | undefined
  keyFor: (id: string) => string
  onSent: (sent: StoreReturnSent) => void
  onClose: () => void
}) {
  const held = useHeld(ask)
  if (held === undefined) return null
  return (
    <ReturnSheetFor
      key={held.allotment_id}
      ask={held}
      open={ask !== undefined}
      keyFor={keyFor}
      onSent={onSent}
      onClose={onClose}
    />
  )
}

function ReturnSheetFor({
  ask,
  open,
  keyFor,
  onSent,
  onClose,
}: {
  ask: StoreReturnAsk
  open: boolean
  keyFor: (id: string) => string
  onSent: (sent: StoreReturnSent) => void
  onClose: () => void
}) {
  const { send, confirm } = useSendReturn(ask, keyFor, (sent) => {
    onSent(sent)
    onClose()
  })

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title={ask.allotment_number}
      badge={<Pill tone="warn">To send</Pill>}
      caption={`Asked ${moment(ask.requested_at)}`}
      footer={
        <div className="flex justify-end">
          <Button
            variant="primary"
            className={`${FOOT} max-md:w-full`}
            pending={send.isPending}
            onClick={confirm}
          >
            {send.isPending ? "Sending…" : "Pack and send"}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-6">
        <Facts>
          <Fact term="Pieces">{count(ask.quantity)} pcs</Fact>
          <Fact term="Items">{count(ask.lines.length)}</Fact>
        </Facts>

        {send.isError && <Banner tone="bad">{describe(send.error)}</Banner>}

        <SheetSection title="Items" aside={count(ask.lines.length)}>
          <RowList>
            {ask.lines.map((line) => (
              <Row
                key={line.sku_code}
                title={line.name ?? line.sku_code}
                sub={
                  line.name === null ? undefined : (
                    <span className="font-mono">{line.sku_code}</span>
                  )
                }
                figure={`${count(line.quantity)} pcs`}
              />
            ))}
          </RowList>
        </SheetSection>
      </div>
    </Sheet>
  )
}
