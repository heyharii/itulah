import { node } from "@/lib/api"
import { arity, type Filter } from "@/lib/filters"
import type { ArticleConsequences, ProposedArticle } from "@itulah/contract"

/// The master product — article and SKU — read as itself rather than as a
/// side-effect of pricing it or counting it.
///
/// Until this module existed the only way to see an article was
/// `/api/v1/commercial/products`, which belongs to pricing: it always carries a
/// company price, caps out at 500 rows and cannot filter by division or tag. A
/// merchandiser asking "what do we sell" had to read a price list and ignore
/// half of it.
///
/// The interfaces below are transcribed from the Rust structs in
/// `cloud/postgres/articles.rs` rather than imported from `@itulah/contract`.
/// That is temporary and deliberate: it let this file exist before the server
/// did. Once `make contract` has run against the real structs these are
/// replaced by the generated types, and until then this file is where the two
/// can drift — check here first if a column reads `undefined`.

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

/// How many articles carry one value of a facet, across the whole catalogue.
export interface FacetCount {
  readonly value: string
  readonly count: number
}

/// One colourway of one article: which digit of the SKU it is, and which colour
/// from the master that digit means.
///
/// The digit is article-scoped — digit 3 on one article is not the same colour
/// as digit 3 on another — which is why the colour it points at has to be
/// carried alongside it rather than inferred.
export interface ArticleColourway {
  readonly colour_digit: string
  readonly colour_code: string
  readonly label: string
  readonly hex_code: string | null
}

/// One article as a row: what it is, what it comes in, and what it costs.
export interface ArticleRow {
  readonly article_code: string
  readonly name: string
  readonly active: boolean
  readonly division_code: string | null
  readonly image_url: string | null
  /// Tag codes, not labels. The label is what a person reads and can be
  /// edited; the code is what a filter must be written against.
  readonly tags: readonly string[]
  /// At most ten, ordered by digit. Ten is a permanent ceiling: the colour is
  /// one character of an eleven-digit SKU.
  readonly colours: readonly ArticleColourway[]
  readonly size_codes: readonly string[]
  readonly sku_count: number
  /// The floor price set at setup, as a range across this article's SKUs. Null
  /// where nothing has been priced — absent rather than zero, because no price
  /// is not a price of nothing.
  readonly base_price_min_minor: number | null
  readonly base_price_max_minor: number | null
  readonly currency: string | null
  readonly version: number
  readonly created_at: string
}

/// What the catalogue contains, beside the page of it being shown.
///
/// Counted over everything the search matches, NOT over the current selection:
/// choosing a division must not make the other divisions read zero, because the
/// facet list is how somebody sees what else is there.
export interface ArticleFacets {
  readonly divisions: readonly FacetCount[]
  readonly tags: readonly FacetCount[]
  readonly sizes: readonly FacetCount[]
  readonly colours: readonly FacetCount[]
}

export interface ArticlePage {
  readonly items: readonly ArticleRow[]
  /// Opaque. Pass it back for the next page; absent means this was the last.
  readonly next_cursor: string | null
  /// Every article the search matches, not just this page.
  readonly total: number
  readonly facets: ArticleFacets
}

/// One variant: a colourway in a size, and the identity it was minted with.
export interface ArticleSku {
  readonly sku_id: string
  readonly sku_code: string
  readonly colour_digit: string | null
  readonly colour_code: string | null
  readonly colour_label: string | null
  readonly size_code: string | null
  readonly size_label: string | null
  readonly base_price_minor: number | null
  readonly currency: string | null
  /// One QR per SKU, not per unit: the QR says *what* this is, the EPC says
  /// *which one*.
  readonly qr_payload: string | null
  readonly active: boolean
}

/// Who sells this article to us, and under what code of their own. The join
/// back from a supplier's vocabulary to ours — goods arrive carrying their
/// code, never ours.
export interface ArticleSupplierItem {
  readonly supplier_item_id: string
  readonly supplier_id: string
  readonly supplier_name: string
  readonly supplier_article_code: string
  readonly unit_price_minor: number | null
  readonly currency: string | null
}

/// What `GET /api/v1/articles/{code}` actually puts on the wire.
///
/// The row is a NAMED field rather than a flattened one, and that is the
/// server's deliberate choice, not an oversight: ts-rs cannot render
/// `#[serde(flatten)]` faithfully, so a flattened wire type would be one the
/// generator cannot describe — which is the hand-mirroring this contract exists
/// to avoid. `JournalEntryDetail` is shaped the same way for the same reason.
///
/// This is therefore the shape the generated `@itulah/contract` type will have,
/// and it is kept identical to it on purpose so the swap is an import change
/// and nothing else.
export interface ArticleDetailWire {
  readonly article: ArticleRow
  readonly skus: readonly ArticleSku[]
  /// The setup session that first minted this article, so a reader can get
  /// from a product back to the delivery that prompted it.
  readonly created_by_session_id: string | null
  readonly supplier_items: readonly ArticleSupplierItem[]
}

