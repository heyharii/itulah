import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Field, Input, Select } from "@/components/ui/field"
import { Meter } from "@/components/ui/meter"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { MiniCell, MiniRow, MiniTable, SubHead } from "@/components/ui/rows"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState, ErrorState } from "@/components/ui/states"
import { AppLink } from "@/components/ui/app-link"
import { count, day, label, money, moment, toneFor } from "@/lib/format"
import {
  BookWrittenNotPublished,
  commercialKeys,
  commercialUsage,
  instantOf,
  minorOf,
  NOTHING_TO_PUBLISH,
  promotionCatalogue,
  setCampaignStatus,
  writeAndPublish,
  type CampaignInput,
  type CampaignRow,
  type PromotionRow,
  type PromotionUsage,
  type PublishReceipt,
} from "@/lib/queries/commercial"
import { queryState } from "@/lib/query-state"
import { CommercialTabs } from "@/screens/commercial/tabs"
import { PerformanceHeader } from "@/screens/commercial/performance-header"
import { useSheet } from "@/lib/sheets"
import { tableSetup, type TableSetup } from "@/lib/table"
import { Named, Quiet, Switch } from "@/screens/commercial/parts"
import {
  consumed,
  describeEffect,
  describeScope,
  localInput,
  percent,
  useActor,
} from "@/screens/commercial/shared"

/// Campaigns — the envelope a set of offers is run as one thing inside.
///
/// A campaign is not a bigger promotion. It is one window, one budget and one
/// switch over several rules, and the engine reads it that way: **a rule is
/// live only when both it and its campaign are**. That is the whole reason it
/// is a screen — "stop the Lebaran promo" is one act here and six acts on the
/// Promotions list, and six acts is how one gets left running.
///
/// The header tiles are `<PerformanceHeader>`, reading
/// `GET /api/v1/commercial/performance/campaigns` — every figure on them is an
/// aggregate over `edge_sale_promotion` and `edge_sale` that only the server
/// can compute. That endpoint is written and tested but not yet deployed to
/// this node, so the panel says so rather than inventing numbers in a browser
/// from data it does not hold. The list itself — caps, spend, uses, reach —
/// needs none of it and is live either way.

/// The two things a column needs from the screen around it.
///
/// A column is declared outside its component so it never closes over props —
/// which leaves the switch, whose whole job is to call back into the screen,
/// with nowhere to reach. TanStack's own `meta` slot is that route, and this is
/// its shape. Read through `unknown` rather than `any`: the slot is untyped by
/// the table, and asserting a shape once here is better than nine unchecked
/// property accesses in the cells.
interface RowActions<T> {
  readonly busy: string | null
  readonly onToggle: (line: T) => void
}

function actionsOf<T>(table: unknown): RowActions<T> | undefined {
  return (table as { options?: { meta?: RowActions<T> } }).options?.meta
}

const UNLIMITED = -1

/// The lifecycle the engine actually models. A superset of the four a
/// dashboard usually shows, and worth keeping whole: "cancelled" and "expired"
/// are different endings and only one of them was somebody's decision.
const STATUSES = [
  "DRAFT",
  "SCHEDULED",
  "ACTIVE",
  "PAUSED",
  "EXPIRED",
  "CANCELLED",
] as const

interface CampaignLine {
  readonly row: CampaignRow
  readonly usage: PromotionUsage | null
  /// The promotions that named this campaign. Counted from the rules rather
  /// than held on the campaign: a rule joins a campaign by naming it, so the
  /// membership only exists in one direction.
  readonly rules: readonly PromotionRow[]
  readonly reached: number
}

