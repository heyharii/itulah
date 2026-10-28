import { useQuery } from "@tanstack/react-query"
import { ChevronRight, Ruler, Shirt, Store, Truck, Users } from "lucide-react"
import { Suspense, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { AppLink } from "@/components/ui/app-link"
import { ExpandingSearch } from "@/components/ui/list-chrome"
import { PageHeader } from "@/components/ui/page-header"
import { Card } from "@/components/ui/card"
import { Toolbar } from "@/components/ui/segmented"
import { Fact, Facts } from "@/components/ui/sheet"
import { NoMatch } from "@/components/ui/states"
import { SubTabs } from "@/components/ui/sub-tabs"
import { allNavItems } from "@/lib/navigation"
import { setupStatusOptions } from "@/lib/queries/setup"
import { financeSetupGroups } from "@/screens/finance/nav"
import { SettingRows } from "@/screens/finance/finance-settings"
import { NumberSeriesSection } from "@/screens/finance/number-series"

/// Masters 7Soft keeps under one menu, and the hub keeps where they are made.
///
/// 7Soft's Master menu holds items, suppliers, customers, units and warehouses beside
/// its accounting masters. Here they belong to the modules that mint them —
/// Articles in Master, suppliers in Master, customers in Sales — and Finance
/// reads them. A second copy in Finance is the one thing we ruled out on
/// 27 Oct 2026: two item masters drift, and the stock stops matching the
/// ledger.
const ELSEWHERE = [
  {
    label: "Item",
    note: "Articles · colourways · SKUs",
    to: "/master",
    icon: Shirt,
  },
  {
    label: "Units",
    note: "Units & conversions",
    to: "/master/units",
    icon: Ruler,
  },
  {
    label: "Warehouses",
    note: "Units · stores",
    to: "/master/organisation",
    icon: Store,
  },
  {
    label: "Suppliers",
    note: "Supplier master",
    to: "/master/suppliers",
    icon: Truck,
  },
  {
    label: "Customers",
    note: "Customer master",
    to: "/sales/customer",
    icon: Users,
  },
]

/// Finance › Setup: every master on one page, in groups (owner, 2026-10-16,
/// `finance-final-prototype.html`). Done once and then not thought about, so
/// none of it is a row of its own; each opens the screen it always was.
function AllSetup() {
  const [search, setSearch] = useState("")
  const needle = search.trim().toLowerCase()
  const groups = financeSetupGroups
    .map((group) => ({
      label: group.label,
      items: group.paths.flatMap((path) => {
        const item = allNavItems.find((one) => one.path === path)
        return item &&
          `${group.label} ${item.label}`.toLowerCase().includes(needle)
          ? [item]
          : []
      }),
    }))
    .filter((group) => group.items.length > 0)
  const elsewhere = ELSEWHERE.filter((one) =>
    `${one.label} ${one.note}`.toLowerCase().includes(needle)
  )

  return (
    <>
      <Toolbar className="group/bar">
        <ExpandingSearch
          value={search}
          onChange={setSearch}
          label="Search setup"
        />
      </Toolbar>
      {groups.length === 0 && elsewhere.length === 0 && (
        <NoMatch what="setting" onClear={() => setSearch("")} />
      )}
      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
        {groups.map((group) => (
          <section
            key={group.label}
            aria-label={group.label}
            className="self-start overflow-hidden rounded-card border border-hairline"
          >
            <h2 className="border-b border-hairline px-4 py-3 text-[0.9375rem] font-semibold text-ink">
              {group.label}
            </h2>
            {group.items.map((item) => {
              const Icon = item.icon
              return (
                <AppLink
                  key={item.path}
                  to={item.path}
                  className="flex min-h-12 items-center gap-3 border-b border-hairline px-4 py-3 text-[0.9375rem] text-ink transition-colors duration-(--t-hover) last:border-b-0 hover:bg-soft"
                >
                  <Icon className="size-4 shrink-0 text-line-ico" />
                  <span className="min-w-0 flex-1">{item.label}</span>
                  <ChevronRight className="size-4 shrink-0 text-line-ico" />
                </AppLink>
              )
            })}
          </section>
        ))}
      </div>
      {elsewhere.length > 0 && (
        <section className="mt-8" aria-labelledby="elsewhere-heading">
          <h2
            id="elsewhere-heading"
            className="text-[0.9375rem] font-semibold text-ink"
          >
            Master kept outside Finance
          </h2>
          <p className="text-muted mt-1 max-w-[64ch] text-[0.875rem]">
            7Soft's Master menu holds items, suppliers, customers, units and
            warehouses beside its accounting masters. They are minted in the
            module that owns them and Finance reads them, so there is one item
            master and the stock keeps matching the ledger.
          </p>
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {elsewhere.map((one) => {
              const Icon = one.icon
              return (
                <AppLink
                  key={one.to}
                  to={one.to}
                  className="flex min-h-12 items-center gap-3 rounded-card border border-hairline px-4 py-3 text-[0.9375rem] text-ink transition-colors duration-(--t-hover) hover:bg-soft"
                >
                  <Icon className="size-4 shrink-0 text-line-ico" />
                  <span className="min-w-0 flex-1">
                    {one.label}
                    <span className="text-muted block text-[0.875rem]">
                      {one.note}
                    </span>
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-line-ico" />
                </AppLink>
              )
            })}
          </div>
        </section>
      )}
    </>
  )
}

/// 7Soft's Persiapan Singkat walks fifteen steps and keeps the answers in the
/// tabs below: the company, the switches, the accounts, the warehouse and item
/// masters, the people, and the menu. Each tab here opens what the hub keeps
/// under that heading; a 7Soft switch the hub has no setting for reads "—".
const GENERAL = [
  "Tanggal Mulai Program",
  "Folder Gambar",
  "Folder Template",
  "Hapus History Report",
  "Saldo Awal COA Mulai dari Awal",
  "Form Penjualan Cash Tampil di Menu",
  "Form Penjualan Barcode Tampil di Menu",
  "Tampilkan Note for Today",
  "Tampilkan Menu Gambar",
  "Jenis Form",
  "Jumlah Decimal Point",
  "Maksimum Cetak Nota",
  "Sistem Pembelian",
  "Sistem Penjualan",
]

const TRANSAKSI = [
  "Stok Boleh Minus",
  "Screening Stock per Tanggal Boleh Minus",
  "Nilai Order > Limit Hutang/Piutang",
  "Nilai Jual/Beli > Limit Hutang/Piutang",
  "Jumlah Item yang Dikirim > PO",
  "Jumlah Item yang Dikirim > SO",
  "Barang Datang Boleh Tambah Baris",
  "Surat Jalan Boleh Tambah Baris",
  "Invoice Jual/Beli Matching Boleh Tambah Baris",
  "Harga Jual di SO Beda dengan Price List",
  "Harga Jual di Faktur Beda dengan SO/ Price List",
  "Diskon Penjualan Beda dengan SO",
  "HPP Ditampilkan di Penjualan dan Item",
  "Default Total Discount Penjualan Cash & Barcode",
  "Pembulatan PPN",
  "Default Tanggal BKK/BKM",
  "Print Nota Penjualan Cash/ Barcode",
  "Jumlah Baris dalam Nota",
]

const dash = <span className="text-faint">—</span>

function CompanyInfo() {
  const status = useQuery(setupStatusOptions())
  const company = status.data?.company ?? null
  return (
    <Facts>
      <Fact term="Nama Perusahaan">{company?.name ?? dash}</Fact>
      <Fact term="Logo Filename">{dash}</Fact>
      <Fact term="Alamat" wide>
        {company?.address ? company.address : dash}
      </Fact>
      <Fact term="NPWP">{company?.tax_id ?? dash}</Fact>
      <Fact term="No Seri Faktur Pajak">{dash}</Fact>
      <Fact term="No Pengukuhan PKP">{dash}</Fact>
      <Fact term="Tanggal Pengukuhan PKP">{dash}</Fact>
    </Facts>
  )
}

const H2 = ({ children }: { children: React.ReactNode }) => (
  <h2 className="mt-8 mb-3 text-[0.9375rem] font-semibold text-ink">
    {children}
  </h2>
)

function SetupSwitches() {
  return (
    <>
      <H2>General</H2>
      <Facts>
        {GENERAL.map((term) => (
          <Fact key={term} term={term}>
            {dash}
          </Fact>
        ))}
      </Facts>
      <NumberSeriesSection />
      <H2>Transaksi</H2>
      <Facts>
        {TRANSAKSI.map((term) => (
          <Fact key={term} term={term}>
            {dash}
          </Fact>
        ))}
      </Facts>
      <H2>Accounts Settings</H2>
      <Suspense fallback={null}>
        <SettingRows />
      </Suspense>
    </>
  )
}

/// A row of 7Soft's Tambah/ Edit buttons: the name of the master and where the
/// hub keeps it.
function Doors({ rows }: { rows: readonly { label: string; to: string }[] }) {
  return (
    <Card className="overflow-clip">
      {rows.map((row) => (
        <AppLink
          key={row.label}
          to={row.to}
          className="flex min-h-12 items-center gap-3 border-b border-hairline px-4 py-3 text-[0.9375rem] text-ink transition-colors duration-(--t-hover) last:border-b-0 hover:bg-soft"
        >
          <span className="min-w-0 flex-1">{row.label}</span>
          <ChevronRight className="size-4 shrink-0 text-line-ico" />
        </AppLink>
      ))}
    </Card>
  )
}

const TABS = [
  { value: "info", label: "Info Perusahaan" },
  { value: "setup", label: "Setup" },
  { value: "akun", label: "Setting Akun" },
  { value: "gudang", label: "Gudang & Barang" },
  { value: "person", label: "Person" },
  { value: "menu", label: "Setting Menu" },
  { value: "all", label: "Semua" },
]

export function FinanceSetup() {
  const [tab, setTab] = useState("info")
  return (
    <PageContent>
      <PageHeader title="Persiapan Singkat dan Set Up" />
      <SubTabs tabs={TABS} value={tab} onChange={setTab} />
      {tab === "info" && <CompanyInfo />}
      {tab === "setup" && <SetupSwitches />}
      {tab === "akun" && (
        <Doors
          rows={[
            {
              label: "Daftar Akun",
              to: "/finance/accounting/chart-of-accounts",
            },
            { label: "Setting Akun", to: "/finance/setup/account-links" },
            { label: "Jangka Waktu Kredit", to: "/master/payment-templates" },
            { label: "Daftar Pajak", to: "/finance/tax-setup/types" },
          ]}
        />
      )}
      {tab === "gudang" && (
        <Doors
          rows={[
            { label: "Gudang", to: "/master/organisation" },
            { label: "Satuan", to: "/master/units" },
            { label: "Konversi", to: "/master/units" },
            { label: "Barang", to: "/master" },
          ]}
        />
      )}
      {tab === "person" && (
        <Doors
          rows={[
            { label: "Daftar Supplier", to: "/master/suppliers" },
            { label: "Daftar Karyawan", to: "/people" },
            { label: "Daftar Customer", to: "/sales/customer" },
          ]}
        />
      )}
      {tab === "menu" && (
        <Doors
          rows={[{ label: "Setting Menu", to: "/finance/setup/setting-menu" }]}
        />
      )}
      {tab === "all" && <AllSetup />}
    </PageContent>
  )
}
