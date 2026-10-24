import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useRef, useState } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Checkbox, Field, Input } from "@/components/ui/field"
import { Pill } from "@/components/ui/pill"
import { Sheet } from "@/components/ui/sheet"
import { Banner } from "@/components/ui/states"
import { describe } from "@/lib/errors"
import { pcs, sku } from "@/lib/format"
import {
  fetchReturns,
  raiseRejectReturn,
  returnsKey,
  sendReturn,
  type StoreReturnAsk,
  type ToReturnPocket,
} from "@/lib/returns"
import { inventoryKey } from "@/lib/queries"
import { FOOT, Row, RowList, SheetSection } from "@/screens/stock/parts"
import { idempotencyKey } from "@itulah/contract/client"

/// One SKU in a pocket of To be returned, as Stock reads it.
export interface PocketLine {
  readonly sku_code: string
  readonly name: string
  readonly quantity: number
}

export type Pockets = Readonly<Record<ToReturnPocket, readonly PocketLine[]>>

const POCKETS: readonly {
  readonly pocket: ToReturnPocket
  readonly label: string
  readonly tone: "bad" | "warn" | "info"
}[] = [
  { pocket: "reject", label: "Reject item", tone: "bad" },
  { pocket: "over_delivery", label: "Over delivery", tone: "warn" },
  { pocket: "return_ho", label: "Return HO", tone: "info" },
]

