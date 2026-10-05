import { useForm } from "@tanstack/react-form"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { Pencil } from "lucide-react"
import { useCallback, useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Dialog } from "@/components/ui/dialog"
import { Field, Input } from "@/components/ui/field"
import { BarSpacer, ExpandingSearch } from "@/components/ui/list-chrome"
import { PageHeader } from "@/components/ui/page-header"
import { Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState } from "@/components/ui/states"
import { useFilters } from "@/lib/filters"
import { queryState } from "@/lib/query-state"
import {
  createNameSuggestion,
  deleteNameSuggestion,
  listNameSuggestions,
  nameSuggestionKeys,
  updateNameSuggestion,
  type NameSuggestion,
} from "@/lib/queries/name-suggestions"
import { said } from "@/screens/master/term-form-kit"
import { SubmitRow } from "@/screens/master/term-form"
import { tableSetup, type TableSetup } from "@/lib/table"
import { toast } from "@/lib/toast"

/// **Name Suggestions** — the names the Name box of New Articles offers as it
/// is typed ("Kemeja", "Kaos", "Celana"). A master of its own, kept here
/// (owner, 2026-10-05), and not the articles that already exist. The box stays
/// free text; a suggestion is only a shortcut.
///
/// Laid out like the other masters (Divisions, Tags): a list, a search, New,
/// and a click on a row opens it for editing. There is no Active switch —
/// nothing points at a name, so a name is either on the list or gone — and
/// Delete sits in the sheet, with a confirmation.
const columns: ColumnDef<TableSetup, NameSuggestion>[] = [
  {
    id: "name",
    accessorFn: (row) => row.name,
    header: "Name",
    cell: ({ row }) => (
      <span className="font-medium text-ink">{row.original.name}</span>
    ),
  },
  {
    id: "action",
    header: "Action",
    size: 80,
    enableSorting: false,
    meta: { align: "right" },
    cell: ({ row }) => (
      <button
        type="button"
        aria-label={`Edit ${row.original.name}`}
        title="Edit"
        className="inline-flex size-8 cursor-pointer items-center justify-center rounded-inner text-mute transition-colors hover:bg-soft-2 hover:text-ink"
      >
        <Pencil className="size-4" />
      </button>
    ),
  },
]

export function NameSuggestions() {
  const [query, setQuery] = useState("")
  const [sorting, setSorting] = useState<SortingState>([])
  const [editing, setEditing] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const book = useQuery({
    queryKey: nameSuggestionKeys.master(),
    queryFn: ({ signal }) => listNameSuggestions(signal),
  })
  const all = useMemo(() => book.data ?? [], [book.data])

  const filters = useFilters(columns)
  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: all,
        columns: filters.columns,
        getRowId: (row: NameSuggestion) => row.suggestion_id,
        state: {
          columnFilters: filters.columnFilters,
          globalFilter: query,
          sorting,
        },
        onSortingChange: setSorting,
        onGlobalFilterChange: setQuery,
      }),
      [all, filters.columns, filters.columnFilters, query, sorting]
    )
  )

  const selected = all.find((row) => row.suggestion_id === editing) ?? null
  const close = useCallback(() => {
    setCreating(false)
    setEditing(null)
  }, [])

  return (
    <PageContent>
      <PageHeader title="Name Suggestions" small />

      <div className="group/bar mb-3 flex min-h-[2.25rem] flex-wrap items-center gap-2">
        <ExpandingSearch
          value={query}
          onChange={setQuery}
          label="Search Name Suggestions"
        />
        <BarSpacer />
        <Button
          variant="primary"
          onClick={() => {
            setEditing(null)
            setCreating(true)
          }}
        >
          New Name
        </Button>
      </div>

      <Card className="overflow-clip">
        {queryState(book, {
          loading: "Reading the names…",
          render: () =>
            all.length === 0 ? (
              <EmptyState
                action={
                  <Button variant="primary" onClick={() => setCreating(true)}>
                    New Name
                  </Button>
                }
              >
                No names yet. Add the ones New Articles should suggest.
              </EmptyState>
            ) : (
              <DataTable<NameSuggestion>
                table={table}
                onRowClick={(row) => {
                  setCreating(false)
                  setEditing(row.suggestion_id)
                }}
                isSelected={(row) => row.suggestion_id === editing}
                empty="Nothing matches that search."
                pageScroll
              />
            ),
        })}
      </Card>

      <Sheet
        open={creating || selected !== null}
        onOpenChange={(next) => {
          if (!next) close()
        }}
        id={
          creating || selected === null ? undefined : (
            <span className="font-sans">Name</span>
          )
        }
        title={creating || selected === null ? "New Name" : selected.name}
      >
        <NameForm
          key={creating ? "new" : (selected?.suggestion_id ?? "none")}
          row={creating ? null : selected}
          existing={all}
          onDone={close}
        />
      </Sheet>
    </PageContent>
  )
}

