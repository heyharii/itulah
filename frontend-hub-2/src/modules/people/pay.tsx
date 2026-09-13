import { useQuery } from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import { BadgeDollarSign, MapPin, Users } from "lucide-react"
import type {
  EmployeeList,
  EmployeeSummary,
  PayRecordView,
  PayrollIdentityView,
} from "@itulah/contract"

import { ApiError, api } from "@/lib/api"
import { count, day, rp } from "@/lib/format"
import { useCursorList } from "@/lib/list"
import { useQueryState } from "@/lib/query-state"
import { useDebounced } from "@/lib/use-debounced"
import { boundedTo, useReach, whoseList } from "@/lib/reach"
import type { TableSetup } from "@/lib/table"
import { Loaded, PageHead, Toolbar } from "@/kit/page"
import { SearchField } from "@/kit/field"
import { Sheet } from "@/kit/sheet"
import { Table } from "@/kit/table"
import { Tag } from "@/kit/tag"
import { Empty, Failed, Loading, NoAccess, NoMatch } from "@/kit/state"
import { Fact, Facts, Line, Quiet, SubHead } from "@/modules/people/parts"
import { statusLabel, statusTone } from "@/modules/people/labels"

/// What somebody is on, from when, and who agreed it.
///
/// ## A salary is a history, not a number
///
/// There is no "current salary" field anywhere in this module, because that is
/// the field a raise overwrites — and it takes February's payslip with it.
/// Every agreement is dated and every earlier one survives, so what a settled
/// month was paid from stays answerable in June. The server refuses a backdated
/// agreement outright; a genuine backdated raise is paid as a *rapel* in a
/// current period, where somebody can see it.
///
/// So the panel is a TIMELINE and the newest entry is not called "current". It
/// is the last one agreed, and the server permits one dated ahead — a row whose
/// date has not arrived yet is not what anybody is being paid today, and only
/// the date beside it can say so.
///
/// ## Why the list is the workforce and the money is in the panel
///
/// `GET /employees/{id}/pay` is keyed by the person and there is **no route
/// that lists pay across a workforce**. A column of salaries would therefore
/// mean one request per row, which is twenty-four requests to draw a page and a
/// thousand to draw the endpoint's ceiling. So the list is the people — paged,
/// searched and sorted on the server exactly as the Directory is — and opening
/// somebody reads their agreements.
///
/// That is also the right shape for the subject. A screen that put every salary
/// in a column is a screen somebody screenshots.
///
/// ## Head office's to READ as well as to write
///
/// A supervisor who could read the team's salaries is a supervisor who knows
/// what everybody earns, and that is not a rota question. The route enforces
/// it; the nav row carries `audience: "employer"` so a place manager is not
/// offered a screen they would be refused. The workforce list underneath is a
/// supervisor's, so a bounded caller who pastes this URL sees the list and gets
/// the server's refusal on the panel — which is the honest order, and is drawn
/// as `NoAccess` rather than as an empty history.
///
/// ## The account number is never shown
///
/// Four digits, behind dots, on every route — there is no endpoint that serves
/// the rest, so there is nothing here to reveal. Somebody checking their own
/// account confirms four digits; a payment file needs the number, and a payment
/// file is not a screen.
///
/// ## This screen agrees nothing
///
/// `POST /employees/{id}/pay` takes a base, a date and a reason recorded as the
/// authority. That is a form the module has not written yet, so this reads.

const PAGE = 50

