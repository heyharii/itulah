import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Day } from "@/components/ui/day"
import { Field, Select } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import {
  Banner,
  EmptyState,
  ErrorState,
  LoadMore,
  LoadingState,
} from "@/components/ui/states"
import { money } from "@/lib/format"
import { financeKeys, listCompanyBankAccounts } from "@/lib/queries/finance"
import {
  advanceControl,
  advancePage,
  domainKeys,
  payAdvance,
} from "@/lib/queries/finance-domains"
import { useCanWrite } from "@/lib/session"
import {
  Code,
  Grid,
  Note,
  NumberCard,
  Td,
  Th,
} from "@/screens/finance-final/parts"

/// Advances — money out with somebody, and how old it is.
///
/// Ageing is derived from the day the money left, not stored, so it cannot
/// disagree with the balance beside it.
export function Advances() {
  const [status, setStatus] = useState<string | undefined>(undefined)
  const [paying, setPaying] = useState<PayTarget | null>(null)
  const canWrite = useCanWrite()
  // A page at a time, newest first. The cards read the server's figures over
  // the whole book, never a sum of the pages loaded.
  const advances = useInfiniteQuery({
    queryKey: [...domainKeys.advances(undefined, status), "pages"],
    queryFn: ({ pageParam, signal }) =>
      advancePage({ status, cursor: pageParam, limit: 100 }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    placeholderData: (previous) => previous,
  })
  const control = useQuery({
    queryKey: domainKeys.advanceControl(),
    queryFn: ({ signal }) => advanceControl(signal),
  })

  const rows = useMemo(
    () => advances.data?.pages.flatMap((page) => page.rows) ?? [],
    [advances.data]
  )
  const head = advances.data?.pages[0]
  const outstanding = head?.outstanding_minor ?? null
  const old = head?.over_thirty_days ?? null
  const difference = (control.data ?? []).reduce(
    (total, row) => total + row.difference_minor,
    0
  )

  return (
    <PageContent>
      <PageHeader
        crumb="Finance"
        title="Uang muka"
        sub="Perjalanan, kontraktor, dan keperluan yang belum ada tagihannya."
      />

      <Grid>
        <NumberCard label="Masih di tangan orang" value={outstanding} />
        <NumberCard
          label="Lebih dari 30 hari"
          value={old}
          tone={old === null ? undefined : old === 0 ? "ok" : "warn"}
        />
        <NumberCard
          label="Selisih dengan buku besar"
          value={difference}
          tone={difference === 0 ? "ok" : "bad"}
        />
      </Grid>

      <Note>
        Uang muka yang sudah dibayar tidak bisa dibatalkan — ia dipertanggung-
        jawabkan dengan bukti, atau uangnya dikembalikan. Keduanya mengurangi
        saldo lewat jurnalnya sendiri.
      </Note>

      <div className="flex flex-wrap gap-2">
        {[
          undefined,
          "REQUESTED",
          "APPROVED",
          "PAID",
          "PARTIALLY_SETTLED",
          "SETTLED",
        ].map((option) => (
          <button
            key={option ?? "ALL"}
            type="button"
            className={
              status === option
                ? "rounded-control border border-accent px-2 py-1 text-sm text-accent"
                : "rounded-control border border-hairline px-2 py-1 text-sm"
            }
            onClick={() => setStatus(option)}
          >
            {option ?? "Semua"}
          </button>
        ))}
      </div>

      {advances.isPending ? (
        <LoadingState />
      ) : advances.isError && advances.data === undefined ? (
        <ErrorState error={advances.error} />
      ) : rows.length === 0 ? (
        <EmptyState>Belum ada uang muka</EmptyState>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <Th>Nomor</Th>
              <Th>Kepada</Th>
              <Th>Keperluan</Th>
              <Th>Unit</Th>
              <Th align="right">Nilai</Th>
              <Th align="right">Sisa</Th>
              <Th align="right">Umur</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.advance_id}>
                <Td>
                  <Code>{row.advance_number}</Code>
                </Td>
                <Td>
                  {row.party_label}
                  <div className="text-[0.875rem] text-mute">
                    {row.party_type}
                  </div>
                </Td>
                <Td>{row.purpose}</Td>
                <Td>{row.site_id}</Td>
                <Td align="right">{money(row.amount_minor)}</Td>
                <Td align="right">{money(row.outstanding_minor)}</Td>
                <Td align="right">
                  {row.age_days === null ? "—" : `${row.age_days} hari`}
                </Td>
                <Td>
                  <Pill
                    tone={
                      row.status === "SETTLED"
                        ? "ok"
                        : row.status === "CANCELLED"
                          ? "neutral"
                          : (row.age_days ?? 0) > 30
                            ? "warn"
                            : "info"
                    }
                  >
                    {row.status}
                  </Pill>
                  {row.status === "APPROVED" && canWrite && (
                    <Button
                      variant="ghost"
                      className="ml-2"
                      onClick={() =>
                        setPaying({
                          id: row.advance_id,
                          number: row.advance_number,
                          party: row.party_label,
                          purpose: row.purpose,
                          amount: row.amount_minor,
                        })
                      }
                    >
                      Cairkan
                    </Button>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <LoadMore query={advances} />
      {paying !== null && (
        <PaySheet target={paying} onClose={() => setPaying(null)} />
      )}
    </PageContent>
  )
}

interface PayTarget {
  id: string
  number: string
  party: string
  purpose: string
  amount: number
}

/// Pay an approved advance out: the day the money left and where it left
/// from. An employee's loan starts being taken back from pay only once it is
/// paid out here.
function PaySheet({
  target,
  onClose,
}: {
  target: PayTarget
  onClose: () => void
}) {
  const client = useQueryClient()
  const [on, setOn] = useState(new Date().toISOString().slice(0, 10))
  const [source, setSource] = useState("petty_cash|")
  const banks = useQuery({
    queryKey: financeKeys.companyBankAccounts(null),
    queryFn: ({ signal }) => listCompanyBankAccounts(signal),
  })
  const pay = useMutation({
    mutationFn: () => {
      const [cashKey, qualifier] = source.split("|")
      return payAdvance(target.id, {
        posting_date: on,
        cash_key: cashKey,
        cash_qualifier: qualifier ?? "",
      })
    },
    onSuccess: () => {
      // Every status filter's pages, and the control figure beside them.
      void client.invalidateQueries({ queryKey: ["finance", "advances"] })
      void client.invalidateQueries({ queryKey: ["people"] })
      onClose()
    },
  })
  return (
    <Sheet
      open
      onOpenChange={(next) => !next && onClose()}
      title={`Cairkan ${target.number}`}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="quiet" onClick={onClose}>
            Batal
          </Button>
          <Button
            variant="primary"
            pending={pay.isPending}
            disabled={on === ""}
            onClick={() => pay.mutate()}
          >
            Cairkan
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <Facts>
          <Fact term="Kepada">{target.party}</Fact>
          <Fact term="Keperluan">{target.purpose}</Fact>
          <Fact term="Nilai">{money(target.amount)}</Fact>
        </Facts>
        <Field label="Tanggal" required>
          <Day value={on} onChange={setOn} />
        </Field>
        <Field label="Dibayar dari" required>
          <Select value={source} onChange={setSource}>
            <option value="petty_cash|">Kas kecil unit</option>
            {(banks.data ?? []).map((bank) => (
              <option
                key={`${bank.ledger_account_code}-${bank.bank_code}`}
                value={`${bank.kind === "SAVINGS" ? "bank_savings" : "bank_giro"}|${bank.bank_code}`}
              >
                {`${bank.bank_code} ${bank.account_no}`}
              </option>
            ))}
          </Select>
        </Field>
        {pay.error !== null && <Banner tone="bad">{pay.error.message}</Banner>}
      </div>
    </Sheet>
  )
}
