import { useState } from "react"

import {
  NativeSelect,
  Panel,
  Problem,
  Row,
  RowNumber,
  RowText,
  ScanField,
  SessionBar,
} from "@/components/ops/parts"
import {
  Note,
  ScreenBody,
  ScreenHeader,
  ScreenState,
  Stat,
} from "@/components/shell"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { dc, poolsAnswer } from "@/lib/api"
import { units } from "@/lib/format"
import { keys } from "@/lib/queries"
import { useActor } from "@/lib/session"
import { idempotencyKey } from "@itulah/contract/client"
import type { PicklistLine } from "@itulah/contract"
import { useForm } from "@tanstack/react-form"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

/// Picking: a SKU and a number, off a rack.
///
/// No destination anywhere on this screen, and that is the whole design. Which
/// shop each piece serves is settled when it goes into a box, so a picker
/// walks the aisles with a sheet and a quantity and has nothing else to get
/// wrong. A "pick for store 3" button would be asserting a decision nobody has
/// made yet.
export function PickingScreen() {
  const actor = useActor()
  const client = useQueryClient()
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [poolId, setPoolId] = useState<string | null>(null)

  const picklist = useQuery({
    queryKey: keys.picklist(),
    queryFn: ({ signal }) => dc.picklist(signal),
  })

  const sessions = useQuery({
    queryKey: keys.pickSessions(),
    queryFn: ({ signal }) => dc.pickSessions({ ready: true }, signal),
  })

  const summary = useQuery({
    queryKey: keys.pickSession(sessionId ?? ""),
    queryFn: ({ signal }) => dc.pickSession(sessionId as string, signal),
    enabled: sessionId !== null,
  })

  const owned = useQuery({
    queryKey: keys.pools(),
    queryFn: ({ signal }) => poolsAnswer(signal),
  })

  // Stock comes off a rack, and the rack is a pool this node owns. Offered as
  // a choice rather than guessed from the site id: composing a pool id in the
  // browser would be inventing a wire format nobody asked it to know.
  const racks = (owned.data?.items ?? []).filter(
    (pool) => pool.is_rollup === false && pool.group === "WAREHOUSE"
  )
  const source = poolId ?? racks[0]?.id ?? null

  const take = useMutation({
    mutationFn: (input: { skuCode: string; quantity: number }) =>
      dc.pick({
        source_pool_id: source as string,
        sku_code: input.skuCode,
        quantity: input.quantity,
        actor_id: actor,
        idempotency_key: idempotencyKey(),
        pick_session_id: sessionId,
      }),
    // A pick empties a rack, shortens the picklist, and adds to the round this
    // person is working in — and it is the round on screen beside the list
    // that used to go stale until somebody reloaded the tablet.
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.picklist() })
      void client.invalidateQueries({ queryKey: ["dc", "pick-session"] })
      void client.invalidateQueries({ queryKey: keys.pools() })
      void client.invalidateQueries({ queryKey: keys.koli() })
    },
  })

  const openSession = useMutation({
    mutationFn: () => dc.openPickSession({ actor_id: actor, note: null }),
    onSuccess: (opened) => {
      setSessionId(opened.session_id)
      void client.invalidateQueries({ queryKey: keys.pickSessions() })
    },
  })

  const closeSession = useMutation({
    mutationFn: (id: string) => dc.closePickSession(id),
    onSuccess: () => {
      setSessionId(null)
      void client.invalidateQueries({ queryKey: keys.pickSessions() })
    },
  })

  const pick = (skuCode: string, quantity: number) => {
    if (source === null || !Number.isInteger(quantity) || quantity < 1) {
      return
    }
    take.mutate({ skuCode, quantity })
  }

  const outstanding = (picklist.data ?? []).reduce(
    (total, line) => total + line.outstanding,
    0
  )

  return (
    <>
      <ScreenHeader
        title="Picking"
        subtitle={`${units(outstanding)} pieces still owed across ${picklist.data?.length ?? 0} SKUs`}
      />
      <ScreenBody className="lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] lg:items-start">
        <div className="flex flex-col gap-4">
          <Panel
            title="Picklist"
            meta={
              racks.length === 0 ? (
                "no rack pool on this node"
              ) : (
                <NativeSelect
                  aria-label="Rack"
                  value={source ?? ""}
                  className="h-8 max-w-52 text-xs"
                  onChange={(event) => setPoolId(event.target.value)}
                >
                  {racks.map((rack) => (
                    <option key={rack.id} value={rack.id}>
                      {rack.label} · {units(rack.on_hand)}
                    </option>
                  ))}
                </NativeSelect>
              )
            }
          >
            {picklist.isPending && (
              <ScreenState>Working out what is owed…</ScreenState>
            )}
            {picklist.isError && (
              <ScreenState tone="problem">
                {(picklist.error as Error).message}
              </ScreenState>
            )}
            {picklist.data?.length === 0 && (
              <ScreenState>
                Nothing owed. Every accepted allotment line has been picked.
              </ScreenState>
            )}

            {picklist.data?.map((line) => (
              <PickLine
                key={line.sku_code}
                line={line}
                disabled={take.isPending || source === null}
                onPick={(quantity) => pick(line.sku_code, quantity)}
              />
            ))}

            <ScanField
              placeholder="Scan or type a SKU"
              action="Pick one"
              pending={take.isPending}
              onSubmit={(value) => pick(value.trim(), 1)}
            />
            <Problem error={take.error} />
          </Panel>

          <Note>
            <strong className="font-medium text-foreground">
              Nobody writes this list.
            </strong>{" "}
            It is recomputed every time it is read: what each allotment line
            still has coming, grouped by SKU. The decision a person makes is the
            allotment, at the centre — not the picklist, here.
          </Note>
        </div>

        <div className="flex flex-col gap-4">
          <SessionBar
            kind="Picking"
            sessions={sessions.data ?? []}
            activeId={sessionId}
            pending={openSession.isPending || closeSession.isPending}
            onSelect={setSessionId}
            onOpen={() => openSession.mutate()}
            onClose={(id) => closeSession.mutate(id)}
          >
            {summary.data !== undefined && (
              <>
                <Stat label="Picked" value={units(summary.data.total_picked)} />
                <Stat label="SKUs" value={units(summary.data.sku_count)} />
              </>
            )}
          </SessionBar>

          <Problem error={openSession.error ?? closeSession.error} />

          {sessionId !== null && (summary.data?.lines.length ?? 0) > 0 && (
            <Panel
              title="This round"
              meta={`${summary.data?.lines.length} racks`}
            >
              {summary.data?.lines.map((line) => (
                <Row key={line.sku_code}>
                  <RowText code={line.sku_code}>
                    {line.events > 1
                      ? `${line.events} trips to this rack`
                      : "one trip"}
                  </RowText>
                  <RowNumber value={units(line.picked)} label="picked" />
                </Row>
              ))}
            </Panel>
          )}

          <Note>
            A round is optional. Fetching one thing off a rack without opening a
            session is ordinary work, and the pick is recorded either way — it
            simply carries no round number.
          </Note>
        </div>
      </ScreenBody>
    </>
  )
}

