import { useQuery } from "@tanstack/react-query"

import { PageContent } from "@/components/shell/app-shell"
import { AppLink } from "@/components/ui/app-link"
import { Card } from "@/components/ui/card"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { MiniCell, MiniRow, MiniTable, SubHead } from "@/components/ui/rows"
import { EmptyState } from "@/components/ui/states"
import { count, day, moment } from "@/lib/format"
import {
  changeKeys,
  describeChangeKind,
  listPriceChanges,
  needsAttention,
} from "@/lib/queries/changes"
import { commercialFleet, commercialKeys } from "@/lib/queries/commercial"
import { queryState } from "@/lib/query-state"

/// Commercial's front door.
///
/// ## What it is for, and what it refuses to be
///
/// It is a **worklist**, not a dashboard. The module already has four screens
/// that each answer their own question well, and a fifth that re-drew their
/// charts smaller would be a page people check instead of the screens that can
/// act. So this says only the two things that are true of the module as a
/// whole and visible from none of its screens on their own:
///
///   * which price work nobody has finished, and
///   * which shops are not charging what the centre thinks they are.
///
/// Both are one click from the screen that does something about them. Nothing
/// here is a figure this page computes: the attention rule is
/// `needsAttention`, shared with Changes, so the two cannot disagree about
/// what needs attention.
///
/// ## Why there is no money on it
///
/// Promo sales, discount given and gross profit live on Promotions, over a date
/// range somebody chose. Repeating them here over a range nobody chose is how a
/// number gets quoted in a meeting with the wrong period behind it.
export function CommercialOverview() {
  const changes = useQuery({
    queryKey: changeKeys.list(false),
    queryFn: ({ signal }) => listPriceChanges(false, signal),
  })

  const fleet = useQuery({
    queryKey: commercialKeys.fleet(),
    queryFn: ({ signal }) => commercialFleet(signal),
  })

  const outstanding = changes.data ?? []
  const attention = outstanding.filter(needsAttention)

  // A shop is behind when it holds fewer books than head office has published,
  // and "never reported" is its own case rather than an enormous number:
  // `behind_by` is null there, and "infinitely behind" is not a figure.
  const shops = fleet.data?.items ?? []
  const silent = shops.filter((shop) => !shop.has_ever_activated)
  const behind = shops.filter(
    (shop) => shop.has_ever_activated && (shop.behind_by ?? 0) > 0
  )

  return (
    <PageContent>
      <PageHeader
        crumb="Commercial"
        title="Overview"
        sub="What is unfinished, and which shops are behind."
      />

      <KpiStrip>
        <Kpi label="Changes outstanding" value={count(outstanding.length)} />
        <Kpi
          label="Need attention"
          value={count(attention.length)}
          tone={attention.length > 0 ? "down" : "flat"}
        />
        <Kpi
          label="Shops behind"
          value={count(behind.length)}
          tone={behind.length > 0 ? "down" : "flat"}
        />
        <Kpi
          label="Never reported"
          value={count(silent.length)}
          tone={silent.length > 0 ? "down" : "flat"}
        />
      </KpiStrip>

      <div className="grid items-start gap-5 min-[1100px]:grid-cols-2">
        <Card className="p-4">
          <SubHead
            aside={
              <AppLink to="/commercial/changes" className="text-accent">
                Open Changes
              </AppLink>
            }
          >
            Price work nobody has finished
          </SubHead>
          {queryState(changes, {
            loading: "Reading the price books…",
            render: () =>
              attention.length === 0 ? (
                <EmptyState>
                  {outstanding.length === 0
                    ? "Nothing outstanding."
                    : `${count(outstanding.length)} changes are rolling out, none of them stuck.`}
                </EmptyState>
              ) : (
                <MiniTable
                  head={[
                    "Change",
                    { label: "Why", align: "left" },
                    { label: "Shops", align: "right" },
                  ]}
                >
                  {attention.map((change) => (
                    <MiniRow key={change.publication_id}>
                      <MiniCell>
                        <span className="block truncate text-ink">
                          {change.name}
                        </span>
                        <span className="block truncate text-[0.6875rem] text-mute">
                          {describeChangeKind(change.kind)} ·{" "}
                          {day(change.effective_from)}
                        </span>
                      </MiniCell>
                      <MiniCell>
                        {/* The two reasons are different problems and are
                            never merged into "late". A failure is a till that
                            tried and could not; a closed window with shops
                            waiting is work the calendar did not do. */}
                        {change.rollout.failed > 0 ? (
                          <Pill tone="bad">Reported a failure</Pill>
                        ) : (
                          <Pill tone="warn">Closed, shops waiting</Pill>
                        )}
                      </MiniCell>
                      <MiniCell align="right">
                        <span className="tabular-nums">
                          {count(change.rollout.activated)}/
                          {count(change.rollout.target)}
                        </span>
                      </MiniCell>
                    </MiniRow>
                  ))}
                </MiniTable>
              ),
          })}
        </Card>

        <Card className="p-4">
          <SubHead
            aside={
              <AppLink to="/commercial/prices" className="text-accent">
                Open Prices
              </AppLink>
            }
          >
            Shops not on the newest book
          </SubHead>
          {queryState(fleet, {
            loading: "Asking the shops what they are charging…",
            render: (data) =>
              silent.length === 0 && behind.length === 0 ? (
                <EmptyState>
                  All {count(data.shop_count)} shops are on the newest book.
                </EmptyState>
              ) : (
                <MiniTable
                  head={[
                    "Shop",
                    { label: "Charging", align: "left" },
                    { label: "Since", align: "right" },
                  ]}
                >
                  {/* The silent shops first, deliberately. A shop that has
                      never reported is not "a bit behind" — nothing is known
                      about what it charges at all, and it is the row an
                      ordering by lateness would bury. */}
                  {[...silent, ...behind].map((shop) => (
                    <MiniRow key={shop.origin_id}>
                      <MiniCell>
                        <span className="block truncate text-ink">
                          {shop.label ?? shop.site_id ?? shop.origin_id}
                        </span>
                      </MiniCell>
                      <MiniCell>
                        {shop.has_ever_activated ? (
                          <span className="text-body">
                            {shop.book_name ?? `v${shop.version}`}
                            <span className="text-mute">
                              {" "}
                              · {count(shop.behind_by ?? 0)} book
                              {(shop.behind_by ?? 0) === 1 ? "" : "s"} behind
                            </span>
                          </span>
                        ) : (
                          <Pill tone="bad">Never reported</Pill>
                        )}
                      </MiniCell>
                      <MiniCell align="right">
                        <span className="text-[0.6875rem] text-mute">
                          {shop.activated_at === null
                            ? "—"
                            : moment(shop.activated_at)}
                        </span>
                      </MiniCell>
                    </MiniRow>
                  ))}
                </MiniTable>
              ),
          })}
        </Card>
      </div>
    </PageContent>
  )
}