function NameForm({
  row,
  existing,
  onDone,
}: {
  row: NameSuggestion | null
  existing: readonly NameSuggestion[]
  onDone: () => void
}) {
  const client = useQueryClient()
  const [deleting, setDeleting] = useState(false)
  const [attempted, setAttempted] = useState(false)
  const changed = () =>
    client.invalidateQueries({ queryKey: nameSuggestionKeys.all })

  const save = useMutation({
    mutationFn: (name: string) =>
      row === null
        ? createNameSuggestion(name)
        : // Saving a name also puts it back on the list: a name retired before
          // this screen lost its Active switch is visible here, so it would
          // otherwise stay hidden from the Name box with no way to bring it back.
          updateNameSuggestion(row.suggestion_id, { name, active: true }),
    onSuccess: () => {
      void changed()
      onDone()
    },
  })
  const remove = useMutation({
    mutationFn: () => deleteNameSuggestion(row!.suggestion_id),
    onSuccess: () => {
      setDeleting(false)
      void changed()
      onDone()
    },
    onError: (error) => toast.error(said(error)),
  })

  const form = useForm({
    defaultValues: { name: row?.name ?? "" },
    onSubmit: ({ value }) => save.mutate(value.name.trim()),
  })

  const problemWith = (name: string): string | undefined => {
    const clean = name.trim()
    if (clean === "") return "A name is required."
    if (
      existing.some(
        (other) =>
          other.suggestion_id !== row?.suggestion_id &&
          other.name.trim().toLowerCase() === clean.toLowerCase()
      )
    ) {
      return "That name is already on the list."
    }
    return undefined
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        event.stopPropagation()
        setAttempted(true)
        void form.handleSubmit()
      }}
    >
      {save.isError && <Banner tone="bad">{said(save.error)}</Banner>}
      <form.Field name="name">
        {(field) => (
          <Field
            label="Name"
            problem={
              attempted || field.state.meta.isTouched
                ? problemWith(field.state.value)
                : undefined
            }
          >
            <Input
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.target.value)}
              autoFocus
            />
          </Field>
        )}
      </form.Field>

      <form.Subscribe selector={(state) => state.values.name}>
        {(name) => (
          <SubmitRow
            pending={save.isPending}
            creating={row === null}
            noun="name"
            disabled={problemWith(name) !== undefined}
            onDelete={row === null ? undefined : () => setDeleting(true)}
          />
        )}
      </form.Subscribe>

      {row !== null && (
        <Dialog
          open={deleting}
          onOpenChange={setDeleting}
          title={`Delete ${row.name}?`}
          confirm="Delete"
          cancel="Keep"
          tone="danger"
          pending={remove.isPending}
          onConfirm={() => remove.mutate()}
        >
          <p>
            It stops being suggested in New Articles. No article is touched.
          </p>
        </Dialog>
      )}
    </form>
  )
}
