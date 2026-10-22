import { Button } from "@/components/ui/button"
import { Pill } from "@/components/ui/pill"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { articleId, count, label as humanise, moment, sku as skuText } from "@/lib/format"
import { useGo } from "@/lib/go"
import { useHeld } from "@/screens/stock/open-record"
import { Code, FOOT } from "@/screens/stock/parts"
import {
  DIRECTION_WORD,
  causeLabel,
  causeTone,
  directionOf,
  readPlace,
  skuOf,
} from "@/screens/stock/shared"
import type { CatalogRow, MovementView } from "@itulah/contract"

/// One movement, opened over the ledger: everything the ledger holds about it.
/// The card names the places; the sheet adds the ids they stand for, the tag in
/// full, and what the movement was posted against — the three things somebody
/// reads out to head office when a number is being argued about.
///
/// The ledger is append-only, so there is nothing to edit here and the foot has
/// only the way out to the article. `row` is the one asked for; `undefined` is
/// closed, and the sheet keeps the last one while it slides away.
export function MovementSheet({
  row,
  rows,
  bySku,
  onClose,
}: {
  row: MovementView | undefined
  /// The page of the ledger in hand, to count what was posted with it.
  rows: readonly MovementView[]
  bySku: ReadonlyMap<string, CatalogRow>
  onClose: () => void
}) {
  const go = useGo()
  const held = useHeld(row)
  const sku = held === undefined ? null : skuOf(held.epc)
  const product = sku === null ? undefined : bySku.get(sku)

  return (
    <Sheet
      open={row !== undefined}
      onOpenChange={(next) => !next && onClose()}
      title={held === undefined ? "Movement" : causeLabel(held.cause)}
      badge={
        held === undefined ? undefined : (
          <Pill tone={causeTone(held.cause)}>
            {DIRECTION_WORD[directionOf(held)]}
          </Pill>
        )
      }
      caption={
        held === undefined
          ? undefined
          : `${moment(held.occurred_at)} · ${held.actor_id}`
      }
      footer={
        product === undefined ? undefined : (
          <div className="flex justify-end">
            <Button
              className={`${FOOT} max-md:w-full`}
              onClick={() => go("/catalogue", { sku: product.sku_code })}
            >
              Open in the catalogue
            </Button>
          </div>
        )
      }
    >
      {held !== undefined && (
        <MovementFacts row={held} rows={rows} product={product} sku={sku} />
      )}
    </Sheet>
  )
}

function MovementFacts({
  row,
  rows,
  product,
  sku,
}: {
  row: MovementView
  rows: readonly MovementView[]
  product: CatalogRow | undefined
  sku: string | null
}) {
  // Posted together — a sale of three garments is one group of three lines.
  const siblings = rows.filter(
    (one) =>
      one.movement_group_id === row.movement_group_id &&
      one.movement_id !== row.movement_id,
  ).length
  const from = readPlace(row.from, row.cause)
  const to = readPlace(row.to, row.cause)

  return (
    <Facts>
      <Fact term="Quantity">
        {count(row.quantity)} {row.quantity === 1 ? "pc" : "pcs"}
      </Fact>
      <Fact term="By">{row.actor_id}</Fact>
      <Fact term="Article" wide>
        {product?.name ??
          (sku === null
            ? "Not a tag this codec reads"
            : "Not in this shop's book")}
        {sku !== null && (
          <span className="block">
            <Code>
              {articleId(product?.article_code, sku)} · {skuText(sku)}
            </Code>
          </span>
        )}
      </Fact>
      <Fact term="From" wide>
        {from.name}
        {from.state !== null && ` (${from.state})`}
        <span className="block">
          <Code>{row.from}</Code>
        </span>
      </Fact>
      <Fact term="To" wide>
        {to.name}
        {to.state !== null && ` (${to.state})`}
        <span className="block">
          <Code>{row.to}</Code>
        </span>
      </Fact>
      <Fact term="Why" wide>
        {causeLabel(row.cause)}
        <span className="block">
          <Code>{row.cause}</Code>
        </span>
      </Fact>
      <Fact term="Posted against" wide>
        {row.reference_type === null ? (
          <span className="text-mute">Nothing — a movement on its own</span>
        ) : (
          <>
            {humanise(row.reference_type)}
            {row.reference_id !== null && (
              <span className="block">
                <Code>{row.reference_id}</Code>
              </span>
            )}
          </>
        )}
      </Fact>
      <Fact term="Tag" wide>
        <Code>{row.epc}</Code>
      </Fact>
      <Fact term="Movement" wide>
        <Code>{row.movement_id}</Code>
        {siblings > 0 && (
          <span className="block text-mute">
            Posted with {count(siblings)} other{siblings === 1 ? "" : "s"}
          </span>
        )}
      </Fact>
    </Facts>
  )
}
