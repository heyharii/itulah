import { useMemo } from "react"
import { Megaphone, Store } from "lucide-react"
import type { ColumnDef } from "@tanstack/react-table"

import { PageHead, Toolbar } from "@/kit/page"
import { ScopeLine } from "@/kit/scope"
import { Sheet } from "@/kit/sheet"
import { Table } from "@/kit/table"
import { Tabs } from "@/kit/tabs"
import { Tag } from "@/kit/tag"
import { Tile, Tiles } from "@/kit/tiles"
import { Empty, Failed, Loading, NoMatch } from "@/kit/state"
import { amount, count, day, rp, today } from "@/lib/format"
import { useReport } from "@/lib/list"
import { useQueryState } from "@/lib/query-state"
import type { TableSetup } from "@/lib/table"
import {
  Fact,
  Facts,
  Line,
  Meter,
  Quiet,
  SubHead,
} from "@/modules/commercial/parts"
import {
  campaignStatus,
  consumed,
  describeEffect,
  describeScope,
  percent,
  ruleStatus,
} from "@/modules/commercial/labels"
import type {
  CampaignRow,
  Catalogue,
  RuleRow,
  UsageList,
  UsageRow,
} from "@/modules/commercial/wire"

/// Campaign — the envelope a set of offers is run as one thing inside.
///
/// A campaign is not a bigger promotion. It is **one window, one budget and one
/// switch over several rules**, and the engine reads it that way: a rule is
/// live only when both it and its campaign are. That is the whole reason it is
/// a screen rather than a column on Promotions — "stop the Lebaran promo" is
/// one act here and six acts there, and six acts is how one gets left running.
///
/// ## Why `useReport`, and why three reads for one list
///
/// `GET /commercial/campaigns` takes no parameters, applies no cap and answers
/// one object — `{ items, book_count }` — so there is nothing to page and no
/// bare array to cap. The same is true of `/rules` and `/usage`, and both are
/// needed here for facts the campaign row does not carry:
///
///   **How many offers are inside it.** Membership exists in one direction
///   only: a rule joins a campaign by naming it in `definition.campaign_id`,
///   and the campaign holds no list. So the count is read off the rules.
///   **What it has spent.** The limit is a decision frozen with the book that
///   declared it; the count is an observation that moves with every sale. They
///   live in different places for that reason and are joined here.
///
/// The narrowing rules are Promotions' and they are stated there in full: the
/// tab strip narrows a COMPLETE array and its counts are therefore exact, and
/// there is no search box and no sortable header because the endpoint can
/// answer neither and a control that implied otherwise would be a lie about the
/// server rather than about the data.
///
/// ## One field the wire does not carry
///
/// `max_uses_per_customer` is on the campaign table and on the performance
/// read, and `GET /commercial/campaigns` does not return it. So "three per
/// shopper" cannot be shown here, and it is drawn as unknown rather than as
/// unlimited — which is what a missing field silently becomes if nobody looks.
///
/// ## What did not come across
///
/// The switch, the composer and the publish flow. `PATCH /commercial/campaigns/
/// {id}` writes a status and dispatches it to the shops in the same call, which
/// is the right shape and a write; this module is a port of the reads.

const STATUSES = [
  "ACTIVE",
  "SCHEDULED",
  "PAUSED",
  "DRAFT",
  "EXPIRED",
  "CANCELLED",
] as const

interface Line_ {
  readonly row: CampaignRow
  readonly usage: UsageRow | null
  /// The promotions that named this campaign.
  readonly offers: readonly RuleRow[]
  readonly reached: number
}

