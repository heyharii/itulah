import { useForm } from "@tanstack/react-form"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Field, Input, Select } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import {
  MiniCell,
  MiniRow,
  MiniTable,
  SubHead,
  TotalsLadder,
} from "@/components/ui/rows"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState, ErrorState } from "@/components/ui/states"
import { SubTabs } from "@/components/ui/sub-tabs"
import { Lifecycle } from "@/components/ui/timeline"
import { count, day, moment, money } from "@/lib/format"
import {
  commercialKeys,
  createPriceBook,
  instantOf,
  listPriceBooks,
  minorOf,
  priceBookDetail,
  publishPriceBook,
  type CreatedPriceBook,
  type MarkdownInput,
  type PriceBook,
  type PublicationStatus,
  type PublishReceipt,
} from "@/lib/queries/commercial"
import { queryState } from "@/lib/query-state"
import { useIdentity } from "@/lib/session"
import { useSheet } from "@/lib/sheets"
import { tableSetup, type TableSetup } from "@/lib/table"
import { Named, Quiet } from "@/screens/commercial/parts"

/// Price books — what the centre has decided to charge, and whether it has said
/// so out loud yet.
///
/// A book is a **list of changes**, not a full replacement: anything it does not
/// mention keeps the price the last book gave it, and the engine resolves by
/// taking the newest published book that names a product. That is the single
/// fact this screen exists to make legible, because the failure it prevents is
/// the quiet one — a book that publishes, dispatches, and changes nothing.
///
/// Writing and publishing are two decisions and two buttons. Writing a price is
/// a merchandiser's; sending it to thirty tills is somebody's to approve, and
/// the server dispatches inside the publishing transaction so a book is either
/// published AND on its way or neither.

/// DRAFT is amber because it is waiting for a person; PUBLISHED is green
/// because the decision is made. `toneFor` has no entry for either — the shared
/// taxonomy covers order and stock words, and these are publication words.
function bookTone(status: PublicationStatus) {
  return status === "PUBLISHED" ? "ok" : "warn"
}

const columns: ColumnDef<TableSetup, PriceBook>[] = [
  {
    accessorKey: "version",
    header: "Book",
    size: 90,
    cell: ({ row }) => (
      <span className="font-mono text-id text-body">
        v{row.original.version}
      </span>
    ),
  },
  {
    accessorKey: "name",
    header: "Name",
    size: 280,
    cell: ({ row }) => (
      <span className="font-medium text-ink">{row.original.name}</span>
    ),
  },
  {
    accessorKey: "status",
    header: "Status",
    size: 120,
    cell: ({ row }) => (
      <Pill tone={bookTone(row.original.status)}>
        {row.original.status === "PUBLISHED" ? "Published" : "Draft"}
      </Pill>
    ),
  },
  {
    accessorKey: "offer_count",
    header: "Prices set",
    size: 110,
    meta: { align: "right" },
    // Zero is not a fault: a book may carry only markdowns or only promotions.
    // Quiet rather than absent, so nobody reads a blank cell as a failure.
    cell: ({ row }) => (
      <span
        className={row.original.offer_count > 0 ? "text-text" : "text-mute"}
      >
        {count(row.original.offer_count)}
      </span>
    ),
  },
  {
    accessorKey: "effective_from",
    header: "In force from",
    size: 140,
    cell: ({ row }) => day(row.original.effective_from),
  },
  {
    accessorKey: "published_at",
    header: "Published",
    size: 140,
    cell: ({ row }) =>
      row.original.published_at ? (
        day(row.original.published_at)
      ) : (
        <span className="text-mute">Not yet</span>
      ),
  },
]

