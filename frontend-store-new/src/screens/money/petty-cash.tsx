import { useEffect, useMemo, useRef, useState } from "react"

import { DockTools } from "@/components/shell/dock-tools"
import { Button } from "@/components/ui/button"
import { Fab } from "@/components/ui/fab"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import type { ListColumn } from "@/components/ui/list-table"
import { OpenButton } from "@/components/ui/open-rows"
import { Status } from "@/components/ui/pill"
import { Screen } from "@/components/ui/screen"
import { EmptyState, LoadingState } from "@/components/ui/states"
import { dateText, day } from "@/lib/format"
import { isoDay } from "@/lib/queries"
import { useBook, usePettyCash } from "@/lib/queries/expenses"
import { useShopPeople } from "@/lib/queries/shop-people"
import { queryState } from "@/lib/query-state"
import { useNodeIdentity } from "@/lib/session"
import { cn } from "@/lib/utils"
import { BOX, TD, TH } from "@/screens/money/declaration-words"
import { signed } from "@/screens/money/format"
import { Rows } from "@/screens/money/parts"
import {
  bookFrom,
  bookOf,
  effectOf,
  monthOf,
  nextNo,
  siteCodeOf,
  vouchersOf,
  type BookRow,
  type Voucher,
  type VoucherKind,
} from "@/screens/money/petty-book"
import { BackLink, NotaThumb } from "@/screens/money/petty-parts"
import { useNota } from "@/screens/money/petty-receipts"
import { VoucherForm } from "@/screens/money/petty-voucher-form"
import { VoucherView } from "@/screens/money/petty-voucher-view"
import type { PettyCashPosition } from "@itulah/contract"
import { money, units } from "@itulah/contract/money"

/// Money › Petty cash: the shop's small money, kept as a passbook of BKM (in)
/// and BKK (out) vouchers.
///
/// The page is a passbook — date, voucher, the nota's photo, debit, credit and
/// the balance after each line — with the tin's balance and the month's two
/// totals above it. A voucher is not a sheet: New BKM and New BKK open a page of
/// their own, as the hub's cash documents do, and saving one lands on the
/// voucher read as a record, with Print. The cashier's float is not here — it is
/// the till's, and never an expense route.
///
/// On a phone the header's two buttons are the dock's: New BKK is its one round
/// button and New BKM a row of its ⚙ sheet.
///
/// Which page is showing is kept in state, not in the address: the shell's
/// route list is fixed, so a reload comes back to the passbook. What a BKM or
/// BKK can hold today is the form's doc comment (`petty-voucher-form.tsx`), and
/// what the screen makes up to bridge the node's records to vouchers is
/// `petty-book.ts`.

type Page =
  | { readonly at: "book" }
  | { readonly at: "new"; readonly kind: VoucherKind }
  | { readonly at: "voucher"; readonly id: string }

export function PettyCash() {
  const tin = usePettyCash()
  const where = useNodeIdentity()
  const people = useShopPeople()
  const [page, setPage] = useState<Page>({ at: "book" })
  const [said, setSaid] = useState<string | null>(null)

  const now = new Date()
  const book = useBook(isoDay(bookFrom(now)), isoDay(now))
  const site = siteCodeOf(where.data)
  const vouchers = useMemo(
    () => (book.data === undefined ? [] : vouchersOf(book.data, site)),
    [book.data, site],
  )

  // A page opens at its own top, whatever the one before was scrolled to. The
  // scroller is the `Screen` around this one; asked for by its class because a
  // screen has no handle on its own frame.
  const frame = useRef<HTMLDivElement>(null)
  useEffect(() => {
    frame.current?.closest(".overflow-y-auto")?.scrollTo({ top: 0 })
  }, [page])

  const start = (kind: VoucherKind) => {
    setSaid(null)
    setPage({ at: "new", kind })
  }
  const back = () => {
    setSaid(null)
    setPage({ at: "book" })
  }

  return (
    <Screen
      header={page.at === "book"}
      actions={
        tin.data === undefined ? undefined : (
          <>
            <Button onClick={() => start("BKM")}>New BKM</Button>
            <Button variant="primary" onClick={() => start("BKK")}>
              New BKK
            </Button>
          </>
        )
      }
    >
      <div ref={frame}>
        {queryState(tin, {
          loading: "Reading the petty cash…",
          render: (position) => {
            if (page.at === "new")
              return (
                <VoucherForm
                  // A fresh form for every page: nothing typed into the last
                  // one, no key from its lines.
                  key={page.kind}
                  kind={page.kind}
                  position={position}
                  no={nextNo(vouchers, page.kind, site, new Date())}
                  onBack={back}
                  onSaved={(id, text) => {
                    setSaid(text)
                    setPage({ at: "voucher", id })
                  }}
                />
              )
            if (page.at === "voucher") {
              const voucher = vouchers.find((one) => one.id === page.id)
              if (voucher === undefined)
                return (
                  <div>
                    <BackLink onClick={back}>Petty cash</BackLink>
                    {book.isFetching ? (
                      <LoadingState>Reading the voucher…</LoadingState>
                    ) : (
                      <EmptyState art={null}>
                        That voucher is not in the book.
                      </EmptyState>
                    )}
                  </div>
                )
              return (
                <VoucherView
                  voucher={voucher}
                  shop={
                    where.data?.site_name ?? where.data?.site_code ?? "Store"
                  }
                  people={people}
                  said={said}
                  onDismiss={() => setSaid(null)}
                  onBack={back}
                />
              )
            }
            return (
              <Passbook
                position={position}
                book={book}
                vouchers={vouchers}
                onOpen={(voucher) => {
                  setSaid(null)
                  setPage({ at: "voucher", id: voucher.id })
                }}
                onNew={start}
              />
            )
          },
        })}
      </div>
    </Screen>
  )
}