export function CampaignsScreen() {
  const url = useQueryState()
  const status = url.one("status")
  const openId = url.one("campaign")

  const campaigns = useReport<Catalogue<CampaignRow>>({
    key: ["commercial", "campaigns"],
    path: "/api/v1/commercial/campaigns",
  })
  const rules = useReport<Catalogue<RuleRow>>({
    key: ["commercial", "rules"],
    path: "/api/v1/commercial/rules",
  })
  const usage = useReport<UsageList>({
    key: ["commercial", "usage"],
    path: "/api/v1/commercial/usage",
  })

  const spend = useMemo(() => {
    const byKey = new Map<string, UsageRow>()
    for (const one of usage.data?.items ?? []) {
      if (one.kind === "CAMPAIGN") byKey.set(one.key, one)
    }
    return byKey
  }, [usage.data])

  const byCampaign = useMemo(() => {
    const grouped = new Map<string, RuleRow[]>()
    for (const rule of rules.data?.items ?? []) {
      const id = rule.definition.campaign_id
      if (id == null) continue
      const held = grouped.get(id)
      if (held === undefined) grouped.set(id, [rule])
      else held.push(rule)
    }
    return grouped
  }, [rules.data])

  const all: readonly Line_[] = useMemo(() => {
    const lines = (campaigns.data?.items ?? []).map((row) => ({
      row,
      usage: spend.get(row.campaign_id) ?? null,
      offers: byCampaign.get(row.campaign_id) ?? [],
      reached: row.activated_by.length,
    }))
    // Most given away first — the campaign nearest its budget is the one
    // somebody has to stop or top up before the weekend. The server's own order
    // is `campaign_id`, an artefact of the de-duplication rather than a meaning.
    return [...lines].sort(
      (a, b) => (b.usage?.spent_minor ?? 0) - (a.usage?.spent_minor ?? 0),
    )
  }, [campaigns.data, spend, byCampaign])

  const rows = useMemo(
    () =>
      status === "" ? all : all.filter((line) => line.row.status === status),
    [all, status],
  )

  const overspent = all.filter(
    (line) =>
      line.usage !== null &&
      line.row.budget_minor !== null &&
      line.usage.spent_minor >= line.row.budget_minor,
  ).length
  const empty = all.filter((line) => line.offers.length === 0).length

  const columns: ColumnDef<TableSetup, Line_>[] = [
    {
      id: "campaign",
      header: "Campaign",
      size: 24,
      meta: { icon: <Megaphone className="size-[15px]" />, min: 215 },
      cell: ({ row }) => (
        <>
          <span className="text-ink block truncate font-medium">
            {row.original.row.name}
          </span>
          <span className="text-label text-ink-4 block truncate font-mono">
            {row.original.row.campaign_id}
          </span>
        </>
      ),
    },
    {
      id: "status",
      header: "Status",
      size: 12,
      meta: { min: 125 },
      cell: ({ row }) => {
        const known = campaignStatus(row.original.row.status)
        return <Tag tone={known.tone}>{known.label}</Tag>
      },
    },
    {
      id: "window",
      header: "Runs",
      size: 16,
      // Two lines rather than one, the way `bills.tsx` draws "Dated · due".
      // Both dates on one line is 200px of text in a column the width budget
      // gives 175, and a window that ends in "12 …" is a window nobody can
      // read — which on this screen is the whole point of the column.
      //
      // Both ends drawn, and an open end said as "open" rather than left
      // blank: a campaign with no end date is a decision somebody made, and an
      // empty cell reads as a field nobody filled in.
      meta: { min: 150, priority: 4 },
      cell: ({ row }) => {
        const { valid_from, valid_to } = row.original.row
        return (
          <>
            <span className="text-ink-2 block">
              {valid_from === null ? "always on" : day(valid_from)}
            </span>
            <span className="text-label text-ink-4 block">
              {valid_to === null ? "no end date" : `until ${day(valid_to)}`}
            </span>
          </>
        )
      },
    },
    {
      id: "offers",
      header: "Offers",
      size: 9,
      meta: { align: "right", min: 95, priority: 3 },
      cell: ({ row }) =>
        row.original.offers.length === 0 ? (
          <Tag tone="warn">
            <span title="No promotion in any published book names this campaign, so switching it changes nothing at a till.">
              none
            </span>
          </Tag>
        ) : (
          <span className="text-ink-2 tabular-nums">
            {count(row.original.offers.length)}
          </span>
        ),
    },
    {
      id: "spend",
      header: "Given away",
      size: 17,
      // Never dropped. The decision metric.
      meta: { min: 165 },
      cell: ({ row }) => (
        <Spend
          usage={row.original.usage}
          // The budget comes off the CAMPAIGN row rather than off the usage
          // row. Whole-window, never daily: it is the total the campaign may
          // give away between its two dates, and drawing it as a daily figure
          // would understate it by however many days it runs.
          budget={row.original.row.budget_minor}
        />
      ),
    },
    {
      id: "uses",
      header: "Used",
      size: 10,
      meta: { align: "right", min: 100, priority: 2 },
      cell: ({ row }) => {
        const used = row.original.usage?.uses
        const most = row.original.row.max_uses
        if (used === undefined) return <Quiet />
        return (
          <span className="text-ink-2 tabular-nums">
            {count(used)}
            {most === null ? "" : ` / ${count(most)}`}
          </span>
        )
      },
    },
    {
      id: "shops",
      header: "In shops",
      size: 12,
      meta: {
        icon: <Store className="size-[15px]" />,
        align: "right",
        min: 110,
        priority: 1,
      },
      cell: ({ row }) =>
        row.original.reached === 0 ? (
          <Tag tone="warn">None</Tag>
        ) : (
          <span className="text-ink-2 tabular-nums">
            {count(row.original.reached)}
          </span>
        ),
    },
  ]

  // Keyed by the WIRE's string rather than by the six this build knows — see
  // the same note on Promotions. A seventh status added to the check constraint
  // is counted, lands under "All", and is drawn as itself.
  const counted = new Map<string, number>(STATUSES.map((value) => [value, 0]))
  for (const line of all) {
    counted.set(line.row.status, (counted.get(line.row.status) ?? 0) + 1)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHead
        module="Commercial"
        title="Campaign"
        description="One window, one budget and one switch over a set of offers the business runs as one thing."
      />

      <Tabs
        label="Status"
        value={status}
        onChange={(value) => url.set({ status: value || null }, false)}
        tabs={[
          { value: "", label: "All", count: all.length },
          ...STATUSES.map((value) => ({
            value,
            label: campaignStatus(value).label,
            count: counted.get(value),
          })),
        ]}
      />

      <ScopeLine
        scope={{ kind: "asAt", date: today() }}
        note="the newest published book per campaign · spend counted since each first fired"
      />

      <Tiles>
        <Tile
          label="Campaigns"
          value={campaigns.data === undefined ? "—" : count(all.length)}
          note={
            campaigns.data === undefined
              ? undefined
              : `from ${count(campaigns.data.book_count)} published books`
          }
        />
        <Tile
          label="Live"
          value={
            campaigns.data === undefined
              ? "—"
              : count(counted.get("ACTIVE") ?? 0)
          }
          note="a rule inside one is live only while this is"
        />
        <Tile
          label="At or over budget"
          value={campaigns.data === undefined ? "—" : count(overspent)}
          tone={overspent > 0 ? "bad" : undefined}
          note="a brake, not a gate — a till enforces its last count"
        />
        <Tile
          label="Holding no offer"
          value={campaigns.data === undefined ? "—" : count(empty)}
          tone={empty > 0 ? "warn" : undefined}
          note="nothing names them, so switching them changes nothing"
        />
      </Tiles>

      <Toolbar
        trailing={
          rules.isPending || usage.isPending
            ? "Joining offers and spend…"
            : `${count(rows.length)} shown of ${count(all.length)}`
        }
      >
        <span className="text-ctl text-ink-3">
          This endpoint takes no search, no sort and no paging — the list below
          is every campaign in every published book, ordered by what it has
          given away.
        </span>
      </Toolbar>

      {campaigns.isError ? (
        <Failed
          what="the campaigns"
          error={campaigns.error}
          onRetry={() => void campaigns.refetch()}
        />
      ) : campaigns.isPending ? (
        <Loading cols={7} />
      ) : all.length === 0 ? (
        <Empty
          what="campaigns"
          detail={
            campaigns.data !== undefined && campaigns.data.book_count === 0
              ? "No price book has been published at all, so no campaign can exist yet."
              : "The published books declare offers, and none of them is run inside a campaign."
          }
        />
      ) : rows.length === 0 ? (
        <NoMatch
          what="campaigns"
          held={all.length}
          onClear={() => url.set({ status: null }, false)}
        />
      ) : (
        <Table
          columns={columns}
          rows={rows as Line_[]}
          rowId={(row) => row.row.campaign_id}
          caption="Every campaign in every published book"
          onRowClick={(row) =>
            url.set({ campaign: row.row.campaign_id }, false)
          }
          isOpen={(row) => row.row.campaign_id === openId}
          foot={{
            campaign: (
              <>
                <b className="text-ink">{count(rows.length)}</b>{" "}
                {rows.length === 1 ? "campaign" : "campaigns"}
              </>
            ),
            spend: "each against its own whole-window budget",
          }}
        />
      )}

      <CampaignSheet
        openId={openId}
        line={all.find((one) => one.row.campaign_id === openId)}
        onClose={() => url.set({ campaign: null }, false)}
      />
    </div>
  )
}

