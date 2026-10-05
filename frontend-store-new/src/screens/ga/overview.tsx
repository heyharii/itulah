import {
  Boxes,
  CalendarClock,
  ChevronRight,
  Hammer,
  Package,
  Wrench,
  type LucideIcon,
} from "lucide-react"

import { AppLink } from "@/components/ui/app-link"
import { Card } from "@/components/ui/card"
import { Pill } from "@/components/ui/pill"
import { Stat, StatStrip } from "@/components/ui/stat-strip"
import { count } from "@/lib/format"
import {
  FLOOR_STATUSES,
  PHYSICAL_BUILDS,
  useGaPlace,
  useGaRepairs,
  useGaSupplies,
  useGaTasks,
} from "@/lib/queries/ga"
import {
  contractNeedsLook,
  contractTypeWords,
  day,
  daysUntil,
  dueOf,
  partyOf,
  repairIsOpen,
  repairStageTone,
  repairStageWords,
  SERVICING_HORIZON_DAYS,
  standingOf,
  supplyCategoryWords,
  supplyIsOpen,
  supplyStageTone,
  supplyStageWords,
} from "@/screens/ga/format"
import { Fact, Facts, GaScreen } from "@/screens/ga/parts"
import { describeGa, gaState } from "@/screens/ga/state"
import type { GaContractRow, GaLocationHub } from "@itulah/contract"

/// This shop's premises at a glance: the place itself, and the four things
/// about it somebody should look at this week.
///
/// # Composed, not asked for
///
/// Head office's GA overview (`/ga/overview`) is the whole estate's to-do list
/// and is not a shop's to read. This page is built from the same answers the
/// module's own screens use — the place from `/ga/locations/{site}` (its
/// record, its contracts including the company-wide ones, its utilities, its
/// assets), and the repairs, service schedule and supply requests from their
/// own lists — so a number here is the number the screen behind it shows.
///
/// # Every tile is a door
///
/// Each figure and each card opens the screen that holds its rows. A figure
/// with nowhere to go is a figure somebody reads and closes; "2 repairs open"
/// is worth something only because pressing it shows which two.
export function GaOverview() {
  return <GaScreen>{(site) => <Glance site={site} />}</GaScreen>
}

