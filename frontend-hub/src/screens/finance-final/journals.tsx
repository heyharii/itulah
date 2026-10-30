import {
  useInfiniteQuery,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { Plus, Trash2 } from "lucide-react"
import { Suspense, useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Day } from "@/components/ui/day"
import { Fab } from "@/components/ui/fab"
import { Field, Input, Money, Textarea } from "@/components/ui/field"
import { FilterChips } from "@/components/ui/filter-chips"
import { SubTabs } from "@/components/ui/sub-tabs"
import { ExpandingSearch } from "@/components/ui/list-chrome"
import { PageHeader } from "@/components/ui/page-header"
import { Pill, Status } from "@/components/ui/pill"
import { MiniTable, SubHead } from "@/components/ui/rows"
import { CellMoney } from "@/components/ui/rows-switch"
import { Toolbar } from "@/components/ui/segmented"
import { SheetFooter } from "@/components/ui/sheet-footer"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import {
  Banner,
  EmptyState,
  NoAccessState,
  NoMatch,
} from "@/components/ui/states"
import { count, day, label, money, moment, monthYear } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import {
  financeKeys,
  journalEntry,
  journalRepeatsQuery,
  listJournal,
  listJournalTemplates,
  postManualEntry,
  previewDepreciation,
  reverseEntry,
  runDepreciation,
  type ManualLine,
} from "@/lib/queries/finance"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"
import { tableSetup, type TableSetup } from "@/lib/table"
import { cn } from "@/lib/utils"
import { useDebounced } from "@/lib/use-debounced"
import {
  Code,
  DebitCredit,
  Grid,
  Td,
  Th,
  TotalRow,
} from "@/screens/finance-final/parts"
import { AppLink } from "@/components/ui/app-link"
import { todayIso } from "@/screens/finance/chart"
import {
  useCategoriesByFamily,
  useSettledWindow,
} from "@/screens/finance/hooks"
import {
  blankLine,
  byUnit,
  draftFromTemplate,
  draftTotals,
  type DraftLine,
} from "@/screens/finance/journal-lines"
import {
  AccountPicker,
  CategoryPicker,
  UnitName,
  UnitSelect,
  WindowControl,
  type AccountChoice,
} from "@/screens/finance/parts"
import { idempotencyKey } from "@itulah/contract/client"
import { ScreenPending } from "@/screens/finance/pending"
import type {
  DepreciationRun,
  JournalEntryDetail,
  JournalEntryRow,
  JournalLineView,
} from "@itulah/contract"

/// The book every other screen in this module writes into, in 7Soft's words.
///
/// Two of 7Soft's screens meet here. "Info Accounting" has the tabs Jurnal
/// (the journals made by hand in Transaksi Jurnal) and All Jurnal (every
/// journal, with the document that made it), and "Transaksi Jurnal" is the
/// form that opens from a row and from Jurnal Baru. The content is 7Soft's —
/// its columns, its header fields, its detail grid and its Selisih — and the
/// design is the hub's. Every figure and every write goes through the finance
/// endpoints; nothing here posts locally.
///
/// # What 7Soft has that the books do not
///
///   * **No Referensi.** `journal_entry` has no reference column, and the
///     manual-entry endpoint takes none. The reference is therefore carried at
///     the head of the memo as `[ref] note` and read back from it on manual
///     entries only (`memoParts`) — the books stay the one record, and a
///     reference typed in the form is found by the register's own search.
///   * **Status New / Delete.** The journal is append-only: nothing is
///     deleted. An entry that has been answered by its mirror reads Delete,
///     which is what 7Soft's operator means by it, and the sheet still says
///     which entry answered it.
///   * **Periode.** 7Soft's accounting period is the year and month of the
///     date (200708), which is all the books' own periods are.
///
/// # Why the unit is a column on the LINE and not on the entry
///
/// It is the module's whole argument. The client's legacy chart carries the
/// location inside the account code — fourteen copies of `Cash on Hand`, and a
/// 14×14 grid of accounts for the entries that move money between two units.
/// Here `journal_line.unit_id` is a dimension on the posting, so one account
/// serves all fourteen and an entry that touches two units is simply an entry
/// whose lines carry two different units. 7Soft's grid has no such column; the
/// books refuse a line without one, so it stands beside Uraian.
///
/// # Reverse, and the absence of Cancel
///
/// `journal_entry` is append-only and there is no cancel endpoint at all.
/// Reverse posts a new opposite entry and leaves the original standing; the
/// sheet says so where somebody is about to press it, because "this never
/// should have existed" and "this was right then and is wrong now" are
/// different intents and only one of them is available.

/// One page of the Jurnal tab. The list scrolls on — this is the size of a
/// step, not a ceiling.
const PAGE = 100

/// One page of All Jurnal. Smaller, because every entry on it is a second
/// read for its lines — the register answers headers, and 7Soft's All Jurnal
/// is a list of lines.
const PAGE_ALL = 50

/// Info Accounting's two tabs. The door draws them (Jurnal and All Jurnal are
/// two paths of the Journal door, beside Templates), so the screen is told
/// which one it is.
type Tab = "jurnal" | "all" | "recurring"

/// What wrote an entry, as 7Soft's All Jurnal names the document in its
/// Keterangan column. An adapter, not a vocabulary: the schema's own values on
/// the left, the operator's words on the right.
const SOURCE_WORDS: Readonly<Record<string, string>> = {
  MANUAL: "Jurnal Manual",
  SUPPLIER_INVOICE: "Faktur Pembelian",
  PAYMENT: "Pembayaran",
  DEPRECIATION: "Penyusutan",
  REVERSAL: "Pembalik Jurnal",
  SALE_DAY: "Penjualan Cash",
  STOCK_COUNT: "Stock Opname",
  TRANSFER: "Transfer",
}

function sourceWord(kind: string): string {
  return SOURCE_WORDS[kind] ?? label(kind)
}

/// 7Soft's Periode: the year and month of the date, `200708`.
function periodOf(date: string): string {
  return `${date.slice(0, 4)}${date.slice(5, 7)}`
}

/// A manual entry's reference, read back out of the memo it travels in.
const REF_MARK = /^\[([^\]]*)\]\s?/

