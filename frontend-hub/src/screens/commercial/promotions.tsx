import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useMemo, useState } from "react"
import type { RuleStatus } from "@itulah/contract"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Input } from "@/components/ui/field"
import { Meter } from "@/components/ui/meter"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { MiniCell, MiniRow, MiniTable, SubHead } from "@/components/ui/rows"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState, ErrorState } from "@/components/ui/states"
import { Tag } from "@/components/ui/tag"
import { count, day, label, money, toneFor } from "@/lib/format"
import {
  commercialKeys,
  commercialUsage,
  promotionCatalogue,
  publishUsageToFleet,
  setRuleStatus,
  type CampaignRow,
  type PromotionRow,
  type PromotionUsage,
  type PublishReceipt,
  type UsageReceipt,
} from "@/lib/queries/commercial"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"
import { PerformanceHeader } from "@/screens/commercial/performance-header"
import { tableSetup, type TableSetup } from "@/lib/table"
import { Switch } from "@/components/ui/form"
import { RuleForm } from "@/screens/commercial/rule-form"
import { Terms } from "@/screens/commercial/controls"
import {
  consumed,
  describeCustomers,
  describeEffect,
  describeScope,
  percent,
  termsOf,
  useActor,
} from "@/screens/commercial/shared"

/// Promotions — which offers exist, what each has cost, whether it is live, and
/// where it has reached.
///
/// It replaces a screen that listed only *usage*, which meant a promotion that
/// had never fired was simply absent: the list could not tell "we are not
/// running one" from "we are running one and nobody has taken it". The rules
/// come from the books now and the spend is joined onto them, so a promotion
/// with no uses is a row reading zero rather than a row that is not there.
///
/// Three facts about the data are load-bearing.
///
///  1. **There is no rules endpoint.** The list is built by opening every
///     published book (`promotionCatalogue`), which is N+1 and is said out loud
///     under the table. A `GET /commercial/rules` would collapse it.
///  2. **A rule restated in a later book is one promotion amended, not two.**
///     That is the shop's own model — `load_rules` reads `DISTINCT ON (rule_id)
///     … ORDER BY version DESC` — and it is why the switch below can work at
///     all.
///  3. **A budget is a brake, not a gate.** Every shop enforces from the last
///     count it received, so the figure that must not be exceeded is the one on
///     this screen, and "Send counts to shops" is what keeps the brake close to
///     the truth.

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

/// `null` budget is unlimited. Sorted below everything with a limit, because
/// "no line to cross" is never the row somebody has to act on.
const UNLIMITED = -1

/// One promotion, with what it has actually cost joined on.
interface PromotionLine {
  readonly row: PromotionRow
  readonly usage: PromotionUsage | null
  /// How many shops are charging the book this rule arrived in. Empty is the
  /// interesting case: published, and reaching no till.
  readonly reached: number
}

