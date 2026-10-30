import type { JSONContent } from "@tiptap/react"
import {
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseInfiniteQuery,
} from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import {
  ArrowLeft,
  BookmarkPlus,
  Cpu,
  Megaphone,
  Package,
  Plus,
  Printer,
  Trash2,
  Users,
  type LucideIcon,
} from "lucide-react"
import { Suspense, useDeferredValue, useEffect, useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { DockTools } from "@/components/shell/dock-tools"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Fab } from "@/components/ui/fab"
import { Field, Input, Textarea } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { RecordPanel } from "@/components/ui/record-panel"
import { KeyValue } from "@/components/ui/rows"
import { Toolbar } from "@/components/ui/segmented"
import { Sheet } from "@/components/ui/sheet"
import {
  Banner,
  EmptyState,
  LoadingState,
  LoadMore,
} from "@/components/ui/states"
import { count, day } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import { queryState } from "@/lib/query-state"
import {
  discardLetter,
  fact,
  issueLetter,
  letterKeys,
  letterKindLabel,
  letterListQuery,
  letterTone,
  LETTER_STATUS_LABEL,
  readLetter,
  saveLetter,
  saveTemplate,
  voidLetter,
  type LetterGroupFilter,
  type LetterQuery,
  type LetterStatus,
} from "@/lib/queries/letters"
import { useSheet } from "@/lib/sheets"
import { useDebounced } from "@/lib/use-debounced"
import { cn } from "@/lib/utils"
import { LetterBody } from "@/screens/letters/editor"
import { LetterPaper, PrintStyles } from "@/screens/letters/document"
import {
  LETTER_GROUPS,
  writtenForm,
  type LetterGroup,
} from "@/screens/letters/forms"
import { NewLetterSheet } from "@/screens/letters/new-letter"
import { takeLetterPreset, type LetterPreset } from "@/screens/letters/preset"
import { WrittenLetter } from "@/screens/letters/writer"
import {
  CardFigure,
  CardName,
  type CardSpec,
  PhoneCards,
} from "@/components/ui/phone-cards"
import { ListFilters } from "@/components/ui/list-filters"
import { SubTabs } from "@/components/ui/sub-tabs"
import { useFilterState, type FilterField } from "@/lib/filters"
import type { LetterRow } from "@itulah/contract"

/// Letters — surat terima barang, surat jalan, and the register they live in.
///
/// # What this screen is, in one sentence
///
/// A letter is a record's figures, frozen at the moment somebody put a number
/// and a signature on them.
///
/// Everything on the paper except one paragraph is copied from a purchase
/// receipt or an allotment and cannot be typed here; the paragraph is the part
/// no database knows. That split is the whole design, and it is why "an editor"
/// and "generated from the record" are not the two options the owner had to
/// choose between — see `postgres/letters.rs`.
///
/// # One screen, two states
///
/// The register and one letter, told apart by `?letter=`. Same pattern as
/// Discussions and Reports, and for the same reason: a letter with a number on
/// it is the thing colleagues send each other links to.

const STATUSES: readonly { readonly value: string; readonly label: string }[] =
  [
    { value: "ANY", label: "All" },
    { value: "DRAFT", label: "Draft" },
    { value: "ISSUED", label: "Issued" },
    { value: "VOID", label: "Void" },
  ]

const GROUP_ICONS: Readonly<Record<LetterGroup, LucideIcon>> = {
  goods: Package,
  people: Users,
  notices: Megaphone,
}

/// The register's groups (owner, 2026-10-17): the three a person writes in,
/// then everything the system writes — surat jalan, goods receipt notes,
/// return notes — under one.
const GROUPS: readonly {
  value: "all" | LetterGroupFilter
  label: string
  icon?: LucideIcon
}[] = [
  { value: "all", label: "All" },
  ...LETTER_GROUPS.map((one) => ({ ...one, icon: GROUP_ICONS[one.value] })),
  { value: "system", label: "By system", icon: Cpu },
]

/// The kind of letter, as the chip line under the search.
const GROUP_FIELDS: FilterField[] = [
  {
    column: "group",
    label: "Kind",
    spec: {
      kind: "option",
      single: true,
      options: GROUPS.filter((one) => one.value !== "all"),
      icon: (value) => GROUPS.find((one) => one.value === value)?.icon,
    },
  },
]

/// What a row is called: a written letter by its form, the others by kind.
function letterName(row: { kind: string; form?: string }): string {
  if (row.kind === "GENERAL") return writtenForm(row.form)?.name ?? "Letter"
  return letterKindLabel(row.kind)
}

