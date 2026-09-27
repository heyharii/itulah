import { ChevronRight } from "lucide-react"

import { ListTable, type ListColumn } from "@/components/ui/list-table"
import { Pill } from "@/components/ui/pill"
import { RecordSheet } from "@/components/ui/record-sheet"
import { Banner, ErrorState, LoadingState } from "@/components/ui/states"
import { count, moment } from "@/lib/format"
import { cn } from "@/lib/utils"
import {
  byTrouble,
  deliveryName,
  resultOf,
  useInboundDelivery,
  verdictOf,
} from "@/screens/stock/inbound"
import { Code, Fact, Facts } from "@/screens/stock/parts"
import { useRange } from "@/screens/stock/shared"
import type {
  CatalogRow,
  StoreInboundDelivery,
  StoreInboundLine,
  StoreInboundResult,
} from "@itulah/contract"

/// One delivery, opened over the list.
///
/// Two different sheets under one frame, because a delivery is two different
/// things to a shop depending on where it is:
///
///  - **in transit** it is a job — the facts somebody needs to find the koli
///    and the steps to count them on the handheld. What was packed is NOT here:
///    the count is blind, and the node does not send it.
///  - **received** it is a result — the totals, then every SKU with what was
///    packed against what was counted, the problems first, each one opening
///    onto the tags behind its missing and extra units.
///
/// The sheet follows the list rather than holding a copy: a delivery open in
/// transit turns into its result the moment the list's poll sees it received,
/// without anybody closing and reopening it.
export function DeliverySheet({
  delivery,
  open,
  onClose,
}: {
  delivery: StoreInboundDelivery
  open: boolean
  onClose: () => void
}) {
  const verdict = verdictOf(delivery)
  const received = delivery.status === "RECEIVED"
  return (
    <RecordSheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      id={delivery.delivery_id}
      title={deliveryName(delivery)}
      caption={
        received
          ? `Received ${moment(delivery.received_at)}${
              delivery.received_by === null ? "" : ` by ${delivery.received_by}`
            }`
          : `Departed ${moment(delivery.departed_at)} from ${delivery.source_site_id}`
      }
      badge={<Pill tone={verdict.tone}>{verdict.label}</Pill>}
      // A received delivery carries a five-column table; the job does not.
      width={received ? "wide" : "rail"}
    >
      {received ? (
        <Received delivery={delivery} />
      ) : (
        <InTransit delivery={delivery} />
      )}
    </RecordSheet>
  )
}

// ── In transit ──────────────────────────────────────────────────────────────

function InTransit({ delivery }: { delivery: StoreInboundDelivery }) {
  return (
    <>
      <DeliveryFacts delivery={delivery} />

      <section className="mt-7">
        <h3 className="text-card-title font-semibold text-ink">
          Receive it with the handheld
        </h3>
        <p className="mt-1 text-meta text-body">
          Once every koli is in the stockroom:
        </p>
        <ol className="mt-3.5 flex flex-col gap-3">
          <Step n={1}>
            Open the handheld and choose <Word>Receive</Word>.
          </Step>
          <Step n={2}>
            Choose this delivery — <Word>{deliveryName(delivery)}</Word>, from{" "}
            {delivery.source_site_id}.
          </Step>
          <Step n={3}>
            Open each koli and sweep it until the count stops climbing — all{" "}
            {count(delivery.koli_count)} of them before you finish.
          </Step>
          <Step n={4}>
            Press <Word>Finish</Word>. The result shows here within a quarter of
            a minute.
          </Step>
        </ol>
      </section>

      <p className="mt-7 rounded-inner bg-soft px-3.5 py-3 text-meta leading-relaxed text-body">
        How many were packed is not shown until the count is in. A count made
        against a number tends to find that number, and the point of sweeping is
        to find what actually arrived.
      </p>
    </>
  )
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-soft-2 text-meta font-semibold text-body tabular-nums">
        {n}
      </span>
      <span className="min-w-0 pt-0.5 text-cell leading-relaxed text-text">
        {children}
      </span>
    </li>
  )
}

/// A word on the handheld's own screen — a button or the name somebody picks.
function Word({ children }: { children: React.ReactNode }) {
  return <span className="font-medium text-ink">{children}</span>
}

// ── Received ────────────────────────────────────────────────────────────────

