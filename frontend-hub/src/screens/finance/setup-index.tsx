import { useQuery } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"

import { PageContent } from "@/components/shell/app-shell"
import { PageHeader } from "@/components/ui/page-header"
import { count, day } from "@/lib/format"
import { auditPage } from "@/lib/queries/audit"
import {
  accountLinksQuery,
  edcMachinesQuery,
  giroPrintTemplatesQuery,
  paymentMethodsQuery,
  taxTemplatesQuery,
} from "@/lib/queries/finance"
import { numberSeriesQuery } from "@/lib/queries/finance-number-series"
import { paymentTermsQuery } from "@/lib/queries/payment-terms"
import { supplierPage } from "@/lib/queries/procurement"
import { storesListQuery } from "@/lib/queries/stores"
import { ModelTable, type ModelRow } from "@/screens/finance/report"

/// Finance › Setup (7Soft's master menus, owner 28 Oct 2026).
///
/// One page of every master Finance keeps, in the groups `scr-rep.js` draws:
/// Accounts, Tax, Payments, Numbering, Shops, Access and History. Each row
/// opens the real table — the chart, the links, the tax codes, the terms, the
/// EDC list, the giro leaves, the suppliers, the numbering, the stores, the
/// permissions and the audit log — rather than a second copy of it here.
///
/// **What it holds** is counted from the same reads those screens use, so the
/// sentence beside a master cannot drift from it. A count the API does not
/// answer whole (the chart's accounts and groups) reads "—" rather than an
/// invented figure; `Last changed` and `By` come from the audit log for the
/// masters that write through `/finance/`, and read "—" for the ones that
/// write in another module.

/// The newest Finance write, as the audit log keeps it.
function useLastChanges() {
  return useQuery({
    queryKey: ["audit", "setup", "last-changed"],
    queryFn: ({ signal }) =>
      auditPage({ q: "/api/v1/finance/", outcome: "OK" }, signal),
    staleTime: 60_000,
  })
}

/// A count and its noun, or "—" while the read is in (and if it fails).
function tally(
  value: number | undefined,
  one: string,
  many = `${one}s`
): string {
  return value === undefined
    ? "—"
    : `${count(value)} ${value === 1 ? one : many}`
}

const dash = <span className="text-faint">—</span>

interface Master {
  readonly label: string
  readonly holds: React.ReactNode
  readonly to: string
  /// The audit paths a write to this master lands on. Absent: the master is
  /// written outside Finance, and the log this page reads does not hold it.
  readonly writes?: readonly string[]
}

interface Table {
  readonly title: string
  readonly rows: readonly Master[]
}

