import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Check, Download, Link2 } from "lucide-react"
import { useMemo, useState } from "react"

import { Day } from "@/components/ui/day"
import { AppLink } from "@/components/ui/app-link"
import { Button } from "@/components/ui/button"
import { button } from "@/components/ui/button-style"
import { Field, Input, Select, Textarea } from "@/components/ui/field"
import { Pill, Status } from "@/components/ui/pill"
import { MiniCell, MiniRow, MiniTable, SheetSection } from "@/components/ui/rows"
import { Segmented } from "@/components/ui/segmented"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState } from "@/components/ui/states"
import { Tag } from "@/components/ui/tag"
import { day } from "@/lib/format"
import { gaAssetHub, gaKeys } from "@/lib/queries/ga"
import { useNameOfLogin } from "@/lib/queries/hr-employees"
import {
  DOCUMENT_SUBJECT_KINDS,
  documentSubjectLabel,
  listConversations,
  listThreads,
  readDocument,
  replyToThread,
  sendMessage,
  uploadAttachment,
  uploadDocument,
  workplaceKeys,
} from "@/lib/queries/workplace"
import { recordRoute } from "@/lib/record-route"
import { cn } from "@/lib/utils"
import { bytes, idempotencyKey } from "@/screens/workplace/lib"
import { FileTile } from "@/screens/workplace/parts"
import {
  kindWord,
  placeOf,
  stateOf,
  type VaultRow,
} from "@/screens/workplace/vault"
import { PagePreview, useCopyLink } from "@/screens/workplace/vault-tile"
import { originalWords } from "@/screens/workplace/original-sheets"
import { useSheet } from "@/lib/sheets"

// ─── One row, opened ─────────────────────────────────────────────────────────