/// The tin's figures, then the passbook.
function Passbook({
  position,
  book,
  vouchers,
  onOpen,
  onNew,
}: {
  position: PettyCashPosition
  book: ReturnType<typeof useBook>
  vouchers: readonly Voucher[]
  onOpen: (voucher: Voucher) => void
  onNew: (kind: VoucherKind) => void
}) {
  const month = monthOf(vouchers, new Date())
  const rows = bookOf(vouchers, position.balance_minor)
  const words = (count: number) =>
    count === 0
      ? `None in ${month.name}`
      : `${units(count)} ${count === 1 ? "voucher" : "vouchers"} in ${month.name}`

  return (
    <>
      <DockTools
        actions={[{ label: "New BKM", onClick: () => onNew("BKM") }]}
      />
      <Fab label="New BKK" onClick={() => onNew("BKK")} />

      <KpiStrip>
        <Kpi
          label="Balance"
          value={money(position.balance_minor)}
          delta={
            position.balance_minor <= 0
              ? "Empty"
              : position.last_top_up_at === null
                ? undefined
                : `Topped up ${day(position.last_top_up_at)}`
          }
          tone={position.balance_minor <= 0 ? "down" : "flat"}
        />
        <Kpi
          label="Debit · BKM"
          value={money(month.into.minor)}
          delta={words(month.into.count)}
        />
        <Kpi
          label="Credit · BKK"
          value={money(month.out.minor)}
          delta={words(month.out.count)}
        />
      </KpiStrip>

      {queryState(book, {
        loading: "Reading the book…",
        render: (page) => (
          <>
            <div className="max-md:hidden">
              <Statement
                rows={rows}
                balanceNow={position.balance_minor}
                onOpen={onOpen}
              />
            </div>
            <div className="md:hidden">
              <Rows
                rows={rows}
                columns={COLUMNS}
                rowKey={(row) => row.voucher.id}
                empty="No BKM or BKK yet."
                onOpen={(row) => onOpen(row.voucher)}
                card={({ voucher }) => ({
                  title: forOf(voucher),
                  code: voucher.no,
                  lines: [
                    voucher.party === ""
                      ? voucher.lines[0].word
                      : `${voucher.lines[0].word} · ${voucher.party}`,
                  ],
                  lead: {
                    figure: (
                      <span
                        className={cn(voucher.kind === "BKM" && "text-ok-fg")}
                      >
                        {signed(effectOf(voucher))}
                      </span>
                    ),
                    caption: day(voucher.at),
                  },
                  foot:
                    voucher.kind === "BKK"
                      ? {
                          info: clock(voucher.at),
                          status: <NoNota id={voucher.id} />,
                        }
                      : { info: clock(voucher.at) },
                })}
                foot={
                  page.next_cursor === null ? undefined : (
                    <p className="border-t border-hairline px-4 py-2.5 text-meta text-body max-md:mt-3 max-md:border-t-0 max-md:px-1">
                      Showing the latest {units(vouchers.length)} vouchers.
                    </p>
                  )
                }
              />
            </div>
          </>
        ),
      })}
    </>
  )
}

