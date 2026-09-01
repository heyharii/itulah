import { useForm } from "@tanstack/react-form"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useDeferredValue, useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Field, Input, Select } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { KeyValue } from "@/components/ui/rows"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState } from "@/components/ui/states"
import { Tag } from "@/components/ui/tag"
import { count, day, label, moment, toneFor } from "@/lib/format"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"
import {
  SUBJECT_KINDS,
  type DocumentFilter,
  type WorkplaceDocument,
  documentDownloadUrl,
  readDocument,
  searchDocuments,
  subjectLabel,
  uploadDocument,
  workplaceKeys,
} from "@/lib/queries/workplace"
import { tableSetup, type TableSetup } from "@/lib/table"
import { bytes, fileKind } from "@/screens/workplace/lib"
import { AttachButton, FileTile } from "@/screens/workplace/parts"

/// Documents — the filing cabinet, as opposed to the correspondence.
///
/// Deliberately not the Files screen. An attachment there is reached only
/// through the conversation or post that carries it, so a link cannot leave the
/// room it was posted in. That is right for correspondence and wrong for a
/// filing cabinet: a supplier's contract is not "a message that happened to
/// have a PDF on it", it is a document somebody will go looking for a year
/// later knowing only that it mentioned cotton.
///
/// So a document sits ON TOP of a stored file — same bytes, same hash, same
/// `available` flag — and adds the filing: a name, a folder, tags, what it is
/// about, and enough text to find it by.

/// How much attention a row needs, lowest first. The decision metric this list
/// sorts by: a document whose object never arrived, or whose text was never
/// extracted, is the only kind anybody has to act on. A finished, present
/// document is quiet.
function attention(document: WorkplaceDocument): number {
  if (!document.available) return 0
  if (document.processing_status === "FAILED") return 1
  if (document.processing_status !== "COMPLETED") return 2
  return 3
}

const columns: ColumnDef<TableSetup, WorkplaceDocument>[] = [
  {
    id: "name",
    accessorFn: (row) => `${row.title ?? ""} ${row.name}`,
    header: "Document",
    size: 320,
    cell: ({ row }) => (
      <span className="flex items-center gap-2.5">
        <FileTile name={row.original.name} />
        <span className="min-w-0">
          <span className="block truncate font-medium text-ink">
            {row.original.title ?? row.original.name}
          </span>
          <span className="block truncate font-mono text-[0.65625rem] text-mute">
            {row.original.path_tokens.length === 0
              ? row.original.name
              : `/${row.original.path_tokens.join("/")}`}
          </span>
        </span>
      </span>
    ),
  },
  {
    id: "links",
    accessorFn: (row) => row.links.length,
    header: "About",
    size: 200,
    cell: ({ row }) =>
      row.original.links.length === 0 ? (
        <span className="text-mute">Filed on its own</span>
      ) : (
        <span className="flex flex-wrap gap-1">
          {row.original.links.map((link) => (
            <Tag key={`${link.subject_kind}:${link.subject_id}`}>
              {link.subject_id}
            </Tag>
          ))}
        </span>
      ),
  },
  {
    id: "tags",
    accessorFn: (row) => row.tags.join(" "),
    header: "Tags",
    size: 170,
    cell: ({ row }) =>
      row.original.tags.length === 0 ? (
        <span className="text-mute">—</span>
      ) : (
        <span className="flex flex-wrap gap-1">
          {row.original.tags.map((tag) => (
            <Tag key={tag}>{tag}</Tag>
          ))}
        </span>
      ),
  },
  {
    id: "doc_date",
    accessorFn: (row) => row.doc_date ?? row.created_at,
    header: "Dated",
    size: 130,
    meta: { align: "right" },
    cell: ({ row }) => day(row.original.doc_date ?? row.original.created_at),
  },
  {
    id: "byte_size",
    accessorKey: "byte_size",
    header: "Size",
    size: 100,
    meta: { align: "right" },
    cell: ({ row }) => bytes(row.original.byte_size),
  },
  {
    id: "attention",
    accessorFn: attention,
    header: "State",
    size: 150,
    cell: ({ row }) =>
      !row.original.available ? (
        <Pill tone="bad">The bytes are gone</Pill>
      ) : (
        <Pill tone={toneFor(row.original.processing_status)}>
          {label(row.original.processing_status)}
        </Pill>
      ),
  },
]

