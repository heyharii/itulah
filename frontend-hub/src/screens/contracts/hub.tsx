import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Archive, FileText, Paperclip } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Field, Input } from "@/components/ui/field"
import { MiniCell, MiniRow, MiniTable } from "@/components/ui/rows"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { Banner, LoadingState } from "@/components/ui/states"
import { Meter } from "@/components/ui/meter"
import { Pill } from "@/components/ui/pill"
import { count, day, money, span } from "@/lib/format"
import {
  archiveGaContract,
  gaContractHub,
  gaContractTypes,
  gaKeys,
  recordMeterReading,
} from "@/lib/queries/ga"
import { uploadDocument } from "@/lib/queries/workplace"
import {
  monthLabel,
  siteOf,
  useContractParty,
} from "@/screens/contracts/format"
import { FinanceMark, StandingPill } from "@/screens/contracts/parts"
import { BillRequestForm } from "@/screens/ga/bill-request"
import type {
  GaContractHub,
  GaContractRow,
  GaDocument,
  GaMeterReading,
} from "@itulah/contract"

/// One contract, as GA keeps the deal — and the half that belongs to the
/// other desk is marked as the other desk's.
///
/// # Tabs, and why bills are not GA's tab to act on
///
/// Details is GA's own fact. Bills and Recurring bills are Finance's answers
/// pointed back at this contract through `contract_id` — read here so the
/// person renewing the deal can see what it has been costing, and marked
/// Finance's because the ledger behind them is not this register's. GA sends a
/// supplier's bill from the Bills tab as a draft; posting it stays Finance's.
///
/// # Usage exists for one group
///
/// A meter is a Subscriptions fact: listrik, air, telepon. A rent contract has no
/// meter, so the tab is not drawn for it — a tab that always says "no
/// readings" is a tab asking to be ignored.
export function ContractHubSheet({
  contractId,
  open,
  onClose,
}: {
  contractId: string | undefined
  open: boolean
  onClose: () => void
}) {
  const partyName = useContractParty()
  const hub = useQuery({
    queryKey: gaKeys.contract(contractId ?? ""),
    queryFn: ({ signal }) => gaContractHub(contractId ?? "", signal),
    enabled: open && contractId !== undefined,
  })

  // The archive is the sheet's one head action, and its form — reason and
  // all — lands in the footer, below every tab: a decision about the RECORD,
  // not about whichever tab happens to be open. The screen keys this sheet
  // per contract, so the question drops whenever another record opens.
  const [archiving, setArchiving] = useState(false)

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      width="wide"
      title={hub.data === undefined ? "Contract" : partyName(hub.data.contract)}
      id={
        hub.data === undefined
          ? undefined
          : (hub.data.contract.contract_number ?? hub.data.contract.contract_id)
      }
      caption={
        hub.data === undefined ? undefined : (
          <>
            {hub.data.contract.contract_type_name} · {siteOf(hub.data.contract)}
          </>
        )
      }
      subject={
        contractId === undefined
          ? undefined
          : { kind: "contract", id: contractId }
      }
      badge={
        hub.data === undefined ? undefined : (
          <>
            <StandingPill row={hub.data.contract} />
            {hub.data.contract.archived && <Pill tone="neutral">Archived</Pill>}
          </>
        )
      }
      actions={
        hub.data === undefined || hub.data.contract.archived ? undefined : (
          <Button variant="soft" onClick={() => setArchiving(true)}>
            <Archive />
            Archive
          </Button>
        )
      }
      footer={
        hub.data !== undefined && archiving ? (
          <ArchiveForm
            row={hub.data.contract}
            onDone={onClose}
            onCancel={() => setArchiving(false)}
          />
        ) : undefined
      }
      tabs={
        hub.data === undefined
          ? undefined
          : [
              {
                value: "detail",
                label: "Details",
                content: <DetailTab hub={hub.data} />,
              },
              {
                value: "bills",
                label: "Bills (Finance)",
                content: (
                  <BillsTab row={hub.data.contract} bills={hub.data.bills} />
                ),
              },
              // Only the subscribers carry meters. The other fifteen types
              // would draw a tab with nothing to read.
              ...(hub.data.contract.group_code === "LANGGANAN"
                ? [
                    {
                      value: "usage",
                      label: "Usage",
                      content: (
                        <UsageTab
                          contractId={hub.data.contract.contract_id}
                          readings={hub.data.meter_readings}
                        />
                      ),
                    },
                  ]
                : []),
              {
                value: "templates",
                label: "Recurring bills (Finance)",
                content: <TemplatesTab templates={hub.data.templates} />,
              },
              {
                value: "documents",
                label: "Documents",
                content: (
                  <DocumentsTab
                    row={hub.data.contract}
                    documents={hub.data.documents}
                  />
                ),
              },
            ]
      }
    >
      {hub.isLoading && <LoadingState>Opening the contract…</LoadingState>}
      {hub.error instanceof Error && (
        <Banner tone="bad">{hub.error.message}</Banner>
      )}
    </Sheet>
  )
}