function Glance({ site }: { site: string }) {
  const place = useGaPlace(site)
  const repairs = useGaRepairs(site)
  const tasks = useGaTasks(site)
  const supplies = useGaSupplies(site)

  const openRepairs = (repairs.data ?? []).filter((row) =>
    repairIsOpen(row.status),
  )
  const coming = (tasks.data ?? [])
    .filter((row) => {
      const due = dueOf(row.next_due)
      return (
        row.status !== "PAUSED" &&
        due.days !== null &&
        due.days <= SERVICING_HORIZON_DAYS
      )
    })
    .sort((a, b) => (a.next_due ?? "").localeCompare(b.next_due ?? ""))
  const overdue = coming.filter((row) => dueOf(row.next_due).tone === "bad")
  const onTheWay = (supplies.data ?? []).filter((row) =>
    supplyIsOpen(row.status),
  )

  return gaState(place, {
    loading: "Loading…",
    render: (hub) => {
      const floor = hub.assets.filter(
        (row) =>
          (PHYSICAL_BUILDS as readonly string[]).includes(row.build) &&
          (FLOOR_STATUSES as readonly string[]).includes(row.status),
      )
      const attention = floor.filter((row) => row.condition !== "BAIK")
      const ending = hub.contracts
        .filter(
          (row) =>
            contractNeedsLook(row) &&
            row.standing !== "DRAFT" &&
            row.standing !== "DIHENTIKAN",
        )
        .sort((a, b) => (a.days_to_end ?? 0) - (b.days_to_end ?? 0))

      return (
        <>
          <StatStrip>
            <StatLink
              to="/ga/assets"
              label="Assets here"
              value={count(floor.length)}
              sub={
                attention.length === 0
                  ? "All in good condition"
                  : `${count(attention.length)} need attention`
              }
              tone={attention.length > 0 ? "warn" : undefined}
            />
            <StatLink
              to="/ga/repairs"
              label="Open repairs"
              value={
                repairs.isError
                  ? "—"
                  : repairs.isPending
                    ? "…"
                    : count(openRepairs.length)
              }
              sub={
                repairs.isError
                  ? "Could not be read"
                  : openRepairs.length === 0
                    ? "Nothing waiting"
                    : `Oldest ${day(openRepairs[openRepairs.length - 1].failure_at)}`
              }
              tone={openRepairs.length > 0 ? "warn" : undefined}
            />
            <StatLink
              to="/ga/contracts"
              label="Contracts ending"
              value={count(ending.length)}
              sub={
                ending.length === 0
                  ? "None"
                  : `${contractTypeWords(ending[0].contract_type, ending[0].contract_type_name)} · ${standingOf(ending[0]).label.toLowerCase()}`
              }
              tone={ending.length > 0 ? "warn" : undefined}
            />
            <StatLink
              to="/ga/servicing"
              label={`Service due · ${SERVICING_HORIZON_DAYS} days`}
              value={
                tasks.isError
                  ? "—"
                  : tasks.isPending
                    ? "…"
                    : count(coming.length)
              }
              sub={
                tasks.isError
                  ? "Could not be read"
                  : overdue.length > 0
                    ? `${count(overdue.length)} overdue`
                    : coming.length === 0
                      ? "Nothing due"
                      : `Next ${day(coming[0].next_due)}`
              }
              tone={overdue.length > 0 ? "bad" : undefined}
            />
            <StatLink
              to="/ga/supplies"
              label="Supplies on the way"
              value={
                supplies.isError
                  ? "—"
                  : supplies.isPending
                    ? "…"
                    : count(onTheWay.length)
              }
              sub={
                supplies.isError
                  ? "Could not be read"
                  : onTheWay.length === 0
                    ? "None"
                    : `${count(onTheWay.filter((row) => row.status === "REQUESTED").length)} waiting for approval`
              }
            />
          </StatStrip>

          {/* `minmax(0, …)` on the one-column phone grid too: an `auto`
              track grows to its longest unbroken line, and a truncated
              address would push the whole column off a 375px screen. */}
          <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
            <PlaceCard hub={hub} />

            <div className="flex flex-col gap-4">
              <Attention
                title="Contracts ending soon"
                icon={CalendarClock}
                to="/ga/contracts"
                empty="None ending soon."
                rows={ending.slice(0, 4).map((row) => ({
                  key: row.contract_id,
                  top: contractTypeWords(
                    row.contract_type,
                    row.contract_type_name,
                  ),
                  under: partyOf(row),
                  end: (
                    <Pill tone={standingOf(row).tone}>
                      {standingOf(row).label}
                    </Pill>
                  ),
                }))}
              />
              <Attention
                title="Open repairs"
                icon={Hammer}
                to="/ga/repairs"
                problem={repairs.isError ? describeGa(repairs.error) : null}
                empty="Nothing to fix."
                rows={openRepairs.slice(0, 4).map((row) => ({
                  key: row.repair_id,
                  top: row.title,
                  under: `${row.asset_name ?? row.objek_name} · ${row.supplier_name}`,
                  end: (
                    <Pill tone={repairStageTone(row.status)}>
                      {repairStageWords(row.status)}
                    </Pill>
                  ),
                }))}
              />
              <Attention
                title="Coming up for service"
                icon={Wrench}
                to="/ga/servicing"
                problem={tasks.isError ? describeGa(tasks.error) : null}
                empty={`Nothing due in ${SERVICING_HORIZON_DAYS} days.`}
                rows={coming.slice(0, 4).map((row) => {
                  const due = dueOf(row.next_due)
                  return {
                    key: row.task_id,
                    top: row.title,
                    under: row.asset_name ?? "The shop",
                    end:
                      due.tone === "neutral" ? (
                        <span className="text-meta text-body tabular-nums">
                          {due.label}
                        </span>
                      ) : (
                        <Pill tone={due.tone}>{due.label}</Pill>
                      ),
                  }
                })}
              />
              <Attention
                title="Supplies on the way"
                icon={Package}
                to="/ga/supplies"
                problem={supplies.isError ? describeGa(supplies.error) : null}
                empty="Nothing outstanding."
                rows={onTheWay.slice(0, 4).map((row) => ({
                  key: row.request_id,
                  top: row.item,
                  under: supplyCategoryWords(
                    row.category_code,
                    row.category_name,
                  ),
                  end: (
                    <Pill tone={supplyStageTone(row.status)}>
                      {supplyStageWords(row.status)}
                    </Pill>
                  ),
                }))}
              />
            </div>
          </div>
        </>
      )
    },
  })
}

/// One figure that opens its screen — `Stat`, made a link.
function StatLink({
  to,
  ...stat
}: {
  to: string
  label: React.ReactNode
  value: React.ReactNode
  sub?: React.ReactNode
  tone?: "ok" | "warn" | "bad"
}) {
  return (
    <AppLink
      to={to}
      className="block h-full rounded-card transition-transform outline-none focus-visible:ring-[3px] focus-visible:ring-accent-bg active:scale-[0.99] [&>div]:transition-colors [&>div]:hover:border-hairline-2 [&>div]:hover:bg-soft/50"
    >
      <Stat {...stat} />
    </AppLink>
  )
}

