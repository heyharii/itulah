import { useForm } from "@tanstack/react-form"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { EyeOff, Pencil } from "lucide-react"
import { useCallback, useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Field, Input } from "@/components/ui/field"
import { SwitchPill } from "@/components/ui/form"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import {
  BarSpacer,
  ColumnsMenu,
  ExpandingSearch,
} from "@/components/ui/list-chrome"
import { PageHeader } from "@/components/ui/page-header"
import { SubTabs } from "@/components/ui/sub-tabs"
import { Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState } from "@/components/ui/states"
import { Tag } from "@/components/ui/tag"
import { useFilters } from "@/lib/filters"
import { count } from "@/lib/format"
import { toast } from "@/lib/toast"
import {
  createTerm,
  deleteTerm,
  listTerms,
  termUsage,
  updateTerm,
  vocabularyKeys,
  type MasterTerm,
  type VocabularyKind,
} from "@/lib/queries/vocabulary"
import { queryState } from "@/lib/query-state"
import { tableSetup, type TableSetup } from "@/lib/table"
import {
  ActiveRow,
  CodeFact,
  DeleteDialog,
  SubmitRow,
} from "@/screens/master/term-form"
import {
  said,
  snake,
  useIdempotencyKey,
  useReveal,
} from "@/screens/master/term-form-kit"

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
  /// Whether the form asks for the order. None does (owner, 2026-10-05): a new
  /// term goes after the others, and the column, where there is one, only reads.
  readonly orderField: boolean
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
  orderField: false,
}

const SIZES: Vocabulary = {
  kind: "sizes",
  title: "Sizes",
  sub: "Standard sizes used across articles. Each size has a fixed two-digit code.",
  one: "size",
  codePlaceholder: "03",
  labelPlaceholder: "M",
  empty: "No size has been declared, so no SKU can be created.",
  // The one list where the order is not a preference. Alphabetically, L comes
  // before M comes before S comes before XS.
  ordered: false,
  orderField: false,
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
  orderField: false,
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
        <span
          className={
            row.original.active
              ? "inline-flex items-center gap-2 text-[0.875rem] font-medium text-ink"
              : "inline-flex items-center gap-2 text-[0.875rem] font-medium text-mute"
          }
        >
          {!row.original.active && (
            <EyeOff
              aria-label="Inactive"
              className="size-3.5 shrink-0 text-mute"
            />
          )}
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
    header: "In Use",
    size: 120,
    // The one clause these lists want: "is 0" is the set worth looking at
    // before tidying up, which on forty tags is not something a sort makes
    // obvious. It is not the set that may be DELETED — see `lifecycle.tsx`;
    // articles are one of five things that can name a tag.
    meta: {
      align: "right",
      filter: {
        kind: "number",
        label: "In Use",
        unit: vocabulary.kind === "sizes" ? "SKUs" : "articles",
      },
    },
    // Zero is drawn as 0, not as "Unused". It was worded, on the argument
    // that "unused" is the state somebody scans for — but it read as a
    // licence to delete, which it is not, and a column of numbers with one
    // word in it is a column that stops adding up.
    // The number, and what it counts beside it in the quiet colour: "4 Articles".
    cell: ({ row }) => {
      const n = row.original.term.in_use
      const unit = vocabulary.kind === "sizes" ? "SKU" : "Article"
      return (
        <span className="text-[0.875rem] tabular-nums">
          <span className={n === 0 ? "text-mute" : "text-ink"}>{count(n)}</span>{" "}
          <span className="text-mute">{n === 1 ? unit : `${unit}s`}</span>
        </span>
      )
    },
  })

  columns.push({
    id: "action",
    header: "Action",
    size: 80,
    enableSorting: false,
    meta: { align: "right" },
    cell: ({ row }) => <RowActions label={row.original.term.label} />,
  })

  return columns
}

/// Edit: the row's own click opens the sheet; the button only says so. Inactive
/// and Delete live in the sheet (owner, 2026-10-05).
function RowActions({ label }: { label: string }) {
  return (
    <button
      type="button"
      aria-label={`Edit ${label}`}
      title="Edit"
      className="inline-flex size-8 cursor-pointer items-center justify-center rounded-inner text-mute transition-colors hover:bg-soft-2 hover:text-ink"
    >
      <Pencil className="size-4" />
    </button>
  )
}