const columns: ColumnDef<TableSetup, CampaignLine>[] = [
  {
    id: "live",
    header: "Live",
    size: 60,
    enableSorting: false,
    cell: ({ row, table }) => {
      const meta = actionsOf<CampaignLine>(table)
      const status = row.original.row.campaign.status
      return (
        <Switch
          on={status === "ACTIVE"}
          busy={meta?.busy === row.original.row.campaign.campaign_id}
          label={`${status === "ACTIVE" ? "Pause" : "Resume"} ${row.original.row.campaign.name}`}
          onToggle={() => meta?.onToggle?.(row.original)}
        />
      )
    },
  },
  {
    id: "campaign",
    accessorFn: (row) => row.row.campaign.name,
    header: "Campaign",
    size: 220,
    meta: { filter: { kind: "text" } },
    cell: ({ row }) => (
      <Named
        name={
          <span className="font-medium text-ink">
            {row.original.row.campaign.name}
          </span>
        }
        code={row.original.row.campaign.campaign_id}
      />
    ),
  },
  {
    id: "status",
    accessorFn: (row) => row.row.campaign.status,
    header: "Status",
    size: 110,
    meta: { filter: { kind: "option", format: label } },
    cell: ({ row }) => (
      <Pill tone={toneFor(row.original.row.campaign.status)}>
        {label(row.original.row.campaign.status)}
      </Pill>
    ),
  },
  {
    id: "window",
    accessorFn: (row) => row.row.campaign.valid_to ?? "",
    header: "Runs",
    size: 190,
    cell: ({ row }) => (
      <span className="text-body">
        {row.original.row.campaign.valid_from
          ? day(row.original.row.campaign.valid_from)
          : "always"}{" "}
        →{" "}
        {row.original.row.campaign.valid_to
          ? day(row.original.row.campaign.valid_to)
          : "open"}
      </span>
    ),
  },
  {
    id: "rules",
    accessorFn: (row) => row.rules.length,
    header: "Offers",
    size: 80,
    meta: { align: "right" },
    cell: ({ row }) => count(row.original.rules.length),
  },
  {
    id: "budget",
    accessorFn: (row) => row.row.campaign.budget_minor ?? UNLIMITED,
    header: "Budget",
    size: 130,
    meta: { align: "right" },
    // Whole-window, never daily: `caps.budget_minor` is the total a campaign
    // may give away between its two dates, and drawing it as a daily figure
    // would understate it by however many days the campaign runs.
    cell: ({ row }) =>
      row.original.row.campaign.budget_minor === null ? (
        <span className="text-mute">Unlimited</span>
      ) : (
        money(row.original.row.campaign.budget_minor)
      ),
  },
  {
    id: "spent",
    accessorFn: (row) =>
      consumed(row.usage?.spent_minor ?? 0, row.row.campaign.budget_minor) ??
      UNLIMITED,
    header: "Spent",
    size: 160,
    // The decision metric: a campaign near its budget is the one somebody has
    // to stop or top up before the weekend.
    cell: ({ row }) => {
      const spent = row.original.usage?.spent_minor ?? 0
      const share = consumed(spent, row.original.row.campaign.budget_minor)
      if (share === null) {
        return (
          <span className="text-text tabular-nums">
            {money(spent)} <span className="text-mute">· no limit</span>
          </span>
        )
      }
      return (
        <span className="flex items-center gap-2">
          <Meter
            value={share}
            tone={share >= 0.9 ? "bad" : share >= 0.7 ? "warn" : "accent"}
          />
          <span
            className={
              share >= 0.9
                ? "shrink-0 font-medium text-bad-fg tabular-nums"
                : "shrink-0 text-body tabular-nums"
            }
          >
            {percent(Math.round(share * 10_000))}
          </span>
        </span>
      )
    },
  },
  {
    id: "uses",
    accessorFn: (row) => row.usage?.uses ?? 0,
    header: "Used",
    size: 100,
    meta: { align: "right" },
    cell: ({ row }) => {
      const used = row.original.usage?.uses ?? 0
      const most = row.original.row.campaign.max_uses
      return (
        <span className="tabular-nums">
          {count(used)}
          {most === null ? "" : ` / ${count(most)}`}
        </span>
      )
    },
  },
  {
    id: "reached",
    accessorFn: (row) => row.reached,
    header: "In shops",
    size: 110,
    cell: ({ row }) =>
      row.original.reached === 0 ? (
        <Pill tone="warn">No shop</Pill>
      ) : (
        <span className="text-text">
          {count(row.original.reached)} shop
          {row.original.reached === 1 ? "" : "s"}
        </span>
      ),
  },
]

