import { useMemo, useState } from "react"

import { Link } from "@tanstack/react-router"

import { Icon, paths } from "@/components/dashboard/parts"
import { IconButton, Switch } from "@/components/dashboard/nav-sidebar"
import { SheetShell, sheetButton } from "@/components/dashboard/sheet-shell"
import { AppHeading } from "@/components/app-switcher"
import { SupplierAccount } from "@/components/finance/account"
import { Payables } from "@/components/finance/payables"
import { Overview } from "@/components/finance/overview"
import {
  CashFlow,
  PayrollView,
  Reimbursements,
  Revenue,
} from "@/components/finance/views"
import {
  useFinanceReimbursements,
  useFinanceResource,
} from "@/components/finance/api"
import type { FinanceResource } from "@/components/finance/api"
import { LOCATIONS as HR_LOCATIONS } from "@/components/hr/data"
import { useHr } from "@/components/hr/store"
import {
  applyPayments,
  rupiah,
  shortRupiah,
  type CashRow,
  type Ledger,
} from "@/components/finance/data"
import {
  cue,
  readSoundPreference,
  useInteractionSounds,
  writeSoundPreference,
} from "@/components/dashboard/use-interaction-sounds"
import { shortDate, todayKey } from "@/lib/day"
import { cn } from "@/lib/utils"
import { PreviewNotice } from "@/components/backend-status"
import { Route } from "@/routes/_people/finance"
import {
  AppShell,
  AppShellSidebar,
  SidebarTrigger,
} from "@/components/app-shell"

type Tab = "overview" | "payables" | "revenue" | "payroll" | "expenses" | "cash"

const TITLE: Record<Tab, string> = {
  overview: "Finance",
  payables: "Payables",
  revenue: "Revenue",
  payroll: "Payroll",
  expenses: "Claims",
  cash: "Cash",
}

const HINT: Record<Tab, string> = {
  overview: "Where the money is going this month",
  payables: "What is owed to suppliers, and what has been paid",
  revenue: "Posted revenue from Internal's accounting ledger",
  payroll: "What People has prepared, and what finance pays",
  expenses: "Employee reimbursement claims from Internal",
  cash: "Posted indirect cash flow from Internal's accounting ledger",
}

const EMPTY_SUPPLIERS: FinanceResource["suppliers"] = []
const EMPTY_INVOICES: FinanceResource["invoices"] = []
const EMPTY_PAYMENTS: FinanceResource["payments"] = []

