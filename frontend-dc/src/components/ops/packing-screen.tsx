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
  OutstandingLine,
} from "@itulah/contract"
import { useForm } from "@tanstack/react-form"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

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
  // Not a form field: nothing is submitted with it. It chooses which store's
  // outstanding lines are read, and every panel below is drawn from that read.
  const [destination, setDestination] = useState("")

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

  const openSession = useMutation({
    mutationFn: () => dc.openPackingSession({ actor_id: actor, note: null }),
    onSuccess: (opened) => {
      setSessionId(opened.session_id)
      void client.invalidateQueries({ queryKey: keys.packingSessions() })
    },
  })

  const closeSession = useMutation({
    mutationFn: (id: string) => dc.closePackingSession(id),
    onSuccess: () => {
      setSessionId(null)
      void client.invalidateQueries({ queryKey: keys.packingSessions() })
    },
  })

  // The stores this node has actually packed for. Offered as suggestions, not
  // as a closed list: a store's first ever carton has to be possible to type.
  const knownStores = useMemo(
    () =>
      Array.from(
        new Set((boxes.data ?? []).map((box) => box.destination_store_id))
      ).sort(),
    [boxes.data]
  )

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
            <FillBox destination={destination.trim()} actor={actor} />
          )}
          {destination.trim() !== "" && (
            <SweepBox destination={destination.trim()} actor={actor} />
          )}
          <Boxes
            boxes={boxes.data ?? []}
            loading={boxes.isPending}
            sessionId={sessionId}
          />
        </div>

        <div className="flex flex-col gap-4">
          <SessionBar
            kind="Packing"
            sessions={sessions.data ?? []}
            activeId={sessionId}
            pending={openSession.isPending || closeSession.isPending}
            onSelect={setSessionId}
            onOpen={() => openSession.mutate()}
            onClose={(id) => closeSession.mutate(id)}
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

          <Problem error={openSession.error ?? closeSession.error} />

          <Note>
            <strong className="font-medium text-foreground">
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
}: {
  destination: string
  actor: string
}) {
  const client = useQueryClient()
  // Not a form: nothing here is typed or edited. A chip is either in the box
  // or tapped back out of it, and the last answer below is a result to read.
  const [epcs, setEpcs] = useState<string[]>([])
  const [packed, setPacked] = useState<FulfillmentProgressResult | null>(null)

  const pack = useMutation({
    mutationFn: () =>
      dc.packKoli({
        destination_store_id: destination,
        epcs,
        actor_id: actor,
        idempotency_key: idempotencyKey(),
      }),
    onSuccess: (result) => {
      setPacked(result)
      setEpcs([])
      // A packed box changes the boxes on the floor, what this store still has
      // coming, the round's totals and the outbound pools behind all of them.
      void client.invalidateQueries({ queryKey: ["dc"] })
      void client.invalidateQueries({ queryKey: keys.pools() })
    },
  })

  const add = (value: string) => {
    const epc = value.trim().toUpperCase()
    if (epc === "") {
      return
    }
    // A tag swept twice is one piece. Silently ignoring the second scan is
    // right here: the alternative is a box that claims more than it holds.
    setEpcs((current) => (current.includes(epc) ? current : [...current, epc]))
  }

  return (
    <Panel
      title="Fill a box"
      meta={epcs.length === 0 ? destination : `${epcs.length} scanned`}
    >
      <ScanField placeholder="Scan an EPC" action="Add" onSubmit={add} />

      {epcs.length > 0 && (
        <>
          <div className="flex flex-wrap gap-1.5 px-4 py-3">
            {epcs.map((epc) => (
              <button
                key={epc}
                type="button"
                className="rounded-full bg-muted px-2.5 py-1 font-mono text-[11px] hover:bg-destructive/12 hover:text-destructive"
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
              disabled={pack.isPending}
              onClick={() => pack.mutate()}
            >
              Pack {epcs.length} into a box for {destination}
            </Button>
          </div>
        </>
      )}

      <Problem error={pack.error} />

      {packed !== null && (
        <div className="border-t px-4 py-3">
          <p className="mb-2 text-xs font-medium">
            {units(packed.units.length)} pieces packed ·{" "}
            {packed.stage.toLowerCase()}
          </p>
          <ul className="flex flex-col gap-1">
            {packed.units.map((unit) => (
              <li
                key={unit.epc}
                className="flex justify-between gap-3 font-mono text-[11px] text-muted-foreground"
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
}: {
  boxes: readonly Koli[]
  loading: boolean
  sessionId: string | null
}) {
  const client = useQueryClient()
  const [openManifest, setOpenManifest] = useState<string | null>(null)

  const manifest = useQuery({
    queryKey: keys.koliManifest(openManifest ?? ""),
    queryFn: ({ signal }) => dc.koliManifest(openManifest as string, signal),
    enabled: openManifest !== null,
  })

  const seal = useMutation({
    mutationFn: (koliId: string) => dc.sealKoli(koliId),
    // A sealed box leaves the packing queue and joins the shipping one, and
    // its stock moves with it. Sealing used to leave the row saying "open".
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.koli() })
      void client.invalidateQueries({ queryKey: keys.packingSessions() })
      void client.invalidateQueries({ queryKey: ["dc", "packing-session"] })
      void client.invalidateQueries({ queryKey: keys.pools() })
    },
  })

  const claim = useMutation({
    mutationFn: (input: { koliId: string; sessionId: string }) =>
      dc.assignKoli(input.koliId, input.sessionId),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.koli() })
      void client.invalidateQueries({ queryKey: ["dc", "packing-session"] })
    },
  })

  // Printing changes nothing a screen reads — the sticker comes out of a
  // machine — so this is the one write here with nothing to invalidate.
  const label = useMutation({
    mutationFn: (koliId: string) => {
      const printer = loadPrinter()
      return dc.printKoliLabel(koliId, {
        printer_host: printer.host,
        printer_port: printer.port,
      })
    },
  })

  const pending = seal.isPending || claim.isPending || label.isPending

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
                disabled={pending}
                title={`Seal ${box.koli_number}`}
                description={
                  <>
                    The contents of this box become final. That is what makes
                    the packing list worth printing — and it cannot be undone by
                    opening the carton again.
                  </>
                }
                confirmLabel="Seal it"
                onConfirm={() => seal.mutate(box.koli_id)}
              />
            ) : (
              <Pill tone="good">sealed</Pill>
            )}
            <Button
              variant="outline"
              className="h-(--tap)"
              onClick={() =>
                setOpenManifest((current) =>
                  current === box.koli_id ? null : box.koli_id
                )
              }
            >
              {openManifest === box.koli_id ? "Hide" : "Manifest"}
            </Button>
            {box.sealed_at !== null && (
              <Button
                variant="outline"
                className="h-(--tap)"
                disabled={pending}
                // The sticker's ZPL comes back with the manifest, so the label
                // on the outside of the carton and the list of what is inside
                // it can never be rendered from two different reads.
                onClick={() => label.mutate(box.koli_id)}
              >
                Label
              </Button>
            )}
            {sessionId !== null && box.packing_session_id === null && (
              <Button
                variant="ghost"
                className="h-(--tap)"
                disabled={pending}
                onClick={() => claim.mutate({ koliId: box.koli_id, sessionId })}
              >
                Claim
              </Button>
            )}
          </div>

          {openManifest === box.koli_id && (
            <div className="flex flex-col gap-3 bg-muted/40 px-4 py-3 sm:flex-row">
              {manifest.data !== undefined && (
                <>
                  <div
                    className="shrink-0 [&_svg]:h-28 [&_svg]:w-28"
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
                          className="flex justify-between gap-3 font-mono text-[11px] text-muted-foreground"
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
                <p className="text-xs text-muted-foreground">
                  Reading the box…
                </p>
              )}
            </div>
          )}
        </div>
      ))}
      <Problem error={seal.error ?? claim.error ?? label.error} />
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
}: {
  destination: string
  actor: string
}) {
  const client = useQueryClient()
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<CaptureOutcome | null>(null)

  const outstanding = useQuery({
    queryKey: keys.outstanding(destination),
    queryFn: ({ signal }) => dc.outstandingFor(destination, signal),
  })

  const box = useQuery({
    queryKey: keys.packingBox(sessionId ?? ""),
    queryFn: ({ signal }) => dc.packingBox(sessionId as string, signal),
    enabled: sessionId !== null,
  })

  const openBox = useMutation({
    mutationFn: (target: { sku_code: string; target_qty: number }[]) =>
      dc.openPackingBox({
        destination_store_id: destination,
        target,
        actor_id: actor,
        note: null,
      }),
    onSuccess: (opened) => {
      setSessionId(opened.session.session_id)
      setOutcome(null)
      void client.invalidateQueries({ queryKey: keys.packingSessions() })
    },
  })

  const sweep = useMutation({
    mutationFn: (reader: string) =>
      dc.captureBox(sessionId as string, reader.trim()),
    onSuccess: (result) => {
      setOutcome(result)
      if (!result.matched) {
        // A sweep that disagreed changed nothing: the box is still open and
        // still wanting the same pieces, and the difference is on screen.
        return
      }
      setSessionId(null)
      readerForm.reset()
      void client.invalidateQueries({ queryKey: ["dc"] })
      void client.invalidateQueries({ queryKey: keys.pools() })
    },
  })

  const readerForm = useForm({
    defaultValues: { reader: "" },
    onSubmit: ({ value }) => {
      if (sessionId === null || value.reader.trim() === "") {
        return
      }
      sweep.mutate(value.reader)
    },
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
            <ScreenState>Nothing to target for this store yet.</ScreenState>
          )}
          {outstanding.data !== undefined && outstanding.data.length > 0 && (
            <TargetForm
              key={destination}
              lines={outstanding.data}
              pending={openBox.isPending}
              onOpen={(target) => openBox.mutate(target)}
            />
          )}
        </>
      ) : (
        <>
          {box.data?.target.map((line) => {
            const found = outcome?.lines.find(
              (swept) => swept.sku_code === line.sku_code
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

          <form
            className="flex flex-wrap gap-2 border-t px-4 py-3"
            onSubmit={(event) => {
              event.preventDefault()
              void readerForm.handleSubmit()
            }}
          >
            <readerForm.Field name="reader">
              {(field) => (
                <Input
                  value={field.state.value}
                  placeholder="Reader session id"
                  className="h-(--tap) min-w-40 flex-1 font-mono"
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
              )}
            </readerForm.Field>
            <readerForm.Subscribe
              selector={(state) => state.values.reader.trim() === ""}
            >
              {(empty) => (
                <Button
                  type="submit"
                  className="h-(--tap)"
                  disabled={sweep.isPending || empty}
                >
                  Sweep
                </Button>
              )}
            </readerForm.Subscribe>
            <Button
              type="button"
              variant="ghost"
              className="h-(--tap)"
              onClick={() => {
                setSessionId(null)
                setOutcome(null)
              }}
            >
              Leave it
            </Button>
          </form>
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
            <p className="mb-1 text-destructive">
              Not on this box&apos;s list:{" "}
              {outcome.unexpected.map((line) => line.sku_code).join(", ")} —
              wrong goods, caught before the lid closed rather than at the shop
              door.
            </p>
          )}
          {outcome.unknown_epcs.length > 0 && (
            <p className="text-muted-foreground">
              {outcome.unknown_epcs.length} tags this DC has never heard of.
            </p>
          )}
        </div>
      )}
      <Problem error={openBox.error ?? sweep.error} />
    </Panel>
  )
}

