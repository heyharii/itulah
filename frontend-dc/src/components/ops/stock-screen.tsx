import { useState } from "react"

import { Panel, Problem, Row, RowNumber, RowText } from "@/components/ops/parts"
import {
  Note,
  Pill,
  ScreenBody,
  ScreenHeader,
  ScreenState,
} from "@/components/shell"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useAction } from "@/lib/action"
import { dc, poolsAnswer, type PoolRow } from "@/lib/api"
import { clock, shortId, units } from "@/lib/format"
import { keys } from "@/lib/queries"
import { useActor } from "@/lib/session"
import { idempotencyKey } from "@itulah/contract/client"
import type { MovementCause } from "@itulah/contract"
import { useQuery, useQueryClient } from "@tanstack/react-query"

/// The groups the node sorts its pools into, in the order goods pass through
/// them. Taken from `edge_pool_metadata` in `edge/http.rs` rather than
/// invented here.
const GROUPS: Record<string, string> = {
  PENDING: "Not yet stock",
  WAREHOUSE: "On the racks",
  OUTBOUND: "On the way out",
  REJECT: "Rejected",
}

/// The causes a warehouse can write by hand. The full list is wider — sales,
/// tagging, counts — but those are written by the operation that caused them,
/// and offering them here would let somebody file a sale that never happened.
const CAUSES: MovementCause[] = [
  "NORMAL_MOVE",
  "PLACEMENT_CORRECTION",
  "RETURN_TO_DC",
  "FOUND",
]

/// Where the stock is, and what happened to it.
///
/// Two halves that answer different questions. The pools are the state — what
/// this DC holds right now, in the places it holds it. The ledger is the
/// history, and it is append-only: a mistake is corrected by another movement
/// that says what it corrects, never by editing the one before it.
export function StockScreen() {
  const answer = useQuery({
    queryKey: keys.pools(),
    queryFn: ({ signal }) => poolsAnswer(signal),
  })

  const items = answer.data?.items ?? []
  // The rollups double-count the leaves under them, so the headline adds up
  // the leaves only.
  const leaves = items.filter((pool) => pool.is_rollup === false)
  const held = leaves.reduce((total, pool) => total + pool.stock, 0)
  const missing = leaves.reduce((total, pool) => total + pool.missing, 0)

  return (
    <>
      <ScreenHeader
        title="Stock"
        subtitle={
          answer.data === undefined
            ? "Reading this node's pools…"
            : `${units(held)} pieces in ${leaves.length} pools · as of ${clock(answer.data.as_of)}`
        }
      />
      <ScreenBody className="lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:items-start">
        <div className="flex flex-col gap-4">
          <Pools
            items={items}
            loading={answer.isPending}
            error={answer.isError ? answer.error : null}
          />
          {answer.data !== undefined && (
            <Note>
              <strong className="font-medium text-foreground">
                {answer.data.inventory_equation}
              </strong>{" "}
              {answer.data.aggregation_policy}. The five outbound totals are
              sums of the destination pools beneath them and are marked as such
              — adding both would report this warehouse twice.
              {missing > 0 &&
                ` ${units(missing)} pieces are missing: known to exist, not found where they should be.`}
            </Note>
          )}
          <Ledger />
        </div>

        <div className="flex flex-col gap-4">
          <Intake />
          <Correction pools={leaves} />
          <Note>
            Nothing here edits a number. Both write a movement, and the ledger
            is the only record either of them leaves — which is why a correction
            has to say what it is correcting.
          </Note>
        </div>
      </ScreenBody>
    </>
  )
}

