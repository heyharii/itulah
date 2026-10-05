import { useQuery } from "@tanstack/react-query"
import { useState } from "react"

import { AppLink } from "@/components/ui/app-link"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Pill } from "@/components/ui/pill"
import { EmptyState } from "@/components/ui/states"
import type { Tone } from "@/lib/format"
import { label as titleCase } from "@/lib/format"
import { financeKeys, sitePaymentMethods } from "@/lib/queries/finance"
import { listEmployees, peopleKeys } from "@/lib/queries/people"
import {
  flowNoticesForSite,
  listFlowNotices,
  storesKeys,
  type FlowNoticeStatus,
  type StoreSummary,
} from "@/lib/queries/stores"
import { queryState } from "@/lib/query-state"
import { LocationHubSheet } from "@/screens/locations/hub"
import { Section } from "@/screens/stores/shared"

/// The four smaller tabs — Team, Payments, Stock and Facilities. Each reads a
/// query another module already owns and adds nothing of its own: this
/// module's whole point is to bring five screens together for one store, not
/// to grow a sixth.

// ---- Team -------------------------------------------------------------

/// The people posted at the unit, and the PIC, each opening its own record on
/// People. Team building — hiring, transfers, appointing a PIC — stays on
/// People and System › Units; this is a reading of both, per store.
export function TeamTab({ store }: { store: StoreSummary }) {
  const employees = useQuery({
    queryKey: peopleKeys.employees({ unitId: store.unit_id }),
    queryFn: ({ signal }) => listEmployees({ unitId: store.unit_id }, signal),
  })

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <Card className="p-4">
        <Section
          title="PIC"
          actions={
            <AppLink
              to="/master/organisation"
              className="text-[0.875rem] font-medium text-accent"
            >
              Change in Master › Units
            </AppLink>
          }
        >
          {store.pic ? (
            <AppLink
              to="/people"
              sheet={{ key: "employee", value: store.pic.employee_id }}
              className="text-[0.9375rem] text-ink underline underline-offset-2"
            >
              {store.pic.name}
            </AppLink>
          ) : (
            <p className="text-[0.875rem] text-body">
              Nobody is appointed yet.
            </p>
          )}
        </Section>
      </Card>

      <Card className="overflow-hidden">
        {queryState(employees, {
          loading: "Reading the team…",
          render: (rows) =>
            rows.length === 0 ? (
              <EmptyState>
                Nobody is posted to this unit yet. Add them from People.
              </EmptyState>
            ) : (
              <ul className="divide-y divide-hairline">
                {rows.map((row) => (
                  <li key={row.employee_id}>
                    <AppLink
                      to="/people"
                      sheet={{ key: "employee", value: row.employee_id }}
                      className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-soft-2"
                    >
                      <span className="min-w-0 flex-1">
                        <b className="block truncate text-ink">
                          {row.full_name ?? row.employee_code}
                        </b>
                        <span className="block truncate text-meta text-mute">
                          {row.position ?? "—"}
                        </span>
                      </span>
                      {row.employee_id === store.pic?.employee_id && (
                        <Pill tone="accent">PIC</Pill>
                      )}
                    </AppLink>
                  </li>
                ))}
              </ul>
            ),
        })}
      </Card>
    </div>
  )
}

// ---- Payments ---------------------------------------------------------

/// The methods this shop takes today — a reading of the same setup Finance's
/// Shop Payment Methods screen writes. Turning one on or off happens there.
export function PaymentsTab({ siteId }: { siteId: string }) {
  const setup = useQuery({
    queryKey: financeKeys.sitePaymentMethods(siteId),
    queryFn: ({ signal }) => sitePaymentMethods(siteId, signal),
  })
  const enabled = (setup.data ?? []).filter((row) => row.enabled)

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <Card className="overflow-hidden">
        {queryState(setup, {
          loading: "Reading the payment methods…",
          render: () =>
            enabled.length === 0 ? (
              <EmptyState>
                No payment method is enabled at this shop yet. Cash works by
                default once the shop trades; turn on QRIS or a bank&rsquo;s
                debit from Finance.
              </EmptyState>
            ) : (
              <ul className="divide-y divide-hairline">
                {enabled.map((row) => (
                  <li
                    key={row.code}
                    className="flex items-center justify-between gap-3 px-4 py-3"
                  >
                    <span className="min-w-0">
                      <b className="block truncate text-ink">{row.name}</b>
                      <span className="block truncate text-meta text-mute">
                        {titleCase(row.tender_type)}
                      </span>
                    </span>
                    {row.bank_code !== "" && (
                      <Pill tone="neutral">{row.bank_code}</Pill>
                    )}
                  </li>
                ))}
              </ul>
            ),
        })}
      </Card>
      <div>
        <AppLink to="/finance/setup/shop-payment-methods" variant="soft">
          Manage in Finance
        </AppLink>
      </div>
    </div>
  )
}

// ---- Stock --------------------------------------------------------------

const NOTICE_TONE: Record<FlowNoticeStatus, Tone> = {
  REQUESTED: "warn",
  CONFIRMED: "info",
  COMPLETED: "ok",
  DECLINED: "bad",
  CANCELED: "bad",
}

/// Open flow documents that name this site at either end — a shipment on its
/// way in, a return on its way out. Nothing here is written; every document
/// is worked from Operations or the store's own app.
export function StockTab({ siteId }: { siteId: string }) {
  const notices = useQuery({
    queryKey: storesKeys.flowNotices(true),
    queryFn: ({ signal }) => listFlowNotices(true, signal),
  })
  const rows = flowNoticesForSite(notices.data ?? [], siteId)

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <Card className="overflow-hidden">
        {queryState(notices, {
          loading: "Reading the open flow documents…",
          render: () =>
            rows.length === 0 ? (
              <EmptyState>
                No flow document is open to or from this store right now.
              </EmptyState>
            ) : (
              <ul className="divide-y divide-hairline">
                {rows.map((notice) => (
                  <li
                    key={notice.document_id}
                    className="flex items-center justify-between gap-3 px-4 py-3"
                  >
                    <span className="min-w-0">
                      <b className="block truncate text-ink">
                        {notice.document_number}
                      </b>
                      <span className="block truncate text-meta text-mute">
                        {notice.template_name}
                        {notice.current_stage
                          ? ` · ${titleCase(notice.current_stage)}`
                          : ""}
                      </span>
                    </span>
                    <Pill tone={NOTICE_TONE[notice.status]}>
                      {titleCase(notice.status)}
                    </Pill>
                  </li>
                ))}
              </ul>
            ),
        })}
      </Card>
    </div>
  )
}

// ---- Facilities ---------------------------------------------------------

/// The GA facilities hub for this store's site, embedded rather than a
/// second tab of address fields this module would have to keep in step with
/// Locations' own.
export function FacilitiesTab({ siteId }: { siteId: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <Card className="flex items-center justify-between gap-3 p-4">
        <p className="text-[0.875rem] text-body">
          The address, floor area, contact and everything GA keeps about this
          shop&rsquo;s premises.
        </p>
        <Button variant="soft" onClick={() => setOpen(true)}>
          Open facilities
        </Button>
      </Card>
      <LocationHubSheet
        siteId={siteId}
        open={open}
        onClose={() => setOpen(false)}
      />
    </div>
  )
}
