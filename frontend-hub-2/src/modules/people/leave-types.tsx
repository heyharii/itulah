import type { ColumnDef } from "@tanstack/react-table"
import { ListChecks, Paperclip } from "lucide-react"
import type { LeavePolicyView, LeaveTypeView } from "@itulah/contract"

import { ApiError } from "@/lib/api"
import { count, day } from "@/lib/format"
import { useReport } from "@/lib/list"
import type { TableSetup } from "@/lib/table"
import { PageHead, Toolbar } from "@/kit/page"
import { Table } from "@/kit/table"
import { Tag } from "@/kit/tag"
import { Empty, Failed, Loading, NoAccess } from "@/kit/state"
import { BandHead, Measure, Measures, Quiet } from "@/modules/people/parts"
import {
  accrualLabel,
  backingLabel,
  carryForwardLabel,
  days,
  paymentLabel,
} from "@/modules/people/labels"

/// What kinds of leave exist, and the rules a balance folds under.
///
/// ## One balance with a label beside it is the wrong model
///
/// It is the obvious one, and it is wrong for most of Indonesian leave law in
/// the direction that takes days off people. **Sick leave is deducted from
/// nothing**: UU 13/2003 art. 93 obliges the employer to keep paying a
/// certified ill worker, and a system that took sick days out of the annual
/// twelve would be taking something the law does not allow it to take. **Leave
/// for an important reason** — three days to marry, art. 93(4) — is bounded per
/// *occurrence*, not per year, and does not accumulate.
///
/// So a kind says what it DRAWS ON, and that is the first column rather than a
/// flag at the end of the row. `draws_on_balance` is sent by the server rather
/// than derived here from `backing`, so a leave form and the kernel cannot
/// disagree about whether asking for a balance is even a question.
///
/// ## Two reads, because a catalogue is not a rule
///
/// `GET /leave-types` is the list of kinds. `GET /leave-policy` is the
/// generations of rules a *balance* folds under — how it accrues, whether it
/// carries forward, whether it can be cashed out. A catalogue with no policy
/// behind it cannot compute a balance at all, which is why the missing policy
/// is a warning at the top rather than an empty section at the bottom.
///
/// ## A generation, never an edit
///
/// Last month's balance still folds under last month's rules, and two
/// generations effective on one day would make "which rules applied" depend on
/// row order. So the policy is a list and the last one is the one in force —
/// the same shape as the attendance policy next door, for the same reason.
///
/// ## Nothing here is compiled in
///
/// Not the kinds — employers add their own, and a closed list would mean a
/// release for each one — and not the numbers. Three days for a marriage is a
/// figure from art. 93(4) that can be amended, and a constant in this code
/// would be quietly wrong from the day it was.

