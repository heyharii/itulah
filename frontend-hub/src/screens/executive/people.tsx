import { useQueries, useQuery } from "@tanstack/react-query"
import { useMemo } from "react"

import { Card } from "@/components/ui/card"
import { MiniCell, MiniRow, MiniTable } from "@/components/ui/rows"
import { EmptyState } from "@/components/ui/states"
import { count, day, money } from "@/lib/format"
import { gaContracts, gaKeys, gaLocations } from "@/lib/queries/ga"
import {
  expiringContracts,
  listWorkforce,
  peopleKeys,
} from "@/lib/queries/people"
import { queryState } from "@/lib/query-state"
import { rupiah } from "@/screens/executive/format"
import { Figure, Figures, Head, ReportPage } from "@/screens/executive/parts"
import { usePlaces } from "@/screens/executive/places"
import { useReportScope } from "@/screens/executive/scope"

/// Tim & aset — how many people each place has, what is broken, what is due
/// for upkeep, and which agreements run out in the next thirty days.

const SOON = 30

/// Active people at one place — `total` of a one-row page, so the count is the
/// server's and not the length of whatever page came back.
const ACTIVE = (placeId?: string) =>
  ({ status: "ACTIVE", placeId, limit: 1 }) as const

export function ExecutivePeople() {
  const scope = useReportScope()
  const { nameOf } = usePlaces(scope)

  const locations = useQuery({
    queryKey: gaKeys.locations({}),
    queryFn: ({ signal }) => gaLocations({}, signal),
    retry: false,
  })
  const headcount = useQuery({
    queryKey: peopleKeys.employees(ACTIVE(scope.store)),
    queryFn: ({ signal }) => listWorkforce(ACTIVE(scope.store), signal),
  })
  const places = useMemo(
    () => (locations.data ?? []).map((row) => row.site_id),
    [locations.data]
  )
  const perPlace = useQueries({
    queries: places.map((placeId) => ({
      queryKey: peopleKeys.employees(ACTIVE(placeId)),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        listWorkforce(ACTIVE(placeId), signal),
    })),
  })
  const expiring = useQuery({
    queryKey: peopleKeys.expiring(SOON),
    queryFn: ({ signal }) => expiringContracts({ withinDays: SOON }, signal),
  })
  const agreements = useQuery({
    queryKey: [...gaKeys.contracts({ archived: false }), "executive"] as const,
    queryFn: ({ signal }) =>
      gaContracts({ archived: false, limit: 1000 }, signal),
    retry: false,
  })

  const here = <
    T extends { site_id?: string | null; place_id?: string | null },
  >(
    row: T
  ) =>
    scope.store === undefined ||
    (row.site_id ?? row.place_id ?? null) === scope.store

  const rows = (locations.data ?? []).filter(here)
  const repairs = rows.reduce((sum, row) => sum + row.open_repair_count, 0)
  const people = (expiring.data ?? []).filter(here)
  const deals = (agreements.data?.rows ?? [])
    .filter(
      (row) =>
        row.days_to_end !== null &&
        row.days_to_end >= 0 &&
        row.days_to_end <= SOON &&
        here(row)
    )
    .sort((a, b) => (a.days_to_end ?? 0) - (b.days_to_end ?? 0))

  const heads = new Map(
    places.map((placeId, index) => [placeId, perPlace[index]?.data?.total])
  )

  return (
    <ReportPage title="Tim & aset" scope={scope}>
      <Figures>
        <Figure
          label="Karyawan aktif"
          value={headcount.data ? count(headcount.data.total) : "…"}
        />
        <Figure
          label="Kontrak karyawan berakhir"
          value={expiring.data ? count(people.length) : "…"}
          note={`Dalam ${SOON} hari`}
        />
        <Figure
          label="Perbaikan terbuka"
          value={locations.data ? count(repairs) : "—"}
          note={
            locations.data
              ? `${count(rows.reduce((sum, row) => sum + row.due_task_count, 0))} perawatan jatuh tempo`
              : undefined
          }
        />
        <Figure
          label="Kontrak GA berakhir"
          value={agreements.data ? count(deals.length) : "—"}
          note={`Dalam ${SOON} hari`}
        />
      </Figures>

      <Card className="mb-3 overflow-hidden">
        <Head title="Per lokasi" to="/maintenance" link="Buka perbaikan" />
        <div className="overflow-x-auto px-[1.125rem] pb-3">
          {queryState(locations, {
            loading: "Membaca lokasi…",
            render: () =>
              rows.length === 0 ? (
                <EmptyState>Belum ada lokasi yang terdaftar.</EmptyState>
              ) : (
                <MiniTable
                  head={[
                    "Lokasi",
                    "Karyawan aktif",
                    "Perbaikan terbuka",
                    "Perawatan jatuh tempo",
                    "Tagihan bulan ini",
                  ]}
                  style={{ minWidth: "38rem" }}
                >
                  {rows.map((row) => (
                    <MiniRow key={row.site_id}>
                      <MiniCell className="font-medium text-ink">
                        {row.site_name || nameOf(row.site_id)}
                      </MiniCell>
                      <MiniCell align="right">
                        {count(heads.get(row.site_id))}
                      </MiniCell>
                      <MiniCell align="right">
                        {row.open_repair_count === 0 ? (
                          <span className="text-mute">—</span>
                        ) : (
                          count(row.open_repair_count)
                        )}
                      </MiniCell>
                      <MiniCell align="right">
                        {row.due_task_count === 0 ? (
                          <span className="text-mute">—</span>
                        ) : (
                          count(row.due_task_count)
                        )}
                      </MiniCell>
                      <MiniCell align="right">
                        <span title={money(row.billed_this_month_minor)}>
                          {rupiah(row.billed_this_month_minor)}
                        </span>
                      </MiniCell>
                    </MiniRow>
                  ))}
                </MiniTable>
              ),
          })}
        </div>
      </Card>

      <div className="grid gap-3 xl:grid-cols-2">
        <Card className="overflow-hidden">
          <Head title="Kontrak karyawan berakhir" to="/people" link="Buka HR" />
          <div className="overflow-x-auto px-[1.125rem] pb-3">
            {queryState(expiring, {
              loading: "Membaca kontrak…",
              render: () =>
                people.length === 0 ? (
                  <EmptyState>
                    Tidak ada kontrak yang berakhir {SOON} hari ke depan.
                  </EmptyState>
                ) : (
                  <MiniTable
                    head={["Karyawan", "Lokasi", "Berakhir", "Sisa"]}
                    style={{ minWidth: "26rem" }}
                  >
                    {people.map((row) => (
                      <MiniRow key={row.employee_id}>
                        <MiniCell>
                          <span className="block font-medium text-ink">
                            {row.full_name ?? row.employee_code}
                          </span>
                          <span className="block text-[0.875rem] text-mute">
                            {row.position}
                          </span>
                        </MiniCell>
                        <MiniCell align="right">
                          {row.place_id === null ? "—" : nameOf(row.place_id)}
                        </MiniCell>
                        <MiniCell align="right">{day(row.ends_on)}</MiniCell>
                        <MiniCell align="right">
                          {row.days_remaining} hari
                        </MiniCell>
                      </MiniRow>
                    ))}
                  </MiniTable>
                ),
            })}
          </div>
        </Card>

        <Card className="overflow-hidden">
          <Head
            title="Kontrak GA berakhir"
            to="/contracts"
            link="Buka kontrak"
          />
          <div className="overflow-x-auto px-[1.125rem] pb-3">
            {queryState(agreements, {
              loading: "Membaca kontrak…",
              render: () =>
                deals.length === 0 ? (
                  <EmptyState>
                    Tidak ada kontrak yang berakhir {SOON} hari ke depan.
                  </EmptyState>
                ) : (
                  <MiniTable
                    head={["Kontrak", "Lokasi", "Berakhir", "Sisa"]}
                    style={{ minWidth: "26rem" }}
                  >
                    {deals.map((row) => (
                      <MiniRow key={row.contract_id}>
                        <MiniCell>
                          <span className="block font-medium text-ink">
                            {row.objek_name ?? row.contract_type_name}
                          </span>
                          <span className="block text-[0.875rem] text-mute">
                            {row.counterparty_name ?? row.supplier_name ?? "—"}
                          </span>
                        </MiniCell>
                        <MiniCell align="right">
                          {row.site_id === null ? "Semua" : nameOf(row.site_id)}
                        </MiniCell>
                        <MiniCell align="right">{day(row.ends_on)}</MiniCell>
                        <MiniCell align="right">
                          {row.days_to_end} hari
                        </MiniCell>
                      </MiniRow>
                    ))}
                  </MiniTable>
                ),
            })}
          </div>
        </Card>
      </div>
    </ReportPage>
  )
}
