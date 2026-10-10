import {
  Bus,
  Droplets,
  HandCoins,
  Lightbulb,
  Paintbrush,
  Phone,
  PiggyBank,
  Plus,
  Receipt,
  ShoppingBasket,
  Wrench,
} from "lucide-react"
import { useState } from "react"

import { DockTools } from "@/components/shell/dock-tools"
import { Button } from "@/components/ui/button"
import { Fab } from "@/components/ui/fab"
import { Field, Input, Money, Select } from "@/components/ui/field"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import type { ListColumn } from "@/components/ui/list-table"
import { OpenButton } from "@/components/ui/open-rows"
import { Pill } from "@/components/ui/pill"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { Banner } from "@/components/ui/states"
import { day, moment } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import { useParam } from "@/lib/params"
import { lastDays } from "@/lib/queries"
import {
  useExpenses,
  usePettyCash,
  useRecordExpense,
  useRecordTopUp,
} from "@/lib/queries/expenses"
import { queryState } from "@/lib/query-state"
import { useIdentity } from "@/lib/session"
import { minorFrom, spanWords } from "@/screens/money/format"
import {
  DeskBar,
  MoneyScreen,
  Rows,
  SpanPicker,
  SPANS,
  spanChoices,
  TwoLine,
} from "@/screens/money/parts"
import type {
  PettyCashPosition,
  PettyCashTopUpView,
  StoreExpenseView,
} from "@itulah/contract"
import { money, units } from "@itulah/contract/money"

/// Money › Expenses: the shop's petty cash. Whoever is signed in records an
/// expense; above Finance's line it needs Finance's one-time code.
///
/// The tin's figures stand at the top; below them the span's expenses and the
/// float that came in, as lead cards — the amount is the figure, what it was for
/// is under the name, and a card opens its record in a sheet. On a phone the
/// span is the dock's status chip, "New expense" its Fab and "New float" a row
/// of its ⚙ sheet; a desk has the toolbar and the header's two buttons.
export function Expenses() {
  const tin = usePettyCash()
  const [task, setTask] = useState<"spend" | "float" | null>(null)
  // Held apart from `task` so a sheet can play its exit with its form still
  // in it, rather than emptying the moment it starts to close.
  const [showing, setShowing] = useState(false)
  const [done, setDone] = useState<string | null>(null)

  const start = (next: "spend" | "float") => {
    setDone(null)
    setTask(next)
    setShowing(true)
  }

  return (
    <MoneyScreen
      actions={
        tin.data === undefined ? undefined : (
          <>
            <Button onClick={() => start("float")}>
              <PiggyBank />
              New float
            </Button>
            <Button variant="primary" onClick={() => start("spend")}>
              <Plus />
              New expense
            </Button>
          </>
        )
      }
    >
      {queryState(tin, {
        loading: "Reading the petty cash…",
        render: (position) => (
          <>
            <TheTin position={position} />
            {done !== null && (
              <Banner
                tone="ok"
                className="mb-4"
                onDismiss={() => setDone(null)}
              >
                {done}
              </Banner>
            )}
            <TheBook
              onSpend={() => start("spend")}
              onFloat={() => start("float")}
            />

            <SpendSheet
              position={position}
              open={showing && task === "spend"}
              onClose={() => setShowing(false)}
              onDone={(said) => {
                setShowing(false)
                setDone(said)
              }}
            />
            <FloatSheet
              open={showing && task === "float"}
              onClose={() => setShowing(false)}
              onDone={(said) => {
                setShowing(false)
                setDone(said)
              }}
            />
          </>
        ),
      })}
    </MoneyScreen>
  )
}

/// What is in the tin — a lifetime figure, so it sits above the span. Numbers,
/// not a bar: how much of the float is left is a percentage under the balance.
function TheTin({ position }: { position: PettyCashPosition }) {
  const left =
    position.float_in_minor > 0
      ? position.balance_minor / position.float_in_minor
      : 0
  return (
    <KpiStrip>
      <Kpi
        label="Balance"
        value={money(position.balance_minor)}
        delta={
          position.balance_minor > 0
            ? position.float_in_minor > 0
              ? `${Math.round(left * 100)}% left`
              : undefined
            : "Empty"
        }
        tone={position.balance_minor <= 0 || left <= 0.1 ? "down" : "flat"}
      />
      <Kpi
        label="Received"
        value={money(position.float_in_minor)}
        delta={
          position.last_top_up_at === null
            ? "None yet"
            : `Last ${day(position.last_top_up_at)}`
        }
      />
      <Kpi
        label="Spent"
        value={money(position.spent_minor)}
        delta={`${units(position.expense_count)} ${position.expense_count === 1 ? "receipt" : "receipts"}`}
      />
    </KpiStrip>
  )
}

