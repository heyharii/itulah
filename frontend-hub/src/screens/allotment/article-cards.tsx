import { useShopName } from "@/components/operations/outbound-papers"
import { count, quantity } from "@/lib/format"
import type { AllotmentLine } from "@/lib/queries/inventory"
import type { ReceivedShipmentRow } from "@/screens/inventory/received-feed"
import { missingOf, stagesOf, targetOf } from "@/screens/allotment/amend-data"
import { ArticleThumb } from "@/screens/allotment/article-thumb"
import { useShortNotes } from "@/screens/allotment/short-notes"
import { STAGE_COLOUR } from "@/screens/allotment/delivery-cards"

/// MD's allotment sheet read ARTICLE by article (allotment-sheet-cards.html,
/// option D, owner 17 Oct 2026): one card per article — photograph, name,
/// its pieces, its code and how many stores, and where its pieces are as
/// chips — and inside it one row per store with its own chip. To pick has no
/// chip (owner: "to pick hapus, picked saja abu abu"): what nobody has
/// touched yet says nothing. More than three articles start folded; a card
/// with more than five stores keeps the rest behind Show more.

type Place =
  "picked" | "packed" | "dispatched" | "missing" | "received" | "cancelled"


/// Where a slice's pieces are, by place, with what is still to pick left out.
/// `missing` is what a store counted for and did not find (`missingOf`): the
/// books still have it dispatched, the store says it never came.
function placesOf(
  lines: readonly AllotmentLine[],
  missing: number
): [Place, number][] {
  const s = stagesOf(lines)
  const wanted = lines.reduce(
    (sum, line) => sum + Math.max(0, targetOf(line) - line.cancelled_quantity),
    0
  )
  const all: [Place, number][] = [
    ["picked", s.picked],
    ["packed", s.packed],
    ["dispatched", Math.max(0, s.dispatched - s.received - missing)],
    ["missing", missing],
    ["received", s.received],
  ]
  const shown = all.filter(([, n]) => n > 0)
  // Nothing wanted and nothing moved: MD gave it up.
  if (shown.length === 0 && wanted === 0)
    return [["cancelled", lines.reduce((sum, line) => sum + line.quantity, 0)]]
  return shown
}

interface ArticleGroup {
  readonly id: string
  readonly name: string
  readonly code: string
  readonly image: string | null
  readonly lines: readonly AllotmentLine[]
  readonly stores: readonly { id: string; lines: readonly AllotmentLine[] }[]
}

function articlesOf(lines: readonly AllotmentLine[]): ArticleGroup[] {
  const byArticle = new Map<string, AllotmentLine[]>()
  for (const line of lines)
    byArticle.set(line.article_id, [
      ...(byArticle.get(line.article_id) ?? []),
      line,
    ])
  return [...byArticle.values()].map((mine) => {
    const byStore = new Map<string, AllotmentLine[]>()
    for (const line of mine)
      byStore.set(line.destination_id, [
        ...(byStore.get(line.destination_id) ?? []),
        line,
      ])
    const first = mine[0]
    return {
      id: first.article_id,
      name: first.article_name,
      code: first.article_code,
      image: mine.find((line) => line.image_url !== null)?.image_url ?? null,
      lines: mine,
      stores: [...byStore.entries()]
        .sort(([left], [right]) =>
          left.localeCompare(right, undefined, { numeric: true })
        )
        .map(([id, own]) => ({ id, lines: own })),
    }
  })
}

/// The pieces a slice still means to deliver, or what it was if all of it was
/// given up.
function piecesOf(lines: readonly AllotmentLine[]): number {
  const wanted = lines.reduce(
    (sum, line) => sum + Math.max(0, targetOf(line) - line.cancelled_quantity),
    0
  )
  return wanted > 0
    ? wanted
    : lines.reduce((sum, line) => sum + line.quantity, 0)
}

/// The status rows of an article's mini table: each place with the stores
/// that have pieces there and how many. What nobody picked yet is To pick.
const PLACE_ROW: Record<Place | "toPick", { word: string; colour: string }> = {
  toPick: { word: "To pick", colour: STAGE_COLOUR.toPick },
  picked: { word: "Picked", colour: STAGE_COLOUR.picked },
  packed: { word: "Packed", colour: STAGE_COLOUR.packed },
  dispatched: { word: "Dispatched", colour: STAGE_COLOUR.dispatched },
  missing: { word: "Missing", colour: "#d70015" },
  received: { word: "Received", colour: STAGE_COLOUR.received },
  cancelled: { word: "Cancelled", colour: "#b8b8c0" },
}