export function PayScreen() {
  const url = useQueryState()
  const openId = url.one("person")
  const typed = url.one("q")
  const q = useDebounced(typed, 200)
  const sortKey = url.one("sort") || "code"
  const sortDesc = url.one("dir") === "desc"

  const reach = useReach()
  const bounded = boundedTo(reach.data)

  const people = useCursorList<EmployeeSummary>({
    key: ["people", "pay", "workforce"],
    path: "/api/v1/employees",
    // The same three narrowings the Directory uses, because it is the same
    // endpoint answering the same question — deliberately a separate cache key
    // all the same, so a search typed here does not reorder a list somebody
    // left open on another screen.
    params: {
      q,
      sort: sortKey === "code" ? null : sortKey,
      dir: sortDesc ? "desc" : null,
    },
    limit: PAGE,
  })

  const head = people.head as EmployeeList | undefined

  const columns: ColumnDef<TableSetup, EmployeeSummary>[] = [
    {
      id: "code",
      header: "Number",
      size: 15,
      meta: { min: 110, sortKey: "code" },
      cell: ({ row }) => (
        <span className="text-ink font-mono">{row.original.employee_code}</span>
      ),
    },
    {
      id: "name",
      header: "Name",
      size: 28,
      meta: {
        icon: <Users className="size-[15px]" />,
        min: 180,
        sortKey: "name",
      },
      cell: ({ row }) =>
        row.original.full_name ? (
          <span
            className="text-ink truncate font-medium"
            title={row.original.full_name}
          >
            {row.original.full_name}
          </span>
        ) : (
          <Quiet>Not enrolled yet</Quiet>
        ),
    },
    {
      id: "position",
      header: "Job",
      size: 22,
      // No priority. A grade is what pay is agreed against, so on this screen
      // it is the column that gives the number its meaning.
      meta: { min: 140 },
      cell: ({ row }) =>
        row.original.position === null ? (
          <Quiet />
        ) : (
          <span className="truncate">{row.original.position}</span>
        ),
    },
    {
      id: "status",
      header: "Status",
      size: 17,
      meta: { priority: 2, min: 130 },
      // Not decoration here: somebody who has left still has agreements on
      // record, and it is the status that says why nobody is paying them.
      cell: ({ row }) => (
        <Tag tone={statusTone(row.original.status)}>
          {statusLabel(row.original.status)}
        </Tag>
      ),
    },
    {
      id: "place",
      header: "Posted to",
      size: 18,
      meta: {
        icon: <MapPin className="size-[15px]" />,
        priority: 1,
        min: 130,
        sortKey: "place",
      },
      cell: ({ row }) =>
        row.original.place_id === null ? (
          <Quiet>Unposted</Quiet>
        ) : (
          <span className="truncate">
            {row.original.place_name ?? row.original.place_id}
          </span>
        ),
    },
  ]

  // The same removal the Directory makes, for the same reason: when every row
  // is posted to one place, a column repeating that place is a column that says
  // nothing.
  const shown = columns.filter(
    (column) => column.id !== "place" || bounded === null,
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHead
        module="People"
        title="Pay agreements"
        description={whoseList(reach.data, {
          everywhere:
            "Choose somebody to read what they are on, from when, and who agreed it.",
          at: (place) =>
            `Everyone posted to ${place}. Pay itself is head office's to read.`,
        })}
      />

      <Toolbar
        trailing={
          people.query.isError ? (
            <>{count(null)} loaded</>
          ) : (
            <Loaded
              loaded={people.rows.length}
              total={people.total}
              pending={people.query.isPending}
              noun="employees"
            />
          )
        }
      >
        <SearchField
          value={typed}
          onChange={(value) => url.set({ q: value || null })}
          placeholder="Search a name or an employee number"
          className="w-[22rem]"
        />
        <span className="text-ctl text-ink-3">
          There is no route that lists pay across a workforce, so there is no
          salary column — open somebody to read theirs.
        </span>
      </Toolbar>

      {people.query.isPending ? (
        <Loading rows={9} cols={shown.length} />
      ) : people.query.isError ? (
        people.query.error instanceof ApiError &&
        people.query.error.status === 403 ? (
          <NoAccess
            what="the workforce"
            reach={people.query.error.detail || undefined}
          />
        ) : (
          <Failed
            what="the workforce"
            error={people.query.error}
            onRetry={() => void people.query.refetch()}
          />
        )
      ) : people.rows.length === 0 ? (
        q === "" ? (
          <Empty
            what="employees"
            detail="Nothing has been registered against the places you reach."
          />
        ) : (
          <NoMatch
            what="employees"
            held={head?.total}
            onClear={() => url.set({ q: null }, false)}
          />
        )
      ) : (
        <Table
          columns={shown}
          rows={people.rows}
          rowId={(row) => row.employee_id}
          caption="The workforce, to read pay against"
          onRowClick={(row) => url.set({ person: row.employee_id }, false)}
          isOpen={(row) => row.employee_id === openId}
          sort={{ key: sortKey, desc: sortDesc }}
          onSort={(key) => {
            const same = sortKey === key
            url.set({
              sort: key,
              dir: same ? (sortDesc ? null : "desc") : "desc",
            })
          }}
          hasMore={people.hasMore}
          loadingMore={people.loadingMore}
          onNeedMore={people.loadMore}
          foot={{
            code: (
              <>
                <b className="text-ink">{count(people.total)}</b>{" "}
                {people.total === 1 ? "employee" : "employees"}
              </>
            ),
          }}
        />
      )}

      <PaySheet
        openId={openId}
        row={people.rows.find((row) => row.employee_id === openId)}
        onClose={() => url.set({ person: null }, false)}
      />
    </div>
  )
}

