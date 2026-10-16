import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Field, Input, Money, Select } from "@/components/ui/field"
import { Status } from "@/components/ui/pill"
import {
  EmptyState,
  ErrorState,
  LoadingState,
  Problem,
} from "@/components/ui/states"
import { node } from "@/lib/api"
import { money, moment } from "@/lib/format"
import { financeKeys } from "@/lib/queries/finance"
import { Grid, Td, Th } from "@/screens/finance-final/parts"
import type { ExpenseCodeView, IssueExpenseCodeRequest } from "@itulah/contract"

/// Finance › Stores › Petty cash › Approval codes. A shop expense above the
/// line (Accounts Settings › Expense code above) needs one of these: one shop,
/// one use, up to an amount, until a time.

const codesKey = (unitId: string) =>
  [...financeKeys.all, "expense-codes", unitId] as const

function endOfDay(daysAhead: number): string {
  const at = new Date()
  at.setDate(at.getDate() + daysAhead)
  at.setHours(23, 59, 59, 0)
  return at.toISOString()
}

const STATUS: Record<
  string,
  { word: string; tone: "ok" | "neutral" | "done" | "bad" }
> = {
  OPEN: { word: "Open", tone: "ok" },
  USED: { word: "Used", tone: "done" },
  EXPIRED: { word: "Expired", tone: "neutral" },
  CANCELLED: { word: "Cancelled", tone: "neutral" },
}

export function ExpenseCodes({ unitId }: { unitId: string }) {
  const client = useQueryClient()
  const [ceiling, setCeiling] = useState("")
  const [until, setUntil] = useState("0")
  const [note, setNote] = useState("")
  const [fresh, setFresh] = useState<ExpenseCodeView | null>(null)

  const codes = useQuery({
    queryKey: codesKey(unitId),
    queryFn: ({ signal }) =>
      node.get<ExpenseCodeView[]>(
        `/api/v1/store-money/expense-codes?unit=${encodeURIComponent(unitId)}`,
        { signal }
      ),
  })

  const issue = useMutation({
    mutationFn: () => {
      const request: IssueExpenseCodeRequest = {
        unit_id: unitId,
        ceiling_minor: Number(ceiling),
        expires_at: endOfDay(Number(until)),
        note: note.trim() === "" ? null : note.trim(),
      }
      return node.post<ExpenseCodeView>(
        "/api/v1/store-money/expense-codes",
        request
      )
    },
    onSuccess: (made) => {
      setFresh(made)
      setCeiling("")
      setNote("")
      void client.invalidateQueries({ queryKey: codesKey(unitId) })
    },
  })

  const cancel = useMutation({
    mutationFn: (id: string) =>
      node.post<ExpenseCodeView>(
        `/api/v1/store-money/expense-codes/${id}/cancel`,
        {}
      ),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: codesKey(unitId) })
    },
  })

  const ready = Number(ceiling) > 0

  return (
    <div className="flex flex-col gap-6">
      <form
        className="flex flex-wrap items-end gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          if (ready && !issue.isPending) issue.mutate()
        }}
      >
        <Field label="Up to">
          <Money
            value={ceiling}
            onChange={setCeiling}
            prefix="Rp"
            className="w-44"
            label="Up to"
          />
        </Field>
        <Field label="Valid until">
          <Select
            value={until}
            onChange={setUntil}
            className="w-44"
            aria-label="Valid until"
          >
            <option value="0">End of today</option>
            <option value="1">End of tomorrow</option>
          </Select>
        </Field>
        <Field label="Note">
          <Input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            className="w-64"
          />
        </Field>
        <Button
          type="submit"
          variant="primary"
          pending={issue.isPending}
          disabled={!ready}
        >
          {issue.isPending ? "Submitting…" : "Submit"}
        </Button>
      </form>
      <Problem error={issue.error} />

      {fresh !== null && (
        <div className="flex items-baseline gap-4 rounded-card border border-hairline px-5 py-4">
          <span className="font-mono text-[1.75rem] font-semibold tracking-[0.2em] text-ink">
            {fresh.code}
          </span>
          <span className="text-body">
            Up to {money(fresh.ceiling_minor)} · until{" "}
            {moment(fresh.expires_at)}
          </span>
        </div>
      )}

      {codes.isPending ? (
        <LoadingState>Reading codes…</LoadingState>
      ) : codes.isError ? (
        <ErrorState error={codes.error} />
      ) : codes.data.length === 0 ? (
        <EmptyState>No codes yet.</EmptyState>
      ) : (
        <>
          <Problem error={cancel.error} />
          <Grid>
            <thead>
              <tr>
                <Th width="8rem">Code</Th>
                <Th align="right" width="10rem">
                  Up to
                </Th>
                <Th width="10rem">Until</Th>
                <Th width="8rem">Status</Th>
                <Th align="right" width="10rem">
                  Spent
                </Th>
                <Th>Note</Th>
                <Th width="7rem" />
              </tr>
            </thead>
            <tbody>
              {codes.data.map((one) => {
                const status = STATUS[one.status] ?? STATUS.EXPIRED
                return (
                  <tr key={one.id}>
                    <Td className="font-mono text-ink">{one.code}</Td>
                    <Td align="right">{money(one.ceiling_minor)}</Td>
                    <Td className="text-body">{moment(one.expires_at)}</Td>
                    <Td>
                      <Status tone={status.tone}>{status.word}</Status>
                    </Td>
                    <Td align="right">
                      {one.used_amount_minor === null ? (
                        <span className="text-mute">·</span>
                      ) : (
                        money(one.used_amount_minor)
                      )}
                    </Td>
                    <Td className="max-w-0">
                      <span className="block truncate text-body">
                        {one.note ?? ""}
                      </span>
                    </Td>
                    <Td align="right">
                      {one.status === "OPEN" && (
                        <Button data-cancel
                          size="sm"
                          variant="quiet"
                          pending={
                            cancel.isPending && cancel.variables === one.id
                          }
                          onClick={() => cancel.mutate(one.id)}
                        >
                          Cancel
                        </Button>
                      )}
                    </Td>
                  </tr>
                )
              })}
            </tbody>
          </Grid>
        </>
      )}
    </div>
  )
}