/// The spend meter, drawn the one way this app draws a proportion.
function Spend({ usage }: { usage: PromotionUsage | null }) {
  if (usage === null) return <span className="text-mute">Never used</span>
  const share = consumed(usage.spent_minor, usage.budget_minor)
  if (share === null) {
    // `null` is unlimited, which is not zero and must never be drawn as a full
    // bar — nor as an empty one, which reads as "plenty left" when the honest
    // answer is "there is no line to cross".
    return (
      <span className="text-text tabular-nums">
        {money(usage.spent_minor)} <span className="text-mute">· no limit</span>
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
}

function Reached({ shops }: { shops: number }) {
  return shops === 0 ? (
    <Pill tone="warn">No shop</Pill>
  ) : (
    <span className="text-text">
      {count(shops)} shop{shops === 1 ? "" : "s"}
    </span>
  )
}

// Columns are declared outside the component, so they never close over props.
// The switch is the exception the shape allows for: it needs a callback, so it
// is reached through `meta` on the table rather than through a closure here.
const promotionColumns: ColumnDef<TableSetup, PromotionLine>[] = [
  {
    id: "live",
    header: "Live",
    size: 60,
    enableSorting: false,
    cell: ({ row, table }) => {
      const meta = actionsOf<PromotionLine>(table)
      const status = row.original.row.status
      return (
        <Switch
          on={status === "ACTIVE"}
          busy={meta?.busy === row.original.row.rule_id}
          label={`${status === "ACTIVE" ? "Pause" : "Resume"} ${row.original.row.name}`}
          onToggle={() => meta?.onToggle?.(row.original)}
        />
      )
    },
  },
  {
    id: "promotion",
    accessorFn: (row) => row.row.name,
    header: "Promotion",
    size: 220,
    meta: { filter: { kind: "text" } },
    cell: ({ row }) => (
      <span className="font-medium text-ink">{row.original.row.name}</span>
    ),
  },
  {
    id: "status",
    accessorFn: (row) => row.row.status,
    header: "Status",
    size: 110,
    meta: { filter: { kind: "option", format: label } },
    cell: ({ row }) => (
      <Pill tone={toneFor(row.original.row.status)}>
        {label(row.original.row.status)}
      </Pill>
    ),
  },
  {
    id: "scope",
    accessorFn: (row) => describeScope(row.row.definition),
    header: "Applies to",
    size: 160,
    cell: ({ row }) => (
      <span className="text-text">
        {describeScope(row.original.row.definition)}
        {describeCustomers(row.original.row.definition) === "Members" && (
          <Tag className="ml-1.5">members</Tag>
        )}
      </span>
    ),
  },
  {
    id: "effect",
    accessorFn: (row) => describeEffect(row.row.definition.effect),
    header: "What it does",
    size: 160,
    cell: ({ row }) => (
      <span className="text-text">
        {describeEffect(row.original.row.definition.effect)}
      </span>
    ),
  },
  {
    id: "coupon",
    accessorFn: (row) => row.row.definition.coupon_code ?? "",
    header: "Coupon",
    size: 130,
    meta: { filter: { kind: "text" } },
    // Open to everyone, or shut until a code is presented. Not a decoration:
    // a coupon-gated rule that has never fired is behaving correctly, and one
    // without a gate that has never fired is a fault.
    cell: ({ row }) => {
      const code = row.original.row.definition.coupon_code
      return code === null || code === "" ? (
        <span className="text-mute">Open to all</span>
      ) : (
        <span className="font-mono text-id text-ink">{code}</span>
      )
    },
  },
  {
    id: "budget",
    accessorFn: (row) => row.usage?.budget_minor ?? UNLIMITED,
    header: "Budget",
    size: 130,
    meta: { align: "right" },
    cell: ({ row }) => {
      const budget =
        row.original.usage?.budget_minor ??
        row.original.row.definition.caps.budget?.minor ??
        null
      return budget === null ? (
        <span className="text-mute">Unlimited</span>
      ) : (
        money(budget)
      )
    },
  },
  {
    id: "spent",
    accessorFn: (row) =>
      consumed(row.usage?.spent_minor ?? 0, row.usage?.budget_minor ?? null) ??
      UNLIMITED,
    header: "Spent",
    size: 150,
    // The decision metric, and why this list sorts by it: a promotion at
    // ninety-something per cent of its budget is the one somebody has to stop,
    // pause or top up before the weekend.
    cell: ({ row }) => <Spend usage={row.original.usage} />,
  },
  {
    id: "uses",
    accessorFn: (row) => row.usage?.uses ?? 0,
    header: "Used",
    size: 80,
    meta: { align: "right" },
    cell: ({ row }) => count(row.original.usage?.uses ?? 0),
  },
  {
    id: "reached",
    accessorFn: (row) => row.reached,
    header: "In shops",
    size: 110,
    // Published and in force are different things. A promotion nobody is
    // carrying costs nothing and sells nothing, and on a usage-only list it
    // looked identical to one that simply had not fired yet.
    cell: ({ row }) => <Reached shops={row.original.reached} />,
  },
]

export function Promotions() {
  const client = useQueryClient()
  const actor = useActor()
  const sheet = useSheet("rule")
  const [query, setQuery] = useState("")
  const [writing, setWriting] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [sent, setSent] = useState<UsageReceipt | null>(null)
  const [receipt, setReceipt] = useState<PublishReceipt | null>(null)
  const [sorting, setSorting] = useState<SortingState>([
    { id: "spent", desc: true },
  ])

  const catalogue = useQuery({
    queryKey: commercialKeys.catalogue(),
    queryFn: ({ signal }) => promotionCatalogue(signal),
  })

  const usage = useQuery({
    queryKey: commercialKeys.usage(),
    queryFn: ({ signal }) => commercialUsage(signal),
  })

  /// The two halves joined here and nowhere else. The count is an observation
  /// and changes with every sale; the limit is a decision, frozen with the book
  /// that declared it. A rule that has never fired is absent from usage — which
  /// is why the join is left-handed, from the rules.
  const byKey = useMemo(() => {
    const map = new Map<string, PromotionUsage>()
    for (const one of usage.data ?? []) map.set(`${one.kind}:${one.key}`, one)
    return map
  }, [usage.data])

  const promotions: PromotionLine[] = useMemo(
    () =>
      (catalogue.data?.rules ?? []).map((row) => ({
        row,
        usage: byKey.get(`RULE:${row.rule_id}`) ?? null,
        reached: row.book.activated_by.length,
      })),
    [catalogue.data, byKey]
  )

  /// Pause and resume, through the one function that knows how a status is
  /// written. There is no status route on the node, so this publishes a
  /// one-line book restating the rule — see `setRuleStatus`, which is the only
  /// place that has to change when `PATCH …/status` lands.
  const toggle = useMutation({
    mutationFn: (line: PromotionLine) =>
      setRuleStatus({
        rule: line.row.definition,
        status: (line.row.status === "ACTIVE"
          ? "PAUSED"
          : "ACTIVE") as RuleStatus,
        campaign: campaignFor(line, catalogue.data?.campaigns ?? []),
        version: catalogue.data?.next_version ?? 1,
        actorId: actor,
        // A fresh key per flip: two pauses of the same rule an hour apart are
        // two decisions, not one retried.
        idempotencyKey: crypto.randomUUID(),
      }),
    onSettled: () => {
      setBusy(null)
      client.invalidateQueries({ queryKey: commercialKeys.all })
    },
  })

  const idempotencyKey = useMemo(() => crypto.randomUUID(), [])

  const send = useMutation({
    mutationFn: () => publishUsageToFleet(actor, idempotencyKey),
    onSuccess: (result) => {
      setSent(result)
      // Sending does not change what has been given away — these counts come
      // from sales, not from dispatches. The read is refreshed only so the
      // receipt describes the figures now on screen rather than a list somebody
      // has been looking at for an hour.
      client.invalidateQueries({ queryKey: commercialKeys.usage() })
    },
  })

  // `mutate` is stable for the life of the mutation; `toggle` itself is a new
  // object on every status change of the mutation, and depending on it would
  // rebuild the whole table each time somebody flipped a switch.
  const flip = toggle.mutate

  const promotionTable = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: promotions,
        columns: promotionColumns,
        getRowId: (row: PromotionLine) => row.row.rule_id,
        state: { globalFilter: query, sorting },
        onSortingChange: setSorting,
        onGlobalFilterChange: setQuery,
        meta: {
          busy,
          onToggle: (line: PromotionLine) => {
            setBusy(line.row.rule_id)
            flip(line)
          },
        },
      }),
      [promotions, query, sorting, busy, flip]
    )
  )

  const overspent = promotions.filter(
    (line) =>
      line.usage !== null &&
      line.usage.budget_minor !== null &&
      line.usage.spent_minor >= line.usage.budget_minor
  )

  return (
    <PageContent>
      <PageHeader
        crumb="Commercial"
        title="Promotions"
        sub="Which offers exist, what each has cost against what it was allowed to, and how far it has actually reached."
        actions={
          <>
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search"
              className="h-8 w-44"
            />
            <Button
              variant="soft"
              disabled={send.isPending || actor === ""}
              onClick={() => send.mutate()}
            >
              {send.isPending ? "Sending…" : "Send counts to shops"}
            </Button>
            <Button variant="dark" onClick={() => setWriting(true)}>
              New promotion
            </Button>
          </>
        }
      />

      {/* What the offers below actually did, over a window. The list says which
          exist and what they may spend; this says what they spent. */}
      <PerformanceHeader of="rules" />

      {toggle.isError && (
        <div className="mb-4">
          <ErrorState error={toggle.error} />
        </div>
      )}

      {send.isError && (
        <div className="mb-4">
          <ErrorState error={send.error} />
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
              origin is registered, so this offer will never apply anywhere.
            </>
          )}
        </Banner>
      )}

      {sent && (
        <Banner tone="ok" className="mb-4" onDismiss={() => setSent(null)}>
          Counts as at {day(sent.counted_at)} sent to{" "}
          {count(sent.sent_to.length)} shop
          {sent.sent_to.length === 1 ? "" : "s"}. Until each one takes the
          message, it is still enforcing from the count before this.
        </Banner>
      )}

      {overspent.length > 0 && (
        <Banner tone="bad" className="mb-4">
          {count(overspent.length)} promotion
          {overspent.length === 1 ? " has" : "s have"} reached or passed the
          budget declared for {overspent.length === 1 ? "it" : "them"}. Shops
          stop applying an offer only once they have been told, so send the
          counts before doing anything else.
        </Banner>
      )}

      <Card className="overflow-hidden">
        {queryState(catalogue, {
          loading: "Opening every published book…",
          render: (data) =>
            promotions.length === 0 ? (
              <EmptyState>
                No promotion is published. {count(data.book_count)} book
                {data.book_count === 1 ? "" : "s"} were opened to check — a
                promotion sitting in an unpublished draft is authored, not
                running, and is deliberately not listed here.
              </EmptyState>
            ) : (
              <DataTable<PromotionLine>
                table={promotionTable}
                onRowClick={(row) => sheet.open(row.row.rule_id)}
                isSelected={(row) => row.row.rule_id === sheet.value}
                empty="No promotion matches that search."
                className="max-h-[calc(100vh-19rem)]"
              />
            ),
        })}
      </Card>

      {catalogue.data && (
        // Where the list comes from, and the one rule worth knowing about it.
        <p className="mt-2.5 text-[0.71875rem] text-mute">
          Drawn from {count(catalogue.data.book_count)} published book
          {catalogue.data.book_count === 1 ? "" : "s"}. Where one rule appears
          in several books the newest wins, which is what a shop does too.
        </p>
      )}

      <PromotionSheet
        line={promotions.find((one) => one.row.rule_id === sheet.value) ?? null}
        onClose={sheet.close}
      />

      <RuleForm
        open={writing}
        campaigns={catalogue.data?.campaigns ?? []}
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

