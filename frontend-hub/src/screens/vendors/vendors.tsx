import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query"
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
import { Banner, EmptyState, LoadMore } from "@/components/ui/states"
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
import { useSections } from "@/lib/session"
import { useSheet } from "@/lib/sheets"
import { useDebounced } from "@/lib/use-debounced"
import { cn } from "@/lib/utils"
import {
  supplierDisplayName,
  titled,
} from "@/screens/procurement/supplier-format"
import type { Supplier } from "@itulah/contract"

/// Suppliers — everybody we owe who does not sell us clothes.
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
/// Because REGISTERING a supplier is General Affairs' work — signing up the
/// electricity account, negotiating the rent, appointing the cleaners — and
/// paying what they send is Finance's. The owner said so in five words when
/// this screen first appeared under Finance. What Finance needs from the same
/// record it reads where it works: on the bill, and in payables.
///
/// # The default account is the point of this screen
///
/// Fourteen PLN bills a month, each of which has to name the account it debits.
/// Typing it fourteen times is how the fourteenth gets it wrong. A supplier that
/// names its usual account fills that in for every bill it sends.
///
/// # Why the picker is a list and not the chart
///
/// These ten are the suppliers' consumable accounts in the client's own chart
/// (0348) — stationery, household, fuel, tyres, tools — and the only ones a
/// DEFAULT here is allowed to name. Everything else a supplier's bill could
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
  EXPENSE: "Operating",
  AFFILIATE: "Affiliate",
  MERCHANDISE: "Merchandise",
}

/// How many suppliers one page of the book asks for.
const PAGE = 100

/// Whether this person may add or change a supplier. The book is Procurement's
/// and Finance's to keep; GA reads it to pick a vendor and sees it here
/// read-only, the same split the server's section gate makes.
function useMayEditSuppliers(): boolean {
  const { sections, bypass } = useSections()
  return (
    bypass || sections.includes("procurement") || sections.includes("finance")
  )
}