export function PriceBooks() {
  const [query, setQuery] = useState("")
  const book = useSheet("book")
  // The composer is the one panel here that is NOT in the URL, and deliberately:
  // `lib/sheets.ts` registers the sheets this app links to, and a half-typed
  // draft is not a place anybody can be sent — restoring it from a pasted link
  // would restore an empty form and call it a book.
  const [composing, setComposing] = useState(false)
  const [written, setWritten] = useState<CreatedPriceBook | null>(null)
  // DRAFT sorts before PUBLISHED, which is the decision order: a draft is a row
  // somebody has to act on and a published book is one somebody already did.
  // Ties keep the server's order — version descending — so under the drafts the
  // newest book, the one the engine actually resolves to, is first.
  const [sorting, setSorting] = useState<SortingState>([
    { id: "status", desc: false },
  ])

  const books = useQuery({
    queryKey: commercialKeys.books(),
    queryFn: ({ signal }) => listPriceBooks(signal),
  })

  const rows = useMemo(() => books.data ?? [], [books.data])
  const highestVersion = useMemo(
    () => rows.reduce((top, row) => Math.max(top, row.version), 0),
    [rows]
  )

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns,
        getRowId: (row: PriceBook) => row.id,
        state: { globalFilter: query, sorting },
        onSortingChange: setSorting,
        onGlobalFilterChange: setQuery,
      }),
      [rows, query, sorting]
    )
  )

  return (
    <PageContent>
      <PageHeader
        crumb="Commercial"
        title="Price books"
        sub="Each book is a list of changes. Anything it does not name keeps the price the last book gave it."
        actions={
          <>
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search"
              className="h-8 w-48"
            />
            {/* Ghost, not black: the one black CTA on this screen lives in
                whichever sheet is open — Save in the composer, Publish on a
                draft — and only one of those is ever on screen. */}
            <Button onClick={() => setComposing(true)}>New book</Button>
          </>
        }
      />

      {written && (
        <Banner tone="ok" className="mb-4" onDismiss={() => setWritten(null)}>
          Book v{written.version} — “{written.name}” — is written as a draft. It
          changes nothing until somebody publishes it.
        </Banner>
      )}

      <Card className="overflow-hidden">
        {queryState(books, {
          loading: "Loading the books…",
          render: () =>
            rows.length === 0 ? (
              <EmptyState>
                No price book has been written yet, so every till is charging
                whatever it was last told.
              </EmptyState>
            ) : (
              <DataTable<PriceBook>
                table={table}
                onRowClick={(row) => book.open(row.id)}
                isSelected={(row) => row.id === book.value}
                empty="No book matches that search."
                className="max-h-[calc(100vh-14rem)]"
              />
            ),
        })}
      </Card>

      <BookSheet id={book.value ?? null} onClose={book.close} />
      <Composer
        open={composing}
        nextVersion={highestVersion + 1}
        onClose={() => setComposing(false)}
        onWritten={(created) => {
          setWritten(created)
          setComposing(false)
        }}
      />
    </PageContent>
  )
}

const TABS = [
  { value: "prices", label: "Prices" },
  { value: "markdowns", label: "Markdowns" },
  { value: "promotions", label: "Promotions" },
  { value: "coupons", label: "Coupons" },
  { value: "campaigns", label: "Campaigns" },
  { value: "service", label: "In service" },
] as const

