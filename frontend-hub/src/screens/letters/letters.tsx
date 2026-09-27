import type { JSONContent } from "@tiptap/react"
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import {
  ArrowLeft,
  BookmarkPlus,
  FileSignature,
  ListFilter,
  Plus,
  Printer,
  Trash2,
} from "lucide-react"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Field, Input, Textarea } from "@/components/ui/field"
import { ChoiceMenu } from "@/components/ui/list-chrome"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { RecordPanel } from "@/components/ui/record-panel"
import { KeyValue } from "@/components/ui/rows"
import { Segmented, Toolbar } from "@/components/ui/segmented"
import { Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState, LoadMore } from "@/components/ui/states"
import { count, day } from "@/lib/format"
import { queryState } from "@/lib/query-state"
import {
  discardLetter,
  draftLetter,
  drawnFromRecord,
  fact,
  issueLetter,
  letterKeys,
  letterKindLabel,
  letterSources,
  letterTemplates,
  letterTone,
  LETTER_KINDS,
  LETTER_STATUS_LABEL,
  listLetters,
  readLetter,
  saveLetter,
  saveTemplate,
  voidLetter,
  type LetterKind,
  type LetterQuery,
  type LetterStatus,
} from "@/lib/queries/letters"
import { useSheet } from "@/lib/sheets"
import { useDebounced } from "@/lib/use-debounced"
import { cn } from "@/lib/utils"
import { LetterBody } from "@/screens/letters/editor"
import { LetterPaper, PrintStyles } from "@/screens/letters/document"
import type { LetterRow, LetterSource } from "@itulah/contract"

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

const STATUSES = [
  { value: null, label: "Any status" },
  { value: "DRAFT", label: "Draft" },
  { value: "ISSUED", label: "Issued" },
  { value: "VOID", label: "Void" },
] as const

const KINDS = [
  { value: "all", label: "All" },
  ...LETTER_KINDS.map((one) => ({ value: one.value, label: one.appLabel })),
] as const

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
  const [kind, setKind] = useState<"all" | LetterKind>("all")
  const [status, setStatus] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [writing, setWriting] = useState(false)
  // The search is the server's, so it waits for the typing to stop.
  const needle = useDebounced(search.trim(), 300)

  const query = useMemo<LetterQuery>(
    () => ({
      kind: kind === "all" ? null : kind,
      status: (status as LetterStatus | null) ?? null,
      q: needle,
    }),
    [kind, status, needle]
  )

  /// The register, a page at a time as its foot nears view. It used to stop
  /// at the two-hundredth letter without saying so, and the count beside it
  /// counted what had loaded.
  const letters = useInfiniteQuery({
    queryKey: letterKeys.list(query),
    queryFn: ({ pageParam, signal }) =>
      listLetters(query, { cursor: pageParam }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    placeholderData: (previous) => previous,
  })
  const rows = useMemo(
    () => letters.data?.pages.flatMap((page) => page.rows) ?? [],
    [letters.data]
  )
  const head = letters.data?.pages[0]

  return (
    <PageContent>
      <PageHeader
        crumb="GA"
        title="Letters"
        sub="Manage goods receipt notes and delivery notes. The letter number is assigned when it's issued."
        actions={
          <>
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Number, order, supplier"
              className="h-8 w-56"
            />
            <Button variant="primary" onClick={() => setWriting(true)}>
              <Plus />
              New letter
            </Button>
          </>
        }
      />

      <Toolbar>
        <Segmented options={KINDS} value={kind} onChange={setKind} />
        <ChoiceMenu
          heading="Status"
          icon={ListFilter}
          value={status}
          options={STATUSES}
          onChange={setStatus}
        />
        <Toolbar.Spacer />
        {/* Read straight off the query rather than through `queryState`: this
            is a caption on a toolbar, and a toolbar that says "Loading…" where
            a number goes is furniture that moves while somebody reads it. */}
        {head !== undefined && (
          <span className="text-meta text-body">
            <b className="font-medium text-ink">{count(head.total)}</b>{" "}
            {head.total === 1 ? "letter" : "letters"}
            {head.drafts > 0 && (
              <>
                {" · "}
                <b className="font-medium text-ink">
                  {count(head.drafts)}
                </b>{" "}
                awaiting issue
              </>
            )}
          </span>
        )}
      </Toolbar>

      {queryState(letters, {
        loading: "Opening the letters list…",
        render: () =>
          rows.length === 0 ? (
            <Card>
              <EmptyState
                action={
                  <Button variant="ghost" onClick={() => setWriting(true)}>
                    New letter
                  </Button>
                }
              >
                No letters yet. Create one from a goods receipt, a delivery to a
                store, or start with a blank letter.
              </EmptyState>
            </Card>
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
          ),
      })}

      <SourceSheet
        open={writing}
        onClose={() => setWriting(false)}
        onDrafted={(id) => {
          setWriting(false)
          onOpen(id)
        }}
      />
    </PageContent>
  )
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
          {letterKindLabel(row.kind)}
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-pill text-mute">
          <SubjectRef
            kind={row.subject_kind}
            id={row.subject_id}
            reference={row.reference}
            className="font-mono text-id"
          />
          {row.place !== "" && <span>· {row.place}</span>}
        </div>
      </div>
      <span className="truncate text-meta text-body">{row.counterparty}</span>
      <span className="text-right text-meta text-body tabular-nums">
        {count(row.quantity)}
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
  id,
  reference,
  className,
}: {
  kind: string
  id: string
  reference: string
  className?: string
}) {
  const navigate = useNavigate()

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
      // A goods receipt has no screen of its own yet — it is a warehouse
      // document this app only reads through the letters it produces — so its
      // reference is text rather than a link somewhere that cannot answer.
      title={
        kind === "receipt"
          ? "A goods receipt has no screen of its own yet"
          : undefined
      }
    >
      {reference}
    </span>
  )
}

