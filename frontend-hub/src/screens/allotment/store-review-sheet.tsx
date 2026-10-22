import { idempotencyKey } from "@itulah/contract/client"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { useShopName } from "@/components/operations/outbound-papers"
import { Button } from "@/components/ui/button"
import { Dialog } from "@/components/ui/dialog"
import { Checkbox } from "@/components/ui/field"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { Sheet } from "@/components/ui/sheet"
import { SheetFooter } from "@/components/ui/sheet-footer"
import { count, dayTime, sku as skuNumber } from "@/lib/format"
import { useCatalogueIdentity } from "@/lib/operations/catalogue"
import { useNameOfLogin } from "@/lib/queries/hr-employees"
import { inventoryKeys } from "@/lib/queries/inventory"
import { catalogueVocabulary, procurementKeys } from "@/lib/queries/procurement"
import { toast } from "@/lib/toast"
import { cn } from "@/lib/utils"
import { ArticleThumb, colourDigitOf } from "@/screens/allotment/article-thumb"
import {
  decideStoreReview,
  storeReviewKeys,
  storeReviewPlan,
  type StoreReview,
  type StoreReviewPlan,
  type StoreReviewStore,
} from "@/screens/allotment/review-data"
import {
  ReviewMatrix,
  type ReviewArticle,
} from "@/screens/allotment/review-matrix"
import { termLabel } from "@/screens/procurement/shared"

/// **MD's review of what the stores of a trip counted** — At the store
/// (allotment-review-per-store.html, owner 20 Oct 2026).
///
/// A store's count books at once what matches its delivery; what differs
/// waits for MD, store by store. The trip sheet lists its stores — a store
/// still to answer is red — and under them the matrix, Sent | Received per
/// store, every cell that differs saying how, and once answered what became
/// of it. A store's Review (or a coloured cell) opens that store alone: its
/// articles as Review count reads them on a PO, and its two answers, each
/// asked first with what it will do:
///
/// - **Accept as delivered** — the allotment follows what arrived: another
///   store's pieces stay where they landed, what no store has is Missing,
///   what nobody sent goes back to HO.
/// - **Return & reallot** — what is wrong goes back to HO, what the store did
///   not get HO sends again on a new allotment, as far as the DC holds it.
///
/// A store answers once the stores its difference could pair with have
/// counted: a short waits for every store still to count, an extra only for
/// those sent the same SKU.

const pcs = (n: number) => `${count(n)} ${n === 1 ? "pc" : "pcs"}`

/// "C003 · Purbalingga" → its code and its name.
function splitShop(label: string, id: string): { code: string; name: string } {
  const parts = label.split(" · ")
  return parts.length > 1
    ? { code: parts[0] ?? id, name: parts.slice(1).join(" · ") }
    : { code: id, name: label === id ? "" : label }
}

type Decision = "AS_DELIVERED" | "RETURN_REALLOT"

/// A store's count differs and MD has not answered it.
const openOf = (store: StoreReviewStore) =>
  store.in_review && store.decision === null

