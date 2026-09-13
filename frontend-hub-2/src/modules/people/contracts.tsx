import type { ColumnDef } from "@tanstack/react-table"
import { CalendarDays, FileSignature, MapPin } from "lucide-react"
import type { ExpiringContract } from "@itulah/contract"

import { ApiError } from "@/lib/api"
import { count, day, today } from "@/lib/format"
import { useReport } from "@/lib/list"
import { useQueryState } from "@/lib/query-state"
import { useReach, whoseList } from "@/lib/reach"
import type { TableSetup } from "@/lib/table"
import { AppLink } from "@/kit/app-link"
import { PageHead, Toolbar } from "@/kit/page"
import { Table } from "@/kit/table"
import { Tabs } from "@/kit/tabs"
import { Tile, Tiles } from "@/kit/tiles"
import { Empty, Failed, Loading, NoAccess } from "@/kit/state"
import { Quiet, Term } from "@/modules/people/parts"

/// Fixed terms running out — the module's exception queue.
///
/// A PKWT that lapses without anybody noticing is somebody turning up to work
/// without a contract, which is a legal problem rather than a data one. That is
/// the row this screen exists to surface, and it is why `days_remaining` goes
/// NEGATIVE rather than clamping at zero: "ended 12 days ago" and "ends in 12
/// days" are opposite findings, and a report that showed both as `0` would hide
/// the only one that is urgent.
///
/// ## Why this is a screen and not a sort on the Directory
///
/// Because `GET /employees` cannot order by contract expiry and cannot answer
/// past its cap. Sorting the thousand rows the Directory happens to hold would
/// put "whose term runs out first" at the top of *the first thousand by employee
/// number*, which is a different question with the same shape. This route does
/// the ordering in the database, over every employee the caller reaches, with
/// no limit clause at all — so what is on screen is the whole answer for the
/// window asked about.
///
/// ## The window and the date are both real server parameters
///
/// `as_of` decides what "remaining" counts from, and `within_days` decides how
/// far ahead to look. Both go in the URL like every other narrowing here, so a
/// link to "what lapses in the next fortnight" is a link somebody can send.
/// Neither is re-implemented in the browser: the server computes the days and
/// clamps the window, and a second arithmetic here would be a second answer.

/// The windows worth offering, in days.
///
/// Thirty is the server's own default and the notice period the workforce is
/// managed around. Fourteen is "this fortnight"; ninety is the planning
/// horizon. A free number box would be four more keystrokes for an answer
/// nobody needs to the day.
const WINDOWS = ["14", "30", "60", "90"] as const
const DEFAULT_WINDOW = "30"