export function Documents() {
  // Which document is open lives in the URL, like every other sheet here.
  const opened = useSheet("document")
  const [search, setSearch] = useState("")
  const [filing, setFiling] = useState(false)
  const [sorting, setSorting] = useState<SortingState>([
    { id: "attention", desc: false },
  ])

  const typed = useDeferredValue(search)
  const filter = useMemo<DocumentFilter>(
    () => ({ q: typed.trim() === "" ? undefined : typed.trim() }),
    [typed]
  )

  const documents = useQuery({
    queryKey: workplaceKeys.documents(filter),
    queryFn: ({ signal }) => searchDocuments(filter, signal),
  })

  const rows = useMemo(() => documents.data ?? [], [documents.data])

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns,
        getRowId: (row: WorkplaceDocument) => row.document_id,
        state: { sorting },
        onSortingChange: setSorting,
      }),
      [rows, sorting]
    )
  )

  return (
    <PageContent>
      <PageHeader
        crumb="Workplace"
        title="Documents"
        sub="The filing cabinet: contracts, specs and notes somebody will go looking for a year from now."
        actions={
          <>
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search the text"
              className="h-8 w-56"
            />
            <Button variant="dark" onClick={() => setFiling(true)}>
              File a document
            </Button>
          </>
        }
      />

      {/* Only while a search is running, because that is the only time it
          explains anything: the server consults both text configurations rather
          than the one the filing clerk happened to pick, which is why an
          English query finds an Indonesian contract. */}
      {typed.trim() !== "" && (
        <Banner tone="info" className="mb-4">
          The drawer is searched in Indonesian and English at once, so a query
          in either language finds a document filed in the other.
        </Banner>
      )}

      <Card className="overflow-hidden">
        {queryState(documents, {
          loading: "Searching the drawer…",
          render: () =>
            rows.length === 0 ? (
              <EmptyState>
                {typed.trim() === ""
                  ? "Nothing has been filed yet."
                  : `Nothing filed matches “${typed.trim()}”.`}
              </EmptyState>
            ) : (
              <DataTable<WorkplaceDocument>
                table={table}
                onRowClick={(row) => opened.open(row.document_id)}
                isSelected={(row) => row.document_id === opened.value}
                className="max-h-[calc(100vh-17rem)]"
              />
            ),
        })}
      </Card>

      <DocumentSheet id={opened.value ?? null} onClose={opened.close} />
      <FileDocumentSheet open={filing} onClose={() => setFiling(false)} />
    </PageContent>
  )
}