function Pools({
  items,
  loading,
  error,
}: {
  items: readonly PoolRow[]
  loading: boolean
  error: unknown
}) {
  const groups = Object.keys(GROUPS).filter((group) =>
    items.some((pool) => pool.group === group)
  )

  return (
    <Panel title="Pools" meta={`${items.length} rows`}>
      {loading && <ScreenState>Reading this node's pools…</ScreenState>}
      {error !== null && (
        <ScreenState tone="problem">{(error as Error).message}</ScreenState>
      )}
      {!loading && items.length === 0 && (
        <ScreenState>This node owns no pools yet.</ScreenState>
      )}

      {groups.map((group) => (
        <div key={group}>
          <p className="bg-muted/40 px-4 py-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            {GROUPS[group]}
          </p>
          {items
            .filter((pool) => pool.group === group)
            .map((pool) => (
              <Row key={pool.id}>
                <RowText code={pool.label}>
                  {pool.is_rollup ? "sum of the pools below" : pool.id}
                </RowText>
                {pool.is_rollup && <Pill>total</Pill>}
                <RowNumber
                  value={units(pool.stock)}
                  label="stock"
                  tone={pool.is_rollup ? "muted" : undefined}
                />
                {pool.missing > 0 && (
                  <RowNumber
                    value={units(pool.missing)}
                    label="missing"
                    tone="bad"
                  />
                )}
              </Row>
            ))}
        </div>
      ))}
    </Panel>
  )
}

function Ledger() {
  const [limit, setLimit] = useState(50)

  const movements = useQuery({
    queryKey: [...keys.movements(), limit],
    queryFn: ({ signal }) => dc.movements(limit, signal),
  })

  return (
    <Panel title="Ledger" meta={`${movements.data?.length ?? 0} newest`}>
      {movements.isPending && <ScreenState>Reading the ledger…</ScreenState>}
      {movements.data?.length === 0 && (
        <ScreenState>
          Nothing has moved on this node yet. Every operation writes here — this
          is the only record any of them leaves.
        </ScreenState>
      )}
      {movements.data?.map((movement) => (
        <Row key={movement.movement_id}>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-mono text-[12.5px]">
              {movement.from} → {movement.to}
            </span>
            <span className="block truncate text-[11px] text-muted-foreground">
              {movement.cause.toLowerCase().replace(/_/g, " ")} ·{" "}
              {movement.actor_id} · {clock(movement.occurred_at)}
              {movement.reference_id === null
                ? ""
                : ` · ${movement.reference_type ?? "ref"} ${shortId(movement.reference_id)}`}
            </span>
          </span>
          <RowNumber value={units(movement.quantity)} label="pieces" />
        </Row>
      ))}
      {(movements.data?.length ?? 0) >= limit && (
        <div className="border-t px-4 py-3">
          <Button
            variant="ghost"
            className="h-(--tap) w-full"
            onClick={() => setLimit((current) => Math.min(current + 100, 500))}
          >
            Show more
          </Button>
        </div>
      )}
    </Panel>
  )
}

/// Putting one tagged piece into this DC directly.
function Intake() {
  const actor = useActor()
  const client = useQueryClient()
  const action = useAction()
  const [epc, setEpc] = useState("")
  const [sku, setSku] = useState("")
  const [price, setPrice] = useState("")

  const put = () =>
    void action.run(async () => {
      await dc.intake({
        epc: epc.trim().toUpperCase(),
        sku_code: sku.trim(),
        unit_price_minor: Number(price),
        actor_id: actor,
        idempotency_key: idempotencyKey(),
      })
      setEpc("")
      setSku("")
      setPrice("")
      void client.invalidateQueries({ queryKey: ["dc"] })
      void client.invalidateQueries({ queryKey: keys.pools() })
    })

  const ready =
    epc.trim() !== "" && sku.trim() !== "" && Number.isFinite(Number(price))

  return (
    <Panel title="Intake" meta="one piece">
      <div className="flex flex-col gap-2 px-4 py-3">
        <Input
          value={epc}
          placeholder="EPC"
          autoCapitalize="characters"
          spellCheck={false}
          className="h-(--tap) font-mono"
          onChange={(event) => setEpc(event.target.value)}
        />
        <div className="flex gap-2">
          <Input
            value={sku}
            placeholder="SKU"
            className="h-(--tap) flex-1 font-mono"
            onChange={(event) => setSku(event.target.value)}
          />
          <Input
            value={price}
            inputMode="numeric"
            placeholder="Cost (rupiah)"
            className="h-(--tap) flex-1 font-mono"
            onChange={(event) => setPrice(event.target.value)}
          />
        </div>
        <Button
          variant="secondary"
          className="h-(--tap)"
          disabled={action.pending || !ready}
          onClick={put}
        >
          Take it in
        </Button>
        <p className="text-[11px] text-muted-foreground">
          The ordinary way stock arrives is receiving and then tagging, and both
          write their own movements. This is the direct path — an opening
          balance, a piece recovered — one tag at a time.
        </p>
        <Problem error={action.error} />
      </div>
    </Panel>
  )
}

/// A movement written by hand, between two pools this node owns.
function Correction({ pools }: { pools: readonly PoolRow[] }) {
  const actor = useActor()
  const client = useQueryClient()
  const action = useAction()
  const [epc, setEpc] = useState("")
  const [quantity, setQuantity] = useState("1")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [cause, setCause] = useState<MovementCause>("NORMAL_MOVE")
  const [reason, setReason] = useState("")

  const move = () =>
    void action.run(async () => {
      await dc.move({
        epc: epc.trim().toUpperCase(),
        quantity: Number(quantity),
        from,
        to,
        cause,
        reason: reason.trim(),
        actor_id: actor,
        idempotency_key: idempotencyKey(),
        reference_type: null,
        reference_id: null,
      })
      setEpc("")
      setReason("")
      void client.invalidateQueries({ queryKey: keys.pools() })
      void client.invalidateQueries({ queryKey: keys.movements() })
    })

  const ready =
    epc.trim() !== "" &&
    from !== "" &&
    to !== "" &&
    from !== to &&
    reason.trim() !== "" &&
    Number(quantity) > 0

  return (
    <Panel title="Move stock" meta="writes a movement">
      {pools.length === 0 ? (
        <ScreenState>No pools to move between yet.</ScreenState>
      ) : (
        <div className="flex flex-col gap-2 px-4 py-3">
          <Input
            value={epc}
            placeholder="EPC"
            autoCapitalize="characters"
            spellCheck={false}
            className="h-(--tap) font-mono"
            onChange={(event) => setEpc(event.target.value)}
          />
          <div className="flex gap-2">
            <PoolPicker
              label="From"
              pools={pools}
              value={from}
              onChange={setFrom}
            />
            <PoolPicker label="To" pools={pools} value={to} onChange={setTo} />
          </div>
          <div className="flex gap-2">
            <select
              value={cause}
              aria-label="Cause"
              className="h-(--tap) flex-1 rounded-4xl border border-input bg-input/30 px-3 text-sm outline-none"
              onChange={(event) =>
                setCause(event.target.value as MovementCause)
              }
            >
              {CAUSES.map((option) => (
                <option key={option} value={option}>
                  {option.toLowerCase().replace(/_/g, " ")}
                </option>
              ))}
            </select>
            <Input
              value={quantity}
              inputMode="numeric"
              aria-label="Pieces"
              className="h-(--tap) w-24 text-center font-mono"
              onChange={(event) => setQuantity(event.target.value)}
            />
          </div>
          <Input
            value={reason}
            placeholder="Why — this is what the ledger keeps"
            className="h-(--tap)"
            onChange={(event) => setReason(event.target.value)}
          />
          <Button
            variant="secondary"
            className="h-(--tap)"
            disabled={action.pending || !ready}
            onClick={move}
          >
            Move it
          </Button>
          <Problem error={action.error} />
        </div>
      )}
    </Panel>
  )
}

function PoolPicker({
  label,
  pools,
  value,
  onChange,
}: {
  label: string
  pools: readonly PoolRow[]
  value: string
  onChange: (value: string) => void
}) {
  return (
    <select
      value={value}
      aria-label={label}
      className="h-(--tap) min-w-0 flex-1 rounded-4xl border border-input bg-input/30 px-3 text-sm outline-none"
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">{label}…</option>
      {pools.map((pool) => (
        <option key={pool.id} value={pool.id}>
          {pool.label}
        </option>
      ))}
    </select>
  )
}