function Received({ delivery }: { delivery: StoreInboundDelivery }) {
  const detail = useInboundDelivery(delivery.delivery_id, true)
  const { bySku } = useRange()
  // The list's copy first — it is the one being polled — and the detail's when
  // the list has not caught up yet.
  const result =
    resultOf(delivery) ??
    (detail.data === undefined ? null : resultOf(detail.data.delivery))
  const lines = [...(detail.data?.lines ?? [])].sort(byTrouble)
  const skipped = detail.data?.skipped_epcs ?? []
  const troubled = lines.filter((line) => line.missing + line.extra > 0).length

  return (
    <>
      {result !== null && <Totals result={result} />}
      {result !== null && result.missing_units > 0 && (
        <Banner tone="bad" className="mt-3">
          {count(result.missing_units)}{" "}
          {result.missing_units === 1 ? "unit was" : "units were"} packed and
          not found in the sweep. Their tags are listed under each item below.
        </Banner>
      )}
      {result !== null &&
        result.missing_units === 0 &&
        result.extra_units > 0 && (
          <Banner tone="warn" className="mt-3">
            Everything packed arrived, and {count(result.extra_units)}{" "}
            {result.extra_units === 1 ? "unit" : "units"} more that were not on
            this delivery.
          </Banner>
        )}

      <DeliveryFacts delivery={delivery} className="mt-6" />

      <section className="mt-7">
        <div className="mb-2.5 flex items-baseline justify-between gap-3">
          <h3 className="text-card-title font-semibold text-ink">By item</h3>
          {lines.length > 0 && (
            <span className="text-meta text-mute tabular-nums">
              {count(lines.length)} {lines.length === 1 ? "SKU" : "SKUs"}
              {troubled > 0 &&
                ` · ${count(troubled)} with a difference, listed first`}
            </span>
          )}
        </div>
        <div className="overflow-hidden rounded-card border border-hairline">
          {detail.isPending ? (
            <LoadingState>Reading the count…</LoadingState>
          ) : detail.isError ? (
            <ErrorState
              error={detail.error}
              onRetry={() => void detail.refetch()}
            />
          ) : (
            <ListTable
              rows={lines}
              columns={lineColumns(bySku)}
              rowKey={(line) => line.sku_code}
              detail={(line) => <LineTags line={line} />}
              empty="The node holds no lines for this delivery."
            />
          )}
        </div>
      </section>

      {skipped.length > 0 && <Skipped epcs={skipped} />}
    </>
  )
}

/// What was packed against what was counted, as four figures. Missing and
/// extra keep their colour only while they are not zero — a grey zero is the
/// good news, and a green one would be a colour for nothing happening.
function Totals({ result }: { result: StoreInboundResult }) {
  const cells = [
    { label: "Expected", value: result.expected_units, tone: "text-ink" },
    { label: "Received", value: result.received_units, tone: "text-ink" },
    {
      label: "Missing",
      value: result.missing_units,
      tone: result.missing_units > 0 ? "text-bad-fg" : "text-mute",
    },
    {
      label: "Extra",
      value: result.extra_units,
      tone: result.extra_units > 0 ? "text-warn-fg" : "text-mute",
    },
  ]
  return (
    <dl className="grid grid-cols-4 overflow-hidden rounded-card border border-hairline">
      {cells.map((cell) => (
        <div
          key={cell.label}
          className="min-w-0 border-l border-hairline px-3 py-2.5 first:border-l-0 md:px-4"
        >
          <dt className="truncate text-meta text-body">{cell.label}</dt>
          <dd
            className={cn(
              "mt-1 truncate text-kpi font-semibold tabular-nums",
              cell.tone,
            )}
          >
            {count(cell.value)}
          </dd>
        </div>
      ))}
    </dl>
  )
}

/// The delivery's own facts — the same five in transit and received, so the
/// two sheets read as one record at two moments.
function DeliveryFacts({
  delivery,
  className,
}: {
  delivery: StoreInboundDelivery
  className?: string
}) {
  return (
    <Facts className={className}>
      <Fact term="From">{delivery.source_site_id}</Fact>
      <Fact term="Departed">{moment(delivery.departed_at)}</Fact>
      <Fact term="Koli">{count(delivery.koli_count)}</Fact>
      <Fact term="Surat jalan">
        {delivery.shipment_reference ?? (
          <span className="text-mute">None given</span>
        )}
      </Fact>
      {delivery.status === "RECEIVED" && (
        <Fact term="Received">
          {moment(delivery.received_at)}
          {delivery.received_by !== null && (
            <span className="block text-meta text-body">
              by {delivery.received_by}
            </span>
          )}
        </Fact>
      )}
      <Fact term="Delivery" wide>
        <Code>{delivery.delivery_id}</Code>
      </Fact>
    </Facts>
  )
}

