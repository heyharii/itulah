import { useQuery } from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import {
  CircleAlert,
  CircleCheck,
  CircleX,
  FileText,
  Folder,
  Image as ImageIcon,
  LayoutGrid,
  MessageSquare,
  Loader,
  MessagesSquare,
  Plus,
  Rows3,
  Sheet,
  Upload,
} from "lucide-react"
import { useMemo, useRef, useState } from "react"

import type { GaOriginalRow } from "@/lib/queries/ga-records"
import { PageContent } from "@/components/shell/app-shell"
import { DockTools } from "@/components/shell/dock-tools"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable, dockSortOf } from "@/components/ui/data-table"
import { Fab } from "@/components/ui/fab"
import { FilterPanel } from "@/components/ui/filter-panel"
import { BarSpacer } from "@/components/ui/list-chrome"
import { PageHeader } from "@/components/ui/page-header"
import {
  CardFigure,
  CardName,
  type CardSpec,
  PhoneCards,
} from "@/components/ui/phone-cards"
import { Status } from "@/components/ui/pill"
import { Banner, EmptyState } from "@/components/ui/states"
import { SubTabs } from "@/components/ui/sub-tabs"
import { useFilters } from "@/lib/filters"
import { count, day, EMPTY } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import { papersQuery } from "@/lib/queries/ga-records"
import { useEveryEmployee, useNameOfLogin } from "@/lib/queries/hr-employees"
import { queryState } from "@/lib/query-state"
import {
  listFiles,
  searchDocuments,
  workplaceKeys,
} from "@/lib/queries/workplace"
import { useSheet } from "@/lib/sheets"
import { tableSetup, type TableSetup } from "@/lib/table"
import { cn } from "@/lib/utils"
import { bytes } from "@/screens/workplace/lib"
import {
  OriginalSheet,
  originalWords,
  PaperSheet,
  RecordPaperSheet,
} from "@/screens/workplace/original-sheets"
import {
  attention,
  fromAttachment,
  fromDocument,
  fromPaper,
  kindOf,
  kindWord,
  placeOf,
  stateOf,
  type VaultRow,
} from "@/screens/workplace/vault"
import { PlaceSheet, VaultSheet } from "@/screens/workplace/vault-sheets"
import { FileThumb, StateWord, VaultTile } from "@/screens/workplace/vault-tile"

/// Library — the vault, in the shape midday's is, over both of the drawers we
/// had.
///
/// Called Files until 2026-09-13, and renamed on the owner's word. The screen
/// did not change with the name: "files" is what the rows ARE, and the module
/// is the room they are kept in.
///
/// There were two screens until 2026-09-04. Documents read the `document` table
/// — whose migration opens by saying it is "modelled on midday's Vault" — and
/// drew it as a plain table. Files read the attachments and had midday's grid,
/// tiles, previews and view switch. So the model was on one screen and the look
/// was on the other, and a person hunting for a PDF had to guess which of two
/// identically-named icons somebody else had put it behind: "hapus documents
/// jika sudah ada files, kenapa double double".
///
/// This is the one screen. The distinction the two screens were expressing is
/// not thrown away — it is the chips now (All, Filed, In chats), because "filed
/// on purpose" and "attached in a conversation" really are different answers
/// to "why is this file here". See `vault.ts` for the row
/// model and why the two sources stay legible inside one list.
///
/// # Three places it deliberately differs from midday
///
///   * **Copy link copies an app link.** midday mints a short public URL.
///     `0040_collaboration.sql` refused `stored_file` a `url` column so a link
///     could not be forwarded out of the room it was posted in; a public URL
///     would undo that with one paste.
///   * **Dropping a file asks where it goes.** midday drops a file into a
///     folder. Here the two destinations are a room or the drawer, and they are
///     genuinely different things — see `PlaceSheet`.
///   * **There is no delete.** The server has no route for it.