/// One book, whole. The list gives headers and a count, which is enough to know
/// a book exists and nothing about what it does.
function BookSheet({
  id,
  onClose,
}: {
  id: string | null
  onClose: () => void
}) {
  const client = useQueryClient()
  const identity = useIdentity()
  const [tab, setTab] = useState<string>("prices")

  const detail = useQuery({
    queryKey: commercialKeys.book(id ?? ""),
    queryFn: ({ signal }) => priceBookDetail(id!, signal),
    enabled: id !== null,
  })

  // One key per open book, so a double-clicked Publish publishes once and gets
  // the same receipt twice. The server takes it in the body rather than in an
  // `Idempotency-Key` header: this family of routes models the actor and the
  // key as fields of the command itself.
  const idempotencyKey = useMemo(() => crypto.randomUUID(), [id])
  const [receipt, setReceipt] = useState<PublishReceipt | null>(null)

  const actor = identity.data?.username ?? ""

  const publish = useMutation({
    mutationFn: () => publishPriceBook(id!, actor, idempotencyKey),
    onSuccess: (result) => {
      setReceipt(result)
      // The whole prefix, and this is the case that earns it: publishing a book
      // changes the books list, this book, what every shop is charging
      // (`offers`), how far behind each shop now is (`activation`), and the
      // limits the usage report joins against. Naming five keys here would be
      // naming every key this module has.
      client.invalidateQueries({ queryKey: commercialKeys.all })
    },
  })

  return (
    <Sheet
      open={id !== null}
      subject={id === null ? undefined : { kind: "publication", id }}
      onOpenChange={(open) => !open && onClose()}
      id={detail.data ? `v${detail.data.version}` : undefined}
      title={detail.data?.name ?? "Price book"}
      actions={
        detail.data?.status === "DRAFT" ? (
          <Button
            variant="dark"
            size="sm"
            disabled={publish.isPending || actor === ""}
            onClick={() => publish.mutate()}
          >
            {publish.isPending ? "Publishing…" : "Publish"}
          </Button>
        ) : undefined
      }
    >
      {queryState(detail, {
        loading: "Loading the book…",
        render: (bookDetail) => (
          <div className="flex flex-col gap-5">
            {/* Written → published → in service. The third step is the one this
                ribbon exists for: publishing is the centre's act, and a shop
                putting the book into service is the shop's. */}
            <Lifecycle
              steps={[
                { label: "Written", state: "done" },
                {
                  label: "Published",
                  state: bookDetail.status === "PUBLISHED" ? "done" : "current",
                },
                {
                  label: "In service",
                  state:
                    bookDetail.activated_by.length > 0
                      ? "done"
                      : bookDetail.status === "PUBLISHED"
                        ? "current"
                        : "todo",
                },
              ]}
            />

            {publish.isError && <ErrorState error={publish.error} />}

            {receipt && (
              <Banner tone={receipt.delivered_to.length > 0 ? "ok" : "warn"}>
                {receipt.delivered_to.length > 0 ? (
                  <>
                    Published and queued for{" "}
                    {count(receipt.delivered_to.length)} shop
                    {receipt.delivered_to.length === 1 ? "" : "s"}, carrying{" "}
                    {count(receipt.offer_rule_count)} price rule
                    {receipt.offer_rule_count === 1 ? "" : "s"}.
                  </>
                ) : (
                  <>
                    Published, and queued for nobody: no shop origin is
                    registered, so no till will ever see this book.
                  </>
                )}
              </Banner>
            )}

            <Facts>
              <Fact term="In force from">{day(bookDetail.effective_from)}</Fact>
              <Fact term="Until">
                {bookDetail.effective_to
                  ? day(bookDetail.effective_to)
                  : "No end date"}
              </Fact>
              <Fact term="Written by">{bookDetail.created_by}</Fact>
              <Fact term="Written">{moment(bookDetail.created_at)}</Fact>
              <Fact term="Published by">{bookDetail.published_by ?? "—"}</Fact>
              <Fact term="Published">{moment(bookDetail.published_at)}</Fact>
            </Facts>

            <div>
              <SubTabs tabs={TABS} value={tab} onChange={setTab} />

              {tab === "prices" &&
                (bookDetail.price_rules.length === 0 ? (
                  <Quiet>
                    This book sets no base prices. Every product keeps the price
                    the last book that named it gave it.
                  </Quiet>
                ) : (
                  <>
                    <MiniTable
                      head={[
                        "Product",
                        { label: "Scope", align: "left" },
                        "Price",
                      ]}
                    >
                      {bookDetail.price_rules.map((rule) => (
                        <MiniRow key={`${rule.sku_code}-${rule.channel}`}>
                          <MiniCell>
                            <Named
                              name={rule.article_name}
                              code={rule.sku_code}
                            />
                          </MiniCell>
                          <MiniCell>
                            <span className="text-[0.71875rem] text-body">
                              {scopeOf(rule)} · {rule.channel}
                            </span>
                          </MiniCell>
                          <MiniCell align="right">
                            {money(rule.unit_price_minor)}
                          </MiniCell>
                        </MiniRow>
                      ))}
                    </MiniTable>
                    {bookDetail.tax_rules.length > 0 && (
                      <TotalsLadder
                        className="mt-3"
                        rows={bookDetail.tax_rules.slice(0, -1).map((tax) => ({
                          label: taxLabel(tax),
                          value: `${tax.rate_bps / 100}%`,
                        }))}
                        total={{
                          label: taxLabel(
                            bookDetail.tax_rules[
                              bookDetail.tax_rules.length - 1
                            ]
                          ),
                          value: `${
                            bookDetail.tax_rules[
                              bookDetail.tax_rules.length - 1
                            ].rate_bps / 100
                          }%`,
                        }}
                      />
                    )}
                  </>
                ))}

              {tab === "markdowns" &&
                (bookDetail.markdowns.length === 0 ? (
                  <Quiet>Nothing is marked down in this book.</Quiet>
                ) : (
                  <MiniTable
                    head={[
                      "Applies to",
                      { label: "Window", align: "left" },
                      "Replaces price with",
                    ]}
                  >
                    {bookDetail.markdowns.map((markdown) => (
                      <MiniRow key={markdown.markdown_id}>
                        <MiniCell>
                          <Named
                            name={
                              markdown.article_code
                                ? `Style ${markdown.article_code}`
                                : `Product ${markdown.sku_code}`
                            }
                            code={markdown.markdown_id}
                          />
                        </MiniCell>
                        <MiniCell>
                          <span className="text-[0.71875rem] text-body">
                            {day(markdown.effective_from)} →{" "}
                            {markdown.effective_to
                              ? day(markdown.effective_to)
                              : "open"}
                          </span>
                        </MiniCell>
                        <MiniCell align="right">
                          {money(markdown.replacement_unit_price_minor)}
                        </MiniCell>
                      </MiniRow>
                    ))}
                  </MiniTable>
                ))}

              {tab === "promotions" &&
                (bookDetail.rules.length === 0 ? (
                  <Quiet>This book carries no promotions.</Quiet>
                ) : (
                  <div className="flex flex-col gap-3">
                    {bookDetail.rules.map((rule) => (
                      <div
                        key={rule.rule_id}
                        className="rounded-inner border border-hairline p-3"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <Named name={rule.name} code={rule.rule_id} />
                          <Pill
                            tone={rule.status === "ACTIVE" ? "ok" : "neutral"}
                          >
                            {rule.status}
                          </Pill>
                        </div>
                        {/* The rule as the engine serialised it, handed back
                            whole. Reading it field by field here would put a
                            second interpreter of promotion semantics in the
                            system, which is the one thing this design avoids. */}
                        <details className="mt-2">
                          <summary className="cursor-pointer text-[0.71875rem] text-body hover:text-ink">
                            Rule as published · priority {rule.priority}
                          </summary>
                          <pre className="mt-2 overflow-x-auto rounded-inner bg-soft p-2.5 font-mono text-[0.65625rem] leading-relaxed text-text">
                            {JSON.stringify(rule.definition, null, 2)}
                          </pre>
                        </details>
                      </div>
                    ))}
                  </div>
                ))}

              {tab === "coupons" &&
                (bookDetail.coupons.length === 0 ? (
                  <Quiet>No coupon unlocks anything in this book.</Quiet>
                ) : (
                  <MiniTable
                    head={[
                      "Code",
                      { label: "Unlocks", align: "left" },
                      "Uses allowed",
                    ]}
                  >
                    {bookDetail.coupons.map((coupon) => (
                      <MiniRow key={coupon.code}>
                        <MiniCell>
                          <span className="font-mono text-id text-ink">
                            {coupon.code}
                          </span>
                          {!coupon.active && (
                            <span className="ml-1.5 text-[0.65625rem] text-mute">
                              inactive
                            </span>
                          )}
                        </MiniCell>
                        <MiniCell>
                          <span className="font-mono text-[0.65625rem] text-body">
                            {coupon.rule_id}
                          </span>
                        </MiniCell>
                        <MiniCell align="right">
                          {coupon.max_uses === null
                            ? "Unlimited"
                            : count(coupon.max_uses)}
                        </MiniCell>
                      </MiniRow>
                    ))}
                  </MiniTable>
                ))}

              {tab === "campaigns" &&
                (bookDetail.campaigns.length === 0 ? (
                  <Quiet>No campaign envelopes in this book.</Quiet>
                ) : (
                  <MiniTable
                    head={[
                      "Campaign",
                      { label: "Window", align: "left" },
                      "Budget",
                    ]}
                  >
                    {bookDetail.campaigns.map((campaign) => (
                      <MiniRow key={campaign.campaign_id}>
                        <MiniCell>
                          <Named
                            name={campaign.name}
                            code={campaign.campaign_id}
                          />
                        </MiniCell>
                        <MiniCell>
                          <span className="text-[0.71875rem] text-body">
                            {campaign.valid_from
                              ? day(campaign.valid_from)
                              : "always"}{" "}
                            →{" "}
                            {campaign.valid_to
                              ? day(campaign.valid_to)
                              : "open"}
                          </span>
                        </MiniCell>
                        <MiniCell align="right">
                          {campaign.budget_minor === null
                            ? "Unlimited"
                            : money(campaign.budget_minor)}
                        </MiniCell>
                      </MiniRow>
                    ))}
                  </MiniTable>
                ))}

              {tab === "service" &&
                (bookDetail.activated_by.length === 0 ? (
                  <Quiet>
                    No shop has put this book into service. Published and in
                    force are different things.
                  </Quiet>
                ) : (
                  <MiniTable
                    head={[
                      "Shop",
                      { label: "Since", align: "left" },
                      "Rules taken",
                    ]}
                  >
                    {bookDetail.activated_by.map((activation) => (
                      <MiniRow key={activation.origin_id}>
                        <MiniCell>
                          <Named
                            name={activation.site_id ?? "Unsited"}
                            code={activation.origin_id}
                          />
                        </MiniCell>
                        <MiniCell>
                          <span className="text-[0.71875rem] text-body">
                            {moment(activation.activated_at)}
                          </span>
                        </MiniCell>
                        <MiniCell align="right">
                          {count(activation.price_rule_count)}
                        </MiniCell>
                      </MiniRow>
                    ))}
                  </MiniTable>
                ))}
            </div>
          </div>
        ),
      })}
    </Sheet>
  )
}