/// What the box is meant to hold, written down before anything goes in it.
///
/// One field per outstanding SKU, mounted from the store's own list — which is
/// why this is a component of its own: the fields cannot exist before the read
/// that says what they are.
function TargetForm({
  lines,
  pending,
  onOpen,
}: {
  lines: readonly OutstandingLine[]
  pending: boolean
  onOpen: (target: { sku_code: string; target_qty: number }[]) => void
}) {
  const form = useForm({
    defaultValues: {
      target: lines.map((line) => ({ sku_code: line.sku_code, quantity: "" })),
    },
    onSubmit: ({ value }) => {
      const wanted = value.target
        .map((line) => ({
          sku_code: line.sku_code,
          target_qty: Number(line.quantity),
        }))
        .filter(
          (line) => Number.isInteger(line.target_qty) && line.target_qty > 0
        )
      if (wanted.length === 0) {
        return
      }
      onOpen(wanted)
    },
  })

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        void form.handleSubmit()
      }}
    >
      {lines.map((line, index) => (
        <div
          key={line.sku_code}
          className="flex items-center gap-3 border-b px-4 py-2.5 last:border-b-0"
        >
          <RowText code={line.sku_code}>{line.outstanding} can go now</RowText>
          <form.Field name={`target[${index}].quantity`}>
            {(field) => (
              <Input
                value={field.state.value}
                inputMode="numeric"
                placeholder="0"
                className="h-(--tap) w-24 text-center font-mono"
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
              />
            )}
          </form.Field>
        </div>
      ))}
      <div className="border-t px-4 py-3">
        <Button
          type="submit"
          variant="secondary"
          className="h-(--tap) w-full"
          disabled={pending}
        >
          Open a box with this target
        </Button>
      </div>
    </form>
  )
}
