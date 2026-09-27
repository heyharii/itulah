import { Check, Download, FileWarning, Link2 } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import { Pill } from "@/components/ui/pill"
import { Tag } from "@/components/ui/tag"
import { cn } from "@/lib/utils"
import { bytes, fileKind } from "@/screens/workplace/lib"
import {
  folderOf,
  previewable,
  stateOf,
  type VaultRow,
} from "@/screens/workplace/vault"

/// One tile, in midday's anatomy rather than in a photo grid's.
///
/// The difference is the point. The tile this replaces filled its whole frame
/// with the preview and put the filename in a strip underneath, which reads as
/// a gallery: beautiful for a wall of photographs, useless for a drawer of
/// contracts, where twenty tiles of grey text at thumbnail size say nothing.
///
/// midday's is a *card about a document*: a small proof-of-life thumbnail in
/// the corner, then the three things a person is actually scanning for — what
/// it is called, what it says, and what it is tagged. The preview is evidence
/// that the right file is behind the name, not the content of the tile.
///
///   60×84  the thumbnail, a page's proportions at a glance
///   title  one line, ellipsed — the document's title, or the filename
///   summary  three lines — extracted for a document, the room for an attachment
///   tags   the bottom rail, scrollable, each one a filter
///
/// # What is deliberately not midday's
///
///   * **Copy link copies an app link.** midday mints a short public URL.
///     `0040_collaboration.sql` refused `stored_file` a `url` column precisely
///     so a link cannot be forwarded out of the room it was posted in, and a
///     public URL would undo that with one paste.
///   * **There is no delete.** The server has no route for it, and a button
///     that did nothing would be worse than its absence.
///   * **There is no "Re-analyze".** Extraction is not something this app can
///     be asked to run again yet; the state is reported, not actionable.
export function VaultTile({
  row,
  onOpen,
  onTag,
}: {
  row: VaultRow
  onOpen: () => void
  onTag?: (tag: string) => void
}) {
  const [ref, seen] = useSeen<HTMLDivElement>()
  const state = stateOf(row)

  return (
    <div
      ref={ref}
      onClick={onOpen}
      className="group rounded-outer relative flex h-72 cursor-pointer flex-col gap-3 border border-hairline bg-canvas p-4 transition-colors hover:bg-soft"
    >
      {/* The state badge and the actions share the corner, and only one is ever
          there: a row that needs attention says so, and a row that is fine
          offers the two things you can do to it. midday makes the same trade in
          the same place. */}
      {state !== "There" ? (
        <div className="absolute top-3 right-3 z-10">
          <Pill tone={state === "Gone" ? "bad" : "warn"}>{state}</Pill>
        </div>
      ) : (
        <div
          onClick={(event) => event.stopPropagation()}
          className="absolute top-3 right-3 z-10 flex items-center gap-1.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100"
        >
          <Actions row={row} />
        </div>
      )}

      <Thumbnail row={row} seen={seen} />

      <div className="flex min-h-0 flex-1 flex-col">
        <h3 className="mb-1.5 line-clamp-1 text-meta font-medium text-ink">
          {row.title}
        </h3>
        {row.summary !== null && row.summary !== "" && (
          <p className="line-clamp-3 text-pill leading-relaxed text-body">
            {row.summary}
          </p>
        )}
      </div>

      <TileTags row={row} onTag={onTag} />
    </div>
  )
}

/// The corner rail: the tags a document carries, or the room an attachment
/// hangs in. Scrolled rather than wrapped, so a document with six tags is one
/// line tall like every other tile — midday's `overflow-x-auto` for the same
/// reason.
function TileTags({
  row,
  onTag,
}: {
  row: VaultRow
  onTag?: (tag: string) => void
}) {
  return (
    <div // `scrollbar-none` is midday's and is a plugin utility we do not have;
      // the arbitrary property is the same thing said in plain CSS. Without it a
      // scrollbar eats a third of an 18px rail.
      className="mt-auto flex shrink-0 [scrollbar-width:none] items-center gap-1.5 overflow-x-auto"
    >
      {row.room !== null && (
        <Tag tone={row.room.kind === "DISCUSSION" ? "info" : "neutral"}>
          {row.room.kind === "DISCUSSION" ? "THREAD" : "CHAT"}
        </Tag>
      )}

      {row.tags.map((tag) => (
        <button
          key={tag}
          type="button"
          // A tag on a tile is the fastest filter in the drawer: it is the word
          // somebody already recognised. Clicking it narrows the list instead of
          // opening the file, which is why the tile's own click is stopped.
          onClick={(event) => {
            event.stopPropagation()
            onTag?.(tag)
          }}
          className="shrink-0"
          title={`Only the files tagged “${tag}”`}
        >
          <Tag tone="accent" className="transition-opacity hover:opacity-80">
            {tag}
          </Tag>
        </button>
      ))}

      {/* The folder stands in when a filed document has no tags: an empty rail
          under every tile is a row of white space pretending to be a control. */}
      {row.tags.length === 0 && row.room === null && row.folder.length > 0 && (
        <span className="min-w-0 truncate font-mono text-[0.875rem] text-mute">
          {folderOf(row)}
        </span>
      )}

      <span className="ml-auto shrink-0 pl-2 text-[0.875rem] text-mute tabular-nums">
        {bytes(row.byteSize)}
      </span>
    </div>
  )
}

