import { useQuery } from "@tanstack/react-query"
import { ListFilter, Plus } from "lucide-react"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/field"
import { ChoiceMenu } from "@/components/ui/list-chrome"
import { PageHeader } from "@/components/ui/page-header"
import { Toolbar } from "@/components/ui/segmented"
import { EmptyState } from "@/components/ui/states"
import { count, money } from "@/lib/format"
import { gaKeys, gaLocations } from "@/lib/queries/ga"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"
import { FinanceMark } from "@/screens/contracts/parts"
import { LocationHubSheet } from "@/screens/locations/hub"
import { OpenStoresSheet } from "@/screens/setup/open-stores-sheet"
import type { GaLocationRow } from "@itulah/contract"

/// Locations — the places the company operates from, as facilities rather than
/// as an accounting dimension.
///
/// # A list of PLACES, not of the details that happen to exist
///
/// `site` is the company's own list; GA adds a second, one-to-one side to it
/// (`ga_location_detail`). The server LEFT JOINs the two, so a site nobody has
/// written an address for still appears, with "—" in the address column and
/// one action — Complete — in its sheet. Hiding it would make this a list of
/// the details that exist, which is exactly the list that cannot answer "what
/// have we not filled in yet".
///
/// # Open store, and no "Tambah site"
///
/// A place is made by a store or the warehouse being opened, not by GA
/// writing a row here, and adding a second head office is the owner's decision
/// (brief §2.5). So the one way to add a place is Open store — the same list
/// and the same write as the setup wizard's second step, which makes the unit,
/// its shop site and its pools together (`screens/setup/open-stores-sheet.tsx`).
/// Everything else written here is the facilities detail BESIDE a place that
/// already exists — the address, the kind, the floor area, who to ring.
///
/// # The counts are read back, not copied
///
/// Assets, contracts and open repairs are not columns on the site; they are
/// rows elsewhere that point at it, and the server counts them there. Finance's
/// tagihan rides the same way and wears the Finance mark, because the posted
/// bills behind it are the other desk's ledger (brief §2.1, §10.2).
export function Locations() {
  const open = useSheet("location")
  const opening = useSheet("new-stores")
  const [search, setSearch] = useState("")
  const [kind, setKind] = useState<string | null>(null)

  const scope = useMemo(
    () => ({ q: search.trim() === "" ? undefined : search.trim() }),
    [search]
  )

  const places = useQuery({
    queryKey: gaKeys.locations(scope),
    queryFn: ({ signal }) => gaLocations(scope, signal),
  })

  const rows = places.data ?? []
  // `kind` is a free-text facility type on the server, so the choices are the
  // kinds actually in use rather than a closed list this screen would have to
  // keep in step with the data. Sorting them keeps the menu stable as rows
  // arrive. Keyed on the query's own array so the list identity does not
  // re-create the menu on every render.
  const kinds = useMemo(() => {
    const seen = new Set<string>()
    for (const row of places.data ?? []) {
      const value = row.kind ?? row.site_kind
      if (value !== "") seen.add(value)
    }
    return [...seen].sort((a, b) => a.localeCompare(b))
  }, [places.data])

  const shown =
    kind === null
      ? rows
      : rows.filter((row) => (row.kind ?? row.site_kind) === kind)

  return (
    <PageContent>
      <PageHeader
        crumb="GA"
        title="Locations"
        sub="View assets, contracts, service schedules, supply requests and bills for each place."
        actions={
          <>
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Name or location code"
              className="h-8 w-56"
            />
            <Button variant="primary" onClick={() => opening.open(true)}>
              <Plus />
              Open store
            </Button>
          </>
        }
      />

      <Toolbar>
        <ChoiceMenu
          heading="Type"
          icon={ListFilter}
          value={kind}
          options={[
            { value: null, label: "All types" },
            ...kinds.map((one) => ({ value: one, label: one })),
          ]}
          onChange={setKind}
        />
        <Toolbar.Spacer />
        {places.data !== undefined && (
          <span className="text-meta text-body">
            <b className="font-medium text-ink">{count(shown.length)}</b>{" "}
            {shown.length === 1 ? "place" : "places"}
          </span>
        )}
      </Toolbar>

      {queryState(places, {
        loading: "Opening the list of places…",
        render: () =>
          shown.length === 0 ? (
            <Card>
              <EmptyState>
                {kind === null
                  ? "No locations yet. Offices and warehouses are created during setup; stores are opened with Open store."
                  : "No places of that type."}
              </EmptyState>
            </Card>
          ) : (
            <Card className="overflow-hidden">
              {/* The list scrolls INSIDE its own box rather than squashing the
                  columns: eight columns of places, contacts and figures do not
                  fit a phone, and a squeezed table overlaps its own cells while
                  the page starts scrolling sideways. */}
              <div className="overflow-x-auto">
                <div className="md:min-w-[74rem]">
                  <div className="grid h-10 items-center gap-3 border-b border-hairline bg-soft px-3.5 text-eyebrow font-medium text-body max-md:hidden md:grid-cols-[minmax(14rem,1.4fr)_8.5rem_minmax(13rem,1fr)_11rem_5.5rem_5.5rem_7.5rem_9rem]">
                    <span>Location</span>
                    <span>Type</span>
                    <span>Address</span>
                    <span>Contact</span>
                    <span className="text-right">Assets</span>
                    <span className="text-right">Contracts</span>
                    <span className="text-right">Open repairs</span>
                    <span className="text-right">
                      Billed this month{" "}
                      <FinanceMark className="ml-1 align-[0.0625rem]" />
                    </span>
                  </div>
                  {shown.map((row) => (
                    <LocationLine
                      key={row.site_id}
                      row={row}
                      onOpen={() => open.open(row.site_id)}
                    />
                  ))}
                </div>
              </div>
            </Card>
          ),
      })}

      <OpenStoresSheet open={opening.isOpen} onClose={opening.close} />

      <LocationHubSheet
        key={open.value ?? "none"}
        siteId={open.value}
        open={open.isOpen}
        onClose={open.close}
      />
    </PageContent>
  )
}