function memoParts(entry: Pick<JournalEntryRow, "source_kind" | "memo">): {
  ref: string
  note: string
} {
  const memo = entry.memo ?? ""
  if (entry.source_kind !== "MANUAL") return { ref: "", note: memo }
  const found = REF_MARK.exec(memo)
  return found === null
    ? { ref: "", note: memo }
    : { ref: found[1], note: memo.slice(found[0].length) }
}

/// The memo a manual entry is written with: the reference first, then
/// Keterangan. Empty is `null`, which is what the endpoint means by none.
function memoOf(ref: string, note: string): string | null {
  const reference = ref.trim().replace(/[[\]]/g, "")
  const text = note.trim()
  if (reference === "") return text === "" ? null : text
  return text === "" ? `[${reference}]` : `[${reference}] ${text}`
}

/// A person chose these accounts, or a posting rule did.
///
/// `MANUAL` is the only kind a human writes directly; `REVERSAL` is written by
/// the server when somebody presses Reverse, which is a person's decision
/// carried out by a rule — so it reads as neither and gets its own tone.
function byHand(entry: JournalEntryRow): boolean {
  return entry.source_kind === "MANUAL"
}

function toneOf(entry: JournalEntryRow): "warn" | "info" | "neutral" {
  if (entry.source_kind === "MANUAL") return "warn"
  if (entry.source_kind === "REVERSAL") return "info"
  return "neutral"
}

/// The prototype's Status: Posted; Reversed once the entry has been answered
/// by its mirror; Reversal for the mirror itself.
function statusOf(entry: JournalEntryRow): "Posted" | "Reversed" | "Reversal" {
  if (entry.reversed_by !== null) return "Reversed"
  return entry.source_kind === "REVERSAL" ? "Reversal" : "Posted"
}

function statusTone(entry: JournalEntryRow): "ok" | "neutral" | "info" {
  const word = statusOf(entry)
  return word === "Posted" ? "ok" : word === "Reversal" ? "info" : "neutral"
}

/// The Jurnal tab's columns: the document, as 7Soft lists it. The server
/// orders it, so none of them sorts; on a card the number leads, the
/// Keterangan names it and the total stands at the right with the status in
/// the foot.
const columns: ColumnDef<TableSetup, JournalEntryRow>[] = [
  {
    id: "entry",
    accessorFn: (row) => row.entry_number,
    header: "No Jurnal",
    size: 180,
    enableSorting: false,
    meta: { card: "id" },
    cell: ({ row }) => (
      <span className="font-mono text-[0.9375rem] text-ink">
        {row.original.entry_number}
      </span>
    ),
  },
  {
    id: "date",
    accessorFn: (row) => row.posting_date,
    header: "Tanggal",
    size: 100,
    enableSorting: false,
    meta: { card: "foot" },
    cell: ({ row }) => day(row.original.posting_date),
  },
  {
    id: "ref",
    accessorFn: (row) => memoParts(row).ref,
    header: "No Referensi",
    size: 190,
    enableSorting: false,
    meta: { card: "foot" },
    cell: ({ row }) => {
      const { ref } = memoParts(row.original)
      return ref === "" ? <span className="text-faint">—</span> : ref
    },
  },
  {
    id: "memo",
    accessorFn: (row) => memoParts(row).note,
    header: "Keterangan",
    size: 240,
    enableSorting: false,
    meta: { card: "title", grow: 200 },
    cell: ({ row }) => {
      const { note } = memoParts(row.original)
      return (
        <span
          className={cn(
            "block truncate",
            note === "" ? "text-faint" : "text-body"
          )}
          title={note === "" ? undefined : note}
        >
          {note === "" ? "—" : note}
        </span>
      )
    },
  },
  {
    id: "total",
    accessorFn: (row) => row.total_minor,
    header: "Total",
    size: 160,
    enableSorting: false,
    meta: { align: "right", card: "lead" },
    cell: ({ row }) => <CellMoney minor={row.original.total_minor} />,
  },
  {
    id: "status",
    accessorFn: (row) => statusOf(row),
    header: "Status",
    size: 140,
    enableSorting: false,
    meta: { card: "status" },
    cell: ({ row }) => (
      <Status tone={statusTone(row.original)}>{statusOf(row.original)}</Status>
    ),
  },
]

/// One line of one journal: a row of All Jurnal.
interface FlatLine {
  readonly id: string
  readonly entry: JournalEntryRow
  readonly line: JournalLineView
}

function figure(minor: number) {
  return minor === 0 ? (
    <span className="text-hairline-strong">·</span>
  ) : (
    <CellMoney minor={minor} />
  )
}

/// All Jurnal's columns, in 7Soft's order. A journal's own fields repeat on
/// each of its lines, as they do there.
const lineColumns: ColumnDef<TableSetup, FlatLine>[] = [
  {
    id: "date",
    accessorFn: (row) => row.entry.posting_date,
    header: "Date",
    size: 90,
    enableSorting: false,
    meta: { card: "foot" },
    cell: ({ row }) => day(row.original.entry.posting_date),
  },
  {
    id: "source",
    accessorFn: (row) => sourceWord(row.entry.source_kind),
    header: "Source",
    size: 150,
    enableSorting: false,
    meta: { card: "meta", priority: 2 },
    cell: ({ row }) => sourceWord(row.original.entry.source_kind),
  },
  {
    id: "entry",
    accessorFn: (row) => row.entry.entry_number,
    header: "No",
    size: 190,
    enableSorting: false,
    meta: { card: "foot" },
    cell: ({ row }) => (
      <span className="font-mono text-[0.9375rem] text-ink">
        {row.original.entry.entry_number}
      </span>
    ),
  },
  {
    id: "name",
    accessorFn: (row) => `${row.line.account_code} ${row.line.account_name}`,
    header: "Account",
    size: 320,
    enableSorting: false,
    meta: { card: "title", grow: 200 },
    cell: ({ row }) => (
      <span className="block truncate" title={row.original.line.account_name}>
        <Code>{row.original.line.account_code}</Code>{" "}
        <span className="text-mute">{row.original.line.account_name}</span>
      </span>
    ),
  },
  {
    id: "debet",
    accessorFn: (row) => row.line.debit_minor,
    header: "Debet",
    size: 160,
    enableSorting: false,
    meta: { align: "right", card: "lead" },
    cell: ({ row }) => figure(row.original.line.debit_minor),
  },
  {
    id: "kredit",
    accessorFn: (row) => row.line.credit_minor,
    header: "Kredit",
    size: 160,
    enableSorting: false,
    meta: { align: "right", card: "metric" },
    cell: ({ row }) => figure(row.original.line.credit_minor),
  },
]