/// One SKU still owed, and the quantity somebody is about to fetch.
///
/// The box empties itself once the pick is away, so the next trip to the same
/// rack starts from nothing rather than from the last number typed.
function PickLine({
  line,
  disabled,
  onPick,
}: {
  line: PicklistLine
  disabled: boolean
  onPick: (quantity: number) => void
}) {
  const form = useForm({
    defaultValues: { quantity: "" },
    onSubmit: ({ value, formApi }) => {
      // An empty box means "all of it": the picker pressed the button beside a
      // line that already says how many are owed.
      onPick(
        value.quantity.trim() === "" ? line.outstanding : Number(value.quantity)
      )
      formApi.reset()
    },
  })

  return (
    <form
      className="flex flex-wrap items-center gap-3 border-b px-4 py-3 last:border-b-0"
      onSubmit={(event) => {
        event.preventDefault()
        void form.handleSubmit()
      }}
    >
      <RowText code={line.sku_code}>
        {line.allotment_lines > 1
          ? `coming up short here lands on ${line.allotment_lines} stores`
          : "for one store"}
      </RowText>
      <RowNumber value={units(line.outstanding)} label="owed" />
      <form.Field name="quantity">
        {(field) => (
          <Input
            value={field.state.value}
            inputMode="numeric"
            placeholder="qty"
            className="h-(--tap) w-24 text-center font-mono"
            onBlur={field.handleBlur}
            onChange={(event) => field.handleChange(event.target.value)}
          />
        )}
      </form.Field>
      <Button type="submit" className="h-(--tap)" disabled={disabled}>
        Pick
      </Button>
    </form>
  )
}
