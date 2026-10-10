import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useVirtualizer } from "@tanstack/react-virtual"
import {
  ArrowLeft,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  X,
} from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { useNavigate } from "@tanstack/react-router"
import { useShopName } from "@/components/operations/outbound-papers"
import { Button } from "@/components/ui/button"
import { ConfirmButton } from "@/components/ui/dialog"
import { type FacetValue } from "@/components/ui/facets"
import { Banner, EmptyState, Problem, Receipt } from "@/components/ui/states"
import { PickerSheet } from "@/components/ui/picker-sheet"
import { count, quantity } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import { useAppNavigate } from "@/lib/navigate"
import { amendAllotment } from "@/lib/operations/changes"
import { keys as opsKeys } from "@/lib/operations/keys"
import { toast } from "@/lib/toast"
import {
  allotmentDetail,
  createAllotmentBatch,
  fleetPools,
  idempotencyKey,
  inventoryKeys,
  poolAvailability,
  type AllotmentLine,
  type AvailabilityItem,
  type CreateAllotmentLine,
  type CreateAllotmentResult,
} from "@/lib/queries/inventory"
import {
  catalogueVocabulary,
  listPurchaseOrders,
  procurementKeys,
} from "@/lib/queries/procurement"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"
import { cn } from "@/lib/utils"
import {
  sitesOf,
  sourcePoolsFor,
  useActor,
  type AllotmentKind,
} from "@/screens/inventory/shared"
import { termLabel } from "@/screens/procurement/shared"
import { ArticleThumb, colourDigitOf } from "./article-thumb"
import { ArticleMeta } from "./to-allot"
import { useAllotSelection, useSupplierOf } from "./to-allot-data"
import { changeOf, floorOf, targetOf } from "./amend-data"
import { DRAFT_KEY, allotFromOf } from "./draft"
import {
  applyPatch,
  cellKey,
  fillAllToOne,
  fillEven,
  patchTotals,
  undoOf,
  type FillRow,
  type Patch,
} from "./quick-fill"
import { QuickFillMenu, type FillPlan, type FillStore } from "./quick-fill-menu"
import { walkSearch, type SupplierPick } from "./walk"
import {
  TokenFilter,
  type FilterToken,
  type TokenKind,
  type TokenOption,
} from "./token-filter"

/// New allotment — the whole warehouse against every store it feeds.
///
/// # Why this is a page and not the rail it used to be
///
/// The composer this replaces asked five questions and built ONE line: a pool,
/// a store, a SKU, a quantity, add. Sending a delivery of forty SKUs to
/// thirteen stores that way is five hundred and twenty trips through the same
/// five fields, and — the part that actually made it unusable — at no point in
/// those five hundred trips can anybody see what the store is getting. The
/// decision "does store 03 have enough shirts" is a decision about a ROW, and
/// the form showed one cell at a time.
///
/// So the shape is the shape of the decision: SKUs down, destinations across,
/// a quantity in the cell. A person reads a row to see how a size is being
/// spread, reads a column to see what a store is being sent, and the totals
/// for both are in the gutters. That does not fit a 27.5rem sheet at any
/// density, which is why this is a URL of its own.
///
/// # What a cell is
///
/// One cell is one `CreateAllotmentLine`. Nothing is aggregated on the way
/// out: thirteen stores getting the same SKU is thirteen lines on one
/// allotment, which is what the server's own model already is — a line carries
/// its own destination, and the only thing an allotment insists on is that
/// every line leaves the same SITE.
///
/// # Why the axis is destinations rather than stores
///
/// Two of the three allotment types have exactly one legal destination — a
/// return goes to `dc`, a supplier return to `external/supplier` — so they are
/// not a different screen, they are this screen with one column. Writing them
/// as a special case would have meant a second composer to keep in step.

/// Where a column of this matrix sends goods.
interface Destination {
  readonly id: string
  readonly type: "STORE" | "DC" | "SUPPLIER"
  /// The heading, in full.
  readonly name: string
  /// The store's code — `C001` out of `C001 · Cikupa` — line 1 of the heading.
  readonly code: string
  /// The store's name without the code — `Cikupa` — line 2 of the heading;
  /// empty when the units register does not know the site.
  readonly label: string
}

/// `C001 · Cikupa` (the units register's label for a shop) → code `C001`,
/// label `Cikupa`. A site the register does not resolve keeps its own name
/// ("Store 01") as the code and no second line — never the bare id.
function storeNaming(
  siteName: string,
  shopLabel: string
): { code: string; label: string } {
  const at = shopLabel.indexOf(" · ")
  if (at <= 0) return { code: siteName, label: "" }
  return {
    code: shopLabel.slice(0, at).trim(),
    label: shopLabel.slice(at + 3).trim(),
  }
}

/// The rows of one article, and what the article IS.
///
/// The identity is lifted off the first SKU rather than read separately: the
/// availability endpoint already carries the photograph, the division and the
/// tags on every row — it was extended to do exactly that for this screen —
/// and a second read per article would be one request per row.
interface ArticleGroup {
  readonly id: string
  readonly code: string
  readonly name: string
  readonly division: string | null
  readonly image: string | null
  readonly divisionName: string
  readonly tags: readonly string[]
  /// The tags as words, for the row's second line. Resolved once here rather
  /// than per render of a virtualised row.
  readonly tagNames: readonly string[]
  readonly stock: number
  readonly free: number
  readonly skus: readonly AvailabilityItem[]
}

/// Sizes in the order a rail hangs them, so the Size picker reads S, M, L
/// rather than by how many rows each one happens to have.
const SIZE_ORDER = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "XXXL"]

function sizeRank(size: string): number {
  const at = SIZE_ORDER.indexOf(size.toUpperCase())
  if (at >= 0) return at
  const numeric = Number(size)
  return Number.isFinite(numeric) ? 100 + numeric : 1000
}

/// What the virtualiser is counting. An article's header and its SKUs are one
/// flat list because a virtualiser measures a list, not a tree — and the
/// heights differ, so the kind has to be readable from the index.
type MatrixRow =
  | {
      readonly kind: "article"
      readonly key: string
      readonly group: ArticleGroup
    }
  | {
      readonly kind: "sku"
      readonly key: string
      readonly group: ArticleGroup
      readonly item: AvailabilityItem
    }

/// Whether a SKU row starts a colourway: the row above is the article's own,
/// or another colour.
function leads(above: MatrixRow | undefined, item: AvailabilityItem): boolean {
  return (
    above === undefined ||
    above.kind === "article" ||
    above.item.colour !== item.colour
  )
}

/// What this screen raises, and the only thing it raises.
///
/// The type used to be a picker, and the other two values made the matrix a
/// single column: a return goes to `dc` and a supplier return to
/// `external/supplier`, so there is nothing to spread and no grid to spread it
/// on. Returns are one-line acts belonging to the screen that finds the goods
/// wrong; a matrix is for the one act that is genuinely two-dimensional.
const KIND: AllotmentKind = "TO_STORE"

/// Measured, and they have to be numbers: a virtualiser positions rows in
/// pixels, so a class that disagrees with these scrolls to the wrong place.
const ARTICLE_ROW = 64
const SKU_ROW = 56

/// The sticky block on the left, in the order it is read: what the thing is,
/// then how much of it there is. Everything right of it scrolls under it.
///
/// It narrows on a phone rather than staying put, and it has to: at 17.5rem
/// plus the free column the frozen block is 352px, which on a 375px screen
/// leaves 23px of matrix. `STUCK` carries the offset the free column is pinned
/// at and MUST stay equal to `IDENTITY`'s width at both breakpoints — they are
/// two halves of one measurement, and a millimetre of disagreement shows as a
/// seam the rows scroll through.
///
/// **A phone shows one store at a time** (`NewAllotment` hands the matrix a
/// single destination and a store picker to change it), and drops the Stock
/// column — the gutter on the right already says what is left. That is what
/// makes the four tracks fit a 375px screen: 12rem + 5rem + 5.5rem = 22.5rem.
/// Before, the frozen left and right blocks took the whole box and the store
/// columns scrolled through a 30px gap between them.
const IDENTITY = "w-[12rem] shrink-0 px-2 md:w-[17.5rem] md:px-3"
const FREE = "w-[4.5rem] shrink-0 px-2 text-right md:w-[5rem] max-md:hidden"
const STUCK = "sticky left-[12rem] z-10 md:left-[17.5rem]"
const COLUMN = "w-[5rem] shrink-0 px-2 md:w-[7rem]"

/// New allotment, or an allotment MD edits in the same grid (owner, 9 Oct
/// 2026: "tombol edit buka grid yg sama dengan new allotment"). An edit comes
/// as `?allotFrom=edit~<id>`; every other start is the new-allotment page.
export function NewAllotment() {
  const startedFrom = useSheet("allotFrom")
  const restart = allotFromOf(startedFrom.value)
  return restart?.mode === "edit" ? (
    <EditAllotment id={restart.id} />
  ) : (
    <NewAllotmentGrid />
  )
}

