import { useQuery } from "@tanstack/react-query"
import { FileStack, Percent, Store } from "lucide-react"
import { useMemo } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { AppLink } from "@/components/ui/app-link"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import type { Exception } from "@/components/ui/exception-queue"
import { ExceptionQueue } from "@/components/ui/exception-queue"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { PageHeader } from "@/components/ui/page-header"
import { KeyValue } from "@/components/ui/rows"
import { count, day, money } from "@/lib/format"
import {
  commercialFleet,
  commercialKeys,
  commercialUsage,
  listPriceBooks,
} from "@/lib/queries/commercial"
import { queryState } from "@/lib/query-state"
import { consumed, percent, useGo } from "@/screens/commercial/shared"

/// Commercial at a glance — which is a queue of things that are wrong, not a
/// wall of green numbers.
///
/// The three questions this module can get quietly wrong, in the order they
/// cost money: a book written and never published, a shop still charging from a
/// book everybody else has moved off, and a promotion that has spent more than
/// it was allowed to. Each of them is invisible on the screen that would
/// normally show it — a draft looks like a book, a stale shop looks like a
/// shop, an overspent promotion looks like a popular one — so the answer is to
/// put them together, first, with the number that says how much each matters.

export function CommercialOverview() {
  const go = useGo()

  const books = useQuery({
    queryKey: commercialKeys.books(),
    queryFn: ({ signal }) => listPriceBooks(signal),
  })
  const fleet = useQuery({
    queryKey: commercialKeys.fleet(),
    queryFn: ({ signal }) => commercialFleet(signal),
  })
  const usage = useQuery({
    queryKey: commercialKeys.usage(),
    queryFn: ({ signal }) => commercialUsage(signal),
  })

  const bookRows = useMemo(() => books.data ?? [], [books.data])
  const shops = useMemo(() => fleet.data?.items ?? [], [fleet.data])
  const promotions = useMemo(() => usage.data ?? [], [usage.data])

  const drafts = bookRows.filter((one) => one.status === "DRAFT")
  const published = bookRows.filter((one) => one.status === "PUBLISHED")
  const newest = fleet.data?.newest_published_version ?? null

  const neverActivated = shops.filter((shop) => !shop.has_ever_activated)
  const behind = shops.filter(
    (shop) => shop.has_ever_activated && (shop.behind_by ?? 0) > 0
  )
  const onNewest = shops.filter((shop) => (shop.behind_by ?? 1) === 0)

  const overspent = promotions.filter(
    (one) => one.budget_minor !== null && one.spent_minor >= one.budget_minor
  )
  const nearBudget = promotions.filter((one) => {
    const share = consumed(one.spent_minor, one.budget_minor)
    return share !== null && share >= 0.9 && share < 1
  })

  // Integer addition of minor units, which is exact. Every figure summed here
  // was sent by the server as a whole number of rupiah, and no float is
  // introduced on the way to the strip.
  const givenAway = promotions.reduce(
    (total, one) => total + one.spent_minor,
    0
  )

  const exceptions: Exception[] = []

  if (neverActivated.length > 0) {
    exceptions.push({
      id: "never-activated",
      title: `${count(neverActivated.length)} shop${neverActivated.length === 1 ? " has" : "s have"} never taken a price book`,
      detail:
        "Their tills are charging from whatever they were last given directly. Nothing the centre publishes reaches them.",
      amount: count(neverActivated.length),
      severity: "high",
      icon: <Store className="size-4" />,
      onOpen: () => go("/commercial/fleet"),
    })
  }

  if (overspent.length > 0) {
    exceptions.push({
      id: "overspent",
      title: `${count(overspent.length)} promotion${overspent.length === 1 ? " has" : "s have"} passed the budget declared for ${overspent.length === 1 ? "it" : "them"}`,
      detail:
        "A budget is a brake, not a gate — shops stop applying an offer only once the centre has sent them the count.",
      amount: money(
        // Again exact integer arithmetic, and only on amounts the server sent.
        overspent.reduce(
          (over, one) => over + (one.spent_minor - (one.budget_minor ?? 0)),
          0
        )
      ),
      severity: "high",
      icon: <Percent className="size-4" />,
      onOpen: () => go("/commercial/promotions"),
    })
  }

  if (behind.length > 0) {
    exceptions.push({
      id: "behind",
      title: `${count(behind.length)} shop${behind.length === 1 ? " is" : "s are"} charging from an older book`,
      detail:
        newest !== null
          ? `The newest published book is v${newest}. Until a shop takes it up, its till charges what it last received.`
          : "Nothing has been published yet.",
      amount: `${count(Math.max(...behind.map((one) => one.behind_by ?? 0)))} behind`,
      severity: behind.some((one) => (one.behind_by ?? 0) > 1)
        ? "high"
        : "medium",
      icon: <Store className="size-4" />,
      onOpen: () => go("/commercial/fleet"),
    })
  }

  if (drafts.length > 0) {
    exceptions.push({
      id: "drafts",
      title: `${count(drafts.length)} price book${drafts.length === 1 ? "" : "s"} written and not published`,
      detail:
        "A draft changes nothing anywhere. Publishing is the act that sends it to the fleet.",
      amount: count(drafts.length),
      severity: "medium",
      icon: <FileStack className="size-4" />,
      onOpen: () => go("/commercial/price-books"),
    })
  }

  if (nearBudget.length > 0) {
    exceptions.push({
      id: "near-budget",
      title: `${count(nearBudget.length)} promotion${nearBudget.length === 1 ? " is" : "s are"} within a tenth of ${nearBudget.length === 1 ? "its" : "their"} budget`,
      detail: "Worth a decision before the weekend rather than after it.",
      amount: percent(
        Math.round(
          Math.max(
            ...nearBudget.map(
              (one) => consumed(one.spent_minor, one.budget_minor) ?? 0
            )
          ) * 10_000
        )
      ),
      severity: "medium",
      icon: <Percent className="size-4" />,
      onOpen: () => go("/commercial/promotions"),
    })
  }

  const loading = books.isPending || fleet.isPending || usage.isPending

  return (
    <PageContent>
      <PageHeader
        crumb="Commercial"
        title="Overview"
        sub="Prices are the one thing here where being slightly wrong is a customer-facing defect. This is what is currently wrong."
      />

      <KpiStrip>
        <Kpi label="Books" value={count(bookRows.length)} />
        <Kpi
          label="Published"
          value={count(published.length)}
          delta={newest !== null ? `newest v${newest}` : "none yet"}
        />
        <Kpi
          label="Drafts"
          value={count(drafts.length)}
          delta={drafts.length > 0 ? "awaiting a decision" : "none waiting"}
          tone={drafts.length > 0 ? "down" : "flat"}
        />
        <Kpi
          label="Shops on newest"
          value={`${count(onNewest.length)} / ${count(shops.length)}`}
          delta={
            shops.length > 0 && onNewest.length === shops.length
              ? "whole fleet"
              : "some behind"
          }
          tone={
            shops.length > 0 && onNewest.length === shops.length ? "up" : "down"
          }
        />
        <Kpi label="Promotions used" value={count(promotions.length)} />
        <Kpi
          label="Given away"
          value={money(givenAway)}
          delta={
            overspent.length > 0
              ? `${count(overspent.length)} over budget`
              : "within budget"
          }
          tone={overspent.length > 0 ? "down" : "flat"}
        />
      </KpiStrip>

      <ExceptionQueue
        exceptions={loading ? [] : exceptions}
        empty={
          loading
            ? "Reading the books, the fleet and the counts…"
            : "Every book is published, every shop is on the newest one, and no promotion has passed its budget."
        }
      />

      <div className="grid gap-[1.125rem] lg:grid-cols-2">
        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle>Newest books</CardTitle>
            <AppLink
              to="/commercial/price-books"
              className="text-[0.75rem] font-medium text-accent hover:underline"
            >
              All books
            </AppLink>
          </CardHeader>
          <div className="border-t border-hairline px-4 pb-3">
            {queryState(books, {
              loading: "Loading…",
              render: (all) =>
                all.length === 0 ? (
                  <p className="py-6 text-center text-meta text-body">
                    No price book has been written yet.
                  </p>
                ) : (
                  // Five, because this is a summary panel and the list screen is
                  // one click away — not a cap on a list, which is the thing
                  // DESIGN.md forbids.
                  all.slice(0, 5).map((one) => (
                    <KeyValue
                      key={one.id}
                      term={
                        <AppLink
                          to="/commercial/price-books"
                          sheet={{ key: "book", value: one.id }}
                          className="hover:text-ink hover:underline"
                        >
                          v{one.version} · {one.name}
                        </AppLink>
                      }
                    >
                      <span
                        className={
                          one.status === "DRAFT" ? "text-warn-fg" : "text-body"
                        }
                      >
                        {one.status === "DRAFT"
                          ? "Draft"
                          : day(one.published_at)}
                      </span>
                    </KeyValue>
                  ))
                ),
            })}
          </div>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle>Where the money went</CardTitle>
            <AppLink
              to="/commercial/promotions"
              className="text-[0.75rem] font-medium text-accent hover:underline"
            >
              All promotions
            </AppLink>
          </CardHeader>
          <div className="border-t border-hairline px-4 pb-3">
            {queryState(usage, {
              loading: "Loading…",
              render: (all) =>
                all.length === 0 ? (
                  <p className="py-6 text-center text-meta text-body">
                    No promotion has been used yet.
                  </p>
                ) : (
                  [...all]
                    .sort((left, right) => right.spent_minor - left.spent_minor)
                    .slice(0, 5)
                    .map((one) => (
                      <KeyValue
                        key={`${one.kind}:${one.key}`}
                        term={one.name ?? one.key}
                      >
                        {money(one.spent_minor)}
                      </KeyValue>
                    ))
                ),
            })}
          </div>
        </Card>
      </div>
    </PageContent>
  )
}
