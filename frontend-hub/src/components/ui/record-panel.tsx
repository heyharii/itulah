import { Collapsible } from "@base-ui/react/collapsible"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link, type LinkProps } from "@tanstack/react-router"
import { ChevronRight, Plus, X } from "lucide-react"
import { useState } from "react"

import { moment } from "@/lib/format"
import { readAction } from "@/lib/queries/audit"
import { catalogueVocabulary } from "@/lib/queries/procurement"
import {
  addComment,
  recordInfo,
  recordKeys,
  removeComment,
  tagRecord,
  untagRecord,
  type RecordInfo,
} from "@/lib/queries/records"
import { cn } from "@/lib/utils"

/// The foot of every record sheet: what it is filed under, what people said
/// about it, and what was done to it.
///
/// ## Why one component and not three
///
/// It is one request. `GET /records/{kind}/{id}/info` answers comments, tags,
/// history, filed documents and open threads together, so three components
/// would be three requests for one panel — and the fourth screen to want a
/// fourth of those would be a fourth.
///
/// That is the shape ERPNext's `get_docinfo` has, and the reason to copy it is
/// not the saved round trips: it is that a GENERIC sheet can then offer all of
/// it, and every record type gets the same treatment without any screen opting
/// in. This app has twenty-four sheets and they all already pass `subject`.
///
/// ## Why this one fetches on mount where the old panel did not
///
/// The panel it replaces deliberately waited until somebody opened it, because
/// a sheet is opened constantly and its history is read rarely. Comments are
/// not history: a record with a note on it has to SAY so without being asked,
/// or nobody will ever look. So the read happens on open and the cost is kept
/// where it can be paid — every query behind it is an index lookup on
/// `(subject_kind, subject_id)`, none of them counts, and the answer is cached
/// for half a minute.
export function RecordPanel({
  subject,
}: {
  subject: { kind: string; id: string }
}) {
  const info = useQuery({
    queryKey: recordKeys.info(subject.kind, subject.id),
    queryFn: ({ signal }) => recordInfo(subject.kind, subject.id, signal),
    // A record's surroundings do not change while you are reading them.
    staleTime: 30_000,
  })

  if (info.isPending) {
    return (
      <div className="mt-6 border-t border-hairline pt-3">
        <p className="py-1 text-[0.875rem] text-mute">Reading the record…</p>
      </div>
    )
  }
  if (info.isError) {
    return (
      <div className="mt-6 border-t border-hairline pt-3">
        <p className="py-1 text-[0.875rem] text-bad">
          This record's comments and history could not be read.
        </p>
      </div>
    )
  }

  return (
    <div className="mt-6 flex flex-col gap-4 border-t border-hairline pt-3.5">
      <Tags subject={subject} info={info.data} />
      <Comments subject={subject} info={info.data} />
      <Elsewhere info={info.data} />
      <Trail info={info.data} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

/// Words a record is filed under so somebody can find it again.
///
/// These are NOT the tags on an article. That table is merchandising data the
/// pricing engine reads — a promotion scoped to `DENIM` matches through it —
/// and the two are separate tables on purpose, so that sticking "chase this"
/// on an order cannot move what a live promotion covers. They share the
/// vocabulary, because two spellings of one word is the split the `tag` master
/// exists to prevent.
function Tags({
  subject,
  info,
}: {
  subject: { kind: string; id: string }
  info: RecordInfo
}) {
  const client = useQueryClient()
  const [picking, setPicking] = useState(false)
  const invalidate = () =>
    client.invalidateQueries({
      queryKey: recordKeys.info(subject.kind, subject.id),
    })

  const vocabulary = useQuery({
    queryKey: ["catalogue", "vocabulary"],
    queryFn: ({ signal }) => catalogueVocabulary(signal),
    // Only when somebody reaches for the control: the list of words is not
    // worth a request on every sheet that is opened and closed again.
    enabled: picking,
    staleTime: 30 * 60 * 1000,
  })

  const add = useMutation({
    mutationFn: (code: string) => tagRecord(subject.kind, subject.id, code),
    onSuccess: () => {
      setPicking(false)
      void invalidate()
    },
  })
  const drop = useMutation({
    mutationFn: (code: string) => untagRecord(subject.kind, subject.id, code),
    onSuccess: invalidate,
  })

  const held = new Set(info.tags.map((tag) => tag.tag_code))
  const offer = (vocabulary.data?.tags ?? []).filter(
    (term) => !held.has(term.code)
  )

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {info.tags.map((tag) => (
        <span
          key={tag.tag_code}
          className="group inline-flex items-center gap-1 rounded-md bg-soft-2 py-[0.0625rem] pr-1 pl-[0.4375rem] text-[0.875rem] text-body"
          title={`${tag.tagged_by} · ${moment(tag.tagged_at)}`}
        >
          {tag.label}
          <button
            type="button"
            aria-label={`Remove ${tag.label}`}
            onClick={() => drop.mutate(tag.tag_code)}
            className="grid size-3.5 place-items-center rounded-sm text-line-ico transition-colors hover:bg-soft-3 hover:text-ink"
          >
            <X className="size-2.5" />
          </button>
        </span>
      ))}

      {picking ? (
        <span className="flex flex-wrap items-center gap-1">
          {vocabulary.isPending && (
            <span className="text-[0.875rem] text-mute">Reading words…</span>
          )}
          {offer.map((term) => (
            <button
              key={term.code}
              type="button"
              onClick={() => add.mutate(term.code)}
              className="rounded-md border border-hairline-2 px-[0.4375rem] py-[0.0625rem] text-[0.875rem] text-body transition-colors hover:border-hairline-strong hover:text-ink"
            >
              {term.label}
            </button>
          ))}
          {vocabulary.isSuccess && offer.length === 0 && (
            <span className="text-[0.875rem] text-mute">
              Every word is already on this record.
            </span>
          )}
          <button
            type="button"
            onClick={() => setPicking(false)}
            className="text-[0.875rem] text-mute underline-offset-2 hover:underline"
          >
            Done
          </button>
        </span>
      ) : (
        <button
          type="button"
          onClick={() => setPicking(true)}
          className="inline-flex items-center gap-0.5 rounded-md px-[0.25rem] py-[0.0625rem] text-[0.875rem] text-mute transition-colors hover:bg-soft-2 hover:text-ink"
        >
          <Plus className="size-3" />
          {info.tags.length === 0 ? "Tag" : ""}
        </button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

/// What people said about this record.
///
/// Shown rather than folded away, unlike the history below it. A note left on
/// a bill so the next person knows why it was posted late is worth nothing if
/// the next person has to know to go looking for it.
function Comments({
  subject,
  info,
}: {
  subject: { kind: string; id: string }
  info: RecordInfo
}) {
  const client = useQueryClient()
  const [draft, setDraft] = useState("")
  const invalidate = () =>
    client.invalidateQueries({
      queryKey: recordKeys.info(subject.kind, subject.id),
    })

  const say = useMutation({
    mutationFn: (body: string) => addComment(subject.kind, subject.id, body),
    onSuccess: () => {
      setDraft("")
      void invalidate()
    },
  })
  const drop = useMutation({
    mutationFn: (commentId: string) => removeComment(commentId),
    onSuccess: invalidate,
  })

  const send = () => {
    const body = draft.trim()
    if (body === "" || say.isPending) return
    say.mutate(body)
  }

  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-[0.875rem] font-medium text-body">
        Comments
        {info.comments.length > 0 && (
          <span className="ml-1 text-mute tabular-nums">
            {info.comments.length}
          </span>
        )}
      </h3>

      {info.comments.map((comment) => (
        <div key={comment.comment_id} className="flex flex-col gap-0.5">
          <div className="flex items-baseline gap-1.5">
            <span className="text-[0.875rem] font-medium text-ink">
              {comment.display_name}
            </span>
            <span className="text-[0.875rem] text-mute tabular-nums">
              {moment(comment.created_at)}
            </span>
            {comment.edited_at && (
              <span className="text-[0.875rem] text-mute">edited</span>
            )}
            {comment.mine && (
              <button
                type="button"
                onClick={() => drop.mutate(comment.comment_id)}
                className="ml-auto text-[0.875rem] text-mute underline-offset-2 hover:text-bad hover:underline"
              >
                Remove
              </button>
            )}
          </div>
          <p className="text-[0.875rem] whitespace-pre-wrap text-body">
            {comment.body}
          </p>
        </div>
      ))}

      <textarea
        rows={1}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          // Enter sends, Shift+Enter breaks the line — the convention the chat
          // composer in this app already teaches.
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault()
            send()
          }
        }}
        placeholder="Say something about this record"
        className="max-h-40 min-h-8 w-full resize-none rounded-inner border border-hairline-2 bg-canvas px-3 py-1.5 text-[0.875rem] text-ink transition-colors outline-none placeholder:text-mute hover:border-hairline-strong"
      />
      {say.isError && (
        <p className="text-[0.875rem] text-bad">
          That comment was not saved.
        </p>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// What else points at this record
// ---------------------------------------------------------------------------

/// Documents filed against it and threads arguing about it.
///
/// A line rather than two more lists: both already have screens of their own,
/// and the useful thing on a sheet is knowing they exist — and getting to
/// them. The discussions link lands on the board narrowed to THIS record, and
/// the board's "Open a thread" starts one about it, which is how a question
/// about an order gets asked from the order rather than from memory.
///
/// The collaboration surfaces themselves are records for the log's sake and
/// not things a thread hangs on, so they get no link.
const NOT_DISCUSSED = new Set([
  "discussion",
  "conversation",
  "assistant_conversation",
  "notification",
])

function Elsewhere({ info }: { info: RecordInfo }) {
  const documents = info.documents.length
  const threads = info.threads.length
  const discussable = !NOT_DISCUSSED.has(info.subject_kind)
  if (documents === 0 && threads === 0 && !discussable) return null
  return (
    <p className="text-[0.875rem] text-mute">
      {documents > 0 && (
        <span>
          {documents} {documents === 1 ? "document" : "documents"} filed
        </span>
      )}
      {documents > 0 && discussable && <span> · </span>}
      {discussable && (
        <Link
          // The board is a declared route; the cast is the one `AppLink`
          // makes, and it is here only because this link carries two keys.
          to={"/discussions" as LinkProps["to"]}
          search={
            {
              about: info.subject_kind,
              aboutId: info.subject_id,
            } as never
          }
          className="font-medium text-accent hover:underline"
        >
          {threads === 0
            ? "Discuss this record"
            : `${threads} ${threads === 1 ? "discussion" : "discussions"}`}
        </Link>
      )}
    </p>
  )
}

// ---------------------------------------------------------------------------
// Activity
// ---------------------------------------------------------------------------

/// One record's history.
///
/// Collapsed by default, and that is DESIGN.md's rule rather than a space
/// saving: depth — audit, GL impact, raw fields — is shown on demand, because
/// a sheet that opens with a wall of provenance buries the two numbers the
/// person actually came for.
function Trail({ info }: { info: RecordInfo }) {
  const entries = info.activity
  return (
    <Collapsible.Root>
      <Collapsible.Trigger className="group flex w-full items-center gap-1.5 text-left text-[0.875rem] font-medium text-body transition-colors hover:text-ink">
        <ChevronRight className="size-3.5 text-line-ico transition-transform duration-150 group-data-[panel-open]:rotate-90" />
        Activity
        {entries.length > 0 && (
          <span className="text-mute tabular-nums">{entries.length}</span>
        )}
      </Collapsible.Trigger>
      <Collapsible.Panel className="overflow-hidden">
        {entries.length === 0 ? (
          <p className="py-3 text-[0.875rem] text-mute">
            Nothing has been done to this record since the log began.
          </p>
        ) : (
          <ol className="flex flex-col pt-1">
            {entries.map((entry, index) => (
              <li
                key={entry.audit_id}
                className="relative flex items-start gap-2.5 py-1.5"
              >
                {index < entries.length - 1 && (
                  <span className="absolute top-6 left-[0.4375rem] h-[calc(100%-1.125rem)] w-px bg-hairline-2" />
                )}
                {/* A refused action is as much a fact as a successful one, and
                    it is the more interesting of the two. Red, not hidden. */}
                <span
                  className={cn(
                    "z-10 mt-1.5 size-[0.4375rem] shrink-0 rounded-full",
                    entry.status >= 400 ? "bg-bad" : "bg-ok"
                  )}
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-[0.875rem] text-ink">
                    {readAction(entry)}
                    {entry.status >= 400 && (
                      <span className="ml-1.5 text-bad">refused</span>
                    )}
                  </span>
                  <span className="block text-[0.875rem] text-mute">
                    {entry.display_name}
                  </span>
                </span>
                <span className="shrink-0 text-[0.875rem] text-mute tabular-nums">
                  {moment(entry.at)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </Collapsible.Panel>
    </Collapsible.Root>
  )
}
