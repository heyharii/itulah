import { Component, useEffect, useState, type ReactNode } from "react"
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
import { procurementKeys, supplierPage } from "@/lib/queries/procurement"
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

  const offline =
    cache.suppliers.length > 0 ? (
      <OfflineSuppliers
        suppliers={cache.suppliers}
        total={cache.suppliers_total}
        at={cache.suppliers_at}
      />
    ) : null
  if (probe.isError && offline !== null) return offline
  // The real screen reads its book under a `<Suspense>`, so a read that fails
  // is thrown rather than drawn: with the line down and a copy on this device,
  // the copy is shown in its place. With no copy the failure goes on up to the
  // app's own error screen, which says it honestly.
  return (
    <FallBackTo offline={offline}>
      <Suppliers />
    </FallBackTo>
  )
}

/// Shows `offline` when what is inside fails to read, and lets the failure
/// pass when there is nothing to show instead.
class FallBackTo extends Component<
  { offline: ReactNode; children: ReactNode },
  { failure: unknown; failed: boolean }
> {
  state: { failure: unknown; failed: boolean } = {
    failure: null,
    failed: false,
  }

  static getDerivedStateFromError(failure: unknown) {
    return { failure, failed: true }
  }

  render() {
    if (!this.state.failed) return this.props.children
    if (this.props.offline === null) throw this.state.failure
    return this.props.offline
  }
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
            (one.contact_name ?? "").toLowerCase().includes(needle)
        )
  const hidden = Math.max(0, total - suppliers.length)

  return (
    <PageContent>
      <PageHeader
        crumb="Procurement"
        title="Suppliers"
        sub="Offline reading — the full book and every change are available online only."
      />

      <Banner tone="warn" className="mb-4">
        Offline — showing {count(suppliers.length)} of {count(total)} suppliers
        stored on this device
        {at === null ? "" : ` (fetched ${day(at)})`}
        {hidden > 0 ? `; ${count(hidden)} not stored.` : "."} Opening, adding or
        changing a supplier is done when online.
      </Banner>

      <Field label="Search stored suppliers">
        <Input
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          placeholder="Name, code, or contact"
          aria-label="Search stored suppliers"
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
                  aria-label={`Open ${one.name}`}
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
            No match in the {count(suppliers.length)} stored suppliers.
            Suppliers outside the cache only show when online.
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
              <Fact term="Code">{open.supplier_code}</Fact>
              <Fact term="Status">{open.status}</Fact>
              <Fact term="Contact">{open.contact_name ?? "—"}</Fact>
              <Fact term="Phone Number">{open.phone ?? "—"}</Fact>
              <Fact term="Email">{open.email ?? "—"}</Fact>
              <Fact term="Address">{open.address ?? "—"}</Fact>
              <Fact term="NPWP">{open.npwp ?? "—"}</Fact>
              <Fact term="PKP">{open.is_pkp ? "Yes" : "No"}</Fact>
              <Fact term="Legal Form">{open.legal_form ?? "—"}</Fact>
              <Fact term="Default Payment Terms">
                {open.default_payment_terms_code ?? "—"}
              </Fact>
              <Fact term="Notes">{open.notes ?? "—"}</Fact>
            </Facts>
            <Banner tone="info">
              Read from the copy stored on this device — the latest version is
              there when online.
            </Banner>
          </>
        )}
      </Sheet>
    </PageContent>
  )
}
