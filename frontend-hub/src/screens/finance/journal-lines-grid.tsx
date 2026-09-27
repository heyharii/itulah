import { Plus, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Money } from "@/components/ui/field"
import { SubHead } from "@/components/ui/rows"
import { count, money } from "@/lib/format"
import { Grid, Td, Th, TotalRow } from "@/screens/finance-final/parts"
import {
  blankLine,
  draftTotals,
  type DraftLine,
} from "@/screens/finance/journal-lines"
import { AccountAndCategory, LocationSelect } from "@/screens/finance/parts"

/// The accounting-entries grid: ERPNext's Journal Entry child table, with the
/// unit on every row. One component for the composer and the template editor,
/// so a template is written in exactly the grid an entry is.
export function JournalLinesGrid({
  lines,
  onChange,
}: {
  lines: readonly DraftLine[]
  onChange: (next: DraftLine[]) => void
}) {
  const totals = draftTotals(lines)
  const setLine = (index: number, patch: Partial<DraftLine>) =>
    onChange(
      lines.map((line, at) => (at === index ? { ...line, ...patch } : line))
    )

  return (
    <div>
      <SubHead aside={`${count(lines.length)} rows`}>
        Accounting entries
      </SubHead>
      <Grid>
        <thead>
          <tr>
            <Th>Account</Th>
            <Th width="10rem">Unit</Th>
            <Th align="right" width="8.5rem">
              Debit
            </Th>
            <Th align="right" width="8.5rem">
              Credit
            </Th>
            <Th width="2.5rem" />
          </tr>
        </thead>
        <tbody>
          {lines.map((line, index) => (
            <tr key={index}>
              <Td>
                <AccountAndCategory
                  value={line.account}
                  onChange={(next) => setLine(index, { account: next })}
                  categoryLabel={`Category on row ${index + 1}`}
                />
              </Td>
              <Td>
                <LocationSelect
                  value={line.site_id}
                  onChange={(next) => setLine(index, { site_id: next })}
                  emptyLabel="Choose a unit"
                  className="h-8"
                  aria-label="Unit"
                />
              </Td>
              <Td align="right">
                <Money
                  label={`Debit on row ${index + 1}`}
                  value={line.debit}
                  onChange={(next) => setLine(index, { debit: next })}
                  placeholder="0"
                  className="h-8"
                />
              </Td>
              <Td align="right">
                <Money
                  label={`Credit on row ${index + 1}`}
                  value={line.credit}
                  onChange={(next) => setLine(index, { credit: next })}
                  placeholder="0"
                  className="h-8"
                />
              </Td>
              <Td>
                {lines.length > 2 && (
                  <Button
                    size="sm"
                    variant="quiet"
                    aria-label={`Remove row ${index + 1}`}
                    onClick={() =>
                      onChange(lines.filter((_, at) => at !== index))
                    }
                  >
                    <Trash2 />
                  </Button>
                )}
              </Td>
            </tr>
          ))}
          <TotalRow>
            <Td>Total</Td>
            <Td />
            <Td align="right">{money(totals.debits)}</Td>
            <Td align="right">{money(totals.credits)}</Td>
            <Td />
          </TotalRow>
        </tbody>
      </Grid>
      <Button
        variant="soft"
        className="mt-2.5"
        onClick={() => onChange([...lines, blankLine()])}
      >
        <Plus />
        Add row
      </Button>
    </div>
  )
}
