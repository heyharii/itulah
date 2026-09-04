import { useState } from "react"
import { Undo2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, RecordCard } from "@/components/ui/card"
import { Field, Input, Select } from "@/components/ui/field"
import { Pill } from "@/components/ui/pill"
import { KeyValue, TotalsLadder } from "@/components/ui/rows"
import { ScanField } from "@/components/ui/scan-field"
import { ActionBar, CardList, Screen, Section } from "@/components/ui/screen"
import { Banner, EmptyState, LoadingState } from "@/components/ui/states"
import { Tag as Code } from "@/components/ui/tag"
import { readScan } from "@/lib/epc"
import { moment } from "@/lib/format"
import { useGo } from "@/lib/go"
import {
  usePrintReceipt,
  useReceipt,
  useReturnSale,
  useVoidSale,
} from "@/lib/till"
import type { Supervisor } from "@itulah/contract"
import { money } from "@itulah/contract/money"

/// Taking it back.
///
/// Three steps, in the order the counter does them: find the sale, scan the
/// garments that came home, and hand the money back. A return is a reversal —
/// the original sale keeps its total, and every unit is scanned so the shop
/// knows WHICH shirt came back rather than merely that one did.
///
/// A supervisor signs, and the cashier stays signed in. Making the cashier log
/// out to authorise a refund is a queue watching two people type passwords.
export function Returns() {
  const [saleId, setSaleId] = useState<string | null>(null)

  return saleId === null ? (
    <FindSale onFound={setSaleId} />
  ) : (
    <ReturnAgainst saleId={saleId} onLeave={() => setSaleId(null)} />
  )
}

function FindSale({ onFound }: { onFound: (saleId: string) => void }) {
  const [typed, setTyped] = useState("")

  return (
    <Screen foot="none">
      <Section title="Which sale">
        <Card className="flex flex-col gap-4 p-4">
          <p className="text-meta text-body">
            The sale id is on the receipt. Scan its code, or type it.
          </p>
          <ScanField
            onScan={(raw) => {
              const scanned = readScan(raw)
              // A receipt code is not an EPC and not a SKU: whatever the reader
              // produced, the id is the raw text.
              const id = scanned.kind === "epc" ? scanned.epc : raw.trim()
              if (id !== "") onFound(id)
            }}
            placeholder="Scan the receipt"
          />
          <Field label="Or type the sale id">
            <Input
              value={typed}
              placeholder="018f…"
              onChange={(event) => setTyped(event.target.value)}
            />
          </Field>
          <Button
            variant="dark"
            size="lg"
            block
            disabled={typed.trim() === ""}
            onClick={() => onFound(typed.trim())}
          >
            Find it
          </Button>
        </Card>
      </Section>
    </Screen>
  )
}