function NewAllotmentGrid() {
  const client = useQueryClient()
  const actor = useActor()

  /// Every filter of the page, as the tokens typed into the one filter box.
  const [tokens, setTokens] = useState<readonly FilterToken[]>([])
  const filters = useMemo(() => {
    const valuesOf = (kind: TokenKind) =>
      tokens.filter((one) => one.kind === kind).map((one) => one.value)
    return {
      needles: valuesOf("search").map((one) => one.toLowerCase()),
      divisions: valuesOf("division"),
      tags: valuesOf("tag"),
      colours: valuesOf("colour"),
      sizes: valuesOf("size"),
      order: valuesOf("order"),
    }
  }, [tokens])
  const { needles, divisions, tags, colours, sizes, order } = filters
  /// What an allotment is started from, when it is: Cancel and
  /// re-allot arrives here with the old allotment in the address.
  const startedFrom = useSheet("allotFrom")
  const restart = allotFromOf(startedFrom.value)
  const origin = useQuery({
    queryKey: inventoryKeys.allotment(restart?.id ?? ""),
    queryFn: ({ signal }) => allotmentDetail(restart!.id, signal),
    enabled: restart !== null,
  })
  /// Its items and stores — the page is narrowed to them until cleared.
  const prefill = useMemo(
    () =>
      restart === null || origin.data === undefined
        ? null
        : {
            mode: restart.mode,
            number: origin.data.allotment_number,
            skus: new Set(origin.data.lines.map((one) => one.sku_id)),
            stores: new Set(origin.data.lines.map((one) => one.destination_id)),
          },
    [restart, origin.data]
  )
  /// Nobody types a note here any more; a re-allot still says
  /// which allotment it follows, and a fresh one sends none.
  const notes = prefill === null ? "" : `Re-allot of ${prefill.number}`
  /// The articles this allotment is made of, picked on the Allotments
  /// page's Unallotted tab and carried here as `?supplier=…&articles=…`, so a
  /// reload lands on the same grid. Ticks under several suppliers are walked
  /// one supplier at a time (`queue` after this one, `before` behind it — see
  /// `walk.ts`). A re-allot comes instead with the old allotment, narrowed to
  /// what it gives back. With neither there is nothing to allot here, and the
  /// page goes back to the list.
  const navigate = useNavigate()
  const { walk, steps, selection } = useAllotSelection()
  const step = walk.current
  const pickedArticles = useMemo(
    () => (step ? new Set(step.articles) : null),
    [step]
  )
  const supplierId = step?.supplier ?? null
  const lost = restart === null && walk.current === null
  /// The article whose box was last typed in, tinted on its row.
  const [focus, setFocus] = useState<string | null>(null)
  useEffect(() => {
    if (lost) void navigate({ to: "/allotment" as never, replace: true })
  }, [lost, navigate])
  /// What Save has raised on this page, by article — one allotment each.
  const [raised, setRaised] = useState<ReadonlyMap<string, RaisedAllotment>>(
    new Map()
  )
  /// The same articles as a ref, for the way back to the list: Submit all &
  /// done leaves from a callback that still holds the render before the save.
  const saved = useRef<Set<string>>(new Set())
  /// The draft. One number per (SKU, destination) pair, and the only state on
  /// this page that is worth anything — everything else is a way of deciding
  /// where to type.
  const [cells, setCells] =
    useState<Readonly<Record<string, number>>>(readDraft)
  // Kept on this device as it is typed, so a reload, a wrong click in the
  // sidebar or a closed tab does not cost somebody an afternoon of numbers.
  // Emptied as articles are saved, because saving empties their cells.
  useEffect(() => writeDraft(cells), [cells])

  const fleet = useQuery({
    queryKey: inventoryKeys.fleet(),
    queryFn: ({ signal }) => fleetPools(signal),
  })

  const vocabulary = useQuery({
    queryKey: procurementKeys.vocabulary(),
    queryFn: ({ signal }) => catalogueVocabulary(signal),
    staleTime: 30 * 60 * 1000,
  })

  const divisionLabel = useCallback(
    (code: string) => termLabel(vocabulary.data?.divisions, code),
    [vocabulary.data]
  )
  const tagLabel = useCallback(
    (code: string) => termLabel(vocabulary.data?.tags, code),
    [vocabulary.data]
  )

  /// The order book, so a delivery can be allotted as a delivery.
  ///
  /// What arrives on a Tuesday is one purchase order, and the question in the
  /// warehouse that afternoon is "spread THIS across the shops" — not "find
  /// the eleven articles it contained among two thousand". Every availability
  /// row already carries the orders its article came in on, so choosing one
  /// here narrows the matrix to exactly what that order brought.
  ///
  /// It narrows rather than fills: a purchase order says how much the company
  /// bought, and nothing at all about which shop gets it. Prefilling a split
  /// out of it would be inventing the one number this screen exists to ask a
  /// person for.
  const orders = useQuery({
    queryKey: procurementKeys.orders(),
    queryFn: ({ signal }) => listPurchaseOrders({}, signal),
    staleTime: 5 * 60 * 1000,
  })

  const pools = useMemo(
    () => sourcePoolsFor(KIND, fleet.data?.items ?? []),
    [fleet.data]
  )

  /// The pool this screen is about. Not offered as a choice: a store delivery
  /// comes off the warehouse racks, and the alternatives the server would
  /// accept — the two pending pools, picking, the two reject pools — are
  /// exceptions raised from the pool screens that own them, not the thing
  /// somebody opens this page to do. Falls back to the first legal pool so the
  /// matrix is never blank on a fleet that names its warehouse differently.
  const source =
    pools.find((one) => one.pool_code === "WAREHOUSE")?.id ?? pools[0]?.id ?? ""

  const stock = useQuery({
    queryKey: inventoryKeys.poolAvailability(source, true),
    queryFn: ({ signal }) => poolAvailability(source, { held: true }, signal),
    enabled: source !== "",
  })

  /// A shop as the Outbound board and the Allotments list print it:
  /// "C001 · Cikupa", from the units register.
  const shop = useShopName()
  const destinations = useMemo<Destination[]>(
    () =>
      sitesOf(fleet.data?.items ?? [], "STORE").map((site) => {
        const naming = storeNaming(site.site_name, shop(site.site_id))
        return {
          id: site.site_id,
          type: "STORE" as const,
          name:
            naming.label === ""
              ? site.site_name
              : `${naming.code} · ${naming.label}`,
          ...naming,
        }
      }),
    [fleet.data, shop]
  )

  /// A phone draws one store's column at a time and a store picker to change
  /// it: thirteen 7rem columns cannot share 339px with the frozen blocks.
  /// Every store is still a destination — the typed numbers, the totals and
  /// the quick fill all read `destinations`, not what is on screen.
  const phone = useLayout() === "phone"
  const [chosenStore, setChosenStore] = useState<string | null>(null)
  const storeHere =
    destinations.find((one) => one.id === chosenStore) ?? destinations[0]

  /// The columns drawn: every store, since a re-allot may move goods
  /// anywhere.
  const columns = useMemo(
    () => (phone && storeHere !== undefined ? [storeHere] : destinations),
    [phone, storeHere, destinations]
  )

  /// What is actually in this pool.
  ///
  /// The endpoint's default answer is every active SKU in the catalogue —
  /// 2,740 of them against six that have stock — because it is written to
  /// answer "what is this SKU's position", and a zero is a real answer to
  /// that. It is not a real answer to "what can I send": a row of thirteen
  /// boxes against an article the warehouse does not hold is thirteen boxes
  /// that can only ever be refused.
  ///
  /// So the question is asked as `held=true` and the server answers the few
  /// dozen rather than the few thousand. This filter stays because it is the
  /// definition of the word — a screen that silently drew empty rows if the
  /// flag were ever dropped would be a worse bug than a slow one.
  const held = useMemo(
    () => (stock.data?.items ?? []).filter((item) => item.stock_qty > 0),
    [stock.data]
  )

  // ── one supplier at a time ─────────────────────────────────────────────
  //
  // A new allotment is always ONE supplier's goods (the owner, 29 Sep 2026):
  // what arrives is a supplier's delivery, and it is spread across the stores
  // as one piece of work. Which supplier, and which of its articles, is chosen
  // on the Allotments page before this grid opens.

  const supplierOf = useSupplierOf(orders.data)

  /// Whose goods the items being re-allotted are.
  const prefillSupplier = useMemo(() => {
    if (prefill === null) return null
    const item = held.find((one) => prefill.skus.has(one.sku_id))
    return item ? supplierOf(item).id : null
  }, [prefill, held, supplierOf])

  /// The supplier on screen: the one picked on the list, or a re-allot's own.
  const current = useMemo(() => {
    const id = restart !== null ? prefillSupplier : supplierId
    if (id === null) return null
    const item = held.find((one) => supplierOf(one).id === id)
    return item ? supplierOf(item) : null
  }, [restart, prefillSupplier, supplierId, held, supplierOf])

  /// What each article still has free, over all its SKUs.
  const articleFree = useMemo(() => {
    const free = new Map<string, number>()
    for (const item of held)
      free.set(
        item.article_id,
        (free.get(item.article_id) ?? 0) + item.on_hand_qty
      )
    return free
  }, [held])

  const sifted = useMemo(() => {
    const chosen = new Set(order)
    return held.filter((item) => {
      if (current === null || supplierOf(item).id !== current.id) return false
      if (prefill !== null && !prefill.skus.has(item.sku_id)) return false
      if (pickedArticles !== null && !pickedArticles.has(item.article_id))
        return false
      // Only what can still be allotted. A saved article is done and leaves
      // the grid (the owner, 29 Sep 2026); its number stays in the footer's
      // receipt.
      if ((articleFree.get(item.article_id) ?? 0) <= 0) return false
      if (
        chosen.size > 0 &&
        !item.purchase_order_ids.some((id) => chosen.has(id))
      )
        return false
      // Every searched word has to be in the article's name, code or SKU.
      return needles.every(
        (wanted) =>
          item.sku_code.toLowerCase().includes(wanted) ||
          item.article_code.toLowerCase().includes(wanted) ||
          item.article_name.toLowerCase().includes(wanted)
      )
    })
  }, [
    held,
    needles,
    order,
    current,
    supplierOf,
    articleFree,
    prefill,
    pickedArticles,
  ])

  /// Counted over the search and never over the selection, the same rule
  /// Articles and Sourcing hold to: ticking MENSWEAR must not make WOMENSWEAR
  /// vanish, or the second choice becomes unreachable.
  const facets = useMemo(() => {
    const byDivision = new Map<string, number>()
    const byTag = new Map<string, number>()
    const byColour = new Map<string, number>()
    const bySize = new Map<string, number>()
    for (const item of sifted) {
      const division = item.division_code ?? ""
      if (division !== "")
        byDivision.set(division, (byDivision.get(division) ?? 0) + 1)
      for (const tag of item.tags) byTag.set(tag, (byTag.get(tag) ?? 0) + 1)
      if (item.colour)
        byColour.set(item.colour, (byColour.get(item.colour) ?? 0) + 1)
      if (item.size) bySize.set(item.size, (bySize.get(item.size) ?? 0) + 1)
    }
    const sort = (map: Map<string, number>): FacetValue[] =>
      [...map.entries()]
        .map(([value, total]) => ({ value, count: total }))
        .sort((left, right) => right.count - left.count)
    return {
      divisions: sort(byDivision),
      tags: sort(byTag),
      colours: sort(byColour),
      sizes: sort(bySize).sort(
        (left, right) =>
          sizeRank(left.value) - sizeRank(right.value) ||
          left.value.localeCompare(right.value)
      ),
    }
  }, [sifted])

  const matching = useMemo(
    () =>
      sifted.filter(
        (item) =>
          (divisions.length === 0 ||
            divisions.includes(item.division_code ?? "")) &&
          (tags.length === 0 || item.tags.some((tag) => tags.includes(tag))) &&
          (colours.length === 0 || colours.includes(item.colour ?? "")) &&
          (sizes.length === 0 || sizes.includes(item.size ?? ""))
      ),
    [sifted, divisions, tags, colours, sizes]
  )

  /// SKUs folded into the articles they belong to, in the order a person
  /// browses: by name, and inside an article by SKU code — which sorts colour
  /// then size, because that is how the code is built.
  const groups = useMemo(() => {
    const byArticle = new Map<string, AvailabilityItem[]>()
    for (const item of matching) {
      const bucket = byArticle.get(item.article_id)
      if (bucket) bucket.push(item)
      else byArticle.set(item.article_id, [item])
    }
    return [...byArticle.values()]
      .map((skus) => {
        const sorted = [...skus].sort((left, right) =>
          left.sku_code.localeCompare(right.sku_code)
        )
        const first = sorted[0]
        return {
          id: first.article_id,
          code: first.article_code,
          name: first.article_name,
          division: first.division_code,
          image: first.image_url,
          divisionName: first.division_code
            ? divisionLabel(first.division_code)
            : "",
          tags: first.tags,
          tagNames: first.tags.map(tagLabel),
          stock: sorted.reduce((total, one) => total + one.stock_qty, 0),
          free: sorted.reduce((total, one) => total + one.on_hand_qty, 0),
          skus: sorted,
        } satisfies ArticleGroup
      })
      .sort((left, right) => left.name.localeCompare(right.name))
  }, [matching, tagLabel, divisionLabel])

  /// Articles folded shut. One set for the grid AND the report: the two are
  /// the same list of rows side by side, so they open and close as one — a
  /// report that kept its own idea of which articles were open would stop
  /// lining up with the grid the first time somebody clicked.
  const [shut, setShut] = useState<ReadonlySet<string>>(new Set())
  const toggle = useCallback((id: string) => {
    setShut((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  /// A step to another supplier starts its grid afresh: its own filters, every
  /// article open, at the top. The typed numbers are the draft's, and stay.
  const [shownFor, setShownFor] = useState(supplierId)
  if (shownFor !== supplierId) {
    setShownFor(supplierId)
    setTokens([])
    setShut(new Set())
    setFocus(null)
  }

  const rows = useMemo<MatrixRow[]>(
    () =>
      groups.flatMap((group) => [
        { kind: "article" as const, key: `a:${group.id}`, group },
        ...(shut.has(group.id)
          ? []
          : group.skus.map((item) => ({
              kind: "sku" as const,
              key: `s:${item.sku_id}`,
              group,
              item,
            }))),
      ]),
    [groups, shut]
  )

  /// The draft, read back as lines. Everything below — the gutters, the
  /// footer and the request itself — is a fold over this, so there is one
  /// definition of what has been typed.
  const lines = useMemo(() => {
    const built: DraftLine[] = []
    const bySku = new Map(
      (stock.data?.items ?? []).map((item) => [item.sku_id, item])
    )
    const chosen = pools.find((one) => one.id === source)
    if (!chosen) return built
    for (const [key, quantity] of Object.entries(cells)) {
      if (quantity <= 0) continue
      const [skuId, destinationId] = key.split("\u0000")
      const item = bySku.get(skuId)
      const destination = destinations.find((one) => one.id === destinationId)
      if (!item || !destination) continue
      built.push({
        source_site_id: chosen.site_id,
        source_pool_id: chosen.id,
        destination_type: destination.type,
        destination_id: destination.id,
        sku_id: skuId,
        quantity,
        item,
      })
    }
    return built
  }, [cells, stock.data, pools, source, destinations])

  /// The footer and the store columns count the supplier on screen only;
  /// other suppliers' typed numbers stay in the draft but are not this page's.
  const ours = useCallback(
    (line: DraftLine) =>
      supplierOf(line.item).id === current?.id &&
      (pickedArticles === null || pickedArticles.has(line.item.article_id)) &&
      (prefill === null || prefill.skus.has(line.sku_id)),
    [supplierOf, current, pickedArticles, prefill]
  )
  const shownLines = useMemo(() => lines.filter(ours), [lines, ours])

  const perDestination = useMemo(() => {
    const totals = new Map<string, number>()
    for (const line of shownLines)
      totals.set(
        line.destination_id,
        (totals.get(line.destination_id) ?? 0) + line.quantity
      )
    return totals
  }, [shownLines])

  /// A SKU promised past what the pool holds free.
  ///
  /// The server refuses the whole allotment over one such line, and it is
  /// right to — but a refusal that arrives after four hundred cells have been
  /// typed is the worst possible moment to learn it, so the same arithmetic is
  /// done here and the button is held until it is fixed.
  const overdrawn = useMemo(() => {
    const wanted = new Map<string, number>()
    for (const line of lines)
      wanted.set(line.sku_id, (wanted.get(line.sku_id) ?? 0) + line.quantity)
    const bySku = new Map(
      (stock.data?.items ?? []).map((item) => [item.sku_id, item])
    )
    return [...wanted.entries()]
      .map(([skuId, asked]) => ({ item: bySku.get(skuId), asked }))
      .filter(
        (one): one is { item: AvailabilityItem; asked: number } =>
          one.item !== undefined && one.asked > one.item.on_hand_qty
      )
  }, [lines, stock.data])

  /// Each article's standing: its whole stock (every SKU, whatever the filters
  /// hide), what the draft gives out of it, and what is left.
  ///
  /// **An article is saved only when it is used up** (the owner, 29 Sep
  /// 2026): an allotment spreads the whole of what arrived, so a half-spread
  /// article is unfinished work, not a smaller allotment. Counted over every
  /// SKU and not only the visible ones, because a colour filter must not make
  /// an article look finished.
  const standing = useMemo(() => {
    const byArticle = new Map<string, Standing>()
    for (const item of held) {
      const one = byArticle.get(item.article_id) ?? {
        stock: 0,
        given: 0,
        left: 0,
        over: false,
        whole: prefill === null,
        lines: [],
      }
      one.stock += item.on_hand_qty
      byArticle.set(item.article_id, one)
    }
    for (const line of lines) {
      const one = byArticle.get(line.item.article_id)
      if (!one) continue
      one.given += line.quantity
      one.lines.push(line)
    }
    const overdrawnSkus = new Set(overdrawn.map((one) => one.item.sku_id))
    for (const one of byArticle.values()) {
      one.left = one.stock - one.given
      one.over = one.lines.some((line) => overdrawnSkus.has(line.sku_id))
    }
    return byArticle as ReadonlyMap<string, Standing>
  }, [held, lines, overdrawn, prefill])

  /// This supplier's articles, for the footer's counts.
  const mine = useMemo(
    () => new Set(sifted.map((item) => item.article_id)),
    [sifted]
  )
  /// The articles whose row shows Save: typed, used up (or a top-up), and
  /// not past what the pool holds. "Submit all" sends exactly these.
  const ready = [...standing.entries()]
    .filter(
      ([id, one]) =>
        mine.has(id) &&
        one.given > 0 &&
        (one.left === 0 || !one.whole) &&
        !one.over
    )
    .map(([id]) => id)
  /// Typed into, but not every piece given: these cannot be saved, and the
  /// page does not move on past them.
  const partial = [...standing.entries()]
    .filter(
      ([id, one]) =>
        mine.has(id) && one.given > 0 && one.left !== 0 && one.whole
    )
    .map(([, one]) => one.lines[0].item.article_name)
    .sort((left, right) => left.localeCompare(right))

  /// Typed, then filtered out of sight. Never dropped — a filter is a way of
  /// finding a row, not of un-typing one — but said out loud, because a total
  /// that does not match what is on screen is otherwise a defect.
  const hidden = useMemo(() => {
    const shown = new Set(matching.map((item) => item.sku_id))
    return shownLines
      .filter((line) => !shown.has(line.sku_id))
      .reduce((total, line) => total + line.quantity, 0)
  }, [shownLines, matching])

  const pieces = shownLines.reduce((total, line) => total + line.quantity, 0)

  const setCell = useCallback((key: string, quantity: number) => {
    setCells((current) => {
      if (quantity <= 0) {
        if (current[key] === undefined) return current
        // Deleted rather than set to zero: an emptied cell is a cell nobody
        // typed in, and `lines` is `Object.entries` over this.
        const rest = { ...current }
        delete rest[key]
        return rest
      }
      if (current[key] === quantity) return current
      return { ...current, [key]: quantity }
    })
  }, [])

  // ── quick fill ─────────────────────────────────────────────────────────
  //
  // "Fill everything evenly, or all to store A, or split across every store"
  // (the owner, 2 Oct 2026). A fill is a patch laid over the same draft the
  // boxes type into, so the gutters, the article states, the saved draft and
  // Submit all follow it, and every number stays editable afterwards.

  const fillStores = useMemo<FillStore[]>(
    () =>
      columns.map((one) => ({ id: one.id, code: one.code, label: one.label })),
    [columns]
  )
  const columnIds = useMemo(() => columns.map((one) => one.id), [columns])
  /// The latest patch laid, so Undo takes back that one and nothing older.
  const laid = useRef(0)
  const lay = (patch: Patch, said: string) => {
    const undo = undoOf(cells, patch)
    setCells((current) => applyPatch(current, patch))
    const id = ++laid.current
    toast.success(said, {
      id: "quick-fill",
      // Up top and for longer than a plain receipt: bottom-right sits over
      // the floating summary's Submit buttons, and an Undo that vanishes
      // under a finger must not leave it pressing "Submit all & done".
      position: "top-center",
      duration: 8000,
      action: {
        label: "Undo",
        onClick: () => {
          if (laid.current !== id) return
          laid.current += 1
          setCells((current) => applyPatch(current, undo))
        },
      },
    })
  }
  const typedIn = (item: AvailabilityItem) =>
    columnIds.some((id) => (cells[cellKey(item.sku_id, id)] ?? 0) > 0)
  const quickFill = (plan: FillPlan, skus: readonly AvailabilityItem[]) => {
    const rows: FillRow[] = skus.map((item) => ({
      skuId: item.sku_id,
      free: item.on_hand_qty,
    }))
    const patch =
      plan.kind === "one"
        ? fillAllToOne(rows, columnIds, plan.store)
        : fillEven(
            rows,
            columnIds,
            plan.kind === "chosen" ? plan.stores : columnIds
          )
    const { skus: filled, pieces: given } = patchTotals(patch)
    if (filled === 0) {
      toast("Nothing to fill")
      return
    }
    lay(
      patch,
      `Filled ${count(filled)} ${filled === 1 ? "SKU" : "SKUs"} · ${quantity(given)}`
    )
  }
  /// Empties these cells, with the same Undo a fill has.
  const clearKeys = (keys: readonly string[]) => {
    const patch: Patch = Object.fromEntries(keys.map((key) => [key, 0]))
    const gone = keys.reduce((total, key) => total + (cells[key] ?? 0), 0)
    if (gone === 0) return
    lay(patch, `Cleared ${quantity(gone)}`)
  }
  const clearShownUndoable = () =>
    clearKeys(
      shownLines.map((line) => cellKey(line.sku_id, line.destination_id))
    )
  const articleKeys = (group: ArticleGroup) =>
    group.skus.flatMap((item) =>
      columnIds
        .map((id) => cellKey(item.sku_id, id))
        .filter((key) => (cells[key] ?? 0) > 0)
    )
  const fillOfArticle: ArticleFill = {
    stores: fillStores,
    onFill: (group, plan) => quickFill(plan, group.skus),
    onClear: (group) => clearKeys(articleKeys(group)),
    typed: (group) => group.skus.some(typedIn),
  }

  /// Save raises one allotment PER ARTICLE, and only for an article that is
  /// used up.
  ///
  /// The owner's rule (29 Sep 2026): an allotment number names one article's
  /// spread across the stores, so the warehouse picks, the buyer reads and a
  /// close-short settles one garment at a time. An article is saved from its
  /// own row the moment it is finished, or every finished one at once from the
  /// footer — each still its own allotment.
  ///
  /// Bounded requests carry articles in order; each article's cells clear when
  /// its allotment exists: if the fourth is refused, the first three are
  /// already raised and gone from the grid, and saving again sends only what
  /// is left — never a second copy of the rest.
  const retryKeys = useRef(new Map<string, { payload: string; key: string }>())
  const [progress, setProgress] = useState<{
    done: number
    total: number
  } | null>(null)
  const create = useMutation({
    mutationFn: async (articleIds: readonly string[]) => {
      const note = notes.trim() === "" ? null : notes
      const batches = articleIds
        .map((id) => standing.get(id)?.lines ?? [])
        .filter((batch) => batch.length > 0)
        .sort((left, right) =>
          left[0].item.article_name.localeCompare(right[0].item.article_name)
        )
      setProgress({ done: 0, total: batches.length })
      for (let offset = 0; offset < batches.length; offset += 10) {
        const chunk = batches.slice(offset, offset + 10)
        setProgress({ done: offset, total: batches.length })
        const requests = chunk.map((batch) => {
          const payload = {
            type: KIND,
            lines: batch.map((line) => ({
              source_site_id: line.source_site_id,
              source_pool_id: line.source_pool_id,
              destination_type: line.destination_type,
              destination_id: line.destination_id,
              sku_id: line.sku_id,
              quantity: line.quantity,
            })),
            notes: note,
            actor_id: actor,
          }
          const articleId = batch[0].item.article_id
          const fingerprint = JSON.stringify(payload)
          const previous = retryKeys.current.get(articleId)
          const key =
            previous?.payload === fingerprint ? previous.key : idempotencyKey()
          retryKeys.current.set(articleId, { payload: fingerprint, key })
          return { ...payload, idempotency_key: key }
        })
        const response = await withTimeout(
          createAllotmentBatch(requests),
          SAVE_TIMEOUT * chunk.length
        )
        for (const [index, result] of response.items.entries()) {
          const batch = chunk[index]
          const sent = new Set(batch.map((line) => line.sku_id))
          setCells((current) =>
            Object.fromEntries(
              Object.entries(current).filter(
                ([key]) => !sent.has(key.split("\u0000")[0])
              )
            )
          )
          const article = batch[0].item
          retryKeys.current.delete(article.article_id)
          setProgress({ done: offset + index + 1, total: batches.length })
          saved.current.add(article.article_id)
          setRaised((current) =>
            new Map(current).set(article.article_id, {
              result,
              article: article.article_name,
              articleId: article.article_id,
              supplierId: supplierOf(article).id,
            })
          )
        }
        if (response.failed_index !== null) {
          const name =
            chunk[response.failed_index]?.[0].item.article_name ?? "Allotment"
          throw new Error(
            `${name}: ${response.problem ?? "the allotment was refused."}`
          )
        }
      }
    },
    onSettled: (_result, _error, articleIds) => {
      setProgress(null)
      client.invalidateQueries({ queryKey: inventoryKeys.allotments() })
      // Availability is keyed per source pool — and per pool again under
      // "whole", the matrix's held read — so only the pools this save drew
      // from need to answer again.
      const sourcePools = new Set(
        articleIds.flatMap((id) =>
          (standing.get(id)?.lines ?? []).map((line) => line.source_pool_id)
        )
      )
      for (const sourcePool of sourcePools) {
        client.invalidateQueries({
          queryKey: ["inventory", "availability", sourcePool],
        })
        client.invalidateQueries({
          queryKey: ["inventory", "availability", "whole", sourcePool],
        })
      }
      client.invalidateQueries({ queryKey: inventoryKeys.fleet() })
    },
  })

  /// The whole order book, with the orders that actually put something in
  /// this pool first and counted.
  ///
  /// Not filtered down to those: an order whose goods are not here is a
  /// legitimate thing to look for — "where is the delivery I am waiting for" —
  /// and a picker that silently omits it answers that question wrongly. The
  /// empty state below says which of the two happened.
  const orderChoices = useMemo(() => {
    const arrived = new Map<string, number>()
    for (const item of held)
      for (const id of item.purchase_order_ids)
        arrived.set(id, (arrived.get(id) ?? 0) + 1)
    return (orders.data ?? [])
      .filter((one) => one.supplier_id === current?.id)
      .map((one) => ({
        value: one.purchase_order_id,
        here: arrived.get(one.purchase_order_id) ?? 0,
        label: one.po_number,
      }))
      .sort((left, right) => right.here - left.here)
  }, [orders.data, held, current])

  /// Everything the filter box can suggest: every value of every vocabulary
  /// that occurs among this supplier's articles, with how many SKUs carry it.
  /// Counted over the search and never over the other tokens, the same rule
  /// Articles and Sourcing hold to: picking one tag must not make the next
  /// one unreachable.
  const tokenOptions = useMemo<TokenOption[]>(
    () => [
      ...facets.tags.map((facet) => ({
        kind: "tag" as const,
        value: facet.value,
        label: tagLabel(facet.value),
        count: facet.count,
      })),
      ...facets.divisions.map((facet) => ({
        kind: "division" as const,
        value: facet.value,
        label: divisionLabel(facet.value),
        count: facet.count,
      })),
      ...facets.colours.map((facet) => ({
        kind: "colour" as const,
        value: facet.value,
        label: facet.value,
        count: facet.count,
      })),
      ...facets.sizes.map((facet) => ({
        kind: "size" as const,
        value: facet.value,
        label: facet.value,
        count: facet.count,
      })),
      ...orderChoices.map((one) => ({
        kind: "order" as const,
        value: one.value,
        label: one.label,
        count: one.here > 0 ? one.here : undefined,
      })),
    ],
    [facets, orderChoices, tagLabel, divisionLabel]
  )

  /// The grid's scroll box, so it can be put back at the top.
  const gridScroll = useRef<HTMLDivElement>(null)
  /// How tall the floating summary is, so the grid leaves room under its
  /// last row and a focused box scrolls into view above the card.
  const [foot, setFoot] = useState(0)
  const footRef = useCallback((node: HTMLDivElement | null) => {
    if (node === null) return
    const observer = new ResizeObserver(() => setFoot(node.offsetHeight))
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const focusedId = focus

  const grid = queryState(stock, {
    loading: "Reading everything the pool holds…",
    render: () =>
      orders.isPending || (restart !== null && origin.isPending) ? (
        <div className="flex-1 p-4 md:p-5">
          <EmptyState>Reading which supplier each article is from…</EmptyState>
        </div>
      ) : rows.length === 0 && stock.isFetching ? (
        // A copy kept from an earlier visit may be empty while the real read
        // is still on its way: say so rather than "nothing left".
        <div className="flex-1 p-4 md:p-5">
          <EmptyState>Reading everything the pool holds…</EmptyState>
        </div>
      ) : rows.length === 0 ? (
        <div className="flex-1 p-4 md:p-5">
          <EmptyState>
            {prefill !== null
              ? "None of these is free to allot."
              : current === null
                ? "Nothing of this supplier is left to allot."
                : tokens.length === 0
                  ? "Every article picked here is allotted."
                  : order.length > 0
                    ? "Nothing in this pool arrived on that order — either it has not been received and set up yet, or what it brought has already left."
                    : "Nothing in this pool answers to those filters."}
          </EmptyState>
        </div>
      ) : (
        <Matrix
          rows={rows}
          destinations={columns}
          cells={cells}
          perDestination={perDestination}
          standing={standing}
          raised={raised}
          shut={shut}
          focused={focusedId}
          saving={create.isPending ? create.variables : null}
          scrollRef={gridScroll}
          foot={foot}
          fill={fillOfArticle}
          onToggle={toggle}
          onCell={setCell}
          onFocus={(article) => setFocus(article)}
          onSave={(article) => create.mutate([article])}
        />
      ),
  })

  const walking = walk.before.length > 0 || walk.queue.length > 0
  /// To another supplier's grid. The typed numbers stay in the draft.
  const stepTo = (at: number) =>
    void navigate({
      to: ".",
      viewTransition: false,
      search: walkSearch(
        steps.slice(0, at),
        steps[at],
        steps.slice(at + 1)
      ) as never,
    })
  useEffect(() => {
    gridScroll.current?.scrollTo({ top: 0 })
  }, [supplierId])

  /// Back to the Allotments page's Unallotted tab, with every supplier's
  /// articles still ticked there — less the ones saved, which are allotted.
  const backToList = () => {
    const left = steps
      .map((one) => ({
        supplier: one.supplier,
        articles: one.articles.filter((id) => !saved.current.has(id)),
      }))
      .filter((one) => one.articles.length > 0) satisfies SupplierPick[]
    void navigate({
      to: "/allotment" as never,
      search: walkSearch([], left[0], left.slice(1)) as never,
    })
  }
  /// Done, on the last supplier: what was not saved stays ticked on the list.
  const finish = backToList
  /// What was typed for any supplier of the walk: Back discards all of it.
  const walkLines = useMemo(
    () =>
      lines.filter(
        (line) =>
          selection.get(supplierOf(line.item).id)?.has(line.item.article_id) ??
          false
      ),
    [lines, selection, supplierOf]
  )
  const clearWalk = () => {
    const typed = new Set(
      walkLines.map((line) => cellKey(line.sku_id, line.destination_id))
    )
    setCells((all) =>
      Object.fromEntries(Object.entries(all).filter(([key]) => !typed.has(key)))
    )
  }
  /// Clears what was typed for this allotment, and only that: other drafts
  /// on this device are other allotments.
  const clearShown = () => {
    const mine = new Set(
      shownLines.map((line) => cellKey(line.sku_id, line.destination_id))
    )
    setCells((all) =>
      Object.fromEntries(Object.entries(all).filter(([key]) => !mine.has(key)))
    )
  }

  if (lost) return null

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col px-3 pt-3 pb-3 [--form-box:2.75rem] md:px-4 min-[100rem]:pt-4 min-[100rem]:[--form-box:2.9375rem]">
      <div className="shrink-0 px-1">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-x-8 gap-y-2 rounded-card bg-soft px-4 py-3">
          <div className="min-w-0">
            <h1 className="truncate text-[1.25rem] leading-tight font-semibold text-ink">
              New allotment
              {current !== null && (
                <span className="font-normal text-mute"> · {current.name}</span>
              )}
            </h1>
            {groups.length > 0 && (
              <p className="mt-0.5 text-[0.875rem] text-mute tabular-nums">
                {count(groups.length)}{" "}
                {groups.length === 1 ? "article" : "articles"} ·{" "}
                {count(groups.reduce((total, group) => total + group.free, 0))}{" "}
                pcs to allot
              </p>
            )}
          </div>
          <div className="ml-auto flex items-center gap-2">
            {walking && (
              <span className="mr-2 text-[0.875rem] text-mute tabular-nums">
                {count(walk.before.length + 1)} of {count(steps.length)}
              </span>
            )}
            {pieces > 0 || walkLines.length > 0 ? (
              <ConfirmButton
                label={
                  <>
                    <ArrowLeft />
                    Back
                  </>
                }
                title="Discard the typed quantities?"
                description={
                  walking
                    ? "Going back to the articles clears the quantities typed for these suppliers."
                    : "Going back to the articles clears the quantities typed for this allotment."
                }
                confirmLabel="Discard"
                tone="danger"
                onConfirm={() => {
                  clearShown()
                  clearWalk()
                  backToList()
                }}
              />
            ) : (
              <Button onClick={backToList}>
                <ArrowLeft />
                Back
              </Button>
            )}
            {walk.before.length > 0 && (
              <Button
                variant="ghost"
                onClick={() => stepTo(walk.before.length - 1)}
              >
                <ChevronLeft />
                Previous
              </Button>
            )}
            {walk.queue.length > 0 && (
              <Button
                variant="ghost"
                onClick={() => stepTo(walk.before.length + 1)}
              >
                Next
                <ChevronRight />
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-card border border-hairline bg-canvas shadow-soft">
        <div className={cn(TOOLBAR, "gap-3")}>
          <TokenFilter
            tokens={tokens}
            options={tokenOptions}
            onChange={setTokens}
            className="max-w-2xl flex-1"
          />
          {prefill !== null && (
            <span className="inline-flex h-[2.125rem] shrink-0 items-center gap-1.5 rounded-inner border border-hairline-2 bg-canvas pr-1.5 pl-3 text-[0.875rem] text-ink shadow-soft">
              Re-allot of {prefill.number}
              <button
                type="button"
                aria-label="Clear"
                onClick={startedFrom.close}
                className="grid size-5 place-items-center rounded-[0.25rem] text-mute hover:bg-hairline hover:text-ink"
              >
                <X className="size-3.5" />
              </button>
            </span>
          )}
        </div>
        {phone && destinations.length > 1 && storeHere !== undefined && (
          <StorePicker
            stores={destinations}
            on={storeHere.id}
            totals={perDestination}
            onPick={setChosenStore}
          />
        )}
        {grid}
        {/* Floats over the grid like the Unallotted tab's selection bar; the
            grid keeps room under its last row for it (`--foot`). */}
        <div
          ref={footRef}
          className="pointer-events-none absolute inset-x-0 bottom-0 z-30 px-3 pb-3 md:px-4 md:pb-5"
        >
          <Summary
            articles={groups.length}
            skus={groups.reduce((total, group) => total + group.skus.length, 0)}
            pieces={pieces}
            lines={shownLines.length}
            places={perDestination.size}
            hidden={hidden}
            ready={ready}
            progress={progress}
            partial={partial}
            overdrawn={overdrawn}
            actor={actor}
            create={create}
            raised={[...raised.values()].filter(
              (one) => one.supplierId === current?.id
            )}
            // Only the last supplier finishes; the ones before it go on with Next.
            onDone={walk.queue.length > 0 ? undefined : finish}
            onClear={clearShownUndoable}
          />
        </div>
      </div>
    </div>
  )
}

/// An allotment, edited in the grid it was made in (MD, 9 Oct 2026).
///
/// The same matrix as New allotment — SKUs down, stores across — opened on
/// the allotment's own article and filled with what each line is now, net.
/// A cell goes up, or down to what is already sent and no further; a blank
/// cell typed into is a store or a SKU the allotment did not have. Save is
/// ONE amend: the lines that changed and the lines added, so the allotment
/// keeps its number and the warehouse sees "Edited" on the cards it has.
///
/// Not the per-article Submit of a new allotment: an allotment that exists is
/// one document already, and half-saving it would leave it in two states.
function EditAllotment({ id }: { id: string }) {
  const client = useQueryClient()
  const goto = useAppNavigate()
  const phone = useLayout() === "phone"
  const shop = useShopName()

  const detail = useQuery({
    queryKey: inventoryKeys.allotment(id),
    queryFn: ({ signal }) => allotmentDetail(id, signal),
  })
  const fleet = useQuery({
    queryKey: inventoryKeys.fleet(),
    queryFn: ({ signal }) => fleetPools(signal),
  })
  const vocabulary = useQuery({
    queryKey: procurementKeys.vocabulary(),
    queryFn: ({ signal }) => catalogueVocabulary(signal),
    staleTime: 30 * 60 * 1000,
  })
  const record = detail.data
  const lines = useMemo(() => record?.lines ?? [], [record])
  /// Where the allotment takes from: every line of it leaves the same pool.
  const source = lines[0]?.source_pool_id ?? ""
  const stock = useQuery({
    queryKey: inventoryKeys.poolAvailability(source, true),
    queryFn: ({ signal }) => poolAvailability(source, { held: true }, signal),
    enabled: source !== "",
  })

  const destinations = useMemo<Destination[]>(
    () =>
      sitesOf(fleet.data?.items ?? [], "STORE").map((site) => {
        const naming = storeNaming(site.site_name, shop(site.site_id))
        return {
          id: site.site_id,
          type: "STORE" as const,
          name:
            naming.label === ""
              ? site.site_name
              : `${naming.code} · ${naming.label}`,
          ...naming,
        }
      }),
    [fleet.data, shop]
  )
  const [chosenStore, setChosenStore] = useState<string | null>(null)
  const storeHere =
    destinations.find((one) => one.id === chosenStore) ?? destinations[0]
  const columns = useMemo(
    () => (phone && storeHere !== undefined ? [storeHere] : destinations),
    [phone, storeHere, destinations]
  )

  /// Each cell as the grid opened: its line, what it is now and what of it is
  /// already sent.
  const original = useMemo(() => {
    const found = new Map<
      string,
      { line: AllotmentLine; target: number; floor: number }
    >()
    for (const line of lines)
      found.set(cellKey(line.sku_id, line.destination_id), {
        line,
        target: targetOf(line),
        floor: floorOf(line),
      })
    return found
  }, [lines])
  const floors = useMemo(
    () =>
      new Map(
        [...original]
          .filter(([, one]) => one.floor > 0)
          .map(([key, one]) => [key, one.floor])
      ),
    [original]
  )
  /// What the allotment already holds of each SKU: the pool counts it as
  /// taken, so it is free to this allotment on top of the pool's free stock.
  const extra = useMemo(() => {
    const held = new Map<string, number>()
    for (const one of original.values())
      held.set(one.line.sku_id, (held.get(one.line.sku_id) ?? 0) + one.target)
    return held
  }, [original])

  /// The cells, from the allotment the first time it arrives and never again:
  /// a refetch must not wipe what MD is typing.
  const [cells, setCells] = useState<Readonly<Record<string, number>> | null>(
    null
  )
  if (cells === null && record !== undefined) {
    setCells(
      Object.fromEntries(
        [...original]
          .filter(([, one]) => one.target > 0)
          .map(([key, one]) => [key, one.target])
      )
    )
  }
  const typed = cells ?? {}

  /// The allotment's article(s), every SKU of them the pool holds, and every
  /// SKU of the allotment whether the pool still holds it or not — a line
  /// already picked or sent in full still has its row, to go down to what
  /// is sent or up again.
  const groups = useMemo<ArticleGroup[]>(() => {
    const articles = new Set(lines.map((line) => line.article_id))
    const items = new Map<string, AvailabilityItem>()
    for (const item of stock.data?.items ?? [])
      if (articles.has(item.article_id)) items.set(item.sku_id, item)
    for (const line of lines) {
      if (items.has(line.sku_id)) continue
      const sibling = [...items.values()].find(
        (one) => one.article_id === line.article_id
      )
      items.set(line.sku_id, {
        sku_id: line.sku_id,
        sku_code: line.sku_code,
        article_id: line.article_id,
        article_code: line.article_code,
        article_name: line.article_name,
        division_code: sibling?.division_code ?? null,
        image_url: line.image_url ?? sibling?.image_url ?? null,
        tags: sibling?.tags ?? [],
        purchase_order_ids: sibling?.purchase_order_ids ?? [],
        colour: line.colour,
        size: line.size,
        stock_qty: 0,
        allotted_qty: 0,
        on_hand_qty: 0,
        missing_qty: 0,
      })
    }
    const byArticle = new Map<string, AvailabilityItem[]>()
    for (const item of items.values()) {
      const bucket = byArticle.get(item.article_id)
      if (bucket) bucket.push(item)
      else byArticle.set(item.article_id, [item])
    }
    return [...byArticle.values()]
      .map((skus) => {
        const sorted = [...skus].sort((left, right) =>
          left.sku_code.localeCompare(right.sku_code)
        )
        const first = sorted[0]
        return {
          id: first.article_id,
          code: first.article_code,
          name: first.article_name,
          division: first.division_code,
          image: first.image_url,
          divisionName: first.division_code
            ? termLabel(vocabulary.data?.divisions, first.division_code)
            : "",
          tags: first.tags,
          tagNames: first.tags.map((tag) =>
            termLabel(vocabulary.data?.tags, tag)
          ),
          stock: sorted.reduce((total, one) => total + one.stock_qty, 0),
          free: sorted.reduce(
            (total, one) =>
              total + one.on_hand_qty + (extra.get(one.sku_id) ?? 0),
            0
          ),
          skus: sorted,
        } satisfies ArticleGroup
      })
      .sort((left, right) => left.name.localeCompare(right.name))
  }, [lines, stock.data, extra, vocabulary.data])

  const [shut, setShut] = useState<ReadonlySet<string>>(new Set())
  const toggle = useCallback((article: string) => {
    setShut((current) => {
      const next = new Set(current)
      if (next.has(article)) next.delete(article)
      else next.add(article)
      return next
    })
  }, [])
  const [focus, setFocus] = useState<string | null>(null)
  const rows = useMemo<MatrixRow[]>(
    () =>
      groups.flatMap((group) => [
        { kind: "article" as const, key: `a:${group.id}`, group },
        ...(shut.has(group.id)
          ? []
          : group.skus.map((item) => ({
              kind: "sku" as const,
              key: `s:${item.sku_id}`,
              group,
              item,
            }))),
      ]),
    [groups, shut]
  )

  const perDestination = useMemo(() => {
    const totals = new Map<string, number>()
    for (const [key, quantity] of Object.entries(typed)) {
      const destination = key.split("\u0000")[1]
      totals.set(destination, (totals.get(destination) ?? 0) + quantity)
    }
    return totals
  }, [typed])

  const setCell = useCallback(
    (key: string, quantity: number) => {
      const kept = Math.max(floors.get(key) ?? 0, quantity)
      setCells((current) => {
        if (current === null) return current
        if (kept <= 0) {
          if (current[key] === undefined) return current
          const rest = { ...current }
          delete rest[key]
          return rest
        }
        if (current[key] === kept) return current
        return { ...current, [key]: kept }
      })
    },
    [floors]
  )

  // Quick fill, as on a new allotment, never under what is already sent.
  const columnIds = useMemo(() => columns.map((one) => one.id), [columns])
  const laid = useRef(0)
  const lay = (patch: Patch, said: string) => {
    const held: Patch = Object.fromEntries(
      Object.entries(patch).map(([key, quantity]) => [
        key,
        Math.max(quantity, floors.get(key) ?? 0),
      ])
    )
    const undo = undoOf(typed, held)
    setCells((current) =>
      current === null ? current : applyPatch(current, held)
    )
    const at = ++laid.current
    toast.success(said, {
      id: "quick-fill",
      position: "top-center",
      duration: 8000,
      action: {
        label: "Undo",
        onClick: () => {
          if (laid.current !== at) return
          laid.current += 1
          setCells((current) =>
            current === null ? current : applyPatch(current, undo)
          )
        },
      },
    })
  }
  const fill: ArticleFill = {
    stores: columns.map((one) => ({
      id: one.id,
      code: one.code,
      label: one.label,
    })),
    onFill: (group, plan) => {
      const fillRows: FillRow[] = group.skus.map((item) => ({
        skuId: item.sku_id,
        free: item.on_hand_qty + (extra.get(item.sku_id) ?? 0),
      }))
      const patch =
        plan.kind === "one"
          ? fillAllToOne(fillRows, columnIds, plan.store)
          : fillEven(
              fillRows,
              columnIds,
              plan.kind === "chosen" ? plan.stores : columnIds
            )
      const { skus: filled, pieces: given } = patchTotals(patch)
      if (filled === 0) {
        toast("Nothing to fill")
        return
      }
      lay(
        patch,
        `Filled ${count(filled)} ${filled === 1 ? "SKU" : "SKUs"} · ${quantity(given)}`
      )
    },
    onClear: (group) => {
      const keys = group.skus.flatMap((item) =>
        columnIds
          .map((column) => cellKey(item.sku_id, column))
          .filter((key) => (typed[key] ?? 0) > (floors.get(key) ?? 0))
      )
      if (keys.length === 0) return
      lay(
        Object.fromEntries(keys.map((key) => [key, 0])),
        `Cleared down to what is sent`
      )
    },
    typed: (group) =>
      group.skus.some((item) =>
        columnIds.some(
          (column) => (typed[cellKey(item.sku_id, column)] ?? 0) > 0
        )
      ),
  }

  /// What Save sends: every line whose cell differs from what it was, and
  /// every typed cell that is not a line yet.
  const change = useMemo(() => {
    const changed: { allotment_line_id: string; to: number }[] = []
    let was = 0
    /// What Save costs the warehouse, before it is pressed (owner, 10 Oct
    /// 2026): pieces to pick (raised lines and new lines), pieces taken out,
    /// and of those the ones sitting in sealed cartons, which `changeOf`
    /// derives exactly. The rest of the taken-out pieces are "not packed
    /// yet": some still on the racks, some picked and waiting in the pick
    /// area, and the line carries no figure to tell them apart, so they are
    /// not split here.
    let plus = 0
    let minus = 0
    let fromCartons = 0
    for (const [key, one] of original) {
      was += one.target
      const now = Math.max(typed[key] ?? 0, one.floor)
      if (now !== one.target) {
        changed.push({ allotment_line_id: one.line.id, to: now })
        if (now > one.target) plus += now - one.target
        else {
          minus += one.target - now
          fromCartons += changeOf(one.line, now)?.owed ?? 0
        }
      }
    }
    const add: {
      sku_id: string
      destination_id: string
      quantity: number
      source_pool_id: string
    }[] = []
    for (const [key, quantity] of Object.entries(typed)) {
      if (quantity <= 0 || original.has(key)) continue
      plus += quantity
      const [skuId, destinationId] = key.split("\u0000")
      add.push({
        sku_id: skuId,
        destination_id: destinationId,
        quantity,
        source_pool_id: source,
      })
    }
    const now = Object.values(typed).reduce((total, one) => total + one, 0)
    return { lines: changed, add, was, now, plus, minus, fromCartons }
  }, [original, typed, source])

  /// A SKU asked past what is free to this allotment.
  const overdrawn = useMemo(() => {
    const asked = new Map<string, number>()
    for (const [key, quantity] of Object.entries(typed)) {
      const sku = key.split("\u0000")[0]
      asked.set(sku, (asked.get(sku) ?? 0) + quantity)
    }
    return groups
      .flatMap((group) => group.skus)
      .filter(
        (item) =>
          (asked.get(item.sku_id) ?? 0) >
          item.on_hand_qty + (extra.get(item.sku_id) ?? 0)
      )
  }, [typed, groups, extra])

  const changes = change.lines.length + change.add.length
  const retry = useRef<{ payload: string; key: string } | null>(null)
  const save = useMutation({
    mutationFn: () => {
      const payload = { lines: change.lines, add: change.add }
      const fingerprint = JSON.stringify(payload)
      const key =
        retry.current?.payload === fingerprint
          ? retry.current.key
          : idempotencyKey()
      retry.current = { payload: fingerprint, key }
      return amendAllotment(id, { idempotency_key: key, ...payload })
    },
    onSuccess: (result) => {
      retry.current = null
      client.invalidateQueries({ queryKey: inventoryKeys.allotments() })
      client.invalidateQueries({ queryKey: inventoryKeys.fleet() })
      client.invalidateQueries({
        queryKey: ["inventory", "availability", source],
      })
      client.invalidateQueries({
        queryKey: ["inventory", "availability", "whole", source],
      })
      client.invalidateQueries({ queryKey: opsKeys.owed() })
      client.invalidateQueries({ queryKey: opsKeys.picklistsToPick() })
      toast.success(
        result.owed_total > 0
          ? `${result.allotment_number} saved · ${quantity(result.owed_total)} the warehouse moves back`
          : `${result.allotment_number} saved`
      )
      goto("/allotment", { key: "allotment", value: id })
    },
  })
  const back = () => goto("/allotment", { key: "allotment", value: id })

  const gridScroll = useRef<HTMLDivElement>(null)
  const [foot, setFoot] = useState(0)
  const footRef = useCallback((node: HTMLDivElement | null) => {
    if (node === null) return
    const observer = new ResizeObserver(() => setFoot(node.offsetHeight))
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const blocked =
    record === undefined
      ? null
      : record.activation_target_origin_id !== null
        ? "This allotment is run by its DC; edit it from the allotment."
        : record.cancellation !== null
          ? "This allotment is cancelled."
          : null

  const summary =
    changes === 0
      ? "No changes yet"
      : [
          change.lines.length > 0 &&
            `${count(change.lines.length)} ${change.lines.length === 1 ? "line" : "lines"} changed`,
          change.add.length > 0 &&
            `${count(change.add.length)} ${change.add.length === 1 ? "line" : "lines"} added`,
          change.plus > 0 && `+${count(change.plus)} to pick`,
          change.minus > 0 && `−${count(change.minus)} removed`,
          change.fromCartons > 0 &&
            `${count(change.fromCartons)} in cartons move back`,
        ]
          .filter(Boolean)
          .join(" · ")

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col px-3 pt-3 pb-3 [--form-box:2.75rem] md:px-4 min-[100rem]:pt-4 min-[100rem]:[--form-box:2.9375rem]">
      <div className="shrink-0 px-1">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-x-8 gap-y-2 rounded-card bg-soft px-4 py-3">
          <div className="min-w-0">
            <h1 className="truncate text-[1.25rem] leading-tight font-semibold text-ink">
              Edit {record?.allotment_number ?? "allotment"}
            </h1>
            {groups.length > 0 && (
              <p className="mt-0.5 text-[0.875rem] text-mute tabular-nums">
                {groups.map((group) => group.name).join(", ")}
              </p>
            )}
          </div>
          {changes > 0 ? (
            <ConfirmButton
              label={
                <>
                  <ArrowLeft />
                  Back
                </>
              }
              title="Discard the changes?"
              description="The allotment stays as it was."
              confirmLabel="Discard"
              tone="danger"
              onConfirm={back}
            />
          ) : (
            <Button onClick={back}>
              <ArrowLeft />
              Back
            </Button>
          )}
        </div>
      </div>

      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-card border border-hairline bg-canvas shadow-soft">
        {phone && destinations.length > 1 && storeHere !== undefined && (
          <StorePicker
            stores={destinations}
            on={storeHere.id}
            totals={perDestination}
            onPick={setChosenStore}
          />
        )}
        {blocked !== null ? (
          <div className="flex-1 p-4 md:p-5">
            <EmptyState>{blocked}</EmptyState>
          </div>
        ) : record === undefined || cells === null || stock.isPending ? (
          detail.isError ? (
            <div className="flex-1 p-4 md:p-5">
              <Problem error={detail.error} />
            </div>
          ) : (
            <div className="flex-1 p-4 md:p-5">
              <EmptyState>Reading the allotment…</EmptyState>
            </div>
          )
        ) : (
          <Matrix
            rows={rows}
            destinations={columns}
            cells={typed}
            perDestination={perDestination}
            standing={new Map()}
            raised={new Map()}
            shut={shut}
            focused={focus}
            saving={null}
            scrollRef={gridScroll}
            foot={foot}
            fill={fill}
            onToggle={toggle}
            onCell={setCell}
            onFocus={(article) => setFocus(article)}
            onSave={() => undefined}
            floors={floors}
            extra={extra}
          />
        )}
        <div
          ref={footRef}
          className="pointer-events-none absolute inset-x-0 bottom-0 z-30 px-3 pb-3 md:px-4 md:pb-5"
        >
          <div className="pointer-events-auto mx-auto flex w-full max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 rounded-card border border-hairline-strong bg-canvas px-4 py-3 shadow-[0_10px_32px_-8px_rgb(0_0_0/0.22)]">
            <dl className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
              <Figure label="Was" value={`${count(change.was)} pcs`} />
              <Figure label="Now" value={`${count(change.now)} pcs`} />
            </dl>
            <span
              className={cn(
                "text-[0.875rem]",
                overdrawn.length > 0 ? "text-bad-fg" : "text-mute"
              )}
            >
              {overdrawn.length > 0
                ? `Too many: ${listOf(overdrawn.map((item) => item.sku_code))}`
                : summary}
            </span>
            <Button
              variant="primary"
              className="ml-auto"
              pending={save.isPending}
              disabled={changes === 0 || overdrawn.length > 0}
              onClick={() => save.mutate()}
            >
              Save changes
            </Button>
            <Problem error={save.error} className="basis-full" />
          </div>
        </div>
      </div>
    </div>
  )
}

/// Quick fill for one article: the wand on its row.
interface ArticleFill {
  readonly stores: readonly FillStore[]
  readonly onFill: (group: ArticleGroup, plan: FillPlan) => void
  readonly onClear: (group: ArticleGroup) => void
  /// Something is typed into one of its rows.
  readonly typed: (group: ArticleGroup) => boolean
}

/// One line of the draft, with the SKU it is for.
type DraftLine = CreateAllotmentLine & { readonly item: AvailabilityItem }

/// Where an article stands: all it has, what the draft gives, what is left,
/// and the lines that give it.
interface Standing {
  stock: number
  given: number
  left: number
  /// A SKU of it is promised past what is free.
  over: boolean
  /// Every piece has to be given before it can be saved. Not so for a top-up
  /// or a re-allot, which add or move a part of what was allotted.
  whole: boolean
  lines: DraftLine[]
}

/// One allotment Save raised, and the article it is for.
interface RaisedAllotment {
  readonly result: CreateAllotmentResult
  readonly article: string
  readonly articleId: string
  /// Whose goods it was, so each supplier's receipt lists its own.
  readonly supplierId: string
}

/// How long a save may go unanswered before the page stops waiting.
const SAVE_TIMEOUT = 45_000

/// What the banner says when it did. The allotment may still have been
/// raised, so the advice is to look before trying again.
const TIMED_OUT =
  "the server did not answer in time. Check Allotments before saving again."

class SaveTimeout extends Error {
  constructor() {
    super(TIMED_OUT)
  }
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new SaveTimeout()), ms)
    work.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}

function readDraft(): Record<string, number> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? "{}")
    if (typeof parsed !== "object" || parsed === null) return {}
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, number] =>
          typeof entry[1] === "number" && entry[1] > 0
      )
    )
  } catch {
    // Storage denied or the value mangled: start empty rather than not at all.
    return {}
  }
}

