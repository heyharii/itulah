import { useMemo } from "react"
import { Percent, Store } from "lucide-react"
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
  Terms,
} from "@/modules/commercial/parts"
import {
  capsOf,
  consumed,
  describeEffect,
  describeScope,
  membersOnly,
  percent,
  ruleStatus,
  termsOf,
} from "@/modules/commercial/labels"
import type {
  Catalogue,
  CouponRow,
  RuleRow,
  UsageList,
  UsageRow,
} from "@/modules/commercial/wire"

/// Promotions — which offers exist, what each has given away, and where it has
/// actually reached.
///
/// One row is one promotion. A rule restated in a later book is **one promotion
/// amended, not two**: that is the shop's own model — `load_rules` reads
/// `DISTINCT ON (rule_id) ORDER BY version DESC` — and the centre's catalogue
/// mirrors that SQL rather than inventing a second rule about which of two
/// statements is live.
///
/// The screen this replaces listed only *usage*, so a promotion that had never
/// fired was simply absent and "we are not running one" was indistinguishable
/// from "we are running one and nobody has taken it". The rules come from the
/// books here and the spend is joined onto them, so an offer nobody has used is
/// a row reading zero.
///
/// ## Why `useReport`, three times
///
/// `GET /commercial/rules`, `/coupons` and `/usage` take **no parameters at
/// all** — not `q`, not `limit`, not `cursor`, not `sort`. `catalogue.rs` says
/// the absence is deliberate: "which promotions exist" has one answer, and a
/// window or a shop filter would invite a caller to believe the list narrows
/// the way the performance reads do, which it does not. Each answers one object
/// — `{ items, book_count }` or `{ item_count, items }` — so neither list hook
/// fits: there is nothing to page and no bare array to cap.
///
/// ## What that means for narrowing, and where the line is drawn
///
/// **There is no cap.** No `LIMIT` appears anywhere in `catalogue.rs`, so
/// `items` is not a page of the set, it IS the set. That is the fact the two
/// decisions below turn on, and it is why they are written down rather than
/// assumed:
///
///   **The tab strip narrows in the browser, and its counts are exact.** The
///   objection in `lib/table.ts` is to a filter that "narrows what has been
///   downloaded and reports its counts as if they described the whole set" —
///   which here they do. The day this endpoint grows a `limit` or a cursor,
///   this strip has to move to the server or go.
///
///   **There is no search box and there are no sortable headers.** Not because
///   a box over a complete array would be inexact, but because both are
///   controls that promise the server can answer other questions, and it
///   cannot: every header somebody clicked would be the browser re-ordering
///   what the server already decided. The one arrangement this screen does
///   impose is fixed and stated on the page — by what each offer has given
///   away, which is the number somebody opens this screen to act on. The
///   server's own order is `rule_id`, an artefact of the de-duplication rather
///   than a meaning.
///
/// ## A budget is a brake, not a gate
///
/// Every shop enforces from the last count it received, so the figure that must
/// not be exceeded is the one on this screen rather than one any till holds.
/// The centre's counters are exact and have no window: they can say a rule gave
/// away four million and can never say whether that was last week or last
/// March.

/// The statuses a rule has, from the engine's own `RuleStatus`.
const STATUSES = ["ACTIVE", "PAUSED", "DRAFT", "EXPIRED"] as const

/// One promotion, with what it cost and what gates it joined on.
interface Line_ {
  readonly row: RuleRow
  /// `null` when the promotion has never fired. Absent from usage is not zero
  /// spent — it is never used — and the two read differently in the cell.
  readonly usage: UsageRow | null
  /// The coupon that unlocks it, when it carries a code. `undefined` means the
  /// rule names a code that no published book declares, which is a promotion
  /// that cannot fire.
  readonly coupon: CouponRow | undefined
  /// How many shops are charging the book this rule arrived in. Zero is the
  /// interesting case: published, and reaching no till.
  readonly reached: number
}

