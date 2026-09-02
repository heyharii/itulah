import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Field, Input, Select } from "@/components/ui/field"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
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
import { SubTabs } from "@/components/ui/sub-tabs"
import { Lifecycle } from "@/components/ui/timeline"
import { Banner, EmptyState } from "@/components/ui/states"
import { Tag } from "@/components/ui/tag"
import { count, day, label, money, moment, toneFor } from "@/lib/format"
import { cn } from "@/lib/utils"
import {
  articleKeys,
  searchArticles,
  type ArticleColourwayInput,
} from "@/lib/queries/articles"
import { ColourPicker } from "@/screens/articles/colour-picker"
import {
  articleImage,
  issueSetupSession,
  listSetupSessions,
  procurementKeys,
  setupSessionDetail,
  unidentifiedReceipts,
  uploadArticleImage,
  type SetupSession,
  type SetupSessionRow,
  type UnidentifiedReceipt,
  catalogueVocabulary,
  openSetupSession,
  type NewSetupSession,
} from "@/lib/queries/procurement"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"
import type { CatalogueVocabulary, FacetCount } from "@itulah/contract"
import { tableSetup, type TableSetup } from "@/lib/table"
import {
  toggle,
  useActor,
  useIdempotencyKey,
} from "@/screens/procurement/shared"
import { ArticlesTabs } from "@/screens/articles/tabs"

/// Article setups — head office giving a delivery its identity.
///
/// Goods arrive against an order carrying the SUPPLIER's code and whatever the
/// buyer wrote on the line. Neither is an identity: an article code is ours,
/// eight digits minted from our own sequence, and a SKU is that code plus a
/// colour digit and a size. A session is where somebody decides what the thing
/// actually is, and issuing it mints the article, its SKUs and their EPCs and
/// sends the tagging job down — all in one transaction, because a serial range
/// drawn and not sent is a hole in the numbering nothing will ever fill.
///
/// Colour is ONE digit. Ten colourways is the ceiling and it is enforced where
/// the image key is built, which is why the photographs below are per colourway
/// rather than per SKU: every size of the red shirt is the same red shirt.

const receiptColumns: ColumnDef<TableSetup, UnidentifiedReceipt>[] = [
  {
    accessorKey: "po_number",
    header: "PO",
    size: 130,
    cell: ({ row }) => (
      <span className="font-mono text-id text-body">
        {row.original.po_number}
      </span>
    ),
  },
  {
    accessorKey: "article_name",
    header: "What the buyer wrote",
    size: 260,
    cell: ({ row }) => (
      <span className="flex flex-col">
        <span className="font-medium text-ink">
          {row.original.article_name}
        </span>
        <span className="font-mono text-[0.65625rem] text-mute">
          {row.original.supplier_article_code}
        </span>
      </span>
    ),
  },
  {
    accessorKey: "division_code",
    header: "Filed under",
    size: 140,
    cell: ({ row }) =>
      row.original.division_code === null ? (
        <span className="text-mute">Unclassified</span>
      ) : (
        <Tag>{row.original.division_code}</Tag>
      ),
  },
  {
    accessorKey: "site_id",
    header: "Landed at",
    size: 130,
  },
  {
    accessorKey: "quantity",
    header: "Pieces",
    size: 100,
    meta: { align: "right" },
    cell: ({ row }) => count(row.original.quantity),
  },
  {
    accessorKey: "verified_at",
    header: "Accepted",
    size: 160,
    // The decision metric, sorted oldest first: a delivery sitting without an
    // identity is stock in a warehouse that nothing can sell.
    cell: ({ row }) => moment(row.original.verified_at),
  },
]