/// One place. The name leads and the code rides under it in mono, because
/// people know the shop by what it is called and check the code when two shops
/// share a name.
function LocationLine({
  row,
  onOpen,
}: {
  row: GaLocationRow
  onOpen: () => void
}) {
  return (
    <div
      onClick={onOpen}
      // A row on a desk, a card on a phone: the name across the top, what
      // and where under it, and the four figures in a row of their own with
      // their names — eight columns do not fit 343px, and the list used to
      // scroll sideways inside its card to be read.
      className="grid cursor-pointer grid-cols-4 items-center gap-x-3 gap-y-1.5 border-b border-hairline px-3.5 py-3 transition-colors last:border-b-0 hover:bg-soft active:bg-soft md:grid-cols-[minmax(14rem,1.4fr)_8.5rem_minmax(13rem,1fr)_11rem_5.5rem_5.5rem_7.5rem_9rem] md:gap-3 md:py-2.5"
    >
      <div className="col-span-4 min-w-0 md:col-span-1">
        <span className="block truncate text-cell font-medium text-ink">
          {row.site_name}
        </span>
        <span className="block truncate font-mono text-pill text-mute">
          {row.site_id}
        </span>
      </div>
      <span className="col-span-4 min-w-0 truncate text-meta text-body md:col-span-1">
        {row.kind ?? row.site_kind}
      </span>
      <span className="col-span-4 min-w-0 truncate text-meta text-body md:col-span-1">
        {row.address ?? "—"}
      </span>
      <span className="col-span-4 min-w-0 truncate text-meta text-body md:col-span-1">
        {row.contact_name ?? "—"}
        {row.contact_phone !== null && (
          <span className="block truncate font-mono text-pill text-mute">
            {row.contact_phone}
          </span>
        )}
      </span>
      <span className="mt-1 text-meta text-body tabular-nums md:mt-0 md:text-right">
        <Figure>Assets</Figure>
        {count(row.asset_count)}
      </span>
      <span className="mt-1 text-meta text-body tabular-nums md:mt-0 md:text-right">
        <Figure>Contracts</Figure>
        {count(row.contract_count)}
      </span>
      <span className="mt-1 text-meta tabular-nums md:mt-0 md:text-right">
        <Figure>Repairs</Figure>
        <span
          className={row.open_repair_count > 0 ? "text-warn-fg" : "text-body"}
        >
          {count(row.open_repair_count)}
        </span>
      </span>
      <span className="mt-1 min-w-0 truncate text-meta text-body tabular-nums md:mt-0 md:text-right">
        <Figure>Billed</Figure>
        {money(row.billed_this_month_minor)}
      </span>
    </div>
  )
}

/// A figure's name above it on a phone, where the header row is not drawn.
function Figure({ children }: { children: React.ReactNode }) {
  return (
    <span className="block text-[0.875rem] text-mute md:hidden">
      {children}
    </span>
  )
}
