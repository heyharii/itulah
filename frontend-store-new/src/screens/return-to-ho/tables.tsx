import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/states"
import { articleId, count, moment, pcs } from "@/lib/format"
import type { ReturnArticle, ReturnKoli, ReturnTrip } from "@/lib/return-steps"
import {
  ArticleCell,
  Foot,
  Head,
  many,
  RedText,
  Row,
  Tick,
} from "@/screens/return-to-ho/parts"

/// The five tables of Return to HO, one per tab. Each is one card holding one
/// table; an empty one says so in a single quiet line.

function Empty({ children }: { children: string }) {
  return (
    <Card>
      <EmptyState art={null}>{children}</EmptyState>
    </Card>
  )
}

const TABLE = "w-full table-fixed border-collapse text-cell text-body"

/// **Picklist** — what HO asked this shop to send back, article by article. An
/// article is picked whole; there is no quantity to type and no part of one.
export function PicklistTable({
  articles,
  pending,
  onPick,
  onOpen,
}: {
  articles: readonly ReturnArticle[]
  /// The article whose Pick is on its way.
  pending: string | null
  onPick: (article: ReturnArticle) => void
  onOpen: (article: ReturnArticle) => void
}) {
  if (articles.length === 0) return <Empty>Nothing to pick.</Empty>
  return (
    <Card>
      <table className={TABLE}>
        <thead>
          <Head>
            <th className="w-14 px-4 text-right max-md:w-11 max-md:px-2">
              No.
            </th>
            <th className="px-4 text-left">Article</th>
            <th className="w-28 px-4 text-right max-md:hidden">Qty</th>
            <th className="w-28 px-4 max-md:w-24 max-md:px-3" />
          </Head>
        </thead>
        <tbody>
          {articles.map((article, index) => (
            <Row key={article.article_code} onClick={() => onOpen(article)}>
              <td className="px-4 py-2.5 text-right text-mute max-md:px-2">
                {index + 1}
              </td>
              <td className="px-4 py-2.5 max-md:px-2">
                <ArticleCell
                  article={article}
                  sub={
                    <>
                      {/* A phone has no Qty column: the pieces lead. */}
                      <span className="md:hidden">
                        {`${pcs(article.quantity)} · `}
                      </span>
                      <span className="max-md:hidden">
                        {`${many(article.skus.length, "SKU")} · `}
                      </span>
                      <span className="font-mono">
                        {articleId(article.article_code)}
                      </span>
                    </>
                  }
                />
              </td>
              <td className="px-4 py-2.5 text-right whitespace-nowrap max-md:hidden">
                {pcs(article.quantity)}
              </td>
              <td className="px-4 py-2.5 text-right max-md:px-3">
                <Button
                  variant="primary"
                  size="card"
                  pending={pending === article.article_code}
                  onClick={(event) => {
                    event.stopPropagation()
                    onPick(article)
                  }}
                >
                  Pick
                </Button>
              </td>
            </Row>
          ))}
        </tbody>
      </table>
    </Card>
  )
}

/// **Picked** — in the pick area, not yet in a koli. Unpick sends an article
/// back to the shelf and the Picklist.
export function PickedTable({
  articles,
  busy,
  onUnpick,
  onOpen,
}: {
  articles: readonly ReturnArticle[]
  busy: boolean
  onUnpick: (article: ReturnArticle) => void
  onOpen: (article: ReturnArticle) => void
}) {
  if (articles.length === 0) return <Empty>Nothing picked.</Empty>
  return (
    <Card>
      <table className={TABLE}>
        <thead>
          <Head>
            <th className="px-4 text-left">Article</th>
            <th className="w-32 px-4 text-right max-md:w-24 max-md:px-2">
              Picked
            </th>
            <th className="w-28 px-4 max-md:w-24 max-md:px-3" />
          </Head>
        </thead>
        <tbody>
          {articles.map((article) => (
            <Row key={article.article_code} onClick={() => onOpen(article)}>
              <td className="px-4 py-2.5 max-md:px-2">
                <ArticleCell
                  article={article}
                  sub={
                    <>
                      {many(article.skus.length, "SKU")}
                      {" · "}
                      <span className="font-mono">
                        {articleId(article.article_code)}
                      </span>
                    </>
                  }
                />
              </td>
              <td className="px-4 py-2.5 text-right whitespace-nowrap max-md:px-2">
                {pcs(article.quantity)}
              </td>
              <td className="px-4 py-2.5 text-right max-md:px-3">
                <RedText disabled={busy} onClick={() => onUnpick(article)}>
                  Unpick
                </RedText>
              </td>
            </Row>
          ))}
        </tbody>
        <tfoot>
          <Foot>
            <td className="px-4 text-mute">
              {many(articles.length, "article")}
            </td>
            <td className="px-4 text-right font-semibold whitespace-nowrap text-ink max-md:px-2">
              {pcs(articles.reduce((sum, one) => sum + one.quantity, 0))}
            </td>
            <td />
          </Foot>
        </tfoot>
      </table>
    </Card>
  )
}

