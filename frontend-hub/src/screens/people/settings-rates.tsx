import {
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useMemo, useState, Suspense } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { useLayout } from "@/lib/layout"
import { Fab } from "@/components/ui/fab"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Day } from "@/components/ui/day"
import { Field, Input } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { KeyValue, MiniCell, MiniRow, MiniTable } from "@/components/ui/rows"
import { Segmented, Toolbar } from "@/components/ui/segmented"
import { Sheet } from "@/components/ui/sheet"
import {
  Banner,
  EmptyState,
  Problem,
  LoadingState,
} from "@/components/ui/states"
import { SubTabs } from "@/components/ui/sub-tabs"
import { day, money, moment } from "@/lib/format"
import {
  payKeys,
  ratifyStatutoryRate,
  taxTables,
  statutoryRatesQuery,
} from "@/lib/queries/people"
import { queryState } from "@/lib/query-state"
import { useCanWrite } from "@/lib/session"
import { CardName } from "@/components/ui/phone-cards"
import { tableSetup, type TableSetup } from "@/lib/table"
import { ListCard, SheetFooter } from "@/screens/people/settings-kit"
import { bpOf, digits, useOpener } from "@/screens/people/settings-lib"
import { percent } from "@/screens/people/slip-lines"
import type {
  BpjsRates,
  StatutoryRateView,
  TaxTableRow,
} from "@itulah/contract"

/// Settings › Tax & BPJS rates — what PPh 21 and BPJS are worked out from.
///
/// The BPJS rates and wage caps move — the JP cap every March, JKK with the
/// company's risk class — so head office states them from a date, forward
/// only, and a month already paid keeps the rates it was paid at. The TER
/// tables, Article 17 and PTKP are regulation: shown here so a payslip can be
/// checked against them, and changed only by a release.

type RateField = keyof BpjsRates

const FIELDS: readonly {
  readonly key: RateField
  readonly label: string
  readonly kind: "bp" | "cap"
}[] = [
  { key: "kesehatan_employee_bp", label: "Kesehatan · employee", kind: "bp" },
  { key: "kesehatan_company_bp", label: "Kesehatan · company", kind: "bp" },
  { key: "kesehatan_cap_minor", label: "Kesehatan · wage cap", kind: "cap" },
  { key: "jht_employee_bp", label: "JHT · employee", kind: "bp" },
  { key: "jht_company_bp", label: "JHT · company", kind: "bp" },
  { key: "jp_employee_bp", label: "JP · employee", kind: "bp" },
  { key: "jp_company_bp", label: "JP · company", kind: "bp" },
  { key: "jp_cap_minor", label: "JP · wage cap", kind: "cap" },
  { key: "jkk_bp", label: "JKK · company", kind: "bp" },
  { key: "jkm_bp", label: "JKM · company", kind: "bp" },
]

function shown(rates: BpjsRates, field: (typeof FIELDS)[number]): string {
  const value = rates[field.key]
  return field.kind === "bp" ? percent(value) : money(value)
}

const rateTabs = [
  { value: "bpjs", label: "BPJS rates" },
  { value: "tax", label: "Tax tables" },
] as const

type RateTab = (typeof rateTabs)[number]["value"]

const duo = (employee: number, company: number) =>
  `${percent(employee)} + ${percent(company)}`