/// The facts about one thing in the vault, whichever drawer it came from.
///
/// One sheet and not two, because the merge would be a lie if the two kinds
/// still opened different panels. What differs is what there is to say: a filed
/// document has a summary, a folder, a date on the paper and the records it was
/// filed against; an attachment has a room, and the room is also the only route
/// to its bytes.
///
/// A rail (owner, 17 Oct 2026, library-tidy-options.html A): the page on a
/// light band, the facts under it, and the two things to do with a file in
/// the foot. Who added it and when is the caption, as on every record. The
/// state stands beside the title only when something is wrong with the file;
/// the content type and a "the bytes are there" pill said nothing a person
/// acts on.
export function VaultSheet({
  row,
  onClose,
}: {
  row: VaultRow | null
  onClose: () => void
}) {
  // Fetched, rather than read off the list row, for the one reason that
  // justifies a second request: `subject` files this sheet's reads into the
  // audit trail, and a sheet with a subject is expected to show the record it
  // names. The list row carries everything else already.
  const detail = useQuery({
    queryKey: workplaceKeys.document(row?.id ?? ""),
    queryFn: ({ signal }) => readDocument(row!.id, signal),
    enabled: row !== null && row.source === "FILED",
  })
  const nameOf = useNameOfLogin()
  const original = useSheet("original")

  const links = detail.data?.links ?? []
  const state = row === null ? "Ready" : stateOf(row)
  const summary = row?.source === "FILED" ? detail.data?.summary : null

  return (
    <Sheet
      open={row !== null}
      size="rail"
      subject={
        row !== null && row.source === "FILED"
          ? { kind: "document", id: row.id }
          : undefined
      }
      onOpenChange={(open) => !open && onClose()}
      id={row === null ? undefined : placeOf(row)}
      title={row?.title ?? "File"}
      badge={
        state === "Missing" ? (
          <Pill tone="bad" withDot>
            Missing
          </Pill>
        ) : state === "Not read" ? (
          <Pill tone="warn" withDot>
            Not read
          </Pill>
        ) : undefined
      }
      caption={
        row === null ? undefined : `Added by ${nameOf(row.by)} · ${day(row.at)}`
      }
      footer={row === null ? undefined : <VaultFoot row={row} />}
    >
      {row === null ? (
        <EmptyState>
          That file is not in the list this screen loaded. It may have been
          attached in a room you cannot read.
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-6">
          <div className="grid h-[18.75rem] shrink-0 place-items-center overflow-hidden rounded-card border border-hairline bg-soft-3">
            <PagePreview row={row} size="sheet" />
          </div>

          <Facts>
            {row.docDate !== null && (
              <Fact term="Document date">{day(row.docDate)}</Fact>
            )}
            <Fact term="Type">
              {kindWord(row)} · {bytes(row.byteSize)}
            </Fact>
            {row.room === null ? (
              <Fact term="Folder">{placeOf(row)}</Fact>
            ) : (
              <Fact term="Posted in">
                <AppLink
                  to={row.room.kind === "DISCUSSION" ? "/discussions" : "/chat"}
                  sheet={{
                    key:
                      row.room.kind === "DISCUSSION"
                        ? "thread"
                        : "conversation",
                    value: row.room.id,
                  }}
                  className="record-link"
                >
                  {row.room.title}
                </AppLink>
              </Fact>
            )}
            {links.map((link) => (
              <Fact
                key={`${link.subject_kind}:${link.subject_id}`}
                term={subjectTerm(link.subject_kind)}
              >
                <LinkedRecord kind={link.subject_kind} id={link.subject_id} />
              </Fact>
            ))}
            {row.name !== row.title && <Fact term="Saved as">{row.name}</Fact>}
            {row.tags.length > 0 && (
              <Fact term="Tags">
                <span className="flex flex-wrap gap-1">
                  {row.tags.map((tag) => (
                    <Tag key={tag}>{tag}</Tag>
                  ))}
                </span>
              </Fact>
            )}
          </Facts>

          {row.paper != null && (
            <SheetSection title="Hard copy" aside={row.paper.originals.length}>
              {row.paper.originals.length === 0 ? (
                <p className="text-body">No hard copy is kept.</p>
              ) : (
                <MiniTable
                  head={["Copy", { label: "Where it is", align: "left" }]}
                >
                  {row.paper.originals.map((one) => {
                    const words = originalWords(one)
                    return (
                      <MiniRow key={one.original_id}>
                        <MiniCell>
                          <button
                            type="button"
                            className="record-link text-left"
                            onClick={() => original.open(one.original_id)}
                          >
                            {one.kind === "ORIGINAL"
                              ? "Original"
                              : "Certified copy"}
                          </button>
                        </MiniCell>
                        <MiniCell>
                          <Status tone={words.tone}>{words.word}</Status>
                        </MiniCell>
                      </MiniRow>
                    )
                  })}
                </MiniTable>
              )}
            </SheetSection>
          )}

          {summary && (
            <section>
              <h4 className="mb-1 text-card-title font-semibold text-ink">
                What it says
              </h4>
              <p className="text-[0.9375rem] leading-relaxed text-text">
                {summary}
              </p>
            </section>
          )}
        </div>
      )}
    </Sheet>
  )
}

/// Copy link, then Download — the one primary. A file whose bytes are gone
/// keeps only the link: it still opens this sheet, which says it is missing.
function VaultFoot({ row }: { row: VaultRow }) {
  const [copied, copy] = useCopyLink(row)
  return (
    <div className="flex items-center justify-end gap-2">
      <Button variant="ghost" onClick={copy}>
        {copied ? <Check className="text-ok-fg" /> : <Link2 />}
        {copied ? "Copied" : "Copy link"}
      </Button>
      {row.href !== null && (
        <a
          href={row.href}
          download={row.name}
          className={button({ variant: "primary" })}
        >
          <Download />
          Download
        </a>
      )}
    </div>
  )
}

/// A link's kind as a fact's label: "Asset", "Purchase order".
function subjectTerm(kind: string): string {
  const label = documentSubjectLabel(kind)
  return label.charAt(0).toUpperCase() + label.slice(1).replace(/_/g, " ")
}

