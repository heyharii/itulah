import { useQuery } from "@tanstack/react-query"
import { useMemo } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { EmptyState, LoadingState } from "@/components/ui/states"
import { count, money } from "@/lib/format"
import { financeKeys, listBankInstitutions } from "@/lib/queries/finance"
import { BANK_POTS, useMoneyRows } from "@/screens/finance-lab-2/hooks"
import { Grid, LabNote, Td, Th } from "@/screens/finance-lab-2/parts"

/// The institutions, gathered from the accounts that name them.
///
/// Deliberately not a master, and this is the one screen where that is a
/// decision rather than a shortfall: nobody maintains a list of banks. A bank
/// appears here the moment an account names it — ours (0223) or a
/// supplier's (0221) — and leaves when the last account stops. Both halves
/// normalise the name the same way, so "BCA", "Bank BCA" and "bank bca" are
/// one row and not three.
///
/// The second table is the gap: accounts the chart keeps money in that nobody
/// has described yet, grouped by the free text in `account_map.qualifier`. It
/// is drawn separately because those are not banks we know — they are banks
/// somebody typed.
export function Banks() {
  const banks = useQuery({
    queryKey: financeKeys.bankInstitutions(),
    queryFn: ({ signal }) => listBankInstitutions(signal),
  })
  const { rows: ledger, pending } = useMoneyRows(BANK_POTS)

  // What the account map still carries alone. Compared on the same normalised
  // form the server groups by, so an account described as "Bank BCA" does not
  // show up here as an undescribed "BCA".
  const known = useMemo(
    () => new Set((banks.data ?? []).map((bank) => bank.normalized)),
    [banks.data]
  )
  const onlyMapped = useMemo(() => {
    const table = new Map<string, { accounts: number; held: number }>()
    for (const row of ledger) {
      const normalized = row.qualifier
        .trim()
        .toUpperCase()
        .replace(/^BANK\s+/, "")
      if (normalized !== "" && known.has(normalized)) continue
      const key = row.qualifier.trim() === "" ? "(not named)" : row.qualifier
      const seen = table.get(key) ?? { accounts: 0, held: 0 }
      seen.accounts += 1
      seen.held += row.per_books_minor
      table.set(key, seen)
    }
    return [...table.entries()].sort((a, b) => b[1].held - a[1].held)
  }, [ledger, known])

  return (
    <PageContent>
      <PageHeader
        crumb="Finance lab 2 · Cash &amp; Bank"
        title="Banks"
        sub="Every institution an account names — ours and our suppliers&rsquo;."
      />

      {banks.isPending || pending ? (
        <LoadingState>Gathering the banks…</LoadingState>
      ) : (banks.data ?? []).length === 0 && onlyMapped.length === 0 ? (
        <EmptyState>
          No account names a bank yet. Describe one on Bank Accounts, or add a
          supplier&rsquo;s account on their record, and the institution appears
          here on its own.
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-6">
          {(banks.data ?? []).length > 0 && (
            <div className="flex flex-col gap-3">
              <Grid>
                <thead>
                  <tr>
                    <Th>Bank</Th>
                    <Th align="right" width="8.5rem">
                      Our accounts
                    </Th>
                    <Th align="right" width="9.5rem">
                      Supplier accounts
                    </Th>
                    <Th align="right" width="11rem">
                      Held per books
                    </Th>
                  </tr>
                </thead>
                <tbody>
                  {(banks.data ?? []).map((bank) => (
                    <tr key={bank.normalized}>
                      <Td>
                        <span className="font-medium text-ink">
                          {bank.name}
                        </span>
                        {bank.our_accounts === 0 && (
                          <Pill className="ml-2">suppliers only</Pill>
                        )}
                      </Td>
                      <Td align="right">
                        {bank.our_accounts === 0 ? (
                          <span className="text-mute">—</span>
                        ) : (
                          count(bank.our_accounts)
                        )}
                      </Td>
                      <Td align="right">
                        {bank.supplier_accounts === 0 ? (
                          <span className="text-mute">—</span>
                        ) : (
                          count(bank.supplier_accounts)
                        )}
                      </Td>
                      <Td align="right">
                        {bank.our_balance_minor === null ? (
                          <span className="text-mute">nothing of ours</span>
                        ) : (
                          money(bank.our_balance_minor)
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Grid>
            </div>
          )}

          {onlyMapped.length > 0 && (
            <div className="flex flex-col gap-3">
              <h2 className="text-[0.9375rem] font-medium text-ink">
                Named only on the account map
              </h2>
              <Grid>
                <thead>
                  <tr>
                    <Th>Typed as</Th>
                    <Th align="right" width="8.5rem">
                      Accounts
                    </Th>
                    <Th align="right" width="11rem">
                      Held per books
                    </Th>
                  </tr>
                </thead>
                <tbody>
                  {onlyMapped.map(([name, stat]) => (
                    <tr key={name}>
                      <Td className="text-warn-fg">{name}</Td>
                      <Td align="right">{count(stat.accounts)}</Td>
                      <Td align="right">{money(stat.held)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Grid>
            </div>
          )}

          <LabNote>
            The first table is gathered from real account records; the second is
            free text on mapping rows, retyped per account, with nothing
            stopping three spellings of one bank. Describing an account on{" "}
            <b>Bank Accounts</b> moves it from the second table to the first.
          </LabNote>
        </div>
      )}
    </PageContent>
  )
}