const rateColumns: ColumnDef<TableSetup, StatutoryRateView>[] = [
  {
    id: "from",
    accessorFn: (row) => row.effective_from,
    header: "From",
    size: 220,
    meta: { card: "hide" },
    cell: ({ row }) => (
      <>
        {day(row.original.effective_from)}
        {row.index === 0 && (
          <Pill tone="ok" className="ml-2">
            In force
          </Pill>
        )}
      </>
    ),
  },
  {
    id: "kesehatan",
    accessorFn: (row) => row.rates.kesehatan_employee_bp,
    header: "Kesehatan",
    size: 160,
    meta: { align: "right", card: "hide" },
    cell: ({ row }) =>
      duo(
        row.original.rates.kesehatan_employee_bp,
        row.original.rates.kesehatan_company_bp
      ),
  },
  {
    id: "jht",
    accessorFn: (row) => row.rates.jht_employee_bp,
    header: "JHT",
    size: 160,
    meta: { align: "right", card: "hide" },
    cell: ({ row }) =>
      duo(
        row.original.rates.jht_employee_bp,
        row.original.rates.jht_company_bp
      ),
  },
  {
    id: "jp",
    accessorFn: (row) => row.rates.jp_employee_bp,
    header: "JP",
    size: 160,
    meta: { align: "right", card: "hide" },
    cell: ({ row }) =>
      duo(row.original.rates.jp_employee_bp, row.original.rates.jp_company_bp),
  },
  {
    id: "jkk",
    accessorFn: (row) => row.rates.jkk_bp,
    header: "JKK / JKM",
    size: 160,
    meta: { align: "right", card: "hide" },
    cell: ({ row }) =>
      `${percent(row.original.rates.jkk_bp)} / ${percent(row.original.rates.jkm_bp)}`,
  },
  {
    accessorKey: "ratified_by",
    header: "By",
    size: 160,
    meta: { card: "hide" },
  },
  // One column that exists only on a card (`cardLead`; a phone): the date it
  // starts, the four rates under it, and who stated it.
  {
    id: "head",
    accessorFn: (row) => row.effective_from,
    header: "",
    enableHiding: false,
    enableSorting: false,
    meta: { card: "title" },
    cell: ({ row }) => (
      <CardName
        name={
          <>
            {day(row.original.effective_from)}
            {row.index === 0 && (
              <Pill tone="ok" className="ml-2 align-middle">
                In force
              </Pill>
            )}
          </>
        }
        line={[
          `Kesehatan ${duo(row.original.rates.kesehatan_employee_bp, row.original.rates.kesehatan_company_bp)}`,
          `JHT ${duo(row.original.rates.jht_employee_bp, row.original.rates.jht_company_bp)}`,
          `JP ${duo(row.original.rates.jp_employee_bp, row.original.rates.jp_company_bp)}`,
          `JKK / JKM ${percent(row.original.rates.jkk_bp)} / ${percent(row.original.rates.jkm_bp)}`,
          `By ${row.original.ratified_by}`,
        ]}
      />
    ),
  },
]

export function RateSettings() {
  const canWrite = useCanWrite()
  const phone = useLayout() === "phone"
  const create = useOpener()
  const detail = useOpener<StatutoryRateView>()
  const [tab, setTab] = useState<RateTab>("bpjs")

  return (
    <PageContent>
      {canWrite && <Fab label="New rates" onClick={() => create.show()} />}
      <PageHeader
        crumb="People"
        title="Tax & BPJS Rates"
        sub="The BPJS rates head office states from a date, and the tax tables of the law payslips are checked against."
        actions={
          !phone &&
          canWrite && (
            <Button variant="primary" onClick={() => create.show()}>
              New rates
            </Button>
          )
        }
      />

      {/* Two pages of one job, as tabs under the head: what head office
          states, and the law payslips are checked against. */}
      <SubTabs
        tabs={rateTabs}
        value={tab}
        onChange={(next) => setTab(next as RateTab)}
      />

      {tab === "bpjs" ? (
        <Card className="mb-4 overflow-hidden max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
          <Suspense fallback={<LoadingState>Reading the rates…</LoadingState>}>
            <RateHistory detail={detail} />
          </Suspense>
        </Card>
      ) : (
        <TaxTables />
      )}

      {/* The sheet starts from the rates in force, so it reads them itself:
          the buttons need no answer to be pressed. */}
      <Suspense fallback={null}>
        <NewRatesFromCurrent
          key={`new-${create.n}`}
          open={create.isOpen}
          onClose={create.hide}
        />
      </Suspense>
      <RatesSheet
        key={`one-${detail.n}`}
        open={detail.isOpen}
        onClose={detail.hide}
        row={detail.item}
      />
    </PageContent>
  )
}