/// The lines of the journals in hand, read one journal at a time — the
/// register answers headers and there is no endpoint that answers lines across
/// journals. Kept in the same cache as the sheet, so opening a row reads
/// nothing again.
function combineLines(results: UseQueryResult<JournalEntryDetail>[]) {
  return {
    details: results.map((one) => one.data),
    waiting: results.filter((one) => one.isPending).length,
    failed: results.filter((one) => one.isError).length,
  }
}

/// The Jurnal tab: the journals written by hand.
export function Journals() {
  return <JournalsFrame tab="jurnal" />
}

/// The Recurring tab opened on its own.
export function RecurringJournals() {
  return <JournalsFrame tab="recurring" />
}

/// The All Jurnal tab: every journal's lines, whoever wrote them.
export function AllJournals() {
  return <JournalsFrame tab="all" />
}

function JournalsFrame({ tab }: { tab: Tab }) {
  return (
    <Suspense
      fallback={
        <ScreenPending crumb="Finance · Accounting" title="Journal">
          Reading the calendar…
        </ScreenPending>
      }
    >
      <JournalsScreen first={tab} />
    </Suspense>
  )
}

function JournalsScreen({ first }: { first: Tab }) {
  const [tab, setTab] = useState<Tab>(first)
  const range = useSettledWindow()
  const all = tab === "all"
  const recurring = tab === "recurring"
  // The entry type is the server's: its own counts, over the window.
  const [kind, setKind] = useState<string | null>(null)
  const [unit, setUnit] = useState("")
  const [needle, setNeedle] = useState("")
  // In the URL rather than in state, so a link from a bill, a deposit or a
  // money movement (`?entry=`) opens the entry it names.
  const reading = useSheet("entry")
  const [composing, setComposing] = useState(false)
  const phone = useLayout() === "phone"
  // "Start a journal from this template" lands here with `?journalTemplate=`.
  const fromTemplate = useSheet("journalTemplate")
  const templates = useQuery({
    queryKey: financeKeys.journalTemplates(),
    queryFn: ({ signal }) => listJournalTemplates(signal),
    enabled: fromTemplate.value !== undefined,
  })
  const categories = useCategoriesByFamily()
  const template = templates.data?.find(
    (one) => one.template_id === fromTemplate.value
  )
  const initial = useMemo(() => {
    // Waits for the categories: a line's category family is read back from
    // them, and the composer's state is seeded once.
    if (template === undefined || categories.isPending) return null
    const familyOf = (code: string) =>
      categories.families.find((group) =>
        group.rows.some((row) => row.category_code === code)
      )?.family ?? null
    const drafted = draftFromTemplate(template.lines, familyOf)
    return {
      name: template.name,
      memo: template.memo ?? "",
      lines: drafted.lines,
      skipped: drafted.skipped,
    }
  }, [template, categories.isPending, categories.families])

  // Window, type, unit and the search all go on the wire, and the key carries
  // all of them — a register narrowed in the browser is a slice of whatever
  // pages it happens to hold, which answers a different question and looks
  // identical.
  const q = useDebounced(needle.trim(), 300)
  const from = range.from
  const to = range.to
  const entries = useInfiniteQuery({
    queryKey: [
      ...financeKeys.journal(from, to, kind, unit || null),
      "pages",
      q,
      all ? PAGE_ALL : PAGE,
    ],
    queryFn: ({ pageParam, signal }) =>
      listJournal(
        {
          from,
          to,
          kind: kind ?? undefined,
          unit: unit || undefined,
          q: q || undefined,
          limit: all ? PAGE_ALL : PAGE,
          cursor: pageParam,
        },
        signal
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    placeholderData: (previous) => previous,
    enabled: !recurring,
  })

  const rows = useMemo(
    () => entries.data?.pages.flatMap((page) => page.rows) ?? [],
    [entries.data]
  )
  const head = entries.data?.pages[0]

  const matched = head?.total ?? rows.length
  // The server's own counts per type, over the window. They deliberately
  // ignore the unit filter — the node counts each facet against the window
  // alone.
  const kinds = head?.facets.kinds ?? []
  const kindTotal = kinds.reduce((sum, facet) => sum + facet.count, 0)

  // All jurnal: the lines of every journal in hand.
  const lines = useQueries({
    queries: all
      ? rows.map((row) => ({
          queryKey: financeKeys.entry(row.entry_id),
          queryFn: ({ signal }: { signal: AbortSignal }) =>
            journalEntry(row.entry_id, signal),
          staleTime: 60_000,
        }))
      : [],
    combine: combineLines,
  })
  const flat = useMemo(() => {
    const out: FlatLine[] = []
    rows.forEach((entry, at) => {
      const detail = lines.details[at]
      if (detail === undefined) return
      for (const line of detail.lines)
        out.push({ id: `${entry.entry_id}:${line.line_number}`, entry, line })
    })
    return out
  }, [rows, lines.details])

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns,
        getRowId: (row: JournalEntryRow) => row.entry_id,
      }),
      [rows]
    )
  )
  const lineTable = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: flat,
        columns: lineColumns,
        getRowId: (row: FlatLine) => row.id,
      }),
      [flat]
    )
  )

  // The next journals are asked for only once the lines of those in hand have
  // arrived: with the rows still empty the foot of the table is in view, and
  // the table would pull every page in one after another.
  const more = {
    hasNextPage: entries.hasNextPage && (!all || lines.waiting === 0),
    isFetchingNextPage: entries.isFetchingNextPage,
    isFetchNextPageError: entries.isFetchNextPageError,
    error: entries.error,
    fetchNextPage: entries.fetchNextPage,
  }

  const clearNeedle = () => setNeedle("")
  const jurnalBaru = () => setComposing(true)

  return (
    <PageContent>
      {/* The one action stands in the head; a phone has the + at the thumb. */}
      <PageHeader
        crumb="Finance · Accounting"
        title="Journal"
        actions={
          phone ? undefined : (
            <Button variant="primary" onClick={jurnalBaru}>
              New jurnal
            </Button>
          )
        }
      />
      <Fab label="New jurnal" onClick={jurnalBaru} />

      <Toolbar
        className="group/bar"
        lead={
          <SubTabs
            value={tab}
            onChange={(next) => setTab(next as Tab)}
            tabs={[
              { value: "jurnal", label: "Jurnal" },
              { value: "all", label: "All jurnal" },
              { value: "recurring", label: "Recurring" },
            ]}
          />
        }
      >
        {!recurring && (
          <>
            <FilterChips
              label="Source"
              value={kind}
              onChange={setKind}
              options={[
                { value: null, label: "All", count: kindTotal },
                ...kinds.map((facet) => ({
                  value: facet.value,
                  label: sourceWord(facet.value),
                  count: facet.count,
                })),
              ]}
            />
            <ExpandingSearch
              value={needle}
              onChange={setNeedle}
              label="Search journals"
              placeholder={
                all
                  ? "No, account or name"
                  : "Jurnal no, referensi or keterangan"
              }
            />
            <WindowControl range={range} />
            <UnitSelect
              value={unit}
              onChange={setUnit}
              className="h-control w-44"
              aria-label="Unit"
            />
            <Toolbar.Spacer />
            <span className="text-[0.9375rem] text-mute">
              {range.chip}
              {unit !== "" && " · "}
              {unit !== "" && <UnitName id={unit} />}
              {` · ${count(matched)} ${matched === 1 ? "journal" : "journals"}`}
              {all &&
                lines.waiting > 0 &&
                ` · reading ${count(lines.waiting)} more`}
            </span>
          </>
        )}
      </Toolbar>

      {recurring ? (
        <RecurringTab onMake={(templateId) => fromTemplate.open(templateId)} />
      ) : (
        <>
          {all && lines.failed > 0 && (
            <Banner tone="bad">
              The lines of {count(lines.failed)}{" "}
              {lines.failed === 1 ? "journal" : "journals"} could not be read,
              so they are missing from the list below.
            </Banner>
          )}

          <Card className="overflow-clip max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
            {queryState(entries, {
              loading: "Reading the register…",
              // Every GET under /finance is behind a supervisor's sign-in, and a
              // refusal served as an empty register is the one failure a reader
              // cannot tell from an empty month.
              refused: (
                <NoAccessState
                  what="the journal"
                  reach="Reading the books takes a supervisor's sign-in; posting to them, head office's."
                />
              ),
              render: () =>
                rows.length === 0 && q === "" ? (
                  <EmptyState>
                    Nothing posted between {day(range.from)} and {day(range.to)}
                    {kind === null
                      ? ""
                      : ` by ${sourceWord(kind).toLowerCase()}`}
                    .
                  </EmptyState>
                ) : rows.length === 0 ? (
                  <NoMatch what="journals" onClear={clearNeedle} />
                ) : all ? (
                  flat.length === 0 && lines.waiting > 0 ? (
                    <EmptyState art={null}>Reading the lines…</EmptyState>
                  ) : (
                    <DataTable<FlatLine>
                      refresh={[entries]}
                      table={lineTable}
                      onRowClick={(row) => reading.open(row.entry.entry_id)}
                      isSelected={(row) => row.entry.entry_id === reading.value}
                      more={more}
                      // The server's figure over everything the window and the
                      // filters match, not a sum of the rows above. Debits equal
                      // credits in every entry, so one figure is both.
                      summary={{
                        source: `${count(matched)} ${matched === 1 ? "journal" : "journals"}`,
                        debet: money(head?.total_minor ?? null),
                        kredit: money(head?.total_minor ?? null),
                      }}
                      pageScroll
                      cardSort={false}
                      cardsApart
                      cardLead
                    />
                  )
                ) : (
                  <DataTable<JournalEntryRow>
                    refresh={[entries]}
                    table={table}
                    onRowClick={(entry) => reading.open(entry.entry_id)}
                    isSelected={(entry) => entry.entry_id === reading.value}
                    more={more}
                    summary={{
                      entry: `${count(matched)} jurnal`,
                      total: money(head?.total_minor ?? null),
                    }}
                    pageScroll
                    cardSort={false}
                    cardsApart
                    cardLead
                  />
                ),
            })}
          </Card>
        </>
      )}

      <EntryPanel
        id={reading.value ?? null}
        onClose={reading.close}
        onOpen={(id) => reading.open(id)}
      />
      <ComposerPanel
        // A new template is a new draft: the composer's state starts from it.
        key={initial === null ? "blank" : fromTemplate.value}
        open={composing || initial !== null}
        initial={initial}
        onClose={() => {
          setComposing(false)
          if (fromTemplate.value !== undefined) fromTemplate.close()
        }}
      />
    </PageContent>
  )
}

