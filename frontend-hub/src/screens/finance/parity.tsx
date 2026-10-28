import type { ColumnDef } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
  CircleCheck,
  CircleSlash,
  ExternalLink,
  LayoutGrid,
  TriangleAlert,
} from "lucide-react"
import { useCallback, useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { AppLink } from "@/components/ui/app-link"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { FilterChips } from "@/components/ui/filter-chips"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { PageHeader } from "@/components/ui/page-header"
import { Status } from "@/components/ui/pill"
import { count } from "@/lib/format"
import { tableSetup, type TableSetup } from "@/lib/table"
import { COVERAGE, MENUS, type Menu } from "@/screens/finance/parity-menus"

/// Finance › 7Soft parity: every menu of the accounting application the
/// business runs today, in 7Soft's own groups and order, each pointed at the
/// screen in this app that answers it.
///
/// Since 28 Oct 2026 the sidebar is 7Soft's menu tree, so this page no longer
/// translates one map into another: it says, menu by menu, how much of 7Soft's
/// screen the hub's screen holds — and where a row has no screen yet, it says
/// so rather than pretending.
///
/// Two questions are answered side by side, and they are not the same one.
///
/// **Is it in the hub?** Read off the hub on 28 Oct 2026, after every 7Soft
/// tab, column and report the existing API can feed was added
/// (`docs/research/2026-10-28-finance-hub-vs-7soft.md`):
///
/// - `In the hub` — the screen does the whole job.
/// - `Partly` — the screen exists and some of 7Soft's columns, tabs or
///   reports are missing.
/// - `Bridge` — the job lives in another module and Finance reads it; the
///   7Soft row is kept as the name people know.
/// - `No screen` — 7Soft has it and this app does not. Not a placeholder: a
///   row with no link, so the gap is visible instead of hidden.
///
/// **Is the screen the same as 7Soft's?** From the element-by-element audits:
///
/// - `Same as 7Soft` — every field, tab and button 7Soft has is there.
/// - `Differs` — something is missing; the note counts it and the list names
///   it.
/// - `Not built` — a finance menu with no hub screen.
/// - `Outside finance` — stock, purchasing orders, item masters, the
///   technical Fasilitas menus: not finance, so not this page's to answer.
type HubStatus = "in" | "partly" | "bridge" | "none"

type Fit = "same" | "differs" | "not-built" | "outside"

type Row = {
  readonly label: string
  /// The id of the 7Soft screen (`parity-menus.ts`) this row answers.
  readonly screen: string
  readonly path?: string
  readonly where: string
  readonly status: HubStatus
}

type Group = {
  readonly label: string
  readonly rows: readonly Row[]
}

/// 7Soft's order, not the hub's. Kas - Bank first because that is the first
/// thing an accountant opens in the morning; Master last because it is done
/// once.
const GROUPS: readonly Group[] = [
  {
    label: "Kas - Bank",
    rows: [
      {
        label: "Info Kas Bank",
        screen: "kas-info",
        path: "/finance/cash-bank/kas-bank",
        where: "Kas - Bank · Info Kas Bank (Kas/Bank · Kartu · BKM · BKK)",
        status: "partly",
      },
      {
        label: "BKM · BKK",
        screen: "bkm-bkk",
        path: "/finance/cash-bank/bkm",
        where: "Kas - Bank · BKM · BKK",
        status: "partly",
      },
      {
        label: "Pencairan BG",
        screen: "giro-board",
        path: "/finance/cash-bank/giro",
        where: "Kas - Bank · Pencairan BG",
        status: "partly",
      },
      {
        label: "Laporan Kas/Bank",
        screen: "kas-report",
        path: "/finance/reports/kas-bank",
        where: "Kas - Bank · Laporan Kas/Bank (20 reports)",
        status: "in",
      },
    ],
  },
  {
    label: "GL · Buku Besar",
    rows: [
      {
        label: "Info Accounting",
        screen: "gl-info",
        path: "/finance/accounting/info-accounting",
        where:
          "GL · Info Accounting (Account · Jurnal · All Jurnal · Buku Besar Pembantu · Neraca Saldo)",
        status: "in",
      },
      {
        label: "Transaksi Jurnal",
        screen: "gl-journal",
        path: "/finance/accounting/journal-entries",
        where: "GL · Transaksi Jurnal",
        status: "in",
      },
      {
        label: "Closing Periode Akuntansi",
        screen: "gl-closing",
        path: "/finance/period-close",
        where: "GL · Closing Periode Akuntansi",
        status: "partly",
      },
      {
        label: "Laporan Accounting · Keuangan · Manajerial",
        screen: "report-acc",
        path: "/finance/reports/laporan-accounting",
        where:
          "GL · Laporan Accounting; Analisa · Laporan Keuangan, Manajerial",
        status: "partly",
      },
    ],
  },
  {
    label: "Pembelian",
    rows: [
      {
        label: "Info Pembelian",
        screen: "buy-info",
        path: "/finance/payables/supplier-ledger",
        where: "Pembelian · Info Pembelian",
        status: "partly",
      },
      {
        label: "Faktur Pembelian",
        screen: "buy-invoice",
        path: "/finance/payables/purchase-invoice",
        where: "Pembelian · Faktur Pembelian",
        status: "partly",
      },
      {
        label: "Invoice Retur Beli",
        screen: "buy-return",
        path: "/finance/payables/credit-notes",
        where: "Pembelian · Invoice Retur Beli",
        status: "partly",
      },
      {
        label: "Laporan Pembelian",
        screen: "buy-reports",
        path: "/finance/reports/accounts-payable-summary",
        where: "Pembelian · Laporan Pembelian",
        status: "partly",
      },
    ],
  },
  {
    label: "Penjualan",
    rows: [
      {
        label: "Info Penjualan",
        screen: "sell-info",
        path: "/finance/sales/info",
        where: "Penjualan · Info Penjualan",
        status: "partly",
      },
      {
        label: "Penjualan Cash · POS",
        screen: "sell-cash",
        path: "/finance/stores/sales",
        where: "Penjualan · Penjualan Cash · POS",
        status: "partly",
      },
      {
        label: "Faktur Penjualan",
        screen: "sell-invoice",
        where:
          "No screen: credit sales only, and the chart has no customer receivable",
        status: "none",
      },
      {
        label: "Retur Penjualan",
        screen: "sell-return",
        path: "/finance/sales/returns",
        where: "Penjualan · Retur Penjualan",
        status: "partly",
      },
      {
        label: "Laporan Penjualan",
        screen: "sell-reports",
        path: "/finance/reports/penjualan",
        where: "Penjualan · Laporan Penjualan (cash and POS reports)",
        status: "partly",
      },
    ],
  },
  {
    label: "Master",
    rows: [
      {
        label: "Customer · Supplier · Pajak",
        screen: "parties",
        path: "/finance/tax-setup/types",
        where: "Master · Customer · Supplier · Pajak",
        status: "partly",
      },
      {
        label: "Asset",
        screen: "assets",
        path: "/finance/assets/capitalization",
        where: "Master · Asset",
        status: "in",
      },
      {
        label: "Account",
        screen: "coa-master",
        path: "/finance/accounting/chart-of-accounts",
        where: "Master · Account",
        status: "in",
      },
      {
        label: "Saldo Awal COA",
        screen: "coa-opening",
        path: "/finance/opening/balances",
        where: "Master · Saldo Awal COA",
        status: "partly",
      },
      {
        label: "Setting COA",
        screen: "coa-links",
        path: "/finance/setup/account-links",
        where: "Master · Setting COA",
        status: "partly",
      },
      {
        label: "User & Group",
        screen: "users",
        path: "/finance/settings/permissions",
        where: "Master · User & Group",
        status: "partly",
      },
      {
        label: "Setting Menu",
        screen: "setting-menu",
        path: "/finance/setup/setting-menu",
        where: "Master · Setting Menu",
        status: "partly",
      },
    ],
  },
  {
    label: "Fasilitas",
    rows: [
      {
        label: "Persiapan Singkat dan Set Up",
        screen: "setup-switches",
        path: "/finance/accounts-setup",
        where: "Fasilitas · Persiapan Singkat dan Set Up",
        status: "partly",
      },
      {
        label: "History",
        screen: "history",
        path: "/finance/history",
        where: "Fasilitas · History",
        status: "in",
      },
    ],
  },
]

const HUB_ROWS = GROUPS.flatMap((group) => group.rows)
const HUB_BY_SCREEN = new Map(HUB_ROWS.map((row) => [row.screen, row]))

const HUB_TONE: Record<HubStatus, "ok" | "warn" | "info" | "neutral"> = {
  in: "ok",
  partly: "warn",
  bridge: "info",
  none: "neutral",
}

const HUB_WORD: Record<HubStatus, string> = {
  in: "In the hub",
  partly: "Partly",
  bridge: "Bridge",
  none: "No screen",
}

const FIT_TONE: Record<Fit, "ok" | "warn" | "bad" | "neutral"> = {
  same: "ok",
  differs: "warn",
  "not-built": "bad",
  outside: "neutral",
}

const FIT_WORD: Record<Fit, string> = {
  same: "Same as 7Soft",
  differs: "Differs",
  "not-built": "Not built",
  outside: "Outside finance",
}

/// Menus the manual lists under a screen the hub does have, where the hub's
/// screen still does not do that menu's job. 9.3 Reproses Accounting is the
/// one: a confirm sheet inside Closing is not a reprocess.
const NOT_BUILT = new Set(["9.3"])

/// Is the screen that answers this 7Soft menu the same as 7Soft's?
function fitOf(screen: string | null, finance: boolean, number?: string): Fit {
  if (!finance) return "outside"
  const hub = screen === null ? undefined : HUB_BY_SCREEN.get(screen)
  if (
    screen === null ||
    hub === undefined ||
    hub.status === "none" ||
    (number !== undefined && NOT_BUILT.has(number))
  ) {
    return "not-built"
  }
  return COVERAGE[screen]?.same === "yes" ? "same" : "differs"
}

/// A menu of the manual, with everything the table draws about it.
type Line = {
  readonly number: string
  readonly name: string
  readonly page: number
  readonly group: string
  readonly fit: Fit
  /// The hub's answer to "is it there?", `null` outside finance.
  readonly hub: HubStatus | null
  readonly path?: string
  readonly where: string | null
  /// What the audit counted as missing: "Missing 4 · partly 9".
  readonly note: string | null
  readonly miss: readonly string[]
  readonly backend: string | null
  readonly menuNote: string | null
}

function lineOf(menu: Menu): Line {
  const finance = menu.scope === "fin"
  const fit = fitOf(menu.screen, finance, menu.number)
  const hubRow =
    menu.screen === null ? undefined : HUB_BY_SCREEN.get(menu.screen)
  const cover = menu.screen === null ? undefined : COVERAGE[menu.screen]
  const missing = fit === "not-built"
  return {
    number: menu.number,
    name: menu.name,
    page: menu.page,
    group: menu.group,
    fit,
    hub: !finance
      ? null
      : NOT_BUILT.has(menu.number)
        ? "none"
        : (hubRow?.status ?? "none"),
    path: missing ? undefined : hubRow?.path,
    where: !finance
      ? null
      : NOT_BUILT.has(menu.number)
        ? (menu.note ?? null)
        : (hubRow?.where ?? null),
    note: fit === "differs" ? (cover?.note ?? null) : null,
    miss: fit === "differs" ? (cover?.miss ?? []) : [],
    backend: missing ? (cover?.backend ?? null) : null,
    menuNote: !finance ? (menu.note ?? null) : null,
  }
}

const LINES: readonly Line[] = MENUS.map(lineOf)

const hasDetail = (line: Line) =>
  line.miss.length > 0 || line.backend !== null || line.menuNote !== null

export function FinanceSevenSoftParity() {
  const [fit, setFit] = useState<Fit | null>(null)
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set())

  const countOf = (one: Fit) => LINES.filter((line) => line.fit === one).length
  const finance = LINES.length - countOf("outside")

  const lines = useMemo(
    () => (fit === null ? LINES : LINES.filter((line) => line.fit === fit)),
    [fit]
  )
  const groups = useMemo(
    () =>
      GROUPS.map((group) => ({
        ...group,
        rows: group.rows.filter(
          (row) => fit === null || fitOf(row.screen, true) === fit
        ),
      })).filter((group) => group.rows.length > 0),
    [fit]
  )

  const toggle = useCallback(
    (number: string) =>
      setOpen((now) => {
        const next = new Set(now)
        if (next.has(number)) next.delete(number)
        else next.add(number)
        return next
      }),
    []
  )

  const columns = useMemo<ColumnDef<TableSetup, Line>[]>(
    () => [
      {
        id: "menu",
        accessorFn: (row) => row.name,
        header: "7Soft menu",
        size: 320,
        enableSorting: false,
        meta: { card: "title", grow: 260 },
        cell: ({ row }) => (
          <span className="flex min-w-0 flex-col">
            <span className="font-medium text-ink">{row.original.name}</span>
            <span className="text-mute">
              {row.original.number} · page {row.original.page}
            </span>
          </span>
        ),
      },
      {
        id: "group",
        accessorFn: (row) => row.group,
        header: "7Soft group",
        size: 150,
        enableSorting: false,
        meta: { card: "meta", priority: 3 },
        cell: ({ row }) => (
          <span className="text-body">{row.original.group}</span>
        ),
      },
      {
        id: "screen",
        accessorFn: (row) => row.where ?? "",
        header: "Screen in the hub",
        size: 320,
        enableSorting: false,
        meta: { card: "foot", priority: 2 },
        cell: ({ row }) => {
          const line = row.original
          if (line.where === null) return <span className="text-mute">—</span>
          return line.path !== undefined ? (
            <AppLink to={line.path} className="record-link">
              {line.where}
            </AppLink>
          ) : (
            <span className="text-mute">{line.where}</span>
          )
        },
      },
      {
        id: "hub",
        accessorFn: (row) => row.hub ?? "",
        header: "In the hub",
        size: 140,
        enableSorting: false,
        meta: { card: "meta", priority: 2 },
        cell: ({ row }) =>
          row.original.hub === null ? (
            <span className="text-mute">—</span>
          ) : (
            <Status tone={HUB_TONE[row.original.hub]}>
              {HUB_WORD[row.original.hub]}
            </Status>
          ),
      },
      {
        id: "fit",
        accessorFn: (row) => row.fit,
        header: "Against 7Soft",
        size: 230,
        enableSorting: false,
        meta: { card: "status" },
        cell: ({ row }) => (
          <span className="flex min-w-0 flex-col">
            <Status tone={FIT_TONE[row.original.fit]}>
              {FIT_WORD[row.original.fit]}
            </Status>
            {row.original.note !== null && (
              <span className="text-mute">{row.original.note}</span>
            )}
          </span>
        ),
      },
      {
        id: "detail",
        accessorFn: (row) => row.number,
        header: "",
        size: 120,
        enableSorting: false,
        enableHiding: false,
        meta: { align: "right", card: "hide" },
        cell: ({ row }) => {
          if (!hasDetail(row.original)) return null
          const shown = open.has(row.original.number)
          return (
            <Button
              variant="ghost"
              size="sm"
              aria-expanded={shown}
              onClick={() => toggle(row.original.number)}
            >
              Details
              {shown ? (
                <ChevronUp aria-hidden className="size-4" />
              ) : (
                <ChevronDown aria-hidden className="size-4" />
              )}
            </Button>
          )
        },
      },
    ],
    [open, toggle]
  )

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: lines,
        columns,
        getRowId: (row: Line) => row.number,
      }),
      [lines, columns]
    )
  )

  return (
    <PageContent>
      <PageHeader title="7Soft parity" />

      <KpiStrip className="grid-cols-2 md:grid-cols-3 xl:grid-cols-5">
        <Kpi label="Menus in the manual" value={count(LINES.length)} />
        <Kpi label="Finance menus" value={count(finance)} />
        <Kpi label="Same as 7Soft" value={count(countOf("same"))} />
        <Kpi label="Differs" value={count(countOf("differs"))} />
        <Kpi label="Not built" value={count(countOf("not-built"))} />
      </KpiStrip>

      <FilterChips
        className="mb-6"
        label="Against 7Soft"
        value={fit}
        onChange={(next) => setFit(next as Fit | null)}
        options={[
          { value: null, label: "All", icon: LayoutGrid, count: LINES.length },
          {
            value: "same",
            label: "Same",
            icon: CircleCheck,
            count: countOf("same"),
          },
          {
            value: "differs",
            label: "Differs",
            icon: TriangleAlert,
            count: countOf("differs"),
          },
          {
            value: "not-built",
            label: "Not built",
            icon: CircleSlash,
            count: countOf("not-built"),
          },
          {
            value: "outside",
            label: "Outside finance",
            icon: ExternalLink,
            count: countOf("outside"),
          },
        ]}
      />

      {groups.length > 0 && (
        <section
          aria-label="Screens in the hub"
          className="flex flex-col gap-4"
        >
          <h2 className="text-[1.0625rem] font-semibold text-ink">
            Screens in the hub
          </h2>
          <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
            {groups.map((group) => (
              <section
                key={group.label}
                aria-label={group.label}
                className="self-start overflow-hidden rounded-card border border-hairline"
              >
                <h3 className="border-b border-hairline px-4 py-3 text-[0.9375rem] font-semibold text-ink">
                  {group.label}
                </h3>
                {group.rows.map((row) => {
                  const rowFit = fitOf(row.screen, true)
                  const note =
                    rowFit === "differs"
                      ? COVERAGE[row.screen]?.note
                      : undefined
                  const body = (
                    <>
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium">{row.label}</span>
                        <span className="block text-mute">{row.where}</span>
                        <span className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-0.5">
                          <span className="inline-flex items-center gap-2">
                            <span className="text-mute">Hub</span>
                            <Status tone={HUB_TONE[row.status]}>
                              {HUB_WORD[row.status]}
                            </Status>
                          </span>
                          <span className="inline-flex items-center gap-2">
                            <span className="text-mute">7Soft</span>
                            <Status tone={FIT_TONE[rowFit]}>
                              {FIT_WORD[rowFit]}
                            </Status>
                          </span>
                        </span>
                        {note !== undefined && (
                          <span className="mt-0.5 block text-mute">{note}</span>
                        )}
                      </span>
                      {row.path && (
                        <ChevronRight className="size-4 shrink-0 text-line-ico" />
                      )}
                    </>
                  )
                  return row.path ? (
                    <AppLink
                      key={row.label}
                      to={row.path}
                      className="flex min-h-12 items-center gap-3 border-b border-hairline px-4 py-3 text-[0.9375rem] text-ink transition-colors duration-(--t-hover) last:border-b-0 hover:bg-soft"
                    >
                      {body}
                    </AppLink>
                  ) : (
                    <div
                      key={row.label}
                      className="flex min-h-12 items-center gap-3 border-b border-hairline px-4 py-3 text-[0.9375rem] text-ink last:border-b-0"
                    >
                      {body}
                    </div>
                  )
                })}
              </section>
            ))}
          </div>
        </section>
      )}

      <section
        aria-label="Menus of the 7Soft manual"
        className="mt-8 flex flex-col gap-4"
      >
        <h2 className="text-[1.0625rem] font-semibold text-ink">
          Menus of the 7Soft manual
        </h2>
        <Card className="overflow-clip max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
          <DataTable<Line>
            table={table}
            pageScroll
            cardSort={false}
            cardsApart
            cardLead
            isExpanded={(line) => open.has(line.number)}
            renderSub={(line) =>
              hasDetail(line) ? (
                <div className="flex flex-col gap-2 px-4 py-3 text-[0.9375rem]">
                  {line.menuNote !== null && (
                    <p className="text-body">{line.menuNote}</p>
                  )}
                  {line.backend !== null && (
                    <p className="text-body">Backend: {line.backend}</p>
                  )}
                  {line.miss.length > 0 && (
                    <ul className="list-disc pl-5 text-ink">
                      {line.miss.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : null
            }
            empty="No menu matches."
          />
        </Card>
      </section>
    </PageContent>
  )
}
