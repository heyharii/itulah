import { useState } from "react"

import { Button } from "@/components/ui/button"
import { CardList } from "@/components/ui/card-list"
import { Fab } from "@/components/ui/fab"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { LeadCard } from "@/components/ui/lead-card"
import { Banner, EmptyState } from "@/components/ui/states"
import { count, day, moment } from "@/lib/format"
import { useCashBoxes, useCashCounts } from "@/lib/queries/cash-count"
import { useShopPeople } from "@/lib/queries/shop-people"
import { queryState } from "@/lib/query-state"
import { useNodeIdentity } from "@/lib/session"
import { counterOf } from "@/screens/money/cash-count-model"
import { CountRecord } from "@/screens/money/cash-count-record"
import { CountSheet } from "@/screens/money/cash-count-sheet"
import { MoneyScreen } from "@/screens/money/parts"
import type { CashCountRow } from "@itulah/contract"
import { money } from "@itulah/contract/money"

/// Money › Cash count: the petty cash, counted note by note against the books.
///
/// The page is the button and the counts so far — one card each, saying when,
/// who counted and what they counted, and nothing the books said. The counts are
/// weekly, so there is nothing to filter or tab; three figures sit over the cards. A card opens the count
/// as it was made, with the Berita Acara to print; Count opens the sheet that
/// makes the next one (`cash-count-sheet.tsx`).
///
/// Only the petty cash is counted here. The cashier's float is the till's, and
/// the day's takings are counted when the drawer is.
export function CashCount() {
  const boxes = useCashBoxes()
  const counts = useCashCounts()
  const people = useShopPeople()
  const where = useNodeIdentity()
  // Held apart from the sheets' contents so each can play its exit with its
  // form still in it; `session` makes the next count start from nothing.
  const [counting, setCounting] = useState(false)
  const [session, setSession] = useState(0)
  const [open, setOpen] = useState<CashCountRow | null>(null)
  const [showing, setShowing] = useState(false)
  const [done, setDone] = useState<string | null>(null)

  const petty = boxes.data?.find((one) => one.meaning === "petty_cash")
  const shop = where.data?.site_name ?? where.data?.site_code ?? "Store"
  const begin = () => {
    setDone(null)
    setSession((was) => was + 1)
    setCounting(true)
  }

  return (
    <MoneyScreen
      actions={
        petty === undefined ? undefined : (
          <Button variant="primary" onClick={begin}>
            Count
          </Button>
        )
      }
    >
      {petty !== undefined && <Fab label="Count" onClick={begin} />}
      {queryState(boxes, {
        loading: "Reading the petty cash…",
        render: (list) => {
          const box = list.find((one) => one.meaning === "petty_cash")
          return (
            <div className="flex flex-col gap-4">
              {done !== null && (
                <Banner tone="ok" onDismiss={() => setDone(null)}>
                  {done}
                </Banner>
              )}
              {box === undefined ? (
                <Banner tone="bad">
                  This shop has no petty cash account to count against.
                </Banner>
              ) : (
                <>
                  {queryState(counts, {
                    loading: "Reading the counts…",
                    render: (rows: CashCountRow[]) => {
                      const mine = rows
                        .filter((row) => row.account_code === box.account_code)
                        .sort((a, b) =>
                          b.created_at.localeCompare(a.created_at),
                        )
                      return mine.length === 0 ? (
                        <EmptyState>No count yet.</EmptyState>
                      ) : (
                        <>
                          <KpiStrip>
                            <Kpi label="Counts" value={count(mine.length)} />
                            <Kpi
                              label="Last counted"
                              value={day(mine[0]?.created_at)}
                            />
                            <Kpi
                              label="Counted last time"
                              value={money(mine[0]?.counted_minor ?? 0)}
                            />
                          </KpiStrip>
                          <CardList>
                            {mine.map((row) => (
                              <LeadCard
                                key={row.count_id}
                                title={moment(row.created_at)}
                                lines={[counterOf(row, people).name]}
                                lead={{
                                  figure: money(row.counted_minor),
                                  caption: "counted",
                                }}
                                onOpen={() => {
                                  setOpen(row)
                                  setShowing(true)
                                }}
                              />
                            ))}
                          </CardList>
                        </>
                      )
                    },
                  })}
                  {session > 0 && (
                    <CountSheet
                      key={session}
                      box={box}
                      shop={shop}
                      people={people}
                      open={counting}
                      onClose={() => setCounting(false)}
                      onDone={(said) => {
                        setCounting(false)
                        setDone(said)
                      }}
                    />
                  )}
                  {open !== null && (
                    <CountRecord
                      key={open.count_id}
                      row={open}
                      shop={shop}
                      people={people}
                      open={showing}
                      onClose={() => setShowing(false)}
                    />
                  )}
                </>
              )}
            </div>
          )
        },
      })}
    </MoneyScreen>
  )
}
