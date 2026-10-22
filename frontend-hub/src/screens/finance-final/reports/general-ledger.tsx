import { useInfiniteQuery, useQueries, useQuery } from "@tanstack/react-query"
import { Suspense, useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { ExportButton } from "@/components/ui/export-button"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { CellMoney } from "@/components/ui/rows-switch"
import { EmptyState, LoadMore } from "@/components/ui/states"
import { fileSafe, monthStamp, type ExportSheet } from "@/lib/export-xlsx"
import { count, day, label, money } from "@/lib/format"
import {
  accountDetail,
  accountLedger,
  financeKeys,
  journalEntry,
} from "@/lib/queries/finance"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"
import {
  Code,
  DebitCredit,
  Grid,
  Td,
  Th,
  TotalRow,
} from "@/screens/finance-final/parts"
import { useSettledWindow, useUnitName } from "@/screens/finance/hooks"
import {
  AccountPicker,
  SupplierName,
  UnitName,
  UnitSelect,
  WindowControl,
} from "@/screens/finance/parts"
import { ReportFilters } from "@/screens/finance/report"
import { ScreenPending } from "@/screens/finance/pending"
import type { JournalEntryDetail } from "@itulah/contract"

/// Every posting against one account, at one unit, between two dates.
///
/// ERPNext's most-opened report, and the shape is theirs: an opening balance,
/// the movements in the order they happened, a closing balance, and a foot
/// that says what moved each way. Their column set is followed as far as our
/// wire can fill it — see the note at the bottom of the screen, which names
/// the three cells it cannot and says what is done instead.
///
/// # Why the unit is a control and not a column you squint at
///
/// The older screen at `screens/finance/general-ledger.tsx` has a location
/// select too, sitting fourth in a toolbar after a date range, and it reads as
/// a refinement of an answer that has already been given. It is not one. The
/// client's legacy chart carries the unit INSIDE the account code — fourteen
/// copies of `Cash on Hand` — so "cash at Cikupa" was a different account, not
/// a filtered view of a wider one, and everybody who has used their old system
/// thinks of it that way.
///
/// Here `unit` is a dimension on the ledger row, and the server narrows the
/// OPENING BALANCE with it as well as the movements. So choosing a unit does
/// not filter this report; it changes which ledger is being read. That is why
/// the unit sits in the first row of controls beside the account, why the
/// units the account actually moved at are drawn as a strip you can press, and
/// why the header says which ledger you are looking at in words.
///
/// # Why a heading is a legal thing to ask for
///
/// Matching is by code prefix, so `1011001` is CASH ON HAND across every
/// location and `10110` is the whole of KAS & SETARA KAS. The reader picks the
/// altitude. The cost is stated where it bites: under a heading the rows come
/// from several accounts and the wire does not say which, so the Account
/// column is honest about not knowing until a row is opened.
///
/// # Why nothing here sorts
///
/// `running_minor` is a window function over posting order. Re-order the rows
/// and every balance on screen is one that was never true at that moment. A
/// ledger is read down the page.
export function GeneralLedger() {
  return (
    <Suspense
      fallback={
        <ScreenPending
          crumb="Finance · Financial Reports"
          title="General Ledger"
        >
          Opening the ledger…
        </ScreenPending>
      }
    >
      <GeneralLedgerScreen />
    </Suspense>
  )
}

function GeneralLedgerScreen() {
  // The account is in the URL, so "cash at Store 07 in August" is a link
  // somebody can send rather than a set of instructions. The same key the
  // chart and the older ledger open with, so a link works from either side.
  const account = useSheet("account")
  const code = account.value ?? null
  const [unit, setUnit] = useState("")
  const [picking, setPicking] = useState(false)
  const range = useSettledWindow()
  // Which vouchers the reader has opened. A set rather than one id: opening
  // three rows of the same entry costs one request, and every row that shares
  // it fills in at once.
  const [opened, setOpened] = useState<readonly string[]>([])

  // What kind of account this is, and the headings above it. One small request
  // behind the same key the chart uses, and it earns its place twice: the path
  // makes a twelve-digit code readable, and `is_group` is the only honest way
  // to know whether the rows below come from one account or from many.
  const detail = useQuery({
    queryKey: financeKeys.account(code ?? "", null),
    queryFn: ({ signal }) => accountDetail(code ?? "", {}, signal),
    enabled: code !== null,
    staleTime: 60_000,
  })

  const ledger = useInfiniteQuery({
    queryKey: [
      ...financeKeys.ledger(code ?? "", unit || null, range.from, range.to),
      "pages",
    ],
    queryFn: ({ pageParam, signal }) =>
      accountLedger(
        code ?? "",
        {
          unit: unit || undefined,
          from: range.from,
          to: range.to,
          // A step, not a ceiling: the ledger scrolls on. Paging cannot leave
          // the running balance stepping over a gap — `running_minor` is the
          // server's window function over the whole window, and the pages
          // arrive in order, so every drawn balance is the one that was true
          // after that movement.
          limit: 200,
          cursor: pageParam,
        },
        signal
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    placeholderData: (previous) => previous,
    enabled: code !== null,
  })
  const head = ledger.data?.pages[0]

  // Every voucher the reader has opened, fetched once each and held under the
  // Journal's own key — so a row opened here is already in hand on the Journals
  // screen, and the two can never disagree about what an entry contains.
  const vouchers = useQueries({
    queries: opened.map((id) => ({
      queryKey: financeKeys.entry(id),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        journalEntry(id, signal),
      staleTime: 60_000,
    })),
  })

  const byEntry = useMemo(() => {
    const table = new Map<string, JournalEntryDetail>()
    for (const voucher of vouchers) {
      if (voucher.data !== undefined) {
        table.set(voucher.data.entry.entry_id, voucher.data)
      }
    }
    return table
  }, [vouchers])

  const isGroup = detail.data?.account.is_group ?? false
  const unitName = useUnitName()

  /// The ledger as loaded on screen — opening balance, every posting drawn so
  /// far, the window's foot. "Against & party" is left out: it exists only for
  /// the vouchers a reader has opened.
  const build = (): ExportSheet | null => {
    if (head === undefined) return null
    const rows = (ledger.data?.pages ?? []).flatMap((page) => page.rows)
    return {
      filename: `General-Ledger-${fileSafe(head.account_code)}-${monthStamp(head.to)}`,
      sheet: "General Ledger",
      title: `General Ledger · ${head.account_code} ${head.account_name}`,
      subtitle: `${day(head.from)} – ${day(head.to)} · ${
        head.unit_id === null ? "all units" : unitName(head.unit_id)
      }`,
      columns: [
        { header: "Date", kind: "date" },
        { header: "Voucher", kind: "text", width: 20 },
        { header: "Memo", kind: "text", width: 32 },
        { header: "Type", kind: "text", width: 16 },
        { header: "Account", kind: "text", width: 14 },
        { header: "Category", kind: "text", width: 22 },
        { header: "Unit", kind: "text", width: 22 },
        { header: "Debit", kind: "money" },
        { header: "Credit", kind: "money" },
        { header: "Balance", kind: "money" },
      ],
      rows: [
        [
          head.from,
          "Opening balance",
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          head.opening_minor,
        ],
        ...rows.map((row) => [
          row.posting_date,
          row.entry_number,
          row.memo,
          label(row.source_kind),
          isGroup ? null : head.account_code,
          row.category_name,
          unitName(row.unit_id),
          row.debit_minor === 0 ? null : row.debit_minor,
          row.credit_minor === 0 ? null : row.credit_minor,
          row.running_minor,
        ]),
      ],
      rowStyles: [{ bold: true }],
      totalRow: [
        null,
        "Total for the window",
        null,
        null,
        null,
        null,
        null,
        head.window_debit_minor,
        head.window_credit_minor,
        head.closing_minor,
      ],
    }
  }

  return (
    <PageContent>
      <PageHeader
        crumb="Finance · Financial Reports"
        title="General Ledger"
        actions={
          code !== null && (
            <>
              <ExportButton build={build} disabled={head === undefined} />
              <Button
                variant="ghost"
                onClick={() => {
                  setPicking((was) => !was)
                  setOpened([])
                }}
              >
                {picking ? "Keep this account" : "Change account"}
              </Button>
            </>
          )
        }
      />

      <ReportFilters
        note={
          head && (
            <>
              {day(head.from)} – {day(head.to)} ·{" "}
              {head.unit_id === null ? (
                "all units"
              ) : (
                <UnitName id={head.unit_id} />
              )}
            </>
          )
        }
      >
        {/* The account is a filter like the unit and the window, as in
            ERPNext's General Ledger — not a box of its own above the report. */}
        {(code === null || picking) && (
          <div className="w-80">
            <AccountPicker
              floating
              allowGroups
              seed={code ?? ""}
              onPick={(picked) => {
                account.open(picked.account_code)
                setPicking(false)
                setOpened([])
              }}
            />
          </div>
        )}
        <UnitSelect
          value={unit}
          onChange={setUnit}
          className="h-control w-44"
          aria-label="Unit"
        />
        <WindowControl range={range} />
      </ReportFilters>

      {code === null ? (
        <EmptyState>Choose an account to read its ledger.</EmptyState>
      ) : (
        queryState(ledger, {
          loading: "Reading every posting in the window…",
          render: (pages) => {
            // The figures and the facets are the window's and ride on every
            // page alike; the first page's are the ones drawn.
            const data = pages.pages[0]
            const rows = pages.pages.flatMap((page) => page.rows)
            return (
              <div className="flex flex-col gap-4">
                <div>
                  <h2 className="text-card-title font-semibold text-ink">
                    {data.account_name}
                  </h2>
                  <p className="mt-0.5 text-[0.9375rem] text-mute">
                    <Code>{data.account_code}</Code>
                    {detail.data && detail.data.path.length > 0 && (
                      <>
                        {" · "}
                        {detail.data.path.map((step) => step.name).join(" › ")}
                      </>
                    )}
                    {isGroup && " · heading"}
                  </p>
                </div>

                {/* Which units this account moved at, and how often. With no unit
                  chosen this is the chooser — it is the only list anywhere that
                  says where an account is actually live, as against the
                  fourteen it could be. Narrowed, the server sends the one and
                  it becomes the caption for a window already narrowed, which is
                  what the contract says it is for. */}
                {data.facets.units.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="mr-0.5 text-[0.9375rem] text-mute">
                      Moved in
                    </span>
                    {data.facets.units.map((one) => (
                      <button
                        key={one.value}
                        type="button"
                        onClick={() => setUnit(one.value)}
                        disabled={unit === one.value}
                        className="disabled:cursor-default"
                      >
                        <Pill tone={unit === one.value ? "accent" : "neutral"}>
                          <UnitName id={one.value} /> · {count(one.count)}
                        </Pill>
                      </button>
                    ))}
                    {unit !== "" && (
                      <Button
                        variant="quiet"
                        size="sm"
                        onClick={() => setUnit("")}
                      >
                        All units
                      </Button>
                    )}
                  </div>
                )}

                {rows.length === 0 ? (
                  <EmptyState>
                    Nothing moved in this account between {day(data.from)} and{" "}
                    {day(data.to)}
                    {data.unit_id === null ? ", in any unit" : ""}. The opening
                    balance above is still what it held.
                  </EmptyState>
                ) : (
                  <Grid followRows giveUp={[4, 3, 5]}>
                    <thead>
                      <tr>
                        <Th width="6.5rem">Date</Th>
                        <Th width="12rem">Voucher</Th>
                        <Th width="8rem">Type</Th>
                        <Th width="9rem">Account</Th>
                        {/* The column the forty-account chart makes necessary.
                          `6301` holds 560 of the client's old leaves, so a
                          ledger of it without this is one name printed a
                          hundred times. Drawn always and not only when the
                          account declares a family: a ledger read under a
                          heading mixes accounts that do and accounts that do
                          not, and a column that came and went with the
                          narrowing would be worse than one that is sometimes
                          quiet. */}
                        <Th width="11rem">Category</Th>
                        <Th width="8rem">Unit</Th>
                        <Th>Against &amp; party</Th>
                        <Th align="right" width="9rem">
                          Debit
                        </Th>
                        <Th align="right" width="9rem">
                          Credit
                        </Th>
                        <Th align="right" width="10rem">
                          Balance
                        </Th>
                      </tr>
                    </thead>
                    <tbody>
                      {/* ERPNext prints the opening as the first row of the table
                        and so does this. Drawn even at zero: without it the
                        first running figure is a movement wearing a balance's
                        clothes. */}
                      <tr className="bg-soft">
                        <Td>{day(data.from)}</Td>
                        <Td className="font-medium text-ink">
                          Opening balance
                        </Td>
                        <Td />
                        <Td />
                        <Td />
                        <Td />
                        <Td />
                        <Td />
                        <Td />
                        <Td align="right" className="font-medium text-ink">
                          <CellMoney minor={data.opening_minor} />
                        </Td>
                      </tr>

                      {rows.map((row) => {
                        const voucher = byEntry.get(row.entry_id)
                        const isOpen = opened.includes(row.entry_id)
                        return [
                          <tr key={row.line_id}>
                            <Td>{day(row.posting_date)}</Td>
                            <Td>
                              <button
                                type="button"
                                onClick={() =>
                                  setOpened((was) =>
                                    was.includes(row.entry_id)
                                      ? was.filter((id) => id !== row.entry_id)
                                      : [...was, row.entry_id]
                                  )
                                }
                                className="font-mono text-[0.9375rem] text-accent hover:underline"
                              >
                                {row.entry_number}
                              </button>
                              {row.memo !== null && row.memo !== "" && (
                                <span className="block text-[0.9375rem] text-mute">
                                  {row.memo}
                                </span>
                              )}
                              {/* Only ever true on an account a statement was
                                imported against, so it is drawn only when true:
                                on a sales entry "not agreed" is the ordinary
                                state and a column of empty marks would read as
                                a backlog. */}
                              {row.reconciled && (
                                <Pill tone="ok" className="mt-1">
                                  agreed with the bank
                                </Pill>
                              )}
                            </Td>
                            <Td className="text-body">
                              {label(row.source_kind)}
                            </Td>
                            <Td>
                              {/* The wire does not carry the row's own account.
                                Under a leaf every row is the account in the
                                header, and saying so is not a guess. Under a
                                heading it is one of several and nothing on the
                                row says which — so this is an em dash until the
                                voucher is opened, and then it is the truth. */}
                              {voucher !== undefined ? (
                                <AgainstAccounts
                                  voucher={voucher}
                                  lineUnit={row.unit_id}
                                  debit={row.debit_minor}
                                  credit={row.credit_minor}
                                  want="own"
                                />
                              ) : isGroup ? (
                                <span
                                  className="text-faint"
                                  title="This ledger is a heading, so these movements come from several accounts under it and the row does not say which. Open the voucher to see."
                                >
                                  —
                                </span>
                              ) : (
                                <Code>{data.account_code}</Code>
                              )}
                            </Td>
                            <Td>
                              {row.category_name === null ? (
                                <span
                                  className="text-faint"
                                  title="This account takes no category — its detail is the bank account, asset, supplier or facility the line names."
                                >
                                  —
                                </span>
                              ) : (
                                <span
                                  className="text-body"
                                  title={row.category_code ?? undefined}
                                >
                                  {row.category_name}
                                </span>
                              )}
                            </Td>
                            <Td>
                              <UnitName
                                id={row.unit_id}
                                className="text-body"
                              />
                              {/* Who the balance is with, on an affiliate leg. */}
                              {row.counter_unit_id !== null && (
                                <span className="block text-[0.9375rem] text-mute">
                                  with <UnitName id={row.counter_unit_id} />
                                </span>
                              )}
                            </Td>
                            <Td>
                              {voucher === undefined ? (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setOpened((was) => [...was, row.entry_id])
                                  }
                                  className="text-[0.9375rem] text-accent hover:underline"
                                >
                                  Show
                                </button>
                              ) : (
                                <AgainstAccounts
                                  voucher={voucher}
                                  lineUnit={row.unit_id}
                                  debit={row.debit_minor}
                                  credit={row.credit_minor}
                                  want="against"
                                />
                              )}
                            </Td>
                            <DebitCredit
                              debit={row.debit_minor}
                              credit={row.credit_minor}
                              followRows
                            />
                            <Td
                              align="right"
                              className={
                                row.running_minor < 0
                                  ? "font-medium text-bad-fg"
                                  : "font-medium text-ink"
                              }
                            >
                              <CellMoney minor={row.running_minor} />
                            </Td>
                          </tr>,
                          isOpen && voucher !== undefined ? (
                            <tr key={`${row.line_id}-voucher`} data-sub>
                              <Td />
                              <td
                                colSpan={9}
                                className="border-b border-hairline px-2 pt-0 pb-3"
                              >
                                <Voucher voucher={voucher} />
                              </td>
                            </tr>
                          ) : null,
                        ]
                      })}

                      {/* ERPNext's foot: what moved each way, and where the window
                        ended. The server's window figures, which do not move
                        when the list does. */}
                      <TotalRow>
                        <Td />
                        <Td>Total for the window</Td>
                        <Td />
                        <Td />
                        <Td />
                        <Td />
                        <Td />
                        <Td align="right">{money(data.window_debit_minor)}</Td>
                        <Td align="right">{money(data.window_credit_minor)}</Td>
                        <Td align="right">{money(data.closing_minor)}</Td>
                      </TotalRow>
                    </tbody>
                  </Grid>
                )}
                <LoadMore query={ledger} />
              </div>
            )
          },
        })
      )}
    </PageContent>
  )
}