function DocumentSheet({
  id,
  onClose,
}: {
  id: string | null
  onClose: () => void
}) {
  const detail = useQuery({
    queryKey: workplaceKeys.document(id ?? ""),
    queryFn: ({ signal }) => readDocument(id!, signal),
    enabled: id !== null,
  })

  /// The link is asked for on the click, never held.
  ///
  /// It is signed for five minutes: one cached for the life of a screen has
  /// expired by the time somebody clicks it. It is also handed over as a link
  /// to click rather than a window opened from a callback — an async
  /// `window.open` is what a popup blocker exists to stop.
  const link = useMutation({
    mutationFn: () => documentDownloadUrl(id!),
  })

  return (
    <Sheet
      open={id !== null}
      subject={id === null ? undefined : { kind: "document", id }}
      onOpenChange={(open) => {
        if (!open) {
          link.reset()
          onClose()
        }
      }}
      id={detail.data ? fileKind(detail.data.name) : undefined}
      title={detail.data?.title ?? detail.data?.name ?? "Document"}
    >
      {queryState(detail, {
        loading: "Loading the document…",
        render: (document) => (
          <div className="flex flex-col gap-5">
            <div className="flex flex-wrap items-center gap-2">
              {document.available ? (
                <Pill tone={toneFor(document.processing_status)}>
                  {label(document.processing_status)}
                </Pill>
              ) : (
                <Pill tone="bad">The bytes are gone</Pill>
              )}
              <Tag>{document.content_type}</Tag>
              <Tag>{document.language.toUpperCase()}</Tag>
              {document.tags.map((tag) => (
                <Tag key={tag} tone="accent">
                  {tag}
                </Tag>
              ))}
            </div>

            {document.summary && (
              <p className="text-meta leading-relaxed text-body">
                {document.summary}
              </p>
            )}

            <Facts>
              <Fact term="Filed as">{document.name}</Fact>
              <Fact term="Folder">
                {document.path_tokens.length === 0
                  ? "—"
                  : `/${document.path_tokens.join("/")}`}
              </Fact>
              <Fact term="Document date">{day(document.doc_date)}</Fact>
              <Fact term="Filed">{moment(document.created_at)}</Fact>
              <Fact term="Filed by">{document.uploaded_by}</Fact>
              <Fact term="Size">{bytes(document.byte_size)}</Fact>
            </Facts>

            <div>
              <h4 className="mb-1 text-card-title font-semibold text-ink">
                What it is about
              </h4>
              {document.links.length === 0 ? (
                <p className="text-meta text-body">
                  Filed on its own, against no record.
                </p>
              ) : (
                document.links.map((link_) => (
                  <KeyValue
                    key={`${link_.subject_kind}:${link_.subject_id}`}
                    term={subjectLabel(link_.subject_kind)}
                  >
                    {link_.subject_id}
                  </KeyValue>
                ))
              )}
            </div>

            <div className="flex flex-col gap-2">
              {!document.available ? (
                <p className="text-meta text-body">
                  This document is filed, but its object is not in storage.
                  There is nothing to download.
                </p>
              ) : link.data ? (
                <a
                  href={link.data.url}
                  className="inline-flex h-8 w-max items-center justify-center rounded-full bg-ink px-3 text-[0.78125rem] font-medium text-on-dark transition-colors hover:opacity-90"
                >
                  Download {document.name}
                </a>
              ) : (
                <Button
                  variant="ghost"
                  disabled={link.isPending}
                  onClick={() => link.mutate()}
                >
                  {link.isPending
                    ? "Signing a link…"
                    : "Prepare a download link"}
                </Button>
              )}
              {link.data && (
                <p className="text-pill text-mute">
                  The link is signed for {count(link.data.expires_in_seconds)}{" "}
                  seconds. Ask again after that.
                </p>
              )}
              {link.error instanceof Error && (
                <Banner tone="bad">{link.error.message}</Banner>
              )}
            </div>
          </div>
        ),
      })}
    </Sheet>
  )
}

/// Filing a document: reserve, PUT the bytes past this process, then record it.
///
/// The bytes never travel through the node — a 512MB service should not read a
/// 20MB contract into memory to hand it to a bucket it could have been given
/// directly — so the middle step is a PUT to a presigned URL and the last step
/// tells the server where the object went. `upload_id` is what makes that last
/// step safe: the server finds the object by the id it issued rather than by
/// anything the browser made up.
///
/// The picked `File` sits on the draft with everything else: it is the one
/// value the form cannot be submitted without, and holding it apart from the
/// fields that describe it is how a half-filled filing gets sent.
interface FilingDraft {
  file: File | null
  title: string
  folder: string
  tags: string
  language: string
  docDate: string
  subjectKind: string
  subjectId: string
}

