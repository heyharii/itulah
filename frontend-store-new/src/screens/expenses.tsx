import { useState } from "react"
import {
  Banknote,
  Bus,
  Droplets,
  HandCoins,
  Lightbulb,
  Paintbrush,
  Phone,
  PiggyBank,
  Receipt,
  ShoppingBasket,
  Wrench,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, RecordCard } from "@/components/ui/card"
import { Field, Input, Select } from "@/components/ui/field"
import { Meter } from "@/components/ui/meter"
import { Pill } from "@/components/ui/pill"
import { KeyValue, TotalsLadder } from "@/components/ui/rows"
import { CardList, Screen, Section } from "@/components/ui/screen"
import { Segmented } from "@/components/ui/segmented"
import { Banner, EmptyState } from "@/components/ui/states"
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
import type {
  PettyCashPosition,
  StoreExpenseView,
  Supervisor,
} from "@itulah/contract"
import { money } from "@itulah/contract/money"

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
///   head office, and it lives on the Shift screen.
///
/// The ceiling is on the screen BEFORE anybody types past it — standing on the
/// amount field, from the node's own number rather than one spelled here. A
/// limit somebody only meets as a refusal is a limit they meet with the receipt
/// already in their hand and the money already gone.
export function Expenses() {
  const tin = usePettyCash()
  const [pane, setPane] = useState<"book" | "spend" | "float">("book")

  return (
    <Screen>
      {queryState(tin, {
        loading: "Counting the petty cash…",
        render: (position) => (
          <>
            <TheTin position={position} />

            <div className="mb-4 flex flex-wrap gap-2">
              {(
                [
                  ["book", "The book"],
                  ["spend", "Record an expense"],
                  ["float", "Head office handed over"],
                ] as const
              ).map(([key, word]) => (
                <Button
                  key={key}
                  variant={pane === key ? "primary" : "ghost"}
                  onClick={() => setPane(key)}
                >
                  {word}
                </Button>
              ))}
            </div>

            {pane === "book" && <TheBook />}
            {pane === "spend" && (
              <SpendPane position={position} onDone={() => setPane("book")} />
            )}
            {pane === "float" && <FloatPane onDone={() => setPane("book")} />}
          </>
        ),
      })}
    </Screen>
  )
}

/// Rupiah in, as digits.
///
/// The same parser the Shift screen uses, and for the same reason: a field that
/// accepted "Rp 500.000" and one that accepted "500000" would be two parsers,
/// and the one nobody tested is the one a cashier uses.
function minorFrom(text: string): number | null {
  const digits = text.replace(/\D/g, "")
  if (digits === "") return null
  const value = Number(digits)
  return Number.isSafeInteger(value) ? value : null
}

