import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Field, Input, Select } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Banner } from "@/components/ui/states"
import { node } from "@/lib/api"
import { SiteName, SiteSelect } from "@/screens/finance/parts"
import type {
  AcquirerFeeRate,
  AddBankOutcome,
  AddBankRequest,
  EdcTerminal,
  FinanceSetting,
} from "@itulah/contract"

/// Finance setup for the sales day (Finance Connect, 25 Sep).
///
/// Four things Finance owns and the POS relies on: which bank each shop EDC
/// terminal belongs to (a QRIS without one waits in the sale-day exception
/// queue), the MDR rates a settlement is checked against, the tolerances and
/// windows, and "Tambah bank" — the one act that makes a new bank postable.
const keys = {
  terminals: ["finance", "edc-terminals"] as const,
  rates: ["finance", "acquirer-fee-rates"] as const,
  settings: ["finance", "settings"] as const,
}

const problemText = (error: unknown) =>
  error instanceof Error ? error.message : String(error)

export function SalesSetup() {
  const client = useQueryClient()
  const terminals = useQuery({
    queryKey: keys.terminals,
    queryFn: ({ signal }) =>
      node.get<EdcTerminal[]>("/api/v1/finance/edc-terminals", { signal }),
  })
  const rates = useQuery({
    queryKey: keys.rates,
    queryFn: ({ signal }) =>
      node.get<AcquirerFeeRate[]>("/api/v1/finance/acquirer-fee-rates", {
        signal,
      }),
  })
  const settings = useQuery({
    queryKey: keys.settings,
    queryFn: ({ signal }) =>
      node.get<FinanceSetting[]>("/api/v1/finance/settings", { signal }),
  })

  // ── Tambah bank ─────────────────────────────────────────────────────────
  const [bank, setBank] = useState({
    bank_code: "",
    bank_name: "",
    giro: true,
    savings: false,
    debit_card: true,
    account_no: "",
    account_holder: "",
  })
  const addBank = useMutation({
    mutationFn: (request: AddBankRequest) =>
      node.post<AddBankOutcome>("/api/v1/finance/banks/add", request),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["finance"] })
    },
  })

  // ── terminal ────────────────────────────────────────────────────────────
  const [terminal, setTerminal] = useState({
    site_id: "",
    terminal_id: "",
    bank_code: "",
  })
  const saveTerminal = useMutation({
    mutationFn: () =>
      node.post<EdcTerminal>("/api/v1/finance/edc-terminals", {
        ...terminal,
        label: null,
        active: true,
      }),
    onSuccess: () =>
      void client.invalidateQueries({ queryKey: keys.terminals }),
  })

  // ── rate ────────────────────────────────────────────────────────────────
  const [rate, setRate] = useState({
    bank_code: "",
    fee_kind: "DEBIT_ON_US",
    rate_percent: "",
    effective_from: new Date().toISOString().slice(0, 10),
  })
  const saveRate = useMutation({
    mutationFn: () =>
      node.post<AcquirerFeeRate>("/api/v1/finance/acquirer-fee-rates", {
        ...rate,
        note: null,
      }),
    onSuccess: () => void client.invalidateQueries({ queryKey: keys.rates }),
  })

  return (
    <PageContent>
      <PageHeader
        crumb="Finance · Setup"
        title="Sales & Banks"
        sub="EDC terminals, MDR rates, tolerances, and adding a bank"
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="flex flex-col gap-3 p-4">
          <h2 className="text-[0.9375rem] font-semibold text-ink">Add bank</h2>
          <p className="text-[0.875rem] text-body">
            Creates the bank&apos;s leaves in the right groups (Cash In Bank
            Giro / Tabungan, Outstanding Giro, Penjualan Debit Card), maps them
            by the bank&apos;s code, registers the account and — QRIS on this
            bank&apos;s EDC posts to its debit-card pair.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Bank code" required hint="e.g. BSI">
              <Input
                value={bank.bank_code}
                onChange={(e) =>
                  setBank({ ...bank, bank_code: e.target.value.toUpperCase() })
                }
              />
            </Field>
            <Field label="Name in the chart" required hint="e.g. BSI">
              <Input
                value={bank.bank_name}
                onChange={(e) =>
                  setBank({ ...bank, bank_name: e.target.value })
                }
              />
            </Field>
            <Field label="Account number">
              <Input
                value={bank.account_no}
                onChange={(e) =>
                  setBank({ ...bank, account_no: e.target.value })
                }
              />
            </Field>
            <Field label="Account holder">
              <Input
                value={bank.account_holder}
                onChange={(e) =>
                  setBank({ ...bank, account_holder: e.target.value })
                }
              />
            </Field>
          </div>
          <div className="flex flex-wrap gap-4 text-[0.875rem] text-text">
            {(["giro", "savings", "debit_card"] as const).map((flag) => (
              <label key={flag} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={bank[flag]}
                  onChange={(e) =>
                    setBank({ ...bank, [flag]: e.target.checked })
                  }
                />
                {flag === "giro"
                  ? "Giro"
                  : flag === "savings"
                    ? "Savings"
                    : "Debit card / QRIS"}
              </label>
            ))}
          </div>
          <div>
            <Button
              pending={addBank.isPending}
              disabled={!bank.bank_code || !bank.bank_name}
              onClick={() =>
                addBank.mutate({
                  bank_code: bank.bank_code,
                  bank_name: bank.bank_name,
                  giro: bank.giro,
                  savings: bank.savings,
                  debit_card: bank.debit_card,
                  account_no: bank.account_no || null,
                  account_holder: bank.account_holder || null,
                  account_unit_id: null,
                  terminals: [],
                })
              }
            >
              Add bank
            </Button>
          </div>
          {addBank.isError && (
            <Banner tone="bad">{problemText(addBank.error)}</Banner>
          )}
        </Card>

        <Card className="flex flex-col gap-3 p-4">
          <h2 className="text-[0.9375rem] font-semibold text-ink">
            EDC terminals
          </h2>
          <table className="text-[0.875rem]">
            <thead className="text-left text-mute">
              <tr>
                <th>Site</th>
                <th>Terminal</th>
                <th>Bank</th>
              </tr>
            </thead>
            <tbody>
              {(terminals.data ?? []).map((row) => (
                <tr key={`${row.site_id}/${row.terminal_id}`}>
                  <td>
                    <SiteName id={row.site_id} />
                  </td>
                  <td>{row.terminal_id}</td>
                  <td>{row.bank_code}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="grid grid-cols-3 gap-2 max-md:grid-cols-1">
            <SiteSelect
              value={terminal.site_id}
              onChange={(site_id) => setTerminal({ ...terminal, site_id })}
              emptyLabel="Shop"
            />
            <Input
              value={terminal.terminal_id}
              onChange={(e) =>
                setTerminal({ ...terminal, terminal_id: e.target.value })
              }
            />
            <Input
              value={terminal.bank_code}
              onChange={(e) =>
                setTerminal({
                  ...terminal,
                  bank_code: e.target.value.toUpperCase(),
                })
              }
            />
          </div>
          <div>
            <Button
              pending={saveTerminal.isPending}
              onClick={() => saveTerminal.mutate()}
            >
              Save terminal
            </Button>
          </div>
          {saveTerminal.isError && (
            <Banner tone="bad">{problemText(saveTerminal.error)}</Banner>
          )}
        </Card>

        <Card className="flex flex-col gap-3 p-4">
          <h2 className="text-[0.9375rem] font-semibold text-ink">MDR rates</h2>
          <p className="text-[0.875rem] text-body">
            Final rates: the bank&apos;s MDR already includes VAT.
          </p>
          <table className="text-[0.875rem]">
            <thead className="text-left text-mute">
              <tr>
                <th>Bank</th>
                <th>Kind</th>
                <th>Rate %</th>
                <th>From</th>
              </tr>
            </thead>
            <tbody>
              {(rates.data ?? []).map((row) => (
                <tr
                  key={`${row.bank_code}/${row.fee_kind}/${row.effective_from}`}
                >
                  <td>{row.bank_code}</td>
                  <td>{row.fee_kind}</td>
                  <td>{row.rate_percent}</td>
                  <td>{row.effective_from}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="grid grid-cols-4 gap-2 max-md:grid-cols-2">
            <Input
              value={rate.bank_code}
              onChange={(e) =>
                setRate({ ...rate, bank_code: e.target.value.toUpperCase() })
              }
            />
            <Select
              aria-label="Fee kind"
              value={rate.fee_kind}
              onChange={(fee_kind) => setRate({ ...rate, fee_kind })}
            >
              {["DEBIT_ON_US", "DEBIT_OFF_US", "CREDIT", "QRIS"].map((kind) => (
                <option key={kind} value={kind}>
                  {kind}
                </option>
              ))}
            </Select>
            <Input
              value={rate.rate_percent}
              onChange={(e) =>
                setRate({ ...rate, rate_percent: e.target.value })
              }
            />
            <Input
              type="date"
              value={rate.effective_from}
              onChange={(e) =>
                setRate({ ...rate, effective_from: e.target.value })
              }
            />
          </div>
          <div>
            <Button
              pending={saveRate.isPending}
              onClick={() => saveRate.mutate()}
            >
              Save rate
            </Button>
          </div>
          {saveRate.isError && (
            <Banner tone="bad">{problemText(saveRate.error)}</Banner>
          )}
        </Card>

        <Card className="flex flex-col gap-3 p-4">
          <h2 className="text-[0.9375rem] font-semibold text-ink">
            Finance settings
          </h2>
          <table className="text-[0.875rem] max-md:block max-md:[&_tbody]:block max-md:[&_td]:block max-md:[&_td]:pr-0 max-md:[&_tr]:block max-md:[&_tr]:border-b max-md:[&_tr]:border-hairline max-md:[&_tr]:py-2.5 max-md:[&_tr:last-child]:border-b-0">
            <tbody>
              {(settings.data ?? []).map((row) => (
                <tr key={row.setting_key}>
                  <td className="pr-3 font-medium">{row.setting_key}</td>
                  <td className="pr-3">
                    {row.value} {row.unit}
                  </td>
                  <td className="text-mute">{row.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </PageContent>
  )
}
