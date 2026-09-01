import { Collapsible } from "@base-ui/react/collapsible"
import { useQuery } from "@tanstack/react-query"
import { ChevronRight } from "lucide-react"

import { moment } from "@/lib/format"
import { auditForSubject, auditKeys, readAction } from "@/lib/queries/audit"
import { cn } from "@/lib/utils"

/// One record's history, at the foot of its sheet.
///
/// Collapsed by default, and that is DESIGN.md's rule rather than a space
/// saving: depth — audit, GL impact, raw fields — is shown on demand, because
/// a sheet that opens with a wall of provenance buries the two numbers the
/// person actually came for.
///
/// It does not fetch until it is opened. A record sheet is opened constantly
/// and its history is read rarely; firing the query on mount would put a
/// request behind every click in the app to answer a question almost nobody
/// asked.
export function Activity({
  subject,
}: {
  subject: { kind: string; id: string }
}) {
  return (
    <Collapsible.Root className="mt-6 border-t border-hairline pt-3">
      <Collapsible.Trigger className="group flex w-full items-center gap-1.5 text-left text-[0.71875rem] font-medium text-body transition-colors hover:text-ink">
        <ChevronRight className="size-3.5 text-line-ico transition-transform duration-150 group-data-[panel-open]:rotate-90" />
        Activity
      </Collapsible.Trigger>
      <Collapsible.Panel className="overflow-hidden">
        <Trail subject={subject} />
      </Collapsible.Panel>
    </Collapsible.Root>
  )
}

/// Split out so the query lives inside the panel: mounting only on open is
/// what makes "does not fetch until opened" true, rather than merely intended.
function Trail({ subject }: { subject: { kind: string; id: string } }) {
  const history = useQuery({
    queryKey: auditKeys.subject(subject.kind, subject.id),
    queryFn: ({ signal }) => auditForSubject(subject.kind, subject.id, signal),
    // A record's past does not change while you are reading it.
    staleTime: 30_000,
  })

  if (history.isPending) {
    return <p className="py-3 text-[0.71875rem] text-mute">Reading the log…</p>
  }
  if (history.isError) {
    return (
      <p className="py-3 text-[0.71875rem] text-bad">
        The activity log could not be read.
      </p>
    )
  }
  if (history.data.length === 0) {
    return (
      <p className="py-3 text-[0.71875rem] text-mute">
        Nothing has been done to this record since the log began.
      </p>
    )
  }

  return (
    <ol className="flex flex-col pt-1">
      {history.data.map((entry, index) => (
        <li
          key={entry.audit_id}
          className="relative flex items-start gap-2.5 py-1.5"
        >
          {index < history.data.length - 1 && (
            <span className="absolute top-6 left-[0.4375rem] h-[calc(100%-1.125rem)] w-px bg-hairline-2" />
          )}
          {/* A refused action is as much a fact as a successful one, and it is
              the more interesting of the two. Red rather than hidden. */}
          <span
            className={cn(
              "z-10 mt-1.5 size-[0.4375rem] shrink-0 rounded-full",
              entry.status >= 400 ? "bg-bad" : "bg-ok"
            )}
          />
          <span className="min-w-0 flex-1">
            <span className="block text-[0.75rem] text-ink">
              {readAction(entry)}
              {entry.status >= 400 && (
                <span className="ml-1.5 text-bad">refused</span>
              )}
            </span>
            <span className="block text-[0.65625rem] text-mute">
              {entry.display_name}
            </span>
          </span>
          <span className="shrink-0 text-[0.65625rem] text-mute tabular-nums">
            {moment(entry.at)}
          </span>
        </li>
      ))}
    </ol>
  )
}