/// # The look, since 17 Oct 2026
///
/// Purchase Orders' page (owner: "ya list saya lebih suka, tapi ada grid
/// modenya"; library-tidy-options.html A, with C as the grid): Add file in the
/// head, `Where` as tabs — All, Filed, In chats — five columns, and the grid
/// as the second view behind a List | Grid switch. The kind and the size ride
/// in the grey line under the name; Type, Tags and Size are still filters, no
/// longer columns that were "—" on most rows. A missing file says so in its
/// State cell, so the box of them over the list is gone.

/// The grid's columns: as many 232px tiles as the width holds.
const GRID = "grid grid-cols-[repeat(auto-fill,minmax(14.5rem,1fr))] gap-4"

/// Where a row sits, as the chips split the drawer.
type Where = "all" | "filed" | "chats" | "copies"

/// Type, Tags and Size stay columns so the Filter panel offers them, and are
/// never drawn: on a drawer of contracts they were three columns of "—".
const HIDDEN: Record<string, boolean> = {
  kind: false,
  tags: false,
  byteSize: false,
}

/// The hard copy that tells the story of a file's paper: one that is late,
/// else one that is out, else the first at home. Null when it has none.
function custodyOf(row: VaultRow): GaOriginalRow | null {
  const originals = row.paper?.originals ?? []
  return (
    originals.find((one) => one.overdue) ??
    originals.find((one) => one.status === "OUT") ??
    originals[0] ??
    null
  )
}

/// The hard copy as the column's filter names it.
function copyKind(row: VaultRow): string {
  const one = custodyOf(row)
  if (one === null) return "None"
  if (one.overdue) return "Overdue"
  return one.status === "OUT" ? "Lent out" : "In storage"
}

/// The grey line under a file's name: what it is and how big, or — for a paper
/// filed before it was scanned — what the paper is.
function sublineOf(row: VaultRow): string {
  if (row.paper != null && !row.paper.has_scan) {
    return (
      [row.paper.doc_type, row.paper.doc_number]
        .filter((one) => one !== null && one !== "")
        .join(" · ") || "Paper"
    )
  }
  return `${kindWord(row)} · ${bytes(row.byteSize)}`
}

const columns: ColumnDef<TableSetup, VaultRow>[] = [
  {
    id: "name",
    accessorFn: (row) => `${row.title} ${row.name}`,
    header: "File",
    size: 320,
    meta: { grow: 220, filter: { kind: "text", label: "Name" } },
    cell: ({ row }) => (
      <span className="flex min-w-0 items-center gap-3">
        <FileThumb row={row.original} />
        <span className="min-w-0">
          <span className="block truncate font-medium text-ink">
            {row.original.title}
          </span>
          <span className="block truncate text-mute">
            {sublineOf(row.original)}
          </span>
        </span>
      </span>
    ),
  },
  {
    id: "copy",
    accessorFn: copyKind,
    header: "Hard copy",
    size: 280,
    meta: { filter: { kind: "option" } },
    cell: ({ row }) => {
      const one = custodyOf(row.original)
      if (one === null) return <span className="text-mute">{EMPTY}</span>
      const words = originalWords(one)
      return (
        <Status tone={words.tone} className="max-w-full min-w-0">
          <span className="truncate" title={words.word}>
            {words.word}
          </span>
        </Status>
      )
    },
  },
  {
    id: "place",
    accessorFn: placeOf,
    header: "Where",
    size: 200,
    meta: { filter: { kind: "option", searchable: true } },
    cell: ({ row }) => {
      const Icon =
        row.original.room === null
          ? Folder
          : row.original.room.kind === "DISCUSSION"
            ? MessagesSquare
            : MessageSquare
      return (
        <span className="flex min-w-0 items-center gap-2">
          <Icon className="size-4 shrink-0 text-line-ico" />
          <span className="min-w-0 truncate">{placeOf(row.original)}</span>
        </span>
      )
    },
  },
  {
    id: "by",
    accessorFn: (row) => row.by,
    header: "Added by",
    size: 160,
    meta: { filter: { kind: "option", searchable: true } },
  },
  {
    id: "at",
    accessorFn: (row) => row.at,
    header: "Added",
    size: 140,
    meta: { filter: { kind: "date" } },
    cell: ({ row }) => (row.original.at === "" ? EMPTY : day(row.original.at)),
  },
  {
    id: "state",
    accessorFn: stateOf,
    header: "State",
    size: 130,
    meta: {
      filter: {
        kind: "option",
        icon: (value) =>
          value === "Missing"
            ? CircleAlert
            : value === "Not read"
              ? CircleX
              : value === "Reading"
                ? Loader
                : value === "Ready"
                  ? CircleCheck
                  : undefined,
      },
    },
    // The decision metric: a file whose bytes have gone, or whose text was
    // never read, is the only row anybody has to do something about.
    cell: ({ row }) => <StateWord row={row.original} />,
  },
  {
    id: "kind",
    accessorFn: kindOf,
    header: "Type",
    size: 120,
    meta: {
      filter: {
        kind: "option",
        icon: (value) =>
          value === "Image"
            ? ImageIcon
            : value === "Spreadsheet"
              ? Sheet
              : value === "PDF" || value === "Document" || value === "Text"
                ? FileText
                : undefined,
      },
    },
  },
  {
    id: "tags",
    accessorFn: (row) => row.tags,
    header: "Tags",
    size: 170,
    meta: { filter: { kind: "multi" } },
  },
  {
    id: "byteSize",
    accessorFn: (row) => row.byteSize,
    header: "Size",
    size: 110,
    meta: { align: "right", filter: { kind: "number", unit: "bytes" } },
  },
]