/// What went out and what came in, over a span the URL remembers.
///
/// `span` is the same parameter the Reports screen uses, so a manager who set
/// thirty days there and walked to here is still looking at thirty days — and
/// a tablet that slept and woke is too.
function TheBook({
  onSpend,
  onFloat,
}: {
  onSpend: () => void
  onFloat: () => void
}) {
  const span = useParam("span")
  const days = Number(span.value ?? "1")
  const range = lastDays(days)
  const book = useExpenses(range.from, range.to)
  const [open, setOpen] = useState<
    | { kind: "expense"; row: StoreExpenseView }
    | { kind: "float"; row: PettyCashTopUpView }
    | null
  >(null)
  const [showing, setShowing] = useState(false)

  return (
    <>
      {/* The dock, on a phone: the span as its status chip, the new expense as
          its one round button, and the float a row of its ⚙ sheet. */}
      <DockTools
        status={{
          value: String(days),
          options: spanChoices(String(days)),
          onChange: (next) => span.set(next),
        }}
        actions={[{ label: "New float", onClick: onFloat }]}
      />
      <Fab label="New expense" onClick={onSpend} />

      <DeskBar>
        <SpanPicker
          options={SPANS}
          value={(span.value ?? "1") as (typeof SPANS)[number]["value"]}
          onChange={(next) => span.set(next)}
        />
        <span className="text-meta text-mute tabular-nums">
          {spanWords(range.from, range.to)}
        </span>
      </DeskBar>

      {queryState(book, {
        loading: "Reading the expenses…",
        render: (page) => (
          <div className="flex flex-col gap-4">
            <Rows
              title="Expenses"
              sub={
                page.count === 0
                  ? undefined
                  : `${units(page.count)} ${page.count === 1 ? "receipt" : "receipts"}`
              }
              aside={money(page.spent_minor)}
              rows={page.expenses}
              columns={EXPENSE_COLUMNS}
              rowKey={(expense) => expense.id}
              empty="No expenses in this period."
              onOpen={(row) => {
                setOpen({ kind: "expense", row })
                setShowing(true)
              }}
              card={(expense) => ({
                title: expense.payee,
                lines: [expense.reason],
                lead: {
                  figure: money(expense.amount_minor),
                  caption:
                    categoryOf(expense.category)?.word ?? expense.category,
                },
                foot: {
                  info: `${day(expense.spent_at)} · ${expense.claimed_by}`,
                },
              })}
              foot={
                page.truncated ? (
                  <p className="border-t border-hairline px-4 py-2.5 text-meta text-body max-md:mt-3 max-md:border-t-0 max-md:px-1">
                    Showing {units(page.expenses.length)} of {units(page.count)}
                    .
                  </p>
                ) : undefined
              }
            />

            {page.top_ups.length > 0 && (
              <Rows
                title="Float received"
                aside={money(
                  page.top_ups.reduce((sum, one) => sum + one.amount_minor, 0),
                )}
                rows={page.top_ups}
                columns={TOP_UP_COLUMNS}
                rowKey={(topUp) => topUp.id}
                empty="None in this period."
                onOpen={(row) => {
                  setOpen({ kind: "float", row })
                  setShowing(true)
                }}
                card={(topUp) => ({
                  title: `Taken by ${topUp.received_by}`,
                  code: topUp.reference ?? undefined,
                  lines: [`Counted with ${topUp.approved_by}`],
                  lead: { figure: money(topUp.amount_minor) },
                  foot: { info: day(topUp.received_at) },
                })}
              />
            )}
          </div>
        ),
      })}

      {open?.kind === "expense" && (
        <ExpenseSheet
          expense={open.row}
          open={showing}
          onClose={() => setShowing(false)}
        />
      )}
      {open?.kind === "float" && (
        <TopUpSheet
          topUp={open.row}
          open={showing}
          onClose={() => setShowing(false)}
        />
      )}
    </>
  )
}

