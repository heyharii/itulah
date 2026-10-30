import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import {
  Check,
  Equal,
  Fingerprint,
  Minus,
  Pause,
  Plus,
  Receipt,
  Smartphone,
  Store,
  Users,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { DockTools } from "@/components/shell/dock-tools"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Field, Input, Checkbox, Money } from "@/components/ui/field"
import { Fab } from "@/components/ui/fab"
import { FilterChips } from "@/components/ui/filter-chips"
import { Choices, Section, Stepper, type Tile } from "@/components/ui/form"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { MiniCell, MiniRow, MiniTable } from "@/components/ui/rows"
import { ExpandingSearch } from "@/components/ui/list-chrome"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { SheetFooter } from "@/components/ui/sheet-footer"
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states"
import { day, dayMonth, money, moment } from "@/lib/format"
import {
  adjustBenefit,
  BENEFIT_KIND_LABEL,
  benefitAccount,
  benefitBalancesQuery,
  benefitKeys,
  benefitMovements,
  benefitSettingsQuery,
  signedMinor,
  stateBenefitSetting,
  type BenefitAction,
} from "@/lib/queries/hr-benefit"
import { useEveryEmployee, useNameOfLogin } from "@/lib/queries/hr-employees"
import { useReachableUnits } from "@/lib/queries/people"
import { queryState } from "@/lib/query-state"
import { useCanWrite } from "@/lib/session"
import { toast } from "@/lib/toast"
import { cn } from "@/lib/utils"
import { AdjustSheet } from "@/screens/people/benefit-form"
import { Quiet } from "@/screens/people/parts"
import { useOpener } from "@/screens/people/settings-lib"
import type {
  BenefitBalanceRow,
  BenefitMovementRow,
  BenefitSettingView,
} from "@itulah/contract"

/// Commercial › Employee discount — what each employee has to spend at the till.
///
/// One page, no tabs (prototype A): the four figures, the state line (on or
/// off, how it opens, how long a code lasts), the people with their balance,
/// and three sheets — a person's account, filling balances, and the setting.
/// HR fills by hand: add, take off or set to, each with a reason and no second
/// approval, for one person or many. What is unspent carries over.
///
/// What is derived here, not served: this month's spent / filled come from the
/// month's movements, "Last used" from the last 90 days of SPEND movements, a
/// person's role from the employee list's position.

