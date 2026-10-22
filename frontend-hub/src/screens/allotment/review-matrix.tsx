import { count, sku as skuNumber } from "@/lib/format"
import { cn } from "@/lib/utils"
import { ArticleThumb, colourDigitOf } from "@/screens/allotment/article-thumb"

/// **The New allotment matrix, read only, as a lined grid** — MD's review
/// (allotment-review-flow.html, version C, owner 17 Oct 2026: "kita akan
/// selalu pertahankan matrix itu dimanapun di edit, detail dan review").
///
/// The same rows as New allotment — the article (photograph, name, code),
/// then one row per colour · size — and per store two columns, what was meant
/// (`before`) and what happened (`after`), so every figure has its own head
/// right above it. Every cell is lined; a darker line closes each store.
/// Only a cell that differs is coloured: red when pieces are short or extra,
/// amber when they went to the wrong store. A cell can say in words what the
/// difference is ("1 from C002"), so nobody has to subtract.
///
/// With more than one store the grid opens with All stores and closes with
/// Difference; with one store its After column already says it.

export interface ReviewSku {
  readonly sku_code: string
  readonly colour: string | null
  readonly size: string | null
}

export interface ReviewArticle {
  readonly article_code: string
  readonly article_name: string
  readonly image_url: string | null
  /// The division's name, for the row that heads its articles, as New
  /// allotment has it ("Pria · 1 article").
  readonly division?: string | null
  /// The article's tags, as chips under its name.
  readonly tags?: readonly string[]
  readonly skus: readonly ReviewSku[]
}

/// The articles under their divisions, in the order first met; one group
/// with no head when nothing says a division.
function divisionsOf(
  articles: readonly ReviewArticle[]
): [string | null, ReviewArticle[]][] {
  const groups = new Map<string | null, ReviewArticle[]>()
  for (const article of articles) {
    const division = article.division?.trim() || null
    groups.set(division, [...(groups.get(division) ?? []), article])
  }
  return [...groups.entries()]
}

export interface ReviewStore {
  readonly id: string
  readonly code: string
  readonly name: string
  /// Under the store's name: "Not counted", "Not arrived".
  readonly note?: string
  /// Its count still waits for MD: the head is red (owner, 20 Oct 2026).
  readonly problem?: boolean
}

export interface ReviewCell {
  readonly before: number
  /// `null`: not known yet (a store that has not counted).
  readonly after: number | null
  /// Amber: the pieces went to the wrong store. Otherwise any difference is
  /// red.
  readonly wrongStore?: boolean
  /// The difference in words, under the figure.
  readonly say?: string
  /// What MD's answer made of it ("Missing", "→ HO", "kept").
  readonly out?: string
}

type Tone = "bad" | "warn" | "wait" | null

function toneOf(cell: ReviewCell): Tone {
  if (cell.after === null) return "wait"
  if (cell.after === cell.before) return null
  return cell.wrongStore ? "warn" : "bad"
}

const TONE: Record<Exclude<Tone, null>, string> = {
  bad: "bg-bad-bg font-semibold text-bad-fg",
  warn: "bg-warn-bg font-semibold text-warn-fg",
  wait: "bg-soft text-mute",
}

const signed = (n: number) => (n > 0 ? `+${count(n)}` : `−${count(-n)}`)

/// A figure; nothing is a quiet dash.
function Figure({ n }: { n: number }) {
  return n === 0 ? <span className="text-faint">—</span> : <>{count(n)}</>
}

