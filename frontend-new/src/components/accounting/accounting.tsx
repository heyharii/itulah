/*
 * Accounting — one sidebar over cloud-hub's general ledger.
 *
 * Four screens: the chart of accounts, the journal, the balance sheet and the
 * periods. Every number is read from `/api/v1/accounting/*`; nothing is
 * estimated, and where the ledger has nothing to show the screen says so
 * rather than hiding the table.
 *
 * One structural fact drives the whole shell: this backend reports on DATE
 * RANGES, not on period ids. `/general-ledger`, `/reports/trial-balance` and
 * `/reports/balance-sheet` all take dates and none of them accepts a period.
 * So the period picker is translated here into the window it stands for, and
 * "All periods" means the span of every fiscal year the hub publishes.
 */

import { Link } from "@tanstack/react-router"
import { useMemo, useState } from "react"

import { Icon, paths } from "@/components/dashboard/parts"
import { IconButton, Switch } from "@/components/dashboard/nav-sidebar"
import { SheetShell, sheetButton } from "@/components/dashboard/sheet-shell"
import { AppHeading } from "@/components/app-switcher"
import {
  ROOT_LABEL,
  money,
  moneyOrDash,
  trialBalanceOf,
  useBalanceSheet,
  useClosePeriod,
  useJournal,
  useLedgerAccount,
  useLedgerReference,
  useTrialBalance,
  type DateRange,
  type LedgerPeriod,
} from "@/components/accounting/api"
import { ChartOfAccounts } from "@/components/accounting/chart"
import { JournalTable } from "@/components/accounting/journal"
import { BalanceSheetView } from "@/components/accounting/balance-sheet"
import { PeriodsTable } from "@/components/accounting/periods"
import { Field, ReadState, num } from "@/components/accounting/parts"
import {
  cue,
  readSoundPreference,
  useInteractionSounds,
  writeSoundPreference,
} from "@/components/dashboard/use-interaction-sounds"
import { getErrorMessage } from "@/lib/api"
import { cn } from "@/lib/utils"
import { Route } from "@/routes/accounting"
import {
  AppShell,
  AppShellSidebar,
  SidebarTrigger,
} from "@/components/app-shell"

type Tab = "chart" | "journal" | "balance" | "periods"

const TAB_LABEL: Record<Tab, string> = {
  chart: "Chart of accounts",
  journal: "Journal",
  balance: "Balance sheet",
  periods: "Periods",
}

const selectClass =
  "h-[28px] rounded-control bg-surface px-2 text-[11.5px] text-ink shadow-btn outline-none transition-colors hover:bg-hover"

