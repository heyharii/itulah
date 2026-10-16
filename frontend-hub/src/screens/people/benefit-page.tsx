import { useQuery, useSuspenseQuery } from "@tanstack/react-query"
import { ChevronRight } from "lucide-react"
import { useState, Suspense } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { useLayout } from "@/lib/layout"
import { AppLink } from "@/components/ui/app-link"
import { Fab } from "@/components/ui/fab"
import { DockTools } from "@/components/shell/dock-tools"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Checkbox, Field, Input } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { PickMany } from "@/components/ui/pick"
import { MiniCell, MiniRow, MiniTable } from "@/components/ui/rows"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { EmptyState, LoadingState } from "@/components/ui/states"
import { day, money, moment } from "@/lib/format"
import {
  BENEFIT_KIND_LABEL,
  benefitAccount,
  benefitKeys,
  signedMinor,
  type BenefitAction,
  benefitBalancesQuery,
  benefitSettingsQuery,
} from "@/lib/queries/hr-benefit"
import { useEveryEmployee } from "@/lib/queries/hr-employees"
import { useReachableUnits } from "@/lib/queries/people"
import { queryState } from "@/lib/query-state"
import { useCanWrite } from "@/lib/session"
import { AdjustSheet } from "@/screens/people/benefit-form"
import {
  CardButton,
  CardFigure,
  CardName,
  PhoneCards,
} from "@/components/ui/phone-cards"
import { SheetFooter } from "@/screens/people/settings-kit"
import { useOpener, type Opener } from "@/screens/people/settings-lib"
import type { BenefitBalanceRow } from "@itulah/contract"

function nameOf(row: BenefitBalanceRow): string {
  return row.full_name ?? row.employee_code
}

/// Pay › Benefit — what each employee has to spend at the till.
///
/// HR fills it by hand: add, take off or reset, each with a reason and no
/// second approval, for one person or for many at once. What is unspent
/// carries over. Whether the benefit is on, and how long a code lasts, is one
/// line above the list with a way to change it (`BenefitLine`).
export function BenefitPage() {
  const canWrite = useCanWrite()
  const phone = useLayout() === "phone"
  const [search, setSearch] = useState("")
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set())
  const fill = useOpener()
  const person = useOpener<BenefitBalanceRow>()

  return (
    <PageContent>
      <PageHeader
        title="Benefit"
        actions={
          !phone &&
          canWrite && (
            <Button variant="primary" onClick={() => fill.show()}>
              {picked.size > 0
                ? `Fill balances (${picked.size})`
                : "Fill balances"}
            </Button>
          )
        }
      />

      {/* On a phone the search is the field over the bottom bar and filling
          is the round +. */}
      <div className="mb-3.5 flex flex-wrap items-center gap-x-4 gap-y-2.5">
        <div className="w-80 max-md:hidden">
          <Input
            aria-label="Search people"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <Suspense fallback={null}>
          <BenefitLine />
        </Suspense>
      </div>
      {canWrite && <Fab label="Fill balances" onClick={() => fill.show()} />}
      <DockTools
        search={{ value: search, onChange: setSearch, label: "Search People" }}
      />

      <Card className="overflow-hidden px-4 py-2 max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:p-0 max-md:shadow-none">
        <Suspense fallback={<LoadingState>Reading the balances…</LoadingState>}>
          <Balances
            search={search}
            picked={picked}
            onPick={setPicked}
            fill={fill}
            person={person}
          />
        </Suspense>
      </Card>

      <PersonSheet
        key={`person-${person.n}`}
        open={person.isOpen}
        onClose={person.hide}
        row={person.item}
      />
    </PageContent>
  )
}