/// The proof that the right bytes are behind the name.
///
/// A page's proportions at 60×84, which is midday's, and it is a real render
/// rather than a thumbnail somebody's worker made — we have no worker. That is
/// what `useSeen` and the size ceiling are for: an `<object>` really fetches
/// and really draws its file, and two hundred of those at once is a page that
/// never settles.
function Thumbnail({ row, seen }: { row: VaultRow; seen: boolean }) {
  const image = row.contentType.toLowerCase().startsWith("image/")
  const show = seen && previewable(row) && row.byteSize <= PREVIEWABLE_BYTES

  return (
    <div
      className={cn(
        "relative grid h-[5.25rem] w-[3.75rem] shrink-0 place-items-center overflow-hidden rounded-inner border border-hairline",
        image ? "bg-soft-2" : "bg-soft"
      )}
    >
      {!row.available ? (
        <FileWarning className="size-4 text-mute" />
      ) : show && image ? (
        <img
          src={row.href!}
          alt=""
          loading="lazy"
          className="size-full object-cover"
        />
      ) : show ? (
        // `pointer-events-none` so the embedded viewer cannot swallow the click
        // that opens the file; the tile is the control, not the PDF.
        <object
          data={`${row.href!}#toolbar=0&navpanes=0&scrollbar=0&view=FitH`}
          type="application/pdf"
          aria-label={row.name}
          className="pointer-events-none size-full"
        >
          <span className="font-mono text-[0.875rem] text-mute">
            {fileKind(row.name)}
          </span>
        </object>
      ) : (
        <span className="font-mono text-[0.875rem] font-semibold text-mute">
          {fileKind(row.name)}
        </span>
      )}
    </div>
  )
}

/// Download and copy-a-link, as midday's two round buttons. Its third is
/// delete, and the server has no route for one.
function Actions({ row }: { row: VaultRow }) {
  const [copied, setCopied] = useState(false)

  const copy = () => {
    // An app link, never a bucket link. See the note at the top of this file.
    const key = row.source === "FILED" ? "document" : "file"
    const link = `${window.location.origin}/library?${key}=${encodeURIComponent(row.id)}`
    void navigator.clipboard?.writeText(link).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 3000)
    })
  }

  return (
    <>
      {row.href !== null && (
        <a
          href={row.href}
          download={row.name}
          aria-label="Download"
          title="Download"
          className={BUTTON}
        >
          <Download className="size-3.5" />
        </a>
      )}
      <button
        type="button"
        onClick={copy}
        aria-label="Copy a link to this file"
        title="Copy a link — it opens in the app, and still checks the reader may see it"
        className={BUTTON}
      >
        {copied ? (
          <Check className="size-3.5 text-ok-fg" />
        ) : (
          <Link2 className="size-3.5" />
        )}
      </button>
    </>
  )
}

const BUTTON =
  "grid size-7 place-items-center rounded-full border border-hairline-2 bg-canvas text-text transition-colors hover:bg-soft-2"

/// Bigger than this and the tile shows its kind instead of its contents.
const PREVIEWABLE_BYTES = 2 * 1024 * 1024

/// Mounted only once the tile has been on screen.
///
/// This is what midday gets for free from virtualising its grid, and what we
/// pay for by hand: a preview really fetches and really renders its file, so
/// mounting every one at once is a page that never settles.
function useSeen<T extends Element>() {
  const ref = useRef<T>(null)
  const [seen, setSeen] = useState(false)

  useEffect(() => {
    const element = ref.current
    if (element === null || seen) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setSeen(true)
      },
      { rootMargin: "200px" }
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [seen])

  return [ref, seen] as const
}
