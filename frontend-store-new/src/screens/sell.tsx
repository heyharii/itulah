import { useQuery } from "@tanstack/react-query"
import { AlertTriangle, ScanBarcode, Tag, Trash2, Upload } from "lucide-react"
import { useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { CardStrip, RecordCard } from "@/components/ui/card"
import { Pill } from "@/components/ui/pill"
import { MiniRow, MiniTable } from "@/components/ui/rows"
import { ScanField } from "@/components/ui/scan-field"
import { CardList, FloatingBar, Screen, Section } from "@/components/ui/screen"
import { Banner, EmptyState } from "@/components/ui/states"
import { Tag as Code } from "@/components/ui/tag"
import {
  addToBasket,
  clearBasket,
  groupBasket,
  quoteBasket,
  removeFromBasket,
  useBasket,
} from "@/lib/basket"
import { readScan } from "@/lib/epc"
import { useGo } from "@/lib/go"
import { catalogueKey, fetchCatalogue } from "@/lib/queries"
import { unsentCount, useSaleQueue } from "@/lib/sale-queue"
import type { CatalogRow } from "@itulah/contract"
import { money } from "@itulah/contract/money"

/// The counter.
///
/// One field, one list, one number, one black button. Everything a cashier does
/// on this screen is: wave a tag at the reader, look at the total, take the
/// money. The list is a stack of record cards and never a table — a till is
/// thumbs and glances, and six columns is neither.
export function Sell() {
  const go = useGo()
  const basket = useBasket()
  const queue = useSaleQueue()
  const unsent = unsentCount(queue)
  const [note, setNote] = useState<{ tone: "bad" | "ok"; text: string } | null>(
    null,
  )
  /// What the price check is showing, and why.
  ///
  /// A counter answers "how much is this" all day, and not always with a
  /// readable label in its hand: a tag has come off, a customer is describing
  /// the shirt on the rail. So a scan that is not a code at all falls through
  /// to a search of the resident book — which works with the line down, because
  /// the book is already here.
  const [lookup, setLookup] = useState<{
    readonly matches: readonly CatalogRow[]
    readonly total: number
    readonly needle: string | null
  } | null>(null)

  /// The shop's own price book, read once and held.
  ///
  /// This is the read that makes the till work offline: the whole book is
  /// cached, so a basket can be priced, a product looked up and a receipt
  /// written with nothing reachable. It is a Query with a long `staleTime`
  /// rather than a fetch on scan, because a fetch on scan is a till that stops
  /// pricing the moment the wifi does.
  const catalogue = useQuery({
    queryKey: catalogueKey(),
    queryFn: ({ signal }) => fetchCatalogue(signal),
  })

  const bySku = useMemo(() => {
    const index = new Map<string, CatalogRow>()
    for (const row of catalogue.data?.items ?? []) index.set(row.sku_code, row)
    return index
  }, [catalogue.data])

  const byBarcode = useMemo(() => {
    const index = new Map<string, CatalogRow>()
    for (const row of catalogue.data?.items ?? []) {
      if (row.barcode !== null) index.set(row.barcode, row)
    }
    return index
  }, [catalogue.data])

  const book = catalogue.data
  const groups = groupBasket(basket.lines)
  const quote = quoteBasket(basket.lines)

  function onScan(raw: string) {
    setLookup(null)
    const scanned = readScan(raw)

    if (scanned.kind === "epc") {
      const outcome = addToBasket(
        scanned.epc,
        bySku.get(scanned.sku_code),
        scanned.sku_code,
      )
      setNote(
        outcome.ok
          ? null
          : {
              tone: "bad",
              text: "That tag is already in this basket. One tag is one garment.",
            },
      )
      return
    }

    // A barcode or a QR names a *product*, not a unit. The shop has forty of
    // that shirt and this says nothing about which one, so it cannot go in a
    // basket — but it is exactly the right answer to "how much is this", which
    // is the other question asked at a counter all day.
    if (scanned.kind === "sku") {
      const product = bySku.get(scanned.sku_code)
      setLookup(
        product === undefined
          ? null
          : { matches: [product], total: 1, needle: null },
      )
      setNote(
        product === undefined
          ? {
              tone: "bad",
              text: `${scanned.sku_code} is not in this shop's price book.`,
            }
          : null,
      )
      return
    }

    const barcoded = byBarcode.get(raw.trim())
    if (barcoded !== undefined) {
      setLookup({ matches: [barcoded], total: 1, needle: null })
      setNote(null)
      return
    }

    // Not a code — so it is a name, or part of one. Searched against the book
    // this device already holds rather than against the node: a price check
    // that needs the network is a price check that stops working on the
    // afternoon somebody most needs it.
    const needle = raw.trim().toLowerCase()
    const found = (book?.items ?? []).filter(
      (row) =>
        row.name.toLowerCase().includes(needle) ||
        row.sku_code.includes(needle) ||
        (row.barcode !== null && row.barcode.includes(needle)),
    )
    if (found.length > 0) {
      // Capped, and the cap is said out loud below rather than left to be
      // inferred from a length: a list that stops at ten and a shop that
      // stocks exactly ten of these look identical, and only one of them
      // means "keep typing".
      setLookup({ matches: found.slice(0, 10), total: found.length, needle })
      setNote(null)
      return
    }
    setNote({
      tone: "bad",
      text: `Nothing here matches “${raw.trim()}”. Scan the garment's own tag, or type part of its name.`,
    })
  }

  return (
    <>
      <Screen foot={basket.lines.length > 0 ? "both" : "tabs"}>
        <div className="pt-1 pb-4">
          <ScanField
            onScan={onScan}
            placeholder="Scan a tag, or type a name…"
          />
        </div>

        {book !== undefined && !book.has_price_book && (
          <Banner tone="bad" className="mb-4">
            This shop has never received a price book. Nothing here can be
            priced or sold until one arrives from head office.
          </Banner>
        )}

        {note !== null && (
          <Banner
            tone={note.tone}
            className="mb-4"
            action={
              <button
                type="button"
                onClick={() => setNote(null)}
                className="shrink-0 underline underline-offset-2"
              >
                Dismiss
              </button>
            }
          >
            {note.text}
          </Banner>
        )}

        {unsent > 0 && (
          <Banner
            tone="warn"
            className="mb-4"
            action={
              <button
                type="button"
                onClick={() => go("/sell/queue")}
                className="shrink-0 underline underline-offset-2"
              >
                Open
              </button>
            }
          >
            {unsent === 1
              ? "1 sale is saved here and has not reached head office yet."
              : `${unsent} sales are saved here and have not reached head office yet.`}
          </Banner>
        )}

        {/* A price check — never a basket line. These came from a barcode or a
            name, both of which identify a *product*: the shop has forty of that
            shirt and neither says which one is in the customer's hand. */}
        {lookup !== null && (
          <Section
            title="Price check"
            action={
              <button
                type="button"
                onClick={() => setLookup(null)}
                className="h-11 px-1 text-meta font-medium text-body"
              >
                Clear
              </button>
            }
          >
            <CardList>
              {lookup.matches.map((row) => (
                <RecordCard
                  key={row.sku_code}
                  icon={<Tag />}
                  id={row.name}
                  status={
                    row.unit_price_minor < row.base_unit_price_minor ? (
                      <Pill tone="warn">Markdown</Pill>
                    ) : undefined
                  }
                >
                  <div className="flex items-end justify-between gap-3 px-3 py-3">
                    <Code>{row.sku_code}</Code>
                    <div className="text-right">
                      {row.unit_price_minor < row.base_unit_price_minor && (
                        <div className="text-meta text-mute tabular-nums line-through">
                          {money(row.base_unit_price_minor, row.currency)}
                        </div>
                      )}
                      <div className="text-metric font-semibold text-ink tabular-nums">
                        {money(row.unit_price_minor, row.currency)}
                      </div>
                    </div>
                  </div>
                </RecordCard>
              ))}
            </CardList>
            {lookup.total > lookup.matches.length && (
              <p className="mt-2.5 text-meta text-mute">
                {lookup.total} products match “{lookup.needle}”. The closest{" "}
                {lookup.matches.length} are above — type more of the name to
                narrow it.
              </p>
            )}
          </Section>
        )}

        {basket.lines.length === 0 ? (
          <EmptyState
            action={
              unsent > 0 ? (
                <Button onClick={() => go("/sell/queue")}>
                  <Upload />
                  {unsent} waiting to send
                </Button>
              ) : undefined
            }
          >
            {catalogue.isPending
              ? "Reading this shop's price book…"
              : "Nothing on the counter yet. Scan a tag to start a sale."}
          </EmptyState>
        ) : (
          <Section
            title={`${quote.units} ${quote.units === 1 ? "item" : "items"}`}
            action={
              <button
                type="button"
                onClick={clearBasket}
                className="h-11 px-1 text-meta font-medium text-body"
              >
                Clear basket
              </button>
            }
          >
            <CardList>
              {groups.map((group) => (
                <RecordCard
                  key={group.sku_code}
                  icon={<ScanBarcode />}
                  id={group.name ?? group.sku_code}
                  status={
                    group.unit_price_minor === null ? (
                      <Pill tone="bad">Unpriced</Pill>
                    ) : group.base_unit_price_minor !== null &&
                      group.base_unit_price_minor > group.unit_price_minor ? (
                      <Pill tone="warn">Markdown</Pill>
                    ) : undefined
                  }
                >
                  {/* The middle columns are gone and identity + outcome stay —
                      DESIGN.md drops columns middle-first, and for a basket
                      that means no unit price on a phone. */}
                  <MiniTable head={["Item", "Qty", "Line total"]}>
                    <MiniRow>
                      <td>
                        <span className="font-mono text-id text-body">
                          {group.sku_code}
                        </span>
                      </td>
                      <td className="tabular-nums">{group.quantity}</td>
                      <td className="font-medium tabular-nums">
                        {group.line_total_minor === null
                          ? "—"
                          : money(
                              group.line_total_minor,
                              book?.currency ?? "IDR",
                            )}
                      </td>
                    </MiniRow>
                  </MiniTable>
                  <div className="flex flex-wrap gap-1.5 border-t border-hairline px-3 py-2">
                    {group.lines.map((line) => (
                      <button
                        key={line.epc}
                        type="button"
                        onClick={() => removeFromBasket(line.epc)}
                        aria-label={`Take one ${group.name ?? group.sku_code} off the sale`}
                        className="pressable flex h-11 items-center gap-2 rounded-full bg-soft-2 px-3 font-mono text-id text-body"
                      >
                        <Trash2 className="size-4 text-line-ico" />
                        {line.epc.slice(-6)}
                      </button>
                    ))}
                  </div>
                </RecordCard>
              ))}
            </CardList>

            {quote.incomplete && (
              <Banner tone="warn" className="mt-3">
                <AlertTriangle className="mt-px inline size-4" /> Some of these
                have no published price, so the figure below is a floor. The
                counter will price them when the sale is rung.
              </Banner>
            )}
          </Section>
        )}
      </Screen>

      {basket.lines.length > 0 && (
        <FloatingBar>
          <CardStrip className="justify-between">
            <span className="text-meta text-mute">
              {quote.incomplete ? "At least" : "Basket"}
            </span>
            <span className="text-metric font-semibold text-ink tabular-nums">
              {money(quote.totalMinor, book?.currency ?? "IDR")}
            </span>
          </CardStrip>
          <div className="px-3 py-3">
            {quote.savedMinor > 0 && (
              <p className="mb-2.5 text-center text-meta text-ok-fg tabular-nums">
                Markdowns take off{" "}
                {money(quote.savedMinor, book?.currency ?? "IDR")}
              </p>
            )}
            <Button
              variant="dark"
              size="lg"
              block
              onClick={() => go("/sell/tender")}
            >
              Take payment
            </Button>
          </div>
        </FloatingBar>
      )}
    </>
  )
}
