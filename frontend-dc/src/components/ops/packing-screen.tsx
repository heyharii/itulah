import { useMemo, useState } from "react"

import {
  ConfirmButton,
  Panel,
  Problem,
  Row,
  RowNumber,
  RowText,
  ScanField,
  SessionBar,
} from "@/components/ops/parts"
import { useAction } from "@/lib/action"
import {
  Note,
  Pill,
  ScreenBody,
  ScreenHeader,
  ScreenState,
  Stat,
} from "@/components/shell"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { dc } from "@/lib/api"
import { units } from "@/lib/format"
import { loadPrinter } from "@/lib/printer"
import { keys } from "@/lib/queries"
import { useActor } from "@/lib/session"
import { idempotencyKey } from "@itulah/contract/client"
import type {
  CaptureOutcome,
  FulfillmentProgressResult,
  Koli,
} from "@itulah/contract"
import { useQuery, useQueryClient } from "@tanstack/react-query"

/// Packing, which is where the outbound flow actually decides something.
///
/// Picking fetched a SKU and a quantity for nobody in particular. Putting a
/// piece in a box for a store is what fulfils an allotment line — the oldest
/// line still wanting that SKU for that store, chosen by the server. Until the
/// lid closes, nothing in this warehouse belongs to any shop, and this screen
/// says so by never showing a destination before the box.
export function PackingScreen() {
  const actor = useActor()
  const client = useQueryClient()
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [destination, setDestination] = useState("")
  const action = useAction()

  const sessions = useQuery({
    queryKey: keys.packingSessions(),
    queryFn: ({ signal }) => dc.packingSessions({ ready: true }, signal),
  })

  const summary = useQuery({
    queryKey: keys.packingSession(sessionId ?? ""),
    queryFn: ({ signal }) => dc.packingSession(sessionId as string, signal),
    enabled: sessionId !== null,
  })

  const boxes = useQuery({
    queryKey: keys.koli(),
    queryFn: ({ signal }) => dc.koli({}, signal),
  })

  // The stores this node has actually packed for. Offered as suggestions, not
  // as a closed list: a store's first ever carton has to be possible to type.
  const knownStores = useMemo(
    () =>
      Array.from(
        new Set((boxes.data ?? []).map((box) => box.destination_store_id)),
      ).sort(),
    [boxes.data],
  )

  const refresh = () => {
    void client.invalidateQueries({ queryKey: ["dc"] })
  }

  const unsealed = (boxes.data ?? []).filter((box) => box.sealed_at === null)

  return (
    <>
      <ScreenHeader
        title="Packing"
        subtitle={`${unsealed.length} boxes open · ${boxes.data?.length ?? 0} on the floor`}
      />
      <ScreenBody className="lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,23rem)] lg:items-start">
        <div className="flex flex-col gap-4">
          <Destination
            value={destination}
            suggestions={knownStores}
            onChange={setDestination}
          />
          {destination.trim() !== "" && (
            <FillBox
              destination={destination.trim()}
              actor={actor}
              onPacked={refresh}
            />
          )}
          {destination.trim() !== "" && (
            <SweepBox
              destination={destination.trim()}
              actor={actor}
              onSwept={refresh}
            />
          )}
          <Boxes
            boxes={boxes.data ?? []}
            loading={boxes.isPending}
            sessionId={sessionId}
            onChanged={refresh}
          />
        </div>

        <div className="flex flex-col gap-4">
          <SessionBar
            kind="Packing"
            sessions={sessions.data ?? []}
            activeId={sessionId}
            pending={action.pending}
            onSelect={setSessionId}
            onOpen={() =>
              void action.run(async () => {
                const opened = await dc.openPackingSession({
                  actor_id: actor,
                  note: null,
                })
                setSessionId(opened.session_id)
                void client.invalidateQueries({ queryKey: keys.packingSessions() })
              })
            }
            onClose={(id) =>
              void action.run(async () => {
                await dc.closePackingSession(id)
                setSessionId(null)
                void client.invalidateQueries({ queryKey: keys.packingSessions() })
              })
            }
          >
            {summary.data !== undefined && (
              <>
                <Stat label="Boxes" value={units(summary.data.koli_count)} />
                <Stat label="Units" value={units(summary.data.unit_count)} />
                <Stat
                  label="Open"
                  value={units(summary.data.unsealed_count)}
                  tone={summary.data.unsealed_count > 0 ? "warn" : undefined}
                />
              </>
            )}
          </SessionBar>

          <Problem error={action.error} />

          <Note>
            <strong className="text-foreground font-medium">
              The destination is decided at the box, not at the rack.
            </strong>{" "}
            Each piece is attributed to the oldest allotment line still wanting
            that SKU for that store. If no line wants it, the pack is refused
            rather than quietly recorded.
          </Note>

          <Note>
            A box's position is worked out from where it is, never stored — so a
            carton cannot claim to be on a truck it was never loaded onto.
          </Note>
        </div>
      </ScreenBody>
    </>
  )
}