export function StoreReviewSheet({
  review,
  open,
  onOpenChange,
}: {
  /// Kept after the sheet closes, so it slides out with what it showed.
  review: StoreReview | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const shop = useShopName()
  const identities = useCatalogueIdentity()
  const vocabulary = useQuery({
    queryKey: procurementKeys.vocabulary(),
    queryFn: ({ signal }) => catalogueVocabulary(signal),
    staleTime: 30 * 60 * 1000,
  })
  /// The store whose review is open, and the size a cell asked for.
  const [store, setStore] = useState<{ id: string; sku?: string } | null>(
    null
  )
  const [onlyDifferences, setOnlyDifferences] = useState(false)

  if (review === null)
    return (
      <Sheet open={false} onOpenChange={onOpenChange} title="">
        {null}
      </Sheet>
    )

  const code = (id: string) => splitShop(shop(id), id).code
  const sku = (skuCode: string) =>
    review.skus.find((one) => one.sku_code === skuCode)
  const articleCodes = [
    ...new Set(review.skus.map((one) => one.article_code ?? one.sku_code)),
  ]

  // The figures, as the strip says them.
  const sent = review.stores.reduce((sum, one) => sum + one.sent, 0)
  const received = review.stores.reduce(
    (sum, one) => sum + (one.counted ?? 0),
    0
  )
  const toDecide = review.stores.filter(openOf).length
  const waiting = review.stores.filter((one) => one.counted === null).length

  // The matrix: articles in the order met, under their divisions.
  const articles: ReviewArticle[] = articleCodes.map((articleCode) => {
    const mine = review.skus.filter(
      (one) => (one.article_code ?? one.sku_code) === articleCode
    )
    const head = mine[0]
    const identity = identities.get(head?.sku_code ?? "")
    return {
      article_code: articleCode,
      article_name: head?.article_name ?? articleCode,
      image_url: head?.image_url ?? null,
      division: identity?.division_code
        ? termLabel(vocabulary.data?.divisions, identity.division_code)
        : null,
      tags: (identity?.tags ?? []).map((tag) =>
        termLabel(vocabulary.data?.tags, tag)
      ),
      skus: mine.map((one) => ({
        sku_code: one.sku_code,
        colour: one.colour,
        size: one.size,
      })),
    }
  })
  const say = (skuCode: string, at: string): string | undefined => {
    const said = [
      ...review.wrong_store
        .filter((one) => one.sku_code === skuCode && one.arrived_at === at)
        .map((one) => `${count(one.pieces)} from ${code(one.meant_for)}`),
      ...review.wrong_store
        .filter((one) => one.sku_code === skuCode && one.meant_for === at)
        .map((one) => `${count(one.pieces)} to ${code(one.arrived_at)}`),
      ...review.not_received
        .filter((one) => one.sku_code === skuCode && one.store_id === at)
        .map((one) => `${count(one.pieces)} not received`),
      ...review.extra
        .filter((one) => one.sku_code === skuCode && one.store_id === at)
        .map((one) => `${count(one.pieces)} extra`),
    ]
    return said.length === 0 ? undefined : said.join(" · ")
  }
  const wrongAt = (skuCode: string, at: string) =>
    review.wrong_store.some(
      (one) =>
        one.sku_code === skuCode &&
        (one.arrived_at === at || one.meant_for === at)
    )
  /// What MD's answer made of a cell's difference.
  const outOf = (skuCode: string, at: string): string | undefined => {
    const one = review.stores.find((s) => s.store_id === at)
    if (one?.decision == null) return undefined
    const as = one.decision === "AS_DELIVERED"
    if (review.extra.some((e) => e.sku_code === skuCode && e.store_id === at))
      return "→ HO"
    if (
      review.wrong_store.some(
        (w) => w.sku_code === skuCode && w.arrived_at === at
      )
    )
      return as ? "kept" : "→ HO"
    if (
      review.not_received.some(
        (n) => n.sku_code === skuCode && n.store_id === at
      )
    )
      return as ? "Missing" : "sent again"
    if (
      review.wrong_store.some((w) => w.sku_code === skuCode && w.meant_for === at)
    )
      return as ? undefined : "sent again"
    return undefined
  }

  const caption = `At the store · ${review.allotments.map((one) => one.allotment_number).join(", ")}`
  const current =
    store === null
      ? undefined
      : review.stores.find((one) => one.store_id === store.id)

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) setStore(null)
        onOpenChange(next)
      }}
      context="Allotments"
      id={review.dispatch_number}
      title={`Trip ${review.dispatch_number}`}
      caption={caption}
      // A grid read across, as the prototype: a trip of many stores scrolls
      // its matrix sideways rather than taking the whole screen.
      size="table"
      stack
      footer={
        <SheetFooter
          note={
            toDecide > 0
              ? `${count(toDecide)} ${toDecide === 1 ? "store" : "stores"} to decide`
              : waiting > 0
                ? "Everything decided so far · waiting for the rest to count"
                : "Everything decided"
          }
          primary={{ label: "Done", onClick: () => onOpenChange(false) }}
        />
      }
    >
      <KpiStrip className="mb-0 grid-cols-2 md:grid-cols-4">
        <Kpi label="Sent" value={pcs(sent)} />
        <Kpi label="Received" value={pcs(received)} />
        <Kpi
          label="To decide"
          value={
            <span className={cn(toDecide > 0 && "text-bad-fg")}>
              {count(toDecide)} {toDecide === 1 ? "store" : "stores"}
            </span>
          }
        />
        <Kpi
          label="Waiting"
          value={`${count(waiting)} ${waiting === 1 ? "store" : "stores"}`}
        />
      </KpiStrip>

      {/* The stores of the trip, a store still to answer red (owner, 20
          Oct 2026). */}
      <div className="overflow-hidden rounded-card border border-hairline">
        <div className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1.4fr)_minmax(0,1fr)_auto] items-center gap-x-4 bg-soft px-4 py-2.5 text-body max-md:hidden">
          <span>Store</span>
          <span>Status</span>
          <span className="text-right">Received</span>
          <span className="w-24" />
        </div>
        {review.stores.map((one) => {
          const { code: c, name } = splitShop(shop(one.store_id), one.store_id)
          const short = review.not_received
            .filter((n) => n.store_id === one.store_id)
            .reduce((sum, n) => sum + n.pieces, 0) +
            review.wrong_store
              .filter((w) => w.meant_for === one.store_id)
              .reduce((sum, w) => sum + w.pieces, 0)
          const extra = review.extra
            .filter((e) => e.store_id === one.store_id)
            .reduce((sum, e) => sum + e.pieces, 0) +
            review.wrong_store
              .filter((w) => w.arrived_at === one.store_id)
              .reduce((sum, w) => sum + w.pieces, 0)
          const problem = openOf(one)
          return (
            <div
              key={one.store_id}
              className={cn(
                "grid grid-cols-[minmax(0,1.2fr)_minmax(0,1.4fr)_minmax(0,1fr)_auto] items-center gap-x-4 border-t border-hairline px-4 py-3 max-md:grid-cols-[minmax(0,1fr)_auto] max-md:gap-y-1",
                problem && "bg-bad-bg/50"
              )}
            >
              <span>
                <b className="font-semibold text-ink">{c}</b>
                {name !== "" && <span className="text-body"> · {name}</span>}
              </span>
              <span className="flex flex-col max-md:col-start-1">
                <StatusWords
                  one={one}
                  short={short}
                  extra={extra}
                  waits={one.waiting_for.map(code)}
                />
              </span>
              <span className="text-right tabular-nums max-md:col-start-2 max-md:row-start-1">
                {one.counted === null ? (
                  <span className="text-body">{pcs(one.sent)} sent</span>
                ) : (
                  <>
                    <b className="font-semibold text-ink">
                      {count(one.counted)}
                    </b>{" "}
                    <span className="text-body">of {pcs(one.sent)}</span>
                  </>
                )}
              </span>
              <span className="flex w-24 justify-end max-md:col-start-2 max-md:w-auto">
                {problem ? (
                  <Button
                    variant="primary"
                    size="card"
                    onClick={() => setStore({ id: one.store_id })}
                  >
                    Review
                  </Button>
                ) : null}
              </span>
            </div>
          )
        })}
      </div>

      {articles.length > 0 && (
        <section className="flex flex-col gap-2.5">
          <Checkbox
            label="Only differences"
            checked={onlyDifferences}
            onChange={setOnlyDifferences}
          />
          <ReviewMatrix
            before="Sent"
            after="Received"
            articles={articles}
            onlyDifferences={onlyDifferences}
            stores={review.stores.map((one) => {
              const { code: c, name } = splitShop(
                shop(one.store_id),
                one.store_id
              )
              return {
                id: one.store_id,
                code: c,
                name: name || (one.store_name ?? ""),
                note: one.counted === null ? "Waiting" : undefined,
                problem: openOf(one),
              }
            })}
            cell={(skuCode, at) => {
              const one = sku(skuCode)?.stores.find(
                (cell) => cell.store_id === at
              )
              if (one === undefined) return null
              return {
                before: one.sent,
                after: one.counted,
                wrongStore: wrongAt(skuCode, at),
                say: one.counted === null ? undefined : say(skuCode, at),
                out: outOf(skuCode, at),
              }
            }}
            onCell={(skuCode, at) => setStore({ id: at, sku: skuCode })}
          />
        </section>
      )}

      <StoreSheet
        review={review}
        store={current ?? null}
        focus={store?.sku}
        onClose={() => setStore(null)}
      />
    </Sheet>
  )
}