const sessionColumns: ColumnDef<TableSetup, SetupSessionRow>[] = [
  {
    accessorKey: "article_code",
    header: "Article",
    size: 130,
    cell: ({ row }) => (
      <span className="font-mono text-id text-body">
        {row.original.article_code}
      </span>
    ),
  },
  {
    accessorKey: "article_name",
    header: "Name",
    size: 250,
    cell: ({ row }) => (
      <span className="font-medium text-ink">{row.original.article_name}</span>
    ),
  },
  {
    accessorKey: "division_code",
    header: "Division",
    size: 130,
    cell: ({ row }) => <Tag>{row.original.division_code}</Tag>,
  },
  {
    accessorKey: "receipt_quantity",
    header: "Received",
    size: 110,
    meta: { align: "right" },
    cell: ({ row }) => count(row.original.receipt_quantity),
  },
  {
    accessorKey: "declared_quantity",
    header: "Split out",
    size: 110,
    meta: { align: "right" },
    cell: ({ row }) => count(row.original.declared_quantity),
  },
  {
    id: "undeclared",
    accessorFn: (row) => row.receipt_quantity - row.declared_quantity,
    header: "Unaccounted",
    size: 130,
    meta: { align: "right" },
    // The decision metric and the default sort: a session whose variants do not
    // add up to what arrived is not finished, and it cannot be issued.
    cell: ({ row }) => {
      const gap = row.original.receipt_quantity - row.original.declared_quantity
      return (
        <span className={gap > 0 ? "font-medium text-warn-fg" : "text-mute"}>
          {count(gap)}
        </span>
      )
    },
  },
  {
    accessorKey: "created_at",
    header: "Opened",
    size: 130,
    cell: ({ row }) => day(row.original.created_at),
  },
]

export function ArticleSetups() {
  const [tab, setTab] = useState("waiting")
  const [query, setQuery] = useState("")
  // Which setup session is open lives in the URL, like every other sheet.
  const session = useSheet("setup")
  /// Which delivery is being given an identity. A separate key from `setup`:
  /// this line has no session yet, and opening one is what the sheet does.
  const waiting_ = useSheet("receipt")

  /// The words a division may be named with. Needed only by the composer, but
  /// fetched here so opening the sheet does not start a request the person is
  /// then waiting on.
  const vocabulary = useQuery({
    queryKey: procurementKeys.vocabulary(),
    queryFn: ({ signal }) => catalogueVocabulary(signal),
    staleTime: 30 * 60 * 1000,
  })
  const [waitingSort, setWaitingSort] = useState<SortingState>([
    { id: "verified_at", desc: false },
  ])
  const [sessionSort, setSessionSort] = useState<SortingState>([
    { id: "undeclared", desc: true },
  ])

  const receipts = useQuery({
    queryKey: procurementKeys.unidentified(),
    queryFn: ({ signal }) => unidentifiedReceipts(signal),
  })

  const sessions = useQuery({
    queryKey: procurementKeys.setups(),
    queryFn: ({ signal }) => listSetupSessions(signal),
  })

  const waiting = useMemo(() => receipts.data ?? [], [receipts.data])
  const open = useMemo(() => sessions.data ?? [], [sessions.data])
  const pieces = waiting.reduce((sum, row) => sum + row.quantity, 0)
  const unaccounted = open.reduce(
    (sum, row) => sum + (row.receipt_quantity - row.declared_quantity),
    0
  )

  const receiptTable = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: waiting,
        columns: receiptColumns,
        getRowId: (row: UnidentifiedReceipt) => row.receipt_line_id,
        state: { globalFilter: query, sorting: waitingSort },
        onSortingChange: setWaitingSort,
        onGlobalFilterChange: setQuery,
      }),
      [waiting, query, waitingSort]
    )
  )

  const sessionTable = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: open,
        columns: sessionColumns,
        getRowId: (row: SetupSessionRow) => row.session_id,
        state: { globalFilter: query, sorting: sessionSort },
        onSortingChange: setSessionSort,
        onGlobalFilterChange: setQuery,
      }),
      [open, query, sessionSort]
    )
  )

  return (
    <PageContent>
      <PageHeader
        crumb="Articles"
        title="Article setups"
        sub="Deliveries waiting to be told what they are, and the sessions that will mint them."
        actions={
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Article, PO or name"
            className="h-8 w-52"
          />
        }
      />

      <ArticlesTabs current="/articles/setups" />

      <KpiStrip className="grid-cols-2 md:grid-cols-4 xl:grid-cols-4">
        <Kpi
          label="Deliveries without an identity"
          value={count(waiting.length)}
        />
        <Kpi label="Pieces waiting" value={count(pieces)} />
        <Kpi label="Sessions open" value={count(open.length)} />
        <Kpi label="Pieces not split out" value={count(unaccounted)} />
      </KpiStrip>

      <SubTabs
        tabs={[
          { value: "waiting", label: `Awaiting identity (${waiting.length})` },
          { value: "sessions", label: `Open sessions (${open.length})` },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === "waiting" ? (
        <Card className="overflow-hidden">
          {queryState(receipts, {
            loading: "Reading the queue…",
            render: () =>
              waiting.length === 0 ? (
                <EmptyState>
                  {query === ""
                    ? "Every accepted delivery has been given an identity."
                    : "No waiting delivery matches that search."}
                </EmptyState>
              ) : (
                <DataTable<UnidentifiedReceipt>
                  table={receiptTable}
                  onRowClick={(row) => waiting_.open(row.receipt_line_id)}
                  isSelected={(row) => row.receipt_line_id === waiting_.value}
                  className="max-h-[calc(100vh-24rem)]"
                />
              ),
          })}
        </Card>
      ) : (
        <Card className="overflow-hidden">
          {queryState(sessions, {
            loading: "Reading the sessions…",
            render: () =>
              open.length === 0 ? (
                <EmptyState>
                  {query === ""
                    ? "No session is open. Nothing is waiting to be minted."
                    : "No open session matches that search."}
                </EmptyState>
              ) : (
                <DataTable<SetupSessionRow>
                  table={sessionTable}
                  onRowClick={(row) => session.open(row.session_id)}
                  isSelected={(row) => row.session_id === session.value}
                  className="max-h-[calc(100vh-24rem)]"
                />
              ),
          })}
        </Card>
      )}

      <OpenSessionSheet
        receipt={
          waiting.find((row) => row.receipt_line_id === waiting_.value) ?? null
        }
        vocabulary={vocabulary.data}
        onClose={waiting_.close}
        onOpened={(opened) => {
          waiting_.close()
          // Straight into the session that was just made: the next question —
          // what the SKUs will be — is asked there, and making somebody find
          // it again in a list they were not looking at is a step for nothing.
          session.open(opened.session_id)
        }}
      />
      <SessionSheet
        id={session.value ?? null}
        onClose={() => session.close()}
      />
    </PageContent>
  )
}