function Destination({
  value,
  suggestions,
  onChange,
}: {
  value: string
  suggestions: readonly string[]
  onChange: (value: string) => void
}) {
  const outstanding = useQuery({
    queryKey: keys.outstanding(value.trim()),
    queryFn: ({ signal }) => dc.outstandingFor(value.trim(), signal),
    enabled: value.trim() !== "",
  })

  return (
    <Panel
      title="Destination"
      meta={value.trim() === "" ? "none chosen" : value.trim()}
    >
      <div className="px-4 py-3">
        <Input
          value={value}
          list="dc-known-stores"
          placeholder="Store id"
          className="h-(--tap) font-mono"
          onChange={(event) => onChange(event.target.value)}
        />
        <datalist id="dc-known-stores">
          {suggestions.map((store) => (
            <option key={store} value={store} />
          ))}
        </datalist>
      </div>

      {value.trim() !== "" && outstanding.isPending && (
        <ScreenState>Reading what this store is owed…</ScreenState>
      )}
      {outstanding.isError && (
        <ScreenState tone="problem">
          {(outstanding.error as Error).message}
        </ScreenState>
      )}
      {outstanding.data?.length === 0 && (
        <ScreenState>
          Nothing can go in a box for this store right now — either it has
          nothing coming, or nobody has fetched it off the racks yet.
        </ScreenState>
      )}
      {outstanding.data?.map((line) => (
        <Row key={line.sku_code}>
          <RowText code={line.sku_code}>
            {line.wanted} wanted · {line.available} off the racks
          </RowText>
          <RowNumber
            value={units(line.outstanding)}
            label="can go now"
            tone={line.outstanding === 0 ? "muted" : undefined}
          />
        </Row>
      ))}
    </Panel>
  )
}