/// The place itself: what head office keeps about the premises, who the
/// landlord is and until when, and what it is connected to.
///
/// The landlord is read off the running lease rather than kept on the place:
/// it is the party of the SEWA contract, and the lease is where it changes.
function PlaceCard({ hub }: { hub: GaLocationHub }) {
  const place = hub.location
  const running = (row: GaContractRow) =>
    row.standing !== "DRAFT" && row.standing !== "DIHENTIKAN"
  const leases = hub.contracts.filter(
    (row) =>
      running(row) &&
      row.site_id !== null &&
      (row.contract_type === "SEWA_TOKO" || row.contract_type === "SEWA_TANAH"),
  )
  const utilities = hub.utilities.filter(running)

  return (
    <Card>
      <div className="flex items-center gap-3 border-b border-hairline bg-soft px-4 py-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-inner border border-hairline-2 bg-canvas text-line-ico">
          <Boxes className="size-4 stroke-[1.7]" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-card-title font-semibold text-ink">
            {place.site_name}
          </h2>
          <p className="truncate text-meta text-mute">
            <span className="font-mono text-id">{place.site_id}</span>
            {place.kind !== null && ` · ${place.kind}`}
          </p>
        </div>
      </div>
      <div className="px-4 py-4">
        {place.version === 0 && (
          <p className="mb-4 text-meta text-mute">
            Not filled in yet.
          </p>
        )}
        <Facts>
          <Fact term="Address" wide>
            {place.address ?? "—"}
          </Fact>
          <Fact term="Floor area">
            {place.floor_area_sqm === null
              ? "—"
              : `${count(place.floor_area_sqm)} m²`}
          </Fact>
          <Fact term="Contact" wide>
            {[place.contact_name, place.contact_phone]
              .filter(Boolean)
              .join(" · ") || "—"}
          </Fact>
          {leases.length === 0 ? (
            <Fact term="Landlord">No lease on record</Fact>
          ) : (
            leases.map((lease) => (
              <Fact
                key={lease.contract_id}
                term={
                  lease.contract_type === "SEWA_TANAH"
                    ? "Land leased from"
                    : "Landlord"
                }
                wide
              >
                {partyOf(lease)}
                <span className="text-body">
                  {lease.ends_on === null
                    ? " · no end date"
                    : ` · until ${day(lease.ends_on)} (${leaseLeft(lease.ends_on)})`}
                </span>
              </Fact>
            ))
          )}
          {place.notes !== null && place.notes.trim() !== "" && (
            <Fact term="Notes" wide>
              {place.notes}
            </Fact>
          )}
        </Facts>

        <h3 className="mt-5 mb-1 text-card-title font-semibold text-ink">
          Utilities
        </h3>
        {utilities.length === 0 ? (
          <p className="text-meta text-mute">
            No utilities on record.
          </p>
        ) : (
          <ul>
            {utilities.map((row) => (
              <li
                key={row.contract_id}
                className="flex items-center justify-between gap-3 border-b border-hairline py-2.5 last:border-b-0"
              >
                <span className="min-w-0">
                  <span className="block truncate text-cell font-medium text-ink">
                    {contractTypeWords(
                      row.contract_type,
                      row.contract_type_name,
                    )}
                  </span>
                  <span className="block truncate text-meta text-mute">
                    {partyOf(row)}
                    {row.customer_number !== null && (
                      <span className="font-mono">
                        {" "}
                        · {row.customer_number}
                      </span>
                    )}
                  </span>
                </span>
                <span className="shrink-0 text-right text-meta text-body tabular-nums">
                  {row.last_usage === null
                    ? "No reading yet"
                    : `${count(row.last_usage)} ${row.last_unit ?? ""}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  )
}

function leaseLeft(endsOn: string): string {
  const days = daysUntil(endsOn)
  if (days < 0) return "ended"
  if (days < 60) return `${count(days)} days left`
  return `${count(Math.round(days / 30))} months left`
}

/// One of the four things worth a look, with its first few rows and a way
/// to the rest. An empty card still stands, and says it is empty: on this
/// page "nothing open" is the news.
function Attention({
  title,
  icon: Icon,
  to,
  rows,
  empty,
  problem = null,
}: {
  title: string
  icon: LucideIcon
  to: string
  rows: readonly {
    key: string
    top: React.ReactNode
    under: React.ReactNode
    end: React.ReactNode
  }[]
  empty: string
  problem?: string | null
}) {
  return (
    <Card>
      <AppLink
        to={to}
        className="flex min-h-11 items-center gap-3 border-b border-hairline px-3.5 py-2.5 transition-colors hover:bg-soft pointer-coarse:min-h-tap"
      >
        <span className="grid size-7 shrink-0 place-items-center rounded-inner bg-soft text-line-ico">
          <Icon className="size-4 stroke-[1.7]" aria-hidden />
        </span>
        <span className="min-w-0 flex-1 text-card-title font-semibold text-ink">
          {title}
        </span>
        <span className="flex items-center gap-1 text-meta font-medium text-accent">
          See all
          <ChevronRight className="size-4" />
        </span>
      </AppLink>
      {problem !== null ? (
        <p className="px-3.5 py-3 text-meta text-bad">{problem}</p>
      ) : rows.length === 0 ? (
        <p className="px-3.5 py-3 text-meta text-mute">{empty}</p>
      ) : (
        <ul>
          {rows.map((row) => (
            <li
              key={row.key}
              className="flex items-center gap-3 border-b border-hairline px-3.5 py-2.5 last:border-b-0"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-cell font-medium text-ink">
                  {row.top}
                </span>
                <span className="block truncate text-meta text-mute">
                  {row.under}
                </span>
              </span>
              <span className="shrink-0">{row.end}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