/// A store's status on the trip, in words.
function StatusWords({
  one,
  short,
  extra,
  waits,
}: {
  one: StoreReviewStore
  short: number
  extra: number
  waits: readonly string[]
}) {
  const dot = (tone: string) => (
    <i
      aria-hidden
      className={cn("mr-1.5 inline-block size-2 -translate-y-px rounded-full", tone)}
    />
  )
  if (one.decision !== null)
    return (
      <span className="font-medium text-ok-fg">
        ✓{" "}
        {one.decision === "AS_DELIVERED"
          ? "Accepted as delivered"
          : "Return & reallot"}
      </span>
    )
  if (one.counted === null)
    return (
      <span className="text-body">
        {dot("bg-mute")}
        Not received yet
      </span>
    )
  if (!one.in_review)
    return (
      <span className="text-ink">
        {dot("bg-ok-fg")}
        Received
      </span>
    )
  return (
    <>
      <span className="text-ink">
        {short > 0 && (
          <>
            {dot("bg-bad-fg")}
            Short {count(short)}
          </>
        )}
        {short > 0 && extra > 0 && " · "}
        {extra > 0 && (
          <>
            {short === 0 && dot("bg-warn-fg")}
            Extra {count(extra)} · on hold
          </>
        )}
      </span>
      {waits.length > 0 && (
        <span className="text-body">Waiting for {waits.join(", ")} to count</span>
      )}
    </>
  )
}