/// **Send to HO** (owner, 23 Oct 2026): the shop dispatches itself, whenever
/// it is ready. Everything in its To be returned — Reject item, Over
/// delivery, Return HO — is listed and ticked; the shop writes who carries
/// it — courier, plate, driver — as one Trip note, and Send packs, seals and
/// dispatches.
///
/// A return is an allotment underneath (`RETURN_TO_DC`): a pick at a shop is
/// held to one, and HO's receipt counts against it. Send raises one per
/// pocket at head office (`raiseRejectReturn`) and sends it as soon as its
/// activation reaches this node; one that has not arrived in time waits
/// under Ready to send. A return already raised is listed as such. Each
/// leaves as its own koli under the same Trip note.
export function SendToHo({
  open,
  asks,
  pockets,
  onClose,
}: {
  open: boolean
  asks: readonly StoreReturnAsk[]
  pockets: Pockets
  onClose: () => void
}) {
  const client = useQueryClient()
  /// What is unticked: `ask:<allotment>` or `<pocket>:<sku>`.
  const [off, setOff] = useState<ReadonlySet<string>>(new Set())
  const [note, setNote] = useState("")
  // One key per act for as long as the sheet lives, so a retry after a
  // dropped answer finishes the send instead of repeating it.
  const keys = useRef(new Map<string, string>())
  const keyFor = (id: string) => {
    let key = keys.current.get(id)
    if (key === undefined) {
      key = idempotencyKey()
      keys.current.set(id, key)
    }
    return key
  }
  const tick = (id: string, checked: boolean) =>
    setOff((was) => {
      const next = new Set(was)
      if (checked) next.delete(id)
      else next.add(id)
      return next
    })

  const sendingAsks = asks.filter((ask) => !off.has(`ask:${ask.allotment_id}`))
  const sendingLines = (pocket: ToReturnPocket) =>
    pockets[pocket].filter((one) => !off.has(`${pocket}:${one.sku_code}`))
  const pieces =
    sendingAsks.reduce((sum, ask) => sum + ask.quantity, 0) +
    POCKETS.reduce(
      (sum, { pocket }) =>
        sum + sendingLines(pocket).reduce((s, one) => s + one.quantity, 0),
      0,
    )

  const send = useMutation({
    mutationFn: async () => {
      const trip = note.trim() === "" ? undefined : note.trim()
      const sent: string[] = []
      const waiting: string[] = []
      for (const { pocket } of POCKETS) {
        const lines = sendingLines(pocket)
        if (lines.length === 0) continue
        const raised = await raiseRejectReturn(
          pocket,
          lines.map((one) => ({ sku_code: one.sku_code, quantity: one.quantity })),
          keyFor(
            `raise:${pocket}:${lines.map((one) => `${one.sku_code}=${one.quantity}`).join(",")}`,
          ),
        )
        if (await arrives(raised.id)) {
          const done = await sendReturn(raised.id, keyFor(`ask:${raised.id}`), trip)
          sent.push(done.shipment_number)
        } else waiting.push(raised.allotment_number)
      }
      for (const ask of sendingAsks) {
        const done = await sendReturn(
          ask.allotment_id,
          keyFor(`ask:${ask.allotment_id}`),
          trip,
        )
        sent.push(done.shipment_number)
      }
      return { sent, waiting }
    },
    onSuccess: ({ sent, waiting }) => {
      if (sent.length > 0)
        toast.success(`${pcs(pieces)} on the way to HO`, {
          description: sent.join(", "),
        })
      if (waiting.length > 0)
        toast(`${waiting.join(", ")} raised`, {
          description: "It appears under Ready to send in a moment; send it from there.",
        })
      keys.current.clear()
      setOff(new Set())
      setNote("")
      onClose()
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: returnsKey() })
      void client.invalidateQueries({ queryKey: inventoryKey() })
    },
  })

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title="Send to HO"
      footer={
        <div className="flex justify-end">
          <Button
            variant="primary"
            className={`${FOOT} max-md:w-full`}
            pending={send.isPending}
            disabled={pieces === 0}
            onClick={() => send.mutate()}
          >
            {send.isPending ? "Sending…" : `Send ${pcs(pieces)}`}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-8">
        {send.isError && <Banner tone="bad">{describe(send.error)}</Banner>}

        {POCKETS.filter(({ pocket }) => pockets[pocket].length > 0).map(
          ({ pocket, label, tone }) => (
            <SheetSection
              key={pocket}
              title={<Pill tone={tone}>{label}</Pill>}
              aside={pcs(pockets[pocket].reduce((sum, one) => sum + one.quantity, 0))}
            >
              <RowList>
                {pockets[pocket].map((one) => (
                  <Row
                    key={one.sku_code}
                    title={
                      <Checkbox
                        label={<span className="normal-case">{one.name}</span>}
                        checked={!off.has(`${pocket}:${one.sku_code}`)}
                        onChange={(checked) => tick(`${pocket}:${one.sku_code}`, checked)}
                      />
                    }
                    sub={<span className="font-mono">{sku(one.sku_code)}</span>}
                    figure={pcs(one.quantity)}
                  />
                ))}
              </RowList>
            </SheetSection>
          ),
        )}

        {asks.length > 0 && (
          <SheetSection
            title="Ready to send"
            aside={pcs(asks.reduce((sum, ask) => sum + ask.quantity, 0))}
          >
            <RowList>
              {asks.flatMap((ask) =>
                ask.lines.map((line, index) => (
                  <Row
                    key={`${ask.allotment_id}:${line.sku_code}`}
                    title={
                      index === 0 ? (
                        <Checkbox
                          label={
                            <span className="normal-case">
                              {line.name ?? sku(line.sku_code)}
                            </span>
                          }
                          checked={!off.has(`ask:${ask.allotment_id}`)}
                          onChange={(checked) => tick(`ask:${ask.allotment_id}`, checked)}
                        />
                      ) : (
                        <span className="pl-7">{line.name ?? sku(line.sku_code)}</span>
                      )
                    }
                    sub={
                      <span className="font-mono">
                        {ask.allotment_number} · {sku(line.sku_code)}
                      </span>
                    }
                    figure={pcs(line.quantity)}
                  />
                )),
              )}
            </RowList>
          </SheetSection>
        )}

        <Field label="Trip">
          <Input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Courier, plate, driver"
            autoComplete="off"
          />
        </Field>
      </div>
    </Sheet>
  )
}

/// Head office's activation reaches the node over sync, usually within
/// seconds. Asked every two seconds for half a minute.
async function arrives(allotmentId: string): Promise<boolean> {
  for (let tries = 0; tries < 15; tries++) {
    const asks = await fetchReturns()
    if (asks.some((ask) => ask.allotment_id === allotmentId)) return true
    await new Promise((resolve) => setTimeout(resolve, 2_000))
  }
  return false
}
