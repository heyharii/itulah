import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Day } from "@/components/ui/day"
import { Input } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { Toolbar } from "@/components/ui/segmented"
import {
  Banner,
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/ui/states"
import { count, day, money, moment } from "@/lib/format"
import {
  generateSalesPosting,
  listSalesPostings,
  postSalesPosting,
  salesPostingDetail,
  salesPostingKeys,
  type SalesPosting,
} from "@/lib/queries/sales-postings"
import { financeKeys } from "@/lib/queries/finance"
import { useLocations } from "@/screens/finance/hooks"
import { LocationSelect } from "@/screens/finance/parts"
import { Grid, Td, Th, TotalRow } from "@/screens/finance-final/parts"
import { todayIso } from "@/screens/finance/chart"

/// The daily bridge from POS receipts to the general ledger.
///
/// This screen uses the Cloud's existing sales-posting endpoints. It does not
/// calculate a second set of accounting figures in the browser: generating a
/// draft asks the server to read synced sales, promotions, tenders and tax,
/// while posting uses the same ledger poster as every other finance document.
export function SalesPostings() {
  const today = todayIso()
  const [site, setSite] = useState("")
  const [month, setMonth] = useState(today.slice(0, 7))
  const [businessDate, setBusinessDate] = useState(today)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [confirmPostId, setConfirmPostId] = useState<string | null>(null)
  const queryClient = useQueryClient()
  const locations = useLocations()

  const list = useQuery({
    queryKey: salesPostingKeys.list(site, month),
    queryFn: ({ signal }) => listSalesPostings(site, month, signal),
    enabled: site !== "" && month !== "",
  })
  const rows = useMemo(() => list.data ?? [], [list.data])
  const detail = useQuery({
    queryKey: salesPostingKeys.detail(selectedId),
    queryFn: ({ signal }) => salesPostingDetail(selectedId!, signal),
    enabled: selectedId !== null,
  })

  const generate = useMutation({
    mutationFn: (request: Parameters<typeof generateSalesPosting>[0]) =>
      generateSalesPosting(request),
    onSuccess: async (document) => {
      queryClient.setQueryData(
        salesPostingKeys.detail(document.posting.posting_id),
        document
      )
      setSelectedId(document.posting.posting_id)
      await queryClient.invalidateQueries({ queryKey: salesPostingKeys.all })
    },
  })
  const post = useMutation({
    mutationFn: (id: string) => postSalesPosting(id),
    onSuccess: async (document) => {
      setConfirmPostId(null)
      queryClient.setQueryData(
        salesPostingKeys.detail(document.posting.posting_id),
        document
      )
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: salesPostingKeys.all }),
        queryClient.invalidateQueries({ queryKey: ["finance", "journal"] }),
        queryClient.invalidateQueries({
          queryKey: ["finance", "trial-balance"],
        }),
        queryClient.invalidateQueries({
          queryKey: financeKeys.accountLinksAll,
        }),
      ])
      setSelectedId(document.posting.posting_id)
    },
  })

  const selected = detail.data?.posting ?? null

  return (
    <PageContent>
      <PageHeader
        crumb="Finance · Receivables"
        title="Sales postings"
        sub="Generate a reviewable daily draft from POS sales synced to Cloud, then post it into the ledger."
      />

      <Toolbar>
        <LocationSelect
          value={site}
          onChange={(value) => {
            setSite(value)
            setSelectedId(null)
          }}
          emptyLabel="Choose a location"
          className="h-8 w-44"
        />
        <label className="flex items-center gap-2 text-[0.875rem] text-mute">
          Month
          <Input
            aria-label="Sales posting month"
            type="month"
            value={month}
            onChange={(event) => setMonth(event.target.value)}
            className="h-8 w-40 px-2 text-[0.875rem]"
          />
        </label>
        <Toolbar.Spacer />
        <span className="text-[0.875rem] text-mute">
          {count(rows.length)} posting documents
        </span>
      </Toolbar>

      <section className="flex flex-wrap items-end gap-2 rounded-card border border-hairline bg-canvas p-3">
        <label className="flex flex-col gap-1 text-[0.875rem] text-mute">
          Generate or refresh draft for business date
          <Day
            value={businessDate}
            onChange={setBusinessDate}
            label="Business date"
            clearable={false}
            className="w-44"
          />
        </label>
        <Button
          variant="primary"
          disabled={
            site === "" ||
            businessDate === "" ||
            generate.isPending ||
            locations.isPending
          }
          onClick={() =>
            generate.mutate({ site_id: site, business_date: businessDate })
          }
        >
          {generate.isPending ? "Generating…" : "Generate draft"}
        </Button>
        <span className="max-w-xl text-[0.875rem] leading-relaxed text-mute">
          The Cloud reads only sales already synced for this shop and date. A
          posted day cannot be regenerated until it is formally reversed.
        </span>
      </section>

      {generate.isError && (
        <Banner tone="bad">
          {generate.error instanceof Error
            ? generate.error.message
            : "The sales posting draft was refused."}
        </Banner>
      )}
      {post.isError && (
        <Banner tone="bad">
          {post.error instanceof Error
            ? post.error.message
            : "The sales posting was refused."}
        </Banner>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-[0.875rem] font-semibold text-ink">
          Daily posting documents
        </h2>
        {list.error ? (
          <ErrorState error={list.error} />
        ) : list.isPending ? (
          <LoadingState>Reading Cloud sales postings…</LoadingState>
        ) : rows.length === 0 ? (
          <EmptyState>
            No sales posting exists for this location and month. Choose a day
            above to generate a draft from synced POS sales.
          </EmptyState>
        ) : (
          <Grid>
            <thead>
              <tr>
                <Th>Business date</Th>
                <Th>Status</Th>
                <Th align="right">Sales</Th>
                <Th align="right">Gross takings</Th>
                <Th align="right">Discounts</Th>
                <Th align="right">Output VAT</Th>
                <Th>Journal</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <PostingRow
                  key={row.posting_id}
                  row={row}
                  selected={row.posting_id === selectedId}
                  onSelect={() => {
                    setConfirmPostId(null)
                    setSelectedId(row.posting_id)
                  }}
                />
              ))}
            </tbody>
          </Grid>
        )}
      </section>

      {selectedId !== null && (
        <section className="flex flex-col gap-3 rounded-card border border-hairline bg-canvas p-4">
          {detail.error ? (
            <ErrorState error={detail.error} />
          ) : detail.isPending || selected === null ? (
            <LoadingState>Reading the posting detail…</LoadingState>
          ) : (
            <>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-[0.875rem] font-semibold text-ink">
                      {day(selected.business_date)} · {selected.site_id}
                    </h2>
                    <Status status={selected.status} />
                  </div>
                  <p className="mt-1 text-[0.875rem] text-mute">
                    Generated {moment(selected.generated_at)} by{" "}
                    {selected.generated_by}
                    {selected.entry_number
                      ? ` · journal ${selected.entry_number}`
                      : ""}
                  </p>
                </div>
                {selected.status === "DRAFT" &&
                  (confirmPostId === selected.posting_id ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[0.875rem] text-warn-fg">
                        This creates the day's journal entry.
                      </span>
                      <Button
                        variant="primary"
                        disabled={post.isPending}
                        onClick={() => post.mutate(selected.posting_id)}
                      >
                        {post.isPending ? "Posting…" : "Confirm post"}
                      </Button>
                      <Button
                        variant="quiet"
                        disabled={post.isPending}
                        onClick={() => setConfirmPostId(null)}
                      >
                        Keep as draft
                      </Button>
                    </div>
                  ) : (
                    <Button
                      variant="primary"
                      onClick={() => setConfirmPostId(selected.posting_id)}
                    >
                      Post to ledger
                    </Button>
                  ))}
              </div>

              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                <Metric label="Sales" value={count(selected.sale_count)} />
                <Metric
                  label="Gross takings"
                  value={money(selected.gross_minor)}
                />
                <Metric label="Settled" value={money(selected.settled_minor)} />
                <Metric
                  label="Discounts"
                  value={money(selected.discount_minor)}
                />
                <Metric label="Output VAT" value={money(selected.vat_minor)} />
              </div>

              <div className="flex flex-col gap-2">
                <h3 className="text-[0.875rem] font-semibold text-ink">
                  Tender split
                </h3>
                <Grid>
                  <thead>
                    <tr>
                      <Th>Tender</Th>
                      <Th>Acquirer</Th>
                      <Th align="right">Receipts</Th>
                      <Th align="right">Gross</Th>
                      <Th align="right">Discount</Th>
                      <Th align="right">Returns</Th>
                      <Th align="right">VAT</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.data.lines.map((line) => (
                      <tr key={line.line_id}>
                        <Td>
                          {line.method}
                          {line.card_kind ? ` · ${line.card_kind}` : ""}
                          {line.card_kind_inferred ? " · inferred" : ""}
                        </Td>
                        <Td>{line.acquirer || "—"}</Td>
                        <Td align="right">{count(line.tender_count)}</Td>
                        <Td align="right">{money(line.gross_minor)}</Td>
                        <Td align="right">{money(line.discount_minor)}</Td>
                        <Td align="right">{money(line.returns_minor)}</Td>
                        <Td align="right">{money(line.vat_minor)}</Td>
                      </tr>
                    ))}
                    <TotalRow>
                      <Td colSpan={2}>Day total</Td>
                      <Td align="right">
                        {count(
                          detail.data.lines.reduce(
                            (sum, line) => sum + line.tender_count,
                            0
                          )
                        )}
                      </Td>
                      <Td align="right">{money(selected.gross_minor)}</Td>
                      <Td align="right">{money(selected.discount_minor)}</Td>
                      <Td align="right">{money(selected.returns_minor)}</Td>
                      <Td align="right">{money(selected.vat_minor)}</Td>
                    </TotalRow>
                  </tbody>
                </Grid>
              </div>
              <p className="text-[0.875rem] text-mute">
                VAT source: {selected.vat_source} · rate{" "}
                {selected.vat_rate_bps / 100}% · generated{" "}
                {moment(selected.generated_at)}
              </p>
            </>
          )}
        </section>
      )}
    </PageContent>
  )
}

function PostingRow({
  row,
  selected,
  onSelect,
}: {
  row: SalesPosting
  selected: boolean
  onSelect: () => void
}) {
  return (
    <tr className={selected ? "bg-soft" : undefined}>
      <Td>{day(row.business_date)}</Td>
      <Td>
        <Status status={row.status} />
      </Td>
      <Td align="right">{count(row.sale_count)}</Td>
      <Td align="right">{money(row.gross_minor)}</Td>
      <Td align="right">{money(row.discount_minor)}</Td>
      <Td align="right">{money(row.vat_minor)}</Td>
      <Td>{row.entry_number ?? "—"}</Td>
      <Td align="right">
        <Button size="sm" variant="quiet" onClick={onSelect}>
          Review
        </Button>
      </Td>
    </tr>
  )
}

function Status({ status }: { status: string }) {
  const tone =
    status === "POSTED" ? "ok" : status === "REVERSED" ? "warn" : "info"
  return <Pill tone={tone}>{status}</Pill>
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-inner border border-hairline bg-soft px-3 py-2">
      <div className="text-[0.875rem] text-mute">{label}</div>
      <div className="mt-0.5 text-[0.875rem] font-semibold text-ink tabular-nums">
        {value}
      </div>
    </div>
  )
}