/// **One store of the trip** — its articles as Review count reads them on a
/// PO (the article's first size with its photograph, each later size tied to
/// it by a guide line), Allotment | Received, a size received otherwise in
/// red with its difference in brackets. Its two answers are asked first.
function StoreSheet({
  review,
  store,
  focus,
  onClose,
}: {
  review: StoreReview
  store: StoreReviewStore | null
  focus?: string
  onClose: () => void
}) {
  const shop = useShopName()
  const personOf = useNameOfLogin()
  const [asking, setAsking] = useState<Decision | null>(null)
  if (store === null)
    return (
      <Sheet open={false} onOpenChange={onClose} title="">
        {null}
      </Sheet>
    )
  const { code, name } = splitShop(shop(store.store_id), store.store_id)
  const lines = review.skus
    .map((one) => {
      const cell = one.stores.find((c) => c.store_id === store.store_id)
      return { sku: one, sent: cell?.sent ?? 0, got: cell?.counted ?? 0 }
    })
    .filter((one) => one.sent > 0 || one.got > 0)
  const byArticle = new Map<string, typeof lines>()
  for (const line of lines) {
    const key = line.sku.article_code ?? line.sku.sku_code
    byArticle.set(key, [...(byArticle.get(key) ?? []), line])
  }
  const plan = lines.reduce((sum, one) => sum + one.sent, 0)
  const got = lines.reduce((sum, one) => sum + one.got, 0)
  const waits = store.waiting_for.map((id) => splitShop(shop(id), id).code)
  const blocked = waits.length > 0 || !openOf(store)

  const head =
    "border-b border-hairline bg-soft px-4 py-2.5 text-left font-medium text-body max-md:px-2.5"
  const cellCls = "px-4 py-3.5 align-middle max-md:px-2.5"
  const num = "text-right text-[0.9375rem] tabular-nums"

  return (
    <Sheet
      open={store !== null}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      context={`Trip ${review.dispatch_number}`}
      title={`${code}${name !== "" ? ` · ${name}` : ""}`}
      caption={
        store.counted_at === null
          ? undefined
          : `Received by ${personOf(store.counted_by ?? "")} · ${dayTime(store.counted_at)}`
      }
      size="wide"
      stack
      footer={
        <SheetFooter
          note={
            waits.length > 0
              ? `Waiting for ${waits.join(", ")} to count`
              : undefined
          }
          danger={
            <Button
              variant="destructive"
              disabled={blocked}
              onClick={() => setAsking("RETURN_REALLOT")}
            >
              Return &amp; reallot
            </Button>
          }
          primary={{
            label: "Accept as delivered",
            onClick: () => setAsking("AS_DELIVERED"),
            disabled: blocked,
          }}
        />
      }
    >
      <KpiStrip className="grid-cols-3">
        <Kpi label="Allotment" value={pcs(plan)} />
        <Kpi label="Received" value={pcs(got)} />
        <Kpi
          label={got < plan ? "Short" : "Extra"}
          value={<span className="text-bad-fg">{pcs(Math.abs(got - plan))}</span>}
        />
      </KpiStrip>

      <div className="overflow-clip rounded-card border border-hairline">
        <table className="w-full table-fixed border-collapse">
          <thead>
            <tr>
              <th className={head}>Article</th>
              <th className={cn(head, "w-32 text-right max-md:w-[5.5rem]")}>
                Allotment
              </th>
              <th className={cn(head, "w-32 text-right max-md:w-[5.5rem]")}>
                Received
              </th>
            </tr>
          </thead>
          <tbody>
            {[...byArticle.entries()].flatMap(([articleCode, mine]) =>
              mine.map((line, at) => {
                const d = line.got - line.sent
                const label =
                  [line.sku.colour, line.sku.size].filter(Boolean).join(" · ") ||
                  line.sku.sku_code
                return (
                  <tr
                    key={line.sku.sku_code}
                    className={cn(
                      at === 0
                        ? "h-16 border-t border-hairline-strong first:border-t-0"
                        : "",
                      focus === line.sku.sku_code && "bg-accent-bg"
                    )}
                  >
                    <td className={cellCls}>
                      <div className="flex min-w-0 items-center gap-3">
                        {at > 0 && (
                          <span
                            aria-hidden
                            className={cn(
                              GUIDE,
                              at === mine.length - 1 && "before:bottom-1/2"
                            )}
                          />
                        )}
                        <ArticleThumb
                          url={at === 0 ? line.sku.image_url : null}
                          name={line.sku.article_name ?? articleCode}
                          articleCode={articleCode}
                          colour={at === 0 ? undefined : line.sku.colour}
                          digit={
                            at === 0
                              ? undefined
                              : colourDigitOf(articleCode, line.sku.sku_code)
                          }
                          bare={at > 0}
                          className="size-10 shrink-0 rounded-inner border border-hairline"
                        />
                        {at === 0 ? (
                          <span className="flex min-w-0 flex-col leading-5">
                            <b className="font-semibold [overflow-wrap:anywhere] text-ink">
                              {line.sku.article_name ?? skuNumber(line.sku.sku_code)}
                            </b>
                            <span className="whitespace-nowrap text-body">{label}</span>
                          </span>
                        ) : (
                          <span className="whitespace-nowrap text-body">{label}</span>
                        )}
                      </div>
                    </td>
                    <td className={cn(cellCls, num, "text-body")}>
                      {count(line.sent)}
                    </td>
                    <td className={cn(cellCls, num)}>
                      {d === 0 ? (
                        <span className="text-ink">{count(line.got)}</span>
                      ) : (
                        <span className="font-semibold text-bad-fg">
                          {count(line.got)} ({d > 0 ? `+${count(d)}` : `−${count(-d)}`})
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      <DecideDialog
        review={review}
        store={store}
        decision={asking}
        onOpenChange={(next) => {
          if (!next) setAsking(null)
        }}
        onDone={() => {
          setAsking(null)
          onClose()
        }}
      />
    </Sheet>
  )
}

/// A later size's tie to the first: a line down the photo column, one stroke
/// out to its own photo (as Review count on a PO).
const GUIDE =
  "relative w-10 shrink-0 self-stretch before:absolute before:-top-[15px] before:-bottom-[15px] before:left-[19px] before:border-l-[1.5px] before:border-hairline-2 before:content-[''] after:absolute after:top-1/2 after:left-[19px] after:w-[33px] after:border-t-[1.5px] after:border-hairline-2 after:content-['']"

/// **Accept as delivered at C001?** / **Return & reallot at C001?** — asked
/// as Close short is on a PO: what the answer does, group by group — where
/// each piece goes and how many — from the centre's own plan for the store.
function DecideDialog({
  review,
  store,
  decision,
  onOpenChange,
  onDone,
}: {
  review: StoreReview
  store: StoreReviewStore
  decision: Decision | null
  onOpenChange: (open: boolean) => void
  onDone: () => void
}) {
  const client = useQueryClient()
  const shop = useShopName()
  const code = (id: string) => splitShop(shop(id), id).code
  const plan = useQuery({
    queryKey: storeReviewKeys.plan(
      review.dispatch_id,
      decision ?? "AS_DELIVERED",
      store.store_id
    ),
    queryFn: ({ signal }) =>
      storeReviewPlan(
        review.dispatch_id,
        decision ?? "AS_DELIVERED",
        signal,
        store.store_id
      ),
    enabled: decision !== null,
  })
  const deciding = useMutation({
    mutationFn: () =>
      decideStoreReview(
        review.dispatch_id,
        decision ?? "AS_DELIVERED",
        idempotencyKey(),
        store.store_id
      ),
    onSuccess: (done) => {
      void client.invalidateQueries({ queryKey: storeReviewKeys.all() })
      void client.invalidateQueries({ queryKey: inventoryKeys.allotments() })
      toast.success(
        `${code(store.store_id)} · ${done.decision === "AS_DELIVERED" ? "accepted as delivered" : "return & reallot"}`,
        {
          description:
            done.plan.reallot_allotment_number !== null
              ? `${done.plan.reallot_allotment_number} · ${pcs(done.plan.reallot.reduce((sum, one) => sum + one.sent, 0))} reallotted`
              : undefined,
        }
      )
      onDone()
    },
  })
  const sku = (skuCode: string) =>
    review.skus.find((one) => one.sku_code === skuCode)
  const words = (skuCode: string) => {
    const one = sku(skuCode)
    const variant = [one?.colour, one?.size].filter(Boolean).join(" · ")
    return one?.article_name
      ? `${one.article_name}${variant ? ` · ${variant}` : ""}`
      : skuNumber(skuCode)
  }
  const word = decision === "RETURN_REALLOT" ? "Return & reallot" : "Accept as delivered"
  const here = code(store.store_id)
  // The store's own sizes that differ: its allotment, before → after.
  const changed = review.skus
    .map((one) => {
      const cell = one.stores.find((c) => c.store_id === store.store_id)
      return { code: one.sku_code, sent: cell?.sent ?? 0, got: cell?.counted ?? 0 }
    })
    .filter((one) => one.sent !== one.got && one.sent > 0)

  return (
    <Dialog
      open={decision !== null}
      onOpenChange={onOpenChange}
      title={`${word} at ${here}?`}
      confirm={word}
      tone={decision === "RETURN_REALLOT" ? "danger" : "primary"}
      pending={deciding.isPending}
      problem={deciding.error ?? plan.error}
      ready={plan.data !== undefined}
      onConfirm={() => deciding.mutate()}
    >
      <p className="text-body">
        {splitShop(shop(store.store_id), store.store_id).name ||
          store.store_name}{" "}
        · Trip {review.dispatch_number}
      </p>
      {plan.data === undefined ? (
        <p className="mt-4 text-mute">Working out what it does…</p>
      ) : (
        <div className="mt-4 flex flex-col gap-2.5">
          {groupsOf(plan.data, decision, here, changed, review, store.store_id, code).map(
            (group) => (
              <section
                key={group.tag + group.to}
                className="overflow-hidden rounded-card border border-hairline"
              >
                <header className="flex items-center gap-2 bg-soft px-3.5 py-2.5">
                  <span
                    className={cn(
                      "inline-flex h-6 items-center rounded-[0.375rem] px-2 font-medium",
                      TAG[group.tone]
                    )}
                  >
                    {group.tag}
                  </span>
                  <span className="ml-auto text-right text-body">{group.to}</span>
                </header>
                {group.rows.map(([skuCode, figure]) => (
                  <div
                    key={skuCode}
                    className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-t border-hairline px-3.5 py-2.5"
                  >
                    <span className="text-ink">{words(skuCode)}</span>
                    <span className="font-semibold text-ink tabular-nums">
                      {figure}
                    </span>
                  </div>
                ))}
              </section>
            )
          )}
        </div>
      )}
    </Dialog>
  )
}

const TAG = {
  green: "bg-ok-bg text-ok-fg",
  amber: "bg-warn-bg text-warn-fg",
  red: "bg-bad-bg text-bad-fg",
  blue: "bg-accent-bg text-accent",
} as const

interface Group {
  readonly tag: string
  readonly tone: keyof typeof TAG
  readonly to: string
  readonly rows: [string, string][]
}

/// What an answer does at one store, as the dialog says it.
function groupsOf(
  plan: StoreReviewPlan,
  decision: Decision | null,
  here: string,
  changed: readonly { code: string; sent: number; got: number }[],
  review: StoreReview,
  storeId: string,
  code: (id: string) => string
): Group[] {
  const groups: Group[] = []
  const sum = (rows: readonly { pieces: number }[]) =>
    rows.reduce((n, one) => n + one.pieces, 0)
  if (decision === "AS_DELIVERED" && changed.some((one) => one.got < one.sent)) {
    // The store's whole allotment on the trip, before → after.
    const cells = review.skus.flatMap((one) =>
      one.stores.filter((c) => c.store_id === storeId)
    )
    const before = cells.reduce((n, c) => n + c.sent, 0)
    const after = cells.reduce((n, c) => n + Math.min(c.counted ?? 0, c.sent), 0)
    groups.push({
      tag: "Allotment",
      tone: "green",
      to: `${here} ${count(before)} → ${count(after)} pcs`,
      rows: changed
        .filter((one) => one.got < one.sent)
        .map((one) => [one.code, `${count(one.sent)} → ${count(one.got)}`]),
    })
  }
  // What this store did not get and another store of the trip did: it
  // stays there, on that store's answer.
  const elsewhere = review.wrong_store.filter((one) => one.meant_for === storeId)
  if (decision === "AS_DELIVERED" && elsewhere.length > 0)
    groups.push({
      tag: "Wrong store",
      tone: "amber",
      to: `At ${[...new Set(elsewhere.map((one) => code(one.arrived_at)))].join(", ")} · stays there`,
      rows: elsewhere.map((one) => [one.sku_code, pcs(one.pieces)]),
    })
  const keep = plan.keep.filter((one) => one.store_id === storeId)
  if (keep.length > 0) {
    const meant = review.wrong_store
      .filter((one) => one.arrived_at === storeId)
      .map((one) => code(one.meant_for))
    groups.push({
      tag: "Wrong store",
      tone: "amber",
      to: `Kept at ${here} · meant for ${[...new Set(meant)].join(", ")}`,
      rows: keep.map((one) => [one.sku_code, pcs(one.pieces)]),
    })
  }
  const back = plan.send_back.filter((one) => one.store_id === storeId)
  if (back.length > 0)
    groups.push({
      tag: "Return to HO",
      tone: "amber",
      to: `${here} → HO · ${pcs(sum(back))}`,
      rows: back.map((one) => [one.sku_code, pcs(one.pieces)]),
    })
  const again = plan.reallot.filter((one) => one.store_id === storeId)
  if (again.length > 0)
    groups.push({
      tag: "Reallot",
      tone: "blue",
      to: `New allotment · DC → ${here}`,
      rows: again.map((one) => [
        one.sku_code,
        one.sent < one.pieces
          ? `${count(one.sent)} of ${count(one.pieces)} · Closed short`
          : pcs(one.sent),
      ]),
    })
  const missing = plan.missing.filter((one) => one.store_id === storeId)
  if (missing.length > 0)
    groups.push({
      tag: "Missing",
      tone: "red",
      to: "In transit · found at no store",
      rows: missing.map((one) => [one.sku_code, pcs(one.pieces)]),
    })
  return groups
}