function taxLabel(tax: { tax_category: string; tax_inclusive: boolean }) {
  return `${tax.tax_category}${tax.tax_inclusive ? " (inclusive)" : ""}`
}

/// Who a price rule is for, in words.
function scopeOf(rule: {
  site_id: string | null
  site_ids: readonly string[] | null
  tier: string | null
}): string {
  if (rule.site_id) return rule.site_id
  if (rule.site_ids && rule.site_ids.length > 0)
    return `${rule.site_ids.length} shops`
  if (rule.tier) return `tier ${rule.tier}`
  return "Every shop"
}

/// One markdown as the composer holds it — the price is text until it is
/// submitted, because a half-typed number is not a number.
interface MarkdownRow {
  on: "article" | "sku"
  code: string
  price: string
}

const emptyRow = (): MarkdownRow => ({
  on: "article",
  code: "",
  price: "",
})

interface BookDraft {
  name: string
  version: string
  from: string
  until: string
  rows: MarkdownRow[]
}

/// Everything wrong with the draft, in the sentences the fields show.
///
/// One function rather than four validators because three of the four are about
/// how the fields relate — a book number against the ones already here, an end
/// against a start, a row count against the point of writing a book at all.
function bookProblems(
  draft: BookDraft,
  nextVersion: number
): Record<string, string | undefined> {
  const effectiveFrom = instantOf(draft.from) ?? new Date().toISOString()
  const effectiveTo = instantOf(draft.until)
  const versionNumber = Number(draft.version)
  const complete = draft.rows.filter(
    (row) => row.code.trim() !== "" && minorOf(row.price) !== null
  )

  return {
    name: draft.name.trim() === "" ? "A book needs a name." : undefined,
    version: !Number.isInteger(versionNumber)
      ? "A book number is a whole number."
      : versionNumber < nextVersion
        ? `v${versionNumber} sits at or below v${nextVersion - 1}, which is already here. The newest book wins, so this one would publish and change nothing.`
        : undefined,
    until:
      effectiveTo !== null && effectiveTo <= effectiveFrom
        ? "The end has to come after the start."
        : undefined,
    rows:
      complete.length === 0
        ? "A book has to change something: name a style or a product, and the price it should be."
        : undefined,
  }
}

