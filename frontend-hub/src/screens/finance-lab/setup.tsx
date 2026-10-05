import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { PrintSheet, ReportPrint } from "@/screens/finance-lab/print"
import { Input, Select } from "@/components/ui/field"
import { Button } from "@/components/ui/button"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { EmptyState } from "@/components/ui/states"
import { Printer, Search } from "lucide-react"

import { BANK_ACCOUNTS, BINDINGS } from "@/screens/finance-lab/engine/bindings"
import { CHART, account } from "@/screens/finance-lab/engine/chart"
import {
  Cell,
  Row,
  Section,
  Table,
  count,
  FILTER_W,
  Filters,
  Kpis,
} from "@/screens/finance-lab/parts"

/// Chart of accounts — the client's own, searchable.
///
/// The list is the whole screen. A chart is looked at to find one account, so
/// the search box is the primary control and everything else is a narrowing.
export function ChartOfAccounts() {
  const [printing, setPrinting] = useState(false)
  const [q, setQ] = useState("")
  const [unit, setUnit] = useState("")
  const [cls, setCls] = useState("")
  const [rung, setRung] = useState("12")

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return CHART.filter((a) => {
      if (needle && !`${a.code} ${a.name}`.toLowerCase().includes(needle))
        return false
      if (unit && a.unit_id !== unit) return false
      if (cls && a.root_class !== cls) return false
      if (rung === "12" && a.code.length !== 12) return false
      if (rung === "10" && a.code.length > 10) return false
      return true
    }).slice(0, 300)
  }, [q, unit, cls, rung])

  const mapped = useMemo(() => new Set(BINDINGS.map((b) => b.account_code)), [])
  const units = useMemo(
    () => new Set(CHART.map((a) => a.unit_id).filter(Boolean)),
    []
  )
  const leaves = useMemo(
    () => CHART.filter((a) => a.code.length === 12).length,
    []
  )

  return (
    <PageContent>
      <PageHeader
        crumb="Accounting & close"
        title="Chart of Accounts"
        sub="The client's own chart, as exported. Nothing here is ours to rename."
      />

      <Filters
        right={`${CHART.length.toLocaleString("id-ID")} rows in the chart`}
      >
        <Button onClick={() => setPrinting(true)}>
          <Printer className="size-3.5" />
          Print
        </Button>
        <div className={`relative ${FILTER_W}`}>
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-faint" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="pl-8"
          />
        </div>
        <Select value={unit} onChange={setUnit} className={FILTER_W}>
          <option value="">All units</option>
          <option value="HO">HO</option>
          <option value="C004">C004</option>
          <option value="C006">C006</option>
        </Select>
        <Select value={rung} onChange={setRung} className={FILTER_W}>
          <option value="12">Postable leaves</option>
          <option value="10">Down to the account rung</option>
          <option value="">The whole ladder</option>
        </Select>
        <Select value={cls} onChange={setCls} className={FILTER_W}>
          <option value="">All classes</option>
          <option value="1">1 Assets</option>
          <option value="2">2 Liabilities</option>
          <option value="3">3 Equity</option>
          <option value="4">4 Revenue</option>
          <option value="5">5 Cost of sales</option>
          <option value="6">6 Operating expenses</option>
          <option value="7">7 Other operating expenses</option>
          <option value="8">8 Non-operating</option>
        </Select>
      </Filters>

      <Kpis
        items={[
          {
            label: "Postable leaves",
            value: leaves.toLocaleString("id-ID"),
            sub: `of ${CHART.length.toLocaleString("id-ID")} rows, across ${units.size} units`,
          },
          {
            label: "Bound to a posting role",
            value: String(mapped.size),
            sub: "a rule can reach these by name",
          },
          {
            label: "Reachable only by code",
            value: (leaves - mapped.size).toLocaleString("id-ID"),
            sub: "no role points at them yet",
          },
          {
            label: "Bank accounts",
            value: String(BANK_ACCOUNTS.length),
            sub: "cash, giro, savings, deposit",
          },
        ]}
      />

      <Section
        title={`${rows.length}${rows.length === 300 ? "+" : ""} of ${(rung === "12" ? leaves : CHART.length).toLocaleString("id-ID")} accounts`}
      >
        {rows.length === 0 ? (
          <EmptyState>No account matches.</EmptyState>
        ) : (
          <Table head={["Code", "Name", "Class", "Unit", "Mapped"]}>
            {rows.map((a) => (
              <Row key={a.code}>
                <Cell mono>{a.code}</Cell>
                <Cell>
                  <span
                    style={{
                      paddingLeft: rung
                        ? 0
                        : `${[1, 3, 5, 7, 10, 12].indexOf(a.code.length) * 0.75}rem`,
                    }}
                  >
                    {a.name}
                  </span>
                </Cell>
                <Cell>{a.root_class}</Cell>
                <Cell>{a.unit_id ?? "—"}</Cell>
                <Cell>
                  {mapped.has(a.code) ? (
                    <Pill tone="ok">yes</Pill>
                  ) : (
                    <span className="text-faint">—</span>
                  )}
                </Cell>
              </Row>
            ))}
          </Table>
        )}
      </Section>

      <PrintSheet
        open={printing}
        onOpenChange={setPrinting}
        title="Bagan Perkiraan"
      >
        <ReportPrint
          title="Bagan Perkiraan"
          period={"Per 2026-08-01"}
          scope={`${unit || "Seluruh unit"} · ${rung === "12" ? "hanya yang bisa diposting" : "seluruh tangga"}`}
          columns={[
            { label: "Kode", cell: (a) => a.code },
            { label: "Nama", cell: (a) => a.name },
            { label: "Kelas", cell: (a) => a.root_class },
            { label: "Unit", cell: (a) => a.unit_id ?? "—" },
            {
              label: "Terpetakan",
              cell: (a) => (mapped.has(a.code) ? "ya" : "—"),
            },
          ]}
          rows={rows}
        />
      </PrintSheet>
    </PageContent>
  )
}