/// The versions of the rates, as a table. Here and not in the screen so the
/// head paints at once and this waits alone for its answer.
function RateHistory({
  detail,
}: {
  detail: ReturnType<typeof useOpener<StatutoryRateView>>
}) {
  const rates = useSuspenseQuery(statutoryRatesQuery())
  const phone = useLayout() === "phone"
  const history = rates.data
  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: history,
        columns: rateColumns,
        getRowId: (row: StatutoryRateView) => row.effective_from,
        // The card's own column is drawn on a phone and never on a desk.
        state: { columnVisibility: { head: phone } },
      }),
      [history, phone]
    )
  )
  return history.length === 0 ? (
    <EmptyState>
      No BPJS rates are stated, so every slip is worked out on the rates this
      system was installed with. New rates states them from a date.
    </EmptyState>
  ) : (
    <DataTable<StatutoryRateView>
      refresh={[rates]}
      table={table}
      onRowClick={(row) => detail.show(row)}
      isSelected={(row) =>
        detail.isOpen && row.effective_from === detail.item?.effective_from
      }
      cardsApart
      cardLead
      cardSort={false}
    />
  )
}

function NewRatesFromCurrent({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const rates = useSuspenseQuery(statutoryRatesQuery())
  return (
    <NewRatesSheet
      open={open}
      onClose={onClose}
      from={rates.data[0]?.rates ?? null}
    />
  )
}

/// One version of the rates, read in full. Versions are never edited — a month
/// already paid keeps the rates it was paid at.
function RatesSheet({
  open,
  onClose,
  row,
}: {
  open: boolean
  onClose: () => void
  row: StatutoryRateView | null
}) {
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title={row ? `Rates from ${day(row.effective_from)}` : "Rates"}
      caption={
        row ? `${row.ratified_by} · ${moment(row.ratified_at)}` : undefined
      }
      footer={<SheetFooter onCancel={onClose} />}
    >
      {row && (
        <div className="flex flex-col gap-3">
          <div>
            {FIELDS.map((field) => (
              <KeyValue key={field.key} term={field.label}>
                {shown(row.rates, field)}
              </KeyValue>
            ))}
          </div>
          <p className="text-[0.9375rem] text-body">Why: {row.reason}</p>
          <p className="text-[0.9375rem] text-mute">
            Charged only to people with a BPJS number on their payroll identity:
            a Kesehatan number enrols Kesehatan, a Ketenagakerjaan number enrols
            JHT, JP, JKK and JKM. The company&rsquo;s Kesehatan, JKK and JKM
            count as the employee&rsquo;s income for PPh 21.
          </p>
        </div>
      )}
    </Sheet>
  )
}

function NewRatesSheet({
  open,
  onClose,
  from,
}: {
  open: boolean
  onClose: () => void
  from: BpjsRates | null
}) {
  const client = useQueryClient()
  const [effectiveFrom, setEffectiveFrom] = useState("")
  const [reason, setReason] = useState("")
  const [draft, setDraft] = useState<Record<RateField, string>>(() => {
    const out = {} as Record<RateField, string>
    for (const field of FIELDS) {
      const value = from?.[field.key]
      out[field.key] =
        value === undefined
          ? ""
          : field.kind === "bp"
            ? (value / 100).toLocaleString("id-ID", {
                maximumFractionDigits: 2,
              })
            : String(value)
    }
    return out
  })

  const parsed: Partial<BpjsRates> = {}
  let whole = true
  for (const field of FIELDS) {
    const value =
      field.kind === "bp" ? bpOf(draft[field.key]) : digits(draft[field.key])
    if (value === null) whole = false
    else parsed[field.key] = value
  }

  const state = useMutation({
    mutationFn: () =>
      ratifyStatutoryRate({
        effective_from: effectiveFrom,
        rates: parsed as BpjsRates,
        reason: reason.trim(),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: payKeys.statutoryRates() })
      onClose()
    },
  })

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title="New BPJS rates"
      footer={
        <SheetFooter
          onCancel={onClose}
          onSave={() => state.mutate()}
          saveLabel="State these rates"
          pending={state.isPending}
          disabled={!whole || effectiveFrom === "" || reason.trim() === ""}
        />
      }
    >
      <div className="flex flex-col gap-3.5">
        <Problem error={state.error} />
        <Banner tone="info">
          From a date after the rates in force — the JP cap every March, a new
          JKK class. A month already paid keeps the rates it was paid at.
        </Banner>
        <Field label="From" required>
          <Day value={effectiveFrom} onChange={setEffectiveFrom} />
        </Field>
        {FIELDS.map((field) => (
          <Field
            key={field.key}
            label={field.label}
            aside={field.kind === "bp" ? "percent" : "rupiah"}
            required
          >
            <Input
              inputMode="decimal"
              value={draft[field.key]}
              onChange={(event) =>
                setDraft({ ...draft, [field.key]: event.target.value })
              }
            />
          </Field>
        ))}
        <Field label="Why" required>
          <Input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
      </div>
    </Sheet>
  )
}