/// The nine kinds of cost, said in words a shop uses.
///
/// The codes are the centre's — `expense_transport` resolves to an account
/// through the posting rule — and the words are for the person holding the
/// receipt. Keeping the pairing in one table is what stops "transport" being
/// "Ojek" on this screen and "Travel" on the next.
const CATEGORIES = [
  { code: "expense_household", word: "Household & dues", icon: HandCoins },
  { code: "expense_stationery", word: "Stationery", icon: Receipt },
  { code: "expense_transport", word: "Transport & parking", icon: Bus },
  { code: "expense_electricity", word: "Electricity", icon: Lightbulb },
  { code: "expense_water", word: "Water", icon: Droplets },
  { code: "expense_telephone", word: "Telephone & internet", icon: Phone },
  { code: "expense_repairs", word: "Repairs", icon: Wrench },
  { code: "expense_cleaning", word: "Cleaning", icon: Paintbrush },
  { code: "expense_misc", word: "Something else", icon: ShoppingBasket },
] as const

function categoryOf(code: string) {
  return CATEGORIES.find((one) => one.code === code)
}

const EXPENSE_COLUMNS: readonly ListColumn<StoreExpenseView>[] = [
  {
    id: "payee",
    header: "Paid to",
    className: "max-w-[20rem]",
    cell: (expense) => (
      <OpenButton id={expense.id} className="w-full">
        <TwoLine
          icon={categoryOf(expense.category)?.icon ?? ShoppingBasket}
          top={expense.payee}
          under={expense.reason}
        />
      </OpenButton>
    ),
  },
  {
    id: "category",
    header: "Kind",
    className: "max-lg:hidden",
    cell: (expense) => categoryOf(expense.category)?.word ?? expense.category,
  },
  {
    id: "by",
    header: "By",
    cell: (expense) => expense.claimed_by,
  },
  {
    id: "when",
    header: "When",
    className: "tabular-nums",
    cell: (expense) => moment(expense.spent_at),
  },
  {
    id: "amount",
    header: "Amount",
    align: "right",
    cell: (expense) => (
      <span className="font-medium text-ink tabular-nums">
        {money(expense.amount_minor)}
      </span>
    ),
  },
]

const TOP_UP_COLUMNS: readonly ListColumn<PettyCashTopUpView>[] = [
  {
    id: "when",
    header: "Received",
    cell: (topUp) => (
      <OpenButton id={topUp.id} className="font-medium text-ink tabular-nums">
        {moment(topUp.received_at)}
      </OpenButton>
    ),
  },
  {
    id: "reference",
    header: "Reference",
    cell: (topUp) =>
      topUp.reference === null ? (
        <span className="text-faint">—</span>
      ) : (
        <span className="font-mono text-id text-body">{topUp.reference}</span>
      ),
  },
  {
    id: "taken",
    header: "Taken by",
    cell: (topUp) => topUp.received_by,
  },
  {
    id: "counted",
    header: "Counted with",
    className: "max-lg:hidden",
    cell: (topUp) => topUp.approved_by,
  },
  {
    id: "amount",
    header: "Amount",
    align: "right",
    cell: (topUp) => (
      <span className="font-medium text-ink tabular-nums">
        {money(topUp.amount_minor)}
      </span>
    ),
  },
]

/// The one figure a record sheet opens with: what it was worth. 24px, semibold,
/// as a card's lead figure — the record's answer before its facts.
function Figure({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-6 text-[1.5rem] leading-tight font-semibold tracking-tight text-ink tabular-nums">
      {children}
    </p>
  )
}