/// The same article, flat, which is how every screen wants to read it.
///
/// A sheet showing one article asks it forty questions — its name, its code,
/// its colourways, its SKUs — and making each one choose between `article.name`
/// and `skus` is a distinction with no meaning on screen. Flattening once here
/// is cheaper and safer than flattening at forty call sites, and it keeps the
/// wire mirror above honest rather than bending it to suit the UI.
export interface ArticleDetail extends ArticleRow {
  readonly skus: readonly ArticleSku[]
  readonly created_by_session_id: string | null
  readonly supplier_items: readonly ArticleSupplierItem[]
}

/// A colourway as the form submits it: a digit, and the colour it means.
export interface ArticleColourwayInput {
  readonly colour_digit: string
  readonly colour_code: string
}

/// What may be edited about an article from the Articles screen.
///
/// Notably absent: `article_code` and every `sku_code`. Identity is minted by
/// the centre through a setup session and is never editable afterwards — a
/// renamed code is a different product wearing an old one's history.
export interface UpdateArticleRequest {
  readonly name?: string
  /// Present-and-null clears it; absent leaves it alone.
  readonly division_code?: string | null
  readonly image_url?: string | null
  /// Absent leaves tags alone; present REPLACES them, so an empty list means
  /// "remove every tag".
  readonly tags?: readonly string[]
  readonly active?: boolean
  /// Present REPLACES the mapping. A digit that already has SKUs minted
  /// against it cannot be repointed at a different colour — the server refuses
  /// it, because goods already tagged and on a shelf would be silently
  /// renamed.
  readonly colours?: readonly ArticleColourwayInput[]
}

/// What an articles screen asks for. Every facet is a set: looking at kids and
/// footwear is looking at both, not at the intersection, which is empty.
export interface ArticleScope {
  /// Matches an article code, a SKU code, a name, a QR payload, an EPC, or the
  /// supplier's own code for it. One box, because a person holding a thing
  /// does not know which of those they are holding.
  readonly q?: string
  readonly divisionCodes?: readonly string[]
  readonly tagCodes?: readonly string[]
  readonly sizeCodes?: readonly string[]
  readonly colourCodes?: readonly string[]
  readonly active?: boolean
  /// Which way the master is read. `oldest` is the default and the order this
  /// endpoint has always answered in — the catalogue in the order it was built
  /// up. `newest` is `created_at` descending, which is what somebody asking
  /// "what is new" means; it is NOT the article code descending, because the
  /// seeded and legacy articles carry hand-written codes that sort above every
  /// code this server has minted.
  readonly sort?: "newest" | "oldest"
  readonly limit?: number
  /// From a previous page's `next_cursor`.
  readonly cursor?: string
}

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