// ── the law, read-only ──────────────────────────────────────────────────────

function bracket(rows: readonly TaxTableRow[], index: number): string {
  const row = rows[index]
  const previous = index === 0 ? null : rows[index - 1]
  if (row.upto_minor === null) {
    return `above ${money(previous?.upto_minor ?? 0)}`
  }
  return previous === null
    ? `up to ${money(row.upto_minor)}`
    : `${money((previous.upto_minor ?? 0) + 1)} – ${money(row.upto_minor)}`
}

function TaxTables() {
  const tables = useQuery({
    queryKey: payKeys.taxTables(),
    queryFn: ({ signal }) => taxTables(signal),
  })
  const [category, setCategory] = useState<"A" | "B" | "C">("A")

  return queryState(tables, {
    loading: "Reading the tables…",
    render: (law) => {
      const ter = law.ter.find((table) => table.category === category)
      return (
        <>
          {/* The category the Monthly TER table below is read for, in the bar
              above the tables rather than under one of them. */}
          <Toolbar>
            <Segmented
              options={[
                { value: "A", label: "TER A" },
                { value: "B", label: "TER B" },
                { value: "C", label: "TER C" },
              ]}
              value={category}
              onChange={setCategory}
            />
          </Toolbar>

          <Card className="mb-4 overflow-hidden">
            <CardHeader>
              <CardTitle>PPh 21</CardTitle>
            </CardHeader>
            <p className="px-4 pb-3.5 text-[0.9375rem] text-body">
              Every month but the last: gross × the TER rate of the table the
              PTKP status selects (PP 58/2023). In December, or the month
              employment ends: the year&rsquo;s Article 17 tax on its actual
              income, less position expense ({percent(law.biaya_jabatan_bp)}, at
              most {money(law.biaya_jabatan_month_cap_minor)} a month) and the
              employee&rsquo;s JHT and JP, less what the other months withheld
              (PMK 168/2023). Set by regulation and changed only by a release.
            </p>
          </Card>

          <ListCard title="PTKP">
            <MiniTable
              head={["Status", { label: "A Year", align: "right" }, "TER"]}
            >
              {law.ptkp.map((row) => (
                <MiniRow key={row.status}>
                  <MiniCell>{row.status}</MiniCell>
                  <MiniCell align="right">{money(row.amount_minor)}</MiniCell>
                  <MiniCell align="right">
                    {law.ter.find((table) => table.ptkp.includes(row.status))
                      ?.category ?? "—"}
                  </MiniCell>
                </MiniRow>
              ))}
            </MiniTable>
          </ListCard>

          <ListCard title={`Monthly TER ${category}`}>
            {ter !== undefined && (
              <>
                <p className="mb-2 text-[0.9375rem] text-mute">
                  For {ter.ptkp.join(", ")} · {ter.rows.length} rows
                </p>
                <MiniTable
                  head={["Monthly Gross", { label: "Rate", align: "right" }]}
                >
                  {ter.rows.map((row, index) => (
                    <MiniRow key={index}>
                      <MiniCell>{bracket(ter.rows, index)}</MiniCell>
                      <MiniCell align="right">{percent(row.rate_bp)}</MiniCell>
                    </MiniRow>
                  ))}
                </MiniTable>
              </>
            )}
          </ListCard>

          <ListCard title="Article 17 · the year">
            <MiniTable
              head={[
                "Taxable Income a Year",
                { label: "Rate", align: "right" },
              ]}
            >
              {law.pasal_17.map((row, index) => (
                <MiniRow key={index}>
                  <MiniCell>{bracket(law.pasal_17, index)}</MiniCell>
                  <MiniCell align="right">{percent(row.rate_bp)}</MiniCell>
                </MiniRow>
              ))}
            </MiniTable>
          </ListCard>
        </>
      )
    },
  })
}