export function Finance() {
  const financeResource = useFinanceResource()
  const reimbursementResource = useFinanceReimbursements()
  const suppliers = financeResource.data?.suppliers ?? EMPTY_SUPPLIERS
  const invoices = financeResource.data?.invoices ?? EMPTY_INVOICES
  const payments = financeResource.data?.payments ?? EMPTY_PAYMENTS
  const { netFor } = useHr()
  const { tab, openId } = Route.useSearch()
  const navigate = Route.useNavigate()
  /* The payment sheet holds an unsaved form, so neither it nor its draft is
   * navigation — reopening the URL should not restore a half-typed payment. */
  const [payFor, setPayFor] = useState<string | null>(null)
  const [draft, setDraft] = useState({ amount: "", reference: "", note: "" })
  const [railHidden, setRailHidden] = useState(false)
  const [soundOn, setSoundOn] = useState(readSoundPreference)

  useInteractionSounds(soundOn)

  /** One ledger per supplier, payments applied oldest debt first. */
  const accounts = useMemo(
    () =>
      suppliers
        .map((supplier) => ({
          supplier,
          ledger: applyPayments(
            invoices.filter((invoice) => invoice.supplierId === supplier.id),
            payments.filter((p) => p.supplierId === supplier.id)
          ),
        }))
        .filter(({ ledger }) => ledger.lines.length > 0)
        .sort((a, b) => b.ledger.outstanding - a.ledger.outstanding),
    [suppliers, invoices, payments]
  )

  const owed = accounts.reduce((sum, a) => sum + a.ledger.outstanding, 0)
  const credit = accounts.reduce((sum, a) => sum + a.ledger.credit, 0)
  const overdue = accounts.reduce(
    (sum, a) =>
      sum +
      a.ledger.lines
        .filter((l) => l.status === "overdue")
        .reduce((s, l) => s + l.outstanding, 0),
    0
  )
  const dueSoon = accounts.reduce(
    (sum, a) =>
      sum +
      a.ledger.lines
        .filter((l) => l.outstanding > 0 && l.invoice.dueOn >= todayKey())
        .filter((l) => l.invoice.dueOn <= addWeek())
        .reduce((s, l) => s + l.outstanding, 0),
    0
  )

  const revenue = financeResource.data?.pnl?.revenue.total ?? 0
  const payrollDue = HR_LOCATIONS.reduce((sum, l) => sum + netFor(l.id), 0)
  const expensesDue = (reimbursementResource.data ?? [])
    .filter(
      (claim) => claim.status === "submitted" || claim.status === "approved"
    )
    .reduce((sum, claim) => sum + claim.totalAmount, 0)

  /* The overview only shows live AP payments. The old synthetic sales,
   * payroll, and expense rows are deliberately not mixed into a cash trail. */
  const cashRows: CashRow[] = useMemo(() => {
    const fromPayments: CashRow[] = payments.map((payment) => ({
      id: payment.id,
      at: payment.at,
      kind: "supplier",
      label:
        suppliers.find((s) => s.id === payment.supplierId)?.name ?? "Supplier",
      amount: payment.amount,
      reference: payment.reference,
    }))

    return fromPayments.sort((a, b) => b.at.localeCompare(a.at))
  }, [payments, suppliers])

  const open = accounts.find((a) => a.supplier.id === openId)
  const paying = accounts.find((a) => a.supplier.id === payFor)
  const amount = Number(draft.amount) || 0

  const navRow =
    "flex h-8 w-full items-center gap-2.5 rounded-control px-2 text-left text-[13px] font-medium transition-colors duration-[110ms]"

  /** Opening or closing the account sheet is a filter, not a destination. */
  const setOpenId = (next: string | null) =>
    void navigate({
      search: (prev) => ({ ...prev, openId: next ?? undefined }),
      replace: true,
    })

  return (
    <AppShell
      label="Finance navigation"
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
            <AppHeading app="finance" />
            <IconButton
              label="Collapse sidebar"
              onClick={() => setRailHidden((v) => !v)}
            >
              <Icon path={paths.panel} size={17} />
            </IconButton>
          </div>

          <nav className="flex-1 overflow-auto px-2 pt-0.5 pb-2">
            <div className="rounded-panel bg-surface px-3 py-2.5 shadow-btn">
              <div className="text-[10.5px] font-semibold tracking-[0.04em] text-ink-4 uppercase">
                Owed to suppliers
              </div>
              <div className="pt-0.5 font-mono text-[19px] font-medium tracking-[-0.02em] text-ink">
                {shortRupiah(owed)}
              </div>
              {overdue > 0 && (
                <div className="pt-1 text-[11px] font-medium text-ember">
                  {shortRupiah(overdue)} overdue
                </div>
              )}
            </div>

            {(
              [
                ["overview", "Overview", paths.grid, 0],
                ["payables", "Payables", paths.doc, accounts.length],
                ["revenue", "Revenue", paths.chart, 0],
                ["payroll", "Payroll", paths.people, 0],
                [
                  "expenses",
                  "Claims",
                  paths.tag,
                  (reimbursementResource.data ?? []).filter(
                    (claim) => claim.status === "submitted"
                  ).length,
                ],
                ["cash", "Cash", paths.list, 0],
              ] as const
            ).map(([id, label, icon, count]) => {
              const on = tab === id
              return (
                <Link
                  key={id}
                  to="/finance"
                  search={(prev) => ({ ...prev, tab: id })}
                  replace
                  data-sound="page"
                  className={cn(
                    navRow,
                    "group/nav relative mt-0.5 text-ink-2 hover:bg-hover hover:text-ink",
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
                  {label}
                  {count > 0 && (
                    <span className="ml-auto font-mono text-[10.5px] text-ink-4">
                      {count}
                    </span>
                  )}
                </Link>
              )
            })}

            <div className="mt-3.5 flex h-7 items-center px-2 text-[10.5px] font-semibold tracking-[0.05em] text-ink-4 uppercase">
              Suppliers
            </div>
            {accounts.map(({ supplier, ledger }) => {
              const on = openId === supplier.id
              return (
                <Link
                  key={supplier.id}
                  to="/finance"
                  search={(prev) => ({
                    ...prev,
                    tab: "payables" as const,
                    openId: supplier.id,
                  })}
                  replace
                  className={cn(
                    navRow,
                    "text-ink-2 hover:bg-hover hover:text-ink",
                    on && "bg-hover font-semibold text-ink"
                  )}
                >
                  <span
                    style={{ background: supplier.hue }}
                    className="size-2 shrink-0 rounded-full"
                  />
                  <span className="truncate">{supplier.name}</span>
                  <span className="ml-auto shrink-0 font-mono text-[10.5px] text-ink-4">
                    {shortRupiah(ledger.outstanding)}
                  </span>
                </Link>
              )
            })}
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
            <span className="text-sm font-semibold text-ink">{TITLE[tab]}</span>
            <span className="ml-2 text-[11.5px] text-ink-3">{HINT[tab]}</span>
          </header>

          <div className="min-h-0 flex-1 overflow-auto">
            <PreviewNotice>
              Payables, posted revenue, cash-flow, and employee reimbursement
              claims read Internal&apos;s relational resources when the caller
              has the corresponding access. Payroll remains a local preview, and
              payment recording is disabled until its bank-account settlement
              workflow is connected. Do not use preview numbers for a posting or
              payment decision.
            </PreviewNotice>
            {tab === "payables" &&
            financeResource.isLoading &&
            !financeResource.data ? (
              <div className="flex h-[280px] items-center justify-center text-xs text-ink-4">
                Loading Internal payables…
              </div>
            ) : tab === "payables" &&
              financeResource.errorMessage &&
              !financeResource.data ? (
              <div className="flex h-[280px] flex-col items-center justify-center gap-3 px-6 text-center">
                <span className="text-xs text-ember">
                  Unable to load Internal payables:{" "}
                  {financeResource.errorMessage}
                </span>
                <button
                  type="button"
                  onClick={financeResource.reload}
                  className="inline-flex h-[28px] items-center rounded-control bg-surface px-2.5 text-xs font-medium text-ink shadow-btn hover:bg-hover"
                >
                  Retry
                </button>
              </div>
            ) : tab === "payables" ? (
              <Payables
                accounts={accounts}
                owed={owed}
                overdue={overdue}
                credit={credit}
                dueSoon={dueSoon}
                onOpen={setOpenId}
                onPay={(id) => {
                  setPayFor(id)
                  setDraft({ amount: "", reference: "", note: "" })
                }}
              />
            ) : null}

            {tab === "overview" && (
              <Overview
                owed={owed}
                overdue={overdue}
                revenue={revenue}
                payrollDue={payrollDue}
                expensesDue={expensesDue}
                cash={cashRows}
              />
            )}

            {tab === "revenue" && (
              <Revenue report={financeResource.data?.pnl} />
            )}
            {tab === "payroll" && <PayrollView />}
            {tab === "expenses" &&
            reimbursementResource.isLoading &&
            !reimbursementResource.data ? (
              <div className="flex h-[280px] items-center justify-center text-xs text-ink-4">
                Loading Internal reimbursement claims…
              </div>
            ) : tab === "expenses" && reimbursementResource.errorMessage ? (
              <div className="flex min-h-[280px] flex-col items-center justify-center gap-3 px-6 text-center">
                <span className="max-w-[440px] text-xs text-ember">
                  Unable to load Internal reimbursement claims:{" "}
                  {reimbursementResource.errorMessage}
                </span>
                <button
                  type="button"
                  onClick={reimbursementResource.reload}
                  className="inline-flex h-[28px] items-center rounded-control bg-surface px-2.5 text-xs font-medium text-ink shadow-btn hover:bg-hover"
                >
                  Retry
                </button>
              </div>
            ) : tab === "expenses" ? (
              <Reimbursements rows={reimbursementResource.data ?? []} />
            ) : null}
            {tab === "cash" && (
              <CashFlow report={financeResource.data?.cashFlow} />
            )}
          </div>
        </div>
      </main>

      <SheetShell
        open={Boolean(open)}
        size="wide"
        eyebrow="Supplier account"
        title={open?.supplier.name ?? ""}
        onRequestClose={() => setOpenId(null)}
        footer={
          <>
            <span className="flex-1 truncate font-mono text-[11.5px] text-ink-3">
              {open ? `${rupiah(open.ledger.outstanding)} outstanding` : ""}
            </span>
            <button
              type="button"
              onClick={() => setOpenId(null)}
              className={sheetButton.secondary}
            >
              Close
            </button>
            <button
              type="button"
              onClick={() => {
                setPayFor(open?.supplier.id ?? null)
                setDraft({ amount: "", reference: "", note: "" })
              }}
              className={sheetButton.primary}
            >
              <Icon path={paths.check} size={14} width={2.2} />
              Make a payment
            </button>
          </>
        }
      >
        {open && (
          <SupplierAccount
            ledger={open.ledger}
            payments={payments.filter((p) => p.supplierId === open.supplier.id)}
          />
        )}
      </SheetShell>

      {/* pay whatever is being paid — the amount is not tied to an invoice */}
      <SheetShell
        open={Boolean(paying)}
        eyebrow="Payment"
        title={paying?.supplier.name ?? ""}
        onRequestClose={() => setPayFor(null)}
        footer={
          <>
            <span className="flex-1" />
            <button
              type="button"
              onClick={() => setPayFor(null)}
              className={sheetButton.secondary}
            >
              Cancel
            </button>
            <button
              type="button"
              disabled
              title="Internal payment API is not connected to this preview"
              className={cn(
                sheetButton.primary,
                "cursor-not-allowed opacity-45"
              )}
            >
              <Icon path={paths.check} size={14} width={2.2} />
              Payment API pending
            </button>
          </>
        }
      >
        {paying && (
          <PaymentForm
            ledger={paying.ledger}
            draft={draft}
            amount={amount}
            onDraft={setDraft}
          />
        )}
      </SheetShell>
    </AppShell>
  )
}

function PaymentForm({
  ledger,
  draft,
  amount,
  onDraft,
}: {
  ledger: Ledger
  draft: { amount: string; reference: string; note: string }
  amount: number
  onDraft: (next: { amount: string; reference: string; note: string }) => void
}) {
  /* show where this money would land before it is sent */
  const allocation = ledger.lines
    .filter((line) => line.outstanding > 0)
    .reduce<{
      pot: number
      landing: { line: Ledger["lines"][number]; takes: number }[]
    }>(
      (state, line) => {
        const takes = Math.min(state.pot, line.outstanding)
        return {
          pot: state.pot - takes,
          landing:
            takes > 0 ? [...state.landing, { line, takes }] : state.landing,
        }
      },
      { pot: amount, landing: [] }
    )
  const { landing, pot } = allocation

  const overdue = ledger.lines
    .filter((l) => l.status === "overdue")
    .reduce((sum, l) => sum + l.outstanding, 0)

  return (
    <div className="px-[18px] pt-4 pb-[18px]">
      <div className="mb-4 rounded-panel bg-inset px-3 py-2.5 text-[11.5px] leading-[1.5] text-ink-3 shadow-[inset_0_0_0_1px_var(--line)]">
        Pay any amount. It comes off the oldest debt first, and anything left
        over stays as credit against this supplier — no invoice has to be
        matched by hand. This is a preview: no payment is written to Internal
        yet.
      </div>

      <label
        htmlFor="pay-amount"
        className="block pb-1.5 text-xs font-medium text-ink-2"
      >
        Amount <span className="text-ember">*</span>
      </label>
      <input
        id="pay-amount"
        value={draft.amount}
        onChange={(e) =>
          onDraft({ ...draft, amount: e.target.value.replace(/\D/g, "") })
        }
        inputMode="numeric"
        placeholder="0"
        className="h-[42px] w-full rounded-control bg-field px-3 text-right font-mono text-[17px] text-ink shadow-[inset_0_0_0_1px_var(--line-strong)] outline-none focus:bg-surface focus:shadow-[inset_0_0_0_1px_var(--accent)]"
      />
      <p className="pt-1.5 text-right font-mono text-[11px] text-ink-4">
        {amount > 0 ? rupiah(amount) : " "}
      </p>

      <div className="flex flex-wrap gap-1.5 pt-2">
        {[
          { label: "Everything owed", value: ledger.outstanding },
          { label: "Overdue only", value: overdue },
          {
            label: "Oldest invoice",
            value:
              ledger.lines.find((l) => l.outstanding > 0)?.outstanding ?? 0,
          },
        ]
          .filter((option) => option.value > 0)
          .map((option) => (
            <button
              key={option.label}
              type="button"
              onClick={() =>
                onDraft({ ...draft, amount: String(Math.round(option.value)) })
              }
              className="inline-flex h-[28px] items-center gap-1.5 rounded-control bg-surface px-2.5 text-[11px] font-medium text-ink-2 shadow-btn transition-colors hover:bg-hover hover:text-ink"
            >
              {option.label}
              <span className="font-mono text-ink-4">
                {shortRupiah(option.value)}
              </span>
            </button>
          ))}
      </div>

      <label
        htmlFor="pay-ref"
        className="mt-4 block pb-1.5 text-xs font-medium text-ink-2"
      >
        Reference
      </label>
      <input
        id="pay-ref"
        value={draft.reference}
        onChange={(e) => onDraft({ ...draft, reference: e.target.value })}
        placeholder="Transfer reference from the bank"
        className="mb-4 h-[36px] w-full rounded-control bg-field px-2.5 font-mono text-[13px] text-ink shadow-[inset_0_0_0_1px_var(--line-strong)] outline-none placeholder:font-sans placeholder:text-ink-4 focus:bg-surface focus:shadow-[inset_0_0_0_1px_var(--accent)]"
      />

      {amount > 0 && (
        <>
          <span className="block pb-1.5 text-xs font-medium text-ink-2">
            Where it lands
          </span>
          <ul className="overflow-hidden rounded-panel border border-line-strong">
            {landing.map(({ line, takes }) => (
              <li
                key={line.invoice.id}
                className="flex items-center gap-2 border-b border-line px-3 py-2 last:border-b-0"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-mono text-[11.5px] text-ink">
                    {line.invoice.number}
                  </span>
                  <span className="block truncate text-[10.5px] text-ink-4">
                    due {shortDate(line.invoice.dueOn)}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block font-mono text-[11.5px] text-grass tabular-nums">
                    {rupiah(takes)}
                  </span>
                  <span className="block font-mono text-[10px] text-ink-4 tabular-nums">
                    of {rupiah(line.outstanding)}
                  </span>
                </span>
              </li>
            ))}
            {pot > 0 && (
              <li className="flex items-center gap-2 bg-green-tint px-3 py-2">
                <span className="min-w-0 flex-1 text-[11.5px] font-medium text-green">
                  Credit on account
                </span>
                <span className="shrink-0 font-mono text-[11.5px] text-green tabular-nums">
                  {rupiah(pot)}
                </span>
              </li>
            )}
          </ul>
        </>
      )}
    </div>
  )
}

/** A week out, for the "due soon" tile. */
function addWeek() {
  const d = new Date()
  d.setDate(d.getDate() + 7)
  d.setHours(12, 0, 0, 0)
  return d.toISOString().slice(0, 10)
}