export function ReviewMatrix({
  before,
  after,
  articles,
  stores,
  cell,
  onCell,
  onlyDifferences = false,
}: {
  /// The two columns' heads: "Asked" / "Picked", "Sent" / "Counted".
  before: string
  after: string
  articles: readonly ReviewArticle[]
  stores: readonly ReviewStore[]
  /// One SKU at one store; `null` when the store was meant nothing of it and
  /// got nothing of it.
  cell: (sku: string, store: string) => ReviewCell | null
  /// A coloured cell opens what decides it (owner, 20 Oct 2026).
  onCell?: (sku: string, store: string) => void
  /// Only the sizes some store got otherwise than sent, or has not counted.
  onlyDifferences?: boolean
}) {
  const all = stores.length > 1
  const groups = [
    ...(all ? [{ id: "", code: "All stores", name: "", note: undefined }] : []),
    ...stores,
  ]
  const at = (sku: string, store: string): ReviewCell =>
    cell(sku, store) ?? { before: 0, after: 0 }
  /// A row's figures in one group: one store's, or All stores' — which waits
  /// until every store has counted.
  const figures = (skus: readonly string[], group: string): ReviewCell => {
    const ids = group === "" ? stores.map((one) => one.id) : [group]
    let before = 0
    let afterSum = 0
    let known = true
    let say: string | undefined
    let out: string | undefined
    let wrongStore = false
    for (const sku of skus)
      for (const id of ids) {
        const one = at(sku, id)
        before += one.before
        if (one.after === null) known = false
        else afterSum += one.after
        if (group !== "" && skus.length === 1) {
          say = one.say
          out = one.out
          wrongStore = one.wrongStore ?? false
        }
      }
    return { before, after: known ? afterSum : null, say, out, wrongStore }
  }

  const head =
    "h-11 border-b border-r border-hairline px-3 text-center font-medium text-body"
  const td =
    "h-[3.25rem] border-b border-r border-hairline px-3 text-center tabular-nums"

  const groupCells = (skus: readonly string[], total: boolean) =>
    groups.map((group) => {
      const one = figures(skus, group.id)
      const tone = toneOf(one)
      const sku = skus[0]
      const open =
        onCell !== undefined &&
        !total &&
        group.id !== "" &&
        sku !== undefined &&
        (tone === "bad" || tone === "warn")
          ? () => onCell(sku, group.id)
          : undefined
      return (
        <GroupCells
          key={group.id || "all"}
          one={one}
          tone={tone}
          total={total}
          td={td}
          onOpen={open}
        />
      )
    })
  /// A size some store got otherwise than sent, or has not counted.
  const differs = (sku: string) =>
    stores.some((store) => {
      const one = at(sku, store.id)
      return one.after === null || one.after !== one.before
    })

  const difference = (skus: readonly string[], total: boolean) => {
    if (!all) return null
    const one = figures(skus, "")
    const d = one.after === null ? null : one.after - one.before
    return (
      <td
        className={cn(
          td,
          "border-r-0",
          d === null && TONE.wait,
          d !== null && d !== 0 && !total && TONE.bad,
          d !== null && d !== 0 && total && "font-semibold text-bad-fg"
        )}
      >
        {d === null ? (
          "…"
        ) : d === 0 ? (
          <span className="text-faint">—</span>
        ) : (
          signed(d)
        )}
      </td>
    )
  }

  return (
    <div className="overflow-x-auto rounded-card border border-hairline-strong">
      <table
        className="w-full table-fixed border-separate border-spacing-0 text-[0.9375rem] [&_tbody_tr:last-child>*]:border-b-0 [&_tr>*:last-child]:border-r-0"
        // Room for every figure and its head ("Received") however many stores:
        // a phone scrolls the grid sideways under the article, which stays
        // put (e2e 20 Oct 2026: at 414 px the heads ran into each other).
        style={{
          minWidth: `calc(8.5rem + ${groups.length * 2} * 5.5rem + ${all ? 6.5 : 0}rem)`,
        }}
      >
        <colgroup>
          <col className="w-[20rem] max-md:w-[8.5rem]" />
          {groups.flatMap((group) => [
            <col key={`${group.id}b`} />,
            <col key={`${group.id}a`} />,
          ])}
          {all && <col />}
        </colgroup>
        <thead>
          <tr>
            <th
              rowSpan={2}
              className={cn(
                head,
                "sticky left-0 z-[1] border-r-hairline-strong border-b-hairline-strong bg-soft text-left"
              )}
            >
              Article
            </th>
            {groups.map((group) => (
              <th
                key={group.id || "all"}
                colSpan={2}
                className={cn(
                  head,
                  "h-16 border-r-hairline-strong",
                  "problem" in group && group.problem
                    ? "bg-bad-bg text-bad-fg"
                    : "bg-soft"
                )}
              >
                <span className="flex flex-col items-center leading-5">
                  <span
                    className={cn(
                      "font-semibold",
                      group.id === ""
                        ? "text-ink"
                        : "problem" in group && group.problem
                          ? "text-bad-fg"
                          : "text-accent"
                    )}
                  >
                    {group.code}
                  </span>
                  {group.name !== "" && <span>{group.name}</span>}
                  {group.note && (
                    <span className="font-medium text-warn-fg">
                      {group.note}
                    </span>
                  )}
                </span>
              </th>
            ))}
            {all && (
              <th
                rowSpan={2}
                className={cn(
                  head,
                  "border-r-0 border-b-hairline-strong bg-soft"
                )}
              >
                Difference
              </th>
            )}
          </tr>
          <tr>
            {groups.flatMap((group) => [
              <th
                key={`${group.id}b`}
                className={cn(head, "border-b-hairline-strong bg-soft")}
              >
                {before}
              </th>,
              <th
                key={`${group.id}a`}
                className={cn(
                  head,
                  "border-r-hairline-strong border-b-hairline-strong bg-soft"
                )}
              >
                {after}
              </th>,
            ])}
          </tr>
        </thead>
        <tbody>
          {divisionsOf(articles).flatMap(([division, mine]) => [
            ...(division === null
              ? []
              : [
                  <tr key={`division:${division}`}>
                    <td
                      colSpan={1 + groups.length * 2 + (all ? 1 : 0)}
                      className={cn(
                        td,
                        "h-10 bg-canvas text-left font-semibold text-ink"
                      )}
                    >
                      {division}
                      <span className="ml-2 font-normal text-body">
                        {mine.length === 1
                          ? "1 article"
                          : `${count(mine.length)} articles`}
                      </span>
                    </td>
                  </tr>,
                ]),
            ...mine.flatMap((article) => {
              const shown = onlyDifferences
                ? article.skus.filter((one) => differs(one.sku_code))
                : article.skus
              if (shown.length === 0) return []
              const skus = shown.map((one) => one.sku_code)
              return [
                <tr key={article.article_code}>
                  <td
                    className={cn(
                      td,
                      "sticky left-0 z-[1] h-auto border-r-hairline-strong bg-soft py-3 text-left"
                    )}
                  >
                    <span className="flex items-center gap-3">
                      <ArticleThumb
                        url={article.image_url}
                        name={article.article_name}
                        articleCode={article.article_code}
                        className="size-11 shrink-0 rounded-inner border border-hairline max-md:hidden"
                      />
                      <span className="flex min-w-0 flex-col">
                        <span className="font-semibold [overflow-wrap:anywhere] text-accent">
                          {article.article_name}
                        </span>
                        <span className="text-mute tabular-nums">
                          {article.article_code}
                        </span>
                        {(article.tags?.length ?? 0) > 0 && (
                          <span className="mt-1.5 flex flex-wrap gap-1">
                            {article.tags?.map((tag) => (
                              <span
                                key={tag}
                                className="rounded-[0.375rem] bg-soft-2 px-2 leading-6 font-normal text-body"
                              >
                                {tag}
                              </span>
                            ))}
                          </span>
                        )}
                      </span>
                    </span>
                  </td>
                  {groupCells(skus, true)}
                  {difference(skus, true)}
                </tr>,
                ...shown.map((sku) => (
                  <tr key={sku.sku_code}>
                    <td
                      className={cn(
                        td,
                        "sticky left-0 z-[1] border-r-hairline-strong bg-canvas text-left"
                      )}
                    >
                      <span className="flex items-center gap-2.5">
                        <ArticleThumb
                          url={null}
                          name={article.article_name}
                          articleCode={article.article_code}
                          colour={sku.colour}
                          digit={colourDigitOf(
                            article.article_code,
                            sku.sku_code
                          )}
                          bare
                          className="size-8 shrink-0 rounded-[0.375rem] max-md:hidden"
                        />
                        <span className="flex min-w-0 flex-col leading-5">
                          <span className="truncate text-ink">
                            {[sku.colour, sku.size]
                              .filter(Boolean)
                              .join(" · ") || "—"}
                          </span>
                          <span className="truncate text-mute tabular-nums max-md:hidden">
                            {skuNumber(sku.sku_code)}
                          </span>
                        </span>
                      </span>
                    </td>
                    {groupCells([sku.sku_code], false)}
                    {difference([sku.sku_code], false)}
                  </tr>
                )),
              ]
            }),
          ])}
        </tbody>
      </table>
    </div>
  )
}

