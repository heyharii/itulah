import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Plus, Trash2 } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Day } from "@/components/ui/day"
import { Field, Input, Textarea } from "@/components/ui/field"
import { Sheet } from "@/components/ui/sheet"
import { Banner } from "@/components/ui/states"
import { today } from "@/lib/calendar"
import { money } from "@/lib/format"
import { recordJournal, type ManualJournalLine } from "@/lib/queries/finance"
import { cn } from "@/lib/utils"
import {
  AccountAndCategory,
  accountChoiceReady,
  UnitSelect,
  type AccountChoice,
} from "@/screens/finance/parts"
import { Grid, Td, Th } from "@/screens/finance-lab-2/parts"
import { useIdempotencyKey } from "@/screens/procurement/shared"

/// One row of the grid, before it is a posting line.
///
/// The figures are held as TYPED TEXT, not as numbers. A debit box that
/// rewrites "1.0" as "1" under the cursor is a box people fight, and a half
/// typed amount is not yet a quantity — see `<Money>`, which makes the same
/// argument for the same reason.
interface Row {
  readonly key: string
  /// The account AND the category it owes, as one answer.
  ///
  /// They are one answer because the database treats them as one: `6301 Biaya
  /// Administrasi dan Umum` is the report line and the category is what the
  /// money was for, and an account that declares a family refuses a line
  /// without one. Two separate boxes let somebody fill in half of a fact.
  /// `AccountAndCategory` already knows this rule; this reuses it rather than
  /// restating it.
  choice: AccountChoice | null
  /// Whose books the line is in: a unit id.
  unit: string
  debit: string
  credit: string
  memo: string
}

const blankRow = (): Row => ({
  key: crypto.randomUUID(),
  choice: null,
  unit: "",
  debit: "",
  credit: "",
  memo: "",
})

/// Rupiah typed into a box, as minor units. `""` and nonsense are both zero —
/// the totals below are a running reading of a form being filled in, not a
/// validation of it.
function minor(text: string): number {
  const digits = text.replace(/[^0-9]/g, "")
  return digits === "" ? 0 : Number(digits) * 100
}