export function Library() {
  // Both keys stay in the URL. `?document=` was the Documents screen's and is
  // in people's history and in links they have sent each other; a merge that
  // broke them would be a worse answer than the screen they wanted.
  const filed = useSheet("document")
  const attached = useSheet("file")
  const view = useSheet("view")
  const paper = useSheet("paper")
  const original = useSheet("original")
  const [recording, setRecording] = useState(false)
  // The list first; the grid is the second view (owner, 17 Oct 2026).
  const grid = view.value === "grid"

  const [where, setWhere] = useState<Where>("all")
  const [query, setQuery] = useState("")
  const [sorting, setSorting] = useState<SortingState>([])
  const [picked, setPicked] = useState<readonly File[]>([])

  const documents = useQuery({
    queryKey: workplaceKeys.documents({}),
    queryFn: ({ signal }) => searchDocuments({ limit: 200 }, signal),
  })
  const attachments = useQuery({
    queryKey: workplaceKeys.files(),
    queryFn: ({ signal }) => listFiles(200, signal),
  })
  // The papers GA keeps. They are files with a hard copy, so they join the list
  // rather than having a screen of their own; a store that may not read them
  // simply sees none.
  const papers = useQuery(papersQuery({}))
  const people = useEveryEmployee()
  const nameOf = useNameOfLogin()

  const rows = useMemo<VaultRow[]>(() => {
    const paperOf = new Map(
      (papers.data ?? []).map((one) => [one.document_id, one])
    )
    const filedRows = (documents.data ?? []).map((one) => {
      const row = fromDocument(one)
      const match = paperOf.get(one.document_id)
      return match === undefined ? row : { ...row, paper: match }
    })
    const listed = new Set(filedRows.map((row) => row.id))
    const unscanned = (papers.data ?? [])
      .filter((one) => !listed.has(one.document_id))
      .map(fromPaper)
    const all = [
      ...filedRows,
      ...unscanned,
      ...(attachments.data ?? []).map(fromAttachment),
    ].map((row) => ({ ...row, by: nameOf(row.by) }))
    // Sorted here rather than left to the table, because the grid has no
    // headers to sort by and both views must agree on what comes first: the
    // files that need somebody, then the newest.
    return all.sort(
      (a, b) => attention(a) - attention(b) || b.at.localeCompare(a.at)
    )
    // `nameOf` is a fresh closure over `people.data` on every render; the
    // employees it reads are the dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documents.data, attachments.data, papers.data, people.data])

  const filedCount = rows.filter((row) => row.source === "FILED").length
  const copiesCount = rows.filter((row) => row.paper != null).length
  const inTab = useMemo(
    () =>
      where === "all"
        ? rows
        : where === "copies"
          ? rows.filter((row) => row.paper != null)
          : rows.filter(
              (row) => (row.source === "FILED") === (where === "filed")
            ),
    [rows, where]
  )

  const filters = useFilters(columns)
  const phone = useLayout() === "phone"

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: inTab,
        columns: filters.columns,
        getRowId: (row: VaultRow) => row.key,
        state: {
          columnFilters: filters.columnFilters,
          columnVisibility: HIDDEN,
          globalFilter: query,
          sorting,
        },
        onSortingChange: setSorting,
        onGlobalFilterChange: setQuery,
      }),
      [inTab, filters.columns, filters.columnFilters, query, sorting]
    )
  )

  /// The grid draws the table's own filtered rows rather than filtering again,
  /// so a chip in the bar and a word in the search box mean the same thing in
  /// both views. Not wrapped in `useMemo`: the row model is already memoised
  /// inside the table against its own state.
  const shown = table
    .getFilteredRowModel()
    .rows.map((row: { original: VaultRow }) => row.original)

  const open =
    rows.find((row) => row.source === "FILED" && row.id === filed.value) ??
    rows.find((row) => row.source !== "FILED" && row.id === attached.value) ??
    null

  // A paper filed before it was scanned has no bytes to show, so it opens as
  // the paper; every other file opens as a file, hard copy and all.
  const openRow = (row: VaultRow) =>
    row.paper != null && !row.paper.has_scan
      ? paper.open(row.id)
      : row.source === "FILED"
        ? filed.open(row.id)
        : attached.open(row.id)
  const selectedRow = (row: VaultRow) =>
    row.id === filed.value ||
    row.id === attached.value ||
    row.id === paper.value

  const closeSheet = () => {
    if (filed.value !== undefined) filed.close()
    if (attached.value !== undefined) attached.close()
  }

  /// Two requests, one screen state.
  ///
  /// Pending while either is, because a list that fills in halfway looks like
  /// the drawer is missing files. Failed only when BOTH have failed: one drawer
  /// answering is worth drawing, and the banner above says which one did not.
  const drawer = {
    isPending: documents.isPending || attachments.isPending,
    isError: documents.isError && attachments.isError,
    error: documents.error ?? attachments.error,
    data: rows,
    refetch: () => {
      void documents.refetch()
      void attachments.refetch()
    },
  }

  const problem =
    documents.error instanceof Error
      ? documents.error
      : attachments.error instanceof Error
        ? attachments.error
        : null

  const tabs: readonly { value: Where; label: string; count: number }[] = [
    { value: "all", label: "All", count: rows.length },
    { value: "filed", label: "Filed", count: filedCount },
    { value: "chats", label: "In chats", count: rows.length - filedCount },
    { value: "copies", label: "Hard copies", count: copiesCount },
  ]

  const clear = () => {
    setQuery("")
    filters.clear()
  }

  return (
    <UploadZone onFiles={setPicked}>
      <PageContent>
        <PageHeader
          title="Files"
          actions={
            <>
              <Button variant="ghost" onClick={() => setRecording(true)}>
                <Plus />
                New hard copy
              </Button>
              {!phone && <PickButton onFiles={setPicked} />}
            </>
          }
        />

        {/* One line over the list: what narrows it at the left — the search,
            where a file is kept, the filter panel — and how it is drawn at the
            right, the same line Purchase orders draws. On a phone they are the
            dock's. */}
        <div className="group/bar mb-3 flex flex-wrap items-center gap-2 max-md:hidden">
          <SubTabs
            className="max-md:hidden"
            tabs={tabs.map((tab) => ({
              value: tab.value,
              label: (
                <span>
                  {tab.label}
                  <span className="ml-1.5 text-body tabular-nums">
                    {count(tab.count)}
                  </span>
                </span>
              ),
            }))}
            value={where}
            onChange={(next) => setWhere(next as Where)}
          />
          <FilterPanel
            model={filters}
            table={table}
            search={{ value: query, onChange: setQuery, label: "Search files" }}
          />
          <BarSpacer />
          <ViewSwitch grid={grid} onChange={view.open} />
        </div>

        {/* On a phone the search, the filters, the order and the tab are the
            dock's, and adding a file is its round button. The files are
            cards. */}
        <PickFab onFiles={setPicked} />
        <DockTools
          search={{
            value: query,
            onChange: setQuery,
            label: "Search files",
          }}
          filter={{
            count: filters.filters.length,
            panel: { model: filters, table },
          }}
          sort={dockSortOf(table)}
          status={{
            value: where,
            options: tabs.map((tab) => ({
              value: tab.value,
              label: tab.label,
              count: tab.count,
            })),
            onChange: (next) => setWhere(next as Where),
          }}
        />

        {problem !== null && (
          <Banner tone="bad" className="mb-4">
            {problem.message}
          </Banner>
        )}

        <div className="grid min-w-0 items-start gap-5">
          <div className="flex min-w-0 flex-col">
            {queryState(drawer, {
              loading: "Opening the drawer…",
              render: () =>
                inTab.length === 0 ? (
                  <Card>
                    <EmptyState>Nothing here yet.</EmptyState>
                  </Card>
                ) : shown.length === 0 ? (
                  <Card>
                    <EmptyState>
                      No file matches these filters.{" "}
                      <button
                        type="button"
                        onClick={clear}
                        className="text-accent underline-offset-2 hover:underline"
                      >
                        Clear them
                      </button>
                    </EmptyState>
                  </Card>
                ) : phone ? (
                  <PhoneCards
                    rows={shown}
                    rowId={(row) => row.key}
                    spec={FILE_CARD}
                    onOpen={openRow}
                    selected={selectedRow}
                  />
                ) : grid ? (
                  <div className={GRID}>
                    {shown.map((row) => (
                      <VaultTile
                        key={row.key}
                        row={row}
                        onOpen={() => openRow(row)}
                      />
                    ))}
                  </div>
                ) : (
                  <Card className="overflow-clip">
                    <DataTable<VaultRow>
                      refresh={[documents, attachments, papers]}
                      table={table}
                      onRowClick={openRow}
                      isSelected={selectedRow}
                      empty="No file matches these filters."
                      summary={{
                        name: (
                          <span>
                            {shown.length}{" "}
                            <span className="font-normal text-body">
                              {shown.length === 1 ? "file" : "files"} ·{" "}
                              {bytes(
                                shown.reduce(
                                  (total, row) => total + row.byteSize,
                                  0
                                )
                              )}
                            </span>
                          </span>
                        ),
                      }}
                      pageScroll
                    />
                  </Card>
                ),
            })}
          </div>
        </div>

        <VaultSheet row={open} onClose={closeSheet} />
        <PlaceSheet files={picked} onClose={() => setPicked([])} />
        <RecordPaperSheet
          open={recording}
          onClose={() => setRecording(false)}
          onSaved={(saved) => paper.open(saved.document_id)}
        />
        <PaperSheet
          documentId={paper.value}
          open={paper.isOpen}
          onClose={paper.close}
        />
        <OriginalSheet
          originalId={original.value}
          open={original.isOpen}
          onClose={original.close}
        />
      </PageContent>
    </UploadZone>
  )
}