/// One person's pay, over time, and who they are to payroll.
///
/// Two reads rather than one, because they are two questions with two
/// audiences: what somebody agreed to be paid, and where the money is sent.
/// The server keeps them on separate routes for the same reason and this panel
/// does not merge them.
function PaySheet({
  openId,
  row,
  onClose,
}: {
  openId: string
  row: EmployeeSummary | undefined
  onClose: () => void
}) {
  const records = useQuery({
    queryKey: ["people", "pay", "records", openId] as const,
    enabled: openId !== "",
    queryFn: ({ signal }) =>
      api.get<PayRecordView[]>(
        `/api/v1/employees/${encodeURIComponent(openId)}/pay`,
        signal,
      ),
  })

  const identity = useQuery({
    queryKey: ["people", "pay", "identity", openId] as const,
    enabled: openId !== "",
    queryFn: ({ signal }) =>
      api.get<PayrollIdentityView>(
        `/api/v1/employees/${encodeURIComponent(openId)}/payroll-identity`,
        signal,
      ),
  })

  const refused =
    records.error instanceof ApiError && records.error.status === 403

  return (
    <Sheet
      open={openId !== ""}
      onClose={onClose}
      width="record"
      title={row?.full_name ?? row?.employee_code ?? "Pay"}
      subtitle={row?.position ?? "Reading the agreements…"}
    >
      {refused ? (
        // The panel's refusal, not the list's. A place manager may read the
        // workforce and may not read its salaries, so this is the one part of
        // the screen that says no — and it says which.
        <NoAccess
          what="pay"
          reach={
            (records.error as ApiError).detail ||
            "Pay is head office's to read as well as to write."
          }
        />
      ) : records.isError ? (
        <Failed
          what="the agreements"
          error={records.error}
          onRetry={() => void records.refetch()}
        />
      ) : records.data === undefined ? (
        <Loading rows={4} cols={2} />
      ) : (
        <>
          <SubHead>Agreements</SubHead>
          {records.data.length === 0 ? (
            <Line>
              {/* Not "paid nothing". An absent agreement is a person nobody
                  has agreed terms with, which is a different finding and the
                  one somebody has to act on. */}
              <Quiet>
                No agreement has been filed. That is not terms worth nothing —
                it is somebody nobody has agreed terms with.
              </Quiet>
            </Line>
          ) : (
            records.data.map((record, index) => (
              <Line
                key={`${record.effective_from}-${index}`}
                note={`${record.agreed_by} — ${record.reason}`}
              >
                <span className="text-ink shrink-0 font-medium tabular-nums">
                  {rp(record.base_minor)}
                </span>
                <span className="text-ink-3 min-w-0 flex-1 truncate">
                  {record.fixed_allowances.length === 0
                    ? "no fixed allowances"
                    : `+ ${rp(record.statutory_base_minor - record.base_minor)} in ${record.fixed_allowances.length} allowance${record.fixed_allowances.length === 1 ? "" : "s"}`}
                </span>
                <span className="text-ink-2 shrink-0">
                  from {day(record.effective_from)}
                  {index === records.data.length - 1 && (
                    <span className="text-ink-4"> · latest</span>
                  )}
                </span>
              </Line>
            ))
          )}

          {/* The allowances, itemised, under the agreements they belong to.
              `statutory_base_minor` is base plus fixed allowances and is the
              figure statutory rules are computed AGAINST — nothing on this
              surface applies one, and reading it as take-home would be wrong by
              every statutory rule at once. */}
          {records.data.at(-1)?.fixed_allowances.length ? (
            <>
              <SubHead>Fixed allowances, on the latest agreement</SubHead>
              {(records.data.at(-1)?.fixed_allowances ?? []).map(
                (allowance) => (
                  <Line key={allowance.code}>
                    <span className="text-ink min-w-0 flex-1 truncate font-mono">
                      {allowance.code}
                    </span>
                    <span className="text-ink-2 shrink-0 tabular-nums">
                      {rp(allowance.minor)}
                    </span>
                  </Line>
                ),
              )}
              <Line>
                <span className="text-ink-3 min-w-0 flex-1">
                  Base plus fixed allowances — what statutory rules are computed
                  against, not take-home
                </span>
                <span className="text-ink shrink-0 font-medium tabular-nums">
                  {rp(records.data.at(-1)?.statutory_base_minor)}
                </span>
              </Line>
            </>
          ) : null}

          <SubHead>Who they are to payroll</SubHead>
          {identity.isError ? (
            <Line note={(identity.error as Error).message}>
              <Quiet>The payroll identity could not be read.</Quiet>
            </Line>
          ) : identity.data === undefined ? (
            <Line>
              <Quiet>Reading the record…</Quiet>
            </Line>
          ) : (
            <>
              {!identity.data.payable && (
                <Line>
                  <span className="text-bad-ink">
                    No account on record, so this person cannot be paid — and a
                    payment file that fails at the bank fails for everybody in
                    it.
                  </span>
                </Line>
              )}
              <Facts>
                <Fact label="Bank">
                  {identity.data.bank_name ?? <Quiet />}
                </Fact>
                <Fact label="Account">
                  {/* Four digits. There is no route that serves the rest. */}
                  {identity.data.bank_account_masked ? (
                    <span className="font-mono">
                      {identity.data.bank_account_masked}
                    </span>
                  ) : (
                    <Quiet />
                  )}
                </Fact>
                <Fact label="Account holder" wide>
                  {identity.data.bank_holder ?? <Quiet />}
                  <span className="text-label text-ink-4 block">
                    An Indonesian transfer is rejected on a name mismatch, and
                    one rejection fails the whole payroll file.
                  </span>
                </Fact>
                <Fact label="NPWP">{identity.data.npwp ?? <Quiet />}</Fact>
                <Fact label="PTKP">
                  {identity.data.ptkp ?? <Quiet />}
                  <span className="text-label text-ink-4 block">
                    Recorded, never computed here.
                  </span>
                </Fact>
                <Fact label="BPJS Kesehatan">
                  {identity.data.bpjs_kesehatan ?? <Quiet />}
                </Fact>
                <Fact label="BPJS Ketenagakerjaan">
                  {identity.data.bpjs_ketenagakerjaan ?? <Quiet />}
                </Fact>
              </Facts>

              {identity.data.amendments.length > 0 && (
                <>
                  <SubHead>What has been amended</SubHead>
                  {identity.data.amendments.map((amendment, index) => (
                    <Line
                      key={`${amendment.field}-${amendment.at}-${index}`}
                      note={`${amendment.actor} — ${amendment.reason}`}
                    >
                      <span className="min-w-0 flex-1 truncate">
                        {amendment.field}
                      </span>
                      <span className="text-ink-3 shrink-0">
                        from {day(amendment.effective_from)}
                      </span>
                    </Line>
                  ))}
                </>
              )}
            </>
          )}

          <div className="text-meta text-ink-4 mt-auto px-[18px] py-3">
            <BadgeDollarSign className="mr-1 inline size-3.5 align-[-2px]" />
            An agreement supersedes the one before it from its own date and
            cannot be filed behind the latest. A backdated raise is paid as a
            rapel, not by rewriting a month already settled.
          </div>
        </>
      )}
    </Sheet>
  )
}
