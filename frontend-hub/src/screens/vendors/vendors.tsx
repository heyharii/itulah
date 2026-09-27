import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Plus } from "lucide-react"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import {
  SupplierBankAccountsPanel,
  SupplierContactsPanel,
} from "@/components/suppliers/panels"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Field, Input, Select } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { Segmented, Toolbar } from "@/components/ui/segmented"
import { Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState } from "@/components/ui/states"
import { SubTabs } from "@/components/ui/sub-tabs"
import { count } from "@/lib/format"
import { queryState } from "@/lib/query-state"
import {
  createSupplier,
  procurementKeys,
  setSupplierStatus,
  supplierPage,
  updateSupplier,
  type SupplierCategory,
} from "@/lib/queries/procurement"
import { useSheet } from "@/lib/sheets"
import { cn } from "@/lib/utils"
import type { Supplier } from "@itulah/contract"

/// Vendors — everybody we owe who does not sell us clothes.
///
/// # Why this is a second menu over the same book
///
/// The client's chart drew the line, in three accounts:
///
///   2012001001  Hutang Suppliers Barang Dagangan
///   2012001003  Hutang Supplier Non Barang Dagang
///   2012301xxx  Hutang Affiliasi … (fourteen units)
///
/// and its accruals name the bills it expects every month — electricity,
/// water, telephone, shop rent, staff-house rent, BPJS. Two liability accounts
/// mean two ageing reports and two people doing two different jobs: merchandise
/// runs weekly against a purchase order and a goods receipt, and the question
/// is "did the delivery match"; PLN and the landlord run monthly against a
/// meter reading or a contract, and the question is "is this the usual amount".
///
/// One screen for both would carry a PO column empty for half its rows. So:
/// two menus. But ONE record — `supplier` with a `category`, because ageing,
/// payments, balances and bills are the same machinery either way, and a second
/// table would mean a second half of each that has to agree with the first. See
/// migration 0212.
///
/// # Why GA and not Finance
///
/// Because REGISTERING a vendor is General Affairs' work — signing up the
/// electricity account, negotiating the rent, appointing the cleaners — and
/// paying what they send is Finance's. The owner said so in five words when
/// this screen first appeared under Finance. What Finance needs from the same
/// record it reads where it works: on the bill, and in payables.
///
/// # The default account is the point of this screen
///
/// Fourteen PLN bills a month, each of which has to name the account it debits.
/// Typing it fourteen times is how the fourteenth gets it wrong. A vendor that
/// names its usual account fills that in for every bill it sends.
///
/// # Why the picker is a list and not the chart
///
/// These ten are the vendors' consumable accounts in the client's own chart
/// (0348) — stationery, household, fuel, tyres, tools — and the only ones a
/// DEFAULT here is allowed to name. Everything else a vendor's bill could
/// debit is reached through a mapping Finance keeps: prepaid and rent by
/// contract type, repairs by the object that broke, asset purchases by the
/// asset class. Offering those here would be a second, rival route to an
/// answer that already has one. The names are the client's verbatim, misspelt
/// "Expences" and all — an accountant looks for their word, not ours.
const DEFAULT_ACCOUNTS: readonly { code: string; label: string }[] = [
  { code: "6041", label: "Alat Tulis Kantor & Barang Cetakan" },
  { code: "6042", label: "Biaya Rumah Tangga" },
  { code: "6050", label: "Computer Expenses" },
  { code: "6052", label: "Biaya Perlengkapan Toko dan Kantor" },
  { code: "6054", label: "Biaya Peralatan Listrik" },
  { code: "6055", label: "Tire & Tubes Expences" },
  { code: "6056", label: "Fuel & Oil Expences" },
  { code: "6057", label: "Tools (Peralatan) Expences" },
  { code: "6059", label: "Biaya Telephone Equipment" },
  { code: "6063", label: "Biaya Perlengkapan Mess atau Rumah Dinas" },
]

const CATEGORY_WORDS: Record<SupplierCategory, string> = {
  EXPENSE: "Operasional",
  AFFILIATE: "Afiliasi",
  MERCHANDISE: "Dagangan",
}

