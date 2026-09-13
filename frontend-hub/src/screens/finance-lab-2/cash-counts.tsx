import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useMemo, useState } from "react"

import type { CashCountRow } from "@itulah/contract"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Dialog, Panel } from "@/components/ui/dialog"
import { Field, Input, Select, Textarea } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { Banner, EmptyState, LoadingState } from "@/components/ui/states"
import { day, money } from "@/lib/format"
import {
  financeKeys,
  listCashCounts,
  postCashCount,
  recordCashCount,
} from "@/lib/queries/finance"
import { parseMinor } from "@/screens/finance/chart"
import { useSiteName } from "@/screens/finance/hooks"
import { CASH_POTS, useMoneyRows } from "@/screens/finance-lab-2/hooks"
import { Grid, LabNote, Td, Th } from "@/screens/finance-lab-2/parts"

/// The rupiah, as it comes out of a drawer.
///
/// Written down rather than generated, because this is the list on the counting
/// sheet the shops already use: seven notes and three coins, largest first, and
/// nothing below a hundred — a drawer is not counted in tens.
const DENOMINATIONS = [
  100_000, 50_000, 20_000, 10_000, 5_000, 2_000, 1_000, 500, 200, 100,
] as const

/// Cash's answer to bank reconciliation.
///
/// A drawer has no statement. What contradicts the ledger is a person standing
/// at the till with the notes in their hand, so this screen is a register of
/// those moments and of what each one found. Two acts, deliberately apart:
/// writing the count down, and deciding to put its difference in the books.
export function CashCounts() {
  const counts = useQuery({
    queryKey: financeKeys.cashCounts(null, null),
    queryFn: ({ signal }) => listCashCounts(signal),
  })
  const { rows: drawers } = useMoneyRows(CASH_POTS)
  const siteName = useSiteName()
  const [counting, setCounting] = useState(false)

  const client = useQueryClient()
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ["finance", "cash-counts"] })
    void client.invalidateQueries({ queryKey: financeKeys.money(null, null) })
  }

  const post = useMutation({
    mutationFn: (input: { countId: string; reason: string }) =>
      postCashCount(input.countId, { reason: input.reason }),
    onSuccess: () => {
      setAsking(null)
      setWhy("")
      refresh()
    },
  })

  // A count saved without a reason is not stuck: the reason can arrive with
  // the decision to post, which is often when somebody actually knows it.
  const [asking, setAsking] = useState<CashCountRow | null>(null)
  const [why, setWhy] = useState("")

  const rows = counts.data ?? []
  const short = rows.filter(
    (row) => row.variance_minor !== 0 && row.entry_id === null
  ).length

  return (
    <PageContent>
      <PageHeader
        crumb="Finance lab 2 · Cash & Bank"
        title="Cash Counts"
        sub="What a person found in the drawer, against what the books say was in it."
        actions={
          <Button variant="primary" onClick={() => setCounting(true)}>
            Count a drawer
          </Button>
        }
      />

      {post.error instanceof Error && (
        <Banner tone="bad">{post.error.message}</Banner>
      )}

      {counts.isPending ? (
        <LoadingState>Reading the counts…</LoadingState>
      ) : rows.length === 0 ? (
        <EmptyState>
          No drawer has been counted yet. Counting one is the only thing that
          can contradict the cash ledger — there is no statement to check it
          against.
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-4">
          <Grid>
            <thead>
              <tr>
                <Th width="7rem">Counted on</Th>
                <Th>Drawer</Th>
                <Th width="9rem">Location</Th>
                <Th align="right" width="8.5rem">
                  Counted
                </Th>
                <Th align="right" width="8.5rem">
                  Per books
                </Th>
                <Th align="right" width="8.5rem">
                  Difference
                </Th>
                <Th width="8rem">Counted by</Th>
                <Th width="9rem">In the books</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.count_id}>
                  <Td>{day(row.counted_on)}</Td>
                  <Td>
                    <span className="text-ink">{row.account_name}</span>
                    {row.reason !== "" && (
                      <span className="mt-0.5 block text-[0.65625rem] text-body italic">
                        {row.reason}
                      </span>
                    )}
                    {row.notes.length > 0 && (
                      <span className="mt-0.5 block text-[0.65625rem] text-mute">
                        {row.notes
                          .map(
                            (note) =>
                              `${money(note.denomination_minor)}×${note.quantity}`
                          )
                          .join(" · ")}
                      </span>
                    )}
                  </Td>
                  <Td>{siteName(row.site_id)}</Td>
                  <Td align="right">{money(row.counted_minor)}</Td>
                  <Td align="right">{money(row.per_books_minor)}</Td>
                  <Td align="right">
                    {row.variance_minor === 0 ? (
                      <Pill tone="ok">agrees</Pill>
                    ) : (
                      <span
                        className={
                          row.variance_minor < 0
                            ? "font-medium text-bad-fg"
                            : "font-medium text-warn-fg"
                        }
                      >
                        {row.variance_minor > 0 ? "+" : ""}
                        {money(row.variance_minor)}
                      </span>
                    )}
                  </Td>
                  <Td>
                    {row.counted_by}
                    {row.witnessed_by !== "" && (
                      <span className="block text-[0.65625rem] text-mute">
                        witnessed by {row.witnessed_by}
                      </span>
                    )}
                  </Td>
                  <Td>
                    {row.entry_number !== null ? (
                      <span className="font-mono text-[0.6875rem] text-mute">
                        {row.entry_number}
                      </span>
                    ) : row.variance_minor === 0 ? (
                      <span className="text-mute">nothing to post</span>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={post.isPending}
                        onClick={() =>
                          row.reason === ""
                            ? setAsking(row)
                            : post.mutate({
                                countId: row.count_id,
                                reason: row.reason,
                              })
                        }
                      >
                        Post difference
                      </Button>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Grid>

          <LabNote>
            {short > 0
              ? `${short} count(s) found a difference that is not in the books yet. `
              : ""}
            A difference posts through the meaning <code>cash_variance</code>,
            never through an account code typed on this screen — so until
            somebody points that meaning at an account on the Account map, the
            server refuses and says which meaning is missing. The count itself
            is still recorded: finding a shortage does not depend on knowing
            where to book it.
          </LabNote>
        </div>
      )}

      <Dialog
        open={asking !== null}
        onOpenChange={(next) => !next && setAsking(null)}
        title="Put the difference in the books"
        confirm="Post the difference"
        pending={post.isPending}
        onConfirm={() =>
          asking !== null &&
          post.mutate({ countId: asking.count_id, reason: why })
        }
      >
        <div className="flex flex-col gap-2.5">
          <p>
            {asking === null
              ? null
              : `${asking.account_name} was counted at ${money(
                  asking.counted_minor
                )} against ${money(asking.per_books_minor)} in the books. Say why before it is booked — it is the only record of the judgement.`}
          </p>
          <Textarea
            value={why}
            onChange={(event) => setWhy(event.target.value)}
            rows={2}
            placeholder="kembalian sore tidak tercatat"
          />
        </div>
      </Dialog>

      <CountPanel
        open={counting}
        drawers={drawers.map((row) => ({
          account_code: row.account_code,
          site_id: row.site_id,
          label: `${row.account_name} — ${siteName(row.site_id)}`,
          per_books_minor: row.per_books_minor,
        }))}
        onClose={() => setCounting(false)}
        onSaved={() => {
          setCounting(false)
          refresh()
        }}
      />
    </PageContent>
  )
}

