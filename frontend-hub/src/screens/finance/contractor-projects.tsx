import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowLeft } from "lucide-react"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Day } from "@/components/ui/day"
import { Panel } from "@/components/ui/dialog"
import { Field, Input, Select } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import {
  Banner,
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/ui/states"
import { node } from "@/lib/api"
import { count, day, money } from "@/lib/format"
import { problemOf } from "@/lib/problem"
import { Grid, Td, Th } from "@/screens/finance-final/parts"
import { todayIso } from "@/screens/finance/chart"
import {
  useAssetClasses,
  useMoneyAccountChoices,
  useSuppliers,
  useUnitName,
  useSupplierName,
} from "@/screens/finance/hooks"
import { AccountPicker, UnitSelect } from "@/screens/finance/parts"

/// Assets › Contractor projects (owner, 2026-10-01).
///
/// Work paid ahead to a contractor — a renovation, a fit-out — invoiced over
/// the months it takes, and split at the end into the assets it built and the
/// part that was only an expense. Every step posts (`contractor_projects.rs`):
/// the advance to Advanced – To Contractors, each invoice as a bill on Contract
/// in Progress that the advance pays first, and the close from CIP onto the
/// new assets' cost accounts.
///
/// One screen: the list, and a project opened in place of it.

interface Project {
  readonly project_id: string
  readonly project_number: string
  readonly name: string
  readonly supplier_id: string
  readonly supplier_name: string | null
  readonly unit_id: string
  readonly note: string | null
  readonly status: "OPEN" | "CLOSED"
  readonly opened_at: string
  readonly closed_on: string | null
  readonly advanced_minor: number
  readonly invoiced_minor: number
  readonly applied_minor: number
  readonly advance_left_minor: number
  readonly owed_minor: number
  readonly advance_count: number
  readonly invoice_count: number
}

interface Detail {
  readonly project: Project
  readonly advances: readonly {
    advance_id: string
    paid_on: string
    amount_minor: number
    account_key: string
    account_qualifier: string
    reference: string | null
    entry_number: string
  }[]
  readonly invoices: readonly {
    invoice_id: string
    invoice_number: string
    invoice_date: string
    note: string | null
    total_minor: number
    applied_minor: number
    outstanding_minor: number
  }[]
  readonly split: readonly {
    line_number: number
    kind: "ASSET" | "EXPENSE"
    name: string
    class_code: string | null
    account_code: string
    useful_life_months: number | null
    amount_minor: number
  }[]
}

const BASE = "/api/v1/finance/contractor-projects"
const keys = {
  all: ["finance", "contractor-projects"] as const,
  one: (id: string) => ["finance", "contractor-projects", id] as const,
}

export function ContractorProjects() {
  const [openId, setOpenId] = useState<string | null>(null)
  return openId === null ? (
    <ProjectList onOpen={setOpenId} />
  ) : (
    <ProjectPage id={openId} onBack={() => setOpenId(null)} />
  )
}

// ---------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------

function ProjectList({ onOpen }: { onOpen: (id: string) => void }) {
  const unitName = useUnitName()
  const supplierName = useSupplierName()
  const [creating, setCreating] = useState(false)
  const projects = useQuery({
    queryKey: keys.all,
    queryFn: ({ signal }) => node.get<Project[]>(BASE, { signal }),
  })

  return (
    <PageContent>
      <PageHeader
        crumb="Finance · Assets"
        title="Contractor Projects"
        sub="Work paid for ahead and invoiced over months, split into assets when it is done."
        actions={
          <Button variant="primary" onClick={() => setCreating(true)}>
            New project
          </Button>
        }
      />

      {projects.isPending ? (
        <LoadingState>Reading the projects…</LoadingState>
      ) : projects.isError ? (
        <ErrorState error={projects.error} />
      ) : (projects.data ?? []).length === 0 ? (
        <EmptyState>
          No contractor project yet. Open one when a contractor is paid ahead
          for work that will take months.
        </EmptyState>
      ) : (
        <Grid>
          <thead>
            <tr>
              <Th>Project</Th>
              <Th width="10rem">Unit</Th>
              <Th align="right" width="11rem">
                Paid in advance
              </Th>
              <Th align="right" width="11rem">
                Invoiced
              </Th>
              <Th width="15rem">Status</Th>
            </tr>
          </thead>
          <tbody>
            {(projects.data ?? []).map((row) => (
              <tr
                key={row.project_id}
                onClick={() => onOpen(row.project_id)}
                className="cursor-pointer"
              >
                <Td className="max-w-0">
                  <span className="block truncate text-ink">{row.name}</span>
                  <span className="block truncate text-[0.875rem] text-mute">
                    {supplierName(row.supplier_id, row.supplier_name)} ·{" "}
                    {row.project_number}
                  </span>
                </Td>
                <Td className="text-body">
                  {plainUnit(unitName(row.unit_id))}
                </Td>
                <Td align="right">{money(row.advanced_minor)}</Td>
                <Td align="right">
                  {row.invoiced_minor === 0 ? (
                    <span className="text-mute">—</span>
                  ) : (
                    money(row.invoiced_minor)
                  )}
                </Td>
                <Td>
                  <StatusLine project={row} />
                </Td>
              </tr>
            ))}
          </tbody>
        </Grid>
      )}

      <Panel
        open={creating}
        onOpenChange={(next) => !next && setCreating(false)}
        title="New project"
      >
        {creating && (
          <OpenForm
            onDone={(id) => {
              setCreating(false)
              if (id) onOpen(id)
            }}
          />
        )}
      </Panel>
    </PageContent>
  )
}

/// One phrase for where a project stands, and a dot in its colour.
function StatusLine({ project }: { project: Project }) {
  const [tone, text] =
    project.status === "CLOSED"
      ? ["bg-faint", `Closed ${day(project.closed_on)}`]
      : project.invoiced_minor === 0
        ? ["bg-info-fg", "Running · no invoice yet"]
        : project.advance_left_minor > 0
          ? [
              "bg-info-fg",
              `Running · ${money(project.advance_left_minor)} advance left`,
            ]
          : project.owed_minor > 0
            ? ["bg-warn-fg", `${money(project.owed_minor)} owed`]
            : ["bg-ok-fg", "Ready to split"]
  return (
    <span className="inline-flex items-center gap-2 text-body">
      <span aria-hidden className={`size-2 shrink-0 rounded-full ${tone}`} />
      {text}
    </span>
  )
}

// ---------------------------------------------------------------------------
// One project
// ---------------------------------------------------------------------------

function ProjectPage({ id, onBack }: { id: string; onBack: () => void }) {
  const unitName = useUnitName()
  const supplierName = useSupplierName()
  const [acting, setActing] = useState<"advance" | "invoice" | "close" | null>(
    null
  )
  const detail = useQuery({
    queryKey: keys.one(id),
    queryFn: ({ signal }) => node.get<Detail>(`${BASE}/${id}`, { signal }),
  })
  const project = detail.data?.project

  return (
    <PageContent>
      <button
        type="button"
        onClick={onBack}
        className="mb-3 inline-flex items-center gap-1.5 text-[0.875rem] text-mute hover:text-ink"
      >
        <ArrowLeft className="size-4" /> Contractor projects
      </button>

      {detail.isPending ? (
        <LoadingState />
      ) : detail.isError || project === undefined ? (
        <ErrorState error={detail.error} />
      ) : (
        <>
          <PageHeader
            title={project.name}
            sub={`${supplierName(project.supplier_id, project.supplier_name)} · ${plainUnit(unitName(project.unit_id))} · ${project.project_number}`}
            actions={
              project.status === "OPEN" ? (
                <>
                  <Button onClick={() => setActing("advance")}>
                    Pay an advance
                  </Button>
                  <Button onClick={() => setActing("invoice")}>
                    Add an invoice
                  </Button>
                  <Button
                    variant="primary"
                    disabled={project.invoiced_minor === 0}
                    onClick={() => setActing("close")}
                  >
                    Close and split
                  </Button>
                </>
              ) : undefined
            }
          />

          <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Figure
              label="Paid in advance"
              value={project.advanced_minor}
              note={`${count(project.advance_count)} ${project.advance_count === 1 ? "payment" : "payments"}`}
            />
            <Figure
              label="Invoiced"
              value={project.invoiced_minor}
              note={`${count(project.invoice_count)} ${project.invoice_count === 1 ? "invoice" : "invoices"}`}
            />
            <Figure
              label="Advance left"
              value={project.advance_left_minor}
              note="Paid ahead, not invoiced yet"
            />
            <Figure
              label="Owed to the contractor"
              value={project.owed_minor}
              note="Invoiced beyond the advance · pay by BKK"
              tone={project.owed_minor > 0 ? "warn" : undefined}
            />
          </div>

          <Section title="Advances paid" note="Into Advanced – To Contractors">
            {detail.data!.advances.length === 0 ? (
              <EmptyState>No advance paid yet.</EmptyState>
            ) : (
              <Grid>
                <thead>
                  <tr>
                    <Th width="9rem">Paid on</Th>
                    <Th>From</Th>
                    <Th align="right" width="12rem">
                      Amount
                    </Th>
                  </tr>
                </thead>
                <tbody>
                  {detail.data!.advances.map((row) => (
                    <tr key={row.advance_id}>
                      <Td className="text-body">{day(row.paid_on)}</Td>
                      <Td>
                        <span className="block text-ink">
                          {moneyAccountWord(row.account_key)}{" "}
                          {row.account_qualifier}
                        </span>
                        <span className="block text-[0.875rem] text-mute">
                          {[row.reference, row.entry_number]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </Td>
                      <Td align="right">{money(row.amount_minor)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Grid>
            )}
          </Section>

          <Section
            title="Invoices gathered"
            note="Into Contract in Progress · the advance pays them first"
          >
            {detail.data!.invoices.length === 0 ? (
              <EmptyState>No invoice from the contractor yet.</EmptyState>
            ) : (
              <Grid>
                <thead>
                  <tr>
                    <Th width="9rem">Invoice date</Th>
                    <Th>Invoice</Th>
                    <Th width="15rem">Paid by</Th>
                    <Th align="right" width="12rem">
                      Amount
                    </Th>
                  </tr>
                </thead>
                <tbody>
                  {detail.data!.invoices.map((row) => {
                    const fromAdvance = row.applied_minor
                    const rest = row.total_minor - fromAdvance
                    return (
                      <tr key={row.invoice_id}>
                        <Td className="text-body">{day(row.invoice_date)}</Td>
                        <Td className="max-w-0">
                          <span className="block font-mono text-[0.875rem] text-ink">
                            {row.invoice_number}
                          </span>
                          <span className="block truncate text-[0.875rem] text-mute">
                            {row.note ?? ""}
                          </span>
                        </Td>
                        <Td>
                          {rest === 0 ? (
                            <span className="text-body">The advance</span>
                          ) : fromAdvance === 0 ? (
                            <OwedLine
                              outstanding={row.outstanding_minor}
                              total={rest}
                            />
                          ) : (
                            <>
                              <span className="block text-body">
                                Advance {money(fromAdvance)}
                              </span>
                              <OwedLine
                                outstanding={row.outstanding_minor}
                                total={rest}
                              />
                            </>
                          )}
                        </Td>
                        <Td align="right">{money(row.total_minor)}</Td>
                      </tr>
                    )
                  })}
                </tbody>
              </Grid>
            )}
          </Section>

          {project.status === "CLOSED" && (
            <Section
              title={`Split on ${day(project.closed_on)}`}
              note="Moved out of Contract in Progress"
            >
              <Grid>
                <thead>
                  <tr>
                    <Th>Into</Th>
                    <Th width="12rem">Life</Th>
                    <Th align="right" width="12rem">
                      Amount
                    </Th>
                  </tr>
                </thead>
                <tbody>
                  {detail.data!.split.map((row) => (
                    <tr key={row.line_number}>
                      <Td>
                        <span className="block text-ink">{row.name}</span>
                        <span className="block text-[0.875rem] text-mute">
                          {row.kind === "ASSET"
                            ? `New asset · ${row.account_code}`
                            : `Expense · ${row.account_code}`}
                        </span>
                      </Td>
                      <Td className="text-body">
                        {row.kind === "ASSET"
                          ? lifeWords(row.useful_life_months)
                          : "This month"}
                      </Td>
                      <Td align="right">{money(row.amount_minor)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Grid>
            </Section>
          )}

          <Panel
            open={acting === "advance"}
            onOpenChange={(next) => !next && setActing(null)}
            title="Pay an advance"
          >
            {acting === "advance" && (
              <AdvanceForm project={project} onDone={() => setActing(null)} />
            )}
          </Panel>
          <Panel
            open={acting === "invoice"}
            onOpenChange={(next) => !next && setActing(null)}
            title="Add the contractor's invoice"
          >
            {acting === "invoice" && (
              <InvoiceForm project={project} onDone={() => setActing(null)} />
            )}
          </Panel>
          <Panel
            open={acting === "close"}
            onOpenChange={(next) => !next && setActing(null)}
            title="Close and split"
            sub={`${money(project.invoiced_minor)} waits in Contract in Progress`}
          >
            {acting === "close" && (
              <CloseForm project={project} onDone={() => setActing(null)} />
            )}
          </Panel>
        </>
      )}
    </PageContent>
  )
}

function OwedLine({
  outstanding,
  total,
}: {
  outstanding: number
  total: number
}) {
  return outstanding > 0 ? (
    <span className="block text-warn-fg">Owed {money(outstanding)}</span>
  ) : (
    <span className="block text-body">BKK {money(total)}</span>
  )
}

function Figure({
  label,
  value,
  note,
  tone,
}: {
  label: string
  value: number
  note: string
  tone?: "warn"
}) {
  return (
    <div className="rounded-card border border-hairline-2 bg-canvas px-5 py-4">
      <div className="text-[0.875rem] text-body">{label}</div>
      <div
        className={
          tone === "warn" && value > 0
            ? "mt-1 text-[1.25rem] font-semibold text-warn-fg tabular-nums"
            : "mt-1 text-[1.25rem] font-semibold text-ink tabular-nums"
        }
      >
        {money(value)}
      </div>
      <div className="mt-0.5 text-[0.875rem] text-mute">{note}</div>
    </div>
  )
}

function Section({
  title,
  note,
  children,
}: {
  title: string
  note: string
  children: React.ReactNode
}) {
  return (
    <section className="mb-8">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-[1rem] font-medium text-ink">{title}</h2>
        <span className="text-[0.875rem] text-mute">{note}</span>
      </div>
      {children}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Forms
// ---------------------------------------------------------------------------

function useSave<T>(
  id: string | null,
  path: string,
  onDone: (result: T) => void
) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (body: unknown) => node.post<T>(path, body),
    onSuccess: (result) => {
      void client.invalidateQueries({ queryKey: keys.all })
      if (id) void client.invalidateQueries({ queryKey: keys.one(id) })
      void client.invalidateQueries({ queryKey: ["finance"] })
      onDone(result)
    },
  })
}

function OpenForm({ onDone }: { onDone: (id: string | null) => void }) {
  const suppliers = useSuppliers()
  const [name, setName] = useState("")
  const [supplier, setSupplier] = useState("")
  const [unit, setUnit] = useState("")
  const [note, setNote] = useState("")
  const save = useSave<Project>(null, BASE, (project) =>
    onDone(project.project_id)
  )

  return (
    <div className="flex flex-col gap-4">
      {save.isError && <Banner tone="bad">{problemOf(save.error)}</Banner>}
      <Field label="Project" required>
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          autoFocus
        />
      </Field>
      <Field label="Contractor" required>
        <Select value={supplier} onChange={setSupplier}>
          <option value="">Choose the contractor</option>
          {(suppliers.data ?? []).map((row) => (
            <option key={row.supplier_code} value={row.supplier_code}>
              {row.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Whose books" required hint="The unit the work is for.">
        <UnitSelect
          value={unit}
          onChange={setUnit}
          emptyLabel="Choose a unit"
        />
      </Field>
      <Field label="Note">
        <Input value={note} onChange={(event) => setNote(event.target.value)} />
      </Field>
      <div className="flex justify-end">
        <Button
          variant="primary"
          pending={save.isPending}
          disabled={name.trim() === "" || supplier === "" || unit === ""}
          onClick={() =>
            save.mutate({ name, supplier_id: supplier, unit_id: unit, note })
          }
        >
          Open the project
        </Button>
      </div>
    </div>
  )
}

function AdvanceForm({
  project,
  onDone,
}: {
  project: Project
  onDone: () => void
}) {
  const { accounts } = useMoneyAccountChoices(project.unit_id)
  const [paidOn, setPaidOn] = useState(todayIso())
  const [amount, setAmount] = useState("")
  const [from, setFrom] = useState("")
  const [reference, setReference] = useState("")
  const save = useSave(
    project.project_id,
    `${BASE}/${project.project_id}/advances`,
    onDone
  )
  const minor = digits(amount)
  const chosen = accounts.find(
    (row) => `${row.account_key}|${row.account_qualifier}` === from
  )

  return (
    <div className="flex flex-col gap-4">
      {save.isError && <Banner tone="bad">{problemOf(save.error)}</Banner>}
      <Field label="Paid on" required>
        <Day value={paidOn} onChange={setPaidOn} notAfter={todayIso()} />
      </Field>
      <Field label="Amount" required>
        <Input
          inputMode="numeric"
          value={amount}
          onChange={(event) => setAmount(grouped(event.target.value))}
          className="text-right tabular-nums"
        />
      </Field>
      <Field label="Paid from" required>
        <Select value={from} onChange={setFrom}>
          <option value="">Choose the account</option>
          {accounts.map((row) => (
            <option
              key={`${row.account_key}|${row.account_qualifier}`}
              value={`${row.account_key}|${row.account_qualifier}`}
            >
              {row.account_code} · {row.account_name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Reference" hint="The transfer or BKK number.">
        <Input
          value={reference}
          onChange={(event) => setReference(event.target.value)}
        />
      </Field>
      <div className="flex justify-end">
        <Button
          variant="primary"
          pending={save.isPending}
          disabled={minor <= 0 || chosen === undefined || paidOn === ""}
          onClick={() =>
            save.mutate({
              paid_on: paidOn,
              amount_minor: minor,
              account_key: chosen!.account_key,
              account_qualifier: chosen!.account_qualifier,
              reference,
            })
          }
        >
          Pay {minor > 0 ? money(minor) : ""}
        </Button>
      </div>
    </div>
  )
}

function InvoiceForm({
  project,
  onDone,
}: {
  project: Project
  onDone: () => void
}) {
  const [number, setNumber] = useState("")
  const [date, setDate] = useState(todayIso())
  const [amount, setAmount] = useState("")
  const [note, setNote] = useState("")
  const save = useSave(
    project.project_id,
    `${BASE}/${project.project_id}/invoices`,
    onDone
  )
  const minor = digits(amount)
  const covered = Math.min(project.advance_left_minor, minor)

  return (
    <div className="flex flex-col gap-4">
      {save.isError && <Banner tone="bad">{problemOf(save.error)}</Banner>}
      <Field label="Invoice number" required>
        <Input
          value={number}
          onChange={(event) => setNumber(event.target.value)}
          autoFocus
        />
      </Field>
      <Field label="Invoice date" required>
        <Day value={date} onChange={setDate} />
      </Field>
      <Field label="Amount" required>
        <Input
          inputMode="numeric"
          value={amount}
          onChange={(event) => setAmount(grouped(event.target.value))}
          className="text-right tabular-nums"
        />
      </Field>
      <Field label="What it is for">
        <Input value={note} onChange={(event) => setNote(event.target.value)} />
      </Field>
      {minor > 0 && (
        <p className="rounded-inner bg-soft px-4 py-3 text-[0.875rem] text-body">
          {covered === minor
            ? `The advance pays all of it. ${money(project.advance_left_minor - covered)} of the advance stays for the next invoice.`
            : covered > 0
              ? `The advance pays ${money(covered)}; ${money(minor - covered)} is owed to the contractor and paid by BKK.`
              : `No advance is left: ${money(minor)} is owed to the contractor and paid by BKK.`}
        </p>
      )}
      <div className="flex justify-end">
        <Button
          variant="primary"
          pending={save.isPending}
          disabled={number.trim() === "" || minor <= 0 || date === ""}
          onClick={() =>
            save.mutate({
              invoice_number: number,
              invoice_date: date,
              amount_minor: minor,
              note,
            })
          }
        >
          Add the invoice
        </Button>
      </div>
    </div>
  )
}

interface SplitDraft {
  key: number
  kind: "ASSET" | "EXPENSE"
  name: string
  class_code: string
  account_code: string
  account_name: string
  life: string
  amount: string
}

function CloseForm({
  project,
  onDone,
}: {
  project: Project
  onDone: () => void
}) {
  const classes = useAssetClasses()
  const [closedOn, setClosedOn] = useState(todayIso())
  const [lines, setLines] = useState<SplitDraft[]>([blankSplit(1)])
  const save = useSave(
    project.project_id,
    `${BASE}/${project.project_id}/close`,
    onDone
  )
  const placed = lines.reduce((sum, line) => sum + digits(line.amount), 0)
  const left = project.invoiced_minor - placed
  const usable = useMemo(
    () =>
      classes.rows.filter(
        (row) => row.is_active && row.class_code !== "CONTRACT_IN_PROGRESS"
      ),
    [classes.rows]
  )
  const update = (key: number, patch: Partial<SplitDraft>) =>
    setLines((now) =>
      now.map((line) => (line.key === key ? { ...line, ...patch } : line))
    )
  const ready =
    left === 0 &&
    lines.every(
      (line) =>
        digits(line.amount) > 0 &&
        line.name.trim() !== "" &&
        (line.kind === "ASSET"
          ? line.class_code !== ""
          : line.account_code !== "")
    )

  return (
    <div className="flex flex-col gap-4">
      {save.isError && <Banner tone="bad">{problemOf(save.error)}</Banner>}
      {project.advance_left_minor > 0 && (
        <Banner tone="warn">
          {money(project.advance_left_minor)} of the advance is not covered by
          an invoice. Add the last invoice before closing.
        </Banner>
      )}
      <Field label="Closed on" required>
        <Day value={closedOn} onChange={setClosedOn} notAfter={todayIso()} />
      </Field>

      <div className="flex flex-col gap-3">
        {lines.map((line, index) => (
          <div
            key={line.key}
            className="rounded-inner border border-hairline-2 p-4"
          >
            <div className="mb-3 flex items-center justify-between">
              <span className="text-[0.875rem] font-medium text-ink">
                Line {index + 1}
              </span>
              {lines.length > 1 && (
                <button
                  type="button"
                  className="text-[0.875rem] text-mute hover:text-ink"
                  onClick={() =>
                    setLines((now) => now.filter((one) => one.key !== line.key))
                  }
                >
                  Remove
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Into">
                <Select
                  value={line.kind}
                  onChange={(kind) =>
                    update(line.key, { kind: kind as SplitDraft["kind"] })
                  }
                >
                  <option value="ASSET">A new asset</option>
                  <option value="EXPENSE">An expense</option>
                </Select>
              </Field>
              <Field label="Amount">
                <Input
                  inputMode="numeric"
                  value={line.amount}
                  onChange={(event) =>
                    update(line.key, { amount: grouped(event.target.value) })
                  }
                  className="text-right tabular-nums"
                />
              </Field>
              <Field label="Name" className="col-span-2">
                <Input
                  value={line.name}
                  onChange={(event) =>
                    update(line.key, { name: event.target.value })
                  }
                />
              </Field>
              {line.kind === "ASSET" ? (
                <>
                  <Field label="Asset category">
                    <Select
                      value={line.class_code}
                      onChange={(code) => {
                        const picked = usable.find(
                          (row) => row.class_code === code
                        )
                        update(line.key, {
                          class_code: code,
                          life:
                            picked?.default_useful_life_months != null
                              ? String(picked.default_useful_life_months)
                              : line.life,
                        })
                      }}
                    >
                      <option value="">Choose a category</option>
                      {usable.map((row) => (
                        <option key={row.class_code} value={row.class_code}>
                          {row.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Life (months)">
                    <Input
                      inputMode="numeric"
                      value={line.life}
                      onChange={(event) =>
                        update(line.key, {
                          life: event.target.value.replace(/\D/g, ""),
                        })
                      }
                    />
                  </Field>
                </>
              ) : (
                <Field label="Expense account" className="col-span-2">
                  {line.account_code === "" ? (
                    <AccountPicker
                      onPick={(account) =>
                        update(line.key, {
                          account_code: account.account_code,
                          account_name: account.name,
                        })
                      }
                    />
                  ) : (
                    <button
                      type="button"
                      className="text-left text-ink hover:underline"
                      onClick={() =>
                        update(line.key, { account_code: "", account_name: "" })
                      }
                    >
                      {line.account_code} · {line.account_name}
                    </button>
                  )}
                </Field>
              )}
            </div>
          </div>
        ))}
        <button
          type="button"
          className="self-start text-[0.875rem] font-medium text-accent hover:underline"
          onClick={() =>
            setLines((now) => [
              ...now,
              blankSplit(Math.max(...now.map((one) => one.key)) + 1),
            ])
          }
        >
          + Add a line
        </button>
      </div>

      <div className="flex items-center justify-between rounded-inner bg-soft px-4 py-3">
        <span className="text-body">Left to place</span>
        <span
          className={
            left === 0
              ? "font-medium text-ok-fg tabular-nums"
              : "font-medium text-bad-fg tabular-nums"
          }
        >
          {money(left)}
        </span>
      </div>

      <p className="text-[0.875rem] text-mute">
        New assets go into the Fixed Asset Register at their share and start
        depreciating; expense lines land in this month&rsquo;s profit and loss.
      </p>

      <div className="flex justify-end">
        <Button
          variant="primary"
          pending={save.isPending}
          disabled={!ready || project.advance_left_minor > 0}
          onClick={() =>
            save.mutate({
              closed_on: closedOn,
              lines: lines.map((line) => ({
                kind: line.kind,
                name: line.name,
                class_code: line.kind === "ASSET" ? line.class_code : null,
                account_code:
                  line.kind === "EXPENSE" ? line.account_code : null,
                useful_life_months:
                  line.kind === "ASSET" && line.life !== ""
                    ? Number(line.life)
                    : null,
                amount_minor: digits(line.amount),
              })),
            })
          }
        >
          Close the project
        </Button>
      </div>
    </div>
  )
}

function blankSplit(key: number): SplitDraft {
  return {
    key,
    kind: "ASSET",
    name: "",
    class_code: "",
    account_code: "",
    account_name: "",
    life: "",
    amount: "",
  }
}

/// Rupiah typed with or without dots, read as a whole number.
function digits(text: string): number {
  return Number(text.replace(/\D/g, "")) || 0
}

/// Dots every three digits while typing, the way the amount is said.
function grouped(text: string): string {
  const n = digits(text)
  return n === 0 ? "" : n.toLocaleString("id-ID")
}

function plainUnit(label: string): string {
  return label.replace(/^[^·]*· /, "")
}

function lifeWords(months: number | null): string {
  if (months === null) return "—"
  return months % 12 === 0 ? `${months / 12} years` : `${months} months`
}

function moneyAccountWord(key: string): string {
  switch (key) {
    case "bank_giro":
      return "Bank giro"
    case "bank_savings":
      return "Bank savings"
    case "petty_cash":
      return "Petty cash"
    default:
      return "Cash"
  }
}
