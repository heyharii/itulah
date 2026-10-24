import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { Plus } from "lucide-react"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { DockTools } from "@/components/shell/dock-tools"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Fab } from "@/components/ui/fab"
import { Field, Input, Select } from "@/components/ui/field"
import { SearchSuggest } from "@/components/ui/list-chrome"
import { PageHeader } from "@/components/ui/page-header"
import { KeyValue } from "@/components/ui/rows"
import { Sheet } from "@/components/ui/sheet"
import { Banner } from "@/components/ui/states"
import { SubTabs } from "@/components/ui/sub-tabs"
import { node } from "@/lib/api"
import { useLayout } from "@/lib/layout"
import { tableSetup, type TableSetup } from "@/lib/table"
import { SheetFooter } from "@/screens/people/settings-kit"
import { useOpener } from "@/screens/people/settings-lib"
import type {
  AcquirerFeeRate,
  AddBankOutcome,
  AddBankRequest,
  FinanceSetting,
} from "@itulah/contract"

/// Finance setup for the sales day (Finance Connect, 25 Sep).
///
/// What Finance owns and the POS relies on: the MDR rates a settlement is
/// checked against, the tolerances and windows, and "Tambah bank" — the one
/// act that makes a new bank postable. A shop's EDC machines are set on Shop
/// Payment Methods (0989), where the terminals tab that stood here went.
const keys = {
  rates: ["finance", "acquirer-fee-rates"] as const,
  settings: ["finance", "settings"] as const,
}

const problemText = (error: unknown) =>
  error instanceof Error ? error.message : String(error)

/// A list as its tab's one body: the page scrolls, phones get cards.
function ListTable<TRow>({
  rows,
  columns,
  getRowId,
  empty,
}: {
  rows: readonly TRow[]
  columns: ColumnDef<TableSetup, TRow>[]
  getRowId: (row: TRow) => string
  empty: string
}) {
  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows as TRow[],
        columns,
        getRowId,
      }),
      [rows, columns, getRowId]
    )
  )
  return <DataTable<TRow> table={table} empty={empty} cardSort={false} />
}

const rateColumns: ColumnDef<TableSetup, AcquirerFeeRate>[] = [
  {
    accessorKey: "bank_code",
    header: "Bank",
    size: 110,
    meta: { card: "title" },
    cell: ({ row }) => row.original.bank_code,
  },
  {
    accessorKey: "fee_kind",
    header: "Kind",
    size: 150,
    meta: { card: "meta" },
    cell: ({ row }) => row.original.fee_kind,
  },
  {
    accessorKey: "rate_percent",
    header: "Rate %",
    size: 100,
    meta: { align: "right", card: "metric" },
    cell: ({ row }) => row.original.rate_percent,
  },
  {
    accessorKey: "effective_from",
    header: "From",
    size: 130,
    meta: { card: "metric" },
    cell: ({ row }) => row.original.effective_from,
  },
]

const rateId = (row: AcquirerFeeRate) =>
  `${row.bank_code}/${row.fee_kind}/${row.effective_from}`
const settingId = (row: FinanceSetting) => row.setting_key

type SetupTab = "rates" | "settings"
const TABS: { value: SetupTab; label: string }[] = [
  { value: "rates", label: "MDR rates" },
  { value: "settings", label: "Settings" },
]

