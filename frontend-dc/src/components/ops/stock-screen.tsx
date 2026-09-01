import { useRef, useState } from "react"

import {
  NativeSelect,
  Panel,
  Problem,
  Row,
  RowNumber,
  RowText,
} from "@/components/ops/parts"
import {
  Note,
  Pill,
  ScreenBody,
  ScreenHeader,
  ScreenState,
} from "@/components/shell"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { dc, poolsAnswer, type PoolRow } from "@/lib/api"
import { clock, shortId, units } from "@/lib/format"
import { keys } from "@/lib/queries"
import { useActor } from "@/lib/session"
import { idempotencyKey } from "@itulah/contract/client"
import type { MovementCause, MovementView } from "@itulah/contract"
import { useForm } from "@tanstack/react-form"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useVirtualizer } from "@tanstack/react-virtual"

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
  const scroller = useRef<HTMLDivElement>(null)

  const movements = useQuery({
    queryKey: [...keys.movements(), limit],
    queryFn: ({ signal }) => dc.movements(limit, signal),
  })

  const rows = movements.data ?? []

  return (
    <Panel title="Ledger" meta={`${rows.length} newest`}>
      {movements.isPending && <ScreenState>Reading the ledger…</ScreenState>}
      {rows.length === 0 && !movements.isPending && (
        <ScreenState>
          Nothing has moved on this node yet. Every operation writes here — this
          is the only record any of them leaves.
        </ScreenState>
      )}
      {rows.length > 0 && (
        <div ref={scroller} className="max-h-[30rem] overflow-y-auto">
          <Movements rows={rows} scroller={scroller} />
        </div>
      )}
      {rows.length >= limit && (
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

/// The ledger, virtualised.
///
/// "Show more" walks this list up to five hundred movements, and every one of
/// them is a two-line row with a monospaced pool pair in it. Laying out all of
/// them costs a warehouse tablet a visible freeze each time the button is
/// pressed, which is precisely when somebody is looking for something.
function Movements({
  rows,
  scroller,
}: {
  rows: readonly MovementView[]
  scroller: React.RefObject<HTMLDivElement | null>
}) {
  const virtual = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => 60,
    overscan: 8,
  })

  return (
    <div className="relative w-full" style={{ height: virtual.getTotalSize() }}>
      {virtual.getVirtualItems().map((item) => {
        const movement = rows[item.index]
        return (
          <div
            key={movement.movement_id}
            ref={virtual.measureElement}
            data-index={item.index}
            className="absolute top-0 left-0 w-full"
            style={{ transform: `translateY(${item.start}px)` }}
          >
            <Row>
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
          </div>
        )
      })}
    </div>
  )
}

/// Putting one tagged piece into this DC directly.
function Intake() {
  const actor = useActor()
  const client = useQueryClient()

  const put = useMutation({
    mutationFn: (value: { epc: string; sku: string; price: string }) =>
      dc.intake({
        epc: value.epc.trim().toUpperCase(),
        sku_code: value.sku.trim(),
        unit_price_minor: Number(value.price),
        actor_id: actor,
        idempotency_key: idempotencyKey(),
      }),
    onSuccess: () => {
      form.reset()
      // A piece taken in is stock this node holds and a movement in its
      // ledger, and both are read on this very screen.
      void client.invalidateQueries({ queryKey: keys.pools() })
      void client.invalidateQueries({ queryKey: keys.movements() })
      void client.invalidateQueries({ queryKey: ["dc"] })
    },
  })

  const form = useForm({
    defaultValues: { epc: "", sku: "", price: "" },
    onSubmit: ({ value }) => put.mutate(value),
  })

  return (
    <Panel title="Intake" meta="one piece">
      <form
        className="flex flex-col gap-2 px-4 py-3"
        onSubmit={(event) => {
          event.preventDefault()
          void form.handleSubmit()
        }}
      >
        <form.Field name="epc">
          {(field) => (
            <Input
              value={field.state.value}
              placeholder="EPC"
              autoCapitalize="characters"
              spellCheck={false}
              className="h-(--tap) font-mono"
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.target.value)}
            />
          )}
        </form.Field>
        <div className="flex gap-2">
          <form.Field name="sku">
            {(field) => (
              <Input
                value={field.state.value}
                placeholder="SKU"
                className="h-(--tap) flex-1 font-mono"
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
              />
            )}
          </form.Field>
          <form.Field name="price">
            {(field) => (
              <Input
                value={field.state.value}
                inputMode="numeric"
                placeholder="Cost (rupiah)"
                className="h-(--tap) flex-1 font-mono"
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
              />
            )}
          </form.Field>
        </div>
        <form.Subscribe
          selector={(state) =>
            state.values.epc.trim() !== "" &&
            state.values.sku.trim() !== "" &&
            Number.isFinite(Number(state.values.price))
          }
        >
          {(ready) => (
            <Button
              type="submit"
              variant="secondary"
              className="h-(--tap)"
              disabled={put.isPending || !ready}
            >
              Take it in
            </Button>
          )}
        </form.Subscribe>
        <p className="text-[11px] text-muted-foreground">
          The ordinary way stock arrives is receiving and then tagging, and both
          write their own movements. This is the direct path — an opening
          balance, a piece recovered — one tag at a time.
        </p>
        <Problem error={put.error} />
      </form>
    </Panel>
  )
}