/// The record a document was filed against, by its name and opening it — never
/// its id. The sheet used to print `690d3c80-0afd-…`, which is the one form of
/// a record nobody can read. An asset is looked up for its name; a record with
/// no lookup here says what it is and still opens.
function LinkedRecord({ kind, id }: { kind: string; id: string }) {
  const asset = useQuery({
    queryKey: gaKeys.asset(id),
    queryFn: ({ signal }) => gaAssetHub(id, signal),
    enabled: kind === "asset",
    staleTime: 5 * 60 * 1000,
  })
  const where = recordRoute(kind, id)
  const name =
    kind === "asset"
      ? (asset.data?.asset.name ?? "Open the asset")
      : `Open the ${documentSubjectLabel(kind).toLowerCase()}`
  if (where === null) return <span>{name}</span>
  return (
    <AppLink to={where.to} sheet={where.sheet} className="record-link">
      {name}
    </AppLink>
  )
}

// ─── Giving a dropped file somewhere to be ───────────────────────────────────

/// Where the file just dropped is going: a room, or the drawer.
///
/// This step is the whole reason this screen may have an upload button at all.
/// `POST /files` writes bytes and nothing else; until a post or a message names
/// the id, the file is reachable from no room, appears on no screen, and can
/// never be downloaded again. So the upload is not finished until a destination
/// has been chosen, and this sheet does not let it look finished.
///
/// # Why the bytes are not uploaded on the drop
///
/// The composer uploads the moment a paperclip is picked, on purpose: a
/// photograph finishes while the message is still being typed. Here there is no
/// message being typed in parallel — the sheet opens immediately — and
/// uploading early would decide the route before the destination is known.
///
/// The two destinations do not take the same road. A room attachment goes
/// through `POST /files`, which is capped at 8MB because a chat attachment
/// should be. A filed document goes straight to the object store through a
/// presigned URL, which is how a 20MB contract is filed without pulling it
/// through a 512MB node. Uploading on the drop would have quietly imposed the
/// attachment's ceiling on the filing cabinet.
export function PlaceSheet({
  files,
  onClose,
}: {
  files: readonly File[]
  onClose: () => void
}) {
  const client = useQueryClient()
  const [where, setWhere] = useState("room")
  const open = files.length > 0
  const picked = files.map((file) => `${file.name}:${file.size}`).join("|")

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title="Where does this go?"
      footer={undefined}
    >
      <div className="flex flex-col gap-4">
        <div>
          <h4 className="mb-1.5 text-eyebrow font-semibold text-mute uppercase">
            Picked
          </h4>
          <div className="flex flex-col gap-1.5">
            {files.map((file) => (
              <span key={file.name} className="flex items-center gap-2">
                <FileTile name={file.name} />
                <span className="min-w-0">
                  <span className="block truncate text-meta text-ink">
                    {file.name}
                  </span>
                  <span className="block text-pill text-mute tabular-nums">
                    {bytes(file.size)}
                  </span>
                </span>
              </span>
            ))}
          </div>
        </div>

        <Segmented
          options={[
            { value: "room", label: "A room" },
            { value: "drawer", label: "The filing cabinet" },
          ]}
          value={where}
          onChange={setWhere}
        />

        {/* Keyed on what was picked so a second drop starts from a clean form
            rather than inheriting the note and folder of the first. */}
        {where === "room" ? (
          <IntoRoom
            key={picked}
            files={files}
            client={client}
            onDone={onClose}
          />
        ) : (
          <IntoDrawer
            key={picked}
            files={files}
            client={client}
            onDone={onClose}
          />
        )}
      </div>
    </Sheet>
  )
}

