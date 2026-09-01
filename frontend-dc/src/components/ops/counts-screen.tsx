import { useRef, useState } from "react"

import {
  ConfirmButton,
  Panel,
  Problem,
  Row,
  RowNumber,
  RowText,
  ScanField,
} from "@/components/ops/parts"
import {
  Note,
  Pill,
  ScreenBody,
  ScreenHeader,
  ScreenState,
  Stat,
} from "@/components/shell"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { dc } from "@/lib/api"
import { clock, units, variance } from "@/lib/format"
import { keys } from "@/lib/queries"
import { useActor } from "@/lib/session"
import { idempotencyKey } from "@itulah/contract/client"
import type { EdgeOfficialCountLine } from "@itulah/contract"
import { useForm, useStore } from "@tanstack/react-form"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useVirtualizer } from "@tanstack/react-virtual"

/// Official counts: authored and activated at the centre, executed here.
///
/// A difference is not a fact until the count is submitted, and it does not
/// become an adjustment until the centre approves it. This screen therefore
/// records and submits, and has no button anywhere that writes stock.
export function CountsScreen() {
  const [countId, setCountId] = useState<string | null>(null)

  const counts = useQuery({
    queryKey: keys.officialCounts(),
    queryFn: ({ signal }) => dc.officialCounts(signal),
  })

  const open = (counts.data ?? []).filter(
    (count) => count.submitted_at === null
  )

  return (
    <>
      <ScreenHeader
        title="Official counts"
        subtitle={`${open.length} to execute · ${counts.data?.length ?? 0} on this node`}
      />
      <ScreenBody className="lg:grid lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)] lg:items-start">
        <Panel title="Sheets" meta={`${counts.data?.length ?? 0} total`}>
          {counts.isPending && <ScreenState>Reading the sheets…</ScreenState>}
          {counts.isError && (
            <ScreenState tone="problem">
              {(counts.error as Error).message}
            </ScreenState>
          )}
          {counts.data?.length === 0 && (
            <ScreenState>
              Nothing to count. Sheets appear here when head office activates
              one for a pool this DC owns.
            </ScreenState>
          )}
          {counts.data?.map((count) => (
            <Row
              key={count.count_id}
              selected={count.count_id === countId}
              onClick={() => setCountId(count.count_id)}
            >
              <RowText code={count.pool_id}>
                {count.kind.toLowerCase()} · {count.reason} · activated{" "}
                {clock(count.activated_at)}
              </RowText>
              <span className="shrink-0">
                <Pill
                  tone={
                    count.submitted_at === null
                      ? "warn"
                      : count.status === "CLOSED"
                        ? "good"
                        : "neutral"
                  }
                >
                  {count.status.toLowerCase().replace(/_/g, " ")}
                </Pill>
              </span>
            </Row>
          ))}
        </Panel>

        {countId === null ? (
          <Panel title="Sheet">
            <ScreenState>Choose a sheet to count.</ScreenState>
          </Panel>
        ) : (
          <CountSheet countId={countId} />
        )}
      </ScreenBody>
    </>
  )
}

