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
import { useAction } from "@/lib/action"
import { Note, ScreenBody, ScreenHeader, ScreenState, Stat } from "@/components/shell"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { dc, pools } from "@/lib/api"
import { units } from "@/lib/format"
import { keys } from "@/lib/queries"
import { useActor } from "@/lib/session"
import { idempotencyKey } from "@itulah/contract/client"
import { useQuery, useQueryClient } from "@tanstack/react-query"

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
  const action = useAction()
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [poolId, setPoolId] = useState<string | null>(null)
  const [quantities, setQuantities] = useState<Record<string, string>>({})

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

  const owned = useQuery({ queryKey: keys.pools(), queryFn: ({ signal }) => pools(signal) })

  // Stock comes off a rack, and the rack is a pool this node owns. Offered as
  // a choice rather than guessed from the site id: composing a pool id in the
  // browser would be inventing a wire format nobody asked it to know.
  const racks = (owned.data ?? []).filter(
    (pool) => pool.is_rollup === false && pool.group === "WAREHOUSE",
  )
  const source = poolId ?? racks[0]?.id ?? null

  const refresh = () => {
    void client.invalidateQueries({ queryKey: keys.picklist() })
    void client.invalidateQueries({ queryKey: ["dc", "pick-session"] })
    void client.invalidateQueries({ queryKey: keys.koli() })
  }

  const take = async (skuCode: string, quantity: number) => {
    if (source === null || !Number.isInteger(quantity) || quantity < 1) {
      return
    }
    const done = await action.run(() =>
      dc.pick({
        source_pool_id: source,
        sku_code: skuCode,
        quantity,
        actor_id: actor,
        idempotency_key: idempotencyKey(),
        pick_session_id: sessionId,
      }),
    )
    if (done) {
      setQuantities((current) => ({ ...current, [skuCode]: "" }))
      refresh()
    }
  }

  const outstanding = (picklist.data ?? []).reduce(
    (total, line) => total + line.outstanding,
    0,
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
            {picklist.isPending && <ScreenState>Working out what is owed…</ScreenState>}
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
              <div
                key={line.sku_code}
                className="flex flex-wrap items-center gap-3 border-b px-4 py-3 last:border-b-0"
              >
                <RowText code={line.sku_code}>
                  {line.allotment_lines > 1
                    ? `coming up short here lands on ${line.allotment_lines} stores`
                    : "for one store"}
                </RowText>
                <RowNumber value={units(line.outstanding)} label="owed" />
                <Input
                  value={quantities[line.sku_code] ?? ""}
                  inputMode="numeric"
                  placeholder="qty"
                  className="h-(--tap) w-24 text-center font-mono"
                  onChange={(event) =>
                    setQuantities((current) => ({
                      ...current,
                      [line.sku_code]: event.target.value,
                    }))
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault()
                      void take(line.sku_code, Number(quantities[line.sku_code]))
                    }
                  }}
                />
                <Button
                  className="h-(--tap)"
                  disabled={action.pending || source === null}
                  onClick={() =>
                    void take(
                      line.sku_code,
                      Number(quantities[line.sku_code] ?? line.outstanding),
                    )
                  }
                >
                  Pick
                </Button>
              </div>
            ))}

            <ScanField
              placeholder="Scan or type a SKU"
              action="Pick one"
              pending={action.pending}
              onSubmit={(value) => void take(value.trim(), 1)}
            />
            <Problem error={action.error} />
          </Panel>

          <Note>
            <strong className="text-foreground font-medium">
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
            pending={action.pending}
            onSelect={setSessionId}
            onOpen={() =>
              void action.run(async () => {
                const opened = await dc.openPickSession({
                  actor_id: actor,
                  note: null,
                })
                setSessionId(opened.session_id)
                void client.invalidateQueries({ queryKey: keys.pickSessions() })
              })
            }
            onClose={(id) =>
              void action.run(async () => {
                await dc.closePickSession(id)
                setSessionId(null)
                void client.invalidateQueries({ queryKey: keys.pickSessions() })
              })
            }
          >
            {summary.data !== undefined && (
              <>
                <Stat label="Picked" value={units(summary.data.total_picked)} />
                <Stat label="SKUs" value={units(summary.data.sku_count)} />
              </>
            )}
          </SessionBar>

          {sessionId !== null && (summary.data?.lines.length ?? 0) > 0 && (
            <Panel title="This round" meta={`${summary.data?.lines.length} racks`}>
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