/// The templates that repeat: Template, Every, Amount, Next, Last jurnal. The
/// action opens the composer filled from the template, as the sweep would.
function RecurringTab({ onMake }: { onMake: (templateId: string) => void }) {
  const repeats = useQuery(journalRepeatsQuery())
  return queryState(repeats, {
    loading: "Reading the schedules…",
    render: (list) =>
      list.length === 0 ? (
        <EmptyState>No journal repeats yet.</EmptyState>
      ) : (
        <Grid followRows>
          <thead>
            <tr>
              <Th>Template</Th>
              <Th width="12rem">Every</Th>
              <Th align="right" width="11rem">
                Amount
              </Th>
              <Th width="8rem">Next</Th>
              <Th width="12rem">Last jurnal</Th>
              <Th width="13rem" />
            </tr>
          </thead>
          <tbody>
            {list.map((repeat) => (
              <tr key={repeat.repeat_id}>
                <Td className="max-w-0 text-ink">
                  <span className="block truncate">{repeat.template_name}</span>
                </Td>
                <Td>{label(repeat.frequency)}</Td>
                {/* The schedule carries no amount; the template's lines do. */}
                <Td align="right">
                  <span className="text-faint">—</span>
                </Td>
                <Td>{day(repeat.next_date)}</Td>
                <Td>
                  {repeat.last_run_on === null ? (
                    <span className="text-faint">—</span>
                  ) : (
                    day(repeat.last_run_on)
                  )}
                </Td>
                <Td align="right">
                  <Button
                    variant="primary"
                    onClick={() => onMake(repeat.template_id)}
                  >
                    Make jurnal now
                  </Button>
                </Td>
              </tr>
            ))}
          </tbody>
        </Grid>
      ),
  })
}

