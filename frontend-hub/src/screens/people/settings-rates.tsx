import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { useLayout } from "@/lib/layout"
import { Fab } from "@/components/ui/fab"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { Day } from "@/components/ui/day"
import { Field, Input } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { KeyValue, MiniCell, MiniRow, MiniTable } from "@/components/ui/rows"
import { Segmented } from "@/components/ui/segmented"
import { Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState, Problem } from "@/components/ui/states"
import { day, money, moment } from "@/lib/format"
import {
  payKeys,
  ratifyStatutoryRate,
  statutoryRates,
  taxTables,
} from "@/lib/queries/people"
import { queryState } from "@/lib/query-state"
import { useCanWrite } from "@/lib/session"
import { ListCard, RowOpen, SheetFooter } from "@/screens/people/settings-kit"
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

export function RateSettings() {
  const canWrite = useCanWrite()
  const phone = useLayout() === "phone"
  const rates = useQuery({
    queryKey: payKeys.statutoryRates(),
    queryFn: ({ signal }) => statutoryRates(signal),
  })
  const create = useOpener()
  const detail = useOpener<StatutoryRateView>()

  return (
    <PageContent>
      {canWrite && rates.isSuccess && (
        <Fab label="New rates" onClick={() => create.show()} />
      )}
      <PageHeader
        crumb="People"
        title="Tax & BPJS Rates"
        sub="The BPJS rates head office states from a date, and the tax tables of the law payslips are checked against."
        actions={
          !phone &&
          canWrite && (
            <Button
              variant="primary"
              disabled={!rates.isSuccess}
              onClick={() => create.show()}
            >
              New rates
            </Button>
          )
        }
      />

      <ListCard title="BPJS rates">
        {queryState(rates, {
          loading: "Reading the rates…",
          render: (history) =>
            history.length === 0 ? (
              <EmptyState>
                No BPJS rates are stated, so every slip is worked out on the
                rates this system was installed with. New rates states them from
                a date.
              </EmptyState>
            ) : (
              <MiniTable
                head={[
                  "From",
                  { label: "Kesehatan", align: "right" },
                  { label: "JHT", align: "right" },
                  { label: "JP", align: "right" },
                  { label: "JKK / JKM", align: "right" },
                  "By",
                ]}
              >
                {history.map((row, index) => (
                  <MiniRow key={row.effective_from}>
                    <MiniCell>
                      <RowOpen onClick={() => detail.show(row)}>
                        {day(row.effective_from)}
                      </RowOpen>
                      {index === 0 && (
                        <Pill tone="ok" className="ml-2">
                          In force
                        </Pill>
                      )}
                    </MiniCell>
                    <MiniCell align="right">
                      {percent(row.rates.kesehatan_employee_bp)} +{" "}
                      {percent(row.rates.kesehatan_company_bp)}
                    </MiniCell>
                    <MiniCell align="right">
                      {percent(row.rates.jht_employee_bp)} +{" "}
                      {percent(row.rates.jht_company_bp)}
                    </MiniCell>
                    <MiniCell align="right">
                      {percent(row.rates.jp_employee_bp)} +{" "}
                      {percent(row.rates.jp_company_bp)}
                    </MiniCell>
                    <MiniCell align="right">
                      {percent(row.rates.jkk_bp)} / {percent(row.rates.jkm_bp)}
                    </MiniCell>
                    <MiniCell>{row.ratified_by}</MiniCell>
                  </MiniRow>
                ))}
              </MiniTable>
            ),
        })}
      </ListCard>

      <TaxTables />

      <NewRatesSheet
        key={`new-${create.n}`}
        open={create.isOpen}
        onClose={create.hide}
        from={rates.data?.[0]?.rates ?? null}
      />
      <RatesSheet
        key={`one-${detail.n}`}
        open={detail.isOpen}
        onClose={detail.hide}
        row={detail.item}
      />
    </PageContent>
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
          <p className="text-[0.875rem] text-body">Why: {row.reason}</p>
          <p className="text-[0.875rem] text-mute">
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
          <Card className="mb-4 overflow-hidden">
            <CardHeader>
              <CardTitle>PPh 21</CardTitle>
            </CardHeader>
            <p className="px-4 pb-3.5 text-[0.875rem] text-body">
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

          <ListCard
            title="Monthly TER"
            aside={
              <Segmented
                options={[
                  { value: "A", label: "TER A" },
                  { value: "B", label: "TER B" },
                  { value: "C", label: "TER C" },
                ]}
                value={category}
                onChange={setCategory}
              />
            }
          >
            {ter !== undefined && (
              <>
                <p className="mb-2 text-[0.875rem] text-mute">
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
