import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Field, Input, Select, Textarea } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { MiniCell, MiniRow, MiniTable, SubHead } from "@/components/ui/rows"
import { Segmented, Toolbar } from "@/components/ui/segmented"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState } from "@/components/ui/states"
import { useFilters } from "@/lib/filters"
import { label, money, moment } from "@/lib/format"
import {
  checkoutExceptionKeys,
  listCheckoutExceptions,
  resolveCheckoutException,
  type CheckoutException,
  type ExceptionResolution,
} from "@/lib/queries/checkout-exceptions"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"
import { tableSetup, type TableSetup } from "@/lib/table"

/// Charges a branch took that never became a sale.
///
/// # Why this cannot be left to the shop
///
/// A card settles, the sale is never written — the till died between the
/// terminal's answer and the commit, or a second tender declined and the first
/// could not be reversed at the counter. The shopper has been charged and the
/// branch is holding money with nothing behind it.
///
/// And **the branch's own day report balances.** The cash is there, the card
/// batch is there, nothing at all looks wrong locally. That is the whole reason
/// this screen exists rather than a note on the till: the only party who can
/// see a problem is the customer, on their statement, days later, and by then
/// they are ringing the shop rather than being rung.
///
/// # Why the acquirer reference is on the row and not behind a click
///
/// It is the only handle head office has. A branch, a date and an amount is not
/// enough to find one transaction in a day's batch, and finding it is the
/// entire job — so it goes where somebody can copy it while they are on the
/// phone to the bank.
const columns: ColumnDef<TableSetup, CheckoutException>[] = [
  {
    id: "shop",
    accessorFn: (row) => row.site_id ?? row.origin_id,
    header: "Shop",
    size: 140,
    meta: { filter: { kind: "option" } },
    cell: ({ row }) => (
      <span className="font-medium text-ink">
        {row.original.site_id ?? row.original.origin_id}
      </span>
    ),
  },
  {
    id: "resolved_at",
    accessorFn: (row) => row.resolved_at,
    header: "Closed at the till",
    size: 170,
    cell: ({ row }) => moment(row.original.resolved_at),
  },
  {
    id: "money_held_minor",
    accessorFn: (row) => row.money_held_minor,
    header: "Held",
    size: 130,
    // The number a refund is measured from — not the basket total, which is
    // what the shopper was told they owed whether or not it was paid.
    cell: ({ row }) => (
      <span className="font-medium text-ink tabular-nums">
        {money(row.original.money_held_minor)}
      </span>
    ),
  },
  {
    id: "reference",
    accessorFn: (row) =>
      row.tenders
        .filter((tender) => tender.status === "SUCCEEDED")
        .map((tender) => tender.external_reference ?? "—")
        .join(", "),
    header: "Acquirer reference",
    size: 190,
    cell: ({ row }) => {
      const references = row.original.tenders
        .filter((tender) => tender.status === "SUCCEEDED")
        .map((tender) => tender.external_reference ?? "—")
        .join(", ")
      return (
        <span className="font-mono text-[0.875rem]">{references || "—"}</span>
      )
    },
  },
  {
    id: "actor_id",
    accessorFn: (row) => row.actor_id,
    header: "On the till",
    size: 130,
  },
  {
    id: "resolution",
    accessorFn: (row) => row.resolution,
    header: "Answer",
    size: 140,
    meta: { filter: { kind: "option", format: label } },
    cell: ({ row }) => (
      <Pill tone={row.original.resolution === "OPEN" ? "warn" : "neutral"}>
        {row.original.resolution === "OPEN"
          ? "Nobody yet"
          : label(row.original.resolution)}
      </Pill>
    ),
  },
]

