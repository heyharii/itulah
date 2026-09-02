import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Package, Printer } from "lucide-react"

import { PageContent } from "@/components/shell/app-shell"
import { AppLink } from "@/components/ui/app-link"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { ConfirmButton } from "@/components/ui/dialog"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import {
  RecordActions,
  RecordBody,
  RecordCard,
  RecordHead,
} from "@/components/ui/record-card"
import { MiniTable } from "@/components/ui/rows"
import { Segmented } from "@/components/ui/segmented"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { EmptyState, Problem } from "@/components/ui/states"
import { dc } from "@/lib/api"
import { clock, count, label, positionTone } from "@/lib/format"
import { loadPrinter } from "@/lib/printer"
import { keys } from "@/lib/queries/keys"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"
import type { Koli } from "@itulah/contract"

/// The cartons on this floor.
///
/// A box's **position is derived, never stored** — worked out from where it
/// is, so a carton cannot claim to be on a truck it was never loaded onto.
/// That is why the position pill here is trusted enough to act on, and why
/// nothing on this screen lets anybody set one.
///
/// Sealing is what makes the contents final, and it is what makes the packing
/// list worth printing. It cannot be undone by opening the carton again, so it
/// is behind a question.
export function Boxes() {
  const koli = useSheet("koli")
  const slice = useSheet("slice")
  const packRound = useSheet("pack")

  const boxes = useQuery({
    queryKey: keys.koli(),
    queryFn: ({ signal }) => dc.koli({}, signal),
  })

  const all = boxes.data ?? []
  const open = all.filter((box) => box.sealed_at === null)
  const loose = all.filter(
    (box) => box.sealed_at !== null && box.shipment_id === null
  )
  const shown =
    slice.value === "open" ? open : slice.value === "unassigned" ? loose : all

  return (
    <PageContent>
      <PageHeader
        crumb="Packing"
        title="Boxes"
        sub="Where a piece stops being the warehouse's and starts being a shop's."
        actions={
          <Segmented
            value={slice.value ?? "all"}
            onChange={(value) => slice.replace(value)}
            options={[
              { value: "all", label: "All" },
              { value: "open", label: "Open" },
              { value: "unassigned", label: "Loose" },
            ]}
          />
        }
      />

      <KpiStrip className="grid-cols-2 xl:grid-cols-4">
        <Kpi label="On the floor" value={count(all.length)} />
        <Kpi
          label="Still open"
          value={count(open.length)}
          delta="fillable"
          tone={open.length > 0 ? "flat" : undefined}
        />
        <Kpi
          label="Sealed and loose"
          value={count(loose.length)}
          delta="waiting for a consignment"
          tone={loose.length > 0 ? "down" : "flat"}
        />
        <Kpi
          label="Pieces boxed"
          value={count(all.reduce((total, box) => total + box.unit_count, 0))}
        />
      </KpiStrip>

      {queryState(boxes, {
        loading: "Reading the floor…",
        render: () =>
          shown.length === 0 ? (
            <Card>
              <EmptyState
                action={
                  <AppLink to="/packing/fill" variant="soft">
                    Fill a box
                  </AppLink>
                }
              >
                {all.length === 0
                  ? "No boxes yet. Scan pieces into one on the fill screen."
                  : "Nothing in this slice. Every box is somewhere else in the flow."}
              </EmptyState>
            </Card>
          ) : (
            <div className="flex flex-col gap-3">
              {shown.map((box) => (
                <BoxCard
                  key={box.koli_id}
                  box={box}
                  roundId={packRound.value ?? null}
                  onOpen={() => koli.open(box.koli_id)}
                />
              ))}
            </div>
          ),
      })}

      <ManifestSheet id={koli.value ?? null} onClose={koli.close} />
    </PageContent>
  )
}