/// The balances, as a list, and the form that fills them. Here and not in the
/// screen so the head paints at once and this waits alone for its answer.
function Balances({
  search,
  picked,
  onPick,
  fill,
  person,
}: {
  search: string
  picked: ReadonlySet<string>
  onPick: (picked: ReadonlySet<string>) => void
  fill: Opener<never>
  person: Opener<BenefitBalanceRow>
}) {
  const phone = useLayout() === "phone"
  const balances = useSuspenseQuery(benefitBalancesQuery())
  const reachable = useReachableUnits()
  /// A unit by its name; the balance only carries the id.
  const unitName = (id: string | null) =>
    id === null
      ? "—"
      : (reachable.data?.find((one) => one.id === id)?.name ?? id)
  const needle = search.trim().toLowerCase()
  const shown = balances.data.filter(
    (row) =>
      needle === "" ||
      nameOf(row).toLowerCase().includes(needle) ||
      row.employee_code.toLowerCase().includes(needle)
  )
  const allShown =
    shown.length > 0 && shown.every((row) => picked.has(row.employee_id))
  const someShown = shown.some((row) => picked.has(row.employee_id))

  function toggle(id: string, on: boolean) {
    const next = new Set(picked)
    if (on) next.add(id)
    else next.delete(id)
    onPick(next)
  }
  function toggleAll(on: boolean) {
    const next = new Set(picked)
    for (const row of shown) {
      if (on) next.add(row.employee_id)
      else next.delete(row.employee_id)
    }
    onPick(next)
  }

  return (
    <>
      {shown.length === 0 ? (
        <EmptyState>Nobody matches.</EmptyState>
      ) : phone ? (
        <PhoneCards
          rows={shown}
          onOpen={(row) => person.show(row)}
          rowId={(row) => row.employee_id}
          spec={{
            title: (row) => (
              <CardName
                name={nameOf(row)}
                line={row.unit_id === null ? undefined : unitName(row.unit_id)}
              />
            ),
            lead: (row) => (
              <CardFigure
                value={money(row.balance_minor)}
                caption="balance"
                tone={row.balance_minor === 0 ? "quiet" : undefined}
              />
            ),
            foot: (row) => <>Last moved {day(row.last_moved_at)}</>,
            action: (row) => (
              <CardButton
                label="Open"
                ariaLabel={`Open ${nameOf(row)}`}
                onClick={() => person.show(row)}
              />
            ),
          }}
        />
      ) : (
        <MiniTable
          head={[
            { label: "", align: "left" },
            { label: "Employee", align: "left" },
            { label: "Unit", align: "left" },
            { label: "Balance", align: "right" },
            { label: "Last moved", align: "right" },
          ]}
        >
          {shown.map((row) => (
            <MiniRow key={row.employee_id}>
              <MiniCell className="w-8">
                <Checkbox
                  label={<span className="sr-only">Select</span>}
                  checked={picked.has(row.employee_id)}
                  onChange={(on) => toggle(row.employee_id, on)}
                />
              </MiniCell>
              <MiniCell>
                <button
                  type="button"
                  className="text-left font-medium text-ink hover:underline"
                  onClick={() => person.show(row)}
                >
                  {nameOf(row)}
                </button>
              </MiniCell>
              <MiniCell>{unitName(row.unit_id)}</MiniCell>
              <MiniCell align="right">{money(row.balance_minor)}</MiniCell>
              <MiniCell align="right">{day(row.last_moved_at)}</MiniCell>
            </MiniRow>
          ))}
        </MiniTable>
      )}
      {shown.length > 0 && (
        <div className="border-t border-hairline pt-2 max-md:hidden">
          <Checkbox
            label="Select everyone shown"
            checked={allShown}
            indeterminate={someShown && !allShown}
            onChange={toggleAll}
          />
        </div>
      )}

      <FillSheet
        key={`fill-${fill.n}`}
        open={fill.isOpen}
        onClose={fill.hide}
        preselected={[...picked]}
        shown={shown}
        onDone={() => onPick(new Set())}
      />
    </>
  )
}