/// Writing a book.
///
/// What this composer authors is a book of **markdowns** — clearance prices
/// that replace the base for the goods they name. That is deliberately less
/// than the server accepts: a publication may also carry base prices with their
/// tax categories, promotion rules, coupons and campaigns, and authoring those
/// needs a product picker and a rule editor that are not written here. A
/// markdown needs neither, because it names a style or a product by its code —
/// which makes it the one change a merchandiser can make from a keyboard.
///
/// No `tax_rules` are sent, and none may be: the server refuses tax rules on a
/// book that sets no prices, because they would categorise nothing.
function Composer({
  open,
  nextVersion,
  onClose,
  onWritten,
}: {
  open: boolean
  nextVersion: number
  onClose: () => void
  onWritten: (created: CreatedPriceBook) => void
}) {
  const client = useQueryClient()
  const identity = useIdentity()

  const actor = identity.data?.username ?? ""
  // Held across retries, renewed only when the composer is reopened: a
  // double-clicked Save writes one book and gets the same answer twice.
  const idempotencyKey = useMemo(
    () => crypto.randomUUID(),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a fresh key per
    // opening is exactly the intent, and `open` is what marks an opening.
    [open]
  )

  const write = useMutation({
    // Wrapped rather than passed by reference: v5 hands a mutation context as
    // the second argument, which is not the `AbortSignal` the fetcher expects.
    mutationFn: (draft: BookDraft) => {
      const effectiveFrom = instantOf(draft.from) ?? new Date().toISOString()
      const effectiveTo = instantOf(draft.until)
      const versionNumber = Number(draft.version)
      const markdowns: MarkdownInput[] = draft.rows
        // A row with no code or no readable price is one somebody started and
        // thought better of. It is not an error worth stopping them over.
        .filter((row) => row.code.trim() !== "" && minorOf(row.price) !== null)
        .map((row, index) => ({
          // Stable within the book and readable in the detail sheet. The server
          // only requires it to be unique within the publication.
          markdown_id: `md-${versionNumber}-${index + 1}`,
          article_code: row.on === "article" ? row.code.trim() : null,
          sku_code: row.on === "sku" ? row.code.trim() : null,
          replacement_unit_price_minor: minorOf(row.price)!,
          priority: 0,
          // One window for the book and everything in it. A markdown with its
          // own narrower window is a real thing the server accepts; writing one
          // belongs in a fuller editor than this.
          effective_from: effectiveFrom,
          effective_to: effectiveTo,
        }))
      return createPriceBook({
        version: versionNumber,
        name: draft.name.trim(),
        effective_from: effectiveFrom,
        effective_to: effectiveTo,
        markdowns,
        actor_id: actor,
        idempotency_key: idempotencyKey,
      })
    },
    onSuccess: (created) => {
      // Only the list changes. A draft is in force nowhere, so no shop's prices
      // and no shop's activation state are touched by writing one.
      client.invalidateQueries({ queryKey: commercialKeys.books() })
      // The name and the markdowns, which are this book. The number and the
      // window are where the next book carries on from.
      form.setFieldValue("name", "")
      form.setFieldValue("rows", [emptyRow()])
      onWritten(created)
    },
  })

  const form = useForm({
    defaultValues: {
      name: "",
      version: String(nextVersion),
      from: "",
      until: "",
      rows: [emptyRow()],
    } as BookDraft,
    onSubmit: ({ value }) => write.mutate(value),
  })

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title="New price book"
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className="text-[0.71875rem] text-mute">
            Saved as a draft. Nothing changes until it is published.
          </span>
          <form.Subscribe
            selector={(state) =>
              actor !== "" &&
              Object.values(bookProblems(state.values, nextVersion)).every(
                (one) => one === undefined
              )
            }
          >
            {(ready) => (
              <Button
                variant="dark"
                disabled={!ready || write.isPending}
                onClick={() => form.handleSubmit()}
              >
                {write.isPending ? "Saving…" : "Save draft"}
              </Button>
            )}
          </form.Subscribe>
        </div>
      }
    >
      <form
        // The button is in the sheet's footer, outside this element, so its
        // disabled state cannot block an Enter keypress.
        onSubmit={(event) => {
          event.preventDefault()
          const stopped = Object.values(
            bookProblems(form.state.values, nextVersion)
          ).some((one) => one !== undefined)
          if (!stopped && actor !== "" && !write.isPending) {
            form.handleSubmit()
          }
        }}
        className="flex flex-col gap-4"
      >
        {write.isError && <ErrorState error={write.error} />}

        <form.Subscribe
          selector={(state) => bookProblems(state.values, nextVersion)}
        >
          {(problems) => (
            <>
              <form.Field name="name">
                {(field) => (
                  <Field label="Name" problem={problems.name}>
                    <Input
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(event) =>
                        field.handleChange(event.target.value)
                      }
                      placeholder="Mid-season clearance"
                    />
                  </Field>
                )}
              </form.Field>

              <div className="grid grid-cols-2 gap-3">
                <form.Field name="version">
                  {(field) => (
                    <Field
                      label="Book number"
                      hint={`Next is v${nextVersion}`}
                      problem={problems.version}
                    >
                      <Input
                        type="number"
                        min={1}
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(event) =>
                          field.handleChange(event.target.value)
                        }
                      />
                    </Field>
                  )}
                </form.Field>
                <form.Field name="from">
                  {(field) => (
                    <Field label="In force from" hint="Now, if left blank">
                      <Input
                        type="datetime-local"
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(event) =>
                          field.handleChange(event.target.value)
                        }
                      />
                    </Field>
                  )}
                </form.Field>
              </div>

              <form.Field name="until">
                {(field) => (
                  <Field
                    label="Until"
                    hint="Leave blank for no end date"
                    problem={problems.until}
                  >
                    <Input
                      type="datetime-local"
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(event) =>
                        field.handleChange(event.target.value)
                      }
                    />
                  </Field>
                )}
              </form.Field>

              <form.Field name="rows" mode="array">
                {(rows) => (
                  <div>
                    <SubHead
                      aside={`${
                        rows.state.value.filter(
                          (row) =>
                            row.code.trim() !== "" &&
                            minorOf(row.price) !== null
                        ).length
                      } of ${rows.state.value.length} complete`}
                    >
                      Markdowns
                    </SubHead>
                    <p className="mb-3 text-[0.71875rem] leading-relaxed text-body">
                      A markdown replaces the price of the goods it names — it
                      is not a discount on top of one. Promotions come off
                      whatever the item now costs.
                    </p>

                    <div className="flex flex-col gap-3">
                      {rows.state.value.map((_, index) => (
                        <div
                          key={index}
                          className="flex flex-col gap-2 rounded-inner border border-hairline p-3"
                        >
                          <div className="grid grid-cols-2 gap-2">
                            <form.Field name={`rows[${index}].on`}>
                              {(field) => (
                                <Select
                                  value={field.state.value}
                                  aria-label="What the markdown names"
                                  onChange={(event) =>
                                    field.handleChange(
                                      event.target.value as "article" | "sku"
                                    )
                                  }
                                >
                                  <option value="article">A whole style</option>
                                  <option value="sku">One product</option>
                                </Select>
                              )}
                            </form.Field>
                            <form.Field name={`rows[${index}].code`}>
                              {(field) => (
                                <Input
                                  value={field.state.value}
                                  aria-label="Code"
                                  placeholder={
                                    rows.state.value[index].on === "article"
                                      ? "Style code"
                                      : "SKU code"
                                  }
                                  onChange={(event) =>
                                    field.handleChange(event.target.value)
                                  }
                                />
                              )}
                            </form.Field>
                          </div>
                          <form.Field name={`rows[${index}].price`}>
                            {(field) => (
                              <>
                                <div className="flex items-center gap-2">
                                  <Input
                                    value={field.state.value}
                                    aria-label="New price"
                                    inputMode="numeric"
                                    placeholder="New price, in rupiah"
                                    onChange={(event) =>
                                      field.handleChange(event.target.value)
                                    }
                                  />
                                  <Button
                                    variant="quiet"
                                    // The last row is not removable: a book with
                                    // no markdown is not a shorter book, it is a
                                    // book that changes nothing.
                                    disabled={rows.state.value.length === 1}
                                    onClick={() => rows.removeValue(index)}
                                  >
                                    Remove
                                  </Button>
                                </div>
                                {field.state.value !== "" &&
                                  minorOf(field.state.value) === null && (
                                    <span className="text-[0.71875rem] text-bad">
                                      A price is a whole number of rupiah.
                                    </span>
                                  )}
                                {minorOf(field.state.value) !== null && (
                                  <span className="text-[0.71875rem] text-mute">
                                    Will be charged at{" "}
                                    {money(minorOf(field.state.value))}
                                  </span>
                                )}
                              </>
                            )}
                          </form.Field>
                        </div>
                      ))}
                    </div>

                    {problems.rows && (
                      <p className="mt-2 text-[0.71875rem] text-bad">
                        {problems.rows}
                      </p>
                    )}

                    <Button
                      variant="soft"
                      className="mt-3"
                      onClick={() => rows.pushValue(emptyRow())}
                    >
                      Add another
                    </Button>
                  </div>
                )}
              </form.Field>
            </>
          )}
        </form.Subscribe>
      </form>
    </Sheet>
  )
}
