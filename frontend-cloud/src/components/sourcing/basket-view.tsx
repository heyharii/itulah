import { AppShell, ScreenBody, ScreenHeader, ScreenState } from "@/components/app-shell"
import { Nav } from "@/components/nav"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useBasket, useBasketActions } from "@/lib/basket"
import { money, units } from "@/lib/money"
import { ApiError } from "@itulah/contract/client"
import { Minus, Plus, X } from "lucide-react"
import { useMemo } from "react"
import { PoSheet } from "@/components/po/po-sheet"
import { useVocabulary } from "@/lib/vocabulary"
import { Tag, Thumb } from "./columns"
import { UNCLASSIFIED, toSourcingRow, type SourcingRow } from "./rows"

interface BasketGroup {
  supplierId: string
  supplier: string
  lines: { row: SourcingRow; quantity: number }[]
}

/// The basket's contents, without a screen around them.
///
/// Split out so the same list can be a route and a sheet. A buyer adds to the
/// basket while still scanning the range, and sending them to another route to
/// look at it throws away the scroll position and the filters they got there
/// with — so the sheet is the ordinary way in, and the route remains for a
/// link somebody bookmarked or shared.
///
/// Grouped by supplier and not sorted any other way, because the grouping is
/// not decoration — a purchase order goes to exactly one supplier, so a basket
/// spanning three suppliers is three orders. Showing it as one flat list would
/// invite a buyer to expect one checkout and then explain itself at the last
/// moment.
export function BasketPanel() {
  const basket = useBasket()
  const vocabulary = useVocabulary()
  const { setQuantity, remove, clear } = useBasketActions()

  const groups = useMemo<BasketGroup[]>(() => {
    const collected = new Map<string, BasketGroup>()
    for (const line of basket.data ?? []) {
      const row = toSourcingRow({ item: line.item, supplier: line.supplier })
      const group = collected.get(row.supplierId)
      if (group === undefined) {
        collected.set(row.supplierId, {
          supplierId: row.supplierId,
          supplier: row.supplier,
          lines: [{ row, quantity: line.quantity }],
        })
      } else {
        group.lines.push({ row, quantity: line.quantity })
      }
    }
    return [...collected.values()].sort((a, b) => a.supplier.localeCompare(b.supplier))
  }, [basket.data])

  const lineCount = basket.data?.length ?? 0
  const pieceCount = (basket.data ?? []).reduce((sum, line) => sum + line.quantity, 0)

  return (
    <>
      <ScreenHeader
        eyebrow="Buying"
        title="Basket"
        subtitle={
          basket.isPending
            ? "loading…"
            : `${units(lineCount)} item${lineCount === 1 ? "" : "s"} · ${units(pieceCount)} pieces · ${groups.length} supplier${groups.length === 1 ? "" : "s"}`
        }
      >
        {lineCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            disabled={clear.isPending}
            onClick={() => clear.mutate()}
          >
            {clear.isPending ? "Emptying…" : "Empty basket"}
          </Button>
        )}
      </ScreenHeader>

      {(setQuantity.isError || remove.isError || clear.isError) && (
        <div className="text-destructive border-b px-3.5 py-2 text-[11.5px]">
          {[setQuantity.error, remove.error, clear.error].find(Boolean) instanceof ApiError
            ? ([setQuantity.error, remove.error, clear.error].find(Boolean) as ApiError).message
            : "The basket could not be changed."}
        </div>
      )}

      <ScreenBody card={false} className="flex flex-col gap-[1.125rem]">
        {basket.isPending ? (
          <ScreenState>Loading your basket…</ScreenState>
        ) : basket.isError ? (
          <ScreenState
            tone="problem"
            action={
              <Button size="sm" variant="outline" onClick={() => void basket.refetch()}>
                Try again
              </Button>
            }
          >
            {basket.error instanceof ApiError
              ? basket.error.message
              : "Your basket could not be loaded."}
          </ScreenState>
        ) : lineCount === 0 ? (
          <ScreenState>
            Your basket is empty. Open something in Sourcing and add it here first — an
            order is always raised from the basket.
          </ScreenState>
        ) : (
          groups.map((group) => {
            const currencies = new Set(group.lines.map((line) => line.row.currency))
            const currency = currencies.size === 1 ? [...currencies][0] : null
            const total = group.lines.reduce(
              (sum, line) => sum + line.row.price * line.quantity,
              0,
            )
            return (
              <section key={group.supplierId} className="os-card overflow-hidden">
                <div className="flex h-12 items-center gap-3 border-b border-[var(--os-hairline,#eeeef1)] bg-[var(--os-soft,#f7f7f8)] px-3.5">
                  <span className="truncate text-[0.875rem] font-semibold">{group.supplier}</span>
                  <span className="shrink-0 font-[var(--os-mono,ui-monospace)] text-[0.6875rem] text-[var(--os-mute,#a6a6ad)]">
                    {units(group.lines.length)} item{group.lines.length === 1 ? "" : "s"}
                    {currency !== null && ` · ${money(total, currency)}`}
                  </span>
                  {/* Opens over the basket rather than navigating away: the
                      buyer is mid-errand, and one order per supplier means
                      they will very likely raise the next one from this same
                      list a moment later. */}
                  <PoSheet supplierId={group.supplierId}>
                    <Button size="sm" className="ml-auto h-7">
                      Draft PO
                    </Button>
                  </PoSheet>
                </div>

                <ul>
                  {group.lines.map(({ row, quantity }) => (
                    <li
                      key={row.id}
                      className="flex items-center gap-3 border-b px-3.5 py-2.5 last:border-b-0"
                    >
                      <Thumb row={row} className="size-14 rounded-md" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-medium">{row.name}</div>
                        {/* What each thing is, on every line and in words. A
                            basket is where a buyer checks they picked the right
                            garment, and "0293433029" does not help them do
                            that. The code stays available in the item itself. */}
                        <div className="flex flex-wrap items-center gap-1 pt-1">
                          {row.division !== UNCLASSIFIED && (
                            <span className="inline-flex h-5 shrink-0 items-center rounded-full bg-[var(--os-accent-bg,#ebedfd)] px-1.5 text-[11px] font-medium whitespace-nowrap text-[var(--os-accent,#3c52f0)]">
                              {vocabulary.division(row.division)}
                            </span>
                          )}
                          {row.tags.map((tag) => (
                            <Tag key={tag}>{vocabulary.tag(tag)}</Tag>
                          ))}
                        </div>
                      </div>
                      <div className="text-muted-foreground w-24 shrink-0 text-right font-mono text-xs tabular-nums">
                        {money(row.price, row.currency)}
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          size="icon-xs"
                          variant="outline"
                          aria-label={`One fewer ${row.name}`}
                          disabled={setQuantity.isPending}
                          onClick={() =>
                            setQuantity.mutate({
                              supplierItemId: row.id,
                              // One fewer than one is a removal, and the server
                              // reads zero that way — so the minus button empties
                              // the line rather than refusing at one.
                              quantity: quantity - 1,
                            })
                          }
                        >
                          <Minus className="size-3" />
                        </Button>
                        <Input
                          value={quantity}
                          inputMode="numeric"
                          aria-label={`Quantity of ${row.name}`}
                          onChange={(event) => {
                            const parsed = Number.parseInt(event.target.value, 10)
                            if (!Number.isFinite(parsed) || parsed < 1) return
                            setQuantity.mutate({ supplierItemId: row.id, quantity: parsed })
                          }}
                          className="h-7 w-14 text-center font-mono text-xs"
                        />
                        <Button
                          size="icon-xs"
                          variant="outline"
                          aria-label={`One more ${row.name}`}
                          disabled={setQuantity.isPending}
                          onClick={() =>
                            setQuantity.mutate({
                              supplierItemId: row.id,
                              quantity: quantity + 1,
                            })
                          }
                        >
                          <Plus className="size-3" />
                        </Button>
                      </div>
                      <div className="w-28 shrink-0 text-right font-mono text-[13px] font-medium tabular-nums">
                        {money(row.price * quantity, row.currency)}
                      </div>
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        aria-label={`Remove ${row.name}`}
                        disabled={remove.isPending}
                        onClick={() => remove.mutate(row.id)}
                      >
                        <X className="size-3.5" />
                      </Button>
                    </li>
                  ))}
                </ul>
              </section>
            )
          })
        )}
      </ScreenBody>
    </>
  )
}

/// The basket as its own screen, for a bookmarked or shared link.
export function BasketView() {
  return (
    <AppShell data-cloudhub nav={<Nav />}>
      <BasketPanel />
    </AppShell>
  )
}