export function Accounting() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const { tab, accountCode, periodId } = search

  /* Every filter change is a replace — it re-aims the same screen rather than
   * stacking a new destination on the history. */
  const setSearch = (next: Partial<typeof search>) =>
    void navigate({ search: (prev) => ({ ...prev, ...next }), replace: true })

  const [confirmClose, setConfirmClose] = useState<LedgerPeriod | null>(null)
  const [closeBusy, setCloseBusy] = useState<string | null>(null)
  const [closeError, setCloseError] = useState<string | null>(null)
  const [closedLocally, setClosedLocally] = useState<string[]>([])
  const [railHidden, setRailHidden] = useState(false)
  const [soundOn, setSoundOn] = useState(readSoundPreference)

  useInteractionSounds(soundOn)

  const reference = useLedgerReference()

  const accounts = useMemo(
    () => reference.data?.accounts ?? [],
    [reference.data?.accounts]
  )
  const fiscalYears = useMemo(
    () => reference.data?.fiscalYears ?? [],
    [reference.data?.fiscalYears]
  )
  const periods = useMemo(() => {
    const rows = reference.data?.periods ?? []
    // A period closed in this session before the reference reloads.
    return rows.map((period) =>
      closedLocally.includes(period.id)
        ? { ...period, status: "closed" as const }
        : period
    )
  }, [reference.data?.periods, closedLocally])

  /* The URL names the account by code; the general-ledger route wants the
   * uuid, so the chart of accounts is what translates between them. */
  const selectedAccount = useLedgerAccount(accounts, accountCode)
  const openAccount = useLedgerAccount(accounts, search.openAccount)
  const accountId = selectedAccount?.id ?? null

  const selectedPeriod =
    periods.find((period) => period.id === periodId) ?? null

  /* The reporting window. A selected period contributes its own start and end
   * dates; otherwise the whole published fiscal calendar is the window. Until
   * the reference lands there is no window at all, and the reports stay idle
   * rather than being fired at a guessed range. */
  const range: DateRange | null = useMemo(() => {
    if (selectedPeriod && selectedPeriod.startsOn && selectedPeriod.endsOn) {
      return { from: selectedPeriod.startsOn, to: selectedPeriod.endsOn }
    }
    return reference.data?.bookRange ?? null
  }, [selectedPeriod, reference.data?.bookRange])

  const asOf = range?.to ?? null

  const trialBalance = useTrialBalance(range)
  /* A code that has not been resolved yet would read as "no filter", which is
   * the wrong answer — so the journal waits for the chart to land. */
  const journal = useJournal(
    { accountId, range },
    Boolean(range) && (!accountCode || Boolean(selectedAccount))
  )
  const balanceSheet = useBalanceSheet(asOf)

  const balances = trialBalance.data?.rows ?? []
  const lines = journal.data ?? []
  const openPeriods = periods.filter(
    (period) => period.status === "open"
  ).length
  const closedPeriods = periods.length - openPeriods
  const periodLabel = selectedPeriod
    ? `${selectedPeriod.name} · ${selectedPeriod.startsOn} → ${selectedPeriod.endsOn}`
    : range
      ? `All periods · ${range.from} → ${range.to}`
      : "All periods"
  const close = useClosePeriod()

  const runClose = async () => {
    if (!confirmClose) return
    setCloseBusy(confirmClose.id)
    setCloseError(null)
    try {
      await close.execute({
        periodId: confirmClose.id,
        closedBy: "slowdown-web",
      })
      setClosedLocally((list) => [...list, confirmClose.id])
      cue("success")
      setConfirmClose(null)
    } catch (error: unknown) {
      setCloseError(getErrorMessage(error, "The period could not be closed."))
    } finally {
      setCloseBusy(null)
    }
  }

  const navRow =
    "flex h-8 w-full items-center gap-2.5 rounded-control px-2 text-left text-[13px] font-medium transition-colors duration-[110ms]"

  /* ── the body of whichever screen is selected ───────────────── */

  let body: React.ReactNode
  if (reference.isLoading && accounts.length === 0) {
    body = <ReadState variant="loading" message="Reading the ledger…" />
  } else if (reference.status === "error") {
    body = (
      <ReadState
        variant="error"
        message="The ledger could not be read."
        detail={reference.errorMessage}
        onRetry={reference.reload}
      />
    )
  } else if (tab === "chart") {
    body =
      accounts.length === 0 ? (
        <ReadState
          variant="empty"
          message="The chart of accounts is empty."
          detail="No account is registered on this hub."
        />
      ) : (
        <ChartOfAccounts
          accounts={accounts}
          balances={balances}
          balancesReady={trialBalance.status === "success"}
          onOpen={(account) =>
            void navigate({
              search: (prev) => ({ ...prev, openAccount: account.code }),
            })
          }
        />
      )
  } else if (tab === "journal") {
    if (journal.isLoading && lines.length === 0) {
      body = <ReadState variant="loading" message="Reading the journal…" />
    } else if (journal.status === "error") {
      body = (
        <ReadState
          variant="error"
          message="The journal could not be read."
          detail={journal.errorMessage}
          onRetry={journal.reload}
        />
      )
    } else if (lines.length === 0) {
      body = (
        <>
          <JournalTable lines={[]} perAccount={Boolean(accountId)} />
          <ReadState
            variant="empty"
            message="No lines are posted in this window."
            detail={
              accountId || selectedPeriod
                ? `The general ledger returned nothing for ${
                    selectedAccount
                      ? `account ${selectedAccount.code}`
                      : "every account"
                  } between ${range?.from ?? "—"} and ${range?.to ?? "—"}. Clear the filters to read the whole book.`
                : "The general ledger holds no posted lines across the published fiscal calendar. Journals are written by the business events that cause them, so lines appear here once purchasing, inventory or POS post their first transaction."
            }
          />
        </>
      )
    } else {
      body = <JournalTable lines={lines} perAccount={Boolean(accountId)} />
    }
  } else if (tab === "balance") {
    if (balanceSheet.isLoading && !balanceSheet.data) {
      body = (
        <ReadState variant="loading" message="Computing the balance sheet…" />
      )
    } else if (balanceSheet.status === "error" || !balanceSheet.data) {
      body = (
        <ReadState
          variant="error"
          message="The balance sheet could not be read."
          detail={balanceSheet.errorMessage}
          onRetry={balanceSheet.reload}
        />
      )
    } else {
      body = (
        <BalanceSheetView sheet={balanceSheet.data} periodLabel={periodLabel} />
      )
    }
  } else {
    body =
      periods.length === 0 ? (
        <ReadState
          variant="empty"
          message="No accounting periods exist."
          detail="The hub publishes no fiscal year, so there is no calendar to post into."
        />
      ) : (
        <PeriodsTable
          periods={periods}
          fiscalYears={fiscalYears}
          selectedId={periodId ?? null}
          busyId={closeBusy}
          onRequestClose={(period) => {
            setCloseError(null)
            setConfirmClose(period)
          }}
          onOpenJournal={(period) => {
            setSearch({ periodId: period.id, tab: "journal" })
          }}
        />
      )
  }

  const detailRow = openAccount
    ? balances.find((row) => row.accountCode === openAccount.code)
    : undefined
  const detailLines = openAccount
    ? lines.filter((line) => line.accountCode === openAccount.code).length
    : 0

  /* Periods, grouped for the picker exactly as the hub groups them: one
   * fiscal year at a time, because that is the only way it will list them. */
  const periodsByYear = useMemo(() => {
    const map = new Map<string, LedgerPeriod[]>()
    for (const period of periods) {
      const list = map.get(period.year) ?? []
      list.push(period)
      map.set(period.year, list)
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [periods])

  return (
    <AppShell
      label="Accounting navigation"
      railWidth={240}
      cols={
        railHidden
          ? "grid-cols-[0px_minmax(0,1fr)]"
          : "grid-cols-[240px_minmax(0,1fr)]"
      }
    >
      <AppShellSidebar className={cn(railHidden && "invisible")}>
        <aside className="flex h-full min-h-0 flex-col overflow-hidden bg-page">
          <div className="flex h-[52px] shrink-0 items-center gap-1.5 pr-2 pl-2.5">
            <AppHeading app="accounting" />
            <IconButton
              label="Collapse sidebar"
              onClick={() => setRailHidden((v) => !v)}
            >
              <Icon path={paths.panel} size={17} />
            </IconButton>
          </div>

          <nav className="flex-1 overflow-auto px-2 pt-0.5 pb-2">
            {(
              [
                ["chart", "Chart of accounts", paths.list, accounts.length],
                ["journal", "Journal", paths.doc, lines.length],
                ["balance", "Balance sheet", paths.chart, 0],
                ["periods", "Periods", paths.clock, openPeriods],
              ] as const
            ).map(([id, label, icon, count]) => {
              const on = tab === id
              return (
                <Link
                  key={id}
                  from="/accounting"
                  to="/accounting"
                  replace
                  data-sound="page"
                  search={(prev) => ({ ...prev, tab: id })}
                  className={cn(
                    navRow,
                    "group/nav relative text-ink-2 hover:bg-hover hover:text-ink",
                    on && "font-semibold text-ink",
                    on &&
                      "before:absolute before:top-2 before:bottom-2 before:-left-2 before:w-[2.5px] before:rounded-r-full before:bg-ink before:content-['']"
                  )}
                >
                  <Icon
                    path={icon}
                    className={cn(
                      "shrink-0 text-ink-4 group-hover/nav:text-ink-2",
                      on && "text-ink-2"
                    )}
                  />
                  <span className="truncate">{label}</span>
                  {count > 0 && (
                    <span className="ml-auto font-mono text-[10.5px] text-ink-4">
                      {count}
                    </span>
                  )}
                </Link>
              )
            })}

            <div className="mt-3.5 flex h-7 items-center px-2 text-[10.5px] font-semibold tracking-[0.05em] text-ink-4 uppercase">
              Filter
            </div>
            <div className="flex flex-col gap-1.5 px-2">
              <label className="flex flex-col gap-1">
                <span className="text-[10.5px] text-ink-4">Period</span>
                <select
                  value={periodId ?? ""}
                  onChange={(event) =>
                    setSearch({ periodId: event.target.value || undefined })
                  }
                  className={selectClass}
                >
                  <option value="">All periods</option>
                  {periodsByYear.map(([year, list]) => (
                    <optgroup key={year} label={year}>
                      {list.map((period) => (
                        <option key={period.id} value={period.id}>
                          {period.name}
                          {period.status === "closed" ? " · closed" : ""}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[10.5px] text-ink-4">Account</span>
                <select
                  value={accountId ?? ""}
                  onChange={(event) => {
                    const id = event.target.value
                    const account = accounts.find((row) => row.id === id)
                    setSearch({ accountCode: account?.code })
                  }}
                  className={selectClass}
                >
                  <option value="">All accounts</option>
                  {accounts
                    .filter((account) => !account.isGroup)
                    .map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.code} · {account.name}
                      </option>
                    ))}
                </select>
              </label>
              {(periodId || accountId) && (
                <button
                  type="button"
                  onClick={() => {
                    setSearch({ periodId: undefined, accountCode: undefined })
                  }}
                  className="h-[26px] rounded-control text-[11px] font-medium text-ink-3 transition-colors hover:bg-hover hover:text-ink"
                >
                  Clear filters
                </button>
              )}
            </div>
          </nav>

          <div className="shrink-0 p-2">
            <button
              type="button"
              role="switch"
              aria-checked={soundOn}
              data-sound-silent
              onClick={() => {
                const next = !soundOn
                setSoundOn(next)
                writeSoundPreference(next)
                if (next) cue("toggle")
              }}
              className="flex h-[34px] w-full items-center gap-[9px] rounded-control px-2 text-xs font-medium text-ink-2 transition-colors hover:bg-hover hover:text-ink"
            >
              <Icon
                path={paths.sound}
                size={16}
                className="shrink-0 text-ink-4"
              />
              Interaction sounds
              <Switch on={soundOn} className="ml-auto" />
            </button>
          </div>
        </aside>
      </AppShellSidebar>

      <main className="flex h-full min-h-0 flex-col overflow-hidden p-2 pl-0 max-lg:pl-2">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-window bg-surface shadow-card">
          <header className="flex h-[52px] shrink-0 items-center gap-2 border-b border-line px-3.5">
            <SidebarTrigger className="-ml-1" />
            <span className="text-sm font-semibold text-ink">
              {TAB_LABEL[tab]}
            </span>
            <span className="rounded-full bg-inset px-2 py-0.5 text-[10px] font-medium text-ink-4 shadow-[inset_0_0_0_1px_var(--line)]">
              General ledger · {periodLabel}
            </span>
            {selectedAccount && (
              <span className="rounded-full bg-inset px-2 py-0.5 text-[10px] font-medium text-ink-4 shadow-[inset_0_0_0_1px_var(--line)]">
                {selectedAccount.code} · {selectedAccount.name}
              </span>
            )}

            <span className="ml-3 flex items-center gap-3 text-[11.5px] text-ink-3">
              <span>
                <span className={cn(num, "text-ink")}>{accounts.length}</span>{" "}
                accounts
              </span>
              <span>
                <span className={cn(num, "text-ink")}>{periods.length}</span>{" "}
                periods
                {closedPeriods > 0 && (
                  <span className="text-ink-4"> ({closedPeriods} closed)</span>
                )}
              </span>
              <span>
                <span className={cn(num, "text-ink")}>{lines.length}</span>{" "}
                journal lines
              </span>
            </span>

            <button
              type="button"
              onClick={() => {
                reference.reload()
                trialBalance.reload()
                journal.reload()
                balanceSheet.reload()
              }}
              className="ml-auto inline-flex h-[28px] shrink-0 items-center rounded-control bg-surface px-2.5 text-[11px] font-medium text-ink-2 shadow-btn transition-colors hover:bg-hover hover:text-ink"
            >
              Refresh
            </button>
          </header>

          <div className="min-h-0 flex-1 overflow-auto">{body}</div>
        </div>
      </main>

      {/* ── account detail ─────────────────────────────────────── */}
      <SheetShell
        open={openAccount !== null}
        eyebrow={openAccount ? ROOT_LABEL[openAccount.rootType] : "Account"}
        title={openAccount ? `${openAccount.code} · ${openAccount.name}` : ""}
        onRequestClose={() =>
          void navigate({
            search: (prev) => ({ ...prev, openAccount: undefined }),
            replace: true,
          })
        }
        footer={
          <button
            type="button"
            className={sheetButton.secondary}
            onClick={() => {
              void navigate({
                search: (prev) => ({
                  ...prev,
                  accountCode: openAccount?.code,
                  tab: "journal",
                  openAccount: undefined,
                }),
                replace: true,
              })
            }}
          >
            Open in journal
          </button>
        }
      >
        {openAccount && (
          <div className="flex flex-col gap-4 p-3.5">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Code">
                <span className={num}>{openAccount.code}</span>
              </Field>
              <Field label="Root type">
                {ROOT_LABEL[openAccount.rootType]}
              </Field>
              <Field label="Parent">
                {openAccount.parentCode ? (
                  <span>
                    <span className={num}>{openAccount.parentCode}</span>{" "}
                    {accounts.find((a) => a.code === openAccount.parentCode)
                      ?.name ?? (
                      <span className="text-ink-4">
                        — not itself an account on this hub
                      </span>
                    )}
                  </span>
                ) : (
                  "— root"
                )}
              </Field>
              <Field label="Kind">
                {openAccount.isGroup
                  ? "Group — not posted to"
                  : "Posting account"}
              </Field>
              <Field label="ERPNext type">
                {openAccount.erpnextType ?? (
                  <span className="text-ink-4">not stated</span>
                )}
              </Field>
              <Field label="Active">
                {openAccount.isActive ? "Yes" : "No"}
              </Field>
              <Field label="Lines in view">
                <span className={num}>{detailLines}</span>
              </Field>
              <Field label="Account id">
                <span className={cn(num, "text-[11px]")}>{openAccount.id}</span>
              </Field>
            </div>

            <div className="rounded-panel p-3 shadow-[inset_0_0_0_1px_var(--line)]">
              <div className="text-[10.5px] font-semibold tracking-[0.05em] text-ink-4 uppercase">
                Trial balance · {periodLabel}
              </div>
              {trialBalance.status === "error" ? (
                <p className="mt-1.5 text-[11.5px] text-ember">
                  {trialBalance.errorMessage}
                </p>
              ) : detailRow ? (
                <div className="mt-2 grid grid-cols-3 gap-3">
                  <Field label="Debit">
                    <span className={num}>{moneyOrDash(detailRow.debit)}</span>
                  </Field>
                  <Field label="Credit">
                    <span className={num}>{moneyOrDash(detailRow.credit)}</span>
                  </Field>
                  <Field label="Balance">
                    <span className={num}>
                      {money(trialBalanceOf(detailRow))}
                    </span>
                  </Field>
                </div>
              ) : (
                <p className="mt-1.5 text-[11.5px] leading-[1.5] text-ink-4">
                  This account carries no balance in this window — nothing has
                  been posted to it, so the trial balance returns no row for it.
                </p>
              )}
            </div>
          </div>
        )}
      </SheetShell>

      {/* ── close confirmation ─────────────────────────────────── */}
      <SheetShell
        open={confirmClose !== null}
        eyebrow="Irreversible"
        title={confirmClose ? `Close ${confirmClose.name}` : ""}
        onRequestClose={() => {
          if (!closeBusy) setConfirmClose(null)
        }}
        footer={
          <>
            <button
              type="button"
              className={sheetButton.secondary}
              disabled={closeBusy !== null}
              onClick={() => setConfirmClose(null)}
            >
              Cancel
            </button>
            <button
              type="button"
              className={sheetButton.primary}
              disabled={closeBusy !== null}
              onClick={() => void runClose()}
            >
              {closeBusy ? "Closing…" : "Close the period"}
            </button>
          </>
        }
      >
        {confirmClose && (
          <div className="flex flex-col gap-3 p-3.5">
            <p className="text-[12.5px] leading-[1.6] text-ink-2">
              Closing locks {confirmClose.startsOn} to {confirmClose.endsOn}.
              Every later posting whose date falls inside that range will be
              rejected by the ledger, including postings that business events
              would otherwise have written automatically.
            </p>
            <p className="text-[12.5px] leading-[1.6] text-ink-3">
              This is accounting state, not a UI toggle. cloud-hub exposes{" "}
              <span className={num}>/periods/{"{id}"}/reopen</span> as a
              separate administrative route, but it is not an undo.
            </p>
            <div className="grid grid-cols-3 gap-3 rounded-panel p-3 shadow-[inset_0_0_0_1px_var(--line)]">
              <Field label="Period">
                <span className={num}>{confirmClose.id}</span>
              </Field>
              <Field label="Starts">
                <span className={num}>{confirmClose.startsOn}</span>
              </Field>
              <Field label="Ends">
                <span className={num}>{confirmClose.endsOn}</span>
              </Field>
            </div>
            {closeError && (
              <p className="text-[11.5px] text-ember">{closeError}</p>
            )}
          </div>
        )}
      </SheetShell>
    </AppShell>
  )
}
