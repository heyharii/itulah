import { useForm } from "@tanstack/react-form"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { Search } from "lucide-react"
import { useCallback, useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Field, Input } from "@/components/ui/field"
import { Switch, SwitchPill } from "@/components/ui/form"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { ColumnsMenu } from "@/components/ui/list-chrome"
import { PageHeader } from "@/components/ui/page-header"
import { SubTabs } from "@/components/ui/sub-tabs"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState } from "@/components/ui/states"
import { Tag } from "@/components/ui/tag"
import { useFilters } from "@/lib/filters"
import { count } from "@/lib/format"
import { toast } from "@/lib/toast"
import {
  createTerm,
  listTerms,
  updateTerm,
  vocabularyKeys,
  type MasterTerm,
  type VocabularyKind,
} from "@/lib/queries/vocabulary"
import { queryState } from "@/lib/query-state"
import { tableSetup, type TableSetup } from "@/lib/table"

/// Divisions, sizes and tags — the three lists, on one screen written once.
///
/// # Why these could not be edited until now
///
/// All three have been controlled lists since the article master was built, for
/// the reason free text fails: a misspelt division does not error, it silently
/// creates a division of one and splits every report that groups by it. But
/// none of them ever got a way in. Every term was a row somebody `INSERT`ed in
/// a migration, so adding a size meant shipping a release, and the app could
/// only show them as filter facets — a list you could narrow by but never
/// look at.
///
/// # Why one screen and not three
///
/// Because they are one shape: a code the goods point at, a label people read,
/// an order they are shown in, and whether they are still offered. Three copies
/// is three places for the fourth change to land in two of them — which is
/// precisely the class of divergence a master list exists to prevent, and a
/// poor thing to reintroduce in the screen that serves it.
///
/// Colours keep their own screen. A colour carries a hex value, draws as a
/// swatch and has a picker built on it; folded in here it would be a fourth
/// column that is blank for three of the four lists.
///
/// # Two rules this screen explains rather than merely enforces
///
/// A term that has ever been used cannot be deleted, only made inactive. Not "a term
/// with articles behind it" — articles are one of five tables that can name a
/// tag, a promotion can select on one from inside a jsonb rule with no foreign
/// key at all, and a term unpicked from everything last month still reads in
/// last year's report. The sheet has no Delete or "Used by" for now (owner,
/// 2026-10-05: keep the sheet simple); `lifecycle.tsx` still holds that answer.
///
/// And a code is not editable: it is what `article.division_code`,
/// `sku.size_code` and `article_tag.tag_code` hold, so a code that moved would
/// be a rename that lost the goods. The term created with the code spelt wrong
/// is the one case delete exists for.

/// What differs between the three, and nothing else does.
interface Vocabulary {
  readonly kind: VocabularyKind
  readonly title: string
  readonly sub: string
  /// Singular, for buttons and sheet titles.
  readonly one: string
  readonly codePlaceholder: string
  readonly labelPlaceholder: string
  /// Said in the empty state: what stops working while the list is empty.
  readonly empty: string
  /// Whether the list is drawn in an order somebody chose.
  ///
  /// Sizes must be: `XS S M L XL XXL` is not alphabetical and not numeric, and
  /// no sort but a chosen one produces it. Divisions are read in the order the
  /// business thinks of itself. **Tags are not**, on the owner's instruction of
  /// 2026-09-12: every tag in the seed sat at 0, which is what a field nobody
  /// has a use for looks like. They are found by searching and read
  /// alphabetically, so the column and the field both go.
  readonly ordered: boolean
}

const DIVISIONS: Vocabulary = {
  kind: "divisions",
  title: "Divisions",
  // Plain, and deliberately not a sentence about the data model. The screen is
  // read by merchandisers, and "the top-level split of the catalogue" is a
  // description of a table rather than of a job.
  sub: "Top-level grouping for articles. Every article belongs to one division.",
  one: "division",
  codePlaceholder: "OUTERWEAR",
  labelPlaceholder: "Outerwear",
  empty: "No division has been declared, so no article can be filed under one.",
  // No Order column or field (owner, 2026-10-05: "order di divisions itu buat
  // apa? hapus saja"). The numbers already set stay; a new division goes to
  // the end of them.
  ordered: false,
}

const SIZES: Vocabulary = {
  kind: "sizes",
  title: "Sizes",
  sub: "Standard sizes used across articles. Each size has a fixed two-digit code.",
  one: "size",
  codePlaceholder: "03",
  labelPlaceholder: "M",
  empty: "No size has been declared, so no SKU can be minted.",
  // The one list where the order is not a preference. Alphabetically, L comes
  // before M comes before S comes before XS.
  ordered: true,
}