function CountSheet({ countId }: { countId: string }) {
  const actor = useActor()
  const client = useQueryClient()

  const sheet = useQuery({
    queryKey: keys.officialCount(countId),
    queryFn: ({ signal }) => dc.officialCount(countId, signal),
  })

  const summary = sheet.data?.summary
  const lines = sheet.data?.lines ?? []
  const submitted = summary?.submitted_at !== null && summary !== undefined

  /// What this person has found so far, before any of it is sent.
  ///
  /// A form rather than a list in `useState` because a tag the sheet has never
  /// heard of arrives with no SKU and the person has to type one — the scanned
  /// rows really are fields being filled in, and the button below is only
  /// enabled once every one of them has been.
  const form = useForm({
    defaultValues: {
      entries: [] as {
        epc: string
        sku_code: string
        found_quantity: number
      }[],
    },
    onSubmit: ({ value }) => record.mutate(value.entries),
  })

  const entries = useStore(form.store, (state) => state.values.entries)

  const record = useMutation({
    mutationFn: (found: typeof entries) =>
      dc.recordCountEntries(countId, {
        entries: found,
        actor_id: actor,
        idempotency_key: idempotencyKey(),
      }),
    onSuccess: () => {
      form.reset()
      void client.invalidateQueries({ queryKey: keys.officialCount(countId) })
    },
  })

  const submit = useMutation({
    mutationFn: () =>
      dc.submitOfficialCount(countId, {
        actor_id: actor,
        idempotency_key: idempotencyKey(),
      }),
    // A submitted count changes the sheet, the queue behind it and the badge
    // in the nav, so the whole node's reads are re-asked rather than three
    // keys that would have to be kept in step with the server by hand.
    onSuccess: () => void client.invalidateQueries({ queryKey: ["dc"] }),
  })

  const scan = (raw: string) => {
    const epc = raw.trim().toUpperCase()
    if (epc === "" || entries.some((entry) => entry.epc === epc)) {
      return
    }
    // The sheet already knows which SKU each expected tag belongs to. A tag it
    // has never heard of is a real finding — it is entered with an empty SKU
    // so the person has to say what it is rather than the screen guessing.
    const known = lines.find((line) => line.epc === epc)
    form.pushFieldValue("entries", {
      epc,
      sku_code: known?.sku_code ?? "",
      found_quantity: 1,
    })
  }

  const ready =
    entries.length > 0 && entries.every((entry) => entry.sku_code !== "")

  return (
    <div className="flex flex-col gap-4">
      {summary !== undefined && (
        <Panel
          title={summary.pool_id}
          meta={<Pill>{summary.status.toLowerCase().replace(/_/g, " ")}</Pill>}
        >
          <div className="flex flex-wrap gap-x-8 gap-y-4 px-4 py-4">
            <Stat label="Expected" value={units(summary.expected)} />
            <Stat label="Found" value={units(summary.found)} />
            <Stat
              label="Short"
              value={units(summary.shortage_epcs)}
              tone={summary.shortage_epcs > 0 ? "bad" : undefined}
            />
            <Stat
              label="Over"
              value={units(summary.gain_epcs)}
              tone={summary.gain_epcs > 0 ? "warn" : undefined}
            />
            <Stat
              label="Difference"
              value={variance(summary.found - summary.expected)}
            />
          </div>
        </Panel>
      )}

      {!submitted && (
        <Panel
          title="Count"
          meta={
            entries.length === 0
              ? "nothing scanned"
              : `${entries.length} scanned`
          }
        >
          <ScanField placeholder="Scan an EPC" action="Add" onSubmit={scan} />

          {entries.map((entry, index) => (
            <div
              key={entry.epc}
              className="flex flex-wrap items-center gap-3 border-b px-4 py-2.5 last:border-b-0"
            >
              <RowText code={entry.epc}>
                {entry.sku_code === ""
                  ? "not on this sheet — say what it is"
                  : "on the sheet"}
              </RowText>
              {entry.sku_code === "" ? (
                <form.Field name={`entries[${index}].sku_code`}>
                  {(field) => (
                    <Input
                      placeholder="SKU"
                      className="h-(--tap) w-40 font-mono"
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(event) =>
                        field.handleChange(event.target.value.trim())
                      }
                    />
                  )}
                </form.Field>
              ) : (
                <span className="font-mono text-xs">{entry.sku_code}</span>
              )}
              <Button
                variant="ghost"
                className="h-(--tap)"
                onClick={() => form.removeFieldValue("entries", index)}
              >
                Remove
              </Button>
            </div>
          ))}

          {entries.length > 0 && (
            <div className="border-t px-4 py-3">
              <Button
                className="h-(--tap) w-full"
                disabled={record.isPending || !ready}
                onClick={() => void form.handleSubmit()}
              >
                Record {entries.length} found
              </Button>
            </div>
          )}
          <Problem error={record.error} />
        </Panel>
      )}

      <Panel title="The sheet" meta={`${lines.length} lines`}>
        {lines.length === 0 ? (
          <ScreenState>Nothing recorded against this sheet yet.</ScreenState>
        ) : (
          <SheetLines lines={lines} />
        )}
      </Panel>

      {!submitted && (
        <Panel title="Submit">
          <div className="flex flex-col gap-3 px-4 py-4">
            <p className="text-xs text-muted-foreground">
              Submitting closes the counting and sends the result to head
              office. What happens to the difference is decided there.
            </p>
            <ConfirmButton
              label="Submit this count"
              className="h-(--tap)"
              disabled={submit.isPending}
              title="Submit the count"
              description={
                <>
                  The counting stops here and the sheet goes to head office as
                  it stands. A difference becomes an adjustment only once
                  somebody there approves it — nothing on this node writes that.
                </>
              }
              confirmLabel="Submit"
              onConfirm={() => submit.mutate()}
            />
            <Problem error={submit.error} />
          </div>
        </Panel>
      )}

      <Note>
        A count is executed at the edge and approved at the centre, and those
        are two different people&apos;s jobs on purpose. This node can say what
        it found; it cannot decide what that means.
      </Note>
    </div>
  )
}

/// One row per tag the sheet expects, which for a warehouse pool is thousands.
///
/// Virtualised, and this is the list that made it worth doing: a full count of
/// the racks lists every EPC in them, and a handheld asked to lay out that many
/// rows stops responding to the scanner while it does.
function SheetLines({ lines }: { lines: readonly EdgeOfficialCountLine[] }) {
  const scroller = useRef<HTMLDivElement>(null)

  const rows = useVirtualizer({
    count: lines.length,
    getScrollElement: () => scroller.current,
    // The tap height these rows are built to, which is what they measure when
    // nothing has wrapped. Rows that differ are measured after they mount.
    estimateSize: () => 56,
    overscan: 8,
  })

  return (
    <div ref={scroller} className="max-h-[28rem] overflow-y-auto">
      <div className="relative w-full" style={{ height: rows.getTotalSize() }}>
        {rows.getVirtualItems().map((item) => {
          const line = lines[item.index]
          return (
            <div
              key={line.epc}
              ref={rows.measureElement}
              data-index={item.index}
              className="absolute top-0 left-0 w-full"
              style={{ transform: `translateY(${item.start}px)` }}
            >
              <Row>
                <RowText code={line.epc}>{line.sku_code}</RowText>
                <RowNumber
                  value={units(line.expected_quantity)}
                  label="expected"
                  tone="muted"
                />
                <RowNumber
                  value={units(line.found_quantity)}
                  label="found"
                  tone={line.adjustment_quantity !== 0 ? "bad" : undefined}
                />
              </Row>
            </div>
          )
        })}
      </div>
    </div>
  )
}