/// Attaching to a thread or a conversation. The file arrives as somebody
/// saying something, because that is the only way a room holds one.
function IntoRoom({
  files,
  client,
  onDone,
}: {
  files: readonly File[]
  client: ReturnType<typeof useQueryClient>
  onDone: () => void
}) {
  const [room, setRoom] = useState<string | null>(null)
  // Pre-filled with what was picked, because a thread refuses an empty reply —
  // "an empty reply says nothing" — and the file's own name is the truest thing
  // anybody could type there anyway.
  //
  // An initialiser and not an effect: the sheet is keyed on the files it was
  // opened with, so a fresh pick remounts this and runs it again. Writing it in
  // an effect would set state during the render that had already drawn an empty
  // box.
  const [note, setNote] = useState(() =>
    files.map((file) => file.name).join(", ")
  )
  const [search, setSearch] = useState("")

  const threads = useQuery({
    // Every thread the list can hold, not the board's first page: this is a
    // picker, and a thread that is not in it cannot be chosen.
    queryKey: workplaceKeys.threads({ limit: 200 }),
    queryFn: ({ signal }) => listThreads({ limit: 200 }, signal),
  })
  const conversations = useQuery({
    queryKey: workplaceKeys.conversations(),
    queryFn: ({ signal }) => listConversations(signal),
  })

  const rooms = useMemo(() => {
    const needle = search.trim().toLowerCase()
    const all = [
      ...(threads.data ?? []).map((thread) => ({
        id: `DISCUSSION:${thread.thread_id}`,
        kind: "DISCUSSION" as const,
        title: thread.title,
      })),
      ...(conversations.data ?? []).map((conversation) => ({
        id: `CHAT:${conversation.conversation_id}`,
        kind: "CHAT" as const,
        title: conversation.title,
      })),
    ]
    return needle === ""
      ? all
      : all.filter((entry) => entry.title.toLowerCase().includes(needle))
  }, [threads.data, conversations.data, search])

  const place = useMutation({
    mutationFn: async () => {
      if (room === null) return
      const stored = await Promise.all(files.map(uploadAttachment))
      const ids = stored.map((file) => file.file_id)
      const split = room.indexOf(":")
      const [kind, id] = [room.slice(0, split), room.slice(split + 1)]
      if (kind === "DISCUSSION") {
        await replyToThread(id, note.trim(), ids)
      } else {
        await sendMessage(id, {
          body: note.trim(),
          // Minted before the first attempt, so a resend after a dropped
          // connection lands once — the column exists for exactly this.
          idempotency_key: idempotencyKey(),
          reply_to_seq: null,
          attachments: ids,
        })
      }
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: workplaceKeys.files() })
      void client.invalidateQueries({
        queryKey: ["workplace", "discussions", "list"],
      })
      void client.invalidateQueries({ queryKey: workplaceKeys.conversations() })
      onDone()
    },
  })

  return (
    <div className="flex flex-col gap-4">
      {place.error instanceof Error && (
        <Banner tone="bad">{place.error.message}</Banner>
      )}

      <Field
        label="Say what it is"
        hint="A thread refuses an empty reply."
        required
      >
        <Textarea
          rows={2}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </Field>

      <div>
        <h4 className="mb-1.5 text-eyebrow font-semibold text-mute uppercase">
          The room
        </h4>
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="mb-2"
        />
        <div className="max-h-64 overflow-y-auto rounded-inner border border-hairline">
          {rooms.length === 0 ? (
            <p className="px-3 py-2.5 text-meta text-body">
              No room matches that.
            </p>
          ) : (
            rooms.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => setRoom(entry.id)}
                className={cn(
                  "flex w-full items-center gap-2 border-b border-hairline px-3 py-2 text-left transition-colors last:border-b-0",
                  entry.id === room ? "bg-accent-bg" : "hover:bg-soft"
                )}
              >
                <Tag tone={entry.kind === "DISCUSSION" ? "info" : "neutral"}>
                  {entry.kind === "DISCUSSION" ? "THREAD" : "CHAT"}
                </Tag>
                <span className="min-w-0 truncate text-meta text-text">
                  {entry.title}
                </span>
              </button>
            ))
          )}
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <span className="text-pill text-mute">
          A file with no room is reachable from nowhere.
        </span>
        <Button
          variant="primary"
          pending={place.isPending}
          disabled={room === null || note.trim() === ""}
          onClick={() => place.mutate()}
        >
          {place.isPending ? "Filing…" : "Put it there"}
        </Button>
      </div>
    </div>
  )
}

