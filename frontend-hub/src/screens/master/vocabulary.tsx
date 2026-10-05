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
import { FilterOmnibox } from "@/components/ui/filter-omnibox"
import {
  ColumnsMenu,
  DockedFilters,
  SortMenu,
  ViewPicker,
} from "@/components/ui/list-chrome"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState } from "@/components/ui/states"
import { Tag } from "@/components/ui/tag"
import { useFilters } from "@/lib/filters"
import { count } from "@/lib/format"
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
import { MasterLifecycle } from "@/screens/master/lifecycle"

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
/// A term that has ever been used cannot be deleted, only retired. Not "a term
/// with articles behind it" — articles are one of five tables that can name a
/// tag, a promotion can select on one from inside a jsonb rule with no foreign
/// key at all, and a term unpicked from everything last month still reads in
/// last year's report. `MasterLifecycle` draws that answer from the server; see
/// `lifecycle.tsx`.
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
  ordered: true,
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

  columns.push(
    {
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
    },
    {
      id: "status",
      accessorFn: (row) => (row.active ? "ACTIVE" : "RETIRED"),
      header: "Status",
      size: 110,
      // Filtered here, and nowhere else. It was a three-way segment above the
      // table — All · Active · Retired — which narrowed the rows BEFORE the
      // table saw them, so the column could not carry a chip without two
      // controls both claiming to be why the list was empty. The panel beside
      // the table took the segment's job on 2026-09-13: one place to say which
      // part of the vocabulary you are looking at, in the URL like every other
      // clause, and the segment is gone rather than left to disagree with it.
      //
      // The value is the WORD and not `1`/`0`, because a filter's values ride
      // in the address bar and `status is 1` is not a thing anybody can read.
      meta: {
        filter: {
          kind: "option",
          label: "Status",
          single: true,
          operators: ["isAnyOf"],
          // Declared rather than gathered off the rows: a vocabulary with
          // nothing retired must still offer Retired, because its emptiness is
          // the answer somebody is looking for.
          options: [
            { value: "ACTIVE", label: "Active" },
            { value: "RETIRED", label: "Cancelled" },
          ],
          format: (value) => (value === "ACTIVE" ? "Active" : "Cancelled"),
        },
      },
      //
      // Active and Retired, not Offered and Retired. "Offered" made the reader
      // guess who it was offered to — sold? in the POS? pickable on an article?
      // — and the answer is the last of those. Active/Retired says it without
      // the guess, and pairs with the word on the segment above.
      // Retired is `neutral`, not `bad`: a term taken out of the picker is a
      // decision somebody made, not a fault in the row.
      cell: ({ row }) =>
        row.original.active ? (
          <Pill tone="ok">Active</Pill>
        ) : (
          <Pill tone="neutral">Cancelled</Pill>
        ),
    }
  )

  return columns
}

function capitalise(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1)
}