// ---- Choosing what to write one against --------------------------------

/// The picker: which kind, then which record.
///
/// It offers only records with no live letter — that narrowing is the
/// server's, and the list is therefore what somebody may actually pick rather
/// than everything with half of it greyed out. A record whose letter was
/// voided reappears here, which is what voiding is for.
function SourceSheet({
  open,
  onClose,
  onDrafted,
}: {
  open: boolean
  onClose: () => void
  onDrafted: (id: string) => void
}) {
  const client = useQueryClient()
  const [kind, setKind] = useState<LetterKind>("GOODS_RECEIPT")
  const chosen = LETTER_KINDS.find((one) => one.value === kind)

  const fromRecord = drawnFromRecord(kind)
  const [pattern, setPattern] = useState<string | null>(null)

  const templates = useQuery({
    queryKey: letterKeys.templates(kind),
    queryFn: ({ signal }) => letterTemplates(kind, signal),
    enabled: open,
  })

  const sources = useQuery({
    queryKey: letterKeys.sources(kind),
    queryFn: ({ signal }) => letterSources(kind, signal),
    // A blank letter has no records to offer, so there is nothing to ask for.
    enabled: open && fromRecord,
  })

  const draft = useMutation({
    // A blank letter names no record; the server gives it its own id to point
    // at, so what goes up is an empty string.
    mutationFn: (source: LetterSource | null) =>
      draftLetter({
        kind,
        subject_id: source?.subject_id ?? "",
        template_id: pattern,
      }),
    onSuccess: (letter) => {
      void client.invalidateQueries({ queryKey: letterKeys.all })
      onDrafted(letter.letter_id)
    },
  })

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title="New letter"
      width="wide"
    >
      <div className="flex flex-col gap-4">
        <Segmented
          options={LETTER_KINDS.map((one) => ({
            value: one.value,
            label: one.appLabel,
          }))}
          value={kind}
          onChange={setKind}
        />

        <p className="text-[0.875rem] leading-relaxed text-body">
          {chosen?.english} — written against {chosen?.source}.{" "}
          {fromRecord
            ? "The figures come from that record; the number is taken when the letter is issued."
            : "Nothing is filled in for you. The number is taken when the letter is issued."}
        </p>

        {/* The pattern, chosen before the record rather than after.
            
            It is a property of the letter being written, not of the delivery
            it is about — so it sits above both halves and applies to whichever
            source is clicked next. `null` is the blank one, which is what the
            first letter of any kind is written from. */}
        {(templates.data?.items.length ?? 0) > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-meta text-body">Pattern</span>
            <ChoiceMenu
              heading="Write it from"
              icon={FileSignature}
              value={pattern}
              options={[
                { value: null, label: "Blank" },
                ...(templates.data?.items ?? []).map((one) => ({
                  value: one.template_id,
                  label: one.name,
                })),
              ]}
              onChange={setPattern}
            />
          </div>
        )}

        {/* What a draft IS, said where somebody is about to make one.
            
            Picking a record here produces a draft immediately, which surprised
            the owner — "bukan yg tiba2 langsung jadi draft?". It is deliberate
            and it is cheap: a draft has no number, costs nothing, and is
            thrown away with one button. The surprise was that nothing said so
            beforehand. */}
        <p className="text-pill text-mute">
          This opens a draft: no number yet, and one button throws it away.
        </p>

        {draft.error instanceof Error && (
          <Banner tone="bad">{draft.error.message}</Banner>
        )}

        {!fromRecord ? (
          <Button
            variant="primary"
            pending={draft.isPending}
            onClick={() => draft.mutate(null)}
          >
            <FileSignature className="size-3.5" />
            {draft.isPending
              ? "Writing…"
              : pattern === null
                ? "Write a blank letter"
                : "Write it from this pattern"}
          </Button>
        ) : (
          queryState(sources, {
            loading: "Looking for records…",
            render: (answer) =>
              answer.items.length === 0 ? (
                // Two different emptinesses, and they need different sentences:
                // a person who has already written every letter there is has
                // nothing to fix, and a person whose warehouse has not counted
                // anything yet is waiting on somebody else.
                <EmptyState>
                  {answer.taken > 0 ? (
                    <>
                      Every record that could carry one already has its letter —{" "}
                      {count(answer.taken)} written. Voiding a letter puts its
                      record back on this list.
                    </>
                  ) : (
                    <>
                      Nothing has arrived to write one against yet: this letter
                      is drawn from {chosen?.source}.
                    </>
                  )}
                </EmptyState>
              ) : (
                <div className="overflow-hidden rounded-card border border-hairline">
                  {answer.items.map((source) => (
                    <button
                      key={source.subject_id}
                      type="button"
                      disabled={draft.isPending}
                      onClick={() => draft.mutate(source)}
                      className="flex w-full items-center gap-3 border-b border-hairline px-3.5 py-2.5 text-left transition-colors last:border-b-0 hover:bg-soft disabled:opacity-60"
                    >
                      <FileSignature className="size-4 shrink-0 text-line-ico" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-cell font-medium text-ink">
                          {source.reference}
                        </span>
                        <span className="mt-0.5 block truncate text-pill text-mute">
                          {source.counterparty} · {day(source.occurred_at)}
                        </span>
                      </span>
                      <span className="shrink-0 text-right text-meta text-body tabular-nums">
                        {count(source.quantity)}
                        <span className="block text-pill text-mute">
                          {count(source.lines)}{" "}
                          {source.lines === 1 ? "line" : "lines"}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              ),
          })
        )}
      </div>
    </Sheet>
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

  return (
    <PageContent>
      <PrintStyles />
      <button
        type="button"
        onClick={onBack}
        className="srt-noprint mb-3 inline-flex items-center gap-1.5 text-[0.875rem] font-medium text-mute transition-colors hover:text-ink"
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
                      {save.isPending ? "Saving…" : "Save"}
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
                      {issue.isPending ? "Issuing…" : "Issue and take a number"}
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
                <div className="border-t border-hairline pt-3 text-[0.875rem]">
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
                  <p className="text-[0.875rem] leading-relaxed text-body">
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
                      placeholder="Return pickup assignment"
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
                  <p className="text-[0.875rem] leading-relaxed text-body">
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
                      placeholder="Wrong allocation, letter rewritten"
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
