import { Clock, GitCompare } from "lucide-react"

import { Button } from "@/kit/button"
import { cn } from "@/lib/cn"

/// The two states that are NOT empty states.
///
/// A document that changed under somebody, and an action whose outcome is not
/// yet known, both happen while there is content on screen — so neither can be
/// a placeholder where the content would be. They are strips above it.
///
/// Both are about the same thing: not destroying work, and not repeating an
/// action that may already have happened.

function Strip({
  tone,
  icon,
  children,
  actions,
}: {
  tone: "info" | "warn"
  icon: React.ReactNode
  children: React.ReactNode
  actions?: React.ReactNode
}) {
  return (
    <div
      className={cn(
        "text-ctl flex shrink-0 items-center gap-2 border-b px-4 py-2",
        tone === "warn"
          ? "border-warn/40 bg-warn-wash text-warn-ink"
          : "border-info/40 bg-info-wash text-info-ink",
      )}
      role="status"
    >
      <span className="shrink-0">{icon}</span>
      <span className="min-w-0">{children}</span>
      {actions && (
        <span className="ml-auto flex shrink-0 gap-2">{actions}</span>
      )}
    </div>
  )
}

/// Somebody else changed this while it was open.
///
/// It TELLS and offers; it never reloads by itself. Overwriting the screen
/// somebody is reading — mid-sentence, mid-keystroke — to show them a newer
/// version is how an app loses work that was never saved, and the newer version
/// is rarely more urgent than the paragraph being typed.
export function Changed({
  what,
  by,
  when,
  onReload,
}: {
  what: string
  by: string
  when: string
  onReload: () => void
}) {
  return (
    <Strip
      tone="info"
      icon={<GitCompare className="size-4" />}
      actions={
        <Button variant="quiet" onClick={onReload}>
          Reload
        </Button>
      }
    >
      <b className="font-medium">{what}</b> was changed by {by} {when}. What you
      are typing is untouched until you reload.
    </Strip>
  )
}

/// An action was sent and the answer has not come back.
///
/// The sentence that matters is the last one. On a payment, retrying something
/// that in fact succeeded is paying twice — so the strip says so, and the
/// screen that renders it disables the retry rather than leaving it inviting.
export function Pending({
  what,
  since,
  onCheck,
}: {
  what: string
  since: string
  onCheck?: () => void
}) {
  return (
    <Strip
      tone="warn"
      icon={<Clock className="size-4" />}
      actions={
        onCheck && (
          <Button variant="quiet" onClick={onCheck}>
            Check with the bank
          </Button>
        )
      }
    >
      <b className="font-medium">{what} has no result yet</b> — sent {since}. Do
      not send it again before checking: repeating one that in fact succeeded
      means paying twice.
    </Strip>
  )
}

/// The list you are reading was cut off, and the endpoint cannot say by how
/// much.
///
/// This exists because several finance endpoints answer with a bare array and a
/// server-side cap — see `lib/list.ts`. A list that silently stops at 500 rows
/// looks complete, and a figure summed from it looks like a total. Saying so is
/// the minimum; the real fix is the endpoint.
export function Truncated({ limit, noun }: { limit: number; noun: string }) {
  return (
    <Strip tone="warn" icon={<Clock className="size-4" />}>
      Showing the first {limit.toLocaleString("id-ID")} {noun}. This endpoint
      returns no total and no way to page, so there may be more —{" "}
      <b className="font-medium">do not read the figures below as a total.</b>
    </Strip>
  )
}