/// What is in the tin.
///
/// A lifetime figure, not a span: the money head office handed over in July is
/// still in the tin in September, and a balance that only counted this month's
/// top-ups would report a shop as broke every first of the month. That is why
/// it sits above the span control rather than inside it.
function TheTin({ position }: { position: PettyCashPosition }) {
  const left =
    position.float_in_minor > 0
      ? position.balance_minor / position.float_in_minor
      : 0
  return (
    <Section
      title="Petty cash"
      action={
        <Pill tone={position.balance_minor > 0 ? "ok" : "warn"}>
          {position.balance_minor > 0 ? "Funded" : "Empty"}
        </Pill>
      }
    >
      <Card className="px-4 py-3">
        <TotalsLadder
          rows={[
            {
              label: `Head office handed over (${position.top_up_count})`,
              value: money(position.float_in_minor),
            },
            {
              label: `Spent (${position.expense_count})`,
              value: `−${money(position.spent_minor)}`,
              tone: "bad",
            },
          ]}
          total={{ label: "In the tin", value: money(position.balance_minor) }}
        />
        <Meter
          className="mt-3"
          value={left}
          tone={left > 0.25 ? "accent" : left > 0.1 ? "warn" : "bad"}
        />
      </Card>
      {position.last_top_up_at !== null && (
        <Card className="mt-2.5 px-4 py-1">
          <KeyValue term="Last handed over">
            {moment(position.last_top_up_at)}
          </KeyValue>
        </Card>
      )}
      <Banner tone="info" className="mt-2.5">
        Petty cash is the only pot a shop spends from. The drawer holds the
        day&rsquo;s takings and is banked, not spent; modal kasir is the
        cashier&rsquo;s float and never pays for anything. Anything head office
        settles by transfer does not belong here.
      </Banner>
    </Section>
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

  return (
    <>
      <div className="pb-4">
        <Segmented
          options={SPANS}
          value={(span.value ?? "1") as (typeof SPANS)[number]["value"]}
          onChange={(next) => span.set(next)}
        />
      </div>

      {queryState(book, {
        loading: "Reading the petty cash book…",
        render: (page) => (
          <>
            <Section
              title="What was spent"
              action={
                <span className="text-cell font-semibold text-ink tabular-nums">
                  {money(page.spent_minor)}
                </span>
              }
            >
              {page.expenses.length === 0 ? (
                <EmptyState>
                  Nothing was paid out of petty cash in this span. Small daily
                  needs are recorded here as they are bought, one receipt at a
                  time.
                </EmptyState>
              ) : (
                <CardList>
                  {page.expenses.map((one) => (
                    <ExpenseCard key={one.id} expense={one} />
                  ))}
                </CardList>
              )}
              {page.truncated && (
                <Banner tone="info" className="mt-2.5">
                  Showing {page.expenses.length} of {page.count}. The total
                  above covers every one of them.
                </Banner>
              )}
            </Section>

            {page.top_ups.length > 0 && (
              <Section title="What head office handed over">
                <CardList>
                  {page.top_ups.map((one) => (
                    <RecordCard
                      key={one.id}
                      icon={<PiggyBank />}
                      id={money(one.amount_minor)}
                      status={<Pill tone="info">Float</Pill>}
                    >
                      <div className="px-4 py-1">
                        <KeyValue term="Reference">
                          {one.reference ?? "—"}
                        </KeyValue>
                        <KeyValue term="Taken by">{one.received_by}</KeyValue>
                        <KeyValue term="Counted with">
                          {one.approved_by}
                        </KeyValue>
                        <KeyValue term="When">
                          {moment(one.received_at)}
                        </KeyValue>
                      </div>
                    </RecordCard>
                  ))}
                </CardList>
              </Section>
            )}
          </>
        ),
      })}
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

function ExpenseCard({ expense }: { expense: StoreExpenseView }) {
  const kind = categoryOf(expense.category)
  const Icon = kind?.icon ?? ShoppingBasket
  return (
    <RecordCard
      icon={<Icon />}
      id={expense.payee}
      status={
        <span className="text-cell font-semibold text-ink tabular-nums">
          {money(expense.amount_minor)}
        </span>
      }
    >
      <div className="px-4 py-1">
        <KeyValue term={kind?.word ?? expense.category}>
          {expense.reason}
        </KeyValue>
        <KeyValue term="Claimed by">{expense.claimed_by}</KeyValue>
        <KeyValue term="Approved by">
          {expense.approved_by}
          <span className="ml-1.5 font-normal text-mute">
            {expense.approved_role === "ADMIN" ? "head office" : "manager"}
          </span>
        </KeyValue>
        <KeyValue term="When">{moment(expense.spent_at)}</KeyValue>
      </div>
    </RecordCard>
  )
}

/// Record what was bought.
///
/// Three of the node's refusals are drawn here before the send, because a
/// refusal that arrives after somebody has typed a supervisor's password is a
/// refusal that cost a secret for nothing:
///
///   - the **ceiling** stands on the amount field from the moment the pane
///     opens, and the approval it asks for changes the instant the amount goes
///     past it;
///   - the **tin** is what it is, and an expense larger than the balance is
///     money that did not come out of the tin;
///   - the **approver is not the claimant**, which this screen can see because
///     it knows who is signed in.
///
/// Everything else is the node's to refuse, and its sentence is repeated
/// verbatim rather than translated into a code.
function SpendPane({
  position,
  onDone,
}: {
  position: PettyCashPosition
  onDone: () => void
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
    <Section title="Record an expense">
      <Card className="flex flex-col gap-4 p-4">
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

        {overLimit && (
          <Banner tone="warn">
            Above {money(position.manager_limit_minor)} the shop&rsquo;s own
            manager may not approve this. Head office signs — or sends it back
            to be paid by transfer.
          </Banner>
        )}

        <p className="text-meta text-body">
          {overLimit
            ? "Head office signs here. The cashier stays signed in."
            : "Every rupiah out of the tin is signed for by somebody else. They sign here — whoever is at the counter stays signed in."}
        </p>
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

        {record.error !== null && (
          <Banner tone="bad">{record.error.message}</Banner>
        )}

        <Button
          variant="primary"
          size="lg"
          block
          disabled={!ready || record.isPending}
          onClick={() => {
            if (minor === null) return
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
                  setAmount("")
                  setPayee("")
                  setReason("")
                  setPassword("")
                  onDone()
                },
              },
            )
          }}
        >
          <Banknote />
          {record.isPending ? "Recording…" : "Record it"}
        </Button>
      </Card>
    </Section>
  )
}

/// The float coming in.
///
/// Not an expense and not a sale: this is the imprest being put back, against a
/// transfer head office already made. Two people sign, because that is what
/// handing over cash is — and the node refuses the one who took it signing for
/// it as well.
function FloatPane({ onDone }: { onDone: () => void }) {
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
    <Section title="Head office handed over">
      <Card className="flex flex-col gap-4 p-4">
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

        {top.error !== null && <Banner tone="bad">{top.error.message}</Banner>}

        <Button
          variant="primary"
          size="lg"
          block
          disabled={!ready || top.isPending}
          onClick={() => {
            if (minor === null) return
            top.mutate(
              {
                amountMinor: minor,
                reference,
                note,
                supervisor: { username: username.trim(), password },
              },
              {
                onSuccess: () => {
                  setAmount("")
                  setReference("")
                  setNote("")
                  setPassword("")
                  onDone()
                },
              },
            )
          }}
        >
          <PiggyBank />
          {top.isPending ? "Recording…" : "Record the float"}
        </Button>
      </Card>
    </Section>
  )
}
