import { Plus, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { AppLink } from "@/components/ui/app-link"
import { Input, Money } from "@/components/ui/field"
import { SubHead } from "@/components/ui/rows"
import { count, money } from "@/lib/format"
import { Code, Grid, Td, Th, TotalRow } from "@/screens/finance-final/parts"
import {
  blankLine,
  draftTotals,
  type DraftLine,
} from "@/screens/finance/journal-lines"
import { AccountAndCategory, UnitSelect } from "@/screens/finance/parts"

/// The accounting-entries grid: ERPNext's Journal Entry child table, with the
/// unit on every row. One component for the composer and the template editor,
/// so a template is written in exactly the grid an entry is.
///
/// `entry` draws it as 7Soft's Transaksi Jurnal detail: Deskripsi Account,
/// Kode Account, Uraian, Debet, Kredit, with Del All and Penyusutan over it
/// and Total and Selisih under it. The unit stays, because the books refuse a
/// line without one.
export function JournalLinesGrid({
  lines,
  onChange,
  entry = false,
}: {
  lines: readonly DraftLine[]
  onChange: (next: DraftLine[]) => void
  entry?: boolean
}) {
  const totals = draftTotals(lines)
  const setLine = (index: number, patch: Partial<DraftLine>) =>
    onChange(
      lines.map((line, at) => (at === index ? { ...line, ...patch } : line))
    )

  const selisih = totals.debits - totals.credits

  return (
    <div>
      <SubHead aside={`${count(lines.length)} rows`}>
        {entry ? "Detail" : "Accounting entries"}
      </SubHead>
      {entry && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Button
            variant="primary"
            onClick={() => onChange([...lines, blankLine()])}
          >
            <Plus />
            Add row
          </Button>
          <Button
            variant="danger"
            onClick={() => onChange([blankLine(), blankLine()])}
          >
            Del All
          </Button>
          <AppLink
            to="/finance/assets/depreciation"
            variant="primary"
            className="inline-flex items-center"
          >
            Penyusutan
          </AppLink>
        </div>
      )}
      <Grid>
        <thead>
          <tr>
            <Th>{entry ? "Deskripsi Account" : "Account"}</Th>
            {entry && <Th width="8rem">Kode Account</Th>}
            {entry && <Th>Uraian</Th>}
            <Th width="10rem">Unit</Th>
            <Th align="right" width="8.5rem">
              {entry ? "Debet" : "Debit"}
            </Th>
            <Th align="right" width="8.5rem">
              {entry ? "Kredit" : "Credit"}
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
              {entry && (
                <Td>
                  {line.account === null ? (
                    <span className="text-faint">—</span>
                  ) : (
                    <Code>{line.account.account_code}</Code>
                  )}
                </Td>
              )}
              {entry && (
                <Td>
                  <Input
                    value={line.memo ?? ""}
                    onChange={(event) =>
                      setLine(index, { memo: event.target.value })
                    }
                    aria-label={`Uraian on row ${index + 1}`}
                    className="h-8"
                  />
                </Td>
              )}
              <Td>
                <UnitSelect
                  value={line.unit_id}
                  onChange={(next) => setLine(index, { unit_id: next })}
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
                  className="h-8"
                />
              </Td>
              <Td align="right">
                <Money
                  label={`Credit on row ${index + 1}`}
                  value={line.credit}
                  onChange={(next) => setLine(index, { credit: next })}
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
            {entry && <Td />}
            {entry && <Td />}
            <Td />
            <Td align="right">{money(totals.debits)}</Td>
            <Td align="right">{money(totals.credits)}</Td>
            <Td />
          </TotalRow>
          {entry && (
            <TotalRow>
              <Td>Selisih</Td>
              <Td />
              <Td />
              <Td />
              <Td align="right" className={selisih !== 0 ? "text-bad-fg!" : ""}>
                {money(selisih)}
              </Td>
              <Td />
              <Td />
            </TotalRow>
          )}
        </tbody>
      </Grid>
      {!entry && (
        <Button
          variant="soft"
          className="mt-2.5"
          onClick={() => onChange([...lines, blankLine()])}
        >
          <Plus />
          Add row
        </Button>
      )}
    </div>
  )
}
