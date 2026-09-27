import { ArrowRight, Check } from "lucide-react"
import { useRef } from "react"

import { Button } from "@/components/ui/button"
import { Field, Input, Select } from "@/components/ui/field"
import { Pill } from "@/components/ui/pill"
import { RecordSheet } from "@/components/ui/record-sheet"
import { ScanField } from "@/components/ui/scan-field"
import { Banner } from "@/components/ui/states"
import { describe } from "@/lib/errors"
import { moment } from "@/lib/format"
import type { Mover } from "@/screens/stock/mover"
import { Code, Route, Thumb } from "@/screens/stock/parts"
import {
  LEDGER_LIMIT,
  PLACES,
  causeLabel,
  placeLabel,
  useRange,
  type PlaceCode,
} from "@/screens/stock/shared"

/// Moving a garment between the shop's three places — the On hand screen's
/// one write, as a task in a sheet.
///
/// A sheet rather than a panel on the page because the page is read and this
/// is worked: somebody walking a rail out of the warehouse opens it once, sets
/// the direction once, and then scans piece after piece while the pools behind
/// it catch up. It stays open after each move for exactly that reason, and
/// the pieces already moved gather at its foot so the person holding the rail
/// can see how far through it they are.
///
/// The state is `useMover` (`mover.ts`), held by the screen.

export function MoveSheet({ mover }: { mover: Mover }) {
  const { piece, from, to, move } = mover
  const { bySku } = useRange(mover.open)
  const product = piece === null ? undefined : bySku.get(piece.sku_code)
  const seen = piece === null ? null : mover.lastSeen(piece.epc)
  const ready =
    piece !== null && mover.site !== null && from !== to && !move.isPending

  // The scanner's field is the sheet's first control and takes the caret back
  // after every move, so the next tag lands without anybody touching glass.
  const body = useRef<HTMLDivElement>(null)
  const refocus = () =>
    requestAnimationFrame(() =>
      body.current?.querySelector<HTMLInputElement>("[data-scan]")?.focus(),
    )

  return (
    <RecordSheet
      open={mover.open}
      onOpenChange={mover.setOpen}
      title="Move stock"
      caption="Warehouse, floor or reject. One tag at a time."
      width="wide"
      footer={
        <div className="flex items-center gap-2 md:justify-end">
          {piece !== null && (
            <Button
              className="max-md:h-12"
              onClick={() => {
                mover.drop()
                refocus()
              }}
            >
              Drop it
            </Button>
          )}
          <Button
            variant="primary"
            className="max-md:h-12 max-md:flex-1"
            disabled={!ready}
            onClick={() => {
              mover.submit()
              refocus()
            }}
          >
            {move.isPending
              ? "Moving…"
              : `Move to ${placeLabel(to).toLowerCase()}`}
          </Button>
        </div>
      }
    >
      <div ref={body} className="flex flex-col gap-5">
        {mover.siteKnown && mover.site === null && (
          <Banner tone="bad">
            This till has not been told which shop it is standing in, so it
            cannot name the places to move between. The node reports no site;
            that is a setting on the machine behind the counter.
          </Banner>
        )}

        {/* The direction first, and it stays put between pieces: a rail is
            walked one way, and asking again for every garment on it is forty
            questions with one answer. */}
        <div className="flex items-end gap-2.5">
          <Field label="From" className="min-w-0 flex-1">
            <Select
              value={from}
              onChange={(next) => mover.setFrom(next as PlaceCode)}
            >
              {PLACES.map((place) => (
                <option key={place.code} value={place.code}>
                  {place.label}
                </option>
              ))}
            </Select>
          </Field>
          <ArrowRight className="mb-4 size-4 shrink-0 text-line-ico" />
          <Field label="To" className="min-w-0 flex-1">
            <Select
              value={to}
              onChange={(next) => mover.setTo(next as PlaceCode)}
            >
              {PLACES.map((place) => (
                <option key={place.code} value={place.code}>
                  {place.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <ScanField
          onScan={mover.scan}
          placeholder={
            piece === null ? "Scan the garment's tag…" : "Scan the next tag…"
          }
        />

        {mover.note !== null && <Banner tone="warn">{mover.note}</Banner>}
        {move.error !== null && (
          <Banner tone="bad">{describe(move.error)}</Banner>
        )}

        {piece === null ? (
          <p className="rounded-card border border-dashed border-hairline-2 px-4 py-8 text-center text-meta text-body">
            Scan a tag to load the piece. It moves{" "}
            <b className="font-medium text-ink">
              {placeLabel(from).toLowerCase()} → {placeLabel(to).toLowerCase()}
            </b>{" "}
            unless the ledger says it is somewhere else.
          </p>
        ) : (
          <div className="overflow-hidden rounded-card border border-hairline bg-canvas shadow-soft">
            <div className="flex gap-3.5 p-3.5">
              <Thumb sku={piece.sku_code} has={product?.has_image === true} />
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <span className="min-w-0 text-card-title font-semibold text-ink">
                    {product?.name ?? "Not in this shop's book"}
                  </span>
                  <Pill tone="info">Ready to move</Pill>
                </div>
                <div className="mt-1 font-mono text-id text-body">
                  {piece.sku_code}
                </div>
                <div className="mt-0.5">
                  <Code>{piece.epc}</Code>
                </div>
              </div>
            </div>
            <div className="border-t border-hairline bg-soft px-3.5 py-2.5 text-meta text-body">
              {seen === null ? (
                `Not in the newest ${LEDGER_LIMIT} movements. The node checks where it is when it moves.`
              ) : (
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span>Last in the ledger:</span>
                  <Route from={seen.from} to={seen.to} cause={seen.cause} />
                  <span className="text-mute">
                    {causeLabel(seen.cause)} · {moment(seen.occurred_at)}
                  </span>
                </span>
              )}
            </div>
          </div>
        )}

        {piece !== null && from === to && (
          <Banner tone="warn">
            A garment cannot be moved to where it already is. Pick where it is
            going.
          </Banner>
        )}

        {piece !== null && (
          <Field
            label="Why"
            hint="Written into the ledger beside the movement. The ledger is append-only — a mistake is corrected by another movement that says what it is correcting, never by editing this one."
          >
            <Input
              value={mover.reason}
              onChange={(event) => mover.setReason(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && ready) {
                  mover.submit()
                  refocus()
                }
              }}
              placeholder="e.g. Put out on the rail"
            />
          </Field>
        )}

        {mover.moved.length > 0 && (
          <section>
            <h3 className="mb-2 text-section font-semibold text-ink">
              Moved just now{" "}
              <span className="font-normal text-mute tabular-nums">
                · {mover.moved.length}
              </span>
            </h3>
            <ul className="overflow-hidden rounded-card border border-hairline">
              {mover.moved.map((one) => (
                <li
                  key={`${one.epc}-${one.at}`}
                  className="flex items-center gap-3 border-b border-hairline px-3.5 py-2.5 last:border-b-0"
                >
                  <Check className="size-4 shrink-0 text-ok-fg" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-cell text-ink">
                      {bySku.get(one.sku_code)?.name ?? one.sku_code}
                    </span>
                    <span className="block text-meta text-mute">
                      {placeLabel(one.from)} → {placeLabel(one.to)}
                    </span>
                  </span>
                  <span className="shrink-0 font-mono text-id text-mute">
                    …{one.epc.slice(-6)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </RecordSheet>
  )
}
