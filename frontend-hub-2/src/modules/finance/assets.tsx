import { useQuery } from "@tanstack/react-query"
import { Archive, Boxes } from "lucide-react"
import type {
  AcquisitionGap,
  AssetRow,
  AssetSchedule,
  LedgerAccount,
} from "@itulah/contract"
import type { ColumnDef } from "@tanstack/react-table"

import { api, search } from "@/lib/api"
import { Button } from "@/kit/button"
import { PageHead, Toolbar } from "@/kit/page"
import { ScopeLine } from "@/kit/scope"
import { SearchField } from "@/kit/field"
import { Sheet } from "@/kit/sheet"
import { Table } from "@/kit/table"
import { Tag } from "@/kit/tag"
import { Tile, Tiles } from "@/kit/tiles"
import { Truncated } from "@/kit/notice"
import { Empty, Failed, Loading, NoMatch } from "@/kit/state"
import { amount, count, day, rp, today } from "@/lib/format"
import { useBoundedList } from "@/lib/list"
import { useQueryState } from "@/lib/query-state"
import { useDebounced } from "@/lib/use-debounced"
import type { TableSetup } from "@/lib/table"
import { monthOf } from "@/modules/finance/chart"
import {
  CheckField,
  Facts,
  PickField,
  SiteName,
  SitePicker,
} from "@/modules/finance/parts"

/// The asset register — what the business owns, and what Finance decided about
/// it.
///
/// ## Why "not assessed" is a state and not a blank
///
/// Operations registers an asset's identity; Finance appends an assessment, and
/// the newest one is in force. An asset nobody has assessed is an **open control
/// gap**; one assessed and expensed is a closed one. A screen that drew both as
/// an empty cell would hide the first behind the second, which is exactly the
/// gap this register exists to surface.
///
/// ## Why no figure on this page is a total
///
/// `GET /finance/assets` answers with a **bare array** clamped at 500: no
/// cursor, no total, no server-side sums. So there is no honest "register value"
/// to draw, and this screen draws none — the money columns have no summary line,
/// and the two money figures in the tiles are the SERVER's, from
/// `GET /finance/assets/unbacked`, which does add up what it returns.
///
/// What the books say fixed assets are worth is a different question with a
/// different answer, and it is answered where balances live: the trial balance
/// and the balance sheet. Drawing a browser-summed register value beside them
/// would put two figures for one thing on two screens, computed two ways.
///
/// ## Why the search box filters what was fetched
///
/// This endpoint takes `site`, `category` and `unassessed` and no `q`. All three
/// of those go on the wire. The box narrows the rows that came back, which is
/// honest only because the strip above the table says when the answer was cut
/// off — and a fixed asset register is hundreds of rows, not hundreds of
/// thousands. `journal.tsx` refuses the same box for the opposite reason: its
/// cap is 200 and its population is the whole ledger.
///
/// ## What is not here
///
/// Registering, assessing, disposing and transferring — four multi-field forms
/// in the app this replaces. They need a form library this app does not have and
/// will not gain for one screen. The monthly depreciation run is on **Period
/// close**, against the month being closed, which is the only month it is ever
/// meant to charge.

/// The server's clamp on this endpoint — `limit.unwrap_or(500)`, and the query
/// has no cap of its own beyond it.
const CAP = 500

/// The families the client keeps their assets under, read from their own chart.
///
/// `10215 FIXED ASSET` and its seven children are the register's categories —
/// so the select is the chart, not a list copied out of it. A hard-coded list
/// would be wrong the day they add a family, and wrong silently: the register
/// would keep filing assets under a code the select could not offer.
function useCategories() {
  const query = useQuery({
    queryKey: ["finance", "accounts", "children", "10215", false] as const,
    queryFn: ({ signal }) =>
      api.get<LedgerAccount[]>(
        `/api/v1/finance/accounts${search({ parent: "10215" })}`,
        signal,
      ),
    staleTime: 10 * 60 * 1000,
  })
  return query.data ?? []
}

/// Which treatment is in force, including the one that ends the story.
///
/// Four states and not three: `decision` says what Finance decided, and
/// `disposed_on` says the thing has gone. A disposed asset keeps its decision —
/// it was capitalised right up until it left — so drawing only the decision
/// would show a sold van as an ordinary capitalised one for ever.
function Treatment({ asset }: { asset: AssetRow }) {
  if (asset.disposed_on !== null) return <Tag>Disposed</Tag>
  if (asset.decision === null) return <Tag tone="warn">Not assessed</Tag>
  if (asset.decision === "CAPITALIZE") return <Tag tone="ok">Capitalised</Tag>
  return <Tag>Expensed</Tag>
}