/// Writing a journal entry by hand.
///
/// # Why this is a sheet and not a screen
///
/// It is a TASK. It opens over the ledger somebody was reading, it ends when
/// the entry is posted or abandoned, and there is nothing to come back to: an
/// entry that exists is on the Journal, and one that does not was never
/// anything. The same reason the order composer is a sheet.
///
/// # Why there is no draft
///
/// `poster::post` writes a balanced entry or refuses. There is no half-posted
/// state on the server and inventing one in the browser would mean holding
/// numbers that the books have never agreed to. Save is the only write.
export function JournalEntrySheet({
  open,
  onClose,
  onPosted,
}: {
  open: boolean
  onClose: () => void
  onPosted?: (entryNumber: string) => void
}) {
  const client = useQueryClient()
  const idempotency = useIdempotencyKey()

  const [date, setDate] = useState(today)
  const [memo, setMemo] = useState("")
  const [rows, setRows] = useState<readonly Row[]>(() => [
    blankRow(),
    blankRow(),
  ])

  const debits = rows.reduce((sum, row) => sum + minor(row.debit), 0)
  const credits = rows.reduce((sum, row) => sum + minor(row.credit), 0)
  const difference = debits - credits

  const set = (key: string, patch: Partial<Row>) => {
    // The last refusal is about the entry as it WAS. Editing a row answers
    // it — or fails differently — and leaving the old sentence on screen
    // makes a fixed line look broken. Cleared on the first keystroke, not on
    // the next Post.
    if (post.isError) post.reset()
    setRows((was) =>
      was.map((row) => (row.key === key ? { ...row, ...patch } : row))
    )
  }

  /// A row is worth sending when it names an account, a unit and one side.
  /// Rows that name nothing are the empty grid lines every entry ends with,
  /// and dropping them is not a judgement — they are not lines.
  const lines: ManualJournalLine[] = rows
    .filter(
      (row) =>
        accountChoiceReady(row.choice) &&
        row.unit !== "" &&
        (minor(row.debit) > 0 || minor(row.credit) > 0)
    )
    .map((row) => ({
      account: {
        kind: "account" as const,
        account_code: row.choice!.account_code,
        category_code: row.choice!.category_code,
      },
      unit_id: row.unit,
      debit_minor: minor(row.debit),
      credit_minor: minor(row.credit),
      memo: row.memo === "" ? null : row.memo,
    }))

  const post = useMutation({
    mutationFn: () =>
      recordJournal(
        { posting_date: date, memo: memo === "" ? null : memo, lines },
        idempotency.key
      ),
    onSuccess: (entry) => {
      void client.invalidateQueries({ queryKey: ["finance"] })
      idempotency.rotate()
      onPosted?.(entry.entry_number)
      reset()
      onClose()
    },
  })

  const reset = () => {
    setRows([blankRow(), blankRow()])
    setMemo("")
    setDate(today())
    post.reset()
  }

  // Balanced, and with something in it. The server checks both and refuses in
  // a sentence; saying it here first saves a round trip and, more to the
  // point, tells somebody what is wrong while they can still see the row.
  const ready = lines.length >= 2 && difference === 0 && debits > 0

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && (reset(), onClose())}
      title="Journal Entry"
      caption="A posting written by hand. It balances or it is refused; there is no draft."
      width="workspace"
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className="text-[0.875rem] text-mute">
            {difference === 0
              ? `${money(debits)} each side`
              : `Out by ${money(Math.abs(difference))}`}
          </span>
          <span className="flex items-center gap-2">
            <Button variant="ghost" onClick={() => (reset(), onClose())}>
              Cancel
            </Button>
            <Button
              variant="primary"
              pending={post.isPending}
              disabled={!ready}
              onClick={() => post.mutate()}
            >
              {post.isPending ? "Posting…" : "Post the entry"}
            </Button>
          </span>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {post.isError && (
          <Banner tone="bad">{(post.error as Error).message}</Banner>
        )}

        {/* The date alone at the top. There is no "Journal no." box beside
            it, and that is deliberate: the number is `journal_entry_number_seq`
            on the server, issued when the entry posts. A box for it would be
            a field somebody could type a lie into. */}
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Journal date">
            <Day
              value={date}
              onChange={setDate}
              label="Journal date"
              clearable={false}
            />
          </Field>
        </div>

        <Grid>
          <thead>
            <tr>
              <Th width="2rem">#</Th>
              <Th>Account</Th>
              <Th width="10rem">Unit</Th>
              <Th align="right" width="10rem">
                Debit
              </Th>
              <Th align="right" width="10rem">
                Credit
              </Th>
              <Th>Description</Th>
              <Th width="3rem" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.key}>
                <Td className="text-mute">{index + 1}</Td>
                <Td>
                  <AccountAndCategory
                    value={row.choice}
                    onChange={(next) => set(row.key, { choice: next })}
                    placeholder="Choose an account"
                    categoryLabel={`Category on line ${index + 1}`}
                  />
                </Td>
                <Td>
                  <UnitSelect
                    aria-label={`Unit on line ${index + 1}`}
                    value={row.unit}
                    onChange={(id) => set(row.key, { unit: id })}
                    emptyLabel="Choose"
                    className="h-8"
                  />
                </Td>
                {/* One side or the other. Typing into debit empties credit,
                    because a line that is both is not a line — and the server
                    refuses it, later and further away. */}
                <Td align="right">
                  <Input
                    value={row.debit}
                    onChange={(event) =>
                      set(row.key, { debit: event.target.value, credit: "" })
                    }
                    inputMode="numeric"
                    placeholder="0"
                    className={cn("h-8 text-right tabular-nums")}
                    aria-label={`Debit on line ${index + 1}`}
                  />
                </Td>
                <Td align="right">
                  <Input
                    value={row.credit}
                    onChange={(event) =>
                      set(row.key, { credit: event.target.value, debit: "" })
                    }
                    inputMode="numeric"
                    placeholder="0"
                    className={cn("h-8 text-right tabular-nums")}
                    aria-label={`Credit on line ${index + 1}`}
                  />
                </Td>
                <Td>
                  <Input
                    value={row.memo}
                    onChange={(event) =>
                      set(row.key, { memo: event.target.value })
                    }
                    className="h-8"
                    aria-label={`Description on line ${index + 1}`}
                  />
                </Td>
                <Td align="right">
                  <Button
                    variant="quiet"
                    size="icon"
                    aria-label={`Remove line ${index + 1}`}
                    disabled={rows.length <= 2}
                    onClick={() =>
                      setRows((was) => was.filter((one) => one.key !== row.key))
                    }
                  >
                    <Trash2 />
                  </Button>
                </Td>
              </tr>
            ))}
            <tr>
              <Td />
              <Td className="text-mute">Total</Td>
              <Td />
              <Td align="right" className="font-medium text-ink">
                {money(debits)}
              </Td>
              <Td align="right" className="font-medium text-ink">
                {money(credits)}
              </Td>
              <Td
                className={
                  difference === 0 ? "text-mute" : "font-medium text-bad-fg"
                }
              >
                {difference === 0
                  ? ""
                  : `Out by ${money(Math.abs(difference))}`}
              </Td>
              <Td />
            </tr>
          </tbody>
        </Grid>

        <div className="flex items-center gap-2">
          <Button onClick={() => setRows((was) => [...was, blankRow()])}>
            <Plus className="size-4" />
            Add line
          </Button>
          <Button
            variant="quiet"
            onClick={() => setRows([blankRow(), blankRow()])}
          >
            Clear all lines
          </Button>
        </div>

        <Field
          label="Memo"
          hint="What the entry as a whole is about. A line's own description is its own field."
        >
          <Textarea
            rows={2}
            value={memo}
            onChange={(event) => setMemo(event.target.value)}
            placeholder="Reklas biaya listrik Agustus"
          />
        </Field>
      </div>
    </Sheet>
  )
}