function Spend({
  usage,
  budget,
}: {
  usage: UsageRow | null
  budget: number | null
}) {
  if (usage === null) {
    return (
      <Quiet>
        <span title="This campaign has no row in the usage counters, which means nothing inside it has ever fired.">
          Never used
        </span>
      </Quiet>
    )
  }
  const share = consumed(usage.spent_minor, budget)
  if (share === null) {
    return (
      <>
        <span className="text-ink block font-medium tabular-nums">
          {amount(usage.spent_minor)}
        </span>
        <span className="text-label text-ink-4 block">no limit</span>
      </>
    )
  }
  return (
    <>
      <span className="flex items-center gap-2">
        <Meter share={share} />
        <span
          className={
            share >= 0.9
              ? "text-bad-ink font-medium tabular-nums"
              : "text-ink-2 tabular-nums"
          }
        >
          {percent(Math.round(share * 10_000))}
        </span>
      </span>
      <span className="text-label text-ink-4 block truncate">
        {amount(usage.spent_minor)} of {amount(budget ?? 0)}
      </span>
    </>
  )
}

/// One campaign: what it is allowed to do, what it has done, and what is inside
/// it.
function CampaignSheet({
  openId,
  line,
  onClose,
}: {
  openId: string
  line: Line_ | undefined
  onClose: () => void
}) {
  return (
    <Sheet
      open={openId !== ""}
      onClose={onClose}
      width="record"
      title={line?.row.name ?? openId}
      subtitle={
        line === undefined
          ? "Not in any published book"
          : `${line.row.book_name} v${line.row.version}`
      }
    >
      {line === undefined ? (
        <p className="text-ctl text-ink-3 px-[18px] py-4">
          No published book declares this campaign. It may sit in a draft, or a
          later book may have dropped it — either way no till is carrying it.
        </p>
      ) : (
        <>
          <Facts>
            <Fact label="Status">
              <Tag tone={campaignStatus(line.row.status).tone}>
                {campaignStatus(line.row.status).label}
              </Tag>
            </Fact>
            <Fact label="Runs">
              {line.row.valid_from === null
                ? "always"
                : day(line.row.valid_from)}
              {" → "}
              {line.row.valid_to === null ? "open" : day(line.row.valid_to)}
            </Fact>
            <Fact label="Budget">
              {line.row.budget_minor === null ? (
                <Quiet>Unlimited</Quiet>
              ) : (
                rp(line.row.budget_minor)
              )}
            </Fact>
            <Fact label="Given away">
              {line.usage === null ? (
                <Quiet>Never used</Quiet>
              ) : (
                <>
                  {rp(line.usage.spent_minor)}{" "}
                  <span className="text-ink-4">
                    over {count(line.usage.uses)}{" "}
                    {line.usage.uses === 1 ? "basket" : "baskets"}
                  </span>
                </>
              )}
            </Fact>
            <Fact label="Baskets allowed">
              {line.row.max_uses === null ? (
                <Quiet>Unlimited</Quiet>
              ) : (
                count(line.row.max_uses)
              )}
            </Fact>
            <Fact label="Per shopper">
              {/* Drawn as unknown, not as unlimited. The column exists in the
                  database and on the performance read; this endpoint does not
                  return it, and an em dash says "not asked" where "Unlimited"
                  would say "asked, and there is no cap". */}
              <Quiet>
                <span title="`max_uses_per_customer` is not on this endpoint's response. Unlimited and unknown are different answers, so neither is guessed.">
                  not on the wire
                </span>
              </Quiet>
            </Fact>
            {/* The shopper-facing half. The only part of a price book a
                customer reads, and the only part still editable after
                publication — a banner is not a price, and a typo in one must
                be fixable without cutting a new book. */}
            <Fact label="Headline" wide>
              {line.row.headline ?? <Quiet>No poster text</Quiet>}
            </Fact>
            <Fact label="Small print" wide>
              {line.row.terms ?? <Quiet>None printed</Quiet>}
            </Fact>
          </Facts>

          <SubHead>
            Offers run inside it — a rule is live only while this campaign is
          </SubHead>
          {line.offers.length === 0 ? (
            <Line>
              <Quiet>
                No promotion in any published book names this campaign, so
                switching it changes nothing at a till.
              </Quiet>
            </Line>
          ) : (
            line.offers.map((rule) => (
              <Line
                key={rule.rule_id}
                note={`${describeScope(rule.definition)} · ${describeEffect(rule.definition.effect)}`}
              >
                <span className="text-ink min-w-0 flex-1 truncate font-medium">
                  {rule.name}
                </span>
                <Tag tone={ruleStatus(rule.status).tone}>
                  {ruleStatus(rule.status).label}
                </Tag>
              </Line>
            ))
          )}

          <SubHead>Shops carrying the book this arrived in</SubHead>
          {line.row.activated_by.length === 0 ? (
            <Line>
              <Quiet>No shop has activated {line.row.book_name}.</Quiet>
            </Line>
          ) : (
            line.row.activated_by.map((shop) => (
              <Line
                key={shop.origin_id}
                note={`activated ${day(shop.activated_at)} · reported ${day(shop.reported_at)}`}
              >
                <span className="text-ink min-w-0 flex-1 truncate font-medium">
                  {shop.site_id ?? shop.origin_id}
                </span>
              </Line>
            ))
          )}
        </>
      )}
    </Sheet>
  )
}