/// Filing it as a document: a name, a folder, tags, and what it is about.
///
/// The same form the Documents screen carried, moved here whole. It is not a
/// duplicate of the room path and never was — a supplier's contract is not "a
/// message that happened to have a PDF on it", it is something somebody will go
/// looking for a year later knowing only that it mentioned cotton.
function IntoDrawer({
  files,
  client,
  onDone,
}: {
  files: readonly File[]
  client: ReturnType<typeof useQueryClient>
  onDone: () => void
}) {
  const [title, setTitle] = useState("")
  const [folder, setFolder] = useState("")
  const [tags, setTags] = useState("")
  const [language, setLanguage] = useState("indonesian")
  const [docDate, setDocDate] = useState("")
  const [subjectKind, setSubjectKind] = useState("")
  const [subjectId, setSubjectId] = useState("")

  const file = useMutation({
    mutationFn: async () => {
      for (const one of files) {
        await uploadDocument(one, {
          // A title typed once cannot name three files, so it only applies when
          // there is one. The rest are filed under their own names.
          title:
            files.length === 1 && title.trim() !== ""
              ? title.trim()
              : undefined,
          path_tokens: folder
            .split("/")
            .map((part) => part.trim())
            .filter((part) => part !== ""),
          language,
          doc_date: docDate === "" ? undefined : docDate,
          tags: tags
            .split(",")
            .map((tag) => tag.trim())
            .filter((tag) => tag !== ""),
          links:
            subjectKind !== "" && subjectId.trim() !== ""
              ? [{ subject_kind: subjectKind, subject_id: subjectId.trim() }]
              : [],
        })
      }
    },
    onSuccess: () => {
      // Every filtered view of the drawer, because a new document can match any
      // of them and the list is keyed by its query.
      void client.invalidateQueries({
        queryKey: ["workplace", "documents", "list"],
      })
      onDone()
    },
  })

  return (
    <div className="flex flex-col gap-4">
      {file.error instanceof Error && (
        <Banner tone="bad">{file.error.message}</Banner>
      )}

      {files.length === 1 && (
        <Field label="Title" hint="Optional. What a person would call it.">
          <Input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </Field>
      )}

      <Field
        label="Folder"
        hint="Slash separated. Stored as segments, so “SS26/27” stays one folder if you write it as one."
      >
        <Input
          value={folder}
          onChange={(event) => setFolder(event.target.value)}
        />
      </Field>

      <Field label="Tags" hint="Comma separated, from the company vocabulary.">
        <Input value={tags} onChange={(event) => setTags(event.target.value)} />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Language">
          <Select value={language} onChange={(next) => setLanguage(next)}>
            <option value="indonesian">Indonesian</option>
            <option value="english">English</option>
          </Select>
        </Field>
        <Field label="Document date" hint="The date on the paper.">
          <Day value={docDate} onChange={setDocDate} />
        </Field>
      </div>

      <div>
        <h4 className="mb-1.5 text-eyebrow font-semibold text-mute uppercase">
          What it is about
        </h4>
        <div className="grid grid-cols-2 gap-3">
          <Select value={subjectKind} onChange={(next) => setSubjectKind(next)}>
            <option value="">Nothing in particular</option>
            {DOCUMENT_SUBJECT_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {documentSubjectLabel(kind)}
              </option>
            ))}
          </Select>
          <Input
            value={subjectId}
            onChange={(event) => setSubjectId(event.target.value)}
            // Naming an id without saying what kind of thing it is would file a
            // link the server cannot resolve.
            disabled={subjectKind === ""}
          />
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <span className="text-pill text-mute">
          Nothing is recorded until the bytes have really landed.
        </span>
        <Button
          variant="primary"
          pending={file.isPending}
          onClick={() => file.mutate()}
        >
          {file.isPending ? "Filing…" : "File it"}
        </Button>
      </div>
    </div>
  )
}