export function Vendors() {
  const editing = useSheet("supplier")
  const [book, setBook] = useState<SupplierCategory>("EXPENSE")
  const [search, setSearch] = useState("")
  const [adding, setAdding] = useState(false)
  const mayEdit = useMayEditSuppliers()

  // The search is the server's, so it waits for the typing to stop.
  const needle = useDebounced(search.trim(), 300)

  const scope = useMemo(
    () => ({ category: book, q: needle === "" ? undefined : needle }),
    [book, needle]
  )

  /// The book, a page at a time as its foot nears view — the same read and
  /// the same key shape the supplier book uses, under the book's prefix so
  /// `suppliers()` invalidation still reaches it. It used to be the first
  /// page alone, with a count of what had loaded beside it.
  const vendors = useInfiniteQuery({
    queryKey: [...procurementKeys.suppliers(scope), "pages"] as const,
    queryFn: ({ pageParam, signal }) =>
      supplierPage({ ...scope, limit: PAGE, cursor: pageParam }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    placeholderData: (previous) => previous,
  })

  const rows = useMemo(
    () => vendors.data?.pages.flatMap((page) => page.rows) ?? [],
    [vendors.data]
  )
  const head = vendors.data?.pages[0]

  const open = rows.find((row) => row.supplier_id === editing.value) ?? null

  return (
    <PageContent>
      <PageHeader
        crumb="GA"
        title="Suppliers"
        sub={
          mayEdit
            ? "Manage the providers of electricity, rented premises, repairs and other services."
            : "The providers of electricity, rented premises, repairs and other services. Procurement adds and changes them."
        }
        actions={
          <>
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="h-8 w-56"
            />
            {mayEdit && (
              <Button variant="primary" onClick={() => setAdding(true)}>
                <Plus />
                Add supplier
              </Button>
            )}
          </>
        }
      />

      <Toolbar>
        {/* Two books, not three. Merchandise is the other menu's — a supplier
            list that could show garment factories would be the single list
            this screen exists instead of. */}
        <Segmented
          options={[
            { value: "EXPENSE" as const, label: "Operating" },
            { value: "AFFILIATE" as const, label: "Affiliate" },
          ]}
          value={book}
          onChange={setBook}
        />
        <Toolbar.Spacer />
        {head !== undefined && (
          <span className="text-meta text-body">
            <b className="font-medium text-ink">{count(head.total)}</b>{" "}
            {head.total === 1 ? "supplier" : "suppliers"}
          </span>
        )}
      </Toolbar>

      {queryState(vendors, {
        loading: "Loading suppliers…",
        render: () =>
          rows.length === 0 ? (
            <Card>
              <EmptyState
                action={
                  mayEdit ? (
                    <Button variant="ghost" onClick={() => setAdding(true)}>
                      Add first supplier
                    </Button>
                  ) : undefined
                }
              >
                {book === "EXPENSE"
                  ? "No operating suppliers yet. Add a service provider or a party that sends bills."
                  : "No affiliate suppliers yet. Add another unit in the company group that transacts with this company."}
              </EmptyState>
            </Card>
          ) : (
            <Card className="overflow-hidden">
              <div className="grid h-10 grid-cols-[7rem_minmax(0,1fr)_11rem_9rem_6rem] items-center gap-3 border-b border-hairline bg-soft px-3.5 text-eyebrow font-medium text-body">
                <span>Code</span>
                <span>Supplier</span>
                <span>Expense account</span>
                <span>Contact</span>
                <span>Status</span>
              </div>
              {rows.map((row) => (
                <VendorRow
                  key={row.supplier_id}
                  vendor={row}
                  onOpen={() => editing.open(row.supplier_id)}
                />
              ))}
              {/* The page scrolls, not this card — see `<LoadMore>`. */}
              <LoadMore query={vendors} />
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
        {supplierDisplayName(vendor)}
      </span>
      {/* The column this screen is for. An empty one is a supplier whose bills
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
          {vendor.status === "ACTIVE" ? "Active" : "Inactive"}
        </Pill>
      </span>
    </div>
  )
}

/// One supplier, made or changed.
///
/// An existing record has three faces — the details, the bank accounts, the
/// contacts — because registering the supplier and keeping its payment and
/// people details current are three questions asked on different days. A NEW
/// supplier has one face only: there is nothing yet to put an account beside,
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
  const mayEdit = useMayEditSuppliers()

  // The row being edited, or the blanks a new one starts from. Keyed by the
  // supplier below, so switching rows does not carry the last one's typing.
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
      title={vendor === null ? "Add supplier" : supplierDisplayName(vendor)}
      footer={
        !mayEdit ? (
          <span className="text-pill text-mute">
            Read only. Ask Procurement to add or change a supplier.
          </span>
        ) : // Save and Retire are the DETAILS' acts — the form's. The bank and
        // contact panels write as they go, each request carrying its own
        // idempotency key, so a footer Save down here would be a button that
        // does nothing and a lie about how the data got there.
        vendor === null || tab === "details" ? (
          <div className="flex items-center justify-between gap-3">
            {vendor !== null ? (
              <Button
                variant="ghost"
                onClick={() => retire.mutate()}
                pending={retire.isPending}
              >
                {vendor.status === "ACTIVE" ? "Deactivate" : "Reactivate"}
              </Button>
            ) : (
              <span className="text-pill text-mute">
                Fill in the supplier details to create it.
              </span>
            )}
            <Button
              variant="primary"
              pending={save.isPending}
              disabled={!ready}
              onClick={() => save.mutate()}
            >
              {save.isPending ? "Submitting…" : "Submit"}
            </Button>
          </div>
        ) : (
          <span className="text-pill text-mute">
            Changes in this section are saved automatically.
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
            // Bank details are for whoever pays the supplier, not for GA.
            tabs={[
              { value: "details", label: "Details" },
              ...(mayEdit ? [{ value: "bank", label: "Bank accounts" }] : []),
              { value: "contacts", label: "Contacts" },
            ]}
            value={tab}
            onChange={setTab}
          />
        )}

        {vendor !== null && mayEdit && tab === "bank" && (
          <SupplierBankAccountsPanel supplierId={vendor.supplier_id} />
        )}

        {vendor !== null && tab === "contacts" && (
          <SupplierContactsPanel supplierId={vendor.supplier_id} />
        )}

        {(vendor === null || tab === "details") && (
          // A disabled fieldset holds every control in it still, so a
          // read-only reader sees the same form and cannot change it.
          <fieldset disabled={!mayEdit} className="contents">
            <div className="grid grid-cols-2 gap-4">
              <Field label="Code" required>
                <Input
                  value={value("supplier_code")}
                  onChange={(event) =>
                    setForm((f) => ({
                      ...f,
                      supplier_code: event.target.value,
                    }))
                  }
                />
              </Field>
              <Field label="Type">
                <Select
                  value={form.category ?? vendor?.category ?? book}
                  onChange={(next) =>
                    setForm((f) => ({ ...f, category: next }))
                  }
                  aria-label="Kind"
                >
                  <option value="EXPENSE">
                    {CATEGORY_WORDS.EXPENSE} — a provider that sends bills
                  </option>
                  <option value="AFFILIATE">
                    {CATEGORY_WORDS.AFFILIATE} — another unit in the group
                  </option>
                  <option value="MERCHANDISE">
                    {CATEGORY_WORDS.MERCHANDISE} — supplies goods for resale
                  </option>
                </Select>
              </Field>
            </div>

            <Field label="Name" required>
              <Input
                value={value("name")}
                onChange={(event) =>
                  titled(event, (name) => setForm((f) => ({ ...f, name })))
                }
              />
            </Field>

            <Field
              label="Default expense account"
              hint="This account fills in automatically on the supplier's bills and can still be changed when the bill is reviewed."
            >
              <Select
                value={value("expense_account_code")}
                onChange={(next) =>
                  setForm((f) => ({ ...f, expense_account_code: next }))
                }
                aria-label="Default expense account"
              >
                <option value="">Not selected</option>
                {/* A value set before the picker existed — free text accepted
                    the whole chart — stays visible and saveable rather than
                    silently reading as empty. */}
                {currentAccount !== "" && !currentIsListed && (
                  <option value={currentAccount}>
                    {currentAccount} (current)
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
              <Field label="Contact">
                <Input
                  value={value("contact_name")}
                  onChange={(event) =>
                    setForm((f) => ({ ...f, contact_name: event.target.value }))
                  }
                />
              </Field>
              <Field label="Phone">
                <Input
                  value={value("phone")}
                  onChange={(event) =>
                    setForm((f) => ({ ...f, phone: event.target.value }))
                  }
                />
              </Field>
            </div>

            <Field label="Address">
              <Input
                value={value("address")}
                onChange={(event) =>
                  titled(event, (address) =>
                    setForm((f) => ({ ...f, address }))
                  )
                }
              />
            </Field>
          </fieldset>
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
