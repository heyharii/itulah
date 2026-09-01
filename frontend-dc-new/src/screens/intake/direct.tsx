import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, Input } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { MiniTable } from "@/components/ui/rows"
import { ScanField } from "@/components/ui/scan-field"
import { Banner, Problem } from "@/components/ui/states"
import { dc } from "@/lib/api"
import { clock, money } from "@/lib/format"
import { keys } from "@/lib/queries/keys"
import { useActor } from "@/lib/session"
import { idempotencyKey } from "@itulah/contract/client"

/// Putting one tagged piece into this DC directly.
///
/// The ordinary way stock arrives is receiving and then tagging, and both of
/// those write their own movements. This is the path outside the flow — an
/// opening balance, a piece recovered from behind a rack, a bench test — and
/// it is deliberately **one EPC at a time**. A bulk form here would be a way
/// to invent stock quickly, which is exactly what the two-person receiving
/// flow exists to prevent.
///
/// It is filed under Intake because it is how goods enter, but it is in its
/// own section of the sidebar because it is not part of the day's work.
export function DirectIntake() {
  const actor = useActor()
  const client = useQueryClient()
  /// What this bench has taken in since the screen was opened. A receipt to
  /// read back, not a record — the ledger is the record, and it is one screen
  /// away under Counting.
  const [taken, setTaken] = useState<
    { epc: string; sku: string; priceMinor: number; at: string }[]
  >([])

  const intake = useMutation({
    mutationFn: (input: { epc: string; sku: string; priceMinor: number }) =>
      dc.intake({
        epc: input.epc,
        sku_code: input.sku,
        unit_price_minor: input.priceMinor,
        actor_id: actor,
        // One EPC is one garment. Applied twice it is two garments that do
        // not exist, and nothing downstream would ever notice.
        idempotency_key: idempotencyKey(),
      }),
    onSuccess: (_result, input) => {
      setTaken((rows) => [{ ...input, at: new Date().toISOString() }, ...rows])
      // A new piece changes what this node holds and adds a movement.
      void client.invalidateQueries({ queryKey: keys.pools() })
      void client.invalidateQueries({ queryKey: ["inventory", "movements"] })
    },
  })

  /// Plain state, not a form, and deliberately: nothing here is submitted.
  /// The SKU and the price are settings for a run of scans — they stay put
  /// while the tag underneath them changes — and the thing that *is* submitted
  /// is the scan field below.
  const [sku, setSku] = useState("")
  const [price, setPrice] = useState("")

  const article = sku.trim()
  const rupiah = Number(price)
  const ready = article !== "" && Number.isFinite(rupiah) && rupiah >= 0

  return (
    <PageContent>
      <PageHeader
        crumb="Intake · outside the flow"
        title="Direct intake"
        sub="One tagged piece, straight into this warehouse."
      />

      <Banner tone="warn" className="mb-[1.125rem]">
        This bypasses counting and verification. Use it for an opening balance,
        a piece recovered, or a bench test — not for a delivery. A delivery goes
        through two people on purpose.
      </Banner>

      <Card className="mb-[1.125rem] overflow-hidden">
        <CardHeader>
          <CardTitle>What is being taken in</CardTitle>
        </CardHeader>
        <div className="flex flex-wrap gap-3 border-t border-hairline px-4 py-3.5">
          <Field label="SKU" className="min-w-[12rem] flex-1">
            <Input
              className="font-mono"
              autoCapitalize="off"
              autoCorrect="off"
              value={sku}
              onChange={(event) => setSku(event.target.value)}
            />
          </Field>
          <Field
            label="Unit price"
            hint="In rupiah"
            className="min-w-[10rem] flex-1"
          >
            <Input
              inputMode="numeric"
              value={price}
              onChange={(event) => setPrice(event.target.value)}
            />
          </Field>
        </div>

        {/* The SKU and the price stay put; the EPC is what changes per piece,
            so it is the scanned field and it is the one that clears. */}
        <div className="border-t border-hairline">
          <ScanField
            placeholder="Scan the tag"
            action="Take in"
            disabled={!ready || intake.isPending}
            hint={
              ready
                ? `Each scan takes one piece of ${article} in at ${money(rupiah)}.`
                : "Name the SKU and its unit price first."
            }
            onSubmit={(epc) =>
              intake.mutate({
                epc,
                sku: article,
                priceMinor: Math.trunc(rupiah),
              })
            }
          />
          <Problem error={intake.error} className="mx-4 mb-3.5" />
        </div>
      </Card>

      {taken.length > 0 && (
        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle>Taken in at this bench</CardTitle>
            <span className="text-[0.75rem] text-mute">
              since this screen was opened
            </span>
          </CardHeader>
          <div className="px-4 pt-1 pb-3.5">
            <MiniTable head={["Tag", "SKU", "Price", "At"]}>
              {taken.map((row) => (
                <tr key={row.epc} className="border-t border-hairline">
                  <td className="py-2 pr-2 font-mono text-[0.71875rem] text-ink">
                    {row.epc}
                  </td>
                  <td className="py-2 text-right font-mono text-[0.65625rem] text-body">
                    {row.sku}
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {money(row.priceMinor)}
                  </td>
                  <td className="py-2 text-right text-mute tabular-nums">
                    {clock(row.at)}
                  </td>
                </tr>
              ))}
            </MiniTable>
          </div>
          <div className="border-t border-hairline px-4 py-2.5">
            <Button variant="quiet" onClick={() => setTaken([])}>
              Clear this list
            </Button>
          </div>
        </Card>
      )}
    </PageContent>
  )
}
