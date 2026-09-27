import { useQueries } from "@tanstack/react-query"

import { PageContent } from "@/components/shell/app-shell"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { SubHead } from "@/components/ui/rows"
import { Tag } from "@/components/ui/tag"
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states"
import { count } from "@/lib/format"
import { accountChildren, financeKeys } from "@/lib/queries/finance"
import { ROOT_CLASSES_SHORT } from "@/screens/finance/chart"
import { useAssetClasses, useCategoriesByFamily } from "@/screens/finance/hooks"
import { Code, Grid, Note, Td, Th } from "@/screens/finance-final/parts"
import type { LedgerAccount } from "@itulah/contract"

/// The vocabulary the forty-account chart is read in.
///
/// # Why this screen exists at all
///
/// Because the chart stopped answering the question it used to answer. The
/// client's own books carried 6,908 posting accounts for about forty lines of
/// the statements, and every one of the extra codes was an *identity* baked
/// into a number: which bank, which of thirty-six racks, PPh 21 or PPh 23,
/// electricity or water. Pulling the unit dimension out took that to 190;
/// pulling the identity out takes it to 40, and the identity has to land
/// somewhere. It lands here — `journal_line.category_code`, one closed list
/// per family, chosen beside the account every time anybody posts.
///
/// So "what can I put on 6301?" is a question with an answer again, and this
/// is where the answer is written down. An accountant coming from the old
/// chart is looking for the line they used to have a code for, and they will
/// find it under its own Indonesian name — never a translation, because
/// "Biaya Pemakaian Listrik" is the thing they are looking for and *Electricity
/// expense* is a different line as far as their working memory is concerned.
///
/// # Why it is read-only
///
/// Because a category is not a setting, it is a fact about the client's chart,
/// seeded with the migration that derived it from their own account names. A
/// screen that let somebody add one would be a screen that lets somebody add a
/// line to the profit and loss between two closes.
///
/// # Why the accounts are on it
///
/// A family on its own is a word — `expense_category` explains nothing until
/// you know that 6101, 6301 and 6401 are what take it, and that 1102 Bank
/// takes none at all because a bank line's identity is the account it already
/// names. The right-hand column is read off the chart rather than written
/// down, so the day an account changes its declaration this screen changes
/// with it.
export function LineCategories() {
  const categories = useCategoriesByFamily()
  const classes = useAssetClasses()
  const chart = useChartFamilies()

  return (
    <PageContent>
      <PageHeader
        crumb="Finance"
        title="Kategori baris"
        sub="Apa yang dulu membedakan dua kode akun, sekarang dipilih di baris jurnal."
      />

      <Note>
        Sebuah akun ada hanya kalau ia baris di neraca atau laba-rugi. Pembeda
        yang lain — bank mana, rak yang mana, PPh pasal berapa, listrik atau air
        — adalah <b>kategori</b> pada baris jurnal. Akun yang mendeklarasikan
        satu keluarga <b>menolak</b> baris tanpa kategori dari keluarga itu;
        akun yang tidak mendeklarasikan apa pun menolak baris yang membawanya.
        Keduanya ditolak oleh basis data, bukan oleh layar ini.
      </Note>

      {categories.isPending ? (
        <LoadingState>Membaca daftar kategori…</LoadingState>
      ) : categories.isError ? (
        <ErrorState
          error={categories.error}
          onRetry={() => categories.refetch()}
        />
      ) : categories.families.length === 0 ? (
        <EmptyState>
          Belum ada kategori. Migrasi yang menurunkannya dari nama akun klien
          belum dijalankan di node ini.
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-6">
          <SubHead
            aside={`${count(categories.families.length)} keluarga · ${count(
              categories.families.reduce(
                (total, group) => total + group.rows.length,
                0
              )
            )} kategori`}
          >
            Keluarga
          </SubHead>

          {categories.families.map((group) => (
            <div key={group.family} className="flex flex-col gap-2">
              <div className="flex flex-wrap items-baseline gap-2">
                {/* The gloss first and the identifier second: `pay_component`
                    is our word, "Komponen gaji" is the thing. The identifier
                    stays because it is what the wire carries and what a
                    support conversation will be about. */}
                <span className="text-[0.875rem] font-semibold text-ink">
                  {group.label}
                </span>
                <Code>{group.family}</Code>
                <span className="text-[0.875rem] text-mute">
                  {count(group.rows.length)} kategori
                </span>
                {/* The accounts that declare this family, read off the chart.
                    An empty list is worth drawing rather than hiding: a family
                    no account asks for is a seed that landed without the
                    declaration beside it, and that is exactly the kind of gap
                    a reference screen should surface. */}
                <span className="flex flex-wrap items-center gap-1">
                  {chart.byFamily.get(group.family)?.map((account) => (
                    <Tag key={account.account_code} title={account.name}>
                      {account.account_code}
                    </Tag>
                  )) ?? null}
                  {chart.isPending ? (
                    <span className="text-[0.875rem] text-faint">
                      membaca bagan…
                    </span>
                  ) : (
                    (chart.byFamily.get(group.family) ?? []).length === 0 && (
                      <span className="text-[0.875rem] text-warn-fg">
                        tidak ada akun yang memintanya
                      </span>
                    )
                  )}
                </span>
              </div>

              <Grid>
                <thead>
                  <tr>
                    <Th width="16rem">Kode</Th>
                    <Th>Nama (nama klien)</Th>
                    <Th width="8rem">Status</Th>
                  </tr>
                </thead>
                <tbody>
                  {group.rows.map((row) => (
                    <tr key={row.category_code}>
                      <Td>
                        <Code>{row.category_code}</Code>
                      </Td>
                      <Td>
                        <span className="text-ink">{row.name}</span>
                        {/* The English gloss, where the chart carries one, sits
                            quiet and second. It is a reading aid for somebody
                            who does not have the client's chart in their head,
                            and never the label a picker offers. */}
                        {row.name_en !== null &&
                          row.name_en !== undefined &&
                          row.name_en !== "" && (
                            <span className="text-mute"> · {row.name_en}</span>
                          )}
                      </Td>
                      <Td>
                        {row.is_active ? (
                          <span className="text-mute">aktif</span>
                        ) : (
                          <Pill tone="neutral">tidak dipakai lagi</Pill>
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Grid>
            </div>
          ))}
        </div>
      )}

      <SubHead
        aside={
          chart.noFamily.length === 0
            ? undefined
            : `${count(chart.noFamily.length)} akun`
        }
      >
        Akun tanpa kategori
      </SubHead>
      <Note>
        Akun-akun ini tidak menerima kategori sama sekali. Identitasnya sudah
        ada di tempat lain: rekening bank, aset di register, pemasok, fasilitas
        pembiayaan, atau pemilik. Memilih salah satunya tidak memunculkan kotak
        kedua.
      </Note>
      {chart.isPending ? (
        <LoadingState>Membaca bagan akun…</LoadingState>
      ) : chart.isError ? (
        <ErrorState error={chart.error} />
      ) : chart.noFamily.length === 0 ? (
        <EmptyState>
          Setiap akun yang bisa diposting meminta sebuah kategori.
        </EmptyState>
      ) : (
        <Grid>
          <thead>
            <tr>
              <Th width="7rem">Kode</Th>
              <Th>Nama</Th>
              <Th width="12rem">Kelas</Th>
            </tr>
          </thead>
          <tbody>
            {chart.noFamily.map((account) => (
              <tr key={account.account_code}>
                <Td>
                  <Code>{account.account_code}</Code>
                </Td>
                <Td>{account.name}</Td>
                <Td>
                  <span className="text-mute">
                    {ROOT_CLASSES_SHORT[account.root_class] ??
                      account.root_class}
                  </span>
                </Td>
              </tr>
            ))}
          </tbody>
        </Grid>
      )}

      <SubHead
        aside={
          classes.rows.length === 0
            ? undefined
            : `${count(classes.rows.length)} kelas`
        }
      >
        Kelas aset
      </SubHead>
      <Note>
        Bukan keluarga kategori. Akun aset — 1601, 1609, 7101 dan seterusnya —
        tidak membawa kategori: identitas barisnya adalah aset yang disebut, dan
        kelasnya dibaca dari register. Daftar ini ada di sini karena itu
        pertanyaan berikutnya setelah “akun ini tidak minta kategori, lalu apa
        yang membedakannya?”
      </Note>
      {classes.isPending ? (
        <LoadingState>Membaca kelas aset…</LoadingState>
      ) : classes.isError ? (
        <ErrorState error={classes.error} onRetry={() => classes.refetch()} />
      ) : classes.rows.length === 0 ? (
        <EmptyState>Belum ada kelas aset di node ini.</EmptyState>
      ) : (
        <Grid>
          <thead>
            <tr>
              <Th width="16rem">Kode</Th>
              <Th>Nama (nama klien)</Th>
              <Th width="10rem">Jenis</Th>
            </tr>
          </thead>
          <tbody>
            {classes.rows.map((row) => (
              <tr key={row.class_code}>
                <Td>
                  <Code>{row.class_code}</Code>
                </Td>
                <Td>
                  <span className="text-ink">{row.name}</span>
                  {row.name_en !== null &&
                    row.name_en !== undefined &&
                    row.name_en !== "" && (
                      <span className="text-mute"> · {row.name_en}</span>
                    )}
                </Td>
                <Td>
                  <Pill tone={row.is_active ? "neutral" : "warn"}>
                    {row.kind}
                  </Pill>
                </Td>
              </tr>
            ))}
          </tbody>
        </Grid>
      )}
    </PageContent>
  )
}

/// The chart's own answer to "which accounts ask for which family".
///
/// Eight requests, one per root class, and not one request for the whole
/// chart: `GET /finance/accounts` walks a level at a time on purpose, because
/// the client's chart is still 7,528 rows with the retired ones in it and
/// nobody wants a megabyte of JSON to read a reference page. The forty live
/// accounts hang directly off the eight roots, so one level is the whole
/// chart — and every one of these keys is the key the Chart of accounts screen
/// already owns, so opening both costs eight requests rather than sixteen.
///
/// Retired accounts are excluded. The 190 that this chart replaced are all
/// still there, still carrying their old declarations, and listing them beside
/// the forty would make the page an argument about which chart is in force.
function useChartFamilies() {
  const roots = ["1", "2", "3", "4", "5", "6", "7", "8"]
  const answers = useQueries({
    queries: roots.map((root) => ({
      queryKey: financeKeys.accountChildren(root, false),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        accountChildren({ parent: root }, signal),
      // A chart is imported once and then sits for months.
      staleTime: 5 * 60 * 1000,
    })),
  })

  // Computed on every render rather than memoised: it is forty rows and one
  // sort, and `useQueries` hands back a fresh array each time anyway, so a
  // `useMemo` here would need a dependency that is a lie about what changed.
  const rows: LedgerAccount[] = []
  for (const answer of answers) {
    for (const row of answer.data?.rows ?? []) {
      if (row.is_group || !row.is_active) continue
      rows.push(row)
    }
  }
  rows.sort((a, b) => a.account_code.localeCompare(b.account_code))

  const byFamily = new Map<string, LedgerAccount[]>()
  for (const row of rows) {
    if (row.category_family === null) continue
    const held = byFamily.get(row.category_family)
    if (held === undefined) byFamily.set(row.category_family, [row])
    else held.push(row)
  }

  return {
    byFamily,
    noFamily: rows.filter((row) => row.category_family === null),
    isPending: answers.some((one) => one.isPending),
    isError: answers.some((one) => one.isError),
    error: answers.find((one) => one.isError)?.error,
  }
}
