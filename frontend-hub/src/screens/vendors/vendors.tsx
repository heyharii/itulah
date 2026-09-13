import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Plus } from "lucide-react"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Field, Input, Select } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { Segmented, Toolbar } from "@/components/ui/segmented"
import { Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState } from "@/components/ui/states"
import { count } from "@/lib/format"
import { queryState } from "@/lib/query-state"
import {
  createSupplier,
  procurementKeys,
  setSupplierStatus,
  supplierPage,
  updateSupplier,
  SUPPLIER_CATEGORY_LABEL,
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
        crumb="GA"
        title="Vendors"
        sub="Everybody we owe who does not sell us clothes — the meter, the landlord, the workshop, and the other units of the group."
        actions={
          <>
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Code, name or contact"
              className="h-8 w-56"
            />
            <Button variant="primary" onClick={() => setAdding(true)}>
              <Plus />
              New vendor
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
            { value: "EXPENSE" as const, label: "Expense" },
            { value: "AFFILIATE" as const, label: "Affiliate" },
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
            {vendors.data.rows.length === 1 ? "vendor" : "vendors"}
          </span>
        )}
      </Toolbar>

      {queryState(vendors, {
        loading: "Opening the book…",
        render: (page) =>
          page.rows.length === 0 ? (
            <Card>
              <EmptyState
                action={
                  <Button variant="ghost" onClick={() => setAdding(true)}>
                    Add the first one
                  </Button>
                }
              >
                {book === "EXPENSE"
                  ? "Nobody is filed here yet. PLN, PDAM, the telephone company, the landlord, the cleaners — the parties whose bills post to 2012001003."
                  : "No unit of the group is filed here yet. These are the fourteen places that owe each other: head office and the thirteen shops."}
              </EmptyState>
            </Card>
          ) : (
            <Card className="overflow-hidden">
              <div className="grid h-10 grid-cols-[7rem_minmax(0,1fr)_11rem_9rem_6rem] items-center gap-3 border-b border-hairline bg-soft px-3.5 text-eyebrow font-medium text-body">
                <span>Code</span>
                <span>Vendor</span>
                <span>Bills usually post to</span>
                <span>Contact</span>
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
          {vendor.status === "ACTIVE" ? "Active" : "Retired"}
        </Pill>
      </span>
    </div>
  )
}

/// One vendor, made or changed.
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

  // The row being edited, or the blanks a new one starts from. Keyed by the
  // vendor below, so switching rows does not carry the last one's typing.
  const value = (key: keyof Supplier, fallback = "") =>
    form[key] ?? (vendor?.[key] as string | null) ?? fallback

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
      title={vendor === null ? "New vendor" : vendor.name}
      footer={
        <div className="flex items-center justify-between gap-3">
          {vendor !== null ? (
            <Button
              variant="ghost"
              onClick={() => retire.mutate()}
              disabled={retire.isPending}
            >
              {vendor.status === "ACTIVE" ? "Retire" : "Bring back"}
            </Button>
          ) : (
            <span className="text-pill text-mute">
              Its bills post to 2012001003.
            </span>
          )}
          <Button
            variant="primary"
            disabled={!ready || save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {save.error instanceof Error && (
          <Banner tone="bad">{save.error.message}</Banner>
        )}

        <div className="grid grid-cols-2 gap-4">
          <Field label="Code">
            <Input
              value={value("supplier_code")}
              onChange={(event) =>
                setForm((f) => ({ ...f, supplier_code: event.target.value }))
              }
              placeholder="PLN-01"
            />
          </Field>
          <Field label="Kind">
            <Select
              value={form.category ?? vendor?.category ?? book}
              onChange={(next) => setForm((f) => ({ ...f, category: next }))}
              aria-label="Kind"
            >
              <option value="EXPENSE">
                {SUPPLIER_CATEGORY_LABEL.EXPENSE} — sends bills
              </option>
              <option value="AFFILIATE">
                {SUPPLIER_CATEGORY_LABEL.AFFILIATE} — another unit of the group
              </option>
              <option value="MERCHANDISE">
                {SUPPLIER_CATEGORY_LABEL.MERCHANDISE} — sells goods for resale
              </option>
            </Select>
          </Field>
        </div>

        <Field label="Name">
          <Input
            value={value("name")}
            onChange={(event) =>
              setForm((f) => ({ ...f, name: event.target.value }))
            }
            placeholder="PT PLN (Persero)"
          />
        </Field>

        <Field
          label="Bills usually post to"
          hint="The client's own account code. A bill still carries the account and a person may still change it — this only saves typing it every month."
        >
          <Input
            value={value("expense_account_code")}
            onChange={(event) =>
              setForm((f) => ({
                ...f,
                expense_account_code: event.target.value,
              }))
            }
            placeholder="6010310…"
          />
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
              setForm((f) => ({ ...f, address: event.target.value }))
            }
          />
        </Field>
      </div>
    </Sheet>
  )
}

/// An empty box means "nothing", and the endpoint spells nothing `null`.
function blank(value: string): string | null {
  const trimmed = value.trim()
  return trimmed === "" ? null : trimmed
}