/// The per-item columns. The four figures are the desk's; a phone gets the
/// difference as a pill and the two counts as one line.
function lineColumns(
  bySku: ReadonlyMap<string, CatalogRow>,
): readonly ListColumn<StoreInboundLine>[] {
  const figure = (value: number, tone?: string) => (
    <span className={cn("tabular-nums", value === 0 ? "text-mute" : tone)}>
      {count(value)}
    </span>
  )
  return [
    {
      id: "item",
      header: "Item",
      className: "max-w-[15rem]",
      cell: (line) => {
        const name = line.name ?? bySku.get(line.sku_code)?.name ?? null
        return (
          <span className="block min-w-0">
            <span className="block truncate font-medium text-ink">
              {name ?? "Not in this shop's book"}
            </span>
            <span className="block truncate font-mono text-id font-normal text-body">
              {line.sku_code}
            </span>
          </span>
        )
      },
    },
    {
      id: "expected",
      header: "Expected",
      align: "right",
      card: "hide",
      cell: (line) => figure(line.expected, "text-text"),
    },
    {
      id: "received",
      header: "Received",
      align: "right",
      card: "hide",
      cell: (line) => figure(line.received, "font-medium text-ink"),
    },
    {
      id: "missing",
      header: "Missing",
      align: "right",
      card: "hide",
      cell: (line) => figure(line.missing, "font-medium text-bad-fg"),
    },
    {
      id: "extra",
      header: "Extra",
      align: "right",
      card: "hide",
      cell: (line) => figure(line.extra, "font-medium text-warn-fg"),
    },
    {
      // The phone's: one pill for the line's difference. Hidden on a desk,
      // where the two coloured columns already say it.
      id: "difference",
      header: "",
      card: "status",
      className: "hidden",
      cell: (line) =>
        line.missing > 0 ? (
          <Pill tone="bad">{count(line.missing)} missing</Pill>
        ) : line.extra > 0 ? (
          <Pill tone="warn">{count(line.extra)} extra</Pill>
        ) : (
          <Pill tone="ok">Complete</Pill>
        ),
    },
    {
      id: "counts",
      header: "",
      card: "meta",
      className: "hidden",
      cell: (line) =>
        [
          `${count(line.received)} of ${count(line.expected)} received`,
          line.missing > 0 && line.extra > 0
            ? `${count(line.extra)} extra`
            : null,
        ]
          .filter(Boolean)
          .join(" · "),
    },
  ]
}

/// What opens under an item: the tags behind its difference. These are what
/// somebody reads out to the DC, or looks for on a rail.
function LineTags({ line }: { line: StoreInboundLine }) {
  if (line.missing_epcs.length === 0 && line.extra_epcs.length === 0) {
    return (
      <p className="pt-1 text-meta text-body">
        Every unit packed was counted, and nothing more.
      </p>
    )
  }
  return (
    <div className="flex flex-col gap-3.5 pt-1">
      {line.missing_epcs.length > 0 && (
        <TagList
          title="Missing — packed, not found"
          tone="text-bad-fg"
          epcs={line.missing_epcs}
        />
      )}
      {line.extra_epcs.length > 0 && (
        <TagList
          title="Extra — found, not packed"
          tone="text-warn-fg"
          epcs={line.extra_epcs}
        />
      )}
    </div>
  )
}

function TagList({
  title,
  tone,
  epcs,
}: {
  title: string
  tone: string
  epcs: readonly string[]
}) {
  return (
    <div>
      <div className={cn("mb-1.5 text-meta font-medium", tone)}>
        {title} · <span className="tabular-nums">{count(epcs.length)}</span>
      </div>
      <ul className="grid gap-x-4 gap-y-1 rounded-inner border border-hairline bg-canvas px-3 py-2 lg:grid-cols-2">
        {epcs.map((epc) => (
          <li key={epc} className="min-w-0">
            <Code>{epc}</Code>
          </li>
        ))}
      </ul>
    </div>
  )
}

/// Tags the handheld read and the node did not count either way. Folded,
/// because they are rarely what anybody came to the sheet for — but said,
/// because a number that quietly left some tags out is a number nobody can
/// check.
function Skipped({ epcs }: { epcs: readonly string[] }) {
  return (
    <details className="group mt-6 rounded-inner border border-hairline">
      <summary className="flex min-h-tap cursor-pointer list-none items-center gap-2.5 px-3.5 py-2.5 text-meta text-body [&::-webkit-details-marker]:hidden">
        <ChevronRight
          aria-hidden
          className="size-4 shrink-0 text-line-ico transition-transform duration-200 group-open:rotate-90"
        />
        <span className="min-w-0 flex-1">
          <span className="font-medium text-ink tabular-nums">
            {count(epcs.length)} {epcs.length === 1 ? "tag" : "tags"} skipped
          </span>{" "}
          — read by the handheld, counted as neither received nor extra. Usually
          a tag that is not one of ours.
        </span>
      </summary>
      <ul className="grid gap-x-4 gap-y-1 border-t border-hairline px-3.5 py-2.5 lg:grid-cols-2">
        {epcs.map((epc) => (
          <li key={epc} className="min-w-0">
            <Code>{epc}</Code>
          </li>
        ))}
      </ul>
    </details>
  )
}