/// How much a row carries: a written goods letter counts its items, a letter
/// from a record its pieces, anything else nothing.
function letterQuantity(row: LetterRow): string {
  if (row.kind !== "GENERAL") return count(row.quantity)
  const form = writtenForm(row.form)
  if (form?.items !== true) return "—"
  return `${count(row.quantity)} ${row.quantity === 1 ? "item" : "items"}`
}

const STATUS_WORDS: Readonly<Record<string, string>> = {
  DRAFT: "Draft",
  ISSUED: "Issued",
  VOID: "Void",
}

export function Letters() {
  const open = useSheet("letter")
  return open.value ? (
    <OneLetter id={open.value} onBack={open.close} />
  ) : (
    <Register onOpen={open.open} />
  )
}

// ---- The register ------------------------------------------------------

function Register({ onOpen }: { onOpen: (id: string) => void }) {
  const filters = useFilterState(GROUP_FIELDS)
  const group = (filters.filters.find((one) => one.column === "group")
    ?.values[0] ?? "all") as "all" | LetterGroupFilter
  const [status, setStatus] = useState("ANY")
  const [search, setSearch] = useState("")
  const [writing, setWriting] = useState(false)
  const [preset, setPreset] = useState<LetterPreset | null>(null)
  // Another screen asked for a letter (the contract on a person's page).
  useEffect(() => {
    const asked = takeLetterPreset()
    if (asked === null) return
    setPreset(asked)
    setWriting(true)
  }, [])
  const phone = useLayout() === "phone"
  // The search is the server's, so it waits for the typing to stop.
  const needle = useDebounced(search.trim(), 300)

  const query = useMemo<LetterQuery>(
    () => ({
      kind: null,
      group: group === "all" ? null : group,
      status: status === "ANY" ? null : (status as LetterStatus),
      q: needle,
    }),
    [group, status, needle]
  )

  /// Read for the question as it was a moment ago while a new one is on its
  /// way: the rows stay on screen instead of the register emptying to a
  /// loading line on every search.
  const asked = useDeferredValue(query)

  return (
    <PageContent>
      <PageHeader
        crumb="GA"
        title="Letters"
        actions={
          // On a phone the search, the kind and the status are the dock's, and
          // the one thing this page makes is its round button.
          phone ? undefined : (
            <Button variant="primary" onClick={() => setWriting(true)}>
              <Plus />
              New letter
            </Button>
          )
        }
      />

      <Fab label="New letter" onClick={() => setWriting(true)} />
      <DockTools
        search={{ value: search, onChange: setSearch, label: "Search letters" }}
        filter={{
          count: filters.filters.length,
          panel: { model: filters },
        }}
        status={{
          value: status,
          options: STATUSES,
          onChange: setStatus,
        }}
      />

      <SubTabs
        // On a phone the status is the chip over the bottom bar.
        className="max-md:hidden"
        tabs={STATUSES}
        value={status}
        onChange={setStatus}
      />

      {/* The search and the kind of letter, with the tally at the right. On a
          phone they are the dock's. */}
      <div className="max-md:hidden">
        <Toolbar className="group/bar">
          <ListFilters
            model={filters}
            search={{
              value: search,
              onChange: setSearch,
              label: "Search letters",
            }}
          />
          <Toolbar.Spacer />
          {/* A caption on a toolbar: until the register has said, it says
              nothing, rather than "Loading…" where a number goes — furniture
              that moves while somebody reads it. */}
          <Suspense fallback={null}>
            <LetterTally query={asked} />
          </Suspense>
        </Toolbar>
      </div>

      <Suspense
        fallback={<LoadingState>Opening the letters list…</LoadingState>}
      >
        <LetterRows
          query={asked}
          stale={asked !== query}
          phone={phone}
          onOpen={onOpen}
          onWrite={() => setWriting(true)}
        />
      </Suspense>

      <NewLetterSheet
        open={writing}
        preset={preset}
        onClose={() => {
          setWriting(false)
          setPreset(null)
        }}
        onDrafted={(id) => {
          setWriting(false)
          onOpen(id)
        }}
      />
    </PageContent>
  )
}

