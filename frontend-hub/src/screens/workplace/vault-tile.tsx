import { Check, Download, FileWarning, Link2 } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import { Status } from "@/components/ui/pill"
import { openable } from "@/lib/openable"
import { cn } from "@/lib/utils"
import { bytes, fileKind } from "@/screens/workplace/lib"
import {
  placeOf,
  previewable,
  stateOf,
  type VaultRow,
} from "@/screens/workplace/vault"

/// One tile of the grid — the second view of the list, never the first (owner,
/// 17 Oct 2026: "list saya lebih suka, tapi ada grid modenya";
/// library-tidy-options.html C).
///
/// The tile it replaces was midday's card about a document: a 60×84 thumb in a
/// corner of a 288px box, three lines of summary that most rows do not have,
/// and a rail of tags. On a drawer of contracts that was mostly white space
/// and an orange word on every tile. This one is the page itself, then the
/// two things a person scans a grid for — what it is called and where it is
/// kept — and the size, or the state when something is wrong with it.
///
///   148px  the preview band: the first page, or the picture, on `soft-3`
///   title  one line, ellipsed
///   line   where it is kept · its size (or Missing / Not read)
///
/// Download and Copy link stand in the corner under the pointer. There is no
/// delete — the server has no route for it — and no "Re-analyze": extraction
/// is reported, not something this app can be asked to run again yet.
export function VaultTile({
  row,
  onOpen,
}: {
  row: VaultRow
  onOpen: () => void
}) {
  const [ref, seen] = useSeen<HTMLDivElement>()
  const problem = stateOf(row) === "Missing" || stateOf(row) === "Not read"

  return (
    <div
      ref={ref}
      onClick={onOpen}
      {...openable(onOpen)}
      className="group relative flex cursor-pointer flex-col overflow-hidden rounded-card border border-hairline bg-canvas transition-[border-color,box-shadow,scale] duration-(--t-press) ease-(--ease-out) outline-none hover:border-hairline-2 hover:shadow-[0_6px_18px_rgb(0_0_0/6%)] focus-visible:border-accent active:scale-[0.985]"
    >
      <div className="grid h-[9.25rem] shrink-0 place-items-center overflow-hidden border-b border-hairline bg-soft-3">
        <PagePreview row={row} seen={seen} size="tile" />
      </div>

      {row.href !== null && (
        <div
          onClick={(event) => event.stopPropagation()}
          className="absolute top-2.5 right-2.5 z-10 flex items-center gap-1.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100"
        >
          <Actions row={row} />
        </div>
      )}

      <div className="min-w-0 px-3.5 pt-2.5 pb-3">
        <div className="truncate font-medium text-ink">{row.title}</div>
        <div className="flex items-center justify-between gap-2 text-mute">
          <span className="min-w-0 truncate">{placeOf(row)}</span>
          {problem ? (
            <StateWord row={row} />
          ) : (
            <span className="shrink-0 tabular-nums">{bytes(row.byteSize)}</span>
          )}
        </div>
      </div>
    </div>
  )
}

/// A row's state as the list's State cell, a phone card and a tile say it: a
/// dot and a word, the word coloured only for Missing and Not read. Nothing at
/// all for a file that is ready — a column of "Ready" is a column of noise.
export function StateWord({ row }: { row: VaultRow }) {
  const state = stateOf(row)
  if (state === "Ready") return null
  return (
    <Status
      tone={
        state === "Missing" ? "bad" : state === "Not read" ? "warn" : "done"
      }
    >
      {state}
    </Status>
  )
}

/// The small square at the head of a list row: the picture itself when it is
/// one, a page when it is a document, a warning when the bytes are gone.
///
/// The page is drawn, not rendered. A real `<object>` per row is two hundred
/// PDF viewers on one screen; at 40px the shape of a page says as much.
export function FileThumb({ row }: { row: VaultRow }) {
  const [ref, seen] = useSeen<HTMLSpanElement>()
  const image = row.contentType.toLowerCase().startsWith("image/")
  const show =
    seen && image && previewable(row) && row.byteSize <= PREVIEWABLE_BYTES

  return (
    <span
      ref={ref}
      className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-inner border border-hairline bg-soft-3"
    >
      {!row.available ? (
        <FileWarning className="size-4 text-mute" />
      ) : show ? (
        <img
          src={row.href!}
          alt=""
          loading="lazy"
          className="size-full object-cover"
        />
      ) : (
        <PaperGlyph className="w-5" />
      )}
    </span>
  )
}

