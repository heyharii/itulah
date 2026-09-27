import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { FileText, Package, Plus } from "lucide-react"
import { useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { AppLink } from "@/components/ui/app-link"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { MiniTable } from "@/components/ui/rows"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { StopPair } from "@/components/ui/stop-pair"
import { Banner, EmptyState, Problem } from "@/components/ui/states"
import { dc } from "@/lib/api"
import { clock, count, label, positionTone } from "@/lib/format"
import { keys } from "@/lib/operations/keys"
import { queryState } from "@/lib/query-state"
import {
  advanceEach,
  type Progress,
} from "@/screens/operations/despatch/progress"
import { useEdgeActor } from "@/lib/edge-session"
import { useEdgeNodeIdentity } from "@/lib/edge-session"
import { useSheet } from "@/lib/sheets"
import { idempotencyKey } from "@itulah/contract/client"

/// Consignments: sealed cartons gathered into a surat jalan.
///
/// Two things happen when one is built, and they are separate in the server.
/// `POST /dc/shipments` writes the **document** — who is carrying what — and
/// touches no stock. `POST /dc/koli/{id}/shipment` moves each carton's stock
/// from `outbound.packed` to `outbound.shipment`, one request each. This
/// screen does both, in that order, and says honestly when a carton did not
/// follow the paperwork.
export function Consignments() {
  const actor = useEdgeActor()
  const client = useQueryClient()
  const shipment = useSheet("shipment")
  const composing = useSheet("new-shipment")
  /// Which cartons are being gathered. Genuinely transient — a half-built
  /// consignment is not a record anybody links to, and a selection that
  /// survived a reload would be a consignment somebody half-remembers
  /// choosing.
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set())
  const [progress, setProgress] = useState<Progress | null>(null)

  // Sealed and unclaimed. An open box is still being filled and a claimed one
  // already belongs to a consignment, so neither is a choice here.
  const loose = useQuery({
    queryKey: keys.koli({ ready: true, unassigned: true }),
    queryFn: ({ signal }) => dc.koli({ ready: true, unassigned: true }, signal),
  })

  const shipments = useQuery({
    queryKey: keys.shipments(),
    queryFn: ({ signal }) => dc.shipments({}, signal),
  })

  const build = useMutation({
    mutationFn: async () => {
      const koliIds = [...chosen]
      const consignment = await dc.createShipment({
        koli_ids: koliIds,
        actor_id: actor,
      })
      // The document exists; now the goods. The consignment number is what the
      // ledger records as the reference, so the two can be read together
      // afterwards.
      return advanceEach(koliIds, "staged for the consignment", (koliId) =>
        dc.koliToShipment(koliId, {
          shipment_reference: consignment.shipment_number,
          actor_id: actor,
          // One carton, one movement group. Applied twice the second attempt
          // moves stock out of a pool it is no longer in.
          idempotency_key: idempotencyKey(),
        })
      )
    },
    onSuccess: (result) => {
      setProgress(result)
      setChosen(new Set())
      composing.close()
      // Every list on this station is a different view of the same two
      // things — the documents and the pools — so they are re-read together
      // rather than one key at a time.
      void client.invalidateQueries({ queryKey: keys.dc.all })
      void client.invalidateQueries({ queryKey: keys.pools() })
    },
  })

  const boxes = loose.data ?? []
  const rows = shipments.data ?? []
  const unassigned = rows.filter((row) => row.dispatch_id === null)

  return (
    <PageContent>
      <PageHeader
        crumb="Despatch"
        title="Shipments"
        sub="Sealed cartons become one surat jalan — and the stock follows it."
        actions={
          <Button
            variant="primary"
            onClick={() => composing.open(true)}
            disabled={boxes.length === 0}
          >
            <Plus />
            New shipment
          </Button>
        }
      />

      <KpiStrip className="grid-cols-2 xl:grid-cols-4">
        <Kpi
          label="Loose cartons"
          value={count(boxes.length)}
          delta="sealed, unclaimed"
          tone={boxes.length > 0 ? "down" : "flat"}
        />
        <Kpi label="Consignments" value={count(rows.length)} />
        <Kpi
          label="Waiting for a truck"
          value={count(unassigned.length)}
          delta="on the dock"
        />
        <Kpi
          label="Pieces consigned"
          value={count(rows.reduce((total, row) => total + row.unit_count, 0))}
        />
      </KpiStrip>

      {progress !== null && progress.failed.length > 0 && (
        <Banner
          tone="bad"
          className="mb-[1.125rem]"
          onDismiss={() => setProgress(null)}
        >
          {progress.message}
          {" Try those cartons again from the list — the safe retry is the step they failed at."}
        </Banner>
      )}

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Shipments</CardTitle>
          <span className="text-[0.875rem] text-mute">
            click one for its surat jalan
          </span>
        </CardHeader>
        {queryState(shipments, {
          loading: "Reading the consignments…",
          render: () =>
            rows.length === 0 ? (
              <EmptyState
                action={
                  <Button
                    variant="soft"
                    onClick={() => composing.open(true)}
                    disabled={boxes.length === 0}
                  >
                    New shipment
                  </Button>
                }
              >
                {boxes.length === 0
                  ? "Nothing has been consigned, and no carton is loose."
                  : `${count(boxes.length)} sealed cartons are on the dock with no consignment.`}
              </EmptyState>
            ) : (
              <div className="border-t border-hairline">
                {rows.map((row) => (
                  <button
                    key={row.shipment_id}
                    type="button"
                    onClick={() => shipment.open(row.shipment_id)}
                    className={`flex min-h-tap w-full items-center gap-3 border-b border-hairline px-4 py-2.5 text-left transition-colors last:border-b-0 ${
                      row.shipment_id === shipment.value
                        ? "bg-accent-bg"
                        : "hover:bg-soft"
                    }`}
                  >
                    <span className="grid size-[1.6875rem] shrink-0 place-items-center rounded-inner border border-hairline-2 bg-canvas text-body">
                      <FileText className="size-[0.9375rem]" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-mono text-id text-ink">
                        {row.shipment_number}
                      </span>
                      <span className="block truncate text-[0.875rem] text-mute">
                        {row.destination_store_id} · {count(row.koli_count)}{" "}
                        cartons · {count(row.unit_count)} pieces
                      </span>
                    </span>
                    <Pill tone={positionTone(row.position)}>
                      {label(row.position)}
                    </Pill>
                  </button>
                ))}
              </div>
            ),
        })}
      </Card>

      {/* The cartons are chosen in a sheet rather than in a column beside the
          list, because building a consignment is a TASK and the list is a
          record. A permanent half-screen chooser is half a screen of work
          nobody is doing most of the time. */}
      <Sheet
        open={composing.value === true}
        onOpenChange={(next) => {
          if (!next) {
            composing.close()
            setChosen(new Set())
            build.reset()
          }
        }}
        width="wide"
        title="New shipment"
        footer={
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="text-[0.875rem] text-mute">
              {chosen.size === 0
                ? "Tick the cartons going on it"
                : `${count(chosen.size)} of ${count(boxes.length)} cartons`}
            </span>
            <div className="flex-1" />
            <Button
              variant="primary"
              disabled={chosen.size === 0 || build.isPending}
              onClick={() => build.mutate()}
            >
              {build.isPending ? "Building…" : "Create shipment"}
            </Button>
          </div>
        }
      >
        <p className="text-[0.875rem] text-body">
          Sealed cartons become one surat jalan — and the stock follows it. One
          shop per consignment: choosing cartons for two shops is refused by the
          node rather than silently split.
        </p>

        {queryState(loose, {
          loading: "Reading the dock…",
          render: () =>
            boxes.length === 0 ? (
              <EmptyState
                action={
                  <AppLink to="/operations/packing" variant="soft">
                    Go and pack one
                  </AppLink>
                }
              >
                Nothing loose. Every sealed carton belongs to a consignment.
              </EmptyState>
            ) : (
              <div className="mt-3 overflow-hidden rounded-inner border border-hairline">
                {boxes.map((box) => {
                  const picked = chosen.has(box.koli_id)
                  return (
                    <button
                      key={box.koli_id}
                      type="button"
                      onClick={() =>
                        setChosen((current) => {
                          const next = new Set(current)
                          if (next.has(box.koli_id)) next.delete(box.koli_id)
                          else next.add(box.koli_id)
                          return next
                        })
                      }
                      className={`flex min-h-tap w-full items-center gap-3 border-b border-hairline px-4 py-2.5 text-left transition-colors last:border-b-0 ${
                        picked ? "bg-accent-bg" : "hover:bg-soft"
                      }`}
                    >
                      <span className="grid size-[1.6875rem] shrink-0 place-items-center rounded-inner border border-hairline-2 bg-canvas text-body">
                        <Package className="size-[0.9375rem]" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-mono text-id text-ink">
                          {box.koli_number}
                        </span>
                        <span className="block truncate text-[0.875rem] text-mute">
                          {box.destination_store_id} · sealed{" "}
                          {clock(box.sealed_at)}
                        </span>
                      </span>
                      <span className="shrink-0 text-[0.875rem] text-body tabular-nums">
                        {count(box.unit_count)}
                      </span>
                    </button>
                  )
                })}
              </div>
            ),
        })}

        <Problem error={build.error} className="mt-3" />
      </Sheet>

      <ShipmentSheet id={shipment.value ?? null} onClose={shipment.close} />
    </PageContent>
  )
}