function capitalise(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1)
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
    { label: "Total", value: count(all.length) },
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
            value: "ACTIVE",
            label: <TabLabel text="Active" n={all.length - retired} />,
          },
          {
            value: "INACTIVE",
            label: <TabLabel text="Inactive" n={retired} />,
          },
          {
            value: "ALL",
            label: <TabLabel text="All" n={all.length} />,
          },
        ]}
        value={tab}
        onChange={(next) => setTab(next as StatusTab)}
      />

      {/* One line, as the order book draws it: the search and what narrows the
          list at the left, what shapes the table and what makes a new one at
          the right. */}
      <div className="group/bar mb-3 flex min-h-[2.25rem] flex-wrap items-center gap-2">
        <ExpandingSearch
          value={query}
          onChange={setQuery}
          label={`Search ${vocabulary.title}`}
        />
        <SwitchPill
          on={inUseOnly}
          label="In Use"
          onToggle={() => setInUseOnly((was) => !was)}
        />
        <BarSpacer />
        <div className="hidden md:contents">
          <ColumnsMenu table={table} />
        </div>
        <Button
          variant="primary"
          onClick={() => {
            setEditing(null)
            setCreating(true)
          }}
        >
          New {capitalise(vocabulary.one)}
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
                    New {capitalise(vocabulary.one)}
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
      // The kind in small type above, the name as the title: "Division" over
      // "Anak Laki-laki" (owner, 2026-10-05).
      id={
        term === null ? undefined : (
          <span className="font-sans">{capitalise(vocabulary.one)}</span>
        )
      }
      title={
        term === null ? `New ${capitalise(vocabulary.one)}` : term.term.label
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
  active: boolean
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

/// A new size's two-digit code, chosen for it (owner, 2026-10-07: nobody types
/// one): the one after the highest in use, so 01 02 03 stay where they are, and
/// the lowest free one once 99 is taken. Empty when every code is spoken for.
function nextSizeCode(existing: readonly TermRow[]): string {
  const used = new Set(existing.map((row) => row.term.code))
  const highest = Math.max(
    0,
    ...existing
      .map((row) => Number(row.term.code))
      .filter((code) => Number.isInteger(code) && code >= 0 && code <= 99)
  )
  for (let step = 1; step <= 99; step++) {
    const code = String(((highest + step - 1) % 99) + 1).padStart(2, "0")
    if (!used.has(code)) return code
  }
  return ""
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
  const { attempt, reveal } = useReveal()
  const [deleting, setDeleting] = useState(false)
  const remove = useMutation({
    mutationFn: () =>
      deleteTerm(vocabulary.kind, term!.term.code, term!.term.version),
    onSuccess: () => {
      setDeleting(false)
      void client.invalidateQueries({ queryKey: vocabularyKeys.all })
      void client.invalidateQueries({ queryKey: ["procurement", "vocabulary"] })
      void client.invalidateQueries({ queryKey: ["articles"] })
      onSaved()
    },
    onError: (error) => toast.error(said(error)),
  })

  const save = useMutation({
    mutationFn: (draft: TermDraft) => {
      const label = draft.label.trim()
      const order =
        term === null &&
        !vocabulary.orderField &&
        (vocabulary.kind === "divisions" || vocabulary.kind === "sizes")
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
            { label, display_order: order, active: draft.active },
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

  // A size's code is not asked for: it is the next free two digits.
  const autoCode = term === null && vocabulary.kind === "sizes"
  const form = useForm({
    defaultValues: {
      code: term?.term.code ?? (autoCode ? nextSizeCode(existing) : ""),
      label: term?.term.label ?? "",
      order: String(term?.order ?? 0),
      active: term?.active ?? true,
    } as TermDraft,
    onSubmit: ({ value: typed }) => {
      attempt()
      // Chosen again at the moment of saving: the list may have grown since
      // the form opened.
      const value = autoCode
        ? { ...typed, code: nextSizeCode(existing) }
        : typed
      if (autoCode && value.code === "") {
        toast.error("Every two-digit size code is already taken.")
        return
      }
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

            {autoCode ? null : term === null ? (
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
              <CodeFact code={term.term.code} />
            )}

            {term !== null && (
              <form.Field name="active">
                {(field) => (
                  <ActiveRow
                    on={field.state.value}
                    noun={vocabulary.one}
                    label={term.term.label}
                    usage={{
                      queryKey: vocabularyKeys.usage(
                        vocabulary.kind,
                        term.term.code
                      ),
                      queryFn: ({ signal }) =>
                        termUsage(vocabulary.kind, term.term.code, signal),
                    }}
                    onToggle={() => field.handleChange(!field.state.value)}
                  />
                )}
              </form.Field>
            )}

            {/* Only where an order is a decision. A tag's was a number
                nobody set and every row showed 0 — a field that exists
                because the table has a column, which is the wrong reason. */}
            {vocabulary.orderField && (
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

            <SubmitRow
              pending={save.isPending}
              creating={term === null}
              noun={vocabulary.one}
              onDelete={
                term !== null && term.term.in_use === 0
                  ? () => setDeleting(true)
                  : undefined
              }
            />
            {term !== null && (
              <DeleteDialog
                open={deleting}
                onOpenChange={setDeleting}
                noun={vocabulary.one}
                label={term.term.label}
                usage={{
                  queryKey: vocabularyKeys.usage(
                    vocabulary.kind,
                    term.term.code
                  ),
                  queryFn: ({ signal }) =>
                    termUsage(vocabulary.kind, term.term.code, signal),
                }}
                pending={remove.isPending}
                onConfirm={() => remove.mutate()}
              />
            )}
          </>
        )}
      </form.Subscribe>
    </form>
  )
}
