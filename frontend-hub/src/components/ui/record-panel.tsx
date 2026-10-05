import { Collapsible } from "@base-ui/react/collapsible"
import { useQuery } from "@tanstack/react-query"
import { ChevronRight } from "lucide-react"

import { moment } from "@/lib/format"
import { describeAction } from "@/lib/queries/audit"
import { recordInfo, recordKeys, type RecordInfo } from "@/lib/queries/records"
import { cn } from "@/lib/utils"

/// The foot of every record sheet: what was done to it.
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
          This record's history could not be read.
        </p>
      </div>
    )
  }

  return (
    <div className="mt-6 flex flex-col gap-4 border-t border-hairline pt-3.5">
      <Elsewhere info={info.data} />
      <Trail info={info.data} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// What else points at this record
// ---------------------------------------------------------------------------

/// Documents filed against it. A line rather than a list: they have a screen
/// of their own, and the useful thing on a sheet is knowing they exist.
function Elsewhere({ info }: { info: RecordInfo }) {
  const documents = info.documents.length
  if (documents === 0) return null
  return (
    <p className="text-[0.875rem] text-mute">
      {documents} {documents === 1 ? "document" : "documents"} filed
    </p>
  )
}

// ---------------------------------------------------------------------------
// Activity
// ---------------------------------------------------------------------------

/// One record's history.
///
/// Always closed when the sheet opens, and that is DESIGN.md's rule rather
/// than a space saving: depth — audit, GL impact, raw fields — is shown on
/// demand, because a sheet that opens with a wall of provenance buries the
/// two numbers the person actually came for. Opening it is one click on the
/// trigger; it never starts open, whatever kind of record this is.
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
          <ol className="flex flex-col pt-3">
            {entries.map((entry, index) => (
              <li
                key={entry.audit_id}
                className="relative flex items-start gap-3 pb-5 last:pb-1"
              >
                {index < entries.length - 1 && (
                  <span className="absolute top-5 left-[0.3125rem] h-[calc(100%-0.75rem)] w-px bg-hairline-2" />
                )}
                {/* A refused action is as much a fact as a successful one, and
                    it is the more interesting of the two. Red, not hidden. */}
                <span
                  className={cn(
                    "z-10 mt-[0.4375rem] size-[0.6875rem] shrink-0 rounded-full border-2 border-canvas",
                    entry.status >= 400 ? "bg-bad" : "bg-ok"
                  )}
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-[0.9375rem] leading-[1.5rem] text-body">
                    <span className="font-medium text-ink">
                      {entry.display_name}
                    </span>{" "}
                    {describeAction(entry)}
                    {entry.status >= 400 && (
                      <span className="ml-1.5 text-bad">
                        — the request was refused
                      </span>
                    )}
                  </span>
                  <span className="block text-[0.875rem] text-mute tabular-nums">
                    {moment(entry.at)}
                  </span>
                </span>
              </li>
            ))}
          </ol>
        )}
      </Collapsible.Panel>
    </Collapsible.Root>
  )
}
