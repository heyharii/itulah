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
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import {
  BarSpacer,
  ColumnsMenu,
  ExpandingSearch,
} from "@/components/ui/list-chrome"
import { PageHeader } from "@/components/ui/page-header"
import { SubTabs } from "@/components/ui/sub-tabs"
import { SwitchPill } from "@/components/ui/form"
import { Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState } from "@/components/ui/states"
import { Tag } from "@/components/ui/tag"
import { useFilters } from "@/lib/filters"
import { count } from "@/lib/format"
import { toast } from "@/lib/toast"
import {
  colourKeys,
  colourUsage,
  createColour,
  deleteColour,
  listColours,
  updateColour,
  type ColourTerm,
} from "@/lib/queries/colours"
import { queryState } from "@/lib/query-state"
import { tableSetup, type TableSetup } from "@/lib/table"
import { readColour } from "@/lib/colour-parse"
import { ColourField } from "@/screens/master/colour-field"
import { HEX, mistakenFor } from "@/screens/master/colour-hex"
import { ColourSwatch } from "@/screens/master/colour-picker"
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

/// The company's colour vocabulary — the list itself, not a colour on a shirt.
///
/// Colour used to be free text, typed per article and unique only within that
/// one article. Nothing stopped "Navy", "navy" and "Biru Navy" from being three
/// unrelated things, so every report that grouped by colour split three ways —
/// and nobody could see that it had, because each row read correctly on its own
/// article. That is the failure the `tag` table was created to prevent,
/// arriving by the same route: a free-text label does not fail when it is
/// misspelt, it just quietly stops being the same word.
///
/// So colours are picked now, never typed, and this is where the list they are
/// picked from lives. Curating it is the whole job — the label chosen here is
/// the word the entire catalogue will use.
///
/// Two rules this screen is written to *explain* rather than merely enforce. A
/// colour that has ever been worn cannot be deleted, only retired — it is on a
/// printed label and inside colourways somebody can still scan, and "nothing
/// wears it today" is not the same statement. What may be deleted is the row
/// created a minute ago with the word spelt wrong; see `lifecycle.tsx`. And no
/// two colours may share a label: checked here against the loaded list so a
/// clash is named while somebody is still typing, and checked again by the
/// unique index, which is the actual authority.

interface ColourRow {
  readonly term: ColourTerm
  /// Still offered to whoever is choosing a colourway.
  readonly active: boolean
  readonly order: number
}

/// Lifting the two columns the table sorts and filters by out of the record.
///
/// A projection rather than a cast: `active` and `display_order` are on the
/// read type, so nothing here is being asserted that the server did not send.
function readRow(term: ColourTerm): ColourRow {
  return { term, active: term.active, order: term.display_order }
}

/// Display order first, usage never.
///
/// This screen is where `display_order` is set and it is the sequence the picker
/// draws, so sorting the master list by anything else would show a different
/// order from the one people actually pick from, and the field somebody just
/// edited would have no visible effect at all. Usage is the volatile half
/// besides: a colour would move on its own every time a colourway was mapped
/// somewhere else in the app, and "the fourth one down" would stop meaning
/// anything. Usage is one header click away, which is where a question about it
/// belongs.
///
/// Sorted here rather than through a `SortingState` because the honest order has
/// two keys: the seed leaves every row at 0, so without the label tie-break the
/// list arrives in whatever order Postgres felt like that morning. The table's
/// own sorting starts empty and takes over the moment a header is clicked.
function curated(colours: readonly ColourTerm[]): ColourRow[] {
  return colours.map(readRow).sort(
    (a, b) =>
      a.order - b.order ||
      a.term.label.localeCompare(b.term.label, "id-ID", {
        sensitivity: "base",
      })
  )
}

