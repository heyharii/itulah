import {
  useSuspenseInfiniteQuery,
  useSuspenseQuery,
} from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { Suspense, useDeferredValue, useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { DockChoice } from "@/components/shell/dock-tools"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { PageHeader } from "@/components/ui/page-header"
import { Status } from "@/components/ui/pill"
import { Toolbar } from "@/components/ui/segmented"
import { SubTabs } from "@/components/ui/sub-tabs"
import { EmptyState, LoadingState, LoadMore } from "@/components/ui/states"
import { count, moment } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import {
  describeEventKind,
  priceEventPagesQuery,
  type PriceEvent,
  type PriceEventKind,
} from "@/lib/queries/changes"
import { commercialFleetQuery } from "@/lib/queries/commercial"
import { useNameOfLogin } from "@/lib/queries/hr-employees"
import { useSheet } from "@/lib/sheets"
import {
  CardFigure,
  CardFoot,
  CardName,
  Sentence,
} from "@/components/ui/phone-cards"

/// History — the price book's log.
///
/// ## Five kinds, kept apart
///
/// UI-001 §7 asks that publication, delivery, activation, failure and expiry be
/// distinguished, so a publication is never read as evidence a till is
/// charging. That is the design: **Published** is head office, **In service**
/// is a counter, and in this estate the two are days apart. A log that merged
/// them would be the place somebody concluded the wrong one.
///
/// It opens on everything. An earlier draft opened on two empty pickers and
/// asked for a product and a shop first — correct for the per-product price
/// trace it was built on, and the wrong front door for a screen called
/// History: a log that shows nothing until you interrogate it is not a log.
const KINDS = [
  { value: "ALL", label: "All" },
  { value: "PUBLISHED", label: "Published" },
  { value: "ACTIVATED", label: "Applied" },
  { value: "TROUBLE", label: "Problems" },
] as const

function toneOf(kind: string): "ok" | "warn" | "bad" | "info" | "neutral" {
  switch (kind) {
    case "ACTIVATED":
      return "ok"
    case "PUBLISHED":
      return "info"
    case "FAILED":
      return "bad"
    case "EXPIRED":
      return "warn"
    default:
      return "neutral"
  }
}

/// The kinds a lens keeps, as the server is asked for them. Narrowed there and
/// not here: the log is paged, and a lens over the loaded pages would find
/// nothing on page one while the troubles sat on page four.
function kindsOf(lens: string): readonly PriceEventKind[] {
  switch (lens) {
    case "PUBLISHED":
      return ["PUBLISHED"]
    case "ACTIVATED":
      return ["ACTIVATED"]
    case "TROUBLE":
      return ["FAILED", "EXPIRED"]
    default:
      return []
  }
}

export function History() {
  // The title stands at once; the log waits for its first page and the shops
  // and streams in with them (the server starts the reads too).
  return (
    <PageContent>
      <PageHeader crumb="Marketing" title="Price updates" />
      <Suspense fallback={<LoadingState>Loading…</LoadingState>}>
        <PriceLog />
      </Suspense>
    </PageContent>
  )
}

function PriceLog() {
  // A phone draws each entry as a card and keeps the kind of event in the
  // drawer over the bottom bar (`DockChoice`).
  const phone = useLayout() === "phone"
  const navigate = useNavigate()
  const shop = useSheet("site")
  const lens = useSheet("log-kind")
  const filtered = shop.value !== undefined || lens.value !== undefined
  /// Both narrowings off in one navigation — two `close()`s would be two
  /// history entries racing over one search.
  const clearFilters = () =>
    void navigate({
      to: ".",
      replace: true,
      search: (prev: Record<string, unknown>) => ({
        ...prev,
        site: undefined,
        "log-kind": undefined,
      }),
    } as never)

  /// The log a page at a time, the next asked for as its foot nears view. The
  /// shop and the kind lens both go to the server, so every page is already
  /// the answer and nothing loaded is thrown away.
  const lensValue = lens.value ?? "ALL"
  const siteId = shop.value ?? null
  // Another shop or kind: the entries in hand stay, dimmed (`list-swap`),
  // until the next are read — the deferred question keeps them on screen.
  const askedSite = useDeferredValue(siteId)
  const askedLens = useDeferredValue(lensValue)
  const events = useSuspenseInfiniteQuery(
    priceEventPagesQuery(askedSite, kindsOf(askedLens))
  )

  const fleet = useSuspenseQuery(commercialFleetQuery())

  const shopName = useMemo(() => {
    const map = new Map<string, string>()
    for (const one of fleet.data.items) {
      if (one.site_id !== null) map.set(one.site_id, one.label ?? one.site_id)
    }
    return map
  }, [fleet.data])

  /// Every page loaded, in order. Folded and grouped below as ONE list, so a
  /// rollout whose thirteen shops straddle a page boundary is still one entry,
  /// and a day split across two pages is still one heading.
  const shown = useMemo<PriceEvent[]>(
    () => events.data.pages.flatMap((page) => page.rows),
    [events.data]
  )

  // ── one rollout is one entry, not thirteen ──────────────────────────────
  //
  // Publishing a book queues it to every shop in the same instant, and drawn
  // literally that is thirteen identical rows with thirteen identical
  // timestamps — which is what the first version of this screen did, and it
  // buried the one event that mattered under twelve copies of itself.
  //
  // So events that are the same book, the same kind and the same second are
  // ONE entry carrying the shops it reached. The shops are not lost: they are
  // the entry's own list, opened when somebody wants them. A failure is never
  // folded in — each till fails for its own reason, and its words are the
  // whole point of the row.
  const entries = useMemo(() => {
    const out: Entry[] = []
    const index = new Map<string, Entry>()
    for (const event of shown) {
      const foldable = event.kind !== "FAILED"
      const key = `${event.publication_id}:${event.kind}:${event.at.slice(0, 19)}`
      const held = foldable ? index.get(key) : undefined
      if (held === undefined) {
        const entry: Entry = {
          lead: event,
          shops: event.site_id === null ? [] : [event.site_id],
          prices: event.price_rule_count ?? 0,
        }
        out.push(entry)
        if (foldable) index.set(key, entry)
      } else {
        if (event.site_id !== null) held.shops.push(event.site_id)
        held.prices += event.price_rule_count ?? 0
      }
    }
    return out
  }, [shown])

  // Grouped by day, because a log read by a person is read by day.
  const days = useMemo(() => {
    const by = new Map<string, Entry[]>()
    for (const entry of entries) {
      const key = entry.lead.at.slice(0, 10)
      by.set(key, [...(by.get(key) ?? []), entry])
    }
    return [...by.entries()]
  }, [entries])

  return (
    <>
      {phone ? (
        <>
          <DockChoice
            value={lens.value ?? "ALL"}
            options={KINDS.map((one) => ({
              value: one.value,
              label: one.label,
              short: one.label,
            }))}
            onChange={(next) =>
              next === "ALL" ? lens.close() : lens.open(next)
            }
          />
          <Sentence>
            {count(entries.length)} {entries.length === 1 ? "entry" : "entries"}
            {shop.value !== undefined && (
              <>
                {" "}
                at {shopName.get(shop.value) ?? shop.value}.{" "}
                <button
                  type="button"
                  onClick={shop.close}
                  className="text-accent underline underline-offset-2"
                >
                  Show every store
                </button>
              </>
            )}
          </Sentence>
        </>
      ) : (
        <>
          <SubTabs
            tabs={KINDS.map((one) => ({ value: one.value, label: one.label }))}
            value={lens.value ?? "ALL"}
            onChange={(next) =>
              next === "ALL" ? lens.close() : lens.open(next)
            }
          />
          <Toolbar className="mb-5">
            <Toolbar.Spacer />
            {shop.value !== undefined && (
              <button
                type="button"
                onClick={shop.close}
                className="text-[0.9375rem] text-mute underline underline-offset-2 hover:text-ink"
              >
                {shopName.get(shop.value) ?? shop.value} · show every store
              </button>
            )}
            <span className="text-[0.9375rem] text-mute tabular-nums">
              {count(entries.length)}{" "}
              {entries.length === 1 ? "entry" : "entries"}
            </span>
          </Toolbar>
        </>
      )}

      <Card
        aria-busy={askedSite !== siteId || askedLens !== lensValue || undefined}
        className="list-swap overflow-hidden max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none"
      >
        {entries.length === 0 ? (
          filtered ? (
            <EmptyState
              action={
                <Button variant="ghost" onClick={clearFilters}>
                  Clear filters
                </Button>
              }
            >
              Nothing matches these filters.
            </EmptyState>
          ) : (
            <EmptyState>No history.</EmptyState>
          )
        ) : (
          <div className="flex flex-col">
            {days.map(([date, rows]) => (
              <section key={date}>
                <h3 className="sticky top-0 z-10 border-b border-hairline bg-canvas px-6 py-3 text-[0.9375rem] font-medium text-mute max-md:-mx-1 max-md:border-b-0 max-md:px-1 max-md:py-2 max-md:not-first:mt-3">
                  {moment(rows[0].lead.at).split(",")[0] ?? date}
                </h3>
                <div className="max-md:flex max-md:flex-col max-md:gap-2.5">
                  {rows.map((entry) =>
                    phone ? (
                      <PhoneEntry
                        key={entry.lead.id}
                        entry={entry}
                        shopName={shopName}
                        onPickShop={(siteId) => shop.open(siteId)}
                      />
                    ) : (
                      <Row
                        key={entry.lead.id}
                        entry={entry}
                        shopName={shopName}
                        onPickShop={(siteId) => shop.open(siteId)}
                      />
                    )
                  )}
                </div>
              </section>
            ))}
            {/* The log scrolls with the page, so its foot is watched
                here, inside the box that scrolls — see `<LoadMore>`. */}
            <LoadMore query={events} className="py-5" />
          </div>
        )}
      </Card>
    </>
  )
}

/// What one line of the log is: an event, and the shops it reached at once.
interface Entry {
  /// The event the line is drawn from. Every folded event shares its book, its
  /// kind and its instant, so any of them serves — this is the first.
  lead: PriceEvent
  /// The shops, when the kind has them. One name is printed; several become a
  /// count that opens.
  shops: string[]
  /// Prices taken, summed over the folded events.
  prices: number
}

/// One line of the log. Time, what happened, which book, where.
///
/// One line and not three: a log is scanned, and a three-line entry turns three
/// hundred events into a document nobody reaches the bottom of. Only a failure
/// gets a second line, because a till's own words are the diagnostic and there
/// is nowhere else to read them.
function Row({
  entry,
  shopName,
  onPickShop,
}: {
  entry: Entry
  shopName: ReadonlyMap<string, string>
  onPickShop: (siteId: string) => void
}) {
  const [open, setOpen] = useState(false)
  const nameOf = useNameOfLogin()
  const { lead, shops, prices } = entry
  const many = shops.length > 1

  return (
    <div className="border-b border-hairline-2 last:border-b-0">
      <div className="flex min-h-16 items-center gap-5 px-6 py-3.5 hover:bg-soft">
        <span className="w-16 shrink-0 text-[0.9375rem] text-mute tabular-nums">
          {moment(lead.at).split(", ").pop()}
        </span>
        <Status tone={toneOf(lead.kind)} className="shrink-0">
          {describeEventKind(lead.kind)}
        </Status>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[0.9375rem] text-ink">
            {lead.publication_name}
          </span>
          {lead.detail !== null && (
            <span className="block text-[0.9375rem] text-bad">
              {lead.detail}
            </span>
          )}
        </span>

        {/* The shops. One is named; several are a count that opens, because a
            rollout is one event and thirteen rows of it is not a log. */}
        {shops.length === 1 && (
          <button
            type="button"
            onClick={() => onPickShop(shops[0])}
            className="shrink-0 text-[0.9375rem] text-body underline-offset-2 hover:underline"
          >
            {shopName.get(shops[0]) ?? shops[0]}
          </button>
        )}
        {many && (
          <button
            type="button"
            onClick={() => setOpen((was) => !was)}
            aria-expanded={open}
            className="shrink-0 text-[0.9375rem] text-body underline-offset-2 hover:underline"
          >
            {count(shops.length)} stores
          </button>
        )}

        <span className="w-28 shrink-0 text-right text-[0.9375rem] text-mute tabular-nums">
          {prices > 0 ? `${count(prices)} rules loaded` : ""}
        </span>
        {/* Who did it, and only where a PERSON did. On a shop event the actor
            is the till's origin, which the shop name beside it already says. */}
        <span className="w-32 shrink-0 truncate text-right text-[0.9375rem] text-mute">
          {shops.length === 0 && lead.actor ? nameOf(lead.actor) : ""}
        </span>
      </div>

      {open && (
        <div className="flex flex-wrap gap-2 px-6 pb-4 pl-[6.75rem]">
          {shops.map((siteId) => (
            <button
              key={siteId}
              type="button"
              onClick={() => onPickShop(siteId)}
              className="rounded-inner border border-hairline-2 px-3 py-1 text-[0.9375rem] text-body transition-colors hover:border-hairline-strong hover:text-ink"
            >
              {shopName.get(siteId) ?? siteId}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/// One entry of the log as a phone's card: the book is the head, how many
/// prices it carried the figure, and the foot says what happened, when and (for
/// a person's act) who — with the shops as its one button. A failure's own
/// words stay under the name, where they are the diagnostic.
function PhoneEntry({
  entry,
  shopName,
  onPickShop,
}: {
  entry: Entry
  shopName: ReadonlyMap<string, string>
  onPickShop: (siteId: string) => void
}) {
  const [open, setOpen] = useState(false)
  const nameOf = useNameOfLogin()
  const { lead, shops, prices } = entry
  const many = shops.length > 1
  const time = moment(lead.at).split(", ").pop()
  return (
    <div className="rounded-card border border-hairline bg-canvas shadow-soft">
      <div className="flex items-start gap-3 p-4">
        <div className="min-w-0 flex-1">
          <CardName
            name={lead.publication_name}
            line={
              lead.detail === null ? undefined : (
                <span className="text-bad">{lead.detail}</span>
              )
            }
          />
        </div>
        {prices > 0 && (
          <div className="shrink-0">
            <CardFigure value={count(prices)} caption="rules loaded" />
          </div>
        )}
      </div>
      <div className="flex items-center justify-between gap-3 rounded-b-card border-t border-hairline px-4 py-3 text-[0.9375rem] text-mute">
        <CardFoot
          status={
            <Status tone={toneOf(lead.kind)}>
              {describeEventKind(lead.kind)}
            </Status>
          }
        >
          {time}
          {shops.length === 0 && lead.actor ? ` · ${nameOf(lead.actor)}` : ""}
        </CardFoot>
        {shops.length === 1 && (
          <Button
            variant="tint"
            size="card"
            className="max-w-[10rem] shrink-0"
            onClick={() => onPickShop(shops[0])}
          >
            <span className="truncate">
              {shopName.get(shops[0]) ?? shops[0]}
            </span>
          </Button>
        )}
        {many && (
          <Button
            variant="tint"
            size="card"
            className="shrink-0"
            aria-expanded={open}
            onClick={() => setOpen((was) => !was)}
          >
            {count(shops.length)} stores
          </Button>
        )}
      </div>
      {open && (
        <div className="flex flex-wrap gap-2 border-t border-hairline px-4 py-3">
          {shops.map((siteId) => (
            <button
              key={siteId}
              type="button"
              onClick={() => onPickShop(siteId)}
              className="rounded-inner border border-hairline-2 px-3 py-1.5 text-[0.9375rem] text-body active:bg-soft"
            >
              {shopName.get(siteId) ?? siteId}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