function FileDocumentSheet({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const client = useQueryClient()

  const submit = useMutation({
    // Wrapped rather than passed by reference: v5 hands a mutation context as
    // the second argument, which is not the `AbortSignal` the fetcher expects.
    mutationFn: (draft: FilingDraft) =>
      uploadDocument(draft.file!, {
        title: draft.title.trim() === "" ? undefined : draft.title.trim(),
        path_tokens: draft.folder
          .split("/")
          .map((part) => part.trim())
          .filter((part) => part !== ""),
        language: draft.language,
        doc_date: draft.docDate === "" ? undefined : draft.docDate,
        tags: draft.tags
          .split(",")
          .map((tag) => tag.trim())
          .filter((tag) => tag !== ""),
        links:
          draft.subjectKind !== "" && draft.subjectId.trim() !== ""
            ? [
                {
                  subject_kind: draft.subjectKind,
                  subject_id: draft.subjectId.trim(),
                },
              ]
            : [],
      }),
    onSuccess: () => {
      // Every filtered view of the drawer, because a new document can match any
      // of them and the list is keyed by its query.
      void client.invalidateQueries({
        queryKey: ["workplace", "documents", "list"],
      })
      // Everything but the language, which is a property of who is filing
      // rather than of what was filed.
      form.setFieldValue("file", null)
      form.setFieldValue("title", "")
      form.setFieldValue("folder", "")
      form.setFieldValue("tags", "")
      form.setFieldValue("docDate", "")
      form.setFieldValue("subjectKind", "")
      form.setFieldValue("subjectId", "")
      onClose()
    },
  })

  const form = useForm({
    defaultValues: {
      file: null,
      title: "",
      folder: "",
      tags: "",
      language: "id",
      docDate: "",
      subjectKind: "",
      subjectId: "",
    } as FilingDraft,
    onSubmit: ({ value }) => submit.mutate(value),
  })

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title="File a document"
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className="text-pill text-mute">
            The bytes go straight to storage, not through the node.
          </span>
          <form.Subscribe selector={(state) => state.values.file === null}>
            {(empty) => (
              <Button
                variant="dark"
                disabled={empty || submit.isPending}
                onClick={() => form.handleSubmit()}
              >
                {submit.isPending ? "Filing…" : "File it"}
              </Button>
            )}
          </form.Subscribe>
        </div>
      }
    >
      <form
        // The button is in the sheet's footer, outside this element, so its
        // disabled state cannot block an Enter keypress — and a filing with no
        // file is the one thing this must never send.
        onSubmit={(event) => {
          event.preventDefault()
          if (form.state.values.file !== null && !submit.isPending) {
            form.handleSubmit()
          }
        }}
        className="flex flex-col gap-4"
      >
        {submit.error instanceof Error && (
          <Banner tone="bad">{submit.error.message}</Banner>
        )}

        <form.Field name="file">
          {(field) => (
            <Field
              label="The file"
              hint="Nothing is recorded until the object is really in the bucket."
            >
              <div className="flex items-center gap-2.5">
                <AttachButton
                  onAttach={(picked) => field.handleChange(picked)}
                  disabled={submit.isPending}
                />
                {field.state.value === null ? (
                  <span className="text-meta text-mute">
                    Nothing picked yet.
                  </span>
                ) : (
                  <span className="flex min-w-0 items-center gap-2">
                    <FileTile name={field.state.value.name} />
                    <span className="min-w-0">
                      <span className="block truncate text-meta text-ink">
                        {field.state.value.name}
                      </span>
                      <span className="block text-pill text-mute tabular-nums">
                        {bytes(field.state.value.size)}
                      </span>
                    </span>
                  </span>
                )}
              </div>
            </Field>
          )}
        </form.Field>

        <form.Field name="title">
          {(field) => (
            <Field label="Title" hint="Optional. What a person would call it.">
              <Input
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
                placeholder="Cotton supply agreement 2026"
              />
            </Field>
          )}
        </form.Field>

        <form.Field name="folder">
          {(field) => (
            <Field
              label="Folder"
              hint="Slash separated. Stored as segments, so “SS26/27” stays one folder if you write it as one."
            >
              <Input
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
                placeholder="contracts/suppliers"
              />
            </Field>
          )}
        </form.Field>

        <form.Field name="tags">
          {(field) => (
            <Field label="Tags" hint="Comma separated.">
              <Input
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
                placeholder="contract, cotton"
              />
            </Field>
          )}
        </form.Field>

        <div className="grid grid-cols-2 gap-3">
          <form.Field name="language">
            {(field) => (
              <Field label="Language">
                <Select
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                >
                  <option value="id">Indonesian</option>
                  <option value="en">English</option>
                </Select>
              </Field>
            )}
          </form.Field>
          <form.Field name="docDate">
            {(field) => (
              <Field label="Document date" hint="The date on the paper.">
                <Input
                  type="date"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
              </Field>
            )}
          </form.Field>
        </div>

        <div>
          <h4 className="mb-1.5 text-eyebrow font-semibold text-mute uppercase">
            What it is about
          </h4>
          <div className="grid grid-cols-2 gap-3">
            <form.Field name="subjectKind">
              {(field) => (
                <Select
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                >
                  <option value="">Nothing in particular</option>
                  {SUBJECT_KINDS.map((kind) => (
                    <option key={kind} value={kind}>
                      {subjectLabel(kind)}
                    </option>
                  ))}
                </Select>
              )}
            </form.Field>
            <form.Subscribe selector={(state) => state.values.subjectKind}>
              {(kind) => (
                <form.Field name="subjectId">
                  {(field) => (
                    <Input
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(event) =>
                        field.handleChange(event.target.value)
                      }
                      placeholder="PO-2607-0108"
                      // Naming an id without saying what kind of thing it is
                      // would file a link the server cannot resolve.
                      disabled={kind === ""}
                    />
                  )}
                </form.Field>
              )}
            </form.Subscribe>
          </div>
        </div>
      </form>
    </Sheet>
  )
}