const TAGS: Vocabulary = {
  kind: "tags",
  title: "Tags",
  sub: "Flexible labels used to describe and filter articles. An article can have multiple tags.",
  one: "tag",
  codePlaceholder: "KEMEJA",
  labelPlaceholder: "Kemeja",
  empty: "No tag has been declared, so nothing can be classified yet.",
  ordered: false,
}

export function Divisions() {
  return <VocabularyScreen vocabulary={DIVISIONS} />
}

export function Sizes() {
  return <VocabularyScreen vocabulary={SIZES} />
}

export function Tags() {
  return <VocabularyScreen vocabulary={TAGS} />
}

interface TermRow {
  readonly term: MasterTerm
  /// Still offered for new work.
  readonly active: boolean
  readonly order: number
}

/// A projection rather than a cast: `active` and `display_order` are what the
/// table sorts and filters by, and reaching two levels into a record for a sort
/// key is how a column quietly stops sorting.
function readRow(term: MasterTerm): TermRow {
  return { term, active: term.active, order: term.display_order }
}

/// The table, per list.
///
/// Not one constant for the three, because the three do not want the same
/// columns: Order is a chosen sequence for divisions and sizes and was dead
/// weight on tags. The first column takes the list's own noun — "Tag", not
/// "Term" — since a screen that says Tag at the top and Term over the column
/// is asking the reader to hold two words for one thing.
function columnsOf(vocabulary: Vocabulary): ColumnDef<TableSetup, TermRow>[] {
  const columns: ColumnDef<TableSetup, TermRow>[] = [
    {
      id: "term",
      accessorFn: (row) => `${row.term.label} ${row.term.code}`,
      header: capitalise(vocabulary.one),
      size: 260,
      meta: { grow: 260 },
      cell: ({ row }) => (
        <span className="text-[0.875rem] font-medium text-ink">
          {row.original.term.label}
        </span>
      ),
    },
    {
      id: "code",
      accessorFn: (row) => row.term.code,
      header: "Code",
      size: 170,
      // Beside the label, not instead of it: the code is what an article row
      // points at and what survives a rename, so somebody reading the database
      // has to be able to find it here.
      cell: ({ row }) => <Tag>{row.original.term.code}</Tag>,
    },
  ]

  if (vocabulary.ordered) {
    columns.push({
      id: "order",
      accessorFn: (row) => row.order,
      header: "Order",
      size: 90,
      meta: { align: "right" },
      cell: ({ row }) => (
        <span className="text-[0.875rem] text-text tabular-nums">
          {row.original.order}
        </span>
      ),
    })
  }

  columns.push({
    id: "articles",
    accessorFn: (row) => row.term.in_use,
    header: "Articles",
    size: 120,
    // The one clause these lists want: "is 0" is the set worth looking at
    // before tidying up, which on forty tags is not something a sort makes
    // obvious. It is not the set that may be DELETED — see `lifecycle.tsx`;
    // articles are one of five things that can name a tag.
    meta: {
      align: "right",
      filter: { kind: "number", label: "Articles", unit: "articles" },
    },
    // Zero is drawn as 0, not as "Unused". It was worded, on the argument
    // that "unused" is the state somebody scans for — but it read as a
    // licence to delete, which it is not, and a column of numbers with one
    // word in it is a column that stops adding up.
    cell: ({ row }) => (
      <span
        className={
          row.original.term.in_use === 0
            ? "text-[0.875rem] text-mute tabular-nums"
            : "text-[0.875rem] text-text tabular-nums"
        }
      >
        {count(row.original.term.in_use)}
      </span>
    ),
  })

  return columns
}

function capitalise(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1)
}

/// Active or inactive, in the row. Inactive is the old "retired": still
/// there, never deleted, and no longer offered for new work.
function StatusSwitch({
  vocabulary,
  row,
}: {
  vocabulary: Vocabulary
  row: TermRow
}) {
  const client = useQueryClient()
  const change = useMutation({
    mutationFn: () =>
      updateTerm(
        vocabulary.kind,
        row.term.code,
        { active: !row.active },
        row.term.version,
        crypto.randomUUID()
      ),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: vocabularyKeys.all })
      void client.invalidateQueries({ queryKey: ["procurement", "vocabulary"] })
      void client.invalidateQueries({ queryKey: ["articles"] })
    },
    onError: (error) => toast.error(said(error)),
  })
  return (
    <span className="inline-flex items-center gap-2.5">
      <Switch
        on={row.active}
        busy={change.isPending}
        label={`${row.active ? "Deactivate" : "Activate"} ${row.term.label}`}
        onToggle={() => change.mutate()}
      />
      <span className={row.active ? "text-ink" : "text-mute"}>
        {row.active ? "Active" : "Inactive"}
      </span>
    </span>
  )
}

