import { useEffect, useState } from "react"
import { useQuery } from "@tanstack/react-query"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Banner } from "@/components/ui/states"
import { Field, Input } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import type { Supplier } from "@itulah/contract"

import { count, day } from "@/lib/format"
import {
  procurementKeys,
  supplierPage,
} from "@/lib/queries/procurement"
import { refreshReference, useReference } from "@/lib/offline/reference"
import { useDebounced } from "@/lib/use-debounced"
import { Suppliers } from "@/screens/procurement/suppliers"

/// The Suppliers menu's offline face.
///
/// Online, this gate is invisible: it renders the real screen and, as a side
/// effect of that screen being reachable, tops the reference cache up when it
/// has gone stale. The probe is one row — the smallest read that answers "is
/// the centre there" — under its own key, so it never disturbs the book the
/// real screen is holding.
///
/// When the probe fails **and** the cache holds rows, the gate swaps in the
/// read-only book below: the owner asked for the Suppliers menu to open
/// offline with limited info, and the cache's full entities — capped per the
/// plan — are exactly that. Every write (new supplier, edit, status) stays
/// online-only, and the screen says so rather than hiding its inputs.
///
/// A failed probe with an empty cache renders the real screen, which shows
/// its own honest error — the gate has nothing better to offer.
export function SuppliersGate() {
  const probe = useQuery({
    queryKey: [...procurementKeys.suppliers(), "gate"] as const,
    queryFn: ({ signal }) =>
      supplierPage({ category: "MERCHANDISE", limit: 1 }, signal),
    retry: false,
    staleTime: 30_000,
  })
  const { cache } = useReference()

  // Warm the cache whenever the menu proves the centre is reachable and the
  // cache has gone stale; silent when it has not or the line is down.
  useEffect(() => {
    if (probe.isSuccess) void refreshReference()
  }, [probe.isSuccess])

  if (probe.isError && cache.suppliers.length > 0)
    return (
      <OfflineSuppliers
        suppliers={cache.suppliers}
        total={cache.suppliers_total}
        at={cache.suppliers_at}
      />
    )
  return <Suppliers />
}

/// The read-only book, from the cache. Search narrows what is stored; a row
/// opens its cached facts. Nothing here writes.
function OfflineSuppliers({
  suppliers,
  total,
  at,
}: {
  suppliers: readonly Supplier[]
  total: number
  at: string | null
}) {
  const [typed, setTyped] = useState("")
  const needle = useDebounced(typed, 200).toLowerCase()
  const [openId, setOpenId] = useState<string | null>(null)
  const open = suppliers.find((one) => one.supplier_id === openId) ?? null

  const rows =
    needle === ""
      ? suppliers
      : suppliers.filter(
          (one) =>
            one.name.toLowerCase().includes(needle) ||
            one.supplier_code.toLowerCase().includes(needle) ||
            (one.contact_name ?? "").toLowerCase().includes(needle),
        )
  const hidden = Math.max(0, total - suppliers.length)

  return (
    <PageContent>
      <PageHeader
        crumb="Procurement"
        title="Suppliers"
        sub="Bacaan offline — buku penuh dan semua perubahan dilakukan saat online."
      />

      <Banner tone="warn" className="mb-4">
        Offline — menampilkan {count(suppliers.length)} dari {count(total)}{" "}
        supplier yang tersimpan di perangkat
        {at === null ? "" : ` (diambil ${day(at)})`}
        {hidden > 0 ? `; ${count(hidden)} tidak tersimpan.` : "."} Membuka,
        menambah atau mengubah supplier dilakukan saat online.
      </Banner>

      <Field label="Cari supplier tersimpan">
        <Input
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          placeholder="Nama, kode, atau kontak"
          aria-label="Cari supplier tersimpan"
        />
      </Field>

      <div className="flex flex-col gap-2">
        {rows.map((one) => (
          <Card key={one.supplier_id} className="flex flex-col gap-2 p-4">
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-medium">{one.name}</span>
              <span className="font-mono text-meta text-body">
                {one.supplier_code}
              </span>
              <Pill tone={one.status === "ACTIVE" ? "ok" : "neutral"}>
                {one.status}
              </Pill>
              <span className="ml-auto">
                <Button
                  variant="quiet"
                  aria-label={`Buka ${one.name}`}
                  onClick={() => setOpenId(one.supplier_id)}
                >
                Detail
                </Button>
              </span>
            </div>
            <span className="text-meta text-body">
              {one.contact_name ?? "—"}
              {one.phone === null ? "" : ` · ${one.phone}`}
            </span>
          </Card>
        ))}
        {rows.length === 0 && (
          <Banner tone="info">
            Tidak ada yang cocok di {count(suppliers.length)} supplier
            tersimpan. Supplier di luar cache baru terlihat saat online.
          </Banner>
        )}
      </div>

      <Sheet
        open={open !== null}
        onOpenChange={(next) => !next && setOpenId(null)}
        title={open?.name ?? ""}
      >
        {open !== null && (
          <>
            <Facts>
              <Fact term="Kode">{open.supplier_code}</Fact>
              <Fact term="Status">{open.status}</Fact>
              <Fact term="Kontak">{open.contact_name ?? "—"}</Fact>
              <Fact term="Telepon">{open.phone ?? "—"}</Fact>
              <Fact term="Email">{open.email ?? "—"}</Fact>
              <Fact term="Alamat">{open.address ?? "—"}</Fact>
              <Fact term="NPWP">{open.npwp ?? "—"}</Fact>
              <Fact term="PKP">{open.is_pkp ? "Ya" : "Bukan"}</Fact>
              <Fact term="Bentuk usaha">{open.legal_form ?? "—"}</Fact>
              <Fact term="Syarat bayar bawaan">
                {open.default_payment_terms_code ?? "—"}
              </Fact>
              <Fact term="Catatan">{open.notes ?? "—"}</Fact>
            </Facts>
            <Banner tone="info">
              Bacaan tersimpan perangkat — versi terbaru ada saat online.
            </Banner>
          </>
        )}
      </Sheet>
    </PageContent>
  )
}