/// The other side of an entry, named from the voucher rather than guessed.
///
/// ERPNext computes "against" exactly this way: the accounts on the OPPOSITE
/// side of the same voucher. A receipt that pays three invoices has three
/// against-accounts and they are all worth printing — collapsing them to the
/// first one is how a ledger comes to look like it settled a quarter of what it
/// settled.
///
/// `want="own"` answers a different question with the same data: which of the
/// voucher's lines IS this row. Matched on unit and amount, because a line id
/// is not carried on `JournalLineView` — see the note on the screen. An entry
/// that touches one account twice at one unit for the same amount would match
/// both, which is why this prints every match rather than picking one.
function AgainstAccounts({
  voucher,
  lineUnit,
  debit,
  credit,
  want,
}: {
  voucher: JournalEntryDetail
  lineUnit: string
  debit: number
  credit: number
  want: "own" | "against"
}) {
  const mine = voucher.lines.filter(
    (line) =>
      line.unit_id === lineUnit &&
      line.debit_minor === debit &&
      line.credit_minor === credit
  )

  if (want === "own") {
    const codes = [...new Set(mine.map((line) => line.account_code))]
    if (codes.length === 0) return <span className="text-faint">—</span>
    return (
      <>
        {codes.map((one) => (
          <Code key={one}>{one}</Code>
        ))}
      </>
    )
  }

  // Debits face credits. A line with neither — it cannot happen, the database
  // refuses it — would face nothing, which is the honest answer for it.
  const opposite = voucher.lines.filter((line) =>
    debit > 0 ? line.credit_minor > 0 : line.debit_minor > 0
  )
  const party =
    mine.find(
      (line) => line.party_type === "SUPPLIER" && line.party_id !== null
    )?.party_id ?? null

  if (opposite.length === 0 && party === null) {
    return <span className="text-faint">—</span>
  }

  return (
    <span className="flex flex-col gap-0.5">
      {opposite.length > 0 && (
        <span className="text-body">
          {opposite
            .map((line) => line.account_name)
            .filter((name, index, all) => all.indexOf(name) === index)
            .join(", ")}
        </span>
      )}
      {party !== null && (
        <SupplierName id={party} className="text-[0.9375rem] text-mute" />
      )}
    </span>
  )
}