function ReturnAgainst({
  saleId,
  onLeave,
}: {
  saleId: string
  onLeave: () => void
}) {
  const go = useGo()
  const receipt = useReceipt(saleId)
  const takeBack = useReturnSale()
  const voidSale = useVoidSale()
  const print = usePrintReceipt()

  /// EPC → disposition. A Map rather than a list because a unit is scanned by
  /// waving it at the reader, and the same garment waved twice is one garment.
  const [picked, setPicked] = useState<Map<string, "RESALEABLE" | "DAMAGED">>(
    new Map(),
  )
  const [method, setMethod] = useState<"CASH" | "CARD" | "QRIS" | "OTHER">(
    "CASH",
  )
  const [reason, setReason] = useState("")
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [note, setNote] = useState<string | null>(null)

  if (receipt.isPending) return <LoadingState>Finding that sale…</LoadingState>
  if (receipt.error !== null) {
    return (
      <Screen foot="none">
        <Section title="Not found">
          <Banner tone="bad">{receipt.error.message}</Banner>
          <Button className="mt-4" block onClick={onLeave}>
            Try another
          </Button>
        </Section>
      </Screen>
    )
  }

  const document = receipt.data
  const settled = takeBack.data ?? null
  const voided = voidSale.data ?? null
  const alreadyUndone =
    document?.stamp !== null && document?.stamp !== undefined

  // How many garments are in the cashier's hand.
  //
  // Not how much money: the receipt is the customer's copy and carries no EPC,
  // so this screen cannot tell which line a scanned tag belongs to. The node
  // can — it holds `sale_line` — and it refunds each unit at what that unit was
  // charged on the day. A figure guessed here would be a figure that sometimes
  // disagreed with the drawer.
  const scannedCount = picked.size

  const ready =
    picked.size > 0 &&
    reason.trim() !== "" &&
    username.trim() !== "" &&
    password !== ""

  if (settled !== null || voided !== null) {
    const undone = settled ?? voided
    return (
      <Screen foot="none">
        <Section title="Done">
          <Card className="px-4 py-3">
            <TotalsLadder
              rows={(undone?.lines ?? []).map((line) => ({
                label: line.sku_code,
                value: money(line.refund_minor, "IDR"),
              }))}
              total={{
                label: "Handed back",
                value: money(undone?.refund_minor ?? 0, "IDR"),
              }}
            />
          </Card>
          <div className="mt-4 flex flex-col gap-2.5">
            <Button
              block
              size="lg"
              onClick={() => print.mutate({ saleId, copy: true })}
              disabled={print.isPending}
            >
              {print.isPending ? "Printing…" : "Print the receipt"}
            </Button>
            {print.error !== null && (
              <Banner tone="bad">{print.error.message}</Banner>
            )}
            <Button variant="dark" size="lg" block onClick={() => go("/sell")}>
              Back to the counter
            </Button>
          </div>
        </Section>
      </Screen>
    )
  }

  return (
    <>
      <Screen foot="none">
        <Section
          title="The sale"
          action={
            alreadyUndone ? (
              <Pill tone="bad">{document?.stamp}</Pill>
            ) : (
              <button
                type="button"
                onClick={onLeave}
                className="h-11 px-1 text-meta font-medium text-body"
              >
                Another
              </button>
            )
          }
        >
          <Card className="px-4 py-1">
            <KeyValue term="Receipt">{document?.receipt_no ?? "—"}</KeyValue>
            <KeyValue term="When">{moment(document?.completed_at)}</KeyValue>
            <KeyValue term="Cashier">{document?.cashier ?? "—"}</KeyValue>
            <KeyValue term="Total">
              {money(document?.total_minor ?? 0, "IDR")}
            </KeyValue>
          </Card>
        </Section>

        {alreadyUndone ? (
          <Banner tone="warn">
            This sale has already been undone. Nothing further can be taken back
            against it.
          </Banner>
        ) : (
          <>
            <Section title="What came back">
              <Card className="p-4">
                <ScanField
                  onScan={(raw) => {
                    const scanned = readScan(raw)
                    if (scanned.kind !== "epc") {
                      setNote(
                        "That is a product code, not a tag. A return needs the garment's own tag — a barcode does not say which one came back.",
                      )
                      return
                    }
                    setNote(null)
                    setPicked((held) => {
                      const next = new Map(held)
                      if (next.has(scanned.epc)) next.delete(scanned.epc)
                      else next.set(scanned.epc, "RESALEABLE")
                      return next
                    })
                  }}
                  placeholder="Scan the garment's tag"
                />
                {note !== null && (
                  <p className="mt-2.5 text-meta text-bad-fg">{note}</p>
                )}
              </Card>

              {picked.size === 0 ? (
                <div className="mt-3">
                  <EmptyState>
                    Nothing scanned yet. Wave each garment at the reader.
                  </EmptyState>
                </div>
              ) : (
                <CardList className="mt-3">
                  {[...picked.entries()].map(([epc, disposition]) => (
                    <RecordCard key={epc} icon={<Undo2 />} id={epc.slice(-10)}>
                      <div className="flex items-center justify-between gap-3 px-3 py-3">
                        <Code>{epc}</Code>
                        <div className="flex gap-2">
                          {(["RESALEABLE", "DAMAGED"] as const).map(
                            (choice) => (
                              <Button
                                key={choice}
                                variant={
                                  disposition === choice ? "dark" : "ghost"
                                }
                                onClick={() =>
                                  setPicked((held) => {
                                    const next = new Map(held)
                                    next.set(epc, choice)
                                    return next
                                  })
                                }
                              >
                                {choice === "RESALEABLE"
                                  ? "Sellable"
                                  : "Damaged"}
                              </Button>
                            ),
                          )}
                        </div>
                      </div>
                    </RecordCard>
                  ))}
                </CardList>
              )}
              <p className="mt-2.5 text-meta text-mute">
                Each unit is refunded at what it was charged on the day, not at
                today's price. The node works that out — this screen never
                guesses it.
              </p>
            </Section>

            <Section title="The money back">
              <Card className="flex flex-col gap-4 p-4">
                <Field
                  label="How it goes back"
                  hint="A card sale refunded in cash is ordinary. What actually happened is what gets recorded."
                >
                  <Select
                    value={method}
                    onChange={(next) => setMethod(next as typeof method)}
                  >
                    <option value="CASH">Cash</option>
                    <option value="CARD">Card</option>
                    <option value="QRIS">QRIS</option>
                    <option value="OTHER">Other</option>
                  </Select>
                </Field>
                <Field label="Why">
                  <Input
                    value={reason}
                    placeholder="Ukuran tidak pas"
                    onChange={(event) => setReason(event.target.value)}
                  />
                </Field>
                <Field label="Supervisor">
                  <Input
                    autoComplete="off"
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                  />
                </Field>
                <Field label="Their password">
                  <Input
                    type="password"
                    autoComplete="off"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                </Field>
                {(takeBack.error !== null || voidSale.error !== null) && (
                  <Banner tone="bad">
                    {(takeBack.error ?? voidSale.error)?.message}
                  </Banner>
                )}
              </Card>
            </Section>
          </>
        )}
      </Screen>

      {!alreadyUndone && (
        <ActionBar>
          <div className="flex flex-col gap-2.5">
            <Button
              variant="dark"
              size="lg"
              block
              disabled={!ready || takeBack.isPending}
              onClick={() => {
                const supervisor: Supervisor = {
                  username: username.trim(),
                  password,
                }
                takeBack.mutate({
                  sale_id: saleId,
                  lines: [...picked.entries()].map(([epc, disposition]) => ({
                    epc,
                    disposition,
                  })),
                  refund_method: method,
                  refund_reference: null,
                  reason: reason.trim(),
                  supervisor,
                })
              }}
            >
              <Undo2 />
              {takeBack.isPending
                ? "Taking it back…"
                : `Refund ${scannedCount} ${scannedCount === 1 ? "item" : "items"}`}
            </Button>
            {/* Undoing the WHOLE sale is a different act from taking part of it
                back, so it is a different button. A cashier who meant to void
                and picked one unit instead leaves the shop owning a garment it
                thinks it sold. */}
            <Button
              variant="danger"
              block
              disabled={
                reason.trim() === "" ||
                username.trim() === "" ||
                password === "" ||
                voidSale.isPending
              }
              onClick={() => {
                if (
                  !window.confirm(
                    "Void the whole sale? Every garment on it comes back and the full amount is handed over.",
                  )
                ) {
                  return
                }
                voidSale.mutate({
                  saleId,
                  reason: reason.trim(),
                  supervisor: { username: username.trim(), password },
                })
              }}
            >
              {voidSale.isPending ? "Voiding…" : "Void the whole sale"}
            </Button>
          </div>
        </ActionBar>
      )}
    </>
  )
}

export { Returns as ReturnsScreen }