/// Scan pieces into a box for one store.
///
/// The EPCs are gathered here and sent in one request, because the box is the
/// unit the server records: one destination, many allotment lines, one
/// movement group.
function FillBox({
  destination,
  actor,
  onPacked,
}: {
  destination: string
  actor: string
  onPacked: () => void
}) {
  const action = useAction()
  const [epcs, setEpcs] = useState<string[]>([])
  const [packed, setPacked] = useState<FulfillmentProgressResult | null>(null)

  const add = (value: string) => {
    const epc = value.trim().toUpperCase()
    if (epc === "") {
      return
    }
    // A tag swept twice is one piece. Silently ignoring the second scan is
    // right here: the alternative is a box that claims more than it holds.
    setEpcs((current) => (current.includes(epc) ? current : [...current, epc]))
  }

  const pack = () =>
    void action.run(async () => {
      const result = await dc.packKoli({
        destination_store_id: destination,
        epcs,
        actor_id: actor,
        idempotency_key: idempotencyKey(),
      })
      setPacked(result)
      setEpcs([])
      onPacked()
    })

  return (
    <Panel
      title="Fill a box"
      meta={epcs.length === 0 ? destination : `${epcs.length} scanned`}
    >
      <ScanField
        placeholder="Scan an EPC"
        action="Add"
        onSubmit={add}
      />

      {epcs.length > 0 && (
        <>
          <div className="flex flex-wrap gap-1.5 px-4 py-3">
            {epcs.map((epc) => (
              <button
                key={epc}
                type="button"
                className="bg-muted hover:bg-destructive/12 hover:text-destructive rounded-full px-2.5 py-1 font-mono text-[11px]"
                onClick={() =>
                  setEpcs((current) => current.filter((other) => other !== epc))
                }
              >
                {epc}
              </button>
            ))}
          </div>
          <div className="border-t px-4 py-3">
            <Button
              className="h-(--tap) w-full"
              disabled={action.pending}
              onClick={pack}
            >
              Pack {epcs.length} into a box for {destination}
            </Button>
          </div>
        </>
      )}

      <Problem error={action.error} />

      {packed !== null && (
        <div className="border-t px-4 py-3">
          <p className="mb-2 text-xs font-medium">
            {units(packed.units.length)} pieces packed · {packed.stage.toLowerCase()}
          </p>
          <ul className="flex flex-col gap-1">
            {packed.units.map((unit) => (
              <li
                key={unit.epc}
                className="text-muted-foreground flex justify-between gap-3 font-mono text-[11px]"
              >
                <span className="truncate">{unit.epc}</span>
                <span className="shrink-0">
                  {unit.sku_code} → line {unit.allotment_line_id.slice(0, 8)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  )
}

function Boxes({
  boxes,
  loading,
  sessionId,
  onChanged,
}: {
  boxes: readonly Koli[]
  loading: boolean
  sessionId: string | null
  onChanged: () => void
}) {
  const action = useAction()
  const [openManifest, setOpenManifest] = useState<string | null>(null)

  const manifest = useQuery({
    queryKey: keys.koliManifest(openManifest ?? ""),
    queryFn: ({ signal }) => dc.koliManifest(openManifest as string, signal),
    enabled: openManifest !== null,
  })

  return (
    <Panel title="Boxes" meta={`${boxes.length} on the floor`}>
      {loading && <ScreenState>Reading the floor…</ScreenState>}
      {!loading && boxes.length === 0 && (
        <ScreenState>No boxes yet. Scan pieces into one above.</ScreenState>
      )}

      {boxes.map((box) => (
        <div key={box.koli_id} className="border-b last:border-b-0">
          <div className="flex flex-wrap items-center gap-3 px-4 py-3">
            <RowText code={box.koli_number}>
              {box.destination_store_id} · {box.position}
            </RowText>
            <RowNumber value={units(box.unit_count)} label="units" />
            {box.sealed_at === null ? (
              <ConfirmButton
                label="Seal"
                className="h-(--tap)"
                disabled={action.pending}
                title={`Seal ${box.koli_number}`}
                description={
                  <>
                    The contents of this box become final. That is what makes
                    the packing list worth printing — and it cannot be undone by
                    opening the carton again.
                  </>
                }
                confirmLabel="Seal it"
                onConfirm={() =>
                  void action
                    .run(() => dc.sealKoli(box.koli_id))
                    .then((done) => done && onChanged())
                }
              />
            ) : (
              <Pill tone="good">sealed</Pill>
            )}
            <Button
              variant="outline"
              className="h-(--tap)"
              onClick={() =>
                setOpenManifest((current) =>
                  current === box.koli_id ? null : box.koli_id,
                )
              }
            >
              {openManifest === box.koli_id ? "Hide" : "Manifest"}
            </Button>
            {box.sealed_at !== null && (
              <Button
                variant="outline"
                className="h-(--tap)"
                disabled={action.pending}
                onClick={() => {
                  // The sticker's ZPL comes back with the manifest, so the
                  // label on the outside of the carton and the list of what is
                  // inside it can never be rendered from two different reads.
                  const printer = loadPrinter()
                  void action.run(() =>
                    dc.printKoliLabel(box.koli_id, {
                      printer_host: printer.host,
                      printer_port: printer.port,
                    }),
                  )
                }}
              >
                Label
              </Button>
            )}
            {sessionId !== null && box.packing_session_id === null && (
              <Button
                variant="ghost"
                className="h-(--tap)"
                disabled={action.pending}
                onClick={() =>
                  void action
                    .run(() => dc.assignKoli(box.koli_id, sessionId))
                    .then((done) => done && onChanged())
                }
              >
                Claim
              </Button>
            )}
          </div>

          {openManifest === box.koli_id && (
            <div className="bg-muted/40 flex flex-col gap-3 px-4 py-3 sm:flex-row">
              {manifest.data !== undefined && (
                <>
                  <div
                    className="[&_svg]:h-28 [&_svg]:w-28 shrink-0"
                    aria-label={`QR for ${manifest.data.qr_payload}`}
                    dangerouslySetInnerHTML={{ __html: manifest.data.qr_svg }}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="mb-1 font-mono text-[11px]">
                      {manifest.data.qr_payload}
                    </p>
                    <ul className="flex flex-col gap-0.5">
                      {manifest.data.lines.map((line) => (
                        <li
                          key={`${line.sku_code}-${line.allotment_line_id}`}
                          className="text-muted-foreground flex justify-between gap-3 font-mono text-[11px]"
                        >
                          <span className="truncate">{line.sku_code}</span>
                          <span className="shrink-0 tabular-nums">
                            {units(line.quantity)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </>
              )}
              {manifest.isPending && (
                <p className="text-muted-foreground text-xs">Reading the box…</p>
              )}
            </div>
          )}
        </div>
      ))}
      <Problem error={action.error} />
    </Panel>
  )
}

/// The RFID path: name what the box is meant to hold, then sweep it.
///
/// The target is fixed when the box opens and is not editable afterwards — a
/// target edited to match the sweep is not a target, it is a transcription.
/// When a sweep agrees with the target the server packs, freezes and seals the
/// box in one go: agreement is the seal, so there is no button here for it and
/// nobody has to remember to press one.
function SweepBox({
  destination,
  actor,
  onSwept,
}: {
  destination: string
  actor: string
  onSwept: () => void
}) {
  const action = useAction()
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [target, setTarget] = useState<Record<string, string>>({})
  const [outcome, setOutcome] = useState<CaptureOutcome | null>(null)
  const [reader, setReader] = useState("")

  const outstanding = useQuery({
    queryKey: keys.outstanding(destination),
    queryFn: ({ signal }) => dc.outstandingFor(destination, signal),
  })

  const box = useQuery({
    queryKey: ["dc", "packing-box", sessionId ?? ""],
    queryFn: ({ signal }) => dc.packingBox(sessionId as string, signal),
    enabled: sessionId !== null,
  })

  const openBox = () => {
    const lines = Object.entries(target)
      .map(([sku_code, quantity]) => ({
        sku_code,
        target_qty: Number(quantity),
      }))
      .filter((line) => Number.isInteger(line.target_qty) && line.target_qty > 0)
    if (lines.length === 0) {
      return
    }
    void action.run(async () => {
      const opened = await dc.openPackingBox({
        destination_store_id: destination,
        target: lines,
        actor_id: actor,
        note: null,
      })
      setSessionId(opened.session.session_id)
      setOutcome(null)
    })
  }

  const sweep = () =>
    void action.run(async () => {
      if (sessionId === null || reader.trim() === "") {
        return
      }
      const result = await dc.captureBox(sessionId, reader.trim())
      setOutcome(result)
      if (result.matched) {
        setSessionId(null)
        setTarget({})
        setReader("")
        onSwept()
      }
    })

  return (
    <Panel
      title="Target and sweep"
      meta={
        sessionId === null ? (
          "no box open"
        ) : box.data?.ready === true ? (
          <Pill tone="good">agreed</Pill>
        ) : (
          <Pill tone="warn">filling</Pill>
        )
      }
    >
      {sessionId === null ? (
        <>
          {outstanding.data?.length === 0 && (
            <ScreenState>
              Nothing to target for this store yet.
            </ScreenState>
          )}
          {outstanding.data?.map((line) => (
            <div
              key={line.sku_code}
              className="flex items-center gap-3 border-b px-4 py-2.5 last:border-b-0"
            >
              <RowText code={line.sku_code}>{line.outstanding} can go now</RowText>
              <Input
                value={target[line.sku_code] ?? ""}
                inputMode="numeric"
                placeholder="0"
                className="h-(--tap) w-24 text-center font-mono"
                onChange={(event) =>
                  setTarget((current) => ({
                    ...current,
                    [line.sku_code]: event.target.value,
                  }))
                }
              />
            </div>
          ))}
          {(outstanding.data?.length ?? 0) > 0 && (
            <div className="border-t px-4 py-3">
              <Button
                variant="secondary"
                className="h-(--tap) w-full"
                disabled={action.pending}
                onClick={openBox}
              >
                Open a box with this target
              </Button>
            </div>
          )}
        </>
      ) : (
        <>
          {box.data?.target.map((line) => {
            const found = outcome?.lines.find(
              (swept) => swept.sku_code === line.sku_code,
            )
            return (
              <Row key={line.sku_code}>
                <RowText code={line.sku_code}>
                  {found === undefined
                    ? "not swept yet"
                    : found.scanned_qty === line.target_qty
                      ? "agrees"
                      : `${found.scanned_qty} found`}
                </RowText>
                <RowNumber
                  value={units(line.target_qty)}
                  label="target"
                  tone={
                    found !== undefined && found.scanned_qty !== line.target_qty
                      ? "bad"
                      : undefined
                  }
                />
              </Row>
            )
          })}

          <div className="flex flex-wrap gap-2 border-t px-4 py-3">
            <Input
              value={reader}
              placeholder="Reader session id"
              className="h-(--tap) min-w-40 flex-1 font-mono"
              onChange={(event) => setReader(event.target.value)}
            />
            <Button
              className="h-(--tap)"
              disabled={action.pending || reader.trim() === ""}
              onClick={sweep}
            >
              Sweep
            </Button>
            <Button
              variant="ghost"
              className="h-(--tap)"
              onClick={() => {
                setSessionId(null)
                setOutcome(null)
              }}
            >
              Leave it
            </Button>
          </div>
        </>
      )}

      {outcome !== null && outcome.matched && (
        <p className="px-4 pb-3 text-xs text-emerald-700 dark:text-emerald-400">
          The sweep agreed with the target, so the box was packed, frozen and
          sealed in one go.
        </p>
      )}
      {outcome !== null && !outcome.matched && (
        <div className="border-t px-4 py-3 text-xs">
          {outcome.unexpected.length > 0 && (
            <p className="text-destructive mb-1">
              Not on this box&apos;s list:{" "}
              {outcome.unexpected.map((line) => line.sku_code).join(", ")} — wrong
              goods, caught before the lid closed rather than at the shop door.
            </p>
          )}
          {outcome.unknown_epcs.length > 0 && (
            <p className="text-muted-foreground">
              {outcome.unknown_epcs.length} tags this DC has never heard of.
            </p>
          )}
        </div>
      )}
      <Problem error={action.error} />
    </Panel>
  )
}