/// **Packed** — the sealed koli, ticked to be unpacked or put on a trip.
export function PackedTable({
  koli,
  ticked,
  onToggle,
  onToggleAll,
}: {
  koli: readonly ReturnKoli[]
  ticked: ReadonlySet<string>
  onToggle: (koliId: string) => void
  onToggleAll: (on: boolean) => void
}) {
  if (koli.length === 0) return <Empty>No koli.</Empty>
  const all = koli.every((one) => ticked.has(one.koli.koli_id))
  return (
    <Card>
      <table className={TABLE}>
        <thead>
          <Head>
            <th className="w-12 px-4 max-md:w-11 max-md:px-3">
              <Tick
                on={all}
                label="Every koli"
                onChange={() => onToggleAll(!all)}
              />
            </th>
            <th className="px-4 text-left max-md:px-2">Koli</th>
            <th className="w-56 px-4 text-left max-md:hidden">Sealed</th>
            <th className="w-24 px-4 text-right">Pcs</th>
          </Head>
        </thead>
        <tbody>
          {koli.map((one) => {
            const id = one.koli.koli_id
            const articles = new Set(one.lines.map((line) => line.article_code))
            return (
              <Row
                key={id}
                selected={ticked.has(id)}
                onClick={() => onToggle(id)}
              >
                <td className="px-4 max-md:px-3">
                  <Tick
                    on={ticked.has(id)}
                    label={one.koli.koli_number}
                    onChange={() => onToggle(id)}
                  />
                </td>
                <td className="px-4 py-2.5 max-md:px-2">
                  <span className="flex min-w-0 flex-col leading-5">
                    <span className="truncate font-medium text-ink">
                      {one.koli.koli_number}
                    </span>
                    <span className="truncate text-mute">
                      {articles.size > 0
                        ? many(articles.size, "article")
                        : one.koli.destination_code}
                    </span>
                  </span>
                </td>
                <td className="px-4 py-2.5 whitespace-nowrap max-md:hidden">
                  {moment(one.koli.sealed_at)}
                </td>
                <td className="px-4 py-2.5 text-right text-ink">
                  {count(one.koli.unit_count)}
                </td>
              </Row>
            )
          })}
        </tbody>
      </table>
    </Card>
  )
}

/// **In transit** and **Received** — the trips to HO, told apart by whether HO
/// has counted every piece in.
export function TripTable({ trips }: { trips: readonly ReturnTrip[] }) {
  if (trips.length === 0) return <Empty>Nothing here.</Empty>
  return (
    <Card>
      <table className={TABLE}>
        <thead>
          <Head>
            <th className="px-4 text-left max-md:pr-1 max-md:pl-3">Trip</th>
            <th className="w-56 px-4 text-left max-md:hidden">Left</th>
            <th className="w-20 px-4 text-right max-md:w-12 max-md:px-1">
              Koli
            </th>
            <th className="w-20 px-4 text-right max-md:w-12 max-md:px-1">
              Pcs
            </th>
            <th className="w-32 px-4 text-right max-md:w-24 max-md:pl-1">
              Status
            </th>
          </Head>
        </thead>
        <tbody>
          {trips.map((trip) => {
            const received = trip.received_at !== null
            return (
              <Row key={trip.dispatch_id}>
                <td className="px-4 py-2.5 max-md:pr-1 max-md:pl-3">
                  <span className="block truncate font-medium text-ink">
                    {trip.dispatch_number}
                  </span>
                </td>
                <td className="px-4 py-2.5 whitespace-nowrap max-md:hidden">
                  {moment(trip.departed_at)}
                </td>
                <td className="px-4 py-2.5 text-right max-md:px-1">
                  {count(trip.koli_count)}
                </td>
                <td className="px-4 py-2.5 text-right max-md:px-1">
                  {count(trip.unit_count)}
                </td>
                <td
                  className={`px-4 py-2.5 text-right whitespace-nowrap max-md:pl-1 ${received ? "text-ok-fg" : "text-accent"}`}
                >
                  {received ? "Received" : "In transit"}
                </td>
              </Row>
            )
          })}
        </tbody>
      </table>
    </Card>
  )
}