/// Whether the benefit is on and how long a code lasts, as one line with the
/// way to change it. The setting itself is a page of its own
/// (`settings-benefit.tsx`), so Change goes there; it is never the page's
/// primary action, which is filling balances.
function BenefitLine() {
  const settings = useSuspenseQuery(benefitSettingsQuery())
  const current = settings.data[0]
  /// How long a code lasts while the benefit is on; `null` when it is off.
  const minutes =
    current !== undefined && current.enabled ? current.code_minutes : null
  const phone = useLayout() === "phone"
  const said =
    minutes === null
      ? "Benefit is off"
      : `Benefit is on · a code lasts ${minutes} minute${minutes === 1 ? "" : "s"}`
  const tone =
    minutes === null
      ? "text-[0.9375rem] text-warn-fg"
      : "text-[0.9375rem] text-body"
  // On a phone the line itself is the way in, not a button at the top of the
  // page: every action there is at the bottom (owner, 2026-10-06).
  if (phone)
    return (
      <AppLink
        to="/people/settings/benefit"
        className={`mb-3 flex min-h-11 items-center gap-1 ${tone}`}
      >
        <span className="min-w-0 flex-1">{said}</span>
        <ChevronRight className="size-4 shrink-0 text-line-ico" />
      </AppLink>
    )
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 md:ml-auto">
      <span className={tone}>{said}</span>
      <AppLink to="/people/settings/benefit" variant="ghost">
        Change
      </AppLink>
    </div>
  )
}

/// The many-at-once form: the ticked rows, or — when nothing is ticked —
/// whoever HR picks here, or everyone shown.
function FillSheet({
  open,
  onClose,
  preselected,
  shown,
  onDone,
}: {
  open: boolean
  onClose: () => void
  preselected: readonly string[]
  shown: readonly BenefitBalanceRow[]
  onDone: () => void
}) {
  const people = useEveryEmployee()
  const [chosen, setChosen] = useState<readonly string[]>([])
  const [everyone, setEveryone] = useState(false)
  const ids =
    preselected.length > 0
      ? preselected
      : everyone
        ? shown.map((row) => row.employee_id)
        : chosen
  const close = () => {
    onDone()
    onClose()
  }
  return (
    <AdjustSheet
      open={open}
      onClose={() => (preselected.length > 0 ? onClose() : close())}
      employeeIds={ids}
      intro={
        ids.length === 0
          ? "Choose who this is for."
          : `For ${ids.length} ${ids.length === 1 ? "person" : "people"}.`
      }
      picker={
        preselected.length === 0 && (
          <div className="flex flex-col gap-2">
            <Checkbox
              label={`Everyone shown (${shown.length})`}
              checked={everyone}
              onChange={setEveryone}
            />
            {!everyone && (
              <Field label="People">
                <PickMany
                  label="People"
                  choices={(people.data ?? []).map((one) => ({
                    value: one.employee_id,
                    label: `${one.full_name ?? one.employee_code} · ${one.employee_code}`,
                  }))}
                  values={chosen}
                  onChange={setChosen}
                />
              </Field>
            )}
          </div>
        )
      }
    />
  )
}

/// One person's account: the balance, what moved it, and the three things HR
/// can do to it.
function PersonSheet({
  open,
  onClose,
  row,
}: {
  open: boolean
  onClose: () => void
  row: BenefitBalanceRow | null
}) {
  const canWrite = useCanWrite()
  const account = useQuery({
    queryKey: benefitKeys.account(row?.employee_id ?? ""),
    queryFn: ({ signal }) => benefitAccount(row?.employee_id ?? "", signal),
    enabled: open && row !== null,
  })
  const act = useOpener<BenefitAction>()

  return (
    <>
      <Sheet
        open={open}
        onOpenChange={(next) => !next && onClose()}
        title={row === null ? "Benefit" : nameOf(row)}
        footer={<SheetFooter onCancel={onClose} />}
      >
        <div className="flex flex-col gap-4">
          <Facts>
            <Fact term="Balance">
              <span className="text-hero font-semibold">
                {money(account.data?.balance_minor ?? row?.balance_minor)}
              </span>
            </Fact>
            <Fact term="Code">{row?.employee_code ?? "—"}</Fact>
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
                <EmptyState>Nothing has moved yet.</EmptyState>
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
                      <MiniCell>{entry.by}</MiniCell>
                      <MiniCell>{entry.sale_ref ?? entry.reason}</MiniCell>
                    </MiniRow>
                  ))}
                </MiniTable>
              ),
          })}
        </div>
      </Sheet>
      {row !== null && (
        <AdjustSheet
          key={act.n}
          open={act.isOpen}
          onClose={act.hide}
          employeeIds={[row.employee_id]}
          startWith={act.item ?? "ADD"}
          intro={`For ${nameOf(row)}.`}
        />
      )}
    </>
  )
}