export function UnmatchedCharges() {
  const [openOnly, setOpenOnly] = useState(true)
  const client = useQueryClient()
  const chosen = useSheet("charge")

  const exceptions = useQuery({
    queryKey: checkoutExceptionKeys.list(null, openOnly),
    queryFn: ({ signal }) => listCheckoutExceptions(null, openOnly, signal),
  })

  const rows = useMemo(
    () => exceptions.data?.rows ?? [],
    [exceptions.data?.rows]
  )

  const [sorting, setSorting] = useState<SortingState>([
    // Oldest first, and it is not a default worth changing: the cost of one of
    // these is the number of days a shopper spends not having their money.
    { id: "resolved_at", desc: false },
  ])

  const filters = useFilters(columns)

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows as CheckoutException[],
        columns: filters.columns,
        getRowId: (row: CheckoutException) => row.checkout_id,
        state: { columnFilters: filters.columnFilters, sorting },
        onSortingChange: setSorting,
      }),
      [rows, filters.columns, filters.columnFilters, sorting]
    )
  )

  const owed = exceptions.data?.open_money_held_minor ?? 0
  const owedCount = exceptions.data?.open_count ?? 0

  return (
    <PageContent>
      <PageHeader
        crumb="Finance"
        title="Charges without a sale"
        sub="Money a shop took where no sale was written. The shop's own day report balances, so nobody there can see it."
      />

      <Toolbar>
        <Segmented
          options={[
            { value: "open", label: "Still owed" },
            { value: "all", label: "Everything" },
          ]}
          value={openOnly ? "open" : "all"}
          onChange={(next) => setOpenOnly(next === "open")}
        />
      </Toolbar>

      {owedCount > 0 && (
        // Stated before the table rather than inside it, because these two
        // numbers are the reason to look: how many people are owed money, and
        // how much. Summed by the server across everything that matched — a
        // page that totalled itself would report a smaller debt every time
        // somebody narrowed the list.
        <Banner tone="warn" className="mb-3">
          {owedCount === 1
            ? "One shopper is owed "
            : `${owedCount} shoppers are owed `}
          <span className="font-medium tabular-nums">{money(owed)}</span>
          {" — charged with no sale behind it."}
        </Banner>
      )}

      <Card className="overflow-hidden">
        {queryState(exceptions, {
          loading: "Looking for charges nothing was sold against…",
          render: () =>
            rows.length === 0 ? (
              <EmptyState>
                {openOnly
                  ? "Nothing is owed. Every charge a till reported has been answered for."
                  : "No shop has ever reported taking money without writing a sale."}
              </EmptyState>
            ) : (
              <DataTable<CheckoutException>
                table={table}
                onRowClick={(row) => chosen.open(row.checkout_id)}
                isSelected={(row) => row.checkout_id === chosen.value}
                empty="No case matches the filters in force."
                className="max-h-[calc(100vh-20rem)]"
              />
            ),
        })}
      </Card>

      <ChargeSheet
        id={chosen.value ?? null}
        rows={rows}
        onClose={chosen.close}
        onAnswered={() =>
          void client.invalidateQueries({
            queryKey: checkoutExceptionKeys.all,
          })
        }
      />
    </PageContent>
  )
}

