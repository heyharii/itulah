import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useMemo, useState } from "react"

import type { CashCountRow } from "@itulah/contract"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Day } from "@/components/ui/day"
import { Panel } from "@/components/ui/dialog"
import { Field, Input, Select, Textarea } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Toolbar } from "@/components/ui/segmented"
import { Banner, EmptyState, LoadingState } from "@/components/ui/states"
import { day, money } from "@/lib/format"
import {
  financeKeys,
  listCashCounts,
  recordCashCount,
} from "@/lib/queries/finance"
import { useSiteLabel, useUnits } from "@/lib/queries/organisation"
import { parseMinor } from "@/screens/finance/chart"
import { useUnitName } from "@/screens/finance/hooks"
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
  const siteName = useSiteLabel()
  const unitName = useUnitName()
  const [counting, setCounting] = useState(false)

  const client = useQueryClient()
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ["finance", "cash-counts"] })
    void client.invalidateQueries({ queryKey: financeKeys.money(null, null) })
  }

  // Posting a difference used to live here — a button in the table, a dialog
  // asking why, and the mutation behind them. The button is gone at the
  // owner's instruction, so the dialog it was the only door to went with it.
  // `postCashCount` is still the server's route and `entry_number` still says
  // which counts reached the books; what is missing is a way in, and that is a
  // decision about the screen rather than something left half-built.

  /// What narrows the list. A month of counts across thirteen shops is four
  /// hundred rows, and the three questions people arrive with are "when",
  /// "where" and "who counted it".
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [unit, setUnit] = useState("")
  const [who, setWho] = useState("")

  const all = useMemo(() => counts.data ?? [], [counts.data])

  /// The units and the counters actually present, rather than every site and
  /// every member of staff: a picker offering an answer that returns nothing
  /// is a picker that wastes a click to prove it.
  const units = useMemo(
    () =>
      [...new Set(all.map((row) => row.site_id))]
        .map((id) => ({ value: id, label: siteName(id) }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [all, siteName]
  )
  const counters = useMemo(
    () => [...new Set(all.map((row) => row.counted_by))].sort(),
    [all]
  )

  const rows = useMemo(
    () =>
      all.filter((row) => {
        if (from !== "" && row.counted_on < from) return false
        if (to !== "" && row.counted_on > to) return false
        if (unit !== "" && row.site_id !== unit) return false
        if (who !== "" && row.counted_by !== who) return false
        return true
      }),
    [all, from, to, unit, who]
  )
  const narrowed = from !== "" || to !== "" || unit !== "" || who !== ""
  const short = rows.filter(
    (row) => row.variance_minor !== 0 && row.entry_id === null
  ).length

  return (
    <PageContent>
      <PageHeader
        crumb="Finance lab 2 · Cash & Bank"
        title="Cash Counts"
        sub="What a person found in the box, against what the books say was in it."
        actions={
          <Button variant="primary" onClick={() => setCounting(true)}>
            Count an account
          </Button>
        }
      />

      <Toolbar className="mb-4">
        <Day
          value={from}
          onChange={setFrom}
          notAfter={to === "" ? null : to}
          label="From date"
          className="h-8 w-36"
        />
        <span aria-hidden className="text-mute">
          →
        </span>
        <Day
          value={to}
          onChange={setTo}
          notBefore={from === "" ? null : from}
          label="To date"
          className="h-8 w-36"
        />
        <Select
          aria-label="Unit"
          value={unit}
          onChange={setUnit}
          className="h-8 w-44"
        >
          <option value="">All units</option>
          {units.map((one) => (
            <option key={one.value} value={one.value}>
              {one.label}
            </option>
          ))}
        </Select>
        <Select
          aria-label="Counted by"
          value={who}
          onChange={setWho}
          className="h-8 w-44"
        >
          <option value="">Anyone counting</option>
          {counters.map((one) => (
            <option key={one} value={one}>
              {one}
            </option>
          ))}
        </Select>
      </Toolbar>

      {counts.isPending ? (
        <LoadingState>Reading the counts…</LoadingState>
      ) : rows.length === 0 ? (
        narrowed ? (
          <EmptyState>No count matches these filters.</EmptyState>
        ) : (
          <EmptyState>
            No cash account has been counted yet. Counting one is the only thing
            that can contradict the cash ledger — there is no statement to check
            it against.
          </EmptyState>
        )
      ) : (
        <div className="flex flex-col gap-4">
          <Card className="overflow-hidden">
            <Grid>
              <thead>
                <tr>
                  <Th width="7rem">Date</Th>
                  <Th>Account</Th>
                  <Th width="9rem">Unit</Th>
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
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.count_id}>
                    <Td>{day(row.counted_on)}</Td>
                    {/* The account, and nothing under it.
                  
                      The reason a count was out ("Selisih kembalian, belum
                      ketemu") and the note breakdown were set in italics
                      below the name, where they turned a one-line row into a
                      four-line one and pushed the figures they explain off
                      the screen. Both are still on the record; neither is a
                      column. */}
                    <Td>
                      <span className="text-ink">{row.account_name}</span>
                    </Td>
                    <Td>{siteName(row.site_id)}</Td>
                    <Td align="right">{money(row.counted_minor)}</Td>
                    <Td align="right">{money(row.per_books_minor)}</Td>
                    {/* A figure, not a word. The column is headed Difference
                      and every other cell in it is money, so a count that
                      found none reads `0` — a pill saying "agrees" made the
                      one row nobody needs to look at the most decorated thing
                      in the table, and broke the column the eye scans down. */}
                    <Td align="right">
                      {row.variance_minor === 0 ? (
                        <span className="text-mute">0</span>
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
                    <Td>{row.counted_by}</Td>
                  </tr>
                ))}
              </tbody>
            </Grid>
          </Card>

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

      <CountPanel
        open={counting}
        drawers={drawers.map((row) => ({
          account_code: row.account_code,
          unit_id: row.unit_id,
          label: `${row.account_name} — ${unitName(row.unit_id)}`,
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
    unit_id: string
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
    (row) => `${row.account_code}@${row.unit_id}` === drawer
  )

  // The drawer is in a unit's books; the count is taken at one of its sites.
  // A unit with one site (a store and its shop) needs no question; one with
  // several (head office's office and the Gudang) is asked which.
  const units = useUnits()
  const [siteChoice, setSiteChoice] = useState("")
  const sites =
    units.data?.find((unit) => unit.id === chosen?.unit_id)?.sites ?? []
  const siteId =
    sites.length === 1
      ? sites[0].id
      : sites.some((site) => site.id === siteChoice)
        ? siteChoice
        : ""

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
        site_id: siteId,
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
      title="Count an account"
      sub="Count the notes, then say why it differs from the books."
    >
      <div className="flex flex-col gap-4">
        {save.error instanceof Error && (
          <Banner tone="bad">{save.error.message}</Banner>
        )}

        <div className="grid gap-3 md:grid-cols-2">
          {/* "Account", not "Drawer". A till drawer is one of the things
              counted; petty cash at head office is another, and a cashier's
              float a third. What they have in common is that each is a cash
              ACCOUNT at a place — the same word Bank Accounts uses for the
              other half of the money — so a screen that says "drawer" is
              naming one of three and mislabelling the rest. */}
          <Field label="Account" required>
            <Select value={drawer} onChange={setDrawer} aria-label="Account">
              <option value="">Choose one</option>
              {drawers.map((row) => (
                <option
                  key={`${row.account_code}@${row.unit_id}`}
                  value={`${row.account_code}@${row.unit_id}`}
                >
                  {row.label}
                </option>
              ))}
            </Select>
          </Field>
          {sites.length > 1 && (
            <Field label="Site" required>
              <Select value={siteId} onChange={setSiteChoice} aria-label="Site">
                <option value="">Choose one</option>
                {sites.map((site) => (
                  <option key={site.id} value={site.id}>
                    {site.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label="Counted on" required>
            <Input
              type="date"
              value={countedOn}
              onChange={(event) => setCountedOn(event.target.value)}
            />
          </Field>
          <Field label="Counted by" required>
            <Input
              value={countedBy}
              onChange={(event) => setCountedBy(event.target.value)}
            />
          </Field>
          <Field
            label="Witnessed by"
            hint="A count nobody watched is one person's word about their own drawer."
          >
            <Input
              value={witness}
              onChange={(event) => setWitness(event.target.value)}
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

        <div className="flex flex-col gap-1.5 rounded-inner border border-hairline bg-soft p-3 text-[0.9375rem]">
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
          <Button data-cancel variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            pending={save.isPending}
            disabled={
              chosen === undefined || siteId === "" || countedBy.trim() === ""
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