const columns: ColumnDef<TableSetup, ColourRow>[] = [
  {
    id: "colour",
    accessorFn: (row) => `${row.term.label} ${row.term.code}`,
    header: "Color",
    size: 260,
    meta: { grow: 260 },
    cell: ({ row }) => (
      <span
        className={
          row.original.active
            ? "inline-flex items-center gap-2"
            : "inline-flex items-center gap-2 opacity-60"
        }
      >
        {!row.original.active && (
          <EyeOff
            aria-label="Inactive"
            className="size-3.5 shrink-0 text-mute"
          />
        )}
        <ColourSwatch
          hex={row.original.term.hex_code}
          label={row.original.term.label}
          code={row.original.term.code}
        />
      </span>
    ),
  },
  {
    id: "code",
    accessorFn: (row) => row.term.code,
    header: "Code",
    size: 170,
    // Shown beside the label, not instead of it: the code is what an article
    // row points at and what survives a rename, so somebody reading a colourway
    // in the database has to be able to find it here.
    cell: ({ row }) => <Tag>{row.original.term.code}</Tag>,
  },
  {
    id: "articles",
    accessorFn: (row) => row.term.in_use,
    header: "In Use",
    size: 120,
    // The one question this list is asked that a sort answers badly: "is 0"
    // is the set of colours that can be deleted rather than retired, and a
    // curator tidying up wants that set, not the top of an order.
    meta: {
      align: "right",
      filter: { kind: "number", label: "In Use", unit: "articles" },
    },
    // Zero is drawn as 0, not as "Unused". It was worded, on the argument that
    // "unused" is the state somebody scans for — but it read as a licence to
    // delete, which it is not: what a colour may be deleted on is whether
    // anything has EVER worn it, and that answer is in the sheet.
    // The number, and the word beside it in the quiet colour: "4 SKUs".
    cell: ({ row }) => {
      const n = row.original.term.in_use
      return (
        <span className="text-[0.875rem] tabular-nums">
          <span className={n === 0 ? "text-mute" : "text-ink"}>{count(n)}</span>{" "}
          <span className="text-mute">{n === 1 ? "SKU" : "SKUs"}</span>
        </span>
      )
    },
  },
  {
    id: "action",
    header: "Action",
    size: 80,
    enableSorting: false,
    meta: { align: "right" },
    cell: ({ row }) => <RowActions label={row.original.term.label} />,
  },
]

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

type StatusTab = "ALL" | "ACTIVE" | "INACTIVE"

function TabLabel({ text, n }: { text: string; n: number }) {
  return (
    <span>
      {text}
      <span className="ml-1.5 text-body tabular-nums">{count(n)}</span>
    </span>
  )
}