// ---------------------------------------------------------------------------
// One journal
// ---------------------------------------------------------------------------

/// Transaksi Jurnal, read: the header, its detail lines with Total and
/// Selisih, and the one action this book allows against a posted entry.
function EntryPanel({
  id,
  onClose,
  onOpen,
}: {
  id: string | null
  onClose: () => void
  /// Following `Reverses` / `Reversed by` to the other entry, without leaving
  /// the screen. Both entries are real and the question a reversal raises is
  /// always about the other one.
  onOpen: (id: string) => void
}) {
  const client = useQueryClient()
  const [reason, setReason] = useState("")
  const [postingDate, setPostingDate] = useState("")
  const [receipt, setReceipt] = useState<string | null>(null)

  const detail = useQuery({
    queryKey: financeKeys.entry(id ?? ""),
    queryFn: ({ signal }) => journalEntry(id ?? "", signal),
    enabled: id !== null,
  })

  const reverse = useMutation({
    mutationFn: () =>
      reverseEntry(
        id ?? "",
        reason.trim(),
        postingDate === "" ? undefined : postingDate
      ),
    onSuccess: (posted) => {
      setReason("")
      setReceipt(posted.entry_number)
      // A reversal writes a new entry, marks this one answered and moves every
      // balance, statement and trial balance with it. The whole namespace is
      // the only honest invalidation.
      void client.invalidateQueries({ queryKey: financeKeys.all })
    },
  })

  const entry = detail.data?.entry
  const answered = entry?.reversed_by != null

  return (
    <Sheet
      open={id !== null}
      onOpenChange={(open) => {
        if (!open) {
          setReceipt(null)
          setReason("")
          setPostingDate("")
          onClose()
        }
      }}
      // The number is the crumb's second half; the status and the count of
      // lines stand on the caption line under the title.
      context="Journal"
      title={entry?.entry_number ?? "Transaksi Jurnal"}
      badge={
        entry === undefined ? undefined : (
          <Pill tone={statusTone(entry)}>{statusOf(entry)}</Pill>
        )
      }
      size="wide"
      footer={
        entry === undefined ? undefined : (
          <SheetFooter
            onCancel={onClose}
            cancelLabel={answered ? "Close" : "Cancel"}
            note={
              answered ? undefined : "The reason is the only record of why."
            }
            primary={
              answered
                ? undefined
                : {
                    label: "Reverse",
                    tone: "danger",
                    pending: reverse.isPending,
                    pendingLabel: "Reversing…",
                    disabled: reason.trim() === "",
                    onClick: () => reverse.mutate(),
                  }
            }
          />
        )
      }
    >
      {queryState(detail, {
        loading: "Reading the entry…",
        render: ({ entry: header, lines }) => {
          const units = byUnit(lines)
          const interUnit = units.length > 1
          const debits = lines.reduce((sum, line) => sum + line.debit_minor, 0)
          const credits = lines.reduce(
            (sum, line) => sum + line.credit_minor,
            0
          )
          const { ref, note } = memoParts(header)

          return (
            <div className="flex flex-col gap-5">
              {receipt !== null && (
                <Banner tone="ok" onDismiss={() => setReceipt(null)}>
                  Reversed by {receipt}. Both entries stay in the books — this
                  one is still in every balance up to the reversal&rsquo;s date.
                </Banner>
              )}
              {reverse.isError && (
                <Banner tone="bad">
                  {reverse.error instanceof Error
                    ? reverse.error.message
                    : "The reversal was refused."}
                </Banner>
              )}

              <div className="flex flex-wrap items-center gap-1.5">
                <Pill tone="neutral">READ ONLY</Pill>
                <Pill tone={toneOf(header)}>
                  {sourceWord(header.source_kind)}
                </Pill>
                {interUnit && <Pill tone="accent">Inter-unit</Pill>}
                <span className="grow" />
                <Button variant="ghost" onClick={() => window.print()}>
                  Print
                </Button>
              </div>

              <Facts>
                <Fact term="Tanggal">
                  {day(header.posting_date)}
                  <span className="text-mute"> {moment(header.posted_at)}</span>
                </Fact>
                <Fact term="No Referensi">{ref === "" ? "—" : ref}</Fact>
                <Fact term="Keterangan">{note === "" ? "—" : note}</Fact>
                <Fact term="Status Otomatis">{byHand(header) ? "N" : "Y"}</Fact>
                <Fact term="Periode Acc">{periodOf(header.posting_date)}</Fact>
                <Fact term="Currency">{header.currency}</Fact>
                <Fact term="Posted by">{header.posted_by}</Fact>
                <Fact term="Posted at">{moment(header.posted_at)}</Fact>
                {header.source_id !== null && (
                  <Fact term="Source record">
                    <span className="font-mono text-[0.9375rem]">
                      {header.source_id}
                    </span>
                  </Fact>
                )}
                {header.reversal_of !== null && (
                  <Fact term="Reverses">
                    <button
                      type="button"
                      className="font-mono text-[0.9375rem] text-accent hover:underline"
                      onClick={() => onOpen(header.reversal_of ?? "")}
                    >
                      the entry it answers
                    </button>
                  </Fact>
                )}
                {header.reversed_by !== null && (
                  <Fact term="Reversed by">
                    <button
                      type="button"
                      className="font-mono text-[0.9375rem] text-accent hover:underline"
                      onClick={() => onOpen(header.reversed_by ?? "")}
                    >
                      the entry that answered it
                    </button>
                  </Fact>
                )}
              </Facts>

              <div>
                <SubHead aside={`${count(lines.length)} lines`}>Detail</SubHead>
                <Grid>
                  <thead>
                    <tr>
                      <Th>Deskripsi Account</Th>
                      <Th width="9rem">Kode Account</Th>
                      <Th>Uraian</Th>
                      <Th width="9rem">Unit</Th>
                      <Th align="right" width="9rem">
                        Debet
                      </Th>
                      <Th align="right" width="9rem">
                        Kredit
                      </Th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((line: JournalLineView) => (
                      <tr key={line.line_number}>
                        <Td>
                          <span className="block text-ink">
                            {line.account_name}
                            {/* What the line WAS. With forty accounts in the
                                chart the name above is a row of the statement
                                and this is the thing the reader came for, so
                                it sits on the same line — an entry whose eight
                                lines all read "Beban umum & administrasi" is
                                an entry nobody can check. */}
                            {line.category_name !== null && (
                              <span
                                className="text-mute"
                                title={line.category_code ?? undefined}
                              >
                                {" · "}
                                {line.category_name}
                              </span>
                            )}
                          </span>
                        </Td>
                        <Td>
                          {/* No dead ends: the question a line raises is
                              "what else is in that account", and the ledger
                              is the answer. */}
                          <AppLink
                            to="/finance/ledger"
                            sheet={{ key: "account", value: line.account_code }}
                            className="font-mono text-[0.9375rem] text-mute hover:text-accent hover:underline"
                          >
                            {line.account_code}
                          </AppLink>
                        </Td>
                        <Td className="text-body">{line.memo ?? ""}</Td>
                        <Td>
                          {/* One account, named once; the unit beside it. Never
                              "Cash on Hand — Store 04", which is the shape of
                              chart this module exists to stop. */}
                          <UnitName id={line.unit_id} />
                          {/* Who the balance is with, on an affiliate leg. */}
                          {line.counter_unit_id !== null && (
                            <span className="block text-[0.9375rem] text-mute">
                              with <UnitName id={line.counter_unit_id} />
                            </span>
                          )}
                        </Td>
                        <DebitCredit
                          debit={line.debit_minor}
                          credit={line.credit_minor}
                        />
                      </tr>
                    ))}
                    <TotalRow>
                      <Td>Total</Td>
                      <Td />
                      <Td />
                      <Td />
                      <Td align="right">{money(debits)}</Td>
                      <Td align="right">{money(credits)}</Td>
                    </TotalRow>
                    <TotalRow>
                      <Td>Selisih</Td>
                      <Td />
                      <Td />
                      <Td />
                      <Td align="right">{money(debits - credits)}</Td>
                      <Td />
                    </TotalRow>
                  </tbody>
                </Grid>
              </div>

              {interUnit && (
                <p className="text-[0.9375rem] text-body">
                  <b className="text-ink">
                    This entry moves money between units.
                  </b>{" "}
                  {units.map((unit, index) => (
                    <span key={unit.unit_id}>
                      {index > 0 && ", "}
                      <UnitName id={unit.unit_id} />{" "}
                      {unit.net_minor > 0 ? "up" : "down"}{" "}
                      {money(Math.abs(unit.net_minor))}
                    </span>
                  ))}
                  . Each unit&rsquo;s own books are left unbalanced.
                </p>
              )}

              {answered ? (
                <p className="text-[0.9375rem] text-body">
                  Already reversed. It stays in the books up to the date its
                  reversal was posted.
                </p>
              ) : (
                <div className="flex flex-col gap-2 border-t border-hairline pt-4">
                  <SubHead aside="posts a new entry">Reverse</SubHead>
                  {/* There is no cancel endpoint on this ledger at all, so the
                      only thing this button can do is write the opposite entry
                      and leave the original standing — and it says so,
                      because somebody reaching for it may have wanted the
                      other. */}
                  <p className="text-[0.9375rem] text-body">
                    This posts a <b>new entry</b> with the debits and credits
                    exchanged and leaves {header.entry_number} exactly as it is.
                    It is not a cancellation; nothing in this book can be
                    cancelled.
                  </p>
                  <Textarea
                    rows={2}
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                  />
                  <Field
                    label="Posting date"
                    hint="Empty posts the mirror today."
                    className="w-44"
                  >
                    <Day value={postingDate} onChange={setPostingDate} />
                  </Field>
                </div>
              )}
            </div>
          )
        },
      })}
    </Sheet>
  )
}