export function LeaveTypesScreen() {
  const kinds = useReport<LeaveTypeView[]>({
    key: ["people", "leave-types"],
    path: "/api/v1/leave-types",
    params: {},
  })
  const policy = useReport<LeavePolicyView[]>({
    key: ["people", "leave-policy"],
    path: "/api/v1/leave-policy",
    params: {},
  })

  const rows = kinds.data ?? []
  const generations = policy.data ?? []
  // The last generation is the one in force. Not "the newest by date" computed
  // here: the server appends in order and two generations on one day are
  // refused, so reading the end of the list is reading the server's own answer.
  const inForce = generations.at(-1)

  const columns: ColumnDef<TableSetup, LeaveTypeView>[] = [
    {
      id: "name",
      header: "Kind",
      size: 26,
      meta: { icon: <ListChecks className="size-[15px]" />, min: 170 },
      cell: ({ row }) => (
        <span className="text-ink truncate font-medium">{row.original.name}</span>
      ),
    },
    {
      id: "code",
      header: "Code",
      size: 12,
      // What the ledger files it under, which is what a balance row and a
      // request both carry.
      meta: { priority: 3, min: 100 },
      cell: ({ row }) => (
        <span className="text-ink-2 font-mono">{row.original.code}</span>
      ),
    },
    {
      id: "backing",
      header: "Draws on",
      size: 20,
      // Never dropped. It is the first thing about a kind of leave and the one
      // that decides whether a balance is even a question.
      meta: { min: 150 },
      cell: ({ row }) => (
        <Tag tone={row.original.draws_on_balance ? "info" : "neutral"}>
          {backingLabel(row.original.backing)}
        </Tag>
      ),
    },
    {
      id: "max",
      header: "Bound",
      size: 14,
      meta: { align: "right", min: 110 },
      cell: ({ row }) =>
        row.original.max_centidays === null ? (
          // Absent for the other two backings, and correctly so: a
          // balance-backed kind is bounded by the balance, and a certified one
          // by the certificate. A number here would be inventing a limit.
          <Quiet>None</Quiet>
        ) : (
          <span className="tabular-nums">
            {days(row.original.max_centidays)} days
          </span>
        ),
    },
    {
      id: "payment",
      header: "Paid",
      size: 16,
      meta: { priority: 1, min: 130 },
      cell: ({ row }) => (
        <span
          className={
            row.original.payment === "UNPAID" ? "text-ink-3" : "text-ink-2"
          }
        >
          {paymentLabel(row.original.payment)}
        </span>
      ),
    },
    {
      id: "evidence",
      header: "Evidence",
      size: 12,
      meta: {
        icon: <Paperclip className="size-[15px]" />,
        priority: 2,
        min: 110,
      },
      cell: ({ row }) =>
        row.original.requires_evidence ? (
          <Tag tone="warn">Required</Tag>
        ) : (
          <Quiet>Not required</Quiet>
        ),
    },
  ]

  const failed = kinds.isError ? kinds.error : policy.isError ? policy.error : null

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHead
        module="People"
        title="Leave types"
        description="What kinds of leave exist, what each one draws on, and the rules a balance folds under."
      />

      {failed !== null ? (
        failed instanceof ApiError && failed.status === 403 ? (
          <NoAccess what="the leave catalogue" reach={failed.detail} />
        ) : (
          <Failed
            what="the leave catalogue"
            error={failed}
            onRetry={() => {
              void kinds.refetch()
              void policy.refetch()
            }}
          />
        )
      ) : (
        <>
          {/* A balance cannot be computed at all until somebody answers the
              questions a policy asks. Saying so is the point: the alternative
              is a default nobody decided, which becomes a rule by accident. */}
          {!policy.isPending && generations.length === 0 && (
            <div className="border-bad/40 bg-bad-wash text-ctl text-bad-ink shrink-0 border-b px-4 py-2">
              <b className="font-medium">No leave policy has been ratified.</b>{" "}
              Until one is, a balance has no rules to fold under — so
              balance-backed leave cannot be approved, however many kinds are
              listed below.
            </div>
          )}

          {inForce !== undefined && <InForce policy={inForce} />}

          <BandHead
            trailing={
              generations.length > 1
                ? `${count(generations.length)} generations on record`
                : undefined
            }
          >
            The catalogue
          </BandHead>

          <Toolbar
            trailing={
              kinds.data === undefined
                ? "Loading…"
                : `${count(rows.length)} ${rows.length === 1 ? "kind" : "kinds"}`
            }
          >
            <span className="text-ctl text-ink-3">
              There is no edit and no delete. Redefining a kind changes what
              every request already filed against it meant; a kind that should
              no longer be used is one nobody picks.
            </span>
          </Toolbar>

          {kinds.isPending ? (
            <Loading rows={6} cols={columns.length} />
          ) : rows.length === 0 ? (
            <Empty
              what="leave types"
              detail="No kind of leave has been defined, so nobody can file a request of any kind — not even the statutory ones."
            />
          ) : (
            <Table
              columns={columns}
              rows={rows}
              rowId={(row) => row.code}
              caption="Kinds of leave"
              foot={{
                name: (
                  <>
                    <b className="text-ink">{count(rows.length)}</b>{" "}
                    {rows.length === 1 ? "kind" : "kinds"}
                  </>
                ),
                backing: (
                  <>
                    {count(rows.filter((row) => row.draws_on_balance).length)}{" "}
                    draw on a balance
                  </>
                ),
              }}
            />
          )}
        </>
      )}
    </div>
  )
}

/// The rules a balance folds under, as they stand.
function InForce({ policy }: { policy: LeavePolicyView }) {
  return (
    <>
      <BandHead trailing={`In force from ${day(policy.effective_from)}`}>
        Balance rules · generation {policy.version}
      </BandHead>
      <Measures>
        <Measure label="Annual entitlement" note="UU 13/2003 art. 79 sets the floor">
          <span className="tabular-nums">
            {days(policy.annual_centidays)} days
          </span>
        </Measure>
        <Measure label="Accrues" note={accrualLabel(policy.accrual)}>
          <span className="text-cell">
            {policy.accrual === "MONTHLY" ? "Monthly" : "Up front"}
          </span>
        </Measure>
        <Measure
          label="Carry forward"
          note={
            policy.carry_forward_cap_centidays === null
              ? undefined
              : `Capped at ${days(policy.carry_forward_cap_centidays)} days${
                  policy.carry_forward_expires_on === null
                    ? ""
                    : `, expiring ${policy.carry_forward_expires_on}`
                }`
          }
        >
          <span className="text-cell">
            {carryForwardLabel(policy.carry_forward)}
          </span>
        </Measure>
        <Measure
          label="Cash out"
          note={
            policy.encashment_second_approver === true
              ? "Needs a second approver"
              : undefined
          }
        >
          <span className="text-cell">
            {policy.encashment === "ALLOWED"
              ? policy.encashment_max_centidays === null
                ? "Allowed"
                : `Up to ${days(policy.encashment_max_centidays)} days`
              : "Not allowed"}
          </span>
        </Measure>
        <Measure
          label="During protected leave"
          // Maternity and long certified illness. Whether entitlement keeps
          // accruing through them is a decision with a legal floor under it,
          // not a switch — which is why it is on the policy rather than
          // implied by the accrual rule.
          note="Maternity, long illness"
        >
          <span className="text-cell">
            {policy.protected_leave === "CONTINUES"
              ? "Keeps accruing"
              : "Suspended"}
          </span>
        </Measure>
      </Measures>
    </>
  )
}
