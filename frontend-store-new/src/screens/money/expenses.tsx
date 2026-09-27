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
  Note,
  SpanPicker,
  Toolbar,
  TwoLine,
} from "@/screens/money/parts"
import type {
  PettyCashPosition,
  PettyCashTopUpView,
  StoreExpenseView,
  Supervisor,
} from "@itulah/contract"
import { money, units } from "@itulah/contract/money"

/// What this shop spends, and the one pot it is allowed to spend it from.
///
/// **A shop is not a place that pays.** Expenses are centralised at head office
/// and settled by transfer; what a shop holds is a small imprest float for the
/// daily things — iuran lingkungan, ATK, parkir, an ojek across town. So this
/// screen is about ONE pot, and it never offers the other two:
///
///   the **drawer** is the day's takings. It is banked, not spent. A till that
///   could pay for a light bulb is a till whose cash variance is unreadable,
///   because every shortfall then has an explanation available.
///
///   **modal kasir** is the cashier's opening float. It is fixed, it comes from
///   head office, and it lives with the shift at the till.
///
/// Laid out as the hub lays out a ledger: the tin in a strip of figures, the
/// book for a span as two tables — what went out, what came in — and each
/// record opening in a sheet. Recording is the screen's one primary act, and it
/// opens as a sheet too, over the book it is about to change.
///
/// The ceiling is on the screen BEFORE anybody types past it — in the strip
/// and on the amount field, from the node's own number rather than one spelled
/// here. A limit somebody only meets as a refusal is a limit they meet with the
/// receipt already in their hand and the money already gone.
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
      sub="Petty cash — the one pot this shop spends from. Head office hands the float over; every rupiah out of it is signed for by somebody else."
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
        loading: "Counting the petty cash…",
        render: (position) => (
          <>
            <TheTin position={position} />
            {done !== null && (
              <Banner tone="ok" className="mb-4">
                {done}
              </Banner>
            )}
            <TheBook />
            <Note>
              Petty cash is the only pot a shop spends from. The drawer holds
              the day&rsquo;s takings and is banked, not spent; modal kasir is
              the cashier&rsquo;s float and never pays for anything. Anything
              head office settles by transfer does not belong here.
            </Note>

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

/// What is in the tin.
///
/// A lifetime figure, not a span: the money head office handed over in July is
/// still in the tin in September, and a balance that only counted this month's
/// top-ups would report a shop as broke every first of the month. That is why
/// it sits above the span control rather than under it.
function TheTin({ position }: { position: PettyCashPosition }) {
  const left =
    position.float_in_minor > 0
      ? position.balance_minor / position.float_in_minor
      : 0
  return (
    <StatStrip>
      <Stat
        label="In the tin"
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
            "empty — ask head office to top it up"
          )
        }
      />
      <Stat
        label="Head office handed over"
        value={money(position.float_in_minor)}
        sub={
          position.last_top_up_at === null
            ? "nothing yet"
            : `${units(position.top_up_count)} times · last ${moment(position.last_top_up_at)}`
        }
      />
      <Stat
        label="Spent from it"
        value={money(position.spent_minor)}
        sub={`${units(position.expense_count)} ${position.expense_count === 1 ? "receipt" : "receipts"}`}
      />
      <Stat
        label="A manager may sign"
        value={`up to ${money(position.manager_limit_minor)}`}
        sub="above that, head office signs"
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
        loading: "Reading the petty cash book…",
        render: (page) => (
          <>
            <Card className="mb-4">
              <CardHead
                title="What was spent"
                sub={
                  page.count === 0
                    ? undefined
                    : `${units(page.count)} ${page.count === 1 ? "receipt" : "receipts"} in this span`
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
                  empty="Nothing was paid out of petty cash in this span. Small daily needs are recorded here as they are bought, one receipt at a time."
                />
              </OpenRows>
              {page.truncated && (
                <p className="border-t border-hairline bg-soft px-4 py-2.5 text-meta text-body">
                  Showing {units(page.expenses.length)} of {units(page.count)}.
                  The total above covers every one of them.
                </p>
              )}
            </Card>

            {page.top_ups.length > 0 && (
              <Card>
                <CardHead
                  title="What head office handed over"
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
                    empty="Head office handed nothing over in this span."
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

const approverWord = (role: string) =>
  role === "ADMIN" ? "head office" : "manager"

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
    id: "signed",
    header: "Signed by",
    card: "hide",
    cell: (expense) => (
      <span>
        {expense.approved_by}
        <span className="ml-1.5 text-mute">
          {approverWord(expense.approved_role)}
        </span>
      </span>
    ),
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
      `${categoryOf(expense.category)?.word ?? expense.category} · ${moment(expense.spent_at)} · signed ${expense.approved_by}`,
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
      `Taken by ${topUp.received_by}, counted with ${topUp.approved_by}${
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
      caption={`${moment(expense.spent_at)} · out of petty cash`}
      badge={<Pill tone="neutral">{kind?.word ?? expense.category}</Pill>}
    >
      <p className="mb-6 text-total font-semibold text-ink tabular-nums">
        {money(expense.amount_minor)}
      </p>
      <Facts>
        <Fact term="What it was for" wide>
          {expense.reason}
        </Fact>
        <Fact term="Kind of cost">{kind?.word ?? expense.category}</Fact>
        <Fact term="When">{moment(expense.spent_at)}</Fact>
        <Fact term="Claimed by">{expense.claimed_by}</Fact>
        <Fact term="Approved by">
          {expense.approved_by}{" "}
          <span className="text-mute">
            ({approverWord(expense.approved_role)})
          </span>
        </Fact>
      </Facts>
      <Note className="mt-6">
        Two people on every rupiah: whoever spent it does not approve it. Which
        rung signed is kept with the expense, because the limit may move and an
        audit months later asks who was allowed to approve this, then.
      </Note>
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
      caption={`${moment(topUp.received_at)} · into petty cash`}
      badge={<Pill tone="info">Float</Pill>}
    >
      <p className="mb-6 text-total font-semibold text-ink tabular-nums">
        {money(topUp.amount_minor)}
      </p>
      <Facts>
        <Fact term="Taken by">{topUp.received_by}</Fact>
        <Fact term="Counted with">{topUp.approved_by}</Fact>
        <Fact term="Head office reference">{topUp.reference ?? "—"}</Fact>
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

/// Record what was bought — a task, so it opens as the wide sheet with its
/// button pinned at the foot, above a phone's keyboard.
///
/// Three of the node's refusals are drawn here before the send, because a
/// refusal that arrives after somebody has typed a supervisor's password is a
/// refusal that cost a secret for nothing:
///
///   - the **ceiling** stands on the amount field from the moment the sheet
///     opens, and the approval it asks for changes the instant the amount goes
///     past it;
///   - the **tin** is what it is, and an expense larger than the balance is
///     money that did not come out of the tin;
///   - the **approver is not the claimant**, which this screen can see because
///     it knows who is signed in.
///
/// Everything else is the node's to refuse, and its sentence is repeated
/// verbatim rather than translated into a code.
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
  const identity = useIdentity()
  const [category, setCategory] = useState<string>("expense_household")
  const [amount, setAmount] = useState("")
  const [payee, setPayee] = useState("")
  const [reason, setReason] = useState("")
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")

  const minor = minorFrom(amount)
  const overLimit = minor !== null && minor > position.manager_limit_minor
  const overTin = minor !== null && minor > position.balance_minor
  const claimant = identity.data?.username ?? ""
  const approvingSelf =
    claimant !== "" && username.trim().toLowerCase() === claimant.toLowerCase()

  const ready =
    minor !== null &&
    minor > 0 &&
    !overTin &&
    !approvingSelf &&
    payee.trim() !== "" &&
    reason.trim() !== "" &&
    username.trim() !== "" &&
    password !== ""

  return (
    <RecordSheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title="Record an expense"
      caption={`${money(position.balance_minor)} in the tin`}
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
            {record.isPending ? "Recording…" : "Record it"}
          </Button>
        </div>
      }
    >
      <form
        id="petty-spend"
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          if (!ready || record.isPending || minor === null) return
          const supervisor: Supervisor = {
            username: username.trim(),
            password,
          }
          record.mutate(
            {
              category,
              amountMinor: minor,
              payee: payee.trim(),
              reason: reason.trim(),
              supervisor,
            },
            {
              onSuccess: () => {
                onDone(
                  `Recorded: ${money(minor)} to ${payee.trim()}, out of petty cash.`,
                )
                setAmount("")
                setPayee("")
                setReason("")
                setPassword("")
              },
            },
          )
        }}
      >
        <Field label="What kind of cost">
          <Select value={category} onChange={setCategory}>
            {CATEGORIES.map((one) => (
              <option key={one.code} value={one.code}>
                {one.word}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="How much"
          hint={
            minor === null
              ? `${money(position.manager_limit_minor)} or less and the manager signs. Above that, head office has to.`
              : `${money(minor)} — ${money(position.balance_minor)} in the tin.`
          }
          problem={
            overTin
              ? `The tin holds ${money(position.balance_minor)}. The drawer and the day's takings are not available for this: ask head office to top the float up, or to pay it by transfer.`
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

        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Who was paid">
            <Input
              value={payee}
              placeholder="Ojek Pak Dedi"
              onChange={(event) => setPayee(event.target.value)}
            />
          </Field>
          <Field label="What it was for">
            <Input
              value={reason}
              placeholder="Antar paket ke pelanggan"
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
        </div>

        {overLimit && (
          <Banner tone="warn">
            Above {money(position.manager_limit_minor)} the shop&rsquo;s own
            manager may not approve this. Head office signs — or sends it back
            to be paid by transfer.
          </Banner>
        )}

        <div className="rounded-card border border-hairline bg-soft p-4">
          <p className="mb-3 text-meta text-body">
            {overLimit
              ? "Head office signs here. Whoever is signed in stays signed in."
              : "Every rupiah out of the tin is signed for by somebody else. They sign here — whoever is signed in stays signed in."}
          </p>
          <div className="grid gap-4 md:grid-cols-2">
            <Field
              label={overLimit ? "Head office" : "Manager or head office"}
              problem={
                approvingSelf
                  ? "The person who spent the money does not approve it. Somebody else signs."
                  : undefined
              }
            >
              <Input
                autoComplete="off"
                invalid={approvingSelf}
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
        </div>
      </form>
    </RecordSheet>
  )
}

/// The float coming in.
///
/// Not an expense and not a sale: this is the imprest being put back, against a
/// transfer head office already made. Two people sign, because that is what
/// handing over cash is — and the node refuses the one who took it signing for
/// it as well.
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
      title="Float received from head office"
      caption="The imprest going back into the tin"
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
            {top.isPending ? "Recording…" : "Record the float"}
          </Button>
        </div>
      }
    >
      <form
        id="petty-float"
        className="flex flex-col gap-4"
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
                onDone(`Recorded: ${money(minor)} put back into the tin.`)
                setAmount("")
                setReference("")
                setNote("")
                setPassword("")
              },
            },
          )
        }}
      >
        <p className="text-meta text-body">
          Count the cash first, then type what was handed over. This is the
          float going back into the tin — what it paid for was written down one
          receipt at a time as it was spent.
        </p>
        <Field
          label="How much"
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
        <div className="grid gap-4 md:grid-cols-2">
          <Field
            label="Head office reference"
            hint="Optional — the slip or transfer number, if the shop was given one."
          >
            <Input
              value={reference}
              placeholder="TRF-2026-09-13-001"
              onChange={(event) => setReference(event.target.value)}
            />
          </Field>
          <Field label="Anything to note" hint="Optional.">
            <Input
              value={note}
              placeholder="Pengisian kas kecil September"
              onChange={(event) => setNote(event.target.value)}
            />
          </Field>
        </div>

        <div className="rounded-card border border-hairline bg-soft p-4">
          <p className="mb-3 text-meta text-body">
            Handing over cash takes two people. Whoever counted it with you
            signs here.
          </p>
          <div className="grid gap-4 md:grid-cols-2">
            <Field
              label="Counted with"
              problem={
                signingSelf
                  ? "The person who took the money does not also sign for it. Somebody else counts it with them."
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
        </div>
      </form>
    </RecordSheet>
  )
}