/// Keys live beside the function that fetches them. `article(code)` is a prefix
/// of nothing else on purpose: editing one article invalidates that article and
/// the list it appears in, and neither of those needs to name the other.
export const articleKeys = {
  all: ["articles"] as const,
  list: (scope: ArticleScope) => ["articles", "list", scope] as const,
  article: (code: string) => ["articles", code] as const,
  /// What editing this article would do, keyed by the edit itself: the answer
  /// is about the proposed state, so two different proposals are two different
  /// questions and must not share a cache entry.
  consequences: (code: string, proposed: ProposedArticle) =>
    ["articles", code, "consequences", proposed] as const,
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/// One page of the catalogue, plus enough about the rest to describe it.
/// The filter chips, as the four sets `/api/v1/articles` answers.
///
/// The same shape `scopeFromFilters` has in `queries/procurement` and for the
/// same reason: the chips are the screen's language and the query string is the
/// server's, and one function that knows both is what stops a chip narrowing
/// nothing in silence.
///
/// Only the operators the endpoint can honour are translated, because the
/// fields declare only those — `division_code` and its three neighbours are
/// repeated positive sets, and there is no parameter for "is none of" or "is
/// empty". A clause the handler cannot carry would leave the list unchanged
/// while the chip above it claimed otherwise.
export function articleScopeFromFilters(
  filters: readonly Filter[]
): Partial<ArticleScope> {
  const scope: {
    -readonly [K in keyof ArticleScope]: ArticleScope[K]
  } = {}

  for (const { column, operator, values } of filters) {
    if (values.length === 0 && arity(operator) !== "none") continue

    switch (column) {
      case "division":
        if (operator === "is" || operator === "isAnyOf")
          scope.divisionCodes = values
        break
      case "tag":
        if (operator === "includesAnyOf") scope.tagCodes = values
        break
      case "colour":
        if (operator === "includesAnyOf") scope.colourCodes = values
        break
      case "size":
        if (operator === "includesAnyOf") scope.sizeCodes = values
        break
    }
  }

  return scope
}

export function searchArticles(scope: ArticleScope, signal?: AbortSignal) {
  const params = new URLSearchParams()
  if (scope.q !== undefined && scope.q !== "") params.set("q", scope.q)
  // One parameter repeated, rather than one carrying a joined list. The server
  // accepts either — it splits on commas too — but repeating is the form that
  // needs no escaping rule, so nothing here has to know which characters a
  // future code is allowed to contain.
  for (const code of scope.divisionCodes ?? [])
    params.append("division_code", code)
  for (const code of scope.tagCodes ?? []) params.append("tag_code", code)
  for (const code of scope.sizeCodes ?? []) params.append("size_code", code)
  for (const code of scope.colourCodes ?? []) params.append("colour_code", code)
  if (scope.active !== undefined) params.set("active", String(scope.active))
  // Only when it is not the default. The plain URL is the plain catalogue, and
  // one spelling of "no order chosen" is what stops two query keys standing
  // for the same page.
  if (scope.sort !== undefined && scope.sort !== "oldest")
    params.set("sort", scope.sort)
  if (scope.limit !== undefined) params.set("limit", String(scope.limit))
  if (scope.cursor !== undefined) params.set("cursor", scope.cursor)
  const query = params.toString()
  return node.get<ArticlePage>(
    `/api/v1/articles${query === "" ? "" : `?${query}`}`,
    { signal }
  )
}

/// One article, whole: its colourways, its SKUs, and who sells it to us.
export async function articleDetail(
  articleCode: string,
  signal?: AbortSignal
): Promise<ArticleDetail> {
  const wire = await node.get<ArticleDetailWire>(
    `/api/v1/articles/${encodeURIComponent(articleCode)}`,
    { signal }
  )
  return flatten(wire)
}

/// The one place the wire's shape becomes the app's. Keeping it to one function
/// is what makes the difference cheap to remove if the server ever flattens.
function flatten(wire: ArticleDetailWire): ArticleDetail {
  return {
    ...wire.article,
    skus: wire.skus,
    created_by_session_id: wire.created_by_session_id,
    supplier_items: wire.supplier_items,
  }
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/// An idempotency key and, where a version is known, a strong quoted ETag — the
/// server refuses a write against a version somebody else has already moved
/// past, which is how two merchandisers editing one article stop being a silent
/// last-write-wins.
function guarded(
  idempotencyKey: string,
  version?: number
): Record<string, string> {
  const headers: Record<string, string> = {
    "Idempotency-Key": idempotencyKey,
  }
  if (version !== undefined) headers["If-Match"] = `"${version}"`
  return headers
}

export async function updateArticle(
  articleCode: string,
  request: UpdateArticleRequest,
  version: number,
  idempotencyKey: string,
  signal?: AbortSignal
): Promise<ArticleDetail> {
  // The write answers with the same shape the read does, so it is flattened by
  // the same function — a saved article that arrived shaped differently from a
  // loaded one would put the difference into every caller.
  const wire = await node.request<ArticleDetailWire>(
    "PATCH",
    `/api/v1/articles/${encodeURIComponent(articleCode)}`,
    request,
    { signal, headers: guarded(idempotencyKey, version) }
  )
  return flatten(wire)
}

/// What editing this article would do to the promotions around it.
///
/// Asked with the state the form is PROPOSING, not with a diff: the server
/// compares it against what is on record. A promotion that has not started can
/// still change what it will cover, so that is the half worth interrupting
/// somebody for; the started half is reported separately and quietly.
///
/// A POST because the question carries a set of tags, and a GET would put them
/// in a query string with a length limit and worse escaping. It writes nothing.
export function articleConsequences(
  articleCode: string,
  proposed: ProposedArticle,
  signal?: AbortSignal
) {
  return node.post<ArticleConsequences>(
    `/api/v1/articles/${encodeURIComponent(articleCode)}/consequences`,
    proposed,
    { signal }
  )
}