export function SalesSetup() {
  const phone = useLayout() === "phone"
  const [tab, setTab] = useState<SetupTab>("rates")
  const [search, setSearch] = useState("")
  const bankSheet = useOpener()
  const rateSheet = useOpener()

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

  const needle = search.trim().toLowerCase()
  const shownRates = useMemo(
    () =>
      (rates.data ?? []).filter(
        (row) =>
          needle === "" ||
          `${row.bank_code} ${row.fee_kind}`.toLowerCase().includes(needle)
      ),
    [rates.data, needle]
  )

  const changeTab = (next: SetupTab) => {
    setTab(next)
    setSearch("")
  }
  const addLabel = "Add rate"
  const addHere = () => rateSheet.show()
  const searchLabel = "Search rates"

  return (
    <PageContent>
      <PageHeader
        crumb="Finance · Setup"
        title="Sales & Banks"
        actions={
          <>
            <Button variant="ghost" onClick={() => bankSheet.show()}>
              Add bank
            </Button>
            {!phone && tab !== "settings" && (
              <Button variant="primary" onClick={addHere}>
                <Plus />
                {addLabel}
              </Button>
            )}
          </>
        }
      />

      <SubTabs
        tabs={TABS}
        value={tab}
        onChange={(next) => changeTab(next as SetupTab)}
      />

      {tab !== "settings" && !phone && (
        <div className="mb-3 flex min-h-[2.25rem] flex-wrap items-center gap-2">
          <SearchSuggest
            value={search}
            onChange={setSearch}
            label={searchLabel}
            suggestions={[]}
            picked={null}
            onPick={() => undefined}
            onClear={() => undefined}
          />
        </div>
      )}

      {tab === "rates" && (
        <>
          <ListTable
            rows={shownRates}
            columns={rateColumns}
            getRowId={rateId}
            empty="No MDR rate yet."
          />
        </>
      )}
      {tab === "settings" && (
        <Card className="overflow-hidden px-4 py-2">
          {(settings.data ?? []).length === 0 ? (
            <p className="py-3 text-[0.9375rem] text-mute">
              No setting is kept on this node.
            </p>
          ) : (
            (settings.data ?? []).map((one) => (
              <div
                key={settingId(one)}
                className="border-b border-hairline py-2.5 last:border-b-0"
              >
                <KeyValue term={one.setting_key}>
                  {one.value} {one.unit}
                </KeyValue>
                {one.note && (
                  <p className="text-[0.9375rem] text-mute">{one.note}</p>
                )}
              </div>
            ))
          )}
        </Card>
      )}

      {tab !== "settings" && (
        <DockTools
          search={{ value: search, onChange: setSearch, label: searchLabel }}
        />
      )}
      {tab !== "settings" && <Fab label={addLabel} onClick={addHere} />}

      <BankSheet
        key={`bank${bankSheet.n}`}
        open={bankSheet.isOpen}
        onClose={bankSheet.hide}
      />
      <RateSheet
        key={`rate${rateSheet.n}`}
        open={rateSheet.isOpen}
        onClose={rateSheet.hide}
      />
    </PageContent>
  )
}

// ── Add bank ──────────────────────────────────────────────────────────────
function BankSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const client = useQueryClient()
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
      onClose()
    },
  })
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title="Add bank"
      footer={
        <SheetFooter
          onCancel={onClose}
          saveLabel="Add bank"
          pending={addBank.isPending}
          disabled={!bank.bank_code || !bank.bank_name}
          onSave={() =>
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
        />
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-[0.9375rem] text-body">
          Creates the bank&apos;s leaves in the right groups (Cash In Bank Giro
          / Tabungan, Outstanding Giro, Penjualan Debit Card), maps them by the
          bank&apos;s code, registers the account and — QRIS on this bank&apos;s
          EDC posts to its debit-card pair.
        </p>
        <div className="grid grid-cols-2 gap-3 max-md:grid-cols-1">
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
              onChange={(e) => setBank({ ...bank, bank_name: e.target.value })}
            />
          </Field>
          <Field label="Account number">
            <Input
              value={bank.account_no}
              onChange={(e) => setBank({ ...bank, account_no: e.target.value })}
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
        <div className="flex flex-wrap gap-4 text-[0.9375rem] text-text">
          {(["giro", "savings", "debit_card"] as const).map((flag) => (
            <label key={flag} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={bank[flag]}
                onChange={(e) => setBank({ ...bank, [flag]: e.target.checked })}
              />
              {flag === "giro"
                ? "Giro"
                : flag === "savings"
                  ? "Savings"
                  : "Debit card / QRIS"}
            </label>
          ))}
        </div>
        {addBank.isError && (
          <Banner tone="bad">{problemText(addBank.error)}</Banner>
        )}
      </div>
    </Sheet>
  )
}

// ── Add rate ──────────────────────────────────────────────────────────────
function RateSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const client = useQueryClient()
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
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.rates })
      onClose()
    },
  })
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title="Add MDR rate"
      footer={
        <SheetFooter
          onCancel={onClose}
          saveLabel="Save rate"
          pending={saveRate.isPending}
          onSave={() => saveRate.mutate()}
        />
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-[0.9375rem] text-body">
          Final rates: the bank&apos;s MDR already includes VAT.
        </p>
        <Field label="Bank">
          <Input
            value={rate.bank_code}
            onChange={(e) =>
              setRate({ ...rate, bank_code: e.target.value.toUpperCase() })
            }
          />
        </Field>
        <Field label="Fee kind">
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
        </Field>
        <Field label="Rate %">
          <Input
            value={rate.rate_percent}
            onChange={(e) => setRate({ ...rate, rate_percent: e.target.value })}
          />
        </Field>
        <Field label="From">
          <Input
            type="date"
            value={rate.effective_from}
            onChange={(e) =>
              setRate({ ...rate, effective_from: e.target.value })
            }
          />
        </Field>
        {saveRate.isError && (
          <Banner tone="bad">{problemText(saveRate.error)}</Banner>
        )}
      </div>
    </Sheet>
  )
}