function VocabularyScreen({ vocabulary }: { vocabulary: Vocabulary }) {
  const [query, setQuery] = useState("")
  const [sorting, setSorting] = useState<SortingState>([])
  const [editing, setEditing] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

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
  const rows = all

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

  const close = useCallback(() => {
    setCreating(false)
    setEditing(null)
  }, [])

  return (
    <PageContent>
      <PageHeader
        title={vocabulary.title}
        sub={vocabulary.sub}
        actions={
          <Button
            onClick={() => {
              setEditing(null)
              setCreating(true)
            }}
          >
            New {vocabulary.one}
          </Button>
        }
      />

      {/* Two columns from 1440 up: the list, and the panel that narrows it —
          the shape Sourcing and the order book already wear, brought here on
          2026-09-13 so the four lists an article is described with are read
          with the same chrome as the article itself. Below that width the
          panel is the omnibox above the table, which is the same model drawn
          as a line. */}
      <div className="grid min-w-0 items-start gap-5 dock:grid-cols-[minmax(0,1fr)_16rem]">
        <div className="flex min-w-0 flex-col">
          {/* One line, the width of the table, carrying everything that
              acts on it — the same line the order book wears, in the same
              order: what narrows it at the left, what orders and shapes it in
              the middle, which view it is at the right.

              It was a full-width box above a second row until 2026-09-13. Two
              rows of chrome over one short list is one row too many, and the
              owner said so. */}
          <div className="mb-3 flex flex-wrap items-center gap-1.5">
            {/* The plain box, where the panel beside it is carrying the
                filters. Below 1440 the panel is gone and the omnibox below
                takes both jobs, so only one of the two is ever on screen. */}
            <span className="relative mr-auto hidden dock:block">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-line-ico" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                aria-label={`Search ${vocabulary.title.toLowerCase()}`}
                className="h-[2.125rem] w-56 rounded-inner border border-hairline-2 bg-canvas pr-2.5 pl-8 text-[0.875rem] text-ink shadow-soft outline-none placeholder:text-body focus:border-accent"
              />
            </span>
            <span className="mr-auto text-[0.875rem] text-body dock:mr-0">
              <b className="font-medium text-ink">{count(all.length)}</b>{" "}
              {vocabulary.title.toLowerCase()} · {count(retired)} retired
            </span>
            <SortMenu
              table={table}
              sorting={sorting}
              onSort={(id, desc) => setSorting([{ id, desc }])}
            />
            <ColumnsMenu table={table} />
            <span aria-hidden className="mx-1 h-5 w-px bg-hairline" />
            <ViewPicker
              model={filters}
              id={`vocabulary-${vocabulary.kind}`}
              all={`All ${vocabulary.title.toLowerCase()}`}
            />
          </div>

          {/* The same model as the panel, drawn as one line, for the widths
              where the panel is not on screen. */}
          <FilterOmnibox
            model={filters}
            text={query === "" ? undefined : query}
            onText={(next) => setQuery(next ?? "")}
            className="mb-3 dock:hidden"
          />

          <Card className="overflow-hidden">
            {queryState(terms, {
              loading: "Reading the vocabulary…",
              render: () =>
                all.length === 0 ? (
                  <EmptyState
                    action={
                      <Button
                        variant="primary"
                        onClick={() => setCreating(true)}
                      >
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
                    className="max-h-[calc(100vh-17rem)]"
                  />
                ),
            })}
          </Card>
        </div>

        <DockedFilters
          model={filters}
          id={`vocabulary-${vocabulary.kind}`}
          subject={capitalise(vocabulary.one)}
          kpis={[
            { label: capitalise(vocabulary.title), value: count(all.length) },
            {
              label: "Cancelled",
              value: count(retired),
              note: "Terms no longer offered when an article is described.",
            },
          ]}
          className="hidden dock:flex"
        />
      </div>

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
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      id={term?.term.code}
      title={term === null ? `New ${vocabulary.one}` : term.term.label}
    >
      <TermForm
        // Keyed so switching rows with the sheet open re-seeds the form rather
        // than leaving the previous term's label in the field.
        key={term?.term.code ?? "new"}
        vocabulary={vocabulary}
        term={term}
        existing={existing}
        onSaved={onClose}
      />
      {term !== null && (
        <TermLifecycle vocabulary={vocabulary} term={term} onGone={onClose} />
      )}
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
      const order = draft.order.trim() === "" ? undefined : Number(draft.order)
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

/// Retire, restore or delete one term, and the counts behind each.
///
/// The rule and the buttons are `MasterLifecycle`, shared with the colour
/// master; this is the part that differs — which endpoints the three verbs go
/// to, and what has to be re-read afterwards.
function TermLifecycle({
  vocabulary,
  term,
  onGone,
}: {
  vocabulary: Vocabulary
  term: TermRow
  onGone: () => void
}) {
  const client = useQueryClient()
  const idempotency = useIdempotencyKey()

  const usage = useQuery({
    queryKey: vocabularyKeys.usage(vocabulary.kind, term.term.code),
    queryFn: ({ signal }) => termUsage(vocabulary.kind, term.term.code, signal),
  })

  const invalidate = () => {
    // The whole prefix, plus the catalogue vocabulary: divisions and tags are
    // also read through `/catalogue/vocabulary` by every filter column and the
    // setup composer, and a term retired here that is still offered there is
    // the drift these tables exist to end.
    void client.invalidateQueries({ queryKey: vocabularyKeys.all })
    void client.invalidateQueries({ queryKey: ["procurement", "vocabulary"] })
    void client.invalidateQueries({ queryKey: ["articles"] })
    idempotency.rotate()
  }

  return (
    <MasterLifecycle
      subject={vocabulary.one}
      active={term.active}
      usage={usage}
      onSetActive={async (active) => {
        await updateTerm(
          vocabulary.kind,
          term.term.code,
          { active },
          term.term.version,
          idempotency.key
        )
        invalidate()
      }}
      onDelete={async () => {
        await deleteTerm(vocabulary.kind, term.term.code, term.term.version)
        invalidate()
      }}
      onDeleted={onGone}
    />
  )
}
