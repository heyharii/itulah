import { useQuery } from "@tanstack/react-query"
import { useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { AppLink } from "@/components/ui/app-link"
import { PageHeader } from "@/components/ui/page-header"
import { Pill, type PillProps } from "@/components/ui/pill"
import { Segmented, Toolbar } from "@/components/ui/segmented"
import { EmptyState } from "@/components/ui/states"
import { day, money } from "@/lib/format"
import { financeKeys, listPaymentInstructions } from "@/lib/queries/finance"
import { queryState } from "@/lib/query-state"
import {
  CardRow,
  Code,
  Grid,
  Note,
  NumberCard,
  Td,
  Th,
  TotalRow,
} from "@/screens/finance-final/parts"
import { SiteName, SiteSelect, SupplierName } from "@/screens/finance/parts"
import type { PaymentInstruction } from "@itulah/contract"

/// A shop asking head office to pay something, and what happened to the ask.
///
/// # Why the business needs the document
///
/// Because spending is centralised (owner, 2026-09-07) and the shop's own
/// spending pot is small. Petty cash covers a light bulb; it does not cover the
/// landlord, PLN, or the man who rebuilt the shopfront. `edge/petty.rs` already
/// meets this moment and refuses an expense over the tin with *"send this to
/// head office to pay by transfer"* — and until migration 0240 that sentence
/// was a dead end, because there was nowhere to send it. The shop rang
/// somebody.
///
/// # It posts nothing, and that is the property to protect
///
/// ERPNext's `Payment Request` is the reference, and the load-bearing half of
/// it is that creating one writes no GL entry: the accounting happens only when
/// a Payment Entry is made from it. Ours keeps that exactly. **No rung of the
/// ladder below touches the ledger** — the money moves in the BILL and the
/// PAYMENT the ask becomes, both of which already have their posting rule,
/// their period gate and their account map.
///
/// Nothing can enforce an absence except a test that counts, so
/// `store_documents_integration.rs` walks the whole ladder and checks the
/// journal is the same size at the end as it was at the start.
///
/// # Three ways ours parts company with ERPNext
///
/// All three are consequences of one fact — **ours starts at a shop, theirs
/// starts at an invoice.**
///
///  1. Their `reference_doctype` / `reference_name` are the spine of the
///     document: a Payment Request is always raised FROM a submitted order or
///     invoice and the amount is fetched from it. A shop asking for the
///     landlord to be paid has no such document, so our `bill_id` is OPTIONAL,
///     and its absence is what makes head office key the bill as part of saying
///     yes.
///  2. Their `party` is a master row chosen before the request can be saved.
///     Ours arrives as free text, for the reason `store_expense.payee` is free
///     text: a shop has a bill in its hand and no view of the vendor book, and
///     forcing a master row at the counter means either a fictional one per ask
///     or the ask not being made. So resolving the payee into a vendor —
///     `supplier` with `category = 'EXPENSE'`, which migration 0212 allows for
///     — is a step in head office ACCEPTING the instruction. 0240's CHECK
///     refuses `APPROVED` without a `supplier_id`, so it cannot be skipped and
///     tidied up later.
///  3. Their `payment_request_type` is Inward or Outward. A shop never asks
///     head office to collect, so the field does not exist rather than existing
///     with one value.
///
/// Dropped outright: payment gateways, `payment_url`, the emailed payment link,
/// subscription plans, the currency picker, `Failed` — it belongs to a gateway
/// we do not have — and `Partially Paid`, which cannot arise while an
/// instruction names one amount and is settled by one payment. A thing that can
/// be part-paid is a bill, and bills already exist.
///
/// # The rung this screen drew before it had a backend, and does not now
///
/// **In a payment run** — ERPNext's Payment Order, one person selecting a batch
/// and another releasing it at the bank. It is deliberately not built: the
/// batch is a second document, and until that document exists the state would
/// be a click rather than a fact. An unreachable rung in a CHECK is a lie the
/// next reader has to discover. It remains the owner's first open decision, and
/// it is one value in 0240's CHECK and one route when it is taken.
export function PaymentInstructions() {
  const [site, setSite] = useState("")
  const [status, setStatus] = useState<Rung>("")

  const queue = useQuery({
    queryKey: financeKeys.paymentInstructions(
      status === "" ? null : status,
      site === "" ? null : site
    ),
    queryFn: ({ signal }) =>
      listPaymentInstructions(
        {
          ...(site === "" ? {} : { site }),
          ...(status === "" ? {} : { status }),
        },
        signal
      ),
  })

  /// The counts beside each rung, from the server.
  ///
  /// Over everything the search and the unit filter match rather than over the
  /// page — so a rung showing 0 means there are none, not that none of them fit
  /// on this screen. Counting the drawn rows instead is how a heading ends up
  /// describing a page size.
  const counts = new Map(
    (queue.data?.facets.statuses ?? []).map((facet) => [
      facet.value,
      facet.count,
    ])
  )

  return (
    <PageContent>
      <PageHeader
        crumb="Finance final · Store"
        title="Payment instruction"
        sub="A shop asking head office to pay something, and what happened to the ask."
      />

      <Toolbar>
        <SiteSelect
          value={site}
          onChange={setSite}
          className="h-8 w-44"
          aria-label="Site"
        />
        <Segmented
          options={RUNGS.map((rung) => ({
            value: rung.value,
            label:
              rung.value === "" ? (
                "All"
              ) : (
                <>
                  {rung.name}
                  <span className="ml-1 tabular-nums opacity-60">
                    {counts.get(rung.value) ?? 0}
                  </span>
                </>
              ),
          }))}
          value={status}
          onChange={setStatus}
        />
        <Toolbar.Spacer />
        <span className="text-[0.875rem] text-mute">
          {site === "" ? "every site" : <SiteName id={site} />}
        </span>
      </Toolbar>

      {queryState(queue, {
        loading: "Reading what the shops have asked head office to pay…",
        render: (page) => (
          <div className="flex flex-col gap-4">
            <CardRow>
              <NumberCard
                label="Waiting on head office"
                value={page.open_minor}
                tone={page.open_minor === 0 ? undefined : "warn"}
                note={
                  page.open_minor === 0
                    ? "nothing is unanswered"
                    : `${counts.get("REQUESTED") ?? 0} sent, ${counts.get("DRAFT") ?? 0} still being written`
                }
              />
              {/* Agreeing is not paying, and the distance between the two is
                  the figure a shop rings about. */}
              <NumberCard
                label="Approved, not yet paid"
                value={page.rows
                  .filter((row) => row.status === "APPROVED")
                  .reduce((sum, row) => sum + row.amount_minor, 0)}
                note={`${counts.get("APPROVED") ?? 0} agreed and waiting for the money to move`}
              />
              <NumberCard
                label="Asked for, all told"
                value={page.total_minor}
                note={`${page.total} instruction${page.total === 1 ? "" : "s"}, every state`}
              />
            </CardRow>

            {/* ── The ladder, with what is standing on each rung ─────────── */}
            <section className="flex flex-col gap-2">
              <h2 className="text-[0.875rem] font-semibold text-ink">
                Where the asks are
              </h2>
              <div className="flex flex-wrap items-center gap-x-1.5 gap-y-2">
                {LADDER.map((rung, index) => (
                  <span key={rung.value} className="flex items-center gap-1.5">
                    {index > 0 && (
                      <span className="text-hairline-strong">→</span>
                    )}
                    <Pill tone={rung.tone}>
                      {rung.name}
                      <span className="ml-1 tabular-nums opacity-70">
                        {counts.get(rung.value) ?? 0}
                      </span>
                    </Pill>
                  </span>
                ))}
              </div>
              <p className="text-[0.875rem] leading-relaxed text-mute">
                Six rungs, against ERPNext&rsquo;s eight. <b>Refused</b> is ours
                and is not their <Code>Cancelled</Code>: a refusal is a decision
                head office made and has to give a reason for, where{" "}
                <b>Withdrawn</b> is the shop taking its own ask back. Their{" "}
                <Code>Failed</Code> and <Code>Partially Paid</Code> are dropped
                — the first belongs to a payment gateway we do not have, the
                second cannot arise while an instruction names one amount. Their{" "}
                <Code>Payment Ordered</Code> is not built: a payment run is a
                second document, and until it exists that state would be a click
                rather than a fact.
              </p>
            </section>

            {/* ── The queue ─────────────────────────────────────────────── */}
            <section className="flex flex-col gap-2">
              <h2 className="text-[0.875rem] font-semibold text-ink">
                Instructions
              </h2>
              {page.rows.length === 0 ? (
                <EmptyState>
                  {status !== "" ? (
                    <>Nothing is on that rung.</>
                  ) : site === "" ? (
                    <>
                      No shop has asked head office to pay anything yet. The
                      document exists —{" "}
                      <Code>POST /api/v1/finance/payment-instructions</Code> —
                      and nothing has been raised against it.
                    </>
                  ) : (
                    <>
                      <SiteName id={site} /> has asked for nothing.
                    </>
                  )}
                </EmptyState>
              ) : (
                <Grid>
                  <thead>
                    <tr>
                      <Th width="9rem">Number</Th>
                      <Th width="7rem">Raised</Th>
                      <Th width="8rem">Site</Th>
                      <Th width="12rem">Pay to</Th>
                      <Th>What for</Th>
                      <Th width="7.5rem">Needed by</Th>
                      <Th width="10rem">State</Th>
                      <Th align="right" width="9rem">
                        Amount
                      </Th>
                    </tr>
                  </thead>
                  <tbody>
                    {page.rows.map((row) => (
                      <AskRow key={row.instruction_id} row={row} />
                    ))}
                  </tbody>
                  <tfoot>
                    <TotalRow>
                      <Td>
                        {page.rows.length} of {page.total}
                      </Td>
                      <Td />
                      <Td />
                      <Td />
                      <Td />
                      <Td />
                      <Td />
                      <Td align="right">{money(page.total_minor)}</Td>
                    </TotalRow>
                  </tfoot>
                </Grid>
              )}
            </section>

            <Note>
              <b>Not one of these six routes posts to the ledger.</b>{" "}
              <Code>POST …</Code> raises one, <Code>…/submit</Code> sends it,{" "}
              <Code>…/decide</Code> is head office&rsquo;s yes or no with a
              reason and the vendor the payee turned out to be — an approval
              keys a DRAFT bill at the asking unit and posts nothing —{" "}
              <Code>…/withdraw</Code> is the shop taking it back, and{" "}
              <Code>…/settle</Code> binds the bill and the payment it became.
              The accounting happens entirely in those two documents, which is
              ERPNext&rsquo;s own arrangement and the reason this one could be
              added without touching a posting rule, a period check or an
              account map entry.
              <br />
              <br />
              <b>Two decisions still open.</b> (1) Does an approved instruction
              go into a <b>payment run</b> — ERPNext&rsquo;s Payment Order, one
              person selecting and another releasing at the bank — or does head
              office pay them one at a time? Nothing is built either way, so an
              approved ask goes straight to <b>Paid</b> when a posted payment
              names it. (2) Does a shop ever pay an approved instruction out of
              the day&rsquo;s takings on head office&rsquo;s word? The policy
              allows it &ldquo;sewaktu-waktu dan kondisional&rdquo;, and if it
              stays, an instruction needs a <Code>settled_by</Code> saying which
              of the two happened — because paying from takings moves that
              evening&rsquo;s banking, and a deposit short for a reason nobody
              recorded is a variance somebody spends a morning on.
            </Note>
          </div>
        ),
      })}
    </PageContent>
  )
}

function AskRow({ row }: { row: PaymentInstruction }) {
  const rung = LADDER.find((entry) => entry.value === row.status)
  return (
    <tr>
      <Td>
        <span className="font-medium text-ink">{row.instruction_number}</span>
        {/* What it became, under the number rather than beside it. A paid ask
            that could not name its payment would make Paid a claim rather than
            a fact about money. */}
        {row.payment_number !== null && (
          <span className="block">
            <Code>{row.payment_number}</Code>
          </span>
        )}
        {/* And what saying yes keys: a DRAFT bill at the asking unit. It is not
            a payment and it is not posted, so the reader can check the coding
            before anything reaches the books. */}
        {row.bill_id !== null && (
          <span className="block">
            <AppLink
              to="/finance/bills"
              sheet={{ key: "bill", value: row.bill_id }}
              className="text-[0.875rem] text-accent hover:underline"
            >
              Draft bill {row.bill_number ?? ""}
            </AppLink>
          </span>
        )}
      </Td>
      <Td className="whitespace-nowrap">{day(row.raised_at)}</Td>
      <Td>
        <SiteName id={row.site_id} />
      </Td>
      <Td>
        {/* Free text until head office resolves it, and the two are drawn
            differently on purpose: a payee is what the shop wrote down, a
            vendor is what somebody with the book decided it was. */}
        {row.supplier_id === null ? (
          <span className="text-body">{row.payee}</span>
        ) : (
          <>
            <SupplierName
              id={row.supplier_id}
              name={row.supplier_name}
              className="text-ink"
            />
            <span className="block text-[0.875rem] text-mute">
              {row.payee}
            </span>
          </>
        )}
      </Td>
      <Td className="text-body">{row.purpose}</Td>
      <Td className="whitespace-nowrap">
        {row.needed_by === null ? (
          <span className="text-hairline-strong">·</span>
        ) : row.late ? (
          // Late is the server's, derived from today and from the ask being
          // unanswered — so a refusal with a past due date is not painted red.
          <span className="text-bad-fg">{day(row.needed_by)}</span>
        ) : (
          day(row.needed_by)
        )}
      </Td>
      <Td>
        <Pill tone={rung?.tone ?? "neutral"}>{rung?.name ?? row.status}</Pill>
        {/* There is no approve control on this screen yet, so the sentence the
            button would carry is said where the decision is read instead:
            saying yes keys a DRAFT bill, it does not post one. */}
        {row.status === "REQUESTED" && (
          <span className="mt-0.5 block text-[0.875rem] leading-snug text-mute">
            Approving keys a DRAFT bill — it does not post anything.
          </span>
        )}
        {/* A no the shop cannot read is a no they will ask about twice, so the
            reason travels with the state rather than hiding in a detail view. */}
        {row.decision_reason !== "" && (
          <span className="mt-0.5 block text-[0.875rem] leading-snug text-mute">
            {row.decision_reason}
          </span>
        )}
      </Td>
      <Td align="right">{money(row.amount_minor)}</Td>
    </tr>
  )
}

// ---------------------------------------------------------------------------
// The ladder
// ---------------------------------------------------------------------------

/// The six states, in the order an ask moves through them.
///
/// Kept as data rather than written into the markup twice: the strip at the top
/// and the pill in every row are the same six states, and two copies is how a
/// diagram and its own legend start disagreeing. `value` is the server's word —
/// 0240's CHECK holds the vocabulary — and `name` is what a person reads.
const LADDER: readonly {
  readonly value: string
  readonly name: string
  readonly tone: PillProps["tone"]
}[] = [
  { value: "DRAFT", name: "Draft", tone: "neutral" },
  { value: "REQUESTED", name: "Requested", tone: "info" },
  { value: "REFUSED", name: "Refused", tone: "bad" },
  { value: "APPROVED", name: "Approved", tone: "accent" },
  { value: "PAID", name: "Paid", tone: "ok" },
  { value: "WITHDRAWN", name: "Withdrawn", tone: "neutral" },
]

/// A rung, or all of them. `""` is "no filter", which is what the server reads
/// an absent `status` as — an empty filter and no filter are one request.
type Rung = "" | string

const RUNGS: readonly { readonly value: Rung; readonly name: string }[] = [
  { value: "", name: "All" },
  ...LADDER.map((rung) => ({ value: rung.value, name: rung.name })),
]