/// How many letters the register holds, and how many still wait to be issued.
function LetterTally({ query }: { query: LetterQuery }) {
  const letters = useSuspenseInfiniteQuery(letterListQuery(query))
  const head = letters.data.pages[0]
  if (head === undefined) return null
  return (
    <span className="text-meta text-body">
      <b className="font-medium text-ink">{count(head.total)}</b>{" "}
      {head.total === 1 ? "letter" : "letters"}
      {head.drafts > 0 && (
        <>
          {" · "}
          <b className="font-medium text-ink">{count(head.drafts)}</b> awaiting
          issue
        </>
      )}
    </span>
  )
}

/// The register's rows: a phone's cards, or a table.
function LetterRows({
  query,
  stale,
  phone,
  onOpen,
  onWrite,
}: {
  query: LetterQuery
  /// The question on screen is one behind the one the person has asked.
  stale: boolean
  phone: boolean
  onOpen: (id: string) => void
  onWrite: () => void
}) {
  /// The register, a page at a time as its foot nears view.
  const letters = useSuspenseInfiniteQuery(letterListQuery(query))
  const rows = useMemo(
    () => letters.data.pages.flatMap((page) => page.rows),
    [letters.data]
  )

  return (
    <div aria-busy={stale || undefined} className="list-swap">
      {rows.length === 0 ? (
        <Card>
          <EmptyState
            action={
              <Button variant="ghost" onClick={onWrite}>
                New letter
              </Button>
            }
          >
            No letters yet.
          </EmptyState>
        </Card>
      ) : phone ? (
        <PhoneCards
          rows={rows}
          rowId={(row) => row.letter_id}
          spec={LETTER_CARD}
          onOpen={(row) => onOpen(row.letter_id)}
          more={letters}
        />
      ) : (
        <Card className="overflow-hidden">
          <div className="grid h-10 grid-cols-[9rem_minmax(0,1fr)_9rem_5rem_6rem_6rem] items-center gap-3 border-b border-hairline bg-soft px-3.5 text-eyebrow font-medium text-body">
            <span>Number</span>
            <span>Letter</span>
            <span>Recipient</span>
            <span className="text-right">Quantity</span>
            <span>Status</span>
            <span className="text-right">Issued</span>
          </div>
          {rows.map((row) => (
            <LetterRowLine
              key={row.letter_id}
              row={row}
              onOpen={() => onOpen(row.letter_id)}
            />
          ))}
          {/* The page scrolls, not this card — see `<LoadMore>`. */}
          <LoadMore query={letters} />
        </Card>
      )}
    </div>
  )
}

/// A letter as a phone's card: the kind over its number (or the word that says
/// it has none yet), who it is for, how many, and where it stands.
const LETTER_CARD: CardSpec<LetterRow> = {
  title: (row) => (
    <CardName
      name={letterName(row)}
      code={row.letter_number ?? "no number yet"}
    />
  ),
  meta: [
    (row) =>
      [row.counterparty, row.place].filter((part) => part !== "").join(" · "),
    (row) => (row.reference === "" ? null : row.reference),
  ],
  lead: (row) => <CardFigure value={letterQuantity(row)} caption="Quantity" />,
  foot: (row) => (row.issued_at === null ? "Not issued" : day(row.issued_at)),
  action: (row) => (
    <Pill tone={letterTone(row.status)}>
      {STATUS_WORDS[row.status] ??
        LETTER_STATUS_LABEL[row.status] ??
        row.status}
    </Pill>
  ),
}

function LetterRowLine({
  row,
  onOpen,
}: {
  row: LetterRow
  onOpen: () => void
}) {
  return (
    <div
      onClick={onOpen}
      className="grid cursor-pointer grid-cols-[9rem_minmax(0,1fr)_9rem_5rem_6rem_6rem] items-center gap-3 border-b border-hairline px-3.5 py-2.5 transition-colors last:border-b-0 hover:bg-soft"
    >
      {/* A draft has no number, and the column says so rather than sitting
          empty: an empty cell in a numbered series reads as a lost number. */}
      <span
        className={cn(
          "truncate font-mono text-id",
          row.letter_number === null ? "text-mute italic" : "text-ink"
        )}
      >
        {row.letter_number ?? "no number yet"}
      </span>
      <div className="min-w-0">
        <div className="truncate text-cell font-medium text-ink">
          {letterName(row)}
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-pill text-mute">
          <SubjectRef
            kind={row.subject_kind}
            letter={row.kind}
            id={row.subject_id}
            reference={row.reference}
            className="font-mono text-id"
          />
          {row.place !== "" && <span>· {row.place}</span>}
        </div>
      </div>
      <span className="truncate text-meta text-body">{row.counterparty}</span>
      <span className="text-right text-meta text-body tabular-nums">
        {letterQuantity(row)}
      </span>
      <span>
        <Pill tone={letterTone(row.status)}>
          {STATUS_WORDS[row.status] ??
            LETTER_STATUS_LABEL[row.status] ??
            row.status}
        </Pill>
      </span>
      <span className="text-right text-pill text-mute">
        {row.issued_at === null ? "—" : day(row.issued_at)}
      </span>
    </div>
  )
}