/// One case, and the answer somebody has to give it.
///
/// Selected out of the same list the table drew — the same query key, so it
/// costs nothing and cannot disagree with the row that was clicked.
function ChargeSheet({
  id,
  rows,
  onClose,
  onAnswered,
}: {
  id: string | null
  rows: readonly CheckoutException[]
  onClose: () => void
  onAnswered: () => void
}) {
  const found = rows.find((row) => row.checkout_id === id)
  const [resolution, setResolution] = useState("REFUNDED")
  const [who, setWho] = useState("")
  const [note, setNote] = useState("")

  const answer = useMutation({
    mutationFn: () =>
      resolveCheckoutException(id ?? "", {
        resolution: resolution as Exclude<ExceptionResolution, "OPEN">,
        resolved_by: who.trim(),
        note: note.trim() === "" ? null : note.trim(),
      }),
    onSuccess: () => {
      onAnswered()
      onClose()
    },
  })

  return (
    <Sheet
      open={id !== null}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title={
        found === undefined ? "Charge" : (found.site_id ?? found.origin_id)
      }
      id={id ?? undefined}
    >
      {found === undefined ? (
        <EmptyState>
          No case is recorded under this id. It may have been answered in
          another session and this list is from before.
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-5">
          <Facts>
            <Fact term="Held with no sale">
              {money(found.money_held_minor)}
            </Fact>
            <Fact term="Basket came to">{money(found.total_minor)}</Fact>
            <Fact term="On the till">{found.actor_id}</Fact>
            <Fact term="Started">{moment(found.opened_at)}</Fact>
            <Fact term="Closed at the till">{moment(found.resolved_at)}</Fact>
            <Fact term="Reached head office">{moment(found.received_at)}</Fact>
          </Facts>

          {found.last_error !== null && (
            // `info` and not `bad`: this is the till's own account of why it
            // could not finish — context on a case that is already flagged
            // amber, not a second alarm about the same thing.
            <Banner tone="info">{found.last_error}</Banner>
          )}

          <div>
            <SubHead>Tenders</SubHead>
            <MiniTable
              head={[
                "Method",
                { label: "State", align: "left" },
                { label: "Acquirer reference", align: "left" },
                "Amount",
              ]}
            >
              {found.tenders.map((tender) => (
                <MiniRow key={tender.tender_seq}>
                  <MiniCell>{label(tender.method)}</MiniCell>
                  <MiniCell>
                    <Pill
                      tone={tender.status === "SUCCEEDED" ? "warn" : "neutral"}
                    >
                      {label(tender.status)}
                    </Pill>
                  </MiniCell>
                  <MiniCell className="font-mono text-[0.875rem]">
                    {tender.external_reference ?? "—"}
                  </MiniCell>
                  <MiniCell align="right" className="tabular-nums">
                    {money(tender.amount_minor)}
                  </MiniCell>
                </MiniRow>
              ))}
            </MiniTable>
          </div>

          {found.resolution !== "OPEN" ? (
            <Facts>
              <Fact term="Answer">{label(found.resolution)}</Fact>
              <Fact term="By">{found.resolved_by ?? "—"}</Fact>
              <Fact term="When">{moment(found.resolution_at)}</Fact>
              <Fact term="Note">{found.resolution_note ?? "—"}</Fact>
            </Facts>
          ) : (
            <div className="flex flex-col gap-3">
              <SubHead>Answer for it</SubHead>
              {answer.isError && (
                <Banner tone="bad">
                  {answer.error instanceof Error
                    ? answer.error.message
                    : "The case could not be answered."}
                </Banner>
              )}
              <Field label="What was done">
                <Select
                  value={resolution}
                  onChange={setResolution}
                  aria-label="What was done"
                >
                  <option value="REFUNDED">
                    Refunded — the shopper got their money back
                  </option>
                  <option value="RECOVERED_AS_SALE">
                    Written up as a sale — they kept the goods
                  </option>
                  <option value="WRITTEN_OFF">
                    Nothing settled after all — the bank confirmed it
                  </option>
                </Select>
              </Field>
              {/* Not defaulted to the signed-in user: money leaves the business
                  on the strength of this row, and "the system" is not a name an
                  auditor accepts. */}
              <Field label="Who answered for it">
                <Input
                  value={who}
                  onChange={(event) => setWho(event.target.value)}
                  placeholder="A person, by name"
                />
              </Field>
              <Field label="What happened">
                <Textarea
                  rows={3}
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="The reference you quoted, who you spoke to, what they said."
                />
              </Field>
              <Button
                variant="primary"
                onClick={() => answer.mutate()}
                disabled={who.trim() === "" || answer.isPending}
              >
                {answer.isPending ? "Recording…" : "Close this case"}
              </Button>
            </div>
          )}
        </div>
      )}
    </Sheet>
  )
}
