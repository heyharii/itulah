import { ArrowDownLeft, ArrowUpRight, Camera, ChevronLeft } from "lucide-react"
import { useRef, useState } from "react"

import { Status } from "@/components/ui/pill"
import { cn } from "@/lib/utils"
import { rupiahWords, type VoucherKind } from "@/screens/money/petty-book"
import { shrinkPhoto, useNota } from "@/screens/money/petty-receipts"
import { units } from "@itulah/contract/money"

/// The pieces the BKM / BKK pages share: the way back, the heading with its
/// number, the total box, the stamp, and the nota's photo.

/// A rubber stamp — the double ring, set at a tilt so it reads as marked on, not
/// printed in. The same one the catalogue puts on a sold-out garment, here for
/// a voucher that is in the book and a count with its answer.
export function Stamp({
  tone = "ok",
  sub,
  children,
}: {
  tone?: "ok" | "warn" | "bad"
  /// A second line under the word: the day, set in tabular figures.
  sub?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 -rotate-6 flex-col items-center rounded-[0.375rem] border-2 border-current px-2.5 py-0.5 text-center text-[0.875rem] leading-5 font-semibold tracking-[0.06em] whitespace-nowrap uppercase opacity-90 mix-blend-multiply select-none",
        "shadow-[0_0_0_2px_var(--canvas),0_0_0_3.5px_currentColor]",
        tone === "ok"
          ? "text-ok-fg"
          : tone === "warn"
            ? "text-warn-fg"
            : "text-bad-fg",
      )}
    >
      {children}
      {sub !== undefined && <span className="tabular-nums">{sub}</span>}
    </span>
  )
}

/// "← Petty cash": the way back to the list from a page that is not a sheet.
export function BackLink({
  onClick,
  children,
}: {
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mb-1 -ml-2 inline-flex h-8 items-center gap-1 rounded-inner pr-2.5 pl-1 text-meta text-body transition-colors duration-(--t-press) ease-(--ease-out) outline-none hover:bg-soft-2 hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/40 pointer-coarse:h-tap"
    >
      <ChevronLeft className="size-4" />
      {children}
    </button>
  )
}

/// The page's heading: what kind of slip it is, its number, and the page's
/// buttons at the far end.
export function VoucherHeading({
  kind,
  title,
  no,
  children,
}: {
  kind: VoucherKind
  title: string
  no: string
  /// A desk's header buttons. A phone has none here: they are in the dock.
  children?: React.ReactNode
}) {
  const Icon = kind === "BKM" ? ArrowDownLeft : ArrowUpRight
  return (
    <div className="mb-4 flex min-h-9 flex-wrap items-center gap-x-3 gap-y-2">
      <span
        className={cn(
          "grid size-8 shrink-0 place-items-center rounded-[0.5625rem]",
          kind === "BKM" ? "bg-ok-bg text-ok-fg" : "bg-soft-2 text-ink",
        )}
      >
        <Icon className="size-[1.0625rem]" />
      </span>
      <h1 className="text-[0.9375rem] leading-5 font-semibold text-ink">
        {title}
      </h1>
      <span className="mr-auto font-mono text-id text-mute">{no}</span>
      {children !== undefined && (
        <div className="flex items-center gap-2 max-md:hidden">{children}</div>
      )}
    </div>
  )
}

/// The right-hand box of a voucher: the total, in figures and in words, and
/// under them the rows that say what it does to the tin.
export function TotalPanel({
  label,
  totalMinor,
  stamp,
  children,
}: {
  label: string
  totalMinor: number
  stamp?: React.ReactNode
  children?: React.ReactNode
}) {
  return (
    <div className="@container flex flex-col gap-1.5 border-t border-hairline p-5 lg:border-t-0 lg:border-l">
      <div className="flex min-h-7 items-center justify-between gap-3 text-[0.875rem] font-medium text-body">
        {label}
        {stamp}
      </div>
      <div className="flex items-baseline gap-1.5 tabular-nums">
        <span className="text-[1.125rem] font-medium text-mute">Rp</span>
        <b className="text-[length:min(2.125rem,10cqi)] leading-[1.15] font-semibold tracking-[-0.025em] [overflow-wrap:anywhere] text-ink">
          {units(totalMinor)}
        </b>
      </div>
      <div className="min-h-5 text-[0.875rem] leading-[1.45] text-body italic">
        {totalMinor > 0 ? rupiahWords(totalMinor) : "—"}
      </div>
      {children !== undefined && (
        <div className="mt-2 border-t border-hairline pt-1.5">{children}</div>
      )}
    </div>
  )
}

/// A row under the total: a plain label and a figure.
export function TotalRow({
  label,
  bad = false,
  children,
}: {
  label: string
  bad?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="flex justify-between gap-3 pt-2 text-[0.875rem] text-mute tabular-nums">
      <span>{label}</span>
      <b className={cn("font-medium", bad ? "text-bad-fg" : "text-ink")}>
        {children}
      </b>
    </div>
  )
}

/// A nota's photo as a small square, or the word None.
export function NotaThumb({
  id,
  className,
}: {
  id: string
  className?: string
}) {
  const nota = useNota(id)
  if (nota.isPending) return <span className={cn("block size-9", className)} />
  if (nota.data === null || nota.data === undefined)
    return <Status tone="warn">None</Status>
  return (
    <img
      src={nota.data}
      alt="Photo of the nota"
      className={cn(
        "size-9 rounded-[0.4375rem] border border-hairline object-cover",
        className,
      )}
    />
  )
}

export interface Photo {
  readonly name: string
  readonly url: string
}

/// "Take a photo of the nota": a camera on a phone, a file chooser on a desk.
export function NotaPicker({
  photo,
  problem,
  onPhoto,
}: {
  photo: Photo | null
  problem?: string
  onPhoto: (photo: Photo) => void
}) {
  const input = useRef<HTMLInputElement>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const message = problem ?? failed ?? undefined
  const invalid = message !== undefined
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[0.9375rem] font-medium text-text">Receipt</span>
      <input
        ref={input}
        type="file"
        accept="image/*"
        capture="environment"
        tabIndex={-1}
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ""
          if (file === undefined) return
          setFailed(null)
          shrinkPhoto(file).then(
            (url) => onPhoto({ name: file.name, url }),
            () => setFailed("That photo could not be read."),
          )
        }}
      />
      <button
        type="button"
        aria-invalid={invalid || undefined}
        onClick={() => input.current?.click()}
        className={cn(
          "flex w-full items-center rounded-inner border text-control text-body transition-[background-color,border-color,scale] duration-(--t-press) ease-(--ease-out) outline-none hover:border-hairline-strong focus-visible:ring-2 focus-visible:ring-accent/40 active:scale-[0.99]",
          photo === null
            ? "h-24 justify-center gap-2.5 border-dashed border-hairline-strong"
            : "justify-start gap-3 border-hairline-2 px-3 py-2.5 text-left",
          invalid && "border-bad bg-bad-bg",
        )}
      >
        {photo === null ? (
          <>
            <Camera className="size-5 text-line-ico" />
            Take a photo of the nota
          </>
        ) : (
          <>
            <img
              src={photo.url}
              alt="The nota"
              className="size-[4.25rem] shrink-0 rounded-[0.4375rem] border border-hairline object-cover"
            />
            <span className="flex min-w-0 flex-col leading-snug">
              <span className="truncate text-ink">{photo.name}</span>
              <span className="text-[0.875rem] text-mute">Retake</span>
            </span>
          </>
        )}
      </button>
      {message !== undefined && (
        <span className="text-[0.875rem] text-bad">{message}</span>
      )}
    </div>
  )
}