function ExpenseSheet({
  expense,
  open,
  onClose,
}: {
  expense: StoreExpenseView
  open: boolean
  onClose: () => void
}) {
  const kind = categoryOf(expense.category)
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      id={expense.id.slice(0, 8)}
      title={expense.payee}
      // Above Finance's line the expense carries the code that let it through:
      // that is the one state it has.
      badge={
        expense.approval_code === null ? undefined : (
          <Pill tone="ok">Approved</Pill>
        )
      }
      caption={`${kind?.word ?? expense.category} · ${moment(expense.spent_at)}`}
    >
      <Figure>{money(expense.amount_minor)}</Figure>
      <Facts>
        <Fact term="For" wide>
          {expense.reason}
        </Fact>
        <Fact term="Kind">{kind?.word ?? expense.category}</Fact>
        <Fact term="When">{moment(expense.spent_at)}</Fact>
        <Fact term="Recorded by">{expense.claimed_by}</Fact>
        {expense.approval_code !== null ? (
          <Fact term="Approval code">
            <span className="font-mono">{expense.approval_code}</span>
            {expense.approved_by !== null && (
              <span className="text-mute"> · {expense.approved_by}</span>
            )}
          </Fact>
        ) : (
          expense.approved_by !== null && (
            <Fact term="Signed by">{expense.approved_by}</Fact>
          )
        )}
      </Facts>
    </Sheet>
  )
}

function TopUpSheet({
  topUp,
  open,
  onClose,
}: {
  topUp: PettyCashTopUpView
  open: boolean
  onClose: () => void
}) {
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      id={topUp.reference ?? topUp.id.slice(0, 8)}
      title="Float received"
      caption={moment(topUp.received_at)}
    >
      <Figure>{money(topUp.amount_minor)}</Figure>
      <Facts>
        <Fact term="Taken by">{topUp.received_by}</Fact>
        <Fact term="Counted with">{topUp.approved_by}</Fact>
        <Fact term="Reference">{topUp.reference ?? "—"}</Fact>
        <Fact term="When">{moment(topUp.received_at)}</Fact>
        {topUp.note !== null && (
          <Fact term="Note" wide>
            {topUp.note}
          </Fact>
        )}
      </Facts>
    </Sheet>
  )
}

