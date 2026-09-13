import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { PackageCheck, PackagePlus } from "lucide-react"
import { useMemo, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { RecordCard } from "@/components/ui/card"
import { Field, Input } from "@/components/ui/field"
import { Pill } from "@/components/ui/pill"
import { KeyValue } from "@/components/ui/rows"
import { CardList, FloatingBar, Screen, Section } from "@/components/ui/screen"
import { ScanField } from "@/components/ui/scan-field"
import { Banner, EmptyState } from "@/components/ui/states"
import { Tag as Code } from "@/components/ui/tag"
import { node } from "@/lib/api"
import { describe } from "@/lib/errors"
import { readScan } from "@/lib/epc"
import { moment } from "@/lib/format"
import { catalogueKey, fetchCatalogue, inventoryKey } from "@/lib/queries"
import { useIdentity } from "@/lib/session"
import type { CatalogRow, ReceiveRequest } from "@itulah/contract"
import { idempotencyKey } from "@itulah/contract/client"
import { money } from "@itulah/contract/money"

/// Taking a delivery in.
///
/// One tag at a time, which is the wire (`ReceiveRequest` carries a single
/// `epc`) and is also the work: somebody is holding a garment and a reader. The
/// SKU comes off the tag and the price out of the shop's own book, so the two
/// fields a person would otherwise type are filled in before they look at them
/// — and both stay editable, because a delivery that arrives with a price
/// nobody published is exactly when this screen has to still work.
///
/// The unit lands in `<site>.warehouse`. Getting it onto the shop floor is the
/// Stock screen's move, and that separation is the node's, not this app's.
export function Receive() {
  const client = useQueryClient()
  const identity = useIdentity()
  const [scanned, setScanned] = useState<{
    epc: string
    sku_code: string
  } | null>(null)
  const [price, setPrice] = useState("")
  const [source, setSource] = useState("")
  const [shipment, setShipment] = useState("")
  const [note, setNote] = useState<string | null>(null)
  const [taken, setTaken] = useState<
    readonly { epc: string; sku_code: string; name: string; at: string }[]
  >([])

  /// One key per unit, minted when the tag is scanned and held until that unit
  /// is either taken in or dropped. A double tap on the button — the ordinary
  /// failure on a touch screen — then lands once, and a retry after a dropped
  /// connection lands on the same row rather than creating a second garment out
  /// of one.
  const key = useRef<string>(idempotencyKey())

  const catalogue = useQuery({
    queryKey: catalogueKey(),
    queryFn: ({ signal }) => fetchCatalogue(signal),
  })
  const bySku = useMemo(() => {
    const index = new Map<string, CatalogRow>()
    for (const row of catalogue.data?.items ?? []) index.set(row.sku_code, row)
    return index
  }, [catalogue.data])

  const product = scanned === null ? undefined : bySku.get(scanned.sku_code)
  const currency = catalogue.data?.currency ?? "IDR"

  const receive = useMutation({
    mutationFn: (request: ReceiveRequest) =>
      node.post<unknown>("/api/v1/store/receive", request, {
        headers: { "Idempotency-Key": request.idempotency_key },
      }),
    onSuccess: (_answer, request) => {
      setTaken((current) => [
        {
          epc: request.epc,
          sku_code: request.sku_code,
          name: bySku.get(request.sku_code)?.name ?? request.sku_code,
          at: new Date().toISOString(),
        },
        ...current,
      ])
      // A unit that has just entered the warehouse changes the balances AND
      // the ledger — the whole `inventory` namespace, genuinely, which is why
      // this is a prefix. The catalogue and the day's takings did not move, and
      // are deliberately left alone.
      void client.invalidateQueries({ queryKey: inventoryKey() })
      setScanned(null)
      setPrice("")
      setNote(null)
      key.current = idempotencyKey()
    },
  })

  function onScan(raw: string) {
    const read = readScan(raw)
    if (read.kind !== "epc") {
      setNote(
        "Receiving needs the garment's own tag — a barcode names the product, not the piece in your hand.",
      )
      return
    }
    setNote(null)
    setScanned({ epc: read.epc, sku_code: read.sku_code })
    setPrice(String(bySku.get(read.sku_code)?.unit_price_minor ?? ""))
    key.current = idempotencyKey()
  }

  const priceMinor = Number(price)
  const priceIsGood =
    price.trim() !== "" && Number.isInteger(priceMinor) && priceMinor >= 0
  const ready = scanned !== null && priceIsGood

  return (
    <>
      <Screen foot={scanned === null ? "tabs" : "both"}>
        <div className="pt-1 pb-4">
          <ScanField
            onScan={onScan}
            placeholder="Scan the tag on the garment…"
          />
        </div>

        {note !== null && (
          <Banner tone="warn" className="mb-4">
            {note}
          </Banner>
        )}

        {receive.error !== null && (
          <Banner tone="bad" className="mb-4">
            {describe(receive.error)}
          </Banner>
        )}

        {scanned !== null && (
          <Section title="Taking in">
            <RecordCard
              icon={<PackagePlus />}
              id={product?.name ?? scanned.sku_code}
              status={
                product === undefined ? (
                  <Pill tone="warn">Not in the book</Pill>
                ) : (
                  <Pill tone="ok">Priced</Pill>
                )
              }
            >
              <div className="px-3 pt-1 pb-3">
                <KeyValue term="Tag">
                  <span className="font-mono text-id">{scanned.epc}</span>
                </KeyValue>
                <KeyValue term="SKU">
                  <Code>{scanned.sku_code}</Code>
                </KeyValue>
                <KeyValue term="Lands in">The shop's warehouse</KeyValue>
              </div>
            </RecordCard>

            <div className="mt-3 flex flex-col gap-3">
              <Field
                label="Unit price"
                hint={
                  product === undefined
                    ? "This SKU is not in the published book, so nothing filled it in. What the piece cost, in whole currency units."
                    : `From this shop's book: ${money(product.unit_price_minor, currency)}.`
                }
                problem={
                  price.trim() !== "" && !priceIsGood
                    ? "A whole number of currency units, and never negative."
                    : undefined
                }
              >
                <Input
                  value={price}
                  onChange={(event) =>
                    setPrice(event.target.value.replace(/[^\d]/g, ""))
                  }
                  inputMode="numeric"
                  invalid={price.trim() !== "" && !priceIsGood}
                  placeholder="0"
                />
              </Field>
              <Field
                label="From which DC"
                hint="Optional. Leave it empty for stock that did not come from one."
              >
                <Input
                  value={source}
                  onChange={(event) => setSource(event.target.value)}
                  placeholder="e.g. dc-01"
                  autoCapitalize="none"
                  autoCorrect="off"
                />
              </Field>
              <Field
                label="Delivery note"
                hint="Optional. The surat jalan number."
              >
                <Input
                  value={shipment}
                  onChange={(event) => setShipment(event.target.value)}
                  placeholder="e.g. SJ-2026-0418"
                  autoCapitalize="characters"
                  autoCorrect="off"
                />
              </Field>
            </div>
          </Section>
        )}

        <Section title={taken.length === 0 ? undefined : "Taken in just now"}>
          {taken.length === 0 ? (
            scanned === null && (
              <EmptyState>
                {catalogue.isPending
                  ? "Reading this shop's price book…"
                  : "Scan a tag to take a garment into this shop's warehouse."}
              </EmptyState>
            )
          ) : (
            <CardList>
              {taken.map((one) => (
                <RecordCard
                  key={one.epc}
                  icon={<PackageCheck />}
                  id={one.name}
                  status={<Pill tone="ok">In the warehouse</Pill>}
                >
                  <div className="flex items-center justify-between gap-3 px-3 py-2.5">
                    <Code>{one.sku_code}</Code>
                    <span className="text-meta text-mute">
                      {moment(one.at)}
                    </span>
                  </div>
                </RecordCard>
              ))}
            </CardList>
          )}
        </Section>
      </Screen>

      {scanned !== null && (
        <FloatingBar>
          <div className="flex gap-2.5 p-3">
            <Button
              size="lg"
              onClick={() => {
                setScanned(null)
                setPrice("")
                setNote(null)
              }}
            >
              Drop
            </Button>
            <Button
              variant="primary"
              size="lg"
              block
              disabled={!ready || receive.isPending}
              onClick={() =>
                receive.mutate({
                  epc: scanned.epc,
                  sku_code: scanned.sku_code,
                  unit_price_minor: priceMinor,
                  source_dc_id: source.trim() === "" ? null : source.trim(),
                  shipment_reference:
                    shipment.trim() === "" ? null : shipment.trim(),
                  actor_id: identity.data?.username ?? "",
                  idempotency_key: key.current,
                })
              }
            >
              {receive.isPending ? "Taking it in…" : "Take it in"}
            </Button>
          </div>
        </FloatingBar>
      )}
    </>
  )
}