/// The deal's own facts, plus the one warning this register owes the reader:
/// when Finance's map has no expense account for this type, every bill under
/// the contract is a decision Finance has not made yet (brief §4.2).
function DetailTab({ hub }: { hub: GaContractHub }) {
  const partyName = useContractParty()
  const contract = hub.contract

  // Resolved for the contract's own site; a scope contract (all stores) is
  // read at the server's default, which is where Finance reads it too.
  const types = useQuery({
    queryKey: gaKeys.contractTypes(contract.site_id),
    queryFn: ({ signal }) => gaContractTypes(contract.site_id, signal),
    staleTime: 5 * 60 * 1000,
  })

  const type = types.data?.find((one) => one.code === contract.contract_type)

  return (
    <div className="flex flex-col gap-5">
      {type?.expense_account_code === null && (
        <MissingAccountBox
          contractType={contract.contract_type}
          prepaid={type.prepaid_account_code}
        />
      )}

      <section>
        <h4 className="mb-2.5 border-b border-hairline pb-1.5 text-card-title font-semibold text-ink">
          Contract details
        </h4>
        <Facts>
          <Fact term="Party">
            {partyName(contract)}
            {contract.counterparty_name !== null && (
              <span className="text-pill font-normal text-mute">
                {" "}
                · text, not a vendor
              </span>
            )}
          </Fact>
          <Fact term="Type">{contract.contract_type_name}</Fact>
          {contract.objek_name !== null && (
            <Fact term="Object">{contract.objek_name}</Fact>
          )}
          <Fact term="Location">{siteOf(contract)}</Fact>
          <Fact term="Term">{span(contract.starts_on, contract.ends_on)}</Fact>
          {contract.customer_number !== null && (
            <Fact term="Customer no.">{contract.customer_number}</Fact>
          )}
          <Fact term="Signed">
            {contract.is_signed
              ? contract.signed_by === null
                ? "Yes"
                : `Yes · by ${contract.signed_by}`
              : "Not yet"}
          </Fact>
          <Fact term="Contract value">
            {money(contract.contract_value_minor)}
            {contract.contract_value_minor === null && (
              <span className="text-pill font-normal text-mute">
                {" "}
                · no contract value
              </span>
            )}
          </Fact>
          <Fact term="Reminder">
            {`${contract.reminder_days} days before expiry`}
          </Fact>
          {contract.notes !== null && (
            <Fact term="Notes">{contract.notes}</Fact>
          )}
        </Facts>
      </section>
    </div>
  )
}