/// The book read like a bank statement, on a desk: oldest first, the opening
/// balance on top, the balance after every voucher, the closing balance at the
/// foot. The same vouchers as the cards a phone gets.
function Statement({
  rows,
  balanceNow,
  onOpen,
}: {
  rows: readonly BookRow[]
  balanceNow: number
  onOpen: (voucher: Voucher) => void
}) {
  if (rows.length === 0)
    return <EmptyState art={null}>No BKM or BKK yet.</EmptyState>
  const oldest = [...rows].reverse()
  const opening = oldest[0].balanceMinor - effectOf(oldest[0].voucher)
  const edge = (when: string, words: string, balance: number) => (
    <tr className="bg-soft">
      <td className={cn(TD, "font-medium")}>{day(when)}</td>
      <td className={cn(TD, "font-medium")}>{words}</td>
      <td className={TD} />
      <td className={TD} />
      <td className={TD} />
      <td className={cn(TD, "text-right font-medium")}>{money(balance)}</td>
    </tr>
  )
  return (
    <div className={BOX}>
      <table className="w-full table-auto border-collapse">
        <thead>
          <tr>
            <th className={TH}>Date</th>
            <th className={TH}>Description</th>
            <th className={TH}>Voucher</th>
            <th className={cn(TH, "text-right")}>Debit</th>
            <th className={cn(TH, "text-right")}>Credit</th>
            <th className={cn(TH, "text-right")}>Balance</th>
          </tr>
        </thead>
        <tbody>
          {edge(oldest[0].voucher.at, "Opening Balance", opening)}
          {oldest.map(({ voucher, balanceMinor }) => (
            <tr
              key={voucher.id}
              tabIndex={0}
              onClick={() => onOpen(voucher)}
              onKeyDown={(event) => {
                if (event.key === "Enter") onOpen(voucher)
              }}
              className="cursor-pointer hover:bg-soft"
            >
              <td className={TD}>{day(voucher.at)}</td>
              <td className={TD}>{forOf(voucher)}</td>
              <td className={cn(TD, "text-mute")}>{voucher.no}</td>
              <td className={cn(TD, "text-right")}>
                {voucher.kind === "BKM" ? money(voucher.totalMinor) : null}
              </td>
              <td className={cn(TD, "text-right")}>
                {voucher.kind === "BKK" ? money(voucher.totalMinor) : null}
              </td>
              <td className={cn(TD, "text-right")}>{money(balanceMinor)}</td>
            </tr>
          ))}
          {edge(
            oldest[oldest.length - 1].voucher.at,
            "Closing Balance",
            balanceNow,
          )}
        </tbody>
      </table>
    </div>
  )
}

/// What a voucher is for, as the passbook says it: its first line, and how many
/// more it has.
function forOf(voucher: Voucher): React.ReactNode {
  const first = voucher.lines[0].note
  return voucher.lines.length > 1 ? (
    <>
      {first} <span className="text-mute">+{voucher.lines.length - 1}</span>
    </>
  ) : (
    first
  )
}

function clock(iso: string): string {
  return dateText(new Date(iso), { hour: "2-digit", minute: "2-digit" })
}

/// The warning on a BKK whose nota this device holds no photo of.
function NoNota({ id }: { id: string }) {
  const nota = useNota(id)
  if (nota.isPending || (nota.data !== null && nota.data !== undefined))
    return null
  return <Status tone="warn">No photo</Status>
}

const COLUMNS: readonly ListColumn<BookRow>[] = [
  {
    id: "date",
    header: "Date",
    className: "w-[8.5rem]",
    cell: ({ voucher }) => (
      <OpenButton id={voucher.id} className="tabular-nums">
        <span className="block">{day(voucher.at)}</span>
        <span className="block text-meta text-mute">{clock(voucher.at)}</span>
      </OpenButton>
    ),
  },
  {
    id: "voucher",
    header: "Voucher",
    className: "max-w-[22rem]",
    cell: ({ voucher }) => (
      <span className="block min-w-0">
        <span className="block truncate font-medium text-ink">
          {forOf(voucher)}
        </span>
        <span className="block truncate text-meta text-mute">
          <span className="font-mono text-id">{voucher.no}</span>
          {voucher.party !== "" && ` · ${voucher.party}`}
        </span>
      </span>
    ),
  },
  {
    id: "receipt",
    header: "Receipt",
    cell: ({ voucher }) =>
      voucher.kind === "BKK" ? <NotaThumb id={voucher.id} /> : null,
  },
  {
    id: "debit",
    header: "Debit",
    align: "right",
    cell: ({ voucher }) =>
      voucher.kind === "BKM" ? (
        <span className="font-medium text-ok-fg tabular-nums">
          {money(voucher.totalMinor)}
        </span>
      ) : null,
  },
  {
    id: "credit",
    header: "Credit",
    align: "right",
    cell: ({ voucher }) =>
      voucher.kind === "BKK" ? (
        <span className="font-medium text-ink tabular-nums">
          {money(voucher.totalMinor)}
        </span>
      ) : null,
  },
  {
    id: "balance",
    header: "Balance",
    align: "right",
    className: "text-mute tabular-nums max-lg:hidden",
    cell: ({ balanceMinor }) => money(balanceMinor),
  },
]