type StatusTab = "ALL" | "ACTIVE" | "INACTIVE"

function TabLabel({ text, n }: { text: string; n: number }) {
  return (
    <span>
      {text}
      <span className="ml-1.5 text-body tabular-nums">{count(n)}</span>
    </span>
  )
}

function VocabularyScreen({ vocabulary }: { vocabulary: Vocabulary }) {
  const [query, setQuery] = useState("")
  const [sorting, setSorting] = useState<SortingState>([])
  const [editing, setEditing] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [tab, setTab] = useState<StatusTab>("ACTIVE")
  const [inUseOnly, setInUseOnly] = useState(false)

  // The whole list in one read. A company has five divisions, a dozen sizes and
  // a few dozen tags, so there is nothing to page — which is also what lets the
  // duplicate-label check answer while somebody is still typing.
  const terms = useQuery({
    queryKey: vocabularyKeys.list(vocabulary.kind),
    queryFn: ({ signal }) => listTerms(vocabulary.kind, signal),
  })

  const all = useMemo(
    () => (terms.data?.terms ?? []).map(readRow),
    [terms.data]
  )

  // Every term reaches the table. What narrows it is the panel beside it, and
  // only that — a second sieve in front of the table is how a status segment
  // and a status chip end up giving two different answers.
  const rows = useMemo(
    () =>
      all.filter(
        (row) =>
          (tab === "ALL" || row.active === (tab === "ACTIVE")) &&
          (!inUseOnly || row.term.in_use > 0)
      ),
    [all, tab, inUseOnly]
  )

  const columns = useMemo(() => columnsOf(vocabulary), [vocabulary])
  const filters = useFilters(columns)

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns: filters.columns,
        getRowId: (row: TermRow) => row.term.code,
        state: {
          columnFilters: filters.columnFilters,
          globalFilter: query,
          sorting,
        },
        onSortingChange: setSorting,
        onGlobalFilterChange: setQuery,
      }),
      [rows, filters.columns, filters.columnFilters, query, sorting]
    )
  )

  const selected = all.find((row) => row.term.code === editing) ?? null
  const retired = all.filter((row) => !row.active).length
  const kpis = [
    { label: capitalise(vocabulary.title), value: count(all.length) },
    { label: "Active", value: count(all.length - retired) },
    { label: "Inactive", value: count(retired) },
    {
      label: "In Use",
      value: count(all.filter((row) => row.term.in_use > 0).length),
    },
  ]

  const close = useCallback(() => {
    setCreating(false)
    setEditing(null)
  }, [])

  return (
    <PageContent>
      <PageHeader title={vocabulary.title} small />

      {/* The same cards the order book opens on. */}
      <KpiStrip className="grid-cols-2 md:grid-cols-4 xl:grid-cols-4">
        {kpis.map((one) => (
          <Kpi key={one.label} label={one.label} value={one.value} />
        ))}
      </KpiStrip>

      <SubTabs
        tabs={[
          {
            value: "ALL",
            label: <TabLabel text="All" n={all.length} />,
          },
          {
            value: "ACTIVE",
            label: <TabLabel text="Active" n={all.length - retired} />,
          },
          {
            value: "INACTIVE",
            label: <TabLabel text="Inactive" n={retired} />,
          },
        ]}
        value={tab}
        onChange={(next) => setTab(next as StatusTab)}
      />

      {/* One line, as the order book draws it: the search and what narrows the
          list at the left, what shapes the table and what makes a new one at
          the right. */}
      <div className="mb-3 flex min-h-[2.25rem] flex-wrap items-center gap-2">
        <span className="relative min-w-0 flex-1 lg:w-44 lg:flex-none">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-line-ico" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label={`Search ${vocabulary.title.toLowerCase()}`}
            placeholder={`Search ${vocabulary.title.toLowerCase()}`}
            className="h-[2.125rem] w-full rounded-inner border border-hairline-2 bg-canvas pr-2.5 pl-8 text-[0.875rem] text-ink shadow-soft outline-none placeholder:text-body focus:border-accent pointer-coarse:h-11"
          />
        </span>
        <SwitchPill
          on={inUseOnly}
          label="In Use"
          onToggle={() => setInUseOnly((was) => !was)}
        />
        <span className="flex-1 max-lg:hidden" />
        <div className="hidden md:contents">
          <ColumnsMenu table={table} label="View" />
        </div>
        <Button
          variant="primary"
          onClick={() => {
            setEditing(null)
            setCreating(true)
          }}
        >
          New {vocabulary.one}
        </Button>
      </div>

      <Card className="overflow-clip">
        {queryState(terms, {
          loading: "Reading the vocabulary…",
          render: () =>
            all.length === 0 ? (
              <EmptyState
                action={
                  <Button variant="primary" onClick={() => setCreating(true)}>
                    New {vocabulary.one}
                  </Button>
                }
              >
                {vocabulary.empty}
              </EmptyState>
            ) : (
              <DataTable<TermRow>
                table={table}
                onRowClick={(row) => {
                  setCreating(false)
                  setEditing(row.term.code)
                }}
                isSelected={(row) => row.term.code === editing}
                empty="Nothing matches that search."
                pageScroll
              />
            ),
        })}
      </Card>

      <TermSheet
        vocabulary={vocabulary}
        open={creating || selected !== null}
        term={creating ? null : selected}
        existing={all}
        onClose={close}
      />
    </PageContent>
  )
}