/// Account map — which client account carries which meaning, here, now.
export function AccountMap() {
  const [role, setRole] = useState("")
  const roles = useMemo(
    () => [...new Set(BINDINGS.map((b) => b.role))].sort(),
    []
  )
  const rows = BINDINGS.filter((b) => !role || b.role === role)

  return (
    <PageContent>
      <PageHeader crumb="Finance" title="Account Map" />
      <Section
        title={`${rows.length} pemetaan`}
        right={
          <Select value={role} onChange={setRole} className={FILTER_W}>
            <option value="">All roles</option>
            {roles.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </Select>
        }
      >
        <Table
          head={[
            "Role",
            "Narrowed by",
            "Account",
            "Name",
            "Valid from",
            ">Version",
          ]}
        >
          {rows.map((b) => (
            <Row key={b.binding_id}>
              <Cell mono>{b.role}</Cell>
              <Cell className="text-body">
                {Object.entries(b.narrows)
                  .filter(([k]) => k !== "unit_id")
                  .map(([k, v]) => `${k}=${String(v)}`)
                  .join(", ") || b.narrows.unit_id}
              </Cell>
              <Cell mono>{b.account_code}</Cell>
              <Cell>
                {account(b.account_code)?.name ?? (
                  <span className="text-bad-fg">none</span>
                )}
              </Cell>
              <Cell className="whitespace-nowrap">{b.valid_from}</Cell>
              <Cell right>{b.version}</Cell>
            </Row>
          ))}
        </Table>
      </Section>
    </PageContent>
  )
}

/// Bank accounts — the registered identities the account map narrows by.
export function BankAccounts() {
  return (
    <PageContent>
      <PageHeader crumb="Finance" title="Bank Accounts" />
      <Section title={`${count(BANK_ACCOUNTS.length, "account")}`}>
        <Table
          head={[
            "Identitas",
            "Bank",
            "Product",
            "Number",
            "Unit",
            "Ledger Account",
          ]}
        >
          {BANK_ACCOUNTS.map((a) => {
            const binding = BINDINGS.find(
              (b) =>
                b.role === "BANK" &&
                b.narrows.bank_account_id === a.bank_account_id
            )
            return (
              <Row key={a.bank_account_id}>
                <Cell mono>{a.bank_account_id}</Cell>
                <Cell>{a.bank}</Cell>
                <Cell>
                  <Pill tone={a.product === "GIRO" ? "info" : "neutral"}>
                    {a.product.toLowerCase()}
                  </Pill>
                </Cell>
                <Cell className="text-mute">{a.number_masked}</Cell>
                <Cell>{a.unit_id}</Cell>
                <Cell mono>
                  {binding?.account_code ?? (
                    <span className="text-bad-fg">unmapped</span>
                  )}
                </Cell>
              </Row>
            )
          })}
        </Table>
      </Section>
    </PageContent>
  )
}