/// The surat jalan, with the QR a shop scans to open the whole consignment at
/// once rather than one carton at a time.
function ShipmentSheet({
  id,
  onClose,
}: {
  id: string | null
  onClose: () => void
}) {
  const where = useEdgeNodeIdentity()
  const detail = useQuery({
    queryKey: keys.shipment(id ?? ""),
    queryFn: ({ signal }) => dc.shipment(id!, signal),
    enabled: id !== null,
  })

  return (
    <Sheet
      open={id !== null}
      onOpenChange={(open) => !open && onClose()}
      id={detail.data?.shipment.shipment_number}
      title={detail.data?.shipment.destination_store_id ?? "Consignment"}
    >
      {queryState(detail, {
        loading: "Reading the consignment…",
        render: (record) => (
          <div className="flex flex-col gap-5">
            <div>
              <Pill tone={positionTone(record.shipment.position)}>
                {label(record.shipment.position)}
              </Pill>
            </div>

            <StopPair
              from={{
                place: where.data?.site_id ?? "This DC",
                detail: `${count(record.shipment.koli_count)} cartons · ${count(record.shipment.unit_count)} pieces`,
              }}
              to={{
                place: record.shipment.destination_store_id,
                detail:
                  record.shipment.dispatch_id === null
                    ? "no truck yet — still on the dock"
                    : "on a truck run",
                done: record.shipment.position === "IN_TRANSIT",
              }}
            />

            <Facts>
              <Fact term="Cartons">{count(record.shipment.koli_count)}</Fact>
              <Fact term="Pieces">{count(record.shipment.unit_count)}</Fact>
              <Fact term="Truck run">
                {record.shipment.dispatch_id === null ? "none" : "assigned"}
              </Fact>
              <Fact term="Destination">
                {record.shipment.destination_store_id}
              </Fact>
            </Facts>

            <div className="flex items-center gap-4 rounded-inner border border-hairline bg-soft p-3.5">
              <div
                className="shrink-0 [&_svg]:size-24"
                aria-label={`QR for ${record.qr_payload}`}
                dangerouslySetInnerHTML={{ __html: record.qr_svg }}
              />
              <div className="min-w-0">
                <p className="font-mono text-id text-ink">
                  {record.qr_payload}
                </p>
                <p className="mt-1 text-[0.875rem] text-mute">
                  Scanned at the shop to open the whole consignment at once,
                  rather than one carton at a time.
                </p>
              </div>
            </div>

            <div>
              <h4 className="mb-2 text-card-title font-semibold text-ink">
                Cartons on it
              </h4>
              <MiniTable head={["Carton", "Pieces", "Lines"]}>
                {record.koli.map((manifest) => (
                  <tr
                    key={manifest.koli.koli_id}
                    className="border-t border-hairline"
                  >
                    <td className="py-2 pr-2">
                      <AppLink
                        to="/operations/packing"
                        sheet={{ key: "koli", value: manifest.koli.koli_id }}
                        className="font-mono text-[0.875rem] text-ink underline underline-offset-2"
                      >
                        {manifest.koli.koli_number}
                      </AppLink>
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {count(manifest.koli.unit_count)}
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {count(manifest.lines.length)}
                    </td>
                  </tr>
                ))}
              </MiniTable>
            </div>

            <AppLink to="/operations/despatch/trucks" variant="soft">
              Put it on a truck
            </AppLink>
          </div>
        ),
      })}
    </Sheet>
  )
}
