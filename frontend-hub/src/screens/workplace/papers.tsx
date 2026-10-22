import { keepPreviousData, useQuery } from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { Plus } from "lucide-react"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { DockTools } from "@/components/shell/dock-tools"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Fab } from "@/components/ui/fab"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { BarSpacer, ExpandingSearch } from "@/components/ui/list-chrome"
import { PageHeader } from "@/components/ui/page-header"
import {
  CardName,
  type CardSpec,
  PhoneCards,
} from "@/components/ui/phone-cards"
import { Status } from "@/components/ui/pill"
import type { Refreshable } from "@/components/ui/refresh-stamp"
import { Toolbar } from "@/components/ui/segmented"
import { EmptyState } from "@/components/ui/states"
import { today } from "@/lib/calendar"
import { count, day, EMPTY } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import {
  originalsQuery,
  papersQuery,
  type GaOriginalRow,
  type GaPaper,
} from "@/lib/queries/ga-records"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"
import { tableSetup, type TableSetup } from "@/lib/table"
import { useDebounced } from "@/lib/use-debounced"
import {
  OriginalSheet,
  originalWords,
  paperIcon,
  PaperSheet,
  RecordPaperSheet,
} from "@/screens/workplace/original-sheets"
import { useFittedVisibility } from "@/screens/procurement/shared"

/// Files › Papers & originals: the papers GA keeps — BPKB, STNK, a policy, a
/// certificate — with or without a scan, and where each one's physical
/// original is.
///
/// # The list format, as Purchase Orders draws it
///
/// Head, figures, one bar, a framed table (owner, 17 Oct 2026). One dataset, so
/// there are no tabs of its own: the door's two tabs (Library · Papers &
/// originals) are the only row.
///
/// # What the figures count
///
/// The whole register, whatever the search leaves: how many papers GA keeps,
/// how many originals are out, and how many of those are past their day. The
/// server decides what is overdue.
///
/// # The open record is in the address
///
/// `?paper=` opens a paper and `?original=` an original over it (`lib/sheets`),
/// so either can be sent as a link and Esc walks back one layer.
export function Papers() {
  const paper = useSheet("paper")
  const original = useSheet("original")
  const [search, setSearch] = useState("")
  const [adding, setAdding] = useState(false)
  const phone = useLayout() === "phone"
  // The search goes to the server, so it waits for the typing to stop.
  const needle = useDebounced(search.trim(), 300)

  return (
    <PageContent>
      <PageHeader
        title="Papers & originals"
        actions={
          // On a phone the one thing this page makes is its round button.
          phone ? undefined : (
            <Button variant="primary" onClick={() => setAdding(true)}>
              <Plus />
              New paper
            </Button>
          )
        }
      />

      <Fab label="New paper" onClick={() => setAdding(true)} />

      <Figures />

      {/* One bar: the search. On a phone it is the dock's. */}
      <div className="max-md:hidden">
        <Toolbar className="group/bar">
          <ExpandingSearch
            value={search}
            onChange={setSearch}
            label="Search papers"
          />
          <BarSpacer />
        </Toolbar>
      </div>
      <DockTools
        search={{ value: search, onChange: setSearch, label: "Search papers" }}
      />

      <PaperRegister
        needle={needle}
        phone={phone}
        selected={paper.value}
        onOpen={paper.open}
        onAdd={() => setAdding(true)}
      />

      <RecordPaperSheet
        open={adding}
        onClose={() => setAdding(false)}
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
  )
}

/// The figures over the register. They do not hold the page up while they are
/// read.
function Figures() {
  const papers = useQuery(papersQuery({}))
  const out = useQuery(originalsQuery({ status: "OUT" }))
  const late = out.data?.filter((one) => one.overdue).length
  const figure = (n: number | undefined) => (n === undefined ? "—" : count(n))
  return (
    <KpiStrip className="grid-cols-2 md:grid-cols-3 xl:grid-cols-3">
      <Kpi label="Papers" value={figure(papers.data?.length)} />
      <Kpi label="Originals out" value={figure(out.data?.length)} />
      <Kpi
        label="Overdue"
        value={
          late !== undefined && late > 0 ? (
            <span className="text-bad-fg">{count(late)}</span>
          ) : (
            figure(late)
          )
        }
      />
    </KpiStrip>
  )
}