export function PromotionsScreen() {
  const url = useQueryState()
  const status = url.one("status")
  const openId = url.one("rule")

  const rules = useReport<Catalogue<RuleRow>>({
    key: ["commercial", "rules"],
    path: "/api/v1/commercial/rules",
  })
  const coupons = useReport<Catalogue<CouponRow>>({
    key: ["commercial", "coupons"],
    path: "/api/v1/commercial/coupons",
  })
  const usage = useReport<UsageList>({
    key: ["commercial", "usage"],
    path: "/api/v1/commercial/usage",
  })

  /// The two halves joined here and nowhere else.
  ///
  /// The count is an observation and moves with every sale; the limit is a
  /// decision, frozen with the book that declared it. They live in different
  /// places for that reason, and the join is left-handed — from the rules — so
  /// a promotion that has never fired is a row rather than a gap.
  const spend = useMemo(() => {
    const byKey = new Map<string, UsageRow>()
    for (const one of usage.data?.items ?? []) {
      if (one.kind === "RULE") byKey.set(one.key, one)
    }
    return byKey
  }, [usage.data])

  const gates = useMemo(() => {
    const byCode = new Map<string, CouponRow>()
    for (const one of coupons.data?.items ?? []) byCode.set(one.code, one)
    return byCode
  }, [coupons.data])

  const all: readonly Line_[] = useMemo(() => {
    const lines = (rules.data?.items ?? []).map((row) => ({
      row,
      usage: spend.get(row.rule_id) ?? null,
      coupon:
        row.definition.coupon_code == null || row.definition.coupon_code === ""
          ? undefined
          : gates.get(row.definition.coupon_code),
      reached: row.activated_by.length,
    }))
    // The one arrangement this screen imposes; see the header. Most given away
    // first, and a promotion that has never fired sorts last rather than
    // leading a list of things to act on.
    return [...lines].sort(
      (a, b) => (b.usage?.spent_minor ?? 0) - (a.usage?.spent_minor ?? 0),
    )
  }, [rules.data, spend, gates])

  const rows = useMemo(
    () =>
      status === "" ? all : all.filter((line) => line.row.status === status),
    [all, status],
  )

  const overspent = all.filter(
    (line) =>
      line.usage !== null &&
      line.usage.budget_minor !== null &&
      line.usage.spent_minor >= line.usage.budget_minor,
  ).length
  const stranded = all.filter((line) => line.reached === 0).length

  const columns: ColumnDef<TableSetup, Line_>[] = [
    {
      id: "promotion",
      header: "Promotion",
      size: 24,
      // No priority: it is the identity column.
      meta: { icon: <Percent className="size-[15px]" />, min: 215 },
      cell: ({ row }) => (
        <>
          <span className="text-ink block truncate font-medium">
            {row.original.row.name}
          </span>
          <span className="text-label text-ink-4 block truncate">
            {row.original.row.book_name} · v{row.original.row.version}
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
        const known = ruleStatus(row.original.row.status)
        return <Tag tone={known.tone}>{known.label}</Tag>
      },
    },
    {
      id: "scope",
      header: "Applies to",
      size: 15,
      meta: { min: 150, priority: 3 },
      cell: ({ row }) => (
        <span className="flex items-center gap-1.5">
          <span className="truncate">
            {describeScope(row.original.row.definition)}
          </span>
          {membersOnly(row.original.row.definition) && <Tag>members</Tag>}
        </span>
      ),
    },
    {
      id: "effect",
      header: "What it does",
      size: 15,
      meta: { min: 150, priority: 4 },
      cell: ({ row }) => (
        <span className="truncate">
          {describeEffect(row.original.row.definition.effect)}
        </span>
      ),
    },
    {
      id: "coupon",
      header: "Gate",
      size: 12,
      // Open to everyone, or shut until a code is presented. Not decoration: a
      // coupon-gated rule that has never fired is behaving correctly, and an
      // ungated one that has never fired is a fault — the two look identical
      // without this column.
      meta: { min: 130, priority: 2 },
      cell: ({ row }) => <Gate line={row.original} />,
    },
    {
      id: "spend",
      header: "Given away",
      size: 14,
      // Never dropped. A promotion at ninety-something per cent of its budget
      // is the one somebody has to stop, pause or top up before the weekend.
      meta: { min: 155 },
      cell: ({ row }) => <Spend usage={row.original.usage} />,
    },
    {
      id: "shops",
      header: "In shops",
      size: 8,
      // Published and in force are different things. A promotion nobody is
      // carrying costs nothing and sells nothing, and on a usage-only list it
      // was indistinguishable from one that simply had not fired yet.
      meta: {
        icon: <Store className="size-[15px]" />,
        align: "right",
        min: 100,
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

  // Keyed by the WIRE's string rather than by the four this build knows, so a
  // status nobody here has been told about is still counted. It will have no
  // tab to sit under, which is the honest outcome: the "All" tab holds it and
  // the row is still on screen.
  const counted = new Map<string, number>(STATUSES.map((value) => [value, 0]))
  for (const line of all) {
    counted.set(line.row.status, (counted.get(line.row.status) ?? 0) + 1)
  }

  const failed = rules.isError ? rules.error : null

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHead
        module="Commercial"
        title="Promotions"
        description="Every offer the fleet is carrying, what it has given away against what it was allowed to, and how many tills have it."
      />

      <Tabs
        label="Status"
        value={status}
        onChange={(value) => url.set({ status: value || null }, false)}
        tabs={[
          { value: "", label: "All", count: all.length },
          ...STATUSES.map((value) => ({
            value,
            label: ruleStatus(value).label,
            count: counted.get(value),
          })),
        ]}
      />

      {/* Two different clocks in one sentence, on purpose. The offers are what
          the newest published book declares — a position. The spend beside them
          is every sale ever counted against those keys — the counters have no
          window at all and cannot be given one. */}
      <ScopeLine
        scope={{ kind: "asAt", date: today() }}
        note={
          <>
            the newest published book per rule · spend counted since each offer
            first fired
          </>
        }
      />

      <Tiles>
        <Tile
          label="Promotions"
          value={rules.data === undefined ? "—" : count(all.length)}
          note={
            rules.data === undefined
              ? undefined
              : `from ${count(rules.data.book_count)} published books`
          }
        />
        <Tile
          label="Live"
          value={
            rules.data === undefined ? "—" : count(counted.get("ACTIVE") ?? 0)
          }
          note="status ACTIVE — the engine still gates on the window"
        />
        <Tile
          label="At or over budget"
          value={rules.data === undefined ? "—" : count(overspent)}
          tone={overspent > 0 ? "bad" : undefined}
          note="a brake, not a gate — a till enforces its last count"
        />
        <Tile
          label="Reaching no shop"
          value={rules.data === undefined ? "—" : count(stranded)}
          tone={stranded > 0 ? "warn" : undefined}
          note="published, and no till has taken the book up"
        />
      </Tiles>

      <Toolbar
        trailing={
          usage.isPending
            ? "Joining what each has cost…"
            : usage.isError
              ? "Spend could not be read"
              : `${count(rows.length)} shown of ${count(all.length)}`
        }
      >
        {/* Says plainly why there is nothing to type into. A toolbar with no
            control reads as unfinished; a toolbar that says the endpoint takes
            no parameters reads as a fact somebody can act on. */}
        <span className="text-ctl text-ink-3">
          This endpoint takes no search, no sort and no paging — the list below
          is every promotion in every published book, ordered by what it has
          given away.
        </span>
      </Toolbar>

      {failed !== null ? (
        <Failed
          what="the promotions"
          error={failed}
          onRetry={() => void rules.refetch()}
        />
      ) : rules.isPending ? (
        <Loading cols={7} />
      ) : all.length === 0 ? (
        <Empty
          what="promotions"
          detail={
            rules.data !== undefined && rules.data.book_count === 0
              ? "No price book has been published at all, so no offer can exist yet."
              : "The published books declare prices and no promotions."
          }
        />
      ) : rows.length === 0 ? (
        <NoMatch
          what="promotions"
          held={all.length}
          onClear={() => url.set({ status: null }, false)}
        />
      ) : (
        <Table
          columns={columns}
          rows={rows as Line_[]}
          rowId={(row) => row.row.rule_id}
          caption="Every promotion in every published book"
          onRowClick={(row) => url.set({ rule: row.row.rule_id }, false)}
          isOpen={(row) => row.row.rule_id === openId}
          foot={{
            promotion: (
              <>
                <b className="text-ink">{count(rows.length)}</b>{" "}
                {rows.length === 1 ? "promotion" : "promotions"}
              </>
            ),
            spend: usage.isError
              ? "spend unavailable"
              : "against each one's own budget",
          }}
        />
      )}

      <RuleSheet
        openId={openId}
        line={all.find((one) => one.row.rule_id === openId)}
        onClose={() => url.set({ rule: null }, false)}
      />
    </div>
  )
}

/// What a promotion has given away, against what it was allowed to.
function Spend({ usage }: { usage: UsageRow | null }) {
  if (usage === null) {
    return (
      <Quiet>
        <span title="This rule has no row in the usage counters at all, which means it has never fired. That is different from having fired and spent nothing.">
          Never used
        </span>
      </Quiet>
    )
  }
  const share = consumed(usage.spent_minor, usage.budget_minor)
  if (share === null) {
    // `null` budget is unlimited — which is not zero, and must never be drawn
    // as a full meter nor as an empty one.
    return (
      <>
        <span className="text-ink block font-medium tabular-nums">
          {amount(usage.spent_minor)}
        </span>
        <span className="text-label text-ink-4 block">
          no limit · {count(usage.uses)}{" "}
          {usage.uses === 1 ? "basket" : "baskets"}
        </span>
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
        {amount(usage.spent_minor)} of {amount(usage.budget_minor ?? 0)}
      </span>
    </>
  )
}

/// The code that unlocks a promotion, and whether that code still works.
///
/// The rule document carries only the code. Whether the coupon is switched on,
/// when it runs and how many times it may be used live on the coupon row, and a
/// rule gated by a code that no published book declares **can never fire** —
/// which is exactly the row somebody is hunting when they ask why a promotion
/// has no uses.
function Gate({ line }: { line: Line_ }) {
  const code = line.row.definition.coupon_code
  if (code == null || code === "") {
    return <Quiet>Open to all</Quiet>
  }
  if (line.coupon === undefined) {
    return (
      <span className="flex items-center gap-1.5">
        <span className="text-label text-ink-2 truncate font-mono">{code}</span>
        <Tag tone="bad">
          <span title="The rule names this code and no published book declares a coupon for it, so nothing at a till can present it.">
            no coupon
          </span>
        </Tag>
      </span>
    )
  }
  return (
    <span className="flex items-center gap-1.5">
      <span className="text-label text-ink-2 truncate font-mono">{code}</span>
      {!line.coupon.active && <Tag tone="warn">off</Tag>}
    </span>
  )
}

/// One promotion, read back as the offer somebody meets.
///
/// Read from the row the list holds rather than from a second request, because
/// there is no by-rule endpoint: `/commercial/rules` is the only route that
/// returns a promotion document, and it returns all of them at once. The list
/// is the whole set, so a link to any live rule opens — which is the promise
/// the id in the address bar makes.
function RuleSheet({
  openId,
  line,
  onClose,
}: {
  openId: string
  line: Line_ | undefined
  onClose: () => void
}) {
  const rule = line?.row.definition
  return (
    <Sheet
      open={openId !== ""}
      onClose={onClose}
      width="record"
      title={line?.row.name ?? openId}
      subtitle={
        line === undefined
          ? "Not in any published book"
          : `${line.row.rule_id} · ${line.row.book_name} v${line.row.version}`
      }
    >
      {line === undefined || rule === undefined ? (
        <p className="text-ctl text-ink-3 px-[18px] py-4">
          No published book declares this rule. It may sit in a draft, or a
          later book may have dropped it — either way no till is carrying it.
        </p>
      ) : (
        <>
          <Terms
            headline={describeEffect(rule.effect)}
            {...termsOf(rule)}
            empty="This rule states no conditions at all: it applies to everything, to everyone, from the moment it was published."
          />

          <Facts>
            <Fact label="Status">
              <Tag tone={ruleStatus(line.row.status).tone}>
                {ruleStatus(line.row.status).label}
              </Tag>
            </Fact>
            <Fact label="Priority">
              {/* Higher wins where two offers cannot both apply. Drawn as the
                  integer it is rather than as an ordinal: it is a comparison
                  key, not a position in a list. */}
              {count(line.row.priority)}
            </Fact>
            <Fact label="Part of">
              {rule.campaign_id === null ? (
                <Quiet>No campaign</Quiet>
              ) : (
                // A rule is live only when both it and its campaign are, so a
                // paused campaign explains a rule that stopped earning without
                // the rule itself changing.
                <span className="font-mono">{rule.campaign_id}</span>
              )}
            </Fact>
            <Fact label="Budget">
              {capsOf(rule).budget === null ? (
                <Quiet>Unlimited</Quiet>
              ) : (
                rp(capsOf(rule).budget?.minor)
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
            <Fact label="Named shoppers">
              {line.usage === null ? (
                <Quiet />
              ) : (
                <>
                  {count(line.usage.customer_count)}{" "}
                  <span className="text-ink-4">
                    — anonymous baskets count in the spend and in nobody here
                  </span>
                </>
              )}
            </Fact>
          </Facts>

          <SubHead>Shops carrying the book this arrived in</SubHead>
          {line.row.activated_by.length === 0 ? (
            <Line>
              <Quiet>
                No shop has activated {line.row.book_name}. The promotion is
                published and is reaching no till.
              </Quiet>
            </Line>
          ) : (
            line.row.activated_by.map((shop) => (
              <Line
                key={shop.origin_id}
                // The shop's own clock and the centre's, side by side. The gap
                // is the number to watch: a book activated an hour ago and
                // reported yesterday means the report, not the activation, is
                // what is late.
                note={`activated ${day(shop.activated_at)} · reported ${day(shop.reported_at)} · ${count(shop.price_rule_count)} price rules arrived`}
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
