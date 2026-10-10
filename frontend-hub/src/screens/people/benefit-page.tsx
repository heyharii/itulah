import { useQuery } from "@tanstack/react-query"
import { useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { useLayout } from "@/lib/layout"
import { Fab } from "@/components/ui/fab"
import { DockTools } from "@/components/shell/dock-tools"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Checkbox, Field, Input } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { PickMany } from "@/components/ui/pick"
import { Pill } from "@/components/ui/pill"
import { MiniCell, MiniRow, MiniTable } from "@/components/ui/rows"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState } from "@/components/ui/states"
import { day, money, moment } from "@/lib/format"
import {
  BENEFIT_KIND_LABEL,
  benefitAccount,
  benefitBalances,
  benefitKeys,
  benefitSettings,
  signedMinor,
  type BenefitAction,
} from "@/lib/queries/hr-benefit"
import { useEveryEmployee } from "@/lib/queries/hr-employees"
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
import { useOpener } from "@/screens/people/settings-lib"
import type { BenefitBalanceRow } from "@itulah/contract"

function nameOf(row: BenefitBalanceRow): string {
  return row.full_name ?? row.employee_code
}

/// Benefit › Balances — what each employee has to spend at the till.
///
/// HR fills it by hand: add, take off or reset, each with a reason and no
/// second approval, for one person or for many at once. What is unspent
/// carries over.
export function BenefitPage() {
  const canWrite = useCanWrite()
  const phone = useLayout() === "phone"
  const balances = useQuery({
    queryKey: benefitKeys.balances(),
    queryFn: ({ signal }) => benefitBalances(signal),
  })
  const settings = useQuery({
    queryKey: benefitKeys.settings(),
    queryFn: ({ signal }) => benefitSettings(signal),
  })
  const [search, setSearch] = useState("")
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set())
  const fill = useOpener()
  const person = useOpener<BenefitBalanceRow>()

  const off =
    settings.data !== undefined &&
    (settings.data.length === 0 || !settings.data[0].enabled)
  const needle = search.trim().toLowerCase()
  const shown = (balances.data ?? []).filter(
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
    setPicked(next)
  }
  function toggleAll(on: boolean) {
    const next = new Set(picked)
    for (const row of shown) {
      if (on) next.add(row.employee_id)
      else next.delete(row.employee_id)
    }
    setPicked(next)
  }

  return (
    <PageContent>
      <PageHeader
        crumb="People"
        title="Employee Benefit"
        sub="A rupiah balance each employee spends at the till with a code from their own app. Unused balance carries over."
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

      {off && (
        <Banner tone="warn" className="mb-4">
          The benefit is off — turn it on under Settings › Benefit.
        </Banner>
      )}

      {/* On a phone the search is the field over the bottom bar and filling
          is the round +. */}
      <div className="mb-3 max-w-sm max-md:hidden">
        <Input
          aria-label="Search people"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>
      {canWrite && <Fab label="Fill balances" onClick={() => fill.show()} />}
      <DockTools
        search={{ value: search, onChange: setSearch, label: "Search People" }}
      />

      <Card className="overflow-hidden px-4 py-2 max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:p-0 max-md:shadow-none">
        {queryState(balances, {
          loading: "Reading the balances…",
          render: () =>
            shown.length === 0 ? (
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
                      line={[row.employee_code, row.unit_id]
                        .filter(Boolean)
                        .join(" · ")}
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
                  { label: "Last Moved", align: "right" },
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
                      <span className="ml-2 text-mute">
                        {row.employee_code}
                      </span>
                    </MiniCell>
                    <MiniCell>{row.unit_id ?? "—"}</MiniCell>
                    <MiniCell align="right">
                      {money(row.balance_minor)}
                    </MiniCell>
                    <MiniCell align="right">{day(row.last_moved_at)}</MiniCell>
                  </MiniRow>
                ))}
              </MiniTable>
            ),
        })}
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
      </Card>

      <FillSheet
        key={`fill-${fill.n}`}
        open={fill.isOpen}
        onClose={fill.hide}
        preselected={[...picked]}
        shown={shown}
        onDone={() => setPicked(new Set())}
      />
      <PersonSheet
        key={`person-${person.n}`}
        open={person.isOpen}
        onClose={person.hide}
        row={person.item}
      />
    </PageContent>
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
                        <Pill>
                          {BENEFIT_KIND_LABEL[entry.kind] ?? entry.kind}
                        </Pill>
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