export function AssetsScreen() {
  const url = useQueryState()
  const typed = url.one("q")
  const site = url.one("site")
  const category = url.one("category")
  const unassessed = url.one("unassessed") === "1"
  const openId = url.one("asset")
  const q = useDebounced(typed.trim().toLowerCase(), 200)

  const categories = useCategories()

  const list = useBoundedList<AssetRow>({
    key: ["finance", "assets"],
    path: "/api/v1/finance/assets",
    params: {
      site: site || null,
      category: category || null,
      unassessed: unassessed ? "true" : null,
    },
    limit: CAP,
  })

  // The exception report, and the only two money figures on this page that a
  // server added up. Two lists rather than one number because they are
  // different faults with different fixes: an unbacked asset needs the bill
  // line that paid for it found; an unclaimed line needs the thing put on the
  // register.
  const gap = useQuery({
    queryKey: ["finance", "assets", "unbacked"] as const,
    queryFn: ({ signal }) =>
      api.get<AcquisitionGap>("/api/v1/finance/assets/unbacked", signal),
  })

  const rows =
    q === ""
      ? list.rows
      : list.rows.filter((asset) =>
          `${asset.asset_number} ${asset.name} ${asset.category_name}`
            .toLowerCase()
            .includes(q),
        )

  const notAssessed = list.rows.filter(
    (asset) => asset.decision === null && asset.disposed_on === null,
  ).length

  const columns: ColumnDef<TableSetup, AssetRow>[] = [
    {
      id: "asset",
      header: "Asset",
      size: 24,
      // No priority: the number and the name are what the row IS.
      meta: { icon: <Archive className="size-[15px]" />, min: 220 },
      cell: ({ row }) => (
        <>
          <span className="text-ink block truncate font-medium">
            {row.original.name}
          </span>
          <span className="text-label text-ink-4 flex items-center gap-1.5">
            <span className="font-mono">{row.original.asset_number}</span>
            {row.original.quantity !== 1 && (
              // One row is not always one object: the client's register keeps
              // lots, and 60,000 sensor pins are one row rather than 60,000.
              <span>· {count(row.original.quantity)} of them</span>
            )}
          </span>
        </>
      ),
    },
    {
      id: "category",
      header: "Category",
      size: 15,
      meta: { priority: 4, min: 150 },
      cell: ({ row }) => (
        <span className="text-ink-3 truncate">
          {row.original.category_name}
        </span>
      ),
    },
    {
      id: "site",
      header: "Unit",
      size: 10,
      meta: { priority: 3, min: 110 },
      cell: ({ row }) => (
        <span className="text-ink-3 truncate">
          <SiteName id={row.original.site_id} />
        </span>
      ),
    },
    {
      id: "treatment",
      header: "Treatment",
      size: 13,
      // Never dropped. It is the control state this register exists to show.
      meta: { min: 140 },
      cell: ({ row }) => <Treatment asset={row.original} />,
    },
    {
      id: "acquired",
      header: "Bought via",
      size: 14,
      meta: { priority: 5, min: 150 },
      // Absent is the ORDINARY state for a thing the company already owned when
      // this system arrived — and an EXCEPTION for one capitalised here, because
      // the only way a cost gets into the books is a bill. So the same empty
      // cell is a dash on an expensed asset and a warning on a capitalised one.
      cell: ({ row }) => {
        const asset = row.original
        if (asset.acquired_via !== null) {
          return (
            <span className="text-label text-ink-3 block truncate font-mono">
              {asset.acquired_via}
            </span>
          )
        }
        if (asset.decision === "CAPITALIZE") {
          return <Tag tone="warn">not in the books</Tag>
        }
        return <span className="text-ink-4">—</span>
      },
    },
    {
      id: "charged",
      header: "Charged through",
      size: 13,
      meta: { priority: 2, min: 140 },
      // Absent means nothing has ever been charged, which is a real state and
      // not a zero: land never charges, an asset capitalised last week has not
      // been reached yet, and one the run has been silently skipping for four
      // months looks exactly like both until this says so.
      cell: ({ row }) =>
        row.original.last_depreciated_month === null ? (
          <span
            className="text-ink-4"
            title="Nothing has ever been charged against this asset. Land never charges; a new one has not been reached yet; a skipped one looks the same until the schedule is opened."
          >
            —
          </span>
        ) : (
          <span className="text-ink-3">
            {monthOf(row.original.last_depreciated_month)}
          </span>
        ),
    },
    {
      id: "cost",
      header: "Cost",
      size: 11,
      meta: { align: "right", priority: 1, min: 120 },
      cell: ({ row }) => (
        <span className="text-ink-3 tabular-nums">
          {row.original.capitalized_cost_minor === null
            ? "—"
            : amount(row.original.capitalized_cost_minor)}
        </span>
      ),
    },
    {
      id: "book",
      header: "Book value",
      size: 13,
      meta: { align: "right", min: 130 },
      cell: ({ row }) => (
        <span className="text-ink font-medium tabular-nums">
          {row.original.book_value_minor === null
            ? "—"
            : amount(row.original.book_value_minor)}
        </span>
      ),
    },
  ]

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHead
        module="Payables &amp; Expenses"
        title="Assets"
        description="What the business owns, what Finance decided about it, and whether the books ever paid for it."
      />

      {/* `as at` rather than `during`: cost, accumulated depreciation and book
          value are positions. The date is not a control here because this
          endpoint takes none — every figure is as the register stands now. */}
      <ScopeLine
        scope={{ kind: "asAt", date: today() }}
        unit={site || undefined}
        note="the register, not the ledger"
      />

      <Tiles>
        <Tile
          label="Registered"
          value={count(list.rows.length)}
          note="on this list — the endpoint returns no total"
        />
        <Tile
          label="Not assessed"
          value={count(notAssessed)}
          tone={notAssessed > 0 ? "warn" : "ok"}
          note={
            notAssessed === 0
              ? "every one has a decision"
              : "nobody has said capitalise or expense"
          }
          onClick={() => url.set({ unassessed: unassessed ? null : "1" }, false)}
        />
        {/* Both figures below are the SERVER's, added up in `acquisition_gap`
            over every row it returns — not over what is on this screen. */}
        <Tile
          label="Never bought"
          value={gap.data?.assets_total_minor ?? 0}
          tone={(gap.data?.assets_total_minor ?? 0) > 0 ? "bad" : "ok"}
          note={
            gap.data === undefined
              ? "checking"
              : `${count(gap.data.assets_without_a_line.length)} capitalised with no bill line behind them`
          }
        />
        <Tile
          label="Never registered"
          value={gap.data?.lines_total_minor ?? 0}
          tone={(gap.data?.lines_total_minor ?? 0) > 0 ? "warn" : "ok"}
          note={
            gap.data === undefined
              ? "checking"
              : `${count(gap.data.lines_without_an_asset.length)} capital bill lines with nothing on the register`
          }
        />
      </Tiles>

      <Toolbar
        trailing={
          list.query.isPending
            ? "Loading…"
            : `${count(rows.length)} of ${count(list.rows.length)} on screen`
        }
      >
        <SearchField
          value={typed}
          onChange={(value) => url.set({ q: value || null })}
          placeholder="Search a number, a name or a category"
          className="w-[20rem]"
        />
        <SitePicker
          value={site}
          onChange={(value) => url.set({ site: value || null }, false)}
        />
        <PickField
          label="Category"
          icon={<Boxes className="text-ink-4 size-4 shrink-0" />}
          value={category}
          onChange={(value) => url.set({ category: value || null }, false)}
        >
          <option value="">Every category</option>
          {categories.map((family) => (
            <option key={family.account_code} value={family.account_code}>
              {family.name}
            </option>
          ))}
        </PickField>
        <CheckField
          label="Only unassessed"
          checked={unassessed}
          onChange={(next) => url.set({ unassessed: next ? "1" : null }, false)}
        />
      </Toolbar>

      {list.truncated && <Truncated limit={CAP} noun="assets" />}

      {list.query.isError ? (
        <Failed
          what="the asset register"
          error={list.query.error}
          onRetry={() => void list.query.refetch()}
        />
      ) : list.query.isPending ? (
        <Loading cols={8} />
      ) : list.rows.length === 0 ? (
        <Empty
          what="assets"
          detail="Nothing is on the register under this unit, category and state."
        />
      ) : rows.length === 0 ? (
        <NoMatch
          what="assets"
          held={list.rows.length}
          onClear={() => url.set({ q: null }, false)}
        />
      ) : (
        <Table
          columns={columns}
          rows={rows as AssetRow[]}
          rowId={(row) => row.asset_id}
          caption="Fixed asset register"
          onRowClick={(row) =>
            url.set(
              { asset: row.asset_id === openId ? null : row.asset_id },
              false,
            )
          }
          isOpen={(row) => row.asset_id === openId}
          foot={{
            asset: (
              <>
                <b className="text-ink">{count(rows.length)}</b> assets on
                screen
              </>
            ),
            // No sums under the money columns, and that is the point. This
            // endpoint returns no totals, so anything drawn here would be the
            // browser's arithmetic over whatever happened to be fetched —
            // presented in the one place on the page a reader is entitled to
            // read as authoritative. What the books say is on the trial
            // balance.
            book: (
              <span
                className="text-ink-4"
                title="This endpoint answers with a bare array and no totals, so there is no register value the server has computed. The books' figure for fixed assets is on the trial balance and the balance sheet."
              >
                not totalled here
              </span>
            ),
          }}
        />
      )}

      <AssetSheet
        id={openId}
        loaded={list.rows.find((row) => row.asset_id === openId)}
        onClose={() => url.set({ asset: null }, false)}
      />
    </div>
  )
}