export function Vendors() {
  const editing = useSheet("supplier")
  const [book, setBook] = useState<SupplierCategory>("EXPENSE")
  const [search, setSearch] = useState("")
  const [adding, setAdding] = useState(false)

  const scope = useMemo(
    () => ({ category: book, q: search.trim() === "" ? undefined : search }),
    [book, search]
  )

  const vendors = useQuery({
    queryKey: [...procurementKeys.suppliers(), "book", book, search],
    queryFn: ({ signal }) => supplierPage(scope, signal),
  })

  const open =
    vendors.data?.rows.find((row) => row.supplier_id === editing.value) ?? null

  return (
    <PageContent>
      <PageHeader
        crumb="Vendor"
        title="Vendor"
        sub="Kelola pihak penyedia listrik, sewa tempat, perbaikan, dan layanan lainnya."
        actions={
          <>
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Kode, nama, atau kontak"
              className="h-8 w-56"
            />
            <Button variant="primary" onClick={() => setAdding(true)}>
              <Plus />
              Tambah vendor
            </Button>
          </>
        }
      />

      <Toolbar>
        {/* Two books, not three. Merchandise is the other menu's — a vendor
            list that could show garment factories would be the single list
            this screen exists instead of. */}
        <Segmented
          options={[
            { value: "EXPENSE" as const, label: "Operasional" },
            { value: "AFFILIATE" as const, label: "Afiliasi" },
          ]}
          value={book}
          onChange={setBook}
        />
        <Toolbar.Spacer />
        {vendors.data !== undefined && (
          <span className="text-meta text-body">
            <b className="font-medium text-ink">
              {count(vendors.data.rows.length)}
            </b>{" "}
            vendor
          </span>
        )}
      </Toolbar>

      {queryState(vendors, {
        loading: "Memuat daftar vendor…",
        render: (page) =>
          page.rows.length === 0 ? (
            <Card>
              <EmptyState
                action={
                  <Button variant="ghost" onClick={() => setAdding(true)}>
                    Tambah vendor pertama
                  </Button>
                }
              >
                {book === "EXPENSE"
                  ? "Belum ada vendor operasional. Tambahkan penyedia layanan atau pihak yang mengirim tagihan."
                  : "Belum ada vendor afiliasi. Tambahkan unit lain dalam grup perusahaan yang bertransaksi dengan perusahaan ini."}
              </EmptyState>
            </Card>
          ) : (
            <Card className="overflow-hidden">
              <div className="grid h-10 grid-cols-[7rem_minmax(0,1fr)_11rem_9rem_6rem] items-center gap-3 border-b border-hairline bg-soft px-3.5 text-eyebrow font-medium text-body">
                <span>Kode</span>
                <span>Vendor</span>
                <span>Akun beban</span>
                <span>Kontak</span>
                <span>Status</span>
              </div>
              {page.rows.map((row) => (
                <VendorRow
                  key={row.supplier_id}
                  vendor={row}
                  onOpen={() => editing.open(row.supplier_id)}
                />
              ))}
            </Card>
          ),
      })}

      <VendorSheet
        open={adding || open !== null}
        vendor={open}
        book={book}
        onClose={() => {
          setAdding(false)
          editing.close()
        }}
      />
    </PageContent>
  )
}

function VendorRow({
  vendor,
  onOpen,
}: {
  vendor: Supplier
  onOpen: () => void
}) {
  return (
    <div
      onClick={onOpen}
      className="grid cursor-pointer grid-cols-[7rem_minmax(0,1fr)_11rem_9rem_6rem] items-center gap-3 border-b border-hairline px-3.5 py-2.5 transition-colors last:border-b-0 hover:bg-soft"
    >
      <span className="truncate font-mono text-id text-body">
        {vendor.supplier_code}
      </span>
      <span className="truncate text-cell font-medium text-ink">
        {vendor.name}
      </span>
      {/* The column this screen is for. An empty one is a vendor whose bills
          somebody has to account for by hand every month, so it says so
          rather than sitting blank. */}
      <span
        className={cn(
          "truncate font-mono text-id",
          vendor.expense_account_code === null
            ? "text-mute italic"
            : "text-body"
        )}
      >
        {vendor.expense_account_code ?? "not set"}
      </span>
      <span className="truncate text-meta text-body">
        {vendor.contact_name ?? vendor.phone ?? "—"}
      </span>
      <span>
        <Pill tone={vendor.status === "ACTIVE" ? "ok" : "neutral"}>
          {vendor.status === "ACTIVE" ? "Aktif" : "Nonaktif"}
        </Pill>
      </span>
    </div>
  )
}