export function Campaigns() {
  const client = useQueryClient()
  const actor = useActor()
  const [query, setQuery] = useState("")
  const [writing, setWriting] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [receipt, setReceipt] = useState<PublishReceipt | null>(null)
  const [sorting, setSorting] = useState<SortingState>([
    { id: "spent", desc: true },
  ])
  /// Which campaign is open — in the URL, as PATTERN.md wants, so it can be
  /// linked to, survives a reload, and the palette can open it.
  const sheet = useSheet("campaign")

  const catalogue = useQuery({
    queryKey: commercialKeys.catalogue(),
    queryFn: ({ signal }) => promotionCatalogue(signal),
  })

  const usage = useQuery({
    queryKey: commercialKeys.usage(),
    queryFn: ({ signal }) => commercialUsage(signal),
  })

  const byKey = useMemo(() => {
    const map = new Map<string, PromotionUsage>()
    for (const one of usage.data ?? []) map.set(`${one.kind}:${one.key}`, one)
    return map
  }, [usage.data])

  const lines: CampaignLine[] = useMemo(
    () =>
      (catalogue.data?.campaigns ?? []).map((row) => ({
        row,
        usage: byKey.get(`CAMPAIGN:${row.campaign.campaign_id}`) ?? null,
        rules: (catalogue.data?.rules ?? []).filter(
          (rule) => rule.definition.campaign_id === row.campaign.campaign_id
        ),
        reached: row.book.activated_by.length,
      })),
    [catalogue.data, byKey]
  )

  /// Pause and resume, through the one function that knows how a status is
  /// written. No status route exists on the node, so this publishes a one-line
  /// book restating the campaign — `setCampaignStatus` is the only place that
  /// changes when `PATCH …/status` lands.
  const toggle = useMutation({
    mutationFn: (line: CampaignLine) =>
      setCampaignStatus({
        campaign: asInput(line.row),
        status: line.row.campaign.status === "ACTIVE" ? "PAUSED" : "ACTIVE",
        version: catalogue.data?.next_version ?? 1,
        actorId: actor,
        idempotencyKey: crypto.randomUUID(),
      }),
    onSettled: () => {
      setBusy(null)
      client.invalidateQueries({ queryKey: commercialKeys.all })
    },
  })

  // `mutate` is stable for the life of the mutation; `toggle` itself is a new
  // object on every status change of the mutation, and depending on it would
  // rebuild the whole table each time somebody flipped a switch.
  const flip = toggle.mutate

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: lines,
        columns,
        getRowId: (row: CampaignLine) => row.row.campaign.campaign_id,
        state: { globalFilter: query, sorting },
        onSortingChange: setSorting,
        onGlobalFilterChange: setQuery,
        meta: {
          busy,
          onToggle: (line: CampaignLine) => {
            setBusy(line.row.campaign.campaign_id)
            flip(line)
          },
        },
      }),
      [lines, query, sorting, busy, flip]
    )
  )

  return (
    <PageContent>
      <PageHeader
        crumb="Commercial"
        title="Campaign"
        sub="One window, one budget and one switch over a set of offers the business runs as one thing."
        actions={
          <>
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search"
              className="h-8 w-44"
            />
            <Button variant="dark" onClick={() => setWriting(true)}>
              New campaign
            </Button>
          </>
        }
      />

      <CommercialTabs current="/commercial/campaigns" />

      {/* What the offers did, above what declares them. The list below says
          which campaigns exist and what they are allowed to spend; this says
          what they actually spent and what came back with it. */}
      <PerformanceHeader of="campaigns" />

      {toggle.isError && (
        <div className="mb-4">
          <ErrorState error={toggle.error} />
        </div>
      )}

      {receipt && (
        <Banner
          tone={receipt.delivered_to.length > 0 ? "ok" : "warn"}
          className="mb-4"
          onDismiss={() => setReceipt(null)}
        >
          {receipt.delivered_to.length > 0 ? (
            <>
              Book v{receipt.version} published and queued for{" "}
              {count(receipt.delivered_to.length)} shop
              {receipt.delivered_to.length === 1 ? "" : "s"} (
              {receipt.delivered_to.join(", ")}).
            </>
          ) : (
            <>
              Book v{receipt.version} published, and queued for nobody. No shop
              origin is registered, so nothing in this campaign will apply
              anywhere.
            </>
          )}
        </Banner>
      )}

      <Card className="overflow-hidden">
        {queryState(catalogue, {
          loading: "Opening every published book…",
          render: (data) =>
            lines.length === 0 ? (
              <EmptyState
                action={
                  <Button variant="soft" onClick={() => setWriting(true)}>
                    New campaign
                  </Button>
                }
              >
                No campaign is published. {count(data.book_count)} book
                {data.book_count === 1 ? "" : "s"} were opened to check. A
                promotion does not need one — a campaign is for the case where
                several offers share a budget and stop together.
              </EmptyState>
            ) : (
              <DataTable<CampaignLine>
                table={table}
                onRowClick={(row) => sheet.open(row.row.campaign.campaign_id)}
                isSelected={(row) =>
                  row.row.campaign.campaign_id === sheet.value
                }
                empty="No campaign matches that search."
                className="max-h-[calc(100vh-15rem)]"
              />
            ),
        })}
      </Card>

      {catalogue.data && (
        <p className="mt-2.5 text-[0.71875rem] text-mute">
          Drawn from {count(catalogue.data.book_count)} published book
          {catalogue.data.book_count === 1 ? "" : "s"}. Where one campaign
          appears in several books the newest wins, which is what a shop does
          too.
        </p>
      )}

      <CampaignSheet
        line={
          lines.find((one) => one.row.campaign.campaign_id === sheet.value) ??
          null
        }
        onClose={sheet.close}
      />

      <CampaignForm
        open={writing}
        nextVersion={catalogue.data?.next_version ?? 1}
        onClose={() => setWriting(false)}
        onPublished={(published) => {
          setReceipt(published)
          setWriting(false)
        }}
      />
    </PageContent>
  )
}

