import { Button } from "@/components/ui/button"
import { Pill } from "@/components/ui/pill"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { count, moment } from "@/lib/format"
import { useGo } from "@/lib/go"
import type { PoolRow } from "@/lib/queries"
import { FOOT, Row, RowList, SheetSection } from "@/screens/stock/parts"
import { useHeld } from "@/screens/stock/open-record"
import {
  causeLabel,
  placeCodeOf,
  placeLabel,
  routeText,
  skuOf,
  useLedger,
  useRange,
} from "@/screens/stock/shared"
import type { Mover } from "@/screens/stock/mover"

/// The node's own label for a pool, unless it is one of the store's three —
/// then the word the rest of this app uses, so "Floor" here and "Shop floor"
/// in the ledger are not two places.
export function poolName(pool: PoolRow): string {
  const code = placeCodeOf(pool.id)
  return code === null ? pool.label : placeLabel(code)
}

/// One pool, opened over the list: what it holds, and what the ledger last did
/// to it — the question somebody has when a number looks wrong is "what happened
/// here lately", and this answers it without leaving the screen.
///
/// The foot has the two things to do from a pool: read its ledger, and move a
/// piece out of it.
export function PoolSheet({
  pool,
  asOf,
  onClose,
  mover,
}: {
  /// The pool asked for. `undefined` is closed.
  pool: PoolRow | undefined
  /// When the node read its balances.
  asOf: string | undefined
  onClose: () => void
  mover: Mover
}) {
  const go = useGo()
  // Kept while the sheet slides away, so closing does not blank the record
  // mid-travel.
  const record = useHeld(pool)
  const code = record === undefined ? null : placeCodeOf(record.id)

  return (
    <Sheet
      open={pool !== undefined}
      onOpenChange={(next) => !next && onClose()}
      title={record === undefined ? "Pool" : poolName(record)}
      badge={
        record !== undefined && record.missing > 0 ? (
          <Pill tone="bad">{count(record.missing)} missing</Pill>
        ) : undefined
      }
      caption={asOf === undefined ? undefined : `As of ${moment(asOf)}`}
      footer={
        record === undefined ? undefined : (
          <div className="flex items-center justify-end gap-2">
            <Button
              className={FOOT}
              onClick={() => go("/stock/movements", { q: record.id })}
            >
              Stock ledger
            </Button>
            {code !== null && (
              <Button
                variant="primary"
                className={FOOT}
                onClick={() => {
                  onClose()
                  mover.start(code)
                }}
              >
                Move stock
              </Button>
            )}
          </div>
        )
      }
    >
      {record !== undefined && <PoolBody pool={record} />}
    </Sheet>
  )
}

function PoolBody({ pool }: { pool: PoolRow }) {
  const ledger = useLedger()
  const { bySku } = useRange()
  const through = (ledger.data ?? [])
    .filter(
      (row) =>
        row.from.split(":")[0] === pool.id || row.to.split(":")[0] === pool.id,
    )
    .slice(0, 5)

  return (
    <div className="flex flex-col gap-6">
      <Facts>
        <Fact term="On hand">{count(pool.on_hand)} pcs</Fact>
        <Fact term="Allotted">{count(pool.allotted ?? 0)} pcs</Fact>
        <Fact term="Missing">{count(pool.missing)} pcs</Fact>
        <Fact term="Stock">{count(pool.stock)} pcs</Fact>
      </Facts>

      <SheetSection title="Last movements">
        {ledger.isPending ? (
          <p className="text-meta text-mute">Reading the ledger…</p>
        ) : through.length === 0 ? (
          <p className="text-meta text-mute">No recent movements.</p>
        ) : (
          <RowList>
            {through.map((row) => {
              const sku = skuOf(row.epc)
              const name = sku === null ? undefined : bySku.get(sku)?.name
              return (
                <Row
                  key={row.movement_id}
                  title={name ?? sku ?? `…${row.epc.slice(-8)}`}
                  sub={
                    <>
                      <span className="block">
                        {causeLabel(row.cause)} ·{" "}
                        {routeText(row.from, row.to, row.cause)}
                      </span>
                      <span className="block tabular-nums">
                        {moment(row.occurred_at)}
                      </span>
                    </>
                  }
                />
              )
            })}
          </RowList>
        )}
      </SheetSection>
    </div>
  )
}