// ---------------------------------------------------------------------------

function lifecycleOf(session: SetupSession) {
  const issued = session.issued_at !== null
  const tagged = session.tagged_at !== null
  return [
    { label: "Opened", state: "done" as const },
    {
      label: "Issued",
      state: issued ? ("done" as const) : ("current" as const),
    },
    {
      label: "Tagged",
      state: tagged
        ? ("done" as const)
        : issued
          ? ("current" as const)
          : ("todo" as const),
    },
  ]
}

/// One session: what it will mint, and the button that mints it.
function SessionSheet({
  id,
  onClose,
}: {
  id: string | null
  onClose: () => void
}) {
  const client = useQueryClient()
  const actor = useActor()
  const idempotency = useIdempotencyKey()

  const detail = useQuery({
    queryKey: procurementKeys.setup(id ?? ""),
    queryFn: ({ signal }) => setupSessionDetail(id!, signal),
    enabled: id !== null,
  })

  const issue = useMutation({
    mutationFn: () => issueSetupSession(id!, actor, idempotency.key),
    onSuccess: () => {
      // The session is no longer open, so the queue changes; the record itself
      // gains a job and a serial range. `setups()` is a prefix of the
      // unidentified queue's key, and that is deliberate — a receipt that has
      // been worked out leaves both lists at once.
      void client.invalidateQueries({ queryKey: procurementKeys.setups() })
      void client.invalidateQueries({ queryKey: procurementKeys.setup(id!) })
      idempotency.rotate()
    },
  })

  const colours = useMemo(() => {
    const seen = new Map<string, string>()
    for (const variant of detail.data?.variants ?? []) {
      if (!seen.has(variant.colour_digit))
        seen.set(variant.colour_digit, variant.colour_label)
    }
    return [...seen.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [detail.data])

  const declared = (detail.data?.variants ?? []).reduce(
    (sum, variant) => sum + variant.quantity,
    0
  )

  return (
    <Sheet
      open={id !== null}
      subject={id === null ? undefined : { kind: "article_setup", id }}
      onOpenChange={(open) => !open && onClose()}
      id={detail.data?.article_code}
      title={detail.data?.article_name ?? "Setup session"}
      footer={
        detail.data?.status === "OPEN" && (
          <Button
            variant="dark"
            className="w-full"
            disabled={actor === "" || issue.isPending}
            onClick={() => issue.mutate()}
          >
            {issue.isPending
              ? "Minting…"
              : "Issue: mint the article and send the tagging job"}
          </Button>
        )
      }
    >
      {queryState(detail, {
        loading: "Loading the session…",
        render: (session) => (
          <div className="flex flex-col gap-5">
            <Lifecycle steps={lifecycleOf(session)} />

            {issue.isError && (
              <Banner tone="bad">{(issue.error as Error).message}</Banner>
            )}
            {issue.isSuccess && issue.data.tagging_job_id && (
              <Banner tone="ok">
                Minted. Tagging job {issue.data.tagging_job_id} is on its way to{" "}
                {session.site_id}.
              </Banner>
            )}

            <div className="flex items-center gap-2">
              <Pill tone={toneFor(session.status)}>
                {label(session.status)}
              </Pill>
              {session.job && (
                <Pill tone={toneFor(session.job.status)}>
                  Tagging {label(session.job.status)}
                </Pill>
              )}
            </div>

            <Facts>
              <Fact term="Our article">{session.article_code}</Fact>
              <Fact term="Supplier's code">
                {session.supplier_article_code ?? "—"}
              </Fact>
              <Fact term="Division">{session.division_code}</Fact>
              <Fact term="Landed at">{session.site_id}</Fact>
              <Fact term="Opened by">{session.created_by}</Fact>
              <Fact term="Opened">{day(session.created_at)}</Fact>
              <Fact term="Issued">{day(session.issued_at)}</Fact>
              <Fact term="Tagged">{day(session.tagged_at)}</Fact>
            </Facts>

            {session.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {session.tags.map((tag) => (
                  <Tag key={tag}>{tag}</Tag>
                ))}
              </div>
            )}

            <div>
              <h4 className="mb-2 text-card-title font-semibold text-ink">
                Variants
              </h4>
              {session.variants.length === 0 ? (
                <p className="text-meta text-mute">
                  Nothing has been minted yet. Issuing the session draws the
                  SKUs, their serial ranges and their EPCs in one transaction.
                </p>
              ) : (
                <MiniTable head={["SKU", "Qty", "Serials", "Price"]}>
                  {session.variants.map((variant) => (
                    <tr
                      key={variant.sku_code}
                      className="border-t border-hairline"
                    >
                      <td className="py-2 pr-2">
                        <span className="block font-mono text-[0.71875rem] text-ink">
                          {variant.sku_code}
                        </span>
                        <span className="text-[0.65625rem] text-mute">
                          {variant.colour_label} · {variant.size_label}
                        </span>
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {count(variant.quantity)}
                      </td>
                      <td className="py-2 text-right font-mono text-[0.65625rem] text-body tabular-nums">
                        {variant.serial_from}–{variant.serial_to}
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {money(variant.base_price_minor)}
                      </td>
                    </tr>
                  ))}
                </MiniTable>
              )}
              <TotalsLadder
                className="mt-3"
                rows={[
                  {
                    label: "Split into variants",
                    value: count(declared),
                  },
                  {
                    label: "Not yet accounted for",
                    value: count(session.receipt_quantity - declared),
                  },
                ]}
                total={{
                  label: "Pieces received",
                  value: count(session.receipt_quantity),
                }}
              />
            </div>

            <div>
              <h4 className="mb-2 text-card-title font-semibold text-ink">
                Colourways
              </h4>
              {colours.length === 0 ? (
                <p className="text-meta text-mute">
                  A photograph is filed per colourway, so there is nowhere to
                  put one until the session has been issued and its colours
                  exist.
                </p>
              ) : (
                <div className="flex flex-col gap-3">
                  {colours.map(([digit, colourLabel]) => (
                    <Colourway
                      key={digit}
                      articleCode={session.article_code}
                      digit={digit}
                      label={colourLabel}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        ),
      })}
    </Sheet>
  )
}

/// One colour of one article, and its photograph.
///
/// The bytes never pass through the node: it hands out a URL that authorises
/// exactly this key for an hour, and the browser PUTs straight to the bucket.
function Colourway({
  articleCode,
  digit,
  label: colourLabel,
}: {
  articleCode: string
  digit: string
  label: string
}) {
  const client = useQueryClient()

  const image = useQuery({
    queryKey: procurementKeys.articleImage(articleCode, digit),
    queryFn: ({ signal }) => articleImage(articleCode, digit, signal),
    staleTime: 10 * 60 * 1000,
  })

  const upload = useMutation({
    mutationFn: (file: File) => uploadArticleImage(articleCode, digit, file),
    onSuccess: () =>
      client.invalidateQueries({
        queryKey: procurementKeys.articleImage(articleCode, digit),
      }),
  })

  return (
    <div className="flex items-center gap-3 rounded-inner border border-hairline p-2.5">
      {image.data ? (
        <img
          src={image.data.url}
          alt={colourLabel}
          className="size-14 shrink-0 rounded-inner border border-hairline object-cover"
        />
      ) : (
        <span className="grid size-14 shrink-0 place-items-center rounded-inner bg-soft-2 font-mono text-[0.71875rem] text-mute">
          {digit}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block text-[0.8125rem] font-medium text-ink">
          {colourLabel}
        </span>
        <span className="block font-mono text-[0.65625rem] text-mute">
          catalogue/{articleCode}/{digit}.jpg
        </span>
        {upload.isError && (
          <span className="block text-[0.6875rem] text-bad">
            {(upload.error as Error).message}
          </span>
        )}
      </span>
      <label className="inline-flex h-8 shrink-0 cursor-pointer items-center rounded-full border border-hairline-2 bg-canvas px-3 text-[0.78125rem] font-medium text-text transition-colors hover:bg-soft-2">
        {upload.isPending
          ? "Sending…"
          : image.data
            ? "Replace"
            : "Add a photograph"}
        <input
          type="file"
          accept="image/jpeg"
          className="sr-only"
          disabled={upload.isPending}
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) upload.mutate(file)
            event.target.value = ""
          }}
        />
      </label>
    </div>
  )
}

/// Give one delivery its identity.
///
/// This sheet is the step the whole chain was waiting on. Goods are received
/// and accepted at the DC, they reach head office with the supplier's own code
/// and nothing of ours, and until somebody answers "what IS this" they have no
/// article, therefore no SKU, therefore no tag, no price and no sale. The DC's
/// tagging queue says as much in its empty state: head office issues these
/// when goods are accepted.
///
/// Almost everything is prefilled from what the buyer already wrote on the
/// order. The two things only a person can say are which colours arrived and
/// how the pieces split across colour and size — and the second is checked
/// against the quantity the warehouse actually counted, because a session that
/// declared more pieces than turned up would mint stock that does not exist.
function OpenSessionSheet({
  receipt,
  vocabulary,
  onClose,
  onOpened,
}: {
  receipt: UnidentifiedReceipt | null
  vocabulary?: CatalogueVocabulary
  onClose: () => void
  onOpened: (session: SetupSession) => void
}) {
  const client = useQueryClient()
  const actor = useActor()

  /// The sizes this business actually sells, read off the catalogue's own
  /// facets rather than a master list. That is a deliberate narrowing: a size
  /// nothing has ever been sold in is a size nobody is about to receive, and
  /// offering the full ISO range would bury the six that matter.
  const catalogue = useQuery({
    queryKey: articleKeys.list({ limit: 1 }),
    queryFn: ({ signal }) => searchArticles({ limit: 1 }, signal),
    staleTime: 10 * 60 * 1000,
  })
  const sizes = catalogue.data?.facets.sizes ?? []

  const open = useMutation({
    mutationFn: (request: NewSetupSession) => openSetupSession(request),
    onSuccess: (session) => {
      // The queue this line was in, and the sessions it just joined.
      void client.invalidateQueries({
        queryKey: procurementKeys.unidentified(),
      })
      void client.invalidateQueries({ queryKey: procurementKeys.setups() })
      onOpened(session)
    },
  })

  return (
    <Sheet
      open={receipt !== null}
      onOpenChange={(next) => !next && onClose()}
      id={receipt?.po_number}
      title={receipt?.article_name ?? "Give this delivery an identity"}
    >
      {receipt !== null && (
        <SessionComposer
          key={receipt.receipt_line_id}
          receipt={receipt}
          vocabulary={vocabulary}
          sizes={sizes}
          actor={actor}
          problem={open.error === null ? null : (open.error as Error).message}
          busy={open.isPending}
          onSubmit={(request) => open.mutate(request)}
        />
      )}
    </Sheet>
  )
}

/// The form itself, keyed on the receipt line so switching deliveries starts
/// clean rather than carrying the last one's colours into this one.
function SessionComposer({
  receipt,
  vocabulary,
  sizes,
  actor,
  problem,
  busy,
  onSubmit,
}: {
  receipt: UnidentifiedReceipt
  vocabulary?: CatalogueVocabulary
  sizes: readonly FacetCount[]
  actor: string
  problem: string | null
  busy: boolean
  onSubmit: (request: NewSetupSession) => void
}) {
  const [chosenColours, setChosenColours] = useState<ArticleColourwayInput[]>(
    []
  )
  const [chosenSizes, setChosenSizes] = useState<readonly string[]>([])
  /// Keyed `digit|size` so a cell survives a colour being removed and added
  /// back, which happens constantly while somebody works out what arrived.
  const [pieces, setPieces] = useState<Record<string, string>>({})
  const [price, setPrice] = useState("")
  const [name, setName] = useState(receipt.article_name)
  const [division, setDivision] = useState(receipt.division_code ?? "")

  const cells = chosenColours.flatMap((colour) =>
    chosenSizes.map((size) => ({
      colour_digit: colour.colour_digit,
      colour_code: colour.colour_code,
      size_code: size,
      key: `${colour.colour_digit}|${size}`,
    }))
  )
  const declared = cells.reduce(
    (sum, cell) => sum + (Number(pieces[cell.key]) || 0),
    0
  )
  const priceMinor = Number(price.replace(/[^\d]/g, "")) || 0
  // Every piece the warehouse counted has to end up somewhere. Declaring fewer
  // leaves stock unaccounted; declaring more mints stock that never arrived.
  const balanced = declared === receipt.quantity
  const ready =
    name.trim() !== "" &&
    division !== "" &&
    chosenColours.length > 0 &&
    chosenSizes.length > 0 &&
    balanced &&
    priceMinor > 0 &&
    actor !== ""

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        // The button is disabled, but a form submits on Enter regardless and
        // `disabled` on a control elsewhere cannot stop that.
        if (!ready || busy) return
        onSubmit({
          receipt_line_id: receipt.receipt_line_id,
          article_name: name.trim(),
          division_code: division,
          tags: receipt.tags,
          image_url: receipt.image_url,
          currency: "IDR",
          colours: chosenColours,
          variants: cells
            .filter((cell) => (Number(pieces[cell.key]) || 0) > 0)
            .map((cell) => ({
              colour_digit: cell.colour_digit,
              size_code: cell.size_code,
              quantity: Number(pieces[cell.key]),
              base_price_minor: priceMinor,
            })),
          created_by: actor,
        })
      }}
      className="flex flex-col gap-5"
    >
      {problem !== null && <Banner tone="bad">{problem}</Banner>}

      <Facts>
        <Fact term="Delivery">{receipt.receipt_number}</Fact>
        <Fact term="Landed at">{receipt.site_id}</Fact>
        <Fact term="Counted">{count(receipt.quantity)} pieces</Fact>
        <Fact term="Supplier code">{receipt.supplier_article_code}</Fact>
      </Facts>

      <Field label="What is it called">
        <Input value={name} onChange={(event) => setName(event.target.value)} />
      </Field>

      <Field label="Division">
        <Select
          value={division}
          onChange={(event) => setDivision(event.target.value)}
        >
          <option value="">Choose a division…</option>
          {(vocabulary?.divisions ?? []).map((term) => (
            <option key={term.code} value={term.code}>
              {term.label}
            </option>
          ))}
        </Select>
      </Field>

      <div>
        <SubHead aside={`${count(chosenColours.length)} chosen`}>
          Colours that arrived
        </SubHead>
        <ColourPicker
          value={chosenColours}
          onChange={setChosenColours}
          minted={new Map()}
        />
      </div>

      <div>
        <SubHead aside={`${count(chosenSizes.length)} chosen`}>Sizes</SubHead>
        <div className="flex flex-wrap gap-1.5">
          {sizes.map((size) => (
            <button
              key={size.value}
              type="button"
              onClick={() => setChosenSizes(toggle(chosenSizes, size.value))}
              className={cn(
                "rounded-full border px-2.5 py-1 text-[0.75rem] transition-colors",
                chosenSizes.includes(size.value)
                  ? "border-ink bg-ink text-white"
                  : "border-hairline-2 text-text hover:bg-soft-2"
              )}
            >
              {size.value}
            </button>
          ))}
        </div>
        {sizes.length === 0 && (
          <p className="text-[0.71875rem] text-mute">
            No size has ever been used in this catalogue, so there is nothing to
            choose from yet.
          </p>
        )}
      </div>

      {cells.length > 0 && (
        <div>
          <SubHead
            aside={
              <span className={balanced ? "text-ok-fg" : "text-warn-fg"}>
                {count(declared)} of {count(receipt.quantity)}
              </span>
            }
          >
            How the pieces split
          </SubHead>
          <MiniTable head={["Colour", "Size", "Pieces"]}>
            {cells.map((cell) => (
              <MiniRow key={cell.key}>
                <MiniCell>{cell.colour_code}</MiniCell>
                <MiniCell>{cell.size_code}</MiniCell>
                <MiniCell align="right">
                  <Input
                    inputMode="numeric"
                    aria-label={`Pieces of ${cell.colour_code} ${cell.size_code}`}
                    value={pieces[cell.key] ?? ""}
                    onChange={(event) =>
                      setPieces((was) => ({
                        ...was,
                        [cell.key]: event.target.value,
                      }))
                    }
                    className="h-8 w-20 text-right"
                  />
                </MiniCell>
              </MiniRow>
            ))}
          </MiniTable>
          {!balanced && (
            <p className="mt-2 text-[0.71875rem] text-warn-fg">
              {declared > receipt.quantity
                ? "That is more than the warehouse counted. A session cannot mint stock that did not arrive."
                : "Every piece counted has to be accounted for before this can be opened."}
            </p>
          )}
        </div>
      )}

      <Field
        label="Base price"
        hint="What one piece will be worth. The same for every variant here — a colour that sells for more is a price decision, and it is made in Commercial, not at intake."
      >
        <Input
          inputMode="numeric"
          value={price}
          onChange={(event) => setPrice(event.target.value)}
          placeholder="31000"
        />
      </Field>

      <Button
        variant="dark"
        type="submit"
        disabled={!ready || busy}
        className="w-full"
      >
        {busy ? "Opening…" : "Open the session"}
      </Button>
    </form>
  )
}