/// A file as a phone's card: its name, where it is kept and when it came, its
/// size, and — only when it is not ready — the state it is in.
const FILE_CARD: CardSpec<VaultRow> = {
  title: (row) => <CardName name={row.title} />,
  meta: [
    (row) => (row.at === "" ? placeOf(row) : `${placeOf(row)} · ${day(row.at)}`),
    (row) => {
      const one = custodyOf(row)
      return one === null ? null : originalWords(one).word
    },
  ],
  lead: (row) =>
    row.paper != null && !row.paper.has_scan ? (
      <CardFigure value={EMPTY} caption="Paper" />
    ) : (
      <CardFigure value={bytes(row.byteSize)} caption={kindWord(row)} />
    ),
  // Only a file that needs somebody earns the card a foot: "Reading" on every
  // card was a row of grey under each one.
  action: (row) =>
    stateOf(row) === "Missing" || stateOf(row) === "Not read" ? (
      <StateWord row={row} />
    ) : undefined,
}

/// Adding a file, on a phone: the round button over the bottom bar, which opens
/// the same picker the desk's button does.
function PickFab({ onFiles }: { onFiles: (files: readonly File[]) => void }) {
  const input = useRef<HTMLInputElement>(null)
  return (
    <>
      <input
        ref={input}
        type="file"
        multiple
        className="hidden"
        onChange={(event) => {
          onFiles(Array.from(event.target.files ?? []))
          // Cleared so picking the same file twice in a row still fires.
          event.target.value = ""
        }}
      />
      <Fab label="Add file" onClick={() => input.current?.click()} />
    </>
  )
}