function groupsOf(
  stores: readonly { id: string; lines: readonly AllotmentLine[] }[],
  missing: (lines: readonly AllotmentLine[]) => number,
  shop: (id: string) => string
) {
  const groups = new Map<
    Place | "toPick",
    { word: string; colour: string; codes: string[]; pieces: number }
  >()
  const add = (key: Place | "toPick", code: string, n: number) => {
    if (n <= 0) return
    const group = groups.get(key) ?? { ...PLACE_ROW[key], codes: [], pieces: 0 }
    group.codes.push(code)
    group.pieces += n
    groups.set(key, group)
  }
  for (const store of stores) {
    const code = shop(store.id).split(" · ")[0]
    const places = placesOf(store.lines, missing(store.lines))
    for (const [place, n] of places) add(place, code, n)
    if (places[0]?.[0] !== "cancelled")
      add(
        "toPick",
        code,
        piecesOf(store.lines) - places.reduce((sum, [, n]) => sum + n, 0)
      )
  }
  const order: (Place | "toPick")[] = [
    "toPick", "picked", "packed", "dispatched", "missing", "received", "cancelled",
  ]
  return order.flatMap((key) => groups.get(key) ?? [])
}

export function ArticleCards({ lines }: { lines: readonly AllotmentLine[] }) {
  const articles = articlesOf(lines)
  const short = useShortNotes()
  return (
    <div className="flex flex-col gap-2">
      {articles.map((article) => (
        <ArticleCard
          key={article.id}
          article={article}
          short={short}
        />
      ))}
    </div>
  )
}

function ArticleCard({
  article,
  short,
}: {
  article: ArticleGroup
  /// Delivery notes received short (`useShortNotes`).
  short: readonly ReceivedShipmentRow[]
}) {
  const missing = (lines: readonly AllotmentLine[]) => missingOf(lines, short)
  const shop = useShopName()
  const stores = article.stores.length
  // Two sides, as the In progress card (owner, 20 Oct 2026): the article at
  // the left, its stores' mini table at the right.
  return (
    <section className="grid items-start gap-x-6 gap-y-3 rounded-card border border-hairline bg-canvas p-4 md:grid-cols-[minmax(0,1fr)_minmax(22rem,30rem)]">
      <div className="grid grid-cols-[2.75rem_minmax(0,1fr)] items-start gap-3.5">
        <ArticleThumb
          url={article.image}
          name={article.name}
          articleCode={article.code}
          className="size-11 rounded-inner border border-hairline"
        />
        <span className="flex min-w-0 flex-col">
          <span className="text-[1.0625rem] leading-6 font-semibold [overflow-wrap:anywhere] text-ink">
            {article.name}
          </span>
          <span className="text-[0.9375rem] text-body">
            <span className="font-mono">{article.code}</span>
          </span>
          <span className="mt-1.5 text-[0.9375rem] text-ink tabular-nums">
            <span className="font-semibold">{quantity(piecesOf(article.lines))}</span>
            <span className="text-body">
              {" · "}
              {stores === 1 ? "1 store" : `${count(stores)} stores`}
            </span>
          </span>
        </span>
      </div>
      <div className="overflow-hidden rounded-inner border border-hairline text-[0.9375rem]">
        <div className="grid grid-cols-[8.5rem_minmax(0,1fr)_4.5rem] items-center gap-x-2.5 bg-soft px-3 py-1.5 text-mute">
          <span>Status</span>
          <span>Stores</span>
          <span className="text-right">Pcs</span>
        </div>
        {groupsOf(article.stores, missing, shop).map((group) => (
          <div
            key={group.word}
            className="grid grid-cols-[8.5rem_minmax(0,1fr)_4.5rem] items-center gap-x-2.5 border-t border-hairline px-3 py-2"
          >
            <span className="inline-flex min-w-0 items-center gap-1.5 truncate text-body">
              <i
                aria-hidden
                className="inline-block size-2 shrink-0 rounded-full"
                style={{ background: group.colour }}
              />
              {group.word}
            </span>
            <span className="min-w-0 text-ink tabular-nums">
              {group.codes.join(", ")}
            </span>
            <span className="text-right font-semibold text-ink tabular-nums">
              {count(group.pieces)}
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}