/// The record a letter was drawn from, as a link where this app has a screen
/// to open.
///
/// Brief §10.1: the reference column points at the record rather than only
/// naming it. A delivery note is written against an allotment AND one of its
/// destinations — the server spells its `subject_id` `{allotment}/{site}` —
/// where the allotment screen knows the allotment on its own, so what travels
/// is the id before the first slash and the sheet opens on that record.
///
/// A goods receipt note names a `goods_receipt`, and there is no screen of its
/// own for one yet: a receipt is read through the letters it produces, and the
/// stand-in that does show one reads it from the order book. So its reference
/// stays a word rather than a link to nowhere. A blank letter names itself and
/// links to nothing at all.
function SubjectRef({
  kind,
  letter,
  id,
  reference,
  className,
}: {
  kind: string
  /// The letter's kind — an allotment subject means different screens for a
  /// delivery note (the Gudang's distribution board) and a return delivery
  /// note (Buying's return book).
  letter: string
  id: string
  reference: string
  className?: string
}) {
  const navigate = useNavigate()

  if (kind === "allotment" && letter === "SUPPLIER_RETURN") {
    return (
      <button
        type="button"
        title={`Open return ${reference}`}
        onClick={(event) => {
          event.stopPropagation()
          void navigate({
            to: "/procurement/returns",
            search: (prev: Record<string, unknown>) => ({
              ...prev,
              allotment: id,
            }),
          } as never)
        }}
        className={cn(
          "text-left text-accent transition-colors hover:underline",
          className
        )}
      >
        {reference}
      </button>
    )
  }

  if (kind === "allotment") {
    const allotment = id.split("/")[0]
    return (
      <button
        type="button"
        title={`Open allotment ${reference}`}
        onClick={(event) => {
          // The register row is itself a target — it opens the letter — so the
          // reference has to stop the click it sits inside from also firing.
          event.stopPropagation()
          // The route tree is generated from `lib/navigation.ts`, so Router
          // has no literal union to check `to` against. `AppLink` carries the
          // same cast for `<Link>`, and `finance/overview` for `navigate`.
          void navigate({
            to: "/allotment",
            search: (prev: Record<string, unknown>) => ({
              ...prev,
              allotment,
            }),
          } as never)
        }}
        className={cn(
          "text-left text-accent transition-colors hover:underline",
          className
        )}
      >
        {reference}
      </button>
    )
  }

  return (
    <span
      className={className}
      // A delivery has no screen of its own yet — it is a Gudang
      // document this app only reads through the letters it produces — so its
      // reference is text rather than a link somewhere that cannot answer.
      title={
        kind === "receipt"
          ? "A delivery has no screen of its own yet"
          : undefined
      }
    >
      {reference}
    </span>
  )
}

// ---- One letter --------------------------------------------------------