// ---------------------------------------------------------------------------
// Writing one
// ---------------------------------------------------------------------------

/// Transaksi Jurnal, written: 7Soft's header and detail grid with the unit on
/// every row.
///
/// # Why the balance is checked here as well as in the database
///
/// So the button does not offer to do something that will be refused. The check
/// that holds is a deferred constraint trigger at COMMIT; this one exists only
/// to be polite about it — Selisih must be 0 — and the same is true of a closed
/// month, whose refusal arrives as the trigger's own sentence and is quoted
/// verbatim.
///
/// # Why the per-unit figure is a warning and not a refusal
///
/// Because the server allows it. `journal_entry_balances` checks the entry, not
/// the unit, so an entry may debit head office and credit Store 04 and be
/// perfectly postable while neither unit's own books foot. A hand-written entry
/// gets no offsetting leg here, so the honest thing is to show the reader what
/// they are about to leave behind and let them decide.
function ComposerPanel({
  open,
  onClose,
  initial,
}: {
  open: boolean
  onClose: () => void
  /// A journal template to start from: its memo and its lines, which the
  /// person then checks, dates and posts like any other entry.
  initial?: {
    readonly name: string
    readonly memo: string
    readonly lines: DraftLine[]
    readonly skipped: number
  } | null
}) {
  const client = useQueryClient()
  const [postingDate, setPostingDate] = useState(todayIso)
  const [ref, setRef] = useState("")
  const [memo, setMemo] = useState(initial?.memo ?? "")
  const [lines, setLines] = useState<DraftLine[]>(() =>
    initial ? initial.lines : [blankLine(), blankLine()]
  )
  const [receipt, setReceipt] = useState<string | null>(null)
  // Minted once per composer and not per attempt: a retry after a dropped
  // connection must land the same entry, and generating the key inside the
  // request would defeat the whole mechanism.
  const [key, setKey] = useState(idempotencyKey)

  const totals = draftTotals(lines)
  const selisih = totals.debits - totals.credits

  const post = useMutation({
    mutationFn: () =>
      postManualEntry(
        {
          posting_date: postingDate,
          memo: memoOf(ref, memo),
          lines: totals.usable.map((row): ManualLine => ({
            account: {
              kind: "account",
              account_code: row.line.account!.account_code,
              // `null` for an account that declares no family, which is the
              // answer and not the absence of one: the trigger refuses a
              // line carrying a category its account cannot take.
              category_code: row.line.account!.category_code,
            },
            unit_id: row.line.unit_id,
            debit_minor: row.debit,
            credit_minor: row.credit,
            memo:
              row.line.memo === undefined || row.line.memo.trim() === ""
                ? null
                : row.line.memo.trim(),
          })),
        },
        key
      ),
    onSuccess: (posted) => {
      setReceipt(posted.entry_number)
      setLines([blankLine(), blankLine()])
      setRef("")
      setMemo("")
      setKey(idempotencyKey())
      // A posting moves the register, every balance, both statements and the
      // trial balance. There is no narrower honest answer.
      void client.invalidateQueries({ queryKey: financeKeys.all })
    },
  })

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setReceipt(null)
          onClose()
        }
      }}
      title="Transaksi Jurnal"
      caption={initial ? `From the template “${initial.name}”` : undefined}
      size="wide"
      footer={
        <SheetFooter
          onCancel={() => {
            setReceipt(null)
            onClose()
          }}
          note={
            totals.balanced
              ? `Balanced at ${money(totals.debits)}`
              : totals.usable.length === 0
                ? "No usable row yet — a row needs an account, a unit and a figure"
                : totals.uncategorised.length > 0
                  ? `${count(totals.uncategorised.length)} ${totals.uncategorised.length === 1 ? "row needs" : "rows need"} a category — the account is one line of the statement, the category is what it was for`
                  : selisih !== 0
                    ? `Selisih ${money(Math.abs(selisih))} — it must be 0 before posting`
                    : "Two usable rows are needed before posting"
          }
          primary={{
            label: "Post entry",
            pending: post.isPending,
            pendingLabel: "Posting…",
            disabled: !totals.balanced,
            onClick: () => post.mutate(),
          }}
        />
      }
    >
      <div className="flex flex-col gap-4">
        {initial && initial.skipped > 0 && (
          <Banner tone="warn">
            {count(initial.skipped)}{" "}
            {initial.skipped === 1
              ? "line of the template names"
              : "lines of the template name"}{" "}
            a posting role rather than an account, and cannot be drawn here. Add{" "}
            {initial.skipped === 1 ? "it" : "them"} by hand.
          </Banner>
        )}
        <div className="flex flex-wrap items-center gap-1.5">
          <Pill tone="new">NEW</Pill>
        </div>
        {receipt !== null && (
          <Banner tone="ok" onDismiss={() => setReceipt(null)}>
            Posted as {receipt}.
          </Banner>
        )}
        {post.isError && (
          <Banner tone="bad">
            {post.error instanceof Error
              ? post.error.message
              : "The entry was refused."}
          </Banner>
        )}

        <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
          <Field label="No Jurnal">
            <Input readOnly value="Otomatis" aria-label="No Jurnal" />
          </Field>
          <Field label="Tanggal" required>
            <Day value={postingDate} onChange={setPostingDate} />
          </Field>
          <Field label="No Referensi">
            <Input
              value={ref}
              onChange={(event) => setRef(event.target.value)}
            />
          </Field>
          <Field label="Periode Acc">
            <Input
              readOnly
              value={periodOf(postingDate)}
              aria-label="Periode Acc"
            />
          </Field>
          <Field label="Keterangan" className="sm:col-span-2 xl:col-span-3">
            <Input
              value={memo}
              onChange={(event) => setMemo(event.target.value)}
            />
          </Field>
          <Field label="Status Otomatis">
            <Input readOnly value="N" aria-label="Status Otomatis" />
          </Field>
        </div>

        <DetailGrid
          lines={lines}
          onChange={setLines}
          postingDate={postingDate}
          debits={totals.debits}
          credits={totals.credits}
        />

        {totals.adrift.length > 0 && (
          <p className="text-[0.9375rem] text-body">
            <b className="text-ink">This would be an inter-unit entry.</b> It
            leaves{" "}
            {totals.adrift.map((unit, index) => (
              <span key={unit.unit_id}>
                {index > 0 && ", "}
                <UnitName id={unit.unit_id} />{" "}
                {unit.net_minor > 0 ? "up" : "down"}{" "}
                {money(Math.abs(unit.net_minor))}
              </span>
            ))}
            . It will post, but each unit&rsquo;s own books stay unbalanced.
          </p>
        )}
      </div>
    </Sheet>
  )
}

