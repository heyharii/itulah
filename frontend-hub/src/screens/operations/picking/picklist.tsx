import { useForm } from "@tanstack/react-form"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { PackageOpen } from "lucide-react"

import { PageContent } from "@/components/shell/app-shell"
import { AppLink } from "@/components/ui/app-link"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input, Select } from "@/components/ui/field"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { RecordBody, RecordCard, RecordHead } from "@/components/ui/record-card"
import { Banner, EmptyState, Problem } from "@/components/ui/states"
import { dc, poolsAnswer } from "@/lib/api"
import { count } from "@/lib/format"
import { keys } from "@/lib/operations/keys"
import { queryState } from "@/lib/query-state"
import { useEdgeActor } from "@/lib/edge-session"
import { useSheet } from "@/lib/sheets"
import { idempotencyKey } from "@itulah/contract/client"
import type { PicklistLine } from "@itulah/contract"

/// Picking: a SKU and a number, off a rack.
///
/// **There is no destination anywhere on this screen**, and that is the whole
/// design. Which shop each piece serves is settled when it goes into a box, so
/// a picker walks the aisles with a sheet and a quantity and has nothing else
/// to get wrong. A "pick for store 3" control would be asserting a decision
/// nobody has made yet.
///
/// The picklist is recomputed on every read — nobody authors it. It is what is
/// still owed, added up by SKU, and a line disappearing is the only receipt a
/// picker needs.
export function Picklist() {
  const round = useSheet("pick")
  const rack = useSheet("rack")

  const picklist = useQuery({
    queryKey: keys.picklist(),
    queryFn: ({ signal }) => dc.picklist(signal),
  })

  const answer = useQuery({
    queryKey: keys.pools(),
    queryFn: ({ signal }) => poolsAnswer(signal),
  })

  // Stock comes off a rack, and a rack is a pool this node owns. Offered as a
  // choice rather than guessed from the site id: composing a pool id in the
  // browser would be inventing a wire format nobody asked it to know.
  const racks = (answer.data?.items ?? []).filter(
    (pool) => !pool.is_rollup && pool.group === "WAREHOUSE"
  )
  const source = rack.value ?? racks[0]?.id ?? null

  const lines = picklist.data ?? []
  const owed = lines.reduce((total, line) => total + line.outstanding, 0)

  return (
    <PageContent>
      <PageHeader
        crumb="Picking"
        title="Picklist"
        sub="What is still owed, by SKU. Recomputed on every read — nobody writes this list."
        actions={
          racks.length > 1 ? (
            <Select
              aria-label="Rack"
              className="w-56"
              value={source ?? ""}
              onChange={(next) => rack.open(next)}
            >
              {racks.map((pool) => (
                <option key={pool.id} value={pool.id}>
                  {pool.label} · {count(pool.stock)}
                </option>
              ))}
            </Select>
          ) : undefined
        }
      />

      <KpiStrip className="grid-cols-2 xl:grid-cols-3">
        <Kpi label="SKUs owed" value={count(lines.length)} />
        <Kpi label="Pieces owed" value={count(owed)} />
        <Kpi
          label="Round"
          value={round.value === undefined ? "none" : "open"}
          delta={
            round.value === undefined
              ? "picks are still recorded"
              : "picks join this round"
          }
        />
      </KpiStrip>

      {round.value === undefined && (
        <Banner tone="info" className="mb-[1.125rem]">
          No round is open. Picking without one is ordinary work and is recorded
          exactly the same — a round is what gathers a trip round the aisles
          into one thing somebody can read back.{" "}
          <AppLink
            to="/operations/picking/rounds"
            className="underline underline-offset-2"
          >
            Open one
          </AppLink>
          .
        </Banner>
      )}

      {racks.length === 0 && !answer.isPending && (
        <Banner tone="bad" className="mb-[1.125rem]">
          This node owns no warehouse pool, so there is nothing to pick from.
        </Banner>
      )}

      {queryState(picklist, {
        loading: "Reading what is owed…",
        render: () =>
          lines.length === 0 ? (
            <Card>
              <EmptyState>
                Nothing is owed. Every accepted allotment line has been picked.
              </EmptyState>
            </Card>
          ) : (
            <div className="flex flex-col gap-3">
              {lines.map((line) => (
                <PickLine
                  key={line.sku_code}
                  line={line}
                  source={source}
                  sessionId={round.value ?? null}
                />
              ))}
            </div>
          ),
      })}
    </PageContent>
  )
}

/// One SKU off one rack.
///
/// The quantity defaults to what is owed, because the ordinary case is
/// fetching all of it and typing the number again is the ordinary way to get
/// it wrong. It stays editable, because the ordinary *second* case is coming
/// back short.
function PickLine({
  line,
  source,
  sessionId,
}: {
  line: PicklistLine
  source: string | null
  sessionId: string | null
}) {
  const actor = useEdgeActor()
  const client = useQueryClient()

  const take = useMutation({
    mutationFn: (quantity: number) =>
      dc.pick({
        source_pool_id: source!,
        sku_code: line.sku_code,
        quantity,
        actor_id: actor,
        // A pick applied twice takes stock off the rack twice, and the second
        // one is attributed to an allotment line that was already satisfied.
        idempotency_key: idempotencyKey(),
        // Optional on purpose in the wire: fetching one thing without opening
        // a round is ordinary, and refusing it would make the paperwork the
        // point instead of the goods.
        pick_session_id: sessionId,
      }),
    onSuccess: () => {
      form.reset()
      // A pick empties a rack, shortens this list, adds to the round beside
      // it, and makes something packable for a store.
      void client.invalidateQueries({ queryKey: keys.picklist() })
      void client.invalidateQueries({ queryKey: ["dc", "pick-session"] })
      void client.invalidateQueries({ queryKey: keys.pools() })
      void client.invalidateQueries({ queryKey: ["dc", "outstanding"] })
    },
  })

  const form = useForm({
    defaultValues: { quantity: String(line.outstanding) },
    onSubmit: ({ value }) => {
      const quantity = Number(value.quantity)
      if (source === null || !Number.isInteger(quantity) || quantity < 1) return
      take.mutate(quantity)
    },
  })

  return (
    <RecordCard>
      <RecordHead
        tile={<PackageOpen />}
        id={line.sku_code}
        title={
          line.allotment_lines === 1
            ? "one shop is waiting on this"
            : `${count(line.allotment_lines)} shops are waiting on this`
        }
        status={<Pill tone="warn">{count(line.outstanding)} owed</Pill>}
      />
      <RecordBody>
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            form.handleSubmit()
          }}
        >
          <form.Field name="quantity">
            {(field) => (
              <Input
                className="w-28 text-center text-[1.125rem] font-semibold"
                inputMode="numeric"
                autoComplete="off"
                aria-label={`Pieces of ${line.sku_code} taken`}
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
              />
            )}
          </form.Field>
          <span className="text-[0.78125rem] text-body">
            off the rack
            {line.allotment_lines > 1 && (
              <span className="block text-[0.6875rem] text-mute">
                a shortfall here lands on more than one shop
              </span>
            )}
          </span>
          <div className="flex-1" />
          <Button
            variant="dark"
            type="submit"
            disabled={take.isPending || source === null}
          >
            {take.isPending ? "Taking…" : "Picked"}
          </Button>
        </form>
        <Problem error={take.error} className="mt-2.5" />
      </RecordBody>
    </RecordCard>
  )
}
