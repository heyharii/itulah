import {
  Banknote,
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

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Field, Input, Select } from "@/components/ui/field"
import { ListTable, type ListColumn } from "@/components/ui/list-table"
import { Meter } from "@/components/ui/meter"
import { OpenButton, OpenRows } from "@/components/ui/open-rows"
import { Pill } from "@/components/ui/pill"
import { RecordSheet } from "@/components/ui/record-sheet"
import { Stat, StatStrip } from "@/components/ui/stat-strip"
import { Banner } from "@/components/ui/states"
import { moment } from "@/lib/format"
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
  CardHead,
  Fact,
  Facts,
  MoneyScreen,
  SpanPicker,
  Toolbar,
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
              Float received
            </Button>
            <Button variant="primary" onClick={() => start("spend")}>
              <Plus />
              Record an expense
            </Button>
          </>
        )
      }
    >
      {queryState(tin, {
        loading: "Loading petty cash…",
        render: (position) => (
          <>
            <TheTin position={position} />
            {done !== null && (
              <Banner tone="ok" className="mb-4">
                {done}
              </Banner>
            )}
            <TheBook />

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

/// What is in the tin — a lifetime figure, so it sits above the span.
function TheTin({ position }: { position: PettyCashPosition }) {
  const left =
    position.float_in_minor > 0
      ? position.balance_minor / position.float_in_minor
      : 0
  return (
    <StatStrip>
      <Stat
        label="Balance"
        value={money(position.balance_minor)}
        tone={position.balance_minor > 0 ? undefined : "warn"}
        sub={
          position.balance_minor > 0 ? (
            <Meter
              className="mt-0.5"
              value={left}
              tone={left > 0.25 ? "accent" : left > 0.1 ? "warn" : "bad"}
            />
          ) : (
            "Empty"
          )
        }
      />
      <Stat
        label="Received"
        value={money(position.float_in_minor)}
        sub={
          position.last_top_up_at === null
            ? "None yet"
            : `Last ${moment(position.last_top_up_at)}`
        }
      />
      <Stat
        label="Spent"
        value={money(position.spent_minor)}
        sub={`${units(position.expense_count)} ${position.expense_count === 1 ? "receipt" : "receipts"}`}
      />
    </StatStrip>
  )
}

const SPANS = [
  { value: "1", label: "Today" },
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
] as const

/// What went out and what came in, over a span the URL remembers.
///
/// `span` is the same parameter the Reports screen uses, so a manager who set
/// thirty days there and walked to here is still looking at thirty days — and
/// a tablet that slept and woke is too.
function TheBook() {
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
      <Toolbar>
        <SpanPicker
          options={SPANS}
          value={(span.value ?? "1") as (typeof SPANS)[number]["value"]}
          onChange={(next) => span.set(next)}
        />
        <span className="text-meta text-mute tabular-nums">
          {spanWords(range.from, range.to)}
        </span>
      </Toolbar>

      {queryState(book, {
        loading: "Loading…",
        render: (page) => (
          <>
            <Card className="mb-4">
              <CardHead
                title="Expenses"
                sub={
                  page.count === 0
                    ? undefined
                    : `${units(page.count)} ${page.count === 1 ? "receipt" : "receipts"}`
                }
                aside={
                  <span className="text-metric font-semibold text-ink tabular-nums">
                    {money(page.spent_minor)}
                  </span>
                }
              />
              <OpenRows
                onOpen={(id) => {
                  const row = page.expenses.find((one) => one.id === id)
                  if (row === undefined) return
                  setOpen({ kind: "expense", row })
                  setShowing(true)
                }}
              >
                <ListTable
                  rows={page.expenses}
                  columns={EXPENSE_COLUMNS}
                  rowKey={(expense) => expense.id}
                  empty="No expenses in this period."
                />
              </OpenRows>
              {page.truncated && (
                <p className="border-t border-hairline bg-soft px-4 py-2.5 text-meta text-body">
                  Showing {units(page.expenses.length)} of {units(page.count)}.
                </p>
              )}
            </Card>

            {page.top_ups.length > 0 && (
              <Card>
                <CardHead
                  title="Float received"
                  aside={
                    <span className="text-metric font-semibold text-ink tabular-nums">
                      {money(
                        page.top_ups.reduce(
                          (sum, one) => sum + one.amount_minor,
                          0,
                        ),
                      )}
                    </span>
                  }
                />
                <OpenRows
                  onOpen={(id) => {
                    const row = page.top_ups.find((one) => one.id === id)
                    if (row === undefined) return
                    setOpen({ kind: "float", row })
                    setShowing(true)
                  }}
                >
                  <ListTable
                    rows={page.top_ups}
                    columns={TOP_UP_COLUMNS}
                    rowKey={(topUp) => topUp.id}
                    empty="None in this period."
                  />
                </OpenRows>
              </Card>
            )}
          </>
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
    card: "hide",
    className: "max-lg:hidden",
    cell: (expense) => categoryOf(expense.category)?.word ?? expense.category,
  },
  {
    id: "by",
    header: "By",
    card: "hide",
    cell: (expense) => expense.claimed_by,
  },
  {
    id: "when",
    header: "When",
    card: "hide",
    className: "tabular-nums",
    cell: (expense) => moment(expense.spent_at),
  },
  {
    id: "amount",
    header: "Amount",
    align: "right",
    card: "status",
    cell: (expense) => (
      <span className="font-medium text-ink tabular-nums">
        {money(expense.amount_minor)}
      </span>
    ),
  },
  {
    id: "summary",
    header: "",
    card: "meta",
    className: "hidden",
    cell: (expense) =>
      `${categoryOf(expense.category)?.word ?? expense.category} · ${moment(expense.spent_at)} · ${expense.claimed_by}`,
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
    card: "hide",
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
    card: "hide",
    cell: (topUp) => topUp.received_by,
  },
  {
    id: "counted",
    header: "Counted with",
    card: "hide",
    className: "max-lg:hidden",
    cell: (topUp) => topUp.approved_by,
  },
  {
    id: "amount",
    header: "Amount",
    align: "right",
    card: "status",
    cell: (topUp) => (
      <span className="font-medium text-ink tabular-nums">
        {money(topUp.amount_minor)}
      </span>
    ),
  },
  {
    id: "summary",
    header: "",
    card: "meta",
    className: "hidden",
    cell: (topUp) =>
      `${topUp.received_by} · ${topUp.approved_by}${
        topUp.reference === null ? "" : ` · ${topUp.reference}`
      }`,
  },
]

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
    <RecordSheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      id={expense.id.slice(0, 8)}
      title={expense.payee}
      caption={moment(expense.spent_at)}
      badge={<Pill tone="neutral">{kind?.word ?? expense.category}</Pill>}
    >
      <p className="mb-6 text-total font-semibold text-ink tabular-nums">
        {money(expense.amount_minor)}
      </p>
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
    </RecordSheet>
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
    <RecordSheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      id={topUp.reference ?? topUp.id.slice(0, 8)}
      title="Float received"
      caption={moment(topUp.received_at)}
      badge={<Pill tone="info">Float</Pill>}
    >
      <p className="mb-6 text-total font-semibold text-ink tabular-nums">
        {money(topUp.amount_minor)}
      </p>
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
    </RecordSheet>
  )
}

/// Record what was bought. Whoever is signed in records it; above Finance's
/// line the form asks for Finance's one-time code.
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
    <RecordSheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title="Record an expense"
      caption={`Balance ${money(position.balance_minor)}`}
      width="wide"
      footer={
        <div className="flex flex-col gap-3">
          {record.error !== null && (
            <Banner tone="bad">{record.error.message}</Banner>
          )}
          <Button
            type="submit"
            form="petty-spend"
            variant="primary"
            size="lg"
            block
            disabled={!ready || record.isPending}
          >
            <Banknote />
            {record.isPending ? "Recording…" : "Record"}
          </Button>
        </div>
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
            <Input
              inputMode="numeric"
              autoFocus
              invalid={overTin}
              value={amount}
              placeholder="45000"
              onChange={(event) => setAmount(event.target.value)}
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
              placeholder="Ojek Pak Dedi"
              onChange={(event) => setPayee(event.target.value)}
            />
          </Field>
          <Field label="For">
            <Input
              value={reason}
              placeholder="Antar paket ke pelanggan"
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
    </RecordSheet>
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
    <RecordSheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title="Float received"
      width="wide"
      footer={
        <div className="flex flex-col gap-3">
          {top.error !== null && (
            <Banner tone="bad">{top.error.message}</Banner>
          )}
          <Button
            type="submit"
            form="petty-float"
            variant="primary"
            size="lg"
            block
            disabled={!ready || top.isPending}
          >
            <PiggyBank />
            {top.isPending ? "Recording…" : "Record"}
          </Button>
        </div>
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
        <Field
          label="Amount"
          hint={minor === null ? undefined : money(minor)}
        >
          <Input
            inputMode="numeric"
            autoFocus
            value={amount}
            placeholder="2000000"
            onChange={(event) => setAmount(event.target.value)}
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
              placeholder="Pengisian kas kecil September"
              onChange={(event) => setNote(event.target.value)}
            />
          </Field>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <Field
            label="Counted with"
            problem={
              signingSelf
                ? "Someone else counts it with you."
                : undefined
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
    </RecordSheet>
  )
}