/// List or grid: one 36px control, two halves, the list first.
///
/// Written here rather than reaching for `<ButtonGroup>`: that component paints
/// every child `text-text` through a `[&>button]` selector, which outranks a
/// class on the button itself, so a "which one is on" state cannot be expressed
/// through it without `!important`. Two buttons are cheaper than that argument.
function ViewSwitch({
  grid,
  onChange,
}: {
  grid: boolean
  onChange: (view: string) => void
}) {
  // The value is passed, never derived from the label: `oneOf` in the sheet
  // registry drops anything but these two words, so renaming a label to "Tiles"
  // would quietly stop the switch working rather than fail loudly.
  const button = (
    value: string,
    active: boolean,
    label: string,
    icon: React.ReactNode
  ) => (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      onClick={() => onChange(value)}
      className={cn(
        "grid h-full w-10 place-items-center transition-colors",
        active
          ? "bg-soft-2 text-ink"
          : "text-mute hover:bg-soft hover:text-text"
      )}
    >
      {icon}
    </button>
  )

  return (
    <div className="inline-flex h-9 overflow-hidden rounded-inner border border-hairline-2 bg-canvas shadow-soft">
      {button("list", !grid, "List", <Rows3 className="size-4" />)}
      <span className="w-px bg-hairline-2" />
      {button("grid", grid, "Grid", <LayoutGrid className="size-4" />)}
    </div>
  )
}