/// The account Finance would bill this contract's expense to does not exist —
/// either because the COA itself has no such account yet, or because the type
/// deliberately borrows its expense from somewhere else. Both are Finance's
/// decision to unblock; the box exists so a GA reader stops wondering why the
/// bills under this contract look odd.
function MissingAccountBox({
  contractType,
  prepaid,
}: {
  contractType: string
  prepaid: string | null
}) {
  let sentence: string
  if (contractType === "SEWA_KENDARAAN") {
    sentence = `Vehicle rental expense is not yet in the COA; bills can be recorded to the prepaid account${prepaid === null ? "" : ` (${prepaid})`}, but releasing it stays on hold. Finance's decision.`
  } else if (contractType === "JASA_MAINTENANCE") {
    sentence = `Maintenance contract expense follows the object being maintained (repair_expense); its mapping ships together with the Repairs module. In the meantime, bills can be recorded to the prepaid account${prepaid === null ? "" : ` (${prepaid})`}.`
  } else {
    sentence =
      "This contract type doesn't have an expense account in the account map for this site yet. Finance maps it; until then, bills under this type stay in the prepaid account."
  }
  return <Banner tone="warn">{sentence}</Banner>
}

/// The bills pointed at this contract: Finance's ledger, read.
///
/// The figures count bills Finance has POSTED against this contract; a bill
/// GA sent from here shows once it is posted.
function BillsTab({
  row,
  bills,
}: {
  row: GaContractRow
  bills: GaContractHub["bills"]
}) {
  const [billing, setBilling] = useState(false)
  // A contract GA pays (not one the company lets out), with a supplier on it.
  // A contract over several sites splits its bill per site, which is Finance's
  // form to do; one site is a single line GA can send.
  const payable = row.group_code !== "DISEWAKAN" && row.supplier_id !== null
  return (
    <div className="flex flex-col gap-4">
      {payable &&
        !billing &&
        (row.site_id !== null ? (
          <div>
            <Button variant="soft" onClick={() => setBilling(true)}>
              Send bill to Finance
            </Button>
          </div>
        ) : (
          <p className="text-pill text-mute">
            This contract covers several sites, so Finance enters its bill and
            splits it per site.
          </p>
        ))}
      {billing && row.site_id !== null && (
        <BillRequestForm
          source={{
            site_id: row.site_id,
            supplier_id: row.supplier_id,
            supplier_name: row.supplier_name,
            amount_minor: null,
            memo: row.contract_number ?? row.contract_type_name,
            contract_id: row.contract_id,
            period: true,
          }}
          onDone={() => setBilling(false)}
          onCancel={() => setBilling(false)}
        />
      )}
      <div className="grid grid-cols-2 gap-3">
        <figure>
          <figcaption className="text-eyebrow font-medium text-body">
            {row.group_code === "DISEWAKAN"
              ? "Received to date"
              : "Billed to date"}{" "}
            <FinanceMark />
          </figcaption>
          <div className="mt-1 text-[1.125rem] leading-none font-semibold tracking-[-0.02em] text-ink tabular-nums">
            {money(row.billed_minor)}
          </div>
        </figure>
        <figure>
          <figcaption className="text-eyebrow font-medium text-body">
            {row.group_code === "DISEWAKAN" ? "Not yet received" : "Remaining"}{" "}
            <FinanceMark />
          </figcaption>
          <div className="mt-1 text-[1.125rem] leading-none font-semibold tracking-[-0.02em] text-ink tabular-nums">
            {money(row.remaining_minor)}
            {row.remaining_minor === null && (
              <span className="text-pill font-normal text-mute">
                {" "}
                · no contract value
              </span>
            )}
          </div>
        </figure>
      </div>

      {row.contract_value_minor !== null && row.contract_value_minor > 0 && (
        <Meter value={row.billed_minor / row.contract_value_minor} />
      )}

      <div className="overflow-x-auto">
        <div className="min-w-[26rem]">
          <MiniTable
            head={[
              "Number",
              { label: "Date", align: "left" },
              { label: "Amount", align: "right" },
              { label: "Account", align: "left" },
            ]}
          >
            {bills.length === 0 ? (
              <MiniRow>
                <MiniCell colSpan={4}>
                  <span className="text-meta text-mute">
                    No bills point to this contract yet.
                  </span>
                </MiniCell>
              </MiniRow>
            ) : (
              bills.map((bill) => (
                <MiniRow key={bill.invoice_id}>
                  <MiniCell>
                    <span className="font-mono text-id">
                      {bill.invoice_number}
                    </span>
                  </MiniCell>
                  <MiniCell>{day(bill.invoice_date)}</MiniCell>
                  <MiniCell align="right" className="tabular-nums">
                    {money(bill.amount_minor)}
                  </MiniCell>
                  <MiniCell>
                    <span className="font-mono text-id">
                      {bill.account_code}
                    </span>
                  </MiniCell>
                </MiniRow>
              ))
            )}
          </MiniTable>
        </div>
      </div>

      <p className="text-pill text-mute">
        Counted from bills Finance has posted against this contract; a bill sent
        from here shows once Finance posts it. The prepaid period is the bill's
        own period, not the contract's.
      </p>
    </div>
  )
}