function BoxCard({
  box,
  roundId,
  onOpen,
}: {
  box: Koli
  roundId: string | null
  onOpen: () => void
}) {
  const client = useQueryClient()

  const seal = useMutation({
    mutationFn: () => dc.sealKoli(box.koli_id),
    onSuccess: () => {
      // A sealed box leaves the packing queue and joins the shipping one, and
      // its stock moves with it. Sealing used to leave the row saying "open".
      void client.invalidateQueries({ queryKey: ["dc", "koli"] })
      void client.invalidateQueries({ queryKey: ["dc", "packing-session"] })
      void client.invalidateQueries({
        queryKey: keys.packRounds({ ready: true }),
      })
      void client.invalidateQueries({ queryKey: keys.pools() })
    },
  })

  const claim = useMutation({
    mutationFn: () => dc.assignKoli(box.koli_id, roundId!),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["dc", "koli"] })
      void client.invalidateQueries({ queryKey: ["dc", "packing-session"] })
    },
  })

  // Printing changes nothing a screen reads — the sticker comes out of a
  // machine — so it is the one write here with nothing to invalidate.
  const sticker = useMutation({
    mutationFn: () => {
      const printer = loadPrinter()
      return dc.printKoliLabel(box.koli_id, {
        printer_host: printer.host,
        printer_port: printer.port,
        // The reel in the machine, not the house default. The carton sticker
        // was the one label that ignored the bench entirely — it rendered at
        // 58 × 40 whatever was loaded, which is discovered at the loading bay.
        label_width_mm: printer.widthMm,
        label_height_mm: printer.heightMm,
      })
    },
  })

  return (
    <RecordCard>
      <RecordHead
        tile={<Package />}
        id={box.koli_number}
        title={`${box.destination_store_id} · ${count(box.unit_count)} pieces`}
        status={
          <Pill tone={positionTone(box.position)}>{label(box.position)}</Pill>
        }
        onClick={onOpen}
      />
      <RecordBody>
        <p className="text-[0.71875rem] text-mute">
          {box.sealed_at === null
            ? "Still open — more can go in."
            : `Sealed ${clock(box.sealed_at)}${box.sealed_by === null ? "" : ` by ${box.sealed_by}`}.`}
          {box.shipment_id === null
            ? " Not in a consignment yet."
            : " In a consignment."}
        </p>
      </RecordBody>
      <RecordActions>
        {box.sealed_at === null ? (
          <ConfirmButton
            label="Seal"
            title={`Seal ${box.koli_number}`}
            description={
              <>
                The contents of this box become final. That is what makes the
                packing list worth printing — and it cannot be undone by opening
                the carton again.
              </>
            }
            confirmLabel="Seal it"
            variant="dark"
            pending={seal.isPending}
            onConfirm={() => seal.mutate()}
          />
        ) : (
          <Button
            variant="ghost"
            disabled={sticker.isPending}
            onClick={() => sticker.mutate()}
          >
            <Printer />
            {sticker.isPending ? "Sending…" : "Print the sticker"}
          </Button>
        )}
        <Button variant="quiet" onClick={onOpen}>
          What is in it
        </Button>
        {roundId !== null && box.packing_session_id === null && (
          <Button
            variant="quiet"
            disabled={claim.isPending}
            onClick={() => claim.mutate()}
          >
            Claim for my round
          </Button>
        )}
        <Problem error={seal.error ?? claim.error ?? sticker.error} />
      </RecordActions>
    </RecordCard>
  )
}

/// The packing list: what is in this box, its QR, and the sticker's ZPL — all
/// three from one answer, so they cannot disagree.
function ManifestSheet({
  id,
  onClose,
}: {
  id: string | null
  onClose: () => void
}) {
  const manifest = useQuery({
    queryKey: keys.manifest(id ?? ""),
    queryFn: ({ signal }) => dc.koliManifest(id!, signal),
    enabled: id !== null,
  })

  return (
    <Sheet
      open={id !== null}
      onOpenChange={(open) => !open && onClose()}
      id={manifest.data?.koli.koli_number}
      title={manifest.data?.koli.destination_store_id ?? "Carton"}
    >
      {queryState(manifest, {
        loading: "Reading the box…",
        render: (record) => (
          <div className="flex flex-col gap-5">
            <div>
              <Pill tone={positionTone(record.koli.position)}>
                {label(record.koli.position)}
              </Pill>
            </div>

            <Facts>
              <Fact term="Destination">{record.koli.destination_store_id}</Fact>
              <Fact term="Pieces">{count(record.koli.unit_count)}</Fact>
              <Fact term="Sealed">
                {record.koli.sealed_at === null
                  ? "still open"
                  : clock(record.koli.sealed_at)}
              </Fact>
              <Fact term="Sealed by">{record.koli.sealed_by ?? "—"}</Fact>
            </Facts>

            {/* The QR the shop's phone reads. Rendered server-side so the
                sticker's barcode and this cannot disagree about the payload. */}
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
                <p className="mt-1 text-[0.71875rem] text-mute">
                  The sticker's Code 128 is what a laser scanner reads; this is
                  what a phone camera reads. Both come from this one answer.
                </p>
              </div>
            </div>

            <div>
              <h4 className="mb-2 text-card-title font-semibold text-ink">
                What is in it
              </h4>
              <MiniTable head={["SKU", "Pieces", "Fulfils"]}>
                {record.lines.map((line) => (
                  <tr
                    key={`${line.sku_code}-${line.allotment_line_id}`}
                    className="border-t border-hairline"
                  >
                    <td className="py-2 pr-2 font-mono text-[0.71875rem] text-ink">
                      {line.sku_code}
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {count(line.quantity)}
                    </td>
                    <td className="py-2 text-right">
                      {/* No dead ends: the allotment line this box fulfils is
                          one click away, and that screen answers "has it
                          actually left". */}
                      <AppLink
                        to="/picking/lines"
                        sheet={{
                          key: "allotment",
                          value: line.allotment_line_id,
                        }}
                        className="font-mono text-[0.65625rem] text-info-fg underline underline-offset-2"
                      >
                        {line.allotment_line_id.slice(0, 8)}…
                      </AppLink>
                    </td>
                  </tr>
                ))}
              </MiniTable>
            </div>
          </div>
        ),
      })}
    </Sheet>
  )
}