/// The account of a row: its name, with the category the account's family asks
/// for beneath it. Choosing it fills Kode Account.
function AccountCell({
  value,
  onChange,
  row,
}: {
  value: AccountChoice | null
  onChange: (next: AccountChoice | null) => void
  row: number
}) {
  if (value === null || value.account_code === "")
    return (
      <AccountPicker
        onPick={(account) =>
          onChange({
            account_code: account.account_code,
            name: account.name,
            category_family: account.category_family,
            // Never carried across from whatever was chosen before: a
            // category belongs to a family, and a new account may not be in
            // the same one.
            category_code: null,
          })
        }
      />
    )
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-[0.9375rem] text-ink">
          {value.name === "" ? value.account_code : value.name}
        </span>
        <Button size="sm" variant="quiet" onClick={() => onChange(null)}>
          Change
        </Button>
      </span>
      {value.category_family !== null && (
        <CategoryPicker
          family={value.category_family}
          value={value.category_code ?? ""}
          label={`Category on row ${row}`}
          onPick={(code) => onChange({ ...value, category_code: code })}
        />
      )}
    </div>
  )
}

/// 7Soft's detail: Deskripsi Account, Kode Account, Uraian, Debet and Kredit
/// (and the unit, which the books need), with Total and Selisih under it and
/// the Penyusutan button over it.
function DetailGrid({
  lines,
  onChange,
  postingDate,
  debits,
  credits,
}: {
  lines: readonly DraftLine[]
  onChange: (next: DraftLine[]) => void
  postingDate: string
  debits: number
  credits: number
}) {
  const setLine = (index: number, patch: Partial<DraftLine>) =>
    onChange(
      lines.map((line, at) => (at === index ? { ...line, ...patch } : line))
    )
  const selisih = debits - credits

  return (
    <div>
      <SubHead aside={`${count(lines.length)} rows`}>Detail</SubHead>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button
          variant="primary"
          onClick={() => onChange([...lines, blankLine()])}
        >
          <Plus />
          Add row
        </Button>
        <Button
          variant="destructive"
          onClick={() => onChange([blankLine(), blankLine()])}
        >
          Del All
        </Button>
        <Penyusutan postingDate={postingDate} />
      </div>
      <Grid>
        <thead>
          <tr>
            <Th>Deskripsi Account</Th>
            <Th width="8rem">Kode Account</Th>
            <Th>Uraian</Th>
            <Th width="10rem">Unit</Th>
            <Th align="right" width="8.5rem">
              Debet
            </Th>
            <Th align="right" width="8.5rem">
              Kredit
            </Th>
            <Th width="2.5rem" />
          </tr>
        </thead>
        <tbody>
          {lines.map((line, index) => (
            <tr key={index}>
              <Td>
                <AccountCell
                  value={line.account}
                  row={index + 1}
                  onChange={(next) => setLine(index, { account: next })}
                />
              </Td>
              <Td>
                {line.account === null ? (
                  <span className="text-faint">—</span>
                ) : (
                  <Code>{line.account.account_code}</Code>
                )}
              </Td>
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
                  label={`Debet on row ${index + 1}`}
                  value={line.debit}
                  onChange={(next) => setLine(index, { debit: next })}
                  className="h-8"
                />
              </Td>
              <Td align="right">
                <Money
                  label={`Kredit on row ${index + 1}`}
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
            <Td />
            <Td />
            <Td />
            <Td align="right">{money(debits)}</Td>
            <Td align="right">{money(credits)}</Td>
            <Td />
          </TotalRow>
          <TotalRow>
            <Td>Selisih</Td>
            <Td />
            <Td />
            <Td />
            <Td align="right" className={cn(selisih !== 0 && "text-bad-fg!")}>
              {money(selisih)}
            </Td>
            <Td />
            <Td />
          </TotalRow>
        </tbody>
      </Grid>
    </div>
  )
}

/// 7Soft's PENYUSUTAN: the month's depreciation, formed from what the asset
/// register holds.
///
/// 7Soft fills the grid. The depreciation endpoint's preview answers asset by
/// asset and carries no accounts — the accounts are the asset classes' own,
/// resolved by the posting engine — so the grid cannot be filled from it
/// without keeping a second copy of those rules here. The button therefore
/// shows what the month would charge and, once it is read, posts the month's
/// depreciation through the same endpoint the asset register uses. Running it
/// twice is safe: the server refuses the second charge of an asset in a month.
function Penyusutan({ postingDate }: { postingDate: string }) {
  const client = useQueryClient()
  const year = Number(postingDate.slice(0, 4))
  const month = Number(postingDate.slice(5, 7))
  const valid = Number.isInteger(year) && month >= 1 && month <= 12
  const [run, setRun] = useState<DepreciationRun | null>(null)
  const [posted, setPosted] = useState<DepreciationRun | null>(null)

  const preview = useMutation({
    mutationFn: () => previewDepreciation(year, month),
    onSuccess: (result) => {
      setRun(result)
      setPosted(null)
    },
  })
  const charge = useMutation({
    mutationFn: () => runDepreciation(year, month),
    onSuccess: (result) => {
      setPosted(result)
      setRun(null)
      // The journal, the register, balances and the close checklist all moved.
      void client.invalidateQueries({ queryKey: financeKeys.all })
    },
  })

  return (
    <>
      <Button
        variant="primary"
        pending={preview.isPending}
        disabled={!valid}
        onClick={() => preview.mutate()}
      >
        {preview.isPending ? "Reading…" : "Penyusutan"}
      </Button>
      {(run !== null ||
        posted !== null ||
        preview.isError ||
        charge.isError) && (
        <div className="flex w-full flex-col gap-3 rounded-inner border border-hairline p-3">
          {preview.isError && (
            <Banner tone="bad">
              {preview.error instanceof Error
                ? preview.error.message
                : "The depreciation could not be read."}
            </Banner>
          )}
          {charge.isError && (
            <Banner tone="bad">
              {charge.error instanceof Error
                ? charge.error.message
                : "The depreciation was refused."}
            </Banner>
          )}
          {posted !== null && (
            <Banner tone="ok" onDismiss={() => setPosted(null)}>
              Penyusutan {monthYear(postingDate)} posted:{" "}
              {count(posted.posted_count)}{" "}
              {posted.posted_count === 1 ? "asset" : "assets"},{" "}
              {money(posted.posted_total_minor)}.
            </Banner>
          )}
          {run !== null && (
            <>
              <p className="text-[0.9375rem] text-body">
                <b className="text-ink">Penyusutan {monthYear(postingDate)}</b>
                {" · "}
                {count(run.posted_count)}{" "}
                {run.posted_count === 1 ? "asset" : "assets"},{" "}
                {money(run.posted_total_minor)}
                {run.skipped_count > 0 &&
                  `, ${count(run.skipped_count)} skipped`}
              </p>
              {run.blocked_count > 0 && (
                <Banner tone="warn">
                  {count(run.blocked_count)}{" "}
                  {run.blocked_count === 1 ? "asset has" : "assets have"} a
                  charge that cannot post under the current account mappings.
                </Banner>
              )}
              <div className="max-h-64 overflow-y-auto">
                <MiniTable head={["Asset", "Penyusutan"]}>
                  {run.lines.map((line) => (
                    <tr
                      key={line.asset_id}
                      className="border-t border-hairline"
                    >
                      <td className="py-2 pr-2 text-[0.9375rem] text-ink">
                        {line.name}{" "}
                        <span className="font-mono text-mute">
                          {line.asset_number}
                        </span>
                      </td>
                      <td className="py-2 text-right text-[0.9375rem] tabular-nums">
                        {line.blocked_because ??
                          line.skipped_because ??
                          money(line.amount_minor)}
                      </td>
                    </tr>
                  ))}
                </MiniTable>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="destructive" onClick={() => setRun(null)}>
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  pending={charge.isPending}
                  disabled={run.posted_count === 0 || run.blocked_count > 0}
                  onClick={() => charge.mutate()}
                >
                  {charge.isPending ? "Posting…" : "Post penyusutan"}
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </>
  )
}
