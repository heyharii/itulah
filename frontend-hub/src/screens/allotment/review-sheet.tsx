import { idempotencyKey } from "@itulah/contract/client"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { useShopName } from "@/components/operations/outbound-papers"
import { Button } from "@/components/ui/button"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { Sheet } from "@/components/ui/sheet"
import { SheetFooter } from "@/components/ui/sheet-footer"
import { count, dayTime, sku as skuNumber } from "@/lib/format"
import { useNameOfLogin } from "@/lib/queries/hr-employees"
import { useCatalogueIdentity } from "@/lib/operations/catalogue"
import { keys as operationsKeys } from "@/lib/operations/keys"
import {
  allotmentDetail,
  closeShortAllotment,
  inventoryKeys,
  type AllotmentLine,
} from "@/lib/queries/inventory"
import { catalogueVocabulary, procurementKeys } from "@/lib/queries/procurement"
import { toast } from "@/lib/toast"
import { termLabel } from "@/screens/procurement/shared"
import { stagesOf, targetOf } from "@/screens/allotment/amend-data"
import {
  continueShortPicks,
  linesFor,
  type DcReview,
} from "@/screens/allotment/review-data"
import {
  ReviewMatrix,
  type ReviewArticle,
} from "@/screens/allotment/review-matrix"

/// **MD's review of a pick that could not go on** (allotment-review-flow.html,
/// At the DC, owner 18 Oct 2026). Only Pick has Cannot continue.
///
/// What is wrong is said, not left to be worked out (version P, owner 18 Oct:
/// "orang hanya perlu tau isunya"): one plain line per colour · size —
/// "1 Light Blue · L was not picked for C003 Purbalingga · Item not found in
/// the pool". Under it the New allotment matrix, read only: what MD asked
/// for and what the picker got.
///
/// MD answers with the foot: **Continue** — the picker tries again — or
/// **Accept short**: the store gets what was picked, the rest of the line is
/// closed short (the existing Close short).

const pcs = (n: number) => `${count(n)} ${n === 1 ? "pc" : "pcs"}`