/// One vendor, made or changed.
///
/// An existing record has three faces — the details, the bank accounts, the
/// contacts — because registering the vendor and keeping its payment and
/// people details current are three questions asked on different days. A NEW
/// vendor has one face only: there is nothing yet to put an account beside,
/// and the panels' own Add buttons are how the rest arrives.
function VendorSheet({
  open,
  vendor,
  book,
  onClose,
}: {
  open: boolean
  vendor: Supplier | null
  book: SupplierCategory
  onClose: () => void
}) {
  const client = useQueryClient()
  const [form, setForm] = useState<Record<string, string>>({})
  const [tab, setTab] = useState("details")

  // The row being edited, or the blanks a new one starts from. Keyed by the
  // vendor below, so switching rows does not carry the last one's typing.
  const value = (key: keyof Supplier, fallback = "") =>
    form[key] ?? (vendor?.[key] as string | null) ?? fallback

  // The picker's value, and whether the list names it. A code set before the
  // picker existed — the old field took the whole chart — has to stay
  // visible in the Select rather than read as empty.
  const currentAccount = value("expense_account_code").trim()
  const currentIsListed = DEFAULT_ACCOUNTS.some(
    (one) => one.code === currentAccount
  )

  const refresh = () => {
    void client.invalidateQueries({ queryKey: procurementKeys.suppliers() })
    setForm({})
    onClose()
  }

  const save = useMutation({
    mutationFn: () => {
      const key = crypto.randomUUID()
      const account = value("expense_account_code").trim()
      if (vendor === null) {
        return createSupplier(
          {
            supplier_code: value("supplier_code").trim(),
            name: value("name").trim(),
            contact_name: blank(value("contact_name")),
            phone: blank(value("phone")),
            email: blank(value("email")),
            address: blank(value("address")),
            status: "ACTIVE",
            category: form.category ?? book,
            expense_account_code: account === "" ? null : account,
          },
          key
        )
      }
      return updateSupplier(
        vendor.supplier_id,
        {
          supplier_code: value("supplier_code").trim(),
          name: value("name").trim(),
          contact_name: blank(value("contact_name")),
          phone: blank(value("phone")),
          email: blank(value("email")),
          address: blank(value("address")),
          category: form.category ?? vendor.category,
          expense_account_code: account === "" ? null : account,
        },
        vendor.version,
        key
      )
    },
    onSuccess: refresh,
  })

  const retire = useMutation({
    mutationFn: () =>
      setSupplierStatus(
        vendor?.supplier_id ?? "",
        vendor?.status === "ACTIVE" ? "INACTIVE" : "ACTIVE",
        vendor?.version ?? 0,
        crypto.randomUUID()
      ),
    onSuccess: refresh,
  })

  const ready =
    value("supplier_code").trim() !== "" && value("name").trim() !== ""

  return (
    <Sheet
      key={vendor?.supplier_id ?? "new"}
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title={vendor === null ? "Tambah vendor" : vendor.name}
      footer={
        // Save and Retire are the DETAILS' acts — the form's. The bank and
        // contact panels write as they go, each request carrying its own
        // idempotency key, so a footer Save down here would be a button that
        // does nothing and a lie about how the data got there.
        vendor === null || tab === "details" ? (
          <div className="flex items-center justify-between gap-3">
            {vendor !== null ? (
              <Button
                variant="ghost"
                onClick={() => retire.mutate()}
                disabled={retire.isPending}
              >
                {vendor.status === "ACTIVE"
                  ? "Nonaktifkan"
                  : "Aktifkan kembali"}
              </Button>
            ) : (
              <span className="text-pill text-mute">
                Lengkapi data vendor untuk membuatnya.
              </span>
            )}
            <Button
              variant="primary"
              disabled={!ready || save.isPending}
              onClick={() => save.mutate()}
            >
              {save.isPending ? "Menyimpan…" : "Simpan"}
            </Button>
          </div>
        ) : (
          <span className="text-pill text-mute">
            Perubahan di bagian ini tersimpan otomatis.
          </span>
        )
      }
    >
      <div className="flex flex-col gap-4">
        {save.error instanceof Error && (
          <Banner tone="bad">{save.error.message}</Banner>
        )}

        {vendor !== null && (
          <SubTabs
            className="mb-0"
            tabs={[
              { value: "details", label: "Detail" },
              { value: "bank", label: "Rekening" },
              { value: "contacts", label: "Kontak" },
            ]}
            value={tab}
            onChange={setTab}
          />
        )}

        {vendor !== null && tab === "bank" && (
          <SupplierBankAccountsPanel supplierId={vendor.supplier_id} />
        )}

        {vendor !== null && tab === "contacts" && (
          <SupplierContactsPanel supplierId={vendor.supplier_id} />
        )}

        {(vendor === null || tab === "details") && (
          <>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Kode">
                <Input
                  value={value("supplier_code")}
                  onChange={(event) =>
                    setForm((f) => ({
                      ...f,
                      supplier_code: event.target.value,
                    }))
                  }
                  placeholder="PLN-01"
                />
              </Field>
              <Field label="Jenis">
                <Select
                  value={form.category ?? vendor?.category ?? book}
                  onChange={(next) =>
                    setForm((f) => ({ ...f, category: next }))
                  }
                  aria-label="Kind"
                >
                  <option value="EXPENSE">
                    {CATEGORY_WORDS.EXPENSE} — penyedia yang mengirim tagihan
                  </option>
                  <option value="AFFILIATE">
                    {CATEGORY_WORDS.AFFILIATE} — unit lain dalam grup
                  </option>
                  <option value="MERCHANDISE">
                    {CATEGORY_WORDS.MERCHANDISE} — memasok barang untuk dijual
                    kembali
                  </option>
                </Select>
              </Field>
            </div>

            <Field label="Nama">
              <Input
                value={value("name")}
                onChange={(event) =>
                  setForm((f) => ({ ...f, name: event.target.value }))
                }
                placeholder="PT PLN (Persero)"
              />
            </Field>

            <Field
              label="Akun beban bawaan"
              hint="Akun ini terisi otomatis pada tagihan vendor dan masih dapat diubah saat tagihan ditinjau."
            >
              <Select
                value={value("expense_account_code")}
                onChange={(next) =>
                  setForm((f) => ({ ...f, expense_account_code: next }))
                }
                aria-label="Akun beban bawaan"
              >
                <option value="">Belum dipilih</option>
                {/* A value set before the picker existed — free text accepted
                    the whole chart — stays visible and saveable rather than
                    silently reading as empty. */}
                {currentAccount !== "" && !currentIsListed && (
                  <option value={currentAccount}>
                    {currentAccount} (saat ini)
                  </option>
                )}
                {DEFAULT_ACCOUNTS.map((one) => (
                  <option key={one.code} value={one.code}>
                    {one.code} · {one.label}
                  </option>
                ))}
              </Select>
            </Field>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Kontak">
                <Input
                  value={value("contact_name")}
                  onChange={(event) =>
                    setForm((f) => ({ ...f, contact_name: event.target.value }))
                  }
                />
              </Field>
              <Field label="Telepon">
                <Input
                  value={value("phone")}
                  onChange={(event) =>
                    setForm((f) => ({ ...f, phone: event.target.value }))
                  }
                />
              </Field>
            </div>

            <Field label="Alamat">
              <Input
                value={value("address")}
                onChange={(event) =>
                  setForm((f) => ({ ...f, address: event.target.value }))
                }
              />
            </Field>
          </>
        )}
      </div>
    </Sheet>
  )
}

/// An empty box means "nothing", and the endpoint spells nothing `null`.
function blank(value: string): string | null {
  const trimmed = value.trim()
  return trimmed === "" ? null : trimmed
}