// ---------------------------------------------------------------------------

/// A key held across retries and rotated after a success.
///
/// The point of an idempotency key is that a retry carries the SAME one, so the
/// server replays its first answer instead of writing a second term. Minted
/// inside the mutation it would be a fresh key per click, and a double-clicked
/// save would be two rows.
function useIdempotencyKey(): {
  readonly key: string
  readonly rotate: () => void
} {
  const [key, setKey] = useState(() => crypto.randomUUID())
  const rotate = useCallback(() => setKey(crypto.randomUUID()), [])
  return { key, rotate }
}

function said(error: unknown): string {
  return error instanceof Error ? error.message : "That did not save."
}

function TermSheet({
  vocabulary,
  open,
  term,
  existing,
  onClose,
}: {
  vocabulary: Vocabulary
  open: boolean
  term: TermRow | null
  existing: readonly TermRow[]
  onClose: () => void
}) {
  const form = (
    <TermForm
      // Keyed so switching rows with the sheet open re-seeds the form rather
      // than leaving the previous term's label in the field.
      key={term?.term.code ?? "new"}
      vocabulary={vocabulary}
      term={term}
      existing={existing}
      onSaved={onClose}
    />
  )
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      id={term?.term.code}
      title={term === null ? `New ${vocabulary.one}` : term.term.label}
      caption={
        term === null ? undefined : (
          <StatusSwitch vocabulary={vocabulary} row={term} />
        )
      }
    >
      {form}
    </Sheet>
  )
}

interface TermDraft {
  code: string
  label: string
  order: string
}

/// The code suggested from the label, for the two lists whose codes are names.
///
/// Sizes are excluded: their code is two digits of a SKU, and a suggestion
/// derived from "M" would be "M", which is not a size code and would be
/// rejected. Better to leave the field empty and let the hint say what it wants.
function snake(label: string): string {
  return label
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
}

function problemsWith(
  draft: TermDraft,
  vocabulary: Vocabulary,
  term: TermRow | null,
  existing: readonly TermRow[]
): { label?: string; code?: string; order?: string } {
  const problems: { label?: string; code?: string; order?: string } = {}
  const label = draft.label.trim()
  const code = draft.code.trim()

  if (label === "") {
    problems.label = "A term needs a name somebody can read on a picking list."
  } else if (
    existing.some(
      (row) =>
        row.term.code !== term?.term.code &&
        row.term.label.trim().toLowerCase() === label.toLowerCase()
    )
  ) {
    // Checked here so a clash is named while somebody is still typing, and
    // checked again by the unique index, which is the actual authority.
    problems.label = "Another term already reads that way."
  }

  if (term === null) {
    if (code === "") {
      problems.code = "A code is required."
    } else if (vocabulary.kind === "sizes" && !/^[0-9]{2}$/.test(code)) {
      problems.code = "Exactly two digits, for example 03."
    } else if (
      vocabulary.kind !== "sizes" &&
      !/^[A-Z0-9_]+$/.test(code.toUpperCase().replace(/[ -]/g, "_"))
    ) {
      problems.code = "Letters, digits and underscores only."
    } else if (existing.some((row) => row.term.code === code.toUpperCase())) {
      problems.code = "That code is taken."
    }
  }

  if (draft.order.trim() !== "" && !Number.isFinite(Number(draft.order))) {
    problems.order = "A whole number."
  }

  return problems
}