export function Colours() {
  const [query, setQuery] = useState("")
  const [sorting, setSorting] = useState<SortingState>([])
  const [editing, setEditing] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [tab, setTab] = useState<StatusTab>("ACTIVE")
  const [inUseOnly, setInUseOnly] = useState(false)

  // The whole vocabulary in one read. A company has a hundred colours, not a
  // hundred thousand, so there is nothing to page and nothing to re-ask the
  // server for — which is also what lets the duplicate-label check below answer
  // while somebody is still typing.
  const colours = useQuery({
    queryKey: colourKeys.list(),
    queryFn: ({ signal }) => listColours(signal),
  })

  const all = useMemo(
    () => curated(colours.data?.colours ?? []),
    [colours.data]
  )

  // Every colour reaches the table. What narrows it is the panel beside it,
  // and only that — a second sieve in front of the table is how a status
  // segment and a status chip end up giving two different answers.
  const rows = useMemo(
    () =>
      all.filter(
        (row) =>
          (tab === "ALL" || row.active === (tab === "ACTIVE")) &&
          (!inUseOnly || row.term.in_use > 0)
      ),
    [all, tab, inUseOnly]
  )

  const filters = useFilters(columns)

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns: filters.columns,
        getRowId: (row: ColourRow) => row.term.code,
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
    { label: "Colors", value: count(all.length), note: undefined },
    { label: "Active", value: count(all.length - retired), note: undefined },
    { label: "Inactive", value: count(retired), note: undefined },
    {
      label: "In Use",
      value: count(all.filter((row) => row.term.in_use > 0).length),
      note: "Colors that at least one SKU is made in.",
    },
  ]

  const close = useCallback(() => {
    setCreating(false)
    setEditing(null)
  }, [])

  return (
    <PageContent>
      <PageHeader title="Colors" small />

      <KpiStrip className="grid-cols-2 md:grid-cols-4 xl:grid-cols-4">
        {kpis.map((one) => (
          <div key={one.label} title={one.note}>
            <Kpi label={one.label} value={one.value} />
          </div>
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

      <div className="group/bar mb-3 flex min-h-[2.25rem] flex-wrap items-center gap-2">
        <ExpandingSearch
          value={query}
          onChange={setQuery}
          label="Search Colors"
        />
        <SwitchPill
          on={inUseOnly}
          label="In Use"
          onToggle={() => setInUseOnly((was) => !was)}
        />
        <BarSpacer />
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
          New Color
        </Button>
      </div>

      <Card className="overflow-clip">
        {queryState(colours, {
          loading: "Reading the vocabulary…",
          render: () =>
            all.length === 0 ? (
              <EmptyState
                action={
                  <Button variant="primary" onClick={() => setCreating(true)}>
                    New Color
                  </Button>
                }
              >
                No color has been declared yet, so there is nothing for an
                article to pick.
              </EmptyState>
            ) : (
              <DataTable<ColourRow>
                table={table}
                onRowClick={(row) => {
                  setCreating(false)
                  setEditing(row.term.code)
                }}
                isSelected={(row) => row.term.code === editing}
                empty="No color matches that search."
                pageScroll
              />
            ),
        })}
      </Card>

      <ColourSheet
        open={creating || selected !== null}
        colour={creating ? null : selected}
        existing={all}
        onClose={close}
      />
    </PageContent>
  )
}

// ---------------------------------------------------------------------------

/// One colour, as a record to be written or corrected.
function ColourSheet({
  open,
  colour,
  existing,
  onClose,
}: {
  open: boolean
  colour: ColourRow | null
  existing: readonly ColourRow[]
  onClose: () => void
}) {
  // Keyed so moving between rows starts a form on the row in front of you:
  // `useForm` reads its defaults once, and without this the second colour
  // opened would be edited through the first one's values.
  const form = (
    <ColourForm
      key={colour?.term.code ?? "new"}
      colour={colour}
      existing={existing}
      onSaved={onClose}
    />
  )
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      id={
        colour === null ? undefined : <span className="font-sans">Color</span>
      }
      title={colour ? colour.term.label : "New Color"}
    >
      {form}
    </Sheet>
  )
}

interface ColourDraft {
  code: string
  label: string
  hex: string
  order: string
  active: boolean
}

interface Problems {
  code?: string
  label?: string
  hex?: string
  order?: string
}

/// Upper snake, the shape `division` and `tag` already use. Not a database
/// constraint — the column only refuses blanks — but a code is permanent once an
/// article points at it, and a vocabulary with `NAVY_BLUE` beside `Navy blue` is
/// half of the mess this table was built to end.
const CODE = /^[A-Z0-9]+(?:_[A-Z0-9]+)*$/

function problemsWith(
  draft: ColourDraft,
  colour: ColourRow | null,
  existing: readonly ColourRow[]
): Problems {
  const problems: Problems = {}

  const label = draft.label.trim()
  if (label === "") {
    problems.label = "A color needs a name — it is what everybody reads."
  } else {
    // The same comparison as the unique index, `lower(btrim(label))`, done early
    // enough to name the row it would collide with. The server stays the
    // authority; this only means nobody has to submit to find out.
    const clash = existing.find(
      (row) =>
        row.term.code !== colour?.term.code &&
        row.term.label.trim().toLowerCase() === label.toLowerCase()
    )
    if (clash) {
      problems.label = `${clash.term.code} already reads as “${clash.term.label}”. Two colours may not share a label — that split is the whole reason this list exists.`
    }
  }

  // Only when minting one. A code is what `article_colour` points at, so it is
  // permanent from the first article that uses it.
  if (colour === null) {
    const code = draft.code.trim()
    if (code === "") {
      problems.code = "A code is needed; it is what article rows point at."
    } else if (!CODE.test(code)) {
      problems.code =
        "Upper snake, like the rest of the vocabulary — NAVY_BLUE, not “Navy Blue”."
    } else if (existing.some((row) => row.term.code === code)) {
      problems.code = `${code} is already taken.`
    }
  }

  const hex = draft.hex.trim()
  if (hex !== "" && !HEX.test(hex)) {
    problems.hex = "Six hex digits after a hash — #1B2A4A."
  }

  const order = Number(draft.order)
  if (!Number.isInteger(order) || order < 0) {
    problems.order = "A whole number, 0 or more."
  }

  return problems
}

function ColourForm({
  colour,
  existing,
  onSaved,
}: {
  colour: ColourRow | null
  existing: readonly ColourRow[]
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
    mutationFn: () => deleteColour(colour!.term.code, colour!.term.version),
    onSuccess: () => {
      setDeleting(false)
      void client.invalidateQueries({ queryKey: colourKeys.all })
      onSaved()
    },
    onError: (error) => toast.error(said(error)),
  })

  const save = useMutation({
    mutationFn: (draft: ColourDraft) => {
      const label = draft.label.trim()
      // Blank clears it rather than storing "". A colour with no agreed pixel
      // value is a normal state, and an empty swatch says so; a wrong one lies.
      const hex = draft.hex.trim() === "" ? null : draft.hex.trim()
      // No Order input (owner, 2026-10-05): a new color goes after the others.
      const order =
        colour === null
          ? Math.max(0, ...existing.map((row) => row.order)) + 1
          : Number(draft.order)
      return colour === null
        ? createColour(
            {
              code: draft.code.trim(),
              label,
              hex_code: hex,
              display_order: order,
            },
            idempotency.key
          )
        : updateColour(
            colour.term.code,
            {
              label,
              hex_code: hex,
              display_order: order,
              active: draft.active,
            },
            colour.term.version,
            idempotency.key
          )
    },
    onSuccess: () => {
      // The whole prefix: the list on this screen and the picker on every
      // article form are the same read, and a colour renamed in one that still
      // reads the old way in the other is the drift this table exists to end.
      void client.invalidateQueries({ queryKey: colourKeys.all })
      idempotency.rotate()
      onSaved()
    },
  })

  const form = useForm({
    defaultValues: {
      code: colour?.term.code ?? "",
      label: colour?.term.label ?? "",
      hex: colour?.term.hex_code ?? "",
      order: String(colour?.order ?? 0),
      active: colour?.active ?? true,
    } as ColourDraft,
    onSubmit: ({ value }) => {
      attempt()
      const found = problemsWith(value, colour, existing)
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
        selector={(state) => problemsWith(state.values, colour, existing)}
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
                    onBlur={() => {
                      field.handleBlur()
                      // "Biru Tua" typed as the label says what the swatch
                      // should be, so an empty hex is filled from it. A hex
                      // somebody already chose is never overwritten.
                      if (
                        colour === null &&
                        form.getFieldValue("hex").trim() === ""
                      ) {
                        const read = readColour(field.state.value)
                        if (read !== null && /^#[0-9A-F]{6}$/.test(read.hex))
                          form.setFieldValue("hex", read.hex)
                      }
                    }}
                    onChange={(event) => {
                      field.handleChange(event.target.value)
                      if (colour === null && !codeTyped) {
                        form.setFieldValue("code", snake(event.target.value))
                      }
                    }}
                  />
                </Field>
              )}
            </form.Field>

            {colour === null ? (
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
              <CodeFact code={colour.term.code} />
            )}

            <div className="grid grid-cols-2 gap-3">
              <form.Field name="hex">
                {(field) => (
                  <Field
                    label="Hex"
                    problem={reveal(field.state.meta.isTouched, problems.hex)}
                    className="min-w-0"
                  >
                    <ColourField
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(next) => field.handleChange(next)}
                      onNamed={(read) => {
                        // A name typed into the hex box names the colour too,
                        // when nothing else has.
                        if (
                          colour !== null ||
                          form.getFieldValue("label").trim() !== ""
                        )
                          return
                        form.setFieldValue("label", read.name)
                        if (!codeTyped)
                          form.setFieldValue("code", snake(read.name))
                      }}
                    />
                  </Field>
                )}
              </form.Field>
            </div>

            {/* Drawn from the draft, and blank whenever the hex is not a hex.
                A colour can be named before anybody has decided which pixel
                value stands for it — and a swatch showing the wrong navy is
                worse than a swatch showing nothing, because somebody will
                believe it. */}
            <form.Subscribe selector={(state) => state.values}>
              {(values) => {
                const hex = values.hex.trim()
                const agreed = HEX.test(hex)
                // The colour already in the list this one would be taken for.
                // Everything but the row being edited, so correcting a colour
                // never warns about itself.
                const twin = agreed
                  ? mistakenFor(
                      hex,
                      existing
                        .filter((row) => row.term.code !== colour?.term.code)
                        .map((row) => row.term)
                    )
                  : null
                return (
                  <div className="flex flex-col gap-2 rounded-inner bg-soft-2 px-3.5 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <ColourSwatch
                        hex={agreed ? hex : null}
                        label={
                          values.label.trim() === ""
                            ? "Unnamed"
                            : values.label.trim()
                        }
                        code={values.code.trim()}
                      />
                    </div>

                    {/* A caution, never a refusal. A company really can carry
                        two navies for two fabrics — but the reason this table
                        exists is that nobody could SEE the third "Navy" being
                        created, and two dots this close are one dot on a rail
                        of ten. */}
                    {twin && (
                      <div className="flex items-start gap-2.5 border-t border-hairline pt-2">
                        <ColourSwatch
                          hex={twin.hex_code}
                          label={twin.label}
                          code={twin.code}
                        />
                        <span className="text-[0.875rem] leading-relaxed text-warn-fg">
                          Reads the same as this at a glance. Two colours a
                          person cannot tell apart split every report that
                          groups by colour — pick a different one, or be sure
                          the difference is real.
                        </span>
                      </div>
                    )}
                  </div>
                )
              }}
            </form.Subscribe>

            {colour !== null && (
              <form.Field name="active">
                {(field) => (
                  <ActiveRow
                    on={field.state.value}
                    noun="color"
                    label={colour.term.label}
                    usage={{
                      queryKey: colourKeys.usage(colour.term.code),
                      queryFn: ({ signal }) =>
                        colourUsage(colour.term.code, signal),
                    }}
                    onToggle={() => field.handleChange(!field.state.value)}
                  />
                )}
              </form.Field>
            )}

            <SubmitRow
              pending={save.isPending}
              creating={colour === null}
              noun="color"
              onDelete={
                colour !== null && colour.term.in_use === 0
                  ? () => setDeleting(true)
                  : undefined
              }
            />
            {colour !== null && (
              <DeleteDialog
                open={deleting}
                onOpenChange={setDeleting}
                noun="color"
                label={colour.term.label}
                usage={{
                  queryKey: colourKeys.usage(colour.term.code),
                  queryFn: ({ signal }) =>
                    colourUsage(colour.term.code, signal),
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
