import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Field, Input, Money, Textarea } from "@/components/ui/field"
import { Day } from "@/components/ui/day"
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
import { PerformanceHeader } from "@/screens/commercial/performance-header"
import { useSheet } from "@/lib/sheets"
import { tableSetup, type TableSetup } from "@/lib/table"
import { Switch } from "@/components/ui/form"
import { Named, Quiet } from "@/screens/commercial/parts"
import { endOfDay, shift, startOfDay, today } from "@/lib/calendar"
import { Choices, Section, Stepper, type Tile } from "@/components/ui/form"
import { Terms } from "@/screens/commercial/controls"
import {
  consumed,
  describeEffect,
  describeScope,
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
///
/// Each carries the line that distinguishes it from the one beside it. As six
/// rows of a dropdown they were six shouted enum names with nothing to choose
/// between them; as six tiles the difference is on the glass, which is the
/// whole reason the distinction was kept.
const CAMPAIGN_STATES = [
  { value: "DRAFT", label: "Draft", note: "Written down. Running nowhere." },
  {
    value: "SCHEDULED",
    label: "Scheduled",
    note: "Waits for the day it starts.",
  },
  { value: "ACTIVE", label: "Active", note: "Live the moment it lands." },
  { value: "PAUSED", label: "Paused", note: "Published, and held." },
  { value: "EXPIRED", label: "Expired", note: "Its window has passed." },
  {
    value: "CANCELLED",
    label: "Cancelled",
    note: "Called off. Not the same as expired.",
  },
] as const satisfies readonly Tile<string>[]

type CampaignState = (typeof CAMPAIGN_STATES)[number]["value"]

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
  /// written.
  ///
  /// It used to publish a one-line price book restating the campaign, because
  /// the node had no status route. It has one now, and the difference is not
  /// tidiness: a pause carried by a publication only stopped a promotion at the
  /// shops that received that publication, and the shop most likely to miss it
  /// is the shop most likely to still be running the offer. `PATCH` writes the
  /// status and dispatches it on the switch lane in the same call.
  const toggle = useMutation({
    mutationFn: (line: CampaignLine) =>
      setCampaignStatus({
        campaign: asInput(line.row),
        status: line.row.campaign.status === "ACTIVE" ? "PAUSED" : "ACTIVE",
        actorId: actor,
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
    // Restated verbatim means the poster too — see `rule-form.tsx`.
    image_url: row.campaign.image_url,
    headline: row.campaign.headline,
    terms: row.campaign.terms,
  }
}

/// The poster a shop puts in front of a shopper.
///
/// The only part of a published campaign that may be edited, alongside the
/// switch — and that is not an oversight in the freeze, it is the point. A
/// banner describes the offer; it does not decide money. Migration 0073 froze
/// everything that does, and left these writable so a typo in a headline can be
/// fixed without cutting a price book.
///
/// Saving dispatches to the fleet in the same call, on the switch lane, so the
/// corrected poster reaches the shop floor without waiting for a season.
function Poster({ line }: { line: CampaignLine }) {
  const client = useQueryClient()
  const campaign = line.row.campaign
  const [headline, setHeadline] = useState(campaign.headline ?? "")
  const [image, setImage] = useState(campaign.image_url ?? "")
  const [terms, setTerms] = useState(campaign.terms ?? "")

  const save = useMutation({
    mutationFn: () =>
      setCampaignStatus({
        campaign: asInput(line.row),
        // Its own status, unchanged. This endpoint takes the switch and the
        // poster together because they are the same two things a published
        // campaign is allowed to change; sending the current status is how a
        // poster edit says "leave the lever where it is".
        status: campaign.status,
        actorId: "console",
        headline,
        image_url: image,
        terms,
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: commercialKeys.all }),
  })

  const changed =
    headline !== (campaign.headline ?? "") ||
    image !== (campaign.image_url ?? "") ||
    terms !== (campaign.terms ?? "")

  return (
    <div>
      <SubHead>What the shop shows</SubHead>
      {image !== "" && (
        <img
          src={image}
          alt=""
          className="mb-2.5 aspect-[3/1] w-full rounded-inner border border-hairline bg-soft-2 object-cover"
        />
      )}
      <div className="flex flex-col gap-2.5">
        <Field
          label="Headline"
          hint="What a shopper reads. The campaign's own name is a filing code."
        >
          <Input
            value={headline}
            onChange={(event) => setHeadline(event.target.value)}
            placeholder={campaign.name}
          />
        </Field>
        <Field label="Banner image URL">
          <Input
            value={image}
            onChange={(event) => setImage(event.target.value)}
            placeholder="https://…"
          />
        </Field>
        {/* A block, not a line. `CommercialCampaignInput.terms` is one block
            of text on purpose — "terms differ per promotion, per season and per
            regulator, and a schema that modelled them would be wrong on
            arrival" — and a single-line box made that field look like a
            sentence when a shop prints a paragraph. */}
        <Field label="Terms">
          <Textarea
            value={terms}
            rows={3}
            onChange={(event) => setTerms(event.target.value)}
            placeholder="Selama persediaan masih ada. Tidak dapat digabung dengan promo lain."
          />
        </Field>
      </div>
      {save.isError && (
        <Banner tone="bad" className="mt-2.5">
          {(save.error as Error).message}
        </Banner>
      )}
      <div className="mt-2.5 flex items-center gap-2">
        <Button
          variant="dark"
          disabled={!changed || save.isPending}
          onClick={() => save.mutate()}
        >
          {save.isPending ? "Sending…" : "Save and send to shops"}
        </Button>
        {save.isSuccess && !changed && (
          <span className="text-[0.71875rem] text-mute">Sent.</span>
        )}
      </div>
    </div>
  )
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

          <Poster line={line} />

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
///
/// It asks four questions and used to ask them as five identical pills, two of
/// which were `datetime-local` boxes whose panel belongs to the operating
/// system. It now asks them the way the promotion form does — the six states as
/// tiles that each say what they mean, the two days off a calendar, the two
/// figures with their unit inside the field. See `controls.tsx`.
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
  const [status, setStatus] = useState<CampaignState>("ACTIVE")
  const [from, setFrom] = useState(() => today())
  const [to, setTo] = useState("")
  const [budget, setBudget] = useState("")
  const [maxUses, setMaxUses] = useState("")
  // The three a SHOPPER reads. They ride on the campaign and nowhere else —
  // `PublicationCampaign` says so in as many words: a price rule describes a
  // number, a markdown describes a garment, a campaign describes an event, and
  // a shop cannot put "Lebaran Sale, ends Sunday" on a screen out of an id and
  // a percentage. Until now nothing wrote them at creation, so every campaign
  // reached thirty shops with a blank banner and had to be opened again to fix
  // it.
  const [headline, setHeadline] = useState("")
  const [image, setImage] = useState("")
  const [terms, setTerms] = useState("")

  // A whole day each end, so "until 30 September" includes the thirtieth. A
  // `datetime-local` left at 00:00 quietly meant it did not.
  const validFrom = from === "" ? null : startOfDay(from)
  const validTo = to === "" ? null : endOfDay(to)
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
            // Empty is `null`, never "". A shop draws the campaign's internal
            // name when there is no headline, and an empty string is a headline
            // that happens to be blank.
            image_url: image.trim() === "" ? null : image.trim(),
            headline: headline.trim() === "" ? null : headline.trim(),
            terms: terms.trim() === "" ? null : terms.trim(),
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
      setTo("")
      setHeadline("")
      setImage("")
      setTerms("")
    },
  })

  const problem =
    actor === ""
      ? "Nobody is signed in, so no command can name who did this."
      : name.trim() === ""
        ? "A campaign needs a name — it is what every offer inside it is filed under."
        : windowBroken
          ? "The end has to come after the start."
          : budget.trim() !== "" && budgetMinor === null
            ? "A budget is whole rupiah. No decimals, and nothing but digits."
            : undefined

  const halted =
    publish.error instanceof BookWrittenNotPublished ? publish.error : null

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title="New campaign"
      id={`v${nextVersion}`}
      width="wide"
      // Two thirds of the glass, and the same panel the promotion form gets:
      // the two are written together and joined to each other, and a campaign
      // opening half the width of the offer it holds reads as a lesser thing.
      className="md:w-[clamp(32rem,66vw,58rem)]"
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className="min-w-0 text-[0.71875rem] leading-relaxed">
            {problem !== undefined ? (
              <span className="text-bad">{problem}</span>
            ) : (
              <span className="text-mute">
                <span className="text-text">
                  {readsCampaign(
                    status,
                    from === "" ? null : from,
                    to === "" ? null : to,
                    budgetMinor
                  )}
                </span>{" "}
                — published and sent to every shop the moment you press this.
              </span>
            )}
          </span>
          <Button
            variant="dark"
            disabled={problem !== undefined || publish.isPending}
            onClick={() => publish.mutate()}
          >
            {publish.isPending ? "Publishing…" : "Publish"}
          </Button>
        </div>
      }
    >
      {halted !== null ? (
        <Banner tone="bad" className="mb-4">
          {halted.message}
        </Banner>
      ) : publish.isError ? (
        <div className="mb-4">
          <ErrorState error={publish.error} />
        </div>
      ) : null}

      {/* Measured on the sheet, not on the window — this panel is 66vw at a
          desk and the whole glass on a phone. */}
      <div className="@container">
        <div className="grid gap-6 @3xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] @3xl:gap-x-8">
          <div className="flex flex-col gap-6">
            <Section title="The envelope">
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
            </Section>

            <Section title="What a shopper reads" aside="the only part they do">
              <Field
                label="Headline"
                hint="A campaign is the ONE thing in a price book meant for a shopper — the name above is a filing code, and this is what goes on the screen."
              >
                <Input
                  value={headline}
                  placeholder={
                    name.trim() === ""
                      ? "Diskon Lebaran — sampai 30 September"
                      : name.trim()
                  }
                  onChange={(event) => setHeadline(event.target.value)}
                />
              </Field>
              <Field
                label="Terms"
                hint="The small print, printed as written. One block of text on purpose: terms differ per promotion, per season and per regulator."
              >
                <Textarea
                  value={terms}
                  rows={3}
                  placeholder={
                    "Selama persediaan masih ada.\nTidak dapat digabung dengan promo lain."
                  }
                  onChange={(event) => setTerms(event.target.value)}
                />
              </Field>
              <Field
                label="Banner image"
                hint="A catalogue-media key or a URL — the same shape an article's picture carries, so one proxy serves both."
              >
                <Input
                  value={image}
                  placeholder="https://…"
                  onChange={(event) => setImage(event.target.value)}
                />
              </Field>
            </Section>

            <Section title="What state it starts in" aside="six, not four">
              <Choices
                options={CAMPAIGN_STATES}
                value={status}
                onChange={setStatus}
                columns={3}
                label="The state this campaign is published in"
              />
              <p className="text-[0.71875rem] leading-relaxed text-mute">
                Six states and not four: cancelled and expired are different
                endings, and only one of them was a decision. A rule is live
                only when both it and its campaign are, so publishing this
                paused holds every offer inside it without touching any of them.
              </p>
            </Section>
          </div>

          <div className="flex flex-col gap-6">
            <Section title="When it runs" aside="days, not minutes">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Runs from">
                  <Day
                    value={from}
                    onChange={setFrom}
                    placeholder="Straight away"
                    label="The day this campaign starts"
                    presets={[
                      { label: "Today", value: today() },
                      { label: "Tomorrow", value: shift(today(), 1) },
                      { label: "In a week", value: shift(today(), 7) },
                    ]}
                  />
                </Field>
                <Field
                  label="Until"
                  problem={
                    windowBroken
                      ? "The end has to come after the start."
                      : undefined
                  }
                >
                  <Day
                    value={to}
                    onChange={setTo}
                    placeholder="Open ended"
                    label="The last day this campaign runs"
                    notBefore={from}
                    presets={[
                      { label: "In a week", value: shift(from ?? today(), 7) },
                      {
                        label: "In a month",
                        value: shift(from === "" ? today() : from, 30),
                      },
                    ]}
                  />
                </Field>
              </div>
            </Section>

            <Section title="How far it may go" aside="shared by every offer">
              <Field
                label="Budget for the whole window"
                hint="Not a daily figure — this is the total every offer inside the campaign shares between the two days. Leave it empty for unlimited."
              >
                <Money
                  value={budget}
                  onChange={setBudget}
                  prefix="Rp"
                  placeholder="Unlimited"
                  label="Budget for the whole window"
                />
              </Field>
              {/* Narrower than the column it sits in: a stepper stretched to
                  full width puts its two buttons a hand apart, which is the
                  one thing a stepper is supposed to save you. */}
              <Field
                label="Most baskets"
                hint="Shared across every offer inside it."
                className="max-w-[13rem]"
              >
                <Stepper
                  value={maxUses}
                  onChange={setMaxUses}
                  min={1}
                  placeholder="Unlimited"
                  label="Most baskets"
                />
              </Field>
              <p className="text-[0.71875rem] leading-relaxed text-mute">
                Offers join a campaign from the promotion form, by naming it. A
                per-customer limit is not offered here: the server refuses one,
                because nothing counts a customer&rsquo;s own history and the
                limit would never bite.
              </p>
            </Section>

            {/* Deliberately NOT the promotion's terms, and not for the reason
                it first looks.

                A campaign carries no scope and no effect, so it has no "20%
                off" of its own to state. But it is emphatically NOT invisible
                to a shopper — the opposite: `PublicationCampaign` says a
                campaign is the ONE thing in a price book a shopper is meant to
                read, which is why the banner, the headline and the small print
                ride on it and on nothing else. A price rule describes a number;
                a campaign describes an event.

                So this reads back both halves: the poster as the shop will
                print it, and under it what the envelope does to whatever is
                filed inside — the half people get wrong, because a campaign
                looks like a bigger promotion and is not one. */}
            <Section title="How it will read" aside="poster, then effect">
              <Terms
                headline={
                  headline.trim() !== ""
                    ? headline.trim()
                    : validFrom === null
                      ? "Open ended"
                      : validTo === null
                        ? `From ${day(validFrom)}`
                        : `${day(validFrom)} – ${day(validTo)}`
                }
                name={name}
                prose={terms}
                empty="Name it, and what it does to the offers filed under it will be written here."
                clauses={[
                  headline.trim() !== "" &&
                    validFrom !== null &&
                    `It shows from ${day(validFrom)}${validTo === null ? " onwards" : ` to ${day(validTo)}`}.`,
                  name.trim() !== "" &&
                    `An offer filed under it is live only while this is ${label(status)} — and only while the offer itself is live too.`,
                  validFrom !== null &&
                    validTo !== null &&
                    "An offer inside it cannot run outside those two days, whatever its own dates say.",
                  budgetMinor !== null &&
                    `${money(budgetMinor)} is shared by every offer inside it — not given to each of them.`,
                  maxUses.trim() !== "" &&
                    `${count(Number(maxUses))} baskets across every offer inside it, together.`,
                  "Nothing is in it yet. An offer joins from the promotion form, by naming this campaign.",
                ]}
                foot={
                  headline.trim() === "" && terms.trim() === ""
                    ? "No headline and no small print: every shop will draw this campaign under its filing name, with nothing under it."
                    : undefined
                }
              />
            </Section>
          </div>
        </div>
      </div>
    </Sheet>
  )
}

/// The envelope in one line, for the foot of the sheet.
///
/// Read off the same four answers the campaign will carry, so it cannot
/// describe something the button will not publish.
function readsCampaign(
  status: CampaignState,
  from: string | null,
  to: string | null,
  budgetMinor: number | null
): string {
  const window =
    from === null
      ? to === null
        ? "open ended"
        : `until ${day(endOfDay(to))}`
      : `${day(startOfDay(from))} → ${to === null ? "open" : day(endOfDay(to))}`
  return `${label(status)} · ${window} · ${
    budgetMinor === null ? "unlimited" : money(budgetMinor)
  }`
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