/// The foot of a form: the node's refusal in a banner above, then Cancel at the
/// left and the one commit button at the right — on every width.
function FormFoot({
  error,
  onCancel,
  form,
  ready,
  pending,
  label,
  pendingLabel,
}: {
  error: Error | null
  onCancel: () => void
  form: string
  ready: boolean
  pending: boolean
  label: string
  pendingLabel: string
}) {
  return (
    <div className="flex flex-col gap-3">
      {error !== null && <Banner tone="bad">{error.message}</Banner>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="submit"
          form={form}
          variant="primary"
          pending={pending}
          disabled={!ready}
        >
          {pending ? pendingLabel : label}
        </Button>
      </div>
    </div>
  )
}

/// Record what was bought. Whoever is signed in records it; above Finance's
/// line the form asks for Finance's one-time code. On a phone the amount is
/// entered on the number pad, never the keyboard.
function SpendSheet({
  position,
  open,
  onClose,
  onDone,
}: {
  position: PettyCashPosition
  open: boolean
  onClose: () => void
  onDone: (said: string) => void
}) {
  const phone = useLayout() === "phone"
  const record = useRecordExpense()
  const [category, setCategory] = useState<string>("expense_household")
  const [amount, setAmount] = useState("")
  const [payee, setPayee] = useState("")
  const [reason, setReason] = useState("")
  const [code, setCode] = useState("")

  const minor = minorFrom(amount)
  const overTin = minor !== null && minor > position.balance_minor
  const needsCode = minor !== null && minor > position.code_above_minor
  const codeReady = /^[0-9]{6}$/.test(code.trim())

  const ready =
    minor !== null &&
    minor > 0 &&
    !overTin &&
    payee.trim() !== "" &&
    reason.trim() !== "" &&
    (!needsCode || codeReady)

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title="New expense"
      caption={`Balance ${money(position.balance_minor)}`}
      width="wide"
      footer={
        <FormFoot
          error={record.error}
          onCancel={onClose}
          form="petty-spend"
          ready={ready}
          pending={record.isPending}
          label="Create expense"
          pendingLabel="Creating…"
        />
      }
    >
      <form
        id="petty-spend"
        className="flex flex-col gap-6"
        onSubmit={(event) => {
          event.preventDefault()
          if (!ready || record.isPending || minor === null) return
          record.mutate(
            {
              category,
              amountMinor: minor,
              payee: payee.trim(),
              reason: reason.trim(),
              approvalCode: needsCode ? code.trim() : null,
            },
            {
              onSuccess: () => {
                onDone(`Recorded ${money(minor)} to ${payee.trim()}.`)
                setAmount("")
                setPayee("")
                setReason("")
                setCode("")
              },
            },
          )
        }}
      >
        <div className="grid gap-6 md:grid-cols-2">
          <Field
            label="Amount"
            problem={
              overTin
                ? `Petty cash holds ${money(position.balance_minor)}.`
                : undefined
            }
          >
            <Money
              value={amount}
              onChange={setAmount}
              prefix="Rp"
              label="Amount"
              autoFocus={!phone}
              invalid={overTin}
            />
          </Field>
          <Field label="Kind">
            <Select value={category} onChange={setCategory}>
              {CATEGORIES.map((one) => (
                <option key={one.code} value={one.code}>
                  {one.word}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <Field label="Paid to">
            <Input
              value={payee}
              placeholder="Delivery rider"
              onChange={(event) => setPayee(event.target.value)}
            />
          </Field>
          <Field label="For">
            <Input
              value={reason}
              placeholder="Parcel to a customer"
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
        </div>

        {needsCode && (
          <Field
            label="Approval code from Finance"
            hint={`Above ${money(position.code_above_minor)}`}
          >
            <Input
              inputMode="numeric"
              // A code, not a quantity: typed, with its leading zeros.
              keyboard
              autoComplete="off"
              maxLength={6}
              className="max-w-[12rem] font-mono tracking-[0.2em]"
              value={code}
              placeholder="000000"
              onChange={(event) =>
                setCode(event.target.value.replace(/[^0-9]/g, ""))
              }
            />
          </Field>
        )}
      </form>
    </Sheet>
  )
}

/// The float coming in from head office. Counted by two people.
function FloatSheet({
  open,
  onClose,
  onDone,
}: {
  open: boolean
  onClose: () => void
  onDone: (said: string) => void
}) {
  const phone = useLayout() === "phone"
  const top = useRecordTopUp()
  const identity = useIdentity()
  const [amount, setAmount] = useState("")
  const [reference, setReference] = useState("")
  const [note, setNote] = useState("")
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")

  const minor = minorFrom(amount)
  const claimant = identity.data?.username ?? ""
  const signingSelf =
    claimant !== "" && username.trim().toLowerCase() === claimant.toLowerCase()
  const ready =
    minor !== null &&
    minor > 0 &&
    !signingSelf &&
    username.trim() !== "" &&
    password !== ""

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title="New float"
      caption="Counted with a second person"
      width="wide"
      footer={
        <FormFoot
          error={top.error}
          onCancel={onClose}
          form="petty-float"
          ready={ready}
          pending={top.isPending}
          label="Create float"
          pendingLabel="Creating…"
        />
      }
    >
      <form
        id="petty-float"
        className="flex flex-col gap-6"
        onSubmit={(event) => {
          event.preventDefault()
          if (!ready || top.isPending || minor === null) return
          top.mutate(
            {
              amountMinor: minor,
              reference,
              note,
              supervisor: { username: username.trim(), password },
            },
            {
              onSuccess: () => {
                onDone(`Recorded ${money(minor)} float.`)
                setAmount("")
                setReference("")
                setNote("")
                setPassword("")
              },
            },
          )
        }}
      >
        <Field label="Amount">
          <Money
            value={amount}
            onChange={setAmount}
            prefix="Rp"
            label="Amount"
            autoFocus={!phone}
          />
        </Field>
        <div className="grid gap-6 md:grid-cols-2">
          <Field label="Reference" hint="Optional">
            <Input
              value={reference}
              placeholder="TRF-2026-09-13-001"
              onChange={(event) => setReference(event.target.value)}
            />
          </Field>
          <Field label="Note" hint="Optional">
            <Input
              value={note}
              placeholder="Petty cash for the month"
              onChange={(event) => setNote(event.target.value)}
            />
          </Field>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <Field
            label="Counted with"
            problem={
              signingSelf ? "Someone else counts it with you." : undefined
            }
          >
            <Input
              autoComplete="off"
              invalid={signingSelf}
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
          </Field>
          <Field label="Their password">
            <Input
              type="password"
              autoComplete="off"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>
        </div>
      </form>
    </Sheet>
  )
}