export function FinanceSetup() {
  const navigate = useNavigate()
  const links = useQuery(accountLinksQuery())
  const taxes = useQuery(taxTemplatesQuery())
  const terms = useQuery(paymentTermsQuery())
  const methods = useQuery(paymentMethodsQuery())
  const edc = useQuery(edcMachinesQuery())
  const giro = useQuery(giroPrintTemplatesQuery())
  const suppliers = useQuery({
    queryKey: ["setup", "supplier-count"],
    queryFn: ({ signal }) => supplierPage({ limit: 1 }, signal),
    staleTime: 5 * 60_000,
  })
  const series = useQuery(numberSeriesQuery())
  const stores = useQuery({ ...storesListQuery(), refetchInterval: false })
  const audit = useLastChanges()

  const latest = (writes: readonly string[] | undefined) => {
    if (writes === undefined) return undefined
    const row = audit.data?.rows.find((entry) =>
      writes.some((prefix) => entry.path.includes(prefix))
    )
    return row === undefined
      ? undefined
      : { at: row.at, by: row.display_name || row.username }
  }

  const linksGaps = links.data?.gaps ?? 0
  const changes = audit.data?.total ?? undefined

  const tables: readonly Table[] = [
    {
      title: "Accounts",
      rows: [
        {
          label: "Account",
          holds: dash,
          to: "/finance/accounting/chart-of-accounts",
          writes: ["/finance/accounts", "/finance/chart-changes"],
        },
        {
          label: "Saldo Awal COA",
          holds: dash,
          to: "/finance/opening/balances",
          writes: ["/finance/opening"],
        },
        {
          label: "Setting COA",
          holds:
            links.data === undefined ? (
              dash
            ) : (
              <>
                {tally(links.data.total, "link")}
                {linksGaps > 0 && (
                  <>
                    {", "}
                    <span className="text-bad-fg">
                      {count(linksGaps)} not linked
                    </span>
                  </>
                )}
              </>
            ),
          to: "/finance/setup/account-links",
          writes: ["/finance/account-links"],
        },
      ],
    },
    {
      title: "Tax",
      rows: [
        {
          label: "Pajak",
          holds: tally(taxes.data?.length, "rate"),
          to: "/finance/tax-setup/types",
          writes: ["/finance/tax"],
        },
      ],
    },
    {
      title: "Payments",
      rows: [
        {
          label: "Jangka waktu kredit",
          holds: tally(terms.data?.terms.length, "term"),
          to: "/master/payment-templates",
        },
        {
          label: "Payment methods & EDC per shop",
          holds:
            methods.data === undefined && edc.data === undefined ? (
              dash
            ) : (
              <>
                {tally(methods.data?.length, "method")}
                {" · "}
                {tally(edc.data?.machines.length, "machine")}
              </>
            ),
          to: "/finance/setup/shop-payment-methods",
          writes: [
            "/finance/edc-machines",
            "/finance/payment-methods",
            "/finance/sites",
          ],
        },
        {
          label: "Giro templates",
          holds:
            giro.data === undefined
              ? dash
              : tally(giro.data.filter((one) => !one.retired).length, "bank"),
          to: "/finance/setup/giro-templates",
          writes: ["/finance/giro-print-templates"],
        },
        {
          label: "Suppliers",
          holds: tally(suppliers.data?.total, "supplier"),
          to: "/master/suppliers",
        },
      ],
    },
    {
      title: "Numbering",
      rows: [
        {
          label: "Setting Menu",
          holds:
            series.data === undefined
              ? dash
              : tally(series.data.items.length, "series"),
          to: "/finance/setup/setting-menu",
          writes: ["/finance/number-series"],
        },
      ],
    },
    {
      title: "Shops",
      rows: [
        {
          label: "Shops",
          holds:
            stores.data === undefined
              ? dash
              : `${tally(stores.data.items.length, "shop")} + HO`,
          to: "/master/stores",
        },
      ],
    },
    {
      title: "Access",
      rows: [
        {
          label: "User & Group",
          holds: "Who may view, add, edit, delete",
          to: "/finance/settings/permissions",
          writes: ["/finance/permissions"],
        },
      ],
    },
    {
      title: "History",
      rows: [
        {
          label: "History",
          holds:
            changes === undefined
              ? dash
              : `${count(changes)} ${changes === 1 ? "change" : "changes"}`,
          // The history is its own newest row; not a master that is written.
          to: "/finance/history",
          writes: [],
        },
      ],
    },
  ]

  const rowsOf = (rows: readonly Master[]): ModelRow[] =>
    rows.map((master) => {
      const last =
        master.writes !== undefined && master.writes.length === 0
          ? audit.data?.rows[0] === undefined
            ? undefined
            : {
                at: audit.data.rows[0].at,
                by:
                  audit.data.rows[0].display_name ||
                  audit.data.rows[0].username,
              }
          : latest(master.writes)
      return {
        on: () => void navigate({ to: master.to } as never),
        cells: [
          <span key="m" className="font-medium text-ink">
            {master.label}
          </span>,
          master.holds,
          last === undefined ? dash : day(last.at),
          last === undefined ? (
            dash
          ) : (
            <span key="b" className="text-mute">
              {last.by}
            </span>
          ),
        ],
      }
    })

  return (
    <PageContent>
      <PageHeader title="Setup" />
      {tables.map((table) => (
        <section key={table.title} className="mb-7">
          <h2 className="mb-2.5 text-[1rem] leading-[1.375rem] font-semibold text-ink">
            {table.title}
          </h2>
          <ModelTable
            cols={[
              { l: "Master" },
              { l: "What it holds", w: "330px" },
              { l: "Last changed", w: "140px" },
              { l: "By", w: "210px" },
            ]}
            rows={rowsOf(table.rows)}
          />
        </section>
      ))}
    </PageContent>
  )
}