function writeDraft(cells: Readonly<Record<string, number>>) {
  try {
    if (Object.keys(cells).length === 0) localStorage.removeItem(DRAFT_KEY)
    else localStorage.setItem(DRAFT_KEY, JSON.stringify(cells))
  } catch {
    // A draft that cannot be kept is still a draft on screen.
  }
}

/// The heading row of both boxes. The same number on both sides, because the
/// rows under them line up only if the rows start at the same height.
const HEADER = "h-[4.75rem]"

/// The bar above each box, the same height on both sides so the rows under
/// them still line up.
const TOOLBAR = "flex h-[4rem] shrink-0 items-center px-4"

/// A phone's way across the stores: the one on screen, named with what has been
/// typed for it, and a sheet of all of them (each with its own total, and a
/// search over thirteen) behind a tap. Arrows beside it step to the next store
/// without opening anything, which is how a store is walked through when the
/// quantities come store by store.
///
/// It was a chip each in a row: thirteen of them ran 941px inside a 388px card,
/// scrolled sideways with the scrollbar hidden, and nothing said so.
function StorePicker({
  stores,
  on,
  totals,
  onPick,
}: {
  stores: readonly Destination[]
  on: string
  totals: ReadonlyMap<string, number>
  onPick: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const index = Math.max(
    0,
    stores.findIndex((store) => store.id === on)
  )
  const here = stores[index]
  const total = totals.get(here.id) ?? 0
  const step = (by: -1 | 1) => onPick(stores[index + by].id)
  const arrow =
    "grid size-11 shrink-0 place-items-center rounded-inner border border-hairline text-body transition-[scale] duration-(--t-press) ease-(--ease-out) active:scale-[0.94] disabled:opacity-40 disabled:active:scale-100"
  return (
    <div className="flex shrink-0 items-center gap-2 px-4 pb-3">
      <button
        type="button"
        aria-label="Previous store"
        disabled={index === 0}
        onClick={() => step(-1)}
        className={arrow}
      >
        <ChevronLeft className="size-5" />
      </button>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-label={`Store: ${here.name}`}
        onClick={() => setOpen(true)}
        className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-inner border border-ink bg-soft-2 px-3 text-left text-[0.9375rem] font-medium text-ink transition-[scale] duration-(--t-press) ease-(--ease-out) active:scale-[0.98]"
      >
        <span className="min-w-0 flex-1 truncate">{here.name}</span>
        {total > 0 && (
          <span className="font-medium text-accent tabular-nums">
            {count(total)}
          </span>
        )}
        <ChevronDown className="size-4 shrink-0 text-line-ico" />
      </button>
      <button
        type="button"
        aria-label="Next store"
        disabled={index === stores.length - 1}
        onClick={() => step(1)}
        className={arrow}
      >
        <ChevronRight className="size-5" />
      </button>
      <PickerSheet
        open={open}
        onOpenChange={setOpen}
        title="Store"
        selected={[here.id]}
        onPick={onPick}
        options={stores.map((store) => {
          const typed = totals.get(store.id) ?? 0
          return {
            value: store.id,
            text: store.name,
            label: (
              <span className="flex items-center gap-3">
                <span className="min-w-0 flex-1 truncate">{store.name}</span>
                {typed > 0 && (
                  <span className="font-medium text-accent tabular-nums">
                    {count(typed)}
                  </span>
                )}
              </span>
            ),
          }
        })}
      />
    </div>
  )
}

/// The grid. One scroll box, scrolling both ways, with the headings stuck to
/// the top and the identity of each row stuck to the left — because the two
/// questions a matrix is read to answer are "which store is this column" and
/// "which SKU is this row", and a matrix that cannot answer both at once is a
/// spreadsheet somebody has scrolled too far.
function Matrix({
  rows,
  destinations,
  cells,
  perDestination,
  standing,
  raised,
  shut,
  focused,
  saving,
  scrollRef,
  foot,
  fill,
  onToggle,
  onCell,
  onFocus,
  onSave,
  floors,
  extra,
}: {
  rows: readonly MatrixRow[]
  destinations: readonly Destination[]
  cells: Readonly<Record<string, number>>
  perDestination: ReadonlyMap<string, number>
  standing: ReadonlyMap<string, Standing>
  raised: ReadonlyMap<string, RaisedAllotment>
  shut: ReadonlySet<string>
  focused: string | null
  /// The articles a save is running for, or null.
  saving: readonly string[] | null | undefined
  scrollRef: React.RefObject<HTMLDivElement | null>
  /// Room kept under the last row for the floating summary, in pixels.
  foot: number
  fill: ArticleFill
  onToggle: (article: string) => void
  onCell: (key: string, quantity: number) => void
  onFocus: (article: string, destination: string | null) => void
  onSave: (article: string) => void
  /// Editing an allotment: the least each cell may hold (pieces already sent),
  /// by cell key.
  floors?: ReadonlyMap<string, number>
  /// Editing an allotment: what it already holds of each SKU, by SKU — free to
  /// it on top of what the pool has left, because the pool counts it as taken.
  extra?: ReadonlyMap<string, number>
}) {
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) =>
      rows[index].kind === "article" ? ARTICLE_ROW : SKU_ROW,
    overscan: 10,
  })

  return (
    <div
      ref={scrollRef}
      onKeyDown={moveByArrows}
      className="min-h-0 flex-1 overflow-auto"
      // Focus scrolls a box clear of the sticky headings and of the card.
      style={{ scrollPaddingTop: "4.75rem", scrollPaddingBottom: foot }}
    >
      {/* `w-max` so the row is as wide as its columns and the box scrolls
          sideways rather than squeezing 4.5rem cells into 2. */}
      <div className="w-max min-w-full" style={{ paddingBottom: foot }}>
        <div
          className={cn(
            HEADER,
            "sticky top-0 z-20 flex items-stretch bg-canvas"
          )}
        >
          <div
            className={cn(
              IDENTITY,
              "sticky left-0 z-10 flex items-center bg-canvas text-[0.875rem] font-medium text-mute"
            )}
          >
            Article
          </div>
          {/* Stock: what this row still has to give. It is the pool's free
              quantity — the stock less what other allotments already hold —
              because that is the number every box is typed against and the
              number that has to reach zero. The full equation rides in the
              tooltip, and lives on Availability. */}
          <div
            className={cn(
              FREE,
              STUCK,
              "flex items-center justify-end bg-canvas text-[0.875rem] font-medium text-mute"
            )}
          >
            Stock
          </div>
          {destinations.map((destination) => {
            const total = perDestination.get(destination.id) ?? 0
            return (
              <div
                key={destination.id}
                title={destination.name}
                className={cn(
                  COLUMN,
                  "flex flex-col items-center justify-center leading-5",
                  total > 0 && "bg-accent-bg"
                )}
              >
                <span
                  className={cn(
                    "max-w-full truncate text-[0.875rem] font-semibold",
                    total > 0 ? "text-accent" : "text-body"
                  )}
                >
                  {destination.code}
                </span>
                <span className="max-w-full truncate text-[0.875rem] text-mute">
                  {destination.label}
                </span>
                {/* The column total lives in the heading: it is the answer to
                    "what is this store getting", asked while looking at the
                    column, not after scrolling to the bottom of it. */}
                <span
                  className={cn(
                    "text-[0.875rem] tabular-nums",
                    total > 0 ? "font-medium text-accent" : "text-faint"
                  )}
                >
                  {total > 0 ? count(total) : "—"}
                </span>
              </div>
            )
          })}
          <div
            className={cn(
              LEFT,
              "flex items-center justify-end bg-canvas text-[0.875rem] font-medium text-mute"
            )}
          >
            Left
          </div>
        </div>

        <div
          className="relative"
          style={{ height: virtualizer.getTotalSize() }}
        >
          {virtualizer.getVirtualItems().map((slot) => {
            const row = rows[slot.index]
            return (
              <div
                key={row.key}
                className="absolute top-0 left-0 flex w-full items-stretch"
                style={{
                  height: slot.size,
                  transform: `translateY(${slot.start}px)`,
                }}
              >
                {row.kind === "article" ? (
                  <ArticleRow
                    group={row.group}
                    destinations={destinations}
                    cells={cells}
                    standing={standing.get(row.group.id)}
                    raised={raised.get(row.group.id)}
                    open={!shut.has(row.group.id)}
                    focused={row.group.id === focused}
                    saving={saving?.includes(row.group.id) ?? false}
                    fill={fill}
                    onToggle={() => {
                      onToggle(row.group.id)
                      onFocus(row.group.id, null)
                    }}
                    onSave={() => onSave(row.group.id)}
                  />
                ) : (
                  <SkuRow
                    item={row.item}
                    lead={leads(rows[slot.index - 1], row.item)}
                    destinations={destinations}
                    cells={cells}
                    floors={floors}
                    extra={extra}
                    onCell={onCell}
                    onFocus={(destination) =>
                      onFocus(row.item.article_id, destination)
                    }
                  />
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/// The article, what is being sent of it, and whether it is done.
///
/// It is a heading and a subtotal at once, and it folds: clicking it closes
/// the article's SKUs here and in the report together. The right-hand gutter
/// is the article's state — what is left to give, the Save that appears when
/// nothing is, and the allotment number once it is saved.
function ArticleRow({
  group,
  destinations,
  cells,
  standing,
  raised,
  open,
  focused,
  saving,
  fill,
  onToggle,
  onSave,
}: {
  group: ArticleGroup
  destinations: readonly Destination[]
  cells: Readonly<Record<string, number>>
  standing: Standing | undefined
  raised: RaisedAllotment | undefined
  open: boolean
  focused: boolean
  saving: boolean
  fill: ArticleFill
  onToggle: () => void
  onSave: () => void
}) {
  const subtotal = (destinationId: string) =>
    group.skus.reduce(
      (total, sku) => total + (cells[cellKey(sku.sku_id, destinationId)] ?? 0),
      0
    )

  return (
    <>
      {/* The fold and the wand side by side, not one inside the other: a
          button cannot hold a button. */}
      <div
        className={cn(
          IDENTITY,
          "sticky left-0 z-10 flex items-center gap-1 pr-1.5 max-md:pl-1",
          focused ? "bg-accent-bg" : "bg-soft"
        )}
      >
        {/* The photograph is a button of its own (a tap shows it full size),
            so the fold is two buttons round it rather than one that holds it. */}
        <div className="flex h-full min-w-0 flex-1 items-center gap-3 max-md:gap-1.5">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            aria-label={`${open ? "Fold" : "Open"} ${group.name}`}
            className="grid h-full shrink-0 place-items-center"
          >
            <ChevronRight
              className={cn(
                "size-4 text-mute transition-transform duration-150",
                open && "rotate-90"
              )}
            />
          </button>
          <ArticleThumb
            url={group.image}
            name={group.name}
            division={group.division}
            colour={group.skus[0]?.colour}
            articleCode={group.code}
          />
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            className="h-full min-w-0 flex-1 text-left"
          >
            <span
              className={cn(
                "block truncate text-[0.875rem] font-medium",
                focused ? "text-accent" : "text-ink"
              )}
            >
              {group.name}
            </span>
            <ArticleMeta group={group} />
            <ArticleRule standing={standing} />
          </button>
        </div>
        <QuickFillMenu
          article={group.name}
          stores={fill.stores}
          onFill={(plan) => fill.onFill(group, plan)}
          onClear={() => fill.onClear(group)}
          canClear={fill.typed(group)}
        />
      </div>
      <div
        className={cn(
          FREE,
          STUCK,
          "flex items-center justify-end text-[0.875rem] font-medium tabular-nums",
          focused ? "bg-accent-bg" : "bg-soft",
          group.free > 0 ? "text-ink" : "text-faint"
        )}
        title={
          group.free === group.stock
            ? undefined
            : `${count(group.stock)} in the pool, ${count(group.stock - group.free)} already spoken for`
        }
      >
        {count(group.free)}
      </div>
      {destinations.map((destination) => {
        const total = subtotal(destination.id)
        return (
          <div
            key={destination.id}
            className={cn(
              COLUMN,
              "flex items-center justify-center bg-soft text-[0.875rem] tabular-nums",
              total > 0 ? "font-medium text-accent" : "text-faint"
            )}
          >
            {total > 0 ? count(total) : ""}
          </div>
        )
      })}
      <div
        className={cn(
          LEFT,
          "flex items-center justify-end bg-soft text-[0.875rem] tabular-nums"
        )}
      >
        <ArticleState
          standing={standing}
          raised={raised}
          saving={saving}
          onSave={onSave}
        />
      </div>
    </>
  )
}

/// The rule, said on the row once the article has numbers in it: every piece
/// goes to a store or the article cannot be saved. Quiet green when it has.
/// A top-up adds to an allotment that exists, so it may be a part.
function ArticleRule({ standing }: { standing: Standing | undefined }) {
  if (standing === undefined || standing.given === 0 || standing.over)
    return null
  if (!standing.whole)
    return (
      <span className="block truncate text-[0.875rem] text-mute">
        Top-up: adds to the allotment
      </span>
    )
  return standing.left === 0 ? (
    <span className="block truncate text-[0.875rem] text-ok-fg">
      All {count(standing.stock)} allotted
    </span>
  ) : (
    <span className="block truncate text-[0.875rem] text-warn-fg">
      Allot all {count(standing.stock)} pieces — {count(standing.left)} left
    </span>
  )
}

/// The right-hand gutter of an article row, in the order it happens: stock
/// waiting, stock left over, finished and savable, saved.
function ArticleState({
  standing,
  raised,
  saving,
  onSave,
}: {
  standing: Standing | undefined
  raised: RaisedAllotment | undefined
  saving: boolean
  onSave: () => void
}) {
  if (standing === undefined || (standing.given === 0 && raised === undefined))
    return (
      <span className="text-faint">
        {standing ? count(standing.stock) : ""}
      </span>
    )
  if (standing.given === 0 && raised !== undefined)
    return (
      <span
        className="truncate font-medium text-ok-fg"
        title={`Saved as ${raised.result.allotment_number}`}
      >
        {raised.result.allotment_number}
      </span>
    )
  if (standing.over)
    return <span className="font-medium text-bad-fg">Too many</span>
  if (standing.left > 0 && standing.whole)
    return (
      <Button
        variant="primary"
        disabled
        title="Every piece has to go to a store before this article can be saved"
        className="h-9 px-3 text-[0.875rem]"
      >
        Submit
      </Button>
    )
  return (
    <Button
      variant="primary"
      pending={saving}
      onClick={onSave}
      className="h-9 px-3 text-[0.875rem]"
    >
      Submit
    </Button>
  )
}

/// One SKU, and the boxes it is spread across.
function SkuRow({
  item,
  lead,
  destinations,
  cells,
  floors,
  extra,
  onCell,
  onFocus,
}: {
  item: AvailabilityItem
  /// The first row of its colourway: the one that carries the photograph, so a
  /// size run of six is one picture and not six.
  lead: boolean
  destinations: readonly Destination[]
  cells: Readonly<Record<string, number>>
  floors?: ReadonlyMap<string, number>
  extra?: ReadonlyMap<string, number>
  onCell: (key: string, quantity: number) => void
  onFocus: (destination: string) => void
}) {
  const allotted = destinations.reduce(
    (total, destination) =>
      total + (cells[cellKey(item.sku_id, destination.id)] ?? 0),
    0
  )
  /// What the pool can still promise of this SKU: its stock less what other
  /// allotments have already taken, which is the quantity the server checks
  /// each line against. An allotment being edited also has what it already
  /// holds of the SKU.
  const own = extra?.get(item.sku_id) ?? 0
  const free = item.on_hand_qty + own
  const left = free - allotted

  return (
    <>
      <div
        className={cn(
          IDENTITY,
          "sticky left-0 z-10 flex items-center gap-2 bg-canvas pl-[1.875rem] md:gap-3 md:pl-10"
        )}
      >
        {/* The box is there on every row, so the names line up whether or not
            this row carries the picture. */}
        {lead ? (
          <ArticleThumb
            url={item.image_url}
            name={item.article_name}
            division={item.division_code}
            colour={item.colour}
            articleCode={item.article_code}
            digit={colourDigitOf(item.article_code, item.sku_code)}
          />
        ) : (
          <span aria-hidden className="size-8 shrink-0" />
        )}
        <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5">
          <span className="text-cell text-ink max-md:line-clamp-2 md:truncate">
            {[item.colour, item.size].filter(Boolean).join(" · ") || "—"}
          </span>
          {/* The SKU number, which is what a label and a picker read. Gone on
              a phone, where the frozen column is 12rem and the colour and size
              are all it can hold. */}
          <span className="truncate text-[0.875rem] text-mute tabular-nums max-md:hidden">
            {item.sku_code}
          </span>
        </div>
      </div>
      <div
        className={cn(
          FREE,
          STUCK,
          "flex items-center justify-end bg-canvas text-cell tabular-nums",
          free > 0 ? "text-body" : "text-faint"
        )}
        title={
          extra !== undefined
            ? `${count(item.on_hand_qty)} free in the pool, ${count(own)} already on this allotment`
            : free === item.stock_qty
              ? undefined
              : `${count(item.stock_qty)} in the pool, ${count(item.stock_qty - free)} already spoken for`
        }
      >
        {count(free)}
      </div>
      {destinations.map((destination) => {
        const key = cellKey(item.sku_id, destination.id)
        const here = cells[key] ?? 0
        return (
          <Cell
            key={destination.id}
            value={here}
            // What this box may still be filled to: everything free, less what
            // the other stores in the row have already taken. A row shares one
            // pile of garments, so the ceiling is the row's and not the cell's.
            most={Math.max(0, free - (allotted - here))}
            least={floors?.get(key) ?? 0}
            label={`${item.sku_code} to ${destination.name}`}
            row={item.sku_id}
            col={destination.id}
            onChange={(quantity) => onCell(key, quantity)}
            onFocus={() => onFocus(destination.id)}
          />
        )
      })}
      <div
        className={cn(
          LEFT,
          "flex items-center justify-end bg-canvas text-cell tabular-nums",
          left < 0
            ? "bg-bad-bg font-medium text-bad-fg"
            : allotted === 0
              ? "text-faint"
              : left === 0
                ? "text-ok-fg"
                : "font-medium text-warn-fg"
        )}
      >
        {allotted === 0 ? count(free) : count(left)}
      </div>
    </>
  )
}

/// Arrow keys move between the quantity boxes the way a spreadsheet does: left
/// and right along a SKU's stores, up and down the same store through the
/// SKUs. The boxes select their number on focus, so the next keystroke
/// replaces it. Rows are virtualised, but the neighbours are always inside the
/// overscan, so the DOM has them.
function moveByArrows(event: React.KeyboardEvent<HTMLElement>) {
  const target = event.target
  if (!(target instanceof HTMLInputElement) || !("cell" in target.dataset))
    return
  const step =
    event.key === "ArrowLeft"
      ? [0, -1]
      : event.key === "ArrowRight"
        ? [0, 1]
        : event.key === "ArrowUp"
          ? [-1, 0]
          : event.key === "ArrowDown" || event.key === "Enter"
            ? [1, 0]
            : null
  if (step === null || event.altKey || event.ctrlKey || event.metaKey) return
  const boxes = [
    ...event.currentTarget.querySelectorAll<HTMLInputElement>(
      "input[data-cell]"
    ),
  ]
  const rows: string[] = []
  const cols: string[] = []
  for (const box of boxes) {
    if (!rows.includes(box.dataset.row ?? "")) rows.push(box.dataset.row ?? "")
    if (!cols.includes(box.dataset.col ?? "")) cols.push(box.dataset.col ?? "")
  }
  const row = rows.indexOf(target.dataset.row ?? "") + step[0]
  const col = cols.indexOf(target.dataset.col ?? "") + step[1]
  const next = boxes.find(
    (box) => box.dataset.row === rows[row] && box.dataset.col === cols[col]
  )
  event.preventDefault()
  next?.focus()
}

/// A quantity, or nothing.
///
/// Blank rather than `0` when empty: a matrix of thirteen columns is mostly
/// empty by nature, and a grid of five hundred zeroes hides the twelve numbers
/// somebody actually typed. Non-digits are dropped as they are typed, and so
/// is a number the pool cannot answer — promising twenty out of four is not a
/// quantity to be corrected later.
function Cell({
  value,
  most,
  least = 0,
  label,
  row,
  col,
  onChange,
  onFocus,
}: {
  /// Where the box sits in the grid, for the arrow keys: the SKU and the store.
  row: string
  col: string
  value: number
  /// The largest number this box may hold — what is left of the SKU's free
  /// stock once the rest of its row has taken theirs.
  most: number
  /// The smallest: pieces of this line already sent, when an allotment is
  /// edited. Typing under it holds at it.
  least?: number
  label: string
  onChange: (quantity: number) => void
  onFocus: () => void
}) {
  /// True for a moment after a keystroke was held back. A field that stops
  /// changing while somebody types into it reads as broken unless it says
  /// why, and the reason is worth one flash, not a permanent marking.
  const [capped, setCapped] = useState(false)
  const flash = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(flash.current), [])

  return (
    <div className={cn(COLUMN, "flex items-center bg-canvas")}>
      <input
        type="text"
        inputMode="numeric"
        data-cell=""
        data-row={row}
        data-col={col}
        aria-label={label}
        value={value === 0 ? "" : String(value)}
        title={
          least > 0
            ? `${count(least)} already sent: it cannot go lower`
            : most === 0
              ? "Nothing of this SKU is left free in the pool"
              : undefined
        }
        onChange={(event) => {
          const digits = event.target.value.replace(/\D/g, "")
          const typed = digits === "" ? 0 : Number(digits)
          const kept = Math.max(least, Math.min(typed, Math.max(most, least)))
          if (kept !== typed) {
            setCapped(true)
            clearTimeout(flash.current)
            flash.current = setTimeout(() => setCapped(false), 900)
          }
          onChange(kept)
        }}
        onFocus={(event) => {
          event.target.select()
          onFocus()
        }}
        className={cn(
          // A thin border always, not only on hover (the owner, 2026-09-29):
          // a grid of blank cells did not read as somewhere to type.
          "h-11 w-full rounded-inner border border-hairline bg-canvas text-center text-cell tabular-nums transition-colors outline-none",
          "hover:border-hairline-2 focus:border-hairline-strong",
          capped
            ? "bg-warn-bg font-medium text-warn-fg"
            : value > 0
              ? "bg-accent-bg font-medium text-accent"
              : "text-ink"
        )}
      />
    </div>
  )
}

/// The grid's right-hand gutter: what is left, or the article's Save.
///
/// Pinned to the right edge the way the article is pinned to the left, so a
/// row's state and its Save are in sight wherever the stores are scrolled to
/// — at thirteen stores the gutter was otherwise off the edge, and the only
/// button that finishes an article was one nobody could see.
const LEFT =
  "sticky right-0 z-10 w-[5.5rem] shrink-0 px-1.5 text-right md:w-[7rem] md:px-3"

/// One labelled number on one line: label muted, figure semibold and
/// tabular, so a row of them never shifts as digits change.
function Figure({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="text-[0.875rem] whitespace-nowrap text-mute">{label}</dt>
      <dd className="text-[0.9375rem] font-semibold text-ink tabular-nums">
        {value}
      </dd>
    </div>
  )
}

/// What the draft adds up to, and the act itself.
///
/// A strip rather than a card at the foot of the page because the matrix
/// scrolls under it: the totals are the reason somebody is typing, and having
/// to scroll past nine hundred rows to read them would mean nobody ever did.
///
/// "A", "A and B", "A, B and C".
function listOf(names: readonly string[]): string {
  return names.length <= 1
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`
}

/// There is no Save here. An article is saved from its own row, the moment it
/// is used up — one way to save, not two (the owner, 29 Sep 2026: a footer
/// Save beside the rows' left nobody sure whether it saved everything or one
/// article). This strip says where the work stands instead: how many
/// articles are ready for their row's Save, how many still have stock left,
/// and the numbers already saved.
function Summary({
  articles,
  skus,
  pieces,
  lines,
  places,
  hidden,
  ready,
  progress,
  partial,
  overdrawn,
  actor,
  create,
  raised,
  onDone,
  onClear,
}: {
  /// Articles and SKUs the matrix is showing, whatever has been typed.
  articles: number
  skus: number
  pieces: number
  lines: number
  places: number
  hidden: number
  /// Articles whose Save is showing — what Save all sends.
  ready: readonly string[]
  progress: { done: number; total: number } | null
  /// Names of the articles typed into but not fully allotted.
  partial: readonly string[]
  overdrawn: readonly { item: AvailabilityItem; asked: number }[]
  actor: string
  create: ReturnType<
    typeof useMutation<void, Error, readonly string[], unknown>
  >
  raised: readonly RaisedAllotment[]
  /// Back to the Allotments page, this allotment finished. Absent while
  /// suppliers are still queued after this one.
  onDone: (() => void) | undefined
  onClear: () => void
}) {
  const finished = ready.length
  /// Moving on was tried while these were unfinished. Keyed by the names, so
  /// the banner goes when they are finished or cleared.
  const [tried, setTried] = useState("")
  const stuck = partial.length > 0 && tried === partial.join("|")
  const move = (after: () => void) => {
    if (partial.length > 0) return setTried(partial.join("|"))
    if (finished === 0) return after()
    saveAll(after)
  }
  const blocked = overdrawn.length > 0
  const busy = create.isPending
  /// Saves every ready article, one after another, then runs `after` only if
  /// none of them failed.
  const saveAll = (after?: () => void) => {
    if (ready.length === 0) return after?.()
    create.mutate(ready, { onSuccess: after })
  }
  const saving =
    busy && progress !== null && progress.total > 1
      ? `Submitting ${count(Math.min(progress.done + 1, progress.total))} of ${count(progress.total)}…`
      : null
  /// Named rather than counted: "3 SKUs are overdrawn" in a matrix of nine
  /// hundred rows is a fault without an address.
  const named = overdrawn
    .slice(0, 4)
    .map(
      (one) =>
        `${one.item.sku_code} (${count(one.item.on_hand_qty)} free, ${count(one.asked)} asked)`
    )
    .join(", ")

  return (
    <div className="pointer-events-auto mx-auto w-full max-w-5xl overflow-hidden rounded-card border border-hairline-strong bg-canvas shadow-[0_10px_32px_-8px_rgb(0_0_0/0.22)] transition-[opacity,translate] duration-200 ease-(--ease-out) motion-reduce:transition-none starting:translate-y-3 starting:opacity-0 motion-reduce:starting:translate-none motion-reduce:starting:opacity-100">
      {(create.isError ||
        blocked ||
        stuck ||
        actor === "" ||
        raised.length > 0) && (
        <div className="flex flex-col gap-2 px-4 pt-3">
          {raised.length > 0 && (
            <Receipt>
              Saved{" "}
              {raised
                .map((one) => `${one.result.allotment_number} (${one.article})`)
                .join(", ")}
              .
            </Receipt>
          )}

          {create.isError && (
            <Banner tone="bad">
              {create.error instanceof Error
                ? create.error.message
                : "The allotment was refused."}
              {create.error instanceof Error &&
              create.error.message.endsWith(TIMED_OUT)
                ? ""
                : " What was not saved is still in the grid."}
            </Banner>
          )}

          {stuck && (
            <Banner tone="warn">
              Finish {listOf(partial)} (stock left) or clear them before moving
              on.
            </Banner>
          )}

          {blocked && (
            <Banner tone="bad">
              Promised past what the pool holds free: {named}
              {overdrawn.length > 4 &&
                `, and ${count(overdrawn.length - 4)} more`}
              . They have to come down before their articles can be saved.
            </Banner>
          )}

          {actor === "" && (
            <Banner tone="warn">
              Every allotment names who raised it and there is no default. Sign
              in before saving.
            </Banner>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-2 px-4 py-3 md:gap-y-3 md:px-5">
        <div className="flex min-w-0 flex-col gap-1">
          {/* The counts, one line, always in this order: what is on the page
              (Articles, SKUs), then what the draft gives. */}
          <dl className="flex flex-wrap items-baseline gap-x-5 gap-y-1 md:gap-x-6">
            <div className="contents max-md:hidden">
              <Figure label="Articles" value={count(articles)} />
              <Figure label="SKUs" value={count(skus)} />
            </div>
            <Figure label="Pcs" value={count(pieces)} />
            <Figure label="Lines" value={count(lines)} />
            <Figure label="Stores" value={count(places)} />
          </dl>
          {(finished > 0 || partial.length > 0 || hidden > 0) && (
            <div className="flex flex-wrap gap-x-4 text-[0.875rem] tabular-nums">
              {finished > 0 && (
                <span className="font-medium text-accent">
                  {count(finished)} ready — Submit on{" "}
                  {finished === 1 ? "its row" : "their rows"}
                </span>
              )}
              {partial.length > 0 && (
                <span className="text-warn-fg">
                  {count(partial.length)}{" "}
                  {partial.length === 1
                    ? "article still has"
                    : "articles still have"}{" "}
                  stock left
                </span>
              )}
              {hidden > 0 && (
                <span className="text-warn-fg">
                  {count(hidden)} pieces on rows the filters hide
                </span>
              )}
            </div>
          )}
        </div>
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2 max-md:w-full">
          {pieces > 0 && (
            <Button variant="ghost" onClick={onClear}>
              Clear
            </Button>
          )}
          <Button
            variant="ghost"
            className="border border-hairline-2"
            disabled={finished === 0 || busy || blocked || actor === ""}
            pending={busy}
            onClick={() => saveAll()}
          >
            {saving ?? "Submit all"}
          </Button>
          {onDone && (
            <Button
              variant="primary"
              disabled={busy || (finished > 0 && (blocked || actor === ""))}
              onClick={() => move(onDone)}
            >
              {finished === 0 ? "Done" : "Submit all & done"}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
