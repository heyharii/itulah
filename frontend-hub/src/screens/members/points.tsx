import { useInfiniteQuery } from "@tanstack/react-query"
import { useMemo } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { AppLink } from "@/components/ui/app-link"
import { Card } from "@/components/ui/card"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { MiniCell, MiniRow, MiniTable } from "@/components/ui/rows"
import { Banner, EmptyState, LoadMore } from "@/components/ui/states"
import { count, moment } from "@/lib/format"
import { listPointsAccounts, pointsKeys } from "@/lib/queries/points"
import { queryState } from "@/lib/query-state"

/// Points — what the business owes its members.
///
/// ## The two figures, side by side, on purpose
///
/// **Balance** is the cached account row, which is the number a till reads.
/// **From entries** is what the ledger actually adds up to. They are drawn
/// together and a row where they disagree is marked, because a screen showing
/// only the cache would be the last place anybody found out the two had drifted
/// — and one showing only the sum would hide that the number the counter is
/// using is wrong.
///
/// Nothing here repairs the difference. A GET that quietly corrected a balance
/// would destroy the evidence of whatever wrote it.
///
/// ## Why this screen cannot spend anything
///
/// There is no action on it, and that is the locked V1 rule rather than an
/// omission: points leave an account in exactly one way, by becoming a voucher,
/// and that happens at the counter. So this is a register, and the thing that
/// moves it lives on the Ledger next door.
const PAGE = 200

export function Points() {
  /// The account book a page at a time, largest balance first, the next page
  /// asked for as the foot of the list comes into view.
  const list = useInfiniteQuery({
    queryKey: pointsKeys.accounts(),
    queryFn: ({ pageParam, signal }) =>
      listPointsAccounts({ cursor: pageParam, limit: PAGE }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  })

  const accounts = useMemo(
    () => list.data?.pages.flatMap((page) => page.items) ?? [],
    [list.data]
  )
  /// The book-wide figures ride on every page; the first one is enough.
  const head = list.data?.pages[0]
  const drifted = head?.accounts_not_reconciling ?? 0

  return (
    <PageContent>
      <PageHeader
        crumb="Members"
        title="Points"
        sub="What each member holds. A point is money the business owes a shopper, so this is a liability register — not a discount."
      />

      <KpiStrip>
        {/* All three are the server's counts over the whole book, not sums
            of the rows loaded so far — they are true before the list below
            has been scrolled to its end. */}
        <Kpi label="Accounts" value={count(head?.account_count ?? 0)} />
        <Kpi
          label="Points outstanding"
          value={count(head?.outstanding_points ?? 0)}
        />
        <Kpi
          label="Not reconciling"
          value={count(drifted)}
          tone={drifted > 0 ? "down" : "flat"}
        />
      </KpiStrip>

      {drifted > 0 && (
        <Banner tone="warn" className="mb-4">
          {count(drifted)} account{drifted === 1 ? " has" : "s have"} a cached
          balance that does not match their own entries. The entries are the
          record and the cache is what a till reads, so those members are being
          quoted a figure the ledger does not support. Nothing here repairs it —
          a fault this shape has a cause, and correcting the number would hide
          it.
        </Banner>
      )}

      <Card className="overflow-hidden">
        {queryState(list, {
          loading: "Reading the points accounts…",
          render: () =>
            accounts.length === 0 ? (
              <EmptyState>
                No member holds any points. The account and ledger tables exist
                and are empty — nothing has been earned, which is not the same
                as loyalty being switched off.
              </EmptyState>
            ) : (
              <>
                <MiniTable
                  head={[
                    "Member",
                    { label: "Balance", align: "right" },
                    { label: "From entries", align: "right" },
                    { label: "Entries", align: "right" },
                    { label: "Last movement", align: "right" },
                  ]}
                >
                  {accounts.map((account) => (
                    <MiniRow key={account.customer_id}>
                      <MiniCell>
                        {/* Straight into that member's own entries. No dead
                          ends: the balance and the movements behind it are one
                          click apart in both directions. */}
                        <AppLink
                          to="/members/points-ledger"
                          sheet={{
                            key: "customer",
                            value: account.customer_id,
                          }}
                          className="text-ink underline-offset-2 hover:underline"
                        >
                          {account.display_name ?? account.customer_id}
                        </AppLink>
                        <span className="block font-mono text-[0.875rem] text-mute">
                          {account.customer_id}
                        </span>
                      </MiniCell>
                      <MiniCell align="right">
                        <span className="font-medium text-ink tabular-nums">
                          {count(account.balance_points)}
                        </span>
                      </MiniCell>
                      <MiniCell align="right">
                        {account.reconciles ? (
                          <span className="text-mute tabular-nums">
                            {count(account.ledger_sum)}
                          </span>
                        ) : (
                          <span className="flex items-center justify-end gap-1.5">
                            <span className="text-bad tabular-nums">
                              {count(account.ledger_sum)}
                            </span>
                            <Pill tone="bad">does not match</Pill>
                          </span>
                        )}
                      </MiniCell>
                      <MiniCell align="right">
                        <span className="tabular-nums">
                          {count(account.entries)}
                        </span>
                      </MiniCell>
                      <MiniCell align="right">
                        <span className="text-[0.875rem] text-mute">
                          {account.last_movement === null
                            ? "never"
                            : moment(account.last_movement)}
                        </span>
                      </MiniCell>
                    </MiniRow>
                  ))}
                </MiniTable>
                {/* Inside the card, which scrolls with the page — see
                  `<LoadMore>`. */}
                <LoadMore query={list} className="py-3" />
              </>
            ),
        })}
      </Card>
    </PageContent>
  )
}