export function ContractsScreen() {
  const url = useQueryState()
  const asOf = url.one("as_of") || today()
  const within = url.one("within") || DEFAULT_WINDOW

  const reach = useReach()

  const expiring = useReport<ExpiringContract[]>({
    key: ["people", "contracts", "expiring"],
    path: "/api/v1/employees/contracts/expiring",
    // Exactly the two parameters the route declares. Its query struct refuses
    // unknown fields, so a stray `limit` here would be a 422 rather than an
    // ignored value — which is why this screen uses `useReport` and not
    // `useBoundedList`, whose whole job is to send a `limit`.
    params: { as_of: asOf, within_days: within },
  })

  const rows = expiring.data ?? []
  // Whether there is an ANSWER, as distinct from whether there are rows.
  //
  // Everything below is `undefined` until this is true, and the tiles draw an
  // em dash rather than a figure. A tile that reads `0` while the request is
  // still in flight — or after it failed — is a measurement nobody took: it
  // says "nobody is working past their term" on a screen that has not been
  // told anything at all, which is the most confident way for this page to be
  // wrong.
  const answered = expiring.data !== undefined
  // Counted over the WHOLE answer, which this endpoint genuinely returns —
  // there is no cap on the query behind it. The same arithmetic over a capped
  // list would be a tile that lies, which is the failure `kit/tiles.tsx` is
  // written against.
  const lapsed = answered
    ? rows.filter((row) => row.days_remaining < 0).length
    : null
  const fortnight = answered
    ? rows.filter((row) => row.days_remaining >= 0 && row.days_remaining <= 14)
        .length
    : null

  const columns: ColumnDef<TableSetup, ExpiringContract>[] = [
    {
      id: "code",
      header: "Number",
      size: 13,
      meta: { min: 110 },
      // A link to the person rather than a sheet of its own. This report holds
      // a term and a date; everything else somebody wants next — the postings,
      // the login, the history — is the Directory's record, and two screens
      // that both open a person are two records that can disagree.
      cell: ({ row }) => (
        <AppLink
          to="/people"
          search={{ person: row.original.employee_id }}
          className="text-ink decoration-line-2 hover:decoration-ink font-mono underline underline-offset-2"
        >
          {row.original.employee_code}
        </AppLink>
      ),
    },
    {
      id: "name",
      header: "Name",
      size: 25,
      meta: { min: 180 },
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
      size: 18,
      meta: {
        icon: <FileSignature className="size-[15px]" />,
        priority: 2,
        min: 130,
      },
      cell: ({ row }) => (
        <span className="truncate">{row.original.position}</span>
      ),
    },
    {
      id: "place",
      header: "Place",
      size: 16,
      meta: { icon: <MapPin className="size-[15px]" />, priority: 1, min: 120 },
      // This report sends the place's id and not its name — the Directory's
      // does send a name. Drawn as the identifier it is rather than dressed up,
      // because guessing the shop's name from its id is how `dc` and `dc-01`
      // became two places in one company.
      cell: ({ row }) =>
        row.original.place_id === null ? (
          <Quiet>Unposted</Quiet>
        ) : (
          <span className="text-label text-ink-2 truncate font-mono">
            {row.original.place_id}
          </span>
        ),
    },
    {
      id: "ends_on",
      header: "Ends on",
      size: 14,
      meta: { min: 130 },
      cell: ({ row }) => day(row.original.ends_on),
    },
    {
      id: "remaining",
      header: "Term ends in",
      size: 14,
      // Never dropped. It is the figure the screen exists for.
      meta: { align: "right", min: 140 },
      // The SERVER's count, from the date above. Recomputing it here would be
      // a second answer to "remaining as at when", and the two would part
      // company the moment somebody left this tab open overnight.
      cell: ({ row }) => <Term days={row.original.days_remaining} />,
    },
  ]

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHead
        module="People"
        title="Contracts expiring"
        description={whoseList(reach.data, {
          everywhere:
            "Fixed terms running out, soonest first, across every place you reach.",
          at: (place) => `Fixed terms running out at ${place}, soonest first.`,
        })}
      />

      <Tabs
        label="How far ahead to look"
        value={within === DEFAULT_WINDOW ? "" : within}
        onChange={(value) => url.set({ within: value || null }, false)}
        tabs={[
          { value: "", label: `Next ${DEFAULT_WINDOW} days` },
          ...WINDOWS.filter((days) => days !== DEFAULT_WINDOW).map((days) => ({
            value: days,
            label: `Next ${days} days`,
          })),
        ]}
      />

      <Toolbar
        trailing={
          expiring.isPending
            ? "Loading…"
            : `${count(answered ? rows.length : null)} terms`
        }
      >
        {/* What "remaining" counts FROM. Hard-wired to today, this screen
            silently answered "what had lapsed by the end of last month" with
            today's arithmetic — the same defect the Cash & bank screen's as-at
            box was added to fix. */}
        <label className="h-ctl rounded-ctl border-line-2 bg-canvas shadow-btn focus-within:border-blue flex shrink-0 items-center gap-2 border px-2.5">
          <CalendarDays className="text-ink-4 size-4 shrink-0" />
          <span className="text-ctl text-ink-4">Counting from</span>
          <input
            type="date"
            value={asOf}
            onChange={(event) =>
              url.set({
                as_of:
                  event.target.value === today() ? null : event.target.value,
              })
            }
            className="text-ctl text-ink bg-transparent outline-none"
          />
        </label>
        <span className="text-ctl text-ink-3">
          Every term the window holds — this route has no limit to hit.
        </span>
      </Toolbar>

      {/* `count(null)` is an em dash — see `lib/format.ts`. Nothing here draws
          a zero until the server has actually answered. */}
      <Tiles>
        <Tile
          label="Already lapsed"
          value={count(lapsed)}
          tone={lapsed !== null && lapsed > 0 ? "bad" : undefined}
          note={
            lapsed === null
              ? "not counted yet"
              : lapsed > 0
                ? "working without a term in force"
                : "nobody is working past their term"
          }
        />
        <Tile
          label="Within a fortnight"
          value={count(fortnight)}
          tone={fortnight !== null && fortnight > 0 ? "warn" : undefined}
          note={fortnight === null ? "not counted yet" : "needs a decision now"}
        />
        <Tile
          label="In this window"
          value={count(answered ? rows.length : null)}
          note={`ends on or before ${within} days from ${day(asOf)}`}
        />
      </Tiles>

      {expiring.isPending ? (
        <Loading rows={8} cols={columns.length} />
      ) : expiring.isError ? (
        expiring.error instanceof ApiError && expiring.error.status === 403 ? (
          <NoAccess what="contracts" reach={expiring.error.detail} />
        ) : (
          <Failed
            what="the contracts report"
            error={expiring.error}
            onRetry={() => void expiring.refetch()}
          />
        )
      ) : rows.length === 0 ? (
        // Not `NoMatch`: the window is not a filter over a list that is here,
        // it is the question the server was asked. "Nothing ends in the next
        // thirty days" is a finding, and a good one.
        <Empty
          what="terms ending in this window"
          detail={`No fixed term ends on or before ${within} days from ${day(asOf)}. Permanent contracts never appear here, and somebody who has already left is not a term to renew.`}
        />
      ) : (
        <Table
          columns={columns}
          rows={rows}
          rowId={(row) => `${row.employee_id}:${row.ends_on}`}
          caption={`Fixed terms ending within ${within} days of ${asOf}`}
          foot={{
            code: (
              <>
                <b className="text-ink">{count(rows.length)}</b> terms
              </>
            ),
            remaining:
              lapsed === null || lapsed === 0 ? null : (
                <span className="text-bad-ink font-medium">
                  {count(lapsed)} already ended
                </span>
              ),
          }}
        />
      )}
    </div>
  )
}