/// One voucher, whole, under the row that led to it.
///
/// Not a link to another screen: the reader is checking that this posting says
/// what they think it says, and the answer is four lines long. Sending them to
/// the Journal to read four lines and come back is the kind of navigation that
/// makes a report feel like a filing cabinet.
function Voucher({ voucher }: { voucher: JournalEntryDetail }) {
  return (
    <div className="rounded-inner border border-hairline bg-soft p-2.5">
      <div className="mb-1.5 flex flex-wrap items-center gap-2 text-[0.9375rem]">
        <span className="font-medium text-ink">
          {voucher.entry.entry_number}
        </span>
        <span className="text-mute">{day(voucher.entry.posting_date)}</span>
        <Pill>{label(voucher.entry.source_kind)}</Pill>
        {voucher.entry.reversal_of !== null && (
          <Pill tone="warn">reverses another entry</Pill>
        )}
        {voucher.entry.reversed_by !== null && (
          <Pill tone="bad">has been reversed</Pill>
        )}
        <span className="text-mute">posted by {voucher.entry.posted_by}</span>
      </div>
      <Grid>
        <thead>
          <tr>
            <Th width="9rem">Account</Th>
            <Th>Name</Th>
            <Th width="8rem">Unit</Th>
            <Th width="10rem">Party</Th>
            <Th align="right" width="9rem">
              Debit
            </Th>
            <Th align="right" width="9rem">
              Credit
            </Th>
          </tr>
        </thead>
        <tbody>
          {voucher.lines.map((line) => (
            <tr key={line.line_number}>
              <Td>
                <Code>{line.account_code}</Code>
              </Td>
              <Td className="text-ink">
                {line.account_name}
                {line.memo !== null && line.memo !== "" && (
                  <span className="block text-[0.9375rem] text-mute">
                    {line.memo}
                  </span>
                )}
              </Td>
              <Td>
                <UnitName id={line.unit_id} className="text-body" />
              </Td>
              <Td>
                {line.party_type === "SUPPLIER" && line.party_id !== null ? (
                  <SupplierName id={line.party_id} className="text-body" />
                ) : (
                  <span className="text-faint">—</span>
                )}
              </Td>
              <DebitCredit
                debit={line.debit_minor}
                credit={line.credit_minor}
              />
            </tr>
          ))}
          <TotalRow>
            <Td />
            <Td>{count(voucher.entry.line_count)} lines</Td>
            <Td />
            <Td />
            <Td align="right">{money(voucher.entry.total_minor)}</Td>
            <Td align="right">{money(voucher.entry.total_minor)}</Td>
          </TotalRow>
        </tbody>
      </Grid>
    </div>
  )
}