/// Meter readings, one bar a month — GA's own record, so nothing here is
/// marked Finance's.
function UsageTab({
  contractId,
  readings,
}: {
  contractId: string
  readings: readonly GaMeterReading[]
}) {
  const [recording, setRecording] = useState(false)

  // Relative to the heaviest month, never absolute: 40.100 kWh and 105 m³
  // must read as the same shape of chart, and both must survive a month
  // where nothing was recorded without dividing by zero.
  const max = Math.max(1, ...readings.map((one) => one.usage))

  return (
    <div className="flex flex-col gap-4">
      {readings.length === 0 ? (
        <p className="text-meta text-body">
          No readings yet. GA records the meter reading once a month, from the
          opening figure to the closing figure; the difference is the usage.
        </p>
      ) : (
        <div>
          <div className="text-eyebrow font-medium text-body">
            Usage per month · {readings[readings.length - 1].unit}
          </div>
          <div className="mt-3 flex items-end gap-3">
            {readings.map((one) => (
              <div
                key={one.reading_id}
                className="flex w-[2.5rem] flex-col items-center gap-1"
              >
                <span className="text-pill text-mute tabular-nums">
                  {abbr(one.usage)}
                </span>
                <span
                  className="w-full rounded-t-inner bg-accent"
                  style={{
                    height: Math.max(2, Math.round((one.usage / max) * 64)),
                  }}
                />
                <span className="text-pill text-mute">
                  {monthLabel(one.period).split(" ")[0]}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="text-pill text-mute">
        GA records the meter figure per month; the bill amount is read from
        Finance. Recording a month that already exists replaces its figures,
        rather than adding a row.
      </p>

      {recording ? (
        <ReadingForm
          contractId={contractId}
          readings={readings}
          onDone={() => setRecording(false)}
          onCancel={() => setRecording(false)}
        />
      ) : (
        <div>
          <Button variant="soft" onClick={() => setRecording(true)}>
            Record reading
          </Button>
        </div>
      )}
    </div>
  )
}

/// Thousands, said the way the prototype's usage strip says them: 40100
/// above a bar is "40,1rb", because a nine-character figure over a 64px bar
/// is wider than the bar. Names the abbreviation rule the JSX would not.
function abbr(value: number): string {
  return value >= 1000
    ? `${(value / 1000).toLocaleString("id-ID", { maximumFractionDigits: 1 })}rb`
    : count(value)
}

/// One reading: the month, the unit, opening → closing, and when it was read.
///
/// Errors only ever name the field that is wrong, appear on the submit that
/// finds the problem and disappear the moment that field is edited again —
/// brief §10.2's rule, kept by clearing per field on change.
function ReadingForm({
  contractId,
  readings,
  onDone,
  onCancel,
}: {
  contractId: string
  readings: readonly GaMeterReading[]
  onDone: () => void
  onCancel: () => void
}) {
  const client = useQueryClient()
  const last = readings[readings.length - 1]
  const [form, setForm] = useState<Record<string, string>>({
    unit: last?.unit ?? "",
    read_on: new Date().toISOString().slice(0, 10),
  })
  const [problems, setProblems] = useState<Record<string, string>>({})
  const set = (key: string, value: string) => {
    // Editing a field is the reader taking the error back; keep the sentence
    // only while the field itself stays wrong.
    setProblems((current) => ({ ...current, [key]: "" }))
    setForm((current) => ({ ...current, [key]: value }))
  }

  const save = useMutation({
    mutationFn: () =>
      recordMeterReading(contractId, {
        period: `${form.period ?? ""}-01`,
        unit: (form.unit ?? "").trim(),
        opening: Number(form.opening),
        closing: Number(form.closing),
        read_on: form.read_on ?? "",
      }),
    onSuccess: () => {
      // The reading changes the contract's hub and the register's usage
      // column; both live under the GA prefix.
      void client.invalidateQueries({ queryKey: gaKeys.all })
      onDone()
    },
  })

  const submit = () => {
    const next: Record<string, string> = {}
    if ((form.period ?? "") === "") next.period = "Enter the reading month."
    if ((form.unit ?? "").trim() === "") next.unit = "Enter the unit."
    if ((form.opening ?? "") === "") next.opening = "Enter the opening figure."
    if ((form.closing ?? "") === "") next.closing = "Enter the closing figure."
    if (
      (form.opening ?? "") !== "" &&
      (form.closing ?? "") !== "" &&
      Number(form.closing) < Number(form.opening)
    ) {
      next.closing = "The closing figure cannot be below the opening figure."
    }
    if (Object.keys(next).length > 0) {
      setProblems(next)
      return
    }
    save.mutate()
  }

  return (
    <div className="rounded-inner border border-hairline-2 p-3.5">
      {save.error instanceof Error && (
        <Banner tone="bad">{save.error.message}</Banner>
      )}
      <div className="grid grid-cols-2 gap-4">
        <Field
          label="Reading month"
          required
          aside={
            last === undefined ? undefined : `last ${monthLabel(last.period)}`
          }
          problem={problems.period || undefined}
        >
          <Input
            type="month"
            value={form.period ?? ""}
            onChange={(event) => set("period", event.target.value)}
          />
        </Field>
        <Field label="Unit" problem={problems.unit || undefined} required>
          <Input
            value={form.unit ?? ""}
            onChange={(event) => set("unit", event.target.value)}
          />
        </Field>
        <Field
          label="Opening figure"
          problem={problems.opening || undefined}
          required
        >
          <Input
            inputMode="numeric"
            value={form.opening ?? ""}
            onChange={(event) => set("opening", event.target.value)}
          />
        </Field>
        <Field
          label="Closing figure"
          problem={problems.closing || undefined}
          required
        >
          <Input
            inputMode="numeric"
            value={form.closing ?? ""}
            onChange={(event) => set("closing", event.target.value)}
          />
        </Field>
        <Field label="Reading date" required>
          <Input
            type="date"
            value={form.read_on ?? ""}
            onChange={(event) => set("read_on", event.target.value)}
          />
        </Field>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Button variant="primary" pending={save.isPending} onClick={submit}>
          {save.isPending ? "Submitting…" : "Submit"}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

/// The recurring templates raised under this contract — Finance's, read only.
///
/// A template is how the bills HAPPEN: Finance names the amount and the day,
/// and this register only gets to see which template points here. A GA screen
/// that could edit one would be editing Finance's billing run from the wrong
/// side of the fence.
function TemplatesTab({
  templates,
}: {
  templates: GaContractHub["templates"]
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-x-auto">
        <div className="min-w-[34rem]">
          <MiniTable
            head={[
              "Label",
              { label: "Estimate", align: "right" },
              { label: "Tolerance", align: "right" },
              { label: "Due Day", align: "right" },
              { label: "Status", align: "left" },
            ]}
          >
            {templates.length === 0 ? (
              <MiniRow>
                <MiniCell colSpan={5}>
                  <span className="text-meta text-mute">
                    No recurring bills point to this contract yet. Templates are
                    created by Finance in Recurring bills.
                  </span>
                </MiniCell>
              </MiniRow>
            ) : (
              templates.map((template) => (
                <MiniRow key={template.template_id}>
                  <MiniCell>{template.label}</MiniCell>
                  <MiniCell align="right" className="tabular-nums">
                    {money(template.expected_subtotal_minor)}
                  </MiniCell>
                  <MiniCell align="right" className="tabular-nums">
                    {template.tolerance_bps / 100}%
                  </MiniCell>
                  <MiniCell align="right" className="tabular-nums">
                    {template.due_day}
                  </MiniCell>
                  <MiniCell>
                    <Pill tone={template.active ? "ok" : "neutral"}>
                      {template.active ? "Active" : "Inactive"}
                    </Pill>
                  </MiniCell>
                </MiniRow>
              ))
            )}
          </MiniTable>
        </div>
      </div>
      <p className="text-pill text-mute">
        <FinanceMark className="mr-1 align-[0.0625rem]" /> The monthly amount
        belongs to the recurring bill (Finance); the contract stores the agreed
        total value, not the monthly figure.
      </p>
    </div>
  )
}

/// The papers with a date on them, filed from the record they belong to.
///
/// The same door the asset hub opens onto the Library: the person holding the
/// paper is standing at this contract, and a door here still lands in the
/// Library like every other document — linked, not copied.
function DocumentsTab({
  row,
  documents,
}: {
  row: GaContractRow
  documents: readonly GaDocument[]
}) {
  const client = useQueryClient()
  const [adding, setAdding] = useState(false)

  return (
    <div className="flex flex-col gap-4">
      {documents.length === 0 ? (
        <p className="text-meta text-body">
          No documents yet. Signed agreements, amendment attachments, notice
          letters — attached here and indexed in the Library.
        </p>
      ) : (
        <ul className="flex flex-col">
          {documents.map((document) => (
            <li
              key={document.document_id}
              className="flex items-center gap-3 border-b border-hairline py-2.5 last:border-b-0"
            >
              <FileText className="size-4 shrink-0 stroke-[1.7] text-line-ico" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-cell text-ink">
                  {document.doc_type ?? document.title ?? document.name}
                </span>
                <span className="block truncate font-mono text-pill text-mute">
                  {document.doc_number ?? document.name}
                </span>
              </span>
              <span className="shrink-0 text-pill text-mute tabular-nums">
                {document.expires_on === null
                  ? "no expiry date"
                  : `until ${day(document.expires_on)}`}
              </span>
            </li>
          ))}
        </ul>
      )}

      {adding ? (
        <AttachForm
          row={row}
          onDone={() => {
            setAdding(false)
            void client.invalidateQueries({ queryKey: gaKeys.all })
          }}
          onCancel={() => setAdding(false)}
        />
      ) : (
        <div>
          <Button variant="soft" onClick={() => setAdding(true)}>
            <Paperclip />
            Attach document
          </Button>
        </div>
      )}
    </div>
  )
}

/// The form's empty string, as the wire spells "not given". Five fields read
/// it, so they stay honest about absence in one place rather than five ways.
function blank(value: string | undefined): string | null {
  const trimmed = (value ?? "").trim()
  return trimmed === "" ? null : trimmed
}

/// Filing one paper against this contract — the Library's two-step: bytes
/// first, document row second, so a slow photograph never blocks the form.
function AttachForm({
  row,
  onDone,
  onCancel,
}: {
  row: GaContractRow
  onDone: () => void
  onCancel: () => void
}) {
  const [file, setFile] = useState<File | null>(null)
  const [form, setForm] = useState<Record<string, string>>({})
  const set = (key: string, value: string) =>
    setForm((current) => ({ ...current, [key]: value }))

  const save = useMutation({
    mutationFn: () => {
      if (file === null) throw new Error("Choose the file first.")
      return uploadDocument(file, {
        title: blank(form.title) ?? undefined,
        doc_type: blank(form.doc_type) ?? undefined,
        doc_number: blank(form.doc_number) ?? undefined,
        issuer: blank(form.issuer) ?? undefined,
        issued_on: blank(form.issued_on) ?? undefined,
        expires_on: blank(form.expires_on) ?? undefined,
        path_tokens: ["GA", row.contract_number ?? row.contract_id],
        tags: [],
        links: [{ subject_kind: "contract", subject_id: row.contract_id }],
      })
    },
    onSuccess: onDone,
  })

  return (
    <div className="rounded-inner border border-hairline-2 p-3.5">
      {save.error instanceof Error && (
        <Banner tone="bad">{save.error.message}</Banner>
      )}
      <div className="grid grid-cols-2 gap-4">
        <Field label="File" required>
          <Input
            type="file"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
        </Field>
        <Field label="Document type" aside="agreement, amendment, letter">
          <Input
            value={form.doc_type ?? ""}
            onChange={(event) => set("doc_type", event.target.value)}
          />
        </Field>
        <Field label="Number">
          <Input
            value={form.doc_number ?? ""}
            onChange={(event) => set("doc_number", event.target.value)}
          />
        </Field>
        <Field label="Issuer">
          <Input
            value={form.issuer ?? ""}
            onChange={(event) => set("issuer", event.target.value)}
          />
        </Field>
        <Field label="Issued">
          <Input
            type="date"
            value={form.issued_on ?? ""}
            onChange={(event) => set("issued_on", event.target.value)}
          />
        </Field>
        <Field label="Valid until" aside="empty = no expiry">
          <Input
            type="date"
            value={form.expires_on ?? ""}
            onChange={(event) => set("expires_on", event.target.value)}
          />
        </Field>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Button
          variant="primary"
          pending={save.isPending}
          disabled={file === null}
          onClick={() => save.mutate()}
        >
          {save.isPending ? "Submitting…" : "Submit"}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

/// Archiving — the register's only exit, and a reasoned one.
///
/// There is no delete on this register (brief §12): a contract a bill has
/// pointed at must stay answerable. The reason is the server's requirement
/// and the form's: a deal that leaves the living list without a recorded why
/// is a question six months later that nobody can answer.
function ArchiveForm({
  row,
  onDone,
  onCancel,
}: {
  row: GaContractRow
  onDone: () => void
  onCancel: () => void
}) {
  const client = useQueryClient()
  const [reason, setReason] = useState("")
  const [problem, setProblem] = useState("")

  const archive = useMutation({
    mutationFn: () =>
      archiveGaContract(row.contract_id, { archived: true, reason }),
    onSuccess: () => {
      // The register's lists and the overview both count this contract; the
      // whole GA namespace drops together, as every GA write does here.
      void client.invalidateQueries({ queryKey: gaKeys.all })
      onDone()
    },
  })

  const submit = () => {
    if (reason.trim() === "") {
      setProblem("Write the reason first.")
      return
    }
    archive.mutate()
  }

  return (
    <div className="flex items-end gap-3">
      <Field
        label={`Archive ${row.contract_number ?? row.contract_id}`}
        problem={problem || undefined}
        className="flex-1"
        required
      >
        <Input
          value={reason}
          onChange={(event) => {
            setProblem("")
            setReason(event.target.value)
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") submit()
          }}
        />
      </Field>
      <Button variant="primary" pending={archive.isPending} onClick={submit}>
        {archive.isPending ? "Archiving…" : "Archive"}
      </Button>
      <Button variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  )
}