/// A movement written by hand, between two pools this node owns.
function Correction({ pools }: { pools: readonly PoolRow[] }) {
  const actor = useActor()
  const client = useQueryClient()

  const move = useMutation({
    mutationFn: (value: {
      epc: string
      quantity: string
      from: string
      to: string
      cause: MovementCause
      reason: string
    }) =>
      dc.move({
        epc: value.epc.trim().toUpperCase(),
        quantity: Number(value.quantity),
        from: value.from,
        to: value.to,
        cause: value.cause,
        reason: value.reason.trim(),
        actor_id: actor,
        idempotency_key: idempotencyKey(),
        reference_type: null,
        reference_id: null,
      }),
    onSuccess: () => {
      // The pools and the two pools' worth of movement, not the whole form:
      // where the piece is going from and to is usually the same next time.
      form.setFieldValue("epc", "")
      form.setFieldValue("reason", "")
      void client.invalidateQueries({ queryKey: keys.pools() })
      void client.invalidateQueries({ queryKey: keys.movements() })
    },
  })

  const form = useForm({
    defaultValues: {
      epc: "",
      quantity: "1",
      from: "",
      to: "",
      cause: "NORMAL_MOVE" as MovementCause,
      reason: "",
    },
    onSubmit: ({ value }) => move.mutate(value),
  })

  return (
    <Panel title="Move stock" meta="writes a movement">
      {pools.length === 0 ? (
        <ScreenState>No pools to move between yet.</ScreenState>
      ) : (
        <form
          className="flex flex-col gap-2 px-4 py-3"
          onSubmit={(event) => {
            event.preventDefault()
            void form.handleSubmit()
          }}
        >
          <form.Field name="epc">
            {(field) => (
              <Input
                value={field.state.value}
                placeholder="EPC"
                autoCapitalize="characters"
                spellCheck={false}
                className="h-(--tap) font-mono"
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
              />
            )}
          </form.Field>
          <div className="flex gap-2">
            <form.Field name="from">
              {(field) => (
                <PoolPicker
                  label="From"
                  pools={pools}
                  value={field.state.value}
                  onChange={field.handleChange}
                />
              )}
            </form.Field>
            <form.Field name="to">
              {(field) => (
                <PoolPicker
                  label="To"
                  pools={pools}
                  value={field.state.value}
                  onChange={field.handleChange}
                />
              )}
            </form.Field>
          </div>
          <div className="flex gap-2">
            <form.Field name="cause">
              {(field) => (
                <NativeSelect
                  value={field.state.value}
                  aria-label="Cause"
                  className="flex-1"
                  onChange={(event) =>
                    field.handleChange(event.target.value as MovementCause)
                  }
                >
                  {CAUSES.map((option) => (
                    <option key={option} value={option}>
                      {option.toLowerCase().replace(/_/g, " ")}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </form.Field>
            <form.Field name="quantity">
              {(field) => (
                <Input
                  value={field.state.value}
                  inputMode="numeric"
                  aria-label="Pieces"
                  className="h-(--tap) w-24 text-center font-mono"
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
              )}
            </form.Field>
          </div>
          <form.Field name="reason">
            {(field) => (
              <Input
                value={field.state.value}
                placeholder="Why — this is what the ledger keeps"
                className="h-(--tap)"
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
              />
            )}
          </form.Field>
          <form.Subscribe
            selector={(state) =>
              state.values.epc.trim() !== "" &&
              state.values.from !== "" &&
              state.values.to !== "" &&
              state.values.from !== state.values.to &&
              state.values.reason.trim() !== "" &&
              Number(state.values.quantity) > 0
            }
          >
            {(ready) => (
              <Button
                type="submit"
                variant="secondary"
                className="h-(--tap)"
                disabled={move.isPending || !ready}
              >
                Move it
              </Button>
            )}
          </form.Subscribe>
          <Problem error={move.error} />
        </form>
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
    <NativeSelect
      value={value}
      aria-label={label}
      className="min-w-0 flex-1"
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">{label}…</option>
      {pools.map((pool) => (
        <option key={pool.id} value={pool.id}>
          {pool.label}
        </option>
      ))}
    </NativeSelect>
  )
}