// ---- The drop zone -----------------------------------------------------

/// A drop target over the whole page, the way midday's vault has one.
///
/// The counter is not fussiness: `dragenter` and `dragleave` fire for every
/// child element the pointer crosses, so a boolean flickers the overlay off the
/// moment somebody drags over a card. Counting the pairs is the only thing that
/// does not.
function UploadZone({
  onFiles,
  children,
}: {
  onFiles: (files: readonly File[]) => void
  children: React.ReactNode
}) {
  const [over, setOver] = useState(false)
  const depth = useRef(0)

  return (
    <div
      className="relative min-h-full"
      onDragEnter={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return
        depth.current += 1
        setOver(true)
      }}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return
        // Without this the browser navigates to the file instead, which loses
        // the page and everything on it.
        event.preventDefault()
      }}
      onDragLeave={() => {
        depth.current = Math.max(0, depth.current - 1)
        if (depth.current === 0) setOver(false)
      }}
      onDrop={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return
        event.preventDefault()
        depth.current = 0
        setOver(false)
        onFiles(Array.from(event.dataTransfer.files))
      }}
    >
      {children}
      {over && (
        <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-canvas/80 backdrop-blur-[1px]">
          <div className="rounded-outer flex flex-col items-center gap-2 border border-dashed border-accent bg-canvas px-10 py-8">
            <Upload className="size-5 text-accent" />
            <p className="text-card-title font-medium text-ink">
              Drop it to upload
            </p>
            <p className="text-meta text-body">
              You will be asked whether it goes in a room or in the drawer.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

/// The same gesture for people who would rather click than drag.
function PickButton({
  onFiles,
}: {
  onFiles: (files: readonly File[]) => void
}) {
  const input = useRef<HTMLInputElement>(null)
  return (
    <>
      <input
        ref={input}
        type="file"
        multiple
        className="hidden"
        onChange={(event) => {
          onFiles(Array.from(event.target.files ?? []))
          // Cleared so picking the same file twice in a row still fires.
          event.target.value = ""
        }}
      />
      <Button variant="primary" onClick={() => input.current?.click()}>
        <Plus />
        Add file
      </Button>
    </>
  )
}