/// The campaign as the command that would restate it.
///
/// `max_uses_per_customer` is deliberately dropped: the server refuses a
/// campaign that carries one, because nothing counts a customer's own history
/// and the limit would never bite. Carrying it through a status flip would make
/// pausing a campaign fail on a field nobody touched.
function asInput(row: CampaignRow): CampaignInput {
  return {
    campaign_id: row.campaign.campaign_id,
    name: row.campaign.name,
    status: row.campaign.status,
    valid_from: row.campaign.valid_from,
    valid_to: row.campaign.valid_to,
    budget_minor: row.campaign.budget_minor,
    max_uses: row.campaign.max_uses,
  }
}

/// What this envelope holds, what it has cost, and how far it has got.
function CampaignSheet({
  line,
  onClose,
}: {
  line: CampaignLine | null
  onClose: () => void
}) {
  const spent = line?.usage?.spent_minor ?? 0
  const share = consumed(spent, line?.row.campaign.budget_minor ?? null)

  return (
    <Sheet
      open={line !== null}
      onOpenChange={(next) => !next && onClose()}
      id={line?.row.campaign.campaign_id}
      title={line?.row.campaign.name ?? "Campaign"}
    >
      {line === null ? null : (
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone={toneFor(line.row.campaign.status)}>
              {label(line.row.campaign.status)}
            </Pill>
            <span className="text-[0.71875rem] text-mute">
              from {line.row.book.name}
            </span>
          </div>

          <Facts>
            <Fact term="Runs from">
              {line.row.campaign.valid_from
                ? day(line.row.campaign.valid_from)
                : "Always"}
            </Fact>
            <Fact term="Until">
              {line.row.campaign.valid_to
                ? day(line.row.campaign.valid_to)
                : "Open"}
            </Fact>
            <Fact term="Budget">
              {line.row.campaign.budget_minor === null
                ? "Unlimited"
                : money(line.row.campaign.budget_minor)}
            </Fact>
            <Fact term="Given away">{money(spent)}</Fact>
            <Fact term="Uses">
              {count(line.usage?.uses ?? 0)}
              {line.row.campaign.max_uses === null
                ? ""
                : ` / ${count(line.row.campaign.max_uses)}`}
            </Fact>
            <Fact term="Customers">
              {count(line.usage?.customer_count ?? 0)}
            </Fact>
          </Facts>

          {share !== null && (
            <div>
              <SubHead aside={percent(Math.round(share * 10_000))}>
                Budget
              </SubHead>
              <Meter
                value={share}
                tone={share >= 0.9 ? "bad" : share >= 0.7 ? "warn" : "accent"}
              />
              <p className="mt-2 text-[0.71875rem] leading-relaxed text-mute">
                A budget is a brake, not a gate. Every shop enforces from the
                last count it received, so this figure is ahead of what the
                tills know — send the counts from Promotions to close the gap.
              </p>
            </div>
          )}

          <div>
            <SubHead aside={`${count(line.rules.length)} offers`}>
              What is inside it
            </SubHead>
            {line.rules.length === 0 ? (
              <Quiet>
                No promotion names this campaign. A rule joins by setting its
                own `campaign_id`, so an empty campaign is an envelope nothing
                was put in.
              </Quiet>
            ) : (
              <>
                <MiniTable
                  head={[
                    "Promotion",
                    { label: "Applies to", align: "left" },
                    "Does",
                  ]}
                >
                  {line.rules.map((rule) => (
                    <MiniRow key={rule.rule_id}>
                      <MiniCell>
                        <Named name={rule.name} code={rule.status} />
                      </MiniCell>
                      <MiniCell>
                        <span className="text-[0.71875rem] text-body">
                          {describeScope(rule.definition)}
                        </span>
                      </MiniCell>
                      <MiniCell align="right">
                        <span className="text-[0.71875rem] text-text">
                          {describeEffect(rule.definition.effect)}
                        </span>
                      </MiniCell>
                    </MiniRow>
                  ))}
                </MiniTable>
                {/* No dead ends: if two things relate, the UI crosses between
                    them in one click. */}
                <p className="mt-2 text-[0.71875rem] text-mute">
                  <AppLink to="/commercial/promotions" className="text-accent">
                    Open these on Promotions
                  </AppLink>{" "}
                  to pause one on its own. Pausing the campaign stops all of
                  them at once — a rule is live only when both it and its
                  campaign are.
                </p>
              </>
            )}
          </div>

          <div>
            <SubHead aside={line.row.book.name}>In service at</SubHead>
            {line.row.book.activated_by.length === 0 ? (
              <Quiet>
                No shop has put the book carrying this campaign into service, so
                nothing inside it is applying anywhere yet.
              </Quiet>
            ) : (
              <MiniTable
                head={[
                  "Shop",
                  { label: "Since", align: "left" },
                  "Rules taken",
                ]}
              >
                {line.row.book.activated_by.map((activation) => (
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
            )}
          </div>

          <p className="text-[0.71875rem] leading-relaxed text-mute">
            What this campaign earned back is not here. Every figure for that —
            discount released, baskets, influenced revenue, new customers — is
            an aggregate over `edge_sale_promotion` and `edge_sale`, and no
            endpoint computes it yet.
          </p>
        </div>
      )}
    </Sheet>
  )
}

/// Writing an envelope.
///
/// A campaign-only book is a legal book: the server's "must change something"
/// check counts campaigns as well as prices, so an envelope can be published
/// before anything is put in it — which is the order people actually work in.
function CampaignForm({
  open,
  nextVersion,
  onClose,
  onPublished,
}: {
  open: boolean
  nextVersion: number
  onClose: () => void
  onPublished: (receipt: PublishReceipt) => void
}) {
  const client = useQueryClient()
  const actor = useActor()
  const [name, setName] = useState("")
  const [status, setStatus] = useState<string>("ACTIVE")
  const [from, setFrom] = useState(() => localInput(new Date()))
  const [to, setTo] = useState("")
  const [budget, setBudget] = useState("")
  const [maxUses, setMaxUses] = useState("")

  const validFrom = from === "" ? null : instantOf(from)
  const validTo = to === "" ? null : instantOf(to)
  const windowBroken =
    validFrom !== null &&
    validTo !== null &&
    new Date(validTo) <= new Date(validFrom)
  const budgetMinor = budget.trim() === "" ? null : minorOf(budget)

  /// A fresh key for each attempt, made where the command is built rather than
  /// held for the life of the sheet.
  ///
  /// Reusing one key across attempts is what an idempotency key is usually for,
  /// and here it would be wrong: a halted publish leaves a book behind, so the
  /// *next* attempt asks for a higher version — a different payload under the
  /// same key, which `command_deduplication` refuses outright. The guard
  /// against a double click is the disabled button, and the guard against a
  /// lost response is the version check, which refuses a second book at a
  /// number already taken.
  const publish = useMutation({
    mutationFn: () =>
      writeAndPublish({
        ...NOTHING_TO_PUBLISH,
        version: nextVersion,
        name: `Campaign: ${name.trim()}`,
        effective_from: validFrom ?? new Date().toISOString(),
        effective_to: null,
        campaigns: [
          {
            // Readable, and unique enough: the id travels to every till and
            // shows on the sheet, so a slug beats a uuid nobody can say out
            // loud.
            campaign_id: `${slug(name)}-${crypto.randomUUID().slice(0, 4)}`,
            name: name.trim(),
            status,
            valid_from: validFrom,
            valid_to: validTo,
            budget_minor: budgetMinor,
            max_uses: maxUses.trim() === "" ? null : Number(maxUses),
          },
        ],
        actor_id: actor,
        idempotency_key: crypto.randomUUID(),
      }),
    onError: () => {
      // A halted publish still wrote a book, so the number this form is asking
      // for is now taken.
      client.invalidateQueries({ queryKey: commercialKeys.books() })
    },
    onSuccess: (receipt) => {
      client.invalidateQueries({ queryKey: commercialKeys.all })
      onPublished(receipt)
      setName("")
      setBudget("")
      setMaxUses("")
    },
  })

  const ready =
    actor !== "" &&
    name.trim() !== "" &&
    !windowBroken &&
    (budget.trim() === "") === (budgetMinor === null) &&
    !publish.isPending

  const halted =
    publish.error instanceof BookWrittenNotPublished ? publish.error : null

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title="New campaign"
      id={`v${nextVersion}`}
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className="text-[0.71875rem] text-mute">
            Published and sent to every shop the moment you press this.
          </span>
          <Button
            variant="dark"
            disabled={!ready}
            onClick={() => publish.mutate()}
          >
            {publish.isPending ? "Publishing…" : "Publish"}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {halted !== null ? (
          <Banner tone="bad">{halted.message}</Banner>
        ) : publish.isError ? (
          <ErrorState error={publish.error} />
        ) : null}

        <Field
          label="What it is called"
          hint="Lebaran, End of season — the name the business uses for the whole thing."
        >
          <Input
            value={name}
            autoFocus
            placeholder="Lebaran"
            onChange={(event) => setName(event.target.value)}
          />
        </Field>

        <Field
          label="Status"
          hint="Six states, not four: cancelled and expired are different endings, and only one of them was a decision."
        >
          <Select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            {STATUSES.map((one) => (
              <option key={one} value={one}>
                {label(one)}
              </option>
            ))}
          </Select>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Runs from">
            <Input
              type="datetime-local"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
            />
          </Field>
          <Field
            label="Until"
            problem={
              windowBroken ? "The end has to come after the start." : undefined
            }
          >
            <Input
              type="datetime-local"
              value={to}
              onChange={(event) => setTo(event.target.value)}
            />
          </Field>
        </div>

        <Field
          label="Budget for the whole window"
          hint="Not a daily figure — this is the total every offer inside the campaign shares between the two dates. Leave empty for unlimited."
        >
          <Input
            value={budget}
            inputMode="numeric"
            placeholder="Unlimited"
            onChange={(event) => setBudget(event.target.value)}
          />
        </Field>

        <Field label="Most baskets" hint="Shared across every offer inside it.">
          <Input
            value={maxUses}
            inputMode="numeric"
            placeholder="Unlimited"
            onChange={(event) => setMaxUses(event.target.value)}
          />
        </Field>

        <p className="text-[0.71875rem] leading-relaxed text-mute">
          Offers join a campaign from the promotion form, by naming it. A
          per-customer limit is not offered here: the server refuses one,
          because nothing counts a customer&rsquo;s own history and the limit
          would never bite.
        </p>
      </div>
    </Sheet>
  )
}

/// A campaign id somebody can read off a shelf ticket.
function slug(name: string): string {
  const cleaned = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return cleaned === "" ? "campaign" : cleaned.slice(0, 24)
}