/// The campaign a rule belongs to, restated so it can travel with it.
///
/// The server refuses a book whose rule names a campaign that book does not
/// define — a shop drops such a rule, so the offer would apply nowhere. Pausing
/// a rule therefore has to carry its campaign along unchanged.
function campaignFor(
  line: PromotionLine,
  campaigns: readonly CampaignRow[]
): {
  campaign_id: string
  name: string
  status: string
  valid_from: string | null
  valid_to: string | null
  budget_minor: number | null
  max_uses: number | null
} | null {
  const id = line.row.definition.campaign_id
  if (id === null) return null
  const found = campaigns.find((one) => one.campaign.campaign_id === id)
  if (found === undefined) return null
  return {
    campaign_id: found.campaign.campaign_id,
    name: found.campaign.name,
    status: found.campaign.status,
    valid_from: found.campaign.valid_from,
    valid_to: found.campaign.valid_to,
    budget_minor: found.campaign.budget_minor,
    max_uses: found.campaign.max_uses,
  }
}

/// One promotion, whole.
///
/// Campaign had a detail sheet and this did not, which made the list read as
/// the end of the road: a rule's scope was a phrase in a column and its
/// conditions were nowhere at all. They are the two things somebody asks about
/// when a promotion has not fired — what it matches, and what has to be true
/// before it will.
///
/// The engine's own document is the source for all of it. Nothing here derives
/// a second opinion about what a rule does; it reads `definition`, which is the
/// same JSON the till applies.
function PromotionSheet({
  line,
  onClose,
}: {
  line: PromotionLine | null
  onClose: () => void
}) {
  const spent = line?.usage?.spent_minor ?? 0
  const share = consumed(spent, line?.usage?.budget_minor ?? null)
  const rule = line?.row.definition
  // Codes rather than words: a published rule carries what it matches on, and
  // the master list that turns `MENSWEAR` into "Menswear" is not fetched for a
  // panel — so the code is shown, which is also what a shop's own log says.
  const reading = rule === undefined ? null : termsOf(rule)

  return (
    <Sheet
      open={line !== null}
      onOpenChange={(next) => !next && onClose()}
      id={line?.row.rule_id}
      title={line?.row.name ?? "Promotion"}
    >
      {line === null || rule === undefined || reading === null ? null : (
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone={toneFor(line.row.status)}>
              {label(line.row.status)}
            </Pill>
            {rule.coupon_code ? (
              <Tag tone="warn">Needs code {rule.coupon_code}</Tag>
            ) : (
              <Tag>Open to all</Tag>
            )}
            <span className="text-[0.71875rem] text-mute">
              from {line.row.book.name}
            </span>
          </div>

          <Facts>
            <Fact term="Does">{describeEffect(rule.effect)}</Fact>
            <Fact term="Applies to">{describeScope(rule)}</Fact>
            <Fact term="Campaign">{rule.campaign_id ?? "On its own"}</Fact>
            <Fact term="Shoppers">
              {rule.scope.customers.who === "MEMBERS" ? "Members" : "Everyone"}
            </Fact>
            {/* The counter's figure first, the rule's own where nothing has
                been counted yet. A promotion that has never fired has no usage
                row at all, and reading only that made a rule capped at five
                million report "Unlimited" — beside terms, on this same panel,
                that say it stops at five million. The list column already had
                the fallback; this did not. */}
            <Fact term="Budget">
              {(line.usage?.budget_minor ?? rule.caps.budget?.minor ?? null) ===
              null
                ? "Unlimited"
                : money(line.usage?.budget_minor ?? rule.caps.budget!.minor)}
            </Fact>
            <Fact term="Spent">{money(spent)}</Fact>
            <Fact term="Used">{count(line.usage?.uses ?? 0)}</Fact>
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
            </div>
          )}

          {/* What has to be true before it fires, in the same words the
              composer showed while it was being written — one `termsOf`, read
              here and previewed there, so "what did I publish" and "what does
              this do" cannot answer differently.

              It replaces a four-row table of the same conditions. The table
              was honest and unreadable: a promotion that never fired is
              explained by the COMBINATION — a minimum, a window and a coupon,
              each unremarkable on its own — and four rows of figures is the
              one shape that hides a combination. */}
          <div>
            <SubHead aside="as it reads">Its terms</SubHead>
            <Terms
              headline={describeEffect(rule.effect)}
              name={line.row.name}
              clauses={reading.clauses}
              hidden={reading.hidden}
              empty="This rule names nothing it applies to."
            />
          </div>

          <div>
            <SubHead aside={count(line.reached)}>In service at</SubHead>
            {line.row.book.activated_by.length === 0 ? (
              // Published and reaching nobody looks exactly like success
              // everywhere else on this screen, so it is said in words.
              <p className="py-3 text-meta text-mute">
                No shop has put the book carrying this promotion into service,
                so it is applying nowhere yet.
              </p>
            ) : (
              <MiniTable head={["Shop", { label: "Since", align: "left" }]}>
                {line.row.book.activated_by.map((shop) => (
                  <MiniRow key={shop.origin_id}>
                    <MiniCell>{shop.site_id ?? shop.origin_id}</MiniCell>
                    <MiniCell>{day(shop.activated_at)}</MiniCell>
                  </MiniRow>
                ))}
              </MiniTable>
            )}
          </div>
        </div>
      )}
    </Sheet>
  )
}