function OneLetter({ id, onBack }: { id: string; onBack: () => void }) {
  const client = useQueryClient()
  const [body, setBody] = useState<JSONContent | null>(null)
  const [written, setWritten] = useState<Record<string, unknown> | null>(null)
  const [voiding, setVoiding] = useState(false)
  const [reason, setReason] = useState("")
  const [naming, setNaming] = useState(false)
  const [patternName, setPatternName] = useState("")

  const letter = useQuery({
    queryKey: letterKeys.detail(id),
    queryFn: ({ signal }) => readLetter(id, signal),
  })

  const refresh = () => {
    void client.invalidateQueries({ queryKey: letterKeys.detail(id) })
    void client.invalidateQueries({ queryKey: letterKeys.all })
  }

  const save = useMutation({
    mutationFn: () =>
      saveLetter(id, {
        body: (body ?? letter.data?.body ?? {}) as Record<string, unknown>,
        facts: written,
      }),
    onSuccess: () => {
      setBody(null)
      setWritten(null)
      refresh()
    },
  })

  const issue = useMutation({
    mutationFn: () => issueLetter(id),
    onSuccess: refresh,
  })

  const stop = useMutation({
    mutationFn: () => voidLetter(id, { reason }),
    onSuccess: () => {
      setVoiding(false)
      setReason("")
      refresh()
    },
  })

  /// Keep this letter's wording under a name.
  ///
  /// What is saved is read off the letter by the SERVER — see
  /// `save_template` — rather than sent up from here, so a pattern is what the
  /// letter actually says rather than what this screen believes it says.
  const keep = useMutation({
    mutationFn: () =>
      saveTemplate({
        kind: letter.data?.kind ?? "",
        name: patternName,
        from_letter: id,
      }),
    onSuccess: () => {
      setNaming(false)
      setPatternName("")
      void client.invalidateQueries({ queryKey: letterKeys.all })
    },
  })

  const discard = useMutation({
    mutationFn: () => discardLetter(id),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: letterKeys.all })
      onBack()
    },
  })

  const problem = [
    save.error,
    issue.error,
    stop.error,
    discard.error,
    keep.error,
  ].find((error): error is Error => error instanceof Error)

  // A letter a person wrote from a template opens on the desk, the paper as
  // its own editor (owner, 2026-10-17); the ones drawn from records keep the
  // page below.
  const fromTemplate =
    letter.data?.kind === "GENERAL"
      ? writtenForm(letter.data.facts.form)
      : undefined
  if (letter.data !== undefined && fromTemplate !== undefined) {
    return (
      <WrittenLetter
        key={letter.data.letter_id}
        letter={letter.data}
        form={fromTemplate}
        onBack={onBack}
      />
    )
  }

  return (
    <PageContent>
      <PrintStyles />
      <button
        type="button"
        onClick={onBack}
        className="srt-noprint mb-3 inline-flex items-center gap-1.5 text-[0.9375rem] font-medium text-mute transition-colors hover:text-ink"
      >
        <ArrowLeft className="size-3.5" />
        Letters
      </button>

      {queryState(letter, {
        loading: "Opening the letter…",
        render: (open) => {
          const draft = open.status === "DRAFT"
          // What the paper shows: what has been typed but not yet saved, or
          // what the server holds. The preview must follow the keystrokes or
          // it is not a preview.
          const shown = {
            ...open,
            facts: { ...(open.facts as object), ...(written ?? {}) },
          }
          const dirty = body !== null || written !== null

          return (
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_17rem]">
              <div className="min-w-0">
                {problem && (
                  <Banner tone="bad" className="srt-noprint mb-4">
                    {problem.message}
                  </Banner>
                )}
                <LetterPaper
                  letter={shown}
                  editable={draft}
                  onFact={(key, value) =>
                    setWritten((current) => ({
                      ...(current ?? {}),
                      [key]: value,
                    }))
                  }
                >
                  <LetterBody
                    body={open.body as Record<string, unknown>}
                    editable={draft}
                    onChange={setBody}
                  />
                </LetterPaper>
              </div>

              <aside className="srt-noprint flex min-w-0 flex-col gap-4">
                <div className="flex items-center gap-2">
                  <Pill tone={letterTone(open.status)}>
                    {STATUS_WORDS[open.status] ??
                      LETTER_STATUS_LABEL[open.status] ??
                      open.status}
                  </Pill>
                  {dirty && (
                    <span className="text-pill text-mute">not saved yet</span>
                  )}
                </div>

                {draft ? (
                  <div className="flex flex-col gap-2">
                    <Button
                      onClick={() => save.mutate()}
                      pending={save.isPending}
                      disabled={!dirty}
                    >
                      {save.isPending ? "Submitting…" : "Submit"}
                    </Button>
                    {/* Issuing is the act that spends a number, so it says so
                        rather than saying "Submit". Nothing is saved
                        implicitly on the way: a person who typed a paragraph
                        and pressed Issue without saving would otherwise put
                        their name on a letter without that paragraph. */}
                    <Button
                      variant="primary"
                      onClick={() => issue.mutate()}
                      pending={issue.isPending}
                      disabled={dirty}
                    >
                      {issue.isPending ? "Submitting…" : "Submit"}
                    </Button>
                    {dirty && (
                      <p className="text-pill text-mute">
                        Save first — what is issued is what has been saved.
                      </p>
                    )}
                  </div>
                ) : (
                  <Button variant="primary" onClick={() => window.print()}>
                    <Printer className="size-3.5" />
                    Print
                  </Button>
                )}

                {/* Nothing here fills the letter in.
                    
                    There was a column of labelled boxes at this spot — Kepada,
                    Perihal, Dibawa oleh — and the owner asked why they could
                    not simply be written on the letter. They can, and now are:
                    every part a person owns is edited in the document, at the
                    size it will print. What is left on this side is what
                    HAPPENS to the letter rather than what it says. */}
                <div className="border-t border-hairline pt-3 text-[0.9375rem]">
                  {/* The record this letter was drawn from, as the brief §10.1
                      asks letters to point at one. The paper names it too, but
                      a printed reference is not clickable; the side panel is
                      where the crossing is made. */}
                  {open.subject_kind !== "letter" && (
                    <KeyValue
                      term={
                        open.subject_kind === "receipt"
                          ? "Receipt"
                          : "Allotment"
                      }
                    >
                      <SubjectRef
                        kind={open.subject_kind}
                        letter={open.kind}
                        id={open.subject_id}
                        reference={fact(open.facts, "reference")}
                        className="font-mono text-id"
                      />
                    </KeyValue>
                  )}
                  <KeyValue term="Written by">{open.created_by}</KeyValue>
                  <KeyValue term="Written">{day(open.created_at)}</KeyValue>
                  {open.issued_by !== null && (
                    <KeyValue term="Issued by">{open.issued_by}</KeyValue>
                  )}
                  {open.issued_at !== null && (
                    <KeyValue term="Issued">{day(open.issued_at)}</KeyValue>
                  )}
                  {open.voided_by !== null && (
                    <KeyValue term="Voided by">{open.voided_by}</KeyValue>
                  )}
                </div>

                {open.status === "ISSUED" && (
                  <Button
                    variant="ghost"
                    onClick={() => setVoiding(true)}
                    className="justify-start text-bad"
                  >
                    Void this letter
                  </Button>
                )}
                {draft && (
                  <>
                    {/* The wording, kept for the next one. Offered on a draft
                        rather than on an issued letter because this is the
                        moment somebody has just finished writing it — and a
                        pattern taken from an issued letter would be the same
                        words a moment later anyway. */}
                    <Button
                      variant="ghost"
                      onClick={() => setNaming(true)}
                      className="justify-start"
                    >
                      <BookmarkPlus className="size-3.5" />
                      Keep this wording as a pattern
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => discard.mutate()}
                      pending={discard.isPending}
                      className="justify-start text-bad"
                    >
                      <Trash2 className="size-3.5" />
                      Throw the draft away
                    </Button>
                  </>
                )}

                {/* What has been done to this letter, from the record surface
                    every sheet in the app already uses. */}
                <RecordPanel subject={{ kind: "letter", id }} />
              </aside>

              <Sheet
                open={naming}
                onOpenChange={(next) => !next && setNaming(false)}
                title="Keep this wording"
                footer={
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-pill text-mute">
                      The words and the typed head. Never the goods.
                    </span>
                    <Button
                      variant="primary"
                      pending={keep.isPending}
                      disabled={patternName.trim() === ""}
                      onClick={() => keep.mutate()}
                    >
                      {keep.isPending ? "Keeping…" : "Keep it"}
                    </Button>
                  </div>
                }
              >
                <div className="flex flex-col gap-4">
                  <p className="text-[0.9375rem] leading-relaxed text-body">
                    The next letter of this kind can be started from it, with
                    this wording already in place. What arrives in the goods
                    table always comes from the record, never from here.
                  </p>
                  <Field
                    label="Call it"
                    required
                    aside="What somebody will look for in the menu."
                  >
                    <Input
                      value={patternName}
                      onChange={(event) => setPatternName(event.target.value)}
                    />
                  </Field>
                </div>
              </Sheet>

              <Sheet
                open={voiding}
                onOpenChange={(next) => !next && setVoiding(false)}
                title="Void this letter"
                footer={
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-pill text-mute">
                      The number stays spent.
                    </span>
                    <Button
                      variant="primary"
                      pending={stop.isPending}
                      disabled={reason.trim() === ""}
                      onClick={() => stop.mutate()}
                    >
                      {stop.isPending ? "Voiding…" : "Void it"}
                    </Button>
                  </div>
                }
              >
                <div className="flex flex-col gap-4">
                  <p className="text-[0.9375rem] leading-relaxed text-body">
                    {open.letter_number} stays in the book and is never handed
                    out again — somebody may be holding a printed copy of it.
                    Voiding puts the record back on the list of things a letter
                    can be written against.
                  </p>
                  <Field
                    label="Why"
                    required
                    aside="Whoever finds this letter in a year reads this sentence."
                  >
                    <Textarea
                      rows={3}
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                    />
                  </Field>
                </div>
              </Sheet>
            </div>
          )
        },
      })}
    </PageContent>
  )
}