/// The first page, or the picture, drawn into the band a tile or a sheet gives
/// it. A page keeps a page's proportions (1 : 1.414) on a light band, so a
/// PDF reads as paper rather than as the browser viewer's grey frame — the
/// dark box the sheet used to draw was that frame, around a page too small
/// for it.
export function PagePreview({
  row,
  seen = true,
  size,
}: {
  row: VaultRow
  seen?: boolean
  size: "tile" | "sheet"
}) {
  const image = row.contentType.toLowerCase().startsWith("image/")
  const ceiling = size === "tile" ? PREVIEWABLE_BYTES : 4 * PREVIEWABLE_BYTES
  const show = seen && previewable(row) && row.byteSize <= ceiling
  const page =
    size === "tile"
      ? "w-[5.25rem] aspect-[1/1.414]"
      : "w-[10.5rem] aspect-[1/1.414]"

  if (!row.available)
    return <FileWarning className="size-5 text-mute" aria-label="Missing" />
  if (show && image)
    return (
      <img
        src={row.href!}
        alt=""
        loading="lazy"
        className={
          size === "tile"
            ? "size-full object-cover"
            : "max-h-full max-w-full object-contain"
        }
      />
    )
  return (
    <span
      className={cn(
        "relative block overflow-hidden rounded-[3px] border border-hairline bg-canvas shadow-[0_1px_2px_rgb(0_0_0/5%),0_8px_24px_rgb(0_0_0/6%)]",
        page
      )}
    >
      {show ? (
        // `pointer-events-none` so the embedded viewer cannot swallow the
        // click that opens the file; the tile is the control, not the PDF.
        <object
          data={`${row.href!}#toolbar=0&navpanes=0&scrollbar=0&view=FitH`}
          type="application/pdf"
          aria-label={row.name}
          className="pointer-events-none size-full"
        >
          <PaperLines kind={fileKind(row.name)} />
        </object>
      ) : (
        <PaperLines kind={fileKind(row.name)} />
      )}
    </span>
  )
}

/// A page drawn in lines: what stands in for a file the browser will not draw.
function PaperLines({ kind }: { kind: string }) {
  return (
    <span className="flex size-full flex-col gap-[7%] p-[13%]">
      <span className="h-[4%] w-3/5 rounded-full bg-[#9a9aa1]" />
      {[100, 92, 96, 78, 0, 88, 94, 66].map((width, index) =>
        width === 0 ? (
          <span key={index} className="h-[3%]" />
        ) : (
          <span
            key={index}
            className="h-[3%] rounded-full bg-hairline"
            style={{ width: `${width}%` }}
          />
        )
      )}
      <span className="mt-auto text-center text-[0.9375rem] font-medium text-mute">
        {kind}
      </span>
    </span>
  )
}

/// The 20px page in a list row's square: a sheet of paper and three lines.
function PaperGlyph({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "flex aspect-[1/1.32] flex-col gap-[2px] rounded-[2px] border border-hairline-2 bg-canvas p-[3px] shadow-[0_1px_2px_rgb(0_0_0/4%)]",
        className
      )}
    >
      <span className="h-[2px] w-3/5 rounded-full bg-[#9a9aa1]" />
      <span className="h-[1.5px] rounded-full bg-hairline-2" />
      <span className="h-[1.5px] rounded-full bg-hairline-2" />
      <span className="h-[1.5px] w-4/5 rounded-full bg-hairline-2" />
    </span>
  )
}

/// Download and copy-a-link, the two round buttons in a tile's corner.
function Actions({ row }: { row: VaultRow }) {
  const [copied, copy] = useCopyLink(row)

  return (
    <>
      <a
        href={row.href!}
        download={row.name}
        aria-label="Download"
        title="Download"
        className={BUTTON}
      >
        <Download className="size-4" />
      </a>
      <button
        type="button"
        onClick={copy}
        aria-label="Copy link"
        title="Copy link"
        className={BUTTON}
      >
        {copied ? (
          <Check className="size-4 text-ok-fg" />
        ) : (
          <Link2 className="size-4" />
        )}
      </button>
    </>
  )
}

/// Copy a link to a row — an app link, never a bucket link: `0040` refused
/// `stored_file` a `url` column so a file cannot be forwarded out of the room
/// it was posted in, and a public URL would undo that with one paste. The link
/// opens this screen's sheet, which still checks the reader may see it.
export function useCopyLink(row: VaultRow): readonly [boolean, () => void] {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    const key = row.source === "FILED" ? "document" : "file"
    const link = `${window.location.origin}/library?${key}=${encodeURIComponent(row.id)}`
    void navigator.clipboard?.writeText(link).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 3000)
    })
  }
  return [copied, copy] as const
}

const BUTTON =
  "grid size-8 place-items-center rounded-full border border-hairline-2 bg-canvas text-text shadow-soft transition-colors hover:bg-soft-2"

/// Bigger than this and a tile shows the drawn page instead of its contents.
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