/// One store's two cells — what was meant, quiet, then what happened, its
/// colour only when it differs. On the article row the colour is the
/// figure's, never the cell's: that row is a total.
function GroupCells({
  one,
  tone,
  total,
  td,
  onOpen,
}: {
  one: ReviewCell
  tone: Tone
  total: boolean
  td: string
  onOpen?: () => void
}) {
  return (
    <>
      <td className={cn(td, "text-body", total && "bg-soft font-semibold")}>
        <Figure n={one.before} />
      </td>
      <td
        className={cn(
          td,
          "border-r-hairline-strong",
          total
            ? cn(
                "bg-soft font-semibold",
                tone === "bad" && "text-bad-fg",
                tone === "warn" && "text-warn-fg",
                tone === "wait" && "text-mute"
              )
            : tone !== null && TONE[tone],
          onOpen !== undefined &&
            "cursor-pointer outline-none hover:shadow-[inset_0_0_0_2px_var(--color-accent)] focus-visible:shadow-[inset_0_0_0_2px_var(--color-accent)]"
        )}
        {...(onOpen !== undefined && {
          role: "button",
          tabIndex: 0,
          onClick: onOpen,
          onKeyDown: (event: React.KeyboardEvent) => {
            if (event.key === "Enter") onOpen()
          },
        })}
      >
        {one.after === null ? (
          "…"
        ) : tone === "bad" || tone === "warn" ? (
          count(one.after)
        ) : (
          <Figure n={one.after} />
        )}
        {!total && one.say && (
          <span className="block text-[0.9375rem] leading-5 font-medium">
            {one.say}
          </span>
        )}
        {!total && one.out && (
          <span className="block text-[0.9375rem] leading-5 font-semibold">
            {one.out}
          </span>
        )}
      </td>
    </>
  )
}