/// One asset, and what has actually been charged against it.
///
/// The schedule is its own read because it is the one thing the register row
/// cannot carry: `AssetRow` has an accumulated total and the last month
/// charged, and neither says which months were reached. A run that has been
/// skipping one asset for four months is invisible in the total and obvious in
/// the list.
function AssetSheet({
  id,
  loaded,
  onClose,
}: {
  id: string
  loaded: AssetRow | undefined
  onClose: () => void
}) {
  const schedule = useQuery({
    queryKey: ["finance", "assets", "schedule", id] as const,
    enabled: id !== "",
    queryFn: ({ signal }) =>
      api.get<AssetSchedule>(`/api/v1/finance/assets/${id}/schedule`, signal),
  })

  if (id === "") return null
  const plan = schedule.data

  return (
    <Sheet
      open
      onClose={onClose}
      width="record"
      title={loaded?.name ?? plan?.name ?? "Asset"}
      subtitle={
        <span className="font-mono">
          {loaded?.asset_number ?? plan?.asset_number ?? id}
        </span>
      }
      foot={
        <>
          <span className="text-label text-ink-4 flex-1">
            Assessing, disposing and transferring are not in this app yet.
          </span>
          <Button onClick={onClose}>Close</Button>
        </>
      }
    >
      {schedule.isError ? (
        <Failed
          what="this asset's schedule"
          error={schedule.error}
          onRetry={() => void schedule.refetch()}
        />
      ) : plan === undefined ? (
        <Loading rows={5} cols={3} />
      ) : (
        <div className="flex flex-col gap-5 p-[18px]">
          {loaded && (
            <div className="flex flex-wrap gap-1.5">
              <Treatment asset={loaded} />
              {loaded.acquired_via === null &&
                loaded.decision === "CAPITALIZE" && (
                  <Tag tone="bad">no bill line behind it</Tag>
                )}
            </div>
          )}

          <Facts
            rows={[
              loaded ? ["Category", loaded.category_name] : null,
              loaded
                ? ["Unit", <SiteName key="u" id={loaded.site_id} />]
                : null,
              loaded ? ["Acquired", day(loaded.acquired_on)] : null,
              ["In service", day(plan.in_service_on)],
              [
                "Treatment",
                plan.decision === null ? "Not assessed" : plan.decision,
              ],
              ["Method", plan.method ?? "—"],
              ["Cost", rp(plan.capitalized_cost_minor)],
              ["Salvage value", rp(plan.salvage_value_minor)],
              [
                "Useful life",
                plan.useful_life_months === null || plan.useful_life_months === 0
                  ? "—"
                  : `${count(plan.useful_life_months)} months`,
              ],
              loaded?.acquired_via === null || loaded === undefined
                ? null
                : ["Bought via", loaded.acquired_via],
              loaded?.disposed_on == null
                ? null
                : [
                    "Disposed",
                    `${day(loaded.disposed_on)} · ${loaded.disposal_method ?? "—"}`,
                  ],
            ]}
          />

          <div>
            <h4 className="text-cell text-ink mb-2 font-semibold">
              What has been charged
            </h4>
            {/* Every figure here is the server's: the total it added over the
                entries it found, the months it counted from the CALENDAR, and
                what is left to spread. None of them is a sum of the rows below
                — which is the point, since a month the run skipped is missing
                from those rows and present in the arithmetic. */}
            <Facts
              rows={[
                ["Charged so far", rp(plan.charged_total_minor)],
                ["Charged through", monthOf(plan.last_depreciated_month)],
                ["Months remaining", count(plan.months_remaining)],
                ["Left to spread", rp(plan.remaining_depreciable_minor)],
              ]}
            />
            {plan.charged.length === 0 ? (
              <p className="text-ctl text-ink-3 mt-2">
                Nothing has ever been charged. For land that is correct and
                permanent; for anything else it means the monthly run has not
                reached this asset.
              </p>
            ) : (
              <table className="mt-2 w-full">
                <caption className="sr-only">
                  Depreciation charged against {plan.asset_number}
                </caption>
                <tbody>
                  {plan.charged.map((month) => (
                    <tr key={month.period_month} className="border-line border-b">
                      <td className="text-ctl text-ink-2 py-1.5">
                        {monthOf(month.period_month)}
                      </td>
                      <td className="text-label text-ink-4 py-1.5 font-mono">
                        {month.entry_number}
                      </td>
                      <td className="text-ctl text-ink-2 py-1.5 text-right tabular-nums">
                        {amount(month.amount_minor)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <p className="text-meta text-ink-4 mt-auto">
            Capitalising posts nothing. An asset is bought by a supplier bill,
            and an assessment only says how the cost already in the books is
            spread — which is why an asset with no bill line behind it is a cost
            the books never paid for.
          </p>
        </div>
      )}
    </Sheet>
  )
}