export function DcReviewSheet({
  review,
  open,
  onOpenChange,
}: {
  /// Kept after the sheet closes, so it slides out with what it showed.
  review: DcReview | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const client = useQueryClient()
  const shop = useShopName()
  const personOf = useNameOfLogin()
  // The division and tags the matrix heads an article with, as New
  // allotment has them.
  const identities = useCatalogueIdentity()
  const vocabulary = useQuery({
    queryKey: procurementKeys.vocabulary(),
    queryFn: ({ signal }) => catalogueVocabulary(signal),
    staleTime: 30 * 60 * 1000,
  })
  const detail = useQuery({
    queryKey: inventoryKeys.allotment(review?.allotment_id ?? ""),
    queryFn: ({ signal }) =>
      allotmentDetail(review?.allotment_id ?? "", signal),
    enabled: review !== null,
    staleTime: 30_000,
  })
  const lines = detail.data?.lines
  const matched = review === null ? [] : linesFor(review, lines)

  /// Everything a decision changes: the board's short picks, this allotment,
  /// the lists it sits on.
  const settle = () => {
    void client.invalidateQueries({ queryKey: operationsKeys.shortPicks() })
    void client.invalidateQueries({ queryKey: inventoryKeys.allotments() })
  }

  const continuing = useMutation({
    mutationFn: () =>
      continueShortPicks(
        review === null ? [] : review.lines.flatMap((line) => line.reportIds)
      ),
    onSuccess: () => {
      settle()
      toast.success(`${review?.allotment_number} continues`, {
        description: `${pcs(review?.short ?? 0)} back on the picklist · ${shop(review?.store_id ?? "")}`,
      })
      onOpenChange(false)
    },
  })

  const accepting = useMutation({
    mutationFn: () => {
      if (review === null) return Promise.resolve(null)
      const close = matched
        .filter(({ allotted }) => allotted !== undefined)
        .map(({ line, allotted }) => ({
          allotment_line_id: (allotted as AllotmentLine).id,
          quantity: line.short,
        }))
      return closeShortAllotment(review.allotment_id, {
        idempotency_key: idempotencyKey(),
        lines: close,
        reason: "Accepted short in MD's review",
      })
    },
    onSuccess: () => {
      settle()
      toast.success(
        `${review?.allotment_number} · ${pcs(review?.short ?? 0)} closed short`,
        {
          description: shop(review?.store_id ?? ""),
        }
      )
      onOpenChange(false)
    },
  })

  if (review === null)
    return (
      <Sheet open={false} onOpenChange={onOpenChange} title="">
        {null}
      </Sheet>
    )

  const store = shop(review.store_id)
  // "C003 · Purbalingga": the code in the store's blue, the name after it.
  const parts = store.split(" · ")
  const code =
    parts.length > 1 ? (parts[0] ?? review.store_id) : review.store_id
  const name = parts.length > 1 ? parts.slice(1).join(" · ") : ""
  const mine = (lines ?? []).filter(
    (line) => line.destination_id === review.store_id
  )
  const short = (sku: string) =>
    review.lines.find((line) => line.sku_code === sku)?.short ?? 0
  // Only what the picker could not get: the rest of the store's lines are
  // not this review's.
  const shortLines = mine.filter((line) => short(line.sku_code) > 0)
  const asked = shortLines.reduce((sum, line) => sum + targetOf(line), 0)
  const picked = shortLines.reduce((sum, line) => sum + workedOf(line), 0)
  const articles: ReviewArticle[] = [
    ...new Map(shortLines.map((line) => [line.article_code, line])).values(),
  ].map((head) => {
    const identity = identities.get(head.sku_code)
    return {
      article_code: head.article_code,
      article_name: head.article_name,
      image_url: head.image_url,
      division: identity?.division_code
        ? termLabel(vocabulary.data?.divisions, identity.division_code)
        : null,
      tags: (identity?.tags ?? []).map((tag) =>
        termLabel(vocabulary.data?.tags, tag)
      ),
      skus: shortLines
        .filter((line) => line.article_code === head.article_code)
        .map((line) => ({
          sku_code: line.sku_code,
          colour: line.colour,
          size: line.size,
        })),
    }
  })
  const skuName = (sku: string) => {
    const line = mine.find((one) => one.sku_code === sku)
    return line
      ? [line.colour, line.size].filter(Boolean).join(" · ") || skuNumber(sku)
      : skuNumber(sku)
  }
  const unmatched = matched.some(({ allotted }) => allotted === undefined)

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      context="Allotments"
      id={review.allotment_number}
      title={store}
      caption={`At the DC · Cannot continue at Pick · ${personOf(review.reported_by)} · ${dayTime(review.reported_at)}`}
      size="workspace"
      stack
      footer={
        <SheetFooter
          secondary={
            <Button
              variant="ghost"
              pending={continuing.isPending}
              disabled={accepting.isPending}
              onClick={() => continuing.mutate()}
            >
              Continue
            </Button>
          }
          primary={{
            label: "Accept short",
            onClick: () => accepting.mutate(),
            pending: accepting.isPending,
            disabled: continuing.isPending || lines === undefined || unmatched,
          }}
          note={
            unmatched
              ? "This allotment no longer holds every line the picker reported."
              : undefined
          }
          error={continuing.error ?? accepting.error}
        />
      }
    >
      <KpiStrip className="grid-cols-3">
        <Kpi label="Asked" value={lines === undefined ? "—" : pcs(asked)} />
        <Kpi label="Picked" value={lines === undefined ? "—" : pcs(picked)} />
        <Kpi
          label="Not picked"
          value={<span className="text-bad-fg">{pcs(review.short)}</span>}
        />
      </KpiStrip>

      <section className="flex flex-col gap-2">
        <h3 className="text-[0.9375rem] leading-5 font-semibold text-ink">
          Issues{" "}
          <span className="font-normal text-mute">
            {count(review.lines.length)}
          </span>
        </h3>
        <ul className="overflow-hidden rounded-card border border-hairline-strong">
          {review.lines.map((line) => (
            <li
              key={line.sku_code}
              className="flex items-baseline gap-2.5 border-t border-hairline px-4 py-3 text-[0.9375rem] first:border-t-0"
            >
              <i
                aria-hidden
                className="inline-block size-2 shrink-0 -translate-y-px rounded-full bg-warn"
              />
              <span className="text-ink">
                <b className="font-semibold">
                  {count(line.short)} {skuName(line.sku_code)}
                </b>{" "}
                was not picked for <b className="font-semibold">{code}</b>{" "}
                {name}
                <span className="text-body"> · {line.reason}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      {articles.length > 0 && (
        <ReviewMatrix
          before="Asked"
          after="Picked"
          articles={articles}
          stores={[{ id: review.store_id, code, name }]}
          cell={(sku, id) => {
            const line = mine.find(
              (one) => one.sku_code === sku && one.destination_id === id
            )
            if (!line) return null
            return {
              before: targetOf(line),
              after: workedOf(line),
              say:
                short(sku) > 0 ? `${count(short(sku))} not picked` : undefined,
            }
          }}
        />
      )}
    </Sheet>
  )
}

/// Every piece picked for the line so far, packed and gone ones too (the
/// delivery cards and `stagesOf` read it the same way).
function workedOf(line: AllotmentLine): number {
  const sent = stagesOf([line]).dispatched
  return Math.max(line.picked_quantity, line.at_packed_qty + sent)
}