const pad = (n: number) => String(n).padStart(2, "0")
const isoOf = (date: Date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`

type Show = "all" | "has" | "empty" | "used"

interface Person {
  readonly id: string
  readonly name: string
  readonly code: string
  readonly role: string
  readonly unit: string
  readonly balance: number
  readonly spent: number
  readonly filled: number
  readonly last: { readonly at: string; readonly where: string | null } | null
}

const nameOf = (row: BenefitBalanceRow) => row.full_name ?? row.employee_code

export function BenefitPage() {
  const canWrite = useCanWrite()
  const [search, setSearch] = useState("")
  const [show, setShow] = useState<Show>("all")
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set())
  const fill = useOpener<readonly string[]>()
  const person = useOpener<string>()
  const setting = useOpener()

  const balances = useQuery(benefitBalancesQuery())
  const settings = useQuery(benefitSettingsQuery())
  const employees = useEveryEmployee()
  const reachable = useReachableUnits()

  const now = new Date()
  const today = isoOf(now)
  const monthStart = isoOf(new Date(now.getFullYear(), now.getMonth(), 1))
  const back90 = isoOf(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 90))
  const mon = now.toLocaleDateString("en-GB", { month: "short" })

  const month = useQuery({
    queryKey: benefitKeys.movements(monthStart, today, null),
    queryFn: ({ signal }) => benefitMovements(monthStart, today, null, signal),
  })
  const recent = useQuery({
    queryKey: benefitKeys.movements(back90, today, null),
    queryFn: ({ signal }) => benefitMovements(back90, today, null, signal),
  })

  const unitName = (id: string | null) =>
    id === null
      ? null
      : (reachable.data?.find((one) => one.id === id)?.name ?? id)

  const people: readonly Person[] = useMemo(() => {
    const spent = new Map<string, number>()
    const filled = new Map<string, number>()
    for (const move of month.data ?? []) {
      const sum = (map: Map<string, number>, by: number) =>
        map.set(move.employee_id, (map.get(move.employee_id) ?? 0) + by)
      if (move.kind === "SPEND") sum(spent, Math.abs(move.delta_minor))
      else if (move.kind === "RETURN") sum(spent, -Math.abs(move.delta_minor))
      else if (move.kind === "ADD") sum(filled, Math.abs(move.delta_minor))
    }
    const last = new Map<string, BenefitMovementRow>()
    for (const move of recent.data ?? []) {
      if (move.kind !== "SPEND") continue
      const seen = last.get(move.employee_id)
      if (seen === undefined || move.at > seen.at) last.set(move.employee_id, move)
    }
    return (balances.data ?? []).map((row) => {
      const one = employees.data?.find(
        (each) => each.employee_id === row.employee_id
      )
      const spentBy = Math.max(0, spent.get(row.employee_id) ?? 0)
      const unit =
        one?.unit_name ?? unitName(row.unit_id) ?? "—"
      const lastMove = last.get(row.employee_id)
      return {
        id: row.employee_id,
        name: nameOf(row),
        code: row.employee_code,
        role: one?.position ?? unit,
        unit,
        balance: row.balance_minor,
        spent: spentBy,
        filled: filled.get(row.employee_id) ?? 0,
        last:
          lastMove === undefined
            ? null
            : { at: lastMove.at, where: unitName(lastMove.unit_id) },
      }
    })
    // unitName reads `reachable.data`, listed here through it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [balances.data, month.data, recent.data, employees.data, reachable.data])

  const count = (pick: (one: Person) => boolean) => people.filter(pick).length
  const counts = {
    all: people.length,
    has: count((one) => one.balance > 0),
    empty: count((one) => one.balance === 0),
    used: count((one) => one.spent > 0),
  }
  const needle = search.trim().toLowerCase()
  const shown = people.filter(
    (one) =>
      (show === "all" ||
        (show === "has" && one.balance > 0) ||
        (show === "empty" && one.balance === 0) ||
        (show === "used" && one.spent > 0)) &&
      (needle === "" ||
        `${one.name} ${one.unit} ${one.role} ${one.code}`
          .toLowerCase()
          .includes(needle))
  )
  const allShown = shown.length > 0 && shown.every((one) => picked.has(one.id))

  const toggle = (id: string, on: boolean) => {
    const next = new Set(picked)
    if (on) next.add(id)
    else next.delete(id)
    setPicked(next)
  }
  const toggleAll = (on: boolean) => {
    const next = new Set(picked)
    for (const one of shown) {
      if (on) next.add(one.id)
      else next.delete(one.id)
    }
    setPicked(next)
  }
  const fillPicked = () => fill.show([...picked])
  const fillLabel = `Fill ${picked.size} balance${picked.size === 1 ? "" : "s"}`

  const current = settings.data?.[0]
  const on = current?.enabled === true
  const owed = people.reduce((sum, one) => sum + one.balance, 0)
  const spentAll = people.reduce((sum, one) => sum + one.spent, 0)
  const filledAll = people.reduce((sum, one) => sum + one.filled, 0)
  const ready = balances.data !== undefined
  const figure = (value: number) => (ready ? money(value) : "—")

  const filters = [
    { value: null, label: "All", count: counts.all },
    { value: "has", label: "Has balance", icon: Wallet, count: counts.has },
    { value: "empty", label: "Empty", icon: Minus, count: counts.empty },
    { value: "used", label: `Used in ${mon}`, icon: Receipt, count: counts.used },
  ]

  return (
    <>
      <PageHeader
        crumb="Commercial"
        title="Employee discount"
        actions={
          canWrite && (
            <Button variant="primary" onClick={() => fill.show([...picked])}>
              <Plus size={16} /> Fill balances
            </Button>
          )
        }
      />
      <PageContent>
        <KpiStrip className="md:grid-cols-4 xl:grid-cols-4">
          <Kpi label="Balance owed" value={figure(owed)} />
          <Kpi label={`Spent in ${mon}`} value={figure(spentAll)} />
          <Kpi label={`Filled in ${mon}`} value={figure(filledAll)} />
          <Kpi
            label="Empty"
            value={
              <span className={cn(counts.empty > 0 && "text-bad-fg")}>
                {ready ? counts.empty : "—"}
              </span>
            }
          />
        </KpiStrip>

        <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-card border border-hairline bg-canvas px-4 py-2.5 text-[0.9375rem] text-ink">
          <Pill tone={on ? "ok" : "neutral"} withDot>
            {on ? "On" : "Off"}
          </Pill>
          <span className="inline-flex items-center gap-1.5">
            <Fingerprint className="size-4 text-line-ico" />
            Opened by finger
          </span>
          {current !== undefined && (
            <span className="text-mute">
              Code lasts {current.code_minutes} min
            </span>
          )}
          <span className="ml-auto" />
          {canWrite && (
            <Button variant="primary" onClick={() => setting.show()}>
              Change
            </Button>
          )}
        </div>

        <div className="mb-3.5 flex flex-wrap items-center gap-x-4 gap-y-2.5 max-md:hidden">
          <div className="group/bar flex w-80">
            <ExpandingSearch
              value={search}
              onChange={setSearch}
              label="Search people"
            />
          </div>
          <FilterChips
            label="Show"
            value={show === "all" ? null : show}
            onChange={(next) => setShow((next as Show | null) ?? "all")}
            options={filters}
          />
        </div>
        {canWrite && (
          <Fab
            label={picked.size > 0 ? fillLabel : "Fill balances"}
            onClick={() => fill.show([...picked])}
          />
        )}
        <DockTools
          search={{ value: search, onChange: setSearch, label: "Search people" }}
          status={{
            value: show,
            options: filters.map((one) => ({
              value: one.value ?? "all",
              label: one.label,
              count: one.count,
            })),
            onChange: (next) => setShow(next as Show),
          }}
        />

        {balances.isPending ? (
          <LoadingState>Reading the balances…</LoadingState>
        ) : balances.isError ? (
          <ErrorState
            error={balances.error}
            onRetry={() => void balances.refetch()}
          />
        ) : shown.length === 0 ? (
          <EmptyState>Nobody matches.</EmptyState>
        ) : (
          <Card className="overflow-hidden">
            <table className="w-full border-collapse text-[0.9375rem]">
              <thead>
                <tr className="text-left text-mute">
                  <th className="w-11 py-3 pl-4 font-medium">
                    <Checkbox
                      label={<span className="sr-only">Select everyone shown</span>}
                      checked={allShown}
                      indeterminate={
                        !allShown && shown.some((one) => picked.has(one.id))
                      }
                      onChange={toggleAll}
                    />
                  </th>
                  <th className="px-4 py-3 font-medium">Employee</th>
                  <th className="px-4 py-3 font-medium max-md:hidden">Unit</th>
                  <th className="px-4 py-3 text-right font-medium">Balance</th>
                  <th className="px-4 py-3 text-right font-medium max-md:hidden">
                    Spent in {mon}
                  </th>
                  <th className="px-4 py-3 font-medium max-md:hidden">
                    Last used
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((one) => (
                  <tr
                    key={one.id}
                    onClick={() => person.show(one.id)}
                    className="cursor-pointer border-t border-hairline hover:bg-soft"
                  >
                    <td
                      className="py-3 pl-4"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <Checkbox
                        label={<span className="sr-only">Select {one.name}</span>}
                        checked={picked.has(one.id)}
                        onChange={(on2) => toggle(one.id, on2)}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-ink">{one.name}</div>
                      <div className="text-mute">{one.role}</div>
                    </td>
                    <td className="px-4 py-3 max-md:hidden">{one.unit}</td>
                    <td
                      className={cn(
                        "px-4 py-3 text-right tabular-nums",
                        one.balance === 0 ? "text-mute" : "text-ink"
                      )}
                    >
                      {money(one.balance)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums max-md:hidden">
                      {one.spent > 0 ? money(one.spent) : <span className="text-mute">—</span>}
                    </td>
                    <td className="px-4 py-3 max-md:hidden">
                      {one.last === null ? (
                        <span className="text-mute">—</span>
                      ) : (
                        lastWord(one.last)
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}

        {picked.size > 0 && (
          <div className="sticky bottom-3 z-10 mt-4 flex items-center gap-3 rounded-card border border-hairline bg-canvas px-4 py-2.5 shadow-soft max-md:static">
            <b className="font-semibold text-ink">{picked.size} picked</b>
            <Button variant="primary" onClick={() => setPicked(new Set())}>
              Clear
            </Button>
            <span className="ml-auto" />
            {canWrite && (
              <Button variant="primary" onClick={fillPicked}>
                {fillLabel}
              </Button>
            )}
          </div>
        )}
      </PageContent>

      {person.isOpen && person.item !== null && (
        <PersonSheet
          key={`person-${person.n}`}
          person={people.find((one) => one.id === person.item) ?? null}
          mon={mon}
          unitName={unitName}
          onClose={person.hide}
          onFill={(id) => fill.show([id])}
          canWrite={canWrite}
        />
      )}
      {fill.isOpen && (
        <FillSheet
          key={`fill-${fill.n}`}
          start={fill.item ?? []}
          people={people}
          onClose={fill.hide}
          onDone={() => setPicked(new Set())}
        />
      )}
      {setting.isOpen && (
        <SettingSheet
          key={`setting-${setting.n}`}
          rows={settings.data ?? []}
          today={today}
          onClose={setting.hide}
        />
      )}
    </>
  )
}

/// "27 Oct · Store 01".
function lastWord(last: { at: string; where: string | null }) {
  return `${dayMonth(last.at)}${last.where === null ? "" : ` · ${last.where}`}`
}

// ── a person ────────────────────────────────────────────────────────────────

const WHAT: Readonly<Record<string, string>> = {
  ADD: "Added",
  REMOVE: "Taken off",
  RESET: "Set to",
  SPEND: "Spent",
  RETURN: "Returned",
}

function PersonSheet({
  person,
  mon,
  unitName,
  onClose,
  onFill,
  canWrite,
}: {
  person: Person | null
  mon: string
  unitName: (id: string | null) => string | null
  onClose: () => void
  onFill: (id: string) => void
  canWrite: boolean
}) {
  const nameOfLogin = useNameOfLogin()
  const id = person?.id ?? ""
  const account = useQuery({
    queryKey: benefitKeys.account(id),
    queryFn: ({ signal }) => benefitAccount(id, signal),
    enabled: person !== null,
  })
  if (person === null) return null
  return (
    <Sheet
      open
      onOpenChange={(next) => !next && onClose()}
      context="Employee discount"
      title={person.name}
      caption={`${person.role} · ${person.unit}`}
      footer={
        canWrite ? (
          <SheetFooter
            primary={{ label: "Fill balance", onClick: () => onFill(person.id) }}
          />
        ) : undefined
      }
    >
      <div className="flex flex-col gap-6">
        <div>
          <div className="text-[0.9375rem] text-mute">Balance</div>
          <div className="text-hero font-semibold tabular-nums">
            {money(person.balance)}
          </div>
        </div>
        <Facts>
          <Fact term={`Spent in ${mon}`}>{money(person.spent)}</Fact>
          <Fact term={`Filled in ${mon}`}>{money(person.filled)}</Fact>
          <Fact term="Last used">
            {person.last === null ? "—" : lastWord(person.last)}
          </Fact>
        </Facts>
        <Section
          title="Movements"
          aside={account.data ? account.data.entries.length : undefined}
        >
          {queryState(account, {
            loading: "Reading the account…",
            render: (view) =>
              view.entries.length === 0 ? (
                <Quiet>No movement yet.</Quiet>
              ) : (
                <div className="flex flex-col">
                  {view.entries.map((entry) => (
                    <div
                      key={entry.id}
                      className="grid grid-cols-[1fr_auto] gap-x-4 border-t border-hairline py-3 first:border-t-0"
                    >
                      <span className="text-ink">
                        {WHAT[entry.kind] ?? BENEFIT_KIND_LABEL[entry.kind] ?? entry.kind}
                        {entry.kind === "RESET" && ` ${money(entry.balance_after)}`}
                      </span>
                      <span
                        className={cn(
                          "text-right tabular-nums",
                          entry.delta_minor < 0 ? "text-bad-fg" : "text-ink"
                        )}
                      >
                        {entry.kind === "RESET"
                          ? ""
                          : signedMinor(entry.delta_minor, money)}
                      </span>
                      <span className="col-span-2 text-mute">
                        {day(entry.at)} ·{" "}
                        {entry.sale_ref !== null
                          ? `${unitName(entry.unit_id) ?? "—"} · ${entry.sale_ref}`
                          : `${nameOfLogin(entry.by)} · ${entry.reason}`}
                      </span>
                    </div>
                  ))}
                </div>
              ),
          })}
        </Section>
      </div>
    </Sheet>
  )
}

// ── filling ─────────────────────────────────────────────────────────────────

const ACTION_TILES: readonly Tile<BenefitAction>[] = [
  { value: "ADD", label: "Add", icon: Plus },
  { value: "REMOVE", label: "Take off", icon: Minus },
  { value: "RESET", label: "Set to", icon: Equal },
]

function Chip({
  icon: Glyph,
  label,
  count,
  on,
  onClick,
}: {
  icon?: LucideIcon
  label: string
  count?: number
  on?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-[0.9375rem] font-medium transition-colors",
        on
          ? "border-accent bg-accent-bg text-accent"
          : "border-hairline-2 bg-canvas text-ink hover:bg-soft"
      )}
    >
      {Glyph && <Glyph className="size-4" />}
      {label}
      {count !== undefined && <span className="text-mute">{count}</span>}
      {on && <X className="size-3.5" />}
    </button>
  )
}

function FillSheet({
  start,
  people,
  onClose,
  onDone,
}: {
  start: readonly string[]
  people: readonly Person[]
  onClose: () => void
  onDone: () => void
}) {
  const client = useQueryClient()
  const [ids, setIds] = useState<readonly string[]>(start)
  const [action, setAction] = useState<BenefitAction>("ADD")
  const [amount, setAmount] = useState("")
  const [why, setWhy] = useState("")
  const chosen = ids
    .map((id) => people.find((one) => one.id === id))
    .filter((one): one is Person => one !== undefined)
  const units = [...new Set(people.map((one) => one.unit))].filter(
    (one) => one !== "—"
  )
  const value = amount === "" ? 0 : Number(amount)
  const after = (one: Person) =>
    action === "ADD"
      ? one.balance + value
      : action === "REMOVE"
        ? Math.max(0, one.balance - value)
        : value
  const ok =
    chosen.length > 0 &&
    amount !== "" &&
    (action === "RESET" || value > 0) &&
    why.trim() !== ""
  const verb =
    action === "ADD"
      ? `Add ${money(value)}`
      : action === "REMOVE"
        ? `Take off ${money(value)}`
        : `Set to ${money(value)}`
  const who =
    chosen.length === 1
      ? (chosen[0].name.split(" ")[0] ?? chosen[0].name)
      : `${chosen.length} people`
  const quick = action === "RESET" ? [0, 250000, 500000] : [100000, 250000, 500000]

  const add = (more: readonly string[]) =>
    setIds([...new Set([...ids, ...more])])
  const save = useMutation({
    mutationFn: () =>
      adjustBenefit({
        action,
        amount_minor: value,
        employee_ids: [...ids],
        reason: why.trim(),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: benefitKeys.all() })
      toast.success("Balances filled")
      onDone()
      onClose()
    },
  })

  return (
    <Sheet
      open
      onOpenChange={(next) => !next && onClose()}
      context="Employee discount"
      title="Fill balances"
      size="wide"
      stack
      footer={
        <SheetFooter
          error={save.error}
          primary={{
            label:
              amount === ""
                ? "Fill"
                : `${verb} ${action === "RESET" ? "for" : "to"} ${who}`,
            pending: save.isPending,
            disabled: !ok,
            onClick: () => save.mutate(),
          }}
        />
      }
    >
      <div className="flex flex-col gap-10">
        <Section title="People" aside={chosen.length}>
          <div className="flex flex-wrap gap-2">
            {chosen.map((one) => (
              <Chip
                key={one.id}
                label={one.name}
                on
                onClick={() => setIds(ids.filter((id) => id !== one.id))}
              />
            ))}
            <Chip
              icon={Users}
              label="Everyone"
              count={people.length}
              onClick={() => add(people.map((one) => one.id))}
            />
            {units.map((unit) => (
              <Chip
                key={unit}
                icon={Store}
                label={unit}
                count={people.filter((one) => one.unit === unit).length}
                onClick={() =>
                  add(people.filter((one) => one.unit === unit).map((one) => one.id))
                }
              />
            ))}
          </div>
        </Section>
        <Section title="Do">
          <Choices
            label="Do"
            options={ACTION_TILES}
            value={action}
            columns={3}
            onChange={setAction}
          />
        </Section>
        <Section title="Amount">
          <Money label="Amount" prefix="Rp" value={amount} onChange={setAmount} />
          <FilterChips
            label="Quick amounts"
            value={amount !== "" && quick.includes(value) ? String(value) : null}
            onChange={(next) => next !== null && setAmount(next)}
            options={quick.map((n) => ({ value: String(n), label: money(n) }))}
          />
        </Section>
        <Field label="Why" required>
          <Input
            value={why}
            placeholder="November"
            onChange={(event) => setWhy(event.target.value)}
          />
        </Field>
        {chosen.length > 0 && amount !== "" && (
          <Section title="Before → after">
            <div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-4 gap-y-2 text-[0.9375rem]">
              {chosen.slice(0, 8).map((one) => (
                <div key={one.id} className="contents">
                  <span className="text-ink">{one.name}</span>
                  <span className="text-right text-mute tabular-nums">
                    {money(one.balance)}
                  </span>
                  <span className="text-mute">→</span>
                  <span className="text-right font-semibold text-ink tabular-nums">
                    {money(after(one))}
                  </span>
                </div>
              ))}
              {chosen.length > 8 && (
                <span className="col-span-4 text-mute">
                  and {chosen.length - 8} more
                </span>
              )}
            </div>
          </Section>
        )}
      </div>
    </Sheet>
  )
}

// ── the setting ─────────────────────────────────────────────────────────────

const ON_OFF: readonly Tile<"on" | "off">[] = [
  { value: "on", label: "On", icon: Check },
  { value: "off", label: "Off", icon: Pause },
]

function Fixed({
  icon: Glyph,
  label,
  note,
}: {
  icon: LucideIcon
  label: string
  note: string
}) {
  return (
    <div className="flex min-w-0 items-center gap-2.5 rounded-inner border border-accent bg-accent-bg px-3 py-2.5 opacity-80">
      <span className="grid size-[1.875rem] shrink-0 place-items-center rounded-inner bg-canvas text-accent">
        <Glyph className="size-4 stroke-[1.7]" />
      </span>
      <span className="min-w-0">
        <span className="block text-[0.9375rem] font-medium text-accent">
          {label}
        </span>
        <span className="block text-[0.9375rem] text-body">{note}</span>
      </span>
    </div>
  )
}

function SettingSheet({
  rows,
  today,
  onClose,
}: {
  rows: readonly BenefitSettingView[]
  today: string
  onClose: () => void
}) {
  const client = useQueryClient()
  const nameOfLogin = useNameOfLogin()
  const current = rows[0]
  const [state, setState] = useState<"on" | "off">(
    current?.enabled === true ? "on" : "off"
  )
  const [minutes, setMinutes] = useState(String(current?.code_minutes ?? 5))
  const [why, setWhy] = useState("")
  const mins = Number(minutes)
  const save = useMutation({
    mutationFn: () =>
      stateBenefitSetting({
        effective_from: today,
        enabled: state === "on",
        code_minutes: mins,
        reason: why.trim(),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: benefitKeys.settings() })
      toast.success("Setting saved")
      onClose()
    },
  })
  return (
    <Sheet
      open
      onOpenChange={(next) => !next && onClose()}
      context="Employee discount"
      title="Setting"
      caption={
        current === undefined
          ? undefined
          : `Since ${day(current.effective_from)} · ${nameOfLogin(current.set_by)}`
      }
      stack
      footer={
        <SheetFooter
          error={save.error}
          primary={{
            label: "Save",
            pending: save.isPending,
            disabled:
              why.trim() === "" ||
              !Number.isFinite(mins) ||
              mins < 1 ||
              mins > 60,
            onClick: () => save.mutate(),
          }}
        />
      }
    >
      <div className="flex flex-col gap-10">
        <Section title="Employee discount">
          <Choices
            label="Employee discount"
            options={ON_OFF}
            value={state}
            onChange={setState}
          />
        </Section>
        <Section title="Opened by">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Fixed
              icon={Fingerprint}
              label="Finger"
              note="At every till with a reader"
            />
            <Fixed
              icon={Smartphone}
              label="Code"
              note="From the employee app"
            />
          </div>
        </Section>
        <Section title="Code lasts">
          <Stepper
            label="Minutes"
            min={1}
            max={60}
            suffix="minutes"
            value={minutes}
            onChange={setMinutes}
          />
        </Section>
        <Field label="Why" required>
          <Input value={why} onChange={(event) => setWhy(event.target.value)} />
        </Field>
        <Section title="History">
          {rows.length === 0 ? (
            <Quiet>Nothing has been set, so it is off.</Quiet>
          ) : (
            <ul className="flex flex-col gap-4">
              {rows.map((row, index) => (
                <li key={`${row.effective_from}-${index}`}>
                  <div className="font-medium text-ink">
                    {row.enabled ? `On · code lasts ${row.code_minutes} min` : "Off"}
                  </div>
                  <div className="text-mute">
                    {nameOfLogin(row.set_by)} · {day(row.effective_from)} ·{" "}
                    {row.reason}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </Sheet>
  )
}

/// One person's account: the balance, what moved it, and the three things HR
/// can do to it. The same panel on Benefits › Balances and on the person's
/// own record in Employees, so both read and move one balance.
export function BenefitPanel({
  employeeId,
  name,
  code,
  enabled = true,
}: {
  employeeId: string
  name: string
  code: string
  enabled?: boolean
}) {
  const canWrite = useCanWrite()
  const nameOfLogin = useNameOfLogin()
  const account = useQuery({
    queryKey: benefitKeys.account(employeeId),
    queryFn: ({ signal }) => benefitAccount(employeeId, signal),
    enabled,
  })
  const act = useOpener<BenefitAction>()

  return (
    <>
      <div className="flex flex-col gap-4">
        <Facts>
          <Fact term="Balance">
            <span className="text-hero font-semibold">
              {account.data === undefined
                ? "—"
                : money(account.data.balance_minor)}
            </span>
          </Fact>
          <Fact term="Code">{code}</Fact>
        </Facts>
        {canWrite && (
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => act.show("ADD")}>Add</Button>
            <Button onClick={() => act.show("REMOVE")}>Take off</Button>
            <Button onClick={() => act.show("RESET")}>Reset</Button>
          </div>
        )}
        {queryState(account, {
          loading: "Reading the account…",
          render: (view) =>
            view.entries.length === 0 ? (
              <Quiet>Nothing has moved yet.</Quiet>
            ) : (
              <MiniTable
                head={[
                  "When",
                  { label: "What", align: "left" },
                  "Change",
                  "Balance",
                  { label: "By", align: "left" },
                  { label: "Note", align: "left" },
                ]}
              >
                {view.entries.map((entry) => (
                  <MiniRow key={entry.id}>
                    <MiniCell>{moment(entry.at)}</MiniCell>
                    <MiniCell>
                      {BENEFIT_KIND_LABEL[entry.kind] ?? entry.kind}
                    </MiniCell>
                    <MiniCell align="right">
                      {signedMinor(entry.delta_minor, money)}
                    </MiniCell>
                    <MiniCell align="right">
                      {money(entry.balance_after)}
                    </MiniCell>
                    <MiniCell>{nameOfLogin(entry.by)}</MiniCell>
                    <MiniCell>{entry.sale_ref ?? entry.reason}</MiniCell>
                  </MiniRow>
                ))}
              </MiniTable>
            ),
        })}
      </div>
      <AdjustSheet
        key={act.n}
        open={act.isOpen}
        onClose={act.hide}
        employeeIds={[employeeId]}
        startWith={act.item ?? "ADD"}
        intro={`For ${name}.`}
      />
    </>
  )
}