function CountPanel({
  open,
  drawers,
  onClose,
  onSaved,
}: {
  open: boolean
  drawers: readonly {
    account_code: string
    site_id: string
    label: string
    per_books_minor: number
  }[]
  onClose: () => void
  onSaved: (row: CashCountRow) => void
}) {
  const [drawer, setDrawer] = useState("")
  const [countedOn, setCountedOn] = useState(() =>
    new Date().toISOString().slice(0, 10)
  )
  const [countedBy, setCountedBy] = useState("")
  const [witness, setWitness] = useState("")
  const [reason, setReason] = useState("")
  const [quantities, setQuantities] = useState<Record<number, string>>({})

  const chosen = drawers.find(
    (row) => `${row.account_code}@${row.site_id}` === drawer
  )

  // The breakdown is the working; the total is what it adds up to. Kept derived
  // rather than typed, because a total somebody can type past its own notes is
  // the disagreement the database refuses anyway.
  const counted = useMemo(
    () =>
      DENOMINATIONS.reduce(
        (sum, note) => sum + note * (parseMinor(quantities[note] ?? "") ?? 0),
        0
      ),
    [quantities]
  )
  const variance =
    chosen === undefined ? null : counted - chosen.per_books_minor

  const save = useMutation({
    mutationFn: () =>
      recordCashCount({
        account_code: chosen?.account_code ?? "",
        site_id: chosen?.site_id ?? "",
        counted_on: countedOn,
        counted_by: countedBy.trim(),
        witnessed_by: witness.trim(),
        counted_minor: counted,
        reason: reason.trim(),
        notes: DENOMINATIONS.map((note) => ({
          denomination_minor: note,
          quantity: parseMinor(quantities[note] ?? "") ?? 0,
        })).filter((note) => note.quantity > 0),
      }),
    onSuccess: (row) => {
      setQuantities({})
      setReason("")
      onSaved(row)
    },
  })

  return (
    <Panel
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title="Count a drawer"
      sub="Count the notes, then say why it differs from the books."
    >
      <div className="flex flex-col gap-4">
        {save.error instanceof Error && (
          <Banner tone="bad">{save.error.message}</Banner>
        )}

        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Drawer">
            <Select value={drawer} onChange={setDrawer} aria-label="Drawer">
              <option value="">Choose one</option>
              {drawers.map((row) => (
                <option
                  key={`${row.account_code}@${row.site_id}`}
                  value={`${row.account_code}@${row.site_id}`}
                >
                  {row.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Counted on">
            <Input
              type="date"
              value={countedOn}
              onChange={(event) => setCountedOn(event.target.value)}
            />
          </Field>
          <Field label="Counted by">
            <Input
              value={countedBy}
              onChange={(event) => setCountedBy(event.target.value)}
              placeholder="Sari"
            />
          </Field>
          <Field
            label="Witnessed by"
            hint="A count nobody watched is one person's word about their own drawer."
          >
            <Input
              value={witness}
              onChange={(event) => setWitness(event.target.value)}
              placeholder="Budi"
            />
          </Field>
        </div>

        <Grid>
          <thead>
            <tr>
              <Th>Note</Th>
              <Th align="right" width="7rem">
                How many
              </Th>
              <Th align="right" width="9rem">
                Adds up to
              </Th>
            </tr>
          </thead>
          <tbody>
            {DENOMINATIONS.map((note) => {
              const quantity = parseMinor(quantities[note] ?? "") ?? 0
              return (
                <tr key={note}>
                  <Td>{money(note)}</Td>
                  <Td align="right">
                    <Input
                      inputMode="numeric"
                      value={quantities[note] ?? ""}
                      onChange={(event) =>
                        setQuantities((was) => ({
                          ...was,
                          [note]: event.target.value,
                        }))
                      }
                      className="h-8 w-[5.5rem] text-right"
                      aria-label={`How many ${money(note)} notes`}
                    />
                  </Td>
                  <Td align="right">
                    {quantity === 0 ? (
                      <span className="text-mute">—</span>
                    ) : (
                      money(note * quantity)
                    )}
                  </Td>
                </tr>
              )
            })}
          </tbody>
        </Grid>

        <div className="flex flex-col gap-1.5 rounded-inner border border-hairline bg-soft p-3 text-[0.8125rem]">
          <div className="flex justify-between">
            <span className="text-body">Counted</span>
            <span className="font-medium text-ink tabular-nums">
              {money(counted)}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-body">Per books</span>
            <span className="tabular-nums">
              {chosen === undefined ? "—" : money(chosen.per_books_minor)}
            </span>
          </div>
          <div className="flex justify-between border-t border-hairline pt-1.5">
            <span className="font-medium text-ink">Difference</span>
            <span
              className={
                variance === null
                  ? "text-mute"
                  : variance === 0
                    ? "font-medium text-ok-fg tabular-nums"
                    : "font-medium text-bad-fg tabular-nums"
              }
            >
              {variance === null
                ? "—"
                : `${variance > 0 ? "+" : ""}${money(variance)}`}
            </span>
          </div>
        </div>

        <Field
          label="Why"
          hint="Needed before the difference can be put in the books, not before the count can be saved."
        >
          <Textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={2}
          />
        </Field>

        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={
              save.isPending || chosen === undefined || countedBy.trim() === ""
            }
            onClick={() => save.mutate()}
          >
            Save the count
          </Button>
        </div>
      </div>
    </Panel>
  )
}