/// A row of the table: the paper, with its places and its original in words.
///
/// Worked out once on the row rather than in each cell: a column sorts by what
/// is on the screen.
interface PaperLine {
  readonly paper: GaPaper
  /// The records it is about, by name.
  readonly about: string
  /// The original that tells the story: one that is late, else one that is
  /// out, else the first at home. Absent when none is registered.
  readonly custody: GaOriginalRow | null
  readonly expired: boolean
}

function lineOf(paper: GaPaper, now: string): PaperLine {
  const custody =
    paper.originals.find((one) => one.overdue) ??
    paper.originals.find((one) => one.status === "OUT") ??
    paper.originals[0] ??
    null
  return {
    paper,
    about: paper.subjects.map((one) => one.label ?? one.kind).join(", "),
    custody,
    expired: paper.expires_on !== null && paper.expires_on < now,
  }
}

/// Held at the widths their longest words need, with the paper taking the
/// rest. About and the original give way first when the card is narrow.
const COLUMNS: ColumnDef<TableSetup, PaperLine>[] = [
  {
    id: "paper",
    accessorFn: (row) => row.paper.title,
    header: "Paper",
    size: 260,
    meta: { grow: 200 },
    // The title, and under it the paper's number — unless the title already
    // says it ("BPKB · M-12345678"), when saying it twice is only noise.
    cell: ({ row }) => {
      const { title, doc_number } = row.original.paper
      const quiet =
        doc_number !== null && !title.includes(doc_number) ? doc_number : null
      const Glyph = paperIcon(row.original.paper.doc_type)
      return (
        <span className="flex min-w-0 items-center gap-3">
          <span
            aria-hidden
            className="grid size-[1.875rem] shrink-0 place-items-center rounded-inner bg-soft-2 text-body"
          >
            <Glyph className="size-4 stroke-[1.7]" />
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="truncate font-medium text-ink" title={title}>
              {title}
            </span>
            {quiet !== null && (
              <span className="truncate text-mute" title={quiet}>
                {quiet}
              </span>
            )}
          </span>
        </span>
      )
    },
  },
  {
    id: "about",
    accessorFn: (row) => row.about,
    header: "About",
    size: 220,
    meta: { priority: 2 },
    cell: ({ row }) => (
      <span className="block truncate" title={row.original.about}>
        {row.original.about === "" ? EMPTY : row.original.about}
      </span>
    ),
  },
  {
    id: "valid",
    // A paper with no expiry sorts after every date.
    accessorFn: (row) => row.paper.expires_on ?? "9999-12-31",
    header: "Valid until",
    size: 140,
    meta: { priority: 2 },
    cell: ({ row }) =>
      row.original.paper.expires_on === null ? (
        <span className="text-mute">No expiry</span>
      ) : (
        <span
          className={
            row.original.expired ? "text-bad-fg tabular-nums" : "tabular-nums"
          }
        >
          {day(row.original.paper.expires_on)}
        </span>
      ),
  },
  {
    id: "scan",
    accessorFn: (row) => (row.paper.has_scan ? "Filed" : "No scan"),
    header: "Scan",
    size: 130,
    meta: { priority: 3 },
    cell: ({ row }) =>
      row.original.paper.has_scan ? (
        <Status tone="ok">Filed</Status>
      ) : (
        <Status>No scan</Status>
      ),
  },
  {
    id: "original",
    accessorFn: (row) =>
      row.custody === null ? "" : originalWords(row.custody).word,
    header: "Original",
    size: 300,
    cell: ({ row }) => {
      const one = row.original.custody
      if (one === null) return <span className="text-mute">No original</span>
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
]

function PaperRegister({
  needle,
  phone,
  selected,
  onOpen,
  onAdd,
}: {
  needle: string
  phone: boolean
  selected: string | undefined
  onOpen: (documentId: string) => void
  onAdd: () => void
}) {
  // The list being replaced stays on screen while the next is read, so a
  // keystroke does not empty the table to a loading line.
  const list = useQuery({
    ...papersQuery({ q: needle === "" ? undefined : needle }),
    placeholderData: keepPreviousData,
  })

  return queryState(list, {
    loading: "Loading papers…",
    render: (papers) => (
      <PaperRows
        papers={papers}
        query={list}
        searched={needle !== ""}
        phone={phone}
        selected={selected}
        onOpen={onOpen}
        onAdd={onAdd}
      />
    ),
  })
}

function PaperRows({
  papers,
  query,
  searched,
  phone,
  selected,
  onOpen,
  onAdd,
}: {
  papers: readonly GaPaper[]
  query: Refreshable
  searched: boolean
  phone: boolean
  selected: string | undefined
  onOpen: (documentId: string) => void
  onAdd: () => void
}) {
  const rows = useMemo<PaperLine[]>(() => {
    const now = today()
    return papers.map((one) => lineOf(one, now))
  }, [papers])

  /// What fits the card: the least needed columns give way first.
  const fit = useFittedVisibility(COLUMNS, {})
  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns: COLUMNS,
        getRowId: (row: PaperLine) => row.paper.document_id,
        state: { columnVisibility: fit.shown },
        onColumnVisibilityChange: fit.change,
      }),
      // `fit.shown` is rebuilt every render; what it is made of is not.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [rows, fit.hidden, fit.visibility]
    )
  )

  if (rows.length === 0) {
    return (
      <Card>
        <EmptyState
          action={
            searched ? undefined : (
              <Button variant="ghost" onClick={onAdd}>
                New paper
              </Button>
            )
          }
        >
          {searched ? "No paper matches this search." : "Nothing here yet."}
        </EmptyState>
      </Card>
    )
  }

  if (phone) {
    return (
      <PhoneCards
        rows={rows}
        rowId={(row) => row.paper.document_id}
        spec={PAPER_CARD}
        onOpen={(row) => onOpen(row.paper.document_id)}
        selected={(row) => row.paper.document_id === selected}
      />
    )
  }

  return (
    // `overflow-clip`, not `overflow-hidden`: hidden makes the card a scroll
    // box, and the heading would stick to the card instead of the window.
    <Card ref={fit.ref} className="overflow-clip">
      <DataTable<PaperLine>
        refresh={[query]}
        table={table}
        onRowClick={(row) => onOpen(row.paper.document_id)}
        isSelected={(row) => row.paper.document_id === selected}
        // The window scrolls, not the table.
        pageScroll
        summary={{
          paper: (
            <span>
              {count(rows.length)}{" "}
              <span className="font-normal text-body">
                {rows.length === 1 ? "paper" : "papers"}
              </span>
            </span>
          ),
        }}
      />
    </Card>
  )
}

/// The same row as a phone card: the paper and its number, what it is about;
/// its scan and its day in the foot, and where the original is where the
/// thumb rests.
const PAPER_CARD: CardSpec<PaperLine> = {
  title: (row) => (
    <CardName
      name={row.paper.title}
      code={
        row.paper.doc_number !== null &&
        !row.paper.title.includes(row.paper.doc_number)
          ? row.paper.doc_number
          : null
      }
    />
  ),
  meta: [(row) => (row.about === "" ? null : row.about)],
  foot: (row) => (
    <span>
      {row.paper.has_scan ? "Filed" : "No scan"}
      {" · "}
      {row.paper.expires_on === null ? (
        "No expiry"
      ) : (
        <span className={row.expired ? "text-bad-fg" : undefined}>
          Valid until {day(row.paper.expires_on)}
        </span>
      )}
    </span>
  ),
  action: (row) => {
    if (row.custody === null)
      return <span className="text-mute">No original</span>
    const words = originalWords(row.custody)
    return <Status tone={words.tone}>{words.word}</Status>
  },
}
