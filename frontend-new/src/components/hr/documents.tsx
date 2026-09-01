import { useRef, useState } from "react"

import { Icon, paths } from "@/components/dashboard/parts"
import { useHrEmployeeDocuments, type HrEmployee } from "@/components/hr/api"
import type { Employee } from "@/components/hr/data"
import { DOC_KIND, useHr, type DocKind } from "@/components/hr/store"
import { cn } from "@/lib/utils"

const ORDER = Object.keys(DOC_KIND) as DocKind[]

/**
 * The documents a person's file has to hold. A store uploads them because it
 * is the one that meets the person; Head Office verifies, and only a verified
 * document closes the gap.
 */
export function Documents({
  employee,
  scope,
  uploader,
}: {
  employee: Employee
  scope: "ho" | "store"
  /** Which location is doing the uploading. */
  uploader: string
}) {
  const { docsFor, docGaps, addDoc, decideDoc } = useHr()
  const [picking, setPicking] = useState<DocKind | null>(null)
  const input = useRef<HTMLInputElement>(null)

  const docs = docsFor(employee.id)
  const gaps = docGaps(employee.id)

  return (
    <section>
      <div className="flex items-center gap-2 pb-2">
        <span className="text-[11px] font-semibold tracking-[0.05em] text-ink-4 uppercase">
          Documents
        </span>
        {gaps.length > 0 && (
          <span className="inline-flex h-[18px] items-center rounded-chip bg-orange-tint px-1.5 text-[10.5px] font-medium text-honey">
            {gaps.length} still needed
          </span>
        )}
      </div>

      <ul className="overflow-hidden rounded-panel border border-line-strong">
        {ORDER.map((kind) => {
          const meta = DOC_KIND[kind]
          const doc = docs.find((d) => d.kind === kind)
          const tone =
            doc?.status === "approved"
              ? "var(--grass)"
              : doc?.status === "pending"
                ? "var(--honey)"
                : doc?.status === "declined"
                  ? "var(--ember)"
                  : "var(--ink-4)"

          return (
            <li
              key={kind}
              className="group/doc flex items-center gap-2.5 border-b border-line px-3 py-2 last:border-b-0"
            >
              <span
                style={{ color: tone }}
                className="grid size-[26px] shrink-0 place-items-center rounded-panel bg-inset"
              >
                <Icon
                  path={doc ? paths.doc : paths.upload}
                  size={13}
                  width={1.9}
                />
              </span>

              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="truncate text-[12px] font-medium text-ink">
                    {meta.label}
                  </span>
                  {meta.required && !doc && (
                    <span className="shrink-0 text-[10px] font-medium text-ember">
                      Required
                    </span>
                  )}
                </span>
                <span className="block truncate text-[10.5px] text-ink-4">
                  {doc ? `${doc.fileName} · ${doc.uploadedBy}` : meta.note}
                </span>
              </span>

              {doc && (
                <span
                  style={{ color: tone }}
                  className="shrink-0 text-[10.5px] font-medium"
                >
                  {doc.status === "approved"
                    ? "Verified"
                    : doc.status === "pending"
                      ? "Waiting"
                      : "Rejected"}
                </span>
              )}

              {/* the store hands them in, Head Office says whether they count */}
              {scope === "store" ? (
                <button
                  type="button"
                  onClick={() => {
                    setPicking(kind)
                    input.current?.click()
                  }}
                  className="shrink-0 rounded-control px-2 py-1 text-[10.5px] font-medium text-accent-ink opacity-0 transition-opacity group-hover/doc:opacity-100 hover:bg-hover"
                >
                  {doc ? "Replace" : "Upload"}
                </button>
              ) : (
                doc?.status === "pending" && (
                  <span className="flex shrink-0 gap-1">
                    <button
                      type="button"
                      onClick={() => decideDoc(doc.id, "declined", "People")}
                      className="rounded-control px-1.5 py-1 text-[10.5px] font-medium text-ink-3 transition-colors hover:bg-hover-2 hover:text-ember"
                    >
                      Reject
                    </button>
                    <button
                      type="button"
                      onClick={() => decideDoc(doc.id, "approved", "People")}
                      className="rounded-control bg-ink px-1.5 py-1 text-[10.5px] font-medium text-white transition-opacity hover:opacity-90"
                    >
                      Verify
                    </button>
                  </span>
                )
              )}
            </li>
          )
        })}
      </ul>

      {/* nothing is actually stored — the prototype keeps the file's name */}
      <input
        ref={input}
        type="file"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file && picking) {
            addDoc({
              employeeId: employee.id,
              kind: picking,
              fileName: file.name,
              uploadedBy: uploader,
            })
          }
          event.target.value = ""
          setPicking(null)
        }}
      />

      <p className={cn("pt-2 text-[10.5px] leading-[1.5] text-ink-4")}>
        {scope === "store"
          ? "Uploads go to Head Office to be verified before they count."
          : "Verified documents are what a payslip and a contract rest on."}
      </p>
    </section>
  )
}

/**
 * Read-only employee documents backed by Internal. The existing Documents
 * component is intentionally left for the prototype workflow; this variant
 * never displays the local document fixture and never claims an upload or
 * verification happened when the corresponding command is not wired here.
 */
export function LiveDocuments({ employee }: { employee: HrEmployee }) {
  const resource = useHrEmployeeDocuments(employee.id)
  const documents = resource.data ?? []

  return (
    <section>
      <div className="flex items-center gap-2 pb-2">
        <span className="text-[11px] font-semibold tracking-[0.05em] text-ink-4 uppercase">
          Documents
        </span>
        <span className="text-[10.5px] text-ink-4">Internal read-only</span>
      </div>

      {resource.isLoading && (
        <div className="rounded-panel bg-inset px-3 py-3 text-xs text-ink-4">
          Loading documents from Internal…
        </div>
      )}
      {resource.errorMessage && (
        <div className="rounded-panel bg-red-tint px-3 py-3 text-xs text-red">
          Could not load Internal documents: {resource.errorMessage}
        </div>
      )}
      {!resource.isLoading && !resource.errorMessage && !documents.length && (
        <div className="rounded-panel bg-inset px-3 py-3 text-xs text-ink-4">
          Internal has no documents for this employee.
        </div>
      )}
      {documents.length > 0 && (
        <ul className="overflow-hidden rounded-panel border border-line-strong">
          {documents.map((document) => (
            <li
              key={document.id}
              className="flex items-center gap-2.5 border-b border-line px-3 py-2 last:border-b-0"
            >
              <span className="grid size-[26px] shrink-0 place-items-center rounded-panel bg-inset text-ink-3">
                <Icon path={paths.doc} size={13} width={1.9} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12px] font-medium text-ink">
                  {document.fileName}
                </span>
                <span className="block truncate text-[10.5px] text-ink-4">
                  {document.documentType} ·{" "}
                  {document.uploadedBy || "Unknown uploader"}
                  {document.uploadedAt
                    ? ` · ${document.uploadedAt.slice(0, 10)}`
                    : ""}
                </span>
              </span>
              <span
                className={cn(
                  "shrink-0 text-[10.5px] font-medium",
                  document.status === "approved" ||
                    document.status === "verified"
                    ? "text-grass"
                    : document.status === "rejected" ||
                        document.status === "declined"
                      ? "text-ember"
                      : "text-honey"
                )}
              >
                {document.status}
              </span>
            </li>
          ))}
        </ul>
      )}

      <p className="pt-2 text-[10.5px] leading-[1.5] text-ink-4">
        Upload, replace, and verification actions are unavailable in this screen
        until a multipart command adapter and permission contract are added.
      </p>
    </section>
  )
}