function TermForm({
  vocabulary,
  term,
  existing,
  onSaved,
}: {
  vocabulary: Vocabulary
  term: TermRow | null
  existing: readonly TermRow[]
  onSaved: () => void
}) {
  const client = useQueryClient()
  const idempotency = useIdempotencyKey()
  // Suggested from the label until somebody types over it, and then left alone:
  // a code corrected by hand should not be silently rewritten by the next
  // keystroke in the field above it.
  const [codeTyped, setCodeTyped] = useState(false)
  /// Nothing is called wrong before it has been touched: a new term's form
  /// used to open red, two errors over two empty boxes. Gaps are named once a
  /// field has been left, or once Add / Save has been pressed on a form that
  /// is not ready.
  const [tried, setTried] = useState(false)
  const reveal = (touched: boolean, problem: string | undefined) =>
    tried || touched ? problem : undefined

  const save = useMutation({
    mutationFn: (draft: TermDraft) => {
      const label = draft.label.trim()
      const order =
        !vocabulary.ordered && term === null && vocabulary.kind === "divisions"
          ? Math.max(0, ...existing.map((row) => row.order)) + 1
          : draft.order.trim() === ""
            ? undefined
            : Number(draft.order)
      return term === null
        ? createTerm(
            vocabulary.kind,
            { code: draft.code.trim(), label, display_order: order },
            idempotency.key
          )
        : updateTerm(
            vocabulary.kind,
            term.term.code,
            { label, display_order: order },
            term.term.version,
            idempotency.key
          )
    },
    onSuccess: () => {
      // The whole prefix, plus the catalogue vocabulary: divisions and tags are
      // also read through `/catalogue/vocabulary` by every filter column and
      // the setup composer, and a term renamed here that still reads the old
      // way there is the drift these tables exist to end.
      void client.invalidateQueries({ queryKey: vocabularyKeys.all })
      void client.invalidateQueries({ queryKey: ["procurement", "vocabulary"] })
      void client.invalidateQueries({ queryKey: ["articles"] })
      idempotency.rotate()
      onSaved()
    },
  })

  const form = useForm({
    defaultValues: {
      code: term?.term.code ?? "",
      label: term?.term.label ?? "",
      order: String(term?.order ?? 0),
    } as TermDraft,
    onSubmit: ({ value }) => {
      setTried(true)
      const found = problemsWith(value, vocabulary, term, existing)
      if (Object.keys(found).length > 0) return
      save.mutate(value)
    },
  })

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        form.handleSubmit()
      }}
      className="flex flex-col gap-3.5"
    >
      {save.isError && <Banner tone="bad">{said(save.error)}</Banner>}

      <form.Subscribe
        selector={(state) =>
          problemsWith(state.values, vocabulary, term, existing)
        }
      >
        {(problems) => (
          <>
            <form.Field name="label">
              {(field) => (
                <Field
                  label="Label"
                  required
                  problem={reveal(field.state.meta.isTouched, problems.label)}
                >
                  <Input
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => {
                      field.handleChange(event.target.value)
                      if (
                        term === null &&
                        !codeTyped &&
                        vocabulary.kind !== "sizes"
                      ) {
                        form.setFieldValue("code", snake(event.target.value))
                      }
                    }}
                  />
                </Field>
              )}
            </form.Field>

            {term === null ? (
              <form.Field name="code">
                {(field) => (
                  <Field
                    label="Code"
                    required
                    problem={reveal(field.state.meta.isTouched, problems.code)}
                  >
                    <Input
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(event) => {
                        setCodeTyped(true)
                        field.handleChange(event.target.value)
                      }}
                    />
                  </Field>
                )}
              </form.Field>
            ) : (
              // An existing code is read, not edited: the goods point at it.
              // Said as a fact, not as a greyed box that looks like a field
              // that is broken.
              <Facts>
                <Fact term="Code">
                  <span className="font-mono">{term.term.code}</span>
                </Fact>
              </Facts>
            )}

            {/* Only where an order is a decision. A tag's was a number
                nobody set and every row showed 0 — a field that exists
                because the table has a column, which is the wrong reason. */}
            {vocabulary.ordered && (
              <form.Field name="order">
                {(field) => (
                  <Field
                    label="Order"
                    problem={reveal(field.state.meta.isTouched, problems.order)}
                  >
                    <Input
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(event) =>
                        field.handleChange(event.target.value)
                      }
                      inputMode="numeric"
                    />
                  </Field>
                )}
              </form.Field>
            )}

            <div className="flex items-center justify-end gap-2 pt-1">
              <Button type="submit" variant="primary" pending={save.isPending}>
                {save.isPending
                  ? "Saving…"
                  : term === null
                    ? `Add ${capitalise(vocabulary.one)}`
                    : "Save"}
              </Button>
            </div>
          </>
        )}
      </form.Subscribe>
    </form>
  )
}
