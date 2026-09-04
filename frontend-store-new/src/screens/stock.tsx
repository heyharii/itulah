import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  ArrowRight,
  Boxes,
  History,
  MoveRight,
  Store,
  Trash,
} from "lucide-react"
import { useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { RecordCard } from "@/components/ui/card"
import { Field, Input, Select } from "@/components/ui/field"
import { Meter } from "@/components/ui/meter"
import { Pill } from "@/components/ui/pill"
import { KeyValue } from "@/components/ui/rows"
import { CardList, FloatingBar, Screen, Section } from "@/components/ui/screen"
import { ScanField } from "@/components/ui/scan-field"
import { Banner, EmptyState } from "@/components/ui/states"
import { queryState } from "@/lib/query-state"
import { Tag as Code } from "@/components/ui/tag"
import { node } from "@/lib/api"
import { describe } from "@/lib/errors"
import { readScan } from "@/lib/epc"
import { count } from "@/lib/format"
import { useGo } from "@/lib/go"
import { fetchPools, inventoryKey, poolsKey, type PoolRow } from "@/lib/queries"
import { useIdentity, useNodeIdentity } from "@/lib/session"
import type { MoveRequest } from "@itulah/contract"
import { idempotencyKey } from "@itulah/contract/client"

/// What is in this shop, and moving a piece between the two places it can be.
///
/// A shop owns three pools — its warehouse, its floor, and its reject shelf —
/// and `POST /store/movements` walks a garment between them. The node accepts
/// only `NORMAL_MOVE` here on purpose: receiving, selling and counting each
/// write their own cause through their own endpoint, so a move can never be
/// dressed up as a sale.
export function Stock() {
  const go = useGo()
  const client = useQueryClient()
  const identity = useIdentity()
  const where = useNodeIdentity()
  const site = where.data?.site_id ?? null

  const pools = useQuery({
    queryKey: poolsKey(),
    queryFn: ({ signal }) => fetchPools(signal),
  })

  const [scanned, setScanned] = useState<{
    epc: string
    sku_code: string
  } | null>(null)
  const [from, setFrom] = useState("warehouse")
  const [to, setTo] = useState("floor")
  const [reason, setReason] = useState("")
  const [note, setNote] = useState<string | null>(null)
  const key = useRef<string>(idempotencyKey())

  const move = useMutation({
    mutationFn: (request: MoveRequest) =>
      node.post<unknown>("/api/v1/store/movements", request, {
        headers: { "Idempotency-Key": request.idempotency_key },
      }),
    onSuccess: () => {
      // The balances moved and the ledger grew — the whole `inventory`
      // namespace, and nothing outside it.
      void client.invalidateQueries({ queryKey: inventoryKey() })
      setScanned(null)
      setReason("")
      setNote(null)
      key.current = idempotencyKey()
    },
  })

  function onScan(raw: string) {
    const read = readScan(raw)
    if (read.kind !== "epc") {
      setNote(
        "Moving stock needs the garment's own tag — a barcode names the product, not the piece in your hand.",
      )
      return
    }
    setNote(null)
    setScanned({ epc: read.epc, sku_code: read.sku_code })
    key.current = idempotencyKey()
  }

  const ready = scanned !== null && site !== null && from !== to

  return (
    <>
      <Screen foot={scanned === null ? "tabs" : "both"}>
        <div className="pt-1 pb-4">
          <ScanField
            onScan={onScan}
            autoFocus={false}
            placeholder="Scan a tag to move it…"
          />
        </div>

        {note !== null && (
          <Banner tone="warn" className="mb-4">
            {note}
          </Banner>
        )}
        {move.error !== null && (
          <Banner tone="bad" className="mb-4">
            {describe(move.error)}
          </Banner>
        )}

        {scanned !== null && (
          <Section title="Moving">
            <RecordCard icon={<MoveRight />} id={scanned.sku_code}>
              <div className="px-3 pt-1 pb-3">
                <KeyValue term="Tag">
                  <span className="font-mono text-id">{scanned.epc}</span>
                </KeyValue>
              </div>
            </RecordCard>

            <div className="mt-3 flex items-end gap-2.5">
              <Field label="From" className="flex-1">
                <Select value={from} onChange={(next) => setFrom(next)}>
                  {PLACES.map((place) => (
                    <option key={place.code} value={place.code}>
                      {place.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <ArrowRight className="mb-4 size-4 shrink-0 text-line-ico" />
              <Field label="To" className="flex-1">
                <Select value={to} onChange={(next) => setTo(next)}>
                  {PLACES.map((place) => (
                    <option key={place.code} value={place.code}>
                      {place.label}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            {from === to && (
              <Banner tone="warn" className="mt-3">
                A garment cannot be moved to where it already is.
              </Banner>
            )}

            <Field
              label="Why"
              className="mt-3"
              hint="Written into the ledger beside the movement. The ledger is append-only — a mistake is corrected by another movement that says what it is correcting, never by editing this one."
            >
              <Input
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="e.g. Put out on the rail"
              />
            </Field>
          </Section>
        )}

        <Section
          title="On hand"
          action={
            <Button onClick={() => go("/stock/movements")}>
              <History />
              Ledger
            </Button>
          }
        >
          {queryState(pools, {
            loading: "Reading this shop's pools…",
            render: (answer) =>
              answer.items.length === 0 ? (
                <EmptyState>
                  This node owns no pools yet. Nothing has ever been received
                  here.
                </EmptyState>
              ) : (
                <>
                  <CardList>
                    {answer.items.map((pool) => (
                      <PoolCard key={pool.id} pool={pool} />
                    ))}
                  </CardList>
                  <p className="mt-3 text-meta text-mute">
                    {answer.inventory_equation}
                  </p>
                </>
              ),
          })}
        </Section>
      </Screen>

      {scanned !== null && (
        <FloatingBar>
          <div className="flex gap-2.5 p-3">
            <Button size="lg" onClick={() => setScanned(null)}>
              Drop
            </Button>
            <Button
              variant="dark"
              size="lg"
              block
              disabled={!ready || move.isPending}
              onClick={() => {
                if (site === null || scanned === null) return
                move.mutate({
                  epc: scanned.epc,
                  quantity: 1,
                  // `<site>.<pool>:<state>` — `edge/domain/inventory/place.rs`.
                  // Built here rather than typed by a person: a place id is a
                  // wire format, and a shop assistant has no business knowing
                  // it.
                  from: `${site}.${from}:on_hand`,
                  to: `${site}.${to}:on_hand`,
                  // The node accepts nothing else on this endpoint, and says so
                  // plainly if asked: receiving, selling and counting each have
                  // their own cause and their own route.
                  cause: "NORMAL_MOVE",
                  reason:
                    reason.trim() === ""
                      ? `Moved from ${from} to ${to} at the counter`
                      : reason.trim(),
                  actor_id: identity.data?.username ?? "",
                  idempotency_key: key.current,
                  reference_type: null,
                  reference_id: null,
                })
              }}
            >
              {move.isPending ? "Moving…" : "Move it"}
            </Button>
          </div>
        </FloatingBar>
      )}
    </>
  )
}

/// The three places a shop's stock can be. Their codes are the second segment
/// of the pool id the node mints (`store-01.floor`), which is why they are
/// written once here and nowhere else.
const PLACES = [
  { code: "warehouse", label: "Warehouse" },
  { code: "floor", label: "Shop floor" },
  { code: "reject", label: "Reject" },
] as const

const POOL_GLYPH: Record<string, React.ReactNode> = {
  WAREHOUSE: <Boxes />,
  FLOOR: <Store />,
  REJECT: <Trash />,
}

function PoolCard({ pool }: { pool: PoolRow }) {
  // `Stock = On Hand + Allotted + Missing`, so what is missing against what was
  // ever there is the one proportion worth drawing. A meter, not a status
  // colour: it says how much, not what state.
  const missingShare = pool.stock === 0 ? 0 : pool.missing / pool.stock
  return (
    <RecordCard
      icon={POOL_GLYPH[pool.pool_code] ?? <Boxes />}
      id={pool.label}
      status={
        pool.missing > 0 ? (
          <Pill tone="bad">{count(pool.missing)} missing</Pill>
        ) : (
          <Pill tone="ok">All accounted for</Pill>
        )
      }
    >
      <div className="flex items-end justify-between gap-4 px-3 pt-3">
        <div>
          <div className="text-eyebrow font-semibold text-mute uppercase">
            On hand
          </div>
          <div className="mt-0.5 text-kpi leading-none font-semibold text-ink tabular-nums">
            {count(pool.on_hand)}
          </div>
        </div>
        <div className="text-right text-meta text-mute tabular-nums">
          <div>{count(pool.stock)} ever</div>
          {pool.allotted !== null && <div>{count(pool.allotted)} allotted</div>}
        </div>
      </div>
      <div className="px-3 pt-2.5 pb-3">
        <Meter
          value={1 - missingShare}
          tone={pool.missing > 0 ? "warn" : "ok"}
        />
      </div>
      <div className="border-t border-hairline px-3 py-2">
        <Code>{pool.id}</Code>
      </div>
    </RecordCard>
  )
}
